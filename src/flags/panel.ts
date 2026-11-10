import { limited } from '../elements/limits'
import { editDoc } from '../doc/store'
import { layerNodes } from '../elements/nodes'
import { BODY_TYPE } from '../model'
import { sanitizeId, uniqueId } from '../palette/ids'
import { toRgbHex } from '../palette/color'
import { onNameplateChanged, readNameplate } from '../palette/state'
import { onShownColorway, toneChoices } from '../palette/tones'
import { NameplateData } from '../model'
import { addVariantLike } from '../util/variants'
import { bandAt, chevronStripe, circlePart, fittedRows } from './fit'
import { commitFlags, onFlagsChanged, readFlags } from './state'
import { FLAG_LIMITS, FlagAxis, FlagData, OVERLAY_KINDS, OverlayKind, overlayColorRange } from './types'
import { heading } from '../util/form'
import { element } from '../util/dom'
import { createFormHost } from '../util/formHost'
import { cloneJson } from '../util/json'
import { hasProject } from '../util/project'
import { undoEdit } from '../util/undo'

type FormConfig = Record<string, FormElementOptions | '_'>
type Result = Record<string, any>

const NEW_DIALOG = 'polyplus_nameplate_new_flag'
const PREVIEW_COLUMNS = 48
const PREVIEW_SCALE = 4
const MAX_FIT_ROWS = 64
const MAX_FIT_COLUMNS = 256
const EVENTS = ['select_project', 'update_selection', 'finished_edit', 'undo', 'redo', 'select_mode']

const OVERLAY_LABELS: Record<string, string> = {
    none: 'None',
    chevron: 'Chevron stripes from the left',
    triangle: 'Triangle from the left',
    circle: 'Ring in the middle',
}

const AXIS_LABELS: Record<FlagAxis, string> = {
    rows: 'Across',
    columns: 'Down',
}

const PRESETS: Record<string, { label: string, weights: number[], symmetric?: boolean, axis?: FlagAxis, overlay?: { kind: OverlayKind, width: number } }> = {
    two: { label: 'Two equal bands', weights: [1, 1] },
    three: { label: 'Three equal bands', weights: [1, 1, 1] },
    wide_middle: { label: 'Three bands, wide middle', weights: [1, 2, 1], symmetric: true },
    four: { label: 'Four equal bands', weights: [1, 1, 1, 1] },
    five: { label: 'Five equal bands', weights: [1, 1, 1, 1, 1], symmetric: true },
    six: { label: 'Six equal bands', weights: [1, 1, 1, 1, 1, 1] },
    three_down: { label: 'Three vertical stripes', weights: [1, 1, 1], axis: 'columns' },
    chevron: { label: 'Three bands with a chevron', weights: [1, 1, 1], overlay: { kind: 'chevron', width: 1 } },
}

interface FlagsUi {
    hasProject: boolean
    count: number
    fitText: string
}

const flagsUi: FlagsUi = { hasProject: false, count: 0, fitText: '' }

const handles: {
    host: HTMLElement | null
    canvas: HTMLCanvasElement | null
    empty: HTMLElement | null
    note: HTMLElement | null
    fit: HTMLElement | null
    selected: string
    rows: number
    columns: number
    rowsProject: unknown
} = { host: null, canvas: null, empty: null, note: null, fit: null, selected: '', rows: 0, columns: PREVIEW_COLUMNS, rowsProject: null }

const formHost = createFormHost('flag')

function firstTones(count: number): string[] {
    const tones: string[] = []
    const slots = readNameplate().palette.slots
    for (const slot of slots) tones.push(slot.id)
    for (const slot of slots) slot.ramp.forEach((_, index) => index > 0 && tones.push(`${slot.id}[${index}]`))
    const result: string[] = []
    for (let i = 0; i < count; i++) result.push(tones[i % Math.max(1, tones.length)] ?? '')
    return result
}

function resolveColor(ref: string): string {
    const match = /^([a-z0-9_]+)(?:\[(\d+)\])?$/.exec(ref)
    if (!match) return /^#[0-9a-fA-F]{6,8}$/.test(ref) ? toRgbHex(ref) : '#000000'
    const slot = readNameplate().palette.slots.find((entry) => entry.id === match[1])
    if (!slot) return '#000000'
    const tone = match[2] ? Number(match[2]) : 0
    return toRgbHex(slot.ramp[Math.min(tone, slot.ramp.length - 1)] ?? '#000000')
}

function bodyRows(): number {
    const bodies = layerNodes().filter((node) => node.type === BODY_TYPE)
    const flagged = bodies.find((node) => node.fill?.kind === 'flag') ?? bodies[0]
    const padding: number[] = Array.isArray(flagged?.padding) ? flagged.padding : [0, 0, 0, 0]
    return FLAG_LIMITS.glyphHeight + (Number(padding[1]) || 0) + (Number(padding[3]) || 0)
}

function selectedFlag(flags: FlagData[]): FlagData | null {
    return flags.find((flag) => flag.id === handles.selected) ?? flags[0] ?? null
}

function freeFlagId(flags: FlagData[], base: string): string {
    const taken = new Set(flags.map((flag) => flag.id))
    return uniqueId(sanitizeId(base) || 'flag', (candidate) => taken.has(candidate))
}

function flagConfig(flag: FlagData, flags: FlagData[]): FormConfig {
    const flagOptions: Record<string, string> = {}
    for (const entry of flags) flagOptions[entry.id] = entry.id
    const bandRefs = flag.bands.map((band) => band.color)
    const overlayRefs = flag.overlay?.colors ?? []
    const tones = toneChoices([...bandRefs, ...overlayRefs])
    const down = flag.axis === 'columns'
    const config: FormConfig = {
        flag: { type: 'select', label: 'Flag', options: flagOptions },
        manage: {
            type: 'buttons',
            buttons: ['New flag...', 'Duplicate', 'Delete'],
            click: (index: number) => {
                if (index === 0) promptNewFlag()
                else if (index === 1) duplicateFlag()
                else deleteFlag()
            },
        },
        id: { type: 'text', label: 'ID', description: 'Lowercase letters, digits and _' },
        bands_title: heading(down ? 'Bands, left to right' : 'Bands, top to bottom'),
        axis: { type: 'select', label: 'Stripes run', options: AXIS_LABELS, description: 'Across stacks them. Down puts them side by side' },
        band_count: { type: 'number', label: 'Bands', step: 1, value: flag.bands.length },
    }
    for (let index = 0; index < flag.bands.length; index++) {
        config[`band_${index}_color`] = { type: 'select', label: `Band ${index + 1}`, options: tones }
        config[`band_${index}_weight`] = {
            type: 'number',
            label: `Band ${index + 1} size`,
            step: 1,
            value: 1,
            description: down ? 'Bigger numbers get more width' : 'Bigger numbers get more rows',
        }
    }
    Object.assign(config, {
        symmetric: { type: 'checkbox', label: 'Mirrored', style: 'toggle_switch', value: false, description: 'Needs sizes that read the same both ways' },
        overlay_title: heading('Shape on top'),
        overlay_kind: { type: 'select', label: 'Shape', options: OVERLAY_LABELS, value: 'none' },
    } as FormConfig)
    if (flag.overlay) {
        const [, most] = overlayColorRange(flag.overlay.kind)
        const count = Math.max(1, Math.min(most, flag.overlay.colors.length || 1))
        if (most > 1) {
            config.overlay_count = { type: 'number', label: 'Stripes', step: 1, value: count }
        }
        for (let index = 0; index < count; index++) {
            config[`overlay_${index}_color`] = { type: 'select', label: most > 1 ? `Stripe ${index + 1}` : 'Color', options: tones }
        }
        config.overlay_width = { type: 'number', label: 'Stripe width (px)', step: 1, value: 1 }
    }
    if (down) {
        Object.assign(config, {
            fit_title: heading('Width fit'),
            fit_columns: { type: 'number', label: 'Preview at width (px)', step: 1, value: PREVIEW_COLUMNS },
        } as FormConfig)
        if (Object.keys(flag.rowsOverride).length > 0) {
            config.override_kept = { type: 'info', text: 'Its hand-set rows are kept and come back if Stripes run is set to Across.' }
        }
    } else {
        Object.assign(config, {
            fit_title: heading('Row fit'),
            fit_rows: { type: 'number', label: 'Preview at rows', step: 1, value: bodyRows(), description: 'A one-line body is 8 rows plus its top and bottom padding' },
            override_on: { type: 'checkbox', label: 'Set rows by hand at this height', style: 'toggle_switch', value: false },
            override_rows: {
                type: 'text',
                label: 'Rows per band',
                placeholder: 'e.g. 3, 4, 3',
                condition: (result: Result) => !!result?.override_on,
                description: 'One number per band, top to bottom, adding up to the row count',
            },
        } as FormConfig)
    }
    Object.assign(config, {
        variants_title: heading('Variants'),
        variants_make: {
            type: 'buttons',
            buttons: ['Make a variant for each flag'],
            description: 'Adds a variant for every flag no variant shows yet, named after the flag',
            click: () => variantPerFlag(),
        },
    } as FormConfig)
    const plate = readNameplate()
    const choices: Record<string, string> = { '': 'First flag' }
    for (const entry of flags) choices[entry.id] = entry.id
    for (const key of Object.keys(plate.variants)) {
        config[`variant_${key}`] = { type: 'select', label: `Variant ${key}`, options: choices }
    }
    return config
}

function flagValues(flag: FlagData): Result {
    const values: Result = {
        flag: flag.id,
        id: flag.id,
        axis: flag.axis,
        band_count: flag.bands.length,
        symmetric: flag.symmetric,
        overlay_kind: flag.overlay?.kind ?? 'none',
        overlay_width: flag.overlay?.width ?? 1,
        overlay_count: Math.max(1, flag.overlay?.colors.length ?? 1),
        fit_rows: handles.rows,
        fit_columns: handles.columns,
    }
    flag.bands.forEach((band, index) => {
        values[`band_${index}_color`] = band.color
        values[`band_${index}_weight`] = band.weight
    })
    flag.overlay?.colors.forEach((color, index) => {
        values[`overlay_${index}_color`] = color
    })
    const override = flag.rowsOverride[String(handles.rows)]
    values.override_on = !!override
    values.override_rows = override ? override.join(', ') : ''
    const state = readFlags()
    for (const key of Object.keys(readNameplate().variants)) values[`variant_${key}`] = state.variants[key] ?? ''
    return values
}

function numberList(text: unknown): number[] {
    return String(text ?? '')
        .split(/[\s,]+/)
        .filter((part) => part.length > 0)
        .map((part) => Math.round(Number(part)))
        .filter((value) => isFinite(value))
}

function applyFlagChange(changed: string[], result: Result) {
    if (changed.includes('flag')) {
        handles.selected = String(result.flag ?? '')
        refreshFlags()
        return
    }
    if (changed.includes('fit_rows')) {
        handles.rows = limited(result.fit_rows, 1, MAX_FIT_ROWS, handles.rows, 'Preview at rows')
        handles.rowsProject = Project
        refreshFlags()
        return
    }
    if (changed.includes('fit_columns')) {
        handles.columns = limited(result.fit_columns, 1, MAX_FIT_COLUMNS, handles.columns, 'Preview at width (px)')
        refreshFlags()
        return
    }
    const keys = changed.filter((key) => !key.endsWith('_title') && key !== 'manage' && key !== 'variants_make' && key !== 'id')
    if (keys.length === 0) return
    commitFlags('Edit flag', (state) => {
        const flag = state.flags.find((entry) => entry.id === handles.selected) ?? state.flags[0]
        if (!flag) return
        for (const key of keys) {
            if (key.startsWith('variant_')) {
                const variant = key.slice('variant_'.length)
                const value = String(result[key] ?? '')
                if (value) state.variants[variant] = value
                else delete state.variants[variant]
                continue
            }
            applyFlagField(flag, key, result)
        }
    })
}

function wantedFlagId(text: unknown): string {
    return sanitizeId(String(text ?? '').trim())
}

function renameFlag(text: unknown) {
    const current = selectedFlag(readFlags().flags)
    const wanted = wantedFlagId(text)
    if (current && wanted && wanted !== current.id) {
        commitFlags('Rename flag', (state) => {
            const flag = state.flags.find((entry) => entry.id === current.id)
            if (!flag) return
            const next = freeFlagId(state.flags.filter((entry) => entry !== flag), wanted)
            for (const variant of Object.keys(state.variants)) if (state.variants[variant] === flag.id) state.variants[variant] = next
            flag.id = next
            handles.selected = next
        })
    }
    refreshFlags()
}

function bindIdInput(form: InputForm) {
    const input: HTMLInputElement | undefined = (form.form_data.id as any)?.input
    if (!input) return
    input.addEventListener('change', () => renameFlag(input.value))
    input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
            input.blur()
        } else if (event.key === 'Escape') {
            input.value = selectedFlag(readFlags().flags)?.id ?? ''
            input.blur()
            event.stopPropagation()
        }
    })
}

function applyFlagField(flag: FlagData, key: string, result: Result) {
    if (key === 'axis') {
        flag.axis = result.axis === 'columns' ? 'columns' : 'rows'
        return
    }
    if (key === 'band_count') {
        const count = limited(result.band_count, 1, FLAG_LIMITS.bands, flag.bands.length, 'Bands')
        while (flag.bands.length < count) flag.bands.push({ color: firstTones(flag.bands.length + 1)[flag.bands.length], weight: 1 })
        flag.bands.length = count
        return
    }
    const band = /^band_(\d+)_(color|weight)$/.exec(key)
    if (band) {
        const entry = flag.bands[Number(band[1])]
        if (!entry) return
        if (band[2] === 'color') entry.color = String(result[key] ?? entry.color)
        else entry.weight = limited(result[key], 1, FLAG_LIMITS.weight, entry.weight, `Band ${Number(band[1]) + 1} size`)
        return
    }
    if (key === 'symmetric') {
        flag.symmetric = !!result.symmetric
        return
    }
    if (key === 'overlay_kind') {
        const kind = String(result.overlay_kind)
        if (!OVERLAY_KINDS.includes(kind as any)) {
            flag.overlay = null
            return
        }
        const [, most] = overlayColorRange(kind as any)
        const colors = (flag.overlay?.colors.length ? flag.overlay.colors : firstTones(1)).slice(0, most)
        flag.overlay = { kind: kind as any, colors, width: flag.overlay?.width ?? 1 }
        return
    }
    if (!flag.overlay) {
        if (key === 'override_on' || key === 'override_rows') applyOverride(flag, result)
        return
    }
    if (key === 'overlay_count') {
        const [, most] = overlayColorRange(flag.overlay.kind)
        const count = limited(result.overlay_count, 1, most, flag.overlay.colors.length, 'Stripes')
        const colors = flag.overlay.colors.slice(0, count)
        while (colors.length < count) colors.push(firstTones(colors.length + 1)[colors.length])
        flag.overlay.colors = colors
        return
    }
    const stripe = /^overlay_(\d+)_color$/.exec(key)
    if (stripe) {
        const index = Number(stripe[1])
        if (index < flag.overlay.colors.length || index === 0) flag.overlay.colors[index] = String(result[key] ?? '')
        return
    }
    if (key === 'overlay_width') {
        flag.overlay.width = limited(result.overlay_width, 1, FLAG_LIMITS.overlayWidth, flag.overlay.width, 'Stripe width (px)')
        return
    }
    if (key === 'override_on' || key === 'override_rows') applyOverride(flag, result)
}

function applyOverride(flag: FlagData, result: Result) {
    const rows = String(handles.rows)
    if (!result.override_on) {
        delete flag.rowsOverride[rows]
        return
    }
    const typed = numberList(result.override_rows)
    if (typed.length > 0) {
        flag.rowsOverride[rows] = typed
        return
    }
    const fitted = fittedRows(flag.bands.map((band) => band.weight), handles.rows, flag.symmetric, {})
    flag.rowsOverride[rows] = fitted ?? flag.bands.map(() => 1)
}

function newFlag(flags: FlagData[], preset: string): FlagData {
    const entry = PRESETS[preset] ?? PRESETS.three
    const tones = firstTones(entry.weights.length + 1)
    return {
        id: freeFlagId(flags, 'flag'),
        bands: entry.weights.map((weight, index) => ({ color: tones[index], weight })),
        overlay: entry.overlay ? { kind: entry.overlay.kind, colors: [tones[entry.weights.length]], width: entry.overlay.width } : null,
        rowsOverride: {},
        symmetric: !!entry.symmetric,
        axis: entry.axis ?? 'rows',
    }
}

export function addFlag(preset: string): string | null {
    let created: string | null = null
    commitFlags('Add flag', (state) => {
        if (state.flags.length >= FLAG_LIMITS.flags) return
        const flag = newFlag(state.flags, preset)
        state.flags.push(flag)
        created = flag.id
    })
    if (created) handles.selected = created
    refreshFlags()
    return created
}

export function promptNewFlag() {
    const options: Record<string, string> = {}
    for (const [key, entry] of Object.entries(PRESETS)) options[key] = entry.label
    new Dialog({
        id: NEW_DIALOG,
        title: 'New Flag',
        width: 420,
        form: {
            intro: { type: 'info', text: 'Change the colors after.' },
            preset: { type: 'select', label: 'Start with', options, value: 'three' },
            fill: { type: 'checkbox', label: 'Fill the first body with flags', style: 'toggle_switch', value: true },
        },
        onConfirm(result: any) {
            const id = addFlag(String(result.preset))
            if (id && result.fill) fillFirstBody()
        },
    } as any).show()
}

function fillFirstBody() {
    const body = layerNodes().find((node) => node.type === BODY_TYPE)
    if (!body || body.fill?.kind === 'flag') return
    undoEdit({ elements: [body] }, 'Fill body with flag', () => {
        body.fill = { kind: 'flag' }
    })
}

function duplicateFlag() {
    commitFlags('Duplicate flag', (state) => {
        const flag = state.flags.find((entry) => entry.id === handles.selected) ?? state.flags[0]
        if (!flag || state.flags.length >= FLAG_LIMITS.flags) return
        const copy: FlagData = cloneJson(flag)
        copy.id = freeFlagId(state.flags, flag.id)
        state.flags.push(copy)
        handles.selected = copy.id
    })
    refreshFlags()
}

function shownFlags(plate: NameplateData, variants: Record<string, string>, flags: FlagData[]): Set<string> {
    const shown = new Set<string>()
    for (const key of Object.keys(plate.variants)) {
        const flag = variants[key]
        if (flag && flags.some((entry) => entry.id === flag)) shown.add(flag)
        else if (flags[0]) shown.add(flags[0].id)
    }
    return shown
}

function variantPerFlag(): string[] {
    if (!hasProject()) return []
    const plate = readNameplate()
    const state = readFlags()
    const shown = shownFlags(plate, state.variants, state.flags)
    const missing = state.flags.filter((flag) => !shown.has(flag.id))
    if (!missing.length) {
        Blockbench.showQuickMessage('Every flag already has a variant', 1500)
        return []
    }
    const created = editDoc(
        ['nameplate', 'flags'],
        { label: (keys: string[]) => (keys.length === 1 ? 'Make a variant for a flag' : 'Make a variant for each flag') },
        ({ nameplate, flags }) => {
            const keys: string[] = []
            for (const flag of missing) {
                const key = addVariantLike(nameplate, flag.id, (base) => base?.palette ?? Object.keys(nameplate.palette.colorways)[0])
                flags.variants[key] = flag.id
                keys.push(key)
            }
            return keys
        },
    ) ?? []
    Blockbench.showQuickMessage(`Added ${created.length === 1 ? 'variant' : 'variants'} ${created.join(', ')}. Pick one in the Variant list above the preview`, 2500)
    return created
}

function deleteFlag() {
    commitFlags('Delete flag', (state) => {
        const index = state.flags.findIndex((entry) => entry.id === handles.selected)
        const at = index >= 0 ? index : 0
        const removed = state.flags[at]
        if (!removed) return
        state.flags.splice(at, 1)
        for (const variant of Object.keys(state.variants)) if (state.variants[variant] === removed.id) delete state.variants[variant]
        handles.selected = state.flags[Math.max(0, at - 1)]?.id ?? ''
    })
    refreshFlags()
}

function drawPreview(flag: FlagData | null) {
    const canvas = handles.canvas
    if (!canvas) return
    const rows = Math.max(1, handles.rows)
    const down = flag?.axis === 'columns'
    const columns = down ? Math.max(1, handles.columns) : PREVIEW_COLUMNS
    canvas.width = columns * PREVIEW_SCALE
    canvas.height = rows * PREVIEW_SCALE
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (!flag || flag.bands.length === 0) {
        flagsUi.fitText = ''
        return
    }
    const weights = flag.bands.map((band) => band.weight)
    const fit = down ? fittedRows(weights, columns, flag.symmetric, {}) : fittedRows(weights, rows, flag.symmetric, flag.rowsOverride)
    if (!fit && !down) {
        flagsUi.fitText = `${flag.bands.length} bands need at least ${flag.bands.length} rows. This height has ${rows}.`
        return
    }
    const fitted = fit ?? flag.bands.map((_, index) => (index === 0 ? columns : 0))
    const byHand = !!flag.rowsOverride[String(rows)]
    if (down) {
        flagsUi.fitText = `${fit ? `At ${columns} px: ${fit.join(', ')}.` : `At ${columns} px only the first band fits.`} A body narrower than ${flag.bands.length} px shows only the first band.`
    } else {
        flagsUi.fitText = `At ${rows} rows: ${fitted.join(', ')}${byHand ? ' (set by hand)' : ''}`
    }
    const bandColors = flag.bands.map((band) => resolveColor(band.color))
    const overlay = flag.overlay
    const overlayColors = overlay?.colors.map(resolveColor) ?? []
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const band = bandColors[bandAt(fitted, down ? column : row)]
            let color = band
            if (overlay && (overlay.kind === 'chevron' || overlay.kind === 'triangle')) {
                const stripe = chevronStripe(column, row, rows, overlay.width, overlayColors.length)
                if (stripe >= 0) color = overlayColors[stripe] ?? color
            } else if (overlay && overlay.kind === 'circle') {
                const part = circlePart(column, row, columns, rows, overlay.width)
                if (part === 0) color = overlayColors[0] ?? color
                else if (part === 1 && overlayColors.length > 1) color = overlayColors[1]
            }
            context.fillStyle = color
            context.fillRect(column * PREVIEW_SCALE, row * PREVIEW_SCALE, PREVIEW_SCALE, PREVIEW_SCALE)
        }
    }
}

function showState() {
    if (handles.empty) handles.empty.style.display = flagsUi.hasProject && flagsUi.count === 0 ? '' : 'none'
    if (handles.note) handles.note.style.display = flagsUi.count > 0 ? '' : 'none'
    if (handles.fit) handles.fit.textContent = flagsUi.fitText
}

function refreshFlags() {
    try {
        flagsUi.hasProject = hasProject()
        const state = flagsUi.hasProject ? readFlags() : { flags: [], variants: {} }
        flagsUi.count = state.flags.length
        if (!flagsUi.hasProject || handles.rowsProject !== Project) handles.rows = flagsUi.hasProject ? bodyRows() : FLAG_LIMITS.glyphHeight
        const flag = selectedFlag(state.flags)
        handles.selected = flag?.id ?? ''
        if (!flag || !handles.host) {
            formHost.clear()
            drawPreview(null)
            showState()
            return
        }
        const config = flagConfig(flag, state.flags)
        const form = formHost.show(handles.host, config, {}, applyFlagChange, bindIdInput)
        form.setValues(flagValues(flag), false)
        form.update(form.getResult())
        drawPreview(flag)
        showState()
    } catch (error) {
        console.error('[polyplus_nameplate] flag panel refresh failed', error)
    }
}

export function mountFlagsEditor(container: HTMLElement): () => void {
    formHost.clear()
    const root = element('div', 'np-flags-panel', container)
    const empty = element('div', 'np-panel-empty', root)
    element('p', '', empty).textContent = 'No flags yet.'
    const actions = element('div', 'np-empty-actions', empty)
    const add = element('button', '', actions)
    add.type = 'button'
    const icon = element('i', 'material-icons notranslate icon', add)
    icon.textContent = 'flag'
    add.appendChild(document.createTextNode(' Add flag'))
    add.addEventListener('click', () => promptNewFlag())
    const note = element('div', 'np-panel-note', root)
    const canvas = element('canvas', '', note)
    canvas.style.imageRendering = 'pixelated'
    canvas.style.display = 'block'
    canvas.style.maxWidth = '100%'
    const fit = element('span', 'np-subtle', note)
    const host = element('div', 'np-layer-form', root)
    Object.assign(handles, { host, canvas, empty, note, fit })
    refreshFlags()
    return () => {
        if (handles.host !== host) return
        formHost.clear()
        root.remove()
        Object.assign(handles, { host: null, canvas: null, empty: null, note: null, fit: null })
    }
}

export function registerFlagsPanel(): () => void {
    const listeners = EVENTS.map((name) => Blockbench.on(name as any, () => refreshFlags()))
    const removers = [onFlagsChanged(refreshFlags), onNameplateChanged(refreshFlags), onShownColorway(refreshFlags)]
    refreshFlags()
    return () => {
        for (const listener of listeners) listener.delete()
        for (const remove of removers) remove()
        formHost.clear()
        handles.host?.parentElement?.remove()
        Object.assign(handles, { host: null, canvas: null, empty: null, note: null, fit: null })
    }
}

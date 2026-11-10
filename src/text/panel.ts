import { NameplateData } from '../model'
import { selectInspectorTarget } from '../inspector/selection'
import { commit, onNameplateChanged, readNameplate } from '../palette/state'
import { onShownColorway } from '../palette/tones'
import { onPreviewResult, previewUi, redraw } from '../preview'
import { rgbHex } from '../palette/color'
import {
    applyBadgeKeys,
    applyTextKeys,
    badgeConfig,
    badgeValues,
    FormConfig,
    isDebounced,
    Result,
    textConfig,
    textValues,
} from './form'
import { openLetterProgram } from './program'
import { currentFps, loopFrames } from '../animate/dialog'
import { element } from '../util/dom'
import { createFormHost } from '../util/formHost'
import { hardToRead } from './readability'
import { resolveStyle, shownPreview, shownVariant } from './style'
import { BadgeSettings, defaultBadge, defaultText, NEAR_BLACK, plateBadge, plateText, TextSettings, variantBadge, variantText, WHITE } from './types'
import { cloneJson, sameSerialized } from '../util/json'
import { defineFormatAction } from '../util/actions'
import { hasProject } from '../util/project'

export const TEXT_PANEL = 'polyplus_nameplate_text'
export const TEXT_ACTION = 'polyplus_nameplate_text_badge'
const EVERY = ''
const DEBOUNCE_MS = 350
const EVENTS = ['select_project', 'finished_edit', 'undo', 'redo', 'select_mode']

type TextPart = 'name' | 'badge'

interface Preset {
    label: string
    text?: Partial<TextSettings>
    badge?: Partial<BadgeSettings>
}

const PRESETS: Record<string, Preset> = {
    readable: { label: 'Name: readable on any color', text: { color: 'auto', shadow: 'auto', outline: 'auto' } },
    game: { label: 'Name: as the game draws it', text: { color: 'none', shadow: 'none', outline: 'none', formatting: 'adjust' } },
    palette_shadow: { label: 'Name: palette color with a shadow when needed', text: { shadow: 'auto', outline: 'none' } },
    outlined: { label: 'Name: always outlined', text: { color: WHITE, shadow: 'none', outline: NEAR_BLACK } },
    badge_default: { label: 'Badge: before the name, as it is', badge: defaultBadge() },
    badge_corner: { label: 'Badge: pinned to the top right corner', badge: { placement: 'placed', anchor: 'top_right', offset: [0, 0], of: null, follow: null, at: null, decoration: 'auto', decorationColor: null } },
    badge_match: { label: 'Badge: palette color with an auto edge', badge: { decoration: 'auto', decorationColor: null } },
}

const handles: {
    host: HTMLElement | null
    note: HTMLElement | null
    part: TextPart
    action: Action | null
    scope: string
    timer: ReturnType<typeof setTimeout> | null
    pending: { keys: Set<string>, result: Result } | null
} = { host: null, note: null, part: 'name', action: null, scope: EVERY, timer: null, pending: null }

const formHost = createFormHost('text')

function scopeOf(plate: NameplateData): string {
    return handles.scope && handles.scope in plate.variants ? handles.scope : EVERY
}

function firstPaletteTone(plate: NameplateData): string {
    const slot = plate.palette.slots[plate.palette.slots.length - 1] ?? plate.palette.slots[0]
    if (!slot) return WHITE
    const tone = slot.ramp.length - 1
    return tone > 0 ? `${slot.id}[${tone}]` : slot.id
}

function presetOptions(part: TextPart): Record<string, string> {
    const options: Record<string, string> = { '': 'Pick one to start from...' }
    for (const key of Object.keys(PRESETS)) {
        if (part === 'name' ? PRESETS[key].text : PRESETS[key].badge) options[key] = PRESETS[key].label
    }
    return options
}

function styleFor(plate: NameplateData, scope: string) {
    const inherit = scope !== EVERY
    const variant: any = inherit ? plate.variants[scope] : null
    return {
        inherit,
        variant,
        text: inherit ? variantText(plate as any, variant) : plateText(plate as any),
        badge: inherit ? variantBadge(plate as any, variant) : plateBadge(plate as any),
    }
}

function panelConfig(plate: NameplateData, scope: string, part: TextPart): FormConfig {
    const scopes: Record<string, string> = { [EVERY]: 'Every variant' }
    for (const key of Object.keys(plate.variants)) scopes[key] = `Only variant ${key}`
    const { inherit, variant, text, badge } = styleFor(plate, scope)
    return {
        scope: { type: 'select', label: 'Change', options: scopes, description: 'Pick a variant to give it its own text and badge' },
        preset: { type: 'select', label: 'Presets', options: presetOptions(part) },
        ...(part === 'name'
            ? textConfig(text, variant?.text ?? null, { inherit, editProgram: editLetterProgram, inheritedMode: plateText(plate as any).mode })
            : badgeConfig(badge, variant?.badge ?? null, { inherit })),
    }
}

function panelValues(plate: NameplateData, scope: string, part: TextPart): Result {
    const { inherit, variant, text, badge } = styleFor(plate, scope)
    return {
        scope,
        preset: '',
        ...(part === 'name' ? textValues(text, variant?.text ?? null, inherit) : badgeValues(badge, variant?.badge ?? null, inherit)),
    }
}

function targets(plate: NameplateData, scope: string): { text: Record<string, any>, badge: Record<string, any>, effectiveBadge: BadgeSettings } {
    const p = plate as any
    if (scope === EVERY) {
        p.text = plateText(p)
        p.badge = plateBadge(p)
        return { text: p.text, badge: p.badge, effectiveBadge: p.badge }
    }
    const variant: any = plate.variants[scope]
    variant.text = { ...(variant.text ?? {}) }
    variant.badge = { ...(variant.badge ?? {}) }
    return { text: variant.text, badge: variant.badge, effectiveBadge: variantBadge(p, variant) }
}

function tidy(plate: NameplateData) {
    const p = plate as any
    if (p.text && sameSerialized(p.text, defaultText())) delete p.text
    if (p.badge && sameSerialized(p.badge, defaultBadge())) delete p.badge
    for (const variant of Object.values<any>(plate.variants)) {
        if (variant.text && !Object.keys(variant.text).length) delete variant.text
        if (variant.badge && !Object.keys(variant.badge).length) delete variant.badge
    }
}

export function editStyle(label: string, scope: string, change: (text: Record<string, any>, badge: Record<string, any>, effectiveBadge: BadgeSettings, plate: NameplateData) => void): boolean {
    return commit(label, (plate) => {
        const target = targets(plate, scope in plate.variants ? scope : EVERY)
        change(target.text, target.badge, target.effectiveBadge, plate)
        tidy(plate)
    })
}

export function applyPreset(key: string, scope = EVERY): boolean {
    const preset = PRESETS[key]
    if (!preset) return false
    return editStyle(`Apply text preset: ${preset.label}`, scope, (text, badge, _effective, plate) => {
        if (preset.text) Object.assign(text, cloneJson(preset.text))
        if (key === 'palette_shadow') text.color = firstPaletteTone(plate)
        if (preset.badge) Object.assign(badge, cloneJson(preset.badge))
        if (key === 'badge_match') badge.tint = firstPaletteTone(plate)
        if (scope !== EVERY && key === 'badge_default') {
            for (const field of Object.keys(badge)) delete badge[field]
        }
    })
}

function editLetterProgram() {
    flushPending()
    const plate = readNameplate()
    const scope = scopeOf(plate)
    const { inherit, text } = styleFor(plate, scope)
    const fps = currentFps()
    openLetterProgram({
        mode: text.mode,
        source: text.motion ?? '',
        fps,
        length: loopFrames(fps),
        reaction: false,
        variant: inherit ? scope : undefined,
        switchMode: true,
        save: (source, mode) => {
            editStyle(inherit ? `Edit letter formula of variant ${scope}` : 'Edit letter formula', scope, (target) => {
                target.motion = source
                if (mode) target.mode = mode
            })
            refreshText()
        },
    })
}

function textLabel(key: string, scope: string): string {
    const part = key.startsWith('bs_') ? 'badge' : 'name text'
    return scope === EVERY ? `Edit ${part}` : `Edit ${part} of variant ${scope}`
}

function applyPanelChange(keys: string[], result: Result) {
    if (keys.includes('scope')) {
        handles.scope = String(result.scope ?? EVERY)
        if (handles.scope && handles.scope in readNameplate().variants) {
            previewUi.variant = handles.scope
            redraw(false)
        }
        refreshText()
        return
    }
    if (keys.includes('preset')) {
        const preset = String(result.preset ?? '')
        if (preset) applyPreset(preset, handles.scope)
        refreshText()
        return
    }
    const textKeys = keys.filter((key) => key.startsWith('ts_') && !key.endsWith('_title') && !key.endsWith('_edit'))
    const badgeKeys = keys.filter((key) => key.startsWith('bs_') && !key.endsWith('_title'))
    if (!textKeys.length && !badgeKeys.length) return
    const scope = handles.scope
    const inherit = scope !== EVERY
    editStyle(textLabel(textKeys[0] ?? badgeKeys[0], scope), scope, (text, badge, effective) => {
        applyTextKeys(text, textKeys, result, inherit)
        applyBadgeKeys(badge, badgeKeys, result, inherit, effective)
    })
}

function flushPending() {
    if (handles.timer) clearTimeout(handles.timer)
    handles.timer = null
    const pending = handles.pending
    handles.pending = null
    if (pending) applyPanelChange(Array.from(pending.keys), pending.result)
}

function onFormChange(keys: string[], result: Result) {
    const debounced = keys.filter(isDebounced)
    const direct = keys.filter((key) => !isDebounced(key))
    if (debounced.length) {
        if (!handles.pending) handles.pending = { keys: new Set(), result }
        for (const key of debounced) handles.pending.keys.add(key)
        handles.pending.result = result
        if (handles.timer) clearTimeout(handles.timer)
        handles.timer = setTimeout(flushPending, DEBOUNCE_MS)
    }
    if (direct.length) {
        flushPending()
        applyPanelChange(direct, result)
    }
}

function ratioText(value: number): string {
    return `${Math.round(value * 10) / 10}:1`
}

function scopeHint(plate: NameplateData, key: string, part: TextPart): string[] {
    if (scopeOf(plate) !== EVERY) return []
    const variant: any = plate.variants[key]
    const own = part === 'badge' ? variant?.badge : variant?.text
    if (!own || Object.keys(own).length === 0) return []
    return [`Variant ${key} has its own ${part === 'badge' ? 'badge' : 'name text'} settings. Pick "Only variant ${key}" under Change to edit them.`]
}

function readout(plate: NameplateData, part: TextPart): string[] {
    return [...styleLines(plate, part), ...scopeHint(plate, shownVariant(plate), part)]
}

function styleLines(plate: NameplateData, part: TextPart): string[] {
    const key = shownVariant(plate)
    const style = resolveStyle(plate, key)
    const text = style.resolvedText
    const lines: string[] = []
    if (part === 'badge') {
        const badge = style.resolvedBadge
        if (style.badgePixels) {
            const edge = badge.decoration === 'none' ? 'no edge' : `${badge.decoration === 'outline' ? 'an outline' : 'a shadow'} in ${rgbHex(badge.decorationRgb)}`
            const forced = badge.forced ? ' The game adds the outline itself, since the badge is hard to see there.' : ''
            lines.push(`Variant ${key}: the badge has a worst contrast of ${ratioText(badge.minRatio)}, drawn with ${edge}.${forced}`)
        } else {
            lines.push(`Variant ${key}: the badge is drawn as in the game.`)
        }
        return lines
    }
    const color = text.color === null ? 'white' : rgbHex(text.color)
    if (!style.namePixels && !shownPreview()) {
        lines.push(`Variant ${key}: the contrast of the name shows once the preview has drawn the nameplate.`)
    } else if (!style.namePixels) {
        lines.push(`Variant ${key}: nothing is drawn behind the name, so it reads as in the game.`)
    } else {
        const flagged = hardToRead(shownPreview())
        const verdict = flagged === null ? '' : flagged.has(key)
            ? ' The game warns that it can be hard to read. The warning is in Checks.'
            : ' The game finds it readable.'
        lines.push(`Variant ${key}: the name in ${color} has a worst contrast of ${ratioText(text.minRatio)} over the loop at this name width.${verdict}`)
    }
    if (text.outline !== null) lines.push(`It gets an outline in ${rgbHex(text.outline)}.`)
    else if (text.shadowUse === 'always' && text.shadow !== null) lines.push(`It gets a shadow in ${rgbHex(text.shadow)}.`)
    return lines
}

function showLines(lines: string[]) {
    const note = handles.note
    if (!note) return
    note.textContent = ''
    for (const line of lines) {
        element('span', 'np-subtle', note, line).style.display = 'block'
    }
    note.style.display = lines.length ? '' : 'none'
}

function refreshReadout() {
    try {
        if (!hasProject() || !handles.host) return
        showLines(readout(readNameplate(), handles.part))
    } catch (error) {
        console.error('[polyplus_nameplate] text readout failed', error)
    }
}

function refreshText() {
    try {
        if (!hasProject() || !handles.host) {
            formHost.clear()
            showLines([])
            return
        }
        const plate = readNameplate()
        const scope = scopeOf(plate)
        const part = handles.part
        handles.scope = scope
        showLines(readout(plate, part))
        const config = panelConfig(plate, scope, part)
        const form = formHost.show(handles.host, config, { scope, part }, onFormChange)
        if (handles.pending) return
        const values = panelValues(plate, scope, part)
        if (String(form.getResult().ts_motion ?? '').trim() === values.ts_motion) delete values.ts_motion
        form.setValues(values, false)
        form.update(form.getResult())
    } catch (error) {
        console.error('[polyplus_nameplate] text panel refresh failed', error)
    }
}

export function openTextPanel(variant?: string, part: TextPart = 'name') {
    if (variant !== undefined) handles.scope = variant
    selectInspectorTarget(part)
    refreshText()
}

export function mountTextEditor(container: HTMLElement, part: TextPart): () => void {
    flushPending()
    formHost.clear()
    const note = element('div', 'np-panel-note', container)
    const host = element('div', 'np-layer-form', container)
    handles.note = note
    handles.host = host
    handles.part = part
    refreshText()
    redraw(false)
    refreshReadout()
    return () => {
        if (handles.host !== host) return
        flushPending()
        formHost.clear()
        note.remove()
        host.remove()
        handles.note = null
        handles.host = null
    }
}

export function registerTextPanel(): () => void {
    handles.action = defineFormatAction(TEXT_ACTION, {
        name: 'Name Text',
        description: 'Show the name color, shadow, outline and contrast in the Inspector',
        icon: 'format_color_text',
        click: () => openTextPanel(),
    })
    const listeners = EVENTS.map((name) => Blockbench.on(name as any, () => refreshText()))
    const removers = [onNameplateChanged(refreshText), onShownColorway(refreshText), onPreviewResult(refreshReadout)]
    refreshText()
    return () => {
        flushPending()
        for (const listener of listeners) listener.delete()
        for (const remove of removers) remove()
        formHost.clear()
        handles.action?.delete()
        handles.action = null
        handles.note?.remove()
        handles.host?.remove()
        handles.note = null
        handles.host = null
    }
}

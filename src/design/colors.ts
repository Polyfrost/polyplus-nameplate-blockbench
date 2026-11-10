import { getBrush, onBrushChange, setBrush } from '../brush'
import { layerNodes } from '../elements/nodes'
import { readFlags } from '../flags/state'
import { isNameplateActive } from '../format'
import { readMaterials } from '../material/state'
import { BODY_TYPE, FORMAT_ID, NameplateData, Slot } from '../model'
import { addVariantLike } from '../util/variants'
import { confirmBox } from '../util/dialogs'
import { quotedList } from '../util/text'
import { setStripToolbar } from '../colors/host'
import { cssColor, normalizeHex, paletteHex, pickerHex, toArgbKey } from '../palette/color'
import { endColorwayPreview, mainColorway, previewColorway, startColorwayPreview, withColorwayPreview } from '../palette/colorway'
import { limited } from '../elements/limits'
import { MAX_TONES, sanitizeId, slotIdFrom, uniqueId } from '../palette/ids'
import { suggestRamp } from '../palette/ramp'
import { MIN_STOPS, SlotBlend, blendOf, blendTones, canBlend, defaultBlendTones, setBlend } from '../palette/blend'
import { ShadeMove, emptyReport, insertionMove, moveBodyRefs, moveFlagRefs, moveGraphRefs, movePlateRefs, removalMove, reorderMove, resizeMove } from '../palette/refs'
import { commitShades } from '../palette/shades'
import { openSavePaletteDialog } from '../library/dialogs'
import { commit, onNameplateChanged, readNameplate } from '../palette/state'
import { setShownColorway } from '../palette/tones'
import { onPreviewResult, previewUi, redraw, setPreviewOverride } from '../preview'
import { onLight, pictureVersion, refreshLight } from './events'
import { openSlotMolangEditor } from '../molang/editor'
import { focusSlot } from '../palanim/edit'
import { openSweepDialog } from '../palanim/sweep'
import { describeMotion, parseColorRef } from '../palanim/types'
import { pluginToolbar } from '../toolbar'
import { hasProject } from '../util/project'
import { defineFormatAction } from '../util/actions'
import { disposeAll, dropToolbar } from '../util/teardown'

const COLORS_TOOLBAR = 'polyplus_nameplate_colors'
const COLORWAY_SELECT = 'polyplus_nameplate_colorway'
const NEW_COLORWAY = '+new'
const PAINT_PANEL = 'uv'
const DEFAULT_SHADES = 3
const NEW_COLOR = '#7F8FA6'
const PASTE_NOTE_MS = 5000

export interface SlotView {
    index: number
    id: string
    name: string
    ramp: string[]
    main: string[]
    inherited: boolean
    animated: boolean
    motion: string
    blend: { tones: number, stops: string[] } | null
    used: boolean[]
}

interface ColorsUi {
    hasProject: boolean
    colorway: string
    first: boolean
    unused: boolean
    slots: SlotView[]
    brush: string
}

export const colorsUi: ColorsUi = { hasProject: false, colorway: '', first: true, unused: false, slots: [], brush: getBrush() }

const handles: { toolbar: Toolbar | null, items: BarItem[], removers: Array<() => void> } = {
    toolbar: null,
    items: [],
    removers: [],
}

const followed = { variant: '', key: '' }

function colorwayNames(plate: NameplateData): string[] {
    return Object.keys(plate.palette.colorways)
}

function usedColorways(plate: NameplateData): Set<string> {
    return new Set(Object.values(plate.variants).map((variant) => variant.palette))
}

function unusedColorways(plate: NameplateData = readNameplate()): string[] {
    const used = usedColorways(plate)
    return colorwayNames(plate).filter((name) => !used.has(name))
}

function hexOf(value: unknown): string {
    const picked = pickerHex(value)
    if (picked) return picked
    return NEW_COLOR
}

function blendView(slot: Slot, colorway: string): { tones: number, stops: string[] } | null {
    const blend = blendOf(slot)
    if (!blend) return null
    const stops = (colorway ? blend.colorways[colorway] : undefined) ?? blend.stops
    return { tones: blend.tones, stops: stops.map((stop) => paletteHex(stop)) }
}

const paintedCache = new WeakMap<object, { epoch: number, width: number, height: number, colors: Set<number> }>()

function paintedColors(): Set<number> {
    const colors = new Set<number>()
    const epoch = pictureVersion()
    for (const texture of Texture.all) {
        const { width, height } = texture.canvas ?? {}
        if (!width || !height || !texture.ctx) continue
        let cached = paintedCache.get(texture)
        if (!cached || cached.epoch !== epoch || cached.width !== width || cached.height !== height) {
            const found = new Set<number>()
            const { data } = texture.ctx.getImageData(0, 0, width, height)
            for (let at = 0; at < data.length; at += 4) {
                if (data[at + 3]) found.add(((data[at + 3] << 24) | (data[at] << 16) | (data[at + 1] << 8) | data[at + 2]) >>> 0)
            }
            cached = { epoch, width, height, colors: found }
            paintedCache.set(texture, cached)
        }
        for (const color of cached.colors) colors.add(color)
    }
    return colors
}

function shadesInUse(plate: NameplateData): (slot: Slot) => Set<number> {
    if (!isNameplateActive()) return () => new Set()
    const bodies = layerNodes().filter((node) => node.type === BODY_TYPE)
    const flags = readFlags()
    const graphs = readMaterials().graphs as any
    const painted = paintedColors()
    return (slot) => {
        const used = new Set<number>()
        const shades = slot.ramp.length
        const probe: ShadeMove = {
            slot: slot.id,
            name: slot.name,
            before: shades,
            after: shades,
            toNew: (tone) => {
                used.add(tone)
                return tone
            },
            fromNew: (tone) => tone,
            removed: [],
        }
        const report = emptyReport()
        movePlateRefs(plate, probe, report)
        moveFlagRefs(flags, probe, report)
        moveGraphRefs(graphs, probe, report)
        for (const node of bodies) {
            moveBodyRefs(node, probe, report)
            if ([node.fill, ...(node.rings ?? [])].some((fill: any) => fill?.slot === slot.id)) slot.ramp.forEach((_, tone) => used.add(tone))
        }
        slot.ramp.forEach((color, tone) => {
            const key = toArgbKey(color)
            if (key && painted.has(parseInt(key, 16))) used.add(tone)
        })
        return used
    }
}

function followVariant(plate: NameplateData, names: string[]): boolean {
    const palette = plate.variants[previewUi.variant]?.palette
    const project = colorsUi.hasProject ? String((Project as any).uuid ?? '') : ''
    const key = `${project}|${previewUi.variant}|${palette}`
    const changed = key !== followed.key
    followed.key = key
    followed.variant = previewUi.variant
    if (!palette || !names.includes(palette) || palette === colorsUi.colorway) return false
    if (!changed && names.includes(colorsUi.colorway)) return false
    colorsUi.colorway = palette
    endColorwayPreview()
    syncColorwayPreview()
    return true
}

function refreshColors() {
    try {
        colorsUi.hasProject = hasProject()
        const plate = readNameplate()
        const names = colorwayNames(plate)
        const moved = followVariant(plate, names)
        if (!names.includes(colorsUi.colorway)) colorsUi.colorway = names[0] ?? ''
        setShownColorway(colorsUi.colorway)
        colorsUi.first = colorsUi.colorway === mainColorway(plate.palette)
        colorsUi.unused = !!colorsUi.colorway && !usedColorways(plate).has(colorsUi.colorway)
        const overrides = plate.palette.colorways[colorsUi.colorway] ?? {}
        const inUse = shadesInUse(plate)
        colorsUi.slots = plate.palette.slots.map((slot, index) => {
            const override = colorsUi.first ? undefined : overrides[slot.id]
            const ramp = (override ?? slot.ramp).map((tone) => paletteHex(tone))
            const used = inUse(slot)
            return {
                index,
                id: slot.id,
                name: slot.name,
                ramp,
                main: slot.ramp.map((tone) => paletteHex(tone)),
                inherited: !colorsUi.first && !override,
                animated: !!slot.animation,
                motion: describeMotion(slot.animation),
                blend: blendView(slot, override ? colorsUi.colorway : ''),
                used: ramp.map((_, tone) => used.has(tone)),
            }
        })
        colorsUi.brush = getBrush()
        const select = (BarItems as any)[COLORWAY_SELECT] as BarSelect | undefined
        if (select) {
            const options: Record<string, string | { name: string, icon: string }> = {}
            for (const name of names) options[name] = name
            options[NEW_COLORWAY] = { name: 'New colorway...', icon: 'add' }
            select.options = options
            select.values = names
            select.set(colorsUi.colorway)
        }
        if (moved) refreshLight()
    } catch (error) {
        console.error('[polyplus_nameplate] colors refresh failed', error)
    }
}

function editingMain(plate: NameplateData): boolean {
    return colorsUi.colorway === mainColorway(plate.palette) || !plate.palette.colorways[colorsUi.colorway]
}

function editableRamp(plate: NameplateData, index: number): string[] | undefined {
    const slot = plate.palette.slots[index]
    if (!slot) return undefined
    if (editingMain(plate)) return slot.ramp
    const overrides = plate.palette.colorways[colorsUi.colorway]
    if (!overrides[slot.id]) overrides[slot.id] = slot.ramp.slice()
    return overrides[slot.id]
}

function eachOverride(plate: NameplateData, index: number, change: (ramp: string[]) => void) {
    const id = plate.palette.slots[index]?.id
    if (!id || !editingMain(plate)) return
    for (const name of colorwayNames(plate)) {
        const ramp = plate.palette.colorways[name][id]
        if (ramp) change(ramp)
    }
}

function mainMove(plate: NameplateData, index: number, make: (slot: Slot) => ShadeMove): ShadeMove | null {
    const slot = plate.palette.slots[index]
    return slot && editingMain(plate) ? make(slot) : null
}

interface EntryEdit {
    allowed(list: unknown[], minimum: number): boolean
    apply(list: any[]): void
    shadeMove(slot: Slot): ShadeMove
    blockedByBlend: boolean
    overrides: boolean
    repaint: boolean
}

function inRange(list: unknown[], index: number): boolean {
    return index >= 0 && index < list.length
}

function setEdit(index: number, value: string): EntryEdit {
    return {
        allowed: (list) => inRange(list, index),
        apply: (list) => {
            list[index] = hexOf(value)
        },
        shadeMove: (slot) => resizeMove(slot, slot.ramp.length, slot.ramp.length),
        blockedByBlend: false,
        overrides: false,
        repaint: true,
    }
}

function removeEdit(index: number): EntryEdit {
    return {
        allowed: (list, minimum) => list.length > minimum && inRange(list, index),
        apply: (list) => {
            list.splice(index, 1)
        },
        shadeMove: (slot) => removalMove(slot, index),
        blockedByBlend: true,
        overrides: true,
        repaint: true,
    }
}

function moveEdit(index: number, direction: number): EntryEdit {
    const target = index + direction
    return {
        allowed: (list) => inRange(list, index) && inRange(list, target),
        apply: (list) => relocate(list, index, target),
        shadeMove: (slot) => {
            const order = slot.ramp.map((_, position) => position)
            relocate(order, index, target)
            return reorderMove(slot, order)
        },
        blockedByBlend: true,
        overrides: true,
        repaint: false,
    }
}

function editShade(slot: number, label: string, edit: EntryEdit) {
    commitShades(label, (plate) => {
        if (edit.blockedByBlend && blendOf(plate.palette.slots[slot])) return null
        const ramp = editableRamp(plate, slot)
        if (!ramp || !edit.allowed(ramp, 1)) return null
        const move = mainMove(plate, slot, edit.shadeMove)
        edit.apply(ramp)
        if (edit.overrides) {
            eachOverride(plate, slot, (override) => {
                if (edit.allowed(override, 1)) edit.apply(override)
            })
        }
        return move
    }, { repaint: edit.repaint })
}

function setTone(slot: number, tone: number, value: string) {
    editShade(slot, 'Edit shade', setEdit(tone, value))
}

export function addShade(slot: number, after?: number) {
    commitShades('Add shade', (plate) => {
        if (blendOf(plate.palette.slots[slot])) return null
        const ramp = editableRamp(plate, slot)
        if (!ramp || ramp.length >= MAX_TONES) return null
        const at = after === undefined ? ramp.length - 1 : after
        const move = mainMove(plate, slot, (target) => insertionMove(target, at))
        ramp.splice(at + 1, 0, ramp[at] ?? NEW_COLOR)
        eachOverride(plate, slot, (override) => {
            if (override.length > at + 1) override.splice(at + 1, 0, override[at])
        })
        return move
    })
}

function removeShade(slot: number, tone: number) {
    editShade(slot, 'Remove shade', removeEdit(tone))
}

function moveShade(slot: number, tone: number, direction: number) {
    editShade(slot, 'Move shade', moveEdit(tone, direction))
}

function generateShades(slot: number, base: string, count: number) {
    commitShades('Generate shades', (plate) => {
        const ramp = editableRamp(plate, slot)
        if (!ramp) return null
        const next = suggestRamp(hexOf(base), limited(count, 1, MAX_TONES, DEFAULT_SHADES, 'Shades'))
        const move = mainMove(plate, slot, (target) => resizeMove(target, target.ramp.length, next.length))
        ramp.splice(0, ramp.length, ...next)
        const target = plate.palette.slots[slot]
        const blend = blendOf(target)
        if (target && blend) {
            if (editingMain(plate)) setBlend(target, undefined)
            else delete blend.colorways[colorsUi.colorway]
        }
        return move
    })
}

function reblend(plate: NameplateData, slot: Slot, blend: SlotBlend) {
    slot.ramp = blendTones(blend.stops, blend.tones)
    for (const [name, stops] of Object.entries(blend.colorways)) {
        const overrides = plate.palette.colorways[name]
        if (overrides) overrides[slot.id] = blendTones(stops, blend.tones)
        else delete blend.colorways[name]
    }
    setBlend(slot, blend)
}

function setBlendTones(index: number, enabled: boolean, tones: number) {
    commitShades(enabled ? 'Blend shades' : 'Stop blending shades', (plate) => {
        const slot = plate.palette.slots[index]
        if (!slot || !editingMain(plate)) return null
        const current = blendOf(slot)
        if (!enabled) {
            setBlend(slot, undefined)
            return null
        }
        if (current) {
            const count = limited(tones, current.stops.length, MAX_TONES, current.tones, 'Number of shades')
            const move = resizeMove(slot, slot.ramp.length, count)
            reblend(plate, slot, { ...current, tones: count })
            return move
        }
        const stops = slot.ramp.slice()
        const count = limited(tones, stops.length, MAX_TONES, defaultBlendTones(stops.length), 'Number of shades')
        if (!canBlend(stops, count)) return null
        const move = resizeMove(slot, slot.ramp.length, count)
        const colorways: Record<string, string[]> = {}
        for (const name of colorwayNames(plate)) {
            const override = plate.palette.colorways[name][slot.id]
            if (override) colorways[name] = override.slice()
        }
        reblend(plate, slot, { tones: count, stops, colorways })
        return move
    })
}

function editStops(index: number, label: string, change: (stops: string[], blend: SlotBlend) => boolean) {
    commitShades(label, (plate) => {
        const slot = plate.palette.slots[index]
        const blend = blendOf(slot)
        if (!slot || !blend) return null
        const main = editingMain(plate)
        const stops = (main ? blend.stops : blend.colorways[colorsUi.colorway] ?? blend.stops).slice()
        if (!change(stops, blend)) return null
        if (main) {
            const move = resizeMove(slot, slot.ramp.length, slot.ramp.length)
            reblend(plate, slot, { ...blend, stops })
            return move
        }
        if (!plate.palette.colorways[colorsUi.colorway]) return null
        blend.colorways[colorsUi.colorway] = stops
        plate.palette.colorways[colorsUi.colorway][slot.id] = blendTones(stops, blend.tones)
        reblend(plate, slot, blend)
        return null
    })
}

function editStop(index: number, label: string, edit: EntryEdit) {
    editStops(index, label, (stops) => {
        if (!edit.allowed(stops, MIN_STOPS)) return false
        edit.apply(stops)
        return true
    })
}

function setStop(index: number, stop: number, value: string) {
    editStop(index, 'Edit stop', setEdit(stop, value))
}

export function addStop(index: number, after?: number) {
    editStops(index, 'Add stop', (stops, blend) => {
        if (stops.length >= blend.tones) return false
        const at = after === undefined ? stops.length - 1 : after
        stops.splice(at + 1, 0, stops[at] ?? NEW_COLOR)
        return true
    })
}

function removeStop(index: number, stop: number) {
    editStop(index, 'Remove stop', removeEdit(stop))
}

function moveStop(index: number, stop: number, direction: number) {
    editStop(index, 'Move stop', moveEdit(stop, direction))
}

function newSlotId(plate: NameplateData, label: string): string {
    return slotIdFrom(label, (candidate) => plate.palette.slots.some((slot) => slot.id === candidate))
}

function relocate(list: unknown[], from: number, to: number) {
    list.splice(to, 0, ...list.splice(from, 1))
}

export function addColor(name: string, base: string, count: number) {
    commit('Add color', (plate) => {
        const label = String(name ?? '').trim() || 'Color'
        const id = newSlotId(plate, label)
        plate.palette.slots.push({ id, name: label, ramp: suggestRamp(hexOf(base), limited(count, 1, MAX_TONES, DEFAULT_SHADES, 'Shades')) })
    })
}

function addColorList(name: string, colors: string[]) {
    commit('Add colors', (plate) => {
        const label = String(name ?? '').trim() || 'Colors'
        const rows = Math.ceil(colors.length / MAX_TONES)
        for (let row = 0; row < rows; row++) {
            const rowName = rows === 1 ? label : `${label} ${row + 1}`
            const id = newSlotId(plate, rowName)
            plate.palette.slots.push({ id, name: rowName, ramp: colors.slice(row * MAX_TONES, (row + 1) * MAX_TONES) })
        }
    })
}

function renameColor(slot: number, name: string) {
    commit('Rename color', (plate) => {
        const target = plate.palette.slots[slot]
        const label = String(name ?? '').trim()
        if (target && label) target.name = label
    })
}

function removeColor(slot: number) {
    commit('Remove color', (plate) => {
        if (plate.palette.slots.length <= 1) return
        const [removed] = plate.palette.slots.splice(slot, 1)
        if (!removed) return
        for (const name of colorwayNames(plate)) delete plate.palette.colorways[name][removed.id]
    })
}

function useMainColors(slot: number) {
    commit('Use main colors', (plate) => {
        const target = plate.palette.slots[slot]
        const overrides = plate.palette.colorways[colorsUi.colorway]
        if (target && overrides) delete overrides[target.id]
    })
}

let overriding = false

function syncColorwayPreview() {
    const colorway = previewColorway()
    if (!colorway) {
        if (overriding) {
            overriding = false
            setPreviewOverride(null)
        }
        return
    }
    const variant = sanitizeId(colorway) || 'colorway'
    overriding = true
    setPreviewOverride({
        variant,
        note: `Showing colorway '${colorway}'. No variant uses it yet, so players never see it.`,
        patch(files) {
            const shown = withColorwayPreview(files, colorway)
            if (!shown) return files
            this.variant = shown.variant
            return shown.files
        },
    })
}

function dropStalePreview() {
    if (overriding && !previewColorway()) syncColorwayPreview()
}

function selectColorway(name: string) {
    colorsUi.colorway = name
    const plate = readNameplate()
    const variant = Object.keys(plate.variants).find((key) => plate.variants[key].palette === name)
    if (variant || !(name in plate.palette.colorways)) endColorwayPreview()
    else startColorwayPreview(name)
    syncColorwayPreview()
    if (variant && previewUi.variant !== variant) {
        previewUi.variant = variant
        redraw(!previewUi.variants.includes(variant))
    }
    refreshColors()
}

function variantFor(plate: NameplateData, colorway: string): string {
    return addVariantLike(plate, colorway, () => colorway)
}

function showVariant(key: string, colorway: string) {
    endColorwayPreview()
    syncColorwayPreview()
    colorsUi.colorway = colorway
    previewUi.variant = key
    redraw(true)
    refreshColors()
}

export function addVariantFor(colorway: string): string {
    let created = ''
    commit('Add variant', (plate) => {
        if (colorway in plate.palette.colorways) created = variantFor(plate, colorway)
    })
    if (created) showVariant(created, colorway)
    return created
}

function addColorway(name: string, withVariant = true) {
    let created = ''
    let variant = ''
    commit(withVariant ? 'Add colorway and variant' : 'Add colorway', (plate) => {
        created = uniqueId(sanitizeId(name) || 'colorway', (candidate) => candidate in plate.palette.colorways)
        plate.palette.colorways[created] = {}
        if (withVariant) variant = variantFor(plate, created)
    })
    if (variant) showVariant(variant, created)
    else if (created) selectColorway(created)
}

export function colorwayProblems(plate: NameplateData = readNameplate()): Array<{ colorway: string, message: string }> {
    return unusedColorways(plate).map((colorway) => ({
        colorway,
        message: `Colorway '${colorway}' is not used by any variant, so players never see it. Add a variant that uses it, or remove the colorway.`,
    }))
}

function renameColorway(from: string, to: string) {
    let renamed = ''
    commit('Rename colorway', (plate) => {
        if (!(from in plate.palette.colorways)) return
        const next = uniqueId(sanitizeId(to) || from, (candidate) => candidate !== from && candidate in plate.palette.colorways)
        if (next === from) return
        const colorways: Record<string, Record<string, string[]>> = {}
        for (const key of Object.keys(plate.palette.colorways)) colorways[key === from ? next : key] = plate.palette.colorways[key]
        plate.palette.colorways = colorways
        for (const slot of plate.palette.slots) {
            const blend = blendOf(slot)
            if (!blend || !(from in blend.colorways)) continue
            blend.colorways[next] = blend.colorways[from]
            delete blend.colorways[from]
        }
        for (const key of Object.keys(plate.variants)) {
            if (plate.variants[key].palette === from) plate.variants[key].palette = next
        }
        renamed = next
    })
    if (renamed) selectColorway(renamed)
}

function dropColorway(name: string) {
    let kept = ''
    commit('Remove colorway', (plate) => {
        const names = colorwayNames(plate)
        if (names.length <= 1 || !(name in plate.palette.colorways)) return
        delete plate.palette.colorways[name]
        const fallback = Object.keys(plate.palette.colorways)[0]
        for (const key of Object.keys(plate.variants)) {
            if (plate.variants[key].palette === name) plate.variants[key].palette = fallback
        }
        if (name === names[0] && !mainColorway(plate.palette)) kept = fallback
    })
    refreshColors()
    if (kept) Blockbench.showQuickMessage(`'${kept}' is the first colorway now. Its shades and the main colors stay as they were.`, PASTE_NOTE_MS)
}

function removeColorway(name: string) {
    const plate = readNameplate()
    const names = colorwayNames(plate)
    if (names.length <= 1 || !(name in plate.palette.colorways)) return
    const moving = Object.keys(plate.variants).filter((key) => plate.variants[key].palette === name)
    if (!moving.length) {
        dropColorway(name)
        return
    }
    const fallback = names.find((entry) => entry !== name)
    const usage = moving.length === 1 ? `Variant ${quotedList(moving)} uses colorway '${name}'. It` : `Variants ${quotedList(moving)} use colorway '${name}'. They`
    confirmBox(
        {
            title: 'Remove Colorway',
            icon: 'palette',
            message: `${usage} will switch to '${fallback}'.`,
            confirm: 'Remove colorway',
        },
        () => dropColorway(name),
    )
}

function openPicker(dialog: Dialog) {
    setTimeout(() => {
        const well = dialog.object?.querySelector('.sp-replacer') as HTMLElement | null
        if (!well) return
        well.click()
        const open = document.querySelectorAll('.sp-container:not(.sp-hidden):not(.sp-flat) .sp-choose')
        open[open.length - 1]?.addEventListener('click', () => dialog.confirm(), { once: true })
    })
}

function badgeUses(plate: NameplateData, slot: string, tone: number): boolean {
    const badges: any[] = [plate.badge, ...Object.values(plate.variants).map((variant) => variant.badge)]
    return badges.flatMap((badge) => [badge?.tint, badge?.decorationColor]).some((color) => {
        const ref = parseColorRef(color)
        return ref?.slot === slot && ref.tone === tone
    })
}

function shadeDialog(slot: number, tone: number) {
    const view = colorsUi.slots[slot]
    if (!view) return
    const form: Record<string, any> = {
        color: { type: 'color', label: 'Color', value: cssColor(view.ramp[tone]) },
    }
    if (badgeUses(readNameplate(), view.id, tone)) form.badge = { type: 'info', text: 'The PolyPlus badge uses this shade too.' }
    const dialog = new Dialog({
        id: 'polyplus_nameplate_shade',
        title: `Edit ${view.name}, shade ${tone + 1}`,
        width: 360,
        cancel_on_click_outside: false,
        form,
        onConfirm(result: any) {
            setTone(slot, tone, result.color)
        },
    } as any)
    dialog.show()
    openPicker(dialog)
    return dialog
}

export function openShadeDialog(slot: number, tone: number): Dialog | undefined {
    return shadeDialog(slot, tone)
}

function openGenerateDialog(slot: number): Dialog | undefined {
    const view = colorsUi.slots[slot]
    if (!view) return
    const dialog = new Dialog({
        id: 'polyplus_nameplate_generate',
        title: `Generate Shades for ${view.name}`,
        width: 400,
        form: {
            about: { type: 'info', text: 'Darker shades lean cool, lighter shades lean warm.' },
            base: { type: 'color', label: 'Middle color', value: cssColor(view.ramp[view.ramp.length >> 1] ?? NEW_COLOR) },
            count: { type: 'number', label: 'Shades', step: 1, value: Math.max(DEFAULT_SHADES, view.ramp.length) },
        },
        onConfirm(result: any) {
            generateShades(slot, result.base, result.count)
        },
    } as any)
    dialog.show()
    return dialog
}

export function openAddColorDialog(): Dialog {
    const dialog = new Dialog({
        id: 'polyplus_nameplate_add_color',
        title: 'Add Color',
        width: 400,
        form: {
            name: { type: 'text', label: 'Name', value: 'Color' },
            base: { type: 'color', label: 'Middle color', value: NEW_COLOR },
            count: { type: 'number', label: 'Shades', step: 1, value: DEFAULT_SHADES },
        },
        onConfirm(result: any) {
            addColor(result.name, result.base, result.count)
        },
    } as any)
    dialog.show()
    return dialog
}

function readColorList(text: string): { colors: string[], repeats: number, rejected: string[] } {
    const colors: string[] = []
    const rejected: string[] = []
    let repeats = 0
    for (const token of String(text ?? '').split(/[\s,;]+/)) {
        const code = token.replace(/^[^#0-9a-fA-F]+|[^0-9a-fA-F]+$/g, '')
        if (!code) continue
        const hex = normalizeHex(code)
        if (!hex) {
            rejected.push(token)
            continue
        }
        const color = hex.length === 9 ? paletteHex(`#${hex.slice(7)}${hex.slice(1, 7)}`) : hex
        if (colors.includes(color)) repeats++
        else colors.push(color)
    }
    return { colors, repeats, rejected }
}

function openPasteColorsDialog(): Dialog {
    const dialog = new Dialog({
        id: 'polyplus_nameplate_paste_colors',
        title: 'Paste Colors',
        width: 460,
        form: {
            about: { type: 'info', text: 'Paste color codes like #E84393 or FFAA00, split by spaces, commas or new lines. Each code becomes one shade.' },
            name: { type: 'text', label: 'Name', value: 'Colors' },
            colors: { type: 'textarea', label: 'Color codes', height: 110, value: '' },
        },
        onConfirm(result: any) {
            const list = readColorList(result.colors)
            if (list.rejected.length) {
                Blockbench.showQuickMessage(`These are not color codes: ${list.rejected.join(', ')}. Fix or remove them.`, PASTE_NOTE_MS)
                return false
            }
            if (!list.colors.length) {
                Blockbench.showQuickMessage('Paste at least one color code.', PASTE_NOTE_MS)
                return false
            }
            addColorList(result.name, list.colors)
            const added = list.colors.length === 1 ? 'Added 1 color.' : `Added ${list.colors.length} colors.`
            const skipped = list.repeats === 1 ? ' Skipped 1 repeated code.' : list.repeats > 1 ? ` Skipped ${list.repeats} repeated codes.` : ''
            Blockbench.showQuickMessage(`${added}${skipped}`, PASTE_NOTE_MS)
            return true
        },
    } as any)
    dialog.show()
    return dialog
}

function renameColorDialog(slot: number) {
    const view = colorsUi.slots[slot]
    if (!view) return
    const dialog = new Dialog({
        id: 'polyplus_nameplate_rename_color',
        title: 'Rename Color',
        width: 360,
        form: { name: { type: 'text', label: 'Name', value: view.name } },
        onConfirm(result: any) {
            renameColor(slot, result.name)
        },
    } as any)
    dialog.show()
}

function colorwayDialog(mode: 'add' | 'rename') {
    const form: Record<string, any> = {
        about: { type: 'info', text: 'A colorway swaps colors without touching the pixels.' },
        name: { type: 'text', label: 'Name', value: mode === 'add' ? 'colorway' : colorsUi.colorway },
    }
    if (mode === 'add') {
        form.variant = {
            type: 'checkbox',
            label: 'Also add a variant that uses it',
            value: true,
            description: 'Without a variant, players never see this colorway',
        }
    }
    const dialog = new Dialog({
        id: 'polyplus_nameplate_colorway_name',
        title: mode === 'add' ? 'New Colorway' : 'Rename Colorway',
        width: 400,
        form,
        onConfirm(result: any) {
            if (mode === 'add') addColorway(result.name, result.variant !== false)
            else renameColorway(colorsUi.colorway, result.name)
        },
    } as any)
    dialog.show()
}

function paintTone(slot: number, tone: number): string | undefined {
    const main = colorsUi.slots[slot]?.main ?? readNameplate().palette.slots[slot]?.ramp.map((entry) => paletteHex(entry)) ?? []
    const color = main[Math.max(0, Math.min(main.length - 1, tone))]
    if (color) setBrush(color, true)
    return color
}

export function readyToPaint(): boolean {
    const panel = Panels[PAINT_PANEL]
    return !!(Toolbox.selected as any)?.paintTool && !!panel && !panel.folded && !!(Condition as any)(panel.condition)
}

export function pickTone(slot: number, tone: number) {
    if (readyToPaint() || colorsUi.slots[slot]?.blend) paintTone(slot, tone)
    else shadeDialog(slot, tone)
}

export function toneMenu(slot: number, tone: number): Menu {
    const view = colorsUi.slots[slot]
    const ramp = view?.ramp ?? []
    const paint = { name: colorsUi.first ? 'Paint with this shade' : 'Paint with the main color of this shade', icon: 'brush', click: () => paintTone(slot, tone) }
    if (view?.blend) {
        return new Menu([
            paint,
            { name: 'Blend settings...', icon: 'gradient', description: 'Blended from the stops under them', condition: () => colorsUi.first, click: () => openBlendDialog(slot) },
        ])
    }
    return new Menu([
        paint,
        { name: 'Edit shade...', icon: 'edit', click: () => shadeDialog(slot, tone) },
        { name: 'Add shade after', icon: 'add', condition: () => ramp.length < MAX_TONES, click: () => addShade(slot, tone) },
        { name: 'Move darker', icon: 'chevron_left', condition: () => tone > 0, click: () => moveShade(slot, tone, -1) },
        { name: 'Move lighter', icon: 'chevron_right', condition: () => tone < ramp.length - 1, click: () => moveShade(slot, tone, 1) },
        { name: 'Remove shade', icon: 'delete', condition: () => ramp.length > 1, click: () => removeShade(slot, tone) },
    ])
}

export function openStopDialog(slot: number, stop: number) {
    const view = colorsUi.slots[slot]
    const color = view?.blend?.stops[stop]
    if (!view || !color) return
    const dialog = new Dialog({
        id: 'polyplus_nameplate_stop',
        title: `Edit ${view.name}, stop ${stop + 1}`,
        width: 360,
        cancel_on_click_outside: false,
        form: {
            color: { type: 'color', label: 'Color', value: cssColor(color) },
        },
        onConfirm(result: any) {
            setStop(slot, stop, result.color)
        },
    } as any)
    dialog.show()
    openPicker(dialog)
}

export function stopMenu(slot: number, stop: number): Menu {
    const blend = colorsUi.slots[slot]?.blend
    const stops = blend?.stops.length ?? 0
    return new Menu([
        { name: 'Edit stop...', icon: 'edit', click: () => openStopDialog(slot, stop) },
        { name: 'Add stop after', icon: 'add', condition: () => !!blend && stops < blend.tones, click: () => addStop(slot, stop) },
        { name: 'Move darker', icon: 'chevron_left', condition: () => stop > 0, click: () => moveStop(slot, stop, -1) },
        { name: 'Move lighter', icon: 'chevron_right', condition: () => stop < stops - 1, click: () => moveStop(slot, stop, 1) },
        { name: 'Remove stop', icon: 'delete', condition: () => stops > MIN_STOPS, click: () => removeStop(slot, stop) },
    ])
}

export function openBlendDialog(slot: number): Dialog | undefined {
    const view = colorsUi.slots[slot]
    if (!view) return
    const stops = view.blend ? view.blend.stops.length : view.main.length
    const about = view.blend
        ? `Turn this off to edit the ${view.blend.tones} shades one by one.`
        : `Your ${stops} shades become stops. The game blends the shades between them.`
    const dialog = new Dialog({
        id: 'polyplus_nameplate_blend',
        title: `Blend Shades for ${view.name}`,
        width: 420,
        form: {
            about: { type: 'info', text: about },
            enabled: { type: 'checkbox', label: 'Blend shades from these stops', value: !!view.blend },
            tones: {
                type: 'number',
                label: 'Number of shades',
                step: 1,
                value: view.blend?.tones ?? defaultBlendTones(stops),
                condition: (result: any) => result?.enabled,
            },
        },
        onConfirm(result: any) {
            setBlendTones(slot, !!result.enabled, Number(result.tones))
        },
    } as any)
    dialog.show()
    return dialog
}

export function slotMenu(slot: number): Menu {
    const view = colorsUi.slots[slot]
    return new Menu([
        { name: 'Generate shades...', icon: 'auto_awesome', click: () => openGenerateDialog(slot) },
        { name: 'Add shade', icon: 'add', condition: () => !view?.blend, click: () => addShade(slot) },
        {
            name: view?.blend ? 'Blend settings...' : 'Blend shades from stops...',
            icon: 'gradient',
            description: 'Pick a few stop colors and let the game blend the shades between them',
            condition: () => colorsUi.first && !!view && (!!view.blend || view.main.length >= MIN_STOPS),
            click: () => openBlendDialog(slot),
        },
        { name: 'Rename...', icon: 'text_format', click: () => renameColorDialog(slot) },
        { name: 'Color formula...', icon: 'functions', description: 'A formula sets this color every frame, for example a rainbow', click: () => view && openSlotMolangEditor(view.id) },
        { name: 'Animate color', icon: 'animation', condition: () => !!view, click: () => view && focusSlot(view.id) },
        { name: 'Paint a sweep...', icon: 'gradient', condition: () => !!view && view.main.length > 1, click: () => view && openSweepDialog(view.id) },
        { name: 'Use main colors', icon: 'undo', condition: () => !colorsUi.first && !!view && !view.inherited, click: () => useMainColors(slot) },
        { name: 'Remove color', icon: 'delete', condition: () => colorsUi.slots.length > 1, click: () => removeColor(slot) },
        new MenuSeparator('library'),
        { name: 'Save colors to library...', icon: 'bookmark_add', click: () => openSavePaletteDialog() },
    ])
}

function colorwayMenu(): Menu {
    const saveToLibrary = { name: 'Save colors to library...', icon: 'bookmark_add', click: () => openSavePaletteDialog() }
    return new Menu([
        { name: 'New colorway...', icon: 'add', click: () => colorwayDialog('add') },
        { name: 'Rename colorway...', icon: 'text_format', click: () => colorwayDialog('rename') },
        { name: 'Add a variant that uses it', icon: 'style', condition: () => colorsUi.unused, click: () => addVariantFor(colorsUi.colorway) },
        {
            name: 'Remove colorway',
            icon: 'delete',
            condition: () => colorwayNames(readNameplate()).length > 1,
            click: () => removeColorway(colorsUi.colorway),
        },
        new MenuSeparator('library'),
        saveToLibrary,
    ])
}

function makeItems(): BarItem[] {
    const add = defineFormatAction('polyplus_nameplate_add_color', {
        name: 'Add Color',
        description: 'Layers and sprites can only use these colors',
        icon: 'add',
        click: () => openAddColorDialog(),
    })
    const paste = defineFormatAction('polyplus_nameplate_paste_colors', {
        name: 'Paste Colors',
        description: 'Add a list of color codes, like a palette from a website',
        icon: 'content_paste',
        click: () => openPasteColorsDialog(),
    })
    const select = new BarSelect(COLORWAY_SELECT, {
        name: 'Colorway',
        description: 'The first one holds the main colors',
        condition: { formats: [FORMAT_ID] },
        options: { default: 'default' },
        value: 'default',
        onChange(self: BarSelect) {
            if (self.get() === NEW_COLORWAY) {
                self.set(colorsUi.colorway)
                colorwayDialog('add')
                return
            }
            selectColorway(self.get())
        },
    })
    const options = defineFormatAction('polyplus_nameplate_colorway_menu', {
        name: 'Colorways',
        icon: 'palette',
        click: (event?: Event) => {
            colorwayMenu().open(event as MouseEvent)
        },
    })
    return [add, paste, select, options]
}

export function registerColorsPanel(): () => void {
    handles.items = makeItems()
    handles.toolbar = pluginToolbar(COLORS_TOOLBAR, {
        name: 'Colors',
        condition: { formats: [FORMAT_ID] },
        children: ['polyplus_nameplate_add_color', 'polyplus_nameplate_paste_colors', '_', COLORWAY_SELECT, 'polyplus_nameplate_colorway_menu'],
    })
    setStripToolbar(handles.toolbar)
    handles.removers.push(
        onLight(refreshColors),
        onBrushChange(refreshColors),
        onNameplateChanged(dropStalePreview),
        onPreviewResult(() => {
            if (previewUi.variant !== followed.variant) refreshColors()
        }),
    )
    refreshColors()
    return () => {
        disposeAll(handles.removers)
        endColorwayPreview()
        overriding = false
        setStripToolbar(null)
        if (handles.toolbar) dropToolbar(handles.toolbar)
        handles.toolbar = null
        disposeAll(handles.items)
        colorsUi.hasProject = false
        colorsUi.slots = []
        followed.variant = ''
        followed.key = ''
        setShownColorway('')
    }
}

import { syncScheduleMarkers } from '../animate/markers'
import { editDoc } from '../doc/store'
import { readLayers } from '../elements'
import { currentLoopFrames, isNameplateActive, onProjectLoaded, secondsText, snappingFor } from '../format'
import { LayerData, NameplateData, PER_PLAYER_PHASE, VariantData } from '../model'
import { limited } from '../elements/limits'
import { MAX_FPS, MIN_FPS, sanitizeId, uniqueId } from '../palette/ids'
import { readNameplate } from '../palette/state'
import { previewUi, redraw, syncNameWidth } from '../preview'
import { registerChecksPanel } from '../leftside/checks'
import { variantStyleForm, variantStyleFrom } from '../text'
import { readFlags, writeFlags } from '../flags/state'
import type { FlagsState } from '../flags/types'
import { readMaterials } from '../material/state'
import { registerParamsAction } from '../params/dialog'
import { allAnimations } from '../util/animation'
import { defineFormatAction } from '../util/actions'
import { disposeAll, disposeAllReversed } from '../util/teardown'
import { hasProject } from '../util/project'

type FormConfig = Record<string, FormElementOptions | '_'>

const SWAP_NOTE = "**shows** puts another layer in this layer's place. That layer also stays in its own place unless you hide it."

const BACKGROUND_OPTIONS: Record<string, string> = {
    inherit: 'Same as the nameplate',
    true: 'Draws its own background',
    false: 'Keeps the game background',
}

const handles: { items: BarItem[], removers: Array<() => void> } = {
    items: [],
    removers: [],
}

function scaleTimes(times: unknown, ratio: number) {
    if (!times || typeof times !== 'object') return
    const list = times as number[]
    for (let index = 0; index < list.length; index++) {
        if (typeof list[index] === 'number') list[index] *= ratio
    }
}

function retime(animations: any[], from: number, to: number) {
    const ratio = from / to
    for (const animation of animations) {
        for (const animator of Object.values<any>(animation.animators ?? {})) {
            for (const keyframe of Array.isArray(animator?.keyframes) ? animator.keyframes : []) {
                keyframe.time = Math.round(keyframe.time * from * 1e6) / 1e6 / to
                scaleTimes(keyframe.bezier_left_time, ratio)
                scaleTimes(keyframe.bezier_right_time, ratio)
            }
        }
        for (const marker of Array.isArray(animation.markers) ? animation.markers : []) marker.time *= ratio
        const length = Number(animation.length) * ratio
        if (typeof animation.setLength === 'function') animation.setLength(length)
        else animation.length = length
        syncTiming(animation, to)
        syncScheduleMarkers(animation, to)
    }
}

function timingDiffers(animation: any, fps: number): boolean {
    return animation.snapping !== snappingFor(fps) || animation.nameplate_fps !== fps
}

function syncTiming(animation: any, fps: number) {
    animation.snapping = snappingFor(fps)
    animation.nameplate_fps = fps
}

function syncAnimationTiming() {
    if (!hasProject() || !isNameplateActive()) return
    const fps = readNameplate().fps
    for (const animation of allAnimations()) if (timingDiffers(animation, fps)) syncTiming(animation, fps)
}

function saveSettings(result: any) {
    const current = readNameplate()
    const fps = limited(result.fps, MIN_FPS, MAX_FPS, current.fps, 'Frames per second')
    const changed = fps !== current.fps
    const animations = changed ? allAnimations().slice() : allAnimations().filter((animation) => timingDiffers(animation, fps))
    const namedAfterId = !Project.name || Project.name === current.id
    editDoc(['nameplate'], { label: 'Edit nameplate settings', aspects: { animations } }, ({ nameplate: plate }) => {
        plate.id = sanitizeId(result.id) || plate.id
        if (namedAfterId) Project.name = plate.id
        plate.referenceName = String(result.referenceName ?? plate.referenceName).trim() || plate.referenceName
        plate.ownsBackground = !!result.ownsBackground
        if (result.phase) plate.phase = PER_PLAYER_PHASE
        else delete plate.phase
        if (changed) retime(animations, plate.fps, fps)
        else for (const animation of animations) syncTiming(animation, fps)
        plate.fps = fps
    })
    if (changed && typeof Animator.preview === 'function') Animator.preview()
}

export function openSettingsDialog(): Dialog {
    const plate = readNameplate()
    const loop = currentLoopFrames()
    const dialog = new Dialog({
        id: 'polyplus_nameplate_settings',
        title: 'Nameplate Settings',
        width: 460,
        form: {
            id: { type: 'text', label: 'ID', value: plate.id, description: 'Also the file name. Use lowercase letters, digits and _' },
            referenceName: { type: 'text', label: 'Example name', value: plate.referenceName },
            fps: {
                type: 'number',
                label: 'Frames per second',
                step: 1,
                value: plate.fps,
                description: `How fast every animation plays. Frame numbers stay the same, so everything plays faster or slower. The loop is ${loop} frames, ${secondsText(loop, plate.fps)} at ${plate.fps} fps`,
            },
            ownsBackground: { type: 'checkbox', label: 'Draws its own background', style: 'toggle_switch', value: plate.ownsBackground, description: 'Off keeps the game background' },
            phase: { type: 'checkbox', label: 'Players start at different points', style: 'toggle_switch', value: plate.phase === PER_PLAYER_PHASE, description: 'On: a crowd doesn\'t blink or bob together. Change Seed to see it' },
        },
        onConfirm(result: any) {
            if (!hasProject()) return
            saveSettings(result)
            previewUi.autoWidth = true
            syncNameWidth()
            redraw(true)
        },
    } as any)
    dialog.show()
    return dialog
}

function variantForm(plate: NameplateData, key: string | null): FormConfig {
    const variant: VariantData = key ? plate.variants[key] : { palette: Object.keys(plate.palette.colorways)[0], hide: [], swap: {} }
    const colorways: Record<string, string> = {}
    for (const name of Object.keys(plate.palette.colorways)) colorways[name] = name
    const background = variant.ownsBackground === undefined ? 'inherit' : String(variant.ownsBackground)
    const form: FormConfig = {
        name: { type: 'text', label: 'Name', value: key ?? 'variant' },
        palette: { type: 'select', label: 'Colorway', options: colorways, value: variant.palette },
        background: { type: 'select', label: 'Background', options: BACKGROUND_OPTIONS, value: background },
    }
    const layers = readLayers()
    if (layers.length) form.layers_title = { type: 'info', text: '**Layers**' }
    const rows = layers.map((layer) => ({ layer, options: swapOptions(layer, layers, variant) }))
    if (rows.some((row) => Object.keys(row.options).length > 1)) form.layers_note = { type: 'info', text: SWAP_NOTE }
    for (const { layer, options } of rows) {
        const { id, uuid } = layer
        form[`hide_${id}`] = { type: 'checkbox', label: `Hide ${id}`, value: variant.hide.includes(uuid) }
        if (Object.keys(options).length > 1) {
            form[`swap_${id}`] = { type: 'select', label: `${id} shows`, options, value: variant.swap[uuid] ?? '' }
        }
    }
    Object.assign(form, variantNumbersForm(variant))
    Object.assign(form, variantStyleForm(plate, key ? variant : null))
    return form
}

function swapOptions(layer: LayerData, layers: LayerData[], variant: VariantData): Record<string, string> {
    const options: Record<string, string> = { '': 'Itself' }
    for (const other of layers) {
        if (other === layer) continue
        if (other.kind === layer.kind) options[other.uuid] = other.id
        else if (variant.swap[layer.uuid] === other.uuid) options[other.uuid] = `${other.id} (another kind of layer)`
    }
    return options
}

export function numberLabel(name: string): string {
    const label = readMaterials().ranges[name]?.label
    if (label && label !== name) return label
    const words = name.replace(/_+/g, ' ').trim()
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}

function variantNumberNames(variant: VariantData | null): string[] {
    const names = Object.keys(readMaterials().params)
    for (const name of Object.keys(variant?.params ?? {})) if (!names.includes(name)) names.push(name)
    return names
}

function sliderNote(name: string): FormElementOptions | null {
    const range = readMaterials().ranges[name]
    if (!range) return null
    return {
        type: 'info',
        text: `Any number works here, even past the slider's ${range.min} to ${range.max}.`,
        condition: (result: any) => !!result?.[`number_on__${name}`],
    } as FormElementOptions
}

function variantNumbersForm(variant: VariantData): FormConfig {
    const base = readMaterials().params
    const names = variantNumberNames(variant)
    const form: FormConfig = {}
    if (names.length === 0) return form
    form.numbers_title = { type: 'info', text: '**Shared numbers**' }
    for (const name of names) {
        const own = variant.params?.[name]
        const fallback = base[name]
        const label = numberLabel(name)
        form[`number_on__${name}`] = {
            type: 'checkbox',
            label: `Own value for ${label}`,
            style: 'toggle_switch',
            value: own !== undefined,
            description: `${fallback === undefined ? 'Only this variant sets this number' : `The nameplate's value is ${fallback}`}. Its ID is ${name}`,
        }
        form[`number__${name}`] = {
            type: 'number',
            label: `${label} in this variant`,
            step: 0.01,
            value: own ?? fallback ?? 0,
            condition: (result: any) => !!result?.[`number_on__${name}`],
        }
        const note = sliderNote(name)
        if (note) form[`number_note__${name}`] = note
    }
    return form
}

function variantNumbersFrom(result: Record<string, any>, previous: VariantData | null): Record<string, number> {
    const params: Record<string, number> = {}
    for (const name of variantNumberNames(previous)) {
        if (!result[`number_on__${name}`]) continue
        const value = Number(result[`number__${name}`])
        params[name] = isFinite(value) ? value : previous?.params?.[name] ?? readMaterials().params[name] ?? 0
    }
    return params
}

function variantFrom(result: Record<string, any>, previous: VariantData | null): VariantData {
    const layers = readLayers()
    const hide = layers.filter((layer) => !!result[`hide_${layer.id}`]).map((layer) => layer.uuid)
    const swap: Record<string, string> = {}
    for (const { id, uuid } of layers) {
        const target = String(result[`swap_${id}`] ?? '')
        if (target && target !== uuid && !hide.includes(uuid)) swap[uuid] = target
    }
    const variant: VariantData = { palette: String(result.palette), hide, swap }
    if (result.background === 'true') variant.ownsBackground = true
    else if (result.background === 'false') variant.ownsBackground = false
    Object.assign(variant, variantStyleFrom(result, previous))
    const params = variantNumbersFrom(result, previous)
    if (Object.keys(params).length > 0) variant.params = params
    return variant
}

function commitVariants(label: string, change: (plate: NameplateData, flags: FlagsState) => void) {
    editDoc(['nameplate', 'flags'], { label }, ({ nameplate, flags }) => change(nameplate, flags))
}

function saveVariant(key: string | null, result: Record<string, any>): string {
    let saved = ''
    commitVariants(key ? 'Edit variant' : 'Add variant', (plate, flags) => {
        const previous = key ? plate.variants[key] ?? null : null
        const wanted = sanitizeId(result.name) || key || 'variant'
        const name = uniqueId(wanted, (candidate) => candidate !== key && candidate in plate.variants)
        const variant = variantFrom(result, previous)
        const variants: Record<string, VariantData> = {}
        if (key && key in plate.variants) {
            for (const entry of Object.keys(plate.variants)) variants[entry === key ? name : entry] = entry === key ? variant : plate.variants[entry]
        } else {
            Object.assign(variants, plate.variants, { [name]: variant })
        }
        plate.variants = variants
        if (key && name !== key && key in flags.variants) {
            flags.variants[name] = flags.variants[key]
            delete flags.variants[key]
        }
        saved = name
    })
    if (saved) {
        previewUi.variant = saved
        redraw(true)
    }
    return saved
}

export function removeVariant(key: string) {
    const { variants } = readNameplate()
    if (Object.keys(variants).length <= 1 || !(key in variants)) return
    commitVariants('Remove variant', (plate, flags) => {
        delete plate.variants[key]
        delete flags.variants[key]
    })
    redraw(true)
}

export function openVariantDialog(key: string | null): Dialog {
    const plate = readNameplate()
    const target = key && key in plate.variants ? key : null
    const dialog = new Dialog({
        id: 'polyplus_nameplate_variant',
        title: target ? `Edit Variant ${target}` : 'New Variant',
        width: 480,
        form: variantForm(plate, target),
        cancel_on_click_outside: false,
        onConfirm(result: any) {
            saveVariant(target, result)
        },
    } as any)
    dialog.show()
    return dialog
}

function variantMenu(): Menu {
    const current = () => previewUi.variant
    return new Menu([
        { name: 'New variant...', icon: 'add', click: () => openVariantDialog(null) },
        { name: 'Edit this variant...', icon: 'edit', condition: () => !!current(), click: () => openVariantDialog(current()) },
        {
            name: 'Remove this variant',
            icon: 'delete',
            condition: () => Object.keys(readNameplate().variants).length > 1,
            click: () => removeVariant(current()),
        },
    ])
}

function makeItems(): BarItem[] {
    const settings = defineFormatAction('polyplus_nameplate_settings', {
        name: 'Nameplate Settings',
        description: 'ID, example name, speed, background and per-player timing',
        icon: 'settings',
        click: () => openSettingsDialog(),
    })
    const variants = defineFormatAction('polyplus_nameplate_variants', {
        name: 'Variants',
        description: 'Another look of this nameplate: a colorway plus layers hidden or swapped',
        icon: 'style',
        click: (event?: Event) => {
            variantMenu().open(event as MouseEvent)
        },
    })
    return [settings, variants, registerParamsAction()]
}

export function linkVariantLayers() {
    if (!hasProject()) return
    const uuids = new Map(readLayers().map((layer) => [layer.id, layer.uuid]))
    const link = (reference: string) => uuids.get(reference) ?? reference
    const plate = readNameplate()
    for (const variant of Object.values(plate.variants)) {
        variant.hide = variant.hide.map(link)
        const swap: Record<string, string> = {}
        for (const [from, to] of Object.entries(variant.swap)) swap[link(from)] = link(to)
        variant.swap = swap
    }
    Project.nameplate = plate
}

function dropGoneFlagChoices(): string[] {
    const { variants } = readNameplate()
    const flags = readFlags()
    const gone = Object.keys(flags.variants).filter((key) => !(key in variants))
    if (gone.length === 0) return []
    const notes = gone.map((key) => `Variant '${key}' is gone, so its flag choice '${flags.variants[key]}' was removed. If you renamed it, pick its flag again under Fill in the Inspector.`)
    for (const key of gone) delete flags.variants[key]
    writeFlags(flags)
    return notes
}

export function registerNameplatePanel(): () => void {
    handles.items = makeItems()
    const removeRepair = onProjectLoaded(() => {
        syncAnimationTiming()
        linkVariantLayers()
        return dropGoneFlagChoices()
    })
    handles.removers.push(removeRepair, registerChecksPanel())
    return () => {
        disposeAllReversed(handles.removers)
        disposeAll(handles.items)
    }
}

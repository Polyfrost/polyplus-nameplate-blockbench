import { defaultNameplate } from '../format'
import { NameplateData, PER_PLAYER_PHASE, Slot, VariantData } from '../model'
import { normalizeVariantParams } from '../params/values'
import { wholeFlooredClamped } from '../util/num'
import { MAX_FPS, MIN_FPS } from './ids'
import { ColorMap, recolorTextures, texturesUsing } from './pixels'
import { normalizePlateStyle, normalizeVariantStyle } from '../text/types'
import { normalizeMotion } from '../palanim/types'
import { createListenerSet } from '../util/events'
import { cloneJson } from '../util/json'
import { hasProject } from '../util/project'
import { installUndoState } from '../util/projectState'
import { undoEdit } from '../util/undo'
import { normalizeBlend, setBlend } from './blend'

const ASPECTS = { nameplate: true } as unknown as UndoAspects
const FALLBACK_TONE = '#808080'

const listeners = createListenerSet('palette listener failed')

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeSlot(raw: any): Slot {
    const id = String(raw?.id ?? 'slot')
    const ramp = stringArray(raw?.ramp)
    const slot: Slot = { id, name: String(raw?.name ?? id), ramp: ramp.length ? ramp : [FALLBACK_TONE] }
    const animation = normalizeMotion(raw?.animation, slot.ramp.length)
    if (animation) slot.animation = animation
    return slot
}

function normalizeVariant(raw: any, fallbackColorway: string): VariantData {
    const variant: VariantData = {
        palette: typeof raw?.palette === 'string' ? raw.palette : fallbackColorway,
        hide: stringArray(raw?.hide),
        swap: {},
    }
    if (raw?.swap && typeof raw.swap === 'object') {
        for (const key of Object.keys(raw.swap)) {
            if (typeof raw.swap[key] === 'string') variant.swap[key] = raw.swap[key]
        }
    }
    if (typeof raw?.ownsBackground === 'boolean') variant.ownsBackground = raw.ownsBackground
    Object.assign(variant, normalizeVariantStyle(raw))
    Object.assign(variant, normalizeVariantParams(raw))
    return variant
}

function normalize(raw: any): NameplateData {
    const base = defaultNameplate()
    const source = raw && typeof raw === 'object' ? raw : {}
    const slots = Array.isArray(source.palette?.slots) ? source.palette.slots.map(normalizeSlot) : base.palette.slots

    const colorways: Record<string, Record<string, string[]>> = {}
    if (source.palette?.colorways && typeof source.palette.colorways === 'object') {
        for (const name of Object.keys(source.palette.colorways)) {
            const overrides: Record<string, string[]> = {}
            const rawOverrides = source.palette.colorways[name]
            if (rawOverrides && typeof rawOverrides === 'object') {
                for (const slotId of Object.keys(rawOverrides)) {
                    const ramp = stringArray(rawOverrides[slotId])
                    if (ramp.length) overrides[slotId] = ramp
                }
            }
            colorways[name] = overrides
        }
    }
    if (!Object.keys(colorways).length) colorways.default = {}
    if (Array.isArray(source.palette?.slots)) {
        slots.forEach((slot: Slot, index: number) => setBlend(slot, normalizeBlend(source.palette.slots[index]?.blend, slot, colorways)))
    }
    const firstColorway = Object.keys(colorways)[0]

    const variants: Record<string, VariantData> = {}
    if (source.variants && typeof source.variants === 'object') {
        for (const key of Object.keys(source.variants)) {
            variants[key] = normalizeVariant(source.variants[key], firstColorway)
        }
    }
    if (!Object.keys(variants).length) variants.default = normalizeVariant(null, firstColorway)

    return {
        id: typeof source.id === 'string' ? source.id : base.id,
        fps: wholeFlooredClamped(source.fps, MIN_FPS, MAX_FPS, base.fps),
        ownsBackground: typeof source.ownsBackground === 'boolean' ? source.ownsBackground : base.ownsBackground,
        referenceName: typeof source.referenceName === 'string' ? source.referenceName : base.referenceName,
        ...(source.phase === PER_PLAYER_PHASE ? { phase: PER_PLAYER_PHASE } : {}),
        ...normalizePlateStyle(source),
        palette: { slots, colorways },
        variants,
    }
}

export function readNameplate(): NameplateData {
    return normalize(cloneJson(hasProject() ? Project.nameplate : null))
}

export function onNameplateChanged(listener: () => void): () => void {
    return listeners.on(listener)
}

export function notifyNameplateChanged() {
    listeners.notify()
}

export function commit(
    label: string,
    change: (plate: NameplateData) => void,
    remap?: (before: NameplateData, after: NameplateData) => ColorMap,
): boolean {
    if (!hasProject()) return false
    const plate = readNameplate()
    Project.nameplate = plate
    const before = remap ? cloneJson(plate) : null
    const aspects = remap ? { nameplate: true, textures: [], bitmap: true } : ASPECTS
    undoEdit(aspects, label, (save) => {
        change(plate)
        Project.nameplate = plate
        if (remap && before) {
            const map = remap(before, plate)
            const textures = texturesUsing(map)
            for (const texture of textures) save?.addTexture?.(texture)
            recolorTextures(textures, map)
        }
    })
    notifyNameplateChanged()
    return true
}

export function installUndoHooks(): Deletable[] {
    return installUndoState<{ plate: unknown, name: string }>(
        'nameplate',
        () => ({ plate: cloneJson(Project.nameplate), name: String(Project.name ?? '') }),
        (saved) => {
            Project.nameplate = cloneJson(saved.plate)
            if (typeof saved.name === 'string' && Project.name !== saved.name) Project.name = saved.name
            notifyNameplateChanged()
        },
    )
}

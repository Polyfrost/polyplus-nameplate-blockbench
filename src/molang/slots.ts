import type { BundleIssue, PaletteData, Slot } from '../model'
import { cloneJson, isRecord } from '../util/json'
import { defineProjectState } from '../util/projectState'
import { looksLikeMolang } from './expression'

export type SlotMolang = Record<string, string[]>

export const SLOT_MOLANG_PROPERTY = 'nameplate_slot_molang'
export const SLOT_MOLANG_ASPECT = 'nameplate_slot_molang'
const PALETTE_TRACK = 'palette.'
const LOOP = 'loop'

export function normalizeSlotMolang(raw: unknown): SlotMolang {
    const result: SlotMolang = {}
    if (!isRecord(raw)) return result
    for (const [id, tones] of Object.entries(raw)) {
        if (!Array.isArray(tones)) continue
        const list = tones.map((tone) => (typeof tone === 'string' ? tone.trim() : ''))
        if (list.some((tone) => tone.length > 0)) result[id] = list
    }
    return result
}

const store = defineProjectState<SlotMolang>({
    property: SLOT_MOLANG_PROPERTY,
    aspect: SLOT_MOLANG_ASPECT,
    listenerFailure: null,
    empty: () => ({}),
    parse: normalizeSlotMolang,
    serialize: (state) => normalizeSlotMolang(cloneJson(state)),
})

export const readSlotMolang = store.read
export const writeSlotMolang = store.write
export const commitSlotMolang = store.commit
export const registerSlotMolangState = store.register
export const unregisterSlotMolangState = store.unregister

export function setSlotMolang(slotId: string, tones: string[]): boolean {
    return commitSlotMolang(tones.some((tone) => tone.trim()) ? 'Set color formula' : 'Remove color formula', (state) => {
        const list = tones.map((tone) => tone.trim())
        if (list.some((tone) => tone.length > 0)) state[slotId] = list
        else delete state[slotId]
    })
}

export function clearSlotMolang(slotId: string): boolean {
    return setSlotMolang(slotId, [])
}

export function slotMolangOf(slotId: string): string[] | null {
    return readSlotMolang()[slotId] ?? null
}

export function isSlotDriven(slotId: string): boolean {
    return !!readSlotMolang()[slotId]
}

export function slotTones(slotId: string, tones: string[], count: number): string[] {
    const result: string[] = []
    for (let tone = 0; tone < count; tone++) {
        const source = (tones[tone] ?? '').trim()
        result.push(source || (count === 1 ? slotId : `${slotId}[${tone}]`))
    }
    return result
}

export function slotMolangPath(slotId: string): string {
    return `manifest.json#animations.${LOOP}.tracks.${PALETTE_TRACK}${slotId}`
}

export function applySlotMolang(
    manifest: Record<string, any>,
    palette: PaletteData,
    state: SlotMolang | undefined,
    issues: BundleIssue[],
) {
    const entries = Object.entries(state ?? {})
    if (entries.length === 0) return
    for (const [slotId, tones] of entries) {
        const slot = palette.slots.find((entry) => entry.id === slotId)
        if (!slot || !tones.some((tone) => tone.trim())) continue
        if (!isRecord(manifest.animations)) manifest.animations = {}
        const animations = manifest.animations
        if (!isRecord(animations[LOOP])) animations[LOOP] = { tracks: {} }
        const loop = animations[LOOP]
        if (!isRecord(loop.tracks)) loop.tracks = {}
        const name = `${PALETTE_TRACK}${slotId}`
        if (loop.tracks[name] !== undefined) {
            issues.push({
                path: slotMolangPath(slotId),
                message: `color '${slot.name}' has both a color animation and a formula. Keep one.`,
            })
            continue
        }
        const values = slotTones(slotId, tones, slot.ramp.length)
        loop.tracks[name] = { keys: [[0, values.length === 1 ? values[0] : values]] }
    }
}

function isSelfRef(slotId: string, tone: number, count: number, value: string): boolean {
    if (value === `${slotId}[${tone}]`) return true
    return count === 1 && tone === 0 && value === slotId
}

export function takeSlotMolang(manifest: Record<string, any>, slots: Slot[]): SlotMolang {
    const result: SlotMolang = {}
    const loop = isRecord(manifest?.animations) ? manifest.animations[LOOP] : null
    if (!isRecord(loop) || !isRecord(loop.tracks) || loop.schedule || loop.trigger) return result
    for (const name of Object.keys(loop.tracks)) {
        if (!name.startsWith(PALETTE_TRACK)) continue
        const slotId = name.slice(PALETTE_TRACK.length)
        const slot = slots.find((entry) => entry.id === slotId)
        const track = loop.tracks[name]
        if (!slot || !isRecord(track) || Object.keys(track).length !== 1 || !Array.isArray(track.keys) || track.keys.length !== 1) continue
        const key = track.keys[0]
        if (!Array.isArray(key) || key.length !== 2 || key[0] !== 0) continue
        const count = slot.ramp.length
        const raw = count === 1 && typeof key[1] === 'string' ? [key[1]] : key[1]
        if (!Array.isArray(raw) || raw.length !== count || !raw.every((value) => typeof value === 'string')) continue
        const tones = raw.map((value: string, tone: number) => (isSelfRef(slotId, tone, count, value) ? '' : value))
        const driven = tones.some((value: string) => value.length > 0)
        if (!driven || !tones.every((value: string) => value.length === 0 || looksLikeMolang(value))) continue
        if (count === 1 && Array.isArray(key[1])) continue
        result[slotId] = tones
        delete loop.tracks[name]
    }
    return result
}

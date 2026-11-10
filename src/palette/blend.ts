import type { PaletteData, Slot } from '../model'
import { expandRamp, parseHex } from '../import/ramp'
import { isRecord } from '../util/json'
import { MAX_TONES } from './ids'

export interface SlotBlend {
    tones: number
    stops: string[]
    colorways: Record<string, string[]>
}

type BlendHolder = Slot & { blend?: SlotBlend }

export const MIN_STOPS = 2

function hexList(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0) return null
    return value.every((entry) => parseHex(entry) !== null) ? (value as string[]).slice() : null
}

export function blendOf(slot: Slot | undefined | null): SlotBlend | undefined {
    return (slot as BlendHolder | undefined | null)?.blend
}

export function setBlend(slot: Slot, blend: SlotBlend | undefined) {
    if (blend) (slot as BlendHolder).blend = blend
    else delete (slot as BlendHolder).blend
}

export function canBlend(stops: string[], tones: number): boolean {
    return stops.length >= MIN_STOPS && Number.isInteger(tones) && tones >= stops.length && tones <= MAX_TONES && stops.every((stop) => parseHex(stop) !== null)
}

export function blendTones(stops: string[], tones: number): string[] {
    return expandRamp(stops, tones)
}

function sameColors(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    return a.every((color, index) => {
        const left = parseHex(color)
        const right = parseHex(b[index])
        return left !== null && right !== null ? left === right : String(color).toUpperCase() === String(b[index]).toUpperCase()
    })
}

export function defaultBlendTones(stops: number): number {
    return Math.min(MAX_TONES, Math.max(stops, 8))
}

export function normalizeBlend(raw: unknown, slot: Slot, colorways: Record<string, Record<string, string[]>>): SlotBlend | undefined {
    if (!isRecord(raw)) return undefined
    const stops = hexList(raw.stops)
    const tones = Number(raw.tones)
    if (!stops || !canBlend(stops, tones)) return undefined
    if (!sameColors(slot.ramp, blendTones(stops, tones))) return undefined
    const kept: Record<string, string[]> = {}
    if (isRecord(raw.colorways)) {
        for (const [name, value] of Object.entries(raw.colorways)) {
            const list = hexList(value)
            const override = colorways[name]?.[slot.id]
            if (list && override && sameColors(override, blendTones(list, tones))) kept[name] = list
        }
    }
    return { tones, stops, colorways: kept }
}

export function slotJson(slot: Slot): Record<string, unknown> {
    const blend = blendOf(slot)
    if (!blend) return { id: slot.id, name: slot.name, ramp: slot.ramp }
    return { id: slot.id, name: slot.name, ramp: blend.stops, interpolate: blend.tones }
}

export function colorwaysJson(palette: PaletteData): Record<string, Record<string, string[]>> {
    const result: Record<string, Record<string, string[]>> = {}
    for (const [name, overrides] of Object.entries(palette.colorways)) {
        const out: Record<string, string[]> = {}
        for (const [id, ramp] of Object.entries(overrides)) {
            const stops = blendOf(palette.slots.find((slot) => slot.id === id))?.colorways[name]
            out[id] = stops ?? ramp
        }
        result[name] = out
    }
    return result
}

export function attachBlends(slots: Slot[], colorways: Record<string, Record<string, string[]>>, rawSlots: unknown, rawColorways: unknown): string[] {
    const blended: string[] = []
    for (const raw of Array.isArray(rawSlots) ? rawSlots : []) {
        if (!isRecord(raw) || !Number.isInteger(raw.interpolate)) continue
        const slot = slots.find((entry) => entry.id === String(raw.id))
        const stops = hexList(raw.ramp)
        const tones = raw.interpolate as number
        if (!slot || !stops || !canBlend(stops, tones)) continue
        slot.ramp = blendTones(stops, tones)
        const blend: SlotBlend = { tones, stops, colorways: {} }
        for (const [name, overrides] of Object.entries(isRecord(rawColorways) ? rawColorways : {})) {
            const list = isRecord(overrides) ? hexList(overrides[slot.id]) : null
            if (!list) continue
            if (!colorways[name]) colorways[name] = {}
            colorways[name][slot.id] = blendTones(list, tones)
            blend.colorways[name] = list
        }
        setBlend(slot, blend)
        blended.push(slot.id)
    }
    return blended
}

import { byteHex, toArgbKey } from '../palette/color'
import { blendTones, canBlend } from '../palette/blend'
import { MAX_TONES } from '../palette/ids'
import type { CosmeticPalette, PaletteSlot } from './data'

export const FIXED_INDEX = 0
export const MAX_INDEXED_SLOTS = Math.floor(255 / MAX_TONES) + 1

export interface OffPalette {
    x: number
    y: number
    color: string
    count: number
}

export interface IndexedPixels {
    index: Uint8Array
    off: OffPalette | null
    painted: number
    guessed: Set<string>
}

function pixelKey(data: ArrayLike<number>, at: number): string {
    const hex = (value: number) => value.toString(16).padStart(2, '0')
    return `${hex(data[at + 3])}${hex(data[at])}${hex(data[at + 1])}${hex(data[at + 2])}`.toUpperCase()
}

export function blended(slot: Pick<PaletteSlot, 'ramp' | 'interpolate'>): boolean {
    return slot.interpolate !== undefined && canBlend(slot.ramp, slot.interpolate)
}

export function slotTones(slot: Pick<PaletteSlot, 'ramp' | 'interpolate'>, ramp: string[] = slot.ramp): string[] {
    return blended(slot) ? blendTones(ramp, slot.interpolate!) : ramp
}

export function toneIndex(palette: CosmeticPalette): Map<string, number> {
    const owners = new Map<string, number>()
    palette.slots.slice(0, MAX_INDEXED_SLOTS).forEach((slot, s) => {
        slotTones(slot).slice(0, MAX_TONES).forEach((tone, t) => {
            const key = toArgbKey(tone)
            const value = s * MAX_TONES + t + 1
            if (key && !owners.has(key) && value <= 255) owners.set(key, value)
        })
    })
    return owners
}

const PERCENT = 100
const quantized = new Uint8ClampedArray(1)

export function brushAlpha(alpha: number): number {
    quantized[0] = (Math.round((alpha / 255) * PERCENT) / PERCENT) * 255
    return quantized[0]
}

export function brushMatches(palette: CosmeticPalette, owners: ReadonlyMap<string, number> = toneIndex(palette)): Map<string, number> {
    const fixed = new Set(palette.fixed.map((color) => toArgbKey(color)).filter((key): key is string => !!key))
    const out = new Map<string, number>()
    const clashes = new Set<string>()
    const claim = (tone: string, value: number) => {
        const key = toArgbKey(tone)
        if (!key) return
        const alpha = parseInt(key.slice(0, 2), 16)
        const loose = brushAlpha(alpha)
        if (loose === alpha || loose === 0) return
        const alias = `${byteHex(loose)}${key.slice(2)}`
        if (owners.has(alias) || fixed.has(alias) || clashes.has(alias)) return
        const prior = out.get(alias)
        if (prior === undefined) out.set(alias, value)
        else if (prior !== value) {
            out.delete(alias)
            clashes.add(alias)
        }
    }
    palette.slots.slice(0, MAX_INDEXED_SLOTS).forEach((slot, s) => {
        slotTones(slot).slice(0, MAX_TONES).forEach((tone, t) => {
            const value = s * MAX_TONES + t + 1
            if (value <= 255) claim(tone, value)
        })
    })
    for (const color of palette.fixed) claim(color, FIXED_INDEX)
    return out
}

export function toneLimit(slot: number): number {
    return Math.max(0, Math.min(MAX_TONES, 255 - slot * MAX_TONES))
}

export function slotToneCount(palette: CosmeticPalette, slot: PaletteSlot): number {
    const overrides = Object.values(palette.colorways).map((colorway) => colorway[slot.id]).filter((ramp): ramp is string[] => Array.isArray(ramp))
    const count = (ramp: string[]) => (blended(slot) && ramp.length >= 2 ? slot.interpolate! : ramp.length)
    return Math.max(count(slot.ramp), ...overrides.map(count))
}

export interface ToneOverflow {
    slot: string
    count: number
    limit: number
}

export function toneOverflows(palette: CosmeticPalette): ToneOverflow[] {
    return palette.slots.slice(0, MAX_INDEXED_SLOTS).flatMap((slot, s) => {
        const count = slotToneCount(palette, slot)
        const limit = toneLimit(s)
        return count > limit ? [{ slot: slot.name || slot.id, count, limit }] : []
    })
}

export interface ShadeClash {
    color: string
    first: string
    second: string
}

export const FIXED_OWNER = 'Fixed colors'

export function shadeClashes(palette: CosmeticPalette): ShadeClash[] {
    const owners = new Map<string, string>()
    const clashes = new Map<string, ShadeClash>()
    const claim = (tone: string, owner: string) => {
        const key = toArgbKey(tone)
        if (!key) return
        const first = owners.get(key)
        if (first === undefined) owners.set(key, owner)
        else if (!clashes.has(key)) clashes.set(key, { color: `#${key}`, first, second: owner })
    }
    palette.slots.slice(0, MAX_INDEXED_SLOTS).forEach((slot) => {
        for (const tone of slotTones(slot).slice(0, MAX_TONES)) claim(tone, slot.name || slot.id)
    })
    for (const color of palette.fixed) claim(color, FIXED_OWNER)
    return [...clashes.values()]
}

export function toneByIndex(palette: CosmeticPalette): Map<number, string> {
    const out = new Map<number, string>()
    palette.slots.slice(0, MAX_INDEXED_SLOTS).forEach((slot, s) => {
        slotTones(slot).slice(0, MAX_TONES).forEach((tone, t) => {
            const key = toArgbKey(tone)
            const value = s * MAX_TONES + t + 1
            if (key && value <= 255) out.set(value, key)
        })
    })
    return out
}

function sameRgb(data: ArrayLike<number>, at: number, key: string): boolean {
    return pixelKey(data, at).slice(2) === key.slice(2)
}

function samePixel(a: ArrayLike<number>, b: ArrayLike<number>, at: number): boolean {
    return a[at] === b[at] && a[at + 1] === b[at + 1] && a[at + 2] === b[at + 2] && a[at + 3] === b[at + 3]
}

export function indexPixels(width: number, height: number, rgba: ArrayLike<number>, palette: CosmeticPalette, stored: ArrayLike<number> | null = null, snapshot: ArrayLike<number> | null = null): IndexedPixels {
    const owners = toneIndex(palette)
    const fixed = new Set(palette.fixed.map((color) => toArgbKey(color)).filter((key): key is string => !!key))
    const loose = brushMatches(palette, owners)
    const tones = toneByIndex(palette)
    const kept = stored && stored.length === width * height ? stored : null
    const seen = kept && snapshot && snapshot.length === width * height * 4 ? snapshot : null
    const index = new Uint8Array(width * height)
    const guessed = new Set<string>()
    let off: OffPalette | null = null
    let painted = 0
    for (let p = 0; p < width * height; p++) {
        const at = p * 4
        if (rgba[at + 3] === 0) continue
        const key = pixelKey(rgba, at)
        const was = kept && (!seen || samePixel(rgba, seen, at)) ? kept[p] : -1
        if (was > 0) {
            const tone = tones.get(was)
            if (tone && sameRgb(rgba, at, tone)) {
                index[p] = was
                painted++
                continue
            }
        }
        if (was === FIXED_INDEX && (fixed.has(key) || loose.get(key) === FIXED_INDEX)) continue
        const value = owners.get(key)
        if (value !== undefined) {
            index[p] = value
            painted++
            guessed.add(key)
            continue
        }
        if (fixed.has(key)) {
            guessed.add(key)
            continue
        }
        const near = loose.get(key)
        if (near !== undefined) {
            index[p] = near
            if (near !== FIXED_INDEX) painted++
            continue
        }
        if (off) off.count++
        else off = { x: p % width, y: Math.floor(p / width), color: `#${key}`, count: 1 }
    }
    return { index, off, painted, guessed }
}

export function slotOfIndex(value: number): { slot: number, tone: number } | null {
    if (value === FIXED_INDEX) return null
    return { slot: Math.floor((value - 1) / MAX_TONES), tone: (value - 1) % MAX_TONES }
}

export function scaledAlpha(alpha: number, from: number, to: number): number {
    const base = from > 0 ? from : 255
    return Math.min(255, Math.floor((alpha * to + Math.floor(base / 2)) / base))
}

function argbOf(key: string): [number, number, number, number] {
    return [parseInt(key.slice(0, 2), 16), parseInt(key.slice(2, 4), 16), parseInt(key.slice(4, 6), 16), parseInt(key.slice(6, 8), 16)]
}

export function moveIndex(index: Uint8Array, before: CosmeticPalette, after: CosmeticPalette): Uint8Array {
    const next = toneByIndex(after)
    const slots = before.slots.map((slot) => after.slots.findIndex((candidate) => candidate.id === slot.id))
    const out = new Uint8Array(index.length)
    for (let p = 0; p < index.length; p++) {
        const place = slotOfIndex(index[p])
        if (!place) continue
        const slot = slots[place.slot] ?? -1
        const value = slot * MAX_TONES + place.tone + 1
        if (slot >= 0 && next.has(value)) out[p] = value
    }
    return out
}

export function recolorIndexed(rgba: Uint8ClampedArray | Uint8Array, index: Uint8Array, before: CosmeticPalette, after: CosmeticPalette, exact: ReadonlyMap<string, string>): { index: Uint8Array, changed: boolean } {
    const old = toneByIndex(before)
    const next = toneByIndex(after)
    const moved = moveIndex(index, before, after)
    const fixed = new Set(before.fixed.map((color) => toArgbKey(color)).filter((key): key is string => !!key))
    const out = new Uint8Array(index.length)
    let changed = false
    const write = (at: number, a: number, r: number, g: number, b: number) => {
        if (rgba[at] === r && rgba[at + 1] === g && rgba[at + 2] === b && rgba[at + 3] === a) return
        rgba[at] = r
        rgba[at + 1] = g
        rgba[at + 2] = b
        rgba[at + 3] = a
        changed = true
    }
    for (let p = 0; p < index.length; p++) {
        const at = p * 4
        if (rgba[at + 3] === 0) continue
        const key = pixelKey(rgba, at)
        const was = index[p]
        const from = was > 0 ? old.get(was) : undefined
        if (from && sameRgb(rgba, at, from)) {
            const value = moved[p]
            const to = value > 0 ? next.get(value) : undefined
            if (!to) continue
            out[p] = value
            const [toA, r, g, b] = argbOf(to)
            write(at, scaledAlpha(rgba[at + 3], argbOf(from)[0], toA), r, g, b)
            continue
        }
        if (was === FIXED_INDEX && fixed.has(key)) continue
        const target = exact.get(key)
        if (!target) continue
        const [a, r, g, b] = argbOf(target)
        write(at, a, r, g, b)
    }
    return { index: out, changed }
}

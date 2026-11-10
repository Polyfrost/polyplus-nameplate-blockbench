import type { PaletteData, Slot } from '../model'
import { hexToArgb, lerpArgb, rgbHex } from '../palette/color'
import { CycleMode, KeysMotion, PaletteMotion, isBaseColor, isHexColor, parseColorRef } from './types'

const SMOOTH_UNITS = 1024
const FALLBACK = '#808080'

function smoothstep(n: number, d: number): number {
    return Math.floor((n * n * (3 * d - 2 * n) * SMOOTH_UNITS) / (d * d * d))
}

export function mixHex(from: string, to: string, amount: number): string {
    const steps = 1000
    return rgbHex(lerpArgb(hexToArgb(from), hexToArgb(to), Math.round(amount * steps), steps))
}

function slotRamp(palette: PaletteData, slot: Slot, colorway: string | null): string[] {
    const override = colorway ? palette.colorways[colorway]?.[slot.id] : undefined
    return override && override.length ? override : slot.ramp
}

export function resolveColor(text: string, palette: PaletteData, colorway: string | null): string {
    if (isHexColor(text)) return rgbHex(hexToArgb(text))
    const ref = parseColorRef(text)
    const slot = ref ? palette.slots.find((entry) => entry.id === ref.slot) : undefined
    if (!ref || !slot) return FALLBACK
    const ramp = slotRamp(palette, slot, colorway)
    const tone = ramp[Math.min(ref.tone, ramp.length - 1)]
    return tone && isHexColor(tone) ? rgbHex(hexToArgb(tone)) : FALLBACK
}

export function resolveKeyColor(text: string, slot: Slot, tone: number, palette: PaletteData, colorway: string | null): string {
    if (!isBaseColor(text)) return resolveColor(text, palette, colorway)
    const ramp = slotRamp(palette, slot, colorway)
    const own = ramp[Math.max(0, Math.min(tone, ramp.length - 1))]
    return own && isHexColor(own) ? rgbHex(hexToArgb(own)) : FALLBACK
}

function shift(mode: CycleMode, tones: number, steps: number): number {
    if (tones <= 1) return 0
    if (mode === 'forward') return steps % tones
    if (mode === 'backward') return -(steps % tones)
    const span = tones - 1
    const position = steps % (2 * span)
    return position <= span ? position : 2 * span - position
}

function keysAt(motion: KeysMotion, slot: Slot, tones: number, frame: number, palette: PaletteData, colorway: string | null): string[] {
    const keys = motion.keys
    let index = 0
    while (index + 1 < keys.length && keys[index + 1].frame <= frame) index++
    const key = keys[index]
    const next = keys[index + 1]
    return Array.from({ length: tones }, (_, tone) => {
        const from = resolveKeyColor(key.colors[Math.min(tone, key.colors.length - 1)], slot, tone, palette, colorway)
        if (!next || frame < key.frame) return from
        const to = resolveKeyColor(next.colors[Math.min(tone, next.colors.length - 1)], slot, tone, palette, colorway)
        const elapsed = frame - key.frame
        const span = next.frame - key.frame
        if (next.ease === 'step') return from
        if (next.ease === 'linear') return rgbHex(lerpArgb(hexToArgb(from), hexToArgb(to), elapsed, span))
        return rgbHex(lerpArgb(hexToArgb(from), hexToArgb(to), smoothstep(elapsed, span), SMOOTH_UNITS))
    })
}

export function colorsAt(
    palette: PaletteData,
    slot: Slot,
    motion: PaletteMotion | undefined,
    frame: number,
    loop: number,
    colorway: string | null,
): string[] {
    const ramp = slotRamp(palette, slot, colorway).map((tone) => resolveColor(tone, palette, null))
    if (!motion || ramp.length === 0) return ramp
    const local = ((frame % Math.max(1, loop)) + Math.max(1, loop)) % Math.max(1, loop)
    if (motion.kind === 'cycle') {
        const tones = ramp.length
        const by = shift(motion.mode, tones, Math.floor(local / Math.max(1, motion.every)))
        return ramp.map((_, tone) => ramp[(((tone + by) % tones) + tones) % tones])
    }
    if (!motion.keys.length) return ramp
    return keysAt(motion, slot, ramp.length, local, palette, colorway)
}

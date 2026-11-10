import type { PaletteData, Slot } from '../model'
import { hexToArgb, rgbHex, toRgbHex } from '../palette/color'
import { mixHex } from './resolve'
import { ColorKey, CycleMode, PaletteMotion, baseColors, everyChoices, toneRef } from './types'

export type EffectId = 'shimmer' | 'pulse' | 'rainbow' | 'fade' | 'cycle' | 'keys' | 'none' | 'tint' | 'flash'
export type Speed = 'fast' | 'medium' | 'slow'

export interface EffectInfo {
    name: string
    help: string
}

export const EFFECTS: Record<EffectId, EffectInfo> = {
    shimmer: {
        name: 'Shimmer',
        help: 'A shine travels across the pixels. Paint with the Sweep brush first, or set a body\'s Fill to Sweep.',
    },
    pulse: {
        name: 'Pulse',
        help: 'Every shade glows one shade lighter and back, like breathing. Colorways pulse in their own colors.',
    },
    rainbow: {
        name: 'Rainbow cycle',
        help: 'Rainbow colors run through the painted pixels. Paint with the Sweep brush for a moving rainbow.',
    },
    fade: {
        name: 'Fade to a color',
        help: 'Every shade fades to the color you pick and back.',
    },
    cycle: {
        name: 'Take turns (custom)',
        help: 'The shades take turns at the speed and direction you choose. Use it to fine-tune a shimmer.',
    },
    keys: {
        name: 'Keyframes (custom)',
        help: 'Set the colors by hand at chosen frames of the loop. Between keyframes they jump or fade.',
    },
    none: {
        name: 'Still',
        help: "The color doesn't change.",
    },
    tint: {
        name: 'Change to a color',
        help: 'Every shade turns toward the color you pick for as long as it plays. Light and dark shades stay apart.',
    },
    flash: {
        name: 'Flash a color, then fade back',
        help: 'Every shade jumps toward your color, then fades back. Good for getting hurt.',
    },
}

export const EFFECT_ORDER: EffectId[] = ['shimmer', 'pulse', 'rainbow', 'fade', 'cycle', 'keys', 'none']
export const REACTION_EFFECTS: EffectId[] = ['tint', 'pulse', 'fade', 'shimmer', 'cycle', 'keys', 'none']
export const ONE_SHOT_EFFECTS: EffectId[] = ['flash', 'tint', 'pulse', 'fade', 'shimmer', 'cycle', 'keys', 'none']
const TINT_AMOUNT = 0.7

export const SPEED_NAMES: Record<Speed, string> = { fast: 'Fast', medium: 'Medium', slow: 'Slow' }

const STEP_SECONDS: Record<Speed, number> = { fast: 0.1, medium: 0.2, slow: 0.4 }
const PULSE_SECONDS: Record<Speed, number> = { fast: 0.5, medium: 1, slow: 2 }
const SHINE_LIGHTEN = 0.6
const PULSE_LIGHTEN = 0.45
const RAINBOW_SATURATION = 0.8
const MIN_LIGHTNESS = 0.45
const MAX_LIGHTNESS = 0.65
const SHINE_REACH = 1.5

export interface EffectOptions {
    effect: EffectId
    speed: Speed
    mode: CycleMode
    shades: number
    shine: boolean
    to: string
}

interface EffectResult {
    motion: PaletteMotion | undefined
    ramp: string[] | null
}

export function isCycleEffect(effect: EffectId): boolean {
    return effect === 'shimmer' || effect === 'rainbow' || effect === 'cycle'
}

export function isPulseEffect(effect: EffectId): boolean {
    return effect === 'pulse' || effect === 'fade'
}

export function picksColor(effect: EffectId): boolean {
    return effect === 'fade' || effect === 'tint' || effect === 'flash'
}

function closest(values: number[], target: number): number {
    return values.reduce((best, value) => {
        const gap = Math.abs(value - target) - Math.abs(best - target)
        return gap < 0 || (gap === 0 && value > best) ? value : best
    }, values[0])
}

function pickEvery(loop: number, mode: CycleMode, tones: number, speed: Speed, fps: number): number {
    const choices = everyChoices(loop, mode, tones)
    if (!choices.length) return 1
    return closest(choices, Math.max(1, Math.round(STEP_SECONDS[speed] * fps)))
}

export function pulseLengths(loop: number): number[] {
    const result: number[] = []
    for (let length = 2; length <= loop; length++) if (loop % length === 0) result.push(length)
    return result.length ? result : [Math.max(1, loop)]
}

function pickPulse(loop: number, speed: Speed, fps: number): number {
    return closest(pulseLengths(loop), PULSE_SECONDS[speed] * fps)
}

export function pulseKeys(own: string[], peak: string[], loop: number, period: number): ColorKey[] {
    const half = Math.max(1, Math.floor(period / 2))
    const keys: ColorKey[] = []
    for (let start = 0; start < loop; start += Math.max(1, period)) {
        keys.push({ frame: start, colors: own.slice(), ease: start === 0 ? 'step' : 'ease' })
        if (start + half < loop) keys.push({ frame: start + half, colors: peak.slice(), ease: 'ease' })
    }
    if (keys[keys.length - 1].frame < loop - 1) keys.push({ frame: loop - 1, colors: own.slice(), ease: 'ease' })
    return keys
}

function hslToHex(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = l - c / 2
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
    const part = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0')
    return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

function lightness(hex: string): number {
    const argb = hexToArgb(hex)
    const r = ((argb >>> 16) & 0xff) / 255
    const g = ((argb >>> 8) & 0xff) / 255
    const b = (argb & 0xff) / 255
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
}

function middle(slot: Slot): string {
    return toRgbHex(slot.ramp[slot.ramp.length >> 1] ?? slot.ramp[0] ?? '#808080')
}

function distinctFrom(colors: string[], taken: Set<string>): string[] {
    const used = new Set(taken)
    return colors.map((color) => {
        let argb = hexToArgb(color)
        let hex = rgbHex(argb)
        for (let attempt = 0; used.has(hex) && attempt < 48; attempt++) {
            const shift = (attempt % 3) * 8
            const channel = (argb >>> shift) & 0xff
            const next = channel >= 255 ? channel - 1 - Math.floor(attempt / 3) : channel + 1
            argb = ((argb & ~(0xff << shift)) | (Math.max(0, Math.min(255, next)) << shift)) >>> 0
            hex = rgbHex(argb)
        }
        used.add(hex)
        return hex
    })
}

function otherColors(palette: PaletteData, slot: Slot): Set<string> {
    const taken = new Set<string>()
    for (const entry of palette.slots) {
        if (entry.id === slot.id) continue
        for (const tone of entry.ramp) taken.add(toRgbHex(tone).toUpperCase())
    }
    return taken
}

function rainbowRamp(slot: Slot, palette: PaletteData, count: number): string[] {
    const l = Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, lightness(middle(slot))))
    const colors = Array.from({ length: count }, (_, index) => hslToHex((index * 360) / count, RAINBOW_SATURATION, l))
    return distinctFrom(colors, otherColors(palette, slot))
}

function shineRamp(slot: Slot, palette: PaletteData, count: number): string[] {
    const base = middle(slot)
    const highlight = mixHex(base, '#FFFFFF', SHINE_LIGHTEN)
    const center = Math.floor(count / 2)
    const colors = Array.from({ length: count }, (_, index) => mixHex(base, highlight, Math.max(0, 1 - Math.abs(index - center) / SHINE_REACH)))
    return distinctFrom(colors, otherColors(palette, slot))
}

export function bestRainbowCount(loop: number, mode: CycleMode): number {
    const preferred = [6, 8, 5, 4, 10, 12, 3, 16, 2]
    return preferred.find((count) => everyChoices(loop, mode, count).length > 0) ?? 6
}

export function buildEffect(options: EffectOptions, slot: Slot, palette: PaletteData, loop: number, fps: number): EffectResult {
    const effect = options.effect
    if (effect === 'none') return { motion: undefined, ramp: null }
    if (isCycleEffect(effect)) {
        let ramp: string[] | null = null
        if (effect === 'rainbow') ramp = rainbowRamp(slot, palette, Math.max(2, Math.min(16, options.shades)))
        if (effect === 'shimmer' && options.shine) ramp = shineRamp(slot, palette, Math.max(3, Math.min(16, options.shades)))
        const mode = options.mode
        const tones = ramp ? ramp.length : slot.ramp.length
        return { motion: { kind: 'cycle', every: pickEvery(loop, mode, tones, options.speed, fps), mode }, ramp }
    }
    const tones = Math.max(1, slot.ramp.length)
    const own = baseColors(tones)
    if (effect === 'tint' || effect === 'flash') {
        const to = toRgbHex(options.to).toUpperCase()
        const tinted = own.map((_, tone) => mixHex(toRgbHex(slot.ramp[tone] ?? to), to, TINT_AMOUNT))
        const keys: ColorKey[] = [{ frame: 0, colors: tinted, ease: 'step' }]
        if (effect === 'flash' && loop > 1) keys.push({ frame: loop - 1, colors: own, ease: 'linear' })
        return { motion: { kind: 'keys', keys }, ramp: null }
    }
    if (effect === 'keys') {
        const existing = slot.animation?.kind === 'keys' ? slot.animation.keys : null
        return { motion: { kind: 'keys', keys: existing ?? [{ frame: 0, colors: own, ease: 'step' }] }, ramp: null }
    }
    const period = pickPulse(loop, options.speed, fps)
    let peak: string[]
    if (effect === 'fade') peak = own.map(() => toRgbHex(options.to).toUpperCase())
    else if (tones >= 2) peak = own.map((_, tone) => toneRef(slot.id, Math.min(tone + 1, tones - 1)))
    else peak = [mixHex(middle(slot), '#FFFFFF', PULSE_LIGHTEN)]
    return { motion: { kind: 'keys', keys: pulseKeys(own, peak, loop, period) }, ramp: null }
}

export function effectOf(motion: PaletteMotion | undefined): EffectId {
    if (!motion) return 'shimmer'
    return motion.kind === 'cycle' ? 'cycle' : 'keys'
}

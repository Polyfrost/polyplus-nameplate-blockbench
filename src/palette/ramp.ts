import { MAX_TONES } from './ids'
import { alphaOf, byteHex, toRgbHex, withAlpha } from './color'
import { clamp } from '../util/num'

const SHADOW_HUE = 240
const LIGHT_HUE = 50
const MAX_HUE_SHIFT = 25
const DARK_LIGHTNESS_SCALE = 0.35
const MIN_DARK_LIGHTNESS = 0.06
const LIGHT_LIGHTNESS_REACH = 0.75
const MAX_LIGHT_LIGHTNESS = 0.96
const SHADOW_SATURATION_GAIN = 0.15
const LIGHT_SATURATION_LOSS = 0.3

interface Hsl {
    h: number
    s: number
    l: number
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    const delta = max - min
    if (delta === 0) return { h: 0, s: 0, l }
    const s = delta / (1 - Math.abs(2 * l - 1))
    let h: number
    if (max === rn) h = ((gn - bn) / delta) % 6
    else if (max === gn) h = (bn - rn) / delta + 2
    else h = (rn - gn) / delta + 4
    h *= 60
    if (h < 0) h += 360
    return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s
    const hp = (((h % 360) + 360) % 360) / 60
    const x = c * (1 - Math.abs((hp % 2) - 1))
    let r = 0
    let g = 0
    let b = 0
    if (hp < 1) [r, g, b] = [c, x, 0]
    else if (hp < 2) [r, g, b] = [x, c, 0]
    else if (hp < 3) [r, g, b] = [0, c, x]
    else if (hp < 4) [r, g, b] = [0, x, c]
    else if (hp < 5) [r, g, b] = [x, 0, c]
    else [r, g, b] = [c, 0, x]
    const m = l - c / 2
    return [r + m, g + m, b + m].map((v) => Math.round(clamp(v, 0, 1) * 255)) as [number, number, number]
}

function shortestHueDelta(from: number, to: number): number {
    return ((((to - from) % 360) + 540) % 360) - 180
}

function shiftHue(hue: number, target: number, amount: number): number {
    const delta = shortestHueDelta(hue, target)
    const step = Math.min(Math.abs(delta), amount)
    return hue + Math.sign(delta) * step
}

function toHex(r: number, g: number, b: number): string {
    return `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`
}

export function suggestRamp(base: string, tones: number): string[] {
    const count = clamp(Math.floor(Number(tones)) || 1, 1, MAX_TONES)
    const rgb = toRgbHex(base)
    const alpha = alphaOf(base)
    const tone = (red: number, green: number, blue: number) => withAlpha(toHex(red, green, blue), alpha)
    const r = parseInt(rgb.slice(1, 3), 16)
    const g = parseInt(rgb.slice(3, 5), 16)
    const b = parseInt(rgb.slice(5, 7), 16)
    if (count === 1) return [tone(r, g, b)]
    const hsl = rgbToHsl(r, g, b)
    const middle = Math.round((count - 1) / 2)
    const darkEnd = Math.min(hsl.l, Math.max(MIN_DARK_LIGHTNESS, hsl.l * DARK_LIGHTNESS_SCALE))
    const lightEnd = Math.max(hsl.l, Math.min(MAX_LIGHT_LIGHTNESS, hsl.l + (1 - hsl.l) * LIGHT_LIGHTNESS_REACH))
    const ramp: string[] = []
    for (let index = 0; index < count; index++) {
        if (index === middle) {
            ramp.push(tone(r, g, b))
            continue
        }
        const dark = index < middle
        const progress = dark ? (middle - index) / middle : (index - middle) / (count - 1 - middle)
        const lightness = hsl.l + ((dark ? darkEnd : lightEnd) - hsl.l) * progress
        const hue = shiftHue(hsl.h, dark ? SHADOW_HUE : LIGHT_HUE, MAX_HUE_SHIFT * progress)
        const saturation = clamp(
            dark ? hsl.s * (1 + SHADOW_SATURATION_GAIN * progress) : hsl.s * (1 - LIGHT_SATURATION_LOSS * progress),
            0,
            1,
        )
        const [rr, gg, bb] = hslToRgb(hue, saturation, lightness)
        ramp.push(tone(rr, gg, bb))
    }
    return ramp
}

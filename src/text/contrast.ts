import type { NameplateData } from '../model'
import { luminance } from '../palette/color'
import { BadgeSettings, DEFAULT_CANDIDATES, TextSettings } from './types'

const SHADOW_BELOW = 4.5
export const OUTLINE_BELOW = 3.0
const MAX_RATIO = 21
export const BACKDROP_GRAY = 0x808080
const ART_RGB = 0xd6d6d6
export const WHITE_RGB = 0xffffff

type Decoration = 'none' | 'shadow' | 'outline'
type ShadowUse = 'leave' | 'always' | 'with_drop_shadow' | 'remove'

export interface ResolvedText {
    color: number | null
    textRgb: number
    shadow: number | null
    shadowUse: ShadowUse
    outline: number | null
    minRatio: number
    decoration: Decoration
}

export interface ResolvedBadge {
    tint: number | null
    badgeRgb: number
    decoration: Decoration
    decorationRgb: number
    minRatio: number
    forced: boolean
}

function ratioOf(a: number, b: number): number {
    return a >= b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05)
}

export function ratio(a: number, b: number): number {
    return ratioOf(luminance(a), luminance(b))
}

export function compositeOver(argb: number, backdrop: number): number {
    const alpha = (argb >>> 24) & 0xff
    const inverse = 255 - alpha
    const blend = (shift: number) => Math.floor((((argb >> shift) & 0xff) * alpha + ((backdrop >> shift) & 0xff) * inverse + 127) / 255)
    return (blend(16) << 16) | (blend(8) << 8) | blend(0)
}

export function minRatio(rgb: number, pixels: number[]): number {
    const own = luminance(rgb)
    let min = MAX_RATIO
    for (const pixel of pixels) min = Math.min(min, ratioOf(own, luminance(pixel)))
    return min
}

export function decorationFor(min: number): Decoration {
    if (min >= SHADOW_BELOW) return 'none'
    if (min >= OUTLINE_BELOW) return 'shadow'
    return 'outline'
}

function bestBy(candidates: number[], score: (rgb: number) => number): { color: number, score: number } {
    let color = candidates[0]
    let top = score(color)
    for (let i = 1; i < candidates.length; i++) {
        const next = score(candidates[i])
        if (next > top) {
            color = candidates[i]
            top = next
        }
    }
    return { color, score: top }
}

function choose(pixels: number[], candidates: number[]): { color: number, minRatio: number } {
    if (pixels.length === 0) return { color: candidates[0], minRatio: MAX_RATIO }
    const best = bestBy(candidates, (rgb) => minRatio(rgb, pixels))
    return { color: best.color, minRatio: best.score }
}

function opposite(rgb: number, candidates: number[]): number {
    const own = luminance(rgb)
    return bestBy(candidates, (candidate) => ratioOf(own, luminance(candidate))).color
}

export function parseRgb(hex: string): number | null {
    const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(hex.trim())
    if (!match) return null
    return parseInt(match[1].slice(-6), 16)
}

export type ColorResolver = (ref: string) => number | null

export function colorResolver(plate: NameplateData, colorway: string | null): ColorResolver {
    return (ref: string) => {
        if (ref.startsWith('#')) return parseRgb(ref)
        const match = /^([a-z0-9_]{1,64})(?:\[(\d{1,2})\])?$/.exec(ref)
        if (!match) return null
        const slot = plate.palette.slots.find((entry) => entry.id === match[1])
        if (!slot) return null
        const override = colorway ? plate.palette.colorways[colorway]?.[slot.id] : undefined
        const ramp = override && override.length ? override : slot.ramp
        const tone = Number(match[2] ?? 0)
        const hex = ramp[Math.min(tone, ramp.length - 1)]
        return hex ? parseRgb(hex) : null
    }
}

function paintOf(ref: string, resolve: ColorResolver): 'none' | 'auto' | number {
    if (ref === 'none') return 'none'
    if (ref === 'auto') return 'auto'
    return resolve(ref) ?? 'none'
}

export function candidateColors(list: string[] | null, resolve: ColorResolver): number[] {
    const refs = list ?? DEFAULT_CANDIDATES
    const colors = refs.map(resolve).filter((value): value is number => value !== null)
    return colors.length ? colors : DEFAULT_CANDIDATES.map((hex) => parseRgb(hex)!)
}

export function resolveText(text: TextSettings, pixels: number[], resolve: ColorResolver): ResolvedText {
    const candidates = candidateColors(text.candidates, resolve)
    const color = paintOf(text.color, resolve)
    const shadow = paintOf(text.shadow, resolve)
    const outline = paintOf(text.outline, resolve)
    let glyph: number | null = null
    let textRgb: number
    let min: number
    if (color === 'auto') {
        const choice = choose(pixels, candidates)
        glyph = choice.color
        textRgb = glyph
        min = choice.minRatio
    } else if (typeof color === 'number') {
        glyph = color
        textRgb = color
        min = minRatio(color, pixels)
    } else {
        textRgb = WHITE_RGB
        min = minRatio(textRgb, pixels)
    }
    const decoration = decorationFor(min)
    const other = opposite(textRgb, candidates)
    const outlined = typeof outline === 'number' || (outline === 'auto' && (decoration === 'outline' || (decoration === 'shadow' && shadow === 'none')))
    const outlineRgb = typeof outline === 'number' ? outline : outlined ? other : null
    let shadowRgb: number | null = null
    let shadowUse: ShadowUse = 'leave'
    if (outlined) {
        shadowUse = 'remove'
    } else if (typeof shadow === 'number') {
        shadowRgb = shadow
        shadowUse = 'always'
    } else if (shadow === 'auto') {
        shadowRgb = other
        shadowUse = decoration === 'none' ? 'with_drop_shadow' : 'always'
    }
    return { color: glyph, textRgb, shadow: shadowRgb, shadowUse, outline: outlineRgb, minRatio: min, decoration }
}

export function resolveBadge(badge: BadgeSettings, pixels: number[], resolve: ColorResolver): ResolvedBadge {
    const tint = badge.tint === 'none' ? null : resolve(badge.tint)
    const badgeRgb = tint ?? ART_RGB
    const min = minRatio(badgeRgb, pixels)
    const fixed = badge.decorationColor ? resolve(badge.decorationColor) ?? 0 : 0
    const edge = () => opposite(badgeRgb, candidateColors(badge.candidates, resolve))
    let decoration: Decoration
    let decorationRgb: number
    switch (badge.decoration) {
        case 'shadow':
        case 'outline':
            decoration = badge.decoration
            decorationRgb = fixed
            break
        case 'auto':
            decoration = decorationFor(min)
            decorationRgb = edge()
            break
        default:
            decoration = 'none'
            decorationRgb = 0
    }
    if (min < OUTLINE_BELOW && decoration !== 'outline') {
        return { tint, badgeRgb, decoration: 'outline', decorationRgb: edge(), minRatio: min, forced: true }
    }
    return { tint, badgeRgb, decoration, decorationRgb, minRatio: min, forced: false }
}

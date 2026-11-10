import { toRgbHex } from '../palette/color'
import { parseJsonOrNull } from '../util/json'

export interface VariantSwatch {
    variant: string
    colors: string[]
    flag: boolean
}

export const MAX_SWATCH_STRIPES = 3

interface Slot {
    id: string
    ramp: string[]
}

function slotsOf(palettes: any, colorway: string | undefined): Slot[] {
    const slots: any[] = Array.isArray(palettes?.slots) ? palettes.slots : []
    const overrides = colorway ? palettes?.colorways?.[colorway] ?? {} : {}
    return slots
        .filter((slot) => slot && typeof slot.id === 'string')
        .map((slot) => {
            const ramp = Array.isArray(overrides[slot.id]) ? overrides[slot.id] : Array.isArray(slot.ramp) ? slot.ramp : []
            return { id: slot.id, ramp: ramp.map(String) }
        })
}

function resolve(ref: unknown, slots: Slot[]): string | null {
    const text = String(ref ?? '').trim()
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text)) return toRgbHex(text).toUpperCase()
    const match = /^([a-z0-9_]{1,64})(?:\[(\d{1,2})\])?$/.exec(text)
    if (!match) return null
    const slot = slots.find((entry) => entry.id === match[1])
    const tone = match[2] ? parseInt(match[2], 10) : 0
    const color = slot?.ramp[Math.min(tone, Math.max(0, (slot?.ramp.length ?? 1) - 1))]
    return color ? toRgbHex(color).toUpperCase() : null
}

export function variantSwatches(files: Record<string, string>): VariantSwatch[] {
    const manifest = parseJsonOrNull(files['manifest.json'])
    const palettes = parseJsonOrNull(files['palettes.json'])
    const flags: any[] = Array.isArray(parseJsonOrNull(files['flags.json'])?.flags) ? parseJsonOrNull(files['flags.json']).flags : []
    const variants = manifest?.variants && typeof manifest.variants === 'object' ? manifest.variants : {}
    const names = Object.keys(variants)
    return (names.length ? names : ['default']).map((variant) => {
        const entry = variants[variant] ?? {}
        const slots = slotsOf(palettes, typeof entry.palette === 'string' ? entry.palette : undefined)
        const flag = typeof entry.flag === 'string' ? flags.find((candidate) => candidate?.id === entry.flag) : null
        if (flag && Array.isArray(flag.bands)) {
            const colors = flag.bands.map((band: any) => resolve(band?.color, slots)).filter((color: string | null): color is string => !!color)
            if (colors.length) return { variant, colors, flag: true }
        }
        const colors = slots
            .map((slot) => (slot.ramp[0] ? toRgbHex(slot.ramp[0]).toUpperCase() : null))
            .filter((color): color is string => !!color)
            .slice(0, MAX_SWATCH_STRIPES)
        return { variant, colors, flag: false }
    })
}

export interface SwatchCard {
    variant: string
    x: number
    y: number
    size: number
}

export const SWATCH_SIZE = 28
export const SWATCH_GAP = 8
export const SWATCH_LABEL = 14

export function layoutSwatches(swatches: VariantSwatch[], width: number, bottom: number): SwatchCard[] {
    const total = swatches.length * SWATCH_SIZE + Math.max(0, swatches.length - 1) * SWATCH_GAP
    const left = Math.round((width - total) / 2)
    return swatches.map((swatch, index) => ({
        variant: swatch.variant,
        x: left + index * (SWATCH_SIZE + SWATCH_GAP),
        y: bottom - SWATCH_SIZE - SWATCH_LABEL,
        size: SWATCH_SIZE,
    }))
}

export function drawSwatches(ctx: CanvasRenderingContext2D, swatches: VariantSwatch[], cards: SwatchCard[], selected: string, accent: string, text: string) {
    ctx.save()
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    swatches.forEach((swatch, index) => {
        const card = cards[index]
        if (!card) return
        const colors = swatch.colors.length ? swatch.colors : ['#808080']
        const band = card.size / colors.length
        colors.forEach((color, row) => {
            ctx.fillStyle = color
            ctx.fillRect(card.x, Math.round(card.y + row * band), card.size, Math.ceil(band))
        })
        ctx.lineWidth = swatch.variant === selected ? 2 : 1
        ctx.strokeStyle = swatch.variant === selected ? accent : 'rgba(255, 255, 255, 0.35)'
        ctx.strokeRect(card.x + 0.5, card.y + 0.5, card.size - 1, card.size - 1)
        ctx.fillStyle = text
        ctx.fillText(swatch.variant, card.x + card.size / 2, card.y + card.size + 2, card.size + SWATCH_GAP)
    })
    ctx.restore()
}

export function swatchAt(cards: SwatchCard[], x: number, y: number): string | null {
    for (const card of cards) {
        if (x >= card.x && y >= card.y && x < card.x + card.size && y < card.y + card.size + SWATCH_LABEL) return card.variant
    }
    return null
}

const MODEL_PIXEL = 4.5

export function drawPlayer(ctx: CanvasRenderingContext2D, centerX: number, headTop: number, fontScale: number) {
    const unit = (MODEL_PIXEL * fontScale) / 2
    const part = (x: number, y: number, w: number, h: number, color: string) => {
        ctx.fillStyle = color
        ctx.fillRect(Math.round(centerX + x * unit), Math.round(headTop + y * unit), Math.round(w * unit), Math.round(h * unit))
    }
    ctx.save()
    part(-4, 0, 8, 8, '#8B8F99')
    part(-4, 8, 8, 12, '#6C717C')
    part(-8, 8, 4, 12, '#7B808A')
    part(4, 8, 4, 12, '#7B808A')
    part(-4, 20, 4, 12, '#5A5F69')
    part(0, 20, 4, 12, '#545862')
    ctx.restore()
}

export function playerHeight(fontScale: number): number {
    return 32 * (MODEL_PIXEL * fontScale) / 2
}

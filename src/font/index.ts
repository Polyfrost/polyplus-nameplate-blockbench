import regular from '../../assets/fonts/Minecraft-Regular.otf'
import { createListenerSet } from '../util/events'
import { ADVANCES, DEFAULT_ADVANCE } from './glyphs'

const GLYPH_ASCENT = 7
const GLYPH_HEIGHT = 8
const SHADOW_OFFSET = 1

const FAMILY = 'PolyPlus Nameplate Minecraft'
const EM_PIXELS = 10
const SHADOW_SCALE = 0.25
const SAMPLE = 8
const MASK_PAD = 4
const ALPHA_CUTOFF = 128

interface GlyphRun {
    x: number
    y: number
    width: number
}

const state: { face: FontFace | null, ready: boolean, sampler: CanvasRenderingContext2D | null } = { face: null, ready: false, sampler: null }
const masks = new Map<string, GlyphRun[]>()
const listeners = createListenerSet('font listener failed')

export function advanceOf(char: string): number {
    return ADVANCES.get(char) ?? DEFAULT_ADVANCE
}

export function measure(text: string): number {
    let width = 0
    for (const char of String(text ?? '')) width += advanceOf(char)
    return width
}

export function onFontReady(listener: () => void): () => void {
    return listeners.on(listener)
}

export function registerFont() {
    if (state.face || typeof FontFace === 'undefined' || typeof document === 'undefined') return
    const face = new FontFace(FAMILY, regular)
    state.face = face
    document.fonts.add(face)
    face.load().then(
        () => {
            if (state.face !== face) return
            masks.clear()
            state.ready = true
            listeners.notify()
        },
        (error) => console.error('[polyplus_nameplate] font load failed', error),
    )
}

export function unregisterFont() {
    if (state.face) document.fonts.delete(state.face)
    state.face = null
    state.ready = false
    state.sampler = null
    masks.clear()
    listeners.clear()
}

export function shadowOf(color: string): string {
    const match = /^#([0-9a-f]{6})$/i.exec(color.trim())
    if (!match) return color
    const value = parseInt(match[1], 16)
    const channel = (shift: number) => Math.floor(((value >> shift) & 0xff) * SHADOW_SCALE).toString(16).padStart(2, '0')
    return `#${channel(16)}${channel(8)}${channel(0)}`
}

function sampler(): CanvasRenderingContext2D | null {
    if (state.sampler) return state.sampler
    const canvas = document.createElement('canvas')
    state.sampler = canvas.getContext('2d', { willReadFrequently: true })
    return state.sampler
}

function maskOf(char: string): GlyphRun[] {
    const cached = masks.get(char)
    if (cached) return cached
    const ctx = sampler()
    if (!ctx) return []
    const columns = Math.max(advanceOf(char), GLYPH_HEIGHT) + MASK_PAD * 2
    const rows = GLYPH_HEIGHT + MASK_PAD * 2
    ctx.canvas.width = columns * SAMPLE
    ctx.canvas.height = rows * SAMPLE
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.font = `${EM_PIXELS * SAMPLE}px "${FAMILY}", monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(char, MASK_PAD * SAMPLE, (MASK_PAD + GLYPH_ASCENT) * SAMPLE)
    const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
    const width = ctx.canvas.width
    const center = Math.floor(SAMPLE / 2)
    const runs: GlyphRun[] = []
    for (let row = 0; row < rows; row++) {
        let start = -1
        for (let column = 0; column <= columns; column++) {
            const on = column < columns && data[((row * SAMPLE + center) * width + column * SAMPLE + center) * 4 + 3] >= ALPHA_CUTOFF
            if (on && start < 0) start = column
            if (!on && start >= 0) {
                runs.push({ x: start - MASK_PAD, y: row - MASK_PAD, width: column - start })
                start = -1
            }
        }
    }
    masks.set(char, runs)
    return runs
}

function drawGlyphs(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string) {
    ctx.fillStyle = color
    let cursor = 0
    for (const char of text) {
        for (const run of maskOf(char)) ctx.fillRect(x + (cursor + run.x) * scale, y + run.y * scale, run.width * scale, scale)
        cursor += advanceOf(char)
    }
}

export interface TextStyle {
    color: string
    shadow: string | null
    outline: string | null
}

const OUTLINE_OFFSETS: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]

export function textStyle(color: string, shadow = true): TextStyle {
    return { color, shadow: shadow ? shadowOf(color) : null, outline: null }
}

export function drawStyledText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, style: TextStyle) {
    if (!state.ready || !text) return
    ctx.save()
    if (style.outline) {
        for (const [dx, dy] of OUTLINE_OFFSETS) drawGlyphs(ctx, text, x + dx * scale, y + dy * scale, scale, style.outline)
    }
    if (style.shadow) drawGlyphs(ctx, text, x + SHADOW_OFFSET * scale, y + SHADOW_OFFSET * scale, scale, style.shadow)
    drawGlyphs(ctx, text, x, y, scale, style.color)
    ctx.restore()
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string, shadow = true) {
    drawStyledText(ctx, text, x, y, scale, textStyle(color, shadow))
}

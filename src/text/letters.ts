import type { NameplateBlock, NameplateDetail, NameplatePreview, NameplateTagState } from '../engine'
import { advanceOf, drawStyledText, shadowOf, TextStyle } from '../font'
import { eraTextColor } from '../gpu'
import { currentLook } from '../preview/options'
import { rgbHex } from '../palette/color'

const LETTER_KEEP = -1
const LETTER_OFF = -2
const MAX_LETTERS = 24
const LETTER_HALF_HEIGHT = 4

type LetterMode = 'motion' | 'owned'

interface LetterFrame {
    count: number
    moving: boolean
    dx: Int32Array
    dy: Int32Array
    opacity: Int32Array
    color: Int32Array
    shadow: Int32Array
    outline: Int32Array
    scale: Float64Array
    rotation: Int32Array
}

export interface NameLetters {
    mode: LetterMode
    frame: LetterFrame
}

type LetterSource = {
    letters?: (
        variant: string,
        block: NameplateBlock,
        frame: number,
        seed: number,
        glyphX: Int32Array,
        glyphWidth: Int32Array,
        state?: NameplateTagState | null,
        detail?: NameplateDetail,
    ) => (LetterFrame & { mode: string }) | null
}

interface GlyphLayout {
    chars: string[]
    glyphX: Int32Array
    glyphWidth: Int32Array
}

interface LetterRunOp {
    kind: 'run'
    text: string
    x: number
    y: number
    opacity: number
}

interface LetterGlyphOp {
    kind: 'letter'
    text: string
    centerX: number
    centerY: number
    half: number
    rotation: number
    scale: number
    opacity: number
    color: number
    shadow: number
    outline: number
}

type LetterOp = LetterRunOp | LetterGlyphOp

interface LetterLook {
    detail: NameplateDetail
    still: boolean
}

function glyphLayout(text: string): GlyphLayout {
    const chars = Array.from(String(text ?? ''))
    const glyphX = new Int32Array(chars.length)
    const glyphWidth = new Int32Array(chars.length)
    let cursor = 0
    chars.forEach((char, index) => {
        glyphX[index] = cursor
        glyphWidth[index] = advanceOf(char)
        cursor += glyphWidth[index]
    })
    return { chars, glyphX, glyphWidth }
}

export function paintLetters(
    preview: NameplatePreview,
    variant: string,
    block: NameplateBlock,
    frame: number,
    seed: number,
    state: NameplateTagState | null,
    look: LetterLook,
    name: string,
    otherRuns = 0,
): NameLetters | null {
    const source = (preview as NameplatePreview & LetterSource).letters
    if (typeof source !== 'function' || currentLook().legacy) return null
    const layout = glyphLayout(name)
    if (!layout.chars.length || layout.chars.length > MAX_LETTERS) return null
    try {
        const result = source.call(preview, variant, block, look.still ? 0 : frame, seed, layout.glyphX, layout.glyphWidth, state, look.detail)
        if (!result || !result.moving || result.count !== layout.chars.length) return null
        if (result.mode !== 'owned' && result.mode !== 'motion') return null
        const owned = result.mode === 'owned' && layout.chars.length + otherRuns <= MAX_LETTERS
        return { mode: owned ? 'owned' : 'motion', frame: result }
    } catch (error) {
        console.error('[polyplus_nameplate] letter preview failed', error)
        return null
    }
}

function sameRun(frame: LetterFrame, a: number, b: number): boolean {
    return frame.dx[a] === frame.dx[b] && frame.dy[a] === frame.dy[b] && frame.opacity[a] === frame.opacity[b]
}

function letterOps(text: string, letters: NameLetters): LetterOp[] | null {
    const layout = glyphLayout(text)
    const frame = letters.frame
    if (frame.count !== layout.chars.length) return null
    const ops: LetterOp[] = []
    if (letters.mode === 'owned') {
        layout.chars.forEach((char, index) => {
            if (frame.opacity[index] <= 0) return
            const half = layout.glyphWidth[index] / 2
            ops.push({
                kind: 'letter',
                text: char,
                centerX: layout.glyphX[index] + frame.dx[index] + half,
                centerY: frame.dy[index] + LETTER_HALF_HEIGHT,
                half,
                rotation: frame.rotation[index],
                scale: frame.scale[index],
                opacity: frame.opacity[index],
                color: frame.color[index],
                shadow: frame.shadow[index],
                outline: frame.outline[index],
            })
        })
        return ops
    }
    let from = 0
    while (from < layout.chars.length) {
        let to = from + 1
        while (to < layout.chars.length && sameRun(frame, from, to)) to++
        if (frame.opacity[from] > 0) {
            ops.push({
                kind: 'run',
                text: layout.chars.slice(from, to).join(''),
                x: layout.glyphX[from] + frame.dx[from],
                y: frame.dy[from],
                opacity: frame.opacity[from],
            })
        }
        from = to
    }
    return ops
}

function letterStyle(style: TextStyle, op: LetterGlyphOp): TextStyle {
    const derived = !!style.shadow && style.shadow.toUpperCase() === shadowOf(style.color).toUpperCase()
    const color = op.color >= 0 ? eraTextColor(rgbHex(op.color)) : style.color
    const outline = op.outline === LETTER_KEEP ? style.outline : op.outline === LETTER_OFF ? null : eraTextColor(rgbHex(op.outline))
    let shadow: string | null
    if (outline) shadow = null
    else if (op.shadow === LETTER_OFF) shadow = null
    else if (op.shadow >= 0) shadow = eraTextColor(rgbHex(op.shadow))
    else shadow = style.shadow && derived ? shadowOf(color) : style.shadow
    return { color, shadow, outline }
}

export function drawLetters(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, style: TextStyle, letters: NameLetters | null | undefined) {
    const ops = letters ? letterOps(text, letters) : null
    if (!ops) {
        drawStyledText(ctx, text, x, y, scale, style)
        return
    }
    for (const op of ops) {
        ctx.save()
        ctx.globalAlpha *= op.opacity / 255
        if (op.kind === 'run') {
            drawStyledText(ctx, op.text, x + op.x * scale, y + op.y * scale, scale, style)
        } else {
            ctx.translate(x + op.centerX * scale, y + op.centerY * scale)
            if (op.rotation) ctx.rotate((op.rotation * Math.PI) / 180)
            if (op.scale !== 1) ctx.scale(op.scale, op.scale)
            drawStyledText(ctx, op.text, -op.half * scale, -LETTER_HALF_HEIGHT * scale, scale, letterStyle(style, op))
        }
        ctx.restore()
    }
}

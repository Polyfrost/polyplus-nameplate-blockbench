import { ALIGN_CENTER, ALIGN_LEFT, ALIGN_RIGHT, FLAG_BADGE, FLAG_DISPLAY, GLYPH_HEIGHT, tagRow } from '@plusrenderer/renderer/nameplate.js'

export type LineAlign = 'left' | 'center' | 'right'

export interface BlockRect {
    x0: number
    y0: number
    x1: number
    y1: number
}

export interface NameplateBlock {
    readonly width: number
    readonly height: number
    readonly display: boolean
    readonly lines: readonly number[]
    readonly nameLine: number
    readonly align: LineAlign
    readonly nameX: number
    readonly nameWidth: number
    readonly prefixWidth: number
    readonly badge: boolean
    readonly background: BlockRect
    readonly shiftX: number
    readonly shiftY: number
}

const LINE_PITCH = 10
const BADGE_ADVANCE = 11
const ALIGNS: Record<LineAlign, number> = { left: ALIGN_LEFT, center: ALIGN_CENTER, right: ALIGN_RIGHT }

function doubledOffset(align: LineAlign, widest: number, width: number): number {
    if (align === 'left') return 0
    if (align === 'right') return 2 * (widest - width)
    return widest - width
}

export function lineBlock(textWidth: number, nameX: number, nameWidth: number): NameplateBlock {
    const width = Math.max(0, Math.round(textWidth))
    return Object.freeze({
        width,
        height: GLYPH_HEIGHT,
        display: false,
        lines: Object.freeze([width]),
        nameLine: 0,
        align: 'left',
        nameX: Math.round(nameX),
        nameWidth: Math.max(0, Math.round(nameWidth)),
        prefixWidth: 0,
        badge: false,
        background: Object.freeze({ x0: -1, y0: -1, x1: width, y1: GLYPH_HEIGHT + 1 }),
        shiftX: 0,
        shiftY: 0,
    })
}

export function displayBlock(
    widths: number[],
    maxWidth: number,
    align: LineAlign,
    nameLine: number,
    nameX: number,
    nameWidth: number,
    badge: boolean,
): NameplateBlock {
    const lines = widths.slice(0, 3).map((width) => Math.max(0, Math.round(width)))
    const name = Math.min(Math.max(0, nameLine), Math.max(0, lines.length - 1))
    const widest = Math.max(Math.round(maxWidth), ...lines, 0)
    const nameOffset = doubledOffset(align, widest, lines[name] ?? 0)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    lines.forEach((width, index) => {
        if (index !== name && width <= 0) return
        const relative = doubledOffset(align, widest, width) - nameOffset
        const y = (index - name) * LINE_PITCH
        x0 = Math.min(x0, Math.floor(relative / 2))
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, Math.ceil((relative + 2 * width) / 2))
        y1 = Math.max(y1, y + GLYPH_HEIGHT)
    })
    if (!isFinite(x0)) {
        x0 = 0
        y0 = 0
        x1 = 0
        y1 = GLYPH_HEIGHT
    }
    if (badge) x0 = Math.min(x0, -BADGE_ADVANCE)
    return Object.freeze({
        width: x1 - x0,
        height: y1 - y0,
        display: true,
        lines: Object.freeze(lines),
        nameLine: name,
        align,
        nameX: Math.round(nameX),
        nameWidth: Math.max(0, Math.round(nameWidth)),
        prefixWidth: 0,
        badge,
        background: Object.freeze({ x0: x0 - 1, y0: y0 - 1, x1, y1: y1 + 1 }),
        shiftX: -x0,
        shiftY: -y0,
    })
}

export function placedBlock(block: NameplateBlock, prefixWidth: number, background: BlockRect): NameplateBlock {
    return Object.freeze({
        ...block,
        prefixWidth: Math.max(0, Math.round(prefixWidth)),
        background: Object.freeze({
            x0: Math.round(background.x0) - block.shiftX,
            y0: Math.round(background.y0) - block.shiftY,
            x1: Math.round(background.x1) - block.shiftX,
            y1: Math.round(background.y1) - block.shiftY,
        }),
    })
}

export function blockRow(block: NameplateBlock, asset: number, variant: number, flags = 0): Int32Array {
    const background = block.background
    return tagRow({
        asset,
        variant,
        flags: flags | (block.display ? FLAG_DISPLAY : 0) | (block.badge ? FLAG_BADGE : 0),
        lines: block.lines.slice(),
        nameLine: block.nameLine,
        align: ALIGNS[block.align],
        nameX: block.nameX,
        nameWidth: block.nameWidth,
        prefixWidth: block.prefixWidth,
        background: [background.x0, background.y0, background.x1, background.y1],
    })
}

import { describe, drawRasterLayer, layerBounds, loadBundle, NameplateLayer, NameplatePreview } from '../engine'
import { plainMessage } from '../checks/words'
import { CrowdLayout, layoutTag as crowdLayoutTag, TextRun } from '../preview/crowd'
import { paintFillJson } from '../elements/fill'
import { BodyArtData, PaletteData } from '../model'
import { colorwaysJson, slotJson } from '../palette/blend'
import { readSprites } from '../palette/sprites'
import { bodyCorners, cornerFields, readCorners } from '../corners/shape'
import { drawText, measure } from '../font'
import { artJson } from './layout'
import { cutsOf, Size } from './cuts'

const BODY_ID = 'body'
const ART_SPRITE = 'body_art'
const NAMES = ['Mo', 'Lantern_Keeper', 'xX_Redstone_Wizard_Xx']
const NAME_LABELS = ['Short name', 'Long name', 'Longest name']
const LINE_LABELS = ['1 line', '2 lines', '3 lines']
const ABOVE = 'Team Red'
const BELOW = 'Level 42'
const CELL_GAP = 10
const LABEL_HEIGHT = 14
const LABEL_WIDTH = 52
const STAGE = '#3a3d44'
const LABEL = '#c8ccd4'

export const CUT_COLORS = {
    ends: 'rgba(80, 150, 255, 0.9)',
    middle: 'rgba(90, 210, 120, 0.9)',
    center: 'rgba(255, 170, 60, 0.95)',
    rows: 'rgba(230, 90, 220, 0.9)',
}

interface ArtSource {
    node: any
    palette: PaletteData
    texture: Texture | null
    size: Size
}

interface ArtPreview {
    preview: NameplatePreview | null
    issues: string[]
}

function spriteRows(source: ArtSource): Record<string, unknown> | null {
    if (!source.texture) return null
    const layer = { kind: 'sprite', texture: source.texture.uuid } as any
    const { sprites } = readSprites([layer], source.palette)
    const sprite = sprites[source.texture.uuid]
    if (!sprite || sprite.frames.length === 0) return null
    return { colors: sprite.colors, rows: sprite.frames[0] }
}

function bodyJson(node: any, art: BodyArtData): Record<string, unknown> {
    const corners = readCorners(node)
    const radius = Math.max(0, Math.round(Number(node.radius)) || 0)
    const file: Record<string, unknown> = {
        kind: 'body',
        padding: Array.isArray(node.padding) ? node.padding.map((value: unknown) => Math.max(0, Math.round(Number(value)) || 0)) : [3, 2, 3, 2],
        minWidth: Math.max(0, Math.round(Number(node.minWidth)) || 0),
        ...cornerFields({ radius, corners: corners ?? bodyCorners({ radius, corners: null }) } as any),
    }
    const fill = paintFillJson(node.fill)
    if (fill) file.fill = fill
    file.rings = (Array.isArray(node.rings) ? node.rings : []).map(paintFillJson).filter((ring: unknown) => !!ring)
    file.art = artJson(art, ART_SPRITE)
    return file
}

export function loadArtPreview(source: ArtSource, art: BodyArtData): ArtPreview {
    const rows = spriteRows(source)
    if (!rows) return { preview: null, issues: ['Pick a picture to see the preview.'] }
    const files: Record<string, string> = {
        'manifest.json': JSON.stringify({
            format: 1,
            id: 'body_art_preview',
            fps: 10,
            loop: 20,
            ownsBackground: false,
            layers: [{ id: BODY_ID, depth: 'background', step: 1 }],
        }),
        'palettes.json': JSON.stringify({ slots: source.palette.slots.map(slotJson), colorways: colorwaysJson(source.palette) }),
        [`layers/${BODY_ID}.json`]: JSON.stringify(bodyJson(source.node, art)),
        [`sprites/${ART_SPRITE}.json`]: JSON.stringify(rows),
    }
    try {
        const load = loadBundle(files, {})
        const issues = [...load.issues, ...load.warnings]
            .filter((issue) => issue.path.includes('#art') || issue.path.includes(ART_SPRITE))
            .map((issue) => `The body art ${plainMessage(issue.message)}`)
        return { preview: load.preview ?? load.draft?.() ?? null, issues }
    } catch (error) {
        return { preview: null, issues: [describe(error)] }
    }
}

interface Tile {
    layers: NameplateLayer[]
    runs: TextRun[]
    body: Int32Array | null
    minX: number
    minY: number
    width: number
    height: number
}

function layoutTag(name: string, lines: number): CrowdLayout {
    return crowdLayoutTag({ name, above: lines >= 3 ? [ABOVE] : [], below: lines >= 2 ? [BELOW] : [] }, measure)
}

function bodyRect(layers: NameplateLayer[]): Int32Array | null {
    const body = layers.find((layer) => layer.layer === BODY_ID)
    if (!body || body.rasterWidth <= 0 || body.rasterHeight <= 0) return null
    const bounds = layerBounds([body])
    return Int32Array.of(bounds.minX, bounds.minY, bounds.minX + bounds.width, bounds.minY + bounds.height)
}

function paintTile(preview: NameplatePreview, name: string, lines: number): Tile {
    const layout = layoutTag(name, lines)
    const variant = preview.variants[0] ?? 'default'
    const layers = preview.paint(variant, layout.block, 0, 0)
    const body = bodyRect(layers)
    const marks = [{ left: 0, top: 0, x: 0, y: 0, width: layout.width, mirrorX: false, rasterWidth: layout.width, rasterHeight: layout.height } as NameplateLayer]
    const bounds = layerBounds([...layers, ...marks])
    return { layers, runs: layout.runs, body, minX: bounds.minX, minY: bounds.minY, width: bounds.width, height: bounds.height }
}

interface PreviewLayout {
    tiles: Tile[][]
    columns: number[]
    rows: number[]
}

export function paintTiles(preview: NameplatePreview): PreviewLayout {
    const tiles = LINE_LABELS.map((_, line) => NAMES.map((name) => paintTile(preview, name, line + 1)))
    const columns = NAMES.map((_, column) => Math.max(...tiles.map((row) => row[column].width)))
    const rows = tiles.map((row) => Math.max(...row.map((tile) => tile.height)))
    return { tiles, columns, rows }
}

export function previewSize(layout: PreviewLayout, scale: number): { width: number, height: number } {
    const width = LABEL_WIDTH + layout.columns.reduce((sum, column) => sum + column * scale + CELL_GAP, CELL_GAP)
    const height = LABEL_HEIGHT + layout.rows.reduce((sum, row) => sum + row * scale + CELL_GAP, CELL_GAP)
    return { width, height }
}

function line(ctx: CanvasRenderingContext2D, color: string, x0: number, y0: number, x1: number, y1: number) {
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
}

function drawCuts(ctx: CanvasRenderingContext2D, tile: Tile, art: BodyArtData, size: Size, scale: number, originX: number, originY: number) {
    const rect = tile.body
    if (!rect) return
    const cuts = cutsOf(art, size)
    const x0 = originX + rect[0] * scale
    const y0 = originY + rect[1] * scale
    const x1 = originX + rect[2] * scale
    const y1 = originY + rect[3] * scale
    const width = rect[2] - rect[0]
    ctx.save()
    ctx.lineWidth = 1
    ctx.setLineDash?.([2, 2])
    line(ctx, CUT_COLORS.ends, x0 + cuts.left * scale + 0.5, y0, x0 + cuts.left * scale + 0.5, y1)
    line(ctx, CUT_COLORS.ends, x1 - cuts.rightWidth * scale - 0.5, y0, x1 - cuts.rightWidth * scale - 0.5, y1)
    if (cuts.center) {
        const centerWidth = cuts.center[1] - cuts.center[0]
        const middleEnd = width - cuts.rightWidth
        const start = cuts.left + Math.floor((middleEnd - cuts.left - centerWidth) / 2)
        line(ctx, CUT_COLORS.center, x0 + start * scale + 0.5, y0, x0 + start * scale + 0.5, y1)
        line(ctx, CUT_COLORS.center, x0 + (start + centerWidth) * scale - 0.5, y0, x0 + (start + centerWidth) * scale - 0.5, y1)
    }
    line(ctx, CUT_COLORS.rows, x0, y0 + cuts.top * scale + 0.5, x1, y0 + cuts.top * scale + 0.5)
    line(ctx, CUT_COLORS.rows, x0, y1 - cuts.bottom * scale - 0.5, x1, y1 - cuts.bottom * scale - 0.5)
    ctx.restore()
}

export function drawPreview(
    ctx: CanvasRenderingContext2D,
    layout: PreviewLayout,
    scale: number,
    art: BodyArtData,
    size: Size,
    showCuts: boolean,
) {
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = STAGE
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.fillStyle = LABEL
    ctx.font = '11px sans-serif'
    ctx.textBaseline = 'top'
    let x = LABEL_WIDTH + CELL_GAP
    NAME_LABELS.forEach((label, column) => {
        ctx.fillText(label, x, 2)
        x += layout.columns[column] * scale + CELL_GAP
    })
    let y = LABEL_HEIGHT + CELL_GAP
    layout.tiles.forEach((row, index) => {
        ctx.fillStyle = LABEL
        ctx.fillText(LINE_LABELS[index], 4, y)
        let left = LABEL_WIDTH + CELL_GAP
        row.forEach((tile, column) => {
            const originX = left - tile.minX * scale
            const originY = y - tile.minY * scale
            for (const layer of tile.layers) drawRasterLayer(ctx, layer, scale, originX, originY, { additive: false })
            for (const run of tile.runs) drawText(ctx, run.text, originX + run.x * scale, originY + run.y * scale, scale, run.color)
            if (showCuts) drawCuts(ctx, tile, art, size, scale, originX, originY)
            left += layout.columns[column] * scale + CELL_GAP
        })
        y += layout.rows[index] * scale + CELL_GAP
    })
}

export function shortBodyNote(layout: PreviewLayout, art: BodyArtData, size: Size): string | null {
    const body = layout.tiles[0]?.[0]?.body
    if (!body) return null
    const height = body[3] - body[1]
    const cuts = cutsOf(art, size)
    if (height >= cuts.top + cuts.bottom) return null
    return `On a one-line tag the body is only ${height} px tall, less than the ${cuts.top + cuts.bottom} fixed rows at the top and bottom, so the bottom rows are cut off. Give the body more padding above and below, or fix fewer rows.`
}

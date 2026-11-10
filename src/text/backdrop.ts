import { layerLeft, layerTop, NameplateBlock, NameplateLayer, NameplatePreview } from '../engine'
import { currentLoad, lastResult, mainLayout, nameRow, paintFrame, previewUi } from '../preview'
import { currentLook } from '../preview/options'
import type { CrowdLayout } from '../preview/crowd'
import { BACKDROP_GRAY, compositeOver, OUTLINE_BELOW, ratio } from './contrast'
import { BadgeSettings } from './types'
import { inDrawOrder } from '../gpu/order'

export const BADGE_CELLS_WIDE = 9
export const BADGE_CELLS_HIGH = 8
export const BADGE_ADVANCE = 11
export const GLYPH_ROWS = 8
const FRONT_DEPTH = 'over_text'
const MAX_SAMPLED_FRAMES = 120
const CACHE_LIMIT = 32
const LINE_SAMPLES = 8
const HARD_LINE_SHARE = 1 / 3

export interface Rect {
    x: number
    y: number
    width: number
    height: number
}

interface BadgeSource {
    preview: NameplatePreview | null
    variant: string
}

const cache = new Map<string, number[]>()
let cachedPreview: NameplatePreview | null = null

function blockSize(layout: CrowdLayout = mainLayout()): { width: number, height: number } {
    return { width: layout.block.width, height: layout.block.height }
}

function lineStart(layout: CrowdLayout): { x: number, y: number } {
    const name = layout.runs.find((run) => run.kind === 'name')
    const y = name?.y ?? 0
    const xs = layout.runs.filter((run) => run.y === y && (run.kind === 'name' || run.kind === 'rank')).map((run) => run.x)
    return { x: xs.length ? Math.min(...xs) : name?.x ?? 0, y }
}

function edge(anchor: string, axis: 'x' | 'y', size: number): number {
    const part = axis === 'x' ? anchor.replace(/^(top|bottom)_?/, '') : anchor.replace(/_?(left|right)$/, '')
    if (axis === 'x') return part === 'left' ? 0 : part === 'right' ? size : Math.floor(size / 2)
    return part === 'top' ? 0 : part === 'bottom' ? size : Math.floor(size / 2)
}

export function nameRect(layout: CrowdLayout = mainLayout()): Rect {
    const row = nameRow(layout)
    return { x: row.x, y: row.y, width: row.width, height: GLYPH_ROWS }
}

function shownSource(): BadgeSource {
    return { preview: lastResult()?.preview ?? currentLoad()?.preview ?? null, variant: previewUi.variant }
}

function edgeSpot(layout: CrowdLayout, source: BadgeSource): [number, number] | null {
    const { preview, variant } = source
    if (!preview || !preview.variants.includes(variant)) return null
    try {
        return preview.badgeSpot(variant, layout.block)
    } catch (error) {
        console.error('[polyplus_nameplate] could not find the badge spot', error)
        return null
    }
}

export function badgeRect(badge: BadgeSettings, layout: CrowdLayout = mainLayout(), source: BadgeSource = shownSource()): Rect {
    if (badge.placement !== 'placed') {
        if (layout.badge) return { x: layout.badge.x, y: layout.badge.y, width: BADGE_CELLS_WIDE, height: BADGE_CELLS_HIGH }
        const start = lineStart(layout)
        return { x: start.x - BADGE_ADVANCE, y: start.y, width: BADGE_CELLS_WIDE, height: BADGE_CELLS_HIGH }
    }
    const spot = badge.follow ? edgeSpot(layout, source) : null
    if (spot) return { x: spot[0], y: spot[1], width: BADGE_CELLS_WIDE, height: BADGE_CELLS_HIGH }
    const block = blockSize(layout)
    const anchor = badge.anchor ?? 'top_left'
    return {
        x: edge(anchor, 'x', block.width) - Math.floor(BADGE_CELLS_WIDE / 2) + badge.offset[0],
        y: edge(anchor, 'y', block.height) - Math.floor(BADGE_CELLS_HIGH / 2) + badge.offset[1],
        width: BADGE_CELLS_WIDE,
        height: BADGE_CELLS_HIGH,
    }
}

function pixelAt(layers: NameplateLayer[], x: number, y: number): number {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (const layer of layers) {
        if (layer.depth === FRONT_DEPTH || layer.rasterWidth <= 0 || layer.rasterHeight <= 0) continue
        let column = x - layerLeft(layer)
        const row = y - layerTop(layer)
        if (column < 0 || row < 0 || column >= layer.rasterWidth || row >= layer.rasterHeight) continue
        if (layer.mirrorX) column = layer.rasterWidth - 1 - column
        const index = (row * layer.rasterWidth + column) * 4
        const alpha = (layer.rgba[index + 3] / 255) * (layer.opacity / 255)
        if (alpha <= 0) continue
        const out = alpha + a * (1 - alpha)
        r = (layer.rgba[index] * alpha + r * a * (1 - alpha)) / out
        g = (layer.rgba[index + 1] * alpha + g * a * (1 - alpha)) / out
        b = (layer.rgba[index + 2] * alpha + b * a * (1 - alpha)) / out
        a = out
    }
    const alpha = Math.round(a * 255)
    if (alpha <= 0) return -1
    const rgb = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
    if (alpha >= 255) return rgb
    return compositeOver(((alpha << 24) | rgb) >>> 0, BACKDROP_GRAY)
}

function sampleLayers(layers: NameplateLayer[], rect: Rect, into: Set<number>) {
    const ordered = inDrawOrder(layers)
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const pixel = pixelAt(ordered, x, y)
            if (pixel >= 0) into.add(pixel)
        }
    }
}

function sampleSeed(): number {
    return Math.max(0, Math.min(2147483647, Math.floor(Number(previewUi.seed) || 0)))
}

function paintOn(preview: NameplatePreview, variant: string, block: NameplateBlock, frame: number): NameplateLayer[] {
    const look = currentLook()
    return preview.paint(variant, block, look.still ? 0 : frame, sampleSeed(), null, look.detail)
}

function withPlate(preview: NameplatePreview, variant: string, block: NameplateBlock, frame: number, rect: Rect): Rect {
    const look = currentLook()
    const plate = preview.platePose(variant, block, look.still ? 0 : frame, sampleSeed(), null, look.detail)
    return { ...rect, x: rect.x + plate.dx, y: rect.y + plate.dy }
}

function framesOf(preview: NameplatePreview): number[] {
    const loop = Math.max(1, preview.loop)
    if (loop <= MAX_SAMPLED_FRAMES) return Array.from({ length: loop }, (_, index) => index)
    return Array.from({ length: MAX_SAMPLED_FRAMES }, (_, index) => Math.floor((index * loop) / MAX_SAMPLED_FRAMES))
}

function hardShare(layers: NameplateLayer[], rect: Rect, rgb: number): number {
    let hard = 0
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const pixel = pixelAt(layers, x, y)
            if (pixel >= 0 && ratio(rgb, pixel) < OUTLINE_BELOW) hard++
        }
    }
    return hard / Math.max(1, rect.width * rect.height)
}

export function hardLines(preview: NameplatePreview, variant: string, layout: CrowdLayout, rgb: number): boolean {
    if (!preview.variants.includes(variant)) return false
    const lines = layout.runs.filter((run) => run.kind === 'line').map((run): Rect => ({ x: run.x, y: run.y, width: run.width, height: GLYPH_ROWS }))
    const loop = Math.max(1, preview.loop)
    const samples = Math.min(loop, LINE_SAMPLES)
    for (let sample = 0; sample < samples; sample++) {
        const layers = inDrawOrder(preview.paint(variant, layout.block, Math.floor((sample * loop) / samples), 0))
        if (lines.some((rect) => hardShare(layers, rect, rgb) >= HARD_LINE_SHARE)) return true
    }
    return false
}

export function loopPixels(preview: NameplatePreview | null, variant: string, rect: Rect, hint: number[] = [], on?: NameplateBlock): number[] {
    if (!preview || !preview.variants.includes(variant)) return hint.slice()
    if (cachedPreview !== preview) {
        cache.clear()
        cachedPreview = preview
    }
    const block = on ?? blockSize()
    const look = currentLook()
    const key = [variant, previewUi.seed, look.still, look.detail, block.width, block.height, rect.x, rect.y, rect.width, rect.height].join(',')
    let pixels = cache.get(key)
    if (!pixels) {
        const found = new Set<number>()
        let failed = false
        for (const frame of framesOf(preview)) {
            try {
                const layers = on ? paintOn(preview, variant, on, frame) : paintFrame(preview, frame, null, variant)
                sampleLayers(layers, withPlate(preview, variant, on ?? mainLayout().block, frame, rect), found)
            } catch (error) {
                console.error('[polyplus_nameplate] could not sample the name backdrop', error)
                failed = true
                break
            }
        }
        pixels = Array.from(found)
        if (!failed) cache.set(key, pixels)
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    }
    const result = new Set(pixels)
    for (const rgb of hint) result.add(rgb & 0xffffff)
    return Array.from(result)
}

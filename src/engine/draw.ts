import { blendPixel } from '@plusrenderer/renderer/nameplate.js'

export interface NameplateLayer {
    readonly index: number
    readonly layer: string
    readonly depth: string
    readonly x: number
    readonly y: number
    readonly mirrorX: boolean
    readonly width: number
    readonly opacity: number
    readonly left: number
    readonly top: number
    readonly rasterWidth: number
    readonly rasterHeight: number
    readonly rgba: Uint8ClampedArray
    readonly passes: readonly Uint8ClampedArray[]
    readonly blend: string
    readonly quads: number
    readonly mask: string | null
}

export interface LayerBounds {
    minX: number
    minY: number
    width: number
    height: number
}

export function layerLeft(layer: NameplateLayer): number {
    return layer.mirrorX ? layer.x + layer.width - (layer.left + layer.rasterWidth) : layer.x + layer.left
}

export function layerTop(layer: NameplateLayer): number {
    return layer.y + layer.top
}

export function layerBounds(layers: NameplateLayer[]): LayerBounds {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const layer of layers) {
        if (layer.rasterWidth <= 0 || layer.rasterHeight <= 0) continue
        const left = layerLeft(layer)
        const top = layerTop(layer)
        minX = Math.min(minX, left)
        minY = Math.min(minY, top)
        maxX = Math.max(maxX, left + layer.rasterWidth)
        maxY = Math.max(maxY, top + layer.rasterHeight)
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, width: 1, height: 1 }
    return { minX, minY, width: maxX - minX, height: maxY - minY }
}

export type LayerDrawer = (ctx: CanvasRenderingContext2D, layers: NameplateLayer[], scale: number, originX: number, originY: number) => void

let layerDrawer: LayerDrawer | null = null

export function setLayerDrawer(drawer: LayerDrawer | null) {
    layerDrawer = drawer
}

const rasters = new WeakMap<Uint8ClampedArray, HTMLCanvasElement | null>()

function canvasOf(layer: NameplateLayer, rgba: Uint8ClampedArray): HTMLCanvasElement | null {
    if (rasters.has(rgba)) return rasters.get(rgba) ?? null
    let raster: HTMLCanvasElement | null = null
    if (layer.rasterWidth > 0 && layer.rasterHeight > 0 && rgba.length === layer.rasterWidth * layer.rasterHeight * 4) {
        raster = document.createElement('canvas')
        raster.width = layer.rasterWidth
        raster.height = layer.rasterHeight
        const rasterContext = raster.getContext('2d')
        if (rasterContext) rasterContext.putImageData(new ImageData(new Uint8ClampedArray(rgba), layer.rasterWidth, layer.rasterHeight), 0, 0)
        else raster = null
    }
    rasters.set(rgba, raster)
    return raster
}

export function rasterCanvas(layer: NameplateLayer): HTMLCanvasElement | null {
    return canvasOf(layer, layer.rgba)
}

export function layerPasses(layer: NameplateLayer): readonly Uint8ClampedArray[] {
    return layer.passes?.length ? layer.passes : [layer.rgba]
}

export function passCanvases(layer: NameplateLayer): (HTMLCanvasElement | null)[] {
    return layerPasses(layer).map((rgba) => canvasOf(layer, rgba))
}

export interface RasterStyle {
    raster?: CanvasImageSource | null | readonly (CanvasImageSource | null)[]
    additive?: boolean
}

function sourcesOf(layer: NameplateLayer, style: RasterStyle): CanvasImageSource[] {
    const chosen = style.raster === undefined ? passCanvases(layer) : style.raster
    const list: readonly (CanvasImageSource | null)[] = Array.isArray(chosen) ? chosen : [chosen as CanvasImageSource | null]
    return list.filter((source): source is CanvasImageSource => !!source)
}

function pixelsOf(source: CanvasImageSource, width: number, height: number): Uint8ClampedArray | null {
    const canvas = source as HTMLCanvasElement
    if (typeof canvas.getContext !== 'function' || canvas.width !== width || canvas.height !== height) return null
    const data = canvas.getContext('2d')?.getImageData(0, 0, width, height)?.data
    return data && data.length === width * height * 4 ? data : null
}

function ownPasses(layer: NameplateLayer): readonly Uint8ClampedArray[] | null {
    const size = layer.rasterWidth * layer.rasterHeight * 4
    const passes = layerPasses(layer)
    return size > 0 && passes.every((pass) => pass.length === size) ? passes : null
}

function readPasses(layer: NameplateLayer, sources: readonly CanvasImageSource[]): Uint8ClampedArray[] | null {
    const passes: Uint8ClampedArray[] = []
    for (const source of sources) {
        const pixels = pixelsOf(source, layer.rasterWidth, layer.rasterHeight)
        if (!pixels) return null
        passes.push(pixels)
    }
    return passes
}

function scratchCanvas(width: number, height: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

function packed(data: Uint8ClampedArray, at: number, alpha = data[at + 3]): number {
    return (alpha * 0x1000000 + (data[at] << 16) + (data[at + 1] << 8) + data[at + 2]) >>> 0
}

function blendAdditive(ctx: CanvasRenderingContext2D, layer: NameplateLayer, passes: readonly Uint8ClampedArray[], dx: number, dy: number, dw: number, dh: number): boolean {
    if (typeof ctx.getImageData !== 'function' || typeof ctx.getTransform !== 'function' || !ctx.canvas) return false
    const matrix = ctx.getTransform()
    if (matrix.b !== 0 || matrix.c !== 0 || !(matrix.a > 0) || !(matrix.d > 0)) return false
    const left = matrix.a * dx + matrix.e
    const top = matrix.d * dy + matrix.f
    const width = matrix.a * dw
    const height = matrix.d * dh
    const x0 = Math.max(0, Math.ceil(left - 0.5))
    const y0 = Math.max(0, Math.ceil(top - 0.5))
    const x1 = Math.min(ctx.canvas.width, Math.ceil(left + width - 0.5))
    const y1 = Math.min(ctx.canvas.height, Math.ceil(top + height - 0.5))
    if (x1 <= x0 || y1 <= y0) return true
    const w = x1 - x0
    const h = y1 - y0
    const scratch = scratchCanvas(w, h)
    const scratchContext = scratch?.getContext('2d')
    if (!scratch || !scratchContext) return false
    const image = ctx.getImageData(x0, y0, w, h)
    const out = image.data
    const alpha = Math.max(0, Math.min(1, ctx.globalAlpha))
    const rw = layer.rasterWidth
    const rh = layer.rasterHeight
    for (let row = 0; row < h; row++) {
        const v = Math.min(rh - 1, Math.max(0, Math.floor(((y0 + row + 0.5 - top) / height) * rh)))
        for (let col = 0; col < w; col++) {
            const u = Math.min(rw - 1, Math.max(0, Math.floor(((x0 + col + 0.5 - left) / width) * rw)))
            const from = (v * rw + (layer.mirrorX ? rw - 1 - u : u)) * 4
            const to = (row * w + col) * 4
            let below = packed(out, to)
            let touched = false
            for (const pass of passes) {
                const sa = Math.round(pass[from + 3] * alpha)
                if (sa === 0) continue
                below = blendPixel(packed(pass, from, sa), below, 'additive')
                touched = true
            }
            if (!touched) continue
            out[to] = (below >>> 16) & 0xff
            out[to + 1] = (below >>> 8) & 0xff
            out[to + 2] = below & 0xff
            out[to + 3] = below >>> 24
        }
    }
    scratchContext.putImageData(image, 0, 0)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(x0, y0, w, h)
    ctx.drawImage(scratch, x0, y0)
    ctx.restore()
    return true
}

export function drawRasterLayer(
    ctx: CanvasRenderingContext2D,
    layer: NameplateLayer,
    scale: number,
    originX: number,
    originY: number,
    style: RasterStyle = {},
) {
    const additive = style.additive ?? layer.blend === 'additive'
    const own = additive && style.raster === undefined ? ownPasses(layer) : null
    let sources = own ? null : sourcesOf(layer, style)
    if (sources && !sources.length) return
    const dx = originX + layerLeft(layer) * scale
    const dy = originY + layerTop(layer) * scale
    const dw = layer.rasterWidth * scale
    const dh = layer.rasterHeight * scale
    ctx.save()
    ctx.globalAlpha *= layer.opacity / 255
    if (additive) {
        const passes = own ?? readPasses(layer, sources ?? [])
        if (passes && blendAdditive(ctx, layer, passes, dx, dy, dw, dh)) {
            ctx.restore()
            return
        }
        ctx.globalCompositeOperation = 'lighter'
    }
    sources ??= sourcesOf(layer, style)
    if (layer.mirrorX) {
        ctx.translate(dx + dw, dy)
        ctx.scale(-1, 1)
        for (const raster of sources) ctx.drawImage(raster, 0, 0, dw, dh)
    } else {
        for (const raster of sources) ctx.drawImage(raster, dx, dy, dw, dh)
    }
    ctx.restore()
}

export function drawLayers(
    ctx: CanvasRenderingContext2D,
    layers: NameplateLayer[],
    scale: number,
    originX: number,
    originY: number,
) {
    ctx.imageSmoothingEnabled = false
    if (layerDrawer) {
        try {
            layerDrawer(ctx, layers, scale, originX, originY)
            return
        } catch (error) {
            console.error('[polyplus_nameplate] drawing layers failed, showing plain pixels', error)
        }
    }
    for (const layer of layers) drawRasterLayer(ctx, layer, scale, originX, originY)
}

export const PLATE_OPACITY = 0.7

export function drawPlateLayers(
    ctx: CanvasRenderingContext2D,
    layers: NameplateLayer[],
    scale: number,
    originX: number,
    originY: number,
    opacity = PLATE_OPACITY,
) {
    ctx.imageSmoothingEnabled = false
    ctx.save()
    ctx.globalAlpha *= opacity
    drawLayers(ctx, layers, scale, originX, originY)
    ctx.restore()
}

import { drawRasterLayer, layerBounds, LayerBounds, NameplateLayer, NameplatePreview, passCanvases } from '../engine'
import { glAvailable, GlLayerImage, GlLayers, glLayers, GlStage, isFrontDepth, TagJob, tagJobOf } from '../engine/gl'
import { currentLook, previewOptions } from '../preview/options'
import { currentLight, isLit, Light, LIGHT_COLORS } from './world'
import { pluralWord } from '../util/text'
import { inDrawOrder } from './order'

const TOLERANCE = 1
const SPLIT_LINE = 'rgba(255, 255, 255, 0.9)'
const DIFF_FILL = 'rgba(255, 0, 255, 0.75)'
const MATCH_OUTLINE = 'rgba(80, 220, 120, 0.9)'

export interface CompareResult {
    layer: string
    pixels: number
    over: number
    atlas: boolean
}

const session: {
    preview: NameplatePreview | null
    compared: CompareResult[]
    gpuDrawn: number
    cpuDrawn: number
} = { preview: null, compared: [], gpuDrawn: 0, cpuDrawn: 0 }

export function setComposePreview(preview: NameplatePreview | null) {
    session.preview = preview
}

export function beginCompose() {
    session.compared = []
    session.gpuDrawn = 0
    session.cpuDrawn = 0
}

export interface ComposeSummary {
    gpu: number
    cpu: number
    compared: CompareResult[]
}

export function composeSummary(): ComposeSummary {
    return { gpu: session.gpuDrawn, cpu: session.cpuDrawn, compared: session.compared.slice() }
}

export function gpuWanted(): boolean {
    return currentLook().gpu && glAvailable()
}

export function fullReplayWanted(): boolean {
    return currentLook().effects && gpuWanted()
}

function tinted(source: HTMLCanvasElement | null, light: Light, copyFirst: boolean): HTMLCanvasElement | null {
    if (!source || !isLit(light)) return source
    const raster = copyFirst ? copyOf(source) : source
    const ctx = raster.getContext('2d')
    if (!ctx) return raster
    const shape = copyOf(raster)
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgb(${Math.round(light.r * 255)}, ${Math.round(light.g * 255)}, ${Math.round(light.b * 255)})`
    ctx.fillRect(0, 0, raster.width, raster.height)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(shape, 0, 0)
    return raster
}

function copyOf(source: HTMLCanvasElement): HTMLCanvasElement {
    const copy = document.createElement('canvas')
    copy.width = source.width
    copy.height = source.height
    copy.getContext('2d')?.drawImage(source, 0, 0)
    return copy
}

function drawCpu(ctx: CanvasRenderingContext2D, layer: NameplateLayer, scale: number, originX: number, originY: number, light: Light) {
    drawRasterLayer(ctx, layer, scale, originX, originY, { raster: passCanvases(layer).map((raster) => tinted(raster, light, true)) })
}

export function replayJob(layers: NameplateLayer[]): TagJob | null {
    const job = layers.length ? tagJobOf(layers[0]) : null
    return job && layers.every((layer) => tagJobOf(layer) === job) ? job : null
}

function gpuImages(layers: NameplateLayer[], light: Light, scale: number, stage: GlStage): GlLayers | null {
    const job = replayJob(layers)
    return job ? glLayers(job, [light.r, light.g, light.b], scale, stage) : null
}

function stageOf(ctx: CanvasRenderingContext2D, originX: number, originY: number): GlStage {
    return { width: ctx.canvas?.width ?? 1, height: ctx.canvas?.height ?? 1, originX, originY }
}

function plainStage(stage: GlStage, scale: number): GlStage {
    return { width: Math.ceil(stage.width / scale), height: Math.ceil(stage.height / scale), originX: Math.round(stage.originX / scale), originY: Math.round(stage.originY / scale) }
}

export function comparedBounds(layers: NameplateLayer[], images: GlLayers): LayerBounds {
    const cpu = layerBounds(layers)
    const shown = layers.some((layer) => layer.rasterWidth > 0 && layer.rasterHeight > 0)
    let minX = shown ? cpu.minX : Infinity
    let minY = shown ? cpu.minY : Infinity
    let maxX = shown ? cpu.minX + cpu.width : -Infinity
    let maxY = shown ? cpu.minY + cpu.height : -Infinity
    for (const layer of layers) {
        const image = images.get(layer.index)
        if (!image) continue
        minX = Math.min(minX, Math.floor(image.left))
        minY = Math.min(minY, Math.floor(image.top))
        maxX = Math.max(maxX, Math.ceil(image.left + image.image.width / image.scale))
        maxY = Math.max(maxY, Math.ceil(image.top + image.image.height / image.scale))
    }
    if (!Number.isFinite(minX)) return cpu
    return { minX, minY, width: maxX - minX, height: maxY - minY }
}

function drawGpuLayer(ctx: CanvasRenderingContext2D, layer: NameplateLayer, image: GlLayerImage, scale: number, originX: number, originY: number) {
    const size = scale / image.scale
    ctx.save()
    ctx.globalAlpha *= layer.opacity / 255
    if (layer.blend === 'additive') ctx.globalCompositeOperation = 'lighter'
    ctx.imageSmoothingEnabled = size !== 1
    ctx.drawImage(image.image, originX + image.left * scale, originY + image.top * scale, image.image.width * size, image.image.height * size)
    ctx.restore()
}

function drawGpu(ctx: CanvasRenderingContext2D, layers: NameplateLayer[], images: GlLayers, scale: number, originX: number, originY: number) {
    for (const layer of inDrawOrder(layers)) {
        const image = images.get(layer.index)
        if (image) drawGpuLayer(ctx, layer, image, scale, originX, originY)
    }
}

function flatten(bounds: LayerBounds, paint: (ctx: CanvasRenderingContext2D) => void): ImageData | null {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, bounds.width)
    canvas.height = Math.max(1, bounds.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    paint(ctx)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function compare(ctx: CanvasRenderingContext2D, layers: NameplateLayer[], images: GlLayers, scale: number, originX: number, originY: number) {
    const bounds = comparedBounds(layers, images)
    const cpu = flatten(bounds, (target) => {
        for (const layer of inDrawOrder(layers)) drawRasterLayer(target, layer, 1, -bounds.minX, -bounds.minY)
    })
    const gpu = flatten(bounds, (target) => drawGpu(target, layers, images, 1, -bounds.minX, -bounds.minY))
    if (!cpu || !gpu) return
    let over = 0
    ctx.save()
    ctx.globalAlpha = 1
    ctx.fillStyle = DIFF_FILL
    for (let at = 0; at < gpu.data.length; at += 4) {
        let worst = 0
        for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(gpu.data[at + c] - cpu.data[at + c]))
        if (worst <= TOLERANCE) continue
        over++
        const pixel = at / 4
        const x = bounds.minX + (pixel % gpu.width)
        const y = bounds.minY + Math.floor(pixel / gpu.width)
        ctx.fillRect(originX + x * scale, originY + y * scale, scale, scale)
    }
    if (over === 0) {
        ctx.strokeStyle = MATCH_OUTLINE
        ctx.lineWidth = 1
        ctx.strokeRect(originX + bounds.minX * scale + 0.5, originY + bounds.minY * scale + 0.5, gpu.width * scale - 1, gpu.height * scale - 1)
    }
    ctx.restore()
    session.compared.push({ layer: isFrontDepth(layers[0].depth) ? 'over_text' : 'under_text', pixels: gpu.width * gpu.height, over, atlas: false })
}

function split(ctx: CanvasRenderingContext2D, layers: NameplateLayer[], images: GlLayers, scale: number, originX: number, originY: number, light: Light) {
    const bounds = layerBounds(layers)
    const middle = originX + (bounds.minX + Math.round(bounds.width / 2)) * scale
    const top = originY + bounds.minY * scale
    const height = bounds.height * scale
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, Math.max(0, middle), ctx.canvas.height)
    ctx.clip()
    drawGpu(ctx, layers, images, scale, originX, originY)
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.rect(middle, 0, Math.max(0, ctx.canvas.width - middle), ctx.canvas.height)
    ctx.clip()
    for (const layer of inDrawOrder(layers)) drawCpu(ctx, layer, scale, originX, originY, light)
    ctx.restore()
    ctx.save()
    ctx.globalAlpha = 1
    ctx.strokeStyle = SPLIT_LINE
    ctx.setLineDash?.([scale, scale])
    ctx.beginPath()
    ctx.moveTo(middle + 0.5, top)
    ctx.lineTo(middle + 0.5, top + height)
    ctx.stroke()
    ctx.restore()
}

export function composeLayers(ctx: CanvasRenderingContext2D, layers: NameplateLayer[], scale: number, originX: number, originY: number) {
    ctx.imageSmoothingEnabled = false
    const light = currentLight()
    const stage = stageOf(ctx, originX, originY)
    const images = fullReplayWanted() ? gpuImages(layers, light, scale, stage) : null
    if (images) {
        session.gpuDrawn++
        const effects = !!tagJobOf(layers[0])?.preview.hasMaterials
        if (effects && previewOptions.compare === 'split') {
            split(ctx, layers, images, scale, originX, originY, light)
            return
        }
        drawGpu(ctx, layers, images, scale, originX, originY)
        if (effects && previewOptions.compare === 'diff') compare(ctx, layers, gpuImages(layers, isLit(light) ? LIGHT_COLORS.day : light, 1, plainStage(stage, scale)) ?? images, scale, originX, originY)
        return
    }
    if (layers.length) session.cpuDrawn++
    for (const layer of inDrawOrder(layers)) drawCpu(ctx, layer, scale, originX, originY, light)
}

export function gpuNotes(): string {
    const look = currentLook()
    const notes: string[] = []
    const preview = session.preview
    const hasEffects = !!preview?.hasMaterials
    if (hasEffects && look.gpu && look.effects && !glAvailable()) {
        notes.push("This browser can't draw full effects, so basic effects show.")
    }
    if (hasEffects && look.gpu && previewOptions.compare !== 'off' && !glAvailable()) {
        notes.push("Comparing needs full effects, which this browser doesn't offer.")
    }
    if (hasEffects && look.gpu && previewOptions.compare === 'split' && session.gpuDrawn > 0) {
        notes.push('Each effect shows the full version on the left and the basic version on the right of the dashed line.')
    }
    if (hasEffects && look.gpu && previewOptions.compare === 'diff') {
        const compared = session.compared
        if (compared.length) {
            const over = compared.reduce((sum, entry) => sum + entry.over, 0)
            notes.push(over === 0
                ? 'Full and basic effects match (within 1 per color channel): each effect has a green frame.'
                : `${over} effect ${pluralWord(over, 'pixel')} differ between full and basic effects by more than 1 per color channel (pink).`)
        }
    }
    if (hasEffects && !look.gpu && previewOptions.compare !== 'off') {
        notes.push('Pick a full-effects Game Look to compare it with basic effects.')
    }
    return notes.join(' ')
}

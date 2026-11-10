import {
    drawRasterLayer,
    MaterialDraw,
    materialDrawOf,
    NameplateLayer,
    NameplatePreview,
    rasterCanvas,
} from '../engine'
import { currentLook, previewOptions } from '../preview/options'
import { gpuAvailable, Light, materialRect, renderMaterial, renderParity, shaderFailures } from './renderer'
import { currentLight, isLit } from './world'
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
    return currentLook().gpu && gpuAvailable()
}

function tinted(layer: NameplateLayer, light: Light): HTMLCanvasElement | null {
    const raster = rasterCanvas(layer)
    if (!raster || !isLit(light)) return raster
    const ctx = raster.getContext('2d')
    if (!ctx) return raster
    const copy = document.createElement('canvas')
    copy.width = raster.width
    copy.height = raster.height
    copy.getContext('2d')?.drawImage(raster, 0, 0)
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgb(${Math.round(light.r * 255)}, ${Math.round(light.g * 255)}, ${Math.round(light.b * 255)})`
    ctx.fillRect(0, 0, raster.width, raster.height)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(copy, 0, 0)
    return raster
}

function drawCpu(ctx: CanvasRenderingContext2D, layer: NameplateLayer, scale: number, originX: number, originY: number, light: Light) {
    drawRasterLayer(ctx, layer, scale, originX, originY, { raster: tinted(layer, light), additive: false })
}

function cpuAt(layer: NameplateLayer, x: number, y: number, out: number[]): void {
    const column = x - layer.left
    const row = y - layer.top
    if (column < 0 || row < 0 || column >= layer.rasterWidth || row >= layer.rasterHeight) {
        out[0] = out[1] = out[2] = out[3] = 0
        return
    }
    const at = (row * layer.rasterWidth + column) * 4
    out[0] = layer.rgba[at]
    out[1] = layer.rgba[at + 1]
    out[2] = layer.rgba[at + 2]
    out[3] = layer.rgba[at + 3]
}

function compare(
    ctx: CanvasRenderingContext2D,
    preview: NameplatePreview,
    layer: NameplateLayer,
    draw: MaterialDraw,
    scale: number,
    originX: number,
    originY: number,
) {
    const gpu = renderParity(preview, draw)
    if (!gpu) return
    const area = draw.area
    const width = area[2] - area[0]
    const height = area[3] - area[1]
    const cpu = [0, 0, 0, 0]
    let over = 0
    ctx.save()
    ctx.fillStyle = DIFF_FILL
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const lx = area[0] + i
            const ly = area[1] + j
            cpuAt(layer, lx, ly, cpu)
            const at = (j * width + i) * 4
            let worst = 0
            for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(gpu[at + c] - cpu[c]))
            if (worst <= TOLERANCE) continue
            over++
            const sx = draw.mirrorX ? draw.x + draw.width - lx - 1 : draw.x + lx
            const sy = draw.y + ly
            ctx.fillRect(originX + sx * scale, originY + sy * scale, scale, scale)
        }
    }
    if (over === 0) {
        const rect = materialRect(draw, { scale, originX, originY })
        ctx.strokeStyle = MATCH_OUTLINE
        ctx.lineWidth = 1
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
    }
    ctx.restore()
    const source = preview.shader(draw.key)
    session.compared.push({
        layer: draw.layer,
        pixels: width * height,
        over,
        atlas: !!source?.textures.some((ref) => ref.kind === 'atlas'),
    })
}

function clipSide(ctx: CanvasRenderingContext2D, middle: number, right: boolean) {
    const width = ctx.canvas.width
    const height = ctx.canvas.height
    ctx.beginPath()
    if (right) ctx.rect(middle, 0, Math.max(0, width - middle), height)
    else ctx.rect(0, 0, Math.max(0, middle), height)
    ctx.clip()
}

function split(
    ctx: CanvasRenderingContext2D,
    preview: NameplatePreview,
    layer: NameplateLayer,
    draw: MaterialDraw,
    scale: number,
    originX: number,
    originY: number,
    light: Light,
): boolean {
    const rect = materialRect(draw, { scale, originX, originY })
    const middle = originX + Math.round((rect.x - originX) / scale + (draw.area[2] - draw.area[0]) / 2) * scale
    ctx.save()
    clipSide(ctx, middle, false)
    const drawn = renderMaterial(ctx, preview, draw, { scale, originX, originY }, light)
    ctx.restore()
    if (!drawn) return false
    ctx.save()
    clipSide(ctx, middle, true)
    drawCpu(ctx, layer, scale, originX, originY, light)
    ctx.restore()
    ctx.save()
    ctx.strokeStyle = SPLIT_LINE
    ctx.setLineDash?.([scale, scale])
    ctx.beginPath()
    ctx.moveTo(middle + 0.5, rect.y)
    ctx.lineTo(middle + 0.5, rect.y + rect.height)
    ctx.stroke()
    ctx.restore()
    return true
}

export function composeLayers(ctx: CanvasRenderingContext2D, layers: NameplateLayer[], scale: number, originX: number, originY: number) {
    ctx.imageSmoothingEnabled = false
    const light = currentLight()
    const preview = session.preview
    const gpu = !!preview && gpuWanted()
    const mode = previewOptions.compare
    for (const layer of inDrawOrder(layers)) {
        const draw = gpu ? materialDrawOf(layer) : null
        if (draw && preview) {
            if (mode === 'split') {
                if (split(ctx, preview, layer, draw, scale, originX, originY, light)) {
                    session.gpuDrawn++
                    continue
                }
            } else if (renderMaterial(ctx, preview, draw, { scale, originX, originY }, light)) {
                session.gpuDrawn++
                if (mode === 'diff') compare(ctx, preview, layer, draw, scale, originX, originY)
                continue
            }
            session.cpuDrawn++
        }
        drawCpu(ctx, layer, scale, originX, originY, light)
    }
}

export function gpuNotes(): string {
    const look = currentLook()
    const notes: string[] = []
    const preview = session.preview
    const hasEffects = !!preview?.hasMaterials
    if (hasEffects && look.gpu && look.effects && !gpuAvailable()) {
        notes.push("This browser can't draw full effects, so basic effects show.")
    }
    const failures = shaderFailures().filter((failure) => preview?.shader(failure.key))
    if (look.gpu && failures.length) {
        notes.push(`Effect ${failures.map((failure) => `'${failure.material}'`).join(', ')} couldn't be built as a full effect, so its basic version shows, as in game.`)
    }
    if (hasEffects && preview?.shaders().some((source) => source.textures.some((ref) => ref.kind !== 'bundle'))) {
        notes.push('Game and block textures show stand-in art; the game uses its own textures.')
    }
    if (hasEffects && look.gpu && previewOptions.compare !== 'off' && !gpuAvailable()) {
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
            if (compared.some((entry) => entry.atlas)) notes.push("Block textures are compared on their first frame; in game, full effects animate them and basic effects don't.")
        }
    }
    if (hasEffects && !look.gpu && previewOptions.compare !== 'off') {
        notes.push('Pick a full-effects Game Look to compare it with basic effects.')
    }
    if (isLit() && hasEffects && look.gpu) notes.push('Effects marked "Glows in the dark" stay bright; everything else takes the light.')
    return notes.join(' ')
}

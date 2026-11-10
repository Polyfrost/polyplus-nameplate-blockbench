import { onHeavy, onLight, retainEvents } from '../design/events'
import { readLayers } from '../elements'
import { findNode } from '../elements/nodes'
import { layerLeft, layerTop, NameplateLayer } from '../engine'
import { isNameplateActive } from '../format'
import { SPRITE_TYPE } from '../model'
import { paintTexture, textureOf } from '../navigate'
import { OffPaletteScan, offPalettePixels, paletteTextureUuids } from './sprites'
import { disposeAll } from '../util/teardown'
import { findTexture } from '../util/texture'
import { readNameplate } from './state'

const OVERLAY_CLASS = 'np-offpalette-overlay'
const MARK_COLOR = '#FF2BD6'
const FOCUS_COLOR = '#FFE14D'
const MAX_MARKS = 4096
const MAX_CANVAS_WIDTH = 4096
const MAX_CANVAS_HEIGHT = 8192
const MAX_CELL = 8
const TARGET_PIXEL = 24
const FOCUS_MS = 2500
const SETTLE_MS = 60
const SETTLE_TRIES = 10

interface Focus {
    texture: string
    frame: number
    x: number
    y: number
    until: number
}

const scans = new Map<string, OffPaletteScan | null>()
const frameMatches = new WeakMap<Uint8ClampedArray, number>()
let used: Set<string> | null = null
let overlay: HTMLCanvasElement | null = null
let focus: Focus | null = null
let removers: Array<() => void> = []
const timers = new Set<number>()

function later(run: () => void, delay: number) {
    const id = window.setTimeout(() => {
        timers.delete(id)
        run()
    }, delay)
    timers.add(id)
}

function usedTextures(): Set<string> {
    if (!used) {
        try {
            used = paletteTextureUuids(readLayers())
        } catch (error) {
            used = new Set()
        }
    }
    return used
}

function offPaletteScan(texture: Texture): OffPaletteScan | null {
    if (!usedTextures().has(texture.uuid)) return null
    if (scans.has(texture.uuid)) return scans.get(texture.uuid) ?? null
    let scan: OffPaletteScan | null = null
    try {
        scan = offPalettePixels(texture, readNameplate().palette, MAX_MARKS)
    } catch (error) {
        console.error('[polyplus_nameplate] could not scan the texture for off-palette pixels', error)
    }
    scans.set(texture.uuid, scan)
    return scan
}

function forget() {
    scans.clear()
    used = null
}

function editorVue(): any {
    return typeof UVEditor !== 'undefined' && UVEditor ? UVEditor.vue : null
}

function shownTexture(): Texture | null {
    const texture = editorVue()?.texture
    return texture && typeof texture === 'object' && typeof texture.uuid === 'string' ? (texture as Texture) : null
}

function frameHost(): HTMLElement | null {
    const host = editorVue()?.$refs?.frame
    return host instanceof HTMLElement ? host : null
}

function removeOverlay() {
    overlay?.remove()
}

function makeOverlay(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.className = OVERLAY_CLASS
    Object.assign(canvas.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        imageRendering: 'pixelated',
        zIndex: '5',
    })
    return canvas
}

function shownRows(texture: Texture): { start: number, height: number } {
    const frames = Number((texture as any).frameCount) || 1
    const height = frames > 1 ? Number((texture as any).display_height) || texture.height : texture.height
    const current = frames > 1 ? Math.max(0, Math.floor(Number((texture as any).currentFrame) || 0)) : 0
    return { start: current * height, height }
}

function activeFocus(texture: Texture): Focus | null {
    if (!focus || focus.texture !== texture.uuid) return null
    if (Date.now() > focus.until) {
        focus = null
        return null
    }
    return focus
}

function drawOverlay(canvas: HTMLCanvasElement, texture: Texture, scan: OffPaletteScan) {
    const rows = shownRows(texture)
    const cell = Math.max(1, Math.min(MAX_CELL, Math.floor(Math.min(MAX_CANVAS_WIDTH / scan.width, MAX_CANVAS_HEIGHT / rows.height))))
    const width = scan.width * cell
    const height = rows.height * cell
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    const line = Math.max(1, Math.floor(cell / 4))
    ctx.lineWidth = line
    ctx.strokeStyle = MARK_COLOR
    ctx.fillStyle = MARK_COLOR
    for (const pixel of scan.pixels) {
        const row = pixel.frame * scan.frameHeight + pixel.y - rows.start
        if (row < 0 || row >= rows.height) continue
        if (cell < 3) ctx.fillRect(pixel.x * cell, row * cell, cell, cell)
        else ctx.strokeRect(pixel.x * cell + line / 2, row * cell + line / 2, cell - line, cell - line)
    }
    const spot = activeFocus(texture)
    if (!spot) return
    const row = spot.frame * scan.frameHeight + spot.y - rows.start
    if (row < 0 || row >= rows.height) return
    const ring = Math.max(1, Math.floor(cell / 3))
    ctx.lineWidth = ring
    ctx.strokeStyle = FOCUS_COLOR
    ctx.strokeRect((spot.x - 1) * cell + ring / 2, (row - 1) * cell + ring / 2, cell * 3 - ring, cell * 3 - ring)
}

function syncHighlight() {
    try {
        const texture = isNameplateActive() ? shownTexture() : null
        const host = texture ? frameHost() : null
        const scan = texture && host ? offPaletteScan(texture) : null
        if (!texture || !host || !scan || scan.pixels.length === 0) {
            removeOverlay()
            return
        }
        overlay ??= makeOverlay()
        if (overlay.parentElement !== host) host.appendChild(overlay)
        drawOverlay(overlay, texture, scan)
    } catch (error) {
        console.error('[polyplus_nameplate] off-palette highlight failed', error)
    }
}

function centerOn(texture: Texture, frame: number, x: number, y: number, tries = SETTLE_TRIES) {
    const vue = editorVue()
    if (!vue || !(texture.width > 0)) return
    if (vue.texture !== texture) {
        if (tries > 0) later(() => centerOn(texture, frame, x, y, tries - 1), SETTLE_MS)
        return
    }
    const scan = offPaletteScan(texture)
    let row = frame * (scan?.frameHeight ?? texture.height) + y
    const frames = Number((texture as any).frameCount) || 1
    if (frames > 1) {
        const shown = Number((texture as any).display_height) || texture.height
        ;(texture as any).currentFrame = Math.min(frames - 1, Math.floor(row / shown))
        row %= shown
        vue.updateTextureCanvas?.()
    }
    const pixel = Number(vue.inner_width) / texture.width
    if (pixel > 0 && pixel < TARGET_PIXEL) UVEditor.setZoom(Number(vue.zoom) * (TARGET_PIXEL / pixel))
    later(() => {
        const size = Number(vue.inner_width) / texture.width
        const viewport = vue.$refs?.viewport as HTMLElement | undefined
        const margin = typeof vue.getFrameMargin === 'function' ? vue.getFrameMargin() : [0, 0]
        if (viewport && size > 0) {
            viewport.scrollLeft = (x + 0.5) * size + margin[0] - Number(UVEditor.width) / 2
            viewport.scrollTop = (row + 0.5) * size + margin[1] - Number(UVEditor.height) / 2
        }
        try {
            UVEditor.updateUVNavigator?.()
        } catch (error) {
            console.error('[polyplus_nameplate] could not update the texture navigator', error)
        }
        syncHighlight()
    }, SETTLE_MS)
}

export function jumpToPixel(textureUuid: string, frame: number, x: number, y: number) {
    const texture = findTexture(textureUuid)
    if (!texture) return
    focus = { texture: textureUuid, frame, x, y, until: Date.now() + FOCUS_MS }
    paintTexture(texture)
    later(() => {
        try {
            centerOn(texture, frame, x, y)
        } catch (error) {
            console.error('[polyplus_nameplate] could not show the pixel', error)
        }
    }, SETTLE_MS)
    later(syncHighlight, FOCUS_MS + SETTLE_MS)
}

function shownFrame(entry: NameplateLayer, scan: OffPaletteScan): number {
    const known = frameMatches.get(entry.rgba)
    if (known !== undefined) return known
    let best = 0
    let bestScore = -1
    const size = scan.width * scan.frameHeight
    for (let frame = 0; frame < scan.frames; frame++) {
        let score = 0
        for (let index = 0; index < size; index++) {
            const drawn = entry.rgba[index * 4 + 3] > 0 ? 1 : 0
            if (drawn === scan.painted[frame * size + index]) score++
        }
        if (score > bestScore) {
            best = frame
            bestScore = score
        }
    }
    frameMatches.set(entry.rgba, best)
    return best
}

export function drawOffPaletteMarks(
    ctx: CanvasRenderingContext2D,
    layers: NameplateLayer[],
    order: string[],
    scale: number,
    originX: number,
    originY: number,
) {
    if (!(scale > 0) || !isNameplateActive()) return
    try {
        ctx.save()
        ctx.strokeStyle = MARK_COLOR
        ctx.lineWidth = Math.max(1, Math.floor(scale / 4))
        for (const entry of layers) {
            if (entry.rasterWidth <= 0 || entry.rasterHeight <= 0) continue
            const node = findNode(order[entry.index] ?? '')
            if (!node || node.type !== SPRITE_TYPE) continue
            const texture = textureOf(node)
            const scan = texture ? offPaletteScan(texture) : null
            if (!scan || scan.pixels.length === 0) continue
            const left = layerLeft(entry)
            const top = layerTop(entry)
            if (entry.rasterWidth !== scan.width || entry.rasterHeight !== scan.frameHeight) {
                ctx.setLineDash?.([3, 3])
                ctx.strokeRect(originX + left * scale + 0.5, originY + top * scale + 0.5, entry.rasterWidth * scale - 1, entry.rasterHeight * scale - 1)
                ctx.setLineDash?.([])
                continue
            }
            const frame = shownFrame(entry, scan)
            const inset = ctx.lineWidth / 2
            for (const pixel of scan.pixels) {
                if (pixel.frame !== frame) continue
                const column = entry.mirrorX ? entry.rasterWidth - 1 - pixel.x : pixel.x
                ctx.strokeRect(originX + (left + column) * scale + inset, originY + (top + pixel.y) * scale + inset, scale - inset * 2, scale - inset * 2)
            }
        }
    } catch (error) {
        console.error('[polyplus_nameplate] could not mark off-palette pixels on the stage', error)
    } finally {
        ctx.restore()
    }
}

export function registerHighlight(): () => void {
    if (removers.length) return () => {}
    removers = [
        retainEvents(),
        onLight(() => syncHighlight()),
        onHeavy(() => {
            forget()
            syncHighlight()
        }),
    ]
    return () => {
        disposeAll(removers)
        for (const id of timers) window.clearTimeout(id)
        timers.clear()
        focus = null
        removeOverlay()
        overlay = null
        forget()
    }
}

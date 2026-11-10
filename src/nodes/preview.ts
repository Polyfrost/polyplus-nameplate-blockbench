import { BlockRect, BundleBinary, drawLayers, layerBounds, lineBlock, loadBundle, NameplateBlock, NameplateLayer, NameplatePreview } from '../engine'
import { drawStyledText, measure, textStyle } from '../font'
import { mainLayout, nameRow, previewName } from '../preview'
import { MaterialContext } from './context'
import { MaterialJson } from './graph'
import { bundleFiles, usedTextures } from './validate'

const DELAY = 200
const PAD = 3
const MAX_SCALE = 6
const MAX_HEIGHT = 150
const MAX_CACHE = 240
const FRONT = 'over_text'
const NAME_COLOR = '#FFFFFF'
const TAG_BACKGROUND = 'rgba(0, 0, 0, 0.25)'
const BACKDROPS = [
    { id: 'day', label: 'Day', icon: 'wb_sunny', color: '#8DB2E6' },
    { id: 'night', label: 'Night', icon: 'dark_mode', color: '#12151E' },
    { id: 'gray', label: 'Gray', icon: 'contrast', color: '#5A5F69' },
]

interface Tag {
    block: NameplateBlock
    background: BlockRect
    name: { x: number, y: number, width: number }
    text: string
}

function fallbackTag(): Tag {
    const text = 'Steve'
    const width = Math.max(1, measure(text) - 1)
    return { block: lineBlock(width, 0, width), background: { x0: -1, y0: -1, x1: width + 1, y1: 8 }, name: { x: 0, y: 0, width }, text }
}

function currentTag(): Tag {
    try {
        const layout = mainLayout()
        const row = nameRow(layout)
        return { block: layout.block, background: layout.background, name: { x: row.x, y: row.y, width: row.width }, text: previewName() }
    } catch {
        return fallbackTag()
    }
}

function binaryOf(graph: MaterialJson, context: MaterialContext): BundleBinary {
    const binary: BundleBinary = {}
    for (const id of usedTextures(graph)) {
        const bytes = context.textures[id]?.png?.()
        if (bytes) binary[`textures/${id}.png`] = bytes
    }
    return binary
}

function mark(x: number, y: number, width: number, height: number): NameplateLayer {
    return { left: 0, top: 0, x, y, width, mirrorX: false, rasterWidth: Math.max(1, width), rasterHeight: Math.max(1, height) } as NameplateLayer
}

export class MaterialPreview {
    private readonly canvas: HTMLCanvasElement
    private readonly caption: HTMLElement
    private readonly playButton: HTMLButtonElement
    private readonly backdropButton: HTMLButtonElement
    private preview: NameplatePreview | null = null
    private tag: Tag = fallbackTag()
    private frames = new Map<number, NameplateLayer[]>()
    private frame = 0
    private loop = 1
    private fps = 10
    private playing = true
    private backdrop = 0
    private message = ''
    private timer: ReturnType<typeof setInterval> | null = null
    private pending: ReturnType<typeof setTimeout> | null = null
    private destroyed = false

    constructor(private readonly host: HTMLElement) {
        host.classList.add('np-mat-preview')
        this.canvas = document.createElement('canvas')
        this.canvas.className = 'np-mat-preview-canvas'
        const bar = document.createElement('div')
        bar.className = 'np-mat-preview-bar'
        this.playButton = this.button(bar, () => this.togglePlay())
        this.backdropButton = this.button(bar, () => this.nextBackdrop())
        this.caption = document.createElement('span')
        this.caption.className = 'np-mat-preview-caption'
        bar.append(this.caption)
        host.append(this.canvas, bar)
        this.syncButtons()
    }

    private button(bar: HTMLElement, click: () => void): HTMLButtonElement {
        const button = document.createElement('button')
        button.type = 'button'
        button.addEventListener('click', click)
        bar.append(button)
        return button
    }

    private syncButtons() {
        this.playButton.innerHTML = `<i class="material-icons notranslate icon">${this.playing ? 'pause' : 'play_arrow'}</i>`
        this.playButton.title = this.playing ? 'Pause the preview' : 'Play the preview'
        const backdrop = BACKDROPS[this.backdrop]
        this.backdropButton.innerHTML = `<i class="material-icons notranslate icon">${backdrop.icon}</i>`
        this.backdropButton.title = `Backdrop: ${backdrop.label}. Click to change`
    }

    private togglePlay() {
        this.playing = !this.playing
        this.syncButtons()
        this.schedule()
        this.draw()
    }

    private nextBackdrop() {
        this.backdrop = (this.backdrop + 1) % BACKDROPS.length
        this.syncButtons()
        this.draw()
    }

    update(graph: MaterialJson, context: MaterialContext) {
        if (this.destroyed) return
        if (this.pending) clearTimeout(this.pending)
        this.pending = setTimeout(() => {
            this.pending = null
            this.rebuild(graph, context)
        }, DELAY)
    }

    private rebuild(graph: MaterialJson, context: MaterialContext) {
        if (this.destroyed) return
        this.frames.clear()
        this.tag = currentTag()
        try {
            const load = loadBundle(bundleFiles(graph, context), binaryOf(graph, context))
            this.preview = load.preview ?? load.draft?.() ?? null
            this.message = this.preview ? '' : 'Fix the problems below to see the preview.'
        } catch (error) {
            console.error('[polyplus_nameplate] material preview failed', error)
            this.preview = null
            this.message = 'The preview couldn\'t be drawn.'
        }
        this.fps = Math.max(1, Math.min(60, this.preview?.fps ?? context.fps))
        this.loop = Math.max(1, this.preview?.loop ?? context.loop)
        this.frame %= this.loop
        this.schedule()
        this.draw()
    }

    private schedule() {
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        if (this.destroyed || !this.playing || !this.preview || this.loop <= 1) return
        this.timer = setInterval(() => {
            if (!this.host.isConnected) return
            this.frame = (this.frame + 1) % this.loop
            this.draw()
        }, 1000 / this.fps)
    }

    private layersAt(frame: number): NameplateLayer[] {
        const preview = this.preview
        if (!preview) return []
        const known = this.frames.get(frame)
        if (known) return known
        let layers: NameplateLayer[] = []
        try {
            layers = preview.paint(preview.variants[0] ?? '', this.tag.block, frame, 0)
        } catch (error) {
            console.error('[polyplus_nameplate] material preview paint failed', error)
            this.message = 'The preview couldn\'t be drawn.'
            this.preview = null
            this.schedule()
        }
        if (this.frames.size >= MAX_CACHE) this.frames.clear()
        this.frames.set(frame, layers)
        return layers
    }

    draw() {
        if (this.destroyed) return
        const ctx = this.canvas.getContext('2d')
        if (!ctx) return
        const tag = this.tag
        const layers = this.layersAt(this.frame)
        const background = !!this.preview && !this.preview.ownsBackground(this.preview.variants[0] ?? '')
        const bounds = layerBounds([
            ...layers,
            mark(tag.name.x, tag.name.y, tag.name.width, 8),
            mark(tag.background.x0, tag.background.y0, tag.background.x1 - tag.background.x0, tag.background.y1 - tag.background.y0),
        ])
        const columns = bounds.width + PAD * 2
        const rows = bounds.height + PAD * 2
        const room = Math.max(60, (this.host.clientWidth || 280) - 2)
        const scale = Math.max(1, Math.min(MAX_SCALE, Math.floor(Math.min(room / columns, MAX_HEIGHT / rows))))
        this.canvas.width = columns * scale
        this.canvas.height = rows * scale
        this.canvas.style.width = `${this.canvas.width}px`
        this.canvas.style.height = `${this.canvas.height}px`
        const originX = (PAD - bounds.minX) * scale
        const originY = (PAD - bounds.minY) * scale
        ctx.imageSmoothingEnabled = false
        ctx.fillStyle = BACKDROPS[this.backdrop].color
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
        if (background) {
            const rect = tag.background
            ctx.fillStyle = TAG_BACKGROUND
            ctx.fillRect(originX + rect.x0 * scale, originY + rect.y0 * scale, (rect.x1 - rect.x0) * scale, (rect.y1 - rect.y0) * scale)
        }
        drawLayers(ctx, layers.filter((layer) => layer.depth !== FRONT), scale, originX, originY)
        drawStyledText(ctx, tag.text, originX + tag.name.x * scale, originY + tag.name.y * scale, scale, textStyle(NAME_COLOR))
        drawLayers(ctx, layers.filter((layer) => layer.depth === FRONT), scale, originX, originY)
        this.caption.textContent = this.message || `Frame ${this.frame + 1} of ${this.loop}`
    }

    destroy() {
        this.destroyed = true
        if (this.timer) clearInterval(this.timer)
        if (this.pending) clearTimeout(this.pending)
        this.timer = null
        this.pending = null
        this.frames.clear()
        this.preview = null
    }
}

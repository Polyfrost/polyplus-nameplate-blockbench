import { Box, Position } from './arrange'
import { MapBox, MaterialCanvas } from './view'

const WIDTH = 168
const HEIGHT = 112
const PAD = 6
const MARGIN = 40

interface MapFrame {
    scale: number
    left: number
    top: number
}

function mapFrame(boxes: Box[], view: Box, width = WIDTH, height = HEIGHT): MapFrame {
    const all = [...boxes, view]
    const minX = Math.min(...all.map((box) => box.x)) - MARGIN
    const minY = Math.min(...all.map((box) => box.y)) - MARGIN
    const maxX = Math.max(...all.map((box) => box.x + box.width)) + MARGIN
    const maxY = Math.max(...all.map((box) => box.y + box.height)) + MARGIN
    const scale = Math.min((width - 2 * PAD) / Math.max(1, maxX - minX), (height - 2 * PAD) / Math.max(1, maxY - minY))
    const left = PAD + ((width - 2 * PAD) - (maxX - minX) * scale) / 2 - minX * scale
    const top = PAD + ((height - 2 * PAD) - (maxY - minY) * scale) / 2 - minY * scale
    return { scale, left, top }
}

function mapToWorld(frame: MapFrame, x: number, y: number): Position {
    return { x: (x - frame.left) / frame.scale, y: (y - frame.top) / frame.scale }
}

function needsMap(boxes: Box[], view: Box): boolean {
    if (boxes.length < 2) return false
    return boxes.some((box) => box.x < view.x || box.y < view.y || box.x + box.width > view.x + view.width || box.y + box.height > view.y + view.height)
}

export class Minimap {
    private frame: MapFrame | null = null
    private dragFrame: MapFrame | null = null
    private queued = false
    private readonly stop: () => void
    private readonly watch: ResizeObserver | null

    constructor(private readonly element: HTMLCanvasElement, private readonly canvas: MaterialCanvas) {
        element.width = WIDTH
        element.height = HEIGHT
        element.style.width = `${WIDTH}px`
        element.style.height = `${HEIGHT}px`
        element.title = 'Map of the whole graph. Click or drag to move the view'
        element.addEventListener('pointerdown', this.down)
        element.addEventListener('pointermove', this.move)
        element.addEventListener('pointerup', this.up)
        element.addEventListener('pointercancel', this.up)
        element.addEventListener('wheel', this.wheel, { passive: true })
        this.stop = canvas.onView(() => this.schedule())
        this.watch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.schedule()) : null
        this.watch?.observe(canvas.area.container)
        this.schedule()
    }

    private readonly down = (event: PointerEvent) => {
        if (event.button !== 0 || !this.frame) return
        event.preventDefault()
        event.stopPropagation()
        this.dragFrame = this.frame
        this.element.setPointerCapture?.(event.pointerId)
        this.jump(event)
    }

    private readonly move = (event: PointerEvent) => {
        if (this.dragFrame) this.jump(event)
    }

    private readonly up = (event: PointerEvent) => {
        if (!this.dragFrame) return
        this.dragFrame = null
        if (this.element.hasPointerCapture?.(event.pointerId)) this.element.releasePointerCapture(event.pointerId)
        this.schedule()
    }

    private readonly wheel = (event: WheelEvent) => {
        event.stopPropagation()
    }

    private jump(event: PointerEvent) {
        const frame = this.dragFrame
        if (!frame) return
        const rect = this.element.getBoundingClientRect()
        const scaleX = rect.width ? WIDTH / rect.width : 1
        const scaleY = rect.height ? HEIGHT / rect.height : 1
        void this.canvas.centerOn(mapToWorld(frame, (event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY))
    }

    schedule() {
        if (this.queued) return
        this.queued = true
        requestAnimationFrame(() => {
            this.queued = false
            this.draw()
        })
    }

    private color(style: CSSStyleDeclaration, name: string, fallback: string): string {
        return style.getPropertyValue(name).trim() || fallback
    }

    private draw() {
        if (!this.element.isConnected || !this.canvas.hasSize()) return
        const boxes: MapBox[] = this.canvas.mapBoxes()
        const view = this.canvas.viewRect()
        const visible = !!this.dragFrame || needsMap(boxes, view)
        this.element.classList.toggle('np-minimap-hidden', !visible)
        if (!visible) {
            this.frame = null
            return
        }
        const frame = this.dragFrame ?? mapFrame(boxes, view)
        this.frame = frame
        const ctx = this.element.getContext('2d')
        if (!ctx) return
        const style = getComputedStyle(this.element)
        ctx.clearRect(0, 0, WIDTH, HEIGHT)
        ctx.fillStyle = this.color(style, '--color-back', '#1d1f24')
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        const plain = this.color(style, '--color-button', '#4c505a')
        const selected = this.color(style, '--color-accent', '#3e90ff')
        const bad = this.color(style, '--color-close', '#e0534f')
        for (const box of boxes) {
            ctx.fillStyle = box.selected ? selected : box.bad ? bad : plain
            ctx.fillRect(frame.left + box.x * frame.scale, frame.top + box.y * frame.scale, Math.max(2, box.width * frame.scale), Math.max(2, box.height * frame.scale))
        }
        ctx.strokeStyle = this.color(style, '--color-text', '#cacad4')
        ctx.lineWidth = 1
        ctx.strokeRect(
            Math.round(frame.left + view.x * frame.scale) + 0.5,
            Math.round(frame.top + view.y * frame.scale) + 0.5,
            Math.max(2, Math.round(view.width * frame.scale) - 1),
            Math.max(2, Math.round(view.height * frame.scale) - 1),
        )
    }

    destroy() {
        this.stop()
        this.watch?.disconnect()
        this.element.removeEventListener('pointerdown', this.down)
        this.element.removeEventListener('pointermove', this.move)
        this.element.removeEventListener('pointerup', this.up)
        this.element.removeEventListener('pointercancel', this.up)
        this.element.removeEventListener('wheel', this.wheel)
    }
}

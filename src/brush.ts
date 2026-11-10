import { alphaOf, paletteHex, toRgbHex } from './palette/color'
import { createListenerSet } from './util/events'

const listeners = createListenerSet('brush listener failed')
const PAINT_TOOL = 'brush_tool'
const SEE_THROUGH_BLEND = 'set_opacity'

let color = '#000000'
let subscription: Deletable | null = null
let restore: { opacity: number, blend: string, setOpacity: number } | null = null

export function getBrush(): string {
    return color
}

export function onBrushChange(listener: () => void): () => void {
    return listeners.on(listener)
}

function notify() {
    listeners.notify()
}

function usingPaintTool(): boolean {
    const toolbox = (globalThis as any).Toolbox
    return !!toolbox?.selected?.paintTool && toolbox.selected.id !== 'color_picker'
}

function opacityRange(): number {
    const range = (globalThis as any).settings?.opacity_range?.value
    return String(range) === '255' ? 255 : 100
}

function currentOpacity(): number {
    const value = Number((globalThis as any).BarItems?.slider_brush_opacity?.get?.())
    return isFinite(value) ? value : opacityRange()
}

function setOpacity(value: number) {
    const items = (globalThis as any).BarItems ?? {}
    for (const id in items) {
        const tool = items[id]
        if (tool?.tool_settings && tool.tool_settings.brush_opacity >= 0) tool.tool_settings.brush_opacity = value
    }
    items.slider_brush_opacity?.update?.()
}

function blendSelect(): any {
    return (globalThis as any).BarItems?.blend_mode
}

function matchBrushAlpha(alpha: number) {
    const blend = blendSelect()
    if (alpha < 255) {
        const opacity = Math.round((alpha / 255) * opacityRange())
        if (!restore) restore = { opacity: currentOpacity(), blend: String(blend?.value ?? 'default'), setOpacity: opacity }
        restore.setOpacity = opacity
        setOpacity(opacity)
        if (blend && blend.value !== SEE_THROUGH_BLEND) blend.set?.(SEE_THROUGH_BLEND)
        return
    }
    if (!restore) return
    const saved = restore
    restore = null
    if (currentOpacity() === saved.setOpacity) setOpacity(saved.opacity)
    if (blend && blend.value === SEE_THROUGH_BLEND) blend.set?.(saved.blend)
}

export function setBrush(value: string, pickTool = false) {
    color = paletteHex(value)
    try {
        ColorPanel.set(toRgbHex(color))
    } catch (error) {
        console.error('[polyplus_nameplate] could not set the paint color', error)
    }
    try {
        matchBrushAlpha(alphaOf(color))
    } catch (error) {
        console.error('[polyplus_nameplate] could not match the brush opacity', error)
    }
    if (pickTool && !usingPaintTool()) {
        const tool = (globalThis as any).BarItems?.[PAINT_TOOL]
        try {
            tool?.select?.()
        } catch (error) {
            console.error('[polyplus_nameplate] could not pick the brush', error)
        }
    }
    notify()
}

export function watchBrush(): () => void {
    if (!subscription) {
        subscription = Blockbench.on('change_color', (event: any) => {
            if (!event || event.secondary || typeof event.color !== 'string') return
            const next = toRgbHex(event.color)
            if (next.toLowerCase() === toRgbHex(color).toLowerCase()) return
            color = next
            notify()
        })
    }
    return () => {
        subscription?.delete()
        subscription = null
        listeners.clear()
        try {
            matchBrushAlpha(255)
        } catch (error) {
            console.error('[polyplus_nameplate] could not restore the brush opacity', error)
        }
    }
}

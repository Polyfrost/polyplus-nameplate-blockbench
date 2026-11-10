import { getBrush, setBrush } from '../brush'
import { limited } from '../elements/limits'
import { FORMAT_ID, Slot } from '../model'
import { DESIGN_MODE, goMode } from '../navigate'
import { splitRgb, toRgbHex } from '../palette/color'
import { frameCountOf } from '../palette/sprites'
import { readNameplate } from '../palette/state'

type SweepAxis = 'x' | 'y' | 'diagonal'

const SWEEP_TOOL = 'polyplus_nameplate_sweep_brush'
const BRUSH_TOOL = 'brush_tool'
const MAX_BAND = 8

const SWEEP_AXES: Record<SweepAxis, string> = {
    x: 'Left to right',
    y: 'Top to bottom',
    diagonal: 'Diagonal',
}

interface Rgba {
    r: number
    g: number
    b: number
    a: number
}

interface Stroke {
    rgb: Array<[number, number, number]>
    frameHeight: number
}

const settings: { axis: SweepAxis, band: number, slot: string } = { axis: 'x', band: 1, slot: '' }
let stroke: Stroke | null = null
let tool: Tool | null = null

function rgbOf(hex: string): [number, number, number] {
    return splitRgb(Number.parseInt(toRgbHex(hex).slice(1), 16))
}

function slotOfColor(color: string): Slot | undefined {
    const wanted = toRgbHex(color).toUpperCase()
    return readNameplate().palette.slots.find((slot) => slot.ramp.some((tone) => toRgbHex(tone).toUpperCase() === wanted))
}

function sweepSlot(): Slot | undefined {
    const slots = readNameplate().palette.slots
    const brush = toRgbHex(getBrush()).toUpperCase()
    const chosen = slots.find((slot) => slot.id === settings.slot)
    if (chosen && chosen.ramp.some((tone) => toRgbHex(tone).toUpperCase() === brush)) return chosen
    return slotOfColor(brush) ?? chosen
}

function sweepTone(x: number, y: number, frameHeight: number, tones: number): number {
    const row = frameHeight > 0 ? ((y % frameHeight) + frameHeight) % frameHeight : y
    const position = settings.axis === 'x' ? x : settings.axis === 'y' ? row : x + row
    const step = Math.floor(Math.max(0, position) / Math.max(1, settings.band))
    return tones > 0 ? step % tones : 0
}

function beginStroke(texture: Texture | undefined): boolean {
    const slot = sweepSlot()
    if (!slot || slot.ramp.length === 0) {
        Blockbench.showQuickMessage('Click a shade in the Colors strip first.', 2600)
        stroke = null
        return false
    }
    settings.slot = slot.id
    const height = Number(texture?.height ?? (texture as any)?.canvas?.height ?? 0)
    const frames = texture ? frameCountOf(texture) : 1
    stroke = { rgb: slot.ramp.map(rgbOf), frameHeight: height > 0 ? Math.floor(height / Math.max(1, frames)) : 0 }
    return true
}

function sweepPixel(px: number, py: number, pxcolor: Rgba, localOpacity: number, texture?: Texture): Rgba {
    if (!stroke && !beginStroke(texture)) return pxcolor
    if (localOpacity < 0.5 || !stroke) return pxcolor
    const [r, g, b] = stroke.rgb[sweepTone(px, py, stroke.frameHeight, stroke.rgb.length)]
    return { r, g, b, a: 1 }
}

function startSweep(slotId: string, axis: SweepAxis, band: number) {
    const slot = readNameplate().palette.slots.find((entry) => entry.id === slotId)
    if (!slot) return
    settings.slot = slot.id
    settings.axis = axis
    settings.band = limited(band, 1, MAX_BAND, 1, 'Pixels per shade')
    goMode('design')
    setBrush(toRgbHex(slot.ramp[0]), false)
    try {
        tool?.select()
    } catch (error) {
        console.error('[polyplus_nameplate] could not pick the sweep brush', error)
    }
}

export function openSweepDialog(slotId: string) {
    const slot = readNameplate().palette.slots.find((entry) => entry.id === slotId)
    if (!slot) return
    const dialog = new Dialog({
        id: 'polyplus_nameplate_sweep',
        title: `Paint a Sweep of ${slot.name}`,
        width: 420,
        form: {
            about: {
                type: 'info',
                text: `Paints the ${slot.ramp.length} shades of '${slot.name}' in order. Give the color a Shimmer or Rainbow cycle to make them move.`,
            },
            axis: { type: 'select', label: 'Direction', options: SWEEP_AXES, value: settings.axis },
            band: { type: 'number', label: 'Pixels per shade', step: 1, value: settings.band, description: 'How wide each stripe is. 1 gives the finest shine' },
        },
        onConfirm(result: any) {
            startSweep(slot.id, result.axis as SweepAxis, Number(result.band))
        },
    } as any)
    dialog.show()
    return dialog
}

export function registerSweepBrush(): () => void {
    tool = new Tool(SWEEP_TOOL, {
        name: 'Sweep Brush',
        description: 'Paints the shades of one color in order. Click a shade in the Colors strip to pick the color',
        icon: 'gradient',
        category: 'tools',
        toolbar: 'brush',
        cursor: 'crosshair',
        selectFace: true,
        transformerMode: 'hidden',
        paintTool: true,
        allowed_view_modes: ['textured'],
        modes: [DESIGN_MODE],
        condition: { formats: [FORMAT_ID], modes: [DESIGN_MODE] },
        brush: {
            blend_modes: false,
            shapes: true,
            size: true,
            softness: false,
            opacity: false,
            offset_even_radius: true,
            floor_coordinates: true,
            onStrokeStart(context: { texture: Texture }) {
                return beginStroke(context.texture)
            },
            onStrokeEnd() {
                stroke = null
            },
            changePixel(px: number, py: number, pxcolor: Rgba, localOpacity: number, context: { texture: Texture }) {
                return sweepPixel(px, py, pxcolor, localOpacity, context.texture)
            },
        } as any,
    } as any)
    try {
        const toolbox = (globalThis as any).Toolbox
        const children: unknown[] = toolbox?.children ?? []
        const stale = children.filter((child) => child !== tool && (child as { id?: string } | null)?.id === SWEEP_TOOL)
        stale.forEach((copy) => toolbox.remove?.(copy))
        if (!toolbox?.children?.includes(tool)) {
            const brush = (globalThis as any).BarItems?.[BRUSH_TOOL]
            const at = children.indexOf(brush)
            toolbox?.add?.(tool, at >= 0 ? at + 1 : undefined)
        }
    } catch (error) {
        console.error('[polyplus_nameplate] could not add the sweep brush to the toolbox', error)
    }
    return () => {
        stroke = null
        tool?.delete()
        tool = null
    }
}

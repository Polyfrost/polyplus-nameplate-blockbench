import { limited, tell } from '../elements/limits'
import { wholeClamped } from '../util/num'
import { SPRITE_TYPE } from '../model'
import { currentFps } from '../format'
import { frameCountOf } from '../palette/sprites'
import { framesDescription } from '../sprite'
import { heading, labeled } from '../util/form'
import { findTexture } from '../util/texture'
import { widthRanges } from '../kinds/ranges'
import { readBreakpoints } from './read'
import { EDGES, LIMITS, SPRITE_FOLLOWS } from './types'

type FormConfig = Record<string, FormElementOptions | '_'>
type Result = Record<string, any>

export const ANCHOR_LABELS: Record<string, string> = {
    top_left: 'Top left',
    top: 'Top middle',
    top_right: 'Top right',
    left: 'Left middle',
    right: 'Right middle',
    bottom_left: 'Bottom left',
    bottom: 'Bottom middle',
    bottom_right: 'Bottom right',
    name_left: 'Left end of the name',
    name_right: 'Right end of the name',
}
const EDGE_LABELS: Record<string, string> = { top: 'Top edge', bottom: 'Bottom edge', left: 'Left edge', right: 'Right edge' }
const CURVE_EDGES = ['top', 'bottom']

const SPRITE_ADAPTIVE_KEY = /^(repeat_|bp_)/

export function secondsHint(): string {
    const fps = currentFps()
    return `At ${fps} fps, ${fps} frames is 1 second`
}

export function framesFieldDescription(keyed = false): string {
    return `${framesDescription(keyed)} If one picture already holds several frames, use Picture options > Split into Frames.`
}

function textureOptions(none: string, current: string): Record<string, string> {
    const result: Record<string, string> = { '': none }
    for (const texture of Texture.all) result[texture.uuid] = texture.name
    if (current && !(current in result)) result[current] = 'Missing picture'
    return result
}

function repeatEdges(node: any): Record<string, string> {
    if (!SPRITE_FOLLOWS.includes(node.follow)) return labeled(EDGES, EDGE_LABELS)
    const edges = labeled(CURVE_EDGES, EDGE_LABELS)
    if (CURVE_EDGES.includes(node.repeatEdge)) return edges
    return { [node.repeatEdge]: `${EDGE_LABELS[node.repeatEdge]} (can't follow the curve: pick another)`, ...edges }
}

const layerRanges = widthRanges({
    prefix: 'bp',
    read: (node) => readBreakpoints(node.breakpoints),
    onDescription: 'Hides this layer outside the ranges below',
    pictures: (node, index) => textureOptions('Same picture', readBreakpoints(node.breakpoints)[index]?.texture ?? ''),
    fallback: 'current',
})

function breakpointConfig(node: any): FormConfig {
    return layerRanges.config(node)
}

function breakpointValues(node: any): Result {
    return layerRanges.values!(node)
}


export function spriteAdaptiveConfig(node: any): FormConfig {
    return {
        repeat_title: heading('Repeat'),
        repeat_on: { type: 'checkbox', label: 'Repeat along an edge', style: 'toggle_switch', value: false, description: 'Places copies along one edge. Longer names get more copies. Turns the mirrored copy off' },
        repeat_edge: { type: 'select', label: 'Edge', options: repeatEdges(node), condition: (result: Result) => !!result?.repeat_on },
        repeat_spacing: { type: 'number', label: 'One copy every (px)', step: 1, value: 12, condition: (result: Result) => !!result?.repeat_on },
        repeat_min: { type: 'number', label: 'At least', step: 1, value: 1, condition: (result: Result) => !!result?.repeat_on },
        repeat_max: { type: 'number', label: 'At most', step: 1, value: 8, condition: (result: Result) => !!result?.repeat_on, description: `The most is ${LIMITS.repeats}` },
        ...breakpointConfig(node),
    }
}

export function spriteAdaptiveValues(node: any): Result {
    return {
        repeat_on: !!node.repeatOn,
        repeat_edge: node.repeatEdge ?? 'top',
        repeat_spacing: Number(node.repeatSpacing ?? 12),
        repeat_min: Number(node.repeatMin ?? 1),
        repeat_max: Number(node.repeatMax ?? 8),
        ...breakpointValues(node),
    }
}

function centeredPivot(pivot: string, edge: string): string {
    if (edge === 'top' || edge === 'bottom') {
        if (pivot.startsWith('top')) return 'top'
        if (pivot.startsWith('bottom')) return 'bottom'
        return edge === 'top' ? 'bottom' : 'top'
    }
    if (pivot.endsWith('left')) return 'left'
    if (pivot.endsWith('right')) return 'right'
    return edge === 'left' ? 'right' : 'left'
}

function centerRepeat(node: any) {
    node.pivot = centeredPivot(String(node.pivot || node.anchor || ''), node.repeatEdge)
    const axis = node.repeatEdge === 'left' || node.repeatEdge === 'right' ? 1 : 0
    const nudge = Array.isArray(node.offset) ? node.offset : [0, 0]
    if (!Number(nudge[axis])) return
    tell(`Nudge ${axis ? 'y' : 'x'} was ${nudge[axis]} px, which would push the row off center, so it is now 0.`)
    node.offset = axis ? [nudge[0], 0] : [0, nudge[1]]
}

function repeatLimitNote(node: any): string {
    const texture = findTexture(node.texture)
    const tall = node.repeatEdge === 'left' || node.repeatEdge === 'right'
    const size = !texture ? 0 : tall ? texture.height / Math.max(1, frameCountOf(texture)) : texture.width
    const first = `The most is ${LIMITS.repeats} copies, so it was set to ${LIMITS.repeats}.`
    if (!(size > 0)) return first
    return `${first} ${LIMITS.repeats} copies fill ${size * LIMITS.repeats} px. Use a larger picture to fill more.`
}

function repeatCount(node: any, value: unknown, fallback: number, label: string): number {
    if (Number(value) <= LIMITS.repeats) return limited(value, 1, LIMITS.repeats, fallback, label)
    tell(repeatLimitNote(node))
    return wholeClamped(value, 1, LIMITS.repeats, fallback)
}

function applySpriteAdaptive(node: any, key: string, result: Result): boolean {
    switch (key) {
        case 'repeat_on':
            node.repeatOn = !!result.repeat_on
            if (node.repeatOn) {
                node.mirror = false
                centerRepeat(node)
            }
            return true
        case 'repeat_edge':
            if (EDGES.includes(result.repeat_edge)) {
                node.repeatEdge = result.repeat_edge
                if (node.repeatOn) centerRepeat(node)
            }
            return true
        case 'repeat_spacing':
            node.repeatSpacing = limited(result.repeat_spacing, 1, LIMITS.spacing, node.repeatSpacing ?? 12, 'One copy every')
            return true
        case 'repeat_min':
            node.repeatMin = repeatCount(node, result.repeat_min, node.repeatMin ?? 1, 'At least')
            if (node.repeatMax < node.repeatMin) {
                node.repeatMax = node.repeatMin
                tell(`At most went up to ${node.repeatMax}, so it isn't below At least.`)
            }
            return true
        case 'repeat_max':
            node.repeatMax = repeatCount(node, result.repeat_max, node.repeatMax ?? 8, 'At most')
            if (node.repeatMin > node.repeatMax) {
                node.repeatMin = node.repeatMax
                tell(`At least went down to ${node.repeatMin}, so it isn't above At most.`)
            }
            return true
    }
    return false
}

export interface MotionFormHandlers {
    newParticleTexture(node: any): void
    emitterPreset(node: any): void
}

let handlers: MotionFormHandlers | null = null

export function setMotionFormHandlers(next: MotionFormHandlers | null) {
    handlers = next
}

export function motionHandlers(): MotionFormHandlers | null {
    return handlers
}

export function applyMotionField(node: any, key: string, result: Result): boolean {
    if (key.startsWith('bp_')) {
        node.breakpoints = layerRanges.from(node, result)
        return true
    }
    if (key === 'preset' || key === 'pool_new' || key.endsWith('_note') || key.endsWith('_paint')) return true
    if (node?.type === SPRITE_TYPE && SPRITE_ADAPTIVE_KEY.test(key)) return applySpriteAdaptive(node, key, result)
    return false
}

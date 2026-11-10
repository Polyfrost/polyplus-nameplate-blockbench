import { currentFps } from '../format'
import { keyframeTravel } from '../animate/interpolation'
import { findLoopAnimation } from '../util/animation'
import { decimalOr, wholeOr, wholeOrAtLeast } from '../util/num'
import {
    BurstKey,
    Edge,
    EDGE_ANCHORS,
    EDGE_FOLLOWS,
    EdgeAnchor,
    EdgeFollow,
    EDGES,
    Facing,
    FACINGS,
    PATH_PRESETS,
    PathPoint,
    PathPreset,
    PathStop,
    RepeatData,
    SpeedKey,
    SpriteAdaptiveData,
    WidthBreakpoint,
    BURST_CHANNEL,
    SPEED_CHANNEL,
} from './types'


export function wholePair(value: unknown, fallback: [number, number]): [number, number] {
    const list = Array.isArray(value) ? value : []
    return [wholeOr(list[0], fallback[0]), wholeOr(list[1], fallback[1])]
}

export function decimalPair(value: unknown, fallback: [number, number]): [number, number] {
    const list = Array.isArray(value) ? value : []
    return [decimalOr(list[0], fallback[0]), decimalOr(list[1], fallback[1])]
}

export function asEdgeAnchor(value: unknown, fallback: EdgeAnchor): EdgeAnchor {
    return EDGE_ANCHORS.includes(value as EdgeAnchor) ? (value as EdgeAnchor) : fallback
}

export function asEdge(value: unknown, fallback: Edge): Edge {
    return EDGES.includes(value as Edge) ? (value as Edge) : fallback
}

export function asPreset(value: unknown): PathPreset | null {
    return typeof value === 'string' && value in PATH_PRESETS ? (value as PathPreset) : null
}

export function asFollow(value: unknown): EdgeFollow | null {
    return EDGE_FOLLOWS.includes(value as EdgeFollow) ? (value as EdgeFollow) : null
}

export function readPoints(value: unknown): PathPoint[] {
    const list = Array.isArray(value) ? value : []
    return list.map((raw: any) => ({
        anchor: asEdgeAnchor(raw?.anchor, 'top_left'),
        offset: wholePair(raw?.offset, [0, 0]),
        pause: wholeOrAtLeast(raw?.pause, 0, 0),
    }))
}

export function readStops(value: unknown): PathStop[] {
    const list = Array.isArray(value) ? value : []
    return list.map((raw: any) => ({ at: decimalOr(raw?.at, 0), pause: wholeOr(raw?.pause, 1) }))
}

export function readFacings(value: unknown): Partial<Record<Facing, number[]>> {
    const result: Partial<Record<Facing, number[]>> = {}
    if (!value || typeof value !== 'object') return result
    for (const facing of FACINGS) {
        const list = (value as any)[facing]
        if (!Array.isArray(list) || list.length === 0) continue
        result[facing] = list.map((frame) => wholeOrAtLeast(frame, 0, 0))
    }
    return result
}

export function readBreakpoints(value: unknown): WidthBreakpoint[] {
    const list = Array.isArray(value) ? value : []
    return list.map((raw: any) => {
        const max = raw?.max === null || raw?.max === undefined || raw?.max === '' ? null : wholeOrAtLeast(raw.max, 0, 0)
        return {
            min: wholeOrAtLeast(raw?.min, 0, 0),
            max,
            texture: typeof raw?.texture === 'string' ? raw.texture : '',
        }
    })
}

export function readSpriteAdaptive(node: any): SpriteAdaptiveData {
    const repeat: RepeatData | null = node?.repeatOn
        ? {
            edge: asEdge(node.repeatEdge, 'top'),
            spacing: wholeOrAtLeast(node.repeatSpacing, 1, 12),
            min: wholeOrAtLeast(node.repeatMin, 1, 1),
            max: wholeOrAtLeast(node.repeatMax, 1, 1),
        }
        : null
    return { repeat, breakpoints: readBreakpoints(node?.breakpoints) }
}

function keyValue(keyframe: any): number {
    try {
        const value = Number(keyframe.calc('x'))
        return isFinite(value) ? value : NaN
    } catch {
        return NaN
    }
}

interface RawKey {
    frame: number
    keyframe: any
}

function channelKeys(uuid: string, channel: string, animation: any = findLoopAnimation(), fps: number = currentFps()): RawKey[] {
    const animator = animation?.animators?.[uuid]
    const keyframes: any[] = Array.isArray(animator?.[channel]) ? animator[channel] : []
    if (keyframes.length === 0) return []
    const sorted = keyframes
        .map((keyframe, index) => ({ keyframe, index }))
        .sort((a, b) => (a.keyframe.time - b.keyframe.time) || (a.index - b.index))
    const byFrame = new Map<number, any>()
    for (const entry of sorted) byFrame.set(Math.max(0, wholeOr(entry.keyframe.time * fps, 0)), entry.keyframe)
    return Array.from(byFrame.keys()).sort((a, b) => a - b).map((frame) => ({ frame, keyframe: byFrame.get(frame) }))
}

export function readSpeedKeys(uuid: string, step: number): SpeedKey[] {
    const raw = channelKeys(uuid, SPEED_CHANNEL)
    const byStep = new Map<number, { keyframe: any, previous: any }>()
    raw.forEach((entry, index) => {
        byStep.set(Math.floor(entry.frame / Math.max(1, step)), { keyframe: entry.keyframe, previous: index > 0 ? raw[index - 1].keyframe : null })
    })
    const steps = Array.from(byStep.keys()).sort((a, b) => a - b)
    return steps.map((at, index) => {
        const entry = byStep.get(at)!
        const value = keyValue(entry.keyframe)
        return {
            step: at,
            value: isNaN(value) ? 1 : Math.max(0, value),
            interpolation: index === 0 ? 'step' : keyframeTravel(entry.previous?.interpolation, entry.keyframe?.interpolation),
        }
    })
}

export function readTriggeredSpeedKeys(uuid: string, animation: any, fps: number): SpeedKey[] {
    const raw = channelKeys(uuid, SPEED_CHANNEL, animation, fps)
    return raw.map((entry, index) => {
        const value = keyValue(entry.keyframe)
        return {
            step: entry.frame,
            value: isNaN(value) ? 0 : value + 0,
            interpolation: index === 0 ? 'step' : keyframeTravel(raw[index - 1].keyframe?.interpolation, entry.keyframe?.interpolation),
        }
    })
}

export function readBurstKeys(uuid: string, animation?: any, fps?: number): BurstKey[] {
    return channelKeys(uuid, BURST_CHANNEL, animation ?? findLoopAnimation(), fps ?? currentFps()).map((entry) => {
        const value = keyValue(entry.keyframe)
        return { step: entry.frame, count: isNaN(value) ? 1 : Math.max(1, Math.round(value)) }
    })
}

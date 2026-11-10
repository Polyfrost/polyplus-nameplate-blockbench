import { isWhile, readSettings, reducedOf, scheduleOf, triggerOf } from '../animate/props'
import {
    Anchor,
    AnimationData,
    BADGE_TARGET,
    Channel,
    Depth,
    GroupData,
    Interpolation,
    KeyData,
    LayerData,
    LoopData,
    PLATE_TARGET,
    SPRITE_TYPE,
    TrackData,
} from '../model'
import { BODY_CHANNELS, GROUP_CHANNELS, SPRITE_CHANNELS } from './channels'
import { keyframeTravel } from '../animate/interpolation'
import { readBody } from '../kinds/body'
import { readSprite } from '../kinds/sprite'
import { assignIds } from './ids'
import { isGroupNode, isLayerNode, walkNodes } from './nodes'
import { motionTrackChannels } from '../motion/element'
import { readBurstKeys, readTriggeredSpeedKeys } from '../motion/read'
import { readPath } from '../kinds/path'
import { readEmitter } from '../kinds/emitter'
import { EMITTER_TYPE, isMotionNode, PATH_TYPE } from '../motion/types'
import { badgeNode } from '../badge/node'
import { BADGE_CHANNELS } from '../badge/element'
import { plateNode } from '../plate'
import { animationPalette } from '../palanim/reaction'
import { readNameplate } from '../palette/state'
import { readEffect } from '../kinds/effect'
import { isEffectNode } from '../material/types'
import { effectReads, paramChannel, paramTrackChannel, readParamKeys } from '../material/params'
import { keyMolang } from '../molang/keys'
import { curvedKeys } from '../animate/curves'
import { allAnimations, findLoopAnimation } from '../util/animation'
import { wholeOr, wholeOrAtLeast } from '../util/num'

export const DEPTHS: Depth[] = ['behind', 'background', 'over_background', 'over_text']
export const ANCHORS: Anchor[] = [
    'top_left', 'top', 'top_right',
    'left', 'right',
    'bottom_left', 'bottom', 'bottom_right',
]

interface Scan {
    ids: Map<string, string>
    ordered: any[]
    layers: any[]
    groups: Array<{ node: any, parent: any | null }>
}

function scan(): Scan {
    const ordered: any[] = []
    const layers: any[] = []
    const groups: Array<{ node: any, parent: any | null }> = []
    walkNodes((node, parent) => {
        if (isGroupNode(node)) {
            groups.push({ node, parent })
            ordered.push(node)
        } else if (isLayerNode(node)) {
            layers.push(node)
            ordered.push(node)
        }
    })
    const ids = assignIds(ordered.map(node => ({ uuid: node.uuid, name: node.name })))
    return { ids, ordered, layers, groups }
}

function asDepth(value: unknown): Depth {
    return DEPTHS.includes(value as Depth) ? (value as Depth) : 'background'
}

export function readLayers(): LayerData[] {
    const state = scan()
    const result: LayerData[] = []
    for (const node of state.layers) {
        const id = state.ids.get(node.uuid)
        if (!id) continue
        const motion = readEffect(node, id, state.ids, state.layers) ?? (node.type === PATH_TYPE ? readPath(node, id, state.ids, state.layers) : node.type === EMITTER_TYPE ? readEmitter(node, id, state.ids, state.layers) : null)
        result.push(motion ?? (node.type === SPRITE_TYPE ? readSprite(node, { uuid: node.uuid, id, depth: asDepth(node.depth), step: wholeOrAtLeast(node.step, 1, 1) }, state) : readBody(node, { uuid: node.uuid, id, depth: asDepth(node.depth), step: wholeOrAtLeast(node.step, 1, 1) })))
    }
    return result.reverse()
}

export function readGroups(): GroupData[] {
    const state = scan()
    return state.groups.map(({ node, parent }) => {
        const layers: string[] = []
        for (const child of Array.isArray(node.children) ? node.children : []) {
            const id = isLayerNode(child) ? state.ids.get(child.uuid) : undefined
            if (id) layers.push(id)
        }
        return {
            uuid: node.uuid,
            id: state.ids.get(node.uuid) ?? '',
            parent: parent ? (state.ids.get(parent.uuid) ?? null) : null,
            layers: layers.reverse(),
        }
    })
}

function evaluate(keyframe: any, axis: 'x' | 'y'): number {
    try {
        const value = Number(keyframe.calc(axis))
        return isFinite(value) ? value : NaN
    } catch {
        return NaN
    }
}

function channelValue(channel: Channel, keyframe: any): number | [number, number] | boolean {
    const x = evaluate(keyframe, 'x')
    switch (channel) {
        case 'frame':
            return isNaN(x) ? 0 : Math.max(0, Math.round(x) + 0)
        case 'position': {
            const y = evaluate(keyframe, 'y')
            return [isNaN(x) ? 0 : Math.round(x) + 0, isNaN(y) ? 0 : Math.round(y) + 0]
        }
        case 'opacity':
            return isNaN(x) ? 1 : Math.min(1, Math.max(0, x))
        default:
            return !isNaN(x) && x >= 0.5
    }
}

function travel(channel: Channel, previous: any, current: any): Interpolation {
    if (channel === 'frame' || channel === 'visible') return 'step'
    return keyframeTravel(previous.interpolation, current.interpolation)
}

function trackKeys(channel: Channel, keyframes: any[], fps: number, loop: string, grain: number): KeyData[] {
    const sorted = keyframes
        .map((keyframe, index) => ({ keyframe, index }))
        .sort((a, b) => (a.keyframe.time - b.keyframe.time) || (a.index - b.index))
    const byStep = new Map<number, any>()
    for (const entry of sorted) byStep.set(wholeOr(entry.keyframe.time * fps, 0), entry.keyframe)
    const steps = Array.from(byStep.keys()).sort((a, b) => a - b)
    const keys: KeyData[] = []
    for (let i = 0; i < steps.length; i++) {
        const keyframe = byStep.get(steps[i])
        keys.push({
            step: steps[i],
            value: channelValue(channel, keyframe),
            ...keyMolang(channel, keyframe),
            interpolation: i === 0 ? 'step' : travel(channel, byStep.get(steps[i - 1]), keyframe),
        })
    }
    return curvedKeys(channel, keys, keyframes, fps, loop, grain)
}

function channelsOf(node: any): Channel[] {
    if (isGroupNode(node)) return GROUP_CHANNELS
    if (isMotionNode(node)) return motionTrackChannels(node)
    return node.type === SPRITE_TYPE ? SPRITE_CHANNELS : BODY_CHANNELS
}

function rateOf(fps: number): number {
    return isFinite(fps) && fps > 0 ? fps : 1
}

function paramTracks(node: any, animator: any, target: string, rate: number, wrap: number): TrackData[] {
    if (!isEffectNode(node)) return []
    const tracks: TrackData[] = []
    for (const name of effectReads(node)) {
        const keyframes = animator[paramChannel(name)]
        if (!Array.isArray(keyframes) || keyframes.length === 0) continue
        tracks.push({ target, channel: paramTrackChannel(name), keys: readParamKeys(keyframes, rate, wrap) })
    }
    return tracks
}

function readTracks(animation: any, state: Scan, rate: number, grain = 1, wrap = 0): TrackData[] {
    const animators = animation.animators ?? {}
    const tracks: TrackData[] = []
    for (const node of state.ordered) {
        const animator = animators[node.uuid]
        const target = state.ids.get(node.uuid)
        if (!animator || !target) continue
        for (const channel of channelsOf(node)) {
            const keyframes = animator[channel]
            if (!Array.isArray(keyframes) || keyframes.length === 0) continue
            tracks.push({ target, channel, keys: trackKeys(channel, keyframes, rate, animation.loop, grain) })
        }
        tracks.push(...paramTracks(node, animator, target, rate, wrap))
    }
    const pinned: Array<[any, string, Channel[]]> = [
        [badgeNode(), BADGE_TARGET, BADGE_CHANNELS],
        [plateNode(), PLATE_TARGET, ['position']],
    ]
    for (const [pinnedNode, pinnedTarget, channels] of pinned) {
        const animator = pinnedNode ? animators[pinnedNode.uuid] : null
        if (!animator) continue
        for (const channel of channels) {
            const keyframes = animator[channel]
            if (Array.isArray(keyframes) && keyframes.length > 0) tracks.push({ target: pinnedTarget, channel, keys: trackKeys(channel, keyframes, rate, animation.loop, grain) })
        }
    }
    return tracks
}

function readKeyed<Key>(type: string, readKeys: (uuid: string, animation: any, rate: number) => Key[], animation: any, state: Scan, rate: number): Array<{ target: string, keys: Key[] }> {
    const result: Array<{ target: string, keys: Key[] }> = []
    for (const node of state.ordered) {
        const target = state.ids.get(node.uuid)
        if (node.type !== type || !target) continue
        const keys = readKeys(node.uuid, animation, rate)
        if (keys.length > 0) result.push({ target, keys })
    }
    return result
}

export function readLoop(fps: number): LoopData | null {
    const animation = findLoopAnimation()
    if (!animation) return null
    const rate = rateOf(fps)
    const length = Math.max(1, wholeOr(animation.length * rate, 1))
    return { length, tracks: readTracks(animation, scan(), rate, 1, length) }
}

function hasKeys(animator: any, node: any): boolean {
    const all = animator?.keyframes
    if (Array.isArray(all)) return all.length > 0
    return channelsOf(node).some((channel) => Array.isArray(animator?.[channel]) && animator[channel].length > 0)
}

function keyedLayerStep(animation: any, state: Scan): number {
    const animators = animation?.animators ?? {}
    for (const node of state.ordered) {
        if (!state.layers.includes(node)) continue
        const animator = animators[node.uuid]
        if (animator && hasKeys(animator, node)) return wholeOrAtLeast(node.step, 1, 1)
    }
    return 0
}

function scheduleGrains(all: any[], loop: any, state: Scan): Map<string, number> {
    const grains = new Map<string, number>()
    for (const animation of all) {
        if (!animation || animation === loop) continue
        const schedule = scheduleOf(readSettings(animation))
        if (!schedule) continue
        const id = schedule.id ?? String(animation.name ?? '')
        if (!grains.get(id)) grains.set(id, keyedLayerStep(animation, state))
    }
    return grains
}

export function readAnimations(fps: number): AnimationData[] {
    const loop = findLoopAnimation()
    const all = allAnimations()
    const rate = rateOf(fps)
    const state = scan()
    const palette = readNameplate().palette
    const grains = scheduleGrains(all, loop, state)
    const loopLength = loop ? Math.max(1, wholeOr(Number(loop.length) * rate, 1)) : 0
    const result: AnimationData[] = []
    for (const animation of all) {
        if (!animation || animation === loop) continue
        const settings = readSettings(animation)
        const trigger = triggerOf(settings)
        const schedule = scheduleOf(settings)
        const triggered = !!trigger && !schedule
        result.push({
            uuid: String(animation.uuid ?? ''),
            name: String(animation.name ?? ''),
            trigger,
            schedule,
            length: Math.max(0, wholeOr(Number(animation.length) * rate, 0)),
            restart: settings.restart,
            tracks: readTracks(animation, state, rate, schedule ? grains.get(schedule.id ?? String(animation.name ?? '')) || 1 : 1, triggered && isWhile(trigger) ? loopLength : 0),
            bursts: readKeyed(EMITTER_TYPE, readBurstKeys, animation, state, rate),
            speeds: readKeyed(PATH_TYPE, readTriggeredSpeedKeys, animation, state, rate),
            palette: triggered ? animationPalette(animation, palette) : [],
            reduced: reducedOf(settings),
        })
    }
    return result
}

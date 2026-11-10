import { syncScheduleMarkers } from '../animate/markers'
import { AnimationSettings, readSettings, suggestedId, writeSettings } from '../animate/props'
import { isGroupNode, isLayerNode, walkNodes } from '../elements/nodes'
import { createNameplateAnimation, currentFps } from '../format'
import { BODY_TYPE, LOOP_ANIMATION, SPRITE_TYPE } from '../model'
import { BURST_CHANNEL, EMITTER_TYPE, PATH_TYPE, SPEED_CHANNEL } from '../motion/types'
import { readLetterTrack, writeLetterTrack } from '../text/reaction'
import { AnimationItem, newItemId, PresetKey } from './store'
import { allAnimations, animationFrames } from '../util/animation'
import { round3 } from '../util/num'
import { hasProject } from '../util/project'
import { undoEdit } from '../util/undo'

export const PRESET_CHANNELS = ['frame', 'position', 'opacity', 'visible', SPEED_CHANNEL, BURST_CHANNEL]
export const NEW_ANIMATION = '__new__'

const BEZIER_FIELDS = ['bezier_left_time', 'bezier_left_value', 'bezier_right_time', 'bezier_right_value']

const CHANNEL_LABELS: Record<string, string> = {
    frame: 'Frame',
    position: 'Position',
    opacity: 'Opacity',
    visible: 'Visible',
    [SPEED_CHANNEL]: 'Speed',
    [BURST_CHANNEL]: 'Burst',
}

const KIND_LABELS: Record<string, string> = {
    group: 'Group',
    body: 'Body',
    sprite: 'Sprite',
    path: 'Path',
    emitter: 'Particles',
}

export interface KeyedNode {
    node: any
    channels: string[]
}

export interface PresetOptions {
    into: string
    replace: boolean
    stretch: boolean
}

export interface PresetInsert {
    animation: any
    skipped: string[]
    dropped: number
}

export function channelLabel(channel: string): string {
    return CHANNEL_LABELS[channel] ?? channel
}

export function nodeKind(node: any): string {
    if (isGroupNode(node)) return 'group'
    if (node?.type === BODY_TYPE) return 'body'
    if (node?.type === SPRITE_TYPE) return 'sprite'
    if (node?.type === PATH_TYPE) return 'path'
    if (node?.type === EMITTER_TYPE) return 'emitter'
    return ''
}

export function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind
}

export function kindNoun(kind: string): string {
    const label = kindLabel(kind).toLowerCase()
    return kind === 'emitter' ? label : `a ${label}`
}

export function nodeLabel(node: any): string {
    return `${kindLabel(nodeKind(node))}: ${String(node?.name ?? '')}`
}

function animatedNodes(): any[] {
    const nodes: any[] = []
    walkNodes((node) => {
        if (isGroupNode(node) || isLayerNode(node)) nodes.push(node)
    })
    return nodes
}

export function supportsChannel(node: any, channel: string): boolean {
    if (!PRESET_CHANNELS.includes(channel)) return false
    const channels = node?.constructor?.animator?.prototype?.channels
    return !!channels && !!channels[channel]
}

export function keyedNodes(animation: any): KeyedNode[] {
    const result: KeyedNode[] = []
    const animators = animation?.animators ?? {}
    for (const node of animatedNodes()) {
        const animator = animators[node.uuid]
        if (!animator) continue
        const channels = PRESET_CHANNELS.filter((channel) => Array.isArray(animator[channel]) && animator[channel].length > 0)
        if (channels.length > 0) result.push({ node, channels })
    }
    return result
}

function keyOf(keyframe: any, fps: number, channel: string): PresetKey {
    const point = keyframe.data_points?.[0] ?? {}
    const key: PresetKey = {
        frame: round3(Number(keyframe.time) * fps),
        interpolation: String(keyframe.interpolation ?? 'linear'),
        x: String(point.x ?? '0').trim() || '0',
    }
    if (channel === 'position') key.y = String(point.y ?? '0').trim() || '0'
    if (key.interpolation === 'bezier') {
        const bezier: Record<string, number[]> = {}
        for (const field of BEZIER_FIELDS) {
            const value = keyframe[field]
            if (Array.isArray(value)) bezier[field] = value.map((entry: unknown) => Number(entry) || 0)
        }
        if (Object.keys(bezier).length > 0) key.bezier = bezier
    }
    return key
}

export function capturePreset(animation: any, node: any, name: string): AnimationItem | null {
    const animator = animation?.animators?.[node?.uuid]
    if (!animator) return null
    const fps = currentFps()
    const channels: Record<string, PresetKey[]> = {}
    for (const channel of PRESET_CHANNELS) {
        const keyframes = animator[channel]
        if (!Array.isArray(keyframes) || keyframes.length === 0) continue
        channels[channel] = keyframes.map((keyframe: any) => keyOf(keyframe, fps, channel)).sort((a, b) => a.frame - b.frame)
    }
    if (Object.keys(channels).length === 0) return null
    const loop = animation.name === LOOP_ANIMATION
    const settings = loop ? null : { ...readSettings(animation), schedule: '' }
    const letters = readLetterTrack(animation)
    return {
        id: newItemId(),
        kind: 'animation',
        name,
        saved: Date.now(),
        loop,
        length: animationFrames(animation, fps),
        fps,
        target: nodeKind(node),
        settings,
        channels,
        ...(letters?.motion ? { letters } : {}),
    }
}

export function presetSummary(item: AnimationItem): string {
    const plays = item.loop ? 'Loop' : playsLabel(item.settings)
    const channels = [...Object.keys(item.channels).map(channelLabel), ...(item.letters?.motion ? ['Letters'] : [])].join(', ')
    return `${plays}, ${item.length} frames. ${kindLabel(item.target)}: ${channels}`
}

export function playsLabel(settings: AnimationSettings | null): string {
    switch (settings?.plays) {
        case 'reaction':
            return settings.on === 'while' ? 'While reacting' : 'Reaction'
        case 'appear':
            return 'On appear'
        case 'equip':
            return 'On equip'
        case 'schedule':
            return 'Random'
        default:
            return 'Animation'
    }
}

export function presetTargets(item: AnimationItem): any[] {
    const channels = Object.keys(item.channels)
    return animatedNodes().filter((node) => channels.some((channel) => supportsChannel(node, channel)))
}

export function canMakeAnimation(item: AnimationItem): boolean {
    return !item.loop && !!item.settings?.plays
}

function uniqueAnimationName(base: string): string {
    const taken = new Set(allAnimations().map((animation) => String(animation.name)))
    const root = suggestedId(base)
    if (!taken.has(root)) return root
    for (let index = 2; ; index++) {
        const candidate = `${root.slice(0, 60)}_${index}`
        if (!taken.has(candidate)) return candidate
    }
}

function createAnimation(item: AnimationItem, fps: number): any {
    const settings = item.settings!
    const whileReaction = settings.plays === 'reaction' && settings.on === 'while'
    const animation = createNameplateAnimation({ name: uniqueAnimationName(item.name), frames: item.length, fps, loop: whileReaction ? 'loop' : 'once' })
    writeSettings(animation, { ...settings, schedule: '' })
    animation.add(false)
    syncScheduleMarkers(animation, fps)
    return animation
}

function removeKeys(animator: any, channel: string) {
    const keyframes: any[] = Array.isArray(animator[channel]) ? animator[channel].slice() : []
    for (const keyframe of keyframes) {
        if (typeof keyframe.remove === 'function') keyframe.remove()
        else {
            const at = animator[channel].indexOf(keyframe)
            if (at >= 0) animator[channel].splice(at, 1)
        }
    }
}

function keyData(channel: string, key: PresetKey): Record<string, unknown> {
    const point = { x: key.x, y: channel === 'position' ? (key.y ?? '0') : '0', z: '0' }
    const data: Record<string, unknown> = {
        channel,
        interpolation: key.interpolation,
        data_points: [point],
    }
    if (key.bezier) Object.assign(data, key.bezier)
    return data
}

export function insertPreset(item: AnimationItem, node: any, options: PresetOptions): PresetInsert | null {
    if (!hasProject() || !node) return null
    const fps = currentFps()
    const creating = options.into === NEW_ANIMATION
    const existing = creating ? null : allAnimations().find((animation) => animation.uuid === options.into)
    if (!creating && !existing) return null
    if (creating && !canMakeAnimation(item)) return null
    const animations: any[] = existing ? [existing] : []
    const { animation, animator, skipped, dropped } = undoEdit({ animations }, 'Insert animation from library', () => {
        const animation = existing ?? createAnimation(item, fps)
        if (!existing) animations.push(animation)
        const length = animationFrames(animation, fps)
        const loops = animation.name === LOOP_ANIMATION
        const scale = options.stretch && length !== item.length ? length / item.length : 1
        const animator = animation.getBoneAnimator(node)
        const skipped: string[] = []
        let dropped = 0
        for (const [channel, keys] of Object.entries(item.channels)) {
            if (!animator || !supportsChannel(node, channel) || !animator.channels?.[channel]) {
                skipped.push(channelLabel(channel))
                continue
            }
            if (options.replace) removeKeys(animator, channel)
            for (const key of keys) {
                const frame = scale === 1 ? key.frame : Math.round(key.frame * scale)
                if (frame > length || (frame === length && !loops)) {
                    dropped++
                    continue
                }
                animator.addKeyframe({ ...keyData(channel, key), time: frame / fps })
            }
        }
        if (item.letters?.motion && (creating || options.replace || !readLetterTrack(animation)?.motion)) writeLetterTrack(animation, item.letters)
        return { animation, animator, skipped, dropped }
    })
    try {
        animation.select()
        animator?.addToTimeline?.()
        ;(Animator as any).preview?.()
    } catch (error) {
        console.error('[polyplus_nameplate] could not show the inserted keys', error)
    }
    return { animation, skipped, dropped }
}

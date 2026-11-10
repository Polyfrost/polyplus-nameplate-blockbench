import { BURST_CHANNEL, EMITTER_TYPE, PATH_TYPE, SPEED_CHANNEL } from './types'
import type { MotionLayerPlan } from './import'

interface PlanLike {
    kind: string
    sprite?: string | null
    pool?: string[]
    breakpointSprites?: Array<string | null>
    speedKeys?: MotionLayerPlan['speedKeys']
    bursts?: MotionLayerPlan['bursts']
    props?: Record<string, unknown>
}

export function motionTypeFor(kind: string): any | null {
    const types = OutlinerElement.types as any
    if (kind === 'path') return types[PATH_TYPE] ?? null
    if (kind === 'emitter') return types[EMITTER_TYPE] ?? null
    return null
}

export function linkMotionTextures(node: any, plan: PlanLike, textures: Map<string, Texture>) {
    const uuidOf = (id: string | null | undefined) => (id ? (textures.get(id)?.uuid ?? '') : '')
    if (plan.kind === 'path') node.texture = uuidOf(plan.sprite)
    if (plan.kind === 'emitter') node.sprites = (plan.pool ?? []).map(uuidOf).filter((uuid) => !!uuid)
    const sprites = plan.breakpointSprites ?? []
    if (Array.isArray(node.breakpoints) && sprites.length > 0) {
        node.breakpoints = node.breakpoints.map((breakpoint: any, index: number) => ({ ...breakpoint, texture: uuidOf(sprites[index]) }))
    }
}

export function addMotionKeyframes(animation: any, node: any, plan: PlanLike, fps: number) {
    const animator = animation?.getBoneAnimator?.(node)
    if (!animator) return
    const rate = Math.max(1, fps)
    const step = Math.max(1, Number(plan.props?.step) || 1)
    if (plan.kind === 'path' && animator.channels?.[SPEED_CHANNEL]) {
        for (const key of plan.speedKeys ?? []) {
            animator.addKeyframe({
                channel: SPEED_CHANNEL,
                time: (key.step * step) / rate,
                interpolation: key.interpolation,
                data_points: [{ x: String(key.value), y: '0', z: '0' }],
            })
        }
    }
    if (plan.kind === 'emitter' && animator.channels?.[BURST_CHANNEL]) {
        for (const key of plan.bursts ?? []) {
            animator.addKeyframe({
                channel: BURST_CHANNEL,
                time: key.step / rate,
                interpolation: 'step',
                data_points: [{ x: String(key.count), y: '0', z: '0' }],
            })
        }
    }
}

export function addPlanMotionKeyframes(animation: any, nodes: Map<string, any>, root: any[], fps: number) {
    const walk = (list: any[]) => {
        for (const entry of list) {
            if (entry?.kind === 'group') {
                walk(entry.children ?? [])
                continue
            }
            if (entry?.kind !== 'path' && entry?.kind !== 'emitter') continue
            const node = nodes.get(entry.id)
            if (node) addMotionKeyframes(animation, node, entry, fps)
        }
    }
    walk(root)
}

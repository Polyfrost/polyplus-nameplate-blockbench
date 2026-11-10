import { BlockbenchInterpolation } from '../animate/interpolation'
import { BURST_CHANNEL, BurstKey } from './types'
import { asEdge } from './read'
import { isRecord } from '../util/json'
import { wholeOr } from '../util/num'

type Json = any
type Steps = Array<string | { id: string }>

export interface MotionImportContext {
    keep(steps: Steps, value: unknown, label: string): void
    change(note: string): void
}

export interface MotionSpeedPlan {
    step: number
    value: number
    interpolation: BlockbenchInterpolation
}

export interface MotionLayerPlan {
    kind: 'path' | 'emitter'
    id: string
    props: Record<string, unknown>
    of: string | null
    sprite: string | null
    pool: string[]
    breakpointSprites: Array<string | null>
    speedKeys: MotionSpeedPlan[]
    bursts: BurstKey[]
}

export interface SpriteAdaptivePlan {
    props: Record<string, unknown>
    breakpointSprites: Array<string | null>
}


function breakpointsPlan(raw: unknown, mainSprite: string | null): { list: Array<{ min: number, max: number | null, texture: string }>, sprites: Array<string | null> } {
    const list: Array<{ min: number, max: number | null, texture: string }> = []
    const sprites: Array<string | null> = []
    for (const entry of Array.isArray(raw) ? raw : []) {
        if (!isRecord(entry)) continue
        list.push({
            min: Math.max(0, wholeOr(entry.min, 0)),
            max: entry.max === null || entry.max === undefined ? null : Math.max(0, wholeOr(entry.max, 0)),
            texture: '',
        })
        sprites.push(typeof entry.sprite === 'string' && entry.sprite !== mainSprite ? entry.sprite : null)
    }
    return { list, sprites }
}

export function spriteAdaptivePlan(file: Json): SpriteAdaptivePlan {
    const repeat = isRecord(file?.repeat) ? file.repeat : null
    const breakpoints = breakpointsPlan(file?.breakpoints, typeof file?.sprite === 'string' ? file.sprite : null)
    return {
        props: {
            repeatOn: !!repeat,
            repeatEdge: asEdge(repeat?.edge, 'top'),
            repeatSpacing: repeat ? Math.max(1, wholeOr(repeat.spacing, 1)) : 12,
            repeatMin: repeat ? Math.max(1, wholeOr(repeat.min, 1)) : 1,
            repeatMax: repeat ? Math.max(1, wholeOr(repeat.max, 1)) : 8,
            breakpoints: breakpoints.list,
        },
        breakpointSprites: breakpoints.sprites,
    }
}

export const SPRITE_ADAPTIVE_KEYS = ['repeat', 'breakpoints']

function uniqueIds(ids: unknown[]): string[] {
    const result: string[] = []
    for (const id of ids) {
        if (typeof id === 'string' && id && !result.includes(id)) result.push(id)
    }
    return result
}

export function planSpriteIds(plan: { sprite?: string | null, pool?: string[], breakpointSprites?: Array<string | null> }): string[] {
    return uniqueIds([plan.sprite, ...(plan.pool ?? []), ...(plan.breakpointSprites ?? [])])
}

export function fileSpriteIds(file: Json): string[] {
    if (!isRecord(file)) return []
    if (file.kind === 'emitter') return uniqueIds(Array.isArray(file.sprites) ? file.sprites : [])
    if (file.kind !== 'sprite') return []
    return uniqueIds([file.sprite, ...(Array.isArray(file.breakpoints) ? file.breakpoints : []).map((entry: any) => entry?.sprite)])
}

export function takeBurstTracks(manifest: Json, plans: Iterable<{ kind: string, id: string }>): Set<string> {
    const taken = new Set<string>()
    const tracks = manifest?.animations?.loop?.tracks
    if (!isRecord(tracks)) return taken
    for (const plan of plans) {
        if (plan.kind !== 'emitter') continue
        const keys = tracks[plan.id]?.[BURST_CHANNEL]
        if (!Array.isArray(keys)) continue
        ;(plan as MotionLayerPlan).bursts = keys
            .filter((key) => Array.isArray(key) && key.length >= 2)
            .map((key: any[]) => ({ step: Math.max(0, wholeOr(key[0], 0)), count: Math.max(1, wholeOr(key[1], 1)) }))
        taken.add(plan.id)
    }
    return taken
}

export function isBurstTrack(kind: string | undefined, channel: string): boolean {
    return kind === 'emitter' && channel === BURST_CHANNEL
}

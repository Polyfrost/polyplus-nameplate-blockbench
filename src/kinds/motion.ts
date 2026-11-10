import { BundleIssue, Depth } from '../model'
import { MOTION_DEPTHS } from '../motion/types'
import { isRecord, sameSerialized } from '../util/json'
import { wholeOr } from '../util/num'
import type { WidthBreakpoint } from '../motion/types'

export type Json = Record<string, unknown>

export type SpriteIds = Map<string, string>

export interface MotionPlanContext {
    keep(steps: Array<string | { id: string }>, value: unknown, label: string): void
    change(note: string): void
}

export function asDepth(value: unknown): Depth {
    return MOTION_DEPTHS.includes(value as Depth) ? (value as Depth) : 'over_background'
}

export function targetIdOf(uuid: unknown, ids: Map<string, string>, layers: any[], types: string[]): string | null {
    if (typeof uuid !== 'string' || !uuid) return null
    const target = layers.find((layer) => layer.uuid === uuid)
    return target && types.includes(target.type) ? (ids.get(target.uuid) ?? null) : null
}

export function layerPath(id: string, field: string): string {
    return `layers/${id}.json#${field}`
}

export function spriteRef(texture: string, spriteIds: SpriteIds, path: string, what: string, issues: BundleIssue[]): string | null {
    if (!texture) {
        issues.push({ path, message: `${what} has no texture` })
        return null
    }
    const id = spriteIds.get(texture)
    if (!id) {
        issues.push({ path, message: `texture '${texture}' has no sprite data` })
        return null
    }
    return id
}

export function breakpointsJson(breakpoints: WidthBreakpoint[], mainTexture: string | null, spriteIds: SpriteIds, id: string, issues: BundleIssue[], allowSprites: boolean): Json[] {
    return breakpoints.map((breakpoint, index) => {
        const entry: Json = { min: breakpoint.min }
        if (breakpoint.max !== null) entry.max = breakpoint.max
        if (allowSprites && breakpoint.texture && breakpoint.texture !== mainTexture) {
            const sprite = spriteRef(breakpoint.texture, spriteIds, layerPath(id, `breakpoints[${index}].sprite`), 'breakpoint', issues)
            if (sprite) entry.sprite = sprite
        }
        return entry
    })
}

export function breakpointsPlan(raw: unknown, mainSprite: string | null): { list: Array<{ min: number, max: number | null, texture: string }>, sprites: Array<string | null> } {
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

export function keepUnknown(file: any, known: Set<string>, defaults: Record<string, unknown>, id: string, context: MotionPlanContext) {
    for (const key of Object.keys(file)) {
        if (known.has(key)) continue
        if (key in defaults && sameSerialized(file[key], defaults[key])) continue
        context.keep([key], file[key], `layers/${id}.json: ${key}`)
    }
}

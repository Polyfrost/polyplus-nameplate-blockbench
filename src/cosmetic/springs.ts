import { isRecord } from '../util/json'

export const SPRING_KEY = 'polyplus:spring'

export interface SpringParams {
    stiffness: number
    damping: number
    gravity: number
    drag: number
    limit: number
    collide: boolean
}

export const SPRING_FIELDS: Array<{ key: Exclude<keyof SpringParams, 'collide'>, label: string, min: number, max: number, step: number }> = [
    { key: 'stiffness', label: 'Stiffness', min: 0, max: 1, step: 0.05 },
    { key: 'damping', label: 'Damping', min: 0, max: 1, step: 0.05 },
    { key: 'gravity', label: 'Gravity', min: -1, max: 1, step: 0.05 },
    { key: 'drag', label: 'Drag', min: 0, max: 1, step: 0.05 },
    { key: 'limit', label: 'Swing limit (degrees)', min: 0, max: 180, step: 5 },
]

export const SPRING_PRESETS: Record<string, SpringParams> = {
    tail: { stiffness: 0.35, damping: 0.25, gravity: 0.5, drag: 0.3, limit: 60, collide: true },
    ear: { stiffness: 0.7, damping: 0.4, gravity: 0.2, drag: 0.1, limit: 25, collide: false },
    ribbon: { stiffness: 0.15, damping: 0.15, gravity: 0.7, drag: 0.5, limit: 90, collide: true },
    antenna: { stiffness: 0.8, damping: 0.1, gravity: 0.05, drag: 0.05, limit: 30, collide: false },
    heavy: { stiffness: 0.25, damping: 0.5, gravity: 1, drag: 0.1, limit: 45, collide: true },
    light: { stiffness: 0.2, damping: 0.1, gravity: 0.1, drag: 0.8, limit: 120, collide: false },
}

export const PRESET_NAMES: Record<string, string> = {
    tail: 'Tail',
    ear: 'Ear',
    ribbon: 'Ribbon',
    antenna: 'Antenna',
    heavy: 'Heavy',
    light: 'Light',
}

export const DEFAULT_SPRING = SPRING_PRESETS.tail

export const ENGINE_SPRING: SpringParams = { stiffness: 0.4, damping: 0.2, gravity: 0.6, drag: 0.1, limit: 50, collide: true }

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'string' ? Number(value) : value
    return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function normalizeSpring(raw: unknown, defaults: SpringParams = DEFAULT_SPRING): SpringParams | null {
    if (!isRecord(raw)) return null
    const out = { ...defaults }
    for (const field of SPRING_FIELDS) out[field.key] = clamp(raw[field.key], field.min, field.max, defaults[field.key])
    out.collide = typeof raw.collide === 'boolean' ? raw.collide : defaults.collide
    return out
}

export function groupSpring(raw: unknown): SpringParams | null {
    if (!isRecord(raw) || raw.enabled === false) return null
    if (raw.enabled !== true && !SPRING_FIELDS.some((field) => field.key in raw) && !('collide' in raw)) return null
    return normalizeSpring(raw)
}

export function storedSpring(spring: SpringParams | null): Record<string, unknown> {
    return spring ? { enabled: true, ...spring } : { enabled: false }
}

export function presetOf(spring: SpringParams): string | null {
    for (const [name, preset] of Object.entries(SPRING_PRESETS)) {
        if (SPRING_FIELDS.every((field) => preset[field.key] === spring[field.key]) && preset.collide === spring.collide) return name
    }
    return null
}

function bonesOf(geometry: unknown): Array<Record<string, any>> {
    if (!isRecord(geometry)) return []
    const models = geometry['minecraft:geometry']
    if (!Array.isArray(models)) return []
    return models.flatMap((model) => (isRecord(model) && Array.isArray(model.bones) ? model.bones.filter(isRecord) : []))
}

export function applySprings(geometry: Record<string, unknown>, springs: Record<string, SpringParams>): Record<string, unknown> {
    for (const bone of bonesOf(geometry)) {
        const spring = springs[bone.name]
        if (spring) bone[SPRING_KEY] = { ...spring }
        else delete bone[SPRING_KEY]
    }
    return geometry
}

export function readSprings(geometry: unknown): Record<string, SpringParams> {
    const out: Record<string, SpringParams> = {}
    for (const bone of bonesOf(geometry)) {
        const spring = normalizeSpring(bone[SPRING_KEY], ENGINE_SPRING)
        if (spring && typeof bone.name === 'string') out[bone.name] = spring
    }
    return out
}

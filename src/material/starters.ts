import type { Depth, Slot } from '../model'
import bodyGlow from './starters/body_glow.json'
import noiseSparkle from './starters/noise_sparkle.json'
import shimmerBands from './starters/shimmer_bands.json'
import softGlow from './starters/soft_glow.json'
import { cloneJson } from '../util/json'
import { MaterialGraph, ParamRange } from './types'

export interface StarterParam extends ParamRange {
    default: number
}

export interface Starter {
    key: string
    name: string
    description: string
    id: string
    depth: Depth
    color?: 'light' | 'dark'
    ramp?: boolean
    wantsBody?: boolean
    params: Record<string, StarterParam>
    material: MaterialGraph
}

export interface StarterResult {
    graph: MaterialGraph
    params: Record<string, number>
    ranges: Record<string, ParamRange>
}

const PARAM = '$param:'
const COLOR = '$color'
const RAMP = '$ramp'

export const STARTERS: Starter[] = [
    { key: 'soft_glow', ...(softGlow as unknown as Omit<Starter, 'key'>) },
    { key: 'body_glow', ...(bodyGlow as unknown as Omit<Starter, 'key'>) },
    { key: 'shimmer_bands', ...(shimmerBands as unknown as Omit<Starter, 'key'>) },
    { key: 'noise_sparkle', ...(noiseSparkle as unknown as Omit<Starter, 'key'>) },
]

export function starterByKey(key: string): Starter | null {
    return STARTERS.find((starter) => starter.key === key) ?? null
}

function brightness(hex: string): number {
    const value = parseInt(hex.replace('#', '').slice(-6), 16)
    if (!isFinite(value)) return 0
    return 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)
}

export function defaultTone(slots: Slot[], want: 'light' | 'dark' = 'light'): string {
    let best = ''
    let score = -Infinity
    for (const slot of slots) {
        slot.ramp.forEach((tone, index) => {
            const value = want === 'light' ? brightness(tone) : -brightness(tone)
            if (value > score) {
                score = value
                best = index === 0 ? slot.id : `${slot.id}[${index}]`
            }
        })
    }
    return best
}

export function defaultRamp(slots: Slot[]): string {
    let best = slots[0]
    for (const slot of slots) if (slot.ramp.length > (best?.ramp.length ?? 0)) best = slot
    return best?.id ?? ''
}

function substitute(value: unknown, replace: (text: string) => string): unknown {
    if (typeof value === 'string') return replace(value)
    if (Array.isArray(value)) return value.map((item) => substitute(item, replace))
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value)) result[key] = substitute(item, replace)
        return result
    }
    return value
}

export function instantiate(starter: Starter, materialId: string, slots: Slot[]): StarterResult {
    const color = defaultTone(slots, starter.color ?? 'light')
    const ramp = defaultRamp(slots)
    const names: Record<string, string> = {}
    for (const key of Object.keys(starter.params)) names[key] = `${materialId}_${key}`
    const graph = substitute(cloneJson(starter.material), (text) => {
        if (text.startsWith(PARAM)) return names[text.slice(PARAM.length)] ?? text
        if (text === COLOR) return color
        if (text === RAMP) return ramp
        return text
    }) as MaterialGraph
    const params: Record<string, number> = {}
    const ranges: Record<string, ParamRange> = {}
    for (const [key, param] of Object.entries(starter.params)) {
        params[names[key]] = param.default
        ranges[names[key]] = { label: param.label, min: param.min, max: param.max, step: param.step }
    }
    return { graph, params, ranges }
}

import { BlockbenchInterpolation, blockbenchInterpolations, keyframeTravel, readBack } from '../animate/interpolation'
import type { Channel, Interpolation, KeyData } from '../model'
import { point } from '../molang/keys'
import { MATERIALS_PROPERTY, paramNamesOf } from './types'

export const PARAM_PREFIX = 'param.'
export const PARAM_BASE = 'base'

export type ParamKeyValue = number | typeof PARAM_BASE

export interface ParamKeyPlan {
    step: number
    value: number
    molang?: string
    interpolation: BlockbenchInterpolation
}

export interface ParamImport {
    keys: ParamKeyPlan[]
    changes: string[]
}

export function isParamChannel(channel: unknown): channel is string {
    return typeof channel === 'string' && channel.startsWith(PARAM_PREFIX) && channel.length > PARAM_PREFIX.length
}

export function paramChannel(name: string): string {
    return `${PARAM_PREFIX}${name}`
}

export function paramOfChannel(channel: string): string | null {
    return isParamChannel(channel) ? channel.slice(PARAM_PREFIX.length) : null
}

export function isBaseText(value: unknown): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === PARAM_BASE
}

function rawMaterials(): any {
    return typeof Project !== 'undefined' && Project ? (Project as any)[MATERIALS_PROPERTY] : null
}

const readsCache: { raw: any, byMaterial: Map<string, string[]> } = { raw: null, byMaterial: new Map() }

export function effectReads(node: any): string[] {
    const material = typeof node?.material === 'string' ? node.material : ''
    if (!material) return []
    const raw = rawMaterials()
    if (readsCache.raw !== raw) {
        readsCache.raw = raw
        readsCache.byMaterial.clear()
    }
    let reads = readsCache.byMaterial.get(material)
    if (!reads) {
        reads = paramNamesOf(raw?.graphs?.[material])
        readsCache.byMaterial.set(material, reads)
    }
    return reads
}

export function allParamNames(): string[] {
    const raw = rawMaterials()
    const names = new Set<string>()
    for (const graph of Object.values<any>(raw?.graphs ?? {})) for (const name of paramNamesOf(graph)) names.add(name)
    return Array.from(names)
}

export function paramLabel(name: string): string {
    const label = rawMaterials()?.ranges?.[name]?.label
    return typeof label === 'string' && label ? label : name
}

export function keyframeIsBase(keyframe: any): boolean {
    const data = point(keyframe)
    return isBaseText(data?.x_string ?? data?.x)
}

function numberOf(keyframe: any): number {
    const data = point(keyframe)
    const raw = data?.x_string ?? data?.x
    const plain = Number(typeof raw === 'string' ? raw.trim() : raw)
    if (raw !== '' && raw !== undefined && raw !== null && isFinite(plain)) return plain + 0
    try {
        const value = Number(keyframe.calc('x'))
        return isFinite(value) ? value + 0 : 0
    } catch {
        return 0
    }
}

export function paramKeyValue(keyframe: any): ParamKeyValue {
    return keyframeIsBase(keyframe) ? PARAM_BASE : numberOf(keyframe)
}

function eased(mode: Interpolation, t: number): number {
    if (mode === 'linear') return t
    if (mode === 'ease') return t * t * (3 - 2 * t)
    return 0
}

function closing(keys: KeyData[], length: number): KeyData[] {
    if (length < 2 || keys.length < 2) return keys
    const wrap = keys.findIndex((key) => key.step === length)
    if (wrap < 0) return keys
    const first = keys[0]
    const last = keys[wrap]
    if (first.step !== 0 || first.value !== last.value) return keys
    const rest = keys.filter((_, index) => index !== wrap)
    const previous = rest.filter((key) => key.step < length).pop()
    if (!previous || last.interpolation === 'step' || typeof previous.value !== 'number' || typeof last.value !== 'number') return rest
    if (previous.step >= length - 1 || previous.value === last.value) return rest
    const t = (length - 1 - previous.step) / (length - previous.step)
    const value = Math.round((previous.value + (last.value - previous.value) * eased(last.interpolation, t)) * 10000) / 10000
    return [...rest, { step: length - 1, value, interpolation: last.interpolation }]
}

export function readParamKeys(keyframes: any[], fps: number, wrapLength = 0): KeyData[] {
    const byStep = new Map<number, any>()
    keyframes
        .filter((keyframe) => keyframe && isFinite(Number(keyframe.time)))
        .map((keyframe, index) => ({ keyframe, index }))
        .sort((a, b) => a.keyframe.time - b.keyframe.time || a.index - b.index)
        .forEach((entry) => byStep.set(Math.max(0, Math.round(entry.keyframe.time * fps)) + 0, entry.keyframe))
    const steps = Array.from(byStep.keys()).sort((a, b) => a - b)
    const keys: KeyData[] = steps.map((step, i) => ({
        step,
        value: paramKeyValue(byStep.get(step)) as unknown as KeyData['value'],
        interpolation: i === 0 ? 'step' : keyframeTravel(byStep.get(steps[i - 1]).interpolation, byStep.get(step).interpolation),
    }))
    return closing(keys, wrapLength)
}

export function paramTrackChannel(name: string): Channel {
    return paramChannel(name) as unknown as Channel
}

export function importParamKeys(raw: unknown, label: string): ParamImport | null {
    if (!Array.isArray(raw) || raw.length === 0) return null
    for (const key of raw) {
        if (!Array.isArray(key) || key.length < 2 || key.length > 3) return null
        if (!Number.isInteger(key[0]) || key[0] < 0) return null
        if (!(typeof key[1] === 'number' && isFinite(key[1])) && key[1] !== PARAM_BASE) return null
        if (key.length === 3 && !['step', 'linear', 'ease'].includes(key[2])) return null
    }
    const modes = raw.map((key: any[], index) => (index === 0 || key.length < 3 ? 'step' : String(key[2])))
    const chosen = blockbenchInterpolations(modes)
    const changes: string[] = []
    for (let i = 1; i < raw.length; i++) {
        const read = readBack(chosen[i - 1], chosen[i])
        if (read !== modes[i]) changes.push(`${label}: steps ${raw[i - 1][0]} to ${raw[i][0]} were ${modes[i]} and read back as ${read}; Blockbench curves a segment when either keyframe is bezier`)
    }
    const keys = raw.map((key: any[], index): ParamKeyPlan => (key[1] === PARAM_BASE
        ? { step: key[0], value: 0, molang: PARAM_BASE, interpolation: chosen[index] }
        : { step: key[0], value: key[1], interpolation: chosen[index] }))
    return { keys, changes }
}

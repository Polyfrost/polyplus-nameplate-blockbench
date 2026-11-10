import { addToMenu } from '../util/actions'
import { sameSerialized } from '../util/json'
import { undoEdit } from '../util/undo'
import { molangSource } from './expression'

export type KeyMolang = string | [string | null, string | null]

interface MolangKey {
    value: unknown
    molang?: KeyMolang
}

export function point(keyframe: any): any {
    return Array.isArray(keyframe?.data_points) ? keyframe.data_points[0] : undefined
}

export function selectedKeyframes(accepts: (channel: string) => boolean): any[] {
    const selected: any[] = Array.isArray((globalThis as any).Timeline?.selected) ? (globalThis as any).Timeline.selected : []
    return selected.filter((keyframe) => keyframe && accepts(String(keyframe.channel)))
}

export function refreshKeyframes() {
    const animator = (globalThis as any).Animator
    if (typeof animator?.preview === 'function') animator.preview()
    const update = (globalThis as any).updateKeyframeSelection
    if (typeof update === 'function') update()
}

export function editKeyframes(keyframes: any[], label: string, apply: (keyframe: any) => void) {
    undoEdit({ keyframes }, label, () => {
        for (const keyframe of keyframes) apply(keyframe)
    })
    refreshKeyframes()
}

export function addKeyframeMenuItem(item: object): () => void {
    return addToMenu((globalThis as any).Keyframe?.prototype?.menu, item, '#actions', 'keyframe menu')
}

export function keyMolang(channel: string, keyframe: any): { molang?: KeyMolang } {
    const data = point(keyframe)
    if (!data) return {}
    if (channel === 'position') {
        const x = molangSource(data.x)
        const y = molangSource(data.y)
        return x === null && y === null ? {} : { molang: [x, y] }
    }
    const x = molangSource(data.x)
    return x === null ? {} : { molang: x }
}

export function keyValueJson(key: MolangKey): unknown {
    const molang = key.molang
    if (molang === undefined || molang === null) return key.value
    if (Array.isArray(molang)) {
        const value = Array.isArray(key.value) ? key.value : [0, 0]
        return [molang[0] ?? value[0], molang[1] ?? value[1]]
    }
    return molang
}

export function sameMolang(a: MolangKey, b: MolangKey): boolean {
    return sameSerialized(a.molang ?? null, b.molang ?? null)
}

function plainNumber(value: unknown): boolean {
    return typeof value === 'number' && isFinite(value)
}

function text(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

export function editableKeyValue(channel: string, value: unknown): boolean {
    if (channel === 'position') {
        return Array.isArray(value) && value.length === 2 && value.every((item) => plainNumber(item) || text(item))
    }
    if (channel === 'visible') return typeof value === 'boolean' || text(value)
    return plainNumber(value) || text(value)
}

export interface ImportedKeyValue {
    value: number | [number, number] | boolean
    molang?: KeyMolang
}

export function importKeyValue(channel: string, raw: unknown): ImportedKeyValue {
    if (channel === 'position') {
        const pair = Array.isArray(raw) && raw.length === 2 ? raw : [0, 0]
        const x = typeof pair[0] === 'string' ? pair[0] : null
        const y = typeof pair[1] === 'string' ? pair[1] : null
        const value: [number, number] = [x === null ? Number(pair[0]) : 0, y === null ? Number(pair[1]) : 0]
        return x === null && y === null ? { value } : { value, molang: [x, y] }
    }
    if (typeof raw === 'string') {
        const neutral = channel === 'visible' ? true : channel === 'opacity' ? 1 : 0
        return { value: neutral, molang: raw }
    }
    if (channel === 'visible') return { value: raw === true }
    return { value: Number(raw) }
}

export function dataPointWithMolang(channel: string, key: MolangKey, base: Record<string, string>): Record<string, string> {
    const molang = key.molang
    if (molang === undefined || molang === null) return base
    if (Array.isArray(molang)) {
        if (channel !== 'position') return base
        return { ...base, x: molang[0] ?? base.x, y: molang[1] ?? base.y }
    }
    return { ...base, x: molang }
}

import { MANIFEST } from './files'
import { stringifyJson } from '../util/bundleJson'
import { cloneJson, isRecord } from '../util/json'

export const EXTRA_PROPERTY = 'nameplate_extra'

export type PathStep = string | { id: string }

export interface ExtraPatch {
    file: string
    path: PathStep[]
    value: unknown
    mode: 'set' | 'union'
    create: boolean
    label: string
}

export interface ExtraData {
    source: string
    patches: ExtraPatch[]
}

export interface KeptOverride {
    patch: ExtraPatch
    channels: string[]
}

let property: Property | null = null
let lastOverrides: KeptOverride[] = []

function emptyExtra(): ExtraData {
    return { source: '', patches: [] }
}

export function registerExtraProperty() {
    if (property) return
    property = new Property(ModelProject, 'object', EXTRA_PROPERTY, {
        exposed: false,
        default: () => emptyExtra(),
    })
}

export function unregisterExtraProperty() {
    property?.delete()
    property = null
}

function isPatch(value: unknown): value is ExtraPatch {
    return (
        isRecord(value) &&
        typeof value.file === 'string' &&
        Array.isArray(value.path) &&
        (value.mode === 'set' || value.mode === 'union')
    )
}

export function currentExtra(): ExtraData {
    const raw = typeof Project !== 'undefined' && Project ? (Project as any)[EXTRA_PROPERTY] : null
    if (!isRecord(raw) || !Array.isArray(raw.patches)) return emptyExtra()
    return { source: typeof raw.source === 'string' ? raw.source : '', patches: raw.patches.filter(isPatch) }
}

function child(container: any, step: PathStep): any {
    if (typeof step === 'string') return isRecord(container) ? container[step] : undefined
    return Array.isArray(container) ? container.find((item) => isRecord(item) && item.id === step.id) : undefined
}

function union(target: unknown, value: unknown): unknown {
    if (!Array.isArray(target) || !Array.isArray(value)) return cloneJson(value)
    const result = target.slice()
    const seen = new Set(result.map((item) => JSON.stringify(item)))
    for (const item of value) {
        const key = JSON.stringify(item)
        if (seen.has(key)) continue
        seen.add(key)
        result.push(cloneJson(item))
    }
    return result
}

function applyPatch(root: any, patch: ExtraPatch): any {
    if (patch.path.length === 0) {
        return patch.mode === 'union' ? union(root, patch.value) : cloneJson(patch.value)
    }
    let container = root
    for (let index = 0; index < patch.path.length - 1; index++) {
        const step = patch.path[index]
        let next = child(container, step)
        if (next === undefined) {
            if (!patch.create || typeof step !== 'string' || !isRecord(container)) return root
            next = {}
            container[step] = next
        }
        if (!next || typeof next !== 'object') return root
        container = next
    }
    const last = patch.path[patch.path.length - 1]
    if (typeof last !== 'string' || !isRecord(container)) return root
    container[last] = patch.mode === 'union' ? union(container[last], patch.value) : cloneJson(patch.value)
    return root
}

function valueAt(root: unknown, path: PathStep[]): unknown {
    let container: unknown = root
    for (const step of path) {
        container = child(container, step)
        if (container === undefined) return undefined
    }
    return container
}

function userCanOverride(patch: ExtraPatch): boolean {
    const path = patch.path
    if (patch.file !== MANIFEST || patch.mode !== 'set' || path[0] !== 'animations' || typeof path[1] !== 'string') return false
    return path.length === 2 || (path[2] === 'tracks' && path.length >= 4)
}

export function patchKey(patch: ExtraPatch): string {
    return JSON.stringify([patch.file, patch.path])
}

export function lastKeptOverrides(): KeptOverride[] {
    return lastOverrides
}

function withoutTaken(patch: ExtraPatch, mine: unknown, overrides: KeptOverride[]): ExtraPatch[] | null {
    if (!userCanOverride(patch) || mine === undefined) return [patch]
    if (patch.path.length !== 4 || !isRecord(mine) || !isRecord(patch.value)) {
        overrides.push({ patch, channels: patch.path.length > 4 ? [String(patch.path[4])] : [] })
        return null
    }
    const taken = Object.keys(patch.value).filter((channel) => Object.prototype.hasOwnProperty.call(mine, channel))
    if (taken.length === 0) return [patch]
    overrides.push({ patch, channels: taken })
    return Object.keys(patch.value)
        .filter((channel) => !taken.includes(channel))
        .map((channel) => ({ ...patch, path: [...patch.path, channel], value: (patch.value as Record<string, unknown>)[channel] }))
}

export function mergeExtra(files: Record<string, string>, extra: ExtraData = currentExtra(), overrides: KeptOverride[] = []): Record<string, string> {
    const parsed = new Map<string, any>()
    const compiled = new Map<string, any>()
    const compiledOf = (file: string) => {
        if (!compiled.has(file)) compiled.set(file, Object.prototype.hasOwnProperty.call(files, file) ? JSON.parse(files[file]) : undefined)
        return compiled.get(file)
    }
    for (const original of extra.patches) {
        try {
            const exists = Object.prototype.hasOwnProperty.call(files, original.file)
            if (!exists && (original.path.length > 0 || !original.create)) continue
            const pieces = userCanOverride(original) ? withoutTaken(original, valueAt(compiledOf(original.file), original.path), overrides) : [original]
            for (const patch of pieces ?? []) {
                const current = parsed.has(patch.file) ? parsed.get(patch.file) : exists ? JSON.parse(files[patch.file]) : undefined
                parsed.set(patch.file, applyPatch(current, patch))
            }
        } catch (error) {
            console.error('[polyplus_nameplate] could not merge kept bundle data', original.file, error)
        }
    }
    for (const [file, value] of parsed) files[file] = stringifyJson(value)
    lastOverrides = overrides.slice()
    return files
}

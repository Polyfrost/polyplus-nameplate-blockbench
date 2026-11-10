import {
    BADGE_KEYS,
    BadgeOverride,
    defaultBadge,
    defaultText,
    ReadNotes,
    readBadge,
    readBadgeOverride,
    readText,
    readTextOverride,
    StyledPlate,
    StyledVariant,
    TEXT_KEYS,
    TextOverride,
} from './types'
import { cloneJson, isRecord, sameSerialized } from '../util/json'

type Json = Record<string, unknown>
type KeepFn = (steps: string[], value: unknown, label: string) => void
type ChangeFn = (note: string) => void
type LayerResolver = (reference: string) => string

const sameLayer: LayerResolver = (reference) => reference

function withLayerId(badge: Json | null, resolveLayer: LayerResolver): Json | null {
    if (badge && typeof badge.of === 'string') badge.of = resolveLayer(badge.of)
    return badge
}

function pick<T extends object>(value: Partial<T>, keys: Array<keyof T>, include: (key: keyof T) => boolean): Json | null {
    const result: Json = {}
    for (const key of keys) {
        if (include(key)) result[key as string] = cloneJson(value[key])
    }
    return Object.keys(result).length ? result : null
}

function changed<T extends object>(value: T, base: T, keys: Array<keyof T>): Json | null {
    return pick(value, keys, (key) => !sameSerialized(value[key], base[key]))
}

function ordered<T extends object>(value: Partial<T>, keys: Array<keyof T>): Json | null {
    return pick(value, keys, (key) => key in value)
}

export function textBadgeManifest(plate: StyledPlate, resolveLayer: LayerResolver = sameLayer): Json {
    const result: Json = {}
    const text = changed(readText(plate.text), defaultText(), TEXT_KEYS)
    if (text) result.text = text
    const badge = withLayerId(changed(readBadge(plate.badge), defaultBadge(), BADGE_KEYS), resolveLayer)
    if (badge) result.badge = badge
    return result
}

export function variantStyleJson(variant: StyledVariant, resolveLayer: LayerResolver = sameLayer): Json {
    const result: Json = {}
    const text = ordered<TextOverride>(readTextOverride(variant.text), TEXT_KEYS)
    if (text) result.text = text
    const badge = withLayerId(ordered<BadgeOverride>(readBadgeOverride(variant.badge), BADGE_KEYS), resolveLayer)
    if (badge) result.badge = badge
    return result
}

function notesFor(where: string, part: 'text' | 'badge', keep: KeepFn, change: ChangeFn): ReadNotes {
    const label = part === 'text' ? 'Text' : 'Badge'
    return {
        unknown(key, value) {
            keep([part, key], value, `${label} setting '${key}'${where}`)
        },
        invalid(key, value) {
            change(`${label} setting '${key}'${where} was ${JSON.stringify(value)}, which the plugin can't use, so it went back to the default`)
        },
    }
}

export function importPlateStyle(manifest: any, keep: KeepFn, change: ChangeFn): StyledPlate {
    const result: StyledPlate = {}
    for (const part of ['text', 'badge'] as const) {
        const raw = manifest?.[part]
        if (raw === undefined) continue
        if (!isRecord(raw)) {
            change(`${part === 'text' ? 'Text' : 'Badge'} settings were not an object and were dropped`)
            continue
        }
        const notes = notesFor('', part, keep, change)
        if (part === 'text') result.text = readText(raw, notes)
        else result.badge = readBadge(raw, notes)
    }
    return result
}

export function importVariantStyle(spec: any, key: string, keep: KeepFn, change: ChangeFn): StyledVariant {
    const result: StyledVariant = {}
    for (const part of ['text', 'badge'] as const) {
        const raw = spec?.[part]
        if (raw === undefined || raw === null) continue
        if (!isRecord(raw)) {
            change(`Variant ${key}: ${part} settings were not an object and were dropped`)
            continue
        }
        const notes = notesFor(` on variant ${key}`, part, keep, change)
        if (part === 'text') {
            const text = readTextOverride(raw, notes)
            if (Object.keys(text).length) result.text = text
        } else {
            const badge = readBadgeOverride(raw, notes)
            if (Object.keys(badge).length) result.badge = badge
        }
    }
    return result
}

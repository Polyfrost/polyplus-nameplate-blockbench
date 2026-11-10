import type { Anchor } from '../model'
import { SPRITE_FOLLOWS, SpriteFollow } from '../motion/types'
import { isRecord } from '../util/json'

export type TextMode = 'vanilla' | 'motion' | 'owned'
type Formatting = 'adjust' | 'keep' | 'override'
type BadgePlacement = 'reserve' | 'carried' | 'placed'
export type BadgeDecoration = 'none' | 'auto' | 'shadow' | 'outline'

export const TEXT_MODES: TextMode[] = ['vanilla', 'motion', 'owned']
export const LETTER_MODE_NAMES: Record<TextMode, string> = {
    vanilla: 'Letters stay still',
    motion: 'Letters move',
    owned: 'Letters move and change color',
}
const FORMATTINGS: Formatting[] = ['adjust', 'keep', 'override']
const PLACEMENTS: BadgePlacement[] = ['reserve', 'carried', 'placed']
const DECORATIONS: BadgeDecoration[] = ['none', 'auto', 'shadow', 'outline']
export const BADGE_ANCHORS: Anchor[] = ['top_left', 'top', 'top_right', 'left', 'right', 'bottom_left', 'bottom', 'bottom_right']
export const MAX_BADGE_OFFSET = 32
export const WHITE = '#FFFFFF'
export const NEAR_BLACK = '#1A1A1A'
export const DEFAULT_CANDIDATES = [WHITE, NEAR_BLACK]

export interface TextSettings {
    mode: TextMode
    color: string
    shadow: string
    outline: string
    formatting: Formatting
    candidates: string[] | null
    backdropHint: string[]
    motion: string | null
}

export interface BadgeSettings {
    placement: BadgePlacement
    anchor: Anchor | null
    offset: [number, number]
    tint: string
    decoration: BadgeDecoration
    decorationColor: string | null
    candidates: string[] | null
    of: string | null
    follow: SpriteFollow | null
    at: number | null
}

export type TextOverride = Partial<TextSettings>
export type BadgeOverride = Partial<BadgeSettings>

export interface StyledPlate {
    text?: TextSettings
    badge?: BadgeSettings
}

export interface StyledVariant {
    text?: TextOverride
    badge?: BadgeOverride
}

export const TEXT_KEYS: Array<keyof TextSettings> = ['mode', 'color', 'shadow', 'outline', 'formatting', 'candidates', 'backdropHint', 'motion']
export const BADGE_KEYS: Array<keyof BadgeSettings> = ['placement', 'anchor', 'offset', 'tint', 'decoration', 'decorationColor', 'candidates', 'of', 'follow', 'at']

export function defaultText(): TextSettings {
    return { mode: 'vanilla', color: 'none', shadow: 'none', outline: 'none', formatting: 'adjust', candidates: null, backdropHint: [], motion: null }
}

export function defaultBadge(): BadgeSettings {
    return { placement: 'reserve', anchor: null, offset: [0, 0], tint: 'none', decoration: 'none', decorationColor: null, candidates: null, of: null, follow: null, at: null }
}

function stringList(value: unknown): string[] | undefined {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined
    return value.slice()
}

function offsetOf(value: unknown): [number, number] | undefined {
    if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'number' || !Number.isInteger(item))) return undefined
    return [value[0] + 0, value[1] + 0]
}

type Reader<T> = { [K in keyof T]: (value: unknown) => T[K] | undefined }

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined)
const oneOf = <T>(options: readonly T[]) => (value: unknown) => (options.includes(value as T) ? (value as T) : undefined)
const orNull = <T>(read: (value: unknown) => T | undefined) => (value: unknown) => (value === null ? null : read(value))

const TEXT_READER: Reader<TextSettings> = {
    mode: oneOf(TEXT_MODES),
    color: asString,
    shadow: asString,
    outline: asString,
    formatting: oneOf(FORMATTINGS),
    candidates: orNull(stringList),
    backdropHint: stringList,
    motion: orNull(asString),
}

const BADGE_READER: Reader<BadgeSettings> = {
    placement: oneOf(PLACEMENTS),
    anchor: orNull(oneOf(BADGE_ANCHORS)),
    offset: offsetOf,
    tint: asString,
    decoration: oneOf(DECORATIONS),
    decorationColor: orNull(asString),
    candidates: orNull(stringList),
    of: orNull(asString),
    follow: orNull(oneOf(SPRITE_FOLLOWS)),
    at: orNull((value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)),
}

export interface ReadNotes {
    unknown(key: string, value: unknown): void
    invalid(key: string, value: unknown): void
}

const SILENT: ReadNotes = { unknown() {}, invalid() {} }

function readPartial<T>(reader: Reader<T>, raw: unknown, notes: ReadNotes): Partial<T> {
    const result: Partial<T> = {}
    if (!isRecord(raw)) return result
    for (const key of Object.keys(raw)) {
        const read = (reader as any)[key] as ((value: unknown) => unknown) | undefined
        if (!read) {
            notes.unknown(key, raw[key])
            continue
        }
        const value = read(raw[key])
        if (value === undefined) notes.invalid(key, raw[key])
        else (result as any)[key] = value
    }
    return result
}

export function readTextOverride(raw: unknown, notes: ReadNotes = SILENT): TextOverride {
    return readPartial(TEXT_READER, raw, notes)
}

export function readBadgeOverride(raw: unknown, notes: ReadNotes = SILENT): BadgeOverride {
    return readPartial(BADGE_READER, raw, notes)
}

export function readText(raw: unknown, notes: ReadNotes = SILENT): TextSettings {
    return { ...defaultText(), ...readTextOverride(raw, notes) }
}

export function readBadge(raw: unknown, notes: ReadNotes = SILENT): BadgeSettings {
    return { ...defaultBadge(), ...readBadgeOverride(raw, notes) }
}

export function plateText(plate: StyledPlate | null | undefined): TextSettings {
    return readText(plate?.text)
}

export function plateBadge(plate: StyledPlate | null | undefined): BadgeSettings {
    return readBadge(plate?.badge)
}

export function variantText(plate: StyledPlate, variant: StyledVariant | null | undefined): TextSettings {
    return { ...plateText(plate), ...readTextOverride(variant?.text) }
}

export function variantBadge(plate: StyledPlate, variant: StyledVariant | null | undefined): BadgeSettings {
    return { ...plateBadge(plate), ...readBadgeOverride(variant?.badge) }
}

export function normalizePlateStyle(raw: any): StyledPlate {
    const result: StyledPlate = {}
    if (isRecord(raw?.text)) result.text = readText(raw.text)
    if (isRecord(raw?.badge)) result.badge = readBadge(raw.badge)
    return result
}

export function normalizeVariantStyle(raw: any): StyledVariant {
    const result: StyledVariant = {}
    if (isRecord(raw?.text)) {
        const text = readTextOverride(raw.text)
        if (Object.keys(text).length) result.text = text
    }
    if (isRecord(raw?.badge)) {
        const badge = readBadgeOverride(raw.badge)
        if (Object.keys(badge).length) result.badge = badge
    }
    return result
}

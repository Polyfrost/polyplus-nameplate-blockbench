import { describe } from '../engine'
import type { Slot } from '../model'
import type { AnimationSettings } from '../animate/props'
import type { LetterTrack } from '../text/reaction'
import { createListenerSet } from '../util/events'
import { cloneJson } from '../util/json'
import { finiteOr } from '../util/num'

export const LIBRARY_KEY = 'polyplus_nameplate_library'
export const LIBRARY_FORMAT = 'polyplus_nameplate_library'
export const LIBRARY_VERSION = 1

export type LibraryKind = 'sprite' | 'palette' | 'animation'

interface ItemBase {
    id: string
    kind: LibraryKind
    name: string
    saved: number
}

export interface SpriteItem extends ItemBase {
    kind: 'sprite'
    width: number
    height: number
    frames: string[][]
    colors: Record<string, string>
    slots: Slot[]
}

export interface PaletteItem extends ItemBase {
    kind: 'palette'
    slots: Slot[]
    colorways: Record<string, Record<string, string[]>>
}

export interface PresetKey {
    frame: number
    interpolation: string
    x: string
    y?: string
    bezier?: Record<string, number[]>
}

export interface AnimationItem extends ItemBase {
    kind: 'animation'
    loop: boolean
    length: number
    fps: number
    target: string
    settings: AnimationSettings | null
    channels: Record<string, PresetKey[]>
    letters?: LetterTrack
}

export type LibraryItem = SpriteItem | PaletteItem | AnimationItem

export interface LibraryFile {
    format: string
    version: number
    items: LibraryItem[]
}

const KINDS: LibraryKind[] = ['sprite', 'palette', 'animation']
const SPRITE_CHARS = /^[A-Za-z0-9]$/
const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/

const listeners = createListenerSet('library listener failed')
let memory: LibraryItem[] = []
let loaded = false

function storageKey(): string {
    return `StateMemory.${LIBRARY_KEY}`
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function wholeAtLeast(value: unknown, min: number, fallback: number): number {
    const number = Math.floor(Number(value))
    return isFinite(number) && number >= min ? number : fallback
}

function cleanSlot(raw: any): Slot | null {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null
    const ramp = stringList(raw.ramp).filter((tone) => HEX.test(tone))
    if (ramp.length === 0) return null
    return { ...cloneJson(raw), id: raw.id, name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id, ramp }
}

function cleanSlots(value: unknown): Slot[] {
    const seen = new Set<string>()
    const result: Slot[] = []
    for (const raw of Array.isArray(value) ? value : []) {
        const slot = cleanSlot(raw)
        if (!slot || seen.has(slot.id)) continue
        seen.add(slot.id)
        result.push(slot)
    }
    return result
}

function cleanColorways(value: unknown): Record<string, Record<string, string[]>> {
    const result: Record<string, Record<string, string[]>> = {}
    if (!value || typeof value !== 'object') return result
    for (const [name, overrides] of Object.entries(value as Record<string, any>)) {
        const clean: Record<string, string[]> = {}
        if (overrides && typeof overrides === 'object') {
            for (const [slot, ramp] of Object.entries(overrides as Record<string, unknown>)) {
                const tones = stringList(ramp).filter((tone) => HEX.test(tone))
                if (tones.length > 0) clean[slot] = tones
            }
        }
        result[name] = clean
    }
    return result
}

function cleanSprite(raw: any, base: ItemBase): SpriteItem | null {
    const width = wholeAtLeast(raw.width, 1, 0)
    const height = wholeAtLeast(raw.height, 1, 0)
    if (!width || !height || !Array.isArray(raw.frames) || raw.frames.length === 0) return null
    const frames: string[][] = []
    for (const frame of raw.frames) {
        const rows = stringList(frame)
        if (rows.length !== height || rows.some((row) => row.length !== width)) return null
        frames.push(rows)
    }
    const colors: Record<string, string> = {}
    if (raw.colors && typeof raw.colors === 'object') {
        for (const [char, ref] of Object.entries(raw.colors as Record<string, unknown>)) {
            if (SPRITE_CHARS.test(char) && typeof ref === 'string' && ref) colors[char] = ref
        }
    }
    return { ...base, kind: 'sprite', width, height, frames, colors, slots: cleanSlots(raw.slots) }
}

function cleanKeys(value: unknown): PresetKey[] {
    const keys: PresetKey[] = []
    for (const raw of Array.isArray(value) ? value : []) {
        if (!raw || typeof raw !== 'object') continue
        const frame = finiteOr((raw as any).frame, NaN)
        if (!isFinite(frame) || frame < 0) continue
        const key: PresetKey = {
            frame,
            interpolation: typeof (raw as any).interpolation === 'string' ? (raw as any).interpolation : 'linear',
            x: String((raw as any).x ?? '0'),
        }
        if ((raw as any).y !== undefined) key.y = String((raw as any).y)
        const bezier = (raw as any).bezier
        if (bezier && typeof bezier === 'object') {
            const clean: Record<string, number[]> = {}
            for (const [name, list] of Object.entries(bezier as Record<string, unknown>)) {
                if (Array.isArray(list)) clean[name] = list.map((entry) => finiteOr(entry, 0))
            }
            key.bezier = clean
        }
        keys.push(key)
    }
    return keys.sort((a, b) => a.frame - b.frame)
}

function cleanAnimation(raw: any, base: ItemBase): AnimationItem | null {
    const channels: Record<string, PresetKey[]> = {}
    if (raw.channels && typeof raw.channels === 'object') {
        for (const [channel, keys] of Object.entries(raw.channels as Record<string, unknown>)) {
            const clean = cleanKeys(keys)
            if (clean.length > 0) channels[channel] = clean
        }
    }
    if (Object.keys(channels).length === 0) return null
    const settings = raw.settings && typeof raw.settings === 'object' ? { ...raw.settings } as AnimationSettings : null
    const motion = raw.letters && typeof raw.letters === 'object' && typeof raw.letters.motion === 'string' ? raw.letters.motion.trim() : ''
    return {
        ...base,
        kind: 'animation',
        loop: raw.loop === true,
        length: wholeAtLeast(raw.length, 1, 1),
        fps: wholeAtLeast(raw.fps, 1, 10),
        target: typeof raw.target === 'string' ? raw.target : 'sprite',
        settings,
        channels,
        ...(motion ? { letters: { motion } } : {}),
    }
}

export function cleanItem(raw: any): LibraryItem | null {
    if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null
    const base: ItemBase = {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newItemId(),
        kind: raw.kind,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.kind,
        saved: finiteOr(raw.saved, Date.now()),
    }
    switch (raw.kind as LibraryKind) {
        case 'sprite':
            return cleanSprite(raw, base)
        case 'palette': {
            const slots = cleanSlots(raw.slots)
            if (slots.length === 0) return null
            const colorways = cleanColorways(raw.colorways)
            if (Object.keys(colorways).length === 0) colorways.default = {}
            return { ...base, kind: 'palette', slots, colorways }
        }
        case 'animation':
            return cleanAnimation(raw, base)
    }
}

export function newItemId(): string {
    const random = Math.random().toString(36).slice(2, 10)
    return `${Date.now().toString(36)}_${random}`
}

function readStored(): LibraryItem[] {
    let raw: unknown = null
    try {
        StateMemory.init(LIBRARY_KEY, 'array')
        const text = localStorage.getItem(storageKey())
        if (text !== null) StateMemory[LIBRARY_KEY] = JSON.parse(text)
        raw = StateMemory[LIBRARY_KEY]
    } catch (error) {
        console.error('[polyplus_nameplate] could not read the library', error)
    }
    const items: LibraryItem[] = []
    for (const entry of Array.isArray(raw) ? raw : []) {
        const item = cleanItem(entry)
        if (item) items.push(item)
    }
    return items
}

function ensureLoaded() {
    if (loaded) return
    memory = readStored()
    loaded = true
}

function notify() {
    listeners.notify()
}

function persist(items: LibraryItem[]): string | null {
    const before = StateMemory[LIBRARY_KEY]
    StateMemory[LIBRARY_KEY] = items
    try {
        StateMemory.save(LIBRARY_KEY)
    } catch (error) {
        StateMemory[LIBRARY_KEY] = before
        return error instanceof Error && /quota/i.test(error.name + error.message)
            ? 'The library is full. Export it to a file, then delete large sprites you no longer need.'
            : `The library couldn't be saved: ${describe(error)}`
    }
    memory = items
    return null
}

function commit(items: LibraryItem[]): string | null {
    const error = persist(items)
    if (!error) notify()
    return error
}

export function libraryItems(): LibraryItem[] {
    ensureLoaded()
    return memory.slice()
}

export function findItem(id: string): LibraryItem | undefined {
    ensureLoaded()
    return memory.find((item) => item.id === id)
}

export function addItem(item: LibraryItem): string | null {
    ensureLoaded()
    return commit([...memory, item])
}

export function addItems(items: LibraryItem[]): string | null {
    ensureLoaded()
    return commit([...memory, ...items])
}

export function renameItem(id: string, name: string): string | null {
    ensureLoaded()
    const trimmed = name.trim()
    if (!trimmed) return null
    return commit(memory.map((item) => (item.id === id ? { ...item, name: trimmed } : item)))
}

export function deleteItem(id: string): string | null {
    ensureLoaded()
    return commit(memory.filter((item) => item.id !== id))
}

export function reloadLibrary() {
    loaded = false
    ensureLoaded()
    notify()
}

export function onLibraryChanged(listener: () => void): () => void {
    return listeners.on(listener)
}

export function watchOtherWindows(): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
    const handler = (event: StorageEvent) => {
        if (event.key === storageKey()) reloadLibrary()
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
}

export function libraryFile(items: LibraryItem[] = libraryItems()): LibraryFile {
    return { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, items }
}

export interface ParsedLibrary {
    items: LibraryItem[]
    skipped: number
    error: string | null
}

export function parseLibraryFile(text: string): ParsedLibrary {
    let data: any
    try {
        data = JSON.parse(text)
    } catch {
        return { items: [], skipped: 0, error: 'This file is not JSON. Pick a file made with Export Library.' }
    }
    const list = Array.isArray(data) ? data : data && typeof data === 'object' && data.format === LIBRARY_FORMAT ? data.items : null
    if (!Array.isArray(list)) return { items: [], skipped: 0, error: 'This is not a nameplate library file. Pick a file made with Export Library.' }
    if (!Array.isArray(data) && Number(data.version) > LIBRARY_VERSION) {
        return { items: [], skipped: 0, error: 'This library file comes from a newer version of the plugin. Update the plugin, then import it again.' }
    }
    const items: LibraryItem[] = []
    let skipped = 0
    for (const entry of list) {
        const item = cleanItem(entry)
        if (item) items.push(item)
        else skipped++
    }
    return { items, skipped, error: null }
}

function contentOf(item: LibraryItem): string {
    const { id: _id, saved: _saved, name: _name, ...rest } = item
    return JSON.stringify(rest)
}

export interface MergeResult {
    added: LibraryItem[]
    duplicates: number
}

export function mergeItems(incoming: LibraryItem[]): MergeResult {
    ensureLoaded()
    const ids = new Set(memory.map((item) => item.id))
    const contents = new Set(memory.map((item) => `${item.name}\n${contentOf(item)}`))
    const added: LibraryItem[] = []
    let duplicates = 0
    for (const item of incoming) {
        const content = `${item.name}\n${contentOf(item)}`
        if (contents.has(content)) {
            duplicates++
            continue
        }
        contents.add(content)
        const copy = { ...item, id: ids.has(item.id) ? newItemId() : item.id } as LibraryItem
        ids.add(copy.id)
        added.push(copy)
    }
    return { added, duplicates }
}

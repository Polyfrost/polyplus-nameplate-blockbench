import { NameplateData, PaletteData, Slot } from '../model'
import { paletteHex, toArgbKey, toRgbHex } from '../palette/color'
import { slotIdFrom } from '../palette/ids'
import { ColorMap } from '../palette/pixels'
import { commit } from '../palette/state'
import { cloneJson } from '../util/json'
import { newItemId, PaletteItem } from './store'

export type PaletteMode = 'add' | 'replace'

export interface PaletteInsert {
    added: string[]
    reused: string[]
    skippedColorways: string[]
    recolored: boolean
}

export function sameRamp(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((color, index) => paletteHex(color) === paletteHex(b[index]))
}

export function capturePalette(palette: PaletteData, name: string): PaletteItem {
    return {
        id: newItemId(),
        kind: 'palette',
        name,
        saved: Date.now(),
        slots: cloneJson(palette.slots),
        colorways: cloneJson(palette.colorways),
    }
}

export function paletteSwatches(item: PaletteItem, limit = 8): string[] {
    const swatches: string[] = []
    for (const slot of item.slots) {
        const middle = slot.ramp[Math.floor((slot.ramp.length - 1) / 2)]
        if (middle) swatches.push(toRgbHex(middle))
        if (swatches.length >= limit) break
    }
    return swatches
}

function addColors(plate: NameplateData, item: PaletteItem, result: PaletteInsert) {
    const slots = plate.palette.slots
    const taken = new Set(slots.map((slot) => slot.id))
    const idOf = new Map<string, string>()
    for (const saved of item.slots) {
        const same = slots.find((slot) => slot.id === saved.id && sameRamp(slot.ramp, saved.ramp))
        if (same) {
            result.reused.push(same.name)
            continue
        }
        const id = slotIdFrom(saved.id, (candidate) => taken.has(candidate))
        taken.add(id)
        idOf.set(saved.id, id)
        slots.push({ ...cloneJson(saved), id, name: id === saved.id ? saved.name : `${saved.name} (library)`, ramp: saved.ramp.slice() })
        result.added.push(id === saved.id ? saved.name : `${saved.name} (library)`)
    }
    for (const [name, overrides] of Object.entries(item.colorways)) {
        const entries = Object.entries(overrides).filter(([slot]) => idOf.has(slot))
        if (entries.length === 0) continue
        const target = plate.palette.colorways[name]
        if (!target) {
            result.skippedColorways.push(name)
            continue
        }
        for (const [slot, ramp] of entries) target[idOf.get(slot)!] = ramp.slice()
    }
}

function replaceColors(plate: NameplateData, item: PaletteItem) {
    const old = plate.palette.slots
    const taken = new Set<string>()
    const idOf = new Map<string, string>()
    const slots: Slot[] = []
    item.slots.forEach((saved, index) => {
        const keep = old[index]?.id
        const id = keep ?? slotIdFrom(saved.id, (candidate) => taken.has(candidate) || old.some((slot) => slot.id === candidate))
        taken.add(id)
        idOf.set(saved.id, id)
        slots.push({ ...cloneJson(saved), id, name: saved.name, ramp: saved.ramp.slice() })
    })
    for (const rest of old.slice(item.slots.length)) slots.push(rest)
    const colorways: Record<string, Record<string, string[]>> = {}
    for (const [name, overrides] of Object.entries(item.colorways)) {
        const clean: Record<string, string[]> = {}
        for (const [slot, ramp] of Object.entries(overrides)) {
            const id = idOf.get(slot)
            if (id) clean[id] = ramp.slice()
        }
        colorways[name] = clean
    }
    if (Object.keys(colorways).length === 0) colorways.default = {}
    plate.palette.slots = slots
    plate.palette.colorways = colorways
    const first = Object.keys(colorways)[0]
    for (const variant of Object.values(plate.variants)) {
        if (!(variant.palette in colorways)) variant.palette = first
    }
}

function argbOf(color: string): string {
    return toArgbKey(color) ?? `FF${toRgbHex(color).slice(1).toUpperCase()}`
}

function replaceRemap(before: NameplateData, after: NameplateData, count: number): ColorMap {
    const map: ColorMap = new Map()
    const seen = new Set<string>()
    before.palette.slots.forEach((slot, index) => {
        const next = index < count ? after.palette.slots[index] : undefined
        slot.ramp.forEach((color, tone) => {
            const from = argbOf(color)
            if (seen.has(from)) return
            seen.add(from)
            if (!next?.ramp.length) return
            const to = argbOf(next.ramp[Math.min(tone, next.ramp.length - 1)])
            if (to !== from) map.set(from, to)
        })
    })
    return map
}

export function insertPalette(item: PaletteItem, mode: PaletteMode): PaletteInsert | null {
    const result: PaletteInsert = { added: [], reused: [], skippedColorways: [], recolored: false }
    if (mode === 'replace') {
        const done = commit('Replace colors from library', (plate) => replaceColors(plate, item), (before, after) => {
            const map = replaceRemap(before, after, item.slots.length)
            result.recolored = map.size > 0
            return map
        })
        return done ? result : null
    }
    const done = commit('Insert colors from library', (plate) => addColors(plate, item, result))
    return done ? result : null
}

import type { NameplateData, Slot } from '../model'
import type { FlagsState } from '../flags/types'
import { ColorKey, PaletteMotion, normalizeMotion, parseColorRef, toneRef } from '../palanim/types'
import { cloneJson, isRecord } from '../util/json'
import { clamp } from '../util/num'

export interface ShadeMove {
    slot: string
    name: string
    before: number
    after: number
    toNew: (tone: number) => number
    fromNew: (tone: number) => number
    removed: number[]
}

export interface MoveReport {
    moved: string[]
    dropped: string[]
}

export function emptyReport(): MoveReport {
    return { moved: [], dropped: [] }
}

function note(report: MoveReport, where: string) {
    if (!report.moved.includes(where)) report.moved.push(where)
}

export function newTone(move: ShadeMove, tone: number): number {
    return clamp(move.toNew(clamp(tone, 0, Math.max(0, move.before - 1))), 0, Math.max(0, move.after - 1))
}

function moveRef(color: string, move: ShadeMove, where: string, report: MoveReport): string {
    const ref = parseColorRef(color)
    if (!ref || ref.slot !== move.slot) return color
    const last = Math.max(0, move.before - 1)
    const pastEnd = ref.tone > last
    const old = Math.min(ref.tone, last)
    if (move.removed.includes(old)) note(report, where)
    const tone = newTone(move, old)
    if (pastEnd && tone === Math.max(0, move.after - 1)) return color
    if (!pastEnd && tone === ref.tone) return color
    return toneRef(move.slot, tone)
}

function moveList(list: unknown, move: ShadeMove, where: string, report: MoveReport): void {
    if (!Array.isArray(list)) return
    for (let index = 0; index < list.length; index++) {
        if (typeof list[index] === 'string') list[index] = moveRef(list[index], move, where, report)
    }
}

function moveField(target: Record<string, any> | undefined | null, key: string, move: ShadeMove, where: string, report: MoveReport) {
    if (target && typeof target[key] === 'string') target[key] = moveRef(target[key], move, where, report)
}

function moveStyle(text: Record<string, any> | undefined, badge: Record<string, any> | undefined, move: ShadeMove, prefix: string, report: MoveReport) {
    if (isRecord(text)) {
        moveField(text, 'color', move, `${prefix}text color`, report)
        moveField(text, 'shadow', move, `${prefix}text shadow`, report)
        moveField(text, 'outline', move, `${prefix}text outline`, report)
        moveList(text.candidates, move, `${prefix}text color choices`, report)
        moveList(text.backdropHint, move, `${prefix}text backdrop colors`, report)
    }
    if (isRecord(badge)) {
        moveField(badge, 'tint', move, `${prefix}badge tint`, report)
        moveField(badge, 'decorationColor', move, `${prefix}badge outline or shadow color`, report)
        moveList(badge.candidates, move, `${prefix}badge color choices`, report)
    }
}

function moveKeys(keys: ColorKey[], move: ShadeMove, own: boolean, where: string, report: MoveReport): ColorKey[] {
    return keys.map((key) => {
        const colors = own
            ? Array.from({ length: Math.max(1, move.after) }, (_, tone) => key.colors[clamp(move.fromNew(tone), 0, key.colors.length - 1)])
            : key.colors.slice()
        return { ...key, colors: colors.map((color) => color === 'base' ? color : moveRef(color, move, where, report)) }
    })
}

function moveMotion(motion: PaletteMotion | undefined, move: ShadeMove, own: boolean, where: string, report: MoveReport): PaletteMotion | undefined {
    if (!motion || motion.kind !== 'keys') return motion
    return { kind: 'keys', keys: moveKeys(motion.keys, move, own, where, report) }
}

export function movePlateRefs(plate: NameplateData, move: ShadeMove, report: MoveReport) {
    moveStyle(plate.text as any, plate.badge as any, move, '', report)
    for (const [key, variant] of Object.entries(plate.variants)) {
        moveStyle(variant.text as any, variant.badge as any, move, `variant '${key}' `, report)
    }
    for (const slot of plate.palette.slots) {
        if (!slot.animation) continue
        const next = moveMotion(slot.animation, move, slot.id === move.slot, `color animation of '${slot.name}'`, report)
        if (next) slot.animation = next
    }
}

export function moveFlagRefs(state: FlagsState, move: ShadeMove, report: MoveReport) {
    for (const flag of state.flags) {
        flag.bands.forEach((band, index) => {
            band.color = moveRef(band.color, move, `flag '${flag.id}' stripe ${index + 1}`, report)
        })
        if (flag.overlay) moveList(flag.overlay.colors, move, `flag '${flag.id}' overlay`, report)
    }
}

function moveFillRef(fill: unknown, move: ShadeMove, where: string, report: MoveReport) {
    if (isRecord(fill) && fill.kind === 'color' && typeof fill.ref === 'string') fill.ref = moveRef(fill.ref, move, where, report)
}

export function moveBodyRefs(node: { name?: string, fill?: unknown, rings?: unknown }, move: ShadeMove, report: MoveReport) {
    const name = String(node.name ?? 'body')
    moveFillRef(node.fill, move, `body '${name}' fill`, report)
    if (Array.isArray(node.rings)) node.rings.forEach((ring, index) => moveFillRef(ring, move, `body '${name}' border ring ${index + 1}`, report))
}

export function moveGraphRefs(graphs: Record<string, { nodes: Array<{ type: string, set?: Record<string, unknown> }> }>, move: ShadeMove, report: MoveReport) {
    for (const [id, graph] of Object.entries(graphs)) {
        for (const node of graph.nodes) {
            if (node.type !== 'Slot' || !node.set || typeof node.set.slot !== 'string') continue
            node.set.slot = moveRef(node.set.slot, move, `effect '${id}' palette color`, report)
        }
    }
}

export function moveStoredPalette(
    raw: Record<string, unknown>,
    move: ShadeMove,
    animation: string,
    slots: Slot[],
    report: MoveReport,
): Record<string, unknown> {
    const next: Record<string, unknown> = {}
    for (const [id, value] of Object.entries(raw)) {
        const slot = slots.find((entry) => entry.id === id)
        const own = id === move.slot
        const tones = own ? move.before : Math.max(1, slot?.ramp.length ?? 1)
        const motion = normalizeMotion(value, tones)
        if (!motion || motion.kind !== 'keys') {
            next[id] = value
            continue
        }
        next[id] = cloneJson(moveMotion(motion, move, own, `animation '${animation}', color '${slot?.name ?? id}'`, report))
    }
    return next
}

export function moveMolangRefs(state: Record<string, string[]>, move: ShadeMove, report: MoveReport, nameOf: (id: string) => string = (id) => id) {
    for (const [id, tones] of Object.entries(state)) {
        if (id === move.slot) {
            move.removed.forEach((tone) => {
                if ((tones[tone] ?? '').trim()) report.dropped.push(`the formula for shade ${tone + 1} of '${move.name}'`)
            })
            state[id] = Array.from({ length: Math.max(1, move.after) }, (_, tone) => {
                const old = move.fromNew(tone)
                return old >= 0 && old < move.before ? tones[old] ?? '' : ''
            })
        }
        moveList(state[id], move, `color formula of '${nameOf(id)}'`, report)
    }
}

function nearestTone(ramp: string[], target: number, keep: (tone: number) => boolean): number {
    const parse = (text: string) => {
        const hex = String(text).replace('#', '')
        const rgb = parseInt(hex.length === 8 ? hex.slice(2) : hex.slice(0, 6), 16)
        return Number.isFinite(rgb) ? [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255] : [0, 0, 0]
    }
    const [r, g, b] = parse(ramp[target] ?? '#000000')
    let best = -1
    let bestDistance = Infinity
    ramp.forEach((color, tone) => {
        if (!keep(tone)) return
        const [cr, cg, cb] = parse(color)
        const mean = (cr + r) / 2
        const distance = (2 + mean / 256) * (cr - r) ** 2 + 4 * (cg - g) ** 2 + (2 + (255 - mean) / 256) * (cb - b) ** 2
        if (distance < bestDistance || (distance === bestDistance && Math.abs(tone - target) < Math.abs(best - target))) {
            best = tone
            bestDistance = distance
        }
    })
    return best
}

export function removalMove(slot: Slot, tone: number): ShadeMove {
    const before = slot.ramp.length
    const nearest = nearestTone(slot.ramp, tone, (other) => other !== tone)
    const shift = (old: number) => (old > tone ? old - 1 : old)
    return {
        slot: slot.id,
        name: slot.name,
        before,
        after: before - 1,
        toNew: (old) => (old === tone ? shift(nearest) : shift(old)),
        fromNew: (index) => (index < tone ? index : index + 1),
        removed: [tone],
    }
}

export function insertionMove(slot: Slot, at: number): ShadeMove {
    const before = slot.ramp.length
    return {
        slot: slot.id,
        name: slot.name,
        before,
        after: before + 1,
        toNew: (old) => (old <= at ? old : old + 1),
        fromNew: (index) => (index <= at ? index : index - 1),
        removed: [],
    }
}

export function reorderMove(slot: Slot, order: number[]): ShadeMove {
    return {
        slot: slot.id,
        name: slot.name,
        before: slot.ramp.length,
        after: slot.ramp.length,
        toNew: (old) => {
            const index = order.indexOf(old)
            return index < 0 ? old : index
        },
        fromNew: (index) => order[index] ?? index,
        removed: [],
    }
}

function proportional(was: number, now: number): (tone: number) => number {
    return (tone) => (was <= 1 ? Math.round((now - 1) / 2) : Math.round((tone * (now - 1)) / Math.max(1, was - 1)))
}

export function resizeMove(slot: Slot, before: number, after: number): ShadeMove {
    return {
        slot: slot.id,
        name: slot.name,
        before,
        after,
        toNew: proportional(before, after),
        fromNew: proportional(after, before),
        removed: [],
    }
}

export function isIdentity(move: ShadeMove): boolean {
    if (move.before !== move.after || move.removed.length) return false
    for (let tone = 0; tone < move.before; tone++) if (move.toNew(tone) !== tone) return false
    return true
}

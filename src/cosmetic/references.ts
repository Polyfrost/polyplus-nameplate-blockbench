import type { EngineIssue } from '../engine'
import { isRecord } from '../util/json'
import type { CosmeticData, TargetIds, UseRef } from './data'

export interface Named {
    uuid: string
    name: string
}

export interface ReferenceTargets {
    animations: readonly Named[]
    controllers: readonly Named[]
}

export type RefKind = 'animations' | 'controllers' | 'colorways' | 'effects'
export type OwnKind = 'colorways' | 'effects'

const OWN_KINDS: readonly OwnKind[] = ['colorways', 'effects']

export interface ReferenceUse {
    kind: RefKind
    path: string
    name: string
    ref: UseRef | undefined
    set(name: string, ref: UseRef | undefined): void
}

interface Slot {
    ref: UseRef | undefined
    put(ref: UseRef | undefined): void
}

export function refOf(value: unknown): UseRef | undefined {
    return isRecord(value) && typeof value.id === 'string' && value.id && typeof value.name === 'string' ? { id: value.id, name: value.name } : undefined
}

function field(owner: object, key: string): Slot {
    const record = owner as Record<string, unknown>
    return {
        ref: refOf(record[key]),
        put(ref) {
            if (ref) record[key] = ref
            else delete record[key]
        },
    }
}

function controllerSlot(data: CosmeticData, index: number): Slot {
    const raw: unknown[] = Array.isArray(data.controllerRefs) ? data.controllerRefs : []
    return {
        ref: refOf(raw[index]),
        put(ref) {
            const current: unknown[] = Array.isArray(data.controllerRefs) ? data.controllerRefs : []
            const refs = data.controllers.map((_, i) => (i === index ? ref ?? null : refOf(current[i]) ?? null))
            if (refs.some(Boolean)) data.controllerRefs = refs
            else delete data.controllerRefs
        },
    }
}

function use(kind: RefKind, path: string, name: string, slot: Slot, rename: (name: string) => void): ReferenceUse {
    return {
        kind,
        path,
        name,
        ref: slot.ref,
        set(next, ref) {
            rename(next)
            slot.put(ref)
        },
    }
}

export function usesOf(data: CosmeticData): ReferenceUse[] {
    const uses: ReferenceUse[] = []
    data.emote.roles.forEach((role, i) => uses.push(use('animations', `roles.${i}`, role.animation, field(role, 'ref'), (name) => (role.animation = name))))
    uses.push(use('animations', 'fallback', data.emote.fallback, field(data.emote, 'fallbackRef'), (name) => (data.emote.fallback = name)))
    uses.push(use('animations', 'main', data.emote.main, field(data.emote, 'mainRef'), (name) => (data.emote.main = name)))
    data.pet.roles.forEach((role, i) => uses.push(use('animations', `roles.${i}`, role.animation, field(role, 'ref'), (name) => (role.animation = name))))
    data.reactions.forEach((reaction, i) => {
        uses.push(use('animations', `reactions.${i}`, reaction.play, field(reaction, 'playRef'), (name) => (reaction.play = name)))
        uses.push(use('colorways', `reactions.${i}`, reaction.palette, field(reaction, 'paletteRef'), (name) => (reaction.palette = name)))
        uses.push(use('effects', `reactions.${i}`, reaction.effect, field(reaction, 'effectRef'), (name) => (reaction.effect = name)))
    })
    data.controllers.forEach((name, i) => uses.push(use('controllers', 'controllers', name, controllerSlot(data, i), (next) => (data.controllers[i] = next))))
    return uses
}

function ownNames(data: CosmeticData, kind: OwnKind): string[] {
    return Object.keys(kind === 'colorways' ? data.palette.colorways : data.effects.named)
}

export function targetIds(data: CosmeticData): TargetIds {
    const raw: unknown = data.ids
    const read = (kind: OwnKind) => {
        const out: Record<string, string> = {}
        const source = isRecord(raw) ? raw[kind] : null
        if (isRecord(source)) for (const [name, id] of Object.entries(source)) if (typeof id === 'string' && id) out[name] = id
        return out
    }
    return { colorways: read('colorways'), effects: read('effects') }
}

export function setTargetIds(data: CosmeticData, kind: OwnKind, ids: Record<string, string>) {
    const next = { ...targetIds(data), [kind]: ids }
    if (Object.keys(next.colorways).length || Object.keys(next.effects).length) data.ids = next
    else delete data.ids
}

export function keptIds(before: Record<string, string>, renamed: ReadonlyMap<string, string>): Record<string, string> {
    const ids: Record<string, string> = {}
    for (const [from, to] of renamed) if (before[from]) ids[to] = before[from]
    return ids
}

function freshId(kind: OwnKind, taken: ReadonlySet<string>): string {
    for (;;) {
        const id = `${kind === 'colorways' ? 'cw' : 'fx'}-${Math.random().toString(36).slice(2, 10)}`
        if (!taken.has(id)) return id
    }
}

function assignIds(data: CosmeticData, uses: readonly ReferenceUse[]) {
    for (const kind of OWN_KINDS) {
        const before = targetIds(data)[kind]
        const taken = new Set<string>([...Object.values(before), ...uses.filter((item) => item.kind === kind && item.ref).map((item) => item.ref!.id)])
        const used = new Set<string>()
        const ids: Record<string, string> = {}
        for (const name of ownNames(data, kind)) {
            const kept = before[name]
            const id = kept && !used.has(kept) ? kept : freshId(kind, taken)
            taken.add(id)
            used.add(id)
            ids[name] = id
        }
        setTargetIds(data, kind, ids)
    }
}

type TargetLists = Partial<Record<RefKind, readonly Named[]>>

function targetLists(data: CosmeticData, external: ReferenceTargets | null): TargetLists {
    const ids = targetIds(data)
    const own = (kind: OwnKind) => ownNames(data, kind).filter((name) => ids[kind][name]).map((name) => ({ uuid: ids[kind][name], name }))
    const lists: TargetLists = { colorways: own('colorways'), effects: own('effects') }
    if (external) {
        lists.animations = external.animations
        lists.controllers = external.controllers
    }
    return lists
}

function legacy(raw: unknown, kind: 'animations' | 'controllers'): Record<string, string> {
    const out: Record<string, string> = {}
    const source = isRecord(raw) ? raw[kind] : null
    if (isRecord(source)) for (const [name, uuid] of Object.entries(source)) if (typeof uuid === 'string' && uuid) out[name] = uuid
    return out
}

export function migrateReferences(data: CosmeticData): CosmeticData {
    if (!('refs' in data)) return data
    const maps = { animations: legacy(data.refs, 'animations'), controllers: legacy(data.refs, 'controllers') }
    delete data.refs
    for (const item of usesOf(data)) {
        if (item.kind !== 'animations' && item.kind !== 'controllers') continue
        if (item.ref || !item.name) continue
        const uuid = maps[item.kind][item.name]
        if (uuid) item.set(item.name, { id: uuid, name: item.name })
    }
    return data
}

export function resolveReferences(data: CosmeticData, external: ReferenceTargets | null): CosmeticData {
    migrateReferences(data)
    const lists = targetLists(data, external)
    for (const item of usesOf(data)) {
        const ref = item.ref
        const list = lists[item.kind]
        if (!ref || !list || ref.name !== item.name) continue
        const target = list.find((candidate) => candidate.uuid === ref.id)
        if (target && target.name !== item.name) item.set(target.name, { id: ref.id, name: target.name })
    }
    return data
}

export function stampReferences(data: CosmeticData, external: ReferenceTargets | null): CosmeticData {
    migrateReferences(data)
    assignIds(data, usesOf(data))
    const lists = targetLists(data, external)
    for (const item of usesOf(data)) {
        if (!item.name) {
            if (item.ref) item.set('', undefined)
            continue
        }
        if (item.ref && item.ref.name === item.name) continue
        const list = lists[item.kind]
        if (!list) continue
        const target = list.find((candidate) => candidate.name === item.name)
        item.set(item.name, target ? { id: target.uuid, name: item.name } : undefined)
    }
    return data
}

export function referenceSignature(data: CosmeticData): string {
    return JSON.stringify({ uses: usesOf(data).map((item) => item.ref ?? null), ids: data.ids ?? null, legacy: 'refs' in data })
}

export interface Liveness {
    dangling(kind: RefKind, ref: UseRef | undefined): boolean
    taken(kind: RefKind, name: string): boolean
}

export function liveness(data: CosmeticData, external: ReferenceTargets | null): Liveness {
    const lists = targetLists(data, external)
    const ids = new Map<RefKind, Set<string>>()
    const names = new Map<RefKind, Set<string>>()
    for (const [kind, list] of Object.entries(lists) as Array<[RefKind, readonly Named[]]>) {
        ids.set(kind, new Set(list.map((item) => item.uuid)))
        names.set(kind, new Set(list.map((item) => item.name)))
    }
    return {
        dangling: (kind, ref) => {
            const live = ids.get(kind)
            return !!ref && !!live && !live.has(ref.id)
        },
        taken: (kind, name) => !!names.get(kind)?.has(name),
    }
}

export function danglingUses(data: CosmeticData, external: ReferenceTargets | null): ReferenceUse[] {
    const live = liveness(data, external)
    return usesOf(data).filter((item) => item.name && live.dangling(item.kind, item.ref))
}

const WORDS: Record<RefKind, { verb: string, noun: string, again: string, other: string }> = {
    animations: { verb: 'plays', noun: 'animation', again: 'pick it again', other: 'pick another animation or remove it' },
    controllers: { verb: 'run', noun: 'controller', again: 'tick it again', other: 'untick it' },
    colorways: { verb: 'uses the colorway', noun: 'colorway', again: 'pick it again', other: 'pick another colorway' },
    effects: { verb: 'plays the effect', noun: 'effect', again: 'pick it again', other: 'pick another effect' },
}

export function referenceIssues(data: CosmeticData, external: ReferenceTargets | null): EngineIssue[] {
    const live = liveness(data, external)
    const seen = new Set<string>()
    const issues: EngineIssue[] = []
    for (const item of danglingUses(data, external)) {
        const key = `${item.kind}|${item.path}|${item.name}`
        if (seen.has(key)) continue
        seen.add(key)
        const words = WORDS[item.kind]
        const message = live.taken(item.kind, item.name)
            ? `${words.verb} '${item.name}', which was deleted. Another ${words.noun} has that name now, so ${words.again} to use that one`
            : `${words.verb} '${item.name}', which was deleted. To export, ${words.other}`
        issues.push({ path: `manifest.json#${item.path}`, code: 'reference_deleted', level: 'error', values: {}, names: { name: item.name }, message })
    }
    return issues
}

const STALE_VALUE = '\u0001deleted\u0001'

export interface RefPick {
    name: string
    ref?: UseRef
    stale: boolean
}

export interface StaleChoice {
    value: string
    label: string
}

export function pickOf(live: Liveness, kind: RefKind, name: string, ref: UseRef | undefined): RefPick {
    return { name, ...(ref ? { ref } : {}), stale: !!name && live.dangling(kind, ref) }
}

export function staleLabel(name: string): string {
    return `${name} (deleted)`
}

export function staleChoice(pick: RefPick): StaleChoice | null {
    return pick.stale ? { value: `${STALE_VALUE}${pick.name}`, label: staleLabel(pick.name) } : null
}

export function shownPick(pick: RefPick): string {
    return staleChoice(pick)?.value ?? pick.name
}

export function savedPick(value: string, pick: RefPick): { name: string, ref?: UseRef } {
    if (value === shownPick(pick)) return { name: pick.name, ...(pick.ref ? { ref: pick.ref } : {}) }
    return { name: value.startsWith(STALE_VALUE) ? value.slice(STALE_VALUE.length) : value }
}

function named(items: readonly any[]): Named[] {
    return items.filter((item) => typeof item?.uuid === 'string' && item.uuid && typeof item.name === 'string').map((item) => ({ uuid: item.uuid, name: item.name }))
}

export function projectTargets(): ReferenceTargets | null {
    const animations: any[] | undefined = typeof Animator !== 'undefined' ? Animator.animations : undefined
    const controllers: any[] | undefined = typeof AnimationController !== 'undefined' ? (AnimationController as any).all : undefined
    if (!Array.isArray(animations) && !Array.isArray(controllers)) return null
    return { animations: named(animations ?? []), controllers: named(controllers ?? []) }
}

export function projectLiveness(data: CosmeticData): Liveness {
    return liveness(data, projectTargets())
}

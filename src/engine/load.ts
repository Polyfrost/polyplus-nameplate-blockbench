import {
    DETAIL_FULL,
    DETAIL_MINIMAL,
    DETAIL_REDUCED,
    MOTION_FULL,
    MOTION_OFF,
    MOTION_REDUCED,
    NameplateAsset,
    NameplateEngine,
    OUT,
    RasterOptions,
    RawAnalysis,
    RawIssue,
    RawMeta,
    RawOneShot,
    RawRaster,
    SIGNALS,
} from '@plusrenderer/renderer/nameplate.js'
import { blockRow, lineBlock, NameplateBlock } from './block'
import { NameplateLayer } from './draw'
import { forgetGlPreview, fullReplay, placeholderSource, rememberJob, replayedTag } from './gl'
import { describe, EngineIssue, issuesOf } from './issues'
import { identityOf, wearerSeed } from './seed'
import { currentEngine, engineFailure } from './wasm'
import { deflateZip } from '../util/zip'
import { blendOf, MaterialGraph } from '../material/types'

export type BundleBinary = Record<string, Uint8Array>

export type LoadMode = 'client' | 'authoring'

export type NameplateDetail = 'full' | 'reduced' | 'minimal'

export type NameplateMotion = 'full' | 'reduced' | 'off'

export interface NameplateView {
    detail?: NameplateDetail
    motion?: NameplateMotion
}

export type NameplateLook = NameplateDetail | NameplateView

export interface TexturePixels {
    width: number
    height: number
    rgba: Uint8Array
}

export interface NameplateTagState {
    reactions: string[]
    oneShots: string[]
    starts: Int32Array
    held?: number
    heldBy?: Readonly<Record<string, number>>
    endedBy?: Readonly<Record<string, readonly [number, number]>>
    stoppedBy?: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>
    speedShots?: ReadonlyArray<readonly [string, number]>
    retired?: ReadonlyArray<readonly [string, number, number]>
    observedFor?: number
    values?: Readonly<Record<string, number>>
}

export interface OneShotTiming {
    length: number
    tail: number
    appear: number | null
}

export interface NameplateBadgePose {
    dx: number
    dy: number
    opacity: number
    visible: boolean
}

export const STILL_BADGE: NameplateBadgePose = Object.freeze({ dx: 0, dy: 0, opacity: 255, visible: true })

export interface NameplateRecord {
    update(key: string, variant: string, frame: number, reactions: string[], timeMs: number, seed?: number): NameplateTagState
    prime(key: string, variant: string, frame: number, reactions: string[], seen: boolean): void
    fire(key: string, animation: string, frame: number): boolean
    clear(): void
}

export interface NameplateEffectCost {
    layer: string
    material: string
    states: number
    shotStates: number
}

export interface NameplateLayerCost {
    id: string
    states: number
    margin: number | null
}

export interface NameplateFallbackCost {
    id: string
    material: string
    frames: number
    bytes: number
    animatedBytes: number
    frameBytes: number
    still: boolean
    rebuildMs?: number
    drift: boolean
    shotStates: number
}

export interface NameplateCost {
    quads: number
    cacheBytes: number
    cpu: number
    states: number
    totalStates: number
    margin: number | null
    layers: NameplateLayerCost[]
    flash: string | null
    flashChecked: boolean
    flashTimes: number | null
    flashPixels: number | null
    issues: EngineIssue[]
    warnings: EngineIssue[]
    infos: EngineIssue[]
    materialBuildOps: number | null
    fallbacks: NameplateFallbackCost[]
    fallbackBytes: number
    textCpu: number
    effects: NameplateEffectCost[]
}

export interface NameplateLimits {
    quads: number
    cacheBytes: number
    fallbackBytes: number
    cpu: number
    margin: number
    states: number
    flashes: number
    flashArea: number
}

export interface MaterialLimits {
    maxCost: number
    outlineFactor: number
    toneCost: number
    maxNodes: number
    maxSamples: number
    maxInputs: number
    maxRepeat: number
    maxOctaves: number
    maxMargin: number
}

export interface NameplateEffectInfo {
    layer: string
    material: string
    reads: string[]
    animated: string[]
    states: number
    shotStates: number
    toneSlots: number | null
}

export interface NameplateLetters {
    mode: string
    count: number
    moving: boolean
    dx: Int32Array
    dy: Int32Array
    opacity: Int32Array
    color: Int32Array
    shadow: Int32Array
    outline: Int32Array
    scale: Float64Array
    rotation: Int32Array
}

export interface NameplatePreview {
    id: string
    fps: number
    loop: number
    variants: string[]
    reactions: string[]
    levels: string[]
    oneShots: string[]
    asset: NameplateAsset
    meta: RawMeta
    ownsBackground(variant: string): boolean
    paint(variant: string, block: NameplateBlock, frame: number, seed: number, state?: NameplateTagState | null, look?: NameplateLook): NameplateLayer[]
    badgePose(frame: number, seed: number, state?: NameplateTagState | null, look?: NameplateLook): NameplateBadgePose
    platePose(variant: string, block: NameplateBlock, frame: number, seed: number, state?: NameplateTagState | null, look?: NameplateLook): NameplateBadgePose
    badgeFollow(variant: string, block: NameplateBlock, frame: number, seed: number, state?: NameplateTagState | null, look?: NameplateLook): NameplateBadgePose
    badgeSpot(variant: string, block: NameplateBlock): [number, number] | null
    analysis(): RawAnalysis
    cost(flash: boolean): NameplateCost
    readonly version: number
    check(issues: EngineIssue[]): void
    record(): NameplateRecord
    shotTiming(name: string): OneShotTiming
    hasMaterials: boolean
    textures(): TexturePixels[]
    letters?(variant: string, block: NameplateBlock, frame: number, seed: number, glyphX: Int32Array, glyphWidth: Int32Array, state?: NameplateTagState | null, look?: NameplateLook): NameplateLetters | null
    movesLetters(): boolean
    effects(): NameplateEffectInfo[]
    paramCurve(layer: string, param: string, variant: string, from: number, count: number, state?: NameplateTagState | null): number[]
    readonly disposed: boolean
    dispose(): void
}

export interface LoadedBundle {
    preview: NameplatePreview | null
    skipped: string | null
    issues: EngineIssue[]
    warnings: EngineIssue[]
    measure?: (flash: boolean) => NameplateCost | null
    draft?: () => NameplatePreview | null
    dispose?: () => void
}

const REACTION_SIGNALS: Readonly<Record<string, string>> = Object.freeze({
    sneaking: 'is_sneaking',
    sprinting: 'is_sprinting',
    hurt: 'is_hurt',
    on_fire: 'is_on_fire',
    swimming: 'is_swimming',
    gliding: 'is_gliding',
    riding: 'is_riding',
    sleeping: 'is_sleeping',
    emote: 'is_emoting',
})

const SIGNAL_REACTIONS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.entries(REACTION_SIGNALS).map(([name, signal]) => [signal, name])))

export function reactionSignal(reaction: string): string {
    return REACTION_SIGNALS[reaction] ?? reaction
}

export function signalReaction(signal: string): string {
    return SIGNAL_REACTIONS[signal] ?? signal
}

const TIME_SUFFIX = '_time'
const QUERY = /\b(?:q|query)\.([a-z_][a-z0-9_]*)/gi

export function isToggleSignal(signal: string): boolean {
    return signal.startsWith('is_')
}

function signalOfQuery(name: string): string | null {
    if (SIGNALS.includes(name)) return name
    if (!name.endsWith(TIME_SUFFIX)) return null
    const base = name.slice(0, -TIME_SUFFIX.length)
    return SIGNALS.includes(base) && isToggleSignal(base) ? base : null
}

function collectStrings(value: unknown, out: string[]) {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) for (const item of value) collectStrings(item, out)
    else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
            out.push(key)
            collectStrings(item, out)
        }
    }
}

export function programSignals(files: Readonly<Record<string, string>>): string[] {
    const found = new Set<string>()
    for (const [path, text] of Object.entries(files)) {
        if (!path.toLowerCase().endsWith('.json')) continue
        let parsed: unknown
        try {
            parsed = JSON.parse(text)
        } catch {
            continue
        }
        const strings: string[] = []
        collectStrings(parsed, strings)
        for (const source of strings) {
            for (const match of source.matchAll(QUERY)) {
                const signal = signalOfQuery(match[1].toLowerCase())
                if (signal) found.add(signal)
            }
        }
    }
    return SIGNALS.filter((signal) => found.has(signal))
}

const MANIFEST = 'manifest.json'
const REQUIRES_PATH = `${MANIFEST}#requires`
export const BUDGET_ISSUE_CODES: ReadonlySet<string> = new Set(['over_cpu', 'quads_over_budget', 'over_cache', 'over_margin', 'over_states', 'over_fallback', 'flash', 'flash_unchecked'])
const PAINT_CACHE = 48

interface ManifestFacts {
    reads: string[]
    lengths: Map<string, number>
    masks: Map<string, string>
    materials: Map<string, string>
    additive: Set<string>
    tails: Map<string, number>
    appear: Map<string, number>
    swaps: Map<string, Map<string, string>>
    speed: Set<string>
    speedTargets: Map<string, string[]>
    bursts: Map<string, number[]>
    emitters: Set<string>
    parents: Map<string, string>
}

const APPEAR_SECONDS = 5
const APPEAR_CAP = 30
const MAX_SHOT_SLOTS = 8
const UNSEEN_SLACK_MS = 1
const KEEP_EPISODES = 16
const KEEP_SECONDS = 600

function speedTargets(tracks: unknown): string[] {
    if (!tracks || typeof tracks !== 'object') return []
    return Object.entries(tracks as Record<string, unknown>).filter(([, channels]) => Array.isArray((channels as { speed?: unknown } | null)?.speed)).map(([target]) => target)
}

function burstFrames(tracks: unknown): number[] {
    if (!tracks || typeof tracks !== 'object') return []
    const frames: number[] = []
    for (const channels of Object.values(tracks as Record<string, unknown>)) {
        const bursts = (channels as { burst?: unknown } | null)?.burst
        if (!Array.isArray(bursts)) continue
        for (const burst of bursts) {
            const at = Array.isArray(burst) ? Number(burst[0]) : NaN
            if (Number.isFinite(at)) frames.push(Math.trunc(at))
        }
    }
    return frames.sort((a, b) => a - b)
}

function lastLife(layer: Record<string, unknown> | null): number {
    const lifetime = layer?.lifetime
    if (!Array.isArray(lifetime)) return 1
    const most = Number(lifetime[1])
    return Number.isFinite(most) && most >= 1 ? Math.trunc(most) : 1
}

function burstTail(tracks: unknown, lives: Map<string, number>): number {
    if (!tracks || typeof tracks !== 'object') return 0
    let tail = 0
    for (const [target, channels] of Object.entries(tracks as Record<string, unknown>)) {
        const life = lives.get(target)
        const bursts = (channels as { burst?: unknown } | null)?.burst
        if (life === undefined || !Array.isArray(bursts)) continue
        const frames = bursts.map((burst) => Array.isArray(burst) ? Number(burst[0]) : NaN).filter(Number.isFinite)
        if (frames.length) tail = Math.max(tail, Math.trunc(Math.max(...frames)) + life + 1)
    }
    return tail
}

function appearSeconds(trigger: unknown): number | null {
    if (trigger === 'appear') return APPEAR_SECONDS
    const seconds = (trigger as { appear?: unknown } | null)?.appear
    if (trigger && typeof trigger === 'object' && typeof seconds === 'number' && Number.isFinite(seconds)) return Math.max(1, Math.min(APPEAR_CAP, Math.trunc(seconds)))
    return null
}

const LAYER_FILE = /^layers\/([^/#]+)\.json/

function parsedManifest(text: string | undefined): Record<string, unknown> | null {
    if (typeof text !== 'string') return null
    try {
        const value = JSON.parse(text)
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null
    } catch {
        return null
    }
}

function manifestFacts(manifest: Record<string, unknown> | null, files: Record<string, string>): ManifestFacts {
    const lengths = new Map<string, number>()
    const masks = new Map<string, string>()
    const materials = new Map<string, string>()
    const additive = new Set<string>()
    const tails = new Map<string, number>()
    const appear = new Map<string, number>()
    const speed = new Set<string>()
    const speedOf = new Map<string, string[]>()
    const bursts = new Map<string, number[]>()
    const emitters = new Set<string>()
    const parents = new Map<string, string>()
    const lives = new Map<string, number>()
    for (const [path, text] of Object.entries(files)) {
        const id = LAYER_FILE.exec(path)?.[1]
        const layer = id ? parsedManifest(text) : null
        if (id && typeof layer?.of === 'string') parents.set(id, layer.of)
        if (id && layer?.kind === 'emitter') {
            lives.set(id, lastLife(layer))
            emitters.add(id)
        }
        if (!id || layer?.kind !== 'material' || typeof layer.material !== 'string') continue
        materials.set(id, layer.material)
        if (blendOf(parsedManifest(files[`materials/${layer.material}.json`]) as MaterialGraph | null ?? undefined) === 'additive') additive.add(id)
    }
    const animations = manifest?.animations
    if (animations && typeof animations === 'object') {
        for (const [name, animation] of Object.entries(animations as Record<string, unknown>)) {
            const spec = animation as { length?: unknown, tracks?: unknown, trigger?: unknown } | null
            const length = spec?.length
            if (typeof length === 'number' && length > 0) lengths.set(name, Math.round(length))
            const tail = burstTail(spec?.tracks, lives)
            if (tail > 0) tails.set(name, tail)
            const seconds = appearSeconds(spec?.trigger)
            if (seconds !== null) appear.set(name, seconds)
            const targets = speedTargets(spec?.tracks)
            if (targets.length) {
                speed.add(name)
                speedOf.set(name, targets)
            }
            const frames = burstFrames(spec?.tracks)
            if (frames.length) bursts.set(name, frames)
        }
    }
    if (Array.isArray(manifest?.layers)) {
        for (const entry of manifest!.layers as Array<Record<string, unknown>>) {
            if (entry && typeof entry.id === 'string' && typeof entry.mask === 'string') masks.set(entry.id, entry.mask)
        }
    }
    const swaps = new Map<string, Map<string, string>>()
    const variants = manifest?.variants
    if (variants && typeof variants === 'object' && !Array.isArray(variants)) {
        for (const [key, variant] of Object.entries(variants as Record<string, unknown>)) {
            const swap = (variant as { swap?: unknown } | null)?.swap
            if (!swap || typeof swap !== 'object' || Array.isArray(swap)) continue
            const map = new Map<string, string>()
            for (const [from, to] of Object.entries(swap as Record<string, unknown>)) if (typeof to === 'string') map.set(from, to)
            if (map.size) swaps.set(key, map)
        }
    }
    return { reads: programSignals(files), lengths, masks, materials, additive, tails, appear, swaps, speed, speedTargets: speedOf, bursts, emitters, parents }
}

export function engineManifest(manifest: Record<string, unknown>): Record<string, unknown> {
    const { requires: _requires, kind: _kind, format, ...rest } = manifest
    return { format: format ?? 1, kind: 'nameplate', ...rest }
}

function engineFiles(files: Record<string, string>, binary: BundleBinary): Record<string, string | Uint8Array> {
    const input: Record<string, string | Uint8Array> = { ...files, ...binary }
    const manifest = parsedManifest(files[MANIFEST])
    if (manifest) input[MANIFEST] = JSON.stringify(engineManifest(manifest))
    return input
}

function managedRequires(issue: EngineIssue): boolean {
    return issue.code === 'manifest' && issue.path === REQUIRES_PATH && typeof issue.names?.capability === 'string'
}

function skipText(meta: RawMeta): string | null {
    const skip = meta.skip
    if (!skip) return null
    if (skip.requires?.length) return `it needs ${skip.requires.join(', ')}, which this version of the game doesn't have`
    if (typeof skip.format === 'number') return `it uses bundle format ${skip.format}, which this version of the game can't read`
    return 'the game would skip it'
}

const assets = typeof FinalizationRegistry === 'undefined' ? null : new FinalizationRegistry<NameplateAsset>((asset) => {
    try {
        asset.free()
    } catch {
        return
    }
})

const RELEASED = 'This preview was released. Load the nameplate again.'
const holds = new WeakMap<NameplatePreview, number>()

export function previewOfLoad(loaded: LoadedBundle | null | undefined): NameplatePreview | null {
    if (!loaded) return null
    return loaded.preview ?? loaded.draft?.() ?? null
}

export function holdPreview(preview: NameplatePreview | null | undefined) {
    if (!preview || preview.disposed) return
    holds.set(preview, (holds.get(preview) ?? 0) + 1)
}

export function releasePreview(preview: NameplatePreview | null | undefined) {
    if (!preview) return
    const left = (holds.get(preview) ?? 0) - 1
    if (left > 0) {
        holds.set(preview, left)
        return
    }
    holds.delete(preview)
    preview.dispose()
}

export function previewHolds(preview: NameplatePreview): number {
    return holds.get(preview) ?? 0
}

export function disposeUnheld(preview: NameplatePreview | null | undefined) {
    if (preview && !holds.has(preview)) preview.dispose()
}

export function disposeLoad(loaded: LoadedBundle | null | undefined) {
    disposeUnheld(previewOfLoad(loaded))
}

export class PreviewSlot {
    private held: NameplatePreview | null = null

    get current(): NameplatePreview | null {
        return this.held
    }

    set(next: NameplatePreview | LoadedBundle | null | undefined) {
        const preview = next && 'paint' in next ? next as NameplatePreview : previewOfLoad(next as LoadedBundle | null | undefined)
        if (preview === this.held) return
        holdPreview(preview)
        const old = this.held
        this.held = preview && !preview.disposed ? preview : null
        releasePreview(old)
    }

    clear() {
        this.set(null)
    }
}

interface LayerCut {
    x: number
    y: number
    width: number
    height: number
    rgba: Uint8ClampedArray
    passes: readonly Uint8ClampedArray[]
}

function emptyCut(): LayerCut {
    const rgba = new Uint8ClampedArray(0)
    return { x: 0, y: 0, width: 0, height: 0, rgba, passes: [] }
}

function trimmed(width: number, height: number, data: Uint8ClampedArray, passes: readonly Uint8ClampedArray[] = [data]): LayerCut | null {
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    for (const image of new Set([data, ...passes])) {
        for (let y = 0; y < height; y++) {
            const row = y * width * 4
            for (let x = 0; x < width; x++) {
                if (image[row + x * 4 + 3] === 0) continue
                if (x < x0) x0 = x
                if (x > x1) x1 = x
                if (y < y0) y0 = y
                if (y > y1) y1 = y
            }
        }
    }
    if (x1 < 0) return null
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    const cuts = new Map<Uint8ClampedArray, Uint8ClampedArray>()
    const cut = (image: Uint8ClampedArray): Uint8ClampedArray => {
        const known = cuts.get(image)
        if (known) return known
        let out = image
        if (w !== width || h !== height) {
            out = new Uint8ClampedArray(w * h * 4)
            for (let y = 0; y < h; y++) out.set(image.subarray(((y + y0) * width + x0) * 4, ((y + y0) * width + x0 + w) * 4), y * w * 4)
        }
        cuts.set(image, out)
        return out
    }
    return { x: x0, y: y0, width: w, height: h, rgba: cut(data), passes: (passes.length ? passes : [data]).map(cut) }
}

function oneShotTriggers(meta: RawMeta): RawOneShot[] {
    return meta.animations?.one_shots ?? []
}

function reactionNames(meta: RawMeta, reads: readonly string[]): string[] {
    const names: string[] = []
    const add = (signal: string | null | undefined) => {
        if (!signal) return
        const name = signalReaction(signal)
        if (!names.includes(name)) names.push(name)
    }
    for (const reaction of meta.animations?.reactions ?? []) add(reaction.signal)
    for (const shot of oneShotTriggers(meta)) if (shot.trigger === 'start' || shot.trigger === 'stop') add(shot.signal)
    for (const signal of reads) if (isToggleSignal(signal)) add(signal)
    return names
}

interface ShotRun {
    name: string
    at: number
    until?: number
}

interface SpeedRun {
    name: string
    at: number
    until?: number
}

interface RecordEntry {
    seen: boolean
    lastSeen: number | null
    variant: string | null
    reactions: Set<string>
    since: Map<string, number>
    ended: Map<string, Array<[number, number]>>
    slots: Array<ShotRun | null>
    tails: Map<string, ShotRun>
    observedAt: number | null
    speedRuns: SpeedRun[]
}

function createRecord(meta: RawMeta, facts: ManifestFacts): NameplateRecord {
    const entries = new Map<string, RecordEntry>()
    const shots = oneShotTriggers(meta)
    const loop = Math.max(1, meta.loop_frames ?? 1)
    const keepFrames = KEEP_SECONDS * Math.max(1, meta.fps ?? 1)
    const speedSignals = new Set((meta.animations?.reactions ?? []).filter((reaction) => reaction.signal && facts.speed.has(reaction.name)).map((reaction) => reaction.signal!))
    const lengthOf = (name: string) => facts.lengths.get(name) ?? loop
    const tailOf = (name: string) => facts.tails.get(name) ?? 0
    const indexOf = (name: string) => shots.findIndex((shot) => shot.name === name)
    const slotCount = Math.min(MAX_SHOT_SLOTS, shots.length)
    const prune = (entry: RecordEntry, frame: number) => {
        entry.slots.forEach((run, slot) => {
            if (!run || (frame - run.at >= 0 && frame - run.at < lengthOf(run.name))) return
            retire(entry, run, frame)
            entry.slots[slot] = null
        })
        for (const [name, run] of entry.tails) if (!(frame - run.at >= 0 && frame - run.at < tailOf(name))) entry.tails.delete(name)
        for (const [signal, list] of entry.ended) {
            const held = entry.since.has(signal)
            const kept = list.filter(([, off], at) => (!held && at === list.length - 1) || frame - off <= keepFrames)
            if (kept.length) entry.ended.set(signal, kept)
            else entry.ended.delete(signal)
        }
        entry.speedRuns = entry.speedRuns.filter((run) => frame - run.at <= keepFrames + lengthOf(run.name))
    }
    const endEpisode = (entry: RecordEntry, signal: string, on: number, off: number) => {
        const list = speedSignals.has(signal) ? entry.ended.get(signal) ?? [] : []
        list.push([on, off])
        entry.ended.set(signal, list.slice(-KEEP_EPISODES))
    }
    const keepSpeed = (entry: RecordEntry, name: string, frame: number) => {
        if (!facts.speed.has(name)) return
        entry.speedRuns.push({ name, at: frame })
        const own = entry.speedRuns.filter((run) => run.name === name)
        if (own.length > KEEP_EPISODES) entry.speedRuns.splice(entry.speedRuns.indexOf(own[0]), 1)
    }
    const observe = (entry: RecordEntry, frame: number) => {
        entry.observedAt = entry.observedAt === null ? frame : Math.min(entry.observedAt, frame)
    }
    const oldest = (entry: RecordEntry): number => {
        let best = 0
        const rank = (slot: number): [number, number] => {
            const run = entry.slots[slot]
            return run ? [run.at, indexOf(run.name)] : [-Infinity, -1]
        }
        for (let slot = 1; slot < entry.slots.length; slot++) {
            const [at, index] = rank(slot)
            const [bestAt, bestIndex] = rank(best)
            if (at < bestAt || (at === bestAt && index < bestIndex)) best = slot
        }
        return best
    }
    const retire = (entry: RecordEntry, run: ShotRun | null, frame: number) => {
        if (!run) return
        const age = frame - run.at
        const cut = age < lengthOf(run.name)
        if (age >= 0 && age < tailOf(run.name)) entry.tails.set(run.name, { name: run.name, at: run.at, ...(cut ? { until: frame } : {}) })
        if (!cut) return
        const speedRun = entry.speedRuns.find((kept) => kept.name === run.name && kept.at === run.at)
        if (speedRun) speedRun.until ??= frame
    }
    const start = (entry: RecordEntry, shot: RawOneShot, frame: number): boolean => {
        if (!place(entry, shot, frame)) return false
        keepSpeed(entry, shot.name, frame)
        return true
    }
    const place = (entry: RecordEntry, shot: RawOneShot, frame: number): boolean => {
        if (!entry.slots.length) return false
        const main = entry.slots.findIndex((run) => run?.name === shot.name)
        if (main >= 0) {
            const run = entry.slots[main]!
            if (frame - run.at < lengthOf(shot.name) && !shot.restart) return false
            retire(entry, run, frame)
            entry.slots[main] = { name: shot.name, at: frame }
            return true
        }
        const free = entry.slots.indexOf(null)
        const slot = free >= 0 ? free : oldest(entry)
        retire(entry, entry.slots[slot], frame)
        entry.slots[slot] = { name: shot.name, at: frame }
        return true
    }
    const entryOf = (key: string): RecordEntry => {
        let entry = entries.get(key)
        if (!entry) {
            entry = { seen: false, lastSeen: null, variant: null, reactions: new Set(), since: new Map(), ended: new Map(), slots: new Array(slotCount).fill(null), tails: new Map(), observedAt: null, speedRuns: [] }
            entries.set(key, entry)
        }
        return entry
    }
    const stateNow = (entry: RecordEntry, frame: number, reactions: string[]): NameplateTagState => {
        const playing = [...entry.slots.filter((run): run is ShotRun => run !== null), ...entry.tails.values()]
        const heldBy: Record<string, number> = {}
        for (const [signal, at] of entry.since) heldBy[signal] = Math.max(0, frame - at)
        const held = Object.values(heldBy)
        const endedBy: Record<string, [number, number]> = {}
        const stoppedBy: Record<string, Array<[number, number]>> = {}
        for (const [signal, list] of entry.ended) {
            const ago = list.map(([on, off]): [number, number] => [Math.max(0, frame - on), Math.max(0, frame - off)])
            if (!ago.length) continue
            stoppedBy[signal] = ago
            if (!entry.since.has(signal)) endedBy[signal] = ago[ago.length - 1]
        }
        const speedRuns = entry.speedRuns.filter((run) => !playing.some((shown) => shown.name === run.name && shown.at === run.at))
        const speedShots = speedRuns.map((run): [string, number] => [run.name, run.at])
        const retired = [...playing, ...speedRuns]
            .filter((run) => run.until !== undefined)
            .map((run): [string, number, number] => [run.name, run.at, run.until!])
        return {
            reactions: reactions.slice(),
            oneShots: playing.map((run) => run.name),
            starts: Int32Array.from(playing.map((run) => run.at)),
            held: held.length ? Math.max(...held) : undefined,
            heldBy,
            ...(Object.keys(endedBy).length ? { endedBy } : {}),
            ...(Object.keys(stoppedBy).length ? { stoppedBy } : {}),
            ...(speedShots.length ? { speedShots } : {}),
            ...(retired.length ? { retired } : {}),
            ...(entry.observedAt !== null ? { observedFor: Math.max(0, frame - entry.observedAt) } : {}),
        }
    }
    return {
        update(key, variant, frame, reactions, timeMs) {
            const entry = entryOf(key)
            prune(entry, frame)
            const now = new Set(reactions.map(reactionSignal))
            const first = !entry.seen
            const unseen = !first && entry.lastSeen !== null && Number.isFinite(timeMs) ? timeMs - entry.lastSeen : null
            const equipped = !first && entry.variant !== null && entry.variant !== variant
            for (const shot of shots) {
                let go = false
                if (shot.trigger === 'appear') go = first || (unseen !== null && unseen + UNSEEN_SLACK_MS >= (facts.appear.get(shot.name) ?? APPEAR_SECONDS) * 1000)
                else if (shot.trigger === 'equip') go = equipped
                else if (shot.signal) {
                    const was = entry.reactions.has(shot.signal)
                    const is = now.has(shot.signal)
                    go = (shot.trigger === 'start' && is && !was) || (shot.trigger === 'stop' && was && !is)
                }
                if (go) start(entry, shot, frame)
            }
            entry.seen = true
            observe(entry, frame)
            if (Number.isFinite(timeMs)) entry.lastSeen = timeMs
            entry.variant = variant
            for (const [signal, on] of Array.from(entry.since)) {
                if (now.has(signal)) continue
                entry.since.delete(signal)
                endEpisode(entry, signal, on, frame)
            }
            for (const signal of now) {
                if (entry.since.has(signal)) continue
                entry.since.set(signal, frame)
                if (!speedSignals.has(signal)) entry.ended.delete(signal)
            }
            entry.reactions = now
            return stateNow(entry, frame, reactions)
        },
        prime(key, variant, frame, reactions, seen) {
            const entry = entryOf(key)
            if (entry.seen) return
            entry.seen = seen
            entry.variant = variant
            entry.reactions = new Set(reactions.map(reactionSignal))
            entry.since = new Map(Array.from(entry.reactions, (signal) => [signal, frame]))
            entry.ended = new Map()
            observe(entry, frame)
        },
        fire(key, animation, frame) {
            const shot = shots.find((entry) => entry.name === animation)
            if (!shot) return false
            const entry = entryOf(key)
            prune(entry, frame)
            return start(entry, shot, frame)
        },
        clear() {
            entries.clear()
        },
    }
}

export function stateOf(reactions: string[], _reduced = false, values: Readonly<Record<string, number>> = {}): NameplateTagState {
    const state: NameplateTagState = { reactions: reactions.slice(), oneShots: [], starts: new Int32Array(0) }
    return Object.keys(values).length ? { ...state, values: { ...values } } : state
}

const DETAILS: Readonly<Record<NameplateDetail, number>> = Object.freeze({ full: DETAIL_FULL, reduced: DETAIL_REDUCED, minimal: DETAIL_MINIMAL })
const MOTIONS: Readonly<Record<NameplateMotion, number>> = Object.freeze({ full: MOTION_FULL, reduced: MOTION_REDUCED, off: MOTION_OFF })
const ALL_LAYERS = 0xffffffff

interface ViewCodes {
    detail: number
    motion: number
}

function viewCodes(look: NameplateLook | undefined): ViewCodes {
    const view: NameplateView = typeof look === 'string' ? { detail: look } : look ?? {}
    return { detail: DETAILS[view.detail ?? 'full'] ?? DETAIL_FULL, motion: MOTIONS[view.motion ?? 'full'] ?? MOTION_FULL }
}

export function stoppedEpisodes(state: NameplateTagState | null | undefined): Record<string, ReadonlyArray<readonly [number, number]>> {
    if (state?.stoppedBy) return { ...state.stoppedBy }
    return Object.fromEntries(Object.entries(state?.endedBy ?? {}).map(([signal, episode]) => [signal, [episode]]))
}

function signalSlot(signal: string): number {
    const index = SIGNALS.indexOf(signal)
    return index >= 0 && index < 32 ? index : -1
}

type RunDrop = (name: string, start: number) => boolean

interface RetiredDrops {
    visual: RunDrop | null
    particles: RunDrop | null
    coupled: Set<string>
}

function retiredDrops(facts: ManifestFacts, frame: number, state: NameplateTagState | null | undefined): RetiredDrops | null {
    const retired = (state?.retired ?? []).filter(([, , until]) => until <= frame)
    if (!retired.length) return null
    const late = retired.filter(([name, start, until]) => (facts.bursts.get(name) ?? []).some((step) => start + step >= until && start + step <= frame))
    const dropping = (runs: typeof retired): RunDrop | null => (runs.length ? (name, start) => runs.some(([n, s]) => n === name && s === start) : null)
    const targets = new Set(retired.flatMap(([name]) => facts.speedTargets.get(name) ?? []))
    const coupled = new Set<string>()
    const moved = (id: string, seen = new Set<string>()): boolean => {
        if (targets.has(id)) return true
        const parent = facts.parents.get(id)
        if (parent === undefined || seen.has(id)) return false
        seen.add(id)
        return moved(parent, seen)
    }
    for (const id of [...facts.parents.keys(), ...targets]) if (moved(id)) coupled.add(id)
    const global = Array.from(targets).some((target) => target.startsWith('$'))
    return { visual: global ? null : dropping(retired), particles: dropping(late), coupled }
}

function stateOptions(meta: RawMeta, frame: number, state: NameplateTagState | null | undefined, drop: RunDrop | null = null): Pick<RasterOptions, 'reactions' | 'heldFor' | 'oneShots' | 'stopped' | 'observedFor'> {
    if (!state) return {}
    const on = [...state.reactions.map(reactionSignal), ...Object.entries(state.values ?? {}).filter(([, value]) => value !== 0).map(([signal]) => signal)]
    const reactions = Array.from(new Set(on)).filter((signal) => signalSlot(signal) >= 0)
    const shots = oneShotTriggers(meta)
    const oneShots: Array<[number, number]> = []
    const addShot = (name: string, start: number) => {
        if (drop?.(name, start)) return
        const index = shots.findIndex((shot) => shot.name === name)
        if (index >= 0) oneShots.push([index, Math.max(0, frame - start)])
    }
    state.oneShots.forEach((name, at) => addShot(name, state.starts[at] ?? 0))
    for (const [name, start] of state.speedShots ?? []) addShot(name, start)
    const heldFor = state.held ?? null
    const stopped: Array<[number, number, number]> = []
    for (const [signal, episodes] of Object.entries(stoppedEpisodes(state))) {
        const index = signalSlot(signal)
        if (index < 0) continue
        const held = reactions.includes(signal)
        for (const [onFor, offFor] of episodes) {
            if (!(offFor >= 0) || (held && heldFor !== null && offFor < heldFor)) continue
            stopped.push([index, Number.isFinite(onFor) ? Math.max(0, onFor - offFor) : 0, offFor])
        }
    }
    return { reactions, heldFor, oneShots, stopped, observedFor: state.observedFor ?? null }
}

function stateKey(state: NameplateTagState | null | undefined, frame: number): string {
    if (!state) return ''
    const heldBy = Object.entries(state.heldBy ?? {}).map(([signal, held]) => `${signal}:${held}`).join('+')
    const stopped = Object.entries(stoppedEpisodes(state)).map(([signal, episodes]) => `${signal}:${episodes.map(([on, off]) => `${on}-${off}`).join(',')}`).join('+')
    const speed = (state.speedShots ?? []).map(([name, start]) => `${name}@${frame - start}`).join('+')
    const retired = (state.retired ?? []).map(([name, start, until]) => `${name}@${frame - start}-${frame - until}`).join('+')
    const values = Object.entries(state.values ?? {}).map(([signal, value]) => `${signal}=${value}`).join('+')
    return `${state.reactions.join('+')}/${state.oneShots.map((name, at) => `${name}@${frame - (state.starts[at] ?? 0)}`).join('+')}/${state.held ?? ''}/${heldBy}/${stopped}/${speed}/${retired}/${state.observedFor ?? ''}/${values}`
}

function glyphFloats(glyphX: ArrayLike<number>, glyphWidth: ArrayLike<number>): Float32Array {
    const floats = new Float32Array(glyphX.length * 2)
    for (let at = 0; at < glyphX.length; at++) {
        floats[at * 2] = glyphX[at]
        floats[at * 2 + 1] = glyphWidth[at] ?? 0
    }
    return floats
}

function costOf(analysis: RawAnalysis, issues: EngineIssue[], effects: NameplateEffectInfo[], checked: boolean): NameplateCost {
    const states = analysis.layers.map((layer) => layer.states)
    const flash = issues.find((issue) => issue.code === 'flash') ?? null
    const margins = analysis.layers.map((layer) => layer.margin)
    for (const issue of issues) {
        const px = issue.code === 'over_margin' ? issue.values?.px : undefined
        if (typeof px === 'number') margins.push(px)
    }
    return {
        quads: analysis.quads,
        cacheBytes: analysis.image_bytes,
        cpu: analysis.cpu_units,
        states: states.length ? Math.max(...states) : 0,
        totalStates: states.reduce((sum, value) => sum + value, 0),
        margin: margins.length ? Math.max(...margins) : 0,
        layers: analysis.layers.map((layer) => ({ id: layer.id, states: layer.states, margin: layer.margin })),
        flash: flash ? flash.path : null,
        flashChecked: checked,
        flashTimes: flash?.values?.flashes ?? null,
        flashPixels: flash?.values?.px ?? null,
        issues: issues.filter((issue) => issue.level === 'error' && BUDGET_ISSUE_CODES.has(issue.code ?? '')),
        warnings: issues.filter((issue) => issue.level === 'warning'),
        infos: issues.filter((issue) => issue.level === 'info'),
        materialBuildOps: analysis.material_build_ops,
        fallbacks: [],
        fallbackBytes: analysis.fallback_bytes,
        textCpu: 0,
        effects: effects.map(({ layer, material, states, shotStates }) => ({ layer, material, states, shotStates })),
    }
}

interface RasterPose {
    plate: NameplateBadgePose
    badge: { x: number, y: number, opacity: number } | null
    textMode: RawRaster['textMode']
    letters: RawRaster['letters']
}

const POSE_CACHE = 96
const PROBE_GLYPHS = glyphFloats([0, 6, 12, 18], [6, 6, 6, 6])
const PROBE_BLOCK = lineBlock(24, 0, 24)

function poseOf(raster: Omit<RawRaster, 'data'>): RasterPose {
    return {
        plate: Object.freeze({ dx: raster.plate[0], dy: raster.plate[1], opacity: 255, visible: true }),
        badge: raster.badge,
        textMode: raster.textMode,
        letters: raster.letters,
    }
}

const TEXT_MODES: ReadonlyArray<RawRaster['textMode']> = ['vanilla', 'motion', 'owned']

export function framePose(out: Int32Array): RasterPose | null {
    const dir = OUT.OUT_HEADER
    if (out.length < dir + OUT.DIR_WORDS) return null
    const at = out[dir + OUT.DIR_OFFSET]
    const len = out[dir + OUT.DIR_LEN]
    if (out[dir + OUT.DIR_STATUS] !== OUT.STATUS_OK || len < OUT.TAG_HEAD || at + len > out.length) return null
    const textAt = at + OUT.TAG_HEAD + out[at + OUT.HEAD_OPS] * OUT.OP_WORDS + out[at + OUT.HEAD_MATERIAL_WORDS]
    const lettersAt = textAt + OUT.TEXT_FIXED
    const letters: RawRaster['letters'] = []
    for (let i = 0; i < out[textAt + OUT.TEXT_LETTER_COUNT]; i++) {
        const letter = lettersAt + i * OUT.LETTER_WORDS
        const packed = out[letter + OUT.LETTER_SCALE_ROT]
        letters.push({
            dx: out[letter + OUT.LETTER_DX],
            dy: out[letter + OUT.LETTER_DY],
            color: out[letter + OUT.LETTER_ARGB] >>> 0,
            shadow: out[letter + OUT.LETTER_SHADOW] >>> 0,
            opacity: out[letter + OUT.LETTER_OPACITY],
            scale: (packed & 0xff) / 4,
            rotation: packed >> 8,
            outline: out[letter + OUT.LETTER_OUTLINE] >>> 0,
        })
    }
    const badgeAt = at + len - out[at + OUT.HEAD_EVENTS] * OUT.EVENT_WORDS - OUT.BADGE_WORDS
    return {
        plate: Object.freeze({ dx: out[at + OUT.HEAD_PLATE_DX], dy: out[at + OUT.HEAD_PLATE_DY], opacity: 255, visible: true }),
        badge: { x: out[badgeAt + OUT.BADGE_X], y: out[badgeAt + OUT.BADGE_Y], opacity: out[badgeAt + OUT.BADGE_OPACITY] },
        textMode: TEXT_MODES[out[at + OUT.HEAD_TEXT_MODE]] ?? 'vanilla',
        letters,
    }
}

function lettersOf(pose: RasterPose): NameplateLetters | null {
    if (pose.textMode === 'vanilla' || !pose.letters.length) return null
    const letters = pose.letters
    const ints = (pick: (letter: RawRaster['letters'][number]) => number) => Int32Array.from(letters.map(pick))
    return {
        mode: pose.textMode,
        count: letters.length,
        moving: true,
        dx: ints((letter) => letter.dx),
        dy: ints((letter) => letter.dy),
        opacity: ints((letter) => letter.opacity),
        color: ints((letter) => letter.color | 0),
        shadow: ints((letter) => letter.shadow | 0),
        outline: ints((letter) => letter.outline | 0),
        scale: Float64Array.from(letters.map((letter) => letter.scale)),
        rotation: ints((letter) => letter.rotation),
    }
}

function issueKey(issue: EngineIssue): string {
    return JSON.stringify([issue.code ?? '', issue.path, issue.level ?? '', issue.values ?? {}, issue.names ?? {}])
}

function wrapPreview(asset: NameplateAsset, loaded: EngineIssue[], facts: ManifestFacts, mode: LoadMode): NameplatePreview {
    let issues = loaded
    let disposed = false
    const live = (): NameplateAsset => {
        if (disposed) throw new Error(RELEASED)
        return asset
    }
    let checked = mode === 'authoring'
    let version = 0
    const meta = asset.meta
    const identity = identityOf(meta.identity)
    const variants = (meta.variants ?? []).map((variant) => variant.key)
    const layers = meta.layers ?? []
    const byId = new Map(layers.map((layer) => [layer.id, layer]))
    let analysis: RawAnalysis | null = null
    let textures: TexturePixels[] | null = null
    let moves: boolean | null = null
    let effects: NameplateEffectInfo[] | null = null
    const cache = new Map<string, NameplateLayer[]>()
    const poses = new Map<string, RasterPose>()
    const variantIndex = (variant: string) => Math.max(0, variants.indexOf(variant))
    const analyzed = (): RawAnalysis => (analysis ??= live().analyze())
    const quadsOf = (id: string) => analyzed().layers.find((layer) => layer.id === id)?.quads ?? 0

    const optionsOf = (frame: number, seed: number, state: NameplateTagState | null | undefined, look: NameplateLook | undefined): RasterOptions => {
        const codes = viewCodes(look)
        return { seed: wearerSeed(seed, identity), ...stateOptions(meta, frame, state), detail: codes.detail, motion: codes.motion }
    }

    const poseKey = (row: Int32Array, at: number, seed: number, state: NameplateTagState | null | undefined, codes: { detail: number, motion: number }, glyphs: Float32Array | null, replay: boolean) =>
        `${row.join(',')}|${at}|${seed}|${stateKey(state, at)}|${codes.detail}|${codes.motion}|${glyphs ? glyphs.join(',') : ''}|${replay ? 'full' : 'basic'}`

    const remember = (key: string, pose: RasterPose) => {
        poses.set(key, pose)
        while (poses.size > POSE_CACHE) poses.delete(poses.keys().next().value as string)
    }

    const posed = (variant: string, block: NameplateBlock, frame: number, seed: number, state: NameplateTagState | null | undefined, look: NameplateLook | undefined, glyphs: Float32Array | null): RasterPose => {
        const at = Math.max(0, Math.trunc(frame))
        const row = blockRow(block, 0, variantIndex(variant))
        const codes = viewCodes(look)
        const replay = !!state && fullReplay()
        const key = poseKey(row, at, seed, state, codes, glyphs, replay)
        const known = poses.get(key)
        if (known) return known
        const replayed = replay ? replayedTag({ preview, block, variant: variantIndex(variant), frame: at, seed, state: state ?? null, detail: codes.detail, motion: codes.motion }, glyphs) : null
        let pose = replayed ? framePose(replayed) : null
        if (!pose) {
            const options: RasterOptions = { ...optionsOf(at, seed, state, look), hidden: ALL_LAYERS }
            if (glyphs) options.glyphs = glyphs
            pose = poseOf(live().raster(row, at, options))
        }
        remember(key, pose)
        return pose
    }

    const restBadge = (variant: string, block: NameplateBlock): { x: number, y: number } | null => {
        const rest = posed(variant, block, 0, 0, null, { motion: 'off' }, null)
        return rest.badge ? { x: rest.badge.x - rest.plate.dx, y: rest.badge.y - rest.plate.dy } : null
    }

    const paint = (variant: string, block: NameplateBlock, frame: number, seed: number, state?: NameplateTagState | null, look?: NameplateLook): NameplateLayer[] => {
        const at = Math.max(0, Math.trunc(frame))
        const row = blockRow(block, 0, variantIndex(variant))
        const codes = viewCodes(look)
        const key = `${row.join(',')}|${at}|${seed}|${stateKey(state, at)}|${codes.detail}|${codes.motion}`
        const cached = cache.get(key)
        if (cached) return cached
        const options = optionsOf(at, seed, state, look)
        const swap = facts.swaps.get(variants[variantIndex(variant)] ?? '')
        const image = live().rasterLayers(row, at, options)
        if (!(state && fullReplay())) remember(poseKey(row, at, seed, state, codes, null, false), poseOf(image))
        const drops = retiredDrops(facts, at, state)
        const passes = new Map<RunDrop, typeof image>()
        const sourceOf = (ids: readonly string[]): typeof image => {
            if (!drops) return image
            const drop = ids.some((id) => facts.emitters.has(id)) ? drops.particles : ids.some((id) => drops.coupled.has(id)) ? null : drops.visual
            if (!drop) return image
            let pass = passes.get(drop)
            if (!pass) {
                pass = live().rasterLayers(row, at, { ...options, ...stateOptions(meta, at, state, drop) })
                passes.set(drop, pass)
            }
            return pass
        }
        const out: NameplateLayer[] = []
        for (const layer of layers) {
            const shown = byId.get(swap?.get(layer.id) ?? layer.id) ?? layer
            const mask = facts.masks.get(shown.id) ?? null
            const source = sourceOf([layer.id, shown.id])
            const own = source.layers.find((entry) => entry.slot === layer.slot)
            const additive = own ? own.blend === 'additive' : facts.additive.has(shown.id)
            const cut = (own && trimmed(source.width, source.height, own.data, own.passes ?? [own.data])) || emptyCut()
            out.push(Object.freeze({
                index: layer.slot,
                layer: layer.id,
                depth: shown.depth,
                x: 0,
                y: 0,
                mirrorX: false,
                width: cut.width,
                opacity: 255,
                left: source.origin[0] + cut.x + block.shiftX,
                top: source.origin[1] + cut.y + block.shiftY,
                rasterWidth: cut.width,
                rasterHeight: cut.height,
                rgba: cut.rgba,
                passes: Object.freeze(cut.passes.slice()),
                blend: additive ? 'additive' : 'normal',
                quads: quadsOf(shown.id),
                mask,
            }))
        }
        rememberJob({ preview, block, variant: variantIndex(variant), frame: at, seed, state: state ?? null, detail: codes.detail, motion: codes.motion, layers: out })
        cache.set(key, out)
        while (cache.size > PAINT_CACHE) cache.delete(cache.keys().next().value as string)
        return out
    }

    const preview: NameplatePreview = {
        id: meta.id ?? '',
        fps: meta.fps ?? 1,
        loop: meta.loop_frames ?? 1,
        variants,
        reactions: reactionNames(meta, facts.reads),
        levels: facts.reads.filter((signal) => !isToggleSignal(signal)),
        oneShots: oneShotTriggers(meta).map((shot) => shot.name),
        asset,
        meta,
        ownsBackground: (variant) => meta.variants?.[variantIndex(variant)]?.owns_background === true,
        paint,
        badgePose: () => STILL_BADGE,
        platePose: (variant, block, frame, seed, state, look) => posed(variant, block, frame, seed, state, look, null).plate,
        badgeFollow(variant, block, frame, seed, state, look) {
            const rest = restBadge(variant, block)
            if (!rest) return STILL_BADGE
            const now = posed(variant, block, frame, seed, state, look, null)
            if (!now.badge) return { dx: 0, dy: 0, opacity: 0, visible: false }
            return { dx: now.badge.x - rest.x - now.plate.dx, dy: now.badge.y - rest.y - now.plate.dy, opacity: now.badge.opacity, visible: now.badge.opacity > 0 }
        },
        badgeSpot(variant, block) {
            const rest = restBadge(variant, block)
            return rest ? [rest.x + block.shiftX, rest.y + block.shiftY] : null
        },
        letters: (variant, block, frame, seed, glyphX, glyphWidth, state, look) => lettersOf(posed(variant, block, frame, seed, state, look, glyphFloats(glyphX, glyphWidth))),
        analysis: analyzed,
        cost: () => costOf(analyzed(), issues, preview.effects(), checked),
        get version() {
            return version
        },
        check(found) {
            const seen = new Set(found.map(issueKey))
            issues = [...found, ...loaded.filter((issue) => !seen.has(issueKey(issue)))]
            checked = true
            version++
        },
        record: () => createRecord(meta, facts),
        shotTiming: (name) => ({
            length: facts.lengths.get(name) ?? Math.max(1, meta.loop_frames ?? 1),
            tail: facts.tails.get(name) ?? 0,
            appear: facts.appear.get(name) ?? (oneShotTriggers(meta).some((shot) => shot.name === name && shot.trigger === 'appear') ? APPEAR_SECONDS : null),
        }),
        hasMaterials: layers.some((layer) => layer.content === 'material'),
        textures: () => (textures ??= live().textures()),
        movesLetters() {
            if (moves === null) {
                moves = variants.some((variant) => {
                    const pose = posed(variant, PROBE_BLOCK, 0, 0, null, undefined, PROBE_GLYPHS)
                    return pose.textMode !== 'vanilla' && pose.letters.length > 0
                })
            }
            return moves
        },
        effects: () => (effects ??= analyzed().effects.map((effect) => ({
            layer: effect.layer,
            material: facts.materials.get(effect.layer) ?? '',
            reads: effect.reads,
            animated: [],
            states: effect.states,
            shotStates: effect.shot_states,
            toneSlots: effect.tone_slots,
        }))),
        paramCurve: (layer, param, variant, _from, count) => live().paramCurve(layer, param, variant, count),
        get disposed() {
            return disposed
        },
        dispose() {
            if (disposed) return
            disposed = true
            assets?.unregister(preview)
            cache.clear()
            poses.clear()
            textures = null
            try {
                forgetGlPreview(preview)
            } finally {
                asset.free()
            }
        },
    }
    assets?.register(preview, asset, preview)
    return preview
}

function engineMissing(): LoadedBundle {
    const failure = engineFailure()
    const message = failure ? `The nameplate engine failed to start: ${describe(failure)}` : 'The nameplate engine is still starting.'
    return { preview: null, skipped: null, issues: [{ path: '', message }], warnings: [] }
}

let binarySource: (() => BundleBinary) | null = null

export function setBinarySource(source: (() => BundleBinary) | null) {
    binarySource = source
}

export function currentBinary(): BundleBinary {
    try {
        return binarySource?.() ?? {}
    } catch (error) {
        console.error('[polyplus_nameplate] reading bundle textures failed', error)
        return {}
    }
}

const GAME_DIALECTS = ['core_330', 'core_330_ubo', 'legacy_150', 'compat_130', 'es_300']
const fedTextures = new WeakMap<NameplateEngine, Set<string>>()

function feedStandIns(engine: NameplateEngine, asset: NameplateAsset) {
    const source = placeholderSource()
    if (!source || !(asset.meta.layers ?? []).some((layer) => layer.content === 'material')) return
    let fed = fedTextures.get(engine)
    if (!fed) fedTextures.set(engine, (fed = new Set()))
    try {
        for (const shader of asset.shaders('es_300').shaders) {
            for (const sampler of shader.samplers) {
                const texture = sampler.texture
                if (texture.kind === 'bundle' || fed.has(texture.name)) continue
                const art = source(texture.kind, texture.name)
                engine.setRasterTexture(texture.name, art.width, art.height, art.rgba)
                fed.add(texture.name)
            }
        }
    } catch (error) {
        console.error('[polyplus_nameplate] preparing stand-in game textures failed', error)
    }
}

function dialectIssues(asset: NameplateAsset, known: EngineIssue[]): EngineIssue[] {
    if (!(asset.meta.layers ?? []).some((layer) => layer.content === 'material')) return []
    const seen = new Set(known.map((issue) => `${issue.code}|${issue.path}|${issue.names?.node ?? ''}`))
    const raw: RawIssue[] = []
    for (const dialect of GAME_DIALECTS) {
        try {
            for (const issue of asset.dialectIssues(dialect).issues) {
                const key = `${issue.code}|${issue.path}|${issue.names?.node ?? ''}`
                if (seen.has(key)) continue
                seen.add(key)
                raw.push(issue)
            }
        } catch (error) {
            console.error(`[polyplus_nameplate] checking shader support for ${dialect} failed`, error)
        }
    }
    return issuesOf(raw)
}

export function authoringInput(files: Record<string, string>, binary: BundleBinary = currentBinary()): Uint8Array {
    return deflateZip(engineFiles(files, binary))
}

export function authoringIssues(raw: ArrayLike<RawIssue>): EngineIssue[] {
    return issuesOf(raw).filter((issue) => !managedRequires(issue))
}

export function loadBundle(files: Record<string, string>, binary: BundleBinary = currentBinary(), mode: LoadMode = 'authoring'): LoadedBundle {
    const engine = currentEngine()
    if (!engine) return engineMissing()
    let asset: NameplateAsset
    try {
        asset = engine.loadSync(authoringInput(files, binary), { mode })
    } catch (error) {
        return { preview: null, skipped: null, issues: [{ path: '', message: describe(error) }], warnings: [] }
    }
    const loaded = authoringIssues(asset.issues)
    const all = asset.usable ? [...loaded, ...dialectIssues(asset, loaded)] : loaded
    const issues = all.filter((issue) => issue.level !== 'warning' && issue.level !== 'info')
    const warnings = all.filter((issue) => issue.level === 'warning' || issue.level === 'info')
    const skipped = skipText(asset.meta)
    if (!asset.usable) {
        asset.free()
        return { preview: null, skipped, issues, warnings }
    }
    feedStandIns(engine, asset)
    const facts = manifestFacts(parsedManifest(files[MANIFEST]), files)
    const preview = wrapPreview(asset, all, facts, mode)
    const dispose = () => preview.dispose()
    if (!issues.length) return { preview, skipped, issues, warnings, dispose }
    return {
        preview: null,
        skipped,
        issues,
        warnings,
        measure: () => preview.cost(false),
        draft: () => preview,
        dispose,
    }
}

export function analysisOf(loaded: LoadedBundle): RawAnalysis | null {
    const preview = loaded.preview ?? loaded.draft?.() ?? null
    if (!preview) return null
    try {
        return preview.analysis()
    } catch (error) {
        console.error('[polyplus_nameplate] analysing the nameplate failed', error)
        return null
    }
}

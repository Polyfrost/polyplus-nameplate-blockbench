import { BlockbenchInterpolation, blockbenchInterpolations, readBack } from '../animate/interpolation'
import { isReaction, isReactionMode, isReducedMode, MAX_APPEAR_SECONDS } from '../animate/props'
import { describe } from '../engine'
import { DEFAULT_FPS, DEFAULT_LOOP_FRAMES, defaultNameplate } from '../format'
import { BADGE_TARGET, CAPABILITIES, Channel, LOOP_ANIMATION, NAME_MASK, NameplateData, PaletteTrackData, PER_PLAYER_PHASE, PLATE_TARGET, ReducedMode, ScheduleData, Slot, TriggerData, VariantData } from '../model'
import { ExtraData, ExtraPatch, PathStep } from './extra'
import { FLAGS, MANIFEST, PALETTES, SOURCE } from './files'
import { expandRamp, parseHex, parseSlotRef } from './ramp'
import { importFlags } from '../flags/compile'
import { takePaletteAnimation } from '../palanim/import'
import type { FlagsState } from '../flags/types'
import { pathProps } from '../kinds/path'
import { emitterProps } from '../kinds/emitter'
import { fileSpriteIds, isBurstTrack, MotionSpeedPlan, planSpriteIds, takeBurstTracks } from '../motion/import'
import { SPEED_CHANNEL } from '../motion/types'
import type { BurstKey } from '../motion/types'
import { importReactionPalette } from '../palanim/reaction'
import { isMaterialFilePath, planMaterials } from '../material/import'
import { effectProps } from '../kinds/effect'
import { importParamKeys, isParamChannel } from '../material/params'
import type { MaterialsState } from '../material/types'
import { groupBreakpointPlan, GroupBreakpoint } from '../library/groups'
import { editableKeyValue, importKeyValue } from '../molang/keys'
import type { KeyMolang } from '../molang/keys'
import { takeSlotMolang } from '../molang/slots'
import type { SlotMolang } from '../molang/slots'
import { importPlateStyle, importVariantStyle } from '../text/compile'
import { importLetterTrack, LetterTrack, TEXT_TARGET } from '../text/reaction'
import { bodyProps } from '../kinds/body'
import { spriteProps } from '../kinds/sprite'
import { finiteNumbers } from '../params/values'
import { attachBlends } from '../palette/blend'
import { REPORT_FILE } from '../checks/report'
import { segmentLayerId, segmentSpriteId } from '../util/bundlePath'
import { cloneJson, isRecord } from '../util/json'

const DEFAULT_COLORWAY = 'default'
const PALETTE_TRACK = 'palette.'
const LAYER_CHANNELS: Record<string, Channel[]> = {
    body: ['position', 'opacity', 'visible'],
    sprite: ['frame', 'position', 'opacity', 'visible'],
    group: ['position', 'opacity', 'visible'],
    path: ['frame', 'position', 'opacity', 'visible'],
    emitter: ['position', 'opacity', 'visible'],
    material: ['position', 'opacity', 'visible'],
    badge: ['position', 'opacity', 'visible'],
    plate: ['position'],
}
const STEP_ONLY = new Set<string>(['frame', 'visible'])
const MANIFEST_KEYS = new Set(['text', 'badge', 'format', 'id', 'requires', 'fps', 'loop', 'ownsBackground', 'layers', 'variants', 'groups', 'animations', 'params'])
const MANIFEST_LABELS: Record<string, string> = {
    params: 'Shared numbers',
    text: 'Text settings',
    badge: 'Badge settings',
    phase: 'Per-player start',
}
const LAYER_ENTRY_KEYS = new Set(['id', 'depth', 'step', 'mask', 'clip'])
const VARIANT_KEYS = new Set(['text', 'badge', 'palette', 'hide', 'swap', 'ownsBackground', 'flag'])
const VARIANT_LABELS: Record<string, string> = {
    flag: 'Flag',
    text: 'Text settings',
    badge: 'Badge settings',
    params: 'Shared numbers',
}
const GROUP_KEYS = new Set(['id', 'parent', 'layers', 'breakpoints'])
const PALETTE_KEYS = new Set(['slots', 'colorways'])
const SLOT_KEYS = new Set(['id', 'name', 'ramp', 'interpolate'])
const SPRITE_FILE_KEYS = new Set(['colors', 'rows', 'frames'])
const ANIMATION_KEYS = new Set(['schedule', 'trigger', 'length', 'tracks', 'restart', 'reduced'])
const SCHEDULE_KEYS = new Set(['window', 'jitter', 'chance', 'id', 'weight'])
const DEFAULT_APPEAR = 5
const REPRESENTED_REQUIRES = new Set<string>(CAPABILITIES)

export type Json = any

export interface Bundle {
    manifest: Json
    palettes: Json
    layers: Record<string, Json>
    sprites: Record<string, Json>
    flags: Json | null
    others: Record<string, string>
    unreadable: string[]
}

export interface TexturePlan {
    id: string
    width: number
    frameHeight: number
    frames: number
    rgba: Uint8ClampedArray
    used: boolean
}

export interface GroupPlan {
    kind: 'group'
    id: string
    children: NodePlan[]
    breakpoints?: GroupBreakpoint[]
}

export interface LayerPlan {
    kind: 'body' | 'sprite' | 'path' | 'emitter' | 'material'
    id: string
    props: Record<string, unknown>
    of: string | null
    sprite: string | null
    pool?: string[]
    breakpointSprites?: Array<string | null>
    speedKeys?: MotionSpeedPlan[]
    bursts?: BurstKey[]
    mask?: string | null
    timeline?: Json
}

export type NodePlan = GroupPlan | LayerPlan

export interface KeyPlan {
    step: number
    value: number | [number, number] | boolean
    molang?: KeyMolang
    interpolation: BlockbenchInterpolation
}

export interface TrackPlan {
    target: string
    channel: Channel
    keys: KeyPlan[]
}

export interface AnimationPlan {
    name: string
    trigger: TriggerData | null
    schedule: ScheduleData | null
    length: number
    restart: boolean
    tracks: TrackPlan[]
    bursts: Array<{ target: string, keys: BurstKey[] }>
    speeds: Array<{ target: string, keys: KeyPlan[] }>
    palette: PaletteTrackData[]
    reduced: ReducedMode | null
    letters?: LetterTrack
}

export interface PaletteContext {
    slots: Slot[]
    interpolated: Set<string>
}

export interface ImportPlan {
    nameplate: NameplateData
    loop: number
    root: NodePlan[]
    textures: TexturePlan[]
    tracks: TrackPlan[]
    animations: AnimationPlan[]
    extra: ExtraData
    flags: FlagsState | null
    slotMolang?: SlotMolang
    materials?: MaterialsState
    kept: string[]
    changed: string[]
    dropped: string[]
}

function parseJson(files: Record<string, string>, path: string, errors: string[]): Json | undefined {
    if (!Object.prototype.hasOwnProperty.call(files, path)) return undefined
    try {
        return JSON.parse(files[path])
    } catch (error) {
        errors.push(`${path}: not valid JSON (${describe(error)})`)
        return undefined
    }
}

function framesOf(sprite: Json): string[][] | null {
    if (!isRecord(sprite)) return null
    if (Array.isArray(sprite.frames)) return sprite.frames
    if (Array.isArray(sprite.rows)) return [sprite.rows]
    return null
}

function usesFlags(manifest: Json, layers: Record<string, Json>): boolean {
    const variants = isRecord(manifest?.variants) ? Object.values(manifest.variants) : []
    if (variants.some((variant: any) => isRecord(variant) && typeof variant.flag === 'string')) return true
    return Object.values(layers).some((layer) => {
        if (!isRecord(layer) || layer.kind !== 'body') return false
        const fills = [layer.fill, ...(Array.isArray(layer.rings) ? layer.rings : [])]
        return fills.some((fill) => isRecord(fill) && fill.flag === true)
    })
}

export function bundleFileList(files: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [path, text] of Object.entries(files)) {
        if (path === MANIFEST || path === PALETTES || path === FLAGS) result[path] = text
        else if (/^(layers|sprites|materials)\/[^/]+\.json$/.test(path)) result[path] = text
    }
    return result
}

export function missingFiles(files: Record<string, string>): string[] {
    const errors: string[] = []
    const manifest = parseJson(files, MANIFEST, errors)
    if (!isRecord(manifest)) return [MANIFEST]
    const missing: string[] = []
    if (!(PALETTES in files)) missing.push(PALETTES)
    const layers: Record<string, Json> = {}
    for (const entry of Array.isArray(manifest.layers) ? manifest.layers : []) {
        if (!isRecord(entry) || typeof entry.id !== 'string') continue
        const path = `layers/${entry.id}.json`
        if (!(path in files)) {
            missing.push(path)
            continue
        }
        const layer = parseJson(files, path, errors)
        layers[entry.id] = layer
        for (const id of fileSpriteIds(layer)) {
            const sprite = `sprites/${id}.json`
            if (!(sprite in files) && !missing.includes(sprite)) missing.push(sprite)
        }
    }
    if (usesFlags(manifest, layers) && !(FLAGS in files)) missing.push(FLAGS)
    return missing
}

export function parseBundle(files: Record<string, string>): { bundle: Bundle | null, errors: string[] } {
    const errors: string[] = []
    const manifest = parseJson(files, MANIFEST, errors)
    const palettes = parseJson(files, PALETTES, errors)
    if (!isRecord(manifest) || !isRecord(palettes) || errors.length > 0) {
        return { bundle: null, errors: errors.length > 0 ? errors : [`${MANIFEST} or ${PALETTES} is not an object`] }
    }
    const layers: Record<string, Json> = {}
    const sprites: Record<string, Json> = {}
    const others: Record<string, string> = {}
    const unreadable: string[] = []
    for (const path of Object.keys(files)) {
        const layer = segmentLayerId(path)
        const sprite = segmentSpriteId(path)
        if (layer === null && sprite === null) {
            if (path !== MANIFEST && path !== PALETTES && path !== FLAGS) others[path] = files[path]
            continue
        }
        const value = parseJson(files, path, unreadable)
        if (value === undefined) continue
        if (layer !== null) layers[layer] = value
        else if (sprite !== null) sprites[sprite] = value
    }
    const flags = FLAGS in files ? parseJson(files, FLAGS, unreadable) : undefined
    return { bundle: { manifest, palettes, layers, sprites, flags: flags ?? null, others, unreadable }, errors }
}

class Recorder {
    patches: ExtraPatch[] = []
    kept: string[] = []
    changed: string[] = []
    dropped: string[] = []

    keep(file: string, path: PathStep[], value: unknown, label: string, create = true, mode: 'set' | 'union' = 'set') {
        this.patches.push({ file, path, value: cloneJson(value ?? null), mode, create, label })
        if (!this.kept.includes(label)) this.kept.push(label)
    }

    change(note: string) {
        if (!this.changed.includes(note)) this.changed.push(note)
    }
}

interface PaletteInfo {
    slots: Slot[]
    colorways: Record<string, Record<string, string[]>>
    tone(colorway: string | null, slot: string, tone: number): number | null
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readPalette(bundle: Bundle, record: Recorder): PaletteInfo {
    const palettes = bundle.palettes
    for (const key of Object.keys(palettes)) {
        if (!PALETTE_KEYS.has(key)) record.keep(PALETTES, [key], palettes[key], `${PALETTES}: ${key}`)
    }
    const tones = new Map<string, number>()
    const engineRamps = new Map<string, string[]>()
    const slots: Slot[] = []
    for (const raw of Array.isArray(palettes.slots) ? palettes.slots : []) {
        const id = String(raw.id)
        const stops = stringList(raw.ramp)
        const interpolate = Number.isInteger(raw.interpolate) ? (raw.interpolate as number) : 0
        tones.set(id, interpolate)
        engineRamps.set(id, expandRamp(stops, interpolate))
        for (const key of Object.keys(raw)) {
            if (!SLOT_KEYS.has(key)) record.keep(PALETTES, ['slots', { id }, key], raw[key], `Color ${id}: ${key}`, false)
        }
        slots.push({ id, name: typeof raw.name === 'string' ? raw.name : id, ramp: stops })
    }
    const colorways: Record<string, Record<string, string[]>> = {}
    const engineColorways: Record<string, Record<string, string[]>> = {}
    const rawColorways = isRecord(palettes.colorways) ? palettes.colorways : {}
    for (const name of Object.keys(rawColorways)) {
        const overrides: Record<string, string[]> = {}
        const engine: Record<string, string[]> = {}
        const raw = isRecord(rawColorways[name]) ? rawColorways[name] : {}
        for (const slot of Object.keys(raw)) {
            const stops = stringList(raw[slot])
            const expanded = expandRamp(stops, tones.get(slot) ?? 0)
            overrides[slot] = stops
            engine[slot] = expanded
        }
        colorways[name] = overrides
        engineColorways[name] = engine
    }
    attachBlends(slots, colorways, palettes.slots, rawColorways)
    if (Object.keys(colorways).length === 0) {
        colorways[DEFAULT_COLORWAY] = {}
        engineColorways[DEFAULT_COLORWAY] = {}
    }
    return {
        slots,
        colorways,
        tone(colorway, slot, tone) {
            const ramp = (colorway ? engineColorways[colorway]?.[slot] : undefined) ?? engineRamps.get(slot)
            const text = ramp?.[tone]
            return text === undefined ? null : parseHex(text)
        },
    }
}

function readVariants(manifest: Json, colorways: Record<string, unknown>, record: Recorder): Record<string, VariantData> {
    const variants: Record<string, VariantData> = {}
    const raw = isRecord(manifest.variants) ? manifest.variants : {}
    for (const key of Object.keys(raw)) {
        const spec = raw[key]
        const variant: VariantData = {
            palette: String(spec.palette),
            hide: stringList(spec.hide),
            swap: {},
        }
        if (isRecord(spec.swap)) {
            for (const layer of Object.keys(spec.swap)) {
                if (typeof spec.swap[layer] === 'string') variant.swap[layer] = spec.swap[layer]
            }
        }
        if (typeof spec.ownsBackground === 'boolean') variant.ownsBackground = spec.ownsBackground
        const params = spec.params === undefined || spec.params === null ? null : finiteNumbers(spec.params)
        if (params && Object.keys(params).length > 0) variant.params = params
        Object.assign(variant, importVariantStyle(spec, key, (steps, value, label) => record.keep(MANIFEST, ['variants', key, ...steps], value, label), (note) => record.change(note)))
        for (const field of Object.keys(spec)) {
            if (VARIANT_KEYS.has(field) || (field === 'params' && params)) continue
            const label = `${VARIANT_LABELS[field] ?? field} on variant ${key}`
            record.keep(MANIFEST, ['variants', key, field], spec[field], label, false)
        }
        variants[key] = variant
    }
    if (Object.keys(variants).length === 0) {
        variants[DEFAULT_COLORWAY] = { palette: Object.keys(colorways)[0] ?? DEFAULT_COLORWAY, hide: [], swap: {} }
    }
    return variants
}

function layerPlan(id: string, entry: Json, file: Json, record: Recorder): LayerPlan {
    const path = `layers/${id}.json`
    const depth = typeof entry.depth === 'string' ? entry.depth : 'background'
    const step = Number.isInteger(entry.step) ? entry.step : 1
    const keep = (steps: PathStep[], value: unknown, label: string) => record.keep(path, steps, value, label, false)
    const present = (key: string) => file[key] !== undefined && file[key] !== null
    const keepField = (key: string, label = `${path}: ${key}`) => keep([key], file[key], label)
    const keepUnknown = (known: Set<string>, extra?: string) => {
        for (const key of Object.keys(file)) {
            if (!known.has(key) && key !== extra) keepField(key)
        }
    }
    const material = effectProps(id, entry, file, { keep })
    if (material) return material
    if (file.kind === 'body') {
        return { kind: 'body', id, of: null, sprite: null, props: { name: id, depth, step, ...bodyProps(id, file, { keep, keepField, keepUnknown, present }) } }
    }
    const motionContext = { keep, change: (note: string) => record.change(note) }
    if (file.kind === 'emitter') return emitterProps(id, file, motionContext, { depth, step })
    if (file.kind === 'sprite' && isRecord(file.path)) return pathProps(id, file, motionContext, { depth, step })
    return spriteProps(id, file, { keep, keepField, keepUnknown, present }, { depth, step })
}

function buildTree(
    order: string[],
    layers: Map<string, LayerPlan>,
    groups: Json[],
    record: Recorder,
): NodePlan[] {
    const root: NodePlan[] = []
    const groupOf = new Map<string, string>()
    const parentOf = new Map<string, string | null>()
    const groupIds: string[] = []
    for (const group of groups) {
        if (!isRecord(group) || typeof group.id !== 'string' || parentOf.has(group.id)) continue
        groupIds.push(group.id)
        parentOf.set(group.id, typeof group.parent === 'string' ? group.parent : null)
        for (const layer of stringList(group.layers)) {
            if (!groupOf.has(layer)) groupOf.set(layer, group.id)
        }
    }
    const nodes = new Map<string, GroupPlan>()
    const ensure = (id: string, depth = 0): GroupPlan => {
        const existing = nodes.get(id)
        if (existing) return existing
        const node: GroupPlan = { kind: 'group', id, children: [], breakpoints: groupBreakpointPlan(groups, id) }
        nodes.set(id, node)
        const parent = parentOf.get(id) ?? null
        const container = parent && parentOf.has(parent) && depth < groupIds.length ? ensure(parent, depth + 1).children : root
        container.push(node)
        return node
    }
    for (const id of order.slice().reverse()) {
        const layer = layers.get(id)
        if (!layer) continue
        const group = groupOf.get(id)
        ;(group ? ensure(group).children : root).push(layer)
    }
    for (const id of groupIds) ensure(id)

    const walked: string[] = []
    const walk = (list: NodePlan[]) => {
        for (const node of list) {
            if (node.kind === 'group') walk(node.children)
            else walked.push(node.id)
        }
    }
    walk(root)
    const readBack = walked.reverse()
    if (readBack.join('\n') !== order.filter((id) => layers.has(id)).join('\n')) {
        record.change(`Layer order changed to keep each group's layers together: ${readBack.join(', ')} (back to front)`)
    }
    const layerIds = new Set(layers.keys())
    for (const id of groupIds) {
        if (layerIds.has(id)) record.change(`Group ${id} has the same id as a layer; Blockbench renames one of them on export`)
    }
    return root
}

function keyModes(raw: Json[]): string[] {
    return raw.map((key, index) => (index === 0 || key.length < 3 ? 'step' : String(key[2])))
}

function trackKeys(channel: Channel, raw: Json[], label: string, record: Recorder): KeyPlan[] {
    const modes = keyModes(raw)
    const interpolations = STEP_ONLY.has(channel) ? raw.map(() => 'step' as BlockbenchInterpolation) : blockbenchInterpolations(modes)
    for (let i = 1; i < raw.length && !STEP_ONLY.has(channel); i++) {
        const read = readBack(interpolations[i - 1], interpolations[i])
        if (read !== modes[i]) {
            record.change(
                `${label}: steps ${raw[i - 1][0]} to ${raw[i][0]} were ${modes[i]} and read back as ${read}; Blockbench curves a segment when either keyframe is bezier`,
            )
        }
    }
    return raw.map((key, index) => ({ step: Number(key[0]), ...importKeyValue(channel, key[1]), interpolation: interpolations[index] }))
}

function isWhole(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value)
}

function plainKeys(channel: Channel, keys: unknown): keys is Json[] {
    return Array.isArray(keys) && keys.every((key) =>
        Array.isArray(key) && (key.length === 2 || key.length === 3) && isWhole(key[0]) && editableKeyValue(channel, key[1]) &&
        (key.length === 2 || typeof key[2] === 'string'),
    )
}

function triggerOf(raw: unknown): TriggerData | string {
    if (raw === 'equip') return { kind: 'equip' }
    if (raw === 'appear') return { kind: 'appear', seconds: DEFAULT_APPEAR }
    if (!isRecord(raw)) return 'its trigger has a form the plugin doesn\'t know'
    const keys = Object.keys(raw)
    if ('appear' in raw) {
        if (keys.length !== 1 || !isWhole(raw.appear) || raw.appear < 1 || raw.appear > MAX_APPEAR_SECONDS) return 'its appear trigger has a form the plugin doesn\'t know'
        return { kind: 'appear', seconds: raw.appear }
    }
    if (keys.some((key) => key !== 'reaction' && key !== 'on')) return 'its trigger has fields the plugin doesn\'t know'
    if (!isReaction(raw.reaction)) return `reaction '${String(raw.reaction)}' is not one the plugin knows`
    if (!isReactionMode(raw.on)) return `'on: ${String(raw.on)}' is not while, start or stop`
    return { kind: 'reaction', reaction: raw.reaction, on: raw.on }
}

function scheduleOf(raw: unknown): ScheduleData | string {
    if (!isRecord(raw)) return 'its schedule is not an object'
    if (Object.keys(raw).some((key) => !SCHEDULE_KEYS.has(key))) return 'its schedule has fields the plugin doesn\'t know'
    if (!isWhole(raw.window)) return 'its schedule window is not a whole number'
    const jitter = raw.jitter ?? 0
    const chance = raw.chance ?? 1
    const weight = raw.weight ?? 1
    if (!isWhole(jitter) || typeof chance !== 'number' || !isWhole(weight)) return 'its schedule has values the plugin can\'t edit'
    if (raw.id !== undefined && raw.id !== null && typeof raw.id !== 'string') return 'its schedule id is not text'
    return { window: raw.window, jitter, chance, weight, id: typeof raw.id === 'string' ? raw.id : null }
}

function speedKeys(raw: unknown): Json[] | null {
    if (!Array.isArray(raw) || raw.length === 0) return null
    for (const key of raw) {
        if (!Array.isArray(key) || key.length < 2 || key.length > 3 || !isWhole(key[0]) || key[0] < 0) return null
        if (typeof key[1] !== 'number' || !isFinite(key[1])) return null
        if (key.length === 3 && !['step', 'linear', 'ease'].includes(key[2])) return null
    }
    return raw
}

interface ChannelFound {
    parsed: Array<{ target: string, channel: Channel, keys: Json[] }>
    bursts: Array<{ target: string, keys: BurstKey[] }>
    speedTracks: Array<{ target: string, keys: Json[] }>
    paramTracks: TrackPlan[]
}

interface ChannelTake {
    name: string
    kind: string
    target: string
    channel: string
    keys: unknown
    step: number
    record: Recorder
    found: ChannelFound
}

interface ChannelRule {
    applies(kind: string, channel: string, scheduled: boolean): boolean
    take(input: ChannelTake): string | null
}

const CHANNEL_RULES: ChannelRule[] = [
    {
        applies: (kind, channel) => isBurstTrack(kind, channel),
        take({ target, keys, step, found }) {
            const bursts = burstKeys(keys)
            if (!bursts) return `its burst track on '${target}' uses values the plugin can't edit`
            found.bursts.push({ target, keys: bursts.map((key) => ({ ...key, step: key.step * step })) })
            return null
        },
    },
    {
        applies: (kind, channel, scheduled) => !scheduled && kind === 'path' && channel === SPEED_CHANNEL,
        take({ target, keys, found }) {
            const speeds = speedKeys(keys)
            if (!speeds) return `its speed track on '${target}' uses values the plugin can't edit`
            found.speedTracks.push({ target, keys: speeds })
            return null
        },
    },
    {
        applies: (kind, channel, scheduled) => !scheduled && kind === 'material' && isParamChannel(channel),
        take({ name, target, channel, keys, record, found }) {
            const imported = importParamKeys(keys, `Animation '${name}': ${channel} on ${target}`)
            if (!imported) return `its ${channel} track on '${target}' uses values the plugin can't edit`
            imported.changes.forEach((note) => record.change(note))
            found.paramTracks.push({ target, channel: channel as Channel, keys: imported.keys })
            return null
        },
    },
    {
        applies: () => true,
        take({ kind, target, channel, keys, found }) {
            if (!(LAYER_CHANNELS[kind] as string[]).includes(channel)) return `its ${channel} track on '${target}' is not editable yet`
            if (!plainKeys(channel as Channel, keys)) return `its ${channel} track on '${target}' uses values the plugin can't edit (Molang or another form)`
            found.parsed.push({ target, channel: channel as Channel, keys })
            return null
        },
    },
]

function animationPlan(
    name: string,
    animation: Json,
    kinds: Map<string, string>,
    steps: Map<string, number>,
    loop: number,
    record: Recorder,
    colors: PaletteContext,
): AnimationPlan | string {
    if (!isRecord(animation)) return 'it is not an object'
    const unknown = Object.keys(animation).filter((key) => !ANIMATION_KEYS.has(key))
    if (unknown.length > 0) return `it has fields the plugin doesn't edit yet (${unknown.join(', ')})`
    const hasSchedule = animation.schedule !== undefined && animation.schedule !== null
    const hasTrigger = animation.trigger !== undefined && animation.trigger !== null
    if (hasSchedule === hasTrigger) return 'it needs exactly one of trigger or schedule'
    const schedule = hasSchedule ? scheduleOf(animation.schedule) : null
    if (typeof schedule === 'string') return schedule
    const trigger = hasTrigger ? triggerOf(animation.trigger) : null
    if (typeof trigger === 'string') return trigger
    if (animation.restart !== undefined && animation.restart !== null && typeof animation.restart !== 'boolean') return 'its restart is not true or false'
    const whileReaction = trigger?.kind === 'reaction' && trigger.on === 'while'
    if (!whileReaction && !isWhole(animation.length)) return 'its length is not a whole number'
    const hasReduced = animation.reduced !== undefined && animation.reduced !== null
    if (hasReduced && (!whileReaction || !isReducedMode(animation.reduced))) return `its reduced setting '${String(animation.reduced)}' is not one the plugin can edit`
    const length = whileReaction ? loop : Number(animation.length)
    const raw = animation.tracks === undefined ? {} : animation.tracks
    if (!isRecord(raw)) return 'its tracks are not an object'

    let step = 1
    if (schedule) {
        const layer = Object.keys(raw).find((target) => steps.has(target))
        if (layer) step = steps.get(layer) ?? 1
    }
    const found: ChannelFound = { parsed: [], bursts: [], speedTracks: [], paramTracks: [] }
    const { parsed, bursts, speedTracks, paramTracks } = found
    const palette: PaletteTrackData[] = []
    let letters: LetterTrack | undefined
    for (const target of Object.keys(raw)) {
        const kind = kinds.get(target)
        const channels = raw[target]
        if (target.startsWith(PALETTE_TRACK)) {
            if (schedule) return `it animates color ${target.slice(PALETTE_TRACK.length)}`
            const id = target.slice(PALETTE_TRACK.length)
            const motion = importReactionPalette(channels, colors.slots.find((slot) => slot.id === id), length)
            if (typeof motion === 'string') return motion
            palette.push({ slot: id, motion })
            continue
        }
        if (target === TEXT_TARGET) {
            if (schedule) return 'it moves the letters, which random animations can\'t do'
            const track = importLetterTrack(channels)
            if (typeof track === 'string') return track
            letters = track
            continue
        }
        if (schedule && target === BADGE_TARGET) return 'it moves the badge, which random animations can\'t do'
        if (!kind) return `it animates '${target}', which the plugin doesn't edit yet`
        if (!isRecord(channels)) return `its track on '${target}' is not an object`
        for (const channel of Object.keys(channels)) {
            const rule = CHANNEL_RULES.find((candidate) => candidate.applies(kind, channel, !!schedule))!
            const problem = rule.take({ name, kind, target, channel, keys: channels[channel], step, record, found })
            if (problem) return problem
        }
    }

    const label = `Animation '${name}'`
    const tracks: TrackPlan[] = parsed.map(({ target, channel, keys }) => ({
        target,
        channel,
        keys: trackKeys(channel, keys, `${label}: ${channel} on ${target}`, record).map((key) => ({ ...key, step: key.step * step })),
    }))
    tracks.push(...paramTracks)
    const scaled = schedule ? { ...schedule, window: schedule.window * step, jitter: schedule.jitter * step } : null
    const speeds = speedTracks.map(({ target, keys }) => {
        const modes = keyModes(keys)
        const interpolations = blockbenchInterpolations(modes)
        for (let i = 1; i < keys.length; i++) {
            const read = readBack(interpolations[i - 1], interpolations[i])
            if (read !== modes[i]) record.change(`${label}: speed on ${target} steps ${keys[i - 1][0]} to ${keys[i][0]} were ${modes[i]} and read back as ${read}`)
        }
        return { target, keys: keys.map((key, index) => ({ step: Number(key[0]), value: Number(key[1]), interpolation: interpolations[index] })) }
    })
    return {
        name,
        trigger,
        schedule: scaled,
        length: whileReaction ? loop : Number(animation.length) * step,
        restart: !whileReaction && animation.restart === true,
        tracks,
        bursts,
        speeds,
        palette,
        reduced: hasReduced ? animation.reduced : null,
        ...(letters ? { letters } : {}),
    }
}

function burstKeys(raw: unknown): BurstKey[] | null {
    if (!Array.isArray(raw)) return null
    const keys: BurstKey[] = []
    for (const key of raw) {
        if (!Array.isArray(key) || key.length !== 2 || !isWhole(key[0]) || !isWhole(key[1]) || key[0] < 0 || key[1] < 1) return null
        keys.push({ step: key[0], count: key[1] })
    }
    return keys
}

function readAnimations(
    manifest: Json,
    kinds: Map<string, string>,
    steps: Map<string, number>,
    record: Recorder,
    colors: PaletteContext,
): { tracks: TrackPlan[], animations: AnimationPlan[] } {
    const animations = isRecord(manifest.animations) ? manifest.animations : {}
    const loop = positiveNumber(manifest.loop, DEFAULT_LOOP_FRAMES)
    const tracks: TrackPlan[] = []
    const plans: AnimationPlan[] = []
    for (const name of Object.keys(animations)) {
        const animation = animations[name]
        if (name !== LOOP_ANIMATION) {
            const plan = animationPlan(name, animation, kinds, steps, loop, record, colors)
            if (typeof plan !== 'string') {
                plans.push(plan)
                continue
            }
            const label = isRecord(animation) && animation.schedule
                ? `Random animation '${name}'`
                : isRecord(animation) && animation.trigger
                    ? `Triggered animation '${name}'`
                    : `Animation '${name}'`
            record.keep(MANIFEST, ['animations', name], animation, `${label} (${plan})`)
            continue
        }
        if (!isRecord(animation) || animation.schedule || animation.trigger) {
            record.keep(MANIFEST, ['animations', name], animation, `Animation '${name}'`)
            continue
        }
        for (const key of Object.keys(animation)) {
            if (key !== 'tracks') record.keep(MANIFEST, ['animations', LOOP_ANIMATION, key], animation[key], `animations.loop.${key}`)
        }
        const raw = isRecord(animation.tracks) ? animation.tracks : {}
        for (const target of Object.keys(raw)) {
            const channels = raw[target]
            const kind = kinds.get(target)
            if (!kind || !isRecord(channels)) {
                const label = target.startsWith(PALETTE_TRACK)
                    ? `Color animation on ${target.slice(PALETTE_TRACK.length)}`
                    : `Loop track on '${target}'`
                record.keep(MANIFEST, ['animations', LOOP_ANIMATION, 'tracks', target], channels, label)
                continue
            }
            for (const channel of Object.keys(channels)) {
                const keys = channels[channel]
                if (isBurstTrack(kind, channel)) continue
                if (kind === 'material' && isParamChannel(channel)) {
                    const imported = importParamKeys(keys, `Loop ${channel} on ${target}`)
                    if (!imported) {
                        record.keep(MANIFEST, ['animations', LOOP_ANIMATION, 'tracks', target, channel], keys, `Loop ${channel} track on ${target} (it uses values the plugin can't edit)`)
                        continue
                    }
                    imported.changes.forEach((note) => record.change(note))
                    tracks.push({ target, channel: channel as Channel, keys: imported.keys })
                    continue
                }
                if (!(LAYER_CHANNELS[kind] as string[]).includes(channel) || !Array.isArray(keys)) {
                    record.keep(MANIFEST, ['animations', LOOP_ANIMATION, 'tracks', target, channel], keys, `Loop ${channel} track on ${target}`)
                    continue
                }
                if (!plainKeys(channel as Channel, keys)) {
                    record.keep(
                        MANIFEST,
                        ['animations', LOOP_ANIMATION, 'tracks', target, channel],
                        keys,
                        `Loop ${channel} track on ${target} (it uses values the plugin can't edit, such as Molang)`,
                    )
                    continue
                }
                tracks.push({ target, channel: channel as Channel, keys: trackKeys(channel as Channel, keys, `Loop ${channel} on ${target}`, record) })
            }
        }
    }
    return { tracks, animations: plans }
}

function readManifestExtras(manifest: Json, record: Recorder) {
    for (const key of Object.keys(manifest)) {
        if (key === 'phase' && manifest.phase === PER_PLAYER_PHASE) continue
        if (!MANIFEST_KEYS.has(key)) record.keep(MANIFEST, [key], manifest[key], MANIFEST_LABELS[key] ?? `${MANIFEST}: ${key}`)
    }
    const extraRequires = stringList(manifest.requires).filter((item) => !REPRESENTED_REQUIRES.has(item))
    if (extraRequires.length > 0) {
        record.keep(MANIFEST, ['requires'], extraRequires, `Needs newer game features: ${extraRequires.join(', ')}`, false, 'union')
    }
    for (const entry of Array.isArray(manifest.layers) ? manifest.layers : []) {
        if (!isRecord(entry)) continue
        for (const key of Object.keys(entry)) {
            if (LAYER_ENTRY_KEYS.has(key)) continue
            record.keep(MANIFEST, ['layers', { id: String(entry.id) }, key], entry[key], `${MANIFEST} layers.${entry.id}.${key}`, false)
        }
    }
    for (const group of Array.isArray(manifest.groups) ? manifest.groups : []) {
        if (!isRecord(group)) continue
        for (const key of Object.keys(group)) {
            if (!GROUP_KEYS.has(key)) record.keep(MANIFEST, ['groups', { id: String(group.id) }, key], group[key], `Group ${group.id}: ${key}`, false)
        }
    }
}

function readMasks(manifest: Json, layers: Map<string, LayerPlan>, record: Recorder) {
    for (const entry of Array.isArray(manifest.layers) ? manifest.layers : []) {
        if (!isRecord(entry) || entry.mask === undefined || entry.mask === null) continue
        const id = String(entry.id)
        const layer = layers.get(id)
        const maskable = !!layer && layer.kind !== 'path' && layer.kind !== 'emitter'
        if (layer && maskable && entry.mask === NAME_MASK) {
            layer.props.mask = NAME_MASK
            continue
        }
        if (layer && maskable && typeof entry.mask === 'string' && entry.mask !== id && layers.has(entry.mask)) {
            layer.mask = entry.mask
            continue
        }
        record.keep(MANIFEST, ['layers', { id }, 'mask'], entry.mask, `Mask on layer ${id}`, false)
    }
}

function readClips(manifest: Json, layers: Map<string, LayerPlan>, record: Recorder) {
    for (const entry of Array.isArray(manifest.layers) ? manifest.layers : []) {
        if (!isRecord(entry) || entry.clip === undefined || entry.clip === null) continue
        const id = String(entry.id)
        const layer = layers.get(id)
        const target = layer?.mask ? layers.get(layer.mask) : undefined
        if (layer && entry.clip === 'fill' && target?.kind === 'body') layer.props.clip = 'fill'
        else record.keep(MANIFEST, ['layers', { id }, 'clip'], entry.clip, `Clip on layer ${id}`, false)
    }
}

function readNameTargets(layers: Map<string, LayerPlan>, record: Recorder) {
    for (const [id, layer] of layers) {
        if (layer.of !== NAME_MASK || layer.kind === 'sprite') continue
        layer.of = null
        record.change(`Layer ${id}: only sprites and bodies can sit against just the name, so it now uses the whole tag`)
    }
}

function loopFrameKeyed(manifest: Json, id: string): boolean {
    const tracks = manifest.animations?.[LOOP_ANIMATION]?.tracks
    return isRecord(tracks) && isRecord(tracks[id]) && tracks[id].frame !== undefined
}

function timelineKeys(timeline: Json, cycle: number, step: number, frames: number | null): KeyPlan[] | string {
    if (!Array.isArray(timeline) || timeline.length === 0) return 'it is not a list of frames and holds'
    const keys: KeyPlan[] = []
    let at = 0
    for (const entry of timeline) {
        if (!isRecord(entry) || Object.keys(entry).some((key) => key !== 'frame' && key !== 'hold')) return 'an entry has fields the plugin doesn\'t know'
        if (!isWhole(entry.frame) || entry.frame < 0 || !isWhole(entry.hold) || entry.hold < 1) return 'an entry is not a whole frame and hold'
        if (frames !== null && entry.frame >= frames) return `it shows frame ${entry.frame + 1}, and the sprite has ${frames}`
        if (keys.length === 0 || keys[keys.length - 1].value !== entry.frame) keys.push({ step: at * step, value: entry.frame, interpolation: 'step' })
        at += entry.hold
    }
    if (at !== cycle) return `its holds add up to ${at} steps, not the layer's ${cycle}`
    return keys
}

function readTimelines(bundle: Bundle, layers: Map<string, LayerPlan>, loop: number, record: Recorder): TrackPlan[] {
    const tracks: TrackPlan[] = []
    for (const [id, layer] of layers) {
        const timeline = layer.timeline
        delete layer.timeline
        if (layer.kind !== 'sprite' || timeline === undefined || timeline === null) continue
        const path = `layers/${id}.json`
        const keep = (reason: string) => {
            record.keep(path, ['timeline'], timeline, `Sprite timeline on ${id} (${reason})`, false)
        }
        if (loopFrameKeyed(bundle.manifest, id)) {
            keep('the loop already has Frame keyframes for it, so the game ignores the timeline')
            continue
        }
        const step = Math.max(1, Number(layer.props.step) || 1)
        if (!isWhole(loop) || loop < 1 || loop % step !== 0) {
            keep(`the loop of ${loop} frames doesn't split into whole steps of ${step}`)
            continue
        }
        const cycle = loop / step
        const frames = layer.sprite ? framesOf(bundle.sprites[layer.sprite])?.length ?? null : null
        const keys = timelineKeys(timeline, cycle, step, frames)
        if (typeof keys === 'string') {
            keep(keys)
            continue
        }
        tracks.push({ target: id, channel: 'frame', keys })
        record.change(`Sprite ${id}: its timeline became Frame keyframes in the loop animation, and exports as Frame keyframes`)
    }
    return tracks
}

function colorKey(argb: number): string {
    return (argb >>> 0).toString(16).padStart(8, '0').toUpperCase()
}

function textureOf(
    id: string,
    sprite: Json,
    palette: PaletteInfo,
    variants: Record<string, VariantData>,
    used: boolean,
    record: Recorder,
): TexturePlan | null {
    const frames = framesOf(sprite)
    if (!frames || frames.length === 0 || !Array.isArray(frames[0]) || frames[0].length === 0) {
        record.dropped.push(`sprites/${id}.json (no frames)`)
        return null
    }
    for (const key of Object.keys(sprite)) {
        if (!SPRITE_FILE_KEYS.has(key)) record.keep(`sprites/${id}.json`, [key], sprite[key], `sprites/${id}.json: ${key}`, false)
    }
    const width = String(frames[0][0]).length
    const frameHeight = frames[0].length
    const rgba = new Uint8ClampedArray(width * frameHeight * frames.length * 4)
    const table = new Map<string, { slot: string, tone: number }>()
    for (const slot of palette.slots) {
        slot.ramp.forEach((color, tone) => {
            const value = parseHex(color)
            if (value === null) return
            const key = colorKey(value)
            if (!table.has(key)) table.set(key, { slot: slot.id, tone })
        })
    }
    const charColors = new Map<string, number>()
    const colors = isRecord(sprite.colors) ? sprite.colors : {}
    for (const char of Object.keys(colors)) {
        const ref = parseSlotRef(colors[char])
        const value = ref ? palette.tone(null, ref.slot, ref.tone) : null
        if (!ref || value === null) {
            record.change(`Sprite ${id}: color '${colors[char]}' is not in the palette and was left transparent`)
            continue
        }
        charColors.set(char, value)
        const first = table.get(colorKey(value))
        if (!first) {
            record.change(`Sprite ${id}: '${colors[char]}' is an in-between shade the plugin's palette lacks; its pixels will be flagged`)
            continue
        }
        if (first.slot === ref.slot && first.tone === ref.tone) continue
        const firstName = first.tone === 0 ? first.slot : `${first.slot}[${first.tone}]`
        const differs = Object.values(variants).filter(
            (variant) => palette.tone(variant.palette, first.slot, first.tone) !== palette.tone(variant.palette, ref.slot, ref.tone),
        )
        if (differs.length === 0) {
            record.change(`Sprite ${id}: '${colors[char]}' has the same color as ${firstName} in every colorway, so it reads back as ${firstName}`)
        } else {
            record.change(
                `Sprite ${id}: '${colors[char]}' has the same base color as ${firstName}, so it reads back as ${firstName} and repaints in colorway ${differs.map((variant) => variant.palette).join(', ')}`,
            )
        }
    }
    frames.forEach((rows, frame) => {
        rows.forEach((row, y) => {
            const text = String(row)
            for (let x = 0; x < width; x++) {
                const value = charColors.get(text[x])
                if (value === undefined) continue
                const at = ((frame * frameHeight + y) * width + x) * 4
                rgba[at] = (value >>> 16) & 0xff
                rgba[at + 1] = (value >>> 8) & 0xff
                rgba[at + 2] = value & 0xff
                rgba[at + 3] = value >>> 24
            }
        })
    })
    return { id, width, frameHeight, frames: frames.length, rgba, used }
}

function positiveNumber(value: unknown, fallback: number): number {
    const number = Number(value)
    return isFinite(number) && number > 0 ? number : fallback
}

export function planImport(bundle: Bundle): ImportPlan {
    const record = new Recorder()
    const { manifest } = bundle
    const palette = readPalette(bundle, record)
    readManifestExtras(manifest, record)
    const variants = readVariants(manifest, palette.colorways, record)
    const base = defaultNameplate()
    const loop = positiveNumber(manifest.loop, DEFAULT_LOOP_FRAMES)
    const nameplate: NameplateData = {
        id: String(manifest.id),
        fps: positiveNumber(manifest.fps, DEFAULT_FPS),
        ownsBackground: manifest.ownsBackground === true,
        ...(manifest.phase === PER_PLAYER_PHASE ? { phase: PER_PLAYER_PHASE } : {}),
        ...importPlateStyle(manifest, (steps, value, label) => record.keep(MANIFEST, steps, value, label), (note) => record.change(note)),
        referenceName: base.referenceName,
        palette: { slots: palette.slots, colorways: palette.colorways },
        variants,
    }

    const order: string[] = []
    const layers = new Map<string, LayerPlan>()
    for (const entry of Array.isArray(manifest.layers) ? manifest.layers : []) {
        const id = String(entry.id)
        const file = bundle.layers[id]
        if (!isRecord(file)) continue
        order.push(id)
        layers.set(id, layerPlan(id, entry, file, record))
    }
    readMasks(manifest, layers, record)
    readClips(manifest, layers, record)
    readNameTargets(layers, record)
    const timelineTracks = readTimelines(bundle, layers, loop, record)
    const groups: Json[] = Array.isArray(manifest.groups) ? manifest.groups : []
    const root = buildTree(order, layers, groups, record)
    takeBurstTracks(manifest, layers.values())

    const kinds = new Map<string, string>()
    for (const group of groups) if (isRecord(group) && typeof group.id === 'string') kinds.set(group.id, 'group')
    for (const [id, layer] of layers) kinds.set(id, layer.kind)
    kinds.set(BADGE_TARGET, 'badge')
    kinds.set(PLATE_TARGET, 'plate')
    const steps = new Map<string, number>()
    for (const [id, layer] of layers) steps.set(id, Number(layer.props.step) || 1)
    takePaletteAnimation(manifest, nameplate.palette.slots)
    const slotMolang = takeSlotMolang(manifest, palette.slots)
    const rawSlots: Json[] = Array.isArray(bundle.palettes?.slots) ? bundle.palettes.slots : []
    const interpolated = new Set<string>(rawSlots.filter((slot) => isRecord(slot) && slot.interpolate !== undefined && slot.interpolate !== null).map((slot) => String(slot.id)))
    const { tracks, animations } = readAnimations(manifest, kinds, steps, record, { slots: nameplate.palette.slots, interpolated })

    const usedSprites = new Set<string>()
    for (const layer of layers.values()) for (const id of planSpriteIds(layer)) usedSprites.add(id)
    for (const layer of layers.values()) {
        const art = layer.kind === 'body' ? (layer.props.art as { sprite?: unknown } | undefined) : undefined
        if (typeof art?.sprite === 'string') usedSprites.add(art.sprite)
    }
    const textures: TexturePlan[] = []
    for (const id of Object.keys(bundle.sprites)) {
        const used = usedSprites.has(id)
        if (!used) record.change(`sprites/${id}.json is not used by any layer; it was added as a picture and exports once a layer uses it`)
        const texture = textureOf(id, bundle.sprites[id], palette, variants, used, record)
        if (texture) textures.push(texture)
    }

    record.dropped.push(...bundle.unreadable)
    const flags = importFlags(bundle.flags, manifest.variants, (note) => record.change(note))
    for (const [path, text] of Object.entries(bundle.others)) {
        if (isMaterialFilePath(path)) continue
        if (path === SOURCE) {
            record.dropped.push(`${SOURCE}: the original Blockbench project saved inside the zip. Click "Open original project" below to open it in its own tab`)
            continue
        }
        if (path === REPORT_FILE) continue
        try {
            record.keep(path, [], JSON.parse(text), `Extra file ${path}`)
        } catch {
            record.dropped.push(path)
        }
    }

    return {
        nameplate,
        loop,
        root,
        textures,
        tracks: [...tracks, ...timelineTracks],
        animations,
        extra: { source: nameplate.id, patches: record.patches },
        flags,
        slotMolang,
        materials: planMaterials(bundle.others, manifest, bundle.layers, (note) => record.change(note)),
        kept: record.kept,
        changed: record.changed,
        dropped: record.dropped,
    }
}

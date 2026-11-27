import { sanitizeId } from '../palette/ids'
import { normalizeHex } from '../palette/color'
import { cloneJson, isRecord } from '../util/json'

export const COSMETIC_KINDS = ['item', 'pet', 'effect', 'emote'] as const
export type CosmeticKind = typeof COSMETIC_KINDS[number]

export const COSMETIC_FORMATS: Record<CosmeticKind, string> = {
    item: 'polyplus_item',
    pet: 'polyplus_pet',
    effect: 'polyplus_effect',
    emote: 'polyplus_emote',
}

export const COSMETIC_DATA_VERSION = 1
export const RIGS = ['player', 'actor', 'boat', 'minecart', 'horse'] as const
export const VEHICLE_RIGS = ['boat', 'minecart', 'horse'] as const
export const PLAYER_BONES = ['body', 'head', 'hat', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const
export const PLAYER_LOCATORS = ['feet', 'body', 'head', 'right_hand', 'left_hand', 'back', 'above_head', 'left_wing_tip', 'right_wing_tip', 'tail'] as const
export const TRAIL_EVENT_GATES = ['is_jumping'] as const
export const REACTION_ON = ['while', 'start', 'stop', 'appear', 'equip'] as const
export const SIGNAL_FREE_ON: readonly string[] = ['appear', 'equip']
export const ARCHETYPES = ['walking', 'flying', 'shoulder'] as const
export const INTERACTIONS = ['greet', 'follow', 'nap', 'play', 'chase'] as const
export const MOMENTS = ['join', 'respawn', 'death', 'kill'] as const
export const EMOTE_RULES = [
    'allow_walking',
    'allow_sprinting',
    'allow_crouching',
    'allow_falling',
    'allow_elytra_flying',
    'allow_swimming',
    'allow_vanilla_pose',
    'absolute_head',
] as const
export const DEFAULT_RULES: Record<EmoteRule, boolean> = {
    allow_walking: false,
    allow_sprinting: false,
    allow_crouching: false,
    allow_falling: true,
    allow_elytra_flying: false,
    allow_swimming: false,
    allow_vanilla_pose: false,
    absolute_head: true,
}
export const EMOTE_REQUIREMENTS = ['floor', 'ledge', 'wall'] as const
export const DEFAULT_REQUIREMENT = 'floor'
export const MAX_ROLES = 2
export const MAX_PET_ROLES = INTERACTIONS.length * MAX_ROLES
export const ROLE_IDS = ['a', 'b'] as const
export const ROLE_LABELS: Record<string, string> = { a: 'Starts it', b: 'Joins in' }
export const INTERACTION_LABELS: Record<Interaction, string> = { greet: 'Greets', follow: 'Follows', nap: 'Naps', play: 'Plays', chase: 'Chases' }
export const DEFAULT_LEASH = 3
export interface PetScaleRange {
    min: number
    max: number
}

export function petScaleKept(scale: number, range: PetScaleRange | null): number {
    return range ? Math.min(range.max, Math.max(range.min, scale)) : scale
}

export type ReactionOn = typeof REACTION_ON[number]
export type Archetype = typeof ARCHETYPES[number]
export type Interaction = typeof INTERACTIONS[number]
export type EmoteRule = typeof EMOTE_RULES[number]

export interface PaletteSlot {
    id: string
    name: string
    ramp: string[]
    customizable: boolean
    interpolate?: number
}

export interface CosmeticPalette {
    slots: PaletteSlot[]
    colorways: Record<string, Record<string, string[]>>
    fixed: string[]
}

export interface UseRef {
    id: string
    name: string
}

export interface ReactionData {
    signal: string
    on: ReactionOn
    play: string
    restart: boolean
    blend: number
    speed: number | null
    palette: string
    effect: string
    playRef?: UseRef
    paletteRef?: UseRef
    effectRef?: UseRef
}

export interface AttachData {
    rig: string
    bone: string
    replaces: string
}

export interface PetData {
    archetype: Archetype
    leashRadius: number
    scale: number
    anchor: string
    interactions: Partial<Record<Interaction, Array<'a' | 'b'>>>
    roles: PetRoleData[]
}

export interface RoleData {
    id: string
    animation: string
    offset: [number, number, number]
    yaw: number
    ref?: UseRef
}

export interface PetRoleData extends RoleData {
    interaction: string
}

export interface EmoteData {
    rules: Record<EmoteRule, boolean>
    roles: RoleData[]
    requirement: string
    fallback: string
    fallbackRef?: UseRef
    main: string
    mainRef?: UseRef
}

export interface ParticleData {
    id: string
    picture: string
    json: Record<string, any>
    tint: SlotTint | null
}

export interface SlotTint {
    slot: string
    tone: number | null
}

export interface SoundData {
    id: string
    file: string
    vanilla: string
    volume: number
    pitch: number
}

export interface EmitterData {
    particle: string
    sound: string
    vanilla: string
    locator: string
    count: number
}

export type TrailTint =
    | { kind: 'color', color: string }
    | ({ kind: 'slot' } & SlotTint)
    | { kind: 'gradient', stops: string[], at?: number[] }
    | { kind: 'raw', value: unknown }

export interface TrailData {
    locator: string
    picture: string
    blend: 'alpha' | 'additive'
    width: [number, number]
    tile: boolean
    tint: TrailTint
    fade: number
    minSpeed: number
    while: string[]
}

export interface EffectsData {
    particles: ParticleData[]
    sounds: SoundData[]
    emitters: EmitterData[]
    named: Record<string, EmitterData[]>
    trails: TrailData[]
    pictures: Record<string, string>
    audio: Record<string, string>
}

export interface TargetIds {
    colorways: Record<string, string>
    effects: Record<string, string>
}

export interface CosmeticData {
    version: number
    kind: CosmeticKind
    id: string
    attach: AttachData
    controllers: string[]
    reactions: ReactionData[]
    palette: CosmeticPalette
    effects: EffectsData
    pet: PetData
    emote: EmoteData
    controllerRefs?: Array<UseRef | null>
    ids?: TargetIds
    refs?: unknown
}

export function isCosmeticKind(value: unknown): value is CosmeticKind {
    return typeof value === 'string' && (COSMETIC_KINDS as readonly string[]).includes(value)
}

export function isVehicleRig(rig: unknown): boolean {
    return typeof rig === 'string' && (VEHICLE_RIGS as readonly string[]).includes(rig)
}

export function kindOfFormat(formatId: unknown): CosmeticKind | null {
    for (const kind of COSMETIC_KINDS) if (COSMETIC_FORMATS[kind] === formatId) return kind
    return null
}

function kept<T extends object>(raw: unknown, out: T): T {
    return isRecord(raw) ? { ...raw, ...out } : out
}

function text(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback: number): number {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

function list<T>(value: unknown, each: (item: unknown) => T | null): T[] {
    if (!Array.isArray(value)) return []
    const out: T[] = []
    for (const item of value) {
        const parsed = each(item)
        if (parsed !== null) out.push(parsed)
    }
    return out
}

function strings(value: unknown): string[] {
    return list(value, (item) => (typeof item === 'string' ? item : null))
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback
}

function color(value: unknown): string | null {
    return typeof value === 'string' ? normalizeHex(value) : null
}

function ramp(value: unknown): string[] {
    return list(value, color)
}

export function defaultPalette(): CosmeticPalette {
    return { slots: [], colorways: {}, fixed: [] }
}

export function defaultEffects(): EffectsData {
    return { particles: [], sounds: [], emitters: [], named: {}, trails: [], pictures: {}, audio: {} }
}

export function defaultCosmetic(kind: CosmeticKind, id = `new_${kind}`): CosmeticData {
    return {
        version: COSMETIC_DATA_VERSION,
        kind,
        id,
        attach: { rig: kind === 'pet' ? 'actor' : 'player', bone: '', replaces: '' },
        controllers: [],
        reactions: [],
        palette: defaultPalette(),
        effects: defaultEffects(),
        pet: { archetype: 'walking', leashRadius: DEFAULT_LEASH, scale: 1, anchor: '', interactions: {}, roles: [] },
        emote: { rules: { ...DEFAULT_RULES }, roles: [], requirement: DEFAULT_REQUIREMENT, fallback: '', main: '' },
    }
}

function palette(raw: unknown): CosmeticPalette {
    if (!isRecord(raw)) return defaultPalette()
    const slots = list(raw.slots, (item) => {
        if (!isRecord(item)) return null
        const id = sanitizeId(text(item.id))
        if (!id) return null
        const slot: PaletteSlot = kept(item, { id, name: text(item.name, id), ramp: ramp(item.ramp), customizable: bool(item.customizable, false) })
        if (!Number.isInteger(slot.interpolate)) delete slot.interpolate
        return slot
    })
    const colorways: Record<string, Record<string, string[]>> = {}
    if (isRecord(raw.colorways)) {
        for (const [name, overrides] of Object.entries(raw.colorways)) {
            const id = sanitizeId(name)
            if (!id || !isRecord(overrides)) continue
            colorways[id] = {}
            for (const [slot, tones] of Object.entries(overrides)) colorways[id][slot] = ramp(tones)
        }
    }
    return kept(raw, { slots, colorways, fixed: list(raw.fixed, color) })
}

function reaction(raw: unknown): ReactionData | null {
    if (!isRecord(raw)) return null
    const speed = raw.speed === null || raw.speed === undefined || raw.speed === '' ? null : num(raw.speed, NaN)
    return kept(raw, {
        signal: text(raw.signal),
        on: oneOf(raw.on, REACTION_ON, 'while'),
        play: text(raw.play),
        restart: bool(raw.restart, false),
        blend: Math.max(0, num(raw.blend, 0)),
        speed: speed === null || Number.isNaN(speed) ? null : speed,
        palette: text(raw.palette),
        effect: text(raw.effect),
    })
}

function emitter(raw: unknown): EmitterData | null {
    if (!isRecord(raw)) return null
    return kept(raw, {
        particle: text(raw.particle),
        sound: text(raw.sound),
        vanilla: text(raw.vanilla),
        locator: text(raw.locator),
        count: Math.max(1, Math.round(num(raw.count, 1))),
    })
}

function tone(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    return Math.max(0, Math.round(num(value, 0)))
}

function slotTint(raw: Record<string, unknown>): SlotTint {
    return { slot: text(raw.slot), tone: tone(raw.tone) }
}

function gradientTint(stops: unknown, at: unknown): TrailTint {
    const places = Array.isArray(at) ? at : null
    const out = { kind: 'gradient' as const, stops: [] as string[], at: [] as number[] }
    if (Array.isArray(stops)) {
        stops.forEach((item, i) => {
            const parsed = color(item)
            if (!parsed) return
            out.stops.push(parsed)
            out.at.push(Math.min(1, Math.max(0, num(places?.[i], 0))))
        })
    }
    return places ? out : { kind: 'gradient', stops: out.stops }
}

function trailTint(raw: unknown): TrailTint {
    if (isRecord(raw)) {
        if (raw.kind === 'slot') return { kind: 'slot', ...slotTint(raw) }
        if (raw.kind === 'gradient') return gradientTint(raw.stops, raw.at)
        if (raw.kind === 'raw' && raw.value !== undefined) return { kind: 'raw', value: cloneJson(raw.value) }
        return { kind: 'color', color: color(raw.color) ?? '#FFFFFF' }
    }
    return { kind: 'color', color: '#FFFFFF' }
}

function trail(raw: unknown): TrailData | null {
    if (!isRecord(raw)) return null
    const width = Array.isArray(raw.width) ? raw.width : [raw.width, raw.width]
    return kept(raw, {
        locator: text(raw.locator),
        picture: text(raw.picture),
        blend: oneOf(raw.blend, ['alpha', 'additive'] as const, 'alpha'),
        width: [Math.max(0, num(width[0], 0.25)), Math.max(0, num(width[1], 0.25))] as [number, number],
        tile: bool(raw.tile, false),
        tint: trailTint(raw.tint),
        fade: Math.max(0, num(raw.fade, 1)),
        minSpeed: Math.max(0, num(raw.minSpeed, 0)),
        while: strings(raw.while),
    })
}

function stringMap(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {}
    if (isRecord(raw)) for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') out[key] = value
    return out
}

function effects(raw: unknown): EffectsData {
    if (!isRecord(raw)) return defaultEffects()
    const named: Record<string, EmitterData[]> = {}
    if (isRecord(raw.named)) for (const [name, items] of Object.entries(raw.named)) named[name] = list(isRecord(items) ? [items] : items, emitter)
    return kept(raw, {
        particles: list(raw.particles, (item) => {
            if (!isRecord(item)) return null
            const tint = isRecord(item.tint) ? slotTint(item.tint) : null
            return kept(item, { id: text(item.id), picture: text(item.picture), json: isRecord(item.json) ? cloneJson(item.json) : {}, tint })
        }),
        sounds: list(raw.sounds, (item) => {
            if (!isRecord(item)) return null
            return kept(item, { id: text(item.id), file: text(item.file), vanilla: text(item.vanilla), volume: num(item.volume, 1), pitch: num(item.pitch, 1) })
        }),
        emitters: list(raw.emitters, emitter),
        named,
        trails: list(raw.trails, trail),
        pictures: stringMap(raw.pictures),
        audio: stringMap(raw.audio),
    })
}

function pet(raw: unknown): PetData {
    const base = defaultCosmetic('pet').pet
    if (!isRecord(raw)) return base
    const interactions: PetData['interactions'] = {}
    if (isRecord(raw.interactions)) {
        for (const id of INTERACTIONS) {
            const value = raw.interactions[id]
            if (Array.isArray(value) && value.length === 0) {
                interactions[id] = []
                continue
            }
            const roles = strings(value).filter((role): role is 'a' | 'b' => role === 'a' || role === 'b')
            if (roles.length) interactions[id] = Array.from(new Set(roles)).sort()
        }
    }
    return kept(raw, {
        archetype: oneOf(raw.archetype, ARCHETYPES, base.archetype),
        leashRadius: num(raw.leashRadius, base.leashRadius),
        scale: num(raw.scale, base.scale),
        anchor: text(raw.anchor),
        interactions,
        roles: list(raw.roles, (item) => {
            const parsed = role(item)
            return parsed && { ...parsed, interaction: text((item as Record<string, unknown>).interaction) }
        }),
    })
}

function role(item: unknown): RoleData | null {
    if (!isRecord(item)) return null
    const offset = Array.isArray(item.offset) ? item.offset : []
    return kept(item, {
        id: text(item.id),
        animation: text(item.animation),
        offset: [num(offset[0], 0), num(offset[1], 0), num(offset[2], 0)] as [number, number, number],
        yaw: num(item.yaw, 0),
    })
}

function emote(raw: unknown): EmoteData {
    const rules = { ...DEFAULT_RULES }
    const source = isRecord(raw) && isRecord(raw.rules) ? raw.rules : {}
    for (const rule of EMOTE_RULES) rules[rule] = bool(source[rule], DEFAULT_RULES[rule])
    const roles = list(isRecord(raw) ? raw.roles : null, role)
    return kept(raw, {
        rules,
        roles,
        requirement: text(isRecord(raw) ? raw.requirement : null, DEFAULT_REQUIREMENT),
        fallback: text(isRecord(raw) ? raw.fallback : null),
        main: text(isRecord(raw) ? raw.main : null),
    })
}

export function normalizeCosmetic(raw: unknown, kind?: CosmeticKind): CosmeticData {
    const source = isRecord(raw) ? raw : {}
    const resolved = kind ?? (isCosmeticKind(source.kind) ? source.kind : 'item')
    const base = defaultCosmetic(resolved)
    const attach = isRecord(source.attach) ? source.attach : {}
    return kept(source, {
        version: Math.max(COSMETIC_DATA_VERSION, Math.round(num(source.version, COSMETIC_DATA_VERSION))),
        kind: resolved,
        id: typeof source.id === 'string' ? source.id : base.id,
        attach: kept(attach, { rig: text(attach.rig, base.attach.rig), bone: text(attach.bone), replaces: text(attach.replaces) }),
        controllers: strings(source.controllers),
        reactions: list(source.reactions, reaction),
        palette: palette(source.palette),
        effects: effects(source.effects),
        pet: pet(source.pet),
        emote: emote(source.emote),
    })
}

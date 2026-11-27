import { EngineIssue, issueMessage } from '../engine'
import { fromBase64, toBase64 } from '../material/png'
import { stringifyJson } from '../util/bundleJson'
import { cloneJson, isRecord, sameJson } from '../util/json'
import { byteHex } from '../palette/color'
import { sanitizeId, uniqueId } from '../palette/ids'
import type { BundleFiles, BundlePart, CosmeticSources } from './bundle'
import { CosmeticData, EmitterData, normalizeCosmetic, ParticleData, SlotTint, TrailData, TrailTint } from './data'

export const PICTURE_PREFIX = 'fx_'
export const PARTICLE_VERSION = '1.10.0'
const COMPONENT = 'minecraft:'

export const particlePath = (id: string) => `particles/${id}.json`
export const picturePath = (name: string) => `textures/${PICTURE_PREFIX}${name}.png`
export const soundPath = (id: string) => `sounds/${id}.ogg`

function finiteOf(value: unknown): number | null {
    if (typeof value === 'string' && value.trim() === '') return null
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isFinite(number) ? number : null
}

export function soundVolume(value: unknown): number {
    const number = finiteOf(value)
    return number === null || number < 0 ? 1 : number
}

export function soundPitch(value: unknown): number {
    const number = finiteOf(value)
    return number === null || number <= 0 ? 1 : number
}

export type RateKind ='instant' | 'steady' | 'manual'
export type LifetimeKind = 'once' | 'looping' | 'expression'
export type ShapeKind = 'point' | 'sphere' | 'box' | 'disc' | 'entity_aabb'
export type Molang = number | string

export interface ParticleFields {
    blend: 'alpha' | 'additive'
    rate: RateKind
    count: number
    perSecond: number
    max: number
    lifetime: LifetimeKind
    active: number
    sleep: number
    shape: ShapeKind
    radius: number
    box: [number, number, number]
    surface: boolean
    direction: 'outwards' | 'inwards'
    world: boolean
    speed: Molang
    acceleration: [Molang, Molang, Molang]
    drag: Molang
    life: Molang
    size: [Molang, Molang]
    facing: string
    color: string
    uvSize: [number, number]
    uv: [number, number]
    uvRegion: [number, number]
}

export const FACING_MODES = ['rotate_xyz', 'rotate_y', 'lookat_xyz', 'lookat_y', 'lookat_direction', 'emitter_transform_xy', 'emitter_transform_xz', 'emitter_transform_yz']

export function starterParticle(id: string): Record<string, any> {
    return {
        format_version: PARTICLE_VERSION,
        particle_effect: {
            description: { identifier: `polyplus:${id}`, basic_render_parameters: { material: 'particles_alpha', texture: '' } },
            components: {
                'minecraft:emitter_rate_instant': { num_particles: 8 },
                'minecraft:emitter_lifetime_once': { active_time: 1 },
                'minecraft:emitter_shape_sphere': { radius: 0.3, direction: 'outwards' },
                'minecraft:particle_initial_speed': 1,
                'minecraft:particle_motion_dynamic': { linear_acceleration: [0, -1, 0], linear_drag_coefficient: 1 },
                'minecraft:particle_lifetime_expression': { max_lifetime: 1 },
                'minecraft:particle_appearance_billboard': {
                    size: [0.1, 0.1],
                    facing_camera_mode: 'rotate_xyz',
                    uv: { texture_width: 8, texture_height: 8, uv: [0, 0], uv_size: [8, 8] },
                },
            },
        },
    }
}

function effectOf(json: Record<string, any>): Record<string, any> {
    if (!isRecord(json.particle_effect)) json.particle_effect = {}
    const effect = json.particle_effect
    if (!isRecord(effect.description)) effect.description = {}
    if (!isRecord(effect.description.basic_render_parameters)) effect.description.basic_render_parameters = {}
    if (!isRecord(effect.components)) effect.components = {}
    return effect
}

function numberOf(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function molangOf(value: unknown, fallback: Molang): Molang {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) return value
    return fallback
}

function triple<T>(value: unknown, read: (item: unknown, fallback: T) => T, fallback: T): [T, T, T] {
    const items = Array.isArray(value) ? value : []
    return [read(items[0], fallback), read(items[1], fallback), read(items[2], fallback)]
}

function pair<T>(value: unknown, read: (item: unknown, fallback: T) => T, fallback: [T, T]): [T, T] {
    const items = Array.isArray(value) ? value : []
    return [read(items[0], fallback[0]), read(items[1], fallback[1])]
}

function hexOf(value: unknown): string {
    if (typeof value === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return value.toUpperCase()
    return ''
}

export function particleFields(json: Record<string, any>): ParticleFields {
    const effect = effectOf(cloneJson(json))
    const c = effect.components
    const get = (name: string): any => c[COMPONENT + name]
    const rateKind: RateKind = get('emitter_rate_steady') ? 'steady' : get('emitter_rate_manual') ? 'manual' : 'instant'
    const rate = get(`emitter_rate_${rateKind}`) ?? {}
    const lifetimeKind: LifetimeKind = get('emitter_lifetime_looping') ? 'looping' : get('emitter_lifetime_expression') ? 'expression' : 'once'
    const lifetime = get(`emitter_lifetime_${lifetimeKind}`) ?? {}
    const shapeKind = SHAPES.find((kind) => get(`emitter_shape_${kind}`)) ?? 'point'
    const shape = get(`emitter_shape_${shapeKind}`) ?? {}
    const motion = get('particle_motion_dynamic') ?? {}
    const billboard = get('particle_appearance_billboard') ?? {}
    const uv = isRecord(billboard.uv) ? billboard.uv : {}
    const material = effect.description.basic_render_parameters.material
    return {
        blend: material === 'particles_add' ? 'additive' : 'alpha',
        rate: rateKind,
        count: numberOf(rate.num_particles, 8),
        perSecond: numberOf(rate.spawn_rate, 4),
        max: numberOf(rate.max_particles, 16),
        lifetime: lifetimeKind,
        active: numberOf(lifetime.active_time, 1),
        sleep: numberOf(lifetime.sleep_time, 0),
        shape: shapeKind,
        radius: numberOf(shape.radius, 0.3),
        box: triple(shape.half_dimensions, numberOf, 0.3),
        surface: shape.surface_only === true,
        direction: shape.direction === 'inwards' ? 'inwards' : 'outwards',
        world: !(get('emitter_local_space')?.position === true),
        speed: molangOf(get('particle_initial_speed'), 0),
        acceleration: triple(motion.linear_acceleration, molangOf, 0),
        drag: molangOf(motion.linear_drag_coefficient, 0),
        life: molangOf(get('particle_lifetime_expression')?.max_lifetime, 1),
        size: pair(billboard.size, molangOf, [0.1, 0.1]),
        facing: typeof billboard.facing_camera_mode === 'string' ? billboard.facing_camera_mode : 'rotate_xyz',
        color: hexOf(get('particle_appearance_tinting')?.color),
        uvSize: [numberOf(uv.texture_width, 8), numberOf(uv.texture_height, 8)],
        uv: pair(uv.uv, numberOf, [0, 0]),
        uvRegion: pair(uv.uv_size, numberOf, [8, 8]),
    }
}

const SHAPES: ShapeKind[] = ['sphere', 'box', 'disc', 'entity_aabb', 'point']

function setOne(c: Record<string, any>, family: string, kinds: string[], kind: string, value: Record<string, any>) {
    for (const other of kinds) if (other !== kind) delete c[`${COMPONENT}${family}_${other}`]
    const key = `${COMPONENT}${family}_${kind}`
    c[key] = { ...(isRecord(c[key]) ? c[key] : {}), ...value }
}

function record(parent: Record<string, any>, key: string): Record<string, any> {
    if (!isRecord(parent[key])) parent[key] = {}
    return parent[key]
}

export function applyParticleFields(json: Record<string, any>, f: ParticleFields): Record<string, any> {
    const was = particleFields(json)
    const changed = (key: keyof ParticleFields) => !sameJson(was[key], f[key])
    const patch = (target: () => Record<string, any>, pairs: Array<[keyof ParticleFields, string]>) => {
        for (const [field, name] of pairs) if (changed(field)) target()[name] = f[field]
    }
    const out = cloneJson(json)
    const effect = effectOf(out)
    const c = effect.components
    const at = (name: string) => () => record(c, COMPONENT + name)
    if (changed('blend')) effect.description.basic_render_parameters.material = f.blend === 'additive' ? 'particles_add' : 'particles_alpha'
    if (changed('rate')) {
        const rate = f.rate === 'instant' ? { num_particles: f.count } : f.rate === 'steady' ? { spawn_rate: f.perSecond, max_particles: f.max } : { max_particles: f.max }
        setOne(c, 'emitter_rate', ['instant', 'steady', 'manual'], f.rate, rate)
    } else {
        patch(at(`emitter_rate_${f.rate}`), f.rate === 'instant' ? [['count', 'num_particles']] : [['perSecond', 'spawn_rate'], ['max', 'max_particles']])
    }
    if (changed('lifetime')) {
        const lifetime = f.lifetime === 'expression' ? { activation_expression: 1 } : f.lifetime === 'once' ? { active_time: f.active } : { active_time: f.active, sleep_time: f.sleep }
        setOne(c, 'emitter_lifetime', ['once', 'looping', 'expression'], f.lifetime, lifetime)
    } else if (f.lifetime !== 'expression') {
        patch(at(`emitter_lifetime_${f.lifetime}`), f.lifetime === 'once' ? [['active', 'active_time']] : [['active', 'active_time'], ['sleep', 'sleep_time']])
    }
    if (changed('shape')) {
        const shape: Record<string, unknown> = { direction: f.direction }
        if (f.shape === 'sphere' || f.shape === 'disc') Object.assign(shape, { radius: f.radius, surface_only: f.surface })
        if (f.shape === 'box') Object.assign(shape, { half_dimensions: f.box, surface_only: f.surface })
        if (f.shape === 'entity_aabb') shape.surface_only = f.surface
        setOne(c, 'emitter_shape', ['point', 'sphere', 'box', 'disc', 'entity_aabb', 'custom'], f.shape, shape)
    } else {
        patch(at(`emitter_shape_${f.shape}`), [['radius', 'radius'], ['box', 'half_dimensions'], ['surface', 'surface_only'], ['direction', 'direction']])
    }
    if (changed('world')) {
        if (f.world) delete c[`${COMPONENT}emitter_local_space`]
        else c[`${COMPONENT}emitter_local_space`] = { position: true, rotation: true }
    }
    if (changed('speed')) c[`${COMPONENT}particle_initial_speed`] = f.speed
    patch(at('particle_motion_dynamic'), [['acceleration', 'linear_acceleration'], ['drag', 'linear_drag_coefficient']])
    patch(at('particle_lifetime_expression'), [['life', 'max_lifetime']])
    const billboard = at('particle_appearance_billboard')
    patch(billboard, [['size', 'size'], ['facing', 'facing_camera_mode']])
    const uv = () => record(billboard(), 'uv')
    if (changed('uvSize')) Object.assign(uv(), { texture_width: f.uvSize[0], texture_height: f.uvSize[1] })
    if (!isRecord(c[`${COMPONENT}particle_appearance_billboard`]?.uv?.flipbook)) patch(uv, [['uv', 'uv'], ['uvRegion', 'uv_size']])
    if (changed('color')) {
        if (f.color) c[`${COMPONENT}particle_appearance_tinting`] = { color: f.color }
        else delete c[`${COMPONENT}particle_appearance_tinting`]
    }
    return out
}

export function molangList(text: unknown, size: number): Molang[] {
    const parts: Molang[] = []
    let depth = 0
    let quote = ''
    let start = 0
    const source = String(text ?? '')
    const push = (end: number) => {
        const value = source.slice(start, end).trim()
        const number = Number(value)
        parts.push(value !== '' && Number.isFinite(number) ? number : value || 0)
        start = end + 1
    }
    for (let i = 0; i < source.length; i++) {
        const char = source[i]
        if (quote) {
            if (char === quote) quote = ''
        } else if (char === '"' || char === "'") quote = char
        else if (char === '(' || char === '[' || char === '{') depth++
        else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1)
        else if (char === ',' && depth === 0) push(i)
    }
    push(source.length)
    while (parts.length < size) parts.push(parts[parts.length - 1] ?? 0)
    return parts.slice(0, size)
}

function particleFile(particle: ParticleData): Record<string, any> {
    const json = cloneJson(particle.json)
    const effect = effectOf(json)
    json.format_version = typeof json.format_version === 'string' ? json.format_version : PARTICLE_VERSION
    effect.description.identifier = typeof effect.description.identifier === 'string' ? effect.description.identifier : `polyplus:${particle.id}`
    effect.description.basic_render_parameters.texture = particle.picture ? `textures/${PICTURE_PREFIX}${particle.picture}` : ''
    return json
}

function emitterJson(emitter: EmitterData): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (emitter.particle) out.particle = emitter.particle
    else if (emitter.sound) out.sound = emitter.sound
    else if (emitter.vanilla) out.vanilla = emitter.vanilla
    if (emitter.locator) out.locator = emitter.locator
    if (emitter.vanilla && emitter.count !== 1) out.count = emitter.count
    return out
}

function slotIndex(data: CosmeticData, id: string): number {
    return data.palette.slots.findIndex((candidate) => candidate.id === id)
}

function missingSlot(path: string, slot: string): EngineIssue {
    const names = { slot }
    const code = 'palette_slot_missing'
    return { path, code, level: 'error', values: {}, names, message: issueMessage(code, {}, names) }
}

export function missingSlotIssues(data: CosmeticData): EngineIssue[] {
    const issues: EngineIssue[] = []
    for (const particle of data.effects.particles) {
        if (particle.tint && slotIndex(data, particle.tint.slot) < 0) issues.push(missingSlot(`manifest.json#particles.${particle.id}.tint`, particle.tint.slot))
    }
    data.effects.trails.forEach((trail, index) => {
        if (trail.tint.kind === 'slot' && slotIndex(data, trail.tint.slot) < 0) issues.push(missingSlot(`manifest.json#trails.${index}.tint`, trail.tint.slot))
    })
    return issues
}

function slotJson(tint: SlotTint, data: CosmeticData): Record<string, number> | undefined {
    const slot = slotIndex(data, tint.slot)
    if (slot < 0) return undefined
    return tint.tone === null ? { slot } : { slot, tone: tint.tone }
}

function tintJson(tint: TrailTint, data: CosmeticData): unknown {
    if (tint.kind === 'slot') return slotJson(tint, data)
    if (tint.kind === 'raw') return cloneJson(tint.value)
    if (tint.kind === 'gradient') {
        const at = tint.at
        if (!at) return { gradient: tint.stops }
        return { gradient: Object.fromEntries(tint.stops.map((stop, i) => [String(at[i] ?? 0), stop])) }
    }
    return tint.color === '#FFFFFF' ? undefined : tint.color
}

function trailJson(trail: TrailData, data: CosmeticData): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (trail.locator) out.locator = trail.locator
    out.texture = `${PICTURE_PREFIX}${trail.picture}`
    if (trail.blend !== 'alpha') out.blend = trail.blend
    out.width = trail.width[0] === trail.width[1] ? trail.width[0] : trail.width
    if (trail.tile) out.tile = true
    const tint = tintJson(trail.tint, data)
    if (tint !== undefined) out.tint = tint
    if (trail.fade !== 1) out.fade = trail.fade
    if (trail.minSpeed) out.min_speed = trail.minSpeed
    if (trail.while.length) out.while = [...trail.while]
    return out
}

function usedPictures(data: CosmeticData): Set<string> {
    const used = new Set<string>()
    for (const particle of data.effects.particles) if (particle.picture) used.add(particle.picture)
    for (const trail of data.effects.trails) if (trail.picture) used.add(trail.picture)
    return used
}

export function pictureTextureIds(data: CosmeticData): Set<string> {
    return new Set(Object.keys(data.effects.pictures).map((name) => `${PICTURE_PREFIX}${name}`))
}

export function texturePathIssues(data: CosmeticData, sources: CosmeticSources): EngineIssue[] {
    const issues: EngineIssue[] = []
    for (const name of usedPictures(data)) {
        if (!data.effects.pictures[name]) continue
        const texture = sources.textures.find((candidate) => `${PICTURE_PREFIX}${name}` === candidate.id)
        if (!texture) continue
        const names = { texture: texture.id, picture: name }
        const code = 'texture_path_taken'
        issues.push({ path: `${picturePath(name)}#picture`, code, level: 'error', values: {}, names, message: issueMessage(code, {}, names) })
    }
    return issues
}

function writeEffects(data: CosmeticData, manifest: Record<string, unknown>, out: BundleFiles) {
    const fx = data.effects
    if (fx.particles.length) {
        manifest.particles = Object.fromEntries(fx.particles.map((particle) => {
            const tint = particle.tint ? slotJson(particle.tint, data) : undefined
            return [particle.id, tint ? { tint } : {}]
        }))
        for (const particle of fx.particles) out.files[particlePath(particle.id)] = stringifyJson(particleFile(particle))
    }
    if (fx.sounds.length) {
        manifest.sounds = Object.fromEntries(fx.sounds.map((sound) => {
            const options: Record<string, unknown> = {}
            if (sound.vanilla) options.vanilla = sound.vanilla
            if (sound.volume !== 1) options.volume = sound.volume
            if (sound.pitch !== 1) options.pitch = sound.pitch
            return [sound.id, options]
        }))
        for (const sound of fx.sounds) {
            const audio = fx.audio[sound.id]
            if (!sound.vanilla && audio) out.binary[soundPath(sound.id)] = fromBase64(audio)
        }
    }
    if (fx.emitters.length) manifest.emitters = fx.emitters.map(emitterJson)
    const named = Object.entries(fx.named)
    if (named.length) manifest.effects = Object.fromEntries(named.map(([name, emitters]) => [name, emitters.map(emitterJson)]))
    if (fx.trails.length) manifest.trails = fx.trails.map((trail) => trailJson(trail, data))
    for (const name of usedPictures(data)) {
        const png = fx.pictures[name]
        if (png) out.binary[picturePath(name)] = fromBase64(png)
    }
}

export function particlePicturePath(texture: unknown): string {
    if (typeof texture !== 'string' || !texture) return ''
    return texture.endsWith('.png') ? texture : `${texture}.png`
}

export function trailPicturePath(texture: unknown): string {
    return typeof texture === 'string' && texture ? `textures/${texture}.png` : ''
}

export function pictureNameOf(path: string): string {
    const stem = path.replace(/^textures\//, '').replace(/\.png$/, '')
    const name = stem.startsWith(PICTURE_PREFIX) && !stem.includes('/') ? stem.slice(PICTURE_PREFIX.length) : stem
    return sanitizeId(name)
}

const TRAIL_KEYS = ['locator', 'texture', 'blend', 'width', 'tile', 'tint', 'fade', 'min_speed', 'while']
const EMITTER_KEYS = ['particle', 'sound', 'vanilla', 'locator', 'count']
const SOUND_KEYS = ['vanilla', 'volume', 'pitch']
const PARTICLE_OPTION_KEYS = ['tint']
const SLOT_KEYS = ['slot', 'tone']
const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

function decimalOf(text: string): number | null {
    const trimmed = text.trim()
    if (!DECIMAL.test(trimmed)) return null
    const number = Number(trimmed)
    return Number.isFinite(number) ? number : null
}

function channelOf(value: unknown): number | null {
    if (value === undefined || value === null) return 1
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string') return value.trim() ? decimalOf(value) : 1
    return null
}

function packedByte(value: number): number {
    const kept = Math.min(1, Math.max(0, Math.fround(value)))
    return Math.floor(Math.fround(Math.fround(kept * 255) + 0.5))
}

export function engineColorHex(value: unknown): string | null {
    if (typeof value === 'string') return HEX_COLOR.test(value) ? value.toUpperCase() : null
    if (!Array.isArray(value) || value.length < 3 || value.length > 4) return null
    const channels = [0, 1, 2, 3].map((i) => channelOf(value[i]))
    if (channels.some((channel) => channel === null)) return null
    const [r, g, b, a] = (channels as number[]).map(packedByte)
    return `#${byteHex(a)}${byteHex(r)}${byteHex(g)}${byteHex(b)}`
}

function readSlotTint(raw: Record<string, unknown>, data: CosmeticData): SlotTint | null {
    if (Object.keys(raw).some((key) => !SLOT_KEYS.includes(key))) return null
    const index = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255 ? value : null)
    const slot = index(raw.slot)
    const id = slot === null ? undefined : data.palette.slots[slot]?.id
    if (!id) return null
    if (raw.tone === undefined) return { slot: id, tone: null }
    const tone = index(raw.tone)
    return tone === null ? null : { slot: id, tone }
}

function readGradient(value: unknown): { tint: TrailTint, converted: boolean } | null {
    if (Array.isArray(value)) {
        const stops = value.map(engineColorHex)
        if (!stops.length || stops.some((stop) => stop === null)) return null
        return { tint: { kind: 'gradient', stops: stops as string[] }, converted: value.some((item) => typeof item !== 'string') }
    }
    if (!isRecord(value)) return null
    const keys = Object.entries(value).map(([key, item]) => ({ at: decimalOf(key), stop: engineColorHex(item), item }))
    if (!keys.length || keys.some((key) => key.at === null || key.at < 0 || key.at > 1 || key.stop === null)) return null
    keys.sort((a, b) => (a.at as number) - (b.at as number))
    if (new Set(keys.map((key) => key.at)).size !== keys.length) return null
    return {
        tint: { kind: 'gradient', stops: keys.map((key) => key.stop as string), at: keys.map((key) => key.at as number) },
        converted: keys.some((key) => typeof key.item !== 'string'),
    }
}

function readTint(raw: unknown, data: CosmeticData, trail: number, changed: string[]): TrailTint {
    if (raw === undefined) return { kind: 'color', color: '#FFFFFF' }
    const asWritten = (): TrailTint => {
        changed.push(`Trail ${trail}'s color is kept as written, since it can't be edited here`)
        return { kind: 'raw', value: cloneJson(raw) }
    }
    if (isRecord(raw) && 'slot' in raw) {
        const tint = readSlotTint(raw, data)
        return tint ? { kind: 'slot', ...tint } : asWritten()
    }
    if (isRecord(raw)) {
        const gradient = Object.keys(raw).length === 1 ? readGradient(raw.gradient) : null
        if (!gradient) return asWritten()
        if (gradient.converted) changed.push(`Trail ${trail}'s gradient colors are now hex codes`)
        return gradient.tint
    }
    const color = engineColorHex(raw)
    if (!color) return asWritten()
    if (typeof raw !== 'string') changed.push(`Trail ${trail}'s color ${JSON.stringify(raw)} is now ${color}`)
    return { kind: 'color', color }
}

function extraKeys(value: Record<string, unknown>, known: readonly string[], at: string, dropped: string[]) {
    for (const key of Object.keys(value)) if (!known.includes(key)) dropped.push(`${at}.${key}`)
}

function plainNumbers(value: Record<string, unknown>, keys: readonly string[], at: string, dropped: string[]) {
    for (const key of keys) {
        const item = value[key]
        if (item === undefined || item === null || typeof item === 'number') continue
        if (typeof item === 'string' && (!item.trim() || decimalOf(item) !== null)) continue
        dropped.push(`${at}.${key}`)
    }
}

function declarations(value: unknown, key: string, dropped: string[]): [string, unknown][] {
    if (isRecord(value)) return Object.entries(value)
    if (!Array.isArray(value)) return []
    const out: [string, unknown][] = []
    value.forEach((item, i) => {
        if (typeof item === 'string') out.push([item, {}])
        else dropped.push(`${key}.${i}`)
    })
    return out
}

function emitterList(items: unknown[], at: string, dropped: string[]): unknown[] {
    return items.filter((item, i) => {
        if (isRecord(item)) {
            extraKeys(item, EMITTER_KEYS, `${at}.${i}`, dropped)
            if (item.vanilla !== undefined) plainNumbers(item, ['count'], `${at}.${i}`, dropped)
            return true
        }
        dropped.push(`${at}.${i}`)
        return false
    })
}

function namedEffects(value: unknown, dropped: string[]): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {}
    if (!isRecord(value)) return out
    for (const [name, items] of Object.entries(value)) {
        const at = `effects.${name}`
        if (Array.isArray(items)) out[name] = emitterList(items, at, dropped)
        else if (isRecord(items)) out[name] = emitterList([items], at, dropped)
        else {
            out[name] = []
            dropped.push(at)
        }
    }
    return out
}

function readEffects(manifest: Record<string, any>, data: CosmeticData, input: BundleFiles, dropped: string[], changed: string[]) {
    const emitters = Array.isArray(manifest.emitters) ? emitterList(manifest.emitters, 'emitters', dropped) : []
    const raw: Record<string, any> = { particles: [], sounds: [], emitters, named: namedEffects(manifest.effects, dropped), trails: [], pictures: {}, audio: {} }
    const binary = input.binary
    const names = new Map<string, string>()
    const picture = (path: string): string => {
        if (!path) return ''
        const known = names.get(path)
        if (known !== undefined) return known
        const png = binary[path]
        const name = png ? uniqueId(pictureNameOf(path) || 'picture', (candidate) => candidate in raw.pictures) : pictureNameOf(path)
        if (png) raw.pictures[name] = toBase64(png)
        names.set(path, name)
        return name
    }
    for (const [id, options] of declarations(manifest.particles, 'particles', dropped)) {
        let json: any = {}
        try {
            json = JSON.parse(input.files[particlePath(id)] ?? '{}')
        } catch {
            json = {}
        }
        const name = picture(particlePicturePath(json?.particle_effect?.description?.basic_render_parameters?.texture))
        if (json?.particle_effect?.description?.basic_render_parameters) json.particle_effect.description.basic_render_parameters.texture = ''
        let tint: SlotTint | null = null
        if (isRecord(options)) {
            extraKeys(options, PARTICLE_OPTION_KEYS, `particles.${id}`, dropped)
            if (options.tint !== undefined) {
                tint = isRecord(options.tint) ? readSlotTint(options.tint, data) : null
                if (!tint) dropped.push(`particles.${id}.tint`)
            }
        }
        raw.particles.push({ id, picture: name, json, tint })
    }
    for (const [id, options] of declarations(manifest.sounds, 'sounds', dropped)) {
        const o = isRecord(options) ? options : {}
        extraKeys(o, SOUND_KEYS, `sounds.${id}`, dropped)
        plainNumbers(o, ['volume', 'pitch'], `sounds.${id}`, dropped)
        raw.sounds.push({ id, file: '', vanilla: o.vanilla ?? '', volume: o.volume ?? 1, pitch: o.pitch ?? 1 })
        const ogg = binary[soundPath(id)]
        if (ogg) raw.audio[id] = toBase64(ogg)
    }
    if (Array.isArray(manifest.trails)) {
        for (const [i, trail] of manifest.trails.entries()) {
            if (!isRecord(trail)) {
                dropped.push(`trails.${i}`)
                continue
            }
            extraKeys(trail, TRAIL_KEYS, `trails.${i}`, dropped)
            const name = picture(trailPicturePath(trail.texture))
            const { texture: _texture, min_speed: minSpeed, ...rest } = trail
            raw.trails.push({ ...rest, picture: name, minSpeed, tint: readTint(trail.tint, data, i + 1, changed) })
        }
    }
    data.effects = normalizeCosmetic({ effects: raw }, data.kind).effects
}

export const effectsPart: BundlePart = {
    write: writeEffects,
    read: readEffects,
}

export function particleStarter(id: string): ParticleData {
    return { id, picture: '', json: starterParticle(id), tint: null }
}

export function storedParticle(particle: ParticleData): ParticleData {
    const json = cloneJson(particle.json)
    const params = json?.particle_effect?.description?.basic_render_parameters
    if (isRecord(params)) params.texture = ''
    return { ...particle, json }
}

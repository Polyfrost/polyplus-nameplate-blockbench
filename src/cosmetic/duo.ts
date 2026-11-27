import type { EmoteActor } from '../engine'
import type { Affine } from './livePose'
import { isRecord } from '../util/json'
import { INTERACTIONS, PetData, PetRoleData, RoleData } from './data'

export const ROLE_IDS = ['a', 'b'] as const
export const PIXELS_PER_BLOCK = 16
export const NO_ROLE = -1
const PET_BODY_WIDTH = 0.5
const PET_GAP = 0.2
const PET_CIRCLE_GAP = 0.6
const CELEBRATE_SIGNAL = 'is_emoting'

export interface Spot {
    x: number
    y: number
    z: number
    yaw: number
}

export interface Seat {
    seat: number
    role: number
    spot: Spot
    actor: EmoteActor
}

export function wrapDegrees(degrees: number): number {
    let a = degrees % 360
    if (a >= 180) a -= 360
    if (a < -180) a += 360
    return a
}

function turn(x: number, z: number, yaw: number): [number, number] {
    const radians = (yaw * Math.PI) / 180
    const s = Math.sin(radians)
    const c = Math.cos(radians)
    return [x * c - z * s, x * s + z * c]
}

export function roleIndex(roles: readonly Pick<RoleData, 'id'>[], seat: number): number {
    const id = ROLE_IDS[seat]
    const found = id === undefined ? -1 : roles.findIndex((role) => role.id === id)
    return found >= 0 ? found : seat
}

export function spotOf(role: Pick<RoleData, 'offset' | 'yaw'>): Spot {
    return { x: role.offset[0], y: role.offset[1], z: role.offset[2], yaw: wrapDegrees(role.yaw) }
}

export function actorAt(role: number, spot: Spot): EmoteActor {
    const [dx, dz] = turn(-spot.x, -spot.z, -spot.yaw)
    return { role, anchor: [dx, -spot.y, dz], yaw: wrapDegrees(-spot.yaw) }
}

export function placement(spot: Spot): Affine {
    const radians = (spot.yaw * Math.PI) / 180
    const s = Math.sin(radians)
    const c = Math.cos(radians)
    return [
        c, 0, -s, spot.x * PIXELS_PER_BLOCK,
        0, 1, 0, spot.y * PIXELS_PER_BLOCK,
        s, 0, c, spot.z * PIXELS_PER_BLOCK,
    ]
}

export function petInteractions(roles: readonly PetRoleData[]): string[] {
    return INTERACTIONS.filter((id) => roles.some((role) => role.interaction === id))
}

export function petSeats(roles: readonly PetRoleData[], interaction: string): Seat[] {
    return ROLE_IDS.map((id, seat) => {
        const role = roles.findIndex((candidate) => candidate.interaction === interaction && candidate.id === id)
        if (role < 0) return null
        const spot = spotOf(roles[role])
        return { seat, role, spot, actor: actorAt(role, spot) }
    }).filter((seat): seat is Seat => seat !== null)
}

export function genericPetSpot(interaction: string, seat: number, scale: number): Spot {
    const half = (PET_BODY_WIDTH * scale) / 2
    const first = seat === 0
    if (interaction === 'follow') return first ? { x: 0, y: 0, z: -(2 * half + PET_CIRCLE_GAP), yaw: 0 } : { x: 0, y: 0, z: 0, yaw: wrapDegrees(180) }
    const reach = half + PET_GAP / 2
    const yaw = interaction === 'nap' ? 90 : first ? 0 : wrapDegrees(180)
    return { x: 0, y: 0, z: first ? -reach : reach, yaw }
}

const PAIRED_MOVES = new Set(['follow', 'chase'])

function genericSeat(interaction: string, seat: number, scale: number): Seat {
    const spot = genericPetSpot(interaction, seat, scale)
    return { seat, role: NO_ROLE, spot, actor: actorAt(NO_ROLE, spot) }
}

export function supportsGeneric(pet: Pick<PetData, 'archetype' | 'interactions'>, interaction: string): boolean {
    if (!(INTERACTIONS as readonly string[]).includes(interaction)) return false
    if (pet.archetype === 'shoulder' && interaction !== 'greet') return false
    const declared = pet.interactions[interaction as keyof PetData['interactions']]
    if (declared) return declared.includes('a') || declared.includes('b')
    return interaction !== 'play'
}

export function petPreviewInteractions(pet: Pick<PetData, 'archetype' | 'interactions'>): string[] {
    return INTERACTIONS.filter((id) => supportsGeneric(pet, id))
}

function genericPair(interaction: string, scale: number, first: number): Seat[] {
    return [genericSeat(interaction, first, scale), genericSeat(interaction, 1 - first, scale)]
}

function declaredSide(declared: readonly string[] | undefined): number {
    return declared && declared.includes(ROLE_IDS[1]) && !declared.includes(ROLE_IDS[0]) ? 1 : 0
}

export function petPairSeats(roles: readonly PetRoleData[], interaction: string, scale: number, declared?: readonly string[]): Seat[] {
    const placed = petSeats(roles, interaction).filter((seat) => !declared || declared.includes(ROLE_IDS[seat.seat]))
    if (placed.length === 0) return (INTERACTIONS as readonly string[]).includes(interaction) ? genericPair(interaction, scale, declaredSide(declared)) : []
    if (placed.length !== 1) return placed
    if (PAIRED_MOVES.has(interaction)) return genericPair(interaction, scale, placed[0].seat)
    return [...placed, genericSeat(interaction, 1 - placed[0].seat, scale)]
}

export const INTERACTION_SECONDS: Readonly<Record<string, number>> = { greet: 3, follow: 6, nap: 30, play: 8, chase: 12 }

export interface PetClip {
    seconds: number
    looping: boolean
    startDelay: number
}

export function petSessionSeconds(interaction: string, clips: ReadonlyArray<PetClip | null>): number {
    let longest = 0
    let looping = false
    for (const clip of clips) {
        if (!clip || !(clip.seconds > 0)) continue
        longest = Math.max(longest, (clip.startDelay > 0 ? clip.startDelay : 0) + clip.seconds)
        if (clip.looping) looping = true
    }
    const base = INTERACTION_SECONDS[interaction] ?? 0
    if (longest <= 0) return base
    return looping ? Math.max(longest, base) : longest
}

const CONSTANT_DELAY = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFdD]?$/

function constantDelay(value: unknown): number | null {
    if (typeof value === 'number') return value
    if (typeof value !== 'string') return null
    const text = value.trim()
    return CONSTANT_DELAY.test(text) ? Number(text.replace(/[fFdD]$/, '')) : null
}

export function startDelays(files: Readonly<Record<string, string>>): Map<string, number> {
    const out = new Map<string, number>()
    for (const [path, text] of Object.entries(files)) {
        if (!path.toLowerCase().endsWith('.json')) continue
        for (const [clip, body] of entries(parsedJson(text), 'animations')) {
            const seconds = isRecord(body) ? constantDelay(body.start_delay) : null
            if (seconds !== null && Number.isFinite(seconds) && seconds > 0) out.set(clip, seconds)
        }
    }
    return out
}

export function petRoleClips(roles: readonly PetRoleData[], seats: readonly Seat[], meta: unknown, files: Readonly<Record<string, string>>): Array<PetClip | null> {
    const clips = new Map<string, Record<string, unknown>>()
    for (const clip of isRecord(meta) && Array.isArray(meta.clips) ? meta.clips : []) if (isRecord(clip) && typeof clip.name === 'string') clips.set(clip.name, clip)
    const delays = startDelays(files)
    return seats.map((seat) => {
        const name = seat.role === NO_ROLE ? undefined : roles[seat.role]?.animation
        if (name === undefined) return null
        const clip = clips.get(name)
        return { seconds: Number(clip?.length) || 0, looping: clip?.loop === 'repeat', startDelay: delays.get(name) ?? 0 }
    })
}

export function isGenericMove(interaction: string, seats: readonly Seat[]): boolean {
    return PAIRED_MOVES.has(interaction) && seats.length === 2 && seats.every((seat) => seat.role === NO_ROLE)
}

export interface PetMotion {
    spots: Spot[]
    speeds: number[]
}

const TICKS_PER_SECOND = 20
const WALK = 0.194
const RUN = 0.3
const FOLLOW_CIRCLE_SPEED = 1.8
const CHASE_SWAP_SECONDS = 4
const CHASE_RADIUS = 2.5
const CHASER_PACE = 0.92
const CHASER_GAP = 0.7
const CIRCLE_STOP = 0.05
const GROUND_FRICTION = 0.546
const ARRIVE_SHARE = 0.5
const MIN_SPEED = 0.02
const REST_SPEED = 0.003
const MAX_TURN = 90

interface Mover {
    x: number
    z: number
    yaw: number
    vx: number
    vz: number
    stride: number
}

interface Goal {
    x: number
    z: number
    speed: number
    stop: number
}

function headingOf(dx: number, dz: number): number | null {
    if (dx * dx + dz * dz < 1.0e-8) return null
    return (Math.atan2(-dx, dz) * 180) / Math.PI
}

function stepMover(mover: Mover, goal: Goal | null) {
    let ax = 0
    let az = 0
    if (goal) {
        const dx = goal.x - mover.x
        const dz = goal.z - mover.z
        const remaining = Math.sqrt(dx * dx + dz * dz)
        if (remaining > goal.stop && remaining > 1.0e-4) {
            const heading = headingOf(dx, dz) ?? mover.yaw
            mover.yaw += Math.max(-MAX_TURN, Math.min(MAX_TURN, wrapDegrees(heading - mover.yaw)))
            const speed = Math.min(goal.speed, Math.max(MIN_SPEED, (remaining - goal.stop) * ARRIVE_SHARE))
            const accel = speed * (1 - GROUND_FRICTION)
            const radians = (mover.yaw * Math.PI) / 180
            ax = -Math.sin(radians) * accel
            az = Math.cos(radians) * accel
        }
    }
    mover.vx += ax
    mover.vz += az
    mover.x += mover.vx
    mover.z += mover.vz
    mover.stride = Math.sqrt(mover.vx * mover.vx + mover.vz * mover.vz)
    mover.vx *= GROUND_FRICTION
    mover.vz *= GROUND_FRICTION
    if (ax === 0 && az === 0 && mover.vx * mover.vx + mover.vz * mover.vz < REST_SPEED * REST_SPEED) {
        mover.vx = 0
        mover.vz = 0
    }
}

function circleGoal(radius: number, phase: number, angle: number, speed: number): Goal {
    return { x: Math.cos(phase + angle) * radius, z: Math.sin(phase + angle) * radius, speed, stop: CIRCLE_STOP }
}

function goalsAt(interaction: string, movers: readonly Mover[], elapsed: number, radius: number, spin: number): Array<Goal | null> {
    if (interaction === 'follow') return [circleGoal(radius, -Math.PI / 2, elapsed * FOLLOW_CIRCLE_SPEED, WALK * 1.3), null]
    const runner = Math.floor(elapsed / CHASE_SWAP_SECONDS) & 1
    const omega = (RUN / radius) * TICKS_PER_SECOND
    return movers.map((_, role) => {
        if (role === runner) return circleGoal(radius, role === 0 ? -Math.PI / 2 : Math.PI / 2, spin * elapsed * omega, RUN)
        const partner = movers[runner]
        return { x: partner.x, z: partner.z, speed: RUN * CHASER_PACE, stop: CHASER_GAP }
    })
}

export function genericPetMotion(interaction: string, scale: number, time: number, spin = 1): PetMotion {
    const start = [genericPetSpot(interaction, 0, scale), genericPetSpot(interaction, 1, scale)]
    if (!PAIRED_MOVES.has(interaction)) return { spots: start, speeds: [0, 0] }
    const radius = interaction === 'follow' ? -start[0].z : CHASE_RADIUS
    const movers: Mover[] = start.map((spot) => ({ x: spot.x, z: spot.z, yaw: spot.yaw, vx: 0, vz: 0, stride: 0 }))
    const ticks = Math.max(0, time) * TICKS_PER_SECOND
    const whole = Math.floor(ticks)
    let before = movers.map((mover) => ({ ...mover }))
    for (let tick = 0; tick <= whole; tick++) {
        before = movers.map((mover) => ({ ...mover }))
        const goals = goalsAt(interaction, movers, tick / TICKS_PER_SECOND, radius, spin)
        movers.forEach((mover, role) => stepMover(mover, goals[role]))
    }
    const t = ticks - whole
    const spots = movers.map((mover, role) => {
        const from = before[role]
        return {
            x: from.x + (mover.x - from.x) * t,
            y: 0,
            z: from.z + (mover.z - from.z) * t,
            yaw: wrapDegrees(from.yaw + wrapDegrees(mover.yaw - from.yaw) * t),
        }
    })
    return { spots, speeds: movers.map((mover) => mover.stride * TICKS_PER_SECOND) }
}

export function petPairSignals(values: Readonly<Record<string, number>>, interaction: string, seat: Seat): Readonly<Record<string, number>> {
    const celebrating = interaction === 'greet' || (interaction === 'play' && seat.role === NO_ROLE)
    return celebrating ? { ...values, [CELEBRATE_SIGNAL]: 1 } : values
}

export function seats(roles: readonly RoleData[]): Seat[] {
    return ROLE_IDS.map((_, seat) => {
        const role = roleIndex(roles, seat)
        const data = roles[role]
        if (!data) return null
        const spot = spotOf(data)
        return { seat, role, spot, actor: actorAt(role, spot) }
    }).filter((seat): seat is Seat => seat !== null)
}

function parsedJson(text: string | undefined): unknown {
    try {
        return text ? JSON.parse(text) : null
    } catch {
        return null
    }
}

function entries(value: unknown, key: string): Array<[string, unknown]> {
    return isRecord(value) && isRecord(value[key]) ? Object.entries(value[key] as Record<string, unknown>) : []
}

function resolveClip(names: readonly string[], key: string): string | null {
    if (names.includes(key)) return key
    const found = names.filter((name) => name.endsWith(`.${key}`))
    return found.length === 1 ? found[0] : null
}

export function controllerPlayLength(files: Readonly<Record<string, string>>): number {
    const clips = new Map<string, number>()
    const controllers = new Map<string, unknown>()
    for (const [path, text] of Object.entries(files)) {
        if (path.startsWith('animations/')) for (const [name, clip] of entries(parsedJson(text), 'animations')) clips.set(name, isRecord(clip) ? Math.max(0, Number(clip.animation_length) || 0) : 0)
        if (path.startsWith('animation_controllers/')) for (const [name, controller] of entries(parsedJson(text), 'animation_controllers')) controllers.set(name, controller)
    }
    const manifest = parsedJson(files['manifest.json'])
    const picked = isRecord(manifest) && Array.isArray(manifest.controllers) ? manifest.controllers.filter((name): name is string => typeof name === 'string') : [...controllers.keys()]
    const names = [...clips.keys()]
    const used = new Set<string>()
    for (const name of picked) {
        for (const [, state] of entries(controllers.get(name), 'states')) {
            for (const entry of isRecord(state) && Array.isArray(state.animations) ? state.animations : []) {
                const key = typeof entry === 'string' ? entry : isRecord(entry) ? Object.keys(entry)[0] : undefined
                const clip = key ? resolveClip(names, key) : null
                if (clip) used.add(clip)
            }
        }
    }
    const delays = startDelays(files)
    let total = 0
    for (const clip of used) total += (delays.get(clip) ?? 0) + (clips.get(clip) ?? 0)
    return total
}

export function rolePlayLength(names: readonly string[], files: Readonly<Record<string, string>>, lengthOf: (name: string) => number): number {
    const delays = startDelays(files)
    let longest = 0
    for (const name of names) longest = Math.max(longest, (delays.get(name) ?? 0) + lengthOf(name))
    return longest
}

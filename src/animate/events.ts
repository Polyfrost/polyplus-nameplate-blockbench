import { textHash } from '../util/hash'
import { isRecord } from '../util/json'
import { wholeOr } from '../util/num'

const C1 = 0xcc9e2d51 | 0
const C2 = 0x1b873593
const ROUND_ADD = 0xe6546b64 | 0
const FMIX_1 = 0x85ebca6b | 0
const FMIX_2 = 0xc2b2ae35 | 0
const HASH_BYTES = 12
const DERIVE_BYTES = 4
const SALT_CHANCE = 1
const SALT_PICK = 2
const SALT_START = 3
const CHANCE_SHIFT = 8
const CHANCE_ONE = 1 << 24

interface ScheduleMember {
    name: string
    weight: number
    length: number
}

export interface ScheduleTiming {
    id: string
    window: number
    jitter: number
    chance: number
    step: number
    members: ScheduleMember[]
}

interface ScheduleEvent {
    name: string
    frame: number
    length: number
}

function rotateLeft(value: number, bits: number): number {
    return (value << bits) | (value >>> (32 - bits))
}

function mix(hash: number, value: number): number {
    const k = Math.imul(rotateLeft(Math.imul(value, C1), 15), C2)
    return (Math.imul(rotateLeft(hash ^ k, 13), 5) + ROUND_ADD) | 0
}

function finish(hash: number, length: number): number {
    let h = hash ^ length
    h ^= h >>> 16
    h = Math.imul(h, FMIX_1)
    h ^= h >>> 13
    h = Math.imul(h, FMIX_2)
    return h ^ (h >>> 16)
}

function seededHash(seed: number, id: number, index: number): number {
    return finish(mix(mix(mix(0, seed | 0), id), index | 0), HASH_BYTES)
}

function derive(hash: number, salt: number): number {
    return finish(mix(hash, salt), DERIVE_BYTES)
}

function windowEvent(timing: ScheduleTiming, seed: number, window: number): { member: number, start: number } | null {
    const total = timing.members.reduce((sum, member) => sum + member.weight, 0)
    if (total < 1 || timing.members.length === 0) return null
    const hash = seededHash(seed, textHash(timing.id), window)
    if (derive(hash, SALT_CHANCE) >>> CHANCE_SHIFT >= Math.round(timing.chance * CHANCE_ONE)) return null
    let pick = (derive(hash, SALT_PICK) >>> 1) % total
    let member = 0
    while (member < timing.members.length - 1 && pick >= timing.members[member].weight) {
        pick -= timing.members[member].weight
        member++
    }
    const start = (derive(hash, SALT_START) >>> 1) % (Math.max(0, timing.jitter) + 1)
    return { member, start }
}

export function scheduleEvents(timing: ScheduleTiming, seed: number, frames: number, limit: number): ScheduleEvent[] {
    const events: ScheduleEvent[] = []
    const step = Math.max(1, timing.step)
    if (!(timing.window >= 1)) return events
    for (let window = 0; window * timing.window * step < frames && events.length < limit; window++) {
        const event = windowEvent(timing, seed, window)
        if (!event) continue
        const frame = (window * timing.window + event.start) * step
        if (frame >= frames) break
        const member = timing.members[event.member]
        events.push({ name: member.name, frame, length: member.length * step })
    }
    return events
}

export function scheduleTimings(files: Record<string, string>): Map<string, ScheduleTiming> {
    const timings = new Map<string, ScheduleTiming>()
    let manifest: any
    try {
        manifest = JSON.parse(files['manifest.json'] ?? '')
    } catch {
        return timings
    }
    const animations = isRecord(manifest?.animations) ? manifest.animations : {}
    const targets = new Map<string, Set<string>>()
    for (const name of Object.keys(animations)) {
        const animation = animations[name]
        const schedule = isRecord(animation) ? animation.schedule : null
        if (!isRecord(schedule)) continue
        const id = typeof schedule.id === 'string' ? schedule.id : name
        let timing = timings.get(id)
        if (!timing) {
            timing = {
                id,
                window: wholeOr(schedule.window, 0),
                jitter: wholeOr(schedule.jitter, 0),
                chance: Number.isFinite(Number(schedule.chance)) ? Number(schedule.chance) : 1,
                step: 1,
                members: [],
            }
            timings.set(id, timing)
            targets.set(id, new Set())
        }
        timing.members.push({ name, weight: Math.max(0, wholeOr(schedule.weight, 1)), length: Math.max(1, wholeOr(animation.length, 1)) })
        for (const target of Object.keys(isRecord(animation.tracks) ? animation.tracks : {})) targets.get(id)!.add(target)
    }
    const layers: any[] = Array.isArray(manifest?.layers) ? manifest.layers : []
    for (const timing of timings.values()) {
        const used = targets.get(timing.id)!
        const layer = layers.find((entry) => isRecord(entry) && used.has(String(entry.id)))
        timing.step = Math.max(1, wholeOr(layer?.step, 1))
    }
    return timings
}

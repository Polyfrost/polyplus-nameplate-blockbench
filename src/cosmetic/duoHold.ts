export const EMOTE_ENDED = 1 << 1
export const EMOTE_CANCEL = 1 << 2
export const EMOTE_CANCEL_WALKING = 1 << 4
export const EMOTE_CANCEL_SPRINTING = 1 << 5
export const EMOTE_CANCEL_CROUCHING = 1 << 6
export const EMOTE_CANCEL_FALLING = 1 << 7
export const EMOTE_CANCEL_ELYTRA_FLYING = 1 << 8
export const EMOTE_CANCEL_SWIMMING = 1 << 9
export const EMOTE_CANCEL_SLEEPING = 1 << 10
export const EMOTE_CANCEL_SWINGING = 1 << 11
export const EMOTE_HELD = 1 << 12
export const HOLD_STEP_SECONDS = 1 / 20
export const ROLE_FADE_SECONDS = 0.25

const MOVE_CANCELS = EMOTE_CANCEL_WALKING | EMOTE_CANCEL_SPRINTING
const KEPT_CANCELS = EMOTE_CANCEL_CROUCHING | EMOTE_CANCEL_FALLING | EMOTE_CANCEL_ELYTRA_FLYING | EMOTE_CANCEL_SWIMMING | EMOTE_CANCEL_SLEEPING | EMOTE_CANCEL_SWINGING

export type HoldStep = 'play' | 'hold' | 'end'

function movedOnly(status: number): boolean {
    return (status & MOVE_CANCELS) !== 0 && (status & KEPT_CANCELS) === 0
}

export function holdStep(status: number, holding: boolean, shared: () => boolean, partnerDone: () => boolean, onMark: () => boolean = () => false): HoldStep {
    if (status < 0) return 'end'
    if ((status & EMOTE_CANCEL) !== 0 && !(movedOnly(status) && onMark())) return 'end'
    if (!holding) {
        if ((status & (EMOTE_ENDED | EMOTE_HELD)) === 0) return 'play'
        if (!shared()) return 'end'
    }
    return partnerDone() ? 'end' : 'hold'
}

export interface RoleHold {
    holding: boolean
    heldAge: number
    heldFrom: number
    stopping: boolean
    stoppedAt: number
}

export interface HoldInput {
    age: number
    held: boolean
    stopped: boolean
}

export function freshHolds(count: number): RoleHold[] {
    return Array.from({ length: count }, () => ({ holding: false, heldAge: 0, heldFrom: 0, stopping: false, stoppedAt: 0 }))
}

export function holdInput(hold: RoleHold, age: number): HoldInput {
    return { age: hold.holding ? hold.heldAge : age, held: hold.holding && !hold.stopping, stopped: hold.stopping }
}

export function reactHolds(holds: RoleHold[], statuses: readonly number[], age: number) {
    const finished = holds.map((hold) => hold.stopping || hold.holding)
    holds.forEach((hold, i) => {
        if (hold.stopping) return
        const shared = () => holds.length > 1
        const step = holdStep(statuses[i] ?? 0, hold.holding, shared, () => finished.some((done, j) => j !== i && done), shared)
        if (step === 'hold' && !hold.holding) {
            hold.holding = true
            hold.heldAge = age
            hold.heldFrom = age
        } else if (step === 'end') {
            hold.stopping = true
            hold.stoppedAt = age
        }
    })
}

export function holdsFinished(holds: readonly RoleHold[], age: number): boolean {
    return holds.length > 0 && holds.every((hold) => hold.stopping && age - hold.stoppedAt >= ROLE_FADE_SECONDS)
}

export function holdTicks(after: number, through: number): number[] {
    const ticks: number[] = []
    const first = Math.floor(after / HOLD_STEP_SECONDS + 1e-9) + 1
    const last = Math.floor(through / HOLD_STEP_SECONDS + 1e-9)
    for (let k = Math.max(0, first); k <= last; k++) ticks.push(Math.min(k * HOLD_STEP_SECONDS, through))
    return ticks
}

import { EVENT_JUMP } from '../engine'

export type Move = 'jump' | 'turn' | 'sprint' | 'fall' | 'glide'

export const MOVES: ReadonlyArray<{ id: Move, label: string, title: string }> = [
    { id: 'jump', label: 'Jump', title: 'Jump once' },
    { id: 'turn', label: 'Turn', title: 'Turn a quarter to the left' },
    { id: 'sprint', label: 'Sprint', title: 'Sprint forward for a moment' },
    { id: 'fall', label: 'Fall', title: 'Drop from a few blocks up' },
    { id: 'glide', label: 'Glide', title: 'Glide forward and land' },
]

const GRAVITY = 32
const JUMP_SPEED = 8.4
const SPRINT_SPEED = 5.6
const SPRINT_SECONDS = 1.5
const GLIDE_SPEED = 10
const GLIDE_SINK = 1.5
const GLIDE_SECONDS = 2
const GLIDE_HEIGHT = 3
const FALL_HEIGHT = 4
const TURN_SECONDS = 0.25
const TURN_ANGLE = Math.PI / 2
const MAX_STEP = 0.1

export interface MoveFrame {
    root: number[]
    signals: Record<string, number>
    events: number
}

export class Mover {
    x = 0
    y = 0
    z = 0
    yaw = 0
    vy = 0
    private sprint = 0
    private glide = 0
    private turnLeft = 0
    private events = 0

    start(move: Move) {
        if (move === 'jump' && this.grounded()) {
            this.vy = JUMP_SPEED
            this.events |= EVENT_JUMP
        } else if (move === 'turn') {
            this.turnLeft += TURN_ANGLE
        } else if (move === 'sprint') {
            this.sprint = SPRINT_SECONDS
        } else if (move === 'fall') {
            this.y = Math.max(this.y, FALL_HEIGHT)
            this.vy = 0
            this.glide = 0
        } else if (move === 'glide') {
            this.y = Math.max(this.y, GLIDE_HEIGHT)
            this.vy = -GLIDE_SINK
            this.glide = GLIDE_SECONDS
        }
    }

    grounded(): boolean {
        return this.y <= 0 && this.vy <= 0
    }

    busy(): boolean {
        return this.sprint > 0 || this.glide > 0 || this.turnLeft > 0 || !this.grounded()
    }

    step(seconds: number): MoveFrame {
        const dt = Math.max(0, Math.min(MAX_STEP, seconds))
        if (this.turnLeft > 0) {
            const turn = Math.min(this.turnLeft, (TURN_ANGLE / TURN_SECONDS) * dt)
            this.yaw += turn
            this.turnLeft -= turn
        }
        let speed = 0
        if (this.glide > 0) {
            speed = GLIDE_SPEED
            this.glide = Math.max(0, this.glide - dt)
            this.vy = -GLIDE_SINK
        } else if (this.sprint > 0) {
            speed = SPRINT_SPEED
            this.sprint = Math.max(0, this.sprint - dt)
        }
        if (this.glide <= 0 && !this.grounded()) this.vy -= GRAVITY * dt
        this.y += this.vy * dt
        if (this.y <= 0) {
            this.y = 0
            this.vy = 0
            this.glide = 0
        }
        this.x -= Math.sin(this.yaw) * speed * dt
        this.z += Math.cos(this.yaw) * speed * dt
        const ground = this.grounded()
        const events = this.events
        this.events = 0
        const signals: Record<string, number> = {
            is_on_ground: ground ? 1 : 0,
            is_falling: !ground && this.glide <= 0 && this.vy < 0 ? 1 : 0,
            is_gliding: this.glide > 0 ? 1 : 0,
            is_sprinting: this.sprint > 0 ? 1 : 0,
            is_moving: speed > 0 || !ground ? 1 : 0,
            ground_speed: speed,
            vertical_speed: this.vy,
        }
        return { root: this.root(), signals, events }
    }

    root(): number[] {
        const c = Math.cos(this.yaw)
        const s = Math.sin(this.yaw)
        return [c, 0, s, this.x, 0, 1, 0, this.y, -s, 0, c, this.z]
    }
}

export function withMoves(chosen: Readonly<Record<string, number>>, moved: Readonly<Record<string, number>>, moving: boolean): Record<string, number> {
    const out: Record<string, number> = { ...chosen }
    for (const [name, value] of Object.entries(moved)) {
        if (name === 'is_on_ground' && moving) out[name] = value
        else if (name.startsWith('is_')) out[name] = Math.max(chosen[name] ?? 0, value)
        else if (moving) out[name] = value
    }
    return out
}

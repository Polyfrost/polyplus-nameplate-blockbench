import { decimalClamped, wholeClamped } from '../util/num'

const NOTICE_TIME = 6000
const pending: string[] = []

function showPending() {
    Blockbench.showQuickMessage(pending.splice(0).join(' '), NOTICE_TIME)
}

export function tell(message: string) {
    if (pending.length === 0) queueMicrotask(showPending)
    if (!pending.includes(message)) pending.push(message)
}

export function noteLimit(value: unknown, min: number, max: number, label: string, advice = '') {
    const number = Number(value)
    const tail = advice ? ` ${advice}` : ''
    if (number > max) tell(`${label} can be at most ${max}, so it was set to ${max}.${tail}`)
    else if (number < min) tell(`${label} can't be below ${min}, so it was set to ${min}.${tail}`)
}

export function limited(value: unknown, min: number, max: number, fallback: number, label: string): number {
    noteLimit(value, min, max, label)
    return wholeClamped(value, min, max, fallback)
}

export function limitedValue(value: unknown, min: number, max: number, fallback: number, label: string): number {
    noteLimit(value, min, max, label)
    const number = Number(value)
    return isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function pairOf(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

export function limitedPair(value: unknown, min: number, max: number, label: string): [number, number] {
    const [first, second] = pairOf(value)
    for (const part of [first, second]) noteLimit(part, min, max, label)
    return [wholeClamped(first, min, max, 0), wholeClamped(second, min, max, 0)]
}

export function limitedDecimals(value: unknown, limit: number, label: string): [number, number] {
    const [first, second] = pairOf(value)
    for (const part of [first, second]) noteLimit(part, -limit, limit, label)
    return [decimalClamped(first, -limit, limit, 0), decimalClamped(second, -limit, limit, 0)]
}

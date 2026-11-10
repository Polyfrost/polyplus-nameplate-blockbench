import { Channel, Interpolation, KeyData } from '../model'
import { round3 } from '../util/num'

const EASE_UNITS = 1024
const OPACITY_UNITS = 255
const ON_KEY = 1 / 1200
const CACHE_LIMIT = 512
const FIT_ORDER: Interpolation[] = ['ease', 'linear']
const SLACK = 0.02

type Units = number[]

interface Target {
    at: Units
    raw: Units
}

const cache = new Map<string, KeyData[]>()

function roundedDivide(numerator: number, denominator: number): number {
    return Math.floor((2 * numerator + denominator) / (2 * denominator))
}

function smoothstep(elapsed: number, span: number): number {
    return Math.floor((elapsed * elapsed * (3 * span - 2 * elapsed) * EASE_UNITS) / (span * span * span))
}

function engineBlend(mode: Interpolation, from: number, to: number, elapsed: number, span: number): number {
    const delta = to - from
    if (mode === 'linear') return from + roundedDivide(delta * elapsed, span)
    if (mode === 'ease') return from + roundedDivide(delta * smoothstep(elapsed, span), EASE_UNITS)
    return from
}

function axesOf(channel: Channel): Array<'x' | 'y'> {
    return channel === 'position' ? ['x', 'y'] : ['x']
}

function quantize(channel: Channel, value: number): number {
    if (channel === 'opacity') return Math.floor(Math.min(1, Math.max(0, value)) * OPACITY_UNITS + 0.5)
    return Math.floor(value + 0.5)
}

function exact(units: Units): Target {
    return { at: units, raw: units }
}

function sampled(channel: Channel, values: number[]): Target {
    const raw = channel === 'opacity' ? values.map((value) => Math.min(1, Math.max(0, value)) * OPACITY_UNITS) : values
    return { at: raw.map((value) => Math.floor(value + 0.5)), raw }
}

function keyUnits(channel: Channel, key: KeyData): Units {
    if (channel === 'position' && Array.isArray(key.value)) return [key.value[0], key.value[1]]
    return [quantize(channel, Number(key.value))]
}

function unitsValue(channel: Channel, units: Units): KeyData['value'] {
    if (channel === 'position') return [units[0] + 0, units[1] + 0]
    return units[0] / OPACITY_UNITS
}

function calc(keyframe: any, axis: 'x' | 'y', point = 0): number {
    const value = Number(keyframe.calc(axis, point))
    return isFinite(value) ? value : 0
}

function lastPoint(keyframe: any): number {
    return Array.isArray(keyframe?.data_points) && keyframe.data_points.length > 1 ? keyframe.data_points.length - 1 : 0
}

function handle(list: unknown, axis: number): number {
    const value = Array.isArray(list) ? Number(list[axis]) : 0
    return isFinite(value) ? value : 0
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
    const u = 1 - t
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

function bezierValue(before: any, after: any, axis: 'x' | 'y', time: number): number {
    const index = axis === 'x' ? 0 : 1
    const gap = after.time - before.time
    const from = calc(before, axis, lastPoint(before))
    const to = calc(after, axis, 0)
    const x1 = before.time + Math.min(gap, Math.max(0, handle(before.bezier_right_time, index)))
    const x2 = after.time + Math.min(0, Math.max(-gap, handle(after.bezier_left_time, index)))
    const y1 = from + handle(before.bezier_right_value, index)
    const y2 = to + handle(after.bezier_left_value, index)
    let low = 0
    let high = 1
    for (let step = 0; step < 48; step++) {
        const middle = (low + high) / 2
        if (cubic(before.time, x1, x2, after.time, middle) < time) low = middle
        else high = middle
    }
    return cubic(from, y1, y2, to, (low + high) / 2)
}

function sortedKeyframes(keyframes: any[]): any[] {
    return keyframes.filter((keyframe) => keyframe && isFinite(Number(keyframe.time))).slice().sort((a, b) => a.time - b.time)
}

function blockbenchValue(sorted: any[], time: number, axis: 'x' | 'y', loop: string): number {
    let before: any = null
    let after: any = null
    for (const keyframe of sorted) {
        if (keyframe.time < time) {
            if (!before || keyframe.time > before.time) before = keyframe
        } else if (!after || keyframe.time < after.time) {
            after = keyframe
        }
    }
    if (before && Math.abs(before.time - time) <= ON_KEY) return calc(before, axis, lastPoint(before))
    if (after && Math.abs(after.time - time) <= ON_KEY) return calc(after, axis, 0)
    if (before && (before.interpolation === 'step' || !after)) return calc(before, axis, lastPoint(before))
    if (after && !before) return calc(after, axis, 0)
    if (!before || !after) return NaN
    const alpha = (time - before.time) / (after.time - before.time)
    if (before.interpolation === 'catmullrom' || after.interpolation === 'catmullrom') {
        const index = sorted.indexOf(before)
        let previous = sorted[index - 1]
        let next = sorted[index + 2]
        if (loop === 'loop' && sorted.length >= 3) {
            if (!previous) previous = sorted[sorted.length - 2]
            if (!next) next = sorted[1]
        }
        return Number(before.getCatmullromLerp(previous, before, after, next, axis, alpha))
    }
    if (before.interpolation === 'bezier' || after.interpolation === 'bezier') {
        return bezierValue(before, after, axis, time)
    }
    const from = calc(before, axis, lastPoint(before))
    return from + (calc(after, axis, 0) - from) * alpha
}

function fits(mode: Interpolation, start: number, from: Units, end: number, to: Units, wanted: Map<number, Target>): boolean {
    for (let frame = start + 1; frame < end; frame++) {
        const target = wanted.get(frame)!
        for (let axis = 0; axis < target.at.length; axis++) {
            const value = engineBlend(mode, from[axis], to[axis], frame - start, end - start)
            if (value === target.at[axis]) continue
            const slack = SLACK + (mode === 'ease' ? Math.abs(to[axis] - from[axis]) / EASE_UNITS : 0)
            if (value < Math.floor(target.raw[axis] - slack + 0.5) || value > Math.floor(target.raw[axis] + slack + 0.5)) return false
        }
    }
    return true
}

function fitting(start: number, from: Units, end: number, to: Units, wanted: Map<number, Target>): Interpolation | null {
    return FIT_ORDER.find((mode) => fits(mode, start, from, end, to, wanted)) ?? null
}

function fitSegment(channel: Channel, from: KeyData, to: KeyData, wanted: Map<number, Target>): KeyData[] {
    const startUnits = keyUnits(channel, from)
    const endUnits = keyUnits(channel, to)
    const whole = fitting(from.step, startUnits, to.step, endUnits, wanted)
    if (whole) return [{ ...to, interpolation: whole }]
    const result: KeyData[] = []
    let anchor = from.step
    let anchorUnits = startUnits
    while (anchor < to.step) {
        let reach = anchor + 1
        let mode: Interpolation = 'linear'
        for (let end = anchor + 1; end <= to.step; end++) {
            const units = end === to.step ? endUnits : wanted.get(end)!.at
            const found = fitting(anchor, anchorUnits, end, units, wanted)
            if (!found) break
            reach = end
            mode = found
        }
        const units = reach === to.step ? endUnits : wanted.get(reach)!.at
        result.push(reach === to.step ? { ...to, interpolation: mode } : { step: reach, value: unitsValue(channel, units), interpolation: mode })
        anchor = reach
        anchorUnits = units
    }
    return result
}

function plain(key: KeyData): boolean {
    return key.molang === undefined || key.molang === null
}

function cacheKey(channel: Channel, sorted: any[], keys: KeyData[], fps: number, loop: string, grain: number): string {
    const raw = sorted.map((keyframe) => [
        keyframe.time,
        keyframe.interpolation,
        keyframe.data_points,
        keyframe.bezier_left_time,
        keyframe.bezier_left_value,
        keyframe.bezier_right_time,
        keyframe.bezier_right_value,
    ])
    return JSON.stringify([channel, fps, loop, grain, raw, keys])
}

function cloneKeys(keys: KeyData[]): KeyData[] {
    return keys.map((key) => ({ ...key, value: Array.isArray(key.value) ? [...key.value] : key.value }) as KeyData)
}

function remember(key: string, keys: KeyData[]): KeyData[] {
    if (cache.size >= CACHE_LIMIT) cache.clear()
    cache.set(key, cloneKeys(keys))
    return cloneKeys(keys)
}

function bendable(from: KeyData, to: KeyData, grain: number): boolean {
    return to.interpolation === 'ease' && plain(from) && plain(to) && from.step % grain === 0 && to.step % grain === 0 && (to.step - from.step) / grain >= 2
}

function inGrain(key: KeyData, grain: number): KeyData {
    return { ...key, step: key.step / grain }
}

export function curvedKeys(channel: Channel, keys: KeyData[], keyframes: any[], fps: number, loop: string, grain = 1): KeyData[] {
    if (channel !== 'position' && channel !== 'opacity') return keys
    const size = Math.max(1, Math.round(grain))
    if (!keys.some((key, index) => index > 0 && bendable(keys[index - 1], key, size))) return keys
    const sorted = sortedKeyframes(keyframes)
    const id = cacheKey(channel, sorted, keys, fps, String(loop ?? ''), size)
    const known = cache.get(id)
    if (known) return cloneKeys(known)
    try {
        const result: KeyData[] = [keys[0]]
        for (let index = 1; index < keys.length; index++) {
            const from = keys[index - 1]
            const to = keys[index]
            if (!bendable(from, to, size)) {
                result.push(to)
                continue
            }
            const start = from.step / size
            const end = to.step / size
            const wanted = new Map<number, Target>()
            let usable = true
            for (let at = start + 1; at < end && usable; at++) {
                const values = axesOf(channel).map((axis) => blockbenchValue(sorted, (at * size) / fps, axis, loop))
                if (values.some((value) => !isFinite(value))) usable = false
                wanted.set(at, sampled(channel, values))
            }
            const fitted = usable ? fitSegment(channel, inGrain(from, size), inGrain(to, size), wanted) : [inGrain(to, size)]
            result.push(...fitted.map((key) => ({ ...key, step: key.step * size })))
        }
        return remember(id, result)
    } catch (error) {
        console.error('[polyplus_nameplate] could not follow a keyframe curve', error)
        return keys
    }
}

export function closingKeys(channel: Channel, previous: KeyData, closing: KeyData, length: number): KeyData[] {
    const span = length - previous.step
    if (closing.interpolation === 'step' || span < 2 || (channel !== 'position' && channel !== 'opacity') || !plain(previous) || !plain(closing)) return []
    const from = keyUnits(channel, previous)
    const to = keyUnits(channel, closing)
    if (from.every((value, axis) => value === to[axis])) return []
    const wanted = new Map<number, Target>()
    for (let frame = previous.step + 1; frame < length; frame++) {
        wanted.set(frame, exact(from.map((value, axis) => engineBlend(closing.interpolation, value, to[axis], frame - previous.step, span))))
    }
    const last = wanted.get(length - 1)!.at
    return fitSegment(channel, previous, { step: length - 1, value: unitsValue(channel, last), interpolation: closing.interpolation }, wanted)
}

function easeWeight(mode: Interpolation, elapsed: number, span: number): number {
    if (mode === 'linear') return elapsed / span
    if (mode === 'ease') {
        const t = elapsed / span
        return t * t * (3 - 2 * t)
    }
    return 0
}

export function closingSpeed<T extends { step: number, value: number, interpolation: Interpolation }>(previous: T, closing: T, cycle: number): T | null {
    const span = cycle - previous.step
    if (closing.interpolation === 'step' || span < 2 || closing.value === previous.value) return null
    const value = previous.value + (closing.value - previous.value) * easeWeight(closing.interpolation, span - 1, span)
    return { ...closing, step: cycle - 1, value: round3(value) }
}

export function curvedMolangKeys(keys: KeyData[]): number[] {
    const steps: number[] = []
    keys.forEach((key, index) => {
        if (index === 0 || key.interpolation !== 'ease' || key.step - keys[index - 1].step < 2) return
        if (!plain(key) || !plain(keys[index - 1])) steps.push(index)
    })
    return steps
}

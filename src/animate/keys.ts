import { channelName } from './checks'
import { currentFps } from './dialog'
import { allAnimations } from '../util/animation'
import { undoEdit } from '../util/undo'

const ON_FRAME = 1e-4

interface KeyTimingProblem {
    animation: any
    message: string
}

interface PlacedKey {
    keyframe: any
    animator: any
    index: number
}

function keysOf(animation: any): PlacedKey[] {
    const result: PlacedKey[] = []
    for (const animator of Object.values<any>(animation?.animators ?? {})) {
        const keyframes: any[] = Array.isArray(animator?.keyframes) ? animator.keyframes : []
        keyframes.forEach((keyframe, index) => {
            if (keyframe && isFinite(Number(keyframe.time))) result.push({ keyframe, animator, index })
        })
    }
    return result
}

function sorted(keys: PlacedKey[]): PlacedKey[] {
    return keys.slice().sort((a, b) => a.keyframe.time - b.keyframe.time || a.index - b.index)
}

function offGrid(time: number, fps: number): boolean {
    const frame = time * fps
    return Math.abs(frame - Math.round(frame)) > ON_FRAME
}

function merges(keys: PlacedKey[], fps: number): number {
    const seen = new Set<string>()
    let count = 0
    for (const { keyframe, animator } of keys) {
        const slot = `${animator.uuid}:${keyframe.channel}:${Math.round(keyframe.time * fps)}`
        if (seen.has(slot)) count++
        seen.add(slot)
    }
    return count
}

export function keyTimingProblems(): KeyTimingProblem[] {
    const fps = currentFps()
    const problems: KeyTimingProblem[] = []
    for (const animation of allAnimations()) {
        const keys = sorted(keysOf(animation))
        const off = keys.filter((entry) => offGrid(entry.keyframe.time, fps))
        if (off.length === 0) continue
        const first = off[0]
        const below = Math.floor(first.keyframe.time * fps)
        const count = off.length === 1 ? '1 keyframe sits' : `${off.length} keyframes sit`
        const merged = merges(keys, fps)
        const lost = merged === 0
            ? ''
            : ` ${merged === 1 ? '1 of them lands' : `${merged} of them land`} on a frame that already has a keyframe, so only the later one is kept.`
        problems.push({
            animation,
            message: `Animation '${animation.name}': ${count} between frames, for example ${channelName(String(first.keyframe.channel))} on '${first.animator.name}', between frames ${below} and ${below + 1}. Export moves each to the nearest frame (${fps} frames per second).${lost} Use Snap keyframes to frames to fix it now.`,
        })
    }
    return problems
}

function handleTimes(value: unknown): number[] | null {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && isFinite(entry)) ? value : null
}

function keepHandles(keyframe: any, shift: number) {
    if (keyframe?.interpolation !== 'bezier' || shift === 0) return
    const left = handleTimes(keyframe.bezier_left_time)
    const right = handleTimes(keyframe.bezier_right_time)
    if (!left || !right) return
    for (let axis = 0; axis < Math.min(left.length, right.length); axis++) {
        const before = Math.min(0, left[axis] + shift)
        const after = Math.max(0, right[axis] + shift)
        if (keyframe.bezier_linked) {
            const reach = (after - before) / 2
            left[axis] = -reach
            right[axis] = reach
        } else {
            left[axis] = before
            right[axis] = after
        }
    }
}

export function snapKeysToFrames(): number {
    const fps = currentFps()
    const touched = allAnimations().filter((animation) => keysOf(animation).some((entry) => offGrid(entry.keyframe.time, fps)))
    if (touched.length === 0) return 0
    let moved = 0
    undoEdit({ animations: touched }, 'Snap keyframes to frames', () => {
        for (const animation of touched) {
            const kept = new Map<string, any>()
            for (const { keyframe, animator } of sorted(keysOf(animation))) {
                const frame = Math.round(keyframe.time * fps)
                const slot = `${animator.uuid}:${keyframe.channel}:${frame}`
                const earlier = kept.get(slot)
                if (earlier) earlier.remove()
                kept.set(slot, keyframe)
                if (offGrid(keyframe.time, fps)) moved++
                const time = frame / fps
                keepHandles(keyframe, keyframe.time - time)
                keyframe.time = time
            }
        }
    })
    if (typeof Animator.preview === 'function') Animator.preview()
    return moved
}

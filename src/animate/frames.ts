import { currentFps, isNameplateActive } from '../format'
import { round3 } from '../util/num'

const RETURNING_CHANNELS = new Set(['position', 'opacity'])
const KEY_AXES = ['x', 'y', 'z']

function frameOf(seconds: number): number {
    return Math.round(Number(seconds) * currentFps())
}

function timeline(): any {
    return (globalThis as any).Timeline
}

function syncReadout(framesOnly = isNameplateActive()) {
    const stamp = document.getElementById('timeline_timestamp')
    if (!stamp) return
    const display = framesOnly ? 'none' : ''
    stamp.style.display = display
    const divider = stamp.nextElementSibling as HTMLElement | null
    if (divider && divider.id !== 'timeline_framenumber') divider.style.display = display
}

function patchRuler(): () => void {
    const vue = timeline()?.vue
    if (typeof vue?.updateTimecodes !== 'function') return () => {}
    const original = vue.updateTimecodes
    const patched = function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args)
        if (isNameplateActive()) for (const timecode of vue.timecodes ?? []) timecode.text = frameOf(timecode.time)
        return result
    }
    vue.updateTimecodes = patched
    return () => {
        if (vue.updateTimecodes === patched) vue.updateTimecodes = original
    }
}

function patchReadout(): () => void {
    const owner = timeline()
    if (typeof owner?.setTimecode !== 'function') return () => {}
    const original = owner.setTimecode
    const patched = function (this: unknown, time: number) {
        const result = original.call(this, time)
        syncReadout()
        if (isNameplateActive() && owner.vue) owner.vue.framenumber = frameOf(time)
        return result
    }
    owner.setTimecode = patched
    return () => {
        if (owner.setTimecode === patched) owner.setTimecode = original
    }
}

function patchSecondsSlider(id: string, round: (frames: number) => number = (frames) => frames): () => void {
    const slider = typeof BarItems === 'undefined' ? undefined : (BarItems as any)[id]
    if (typeof slider?.get !== 'function' || typeof slider.change !== 'function') return () => {}
    const { get, change, getInterval } = slider
    const patchedGet = function (this: unknown) {
        const time = get.call(this)
        return isNameplateActive() ? round3(Number(time) * currentFps()) : time
    }
    const patchedChange = function (this: unknown, modify: (value: number) => number) {
        if (!isNameplateActive()) return change.call(this, modify)
        const fps = currentFps()
        return change.call(this, (time: number) => round(modify(time * fps)) / fps)
    }
    const patchedInterval = function (this: unknown, event?: Event) {
        return isNameplateActive() ? 1 : getInterval?.call(this, event)
    }
    slider.get = patchedGet
    slider.change = patchedChange
    if (typeof getInterval === 'function') slider.getInterval = patchedInterval
    return () => {
        if (slider.get === patchedGet) slider.get = get
        if (slider.change === patchedChange) slider.change = change
        if (slider.getInterval === patchedInterval) slider.getInterval = getInterval
    }
}

function backToStart(animator: any, keyframe: any) {
    if (!RETURNING_CHANNELS.has(keyframe?.channel)) return
    const lastFrame = frameOf(animator?.animation?.length) - 1
    if (lastFrame < 1 || frameOf(keyframe.time) < lastFrame) return
    const keys: any[] = (animator.keyframes ?? []).filter((other: any) => other !== keyframe && other.channel === keyframe.channel)
    const start = keys.find((other) => frameOf(other.time) === 0)?.data_points?.[0]
    const point = keyframe.data_points?.[0]
    if (!start || !point) return
    point.x = start.x
    point.y = start.y
}

function patchNewKeyValue(): () => void {
    const prototype = (globalThis as any).BoneAnimator?.prototype
    if (typeof prototype?.fillValues !== 'function') return () => {}
    const original = prototype.fillValues
    const patched = function (this: unknown, keyframe: any, values: unknown, ...rest: unknown[]) {
        const result = original.call(this, keyframe, values, ...rest)
        if (isNameplateActive() && (values === null || values === undefined)) backToStart(this, keyframe)
        return result
    }
    prototype.fillValues = patched
    return () => {
        if (prototype.fillValues === patched) prototype.fillValues = original
    }
}

function stopKeysStretchingLength(): () => void {
    const prototype = (BBAnimation as any).prototype
    if (typeof prototype?.getMaxLength !== 'function') return () => {}
    const original = prototype.getMaxLength
    const patched = function (this: any) {
        return isNameplateActive() ? Number(this.length) || 0 : original.call(this)
    }
    prototype.getMaxLength = patched
    return () => {
        if (prototype.getMaxLength === patched) prototype.getMaxLength = original
    }
}

function trimSelectedKeyValues() {
    if (!isNameplateActive()) return
    const selected: any[] = timeline()?.selected ?? []
    for (const keyframe of selected) {
        const points: any[] = Array.isArray(keyframe?.data_points) ? keyframe.data_points : []
        for (const point of points) {
            for (const axis of KEY_AXES) {
                const value = point?.[axis]
                if (typeof value !== 'string') continue
                const trimmed = value.trim()
                if (trimmed && trimmed !== value) point[axis] = trimmed
            }
        }
    }
}

function trimKeyValuesOnBlur(): () => void {
    const listener = (event: FocusEvent) => {
        const target = event.target as HTMLElement | null
        if (target?.closest?.('.keyframe_input')) trimSelectedKeyValues()
    }
    document.addEventListener('focusout', listener, true)
    return () => document.removeEventListener('focusout', listener, true)
}

function refreshLengthField() {
    const slider = typeof BarItems === 'undefined' ? undefined : (BarItems as any).slider_animation_length
    slider?.update?.()
}

function refreshTimeline() {
    syncReadout()
    timeline()?.vue?.updateTimecodes?.()
    refreshLengthField()
}

export function patchTimelineFrames(): () => void {
    const restores = [
        patchRuler(),
        patchReadout(),
        patchSecondsSlider('slider_keyframe_time'),
        patchSecondsSlider('slider_animation_length', Math.round),
        patchNewKeyValue(),
        stopKeysStretchingLength(),
        trimKeyValuesOnBlur(),
    ]
    const listeners = [Blockbench.on('select_project', refreshTimeline), Blockbench.on('select_mode', refreshTimeline)]
    refreshTimeline()
    return () => {
        for (const listener of listeners) listener.delete()
        for (const restore of restores) restore()
        syncReadout(false)
        timeline()?.vue?.updateTimecodes?.()
        refreshLengthField()
    }
}

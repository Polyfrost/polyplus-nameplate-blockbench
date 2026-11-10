import { AnimationData, BADGE_TARGET, BundleIssue, Channel, Interpolation, KeyData, LayerData, LOOP_ANIMATION, LoopData, PLATE_TARGET, ProjectSnapshot, ScheduleData, TrackData } from '../model'
import {
    ID_PATTERN,
    isOneShot,
    isWhile,
    MAX_APPEAR_SECONDS,
    MAX_LENGTH_FRAMES,
    MAX_SCHEDULE_WEIGHT,
    suggestedId,
} from './props'
import { secondsText } from '../format'
import { sameMolang } from '../molang/keys'
import { paramLabel, paramOfChannel } from '../material/params'
import { closingKeys, closingSpeed, curvedMolangKeys } from './curves'
import { LIMITS } from '../motion/types'
import { reactionPaletteIssues } from '../palanim/reaction'
import type { LetteredAnimation } from '../text/reaction'
import { joinList, pluralWord } from '../util/text'

type FailFn = (animation: AnimationData, suffix: string, message: string) => void
type WarnFn = (animation: AnimationData, message: string) => void

const MANIFEST = 'manifest.json'
const SAME_VALUE = 1e-6
const CHANNEL_NAMES: Record<string, string> = {
    frame: 'Frame',
    position: 'Position',
    opacity: 'Opacity',
    visible: 'Visible',
    burst: 'Burst',
    speed: 'Speed',
}

const BADGE_LABEL = 'the PolyPlus badge'
const PLATE_LABEL = 'the whole nameplate'

interface ScheduleGroup {
    id: string
    step: number
    members: AnimationData[]
}

interface AnimationChecks {
    issues: BundleIssue[]
    warnings: BundleIssue[]
}

export function animationPath(name: string, suffix = ''): string {
    return `${MANIFEST}#animations.${name}${suffix}`
}

interface KeyedTrack {
    target: string
    channel: string
    keys: Array<{ step: number }>
}

function keyedTracks(animation: AnimationData): KeyedTrack[] {
    const bursts = (animation.bursts ?? []).map((burst) => ({ target: burst.target, channel: 'burst', keys: burst.keys }))
    const speeds = animation.schedule ? [] : (animation.speeds ?? []).map((speed) => ({ target: speed.target, channel: 'speed', keys: speed.keys }))
    return [...animation.tracks, ...bursts, ...speeds]
}

function targetName(target: string): string {
    if (target === PLATE_TARGET) return PLATE_LABEL
    return target === BADGE_TARGET ? BADGE_LABEL : `'${target}'`
}

export function scheduleIdOf(animation: AnimationData): string {
    return animation.schedule?.id ?? animation.name
}

export function scheduleGroups(animations: AnimationData[], layers: LayerData[]): Map<string, ScheduleGroup> {
    const steps = new Map(layers.map((layer) => [layer.id, layer.step]))
    const groups = new Map<string, ScheduleGroup>()
    for (const animation of animations) {
        if (!animation.schedule) continue
        const id = scheduleIdOf(animation)
        let group = groups.get(id)
        if (!group) {
            group = { id, step: 0, members: [] }
            groups.set(id, group)
        }
        group.members.push(animation)
        if (group.step === 0) {
            const layer = keyedTracks(animation).find((track) => steps.has(track.target))
            if (layer) group.step = steps.get(layer.target) ?? 1
        }
    }
    for (const group of groups.values()) if (group.step < 1) group.step = 1
    return groups
}

export function channelName(channel: string): string {
    const param = paramOfChannel(channel)
    if (param) return `Setting '${paramLabel(param)}'`
    return CHANNEL_NAMES[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1)
}

function sameValue(a: KeyData['value'], b: KeyData['value']): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < SAME_VALUE)
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < SAME_VALUE
    return a === b
}

function closingIndex<T extends { step: number }>(keys: T[], length: number, same: (closing: T, first: T) => boolean): number {
    if (keys.length < 2) return -1
    const first = keys.reduce((earliest, key) => (key.step < earliest.step ? key : earliest))
    const wrap = keys.findIndex((key) => key.step === length)
    return wrap < 0 || keys[wrap] === first || !same(keys[wrap], first) ? -1 : wrap
}

function keyBefore<T extends { step: number }>(keys: T[], length: number): T | null {
    let found: T | null = null
    for (const key of keys) if (key.step < length && (!found || key.step > found.step)) found = key
    return found
}

function bySteps<T extends { step: number }>(keys: T[]): T[] {
    return keys.sort((a, b) => a.step - b.step)
}

function wrapWithoutStart<T extends { step: number }>(keys: T[], length: number): T | undefined {
    return keys.some((key) => key.step === 0) ? undefined : keys.find((key) => key.step === length)
}

function resolveWrap<T extends { step: number, interpolation: Interpolation }>(
    keys: T[],
    length: number,
    same: (closing: T, first: T) => boolean,
    tailOf: (previous: T, closing: T) => T[],
): T[] {
    const wrap = closingIndex(keys, length, same)
    const start = wrap < 0 ? wrapWithoutStart(keys, length) : undefined
    const closing = start ?? keys[wrap]
    if (!closing) return keys
    const rest = keys.filter((key) => key !== closing)
    const previous = keyBefore(rest, length)
    const opening = start ? [{ ...start, step: 0, interpolation: 'step' } as T] : []
    return bySteps([...opening, ...rest, ...(previous ? tailOf(previous, closing) : [])])
}

function withoutWrapKey(keys: KeyData[], length: number, channel?: Channel): KeyData[] {
    return resolveWrap(
        keys,
        length,
        (closing, first) => sameValue(closing.value, first.value) && sameMolang(closing, first),
        (previous, closing) => (channel ? closingKeys(channel, previous, closing, length) : []),
    )
}

export function withoutWrapSpeed<T extends { step: number, value: number, interpolation: Interpolation }>(keys: T[], cycle: number): T[] {
    return resolveWrap(
        keys,
        cycle,
        (closing, first) => Math.abs(closing.value - first.value) < SAME_VALUE,
        (previous, closing) => {
            const held = closingSpeed(previous, closing, cycle)
            return held ? [held] : []
        },
    )
}

export function withoutWrapBursts<T extends { step: number, count: number }>(keys: T[], length: number): T[] {
    const start = wrapWithoutStart(keys, length)
    if (start) return bySteps(keys.map((key) => (key === start ? { ...key, step: 0 } : key)))
    const opening = keys.find((key) => key.step === 0)
    if (!opening) return keys
    return keys.filter((key) => key.step !== length || key.count !== opening.count)
}

function withoutWrapKeys(tracks: TrackData[], length: number): TrackData[] {
    return tracks.map((track) => ({ ...track, keys: withoutWrapKey(track.keys, length, track.channel) }))
}

function withoutWrapLayer(layer: LayerData, loopFrames: number): LayerData {
    if (layer.kind === 'path') return { ...layer, speedKeys: withoutWrapSpeed(layer.speedKeys, pathCycle(loopFrames, layer.step)) }
    if (layer.kind === 'emitter') return { ...layer, bursts: withoutWrapBursts(layer.bursts, loopFrames) }
    return layer
}

export function pathCycle(loopFrames: number, step: number): number {
    return Math.max(1, Math.floor(loopFrames / Math.max(1, step)))
}

function withoutWrapWhile(animation: AnimationData, loopFrames: number): AnimationData {
    return {
        ...animation,
        tracks: withoutWrapKeys(animation.tracks, loopFrames),
        bursts: animation.bursts?.map((burst) => ({ ...burst, keys: withoutWrapBursts(burst.keys, loopFrames) })),
        speeds: animation.speeds?.map((speed) => ({ ...speed, keys: withoutWrapSpeed(speed.keys, loopFrames) })),
    }
}

export function dropWrapKeys(snapshot: ProjectSnapshot, loopFrames: number): ProjectSnapshot {
    return {
        ...snapshot,
        layers: snapshot.layers.map((layer) => withoutWrapLayer(layer, loopFrames)),
        loop: snapshot.loop ? { ...snapshot.loop, tracks: withoutWrapKeys(snapshot.loop.tracks, loopFrames) } : null,
        animations: snapshot.animations?.map((animation) => (isWhile(animation.trigger) ? withoutWrapWhile(animation, loopFrames) : animation)),
    }
}

function checkLoop(loop: LoopData, loopFrames: number, fps: number, issues: BundleIssue[]) {
    for (const track of loop.tracks) {
        const late = track.keys.find((key) => key.step >= loopFrames)
        if (!late) continue
        const what = `The ${channelName(track.channel)} keyframe on ${targetName(track.target)}`
        const span = `The loop is ${loopFrames} frames (0 to ${loopFrames - 1}, ${secondsText(loopFrames, fps)})`
        const message = late.step === loopFrames
            ? `${span}, and frame ${loopFrames} is frame 0 again. ${what} at frame ${loopFrames} doesn't match frame 0. Give it frame 0's value, or move it to frame ${loopFrames - 1} or earlier.`
            : `${span}, but ${what.charAt(0).toLowerCase() + what.slice(1)} is at frame ${late.step}. Move it to frame ${loopFrames - 1} or earlier, or make the loop longer.`
        issues.push({ path: animationPath(LOOP_ANIMATION, `.tracks.${track.target}.${track.channel}`), message, animation: LOOP_ANIMATION })
    }
}

function framesText(frames: number[]): string {
    if (frames.length === 1) return `frame ${frames[0]}`
    return `frames ${joinList(frames)}`
}

function molangCurveWarnings(name: string, tracks: TrackData[], reference: string): BundleIssue[] {
    const warnings: BundleIssue[] = []
    for (const track of tracks) {
        const bent = curvedMolangKeys(track.keys)
        if (bent.length === 0) continue
        const ends = bent.map((index) => track.keys[index].step)
        warnings.push({
            path: animationPath(name, `.tracks.${track.target}.${track.channel}`),
            animation: reference,
            message: `Animation '${name}': the ${channelName(track.channel)} ${pluralWord(ends.length, 'keyframe')} on ${targetName(track.target)} at ${framesText(ends)} use${ends.length === 1 ? 's' : ''} a formula and a curve. In game it plays a plain ease instead. For the exact curve, use plain numbers on both keyframes.`,
        })
    }
    return warnings
}

function subjectOf(target: string, layers: LayerData[]): string {
    if (target === PLATE_TARGET) return 'The whole nameplate'
    return `${layers.some((layer) => layer.id === target) ? 'Layer' : 'Group'} '${target}'`
}

function hasPlayRule(animation: AnimationData): boolean {
    return !!animation.trigger || !!animation.schedule
}

function lateKeys(animation: AnimationData, limit: number): Array<{ frame: number, target: string, channel: string }> {
    const found: Array<{ frame: number, target: string, channel: string }> = []
    for (const track of keyedTracks(animation)) {
        const last = track.keys.reduce((latest, key) => Math.max(latest, key.step), -1)
        if (last >= limit) found.push({ frame: last, target: track.target, channel: track.channel })
    }
    return found
}

export function checkAnimations(snapshot: ProjectSnapshot, loopFrames: number): AnimationChecks {
    const issues: BundleIssue[] = []
    const warnings: BundleIssue[] = []
    const animations = snapshot.animations ?? []
    const groups = scheduleGroups(animations, snapshot.layers)
    const fps = snapshot.nameplate.fps > 0 ? snapshot.nameplate.fps : 1

    const fail = (animation: AnimationData, suffix: string, message: string) =>
        issues.push({ path: animationPath(animation.name, suffix), message, animation: animation.uuid })
    const warn = (animation: AnimationData, message: string) =>
        warnings.push({ path: animationPath(animation.name), message, animation: animation.uuid })

    if (snapshot.loop) {
        checkLoop(snapshot.loop, loopFrames, fps, issues)
        warnings.push(...molangCurveWarnings(LOOP_ANIMATION, snapshot.loop.tracks, LOOP_ANIMATION))
    }

    for (const animation of animations) {
        const label = `Animation '${animation.name}'`
        if (!ID_PATTERN.test(animation.name)) {
            fail(animation, '.name', `${label}: use only lowercase letters, digits and _ (1 to 64), for example '${suggestedId(animation.name)}'.`)
        }
        if (!hasPlayRule(animation)) {
            fail(animation, '.trigger', `${label} doesn't say when it plays yet. Double-click it in the Animations panel and pick what starts it.`)
            continue
        }

        warnings.push(...molangCurveWarnings(animation.name, animation.tracks, animation.uuid))
        const keyed = keyedTracks(animation).some((track) => track.keys.length > 0)
            || (!animation.schedule && (animation.palette ?? []).length > 0)
            || (animation as LetteredAnimation).letters !== undefined
        if (!keyed) warn(animation, `${label} has no keyframes yet, so it changes nothing. Select it, click a layer, and add keyframes in the timeline.`)

        if (animation.trigger?.kind === 'appear') {
            const seconds = animation.trigger.seconds
            if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_APPEAR_SECONDS) {
                fail(animation, '.trigger.appear', `${label}: Unseen for must be 1 to ${MAX_APPEAR_SECONDS} whole seconds (it is ${seconds}).`)
            }
        }

        checkSpeeds(animation, fail)
        if (animation.schedule) checkScheduleExtras(animation, fail, warn)
        else if (animation.trigger) {
            const span = { name: animation.name, length: isWhile(animation.trigger) ? loopFrames : animation.length, oneShot: !isWhile(animation.trigger) }
            if (span.length >= 1) issues.push(...reactionPaletteIssues(animation.palette ?? [], snapshot.nameplate.palette, span, animation.uuid))
        }

        if (isWhile(animation.trigger)) {
            for (const last of lateKeys(animation, loopFrames)) {
                fail(
                    animation,
                    `.tracks.${last.target}.${last.channel}`,
                    last.frame === loopFrames
                        ? `${label} plays in the loop's ${loopFrames} frames (0 to ${loopFrames - 1}), and frame ${loopFrames} is frame 0 again. Its ${channelName(last.channel)} keyframe on ${targetName(last.target)} at frame ${loopFrames} is not the same as frame 0. Give it the same value as frame 0, or move it to frame ${loopFrames - 1} or earlier.`
                        : `${label} plays in the loop's ${loopFrames} frames (0 to ${loopFrames - 1}), but its ${channelName(last.channel)} keyframe on ${targetName(last.target)} is at frame ${last.frame}. Move it to frame ${loopFrames - 1} or earlier.`,
                )
            }
            continue
        }

        const length = animation.length
        if (length < 1) {
            fail(animation, '.length', `${label} is 0 frames long. Open its properties and give it a length of at least 1 frame.`)
        } else if (length > MAX_LENGTH_FRAMES) {
            fail(animation, '.length', `${label} is ${length} frames long; the most is ${MAX_LENGTH_FRAMES}. Shorten it in its properties.`)
        } else {
            for (const last of lateKeys(animation, length)) {
                fail(
                    animation,
                    `.tracks.${last.target}.${last.channel}`,
                    `${label} is ${length} frames long (0 to ${length - 1}), but its ${channelName(last.channel)} keyframe on ${targetName(last.target)} is at frame ${last.frame}. Move it to frame ${length - 1} or earlier, or make the animation longer in its properties.`,
                )
            }
        }

        if (isOneShot(animation.trigger) || !animation.schedule) continue
        checkSchedule(animation, animation.schedule, groups.get(scheduleIdOf(animation)), fps, fail, warn)
    }

    checkScheduleTargets(groups, snapshot.layers, issues)
    return { issues, warnings }
}

function checkSpeeds(animation: AnimationData, fail: FailFn) {
    for (const burst of animation.bursts ?? []) {
        const big = burst.keys.find((key) => key.count < 1 || key.count > LIMITS.burst)
        if (big) {
            fail(
                animation,
                `.tracks.${burst.target}.burst`,
                `Animation '${animation.name}': the Burst keyframe on '${burst.target}' at frame ${big.step} asks for ${big.count} particles. Use 1 to ${LIMITS.burst}.`,
            )
        }
    }
    if (animation.schedule) return
    for (const speed of animation.speeds ?? []) {
        const wild = speed.keys.find((key) => !(Math.abs(key.value) <= LIMITS.speed))
        if (wild) {
            fail(
                animation,
                `.tracks.${speed.target}.speed`,
                `Animation '${animation.name}': the Speed keyframe on '${speed.target}' at frame ${wild.step} is ${wild.value}. Use -${LIMITS.speed} to ${LIMITS.speed} px per frame: 0 stops the path, below 0 runs it backwards.`,
            )
        }
    }
}

function checkScheduleExtras(
    animation: AnimationData,
    fail: FailFn,
    warn: WarnFn,
) {
    const label = `Random animation '${animation.name}'`
    if (animation.tracks.some((track) => track.target === BADGE_TARGET)) {
        fail(animation, `.tracks.${BADGE_TARGET}`, `${label} moves the PolyPlus badge, but only the loop, reactions and one-shots can. Delete the badge keyframes here, or make it a reaction or one-shot.`)
    }
    if ((animation.speeds ?? []).length > 0) {
        warn(animation, `${label} has Speed keyframes on a path. Random animations can't change a path's speed, so they are left out. Use a reaction or one-shot instead.`)
    }
    if ((animation.palette ?? []).length > 0) {
        warn(animation, `${label} has color changes, but random animations can't change colors, so they are left out. Make it a reaction or one-shot to use them.`)
    }
}

function checkSchedule(
    animation: AnimationData,
    schedule: ScheduleData,
    group: ScheduleGroup | undefined,
    fps: number,
    fail: FailFn,
    warn: WarnFn,
) {
    const label = `Random animation '${animation.name}'`
    if (schedule.id !== null && !ID_PATTERN.test(schedule.id)) {
        fail(animation, '.schedule.id', `${label}: the shared schedule name '${schedule.id}' may use only lowercase letters, digits and _.`)
    }
    if (schedule.window < 1) fail(animation, '.schedule.window', `${label}: the window must be at least 1 frame.`)
    if (schedule.jitter < 0) fail(animation, '.schedule.jitter', `${label}: set Random delay to 0 or more.`)
    if (!(schedule.chance >= 0 && schedule.chance <= 1)) {
        fail(animation, '.schedule.chance', `${label}: the chance per window must be 0 to 1 (it is ${schedule.chance}).`)
    } else if (schedule.chance === 0) {
        warn(animation, `${label} has a chance of 0, so it never plays. Raise Chance per window.`)
    }
    if (!Number.isInteger(schedule.weight) || schedule.weight < 1 || schedule.weight > MAX_SCHEDULE_WEIGHT) {
        fail(animation, '.schedule.weight', `${label}: the weight must be a whole number from 1 to ${MAX_SCHEDULE_WEIGHT}.`)
    }
    if (schedule.window >= 1 && schedule.jitter >= 0 && animation.length >= 1 && animation.length + schedule.jitter > schedule.window) {
        const needed = animation.length + schedule.jitter
        fail(
            animation,
            '.length',
            `${label} is ${animation.length} frames long and starts up to ${schedule.jitter} frames late, so it needs a window of at least ${needed} frames (it is ${schedule.window}, ${secondsText(schedule.window, fps)}). Make the window longer, the delay shorter or the animation shorter.`,
        )
    }
    if (!group) return

    const first = group.members[0]
    if (first !== animation && first.schedule) {
        const theirs = first.schedule
        const differs: string[] = []
        if (theirs.window !== schedule.window) differs.push(`window ${schedule.window} vs ${theirs.window}`)
        if (theirs.jitter !== schedule.jitter) differs.push(`delay ${schedule.jitter} vs ${theirs.jitter}`)
        if (theirs.chance !== schedule.chance) differs.push(`chance ${schedule.chance} vs ${theirs.chance}`)
        if (differs.length > 0) {
            fail(
                animation,
                '.schedule',
                `${label} takes turns with '${first.name}' (schedule '${group.id}'), so both need the same window, delay and chance (${differs.join(', ')}). Open its properties and confirm to copy them over.`,
            )
        }
    }

    const step = group.step
    if (step > 1) {
        const odd: string[] = []
        if (schedule.window % step !== 0) odd.push(`window ${schedule.window}`)
        if (schedule.jitter % step !== 0) odd.push(`delay ${schedule.jitter}`)
        if (animation.length % step !== 0) odd.push(`length ${animation.length}`)
        for (const track of keyedTracks(animation)) {
            for (const key of track.keys) {
                if (key.step % step !== 0) odd.push(`${channelName(track.channel)} keyframe on ${targetName(track.target)} at frame ${key.step}`)
            }
        }
        if (odd.length > 0) {
            fail(
                animation,
                '.schedule.step',
                `${label} moves layers that hold each frame for ${step} frames, so its timing must be in multiples of ${step} frames: ${odd.slice(0, 4).join(', ')}${odd.length > 4 ? ' and more' : ''}.`,
            )
        }
    }
}

function checkScheduleTargets(groups: Map<string, ScheduleGroup>, layers: LayerData[], issues: BundleIssue[]) {
    const steps = new Map(layers.map((layer) => [layer.id, layer.step]))
    const driver = new Map<string, { group: ScheduleGroup, animation: AnimationData }>()
    for (const group of groups.values()) {
        for (const animation of group.members) {
            for (const target of new Set(keyedTracks(animation).map((track) => track.target))) {
                const path = animationPath(animation.name, `.tracks.${target}`)
                const owner = driver.get(target)
                if (owner && owner.group !== group) {
                    issues.push({
                        path,
                        animation: animation.uuid,
                        message: `${subjectOf(target, layers)} already follows the random animation '${owner.animation.name}', and '${animation.name}' is a different schedule. A layer or group can follow only one schedule: share the schedule, or move these keyframes to another layer.`,
                    })
                    continue
                }
                if (!owner) driver.set(target, { group, animation })
                const step = steps.get(target)
                if (step !== undefined && step !== group.step) {
                    issues.push({
                        path,
                        animation: animation.uuid,
                        message: `Layer '${target}' holds each frame for ${step} frames, but the other layers of random animation '${animation.name}' hold each frame for ${group.step}. Layers moved by one schedule need the same value.`,
                    })
                }
            }
        }
    }
}

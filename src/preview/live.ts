import { startClock } from '@plusrenderer/renderer/nameplate.js'
import { NameplatePreview, NameplateRecord, NameplateTagState, stateOf } from '../engine'

export const REACTION_LABELS: Record<string, string> = {
    sneaking: 'Sneaking',
    sprinting: 'Sprinting',
    hurt: 'Getting hurt',
    on_fire: 'On fire',
    swimming: 'Swimming',
    gliding: 'Gliding with an elytra',
    riding: 'Riding something',
    sleeping: 'Sleeping',
    emote: 'Playing an emote',
}

export const MAIN_TAG = 'main'

export const liveUi: { reactions: string[], values: Record<string, number> } = { reactions: [], values: {} }

const live: {
    preview: NameplatePreview | null
    record: NameplateRecord | null
    seen: Set<string>
    anchored: boolean
    heldLocal: number
    absolute: number
    elapsed: number
    elapsedFrom: number
    elapsedAt: number
    elapsedRate: number
    wasPlaying: boolean
    seenMs: number
    playFrom: number
    playAt: number
    playRate: number
    onStage: boolean
    playing: Set<string>
    primed: string[] | null
} = { preview: null, record: null, seen: new Set(), anchored: false, heldLocal: -1, absolute: 0, elapsed: 0, elapsedFrom: 0, elapsedAt: 0, elapsedRate: 1, wasPlaying: false, seenMs: 0, playFrom: 0, playAt: 0, playRate: 1, onStage: false, playing: new Set(), primed: null }

const FRAME_LIMIT = 2 ** 23
const FRAME_EPSILON = 1e-6

let liveClock: () => number = startClock()

export function setLiveClock(clock: (() => number) | null) {
    liveClock = clock ?? startClock()
}

export function clockFrame(preview: NameplatePreview, seconds = liveClock()): number {
    const loop = Math.max(1, preview.loop)
    const span = Math.max(loop, Math.floor((FRAME_LIMIT - 1) / loop) * loop)
    return wrapped(Math.floor(seconds * Math.max(1, preview.fps) + FRAME_EPSILON), span)
}

function startRecord(preview: NameplatePreview, kind: string): NameplateRecord | null {
    try {
        return preview.record()
    } catch (error) {
        console.error(`[polyplus_nameplate] could not start the ${kind} preview`, error)
        return null
    }
}

function attach(preview: NameplatePreview) {
    if (live.preview === preview) return
    live.preview = preview
    live.seen.clear()
    live.record = startRecord(preview, 'reaction')
    liveUi.reactions = liveUi.reactions.filter((id) => preview.reactions.includes(id))
    liveUi.values = Object.fromEntries(Object.entries(liveUi.values).filter(([signal]) => preview.levels.includes(signal)))
}

function levelsOf(preview: NameplatePreview): Record<string, number> {
    return Object.fromEntries(Object.entries(liveUi.values).filter(([signal]) => preview.levels.includes(signal)))
}

function withLevels(preview: NameplatePreview, state: NameplateTagState): NameplateTagState {
    const values = levelsOf(preview)
    return Object.keys(values).length ? { ...state, values } : state
}

export function setSignalValue(signal: string, value: number) {
    const rest = Object.fromEntries(Object.entries(liveUi.values).filter(([name]) => name !== signal))
    liveUi.values = Number.isFinite(value) && value !== 0 ? { ...rest, [signal]: value } : rest
}

function wrapped(value: number, loop: number): number {
    return ((value % loop) + loop) % loop
}

function anchorPlay(frame: number, at: number, rate: number) {
    live.playFrom = frame
    live.playAt = at
    live.playRate = rate
}

function anchorElapsed(at: number, rate: number) {
    live.elapsedFrom = live.elapsed
    live.elapsedAt = at
    live.elapsedRate = rate
}

function timelineStep(preview: NameplatePreview, local: number, loop: number, moving: boolean, at: number, rate: number): number {
    const base = live.absolute + wrapped(local - live.absolute, loop)
    const timed = moving && live.playRate === rate
    const expected = live.playFrom + (at - live.playAt) * Math.max(1, preview.fps) * rate
    const frame = timed ? base + loop * Math.max(0, Math.round((expected - base) / loop)) : base
    if (!timed || Math.abs(expected - frame) >= 1) anchorPlay(frame, at, rate)
    return frame
}

function placeFrame(preview: NameplatePreview, local: number, playing: boolean, onClock: boolean, seconds?: number, rate = 1): number {
    attach(preview)
    if (live.seen.size > 0) live.primed = null
    live.onStage = true
    live.playing.clear()
    const loop = Math.max(1, preview.loop)
    const at = seconds ?? liveClock()
    const before = live.absolute
    const counted = live.elapsed
    const anchored = live.anchored
    const moving = playing && live.wasPlaying && anchored
    if (playing && onClock) {
        live.absolute = clockFrame(preview, at)
        anchorPlay(live.absolute, at, rate)
    } else if (!anchored) {
        const now = clockFrame(preview, at)
        live.absolute = now - wrapped(now, loop) + wrapped(local, loop)
        anchorPlay(live.absolute, at, rate)
    } else if (playing) {
        live.absolute = timelineStep(preview, local, loop, moving, at, rate)
    } else if (local !== live.heldLocal) {
        live.absolute = live.absolute - wrapped(live.absolute, loop) + wrapped(local, loop)
    }
    if (!anchored) {
        live.elapsed = live.absolute
        anchorElapsed(at, rate)
    } else if (!playing) {
        live.elapsed += live.absolute - before
        anchorElapsed(at, rate)
    } else if (!moving || live.elapsedRate !== rate || at < live.elapsedAt) {
        anchorElapsed(at, rate)
    } else {
        const expected = live.elapsedFrom + (at - live.elapsedAt) * Math.max(1, preview.fps) * rate
        const stepped = live.elapsed + live.absolute - before
        live.elapsed = Math.abs(stepped - expected) < 1 ? stepped : Math.max(live.elapsed, Math.floor(expected + FRAME_EPSILON))
    }
    if (moving && live.elapsed > counted) live.seenMs += ((live.elapsed - counted) * 1000) / Math.max(1, preview.fps)
    live.anchored = true
    live.wasPlaying = playing
    live.heldLocal = local
    return live.absolute
}

export function absoluteFrame(preview: NameplatePreview, local: number, playing: boolean, seconds?: number): number {
    return placeFrame(preview, local, playing, true, seconds)
}

export function pauseLive() {
    live.wasPlaying = false
}

export function resumeOnClock(seconds = liveClock()) {
    const preview = live.preview
    if (!preview || !live.anchored) return
    live.absolute = clockFrame(preview, seconds)
    anchorPlay(live.absolute, seconds, 1)
    anchorElapsed(seconds, 1)
    live.wasPlaying = true
}

export interface StageFrame {
    frame: number
    local: number
    control: number | null
}

export function stageFrame(preview: NameplatePreview, local: number, playing: boolean, timeline: boolean, seconds?: number, rate = 1): StageFrame {
    const frame = placeFrame(preview, local, playing, !timeline, seconds, rate)
    const shown = wrapped(frame, Math.max(1, preview.loop))
    return { frame, local: shown, control: playing && !timeline ? shown : null }
}

export function isLiveOnStage(): boolean {
    return live.onStage
}

export function playingShots(): string[] {
    return Array.from(live.playing)
}

export function tagState(key: string, variant: string, frame: number, seed = 0): NameplateTagState | null {
    const preview = live.preview
    const record = live.record
    if (!preview || !record) return null
    try {
        const timeMs = live.seenMs
        const offset = live.elapsed - live.absolute
        const at = frame + offset
        if (!live.seen.has(key)) {
            live.seen.add(key)
            record.prime(key, variant, at, live.primed ?? liveUi.reactions, live.primed !== null)
        }
        const state = shown(record.update(key, variant, at, liveUi.reactions, timeMs, seed), offset)
        for (const shot of state.oneShots) live.playing.add(shot)
        return withLevels(preview, state)
    } catch (error) {
        console.error('[polyplus_nameplate] reaction preview failed', error)
        return null
    }
}

function shown(state: NameplateTagState, offset: number): NameplateTagState {
    if (offset === 0) return state
    const starts = Int32Array.from(state.starts, (start) => start - offset)
    const speedShots = state.speedShots?.map(([name, start]): [string, number] => [name, start - offset])
    const retired = state.retired?.map(([name, start, until]): [string, number, number] => [name, start - offset, until - offset])
    return { ...state, starts, ...(speedShots ? { speedShots } : {}), ...(retired ? { retired } : {}) }
}

export function stillState(preview: NameplatePreview): NameplateTagState {
    return stateOf(liveUi.reactions.filter((id) => preview.reactions.includes(id)), false, levelsOf(preview))
}

export interface ScrubPlan {
    reaction: string | null
    shot: string | null
}

const scrub: { preview: NameplatePreview | null, record: NameplateRecord | null } = { preview: null, record: null }

function scrubRecord(preview: NameplatePreview): NameplateRecord | null {
    if (scrub.preview === preview) return scrub.record
    scrub.preview = preview
    scrub.record = startRecord(preview, 'animation')
    return scrub.record
}

export function scrubState(preview: NameplatePreview, key: string, variant: string, frame: number, plan: ScrubPlan, seed = 0): NameplateTagState | null {
    live.onStage = false
    const record = scrubRecord(preview)
    if (!record) return null
    const reactions = liveUi.reactions.filter((id) => preview.reactions.includes(id))
    if (plan.reaction && !reactions.includes(plan.reaction)) reactions.push(plan.reaction)
    try {
        record.clear()
        record.update(key, variant, 1, reactions, 0, seed)
        record.update(key, variant, 0, reactions, 0, seed)
        if (plan.shot) record.fire(key, plan.shot, 0)
        return withLevels(preview, record.update(key, variant, Math.max(0, frame), reactions, 0, seed))
    } catch (error) {
        console.error('[polyplus_nameplate] animation preview failed', error)
        return null
    }
}

export function setReaction(id: string, on: boolean, paused = false) {
    const before = liveUi.reactions
    const rest = before.filter((entry) => entry !== id)
    liveUi.reactions = on ? [...rest, id] : rest
    if (on || !paused) return
    live.record?.clear()
    live.seen.clear()
    live.primed = before
}

export function fireOneShot(name: string, keys: string[]): number {
    const record = live.record
    if (!record) return 0
    let fired = 0
    for (const key of keys) {
        try {
            if (record.fire(key, name, live.elapsed)) fired++
        } catch (error) {
            console.error('[polyplus_nameplate] could not play the one-shot', error)
        }
    }
    return fired
}

export function resetLive() {
    live.record?.clear()
    live.preview = null
    live.record = null
    live.seen.clear()
    live.anchored = false
    live.heldLocal = -1
    live.absolute = 0
    live.elapsed = 0
    anchorElapsed(0, 1)
    live.wasPlaying = false
    live.seenMs = 0
    anchorPlay(0, 0, 1)
    live.onStage = false
    live.playing.clear()
    live.primed = null
    liveUi.reactions = []
    liveUi.values = {}
    scrub.record?.clear()
    scrub.preview = null
    scrub.record = null
}

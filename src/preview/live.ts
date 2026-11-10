import { NameplatePreview, NameplateRecord, NameplateTagState } from '../engine'

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

export const liveUi: { reactions: string[] } = { reactions: [] }

const live: {
    preview: NameplatePreview | null
    record: NameplateRecord | null
    seen: Set<string>
    base: number
    lastLocal: number
    absolute: number
    onStage: boolean
    playing: Set<string>
    primed: string[] | null
} = { preview: null, record: null, seen: new Set(), base: 0, lastLocal: -1, absolute: 0, onStage: false, playing: new Set(), primed: null }

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
    live.base = 0
    live.lastLocal = -1
    liveUi.reactions = liveUi.reactions.filter((id) => preview.reactions.includes(id))
}

export function absoluteFrame(preview: NameplatePreview, local: number, playing: boolean): number {
    attach(preview)
    if (live.seen.size > 0) live.primed = null
    live.onStage = true
    live.playing.clear()
    const loop = Math.max(1, preview.loop)
    if (playing && live.lastLocal >= 0 && local < live.lastLocal) live.base += loop
    live.lastLocal = local
    live.absolute = live.base + local
    return live.absolute
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
        const timeMs = (frame * 1000) / Math.max(1, preview.fps)
        if (!live.seen.has(key)) {
            live.seen.add(key)
            record.update(key, variant, frame + 1, live.primed ?? liveUi.reactions, timeMs, seed)
        }
        const state = record.update(key, variant, frame, liveUi.reactions, timeMs, seed)
        for (const shot of state.oneShots) live.playing.add(shot)
        return state
    } catch (error) {
        console.error('[polyplus_nameplate] reaction preview failed', error)
        return null
    }
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
        return record.update(key, variant, Math.max(0, frame), reactions, 0, seed)
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
            if (record.fire(key, name, live.absolute)) fired++
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
    live.base = 0
    live.lastLocal = -1
    live.absolute = 0
    live.onStage = false
    live.playing.clear()
    live.primed = null
    liveUi.reactions = []
    scrub.record?.clear()
    scrub.preview = null
    scrub.record = null
}

import type { AnimationData } from '../model'
import { isRecord } from '../util/json'

export const TEXT_TARGET = '$text'
const TEXT_MOTION_CHANNEL = 'motion'
const LETTERS_PROPERTY = 'nameplate_letters'

export interface LetterTrack {
    motion: string | null
}

export type LetteredAnimation = AnimationData & { letters?: LetterTrack }

let property: Property | null = null

export function registerLetterProperty() {
    if (property || typeof BBAnimation === 'undefined') return
    property = new Property(BBAnimation as any, 'object', LETTERS_PROPERTY, { default: () => ({}) })
}

export function unregisterLetterProperty() {
    property?.delete()
    property = null
}

export function readLetterTrack(animation: any): LetterTrack | undefined {
    const raw = animation?.[LETTERS_PROPERTY]
    if (!isRecord(raw) || !(TEXT_MOTION_CHANNEL in raw)) return undefined
    const motion = raw[TEXT_MOTION_CHANNEL]
    if (motion === null) return { motion: null }
    if (typeof motion !== 'string') return undefined
    const source = motion.trim()
    return { motion: source || null }
}

export function writeLetterTrack(animation: any, track: LetterTrack | undefined) {
    if (!animation) return
    animation[LETTERS_PROPERTY] = track ? { [TEXT_MOTION_CHANNEL]: track.motion } : {}
}

function projectAnimations(): any[] {
    try {
        return (typeof Animator !== 'undefined' && Animator ? Animator.animations : null) ?? []
    } catch {
        return []
    }
}

export function withLetters<T extends { animations?: AnimationData[] }>(snapshot: T): T {
    const list = snapshot.animations
    if (!list?.length) return snapshot
    const byUuid = new Map(projectAnimations().map((animation) => [String(animation?.uuid ?? ''), animation]))
    let found = false
    const animations = list.map((animation): LetteredAnimation => {
        const track = readLetterTrack(byUuid.get(animation.uuid))
        if (!track) return animation
        found = true
        return { ...animation, letters: track }
    })
    return found ? { ...snapshot, animations } : snapshot
}

export function letterTracksJson(animation: AnimationData): Record<string, Record<string, unknown>> {
    const track = (animation as LetteredAnimation).letters
    if (!track) return {}
    return { [TEXT_TARGET]: { [TEXT_MOTION_CHANNEL]: track.motion } }
}

export function importLetterTrack(channels: unknown): LetterTrack | string {
    if (!isRecord(channels)) return `its track on '${TEXT_TARGET}' is not an object`
    const extra = Object.keys(channels).filter((channel) => channel !== TEXT_MOTION_CHANNEL)
    if (extra.length) return `its letters track has channels the plugin doesn't edit (${extra.join(', ')})`
    const motion = channels[TEXT_MOTION_CHANNEL]
    if (motion === null) return { motion: null }
    if (typeof motion !== 'string') return 'its letter formula is not text'
    return { motion: motion.trim() || null }
}

export function animationsWithLetters(): Array<{ name: string, track: LetterTrack }> {
    const result: Array<{ name: string, track: LetterTrack }> = []
    for (const animation of projectAnimations()) {
        const track = readLetterTrack(animation)
        if (track) result.push({ name: String(animation?.name ?? ''), track })
    }
    return result
}

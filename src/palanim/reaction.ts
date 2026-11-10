import type { BundleIssue, PaletteData, PaletteTrackData, Slot } from '../model'
import { cloneJson } from '../util/json'
import { joinList, plural } from '../util/text'
import { cycleMisses, keysJson, lateKeys, missingKeyColors } from './compile'
import { readTrack } from './import'
import {
    PALETTE_TRACK_PREFIX,
    PaletteMotion,
    normalizeMotion,
} from './types'

export const ANIMATION_PALETTE = 'nameplate_palette'

interface PaletteSpan {
    name: string
    length: number
    oneShot: boolean
}

function stored(animation: any): Record<string, unknown> {
    const value = animation?.[ANIMATION_PALETTE]
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function animationPalette(animation: any, palette: PaletteData): PaletteTrackData[] {
    const raw = stored(animation)
    const result: PaletteTrackData[] = []
    for (const slot of palette.slots) {
        const motion = normalizeMotion(raw[slot.id], slot.ramp.length)
        if (motion) result.push({ slot: slot.id, motion })
    }
    for (const id of Object.keys(raw)) {
        if (palette.slots.some((slot) => slot.id === id)) continue
        const motion = normalizeMotion(raw[id], 1)
        if (motion) result.push({ slot: id, motion })
    }
    return result
}

export function motionIn(animation: any, slotId: string, tones: number): PaletteMotion | undefined {
    return normalizeMotion(stored(animation)[slotId], tones)
}

export function writeMotion(animation: any, slotId: string, motion: PaletteMotion | undefined) {
    const next: Record<string, unknown> = { ...stored(animation) }
    if (motion) next[slotId] = cloneJson(motion)
    else delete next[slotId]
    animation[ANIMATION_PALETTE] = next
}

function paletteTrackPath(name: string, slotId: string): string {
    return `manifest.json#animations.${name}.tracks.${PALETTE_TRACK_PREFIX}${slotId}`
}

function spanText(span: PaletteSpan): string {
    return span.oneShot ? `its ${plural(span.length, 'frame')}` : `the loop's ${plural(span.length, 'frame')}`
}

function cycleProblems(slot: Slot, motion: PaletteMotion, palette: PaletteData, span: PaletteSpan): string[] {
    if (motion.kind !== 'cycle') return []
    return cycleMisses(slot, motion, palette, span.length).map(({ shape, choices }) => {
        const start = `Animation '${span.name}': color '${slot.name}' ${shape}. That doesn't fit ${spanText(span)}, so the colors would jump.`
        return choices.length > 0
            ? `${start} Move one shade every ${joinList(choices.slice(0, 4), 'or')} frames instead, with the color's Animate button.`
            : `${start} Use keyframes instead, or change the length.`
    })
}

function keyProblems(slot: Slot, motion: PaletteMotion, palette: PaletteData, span: PaletteSpan): string[] {
    if (motion.kind !== 'keys') return []
    const problems: string[] = []
    const late = lateKeys(motion, span.length)
    if (late) {
        problems.push(`Animation '${span.name}': color '${slot.name}' has ${late.text}, after it ends (frames 0 to ${span.length - 1}). Move ${late.single ? 'it' : 'them'} earlier with the color's Animate button, or make the animation longer.`)
    }
    const missing = missingKeyColors(motion, palette)
    if (missing) {
        problems.push(`Animation '${span.name}': color '${slot.name}' has keyframes that use ${missing.list}, which ${missing.single ? 'is' : 'are'} no longer a color here. Edit those keyframes with the color's Animate button.`)
    }
    return problems
}

export function reactionPaletteIssues(entries: PaletteTrackData[], palette: PaletteData, span: PaletteSpan, uuid: string): BundleIssue[] {
    const issues: BundleIssue[] = []
    for (const entry of entries) {
        const path = paletteTrackPath(span.name, entry.slot)
        const slot = palette.slots.find((candidate) => candidate.id === entry.slot)
        if (!slot) {
            issues.push({ path, animation: uuid, message: `Animation '${span.name}' changes color '${entry.slot}', which is no longer in the palette, so it has no row in the Colors strip. Click "Remove color change" to drop it.` })
            continue
        }
        for (const message of [...cycleProblems(slot, entry.motion, palette, span), ...keyProblems(slot, entry.motion, palette, span)]) {
            issues.push({ path, animation: uuid, message })
        }
    }
    return issues
}

export function reactionPaletteTracks(entries: PaletteTrackData[], palette: PaletteData, length: number): Record<string, Record<string, unknown>> {
    const tracks: Record<string, Record<string, unknown>> = {}
    for (const entry of entries) {
        const slot = palette.slots.find((candidate) => candidate.id === entry.slot)
        if (!slot) continue
        const key = `${PALETTE_TRACK_PREFIX}${slot.id}`
        if (entry.motion.kind === 'cycle') {
            tracks[key] = { cycle: { every: entry.motion.every, mode: entry.motion.mode } }
            continue
        }
        const keys = keysJson(slot, entry.motion.keys, palette, length)
        if (keys.length > 0) tracks[key] = { keys }
    }
    return tracks
}

export function importReactionPalette(channels: unknown, slot: Slot | undefined, length: number): PaletteMotion | string {
    if (!slot) return 'it changes a color that is not in the palette'
    const motion = readTrack(channels, slot.ramp.length, length)
    return motion ?? `its color track on ${slot.id} uses values the plugin can't edit (Molang or another form)`
}

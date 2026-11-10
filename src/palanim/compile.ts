import type { BundleIssue, PaletteData, Slot } from '../model'
import { joinList, plural, quotedList } from '../util/text'
import {
    COLOR_BASE,
    ColorKey,
    CycleMotion,
    KeysMotion,
    PALETTE_TRACK_PREFIX,
    cyclePeriod,
    cycleFits,
    everyChoices,
    isBaseColor,
    isBaseKey,
    isHexColor,
    loopsThatFit,
    parseColorRef,
    shadeCountsThatFit,
    sortKeys,
    toneRef,
} from './types'

export type SlotFix =
    | { kind: 'every', every: number }
    | { kind: 'drop_late_keys' }
    | { kind: 'open' }

interface SlotProblem {
    message: string
    fix?: SlotFix
}

interface SlotTrack {
    track: Record<string, unknown> | null
    problems: SlotProblem[]
}

const MAX_CHOICES = 4

export function slotIssuePath(slotId: string): string {
    return `palettes.json#slots.${slotId}.animation`
}

export function trackIssuePath(slotId: string): string {
    return `manifest.json#animations.loop.tracks.${PALETTE_TRACK_PREFIX}${slotId}`
}

function nearest(values: number[], target: number): number {
    return values.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best), values[0])
}

function spread(values: number[]): number[] {
    if (values.length <= MAX_CHOICES) return values
    const picked = new Set<number>()
    for (let index = 0; index < MAX_CHOICES; index++) picked.add(values[Math.round((index * (values.length - 1)) / (MAX_CHOICES - 1))])
    return Array.from(picked).sort((a, b) => a - b)
}

export function shadeCounts(slot: Slot, palette: PaletteData): Array<{ tones: number, where: string }> {
    const counts = [{ tones: slot.ramp.length, where: '' }]
    for (const [name, overrides] of Object.entries(palette.colorways)) {
        const ramp = overrides[slot.id]
        if (ramp && ramp.length !== slot.ramp.length) counts.push({ tones: ramp.length, where: ` in colorway '${name}'` })
    }
    return counts
}

export function missingColors(keys: ColorKey[], palette: PaletteData): Set<string> {
    const missing = new Set<string>()
    for (const key of keys) {
        for (const color of key.colors) {
            if (isHexColor(color) || isBaseColor(color)) continue
            const ref = parseColorRef(color)
            if (!ref || !palette.slots.some((entry) => entry.id === ref.slot)) missing.add(color)
        }
    }
    return missing
}

interface CycleMiss {
    tones: number
    where: string
    shape: string
    choices: number[]
}

export function cycleMisses(slot: Slot, motion: CycleMotion, palette: PaletteData, length: number): CycleMiss[] {
    const misses: CycleMiss[] = []
    for (const { tones, where } of shadeCounts(slot, palette)) {
        if (cycleFits(length, motion.mode, tones, motion.every)) continue
        const period = cyclePeriod(motion.mode, tones, motion.every)
        misses.push({
            tones,
            where,
            shape: `has ${tones} shades${where} and moves one shade every ${plural(motion.every, 'frame')}, so one round takes ${plural(period, 'frame')}`,
            choices: everyChoices(length, motion.mode, tones),
        })
    }
    return misses
}

export function lateKeys(motion: KeysMotion, length: number): { text: string, single: boolean } | null {
    const late = motion.keys.filter((key) => key.frame >= length)
    if (late.length === 0) return null
    const list = joinList(late.map((key) => String(key.frame)).slice(0, MAX_CHOICES))
    const single = late.length === 1
    return { text: `${single ? 'a keyframe at frame' : 'keyframes at frames'} ${list}`, single }
}

export function missingKeyColors(motion: KeysMotion, palette: PaletteData): { list: string, single: boolean } | null {
    const missing = missingColors(motion.keys, palette)
    if (missing.size === 0) return null
    return { list: quotedList(Array.from(missing)), single: missing.size === 1 }
}

function cycleProblems(slot: Slot, palette: PaletteData, loop: number): SlotProblem[] {
    const motion = slot.animation
    if (!motion || motion.kind !== 'cycle') return []
    return cycleMisses(slot, motion, palette, loop).map(({ tones, where, shape, choices }): SlotProblem => {
        const start = `Color '${slot.name}' ${shape}. That doesn't fit the ${loop}-frame loop, so the colors would jump when the loop restarts.`
        if (choices.length > 0) {
            const every = nearest(choices, motion.every)
            return {
                message: `${start} Move one shade every ${joinList(spread(choices), 'or')} frames instead.`,
                fix: where ? undefined : { kind: 'every', every },
            }
        }
        const shades = spread(shadeCountsThatFit(loop, motion.mode))
        const loops = loopsThatFit(loop, motion.mode, tones)
        const shadeText = shades.length ? `Give it ${joinList(shades, 'or')} shades` : 'Change its number of shades'
        const loopText = loops.length ? `, or make the loop ${joinList(loops, 'or')} frames long` : ''
        return { message: `${start} No speed fits with ${tones} shades. ${shadeText}${loopText}.` }
    })
}

function keyProblems(slot: Slot, palette: PaletteData, loop: number): SlotProblem[] {
    const motion = slot.animation
    if (!motion || motion.kind !== 'keys') return []
    const problems: SlotProblem[] = []
    const late = lateKeys(motion, loop)
    if (late) {
        const them = late.single ? 'it' : 'them'
        problems.push({
            message: `Color '${slot.name}' has ${late.text}, after the loop ends (frames 0 to ${loop - 1}). Move ${them} into the loop or remove ${them}.`,
            fix: { kind: 'drop_late_keys' },
        })
    }
    const missing = missingKeyColors(motion, palette)
    if (missing) {
        problems.push({
            message: `Color '${slot.name}' has keyframes that use ${missing.list}, ${missing.single ? 'which is no longer a color' : 'which are no longer colors'} here. Edit those keyframes with the color's Animate button.`,
            fix: { kind: 'open' },
        })
    }
    return problems
}

export function slotProblems(slot: Slot, palette: PaletteData, loop: number): SlotProblem[] {
    return [...cycleProblems(slot, palette, loop), ...keyProblems(slot, palette, loop)]
}

function keyColor(color: string, slot: Slot, tone: number, palette: PaletteData): string {
    if (isHexColor(color) || isBaseColor(color)) return color
    const ref = parseColorRef(color)
    const target = ref ? palette.slots.find((entry) => entry.id === ref.slot) : undefined
    if (!ref || !target) return toneRef(slot.id, Math.min(tone, slot.ramp.length - 1))
    if (ref.tone >= target.ramp.length) return toneRef(target.id, target.ramp.length - 1)
    return color
}

export function keysJson(slot: Slot, keys: ColorKey[], palette: PaletteData, loop: number): unknown[][] {
    const tones = Math.max(1, slot.ramp.length)
    const inside = sortKeys(keys).filter((key) => key.frame >= 0 && key.frame < loop)
    if (inside.length === 0) return []
    if (inside[0].frame !== 0) inside.unshift({ ...inside[0], frame: 0, ease: 'step' })
    return inside.map((key) => {
        const colors = Array.from({ length: tones }, (_, tone) => keyColor(key.colors[Math.min(tone, key.colors.length - 1)], slot, tone, palette))
        const entry: unknown[] = [key.frame, isBaseKey({ ...key, colors }) ? COLOR_BASE : tones === 1 ? colors[0] : colors]
        if (key.ease !== 'step') entry.push(key.ease)
        return entry
    })
}

export function slotTrack(slot: Slot, palette: PaletteData, loop: number): SlotTrack {
    const motion = slot.animation
    if (!motion) return { track: null, problems: [] }
    const problems = slotProblems(slot, palette, loop)
    if (motion.kind === 'cycle') {
        if (problems.length > 0) return { track: null, problems }
        return { track: { cycle: { every: motion.every, mode: motion.mode } }, problems }
    }
    const keys = keysJson(slot, motion.keys, palette, loop)
    return { track: keys.length ? { keys } : null, problems }
}

function animatedSlots(palette: PaletteData): Slot[] {
    return palette.slots.filter((slot) => !!slot.animation)
}

export function applyPaletteAnimation(palette: PaletteData, loop: number, manifest: Record<string, unknown>, issues: BundleIssue[]) {
    const tracks: Record<string, unknown> = {}
    for (const slot of animatedSlots(palette)) {
        const result = slotTrack(slot, palette, loop)
        for (const problem of result.problems) issues.push({ path: slotIssuePath(slot.id), message: problem.message })
        if (result.track) tracks[`${PALETTE_TRACK_PREFIX}${slot.id}`] = result.track
    }
    if (Object.keys(tracks).length === 0) return
    const animations = (manifest.animations && typeof manifest.animations === 'object' ? manifest.animations : {}) as Record<string, any>
    const current = animations.loop && typeof animations.loop === 'object' ? animations.loop : {}
    const existing = current.tracks && typeof current.tracks === 'object' ? current.tracks : {}
    const merged = { ...current, tracks: { ...existing, ...tracks } }
    manifest.animations = 'loop' in animations ? { ...animations, loop: merged } : { loop: merged, ...animations }
}

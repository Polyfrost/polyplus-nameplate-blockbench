import { integerAtLeast } from '../util/num'

export type CycleMode = 'forward' | 'backward' | 'pingpong'
export type ColorEase = 'step' | 'linear' | 'ease'

export const CYCLE_MODES: CycleMode[] = ['forward', 'backward', 'pingpong']
export const COLOR_EASES: ColorEase[] = ['step', 'linear', 'ease']
export const PALETTE_TRACK_PREFIX = 'palette.'
export const COLOR_BASE = 'base'

export const MODE_NAMES: Record<CycleMode, string> = {
    forward: 'Forwards',
    backward: 'Backwards',
    pingpong: 'Back and forth',
}

export const EASE_NAMES: Record<ColorEase, string> = {
    step: 'Jump',
    linear: 'Fade',
    ease: 'Smooth fade',
}

export interface ColorKey {
    frame: number
    colors: string[]
    ease: ColorEase
}

export interface CycleMotion {
    kind: 'cycle'
    every: number
    mode: CycleMode
}

export interface KeysMotion {
    kind: 'keys'
    keys: ColorKey[]
}

export type PaletteMotion = CycleMotion | KeysMotion

const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const SLOT_REF = /^([a-z0-9_]{1,64})(?:\[(\d{1,2})\])?$/

export function isHexColor(text: unknown): text is string {
    return typeof text === 'string' && HEX.test(text)
}

export function parseColorRef(text: unknown): { slot: string, tone: number } | null {
    if (typeof text !== 'string') return null
    const match = SLOT_REF.exec(text)
    if (!match || match[1] === 'auto' || match[1] === 'none') return null
    return { slot: match[1], tone: match[2] === undefined ? 0 : Number(match[2]) }
}

function isPlainColor(text: unknown): text is string {
    return isHexColor(text) || parseColorRef(text) !== null
}

export function isBaseColor(text: unknown): boolean {
    return text === COLOR_BASE
}

export function isKeyColor(text: unknown): text is string {
    return isBaseColor(text) || isPlainColor(text)
}

export function baseColors(tones: number): string[] {
    return Array.from({ length: Math.max(1, tones) }, () => COLOR_BASE)
}

export function isBaseKey(key: ColorKey): boolean {
    return key.colors.length > 0 && key.colors.every(isBaseColor)
}

export function toneRef(slot: string, tone: number): string {
    return tone === 0 && slot !== COLOR_BASE ? slot : `${slot}[${tone}]`
}

export function cyclePeriod(mode: CycleMode, tones: number, every: number): number {
    if (tones <= 1) return 1
    const rotations = mode === 'pingpong' ? 2 * (tones - 1) : tones
    return rotations * every
}

export function cycleFits(loop: number, mode: CycleMode, tones: number, every: number): boolean {
    return every >= 1 && loop % cyclePeriod(mode, tones, every) === 0
}

export function everyChoices(loop: number, mode: CycleMode, tones: number): number[] {
    const result: number[] = []
    for (let every = 1; every <= loop; every++) if (cycleFits(loop, mode, tones, every)) result.push(every)
    return result
}

export function shadeCountsThatFit(loop: number, mode: CycleMode, max = 16): number[] {
    const result: number[] = []
    for (let tones = 2; tones <= max; tones++) if (everyChoices(loop, mode, tones).length > 0) result.push(tones)
    return result
}

export function loopsThatFit(loop: number, mode: CycleMode, tones: number, max = 600): number[] {
    const round = cyclePeriod(mode, tones, 1)
    const below = Math.floor(loop / round) * round
    const above = Math.ceil(loop / round) * round
    return Array.from(new Set([below, above])).filter((frames) => frames >= 1 && frames <= max && frames !== loop)
}

function normalizeKey(raw: any, tones: number): ColorKey | null {
    const frame = integerAtLeast(raw?.frame, 0)
    if (frame === null || !Array.isArray(raw?.colors)) return null
    const colors = raw.colors.filter((color: unknown) => typeof color === 'string') as string[]
    if (!colors.length) return null
    const fitted = Array.from({ length: Math.max(1, tones) }, (_, tone) => colors[Math.min(tone, colors.length - 1)])
    const ease: ColorEase = COLOR_EASES.includes(raw?.ease) ? raw.ease : 'step'
    return { frame, colors: fitted, ease }
}

export function sortKeys(keys: ColorKey[]): ColorKey[] {
    const byFrame = new Map<number, ColorKey>()
    for (const key of keys) byFrame.set(key.frame, key)
    return Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame)
}

export function normalizeMotion(raw: any, tones: number): PaletteMotion | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    if (raw.kind === 'cycle') {
        const every = integerAtLeast(raw.every, 1)
        const mode: CycleMode = CYCLE_MODES.includes(raw.mode) ? raw.mode : 'forward'
        return { kind: 'cycle', every: every ?? 1, mode }
    }
    if (raw.kind === 'keys' && Array.isArray(raw.keys)) {
        const keys = sortKeys(raw.keys.map((key: any) => normalizeKey(key, tones)).filter((key: ColorKey | null): key is ColorKey => !!key))
        return keys.length ? { kind: 'keys', keys } : undefined
    }
    return undefined
}

export function describeMotion(motion: PaletteMotion | undefined): string {
    if (!motion) return 'Still'
    if (motion.kind === 'cycle') {
        const every = motion.every === 1 ? 'every frame' : `every ${motion.every} frames`
        return `${MODE_NAMES[motion.mode]}, one shade ${every}`
    }
    const count = motion.keys.length
    return count === 1 ? '1 keyframe' : `${count} keyframes over the loop`
}

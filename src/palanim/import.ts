import type { Slot } from '../model'
import { isRecord } from '../util/json'
import { numberIntegerAtLeast } from '../util/num'
import { COLOR_EASES, CYCLE_MODES, ColorEase, ColorKey, CycleMode, PALETTE_TRACK_PREFIX, PaletteMotion, baseColors, isBaseColor, isKeyColor, sortKeys } from './types'

function readCycle(raw: unknown): PaletteMotion | null {
    if (!isRecord(raw)) return null
    if (Object.keys(raw).some((key) => key !== 'every' && key !== 'mode')) return null
    const every = numberIntegerAtLeast(raw.every, 1)
    const mode = CYCLE_MODES.includes(raw.mode) ? (raw.mode as CycleMode) : null
    return every !== null && mode ? { kind: 'cycle', every, mode } : null
}

function readKeys(raw: unknown, tones: number, loop: number): PaletteMotion | null {
    if (!Array.isArray(raw) || raw.length === 0) return null
    const keys: ColorKey[] = []
    let previous = -1
    for (const entry of raw) {
        if (!Array.isArray(entry) || entry.length < 2 || entry.length > 3) return null
        const frame = numberIntegerAtLeast(entry[0], 0)
        if (frame === null || frame <= previous || frame >= loop) return null
        previous = frame
        const value = entry[1]
        const colors = isBaseColor(value) ? baseColors(tones) : typeof value === 'string' && tones === 1 ? [value] : Array.isArray(value) && value.length === tones ? value : null
        if (!colors || !colors.every(isKeyColor)) return null
        let ease: ColorEase = 'step'
        if (entry.length === 3) {
            if (!COLOR_EASES.includes(entry[2])) return null
            ease = entry[2]
        }
        keys.push({ frame, colors: colors.slice(), ease })
    }
    if (keys[0].frame !== 0) return null
    return { kind: 'keys', keys: sortKeys(keys) }
}

export function readTrack(channels: unknown, tones: number, loop: number): PaletteMotion | null {
    if (!isRecord(channels)) return null
    const names = Object.keys(channels)
    if (names.length !== 1) return null
    if (names[0] === 'cycle') return readCycle(channels.cycle)
    if (names[0] === 'keys') return readKeys(channels.keys, tones, loop)
    return null
}

export function takePaletteAnimation(manifest: Record<string, any>, slots: Slot[]): string[] {
    const taken: string[] = []
    const loop = manifest?.animations?.loop
    if (!isRecord(loop) || loop.schedule || loop.trigger || !isRecord(loop.tracks)) return taken
    const loopFrames = Number(manifest.loop)
    if (!Number.isInteger(loopFrames) || loopFrames < 1) return taken
    for (const target of Object.keys(loop.tracks)) {
        if (!target.startsWith(PALETTE_TRACK_PREFIX)) continue
        const id = target.slice(PALETTE_TRACK_PREFIX.length)
        const slot = slots.find((entry) => entry.id === id)
        if (!slot) continue
        const motion = readTrack(loop.tracks[target], slot.ramp.length, loopFrames)
        if (!motion) continue
        slot.animation = motion
        delete loop.tracks[target]
        taken.push(id)
    }
    return taken
}

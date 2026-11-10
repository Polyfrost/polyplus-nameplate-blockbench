import { FLASH_HOLD_HINT } from '../checks/budget'
import { classifyIssue, issueValue } from '../checks/codes'
import { currentBundle } from '../compile'
import { BundleBinary, currentBinary, EngineIssue, loadBundle } from '../engine'
import { readNameplate } from '../palette/state'
import { quotedList } from '../util/text'
import { CycleMotion, PALETTE_TRACK_PREFIX, everyChoices } from './types'

const MANIFEST = 'manifest.json'
const PALETTES = 'palettes.json'

interface FlashFound {
    times: number
    pixels: number
}

let memo: { files: Record<string, string>, binary: BundleBinary, value: string[] } | null = null

function flashIn(issues: EngineIssue[]): FlashFound | null {
    for (const issue of issues) {
        if (issue.path !== MANIFEST) continue
        const facts = classifyIssue(issue)
        if (facts.code !== 'flash') continue
        const times = issueValue(facts, 'flashes')
        const pixels = issueValue(facts, 'px')
        if (times !== null && pixels !== null) return { times, pixels }
    }
    return null
}

function flashOf(files: Record<string, string>): FlashFound | null {
    try {
        return flashIn(loadBundle(files).issues)
    } catch (error) {
        console.error('[polyplus_nameplate] flash check failed', error)
        return null
    }
}

export function withTrack(
    files: Record<string, string>,
    slotId: string,
    track: Record<string, unknown> | null,
    ramp: string[] | null = null,
): Record<string, string> {
    const next = { ...files }
    try {
        const manifest = JSON.parse(files[MANIFEST])
        const animations = manifest.animations && typeof manifest.animations === 'object' ? manifest.animations : {}
        const loop = animations.loop && typeof animations.loop === 'object' ? animations.loop : {}
        const tracks = loop.tracks && typeof loop.tracks === 'object' ? { ...loop.tracks } : {}
        if (track) tracks[`${PALETTE_TRACK_PREFIX}${slotId}`] = track
        else delete tracks[`${PALETTE_TRACK_PREFIX}${slotId}`]
        manifest.animations = { ...animations, loop: { ...loop, tracks } }
        next[MANIFEST] = JSON.stringify(manifest)
        if (ramp) {
            const palettes = JSON.parse(files[PALETTES])
            for (const slot of palettes.slots ?? []) if (slot?.id === slotId) slot.ramp = ramp
            for (const overrides of Object.values(palettes.colorways ?? {}) as any[]) if (overrides) delete overrides[slotId]
            next[PALETTES] = JSON.stringify(palettes)
        }
    } catch (error) {
        console.error('[polyplus_nameplate] could not patch the bundle for a flash check', error)
    }
    return next
}

export function safeCycle(slotId: string, motion: CycleMotion, ramp: string[] | null, loop: number): { motion: CycleMotion, safe: boolean } {
    const files = currentBundle().files
    if (!files[MANIFEST] || !files[PALETTES]) return { motion, safe: true }
    const tones = ramp ? ramp.length : readNameplate().palette.slots.find((slot) => slot.id === slotId)?.ramp.length ?? 1
    const choices = everyChoices(loop, motion.mode, tones).filter((every) => every >= motion.every)
    for (const every of choices) {
        if (!flashOf(withTrack(files, slotId, { cycle: { every, mode: motion.mode } }, ramp))) return { motion: { ...motion, every }, safe: true }
    }
    return { motion, safe: choices.length === 0 }
}

export function keysFlash(slotId: string, track: Record<string, unknown>): boolean {
    const files = currentBundle().files
    if (!files[MANIFEST] || !files[PALETTES]) return false
    return !!flashOf(withTrack(files, slotId, track))
}

function paletteTrackIds(files: Record<string, string>): string[] {
    try {
        const tracks = JSON.parse(files[MANIFEST])?.animations?.loop?.tracks ?? {}
        return Object.keys(tracks).filter((name) => name.startsWith(PALETTE_TRACK_PREFIX)).map((name) => name.slice(PALETTE_TRACK_PREFIX.length))
    } catch {
        return []
    }
}

function sameBinary(a: BundleBinary, b: BundleBinary): boolean {
    const names = Object.keys(a)
    return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name])
}

function flashCulprits(files: Record<string, string> = currentBundle().files): string[] {
    const binary = currentBinary()
    if (memo && memo.files === files && sameBinary(memo.binary, binary)) return memo.value
    const ids = flashOf(files) ? paletteTrackIds(files) : []
    let culprits = ids.filter((id) => !flashOf(withTrack(files, id, null)))
    if (!culprits.length && ids.length > 1) {
        let stripped = files
        for (const id of ids) stripped = withTrack(stripped, id, null)
        if (!flashOf(stripped)) culprits = ids
    }
    memo = { files, binary, value: culprits }
    return culprits
}

function nameOf(slotId: string): string {
    return readNameplate().palette.slots.find((slot) => slot.id === slotId)?.name ?? slotId
}

export function flashProblemText(issue: EngineIssue): string | null {
    const found = flashIn([issue])
    if (!found) return null
    const limit = issueValue(issue, 'limit') ?? 3
    const area = issueValue(issue, 'area') ?? 64
    const opening = `${found.pixels} pixels flash together ${found.times} times a second. More than ${area} pixels flashing together more than ${limit} times a second can trigger seizures, so it can't be exported.`
    const culprits = flashCulprits()
    if (!culprits.length) {
        return `${opening} Slow down whatever changes brightness quickly (frames, opacity or colors), or make the bright and dark parts closer in brightness. ${FLASH_HOLD_HINT}`
    }
    const list = quotedList(culprits.map((id) => nameOf(id)))
    const which = culprits.length === 1 ? 'the color animation of' : 'the color animations of'
    return `${opening} It comes from ${which} ${list}. Click the color's Animate button and pick a slower speed (the Safe speed button finds one), use Fade instead of Jump between keyframes, or use shades closer in brightness.`
}

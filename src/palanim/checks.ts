import { pathCovers } from '../checks/helpers'
import { currentLoopFrames } from '../format'
import type { Problem } from '../export/issues'
import type { BundleIssue, NameplateData, Slot } from '../model'
import { readNameplate } from '../palette/state'
import { SlotFix, slotIssuePath, slotProblems, trackIssuePath } from './compile'
import { dropLateKeys, focusSlot, setCycle } from './edit'
import { flashProblemText } from './flash'
import { hasProject } from '../util/project'
import { isHexColor } from './types'

function fixButton(slot: Slot, fix: SlotFix | undefined, loop: number): Problem['buttons'] {
    const open = { name: 'Open color animation', icon: 'palette', click: () => focusSlot(slot.id) }
    if (!fix) return [open]
    if (fix.kind === 'every') {
        const text = fix.every === 1 ? 'every frame' : `every ${fix.every} frames`
        return [{ name: `Use ${text}`, icon: 'build', click: () => setCycle(slot.id, (motion) => { motion.every = fix.every }) }, open]
    }
    if (fix.kind === 'drop_late_keys') return [{ name: 'Remove those keyframes', icon: 'delete', click: () => dropLateKeys(slot.id, loop) }, open]
    return [open]
}

function fixedColorWarning(slot: Slot, plate: NameplateData): Problem | null {
    const motion = slot.animation
    if (motion?.kind !== 'keys') return null
    const others = Object.keys(plate.palette.colorways).filter((name) => !!plate.palette.colorways[name]?.[slot.id])
    if (!others.length || !motion.keys.some((key) => key.colors.some(isHexColor))) return null
    return {
        level: 'warning',
        text: `Color '${slot.name}' has keyframes with fixed colors, so colorway ${others.map((name) => `'${name}'`).join(', ')} shows those same colors while it animates. Keyframes set to Base (right-click a keyframe) follow each colorway.`,
        target: null,
        buttons: [{ name: 'Open color animation', icon: 'palette', click: () => focusSlot(slot.id) }],
    }
}

function stillCycleWarning(slot: Slot): Problem | null {
    if (slot.animation?.kind !== 'cycle' || slot.ramp.length > 1) return null
    return {
        level: 'warning',
        text: `Color '${slot.name}' takes turns between its shades, but it has only one shade. Add shades in the Colors strip, or pick another style.`,
        target: null,
        buttons: [{ name: 'Open color animation', icon: 'palette', click: () => focusSlot(slot.id) }],
    }
}

export function paletteAnimationProblems(): Problem[] {
    if (!hasProject()) return []
    const plate = readNameplate()
    const loop = currentLoopFrames()
    const problems: Problem[] = []
    for (const slot of plate.palette.slots) {
        if (!slot.animation) continue
        const underSlot = pathCovers(slotIssuePath(slot.id), '.[')
        const underTrack = pathCovers(trackIssuePath(slot.id), '.[')
        const covers = (path: string) => underSlot(path) || underTrack(path)
        for (const problem of slotProblems(slot, plate.palette, loop)) {
            problems.push({ level: 'error', text: problem.message, target: null, buttons: fixButton(slot, problem.fix, loop), covers })
        }
        const warnings = [stillCycleWarning(slot), fixedColorWarning(slot, plate)]
        for (const warning of warnings) if (warning) problems.push(warning)
    }
    return problems
}

export function paletteIssueText(issue: BundleIssue): string | null {
    return flashProblemText(issue)
}

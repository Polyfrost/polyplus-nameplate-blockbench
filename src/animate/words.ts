import { badgeNode, ensureBadgeNode } from '../badge'
import { readLayers } from '../elements'
import { findNode } from '../elements/nodes'
import { issueValue } from '../checks/codes'
import { plainMessage } from '../checks/words'
import type { EngineIssue } from '../engine'
import { BADGE_TARGET, PLATE_TARGET } from '../model'
import { goMode } from '../navigate'
import { dropMissingSlotMotion, focusSlot } from '../palanim/edit'
import { ensurePlateNode, plateNode, selectPlateRow } from '../plate'
import { readNameplate } from '../palette/state'
import { PALETTE_TRACK_PREFIX } from '../palanim/types'
import { allAnimations } from '../util/animation'

interface ReactionButton {
    name: string
    icon: string
    click(): void
}

interface ReactionProblem {
    text: string
    buttons: ReactionButton[]
}

const MANIFEST = 'manifest.json#animations.'

function animationNamed(name: string): any | null {
    return allAnimations().find((animation) => animation?.name === name) ?? null
}

function selectAnimation(name: string): any | null {
    const animation = animationNamed(name)
    if (!animation) return null
    goMode('animate')
    try {
        animation.select()
    } catch (error) {
        console.error('[polyplus_nameplate] could not select the animation', error)
    }
    return animation
}

function selectNode(node: any) {
    try {
        node?.select?.()
    } catch (error) {
        console.error('[polyplus_nameplate] could not select the timeline row', error)
    }
}

function showLayerKeys(name: string, layerId: string): ReactionButton {
    return {
        name: 'Show keyframes',
        icon: 'movie',
        click: () => {
            const uuid = readLayers().find((layer) => layer.id === layerId)?.uuid
            if (!selectAnimation(name)) return
            if (uuid) selectNode(findNode(uuid))
        },
    }
}

function showNodeKeys(animationName: string, name: string, icon: string, node: () => any): ReactionButton {
    return {
        name,
        icon,
        click: () => {
            if (!selectAnimation(animationName)) return
            selectNode(node())
        },
    }
}

function showBadgeKeys(name: string): ReactionButton {
    return showNodeKeys(name, 'Show badge keyframes', 'verified', () => badgeNode() ?? ensureBadgeNode())
}

function showPlateKeys(name: string): ReactionButton {
    return showNodeKeys(name, 'Show Whole nameplate keyframes', 'open_with', () => plateNode() ?? ensurePlateNode())
}

function showColors(name: string, slot: string): ReactionButton {
    return {
        name: 'Open color animation',
        icon: 'palette',
        click: () => {
            selectAnimation(name)
            focusSlot(slot)
        },
    }
}

function removeMissingColor(name: string, slot: string): ReactionButton {
    return {
        name: 'Remove color change',
        icon: 'delete',
        click: () => {
            dropMissingSlotMotion(animationNamed(name), slot)
        },
    }
}

function slotExists(slot: string): boolean {
    try {
        return readNameplate().palette.slots.some((entry) => entry.id === slot)
    } catch (error) {
        return true
    }
}

function openProperties(name: string): ReactionButton {
    return {
        name: 'Open animation',
        icon: 'movie',
        click: () => {
            selectAnimation(name)?.propertiesDialog?.()
        },
    }
}

function speedText(issue: EngineIssue): string | null {
    switch (issue.code) {
        case 'speed_trigger':
            return "Random animations can't change a path's speed. Delete the Speed keyframes here, or key them in the loop, a reaction or a one-shot."
        case 'speed_path':
            if (issueValue(issue, 'laps') !== null) return "Speed keyframes don't work on a path timed in laps. Delete them, or set Timing to Speed."
            return 'Speed keyframes only work on a path layer. Delete them from this layer.'
        case 'speed_range': {
            const limit = issueValue(issue, 'limit') ?? 16
            return `A Speed keyframe is out of range. Use -${limit} to ${limit} px per frame: 0 stops the path, below 0 runs it backwards.`
        }
        case 'key_start':
            return 'The first Speed keyframe must be at frame 0. Add one there.'
        default:
            return null
    }
}

function keyText(issue: EngineIssue, what: string): string | null {
    switch (issue.code) {
        case 'key_range':
            return `A ${what} keyframe is after the end of the animation. Move it earlier, or make the animation longer in its properties.`
        case 'key_order':
            return `Two ${what} keyframes are on the same frame. Delete one of them.`
        case 'burst_count':
            return `A Burst keyframe asks for too many particles. Use 1 to ${issueValue(issue, 'limit') ?? 0}.`
        default:
            return null
    }
}

function badgeText(issue: EngineIssue): string | null {
    switch (issue.code) {
        case 'badge_schedule':
            return "Random animations can't move the PolyPlus badge. Delete its keyframes here, or make this a reaction or one-shot."
        case 'badge_channel':
            return 'The PolyPlus badge can only change Position, Opacity and Visible.'
        case 'badge_molang':
            return 'Badge keyframes take plain numbers, not formulas. Replace the formula with a number.'
        default:
            return null
    }
}

function plateText(issue: EngineIssue): string | null {
    return issue.code === 'plate_channel' ? 'The whole nameplate can only change Position.' : null
}

function plateReach(issue: EngineIssue): ReactionProblem {
    const limit = issueValue(issue, 'limit')
    const room = limit === null ? 'the room' : `the ${limit} px`
    const text = `The whole nameplate moves too far. Its Position keyframes must stay within ${room} the game keeps around a nameplate. Make them smaller.`
    return { text, buttons: [{ name: 'Show the Whole nameplate row', icon: 'open_with', click: selectPlateRow }] }
}

function paletteText(issue: EngineIssue, slot: string): string {
    if (issue.code === 'palette_molang') {
        return `Color '${slot}' uses a color formula here. Reactions and one-shots take fixed colors or the palette's own shades; color formulas only work in the loop. Edit the keyframe with the color's Animate button.`
    }
    const cycle = issue.code === 'palette_cycle' ? issueValue(issue, 'cycle') : null
    const length = issueValue(issue, 'length')
    if (cycle !== null && length !== null) {
        return `Color '${slot}' takes ${cycle} frames per round, which doesn't fit its ${length} frames, so the colors would jump. Change its speed with the color's Animate button.`
    }
    return `Color '${slot}': ${plainMessage(issue.message)}`
}

function reducedText(issue: EngineIssue): string {
    if (issue.code === 'reduced_while') {
        return "Only reactions that play for as long as they last have a choice for players who turn motion down. One-shots never play for them."
    }
    return `The choice for players who turn motion down must be 'Keep a still version' or 'Skip it'. Open its properties and pick one.`
}

export function reactionProblem(issue: EngineIssue): ReactionProblem | null {
    if (!issue.path.startsWith(MANIFEST)) return null
    const rest = issue.path.slice(MANIFEST.length)
    if (rest === PLATE_TARGET) return issue.code === 'over_margin' ? plateReach(issue) : null
    const dot = rest.indexOf('.')
    if (dot < 0) return null
    const name = rest.slice(0, dot)
    const field = rest.slice(dot + 1)
    const label = `Animation '${name}'`
    if (field === 'reduced') return { text: `${label}: ${reducedText(issue)}`, buttons: [openProperties(name)] }
    if (field === `tracks.${BADGE_TARGET}` || field.startsWith(`tracks.${BADGE_TARGET}.`)) {
        const text = badgeText(issue) ?? keyText(issue, 'badge') ?? `the PolyPlus badge: ${plainMessage(issue.message)}`
        return { text: `${label}: ${text}`, buttons: [showBadgeKeys(name)] }
    }
    if (field === `tracks.${PLATE_TARGET}` || field.startsWith(`tracks.${PLATE_TARGET}.`)) {
        const text = plateText(issue) ?? keyText(issue, 'Whole nameplate') ?? `the whole nameplate: ${plainMessage(issue.message)}`
        return { text: `${label}: ${text}`, buttons: [showPlateKeys(name)] }
    }
    const palette = new RegExp(`^tracks\\.${PALETTE_TRACK_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([a-z0-9_]+)`).exec(field)
    if (palette && name !== 'loop') {
        const button = slotExists(palette[1]) ? showColors(name, palette[1]) : removeMissingColor(name, palette[1])
        return { text: `${label}: ${paletteText(issue, palette[1])}`, buttons: [button] }
    }
    const motion = /^tracks\.([a-z0-9_]+)\.(speed|burst)(\[\d+\])?$/.exec(field)
    if (!motion) return null
    const what = motion[2] === 'speed' ? 'Speed' : 'Burst'
    const text = (motion[2] === 'speed' ? speedText(issue) : null) ?? keyText(issue, what) ?? `${what} keyframes on '${motion[1]}': ${plainMessage(issue.message)}`
    return { text: `${label}: ${text}`, buttons: [showLayerKeys(name, motion[1])] }
}

import type { Problem } from '../export/issues'
import { currentBundle } from '../compile'
import type { EngineIssue } from '../engine'
import { isMolangCode } from '../checks/codes'
import { pathCovers, removeButton } from '../checks/helpers'
import { channelName } from '../animate/checks'
import { badgeNode } from '../badge/node'
import { readGroups, readLayers } from '../elements'
import { DEFAULT_FPS } from '../format'
import { isBaseText, isParamChannel } from '../material/params'
import { BADGE_TARGET, LOOP_ANIMATION, PLATE_TARGET } from '../model'
import { goMode } from '../navigate'
import { plateNode } from '../plate'
import { readNameplate } from '../palette/state'
import { openSlotMolangEditor } from './editor'
import { classifyValue } from './expression'
import { refreshKeyframes } from './keys'
import { paramsOfManifest } from './params'
import { checkConstantFormula, checkMolang, molangIssueText } from './probe'
import { clearSlotMolang, readSlotMolang, slotMolangPath } from './slots'
import { allAnimations } from '../util/animation'
import { hasProject } from '../util/project'

const FORMULA_CHANNELS = new Set(['frame', 'position', 'opacity', 'visible'])

interface KeyGroup {
    animation: any
    keyframes: any[]
    target: string
    name: string
    channel: string
    axis: 'x' | 'y'
    source: string
    constant: boolean
}

function goToKey(animation: any, keyframe: any) {
    goMode('animate')
    try {
        animation?.select?.()
        const timeline = (globalThis as any).Timeline
        if (typeof timeline?.setTime === 'function') timeline.setTime(Number(keyframe.time) || 0)
        keyframe?.select?.()
        refreshKeyframes()
    } catch (error) {
        console.error('[polyplus_nameplate] could not show the keyframe', error)
    }
}

function keyGroups(): KeyGroup[] {
    const ids = new Map<string, string>()
    for (const layer of readLayers()) ids.set(layer.uuid, layer.id)
    for (const group of readGroups()) ids.set(group.uuid, group.id)
    const badge = badgeNode()
    if (badge) ids.set(badge.uuid, BADGE_TARGET)
    const plate = plateNode()
    if (plate) ids.set(plate.uuid, PLATE_TARGET)
    const groups = new Map<string, KeyGroup>()
    for (const animation of allAnimations()) {
        for (const [uuid, animator] of Object.entries<any>(animation?.animators ?? {})) {
            const target = ids.get(uuid)
            if (!target) continue
            const keyframes: any[] = Array.isArray(animator?.keyframes) ? animator.keyframes : []
            for (const keyframe of keyframes) {
                const channel = String(keyframe?.channel ?? '')
                const point = keyframe?.data_points?.[0]
                const axes: Array<'x' | 'y'> = channel === 'position' ? ['x', 'y'] : ['x']
                for (const axis of axes) {
                    const value = classifyValue(point?.[axis])
                    if (value.kind === 'empty' || value.kind === 'number') continue
                    const { source } = value
                    const key = `${animation.uuid}|${uuid}|${channel}|${axis}|${source}`
                    let group = groups.get(key)
                    if (!group) {
                        group = { animation, keyframes: [], target, name: String(animator?.name ?? target), channel, axis, source, constant: value.kind === 'constant' }
                        groups.set(key, group)
                    }
                    group.keyframes.push(keyframe)
                }
            }
        }
    }
    for (const group of groups.values()) group.keyframes.sort((a, b) => a.time - b.time)
    return Array.from(groups.values())
}

function frames(keyframes: any[], fps: number): string {
    const list = keyframes.map((keyframe) => Math.round(Number(keyframe.time) * fps))
    return list.length === 1 ? `the keyframe at frame ${list[0]}` : `the keyframes at frames ${list.join(', ')}`
}

function channelLabel(group: KeyGroup): string {
    const name = channelName(group.channel)
    return group.channel === 'position' ? `${name} ${group.axis.toUpperCase()}` : name
}

function formulaMessages(group: KeyGroup, params: Record<string, number>): string[] {
    if (group.constant) return checkConstantFormula(group.source, params)
    if (FORMULA_CHANNELS.has(group.channel)) return checkMolang(group.source, 'channel', params)
    if (isParamChannel(group.channel)) return isBaseText(group.source) ? [] : ["this keyframe takes a number or 'base', not a formula. Type one of those."]
    return ['this keyframe takes a plain number, not a formula. Type a number.']
}

function keyProblems(params: Record<string, number>, fps: number): Problem[] {
    const problems: Problem[] = []
    for (const group of keyGroups()) {
        const messages = formulaMessages(group, params)
        if (messages.length === 0) continue
        const animation = String(group.animation?.name ?? LOOP_ANIMATION)
        const covers = pathCovers(`manifest.json#animations.${animation}.tracks.${group.target}.${group.channel}`, '.[')
        for (const message of messages) {
            problems.push({
                level: 'error',
                text: `Animation '${animation}', ${channelLabel(group)} formula on '${group.name}' (${frames(group.keyframes, fps)}): ${message}`,
                target: null,
                buttons: [{ name: 'Go to keyframe', icon: 'my_location', click: () => goToKey(group.animation, group.keyframes[0]) }],
                covers,
            })
        }
    }
    return problems
}

function slotProblems(params: Record<string, number>): Problem[] {
    const problems: Problem[] = []
    const slots = readNameplate().palette.slots
    const state = readSlotMolang()
    const bundle = currentBundle()
    for (const [slotId, tones] of Object.entries(state)) {
        const slot = slots.find((entry) => entry.id === slotId)
        if (!slot) {
            problems.push({
                level: 'warning',
                text: `A color formula is saved for color '${slotId}', which no longer exists. It is left out of the zip.`,
                target: null,
                buttons: [removeButton(() => clearSlotMolang(slotId), 'Remove it')],
            })
            continue
        }
        const path = slotMolangPath(slotId)
        const covers = pathCovers(path, '.[')
        const edit = { name: 'Edit formula', icon: 'functions', click: () => openSlotMolangEditor(slotId) }
        tones.slice(0, slot.ramp.length).forEach((source, tone) => {
            if (!source) return
            for (const message of checkMolang(source, 'slot', params)) {
                problems.push({ level: 'error', text: `Color '${slot.name}', shade ${tone + 1} formula: ${message}`, target: null, buttons: [edit], covers })
            }
        })
        if (tones.length > slot.ramp.length && tones.slice(slot.ramp.length).some((source) => source)) {
            problems.push({
                level: 'warning',
                text: `Color '${slot.name}' has ${slot.ramp.length} shades now, so the formulas for the shades after that are left out.`,
                target: null,
                buttons: [edit],
            })
        }
        for (const issue of bundle.issues.filter((entry) => covers(entry.path)) as EngineIssue[]) {
            if (isMolangCode(issue.code)) continue
            problems.push({
                level: 'error',
                text: `Color '${slot.name}' (color formula): ${molangIssueText(issue, 'slot')}`,
                target: null,
                buttons: [edit],
                covers,
            })
        }
    }
    return problems
}

export function molangProblems(): Problem[] {
    if (!hasProject()) return []
    const nameplate = readNameplate()
    const fps = nameplate.fps > 0 ? nameplate.fps : DEFAULT_FPS
    const params = paramsOfManifest(currentBundle().files['manifest.json'])
    return [...keyProblems(params, fps), ...slotProblems(params)]
}

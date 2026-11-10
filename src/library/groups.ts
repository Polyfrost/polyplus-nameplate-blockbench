import { findNode, groupNodes, isGroupNode, selectedLayerNodes } from '../elements/nodes'
import { FORMAT_ID, GroupData } from '../model'
import { LIMITS } from '../motion/types'
import { wholeClamped } from '../util/num'
import { widthRanges } from '../kinds/ranges'
import { FormConfig, Values } from '../schema/form'
import { sameSerialized } from '../util/json'
import { undoEdit } from '../util/undo'

export const GROUP_BREAKPOINTS = 'nameplate_breakpoints'

export interface GroupBreakpoint {
    min: number
    max: number | null
}

export interface GroupWidthProblem {
    level: 'error' | 'warning'
    message: string
    node: any
}

let property: Property | null = null

export function readGroupBreakpoints(value: unknown): GroupBreakpoint[] {
    const list = Array.isArray(value) ? value : []
    return list
        .filter((raw: any) => raw && typeof raw === 'object')
        .map((raw: any) => {
            const max = raw.max === null || raw.max === undefined || raw.max === '' ? null : wholeClamped(raw.max, 0, LIMITS.width, 0)
            return { min: wholeClamped(raw.min, 0, LIMITS.width, 0), max }
        })
}

export function registerGroupBreakpoints(): () => void {
    if (!property) {
        property = new Property(Group as any, 'array', GROUP_BREAKPOINTS, {
            default: [],
            condition: { formats: [FORMAT_ID] },
        } as any)
    }
    return () => {
        property?.delete()
        property = null
    }
}

export function withGroupBreakpoints(groups: GroupData[]): GroupData[] {
    return groups.map((group) => {
        const node = group.uuid ? findNode(group.uuid) : null
        const breakpoints = readGroupBreakpoints(node?.[GROUP_BREAKPOINTS])
        return breakpoints.length > 0 ? { ...group, breakpoints } : group
    })
}

export function groupBreakpointsJson(group: GroupData): { breakpoints?: Array<Record<string, number>> } {
    const breakpoints = group.breakpoints ?? []
    if (breakpoints.length === 0) return {}
    return {
        breakpoints: breakpoints.map((breakpoint) => {
            const entry: Record<string, number> = { min: breakpoint.min }
            if (breakpoint.max !== null) entry.max = breakpoint.max
            return entry
        }),
    }
}

export function groupBreakpointPlan(groups: unknown, id: string): GroupBreakpoint[] | undefined {
    if (!Array.isArray(groups)) return undefined
    const group = groups.find((entry: any) => entry && typeof entry === 'object' && entry.id === id)
    const breakpoints = readGroupBreakpoints(group?.breakpoints)
    return breakpoints.length > 0 ? breakpoints : undefined
}

export function applyGroupBreakpoints(group: any, breakpoints: GroupBreakpoint[] | undefined) {
    if (!group) return
    group[GROUP_BREAKPOINTS] = (breakpoints ?? []).map((breakpoint) => ({ min: breakpoint.min, max: breakpoint.max }))
}

const ranges = widthRanges({
    prefix: 'gw',
    read: (node) => readGroupBreakpoints(node[GROUP_BREAKPOINTS]),
    onDescription: 'Hides this group outside the ranges below. Short names are about 20 px, long ones 80 px or more',
    fallback: 'previous',
})

export function groupFormConfig(node: any): FormConfig | null {
    return isGroupNode(node) ? ranges.config(node) : null
}

export function groupFormValues(node: any): Values | null {
    return isGroupNode(node) ? ranges.values!(node) : null
}

function selectedGroups(): any[] {
    const first = typeof Group !== 'undefined' ? (Group as any).first_selected : null
    const multi = (typeof Group !== 'undefined' ? (Group as any).multi_selected : null) as any[] | null
    const list = Array.isArray(multi) ? multi.filter(isGroupNode) : []
    if (isGroupNode(first) && !list.includes(first)) list.unshift(first)
    return list
}

function insideAny(node: any, groups: any[]): boolean {
    let parent = node?.parent
    for (let hops = 0; parent && parent !== 'root' && hops < 256; hops++) {
        if (groups.includes(parent)) return true
        parent = parent.parent
    }
    return false
}

export function selectedGroupNode(): any | null {
    const groups = selectedGroups()
    if (groups.length === 0) return null
    return selectedLayerNodes().every((node) => insideAny(node, groups)) ? groups[0] : null
}

export function applyGroupChange(changed: string[], result: Values): boolean {
    if (!changed.some((key) => key.startsWith('gw_'))) return false
    const groups = selectedGroupNode() ? selectedGroups() : []
    if (groups.length === 0) return true
    const next = ranges.from(groups[0], result) as GroupBreakpoint[]
    const same = (node: any) => sameSerialized(readGroupBreakpoints(node[GROUP_BREAKPOINTS]), next)
    if (groups.every(same)) {
        Blockbench.dispatchEvent('update_selection', {} as any)
        return true
    }
    undoEdit({ groups }, next.length > 0 ? 'Set group name widths' : 'Show group at every name width', () => {
        for (const group of groups) applyGroupBreakpoints(group, next)
    })
    return true
}

export function groupWidthProblems(): GroupWidthProblem[] {
    const problems: GroupWidthProblem[] = []
    for (const node of groupNodes()) {
        const breakpoints = readGroupBreakpoints(node[GROUP_BREAKPOINTS])
        if (breakpoints.length === 0) continue
        const name = `Group '${String(node.name ?? '')}'`
        if (breakpoints.length > LIMITS.breakpoints) {
            problems.push({ level: 'error', message: `${name} has ${breakpoints.length} name width ranges; the most is ${LIMITS.breakpoints}. Remove some in the Inspector.`, node })
        }
        breakpoints.forEach((breakpoint, index) => {
            if (breakpoint.max !== null && breakpoint.max <= breakpoint.min) {
                problems.push({ level: 'error', message: `${name}: name width range ${index + 1} stops at ${breakpoint.max}, which is not above where it starts (${breakpoint.min}). Raise the second number, or set it to 0 for no limit.`, node })
            }
        })
        const children: any[] = Array.isArray(node.children) ? node.children : []
        if (children.length === 0) {
            problems.push({ level: 'warning', message: `${name} has name width ranges but no layers, so they change nothing. Move layers into it, or turn the ranges off.`, node })
        }
    }
    return problems
}

export function coversGroupBreakpoints(path: string): boolean {
    return /^manifest\.json#groups\[\d+\]\.breakpoints/.test(path)
}

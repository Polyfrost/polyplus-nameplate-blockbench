import type { Position } from './arrange'
import { isRecord, sameSerialized } from '../util/json'

const LAYOUTS_PROPERTY = 'nameplate_node_layouts'

type StoredLayouts = Record<string, Record<string, [number, number]>>

let property: Property | null = null

function normalizeLayouts(raw: unknown): StoredLayouts {
    const result: StoredLayouts = {}
    if (!isRecord(raw)) return result
    for (const [key, layout] of Object.entries(raw)) {
        if (!isRecord(layout)) continue
        const positions: Record<string, [number, number]> = {}
        for (const [id, point] of Object.entries(layout)) {
            if (Array.isArray(point) && point.length === 2 && point.every((part) => typeof part === 'number' && isFinite(part))) {
                positions[id] = [point[0], point[1]]
            }
        }
        if (Object.keys(positions).length) result[key] = positions
    }
    return result
}

function currentProject(): any {
    return typeof Project !== 'undefined' && Project ? Project : null
}

export function readLayout(key: string, project: any = currentProject()): Map<string, Position> {
    const result = new Map<string, Position>()
    if (!project) return result
    const stored = normalizeLayouts(project[LAYOUTS_PROPERTY])[key] ?? {}
    for (const [id, [x, y]] of Object.entries(stored)) result.set(id, { x, y })
    return result
}

export function writeLayout(key: string, positions: Map<string, Position>, keep: Set<string> | null, project: any = currentProject()): boolean {
    if (!project) return false
    const all = normalizeLayouts(project[LAYOUTS_PROPERTY])
    const next: Record<string, [number, number]> = {}
    for (const [id, position] of positions) {
        if (keep && !keep.has(id)) continue
        next[id] = [Math.round(position.x), Math.round(position.y)]
    }
    if (sameSerialized(all[key] ?? {}, next)) return false
    if (Object.keys(next).length) all[key] = next
    else delete all[key]
    project[LAYOUTS_PROPERTY] = all
    project.saved = false
    return true
}

export function registerLayouts() {
    if (property) return
    property = new Property(ModelProject, 'object', LAYOUTS_PROPERTY, {
        exposed: false,
        default: () => ({}),
    })
}

export function unregisterLayouts() {
    property?.delete()
    property = null
}

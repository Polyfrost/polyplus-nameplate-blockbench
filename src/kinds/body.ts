import { fillFromParts, fillJson } from '../elements/fill'
import { BodyData, BundleIssue, FillData, NAME_MASK } from '../model'
import { CORNERS_PROPERTY, cornerFields, cornerProps, readCorners } from '../corners/shape'
import { artFromJson, artJson } from '../art/layout'
import type { PathStep } from '../import/extra'
import { parseSlotRef } from '../import/ramp'
import { isRecord } from '../util/json'
import { wholeOrAtLeast } from '../util/num'

export const BODY_KEYS = new Set(['kind', 'padding', 'minWidth', 'radius', 'corners', 'fill', 'rings', 'art', 'of'])

export function defineBodyProperties(target: any) {
    new Property(target, 'string', 'name', { default: 'body' })
    new Property(target, 'boolean', 'visibility', { default: true })
    new Property(target, 'enum', 'depth', { default: 'background', values: ['behind', 'background', 'over_background', 'over_text'] })
    new Property(target, 'number', 'step', { default: 1 })
    new Property(target, 'array', 'padding', { default: () => [3, 2, 3, 2] })
    new Property(target, 'number', 'minWidth', { default: 0 })
    new Property(target, 'number', 'radius', { default: 2 })
    new Property(target, 'array', CORNERS_PROPERTY, { default: () => [] })
    new Property(target, 'object', 'fill', { default: () => ({ kind: 'color', ref: '' }) })
    new Property(target, 'object', 'rings', { default: () => [] })
    new Property(target, 'string', 'of', { default: '' })
}

export function asFill(value: unknown): FillData | null {
    return value && typeof value === 'object' ? fillFromParts(value as any) : null
}

export function readBody(node: any, base: { uuid: string, id: string, depth: BodyData['depth'], step: number }): BodyData {
    const padding = Array.isArray(node.padding) ? node.padding : []
    const rings: FillData[] = []
    for (const ring of Array.isArray(node.rings) ? node.rings : []) {
        const fill = asFill(ring)
        if (fill) rings.push(fill)
    }
    return {
        kind: 'body',
        ...base,
        padding: [0, 1, 2, 3].map((index) => wholeOrAtLeast(padding[index], 0, 0)) as BodyData['padding'],
        minWidth: wholeOrAtLeast(node.minWidth, 0, 0),
        radius: wholeOrAtLeast(node.radius, 0, 0),
        corners: readCorners(node),
        fill: asFill(node.fill),
        rings,
        of: node.of === NAME_MASK ? NAME_MASK : null,
    }
}

export function bodyJson(layer: BodyData, spriteIds: Map<string, string>, issues: BundleIssue[]): Record<string, unknown> {
    const file: Record<string, unknown> = { kind: 'body', padding: layer.padding, minWidth: layer.minWidth, ...cornerFields(layer) }
    if (layer.fill) file.fill = fillJson(layer.fill)
    file.rings = layer.rings.map(fillJson)
    if (layer.of) file.of = layer.of
    if (layer.art) {
        const art = spriteIds.get(layer.art.texture)
        if (!art) issues.push({ path: `layers/${layer.id}.json#art.sprite`, message: 'the body picture is missing. Pick another picture under Body picture in the Inspector.' })
        else file.art = artJson(layer.art, art)
    }
    return file
}

export function fillOfJson(fill: any): FillData | null {
    if (!isRecord(fill)) return null
    if (fill.flag === true) return { kind: 'flag' }
    if (typeof fill.blend === 'string') return { kind: 'blend', slot: fill.blend }
    if (typeof fill.sweep === 'string') return { kind: 'sweep', slot: fill.sweep, axis: fill.axis === 'y' ? 'y' : 'x' }
    if (typeof fill.gradient === 'string') return { kind: 'gradient', slot: fill.gradient }
    const ref = typeof fill.color === 'string' ? fill.color : ''
    return parseSlotRef(ref) ? { kind: 'color', ref } : null
}

export interface PlanContext {
    keep(steps: PathStep[], value: unknown, label: string): void
    keepField(key: string, label?: string): void
    keepUnknown(known: Set<string>, extra?: string): void
    present(key: string): boolean
}

export function bodyProps(id: string, file: any, ctx: PlanContext): Record<string, unknown> {
    const fill = ctx.present('fill') ? fillOfJson(file.fill) : null
    if (ctx.present('fill') && !fill) ctx.keepField('fill', file.fill?.flag === true ? `Flag fill on ${id}` : `Fill on ${id}`)
    const rawRings: any[] = Array.isArray(file.rings) ? file.rings : []
    const rings = rawRings.map(fillOfJson)
    if (rings.some((ring) => !ring)) {
        const flagged = rawRings.some((ring) => isRecord(ring) && ring.flag === true)
        ctx.keep(['rings'], rawRings, flagged ? `Flag outline on ${id}` : `Outlines on ${id}`)
    }
    ctx.keepUnknown(BODY_KEYS)
    const art = ctx.present('art') ? artFromJson(file.art) : null
    if (ctx.present('art') && !art) ctx.keepField('art', `Body picture on ${id}`)
    if (ctx.present('of') && file.of !== NAME_MASK) ctx.keepField('of')
    return {
        padding: Array.isArray(file.padding) ? file.padding.map(Number) : [0, 0, 0, 0],
        minWidth: Number.isInteger(file.minWidth) ? file.minWidth : 0,
        ...cornerProps(file),
        fill: fill ?? { kind: 'none' },
        rings: rings.filter((ring): ring is FillData => !!ring),
        ...(art ? { art } : {}),
        ...(file.of === NAME_MASK ? { of: NAME_MASK } : {}),
    }
}

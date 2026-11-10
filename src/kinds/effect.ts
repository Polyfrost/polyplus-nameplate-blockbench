import { DEPTHS } from '../elements/read'
import { BODY_TYPE, BundleIssue, Depth } from '../model'
import type { MaterialImportContext, MaterialLayerPlan } from '../material/import'
import { EFFECT_TYPE, MaterialLayerData, MaterialsState } from '../material/types'
import { isRecord } from '../util/json'

export const EFFECT_KEYS = new Set(['kind', 'material', 'of', 'drift', 'mirror', 'mirrorDelay', 'mirrorSeed'])

export const FLAG_KEYS = ['drift', 'mirror', 'mirrorSeed'] as const

export function defineEffectProperties(target: any) {
    new Property(target, 'string', 'name', { default: 'effect' })
    new Property(target, 'boolean', 'visibility', { default: true })
    new Property(target, 'enum', 'depth', { default: 'background', values: DEPTHS })
    new Property(target, 'number', 'step', { default: 1 })
    new Property(target, 'string', 'material', { default: '' })
    new Property(target, 'string', 'of', { default: '' })
    new Property(target, 'boolean', 'drift', { default: false })
    new Property(target, 'boolean', 'mirror', { default: false })
    new Property(target, 'number', 'mirrorDelay', { default: 0 })
    new Property(target, 'boolean', 'mirrorSeed', { default: false })
}

export function wholeStep(value: unknown): number {
    const number = Math.round(Number(value))
    return isFinite(number) ? Math.max(1, number) : 1
}

export function delay(value: unknown): number {
    const number = Math.round(Number(value))
    return isFinite(number) ? Math.max(0, number) : 0
}

export function readEffect(node: any, id: string, ids: Map<string, string>, layers: any[]): MaterialLayerData | null {
    if (node?.type !== EFFECT_TYPE) return null
    const target = typeof node.of === 'string' && node.of ? layers.find((layer) => layer.uuid === node.of) : null
    return {
        kind: 'material',
        uuid: node.uuid,
        id,
        depth: DEPTHS.includes(node.depth) ? (node.depth as Depth) : 'background',
        step: wholeStep(node.step),
        material: typeof node.material === 'string' ? node.material : '',
        of: target && target.type === BODY_TYPE ? (ids.get(target.uuid) ?? null) : null,
        drift: node.drift === true,
        mirror: node.mirror === true,
        mirrorDelay: delay(node.mirrorDelay),
        mirrorSeed: node.mirrorSeed === true,
    }
}

export function effectJson(layer: MaterialLayerData, materials: MaterialsState | undefined, issues: BundleIssue[]): Record<string, unknown> {
    const path = `layers/${layer.id}.json#material`
    if (!layer.material) {
        issues.push({ path, message: 'this effect has no graph yet; pick one in the Inspector' })
    } else if (!materials?.graphs[layer.material]) {
        issues.push({ path, message: `graph '${layer.material}' is not in this project; pick another one in the Inspector` })
    }
    const file: Record<string, unknown> = { kind: 'material', material: layer.material }
    if (layer.of) file.of = layer.of
    if (layer.drift) file.drift = true
    if (layer.mirror) file.mirror = true
    if (layer.mirrorDelay && layer.mirrorDelay > 0) file.mirrorDelay = Math.round(layer.mirrorDelay)
    if (layer.mirrorSeed) file.mirrorSeed = true
    return file
}

export function effectProps(id: string, entry: any, file: any, context: MaterialImportContext): MaterialLayerPlan | null {
    if (!isRecord(file) || file.kind !== 'material') return null
    const props: Record<string, unknown> = {
        name: id,
        depth: typeof entry?.depth === 'string' ? entry.depth : 'background',
        step: Number.isInteger(entry?.step) ? entry.step : 1,
        material: typeof file.material === 'string' ? file.material : '',
    }
    for (const key of Object.keys(file)) {
        if (!EFFECT_KEYS.has(key)) context.keep([key], file[key], `layers/${id}.json: ${key}`)
    }
    for (const key of FLAG_KEYS) {
        if (file[key] === undefined) continue
        if (typeof file[key] === 'boolean') props[key] = file[key]
        else context.keep([key], file[key], `layers/${id}.json: ${key}`)
    }
    if (file.mirrorDelay !== undefined) {
        if (Number.isInteger(file.mirrorDelay) && file.mirrorDelay >= 0) props.mirrorDelay = file.mirrorDelay
        else context.keep(['mirrorDelay'], file.mirrorDelay, `layers/${id}.json: mirrorDelay`)
    }
    return {
        kind: 'material',
        id,
        of: typeof file.of === 'string' ? file.of : null,
        sprite: null,
        props,
    }
}

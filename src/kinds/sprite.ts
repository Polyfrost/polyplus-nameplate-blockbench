import { ANCHORS, DEPTHS } from '../elements/read'
import { Anchor, BODY_TYPE, BundleIssue, Depth, NAME_MASK, SpriteData } from '../model'
import { defineSpriteAdaptiveProperties } from '../motion/element'
import { readSpriteAdaptive } from '../motion/read'
import { spriteAdaptiveFields } from '../motion/compile'
import { spriteAdaptivePlan } from '../motion/import'
import { SPRITE_FOLLOWS } from '../motion/types'
import { atValue, isNameAnchor, takesAt } from '../art/layout'
import type { LayerPlan } from '../import/plan'
import { wholeOr, wholeOrAtLeast } from '../util/num'
import type { PlanContext } from './body'

export const SPRITE_LAYER_KEYS = new Set(['kind', 'sprite', 'of', 'anchor', 'at', 'pivot', 'offset', 'mirror', 'mirrorDelay', 'mirrorSeed', 'repeat', 'breakpoints', 'follow'])

export function defineSpriteProperties(target: any) {
    new Property(target, 'string', 'name', { default: 'sprite' })
    new Property(target, 'boolean', 'visibility', { default: true })
    new Property(target, 'enum', 'depth', { default: 'over_background', values: DEPTHS })
    new Property(target, 'number', 'step', { default: 1 })
    new Property(target, 'string', 'texture', { default: '' })
    new Property(target, 'string', 'of', { default: '' })
    new Property(target, 'enum', 'anchor', { default: 'top_left', values: [...ANCHORS, 'name_left', 'name_right'] })
    new Property(target, 'string', 'pivot', { default: '' })
    new Property(target, 'array', 'offset', { default: () => [0, 0] })
    new Property(target, 'boolean', 'mirror', { default: false })
    new Property(target, 'number', 'mirrorDelay', { default: 0 })
    new Property(target, 'boolean', 'mirrorSeed', { default: false })
    new Property(target, 'string', 'follow', { default: '' })
    defineSpriteAdaptiveProperties(target)
}

export function readSprite(node: any, base: { uuid: string, id: string, depth: Depth, step: number }, ctx: { ids: Map<string, string>, layers: any[] }): SpriteData {
    const target = typeof node.of === 'string' && node.of ? ctx.layers.find((layer) => layer.uuid === node.of) : null
    return {
        kind: 'sprite',
        ...base,
        texture: typeof node.texture === 'string' ? node.texture : '',
        of: node.of === NAME_MASK ? NAME_MASK : target && target.type === BODY_TYPE ? (ctx.ids.get(target.uuid) ?? null) : null,
        anchor: asAnchor(node.anchor) ?? 'top_left',
        pivot: asAnchor(node.pivot),
        offset: asPair(node.offset),
        mirror: !!node.mirror,
        mirrorDelay: wholeOrAtLeast(node.mirrorDelay, 0, 0),
        mirrorSeed: !!node.mirrorSeed,
        adaptive: readSpriteAdaptive(node),
        follow: SPRITE_FOLLOWS.includes(node.follow as any) ? node.follow : null,
    }
}

export function spriteJson(layer: SpriteData, spriteIds: Map<string, string>, issues: BundleIssue[]): Record<string, unknown> {
    const path = `layers/${layer.id}.json#texture`
    let sprite = ''
    if (!layer.texture) {
        issues.push({ path, message: 'sprite layer has no texture' })
    } else if (!spriteIds.has(layer.texture)) {
        issues.push({ path, message: `texture '${layer.texture}' has no sprite data` })
    } else {
        sprite = spriteIds.get(layer.texture)!
    }
    const file: Record<string, unknown> = { kind: 'sprite', sprite }
    if (layer.of && !isNameAnchor(layer.anchor)) file.of = layer.of
    file.anchor = layer.anchor
    const at = takesAt(layer.anchor) ? atValue(layer.at) : null
    if (at !== null) file.at = at
    if (layer.pivot) file.pivot = layer.pivot
    file.offset = layer.offset
    file.mirror = layer.mirror
    file.mirrorDelay = layer.mirrorDelay
    file.mirrorSeed = layer.mirrorSeed
    if (layer.follow) file.follow = layer.follow
    Object.assign(file, spriteAdaptiveFields(layer.id, layer.texture, layer.adaptive, spriteIds, issues))
    return file
}

export function spriteProps(id: string, file: any, ctx: PlanContext, base: { depth: string, step: number }): LayerPlan {
    const adaptive = spriteAdaptivePlan(file)
    ctx.keepUnknown(SPRITE_LAYER_KEYS, 'timeline')
    if (ctx.present('at') && !(takesAt(file.anchor) && atValue(file.at) !== null)) ctx.keepField('at')
    const follow = SPRITE_FOLLOWS.includes(file.follow) ? file.follow : null
    if (ctx.present('follow') && !follow) ctx.keepField('follow')
    return {
        kind: 'sprite',
        id,
        of: typeof file.of === 'string' ? file.of : null,
        sprite: typeof file.sprite === 'string' ? file.sprite : null,
        breakpointSprites: adaptive.breakpointSprites,
        timeline: file.timeline,
        props: {
            ...adaptive.props,
            name: id,
            depth: base.depth,
            step: base.step,
            anchor: typeof file.anchor === 'string' ? file.anchor : 'top_left',
            ...(takesAt(file.anchor) && atValue(file.at) !== null ? { at: atValue(file.at) } : {}),
            pivot: typeof file.pivot === 'string' ? file.pivot : '',
            offset: planPair(file.offset, [0, 0]),
            mirror: file.mirror === true,
            mirrorDelay: Number.isInteger(file.mirrorDelay) ? file.mirrorDelay : 0,
            mirrorSeed: file.mirrorSeed === true,
            ...(follow ? { follow } : {}),
        },
    }
}

export function asAnchor(value: unknown): Anchor | null {
    return ANCHORS.includes(value as Anchor) ? (value as Anchor) : null
}

export function asPair(value: unknown): [number, number] {
    const list = Array.isArray(value) ? value : []
    return [wholeOr(list[0], 0), wholeOr(list[1], 0)]
}

export function planPair(value: unknown, fallback: [number, number]): [number, number] {
    return Array.isArray(value) && value.length === 2 ? [Number(value[0]), Number(value[1])] : fallback
}

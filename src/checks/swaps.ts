import { isNameAnchor } from '../art/layout'
import { openVariantDialog } from '../design/nameplate'
import { layerNodes } from '../elements/nodes'
import type { Problem } from '../export/issues'
import { EFFECT_TYPE } from '../material/types'
import { BODY_TYPE, NameplateData, SPRITE_TYPE, VariantData } from '../model'
import { EMITTER_TYPE, PATH_TYPE } from '../motion/types'
import { readNameplate } from '../palette/state'
import { joinList } from '../util/text'
import { editVariantButton, nodeTarget } from './helpers'
import { styleOf } from '../text/style'
import { hasProject } from '../util/project'

const KINDS: Record<string, string> = {
    [SPRITE_TYPE]: 'sprite',
    [PATH_TYPE]: 'path',
    [EMITTER_TYPE]: 'emitter',
    [EFFECT_TYPE]: 'effect',
}

function shownIn(variant: VariantData, uuid: string): boolean {
    return !variant.hide.includes(uuid) && !(uuid in variant.swap)
}

function placedAgainst(node: any, body: string): boolean {
    return node.of === body && node.type in KINDS && !isNameAnchor(node.anchor)
}

function badgeSitsOn(plate: NameplateData, key: string, body: string): boolean {
    const badge = styleOf(plate, key).badge
    return badge.placement === 'placed' && !!badge.follow && badge.of === body
}

function swapText(key: string, from: string, to: string, layers: any[], badge: boolean): string {
    const names = layers.map((node) => `${KINDS[node.type]} '${String(node.name ?? '')}'`)
    if (badge) names.push('the badge')
    const fixes: string[] = []
    if (layers.length > 0) fixes.push(`swap ${layers.length === 1 ? 'that layer for a copy' : 'those layers for copies'} placed against '${to}'`)
    if (badge) fixes.push('set On the body for the badge in this variant')
    return `Variant '${key}' shows body '${to}' in place of '${from}', but ${joinList(names)} ${names.length === 1 ? 'stays' : 'stay'} against '${from}'. If the two bodies differ, ${fixes.join(' and ')}.`
}

export function swappedBodyProblems(): Problem[] {
    if (!hasProject()) return []
    const plate = readNameplate()
    const nodes = layerNodes()
    const problems: Problem[] = []
    for (const [key, variant] of Object.entries(plate.variants)) {
        for (const [from, to] of Object.entries(variant.swap)) {
            const body = nodes.find((node) => node.uuid === from)
            if (body?.type !== BODY_TYPE) continue
            const layers = nodes.filter((node) => placedAgainst(node, from) && shownIn(variant, node.uuid))
            const badge = badgeSitsOn(plate, key, from)
            if (layers.length === 0 && !badge) continue
            const target = nodes.find((node) => node.uuid === to)
            problems.push({
                level: 'warning',
                text: swapText(key, String(body.name ?? ''), String(target?.name ?? to), layers, badge),
                target: nodeTarget(layers[0]),
                buttons: [editVariantButton(() => openVariantDialog(key))],
            })
        }
    }
    return problems
}

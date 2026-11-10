import { ART_PROPERTY, readArt } from '../art/layout'
import { nodeTarget } from '../checks/helpers'
import { findNode, layerNodes } from '../elements/nodes'
import type { Problem } from '../export/issues'
import { readMaterials } from '../material/state'
import { EFFECT_TYPE } from '../material/types'
import { BODY_TYPE } from '../model'
import { hasProject } from '../util/project'

export function bodyShapeProblems(): Problem[] {
    if (!hasProject()) return []
    const graphs = readMaterials().graphs
    const edges: Problem[] = []
    const clips: Problem[] = []
    for (const node of layerNodes()) {
        const target = nodeTarget(node)
        const name = String(node.name ?? '')
        if (node.type === EFFECT_TYPE) {
            const graph = typeof node.material === 'string' ? graphs[node.material] : undefined
            if (!graph?.nodes?.some((entry) => entry?.type === 'BodyEdge')) continue
            const body = typeof node.of === 'string' && node.of ? findNode(node.of) : null
            if (body?.type !== BODY_TYPE) {
                edges.push({ level: 'warning', text: `Effect '${name}' measures the distance to a body edge, but it covers no body, so it measures a plain rectangle. To go around rounded corners, pick a body under Covers in the Inspector.`, target })
            } else if (readArt(body[ART_PROPERTY])) {
                edges.push({ level: 'warning', text: `Effect '${name}' measures to a body drawn from a picture, so it uses a plain rectangle. To go around corners, use a body with no picture.`, target })
            }
        }
        if (node.clip === 'fill') {
            const body = typeof node.mask === 'string' && node.mask ? findNode(node.mask) : null
            if (body?.type !== BODY_TYPE || (!!body.fill && body.fill.kind !== 'none') || readArt(body[ART_PROPERTY])) continue
            clips.push({ level: 'warning', text: `Layer '${name}' leaves the outlines of body '${String(body.name ?? '')}' alone, but that body has no fill, so nothing is left to show the layer through and it stays hidden. Give the body a fill, or turn off Leave its outlines alone.`, target })
        }
    }
    return [...edges, ...clips]
}

import { layerNodes } from '../elements/nodes'
import { issueName, issueValue } from '../checks/codes'
import { EngineIssue, materialLimits } from '../engine'
import { specOf } from '../nodes/catalog'
import { paramLabel } from './params'
import { readMaterials } from './state'
import { slugTextureId, segmentMaterialId } from '../util/bundlePath'
import { EFFECT_TYPE, textureIdsOf } from './types'

export interface MaterialProblem {
    text: string
    target: { kind: 'layer', uuid: string } | null
}

function sentence(text: string): string {
    const trimmed = text.trim()
    return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function codedText(issue: EngineIssue, material: string): string | null {
    const values = issue.values ?? {}
    switch (issue.code) {
        case 'material_cost': {
            const factor = issueValue(issue, 'factor') ?? (readMaterials().graphs[material]?.outline ? materialLimits()?.outlineFactor ?? 5 : 1)
            return `is too heavy: ${values.ops} of ${values.limit}. Remove nodes, use fewer detail layers${factor > 1 ? ', or turn off the outline' : ''}`
        }
        case 'material_nodes':
            return `has ${values.nodes} nodes; the limit is ${values.limit}. Remove some in Edit graph...`
        case 'material_samples':
            return `reads textures ${values.samples} times per pixel; the limit is ${values.limit}. Use fewer texture nodes`
        case 'material_inputs':
            return `reads ${values.inputs} sliders and formulas; the limit is ${values.limit}. Remove some in Edit graph...`
        case 'material_loop':
            return `jumps when the loop restarts: its movement doesn't fit the ${values.cycle}-frame loop. Make speeds a whole number of repeats per loop, or set Tiles every on its noise`
        case 'material_outputs':
            return `needs exactly one Output node, but has ${issueValue(issue, 'count') ?? 0}. Open Edit graph... and keep one`
        case 'material_cycle':
            return 'feeds back into itself. Remove one of the links in Edit graph...'
        case 'node_param':
            return `reads setting '${paramLabel(issueName(issue, 'param') ?? '')}', which this nameplate doesn't have. Open Edit graph... and pick another, or add the Slider node again`
        case 'material_margins':
            return `Reach must be 0 to ${issueValue(issue, 'limit') ?? 0} px on each side`
        case 'node_type':
            return `uses an unknown node type '${issueName(issue, 'type') ?? ''}'. Replace it in Edit graph...`
        case 'node_texture':
            return `needs the texture ${issueName(issue, 'texture') ?? ''}.png, which is missing or unusable. Import the zip again with its textures folder`
        case 'over_states':
            return `shows ${issueValue(issue, 'frames') ?? 0} different frames; at most ${issueValue(issue, 'limit') ?? 0}. Raise 'Hold each frame for'`
        default:
            return null
    }
}

function placeOf(field: string, material: string): string {
    if (!field) return ''
    const node = /^nodes\.([^.]+)(?:\.(in|set))?(?:\.(.+))?$/.exec(field)
    if (node) {
        const entry = readMaterials().graphs[material]?.nodes.find((candidate) => candidate.id === node[1])
        const spec = entry ? specOf(String(entry.type)) : null
        const name = spec?.label ?? node[1]
        const detail = node[2] === 'in'
            ? spec?.sockets.find((socket) => socket.name === node[3])?.label
            : node[2] === 'set'
                ? spec?.settings.find((setting) => setting.key === node[3])?.label
                : undefined
        return ` (${name}${detail ? `, ${detail}` : ''})`
    }
    if (field === 'nodes') return ' (graph)'
    const named: Record<string, string> = { resolution: 'resolution', outline: 'outline', emissive: 'glows in the dark' }
    if (named[field]) return ` (${named[field]})`
    if (field.startsWith('toneHint')) return ' (brightness hint)'
    return ''
}

function owner(material: string): { name: string, target: MaterialProblem['target'] } {
    const users = layerNodes().filter((node) => node.type === EFFECT_TYPE && node.material === material)
    if (users.length === 0) return { name: `Graph '${material}'`, target: null }
    const names = users.map((node) => `'${node.name}'`).join(', ')
    return { name: `Effect ${names} (graph '${material}')`, target: { kind: 'layer', uuid: String(users[0].uuid) } }
}

function textureOwner(texture: string): string | null {
    const state = readMaterials()
    for (const [id, graph] of Object.entries(state.graphs)) if (textureIdsOf(graph).includes(texture)) return id
    return null
}

export function materialProblem(issue: EngineIssue): MaterialProblem | null {
    const path = issue.path
    const message = issue.message
    const at = path.indexOf('#')
    const file = at < 0 ? path : path.slice(0, at)
    const field = at < 0 ? '' : path.slice(at + 1)
    const material = segmentMaterialId(file)
    if (material !== null) {
        const who = owner(material)
        const coded = codedText(issue, material)
        const text = !field && issue.code === 'missing_file' ? 'has no graph in this project. Pick another graph in the Inspector.' : sentence(coded ?? message)
        return { text: `${who.name}${placeOf(field, material)}: ${text}`, target: who.target }
    }
    const texture = slugTextureId(file)
    if (texture !== null && !field) {
        const used = textureOwner(texture)
        if (!used) return null
        const who = owner(used)
        const text = issue.code === 'missing_file'
            ? `needs the texture ${texture}.png, which is not in this project. Import the zip again with its textures folder.`
            : issue.code === 'texture_format'
                ? `uses ${texture}.png, which is not a PNG file.`
                : issue.code === 'texture_size'
                    ? `uses ${texture}.png, which is ${issueValue(issue, 'width') ?? 0} x ${issueValue(issue, 'height') ?? 0} px. Each side must be 1, 2, 4, 8, 16, 32, 64, 128 or 256 px.`
                    : `uses ${texture}.png: ${sentence(message)}`
        return { text: `${who.name}: ${text}`, target: who.target }
    }
    return null
}

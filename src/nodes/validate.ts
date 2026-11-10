import * as EngineModule from '../../engine/PolyPlus-nameplate-engine.js'
import { issueName, issueValue } from '../checks/codes'
import { describe, ENGINE_CAPABILITIES, EngineIssue, materialLimits, wrapIssue } from '../engine'
import { slugSpriteId, slugTextureId } from '../util/bundlePath'
import { specOf } from './catalog'
import { MaterialContext } from './context'
import { MaterialJson, nodeSettings, nodesOf } from './graph'
import { analyze, Analysis, MAX_SAMPLES } from './typing'
import { costLimit, nodeWeigher, outlineFactor } from './weights'

const api = EngineModule.org.polyfrost.polyplus.nameplate.engine.js

const MATERIAL_ID = 'edited'
const MATERIAL_PATH = `materials/${MATERIAL_ID}.json`
const LAYER_ID = 'effect'

type Severity = 'error' | 'hint'

export interface Problem {
    node: string | null
    field: string | null
    message: string
    severity: Severity
}

export interface Validation {
    problems: Problem[]
    cost: number
    costSource: 'engine' | 'estimate'
    samples: number
    nodes: number
    analysis: Analysis
    engine: boolean
}

function capitalize(text: string): string {
    return text ? text[0].toUpperCase() + text.slice(1) : text
}

export function bundleFiles(graph: MaterialJson, context: MaterialContext): Record<string, string> {
    const params: Record<string, number> = { ...context.params }
    for (const node of nodesOf(graph)) {
        if (node.type !== 'Param') continue
        const name = nodeSettings(node).name
        if (typeof name === 'string' && name && !(name in params)) params[name] = 0
    }
    const requires = ['canvas', 'materials']
    const manifest: Record<string, unknown> = {
        format: 1,
        id: 'material_editor',
        requires,
        fps: context.fps,
        loop: context.loop,
        layers: [{ id: LAYER_ID, depth: 'background' }],
    }
    if (Object.keys(params).length > 0) manifest.params = params
    const files: Record<string, string> = {
        'manifest.json': JSON.stringify(manifest),
        'palettes.json': JSON.stringify({ slots: context.slots.map((slot) => ({ id: slot.id, name: slot.name ?? slot.id, ramp: slot.ramp })) }),
        [`layers/${LAYER_ID}.json`]: JSON.stringify({ kind: 'material', material: MATERIAL_ID }),
        [MATERIAL_PATH]: JSON.stringify(graph),
    }
    for (const [id, text] of Object.entries(context.sprites)) files[`sprites/${id}.json`] = text
    return files
}

export function usedTextures(graph: MaterialJson): string[] {
    const ids: string[] = []
    for (const node of nodesOf(graph)) {
        if (node.type !== 'BundleTexture') continue
        const id = nodeSettings(node).texture
        if (typeof id === 'string' && !ids.includes(id)) ids.push(id)
    }
    return ids
}

function binaries(graph: MaterialJson, context: MaterialContext): EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateBinary[] {
    const result: EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateBinary[] = []
    for (const id of usedTextures(graph)) {
        const bytes = context.textures[id]?.png?.()
        if (bytes) result.push(new api.NameplateBinary(`textures/${id}.png`, bytes))
    }
    return result
}

function engineIssues(graph: MaterialJson, context: MaterialContext): { issues: EngineIssue[], cost: number | null } {
    const files = Object.entries(bundleFiles(graph, context)).map(([path, text]) => new api.NameplateFile(path, text))
    const assets = binaries(graph, context)
    const load = api.nameplateLoad(files, ENGINE_CAPABILITIES, assets)
    const issues: EngineIssue[] = Array.from(load.issues).map(wrapIssue)
    if (load.skipped) issues.push({ path: '', message: `The game would skip this effect: ${load.skipped}` })
    let cost: number | null = null
    if (load.preview) {
        try {
            for (const entry of Array.from(api.nameplateMaterialCosts(load.preview))) {
                if (entry.id === MATERIAL_ID) cost = entry.cost
            }
        } catch {
            cost = null
        }
    }
    return { issues, cost }
}

function settingLabel(type: string, key: string): string {
    const setting = specOf(type)?.settings.find((entry) => entry.key === key)
    return setting ? setting.label : key === 'source' ? 'Source' : key
}

function socketLabel(type: string, name: string): string {
    return specOf(type)?.sockets.find((entry) => entry.name === name)?.label ?? name
}

function plainNodeMessage(type: string, field: string | null, issue: EngineIssue): string {
    const message = issue.message
    const [part, key] = (field ?? '').split('.') as ['in' | 'set' | 'type' | '', string]
    if (issue.code === 'material_cycle') return 'This node is part of a loop and ends up feeding itself. Remove one of the links in the loop.'
    if (issue.code === 'node_type') return `Unknown node type '${type || (issueName(issue, 'type') ?? '')}'. Delete it, or update the plugin.`
    if (issue.code === 'node_duplicate') return 'Two nodes share this id. Delete one of them.'
    if (issue.code === 'node_output_link' && part !== 'set') return 'The Output can\'t feed another node. Remove that link.'
    if (!field) return capitalize(message)
    if (part === 'in') {
        const label = socketLabel(type, key)
        if (issue.code === 'node_required') return `${label} needs a link or a value.`
        if (issue.code === 'node_link') return `${label} links to a node that no longer exists.`
        if (issue.code === 'node_input') return `${label} is not an input of this node. Remove it.`
        return `${label}: ${message}`
    }
    if (part === 'set') {
        const label = settingLabel(type, key)
        if (issue.code === 'node_required') return key === 'source' ? 'Link the node to sample into Source.' : `Set ${label}.`
        if (issue.code === 'node_setting') return `${label} is not a setting of this node.`
        return `${label} ${message}`
    }
    return capitalize(message)
}

function outlineFactorOf(graph: MaterialJson, issue: EngineIssue): number {
    const factor = issueValue(issue, 'factor')
    if (factor !== null) return factor
    return typeof graph.outline === 'string' ? materialLimits()?.outlineFactor ?? outlineFactor() : 1
}

function plainGraphMessage(graph: MaterialJson, field: string, issue: EngineIssue): string {
    const message = issue.message
    const values = issue.values ?? {}
    if (issue.code === 'material_cost') {
        const factor = outlineFactorOf(graph, issue)
        const outline = factor > 1 ? ` The outline runs the graph ${factor} times.` : ''
        return `Too heavy: about ${values.ops} operations per pixel, the limit is ${values.limit}.${outline} Use fewer nodes, fewer detail layers or a smaller Repeat count.`
    }
    if (issue.code === 'material_samples') return `Reads textures ${values.samples} times per pixel, the limit is ${values.limit}. Use fewer texture nodes, or move them out of Repeat.`
    if (issue.code === 'material_nodes') return `Too many nodes: ${values.nodes}, the limit is ${values.limit}.`
    if (issue.code === 'material_inputs') return `Reads ${values.inputs} sliders and formulas, the limit is ${values.limit}. Remove some Slider or Formula value nodes.`
    if (issue.code === 'material_outputs') {
        return issueValue(issue, 'count') === 0 ? 'Add an Output node and link a color into it.' : 'There is more than one Output node. Delete the extra ones.'
    }
    if (field === 'margins') return `Reach ${message}.`
    if (field === 'resolution') return `Resolution ${message}.`
    if (field === 'outline') return `Outline color ${message}.`
    if (field.startsWith('toneHint')) return `Brightness hint ${message}.`
    return capitalize(message)
}

function nodesWith(graph: MaterialJson, type: string, key: string, value: string): string[] {
    return nodesOf(graph)
        .filter((node) => node.type === type && nodeSettings(node)[key] === value)
        .map((node) => node.id)
}

function mapIssue(graph: MaterialJson, issue: EngineIssue, files: Set<string>): Problem[] {
    const [file, at = ''] = issue.path.split('#')
    if (file === MATERIAL_PATH) {
        const match = /^nodes\.([^.]+)(?:\.(in|set|type)(?:\.(.+))?)?$/.exec(at)
        if (match) {
            const id = match[1]
            const node = nodesOf(graph).find((entry) => entry.id === id)
            const field = match[2] ? (match[3] ? `${match[2]}.${match[3]}` : match[2]) : null
            const texture = issue.code === 'node_texture' ? issueName(issue, 'path') : null
            const sprite = issue.code === 'node_sprite' ? issueName(issue, 'sprite') : null
            if ((texture !== null && files.has(texture)) || (sprite !== null && files.has(`sprites/${sprite}.json`))) return []
            const type = node ? String(node.type) : ''
            return [{ node: node ? id : null, field, message: plainNodeMessage(type, field, issue), severity: 'error' }]
        }
        return [{ node: null, field: at || null, message: plainGraphMessage(graph, at, issue), severity: 'error' }]
    }
    const onNodes = (type: string, key: string, value: string, message: string): Problem[] => {
        const ids = value ? nodesWith(graph, type, key, value) : []
        const field = `set.${key}`
        return ids.length ? ids.map((id) => ({ node: id, field, message, severity: 'error' as Severity })) : [{ node: null, field: null, message, severity: 'error' }]
    }
    const texture = slugTextureId(file)
    if (texture !== null) {
        const message = issue.code === 'missing_file'
            ? `There is no texture called '${texture}'.`
            : `Texture '${texture}' ${issue.message}.`
        return onNodes('BundleTexture', 'texture', texture, message)
    }
    const sprite = slugSpriteId(file)
    if (sprite !== null) {
        const message = issue.code === 'missing_file' ? `There is no sprite called '${sprite}'.` : `Sprite '${sprite}': ${issue.message}`
        return onNodes('Sprite', 'sprite', sprite, message)
    }
    if (file === 'manifest.json' && at.startsWith('params')) {
        const name = at.slice('params'.length).replace(/^\./, '')
        return onNodes('Param', 'name', name, `Slider ${name ? `'${name}' ` : ''}${issue.message}`)
    }
    if (file === 'palettes.json') return [{ node: null, field: null, message: `The nameplate palette has a problem: ${issue.message}`, severity: 'error' }]
    return [{ node: null, field: null, message: capitalize(issue.message), severity: 'error' }]
}

export function validateMaterial(graph: MaterialJson, context: MaterialContext): Validation {
    const analysis = analyze(graph, nodeWeigher(), outlineFactor())
    let issues: EngineIssue[]
    let engineCost: number | null = null
    let engine = true
    try {
        const result = engineIssues(graph, context)
        issues = result.issues
        const ops = issues.find((issue) => issue.code === 'material_cost')?.values?.ops
        engineCost = result.cost ?? (typeof ops === 'number' ? ops : null)
    } catch (error) {
        engine = false
        issues = [{ path: '', message: `This effect couldn't be checked: ${describe(error)}` }]
    }
    const files = new Set(issues.map((issue) => issue.path.split('#')[0]))
    const problems: Problem[] = []
    const seen = new Set<string>()
    for (const issue of issues) {
        for (const problem of mapIssue(graph, issue, files)) {
            const key = `${problem.node}|${problem.message}`
            if (seen.has(key)) continue
            seen.add(key)
            problems.push(problem)
        }
    }
    const typed = new Map([...analysis.errors].map(([node, message]): [string, Problem] => [node, { node, field: null, message: capitalize(message), severity: 'error' }]))
    for (const problem of problems) {
        if (problem.node && problem.field === null && typed.has(problem.node)) {
            problem.message = (typed.get(problem.node) as Problem).message
        }
    }
    const flagged = new Set(problems.map((problem) => problem.node))
    for (const [node, problem] of typed) if (!flagged.has(node)) problems.push(problem)
    for (const node of nodesOf(graph)) {
        if (specOf(String(node.type)) && analysis.output && !analysis.reachable.has(node.id) && node.type !== 'Output') {
            problems.push({ node: node.id, field: null, message: 'Not used yet: link it toward the Output.', severity: 'hint' })
        }
    }
    return {
        problems,
        cost: engineCost ?? analysis.cost,
        costSource: engineCost !== null ? 'engine' : 'estimate',
        samples: analysis.samples,
        nodes: analysis.count,
        analysis,
        engine,
    }
}

export function limits(): { cost: number, samples: number } {
    const engine = materialLimits()
    return { cost: engine?.maxCost ?? costLimit(), samples: engine?.maxSamples ?? MAX_SAMPLES }
}

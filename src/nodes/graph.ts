import { cloneJson, isRecord } from '../util/json'
import { SOURCE_SOCKET, specOf } from './catalog'

export interface NodeJson {
    id: string
    type: string
    in?: Record<string, unknown>
    set?: Record<string, unknown>
    [key: string]: unknown
}

export interface MaterialJson {
    resolution?: string
    margins?: number[]
    outline?: string
    emissive?: boolean
    toneHint?: string[]
    nodes?: NodeJson[]
    [key: string]: unknown
}

export interface Link {
    source: string
    target: string
    socket: string
}

type Literal = number | number[]

export function readGraph(value: unknown): MaterialJson {
    if (typeof value === 'string') {
        try {
            return readGraph(JSON.parse(value))
        } catch {
            return { nodes: [] }
        }
    }
    return isRecord(value) ? cloneJson(value) as MaterialJson : { nodes: [] }
}

export function nodesOf(graph: MaterialJson): NodeJson[] {
    return Array.isArray(graph.nodes) ? graph.nodes.filter((node): node is NodeJson => isRecord(node)) : []
}

export function uniqueNodes(graph: MaterialJson): NodeJson[] {
    const seen = new Set<string>()
    const result: NodeJson[] = []
    for (const node of nodesOf(graph)) {
        if (typeof node.id !== 'string' || seen.has(node.id)) continue
        seen.add(node.id)
        result.push(node)
    }
    return result
}

export function findNode(graph: MaterialJson, id: string): NodeJson | null {
    return nodesOf(graph).find((node) => node.id === id) ?? null
}

export function nodeInputs(node: NodeJson): Record<string, unknown> {
    return isRecord(node.in) ? node.in : {}
}

export function nodeSettings(node: NodeJson): Record<string, unknown> {
    return isRecord(node.set) ? node.set : {}
}

export function sourceOf(node: NodeJson): string | null {
    const source = nodeSettings(node).source
    return typeof source === 'string' ? source : null
}

export function readLiteral(value: unknown): Literal | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
        return value.slice() as number[]
    }
    return null
}

export function links(graph: MaterialJson): Link[] {
    const nodes = nodesOf(graph)
    const ids = new Set(nodes.map((node) => node.id))
    const result: Link[] = []
    for (const node of nodes) {
        for (const [socket, value] of Object.entries(nodeInputs(node))) {
            if (typeof value === 'string' && ids.has(value)) result.push({ source: value, target: node.id, socket })
        }
        const source = sourceOf(node)
        if (source !== null && ids.has(source)) result.push({ source, target: node.id, socket: SOURCE_SOCKET })
    }
    return result
}

export function linkKey(link: Link): string {
    return `${link.source}>${link.target}.${link.socket}`
}

function freeId(graph: MaterialJson, type: string): string {
    const taken = new Set(nodesOf(graph).map((node) => node.id))
    const base = type.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 56) || 'node'
    if (!taken.has(base)) return base
    for (let i = 2; ; i++) {
        const id = `${base}_${i}`
        if (!taken.has(id)) return id
    }
}

function ensureNodes(graph: MaterialJson): NodeJson[] {
    if (!Array.isArray(graph.nodes)) graph.nodes = []
    return graph.nodes
}

export function addNode(graph: MaterialJson, type: string, settings?: Record<string, unknown>): string {
    const id = freeId(graph, type)
    const node: NodeJson = { id, type }
    if (settings && Object.keys(settings).length > 0) node.set = cloneJson(settings)
    ensureNodes(graph).push(node)
    return id
}

export function duplicateNode(graph: MaterialJson, id: string): string | null {
    const node = findNode(graph, id)
    if (!node) return null
    const copy = cloneJson(node)
    copy.id = freeId(graph, node.type)
    ensureNodes(graph).push(copy)
    return copy.id
}

function dropEmpty(node: NodeJson, key: 'in' | 'set') {
    const value = node[key]
    if (isRecord(value) && Object.keys(value).length === 0) delete node[key]
}

export function removeNodes(graph: MaterialJson, ids: string[]) {
    if (!Array.isArray(graph.nodes)) return
    const gone = new Set(ids)
    graph.nodes = graph.nodes.filter((node) => !isRecord(node) || !gone.has(node.id))
    for (const node of nodesOf(graph)) {
        const inputs = node.in
        if (isRecord(inputs)) {
            for (const key of Object.keys(inputs)) {
                if (typeof inputs[key] === 'string' && gone.has(inputs[key] as string)) delete inputs[key]
            }
            dropEmpty(node, 'in')
        }
        const source = sourceOf(node)
        if (source !== null && gone.has(source)) {
            delete (node.set as Record<string, unknown>).source
            dropEmpty(node, 'set')
        }
    }
}

export function setInput(graph: MaterialJson, id: string, socket: string, value: string | Literal | undefined) {
    const node = findNode(graph, id)
    if (!node) return
    if (socket === SOURCE_SOCKET) {
        setSetting(graph, id, 'source', typeof value === 'string' ? value : undefined)
        return
    }
    if (value === undefined) {
        if (isRecord(node.in)) {
            delete node.in[socket]
            dropEmpty(node, 'in')
        }
        return
    }
    if (!isRecord(node.in)) node.in = {}
    node.in[socket] = cloneJson(value)
}

export function setSetting(graph: MaterialJson, id: string, key: string, value: unknown) {
    const node = findNode(graph, id)
    if (!node) return
    if (value === undefined) {
        if (isRecord(node.set)) {
            delete node.set[key]
            dropEmpty(node, 'set')
        }
        return
    }
    if (!isRecord(node.set)) node.set = {}
    node.set[key] = cloneJson(value)
}

export function setMaterial(graph: MaterialJson, key: string, value: unknown) {
    if (value === undefined) delete graph[key]
    else graph[key] = cloneJson(value)
}

export function setLinks(graph: MaterialJson, wanted: Link[]) {
    const current = new Map(links(graph).map((link) => [`${link.target}.${link.socket}`, link]))
    const next = new Map(wanted.map((link) => [`${link.target}.${link.socket}`, link]))
    for (const [key, link] of current) {
        if (!next.has(key)) setInput(graph, link.target, link.socket, undefined)
    }
    for (const [key, link] of next) {
        if (current.get(key)?.source !== link.source) setInput(graph, link.target, link.socket, link.source)
    }
}

export function canAdd(graph: MaterialJson, type: string): boolean {
    const spec = specOf(type)
    return !!spec && !(spec.single && nodesOf(graph).some((node) => node.type === type))
}

export function materialParams(graph: unknown): string[] {
    const names: string[] = []
    for (const node of nodesOf(readGraph(graph))) {
        if (node.type !== 'Param') continue
        const name = nodeSettings(node).name
        if (typeof name === 'string' && name && !names.includes(name)) names.push(name)
    }
    return names
}

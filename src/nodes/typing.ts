import { Accepts, ACCEPTS_LABEL, NodeSpec, SocketSpec, SocketType, SOURCE_SOCKET, specOf, TYPE_LABEL } from './catalog'
import { cloneJson } from '../util/json'
import { MaterialJson, NodeJson, nodeInputs, nodesOf, nodeSettings, readLiteral, sourceOf } from './graph'

export const MAX_NODES = 64
export const MAX_COST = 2000
export const MAX_SAMPLES = 4
export const OUTLINE_FACTOR = 5

const WIDTH: Record<SocketType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4, slot: 1 }
const VECTORS: SocketType[] = ['float', 'vec2', 'vec3', 'vec4']
const COMPONENTS = ['x', 'y', 'z', 'w']
const REDUCE = ['sum', 'min', 'max', 'first']

export function vector(width: number): SocketType {
    return VECTORS[Math.max(1, Math.min(4, width)) - 1]
}

export function target(accepts: Accepts, source: SocketType): SocketType | null {
    switch (accepts) {
        case 'float':
            return source === 'float' ? source : null
        case 'vec2':
            return source === 'float' || source === 'vec2' ? 'vec2' : null
        case 'color':
            return source === 'vec4' || source === 'slot' ? 'vec4' : null
        case 'surface':
            return source === 'vec4' || source === 'slot' ? source : null
        case 'number':
            return source === 'slot' ? 'vec4' : source
        case 'any':
            return source
    }
}

type Typing = { ok: true, output: SocketType, targets: Array<SocketType | null> } | { ok: false, message: string }

function mismatchMessage(socket: SocketSpec, source: SocketType | null): string {
    return `${socket.label} takes ${ACCEPTS_LABEL[socket.accepts]}, not a ${source ? TYPE_LABEL[source] : 'nothing'}`
}

function mismatch(socket: SocketSpec, source: SocketType | null): Typing {
    return { ok: false, message: mismatchMessage(socket, source) }
}

function fixed(sockets: SocketSpec[], inputs: Array<SocketType | null>, output: SocketType): Typing {
    for (let i = 0; i < inputs.length; i++) {
        const source = inputs[i]
        if (source && target(sockets[i].accepts, source) === null) return mismatch(sockets[i], source)
    }
    return { ok: true, output, targets: inputs.map((source, i) => (source ? target(sockets[i].accepts, source) : null)) }
}

function elementwise(sockets: SocketSpec[], inputs: Array<SocketType | null>): Typing {
    const widths = inputs.map((source) => (source ? WIDTH[target('number', source) as SocketType] : null))
    const width = Math.max(...widths.map((w) => w ?? 1), 1)
    const output = vector(width)
    const bad = widths.findIndex((w) => w !== null && w !== 1 && w !== width)
    if (bad >= 0) {
        return { ok: false, message: `${sockets[bad].label} is a ${TYPE_LABEL[inputs[bad] as SocketType]}, but the other inputs are ${TYPE_LABEL[output]}s` }
    }
    return { ok: true, output, targets: inputs.map((source) => (source ? output : null)) }
}

interface Input {
    node: Item | null
    literal: number[] | null
    target: SocketType | null
}

interface Item {
    id: string
    spec: NodeSpec
    set: Record<string, unknown>
    inputs: Input[]
    source: Item | null
    type: SocketType
    typed: boolean
    error: string | null
}

function sourceType(input: Input): SocketType | null {
    if (input.node) return input.node.type
    return input.literal ? vector(input.literal.length) : null
}

function intSetting(set: Record<string, unknown>, key: string, min: number, max: number, fallback: number): number {
    const value = set[key]
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function choiceSetting(set: Record<string, unknown>, key: string, options: string[], fallback: number): number {
    const index = typeof set[key] === 'string' ? options.indexOf(set[key] as string) : -1
    return index < 0 ? fallback : index
}

function typing(item: Item): Typing {
    const spec = item.spec
    const inputs = item.inputs.map(sourceType)
    const rule = spec.typing
    switch (rule.kind) {
        case 'constant':
            return { ok: true, output: rule.output, targets: [] }
        case 'values': {
            const value = readLiteral(item.set.value)
            const width = value === null ? 1 : Array.isArray(value) ? value.length : 1
            return { ok: true, output: vector(width), targets: [] }
        }
        case 'fixed':
            return fixed(spec.sockets, inputs, rule.output)
        case 'elementwise':
            return elementwise(spec.sockets, inputs)
        case 'reduce': {
            const result = elementwise(spec.sockets, inputs)
            return result.ok ? { ok: true, output: 'float', targets: result.targets } : result
        }
        case 'combine': {
            const gap = inputs.findIndex((source) => source === null)
            const width = gap < 0 ? inputs.length : gap
            if (inputs.slice(width).some((source) => source !== null)) return { ok: false, message: 'W needs Z' }
            return fixed(spec.sockets, inputs, vector(width))
        }
        case 'component': {
            const result = elementwise(spec.sockets, inputs)
            if (!result.ok) return result
            const index = choiceSetting(item.set, 'component', COMPONENTS, 0)
            if (index >= WIDTH[result.output]) return { ok: false, message: `a ${TYPE_LABEL[result.output]} has no ${COMPONENTS[index]}` }
            return { ok: true, output: 'float', targets: result.targets }
        }
        case 'select': {
            const [condition, a, b] = inputs
            let unified: SocketType | null = null
            if (a && b) {
                if (a === b) unified = a
                else if (a === 'float' && b !== 'slot') unified = b
                else if (b === 'float' && a !== 'slot') unified = a
                else if ((a === 'slot' && b === 'vec4') || (a === 'vec4' && b === 'slot')) unified = 'vec4'
            }
            if (condition !== 'float') return mismatch(spec.sockets[0], condition)
            if (!unified) return { ok: false, message: `If not is a ${a ? TYPE_LABEL[a] : 'nothing'} and If above 0 is a ${b ? TYPE_LABEL[b] : 'nothing'}; they don't mix` }
            return { ok: true, output: unified, targets: ['float', unified, unified] }
        }
        case 'sample': {
            if (!item.source) return { ok: false, message: 'needs a source' }
            return fixed(spec.sockets, inputs, item.source.type)
        }
        case 'repeat': {
            if (!item.source) return { ok: false, message: 'needs a source' }
            const reduce = choiceSetting(item.set, 'reduce', REDUCE, 2)
            if (item.source.type === 'slot' && REDUCE[reduce] !== 'first') return { ok: false, message: 'palette colors only combine by First visible' }
            return { ok: true, output: item.source.type, targets: [] }
        }
    }
}

export type Weigher = (type: string, variant: number) => number

function costVariant(rule: NodeSpec['cost'], type: SocketType, input: SocketType | null, set: Record<string, unknown>): number {
    switch (rule) {
        case 'flat':
            return 0
        case 'width':
            return WIDTH[type]
        case 'inputs':
            return input ? WIDTH[input] : 1
        case 'octaves':
            return intSetting(set, 'octaves', 1, 8, 3)
    }
}

export const TONE_COST = '~tone'

function readsTone(input: Input): boolean {
    return input.node?.type === 'slot' && input.target === 'vec4'
}

function ownCost(item: Item, weigh: Weigher): number {
    const own = weigh(item.spec.type, costVariant(item.spec.cost, item.type, item.inputs[0]?.target ?? null, item.set))
    const tones = item.inputs.filter(readsTone).length
    return own + (tones ? tones * weigh(TONE_COST, 0) : 0)
}

export interface Analysis {
    types: Map<string, SocketType>
    errors: Map<string, string>
    reachable: Set<string>
    output: string | null
    cycle: boolean
    cost: number
    samples: number
    outline: boolean
    count: number
}

export function analyze(graph: MaterialJson, weigh: Weigher | null = null, outlineFactor = OUTLINE_FACTOR): Analysis {
    const json = nodesOf(graph)
    const items = new Map<string, Item>()
    const synthetic: Item[] = []
    for (const node of json) {
        const spec = specOf(String(node.type))
        if (!spec || typeof node.id !== 'string' || items.has(node.id)) continue
        items.set(node.id, { id: node.id, spec, set: nodeSettings(node), inputs: [], source: null, type: 'float', typed: false, error: null })
    }
    for (const node of json) {
        const item = items.get(node.id)
        if (!item || item.inputs.length > 0) continue
        const values = nodeInputs(node)
        item.inputs = item.spec.sockets.map((socket) => {
            const value = values[socket.name]
            if (typeof value === 'string') {
                const ref = items.get(value)
                return { node: ref && ref.spec.type !== 'Output' ? ref : null, literal: null, target: null }
            }
            if (value !== undefined) {
                const literal = readLiteral(value)
                return { node: null, literal: literal === null ? null : Array.isArray(literal) ? literal : [literal], target: null }
            }
            if (socket.fallback.kind === 'value') return { node: null, literal: socket.fallback.values, target: null }
            if (socket.fallback.kind === 'input') {
                const spec = specOf(socket.fallback.type)
                if (spec) {
                    const extra: Item = { id: `~${spec.type}`, spec, set: {}, inputs: [], source: null, type: 'float', typed: false, error: null }
                    synthetic.push(extra)
                    return { node: extra, literal: null, target: null }
                }
            }
            return { node: null, literal: null, target: null }
        })
        const source = sourceOf(node)
        if (item.spec.source && source !== null) {
            const ref = items.get(source)
            item.source = ref && ref.spec.type !== 'Output' ? ref : null
        }
    }

    const state = new Map<Item, number>()
    const order: Item[] = []
    let cycle = false
    const deps = (item: Item) => [...item.inputs.map((input) => input.node).filter((node): node is Item => !!node), ...(item.source ? [item.source] : [])]
    const visit = (item: Item) => {
        const seen = state.get(item)
        if (seen === 1) {
            cycle = true
            return
        }
        if (seen === 2) return
        state.set(item, 1)
        for (const dep of deps(item)) visit(dep)
        state.set(item, 2)
        order.push(item)
    }
    for (const item of [...items.values(), ...synthetic]) if (!cycle) visit(item)

    const errors = new Map<string, string>()
    if (!cycle) {
        for (const item of order) {
            const ready = item.inputs.every((input) => !input.node || input.node.typed) && (!item.source || item.source.typed)
            if (!ready) continue
            const result = typing(item)
            if (result.ok) {
                item.type = result.output
                item.typed = true
                item.inputs.forEach((input, i) => (input.target = result.targets[i] ?? null))
            } else {
                item.error = result.message
                if (!item.id.startsWith('~')) errors.set(item.id, result.message)
            }
        }
    }

    const types = new Map<string, SocketType>()
    for (const item of items.values()) if (item.typed) types.set(item.id, item.type)

    const output = [...items.values()].find((item) => item.spec.type === 'Output') ?? null
    const reachable = new Set<string>()
    if (output) {
        const stack = [output]
        while (stack.length) {
            const item = stack.pop() as Item
            if (reachable.has(item.id)) continue
            reachable.add(item.id)
            stack.push(...deps(item))
        }
    }

    const outline = typeof graph.outline === 'string'
    let cost = 0
    let samples = 0
    if (output && !cycle && weigh) {
        const memo = new Map<string, { cost: number, samples: number }>()
        const of = (root: Item, inside: boolean): { cost: number, samples: number } => {
            const key = `${inside ? 1 : 0}:${root.id}:${synthetic.indexOf(root)}`
            const known = memo.get(key)
            if (known) return known
            const cone: Item[] = []
            const seen = new Set<Item>()
            const walk = (item: Item) => {
                if (seen.has(item)) return
                seen.add(item)
                for (const input of item.inputs) if (input.node) walk(input.node)
                cone.push(item)
            }
            walk(root)
            let total = 0
            let reads = 0
            for (const item of cone) {
                const repeat = item.spec.typing.kind === 'repeat'
                const sub = item.source ? of(item.source, inside || repeat) : null
                const times = repeat ? intSetting(item.set, 'count', 1, 16, 1) : 1
                total += ownCost(item, weigh) + times * (sub?.cost ?? 0)
                reads += (item.spec.samples ?? 0) + times * (sub?.samples ?? 0)
            }
            const result = { cost: Math.min(total, 1e9), samples: Math.min(reads, 1e9) }
            memo.set(key, result)
            return result
        }
        const load = of(output, false)
        cost = outline ? load.cost * outlineFactor : load.cost
        samples = load.samples
    }

    return { types, errors, reachable, output: output?.id ?? null, cycle, cost, samples, outline, count: json.length }
}

export interface ConnectCheck {
    ok: boolean
    message?: string
}

export function checkLink(graph: MaterialJson, analysis: Analysis, source: string, targetId: string, socketName: string): ConnectCheck {
    if (source === targetId) return { ok: false, message: 'A node can\'t feed itself' }
    const sourceNode = nodesOf(graph).find((node) => node.id === source)
    const targetNode = nodesOf(graph).find((node) => node.id === targetId)
    if (!sourceNode || !targetNode) return { ok: false }
    if (sourceNode.type === 'Output') return { ok: false, message: 'The Output can\'t feed another node' }
    const spec = specOf(targetNode.type)
    if (!spec) return { ok: true }
    if (socketName !== SOURCE_SOCKET) {
        const socket = spec.sockets.find((entry) => entry.name === socketName)
        const type = analysis.types.get(source)
        if (socket && type && target(socket.accepts, type) === null) return { ok: false, message: mismatchMessage(socket, type) }
    }
    const trial = cloneJson(graph)
    const node = nodesOf(trial).find((entry) => entry.id === targetId) as NodeJson
    if (socketName === SOURCE_SOCKET) {
        node.set = { ...(node.set ?? {}), source }
    } else {
        node.in = { ...(node.in ?? {}), [socketName]: source }
    }
    const after = analyze(trial)
    if (after.cycle) return { ok: false, message: 'That would make a loop. A node can\'t depend on its own result' }
    const error = after.errors.get(targetId)
    if (error && error !== analysis.errors.get(targetId)) return { ok: false, message: error }
    return { ok: true }
}

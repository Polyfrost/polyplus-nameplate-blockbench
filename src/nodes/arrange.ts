import { Link, links, MaterialJson, NodeJson, uniqueNodes } from './graph'
import { estimateHeight, inputOffset, NODE_WIDTH, outputOffset, shapeOf } from './shape'

const COLUMN_GAP = 48
const ROW_GAP = 24
export const READABLE_ZOOM = 0.7
export const OVERVIEW_ZOOM = 0.35
export const MAX_FIT_ZOOM = 1
const FIT_PADDING = 24
const SWEEPS = 8

export interface Position {
    x: number
    y: number
}

export interface Box {
    x: number
    y: number
    width: number
    height: number
}

interface Transform {
    k: number
    x: number
    y: number
}

interface Segment {
    left: string
    right: string
    socket: string | null
}

interface Layers {
    columns: string[][]
    depth: Map<string, number>
    segments: Segment[]
    nodes: Map<string, NodeJson>
}

function drawnLinks(graph: MaterialJson, nodes: Map<string, NodeJson>): Link[] {
    return links(graph).filter((link) => {
        const source = nodes.get(link.source)
        const target = nodes.get(link.target)
        if (!source || !target || link.source === link.target) return false
        return shapeOf(source).output && shapeOf(target).inputs.some((input) => input.key === link.socket)
    })
}

function layer(graph: MaterialJson): Layers {
    const list = uniqueNodes(graph)
    const nodes = new Map(list.map((node) => [node.id, node]))
    const edges = drawnLinks(graph, nodes)
    const consumers = new Map<string, Link[]>()
    for (const edge of edges) consumers.set(edge.source, [...(consumers.get(edge.source) ?? []), edge])
    const depth = new Map<string, number>()
    const visiting = new Set<string>()
    const depthOf = (id: string): number => {
        const known = depth.get(id)
        if (known !== undefined) return known
        if (visiting.has(id)) return 0
        visiting.add(id)
        const users = consumers.get(id) ?? []
        const value = users.length ? 1 + Math.max(...users.map((edge) => depthOf(edge.target))) : 0
        visiting.delete(id)
        depth.set(id, value)
        return value
    }
    for (const node of list) depthOf(node.id)
    const max = Math.max(0, ...depth.values())
    const columns: string[][] = Array.from({ length: max + 1 }, () => [])
    const sinks = list.filter((node) => depth.get(node.id) === 0)
    for (const node of [...sinks.filter((node) => node.type === 'Output'), ...sinks.filter((node) => node.type !== 'Output')]) columns[0].push(node.id)
    const segments: Segment[] = []
    let dummies = 0
    for (const edge of edges) {
        const from = depth.get(edge.source) ?? 0
        const to = depth.get(edge.target) ?? 0
        if (from <= to) continue
        let left = edge.source
        for (let d = from - 1; d > to; d--) {
            const dummy = `\u0000${dummies++}`
            depth.set(dummy, d)
            segments.push({ left, right: dummy, socket: null })
            left = dummy
        }
        segments.push({ left, right: edge.target, socket: edge.socket })
    }
    const order = new Map(list.map((node, i) => [node.id, i]))
    for (const [id, d] of depth) {
        if (d > 0 && (nodes.has(id) || id.startsWith('\u0000'))) columns[d].push(id)
    }
    for (const column of columns) column.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
    return { columns, depth, segments, nodes }
}

function portOf(layers: Layers, segment: Segment): number {
    const node = layers.nodes.get(segment.right)
    if (!node || segment.socket === null) return 0.5
    const inputs = shapeOf(node).inputs
    const index = inputs.findIndex((input) => input.key === segment.socket)
    return (Math.max(0, index) + 1) / (inputs.length + 1)
}

function indexMap(columns: string[][]): Map<string, number> {
    const result = new Map<string, number>()
    for (const column of columns) column.forEach((id, i) => result.set(id, i))
    return result
}

function crossings(layers: Layers, columns: string[][]): number {
    const index = indexMap(columns)
    const byLayer = new Map<number, Array<[number, number]>>()
    for (const segment of layers.segments) {
        const d = layers.depth.get(segment.right) ?? 0
        const pair: [number, number] = [index.get(segment.left) ?? 0, (index.get(segment.right) ?? 0) + portOf(layers, segment)]
        byLayer.set(d, [...(byLayer.get(d) ?? []), pair])
    }
    let total = 0
    for (const pairs of byLayer.values()) {
        for (let i = 0; i < pairs.length; i++) {
            for (let j = i + 1; j < pairs.length; j++) {
                if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) total++
            }
        }
    }
    return total
}

function reorder(column: string[], score: (id: string) => number | null) {
    const keyed = column.map((id, i) => {
        const value = score(id)
        return { id, key: value === null ? i : value, i }
    })
    keyed.sort((a, b) => a.key - b.key || a.i - b.i)
    column.splice(0, column.length, ...keyed.map((entry) => entry.id))
}

function mean(values: number[]): number | null {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function orderColumns(layers: Layers): string[][] {
    const columns = layers.columns.map((column) => column.slice())
    const rightOf = new Map<string, Segment[]>()
    const leftOf = new Map<string, Segment[]>()
    for (const segment of layers.segments) {
        rightOf.set(segment.left, [...(rightOf.get(segment.left) ?? []), segment])
        leftOf.set(segment.right, [...(leftOf.get(segment.right) ?? []), segment])
    }
    const byRight = (d: number) => {
        const index = indexMap([columns[d - 1]])
        reorder(columns[d], (id) => mean((rightOf.get(id) ?? []).filter((s) => index.has(s.right)).map((s) => (index.get(s.right) ?? 0) + portOf(layers, s))))
    }
    const byLeft = (d: number) => {
        const index = indexMap([columns[d + 1]])
        reorder(columns[d], (id) => mean((leftOf.get(id) ?? []).filter((s) => index.has(s.left)).map((s) => (index.get(s.left) ?? 0) + 0.5)))
    }
    for (let d = 1; d < columns.length; d++) byRight(d)
    let best = columns.map((column) => column.slice())
    let fewest = crossings(layers, best)
    for (let sweep = 0; sweep < SWEEPS && fewest > 0; sweep++) {
        if (sweep % 2 === 0) for (let d = columns.length - 2; d >= 1; d--) byLeft(d)
        else for (let d = 1; d < columns.length; d++) byRight(d)
        const count = crossings(layers, columns)
        if (count < fewest) {
            fewest = count
            best = columns.map((column) => column.slice())
        }
    }
    return best
}

function packColumn(desired: number[], heights: number[]): number[] {
    const offsets: number[] = []
    let offset = 0
    for (const height of heights) {
        offsets.push(offset)
        offset += height + ROW_GAP
    }
    const blocks: Array<{ value: number, count: number }> = []
    desired.forEach((value, i) => {
        blocks.push({ value: value - offsets[i], count: 1 })
        while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
            const last = blocks.pop()!
            const before = blocks[blocks.length - 1]
            before.value = (before.value * before.count + last.value * last.count) / (before.count + last.count)
            before.count += last.count
        }
    })
    const result: number[] = []
    for (const block of blocks) for (let i = 0; i < block.count; i++) result.push(block.value + offsets[result.length])
    return result
}

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function arrangeGraph(graph: MaterialJson): Map<string, Position> {
    const layers = layer(graph)
    const columns = orderColumns(layers)
    const max = columns.length - 1
    const top = new Map<string, number>()
    const rightOf = new Map<string, Segment[]>()
    for (const segment of layers.segments) rightOf.set(segment.left, [...(rightOf.get(segment.left) ?? []), segment])
    const lineInto = (segment: Segment): number => {
        const node = layers.nodes.get(segment.right)
        const base = top.get(segment.right) ?? 0
        return node && segment.socket !== null ? base + inputOffset(node, segment.socket) : base
    }
    columns.forEach((column, d) => {
        const real = column.filter((id) => layers.nodes.has(id))
        const heights = real.map((id) => estimateHeight(layers.nodes.get(id)!))
        let previous = 0
        const desired = real.map((id, i) => {
            const lines = (rightOf.get(id) ?? []).map(lineInto)
            const value = d > 0 && lines.length ? median(lines) - outputOffset() : previous
            previous = value + heights[i] + ROW_GAP
            return value
        })
        packColumn(desired, heights).forEach((y, i) => top.set(real[i], y))
        for (const id of column) {
            if (layers.nodes.has(id)) continue
            const lines = (rightOf.get(id) ?? []).map(lineInto)
            top.set(id, lines.length ? median(lines) : 0)
        }
    })
    const result = new Map<string, Position>()
    let lowest = Infinity
    for (const id of layers.nodes.keys()) lowest = Math.min(lowest, top.get(id) ?? 0)
    if (!isFinite(lowest)) lowest = 0
    for (const [id] of layers.nodes) {
        const d = layers.depth.get(id) ?? 0
        result.set(id, { x: Math.round((max - d) * (NODE_WIDTH + COLUMN_GAP)), y: Math.round((top.get(id) ?? 0) - lowest) })
    }
    return result
}

export function nodeBox(node: NodeJson, position: Position): Box {
    return { x: position.x, y: position.y, width: NODE_WIDTH, height: estimateHeight(node) }
}

function overlaps(a: Box, b: Box): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function freeSpot(boxes: Box[], wanted: Box): Position {
    const box = { ...wanted }
    for (let tries = 0; tries <= boxes.length; tries++) {
        const hit = boxes.find((other) => overlaps(box, other))
        if (!hit) break
        box.y = hit.y + hit.height + ROW_GAP
    }
    return { x: box.x, y: box.y }
}

export function layoutGraph(graph: MaterialJson, known: Map<string, Position>): Map<string, Position> {
    const nodes = uniqueNodes(graph)
    if (nodes.every((node) => known.has(node.id))) return new Map(nodes.map((node) => [node.id, known.get(node.id)!]))
    const fresh = arrangeGraph(graph)
    if (!nodes.some((node) => known.has(node.id))) return fresh
    const result = new Map<string, Position>()
    const placed: Box[] = []
    let dx = 0
    let dy = 0
    let shared = 0
    for (const node of nodes) {
        const position = known.get(node.id)
        if (!position) continue
        result.set(node.id, position)
        placed.push(nodeBox(node, position))
        const auto = fresh.get(node.id)
        if (auto) {
            dx += position.x - auto.x
            dy += position.y - auto.y
            shared++
        }
    }
    if (shared) {
        dx /= shared
        dy /= shared
    }
    for (const node of nodes) {
        if (result.has(node.id)) continue
        const auto = fresh.get(node.id) ?? { x: 0, y: 0 }
        const box = nodeBox(node, freeSpot(placed, nodeBox(node, { x: Math.round(auto.x + dx), y: Math.round(auto.y + dy) })))
        placed.push(box)
        result.set(node.id, { x: box.x, y: box.y })
    }
    return result
}

function bounds(boxes: Box[]): Box {
    const left = Math.min(...boxes.map((box) => box.x))
    const top = Math.min(...boxes.map((box) => box.y))
    const right = Math.max(...boxes.map((box) => box.x + box.width))
    const bottom = Math.max(...boxes.map((box) => box.y + box.height))
    return { x: left, y: top, width: right - left, height: bottom - top }
}

function placeAxis(start: number, size: number, view: number, k: number, anchor: number | null): number {
    const room = view - 2 * FIT_PADDING
    if (size * k <= room) return view / 2 - (start + size / 2) * k
    const first = FIT_PADDING - start * k
    const last = view - FIT_PADDING - (start + size) * k
    const wanted = anchor === null ? first : anchor
    return Math.min(first, Math.max(last, wanted))
}

export function fitTransform(boxes: Box[], view: { width: number, height: number }, anchor: Box | null, zoom: { min: number, max: number }): Transform {
    const all = bounds(boxes)
    const fit = Math.min((view.width - 2 * FIT_PADDING) / Math.max(1, all.width), (view.height - 2 * FIT_PADDING) / Math.max(1, all.height))
    const k = Math.max(zoom.min, Math.min(zoom.max, fit))
    const x = placeAxis(all.x, all.width, view.width, k, anchor ? view.width - FIT_PADDING - (anchor.x + anchor.width) * k : null)
    const y = placeAxis(all.y, all.height, view.height, k, anchor ? view.height / 2 - (anchor.y + anchor.height / 2) * k : null)
    return { k, x, y }
}

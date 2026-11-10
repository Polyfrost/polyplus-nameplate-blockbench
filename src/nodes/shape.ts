import { ACCEPTS_LABEL, NodeSpec, SOURCE_SOCKET, specOf } from './catalog'
import { NodeJson, nodeInputs } from './graph'

export const NODE_WIDTH = 160
const ROW_HEIGHT = 22
const TITLE_HEIGHT = 27
const FRAME_HEIGHT = 32
const NOTE_HEIGHT = 18

export interface Shape {
    inputs: Array<{ key: string, label: string, socket: string, title: string }>
    output: boolean
}

export function shapeOf(node: NodeJson, spec: NodeSpec | null = specOf(String(node.type))): Shape {
    if (!spec) {
        return {
            inputs: Object.keys(nodeInputs(node)).map((key) => ({ key, label: key, socket: 'any', title: 'anything' })),
            output: true,
        }
    }
    const inputs: Shape['inputs'] = spec.sockets.map((socket) => ({ key: socket.name, label: socket.label, socket: socket.accepts, title: `${socket.label}: takes ${ACCEPTS_LABEL[socket.accepts]}` }))
    if (spec.source) inputs.unshift({ key: SOURCE_SOCKET, label: 'Source', socket: 'source', title: 'Source: the node to work out again' })
    return { inputs, output: spec.type !== 'Output' }
}

export function shapeKey(node: NodeJson, spec: NodeSpec | null): string {
    const shape = shapeOf(node, spec)
    return `${node.type}|${shape.inputs.map((input) => input.key).join(',')}|${shape.output}`
}

export function hasSummary(node: NodeJson): boolean {
    return (specOf(String(node.type))?.settings.length ?? 0) > 0
}

export function estimateHeight(node: NodeJson, notes = 0): number {
    const shape = shapeOf(node)
    return FRAME_HEIGHT + (shape.inputs.length + (shape.output ? 1 : 0)) * ROW_HEIGHT + ((hasSummary(node) ? 1 : 0) + Math.min(1, notes)) * NOTE_HEIGHT
}

export function outputOffset(): number {
    return TITLE_HEIGHT + ROW_HEIGHT / 2
}

export function inputOffset(node: NodeJson, socket: string): number {
    const shape = shapeOf(node)
    const index = Math.max(0, shape.inputs.findIndex((input) => input.key === socket))
    return TITLE_HEIGHT + (shape.output ? ROW_HEIGHT : 0) + index * ROW_HEIGHT + ROW_HEIGHT / 2
}

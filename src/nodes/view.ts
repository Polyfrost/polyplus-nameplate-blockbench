import { ClassicPreset, GetSchemes, NodeEditor } from 'rete'
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin'
import { ClassicFlow, ConnectionPlugin, getSourceTarget } from 'rete-connection-plugin'
import { Presets, VueArea2D, VuePlugin } from 'rete-vue-plugin/vue2'
import { Box, fitTransform, MAX_FIT_ZOOM, OVERVIEW_ZOOM, Position, READABLE_ZOOM } from './arrange'
import { Fallback, GROUPS, NodeSpec, SOURCE_SOCKET, specOf, TYPE_LABEL } from './catalog'
import { ConnectionComponent, NodeComponent, SocketComponent } from './components'
import { Link, linkKey, links, MaterialJson, NodeJson, nodeInputs, readLiteral, uniqueNodes } from './graph'
import { estimateHeight, hasSummary, NODE_WIDTH, shapeKey, shapeOf } from './shape'
import { ConnectCheck } from './typing'
import { Problem, Validation } from './validate'

export type { Position } from './arrange'

export interface Row {
    linked: boolean
    literal: string
    placeholder: string
    editable: boolean
    required: boolean
}

interface NodeLook {
    type: string
    icon: string
    help: string
    rows: Record<string, Row>
    summary: string | null
    problems: string[]
    hints: string[]
    unused: boolean
    onEdit(key: string): void
}

interface ShowHooks {
    edit(id: string, key: string): void
    summary(node: NodeJson): string
}

export interface MapBox extends Box {
    id: string
    selected: boolean
    bad: boolean
}

class TypedSocket extends ClassicPreset.Socket {
    title: string

    constructor(name: string, title: string) {
        super(name)
        this.title = title
    }
}

class GraphNode extends ClassicPreset.Node {
    width = NODE_WIDTH
    height = 60
    type: string
    look: NodeLook

    constructor(id: string, type: string, label: string, look: NodeLook) {
        super(label)
        this.id = id
        this.type = type
        this.look = look
    }
}

class GraphConnection extends ClassicPreset.Connection<GraphNode, GraphNode> {
    kind = 'any'
}

type Schemes = GetSchemes<GraphNode, GraphConnection>
type AreaExtra = VueArea2D<Schemes>

interface CanvasHooks {
    check(source: string, target: string, socket: string): ConnectCheck
    linksChanged(links: Link[]): void
    select(ids: string[]): void
    moved(id: string, position: Position): void
    menu(event: MouseEvent, target: { kind: 'root' } | { kind: 'node', id: string } | { kind: 'link', link: Link }): void
}

const GROUP_ICONS: Record<string, string> = Object.fromEntries(GROUPS.map((group) => [group.id, group.icon]))
const TOOLBAR_INSET = 40

export function formatLiteral(value: unknown): string {
    const literal = readLiteral(value)
    if (literal === null) return ''
    return Array.isArray(literal) ? literal.join(', ') : String(literal)
}

export function fallbackText(fallback: Fallback): string {
    switch (fallback.kind) {
        case 'required':
            return 'needed'
        case 'absent':
            return 'off'
        case 'value':
            return fallback.values.join(', ')
        case 'input':
            return `auto: ${specOf(fallback.type)?.label ?? fallback.type}`
    }
}

function linkOf(connection: GraphConnection): Link {
    return { source: connection.source, target: connection.target, socket: String(connection.targetInput) }
}

export class MaterialCanvas {
    readonly editor = new NodeEditor<Schemes>()
    readonly area: AreaPlugin<Schemes, AreaExtra>
    private readonly connection = new ConnectionPlugin<Schemes, AreaExtra>()
    private readonly render = new VuePlugin<Schemes, AreaExtra>()
    private readonly selector = AreaExtensions.selector()
    private readonly accumulating = AreaExtensions.accumulateOnCtrl()
    private readonly selection: { select(id: string, accumulate: boolean): Promise<void>, unselect(id: string): Promise<void> }
    private readonly shapes = new Map<string, string>()
    private syncing = 0
    private dragging = false
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private selectTimer: ReturnType<typeof setTimeout> | null = null
    private lastLinks = ''
    private destroyed = false
    private readonly viewListeners = new Set<() => void>()

    constructor(container: HTMLElement, private readonly hooks: CanvasHooks) {
        this.area = new AreaPlugin<Schemes, AreaExtra>(container)
        this.selection = AreaExtensions.selectableNodes(this.area, this.selector, { accumulating: this.accumulating })
        AreaExtensions.restrictor(this.area, { scaling: () => ({ min: 0.2, max: 2 }) })
        this.render.addPreset(Presets.classic.setup({
            customize: {
                node: () => NodeComponent as any,
                socket: () => SocketComponent as any,
                connection: () => ConnectionComponent as any,
                control: () => null as any,
            },
        }) as any)
        this.connection.addPreset(() => new ClassicFlow({
            canMakeConnection: (initial, socket) => this.canConnect(initial, socket),
        }) as any)
        this.editor.use(this.area)
        this.area.use(this.connection)
        this.area.use(this.render)
        AreaExtensions.simpleNodesOrder(this.area)

        this.connection.addPipe((context: any) => {
            if (context?.type === 'connectionpick') this.dragging = true
            if (context?.type === 'connectiondrop') {
                this.dragging = false
                this.scheduleFlush()
            }
            return context
        })
        this.editor.addPipe((context) => {
            if ((context.type === 'connectioncreated' || context.type === 'connectionremoved') && this.syncing === 0) this.scheduleFlush()
            return context
        })
        this.area.addPipe((context: any) => {
            if (!context || typeof context !== 'object') return context
            if (context.type === 'nodepicked' || context.type === 'pointerup') this.scheduleSelect()
            if (context.type === 'nodetranslated' && this.syncing === 0) this.hooks.moved(context.data.id, context.data.position)
            if (context.type === 'translated' || context.type === 'zoomed' || context.type === 'nodetranslated' || context.type === 'resized') this.viewChanged()
            if (context.type === 'contextmenu') {
                context.data.event.preventDefault()
                context.data.event.stopPropagation()
                const target = context.data.context
                if (target === 'root') this.hooks.menu(context.data.event, { kind: 'root' })
                else if (target instanceof GraphNode) this.hooks.menu(context.data.event, { kind: 'node', id: target.id })
                else if (target instanceof GraphConnection) {
                    this.hooks.menu(context.data.event, { kind: 'link', link: linkOf(target) })
                }
                return
            }
            return context
        })
    }

    private canConnect(initial: any, socket: any): boolean {
        const pair = getSourceTarget(initial, socket)
        if (!pair) return false
        const [source, target] = pair
        const result = this.hooks.check(source.nodeId, target.nodeId, String(target.key))
        if (!result.ok && result.message) Blockbench.showQuickMessage(result.message, 2500)
        return result.ok
    }

    private scheduleSelect() {
        if (this.selectTimer) clearTimeout(this.selectTimer)
        this.selectTimer = setTimeout(() => {
            this.selectTimer = null
            if (!this.destroyed) this.hooks.select(this.selected())
        }, 0)
    }

    private scheduleFlush() {
        if (this.flushTimer) clearTimeout(this.flushTimer)
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null
            if (this.destroyed || this.dragging || this.syncing > 0) return
            const current = this.currentLinks()
            const key = current.map(linkKey).sort().join('|')
            if (key === this.lastLinks) return
            this.lastLinks = key
            this.hooks.linksChanged(current)
        }, 60)
    }

    private currentLinks(): Link[] {
        return this.editor.getConnections().map(linkOf)
    }

    selected(): string[] {
        return this.editor.getNodes().filter((node) => node.selected).map((node) => node.id)
    }

    async select(ids: string[]) {
        const wanted = ids.filter((id) => !!this.editor.getNode(id))
        const current = this.selected()
        if (current.length === wanted.length && current.every((id) => wanted.includes(id))) return
        await this.selector.unselectAll()
        for (const node of this.editor.getNodes()) {
            if (node.selected && !wanted.includes(node.id)) {
                node.selected = false
                await this.area.update('node', node.id)
            }
        }
        for (const id of wanted) await this.selection.select(id, true)
        this.viewChanged()
    }

    hasSize(): boolean {
        const container = this.area.container
        return container.isConnected && container.clientWidth > 0 && container.clientHeight > 0
    }

    viewCenter(): Position {
        const rect = this.area.container.getBoundingClientRect()
        const { x, y, k } = this.area.area.transform
        return { x: (rect.width / 2 - x) / k - NODE_WIDTH / 2, y: (rect.height / 2 - y) / k - 40 }
    }

    pointerPosition(): Position {
        return { x: this.area.area.pointer.x, y: this.area.area.pointer.y }
    }

    positions(): Map<string, Position> {
        const result = new Map<string, Position>()
        for (const [id, view] of this.area.nodeViews) result.set(id, { ...view.position })
        return result
    }

    onView(listener: () => void): () => void {
        this.viewListeners.add(listener)
        return () => this.viewListeners.delete(listener)
    }

    viewChanged() {
        if (this.destroyed) return
        for (const listener of this.viewListeners) listener()
    }

    mapBoxes(): MapBox[] {
        const result: MapBox[] = []
        for (const node of this.editor.getNodes()) {
            const box = this.boxOf(node)
            if (box) result.push({ ...box, id: node.id, selected: !!node.selected, bad: node.look.problems.length > 0 })
        }
        return result
    }

    viewRect(): Box {
        const { x, y, k } = this.area.area.transform
        const container = this.area.container
        return { x: -x / k, y: -y / k, width: container.clientWidth / k, height: container.clientHeight / k }
    }

    async centerOn(point: Position) {
        if (this.destroyed) return
        const { k } = this.area.area.transform
        const container = this.area.container
        await this.area.area.translate(container.clientWidth / 2 - point.x * k, container.clientHeight / 2 - point.y * k)
    }

    screenToWorld(clientX: number, clientY: number): Position {
        const rect = this.area.container.getBoundingClientRect()
        const { x, y, k } = this.area.area.transform
        return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k }
    }

    private makeLook(node: NodeJson, spec: NodeSpec | null, problems: Problem[], analysisType: string | undefined, hooks: ShowHooks, linked: Set<string>): NodeLook {
        const rows: Record<string, Row> = {}
        if (spec) {
            for (const socket of spec.sockets) {
                const value = nodeInputs(node)[socket.name]
                rows[socket.name] = {
                    linked: linked.has(socket.name),
                    literal: typeof value === 'string' ? '' : formatLiteral(value),
                    placeholder: fallbackText(socket.fallback),
                    editable: true,
                    required: socket.fallback.kind === 'required' && value === undefined,
                }
            }
            if (spec.source) rows[SOURCE_SOCKET] = { linked: linked.has(SOURCE_SOCKET), literal: '', placeholder: '', editable: false, required: !linked.has(SOURCE_SOCKET) }
        } else {
            for (const key of Object.keys(nodeInputs(node))) {
                rows[key] = { linked: linked.has(key), literal: formatLiteral(nodeInputs(node)[key]), placeholder: '', editable: false, required: false }
            }
        }
        const kind = analysisType ? TYPE_LABEL[analysisType as keyof typeof TYPE_LABEL] ?? '' : ''
        return {
            type: String(node.type),
            icon: spec ? GROUP_ICONS[spec.group] ?? 'circle' : 'help_outline',
            help: spec ? `${spec.help}${kind && spec.type !== 'Output' ? `. Gives a ${kind}` : ''}. Click to change it` : `Unknown node type '${node.type}' (${node.id})`,
            rows,
            summary: spec && hasSummary(node) ? hooks.summary(node) : null,
            problems: problems.filter((problem) => problem.severity === 'error').map((problem) => problem.message),
            hints: problems.filter((problem) => problem.severity === 'hint').map((problem) => problem.message),
            unused: problems.some((problem) => problem.severity === 'hint'),
            onEdit: (key) => hooks.edit(node.id, key),
        }
    }

    async show(graph: MaterialJson, validation: Validation | null, positions: Map<string, Position>, hooks: ShowHooks) {
        if (this.destroyed) return
        this.syncing++
        try {
            const nodes = uniqueNodes(graph)
            const wanted = new Map(nodes.map((node) => [node.id, node]))
            const graphLinks = links(graph).filter((link) => link.socket !== SOURCE_SOCKET || specOf(String(wanted.get(link.target)?.type))?.source)
            const linkedInputs = new Map<string, Set<string>>()
            for (const link of graphLinks) linkedInputs.set(link.target, new Set([...(linkedInputs.get(link.target) ?? []), link.socket]))

            for (const node of this.editor.getNodes()) {
                const model = wanted.get(node.id)
                if (!model || this.shapes.get(node.id) !== shapeKey(model, specOf(String(model.type)))) {
                    for (const connection of this.editor.getConnections()) {
                        if (connection.source === node.id || connection.target === node.id) await this.editor.removeConnection(connection.id)
                    }
                    await this.editor.removeNode(node.id)
                    this.shapes.delete(node.id)
                }
            }

            const problemsBy = new Map<string, Problem[]>()
            for (const problem of validation?.problems ?? []) {
                if (problem.node) problemsBy.set(problem.node, [...(problemsBy.get(problem.node) ?? []), problem])
            }

            for (const model of nodes) {
                const spec = specOf(String(model.type))
                const type = validation?.analysis.types.get(model.id)
                const look = this.makeLook(model, spec, problemsBy.get(model.id) ?? [], type, hooks, linkedInputs.get(model.id) ?? new Set())
                const label = spec ? spec.label : String(model.type)
                let view = this.editor.getNode(model.id)
                if (!view) {
                    view = new GraphNode(model.id, String(model.type), label, look)
                    const shape = shapeOf(model, spec)
                    for (const input of shape.inputs) {
                        view.addInput(input.key, new ClassicPreset.Input(new TypedSocket(input.socket, input.title), input.label, false))
                    }
                    if (shape.output) view.addOutput('out', new ClassicPreset.Output(new TypedSocket('any', 'Output'), 'Out', true))
                    this.shapes.set(model.id, shapeKey(model, spec))
                    await this.editor.addNode(view)
                    const position = positions.get(model.id) ?? { x: 0, y: 0 }
                    await this.area.translate(model.id, position)
                } else {
                    view.look = look
                    view.label = label
                }
                const output = view.outputs.out
                if (output) {
                    output.socket = new TypedSocket(type ?? 'any', type ? `Gives a ${TYPE_LABEL[type]}` : 'Output')
                    output.label = type ? TYPE_LABEL[type] : 'Out'
                }
                view.height = estimateHeight(model, look.problems.length + look.hints.length > 0 ? 1 : 0)
                await this.area.update('node', model.id)
            }

            const want = new Map(graphLinks.map((link) => [linkKey(link), link]))
            for (const connection of this.editor.getConnections()) {
                if (!want.has(linkKey(linkOf(connection)))) await this.editor.removeConnection(connection.id)
            }
            const have = new Set(this.currentLinks().map(linkKey))
            for (const [key, link] of want) {
                if (have.has(key)) continue
                const source = this.editor.getNode(link.source)
                const target = this.editor.getNode(link.target)
                if (!source || !target || !source.outputs.out || !target.inputs[link.socket]) continue
                const connection = new GraphConnection(source, 'out', target, link.socket as never)
                connection.kind = link.socket === SOURCE_SOCKET ? 'source' : validation?.analysis.types.get(link.source) ?? 'any'
                await this.editor.addConnection(connection)
            }
            for (const connection of this.editor.getConnections()) {
                const kind = connection.targetInput === SOURCE_SOCKET ? 'source' : validation?.analysis.types.get(connection.source) ?? 'any'
                if (connection.kind !== kind) {
                    connection.kind = kind
                    await this.area.update('connection', connection.id)
                }
            }
            this.lastLinks = this.currentLinks().map(linkKey).sort().join('|')
        } finally {
            this.syncing--
        }
        this.viewChanged()
    }

    private boxOf(node: GraphNode): Box | null {
        const view = this.area.nodeViews.get(node.id)
        return view ? { x: view.position.x, y: view.position.y, width: node.width, height: node.height } : null
    }

    async fit(ids?: string[]) {
        if (this.destroyed || !this.hasSize()) return
        const nodes = ids ? this.editor.getNodes().filter((node) => ids.includes(node.id)) : this.editor.getNodes()
        const boxes = nodes.map((node) => this.boxOf(node)).filter((box): box is Box => !!box)
        if (!boxes.length) return
        const container = this.area.container
        const transform = this.area.area.transform
        const focus = !!ids && ids.length === 1
        const steady = Math.max(READABLE_ZOOM, Math.min(MAX_FIT_ZOOM, transform.k))
        const output = ids ? undefined : nodes.find((node) => node.type === 'Output')
        const anchor = output ? this.boxOf(output) : null
        const next = fitTransform(boxes, { width: container.clientWidth, height: Math.max(1, container.clientHeight - TOOLBAR_INSET) }, anchor, focus ? { min: steady, max: steady } : { min: ids ? READABLE_ZOOM : OVERVIEW_ZOOM, max: MAX_FIT_ZOOM })
        transform.x = next.x
        transform.y = next.y + TOOLBAR_INSET
        await this.area.area.zoom(next.k, 0, 0)
    }

    destroy() {
        this.destroyed = true
        this.viewListeners.clear()
        this.accumulating.destroy()
        if (this.flushTimer) clearTimeout(this.flushTimer)
        if (this.selectTimer) clearTimeout(this.selectTimer)
        this.area.destroy()
    }
}

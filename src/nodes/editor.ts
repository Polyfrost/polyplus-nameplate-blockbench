import { ACCEPTS_LABEL, GROUPS, NodeSpec, SettingSpec, SocketSpec, SOURCE_SOCKET, specOf, VANILLA_TEXTURES } from './catalog'
import { completeContext, MaterialContext } from './context'
import { cloneJson } from '../util/json'
import { isTypingTarget } from '../util/typing'
import {
    addNode,
    canAdd,
    duplicateNode,
    findNode,
    Link,
    materialParams,
    MaterialJson,
    NodeJson,
    nodeInputs,
    nodeSettings,
    nodesOf,
    removeNodes,
    setInput,
    setLinks,
    setMaterial,
    setSetting,
} from './graph'
import { readLayout, writeLayout } from './layout'
import { Minimap } from './minimap'
import { MaterialPreview } from './preview'
import { AddItem, addableAt, addableCount, searchNodes } from './search'
import { markTourSeen, TOUR_STEPS, tourSeen } from './tour'
import { closeSession, commitGraph, openSession, Session } from './undo'
import { checkLink, MAX_NODES } from './typing'
import { limits, Problem, validateMaterial, Validation } from './validate'
import { pictureStem, sanitizeId } from '../palette/ids'
import { dialogButtons } from '../util/dialogs'
import { Box, freeSpot, layoutGraph, nodeBox } from './arrange'
import { fallbackText, formatLiteral, MaterialCanvas, Position } from './view'

export interface MaterialEditorOptions {
    title: string
    graph: unknown
    onChange(graph: unknown): void
    onClose?(): void
    read(): unknown
    key?: string
    context?: () => Partial<MaterialContext>
}

export interface MaterialEditorHandle {
    close(): void
}

type FormConfig = Record<string, '_' | FormElementOptions>

const DIALOG_ID = 'polyplus_nameplate_material_editor'
const FORM_DELAY = 400
const MATERIAL_TARGET = '#material'
const SOCKET_PREFIX = 'socket_'
const LAYOUT_DELAY = 300
const DIALOG_TOP = 26
const DIALOG_MARGIN = 12
const MIN_BODY_HEIGHT = 300
const ADDER_WIDTH = 340
const ADDER_HEIGHT = 380
const ADDER_GAP = 8
const BAD_NUMBER = 'Type a number, or up to 4 numbers separated by commas'

let current: MaterialEditor | null = null
let contextSource: (() => MaterialContext) | null = null
let textureAdder: ((id: string, bytes: Uint8Array) => boolean) | null = null

export function setTextureAdder(adder: ((id: string, bytes: Uint8Array) => boolean) | null) {
    textureAdder = adder
}

export function setDefaultContext(source: (() => MaterialContext) | null) {
    contextSource = source
}

function defaultContext(): MaterialContext {
    try {
        return contextSource ? contextSource() : completeContext(null)
    } catch (error) {
        console.error('[polyplus_nameplate] reading the nameplate for the material editor failed', error)
        return completeContext(null)
    }
}

function editorContext(options?: Pick<MaterialEditorOptions, 'context'>): MaterialContext {
    if (options?.context) {
        try {
            return completeContext({ ...defaultContext(), ...options.context() })
        } catch (error) {
            console.error('[polyplus_nameplate] material context failed', error)
        }
    }
    return defaultContext()
}

interface ProblemRow {
    node: string | null
    message: string
    severity: string
    where: string
}

interface Ui {
    revision: number
    adder: { open: boolean, query: string, index: number, x: number, y: number, height: number }
    tour: number
    side: { mode: 'material' | 'node' | 'many', title: string, id: string, help: string, icon: string, count: number, unknown: boolean, texture: boolean, values: boolean }
    params: string[]
    problems: ProblemRow[]
    cost: number
    costLimit: number
    costEstimate: boolean
    samples: number
    samplesLimit: number
    nodes: number
    nodesLimit: number
    engine: boolean
    outline: boolean
    empty: boolean
}

function emptyUi(): Ui {
    const limit = limits()
    return {
        revision: 0,
        adder: { open: false, query: '', index: 0, x: 0, y: 0, height: ADDER_HEIGHT },
        tour: -1,
        side: { mode: 'material', title: 'Graph', id: '', help: '', icon: 'tune', count: 0, unknown: false, texture: false, values: false },
        params: [],
        problems: [],
        cost: 0,
        costLimit: limit.cost,
        costEstimate: true,
        samples: 0,
        samplesLimit: limit.samples,
        nodes: 0,
        nodesLimit: MAX_NODES,
        engine: true,
        outline: false,
        empty: false,
    }
}

function sanitizeName(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 32)
}

function parseLiteral(text: string): number | number[] | undefined | null {
    const trimmed = text.trim()
    if (!trimmed) return undefined
    const parts = trimmed.split(/[\s,;]+/).filter(Boolean).map(Number)
    if (parts.length < 1 || parts.length > 4 || parts.some((part) => !Number.isFinite(part))) return null
    return parts.length === 1 ? parts[0] : parts
}

function valueHelp(socket: SocketSpec): string {
    const takes = `Takes ${ACCEPTS_LABEL[socket.accepts]}. Type one number, or up to 4 separated by commas, or link a node into this dot.`
    const fallback = socket.fallback
    switch (fallback.kind) {
        case 'required':
            return `${takes} It needs a value or a link.`
        case 'absent':
            return `${takes} Leave it empty to leave it out.`
        case 'value':
            return `${takes} Leave it empty to use ${fallback.values.join(', ')}.`
        case 'input':
            return `${takes} Leave it empty to use ${specOf(fallback.type)?.label ?? fallback.type}.`
    }
}

class MaterialEditor {
    readonly session: Session
    context: MaterialContext
    readonly ui: Ui = emptyUi()
    private canvas: MaterialCanvas | null = null
    private preview: MaterialPreview | null = null
    private minimap: Minimap | null = null
    private vm: any = null
    private stage: HTMLElement | null = null
    private adderAt: Position | null = null
    private dialog: Dialog | null = null
    private formHost: HTMLElement | null = null
    private form: InputForm | null = null
    private formTarget: string | null = null
    private formKeys = ''
    private pending: { target: string, values: Record<string, unknown> } | null = null
    private formTimer: ReturnType<typeof setTimeout> | null = null
    private validation: Validation | null = null
    private selected: string[] = []
    private queue: Promise<void> = Promise.resolve()
    private readonly positions: Map<string, Position>
    private readonly layoutKey: string
    private readonly project: unknown
    private layoutDirty = false
    private fitted = false
    private autoFit = true
    private refitQueued = false
    private canvasWatch: ResizeObserver | null = null
    private keyHook: Deletable | null = null
    private layoutTimer: ReturnType<typeof setTimeout> | null = null
    private readonly listener = () => this.refresh()
    private readonly resized = () => this.fitHeight()
    private footerWatch: ResizeObserver | null = null
    private closed = false

    constructor(private readonly options: MaterialEditorOptions) {
        this.session = openSession(options.key ?? options.title, options.graph, options.onChange, () => options.read())
        this.context = editorContext(options)
        this.layoutKey = options.key ?? options.title
        this.project = typeof Project !== 'undefined' && Project ? Project : null
        this.positions = readLayout(this.layoutKey, this.project)
        this.session.listeners.on(this.listener)
    }

    private place(id: string, position: Position) {
        this.positions.set(id, { x: position.x, y: position.y })
        this.layoutDirty = true
        if (this.layoutTimer) clearTimeout(this.layoutTimer)
        this.layoutTimer = setTimeout(() => this.saveLayout(), LAYOUT_DELAY)
    }

    private saveLayout() {
        if (this.layoutTimer) clearTimeout(this.layoutTimer)
        this.layoutTimer = null
        if (!this.layoutDirty) return
        this.layoutDirty = false
        try {
            writeLayout(this.layoutKey, this.positions, new Set(nodesOf(this.graph).map((node) => node.id)), this.project)
        } catch (error) {
            console.error('[polyplus_nameplate] saving the node layout failed', error)
        }
    }

    get graph(): MaterialJson {
        return this.session.graph
    }

    open(): MaterialEditorHandle {
        const editor = this
        const ui = this.ui
        const component = {
            data() {
                return { ui, steps: TOUR_STEPS }
            },
            computed: {
                adderGroups(this: { ui: Ui }) {
                    return this.ui.revision >= 0 ? searchNodes(editor.graph, this.ui.adder.query) : []
                },
                adderCount(this: any) {
                    return addableCount(this.adderGroups)
                },
                step(this: any) {
                    return this.ui.tour >= 0 ? this.steps[this.ui.tour] ?? null : null
                },
            },
            methods: {
                openAdder() {
                    editor.openAdder()
                },
                adderKey(this: any, event: KeyboardEvent) {
                    event.stopPropagation()
                    const count = this.adderCount
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault()
                        if (count > 0) this.ui.adder.index = (this.ui.adder.index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
                        this.$nextTick(() => (this.$refs.adderList as HTMLElement | undefined)?.querySelector('.np-add-item.selected')?.scrollIntoView({ block: 'nearest' }))
                    } else if (event.key === 'Enter') {
                        event.preventDefault()
                        this.pick(addableAt(this.adderGroups, this.ui.adder.index))
                    } else if (event.key === 'Escape') {
                        event.preventDefault()
                        editor.closeAdder()
                    } else if (event.key === 'Tab') {
                        event.preventDefault()
                    }
                },
                adderTyped(this: any) {
                    this.ui.adder.index = 0
                },
                adderKeep(event: MouseEvent) {
                    if ((event.target as HTMLElement | null)?.tagName !== 'INPUT') event.preventDefault()
                },
                hover(this: any, item: AddItem) {
                    if (!item.disabled) this.ui.adder.index = item.index
                },
                pick(item: AddItem | null) {
                    if (item && !item.disabled) editor.addFromAdder(item.type)
                },
                closeAdder() {
                    editor.closeAdder()
                },
                tourFocus(this: { ui: Ui, steps: typeof TOUR_STEPS }, area: string) {
                    return this.ui.tour >= 0 && this.steps[this.ui.tour]?.focus === area
                },
                startTour() {
                    editor.closeAdder()
                    ui.tour = 0
                },
                tourNext(this: any) {
                    if (this.ui.tour >= this.steps.length - 1) this.endTour()
                    else this.ui.tour++
                },
                tourBack(this: any) {
                    if (this.ui.tour > 0) this.ui.tour--
                },
                endTour() {
                    ui.tour = -1
                    markTourSeen()
                },
                focusProblem(problem: ProblemRow) {
                    if (problem.node) editor.focusNode(problem.node)
                },
                remove() {
                    editor.deleteSelected()
                },
                duplicate() {
                    editor.duplicateSelected()
                },
                addTexture() {
                    editor.addTexture()
                },
                fit() {
                    void editor.canvas?.fit()
                },
                tidy() {
                    editor.tidy()
                },
                percent(value: number, limit: number) {
                    return `${Math.min(100, Math.round((value / Math.max(1, limit)) * 100))}%`
                },
            },
            mounted(this: any) {
                editor.vm = this
                editor.stage = this.$refs.stage as HTMLElement
                editor.mount(this.$refs.canvas as HTMLElement, this.$refs.form as HTMLElement, this.$refs.preview as HTMLElement, this.$refs.minimap as HTMLElement)
            },
            template: `
                <div class="np-mat-root">
                    <div class="np-mat">
                        <div class="np-mat-stage" ref="stage" :class="{ 'np-tour-focus': tourFocus('canvas') }">
                            <div class="np-mat-canvas" ref="canvas"></div>
                            <div class="np-mat-canvas-empty" v-if="ui.empty">
                                <b>No nodes yet</b>
                                <span>Click Add node, press Shift+A, or right-click here to add one. Every effect ends in an Output node.</span>
                            </div>
                            <div class="np-mat-tools">
                                <button type="button" class="np-mat-add-button" :class="{ 'np-tour-focus': tourFocus('add') }" title="Add a node. Shortcut: Shift+A, or right-click empty space" @click="openAdder()">
                                    <i class="material-icons notranslate icon">add</i>Add node
                                </button>
                                <div class="tool" title="Fit view: show the whole graph (F)" @click="fit()"><i class="material-icons notranslate icon">fit_screen</i></div>
                                <div class="tool" title="Tidy layout: line the nodes up again" @click="tidy()"><i class="material-icons notranslate icon">auto_fix_high</i></div>
                                <div class="tool" title="Show the quick tour" @click="startTour()"><i class="material-icons notranslate icon">help_outline</i></div>
                            </div>
                            <div class="np-mat-canvas-hint">Drag from dot to dot to link nodes. Drag empty space to move around, scroll to zoom, F to see everything.</div>
                            <div class="np-minimap-host" ref="minimap"></div>
                            <div class="np-add" v-if="ui.adder.open" :style="{ left: ui.adder.x + 'px', top: ui.adder.y + 'px', maxHeight: ui.adder.height + 'px' }" @mousedown="adderKeep">
                                <div class="np-add-search">
                                    <i class="material-icons notranslate icon">search</i>
                                    <input type="text" ref="adderInput" v-model="ui.adder.query" placeholder="Search, e.g. noise, color, add" inputmode="search"
                                        autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="off" @input="adderTyped" @keydown="adderKey" @blur="closeAdder">
                                    <i class="material-icons notranslate icon np-add-close" title="Close" @click="closeAdder">clear</i>
                                </div>
                                <ul class="np-add-list" ref="adderList">
                                    <template v-for="group in adderGroups">
                                        <li class="np-add-group" :key="'g' + group.id">
                                            <i class="material-icons notranslate icon">{{ group.icon }}</i>
                                            <span>{{ group.label }}</span>
                                            <label>{{ group.help }}</label>
                                        </li>
                                        <li v-for="item in group.items" :key="item.type" class="np-add-item" :class="{ selected: !item.disabled && item.index === ui.adder.index, disabled: item.disabled }"
                                            :title="item.help" @mousemove="hover(item)" @click="pick(item)">
                                            <span class="np-add-name">{{ item.label }}</span>
                                            <span class="np-add-help">{{ item.disabled ? 'There can only be one ' + item.label + ' node' : item.help }}</span>
                                        </li>
                                    </template>
                                    <li v-if="adderGroups.length === 0" class="np-add-empty">No node matches "{{ ui.adder.query }}". Try a shorter word.</li>
                                </ul>
                                <div class="np-add-foot">Up and down to choose, Enter to add, Esc to close</div>
                            </div>
                            <div class="np-tour" v-if="step && !ui.adder.open">
                                <div class="np-tour-head">
                                    <b>{{ step.title }}</b>
                                    <span>{{ ui.tour + 1 }} of {{ steps.length }}</span>
                                </div>
                                <p>{{ step.text }}</p>
                                <div class="np-tour-buttons">
                                    <button type="button" class="minor" @click="endTour()">Skip the tour</button>
                                    <button type="button" v-if="ui.tour > 0" @click="tourBack()">Back</button>
                                    <button type="button" class="np-tour-next" @click="tourNext()">{{ ui.tour >= steps.length - 1 ? 'Done' : 'Next' }}</button>
                                </div>
                            </div>
                        </div>
                        <div class="np-mat-side" :class="{ 'np-tour-focus': tourFocus('side') }">
                            <div class="np-mat-preview-head">Preview</div>
                            <div ref="preview"></div>
                            <div class="np-mat-side-scroll">
                                <h3><i class="material-icons notranslate icon">{{ ui.side.icon }}</i>{{ ui.side.title }} <span class="np-mat-id" v-if="ui.side.id">{{ ui.side.id }}</span></h3>
                                <p class="np-mat-help" v-if="ui.side.help">{{ ui.side.help }}</p>
                                <div ref="form"></div>
                                <p class="np-mat-help" v-if="ui.side.mode === 'node' && ui.side.values">Values are used where nothing is linked. Leave one empty to use the default shown in gray.</p>
                                <p class="np-mat-help" v-if="ui.side.mode === 'material' && ui.params.length">Sliders shown on the effect:</p>
                                <ul class="np-mat-params" v-if="ui.side.mode === 'material' && ui.params.length">
                                    <li v-for="name in ui.params" :key="name">{{ name }}</li>
                                </ul>
                                <div class="np-mat-actions" v-if="ui.side.mode !== 'material'">
                                    <button type="button" v-if="ui.side.texture" @click="addTexture()"><i class="material-icons notranslate icon">add_photo_alternate</i> Add texture from file</button>
                                    <button type="button" v-if="ui.side.mode === 'node' && !ui.side.unknown" @click="duplicate()"><i class="material-icons notranslate icon">content_copy</i> Duplicate</button>
                                    <button type="button" @click="remove()"><i class="material-icons notranslate icon">delete</i> Delete</button>
                                </div>
                            </div>
                            <div class="np-mat-problems">
                                <ul>
                                    <li v-if="ui.problems.length === 0"><i class="material-icons notranslate icon np-ok">check_circle</i><span>No problems.</span></li>
                                    <li v-for="(problem, i) in ui.problems" :key="i" :class="{ 'np-clickable': !!problem.node }" @click="focusProblem(problem)">
                                        <i class="material-icons notranslate icon" :class="problem.severity === 'hint' ? 'np-hint' : 'np-error'">{{ problem.severity === 'hint' ? 'info' : 'error' }}</i>
                                        <span><b v-if="problem.where">{{ problem.where }}: </b>{{ problem.message }}</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div class="np-mat-status" :class="{ 'np-tour-focus': tourFocus('status') }">
                        <div class="np-mat-meter" :class="{ over: ui.cost > ui.costLimit }" :title="ui.outline ? 'The outline runs the graph 5 times, so the cost includes that' : 'Estimated operations per pixel'">
                            <span>Cost {{ ui.costEstimate ? 'about ' : '' }}{{ ui.cost }} / {{ ui.costLimit }}</span>
                            <div class="np-mat-bar"><div :style="{ width: percent(ui.cost, ui.costLimit) }"></div></div>
                        </div>
                        <div class="np-mat-meter" :class="{ over: ui.samples > ui.samplesLimit }" title="Texture reads per pixel">
                            <span>Texture reads {{ ui.samples }} / {{ ui.samplesLimit }}</span>
                        </div>
                        <div class="np-mat-meter" :class="{ over: ui.nodes > ui.nodesLimit }">
                            <span>Nodes {{ ui.nodes }} / {{ ui.nodesLimit }}</span>
                        </div>
                        <div class="np-mat-meter" v-if="!ui.engine"><span>This graph couldn't be checked. Close it and open it again.</span></div>
                        <div class="np-mat-legend" title="The color of a dot shows what kind of value it gives or takes. Hover a dot to read it.">
                            <span>Dots:</span>
                            <span><i class="np-socket np-legend-dot np-socket-float"></i>number</span>
                            <span><i class="np-socket np-legend-dot np-socket-vec2"></i>2D vector</span>
                            <span><i class="np-socket np-legend-dot np-socket-vec3"></i>3D vector</span>
                            <span><i class="np-socket np-legend-dot np-socket-vec4"></i>color</span>
                            <span><i class="np-socket np-legend-dot np-socket-slot"></i>palette color</span>
                            <span><i class="np-socket np-legend-dot np-socket-number"></i>takes several kinds</span>
                            <span><i class="np-socket np-legend-dot np-socket-any"></i>takes anything</span>
                        </div>
                    </div>
                </div>
            `,
        }

        this.dialog = new Dialog({
            id: DIALOG_ID,
            title: this.options.title,
            width: Math.max(760, Math.min(window.innerWidth - 60, 1500)),
            resizable: 'x',
            ...dialogButtons('Done'),
            cancel_on_click_outside: false,
            component: component as any,
            onOpen: () => {
                this.fitHeight()
                setTimeout(() => {
                    this.fitHeight()
                    this.refit()
                }, 50)
            },
            onButton: () => {
                setTimeout(() => this.teardown(), 0)
            },
        } as any)
        this.dialog.show()
        this.dialog.object?.addEventListener('keydown', (event) => this.keydown(event))
        window.addEventListener('resize', this.resized)
        const root = this.dialog.object?.querySelector('.np-mat-root')
        if (root && typeof ResizeObserver !== 'undefined') {
            this.footerWatch = new ResizeObserver(this.resized)
            const footer = root.querySelector('.np-mat-status')
            if (footer) this.footerWatch.observe(footer)
            const handle = this.dialog.object?.querySelector('.dialog_handle')
            if (handle) this.footerWatch.observe(handle)
        }
        this.keyHook = Blockbench.on('press_key', (data: { input_in_focus?: HTMLElement, event: KeyboardEvent, capture: () => void }) => this.pressKey(data))
        if (!tourSeen()) ui.tour = 0
        return { close: () => this.close() }
    }

    private fitHeight() {
        const object = this.dialog?.object
        const root = object?.querySelector('.np-mat-root') as HTMLElement | null
        if (this.closed || !object || !root) return
        const wrapper = (globalThis as any).Interface?.page_wrapper as HTMLElement | undefined
        const bottom = Math.min(window.innerHeight, wrapper?.clientHeight ? wrapper.clientHeight + DIALOG_TOP : window.innerHeight)
        const room = bottom - DIALOG_TOP - 2 * DIALOG_MARGIN
        const handle = object.querySelector('.dialog_handle') as HTMLElement | null
        const bar = object.querySelector('.dialog_bar.button_bar') as HTMLElement | null
        const barStyle = bar ? getComputedStyle(bar) : null
        const barHeight = bar && barStyle ? bar.offsetHeight + (parseFloat(barStyle.marginTop) || 0) + (parseFloat(barStyle.marginBottom) || 0) : 0
        let height = Math.max(MIN_BODY_HEIGHT, Math.floor(room - (handle?.offsetHeight ?? 0) - barHeight))
        root.style.height = `${height}px`
        const place = () => {
            const total = (handle?.offsetHeight ?? 0) + root.offsetHeight + barHeight
            object.style.top = `${Math.max(DIALOG_TOP, Math.round(DIALOG_TOP + DIALOG_MARGIN + (room - total) / 2))}px`
        }
        place()
        const limit = bottom - DIALOG_MARGIN
        const end = Math.max(root.getBoundingClientRect().bottom + barHeight, bar ? bar.getBoundingClientRect().bottom + (parseFloat(barStyle?.marginBottom ?? '0') || 0) : 0)
        const over = Math.ceil(end - limit)
        if (over > 0 && height - over >= MIN_BODY_HEIGHT) {
            height -= over
            root.style.height = `${height}px`
            place()
        }
    }

    mount(canvasHost: HTMLElement, formHost: HTMLElement, previewHost?: HTMLElement, minimapHost?: HTMLElement) {
        this.formHost = formHost
        if (previewHost) {
            try {
                this.preview = new MaterialPreview(previewHost)
            } catch (error) {
                console.error('[polyplus_nameplate] material preview failed to start', error)
            }
        }
        formHost.addEventListener('focusout', () => this.flushForm())
        formHost.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.stopPropagation()
                this.flushForm()
            }
        })
        this.canvas = new MaterialCanvas(canvasHost, {
            check: (source, target, socket) => {
                this.flushForm()
                return checkLink(this.graph, this.validation?.analysis ?? validateMaterial(this.graph, this.context).analysis, source, target, socket)
            },
            linksChanged: (links) => this.edit((graph) => setLinks(graph, links)),
            select: (ids) => this.setSelection(ids),
            moved: (id, position) => this.place(id, position),
            menu: (event, target) => this.menu(event, target),
        })
        this.stage?.addEventListener('pointerdown', this.userMoved, true)
        this.stage?.addEventListener('wheel', this.userMoved, { capture: true, passive: true })
        if (typeof ResizeObserver !== 'undefined') {
            this.canvasWatch = new ResizeObserver(() => this.refit())
            this.canvasWatch.observe(canvasHost)
        }
        if (minimapHost) {
            try {
                const element = document.createElement('canvas')
                element.className = 'np-minimap np-minimap-hidden'
                minimapHost.append(element)
                this.minimap = new Minimap(element, this.canvas)
            } catch (error) {
                console.error('[polyplus_nameplate] node map failed to start', error)
            }
        }
        this.refresh()
    }

    openAdder(client?: { x: number, y: number }) {
        const stage = this.stage
        if (this.closed || !stage) return
        this.flushForm()
        const rect = stage.getBoundingClientRect()
        const height = Math.max(160, Math.min(ADDER_HEIGHT, rect.height - 2 * ADDER_GAP))
        let x = 56
        let y = 44
        if (client && this.canvas) {
            x = client.x - rect.left
            y = client.y - rect.top
            this.adderAt = this.canvas.screenToWorld(client.x, client.y)
        } else {
            this.adderAt = null
        }
        x = Math.max(ADDER_GAP, Math.min(x, rect.width - ADDER_WIDTH - ADDER_GAP))
        y = Math.max(ADDER_GAP, Math.min(y, rect.height - height - ADDER_GAP))
        Object.assign(this.ui.adder, { open: true, query: '', index: 0, x: Math.round(x), y: Math.round(y), height: Math.round(height) })
        this.vm?.$nextTick(() => {
            const input = this.vm?.$refs.adderInput as HTMLInputElement | undefined
            input?.focus()
        })
    }

    closeAdder() {
        if (!this.ui.adder.open) return
        this.ui.adder.open = false
        this.adderAt = null
    }

    addFromAdder(type: string) {
        const at = this.adderAt ?? undefined
        this.closeAdder()
        this.addNode(type, at)
    }

    private keydown(event: KeyboardEvent) {
        if (isTypingTarget(event.target)) {
            if (event.key === 'Enter') event.stopPropagation()
            return
        }
        if (this.handleKey(event) || event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
        }
    }

    private pressKey(data: { input_in_focus?: HTMLElement, event: KeyboardEvent, capture: () => void }) {
        if (this.closed || !this.dialog || Dialog.open !== this.dialog || data.input_in_focus || isTypingTarget(data.event.target)) return
        if (this.handleKey(data.event)) data.capture()
    }

    private handleKey(event: KeyboardEvent): boolean {
        const ctrl = event.ctrlKey || event.metaKey
        const key = event.key.toLowerCase()
        if (event.shiftKey && !ctrl && !event.altKey && key === 'a') this.openAdder()
        else if (key === 'delete' || key === 'backspace') this.deleteSelected()
        else if (ctrl && key === 'z' && !event.shiftKey) this.undo(false)
        else if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) this.undo(true)
        else if (ctrl && key === 'd') this.duplicateSelected()
        else if (!ctrl && !event.altKey && key === 'f') void this.canvas?.fit()
        else return false
        return true
    }

    private undo(redo: boolean) {
        this.flushForm()
        if (typeof Undo === 'undefined' || !Undo) return
        if (redo) Undo.redo()
        else Undo.undo()
    }

    edit(change: (graph: MaterialJson) => void | false): boolean {
        if (this.closed) return false
        return commitGraph(this.session, change)
    }

    refresh() {
        if (this.closed) return
        const graph = this.graph
        this.validation = validateMaterial(graph, this.context)
        const validation = this.validation
        this.selected = this.selected.filter((id) => !!findNode(graph, id))
        this.updateUi(validation)
        this.updateSide()
        this.preview?.update(cloneJson(graph), this.context)
        const canvas = this.canvas
        if (!canvas) return
        for (const [id, position] of layoutGraph(graph, this.positions)) if (!this.positions.has(id)) this.positions.set(id, position)
        const snapshot = cloneJson(graph)
        const positions = new Map(this.positions)
        const hooks = { edit: (id: string, key: string) => this.editValue(id, key), summary: (node: NodeJson) => this.summary(node) }
        this.queue = this.queue
            .then(() => canvas.show(snapshot, validation, positions, hooks))
            .then(() => canvas.select(this.selected))
            .then(() => this.fitFirst(canvas))
            .catch((error) => console.error('[polyplus_nameplate] material editor view failed', error))
    }

    private readonly userMoved = () => {
        this.autoFit = false
    }

    private refit() {
        if (this.closed || !this.autoFit || this.refitQueued) return
        this.refitQueued = true
        requestAnimationFrame(() => {
            this.refitQueued = false
            const canvas = this.canvas
            if (this.closed || !this.autoFit || !canvas) return
            this.queue = this.queue
                .then(() => (this.autoFit && this.canvas === canvas ? canvas.fit() : undefined))
                .catch((error) => console.error('[polyplus_nameplate] fitting the node view failed', error))
        })
    }

    private async fitFirst(canvas: MaterialCanvas) {
        if (this.fitted) return
        for (let tries = 0; tries < 120 && !canvas.hasSize() && !this.closed; tries++) {
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
        }
        if (this.closed || this.canvas !== canvas || !canvas.hasSize()) return
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
        await canvas.fit()
        this.fitted = true
    }

    private updateUi(validation: Validation) {
        const graph = this.graph
        this.ui.revision++
        const names = new Map(nodesOf(graph).map((node) => [node.id, specOf(String(node.type))?.label ?? String(node.type)]))
        const ordered = [...validation.problems].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
        this.ui.problems = ordered.map((problem: Problem) => ({
            node: problem.node,
            message: problem.message,
            severity: problem.severity,
            where: problem.node ? names.get(problem.node) ?? problem.node : problem.field && !problem.field.startsWith('nodes') ? 'Graph' : '',
        }))
        this.ui.cost = validation.cost
        this.ui.costEstimate = validation.costSource === 'estimate'
        this.ui.samples = validation.samples
        this.ui.nodes = validation.nodes
        this.ui.engine = validation.engine
        this.ui.empty = nodesOf(graph).length === 0
        this.ui.outline = validation.analysis.outline
        this.ui.params = materialParams(graph)
    }

    private setSelection(ids: string[]) {
        const same = ids.length === this.selected.length && ids.every((id, i) => id === this.selected[i])
        if (same) return
        this.flushForm()
        this.selected = ids
        this.updateSide()
    }

    private updateSide() {
        const graph = this.graph
        const side = this.ui.side
        if (this.selected.length > 1) {
            Object.assign(side, { mode: 'many', title: `${this.selected.length} nodes selected`, id: '', help: 'Press Delete to remove them.', icon: 'select_all', count: this.selected.length, unknown: false, texture: false, values: false })
            this.buildForm(null, {})
            return
        }
        const node = this.selected.length === 1 ? findNode(graph, this.selected[0]) : null
        if (node) {
            const spec = specOf(String(node.type))
            Object.assign(side, {
                mode: 'node',
                title: spec ? spec.label : `Unknown node '${node.type}'`,
                id: node.id,
                help: spec ? spec.help : 'This node type is unknown. Delete it, or update the plugin.',
                icon: spec ? GROUPS.find((group) => group.id === spec.group)?.icon ?? 'circle' : 'help_outline',
                count: 1,
                unknown: !spec,
                texture: !!textureAdder && node.type === 'BundleTexture',
                values: !!spec && spec.sockets.length > 0,
            })
            this.buildForm(node.id, spec ? this.nodeConfig(node.id, spec) : {})
            return
        }
        Object.assign(side, {
            mode: 'material',
            title: 'Graph',
            id: '',
            help: 'Settings for the whole effect. Click a node to change that node.',
            icon: 'tune',
            count: 0,
            unknown: false,
            texture: false,
            values: false,
        })
        this.buildForm(MATERIAL_TARGET, this.materialConfig())
    }

    private slotOptions(tones: boolean, current: unknown): Record<string, string> {
        const options: Record<string, string> = {}
        for (const slot of this.context.slots) {
            const name = slot.name ?? slot.id
            options[slot.id] = tones && slot.ramp.length > 1 ? `${name}, shade 1` : name
            if (tones) for (let i = 1; i < slot.ramp.length; i++) options[`${slot.id}[${i}]`] = `${name}, shade ${i + 1}`
        }
        if (typeof current === 'string' && current && !(current in options)) options[current] = `${current} (not in the palette)`
        return options
    }

    private listOptions(values: string[], current: unknown): Record<string, string> {
        const options: Record<string, string> = {}
        for (const value of values) options[value] = value
        if (typeof current === 'string' && current && !(current in options)) options[current] = `${current} (missing)`
        return options
    }

    private settingField(setting: SettingSpec, value: unknown): FormElementOptions {
        const description = setting.help
        switch (setting.kind) {
            case 'int':
                return { label: setting.label, type: 'number', value: typeof value === 'number' ? value : setting.fallback, min: setting.min, max: setting.max, step: 1, description }
            case 'pair':
                return {
                    label: setting.label,
                    type: 'vector',
                    dimensions: 2,
                    value: Array.isArray(value) && value.length === 2 ? value : setting.fallback,
                    min: setting.min,
                    max: setting.max,
                    step: 1,
                    linked_ratio: false,
                    description,
                }
            case 'choice':
                return { label: setting.label, type: 'select', options: typeof value === 'string' && !(value in setting.options) ? { ...setting.options, [value]: `${value} (unknown)` } : setting.options, value: typeof value === 'string' ? value : setting.fallback, description }
            case 'slot': {
                const options = this.slotOptions(setting.tones, value)
                return { label: setting.label, type: 'select', options, value: typeof value === 'string' ? value : Object.keys(options)[0] ?? '', description }
            }
            case 'text':
                return { label: setting.label, type: 'text', value: typeof value === 'string' ? value : '', placeholder: setting.placeholder, description }
            case 'param':
                return { label: setting.label, type: 'text', value: typeof value === 'string' ? value : '', placeholder: 'speed', list: this.ui.params, description }
            case 'values':
                return { label: setting.label, type: 'text', value: formatLiteral(value ?? setting.fallback), placeholder: '0.5', description }
            case 'sprite':
                return this.pickField(setting.label, value, Object.keys(this.context.sprites), 'sprite id', 'Paint a sprite layer in the nameplate first, then pick it here', description)
            case 'texture':
                return this.pickField(setting.label, value, Object.keys(this.context.textures), 'texture id', 'Add a texture to the project first, then pick it here', description)
        }
    }

    private pickField(label: string, value: unknown, ids: string[], placeholder: string, emptyHelp: string, description: string | undefined): FormElementOptions {
        if (!ids.length) return { label, type: 'text', value: typeof value === 'string' ? value : '', placeholder, description: emptyHelp }
        return { label, type: 'select', options: this.listOptions(ids, value), value: typeof value === 'string' ? value : ids[0], description }
    }

    private nodeConfig(id: string, spec: NodeSpec): FormConfig {
        const node = findNode(this.graph, id)
        const set = node ? nodeSettings(node) : {}
        const inputs = node ? nodeInputs(node) : {}
        const config: FormConfig = {}
        for (const setting of spec.settings) config[setting.key] = this.settingField(setting, set[setting.key])
        if (spec.settings.length && spec.sockets.length) config._values = '_'
        for (const socket of spec.sockets) {
            const value = inputs[socket.name]
            if (typeof value === 'string') {
                const source = findNode(this.graph, value)
                const name = source ? specOf(String(source.type))?.label ?? String(source.type) : value
                config[SOCKET_PREFIX + socket.name] = {
                    label: socket.label,
                    type: 'text',
                    value: `Linked from ${name}`,
                    readonly: true,
                    description: 'This value comes from the linked node. Remove the link to type a value here',
                }
            } else {
                config[SOCKET_PREFIX + socket.name] = {
                    label: socket.label,
                    type: 'text',
                    value: formatLiteral(value),
                    placeholder: fallbackText(socket.fallback),
                    description: valueHelp(socket),
                }
            }
        }
        if (!spec.settings.length && !spec.sockets.length && !spec.source) config._none = { type: 'info', text: 'This node has no settings. Link its dot into other nodes.' }
        if (spec.source) config._source = { type: 'info', text: 'Link the node to work out again into the Source dot.' }
        return config
    }

    private summary(node: NodeJson): string {
        const spec = specOf(String(node.type))
        if (!spec) return ''
        const set = nodeSettings(node)
        const parts: string[] = []
        for (const setting of spec.settings) {
            const value = set[setting.key]
            switch (setting.kind) {
                case 'values':
                    parts.push(formatLiteral(value ?? setting.fallback))
                    break
                case 'slot':
                    parts.push(typeof value === 'string' && value ? this.slotOptions(true, value)[value] : 'no color picked')
                    break
                case 'choice': {
                    const chosen = typeof value === 'string' ? value : setting.fallback
                    parts.push(setting.options[chosen] ?? chosen)
                    break
                }
                case 'int':
                    if (typeof value === 'number' && (setting.required || value !== setting.fallback)) parts.push(`${setting.label} ${value}`)
                    break
                case 'pair':
                    if (Array.isArray(value) && value.length === 2 && (value[0] !== setting.fallback[0] || value[1] !== setting.fallback[1])) parts.push(`${setting.label} ${value.join(', ')}`)
                    break
                default:
                    parts.push(typeof value === 'string' && value ? value : 'not set')
            }
        }
        return parts.join(', ') || 'Default settings'
    }

    editValue(id: string, key: string) {
        if (this.closed || !findNode(this.graph, id)) return
        this.flushForm()
        if (this.selected.length !== 1 || this.selected[0] !== id) {
            void this.selectOnly(id)
        }
        setTimeout(() => {
            const host = this.formHost
            if (!host || this.closed) return
            const scope = key ? host.querySelector(`.form_bar_${SOCKET_PREFIX}${CSS.escape(key)}`) : host
            const field = scope?.querySelector('input:not([readonly]), select, textarea') as HTMLInputElement | null
            if (!field) return
            field.scrollIntoView({ block: 'nearest' })
            field.focus()
            if (field.tagName === 'INPUT') field.select()
        }, 30)
    }

    private materialConfig(): FormConfig {
        const graph = this.graph
        const margins = Array.isArray(graph.margins) && graph.margins.length === 4 ? graph.margins : [0, 0, 0, 0]
        const outlineOptions: Record<string, string> = { '': 'None', ...this.slotOptions(true, graph.outline) }
        return {
            resolution: {
                label: 'Resolution',
                type: 'select',
                options: { pixel: 'Pixel (whole pixels)', smooth: 'Smooth (for light and glows)' },
                value: typeof graph.resolution === 'string' ? graph.resolution : 'pixel',
                description: 'Pixel suits pixel art. Smooth suits soft light',
            },
            margins: {
                label: 'Reach',
                type: 'vector',
                dimensions: 4,
                value: margins,
                min: 0,
                max: 32,
                step: 1,
                linked_ratio: false,
                description: 'Left, top, right, bottom, in px (0 to 32)',
            },
            outline: {
                label: 'Outline',
                type: 'select',
                options: outlineOptions,
                value: typeof graph.outline === 'string' ? graph.outline : '',
                description: 'Draws this color around covered pixels. It runs the graph 5 times, so it costs 5 times as much',
            },
            emissive: {
                label: 'Glows in the dark',
                type: 'checkbox',
                value: graph.emissive === true,
                description: 'Ignore world lighting, like a light source',
            },
        }
    }

    private buildForm(target: string | null, config: FormConfig) {
        const host = this.formHost
        if (!host) return
        const fields = Object.entries(config).filter((entry): entry is [string, FormElementOptions] => typeof entry[1] === 'object')
        const keys = `${target}|${JSON.stringify(fields.map(([key, value]) => [key, value.type, value.label, value.options, value.text, value.readonly, value.placeholder]))}`
        const values: Record<string, any> = {}
        for (const [key, value] of fields) if (value.value !== undefined) values[key] = value.value
        if (this.form && this.formTarget === target && this.formKeys === keys) {
            if (!this.pending) this.form.setValues(values, false)
            return
        }
        this.form?.delete()
        this.form = null
        this.formTarget = target
        this.formKeys = keys
        host.innerHTML = ''
        if (!target || Object.keys(config).length === 0) return
        const form = new InputForm(config)
        form.on('change', (data: any) => {
            if (data?.cause !== 'input' && data?.cause !== 'update_toggle') return
            const changed: string[] = data.changed_keys ?? []
            const result = data.result ?? {}
            this.queueForm(target, Object.fromEntries(changed.filter((key) => !key.startsWith('_')).map((key) => [key, result[key]])))
        })
        host.append(form.node)
        this.form = form
    }

    private queueForm(target: string, values: Record<string, unknown>) {
        if (!Object.keys(values).length) return
        if (this.pending && this.pending.target !== target) this.flushForm()
        this.pending = { target, values: { ...(this.pending?.values ?? {}), ...values } }
        if (this.formTimer) clearTimeout(this.formTimer)
        this.formTimer = setTimeout(() => this.flushForm(false), FORM_DELAY)
    }

    private badNumber(target: string, key: string, raw: unknown): boolean {
        if (target === MATERIAL_TARGET) return false
        const node = findNode(this.graph, target)
        const spec = node ? specOf(String(node.type)) : null
        if (!spec) return false
        const numeric = key.startsWith(SOCKET_PREFIX)
            ? spec.sockets.some((socket) => SOCKET_PREFIX + socket.name === key)
            : spec.settings.some((setting) => setting.key === key && setting.kind === 'values')
        return numeric && parseLiteral(String(raw ?? '')) === null
    }

    flushForm(final = true) {
        if (this.formTimer) clearTimeout(this.formTimer)
        this.formTimer = null
        const pending = this.pending
        this.pending = null
        if (!pending) return
        const bad = Object.keys(pending.values).filter((key) => this.badNumber(pending.target, key, pending.values[key]))
        const values = Object.fromEntries(Object.entries(pending.values).filter(([key]) => !bad.includes(key)))
        if (bad.length && !final) this.pending = { target: pending.target, values: Object.fromEntries(bad.map((key) => [key, pending.values[key]])) }
        if (Object.keys(values).length) {
            if (pending.target === MATERIAL_TARGET) {
                this.edit((graph) => this.applyMaterial(graph, values))
            } else {
                this.edit((graph) => this.applyNode(graph, pending.target, values))
            }
        }
        if (bad.length && final) {
            Blockbench.showQuickMessage(BAD_NUMBER, 2500)
            this.updateSide()
        }
    }

    private applyMaterial(graph: MaterialJson, values: Record<string, unknown>) {
        for (const [key, value] of Object.entries(values)) {
            const present = Object.prototype.hasOwnProperty.call(graph, key)
            switch (key) {
                case 'resolution':
                    if (present || value !== 'pixel') setMaterial(graph, key, value)
                    break
                case 'margins': {
                    const margins = Array.isArray(value) ? value.map((entry) => Math.max(0, Math.min(32, Math.round(Number(entry) || 0)))) : [0, 0, 0, 0]
                    if (present || margins.some((entry) => entry !== 0)) setMaterial(graph, key, margins)
                    break
                }
                case 'outline':
                    setMaterial(graph, key, typeof value === 'string' && value ? value : undefined)
                    break
                case 'emissive':
                    if (present || value === true) setMaterial(graph, key, value === true)
                    break
            }
        }
    }

    private applyNode(graph: MaterialJson, id: string, values: Record<string, unknown>) {
        const node = findNode(graph, id)
        const spec = node ? specOf(String(node.type)) : null
        if (!node || !spec) return false
        const set = nodeSettings(node)
        for (const [key, raw] of Object.entries(values)) {
            if (key.startsWith(SOCKET_PREFIX)) {
                const socket = spec.sockets.find((entry) => SOCKET_PREFIX + entry.name === key)
                if (!socket || typeof nodeInputs(node)[socket.name] === 'string') continue
                const literal = parseLiteral(String(raw ?? ''))
                if (literal !== null) setInput(graph, id, socket.name, literal)
                continue
            }
            const setting = spec.settings.find((entry) => entry.key === key)
            if (!setting) continue
            const present = Object.prototype.hasOwnProperty.call(set, key)
            switch (setting.kind) {
                case 'int': {
                    const value = Math.max(setting.min, Math.min(setting.max, Math.round(Number(raw))))
                    if (!Number.isFinite(value)) break
                    if (present || setting.required || value !== setting.fallback) setSetting(graph, id, key, value)
                    break
                }
                case 'pair': {
                    const pair = Array.isArray(raw) ? raw.slice(0, 2).map((entry) => Math.max(setting.min, Math.min(setting.max, Math.round(Number(entry) || 0)))) : setting.fallback
                    if (present || pair[0] !== setting.fallback[0] || pair[1] !== setting.fallback[1]) setSetting(graph, id, key, pair)
                    break
                }
                case 'choice':
                    if (present || raw !== setting.fallback) setSetting(graph, id, key, String(raw))
                    break
                case 'param': {
                    const name = sanitizeName(String(raw ?? ''))
                    setSetting(graph, id, key, name || undefined)
                    break
                }
                case 'values': {
                    const literal = parseLiteral(String(raw ?? ''))
                    if (literal !== null) setSetting(graph, id, key, literal)
                    break
                }
                default: {
                    const text = String(raw ?? '').trim()
                    setSetting(graph, id, key, text || undefined)
                }
            }
        }
    }

    private defaultSettings(spec: NodeSpec): Record<string, unknown> {
        const settings: Record<string, unknown> = {}
        for (const setting of spec.settings) {
            switch (setting.kind) {
                case 'slot':
                    if (this.context.slots[0]) settings.slot = this.context.slots[0].id
                    break
                case 'int':
                    if (setting.required) settings[setting.key] = spec.type === 'Repeat' ? 4 : setting.fallback
                    break
                case 'param': {
                    const taken = new Set(this.ui.params)
                    let name = 'amount'
                    for (let i = 2; taken.has(name); i++) name = `amount_${i}`
                    settings[setting.key] = name
                    break
                }
                case 'text':
                    if (setting.required && setting.placeholder) settings[setting.key] = setting.placeholder
                    break
                case 'sprite': {
                    const first = Object.keys(this.context.sprites)[0]
                    if (first) settings[setting.key] = first
                    break
                }
                case 'texture': {
                    const first = Object.keys(this.context.textures)[0]
                    if (first) settings[setting.key] = first
                    break
                }
                case 'choice':
                    if (spec.type === 'VanillaTexture') settings[setting.key] = Object.keys(VANILLA_TEXTURES)[0]
                    break
            }
        }
        return settings
    }

    addNode(type: string, at?: Position) {
        const spec = specOf(type)
        if (!spec || !canAdd(this.graph, type)) return
        this.flushForm()
        const position = this.freeSpotFor(type, at ?? this.canvas?.viewCenter() ?? { x: 0, y: 0 })
        let added = ''
        const done = this.edit((graph) => {
            added = addNode(graph, type, this.defaultSettings(spec))
            this.place(added, position)
        })
        if (done && added) {
            this.selected = [added]
            this.updateSide()
            this.refresh()
        }
    }

    private freeSpotFor(type: string, start: Position): Position {
        const shown = this.canvas?.positions()
        const boxes = nodesOf(this.graph)
            .map((node) => {
                const position = shown?.get(node.id) ?? this.positions.get(node.id)
                return position ? nodeBox(node, position) : null
            })
            .filter((box): box is Box => !!box)
        return freeSpot(boxes, nodeBox({ id: '', type }, start))
    }

    deleteSelected() {
        const ids = [...this.selected]
        if (!ids.length) return
        this.flushForm()
        if (this.edit((graph) => removeNodes(graph, ids))) {
            this.selected = []
            this.updateSide()
        }
    }

    duplicateSelected() {
        const id = this.selected[0]
        if (!id || this.selected.length !== 1) return
        const node = findNode(this.graph, id)
        if (!node || !canAdd(this.graph, String(node.type))) return
        this.flushForm()
        let copy: string | null = null
        const origin = this.canvas?.positions().get(id) ?? this.positions.get(id) ?? { x: 0, y: 0 }
        this.edit((graph) => {
            copy = duplicateNode(graph, id)
            if (copy) this.place(copy, { x: origin.x + 30, y: origin.y + 30 })
        })
        if (copy) {
            this.selected = [copy]
            this.updateSide()
            this.refresh()
        }
    }

    addTexture() {
        const adder = textureAdder
        const target = this.selected.length === 1 ? this.selected[0] : null
        if (!adder || !target) return
        this.flushForm()
        ;(Blockbench as any).import({ extensions: ['png'], type: 'PNG texture', readtype: 'binary', multiple: false }, (files: Array<{ name: string, content: ArrayBuffer | string }>) => {
            const file = files?.[0]
            if (!file || typeof file.content === 'string') return
            const id = sanitizeId(pictureStem(file.name)) || 'texture'
            if (!adder(id, new Uint8Array(file.content))) {
                Blockbench.showQuickMessage('That file is not a PNG picture', 2500)
                return
            }
            this.context = editorContext(this.options)
            if (!this.edit((graph) => setSetting(graph, target, 'texture', id))) this.refresh()
        })
    }

    focusNode(id: string) {
        this.autoFit = false
        void this.selectOnly(id).then(() => this.canvas?.fit([id]))
    }

    private async selectOnly(id: string) {
        this.selected = [id]
        this.updateSide()
        await this.canvas?.select([id])
    }

    tidy() {
        const fresh = layoutGraph(this.graph, new Map())
        for (const [id, position] of fresh) this.place(id, position)
        const canvas = this.canvas
        if (!canvas) return
        this.queue = this.queue
            .then(async () => {
                for (const [id, position] of fresh) await canvas.area.translate(id, position)
                await canvas.fit()
            })
            .catch((error) => console.error('[polyplus_nameplate] tidy failed', error))
    }

    private menu(event: MouseEvent, target: { kind: 'root' } | { kind: 'node', id: string } | { kind: 'link', link: Link }) {
        this.flushForm()
        if (target.kind === 'root') {
            this.openAdder({ x: event.clientX, y: event.clientY })
            return
        }
        if (target.kind === 'link') {
            const { link } = target
            new Menu([{ name: 'Remove link', icon: 'link_off', click: () => this.edit((graph) => setInput(graph, link.target, link.socket, undefined)) }]).open(event as any)
            return
        }
        if (!this.selected.includes(target.id)) {
            void this.selectOnly(target.id)
        }
        const node = findNode(this.graph, target.id)
        const known = !!node && !!specOf(String(node.type))
        new Menu([
            ...(known && this.selected.length === 1 ? [{ name: 'Duplicate', icon: 'content_copy', click: () => this.duplicateSelected() }] : []),
            {
                name: 'Remove links',
                icon: 'link_off',
                click: () => this.edit((graph) => {
                    const own = findNode(graph, target.id)
                    if (!own) return false
                    for (const [key, value] of Object.entries(own.in ?? {})) if (typeof value === 'string') setInput(graph, target.id, key, undefined)
                    if (typeof own.set?.source === 'string') setInput(graph, target.id, SOURCE_SOCKET, undefined)
                    for (const other of nodesOf(graph)) {
                        for (const [key, value] of Object.entries(other.in ?? {})) if (value === target.id) setInput(graph, other.id, key, undefined)
                        if (other.set?.source === target.id) setInput(graph, other.id, SOURCE_SOCKET, undefined)
                    }
                }),
            },
            { name: this.selected.length > 1 ? 'Delete nodes' : 'Delete', icon: 'delete', click: () => this.deleteSelected() },
        ]).open(event as any)
    }

    close() {
        if (this.closed) return
        this.flushForm()
        if (this.dialog && Dialog.open === this.dialog) this.dialog.close(0)
        else this.teardown()
    }

    private teardown() {
        if (this.closed) return
        this.flushForm()
        this.closed = true
        this.keyHook?.delete()
        this.keyHook = null
        window.removeEventListener('resize', this.resized)
        this.footerWatch?.disconnect()
        this.footerWatch = null
        this.canvasWatch?.disconnect()
        this.canvasWatch = null
        this.stage?.removeEventListener('pointerdown', this.userMoved, true)
        this.stage?.removeEventListener('wheel', this.userMoved, true)
        closeSession(this.session)
        const positions = this.canvas?.positions()
        if (positions) {
            for (const [id, position] of positions) {
                const known = this.positions.get(id)
                if (!known || known.x !== position.x || known.y !== position.y) this.place(id, position)
            }
        }
        this.saveLayout()
        this.form?.delete()
        this.form = null
        this.preview?.destroy()
        this.preview = null
        this.minimap?.destroy()
        this.minimap = null
        this.canvas?.destroy()
        this.canvas = null
        this.vm = null
        this.stage = null
        if (this.dialog) {
            if (Dialog.open === this.dialog) this.dialog.hide()
            this.dialog.delete()
            this.dialog = null
        }
        if (current === this) current = null
        try {
            this.options.onClose?.()
        } catch (error) {
            console.error('[polyplus_nameplate] material onClose failed', error)
        }
    }
}

export function openMaterialEditor(options: MaterialEditorOptions): MaterialEditorHandle {
    current?.close()
    const editor = new MaterialEditor(options)
    current = editor
    return editor.open()
}

export function closeMaterialEditor() {
    current?.close()
}

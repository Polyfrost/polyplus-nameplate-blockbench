import { limited, noteLimit } from '../elements/limits'
import { readSettings, scheduleOf, triggerOf } from '../animate/props'
import { layerNodes } from '../elements/nodes'
import { DEPTHS } from '../elements/read'
import { nameplateLimits } from '../engine'
import { BODY_TYPE, LOOP_ANIMATION, NameplateData } from '../model'
import { openMaterialEditor } from '../nodes'
import { commit, notifyNameplateChanged, readNameplate } from '../palette/state'
import { previewUi } from '../preview'
import { slotChoices, toneChoices } from '../palette/tones'
import { addStarterMaterial, materialChoices, STARTER_PREFIX } from '../material/actions'
import { curveImage, CurveSpec, effectInfoOf, EffectInfo, effectsView, paramCurve, sampleToneHint } from '../material/effects'
import { paramLabel } from '../material/params'
import { commitMaterials, materialsAspect, notifyMaterialsChanged, readMaterials, writeMaterials } from '../material/state'
import { blendOf, EFFECT_TYPE, guessRange, MAX_MARGIN, MaterialGraph, MaterialNode, MaterialsState, outputNode, paramNamesOf, ParamRange } from '../material/types'
import { custom, field, fixed, FormConfig, group, heading, Part, Values, when, withCurrent } from '../schema/form'
import { animationFrames } from '../util/animation'
import { cloneJson } from '../util/json'
import { round3Text } from '../util/num'
import { plural, pluralWord } from '../util/text'

type Result = Record<string, any>

const SLOT_NODES = new Set(['Slot'])
const RAMP_NODES = new Set(['Quantize', 'DitherQuantize', 'Cycle'])
const SLOT_READERS = new Set(['Slot', 'Quantize', 'DitherQuantize', 'Cycle', 'Sprite'])
const NEAR_LIMIT = 0.75
const MERGE_MS = 800
const NEW_PARAM: ParamRange = { label: '', min: 0, max: 2, step: 0.05 }
const PARAM_KEY = 'param__'
const SLIDER_ADVICE = 'To go further, change the slider range in Shared Numbers, or type the number there.'

let lastEdit: { key: string, at: number, index: number } | null = null

function graphOf(node: any, state: MaterialsState = readMaterials()): MaterialGraph | undefined {
    return typeof node?.material === 'string' ? state.graphs[node.material] : undefined
}

function edit(node: any, state: MaterialsState | undefined, change: (graph: MaterialGraph, state: MaterialsState) => void) {
    if (!state) return
    const graph = graphOf(node, state)
    if (graph) change(graph, state)
}

function bold(text: string): FormElementOptions {
    return { type: 'info', text: `**${text}**` }
}

function sharedCount(node: any): number {
    return layerNodes().filter((other) => other !== node && other.type === EFFECT_TYPE && other.material === node.material).length
}

function rangeOf(state: MaterialsState, name: string): ParamRange {
    return state.ranges[name] ?? guessRange(name, state.params[name] ?? 0)
}

function ownValue(name: string, plate: NameplateData = readNameplate()): { variant: string, value: number } | null {
    const variant = previewUi.variant
    const value = plate.variants[variant]?.params?.[name]
    return value === undefined ? null : { variant, value }
}

function sliderSpan(range: ParamRange, value: number): [number, number] {
    return [Math.min(range.min, value), Math.max(range.max, value)]
}

function dynamicInfo(text: string): FormElementOptions {
    return { type: 'info', text, options: { text } } as unknown as FormElementOptions
}

function readsSlots(graph: MaterialGraph, info: EffectInfo | null): boolean {
    if (info && info.toneSlots !== null) return info.toneSlots > 0
    return !!graph.outline || graph.nodes.some((entry) => SLOT_READERS.has(entry.type))
}

function statesText(info: EffectInfo): string {
    const limit = nameplateLimits().states
    const what = `This effect shows **${info.states}** different ${pluralWord(info.states, 'picture')}. The limit is ${limit}.${info.shotStates > 0 ? ` Its one-shots add ${info.shotStates} more.` : ''}`
    if (info.states > limit) return `${what} **Over the limit**: raise 'Hold each frame for', or use fewer keyframes on its settings.`
    if (info.states >= limit * NEAR_LIMIT) return `${what} **Close to the limit**: more keyframes on its settings, or a lower 'Hold each frame for', may push it over.`
    return what
}

function shownCurve(fps: number, loop: number): CurveSpec {
    const loopSpec: CurveSpec = { animation: LOOP_ANIMATION, kind: 'loop', length: loop }
    const open = typeof Animator !== 'undefined' && !!Animator && !!(Animator as any).open
    const animation = open && typeof BBAnimation !== 'undefined' ? (BBAnimation as any).selected : null
    const name = animation ? String(animation.name ?? '') : ''
    if (!animation || !name || name === LOOP_ANIMATION || scheduleOf(readSettings(animation))) return loopSpec
    const trigger = triggerOf(readSettings(animation))
    if (!trigger) return loopSpec
    if (trigger.kind === 'reaction' && trigger.on === 'while') return { animation: name, kind: 'while', reaction: trigger.reaction, length: loop }
    return { animation: name, kind: 'shot', length: animationFrames(animation, fps) }
}

function curveText(info: EffectInfo, name: string, fps: number, loop: number): string {
    const spec = shownCurve(fps, loop)
    const label = paramLabel(name)
    const values = paramCurve(info.layer, name, spec)
    const where = spec.kind === 'loop' ? 'over the loop' : `while '${spec.animation}' plays`
    if (!values || values.length === 0) return `**${label}** is animated.`
    const image = curveImage(values)
    const low = Math.min(...values)
    const high = Math.max(...values)
    const range = low === high ? `stays at ${round3Text(low)}` : `goes from ${round3Text(low)} to ${round3Text(high)}`
    return `**${label}** ${range} ${where}.${image ? `\n\n![${label}](${image})` : ''}`
}

function animatedConfig(config: FormConfig, graph: MaterialGraph, info: EffectInfo | null) {
    const reads = info ? info.reads : paramNamesOf(graph)
    if (reads.length === 0) return
    config.animate_title = bold('Animated settings')
    config.animate_note = { type: 'info', text: "To animate a setting, add keyframes on its 'Setting: ...' row in Animate. Random animations can't." }
    const view = effectsView()
    if (!info || !view) return
    for (const name of info.animated.filter((entry) => reads.includes(entry))) {
        config[`curve__${name}_note`] = dynamicInfo(curveText(info, name, view.fps, view.loop))
    }
    config.states_note = dynamicInfo(statesText(info))
}

function toneConfig(config: FormConfig, node: any, graph: MaterialGraph, info: EffectInfo | null) {
    if (readsSlots(graph, info)) return
    const hint = Array.isArray(graph.toneHint) ? graph.toneHint : []
    config.tone_title = bold('Name color')
    config.tone_note = hint.length > 0
        ? dynamicInfo(`The game picks a readable name color from these ${plural(hint.length, 'color')}:${hint.join(', ')}. Sample again after changing the effect's colors.`)
        : dynamicInfo('**Set the brightness hint so the game can pick a readable name color.**')
    config.tone_button = {
        type: 'buttons',
        buttons: [hint.length > 0 ? 'Sample again' : 'Set hint from the preview'],
        click: () => setToneHint(node),
    } as FormElementOptions
}


function setToneHint(node: any) {
    const material = typeof node?.material === 'string' ? node.material : ''
    if (!material) return
    let hint: string[] = []
    try {
        hint = sampleToneHint(material)
    } catch (error) {
        console.error('[polyplus_nameplate] sampling a tone hint failed', error)
    }
    if (hint.length === 0) {
        Blockbench.showQuickMessage('This effect draws nothing behind a short name yet, so there is nothing to sample.', 2500)
        return
    }
    commitMaterials('Set brightness hint', (state) => {
        const graph = state.graphs[material]
        if (graph) graph.toneHint = hint
    })
}

function colorLabels(colors: MaterialNode[]): Map<string, string> {
    const labels = new Map<string, string>()
    for (const word of ['Shades', 'Color']) {
        const group = colors.filter((entry) => RAMP_NODES.has(entry.type) === (word === 'Shades'))
        group.forEach((entry, index) => labels.set(entry.id, group.length > 1 ? `${word} ${index + 1}` : word))
    }
    return labels
}

export function effectKindInfo(node: any): { kind: string, label: string, icon: string } | null {
    return node?.type === EFFECT_TYPE ? { kind: 'effect', label: 'Effect', icon: 'auto_awesome' } : null
}

function hasGraph(node: any): boolean {
    return !!graphOf(node)
}

function gated(...parts: Part[]): Part {
    const inner = group(...parts)
    return { ...inner, config: (node) => (hasGraph(node) ? inner.config(node) : {}) }
}

function graphField(key: string, input: FormElementOptions | ((node: any) => FormElementOptions), get: (graph: MaterialGraph) => unknown, set?: (graph: MaterialGraph, value: any, result: Values) => void): Part {
    return field(key, {
        input,
        get: (node) => get(graphOf(node)!),
        set: set && ((node, value, result, state) => edit(node, state, (graph) => set(graph, value, result))),
    })
}

const materialField = field('material', {
    input: (node) => ({ type: 'select', label: 'Graph', options: materialChoices(node.material ?? ''), description: 'Pick a starter to make a new graph' }),
    get: (node) => node.material ?? '',
})

const ofField = field('of', {
    input: (node) => {
        const bodies: Record<string, string> = { '': 'The whole tag' }
        for (const body of layerNodes().filter((entry) => entry.type === BODY_TYPE)) bodies[body.uuid] = `Body: ${body.name}`
        return { type: 'select', label: 'Covers', options: withCurrent(bodies, node.of ?? '', 'Missing body') }
    },
    get: (node) => node.of ?? '',
    set: (node, value) => {
        node.of = String(value ?? '')
    },
})

const driftField = field('drift', {
    input: { type: 'checkbox', label: 'Drift (never repeats)', style: 'toggle_switch', value: false, description: 'Never jumps back to the start of the loop, for slow clouds or noise. On basic effects it stands still' } as any,
    get: (node) => node.drift === true,
    set: (node, value) => {
        node.drift = !!value
    },
})

const mirrorField = field('mirror', {
    input: { type: 'checkbox', label: 'Mirrored copy', style: 'toggle_switch', value: false, description: 'Draws a second copy flipped left to right. It only shows where the effect paints' } as any,
    get: (node) => node.mirror === true,
    set: (node, value) => {
        node.mirror = !!value
    },
})

const mirrorDelayField = field('mirror_delay', {
    input: { type: 'number', label: 'Copy starts late by (frames)', step: 1, value: 0, condition: (result: any) => !!result?.mirror, description: 'Hold each frame multiplies this' },
    get: (node) => Math.max(0, Math.round(Number(node.mirrorDelay) || 0)),
    set: (node, value) => {
        node.mirrorDelay = limited(value, 0, Infinity, node.mirrorDelay ?? 0, 'Copy starts late by')
    },
})

const mirrorSeedField = field('mirror_seed', {
    input: { type: 'checkbox', label: 'Copy has own timing', style: 'toggle_switch', value: false, condition: (result: any) => !!result?.mirror, description: 'Random animations only: the copy gets its own random times' } as any,
    get: (node) => node.mirrorSeed === true,
    set: (node, value) => {
        node.mirrorSeed = !!value
    },
})

const placed = custom(
    (key) => key === 'depth' || key === 'step',
    () => ({}),
    () => ({}),
    (node, key, result) => {
        if (key === 'depth' && DEPTHS.includes(result.depth)) node.depth = result.depth
        if (key === 'step') node.step = limited(result.step, 1, Infinity, node.step ?? 1, 'Hold each frame for')
    },
)

const elements = group(ofField, driftField, mirrorField, mirrorDelayField, mirrorSeedField, placed)

const resolutionField = graphField(
    'resolution',
    { type: 'select', label: 'Resolution', options: { pixel: 'Pixel: whole pixels, the same in every version', smooth: 'Smooth: soft light, full effects only' }, description: 'Pixel suits pixel-art patterns. Smooth suits glows' },
    (graph) => (graph.resolution === 'smooth' ? 'smooth' : 'pixel'),
    (graph, value) => {
        graph.resolution = value === 'smooth' ? 'smooth' : 'pixel'
    },
)

const blendField = graphField(
    'blend',
    { type: 'select', label: 'Blend', options: { alpha: 'Normal: covers what is behind', additive: 'Add light: brightens what is behind' } },
    blendOf,
    (graph, value) => {
        const output = outputNode(graph)
        if (!output) return
        const set = { ...(output.set ?? {}) }
        if (value === 'additive') set.blend = 'additive'
        else delete set.blend
        if (Object.keys(set).length > 0) output.set = set
        else delete output.set
    },
)

const emissiveField = graphField(
    'emissive',
    { type: 'checkbox', label: 'Glows in the dark', style: 'toggle_switch', value: false, description: 'Stays at full brightness in the dark' } as any,
    (graph) => graph.emissive === true,
    (graph, value) => {
        if (value) graph.emissive = true
        else delete graph.emissive
    },
)

const outlineField = graphField(
    'outline',
    (node) => {
        const graph = graphOf(node)!
        return { type: 'select', label: 'Outline', options: withCurrent({ '': 'No outline', ...toneChoices() }, graph.outline ?? '', `${graph.outline} (missing)`), description: 'Draws a 1-pixel edge in this color around the covered pixels' }
    },
    (graph) => graph.outline ?? '',
    (graph, value) => {
        if (value) graph.outline = String(value)
        else delete graph.outline
    },
)

function marginPair(graph: MaterialGraph, first: number, second: number): number[] {
    const margins = Array.isArray(graph.margins) ? graph.margins : [0, 0, 0, 0]
    return [margins[first] ?? 0, margins[second] ?? 0]
}

const marginXField = graphField(
    'margin_x',
    { type: 'vector', label: 'Reach left, right (px)', dimensions: 2, step: 1, force_step: true, value: [0, 0], description: `Up to ${MAX_MARGIN} px. Drag its box on the preview to move or resize it` } as any,
    (graph) => marginPair(graph, 0, 2),
    (graph, _value, result) => setMargins(graph, result),
)

const marginYField = graphField(
    'margin_y',
    { type: 'vector', label: 'Reach top, bottom (px)', dimensions: 2, step: 1, force_step: true, value: [0, 0] } as any,
    (graph) => marginPair(graph, 1, 3),
    (graph, _value, result) => setMargins(graph, result),
)

const settings = custom(
    (key) => key.startsWith(PARAM_KEY) || key.startsWith('color__'),
    (node) => {
        const state = readMaterials()
        const graph = graphOf(node, state)!
        const tones = toneChoices()
        const config: FormConfig = {}
        const info = effectInfoOf(node)
        const params = paramNamesOf(graph)
        const colors = graph.nodes.filter((entry) => SLOT_NODES.has(entry.type) || RAMP_NODES.has(entry.type))
        if (params.length > 0 || colors.length > 0) config.settings_title = bold('Settings')
        const plate = readNameplate()
        for (const name of params) {
            const range = rangeOf(state, name)
            const label = range.label || name
            const own = ownValue(name, plate)
            const value = own?.value ?? state.params[name] ?? 0
            const [min, max] = sliderSpan(range, value)
            config[`${PARAM_KEY}${name}`] = {
                type: 'range',
                label,
                min,
                max,
                step: range.step,
                editable_range_label: true,
                limit_advice: SLIDER_ADVICE,
                options: { min, max, variant: own?.variant ?? '' },
                value,
                description: `Setting '${name}'`,
            } as unknown as FormElementOptions
            if (own) config[`${PARAM_KEY}${name}_note`] = dynamicInfo(`Variant '${own.variant}' has its own ${label}, so this slider changes that variant only. The other variants use ${round3Text(state.params[name] ?? 0)}.`)
        }
        const slots = slotChoices()
        const labels = colorLabels(colors)
        for (const entry of colors) {
            const current = String(entry.set?.slot ?? '')
            const ramp = RAMP_NODES.has(entry.type)
            config[`color__${entry.id}`] = {
                type: 'select',
                label: labels.get(entry.id),
                options: withCurrent<any>(ramp ? slots : tones, current, `${current} (missing)`),
                description: ramp ? 'The palette color whose shades this uses, so colorways change it too' : 'A palette shade, so colorways change it too',
            }
        }
        animatedConfig(config, graph, info)
        toneConfig(config, node, graph, info)
        return config
    },
    (node) => {
        const state = readMaterials()
        const graph = graphOf(node, state)!
        const values: Values = {}
        const plate = readNameplate()
        for (const name of paramNamesOf(graph)) values[`${PARAM_KEY}${name}`] = ownValue(name, plate)?.value ?? state.params[name] ?? 0
        for (const entry of graph.nodes) {
            if (SLOT_NODES.has(entry.type) || RAMP_NODES.has(entry.type)) values[`color__${entry.id}`] = String(entry.set?.slot ?? '')
        }
        return values
    },
    (node, key, result, context) => {
        edit(node, context, (graph, state) => {
            if (key.startsWith(PARAM_KEY)) {
                const value = Number(result[key])
                if (isFinite(value)) state.params[key.slice(PARAM_KEY.length)] = value
                return
            }
            const entry = graph.nodes.find((candidate) => candidate.id === key.slice('color__'.length))
            if (entry && result[key]) entry.set = { ...(entry.set ?? {}), slot: String(result[key]) }
        })
    },
)

const graphKeys = group(resolutionField, blendField, emissiveField, outlineField, marginXField, marginYField, settings)

export function effectForm(placement: Part): Part {
    return group(
        heading('effect_title', 'Graph'),
        materialField,
        fixed((node) => {
            const graph = graphOf(node)
            return { edit_graph: { type: 'buttons', buttons: ['Edit graph...'], condition: () => !!graph, click: () => openGraphEditor(node) } }
        }),
        fixed((node): FormConfig => {
            const shared = sharedCount(node)
            return shared > 0 ? { shared_note: { type: 'info', text: `This graph is also used by ${shared} other ${pluralWord(shared, 'effect')}; changes below change ${shared === 1 ? 'it' : 'them'} too.` } } : {}
        }),
        fixed((node): FormConfig => (hasGraph(node) ? {} : { missing_note: { type: 'info', text: 'This effect has no graph yet. Pick one above.' } })),
        when(hasGraph, heading('look_title', 'Look'), resolutionField, blendField, emissiveField, outlineField),
        gated(heading('area_title', 'Area'), ofField),
        when(hasGraph, marginXField, marginYField),
        gated(heading('time_title', 'Time'), driftField, heading('mirror_title', 'Mirror'), mirrorField, mirrorDelayField, mirrorSeedField),
        when(hasGraph, settings),
        placement,
    )
}

function margin(value: unknown): number {
    const number = Math.round(Number(value))
    return isFinite(number) ? Math.min(MAX_MARGIN, Math.max(0, number)) : 0
}

function setMargins(graph: MaterialGraph, result: Result) {
    const x = Array.isArray(result.margin_x) ? result.margin_x : [0, 0]
    const y = Array.isArray(result.margin_y) ? result.margin_y : [0, 0]
    for (const value of [...x, ...y]) noteLimit(value, 0, MAX_MARGIN, 'Reach')
    storeMargins(graph, [margin(x[0]), margin(y[0]), margin(x[1]), margin(y[1])])
}

export type EffectMargins = [number, number, number, number]
export type EffectEdge = 'left' | 'top' | 'right' | 'bottom'

function marginsOf(graph: MaterialGraph): EffectMargins {
    const raw: unknown[] = Array.isArray(graph.margins) ? graph.margins : []
    return [margin(raw[0]), margin(raw[1]), margin(raw[2]), margin(raw[3])]
}

function storeMargins(graph: MaterialGraph, margins: EffectMargins) {
    const clean = margins.map(margin)
    if (clean.every((value) => value === 0)) delete graph.margins
    else graph.margins = clean
}

function shiftRange(before: number, after: number, delta: number): number {
    const low = Math.max(before - MAX_MARGIN, -after)
    const high = Math.min(before, MAX_MARGIN - after)
    return Math.max(low, Math.min(high, Math.round(delta)))
}

export function effectMargins(node: any): EffectMargins | null {
    if (node?.type !== EFFECT_TYPE) return null
    const graph = graphOf(node)
    return graph ? marginsOf(graph) : null
}

export function shiftMargins(origin: EffectMargins, dx: number, dy: number): EffectMargins {
    const [left, top, right, bottom] = origin
    const x = shiftRange(left, right, dx)
    const y = shiftRange(top, bottom, dy)
    return [left - x, top - y, right + x, bottom + y]
}

export interface MoveRoom {
    x: [number, number]
    y: [number, number]
}

export function shiftRoom(origin: EffectMargins): MoveRoom {
    const [left, top, right, bottom] = origin
    return {
        x: [shiftRange(left, right, -Infinity), shiftRange(left, right, Infinity)],
        y: [shiftRange(top, bottom, -Infinity), shiftRange(top, bottom, Infinity)],
    }
}

export function stretchRoom(origin: EffectMargins, edge: EffectEdge): MoveRoom {
    const free: [number, number] = [-Infinity, Infinity]
    const [left, top, right, bottom] = origin
    if (edge === 'left') return { x: [left - MAX_MARGIN, left], y: free }
    if (edge === 'right') return { x: [-right, MAX_MARGIN - right], y: free }
    if (edge === 'top') return { x: free, y: [top - MAX_MARGIN, top] }
    return { x: free, y: [-bottom, MAX_MARGIN - bottom] }
}

export function stretchMargins(origin: EffectMargins, edge: EffectEdge, dx: number, dy: number): EffectMargins {
    const next: EffectMargins = [origin[0], origin[1], origin[2], origin[3]]
    if (edge === 'left') next[0] = margin(origin[0] - dx)
    if (edge === 'right') next[2] = margin(origin[2] + dx)
    if (edge === 'top') next[1] = margin(origin[1] - dy)
    if (edge === 'bottom') next[3] = margin(origin[3] + dy)
    return next
}

export interface EffectMove {
    node: any
    flip: number
}

export type EffectsShift = (dx: number, dy: number) => void

export function beginEffectsShift(moves: EffectMove[]): EffectsShift | null {
    const state = readMaterials()
    const origins = new Map<string, { margins: EffectMargins, flip: number }>()
    for (const { node, flip } of moves) {
        const id = String(node?.material)
        const graph = graphOf(node, state)
        if (graph && !origins.has(id)) origins.set(id, { margins: marginsOf(graph), flip })
    }
    if (origins.size === 0) return null
    writeMaterials(state)
    lastEdit = null
    return (dx, dy) => {
        const next = readMaterials()
        for (const [id, origin] of origins) {
            const graph = next.graphs[id]
            if (graph) storeMargins(graph, shiftMargins(origin.margins, origin.flip * dx, dy))
        }
        writeMaterials(next)
        notifyMaterialsChanged()
    }
}

export interface EffectAreaEdit {
    origin: EffectMargins
    set(margins: EffectMargins): void
    finish(label: string): void
}

export function beginEffectAreaEdit(node: any): EffectAreaEdit | null {
    const origin = effectMargins(node)
    if (!origin) return null
    const id = String(node.material)
    const aspects = materialsAspect() as unknown as UndoAspects
    let started = false
    let last = origin.join(',')
    return {
        origin,
        set(margins: EffectMargins) {
            const key = margins.join(',')
            if (key === last) return
            last = key
            if (!started) {
                writeMaterials(readMaterials())
                Undo.initEdit(aspects)
                started = true
                lastEdit = null
            }
            const state = readMaterials()
            const graph = state.graphs[id]
            if (!graph) return
            storeMargins(graph, margins)
            writeMaterials(state)
            notifyMaterialsChanged()
        },
        finish(label: string) {
            if (!started) return
            started = false
            Undo.finishEdit(label, aspects)
            Blockbench.dispatchEvent('update_selection', {} as any)
        },
    }
}

function mergeable(key: string): boolean {
    return key.startsWith(PARAM_KEY) || key === 'margin_x' || key === 'margin_y'
}

function amendLast(key: string): boolean {
    const now = Date.now()
    const undo = Undo as any
    const index = Number(undo.index)
    const merge = !!lastEdit && lastEdit.key === key && now - lastEdit.at < MERGE_MS && lastEdit.index === index && Array.isArray(undo.history)
    lastEdit = { key, at: now, index }
    return merge
}

function amend(state: MaterialsState): boolean {
    const undo = Undo as any
    const entry = undo.history?.[undo.index - 1]
    const post = entry?.post
    if (!post || !(Object.keys(materialsAspect())[0] in post)) return false
    writeMaterials(state)
    post[Object.keys(materialsAspect())[0]] = cloneJson(state)
    notifyMaterialsChanged()
    Blockbench.dispatchEvent('update_selection', {} as any)
    return true
}

function setVariantParam(variant: string, name: string, value: number) {
    const key = `variant:${variant}:${name}`
    const write = (plate: NameplateData) => {
        const params = plate.variants[variant]?.params
        if (params) params[name] = value
    }
    const undo = Undo as any
    const post = amendLast(key) ? undo.history?.[undo.index - 1]?.post : null
    if (post && 'nameplate' in post) {
        const plate = readNameplate()
        write(plate)
        Project.nameplate = plate
        post.nameplate = { plate: cloneJson(plate), name: String(Project.name ?? '') }
        notifyNameplateChanged()
        return
    }
    lastEdit = { key, at: Date.now(), index: Number(undo.index) + 1 }
    commit(`Edit ${paramLabel(name)} of variant ${variant}`, write)
}

function applyVariantParams(keys: string[], result: Result): string[] {
    const plate = readNameplate()
    return keys.filter((key) => {
        const name = key.startsWith(PARAM_KEY) ? key.slice(PARAM_KEY.length) : ''
        const own = name ? ownValue(name, plate) : null
        if (!own) return true
        const value = Number(result[key])
        if (isFinite(value)) setVariantParam(own.variant, name, value)
        return false
    })
}

export function applyEffect(first: any, keys: string[], result: Result): boolean {
    if (first?.type !== EFFECT_TYPE) return false
    const targets = layerNodes().filter((node) => node.selected && node.type === EFFECT_TYPE)
    if (!targets.includes(first)) targets.unshift(first)
    const own = applyVariantParams(keys.filter((key) => !key.endsWith('_note') && !key.endsWith('_button') && key !== 'edit_graph'), result)
    if (own.length === 0) return true
    if (own.length === 1 && mergeable(own[0]) && amendLast(own[0])) {
        const state = readMaterials()
        if (graphOf(first, state)) {
            graphKeys.apply!(first, own[0], result, state)
            if (amend(state)) return true
        }
    } else {
        lastEdit = own.length === 1 && mergeable(own[0]) ? { key: own[0], at: Date.now(), index: Number((Undo as any).index) + 1 } : null
    }
    commitMaterials(
        own.includes('material') ? 'Change effect graph' : 'Edit effect',
        (state) => {
            for (const key of own) {
                if (key === 'material') {
                    const choice = String(result.material ?? '')
                    const material = choice.startsWith(STARTER_PREFIX) ? addStarterMaterial(state, choice.slice(STARTER_PREFIX.length)) : choice
                    if (material) for (const node of targets) node.material = material
                    continue
                }
                if (elements.owns!(key)) {
                    for (const node of targets) elements.apply!(node, key, result)
                    continue
                }
                graphKeys.apply!(first, key, result, state)
            }
        },
        { elements: targets },
    )
    return true
}

function addMissingParams(state: MaterialsState, graph: MaterialGraph) {
    for (const name of paramNamesOf(graph)) {
        if (name in state.params) continue
        state.params[name] = 1
        state.ranges[name] = { ...NEW_PARAM, label: name }
    }
}

export function storeGraph(id: string, graph: unknown, label = 'Edit graph'): boolean {
    if (!graph || typeof graph !== 'object' || !Array.isArray((graph as MaterialGraph).nodes)) return false
    const now = Date.now()
    const key = `graph:${id}`
    if (amendLast(key)) {
        const state = readMaterials()
        state.graphs[id] = cloneJson(graph as MaterialGraph)
        addMissingParams(state, state.graphs[id])
        if (amend(state)) return true
    }
    lastEdit = { key, at: now, index: Number((Undo as any).index) + 1 }
    return commitMaterials(label, (state) => {
        state.graphs[id] = cloneJson(graph as MaterialGraph)
        addMissingParams(state, state.graphs[id])
    })
}

export function openGraphEditor(node: any) {
    const id = typeof node?.material === 'string' ? node.material : ''
    const graph = readMaterials().graphs[id]
    if (!graph) return
    openMaterialEditor({
        title: `Graph: ${id}`,
        graph: cloneJson(graph),
        onChange(next: unknown) {
            storeGraph(id, next)
        },
        read: () => readMaterials().graphs[id],
    })
}

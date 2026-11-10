import { EngineIssue, IssueValues, LoadedBundle, NameplateCost, NameplateEffectCost, NameplateFallbackCost, NameplateLayer, NameplateLimits, nameplateLimits, NameplatePreview } from '../engine'
import { count, cpuParts, FLASH_HOLD_HINT, flashText, isLetterCpu, kilobytes } from '../checks/budget'
import { classifyIssue, IssueFacts, issueValue } from '../checks/codes'
import { pluralWord } from '../util/text'

export type CostId = 'quads' | 'cache' | 'cpu' | 'states' | 'margin' | 'flash' | 'rebuild' | 'fallback'

export interface CostDetail {
    key: string
    label: string
    value: string
    note: string
    layer: string
    over?: boolean
}

export interface CostRow {
    id: CostId
    label: string
    help: string
    value: string
    percent: number
    over: boolean
    measured: boolean
    bar: boolean
    info: boolean
    note: string
    layer: string
    details: CostDetail[]
    detailsLabel: string
    detailsOpen: boolean
}

export interface CostInfo {
    key: string
    text: string
    layer: string
}

export interface CostReport {
    status: 'ok' | 'over' | 'unknown'
    headline: string
    rows: CostRow[]
    infos: CostInfo[]
    flashPending: boolean
}

export type QuadPainter = (preview: NameplatePreview, frame: number) => NameplateLayer[]

interface Found {
    used?: number
    layer?: string
    values: IssueValues
}

type FoundCosts = Partial<Record<CostId, Found>>

const LABELS: Record<CostId, { label: string, help: string }> = {
    quads: {
        label: 'Shapes drawn',
        help: 'Rectangles drawn in the busiest frame',
    },
    cache: {
        label: 'Picture memory',
        help: 'Memory for every picture the nameplate can show',
    },
    cpu: {
        label: 'Work per frame',
        help: 'Formula work each frame',
    },
    states: {
        label: 'Different pictures per layer',
        help: '',
    },
    margin: {
        label: 'Distance outside the background',
        help: 'How far any layer sits outside the game background, moves included',
    },
    flash: {
        label: 'Flashing',
        help: 'No more than 64 pixels may flash together more than 3 times in one second',
    },
    rebuild: {
        label: 'Effect build work',
        help: 'Work to build the effects for one nameplate size',
    },
    fallback: {
        label: 'Basic effects memory',
        help: 'Memory for basic effects, which are kept as pictures. It has its own limit and never blocks export.',
    },
}

const ORDER: CostId[] = ['quads', 'cache', 'cpu', 'states', 'margin', 'flash']
const MAX_QUAD_FRAMES = 40
const STILL_SENTENCE = 'On basic effects, players see its first frame.'
const DRIFT_SENTENCE = 'Drifts: never repeats. On basic effects it is rebuilt as it moves.'
const FALLBACK_CODES = new Set<string>(['fallback_cache', 'fallback_still', 'fallback_rebuild'])

const QUADS_FIX = 'Use fewer or simpler layers, particles or repeats.'
const CACHE_FIX = 'Use fewer frames or smaller sprites.'

const cache = new WeakMap<NameplatePreview, NameplateCost | null>()
const flashCache = new WeakMap<NameplatePreview, NameplateCost | null>()
const overCache = new WeakMap<LoadedBundle, NameplateCost | null>()
const overFlashCache = new WeakMap<LoadedBundle, NameplateCost | null>()
const quadCache = new WeakMap<NameplatePreview, Map<number, number>>()
const OVER_HEADLINE = 'Over the limit. Export is blocked until this is fixed.'

function megabytes(bytes: number): string {
    if (bytes < 1024 * 1024) return kilobytes(bytes)
    const mb = bytes / (1024 * 1024)
    return `${Number.isInteger(mb) ? mb : mb.toFixed(2)} MB`
}

function milliseconds(ms: number): string {
    return `${ms < 10 ? ms.toFixed(1) : count(ms)} ms`
}

function percentOf(used: number, limit: number): number {
    if (limit <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
}

function row(id: CostId, value: string, percent: number, over: boolean, measured: boolean, note: string, layer = ''): CostRow {
    return {
        id,
        ...LABELS[id],
        value,
        percent,
        over,
        measured,
        bar: measured && id !== 'flash',
        info: false,
        note,
        layer,
        details: [],
        detailsLabel: '',
        detailsOpen: false,
    }
}

function withDetails(base: CostRow, details: CostDetail[], label: string, open = false): CostRow {
    if (!details.length) return base
    return { ...base, details, detailsLabel: label, detailsOpen: open }
}

function overNote(over: boolean, fix: string): string {
    return over ? `Over the limit. ${fix}` : ''
}

function valueOf(values: IssueValues, name: string): number | null {
    const found = values[name]
    return typeof found === 'number' && Number.isFinite(found) ? found : null
}

function coded(issues: EngineIssue[], code: string): IssueFacts | undefined {
    for (const issue of issues) {
        const facts = classifyIssue(issue)
        if (facts.code === code) return facts
    }
    return undefined
}

function flashNote(values: IssueValues): string {
    return `${flashText(values)} ${FLASH_HOLD_HINT}`
}

function flashRow(cost: NameplateCost, limits: NameplateLimits, failed: Found | undefined): CostRow {
    const times = cost.flashTimes
    const pixels = cost.flashPixels ?? 0
    if (times === null) {
        if (failed) return row('flash', 'Fails', 100, true, true, flashNote(failed.values), failed.layer)
        return row('flash', 'Checking...', 0, false, false, 'Checked a moment after you stop editing.')
    }
    const worst = pixels > 0
        ? `Worst: ${count(pixels)} px flash together ${count(times)} times/s.`
        : times > 0 ? `Worst: ${count(times)} flashes/s, never more than ${limits.flashes}/s anywhere.` : 'Nothing flashes.'
    const flashing = coded(cost.issues, 'flash')
    if (flashing || pixels > limits.flashArea) {
        return row('flash', `${count(times)}/s over ${count(pixels)} px`, 100, true, true, flashing ? flashNote(flashing.values) : worst, flashing?.layer ?? '')
    }
    return row('flash', 'Passes', 0, false, true, `${worst} The limit is ${limits.flashArea} px flashing together ${limits.flashes} times a second.`)
}

function frameSamples(loop: number): number[] {
    const frames = Math.max(1, Math.floor(loop) || 1)
    if (frames <= MAX_QUAD_FRAMES) return Array.from({ length: frames }, (_, index) => index)
    return Array.from({ length: MAX_QUAD_FRAMES }, (_, index) => Math.floor((index * frames) / MAX_QUAD_FRAMES))
}

function quadsByLayer(preview: NameplatePreview, paint: QuadPainter): Map<number, number> {
    const known = quadCache.get(preview)
    if (known) return known
    const most = new Map<number, number>()
    for (const frame of frameSamples(preview.loop)) {
        const frameQuads = new Map<number, number>()
        for (const op of paint(preview, frame)) {
            frameQuads.set(op.index, (frameQuads.get(op.index) ?? 0) + (op.quads ?? 1))
        }
        for (const [index, quads] of frameQuads) most.set(index, Math.max(most.get(index) ?? 0, quads))
    }
    quadCache.set(preview, most)
    return most
}

function quadDetails(cost: NameplateCost, preview: NameplatePreview | null, paint: QuadPainter | undefined): CostDetail[] {
    if (!preview || !paint) return []
    let most: Map<number, number>
    try {
        most = quadsByLayer(preview, paint)
    } catch (error) {
        console.error('[polyplus_nameplate] counting quads per layer failed', error)
        return []
    }
    return [...most.entries()]
        .filter(([, quads]) => quads > 0)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([index, quads]) => {
            const id = cost.layers[index]?.id ?? ''
            return { key: `quads-${index}`, label: id ? `Layer '${id}'` : `Layer ${index + 1}`, value: count(quads), note: '', layer: id }
        })
}

function cpuDetails(cost: NameplateCost | null, over: Found | undefined): CostDetail[] {
    if (over && isLetterCpu(over.values)) {
        const per = valueOf(over.values, 'perLetter') ?? 0
        const letters = valueOf(over.values, 'letters') ?? 0
        return [{ key: 'cpu-letters', label: 'Letter formula', value: count(over.used ?? 0), note: `${count(per)} per letter, for ${count(letters)} letters.`, layer: '', over: true }]
    }
    if (over) {
        return cpuParts(over.values).map((part) => ({ key: `cpu-${part.key}`, label: part.label, value: count(part.units), note: '', layer: '' }))
    }
    if (!cost || cost.textCpu <= 0) return []
    return [
        { key: 'cpu-text', label: 'Letter formulas', value: count(cost.textCpu), note: 'For the longest name the game allows.', layer: '' },
        { key: 'cpu-rest', label: 'Everything else', value: count(Math.max(0, cost.cpu - cost.textCpu)), note: '', layer: '' },
    ]
}

function cpuFix(over: Found | undefined): string {
    return over && isLetterCpu(over.values) ? 'Make the letter formula simpler.' : 'Simplify the formulas.'
}

function overCpu(cost: NameplateCost): Found | undefined {
    const facts = coded(cost.issues, 'over_cpu')
    return facts ? { used: issueValue(facts, 'units') ?? undefined, values: facts.values } : undefined
}

function effectDetails(cost: NameplateCost, limits: NameplateLimits): CostDetail[] {
    return cost.effects.map((effect) => {
        const over = effect.states > limits.states
        return {
            key: `effect-${effect.layer}`,
            label: `Effect '${effect.layer}'`,
            value: `${count(effect.states)} / ${count(limits.states)}`,
            note: over
                ? 'Too many different pictures. Raise \'Hold each frame for\', or animate fewer of its settings.'
                : effect.shotStates > 0 ? `Its one-shots add ${count(effect.shotStates)} more, which don't count.` : '',
            layer: effect.layer,
            over,
        }
    })
}

function busiestEffect(effects: NameplateEffectCost[]): NameplateEffectCost | undefined {
    return effects.reduce<NameplateEffectCost | undefined>((best, effect) => (effect.states > (best?.states ?? -1) ? effect : best), undefined)
}

function statesRow(cost: NameplateCost, limits: NameplateLimits): CostRow {
    const widest = cost.layers.reduce((best, layer) => (layer.states > (best?.states ?? -1) ? layer : best), cost.layers[0])
    const busiest = busiestEffect(cost.effects)
    const layerOver = cost.states > limits.states
    const effectOver = !!busiest && busiest.states > limits.states
    const note = layerOver
        ? overNote(true, `Layer '${widest?.id}' shows too many different frames.`)
        : effectOver
            ? overNote(true, `Effect '${busiest?.layer}' shows too many different pictures.`)
            : widest ? `Most in layer '${widest.id}'. ${count(cost.totalStates)} in all.` : ''
    const layer = !layerOver && effectOver ? busiest?.layer ?? '' : widest?.id ?? ''
    const base = row('states', `${count(cost.states)} / ${count(limits.states)}`, percentOf(cost.states, limits.states), layerOver || effectOver, true, note, layer)
    return withDetails(base, effectDetails(cost, limits), 'Effect layers', effectOver)
}

function rebuildTargets(cost: NameplateCost): Map<string, number> {
    const targets = new Map<string, number>()
    for (const issue of cost.infos) {
        const facts = classifyIssue(issue)
        const target = issueValue(facts, 'target')
        if (FALLBACK_CODES.has(facts.code) && facts.layer && target !== null) targets.set(facts.layer, target)
    }
    return targets
}

function slowRebuild(entry: NameplateFallbackCost, target: number | undefined): boolean {
    return target !== undefined && typeof entry.rebuildMs === 'number' && entry.rebuildMs > target
}

function rebuildNote(entry: NameplateFallbackCost, target: number | undefined): string {
    const ms = entry.rebuildMs
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
    const took = ` Building one basic-effects frame takes about ${milliseconds(ms)}.`
    if (!slowRebuild(entry, target)) return took
    return `${took} That is slow, so the game spreads it over several frames.`
}

function fallbackDetail(entry: NameplateFallbackCost, target: number | undefined): CostDetail {
    const frames = entry.frames === 1 ? '1 frame' : `${count(entry.frames)} frames`
    const timing = rebuildNote(entry, target)
    const note = entry.drift
        ? `${DRIFT_SENTENCE}${timing}`
        : entry.still
            ? `Still: only its first frame is kept. All ${frames} would need ${megabytes(entry.animatedBytes)}. ${STILL_SENTENCE}${timing}`
            : entry.frames === 1 ? `Doesn't move, so one picture is kept.${timing}` : `Animated: all ${frames} are kept.${timing}`
    return { key: `fallback-${entry.id}`, label: `Layer '${entry.id}'`, value: megabytes(entry.bytes), note, layer: entry.id }
}

function firstFrameNote(firstOnly: number): string {
    if (firstOnly === 0) return 'Every effect keeps all its frames. Not counted in picture memory.'
    if (firstOnly === 1) return 'On basic effects, 1 effect shows only its first frame, because it is too big to keep every frame. Not counted in picture memory.'
    return `On basic effects, ${firstOnly} effects show only their first frame, because they are too big to keep every frame. Not counted in picture memory.`
}

function fallbackRow(cost: NameplateCost, limits: NameplateLimits): CostRow | null {
    const entries = cost.fallbacks
    if (!entries.length) return null
    const targets = rebuildTargets(cost)
    const firstOnly = entries.filter((entry) => entry.still).length
    const slow = entries.some((entry) => slowRebuild(entry, targets.get(entry.id)))
    return {
        ...row('fallback', `${megabytes(cost.fallbackBytes)} / ${megabytes(limits.fallbackBytes)}`, percentOf(cost.fallbackBytes, limits.fallbackBytes), false, true, firstFrameNote(firstOnly)),
        info: true,
        details: entries.map((entry) => fallbackDetail(entry, targets.get(entry.id))),
        detailsLabel: 'By effect layer',
        detailsOpen: firstOnly > 0 || slow,
    }
}

function measuredRows(cost: NameplateCost, limits: NameplateLimits, quadParts: CostDetail[], found: FoundCosts = {}): CostRow[] {
    const farthest = cost.layers.reduce((best, layer) => (layer.margin > (best?.margin ?? -1) ? layer : best), cost.layers[0])
    const quadsOver = cost.quads > limits.quads
    const cacheOver = cost.cacheBytes > limits.cacheBytes
    const cpuOver = cost.cpu > limits.cpu || !!found.cpu
    const marginOver = cost.margin > limits.margin
    const cpuIssue = found.cpu ?? overCpu(cost)
    const rows = [
        withDetails(row('quads', `${count(cost.quads)} / ${count(limits.quads)}`, percentOf(cost.quads, limits.quads), quadsOver,
            true, overNote(quadsOver, QUADS_FIX)), quadParts, 'By layer'),
        row('cache', `${kilobytes(cost.cacheBytes)} / ${kilobytes(limits.cacheBytes)}`, percentOf(cost.cacheBytes, limits.cacheBytes),
            cacheOver, true, overNote(cacheOver, CACHE_FIX)),
        withDetails(row('cpu', `${count(cost.cpu)} / ${count(limits.cpu)}`, percentOf(cost.cpu, limits.cpu), cpuOver, true,
            cost.cpu === 0 && !cpuOver ? 'No formulas in this nameplate.' : overNote(cpuOver, cpuFix(cpuIssue))), cpuDetails(cost, cpuIssue), 'By part', cpuOver),
        statesRow(cost, limits),
        row('margin', `${count(cost.margin)} px / ${count(limits.margin)} px`, percentOf(cost.margin, limits.margin), marginOver, true,
            marginOver ? overNote(true, `Layer '${farthest?.id}' is too far out. Move it closer to the body, or delete it.`) : farthest && cost.margin > 0 ? `Farthest out: layer '${farthest.id}'.` : '',
            cost.margin > 0 ? farthest?.id ?? '' : ''),
        flashRow(cost, limits, found.flash),
        { ...row('rebuild', count(cost.materialBuildOps), 0, false, true, cost.materialBuildOps === 0 ? 'No effects in this nameplate.' : ''), bar: false },
    ]
    const fallback = fallbackRow(cost, limits)
    if (fallback) rows.push(fallback)
    return rows
}

function sentence(message: string): string {
    const text = message.trim()
    if (!text) return ''
    const capital = text.charAt(0).toUpperCase() + text.slice(1)
    return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

function fallbackInfo(facts: IssueFacts): string | null {
    const frames = issueValue(facts, 'frames') ?? 1
    const bytes = issueValue(facts, 'bytes') ?? 0
    const frameBytes = issueValue(facts, 'frameBytes') ?? 0
    switch (facts.code) {
        case 'fallback_rebuild':
            return `${DRIFT_SENTENCE} One picture is ${kilobytes(frameBytes)}.`
        case 'fallback_still':
            return `Too big to keep every frame (${kilobytes(bytes)} over ${count(frames)} frames). ${STILL_SENTENCE}`
        case 'fallback_cache':
            return `Keeps ${count(frames)} ${pluralWord(frames, 'frame')} (${kilobytes(bytes)}) for basic effects.`
        case 'fallback_shots': {
            const shots = issueValue(facts, 'states') ?? 0
            return `Its one-shots add ${count(shots)} ${pluralWord(shots, 'picture')} that don't count toward the ${count(issueValue(facts, 'limit') ?? 120)} limit. On basic effects they are rebuilt while a one-shot plays.`
        }
        default:
            return null
    }
}

function costInfos(cost: NameplateCost): CostInfo[] {
    const covered = new Set(cost.fallbacks.map((entry) => entry.id))
    const infos: CostInfo[] = []
    cost.infos.forEach((issue, index) => {
        const facts = classifyIssue(issue)
        const layer = facts.layer ?? ''
        if (FALLBACK_CODES.has(facts.code) && covered.has(layer)) return
        const text = fallbackInfo(facts) ?? sentence(issue.message)
        infos.push({ key: `${index}:${issue.path}`, text: layer ? `Layer '${layer}': ${text}` : text, layer })
    })
    return infos
}

function keepLarger(found: FoundCosts, id: CostId, next: Found) {
    const known = found[id]
    if (!known || (known.used ?? Infinity) < (next.used ?? Infinity)) found[id] = next
}

function scan(issues: EngineIssue[]): FoundCosts {
    const found: FoundCosts = {}
    for (const issue of issues) {
        const facts = classifyIssue(issue)
        const layer = facts.layer ?? undefined
        const values = facts.values
        switch (facts.code) {
            case 'over_cpu':
                keepLarger(found, 'cpu', { used: issueValue(facts, 'units') ?? undefined, values })
                break
            case 'over_quads':
                found.quads = { used: issueValue(facts, 'quads') ?? undefined, values }
                break
            case 'over_cache':
                found.cache = { used: issueValue(facts, 'bytes') ?? undefined, values }
                break
            case 'over_margin':
                keepLarger(found, 'margin', { used: issueValue(facts, 'px') ?? undefined, layer, values })
                break
            case 'over_states':
                keepLarger(found, 'states', { used: issueValue(facts, 'frames') ?? undefined, layer, values })
                break
            case 'flash':
                found.flash = { layer, values }
                break
            default:
                break
        }
    }
    return found
}

function passed(found: FoundCosts): Set<CostId> {
    if (found.states || found.cpu) return new Set()
    if (found.quads || found.cache || found.margin || found.flash) return new Set(['cpu', 'states', 'quads', 'cache', 'margin'])
    return new Set()
}

function failedRows(found: FoundCosts, limits: NameplateLimits): CostRow[] {
    const pending = 'Not measured yet. Fix the problems marked in red first.'
    const within = passed(found)
    return ORDER.map((id) => {
        const hit = found[id]
        if (!hit && within.has(id)) return { ...row(id, 'Within the limit', 0, false, true, 'The exact number shows again once nothing is over the limit.'), bar: false }
        if (!hit) return row(id, 'Not measured', 0, false, false, pending)
        const where = hit.layer ? ` In layer '${hit.layer}'.` : ''
        switch (id) {
            case 'quads':
                return row(id, `${count(hit.used ?? 0)} / ${count(limits.quads)}`, 100, true, true, overNote(true, QUADS_FIX))
            case 'cache':
                return row(id, `${kilobytes(hit.used ?? 0)} / ${kilobytes(limits.cacheBytes)}`, 100, true, true, overNote(true, CACHE_FIX))
            case 'cpu':
                return withDetails(row(id, `${count(hit.used ?? 0)} / ${count(limits.cpu)}`, 100, true, true, overNote(true, cpuFix(hit))), cpuDetails(null, hit), 'By part', true)
            case 'states':
                return row(id, hit.used === undefined ? `Over ${count(limits.states)}` : `${count(hit.used)} / ${count(limits.states)}`, 100, true, true, `Over the limit.${where}`, hit.layer)
            case 'margin':
                return row(id, `${count(hit.used ?? 0)} px / ${count(limits.margin)} px`, 100, true, true, `Over the limit.${where}`, hit.layer)
            default:
                return row(id, 'Fails', 100, true, true, flashNote(hit.values), hit.layer)
        }
    })
}

function measured<Key extends object>(
    plain: WeakMap<Key, NameplateCost | null>,
    flashed: WeakMap<Key, NameplateCost | null>,
    key: Key,
    measure: (flash: boolean) => NameplateCost | null,
    flash: boolean,
): NameplateCost | null {
    if (flashed.has(key)) return flashed.get(key) ?? null
    const store = flash ? flashed : plain
    if (!store.has(key)) store.set(key, measure(flash))
    return store.get(key) ?? null
}

function previewCost(preview: NameplatePreview, flash: boolean): NameplateCost {
    return measured(cache, flashCache, preview, (flashed) => preview.cost(flashed), flash) as NameplateCost
}

function overBudgetCost(loaded: LoadedBundle, flash: boolean): NameplateCost | null {
    const measure = loaded.measure
    return measure ? measured(overCache, overFlashCache, loaded, measure, flash) : null
}

export function previewCostOf(preview: NameplatePreview): NameplateCost {
    return previewCost(preview, false)
}

export function nameplateCostOf(loaded: LoadedBundle | null): NameplateCost | null {
    if (!loaded) return null
    if (loaded.preview) return previewCost(loaded.preview, false)
    return overBudgetCost(loaded, false)
}

function draftOf(loaded: LoadedBundle): NameplatePreview | null {
    try {
        return loaded.draft?.() ?? null
    } catch (error) {
        console.error('[polyplus_nameplate] loading the over-budget draft failed', error)
        return null
    }
}

export function costReport(loaded: LoadedBundle | null, flash = false, paint?: QuadPainter): CostReport {
    const limits = nameplateLimits()
    const preview = loaded?.preview ?? null
    if (preview) {
        const cost = previewCost(preview, flash)
        const rows = measuredRows(cost, limits, quadDetails(cost, preview, paint))
        const over = rows.some((entry) => entry.over)
        return {
            status: over ? 'over' : 'ok',
            headline: over ? OVER_HEADLINE : 'Everything is within the limits.',
            rows,
            infos: costInfos(cost),
            flashPending: cost.flashTimes === null,
        }
    }
    const found = scan(loaded?.issues ?? [])
    const measured = loaded ? overBudgetCost(loaded, flash) : null
    if (measured && loaded) {
        return {
            status: 'over',
            headline: OVER_HEADLINE,
            rows: measuredRows(measured, limits, quadDetails(measured, draftOf(loaded), paint), found),
            infos: costInfos(measured),
            flashPending: measured.flashTimes === null,
        }
    }
    const rows = failedRows(found, limits)
    if (rows.some((entry) => entry.over)) {
        return { status: 'over', headline: OVER_HEADLINE, rows, infos: [], flashPending: false }
    }
    return {
        status: 'unknown',
        headline: loaded?.skipped
            ? `The game would skip this nameplate: ${loaded.skipped}`
            : 'The cost can\'t be measured until the nameplate draws. See Checks for what to fix.',
        rows,
        infos: [],
        flashPending: false,
    }
}

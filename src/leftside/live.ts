import { reactionLabel } from '../animate/props'
import { readLayers } from '../elements'
import { isPaintDragging, onPaintDragEnd } from '../util/paintDrag'
import { findNode } from '../elements/nodes'
import { showLayer } from '../navigate'
import { currentLoad, onPreviewResult, PreviewResult, previewUi, projectKey } from '../preview'
import { CostInfo, CostReport, costReport } from '../preview/cost'
import { CROWD } from '../preview/crowd'
import { isLiveOnStage, liveUi, playingShots, REACTION_LABELS } from '../preview/live'
import { previewOptions } from '../preview/options'
import { createListenerSet } from '../util/events'
import { onFullChecks } from '../compile'
import { signalControls, signalValueText } from '../cosmetic/preview'

const FLASH_DELAY_MS = 400

export interface ReactionEntry {
    id: string
    label: string
    on: boolean
}

export interface LevelEntry {
    signal: string
    label: string
    min: number
    max: number
    step: number
    value: number
    text: string
}

export interface ShotEntry {
    name: string
    label: string
}

interface CostUi {
    report: CostReport
    opened: string[]
    closed: string[]
    manual: boolean | null
}

interface TryUi {
    hasPreview: boolean
    reactions: ReactionEntry[]
    levels: LevelEntry[]
    oneShots: ShotEntry[]
    seed: number
    crowd: boolean
    crowdSize: number
    message: string
    shot: string
    reduced: boolean
}

function emptyReport(): CostReport {
    return { status: 'unknown', headline: '', rows: [], infos: [], flashPending: false }
}

export const costUi: CostUi = { report: emptyReport(), opened: [], closed: [], manual: null }

export const tryUi: TryUi = {
    hasPreview: false,
    reactions: [],
    levels: [],
    oneShots: [],
    seed: 0,
    crowd: false,
    crowdSize: CROWD.length,
    message: '',
    shot: '',
    reduced: false,
}

type ReportListener = (report: CostReport) => void

const seen: { load: unknown, reactions: string, levels: string, shots: string, project: string } = { load: undefined, reactions: '', levels: '', shots: '', project: '' }
const listeners = createListenerSet<[CostReport]>('cost listener failed')
const handles: { flashTimer: ReturnType<typeof setTimeout> | null, remove: (() => void) | null, users: number } = {
    flashTimer: null,
    remove: null,
    users: 0,
}

export function onCostReport(listener: ReportListener): () => void {
    return listeners.on(listener)
}

export function costNotes(): CostInfo[] {
    return costUi.report.infos
}

function setReport(report: CostReport) {
    costUi.report = report
    listeners.notify(report)
}

function cancelFlash() {
    if (handles.flashTimer !== null) clearTimeout(handles.flashTimer)
    handles.flashTimer = null
}

function scheduleFlash(load: ReturnType<typeof currentLoad>) {
    cancelFlash()
    if (!costUi.report.flashPending) return
    handles.flashTimer = setTimeout(() => {
        handles.flashTimer = null
        if (seen.load !== load) return
        try {
            setReport(costReport(load, true))
        } catch (error) {
            console.error('[polyplus_nameplate] flash check failed', error)
        }
    }, FLASH_DELAY_MS)
}

function shotLabel(name: string): string {
    const words = name.replace(/_/g, ' ').trim()
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}

function syncReactions(available: string[]) {
    const key = `${available.join(',')}|${liveUi.reactions.join(',')}`
    if (key === seen.reactions) return
    seen.reactions = key
    tryUi.reactions = available.map((id) => ({ id, label: REACTION_LABELS[id] ?? reactionLabel(id), on: liveUi.reactions.includes(id) }))
}

export function levelText(entry: Pick<LevelEntry, 'signal'>, value: number): string {
    const control = signalControls().find((candidate) => candidate.name === entry.signal)
    return control ? signalValueText(control, value) : String(value)
}

function syncLevels(available: string[]) {
    const key = `${available.join(',')}|${JSON.stringify(liveUi.values)}`
    if (key === seen.levels) return
    seen.levels = key
    const controls = signalControls()
    tryUi.levels = available.map((signal) => {
        const control = controls.find((candidate) => candidate.name === signal)
        const value = liveUi.values[signal] ?? 0
        return {
            signal,
            label: control?.label ?? signal,
            min: control?.min ?? 0,
            max: control?.max ?? 1,
            step: control?.step ?? 0.1,
            value,
            text: control ? signalValueText(control, value) : String(value),
        }
    })
}

function syncShots(names: string[]) {
    const key = names.join(',')
    if (key === seen.shots) return
    seen.shots = key
    tryUi.oneShots = names.map((name) => ({ name, label: shotLabel(name) }))
}

function clearShotMessage() {
    tryUi.message = ''
    tryUi.shot = ''
}

function syncShotMessage() {
    const project = projectKey()
    if (project !== seen.project) {
        seen.project = project
        clearShotMessage()
    } else if (tryUi.message && isLiveOnStage() && !playingShots().includes(tryUi.shot)) {
        clearShotMessage()
    }
}

export function isReduced(): boolean {
    return previewOptions.look === 'reduced' || previewOptions.look === 'off'
}

let lastResult: PreviewResult | null = null

function sync(result: PreviewResult | null) {
    lastResult = result
    try {
        const load = currentLoad()
        const preview = result?.preview ?? null
        tryUi.hasPreview = !!preview
        tryUi.seed = previewUi.seed
        tryUi.crowd = previewUi.crowd
        tryUi.reduced = isReduced()
        syncShotMessage()
        if (load !== seen.load && !isPaintDragging()) {
            seen.load = load
            setReport(costReport(load, false))
            scheduleFlash(load)
        }
        syncReactions(preview ? preview.reactions : [])
        syncLevels(preview ? preview.levels : [])
        syncShots(preview ? preview.oneShots : [])
    } catch (error) {
        console.error('[polyplus_nameplate] left side refresh failed', error)
    }
}

export function selectLayerById(id: string) {
    if (!id) return
    const layer = readLayers().find((entry) => entry.id === id)
    const node = layer ? findNode(layer.uuid) : null
    if (node) showLayer(node)
}

export function startLive(): () => void {
    handles.users++
    if (!handles.remove) {
        const removeResult = onPreviewResult(sync)
        const removeDragEnd = onPaintDragEnd(() => sync(lastResult))
        const removeChecks = onFullChecks(() => {
            seen.load = undefined
            sync(lastResult)
        })
        handles.remove = () => {
            removeResult()
            removeDragEnd()
            removeChecks()
        }
        sync(null)
    }
    return () => {
        handles.users = Math.max(0, handles.users - 1)
        if (handles.users > 0) return
        handles.remove?.()
        handles.remove = null
        cancelFlash()
        seen.load = undefined
        lastResult = null
        seen.reactions = ''
        seen.levels = ''
        seen.shots = ''
        seen.project = ''
        setReport(emptyReport())
        costUi.opened = []
        costUi.closed = []
        costUi.manual = null
        tryUi.reactions = []
        tryUi.levels = []
        tryUi.oneShots = []
        clearShotMessage()
    }
}

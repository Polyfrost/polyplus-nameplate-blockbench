import { count, kilobytes } from '../checks/budget'
import { cosmeticLimits, describe, EngineIssue, RawCosmeticAnalysis } from '../engine'
import { createListenerSet } from '../util/events'
import { hasProject } from '../util/project'
import { buildCosmetic, BuiltCosmetic } from './build'
import { projectSources } from './project'
import { projectTargets, referenceIssues } from './references'
import { CosmeticKind } from './data'
import { activeKind, isCosmeticActive, readCosmetic } from './state'
import { cosmeticIssueText } from './where'

export interface CheckRow {
    level: 'error' | 'warning' | 'info'
    text: string
    path: string
}

export interface CostLine {
    label: string
    value: string
    percent: number | null
    over: boolean
}

export interface ChecksView {
    rows: CheckRow[]
    cost: CostLine[]
    errors: number
    warnings: number
    headline: string
}

const DELAY_MS = 300

export const checksView: ChecksView = { rows: [], cost: [], errors: 0, warnings: 0, headline: '' }

const COSTS: Array<[label: string, key: keyof RawCosmeticAnalysis, limit: string, code: string, bytes?: boolean]> = [
    ['Shapes drawn', 'quads', 'quads_per_wearer', 'quads_over_budget'],
    ['Bones', 'bones', 'bones_per_item', 'bones_over_budget'],
    ['Swinging bones', 'spring_bones', 'spring_bones_per_item', 'spring_bones_over_budget'],
    ['Particles alive at once', 'live_particles', 'particles_per_cosmetic', 'cosmetic_particles_over_budget'],
    ['Wearer memory', 'record_bytes', 'wearer_record_bytes', 'wearer_record_over_budget', true],
    ['Picture memory', 'texture_bytes', '', '', true],
]

export function cosmeticCost(analysis: RawCosmeticAnalysis | null, issues: readonly EngineIssue[], kind: CosmeticKind | null, limits: Readonly<Record<string, number>> | null): CostLine[] {
    if (!analysis) return []
    return COSTS.map(([label, key, limitKey, code, bytes]) => {
        const used = Math.ceil(Number(analysis[key]) || 0)
        const found = issues.find((issue) => issue.code === code)?.values?.limit
        const limit = found ?? limits?.[kind === 'pet' && key === 'bones' ? 'bones_per_pet' : limitKey]
        const known = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
        const shown = (amount: number) => (bytes ? kilobytes(amount) : count(amount))
        return {
            label,
            value: known ? `${shown(used)} / ${shown(limit)}` : shown(used),
            percent: known ? Math.min(100, Math.round((used / limit) * 100)) : null,
            over: found !== undefined || (known && used > limit),
        }
    })
}

const listeners = createListenerSet('a cosmetic checks listener failed')
let timer: ReturnType<typeof setTimeout> | null = null
let last: BuiltCosmetic | null = null

export function currentBuild(): BuiltCosmetic {
    const data = readCosmetic()
    const { sources, issues, guessed } = projectSources(data)
    last = buildCosmetic(data, sources, [...issues, ...referenceIssues(data, projectTargets())], guessed)
    return last
}

function rowOf(issue: EngineIssue): CheckRow {
    return { level: issue.level ?? 'error', text: cosmeticIssueText(issue), path: issue.path }
}

function headline(errors: number, warnings: number): string {
    if (errors) return `${errors} to fix before export`
    if (warnings) return `${warnings} to look at`
    return 'Ready to export'
}

export function refreshChecks() {
    timer = null
    if (!hasProject() || !isCosmeticActive()) {
        checksView.rows = []
        checksView.cost = []
        checksView.errors = 0
        checksView.warnings = 0
        checksView.headline = ''
        return
    }
    try {
        const built = currentBuild()
        const rows = built.load ? built.issues.map(rowOf) : [{ level: 'info' as const, text: 'The engine is still starting. Checks run when it is ready.', path: '' }]
        rows.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : b.level === 'error' ? 1 : a.level === 'warning' ? -1 : 1))
        checksView.rows = rows
        checksView.cost = cosmeticCost(built.load?.analysis ?? null, built.issues, activeKind(), cosmeticLimits())
        checksView.errors = rows.filter((row) => row.level === 'error').length
        checksView.warnings = rows.filter((row) => row.level === 'warning').length
        checksView.headline = headline(checksView.errors, checksView.warnings)
    } catch (error) {
        console.error('[polyplus_nameplate] cosmetic checks failed', error)
        checksView.rows = [{ level: 'error', text: `Checks failed: ${describe(error)}`, path: '' }]
        checksView.errors = 1
        checksView.headline = headline(1, 0)
    }
    listeners.notify()
}

export function scheduleChecks() {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(refreshChecks, DELAY_MS)
}

export function onChecks(listener: () => void): () => void {
    return listeners.on(listener)
}

export function lastBuild(): BuiltCosmetic | null {
    return last
}

export function stopChecks() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    last = null
}

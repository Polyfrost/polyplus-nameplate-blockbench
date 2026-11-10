import { currentBundle } from '../compile'
import { readGroups, readLayers } from '../elements'
import { findNode } from '../elements/nodes'
import type { Problem } from '../export/issues'
import { CompiledBundle, LOOP_ANIMATION } from '../model'
import { goMode, showLayer } from '../navigate'
import { loadFiles, setLineChoice } from '../preview'
import { nameplateCostOf } from '../preview/cost'
import { stopPlayback } from '../design/stage'
import { refreshStage } from './curve'
import { SHOW_ME } from './helpers'
import type { ReportEntry } from './report'
import { reviewWarnings as engineReviewWarnings, ReviewCode, ReviewWarning } from './review'
import { allAnimations } from '../util/animation'
import { hasProject } from '../util/project'

export { strayElementProblems, removeStrayElements } from './elements'
export { curveTextProblems } from './curve'
export { swappedBodyProblems } from './swaps'
export { unusedPictureProblems } from './pictures'
export { classifyIssue, issueCode, isIssueCode, issueValue } from './codes'
export type { IssueCode, IssueFacts } from './codes'
export { budgetText, cpuParts, flashText } from './budget'
export type { ReviewWarning } from './review'

const REVIEWER_ONLY = new Set<ReviewCode>(['translucent_overlap'])

let memo: { bundle: CompiledBundle | null, warnings: ReviewWarning[] } = { bundle: null, warnings: [] }

function openAnimation(name: string): any {
    const animation = allAnimations().find((entry) => entry?.name === name)
    if (!animation) return null
    goMode('animate')
    animation.select()
    return animation
}

function layerNode(id: string | null): any {
    if (!id) return null
    const uuid = [...readLayers(), ...readGroups()].find((entry) => entry.id === id)?.uuid
    return uuid ? findNode(uuid) : null
}

function selectLayer(id: string | null) {
    const node = layerNode(id)
    if (node) showLayer(node)
}

function showSpot(warning: ReviewWarning) {
    goMode('design')
    selectLayer(warning.layer)
    stopPlayback()
    if (warning.lines !== null) setLineChoice(String(warning.lines))
    refreshStage()
}

function showWarning(warning: ReviewWarning) {
    if (warning.animation === null) {
        showSpot(warning)
        return
    }
    const animation = openAnimation(warning.animation)
    if (!animation) return
    if (warning.code === 'position_clamped') layerNode(warning.layer)?.select()
    else if (animation.name !== LOOP_ANIMATION) animation.propertiesDialog()
}

export function reviewWarnings(bundle: CompiledBundle = currentBundle()): ReviewWarning[] {
    if (memo.bundle === bundle) return memo.warnings
    let warnings: ReviewWarning[] = []
    try {
        const cost = nameplateCostOf(loadFiles(bundle.files))
        warnings = cost ? engineReviewWarnings(cost.warnings) : []
    } catch (error) {
        console.error('[polyplus_nameplate] reviewer checks failed', error)
    }
    memo = { bundle, warnings }
    return warnings
}

export function reviewProblems(): Problem[] {
    if (!hasProject()) return []
    return reviewWarnings().filter((warning) => !REVIEWER_ONLY.has(warning.code)).map((warning) => ({
        level: 'warning',
        code: warning.code,
        text: warning.message,
        target: null,
        buttons: [{ ...SHOW_ME, click: () => showWarning(warning) }],
    }))
}

export function reviewerNotes(bundle: CompiledBundle): ReportEntry[] {
    return reviewWarnings(bundle).filter((warning) => REVIEWER_ONLY.has(warning.code)).map((warning) => ({ code: warning.code, text: warning.message }))
}

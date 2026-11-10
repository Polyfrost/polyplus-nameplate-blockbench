import { pathCovers, SHOW_ME } from '../checks/helpers'
import { refreshLight } from '../design/events'
import type { Problem, ProblemButton } from '../export/issues'
import { previewUi, setLineChoice, setPreviewOverride } from '../preview'
import { projectTextProblems, TextProblem } from './checks'
import { openTextPanel, registerTextPanel } from './panel'
import { disposeLetterProgram } from './program'
import { registerLetterProperty, unregisterLetterProperty } from './reaction'

export { badgeMarks, drawBadge, drawBadgeArt, drawStyledName, nameDrawStyle } from './draw'
export { importPlateStyle, importVariantStyle, textBadgeManifest, variantStyleJson } from './compile'
export { normalizePlateStyle, normalizeVariantStyle } from './types'
export type { BadgeOverride, BadgeSettings, TextOverride, TextSettings } from './types'
export { variantStyleForm, variantStyleFrom } from './variant'
export { applyPreset, editStyle, openTextPanel, TEXT_ACTION, TEXT_PANEL } from './panel'
export { textProblems, projectTextProblems } from './checks'
export { resolveStyle, shownStyle } from './style'
export { drawLetters, paintLetters } from './letters'
export type { NameLetters } from './letters'

let cleanup: (() => void) | null = null

function showExtraLines(variant: string) {
    previewUi.variant = variant
    setLineChoice('3')
    setPreviewOverride(null)
    refreshLight()
}

function problemButton(problem: TextProblem): ProblemButton {
    if (problem.lines) return { ...SHOW_ME, click: () => showExtraLines(problem.variant ?? '') }
    if (problem.part === 'badge') return { name: 'Show the badge', icon: 'verified', click: () => openTextPanel(problem.variant ?? '', 'badge') }
    return { name: 'Show the name text', icon: 'format_color_text', click: () => openTextPanel(problem.variant ?? '', 'name') }
}

export function textProblemSource(): Problem[] {
    return projectTextProblems().map((problem) => ({
        level: problem.level,
        text: problem.message,
        target: null,
        buttons: [problemButton(problem)],
        covers: problem.level === 'error' && problem.path ? pathCovers(problem.path, '[') : undefined,
    }))
}

export function registerText() {
    if (cleanup) return
    try {
        registerLetterProperty()
    } catch (error) {
        console.error('[polyplus_nameplate] letter animation property registration failed', error)
    }
    try {
        cleanup = registerTextPanel()
    } catch (error) {
        console.error('[polyplus_nameplate] text panel registration failed', error)
        cleanup = () => {}
    }
}

export function unregisterText() {
    const pending = cleanup
    cleanup = null
    try {
        pending?.()
    } catch (error) {
        console.error('[polyplus_nameplate] text unregistration failed', error)
    }
    disposeLetterProgram()
    unregisterLetterProperty()
}

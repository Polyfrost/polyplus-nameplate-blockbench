import type { Problem, ProblemButton, ProblemTarget, ProjectProblems } from '../export/issues'
import type { CostInfo } from '../preview/cost'
import { plural } from '../util/text'

type CheckLevel = 'error' | 'warning' | 'note'

type CheckJump =
    | { kind: 'target', target: ProblemTarget }
    | { kind: 'button', button: ProblemButton }
    | { kind: 'layer', layer: string }

export interface CheckItem {
    key: string
    level: CheckLevel
    text: string
    jump: CheckJump | null
    jumpLabel: string
    buttons: ProblemButton[]
}

export interface CheckCounts {
    errors: number
    warnings: number
    notes: number
}

const FIX_ICONS = new Set(['delete', 'add', 'straighten', 'build'])

const TARGET_LABELS: Record<ProblemTarget['kind'], string> = {
    layer: 'Click to select the layer',
    texture: 'Click to open the picture',
    pixel: 'Click to show the pixel',
    animation: 'Click to open the animation',
}

function isJumpButton(button: ProblemButton): boolean {
    return !FIX_ICONS.has(button.icon)
}

function problemItem(problem: Problem, level: CheckLevel): Omit<CheckItem, 'key'> {
    const buttons = problem.buttons ?? []
    if (problem.target) {
        return { level, text: problem.text, jump: { kind: 'target', target: problem.target }, jumpLabel: TARGET_LABELS[problem.target.kind], buttons }
    }
    const button = buttons.find(isJumpButton)
    if (button) {
        return { level, text: problem.text, jump: { kind: 'button', button }, jumpLabel: `Click: ${button.name}`, buttons: buttons.filter((entry) => entry !== button) }
    }
    return { level, text: problem.text, jump: null, jumpLabel: '', buttons }
}

function noteItem(info: CostInfo): Omit<CheckItem, 'key'> {
    return {
        level: 'note',
        text: info.text,
        jump: info.layer ? { kind: 'layer', layer: info.layer } : null,
        jumpLabel: info.layer ? 'Click to select the layer' : '',
        buttons: [],
    }
}

export function checkItems(problems: ProjectProblems, notes: CostInfo[]): CheckItem[] {
    const items: CheckItem[] = []
    const seen = new Set<string>()
    const add = (item: Omit<CheckItem, 'key'>) => {
        const key = `${item.level}|${item.text}`
        if (seen.has(key)) return
        seen.add(key)
        items.push({ ...item, key })
    }
    for (const problem of problems.errors) add(problemItem(problem, 'error'))
    for (const problem of problems.warnings) add(problemItem(problem, 'warning'))
    for (const note of notes) add(noteItem(note))
    return items
}

export function countChecks(items: CheckItem[]): CheckCounts {
    const counts: CheckCounts = { errors: 0, warnings: 0, notes: 0 }
    for (const item of items) {
        if (item.level === 'error') counts.errors++
        else if (item.level === 'warning') counts.warnings++
        else counts.notes++
    }
    return counts
}

export function checksHeadline(counts: CheckCounts): string {
    if (counts.errors > 0) return `${plural(counts.errors, 'problem')} to fix before you can export.`
    if (counts.warnings > 0) return `Ready to export. ${counts.warnings === 1 ? 'The warning below doesn\'t' : 'The warnings below don\'t'} block it.`
    return 'Ready to export.'
}

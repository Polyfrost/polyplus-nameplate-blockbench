import { FORMAT_ID } from '../model'
import { Problem, problemButtons, projectProblems } from './issues'

const CHECK_ID = 'polyplus_nameplate_bundle'

let check: ValidatorCheck | null = null

function closeValidator() {
    Validator.dialog?.hide()
}

function report(problem: Problem) {
    const entry: { message: string, buttons?: Array<{ name: string, icon: string, click(): void }> } = { message: problem.text }
    const buttons = problemButtons(problem, closeValidator)
    if (buttons.length > 0) entry.buttons = buttons
    return entry
}

export function registerValidator() {
    if (check) return
    check = new ValidatorCheck(CHECK_ID, {
        update_triggers: [
            'select_project',
            'select_animation',
            'update_selection',
            'update_keyframe_selection',
            'finished_edit',
            'edit_animation_properties',
            'remove_animation',
        ] as any,
        condition: { formats: [FORMAT_ID] },
        run(this: ValidatorCheck) {
            const problems = projectProblems()
            for (const problem of problems.errors) this.fail(report(problem) as any)
            for (const problem of problems.warnings) this.warn(report(problem) as any)
        },
    })
}

export function unregisterValidator() {
    check?.delete()
    check = null
}

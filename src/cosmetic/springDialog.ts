import { hasProject } from '../util/project'
import { undoEdit } from '../util/undo'
import { SPRING_PROPERTY } from './project'
import { cosmeticState } from './state'
import { DEFAULT_SPRING, groupSpring, normalizeSpring, PRESET_NAMES, presetOf, SPRING_FIELDS, SPRING_PRESETS, SpringParams, storedSpring } from './springs'

const DIALOG_ID = 'polyplus_cosmetic_spring'
const CUSTOM = 'custom'

function selectedGroups(): Group[] {
    const selected = (Group as any).multi_selected ?? (Group.selected ? [Group.selected] : [])
    return (Array.isArray(selected) ? selected : [selected]).filter((group: unknown): group is Group => group instanceof Group)
}

export function springOf(group: Group): SpringParams | null {
    return groupSpring((group as any)[SPRING_PROPERTY])
}

export function springGroups(): Group[] {
    return typeof Group === 'undefined' ? [] : Group.all.filter((group) => springOf(group) !== null)
}

export function openSpringDialog(): Dialog | null {
    if (!hasProject()) return null
    const groups = selectedGroups()
    if (!groups.length) {
        Blockbench.showQuickMessage('Select a group first', 2000)
        return null
    }
    const current = springOf(groups[0])
    const start = current ?? DEFAULT_SPRING
    const presets: Record<string, string> = { ...PRESET_NAMES, [CUSTOM]: 'Custom' }
    const form: Record<string, unknown> = {
        on: { label: 'Swings', type: 'checkbox', value: current !== null },
        preset: { label: 'Preset', type: 'select', options: presets, value: presetOf(start) ?? CUSTOM, condition: (f: any) => f.on },
    }
    for (const field of SPRING_FIELDS) {
        form[field.key] = { label: field.label, type: 'number', value: start[field.key], min: field.min, max: field.max, step: field.step, condition: (f: any) => f.on }
    }
    form.collide = { label: 'Push out of the body', type: 'checkbox', value: start.collide, condition: (f: any) => f.on }
    const names = groups.map((group) => group.name).join(', ')
    const dialog: any = new Dialog({
        id: DIALOG_ID,
        title: groups.length > 1 ? `Spring: ${groups.length} groups` : `Spring: ${names}`,
        width: 420,
        form: form as any,
        onFormChange(this: any, result: any) {
            const preset = SPRING_PRESETS[result.preset]
            if (!preset) return
            const changed = SPRING_FIELDS.some((field) => Number(result[field.key]) !== preset[field.key]) || result.collide !== preset.collide
            if (changed && this.lastPreset === result.preset) {
                this.setFormValues({ preset: CUSTOM }, false)
                this.lastPreset = CUSTOM
                return
            }
            if (this.lastPreset !== result.preset) {
                this.lastPreset = result.preset
                this.setFormValues({ ...preset }, false)
            }
        },
        onConfirm(result: any) {
            const spring = result.on ? normalizeSpring(result) : null
            undoEdit({ groups }, 'Edit spring', () => {
                for (const group of groups) (group as any)[SPRING_PROPERTY] = storedSpring(spring)
            })
            cosmeticState.notify()
        },
    } as any)
    dialog.lastPreset = presetOf(start) ?? CUSTOM
    dialog.show()
    return dialog
}

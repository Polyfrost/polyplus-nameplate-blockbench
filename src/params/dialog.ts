import { currentBundle } from '../compile'
import { isNameplateActive } from '../format'
import { commitMaterials, readMaterials } from '../material/state'
import { guessRange, MaterialsState, ParamRange } from '../material/types'
import { defineFormatAction } from '../util/actions'
import { notifyNameplateChanged, readNameplate } from '../palette/state'
import { sanitizeId, uniqueId } from '../palette/ids'
import { sameSerialized } from '../util/json'
import { hasProject } from '../util/project'
import { pluralWord } from '../util/text'
import { formulaReads, materialsReading, MAX_PARAMS, renameInGraphs } from './store'

const DIALOG_ID = 'polyplus_nameplate_params'
export const PARAMS_ACTION = 'polyplus_nameplate_params'

interface Row {
    key: number
    from: string | null
    name: string
    value: number | string
    min: number | string
    max: number | string
    step: number | string
    label: string
    materials: string[]
    formula: boolean
}

function numberOr(value: unknown, fallback: number): number {
    const number = typeof value === 'string' && value.trim() === '' ? NaN : Number(value)
    return isFinite(number) ? number : fallback
}

function rowsOf(state: MaterialsState, manifest: string | undefined): Row[] {
    return Object.keys(state.params).map((name, index) => {
        const range = state.ranges[name] ?? guessRange(name, state.params[name])
        return {
            key: index,
            from: name,
            name,
            value: state.params[name],
            min: range.min,
            max: range.max,
            step: range.step,
            label: range.label,
            materials: materialsReading(state, name),
            formula: formulaReads(manifest, name),
        }
    })
}

function finalNames(rows: Row[]): string[] {
    const taken = new Set<string>()
    return rows.map((row) => {
        const name = uniqueId(sanitizeId(row.name.trim()) || 'number', (candidate) => taken.has(candidate))
        taken.add(name)
        return name
    })
}

function rangeOf(row: Row, name: string, value: number): ParamRange {
    let min = numberOr(row.min, Math.min(0, value))
    let max = numberOr(row.max, Math.max(1, value))
    if (min > max) [min, max] = [max, min]
    if (min === max) max = min + 1
    const step = numberOr(row.step, 0.01)
    const label = !row.label || row.label === row.from ? name : row.label
    return { label, min, max, step: step > 0 ? step : 0.01 }
}

function variantsNeedUpdate(renames: Map<string, string>, removed: Set<string>): boolean {
    const variants = (Project as any)?.nameplate?.variants
    if (!variants || typeof variants !== 'object') return false
    return Object.values<any>(variants).some((variant) => {
        const params = variant?.params
        return !!params && typeof params === 'object' && Object.keys(params).some((name) => renames.has(name) || removed.has(name))
    })
}

function updateVariants(renames: Map<string, string>, removed: Set<string>) {
    const plate = readNameplate()
    for (const variant of Object.values(plate.variants)) {
        if (!variant.params) continue
        const next: Record<string, number> = {}
        for (const [name, value] of Object.entries(variant.params)) {
            if (removed.has(name)) continue
            next[renames.get(name) ?? name] = value
        }
        if (Object.keys(next).length > 0) variant.params = next
        else delete variant.params
    }
    Project.nameplate = plate
}

function save(rows: Row[]) {
    const names = finalNames(rows)
    const before = readMaterials()
    const renames = new Map<string, string>()
    const kept = new Set<string>()
    rows.forEach((row, index) => {
        if (row.from === null) return
        kept.add(row.from)
        if (row.from !== names[index]) renames.set(row.from, names[index])
    })
    const removed = new Set(Object.keys(before.params).filter((name) => !kept.has(name)))
    const params: Record<string, number> = {}
    const ranges: Record<string, ParamRange> = {}
    rows.forEach((row, index) => {
        const name = names[index]
        const value = numberOr(row.value, row.from !== null ? before.params[row.from] ?? 0 : 0)
        params[name] = value
        ranges[name] = rangeOf(row, name, value)
    })
    for (const [name, range] of Object.entries(before.ranges)) {
        if (!(name in ranges) && !removed.has(name) && !renames.has(name)) ranges[name] = range
    }
    if (renames.size === 0 && sameSerialized(params, before.params) && sameSerialized(ranges, before.ranges)) return
    const touchVariants = variantsNeedUpdate(renames, removed)
    commitMaterials(
        'Edit shared numbers',
        (state) => {
            renameInGraphs(state, renames)
            state.params = params
            state.ranges = ranges
            if (touchVariants) updateVariants(renames, removed)
        },
        touchVariants ? { nameplate: true } : {},
    )
    if (touchVariants) notifyNameplateChanged()
}

export function openParamsDialog(): Dialog | null {
    if (!hasProject() || !isNameplateActive()) return null
    let manifest: string | undefined
    try {
        manifest = currentBundle().files['manifest.json']
    } catch {
        manifest = undefined
    }
    const state = { rows: rowsOf(readMaterials(), manifest), next: 0, max: MAX_PARAMS }
    state.next = state.rows.length
    const dialog: any = new Dialog({
        id: DIALOG_ID,
        title: 'Shared Numbers',
        width: 620,
        component: {
            data: () => state,
            methods: {
                add() {
                    if (state.rows.length >= MAX_PARAMS) return
                    const taken = new Set(state.rows.map((row) => sanitizeId(row.name)))
                    const name = uniqueId('number', (candidate) => taken.has(candidate))
                    state.rows.push({ key: state.next++, from: null, name, value: 1, min: 0, max: 2, step: 0.05, label: '', materials: [], formula: false })
                },
                remove(index: number) {
                    const row = state.rows[index]
                    if (!row || row.materials.length > 0) return
                    state.rows.splice(index, 1)
                },
                tidy(row: Row) {
                    row.name = sanitizeId(row.name.trim()) || row.name
                },
                usage(row: Row): string {
                    const parts: string[] = []
                    if (row.materials.length > 0) parts.push(`Read by the ${pluralWord(row.materials.length, 'graph')} ${row.materials.join(', ')}, shown as a slider on each effect.`)
                    if (row.formula) parts.push(`A formula reads it as q.variant_param('${row.from}').`)
                    if (row.from !== null && sanitizeId(row.name.trim()) !== row.from && row.formula) parts.push('Formulas still use the old name; change them to the new one.')
                    if (parts.length === 0) parts.push(`Not used yet. A formula reads it as q.variant_param('${sanitizeId(row.name.trim()) || 'name'}').`)
                    return parts.join(' ')
                },
                removeTitle(row: Row): string {
                    return row.materials.length > 0 ? `A graph reads this number. Remove its Slider node first (${row.materials.join(', ')}).` : 'Remove this number'
                },
            },
            template: `
                <div class="np-params">
                    <p>Numbers that effects and formulas share. A variant can give any of them its own value.</p>
                    <p v-if="!rows.length" class="np-subtle">No shared numbers yet. Add one below, or add an effect from a starter.</p>
                    <div v-for="(row, index) in rows" :key="row.key" style="padding: 4px 0 8px; border-bottom: 1px solid var(--color-border);">
                        <div class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <label class="name_space_left" style="flex: none;">Name</label>
                            <input type="text" class="dark_bordered" style="flex: 2; min-width: 0;" v-model="row.name" @change="tidy(row)">
                            <label style="flex: none;">Value</label>
                            <input type="number" class="dark_bordered" style="flex: 1; min-width: 0;" v-model="row.value" :step="row.step">
                            <i class="material-icons notranslate icon" :class="{ 'np-icon-button': !row.materials.length }" :style="row.materials.length ? 'opacity: 0.35' : ''" :title="removeTitle(row)" @click="remove(index)">delete</i>
                        </div>
                        <div class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <label class="name_space_left" style="flex: none;">Slider from</label>
                            <input type="number" class="dark_bordered" style="flex: 1; min-width: 0;" v-model="row.min">
                            <label style="flex: none;">to</label>
                            <input type="number" class="dark_bordered" style="flex: 1; min-width: 0;" v-model="row.max">
                            <label style="flex: none;">in steps of</label>
                            <input type="number" class="dark_bordered" style="flex: 1; min-width: 0;" v-model="row.step" min="0">
                        </div>
                        <p class="np-subtle" style="margin: 2px 0 0;">{{ usage(row) }}</p>
                    </div>
                    <p v-if="rows.length > max" style="color: var(--color-error, #e85050)">A nameplate can have at most {{ max }} shared numbers.</p>
                    <div style="padding-top: 8px;">
                        <button type="button" @click="add()"><i class="material-icons notranslate icon">add</i> Add a number</button>
                    </div>
                </div>
            `,
        },
        onConfirm() {
            if (state.rows.length > MAX_PARAMS) return false
            save(state.rows)
        },
    } as any)
    dialog.show()
    return dialog
}

export function registerParamsAction(): Action {
    return defineFormatAction(PARAMS_ACTION, {
        name: 'Shared Numbers',
        description: 'Numbers that effects and formulas share',
        icon: 'tune',
        click: () => {
            openParamsDialog()
        },
    })
}

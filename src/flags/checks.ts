import { SELECT_LAYER } from '../checks/helpers'
import { layerNodes } from '../elements/nodes'
import { BODY_TYPE, FORMAT_ID } from '../model'
import { showLayer } from '../navigate'
import { readNameplate } from '../palette/state'
import { pluralWord } from '../util/text'
import { readFlags } from './state'
import { FLAG_LIMITS, FlagsState, overlayColorRange } from './types'

const FLAG_CHECK_ID = 'polyplus_nameplate_flags'

interface FlagBody {
    name: string
    rows: number
    usesFlag: boolean
}

interface FlagProblem {
    level: 'error' | 'warning'
    message: string
    body?: string
}

export function flagProblems(
    state: FlagsState,
    bodies: FlagBody[],
    variants: string[],
    slots: Map<string, number>,
): FlagProblem[] {
    const problems: FlagProblem[] = []
    const ids = new Set<string>()
    const flagged = bodies.filter((body) => body.usesFlag)
    if (state.flags.length > FLAG_LIMITS.flags) {
        problems.push({ level: 'error', message: `There are ${state.flags.length} flags; the most is ${FLAG_LIMITS.flags}. Delete some under Fill in the Inspector (select a body filled with a flag).` })
    }
    for (const flag of state.flags) {
        const name = `Flag '${flag.id}'`
        if (!/^[a-z0-9_]{1,64}$/.test(flag.id)) {
            problems.push({ level: 'error', message: `${name}: use only a-z, 0-9 and _ in its ID. Rename it under Fill in the Inspector (select a body filled with a flag).` })
        }
        if (ids.has(flag.id)) problems.push({ level: 'error', message: `Two flags are called '${flag.id}'. Rename one under Fill in the Inspector (select a body filled with a flag).` })
        ids.add(flag.id)
        if (flag.bands.length === 0 || flag.bands.length > FLAG_LIMITS.bands) {
            problems.push({ level: 'error', message: `${name} needs 1 to ${FLAG_LIMITS.bands} bands.` })
        }
        flag.bands.forEach((band, index) => {
            if (!colorKnown(band.color, slots)) {
                problems.push({ level: 'error', message: `${name}: band ${index + 1} uses '${band.color}', which is not in the palette. Pick a palette color for it.` })
            }
        })
        const weights = flag.bands.map((band) => band.weight)
        if (flag.symmetric && weights.join(',') !== weights.slice().reverse().join(',')) {
            problems.push({ level: 'error', message: `${name} is Mirrored, but its band sizes (${weights.join(', ')}) don't read the same both ways. Turn Mirrored off or match the sizes.` })
        }
        if (flag.overlay) {
            const [least, most] = overlayColorRange(flag.overlay.kind)
            if (flag.overlay.colors.length < least || flag.overlay.colors.length > most) {
                problems.push({ level: 'error', message: `${name}: a ${flag.overlay.kind} takes ${least === most ? least : `${least} to ${most}`} ${pluralWord(most, 'color')}.` })
            }
            flag.overlay.colors.forEach((color, index) => {
                if (!colorKnown(color, slots)) {
                    problems.push({ level: 'error', message: `${name}: shape color ${index + 1} uses '${color}', which is not in the palette. Pick a palette color for it.` })
                }
            })
        }
        const columns = flag.axis === 'columns'
        if (columns && Object.keys(flag.rowsOverride).length > 0) {
            problems.push({ level: 'warning', message: `${name}: its stripes run down, so its hand-set rows are not used. They are kept and come back if Stripes run is set to Across.` })
        }
        for (const rows of columns ? [] : Object.keys(flag.rowsOverride)) {
            const list = flag.rowsOverride[rows]
            const sum = list.reduce((total, value) => total + value, 0)
            if (list.length !== flag.bands.length || list.some((value) => value < 1) || sum !== Number(rows)) {
                problems.push({ level: 'error', message: `${name}: the hand-set rows for ${rows} rows (${list.join(', ')}) must give each of its ${flag.bands.length} bands 1 or more rows and add up to ${rows}. Fix them under Row fit.` })
            }
        }
        for (const body of columns ? [] : flagged) {
            if (flag.bands.length > body.rows) {
                problems.push({ level: 'error', message: `${name} has ${flag.bands.length} bands, but body '${body.name}' is only ${body.rows} rows tall. Add top or bottom padding to the body, or remove bands.`, body: body.name })
            }
        }
    }
    for (const key of Object.keys(state.variants)) {
        if (!variants.includes(key)) continue
        if (!ids.has(state.variants[key])) {
            problems.push({ level: 'error', message: `Variant '${key}' shows flag '${state.variants[key]}', which is gone. Pick another under Fill in the Inspector (select a body filled with a flag).` })
        }
    }
    if (flagged.length > 0 && state.flags.length === 0) {
        for (const body of flagged) {
            problems.push({ level: 'error', message: `Body '${body.name}' is filled with a flag, but there are no flags. Select it and add one under Fill in the Inspector.`, body: body.name })
        }
    }
    if (state.flags.length > 0 && flagged.length === 0) {
        problems.push({ level: 'warning', message: 'There are flags, but no body shows them. Select a body and set its Fill to Flag in the Inspector.' })
    }
    return problems
}

function colorKnown(ref: string, slots: Map<string, number>): boolean {
    if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(ref)) return true
    const match = /^([a-z0-9_]+)(?:\[(\d+)\])?$/.exec(ref)
    if (!match) return false
    const tones = slots.get(match[1])
    return tones !== undefined && Number(match[2] ?? 0) < tones
}

export function projectFlagProblems(): Array<FlagProblem & { node: any | null }> {
    const nodes = layerNodes().filter((node) => node.type === BODY_TYPE)
    const bodies: FlagBody[] = nodes.map((node) => {
        const padding: number[] = Array.isArray(node.padding) ? node.padding : [0, 0, 0, 0]
        const fills = [node.fill, ...(Array.isArray(node.rings) ? node.rings : [])]
        return {
            name: String(node.name ?? ''),
            rows: FLAG_LIMITS.glyphHeight + (Number(padding[1]) || 0) + (Number(padding[3]) || 0),
            usesFlag: fills.some((fill) => fill?.kind === 'flag'),
        }
    })
    const plate = readNameplate()
    const slots = new Map<string, number>()
    for (const slot of plate.palette.slots) slots.set(slot.id, slot.ramp.length)
    return flagProblems(readFlags(), bodies, Object.keys(plate.variants), slots).map((problem) => ({
        ...problem,
        node: problem.body ? (nodes.find((node) => String(node.name ?? '') === problem.body) ?? null) : null,
    }))
}

export function createFlagCheck(): ValidatorCheck {
    return new ValidatorCheck(FLAG_CHECK_ID, {
        update_triggers: ['select_project', 'update_selection', 'finished_edit'],
        condition: { formats: [FORMAT_ID] },
        run(this: ValidatorCheck) {
            for (const problem of projectFlagProblems()) {
                const report: any = { message: problem.message }
                if (problem.node) report.buttons = [{ ...SELECT_LAYER, name: 'Select body', click: () => showLayer(problem.node) }]
                if (problem.level === 'error') this.fail(report)
                else this.warn(report)
            }
        },
    } as any)
}

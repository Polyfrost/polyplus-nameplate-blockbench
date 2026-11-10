import { fillFromParts } from '../elements/fill'
import { limited, limitedPair, noteLimit } from '../elements/limits'
import { NAME_MASK } from '../model'
import { readNameplate } from '../palette/state'
import { slotChoices, ToneChoice, toneChoices } from '../palette/tones'
import { CORNER_NAMES, CORNERS_PROPERTY, Corners, cornerValue, MAX_CORNER, readCorners } from '../corners/shape'
import { artFormConfig, artFormValues, applyArtField, isArtKey } from '../art/form'
import { custom, field, FormConfig, group, heading, Part, Values, withCurrent } from '../schema/form'
import { cloneJson } from '../util/json'

const MAX_RINGS = 4
const SLOT_FILLS = ['gradient', 'blend', 'sweep']
const TARGET_LABELS: Record<string, string> = { '': 'The whole tag', [NAME_MASK]: 'Just the name' }
const FILL_LABELS: Record<string, string> = {
    none: 'No fill',
    color: 'One color',
    gradient: 'Gradient',
    blend: 'Blend',
    sweep: 'Sweep',
    flag: 'Flag (set up below)',
}
const RING_LABELS: Record<string, string> = {
    color: 'One color',
    gradient: 'Gradient',
    blend: 'Blend',
    sweep: 'Sweep',
    flag: 'Flag (set up under Fill)',
}
const CORNER_KEYS = ['corner_tl', 'corner_tr', 'corner_br', 'corner_bl'] as const
const CUSTOM_CORNERS = 'custom'
const CORNER_PRESETS: Record<string, { label: string, corners: Corners, separate: boolean }> = {
    square: { label: 'Square', corners: [0, 0, 0, 0], separate: false },
    rounded: { label: 'Rounded', corners: [3, 3, 3, 3], separate: false },
    pill: { label: 'Pill', corners: [MAX_CORNER, MAX_CORNER, MAX_CORNER, MAX_CORNER], separate: false },
    dome: { label: 'Dome (round top, flat bottom)', corners: [MAX_CORNER, MAX_CORNER, 0, 0], separate: true },
    bowl: { label: 'Bowl (flat top, round bottom)', corners: [0, 0, MAX_CORNER, MAX_CORNER], separate: true },
}
const CORNER_PRESET_LABELS: Record<string, string> = { [CUSTOM_CORNERS]: 'Custom' }
for (const [key, preset] of Object.entries(CORNER_PRESETS)) CORNER_PRESET_LABELS[key] = preset.label

interface FillKeys {
    color: string
    slot: string
    axis: string
}

interface FillCurrent {
    ref: unknown
    slot: unknown
    color: string
    slotted: string
}

function fillFields(keys: FillKeys, tones: Record<string, ToneChoice>, slots: Record<string, ToneChoice>, current: FillCurrent, kind: (result: Values) => string, axisDescription?: string): FormConfig {
    const axis: FormElementOptions = { type: 'select', label: 'Direction', options: { x: 'Across', y: 'Down' }, condition: (result: any) => kind(result) === 'sweep' }
    if (axisDescription) axis.description = axisDescription
    return {
        [keys.color]: { type: 'select', label: 'Color', options: withCurrent(tones, current.color, `${current.ref} (missing)`), condition: (result: any) => kind(result) === 'color' },
        [keys.slot]: { type: 'select', label: 'Color', options: withCurrent(slots, current.slotted, `${current.slot} (missing)`), condition: (result: any) => SLOT_FILLS.includes(kind(result)) },
        [keys.axis]: axis,
    }
}

function firstSlot(): string {
    return readNameplate().palette.slots[0]?.id ?? ''
}

function fillFrom(kind: unknown, color: unknown, slot: unknown, axis: unknown): any {
    return fillFromParts({ kind, ref: color, slot, axis }) ?? { kind: 'none' }
}

const fill: Part = custom(
    (key) => key === 'fill_kind' || key === 'fill_color' || key === 'fill_slot' || key === 'fill_axis',
    (node) => {
        const current = node.fill ?? { kind: 'none' }
        const kindOf = (result: Values) => result?.fill_kind
        return {
            fill_title: { type: 'info', text: '**Fill**' },
            fill_kind: { type: 'select', label: 'Fill', options: FILL_LABELS, value: 'none', description: 'Gradient: one band per shade. Blend: shades mixed smoothly. Sweep: bands for a moving shine' },
            ...fillFields({ color: 'fill_color', slot: 'fill_slot', axis: 'fill_axis' }, toneChoices(), slotChoices(), { ref: current.ref, slot: current.slot, color: current.ref ?? '', slotted: current.slot ?? '' }, kindOf),
        }
    },
    (node) => {
        const current = node.fill ?? { kind: 'none' }
        return {
            fill_kind: FILL_LABELS[current.kind] ? current.kind : 'none',
            fill_color: current.ref ?? '',
            fill_slot: current.slot ?? firstSlot(),
            fill_axis: current.axis === 'y' ? 'y' : 'x',
        }
    },
    (node, _key, result) => {
        node.fill = fillFrom(result.fill_kind, result.fill_color, result.fill_slot, result.fill_axis)
    },
)

const rings: Part = custom(
    (key) => key.startsWith('ring_') || key === 'outline_title',
    (node) => {
        const tones = toneChoices()
        const slots = slotChoices()
        const list: any[] = Array.isArray(node.rings) ? node.rings : []
        const config: FormConfig = { outline_title: { type: 'info', text: '**Outlines**' } }
        for (let index = 0; index < MAX_RINGS; index++) {
            const shown = (result: any) => {
                for (let before = 0; before < index; before++) if (!result?.[`ring_${before}`]) return false
                return true
            }
            const kind = (result: any) => (shown(result) ? String(result?.[`ring_${index}`] ?? '') : '')
            config[`ring_${index}`] = {
                type: 'select',
                label: `Outline ${index + 1}`,
                options: { '': index === 0 ? 'No outline' : 'None', ...RING_LABELS },
                condition: index === 0 ? undefined : shown,
                description: index === 0 ? 'A 1-pixel ring outside the body. Each extra outline sits outside the one before' : undefined,
            }
            const ring = list[index]
            const current = { ref: ring?.ref, slot: ring?.slot, color: ring?.kind === 'color' ? String(ring.ref ?? '') : '', slotted: ring && SLOT_FILLS.includes(ring.kind) ? String(ring.slot ?? '') : '' }
            Object.assign(config, fillFields({ color: `ring_${index}_color`, slot: `ring_${index}_slot`, axis: `ring_${index}_axis` }, tones, slots, current, kind, 'Across can cost a lot on long names'))
        }
        return config
    },
    (node) => {
        const tones = toneChoices()
        const slot = firstSlot()
        const list: any[] = Array.isArray(node.rings) ? node.rings : []
        const values: Values = {}
        for (let index = 0; index < MAX_RINGS; index++) {
            const ring = list[index]
            values[`ring_${index}`] = ring && RING_LABELS[ring.kind] ? String(ring.kind) : ''
            values[`ring_${index}_color`] = ring?.kind === 'color' && ring.ref ? String(ring.ref) : (Object.keys(tones)[0] ?? '')
            values[`ring_${index}_slot`] = ring && SLOT_FILLS.includes(ring.kind) && ring.slot ? String(ring.slot) : slot
            values[`ring_${index}_axis`] = ring?.axis === 'y' ? 'y' : 'x'
        }
        return values
    },
    (node, _key, result) => {
        const current: any[] = Array.isArray(node.rings) ? node.rings : []
        const next: any[] = []
        for (let index = 0; index < MAX_RINGS; index++) {
            const kind = String(result[`ring_${index}`] ?? '')
            if (!RING_LABELS[kind]) break
            next.push(fillFrom(kind, result[`ring_${index}_color`], result[`ring_${index}_slot`], result[`ring_${index}_axis`]))
        }
        node.rings = [...next, ...current.slice(MAX_RINGS).map((ring) => cloneJson(ring))]
    },
)

function shownCorners(node: any): { corners: Corners, split: boolean } {
    const corners = readCorners(node)
    if (corners) return { corners, split: true }
    const radius = cornerValue(node.radius)
    return { corners: [radius, radius, radius, radius], split: false }
}

function cornerPreset(corners: Corners, split: boolean): string {
    for (const [key, preset] of Object.entries(CORNER_PRESETS)) {
        if (preset.separate === split && preset.corners.every((value, index) => value === corners[index])) return key
    }
    return CUSTOM_CORNERS
}

const corners: Part = custom(
    (key) => key === 'corner_preset' || key === 'radius' || key === 'corner_split' || (CORNER_KEYS as readonly string[]).includes(key),
    () => {
        const separate = (result: any) => !!result?.corner_split
        const config: FormConfig = {
            corner_preset: { type: 'select', label: 'Corner shape', options: CORNER_PRESET_LABELS, value: CUSTOM_CORNERS },
            radius: { type: 'number', label: 'Corner roundness (px)', step: 1, value: 0, condition: (result: any) => !separate(result), description: '0 is a sharp corner' },
            corner_split: { type: 'checkbox', label: 'Separate corners', style: 'toggle_switch', value: false } as any,
        }
        CORNER_KEYS.forEach((key, index) => {
            config[key] = { type: 'number', label: `${CORNER_NAMES[index]} (px)`, step: 1, value: 0, condition: separate }
        })
        return config
    },
    (node) => {
        const { corners: shown, split } = shownCorners(node)
        const values: Values = { corner_preset: cornerPreset(shown, split), radius: node.radius ?? 0, corner_split: split }
        CORNER_KEYS.forEach((key, index) => { values[key] = shown[index] })
        return values
    },
    (node, key, result) => {
        switch (key) {
            case 'corner_preset': {
                const preset = CORNER_PRESETS[String(result.corner_preset)]
                if (!preset) return
                if (preset.separate) {
                    node[CORNERS_PROPERTY] = preset.corners.slice()
                } else {
                    node.radius = preset.corners[0]
                    node[CORNERS_PROPERTY] = []
                }
                return
            }
            case 'radius':
                noteLimit(result.radius, 0, MAX_CORNER, 'Corner roundness')
                node.radius = cornerValue(result.radius, node.radius ?? 0)
                return
            case 'corner_split': {
                const { corners: shown } = shownCorners(node)
                if (result.corner_split) {
                    node[CORNERS_PROPERTY] = shown.slice()
                } else {
                    node.radius = Math.max(...shown)
                    node[CORNERS_PROPERTY] = []
                }
                return
            }
        }
        const index = (CORNER_KEYS as readonly string[]).indexOf(key)
        const { corners: shown } = shownCorners(node)
        noteLimit(result[key], 0, MAX_CORNER, CORNER_NAMES[index])
        shown[index] = cornerValue(result[key], shown[index])
        node[CORNERS_PROPERTY] = shown
    },
)

function paddingField(key: string, label: string, first: number, second: number): Part {
    return field(key, {
        input: { type: 'vector', label, dimensions: 2, step: 1, force_step: true, value: [0, 0] } as any,
        get: (node) => {
            const padding: number[] = Array.isArray(node.padding) ? node.padding : [0, 0, 0, 0]
            return [padding[first] ?? 0, padding[second] ?? 0]
        },
        set: (node, value) => {
            const [a, b] = limitedPair(value, 0, Infinity, 'Padding')
            const padding = Array.isArray(node.padding) ? node.padding.slice() : [0, 0, 0, 0]
            padding[first] = a
            padding[second] = b
            node.padding = padding
        },
    })
}

const art: Part = custom(isArtKey, artFormConfig, artFormValues, (node, key, result) => {
    applyArtField(node, key, result)
})

export function bodyForm(placement: Part): Part {
    return group(
        heading('shape', 'Shape'),
        field('of', {
            input: { type: 'select', label: 'Wraps', options: TARGET_LABELS, description: 'Just the name leaves a rank or second line outside this body' },
            get: (node) => (node.of === NAME_MASK ? NAME_MASK : ''),
            set: (node, value) => {
                node.of = String(value ?? '')
            },
        }),
        paddingField('padding_x', 'Padding left, right (px)', 0, 2),
        paddingField('padding_y', 'Padding top, bottom (px)', 1, 3),
        field('min_width', {
            input: { type: 'number', label: 'Minimum width (px)', step: 1, value: 0 },
            get: (node) => node.minWidth ?? 0,
            set: (node, value) => {
                node.minWidth = limited(value, 0, Infinity, node.minWidth ?? 0, 'Minimum width')
            },
        }),
        corners,
        fill,
        rings,
        art,
        placement,
    )
}

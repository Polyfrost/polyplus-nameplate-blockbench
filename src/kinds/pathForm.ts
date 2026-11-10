import { bodyOptions, currentNode, flag, list, paintPicture, percentOf, PERCENT, rangesPart, textureOptions, followPart, whole, WHOLE_TAG } from './motionForm'
import { limited, limitedPair, limitedValue, tell } from '../elements/limits'
import { ANCHOR_LABELS, framesFieldDescription } from '../motion/form'
import { readBreakpoints, readFacings, readPoints, readStops } from '../motion/read'
import { EDGE_ANCHORS, FACINGS, LIMITS, PATH_PRESETS } from '../motion/types'
import { custom, field, group, heading, labeled, note, Part, Values } from '../schema/form'
import { decimalClamped } from '../util/num'
import { pictureFields } from '../util/form'
import { findTexture } from '../util/texture'
import { frameCountOf } from '../palette/sprites'
import { widthRanges } from './ranges'

const PRESET_LABELS: Record<string, string> = {
    top: 'Along the top edge',
    bottom: 'Along the bottom edge',
    perimeter: 'All the way around',
    custom: 'My own points',
}
const END_LABELS: Record<string, string> = {
    wrap: 'Start again from the beginning',
    bounce: 'Turn around and come back',
    stop: 'Stop at the end',
}
const TIMING_LABELS: Record<string, string> = {
    speed: 'Speed',
    laps: 'Laps per loop',
}
const FACING_LABELS: Record<string, string> = {
    right: 'Walking right',
    left: 'Walking left',
    up: 'Walking up',
    down: 'Walking down',
}
const MAX_FORM_POINTS = 16
const MIN_SPEED = 0.05
const NEW_STOP_PAUSE = 8

const isCustom = (result: Values) => result?.path_preset === 'custom'
const following = (result: Values) => !isCustom(result) && !!result?.follow
const byLaps = (result: Values) => result?.timing === 'laps'
const severalWalkers = (result: Values) => Number(result?.walkers ?? 1) > 1
const anchors = () => labeled(EDGE_ANCHORS, ANCHOR_LABELS)

const pathRanges = widthRanges({
    prefix: 'bp',
    read: (node) => readBreakpoints(node.breakpoints),
    onDescription: 'Hides this layer outside the ranges below',
    pictures: (node, index) => textureOptions('Same picture', readBreakpoints(node.breakpoints)[index]?.texture ?? ''),
    fallback: 'current',
})

function frameList(text: unknown): number[] {
    return String(text ?? '')
        .split(/[\s,]+/)
        .map((part) => Number(part))
        .filter((value) => Number.isInteger(value) && value >= 0)
}

function pointsFrom(node: any, result: Values): any[] {
    const current = readPoints(node.points)
    const count = limited(result.point_count, 2, MAX_FORM_POINTS, 2, 'Points')
    const list: any[] = []
    for (let index = 0; index < count; index++) {
        const anchor = result[`point_${index}_anchor`]
        list.push({
            anchor: EDGE_ANCHORS.includes(anchor) ? anchor : (current[index]?.anchor ?? (index % 2 === 0 ? 'top_left' : 'top_right')),
            offset: result[`point_${index}_offset`] === undefined ? (current[index]?.offset ?? [0, 0]) : limitedPair(result[`point_${index}_offset`], -LIMITS.offset, LIMITS.offset, `Point ${index + 1} nudge`),
            pause: result[`point_${index}_pause`] === undefined ? (current[index]?.pause ?? 0) : limited(result[`point_${index}_pause`], 0, LIMITS.pause, 0, `Point ${index + 1} wait`),
        })
    }
    return [...list, ...current.slice(MAX_FORM_POINTS)]
}

function nextStopAt(stops: Array<{ at: number }>): number {
    const last = stops.length > 0 ? stops[stops.length - 1].at : 0
    return Math.round((last + 1) / 2 * PERCENT) / PERCENT
}

function stopsFrom(node: any, result: Values): any[] {
    const current = readStops(node.stops)
    const count = limited(result.stop_count, 0, LIMITS.stops, Math.min(LIMITS.stops, current.length), 'Waits along the path')
    const list: any[] = []
    for (let index = 0; index < count; index++) {
        const stop = current[index]
        const at = result[`stop_${index}_at`]
        const pause = result[`stop_${index}_pause`]
        const same = !stop || at === undefined || Number(at) === percentOf(stop.at)
        list.push({
            at: same ? (stop?.at ?? nextStopAt(list)) : limitedValue(at, 0, PERCENT, percentOf(stop.at), `Wait ${index + 1} at`) / PERCENT,
            pause: pause === undefined ? (stop?.pause ?? NEW_STOP_PAUSE) : limited(pause, 1, LIMITS.pause, stop?.pause ?? NEW_STOP_PAUSE, `Wait ${index + 1} for`),
        })
    }
    return [...list, ...current.slice(LIMITS.stops)]
}

function lapCount(value: unknown, fallback: number): number {
    if (Number(value) > LIMITS.laps) {
        tell(`The most is ${LIMITS.laps} laps per loop, so it was set to ${LIMITS.laps}. To go faster, make the loop shorter.`)
        return LIMITS.laps
    }
    return limited(value, 1, LIMITS.laps, fallback, 'Laps per loop')
}

function presetPoints(preset: string): any[] {
    const anchors = PATH_PRESETS[preset as keyof typeof PATH_PRESETS] ?? PATH_PRESETS.top
    return anchors.map((anchor) => ({ anchor, offset: [0, 0], pause: 0 }))
}

function applySpeed(node: any, speed: number) {
    if (!(speed >= MIN_SPEED)) {
        tell(`Speed here must be at least ${MIN_SPEED}, so it stays at ${node.speed ?? 1}. To go the other way, turn on Run backwards.`)
        return
    }
    if (speed > LIMITS.speed) tell(`The fastest Speed is ${LIMITS.speed}, so it was set to ${LIMITS.speed}.`)
    node.speed = decimalClamped(speed, MIN_SPEED, LIMITS.speed, node.speed ?? 1)
}

function facingsFrom(result: Values): Record<string, number[]> {
    const facings: Record<string, number[]> = {}
    if (!result.facing_on) return facings
    for (const facing of FACINGS) {
        const frames = frameList(result[`facing_${facing}`])
        if (frames.length > 0) facings[facing] = frames
    }
    if (!facings.right && !facings.left) facings.right = [0]
    return facings
}

function picture(onImport: () => void): Part {
    return custom(
        (key) => key === 'texture',
        (node) => pictureFields({
            textureOptions: textureOptions('None', node.texture ?? ''),
            importDescription: 'Replace this picture with a PNG file',
            framesDescription: framesFieldDescription(),
            onImport: () => onImport(),
            onPaint: () => paintPicture(currentNode()?.texture),
        }),
        (node) => {
            const texture = findTexture(node.texture)
            return { texture: node.texture ?? '', frames: texture ? frameCountOf(texture) : 1 }
        },
        (node, _key, result) => {
            node.texture = String(result.texture ?? '')
        },
    )
}

const points = list({
    count: 'point_count',
    countInput: { type: 'number', label: 'Points', step: 1, value: 2, condition: isCustom as any },
    owns: (key) => key.startsWith('point_'),
    total: (node) => Math.max(2, Math.min(MAX_FORM_POINTS, readPoints(node.points).length || 2)),
    row: (index) => {
        const shown = (result: Values) => isCustom(result) && Number(result?.point_count ?? 2) > index
        return {
            [`point_${index}_anchor`]: { type: 'select', label: `Point ${index + 1}`, options: anchors(), condition: shown as any },
            [`point_${index}_offset`]: { type: 'vector', label: `Point ${index + 1} nudge x, y (px, + is down)`, dimensions: 2, step: 1, force_step: true, value: [0, 0], condition: shown as any },
            [`point_${index}_pause`]: { type: 'number', label: `Point ${index + 1} wait (frames)`, step: 1, value: 0, condition: shown as any, description: 'Needs a steady speed' },
        }
    },
    values: (node) => {
        const entries = readPoints(node.points)
        const values: Values = { point_count: Math.max(2, Math.min(MAX_FORM_POINTS, entries.length || 2)) }
        entries.slice(0, MAX_FORM_POINTS).forEach((point, index) => {
            values[`point_${index}_anchor`] = point.anchor
            values[`point_${index}_offset`] = point.offset
            values[`point_${index}_pause`] = point.pause
        })
        return values
    },
    apply: (node, result) => {
        node.points = pointsFrom(node, result)
    },
})

const stops = list({
    count: 'stop_count',
    countInput: { type: 'number', label: 'Waits along the path', step: 1, value: 0, condition: ((result: Values) => !isCustom(result)) as any, description: `The most is ${LIMITS.stops}. Needs a steady speed, with no Speed keyframes` },
    owns: (key) => key.startsWith('stop_'),
    total: (node) => Math.min(LIMITS.stops, readStops(node.stops).length),
    row: (index) => {
        const shown = (result: Values) => !isCustom(result) && Number(result?.stop_count ?? 0) > index
        return {
            [`stop_${index}_at`]: { type: 'number', label: `Wait ${index + 1} at (% of the path)`, step: 1, value: 50, condition: shown as any, description: '50 is halfway. Each wait must come after the one before' },
            [`stop_${index}_pause`]: { type: 'number', label: `Wait ${index + 1} for (frames)`, step: 1, value: NEW_STOP_PAUSE, condition: shown as any, description: 'Hold each frame multiplies this' },
        }
    },
    values: (node) => {
        const entries = readStops(node.stops)
        const values: Values = { stop_count: Math.min(LIMITS.stops, entries.length) }
        entries.slice(0, LIMITS.stops).forEach((stop, index) => {
            values[`stop_${index}_at`] = percentOf(stop.at)
            values[`stop_${index}_pause`] = stop.pause
        })
        return values
    },
    apply: (node, result) => {
        node.stops = stopsFrom(node, result)
    },
})

const setFacings = (node: any, _value: unknown, result: Values) => {
    node.facings = facingsFrom(result)
}

const facings: Part = group(
    heading('facing_title', 'Direction frames'),
    field('facing_on', {
        input: { type: 'checkbox', label: 'Different frames per direction', style: 'toggle_switch', value: false, description: 'A missing left or right is the other one flipped' } as any,
        get: (node) => Object.keys(readFacings(node.facings)).length > 0,
        set: setFacings,
    }),
    ...FACINGS.map((facing) => field(`facing_${facing}`, {
        input: {
            type: 'text',
            label: FACING_LABELS[facing],
            placeholder: facing === 'right' ? 'e.g. 0, 1' : 'empty: use the others',
            condition: ((result: Values) => !!result?.facing_on) as any,
            description: 'Frame numbers, starting at 0, separated by commas',
        },
        get: (node) => (readFacings(node.facings)[facing] ?? []).join(', '),
        set: setFacings,
    })),
)

export function pathForm(placement: Part, onImport: () => void): Part {
    return group(
        picture(onImport),
        heading('route_title', 'Path'),
        field('path_preset', {
            input: { type: 'select', label: 'Path', options: PRESET_LABELS, value: 'top' },
            get: (node) => (typeof node.preset === 'string' && node.preset in PATH_PRESETS ? node.preset : 'custom'),
            set: (node, value) => {
                const preset = String(value ?? 'top')
                if (preset === 'custom') {
                    if (node.preset) node.points = presetPoints(node.preset)
                    node.preset = ''
                } else if (preset in PATH_PRESETS) {
                    node.preset = preset
                }
            },
        }),
        field('of', {
            input: (node) => ({ type: 'select', label: 'Follows', options: bodyOptions(node.of ?? '', WHOLE_TAG) }),
            get: (node) => node.of ?? '',
            set: (node, value) => {
                node.of = String(value ?? '')
            },
        }),
        followPart('follow', (result) => !isCustom(result)),
        note('route_custom_note', "Copies run in straight lines here. To follow the body's edge, pick a ready-made path.", isCustom),
        points,
        field('pivot', {
            input: { type: 'select', label: 'Own point on the path', options: anchors(), condition: ((result: Values) => !following(result)) as any, description: 'Bottom middle walks on top of an edge' },
            get: (node) => (EDGE_ANCHORS.includes(node.pivot) ? node.pivot : 'bottom'),
            set: (node, value) => {
                node.pivot = String(value ?? '')
            },
        }),
        field('offset', {
            input: { type: 'vector', label: 'Nudge x, y (px, + is down)', dimensions: 2, step: 1, force_step: true, value: [0, 0] },
            get: (node) => {
                const offset: number[] = Array.isArray(node.offset) ? node.offset : [0, 0]
                return [offset[0] ?? 0, offset[1] ?? 0]
            },
            set: (node, value) => {
                const pair = Array.isArray(value) ? value : [0, 0]
                node.offset = [Math.round(Number(pair[0])) || 0, Math.round(Number(pair[1])) || 0]
            },
        }),
        heading('move_title', 'Movement'),
        field('timing', {
            input: { type: 'select', label: 'Timing', options: TIMING_LABELS, value: 'speed', description: 'Speed: longer names take longer. Laps per loop: the pace changes with the name' },
            get: (node) => (node.lapsOn ? 'laps' : 'speed'),
            set: (node, value) => {
                node.lapsOn = value === 'laps'
            },
        }),
        field('speed', {
            input: { type: 'number', label: 'Speed (px per frame)', step: 0.25, value: 1, condition: ((result: Values) => !byLaps(result)) as any, description: 'To change speed over time, add Speed keyframes in Animate' },
            get: (node) => Number(node.speed ?? 1),
            set: (node, value) => applySpeed(node, Number(value)),
        }),
        field('laps', {
            input: { type: 'number', label: 'Laps per loop', step: 1, value: 1, condition: byLaps as any, description: `The most is ${LIMITS.laps}` },
            get: (node) => Number(node.laps ?? 1),
            set: (node, value) => {
                node.laps = lapCount(value, node.laps ?? 1)
            },
        }),
        note('laps_note', 'To go slower, set Timing to Speed.', byLaps),
        field('end', {
            input: { type: 'select', label: 'At the end', options: END_LABELS, value: 'wrap' },
            get: (node) => node.end ?? 'wrap',
            set: (node, value) => {
                if (['wrap', 'bounce', 'stop'].includes(value)) node.end = value
            },
        }),
        flag('reverse', 'reverse', 'Run backwards', false),
        whole('walkers', 'walkers', { type: 'number', label: 'Copies', step: 1, value: 1 }, 1, LIMITS.walkers, 1, 'Copies'),
        flag('even', 'even', 'Space them evenly', false, { condition: severalWalkers, description: 'Needs Start again or Turn around under At the end' }),
        whole('spacing', 'spacing', { type: 'number', label: 'Gap between copies (px)', step: 1, value: 0, condition: ((result: Values) => severalWalkers(result) && !result?.even) as any }, 0, LIMITS.spacing, 0, 'Gap between copies'),
        stops,
        facings,
        rangesPart(pathRanges),
        placement,
    )
}

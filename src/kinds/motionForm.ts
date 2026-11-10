import { ART_PROPERTY, readArt } from '../art/layout'
import { layerNodes, selectedLayerNodes } from '../elements/nodes'
import { limited } from '../elements/limits'
import { BODY_TYPE } from '../model'
import { paintTexture } from '../navigate'
import { EDGE_FOLLOWS } from '../motion/types'
import { custom, field, FormConfig, group, note, Part, Shown, Values } from '../schema/form'
import { findTexture } from '../util/texture'
import type { widthRanges } from './ranges'

type FieldInput = FormElementOptions | ((node: any) => FormElementOptions)

export const WHOLE_TAG = 'The whole tag'
export const PERCENT = 100

export const EDGE_LABELS: Record<string, string> = { top: 'Top edge', bottom: 'Bottom edge', left: 'Left edge', right: 'Right edge' }

const FOLLOW_LABELS: Record<string, string> = {
    '': 'Off',
    outside: 'Outside',
    line: 'On the line',
    inside: 'Inside',
}
const FOLLOW_NOTES: Record<string, string> = {
    outside: 'The whole picture slides around the outside of the body, always touching it and never covering it.',
    line: 'The middle of the picture rides the edge of the body, half in and half out.',
    inside: 'The whole picture stays inside the body, always touching its edge.',
}
const FOLLOW_ART_NOTE = 'This body is a picture, so it runs along a plain rectangle.'
const FOLLOW_NAME_NOTE = 'The whole tag has no corners. To go around rounded corners, pick a body.'

export function currentNode(): any | null {
    return selectedLayerNodes()[0] ?? null
}

export function onCurrentNode(run: (node: any) => void): () => void {
    return () => {
        const node = currentNode()
        if (node) run(node)
    }
}

export function paintPicture(uuid: unknown) {
    const texture = findTexture(uuid)
    if (texture) paintTexture(texture)
}

export function textureOptions(none: string, current: string): Record<string, string> {
    const result: Record<string, string> = { '': none }
    for (const texture of Texture.all) result[texture.uuid] = texture.name
    if (current && !(current in result)) result[current] = 'Missing picture'
    return result
}

export function bodyOptions(current: string, whole: string): Record<string, string> {
    const result: Record<string, string> = { '': whole }
    for (const body of layerNodes().filter((entry) => entry.type === BODY_TYPE)) result[body.uuid] = `Body: ${body.name}`
    if (current && !(current in result)) result[current] = 'Missing body'
    return result
}

export function percentOf(fraction: number): number {
    return Math.round(fraction * PERCENT * PERCENT) / PERCENT
}

export function pairOf(value: unknown, fallback: number[]): number[] {
    return Array.isArray(value) ? value.slice(0, 2) : fallback.slice()
}

function bodyOf(uuid: unknown): any | null {
    return layerNodes().find((entry) => entry.type === BODY_TYPE && entry.uuid === uuid) ?? null
}

export function followPart(key: string, shown: Shown): Part {
    const following = (result: Values) => shown(result) && !!result?.[key]
    return group(
        field(key, {
            input: {
                type: 'select',
                label: "Follow the body's edge",
                options: FOLLOW_LABELS,
                value: '',
                condition: shown as any,
                description: "Keeps the picture against the body's edge, around rounded corners. Off uses straight lines between the corners",
            },
            get: (node) => (EDGE_FOLLOWS.includes(node.follow) ? node.follow : ''),
            set: (node, value) => {
                node.follow = EDGE_FOLLOWS.includes(value) ? value : ''
            },
        }),
        ...EDGE_FOLLOWS.map((follow) => note(`${key}_${follow}_note`, FOLLOW_NOTES[follow], (result) => shown(result) && result?.[key] === follow)),
        note(`${key}_art_note`, FOLLOW_ART_NOTE, (result) => following(result) && !!readArt(bodyOf(result?.of)?.[ART_PROPERTY])),
        note(`${key}_name_note`, FOLLOW_NAME_NOTE, (result) => following(result) && !layerNodes().some((entry) => entry.uuid === result?.of)),
    )
}

export function flag(key: string, prop: string, label: string, value: boolean, extra: Record<string, unknown> = {}): Part {
    return field(key, {
        input: { type: 'checkbox', label, style: 'toggle_switch', value, ...extra } as any,
        get: (node) => !!node[prop],
        set: (node, result) => {
            node[prop] = !!result
        },
    })
}

export function whole(key: string, prop: string, input: FieldInput, min: number, max: number, fallback: number, label: string): Part {
    return field(key, {
        input,
        get: (node) => Number(node[prop] ?? fallback),
        set: (node, value) => {
            node[prop] = limited(value, min, max, node[prop] ?? fallback, label)
        },
    })
}

export function pairField(key: string, prop: string, input: FieldInput, fallback: number[], limit: (value: unknown) => [number, number]): Part {
    return field(key, {
        input,
        get: (node) => pairOf(node[prop], fallback),
        set: (node, value) => {
            node[prop] = limit(value)
        },
    })
}

export interface ListOptions {
    count: string
    countInput: FormElementOptions
    owns(key: string): boolean
    total(node: any): number
    row(index: number, node: any): FormConfig
    values(node: any): Values
    apply(node: any, result: Values): void
}

export function list(options: ListOptions): Part {
    return custom(
        (key) => key === options.count || options.owns(key),
        (node) => {
            const config: FormConfig = { [options.count]: options.countInput }
            const total = options.total(node)
            for (let index = 0; index < total; index++) Object.assign(config, options.row(index, node))
            return config
        },
        options.values,
        (node, _key, result) => options.apply(node, result),
    )
}

export function rangesPart(ranges: ReturnType<typeof widthRanges>): Part {
    return custom(
        (key) => !!ranges.owns?.(key),
        (node) => ranges.config(node),
        (node) => ranges.values!(node),
        (node, _key, result) => {
            node.breakpoints = ranges.from(node, result)
        },
    )
}

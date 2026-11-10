import { limited, tell } from '../elements/limits'
import { findNode, layerNodes, selectedLayerNodes } from '../elements/nodes'
import { ANCHORS } from '../elements/read'
import { BODY_TYPE, NAME_MASK } from '../model'
import { ANCHOR_LABELS, applyMotionField, framesFieldDescription, secondsHint, spriteAdaptiveConfig, spriteAdaptiveValues } from '../motion/form'
import { SPRITE_FOLLOWS } from '../motion/types'
import { AT_PROPERTY, isNameAnchor, NO_AT, SPRITE_ANCHORS, takesAt } from '../art/layout'
import { hasArt } from '../art/dialog'
import { showTexture } from '../navigate'
import { isFrameKeyed } from '../sprite'
import { frameCountOf } from '../palette/sprites'
import { custom, field, group, heading, labeled, note, Part, withCurrent } from '../schema/form'
import { pictureFields } from '../util/form'
import { findTexture } from '../util/texture'

const AT_SCALE = 100
const REPLACE_NOTE = 'Replace this picture with a PNG file'
const SIDE_EDGES = ['left', 'right']
const FOLLOW_OFF_NOTE = "Follow the body's edge was turned off: the ends of the name have no body edge to follow."
const FOLLOW_EDGE_NOTE = "Repeats can only follow the top or bottom edge, so the repeat's Edge is now the top edge."
const FOLLOW_DESCRIPTION = 'Keeps the picture against the body\'s edge, around rounded corners. Off uses the plain box and Own point'
const FOLLOW_WALK_NOTE = 'To make it walk, use Add Path.'
const NUDGE_RESET_NOTE = 'Nudge is back to 0, 0. Undo brings it back.'
const FOLLOW_ART_NOTE = 'This body is a picture, so the sprite sits on a plain rectangle.'
const FOLLOW_PLAIN_NOTE = 'Only a body has rounded corners. To sit on a curve, pick a body under Placed against.'
const FOLLOW_LABELS: Record<string, string> = { '': 'Off', outside: 'Outside', line: 'On the line' }
const FOLLOW_NOTES: Record<string, string> = {
    outside: 'The whole picture sits against the outside of the body, always touching it and never covering it.',
    line: 'The middle of the picture sits on the edge of the body, half in and half out.',
}
const OUTSIDE_PIVOTS: Record<string, string> = {
    top_left: 'bottom_right',
    top: 'bottom',
    top_right: 'bottom_left',
    left: 'right',
    right: 'left',
    bottom_left: 'top_right',
    bottom: 'top',
    bottom_right: 'top_left',
}
const TARGET_LABELS: Record<string, string> = { '': 'The whole tag', [NAME_MASK]: 'Just the name' }

function bodyOf(uuid: unknown): any | null {
    const node = typeof uuid === 'string' && uuid ? findNode(uuid) : null
    return node?.type === BODY_TYPE ? node : null
}

function formPair(value: unknown): [number, number] {
    const list = Array.isArray(value) ? value : [0, 0]
    return [Math.round(Number(list[0])) || 0, Math.round(Number(list[1])) || 0]
}

function outsidePivot(anchor: unknown): string {
    return OUTSIDE_PIVOTS[String(anchor)] ?? ''
}

export function carriedPivot(node: any, anchor: string): string {
    const pivot = String(node.pivot ?? '')
    return pivot && pivot === outsidePivot(node.anchor) ? outsidePivot(anchor) : pivot
}

function seatSprite(node: any, anchor: string) {
    if (!node.follow) node.pivot = node.pivot ? carriedPivot(node, anchor) : outsidePivot(anchor)
    const [x, y] = formPair(node.offset)
    if (!x && !y) return
    node.offset = [0, 0]
    tell(NUDGE_RESET_NOTE)
}

function setAnchor(node: any, anchor: string) {
    if (node.follow && isNameAnchor(anchor)) {
        node.follow = ''
        tell(FOLLOW_OFF_NOTE)
    }
    if (!node.repeatOn && anchor !== node.anchor) seatSprite(node, anchor)
    node.anchor = anchor
}

function setFollow(node: any, value: unknown) {
    node.follow = SPRITE_FOLLOWS.includes(value as any) ? value : ''
    if (!node.follow || !SIDE_EDGES.includes(node.repeatEdge)) return
    applyMotionField(node, 'repeat_edge', { repeat_edge: 'top' })
    tell(FOLLOW_EDGE_NOTE)
}

function picturePart(onImport: () => void): Part {
    return custom(
        (key) => key === 'picture_title' || key === 'texture' || key === 'import_picture' || key === 'frames' || key === 'paint',
        (node) => {
            const textures: Record<string, string> = { '': 'None' }
            for (const texture of Texture.all) textures[texture.uuid] = texture.name
            return pictureFields({
                textureOptions: withCurrent(textures, node.texture ?? '', 'Missing picture') as Record<string, string>,
                importDescription: REPLACE_NOTE,
                framesDescription: framesFieldDescription(isFrameKeyed(node.uuid)),
                onImport,
                onPaint: () => showTexture(findTexture(selectedLayerNodes()[0]?.texture)),
            })
        },
        (node) => {
            const texture = findTexture(node.texture)
            return { texture: node.texture ?? '', frames: texture ? frameCountOf(texture) : 1 }
        },
        (node, key, result) => {
            if (key === 'texture') node.texture = String(result.texture ?? '')
        },
    )
}

const following = (result: any) => !!result?.follow

const followNotes: Part = group(
    ...SPRITE_FOLLOWS.map((follow) => note(`follow_${follow}_note`, FOLLOW_NOTES[follow], (result) => result?.follow === follow)),
    note('follow_walk_note', FOLLOW_WALK_NOTE, following),
    note('follow_art_note', FOLLOW_ART_NOTE, (result) => following(result) && hasArt(bodyOf(result?.of))),
    note('follow_plain_note', FOLLOW_PLAIN_NOTE, (result) => following(result) && !bodyOf(result?.of)),
)

const adaptive: Part = custom(
    (key) => key.startsWith('repeat_') || key.startsWith('bp_'),
    spriteAdaptiveConfig,
    spriteAdaptiveValues,
    (node, key, result) => {
        applyMotionField(node, key, result)
    },
)

export function spriteForm(placement: Part, onImport: () => void): Part {
    return group(
        picturePart(onImport),
        heading('place_title', 'Position'),
        field('anchor', {
            input: (node) => ({
                type: 'select',
                label: 'Sticks to',
                options: withCurrent(labeled(SPRITE_ANCHORS, ANCHOR_LABELS), String(node.anchor ?? ''), String(node.anchor ?? '')),
                description: 'The ends of the name keep it next to the letters at any name width',
            }),
            get: (node) => node.anchor ?? 'top_left',
            set: (node, value) => setAnchor(node, String(value ?? '')),
        }),
        field('of', {
            input: (node) => {
                const bodies: Record<string, string> = { ...TARGET_LABELS }
                for (const body of layerNodes().filter((entry) => entry.type === BODY_TYPE)) bodies[body.uuid] = `Body: ${body.name}`
                return { type: 'select', label: 'Placed against', options: withCurrent(bodies, node.of ?? '', 'Missing body'), condition: (result: any) => !isNameAnchor(result?.anchor) }
            },
            get: (node) => node.of ?? '',
            set: (node, value) => {
                node.of = String(value ?? '')
            },
        }),
        field('at', {
            input: { type: 'range', label: 'Along the edge (%)', min: 0, max: AT_SCALE, step: 1, value: AT_SCALE / 2, editable_range_label: true, condition: (result: any) => takesAt(result?.anchor) && !result?.repeat_on, description: '0 is the left or top end, 100 the right or bottom end' } as FormElementOptions,
            get: (node) => (Number(node[AT_PROPERTY]) >= 0 ? Math.round(Number(node[AT_PROPERTY]) * AT_SCALE) : AT_SCALE / 2),
            set: (node, value) => {
                const at = Number(value)
                node[AT_PROPERTY] = isFinite(at) ? Math.min(AT_SCALE, Math.max(0, Math.round(at))) / AT_SCALE : NO_AT
            },
        }),
        field('follow', {
            input: { type: 'select', label: "Follow the body's edge", options: FOLLOW_LABELS, value: '', condition: (result: any) => following(result) || !isNameAnchor(result?.anchor), description: FOLLOW_DESCRIPTION },
            get: (node) => (SPRITE_FOLLOWS.includes(node.follow) ? node.follow : ''),
            set: (node, value) => setFollow(node, value),
        }),
        followNotes,
        field('pivot', {
            input: { type: 'select', label: 'Own point', options: { '': 'Automatic', ...labeled(ANCHORS, ANCHOR_LABELS) }, condition: (result: any) => !result?.follow, description: 'Which point of the sprite touches Sticks to. Bottom right on Top left puts it outside that corner' },
            get: (node) => node.pivot ?? '',
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
                node.offset = formPair(value)
            },
        }),
        heading('mirror_title', 'Mirror'),
        field('mirror', {
            input: { type: 'checkbox', label: 'Mirrored copy', style: 'toggle_switch', value: false, description: 'Adds a flipped copy on the other side' } as any,
            get: (node) => !!node.mirror,
            set: (node, value) => {
                node.mirror = !!value
            },
        }),
        field('mirror_delay', {
            input: () => ({ type: 'number', label: 'Copy starts late by (frames)', step: 1, value: 0, condition: (result: any) => !!result?.mirror, description: `Hold each frame multiplies this. ${secondsHint()}` }),
            get: (node) => node.mirrorDelay ?? 0,
            set: (node, value) => {
                node.mirrorDelay = limited(value, 0, Infinity, node.mirrorDelay ?? 0, 'Copy starts late by')
            },
        }),
        field('mirror_seed', {
            input: { type: 'checkbox', label: 'Copy has own timing', style: 'toggle_switch', value: false, condition: (result: any) => !!result?.mirror, description: 'Random animations only: the copy gets its own random times' } as any,
            get: (node) => !!node.mirrorSeed,
            set: (node, value) => {
                node.mirrorSeed = !!value
            },
        }),
        adaptive,
        placement,
    )
}

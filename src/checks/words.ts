import { readLayers } from '../elements'
import type { EngineIssue } from '../engine'
import { frameDivisors } from '../format'
import { joinList, plural } from '../util/text'
import { isMolangCode } from './codes'

type FieldLabels = Record<string, string>

const NO_VALUE = "has a value the game can't use. Set it again."
const NO_SETTING = "has a setting the game can't use. Check it and set it again."
const UNREADABLE = "can't be read. Export the nameplate again."

export const LAYER_FIELDS: FieldLabels = {
    step: 'Hold each frame for',
    depth: 'Draws',
    mask: 'Clipped by',
    clip: 'Leave its outlines alone',
    mirror: 'Mirrored copy',
    mirrorDelay: 'Copy starts late by',
    offset: 'Nudge',
    pivot: 'Own point',
    anchor: 'Sticks to',
    of: 'Placed against',
    at: 'Along the edge',
    follow: "Follow the body's edge",
    sprite: 'Picture',
    material: 'Graph',
    fill: 'Fill',
    rings: 'Outline',
    padding: 'Padding',
    minWidth: 'Minimum width',
    radius: 'Corner roundness',
    corners: 'Corner shape',
    art: 'Body art',
    timeline: 'Frames',
    breakpoints: 'Only for some name widths',
    'breakpoints.sprite': 'Range picture',
    repeat: 'Repeat along an edge',
    'repeat.edge': 'Edge',
    'repeat.spacing': 'One copy every',
    'repeat.min': 'At least',
    'repeat.max': 'At most',
    path: 'Path',
    'path.points': 'Points',
    'path.points.anchor': 'Point',
    'path.points.offset': 'Point nudge',
    'path.points.pause': 'Point wait',
    'path.speed': 'Speed',
    'path.end': 'At the end',
    'path.frames': 'Different frames per direction',
    'path.follow': "Follow the body's edge",
    'path.stops': 'Waits along the path',
    'path.stops.at': 'Wait at',
    'path.stops.pause': 'Wait for',
    'path.laps': 'Laps per loop',
    walkers: 'Copies',
    'walkers.spacing': 'Gap between copies',
    'walkers.even': 'Space them evenly',
    'velocity.x': 'Sideways speed',
    'velocity.y': 'Up or down speed',
    gravity: 'Gravity',
    drift: 'Drift',
    wobble: 'Wobble',
    'wobble.period': 'Wobble every',
    frames: 'Animation',
    sprites: 'Pictures',
    spawn: 'Spawn',
    'spawn.anchor': 'Point',
    'spawn.edge': 'Edge',
    'spawn.offset': 'Nudge',
    'spawn.follow': "Follow the body's edge",
    'rate.every': 'Every',
    'rate.count': 'How many each time',
    'rate.jitter': 'Random delay',
    lifetime: 'Lives for',
    'fade.after': 'Start fading after',
    'fade.to': 'Fade down to',
    'fade.steps': 'Fade steps',
}

export const SPRITE_FIELDS: FieldLabels = { frames: 'Frames', rows: 'Frames', colors: 'Colors' }

export const SETTINGS_FIELDS: FieldLabels = {
    id: 'ID',
    fps: 'Frames per second',
    loop: 'Loop length',
    params: 'Shared numbers',
    layers: 'Layers',
}

export const TEXT_FIELDS: FieldLabels = {
    mode: 'Letters',
    formatting: 'Colored names',
    color: 'Name color',
    shadow: 'Shadow',
    outline: 'Outline',
    candidates: 'Auto picks from',
    backdropHint: 'Colors behind the name',
    motion: 'Letter formula',
}

export const BADGE_FIELDS: FieldLabels = {
    placement: 'Place',
    anchor: 'Pinned to',
    offset: 'Move right and down',
    tint: 'Badge color',
    decoration: 'Badge edge',
    decorationColor: 'Edge color',
    candidates: 'Auto picks from',
    of: 'On the body',
    follow: "Follow the body's edge",
    at: 'Along the edge',
}

function prefixed(prefix: string, labels: FieldLabels): FieldLabels {
    return Object.fromEntries(Object.entries(labels).map(([field, label]) => [`${prefix}.${field}`, label]))
}

export const VARIANT_FIELDS: FieldLabels = {
    palette: 'Colorway',
    hide: 'Hidden layers',
    swap: 'Swapped layers',
    params: 'Shared numbers',
    flag: 'Flag',
    text: 'Name text',
    badge: 'Badge',
    ...prefixed('text', TEXT_FIELDS),
    ...prefixed('badge', BADGE_FIELDS),
}

export const ANIMATION_FIELDS: FieldLabels = {
    name: 'Name',
    trigger: 'Plays',
    'trigger.appear': 'Unseen for',
    reduced: 'When players turn motion down',
    length: 'Length',
    restart: 'Restart if triggered again',
    schedule: 'Random timing',
    'schedule.window': 'Window',
    'schedule.jitter': 'Random delay',
    'schedule.chance': 'Chance per window',
    'schedule.weight': 'Weight',
    'schedule.id': 'Share a schedule',
    tracks: 'Keyframes',
}

export const GROUP_FIELDS: FieldLabels = { id: 'Name', layers: 'Layers', parent: 'Group', breakpoints: 'Only for some name widths' }

export const COLOR_FIELDS: FieldLabels = { ramp: 'Shades', interpolate: 'Shades' }

export const FLAG_FIELDS: FieldLabels = {
    bands: 'Bands',
    overlay: 'Overlay',
    'overlay.colors': 'Overlay colors',
    'overlay.width': 'Overlay width',
    axis: 'Direction',
    rowsOverride: 'Rows',
    symmetric: 'Bands',
}

const ENGINE_WORDS: Array<[RegExp, string]> = [
    [/1 to 64 of a-z, 0-9 and _/g, '1 to 64 lowercase letters, digits or _'],
    [/\braise its step\b/g, "raise 'Hold each frame for'"],
    [/(\d+)-step\b/g, '$1-frame'],
    [/\bsteps\b/g, 'frames'],
    [/\bstep\b/g, 'frame'],
    [/\bkeys\b/g, 'keyframes'],
    [/\bkey\b/g, 'keyframe'],
    [/\bwalkers\b/g, 'copies'],
    [/\bwalker\b/g, 'copy'],
    [/\broutes\b/g, 'paths'],
    [/\broute\b/g, 'path'],
    [/\ban emitter\b/g, 'particles'],
    [/\bemitters\b/g, 'particles'],
    [/\bemitter\b/g, 'particles'],
    [/\bmaterial\b/g, 'graph'],
    [/\bslots\b/g, 'colors'],
    [/\bslot\b/g, 'color'],
    [/\btones\b/g, 'shades'],
    [/\btone\b/g, 'shade'],
    [/\bparams\b/g, 'shared numbers'],
    [/\bparam\b/g, 'shared number'],
    [/\bowned letters\b/g, 'letters'],
    [/\bbudget\b/g, 'limit'],
]

const QUOTED_NAME = /(^|\s)'[^']*'/g
const JSON_TEXT = /[[\]{}"#<>=]|\.[a-z]|\b[a-z]+[A-Z]|\b[a-z]+_[a-z]/

const SENTENCES: Array<[RegExp, (match: RegExpExecArray) => string]> = [
    [/^missing$/, () => 'is missing from the zip. Export the nameplate again.'],
    [/^(not valid JSON|larger than |nested deeper than |does not match the format)/, () => UNREADABLE],
    [/^no (sprite|layer|group|flag|colorway) '(.+)'$/, (match) => `uses ${match[1] === 'sprite' ? 'picture' : match[1]} '${match[2]}', which no longer exists. Pick another one.`],
    [/^no slot '(.+)'$/, (match) => `uses color '${match[1]}', which no longer exists. Pick another one.`],
    [/^no such slot$/, () => 'changes a color that no longer exists. Open the colorway and set it again.'],
    [/^no param '(.+)'/, (match) => `uses shared number '${match[1]}', which no longer exists. Pick another one.`],
    [/^slot '(.+)' has no tone \d+$/, (match) => `uses a shade color '${match[1]}' doesn't have. Pick another one.`],
    [/^'.*' is not #RRGGBB or #AARRGGBB$/, () => 'has a color that can\'t be read. Pick it again.'],
    [/^must name a body layer$/, () => 'needs a body layer. Pick one in the Inspector.'],
    [/^'(.+)' is masked itself; masks don't chain$/, (match) => `is clipped by '${match[1]}', which is clipped too. Pick a layer that isn't.`],
    [/^'(.+)' moves along a path; a mask must be/, (match) => `is clipped by '${match[1]}', which moves along a path. Pick a body or a sprite that stays put.`],
    [/^'(.+)' can't be a mask;/, (match) => `is clipped by '${match[1]}', which can't clip. Pick a body or a sprite.`],
    [/^emitters and sprites on a path can't be masked$/, () => "can't be clipped. Set Clipped by to none."],
    [/^'(.+)' isn't a body; only a body has a fill to clip to$/, (match) => `can't leave outlines alone, because '${match[1]}' isn't a body. Turn off Leave its outlines alone.`],
]

const SHAPES: Array<[RegExp, string]> = [
    [/^must be \[[^\]]*\], each (.+)$/, 'each value must be $1'],
    [/^must be \[min, max\] with min <= max, each (.+)$/, 'each value must be $1'],
    [/^must be \[min, max\] frames with 1 <= min <= max <= (\d+)$/, 'each value must be 1 to $1 frames'],
    [/^needs 0 <= min < max <= (\d+)$/, 'each range must go up, and stop at $1 or less'],
]

const CHOICE_LIST = /^must be (one of )?[a-z_]+(, [a-z_]+)*( or [a-z_]+)?$/

export function sentence(text: string): string {
    const trimmed = text.trim()
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function designerWords(message: string): string {
    let text = message.trim()
    for (const [pattern, word] of ENGINE_WORDS) text = text.replace(pattern, word)
    for (const [pattern, shape] of SHAPES) text = text.replace(pattern, shape)
    return text
}

function isRaw(text: string): boolean {
    return CHOICE_LIST.test(text) || JSON_TEXT.test(text.replace(QUOTED_NAME, ''))
}

function isFormula(code: string | undefined): boolean {
    return isMolangCode(code) || (typeof code === 'string' && code.startsWith('letter_'))
}

function fixedSentence(message: string): string | null {
    for (const [pattern, text] of SENTENCES) {
        const match = pattern.exec(message.trim())
        if (match) return text(match)
    }
    return null
}

function labelOf(labels: FieldLabels, field: string): string | null {
    let key = field.replace(/\[\d+\]/g, '')
    while (key) {
        if (labels[key]) return labels[key]
        const dot = key.lastIndexOf('.')
        key = dot < 0 ? '' : key.slice(0, dot)
    }
    return null
}

export function plainMessage(message: string): string {
    const text = designerWords(message)
    return isRaw(text) ? NO_SETTING : sentence(text)
}

export function plainSetting(subject: string, field: string, issue: EngineIssue, labels: FieldLabels): string {
    const fixed = fixedSentence(issue.message)
    if (fixed) return `${subject} ${fixed}`
    const label = labelOf(labels, field)
    const place = label ? `${subject}, ${label}` : subject
    const text = designerWords(issue.message)
    if (isFormula(issue.code)) return `${place}: ${sentence(issue.message)}`
    if (isRaw(text)) return `${place} ${label ? NO_VALUE : NO_SETTING}`
    return `${place}: ${sentence(text)}`
}

export function holdText(subject: string, layerId: string, message: string): string | null {
    const loop = Number(/divide the loop \((\d+)\)/.exec(message)?.[1])
    if (!(loop >= 1)) return null
    const hold = readLayers().find((layer) => layer.id === layerId)?.step
    const now = hold ? ` for ${plural(hold, 'frame')}` : ''
    return `${subject} holds each frame${now}, which doesn't fit the ${loop}-frame loop. Set Hold each frame for to ${joinList(frameDivisors(loop), 'or')}.`
}

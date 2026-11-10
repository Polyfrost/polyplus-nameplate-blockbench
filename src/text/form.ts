import { takesAt } from '../art/layout'
import { limited } from '../elements/limits'
import { layerNodes } from '../elements/nodes'
import { Anchor, BODY_TYPE } from '../model'
import { ANCHOR_LABELS } from '../motion/form'
import { SPRITE_FOLLOWS, SpriteFollow } from '../motion/types'
import { pickedRgbHex, toRgbHex } from '../palette/color'
import { ToneChoice, toneChoices } from '../palette/tones'
import {
    BadgeOverride,
    BadgeSettings,
    BADGE_ANCHORS,
    DEFAULT_CANDIDATES,
    LETTER_MODE_NAMES,
    MAX_BADGE_OFFSET,
    NEAR_BLACK,
    TextMode,
    TextOverride,
    TextSettings,
    WHITE,
} from './types'
import { heading } from '../util/form'
import { sameSerialized } from '../util/json'

export type FormConfig = Record<string, FormElementOptions | '_'>
export type Result = Record<string, any>
type Mode = 'inherit' | 'none' | 'auto' | 'palette' | 'fixed'
type ColorField = 'color' | 'shadow' | 'outline'

export const INHERIT = 'inherit'
const MAX_CANDIDATES = 4
const INHERIT_LABEL = 'Same as every variant'
const OWN_PROGRAM = 'own'
const AT_SCALE = 100
const FORMULA_HEIGHT = 60
const DEFAULT_FOLLOW: SpriteFollow = 'outside'
const DEFAULT_DECORATION_COLOR = NEAR_BLACK
const COLOR_FIELDS: ColorField[] = ['color', 'shadow', 'outline']

const TEXT_MODES: Record<ColorField, Record<string, string>> = {
    color: { none: 'Game color (white)', auto: 'Best contrast (auto)', palette: 'Palette color', fixed: 'Any color' },
    shadow: { none: 'No shadow', auto: 'Only when needed (auto)', palette: 'Palette color', fixed: 'Any color' },
    outline: { none: 'No outline', auto: 'Only when needed (auto)', palette: 'Palette color', fixed: 'Any color' },
}
const TEXT_LABELS: Record<ColorField, string> = { color: 'Name color', shadow: 'Shadow', outline: 'Outline' }
const TEXT_HINTS: Record<ColorField, string> = {
    color: 'Picks white or near-black, whichever reads best',
    shadow: 'Auto adds one only when the name is hard to read',
    outline: 'It replaces the shadow when both would show',
}
const FORMATTING_LABELS: Record<string, string> = {
    adjust: 'Lighten or darken them until they read (default)',
    keep: 'Leave them as they are',
    override: 'Paint them in the name color',
}
const LETTER_MODES: Record<string, string> = {
    vanilla: `${LETTER_MODE_NAMES.vanilla} (default)`,
    motion: LETTER_MODE_NAMES.motion,
    owned: LETTER_MODE_NAMES.owned,
}
const PROGRAM_CHOICES: Record<string, string> = { [INHERIT]: INHERIT_LABEL, [OWN_PROGRAM]: 'Its own formula' }
const BADGE_FOLLOW_LABELS: Record<SpriteFollow, string> = {
    outside: 'Outside, touching the edge',
    line: 'On the line, half in and half out',
}
const PLACEMENT_LABELS: Record<string, string> = {
    reserve: 'Before the name (default)',
    carried: 'Before the name, moving with the letters',
    placed: 'Pinned to the nameplate',
}
const TINT_MODES: Record<string, string> = { none: 'Its own colors', palette: 'Palette color', fixed: 'Any color' }
const DECORATION_LABELS: Record<string, string> = {
    none: 'None',
    auto: 'Shadow or outline when needed (auto)',
    shadow: 'Drop shadow',
    outline: 'Outline',
}
const DECORATION_MODES: Record<string, string> = { palette: 'Palette color', fixed: 'Any color' }

function withInherit(options: Record<string, string | ToneChoice>, inherit: boolean): Record<string, string | ToneChoice> {
    return inherit ? { [INHERIT]: INHERIT_LABEL, ...options } : options
}

function modeOf(ref: string | null | undefined): Mode {
    if (ref === undefined || ref === null) return 'none'
    if (ref === 'none' || ref === 'auto') return ref
    return ref.startsWith('#') ? 'fixed' : 'palette'
}

export function hexOf(value: unknown, fallback = WHITE): string {
    return value === '' ? fallback : pickedRgbHex(value, fallback)
}

function paletteRefs(refs: Array<string | null | undefined>): string[] {
    return refs.filter((ref): ref is string => typeof ref === 'string' && modeOf(ref) === 'palette')
}

function firstTone(): string {
    return Object.keys(toneChoices())[0] ?? WHITE
}

function toneOf(ref: string | null | undefined): string {
    return ref && modeOf(ref) === 'palette' ? ref : firstTone()
}

function hexFor(ref: string | null | undefined, fallback: string): string {
    return ref && modeOf(ref) === 'fixed' ? toRgbHex(ref).toUpperCase() : fallback
}

function candidateOptions(current: string[]): Record<string, string | ToneChoice> {
    const options: Record<string, string | ToneChoice> = {
        '': 'Not used',
        [WHITE]: { name: 'White (#FFFFFF)', icon: 'stop', color: WHITE },
        [NEAR_BLACK]: { name: 'Near black (#1A1A1A)', icon: 'stop', color: NEAR_BLACK },
    }
    Object.assign(options, toneChoices())
    for (const ref of current) if (ref && !(ref in options)) options[ref] = { name: `${ref} (missing)`, icon: 'warning' }
    return options
}

function bodyChoices(current: string | null): Record<string, string> {
    const options: Record<string, string> = { '': 'None: the whole tag' }
    for (const body of layerNodes().filter((node) => node.type === BODY_TYPE)) options[body.uuid] = `Body: ${body.name}`
    if (current && !(current in options)) options[current] = 'Missing body'
    return options
}

function colorFields(
    prefix: string,
    field: string,
    label: string,
    modes: Record<string, string>,
    refs: string[],
    inherit: boolean,
    description: string,
    shown: (result: Result) => boolean = () => true,
): FormConfig {
    const mode = `${prefix}${field}_mode`
    return {
        [mode]: { type: 'select', label, options: withInherit(modes, inherit), description, condition: shown } as FormElementOptions,
        [`${prefix}${field}_tone`]: {
            type: 'select',
            label: 'Palette color',
            options: toneChoices(refs),
            condition: (result: Result) => shown(result) && result?.[mode] === 'palette',
        } as FormElementOptions,
        [`${prefix}${field}_hex`]: {
            type: 'color',
            label: 'Color',
            value: WHITE,
            condition: (result: Result) => shown(result) && result?.[mode] === 'fixed',
        } as FormElementOptions,
    }
}

function candidateFields(prefix: string, current: string[], shown: (result: Result) => boolean, description: string): FormConfig {
    const config: FormConfig = {}
    const options = candidateOptions(current)
    for (let index = 0; index < MAX_CANDIDATES; index++) {
        config[`${prefix}cand_${index}`] = {
            type: 'select',
            label: index === 0 ? 'Auto picks from' : ' ',
            options,
            description: index === 0 ? description : undefined,
            condition: shown,
        } as FormElementOptions
    }
    return config
}

function anyAuto(result: Result, prefix: string): boolean {
    return COLOR_FIELDS.some((field) => result?.[`${prefix}${field}_mode`] === 'auto')
}

interface FormOptions {
    inherit: boolean
    shown?: (result: Result) => boolean
    editProgram?: () => void
    inheritedMode?: TextMode
}

export function textConfig(text: TextSettings, own: TextOverride | null, options: FormOptions): FormConfig {
    const inherit = options.inherit
    const shown = options.shown ?? (() => true)
    const refs = paletteRefs([text.color, text.shadow, text.outline, ...(own ? [own.color, own.shadow, own.outline] : [])])
    const config: FormConfig = { ts_title: { ...heading('Name text'), condition: shown } as FormElementOptions }
    for (const field of COLOR_FIELDS) {
        Object.assign(config, colorFields('ts_', field, TEXT_LABELS[field], TEXT_MODES[field], refs, inherit, TEXT_HINTS[field], shown))
    }
    config.ts_formatting = {
        type: 'select',
        label: 'Colored names',
        options: withInherit(FORMATTING_LABELS, inherit),
        description: 'What happens to names the server already colors, like ranks and teams',
        condition: shown,
    } as FormElementOptions
    if (!inherit) {
        Object.assign(config, candidateFields('ts_', text.candidates ?? [], (result) => shown(result) && anyAuto(result, 'ts_'), 'The first color wins a tie'))
        config.ts_hint = {
            type: 'text',
            label: 'Colors behind the name',
            description: "For colors the preview can't see. Palette names or #hex, split by commas",
            condition: (result: Result) => shown(result) && anyAuto(result, 'ts_'),
        } as FormElementOptions
    }
    config.ts_mode = { type: 'select', label: 'Letters', options: withInherit(LETTER_MODES, inherit), description: `${LETTER_MODE_NAMES.motion}: each letter can move and fade. ${LETTER_MODE_NAMES.owned}: each letter can also change color, size and angle`, condition: shown } as FormElementOptions
    const moving = (result: Result) => shown(result) && (result?.ts_mode === INHERIT ? options.inheritedMode ?? 'vanilla' : result?.ts_mode) !== 'vanilla'
    const programmed = (result: Result) => moving(result) && (!inherit || result?.ts_motion_own === OWN_PROGRAM)
    if (inherit) {
        config.ts_motion_own = { type: 'select', label: 'Letter formula', options: PROGRAM_CHOICES, condition: moving } as FormElementOptions
    }
    const edit = options.editProgram
    if (edit) {
        config.ts_motion_edit = { type: 'buttons', buttons: ['Edit letter formula...'], condition: programmed, click: () => edit() } as FormElementOptions
    }
    if (!inherit) {
        config.ts_letters_note = { type: 'info', text: `To color letters, pick "${LETTER_MODE_NAMES.owned}".`, condition: (result: Result) => shown(result) && result?.ts_mode !== 'owned' } as FormElementOptions
        config.ts_font_note = { type: 'info', text: "Names always use the game's font. Bold and custom fonts aren't available.", condition: shown } as FormElementOptions
    }
    config.ts_motion = {
        type: 'textarea',
        style: 'code',
        height: FORMULA_HEIGHT,
        label: inherit ? 'Its letter formula' : 'Letter formula',
        description: 'Runs for every letter, every frame. The result moves the letter down in px. Click Edit letter formula for examples',
        condition: programmed,
    } as FormElementOptions
    return config
}

export function badgeConfig(badge: BadgeSettings, own: BadgeOverride | null, options: FormOptions): FormConfig {
    const inherit = options.inherit
    const shown = options.shown ?? (() => true)
    const refs = paletteRefs([badge.tint, badge.decorationColor, own?.tint, own?.decorationColor])
    const anchors: Record<string, string> = {}
    for (const anchor of BADGE_ANCHORS) anchors[anchor] = ANCHOR_LABELS[anchor] ?? anchor
    const placed = (result: Result) => shown(result) && result?.bs_placement === 'placed'
    const onBody = (result: Result) => placed(result) && !!result?.bs_of
    const decorated = (result: Result) => shown(result) && (result?.bs_decoration === 'shadow' || result?.bs_decoration === 'outline')
    const config: FormConfig = {
        bs_title: { ...heading('PolyPlus badge'), condition: shown } as FormElementOptions,
        bs_placement: {
            type: 'select',
            label: 'Place',
            options: withInherit(PLACEMENT_LABELS, inherit),
            description: 'Pinned puts its middle on a corner or edge. To animate it, add keyframes to its row in Animate',
            condition: shown,
        } as FormElementOptions,
        bs_anchor: { type: 'select', label: 'Pinned to', options: anchors, condition: placed } as FormElementOptions,
        bs_of: { type: 'select', label: 'On the body', options: bodyChoices(badge.of), condition: placed, description: 'Pick a body to keep the badge against its edge' } as FormElementOptions,
        bs_follow: { type: 'select', label: "Follow the body's edge", options: BADGE_FOLLOW_LABELS, condition: onBody } as FormElementOptions,
        bs_at: { type: 'range', label: 'Along the edge (%)', min: 0, max: AT_SCALE, step: 1, value: AT_SCALE / 2, editable_range_label: true, condition: (result: Result) => onBody(result) && takesAt(result?.bs_anchor), description: '0 is the left or top end, 100 the right or bottom end' } as FormElementOptions,
        bs_offset_x: { type: 'number', label: 'Move right', step: 1, value: 0, condition: placed } as FormElementOptions,
        bs_offset_y: { type: 'number', label: 'Move down', step: 1, value: 0, condition: placed } as FormElementOptions,
    }
    Object.assign(config, colorFields('bs_', 'tint', 'Badge color', TINT_MODES, refs, inherit, '', shown))
    config.bs_decoration = {
        type: 'select',
        label: 'Badge edge',
        options: withInherit(DECORATION_LABELS, inherit),
        description: 'The game outlines the badge anyway when it would be hard to see',
        condition: shown,
    } as FormElementOptions
    Object.assign(config, colorFields('bs_', 'deco', 'Edge color', DECORATION_MODES, refs, false, '', decorated))
    if (!inherit) {
        Object.assign(config, candidateFields('bs_', badge.candidates ?? [], (result) => shown(result) && result?.bs_decoration === 'auto', ''))
    }
    return config
}

function colorValues(prefix: string, field: string, ref: string | null | undefined, own: boolean, inherit: boolean, fallbackHex: string): Result {
    return {
        [`${prefix}${field}_mode`]: inherit && !own ? INHERIT : modeOf(ref),
        [`${prefix}${field}_tone`]: toneOf(ref),
        [`${prefix}${field}_hex`]: hexFor(ref, fallbackHex),
    }
}

function candidateValues(prefix: string, list: string[] | null): Result {
    const values: Result = {}
    const refs = list ?? DEFAULT_CANDIDATES
    for (let index = 0; index < MAX_CANDIDATES; index++) values[`${prefix}cand_${index}`] = refs[index] ?? ''
    return values
}

export function textValues(text: TextSettings, own: TextOverride | null, inherit: boolean): Result {
    const values: Result = {}
    for (const field of COLOR_FIELDS) {
        Object.assign(values, colorValues('ts_', field, text[field], !!own && field in own, inherit, field === 'color' ? WHITE : NEAR_BLACK))
    }
    values.ts_formatting = inherit && !(own && 'formatting' in own) ? INHERIT : text.formatting
    if (!inherit) {
        Object.assign(values, candidateValues('ts_', text.candidates))
        values.ts_hint = text.backdropHint.join(', ')
    }
    values.ts_mode = inherit && !(own && 'mode' in own) ? INHERIT : text.mode
    if (inherit) values.ts_motion_own = own && 'motion' in own ? OWN_PROGRAM : INHERIT
    values.ts_motion = text.motion ?? ''
    return values
}

export function badgeValues(badge: BadgeSettings, own: BadgeOverride | null, inherit: boolean): Result {
    const values: Result = {
        bs_placement: inherit && !(own && 'placement' in own) ? INHERIT : badge.placement,
        bs_anchor: badge.anchor ?? 'top_right',
        bs_of: badge.of ?? '',
        bs_follow: badge.follow ?? DEFAULT_FOLLOW,
        bs_at: badge.at === null ? AT_SCALE / 2 : Math.round(badge.at * AT_SCALE),
        bs_offset_x: badge.offset[0],
        bs_offset_y: badge.offset[1],
        bs_decoration: inherit && !(own && 'decoration' in own) ? INHERIT : badge.decoration,
    }
    Object.assign(values, colorValues('bs_', 'tint', badge.tint, !!own && 'tint' in own, inherit, WHITE))
    Object.assign(values, colorValues('bs_', 'deco', badge.decorationColor ?? DEFAULT_DECORATION_COLOR, true, false, DEFAULT_DECORATION_COLOR))
    if (!inherit) Object.assign(values, candidateValues('bs_', badge.candidates))
    return values
}

function refFrom(result: Result, prefix: string, field: string, fallbackHex: string): string | null {
    const mode = result[`${prefix}${field}_mode`]
    if (mode === 'none' || mode === 'auto') return mode
    if (mode === 'palette') return String(result[`${prefix}${field}_tone`] || firstTone())
    if (mode === 'fixed') return hexOf(result[`${prefix}${field}_hex`], fallbackHex)
    return null
}

function candidatesFrom(result: Result, prefix: string): string[] | null {
    const list: string[] = []
    for (let index = 0; index < MAX_CANDIDATES; index++) {
        const value = String(result[`${prefix}cand_${index}`] ?? '')
        if (value) list.push(value)
    }
    if (!list.length || sameSerialized(list, DEFAULT_CANDIDATES)) return null
    return list
}

function badgeOffset(result: Result): [number, number] {
    return [
        limited(result.bs_offset_x, -MAX_BADGE_OFFSET, MAX_BADGE_OFFSET, 0, 'Move right') + 0,
        limited(result.bs_offset_y, -MAX_BADGE_OFFSET, MAX_BADGE_OFFSET, 0, 'Move down') + 0,
    ]
}

function badgeFollow(result: Result): SpriteFollow {
    return SPRITE_FOLLOWS.includes(result.bs_follow) ? result.bs_follow : DEFAULT_FOLLOW
}

function badgeAt(result: Result, current: number | null): number | null {
    const value = limited(result.bs_at, 0, AT_SCALE, AT_SCALE / 2, 'Along the edge (%)')
    if (current === null) return value === AT_SCALE / 2 ? null : value / AT_SCALE
    return Math.round(current * AT_SCALE) === value ? current : value / AT_SCALE
}

function applyBadgeBody(target: Record<string, any>, result: Result, anchor: unknown, current: number | null) {
    const body = String(result.bs_of ?? '')
    target.of = body || null
    target.follow = body ? badgeFollow(result) : null
    target.at = body && takesAt(anchor) ? badgeAt(result, current) : null
}

function set(target: Record<string, any>, key: string, value: unknown, inherit: boolean) {
    if (inherit && value === INHERIT) delete target[key]
    else target[key] = value
}

function fieldOf(key: string, prefix: string): string | null {
    const match = new RegExp(`^${prefix}(color|shadow|outline|tint|deco)_(mode|tone|hex)$`).exec(key)
    return match ? match[1] : null
}

export function applyTextKeys(target: Record<string, any>, keys: string[], result: Result, inherit: boolean) {
    for (const key of keys) {
        const field = fieldOf(key, 'ts_')
        if (field) {
            if (inherit && result[`ts_${field}_mode`] === INHERIT) {
                delete target[field]
                continue
            }
            const ref = refFrom(result, 'ts_', field, field === 'color' ? WHITE : NEAR_BLACK)
            if (ref !== null) target[field] = ref
            continue
        }
        if (key === 'ts_formatting') set(target, 'formatting', result.ts_formatting, inherit)
        else if (key.startsWith('ts_cand_')) target.candidates = candidatesFrom(result, 'ts_')
        else if (key === 'ts_hint') target.backdropHint = String(result.ts_hint ?? '').split(/[\s,]+/).filter(Boolean)
        else if (key === 'ts_mode') set(target, 'mode', result.ts_mode, inherit)
        else if (key === 'ts_motion_own' || key === 'ts_motion') {
            if (inherit && result.ts_motion_own === undefined) continue
            if (inherit && result.ts_motion_own === INHERIT) delete target.motion
            else target.motion = String(result.ts_motion ?? '').trim() || null
        }
    }
}

const PIN_FIELDS = ['anchor', 'offset', 'of', 'follow', 'at']

export function applyBadgeKeys(target: Record<string, any>, keys: string[], result: Result, inherit: boolean, effective: BadgeSettings) {
    for (const key of keys) {
        if (key === 'bs_placement') {
            const placement = result.bs_placement
            if (inherit && placement === INHERIT) {
                if ('placement' in target) for (const field of PIN_FIELDS) delete target[field]
                delete target.placement
                continue
            }
            target.placement = placement
            if (placement === 'placed') {
                target.anchor = (BADGE_ANCHORS.includes(result.bs_anchor) ? result.bs_anchor : effective.anchor ?? 'top_right') as Anchor
                target.offset = badgeOffset(result)
                applyBadgeBody(target, result, target.anchor, effective.at)
            } else if (inherit) {
                for (const field of PIN_FIELDS) delete target[field]
            } else {
                target.anchor = null
                target.offset = [0, 0]
                target.of = null
                target.follow = null
                target.at = null
            }
            continue
        }
        if (key === 'bs_anchor') {
            target.anchor = result.bs_anchor
            if (!takesAt(result.bs_anchor)) target.at = null
        } else if (key === 'bs_of') applyBadgeBody(target, result, result.bs_anchor, effective.at)
        else if (key === 'bs_follow') target.follow = badgeFollow(result)
        else if (key === 'bs_at') target.at = badgeAt(result, effective.at)
        else if (key === 'bs_offset_x' || key === 'bs_offset_y') target.offset = badgeOffset(result)
        else if (key === 'bs_decoration') {
            const decoration = result.bs_decoration
            if (inherit && decoration === INHERIT) {
                delete target.decoration
                delete target.decorationColor
                continue
            }
            target.decoration = decoration
            target.decorationColor = decoration === 'shadow' || decoration === 'outline'
                ? refFrom(result, 'bs_', 'deco', DEFAULT_DECORATION_COLOR) ?? effective.decorationColor ?? DEFAULT_DECORATION_COLOR
                : null
        } else if (key.startsWith('bs_cand_')) target.candidates = candidatesFrom(result, 'bs_')
        else {
            const field = fieldOf(key, 'bs_')
            if (field === 'tint') {
                if (inherit && result.bs_tint_mode === INHERIT) delete target.tint
                else {
                    const ref = refFrom(result, 'bs_', 'tint', WHITE)
                    if (ref !== null) target.tint = ref
                }
            } else if (field === 'deco') {
                const decoration = result.bs_decoration === INHERIT ? effective.decoration : result.bs_decoration
                if (decoration === 'shadow' || decoration === 'outline') target.decorationColor = refFrom(result, 'bs_', 'deco', DEFAULT_DECORATION_COLOR)
            }
        }
    }
}

export const DIALOG_TEXT_KEYS = ['ts_color_mode', 'ts_shadow_mode', 'ts_outline_mode', 'ts_formatting', 'ts_mode', 'ts_motion_own']
export const DIALOG_BADGE_KEYS = ['bs_placement', 'bs_tint_mode', 'bs_decoration']

export function isDebounced(key: string): boolean {
    return key.endsWith('_hex') || key === 'ts_hint' || key === 'ts_motion' || key === 'bs_at'
}

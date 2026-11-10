import type { NameplatePreview } from '../engine'
import { ART_PROPERTY, readArt } from '../art/layout'
import { layerNodes } from '../elements/nodes'
import { BODY_TYPE, NameplateData } from '../model'
import { readNameplate } from '../palette/state'
import { nameWidthOf, referenceName } from '../preview'
import { CrowdLayout, layoutTag, LINE_COLOR } from '../preview/crowd'
import { LINE_ABOVE, LINE_BELOW } from '../preview/options'
import { candidateColors, OUTLINE_BELOW, parseRgb, ratio, WHITE_RGB } from './contrast'
import { hardToRead, linesHardToRead } from './readability'
import { animationsWithLetters, TEXT_TARGET } from './reaction'
import { shownPreview, styleOf } from './style'
import { hasProject } from '../util/project'
import { BadgeSettings, LETTER_MODE_NAMES, plateBadge, plateText, TextSettings, variantBadge, variantText } from './types'

type TextProblemLevel = 'error' | 'warning'

interface BadgeBody {
    uuid: string
    name: string
    art: boolean
}

export interface TextProblem {
    level: TextProblemLevel
    message: string
    variant: string | null
    path?: string
    part?: 'name' | 'badge'
    lines?: boolean
}

const OPEN_HINT = 'in the Inspector (click Name text under Layers)'
const BADGE_HINT = 'in the Inspector (click Badge under Layers)'
const STILL_LETTERS = `"${LETTER_MODE_NAMES.vanilla}"`
const MOVING_LETTERS = `"${LETTER_MODE_NAMES.motion}" or "${LETTER_MODE_NAMES.owned}"`

function slotMissing(ref: string | null | undefined, plate: NameplateData): string | null {
    if (!ref || ref === 'none' || ref === 'auto' || ref.startsWith('#')) return null
    const match = /^([a-z0-9_]{1,64})(?:\[\d{1,2}\])?$/.exec(ref)
    if (!match) return null
    return plate.palette.slots.some((slot) => slot.id === match[1]) ? null : match[1]
}

function refProblems(plate: NameplateData, where: string, base: string, text: Partial<TextSettings>, badge: Partial<BadgeSettings>, variant: string | null): TextProblem[] {
    const problems: TextProblem[] = []
    const check = (path: string, ref: string | null | undefined, describe: (slot: string, hint: string) => string) => {
        const slot = slotMissing(ref, plate)
        if (!slot) return
        const badgeField = path.startsWith('badge.')
        problems.push({ level: 'error', message: `${where}${describe(slot, badgeField ? BADGE_HINT : OPEN_HINT)}`, variant, path: `${base}${path}`, part: badgeField ? 'badge' : 'name' })
    }
    const fields: Array<[string, string, string | null | undefined]> = [
        ['text.color', 'Name color', text.color],
        ['text.shadow', 'Shadow', text.shadow],
        ['text.outline', 'Outline', text.outline],
        ['badge.tint', 'Badge color', badge.tint],
        ['badge.decorationColor', 'Badge edge color', badge.decorationColor],
    ]
    for (const [path, label, ref] of fields) {
        check(path, ref, (slot, hint) => `${label} uses palette color '${slot}', which no longer exists. Pick another color ${hint}.`)
    }
    const lists: Array<[string, string[] | null | undefined]> = [['text.candidates', text.candidates], ['badge.candidates', badge.candidates]]
    for (const [path, list] of lists) {
        for (const ref of list ?? []) {
            check(path, ref, (slot, hint) => `Auto picks from palette color '${slot}', which no longer exists. Pick another one ${hint}.`)
        }
    }
    return problems
}

function missingBody(of: string | null | undefined, bodies: BadgeBody[], where: string, base: string, variant: string | null): TextProblem[] {
    if (!of || bodies.some((body) => body.uuid === of)) return []
    return [{ level: 'error', message: `${where}The badge sits on a body that no longer exists. Pick another under On the body ${BADGE_HINT}.`, variant, path: `${base}badge.of`, part: 'badge' }]
}

function artProblem(body: BadgeBody, variant: string | null): TextProblem {
    const where = variant === null ? '' : `Variant '${variant}': `
    return { level: 'warning', message: `${where}The badge follows body '${body.name}', drawn from a picture, so it runs along a plain rectangle. To go around corners, use a body with no picture.`, variant, part: 'badge' }
}

function badgeBodyProblems(plate: NameplateData, bodies: BadgeBody[]): TextProblem[] {
    const p = plate as any
    const problems = missingBody(plateBadge(p).of, bodies, '', 'manifest.json#', null)
    const keys = Object.keys(plate.variants)
    let shared = false
    for (const key of keys) {
        const variant: any = plate.variants[key]
        problems.push(...missingBody(variant.badge?.of, bodies, `Variant '${key}': `, `manifest.json#variants.${key}.`, key))
        const badge = variantBadge(p, variant)
        if (badge.placement !== 'placed' || !badge.follow || !badge.of) continue
        const shown = variant.swap?.[badge.of] ?? badge.of
        const body = bodies.find((entry) => entry.uuid === shown)
        if (variant.hide?.includes(badge.of)) {
            const name = bodies.find((entry) => entry.uuid === badge.of)?.name ?? badge.of
            problems.push({ level: 'warning', message: `Variant '${key}' hides body '${name}', which the badge sits on, so nothing shows under the badge there. Show the body in that variant, or pick another under On the body ${BADGE_HINT}.`, variant: key, part: 'badge' })
        } else if (body?.art) {
            const own = shown !== plateBadge(p).of || variant.badge?.of !== undefined
            if (own) problems.push(artProblem(body, key))
            else if (!shared) {
                shared = true
                problems.push(artProblem(body, null))
            }
        }
    }
    return problems
}

function usesAuto(text: TextSettings): boolean {
    return text.color === 'auto' || text.shadow === 'auto' || text.outline === 'auto'
}

function extraLinesLayout(plate: NameplateData, key: string): CrowdLayout {
    return layoutTag({ name: referenceName(), badge: styleOf(plate, key).badge.placement !== 'placed', above: [LINE_ABOVE], below: [LINE_BELOW] }, nameWidthOf)
}

export function textProblems(plate: NameplateData, preview: NameplatePreview | null, bodies: BadgeBody[] = []): TextProblem[] {
    const problems: TextProblem[] = []
    const p = plate as any
    problems.push(...refProblems(plate, '', 'manifest.json#', p.text ?? {}, p.badge ?? {}, null))
    for (const key of Object.keys(plate.variants)) {
        const variant: any = plate.variants[key]
        problems.push(...refProblems(plate, `Variant '${key}': `, `manifest.json#variants.${key}.`, variant.text ?? {}, variant.badge ?? {}, key))
    }
    problems.push(...badgeBodyProblems(plate, bodies))
    const shownTexts: Array<[string | null, TextSettings]> = Object.keys(plate.variants).map((key) => [key, variantText(p, plate.variants[key] as any)])
    if (!shownTexts.length) shownTexts.push([null, plateText(p)])
    const lettered = animationsWithLetters()
    const moving = shownTexts.filter(([, text]) => text.mode !== 'vanilla')
    if (!moving.length) {
        for (const { name } of lettered) {
            problems.push({
                level: 'error',
                message: `Animation '${name}' changes the letters, but Letters is ${STILL_LETTERS}. Pick ${MOVING_LETTERS} under Letters ${OPEN_HINT}, or set Letters to "Keep the nameplate's letters" in the animation's properties.`,
                variant: null,
                path: `manifest.json#animations.${name}.tracks.${TEXT_TARGET}.motion`,
            })
        }
    } else if (!lettered.some(({ track }) => track.motion)) {
        const still = moving.filter(([, text]) => !text.motion?.trim())
        if (still.length === shownTexts.length) {
            problems.push({ level: 'warning', message: `Letters are set to ${still[0][1].mode === 'motion' ? 'move' : 'move and change color'}, but there is no letter formula yet, so the name stays still. Click "Edit letter formula" ${OPEN_HINT}, or set Letters back to ${STILL_LETTERS}.`, variant: null })
        } else {
            for (const [key, text] of still) {
                problems.push({ level: 'warning', message: `Variant '${key}': letters are set to ${text.mode === 'motion' ? 'move' : 'move and change color'}, but this variant has no letter formula, so its name stays still. Click "Edit letter formula" ${OPEN_HINT}, or set Letters back to ${STILL_LETTERS}.`, variant: key })
            }
        }
    }
    const flagged = hardToRead(preview)
    for (const key of Object.keys(plate.variants)) {
        const style = styleOf(plate, key)
        const name = Object.keys(plate.variants).length > 1 ? `Variant '${key}': the name` : 'The name'
        const text = style.text
        const candidates = candidateColors(text.candidates, style.resolve)
        if (usesAuto(text) && (candidates.length < 2 || ratio(candidates[0], candidates[candidates.length - 1]) < OUTLINE_BELOW)) {
            problems.push({ level: 'warning', message: `${name} uses auto contrast, but the colors it picks from are too alike to stand apart. Pick a light and a dark color under "Auto picks from" ${OPEN_HINT}.`, variant: key })
        }
        const outlineFixed = text.outline !== 'none' && text.outline !== 'auto'
        if (outlineFixed && text.shadow !== 'none') {
            problems.push({ level: 'warning', message: `${name} has an outline and a shadow. The game never draws both, so the shadow never shows. Set Shadow to "No shadow" ${OPEN_HINT}.`, variant: key })
        }
        if (flagged?.has(key)) {
            problems.push({
                level: 'warning',
                message: `${name} can be hard to read: in some frames or at some name widths its color is too close to the art behind it. Set Outline to "Only when needed (auto)", or change the colors behind the name ${OPEN_HINT}.`,
                variant: key,
            })
        }
        if (preview && linesHardToRead(preview, key, extraLinesLayout(plate, key), parseRgb(LINE_COLOR) ?? WHITE_RGB)) {
            const lines = Object.keys(plate.variants).length > 1 ? `Variant '${key}': lines` : 'Lines'
            problems.push({ level: 'warning', message: `${lines} above and below the name are hard to read here, and only the game can color them, so use darker colors behind them.`, variant: key, lines: true })
        }
    }
    return problems
}

export function projectTextProblems(): TextProblem[] {
    if (!hasProject()) return []
    const bodies = layerNodes().filter((node) => node.type === BODY_TYPE).map((node) => ({ uuid: String(node.uuid), name: String(node.name ?? ''), art: !!readArt(node[ART_PROPERTY]) }))
    return textProblems(readNameplate(), shownPreview(), bodies)
}

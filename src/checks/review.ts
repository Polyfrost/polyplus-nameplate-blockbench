import type { EngineIssue } from '../engine'
import { LOOP_ANIMATION, PLATE_TARGET } from '../model'
import { pluralWord } from '../util/text'
import { count } from './budget'
import { classifyIssue, IssueFacts, issueName, issueValue } from './codes'

export type ReviewCode = 'badge_hidden' | 'badge_faded' | 'badge_covered' | 'art_coverage' | 'fixed_height' | 'translucent_overlap' | 'position_clamped' | 'plate_background'

export interface ReviewWarning {
    code: ReviewCode
    message: string
    animation: string | null
    layer: string | null
    lines: number | null
}

const REVIEW_CODES = new Set<string>(['badge_hidden', 'badge_faded', 'badge_covered', 'art_coverage', 'fixed_height', 'translucent_overlap', 'position_clamped', 'plate_background'])
const BADGE_TRACK = /^manifest\.json#animations\.([^.]+)\.tracks\./
const LINE_NAMES: Record<number, string> = { 2: 'Two lines', 3: 'Three lines' }
const SEEN_BY_REVIEWER = 'The reviewer sees this too. Keep it only on purpose.'

function isReviewCode(code: string): code is ReviewCode {
    return REVIEW_CODES.has(code)
}

function animationLabel(name: string): string {
    return name === LOOP_ANIMATION ? 'The main loop' : `The animation '${name}'`
}

function number(facts: IssueFacts, name: string): number {
    return issueValue(facts, name) ?? 0
}

function frames(facts: IssueFacts): string {
    const shown = number(facts, 'frames')
    const of = number(facts, 'of')
    return `${count(shown)} of its ${count(of)} ${pluralWord(of, 'frame')}`
}

function layerName(facts: IssueFacts): string {
    return facts.layer ? `Layer '${facts.layer}'` : 'A layer'
}

function clampMessage(facts: IssueFacts, label: string): string {
    const sideways = issueName(facts, 'axis') !== 'y'
    const lines = number(facts, 'lines')
    const onLines = lines > 1 ? ` with ${count(lines)} lines` : ''
    const variant = issueName(facts, 'variant')
    const inVariant = variant ? ` in variant '${variant}'` : ''
    const target = issueName(facts, 'target')
    const plate = target === PLATE_TARGET
    const moves = `${label} moves ${plate ? 'the whole nameplate' : `'${target ?? 'a layer'}'`} ${count(number(facts, 'px'))} px ${sideways ? 'sideways' : 'up or down'}`
    const limit = count(number(facts, 'limit'))
    const startPoint = sideways ? `Start the layer from Top middle, so it travels ${limit} px each way. ` : ''
    return `${moves} on a ${count(number(facts, 'width'))} px wide name${onLines}${inVariant}, but Position stops at ${limit} px. ${plate ? '' : `${startPoint}To go further, put it in a group and add Position keyframes to the group.`}`
}

function message(code: ReviewCode, facts: IssueFacts, animation: string | null): string {
    const label = animationLabel(animation ?? LOOP_ANIMATION)
    switch (code) {
        case 'badge_hidden':
            return `${label} hides the PolyPlus badge for ${frames(facts)}. ${SEEN_BY_REVIEWER}`
        case 'badge_faded':
            return `${label} fades the PolyPlus badge to ${count(number(facts, 'opacity'))}% for ${frames(facts)}. Below ${count(number(facts, 'limit'))}% the badge is hard to see. ${SEEN_BY_REVIEWER}`
        case 'badge_covered':
            return `${layerName(facts)} covers ${count(number(facts, 'percent'))}% of the badge. Move the layer, or set Draws to "Over the background, behind the name". ${SEEN_BY_REVIEWER}`
        case 'art_coverage':
            if (facts.values.times !== undefined) {
                return `The art is ${number(facts, 'times').toFixed(1)}x the size of a plain tag, and the reviewer checks anything from ${count(number(facts, 'limit'))}x. Make it smaller, or keep it on purpose.`
            }
            return `The art covers ${count(number(facts, 'percent'))}% of the space around the tag, and the reviewer checks anything from ${count(number(facts, 'limit'))}%. Make it smaller, or keep it on purpose.`
        case 'fixed_height': {
            const lines = number(facts, 'lines')
            const choice = LINE_NAMES[lines] ?? `${count(lines)} lines`
            return `The art frames a one-line tag but not a ${count(lines)}-line one. Use a body, stick the art to the tag's edges, or repeat it. Set Lines to ${choice} to check. ${SEEN_BY_REVIEWER}`
        }
        case 'translucent_overlap':
            return `${layerName(facts)} has ${count(number(facts, 'px'))} see-through pixels over other layers, so they blend with the art under them.`
        case 'position_clamped':
            return clampMessage(facts, label)
        case 'plate_background':
            return 'The whole nameplate moves, but the game background stays still. Turn on Draws its own background in Nameplate Settings.'
    }
}

function reviewWarning(issue: EngineIssue): ReviewWarning | null {
    const facts = classifyIssue(issue)
    if (!isReviewCode(facts.code)) return null
    const clamped = facts.code === 'position_clamped'
    const animation = issueName(facts, 'animation') ?? BADGE_TRACK.exec(issue.path)?.[1] ?? null
    const tracked = facts.code === 'badge_hidden' || facts.code === 'badge_faded' || clamped
    const lines = facts.code === 'fixed_height' ? issueValue(facts, 'lines') : null
    return {
        code: facts.code,
        message: message(facts.code, facts, animation),
        animation: tracked ? animation ?? LOOP_ANIMATION : null,
        layer: clamped ? issueName(facts, 'target') : facts.layer,
        lines,
    }
}

export function reviewWarnings(issues: EngineIssue[]): ReviewWarning[] {
    return issues.flatMap((issue) => reviewWarning(issue) ?? [])
}

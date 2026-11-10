import { issueName, issueValue } from '../checks/codes'
import { EngineIssue, loadBundle } from '../engine'
import { FIELD_QUERIES, NAMEPLATE_FUNCTIONS, NAMEPLATE_QUERIES, TEXT_QUERIES } from './catalog'
import { blockbenchMisreads, withoutNamedNumbers } from './expression'

export type MolangUse = 'channel' | 'slot'

const PROBE = 'probe'
const CACHE_LIMIT = 400
const NEARBY_LENGTH = 16
const COLUMN_SUFFIX = / at column \d+$/
const cache = new Map<string, ProbeFinding[]>()

interface ProbeFinding {
    code: string | undefined
    text: string
}

function probeFiles(source: string, use: MolangUse, params: Record<string, number>): Record<string, string> {
    const tracks = use === 'slot'
        ? { [`palette.${PROBE}`]: { keys: [[0, source]] } }
        : { [PROBE]: { opacity: [[0, source]] } }
    const manifest = {
        format: 1,
        id: 'molang_probe',
        requires: ['canvas'],
        fps: 10,
        loop: 20,
        params,
        layers: [{ id: PROBE }],
        animations: { loop: { tracks } },
    }
    return {
        'manifest.json': JSON.stringify(manifest),
        'palettes.json': JSON.stringify({ slots: [{ id: PROBE, name: 'Probe', ramp: ['#FFFFFF'] }] }),
        [`layers/${PROBE}.json`]: JSON.stringify({ kind: 'body', padding: [1, 1, 1, 1], fill: { color: PROBE } }),
    }
}

function distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0]
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const next = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
            previous = next
        }
    }
    return row[b.length]
}

function closest(name: string, options: string[]): string | null {
    let best: string | null = null
    let score = Infinity
    for (const option of options) {
        const value = distance(name, option)
        if (value < score) {
            score = value
            best = option
        }
    }
    return best !== null && score <= Math.max(2, Math.floor(name.length / 3)) ? best : null
}

function nearby(source: string | undefined, column: number | null): string {
    if (source === undefined || column === null || column < 1) return ''
    const rest = source.slice(column - 1).trim()
    return rest ? ` near '${rest.length > NEARBY_LENGTH ? `${rest.slice(0, NEARBY_LENGTH)}...` : rest}'` : ''
}

function needed(expected: string): string {
    return expected === 'a value' ? 'a number or a name' : expected
}

function sentence(text: string): string {
    return /[.!?]$/.test(text) ? text : `${text}.`
}

function argumentCount(issue: EngineIssue): string {
    const min = issueValue(issue, 'min') ?? 0
    const max = issueValue(issue, 'max') ?? min
    return min === max ? `${min}` : `${min} or ${max}`
}

function unexpectedText(issue: EngineIssue, at: string): string {
    const expected = needed(issueName(issue, 'expected') ?? '')
    const found = issueName(issue, 'found') ?? ''
    if (found === 'the end') return `This formula stops too early: it still needs ${expected} at the end.`
    return `This formula has ${found} where it needs ${expected}${at}.`
}

function codedMolangText(issue: EngineIssue, use: MolangUse, at: string): string | null {
    const name = issueName(issue, 'name') ?? ''
    const query = issueName(issue, 'query') ?? ''
    const fn = issueName(issue, 'function') ?? ''
    const limit = issueValue(issue, 'limit') ?? 0
    switch (issue.code) {
        case 'molang_unknown_query': {
            const guess = closest(query, NAMEPLATE_QUERIES.map((entry) => entry.id))
            return `q.${query} is not a nameplate query.${guess ? ` Did you mean q.${guess}?` : ' Type q. to see the list.'}`
        }
        case 'molang_query_place': {
            const kind = FIELD_QUERIES.includes(query) ? 'fields' : TEXT_QUERIES.includes(query) ? 'text effects' : issueName(issue, 'place') ?? ''
            return `q.${query} only works in ${kind}, not in ${use === 'slot' ? 'colors' : 'keyframes'}.`
        }
        case 'molang_unknown_math': {
            if (fn === 'random' || fn === 'random_integer' || fn === 'die_roll') {
                return `math.${fn} is not available: every player must see the same thing. Use math.hash(q.frame, 0, 1) for a repeatable random number from 0 to 1.`
            }
            const guess = closest(fn, NAMEPLATE_FUNCTIONS.map((entry) => entry.id))
            return `math.${fn} is not available.${guess ? ` Did you mean math.${guess}?` : ' Type math. to see the list.'}`
        }
        case 'molang_unknown_function':
            return `${name}( ) is not a function here. Functions start with math., for example math.sin(q.frame).`
        case 'molang_unknown_name':
            return `'${name}' is not a name the nameplate knows. Queries start with q., functions with math., your own variables with v. or t.`
        case 'molang_cost':
            return `This formula is too heavy: ${issueValue(issue, 'cost') ?? 0} work a frame, and the limit is ${limit}. Make it shorter, or use fewer math.fbm and math.noise calls.`
        case 'molang_too_big':
            return `This formula is too long: more than ${limit} parts. Make it shorter.`
        case 'molang_too_deep':
            return `This formula has too many brackets inside brackets (more than ${limit} deep). Make it simpler.`
        case 'molang_too_long':
            return `This formula is longer than ${limit} characters. Make it shorter.`
        case 'molang_constant':
            return use === 'slot'
                ? 'This formula always gives the same color. Use a normal shade instead.'
                : 'This formula always gives the same value. Type the number instead.'
        case 'molang_unknown_param':
            return `No shared number is called '${issueName(issue, 'param') ?? ''}'. Add it under Shared Numbers.`
        case 'molang_arguments':
            return `math.${fn} needs ${argumentCount(issue)} values between its brackets, not ${issueValue(issue, 'count') ?? 0}.`
        case 'molang_unexpected':
            return unexpectedText(issue, at)
        case 'molang_empty':
            return 'This formula is empty. Type a number or a formula.'
        case 'molang_unterminated':
            return `A quote is never closed${at}. Add the closing quote.`
        case 'molang_character':
            return `The character '${issueName(issue, 'character') ?? ''}' can't be used in a formula. Remove it.`
        case 'molang_string':
            return `Text in quotes only works inside q.variant_param${at}.`
        case 'molang_value':
            return `This part needs a number or a name${at}.`
        case 'molang_uncalled':
            return `${name} is a function, so it needs brackets: ${name}( ).`
        case 'molang_not_query':
            return `${name} is not a query. Queries start with q.`
        case 'molang_assign':
            return `Only v. and t. variables can be given a value, not ${name}.`
        case 'molang_variable_name':
            return `${name} needs a variable name after it.`
        case 'molang_variables':
            return `This formula uses more than ${limit} variables. Use fewer.`
        case 'molang_param_call':
            return `q.variant_param takes one name in quotes, like q.variant_param('speed').`
        default:
            return null
    }
}

export function molangIssueText(issue: EngineIssue, use: MolangUse, source?: string): string {
    return codedMolangText(issue, use, nearby(source, issueValue(issue, 'column'))) ?? sentence(issue.message.trim().replace(COLUMN_SUFFIX, ''))
}

function trackPrefix(use: MolangUse): string {
    return use === 'slot' ? `manifest.json#animations.loop.tracks.palette.${PROBE}` : `manifest.json#animations.loop.tracks.${PROBE}`
}

function probe(source: string, use: MolangUse, params: Record<string, number>): ProbeFinding[] {
    const key = `${use}\u0000${JSON.stringify(params)}\u0000${source}`
    const cached = cache.get(key)
    if (cached) return cached
    const prefix = trackPrefix(use)
    const loaded = loadBundle(probeFiles(source, use, params))
    const seen = new Set<string>()
    const result: ProbeFinding[] = []
    for (const issue of loaded.issues) {
        if (issue.path !== '' && !issue.path.startsWith(prefix)) continue
        const text = molangIssueText(issue, use, source)
        if (seen.has(text)) continue
        seen.add(text)
        result.push({ code: issue.code, text })
    }
    cache.set(key, result)
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    return result
}

export function checkMolang(source: string, use: MolangUse, params: Record<string, number> = {}): string[] {
    return probe(source, use, params).map((finding) => finding.text)
}

export function checkConstantFormula(source: string, params: Record<string, number> = {}): string[] {
    const misread = blockbenchMisreads(source)
    if (misread) return [misread]
    return probe(withoutNamedNumbers(source), 'channel', params)
        .filter((finding) => finding.code !== 'molang_constant')
        .map((finding) => finding.text)
}

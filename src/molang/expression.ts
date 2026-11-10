export type ValueKind =
    | { kind: 'empty' }
    | { kind: 'number', value: number }
    | { kind: 'constant', source: string }
    | { kind: 'molang', source: string }

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/
const BARE_POINT = /(?<![\w.])\.\d+|\d\.(?![\d.])/
const NAME = /[a-z_][a-z0-9_]*(\s*\.\s*[a-z_][a-z0-9_]*)*/gi
const NAMED_NUMBERS: Array<[RegExp, string]> = [[/\bmath\s*\.\s*pi\b/gi, '3'], [/\btrue\b/gi, '1'], [/\bfalse\b/gi, '0']]
const SHARED_CONSTANTS = new Set([
    'math.sin', 'math.cos', 'math.abs', 'math.min', 'math.max', 'math.clamp', 'math.lerp', 'math.pow',
    'math.sqrt', 'math.floor', 'math.ceil', 'math.round', 'math.mod', 'math.pi', 'true', 'false',
])

export function classifyValue(raw: unknown): ValueKind {
    if (typeof raw === 'number') return isFinite(raw) ? { kind: 'number', value: raw } : { kind: 'empty' }
    if (typeof raw !== 'string') return { kind: 'empty' }
    const source = raw.trim()
    if (!source) return { kind: 'empty' }
    if (NUMBER.test(source)) {
        const value = Number(source)
        if (!isFinite(value)) return { kind: 'empty' }
        return PLAIN_NUMBER.test(source) ? { kind: 'number', value } : { kind: 'constant', source }
    }
    if (/[;{}]/.test(source) || /(^|[^a-z0-9_.])return([^a-z0-9_]|$)/i.test(source)) return { kind: 'molang', source }
    const names = source.match(NAME) ?? []
    const constant = names.every((name) => SHARED_CONSTANTS.has(name.replace(/\s+/g, '').toLowerCase()))
    return constant ? { kind: 'constant', source } : { kind: 'molang', source }
}

export function withoutNamedNumbers(source: string): string {
    return NAMED_NUMBERS.reduce((text, [name, number]) => text.replace(name, (match) => number.padEnd(match.length)), source)
}

export function blockbenchMisreads(source: string): string | null {
    const point = BARE_POINT.exec(source)?.[0]
    if (point) return `Blockbench can't read ${point}, so this keyframe would export the wrong value. Write it with a digit on both sides of the point, like ${point.startsWith('.') ? `0${point}` : `${point}0`}.`
    if (NUMBER.test(source)) return `Blockbench can't read a number written like ${source}, so this keyframe would export the wrong value. Type the full number.`
    if (source.includes('%')) return "Blockbench can't read %, so this keyframe would export the wrong value. Use math.mod(a, b) instead, or type the result."
    return null
}

export function molangSource(raw: unknown): string | null {
    const value = classifyValue(raw)
    return value.kind === 'molang' ? value.source : null
}

export function looksLikeMolang(text: string): boolean {
    return classifyValue(text).kind === 'molang'
}

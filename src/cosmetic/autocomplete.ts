import { engineSignals } from '../engine'
import { activeKind } from './state'

export interface Completion {
    text: string
    label?: string
    overlap: number
    priority?: number
}

const TOKEN = /(?:^|[^\w.])((?:q|query)\.(?:owner\.)?|(?:v|variable)\.)(\w*)$/

export const HOST_VARIABLES: Record<string, string[]> = {}

export function cosmeticCompletions(text: string, position: number): Completion[] {
    const kind = activeKind()
    if (!kind) return []
    const match = TOKEN.exec(String(text ?? '').slice(0, position))
    if (!match) return []
    const [, prefix, typed] = match
    const names = prefix.startsWith('v') ? HOST_VARIABLES[kind] ?? [] : engineSignals()
    return names
        .filter((name) => name.startsWith(typed) && name !== typed)
        .map((name) => ({ text: name, label: `${prefix}${name}`, overlap: typed.length, priority: 2 }))
}

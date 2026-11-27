import { isToggleSignal } from '../engine/load'
import { isDiscreteHost } from './registry'

export interface SignalChange {
    at: number
    values: Readonly<Record<string, number>>
    host?: Readonly<Record<string, number>>
}

export const MAX_SIGNAL_CHANGES = 64
const NEAR = 1e-9
const NONE: Readonly<Record<string, number>> = Object.freeze({})

function valueOf(values: Readonly<Record<string, number>>, name: string): number {
    return Number(values[name]) || 0
}

function changedNames(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): string[] {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((name) => valueOf(a, name) !== valueOf(b, name))
}

function sameValues(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
    return changedNames(a, b).length === 0
}

function changeAt(changes: readonly SignalChange[], at: number): SignalChange | undefined {
    let found = changes[0]
    for (const change of changes) {
        if (change.at > at + NEAR) break
        found = change
    }
    return found
}

export function signalsAt(changes: readonly SignalChange[], at: number): Readonly<Record<string, number>> {
    return changeAt(changes, at)?.values ?? NONE
}

export function hostAt(changes: readonly SignalChange[], at: number): Readonly<Record<string, number>> {
    return changeAt(changes, at)?.host ?? NONE
}

function sameAt(changes: readonly SignalChange[], at: number, values: Readonly<Record<string, number>>, host: Readonly<Record<string, number>>): boolean {
    const change = changeAt(changes, at)
    return !!change && sameValues(change.values, values) && sameValues(change.host ?? NONE, host)
}

function changeOf(at: number, values: Readonly<Record<string, number>>, host: Readonly<Record<string, number>>): SignalChange {
    return Object.keys(host).length ? { at, values: { ...values }, host: { ...host } } : { at, values: { ...values } }
}

interface Edge {
    at: number
    before: number
    after: number
}

function lastEdges(changes: readonly SignalChange[], pick: (change: SignalChange) => Readonly<Record<string, number>>): Map<string, Edge> {
    const edges = new Map<string, Edge>()
    let previous: Readonly<Record<string, number>> | null = null
    for (const change of changes) {
        const now = pick(change)
        const names = previous ? changedNames(previous, now) : Object.keys(now)
        for (const name of names) edges.set(name, { at: change.at, before: valueOf(previous ?? now, name), after: valueOf(now, name) })
        previous = now
    }
    return edges
}

function stateAt(edges: ReadonlyMap<string, Edge>, at: number, first: boolean): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [name, edge] of edges) {
        const reached = edge.at <= at + NEAR
        const value = reached ? edge.after : edge.before
        if (value !== 0 || (first && reached)) out[name] = value
    }
    return out
}

export function compactSignals(changes: readonly SignalChange[], before: number): SignalChange[] {
    const old = changes.filter((change) => change.at < before - NEAR)
    const recent = changes.filter((change) => change.at >= before - NEAR)
    if (!old.length) return recent.slice()
    const values = lastEdges(old, (change) => change.values)
    const host = lastEdges(old, (change) => change.host ?? NONE)
    const times = [...new Set([...values.values(), ...host.values()].map((edge) => edge.at))].sort((a, b) => a - b)
    if (!times.length) times.push(old[old.length - 1].at)
    return [...times.map((at, i) => changeOf(at, stateAt(values, at, i === 0), stateAt(host, at, i === 0))), ...recent]
}

function onlyLevels(from: SignalChange, to: SignalChange): boolean {
    return changedNames(from.values, to.values).every((name) => !isToggleSignal(name))
        && changedNames(from.host ?? NONE, to.host ?? NONE).every((name) => !isDiscreteHost(name))
}

function bound(changes: SignalChange[]) {
    for (let i = 1; changes.length > MAX_SIGNAL_CHANGES && i < changes.length - 1;) {
        if (onlyLevels(changes[i - 1], changes[i]) && onlyLevels(changes[i], changes[i + 1])) changes.splice(i, 1)
        else i++
    }
    if (changes.length <= MAX_SIGNAL_CHANGES) return
    const kept = Math.floor(MAX_SIGNAL_CHANGES / 2)
    const folded = compactSignals(changes, changes[changes.length - kept].at)
    if (folded.length > MAX_SIGNAL_CHANGES) folded.splice(0, folded.length - MAX_SIGNAL_CHANGES)
    changes.splice(0, changes.length, ...folded)
}

export function recordSignals(changes: SignalChange[], at: number, values: Readonly<Record<string, number>>, host: Readonly<Record<string, number>> = NONE) {
    const future = changes.findIndex((change) => change.at > at + NEAR)
    if (future >= 0) changes.splice(future)
    if (sameAt(changes, at, values, host)) return
    const later = changes.findIndex((change) => change.at >= at - NEAR)
    if (later >= 0) changes.splice(later)
    if (sameAt(changes, at, values, host)) return
    changes.push(changeOf(at, values, host))
    bound(changes)
}

import { createListenerSet, ListenerSet } from '../util/events'
import { disposeAll } from '../util/teardown'
import { cloneJson, sameJson } from '../util/json'
import { MaterialJson, readGraph } from './graph'

export interface Session {
    key: string
    graph: MaterialJson
    onChange: (graph: unknown) => void
    read: () => unknown
    listeners: ListenerSet
}

const sessions = new Map<string, Session>()
let hooks: Deletable[] = []

function projectKey(key: string): string {
    const project = typeof Project !== 'undefined' && Project ? String((Project as any).uuid ?? '') : ''
    return `${project}:${key}`
}

export function openSession(key: string, graph: unknown, onChange: (graph: unknown) => void, read: () => unknown): Session {
    const full = projectKey(key)
    const existing = sessions.get(full)
    if (existing) {
        existing.graph = readGraph(graph)
        existing.onChange = onChange
        existing.read = read
        return existing
    }
    const session: Session = { key: full, graph: readGraph(graph), onChange, read, listeners: createListenerSet('material editor refresh failed') }
    sessions.set(full, session)
    return session
}

export function closeSession(session: Session) {
    session.listeners.clear()
    if (sessions.get(session.key) === session) sessions.delete(session.key)
}

export function commitGraph(session: Session, change: (graph: MaterialJson) => void | false): boolean {
    const next = cloneJson(session.graph)
    if (change(next) === false || sameJson(next, session.graph)) return false
    session.graph = next
    try {
        session.onChange(cloneJson(next))
    } catch (error) {
        console.error('[polyplus_nameplate] material onChange failed', error)
    }
    session.listeners.notify()
    return true
}

function reread() {
    for (const session of sessions.values()) {
        if (session.listeners.size === 0) continue
        let value: unknown
        try {
            value = session.read()
        } catch (error) {
            console.error('[polyplus_nameplate] material read failed', error)
            continue
        }
        if (value === undefined || value === null) continue
        const graph = readGraph(value)
        if (sameJson(graph, session.graph)) continue
        session.graph = graph
        session.listeners.notify()
    }
}

export function registerMaterialUndo() {
    if (hooks.length > 0) return
    hooks = [Blockbench.on('undo', reread), Blockbench.on('redo', reread)]
}

export function unregisterMaterialUndo() {
    disposeAll(hooks)
    sessions.clear()
}

import { createListenerSet } from './events'
import { cloneJson } from './json'
import { hasProject } from './project'
import { tryUndoEdit } from './undo'

export function installUndoState<S>(aspect: string, capture: () => S, restore: (saved: S) => void): Deletable[] {
    return [
        Blockbench.on('create_undo_save', (event: any) => {
            if (event?.aspects?.[aspect] && hasProject()) event.save[aspect] = capture()
        }),
        Blockbench.on('load_undo_save', (event: any) => {
            if (event?.save?.[aspect] && hasProject()) restore(event.save[aspect])
        }),
    ]
}

export interface ProjectStateOptions<T> {
    property: string
    aspect: string
    listenerFailure: string | null
    empty(): T
    parse(raw: unknown): T
    serialize?(state: T): unknown
}

export interface ProjectStateCommit {
    aspects?: Record<string, unknown>
    compare?: boolean
}

export interface ProjectState<T> {
    read(): T
    write(state: T): void
    on(listener: () => void): () => void
    notify(): void
    commit(label: string, change: (state: T) => void | false, options?: ProjectStateCommit): boolean
    register(): void
    unregister(): void
}

export function defineProjectState<T>(options: ProjectStateOptions<T>): ProjectState<T> {
    const { property: name, aspect, empty, parse } = options
    const serialize = options.serialize ?? cloneJson
    const listeners = createListenerSet(options.listenerFailure)
    let property: Property | null = null
    let hooks: Deletable[] = []

    function read(): T {
        if (!hasProject()) return empty()
        return parse((Project as any)[name])
    }

    function write(state: T) {
        if (!hasProject()) return
        ;(Project as any)[name] = serialize(state)
    }

    return {
        read,
        write,
        on: listeners.on,
        notify: listeners.notify,
        commit(label, change, { aspects = {}, compare = false } = {}) {
            if (!hasProject()) return false
            const state = read()
            write(state)
            const before = compare ? JSON.stringify(state) : null
            const committed = tryUndoEdit({ ...aspects, [aspect]: true }, label, () => {
                if (change(state) === false) return false
                if (before !== null && JSON.stringify(state) === before) return false
                write(state)
            })
            if (committed) listeners.notify()
            return committed
        },
        register() {
            if (property) return
            property = new Property(ModelProject, 'object', name, {
                exposed: false,
                default: () => empty(),
            })
            hooks = installUndoState(aspect, () => cloneJson(read()), (saved) => {
                write(parse(saved))
                listeners.notify()
            })
        },
        unregister() {
            for (const hook of hooks.splice(0)) hook.delete()
            property?.delete()
            property = null
        },
    }
}

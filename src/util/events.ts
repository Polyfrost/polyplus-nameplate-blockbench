export interface ListenerSet<A extends unknown[] = []> {
    readonly size: number
    on(listener: (...args: A) => void): () => void
    notify(...args: A): void
    clear(): void
}

export function createListenerSet<A extends unknown[] = []>(failure: string | null): ListenerSet<A> {
    const listeners = new Set<(...args: A) => void>()
    return {
        get size() {
            return listeners.size
        },
        on(listener) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        notify(...args) {
            for (const listener of Array.from(listeners)) {
                if (failure === null) {
                    listener(...args)
                    continue
                }
                try {
                    listener(...args)
                } catch (error) {
                    console.error(`[polyplus_nameplate] ${failure}`, error)
                }
            }
        },
        clear() {
            listeners.clear()
        },
    }
}

export type Disposable = (() => void) | { delete(): void }

function dispose(item: Disposable) {
    if (typeof item === 'function') item()
    else item.delete()
}

export function disposeAll(items: Disposable[]) {
    for (const item of items.splice(0)) dispose(item)
}

export function disposeAllReversed(items: Disposable[]) {
    for (const item of items.splice(0).reverse()) dispose(item)
}

export function disposeAllSafe(items: Disposable[], failure: string, reversed = false) {
    const pending = items.splice(0)
    if (reversed) pending.reverse()
    for (const item of pending) {
        try {
            dispose(item)
        } catch (error) {
            console.error(`[polyplus_nameplate] ${failure}`, error)
        }
    }
}

export function forgetToolbar(toolbar: Toolbar) {
    if (typeof Toolbars !== 'undefined' && (Toolbars as any)[toolbar.id] === toolbar) delete (Toolbars as any)[toolbar.id]
}

export function dropToolbar(toolbar: Toolbar) {
    toolbar.node?.remove()
    forgetToolbar(toolbar)
}

const ended = new Set<() => void>()
let dragging = false
let installed: (() => void) | null = null

function paintViewport(): HTMLElement | null {
    return (globalThis as any).UVEditor?.vue?.$refs?.viewport ?? null
}

function press(event: PointerEvent) {
    const viewport = paintViewport()
    if (!viewport || !(event.target instanceof Node) || !viewport.contains(event.target)) return
    dragging = true
}

function release() {
    if (!dragging) return
    dragging = false
    for (const listener of ended) setTimeout(() => {
        try {
            listener()
        } catch (error) {
            console.error('[polyplus_nameplate] paint drag listener failed', error)
        }
    }, 0)
}

export function isPaintDragging(): boolean {
    return dragging
}

export function onPaintDragEnd(listener: () => void): () => void {
    ended.add(listener)
    return () => {
        ended.delete(listener)
    }
}

export function watchPaintDrags(): () => void {
    if (!installed) {
        document.addEventListener('pointerdown', press, true)
        document.addEventListener('pointerup', release, true)
        document.addEventListener('pointercancel', release, true)
        window.addEventListener('blur', release)
        installed = () => {
            document.removeEventListener('pointerdown', press, true)
            document.removeEventListener('pointerup', release, true)
            document.removeEventListener('pointercancel', release, true)
            window.removeEventListener('blur', release)
            dragging = false
            installed = null
        }
    }
    return installed
}

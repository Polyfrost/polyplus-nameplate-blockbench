export function injectStyle(id: string, css: string): () => void {
    document.getElementById(id)?.remove()
    const style = document.createElement('style')
    style.id = id
    style.textContent = css
    document.head.appendChild(style)
    return () => {
        style.remove()
    }
}

export function ensureStyle(id: string, css: string) {
    if (document.getElementById(id)) return
    injectStyle(id, css)
}

export function removeStyle(id: string) {
    document.getElementById(id)?.remove()
}

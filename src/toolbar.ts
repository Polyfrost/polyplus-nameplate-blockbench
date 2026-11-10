const SPACER_MARKS = ['_', '+', '#', '|']
const LABELED_ITEMS = new Set([
    'polyplus_nameplate_colorway',
    'polyplus_nameplate_preview_variant',
    'polyplus_nameplate_name_width',
    'polyplus_nameplate_seed',
    'polyplus_nameplate_frame',
])

function isSpacer(entry: unknown): boolean {
    return typeof entry !== 'string' || SPACER_MARKS.some((mark) => entry.startsWith(mark))
}

function isUsable(stored: unknown[], children: unknown[]): boolean {
    const kept = new Set(stored)
    return stored.some((entry) => !isSpacer(entry)) && children.every((child) => isSpacer(child) || kept.has(child))
}

function dropStaleStoredToolbar(id: string, children: unknown[] = []): void {
    const bars = (globalThis as { BARS?: { stored?: Record<string, unknown[]> } }).BARS
    const stored = bars?.stored?.[id]
    if (!Array.isArray(stored) || isUsable(stored, children)) return
    delete bars!.stored![id]
    try {
        localStorage.setItem('toolbars', JSON.stringify(bars!.stored))
    } catch {
        return
    }
}

function labelItems(children: unknown[] = []) {
    for (const child of children) {
        const item = typeof child === 'string' && LABELED_ITEMS.has(child) ? ((BarItems as any)[child] as BarItem | undefined) : undefined
        if (item && !item.node.classList.contains('has_label')) item.addLabel(true)
    }
}

export function pluginToolbar(id: string, options: { children?: unknown[], [key: string]: unknown }): Toolbar {
    dropStaleStoredToolbar(id, options.children)
    labelItems(options.children)
    return new Toolbar(id, options as any)
}

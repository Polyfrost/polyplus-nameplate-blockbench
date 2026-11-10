import { isNameplateActive } from '../format'

const LIST_SELECTOR = '#cubes_list'

export function allowOutlinerDrag(): () => void {
    const panel = typeof Panels === 'undefined' ? undefined : Panels.outliner
    const node = panel?.node as HTMLElement | undefined
    if (!node) return () => {}
    let pending: ReturnType<typeof setTimeout> | null = null
    let lent = false

    const restore = () => {
        pending = null
        if (!lent) return
        lent = false
        const selected = typeof Modes === 'undefined' ? null : (Modes.selected as Mode | false)
        if (!selected || selected.id !== 'edit') (Modes as any).edit = false
    }

    const press = (event: Event) => {
        if (!isNameplateActive() || typeof Modes === 'undefined' || Modes.edit || !(Modes.paint || Modes.animate)) return
        const button = (event as MouseEvent).button
        if (typeof button === 'number' && button !== 0) return
        const target = event.target as HTMLElement | null
        if (!target || typeof target.closest !== 'function' || !target.closest(LIST_SELECTOR)) return
        if (target.classList.contains('outliner_toggle')) return
        ;(Modes as any).edit = true
        lent = true
        if (pending) clearTimeout(pending)
        pending = setTimeout(restore, 0)
    }

    node.addEventListener('mousedown', press, true)
    node.addEventListener('touchstart', press, true)
    return () => {
        node.removeEventListener('mousedown', press, true)
        node.removeEventListener('touchstart', press, true)
        if (pending) clearTimeout(pending)
        restore()
    }
}

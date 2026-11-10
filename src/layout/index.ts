import { isNameplateActive, onFormatActivation, onFormatDeactivation } from '../format'
import { injectStyle } from '../util/style'
import { disposeAll } from '../util/teardown'
import { allowOutlinerDrag } from './drag'
import { LAYOUT_CLASS, LAYOUT_STYLE, LAYOUT_STYLE_ID } from './style'

function workScreen(): HTMLElement | null {
    const fromInterface = typeof Interface === 'undefined' ? null : ((Interface as any).work_screen as HTMLElement | undefined)
    return fromInterface ?? document.getElementById('work_screen')
}

function settle(screen: HTMLElement | null) {
    if (!screen) return
    if (screen.scrollTop !== 0) screen.scrollTop = 0
    if (screen.scrollLeft !== 0) screen.scrollLeft = 0
}

function sync() {
    const active = isNameplateActive()
    document.body.classList.toggle(LAYOUT_CLASS, active)
    if (active) settle(workScreen())
}

export function registerLayout(): () => void {
    const removeStyle = injectStyle(LAYOUT_STYLE_ID, LAYOUT_STYLE)

    const screen = workScreen()
    const guard = () => {
        if (isNameplateActive()) settle(screen)
    }
    screen?.addEventListener('scroll', guard)

    const removers = [onFormatActivation(sync), onFormatDeactivation(() => document.body.classList.remove(LAYOUT_CLASS)), allowOutlinerDrag()]
    sync()

    return () => {
        disposeAll(removers)
        screen?.removeEventListener('scroll', guard)
        document.body.classList.remove(LAYOUT_CLASS)
        removeStyle()
    }
}

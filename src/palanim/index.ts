import { registerColorAnimationPanel } from './panel'
import { disposeAllSafe } from '../util/teardown'
import { registerSweepBrush } from './sweep'

export { applyPaletteAnimation } from './compile'
export { takePaletteAnimation } from './import'
export { paletteAnimationProblems, paletteIssueText } from './checks'
export type { PaletteMotion } from './types'

const cleanups: Array<() => void> = []

export function registerPaletteAnimation() {
    if (cleanups.length) return
    for (const register of [registerColorAnimationPanel, registerSweepBrush]) {
        try {
            cleanups.push(register())
        } catch (error) {
            console.error('[polyplus_nameplate] color animation registration failed', error)
        }
    }
}

export function unregisterPaletteAnimation() {
    disposeAllSafe(cleanups, 'color animation unregistration failed', true)
}

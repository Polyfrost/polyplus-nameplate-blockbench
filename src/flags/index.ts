import { registerFlagsPanel } from './panel'
import { registerFlagsState, unregisterFlagsState } from './state'

export { createFlagCheck } from './checks'
export { applyFlags, FLAGS_FILE, flagsJson, importFlags, normalizeFlags } from './compile'
export { fitBands, fitSymmetric, fittedRows } from './fit'
export { addFlag, promptNewFlag } from './panel'
export { FLAGS_PROPERTY, readFlags, writeFlags } from './state'
export * from './types'

let cleanup: (() => void) | null = null

export function registerFlags() {
    if (cleanup) return
    registerFlagsState()
    let removePanel: (() => void) | null = null
    try {
        removePanel = registerFlagsPanel()
    } catch (error) {
        console.error('[polyplus_nameplate] flag panel registration failed', error)
    }
    cleanup = () => {
        removePanel?.()
        unregisterFlagsState()
    }
}

export function unregisterFlags() {
    const pending = cleanup
    cleanup = null
    try {
        pending?.()
    } catch (error) {
        console.error('[polyplus_nameplate] flag unregistration failed', error)
    }
}

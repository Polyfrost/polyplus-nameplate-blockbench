import { registerSnapAction } from './pixels'
import { disposeAll } from '../util/teardown'
import { FRAMES_PROPERTY } from '../util/texture'
import { installUndoHooks, readNameplate } from './state'

export { readNameplate } from './state'
export { readSprites } from './sprites'

let framesProperty: Property | null = null
let undoHooks: Deletable[] = []
let removeSnap: (() => void) | null = null

export function registerPalette() {
    if (framesProperty) return
    framesProperty = new Property(Texture, 'number', FRAMES_PROPERTY, { default: 1 })
    undoHooks = installUndoHooks()
    try {
        removeSnap = registerSnapAction(() => readNameplate().palette)
    } catch (error) {
        console.error('[polyplus_nameplate] snap to palette registration failed', error)
    }
}

export function unregisterPalette() {
    removeSnap?.()
    removeSnap = null
    disposeAll(undoHooks)
    if (framesProperty) {
        framesProperty.delete()
        framesProperty = null
    }
}

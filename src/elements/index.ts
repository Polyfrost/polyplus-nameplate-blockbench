import { registerAnimate } from '../animate'
import { registerBadge, unregisterBadge } from '../badge'
import { isNameplateActive } from '../format'
import { registerActions } from './actions'
import { patchGroupChannels, patchKeyframeFields } from './channels'
import { defineLayerTypes, LayerTypes } from './classes'
import { registerDuplicate } from './duplicate'
import { registerFocus } from './focus'
import { isGroupNode, isLayerNode, walkNodes } from './nodes'
import { registerPictureCleanup } from './pictures'

export { readAnimations, readGroups, readLayers, readLoop } from './read'

let cleanups: Array<() => void> = []
let layerTypes: LayerTypes | null = null

function addAnimatorsToTimeline() {
    if (!isNameplateActive()) return
    const animation = BBAnimation.selected
    if (!animation) return
    walkNodes(node => {
        if (!isLayerNode(node) && !isGroupNode(node)) return
        const animator = animation.getBoneAnimator(node) as any
        if (!animator) return
        const keyed = Array.isArray(animator.keyframes) && animator.keyframes.length > 0
        if (keyed || node.selected) animator.addToTimeline(true)
    })
}

function registerTimelineHooks(): () => void {
    const listener = Blockbench.on('select_animation', addAnimatorsToTimeline)
    return () => listener.delete()
}

export function registerElements() {
    if (cleanups.length > 0) return
    const steps: Array<() => (() => void)> = [
        patchKeyframeFields,
        patchGroupChannels,
        () => {
            const types = defineLayerTypes()
            layerTypes = types
            return () => {
                layerTypes = null
                types.dispose()
            }
        },
        () => {
            if (!layerTypes) throw new Error('layer types are not registered')
            return registerActions(layerTypes)
        },
        () => {
            registerBadge()
            return unregisterBadge
        },
        registerTimelineHooks,
        registerDuplicate,
        registerFocus,
        registerPictureCleanup,
        registerAnimate,
    ]
    for (const step of steps) {
        try {
            cleanups.push(step())
        } catch (error) {
            console.error('[polyplus_nameplate] element registration failed', error)
        }
    }
}

export function unregisterElements() {
    const pending = cleanups
    cleanups = []
    for (const cleanup of pending.reverse()) {
        try {
            cleanup()
        } catch (error) {
            console.error('[polyplus_nameplate] element unregistration failed', error)
        }
    }
}

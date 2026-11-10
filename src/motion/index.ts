import { isNameplateActive } from '../format'
import { registerMotionActions } from './actions'
import { patchMotionKeyframeFields } from './channels'
import { defineMotionTypes, MotionTypes } from './element'
import { isMotionNode } from './types'

export { ACTION_ADD_EMITTER, ACTION_ADD_PATH, startAddEmitter, startAddPath } from './actions'
export { addMotionKeyframes, addPlanMotionKeyframes, linkMotionTextures, motionTypeFor } from './build'
export { createMotionCheck } from './checks'
export { applyMotionManifest, layerTextureUuids, spriteAdaptiveFields, usesSprites } from './compile'
export { defineSpriteAdaptiveProperties, motionTrackChannels } from './element'
export { applyMotionField, spriteAdaptiveConfig } from './form'
export { fileSpriteIds, isBurstTrack, planSpriteIds, SPRITE_ADAPTIVE_KEYS, spriteAdaptivePlan, takeBurstTracks } from './import'
export type { MotionLayerPlan, MotionSpeedPlan } from './import'
export { readBurstKeys, readSpriteAdaptive } from './read'
export * from './types'

let cleanups: Array<() => void> = []
let types: MotionTypes | null = null

function addMotionAnimatorsToTimeline() {
    if (!isNameplateActive()) return
    const animation = BBAnimation.selected
    if (!animation) return
    for (const node of Outliner.elements as any[]) {
        if (!isMotionNode(node)) continue
        const animator = animation.getBoneAnimator(node) as any
        if (!animator) continue
        const keyed = Array.isArray(animator.keyframes) && animator.keyframes.length > 0
        if (keyed || node.selected) animator.addToTimeline(true)
    }
}

export function registerMotion() {
    if (cleanups.length > 0) return
    const steps: Array<() => (() => void)> = [
        patchMotionKeyframeFields,
        () => {
            const defined = defineMotionTypes()
            types = defined
            return () => {
                types = null
                defined.dispose()
            }
        },
        () => {
            if (!types) throw new Error('motion types are not registered')
            return registerMotionActions(types)
        },
        () => {
            const listener = Blockbench.on('select_animation', addMotionAnimatorsToTimeline)
            return () => listener.delete()
        },
    ]
    for (const step of steps) {
        try {
            cleanups.push(step())
        } catch (error) {
            console.error('[polyplus_nameplate] motion registration failed', error)
        }
    }
}

export function unregisterMotion() {
    const pending = cleanups
    cleanups = []
    for (const cleanup of pending.reverse()) {
        try {
            cleanup()
        } catch (error) {
            console.error('[polyplus_nameplate] motion unregistration failed', error)
        }
    }
}

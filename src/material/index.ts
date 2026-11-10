import { setBinarySource } from '../engine'
import { registerEffectActions } from './actions'
import { materialBinary } from './compile'
import { defineEffectType, syncEffectParamChannels } from './element'
import { registerParamKeyMenu } from './keys'
import { isPng, toBase64 } from './png'
import { commitMaterials, onMaterialsChanged, readMaterials, registerMaterialsState, unregisterMaterialsState } from './state'
import { MATERIAL_ID } from './types'

export { ACTION_ADD_EFFECT, addEffect, startAddEffect } from './actions'
export { applyMaterials, materialBinary, usesMaterials } from './compile'
export { effectType, materialTypeFor, syncEffectParamChannels } from './element'
export { effectReads, isParamChannel, PARAM_BASE, PARAM_PREFIX, paramChannel, paramOfChannel, importParamKeys, readParamKeys } from './params'
export type { ParamKeyPlan } from './params'
export { addMaterialTextures, isMaterialFilePath, missingMaterialFiles, planMaterials } from './import'
export type { MaterialLayerPlan } from './import'
export { onMaterialsChanged, readMaterials, writeMaterials } from './state'
export { withToneHints } from './tone'
export { materialProblem } from './words'
export * from './types'

let cleanups: Array<() => void> = []

export function setMaterialTexture(id: string, bytes: Uint8Array): boolean {
    if (!MATERIAL_ID.test(id) || !isPng(bytes)) return false
    return commitMaterials('Set graph texture', (state) => {
        state.textures[id] = toBase64(bytes)
    })
}

export function registerMaterials() {
    if (cleanups.length > 0) return
    const steps: Array<() => (() => void)> = [
        () => {
            registerMaterialsState()
            return unregisterMaterialsState
        },
        () => {
            const defined = defineEffectType()
            return () => defined.dispose()
        },
        registerEffectActions,
        registerParamKeyMenu,
        () => {
            const removeListener = onMaterialsChanged(syncEffectParamChannels)
            const hooks = [Blockbench.on('select_animation', syncEffectParamChannels), Blockbench.on('select_project', syncEffectParamChannels)]
            return () => {
                removeListener()
                for (const hook of hooks) hook.delete()
            }
        },
        () => {
            setBinarySource(() => materialBinary(readMaterials()))
            return () => setBinarySource(null)
        },
    ]
    for (const step of steps) {
        try {
            cleanups.push(step())
        } catch (error) {
            console.error('[polyplus_nameplate] material registration failed', error)
        }
    }
}

export function unregisterMaterials() {
    const pending = cleanups
    cleanups = []
    for (const cleanup of pending.reverse()) {
        try {
            cleanup()
        } catch (error) {
            console.error('[polyplus_nameplate] material unregistration failed', error)
        }
    }
}

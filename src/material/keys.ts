import { isNameplateActive } from '../format'
import { isParamChannel, keyframeIsBase, PARAM_BASE, paramLabel, paramOfChannel } from './params'
import { addKeyframeMenuItem, editKeyframes, selectedKeyframes } from '../molang/keys'
import { MATERIALS_PROPERTY } from './types'

function selectedParamKeys(): any[] {
    return selectedKeyframes(isParamChannel)
}

function currentValue(name: string): number {
    const value = typeof Project !== 'undefined' && Project ? (Project as any)[MATERIALS_PROPERTY]?.params?.[name] : undefined
    return typeof value === 'number' && isFinite(value) ? value : 0
}

function setKeys(label: string, value: (keyframe: any) => string) {
    const targets = selectedParamKeys()
    if (targets.length === 0) return
    editKeyframes(targets, label, (keyframe) => keyframe.set('x', value(keyframe)))
}

const keyMenuItem = {
    id: 'polyplus_nameplate_param_key',
    name: 'Effect setting value',
    icon: 'tune',
    description: 'A keyframe on an effect setting holds a number, or "base": the value this variant gives the setting',
    condition: () => isNameplateActive() && selectedParamKeys().length > 0,
    children() {
        const keys = selectedParamKeys()
        const names = Array.from(new Set(keys.map((keyframe) => paramOfChannel(String(keyframe.channel)) ?? '')))
        const allBase = keys.every(keyframeIsBase)
        const single = names.length === 1 ? names[0] : null
        return [
            {
                name: 'Base: the value the variant gives it',
                icon: allBase ? 'radio_button_checked' : 'radio_button_unchecked',
                description: 'Each variant keeps its own value for this setting at this keyframe',
                click: () => setKeys('Use base value', () => PARAM_BASE),
            },
            {
                name: single ? `A number: ${paramLabel(single)} as set in the Inspector (${currentValue(single)})` : 'A number: each setting as set in the Inspector',
                icon: allBase ? 'radio_button_unchecked' : 'radio_button_checked',
                description: 'Type another number in the X box of the Keyframe panel to change it',
                click: () => setKeys('Use a number', (keyframe) => String(currentValue(paramOfChannel(String(keyframe.channel)) ?? ''))),
            },
        ]
    },
}

let removeMenu: (() => void) | null = null

export function registerParamKeyMenu(): () => void {
    if (!removeMenu) removeMenu = addKeyframeMenuItem(keyMenuItem)
    return () => {
        removeMenu?.()
        removeMenu = null
    }
}

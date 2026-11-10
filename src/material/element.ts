import { defineEffectProperties } from '../kinds/effect'
import { defineElementType, ElementType, layerMenuItems } from '../elements/classes'
import { channelSet } from '../elements/channels'
import { allParamNames, effectReads, isParamChannel, paramChannel, paramLabel, paramOfChannel } from './params'
import { allAnimations } from '../util/animation'
import { EFFECT_CHANNELS, EFFECT_TYPE } from './types'

function paramConfig(channel: string): Record<string, unknown> {
    const name = paramOfChannel(channel) ?? channel
    return {
        get name() {
            return `Setting: ${paramLabel(name)}`
        },
        mutable: true,
        transform: true,
        max_data_points: 1,
        condition: (animator: any) => {
            if (!animator || !Array.isArray(animator[channel])) return false
            return effectReads(OutlinerNode.uuids[animator.uuid]).includes(name)
        },
    }
}

function paramAwareChannels(base: Record<string, any>): Record<string, any> {
    return new Proxy(base, {
        get(target, key, receiver) {
            if (typeof key === 'string' && isParamChannel(key) && !Object.prototype.hasOwnProperty.call(target, key)) target[key] = paramConfig(key)
            return Reflect.get(target, key, receiver)
        },
    })
}

function ensureArray(animator: any, channel: string) {
    void animator.channels[channel]
    if (Array.isArray(animator[channel])) return
    const vue = (globalThis as any).Vue
    if (typeof vue?.set === 'function') vue.set(animator, channel, [])
    else animator[channel] = []
}

let animatorClass: any = null

export function syncEffectAnimator(animator: any) {
    if (!animatorClass || !(animator instanceof animatorClass)) return
    for (const name of effectReads(OutlinerNode.uuids[animator.uuid])) ensureArray(animator, paramChannel(name))
}

export function syncEffectParamChannels() {
    if (!animatorClass) return
    const channels = animatorClass.prototype.channels
    for (const name of allParamNames()) void channels[paramChannel(name)]
    for (const animation of allAnimations()) {
        for (const animator of Object.values<any>(animation?.animators ?? {})) syncEffectAnimator(animator)
    }
}

function withParamKeyframes(Base: any): any {
    return class EffectAnimator extends Base {
        addKeyframe(data: any, uuid?: string) {
            if (isParamChannel(data?.channel)) ensureArray(this, data.channel)
            return super.addKeyframe(data, uuid)
        }

        createKeyframe(value: any, time: any, channel: any, undo: any, select: any) {
            if (isParamChannel(channel)) ensureArray(this, channel)
            return super.createKeyframe(value, time, channel, undo, select)
        }
    }
}

export type EffectType = ElementType

export function defineEffectType(): EffectType {
    const result = defineElementType({
        type: EFFECT_TYPE,
        title: 'Nameplate effect',
        icon: 'auto_awesome',
        channels: paramAwareChannels(channelSet(EFFECT_CHANNELS)),
        extendAnimator: withParamKeyframes,
        onSelectAnimator: syncEffectAnimator,
        hideable: true,
        menu: layerMenuItems(),
        define: defineEffectProperties,
    })
    animatorClass = result.animator
    return {
        type: result.type,
        animator: result.animator,
        dispose() {
            result.dispose()
            animatorClass = null
        },
    }
}

export function effectType(): any | null {
    return (OutlinerElement.types as any)[EFFECT_TYPE] ?? null
}

export function materialTypeFor(kind: string): any | null {
    return kind === 'material' ? effectType() : null
}

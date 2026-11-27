import { defineEffectProperties } from '../kinds/effect'
import { defineElementType, ElementType, layerMenuItems } from '../elements/classes'
import { channelSet } from '../elements/channels'
import { isParamChannel } from './params'
import { EFFECT_CHANNELS, EFFECT_TYPE } from './types'

const droppedTracks = new Set<string>()

function withoutParamKeyframes(Base: any): any {
    return class EffectAnimator extends Base {
        addKeyframe(data: any, uuid?: string) {
            if (!isParamChannel(data?.channel)) return super.addKeyframe(data, uuid)
            const animation = String((this as any).animation?.name ?? '')
            droppedTracks.add(`${data.channel} keyframes on ${String((this as any).name ?? '')} in '${animation}'`)
            return undefined
        }
    }
}

export function takeDroppedParamTracks(): string[] {
    const tracks = Array.from(droppedTracks)
    droppedTracks.clear()
    return tracks
}

export type EffectType = ElementType

export function defineEffectType(): EffectType {
    const result = defineElementType({
        type: EFFECT_TYPE,
        title: 'Nameplate effect',
        icon: 'auto_awesome',
        channels: channelSet(EFFECT_CHANNELS),
        extendAnimator: withoutParamKeyframes,
        hideable: true,
        menu: layerMenuItems(),
        define: defineEffectProperties,
    })
    return {
        type: result.type,
        animator: result.animator,
        dispose() {
            result.dispose()
        },
    }
}

export function effectType(): any | null {
    return (OutlinerElement.types as any)[EFFECT_TYPE] ?? null
}

export function materialTypeFor(kind: string): any | null {
    return kind === 'material' ? effectType() : null
}

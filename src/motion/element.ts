import { definePathProperties } from '../kinds/path'
import { defineEmitterProperties } from '../kinds/emitter'
import { defineElementType, ElementType, layerMenuItems } from '../elements/classes'
import { channelConfig } from '../elements/channels'
import { Channel } from '../model'
import { BURST_CHANNEL, EDGES, EMITTER_TYPE, PATH_TYPE, SPEED_CHANNEL } from './types'

export const PATH_CHANNELS: Channel[] = ['frame', 'position', 'opacity', 'visible']
export const EMITTER_CHANNELS: Channel[] = ['position', 'opacity', 'visible']

const CHANNEL_NAMES: Record<string, string> = {
    [SPEED_CHANNEL]: 'Speed',
    [BURST_CHANNEL]: 'Burst',
}

interface MotionSpec {
    type: string
    title: string
    icon: string
    channels: Channel[]
    extra: string
    define(target: any): void
}

export interface MotionTypes {
    path: any
    emitter: any
    dispose(): void
}

export function defineSpriteAdaptiveProperties(target: any): Property[] {
    return [
        new Property(target, 'boolean', 'repeatOn', { default: false }),
        new Property(target, 'enum', 'repeatEdge', { default: 'top', values: EDGES }),
        new Property(target, 'number', 'repeatSpacing', { default: 12 }),
        new Property(target, 'number', 'repeatMin', { default: 1 }),
        new Property(target, 'number', 'repeatMax', { default: 8 }),
        new Property(target, 'object', 'breakpoints', { default: () => [] }),
    ]
}

function motionChannels(channels: Channel[], extra: string): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {}
    for (const channel of channels) result[channel] = channelConfig(channel)
    result[extra] = { ...channelConfig('opacity'), name: CHANNEL_NAMES[extra] }
    return result
}

function defineMotionClass(spec: MotionSpec): ElementType {
    return defineElementType({
        type: spec.type,
        title: spec.title,
        icon: spec.icon,
        channels: motionChannels(spec.channels, spec.extra),
        hideable: true,
        menu: layerMenuItems(),
        define: spec.define,
    })
}

export function defineMotionTypes(): MotionTypes {
    const path = defineMotionClass({
        type: PATH_TYPE,
        title: 'Nameplate path',
        icon: 'route',
        channels: PATH_CHANNELS,
        extra: SPEED_CHANNEL,
        define: definePathProperties,
    })
    let emitter: ElementType
    try {
        emitter = defineMotionClass({
            type: EMITTER_TYPE,
            title: 'Nameplate particles',
            icon: 'grain',
            channels: EMITTER_CHANNELS,
            extra: BURST_CHANNEL,
            define: defineEmitterProperties,
        })
    } catch (error) {
        path.dispose()
        throw error
    }
    return {
        path: path.type,
        emitter: emitter.type,
        dispose() {
            emitter.dispose()
            path.dispose()
        },
    }
}

export function motionTrackChannels(node: any): Channel[] {
    if (node?.type === PATH_TYPE) return PATH_CHANNELS
    if (node?.type === EMITTER_TYPE) return EMITTER_CHANNELS
    return []
}

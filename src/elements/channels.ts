import { isNameplateActive } from '../format'
import { Channel } from '../model'
import { isParamChannel, paramOfChannel } from '../material/params'
import { MATERIALS_PROPERTY } from '../material/types'
import { defaultWith, hideWhen, patchKeyframeProperties, resolveCondition } from '../util/keyframePatch'
import { disposeAllReversed } from '../util/teardown'

export const SPRITE_CHANNELS: Channel[] = ['frame', 'position', 'opacity', 'visible']
export const BODY_CHANNELS: Channel[] = ['position', 'opacity', 'visible']
export const GROUP_CHANNELS: Channel[] = ['position', 'opacity', 'visible']

const CHANNEL_NAMES: Record<Channel, string> = {
    frame: 'Frame',
    position: 'Position',
    opacity: 'Opacity',
    visible: 'Visible',
}

const NAMEPLATE_CHANNELS = new Set<string>(['frame', 'position', 'opacity', 'visible'])
const TWO_AXIS_CHANNELS = new Set<string>(['position'])
const ONE_DEFAULT_CHANNELS = new Set<string>(['opacity', 'visible'])

export function channelConfig(channel: Channel): Record<string, unknown> {
    return { name: CHANNEL_NAMES[channel], mutable: true, transform: true, max_data_points: 1 }
}

export function channelSet(channels: Channel[]): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {}
    for (const channel of channels) result[channel] = channelConfig(channel)
    return result
}

function nameplateChannelOf(point: any): string | undefined {
    if (!isNameplateActive()) return undefined
    const channel = point?.keyframe?.channel
    return typeof channel === 'string' && (NAMEPLATE_CHANNELS.has(channel) || isParamChannel(channel)) ? channel : undefined
}

function paramDefault(channel: string): string {
    const name = paramOfChannel(channel)
    const value = name && typeof Project !== 'undefined' && Project ? (Project as any)[MATERIALS_PROPERTY]?.params?.[name] : undefined
    return typeof value === 'number' && isFinite(value) ? String(value) : '0'
}

export function patchKeyframeFields(): () => void {
    return patchKeyframeProperties([
        {
            key: 'y',
            field: 'condition',
            wrap: hideWhen((point) => {
                const channel = nameplateChannelOf(point)
                return !!channel && !TWO_AXIS_CHANNELS.has(channel)
            }),
        },
        { key: 'z', field: 'condition', wrap: hideWhen((point) => !!nameplateChannelOf(point)) },
        {
            key: 'x',
            field: 'default',
            wrap: defaultWith((point) => {
                const channel = nameplateChannelOf(point)
                if (channel && ONE_DEFAULT_CHANNELS.has(channel)) return '1'
                if (channel && isParamChannel(channel)) return paramDefault(channel)
                return undefined
            }),
        },
    ])
}

function backfillBoneAnimators(channels: string[]) {
    const projects: any[] = (globalThis as any).ModelProject?.all ?? []
    for (const project of projects) {
        for (const animation of project?.animations ?? []) {
            for (const animator of Object.values<any>(animation?.animators ?? {})) {
                if (!animator || animator.type !== 'bone') continue
                for (const channel of channels) {
                    if (!Array.isArray(animator[channel])) animator[channel] = []
                    if (animator.muted && animator.muted[channel] === undefined) animator.muted[channel] = false
                }
            }
        }
    }
}

export function patchGroupChannels(): () => void {
    const channels = (BoneAnimator as any).prototype.channels as Record<string, any>
    const restores: Array<() => void> = []
    const added: string[] = []

    for (const channel of GROUP_CHANNELS) {
        if (channels[channel]) continue
        channels[channel] = { ...channelConfig(channel), condition: () => isNameplateActive() }
        added.push(channel)
    }
    restores.push(() => {
        for (const channel of added) delete channels[channel]
    })

    for (const channel of ['rotation', 'scale']) {
        const config = channels[channel]
        if (!config) continue
        const had = Object.prototype.hasOwnProperty.call(config, 'condition')
        const original = config.condition
        config.condition = (animator: unknown) => !isNameplateActive() && resolveCondition(original, animator)
        restores.push(() => {
            if (had) config.condition = original
            else delete config.condition
        })
    }

    const position = channels.position
    if (position) {
        const original = position.max_data_points
        Object.defineProperty(position, 'max_data_points', {
            configurable: true,
            enumerable: true,
            get: () => (isNameplateActive() ? 1 : original),
        })
        restores.push(() => {
            Object.defineProperty(position, 'max_data_points', {
                configurable: true,
                enumerable: true,
                writable: true,
                value: original,
            })
        })
    }

    backfillBoneAnimators(added)

    return () => {
        disposeAllReversed(restores)
    }
}

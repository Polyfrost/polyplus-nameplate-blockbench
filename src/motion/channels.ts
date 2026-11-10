import { isNameplateActive } from '../format'
import { defaultWith, hideWhen, patchKeyframeProperties } from '../util/keyframePatch'
import { BURST_CHANNEL, SPEED_CHANNEL } from './types'

const MOTION_CHANNELS = new Set<string>([SPEED_CHANNEL, BURST_CHANNEL])

function motionChannelOf(point: any): string | undefined {
    if (!isNameplateActive()) return undefined
    const channel = point?.keyframe?.channel
    return typeof channel === 'string' && MOTION_CHANNELS.has(channel) ? channel : undefined
}

export function patchMotionKeyframeFields(): () => void {
    const hidden = hideWhen((point) => !!motionChannelOf(point))
    return patchKeyframeProperties([
        { key: 'y', field: 'condition', wrap: hidden },
        { key: 'z', field: 'condition', wrap: hidden },
        { key: 'x', field: 'default', wrap: defaultWith((point) => (motionChannelOf(point) ? '1' : undefined)) },
    ])
}

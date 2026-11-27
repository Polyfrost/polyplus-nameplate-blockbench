import { MATERIALS_PROPERTY } from './types'

export const PARAM_PREFIX = 'param.'

export function isParamChannel(channel: unknown): channel is string {
    return typeof channel === 'string' && channel.startsWith(PARAM_PREFIX) && channel.length > PARAM_PREFIX.length
}

function rawMaterials(): any {
    return typeof Project !== 'undefined' && Project ? (Project as any)[MATERIALS_PROPERTY] : null
}

export function paramLabel(name: string): string {
    const label = rawMaterials()?.ranges?.[name]?.label
    return typeof label === 'string' && label ? label : name
}

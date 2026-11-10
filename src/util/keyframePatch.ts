import { disposeAllReversed } from './teardown'

export interface KeyframeFieldPatch {
    key: string
    field: 'condition' | 'default'
    wrap(original: any): (point: any) => any
}

export function resolveCondition(condition: unknown, context: unknown): boolean {
    if (condition === undefined) return true
    return (Condition as any)(condition, context)
}

export function hideWhen(hidden: (point: any) => boolean): KeyframeFieldPatch['wrap'] {
    return (original) => (point: any) => {
        if (hidden(point)) return false
        return resolveCondition(original, point)
    }
}

export function defaultWith(own: (point: any) => string | undefined): KeyframeFieldPatch['wrap'] {
    return (original) => (point: any) => {
        const value = own(point)
        if (value !== undefined) return value
        return typeof original === 'function' ? original(point) : original
    }
}

export function patchKeyframeProperties(patches: KeyframeFieldPatch[]): () => void {
    const properties = (KeyframeDataPoint as any).properties as Record<string, any>
    const restores: Array<() => void> = []
    for (const { key, field, wrap } of patches) {
        const property = properties[key]
        if (!property) continue
        const original = property[field]
        property[field] = wrap(original)
        restores.push(() => {
            property[field] = original
        })
    }
    return () => {
        disposeAllReversed(restores)
    }
}

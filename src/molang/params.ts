import { projectParamValues } from '../params/store'

function numbers(value: unknown, into: Record<string, number>) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [name, number] of Object.entries(value as Record<string, unknown>)) {
        if (typeof number === 'number' && isFinite(number) && !(name in into)) into[name] = number
    }
}

export function paramsOfManifest(text: string | undefined): Record<string, number> {
    const params: Record<string, number> = {}
    if (!text) return params
    try {
        const manifest = JSON.parse(text)
        numbers(manifest?.params, params)
        for (const variant of Object.values<any>(manifest?.variants ?? {})) numbers(variant?.params, params)
    } catch {
        return params
    }
    return params
}

export function projectParams(): Record<string, number> {
    try {
        return projectParamValues()
    } catch {
        return {}
    }
}

import { isRecord } from '../util/json'

export function finiteNumbers(value: unknown): Record<string, number> | null {
    if (!isRecord(value)) return null
    const result: Record<string, number> = {}
    for (const [name, number] of Object.entries(value)) {
        if (typeof number !== 'number' || !isFinite(number)) return null
        result[name] = number
    }
    return result
}

export function normalizeVariantParams(raw: unknown): { params?: Record<string, number> } {
    const params = isRecord(raw) ? finiteNumbers(raw.params) : null
    return params && Object.keys(params).length > 0 ? { params } : {}
}

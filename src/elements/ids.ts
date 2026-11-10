import { sanitizeId, uniqueIdAmong } from '../palette/ids'

export function sanitizeLayerId(name: string): string {
    return sanitizeId(name) || 'layer'
}

export function uniqueLayerId(base: string, used: Set<string>): string {
    return uniqueIdAmong(base, (candidate) => used.has(candidate))
}

export function assignIds(entries: Array<{ uuid: string, name: string }>): Map<string, string> {
    const used = new Set<string>()
    const ids = new Map<string, string>()
    for (const entry of entries) {
        const id = uniqueLayerId(sanitizeLayerId(entry.name), used)
        used.add(id)
        ids.set(entry.uuid, id)
    }
    return ids
}

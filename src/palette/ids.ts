export const MAX_ID_LENGTH = 64
export const MAX_TONES = 16
export const MIN_FPS = 1
export const MAX_FPS = 24
const RESERVED_SLOT_IDS = new Set(['auto', 'none'])

export function sanitizeId(value: string): string {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, MAX_ID_LENGTH)
}

export function uniqueIdAmong(base: string, taken: (id: string) => boolean): string {
    if (!taken(base)) return base
    for (let index = 2; ; index++) {
        const suffix = `_${index}`
        const candidate = base.slice(0, MAX_ID_LENGTH - suffix.length) + suffix
        if (!taken(candidate)) return candidate
    }
}

export function uniqueId(base: string, taken: (id: string) => boolean): string {
    return uniqueIdAmong(base || 'item', taken)
}

export function slotIdFrom(value: string, taken: (id: string) => boolean): string {
    let id = sanitizeId(value)
    if (RESERVED_SLOT_IDS.has(id)) id = `${id}_slot`
    return uniqueId(id, taken)
}

export function pictureStem(name: unknown): string {
    return String(name ?? '').replace(/\.[A-Za-z0-9]+$/, '')
}

export function textureSpriteId(name: string, taken: Set<string>): string {
    const stem = pictureStem(name)
    const id = uniqueId(sanitizeId(stem) || 'sprite', (candidate) => taken.has(candidate))
    taken.add(id)
    return id
}

export function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function cloneJson<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

export function sameJson(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
        return a.every((item, i) => sameJson(item, b[i]))
    }
    if (isRecord(a) && isRecord(b)) {
        const keys = Object.keys(a)
        if (keys.length !== Object.keys(b).length) return false
        return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]))
    }
    return false
}

export function sameSerialized(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}

export function parseJsonOrNull(text: string | undefined): any {
    try {
        return text ? JSON.parse(text) : null
    } catch {
        return null
    }
}

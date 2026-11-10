const FNV_OFFSET = 0x811c9dc5 | 0
const FNV_PRIME = 0x01000193

export function textHash(value: string): number {
    let hash = FNV_OFFSET
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), FNV_PRIME)
    return hash
}

export function textHashUnsigned(value: string): number {
    return textHash(value) >>> 0
}

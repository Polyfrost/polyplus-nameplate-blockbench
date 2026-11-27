const WORD = (1n << 64n) - 1n
const GAMMA = 0x9e3779b97f4a7c15n

function mix64(value: bigint): bigint {
    let z = value & WORD
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & WORD
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & WORD
    return z ^ (z >> 31n)
}

export function engineSeed(wearer: bigint, cosmetic: bigint, purpose = 0n): bigint {
    const h = mix64((wearer & WORD) + GAMMA)
    const k = mix64(h ^ (((cosmetic & WORD) + GAMMA * 2n) & WORD))
    return mix64(k ^ (((purpose & WORD) + GAMMA * 3n) & WORD))
}

export function previewWearer(seed: number): bigint {
    return BigInt(Number.isFinite(seed) ? Math.max(1, Math.trunc(seed) >>> 0) : 1)
}

export function identityOf(text: string | undefined): bigint {
    try {
        return text ? BigInt.asUintN(64, BigInt(text)) : 0n
    } catch {
        return 0n
    }
}

export function wearerSeed(seed: number, identity: bigint): bigint {
    return engineSeed(previewWearer(seed), identity)
}

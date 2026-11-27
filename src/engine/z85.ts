export const Z85_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#'

const NONE = 255

export function decodeZ85(text: string, length: number): Uint8Array {
    const digits = new Uint8Array(128).fill(NONE)
    for (let i = 0; i < Z85_ALPHABET.length; i++) digits[Z85_ALPHABET.charCodeAt(i)] = i
    const capacity = (text.length / 5) * 4
    if (text.length % 5 !== 0 || length < 0 || length > capacity) throw new Error('The packed engine is damaged')
    const out = new Uint8Array(capacity)
    for (let at = 0, to = 0; at < text.length; at += 5, to += 4) {
        let value = 0
        for (let i = 0; i < 5; i++) {
            const code = text.charCodeAt(at + i)
            const digit = code < 128 ? digits[code] : NONE
            if (digit === NONE) throw new Error('The packed engine is damaged')
            value = value * 85 + digit
        }
        if (value > 0xffffffff) throw new Error('The packed engine is damaged')
        out[to] = value >>> 24
        out[to + 1] = (value >>> 16) & 255
        out[to + 2] = (value >>> 8) & 255
        out[to + 3] = value & 255
    }
    return out.slice(0, length)
}

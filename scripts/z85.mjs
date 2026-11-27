export const Z85_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#'

export function encodeZ85(bytes) {
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
    padded.set(bytes)
    const chars = new Array(padded.length / 4 * 5)
    for (let from = 0, at = 0; from < padded.length; from += 4, at += 5) {
        let value = ((padded[from] << 24) | (padded[from + 1] << 16) | (padded[from + 2] << 8) | padded[from + 3]) >>> 0
        for (let i = 4; i >= 0; i--) {
            chars[at + i] = Z85_ALPHABET[value % 85]
            value = Math.floor(value / 85)
        }
    }
    return chars.join('')
}

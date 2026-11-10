export interface DecodedPng {
    width: number
    height: number
    rgba: Uint8Array
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
const MAX_SIDE = 4096

export function toBase64(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i]
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0
        out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
        out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '='
        out += i + 2 < bytes.length ? B64[c & 63] : '='
    }
    return out
}

export function fromBase64(text: string): Uint8Array {
    const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
    let bits = 0
    let value = 0
    let at = 0
    for (const char of clean) {
        value = (value << 6) | B64.indexOf(char)
        bits += 6
        if (bits >= 8) {
            bits -= 8
            out[at++] = (value >> bits) & 0xff
        }
    }
    return out.subarray(0, at)
}

export function isPng(bytes: Uint8Array): boolean {
    return bytes.length > 24 && SIGNATURE.every((value, index) => bytes[index] === value)
}

class Bits {
    private at = 0
    private bit = 0

    constructor(private readonly data: Uint8Array) {}

    read(count: number): number {
        let value = 0
        for (let i = 0; i < count; i++) {
            if (this.at >= this.data.length) throw new Error('compressed data ends early')
            value |= ((this.data[this.at] >> this.bit) & 1) << i
            if (++this.bit === 8) {
                this.bit = 0
                this.at++
            }
        }
        return value
    }

    align() {
        if (this.bit > 0) {
            this.bit = 0
            this.at++
        }
    }

    bytes(count: number): Uint8Array {
        if (this.at + count > this.data.length) throw new Error('compressed data ends early')
        const slice = this.data.subarray(this.at, this.at + count)
        this.at += count
        return slice
    }
}

interface Huffman {
    counts: Uint16Array
    symbols: Uint16Array
}

function huffman(lengths: ArrayLike<number>): Huffman {
    const counts = new Uint16Array(16)
    for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++
    counts[0] = 0
    const offsets = new Uint16Array(16)
    for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1]
    const symbols = new Uint16Array(lengths.length)
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i
    return { counts, symbols }
}

function decodeSymbol(bits: Bits, table: Huffman): number {
    let code = 0
    let first = 0
    let index = 0
    for (let length = 1; length < 16; length++) {
        code |= bits.read(1)
        const count = table.counts[length]
        if (code - first < count) return table.symbols[index + code - first]
        index += count
        first = (first + count) << 1
        code <<= 1
    }
    throw new Error('bad compressed data')
}

let fixedTables: [Huffman, Huffman] | null = null

function fixed(): [Huffman, Huffman] {
    if (fixedTables) return fixedTables
    const lengths = new Uint8Array(288)
    lengths.fill(8, 0, 144)
    lengths.fill(9, 144, 256)
    lengths.fill(7, 256, 280)
    lengths.fill(8, 280, 288)
    fixedTables = [huffman(lengths), huffman(new Uint8Array(30).fill(5))]
    return fixedTables
}

function dynamic(bits: Bits): [Huffman, Huffman] {
    const literals = bits.read(5) + 257
    const distances = bits.read(5) + 1
    const codes = bits.read(4) + 4
    const codeLengths = new Uint8Array(19)
    for (let i = 0; i < codes; i++) codeLengths[CODE_ORDER[i]] = bits.read(3)
    const codeTable = huffman(codeLengths)
    const lengths = new Uint8Array(literals + distances)
    let at = 0
    while (at < lengths.length) {
        const symbol = decodeSymbol(bits, codeTable)
        if (symbol < 16) {
            lengths[at++] = symbol
            continue
        }
        let repeat = 0
        let value = 0
        if (symbol === 16) {
            if (at === 0) throw new Error('bad compressed data')
            value = lengths[at - 1]
            repeat = 3 + bits.read(2)
        } else if (symbol === 17) {
            repeat = 3 + bits.read(3)
        } else {
            repeat = 11 + bits.read(7)
        }
        if (at + repeat > lengths.length) throw new Error('bad compressed data')
        lengths.fill(value, at, at + repeat)
        at += repeat
    }
    return [huffman(lengths.subarray(0, literals)), huffman(lengths.subarray(literals))]
}

function inflate(data: Uint8Array, expected: number): Uint8Array {
    const bits = new Bits(data.subarray(2))
    let out = new Uint8Array(Math.max(1024, expected))
    let size = 0
    const ensure = (more: number) => {
        if (size + more <= out.length) return
        const next = new Uint8Array(Math.max(out.length * 2, size + more))
        next.set(out.subarray(0, size))
        out = next
    }
    let last = 0
    while (!last) {
        last = bits.read(1)
        const type = bits.read(2)
        if (type === 0) {
            bits.align()
            const header = bits.bytes(4)
            const length = header[0] | (header[1] << 8)
            const chunk = bits.bytes(length)
            ensure(length)
            out.set(chunk, size)
            size += length
            continue
        }
        if (type === 3) throw new Error('bad compressed data')
        const [lengths, distances] = type === 1 ? fixed() : dynamic(bits)
        for (;;) {
            const symbol = decodeSymbol(bits, lengths)
            if (symbol < 256) {
                ensure(1)
                out[size++] = symbol
                continue
            }
            if (symbol === 256) break
            const index = symbol - 257
            if (index >= LENGTH_BASE.length) throw new Error('bad compressed data')
            const length = LENGTH_BASE[index] + bits.read(LENGTH_EXTRA[index])
            const code = decodeSymbol(bits, distances)
            if (code >= DIST_BASE.length) throw new Error('bad compressed data')
            const distance = DIST_BASE[code] + bits.read(DIST_EXTRA[code])
            if (distance > size) throw new Error('bad compressed data')
            ensure(length)
            for (let i = 0; i < length; i++) {
                out[size] = out[size - distance]
                size++
            }
        }
    }
    return out.subarray(0, size)
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function word(bytes: Uint8Array, at: number): number {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

export function decodePng(bytes: Uint8Array): DecodedPng {
    if (!isPng(bytes)) throw new Error('not a PNG')
    let at = 8
    let width = 0
    let height = 0
    let depth = 0
    let color = 0
    let interlace = 0
    let palette: Uint8Array | null = null
    let alphas: Uint8Array | null = null
    const parts: Uint8Array[] = []
    while (at + 8 <= bytes.length) {
        const length = word(bytes, at)
        const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
        const data = bytes.subarray(at + 8, at + 8 + length)
        at += 12 + length
        if (type === 'IHDR') {
            width = word(data, 0)
            height = word(data, 4)
            depth = data[8]
            color = data[9]
            interlace = data[12]
        } else if (type === 'PLTE') {
            palette = data
        } else if (type === 'tRNS') {
            alphas = data
        } else if (type === 'IDAT') {
            parts.push(data)
        } else if (type === 'IEND') {
            break
        }
    }
    if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) throw new Error('bad PNG size')
    if (interlace !== 0) throw new Error('interlaced PNGs are not supported; save it without interlacing')
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color as 0 | 2 | 3 | 4 | 6]
    if (!channels || ![1, 2, 4, 8, 16].includes(depth) || (depth < 8 && color !== 0 && color !== 3) || (color === 3 && depth > 8)) {
        throw new Error('unsupported PNG color type')
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const joined = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
        joined.set(part, offset)
        offset += part.length
    }
    const bitsPerPixel = channels * depth
    const stride = Math.ceil((width * bitsPerPixel) / 8)
    const step = Math.max(1, bitsPerPixel >> 3)
    const raw = inflate(joined, (stride + 1) * height)
    if (raw.length < (stride + 1) * height) throw new Error('PNG data ends early')
    const lines = new Uint8Array(stride * height)
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]
        const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
        const row = lines.subarray(y * stride, (y + 1) * stride)
        const above = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null
        for (let x = 0; x < stride; x++) {
            const left = x >= step ? row[x - step] : 0
            const up = above ? above[x] : 0
            const corner = above && x >= step ? above[x - step] : 0
            let value = source[x]
            if (filter === 1) value += left
            else if (filter === 2) value += up
            else if (filter === 3) value += (left + up) >> 1
            else if (filter === 4) value += paeth(left, up, corner)
            row[x] = value & 0xff
        }
    }
    const rgba = new Uint8Array(width * height * 4)
    const sample = (row: Uint8Array, index: number): number => {
        if (depth === 8) return row[index]
        if (depth === 16) return row[index * 2]
        const perByte = 8 / depth
        const shift = (perByte - 1 - (index % perByte)) * depth
        return (row[Math.floor(index / perByte)] >> shift) & ((1 << depth) - 1)
    }
    const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
    const full = (row: Uint8Array, index: number): number => (depth === 16 ? (row[index * 2] << 8) | row[index * 2 + 1] : sample(row, index))
    const keyCount = color === 0 ? 1 : color === 2 ? 3 : 0
    const colorKey: number[] | null =
        keyCount > 0 && alphas && alphas.length >= keyCount * 2
            ? Array.from({ length: keyCount }, (_, index) => (alphas![index * 2] << 8) | alphas![index * 2 + 1])
            : null
    for (let y = 0; y < height; y++) {
        const row = lines.subarray(y * stride, (y + 1) * stride)
        for (let x = 0; x < width; x++) {
            const p = (y * width + x) * 4
            const base = x * channels
            if (color === 3) {
                const index = sample(row, x)
                rgba[p] = palette?.[index * 3] ?? 0
                rgba[p + 1] = palette?.[index * 3 + 1] ?? 0
                rgba[p + 2] = palette?.[index * 3 + 2] ?? 0
                rgba[p + 3] = alphas && index < alphas.length ? alphas[index] : 255
            } else if (color === 0 || color === 4) {
                const gray = Math.round(sample(row, base) * (color === 0 ? scale : 1))
                rgba[p] = rgba[p + 1] = rgba[p + 2] = gray
                const keyed = color === 0 && colorKey !== null && full(row, base) === colorKey[0]
                rgba[p + 3] = color === 4 ? sample(row, base + 1) : keyed ? 0 : 255
            } else {
                rgba[p] = sample(row, base)
                rgba[p + 1] = sample(row, base + 1)
                rgba[p + 2] = sample(row, base + 2)
                const keyed = color === 2 && colorKey !== null && colorKey.every((value, offset) => full(row, base + offset) === value)
                rgba[p + 3] = color === 6 ? sample(row, base + 3) : keyed ? 0 : 255
            }
        }
    }
    return { width, height, rgba }
}

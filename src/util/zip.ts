const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
})

const LEN_BASE: number[] = []
const LEN_EXTRA: number[] = []
const DIST_BASE: number[] = []
const DIST_EXTRA: number[] = []
for (let i = 0, base = 3; i < 29; i++) {
    LEN_EXTRA[i] = i < 8 || i === 28 ? 0 : (i >> 2) - 1
    LEN_BASE[i] = i === 28 ? 258 : base
    base += 1 << LEN_EXTRA[i]
}
for (let i = 0, base = 1; i < 30; i++) {
    DIST_EXTRA[i] = i < 4 ? 0 : (i >> 1) - 1
    DIST_BASE[i] = base
    base += 1 << DIST_EXTRA[i]
}

const WINDOW = 32768
const MASK = WINDOW - 1
const CHAIN = 32

export function crc32(bytes: Uint8Array): number {
    let crc = -1
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
    return (crc ^ -1) >>> 0
}

function reversed(code: number, length: number): number {
    let out = 0
    for (let i = 0; i < length; i++) out = (out << 1) | ((code >> i) & 1)
    return out
}

export function deflateRaw(data: Uint8Array): Uint8Array {
    const length = data.length
    const out = new Uint8Array(length + (length >> 3) + 16)
    const head = new Int32Array(WINDOW).fill(-1)
    const prev = new Int32Array(WINDOW)
    let at = 0
    let bits = 0
    let count = 0
    const put = (value: number, size: number) => {
        bits |= value << count
        count += size
        while (count >= 8) {
            out[at++] = bits & 0xff
            bits >>>= 8
            count -= 8
        }
    }
    const symbol = (s: number) => {
        if (s < 144) put(reversed(0x30 + s, 8), 8)
        else if (s < 256) put(reversed(0x190 + s - 144, 9), 9)
        else if (s < 280) put(reversed(s - 256, 7), 7)
        else put(reversed(0xc0 + s - 280, 8), 8)
    }
    const hash = (i: number) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & MASK
    const insert = (i: number) => {
        if (i + 2 >= length) return
        const h = hash(i)
        prev[i & MASK] = head[h]
        head[h] = i
    }
    put(3, 3)
    let i = 0
    while (i < length) {
        let best = 0
        let distance = 0
        if (i + 2 < length) {
            const most = Math.min(258, length - i)
            let candidate = head[hash(i)]
            for (let chain = CHAIN; candidate >= 0 && candidate < i && i - candidate <= WINDOW && chain > 0; chain--) {
                let k = 0
                while (k < most && data[candidate + k] === data[i + k]) k++
                if (k > best) {
                    best = k
                    distance = i - candidate
                    if (k === most) break
                }
                candidate = prev[candidate & MASK]
            }
        }
        if (best < 3) {
            insert(i)
            symbol(data[i++])
            continue
        }
        let code = 28
        while (LEN_BASE[code] > best) code--
        symbol(257 + code)
        put(best - LEN_BASE[code], LEN_EXTRA[code])
        code = 29
        while (DIST_BASE[code] > distance) code--
        put(reversed(code, 5), 5)
        put(distance - DIST_BASE[code], DIST_EXTRA[code])
        for (const end = i + best; i < end; i++) insert(i)
    }
    symbol(256)
    if (count) out[at++] = bits & 0xff
    return out.slice(0, at)
}

export function deflateZip(files: Record<string, string | Uint8Array>): Uint8Array {
    const encoder = new TextEncoder()
    const entries = Object.keys(files).sort().map((path) => {
        const file = files[path]
        const raw = typeof file === 'string' ? encoder.encode(file) : file
        const packed = deflateRaw(raw)
        const deflated = packed.length < raw.length
        return { name: encoder.encode(path), raw, data: deflated ? packed : raw, method: deflated ? 8 : 0, crc: crc32(raw), offset: 0 }
    })
    let size = 22
    for (const entry of entries) size += 76 + entry.name.length * 2 + entry.data.length
    const zip = new Uint8Array(size)
    const view = new DataView(zip.buffer)
    const header = (at: number, entry: typeof entries[number], central: boolean) => {
        const shift = central ? 2 : 0
        view.setUint32(at, central ? 0x02014b50 : 0x04034b50, true)
        if (central) view.setUint16(at + 4, 20, true)
        view.setUint16(at + 4 + shift, 20, true)
        view.setUint16(at + 6 + shift, 0x0800, true)
        view.setUint16(at + 8 + shift, entry.method, true)
        view.setUint32(at + 10 + shift, 0x00210000, true)
        view.setUint32(at + 14 + shift, entry.crc, true)
        view.setUint32(at + 18 + shift, entry.data.length, true)
        view.setUint32(at + 22 + shift, entry.raw.length, true)
        view.setUint16(at + 26 + shift, entry.name.length, true)
        if (central) view.setUint32(at + 42, entry.offset, true)
        zip.set(entry.name, at + (central ? 46 : 30))
        return at + (central ? 46 : 30) + entry.name.length
    }
    let at = 0
    for (const entry of entries) {
        entry.offset = at
        at = header(at, entry, false)
        zip.set(entry.data, at)
        at += entry.data.length
    }
    const start = at
    for (const entry of entries) at = header(at, entry, true)
    view.setUint32(at, 0x06054b50, true)
    view.setUint16(at + 8, entries.length, true)
    view.setUint16(at + 10, entries.length, true)
    view.setUint32(at + 12, at - start, true)
    view.setUint32(at + 16, start, true)
    return zip
}

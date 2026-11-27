import { crc32 } from '../util/zip'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const STORED_BLOCK = 0xffff

function adler32(bytes: Uint8Array): number {
    let a = 1
    let b = 0
    for (let i = 0; i < bytes.length; i++) {
        a = (a + bytes[i]) % 65521
        b = (b + a) % 65521
    }
    return ((b << 16) | a) >>> 0
}

function stored(raw: Uint8Array): Uint8Array {
    const blocks = Math.max(1, Math.ceil(raw.length / STORED_BLOCK))
    const out = new Uint8Array(2 + raw.length + blocks * 5 + 4)
    out[0] = 0x78
    out[1] = 0x01
    let at = 2
    for (let block = 0; block < blocks; block++) {
        const start = block * STORED_BLOCK
        const length = Math.min(STORED_BLOCK, raw.length - start)
        out[at++] = block === blocks - 1 ? 1 : 0
        out[at++] = length & 0xff
        out[at++] = length >>> 8
        out[at++] = ~length & 0xff
        out[at++] = (~length >>> 8) & 0xff
        out.set(raw.subarray(start, start + length), at)
        at += length
    }
    const check = adler32(raw)
    out[at++] = check >>> 24
    out[at++] = (check >>> 16) & 0xff
    out[at++] = (check >>> 8) & 0xff
    out[at] = check & 0xff
    return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
}

export function encodePng(width: number, height: number, pixels: ArrayLike<number>, channels: 1 | 4): Uint8Array {
    const stride = width * channels
    const raw = new Uint8Array((stride + 1) * height)
    for (let y = 0; y < height; y++) {
        const row = y * (stride + 1)
        for (let x = 0; x < stride; x++) raw[row + 1 + x] = pixels[y * stride + x]
    }
    const header = new Uint8Array(13)
    const view = new DataView(header.buffer)
    view.setUint32(0, width)
    view.setUint32(4, height)
    header[8] = 8
    header[9] = channels === 1 ? 0 : 6
    const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('IDAT', stored(raw)), chunk('IEND', new Uint8Array(0))]
    const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

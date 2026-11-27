interface Tree {
    counts: Uint16Array
    symbols: Uint16Array
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

function tree(lengths: ArrayLike<number>, from: number, count: number): Tree {
    const counts = new Uint16Array(16)
    const symbols = new Uint16Array(count)
    for (let i = 0; i < count; i++) counts[lengths[from + i]]++
    counts[0] = 0
    const offsets = new Uint16Array(16)
    for (let bits = 1, sum = 0; bits < 16; bits++) {
        offsets[bits] = sum
        sum += counts[bits]
    }
    for (let i = 0; i < count; i++) {
        const length = lengths[from + i]
        if (length) symbols[offsets[length]++] = i
    }
    return { counts, symbols }
}

function fixedTrees(): [Tree, Tree] {
    const lengths = new Uint8Array(320)
    lengths.fill(8, 0, 144)
    lengths.fill(9, 144, 256)
    lengths.fill(7, 256, 280)
    lengths.fill(8, 280, 288)
    lengths.fill(5, 288, 320)
    return [tree(lengths, 0, 288), tree(lengths, 288, 32)]
}

class Reader {
    private at: number
    private bits = 0
    private held = 0

    constructor(private readonly data: Uint8Array, start: number) {
        this.at = start
    }

    bit(): number {
        if (this.held === 0) {
            if (this.at >= this.data.length) throw new Error('the compressed engine ends too early')
            this.bits = this.data[this.at++]
            this.held = 8
        }
        const bit = this.bits & 1
        this.bits >>>= 1
        this.held--
        return bit
    }

    read(count: number): number {
        let value = 0
        for (let i = 0; i < count; i++) value |= this.bit() << i
        return value
    }

    symbol(table: Tree): number {
        let code = 0
        let first = 0
        let index = 0
        for (let bits = 1; bits < 16; bits++) {
            code |= this.bit()
            const count = table.counts[bits]
            if (code - first < count) return table.symbols[index + code - first]
            index += count
            first = (first + count) << 1
            code <<= 1
        }
        throw new Error('the compressed engine is damaged')
    }

    align(): number {
        this.held = 0
        return this.at
    }

    skip(to: number) {
        this.at = to
    }
}

class Output {
    bytes: Uint8Array
    length = 0

    constructor(expected: number) {
        this.bytes = new Uint8Array(Math.max(1024, expected))
    }

    room(more: number) {
        if (this.length + more <= this.bytes.length) return
        const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + more))
        grown.set(this.bytes.subarray(0, this.length))
        this.bytes = grown
    }

    push(byte: number) {
        this.room(1)
        this.bytes[this.length++] = byte
    }

    copy(distance: number, length: number) {
        if (distance > this.length) throw new Error('the compressed engine is damaged')
        this.room(length)
        for (let i = 0; i < length; i++, this.length++) this.bytes[this.length] = this.bytes[this.length - distance]
    }
}

function dynamicTrees(reader: Reader): [Tree, Tree] {
    const literals = reader.read(5) + 257
    const distances = reader.read(5) + 1
    const codes = reader.read(4) + 4
    const codeLengths = new Uint8Array(19)
    for (let i = 0; i < codes; i++) codeLengths[CODE_ORDER[i]] = reader.read(3)
    const codeTree = tree(codeLengths, 0, 19)
    const lengths = new Uint8Array(literals + distances)
    for (let i = 0; i < lengths.length;) {
        const symbol = reader.symbol(codeTree)
        if (symbol < 16) {
            lengths[i++] = symbol
        } else if (symbol === 16) {
            if (i === 0) throw new Error('the compressed engine is damaged')
            const previous = lengths[i - 1]
            for (let n = reader.read(2) + 3; n > 0; n--) lengths[i++] = previous
        } else if (symbol === 17) {
            i += reader.read(3) + 3
        } else {
            i += reader.read(7) + 11
        }
    }
    return [tree(lengths, 0, literals), tree(lengths, literals, distances)]
}

function block(reader: Reader, out: Output, literals: Tree, distances: Tree) {
    for (;;) {
        const symbol = reader.symbol(literals)
        if (symbol < 256) {
            out.push(symbol)
        } else if (symbol === 256) {
            return
        } else {
            const at = symbol - 257
            const length = LENGTH_BASE[at] + reader.read(LENGTH_EXTRA[at])
            const which = reader.symbol(distances)
            out.copy(DISTANCE_BASE[which] + reader.read(DISTANCE_EXTRA[which]), length)
        }
    }
}

export function inflateZlib(data: Uint8Array, expected = 0): Uint8Array {
    if (data.length < 2 || (data[0] & 0x0f) !== 8 || ((data[0] << 8) | data[1]) % 31 !== 0) throw new Error('the compressed engine has no zlib header')
    const reader = new Reader(data, 2)
    const out = new Output(expected)
    let fixed: [Tree, Tree] | null = null
    let last = 0
    while (!last) {
        last = reader.bit()
        const type = reader.read(2)
        if (type === 0) {
            const at = reader.align()
            const length = data[at] | (data[at + 1] << 8)
            if (at + 4 + length > data.length) throw new Error('the compressed engine ends too early')
            out.room(length)
            out.bytes.set(data.subarray(at + 4, at + 4 + length), out.length)
            out.length += length
            reader.skip(at + 4 + length)
        } else if (type === 1) {
            fixed ??= fixedTrees()
            block(reader, out, fixed[0], fixed[1])
        } else if (type === 2) {
            const [literals, distances] = dynamicTrees(reader)
            block(reader, out, literals, distances)
        } else {
            throw new Error('the compressed engine is damaged')
        }
    }
    return out.bytes.slice(0, out.length)
}

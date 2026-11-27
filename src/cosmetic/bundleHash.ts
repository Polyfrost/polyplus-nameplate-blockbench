const FNV_PRIME = 0x01000193
const SEEDS = [0x811c9dc5, 0x050c5d1f]

class Hasher {
    private readonly state = [...SEEDS]

    byte(value: number) {
        for (let i = 0; i < this.state.length; i++) this.state[i] = Math.imul(this.state[i] ^ (value & 0xff), FNV_PRIME) >>> 0
    }

    text(value: string) {
        for (let i = 0; i < value.length; i++) {
            const code = value.charCodeAt(i)
            this.byte(code)
            this.byte(code >>> 8)
        }
        this.byte(0)
    }

    bytes(value: Uint8Array) {
        for (const byte of value) this.byte(byte)
        this.text(String(value.length))
    }

    digest(): string {
        return this.state.map((part) => part.toString(16).padStart(8, '0')).join('')
    }
}

export function bundleHash(files: Readonly<Record<string, string>>, binary: Readonly<Record<string, Uint8Array>>): string {
    const hasher = new Hasher()
    for (const name of Object.keys(files).sort()) {
        hasher.text(name)
        hasher.text(files[name])
    }
    hasher.byte(1)
    for (const name of Object.keys(binary).sort()) {
        hasher.text(name)
        hasher.bytes(binary[name])
    }
    return hasher.digest()
}

export function reloadNeeded(shown: string | null, next: string | null): boolean {
    return !shown || !next || shown !== next
}

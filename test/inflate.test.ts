import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import { inflateZlib } from '../src/engine/inflate'

test('the packed engine and small or odd inputs unpack to the same bytes without DecompressionStream', () => {
    const wasm = new Uint8Array(readFileSync('engine/plusrenderer.wasm'))
    for (const level of [0, 1, 9]) {
        const packed = new Uint8Array(deflateSync(wasm, { level }))
        assert.deepEqual(inflateZlib(packed, wasm.length), wasm, `level ${level}`)
    }
    const samples = [new Uint8Array(0), new TextEncoder().encode('a'), new TextEncoder().encode('abcabcabcabcabcabcabc'.repeat(50)), Uint8Array.from({ length: 70000 }, (_, i) => (i * 7919) & 255)]
    for (const sample of samples) {
        for (const strategy of [0, 1, 2, 3, 4]) {
            assert.deepEqual(inflateZlib(new Uint8Array(deflateSync(sample, { strategy }))), sample, `${sample.length} bytes, strategy ${strategy}`)
        }
    }
    assert.throws(() => inflateZlib(new Uint8Array([1, 2, 3])))
})

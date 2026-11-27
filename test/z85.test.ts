import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeZ85, Z85_ALPHABET as BUILD_ALPHABET } from '../scripts/z85.mjs'
import { decodeZ85, Z85_ALPHABET } from '../src/engine/z85'

test('the build and the plugin share one alphabet that needs no escaping, every length and byte value survives, and damage is caught', () => {
    assert.equal(BUILD_ALPHABET, Z85_ALPHABET)
    assert.equal(new Set(Z85_ALPHABET).size, 85)
    assert.doesNotMatch(Z85_ALPHABET, /["'`\\\s]/)
    for (let length = 0; length < 13; length++) {
        const bytes = Uint8Array.from({ length }, (_, i) => (i * 97 + 255) & 255)
        assert.deepEqual(decodeZ85(encodeZ85(bytes), length), bytes, `${length} bytes`)
    }
    const all = Uint8Array.from({ length: 256 }, (_, i) => 255 - i)
    assert.deepEqual(decodeZ85(encodeZ85(all), all.length), all)
    assert.deepEqual(decodeZ85(encodeZ85(new Uint8Array([255, 255, 255, 255])), 4), new Uint8Array([255, 255, 255, 255]))
    assert.throws(() => decodeZ85('abcd', 1))
    assert.throws(() => decodeZ85('abc"e', 4))
    assert.throws(() => decodeZ85('#####', 4))
    assert.throws(() => decodeZ85('00000', 5))
})

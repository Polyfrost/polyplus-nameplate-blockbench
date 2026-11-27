import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCosmetic } from '../src/cosmetic/build'
import { bundleHash, reloadNeeded } from '../src/cosmetic/bundleHash'
import { cosmetic, FEATHER, geometry, paintedTexture, sources } from './cosmeticKit'

function tail(rotation = 40) {
    const data = cosmetic('item', 'tail', (d) => {
        d.attach = { rig: 'player', bone: 'body', replaces: '' }
        d.palette = { slots: [{ id: 'fur', name: 'Fur', ramp: FEATHER, customizable: false }], colorways: {}, fixed: [] }
    })
    const input = sources((s) => {
        s.geometry = geometry('tail', [{ name: 'root', parent: 'body', pivot: [0, 12, 2], cubes: [{ origin: [-1, 10, 2], size: [2, 2, 2], uv: [0, 0] }] }])
        s.animations = { 'animation.tail.droop': { loop: true, animation_length: 1, bones: { root: { rotation: [rotation, 0, 0] } } } }
        s.textures = [paintedTexture(data, 'tail')]
    })
    return buildCosmetic(data, input)
}

test('the same bundle hashes the same whatever order its files come in, so a Checks refresh with unchanged content keeps the running preview', () => {
    const a = bundleHash({ 'b.json': '{}', 'a.json': '[]' }, { 'x.png': Uint8Array.of(1, 2), 'w.png': Uint8Array.of(3) })
    const b = bundleHash({ 'a.json': '[]', 'b.json': '{}' }, { 'w.png': Uint8Array.of(3), 'x.png': Uint8Array.of(1, 2) })
    assert.equal(a, b)
    assert.notEqual(a, bundleHash({ 'a.json': '[]', 'b.json': '{}' }, { 'w.png': Uint8Array.of(3), 'x.png': Uint8Array.of(1, 3) }))
    assert.notEqual(bundleHash({ ab: 'c' }, {}), bundleHash({ a: 'bc' }, {}))
    assert.notEqual(bundleHash({ a: 'b' }, {}), bundleHash({}, { a: Uint8Array.of(98) }))
    const first = tail()
    const again = tail()
    const edited = tail(50)
    const shown = bundleHash(first.files, first.binary)
    assert.equal(reloadNeeded(shown, bundleHash(again.files, again.binary)), false)
    assert.equal(reloadNeeded(shown, bundleHash(edited.files, edited.binary)), true)
    assert.equal(reloadNeeded(null, shown), true)
    assert.equal(reloadNeeded(shown, null), true)
})

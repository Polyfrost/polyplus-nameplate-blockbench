import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCosmetic } from '../src/cosmetic/build'
import { manifestOf, textureTargets } from '../src/cosmetic/recolor'
import { CosmeticDriver, engineSignals } from '../src/engine'
import { cosmetic, FEATHER, geometry, paintedTexture, sources } from './cosmeticKit'

function painted() {
    const data = cosmetic('item', 'tail', (d) => {
        d.attach = { rig: 'player', bone: 'body', replaces: '' }
        d.palette = { slots: [{ id: 'fur', name: 'Fur', ramp: FEATHER, customizable: false }], colorways: { dry: { fur: ['#FF405060', '#FF7090B0'] }, wet: { fur: ['#FF101010', '#FF202020'] } }, fixed: [] }
    })
    const input = sources((s) => {
        s.geometry = geometry('tail', [{ name: 'root', parent: 'body', pivot: [0, 12, 2], cubes: [{ origin: [-1, 10, 2], size: [2, 2, 2], uv: [0, 0] }] }])
        s.textures = [paintedTexture(data, 'tail')]
    })
    const built = buildCosmetic(data, input)
    const driver = CosmeticDriver.open(built.files, built.binary, engineSignals())
    assert.ok(driver)
    return { built, driver: driver! }
}

function pixel(rgba: Uint8Array, index: number): number[] {
    return Array.from(rgba.slice(index * 4, index * 4 + 4))
}

test('project textures pair with engine textures by their exported name, and a colorway repaints the palette pixels of the preview texture', () => {
    const { built, driver } = painted()
    const manifest = { textures: ['skin', { id: 'fur', palette: true }, 'gone'] }
    assert.deepEqual(textureTargets(manifest, ['fur', 'skin']), [{ project: 0, engine: 1 }, { project: 1, engine: 0 }])
    assert.deepEqual(textureTargets(null, ['fur']), [])
    assert.deepEqual(textureTargets({ textures: [{ palette: true }] }, ['fur']), [])
    try {
        assert.deepEqual(textureTargets(manifestOf(built.files), driver.textureNames()), [{ project: 0, engine: 0 }])
        const plain = driver.texture(0, -1)!
        assert.deepEqual([plain.width, plain.height], [4, 4])
        assert.deepEqual(pixel(plain.rgba, 0), [0x30, 0x40, 0x50, 255])
        assert.deepEqual(pixel(plain.rgba, 1), [0x60, 0x80, 0xa0, 255])
        const wet = driver.texture(0, 1)!
        assert.deepEqual(pixel(wet.rgba, 0), [0x10, 0x10, 0x10, 255])
        assert.deepEqual(pixel(wet.rgba, 1), [0x20, 0x20, 0x20, 255])
        assert.equal(driver.texture(3, 0), null)
    } finally {
        driver.dispose()
    }
})

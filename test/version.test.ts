import assert from 'node:assert/strict'
import test from 'node:test'
import { NAMEPLATE_DATA_VERSION } from '../src/model'
import { normalizeNameplate } from '../src/palette/state'
import { isNewerData, migrateNameplate, savedDataVersion } from '../src/palette/version'

function savedProject(version?: number): Record<string, any> {
    return {
        ...(version === undefined ? {} : { version }),
        id: 'river',
        fps: 6,
        ownsBackground: false,
        referenceName: 'Alex',
        futureSetting: { glow: 3 },
        palette: {
            slots: [{ id: 'fill', name: 'Fill', ramp: ['#112233', '#445566'], futureSlot: true }],
            colorways: { default: {}, moss: { fill: ['#223344', '#556677'] } },
            futurePalette: 'kept',
        },
        variants: {
            default: { palette: 'default', hide: [], swap: {}, futureVariant: [1, 2] },
        },
    }
}

test('a project without a version is read as the first shape and stamped, keeping unknown fields through a JSON round trip', () => {
    assert.equal(savedDataVersion(savedProject()), 0)
    const plate = normalizeNameplate(savedProject()) as any
    assert.deepEqual([plate.version, plate.id, plate.fps, plate.ownsBackground], [NAMEPLATE_DATA_VERSION, 'river', 6, false])
    assert.deepEqual(plate.palette.colorways.moss, { fill: ['#223344', '#556677'] })
    assert.equal(migrateNameplate(savedProject()).version, NAMEPLATE_DATA_VERSION)
    const current = normalizeNameplate(savedProject(NAMEPLATE_DATA_VERSION)) as any
    assert.deepEqual([current.futureSetting, current.palette.futurePalette, current.palette.slots[0].futureSlot, current.variants.default.futureVariant], [{ glow: 3 }, 'kept', true, [1, 2]])
    assert.deepEqual(normalizeNameplate(JSON.parse(JSON.stringify(plate))), plate)
    const bad = normalizeNameplate({ ...savedProject(), fps: 'fast', phase: 'later' }) as any
    assert.equal(typeof bad.fps, 'number', 'known fields with bad values still fall back to defaults')
    assert.equal('phase' in bad, false)
})

test('a project from a newer plugin keeps its version and unknown fields', () => {
    const newer = NAMEPLATE_DATA_VERSION + 1
    const raw = savedProject(newer)
    assert.equal(isNewerData(raw), true)
    assert.equal(migrateNameplate(raw), raw)
    const plate = normalizeNameplate(raw) as any
    assert.deepEqual([plate.version, plate.futureSetting, plate.palette.slots[0].futureSlot], [newer, { glow: 3 }, true])
    assert.equal(isNewerData(normalizeNameplate(JSON.parse(JSON.stringify(plate)))), true)
    assert.equal(isNewerData(normalizeNameplate(null)), false)
})

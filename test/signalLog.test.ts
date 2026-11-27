import assert from 'node:assert/strict'
import test from 'node:test'
import { compactSignals, hostAt, MAX_SIGNAL_CHANGES, recordSignals, SignalChange, signalsAt } from '../src/cosmetic/signalLog'
import { PET_CONTROLS } from '../src/cosmetic/pet'
import { addTo, HOST_CONTROLS } from '../src/cosmetic/registry'

test('scrubbing back drops every later change even when the signals match the past', () => {
    const changes: SignalChange[] = []
    recordSignals(changes, 0, {})
    recordSignals(changes, 1, { is_hurt: 1 })
    recordSignals(changes, 2, {})
    recordSignals(changes, 0.5, {})
    assert.deepEqual(changes.map((change) => change.at), [0], 'the Hurt episode after the scrub point is gone')
    recordSignals(changes, 1.5, {})
    assert.equal(signalsAt(changes, 1.5).is_hurt ?? 0, 0, 'playing forward again does not replay it')
    assert.equal(signalsAt(changes, 1.2).is_hurt ?? 0, 0)
})

test('a long run of on/off changes stays bounded and keeps the recent ones exactly', () => {
    const changes: SignalChange[] = []
    recordSignals(changes, 0, {}, { pet_mood: 1 })
    for (let i = 1; i <= 150; i++) recordSignals(changes, i, i % 2 ? { is_sneaking: 1 } : {}, { pet_mood: 1 })
    assert.ok(changes.length <= MAX_SIGNAL_CHANGES, `${changes.length} changes`)
    for (let i = 130; i <= 150; i++) {
        assert.equal(signalsAt(changes, i + 0.5).is_sneaking ?? 0, i % 2, `sneaking after ${i} s`)
        assert.ok(changes.some((change) => change.at === i), `the change at ${i} s is kept`)
    }
})

test('an off change stays an edge through repeated compaction', () => {
    let changes: SignalChange[] = []
    recordSignals(changes, 0, {})
    recordSignals(changes, 1, { is_sneaking: 1 })
    recordSignals(changes, 2, {})
    recordSignals(changes, 3, { is_in_rain: 1 })
    for (let round = 0; round < 4; round++) {
        changes = compactSignals(changes, 10)
        assert.deepEqual(changes.map((change) => change.at), [2, 3], `round ${round}: Sneaking off at 2 s is kept`)
        assert.equal(signalsAt(changes, 2).is_sneaking ?? 0, 0)
        assert.equal(signalsAt(changes, 2).is_in_rain ?? 0, 0)
        assert.equal(signalsAt(changes, 3).is_in_rain, 1)
    }
})

test('thinning slider samples keeps a level held across an on/off change', () => {
    const changes: SignalChange[] = []
    recordSignals(changes, 0, {})
    recordSignals(changes, 1, { ground_speed: 3 })
    recordSignals(changes, 5, { ground_speed: 3, is_sneaking: 1 })
    for (let i = 1; i <= 80; i++) recordSignals(changes, 5 + i * 0.01, { ground_speed: 3 + i / 10, is_sneaking: 1 })
    assert.ok(changes.length <= MAX_SIGNAL_CHANGES, `${changes.length} changes`)
    assert.equal(signalsAt(changes, 0.5).ground_speed ?? 0, 0)
    assert.equal(signalsAt(changes, 2).ground_speed, 3, 'speed 3 from 1 s is still in effect at 2 s')
    assert.equal(signalsAt(changes, 4.9).is_sneaking ?? 0, 0)
    assert.equal(signalsAt(changes, 5).is_sneaking, 1)
    assert.equal(signalsAt(changes, 5).ground_speed, 3)
    assert.equal(signalsAt(changes, 6).ground_speed, 11)
})

test('a host toggle is kept as an edge while a slider drag is thinned', () => {
    const remove = addTo(HOST_CONTROLS, ...PET_CONTROLS)
    try {
        const changes: SignalChange[] = []
        recordSignals(changes, 0, {}, { pet_in_water: 0, pet_distance: 2 })
        recordSignals(changes, 0.1, {}, { pet_in_water: 1, pet_distance: 2 })
        recordSignals(changes, 0.2, {}, { pet_in_water: 0, pet_distance: 2 })
        for (let i = 1; i <= 80; i++) recordSignals(changes, 1 + i * 0.01, { ground_speed: i / 10 }, { pet_in_water: 0, pet_distance: 2 + i / 10 })
        assert.ok(changes.length <= MAX_SIGNAL_CHANGES, `${changes.length} changes`)
        assert.equal(hostAt(changes, 0.05).pet_in_water ?? 0, 0)
        assert.equal(hostAt(changes, 0.15).pet_in_water, 1, 'the water pulse survives the drag')
        assert.equal(hostAt(changes, 0.5).pet_in_water ?? 0, 0)
        assert.equal(hostAt(changes, 0.5).pet_distance, 2)
        assert.equal(signalsAt(changes, 2).ground_speed, 8, 'the latest speed is kept')
        assert.equal(hostAt(changes, 2).pet_distance, 10)
    } finally {
        remove()
    }
})

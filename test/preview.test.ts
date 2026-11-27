import assert from 'node:assert/strict'
import test from 'node:test'
import { clearPreview, resetPreview, setHostVariable, setSignal, signalControls, typedValue } from '../src/cosmetic/preview'

test('preview controls put back the Molang values they replaced', () => {
    const scope = globalThis as any
    const global_variables: Record<string, unknown> = { 'query.ground_speed': 'theirs', 'variable.mood': 2, untouched: 1 }
    scope.Animator = { MolangParser: { global_variables }, animations: [], preview() {} }
    try {
        setSignal('ground_speed', 3)
        setHostVariable('mood', 5)
        assert.equal(global_variables['query.ground_speed'], 3)
        assert.equal(global_variables['q.ground_speed'], 3)
        assert.equal(global_variables['query.owner.ground_speed'], 3)
        assert.equal(global_variables['v.mood'], 5)
        setSignal('ground_speed', 6)
        clearPreview()
        assert.deepEqual(global_variables, { 'query.ground_speed': 'theirs', 'variable.mood': 2, untouched: 1 })
        setSignal('ground_speed', 1)
        assert.equal(global_variables['query.ground_speed'], 1)
        clearPreview()
        assert.deepEqual(global_variables, { 'query.ground_speed': 'theirs', 'variable.mood': 2, untouched: 1 })
    } finally {
        resetPreview()
        clearPreview()
        delete scope.Animator
    }
})

test('typed signal values can go past the slider, so falls and fast rides can be tried', () => {
    const control = (name: string) => signalControls().find((entry) => entry.name === name)
    assert.ok(control('vertical_speed')!.min <= -78, 'the slider reaches terminal falling speed')
    assert.ok(control('ground_speed')!.max >= 30, 'the slider reaches elytra and ice boat speeds')
    assert.equal(typedValue('-120'), -120)
    assert.equal(typedValue(250), 250)
    assert.equal(typedValue('0'), 0)
    assert.equal(typedValue(''), null)
    assert.equal(typedValue('fast'), null)
    assert.equal(typedValue(Infinity), null)
})

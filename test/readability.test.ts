import assert from 'node:assert/strict'
import test from 'node:test'
import type { EngineIssue, NameplateCost, NameplatePreview } from '../src/engine'
import { hardToRead } from '../src/text/readability'

function fakePreview(): { preview: NameplatePreview, warn(issues: EngineIssue[]): void } {
    let version = 0
    let warnings: EngineIssue[] = []
    const preview = {
        get version() {
            return version
        },
        cost: () => ({ warnings, issues: [], infos: [] }) as unknown as NameplateCost,
    } as unknown as NameplatePreview
    return {
        preview,
        warn(issues) {
            warnings = issues
            version++
        },
    }
}

test('low contrast warnings flag the variant the engine names, and a later full check replaces the result', () => {
    const { preview, warn } = fakePreview()
    assert.deepEqual([...hardToRead(preview)!], [])
    warn([
        { code: 'readability', level: 'warning', path: 'manifest.json#text', message: '', names: { variant: 'default', animation: '' } },
        { code: 'readability', level: 'warning', path: 'manifest.json#variants.night.text', message: '', names: { variant: 'night', animation: '' } },
        { code: 'quads', level: 'warning', path: 'manifest.json#variants.day', message: '', names: { variant: 'day' } },
    ])
    assert.deepEqual([...hardToRead(preview)!].sort(), ['default', 'night'])
    warn([{ code: 'readability', level: 'warning', path: 'manifest.json#variants.night.text', message: '', names: { variant: 'night' } }])
    assert.deepEqual([...hardToRead(preview)!], ['night'])
})

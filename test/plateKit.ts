import assert from 'node:assert/strict'
import test from 'node:test'
import { loadBundle, NameplatePreview } from '../src/engine'
import { defaultNameplate } from '../src/format'
import { BodyData, ProjectSnapshot } from '../src/model'
import { resetLive } from '../src/preview/live'

export const FILL = { id: 'fill', name: 'Fill', ramp: ['#202020'] }
export const GLOW = { id: 'glow', name: 'Glow', ramp: ['#FFA040'] }

export function plateFiles(manifest: Record<string, unknown>, files: Record<string, unknown> = {}, slots: unknown[] = [FILL]): Record<string, string> {
    return {
        'manifest.json': JSON.stringify({ format: 1, kind: 'nameplate', id: 'plate', requires: ['nameplate'], fps: 10, loop: 10, layers: [{ id: 'body' }], ...manifest }),
        'palettes.json': JSON.stringify({ slots }),
        'layers/body.json': JSON.stringify({ kind: 'body', fill: { color: 'fill' } }),
        ...Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
    }
}

export function loadPlate(files: Record<string, string>): NameplatePreview {
    const loaded = loadBundle(files)
    assert.deepEqual(loaded.issues, [])
    assert.ok(loaded.preview)
    return loaded.preview
}

export function embers(sprite: string, life: [number, number], fall = -0.5) {
    return { kind: 'emitter', sprites: [sprite], of: 'body', spawn: { shape: 'line', edge: 'top', offset: [0, 0] }, lifetime: life, velocity: { x: [0, 0], y: [fall, fall] } }
}

export function sampleSnapshot(nameplate = defaultNameplate()): ProjectSnapshot {
    const body: BodyData = {
        kind: 'body',
        uuid: '00000000-0000-4000-8000-000000000001',
        id: 'plate',
        depth: 'background',
        step: 1,
        padding: [4, 2, 4, 2],
        minWidth: 0,
        radius: 2,
        fill: { kind: 'gradient', slot: 'fill' },
        rings: [{ kind: 'color', ref: 'border[1]' }],
    }
    return { nameplate, layers: [body], groups: [], loop: { length: 20, tracks: [] }, sprites: {}, pixelIssues: [] }
}

export function liveTest(name: string, run: () => void) {
    test(name, () => {
        try {
            run()
        } finally {
            resetLive()
        }
    })
}

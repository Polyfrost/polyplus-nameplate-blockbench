import assert from 'node:assert/strict'
import { buildBundle, CosmeticSources, emptySources, readBundle } from '../src/cosmetic/bundle'
import { buildCosmetic, BuiltCosmetic } from '../src/cosmetic/build'
import { CosmeticData, CosmeticKind, defaultCosmetic, normalizeCosmetic } from '../src/cosmetic/data'
import { particleStarter } from '../src/cosmetic/effects'
import { indexPixels } from '../src/cosmetic/indexed'
import { encodePng } from '../src/cosmetic/png'
import { toBase64 } from '../src/material/png'

export const FEATHER = ['#FF304050', '#FF6080A0']
export const PICTURE = toBase64(encodePng(2, 2, new Uint8Array(16).fill(255), 4))

export function bone(name: string, parent: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name,
        ...(parent ? { parent } : {}),
        pivot: [0, 24, 2],
        cubes: [{ origin: [0, 14, 2], size: [4, 4, 1], uv: [0, 0] }],
        ...extra,
    }
}

export function geometry(id: string, bones: Array<Record<string, unknown>>): Record<string, unknown> {
    return {
        format_version: '1.12.0',
        'minecraft:geometry': [{ description: { identifier: `geometry.${id}`, texture_width: 16, texture_height: 16 }, bones }],
    }
}

export function animation(bones: string[], length = 1, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        loop: true,
        animation_length: length,
        bones: Object.fromEntries(bones.map((name) => [name, { rotation: { '0.0': [0, 0, 0], [String(length)]: [10, 0, 0] } }])),
        ...extra,
    }
}

export function paintedTexture(data: CosmeticData, id: string, size = 4): CosmeticSources['textures'][number] {
    const rgba = new Uint8Array(size * size * 4)
    for (let p = 0; p < size * size; p++) {
        const tone = data.palette.slots[0]?.ramp[p % 2] ?? '#FF808080'
        const hex = tone.replace('#', '')
        const argb = hex.length === 6 ? `FF${hex}` : hex
        rgba[p * 4] = parseInt(argb.slice(2, 4), 16)
        rgba[p * 4 + 1] = parseInt(argb.slice(4, 6), 16)
        rgba[p * 4 + 2] = parseInt(argb.slice(6, 8), 16)
        rgba[p * 4 + 3] = parseInt(argb.slice(0, 2), 16)
    }
    const indexed = data.palette.slots.length ? indexPixels(size, size, rgba, data.palette) : null
    if (indexed) assert.equal(indexed.off, null)
    return { id, png: encodePng(size, size, rgba, 4), index: indexed ? encodePng(size, size, indexed.index, 1) : null }
}

export function cosmetic(kind: CosmeticKind, id: string, change: (data: CosmeticData) => void): CosmeticData {
    const data = defaultCosmetic(kind, id)
    change(data)
    return normalizeCosmetic(data, kind)
}

export function sources(change: (sources: CosmeticSources) => void): CosmeticSources {
    const out = emptySources()
    change(out)
    return out
}

function errorsOf(built: BuiltCosmetic): string[] {
    return built.issues.filter((issue) => (issue.level ?? 'error') === 'error').map((issue) => `${issue.code} ${issue.path} ${JSON.stringify(issue.names)}`)
}

export function cleanBuild(data: CosmeticData, input: CosmeticSources): BuiltCosmetic {
    const built = buildCosmetic(data, input)
    assert.deepEqual(errorsOf(built), [])
    return built
}

export function roundTrip(data: CosmeticData, input: CosmeticSources): BuiltCosmetic {
    const built = cleanBuild(data, input)
    assert.ok(built.load, 'the engine loaded')
    assert.equal(built.load!.status, 'asset', JSON.stringify(built.issues))
    assert.deepEqual(built.load!.meta?.requires, built.requires)
    const manifest = JSON.parse(built.files['manifest.json'])
    assert.deepEqual(manifest.requires, built.load!.analysis?.requires)
    const read = readBundle(built)
    assert.deepEqual(read.requires, built.requires)
    assert.deepEqual(read.data, data)
    assert.deepEqual(read.sources, input)
    const again = buildBundle(read.data, read.sources, read.requires)
    assert.deepEqual(again.files, built.files)
    assert.deepEqual(Object.keys(again.binary).sort(), Object.keys(built.binary).sort())
    for (const path of Object.keys(built.binary)) assert.deepEqual(again.binary[path], built.binary[path], path)
    return built
}

export function steadySpark(d: CosmeticData, locator: string, components: Record<string, unknown> = {}) {
    d.effects.pictures = { spark: PICTURE }
    const spark = particleStarter('spark')
    const c = spark.json.particle_effect.components
    delete c['minecraft:emitter_rate_instant']
    delete c['minecraft:emitter_lifetime_once']
    Object.assign(c, {
        'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 8 },
        'minecraft:emitter_lifetime_looping': { active_time: 1 },
        'minecraft:emitter_shape_sphere': { radius: 0 },
        'minecraft:particle_initial_speed': 0,
        'minecraft:particle_motion_dynamic': {},
        ...components,
    })
    d.effects.particles = [{ ...spark, picture: 'spark', tint: null }]
    d.effects.emitters = [{ particle: 'spark', sound: '', vanilla: '', locator, count: 1 }]
}

export const LASTING_SPARKS = {
    'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 16 },
    'minecraft:particle_lifetime_expression': { max_lifetime: 1.5 },
}

export function using<D extends { dispose(): void }, R>(drivers: D[], run: (...drivers: D[]) => R): R {
    try {
        return run(...drivers)
    } finally {
        for (const driver of drivers) driver.dispose()
    }
}

export function withGlobals<T>(globals: Record<string, unknown>, run: () => T): T {
    const scope = globalThis as any
    Object.assign(scope, globals)
    try {
        return run()
    } finally {
        for (const name of Object.keys(globals)) delete scope[name]
    }
}

export function withActions<T>(run: () => T): T {
    return withGlobals({
        Action: class {
            constructor(public id: string) {}
            delete() {}
        },
    }, run)
}

class FakeMatrix {
    set() {
        return this
    }
    clone() {
        return new FakeMatrix()
    }
    invert() {
        return this
    }
    multiply() {
        return this
    }
    decompose() {}
}

class FakeObject {
    name = ''
    parent: FakeObject | null = null
    add(child: FakeObject) {
        child.parent = this
    }
    remove() {}
    updateMatrixWorld() {}
}

export type Frames = Array<(now: number) => void>

export function withScene<T>(globals: Record<string, unknown>, run: (frames: Frames) => T): T {
    const frames: Frames = []
    return withGlobals({
        THREE: { Matrix4: FakeMatrix, Group: FakeObject },
        Group: class {
            static all: unknown[] = []
        },
        Outliner: { root: [], elements: [] },
        Texture: { all: [] },
        AnimationController: { all: [] },
        requestAnimationFrame: (callback: (now: number) => void) => frames.push(callback),
        cancelAnimationFrame: () => {},
        ...globals,
    }, () => run(frames))
}

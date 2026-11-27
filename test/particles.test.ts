import assert from 'node:assert/strict'
import test from 'node:test'
import { engineFromWorld, modelFromEngine, ParticleLayer, particleBuffers, particleCapacity, particleView, point, sceneLight } from '../src/cosmetic/particles'
import { CosmeticDriver, engineSignals, IDENTITY, QUAD_FLOATS } from '../src/engine'
import { engineRoot } from '../src/cosmetic/livePose'
import { cleanBuild, cosmetic, geometry, sources, steadySpark, using } from './cosmeticKit'

const HOLDER: number[] = [...IDENTITY]

function quad(texture: number, blend: number, at: [number, number, number], alpha = 1, flags = 0): number[] {
    const out = new Array(QUAD_FLOATS).fill(0)
    out[26] = flags
    out[0] = texture
    out[1] = blend
    out.splice(2, 4, 1, 0.5, 0.25, alpha)
    const corners = [[-1, -1, 0, 0, 1], [1, -1, 0, 1, 1], [1, 1, 0, 1, 0], [-1, 1, 0, 0, 0]]
    corners.forEach(([x, y, z, u, v], c) => out.splice(6 + c * 5, 5, at[0] + x, at[1] + y, at[2] + z, u, v))
    return out
}

function puff() {
    const data = cosmetic('effect', 'puff', (d) => steadySpark(d, 'ring'))
    const built = cleanBuild(data, sources((s) => {
        s.geometry = geometry('puff', [{ name: 'root', pivot: [0, 0, 0], locators: { ring: [3, 30, 0] } }])
    }))
    return CosmeticDriver.open(built.files, built.binary, engineSignals())!
}

const centerOf = (built: ReturnType<typeof particleBuffers>) => [0, 1, 2].map((k) => (built.positions[k] + built.positions[6 + k]) / 2)
const nearly = (actual: number[], expected: number[]) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-3, `${actual}`))

test('quads batch by blend then picture and land in model space', () => {
    const quads = Float32Array.from([...quad(1, 1, [0, 0, 0]), ...quad(0, 0, [4, 0, 0]), ...quad(1, 0, [8, 0, 0]), ...quad(0, 0, [12, 0, 0], 0.5)])
    const camera = [0, 10, -20]
    const built = particleBuffers(quads, camera, modelFromEngine(IDENTITY))
    assert.deepEqual(built.batches, [
        { texture: 0, blend: 0, emissive: 0, start: 0, count: 12 },
        { texture: 1, blend: 0, emissive: 0, start: 12, count: 6 },
        { texture: 1, blend: 1, emissive: 0, start: 18, count: 6 },
    ])
    assert.deepEqual(Array.from(built.positions.slice(0, 3)), [-3, 9, -20])
    assert.deepEqual(Array.from(built.uvs.slice(0, 2)), [0, 1])
    assert.deepEqual(Array.from(built.colors.slice(4, 8)), [1, 0.5, 0.25, 1])
    assert.deepEqual(Array.from(built.colors.slice(16, 20)), [1, 0.5, 0.25, 0.5])
    assert.deepEqual(Array.from(built.indices.slice(0, 12)), [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
})

test('the view and the drawing undo each other around the wearer root', () => {
    const root = [0, 0, 1, 2, 0, 1, 0, 0, -1, 0, 0, 5]
    const view = particleView(engineFromWorld(HOLDER, root), [7, 8, 9], [1, 0, 0], [0, 1, 0])
    const back = point(modelFromEngine(root), view[0], view[1], view[2])
    back.forEach((value, i) => assert.ok(Math.abs(value - [7, 8, 9][i]) < 1e-9, `${back}`))
    assert.deepEqual(view.slice(9), [0, 0, 0])
})

test('particle buffers are reused while they fit and grow when they run out', () => {
    const camera = [0, 0, 0]
    const toModel = modelFromEngine(IDENTITY)
    const few = Float32Array.from([...quad(0, 0, [0, 0, 0]), ...quad(0, 0, [1, 0, 0])])
    const first = particleBuffers(few, camera, toModel)
    assert.equal(first.count, 2)
    assert.equal(first.capacity, particleCapacity(2))
    const again = particleBuffers(Float32Array.from(quad(1, 0, [5, 0, 0])), camera, toModel, first)
    assert.equal(again, first)
    assert.equal(again.count, 1)
    assert.deepEqual(again.batches, [{ texture: 1, blend: 0, emissive: 0, start: 0, count: 6 }])
    const many = new Float32Array((first.capacity + 1) * QUAD_FLOATS)
    const grown = particleBuffers(many, camera, toModel, first)
    assert.notEqual(grown, first)
    assert.ok(grown.capacity > first.capacity)
    assert.equal(grown.count, first.capacity + 1)
})

class FakeAttribute {
    needsUpdate = false
    usage = 0
    constructor(readonly array: ArrayLike<number>, readonly itemSize: number) {}
    setUsage(usage: number) {
        this.usage = usage
    }
}

class FakeGeometry {
    attributes: Record<string, FakeAttribute> = {}
    index: FakeAttribute | null = null
    groups: Array<[number, number, number]> = []
    drawRange = [0, Infinity]
    disposed = false
    setAttribute(name: string, attribute: FakeAttribute) {
        this.attributes[name] = attribute
    }
    getAttribute(name: string) {
        return this.attributes[name]
    }
    setIndex(index: FakeAttribute) {
        this.index = index
    }
    clearGroups() {
        this.groups = []
    }
    addGroup(start: number, count: number, material: number) {
        this.groups.push([start, count, material])
    }
    setDrawRange(start: number, count: number) {
        this.drawRange = [start, count]
    }
    dispose() {
        this.disposed = true
    }
}

class FakeMesh {
    name = ''
    frustumCulled = true
    renderOrder = 0
    visible = true
    parent: unknown = null
    constructor(public geometry: FakeGeometry, public material: unknown) {}
}

class FakeMaterial {
    color = {
        rgb: [1, 1, 1],
        setRGB(r: number, g: number, b: number) {
            this.rgb = [r, g, b]
        },
    }
    constructor(readonly options: Record<string, unknown>) {}
    dispose() {}
}

test('the particle layer keeps one dynamic geometry while particles fit, and frees it when it grows', () => {
    const previous = (globalThis as any).THREE
    ;(globalThis as any).THREE = { Mesh: FakeMesh, BufferGeometry: FakeGeometry, BufferAttribute: FakeAttribute, MeshBasicMaterial: FakeMaterial, DynamicDrawUsage: 35048, DoubleSide: 2, AdditiveBlending: 2, NormalBlending: 1 }
    const driver = { effectTexture: () => null } as any
    const layer = new ParticleLayer(null, driver, {})
    try {
        const toModel = modelFromEngine(IDENTITY)
        layer.draw(Float32Array.from(quad(0, 0, [0, 0, 0])), [0, 0, 0], toModel)
        const mesh = (layer as any).mesh as FakeMesh
        const geometry = mesh.geometry
        const position = geometry.getAttribute('position')
        assert.equal(position.usage, 35048)
        layer.draw(Float32Array.from([...quad(0, 0, [0, 0, 0]), ...quad(0, 1, [1, 0, 0])]), [0, 0, 0], toModel)
        assert.equal(mesh.geometry, geometry)
        assert.equal(geometry.getAttribute('position'), position)
        assert.equal(position.needsUpdate, true)
        assert.equal(geometry.index!.needsUpdate, true)
        assert.deepEqual(geometry.groups, [[0, 6, 0], [6, 6, 1]])
        assert.deepEqual(geometry.drawRange, [0, 12])
        layer.draw(new Float32Array((layer.capacity + 1) * QUAD_FLOATS), [0, 0, 0], toModel)
        assert.notEqual(mesh.geometry, geometry)
        assert.equal(geometry.disposed, true)
        layer.draw(new Float32Array(0), [0, 0, 0], toModel)
        assert.equal(mesh.visible, false)
    } finally {
        layer.dispose()
        ;(globalThis as any).THREE = previous
    }
})

test('effect particles come out as camera-relative quads at the mirrored locator with their picture, and world particles stay behind when the wearer moves a block', () => {
    using([puff()], (driver) => {
        assert.equal(driver.hasEffects(), true)
        const at = (x: number) => engineRoot([1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0])
        const view = (root: number[]) => particleView(engineFromWorld(HOLDER, root), [0, 24, -50], [1, 0, 0], [0, 1, 0])
        const center = (root: number[]) => {
            const quads = driver.effects(view(root))
            assert.ok(quads.length >= QUAD_FLOATS && quads.length % QUAD_FLOATS === 0)
            assert.equal(driver.effectTexture(quads[0]), 'textures/fx_spark.png')
            return centerOf(particleBuffers(quads, view(root).slice(0, 3), modelFromEngine(root)))
        }
        driver.play(0)
        driver.frame(0, { signals: {}, events: 0, root: at(0) })
        driver.effects(view(at(0)))
        driver.frame(0.05, { signals: {}, events: 0, root: at(0) })
        const still = center(at(0))
        nearly(still, [-3, 30, 0])
        driver.frame(0.1, { signals: {}, events: 0, root: at(1) })
        const moved = center(at(1))
        assert.ok(Math.abs(Math.abs(moved[0] - still[0]) - 16) < 1e-2, `${still} -> ${moved}`)
        nearly(moved.slice(1), still.slice(1))
    })
})

test('glowing quads get their own batch and stay full-bright while the rest follow the scene light', () => {
    const quads = Float32Array.from([...quad(0, 0, [0, 0, 0], 1, 1), ...quad(0, 0, [1, 0, 0]), ...quad(0, 0, [2, 0, 0], 1, 1)])
    const built = particleBuffers(quads, [0, 0, 0], modelFromEngine(IDENTITY))
    assert.deepEqual(built.batches, [
        { texture: 0, blend: 0, emissive: 0, start: 0, count: 6 },
        { texture: 0, blend: 0, emissive: 1, start: 6, count: 12 },
    ])
    const scope = globalThis as any
    const previous = { THREE: scope.THREE, Canvas: scope.Canvas, settings: scope.settings }
    assert.deepEqual(sceneLight(), [1, 1, 1])
    Object.assign(scope, {
        THREE: { Mesh: FakeMesh, BufferGeometry: FakeGeometry, BufferAttribute: FakeAttribute, MeshBasicMaterial: FakeMaterial, DynamicDrawUsage: 35048, DoubleSide: 2, AdditiveBlending: 2, NormalBlending: 1 },
        Canvas: { global_light_color: { r: 1, g: 0.5, b: 0.25 } },
        settings: { brightness: { value: 25 } },
    })
    const layer = new ParticleLayer(null, { effectTexture: () => null } as any, {})
    try {
        assert.deepEqual(sceneLight(), [0.5, 0.25, 0.125])
        layer.draw(quads, [0, 0, 0], modelFromEngine(IDENTITY))
        const [plain, glowing] = (layer as any).mesh.material as FakeMaterial[]
        assert.notEqual(plain, glowing)
        assert.deepEqual(plain.color.rgb, [0.5, 0.25, 0.125])
        assert.deepEqual(glowing.color.rgb, [1, 1, 1])
    } finally {
        layer.dispose()
        Object.assign(scope, previous)
    }
})

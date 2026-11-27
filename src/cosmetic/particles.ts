import { CosmeticDriver, QUAD_FLOATS } from '../engine'
import { Affine, invert, multiply } from './livePose'
import { three } from './rigScene'

const QUAD_TEXTURE = 0
const QUAD_BLEND = 1
const QUAD_COLOR = 2
const QUAD_CORNERS = 6
const CORNER_FLOATS = 5
const BLEND_ADDITIVE = 1
const QUAD_FLAGS = 26
const FLAG_EMISSIVE = 1
const DEFAULT_BRIGHTNESS = 50
const MIRROR: Affine = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

export type ParticleSource = Pick<CosmeticDriver, 'effects' | 'effectTexture'>

export interface ParticleBatch {
    texture: number
    blend: number
    emissive: number
    start: number
    count: number
}

export interface ParticleBuffers {
    positions: Float32Array
    uvs: Float32Array
    colors: Float32Array
    indices: Uint32Array
    batches: ParticleBatch[]
    count: number
    capacity: number
}

const MIN_CAPACITY = 64

export function particleCapacity(count: number): number {
    let capacity = MIN_CAPACITY
    while (capacity < count) capacity *= 2
    return capacity
}

function allocate(capacity: number): ParticleBuffers {
    return {
        positions: new Float32Array(capacity * 12),
        uvs: new Float32Array(capacity * 8),
        colors: new Float32Array(capacity * 16),
        indices: new Uint32Array(capacity * 6),
        batches: [],
        count: 0,
        capacity,
    }
}

export function point(affine: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
    return [
        affine[0] * x + affine[1] * y + affine[2] * z + affine[3],
        affine[4] * x + affine[5] * y + affine[6] * z + affine[7],
        affine[8] * x + affine[9] * y + affine[10] * z + affine[11],
    ]
}

export function direction(affine: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
    const v = [
        affine[0] * x + affine[1] * y + affine[2] * z,
        affine[4] * x + affine[5] * y + affine[6] * z,
        affine[8] * x + affine[9] * y + affine[10] * z,
    ]
    const length = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / length, v[1] / length, v[2] / length]
}

export function affineOfMatrix(matrix: { elements: ArrayLike<number> }): Affine {
    const e = matrix.elements
    return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]]
}

export function engineFromWorld(holderInverse: Affine, root: ArrayLike<number>): Affine {
    return multiply(root, multiply(MIRROR, holderInverse))
}

export function modelFromEngine(root: ArrayLike<number>): Affine {
    return multiply(MIRROR, invert(root))
}

export function particleView(engineFromWorldAffine: Affine, camera: readonly number[], right: readonly number[], up: readonly number[]): number[] {
    return [
        ...point(engineFromWorldAffine, camera[0], camera[1], camera[2]),
        ...direction(engineFromWorldAffine, right[0], right[1], right[2]),
        ...direction(engineFromWorldAffine, up[0], up[1], up[2]),
        0, 0, 0,
    ]
}

export function particleBuffers(quads: Float32Array, camera: readonly number[], toModel: Affine, reuse: ParticleBuffers | null = null): ParticleBuffers {
    const count = Math.floor(quads.length / QUAD_FLOATS)
    const out = reuse && reuse.capacity >= count ? reuse : allocate(particleCapacity(count))
    const additive = (i: number) => (quads[i * QUAD_FLOATS + QUAD_BLEND] === BLEND_ADDITIVE ? 1 : 0)
    const glows = (i: number) => (Number(quads[i * QUAD_FLOATS + QUAD_FLAGS]) & FLAG_EMISSIVE ? 1 : 0)
    const order = Array.from({ length: count }, (_, i) => i)
    order.sort((a, b) => additive(a) - additive(b) || quads[a * QUAD_FLOATS + QUAD_TEXTURE] - quads[b * QUAD_FLOATS + QUAD_TEXTURE] || glows(a) - glows(b) || a - b)
    const { positions, uvs, colors, indices } = out
    const batches: ParticleBatch[] = []
    for (let n = 0; n < count; n++) {
        const at = order[n] * QUAD_FLOATS
        const texture = quads[at + QUAD_TEXTURE]
        const blend = quads[at + QUAD_BLEND] === BLEND_ADDITIVE ? 1 : 0
        const emissive = glows(order[n])
        const lastBatch = batches[batches.length - 1]
        if (lastBatch && lastBatch.texture === texture && lastBatch.blend === blend && lastBatch.emissive === emissive) lastBatch.count += 6
        else batches.push({ texture, blend, emissive, start: n * 6, count: 6 })
        for (let c = 0; c < 4; c++) {
            const corner = at + QUAD_CORNERS + c * CORNER_FLOATS
            const x = quads[corner] + camera[0]
            const y = quads[corner + 1] + camera[1]
            const z = quads[corner + 2] + camera[2]
            const v = n * 4 + c
            positions[v * 3] = toModel[0] * x + toModel[1] * y + toModel[2] * z + toModel[3]
            positions[v * 3 + 1] = toModel[4] * x + toModel[5] * y + toModel[6] * z + toModel[7]
            positions[v * 3 + 2] = toModel[8] * x + toModel[9] * y + toModel[10] * z + toModel[11]
            uvs[v * 2] = quads[corner + 3]
            uvs[v * 2 + 1] = quads[corner + 4]
            for (let k = 0; k < 4; k++) colors[v * 4 + k] = quads[at + QUAD_COLOR + k]
        }
        const v = n * 4
        const i = n * 6
        indices[i] = v
        indices[i + 1] = v + 1
        indices[i + 2] = v + 2
        indices[i + 3] = v
        indices[i + 4] = v + 2
        indices[i + 5] = v + 3
    }
    out.batches = batches
    out.count = count
    return out
}

export function sceneLight(): [number, number, number] {
    const scope = globalThis as any
    const color = scope.Canvas?.global_light_color
    const brightness = Number(scope.settings?.brightness?.value ?? DEFAULT_BRIGHTNESS)
    const scale = Number.isFinite(brightness) ? brightness / DEFAULT_BRIGHTNESS : 1
    const channel = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 1) * scale
    return [channel(color?.r), channel(color?.g), channel(color?.b)]
}

function pngType(path: string): string {
    return path.toLowerCase().endsWith('.png') ? path : `${path}.png`
}

export function cameraView(holderInverse: any, root: ArrayLike<number>): number[] | null {
    const camera = (globalThis as any).Preview?.selected?.camera
    if (!camera) return null
    const T = three()
    const position = camera.getWorldPosition(new T.Vector3())
    const turn = camera.getWorldQuaternion(new T.Quaternion())
    const right = new T.Vector3(1, 0, 0).applyQuaternion(turn)
    const up = new T.Vector3(0, 1, 0).applyQuaternion(turn)
    return particleView(engineFromWorld(affineOfMatrix(holderInverse), root), [position.x, position.y, position.z], [right.x, right.y, right.z], [up.x, up.y, up.z])
}

export class ParticleLayer {
    private readonly mesh: any
    private readonly textures = new Map<number, any>()
    private readonly materials = new Map<string, any>()
    private readonly urls: string[] = []
    private buffers: ParticleBuffers | null = null
    private readonly lit = new Set<any>()

    constructor(private readonly holder: any, private readonly driver: ParticleSource, private readonly binary: Readonly<Record<string, Uint8Array>>) {
        const T = three()
        this.mesh = new T.Mesh(new T.BufferGeometry(), [])
        this.mesh.name = 'polyplus_particles'
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 10
        holder?.add?.(this.mesh)
    }

    draw(quads: Float32Array, camera: readonly number[], toModel: Affine) {
        const built = particleBuffers(quads, camera, toModel, this.buffers)
        if (built !== this.buffers) this.resize(built)
        else this.upload()
        const geometry = this.mesh.geometry
        geometry.clearGroups()
        const materials: any[] = []
        for (const batch of built.batches) {
            geometry.addGroup(batch.start, batch.count, materials.length)
            materials.push(this.material(batch.texture, batch.blend, batch.emissive))
        }
        geometry.setDrawRange(0, built.count * 6)
        const [r, g, b] = sceneLight()
        for (const material of this.lit) material.color?.setRGB?.(r, g, b)
        this.mesh.material = materials
        this.mesh.visible = built.batches.length > 0
    }

    drawFromCamera(holderInverse: any, root: ArrayLike<number>) {
        const view = cameraView(holderInverse, root)
        if (view) this.drawView(view, root)
    }

    drawView(view: readonly number[], root: ArrayLike<number>) {
        this.draw(this.driver.effects(view), view.slice(0, 3), modelFromEngine(root))
    }

    get capacity(): number {
        return this.buffers?.capacity ?? 0
    }

    private resize(built: ParticleBuffers) {
        const T = three()
        const dynamic = (array: Float32Array | Uint32Array, size: number) => {
            const attribute = new T.BufferAttribute(array, size)
            attribute.setUsage?.(T.DynamicDrawUsage)
            return attribute
        }
        const geometry = new T.BufferGeometry()
        geometry.setAttribute('position', dynamic(built.positions, 3))
        geometry.setAttribute('uv', dynamic(built.uvs, 2))
        geometry.setAttribute('color', dynamic(built.colors, 4))
        geometry.setIndex(dynamic(built.indices, 1))
        this.mesh.geometry.dispose?.()
        this.mesh.geometry = geometry
        this.buffers = built
    }

    private upload() {
        const geometry = this.mesh.geometry
        for (const name of ['position', 'uv', 'color']) {
            const attribute = geometry.getAttribute(name)
            if (attribute) attribute.needsUpdate = true
        }
        if (geometry.index) geometry.index.needsUpdate = true
    }

    dispose() {
        this.mesh.parent?.remove?.(this.mesh)
        this.mesh.geometry.dispose?.()
        for (const material of this.materials.values()) material.dispose?.()
        for (const texture of this.textures.values()) texture?.dispose?.()
        for (const url of this.urls) URL.revokeObjectURL(url)
        this.materials.clear()
        this.lit.clear()
        this.textures.clear()
        this.buffers = null
    }

    private texture(id: number): any {
        const known = this.textures.get(id)
        if (known !== undefined) return known
        const T = three()
        const path = this.driver.effectTexture(id)
        const bytes = path ? this.binary[path] ?? this.binary[pngType(path)] : null
        let texture: any = null
        if (bytes && typeof Image !== 'undefined' && typeof URL !== 'undefined') {
            const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
            this.urls.push(url)
            const image = new Image()
            texture = new T.Texture(image)
            texture.magFilter = T.NearestFilter
            texture.minFilter = T.NearestFilter
            texture.flipY = false
            image.onload = () => {
                texture.needsUpdate = true
            }
            image.src = url
        }
        this.textures.set(id, texture)
        return texture
    }

    private material(texture: number, blend: number, emissive: number): any {
        const key = `${texture}:${blend}:${emissive}`
        const known = this.materials.get(key)
        if (known) return known
        const T = three()
        const map = this.texture(texture)
        const material = new T.MeshBasicMaterial({
            map: map ?? null,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            alphaTest: blend ? 0 : 0.01,
            blending: blend ? T.AdditiveBlending : T.NormalBlending,
        })
        this.materials.set(key, material)
        if (!emissive) this.lit.add(material)
        return material
    }
}

import { isRecord } from '../util/json'
import { RIG_PARTS_KEY } from './bundle'

export type Affine = number[]

export function affineAt(values: ArrayLike<number>, index: number): Affine {
    return Array.from({ length: 12 }, (_, i) => Number(values[index * 12 + i]))
}

export function mirrored(d: ArrayLike<number>): Affine {
    return [
        d[0], -d[1], -d[2], -d[3],
        -d[4], d[5], d[6], d[7],
        -d[8], d[9], d[10], d[11],
    ]
}

export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Affine {
    const out: Affine = new Array(12).fill(0)
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
            let sum = col === 3 ? a[row * 4 + 3] : 0
            for (let k = 0; k < 3; k++) sum += a[row * 4 + k] * b[k * 4 + col]
            out[row * 4 + col] = sum
        }
    }
    return out
}

export const BLOCKS_PER_PIXEL = 1 / 16

export function engineRoot(root: ArrayLike<number>): Affine {
    return multiply(root, [BLOCKS_PER_PIXEL, 0, 0, 0, 0, BLOCKS_PER_PIXEL, 0, 0, 0, 0, BLOCKS_PER_PIXEL, 0])
}

export function invert(a: ArrayLike<number>): Affine {
    const [m00, m01, m02, tx, m10, m11, m12, ty, m20, m21, m22, tz] = Array.from(a)
    const c00 = m11 * m22 - m12 * m21
    const c01 = m02 * m21 - m01 * m22
    const c02 = m01 * m12 - m02 * m11
    const c10 = m12 * m20 - m10 * m22
    const c11 = m00 * m22 - m02 * m20
    const c12 = m02 * m10 - m00 * m12
    const c20 = m10 * m21 - m11 * m20
    const c21 = m01 * m20 - m00 * m21
    const c22 = m00 * m11 - m01 * m10
    const det = m00 * c00 + m01 * c10 + m02 * c20
    const k = Math.abs(det) < 1e-12 ? 0 : 1 / det
    const r = [c00 * k, c01 * k, c02 * k, c10 * k, c11 * k, c12 * k, c20 * k, c21 * k, c22 * k]
    return [
        r[0], r[1], r[2], -(r[0] * tx + r[1] * ty + r[2] * tz),
        r[3], r[4], r[5], -(r[3] * tx + r[4] * ty + r[5] * tz),
        r[6], r[7], r[8], -(r[6] * tx + r[7] * ty + r[8] * tz),
    ]
}

export function boneTargets(geometry: unknown, rigGroups: ReadonlySet<string>): string[] {
    const models = isRecord(geometry) ? geometry['minecraft:geometry'] : null
    const model = Array.isArray(models) ? models[0] : null
    const bones = isRecord(model) && Array.isArray(model.bones) ? model.bones : []
    return bones.map((bone: unknown) => {
        if (!isRecord(bone)) return ''
        const name = String(bone.name ?? '')
        const parent = typeof bone.parent === 'string' ? bone.parent : ''
        return rigGroups.has(parent) && bone[RIG_PARTS_KEY] === true ? parent : name
    })
}

const PLAYER_PARENTS: Readonly<Record<string, string>> = Object.freeze({
    root: 'root',
    head: 'head',
    helmet: 'hat',
    body: 'body',
    rightarm: 'rightArm',
    leftarm: 'leftArm',
    rightleg: 'rightLeg',
    leftleg: 'leftLeg',
})

interface SortedBone {
    name: string
    parent: number | null
    parentName: string | null
    content: boolean
}

function playerParent(name: string | null): string | null {
    return name === null ? null : PLAYER_PARENTS[name.replace(/_/g, '').toLowerCase()] ?? null
}

function sortBones(raw: Record<string, any>[]): SortedBone[] {
    const nameOf = (bone: Record<string, any>) => typeof bone.name === 'string' ? bone.name : ''
    const parentOf = (bone: Record<string, any>) => typeof bone.parent === 'string' ? bone.parent : null
    const index = new Map<string, number>()
    raw.forEach((bone, i) => index.set(nameOf(bone), i))
    const placed: Array<number | null> = raw.map(() => null)
    const order: number[] = []
    while (order.length < raw.length) {
        const before = order.length
        raw.forEach((bone, i) => {
            if (placed[i] !== null) return
            const parent = parentOf(bone)
            const at = parent === null ? undefined : index.get(parent)
            if (at === undefined || placed[at] !== null) {
                placed[i] = order.length
                order.push(i)
            }
        })
        if (order.length === before) return []
    }
    return order.map((i) => {
        const bone = raw[i]
        const parentName = parentOf(bone)
        const at = parentName === null ? undefined : index.get(parentName)
        const parent = at === undefined ? null : placed[at]
        const content = (Array.isArray(bone.cubes) && bone.cubes.length > 0) || (isRecord(bone.locators) && Object.keys(bone.locators).length > 0)
        return { name: nameOf(bone), parent, parentName: parent === null ? parentName : null, content }
    })
}

export function propBoneNames(geometry: unknown): string[] {
    const models = isRecord(geometry) ? geometry['minecraft:geometry'] : null
    const model = Array.isArray(models) ? models[0] : null
    const raw: Record<string, any>[] = isRecord(model) && Array.isArray(model.bones) ? model.bones.filter(isRecord) : []
    const bones = sortBones(raw)
    const has = bones.map((bone) => bone.content)
    for (let i = bones.length - 1; i >= 0; i--) {
        const parent = bones[i].parent
        if (parent !== null && has[i]) has[parent] = true
    }
    const roots = new Set<number>()
    bones.forEach((bone, i) => {
        const parent = bone.parentName ?? (bone.parent === null ? null : bones[bone.parent].name)
        if (has[i] && playerParent(parent) !== null) roots.add(i)
    })
    if (roots.size === 0) {
        const top = bones.findIndex((bone) => bone.parent === null && bone.parentName === null)
        const first = top >= 0 ? top : bones.length > 0 ? 0 : -1
        if (first < 0 || !has[first]) return []
        roots.add(first)
    }
    const kept: boolean[] = []
    const out: string[] = []
    bones.forEach((bone, i) => {
        kept[i] = roots.has(i) || (bone.parent !== null && kept[bone.parent])
        if (kept[i]) out.push(bone.name)
    })
    return out
}

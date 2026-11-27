import { affineAt, Affine, mirrored, multiply } from './livePose'

export interface RigRest {
    rest: Map<Group, any>
    root: any
    rootInverse: any
    holder: any
}

export interface RigNode {
    name: string
    object: any
    parent: RigNode | null
    rest: any
}

export function three(): any {
    return (globalThis as any).THREE ?? null
}

export function groupsInOrder(): Group[] {
    const out: Group[] = []
    const walk = (nodes: any[]) => {
        for (const node of nodes) {
            if (!(node instanceof Group)) continue
            out.push(node)
            walk(node.children ?? [])
        }
    }
    walk((Outliner as any).root ?? [])
    return out
}

export function matrixOf(affine: ArrayLike<number>): any {
    const T = three()
    return new T.Matrix4().set(
        affine[0], affine[1], affine[2], affine[3],
        affine[4], affine[5], affine[6], affine[7],
        affine[8], affine[9], affine[10], affine[11],
        0, 0, 0, 1,
    )
}

export function showDefaultPose() {
    try {
        ;(Animator as any).showDefaultPose?.()
    } catch (error) {
        console.error('[polyplus_nameplate] resetting the pose failed', error)
    }
}

export function captureRest(): RigRest {
    const T = three()
    showDefaultPose()
    const groups = groupsInOrder()
    const top = groups.find((group) => !(group.parent instanceof Group))
    const holder = (top as any)?.mesh?.parent ?? (Project as any)?.model_3d ?? null
    holder?.updateMatrixWorld?.(true)
    const root = holder?.matrixWorld?.clone?.() ?? new T.Matrix4()
    const rest = new Map<Group, any>()
    for (const group of groupsInOrder()) {
        const mesh = (group as any).mesh
        if (mesh?.matrixWorld) rest.set(group, mesh.matrixWorld.clone())
    }
    return { rest, root, rootInverse: root.clone().invert(), holder }
}

export function groupNodes(rig: RigRest, objectOf: (group: Group) => any = (group) => (group as any).mesh): RigNode[] {
    const nodes = new Map<Group, RigNode>()
    const out: RigNode[] = []
    for (const group of groupsInOrder()) {
        const object = objectOf(group)
        const rest = rig.rest.get(group)
        if (!object || !rest) continue
        const parent = group.parent instanceof Group ? nodes.get(group.parent) ?? null : null
        const node = { name: group.name, object, parent, rest }
        nodes.set(group, node)
        out.push(node)
    }
    return out
}

export function copyRig(rig: RigRest, name: string): { copies: any, objectOf: (group: Group) => any } {
    const T = three()
    const copies = new T.Group()
    copies.name = name
    const map = new Map<any, any>()
    for (const group of Group.all) {
        if (group.parent instanceof Group) continue
        const mesh = (group as any).mesh
        if (!mesh) continue
        const copy = mesh.clone(true)
        const from: any[] = []
        const to: any[] = []
        mesh.traverse((object: any) => from.push(object))
        copy.traverse((object: any) => to.push(object))
        from.forEach((object, i) => map.set(object, to[i]))
        copies.add(copy)
    }
    rig.holder?.add?.(copies)
    copies.updateMatrixWorld(true)
    return { copies, objectOf: (group) => map.get((group as any).mesh) ?? null }
}

const MIN_LENGTH = 0.25
const FADE_SECONDS = 0.25

export function animationsLength(names: readonly string[]): number {
    let longest = 0
    for (const name of names) {
        const animation: any = typeof Animator !== 'undefined' ? Animator.animations.find((item) => item.name === name) : null
        const length = Number(animation?.length) || 0
        longest = Math.max(longest, animation?.loop === 'loop' ? length : length + FADE_SECONDS)
    }
    return Math.max(MIN_LENGTH, longest)
}

export function toBlockbench(rig: RigRest, local: ArrayLike<number>): any {
    return rig.root.clone().multiply(matrixOf(mirrored(local))).multiply(rig.rootInverse)
}

export function deformsOf(rig: RigRest, bones: ArrayLike<number>, targets: readonly string[], before: Affine | null = null): Map<string, any> {
    const deform = new Map<string, any>()
    targets.forEach((name, index) => {
        if (!name || deform.has(name)) return
        const raw = affineAt(bones, index)
        deform.set(name, toBlockbench(rig, before ? multiply(before, raw) : raw))
    })
    return deform
}

export function poseNodes(nodes: readonly RigNode[], deform: ReadonlyMap<string, any>, place: any = null) {
    const T = three()
    const posed = new Map<RigNode, any>()
    for (const node of nodes) {
        const parentPosed = node.parent ? posed.get(node.parent) : null
        let world: any
        const own = deform.get(node.name)
        if (own) world = own.clone().multiply(node.rest)
        else if (node.parent && parentPosed) world = parentPosed.clone().multiply(node.parent.rest.clone().invert()).multiply(node.rest)
        else if (place) world = place.clone().multiply(node.rest)
        else world = node.rest.clone()
        const base = parentPosed ?? node.object.parent?.matrixWorld ?? new T.Matrix4()
        const local = base.clone().invert().multiply(world)
        local.decompose(node.object.position, node.object.quaternion, node.object.scale)
        posed.set(node, world)
    }
    for (const node of nodes) if (!node.parent) node.object.updateMatrixWorld?.(true)
}

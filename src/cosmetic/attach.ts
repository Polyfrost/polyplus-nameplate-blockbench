import { loadCosmetic } from '../engine'
import { FORMAT, MANIFEST } from './bundle'
import { PLAYER_BONES } from './data'

export const TAIL_BONE = 'tail'

export const PLAYER_BONE_LABELS: Record<string, string> = {
    body: 'Body',
    head: 'Head',
    hat: 'Hat',
    rightArm: 'Right arm',
    leftArm: 'Left arm',
    rightLeg: 'Right leg',
    leftLeg: 'Left leg',
    [TAIL_BONE]: 'Tail',
}

const UNKNOWN = new Set(['attach_bone_unknown', 'rig_unknown', 'attach_invalid'])

export function engineKnowsBone(rig: string, bone: string): boolean {
    const manifest = { format: FORMAT, kind: 'item', id: 'attach_check', requires: [], attach: { rig, bone } }
    const load = loadCosmetic({ [MANIFEST]: JSON.stringify(manifest) }, {})
    return !!load && !load.issues.some((issue) => UNKNOWN.has(issue.code ?? ''))
}

export function playerAttachBones(): string[] {
    const bones: string[] = [...PLAYER_BONES]
    if (engineKnowsBone('player', TAIL_BONE)) bones.push(TAIL_BONE)
    return bones
}

export function playerBoneOptions(current: string): Record<string, string> {
    const out: Record<string, string> = { '': 'Set by the model' }
    for (const bone of playerAttachBones()) out[bone] = PLAYER_BONE_LABELS[bone] ?? bone
    if (current && !(current in out)) out[current] = current
    return out
}

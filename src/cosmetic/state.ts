import { cloneJson } from '../util/json'
import { hasProject } from '../util/project'
import { defineProjectState } from '../util/projectState'
import { CosmeticData, CosmeticKind, defaultCosmetic, kindOfFormat, normalizeCosmetic } from './data'
import { projectTargets, referenceSignature, resolveReferences, stampReferences } from './references'

export const COSMETIC_PROPERTY = 'polyplus_cosmetic'

export function activeKind(): CosmeticKind | null {
    return typeof Format !== 'undefined' && Format ? kindOfFormat(Format.id) : null
}

export function isCosmeticActive(): boolean {
    return activeKind() !== null
}

export const cosmeticState = defineProjectState<CosmeticData>({
    property: COSMETIC_PROPERTY,
    aspect: COSMETIC_PROPERTY,
    listenerFailure: 'a cosmetic listener failed',
    empty: () => defaultCosmetic(activeKind() ?? 'item'),
    parse: (raw) => resolveReferences(normalizeCosmetic(raw, activeKind() ?? undefined), projectTargets()),
    serialize: (state) => stampReferences(cloneJson(state), projectTargets()),
})

export function readCosmetic(): CosmeticData {
    return cosmeticState.read()
}

export function commitCosmetic(label: string, change: (data: CosmeticData) => void | false, aspects: Record<string, unknown> = {}): boolean {
    return cosmeticState.commit(label, change, { compare: true, aspects })
}

export function seedReferences(): boolean {
    if (!isCosmeticActive() || !hasProject()) return false
    const targets = projectTargets()
    if (!targets) return false
    const stored = normalizeCosmetic((Project as any)[COSMETIC_PROPERTY], activeKind() ?? undefined)
    const stamped = stampReferences(resolveReferences(normalizeCosmetic(cloneJson(stored)), targets), targets)
    if (referenceSignature(stamped) === referenceSignature(stored)) return false
    cosmeticState.write(readCosmetic())
    return true
}

import type { LayerKind } from '../design/layer'
import type { SectionPlan, SectionRule } from './sections'

export type { LayerKind }
export type InspectorView = 'none' | 'plate' | 'name' | 'badge' | 'layer'

export interface ViewInput {
    hasProject: boolean
    pinned: 'name' | 'badge' | null
    layerKind: LayerKind | null
}

export interface ViewChoice {
    view: InspectorView
    kind: LayerKind | null
}

export function chooseView(input: ViewInput): ViewChoice {
    if (!input.hasProject) return { view: 'none', kind: null }
    if (input.pinned) return { view: input.pinned, kind: null }
    if (input.layerKind) return { view: 'layer', kind: input.layerKind }
    return { view: 'plate', kind: null }
}

const PLACEMENT: SectionRule = { id: 'placement', title: 'Placement and clipping' }

const COMMON: Record<string, SectionRule> = {
    placement_title: PLACEMENT,
    animation_title: PLACEMENT,
}

const PICTURE_PLAN: SectionPlan = {
    lead: { id: 'picture', title: 'Picture' },
    headings: { ...COMMON, picture_title: { id: 'picture', title: 'Picture' } },
    order: [],
}

export const SECTION_PLANS: Record<LayerKind, SectionPlan> = {
    body: {
        lead: { id: 'shape', title: 'Shape and corners' },
        headings: {
            ...COMMON,
            shape: { id: 'shape', title: 'Shape and corners' },
            fill_title: { id: 'fill', title: 'Fill' },
            outline_title: { id: 'rings', title: 'Outlines' },
            art_title: { id: 'picture', title: 'Body picture' },
        },
        order: ['shape', 'fill', 'rings', 'placement', 'picture'],
    },
    sprite: PICTURE_PLAN,
    path: PICTURE_PLAN,
    emitter: {
        lead: { id: 'start', title: 'Start' },
        headings: { ...COMMON },
        order: [],
    },
    effect: {
        lead: { id: 'effect', title: 'Graph' },
        headings: { ...COMMON, effect_title: { id: 'effect', title: 'Graph' } },
        order: [],
    },
    group: {
        lead: { id: 'gw', title: 'Name width' },
        headings: { ...COMMON },
        order: [],
    },
}

export const FLAG_SECTION = 'fill'

export function wantsFlagEditor(result: Record<string, any>): boolean {
    if (result?.fill_kind === 'flag') return true
    for (let index = 0; result && `ring_${index}` in result; index++) {
        if (result[`ring_${index}`] === 'flag') return true
    }
    return false
}

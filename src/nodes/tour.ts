import { rememberFlag } from '../util/seenFlag'

export interface TourStep {
    title: string
    text: string
    focus: 'canvas' | 'add' | 'side' | 'status'
}

const TOUR_KEY = 'polyplus_nameplate.node_editor_tour'

export const TOUR_STEPS: TourStep[] = [
    {
        title: 'An effect is a chain of nodes',
        text: 'Each box is a node that does one small job. Its result flows along the lines to the next node, left to right. The Output node on the right is what gets painted.',
        focus: 'canvas',
    },
    {
        title: 'Add a node',
        text: 'Click Add node, press Shift+A, or right-click empty space. Type what you want, such as "noise" or "color", pick with the arrow keys and press Enter.',
        focus: 'add',
    },
    {
        title: 'Link two nodes',
        text: 'Drag from the dot on the right of a node to a dot on the left of another. The dot color shows what kind of value it carries. Right-click a line to remove it.',
        focus: 'canvas',
    },
    {
        title: 'Change a node',
        text: 'Click a node. Its settings and values show on the right, under the preview. Click empty space to change the whole effect instead.',
        focus: 'side',
    },
    {
        title: 'Problems and cost',
        text: 'Problems are listed at the bottom right: click one to jump to its node. The bar at the bottom shows the cost, which has to stay under the limit.',
        focus: 'status',
    },
]

export const { seen: tourSeen, mark: markTourSeen } = rememberFlag(TOUR_KEY, 'node editor tour')

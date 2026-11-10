import { GROUPS, NODE_SPECS, NodeSpec } from './catalog'
import { canAdd, MaterialJson } from './graph'

export interface AddItem {
    type: string
    label: string
    help: string
    disabled: boolean
    index: number
}

interface AddGroup {
    id: string
    label: string
    icon: string
    help: string
    items: AddItem[]
}

const EXTRA_WORDS: Record<string, string> = {
    add: 'plus sum +',
    sub: 'minus take away -',
    mul: 'times multiply scale *',
    div: 'divide over /',
    mod: 'modulo remainder repeat loop',
    min: 'smaller cap limit',
    max: 'larger limit',
    clamp: 'limit range keep between',
    mix: 'lerp blend fade between',
    step: 'threshold cut',
    smoothstep: 'threshold soft edge fade',
    abs: 'absolute positive',
    floor: 'round down whole',
    frac: 'fraction decimal fract',
    sin: 'sine wave wobble',
    cos: 'cosine wave wobble',
    atan2: 'angle direction rotate spin',
    pow: 'power exponent',
    length: 'distance size circle',
    dot: 'dot product',
    polar: 'angle distance circle radial',
    exp: 'exponent grow',
    Combine: 'vector make build join',
    Component: 'split part swizzle x y z w',
    Select: 'choose if else condition switch',
    Constant: 'number value constant fixed',
    Param: 'slider param parameter control',
    Expr: 'molang expression formula',
    Slot: 'palette color swatch',
    PixelPos: 'position where coordinate',
    PixelCell: 'position where coordinate grid',
    TagUV: 'uv position across',
    AreaSize: 'size width height',
    BodyRect: 'box background rectangle',
    BodyEdge: 'distance edge border outline rim glow rounded shape',
    Frame: 'time animation frame',
    SteppedTime: 'time seconds animation',
    Noise: 'noise random cloud smooth',
    Fbm: 'fbm octaves noise cloud detail',
    Hash: 'hash random static sparkle',
    Bayer: 'dither bayer',
    Checker: 'checker checks squares grid',
    Stripes: 'stripes lines bands',
    Gradient: 'gradient ramp fade',
    Hsv: 'hsv hue rainbow color',
    Quantize: 'quantize palette shade',
    DitherQuantize: 'dither quantize palette shade',
    Cycle: 'cycle palette shade animate',
    Lighten: 'lighten brighter white color',
    Darken: 'darken darker black shadow color',
    Alpha: 'fade opacity alpha transparent see-through',
    SampleAt: 'sample offset shift outline shadow look',
    Repeat: 'repeat loop many particles',
    RepeatIndex: 'repeat index pass',
    Sprite: 'sprite picture pixels',
    BundleTexture: 'texture image picture png',
    VanillaTexture: 'texture minecraft vanilla end portal glint',
    AtlasSprite: 'block texture minecraft',
    Output: 'output end result final',
}

function words(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9+\-*/]+/).filter(Boolean)
}

function wordScore(word: string, spec: NodeSpec, groupLabel: string): number {
    const label = spec.label.toLowerCase()
    if (label === word) return 0
    if (label.startsWith(word)) return 1
    if (words(label).some((part) => part.startsWith(word))) return 2
    if (label.includes(word)) return 3
    if (spec.type.toLowerCase().startsWith(word)) return 3
    if (words(EXTRA_WORDS[spec.type] ?? '').some((part) => part.startsWith(word))) return 4
    if (groupLabel.toLowerCase().startsWith(word)) return 5
    if (spec.help.toLowerCase().includes(word)) return 6
    return -1
}

function matchScore(query: string, spec: NodeSpec, groupLabel = ''): number {
    const parts = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!parts.length) return 0
    let total = 0
    for (const part of parts) {
        const score = wordScore(part, spec, groupLabel)
        if (score < 0) return -1
        total += score
    }
    return total
}

export function searchNodes(graph: MaterialJson, query: string): AddGroup[] {
    const searching = query.trim().length > 0
    const groups: AddGroup[] = []
    for (const group of GROUPS) {
        const matches = NODE_SPECS
            .map((spec, order) => ({ spec, order, score: spec.group === group.id ? matchScore(query, spec, group.label) : -1 }))
            .filter((entry) => entry.score >= 0)
        if (searching) matches.sort((a, b) => a.score - b.score || a.order - b.order)
        if (!matches.length) continue
        groups.push({
            id: group.id,
            label: group.label,
            icon: group.icon,
            help: group.help,
            items: matches.map(({ spec }) => ({ type: spec.type, label: spec.label, help: spec.help, disabled: !canAdd(graph, spec.type), index: -1 })),
        })
    }
    if (searching) {
        const best = (group: AddGroup) => Math.min(...group.items.map((item) => matchScore(query, NODE_SPECS.find((spec) => spec.type === item.type)!, group.label)))
        const order = new Map<string, number>(GROUPS.map((group, i) => [group.id, i]))
        groups.sort((a, b) => best(a) - best(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }
    let index = 0
    for (const group of groups) for (const item of group.items) if (!item.disabled) item.index = index++
    return groups
}

export function addableCount(groups: AddGroup[]): number {
    let count = 0
    for (const group of groups) for (const item of group.items) if (!item.disabled) count++
    return count
}

export function addableAt(groups: AddGroup[], index: number): AddItem | null {
    for (const group of groups) for (const item of group.items) if (!item.disabled && item.index === index) return item
    return null
}

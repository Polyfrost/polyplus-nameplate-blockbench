export interface MolangName {
    id: string
    about: string
    arguments?: string[]
}

export function labelFor(name: MolangName): string {
    const call = name.arguments ? `${name.id}( ${name.arguments.join(', ')} )` : name.id
    return `${call}  -  ${name.about}`
}

export const NAMEPLATE_QUERIES: MolangName[] = [
    { id: 'frame', about: 'frame of the loop, 0 to loop - 1' },
    { id: 'loop', about: 'loop length in frames' },
    { id: 'fps', about: 'frames per second' },
    { id: 'width', about: 'width of the tag in px' },
    { id: 'height', about: 'height of the tag in px (8 for one line)' },
    { id: 'line_count', about: 'number of text lines' },
    { id: 'name_x', about: 'x where the name starts' },
    { id: 'name_y', about: 'y of the top of the name line' },
    { id: 'name_width', about: 'width of the name in px' },
    { id: 'prefix_width', about: 'width of the rank prefix in px' },
    { id: 'bg_x0', about: 'left edge of the background' },
    { id: 'bg_y0', about: 'top edge of the background' },
    { id: 'bg_x1', about: 'right edge of the background' },
    { id: 'bg_y1', about: 'bottom edge of the background' },
    { id: 'variant_param', about: 'a number set per variant', arguments: ["'name'"] },
]

export const FIELD_QUERIES = ['x', 'y']
export const TEXT_QUERIES = ['glyph_index', 'glyph_count', 'glyph_x', 'glyph_width']

export const NAMEPLATE_FUNCTIONS: MolangName[] = [
    { id: 'sin', about: 'sine, angle in degrees', arguments: ['degrees'] },
    { id: 'cos', about: 'cosine, angle in degrees', arguments: ['degrees'] },
    { id: 'atan2', about: 'angle of y, x in degrees', arguments: ['y', 'x'] },
    { id: 'abs', about: 'drop the minus sign', arguments: ['value'] },
    { id: 'min', about: 'smaller of two', arguments: ['a', 'b'] },
    { id: 'max', about: 'larger of two', arguments: ['a', 'b'] },
    { id: 'clamp', about: 'keep value between min and max', arguments: ['value', 'min', 'max'] },
    { id: 'lerp', about: 'blend from start to end by 0 to 1', arguments: ['start', 'end', 'amount'] },
    { id: 'pow', about: 'base to the power', arguments: ['base', 'exponent'] },
    { id: 'sqrt', about: 'square root', arguments: ['value'] },
    { id: 'floor', about: 'round down', arguments: ['value'] },
    { id: 'ceil', about: 'round up', arguments: ['value'] },
    { id: 'round', about: 'round to nearest', arguments: ['value'] },
    { id: 'frac', about: 'part after the point', arguments: ['value'] },
    { id: 'sign', about: '-1, 0 or 1', arguments: ['value'] },
    { id: 'mod', about: 'remainder (keeps the sign)', arguments: ['value', 'by'] },
    { id: 'floor_mod', about: 'remainder, never negative', arguments: ['value', 'by'] },
    { id: 'step', about: '1 once value reaches edge, else 0', arguments: ['edge', 'value'] },
    { id: 'smoothstep', about: 'smooth 0 to 1 between two edges', arguments: ['from', 'to', 'value'] },
    { id: 'hash', about: 'repeatable random 0 to 1', arguments: ['x', 'y', 'seed'] },
    { id: 'noise', about: 'smooth random 0 to 1', arguments: ['x', 'y', 'seed?'] },
    { id: 'fbm', about: 'layered smooth random', arguments: ['x', 'y', 'octaves', 'seed?'] },
    { id: 'bayer', about: 'dither threshold 0 to 1', arguments: ['x', 'y'] },
    { id: 'hsv', about: 'color from hue (degrees), saturation and value (0 to 1)', arguments: ['hue', 'saturation', 'value'] },
]

export type KeyChannel = 'frame' | 'position' | 'opacity' | 'visible'

export interface KeyPreset {
    name: string
    about: string
    channel: KeyChannel
    axis?: 'x' | 'y'
    source: string
}

export const KEY_PRESETS: KeyPreset[] = [
    { name: 'Breathe', about: 'fades out and back in once per loop', channel: 'opacity', source: '0.5 + 0.5 * math.sin(q.frame * 360 / q.loop)' },
    { name: 'Soft glow', about: 'stays between 60% and 100%', channel: 'opacity', source: '0.8 + 0.2 * math.sin(q.frame * 360 / q.loop)' },
    { name: 'Twinkle', about: 'random brightness, a new one every 5 frames', channel: 'opacity', source: '0.6 + 0.4 * math.hash(math.floor(q.frame / 5), 0, 7)' },
    { name: 'Bob', about: 'moves 1 px up and down once per loop', channel: 'position', axis: 'y', source: 'math.sin(q.frame * 360 / q.loop)' },
    { name: 'Sway', about: 'moves 2 px left and right once per loop', channel: 'position', axis: 'x', source: '2 * math.sin(q.frame * 360 / q.loop)' },
    { name: 'Bob per variant', about: "bobs by a shared number, so each variant can bob more or less. Add one named 'bob' under Shared numbers first", channel: 'position', axis: 'y', source: "q.variant_param('bob') * math.sin(q.frame * 360 / q.loop)" },
    { name: 'Walk along the name', about: 'crosses the name once per loop', channel: 'position', axis: 'x', source: 'math.floor(q.frame * q.name_width / q.loop)' },
    { name: 'Cycle sprite frames', about: 'shows frames 0, 1, 2, 3 and repeats', channel: 'frame', source: 'math.mod(q.frame, 4)' },
    { name: 'Blink', about: 'hidden for the last 2 frames of the loop', channel: 'visible', source: 'q.frame < q.loop - 2' },
    { name: 'Long names only', about: 'shows only when the name is wider than 40 px', channel: 'visible', source: 'q.name_width > 40' },
]

export interface SlotPreset {
    name: string
    about: string
    template: string
}

export const SLOT_PRESETS: SlotPreset[] = [
    { name: 'Rainbow', about: 'hue goes all the way round once per loop', template: 'math.hsv({h} + q.frame * 360 / q.loop, {s}, {v})' },
    { name: 'Pulse', about: 'gets a little darker and back once per loop', template: 'math.hsv({h}, {s}, {v} * (0.85 + 0.15 * math.sin(q.frame * 360 / q.loop)))' },
    { name: 'Shimmer', about: 'hue wobbles a little either side', template: 'math.hsv({h} + 20 * math.sin(q.frame * 360 / q.loop), {s}, {v})' },
    { name: 'Fade to white', about: 'washes out and back once per loop', template: 'math.hsv({h}, {s} * (0.5 + 0.5 * math.cos(q.frame * 360 / q.loop)), {v})' },
]

export const KEY_MOLANG_HELP = 'A number or a formula. Type q. or math. to see what you can use.'

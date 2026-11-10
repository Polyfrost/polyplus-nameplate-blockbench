export type SocketType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'slot'
export type Accepts = 'number' | 'float' | 'vec2' | 'color' | 'surface' | 'any'

export type Fallback =
    | { kind: 'required' }
    | { kind: 'absent' }
    | { kind: 'value', values: number[] }
    | { kind: 'input', type: string }

export interface SocketSpec {
    name: string
    accepts: Accepts
    fallback: Fallback
    label: string
}

export type SettingSpec =
    | { key: string, label: string, kind: 'int', min: number, max: number, fallback: number, required?: boolean, help?: string }
    | { key: string, label: string, kind: 'pair', min: number, max: number, fallback: [number, number], help?: string }
    | { key: string, label: string, kind: 'choice', options: Record<string, string>, fallback: string, help?: string }
    | { key: string, label: string, kind: 'slot', tones: boolean, help?: string }
    | { key: string, label: string, kind: 'text', required: boolean, placeholder?: string, help?: string }
    | { key: string, label: string, kind: 'param', help?: string }
    | { key: string, label: string, kind: 'values', fallback: number[], help?: string }
    | { key: string, label: string, kind: 'sprite', help?: string }
    | { key: string, label: string, kind: 'texture', help?: string }

type GroupId = 'inputs' | 'maths' | 'pattern' | 'color' | 'structure' | 'textures' | 'output'

export const GROUPS: Array<{ id: GroupId, label: string, icon: string, help: string }> = [
    { id: 'inputs', label: 'Inputs', icon: 'input', help: 'Where the pixel is, the time, palette colors and sliders' },
    { id: 'maths', label: 'Math', icon: 'functions', help: 'Work numbers out: add, blend, limit, round' },
    { id: 'pattern', label: 'Pattern', icon: 'texture', help: 'Noise, stripes, checks and gradients' },
    { id: 'color', label: 'Color', icon: 'palette', help: 'Make, shade and fade colors' },
    { id: 'structure', label: 'Structure', icon: 'account_tree', help: 'Reuse part of the effect: shifted, repeated, or a sprite' },
    { id: 'textures', label: 'Textures', icon: 'image', help: 'Read a picture' },
    { id: 'output', label: 'Output', icon: 'output', help: 'The end of the effect: what gets painted' },
]

type TypingRule =
    | { kind: 'constant', output: SocketType }
    | { kind: 'values' }
    | { kind: 'fixed', output: SocketType }
    | { kind: 'elementwise' }
    | { kind: 'reduce' }
    | { kind: 'combine' }
    | { kind: 'component' }
    | { kind: 'select' }
    | { kind: 'sample' }
    | { kind: 'repeat' }

type CostRule = 'flat' | 'width' | 'inputs' | 'octaves'

export interface NodeSpec {
    type: string
    group: GroupId
    label: string
    help: string
    sockets: SocketSpec[]
    settings: SettingSpec[]
    typing: TypingRule
    cost: CostRule
    samples?: number
    source?: 'sample' | 'repeat'
    single?: boolean
}

export const SOURCE_SOCKET = '~source'

export const VANILLA_TEXTURES: Record<string, string> = {
    end_sky: 'End sky',
    end_portal: 'End portal',
    glint: 'Enchantment glint',
    beacon_beam: 'Beacon beam',
    creeper_armor: 'Charged creeper',
    breeze_wind: 'Breeze wind',
}

const LABELS: Record<string, string> = {
    a: 'Value',
    b: 'Other value',
    x: 'Value',
    y: 'Y',
    z: 'Z',
    w: 'W',
    v: 'Vector',
    p: 'Position',
    t: 'Blend',
    h: 'Hue',
    s: 'Saturation',
    uv: 'Position',
    at: 'Position',
    to: 'To',
    from: 'From',
    min: 'Lowest',
    max: 'Highest',
    edge: 'Edge',
    edge0: 'Start',
    edge1: 'End',
    level: 'Level',
    index: 'Shade',
    shift: 'Moves by',
    amount: 'Amount',
    alpha: 'Opacity',
    color: 'Color',
    coverage: 'Visible',
    frame: 'Frame',
    offset: 'Shift by',
    frameOffset: 'Frame shift',
    condition: 'Condition',
}

const REQUIRED: Fallback = { kind: 'required' }

function socket(name: string, accepts: Accepts, fallback: Fallback = REQUIRED, label?: string): SocketSpec {
    return { name, accepts, fallback, label: label ?? LABELS[name] ?? name }
}

type Named = string | [string, string]

function named(entry: Named): SocketSpec {
    return Array.isArray(entry) ? socket(entry[0], 'number', REQUIRED, entry[1]) : socket(entry, 'number')
}

function value(...values: number[]): Fallback {
    return { kind: 'value', values }
}

function input(type: string): Fallback {
    return { kind: 'input', type }
}

const ABSENT: Fallback = { kind: 'absent' }

function node(spec: Partial<NodeSpec> & Pick<NodeSpec, 'type' | 'group' | 'label' | 'help' | 'typing'>): NodeSpec {
    return { sockets: [], settings: [], cost: 'flat', ...spec }
}

function env(type: string, label: string, output: SocketType, help: string, group: GroupId = 'inputs'): NodeSpec {
    return node({ type, group, label, help, typing: { kind: 'constant', output } })
}

function unary(type: string, label: string, help: string, input = 'Value'): NodeSpec {
    return elementwise(type, label, [['x', input]], help)
}

function elementwise(type: string, label: string, names: Named[], help: string): NodeSpec {
    return node({ type, group: 'maths', label, help, sockets: names.map(named), typing: { kind: 'elementwise' }, cost: 'width' })
}

const SEED: SettingSpec = { key: 'seed', label: 'Seed', kind: 'int', min: 0, max: 2147483647, fallback: 0, help: 'Change it to get a different pattern' }
const PERIOD: SettingSpec = {
    key: 'period',
    label: 'Tiles every (x, y)',
    kind: 'pair',
    min: 0,
    max: 65536,
    fallback: [0, 0],
    help: 'Make the noise repeat every this many units so it loops cleanly. 0 means it never repeats',
}

function slotSetting(tones: boolean): SettingSpec {
    return { key: 'slot', label: tones ? 'Color' : 'Palette color', kind: 'slot', tones }
}

export const NODE_SPECS: NodeSpec[] = [
    env('PixelPos', 'Pixel position', 'vec2', 'Where this pixel is, in pixels'),
    env('PixelCell', 'Pixel cell', 'vec2', 'Which pixel this is, as whole numbers'),
    env('TagUV', 'Area position', 'vec2', 'Position across the effect area, from 0 to 1'),
    env('AreaSize', 'Area size', 'vec2', 'Width and height of the effect area in pixels'),
    env('BodyRect', 'Body rectangle', 'vec4', 'Left, top, right and bottom of the background box'),
    node({
        type: 'BodyEdge',
        group: 'inputs',
        label: 'Distance to body edge',
        help: 'Pixels from the edge of the body: below 0 inside, above 0 outside. The preview here shows a plain box',
        settings: [{ key: 'edge', label: 'Measure from', kind: 'choice', options: { fill: 'The fill', outer: 'Past the outlines' }, fallback: 'fill' }],
        typing: { kind: 'constant', output: 'float' },
    }),
    env('Frame', 'Frame', 'float', 'The current frame number'),
    env('SteppedTime', 'Time (seconds)', 'float', 'Time in seconds, stepped to whole frames'),
    env('ScreenPos', 'Screen position', 'vec2', 'Position on screen. Basic effects use Area position'),
    env('PixelScreenPos', 'Pixel screen position', 'vec2', 'Screen position of the pixel center. Basic effects use Area position'),
    node({
        type: 'Slot',
        group: 'inputs',
        label: 'Palette color',
        help: 'A color from the nameplate palette, so colorways recolor it',
        settings: [slotSetting(true)],
        typing: { kind: 'constant', output: 'slot' },
    }),
    node({
        type: 'Constant',
        group: 'inputs',
        label: 'Number',
        help: 'A fixed number, or up to 4 numbers for a vector',
        settings: [{ key: 'value', label: 'Value', kind: 'values', fallback: [0], help: 'One number, or up to 4 separated by commas' }],
        typing: { kind: 'values' },
    }),
    node({
        type: 'Param',
        group: 'inputs',
        label: 'Slider',
        help: 'A named value that shows as a slider on the effect',
        settings: [{ key: 'name', label: 'Slider name', kind: 'param', help: 'Lowercase letters, digits and _' }],
        typing: { kind: 'constant', output: 'float' },
    }),
    node({
        type: 'Expr',
        group: 'inputs',
        label: 'Formula value',
        help: 'A formula worked out once per frame',
        settings: [{ key: 'expr', label: 'Formula', kind: 'text', required: true, placeholder: 'math.sin(q.frame * 30)' }],
        typing: { kind: 'constant', output: 'float' },
    }),

    elementwise('add', 'Add', ['a', ['b', 'Plus']], 'Value plus another value'),
    elementwise('sub', 'Subtract', ['a', ['b', 'Minus']], 'Value minus another value'),
    elementwise('mul', 'Multiply', ['a', ['b', 'Times']], 'Value times another value'),
    elementwise('div', 'Divide', ['a', ['b', 'Divided by']], 'Value divided by another value (0 when dividing by 0)'),
    elementwise('mod', 'Wrap', ['a', ['b', 'Wrap at']], 'Value wrapped back into 0 to Wrap at, like a clock'),
    elementwise('min', 'Smaller of two', ['a', ['b', 'At most']], 'The smaller of the two, so Value never goes over At most'),
    elementwise('max', 'Larger of two', ['a', ['b', 'At least']], 'The larger of the two, so Value never goes under At least'),
    elementwise('clamp', 'Keep in range', ['x', 'min', 'max'], 'Keeps Value between Lowest and Highest'),
    elementwise('mix', 'Blend', [['a', 'From'], ['b', 'To'], 't'], 'Blends from From to To by Blend (0 gives From, 1 gives To)'),
    elementwise('step', 'Hard edge', ['edge', 'x'], '0 while Value is below Edge, 1 from Edge up'),
    elementwise('smoothstep', 'Soft edge', ['edge0', 'edge1', 'x'], 'Goes smoothly from 0 to 1 as Value moves from Start to End'),
    unary('abs', 'Absolute', 'Drops the minus sign'),
    unary('floor', 'Round down', 'Rounds down to a whole number'),
    unary('frac', 'Fraction', 'The part after the decimal point'),
    unary('sin', 'Sine', 'A wave from -1 to 1. One full wave is 6.28', 'Angle'),
    unary('cos', 'Cosine', 'A wave from -1 to 1, a quarter turn after Sine. One full wave is 6.28', 'Angle'),
    elementwise('atan2', 'Angle', [['y', 'Down (y)'], ['x', 'Across (x)']], 'The angle of a direction. A full turn is 6.28'),
    elementwise('pow', 'Power', [['x', 'Base'], ['y', 'Power']], 'Base to the power of Power'),
    node({
        type: 'length',
        group: 'maths',
        label: 'Length',
        help: 'How long a vector is',
        sockets: [socket('v', 'number')],
        typing: { kind: 'reduce' },
        cost: 'inputs',
    }),
    node({
        type: 'dot',
        group: 'maths',
        label: 'Same direction',
        help: 'How much two vectors point the same way',
        sockets: [socket('a', 'number', REQUIRED, 'Vector'), socket('b', 'number', REQUIRED, 'Other vector')],
        typing: { kind: 'reduce' },
        cost: 'inputs',
    }),
    node({
        type: 'polar',
        group: 'maths',
        label: 'Angle and distance',
        help: 'Turns a direction into (angle, distance)',
        sockets: [socket('v', 'vec2', REQUIRED, 'Direction')],
        typing: { kind: 'fixed', output: 'vec2' },
    }),
    unary('exp', 'Exponent', 'Grows faster and faster'),
    node({
        type: 'Combine',
        group: 'maths',
        label: 'Combine',
        help: 'Build a vector from 2 to 4 numbers',
        sockets: [socket('x', 'float', REQUIRED, 'X'), socket('y', 'float'), socket('z', 'float', ABSENT), socket('w', 'float', ABSENT)],
        typing: { kind: 'combine' },
    }),
    node({
        type: 'Component',
        group: 'maths',
        label: 'Split',
        help: 'Take one part (x, y, z or w) of a vector',
        sockets: [socket('v', 'number')],
        settings: [{ key: 'component', label: 'Part', kind: 'choice', options: { x: 'x', y: 'y', z: 'z', w: 'w' }, fallback: 'x' }],
        typing: { kind: 'component' },
    }),
    node({
        type: 'Select',
        group: 'maths',
        label: 'Choose',
        help: 'Gives If above 0 where Condition is above 0, and Otherwise everywhere else',
        sockets: [socket('condition', 'float'), socket('a', 'any', REQUIRED, 'Otherwise'), socket('b', 'any', REQUIRED, 'If above 0')],
        typing: { kind: 'select' },
        cost: 'width',
    }),

    node({
        type: 'Noise',
        group: 'pattern',
        label: 'Noise',
        help: 'Smooth random values from 0 to 1',
        sockets: [socket('p', 'vec2')],
        settings: [SEED, PERIOD],
        typing: { kind: 'fixed', output: 'float' },
    }),
    node({
        type: 'Fbm',
        group: 'pattern',
        label: 'Detailed noise',
        help: 'Layered noise with finer detail',
        sockets: [socket('p', 'vec2')],
        settings: [SEED, PERIOD, { key: 'octaves', label: 'Detail layers', kind: 'int', min: 1, max: 8, fallback: 3, help: 'Each layer costs as much as a Noise node' }],
        typing: { kind: 'fixed', output: 'float' },
        cost: 'octaves',
    }),
    node({
        type: 'Hash',
        group: 'pattern',
        label: 'Random',
        help: 'A random value from 0 to 1 per position, the same on every machine',
        sockets: [socket('p', 'vec2')],
        settings: [SEED],
        typing: { kind: 'fixed', output: 'float' },
    }),
    node({
        type: 'Bayer',
        group: 'pattern',
        label: 'Dither pattern',
        help: 'A dither pattern from 0 to 1',
        sockets: [socket('p', 'vec2', input('PixelCell'))],
        typing: { kind: 'fixed', output: 'float' },
    }),
    node({
        type: 'Checker',
        group: 'pattern',
        label: 'Checker',
        help: 'Alternating 0 and 1 squares',
        sockets: [socket('p', 'vec2', input('PixelCell'))],
        settings: [{ key: 'size', label: 'Square size', kind: 'int', min: 1, max: 256, fallback: 1 }],
        typing: { kind: 'fixed', output: 'float' },
    }),
    node({
        type: 'Stripes',
        group: 'pattern',
        label: 'Stripes',
        help: 'Repeating 1 and 0 bands',
        sockets: [socket('p', 'vec2', input('PixelCell'))],
        settings: [
            { key: 'period', label: 'Repeats every', kind: 'int', min: 1, max: 256, fallback: 2 },
            { key: 'width', label: 'Stripe width', kind: 'int', min: 1, max: 256, fallback: 1 },
            { key: 'direction', label: 'Direction (x, y)', kind: 'pair', min: -16, max: 16, fallback: [1, 0], help: '(1, 0) gives vertical stripes, (1, 1) diagonal ones' },
        ],
        typing: { kind: 'fixed', output: 'float' },
    }),
    node({
        type: 'Gradient',
        group: 'pattern',
        label: 'Gradient',
        help: '0 at From, 1 at To',
        sockets: [socket('p', 'vec2', input('TagUV')), socket('from', 'vec2', value(0, 0)), socket('to', 'vec2', value(1, 0))],
        typing: { kind: 'fixed', output: 'float' },
    }),

    node({
        type: 'Hsv',
        group: 'color',
        label: 'Color from hue',
        help: 'A color from hue, saturation and brightness (each 0 to 1)',
        sockets: [socket('h', 'float'), socket('s', 'float', value(1)), socket('v', 'float', value(1), 'Brightness')],
        typing: { kind: 'fixed', output: 'vec4' },
    }),
    node({
        type: 'Quantize',
        group: 'color',
        label: 'Snap to palette',
        help: 'Picks the palette shade nearest to Level (0 to 1)',
        sockets: [socket('level', 'float')],
        settings: [slotSetting(false)],
        typing: { kind: 'fixed', output: 'slot' },
    }),
    node({
        type: 'DitherQuantize',
        group: 'color',
        label: 'Dithered palette',
        help: 'Like Snap to palette, with a dither between shades',
        sockets: [socket('level', 'float'), socket('p', 'vec2', input('PixelCell'))],
        settings: [slotSetting(false)],
        typing: { kind: 'fixed', output: 'slot' },
    }),
    node({
        type: 'Cycle',
        group: 'color',
        label: 'Palette cycle',
        help: 'Steps through the palette shades over time',
        sockets: [socket('index', 'float'), socket('shift', 'float', input('Frame'))],
        settings: [slotSetting(false)],
        typing: { kind: 'fixed', output: 'slot' },
    }),
    node({
        type: 'Lighten',
        group: 'color',
        label: 'Lighten',
        help: 'Moves a color toward white',
        sockets: [socket('color', 'color'), socket('amount', 'float')],
        typing: { kind: 'fixed', output: 'vec4' },
    }),
    node({
        type: 'Darken',
        group: 'color',
        label: 'Darken',
        help: 'Moves a color toward black',
        sockets: [socket('color', 'color'), socket('amount', 'float')],
        typing: { kind: 'fixed', output: 'vec4' },
    }),
    node({
        type: 'Alpha',
        group: 'color',
        label: 'Fade',
        help: 'Multiplies a color\'s opacity',
        sockets: [socket('color', 'color'), socket('alpha', 'float')],
        typing: { kind: 'fixed', output: 'vec4' },
    }),

    node({
        type: 'SampleAt',
        group: 'structure',
        label: 'Shift',
        help: 'Works out another node as if at a shifted pixel or frame',
        sockets: [socket('offset', 'vec2', value(0, 0)), socket('frameOffset', 'float', value(0))],
        typing: { kind: 'sample' },
        source: 'sample',
    }),
    node({
        type: 'Repeat',
        group: 'structure',
        label: 'Repeat',
        help: 'Works out another node up to 16 times and combines the results',
        settings: [
            { key: 'count', label: 'Times', kind: 'int', min: 1, max: 16, fallback: 1, required: true },
            { key: 'reduce', label: 'Combine by', kind: 'choice', options: { sum: 'Sum', min: 'Smallest', max: 'Largest', first: 'First visible' }, fallback: 'max' },
        ],
        typing: { kind: 'repeat' },
        source: 'repeat',
    }),
    env('RepeatIndex', 'Repeat index', 'float', 'Which pass of the Repeat this is, from 0', 'structure'),
    node({
        type: 'Sprite',
        group: 'structure',
        label: 'Sprite',
        help: 'A nameplate sprite as palette colors, pixel for pixel',
        sockets: [socket('at', 'vec2', input('PixelCell')), socket('frame', 'float', value(0))],
        settings: [{ key: 'sprite', label: 'Sprite', kind: 'sprite' }],
        typing: { kind: 'fixed', output: 'slot' },
    }),

    node({
        type: 'BundleTexture',
        group: 'textures',
        label: 'Texture',
        help: 'Reads a picture packed with the nameplate',
        sockets: [socket('uv', 'vec2', input('TagUV'))],
        settings: [{ key: 'texture', label: 'Texture', kind: 'texture' }],
        typing: { kind: 'fixed', output: 'vec4' },
        samples: 1,
    }),
    node({
        type: 'VanillaTexture',
        group: 'textures',
        label: 'Vanilla texture',
        help: 'Reads one of the allowed Minecraft textures',
        sockets: [socket('uv', 'vec2', input('TagUV'))],
        settings: [{ key: 'texture', label: 'Texture', kind: 'choice', options: VANILLA_TEXTURES, fallback: 'end_sky' }],
        typing: { kind: 'fixed', output: 'vec4' },
        samples: 1,
    }),
    node({
        type: 'AtlasSprite',
        group: 'textures',
        label: 'Block texture',
        help: 'Reads a block texture, animated as in game',
        sockets: [socket('uv', 'vec2', input('TagUV'))],
        settings: [{ key: 'sprite', label: 'Block sprite', kind: 'text', required: true, placeholder: 'minecraft:block/stone' }],
        typing: { kind: 'fixed', output: 'vec4' },
        samples: 1,
    }),

    node({
        type: 'Output',
        group: 'output',
        label: 'Output',
        help: 'The final color of each pixel',
        sockets: [socket('color', 'surface'), socket('coverage', 'float', value(1))],
        settings: [{ key: 'blend', label: 'Blend', kind: 'choice', options: { alpha: 'Normal', additive: 'Add light' }, fallback: 'alpha' }],
        typing: { kind: 'fixed', output: 'float' },
        single: true,
    }),
]

const SPECS: Record<string, NodeSpec> = Object.fromEntries(NODE_SPECS.map((spec) => [spec.type, spec]))

export function specOf(type: string): NodeSpec | null {
    return Object.prototype.hasOwnProperty.call(SPECS, type) ? SPECS[type] : null
}

export const ACCEPTS_LABEL: Record<Accepts, string> = {
    number: 'a number, vector or color',
    float: 'a single number',
    vec2: 'a number or a 2D vector',
    color: 'a color or palette color',
    surface: 'a color or palette color',
    any: 'anything',
}

export const TYPE_LABEL: Record<SocketType, string> = {
    float: 'number',
    vec2: '2D vector',
    vec3: '3D vector',
    vec4: 'color',
    slot: 'palette color',
}

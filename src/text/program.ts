import * as EngineModule from '../../engine/PolyPlus-nameplate-engine.js'
import { labelFor, MolangName, NAMEPLATE_FUNCTIONS, NAMEPLATE_QUERIES } from '../molang/catalog'
import { projectParams } from '../molang/params'
import { molangIssueText } from '../molang/probe'
import { issueName, issueValue } from '../checks/codes'
import { EngineIssue, wrapIssue } from '../engine'
import { readNameplate } from '../palette/state'
import { toneChoices } from '../palette/tones'
import { loopPixels, nameRect } from './backdrop'
import { minRatio } from './contrast'
import { shownPreview, shownVariant, styleOf } from './style'
import { dialogButtons } from '../util/dialogs'
import { ensureStyle, removeStyle } from '../util/style'
import { LETTER_MODE_NAMES, TextMode } from './types'

const api = EngineModule.org.polyfrost.polyplus.nameplate.engine.js

interface Suggestion {
    text: string
    label?: string
    overlap: number
    priority?: number
}

interface LetterExample {
    name: string
    about: string
    source: string
    owned?: boolean
    restless?: boolean
    twoColors?: boolean
}

interface WaveColor {
    ref: string
    slot: string
    name: string
    rgb: number
}

interface LetterContext {
    mode: TextMode
    fps: number
    length: number
    reaction: boolean
}

interface LetterDialogOptions extends LetterContext {
    source: string
    title?: string
    variant?: string
    switchMode?: boolean
    save(source: string | null, mode?: TextMode): void
}

const DIALOG_ID = 'polyplus_nameplate_letter_program'
const STYLE_ID = 'polyplus_nameplate_letter_program_style'
const FORMULA_CLASS = 'np-letter-formula'
const STYLE = `
.${FORMULA_CLASS} { height: auto; align-items: flex-start; }
.${FORMULA_CLASS} > .molang_input { flex: 1 1 0; min-width: 0; height: auto; min-height: 96px; max-height: 240px; overflow-y: auto; }
.${FORMULA_CLASS} > .molang_input pre { height: auto !important; min-height: 92px; white-space: pre-wrap !important; word-break: break-word; }
.${FORMULA_CLASS} > textarea { flex: 1 1 0; min-width: 0; height: 96px; resize: vertical; }
`
const CONTEXT_ID = 'polyplus_nameplate_letters'
const CACHE_LIMIT = 32
const OWNED_ONLY = `only with "${LETTER_MODE_NAMES.owned}"`

const LETTER_QUERIES: MolangName[] = [
    { id: 'glyph_index', about: 'which letter this is, 0 for the first' },
    { id: 'glyph_count', about: 'how many letters the name has' },
    { id: 'glyph_x', about: 'where this letter starts, in px from the start of the name' },
    { id: 'glyph_width', about: 'width of this letter in px' },
]

const LETTER_OUTPUTS: MolangName[] = [
    { id: 'x', about: 'moves the letter right (positive) or left (negative), in px' },
    { id: 'opacity', about: 'fades the letter: 1 is solid (the default), 0 is hidden' },
    { id: 'color', about: `${OWNED_ONLY}: the letter color as a number, -1 keeps its own` },
    { id: 'shadow', about: `${OWNED_ONLY}: shadow color, -1 follows the name settings, -2 turns it off` },
    { id: 'outline', about: `${OWNED_ONLY}: outline color, -1 follows the name settings, -2 turns it off` },
    { id: 'scale', about: `${OWNED_ONLY}: size, 1 is normal, from 0.25 to 3 in steps of 0.25` },
    { id: 'rotation', about: `${OWNED_ONLY}: turns the letter clockwise around its middle, in whole degrees` },
]

const LETTER_EXAMPLES: LetterExample[] = [
    {
        name: 'Wave',
        about: 'Each letter rises and falls a little after the one before it, like a wave running along the name.',
        source: 'math.sin((q.frame / q.loop + q.glyph_index / q.glyph_count) * 360) * 2',
    },
    {
        name: 'Color wave',
        about: 'Blue and green roll along the name like a wave, once per loop. Uses v.color.',
        source: 'v.color = math.hsv(200 + math.sin((q.frame / q.loop + q.glyph_index / q.glyph_count) * 360) * 60, 0.7, 1);\nreturn 0;',
        owned: true,
    },
    {
        name: 'Color wave, my colors',
        about: "Two of your colors roll along the name like a wave, once per loop. Pick them below. Changing those colors later won't update the wave.",
        source: '',
        owned: true,
        twoColors: true,
    },
    {
        name: 'Rainbow',
        about: 'Every letter gets its own color, and the colors run along the name once per loop. Uses v.color.',
        source: 'v.color = math.hsv(q.glyph_index * 360 / q.glyph_count + q.frame * 360 / q.loop, 0.6, 1);\nreturn 0;',
        owned: true,
    },
    {
        name: 'Hop one letter at a time',
        about: 'One letter at a time jumps up by 2 px, moving along the name once per loop.',
        source: 'q.glyph_index == math.floor(q.frame * q.glyph_count / q.loop) ? -2 : 0',
    },
    {
        name: 'Shiver',
        about: 'Every letter jitters by up to 1 px up, down, left and right, differently each frame.',
        source: 'v.x = math.round(math.hash(q.glyph_index, q.frame, 7) * 2 - 1);\nreturn math.round(math.hash(q.glyph_index, q.frame, 11) * 2 - 1);',
    },
    {
        name: 'Sway sideways',
        about: 'The whole name slides 2 px left and right once per loop. Uses v.x.',
        source: 'v.x = math.round(math.sin(q.frame * 360 / q.loop) * 2);\nreturn 0;',
    },
    {
        name: 'Fade in letter by letter',
        about: 'The letters appear one after another, two frames apart, then stay. Uses v.opacity. Good for a one-shot like "appear".',
        source: 'v.opacity = math.clamp(q.frame / 2 - q.glyph_index, 0, 1);\nreturn 0;',
        restless: true,
    },
    {
        name: 'Shake',
        about: 'The letters shake sideways by 1 px. Good for a reaction like getting hurt.',
        source: 'v.x = math.round(math.hash(q.glyph_index, q.frame, 3) * 2 - 1);\nreturn 0;',
    },
    {
        name: 'Bounce',
        about: 'In the first half of the loop each letter in turn grows to 1.5 times its size and back. The second half stays still, so the name stays readable. Uses v.scale.',
        source: 'v.scale = q.frame < q.loop / 2 && q.glyph_index == math.floor(q.frame * 2 * q.glyph_count / q.loop) ? 1.5 : 1;\nreturn 0;',
        owned: true,
    },
    {
        name: 'Wobble',
        about: 'In the first half of the loop the letters tilt back and forth by up to 10 degrees, then sit still. Uses v.rotation.',
        source: 'v.rotation = q.frame < q.loop / 2 ? math.sin(q.frame * 720 / q.loop + q.glyph_index * 40) * 10 : 0;\nreturn 0;',
        owned: true,
    },
]

const MODE_ABOUT: Record<string, string> = {
    motion: 'Runs for every letter, every frame. The result moves the letter up (negative) or down (positive), in px.',
    owned: 'Runs for every letter, every frame. It can move, fade, color, resize and turn each letter. The result moves the letter up (negative) or down (positive), in px.',
    vanilla: `Letters is set to "${LETTER_MODE_NAMES.vanilla}", so the game ignores letter formulas. Pick "${LETTER_MODE_NAMES.motion}" or "${LETTER_MODE_NAMES.owned}" under Letters in the Inspector (click Name text under Layers) first.`,
}

const COMMON_RULES = [
    'Moves are whole pixels, at most 32 px either way.',
    'Only the player\'s name moves. A rank, a team prefix and other lines stay where they are. Names longer than 24 letters stay still.',
    'Players who set Nameplate motion to reduced or off see still letters.',
]

const READABLE_RULE = 'For at least half of the loop, the name has to be easy to read: letters moved by 2 px or less, turned by 15 degrees or less, at least half visible and close to normal size.'

const OWNED_RULES = [
    'A color is a number. Use math.hsv(hue, saturation, value), or a plain number such as 16746496 for #FF8800.',
    'Behind walls these letters still show, dimmed like any name.',
]

const VARIANT_RULE = 'Remove formula leaves this variant with no formula, so its letters stay still. To use the formula of every variant again, set Letter formula to "Same as every variant".'

const REACTION_RULES = [
    'Here q.frame counts from the start of this animation and q.loop is its length. A reaction that lasts while the player does something uses the loop\'s frames.',
    'When several animations move the letters at once, the newest one-shot wins, then the first active reaction, then the nameplate\'s own letter formula.',
]

const cache = new Map<string, string[]>()
let context: any = null
const labels = new Map<string, string>()

function letterContext(): any {
    if (context) return context
    const molang = (globalThis as any).MolangAutocomplete
    if (!molang?.Context || !molang?.Namespace) return null
    const { Context, Namespace } = molang
    labels.clear()
    const queries = [...LETTER_QUERIES, ...NAMEPLATE_QUERIES]
    for (const name of [...queries, ...NAMEPLATE_FUNCTIONS, ...LETTER_OUTPUTS]) labels.set(name.id, labelFor(name))
    const created = new Context({ id: CONTEXT_ID })
    created.addRootToken({ id: 'return' })
    const query = new Namespace({ id: 'query', shorthand: 'q' })
    for (const name of queries) query.addQuery({ id: name.id, arguments: name.arguments })
    created.addNamespace(query)
    const math = new Namespace({ id: 'math' })
    for (const name of NAMEPLATE_FUNCTIONS) math.addQuery({ id: name.id, arguments: name.arguments })
    created.addNamespace(math)
    const variable = new Namespace({ id: 'variable', shorthand: 'v' })
    for (const name of LETTER_OUTPUTS) variable.addQuery({ id: name.id })
    created.addNamespace(variable)
    context = created
    return context
}

function letterSuggestions(text: string, position: number): Suggestion[] {
    const settings = (globalThis as any).Settings
    if (settings?.get?.('autocomplete_code') === false) return []
    const found: Suggestion[] = letterContext()?.autocomplete(text, position) ?? []
    return found.map((result) => {
        const label = labels.get(result.text.replace(/\(\)$/, ''))
        return label ? { ...result, label } : result
    })
}

function letterIssueText(issue: EngineIssue, reaction: boolean): string | null {
    switch (issue.code) {
        case 'molang_query_place': {
            return `q.${issueName(issue, 'query') ?? ''} doesn't work in letter formulas. Type q. to see what does.`
        }
        case 'letter_owned':
            return `${issueName(issue, 'outputs') ?? ''}: these can only be used when Letters is "${LETTER_MODE_NAMES.owned}". "${LETTER_MODE_NAMES.motion}" uses only the result, v.x and v.opacity.`
        case 'letter_readable':
            if (reaction) return null
            return `The name is easy to read in only ${issueValue(issue, 'frames') ?? 0} of ${issueValue(issue, 'of') ?? 0} frames. Let the letters rest for at least half of the loop.`
        case 'over_cpu':
            return `This formula is too heavy: ${issueValue(issue, 'units') ?? 0} work for a ${issueValue(issue, 'letters') ?? 0}-letter name, and the limit is ${issueValue(issue, 'limit') ?? 0}. Make it shorter, or use fewer math.fbm and math.noise calls.`
        case 'flash':
            return `The letters flash more than ${issueValue(issue, 'limit') ?? 0} times a second, which can harm players who are sensitive to flashing. Fade or change colors more slowly.`
        case 'letter_budget':
            return 'This formula takes too many steps to finish. Make it shorter.'
        default:
            return molangIssueText(issue, 'channel')
    }
}

function waveChannel(from: number, to: number, shift: number): string {
    return `math.round(math.lerp(${(from >> shift) & 0xff}, ${(to >> shift) & 0xff}, v.t))`
}

function colorWaveSource(from: number, to: number): string {
    const color = `${waveChannel(from, to, 16)} * 65536 + ${waveChannel(from, to, 8)} * 256 + ${waveChannel(from, to, 0)}`
    return `v.t = 0.5 + 0.5 * math.sin((q.frame / q.loop + q.glyph_index / q.glyph_count) * 360);\nv.color = ${color};\nreturn 0;`
}

function waveVariant(variant?: string): string {
    const plate = readNameplate()
    return variant && variant in plate.variants ? variant : shownVariant(plate)
}

function waveColors(variant?: string): WaveColor[] {
    const { resolve } = styleOf(readNameplate(), waveVariant(variant))
    const colors: WaveColor[] = []
    for (const [ref, choice] of Object.entries(toneChoices())) {
        const rgb = resolve(ref)
        if (rgb !== null) colors.push({ ref, slot: ref.replace(/\[\d+\]$/, ''), name: choice.name, rgb })
    }
    return colors
}

function clearestPair(colors: WaveColor[], variant?: string): [string, string] {
    const behind = loopPixels(shownPreview(), waveVariant(variant), nameRect())
    const ranked = [...colors].sort((a, b) => minRatio(b.rgb, behind) - minRatio(a.rgb, behind))
    const first = ranked[0]
    const second = ranked.find((color) => color.slot !== first?.slot) ?? ranked[1] ?? first
    return [first?.ref ?? '', second?.ref ?? '']
}

function letterProgramProblems(source: string, letters: LetterContext): string[] {
    const trimmed = source.trim()
    if (!trimmed) return []
    const mode = letters.mode === 'owned' ? 'owned' : 'motion'
    const params = projectParams()
    const names = Object.keys(params)
    const fps = Math.max(1, Math.round(letters.fps))
    const length = Math.max(1, Math.round(letters.length))
    const key = `${mode}\u0000${fps}\u0000${length}\u0000${letters.reaction}\u0000${JSON.stringify(params)}\u0000${trimmed}`
    const cached = cache.get(key)
    if (cached) return cached
    let result: string[]
    try {
        const issues = Array.from(api.nameplateCheckLetterProgram(trimmed, mode, fps, length, names, Float64Array.from(names.map((name) => params[name]))))
        const messages = issues.map((issue) => letterIssueText(wrapIssue(issue), letters.reaction)).filter((message): message is string => !!message)
        result = Array.from(new Set(messages))
    } catch (error) {
        console.error('[polyplus_nameplate] checking a letter program failed', error)
        result = []
    }
    cache.set(key, result)
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    return result
}

export function letterSaveNote(source: string, letters: LetterContext): string | null {
    const problems = letterProgramProblems(source, letters)
    const asOwned = letterProgramProblems(source, { ...letters, mode: 'owned' })
    if (!asOwned.length && (problems.length || letters.mode === 'vanilla')) {
        return `Saved. To see it, set Letters to "${LETTER_MODE_NAMES[problems.length ? 'owned' : 'motion']}" under Name text in the Inspector.`
    }
    return problems.length ? 'Saved, but the formula has a problem. Open it again to see what.' : null
}

function showStyle() {
    ensureStyle(STYLE_ID, STYLE)
}

export function disposeLetterProgram() {
    removeStyle(STYLE_ID)
    try {
        context?.delete?.()
    } catch (error) {
        console.error('[polyplus_nameplate] could not remove the letter program suggestions', error)
    }
    context = null
    labels.clear()
    cache.clear()
}

export function openLetterProgram(options: LetterDialogOptions): any {
    showStyle()
    const prism = (globalThis as any).VuePrismEditor
    const colors = waveColors(options.variant)
    const [firstColor, secondColor] = clearestPair(colors, options.variant)
    const examples = LETTER_EXAMPLES.filter((entry) => (options.mode !== 'owned' || options.reaction || !entry.restless) && (!entry.twoColors || colors.length > 1))
    const state = {
        source: options.source,
        mode: options.mode,
        example: examples[0].name,
        examples,
        queries: LETTER_QUERIES,
        prism: !!prism,
        colors,
        firstColor,
        secondColor,
    }
    const waveColor = (ref: string): number => colors.find((color) => color.ref === ref)?.rgb ?? 0
    const letters = (): LetterContext => ({ mode: state.mode, fps: options.fps, length: options.length, reaction: options.reaction })
    const buttons = options.reaction ? ['Apply', 'Cancel'] : ['Apply', 'Remove formula', 'Cancel']
    const dialog: any = new Dialog({
        id: DIALOG_ID,
        title: options.title ?? (options.variant ? `Letter Formula of Variant ${options.variant}` : 'Letter Formula'),
        width: 680,
        ...dialogButtons(...buttons),
        component: {
            components: prism ? { VuePrismEditor: prism } : {},
            data: () => state,
            computed: {
                about(): string {
                    return LETTER_EXAMPLES.find((entry) => entry.name === (this as any).example)?.about ?? ''
                },
                picksColors(): boolean {
                    return !!LETTER_EXAMPLES.find((entry) => entry.name === (this as any).example)?.twoColors
                },
                problems(): string[] {
                    return letterProgramProblems(state.source, letters())
                },
                intro(): string {
                    return MODE_ABOUT[state.mode] ?? MODE_ABOUT.motion
                },
                outputs(): MolangName[] {
                    return LETTER_OUTPUTS.filter((entry) => state.mode === 'owned' || entry.id === 'x' || entry.id === 'opacity')
                },
                rules(): string[] {
                    const owned = state.mode === 'owned'
                    return [...COMMON_RULES, ...(owned && !options.reaction ? [READABLE_RULE] : []), ...(owned ? OWNED_RULES : []), ...(options.reaction ? REACTION_RULES : []), ...(options.variant ? [VARIANT_RULE] : [])]
                },
                switchNote(): string {
                    return state.mode === options.mode ? '' : `Apply also sets Letters to "${LETTER_MODE_NAMES[state.mode]}".`
                },
            },
            methods: {
                useExample() {
                    const example = LETTER_EXAMPLES.find((entry) => entry.name === state.example)
                    if (!example) return
                    state.source = example.twoColors ? colorWaveSource(waveColor(state.firstColor), waveColor(state.secondColor)) : example.source
                    if (options.switchMode) state.mode = example.owned ? 'owned' : options.mode
                },
                autocomplete(text: string, position: number) {
                    return letterSuggestions(text, position)
                },
            },
            template: `
                <div class="np-molang-color">
                    <div class="dialog_bar form_bar">
                        <label class="name_space_left">Example</label>
                        <select class="dark_bordered" v-model="example">
                            <option v-for="entry in examples" :key="entry.name" :value="entry.name">{{ entry.name }}</option>
                        </select>
                        <button type="button" @click="useExample()">Use</button>
                    </div>
                    <p class="np-subtle">{{ about }}</p>
                    <div v-if="picksColors" class="dialog_bar form_bar">
                        <label class="name_space_left">Colors</label>
                        <select class="dark_bordered" v-model="firstColor" @change="useExample()">
                            <option v-for="color in colors" :key="color.ref" :value="color.ref">{{ color.name }}</option>
                        </select>
                        <select class="dark_bordered" v-model="secondColor" @change="useExample()">
                            <option v-for="color in colors" :key="color.ref" :value="color.ref">{{ color.name }}</option>
                        </select>
                    </div>
                    <p v-if="switchNote">{{ switchNote }}</p>
                    <div class="dialog_bar form_bar ${FORMULA_CLASS}">
                        <label class="name_space_left">Formula</label>
                        <vue-prism-editor v-if="prism" class="molang_input dark_bordered" v-model="source" language="molang" :autocomplete="autocomplete" :line-numbers="false" />
                        <textarea v-else class="dark_bordered" v-model="source" placeholder="for example q.glyph_index"></textarea>
                    </div>
                    <p v-for="problem in problems" class="np-molang-problem" style="color: var(--color-error, #e85050)">{{ problem }}</p>
                    <p>{{ intro }}</p>
                    <details>
                        <summary style="cursor: pointer">Good to know</summary>
                        <ul class="np-subtle">
                            <li v-for="rule in rules" :key="rule">{{ rule }}</li>
                        </ul>
                    </details>
                    <details>
                        <summary style="cursor: pointer">Formula reference</summary>
                        <p>Each letter can read:</p>
                        <ul class="np-subtle">
                            <li v-for="query in queries" :key="query.id"><code>q.{{ query.id }}</code>: {{ query.about }}</li>
                            <li><code>q.frame</code>, <code>q.loop</code> and the other <code>q.</code> values, and <code>math.</code> functions. Type <code>q.</code> or <code>math.</code> to see them all.</li>
                        </ul>
                        <p>Besides the result, it can set:</p>
                        <ul class="np-subtle">
                            <li v-for="output in outputs" :key="output.id"><code>v.{{ output.id }}</code>: {{ output.about }}</li>
                        </ul>
                        <p>To set one, write for example <code>v.x = 1; return 0;</code></p>
                    </details>
                </div>
            `,
        },
        onConfirm() {
            const source = state.source.trim()
            const note = source ? letterSaveNote(source, letters()) : null
            if (note) Blockbench.showQuickMessage(note, 2500)
            options.save(source || null, source && state.mode !== options.mode ? state.mode : undefined)
        },
        onButton(index: number) {
            if (!options.reaction && index === 1) options.save(null)
        },
    } as any)
    dialog.show()
    return dialog
}

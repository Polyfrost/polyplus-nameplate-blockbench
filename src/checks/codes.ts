import type { EngineIssue, IssueLevel, IssueNames, IssueValues } from '../engine'

const ENGINE_ISSUE_CODES = [
    'missing_file',
    'json_size',
    'json_depth',
    'json_syntax',
    'format',
    'manifest',
    'layers',
    'layer',
    'palette',
    'colorway',
    'variant',
    'text',
    'letter_program',
    'letter_owned',
    'letter_budget',
    'letter_readable',
    'badge',
    'corners',
    'corners_both',
    'flags',
    'sprite',
    'sprite_frames',
    'path',
    'repeat',
    'widths',
    'emitter',
    'animation',
    'key_start',
    'key_order',
    'key_range',
    'speed_range',
    'speed_trigger',
    'speed_path',
    'burst_count',
    'badge_schedule',
    'badge_channel',
    'badge_molang',
    'group',
    'reaction',
    'reduced_while',
    'reduced_choice',
    'palette_animation',
    'palette_cycle',
    'palette_molang',
    'molang',
    'molang_empty',
    'molang_unexpected',
    'molang_too_long',
    'molang_too_deep',
    'molang_too_big',
    'molang_unterminated',
    'molang_character',
    'molang_string',
    'molang_value',
    'molang_uncalled',
    'molang_unknown_name',
    'molang_not_query',
    'molang_unknown_query',
    'molang_query_place',
    'molang_assign',
    'molang_variable_name',
    'molang_variables',
    'molang_unknown_function',
    'molang_unknown_math',
    'molang_param_call',
    'molang_unknown_param',
    'molang_arguments',
    'molang_cost',
    'molang_constant',
    'material',
    'material_loop',
    'material_nodes',
    'material_cost',
    'material_samples',
    'material_inputs',
    'material_outputs',
    'material_cycle',
    'material_margins',
    'node_id',
    'node_duplicate',
    'node_type',
    'node_input',
    'node_link',
    'node_output_link',
    'node_literal',
    'node_required',
    'node_setting',
    'node_param',
    'node_texture',
    'node_sprite',
    'node_typing',
    'node_repeat',
    'texture',
    'texture_format',
    'texture_size',
    'layout',
    'mask',
    'body_art',
    'anchor',
    'follow',
    'path_timing',
    'name_target',
    'plate_channel',
    'over_cpu',
    'over_quads',
    'over_cache',
    'over_margin',
    'over_states',
    'flash',
    'readability',
    'badge_hidden',
    'badge_faded',
    'badge_covered',
    'art_coverage',
    'fixed_height',
    'translucent_overlap',
    'position_clamped',
    'plate_background',
    'fallback_cache',
    'fallback_still',
    'fallback_rebuild',
    'fallback_shots',
] as const

const PLUGIN_ISSUE_CODES = [
    'off_palette',
    'sprite_without_texture',
    'no_layers',
    'element_3d',
    'motion',
    'hidden_layer',
    'key_timing',
    'group_widths',
    'kept_track_overridden',
    'curve_text',
    'unused_picture',
    'other',
] as const

const ISSUE_CODES = [...ENGINE_ISSUE_CODES, ...PLUGIN_ISSUE_CODES] as const

export type IssueCode = typeof ISSUE_CODES[number]

export interface IssueFacts {
    code: IssueCode
    level: IssueLevel
    values: IssueValues
    names: IssueNames
    engine: boolean
    layer: string | null
    texture: string | null
    sprite: string | null
    variant: string | null
}

const PIXEL = /^textures\/([^#]+)#frame (\d+) \((\d+), (\d+)\)$/
const TEXTURE = /^textures\/([^#]+)$/
const SPRITE_TEXTURE = /^layers\/(.+)\.json#texture$/
const SPRITE = /^sprites\/([^#]+)\.json/
const LAYER = /^layers\/([^/#]+)\.json/
const VARIANT = /#variants\.([^.]+)/
const NO_VALUES: IssueValues = Object.freeze({})
const NO_NAMES: IssueNames = Object.freeze({})

const KNOWN = new Set<string>(ISSUE_CODES)
const ENGINE_LEVELS: Partial<Record<IssueCode, IssueLevel>> = {
    readability: 'warning',
    badge_hidden: 'warning',
    badge_faded: 'warning',
    badge_covered: 'warning',
    art_coverage: 'warning',
    fixed_height: 'warning',
    translucent_overlap: 'warning',
    position_clamped: 'warning',
    plate_background: 'warning',
    fallback_cache: 'info',
    fallback_still: 'info',
    fallback_rebuild: 'info',
    fallback_shots: 'info',
}

function facts(issue: EngineIssue, code: IssueCode, values: IssueValues = NO_VALUES, engine = false): IssueFacts {
    const path = String(issue.path ?? '')
    return {
        code,
        level: issue.level ?? ENGINE_LEVELS[code] ?? 'error',
        values,
        names: issue.names ?? NO_NAMES,
        engine,
        layer: LAYER.exec(path)?.[1] ?? null,
        texture: TEXTURE.exec(path)?.[1] ?? null,
        sprite: SPRITE.exec(path)?.[1] ?? null,
        variant: VARIANT.exec(path)?.[1] ?? null,
    }
}

export function isIssueCode(value: unknown): value is IssueCode {
    return typeof value === 'string' && KNOWN.has(value)
}

export function issueValue(issue: EngineIssue | IssueFacts, name: string): number | null {
    const value = issue.values?.[name]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function issueName(issue: EngineIssue | IssueFacts, name: string): string | null {
    const value = issue.names?.[name]
    return typeof value === 'string' ? value : null
}

export function isMolangCode(code: string | undefined): boolean {
    return typeof code === 'string' && (code === 'molang' || code.startsWith('molang_'))
}

function pluginFacts(issue: EngineIssue): IssueFacts {
    const path = String(issue.path ?? '')
    const pixel = PIXEL.exec(path)
    if (pixel) {
        const values = Object.freeze({ frame: Number(pixel[2]), x: Number(pixel[3]), y: Number(pixel[4]) })
        return { ...facts(issue, 'off_palette', values), texture: pixel[1] }
    }
    if (TEXTURE.test(path)) return facts(issue, 'texture')
    const sprite = SPRITE_TEXTURE.exec(path)
    if (sprite) return { ...facts(issue, 'sprite_without_texture'), layer: sprite[1] }
    if (path === 'manifest.json#layers') return facts(issue, 'no_layers')
    if (issue.animation) return facts(issue, 'animation')
    if (path.startsWith('materials/')) return facts(issue, 'material')
    return facts(issue, 'other')
}

export function classifyIssue(issue: EngineIssue): IssueFacts {
    if (typeof issue.code !== 'string' || issue.code.length === 0) return pluginFacts(issue)
    const code = isIssueCode(issue.code) ? issue.code : 'other'
    return facts(issue, code, issue.values ?? NO_VALUES, true)
}

export function issueCode(issue: EngineIssue): IssueCode {
    return classifyIssue(issue).code
}

import { disposeAll } from '../util/teardown'
import { COSMETIC_FORMATS, CosmeticData, CosmeticKind, defaultCosmetic, normalizeCosmetic } from './data'
import { buildPlayerRig } from './emote'
import { COSMETIC_PROPERTY } from './state'

export interface KindSpec {
    name: string
    description: string
    icon: string
    button: string
    intro: string
    setup?: () => void
}

export const KIND_SPECS: Partial<Record<CosmeticKind, KindSpec>> = {
    item: {
        name: 'PolyPlus Item',
        description: 'Model a hat, a back piece, a tail or anything else worn for PolyPlus, with reactions, springs and palette colors.',
        icon: 'checkroom',
        button: 'Create item',
        intro: 'Model it, paint it with palette colors, animate it, then add reactions and export the zip.',
    },
    pet: {
        name: 'PolyPlus Pet',
        description: 'Model a pet that follows its owner in PolyPlus, with moods, reactions and springs.',
        icon: 'pets',
        button: 'Create pet',
        intro: "Model it and add 'idle' and 'move' animations. That is enough for a pet that walks, flies or sits on a shoulder.",
    },
    effect: {
        name: 'PolyPlus Effect',
        description: 'Make particles, sounds and trails for set bonuses, moments and trails in PolyPlus.',
        icon: 'auto_awesome',
        button: 'Create effect',
        intro: 'Add particles and sounds in Effects, place them on the player with locators, then export the zip.',
    },
    emote: {
        name: 'PolyPlus Emote',
        description: 'Animate the player for a PolyPlus emote, solo or as a duo.',
        icon: 'emoji_people',
        button: 'Create emote',
        intro: 'Animate the player parts in the Animate tab. Add two roles to make a duo emote.',
        setup: () => buildPlayerRig(),
    },
}

const formats: ModelFormat[] = []

export function cosmeticFormatIds(): string[] {
    return Object.keys(KIND_SPECS).map((kind) => COSMETIC_FORMATS[kind as CosmeticKind])
}

function startProject(kind: CosmeticKind, data: CosmeticData = defaultCosmetic(kind)): boolean {
    const format = Formats[COSMETIC_FORMATS[kind]]
    if (!format || !newProject(format)) return false
    ;(Project as any)[COSMETIC_PROPERTY] = data
    Project.name = data.id
    ;(Project as any).geometry_name = data.id
    KIND_SPECS[kind]?.setup?.()
    return true
}

export function newCosmeticProject(kind: CosmeticKind, data?: CosmeticData): boolean {
    return startProject(kind, data)
}

export function registerCosmeticFormats() {
    if (formats.length) return
    for (const [kind, spec] of Object.entries(KIND_SPECS) as Array<[CosmeticKind, KindSpec]>) {
        formats.push(new ModelFormat(COSMETIC_FORMATS[kind], {
            name: spec.name,
            description: spec.description,
            icon: spec.icon,
            category: 'other',
            target: 'PolyPlus',
            show_on_start_screen: true,
            show_in_new_list: true,
            format_page: {
                button_text: spec.button,
                content: [{ type: 'h3', text: spec.name }, { text: spec.intro }],
            },
            model_identifier: true,
            bone_rig: true,
            centered_grid: true,
            rotate_cubes: true,
            box_uv: true,
            optional_box_uv: true,
            per_texture_uv_size: true,
            single_texture: false,
            locators: true,
            animation_mode: true,
            animation_files: true,
            animation_codec: (globalThis as any).AnimationCodec?.codecs?.bedrock,
            animation_controllers: true,
            molang: true,
            select_texture_for_particles: true,
            edit_mode: true,
            paint_mode: true,
            display_mode: false,
            new() {
                return startProject(kind)
            },
            onSetup(project: ModelProject) {
                const raw = (project as any)[COSMETIC_PROPERTY]
                ;(project as any)[COSMETIC_PROPERTY] = normalizeCosmetic(raw && typeof raw === 'object' ? raw : defaultCosmetic(kind), kind)
            },
        } as any))
    }
}

export function unregisterCosmeticFormats() {
    disposeAll(formats)
}

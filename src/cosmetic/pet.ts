import { cosmeticLimits } from '../engine'
import { defineAction } from '../util/actions'
import { isRecord } from '../util/json'
import { hasProject } from '../util/project'
import { HOST_VARIABLES } from './autocomplete'
import type { BundlePart } from './bundle'
import { ARCHETYPES, Archetype, DEFAULT_LEASH, Interaction, INTERACTION_LABELS, INTERACTIONS, MAX_PET_ROLES, normalizeCosmetic, PetData, PetRoleData, petScaleKept, PetScaleRange, PLAYER_BONES, ROLE_IDS, ROLE_LABELS } from './data'
import { animationNames } from './dialogs'
import { addTo, HOST_CONTROLS, HostControl, PANEL_BUTTONS, SETTINGS_SECTIONS } from './registry'
import { projectLiveness } from './references'
import { nextPetRole, openRoleDialog, petRoleOf, roleRow } from './roles'
import { commitCosmetic, isCosmeticActive, readCosmetic } from './state'

export const PET_VARIABLES = [
    'pet_mode',
    'pet_action',
    'pet_look_yaw',
    'pet_look_pitch',
    'pet_speed',
    'pet_distance',
    'pet_on_ground',
    'pet_in_water',
    'pet_mood',
    'pet_interaction',
    'pet_role',
    'pet_interaction_time',
]

export const PET_INTERACTION_VALUES: Record<Interaction, number> = { greet: 1, follow: 2, nap: 3, play: 4, chase: 5 }
export const PET_PLAYING = 7
export const PET_SLEEPING = 5

export function petRoleVariables(host: Readonly<Record<string, number>>, interaction: string, seat: number, time: number): Record<string, number> {
    return {
        ...host,
        pet_mode: interaction === 'nap' && time >= 0 ? PET_SLEEPING : PET_PLAYING,
        pet_interaction: PET_INTERACTION_VALUES[interaction as Interaction] ?? 0,
        pet_role: seat,
        pet_interaction_time: time,
    }
}

export const PET_MODES = ['Idle', 'Following', 'Catching up', 'Sitting', 'Riding', 'Sleeping', 'Wandering', 'Playing', 'Doing an idle action']

export const PET_ACTIONS = ['Nothing', 'Sitting', 'Lying down', 'Grooming', 'Yawning', 'Sniffing', 'Perching']

export const PET_ANIMATIONS = ['sit', 'lie', 'groom', 'yawn', 'sniff', 'sleep', 'celebrate', 'idle_*']

export interface PetAnimationHints {
    found: string[]
    missing: string[]
}

function shortName(name: string): string {
    return name.slice(name.lastIndexOf('.') + 1)
}

function matches(hint: string, short: string): boolean {
    return hint.endsWith('*') ? short.startsWith(hint.slice(0, -1)) && short.length > hint.length - 1 : short === hint
}

export function petAnimationHints(names: readonly string[]): PetAnimationHints {
    const shorts = names.map(shortName)
    const found: string[] = []
    const missing: string[] = []
    for (const hint of PET_ANIMATIONS) {
        const hits = shorts.filter((short) => matches(hint, short))
        if (hits.length) found.push(...(hint.endsWith('*') ? hits : [hint]))
        else missing.push(hint)
    }
    return { found, missing }
}

export function petAnimationText(names: readonly string[]): string {
    const { found, missing } = petAnimationHints(names)
    const lines = ['The pet plays these on its own when you add them: sit, lie, groom, yawn, sniff, sleep, celebrate, and any idle_ animation (idle_look, idle_tail).']
    if (found.length) lines.push(`Added: ${found.join(', ')}.`)
    if (missing.length) lines.push(`Not added yet: ${missing.map((hint) => (hint.endsWith('*') ? 'an idle_ animation' : hint)).join(', ')}.`)
    return lines.join(' ')
}

const PET_ROLES_DIALOG = 'polyplus_cosmetic_pet_roles'
const ARCHETYPE_LABELS: Record<Archetype, string> = { walking: 'Walks', flying: 'Flies', shoulder: 'Sits on a shoulder' }
const ROLE_CHOICES: Record<string, string> = { '': 'Default', off: 'Off', a: 'Starts it', b: 'Joins in', ab: 'Both' }

function petJson(pet: PetData): Record<string, unknown> {
    const out: Record<string, unknown> = { archetype: pet.archetype }
    if (pet.leashRadius !== DEFAULT_LEASH) out.leashRadius = pet.leashRadius
    if (pet.scale !== 1) out.scale = pet.scale
    if (pet.anchor) out.anchor = pet.anchor
    const interactions = Object.entries(pet.interactions).filter(([, roles]) => roles)
    if (interactions.length) out.interactions = Object.fromEntries(interactions)
    if (pet.roles.length) out.roles = pet.roles.map(petRoleJson)
    return out
}

function petRoleJson(role: PetRoleData): Record<string, unknown> {
    const out: Record<string, unknown> = { interaction: role.interaction, id: role.id, animation: role.animation }
    if (role.offset.some((value) => value !== 0)) out.offset = [...role.offset]
    if (role.yaw !== 0) out.yaw = role.yaw
    return out
}

export const petPart: BundlePart = {
    write(data, manifest) {
        if (data.kind === 'pet') Object.assign(manifest, petJson(data.pet))
    },
    read(manifest, data) {
        if (data.kind !== 'pet') return
        const { archetype, leashRadius, scale, anchor, roles } = manifest
        data.pet = normalizeCosmetic({ kind: 'pet', pet: { archetype, leashRadius, scale, anchor, interactions: isRecord(manifest.interactions) ? manifest.interactions : {}, roles } }, 'pet').pet
    },
}

export const PET_CONTROLS: HostControl[] = [
    { name: 'pet_mode', label: 'Pet is', kinds: ['pet'], options: PET_MODES.map((label, value) => ({ value, label })) },
    { name: 'pet_action', label: 'Idle action', kinds: ['pet'], options: PET_ACTIONS.map((label, value) => ({ value, label })) },
    { name: 'pet_look_yaw', label: 'Head turn', kinds: ['pet'], min: -90, max: 90, step: 5 },
    { name: 'pet_look_pitch', label: 'Head tilt', kinds: ['pet'], min: -90, max: 90, step: 5 },
    { name: 'pet_speed', label: 'Pet speed', kinds: ['pet'], min: 0, max: 12, step: 0.5 },
    { name: 'pet_distance', label: 'Distance to owner', kinds: ['pet'], min: 0, max: 20, step: 0.5 },
    { name: 'pet_on_ground', label: 'Pet on ground', kinds: ['pet'], toggle: true },
    { name: 'pet_in_water', label: 'Pet in water', kinds: ['pet'], toggle: true },
    { name: 'pet_mood', label: 'Mood', kinds: ['pet'], min: -1, max: 1, step: 0.1 },
    { name: 'pet_interaction', label: 'With another pet', kinds: ['pet'], options: [{ value: 0, label: 'Nothing' }, ...INTERACTIONS.map((id) => ({ value: PET_INTERACTION_VALUES[id], label: INTERACTION_LABELS[id] }))] },
    { name: 'pet_role', label: 'Its part', kinds: ['pet'], options: ROLE_IDS.map((id, value) => ({ value, label: ROLE_LABELS[id] })) },
    { name: 'pet_interaction_time', label: 'Time together (s)', kinds: ['pet'], min: -1, max: 30, step: 0.5 },
]

function rolesOf(choice: unknown): Array<'a' | 'b'> | undefined {
    if (choice === 'off') return []
    return choice === 'ab' ? ['a', 'b'] : choice === 'a' || choice === 'b' ? [choice] : undefined
}

function choiceOf(roles: ReadonlyArray<'a' | 'b'> | undefined): string {
    if (!roles) return ''
    return roles.length ? roles.join('') : 'off'
}

function pick<T extends string>(labels: Record<T, string>): Record<string, string> {
    return { ...labels }
}

export function openPetRoles(): Dialog | null {
    if (!hasProject()) return null
    const data = readCosmetic()
    const pet = data.pet
    return openRoleDialog({
        id: PET_ROLES_DIALOG,
        title: 'Pet Roles',
        empty: 'No roles yet. Add one for each way this pet plays with another pet.',
        max: MAX_PET_ROLES,
        rows: pet.roles.map(roleRow),
        animations: animationNames(),
        interactions: true,
        live: projectLiveness(data),
        added: (rows, animations) => nextPetRole(rows, pet, animations),
        save(rows) {
            commitCosmetic('Edit pet roles', (target) => {
                target.pet.roles = rows.map(petRoleOf)
            })
        },
    })
}

export function petScaleRange(): PetScaleRange | null {
    const limits = cosmeticLimits()
    const min = limits?.pet_scale_min
    const max = limits?.pet_scale_max
    return typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max) && min <= max ? { min, max } : null
}

function scaleField(scale: number, range: PetScaleRange | null): Record<string, unknown> {
    const field = { label: 'Size', type: 'number', value: scale, step: 0.1 }
    if (!range) return { ...field, description: '1 is normal size' }
    return { ...field, min: range.min, max: range.max, description: `From ${range.min} to ${range.max}. 1 is normal size` }
}

export function registerPet(): () => void {
    const removeSection = addTo(SETTINGS_SECTIONS, (data) => {
        if (data.kind !== 'pet') return { form: {}, save() {} }
        const pet = data.pet
        const range = petScaleRange()
        const form: Record<string, unknown> = {
            archetype: { label: 'Moves', type: 'select', options: pick(ARCHETYPE_LABELS), value: pet.archetype },
            leashRadius: { label: 'Stays within (blocks)', type: 'number', value: pet.leashRadius, min: 0.5, step: 0.5 },
            scale: scaleField(pet.scale, range),
            anchor: {
                label: 'Shoulder',
                type: 'select',
                options: { '': 'Owner picks', ...Object.fromEntries(PLAYER_BONES.map((bone) => [bone, bone])) },
                value: pet.anchor,
                condition: (f: any) => f.archetype === 'shoulder',
            },
        }
        for (const id of INTERACTIONS) {
            form[`interaction_${id}`] = { label: INTERACTION_LABELS[id], type: 'select', options: ROLE_CHOICES, value: choiceOf(pet.interactions[id]) }
        }
        form.animations = { label: 'Extra animations', type: 'info', text: petAnimationText(animationNames()) }
        return {
            form,
            save(result, next) {
                const archetype = (ARCHETYPES as readonly string[]).includes(result.archetype) ? (result.archetype as Archetype) : next.pet.archetype
                const interactions: PetData['interactions'] = {}
                for (const id of INTERACTIONS) {
                    const roles = rolesOf(result[`interaction_${id}`])
                    if (roles) interactions[id] = roles
                }
                next.pet = {
                    ...next.pet,
                    archetype,
                    leashRadius: Number(result.leashRadius) > 0 ? Number(result.leashRadius) : next.pet.leashRadius,
                    scale: Number(result.scale) > 0 ? petScaleKept(Number(result.scale), range) : next.pet.scale,
                    anchor: archetype === 'shoulder' ? String(result.anchor ?? '') : '',
                    interactions,
                }
            },
        }
    })
    const removeControls = addTo(HOST_CONTROLS, ...PET_CONTROLS)
    HOST_VARIABLES.pet = PET_VARIABLES
    const action = defineAction(PET_ROLES_DIALOG, {
        name: 'Pet Roles',
        description: 'What the pet plays, and where it stands, when it plays with another pet',
        icon: 'pets',
        category: 'edit',
        condition: () => isCosmeticActive() && readCosmetic().kind === 'pet',
        click: () => {
            openPetRoles()
        },
    })
    const removeButton = addTo(PANEL_BUTTONS, { action: PET_ROLES_DIALOG, label: 'Roles', icon: 'pets', kinds: ['pet'] })
    return () => {
        removeButton()
        action.delete()
        removeSection()
        removeControls()
        delete HOST_VARIABLES.pet
    }
}

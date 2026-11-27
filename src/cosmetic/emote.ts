import { defineAction } from '../util/actions'
import { isRecord } from '../util/json'
import { hasProject } from '../util/project'
import type { BundlePart } from './bundle'
import { HOST_VARIABLES } from './autocomplete'
import { CosmeticData, DEFAULT_REQUIREMENT, DEFAULT_RULES, EMOTE_REQUIREMENTS, EMOTE_RULES, EmoteData, EmoteRule, MAX_ROLES, normalizeCosmetic, RoleData, ROLE_LABELS } from './data'
import { animationNames } from './dialogs'
import { RIG_PROPERTY } from './project'
import { pickOf, projectLiveness, RefPick, savedPick, shownPick, staleChoice } from './references'
import { addTo, HOST_CONTROLS, HostControl, HostOption, PANEL_BUTTONS, SETTINGS_SECTIONS } from './registry'
import { openRoleDialog, roleOf, roleRow } from './roles'
import { commitCosmetic, isCosmeticActive, readCosmetic } from './state'

const ROLES_DIALOG = 'polyplus_cosmetic_roles'

export const EMOTE_ROLE_VARIABLE = 'emote_role'
export const EMOTE_FALLBACK_VARIABLE = 'emote_fallback'
export const SOLO_ROLE = -1

export function emoteRoleOptions(data: CosmeticData): HostOption[] {
    return [{ value: SOLO_ROLE, label: 'Alone' }, ...data.emote.roles.map((role, value) => ({ value, label: ROLE_LABELS[role.id] ?? role.id }))]
}

function hasRoles(data: CosmeticData): boolean {
    return data.emote.roles.length > 0
}

function playsBackup(data: CosmeticData, host: Readonly<Record<string, number>>): boolean {
    return !!data.emote.fallback && (!hasRoles(data) || (host[EMOTE_ROLE_VARIABLE] ?? SOLO_ROLE) < 0)
}

const EMOTE_CONTROLS: HostControl[] = [
    { name: EMOTE_ROLE_VARIABLE, label: 'Part', kinds: ['emote'], choices: emoteRoleOptions, initial: SOLO_ROLE, shown: hasRoles },
    { name: EMOTE_FALLBACK_VARIABLE, label: 'Plays the backup', kinds: ['emote'], toggle: true, shown: playsBackup },
]

export const RULE_LABELS: Record<EmoteRule, string> = {
    allow_walking: 'Keeps playing while walking',
    allow_sprinting: 'Keeps playing while sprinting',
    allow_crouching: 'Keeps playing while crouching',
    allow_falling: 'Keeps playing while falling',
    allow_elytra_flying: 'Keeps playing while gliding',
    allow_swimming: 'Keeps playing while swimming',
    allow_vanilla_pose: 'Keeps the normal pose underneath',
    absolute_head: 'Head turns to the emote, not with it',
}

export const REQUIREMENT_LABELS: Record<string, string> = {
    floor: 'Open ground',
    ledge: 'A ledge to sit on',
    wall: 'A wall to lean on',
}

export const PLAYER_RIG: Array<{ name: string, pivot: [number, number, number], from: [number, number, number], to: [number, number, number] }> = [
    { name: 'body', pivot: [0, 24, 0], from: [-4, 12, -2], to: [4, 24, 2] },
    { name: 'head', pivot: [0, 24, 0], from: [-4, 24, -4], to: [4, 32, 4] },
    { name: 'rightArm', pivot: [-5, 22, 0], from: [-8, 12, -2], to: [-4, 24, 2] },
    { name: 'leftArm', pivot: [5, 22, 0], from: [4, 12, -2], to: [8, 24, 2] },
    { name: 'rightLeg', pivot: [-1.9, 12, 0], from: [-3.9, 0, -2], to: [0.1, 12, 2] },
    { name: 'leftLeg', pivot: [1.9, 12, 0], from: [-0.1, 0, -2], to: [3.9, 12, 2] },
]

function rulesJson(rules: Record<EmoteRule, boolean>): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    for (const rule of EMOTE_RULES) if (rules[rule] !== DEFAULT_RULES[rule]) out[rule] = rules[rule]
    return out
}

function camelRule(rule: string): string {
    return rule.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

export function rulesOf(raw: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (!isRecord(raw)) return out
    for (const rule of EMOTE_RULES) {
        const value = rule in raw ? raw[rule] : raw[camelRule(rule)]
        if (value !== undefined) out[rule] = value
    }
    return out
}

function roleJson(role: RoleData): Record<string, unknown> {
    const out: Record<string, unknown> = { id: role.id, animation: role.animation }
    if (role.offset.some((value) => value !== 0)) out.offset = [...role.offset]
    if (role.yaw !== 0) out.yaw = role.yaw
    return out
}

export function defaultMain(fallback: string, animations: readonly string[]): string {
    return animations.find((name) => name !== fallback) ?? animations[0] ?? ''
}

export function mainOf(emote: Pick<EmoteData, 'main' | 'fallback'>, animations: readonly string[]): string {
    return emote.main || defaultMain(emote.fallback, animations)
}

function clipNames(files: Record<string, string>, listed: unknown): string[] {
    const ids = typeof listed === 'string' ? [listed] : Array.isArray(listed) ? listed.filter((id): id is string => typeof id === 'string') : []
    const names: string[] = []
    for (const id of new Set(ids)) {
        let parsed: unknown = null
        try {
            parsed = JSON.parse(files[`animations/${id}.animation.json`] ?? 'null')
        } catch {
            parsed = null
        }
        if (isRecord(parsed) && isRecord(parsed.animations)) for (const name of Object.keys(parsed.animations)) if (!names.includes(name)) names.push(name)
    }
    return names
}

export const emotePart: BundlePart = {
    write(data, manifest, out) {
        if (data.kind !== 'emote') return
        const rules = rulesJson(data.emote.rules)
        if (Object.keys(rules).length) manifest.rules = rules
        if (data.emote.roles.length) manifest.roles = data.emote.roles.map(roleJson)
        if (data.emote.requirement !== DEFAULT_REQUIREMENT) manifest.requirement = data.emote.requirement
        if (data.emote.fallback) manifest.fallback = data.emote.fallback
        const main = mainOf(data.emote, clipNames(out.files, manifest.animations))
        if (main) manifest.main = main
    },
    read(manifest, data, input) {
        if (data.kind !== 'emote') return
        const emote = { rules: rulesOf(manifest.rules), roles: manifest.roles, requirement: manifest.requirement, fallback: manifest.fallback, main: manifest.main }
        data.emote = normalizeCosmetic({ kind: 'emote', emote }, 'emote').emote
        if (data.emote.main && data.emote.main === defaultMain(data.emote.fallback, clipNames(input.files, manifest.animations))) data.emote.main = ''
    },
}

export function buildPlayerRig() {
    if (typeof Group === 'undefined' || typeof Cube === 'undefined') return
    for (const part of PLAYER_RIG) {
        const group = new Group({ name: part.name, origin: part.pivot } as any).init()
        ;(group as any)[RIG_PROPERTY] = true
        const cube = new Cube({ name: part.name, from: part.from, to: part.to, origin: part.pivot } as any).addTo(group).init()
        ;(cube as any)[RIG_PROPERTY] = true
    }
    Canvas.updateAll?.()
}

export function openRoles(): Dialog | null {
    if (!hasProject()) return null
    const data = readCosmetic()
    return openRoleDialog({
        id: ROLES_DIALOG,
        title: 'Duo Roles',
        empty: 'A solo emote has no roles. Add two to make a duo emote.',
        max: MAX_ROLES,
        rows: data.emote.roles.map(roleRow),
        animations: animationNames(),
        interactions: false,
        live: projectLiveness(data),
        added(rows, animations) {
            const id = rows.some((row) => row.id === 'a') ? 'b' : 'a'
            return { interaction: '', id, animation: animations[0] ?? '', offset: [0, 0, id === 'b' ? 1.5 : 0], yaw: id === 'b' ? 180 : 0 }
        },
        save(rows) {
            commitCosmetic('Edit roles', (target) => {
                target.emote.roles = rows.map(roleOf)
            })
        },
    })
}

function requirementOptions(current: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const id of EMOTE_REQUIREMENTS) out[id] = REQUIREMENT_LABELS[id]
    if (!(current in out)) out[current] = current
    return out
}

export function fallbackOptions(pick: RefPick, animations: readonly string[]): Record<string, string> {
    const out: Record<string, string> = { '': 'Nothing, just a message' }
    const stale = staleChoice(pick)
    if (stale) out[stale.value] = stale.label
    for (const name of animations) out[name] = name
    if (pick.name && !stale && !(pick.name in out)) out[pick.name] = pick.name
    return out
}

export function mainOptions(pick: RefPick, animations: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {}
    const stale = staleChoice(pick)
    if (stale) out[stale.value] = stale.label
    for (const name of animations) out[name] = name
    if (pick.name && !stale && !(pick.name in out)) out[pick.name] = pick.name
    if (!Object.keys(out).length) out[''] = 'No animations yet'
    return out
}

export function registerEmote(): () => void {
    const removeSection = addTo(SETTINGS_SECTIONS, (data) => {
        if (data.kind !== 'emote') return { form: {}, save() {} }
        const form: Record<string, unknown> = {}
        EMOTE_RULES.forEach((rule, i) => {
            form[`rule_${rule}`] = { label: i === 0 ? 'Rules' : ' ', type: 'checkbox', text: RULE_LABELS[rule], value: data.emote.rules[rule] }
        })
        form.requirement = { label: 'Needs', type: 'select', options: requirementOptions(data.emote.requirement), value: data.emote.requirement }
        const fallback = pickOf(projectLiveness(data), 'animations', data.emote.fallback, data.emote.fallbackRef)
        form.fallback = { label: 'Otherwise plays', type: 'select', options: fallbackOptions(fallback, animationNames()), value: shownPick(fallback) }
        const main = pickOf(projectLiveness(data), 'animations', data.emote.main, data.emote.mainRef)
        const guess = defaultMain(data.emote.fallback, animationNames())
        form.main = { label: 'Main animation', type: 'select', description: 'What the emote plays on its own', options: mainOptions(main, animationNames()), value: shownPick(main) || guess }
        return {
            form,
            save(result, next) {
                for (const rule of EMOTE_RULES) next.emote.rules[rule] = result[`rule_${rule}`] === true
                next.emote.requirement = typeof result.requirement === 'string' ? result.requirement : next.emote.requirement
                if (typeof result.fallback === 'string') {
                    const saved = savedPick(result.fallback, fallback)
                    next.emote.fallback = saved.name
                    if (saved.ref) next.emote.fallbackRef = saved.ref
                    else delete next.emote.fallbackRef
                }
                if (typeof result.main === 'string' && !(result.main === guess && !main.name)) {
                    const saved = savedPick(result.main, main)
                    next.emote.main = saved.name
                    if (saved.ref) next.emote.mainRef = saved.ref
                    else delete next.emote.mainRef
                }
            },
        }
    })
    const action = defineAction(ROLES_DIALOG, {
        name: 'Duo Roles',
        description: 'Where each player stands and what they play in a duo emote',
        icon: 'group',
        category: 'edit',
        condition: () => isCosmeticActive() && readCosmetic().kind === 'emote',
        click: () => {
            openRoles()
        },
    })
    const removeButton = addTo(PANEL_BUTTONS, { action: ROLES_DIALOG, label: 'Roles', icon: 'group', kinds: ['emote'] })
    const removeControls = addTo(HOST_CONTROLS, ...EMOTE_CONTROLS)
    HOST_VARIABLES.emote = [EMOTE_ROLE_VARIABLE, EMOTE_FALLBACK_VARIABLE]
    return () => {
        removeButton()
        action.delete()
        removeSection()
        removeControls()
        delete HOST_VARIABLES.emote
    }
}

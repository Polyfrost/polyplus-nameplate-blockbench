import { describe, loadCosmetic } from '../engine'
import { decodePng, toBase64 } from '../material/png'
import { defineAction, disposeMenuBarAction } from '../util/actions'
import { messageBox } from '../util/dialogs'
import { cloneJson, isRecord } from '../util/json'
import { escapeHtml, htmlList, plural } from '../util/text'
import { animationPath, BundleFiles, buildBundle, controllerPath, geometryPath, MANIFEST, readBundle, ReadBundle, RIG_PARTS_KEY } from './bundle'
import { COSMETIC_FORMATS, CosmeticKind, isCosmeticKind } from './data'
import { PLAYER_RIG } from './emote'
import { newCosmeticProject } from './formats'
import { INDEX_PIXELS_PROPERTY, INDEX_PROPERTY, PALETTE_PROPERTY, RIG_PROPERTY, SPRING_PROPERTY, writeIndexPixels } from './project'
import { readSprings, SPRING_KEY, SpringParams, storedSpring } from './springs'
import { cosmeticIssueText } from './where'
import { scheduleChecks } from './checks'
import { cosmeticState, readCosmetic } from './state'
import { syncCosmeticPanel } from './panel'

const TITLE = 'Import Cosmetic'
const RESOURCE_ID = 'polyplus_cosmetic_bundle'
const MAX_LISTED = 25
const MAX_ENTRIES = 512
const MAX_FILE_BYTES = 8 * 1024 * 1024
const TEXT_FILE = /\.json$/i
const LEGACY_PREFIX = 'geometry.'
const LEGACY_BOUNDS = ['visible_bounds_width', 'visible_bounds_height', 'visible_bounds_offset']
const LEGACY_KEPT = new Set(['bones', 'description', 'texturewidth', 'textureheight', ...LEGACY_BOUNDS])
const DEFAULT_TEXTURE_SIZE = 64
const KIND_NAMES: Record<CosmeticKind, string> = { item: 'item', pet: 'pet', effect: 'effect', emote: 'emote' }

export interface ImportTexture {
    id: string
    png: Uint8Array
    palette: boolean
    index: string
    pixels: string
}

export interface CosmeticImportPlan {
    read: ReadBundle
    model: Record<string, any> | null
    springs: Record<string, SpringParams>
    textures: ImportTexture[]
    problems: string[]
    changed: string[]
    dropped: string[]
}

interface ZipEntry {
    name: string
    dir: boolean
    async(type: 'string'): Promise<string>
    async(type: 'uint8array'): Promise<Uint8Array>
}

interface ZipLoader {
    loadAsync(data: ArrayBuffer | Uint8Array): Promise<{ files: Record<string, ZipEntry> }>
}

export function cosmeticKindOf(files: Readonly<Record<string, string>>): CosmeticKind | null {
    try {
        const manifest = JSON.parse(files[MANIFEST] ?? '')
        return isRecord(manifest) && isCosmeticKind(manifest.kind) ? manifest.kind : null
    } catch {
        return null
    }
}

function argbHex(rgba: Uint8Array, at: number): string {
    const hex = (value: number) => value.toString(16).padStart(2, '0')
    return `#${hex(rgba[at + 3])}${hex(rgba[at])}${hex(rgba[at + 1])}${hex(rgba[at + 2])}`.toUpperCase()
}

export function fixedColorsOf(png: Uint8Array, index: Uint8Array): string[] {
    const picture = decodePng(png)
    const map = decodePng(index)
    if (picture.width !== map.width || picture.height !== map.height) throw new Error("its palette map isn't the size of its picture")
    const out = new Set<string>()
    for (let p = 0; p < picture.width * picture.height; p++) {
        if (picture.rgba[p * 4 + 3] === 0 || map.rgba[p * 4] !== 0) continue
        out.add(argbHex(picture.rgba, p * 4))
    }
    return [...out]
}

function manifestOf(files: Readonly<Record<string, string>>): Record<string, unknown> {
    try {
        const parsed = JSON.parse(files[MANIFEST] ?? '')
        return isRecord(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function editableGeometry(geometry: Record<string, unknown> | null, path: string, changed: string[], dropped: string[]): Record<string, unknown> | null {
    if (!geometry || 'minecraft:geometry' in geometry) return geometry
    const keys = Object.keys(geometry).filter((key) => key.startsWith(LEGACY_PREFIX))
    const legacy = keys.length ? geometry[keys[0]] : undefined
    if (!isRecord(legacy)) return geometry
    const description: Record<string, unknown> = isRecord(legacy.description) ? cloneJson(legacy.description) as Record<string, unknown> : {}
    description.identifier = keys[0]
    description.texture_width = finiteNumber(legacy.texturewidth) ?? finiteNumber(description.texture_width) ?? DEFAULT_TEXTURE_SIZE
    description.texture_height = finiteNumber(legacy.textureheight) ?? finiteNumber(description.texture_height) ?? DEFAULT_TEXTURE_SIZE
    for (const key of LEGACY_BOUNDS) if (legacy[key] !== undefined && description[key] === undefined) description[key] = cloneJson(legacy[key])
    const model: Record<string, unknown> = { description }
    if (legacy.bones !== undefined) model.bones = cloneJson(legacy.bones)
    changed.push(`The model '${keys[0]}' was moved from the old 1.8 geometry layout to the current one`)
    for (const key of Object.keys(legacy)) if (!LEGACY_KEPT.has(key)) dropped.push(`${path}: ${keys[0]}.${key}`)
    for (const key of keys.slice(1)) dropped.push(`${path}: ${key}`)
    return { format_version: '1.12.0', 'minecraft:geometry': [model] }
}

function strippedModel(geometry: Record<string, unknown> | null, changed: string[]): Record<string, any> | null {
    const models = geometry?.['minecraft:geometry']
    if (!Array.isArray(models) || !isRecord(models[0])) return null
    if (models.length > 1) changed.push(`Only the first model was imported; the zip has ${models.length}`)
    const model = cloneJson(models[0]) as Record<string, any>
    if (!isRecord(model.description)) model.description = {}
    if (Array.isArray(model.bones)) {
        for (const bone of model.bones) {
            if (!isRecord(bone)) continue
            delete bone[SPRING_KEY]
            if (bone.poly_mesh !== undefined) {
                changed.push(`Bone '${String(bone.name)}' lost its mesh shapes. Blockbench can't open them in this format`)
                delete bone.poly_mesh
            }
        }
    }
    return model
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i])
}

function unusedFiles(input: BundleFiles, read: ReadBundle, changed: string[]): string[] {
    const again = buildBundle(read.data, read.sources, read.requires)
    const out: string[] = []
    const sharing = (target: string) => Object.values(read.merged).filter((into) => into === target).length
    for (const path of Object.keys(input.files)) {
        if (path in again.files || path in again.binary) continue
        const into = read.merged[path]
        if (into && into in again.files) changed.push(sharing(into) > 1 ? `File '${path}' is now part of '${into}'` : `File '${path}' is now '${into}'`)
        else out.push(path)
    }
    const added = Object.keys(again.binary).filter((path) => !(path in input.binary))
    for (const [path, bytes] of Object.entries(input.binary)) {
        if (path in again.files || path in again.binary) continue
        const moved = added.find((target) => sameBytes(again.binary[target], bytes))
        if (moved) changed.push(`Picture '${path}' is now '${moved}'`)
        else out.push(path)
    }
    const before = manifestOf(input.files)
    const after = manifestOf(again.files)
    for (const key of Object.keys(before)) if (!(key in after)) out.push(`${MANIFEST}: ${key}`)
    return out.sort()
}

export function planCosmeticImport(input: BundleFiles, skipped: readonly string[] = []): CosmeticImportPlan {
    const read = readBundle(input)
    const changed: string[] = [...read.changed]
    const dropped = [...unusedFiles(input, read, changed), ...read.dropped, ...skipped]
    const textures: ImportTexture[] = []
    const fixed = new Set(read.data.palette.fixed)
    for (const texture of read.sources.textures) {
        textures.push({ id: texture.id, png: texture.png, palette: !!texture.index, index: texture.index ? toBase64(texture.index) : '', pixels: texture.index ? toBase64(texture.png) : '' })
        if (!texture.index) continue
        try {
            for (const color of fixedColorsOf(texture.png, texture.index)) fixed.add(color)
        } catch (error) {
            changed.push(`Picture '${texture.id}' lost its fixed colors: ${describe(error)}`)
        }
    }
    read.data.palette.fixed = [...fixed]
    const geometryFile = Object.keys(read.merged).filter((path) => path.startsWith('models/') && read.merged[path] === geometryPath(read.data.id)).pop() ?? geometryPath(read.data.id)
    const geometry = editableGeometry(read.sources.geometry, geometryFile, changed, dropped)
    const model = strippedModel(geometry, changed)
    const springs = geometry ? readSprings(geometry) : {}
    const load = loadCosmetic(input.files, input.binary)
    const problems = load ? load.issues.filter((issue) => (issue.level ?? 'error') === 'error').map(cosmeticIssueText) : []
    return { read, model, springs, textures, problems, changed, dropped }
}

export async function readCosmeticZip(name: string, content: ArrayBuffer | Uint8Array): Promise<{ input: BundleFiles, skipped: string[] }> {
    const loader = (globalThis as { JSZip?: ZipLoader }).JSZip
    if (!loader || typeof loader.loadAsync !== 'function') throw new Error('this Blockbench build has no zip reader')
    let zip: { files: Record<string, ZipEntry> }
    try {
        zip = await loader.loadAsync(content)
    } catch (error) {
        throw new Error(`${name} is not a readable zip (${describe(error)})`)
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir)
    if (entries.length > MAX_ENTRIES) throw new Error(`${name} holds ${entries.length} files, more than ${MAX_ENTRIES}`)
    const paths = entries.map((entry) => entry.name.replace(/\\/g, '/').replace(/^\/+/, ''))
    const manifest = paths.filter((path) => !path.includes('__MACOSX/') && (path === MANIFEST || path.endsWith(`/${MANIFEST}`))).sort((a, b) => a.split('/').length - b.split('/').length)[0]
    const prefix = manifest ? manifest.slice(0, manifest.length - MANIFEST.length) : ''
    const input: BundleFiles = { files: {}, binary: {} }
    const skipped: string[] = []
    for (let i = 0; i < entries.length; i++) {
        const path = paths[i]
        if (!path.startsWith(prefix)) continue
        const relative = path.slice(prefix.length)
        if (!relative || relative.startsWith('__MACOSX/')) continue
        const bytes = await entries[i].async('uint8array')
        if (bytes.length > MAX_FILE_BYTES) {
            skipped.push(relative)
            continue
        }
        if (TEXT_FILE.test(relative)) input.files[relative] = new TextDecoder().decode(bytes).replace(/^﻿/, '')
        else input.binary[relative] = bytes
    }
    return { input, skipped }
}

function rigGroup(name: string): Group {
    const known = Group.all.find((group) => (group as any)[RIG_PROPERTY] === true && group.name === name)
    if (known) return known
    const pivot = PLAYER_RIG.find((part) => part.name === name)?.pivot ?? [0, 0, 0]
    const group = new Group({ name, origin: pivot } as any).init()
    ;(group as any)[RIG_PROPERTY] = true
    return group
}

export interface RigPlacement {
    rig: string
    unwrap: boolean
}

export function rigPlacements(bones: ReadonlyArray<Record<string, any>>): Array<RigPlacement | null> {
    const names = new Set(bones.map((bone) => bone.name))
    return bones.map((bone) => {
        const parent = typeof bone.parent === 'string' ? bone.parent : ''
        if (!parent || names.has(parent)) return null
        return { rig: parent, unwrap: bone[RIG_PARTS_KEY] === true }
    })
}

function placeOnRig(model: Record<string, any>, groups: Group[], changed: string[]) {
    const bones: Array<Record<string, any>> = Array.isArray(model.bones) ? model.bones : []
    const placements = rigPlacements(bones)
    bones.forEach((bone, i) => {
        const group = groups[i]
        if (!group) return
        if (group.name !== bone.name) changed.push(`Bone '${bone.name}' is now '${group.name}', since that name was taken`)
        const placement = placements[i]
        if (!placement) return
        const rig = rigGroup(placement.rig)
        if (placement.unwrap) {
            for (const child of [...group.children]) (child as any).addTo(rig)
            group.remove(false)
            return
        }
        group.addTo(rig)
    })
}

export function keepLoadedPixels(texture: Texture) {
    const previous = texture.load_callback
    texture.load_callback = (loaded: Texture) => {
        texture.load_callback = previous
        if (typeof previous === 'function') previous(loaded)
        const canvas = texture.canvas
        const ctx = texture.ctx
        if (!canvas || !ctx || !(canvas.width > 0) || !(canvas.height > 0)) return
        ;(texture as any)[INDEX_PIXELS_PROPERTY] = writeIndexPixels(canvas.width, canvas.height, ctx.getImageData(0, 0, canvas.width, canvas.height).data)
    }
}

function addTextures(textures: readonly ImportTexture[]) {
    for (const texture of textures) {
        const added = new Texture({ name: `${texture.id}.png`, keep_size: true } as TextureData)
        ;(added as any)[PALETTE_PROPERTY] = texture.palette
        ;(added as any)[INDEX_PROPERTY] = texture.index
        ;(added as any)[INDEX_PIXELS_PROPERTY] = texture.pixels
        if (texture.pixels) keepLoadedPixels(added)
        added.fromDataURL(`data:image/png;base64,${toBase64(texture.png)}`)
        added.add(false)
    }
}

function addModel(plan: CosmeticImportPlan) {
    const model = plan.model
    if (!model) return
    const parse = (Codecs as any).bedrock?.parseGeometry
    if (typeof parse !== 'function') throw new Error("this Blockbench build can't read Bedrock models")
    const before = new Set(Group.all)
    parse({ object: cloneJson(model) }, { switch_to_existing_tab: false })
    const groups = Group.all.filter((group) => !before.has(group))
    const bones: Array<Record<string, any>> = Array.isArray(model.bones) ? model.bones : []
    bones.forEach((bone, i) => {
        const spring = plan.springs[bone.name]
        if (spring && groups[i]) (groups[i] as any)[SPRING_PROPERTY] = storedSpring(spring)
    })
    placeOnRig(model, groups, plan.changed)
}

function loadedClips(): any[] {
    const animations: any[] = typeof Animator !== 'undefined' ? Animator.animations ?? [] : []
    const controllers: any[] = typeof AnimationController !== 'undefined' ? (AnimationController as any).all ?? [] : []
    return [...animations, ...controllers]
}

export function withoutSavePaths(load: () => void) {
    const before = new Set(loadedClips())
    try {
        load()
    } finally {
        for (const clip of loadedClips()) if (!before.has(clip) && clip) clip.path = ''
    }
}

function resolveAnimation(animations: readonly any[], key: string): any {
    const exact = animations.find((animation) => animation?.name === key)
    if (exact) return exact
    const found = animations.filter((animation) => typeof animation?.name === 'string' && animation.name.endsWith(`.${key}`))
    return found.length === 1 ? found[0] : null
}

export function linkStateAnimations(controllers: readonly any[], animations: readonly any[]) {
    for (const controller of controllers) {
        for (const state of Array.isArray(controller?.states) ? controller.states : []) {
            for (const entry of Array.isArray(state?.animations) ? state.animations : []) {
                if (typeof entry?.key !== 'string' || !entry.key) continue
                const animation = resolveAnimation(animations, entry.key)
                entry.animation = typeof animation?.uuid === 'string' ? animation.uuid : ''
            }
        }
    }
}

function addAnimations(plan: CosmeticImportPlan) {
    const { data, sources } = plan.read
    const codecs = (globalThis as any).AnimationCodec?.codecs
    const before = new Set(loadedClips())
    withoutSavePaths(() => {
        if (Object.keys(sources.animations).length) {
            const json = { animations: cloneJson(sources.animations) }
            codecs?.bedrock?.loadFile({ path: animationPath(data.id), name: animationPath(data.id), content: JSON.stringify(json), json })
        }
        if (Object.keys(sources.controllers).length) {
            const json = { animation_controllers: cloneJson(sources.controllers) }
            codecs?.bedrock_animation_controller?.loadFile({ path: controllerPath(data.id), name: controllerPath(data.id), content: JSON.stringify(json), json })
        }
    })
    const controllers: any[] = typeof AnimationController !== 'undefined' ? (AnimationController as any).all ?? [] : []
    const animations: any[] = typeof Animator !== 'undefined' ? Animator.animations ?? [] : []
    linkStateAnimations(controllers.filter((controller) => !before.has(controller)), animations)
}

export function applyCosmeticImport(plan: CosmeticImportPlan): boolean {
    const data = plan.read.data
    if (!newCosmeticProject(data.kind, data)) return false
    addTextures(plan.textures)
    addModel(plan)
    addAnimations(plan)
    cosmeticState.write(readCosmetic())
    Project!.name = data.id
    ;(Project as any).geometry_name = data.id
    Canvas.updateAll?.()
    syncCosmeticPanel()
    scheduleChecks()
    return true
}

export function importSummaryHtml(plan: CosmeticImportPlan): string {
    const list = (items: string[]) => htmlList(items, MAX_LISTED)
    const parts = [`Imported ${KIND_NAMES[plan.read.data.kind]} <b>${escapeHtml(plan.read.data.id)}</b>.`]
    if (plan.problems.length) parts.push(`<p>This zip has ${plural(plan.problems.length, 'problem')}. Fix ${plan.problems.length === 1 ? 'it' : 'them'} in Checks to export.</p>${list(plan.problems)}`)
    if (plan.changed.length) parts.push(`<p>Changed on import:</p>${list(plan.changed)}`)
    if (plan.dropped.length) parts.push(`<p>Not imported:</p>${list(plan.dropped)}`)
    if (!plan.changed.length && !plan.dropped.length) parts.push('<p>Everything in the zip is editable.</p>')
    return parts.join('')
}

function showError(message: string) {
    messageBox({ title: TITLE, icon: 'error', message: escapeHtml(message), buttons: ['Close'], width: 640 })
}

export function importCosmeticFiles(input: BundleFiles, skipped: readonly string[] = []): CosmeticImportPlan | null {
    const load = loadCosmetic(input.files, input.binary)
    if (load?.status === 'skipped') {
        showError(`The game would skip this zip. It needs ${load.skipped.join(', ') || 'a newer PolyPlus'}.`)
        return null
    }
    if (load?.status === 'legacy') {
        showError("This zip uses the old pet format, which can't be opened here.")
        return null
    }
    let plan: CosmeticImportPlan
    try {
        plan = planCosmeticImport(input, skipped)
    } catch (error) {
        showError(`The zip couldn't be read: ${describe(error)}`)
        return null
    }
    try {
        if (!applyCosmeticImport(plan)) {
            showError(`Could not create a ${KIND_NAMES[plan.read.data.kind]} project.`)
            return null
        }
    } catch (error) {
        console.error('[polyplus_nameplate] cosmetic import failed', error)
        showError(`Import failed: ${describe(error)}`)
        return null
    }
    messageBox({
        title: TITLE,
        icon: plan.problems.length ? 'warning' : plan.changed.length || plan.dropped.length ? 'info' : 'check_circle',
        message: importSummaryHtml(plan),
        buttons: ['OK'],
        width: 640,
    })
    return plan
}

export async function importCosmeticZip(name: string, content: ArrayBuffer | Uint8Array): Promise<CosmeticImportPlan | null> {
    let read: { input: BundleFiles, skipped: string[] }
    try {
        read = await readCosmeticZip(name, content)
    } catch (error) {
        showError(describe(error))
        return null
    }
    if (!cosmeticKindOf(read.input.files)) {
        showError(`${name} isn't a PolyPlus item, pet, effect or emote zip.`)
        return null
    }
    return importCosmeticFiles(read.input, read.skipped)
}

export function startCosmeticImport() {
    Blockbench.import(
        {
            type: 'PolyPlus Cosmetic',
            extensions: ['zip'],
            multiple: false,
            readtype: 'buffer',
            resource_id: RESOURCE_ID,
            title: TITLE,
        } as any,
        (results: Filesystem.FileResult[]) => {
            const file = results[0]
            if (!file) return
            if (!(file.content instanceof ArrayBuffer)) {
                showError(`${file.name} couldn't be read.`)
                return
            }
            importCosmeticZip(file.name, file.content).catch((error) => {
                console.error('[polyplus_nameplate] cosmetic import failed', error)
                showError(`Import failed: ${describe(error)}`)
            })
        },
    )
}

export function registerCosmeticImport(): () => void {
    const action = defineAction('polyplus_cosmetic_import', {
        name: `${TITLE}...`,
        description: 'Open an item, pet, effect or emote zip as a new project',
        icon: 'unarchive',
        click: () => startCosmeticImport(),
    }, 'file')
    const hints: Array<{ content: unknown[], hint: unknown }> = []
    for (const kind of Object.keys(KIND_NAMES) as CosmeticKind[]) {
        const content = (Formats as any)[COSMETIC_FORMATS[kind]]?.format_page?.content
        if (!Array.isArray(content)) continue
        const hint = { type: 'label', text: `Have a ${KIND_NAMES[kind]} zip? Use **File > ${TITLE}...**` }
        content.push(hint)
        hints.push({ content, hint })
    }
    return () => {
        for (const { content, hint } of hints) {
            const at = content.indexOf(hint)
            if (at >= 0) content.splice(at, 1)
        }
        disposeMenuBarAction(action, 'file')
    }
}

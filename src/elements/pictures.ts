import { ART_PROPERTY, artTexture, readArt } from '../art/layout'
import { isNameplateActive } from '../format'
import { readMaterials } from '../material/state'
import { pictureStem, sanitizeId } from '../palette/ids'
import { undoEdit } from '../util/undo'
import { isLayerNode, isPinnedNode, layerNodes } from './nodes'

const DELETE_EDIT = 'Delete outliner selection'
const REMOVE_EDIT = 'Remove picture'

export function pictureUuidsOf(node: any): string[] {
    if (!node) return []
    const breakpoints: any[] = Array.isArray(node.breakpoints) ? node.breakpoints : []
    const sprites: unknown[] = Array.isArray(node.sprites) ? node.sprites : []
    const art = artTexture(readArt(node[ART_PROPERTY]))?.uuid
    const uuids = [node.texture, ...sprites, ...breakpoints.map((entry) => entry?.texture), art]
    return Array.from(new Set(uuids.filter((uuid): uuid is string => typeof uuid === 'string' && !!uuid)))
}

function effectSpriteIds(): Set<string> {
    const ids = new Set<string>()
    for (const graph of Object.values(readMaterials().graphs)) {
        for (const node of graph?.nodes ?? []) {
            const sprite = node?.type === 'Sprite' ? node.set?.sprite : null
            if (typeof sprite === 'string' && sprite) ids.add(sprite)
        }
    }
    return ids
}

function usedPictureUuids(skip: Set<any> = new Set()): Set<string> {
    const used = new Set<string>()
    for (const node of layerNodes()) if (!skip.has(node)) for (const uuid of pictureUuidsOf(node)) used.add(uuid)
    const sprites = effectSpriteIds()
    if (sprites.size > 0 && typeof Texture !== 'undefined') {
        for (const texture of Texture.all) if (sprites.has(sanitizeId(pictureStem(texture.name)))) used.add(texture.uuid)
    }
    return used
}

export function unusedPictures(): Texture[] {
    if (typeof Texture === 'undefined' || typeof Project === 'undefined' || !Project) return []
    const used = usedPictureUuids()
    return Texture.all.filter((texture) => !used.has(texture.uuid))
}

export function pictureName(texture: Texture): string {
    return pictureStem(texture.name) || 'picture'
}

function refreshPictures() {
    try {
        Canvas.updateAllFaces()
        TextureAnimator.updateButton()
        ;(UVEditor as any).vue?.updateTexture?.()
        BARS.updateConditions()
    } catch (error) {
        console.error('[polyplus_nameplate] could not refresh after removing pictures', error)
    }
}

export function removePictures(textures: Texture[]) {
    const removed = textures.filter((texture) => Texture.all.includes(texture))
    if (removed.length === 0) return
    undoEdit(
        { textures: removed },
        REMOVE_EDIT,
        () => {
            for (const texture of removed) texture.remove(true)
            refreshPictures()
        },
        () => ({ textures: [] }),
    )
}

function selectedGroups(): any[] {
    return (Group.all as any[]).filter((group) => group.selected)
}

function collectDoomed(): { elements: any[], groups: any[], roots: any[], rootGroups: any[] } {
    const roots = (Outliner.selected as any[]).slice()
    const rootGroups = selectedGroups()
    const elements = roots.slice()
    const groups = rootGroups.slice()
    const visit = (node: any) => {
        for (const child of node?.children ?? []) {
            if (child instanceof Group) groups.safePush(child)
            else elements.safePush(child)
            visit(child)
        }
    }
    roots.forEach(visit)
    rootGroups.forEach(visit)
    return { elements, groups, roots, rootGroups }
}

function orphanedBy(elements: any[]): Texture[] {
    const doomed = new Set(elements.filter(isLayerNode))
    if (doomed.size === 0 || typeof Texture === 'undefined') return []
    const owned = new Set<string>()
    for (const node of doomed) for (const uuid of pictureUuidsOf(node)) owned.add(uuid)
    if (owned.size === 0) return []
    const kept = usedPictureUuids(doomed)
    return Texture.all.filter((texture) => owned.has(texture.uuid) && !kept.has(texture.uuid))
}

function canDeleteLayers(): boolean {
    if (!isNameplateActive() || !(Modes.edit || Modes.paint)) return false
    const selected = Outliner.selected as any[]
    if (selected.length === 0 && !Group.first_selected) return false
    return !selected.some(isPinnedNode)
}

function deleteWithPictures(pictures: Texture[]) {
    const { elements, groups, roots, rootGroups } = collectDoomed()
    undoEdit({ elements, groups, selection: true, outliner: true, textures: pictures }, DELETE_EDIT, () => {
        for (const node of roots) node.remove(false)
        for (const group of rootGroups) group.remove(false)
        for (const texture of pictures) texture.remove(true)
        elements.empty()
        groups.empty()
        pictures.empty()
        TickUpdates.selection = true
        refreshPictures()
    })
}

export function deleteSelectedLayers(event?: Event) {
    const pictures = orphanedBy(collectDoomed().elements)
    if (pictures.length === 0) SharedActions.runSpecific('delete', 'outliner', event as any)
    else deleteWithPictures(pictures)
}

export function registerPictureCleanup(): () => void {
    if (typeof SharedActions === 'undefined') return () => {}
    const handler = SharedActions.add('delete', {
        subject: 'nameplate_pictures',
        priority: -0.75,
        condition: () => canDeleteLayers() && orphanedBy(collectDoomed().elements).length > 0,
        run(event: Event) {
            deleteSelectedLayers(event)
        },
    } as any)
    return () => handler.delete()
}

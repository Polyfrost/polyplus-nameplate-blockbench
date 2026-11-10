import { ART_PROPERTY, artTexture, readArt } from '../art/layout'
import { editDoc } from '../doc/store'
import { isNameplateActive } from '../format'
import type { NameplateData } from '../model'
import { frameCountOf } from '../palette/sprites'
import { createBlankTexture, freeTextureName } from '../sprite'
import { messageBox } from '../util/dialogs'
import { cloneJson } from '../util/json'
import { setFrameCount } from '../util/texture'
import { pluralWord } from '../util/text'
import { sanitizeLayerId, uniqueLayerId } from './ids'
import { pictureUuidsOf } from './pictures'
import { pictureStem } from '../palette/ids'
import { isGroupNode, isLayerNode, selectedPinnedNode, usedLayerNames, walkNodes } from './nodes'

const PINNED_MESSAGE = "Name text, Badge and Whole nameplate can't be duplicated. A nameplate has one of each."
const NOTHING_MESSAGE = 'Select a layer to duplicate it.'

type Pair = [source: any, copy: any]

function isInside(node: any, groups: any[]): boolean {
    for (let parent = node.parent; parent && parent !== 'root'; parent = parent.parent) {
        if (groups.includes(parent)) return true
    }
    return false
}

function selectedRoots(): any[] {
    const groups = ((Group.multi_selected ?? []) as any[]).filter(isGroupNode)
    const layers = (Outliner.selected as any[]).filter(isLayerNode)
    return [...groups, ...layers].filter((node) => !isInside(node, groups))
}

function pairUp(source: any, copy: any, pairs: Pair[]) {
    pairs.push([source, copy])
    if (!isGroupNode(source)) return
    const twins: any[] = copy.children ?? []
    source.children.forEach((child: any, index: number) => {
        if (twins[index]) pairUp(child, twins[index], pairs)
    })
}

function nodesUnder(root: any): any[] {
    const nodes: any[] = []
    walkNodes((node) => {
        if (isLayerNode(node)) nodes.push(node)
    }, [root])
    return nodes
}

function picturesOf(roots: any[]): Texture[] {
    const uuids = new Set(roots.flatMap(nodesUnder).flatMap(pictureUuidsOf))
    return Texture.all.filter((texture) => uuids.has(texture.uuid) && (texture.canvas?.width ?? 0) > 0)
}

function copyPicture(source: Texture): Texture {
    const canvas = source.canvas
    const name = freeTextureName(pictureStem(source.name).replace(/_\d+$/, ''))
    const texture = createBlankTexture(
        { name, width: canvas.width, height: canvas.height, frames: 1 },
        { select: false, draw: (ctx) => ctx.drawImage(canvas, 0, 0) },
    )
    setFrameCount(texture, frameCountOf(source))
    return texture
}

function usePictures(node: any, copies: Map<string, string>) {
    const swap = (uuid: string) => copies.get(uuid) ?? uuid
    if (typeof node.texture === 'string') node.texture = swap(node.texture)
    if (Array.isArray(node.sprites)) node.sprites = node.sprites.map(swap)
    if (Array.isArray(node.breakpoints)) {
        node.breakpoints = node.breakpoints.map((entry: any) => (entry?.texture ? { ...entry, texture: swap(entry.texture) } : entry))
    }
    const artUuid = artTexture(readArt(node[ART_PROPERTY]))?.uuid
    if (artUuid && copies.has(artUuid)) node[ART_PROPERTY] = { ...node[ART_PROPERTY], texture: copies.get(artUuid) }
}

function detachValues(source: any, copy: any) {
    for (const key of Object.keys(copy.constructor.properties ?? {})) {
        const value = source[key]
        if (value && typeof value === 'object') copy[key] = cloneJson(value)
    }
}

function nameCopies(pairs: Pair[], taken: Set<string>) {
    for (const [source, copy] of pairs) {
        const name = uniqueLayerId(sanitizeLayerId(source.name).replace(/_\d+$/, ''), taken)
        taken.add(name)
        copy.name = name
    }
}

function relink(pairs: Pair[]) {
    const twins = new Map<string, string>(pairs.map(([source, copy]) => [source.uuid, copy.uuid]))
    for (const [, copy] of pairs) {
        for (const key of ['of', 'mask']) {
            const twin = twins.get(copy[key])
            if (twin) copy[key] = twin
        }
    }
}

function copyVariantChoices(plate: NameplateData, pairs: Pair[]) {
    const twins = new Map<string, string>(pairs.map(([source, copy]) => [source.uuid, copy.uuid]))
    for (const variant of Object.values(plate.variants)) {
        variant.hide = [...variant.hide, ...variant.hide.flatMap((uuid) => twins.get(uuid) ?? [])]
        for (const [from, to] of Object.entries(variant.swap)) {
            const copy = twins.get(from)
            if (copy) variant.swap[copy] = twins.get(to) ?? to
        }
    }
}

export function keyedAnimations(nodes: any[]): any[] {
    const all: any[] = Animator.animations ?? []
    return all.filter((animation) => nodes.some((node) => (animation.animators?.[node.uuid]?.keyframes?.length ?? 0) > 0))
}

export function copyKeys(pairs: Pair[], animations: any[]) {
    for (const animation of animations) {
        for (const [source, copy] of pairs) {
            const keys: any[] = animation.animators?.[source.uuid]?.keyframes ?? []
            if (keys.length === 0) continue
            const target = animation.getBoneAnimator(copy)
            for (const key of keys) target.addKeyframe(key.getUndoCopy())
        }
    }
}

function selectCopies(copies: any[]) {
    copies.forEach((copy, index) => {
        if (index === 0) copy.select()
        else if (isGroupNode(copy)) copy.multiSelect()
        else copy.markAsSelected()
    })
    updateSelection()
}

function unselectEverything() {
    unselectAllElements()
    for (const group of ((Group.multi_selected ?? []) as any[]).slice()) group.unselect?.()
}

function duplicate(roots: any[], pictures: Texture[]) {
    const originals: any[] = []
    walkNodes((node) => {
        if (isGroupNode(node) || isLayerNode(node)) originals.push(node)
    }, roots)
    const animations = keyedAnimations(originals)
    const elements: any[] = []
    const groups: any[] = []
    const textures: Texture[] = []
    const aspects: any = { elements, groups, textures, animations, outliner: true, selection: true, bitmap: true }
    const taken = usedLayerNames()
    const made = editDoc(
        ['nameplate'],
        { label: (made: { pairs: Pair[] }) => (made.pairs.length === 1 ? 'Duplicate layer' : 'Duplicate layers'), aspects },
        ({ nameplate: plate }) => {
            unselectEverything()
            const pairs: Pair[] = []
            const copies = roots.map((root) => {
                const copy = root.duplicate()
                pairUp(root, copy, pairs)
                return copy
            })
            const copied = new Map<string, string>()
            for (const picture of pictures) {
                const texture = copyPicture(picture)
                textures.push(texture)
                copied.set(picture.uuid, texture.uuid)
            }
            for (const [source, copy] of pairs) {
                detachValues(source, copy)
                if (isGroupNode(copy)) groups.push(copy)
                else {
                    elements.push(copy)
                    usePictures(copy, copied)
                }
            }
            nameCopies(pairs, taken)
            relink(pairs)
            copyKeys(pairs, animations)
            copyVariantChoices(plate, pairs)
            selectCopies(copies)
            return { copies, pairs }
        },
    )
    const copies = made?.copies ?? []
    Blockbench.dispatchEvent('update_selection', {} as any)
    const first = copies[0]?.name ?? ''
    Blockbench.showQuickMessage(copies.length === 1 ? `Copied to '${first}', in the same place` : `Copied ${copies.length} layers, in the same place`, 2000)
}

function askAboutPictures(roots: any[], pictures: Texture[]) {
    const subject = roots.length === 1 ? `'${roots[0].name}' uses` : 'These layers use'
    const names = pictures.map((texture) => `'${texture.name}'`).join(', ')
    const word = pluralWord(pictures.length, 'picture')
    messageBox(
        {
            title: 'Duplicate',
            icon: 'content_copy',
            message: `${subject} the ${word} ${names}. Painting a shared picture changes the original and the copy together.`,
            buttons: [`Copy the ${word} too`, `Share the ${word}`, 'Cancel'],
            width: 520,
        },
        (button) => {
            if (button === 0) duplicate(roots, pictures)
            else if (button === 1) duplicate(roots, [])
        },
    )
}

function run() {
    const roots = selectedRoots()
    if (roots.length === 0) {
        Blockbench.showQuickMessage(selectedPinnedNode() ? PINNED_MESSAGE : NOTHING_MESSAGE, 2500)
        return
    }
    const pictures = picturesOf(roots)
    if (pictures.length > 0) askAboutPictures(roots, pictures)
    else duplicate(roots, [])
}

export function registerDuplicate(): () => void {
    if (typeof SharedActions === 'undefined') return () => {}
    const handlers = [
        SharedActions.add('duplicate', {
            subject: 'nameplate_layers',
            priority: -0.5,
            condition: () => isNameplateActive() && (selectedRoots().length > 0 || !!selectedPinnedNode()),
            run,
        } as any),
        SharedActions.add('duplicate', {
            subject: 'nameplate_paint',
            priority: 1,
            condition: () => isNameplateActive() && Prop.active_panel === 'uv' && !!Modes.paint,
            run,
        } as any),
    ]
    return () => {
        for (const handler of handlers) handler.delete()
    }
}

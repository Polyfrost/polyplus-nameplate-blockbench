import { layerNodes, primarySelectedNode } from './elements/nodes'
import { SPRITE_TYPE } from './model'
import { findTexture } from './util/texture'

export const DESIGN_MODE = 'paint'

type ModeId = 'design' | 'animate'

export function goMode(id: ModeId) {
    const key = id === 'design' ? DESIGN_MODE : id
    const mode = typeof Modes === 'undefined' ? undefined : Modes.options[key]
    if (!mode || Modes.selected === mode) return
    try {
        mode.trigger()
    } catch (error) {
        console.error(`[polyplus_nameplate] could not switch to ${id} mode`, error)
    }
}

export function textureOf(node: any): Texture | undefined {
    if (!node || node.type !== SPRITE_TYPE || !node.texture) return undefined
    return findTexture(node.texture)
}

export function showTexture(texture: Texture | undefined) {
    if (!texture || texture.selected) return
    try {
        texture.select()
    } catch (error) {
        console.error('[polyplus_nameplate] could not open the texture', error)
    }
}

export function showLayer(node: any, texture: Texture | undefined = textureOf(node)) {
    goMode('design')
    try {
        node.select()
    } catch (error) {
        console.error('[polyplus_nameplate] could not select the layer', error)
    }
    showTexture(texture)
}

function ownsPicture(node: any, uuid: string): boolean {
    return !!node && (node.texture === uuid || (Array.isArray(node.sprites) && node.sprites.includes(uuid)))
}

export function paintTexture(texture: Texture) {
    const owner = ownsPicture(primarySelectedNode(), texture.uuid) ? null : layerNodes().find((node) => ownsPicture(node, texture.uuid))
    if (owner) {
        showLayer(owner, texture)
        return
    }
    goMode('design')
    showTexture(texture)
}

import { paintTexture } from '../navigate'
import { defineDesignAction } from '../util/actions'
import { createBlankTexture, drawOrnament, promptSprite, SpriteSpec } from '../sprite'
import { undoEdit } from '../util/undo'
import { LayerTypes } from './classes'
import { firstBodyUuid, freeLayerName, placeNode, primarySelectedNode, selectedLayerNodes } from './nodes'

const ACTION_BODY = 'polyplus_nameplate_add_body'
const ACTION_SPRITE = 'polyplus_nameplate_add_sprite'
const ACTION_TEXTURE = 'polyplus_nameplate_new_texture'
const ACTION_GROUP = 'polyplus_nameplate_add_group'
const BODY_PADDING = [4, 3, 4, 3]
const BODY_RADIUS = 3

let activeTypes: LayerTypes | null = null

function bodyData(): Record<string, unknown> {
    const paletteSlots: Array<{ id: string }> | null = typeof Project !== 'undefined' && Project ? (Project as any).nameplate?.palette?.slots : null
    const slots = Array.isArray(paletteSlots) ? paletteSlots.map((slot) => slot.id) : []
    const fill = slots[0] ? `${slots[0]}[1]` : ''
    const border = slots[1] ?? slots[0] ?? ''
    return {
        name: freeLayerName('body'),
        depth: 'background',
        padding: BODY_PADDING.slice(),
        radius: BODY_RADIUS,
        fill: { kind: 'color', ref: fill },
        rings: border ? [{ kind: 'color', ref: border }] : [],
    }
}

export function addBodyLayer(): any {
    const types = activeTypes
    if (!types) return null
    const created: any[] = []
    return undoEdit({ elements: created, outliner: true, selection: true }, 'Add body', () => {
        const element = new types.body(bodyData())
        placeNode(element)
        element.init()
        element.select()
        created.push(element)
        return element
    })
}

function spriteLayer(types: LayerTypes, textureUuid: string, extra: Record<string, unknown> = {}): any {
    return new types.sprite({
        name: freeLayerName('sprite'),
        depth: 'over_background',
        anchor: 'top_left',
        texture: textureUuid,
        ...extra,
    })
}

export function addSpriteWithTexture(spec: SpriteSpec): { layer: any, texture: Texture } | null {
    const types = activeTypes
    if (!types) return null
    const created: any[] = []
    const textures: Texture[] = []
    return undoEdit({ elements: created, outliner: true, textures, bitmap: true, selection: true }, 'Add sprite', () => {
        const texture = createBlankTexture(spec, { select: false, draw: drawOrnament })
        textures.push(texture)
        const layer = spriteLayer(types, texture.uuid, { name: freeLayerName(spec.name), of: firstBodyUuid(), anchor: 'top_left', pivot: 'bottom_right' })
        placeNode(layer)
        layer.init()
        layer.select()
        texture.select()
        created.push(layer)
        return { layer, texture }
    })
}

export function addStarterSprite(spec: SpriteSpec, body?: any): { layer: any, texture: Texture } | null {
    const types = activeTypes
    if (!types) return null
    const texture = createBlankTexture(spec, { select: false, draw: drawOrnament })
    const layer = spriteLayer(types, texture.uuid, {
        name: freeLayerName('ornament'),
        of: body?.uuid ?? '',
        anchor: 'left',
        pivot: 'right',
        offset: [-1, 0],
    })
    layer.addTo('root', 0)
    layer.init()
    return { layer, texture }
}

export function addStarterBody(): any {
    const types = activeTypes
    if (!types) return null
    const body = new types.body(bodyData())
    body.addTo('root', 0)
    body.init()
    return body
}

export function startAddSprite() {
    promptSprite('Add Sprite', (spec, paintNow) => {
        const result = addSpriteWithTexture(spec)
        if (result && paintNow) paintTexture(result.texture)
    })
}

export function startNewTexture() {
    promptSprite('New Sprite Picture', (spec, paintNow) => {
        const created: Texture[] = []
        const texture = undoEdit({ textures: created, bitmap: true }, 'New sprite picture', () => {
            const texture = createBlankTexture(spec, { draw: drawOrnament })
            created.push(texture)
            return texture
        })
        if (paintNow) paintTexture(texture)
    })
}

export function addGroup(): any {
    if (typeof Group === 'undefined') return null
    const anchor = primarySelectedNode()
    const moving = selectedLayerNodes()
    const groups: any[] = []
    return undoEdit({ outliner: true, groups, selection: true }, 'Group layers', () => {
        const group: any = new Group({ name: freeLayerName('group') } as any)
        group.isOpen = true
        if (anchor) {
            const siblings: any[] = anchor.getParentArray()
            group.addTo(anchor.parent, Math.max(0, siblings.indexOf(anchor)))
        } else {
            group.addTo('root', 0)
        }
        group.init()
        for (const node of moving) node.addTo(group, -1)
        group.select()
        groups.push(group)
        return group
    })
}

export function registerActions(types: LayerTypes): () => void {
    activeTypes = types

    const body = defineDesignAction(
        ACTION_BODY,
        {
            name: 'Add Body',
            description: 'The colored shape behind the name',
            icon: 'rounded_corner',
            click() {
                addBodyLayer()
            },
        },
        'edit',
    )

    const sprite = defineDesignAction(
        ACTION_SPRITE,
        {
            name: 'Add Sprite',
            description: 'A small picture placed outside the first body',
            icon: 'image',
            click() {
                startAddSprite()
            },
        },
        'edit',
    )

    const texture = defineDesignAction(
        ACTION_TEXTURE,
        {
            name: 'New Sprite Picture',
            description: 'A new picture with no layer',
            icon: 'add_photo_alternate',
            click() {
                startNewTexture()
            },
        },
        'edit',
    )

    const group = defineDesignAction(ACTION_GROUP, {
        name: 'Group Layers',
        description: 'Put the selected layers in a new group',
        icon: 'create_new_folder',
        click() {
            addGroup()
        },
    })

    return () => {
        activeTypes = null
        for (const action of [body, sprite, texture, group]) action.delete()
    }
}

import { BODY_TYPE } from '../model'
import { primarySelectedNode } from '../elements/nodes'
import { showTexture } from '../navigate'
import { frameCountOf } from '../palette/sprites'
import { createBlankTexture, Draw, placeholderColors, promptSprite } from '../sprite'
import { ART_PROPERTY, artTexture, readArt } from './layout'
import { defaultArt, fitsSize } from './cuts'
import { openArtDialog } from './dialog'
import { heading } from '../util/form'
import { findTexture } from '../util/texture'
import { undoEdit } from '../util/undo'

type FormConfig = Record<string, FormElementOptions | '_'>

function currentBody(): any | null {
    const node = primarySelectedNode()
    return node?.type === BODY_TYPE ? node : null
}

function pictureSize(texture: Texture): { width: number, height: number } {
    const frames = frameCountOf(texture)
    return { width: Math.max(1, texture.canvas?.width ?? texture.width ?? 1), height: Math.max(1, Math.floor((texture.canvas?.height ?? texture.height ?? 1) / frames)) }
}

function pictureChoices(current: string): Record<string, string> {
    const options: Record<string, string> = { '': 'None (shape and fill only)' }
    for (const texture of Texture.all) {
        const frames = frameCountOf(texture)
        if (frames === 1) options[texture.uuid] = texture.name
        else if (texture.uuid === current) options[texture.uuid] = `${texture.name} (${frames} frames: needs 1)`
    }
    if (current && !(current in options)) options[current] = 'Missing picture'
    return options
}

const drawBodyPicture: Draw = (ctx, spec) => {
    const colors = placeholderColors()
    const { width, height } = spec
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const edgeX = x === 0 || x === width - 1
            const edgeY = y === 0 || y === height - 1
            if (edgeX && edgeY && width > 2 && height > 2) continue
            ctx.fillStyle = edgeX || edgeY ? colors.light : colors.main
            ctx.fillRect(x, y, 1, 1)
        }
    }
}

function makePicture() {
    const body = currentBody()
    if (!body) return
    promptSprite('New Body Picture', (spec, paintNow) => {
        const texture = createBlankTexture({ ...spec, frames: 1 }, { select: paintNow, draw: drawBodyPicture })
        const size = { width: spec.width, height: spec.height }
        undoEdit({ elements: [body] }, 'Add body picture', () => {
            body[ART_PROPERTY] = defaultArt(texture.uuid, size)
        })
        Blockbench.dispatchEvent('update_selection', {} as any)
        if (!paintNow) window.setTimeout(() => openArtDialog(body), 50)
    }, `${String(body.name ?? '') || 'body'}_art`, { frames: false })
}

function hasFillOrOutlines(body: any): boolean {
    const kind = body?.fill?.kind
    return (!!kind && kind !== 'none') || (Array.isArray(body?.rings) && body.rings.length > 0)
}

function clearFillAndOutlines() {
    const body = currentBody()
    if (!body) return
    undoEdit({ elements: [body] }, 'Turn off fill and outlines', () => {
        body.fill = { kind: 'none' }
        body.rings = []
    })
    Blockbench.dispatchEvent('update_selection', {} as any)
}

export function artFormConfig(node: any): FormConfig {
    const current = artTexture(readArt(node?.[ART_PROPERTY]))?.uuid ?? ''
    return {
        art_title: heading('Body picture'),
        art_texture: {
            type: 'select',
            label: 'Picture',
            options: pictureChoices(current),
            description: 'Paint the whole body as one picture. It is drawn over the fill and outlines',
        },
        art_new: {
            type: 'buttons',
            buttons: ['Make a new picture'],
            condition: (result: any) => !result?.art_texture,
            click: () => makePicture(),
        },
        art_edit: {
            type: 'buttons',
            buttons: ['Set the ends and middle', 'Paint the picture'],
            condition: (result: any) => !!result?.art_texture,
            click: (index: number) => {
                const body = currentBody()
                if (!body) return
                if (index === 0) openArtDialog(body)
                else showTexture(artTexture(readArt(body[ART_PROPERTY])) ?? undefined)
            },
        },
        art_plain: {
            type: 'buttons',
            buttons: ['Turn off fill and outlines'],
            condition: (result: any) => !!result?.art_texture && hasFillOrOutlines(currentBody()),
            click: () => clearFillAndOutlines(),
        },
    }
}

export function artFormValues(node: any): Record<string, unknown> {
    return { art_texture: artTexture(readArt(node?.[ART_PROPERTY]))?.uuid ?? '' }
}

export function isArtKey(key: string): boolean {
    return key.startsWith('art_')
}

export function applyArtField(node: any, key: string, result: Record<string, any>): boolean {
    if (key !== 'art_texture') return isArtKey(key)
    const uuid = String(result.art_texture ?? '')
    if (!uuid) {
        node[ART_PROPERTY] = {}
        return true
    }
    const texture = findTexture(uuid)
    if (!texture) return true
    const size = pictureSize(texture)
    const current = readArt(node[ART_PROPERTY])
    const kept = current ? { ...current, texture: uuid } : null
    node[ART_PROPERTY] = kept && fitsSize(kept, size) ? kept : defaultArt(uuid, size)
    return true
}

export function openArtAfterPick(node: any, hadArt: boolean) {
    if (hadArt || !readArt(node?.[ART_PROPERTY])) return
    window.setTimeout(() => openArtDialog(node), 50)
}

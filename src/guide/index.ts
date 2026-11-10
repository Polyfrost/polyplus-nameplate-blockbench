import { classifyIssue, IssueCode } from '../checks/codes'
import { currentFps, currentLoopFrames, frameDivisors, maxLoopFrames } from '../format'
import { findTexture } from '../util/texture'
import { joinList, pluralWord, quotedList } from '../util/text'
import { readLayers, readLoop } from '../elements'
import { BundleIssue } from '../model'
import { layerTextureUuids } from '../motion/compile'
import { pictureStem, sanitizeId } from '../palette/ids'
import { frameCountOf } from '../palette/sprites'
import { MAX_SPRITE_FRAMES } from '../sprite'

export interface GuidePixel {
    texture: string
    frame: number
    x: number
    y: number
}

export interface GuideTarget {
    kind: 'layer' | 'texture' | 'pixel'
    uuid: string
    pixel?: GuidePixel
}

export interface GuideIssue {
    code: IssueCode
    text: string
    target: GuideTarget | null
    count?: number
}

function textureName(uuid: string): string {
    return findTexture(uuid)?.name ?? 'A picture'
}

function spriteOwner(spriteId: string): Texture | undefined {
    if (typeof Texture === 'undefined') return undefined
    return Texture.all.find((entry) => sanitizeId(pictureStem(entry.name)) === spriteId)
}

function layersUsing(uuid: string): Array<{ id: string, uuid: string }> {
    return readLayers().filter((layer) => layerTextureUuids(layer as any).includes(uuid))
}

function onLayers(uuid: string): string {
    const names = layersUsing(uuid).map((layer) => layer.id)
    return names.length === 0 ? '' : ` on ${pluralWord(names.length, 'layer')} ${quotedList(names)}`
}

function commonMultiple(a: number, b: number): number {
    let x = a
    let y = b
    while (y !== 0) [x, y] = [y, x % y]
    return (a / x) * b
}

function fittingLoops(): number[] {
    const keyed = new Set((readLoop(currentFps())?.tracks ?? []).filter((track) => track.channel === 'frame').map((track) => track.target))
    let unit = 1
    for (const layer of readLayers()) {
        if (layer.kind !== 'sprite' && layer.kind !== 'path') continue
        if (keyed.has(layer.id) || (layer.kind === 'path' && Object.keys(layer.facings).length > 0)) continue
        const texture = findTexture(layer.texture)
        if (texture) unit = commonMultiple(unit, frameCountOf(texture) * Math.max(1, layer.step))
    }
    const loop = currentLoopFrames()
    const below = Math.floor((loop - 1) / unit) * unit
    const above = (Math.floor(loop / unit) + 1) * unit
    return [below, above].filter((frames) => frames >= 1 && frames <= maxLoopFrames())
}

function loopAdvice(): string {
    const loops = fittingLoops()
    return loops.length === 0 ? '' : ` Or set the loop to ${joinList(loops, 'or')} frames (Loop length... with nothing selected).`
}

export function explainIssues(issues: BundleIssue[]): GuideIssue[] {
    const layerByFile = new Map<string, string>()
    for (const layer of readLayers()) layerByFile.set(layer.id, layer.uuid)

    const result: GuideIssue[] = []
    const pixels = new Map<string, { count: number, first: GuidePixel }>()
    for (const issue of issues) {
        const facts = classifyIssue(issue)
        switch (facts.code) {
            case 'off_palette': {
                const uuid = facts.texture ?? ''
                const entry = pixels.get(uuid)
                if (entry) entry.count++
                else pixels.set(uuid, { count: 1, first: { texture: uuid, frame: facts.values.frame ?? 0, x: facts.values.x ?? 0, y: facts.values.y ?? 0 } })
                continue
            }
            case 'texture': {
                const uuid = facts.texture ?? ''
                result.push({ code: 'texture', text: `${textureName(uuid)}: ${issue.message}.`, target: { kind: 'texture', uuid } })
                continue
            }
            case 'sprite_without_texture': {
                const uuid = facts.layer ? layerByFile.get(facts.layer) : undefined
                result.push({
                    code: 'sprite_without_texture',
                    text: issue.message.includes('sprite data')
                        ? `Layer '${facts.layer}' lost its picture. Pick another under Picture in the Inspector, or undo.`
                        : `Layer '${facts.layer}' has no picture. Pick one under Picture in the Inspector.`,
                    target: uuid ? { kind: 'layer', uuid } : null,
                })
                continue
            }
            case 'sprite_frames': {
                const sprite = facts.sprite ?? ''
                const owner = spriteOwner(sprite)
                const counted = facts.values.frames !== undefined && facts.values.cycle !== undefined
                const cycle = counted ? facts.values.cycle : currentLoopFrames()
                const has = counted ? ` has ${facts.values.frames} frames, which` : ' has a frame count that'
                const users = owner ? layersUsing(owner.uuid) : []
                const formula = counted ? `math.mod(q.frame, ${facts.values.frames})` : 'math.mod(q.frame, 4)'
                result.push({
                    code: 'sprite_frames',
                    text: `Picture '${sprite}'${owner ? onLayers(owner.uuid) : ''}${has} doesn't fit its ${cycle}-frame loop. Set Frames to ${joinList(frameDivisors(cycle, MAX_SPRITE_FRAMES), 'or')} in the Inspector.${loopAdvice()} Or add one Frame keyframe in the loop with the formula ${formula}.`,
                    target: users.length > 0 ? { kind: 'layer', uuid: users[0].uuid } : owner ? { kind: 'texture', uuid: owner.uuid } : null,
                })
                continue
            }
            case 'no_layers':
                result.push({ code: 'no_layers', text: 'Add at least one layer: a body or a sprite.', target: null })
                continue
            default:
                result.push({ code: facts.code, text: issue.path ? `${issue.path}: ${issue.message}` : issue.message, target: null })
        }
    }
    for (const [uuid, entry] of pixels) {
        const first = entry.first
        const one = entry.count === 1
        const noun = one ? '1 pixel is' : `${entry.count} pixels are`
        const where = one
            ? ` It is marked in pink: frame ${first.frame}, x ${first.x}, y ${first.y}. Repaint it with a color from the Colors strip, or erase it.`
            : ` They are marked in pink, first at frame ${first.frame}, x ${first.x}, y ${first.y}. Repaint them with colors from the Colors strip, or erase them.`
        const snap = ' Or use Picture options (three dots) > Snap to Palette.'
        result.unshift({
            code: 'off_palette',
            text: `${textureName(uuid)}${onLayers(uuid)}: ${noun} not a palette color.${where}${snap}`,
            target: { kind: 'pixel', uuid, pixel: first },
            count: entry.count,
        })
    }
    return result
}

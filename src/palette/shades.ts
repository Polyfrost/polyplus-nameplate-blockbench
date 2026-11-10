import { BODY_TYPE, NameplateData } from '../model'
import { layerNodes } from '../elements/nodes'
import { FLAGS_ASPECT, notifyFlagsChanged, readFlags, writeFlags } from '../flags/state'
import { materialsAspect, notifyMaterialsChanged, readMaterials, writeMaterials } from '../material/state'
import { SLOT_MOLANG_ASPECT, readSlotMolang, writeSlotMolang } from '../molang/slots'
import { ANIMATION_PALETTE } from '../palanim/reaction'
import { toneRemap, texturesUsing, recolorTextures } from './pixels'
import { commit, notifyNameplateChanged, readNameplate } from './state'
import { allAnimations } from '../util/animation'
import { messageBox } from '../util/dialogs'
import { cloneJson } from '../util/json'
import { bulletList } from '../util/text'
import { hasProject } from '../util/project'
import { undoEdit } from '../util/undo'
import {
    MoveReport,
    ShadeMove,
    emptyReport,
    isIdentity,
    moveBodyRefs,
    moveFlagRefs,
    moveGraphRefs,
    moveMolangRefs,
    movePlateRefs,
    moveStoredPalette,
    newTone,
} from './refs'

type ShadeChange = (plate: NameplateData) => ShadeMove | null | void

const MAX_LISTED = 12

function animations(): any[] {
    return allAnimations().filter((animation) => {
        const stored = animation?.[ANIMATION_PALETTE]
        return stored && typeof stored === 'object' && !Array.isArray(stored) && Object.keys(stored).length > 0
    })
}

function bodies(): any[] {
    return layerNodes().filter((node) => node.type === BODY_TYPE)
}

function tell(move: ShadeMove, report: MoveReport, textures: string[]) {
    const removed = move.removed[0]
    if (removed === undefined) return
    const moved = [...report.moved, ...textures.map((name) => `pixels in '${name}'`)]
    if (moved.length === 0 && report.dropped.length === 0) return
    const target = newTone(move, removed) + 1
    const parts: string[] = []
    if (moved.length) parts.push(`These used shade ${removed + 1} of '${move.name}'. They now use shade ${target}, the closest color that is left:\n\n${bulletList(moved, MAX_LISTED)}`)
    if (report.dropped.length) parts.push(`Removed with the shade:\n\n${bulletList(report.dropped, MAX_LISTED)}`)
    parts.push('Undo brings the shade back.')
    messageBox({ title: 'Shade Removed', icon: 'palette', message: parts.join('\n\n') })
}

function applyMove(move: ShadeMove, plate: NameplateData, body: any[], animated: any[], report: MoveReport) {
    movePlateRefs(plate, move, report)
    for (const node of body) {
        const fill = cloneJson(node.fill)
        const rings = cloneJson(node.rings)
        const target = { name: node.name, fill, rings }
        moveBodyRefs(target, move, report)
        node.fill = target.fill
        node.rings = target.rings
    }
    const flags = readFlags()
    moveFlagRefs(flags, move, report)
    writeFlags(flags)
    const materials = readMaterials()
    moveGraphRefs(materials.graphs as any, move, report)
    writeMaterials(materials)
    for (const animation of animated) {
        animation[ANIMATION_PALETTE] = moveStoredPalette(animation[ANIMATION_PALETTE], move, String(animation.name ?? ''), plate.palette.slots, report)
    }
    const molang = readSlotMolang()
    const nameOf = (id: string) => plate.palette.slots.find((slot) => slot.id === id)?.name ?? id
    moveMolangRefs(molang, move, report, nameOf)
    writeSlotMolang(molang)
}

interface ShadeOptions {
    repaint?: boolean
    finish?: (plate: NameplateData) => void
}

export function commitShades(label: string, change: ShadeChange, options: ShadeOptions = {}): boolean {
    const repaint = options.repaint !== false
    if (!hasProject()) return false
    const probe = change(readNameplate())
    if (!probe || isIdentity(probe)) {
        return commit(label, (plate) => {
            change(plate)
            options.finish?.(plate)
        }, repaint && probe ? (before, after) => toneRemap(before.palette, after.palette, probe.slot, (tone) => tone) : undefined)
    }
    const body = bodies()
    const animated = animations()
    const aspects = {
        nameplate: true,
        textures: [],
        bitmap: true,
        elements: body,
        animations: animated,
        [FLAGS_ASPECT]: true,
        [SLOT_MOLANG_ASPECT]: true,
        ...materialsAspect(),
    }
    const plate = readNameplate()
    Project.nameplate = plate
    const before = cloneJson(plate)
    const report = emptyReport()
    const { move, textureNames } = undoEdit(aspects, label, (save) => {
        const move = change(plate)
        let textureNames: string[] = []
        if (move) {
            applyMove(move, plate, body, animated, report)
            if (repaint) {
                const map = toneRemap(before.palette, plate.palette, move.slot, (tone) => newTone(move, tone))
                const textures = texturesUsing(map)
                for (const texture of textures) save?.addTexture?.(texture)
                recolorTextures(textures, map)
                if (move.removed.length) textureNames = textures.map((texture) => String(texture.name ?? 'texture'))
            }
        }
        options.finish?.(plate)
        Project.nameplate = plate
        return { move, textureNames }
    })
    notifyNameplateChanged()
    notifyFlagsChanged()
    notifyMaterialsChanged()
    if (move) tell(move, report, textureNames)
    return true
}

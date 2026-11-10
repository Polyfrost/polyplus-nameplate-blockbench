import { primarySelectedNode } from '../elements/nodes'
import { currentFps, isNameplateActive } from '../format'
import { LOOP_ANIMATION } from '../model'
import { findLoopAnimation } from '../util/animation'
import { goMode } from '../navigate'
import { pictureStem } from '../palette/ids'
import { readNameplate } from '../palette/state'
import { confirmBox, messageBox } from '../util/dialogs'
import { escapeHtml, htmlList, plural } from '../util/text'
import {
    canMakeAnimation,
    capturePreset,
    channelLabel,
    insertPreset,
    keyedNodes,
    kindNoun,
    NEW_ANIMATION,
    nodeKind,
    nodeLabel,
    playsLabel,
    presetTargets,
} from './animation'
import { capturePalette, insertPalette, PaletteMode } from './palette'
import { captureSprite, ColorMode, insertSprite } from './sprite'
import {
    addItem,
    addItems,
    AnimationItem,
    deleteItem,
    findItem,
    LibraryItem,
    libraryFile,
    libraryItems,
    mergeItems,
    PaletteItem,
    parseLibraryFile,
    renameItem,
    SpriteItem,
} from './store'

const TITLE = 'Nameplate Library'
const RESOURCE_ID = 'polyplus_nameplate_library'
const FILE_TYPE = 'Nameplate Library'
const MAX_LISTED = 12

function message(icon: string, text: string, items: string[] = []) {
    messageBox({
        title: TITLE,
        icon,
        message: `<p>${escapeHtml(text)}</p>${items.length > 0 ? htmlList(items, MAX_LISTED) : ''}`,
        buttons: ['OK'],
        width: 520,
    })
}

const openDialogs = new Set<Dialog>()

function track(dialog: Dialog | null | undefined) {
    for (const known of Array.from(openDialogs)) {
        if (!Dialog.stack.includes(known)) openDialogs.delete(known)
    }
    if (dialog) openDialogs.add(dialog)
}

function showDialog(dialog: Dialog) {
    track(dialog)
    dialog.show()
}

export function closeLibraryDialogs() {
    for (const dialog of Array.from(openDialogs)) {
        try {
            dialog.close()
        } catch (error) {
            console.error('[polyplus_nameplate] could not close a library dialog', error)
        }
    }
    openDialogs.clear()
}

function stored(error: string | null, name: string): boolean {
    if (error) {
        message('error', error)
        return false
    }
    Blockbench.showQuickMessage(`Saved '${name}' to the library`, 1500)
    return true
}

function nameField(value: string): FormElementOptions {
    return { type: 'text', label: 'Name in the library', value } as any
}

function typedName(result: any, fallback: string): string {
    const text = String(result?.name ?? '').trim()
    return text || fallback
}

export function openSaveSpriteDialog(texture: Texture | null | undefined) {
    if (!texture || !isNameplateActive()) return
    const capture = captureSprite(texture, pictureStem(texture.name), readNameplate().palette)
    const item = capture.item
    if (!item) {
        message('error', capture.error ?? "This picture couldn't be read.")
        return
    }
    const colors = item.slots.map((slot) => slot.name)
    const lines = [
        `${item.width} x ${item.height} px, ${plural(item.frames.length, 'frame')}. ${colors.length > 0 ? `Uses the colors ${colors.join(', ')}.` : 'Uses no palette colors.'}`,
    ]
    if (capture.offPalette > 0) {
        lines.push(`${plural(capture.offPalette, 'pixel')} ${capture.offPalette === 1 ? 'is not a palette color' : 'are not palette colors'}. To fix them first, use Picture options (three dots) > Snap to Palette.`)
    }
    const dialog = new Dialog({
        id: 'polyplus_nameplate_library_save_sprite',
        title: 'Save Sprite to Library',
        form: {
            name: nameField(item.name),
            about: { type: 'info', text: lines.join('\n\n') },
        },
        onConfirm(result: any) {
            const name = typedName(result, item.name)
            stored(addItem({ ...item, name }), name)
        },
    } as any)
    showDialog(dialog)
}

export function openSavePaletteDialog() {
    if (!isNameplateActive()) return
    const plate = readNameplate()
    const item = capturePalette(plate.palette, `${plate.id} colors`)
    const colorways = Object.keys(item.colorways)
    const dialog = new Dialog({
        id: 'polyplus_nameplate_library_save_palette',
        title: 'Save Colors to Library',
        form: {
            name: nameField(item.name),
            about: {
                type: 'info',
                text: `${plural(item.slots.length, 'color')} (${item.slots.map((slot) => slot.name).join(', ')}) and ${plural(colorways.length, 'colorway')} (${colorways.join(', ')}).`,
            },
        },
        onConfirm(result: any) {
            const name = typedName(result, item.name)
            stored(addItem({ ...item, name }), name)
        },
    } as any)
    showDialog(dialog)
}

export function openSaveAnimationDialog(animation: any) {
    if (!animation || !isNameplateActive()) return
    const keyed = keyedNodes(animation)
    if (keyed.length === 0) {
        message('info', `'${animation.name}' has no keyframes yet. Add keyframes to a layer or group in this animation, then save it.`)
        return
    }
    const primary = primarySelectedNode()
    const preferred = keyed.find((entry) => entry.node === primary) ?? keyed[0]
    const options: Record<string, string> = {}
    for (const entry of keyed) options[entry.node.uuid] = `${nodeLabel(entry.node)} (${entry.channels.map(channelLabel).join(', ')})`
    const dialog = new Dialog({
        id: 'polyplus_nameplate_library_save_animation',
        title: 'Save Animation to Library',
        form: {
            name: nameField(animation.name === LOOP_ANIMATION ? `${preferred.node.name}_loop` : String(animation.name)),
            from: {
                type: 'select',
                label: 'Keyframes from',
                options,
                value: preferred.node.uuid,
            },
            about: {
                type: 'info',
                text: animation.name === LOOP_ANIMATION
                    ? 'Saved as a loop preset. Insert adds the keyframes to a loop.'
                    : 'Saved with when it plays, so Insert can make a new animation like this one.',
            },
        } as any,
        onConfirm(result: any) {
            const entry = keyed.find((candidate) => candidate.node.uuid === result?.from) ?? preferred
            const name = typedName(result, String(animation.name))
            const item = capturePreset(animation, entry.node, name)
            if (!item) {
                message('error', "These keyframes couldn't be read.")
                return
            }
            stored(addItem(item), name)
        },
    } as any)
    showDialog(dialog)
}

function insertSpriteDialog(item: SpriteItem) {
    const dialog = new Dialog({
        id: 'polyplus_nameplate_library_insert_sprite',
        title: `Insert Sprite '${item.name}'`,
        form: {
            name: { type: 'text', label: 'Picture name', value: item.name },
            colors: {
                type: 'select',
                label: 'Colors',
                value: 'match',
                options: {
                    match: "Use this nameplate's colors with the same name",
                    keep: "Keep the sprite's own colors",
                },
                description: "Same name: it takes on this nameplate's colors. Own colors: it looks exactly as saved",
            },
            layer: { type: 'checkbox', label: 'Add a sprite layer that shows it', value: true, description: 'Off: only the picture is added, for a layer you pick it in later' },
            about: { type: 'info', text: `${item.width} x ${item.height} px, ${plural(item.frames.length, 'frame')}.` },
        } as any,
        onConfirm(result: any) {
            const mode: ColorMode = result?.colors === 'keep' ? 'keep' : 'match'
            const done = insertSprite(item, typedName(result, item.name), mode, result?.layer !== false)
            if (!done) {
                message('error', 'Open a nameplate first, then insert the sprite.')
                return
            }
            goMode('design')
            const notes: string[] = []
            if (done.addedSlots.length > 0) notes.push(`Added the colors ${done.addedSlots.join(', ')}.`)
            if (done.shortRamps.length > 0) notes.push(`${done.shortRamps.join(', ')} has fewer shades here, so the lightest one stands in for the missing ones.`)
            if (item.frames.length > 1) notes.push(`It has ${item.frames.length} frames. They must divide this nameplate's loop; Checks says if they don't.`)
            if (notes.length > 0) message('check_circle', `Inserted '${done.texture.name}'.`, notes)
            else Blockbench.showQuickMessage(`Inserted '${done.texture.name}'`, 1500)
        },
    } as any)
    showDialog(dialog)
}

function insertPaletteDialog(item: PaletteItem) {
    const dialog = new Dialog({
        id: 'polyplus_nameplate_library_insert_palette',
        title: `Insert Colors '${item.name}'`,
        form: {
            mode: {
                type: 'select',
                label: 'How',
                value: 'add',
                options: {
                    add: 'Add them as new colors',
                    replace: "Replace this nameplate's colors",
                },
                description: 'Add: your colors stay. Replace: painted pixels change to the saved shades. Colorways are replaced too',
            },
            about: { type: 'info', text: `${plural(item.slots.length, 'color')}: ${item.slots.map((slot) => slot.name).join(', ')}. Colorways: ${Object.keys(item.colorways).join(', ')}.` },
        } as any,
        onConfirm(result: any) {
            const mode: PaletteMode = result?.mode === 'replace' ? 'replace' : 'add'
            const done = insertPalette(item, mode)
            if (!done) {
                message('error', 'Open a nameplate first, then insert the colors.')
                return
            }
            if (mode === 'replace') {
                Blockbench.showQuickMessage(done.recolored ? 'Colors replaced; painted pixels follow the new shades' : 'Colors replaced', 2000)
                return
            }
            const notes: string[] = []
            if (done.added.length > 0) notes.push(`Added ${done.added.join(', ')}.`)
            if (done.reused.length > 0) notes.push(`Already here: ${done.reused.join(', ')}.`)
            if (done.skippedColorways.length > 0) notes.push(`This nameplate has no colorway called ${done.skippedColorways.join(', ')}, so those shades were left out. Add the colorway, then insert again to get them.`)
            message('check_circle', done.added.length > 0 ? 'Colors inserted.' : 'Nothing to add: this nameplate already has these colors.', notes)
        },
    } as any)
    showDialog(dialog)
}

function animationChoices(item: AnimationItem): Record<string, string> {
    const options: Record<string, string> = {}
    if (canMakeAnimation(item)) options[NEW_ANIMATION] = `A new animation: ${playsLabel(item.settings).toLowerCase()}, ${item.length} frames`
    const fps = currentFps()
    for (const animation of (Animator.animations ?? []) as any[]) {
        options[animation.uuid] = `${animation.name} (${Math.round(Number(animation.length) * fps)} frames)`
    }
    return options
}

function defaultInto(item: AnimationItem, options: Record<string, string>): string {
    if (item.loop) {
        const loop = findLoopAnimation()
        if (loop) return loop.uuid
    }
    if (options[NEW_ANIMATION]) return NEW_ANIMATION
    const selected = (BBAnimation as any).selected
    return selected && options[selected.uuid] ? selected.uuid : Object.keys(options)[0] ?? ''
}

function insertAnimationDialog(item: AnimationItem) {
    const targets = presetTargets(item)
    if (targets.length === 0) {
        message('info', `No layer or group here can take these keyframes (${Object.keys(item.channels).map(channelLabel).join(', ')}). Add ${kindNoun(item.target)} first.`)
        return
    }
    const into = animationChoices(item)
    if (Object.keys(into).length === 0) {
        message('info', 'This nameplate has no animations yet. Open the Animate tab once, then insert again.')
        return
    }
    const primary = primarySelectedNode()
    const sameKind = targets.find((node) => node === primary) ?? targets.find((node) => nodeKind(node) === item.target) ?? targets[0]
    const onOptions: Record<string, string> = {}
    for (const node of targets) onOptions[node.uuid] = nodeLabel(node)
    const fps = currentFps()
    const lengthOf = (uuid: string): number | null => {
        if (uuid === NEW_ANIMATION) return item.length
        const animation = (Animator.animations as any[]).find((entry) => entry.uuid === uuid)
        return animation ? Math.round(Number(animation.length) * fps) : null
    }
    const dialog = new Dialog({
        id: 'polyplus_nameplate_library_insert_animation',
        title: `Insert Animation '${item.name}'`,
        form: {
            on: { type: 'select', label: 'Put the keyframes on', options: onOptions, value: sameKind.uuid, description: `Saved from ${kindNoun(item.target)}. Channels it doesn't have are left out` },
            into: { type: 'select', label: 'Into', options: into, value: defaultInto(item, into) },
            replace: { type: 'checkbox', label: 'Replace keyframes already there', value: true, description: 'On: keyframes this layer has in the same channels of that animation are removed first. Off: the saved keyframes are added between them' },
            stretch: {
                type: 'checkbox',
                label: `Stretch from ${item.length} frames to fit`,
                value: false,
                condition: (result: any) => {
                    const length = lengthOf(String(result?.into ?? ''))
                    return length !== null && length !== item.length
                },
                description: 'Off: keyframes keep their frame numbers, and keyframes past the end are left out',
            },
        } as any,
        onConfirm(result: any) {
            const node = targets.find((entry) => entry.uuid === result?.on) ?? sameKind
            goMode('animate')
            const done = insertPreset(item, node, {
                into: String(result?.into ?? ''),
                replace: result?.replace !== false,
                stretch: result?.stretch === true,
            })
            if (!done) {
                message('error', "The keyframes couldn't be inserted. Pick an animation and a layer, then try again.")
                return
            }
            try {
                done.animation.select()
                node.select?.()
            } catch (error) {
                console.error('[polyplus_nameplate] could not select the inserted animation', error)
            }
            const notes: string[] = []
            if (done.skipped.length > 0) notes.push(`${nodeLabel(node)} has no ${done.skipped.join(', ')} channel, so those keyframes were left out.`)
            if (done.dropped > 0) notes.push(`${plural(done.dropped, 'keyframe')} fell past the end of '${done.animation.name}' and were left out. Turn on Stretch to keep them.`)
            if (notes.length > 0) message('check_circle', `Inserted the keyframes into '${done.animation.name}'.`, notes)
            else Blockbench.showQuickMessage(`Inserted the keyframes into '${done.animation.name}'`, 1500)
        },
    } as any)
    showDialog(dialog)
}

export function openInsertDialog(id: string) {
    const item = findItem(id)
    if (!item) return
    if (!isNameplateActive()) {
        message('info', 'Open a nameplate first, then insert from the library.')
        return
    }
    if (item.kind === 'sprite') insertSpriteDialog(item)
    else if (item.kind === 'palette') insertPaletteDialog(item)
    else insertAnimationDialog(item)
}

export function renameLibraryItem(id: string) {
    const item = findItem(id)
    if (!item) return
    Blockbench.textPrompt('Rename', item.name, (text: string) => {
        const error = renameItem(id, String(text ?? ''))
        if (error) message('error', error)
    }, { description: 'Only changes the name in your library' } as any)
    track(Dialog.open)
}

export function deleteLibraryItem(id: string) {
    const item = findItem(id)
    if (!item) return
    confirmBox({
        title: 'Delete from Library',
        icon: 'delete',
        message: `Delete '${escapeHtml(item.name)}' from your library? Nameplates it was inserted into keep their copy. This can't be undone.`,
        confirm: 'Delete',
    }, () => {
        const error = deleteItem(id)
        if (error) message('error', error)
    })
    track(Dialog.open)
}

function safeFileName(name: string): string {
    return String(name ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'nameplate_library'
}

export function exportLibraryFile(items: LibraryItem[] = libraryItems(), name = 'nameplate_library') {
    if (items.length === 0) {
        Blockbench.showQuickMessage('The library is empty', 1500)
        return
    }
    Blockbench.export({
        type: FILE_TYPE,
        extensions: ['json'],
        name: safeFileName(name),
        resource_id: RESOURCE_ID,
        savetype: 'text',
        content: JSON.stringify(libraryFile(items), null, 2),
    } as any)
}

export function exportLibraryItem(id: string) {
    const item = findItem(id)
    if (item) exportLibraryFile([item], item.name)
}

export function receiveLibraryText(text: string): boolean {
    const parsed = parseLibraryFile(text)
    if (parsed.error) {
        message('error', parsed.error)
        return false
    }
    const merged = mergeItems(parsed.items)
    if (merged.added.length > 0) {
        const error = addItems(merged.added)
        if (error) {
            message('error', error)
            return false
        }
    }
    const notes: string[] = []
    if (merged.duplicates > 0) notes.push(`${plural(merged.duplicates, 'item')} already in your library ${merged.duplicates === 1 ? 'was' : 'were'} skipped.`)
    if (parsed.skipped > 0) notes.push(`${plural(parsed.skipped, 'item')} couldn't be read and ${parsed.skipped === 1 ? 'was' : 'were'} skipped.`)
    message(merged.added.length > 0 ? 'check_circle' : 'info', merged.added.length > 0 ? `Added ${plural(merged.added.length, 'item')} to your library.` : 'Nothing new to add.', notes)
    return true
}

export function importLibraryFile() {
    Blockbench.import({
        type: FILE_TYPE,
        extensions: ['json'],
        readtype: 'text',
        resource_id: RESOURCE_ID,
        title: 'Import Nameplate Library',
    } as any, (files: Filesystem.FileResult[]) => {
        for (const file of files ?? []) {
            if (typeof file.content === 'string') receiveLibraryText(file.content)
        }
    })
}

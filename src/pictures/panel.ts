import { onHeavy, onLight } from '../design/events'
import { layerNodes, primarySelectedNode } from '../elements/nodes'
import { pictureName, pictureUuidsOf, removePictures, unusedPictures } from '../elements/pictures'
import { commitMaterials } from '../material/state'
import { goMode, showLayer, showTexture } from '../navigate'
import { sanitizeId, uniqueId } from '../palette/ids'
import { frameCountOf } from '../palette/sprites'
import { pluginToolbar } from '../toolbar'
import { confirmBox } from '../util/dialogs'
import { hasProject as hasOpenProject } from '../util/project'
import { registerLeftPanel } from '../leftside/register'
import { defineFormatAction } from '../util/actions'
import { disposeAll, dropToolbar } from '../util/teardown'
import { findTexture } from '../util/texture'
import { plural, quotedList } from '../util/text'
import { usePicturesStyle } from './style'

export const PICTURES_PANEL = 'polyplus_nameplate_pictures'
const TOOLBAR_ID = 'polyplus_nameplate_pictures_bar'
const IMPORT_ACTION = 'polyplus_nameplate_pictures_import'
const NEW_PICTURE_ACTION = 'polyplus_nameplate_new_texture'
const THUMB_SIZE = 48
const MENU_ITEMS = [
    'resize_texture',
    'polyplus_nameplate_split_frames',
    'polyplus_nameplate_snap_to_palette',
    'polyplus_nameplate_clear_picture',
    'polyplus_nameplate_library_save_sprite',
]

interface PictureThumb {
    url: string
    frameWidth: number
    frameHeight: number
    width: number
    height: number
}

interface PictureRow {
    uuid: string
    name: string
    size: string
    users: string
    unused: boolean
    selected: boolean
    thumb: PictureThumb | null
}

interface PicturesUi {
    hasProject: boolean
    rows: PictureRow[]
}

const picturesUi: PicturesUi = { hasProject: false, rows: [] }

function hasProject(): boolean {
    return hasOpenProject() && typeof Texture !== 'undefined'
}

function findPicture(uuid: string): Texture | undefined {
    return hasProject() ? findTexture(uuid) : undefined
}

function framesOf(texture: Texture): { frames: number, width: number, height: number } {
    const frames = frameCountOf(texture)
    return { frames, width: texture.width, height: Math.floor(texture.height / frames) }
}

function thumbOf(texture: Texture): PictureThumb | null {
    const { width, height } = framesOf(texture)
    const url = (texture as any).source as string | undefined
    if (!url || width <= 0 || height <= 0 || texture.error) return null
    const fit = Math.min(THUMB_SIZE / width, THUMB_SIZE / height)
    const scale = fit >= 1 ? Math.floor(fit) : fit
    return {
        url,
        frameWidth: Math.max(1, Math.round(width * scale)),
        frameHeight: Math.max(1, Math.round(height * scale)),
        width: Math.max(1, Math.round(texture.width * scale)),
        height: Math.max(1, Math.round(texture.height * scale)),
    }
}

function sizeOf(texture: Texture): string {
    const { frames, width, height } = framesOf(texture)
    if (width <= 0 || height <= 0) return plural(frames, 'frame')
    return `${width} x ${height} px, ${plural(frames, 'frame')}`
}

function usersOf(uuid: string): any[] {
    return layerNodes().filter((node) => pictureUuidsOf(node).includes(uuid))
}

function userNames(uuid: string): string[] {
    return usersOf(uuid).map((node) => String(node.name ?? ''))
}

function rowOf(texture: Texture, unused: Set<string>): PictureRow {
    const names = userNames(texture.uuid)
    const isUnused = names.length === 0 && unused.has(texture.uuid)
    let users = 'Used by an effect'
    if (names.length > 0) users = `Used by ${names.join(', ')}`
    else if (isUnused) users = 'Not used by any layer'
    return {
        uuid: texture.uuid,
        name: pictureName(texture),
        size: sizeOf(texture),
        users,
        unused: isUnused,
        selected: !!texture.selected,
        thumb: thumbOf(texture),
    }
}

function refreshPicturesPanel() {
    try {
        picturesUi.hasProject = hasProject()
        if (!picturesUi.hasProject) {
            picturesUi.rows = []
            return
        }
        const unused = new Set(unusedPictures().map((texture) => texture.uuid))
        picturesUi.rows = Texture.all.map((texture) => rowOf(texture, unused))
    } catch (error) {
        console.error('[polyplus_nameplate] pictures panel refresh failed', error)
    }
}

function refreshSelection() {
    for (const row of picturesUi.rows) row.selected = !!findPicture(row.uuid)?.selected
}

function openAlone(texture: Texture) {
    goMode('design')
    if (primarySelectedNode()) {
        try {
            unselectAllElements()
        } catch (error) {
            console.error('[polyplus_nameplate] could not unselect the layers', error)
        }
    }
    showTexture(texture)
    Blockbench.dispatchEvent('update_selection', {} as any)
}

function openPicture(texture: Texture) {
    const users = usersOf(texture.uuid)
    if (users.length === 0) {
        openAlone(texture)
        return
    }
    const current = primarySelectedNode()
    if (current && users.includes(current)) {
        goMode('design')
        showTexture(texture)
        return
    }
    showLayer(users[0], texture)
}

function renamePicture(texture: Texture) {
    Blockbench.textPrompt('Rename Picture', pictureName(texture), (text: string) => {
        const typed = sanitizeId(String(text ?? '').trim())
        if (!typed || !Texture.all.includes(texture)) return
        const taken = new Set(Texture.all.filter((entry) => entry !== texture).map((entry) => sanitizeId(pictureName(entry))))
        const name = uniqueId(typed, (candidate) => taken.has(candidate))
        if (`${name}.png` === texture.name) return
        const before = sanitizeId(pictureName(texture))
        commitMaterials('Rename picture', (state) => {
            texture.name = `${name}.png`
            for (const graph of Object.values(state.graphs)) {
                for (const node of graph?.nodes ?? []) {
                    if (node?.type === 'Sprite' && node.set?.sprite === before) node.set.sprite = name
                }
            }
        }, { textures: [texture] })
        if (name !== typed) Blockbench.showQuickMessage(`'${typed}' is taken, so this one is '${name}'.`, 2500)
    }, { description: 'Use lowercase letters, digits and _. Anything else becomes _.' } as any)
}

function deleteMessage(texture: Texture, names: string[]): string {
    const name = `'${pictureName(texture)}'`
    if (names.length === 0) return `${name} is used by an effect. Deleting it leaves the effect with no picture.`
    if (names.length === 1) return `${name} is used by layer ${quotedList(names)}. Deleting it leaves that layer with no picture.`
    return `${name} is used by layers ${quotedList(names)}. Deleting it leaves those layers with no picture.`
}

function deletePicture(texture: Texture) {
    const names = userNames(texture.uuid)
    const unused = names.length === 0 && unusedPictures().includes(texture)
    if (unused) {
        removePictures([texture])
        return
    }
    confirmBox(
        {
            title: 'Delete Picture',
            icon: 'delete',
            message: deleteMessage(texture, names),
            confirm: 'Delete',
        },
        () => removePictures([texture]),
    )
}

function openMenu(texture: Texture, event: Event) {
    openPicture(texture)
    const items = MENU_ITEMS.filter((id) => !!(BarItems as any)[id])
    const menu = new Menu([
        { name: 'Rename...', icon: 'text_format', click: () => renamePicture(texture) },
        new MenuSeparator('options'),
        ...items,
        new MenuSeparator('manage'),
        { name: 'Delete', icon: 'delete', click: () => deletePicture(texture) },
    ] as any)
    menu.open(event as MouseEvent, texture as any)
}

function withPicture(uuid: string, run: (texture: Texture) => void) {
    const texture = findPicture(uuid)
    if (!texture) return
    try {
        run(texture)
    } catch (error) {
        console.error('[polyplus_nameplate] picture action failed', error)
    }
}

const component = {
    data() {
        return { ui: picturesUi }
    },
    methods: {
        open(row: PictureRow) {
            withPicture(row.uuid, openPicture)
        },
        rename(row: PictureRow) {
            withPicture(row.uuid, renamePicture)
        },
        remove(row: PictureRow) {
            withPicture(row.uuid, deletePicture)
        },
        menu(row: PictureRow, event: Event) {
            withPicture(row.uuid, (texture) => openMenu(texture, event))
        },
        frameStyle(thumb: PictureThumb) {
            return { width: `${thumb.frameWidth}px`, height: `${thumb.frameHeight}px` }
        },
        imageStyle(thumb: PictureThumb) {
            return { width: `${thumb.width}px`, height: `${thumb.height}px` }
        },
    },
    template: `
        <div class="np-scroll-host np-pictures-host"><div class="np-scroll np-pictures-scroll mobile_scrollbar">
            <p v-if="!ui.hasProject" class="np-pictures-empty">Open a nameplate to see its pictures.</p>
            <p v-else-if="!ui.rows.length" class="np-pictures-empty">No pictures yet. Import one or make a new one with the buttons above.</p>
            <ul v-else class="list np-pictures">
                <li v-for="row in ui.rows" :key="row.uuid" :class="{ selected: row.selected }" :title="'Click to paint ' + row.name" @click="open(row)" @contextmenu.prevent.stop="menu(row, $event)">
                    <div class="np-picture-thumb">
                        <div v-if="row.thumb" class="np-picture-frame" :style="frameStyle(row.thumb)">
                            <img :src="row.thumb.url" :style="imageStyle(row.thumb)" alt="">
                        </div>
                    </div>
                    <div class="np-picture-text">
                        <span class="np-picture-name">{{ row.name }}</span>
                        <span class="np-picture-meta">{{ row.size }}</span>
                        <span class="np-picture-meta" :class="{ 'np-picture-unused': row.unused }" :title="row.users">{{ row.users }}</span>
                    </div>
                    <div class="np-picture-tools">
                        <i class="material-icons notranslate icon" title="Rename" @click.stop="rename(row)">edit</i>
                        <i class="material-icons notranslate icon" title="Delete" @click.stop="remove(row)">delete</i>
                        <i class="material-icons notranslate icon" title="More options" @click.stop="menu(row, $event)">more_vert</i>
                    </div>
                </li>
            </ul>
        </div></div>
    `,
}

function importAction(): Action {
    const source = (BarItems as any).import_texture as Action | undefined
    return defineFormatAction(IMPORT_ACTION, {
        name: 'Import Picture',
        description: 'Add a PNG from your computer',
        icon: source?.icon ?? 'library_add',
        category: 'textures',
        click: (event?: Event) => (BarItems as any).import_texture?.trigger(event),
    })
}

export function registerPicturesPanel(): () => void {
    const action = importAction()
    const toolbar = pluginToolbar(TOOLBAR_ID, { children: [IMPORT_ACTION, NEW_PICTURE_ACTION] })
    const registration = registerLeftPanel({
        id: PICTURES_PANEL,
        name: 'Pictures',
        icon: 'photo_library',
        index: 6,
        height: 240,
        folded: true,
        resizable: true,
        growable: false,
        toolbars: [toolbar],
        component,
        useStyle: usePicturesStyle,
        live: false,
    })
    const panel = registration.panel
    const keepLeft = () => {
        if (panel.node.scrollLeft) panel.node.scrollLeft = 0
    }
    panel.node.addEventListener('scroll', keepLeft)
    const removers = [onHeavy(refreshPicturesPanel), onLight(refreshSelection), () => panel.node.removeEventListener('scroll', keepLeft)]
    refreshPicturesPanel()
    return () => {
        disposeAll(removers)
        registration.remove()
        dropToolbar(toolbar)
        action.delete()
        picturesUi.hasProject = false
        picturesUi.rows = []
    }
}

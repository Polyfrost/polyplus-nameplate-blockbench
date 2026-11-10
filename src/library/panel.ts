import { isNameplateActive } from '../format'
import { FORMAT_ID } from '../model'
import { presetSummary } from './animation'
import {
    deleteLibraryItem,
    exportLibraryFile,
    exportLibraryItem,
    importLibraryFile,
    openInsertDialog,
    openSavePaletteDialog,
    openSaveSpriteDialog,
    renameLibraryItem,
} from './dialogs'
import { pictureStem } from '../palette/ids'
import { plural } from '../util/text'
import { paletteSwatches } from './palette'
import { spriteThumbnail } from './sprite'
import { LibraryItem, LibraryKind, libraryItems, onLibraryChanged } from './store'
import { pluginToolbar } from '../toolbar'
import { primarySelectedNode } from '../elements/nodes'
import { ART_PROPERTY, artTexture, readArt } from '../art/layout'
import { defineAction, defineFormatAction } from '../util/actions'
import { injectStyle } from '../util/style'
import { disposeAll, dropToolbar } from '../util/teardown'
import { findTexture } from '../util/texture'

const TOOLBAR_ID = 'polyplus_nameplate_library_bar'
const STYLE_ID = 'polyplus_nameplate_library_style'
const DIALOG_ID = 'polyplus_nameplate_library_dialog'
const LIBRARY_OPEN = 'polyplus_nameplate_library_open'
const SAVE_PALETTE = 'polyplus_nameplate_library_save_palette'
const SAVE_SPRITE = 'polyplus_nameplate_library_save_selected_sprite'
const IMPORT = 'polyplus_nameplate_library_import'
const EXPORT = 'polyplus_nameplate_library_export'

const STYLE = `
ul.np-library-list { margin: 0; padding: 0; list-style: none; }
ul.np-library-list > li { display: flex; align-items: center; gap: 8px; padding: 3px 8px; cursor: pointer; }
ul.np-library-list > li:hover { background-color: var(--color-selected); }
ul.np-library-list > li.selected { background-color: var(--color-selected); box-shadow: inset 2px 0 0 var(--color-accent); }
.np-library-thumb { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background-color: var(--color-back); border: 1px solid var(--color-border); box-sizing: border-box; }
.np-library-thumb img { max-width: 32px; max-height: 32px; width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated; }
.np-library-swatches { display: grid; grid-template-columns: repeat(4, 1fr); width: 32px; height: 32px; }
.np-library-swatches > span { display: block; min-height: 8px; }
.np-library-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.np-library-text > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-library-tools { flex: none; display: flex; gap: 2px; }
.np-library-dialog { max-height: min(560px, calc(100vh - 220px)); overflow-y: auto; overflow-x: hidden; }
`

const SECTIONS: Array<{ kind: LibraryKind, title: string, icon: string }> = [
    { kind: 'sprite', title: 'Sprites', icon: 'image' },
    { kind: 'palette', title: 'Colors', icon: 'palette' },
    { kind: 'animation', title: 'Animations', icon: 'movie' },
]

interface ItemView {
    id: string
    name: string
    summary: string
    thumb: string
    swatches: string[]
    icon: string
}

interface SectionView {
    kind: LibraryKind
    title: string
    items: ItemView[]
}

interface LibraryUi {
    sections: SectionView[]
    count: number
    selected: string
    sprite: string
}

const libraryUi: LibraryUi = { sections: [], count: 0, selected: '', sprite: '' }

const thumbs = new Map<string, { key: string, url: string }>()
const handles: { registered: boolean, dialog: Dialog | null, toolbar: Toolbar | null, style: (() => void) | null, items: BarItem[], removers: Array<() => void> } = {
    registered: false,
    dialog: null,
    toolbar: null,
    style: null,
    items: [],
    removers: [],
}

export function selectedSprite(): Texture | null {
    if (typeof Texture === 'undefined') return null
    const node = primarySelectedNode()
    if (node) {
        const uuid = typeof node.texture === 'string' && node.texture ? node.texture : artTexture(readArt(node[ART_PROPERTY]))?.uuid ?? ''
        return uuid ? findTexture(uuid) ?? null : null
    }
    return Texture.selected ?? null
}

function saveSelectedSprite() {
    const texture = selectedSprite()
    if (texture) openSaveSpriteDialog(texture)
    else Blockbench.showQuickMessage('Click a sprite under Layers first', 2000)
}

function thumbOf(item: LibraryItem): string {
    if (item.kind !== 'sprite') return ''
    const key = JSON.stringify([item.width, item.height, item.frames[0], item.colors, item.slots])
    const cached = thumbs.get(item.id)
    if (cached && cached.key === key) return cached.url
    const url = spriteThumbnail(item)
    thumbs.set(item.id, { key, url })
    return url
}

function summaryOf(item: LibraryItem): string {
    switch (item.kind) {
        case 'sprite':
            return `${item.width} x ${item.height} px, ${plural(item.frames.length, 'frame')}`
        case 'palette':
            return `${plural(item.slots.length, 'color')}, ${plural(Object.keys(item.colorways).length, 'colorway')}`
        case 'animation':
            return presetSummary(item)
    }
}

function viewOf(item: LibraryItem, icon: string): ItemView {
    return {
        id: item.id,
        name: item.name,
        summary: summaryOf(item),
        thumb: thumbOf(item),
        swatches: item.kind === 'palette' ? paletteSwatches(item, 16) : [],
        icon,
    }
}

function refreshLibrary() {
    try {
        const items = libraryItems()
        const ids = new Set(items.map((item) => item.id))
        for (const id of Array.from(thumbs.keys())) if (!ids.has(id)) thumbs.delete(id)
        libraryUi.sections = SECTIONS.map((section) => ({
            kind: section.kind,
            title: section.title,
            items: items
                .filter((item) => item.kind === section.kind)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((item) => viewOf(item, section.icon)),
        }))
        libraryUi.count = items.length
        if (!ids.has(libraryUi.selected)) libraryUi.selected = ''
    } catch (error) {
        console.error('[polyplus_nameplate] library panel refresh failed', error)
    }
}

const component = {
    data() {
        return { ui: libraryUi }
    },
    methods: {
        select(item: ItemView) {
            libraryUi.selected = item.id
        },
        insert(item: ItemView) {
            libraryUi.selected = item.id
            openInsertDialog(item.id)
        },
        rename(item: ItemView) {
            renameLibraryItem(item.id)
        },
        remove(item: ItemView) {
            deleteLibraryItem(item.id)
        },
        menu(item: ItemView, event: Event) {
            libraryUi.selected = item.id
            new Menu([
                { name: 'Insert into this nameplate...', icon: 'input', click: () => openInsertDialog(item.id) },
                { name: 'Rename...', icon: 'text_format', click: () => renameLibraryItem(item.id) },
                { name: 'Export to file...', icon: 'file_download', click: () => exportLibraryItem(item.id) },
                new MenuSeparator('manage'),
                { name: 'Delete from library', icon: 'delete', click: () => deleteLibraryItem(item.id) },
            ] as any).open(event as MouseEvent)
        },
        importFile() {
            importLibraryFile()
        },
        savePalette() {
            openSavePaletteDialog()
        },
        saveSprite() {
            saveSelectedSprite()
        },
    },
    template: `
        <div class="np-library-dialog mobile_scrollbar">
        <div class="np-library">
            <div v-if="!ui.count" class="np-panel-empty">
                <p>Your library is empty. Save things here to reuse them in other nameplates:</p>
                <p>A sprite: click it under Layers, then use the button below.<br>Colors: use the button below.<br>An animation: right-click it in the Animate tab, Save to Library.</p>
                <div class="np-empty-actions">
                    <button type="button" :disabled="!ui.sprite" :title="ui.sprite ? '' : 'Close this, click a sprite under Layers, then open the Library again'" @click="saveSprite()"><i class="material-icons notranslate icon">bookmark_add</i> {{ ui.sprite ? 'Save sprite "' + ui.sprite + '"' : 'Save the selected sprite' }}</button>
                    <button type="button" @click="savePalette()"><i class="material-icons notranslate icon">bookmark_add</i> Save these colors</button>
                    <button type="button" @click="importFile()"><i class="material-icons notranslate icon">file_upload</i> Import a library file</button>
                </div>
            </div>
            <template v-for="section in ui.sections">
                <template v-if="section.items.length">
                    <p class="panel_toolbar_label" :key="section.kind + '_title'">{{ section.title }}</p>
                    <ul class="np-library-list" :key="section.kind + '_list'">
                        <li v-for="item in section.items" :key="item.id" :class="{ selected: ui.selected === item.id }" :title="'Double-click to insert ' + item.name" @click="select(item)" @dblclick="insert(item)" @contextmenu.prevent.stop="menu(item, $event)">
                            <div class="np-library-thumb">
                                <img v-if="item.thumb" :src="item.thumb" alt="">
                                <div v-else-if="item.swatches.length" class="np-library-swatches">
                                    <span v-for="(color, index) in item.swatches" :key="index" :style="{ 'background-color': color }"></span>
                                </div>
                                <i v-else class="material-icons notranslate icon">{{ item.icon }}</i>
                            </div>
                            <div class="np-library-text">
                                <span>{{ item.name }}</span>
                                <span class="np-subtle">{{ item.summary }}</span>
                            </div>
                            <div class="np-library-tools">
                                <i class="material-icons notranslate icon np-icon-button" title="Insert into this nameplate" @click.stop="insert(item)">input</i>
                                <i class="material-icons notranslate icon np-icon-button" title="Rename" @click.stop="rename(item)">edit</i>
                                <i class="material-icons notranslate icon np-icon-button" title="Delete from library" @click.stop="remove(item)">delete</i>
                            </div>
                        </li>
                    </ul>
                </template>
            </template>
        </div>
        </div>
    `,
}

function makeItems(): BarItem[] {
    const condition = { formats: [FORMAT_ID] }
    const save = defineAction(SAVE_PALETTE, {
        name: 'Save Colors to Library',
        description: "Save this nameplate's colors and colorways to your library",
        icon: 'bookmark_add',
        category: 'edit',
        condition,
        click: () => openSavePaletteDialog(),
    })
    const sprite = defineAction(SAVE_SPRITE, {
        name: 'Save Selected Sprite to Library',
        description: 'Save the selected sprite to reuse it in other nameplates',
        icon: 'add_photo_alternate',
        category: 'edit',
        condition: () => isNameplateActive() && !!selectedSprite(),
        click: () => saveSelectedSprite(),
    })
    const importAction = defineAction(IMPORT, {
        name: 'Import Library File',
        description: 'Add the items of a library file, for example one a teammate exported',
        icon: 'file_upload',
        category: 'file',
        condition,
        click: () => importLibraryFile(),
    })
    const exportAction = defineAction(EXPORT, {
        name: 'Export Library File',
        description: 'Save your whole library as one JSON file to share it',
        icon: 'file_download',
        category: 'file',
        condition,
        click: () => exportLibraryFile(),
    })
    return [save, sprite, importAction, exportAction]
}

function ensureStyle() {
    if (handles.style) return
    handles.style = injectStyle(STYLE_ID, STYLE)
}

function openLibraryDialog() {
    ensureStyle()
    refreshLibrary()
    libraryUi.sprite = pictureStem(selectedSprite()?.name)
    if (!handles.dialog) {
        handles.toolbar = handles.toolbar ?? pluginToolbar(TOOLBAR_ID, { children: [SAVE_PALETTE, SAVE_SPRITE, '_', IMPORT, EXPORT] } as any)
        handles.dialog = new Dialog({
            id: DIALOG_ID,
            title: 'Library',
            width: 560,
            singleButton: true,
            part_order: ['toolbars', 'component'],
            toolbars: { library: handles.toolbar },
            component: component as any,
        } as any)
    }
    handles.dialog.show()
}

export function libraryOpenAction(): Action {
    return defineFormatAction(LIBRARY_OPEN, {
        name: 'Library',
        description: 'Your saved sprites, colors and animations',
        icon: 'collections_bookmark',
        click: () => openLibraryDialog(),
    })
}

export function registerLibraryPanel(): () => void {
    if (handles.registered) return () => {}
    handles.registered = true
    ensureStyle()
    handles.items = makeItems()
    handles.removers.push(onLibraryChanged(refreshLibrary))
    refreshLibrary()
    return () => {
        handles.registered = false
        disposeAll(handles.removers)
        try {
            const stack: any[] = (Dialog as any).stack ?? []
            if (handles.dialog && stack.includes(handles.dialog)) handles.dialog.hide()
            handles.dialog?.delete()
        } catch (error) {
            console.error('[polyplus_nameplate] could not remove the library dialog', error)
        }
        handles.dialog = null
        if (handles.toolbar) dropToolbar(handles.toolbar)
        handles.toolbar = null
        disposeAll(handles.items)
        handles.style?.()
        handles.style = null
        thumbs.clear()
        libraryUi.sections = []
        libraryUi.count = 0
        libraryUi.selected = ''
        libraryUi.sprite = ''
    }
}

import { isNameplateActive } from '../format'
import { closeLibraryDialogs, openSaveAnimationDialog, openSaveSpriteDialog } from './dialogs'
import { registerGroupBreakpoints } from './groups'
import { registerLibraryPanel } from './panel'
import { addToMenu, defineAction } from '../util/actions'
import { disposeAllSafe } from '../util/teardown'
import { watchOtherWindows } from './store'

const SAVE_SPRITE = 'polyplus_nameplate_library_save_sprite'
const SAVE_ANIMATION = 'polyplus_nameplate_library_save_animation'

const cleanups: Array<() => void> = []

function registerMenus(): () => void {
    const sprite = defineAction(SAVE_SPRITE, {
        name: 'Save to Library...',
        description: 'Save this sprite to reuse it in other nameplates',
        icon: 'bookmark_add',
        category: 'textures',
        condition: () => isNameplateActive() && !!Texture.selected,
        click: () => openSaveSpriteDialog(Texture.selected),
    })
    const animation = defineAction(SAVE_ANIMATION, {
        name: 'Save to Library...',
        description: 'Save these keyframes to reuse them in other nameplates',
        icon: 'bookmark_add',
        category: 'animation',
        condition: () => isNameplateActive() && !!(BBAnimation as any).selected,
        click: () => openSaveAnimationDialog((BBAnimation as any).selected),
    })
    const removeSprite = addToMenu((Texture.prototype as any).menu, sprite, '#manage', 'library menu')
    const removeAnimation = addToMenu((BBAnimation as any).prototype?.menu, animation, '#manage', 'library menu')
    return () => {
        removeAnimation()
        removeSprite()
        animation.delete()
        sprite.delete()
    }
}

function attempt(register: () => () => void) {
    try {
        cleanups.push(register())
    } catch (error) {
        console.error('[polyplus_nameplate] library registration failed', error)
    }
}

export function registerLibrary() {
    if (cleanups.length > 0) return
    attempt(registerGroupBreakpoints)
    attempt(registerMenus)
    attempt(registerLibraryPanel)
    attempt(watchOtherWindows)
}

export function unregisterLibrary() {
    closeLibraryDialogs()
    disposeAllSafe(cleanups, 'library unregistration failed', true)
}

import { addStarterBody, addStarterSprite } from './elements/actions'
import { newBlankNameplate, onNewNameplate, onStartChoice } from './format'
import { openBundleFiles } from './import'
import { goMode, showTexture } from './navigate'
import { dialogButtons } from './util/dialogs'
import { SAMPLES, sampleByKey, sampleFiles } from './samples'
import { DEFAULT_SPRITE_FRAMES, DEFAULT_SPRITE_SIZE, normalizeSpec } from './sprite'
import { disposeAll } from './util/teardown'

const DIALOG_ID = 'polyplus_nameplate_start'
const BLANK = 'blank'

let removers: Array<() => void> = []
let dialog: Dialog | null = null

function buildStarter() {
    const body = addStarterBody()
    const sprite = addStarterSprite(
        normalizeSpec({
            name: 'ornament',
            width: DEFAULT_SPRITE_SIZE,
            height: DEFAULT_SPRITE_SIZE,
            frames: DEFAULT_SPRITE_FRAMES,
        }),
        body,
    )
    Project.texture_width = DEFAULT_SPRITE_SIZE
    Project.texture_height = DEFAULT_SPRITE_SIZE
    goMode('design')
    if (sprite) {
        sprite.layer.select()
        showTexture(sprite.texture)
    } else {
        body?.select()
    }
    Undo.history.length = 0
    Undo.index = 0
}

function askStart() {
    const options: Record<string, string> = { [BLANK]: 'Blank' }
    for (const sample of SAMPLES) options[sample.key] = sample.name
    const picture = document.createElement('img')
    picture.style.imageRendering = 'pixelated'
    picture.style.margin = '0 auto'
    picture.style.display = 'block'
    const box = document.createElement('div')
    box.append(picture)
    const show = (key: string) => {
        const sample = sampleByKey(key)
        box.style.display = sample ? '' : 'none'
        if (sample) picture.src = sample.preview
    }
    const created: Dialog = new Dialog({
        id: DIALOG_ID,
        title: 'New Nameplate',
        width: 420,
        form: { start: { type: 'select', label: 'Start from', options, value: BLANK } },
        form_first: true,
        lines: [box],
        ...dialogButtons('Create', 'Cancel'),
        onFormChange(result: any) {
            show(result.start)
        },
        onConfirm(result: any) {
            const sample = sampleByKey(result.start)
            if (sample) openBundleFiles(sampleFiles(sample))
            else newBlankNameplate()
        },
    } as any)
    dialog = created
    show(BLANK)
    created.show()
}

export function registerStarter() {
    if (removers.length > 0) return
    removers = [onNewNameplate(buildStarter), onStartChoice(askStart)]
}

export function unregisterStarter() {
    if (dialog && Dialog.open === dialog) dialog.close(1)
    dialog = null
    disposeAll(removers)
}

import { setSnapshotSource } from './compile'
import { registerElements, unregisterElements } from './elements'
import { registerPlate, unregisterPlate } from './plate'
import { registerFlags, unregisterFlags } from './flags'
import { registerMotion, unregisterMotion } from './motion'
import { registerMaterials, unregisterMaterials } from './material'
import { registerMolang, unregisterMolang } from './molang'
import { registerText, unregisterText } from './text'
import { registerImport, unregisterImport } from './import'
import { registerKept, unregisterKept } from './import/kept'
import { registerExport, unregisterExport } from './export'
import { newNameplateProject, registerFormat, unregisterFormat } from './format'
import { registerPalette, unregisterPalette } from './palette'
import { registerPictures, unregisterPictures } from './pictures/strip'
import { registerPreview, unregisterPreview } from './preview'
import { registerDesign, unregisterDesign } from './design'
import { registerPaletteAnimation, unregisterPaletteAnimation } from './palanim'
import { buildSnapshot } from './snapshot'
import { registerNodes, unregisterNodes } from './nodes'
import { registerFont, unregisterFont } from './font'
import { registerStarter, unregisterStarter } from './starter'
import { registerLibrary, unregisterLibrary } from './library'
import { registerTour, unregisterTour } from './tour'
import { FORMAT_ID } from './model'
import { adoptOpenProjects } from './reload/adopt'
import { defineAction, disposeMenuBarAction } from './util/actions'
import { disposeAllSafe } from './util/teardown'

const PLUGIN_ID = 'polyplus_nameplate'
const ACTION_NEW = 'polyplus_nameplate_new'
const UNWRITTEN_DESCRIPTION = 'action.'

type Registration = [register: () => void, unregister: () => void]
type Translate = (text: string, variables?: unknown, fallback?: string) => string

let newAction: Action | null = null
let ownDescriptions: Translate | null = null
let originalTl: Translate | null = null

function keepOwnDescriptions() {
    const host = window as unknown as { tl: Translate }
    const original = host.tl
    originalTl = original
    ownDescriptions = (text, variables, fallback) => {
        const translated = original(text, variables, fallback)
        if (translated !== '' || fallback !== '') return translated
        const ours = !!BarItem.constructing?.id?.startsWith(PLUGIN_ID)
        return ours && !text.startsWith(UNWRITTEN_DESCRIPTION) ? text : translated
    }
    host.tl = ownDescriptions
}

function restoreDescriptions() {
    const host = window as unknown as { tl: Translate }
    if (originalTl && host.tl === ownDescriptions) host.tl = originalTl
    originalTl = null
    ownDescriptions = null
}

function registerNewAction() {
    if (newAction) return
    newAction = defineAction(
        ACTION_NEW,
        {
            name: 'New Nameplate',
            description: 'Create a new PolyPlus nameplate project',
            icon: 'badge',
            click() {
                newNameplateProject()
            },
        },
        'file',
    )
}

function unregisterNewAction() {
    const closing = newAction
    newAction = null
    disposeMenuBarAction(closing, 'file')
}

const registrations: Registration[] = [
    [keepOwnDescriptions, restoreDescriptions],
    [registerFont, unregisterFont],
    [registerFormat, unregisterFormat],
    [registerImport, unregisterImport],
    [registerKept, unregisterKept],
    [registerElements, unregisterElements],
    [registerPlate, unregisterPlate],
    [registerMotion, unregisterMotion],
    [registerFlags, unregisterFlags],
    [registerMaterials, unregisterMaterials],
    [registerText, unregisterText],
    [registerPalette, unregisterPalette],
    [registerPictures, unregisterPictures],
    [registerMolang, unregisterMolang],
    [registerStarter, unregisterStarter],
    [registerPreview, unregisterPreview],
    [registerDesign, unregisterDesign],
    [registerNodes, unregisterNodes],
    [registerLibrary, unregisterLibrary],
    [registerPaletteAnimation, unregisterPaletteAnimation],
    [registerExport, unregisterExport],
    [registerNewAction, unregisterNewAction],
    [registerTour, unregisterTour],
]

const started: Registration[] = []

BBPlugin.register(PLUGIN_ID, {
    title: 'PolyPlus Nameplates',
    author: 'Polyfrost',
    description: 'Design PolyPlus nameplates in Blockbench with a live preview.',
    icon: 'badge',
    version: '0.1.0',
    variant: 'both',
    min_version: '5.2.0',
    await_loading: true,
    contributes: {
        formats: [FORMAT_ID],
    },
    onload() {
        setSnapshotSource(buildSnapshot)
        for (const registration of registrations) {
            started.push(registration)
            try {
                registration[0]()
            } catch (error) {
                console.error(`[${PLUGIN_ID}] register failed`, error)
            }
        }
        try {
            adoptOpenProjects()
        } catch (error) {
            console.error(`[${PLUGIN_ID}] reconnecting open nameplates failed`, error)
        }
    },
    onunload() {
        disposeAllSafe(started.splice(0).map((registration) => registration[1]), 'unregister failed', true)
    },
})

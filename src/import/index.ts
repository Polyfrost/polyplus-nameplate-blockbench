import { describe, loadBundle } from '../engine'
import { plainIssueText } from '../export/issues'
import { FORMAT_ID } from '../model'
import { applyPlan } from './build'
import { registerExtraProperty, unregisterExtraProperty } from './extra'
import { collectFiles, emptyPicked, PickedFiles, SOURCE } from './files'
import { bundleFileList, ImportPlan, missingFiles, parseBundle, planImport } from './plan'
import { addMaterialTextures, missingMaterialFiles } from '../material/import'
import { emptyMaterials } from '../material/types'
import { confirmBox, messageBox } from '../util/dialogs'
import { defineAction } from '../util/actions'
import { escapeHtml, htmlList, plural } from '../util/text'

export { mergeExtra } from './extra'

const ACTION_ID = 'polyplus_nameplate_import'
const TITLE = 'Import Nameplate'
const RESOURCE_ID = 'polyplus_nameplate_bundle'
const MAX_LISTED = 25
const START_HINT = {
    type: 'label',
    text: 'Have a nameplate zip? Use **File > Import Nameplate...**',
}

let action: Action | null = null
let hintedFormat: any = null
let hintRetry: ReturnType<typeof setTimeout> | null = null

function list(items: string[]): string {
    return htmlList(items, MAX_LISTED)
}

function showError(message: string, items: string[] = []) {
    messageBox({
        title: TITLE,
        icon: 'error',
        message: escapeHtml(message) + (items.length > 0 ? list(items) : ''),
        buttons: ['Close'],
        width: 640,
    })
}

export function summaryHtml(plan: ImportPlan, problems: string[] = []): string {
    const parts = [`Imported <b>${escapeHtml(plan.nameplate.id)}</b>.`]
    if (problems.length > 0) {
        parts.push(`<p>This zip has ${plural(problems.length, 'problem')}. Fix ${problems.length === 1 ? 'it' : 'them'} in Checks to export.</p>${list(problems)}`)
    }
    if (plan.kept.length > 0) {
        parts.push(`<p>Not editable here, but they export as they were. Find them under File > Kept from Import...:</p>${list(plan.kept)}`)
    }
    if (plan.changed.length > 0) parts.push(`<p>Changed on import:</p>${list(plan.changed)}`)
    if (plan.dropped.length > 0) parts.push(`<p>Not imported:</p>${list(plan.dropped)}`)
    if (plan.kept.length === 0 && plan.changed.length === 0 && plan.dropped.length === 0) parts.push('<p>Everything in the zip is editable.</p>')
    return parts.join('')
}

function pickFiles(onPicked: (results: Filesystem.FileResult[]) => void) {
    Blockbench.import(
        {
            type: 'Nameplate Zip',
            extensions: ['zip', 'json', 'bbmodel', 'png'],
            multiple: true,
            readtype: (path: string) => (/\.(zip|png)$/i.test(path) ? 'buffer' : 'text'),
            resource_id: RESOURCE_ID,
            title: TITLE,
        },
        onPicked,
    )
}

function readFiles(files: Record<string, string>, skipped: string[], binary: Record<string, Uint8Array>): { plan: ImportPlan, problems: string[] } | null {
    const bundleFiles = bundleFileList(files)
    const loaded = loadBundle(bundleFiles, binary)
    if (loaded.skipped) {
        showError(`The game would skip this zip: ${loaded.skipped}.`)
        return null
    }
    const problems = loaded.preview ? [] : loaded.issues.map(plainIssueText)
    const { bundle, errors } = parseBundle(files)
    if (!bundle) {
        showError("The zip couldn't be read:", [...errors, ...problems])
        return null
    }
    let plan: ImportPlan
    try {
        plan = planImport(bundle)
    } catch (error) {
        console.error('[polyplus_nameplate] import plan failed', error)
        showError("The zip couldn't be read:", problems.length > 0 ? problems : [describe(error)])
        return null
    }
    plan.materials = addMaterialTextures(plan.materials ?? emptyMaterials(), binary, (note) => {
        if (!plan.changed.includes(note)) plan.changed.push(note)
    })
    plan.dropped.push(...skipped)
    return { plan, problems }
}

export function openBundleFiles(files: Record<string, string>): boolean {
    const read = readFiles(files, [], {})
    return !!read && applyPlan(read.plan)
}

export function importFiles(files: Record<string, string>, skipped: string[] = [], binary: Record<string, Uint8Array> = {}): ImportPlan | null {
    const read = readFiles(files, skipped, binary)
    if (!read) return null
    const { plan, problems } = read
    if (!applyPlan(plan)) {
        showError('Could not create a nameplate project.')
        return null
    }
    const source = typeof files[SOURCE] === 'string' ? files[SOURCE] : null
    messageBox(
        {
            title: TITLE,
            icon: problems.length > 0 ? 'warning' : plan.kept.length > 0 || plan.changed.length > 0 ? 'info' : 'check_circle',
            message: summaryHtml(plan, problems),
            buttons: source ? ['OK', 'Open original project'] : ['OK'],
            cancel: 0,
            width: 640,
        },
        (button) => {
            if (source && button === 1) openSource(source, plan.nameplate.id)
        },
    )
    return plan
}

export function openSource(text: string, id: string) {
    try {
        loadModelFile({ name: `${id}_source.bbmodel`, path: `${id}_source.bbmodel`, content: text, no_file: true })
    } catch (error) {
        console.error('[polyplus_nameplate] opening the original project failed', error)
        showError(`The original project in ${SOURCE} couldn't be opened: ${describe(error)}`)
    }
}

async function receive(results: Filesystem.FileResult[], picked: PickedFiles) {
    await collectFiles(results, picked)
    if (picked.errors.length > 0) {
        showError("Some files couldn't be read:", picked.errors)
        return
    }
    const missing = [...missingFiles(picked.files), ...missingMaterialFiles(picked.files, picked.binary ?? {})]
    if (missing.length === 0) {
        importFiles(picked.files, picked.skipped, picked.binary ?? {})
        return
    }
    confirmBox(
        {
            title: TITLE,
            icon: 'folder_open',
            message:
                'The zip is not complete yet. Pick the files below too (for example from the layers and sprites folders), or pick the zip.' +
                list(missing),
            confirm: 'Add files...',
            width: 640,
        },
        () => pickFiles((more) => run(more, picked)),
    )
}

function run(results: Filesystem.FileResult[], picked: PickedFiles) {
    receive(results, picked).catch((error) => {
        console.error('[polyplus_nameplate] import failed', error)
        showError(`Import failed: ${describe(error)}`)
    })
}

export function startImport() {
    const picked = emptyPicked()
    pickFiles((results) => run(results, picked))
}

function addStartHint(retry = true) {
    const format: any = typeof Formats !== 'undefined' ? Formats[FORMAT_ID] : null
    const content = format?.format_page?.content
    if (!Array.isArray(content)) {
        if (retry && action) hintRetry = setTimeout(() => addStartHint(false), 0)
        return
    }
    if (content.includes(START_HINT)) return
    content.push(START_HINT)
    hintedFormat = format
}

function removeStartHint() {
    if (hintRetry !== null) clearTimeout(hintRetry)
    hintRetry = null
    const content = hintedFormat?.format_page?.content
    if (Array.isArray(content)) {
        const at = content.indexOf(START_HINT)
        if (at >= 0) content.splice(at, 1)
    }
    hintedFormat = null
}

export function registerImport() {
    if (action) return
    registerExtraProperty()
    action = defineAction(
        ACTION_ID,
        {
            name: `${TITLE}...`,
            description: 'Open a nameplate zip, or its files, as a new nameplate project',
            icon: 'unarchive',
            click() {
                startImport()
            },
        },
        'file',
    )
    addStartHint()
}

export function unregisterImport() {
    removeStartHint()
    action?.delete()
    action = null
    unregisterExtraProperty()
}

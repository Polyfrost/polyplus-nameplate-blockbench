import { currentBundle } from '../compile'
import { describe } from '../engine'
import { CompiledBundle, FORMAT_ID } from '../model'
import { Problem, projectProblems } from './issues'
import { registerValidator, unregisterValidator } from './validator'
import { buildZip, zipAvailable } from './zip'
import { withToneHints } from '../material/tone'
import { reviewerNotes } from '../checks'
import { archiveProblem, archiveSize, REPORT_FILE, reportJson } from '../checks/report'
import { registerHighlight } from '../palette/highlight'
import { showChecks } from '../leftside/checks'
import { defineAction } from '../util/actions'
import { messageBox, dialogButtons } from '../util/dialogs'
import { htmlList, plural } from '../util/text'
import { loadFiles } from '../preview'
import { drawCover } from '../design/stage'
import type { NameplatePreview } from '../engine'

const ACTION_ID = 'polyplus_nameplate_export'
const DIALOG_ID = 'polyplus_nameplate_export_dialog'
const CODEC_ID = 'polyplus_nameplate_bundle'
const RESOURCE_ID = 'polyplus_nameplate_bundle'
const MAX_LISTED_ISSUES = 25
const TITLE = 'Export Nameplate'
const BUNDLE_TYPE = 'Nameplate Zip'
const SOURCE_FILE = 'source.bbmodel'
const BAD_NAME = /[\\/:*?"<>|]/
const ZIP_ENDING = /\.zip$/i
const COVERS_ACTION_ID = 'polyplus_nameplate_export_covers'
const COVERS_DIALOG_ID = 'polyplus_nameplate_covers_dialog'
const COVERS_TITLE = 'Export Covers'
const COVERS_TYPE = 'Nameplate Covers'
const COVER_SIZES: Record<string, string> = { '2': '2x', '4': '4x', '8': '8x' }
const DEFAULT_COVER_SIZE = '4'

let action: Action | null = null
let coversAction: Action | null = null
let codec: Codec | null = null
let removeHighlight: (() => void) | null = null
const fileNames = new WeakMap<object, string>()

function problemList(problems: Problem[]): string {
    return htmlList(problems.map((problem) => problem.text), MAX_LISTED_ISSUES)
}

function showIssues(errors: Problem[]) {
    showChecks()
    messageBox({
        title: TITLE,
        icon: 'error',
        message: `Fix ${plural(errors.length, 'error')} to export. Checks has a button for each.${problemList(errors)}`,
        buttons: ['Close'],
        width: 640,
    })
}

function showMessage(message: string, title = TITLE) {
    messageBox({ title, icon: 'error', message, buttons: ['Close'] })
}

function sourceText(): string | null {
    const compiled = Codecs.project?.compile({})
    if (typeof compiled === 'string') return compiled
    return compiled === undefined || compiled === null ? null : JSON.stringify(compiled)
}

function bundleId(bundle: CompiledBundle): string {
    try {
        const id = JSON.parse(bundle.files['manifest.json']).id
        return typeof id === 'string' && id ? id : 'nameplate'
    } catch (error) {
        return 'nameplate'
    }
}

async function pack(bundle: CompiledBundle, warnings: Problem[], includeSource: boolean): Promise<Blob> {
    const id = bundleId(bundle)
    const files = withToneHints({ ...bundle.files }, bundle.binary ?? {})
    const reported = warnings.filter((warning) => !warning.designerOnly).map((warning) => ({ code: warning.code ?? 'other', text: warning.text }))
    files[REPORT_FILE] = reportJson(id, [...reported, ...reviewerNotes(bundle)])
    let hasSource = false
    if (includeSource) {
        const source = sourceText()
        if (source !== null) {
            files[SOURCE_FILE] = source
            hasSource = true
        }
    }
    const size = archiveSize(files, bundle.binary ?? {})
    const early = archiveProblem(size, null, hasSource)
    if (early) throw new Error(early)
    const blob = await buildZip(files, bundle.binary ?? {})
    const late = archiveProblem(size, blob.size, hasSource)
    if (late) throw new Error(late)
    return blob
}

class IssuesShown extends Error {}

async function save(bundle: CompiledBundle, warnings: Problem[], includeSource: boolean, name: string) {
    let content: Blob
    try {
        content = await pack(bundle, warnings, includeSource)
    } catch (error) {
        showMessage(describe(error))
        return
    }
    Blockbench.export({
        type: BUNDLE_TYPE,
        extensions: ['zip'],
        name,
        resource_id: RESOURCE_ID,
        savetype: 'zip',
        content,
    })
}

function warningsLine(warnings: Problem[]): string {
    const reported = warnings.filter((warning) => !warning.designerOnly).length
    const total = plural(warnings.length, 'warning')
    if (reported === warnings.length) return `${total} (it still exports). The reviewer also sees them:`
    if (reported === 0) return `${total} (it still exports). Only you see them:`
    return `${total} (it still exports). The reviewer also sees ${reported}:`
}

function exportLines(warnings: Problem[]): string[] {
    const lines = [
        '<p>Send the zip to your reviewer to upload.</p>',
        '<p>Save your project too (File > Save Project). Importing the zip back loses some editor settings.</p>',
    ]
    if (warnings.length > 0) lines.push(`<p>${warningsLine(warnings)}</p>${problemList(warnings)}`)
    return lines
}

function typedName(typed: unknown, id: string): string {
    return String(typed ?? '').trim().replace(ZIP_ENDING, '').trim() || id
}

function openExportDialog(bundle: CompiledBundle, warnings: Problem[]) {
    const id = bundleId(bundle)
    const project = Project as object
    new Dialog({
        id: DIALOG_ID,
        title: TITLE,
        width: 640,
        lines: exportLines(warnings),
        form: {
            name: { label: 'File name', type: 'text', value: fileNames.get(project) ?? id },
            source: { label: 'Include the project file', type: 'checkbox', value: true },
        },
        ...dialogButtons('Export', 'Cancel'),
        onConfirm(form: { name: string, source: boolean }) {
            const name = typedName(form.name, id)
            if (BAD_NAME.test(name)) {
                Blockbench.showQuickMessage('Take these out of the file name: \\ / : * ? " < > |', 3000)
                return false
            }
            if (name === id) fileNames.delete(project)
            else fileNames.set(project, name)
            void save(bundle, warnings, !!form.source, name)
        },
    } as any).show()
}

export function exportBundle() {
    const problems = projectProblems()
    if (problems.errors.length > 0) {
        showIssues(problems.errors)
        return
    }
    const bundle = currentBundle()
    if (!zipAvailable()) {
        showMessage("This Blockbench version can't make zip files. Update Blockbench.")
        return
    }
    openExportDialog(bundle, problems.warnings)
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) reject(new Error("A cover couldn't be drawn."))
            else blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
        }, 'image/png')
    })
}

async function saveCovers(preview: NameplatePreview, scale: number, name: string) {
    let content: Blob
    try {
        const pictures: Record<string, Uint8Array> = {}
        for (const variant of preview.variants) {
            const canvas = drawCover(preview, variant, scale)
            if (!canvas) throw new Error(`The cover for '${variant}' couldn't be drawn.`)
            pictures[`${variant}.png`] = await canvasPng(canvas)
        }
        content = await buildZip({}, pictures)
    } catch (error) {
        showMessage(describe(error), COVERS_TITLE)
        return
    }
    Blockbench.export({
        type: COVERS_TYPE,
        extensions: ['zip'],
        name,
        resource_id: RESOURCE_ID,
        savetype: 'zip',
        content,
    })
}

export function exportCovers() {
    const problems = projectProblems()
    if (problems.errors.length > 0) {
        showIssues(problems.errors)
        return
    }
    if (!zipAvailable()) {
        showMessage("This Blockbench version can't make zip files. Update Blockbench.", COVERS_TITLE)
        return
    }
    const bundle = currentBundle()
    const preview = loadFiles(bundle.files).preview
    if (!preview) {
        showMessage("The nameplate can't be drawn yet, so there are no covers to save.", COVERS_TITLE)
        return
    }
    const fallback = `${bundleId(bundle)}_covers`
    new Dialog({
        id: COVERS_DIALOG_ID,
        title: COVERS_TITLE,
        width: 480,
        lines: [
            `<p>Saves a still picture of each variant (${plural(preview.variants.length, 'picture')}), named after the variant. Send them with the nameplate zip so your reviewer can upload them as covers.</p>`,
            '<p>They use the name and lines set in the preview.</p>',
        ],
        form: {
            name: { label: 'File name', type: 'text', value: fallback },
            size: { label: 'Size', type: 'select', options: COVER_SIZES, value: DEFAULT_COVER_SIZE },
        },
        ...dialogButtons('Export', 'Cancel'),
        onConfirm(form: { name: string, size: string }) {
            const name = typedName(form.name, fallback)
            if (BAD_NAME.test(name)) {
                Blockbench.showQuickMessage('Take these out of the file name: \\ / : * ? " < > |', 3000)
                return false
            }
            void saveCovers(preview, Number(form.size) || Number(DEFAULT_COVER_SIZE), name)
        },
    } as any).show()
}

function compileZip(): Promise<Blob> {
    const problems = projectProblems()
    if (problems.errors.length > 0) {
        showIssues(problems.errors)
        return Promise.reject(new IssuesShown('The nameplate has errors, so it was not exported.'))
    }
    return pack(currentBundle(), problems.warnings, false)
}

function writeZip(content: unknown, path: string) {
    Promise.resolve(content)
        .then((blob) => {
            if (!(blob instanceof Blob)) throw new Error("The zip couldn't be built.")
            Blockbench.writeFile(path, { savetype: 'zip', content: blob })
        })
        .catch((error) => {
            if (!(error instanceof IssuesShown)) showMessage(describe(error))
        })
}

function registerCodec() {
    if (codec || typeof Codec === 'undefined') return
    codec = new Codec(CODEC_ID, {
        name: BUNDLE_TYPE,
        extension: 'zip',
        remember: false,
        export() {
            exportBundle()
        },
        compile() {
            return compileZip()
        },
        write(content: any, path: string) {
            writeZip(content, path)
        },
        fileName() {
            return bundleId(currentBundle())
        },
        export_action: action ?? undefined,
    })
    const format = typeof Formats === 'undefined' ? undefined : Formats[FORMAT_ID]
    if (format && !format.codec) {
        format.codec = codec
        codec.format = format
    }
}

export function registerExport() {
    registerValidator()
    removeHighlight ??= registerHighlight()
    if (action) return
    action = defineAction(
        ACTION_ID,
        {
            name: TITLE,
            description: 'Save the nameplate as a zip',
            icon: 'archive',
            condition: { formats: [FORMAT_ID] },
            click() {
                exportBundle()
            },
        },
        'file.export.0',
    )
    coversAction = defineAction(
        COVERS_ACTION_ID,
        {
            name: COVERS_TITLE,
            description: 'Save a still picture of each variant for the store',
            icon: 'image',
            condition: { formats: [FORMAT_ID] },
            click() {
                exportCovers()
            },
        },
        'file.export.1',
    )
    try {
        registerCodec()
    } catch (error) {
        console.error('[polyplus_nameplate] could not register the bundle codec', error)
    }
}

export function unregisterExport() {
    const format = typeof Formats === 'undefined' ? undefined : Formats[FORMAT_ID]
    if (format && format.codec === codec) format.codec = undefined as any
    codec?.delete()
    codec = null
    action?.delete()
    action = null
    coversAction?.delete()
    coversAction = null
    removeHighlight?.()
    removeHighlight = null
    unregisterValidator()
}

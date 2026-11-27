import { engineSource } from '../engine'
import { plural } from '../util/text'

export const REPORT_FILE = 'report.json'
export const MAX_ENTRIES = 128
const MAX_ZIP_BYTES = 2 * 1024 * 1024
const MAX_UNZIPPED_BYTES = 8 * 1024 * 1024
export const MAX_FILE_BYTES = 1024 * 1024
const READ_FILE = /\.(json|png)$/i

export interface ReportEntry {
    code: string
    text: string
}

interface LargestFile {
    path: string
    bytes: number
}

export interface ArchiveSize {
    entries: number
    bytes: number
    largest: LargestFile | null
}

export function reportJson(id: string, warnings: ReportEntry[]): string {
    const report = {
        report: 1,
        nameplate: id,
        engine: { commit: engineSource().commit, hash: engineSource().hash },
        summary: warnings.length === 0 ? 'No warnings.' : `${plural(warnings.length, 'warning')} for the reviewer. None of them block the upload.`,
        warnings: warnings.map((warning) => ({ code: warning.code, text: warning.text })),
    }
    return `${JSON.stringify(report, null, 2)}\n`
}

export function archiveSize(files: Record<string, string>, binary: Record<string, Uint8Array> = {}): ArchiveSize {
    const paths = [...Object.keys(files), ...Object.keys(binary)]
    const folders = new Set<string>()
    for (const path of paths) {
        const parts = path.split('/')
        for (let depth = 1; depth < parts.length; depth++) folders.add(parts.slice(0, depth).join('/'))
    }
    const encoder = new TextEncoder()
    let bytes = 0
    let largest: LargestFile | null = null
    const count = (path: string, size: number) => {
        bytes += size
        if (READ_FILE.test(path) && (!largest || size > largest.bytes)) largest = { path, bytes: size }
    }
    for (const [path, text] of Object.entries(files)) count(path, encoder.encode(text).length)
    for (const [path, data] of Object.entries(binary)) count(path, data.length)
    return { entries: paths.length + folders.size, bytes, largest }
}

function megabytes(bytes: number): string {
    return `${Math.round((bytes / (1024 * 1024)) * 100) / 100} MB`
}

export function archiveProblem(size: ArchiveSize, zipBytes: number | null, hasSource: boolean): string | null {
    const source = hasSource ? ' Uncheck "Include the project file" to make it smaller, or use' : ' Use'
    if (size.entries > MAX_ENTRIES) {
        return `The zip would have ${size.entries} files and folders, and the game reads at most ${MAX_ENTRIES}. Use fewer layers or pictures.`
    }
    if (size.largest && size.largest.bytes > MAX_FILE_BYTES) {
        return `'${size.largest.path}' in the zip is ${megabytes(size.largest.bytes)}, and the game skips any file over ${megabytes(MAX_FILE_BYTES)}. Use fewer or smaller pictures, or fewer frames.`
    }
    if (size.bytes > MAX_UNZIPPED_BYTES) {
        return `The zip unpacks to ${megabytes(size.bytes)}, and the game reads at most ${megabytes(MAX_UNZIPPED_BYTES)}.${source} fewer or smaller pictures.`
    }
    if (zipBytes !== null && zipBytes > MAX_ZIP_BYTES) {
        return `The zip is ${megabytes(zipBytes)}, and the game downloads at most ${megabytes(MAX_ZIP_BYTES)}.${source} fewer or smaller pictures.`
    }
    return null
}

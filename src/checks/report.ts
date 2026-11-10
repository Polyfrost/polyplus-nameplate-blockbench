import { plural } from '../util/text'

export const REPORT_FILE = 'report.json'
export const MAX_ENTRIES = 128
const MAX_ZIP_BYTES = 2 * 1024 * 1024
const MAX_UNZIPPED_BYTES = 8 * 1024 * 1024

export interface ReportEntry {
    code: string
    text: string
}

interface ArchiveSize {
    entries: number
    bytes: number
}

export function reportJson(id: string, warnings: ReportEntry[]): string {
    const report = {
        report: 1,
        nameplate: id,
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
    for (const text of Object.values(files)) bytes += encoder.encode(text).length
    for (const data of Object.values(binary)) bytes += data.length
    return { entries: paths.length + folders.size, bytes }
}

function megabytes(bytes: number): string {
    return `${Math.round((bytes / (1024 * 1024)) * 100) / 100} MB`
}

export function archiveProblem(size: ArchiveSize, zipBytes: number | null, hasSource: boolean): string | null {
    const source = hasSource ? ' Uncheck "Include the project file" to make it smaller, or use' : ' Use'
    if (size.entries > MAX_ENTRIES) {
        return `The zip would have ${size.entries} files and folders, and the game reads at most ${MAX_ENTRIES}. Use fewer layers or pictures.`
    }
    if (size.bytes > MAX_UNZIPPED_BYTES) {
        return `The zip unpacks to ${megabytes(size.bytes)}, and the game reads at most ${megabytes(MAX_UNZIPPED_BYTES)}.${source} fewer or smaller pictures.`
    }
    if (zipBytes !== null && zipBytes > MAX_ZIP_BYTES) {
        return `The zip is ${megabytes(zipBytes)}, and the game downloads at most ${megabytes(MAX_ZIP_BYTES)}.${source} fewer or smaller pictures.`
    }
    return null
}

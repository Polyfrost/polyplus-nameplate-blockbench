import { describe } from '../engine'
import { segmentTextureId } from '../util/bundlePath'

export const MANIFEST = 'manifest.json'
export const PALETTES = 'palettes.json'
export const FLAGS = 'flags.json'
export const SOURCE = 'source.bbmodel'
const MAX_ENTRIES = 512
const MAX_TEXT_BYTES = 4 * 1024 * 1024
const TEXT_FILES = /\.(json|bbmodel)$/i

export interface PickedFiles {
    files: Record<string, string>
    skipped: string[]
    errors: string[]
    binary?: Record<string, Uint8Array>
}

interface ZipEntry {
    name: string
    dir: boolean
    async(type: 'string'): Promise<string>
    async(type: 'uint8array'): Promise<Uint8Array>
}

interface ZipReader {
    files: Record<string, ZipEntry>
}

interface ZipLoader {
    loadAsync(data: ArrayBuffer | Uint8Array): Promise<ZipReader>
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function baseName(path: string): string {
    const normal = normalizePath(path)
    return normal.slice(normal.lastIndexOf('/') + 1)
}

function folderOf(path: string): string {
    const normal = normalizePath(path)
    const at = normal.lastIndexOf('/')
    return at < 0 ? '' : normal.slice(0, at + 1)
}

export function emptyPicked(): PickedFiles {
    return { files: {}, skipped: [], errors: [], binary: {} }
}

async function readZip(name: string, content: ArrayBuffer, into: PickedFiles) {
    const loader = (globalThis as { JSZip?: ZipLoader }).JSZip
    if (!loader || typeof loader.loadAsync !== 'function') {
        into.errors.push(`${name}: this Blockbench build has no zip reader, pick the zip's files instead`)
        return
    }
    let zip: ZipReader
    try {
        zip = await loader.loadAsync(content)
    } catch (error) {
        into.errors.push(`${name}: not a readable zip (${describe(error)})`)
        return
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir)
    if (entries.length > MAX_ENTRIES) {
        into.errors.push(`${name}: holds ${entries.length} files, more than ${MAX_ENTRIES}`)
        return
    }
    const manifests = entries
        .map((entry) => normalizePath(entry.name))
        .filter((path) => baseName(path) === MANIFEST)
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    const prefix = manifests.length > 0 ? folderOf(manifests[0]) : ''
    for (const entry of entries) {
        const path = normalizePath(entry.name)
        if (!path.startsWith(prefix)) continue
        const relative = path.slice(prefix.length)
        if (!relative || relative.startsWith('__MACOSX/')) continue
        if (segmentTextureId(relative) !== null) {
            into.binary = into.binary ?? {}
            into.binary[relative] = await entry.async('uint8array')
            continue
        }
        if (!TEXT_FILES.test(relative)) {
            into.skipped.push(relative)
            continue
        }
        const text = await entry.async('string')
        if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
            into.skipped.push(relative)
            continue
        }
        into.files[relative] = text.replace(/^﻿/, '')
    }
}

function classifyLoose(path: string, text: string): string {
    const normal = normalizePath(path)
    const name = baseName(normal)
    if (name === MANIFEST || name === PALETTES || name === FLAGS || name === SOURCE) return name
    if (/(^|\/)layers\/[^/]+$/.test(normal)) return `layers/${name}`
    if (/(^|\/)sprites\/[^/]+$/.test(normal)) return `sprites/${name}`
    if (/(^|\/)materials\/[^/]+$/.test(normal)) return `materials/${name}`
    try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            if (typeof parsed.kind === 'string') return `layers/${name}`
            if (parsed.colors && typeof parsed.colors === 'object') return `sprites/${name}`
            if (Array.isArray(parsed.nodes)) return `materials/${name}`
        }
    } catch {
        return name
    }
    return name
}

export async function collectFiles(results: Filesystem.FileResult[], into: PickedFiles = emptyPicked()): Promise<PickedFiles> {
    for (const result of results) {
        const name = result.name || baseName(result.path || '')
        const content = result.content
        if (/\.zip$/i.test(name)) {
            if (content instanceof ArrayBuffer) await readZip(name, content, into)
            else into.errors.push(`${name}: couldn't read the zip`)
            continue
        }
        if (/\.png$/i.test(name) && content instanceof ArrayBuffer) {
            into.binary = into.binary ?? {}
            into.binary[`textures/${name}`] = new Uint8Array(content)
            continue
        }
        if (typeof content !== 'string') {
            into.skipped.push(name)
            continue
        }
        const text = content.replace(/^﻿/, '')
        into.files[classifyLoose(result.path || name, text)] = text
    }
    return into
}

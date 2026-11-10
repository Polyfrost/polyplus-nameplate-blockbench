interface ZipEntryOptions {
    date: Date
}

interface ZipArchive {
    file(name: string, data: string | Uint8Array, options?: ZipEntryOptions): ZipArchive
    generateAsync(options: { type: 'blob'; compression: 'DEFLATE' }): Promise<Blob>
}

type ZipConstructor = new () => ZipArchive

const ENTRY_DATE = new Date(Date.UTC(2000, 0, 1))

export function zipAvailable(): boolean {
    return typeof (globalThis as { JSZip?: unknown }).JSZip === 'function'
}

export async function buildZip(files: Record<string, string>, binary: Record<string, Uint8Array> = {}): Promise<Blob> {
    const constructor = (globalThis as { JSZip?: ZipConstructor }).JSZip
    if (typeof constructor !== 'function') throw new Error('JSZip is not available in this Blockbench build')
    const archive = new constructor()
    for (const path of Object.keys(files).sort()) archive.file(path, files[path], { date: ENTRY_DATE })
    for (const path of Object.keys(binary).sort()) archive.file(path, binary[path], { date: ENTRY_DATE })
    return archive.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

import { deflateZip } from '../util/zip'

export async function buildZip(files: Record<string, string>, binary: Record<string, Uint8Array> = {}): Promise<Blob> {
    return new Blob([deflateZip({ ...files, ...binary }) as BlobPart], { type: 'application/zip' })
}

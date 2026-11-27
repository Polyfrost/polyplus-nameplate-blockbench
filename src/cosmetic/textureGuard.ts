import { isRecord } from '../util/json'
import { disposeAll } from '../util/teardown'
import { isCosmeticActive } from './state'

export const ONE_TEXTURE_MESSAGE = 'A cosmetic uses one texture. Paint on the one you have, or delete it first.'
const MESSAGE_MS = 3500

export function addedTextures(entry: unknown): string[] {
    if (!isRecord(entry)) return []
    const before = isRecord(entry.before) && isRecord(entry.before.textures) ? entry.before.textures : {}
    const after = isRecord(entry.post) && isRecord(entry.post.textures) ? entry.post.textures : null
    return after ? Object.keys(after).filter((uuid) => !(uuid in before)) : []
}

export function undoesExtraTexture(entry: unknown, pending: ReadonlySet<string>, textures: number): boolean {
    if (textures <= 1) return false
    return addedTextures(entry).some((uuid) => pending.has(uuid))
}

function latestEntry(undo: any): unknown {
    if (!undo || !Array.isArray(undo.history) || typeof undo.index !== 'number' || undo.index < 1) return null
    return undo.history[undo.index - 1] ?? null
}

export function takeBackExtraTexture(undo: any, added: ReadonlySet<string>, textures: number): boolean {
    const entry = latestEntry(undo)
    if (!undoesExtraTexture(entry, added, textures)) return false
    undo.undo()
    const at = undo.history.indexOf(entry)
    if (at >= 0 && at >= undo.index) undo.history.splice(at, 1)
    return true
}

export function registerTextureGuard(): () => void {
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = () => {
        timer = null
        if (!pending.size) return
        const added = new Set(pending)
        pending.clear()
        if (!isCosmeticActive() || typeof Texture === 'undefined') return
        try {
            if (!takeBackExtraTexture((globalThis as any).Undo, added, Texture.all.length)) return
        } catch (error) {
            console.error('[polyplus_nameplate] could not take back the extra texture', error)
            return
        }
        Blockbench.showQuickMessage(ONE_TEXTURE_MESSAGE, MESSAGE_MS)
    }
    const listeners = [
        Blockbench.on('add_texture' as any, (event: any) => {
            const uuid = event?.texture?.uuid
            if (isCosmeticActive() && typeof uuid === 'string') pending.add(uuid)
        }),
        Blockbench.on('finished_edit' as any, () => {
            if (!pending.size || timer !== null) return
            timer = setTimeout(check, 0)
        }),
        Blockbench.on('select_project' as any, () => pending.clear()),
    ]
    return () => {
        if (timer !== null) clearTimeout(timer)
        timer = null
        pending.clear()
        disposeAll(listeners)
    }
}

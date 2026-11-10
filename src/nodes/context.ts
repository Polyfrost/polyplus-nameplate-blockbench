import { DEFAULT_FPS } from '../format'

interface ContextSlot {
    id: string
    name?: string
    ramp: string[]
}

export interface ContextTexture {
    width: number
    height: number
    png?: () => Uint8Array | null
}

export interface MaterialContext {
    slots: ContextSlot[]
    fps: number
    loop: number
    params: Record<string, number>
    sprites: Record<string, string>
    textures: Record<string, ContextTexture>
}

export const DEFAULT_LOOP = 20

export function completeContext(partial: Partial<MaterialContext> | null | undefined): MaterialContext {
    return {
        slots: Array.isArray(partial?.slots) ? partial.slots : [],
        fps: typeof partial?.fps === 'number' && partial.fps > 0 ? partial.fps : DEFAULT_FPS,
        loop: typeof partial?.loop === 'number' && partial.loop > 0 ? partial.loop : DEFAULT_LOOP,
        params: partial?.params ?? {},
        sprites: partial?.sprites ?? {},
        textures: partial?.textures ?? {},
    }
}

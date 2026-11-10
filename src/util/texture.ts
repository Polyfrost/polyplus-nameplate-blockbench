export const FRAMES_PROPERTY = 'nameplate_frames'

export function findTexture(uuid: unknown): Texture | undefined {
    if (typeof Texture === 'undefined') return undefined
    return Texture.all.find((texture) => texture.uuid === uuid)
}

export function setFrameCount(texture: Texture, frames: number) {
    ;(texture as any)[FRAMES_PROPERTY] = frames
}

export function canvasOf(width: number, height: number, paint?: (context: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = paint ? canvas.getContext('2d') : null
    if (context) paint?.(context)
    return canvas
}

export function textureFromCanvas(canvas: HTMLCanvasElement, options: { name: string, frames: number }): Texture {
    const texture = new Texture({ name: `${options.name}.png`, keep_size: true } as TextureData)
    setFrameCount(texture, options.frames)
    texture.load_callback = () => {
        texture.load_callback = null
        texture.uv_width = canvas.width
        texture.uv_height = canvas.height
        Blockbench.dispatchEvent('update_selection', {} as any)
    }
    texture.fromDataURL(canvas.toDataURL('image/png'))
    texture.add(false)
    return texture
}

export function readTexturePixels(texture: Texture | undefined): { width: number, height: number, data: Uint8ClampedArray } | null {
    const canvas = texture?.canvas
    const ctx = texture?.ctx
    if (!canvas || !ctx || !(canvas.width > 0) || !(canvas.height > 0)) return null
    return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
}

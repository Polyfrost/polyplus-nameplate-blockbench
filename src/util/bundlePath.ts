const ID_PATTERNS = { loose: '.+', segment: '[^/]+', slug: '[a-z0-9_]+' }

function bundleFileId(folder: string, extension: string, shape: keyof typeof ID_PATTERNS, flags = ''): (path: string) => string | null {
    const pattern = new RegExp(`^${folder}\\/(${ID_PATTERNS[shape]})\\.${extension}$`, flags)
    return (path) => pattern.exec(path)?.[1] ?? null
}

export const looseLayerId = bundleFileId('layers', 'json', 'loose')
export const looseSpriteId = bundleFileId('sprites', 'json', 'loose')
export const segmentLayerId = bundleFileId('layers', 'json', 'segment')
export const segmentSpriteId = bundleFileId('sprites', 'json', 'segment')
export const segmentMaterialId = bundleFileId('materials', 'json', 'segment')
export const segmentTextureId = bundleFileId('textures', 'png', 'segment', 'i')
export const slugSpriteId = bundleFileId('sprites', 'json', 'slug')
export const slugTextureId = bundleFileId('textures', 'png', 'slug')

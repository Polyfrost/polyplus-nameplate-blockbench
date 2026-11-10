import type { BodyData } from '../model'

export type Corners = [number, number, number, number]

const MAX_RADIUS = 16
export const MAX_CORNER = 32
export const CORNERS_PROPERTY = 'corners'

export const CORNER_NAMES = ['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const

export function cornerValue(value: unknown, fallback = 0): number {
    const number = Math.round(Number(value))
    return isFinite(number) ? Math.min(MAX_CORNER, Math.max(0, number)) : fallback
}

export function readCorners(node: any): Corners | null {
    const list = node?.[CORNERS_PROPERTY]
    if (!Array.isArray(list) || list.length !== 4) return null
    return [cornerValue(list[0]), cornerValue(list[1]), cornerValue(list[2]), cornerValue(list[3])]
}

function sameCorners(corners: Corners): boolean {
    return corners.every((value) => value === corners[0])
}

export function bodyCorners(layer: { radius: number, corners?: Corners | null }): Corners {
    return layer.corners ?? [layer.radius, layer.radius, layer.radius, layer.radius]
}

export function cornerFields(layer: BodyData): Record<string, unknown> {
    const corners = bodyCorners(layer)
    if (sameCorners(corners) && corners[0] <= MAX_RADIUS) return { radius: corners[0] }
    return { corners }
}

export function cornerProps(file: Record<string, any>): { radius: number, corners: number[] } {
    const list = file.corners
    if (Array.isArray(list) && list.length === 4 && list.every((value) => Number.isInteger(value))) {
        const corners = list.map((value) => cornerValue(value)) as Corners
        if (sameCorners(corners)) return { radius: corners[0], corners: [] }
        return { radius: Math.max(...corners), corners }
    }
    return { radius: Number.isInteger(file.radius) ? file.radius : 0, corners: [] }
}

export function defineCornerProperties(target: any) {
    new Property(target, 'array', CORNERS_PROPERTY, { default: () => [] })
}

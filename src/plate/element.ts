import { defineElementType, ElementType } from '../elements/classes'
import { Channel, PLATE_TYPE } from '../model'

export const PLATE_CHANNELS: Channel[] = ['position']
export const PLATE_NAME = 'Whole nameplate'

export type PlateType = ElementType

export function definePlateType(menu: any[]): PlateType {
    return defineElementType({
        type: PLATE_TYPE,
        title: PLATE_NAME,
        icon: 'open_with',
        channels: PLATE_CHANNELS,
        menu,
        define(target) {
            new Property(target, 'string', 'name', { default: PLATE_NAME })
            new Property(target, 'boolean', 'visibility', { default: true })
        },
    })
}

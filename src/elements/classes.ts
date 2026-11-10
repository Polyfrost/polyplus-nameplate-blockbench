import { BODY_TYPE, Channel, SPRITE_TYPE } from '../model'
import { BODY_CHANNELS, channelSet, SPRITE_CHANNELS } from './channels'
import { defineBodyProperties } from '../kinds/body'
import { defineSpriteProperties } from '../kinds/sprite'

export interface LayerTypes {
    body: any
    sprite: any
    dispose(): void
}

export const LAYER_MENU = [
    'polyplus_nameplate_add_group',
]

export function layerMenuItems(): any[] {
    return [
        ...LAYER_MENU,
        new MenuSeparator('manage'),
        ...Outliner.control_menu_group,
        'rename',
        'delete',
    ]
}

export interface ElementType {
    type: any
    animator?: any
    dispose(): void
}

export interface ElementSpec {
    type: string
    title: string
    icon: string
    channels?: Channel[] | Record<string, any>
    extendAnimator?: (Base: any) => any
    onSelectAnimator?: (animator: any, element: any) => void
    hideable?: boolean
    rootOnly?: boolean
    menu: any[]
    define(target: any): void
}

function defineAnimator(type: string, channels: Channel[] | Record<string, any>, extend?: (Base: any) => any): any {
    class LayerAnimator extends (BoneAnimator as any) {
        getElement() {
            return OutlinerNode.uuids[this.uuid]
        }

        doRender() {
            return !!this.getElement()
        }

        displayFrame(_multiplier?: number) {}
    }
    const AnimatorClass = extend ? extend(LayerAnimator) : LayerAnimator
    const prototype = AnimatorClass.prototype as any
    prototype.type = type
    prototype.channels = Array.isArray(channels) ? channelSet(channels) : channels
    return AnimatorClass
}

export function defineElementType(spec: ElementSpec): ElementType {
    const animated = !!spec.channels

    class PinnedElement extends (OutlinerElement as any) {
        constructor(data?: any, uuid?: string) {
            super(data, uuid)
            const properties = (this.constructor as any).properties
            for (const key in properties) properties[key].reset(this)
            if (data && typeof data === 'object') this.extend(data)
        }

        extend(data: any) {
            const properties = (this.constructor as any).properties
            for (const key in properties) properties[key].merge(this, data)
            return this
        }

        select(event?: Event, outlinerClick?: boolean) {
            if (!animated) {
                if (!Modes.animate) return super.select(event, outlinerClick)
                unselectAllElements([this as any])
                this.markAsSelected()
                TickUpdates.selection = true
                return this
            }
            const result = super.select(event, outlinerClick)
            if (result !== false && Animator.open && BBAnimation.selected) {
                const animator = BBAnimation.selected.getBoneAnimator(this as any) as any
                if (animator) spec.onSelectAnimator?.(animator, this)
                animator?.select(true)
            }
            return result
        }

        unselect(...args: any[]) {
            const selected = Timeline.selected_animator as any
            if (Animator.open && selected && selected.getElement?.() === this) selected.selected = false
            return super.unselect(...args)
        }

        getWorldCenter() {
            return new (globalThis as any).THREE.Vector3()
        }
    }

    const dispose = () => {
        if ((OutlinerElement.types as any)[spec.type] === PinnedElement) delete (OutlinerElement.types as any)[spec.type]
    }

    let animatorClass: any
    try {
        spec.define(PinnedElement)
        if (spec.rootOnly) (PinnedElement as any).behavior = { ...(OutlinerElement as any).behavior, parent_types: ['root'] }

        const prototype = PinnedElement.prototype as any
        prototype.title = spec.title
        prototype.origin = [0, 0, 0]
        prototype.icon = spec.icon
        prototype.buttons = spec.hideable ? [Outliner.buttons.visibility, Outliner.buttons.locked] : []
        prototype.menu = new Menu(spec.menu)

        if (spec.channels) {
            animatorClass = defineAnimator(spec.type, spec.channels, spec.extendAnimator)
            ;(PinnedElement as any).animator = animatorClass
        }

        new NodePreviewController(PinnedElement as any, {
            setup(element: OutlinerNode) {
                const mesh = new (globalThis as any).THREE.Object3D()
                mesh.name = element.uuid
                mesh.type = spec.type
                mesh.isElement = true
                mesh.visible = !spec.hideable || element.visibility !== false
                Project.nodes_3d[element.uuid] = mesh
            },
            remove(element: OutlinerNode) {
                delete Project.nodes_3d[element.uuid]
            },
            updateTransform() {},
            updateVisibility() {},
            updateSelection() {},
            updateGeometry() {},
            updateAll() {},
        } as any)

        OutlinerElement.registerType(PinnedElement as any, spec.type)
    } catch (error) {
        dispose()
        throw error
    }
    return { type: PinnedElement, animator: animatorClass, dispose }
}

export function defineLayerTypes(): LayerTypes {
    const body = defineElementType({
        type: BODY_TYPE,
        title: 'Nameplate body',
        icon: 'rounded_corner',
        channels: BODY_CHANNELS,
        hideable: true,
        menu: layerMenuItems(),
        define: defineBodyProperties,
    })
    let sprite: ElementType
    try {
        sprite = defineElementType({
            type: SPRITE_TYPE,
            title: 'Nameplate sprite',
            icon: 'image',
            channels: SPRITE_CHANNELS,
            hideable: true,
            menu: layerMenuItems(),
            define: defineSpriteProperties,
        })
    } catch (error) {
        body.dispose()
        throw error
    }
    return {
        body: body.type,
        sprite: sprite.type,
        dispose() {
            sprite.dispose()
            body.dispose()
        },
    }
}

export const NAME_TEXT_NAME = 'Name text'

export type NameTextType = ElementType

export function defineNameTextType(type: string, menu: any[]): NameTextType {
    return defineElementType({
        type,
        title: NAME_TEXT_NAME,
        icon: 'title',
        rootOnly: true,
        menu,
        define(target) {
            new Property(target, 'string', 'name', { default: NAME_TEXT_NAME })
            new Property(target, 'boolean', 'visibility', { default: true })
        },
    })
}

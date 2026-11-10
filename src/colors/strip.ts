import {
    SlotView,
    addShade,
    addStop,
    addVariantFor,
    colorsUi,
    openAddColorDialog,
    openBlendDialog,
    openShadeDialog,
    openStopDialog,
    pickTone,
    readyToPaint,
    slotMenu,
    stopMenu,
    toneMenu,
} from '../design/colors'
import { openSlotMolangEditor } from '../molang/editor'
import { alphaOf, cssColor, isTranslucent } from '../palette/color'
import { isSlotDriven } from '../molang/slots'
import { openEffectDialog } from '../palanim/dialog'
import { onFocusSlot } from '../palanim/edit'
import {
    addKeyHere,
    dropKey,
    editKeyAt,
    fasterEffect,
    goToFrame,
    openDirectionMenu,
    openKeyMenu,
    palanimUi,
    safeEffect,
    slowerEffect,
    stopEffect,
    toggleSlotEffect,
} from '../palanim/panel'
import { openSweepDialog } from '../palanim/sweep'
import { injectStyle } from '../util/style'
import { onStripParts, stripParts } from './host'

export const STRIP_TOGGLE = 'polyplus_nameplate_color_strip'
const STYLE_ID = 'polyplus_nameplate_strip_style'

const STYLE = `
.np-strip { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background-color: var(--color-ui); border-top: 1px solid var(--color-border); }
.np-strip-head { flex: none; display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 6px; }
.np-strip-title { flex: none; font-weight: 600; cursor: pointer; }
.np-strip-bar { flex: 0 1 auto; min-width: 0; }
.np-strip-bar > .toolbar { width: auto; }
ul.np-strip-mini { flex: 1 1 auto; min-width: 0; display: flex; gap: 6px; margin: 0; padding: 0; overflow: hidden; list-style: none; cursor: pointer; }
ul.np-strip-mini > li { flex: none; display: flex; height: 14px; border: 1px solid var(--color-border); list-style: none; }
ul.np-strip-mini > li > span { width: 8px; }
.np-strip-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-bottom: 4px; }
.np-strip-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 3px 8px; border-left: 2px solid transparent; }
.np-strip-tones ul.np-swatches > li { flex: none; width: 22px; min-width: 22px; height: 22px; }
ul.np-swatches > li.np-shade-used { position: relative; }
ul.np-swatches > li.np-shade-used::after { content: ''; position: absolute; right: 1px; bottom: 1px; width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); border: 1px solid var(--color-ui); }
.np-strip-row:hover { background-color: var(--color-back); }
.np-strip-row.np-strip-open { border-left-color: var(--color-accent); background-color: var(--color-back); }
.np-strip-name { flex: 1 0 7em; min-width: 0; align-self: stretch; display: flex; flex-direction: column; justify-content: center; }
.np-strip-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 0.9em; }
.np-strip-tags > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.np-strip-tones { flex: 100 1 160px; min-width: 0; order: 3; }
button.np-strip-animate, .np-strip-row > .np-icon-button { order: 2; }
.np-strip-tones > ul.np-palanim-strip { height: 5px; margin-top: 3px; }
.np-strip-tones > .np-subtle { margin: 2px 0; }
button.np-strip-animate { flex: none; display: inline-flex; align-items: center; gap: 4px; }
button.np-strip-animate.np-on { background-color: var(--color-accent); color: var(--color-accent_text, #fff); }
.np-strip .color_inner.np-checker { background: repeating-conic-gradient(#8c8c8c 0% 25%, #3c3c3c 0% 50%) 0 0 / 8px 8px; }
.np-strip .np-fill { width: 100%; height: 100%; }
.np-strip-effect { margin: 0 8px 4px 8px; border-left: 2px solid var(--color-accent); border-top: none; background-color: var(--color-back); }
`

const NO_MOTION = { id: '', name: '', summary: '', animated: false, problem: false, swatches: [] as string[] }

const stripUi: { folded: boolean } = { folded: false }

let view: any = null

function stripToggle(): Toggle | undefined {
    return typeof BarItems === 'undefined' ? undefined : (BarItems as any)[STRIP_TOGGLE] as Toggle | undefined
}

export function setStripFolded(folded: boolean) {
    if (stripUi.folded === folded) return
    stripUi.folded = folded
    const toggle = stripToggle()
    if (toggle && toggle.value === folded) toggle.set(!folded)
}

function scrollToRow(body: HTMLElement, row: HTMLElement) {
    const origin = body.getBoundingClientRect().top - body.scrollTop
    const place = (element: Element) => element.getBoundingClientRect().top - origin
    const next = row.nextElementSibling as HTMLElement | null
    const detail = next?.classList.contains('np-strip-effect') ? next : null
    const start = place(row)
    const end = (detail ?? row).getBoundingClientRect().bottom - origin
    const space = body.clientHeight
    if (end - start <= space) {
        if (start < body.scrollTop) body.scrollTop = start
        else if (end > body.scrollTop + space) body.scrollTop = end - space
        return
    }
    if (!detail) body.scrollTop = start
    else if (detail.offsetHeight <= space) body.scrollTop = place(detail)
    else body.scrollTop = place(detail.querySelector('.np-palanim-buttons') ?? detail)
}

function revealSlot(slotId: string) {
    setStripFolded(false)
    if (!view) return
    view.$nextTick(() => {
        try {
            const root = view.$el as HTMLElement
            const body = root.querySelector('.np-strip-body') as HTMLElement | null
            const rows = Array.from(root.querySelectorAll('[data-slot]')) as HTMLElement[]
            const row = rows.find((entry) => entry.dataset.slot === slotId)
            if (body && row) scrollToRow(body, row)
        } catch (error) {
            console.error('[polyplus_nameplate] could not show the color', error)
        }
    })
}

const component = {
    data() {
        return { ui: colorsUi, anim: palanimUi, strip: stripUi }
    },
    computed: {
        motionById(this: any): Record<string, typeof NO_MOTION> {
            const map: Record<string, typeof NO_MOTION> = {}
            for (const row of this.anim.rows) map[row.id] = row
            return map
        },
    },
    methods: {
        toggleFold() {
            setStripFolded(!stripUi.folded)
        },
        motion(this: any, id: string): typeof NO_MOTION {
            return this.motionById[id] ?? NO_MOTION
        },
        isBrush(slot: SlotView, tone: number): boolean {
            const main = slot.main[Math.max(0, Math.min(slot.main.length - 1, tone))] ?? ''
            return main.toLowerCase() === colorsUi.brush.toLowerCase()
        },
        pick: pickTone,
        addVariant() {
            addVariantFor(colorsUi.colorway)
        },
        edit(slot: number, tone: number) {
            if (colorsUi.slots[slot]?.blend) {
                if (colorsUi.first) openBlendDialog(slot)
                return
            }
            openShadeDialog(slot, tone)
        },
        editStop: openStopDialog,
        stopMenu(slot: number, stop: number, event: Event) {
            stopMenu(slot, stop).open(event as MouseEvent)
        },
        addStop,
        blendNote(slot: SlotView): string {
            return slot.blend ? `Blends ${slot.blend.tones} shades from these stops:` : ''
        },
        fill(tone: string): Record<string, string> {
            return { 'background-color': cssColor(tone) }
        },
        seeThrough: isTranslucent,
        hexText(hex: string): string {
            return isTranslucent(hex) ? `${hex}, see-through: ${Math.round((alphaOf(hex) / 255) * 100)}% opaque` : hex
        },
        stopTitle(this: any, slot: SlotView, stop: number, hex: string): string {
            return `${slot.name}, stop ${stop + 1} (${this.hexText(hex)}). Click to change it, right-click for more`
        },
        toneMenu(slot: number, tone: number, event: Event) {
            toneMenu(slot, tone).open(event as MouseEvent)
        },
        slotMenu(slot: number, event: Event) {
            slotMenu(slot).open(event as MouseEvent)
        },
        addShade,
        addColor: openAddColorDialog,
        isDriven: isSlotDriven,
        editFormula: openSlotMolangEditor,
        toneTitle(this: any, slot: SlotView, tone: number, hex: string): string {
            if (slot.blend) return `${slot.name}, shade ${tone + 1} (${this.hexText(hex)}), blended from the stops below. Click to paint, right-click for more`
            if (colorsUi.first) return `${slot.name}, shade ${tone + 1} (${this.hexText(hex)}). ${readyToPaint() ? 'Click to paint, double-click to edit' : 'Click to edit'}, right-click for more`
            const main = slot.main[Math.max(0, Math.min(slot.main.length - 1, tone))] ?? hex
            return `${slot.name}, shade ${tone + 1} (${this.hexText(hex)} here, ${this.hexText(main)} in the main colors). Click to paint with the main color, double-click to edit, right-click for more`
        },
        animateTitle(id: string, name: string): string {
            if (palanimUi.selected === id) return 'Close the color animation'
            return palanimUi.scoped
                ? `Change ${name} while '${palanimUi.scopeName}' plays`
                : `Make ${name} shimmer, pulse or run through a rainbow`
        },
        toggleEffect(id: string) {
            toggleSlotEffect(id)
            if (palanimUi.selected === id) revealSlot(id)
        },
        choose: openEffectDialog,
        stop: stopEffect,
        sweep: openSweepDialog,
        faster: fasterEffect,
        slower: slowerEffect,
        safe: safeEffect,
        direction: openDirectionMenu,
        go: goToFrame,
        editKey: editKeyAt,
        addKey: addKeyHere,
        removeKey: dropKey,
        keyMenu: openKeyMenu,
    },
    template: `
        <div class="np-strip">
            <div class="np-strip-head">
                <i class="material-icons notranslate icon np-icon-button" :title="strip.folded ? 'Show the colors' : 'Fold the colors to one line'" @click="toggleFold()">{{ strip.folded ? 'expand_less' : 'expand_more' }}</i>
                <span class="np-strip-title" :title="strip.folded ? 'Show the colors' : 'Fold the colors to one line'" @click="toggleFold()">Colors</span>
                <div ref="bar" class="np-strip-bar"></div>
                <ul v-if="strip.folded" class="np-strip-mini" title="Click to show the colors" @click="toggleFold()">
                    <li v-for="slot in ui.slots" :key="slot.id" :title="slot.name"><span v-for="(tone, index) in slot.ramp" :key="index" :style="fill(tone)"></span></li>
                </ul>
            </div>
            <div v-show="!strip.folded" class="np-strip-body mobile_scrollbar">
                <p v-if="!ui.hasProject" class="np-panel-empty">Open a nameplate to edit its colors.</p>
                <template v-else>
                    <p v-if="!ui.first" class="np-panel-note">Colorway <strong>{{ ui.colorway }}</strong>: changes here apply to it only. You still paint with the main colors.</p>
                    <div v-if="ui.unused" class="np-panel-note">
                        <p>No variant uses this colorway, so players never see it.</p>
                        <button type="button" @click="addVariant()"><i class="material-icons notranslate icon">add</i> Add a variant that uses it</button>
                    </div>
                    <p v-if="anim.scoped" class="np-panel-note">Color changes while <strong>{{ anim.scopeName }}</strong> plays ({{ anim.loopText }}). Click Animate on a color to change it. Select the loop animation to edit the loop's colors.</p>
                    <p v-if="anim.scopeNote" class="np-panel-note">{{ anim.scopeNote }}</p>
                    <template v-for="slot in ui.slots">
                        <div :key="slot.id" class="np-strip-row" :class="{ 'np-strip-open': anim.selected === slot.id }" :data-slot="slot.id">
                            <div class="np-strip-name" @contextmenu.prevent.stop="slotMenu(slot.index, $event)">
                                <span class="np-slot-name" :title="'ID: ' + slot.id">{{ slot.name }}</span>
                                <div class="np-strip-tags">
                                    <span v-if="slot.inherited" class="np-subtle">main colors</span>
                                    <span v-if="isDriven(slot.id)" class="np-subtle np-icon-button" title="This color is worked out by a formula. Click to edit it" @click.stop="editFormula(slot.id)">formula</span>
                                    <i v-if="motion(slot.id).problem" class="material-icons notranslate icon np-issue-icon" title="This color animation has a problem. See Checks">error</i>
                                    <span v-if="motion(slot.id).animated" class="np-subtle np-icon-button" :title="(anim.scoped ? 'Changes while ' + anim.scopeName + ' plays: ' : 'Animated: ') + motion(slot.id).summary + '. Click to change'" @click.stop="toggleEffect(slot.id)">{{ motion(slot.id).summary }}</span>
                                </div>
                            </div>
                            <div class="np-strip-tones">
                                <ul class="np-swatches" :class="{ 'np-inherited': slot.inherited }">
                                    <li v-for="(tone, index) in slot.ramp" :key="index" class="color" :class="{ selected: isBrush(slot, index), 'np-shade-used': slot.used[index] }" :title="toneTitle(slot, index, tone)" @click="pick(slot.index, index)" @dblclick="edit(slot.index, index)" @contextmenu.prevent.stop="toneMenu(slot.index, index, $event)">
                                        <div class="color_inner" :class="{ 'np-checker': seeThrough(tone) }"><div class="np-fill" :style="fill(tone)"></div></div>
                                    </li>
                                    <li v-if="!slot.blend" class="np-swatch-add" title="Add a shade" @click="addShade(slot.index)"><i class="material-icons notranslate icon">add</i></li>
                                </ul>
                                <template v-if="slot.blend">
                                    <p class="np-subtle">{{ blendNote(slot) }}</p>
                                    <ul class="np-swatches">
                                        <li v-for="(stop, index) in slot.blend.stops" :key="'stop' + index" class="color" :title="stopTitle(slot, index, stop)" @click="editStop(slot.index, index)" @contextmenu.prevent.stop="stopMenu(slot.index, index, $event)">
                                            <div class="color_inner" :class="{ 'np-checker': seeThrough(stop) }"><div class="np-fill" :style="fill(stop)"></div></div>
                                        </li>
                                        <li v-if="slot.blend.stops.length < slot.blend.tones" class="np-swatch-add" title="Add a stop" @click="addStop(slot.index)"><i class="material-icons notranslate icon">add</i></li>
                                    </ul>
                                </template>
                                <ul v-if="motion(slot.id).animated" class="np-palanim-strip" :title="'Colors at frame ' + anim.frame">
                                    <li v-for="(color, index) in motion(slot.id).swatches" :key="index" :style="{ 'background-color': color }"></li>
                                </ul>
                            </div>
                            <button type="button" class="np-strip-animate" :class="{ 'np-on': anim.selected === slot.id }" :title="animateTitle(slot.id, slot.name)" @click="toggleEffect(slot.id)"><i class="material-icons notranslate icon">animation</i> Animate</button>
                            <i class="material-icons notranslate icon np-icon-button" title="Color options" @click.stop="slotMenu(slot.index, $event)">more_horiz</i>
                        </div>
                        <div v-if="anim.selected === slot.id && anim.detail" :key="slot.id + ':effect'" class="np-palanim-detail np-strip-effect">
                            <p v-if="anim.scoped" class="np-subtle">While <strong>{{ anim.scopeName }}</strong> plays ({{ anim.loopText }}).</p>
                            <p v-else class="np-subtle">Over the loop ({{ anim.loopText }}).<template v-if="!anim.scopeNote"> To change colors in a reaction or one-shot, select it in the Animations panel.</template></p>
                            <p v-if="anim.detail.effectHelp" class="np-subtle">{{ anim.detail.effectHelp }}</p>
                            <div class="np-palanim-buttons">
                                <button type="button" @click="choose(anim.detail.id)"><i class="material-icons notranslate icon">auto_awesome</i> Style...</button>
                                <button type="button" title="Paint the shades of this color in order, for a shimmer or rainbow" @click="sweep(anim.detail.id)"><i class="material-icons notranslate icon">gradient</i> Paint a sweep...</button>
                                <button v-if="anim.detail.kind !== 'none'" type="button" :title="anim.scoped ? 'No change in this animation' : 'Stop animating this color'" @click="stop(anim.detail.id)"><i class="material-icons notranslate icon">block</i> {{ anim.scoped ? 'No change' : 'Stop' }}</button>
                            </div>
                            <template v-if="anim.detail.kind === 'cycle'">
                                <p>{{ anim.detail.cycleText }}</p>
                                <div class="np-palanim-buttons">
                                    <button type="button" :disabled="!anim.detail.canFaster" @click="faster(anim.detail.id)"><i class="material-icons notranslate icon">fast_forward</i> Faster</button>
                                    <button type="button" :disabled="!anim.detail.canSlower" @click="slower(anim.detail.id)"><i class="material-icons notranslate icon">slow_motion_video</i> Slower</button>
                                    <button type="button" @click="direction(anim.detail.id, $event)"><i class="material-icons notranslate icon">swap_horiz</i> {{ anim.detail.modeName }}</button>
                                    <button v-if="!anim.scoped" type="button" title="Find the fastest speed that doesn't flash too fast" @click="safe(anim.detail.id)"><i class="material-icons notranslate icon">health_and_safety</i> Safe speed</button>
                                </div>
                            </template>
                            <template v-if="anim.detail.kind === 'keys'">
                                <div class="np-palanim-timeline">
                                    <div v-for="cell in anim.detail.cells" :key="cell.frame" :class="{ 'np-key': cell.key, 'np-now': cell.now }" :style="{ 'background-color': cell.color }" :title="cell.title" @click="go(cell.frame)" @dblclick="editKey(anim.detail.id, cell.frame)" @contextmenu.prevent.stop="keyMenu(anim.detail.id, cell.frame, $event)"></div>
                                </div>
                                <div class="np-palanim-ruler"><span>0</span><span>frame {{ anim.frame }}</span><span>{{ anim.loop - 1 }}</span></div>
                                <ul class="np-palanim-keys">
                                    <li v-for="key in anim.detail.keys" :key="key.frame" :class="{ 'np-now': key.frame === anim.frame }" :title="key.title" @contextmenu.prevent.stop="keyMenu(anim.detail.id, key.frame, $event)">
                                        <span class="np-palanim-keyframe" @click="go(key.frame)">Frame {{ key.frame }}</span>
                                        <span class="np-subtle np-palanim-ease">{{ key.ease }}</span>
                                        <span v-if="key.base" class="np-subtle">Base</span>
                                        <ul class="np-palanim-strip"><li v-for="(color, index) in key.swatches" :key="index" :style="{ 'background-color': color }"></li></ul>
                                        <i class="material-icons notranslate icon np-icon-button" title="Edit this keyframe" @click="editKey(anim.detail.id, key.frame)">edit</i>
                                        <i v-if="!key.first" class="material-icons notranslate icon np-icon-button" title="Remove this keyframe" @click="removeKey(anim.detail.id, key.frame)">delete</i>
                                    </li>
                                </ul>
                                <div class="np-palanim-buttons">
                                    <button type="button" @click="addKey(anim.detail.id)"><i class="material-icons notranslate icon">add</i> {{ anim.detail.hasKeyHere ? 'Edit keyframe at frame ' + anim.frame : 'Add keyframe at frame ' + anim.frame }}</button>
                                </div>
                                <p class="np-subtle">Double-click a frame to add or edit a keyframe.</p>
                            </template>
                        </div>
                    </template>
                    <div v-if="!ui.slots.length" class="np-panel-empty">
                        <p>No colors yet.</p>
                        <button type="button" @click="addColor()">Add color</button>
                    </div>
                </template>
            </div>
        </div>
    `,
}

function place() {
    if (!view) return
    const element = view.$el as HTMLElement
    const host = stripParts.host
    if (host) {
        if (element.parentElement !== host) host.appendChild(element)
    } else {
        element.remove()
    }
    const bar = view.$refs.bar as HTMLElement | undefined
    const toolbar = stripParts.toolbar
    if (!bar) return
    if (!toolbar) {
        bar.replaceChildren()
        return
    }
    if (toolbar.node.parentElement !== bar) bar.replaceChildren(toolbar.node)
    try {
        toolbar.update?.()
    } catch (error) {
        console.error('[polyplus_nameplate] could not update the colors toolbar', error)
    }
}

function createView(): any {
    const VueCtor = (globalThis as any).Vue
    if (typeof VueCtor !== 'function') {
        console.error('[polyplus_nameplate] Vue is missing, so the color strip cannot be shown')
        return null
    }
    const created = new VueCtor(component)
    created.$mount()
    return created
}

export function registerColorStrip(): () => void {
    const removeStyle = injectStyle(STYLE_ID, STYLE)
    const toggle = stripToggle()
    if (toggle) stripUi.folded = !toggle.value
    view = createView()
    const removers = [onStripParts(place), onFocusSlot(revealSlot)]
    place()
    return () => {
        for (const remove of removers) remove()
        const closing = view
        view = null
        if (closing) {
            const bar = closing.$refs.bar as HTMLElement | undefined
            bar?.replaceChildren()
            ;(closing.$el as HTMLElement).remove()
            closing.$destroy()
        }
        removeStyle()
    }
}

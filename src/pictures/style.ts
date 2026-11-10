import { LAYOUT_CLASS } from '../layout/style'
import { injectStyle } from '../util/style'

const STYLE_ID = 'polyplus_nameplate_pictures_style'

const STYLE = `
body.${LAYOUT_CLASS} #left_bar > .panel_container[panel_id="polyplus_nameplate_pictures"]:not(.folded) { flex-shrink: 0.05; max-height: 50%; }
.np-pictures-host { height: 100%; }
.np-pictures-scroll { height: 100%; overflow-y: auto; overflow-x: hidden; }
.np-pictures-empty { margin: 0; padding: 6px 10px; color: var(--color-subtle_text); }
ul.np-pictures { margin: 0; padding: 0 0 8px; }
ul.np-pictures > li { display: flex; align-items: center; min-height: 52px; padding: 2px 6px 2px 5px; box-sizing: border-box; border-left: 3px solid transparent; list-style: none; cursor: pointer; }
ul.np-pictures > li:hover .np-picture-name { color: var(--color-light); }
ul.np-pictures > li.selected { background-color: var(--color-selected); color: var(--color-light); }
.np-picture-thumb { flex: none; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.np-picture-frame { overflow: hidden; }
.np-picture-frame > img { display: block; max-width: none; image-rendering: pixelated; }
.np-picture-text { flex: 1; min-width: 0; display: flex; flex-direction: column; margin-left: 6px; line-height: 17px; }
.np-picture-text > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-picture-meta { font-size: 0.9em; color: var(--color-subtle_text); }
.np-picture-unused { color: color-mix(in srgb, var(--color-warning, #e0a43a) 55%, var(--color-text)); }
.np-picture-tools { flex: none; display: flex; align-items: center; margin-left: 2px; }
.np-picture-tools > i { width: 22px; height: 22px; font-size: 18px; line-height: 22px; text-align: center; color: var(--color-subtle_text); cursor: pointer; }
.np-picture-tools > i:hover { color: var(--color-light); }
`

let removeElement: (() => void) | null = null

export function usePicturesStyle(): () => void {
    removeElement ??= injectStyle(STYLE_ID, STYLE)
    return () => {
        removeElement?.()
        removeElement = null
    }
}

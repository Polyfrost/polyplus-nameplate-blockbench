export const STYLE_ID = 'polyplus_nameplate_design_style'

export const STYLE = `
#polyplus_nameplate_viewport { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; background-color: var(--color-back); }
#polyplus_nameplate_viewport .np-stage-bar { flex: none; background-color: var(--color-ui); border-bottom: 1px solid var(--color-border); }
#polyplus_nameplate_viewport .np-stage-view { flex: 1; min-height: 0; overflow: auto; display: flex; }
#polyplus_nameplate_viewport .np-stage-canvas { margin: auto; flex: none; image-rendering: pixelated; }
#polyplus_nameplate_viewport .np-stage-hint { position: absolute; left: 10px; bottom: 8px; color: var(--color-subtle_text); pointer-events: none; }
.np-scroll-host { height: 100%; }
.np-scroll { height: 100%; overflow-y: auto; overflow-x: hidden; }
.np-panel-empty, .np-panel-note { margin: 0; padding: 6px 10px; color: var(--color-subtle_text); }
.np-panel-empty p { margin: 0 0 6px; }
.np-empty-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.np-empty-actions button { display: inline-flex; align-items: center; gap: 4px; }
.np-subtle { color: var(--color-subtle_text); }
.np-layer-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px 2px; }
.np-layer-head .np-layer-name { font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-layer-form .form_bar_info, .np-layer-form .dialog_bar[form_type=info] { margin-top: 6px; }
.np-slot { padding: 2px 8px 6px; }
.np-slot-head { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.np-slot-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-icon-button { cursor: pointer; color: var(--color-subtle_text); }
.np-icon-button:hover { color: var(--color-text); }
ul.np-swatches { display: flex; flex-wrap: wrap; gap: 2px; margin: 0; padding: 0; list-style: none; }
ul.np-swatches > li { width: 30px; height: 30px; box-sizing: border-box; padding: 2px; border: 2px solid transparent; cursor: pointer; list-style: none; }
ul.np-swatches > li.selected { border-color: var(--color-accent); }
ul.np-swatches > li > .color_inner { width: 100%; height: 100%; }
ul.np-swatches.np-inherited > li.color { opacity: 0.55; }
ul.np-swatches > li.np-swatch-add { display: flex; align-items: center; justify-content: center; color: var(--color-subtle_text); }
ul.np-swatches > li.np-swatch-add:hover { color: var(--color-text); background-color: var(--color-selected); }
ul.np-issues { margin: 0; padding: 0; }
ul.np-issues > li { display: flex; align-items: flex-start; gap: 6px; padding: 4px 10px; }
ul.np-issues > li.np-clickable { cursor: pointer; }
ul.np-issues > li.np-clickable:hover { background-color: var(--color-selected); }
.np-issue-icon { color: var(--color-close, #e0534f); }
.np-ok { display: flex; align-items: center; gap: 6px; padding: 6px 10px; color: var(--color-subtle_text); }
.np-ok .icon { color: var(--color-confirm, #3fae5c); }
`

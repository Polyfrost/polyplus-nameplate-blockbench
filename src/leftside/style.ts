import { injectStyle } from '../util/style'

const STYLE_ID = 'polyplus_nameplate_left_style'

const STYLE = `
.tool.has_label[toolbar_item^="polyplus_nameplate"] { display: inline-flex; align-items: center; gap: 4px; width: auto; }
.tool.has_label[toolbar_item^="polyplus_nameplate"] > .toolbar_label { float: none; flex: none; margin: 0; padding: 0 0 0 4px; color: var(--color-subtle_text); white-space: nowrap; }
.np-left-host { height: 100%; }
.np-left-scroll { height: 100%; overflow-y: auto; overflow-x: hidden; }
.np-left-empty, .np-left-note { margin: 0; padding: 6px 10px; color: var(--color-subtle_text); }
.np-left-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; }
.np-left-head .icon { flex: none; }
.np-left-head.np-ready .icon { color: var(--color-confirm, #3fae5c); }
.np-left-head.np-blocked .icon { color: var(--color-close, #e0534f); }
ul.np-checks { margin: 0; padding: 0; }
ul.np-checks > li { list-style: none; padding: 4px 10px; }
ul.np-checks > li.np-jump { cursor: pointer; }
ul.np-checks > li.np-jump:hover { background-color: var(--color-selected); }
.np-check-line { display: flex; align-items: flex-start; gap: 6px; }
.np-check-line .icon { flex: none; font-size: 18px; }
.np-check-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
li.np-level-error .np-check-line .icon { color: var(--color-close, #e0534f); }
li.np-level-warning .np-check-line .icon { color: var(--color-warning, #e0a43a); }
li.np-level-note .np-check-line .icon { color: var(--color-subtle_text); }
li.np-level-note .np-check-text { color: var(--color-subtle_text); }
.np-check-buttons { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 0 24px; }
.np-check-buttons button { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.np-check-buttons button .icon { font-size: 16px; }
.np-check-buttons button i.fa { font-size: 13px; }
.np-cost-summary { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; }
.np-cost-summary:hover { background-color: var(--color-selected); }
.np-cost-summary > .np-cost-summary-text { flex: 1; min-width: 0; }
.np-cost-summary.np-ok > .np-cost-state { color: var(--color-confirm, #3fae5c); }
.np-cost-summary.np-near > .np-cost-state { color: var(--color-warning, #e0a43a); }
.np-cost-summary.np-over { color: var(--color-close, #e0534f); }
.np-cost-summary.np-unknown > .np-cost-state { color: var(--color-subtle_text); }
.np-cost-summary > .np-cost-chevron { color: var(--color-subtle_text); }
ul.np-cost { margin: 0; padding: 0; }
ul.np-cost > li { padding: 3px 10px 5px; list-style: none; }
.np-cost-line { display: flex; align-items: center; gap: 6px; }
.np-cost-line .icon { font-size: 18px; color: var(--color-confirm, #3fae5c); }
.np-cost-name { flex: 1; min-width: 0; }
.np-cost-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
.np-meter { height: 4px; margin: 3px 0 0 24px; background-color: var(--color-back); border-radius: 2px; overflow: hidden; }
.np-meter > div { height: 100%; background-color: var(--color-accent); }
.np-cost-note { margin: 2px 0 0 24px; color: var(--color-subtle_text); font-size: 0.92em; }
ul.np-cost > li.np-near .icon { color: var(--color-warning, #e0a43a); }
ul.np-cost > li.np-near .np-meter > div { background-color: var(--color-warning, #e0a43a); }
ul.np-cost > li.np-over .np-cost-line, ul.np-cost > li.np-over .np-cost-note { color: var(--color-close, #e0534f); }
ul.np-cost > li.np-over .icon { color: var(--color-close, #e0534f); }
ul.np-cost > li.np-over .np-meter > div { background-color: var(--color-close, #e0534f); }
ul.np-cost > li.np-unmeasured .icon, ul.np-cost > li.np-unmeasured .np-cost-value { color: var(--color-subtle_text); }
ul.np-cost > li.np-layer { cursor: pointer; }
ul.np-cost > li.np-layer:hover { background-color: var(--color-button); }
ul.np-cost > li.np-info .icon { color: var(--color-subtle_text); }
ul.np-cost > li.np-info .np-meter > div { background-color: var(--color-subtle_text); }
.np-cost-more { display: flex; align-items: center; gap: 2px; margin: 2px 0 0 20px; color: var(--color-subtle_text); font-size: 0.92em; cursor: pointer; }
.np-cost-more .icon { font-size: 16px; }
.np-cost-more:hover { color: var(--color-text); }
ul.np-cost-details { margin: 2px 0 0 24px; padding: 0; }
ul.np-cost-details > li { list-style: none; padding: 1px 4px; }
ul.np-cost-details > li .np-cost-note { margin-left: 0; }
ul.np-cost-details > li.np-layer { cursor: pointer; }
ul.np-cost-details > li.np-layer:hover { background-color: var(--color-button); }
ul.np-cost-details > li.np-over, ul.np-cost-details > li.np-over .np-cost-note { color: var(--color-close, #e0534f); }
.np-try { padding-bottom: 6px; }
.np-try .panel_toolbar_label { margin-top: 8px; }
.np-try .bar.np-tick { display: flex; align-items: center; gap: 6px; padding: 2px 10px; cursor: pointer; }
.np-try .bar.np-tick label { cursor: pointer; }
.np-shots { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 10px; }
.np-shots button { display: inline-flex; align-items: center; gap: 4px; }
.np-try .bar.slider_input_combo { padding: 0 10px; }
`

let removeElement: (() => void) | null = null
let users = 0

export function useLeftStyle(): () => void {
    users++
    removeElement ??= injectStyle(STYLE_ID, STYLE)
    return () => {
        users = Math.max(0, users - 1)
        if (users > 0) return
        removeElement?.()
        removeElement = null
    }
}

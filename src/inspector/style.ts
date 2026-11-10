export const INSPECTOR_STYLE_ID = 'polyplus_nameplate_inspector_style'

export const INSPECTOR_STYLE = `
.np-inspector { padding-bottom: 12px; }
.np-section { border-top: 1px solid var(--color-border); }
.np-section-head { display: flex; align-items: center; gap: 6px; padding: 4px 10px; cursor: pointer; user-select: none; font-weight: bold; }
.np-section-head:hover { background-color: var(--color-selected); }
.np-section-head:focus-visible { outline: 1px solid var(--color-accent); outline-offset: -1px; }
.np-section-head .icon-open-state { width: 12px; text-align: center; color: var(--color-subtle_text); }
.np-section-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-section-body { padding-bottom: 6px; }
.np-section-body .form_bar_info, .np-section-body .dialog_bar[form_type=info] { margin-top: 6px; }
.np-section-pad { padding: 2px 10px 4px; }
.np-flush { margin: 0 0 6px; }
.np-fact { display: flex; gap: 8px; padding: 1px 0; }
.np-fact > span:first-child { flex: none; min-width: 96px; }
.np-fact > span:last-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
ul.np-inspector-list { margin: 0; padding: 0; list-style: none; }
ul.np-inspector-list > li { display: flex; align-items: center; gap: 8px; padding: 3px 10px; cursor: pointer; }
ul.np-inspector-list > li:hover { background-color: var(--color-selected); }
ul.np-inspector-list > li.selected { background-color: var(--color-selected); box-shadow: inset 2px 0 0 var(--color-accent); }
.np-inspector-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.np-inspector-text > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-inspector .np-library-tools { flex: none; display: flex; gap: 2px; }
.np-section-extra .np-flags-panel { border-top: 1px dashed var(--color-border); margin-top: 4px; padding-top: 4px; }
`

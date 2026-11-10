export const NODES_STYLE_ID = 'polyplus_nameplate_nodes_style'

export const NODES_STYLE = `
#polyplus_nameplate_material_editor .dialog_content { margin: 0; padding: 0; max-height: none; overflow: hidden; }
.np-mat-root { display: flex; flex-direction: column; height: max(300px, calc(100vh - 160px)); min-height: 0; }
.np-mat { flex: 1 1 auto; display: flex; min-height: 0; border-top: 1px solid var(--color-border); }
.np-mat-stage { flex: 1 1 auto; position: relative; overflow: hidden; min-width: 0; }
.np-mat-canvas { position: absolute; left: 0; top: 0; right: 0; bottom: 0; overflow: hidden; background-color: var(--color-back); background-image: radial-gradient(var(--color-border) 1px, transparent 1px); background-size: 24px 24px; }
.np-mat-tools { position: absolute; left: 8px; top: 8px; z-index: 3; display: flex; align-items: center; gap: 2px; padding: 2px; background-color: var(--color-ui); border-radius: 5px; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.35); }
.np-mat-tools .tool { float: none; width: 32px; height: 30px; }
.np-mat-tools .tool i { margin: 3px auto; }
.np-mat-tools .tool:hover { color: var(--color-light); }
.np-mat-add-button { display: inline-flex; align-items: center; gap: 2px; min-width: 0; height: 30px; padding: 0 12px 0 6px; margin-right: 4px; border-radius: 4px; background: var(--color-accent); color: var(--color-accent_text); }
.np-mat-add-button > i { margin-right: 0; vertical-align: middle; }
.np-mat-add-button:hover { background: var(--color-accent); filter: brightness(1.12); }
.np-mat-canvas-hint { position: absolute; left: 10px; right: 190px; bottom: 8px; z-index: 1; color: var(--color-subtle_text); font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.np-mat-canvas-empty { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); width: min(320px, 80%); z-index: 1; display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; text-align: center; background-color: var(--color-ui); border: 1px dashed var(--color-border); border-radius: 4px; color: var(--color-subtle_text); pointer-events: none; }
.np-mat-canvas-empty b { color: var(--color-text); }
.np-minimap-host { position: absolute; right: 8px; bottom: 8px; z-index: 2; line-height: 0; }
.np-minimap { display: block; border: 1px solid var(--color-border); border-radius: 4px; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.35); cursor: pointer; opacity: 0.94; }
.np-minimap.np-minimap-hidden { display: none; }
.np-add { position: absolute; z-index: 5; width: 340px; display: flex; flex-direction: column; overflow: hidden; background-color: var(--color-ui); color: var(--color-text); border-radius: 5px; box-shadow: 0 0 5px rgba(0, 0, 0, 0.5); }
.np-add-search { flex: none; display: flex; align-items: center; height: 38px; background-color: var(--color-back); border-bottom: 1px solid var(--color-border); }
.np-add-search .icon { flex: none; width: 34px; text-align: center; color: var(--color-subtle_text); }
.np-add-search input { flex: 1 1 auto; min-width: 0; height: 100%; padding: 4px 6px; border: none; background-color: transparent; color: var(--color-text); font-size: 1.05em; }
.np-add-search .np-add-close { cursor: pointer; }
.np-add-search .np-add-close:hover { color: var(--color-light); }
.np-add-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0; padding: 0 0 4px; list-style: none; background-color: var(--color-bright_ui); color: var(--color-bright_ui_text); }
.np-add-group { display: flex; align-items: center; gap: 6px; padding: 8px 10px 3px; font-weight: bold; }
.np-add-group .icon { flex: none; font-size: 16px; opacity: 0.7; }
.np-add-group label { flex: 1 1 auto; min-width: 0; font-weight: normal; font-size: 0.85em; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.np-add-item { display: flex; flex-direction: column; padding: 3px 10px 4px 32px; cursor: pointer; }
.np-add-item .np-add-name { white-space: nowrap; }
.np-add-item .np-add-help { font-size: 0.85em; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-add-item.selected { background-color: var(--color-accent); color: var(--color-accent_text); }
.np-add-item.disabled { opacity: 0.45; cursor: default; }
.np-add-empty { padding: 10px; opacity: 0.8; }
.np-add-foot { flex: none; padding: 4px 10px; border-top: 1px solid var(--color-border); color: var(--color-subtle_text); font-size: 0.85em; }
.np-tour { position: absolute; z-index: 4; top: 48px; left: 50%; transform: translateX(-50%); width: min(380px, calc(100% - 24px)); box-sizing: border-box; padding: 10px 12px; background-color: var(--color-ui); border: 1px solid var(--color-accent); border-radius: 5px; box-shadow: 0 0 12px rgba(0, 0, 0, 0.5); }
.np-tour-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.np-tour-head span { flex: none; color: var(--color-subtle_text); font-size: 0.9em; }
.np-tour p { margin: 6px 0 10px; }
.np-tour-buttons { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.np-tour-buttons button { min-width: 72px; height: 28px; }
.np-tour-buttons button.minor { min-width: 0; padding: 0 4px; margin-right: auto; }
.np-tour-buttons button.np-tour-next { background: var(--color-accent); color: var(--color-accent_text); }
.np-tour-focus { outline: 2px solid var(--color-accent); outline-offset: -2px; }
.np-mat-add-button.np-tour-focus { outline-offset: 2px; }
.np-mat-side { flex: none; width: 300px; display: flex; flex-direction: column; background-color: var(--color-ui); border-left: 1px solid var(--color-border); min-height: 0; }
.np-mat-side-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.np-mat-preview-head { flex: none; padding: 8px 10px 4px; font-weight: bold; }
.np-mat-preview-head span { font-weight: normal; color: var(--color-subtle_text); font-size: 0.9em; }
.np-mat-preview { flex: none; padding: 0 10px 8px; border-bottom: 1px solid var(--color-border); }
.np-mat-preview-canvas { display: block; max-width: 100%; margin: 0 auto 4px; image-rendering: pixelated; border: 1px solid var(--color-border); }
.np-mat-preview-bar { display: flex; align-items: center; gap: 6px; }
.np-mat-preview-bar button { display: inline-flex; align-items: center; justify-content: center; min-width: 0; padding: 0 6px; height: 24px; }
.np-mat-preview-bar button .icon { font-size: 18px; }
.np-mat-preview-caption { color: var(--color-subtle_text); }
.np-mat-side h3 { margin: 0; padding: 8px 10px 4px; font-size: 1em; display: flex; align-items: center; gap: 6px; }
.np-mat-side h3 .np-mat-id { color: var(--color-subtle_text); font-weight: normal; font-size: 0.9em; }
.np-mat-side .form { padding: 0 6px; }
.np-mat-side .dialog_bar { margin-bottom: 4px; }
.np-mat-help { margin: 0; padding: 0 10px 6px; color: var(--color-subtle_text); }
.np-mat-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 10px 8px; }
.np-mat-actions button { display: inline-flex; align-items: center; gap: 4px; }
.np-mat-params { margin: 0; padding: 0 10px 8px 28px; }
.np-mat-problems { flex: none; max-height: 35%; overflow-y: auto; border-top: 1px solid var(--color-border); }
.np-mat-problems ul { margin: 0; padding: 0; list-style: none; }
.np-mat-problems li { display: flex; align-items: flex-start; gap: 6px; padding: 4px 10px; }
.np-mat-problems li.np-clickable { cursor: pointer; }
.np-mat-problems li.np-clickable:hover { background-color: var(--color-selected); }
.np-mat-problems .icon { font-size: 18px; flex: none; }
.np-mat-problems .np-error { color: var(--color-close, #e0534f); }
.np-mat-problems .np-hint { color: var(--color-subtle_text); }
.np-mat-problems .np-ok { color: var(--color-confirm, #3fae5c); }
.np-mat-status { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 4px 16px; padding: 6px 10px; border-top: 1px solid var(--color-border); background-color: var(--color-ui); }
.np-mat-meter { display: flex; align-items: center; gap: 6px; }
.np-mat-bar { width: 120px; height: 6px; border-radius: 3px; background-color: var(--color-back); overflow: hidden; }
.np-mat-bar > div { height: 100%; background-color: var(--color-accent); }
.np-mat-meter.over .np-mat-bar > div { background-color: var(--color-close, #e0534f); }
.np-mat-meter.over { color: var(--color-close, #e0534f); }
.np-mat-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin-left: auto; color: var(--color-subtle_text); font-size: 0.9em; cursor: help; }
.np-mat-legend > span { display: inline-flex; align-items: center; gap: 4px; }
.np-socket.np-legend-dot { display: inline-block; width: 10px; height: 10px; border-width: 1px; cursor: help; }
.np-socket.np-legend-dot:hover { transform: none; }
.np-node { width: 160px; box-sizing: border-box; background-color: var(--color-ui); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25); user-select: none; }
.np-node.selected { border-color: var(--color-accent); box-shadow: 0 0 0 1px var(--color-accent); }
.np-node.np-node-bad { border-color: var(--color-close, #e0534f); }
.np-node.np-node-unused { opacity: 0.6; }
.np-node-title { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background-color: var(--color-dark); border-bottom: 1px solid var(--color-border); border-radius: 4px 4px 0 0; cursor: grab; }
.np-node-title .icon { font-size: 16px; color: var(--color-subtle_text); }
.np-node-title .np-node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
.np-node-row { position: relative; display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 10px; }
.np-node-row.np-node-out { justify-content: flex-end; }
.np-node-row .np-node-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-node-row.np-node-out .np-node-label { color: var(--color-subtle_text); }
.np-node-row .np-node-label.np-required { color: var(--color-close, #e0534f); }
.np-node-value { flex: 0 1 auto; min-width: 0; max-width: 76px; margin-left: auto; padding: 0 4px; border-radius: 3px; background-color: var(--color-back); font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-node-value.np-node-default { background-color: transparent; color: var(--color-subtle_text); font-style: italic; }
.np-node-value.np-node-editable { cursor: pointer; }
.np-node-value.np-node-editable:hover { box-shadow: 0 0 0 1px var(--color-accent); }
.np-node-summary { height: 18px; line-height: 18px; padding: 0 8px; color: var(--color-subtle_text); font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.np-node-summary:hover { color: var(--color-text); }
.np-node-note { display: flex; align-items: center; gap: 4px; height: 18px; padding: 0 8px; color: var(--color-close, #e0534f); font-size: 0.85em; }
.np-node-note .icon { flex: none; font-size: 14px; }
.np-node-note span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-node-note.np-hint { color: var(--color-subtle_text); }
.np-node-pad { height: 4px; }
.np-node-in-socket { position: absolute; left: -7px; top: calc(50% - 6px); line-height: 0; }
.np-node-out-socket { position: absolute; right: -7px; top: calc(50% - 6px); line-height: 0; }
.np-socket { width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--color-ui); background-color: var(--color-subtle_text); cursor: crosshair; }
.np-socket:hover { transform: scale(1.3); }
.np-socket-float { background-color: #a0a8b8; }
.np-socket-vec2 { background-color: #5aa0e6; }
.np-socket-vec3 { background-color: #8a6ee6; }
.np-socket-vec4, .np-socket-color, .np-socket-surface { background-color: #e6b84a; }
.np-socket-slot { background-color: #e67a4a; }
.np-socket-number { background: conic-gradient(#a0a8b8 0 25%, #5aa0e6 0 50%, #e6b84a 0 75%, #e67a4a 0); }
.np-socket-any, .np-socket-source { background-color: var(--color-text); border-radius: 2px; }
.np-connection { overflow: visible !important; position: absolute; pointer-events: none; width: 9999px; height: 9999px; }
.np-connection path { fill: none; stroke-width: 3px; stroke: var(--color-subtle_text); pointer-events: auto; }
.np-connection path.np-link-hit { stroke: transparent; stroke-width: 14px; cursor: context-menu; }
.np-connection path.np-link-hit:hover + path { stroke-width: 5px; }
.np-connection path.np-link-vec2 { stroke: #5aa0e6; }
.np-connection path.np-link-vec3 { stroke: #8a6ee6; }
.np-connection path.np-link-vec4 { stroke: #e6b84a; }
.np-connection path.np-link-slot { stroke: #e67a4a; }
.np-connection path.np-link-source { stroke-dasharray: 6 4; }
`

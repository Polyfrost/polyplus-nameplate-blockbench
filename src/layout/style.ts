export const LAYOUT_STYLE_ID = 'polyplus_nameplate_layout_style'
export const LAYOUT_CLASS = 'np-layout'

const OWN = '.panel_container[panel_id^="polyplus_nameplate"]'
const OUTLINER = '#right_bar > .panel_container[panel_id="outliner"]'
const INSPECTOR = '#right_bar > .panel_container[panel_id="polyplus_nameplate_inspector"]'
const PAINT = '#left_bar > .panel_container[panel_id="uv"]:not(.folded)'
const TRY_BESIDE_PAINT = '#left_bar:has(> .panel_container[panel_id="uv"]:not(.folded):not(.hidden)) > .panel_container[panel_id="polyplus_nameplate_try"]:not(.folded)'

export const LAYOUT_STYLE = `
body.${LAYOUT_CLASS} #left_bar, body.${LAYOUT_CLASS} #right_bar { min-height: 0; overflow-y: clip; overflow-x: visible; }
body.${LAYOUT_CLASS} .sidebar > ${OWN}:not(.folded):not(.grow) { flex-shrink: 1; min-height: 64px; }
body.${LAYOUT_CLASS} .sidebar > ${OWN} > .panel { min-height: 0; overflow: hidden; }
body.${LAYOUT_CLASS} .sidebar > ${OWN}:not(.grow) > .panel { flex: 1 1 auto; }
body.${LAYOUT_CLASS} .sidebar > ${OWN} > .panel > .panel_vue_wrapper { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
body.${LAYOUT_CLASS} .sidebar > ${OWN} .panel_vue_wrapper > .np-left-host,
body.${LAYOUT_CLASS} .sidebar > ${OWN} .panel_vue_wrapper > .np-scroll-host { flex: 1 1 auto; min-height: 0; height: auto; display: flex; flex-direction: column; }
body.${LAYOUT_CLASS} .sidebar > ${OWN} .np-left-host > .np-left-scroll,
body.${LAYOUT_CLASS} .sidebar > ${OWN} .np-scroll-host > .np-scroll { flex: 1 1 auto; min-height: 0; height: auto; }
body.${LAYOUT_CLASS} ${OUTLINER}:not(.folded) { flex: 0 1 auto; height: auto !important; min-height: min(240px, 45%); max-height: 62%; }
body.${LAYOUT_CLASS} ${OUTLINER} > .panel { flex: 1 1 auto; height: auto; min-height: 0; }
body.${LAYOUT_CLASS} ${OUTLINER} > .panel > .panel_vue_wrapper { flex: 1 1 auto; min-height: 0; }
body.${LAYOUT_CLASS} ${OUTLINER} #cubes_list { flex: 1 1 auto; min-height: 0; }
body.${LAYOUT_CLASS} ${OUTLINER} #cubes_list > li:last-child { margin-bottom: 36px; }
body.${LAYOUT_CLASS} #right_bar:has(> .panel_container[panel_id="polyplus_nameplate_inspector"].folded) > .panel_container[panel_id="outliner"]:not(.folded),
body.${LAYOUT_CLASS} #right_bar:not(:has(> .panel_container[panel_id="polyplus_nameplate_inspector"]:not(.hidden))) > .panel_container[panel_id="outliner"]:not(.folded) { flex-grow: 1; max-height: none; }
body.${LAYOUT_CLASS} ${INSPECTOR}:not(.folded) { flex: 1 1 0; height: auto !important; min-height: 160px; }
body.${LAYOUT_CLASS} ${PAINT} { flex-shrink: 1000; min-height: 220px; }
body.${LAYOUT_CLASS} ${PAINT} > .panel { flex: 1 1 auto; min-height: 0; overflow: hidden; }
body.${LAYOUT_CLASS} ${PAINT} .uv_layer_limbo_options { position: sticky; bottom: 0; z-index: 5; background: var(--color-back); }
body.${LAYOUT_CLASS} ${TRY_BESIDE_PAINT} { flex: 1 1 150px; min-height: 150px; }
body.${LAYOUT_CLASS} ${OUTLINER} > .panel_sidebar_resize_handle,
body.${LAYOUT_CLASS} ${INSPECTOR} > .panel_sidebar_resize_handle { display: none; }
.tool[toolbar_item^="polyplus_nameplate"]:not(:hover) > .tooltip { display: none; }
.tool[toolbar_item^="polyplus_nameplate"] > .tooltip > .tooltip_description { white-space: normal; width: max-content; max-width: 260px; }
`

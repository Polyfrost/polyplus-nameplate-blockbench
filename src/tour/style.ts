export const TOUR_STYLE_ID = 'polyplus_nameplate_tour_style'

export const TOUR_STYLE = `
.np-ntour-hole { position: fixed; z-index: 19; left: 50%; top: 50%; width: 0; height: 0; border-radius: 6px; pointer-events: none; box-shadow: 0 0 0 200vmax color-mix(in srgb, var(--color-dark) 55%, transparent); }
.np-ntour-ring { position: fixed; z-index: 24; left: 50%; top: 50%; width: 0; height: 0; box-sizing: border-box; border-radius: 6px; pointer-events: none; opacity: 0; box-shadow: 0 0 0 2px var(--color-accent), 0 0 0 6px color-mix(in srgb, var(--color-accent) 22%, transparent); transition: opacity 180ms ease; }
.np-ntour-ring::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: 0 0 16px 4px color-mix(in srgb, var(--color-accent) 45%, transparent); opacity: 0.35; animation: np-ntour-breathe 2.6s ease-in-out infinite; }
.np-ntour-ring.np-ntour-on { opacity: 1; }
.np-ntour-hole.np-ntour-moving { transition: left 260ms cubic-bezier(0.2, 0.7, 0.2, 1), top 260ms cubic-bezier(0.2, 0.7, 0.2, 1), width 260ms cubic-bezier(0.2, 0.7, 0.2, 1), height 260ms cubic-bezier(0.2, 0.7, 0.2, 1); }
.np-ntour-ring.np-ntour-moving { transition: opacity 180ms ease, left 260ms cubic-bezier(0.2, 0.7, 0.2, 1), top 260ms cubic-bezier(0.2, 0.7, 0.2, 1), width 260ms cubic-bezier(0.2, 0.7, 0.2, 1), height 260ms cubic-bezier(0.2, 0.7, 0.2, 1); }
.np-ntour-card { position: fixed; z-index: 25; left: 0; top: 0; width: 340px; max-width: calc(100vw - 16px); box-sizing: border-box; display: flex; flex-direction: column; background-color: var(--color-ui); color: var(--color-text); border-radius: 6px; box-shadow: 0 0 20px rgba(0, 0, 0, 0.56); font-size: 15px; line-height: 1.5; pointer-events: auto; cursor: default; }
.np-ntour-card.np-ntour-moving { transition: left 260ms cubic-bezier(0.2, 0.7, 0.2, 1), top 260ms cubic-bezier(0.2, 0.7, 0.2, 1); }
.np-ntour-card.np-ntour-hidden { visibility: hidden; }
.np-ntour-card.np-ntour-under, .np-ntour-ring.np-ntour-under { z-index: 19; }
.np-ntour-card.np-ntour-enter { animation: np-ntour-in 180ms ease-out; }
.np-ntour-card.np-ntour-offer { z-index: 19; left: 50%; top: 45%; translate: -50% -50%; width: 360px; }
body.theme_borders .np-ntour-card { border: 1px solid var(--color-border); }
.np-ntour-head { position: relative; display: flex; align-items: center; gap: 6px; height: 33px; flex: none; padding-left: 12px; background-color: var(--color-elevated, var(--color-back)); border-radius: 6px 6px 0 0; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12); }
body.theme_borders .np-ntour-head { border-bottom: 1px solid var(--color-border); }
.np-ntour-head > .icon { flex: none; font-size: 18px; color: var(--color-accent); }
.np-ntour-chapter { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-subtle_text); font-size: 14px; }
.np-ntour-close { flex: none; width: 33px; height: 33px; display: flex; align-items: center; justify-content: center; border-radius: 0 6px 0 0; cursor: pointer; color: var(--color-text); }
.np-ntour-close:hover { color: var(--color-accent_text); background-color: var(--color-close); }
.np-ntour-track { height: 2px; flex: none; background-color: var(--color-back); }
.np-ntour-track > div { height: 100%; background-color: var(--color-accent); transition: width 260ms ease; }
.np-ntour-main { padding: 12px 16px 2px; transition: opacity 120ms ease; }
.np-ntour-main.np-ntour-swap { animation: np-ntour-fade 180ms ease-out; }
.np-ntour-card.np-ntour-busy .np-ntour-main { opacity: 0.55; }
.np-ntour-title { font-size: 1.12em; line-height: 1.4; color: var(--color-light); overflow-wrap: anywhere; }
.np-ntour-body p { margin: 6px 0 0; overflow-wrap: anywhere; }
.np-ntour-task { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0 4px; padding: 8px 10px; background-color: var(--color-back); border: 1px solid var(--color-border); border-left: 3px solid var(--color-accent); border-radius: 5px; transition: border-color 200ms ease; }
.np-ntour-task > .icon { flex: none; font-size: 20px; color: var(--color-accent); transition: color 200ms ease; }
.np-ntour-task-lines { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.np-ntour-done-text { display: none; color: var(--color-subtle_text); font-size: 0.93em; }
.np-ntour-task.np-ntour-done { border-left-color: color-mix(in srgb, var(--color-confirm) 60%, var(--color-text)); }
.np-ntour-task.np-ntour-done > .icon { color: color-mix(in srgb, var(--color-confirm) 60%, var(--color-text)); animation: np-ntour-pop 260ms ease-out; }
.np-ntour-task.np-ntour-done .np-ntour-done-text { display: block; }
.np-ntour-foot { display: flex; align-items: center; gap: 6px; padding: 12px 16px; }
.np-ntour-progress { margin-right: auto; color: var(--color-subtle_text); font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.np-ntour-foot button { min-width: 0; height: 30px; padding: 0 14px; }
.np-ntour-foot button.np-ntour-next { min-width: 84px; }
.np-ntour-foot button:focus:not(:focus-visible) { text-decoration: none; }
.np-ntour-foot button.np-ntour-quiet { background: transparent; box-shadow: none; color: var(--color-subtle_text); }
.np-ntour-foot button.np-ntour-quiet:hover { background: var(--color-button); color: var(--color-text); }
.np-ntour-foot button.np-ntour-ready { background: var(--color-accent); color: var(--color-accent_text); }
.np-ntour-foot button.np-ntour-gone { visibility: hidden; }
.np-ntour-hint { margin: 8px 0 0; color: var(--color-subtle_text); font-size: 13px; }
ul.np-ntour-list { margin: 0; padding: 0; list-style: none; }
ul.np-ntour-list > li { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 5px; cursor: pointer; list-style: none; }
ul.np-ntour-list > li:hover, ul.np-ntour-list > li:focus-visible { background-color: var(--color-selected); outline: none; }
ul.np-ntour-list > li > .icon { flex: none; color: var(--color-accent); }
.np-ntour-num { flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background-color: var(--color-back); color: var(--color-subtle_text); font-size: 13px; font-variant-numeric: tabular-nums; }
.np-ntour-row-text { flex: 1; min-width: 0; line-height: 1.35; }
.np-ntour-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-ntour-row-sub { color: var(--color-subtle_text); font-size: 0.85em; }
ul.np-ntour-list > li.np-ntour-sep { height: 1px; padding: 0; margin: 4px 10px; border-radius: 0; background-color: var(--color-border); cursor: default; }
.np-ntour-note { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 10px; padding: 8px 10px; background-color: var(--color-back); border-radius: 5px; color: var(--color-subtle_text); }
.np-ntour-note > .icon { flex: none; font-size: 20px; }
.np-ntour-note button { margin-top: 6px; min-width: 0; height: 30px; display: inline-flex; align-items: center; }
@keyframes np-ntour-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes np-ntour-fade { from { opacity: 0.2; } to { opacity: 1; } }
@keyframes np-ntour-pop { 0% { transform: scale(0.6); } 70% { transform: scale(1.12); } 100% { transform: scale(1); } }
@keyframes np-ntour-breathe { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) {
    .np-ntour-hole, .np-ntour-ring, .np-ntour-ring::after, .np-ntour-card, .np-ntour-card * { transition: none !important; animation: none !important; }
}
`

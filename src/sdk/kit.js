// The look kit (platform/plugins-sdk.md "Looking native"): the console's design conventions as one stylesheet, given to
// every extension part (inside its Shadow DOM, and in the workshop preview), so plain HTML already looks like Life
// Console and the lc-* classes cover the common pieces. It uses only the console's colour tokens (var(--accent)…),
// so light and dark themes follow automatically. Keep it in step with src/styles.css and docs/DESIGN.md.

/** Plain elements inside a part look native without any classes (scoped to the part's shadow root). */
export const KIT_BASE = `
:host { display: block; color: var(--text); font: 13px/1.5 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
* { box-sizing: border-box; }
h1, h2, h3, h4 { margin: 0 0 6px; line-height: 1.25; }
h1 { font-size: 20px; } h2 { font-size: 16px; } h3 { font-size: 14px; } h4 { font-size: 12px; }
p { margin: 0 0 6px; }
a { color: var(--accent); }
button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 2px; background: transparent; color: var(--text); font: 500 12px/1 'JetBrains Mono', monospace; cursor: pointer; white-space: nowrap; }
button:hover { background: var(--surface-2); }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
input, select, textarea { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; font: inherit; }
table { border-collapse: collapse; width: 100%; }
th { text-align: left; font: 600 10px/1.4 'JetBrains Mono', monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: 4px 8px; border-bottom: 1px solid var(--border); }
td { padding: 6px 8px; border-bottom: 1px solid var(--border); }
code, kbd { font: 12px 'JetBrains Mono', monospace; }
progress { accent-color: var(--accent); }
`

/** lc-* classes: the console's building blocks. Safe to add to the page itself too (prefixed, so they collide with nothing). */
export const KIT_CLASSES = `
.lc-card { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 10px 12px; }
.lc-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; display: flex; flex-direction: column; }
.lc-panel-h { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); min-height: 40px; font: 600 13px/18px 'JetBrains Mono', monospace; letter-spacing: .02em; text-transform: uppercase; }
.lc-panel-b { padding: 12px; }
.lc-label { font: 600 10px/1.4 'JetBrains Mono', monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.lc-big { font: 700 28px/1.1 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
.lc-num, .lc-mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
.lc-muted { color: var(--muted); } .lc-small { font-size: 11px; line-height: 14px; }
.lc-ok { color: var(--accent); } .lc-warn { color: var(--warn); } .lc-danger { color: var(--danger); } .lc-info { color: var(--info); }
.lc-row { display: flex; align-items: center; gap: 8px; } .lc-col { display: flex; flex-direction: column; gap: 8px; }
.lc-wrap { flex-wrap: wrap; } .lc-grow { flex: 1; min-width: 0; } .lc-spacer { flex: 1; }
.lc-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 2px; background: transparent; color: var(--text); font: 500 12px/1 'JetBrains Mono', monospace; cursor: pointer; white-space: nowrap; text-decoration: none; }
.lc-btn:hover { background: var(--surface-2); }
.lc-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent, #0e1116); font-weight: 700; }
.lc-btn.sm { height: 22px; padding: 0 6px; font-size: 11px; }
.lc-btn.danger:hover { color: var(--danger); border-color: var(--danger); }
.lc-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 1px solid var(--border); border-radius: 2px; font: 500 11px/18px 'JetBrains Mono', monospace; color: var(--muted); }
.lc-chip.ok { color: var(--accent); border-color: var(--accent); } .lc-chip.warn { color: var(--warn); border-color: var(--warn); } .lc-chip.danger { color: var(--danger); border-color: var(--danger); }
.lc-list { list-style: none; margin: 0; padding: 0; }
.lc-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
.lc-item:last-child { border-bottom: 0; }
.lc-bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.lc-bar > i { display: block; height: 100%; background: var(--accent); }
.lc-empty { padding: 12px; border: 1px dashed var(--border); border-radius: 4px; color: var(--muted); }
.lc-icon { font-family: 'Material Symbols Outlined'; font-weight: 400; font-style: normal; font-size: 18px; line-height: 1; display: inline-block; white-space: nowrap; font-feature-settings: 'liga'; user-select: none; }
.lc-icon.sm { font-size: 15px; }
`

export const KIT = KIT_BASE + KIT_CLASSES

/** The classes, for the workshop prompt and the docs. */
export const KIT_GUIDE = `- Plain HTML already looks native: headings, p, a, button, input, select, textarea, table, progress.
- .lc-card (a bordered box: use one per Today card), .lc-panel + .lc-panel-h + .lc-panel-b (a titled panel, for pages)
- .lc-label (small uppercase caption), .lc-big (a large number readout), .lc-num / .lc-mono (numbers, times, IDs)
- .lc-row, .lc-col, .lc-wrap, .lc-grow, .lc-spacer (layout)
- .lc-btn, .lc-btn.primary (one per card at most), .lc-btn.sm, .lc-btn.danger
- .lc-chip (+ .ok .warn .danger), .lc-list + .lc-item (rows), .lc-bar > i[style="width:40%"] (progress)
- .lc-muted, .lc-small, .lc-ok, .lc-warn, .lc-danger, .lc-info, .lc-empty (an empty state)
- <span class="lc-icon">water_drop</span>: Material Symbols icons by name
- Colours only from the theme: var(--bg) var(--surface) var(--surface-2) var(--border) var(--text) var(--muted)
  var(--accent) var(--info) var(--warn) var(--danger). Never hard-code colours or fonts: light and dark themes must both work.`

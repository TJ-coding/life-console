// The prompt the workshop hands to an AI ("copy prompt"): everything it needs to write a Life Console plugin that
// works and harmonises, and nothing about the person's real data. Pure JS. Keep it in step with platform/plugins-sdk.md,
// platform/plugins-vocabulary.md and platform/plugins-the-life-console-way.md.
import { CORE_TYPES, COMMON_TYPES, TRAITS, LINKS, CORE_TAGS, CORE_EVENTS } from './vocabulary.js'
import { KIT_GUIDE } from './kit.js'

export const STARTER = `// A Life Console extension: one file, default export = its manifest.
export default {
  sdk: 1,
  title: 'Water',
  icon: 'water_drop',
  description: 'Count glasses of water on Today.',
  types: [
    { type: 'water.Glass', kindOf: 'core.LogEntry', traits: ['titled', 'happened'] },
  ],
  says: { internet: [] },
  slots: {
    'today.card': {
      mount(el, lc, { date }) {
        const draw = () => {
          const n = lc.data.list('water.Glass', { from: date, to: date }).length
          el.innerHTML = \`<div class="lc-card lc-row">
            <span class="lc-icon" aria-hidden="true">water_drop</span>
            <div class="lc-grow"><div class="lc-label">Water</div><span class="lc-big">\${n}</span> <span class="lc-muted">/ 8 glasses</span></div>
            <button class="lc-btn" aria-label="Add a glass of water">+1</button>
          </div>\`
          el.querySelector('button').onclick = () => { lc.data.create('water.Glass', { title: 'Glass of water', at: new Date().toISOString() }); draw() }
        }
        draw()
        return lc.on('record.changed', draw)
      },
    },
  },
}
`

const list = (o) => Object.entries(o).map(([k, v]) => `- ${k}: ${v.label ?? v.desc ?? v}${v.kindOf ? ` (kind of ${v.kindOf})` : ''}${v.traits ? ` [${v.traits.join(', ')}]` : ''}`).join('\n')

export function workshopPrompt(description, currentCode = '') {
  return `You are writing an extension for Life Console, an open-source planner. Reply with ONE JavaScript file and nothing else (no explanation, no markdown fences).

What the extension should do:
${description || '(describe it here)'}

## The files
- index.js is an ES module whose default export is the manifest. Small extensions are just index.js; bigger ones split
  into more files that import each other with relative paths (import { layout } from './layout.js').
- Libraries: only the curated ones the app serves (import * as d3 from 'lc:d3' for d3 v7: scales, shapes, force
  layouts, hierarchies). Nothing from other sites, no eval, no minified code.
- Fields: sdk: 1, title, icon (a Material Symbols name), description,
  types: [{ type: '<name>.Thing', kindOf, traits }], tags: [{ id: '<name>.tag', label, parent? }],
  links: [{ id: '<name>.link', kindOf, desc }], events: ['<name>.happened'], sameAs: [{ from, to }],
  pages: [{ title, icon?, mount(el, lc, { params, query }) }], slots: { '<slot>': { mount(el, lc, data) } },
  commands: [{ label, run(lc) }], chords: ['h'], settings: { mount(el, lc) }, styles: 'css', start(lc),
  says: { internet: ['host'], connections: ['name'] } (say every site you contact).
- mount() draws into el with plain DOM (any framework you bundle is fine) and may return a cleanup function.
  Parts render in a Shadow DOM that already has the console's look kit (see "Look and feel").
- Slots: today.card ({ date }), todo.panel ({ todo }), week.strip, strategy.plan ({ plan }), settings.section.

## lc (the only way to touch data)
lc.data.list(type, { where, linkedTo, from, to, limit }) · lc.data.get(ref) · lc.data.create(type, fields)
lc.data.update(ref, patch) (on core records only your own fields: { x: { <namespace>: {...} } })
lc.data.upsert(type, { source, externalId }, fields) · lc.data.delete(ref) · lc.data.relate(from, link, to) · lc.data.links(ref)
Records come back with .ref ('<type>/<id>'). lc.on(event, fn) returns an unsubscribe function. lc.emit(event, payload) for your own events.
lc.ui.toast(text) · lc.ui.navigate('/#/…') · lc.connections.request(name, { method, url, body }) (the server adds the saved key).
Never read localStorage, /api/state or the app's internals.

## Vocabulary (use before you make; extend before you fork)
Core types:
${list(CORE_TYPES)}
Common types:
${list(COMMON_TYPES)}
Traits: ${Object.keys(TRAITS).join(', ')}
Links: ${Object.keys(LINKS).join(', ')} (your own links must be a kind of one of these)
Tag trees: ${Object.keys(CORE_TAGS).filter((k) => !CORE_TAGS[k].parent).join(', ')}
Events: ${CORE_EVENTS.join(', ')}
Your own terms live in your namespace (the extension's name), e.g. 'water.Glass'. Anything with a time belongs on the planner:
create a core.Todo, core.TimeBlock, core.Deadline or core.Reminder ({ title, at: 'YYYY-MM-DDTHH:MM', repeat?: 'daily'|'weekdays'|'weekly:mon,thu'|'every:3', open: '/#/m/<name>' }).

## Look and feel (make it look like the rest of Life Console)
Life Console is a calm, dark "operations console": each screen answers a few questions, the most important
one largest and first. Follow the same rules:
- One idea per card. The key number big (.lc-big), its label small (.lc-label), everything else muted.
- Show exceptions, not status: colour only when something needs action (--warn amber, --danger red);
  things that are fine stay muted. --accent is for the one main action or a "done/ok" state.
- Numbers, times and IDs in monospace (.lc-num). Icons are Material Symbols names.
- No buttons or labels for their own sake: one primary action at most, details on demand.
- No empty space: a Today card is one compact row or block, never a tall empty box.
- Works at phone width (390px) and in light and dark themes. Keyboard reachable; label icon-only buttons.
The look kit (already loaded in every part; no setup):
${KIT_GUIDE}

## Example
${STARTER}${currentCode ? `\n## The current version to change\n${currentCode}` : ''}`
}

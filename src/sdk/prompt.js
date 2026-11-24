// The prompt the workshop hands to an AI ("copy prompt"): everything it needs to write a Life Console plugin that
// works and harmonises, and nothing about the person's real data. Pure JS. Keep it in step with platform/plugins-sdk.md,
// platform/plugins-vocabulary.md and platform/plugins-the-life-console-way.md.
import { CORE_TYPES, COMMON_TYPES, TRAITS, LINKS, CORE_TAGS, CORE_EVENTS } from './vocabulary.js'

export const STARTER = `// A Life Console plugin: one file, default export = its manifest.
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
          el.innerHTML = \`<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;border:1px solid var(--border);border-radius:8px">
            <b>Water</b><span>\${n} / 8 glasses</span><button>+1</button></div>\`
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
  return `You are writing a plugin for Life Console, an open-source planner. Reply with ONE JavaScript file and nothing else (no explanation, no markdown fences).

What the plugin should do:
${description || '(describe it here)'}

## The file
- An ES module whose default export is the manifest. No imports from other sites, no eval, no minified code.
- Fields: sdk: 1, title, icon (a Material Symbols name), description, types, tags, links, events, sameAs,
  pages: [{ title, icon?, mount(el, lc, { params, query }) }], slots: { '<slot>': { mount(el, lc, data) } },
  commands: [{ label, run(lc) }], chords: ['h'], settings: { mount(el, lc) }, styles: 'css', start(lc),
  says: { internet: ['host'], connections: ['name'] } (say every site you contact).
- mount() draws into el with plain DOM (any framework you bundle is fine) and may return a cleanup function.
  Parts render in a Shadow DOM: use the console's CSS variables (--text, --muted, --border, --surface, --accent).
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
Your own terms live in your namespace (the plugin's name), e.g. 'water.Glass'. Anything with a time belongs on the planner:
create a core.Todo, core.TimeBlock, core.Deadline or core.Reminder ({ title, at: 'YYYY-MM-DDTHH:MM', repeat?: 'daily'|'weekdays'|'weekly:mon,thu'|'every:3', open: '/#/m/<name>' }).

## Style
Calm: small cards, no buttons for their own sake, details on demand. Work at phone width.

## Example
${STARTER}${currentCode ? `\n## The current version to change\n${currentCode}` : ''}`
}

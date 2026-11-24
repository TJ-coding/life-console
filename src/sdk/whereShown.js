// Where an installed extension shows up in the console, so people can find what they just added.
import { registry } from './index.js'
import { nsOfPkg } from './manifest.js'

// each slot and the screen it sits on
const SLOT_SCREENS = {
  'today.card': { label: 'Today', path: '/' },
  'week.strip': { label: 'Plan week', path: '/week' },
  'strategy.plan': { label: 'Strategic plans', path: '/strategy' },
  'todo.panel': { label: 'Todo details', path: '/todos' },
  'settings.section': { label: 'Settings', path: '/settings' },
}

/** [{ label, path }] for an extension: its own pages (by their titles), then the screens its parts sit on. No repeats. */
export function whereShown(pkg) {
  const m = registry.byId[nsOfPkg(pkg)]
  if (!m || m.pkg !== pkg) return []
  const out = m.routes.map((r) => ({ label: r.meta?.title ?? m.title, path: r.path }))
  for (const s of Object.keys(m.slots ?? {})) if (SLOT_SCREENS[s]) out.push(SLOT_SCREENS[s])
  const seen = new Set()
  return out.filter((w) => !seen.has(w.label.toLowerCase()) && seen.add(w.label.toLowerCase()))
}

// Where an installed plugin shows up in the console, so people can find what they just added.
import { registry } from './index.js'
import { nsOfPkg } from './manifest.js'

// each slot and the screen it sits on
const SLOT_SCREENS = {
  'today.card': { label: 'Today', path: '/' },
  'week.strip': { label: 'Plan week', path: '/week' },
  'strategy.plan': { label: 'each strategic plan', path: '/strategy' },
  'todo.panel': { label: 'a todo\'s details', path: '/todos' },
  'settings.section': { label: 'Settings', path: '/settings' },
}

/** [{ label, path }] for a plugin: its own pages first, then the screens its parts sit on, then the palette. */
export function whereShown(pkg) {
  const m = registry.byId[nsOfPkg(pkg)]
  if (!m || m.pkg !== pkg) return []
  const out = m.routes.map((r) => ({ label: `its page, ${r.meta?.title ?? m.title}`, path: r.path }))
  for (const s of Object.keys(m.slots ?? {})) if (SLOT_SCREENS[s]) out.push(SLOT_SCREENS[s])
  if (m.settings) out.push({ label: 'Plugins', path: '/m/plugins' })
  if (m.commands?.length) out.push({ label: 'the command palette (⌘K)', path: null })
  return out
}

// Which edition THIS DEVICE shows, like the theme: someone who uses two editions switches often and wouldn't want
// their phone to follow their laptop. Read before the store seeds a new planner, so /app?edition=minimalist (an
// edition's landing page) starts a new visitor's demo in that edition. Doesn't import the store.
import { EDITIONS } from '../editions/index.js'

export const EDITION_KEY = 'life-console/edition'
function read() {
  try {
    const q = new URLSearchParams(location.search).get('edition')
    if (q && EDITIONS[q]) {
      localStorage.setItem(EDITION_KEY, q)
      history.replaceState(null, '', location.pathname + location.hash) // a clean address bar (and bookmark)
    }
  } catch { /* no window (Node) or no storage */ }
  try { const v = localStorage.getItem(EDITION_KEY); return EDITIONS[v] ? v : null } catch { return null }
}
/** This device's choice, or null (then the account's home edition applies: settings.edition, else base). */
export const devicePref = { value: read() }
export function saveDevicePref(id) {
  devicePref.value = EDITIONS[id] ? id : null
  try { devicePref.value ? localStorage.setItem(EDITION_KEY, id) : localStorage.removeItem(EDITION_KEY) } catch { /* ignore */ }
}

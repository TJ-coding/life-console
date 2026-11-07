// Anonymous usage statistics (Umami), only when the server sets ANALYTICS_SCRIPT + ANALYTICS_SITE_ID.
// Each person can turn it off in Settings → Privacy (state.settings.shareUsage, synced to all their devices).
// Only screen names are sent: route patterns such as /app/day/:date, never dates, IDs, queries or planner content.
import { state } from './store'
import { auth } from './auth'
import { sync } from './sync'

let ready = false // the account's own settings have arrived (first sync done), so the opt-out is known
let loading = null

const config = () => auth.analytics // { script, siteId } from /api/health, or null
export const analyticsAvailable = () => !!config()

const allowed = () => config() && ready && auth.status === 'signed-in' && sync.status !== 'choose' && state.settings?.shareUsage !== false

function load() {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = config().script
    s.defer = true
    s.dataset.websiteId = config().siteId
    s.dataset.autoTrack = 'false' // we send page views ourselves, without the hash's dates and IDs
    s.onload = resolve
    s.onerror = () => { loading = null; reject(new Error('analytics script failed')) }
    document.head.appendChild(s)
  })
  return loading
}

/** Record a page view for a vue-router route: its pattern and screen title only. */
export function trackRoute(route) {
  if (!allowed() || !route?.matched?.length) return
  const pattern = route.matched[route.matched.length - 1].path
  const title = route.meta?.title || 'Life Console'
  load().then(() => {
    if (!allowed()) return // switched off while the script loaded
    window.umami?.track((p) => ({ ...p, url: `/app${pattern === '/' ? '' : pattern}`, title, referrer: '' }))
  }).catch(() => {})
}

/** Call once the first sync is done (after every sign-in too), with the current route. */
export function analyticsReady(route) {
  ready = true
  trackRoute(route)
}

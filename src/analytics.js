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

// Signed out: the sign-in screen (S-00). Nobody's settings exist yet, so there's no opt-out to read; only these fixed
// names are sent, with no account, email or route data. Lets the landing page funnel be measured:
// "open-app" click on the landing page → sign-in screen shown → "Continue with Google" → signed in (/app page views).
const signedOutAllowed = () => config() && auth.status === 'signed-out'

// Links we publish elsewhere point at /app?from=<source>, e.g. the README's "Try it now" (?from=github), so the
// sign-in funnel shows which ones bring people in. Only these fixed names are sent; anything else is dropped.
const SOURCES = ['github']
export function linkSource(search = location.search) {
  const from = new URLSearchParams(search).get('from')
  return SOURCES.includes(from) ? from : undefined
}

// The landing-page A/B test (server: LANDING_AB) remembers the variant a visitor saw in the lc_lp cookie ('a' | 'b');
// the sign-in screen passes it on so the funnel can be split by variant all the way to "Continue with Google".
export function landingVariant(cookie = typeof document === 'undefined' ? '' : document.cookie) {
  const m = /(?:^|;\s*)lc_lp=([ab])(?:;|$)/.exec(cookie)
  return m ? m[1] : undefined
}
const withVariant = (data) => { const lp = landingVariant(); return lp ? { ...data, lp } : data }

/**
 * The sign-in screen was shown. `inApp`: an in-app browser (Reddit, Instagram…) where Google refuses to sign in.
 * `fromGuest`: they tried the app without an account first and came back to keep their planner.
 */
export function trackSignInScreen(inApp, fromGuest = false) {
  if (!signedOutAllowed()) return
  const from = linkSource()
  const data = withVariant({ inApp, ...(from && { from }), ...(fromGuest && { fromGuest }) })
  load().then(() => window.umami?.track((p) => ({ ...p, url: '/app/sign-in', title: 'Sign in', referrer: '', data }))).catch(() => {})
}

/** A button on the sign-in screen: 'signin-google', 'signin-open-browser', 'signin-copy-link', 'signin-error', 'signin-guest' (Try the demo), 'signin-guest-back'. */
export function trackSignInEvent(name, data = {}) {
  if (!signedOutAllowed()) return
  data = withVariant(data)
  load().then(() => window.umami?.track((p) => ({ ...p, url: '/app/sign-in', title: 'Sign in', referrer: '', name, data }))).catch(() => {})
}

/**
 * True inside an app's embedded browser (a WebView), where Google blocks sign-in with "403 disallowed_useragent".
 * Android WebViews mark themselves with "; wv)"; iOS WebViews (WKWebView) lack the "Safari/" token that Safari and
 * SFSafariViewController send; known apps name themselves in the user agent.
 */
export function inAppBrowser(ua = navigator.userAgent) {
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Bytedance|Twitter|LinkedInApp|Pinterest|Reddit|MicroMessenger|KAKAOTALK/i.test(ua)) return true
  if (/Android/.test(ua) && /; wv\)/.test(ua)) return true
  if (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) return true
  return false
}

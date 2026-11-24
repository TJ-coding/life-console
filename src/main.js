import { createApp, watch } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { registry, attachRouter } from './sdk'
import { loadPlugins, plugins } from './sdk/loader.js'
import { whereShown } from './sdk/whereShown.js'
import { nsOfPkg } from './sdk/manifest.js'
import { setLcRouter } from './sdk/lc.js'
import { applyTheme, toast } from './store'
import { startSync, resumeSync } from './sync'
import { auth, setSignedInHandler } from './auth'
import { refreshPush } from './push'
import { loadIssues } from './issues'
import { trackRoute, analyticsReady } from './analytics'
import './styles.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: registry.routes, // every module's routes (modules/*/index.js) and the shell's (src/sdk/core.js)
})

// global guard: also runs when only the :date param changes (route-level beforeEnter would not)
router.beforeEach((to) => (to.name === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(to.params.date) ? '/' : true))

router.afterEach((to) => trackRoute(to))
// back from the trusted page: show what happened, then tidy the address
router.afterEach((to) => {
  if (typeof to.query.notice !== 'string') return
  const { notice, added, ...query } = to.query
  if (typeof added !== 'string') { toast(notice); router.replace({ path: to.path, query }); return }
  // a plugin was just installed or switched on: take you to where it shows up and point at it
  router.replace({ path: to.path, query })
  showAdded(added, notice)
})
function showAdded(pkg, notice) {
  const go = () => {
    const places = whereShown(pkg)
    const title = registry.byId[nsOfPkg(pkg)]?.title ?? pkg
    if (!places.length) { toast(plugins.failed[pkg] ? `${title} didn't load: ${plugins.failed[pkg]}` : notice); return }
    const first = places.find((p) => p.path)
    toast(`${title} is on: find it on ${places.map((p) => p.label).join(', ')}`)
    if (first && router.currentRoute.value.path !== first.path) router.push(first.path)
    plugins.highlight = pkg
    setTimeout(() => { if (plugins.highlight === pkg) plugins.highlight = null }, 5000)
  }
  if (plugins.status === 'ready' || plugins.status === 'none' || plugins.status === 'safe') go()
  else { const stop = watch(() => plugins.status, (s) => { if (s !== 'loading' && s !== 'idle') { stop(); go() } }) }
}
attachRouter(router)
setLcRouter(router)

applyTheme()
createApp(App).use(router).mount('#app')

// after signing in (on the sign-in screen, or again after a session expired): sync, issues, push
const swReady = 'serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD
setSignedInHandler(async () => {
  await resumeSync()
  loadPlugins()
  analyticsReady(router.currentRoute.value)
  loadIssues()
  if (swReady) refreshPush().catch(() => {})
})
// sync with the server (no-op without one), then the service worker for offline + push
if (swReady) navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker', e))
startSync().then(() => {
  if (auth.status === 'signed-in') loadPlugins() // Public plugins installed for this account (src/sdk/loader.js)
  if (auth.status === 'signed-in' || auth.status === 'none') loadIssues() // issue counts; also sends reports queued offline
  if (auth.status === 'signed-in') analyticsReady(router.currentRoute.value)
  if (auth.status === 'signed-in' && swReady) navigator.serviceWorker.ready.then(() => refreshPush()).catch(() => {})
})
// a fix may land while the app is open: check again when you come back to the tab (at most every 5 min)
let issuesAt = Date.now()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || Date.now() - issuesAt < 5 * 60000) return
  issuesAt = Date.now()
  if (auth.status === 'signed-in') loadIssues()
})

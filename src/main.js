import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { registry } from './sdk'
import { applyTheme } from './store'
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

applyTheme()
createApp(App).use(router).mount('#app')

// after signing in (on the sign-in screen, or again after a session expired): sync, issues, push
const swReady = 'serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD
setSignedInHandler(async () => {
  await resumeSync()
  analyticsReady(router.currentRoute.value)
  loadIssues()
  if (swReady) refreshPush().catch(() => {})
})
// sync with the server (no-op without one), then the service worker for offline + push
if (swReady) navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker', e))
startSync().then(() => {
  if (auth.status === 'signed-in' || auth.status === 'none') loadIssues() // issue counts; also sends reports queued offline
  if (auth.status === 'signed-in') analyticsReady(router.currentRoute.value)
  if (auth.status === 'signed-in' && swReady) navigator.serviceWorker.ready.then(() => refreshPush()).catch(() => {})
})

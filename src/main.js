import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import CommandCenter from './views/CommandCenter.vue'
import WeeklyPlanner from './views/WeeklyPlanner.vue'
import TodoInbox from './views/TodoInbox.vue'
import StrategicPlan from './views/StrategicPlan.vue'
import PlansIndex from './views/PlansIndex.vue'
import Settings from './views/Settings.vue'
import FocusMode from './views/FocusMode.vue'
import Deadlines from './views/Deadlines.vue'
import ModulePlaceholder from './views/ModulePlaceholder.vue'
import Issues from './views/Issues.vue'
import { applyTheme } from './store'
import { startSync, resumeSync } from './sync'
import { auth, setSignedInHandler } from './auth'
import { refreshPush } from './push'
import { loadIssues } from './issues'
import { trackRoute, analyticsReady } from './analytics'
import './styles.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'today', component: CommandCenter, meta: { title: 'Command Center', screen: 'S-01' } },
    { path: '/day/:date', name: 'day', component: CommandCenter, meta: { title: 'Day', screen: 'S-11' } },
    { path: '/focus', name: 'focus', component: FocusMode, meta: { title: 'Focus mode', screen: 'S-01F', bare: true } },
    { path: '/week', name: 'week', component: WeeklyPlanner, meta: { title: 'Plan week', screen: 'S-10' } },
    { path: '/workload', redirect: { path: '/week', query: { mode: 'days' } } }, // merged into the planner
    { path: '/todos', name: 'todos', component: TodoInbox, meta: { title: 'Todo Inbox', screen: 'S-20' } },
    { path: '/deadlines', name: 'deadlines', component: Deadlines, meta: { title: 'Deadlines', screen: 'S-21' } },
    { path: '/strategy', name: 'plans', component: PlansIndex, meta: { title: 'Strategic plans', screen: 'S-35' } },
    { path: '/strategy/:planId', name: 'strategy', component: StrategicPlan, meta: { title: 'Strategic plan', screen: 'S-30' } },
    { path: '/settings', name: 'settings', component: Settings, meta: { title: 'Settings', screen: 'S-90' } },
    { path: '/issues', name: 'issues', component: Issues, meta: { title: 'Issues', screen: 'S-95' } },
    { path: '/m/:module', name: 'module', component: ModulePlaceholder, meta: { title: 'Module' } },
  ],
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

import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import CommandCenter from './views/CommandCenter.vue'
import WeeklyPlanner from './views/WeeklyPlanner.vue'
import TodoInbox from './views/TodoInbox.vue'
import StrategicPlan from './views/StrategicPlan.vue'
import Settings from './views/Settings.vue'
import FocusMode from './views/FocusMode.vue'
import Deadlines from './views/Deadlines.vue'
import ModulePlaceholder from './views/ModulePlaceholder.vue'
import { applyTheme } from './store'
import { startSync } from './sync'
import { refreshPush } from './push'
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
    { path: '/strategy', name: 'strategy', component: StrategicPlan, meta: { title: 'Strategic Plan', screen: 'S-30' } },
    { path: '/settings', name: 'settings', component: Settings, meta: { title: 'Settings', screen: 'S-90' } },
    { path: '/m/:module', name: 'module', component: ModulePlaceholder, meta: { title: 'Module' } },
  ],
})

// global guard: also runs when only the :date param changes (route-level beforeEnter would not)
router.beforeEach((to) => (to.name === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(to.params.date) ? '/' : true))

applyTheme()
createApp(App).use(router).mount('#app')

// sync with the server (no-op without one), then the service worker for offline + push
startSync()
if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').then(() => refreshPush()).catch((e) => console.warn('service worker', e))
}

import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import CommandCenter from './views/CommandCenter.vue'
import WeeklyPlanner from './views/WeeklyPlanner.vue'
import TodoInbox from './views/TodoInbox.vue'
import StrategicPlan from './views/StrategicPlan.vue'
import Settings from './views/Settings.vue'
import FocusMode from './views/FocusMode.vue'
import ModulePlaceholder from './views/ModulePlaceholder.vue'
import { applyTheme } from './store'
import './styles.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'today', component: CommandCenter, meta: { title: 'Command Center', screen: 'S-01' } },
    { path: '/focus', name: 'focus', component: FocusMode, meta: { title: 'Focus mode', screen: 'S-01F', bare: true } },
    { path: '/week', name: 'week', component: WeeklyPlanner, meta: { title: 'Plan week', screen: 'S-10' } },
    { path: '/workload', redirect: { path: '/week', query: { mode: 'days' } } }, // merged into the planner
    { path: '/todos', name: 'todos', component: TodoInbox, meta: { title: 'Todo Inbox', screen: 'S-20' } },
    { path: '/strategy', name: 'strategy', component: StrategicPlan, meta: { title: 'Strategic Plan', screen: 'S-30' } },
    { path: '/settings', name: 'settings', component: Settings, meta: { title: 'Settings', screen: 'S-90' } },
    { path: '/m/:module', name: 'module', component: ModulePlaceholder, meta: { title: 'Module' } },
  ],
})

applyTheme()
createApp(App).use(router).mount('#app')

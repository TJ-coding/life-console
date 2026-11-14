import { defineModule } from '../../src/sdk/registry.js'
import WeeklyPlanner from '../../src/views/WeeklyPlanner.vue'

export default defineModule({
  id: 'week', title: 'Plan week', icon: 'calendar_month',
  routes: [
    { path: '/week', name: 'week', component: WeeklyPlanner, meta: { title: 'Plan week', screen: 'S-10' } },
    { path: '/workload', redirect: { path: '/week', query: { mode: 'days' } } }, // merged into the planner
  ],
  nav: [{ key: 'week', label: 'Plan week', icon: 'calendar_month', to: '/week', hint: 'W', tab: 'Plan' }],
  chords: [{ key: 'w', to: '/week' }, { key: 'l', to: '/week?mode=days' }],
})

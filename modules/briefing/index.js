import { defineModule } from '../../src/sdk/registry.js'
import Briefing from '../../src/views/Briefing.vue'
import Debrief from '../../src/views/Debrief.vue'

export default defineModule({
  id: 'briefing', title: 'Briefing', icon: 'wb_sunny',
  routes: [
    { path: '/briefing', name: 'briefing', component: Briefing, meta: { title: 'Briefing', screen: 'S-02', bare: true, sheet: true } },
    { path: '/debrief', name: 'debrief', component: Debrief, meta: { title: 'Debrief', screen: 'S-03', bare: true, sheet: true } },
  ],
  commands: [
    { label: 'Briefing (morning review)', icon: 'wb_sunny', run: ({ router }) => router.push('/briefing') },
    { label: 'Debrief (evening review)', icon: 'bedtime', run: ({ router }) => router.push('/debrief') },
  ],
})

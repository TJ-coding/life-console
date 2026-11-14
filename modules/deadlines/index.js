import { defineModule } from '../../src/sdk/registry.js'
import data from './data.js'
import Deadlines from '../../src/views/Deadlines.vue'

export default defineModule({
  data, title: 'Deadlines', icon: 'alarm',
  routes: [{ path: '/deadlines', name: 'deadlines', component: Deadlines, meta: { title: 'Deadlines', screen: 'S-21' } }],
  nav: [{ key: 'deadlines', label: 'Deadlines', icon: 'alarm', to: '/deadlines', chord: 'D', tab: 'Deadlines' }],
})

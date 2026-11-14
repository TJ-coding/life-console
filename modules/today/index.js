// Manifests point at the existing screens where they are (src/views/); files move only when a module is reworked.
import { defineModule } from '../../src/sdk/registry.js'
import CommandCenter from '../../src/views/CommandCenter.vue'

export default defineModule({
  id: 'today', title: 'Command Center', icon: 'radar',
  routes: [
    { path: '/', name: 'today', component: CommandCenter, meta: { title: 'Command Center', screen: 'S-01' } },
    { path: '/day/:date', name: 'day', component: CommandCenter, meta: { title: 'Day', screen: 'S-11', nav: 'today' } },
  ],
  nav: [{ key: 'today', label: 'Command Center', icon: 'radar', to: '/', hint: 'T', tab: 'Today' }],
  chords: [{ key: 't', to: '/' }, { key: 'c', to: '/' }],
})

import { defineModule } from '../../src/sdk/registry.js'
import FocusMode from '../../src/views/FocusMode.vue'

// F opens it: single keys stay with the shell (App.vue onKey)
export default defineModule({
  id: 'focus', title: 'Focus mode', icon: 'center_focus_strong',
  routes: [{ path: '/focus', name: 'focus', component: FocusMode, meta: { title: 'Focus mode', screen: 'S-01F', bare: true } }],
})

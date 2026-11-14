// The shell's own entries, registered after every module (so they come last in the sidebar and tab bar):
// Issues and Settings belong to every edition, and /m/:module catches modules that aren't built.
import { defineModule } from './registry.js'
import Settings from '../views/Settings.vue'
import Issues from '../views/Issues.vue'
import ModulePlaceholder from '../views/ModulePlaceholder.vue'

export default defineModule({
  id: 'core', title: 'Life Console', icon: 'radar',
  routes: [
    { path: '/settings', name: 'settings', component: Settings, meta: { title: 'Settings', screen: 'S-90' } },
    { path: '/issues', name: 'issues', component: Issues, meta: { title: 'Issues', screen: 'S-95' } },
    { path: '/m/:module', name: 'module', component: ModulePlaceholder, meta: { title: 'Module' } },
  ],
  nav: [
    { key: 'issues', label: 'Issues', icon: 'bug_report', to: '/issues', chord: 'B' },
    { key: 'settings', label: 'Settings', icon: 'settings', to: '/settings', tab: 'Settings' },
  ],
})

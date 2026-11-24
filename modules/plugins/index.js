import { defineModule } from '../../src/sdk/registry.js'

// Core: the plugin platform's own screens (docs/PLATFORM.md). No sidebar entry (a calm console): reached from
// Settings → Plugins and the command palette. Installing, keys and passwords happen on the trusted page (/trust).
export default defineModule({
  id: 'plugins', title: 'Plugins', icon: 'extension',
  routes: [
    { path: '/m/plugins', name: 'plugins', component: () => import('../../src/views/PluginsHub.vue'), meta: { title: 'Plugins', screen: 'S-96' } },
    { path: '/m/plugins/workshop', name: 'workshop', component: () => import('../../src/views/Workshop.vue'), meta: { title: 'Workshop', screen: 'S-97' } },
  ],
  commands: [
    { label: 'Plugins', icon: 'extension', run: ({ router }) => router.push('/m/plugins') },
    { label: 'Plugin workshop', icon: 'construction', run: ({ router }) => router.push('/m/plugins/workshop') },
  ],
})

import { defineModule } from '../../src/sdk/registry.js'

// Core: the extension platform's own screens (docs/PLATFORM.md; "plugin" in the code, "extension" to people).
// In the sidebar (G E) and the palette. Installing, keys and passwords happen on the trusted page (/trust).
export default defineModule({
  id: 'extensions', title: 'Extensions', icon: 'extension',
  routes: [
    { path: '/m/extensions', name: 'extensions', component: () => import('../../src/views/PluginsHub.vue'), meta: { title: 'Extensions', screen: 'S-96' } },
    { path: '/m/extensions/workshop', name: 'workshop', component: () => import('../../src/views/Workshop.vue'), meta: { title: 'Workshop', screen: 'S-97' } },
    { path: '/m/extensions/sharing', name: 'sharing', component: () => import('../../src/views/Sharing.vue'), meta: { title: 'Sharing', screen: 'S-98' } },
  ],
  nav: [{ key: 'extensions', label: 'Extensions', icon: 'extension', to: '/m/extensions', chord: 'E' }],
  commands: [
    { label: 'Extensions', icon: 'extension', run: ({ router }) => router.push('/m/extensions') },
    { label: 'Make an extension (workshop)', icon: 'construction', run: ({ router }) => router.push('/m/extensions/workshop') },
    { label: 'Sharing and your data', icon: 'share', run: ({ router }) => router.push('/m/extensions/sharing') },
  ],
})

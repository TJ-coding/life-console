import { defineModule } from '../../src/sdk/registry.js'

// Not built yet: /m/standards shows the spec's planned screens (src/views/ModulePlaceholder.vue).
export default defineModule({
  id: 'standards', title: 'Standards', icon: 'timer',
  nav: [{ key: 'standards', label: 'Standards', icon: 'timer', to: '/m/standards' }],
  planned: [
    'S-70 Task Standard Sheet',
  ],
})

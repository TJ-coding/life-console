import { defineModule } from '../../src/sdk/registry.js'

// Not built yet: /m/wellbeing shows the spec's planned screens (src/views/ModulePlaceholder.vue).
export default defineModule({
  id: 'wellbeing', title: 'Wellbeing', icon: 'ecg_heart',
  nav: [{ key: 'wellbeing', label: 'Wellbeing', icon: 'ecg_heart', to: '/m/wellbeing' }],
  planned: [
    'S-60 Sleep Log',
    'S-61 Sleep Day Entry',
    'S-62 Wellbeing Checklist',
    'S-63 CES-D Check-in',
    'S-64 Support Plans',
  ],
})

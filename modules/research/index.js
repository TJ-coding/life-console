import { defineModule } from '../../src/sdk/registry.js'

// Not built yet: /m/research shows the spec's planned screens (src/views/ModulePlaceholder.vue).
export default defineModule({
  id: 'research', title: 'Research', icon: 'science',
  nav: [{ key: 'research', label: 'Research', icon: 'science', to: '/m/research' }],
  planned: [
    'S-50 Reading List + Ochiai Card',
    'S-51 Problem Candidate Backlog',
    'S-52 Emerging Trend Report',
    'S-53 PIR / SIR Sheet',
    'S-54 Tagged Notes',
  ],
})

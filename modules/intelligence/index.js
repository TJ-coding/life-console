import { defineModule } from '../../src/sdk/registry.js'
import data from './data.js'

// Not built yet: /m/intelligence shows the spec's planned screens (src/views/ModulePlaceholder.vue).
export default defineModule({
  data, title: 'Intelligence', icon: 'satellite_alt',
  nav: [{ key: 'intelligence', label: 'Intelligence', icon: 'satellite_alt', to: '/m/intelligence' }],
  planned: [
    'S-40 IPB Project Overview',
    'S-41 Operational Environment',
    'S-42 Threat Overlay',
    'S-43 Evaluate the Threat (CARVER)',
    'S-44 Situation Template & COA',
    'S-45 Decision Support Template',
    'S-46 Information Collection Matrix',
  ],
})

import { defineModule } from '../../src/sdk/registry.js'
import data from './data.js'
import PlansIndex from '../../src/views/PlansIndex.vue'
import StrategicPlan from '../../src/views/StrategicPlan.vue'

export default defineModule({
  data, title: 'Strategy', icon: 'target',
  routes: [
    { path: '/strategy', name: 'plans', component: PlansIndex, meta: { title: 'Strategic plans', screen: 'S-35', nav: 'strategy' } },
    { path: '/strategy/:planId', name: 'strategy', component: StrategicPlan, meta: { title: 'Strategic plan', screen: 'S-30' } },
  ],
  nav: [{ key: 'strategy', label: 'Strategy', icon: 'target', to: '/strategy', chord: 'S' }],
})

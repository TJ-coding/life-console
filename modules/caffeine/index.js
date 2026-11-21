import { defineModule } from '../../src/sdk/registry.js'

// A plugin: no screen of its own, off by default (no edition lists it). Switch it on in Settings → Console;
// screens that show it check isEnabled('caffeine'). Its data stays in the planner either way (top-level keys).
export default defineModule({
  id: 'caffeine', title: 'Caffeine', icon: 'local_cafe',
  plugin: { desc: "Today's caffeine with a one-tap coffee, its limit and cutoff, on Today, in More and in Focus." },
})

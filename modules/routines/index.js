import { defineModule } from '../../src/sdk/registry.js'

// A plugin: no screen of its own, off by default (no edition lists it). Switch it on in Settings → Console;
// screens that show it check isEnabled('routines'). Its data stays in the planner either way (top-level keys).
export default defineModule({
  id: 'routines', title: 'Routines', icon: 'task_alt',
  plugin: { desc: "Weekly routines and the monthly rotation: Plan week's side rail and Today's telemetry." },
})

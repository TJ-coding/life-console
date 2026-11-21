import { defineModule } from '../../src/sdk/registry.js'

// A plugin: no screen of its own, off by default (no edition lists it). Switch it on in Settings → Console;
// screens that show it check isEnabled('sleep'). Its data stays in the planner either way (top-level keys).
export default defineModule({
  id: 'sleep', title: 'Sleep', icon: 'bedtime',
  plugin: { desc: "Last night's sleep on Today's telemetry line and in More." },
})

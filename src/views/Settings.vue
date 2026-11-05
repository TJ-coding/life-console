<script setup>
// S-90 · Settings — install on phone, notifications, sync, appearance, data.
import { computed, onMounted, ref } from 'vue'
import { state, ui, toggleTheme, resetDemo, toast, normalizeState } from '../store'
import { sync, pull, deviceName, setDeviceName } from '../sync'
import { push, env, enablePush, disablePush, testPush, listDevices, refreshPush, install, promptInstall } from '../push'
import { rhythm, wallMin } from '../../server/pomodoro.mjs'

/* ── data ── */
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `life-console-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
function importJson(e) {
  const file = e.target.files[0]
  if (!file) return
  file.text().then((txt) => {
    try {
      const data = JSON.parse(txt)
      for (const k of Object.keys(state)) delete state[k]
      Object.assign(state, data)
      normalizeState()
      toast('Data imported')
    } catch { toast('Invalid JSON file') }
  })
}
function reset() { if (confirm('Reset all data to the demo seed? (This also replaces the synced copy on the server.)')) { resetDemo(); toast('Demo data restored') } }

/* ── device + notifications ── */
const name = ref(deviceName())
const saveName = () => { setDeviceName(name.value); name.value = deviceName(); if (push.subscribed) refreshPush(); toast('Device name saved') }
const devices = ref([])
const loadDevices = async () => { try { devices.value = await listDevices() } catch { devices.value = [] } }
onMounted(() => { if (sync.status !== 'local') loadDevices(); if (push.supported) refreshPush().catch(() => {}) })
async function enable() { await enablePush(); if (push.subscribed) { toast('Notifications on for this device'); loadDevices() } }
async function disable() { await disablePush(); toast('Notifications off for this device'); loadDevices() }
async function test() {
  try { const r = await testPush(); toast(r.sent ? 'Test sent — check this device' : 'Not delivered: re-enable notifications here') } catch (e) { toast(e.message) }
}
const n = computed(() => state.settings)
const setWall = computed(() => {
  const r = rhythm(state.settings)
  const m = wallMin(r.work * r.every, r)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`
})
const KINDS = [
  { key: 'blocks', label: 'Blocks & tasks', desc: 'Before each scheduled block or time-boxed task starts, and “Time’s up” when a task ends (with Mark done).' },
  { key: 'deadlines', label: 'Deadlines', desc: '1 day and 1 hour before each deadline, and when it becomes overdue.' },
  { key: 'daily', label: 'Daily briefing & sign-off', desc: 'Morning summary of the day; evening reminder to stamp sign-off and plan tomorrow.' },
  { key: 'wellbeing', label: 'Wellbeing', desc: 'Caffeine cutoff warning and a wind-down reminder before bedtime.' },
  { key: 'pomodoro', label: 'Pomodoro switches', desc: 'In a pomodoro sitting: “Break” when each pomodoro ends and “Back to work” when the break is over.' },
]
const SYNC_LABEL = { outdated: 'Update needed', choose: 'Choose copy', starting: 'Connecting…', local: 'Local only', syncing: 'Saving…', synced: 'Synced', offline: 'Offline', 'signed-out': 'Signed out', error: 'Error' }
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
const isThis = (d) => d.endpoint === push.endpoint
const reload = () => window.location.reload()
</script>

<template>
  <div class="settings">
    <!-- install -->
    <section class="panel">
      <div class="panel-h"><span class="icon sm">install_mobile</span><h2>Install on your phone</h2><span class="spacer"></span>
        <span v-if="env.standalone" class="chip goal">INSTALLED</span></div>
      <div class="panel-b col">
        <p v-if="!env.secure" class="warn small">This page isn't on HTTPS, so it can't be installed or send notifications here. Open <b class="mono">https://life-console.tj-coding.uk</b> instead.</p>
        <template v-else-if="env.standalone"><p class="small">You're using the installed app ✓</p></template>
        <template v-else>
          <div class="steps">
            <div v-if="!env.android" class="step"><b class="row"><span class="icon sm">phone_iphone</span>iPhone / iPad (Safari, iOS 16.4+)</b>
              <ol class="small"><li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share</b> <span class="icon sm">ios_share</span> → <b>Add to Home Screen</b> → Add.</li><li>Open <b>Life Console</b> from the Home Screen, sign in, then come back here and turn on notifications.</li></ol>
              <p class="tiny muted">iOS only allows push notifications for apps added to the Home Screen.</p>
            </div>
            <div v-if="!env.ios" class="step"><b class="row"><span class="icon sm">android</span>Android (Chrome)</b>
              <ol class="small"><li>Tap <b>Install</b> below, or Chrome's ⋮ menu → <b>Install app</b>.</li><li>Open it and turn on notifications.</li></ol>
              <button class="btn primary" :disabled="!install.available" @click="promptInstall"><span class="icon sm">download</span>Install Life Console</button>
              <p v-if="!install.available" class="tiny muted">Install button appears when Chrome offers it (use the ⋮ menu otherwise).</p>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- notifications: this device -->
    <section class="panel">
      <div class="panel-h"><span class="icon sm">notifications</span><h2>Notifications</h2><span class="spacer"></span>
        <span class="chip" :class="push.subscribed ? 'goal' : ''">{{ push.subscribed ? 'ON · this device' : 'OFF · this device' }}</span></div>
      <div class="panel-b col">
        <div class="row wrap">
          <label class="field grow"><span>This device's name</span><input v-model="name" class="input" @change="saveName" /></label>
        </div>
        <p v-if="!push.supported" class="small warn">
          <template v-if="!env.secure">Needs HTTPS.</template>
          <template v-else-if="env.ios && !env.standalone">On iPhone, add Life Console to the Home Screen first (see above), then open it from there.</template>
          <template v-else>This browser doesn't support web push.</template>
        </p>
        <p v-else-if="push.permission === 'denied'" class="small danger">Notifications are blocked for this app. Allow them in system settings (iOS: Settings → Notifications → Life Console; Android: long-press the app icon → App info → Notifications), then reload.</p>
        <div class="row wrap">
          <button v-if="!push.subscribed" class="btn primary" :disabled="!push.supported || push.busy || sync.status === 'local'" @click="enable"><span class="icon sm">notifications_active</span>Turn on for this device</button>
          <template v-else>
            <button class="btn" :disabled="push.busy" @click="test"><span class="icon sm">send</span>Send test</button>
            <button class="btn danger-ghost" :disabled="push.busy" @click="disable"><span class="icon sm">notifications_off</span>Turn off here</button>
          </template>
        </div>
        <p v-if="push.error" class="small danger">{{ push.error }}</p>
        <details v-if="push.supported" class="phone-help small">
          <summary><b>Test arrives silently, or not at all?</b> Set it up on the phone</summary>
          <p class="muted">The phone decides sound and vibration, not the app. Android often files a new site's notifications as <b>Silent</b>.</p>
          <div v-if="!env.ios"><b class="row"><span class="icon sm">android</span>Android</b>
            <ol>
              <li>Long-press a Life Console notification → choose <b>Alerting</b> / <b>Default</b> (not Silent).</li>
              <li>Or: Settings → Notifications → App notifications → <b>Life Console</b> (or <b>Chrome</b> if you use a tab) → the <b>life-console.tj-coding.uk</b> / <b>Sites</b> category → turn on <b>Sound</b>, <b>Vibration</b> and <b>Pop on screen</b>.</li>
              <li>Chrome → ⋮ → Settings → Site settings → Notifications → this site is <b>Allowed</b> (not in the “quieter” list).</li>
              <li>Phone not on Mute or Do Not Disturb; notification vibration intensity above zero.</li>
              <li>Settings → Apps → Life Console / Chrome → Battery → <b>Unrestricted</b> (Samsung: remove from Sleeping apps).</li>
            </ol>
          </div>
          <div v-if="!env.android"><b class="row"><span class="icon sm">phone_iphone</span>iPhone</b>
            <ol>
              <li>Settings → Notifications → <b>Life Console</b> → Allow Notifications, <b>Sounds</b>, Lock Screen and Banners on.</li>
              <li>Ring/Silent switch on ring and no Focus mode blocking it (or allow Life Console in that Focus).</li>
            </ol>
          </div>
          <p class="muted">Then press <b>Send test</b> again.</p>
        </details>
        <p v-if="sync.status === 'local'" class="tiny muted">Notifications are sent by the server; this copy isn't connected to one.</p>

        <div v-if="devices.length" class="devs">
          <div class="tiny upper muted">Devices receiving notifications</div>
          <div v-for="d in devices" :key="d.endpoint" class="dev row small">
            <span class="icon sm">{{ /fcm|google/.test(d.service) ? 'android' : /apple/.test(d.service) ? 'phone_iphone' : 'computer' }}</span>
            <b>{{ d.label || 'Unnamed' }}</b><span v-if="isThis(d)" class="chip goal">this device</span>
            <span class="spacer"></span><span class="mono muted">{{ d.service }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- notifications: what & when (synced) -->
    <section class="panel">
      <div class="panel-h"><span class="icon sm">tune</span><h2>What to notify</h2><span class="spacer"></span><span class="tiny muted">applies to all your devices</span></div>
      <div class="panel-b col">
        <label v-for="k in KINDS" :key="k.key" class="kind">
          <input v-model="n.notify[k.key]" type="checkbox" />
          <div><b>{{ k.label }}</b><div class="small muted">{{ k.desc }}</div></div>
        </label>
        <label class="kind">
          <input v-model="n.notify.vibrate" type="checkbox" />
          <div><b>Vibration</b><div class="small muted">Let the phone vibrate when a notification arrives. Turn off to keep it silent (the banner still shows).</div></div>
        </label>
        <div class="grid">
          <label class="field"><span>Block reminder (min before)</span><input v-model.number="n.blockLeadMin" type="number" min="0" max="120" class="input mono" /></label>
          <label class="field"><span>Morning briefing</span><input v-model="n.briefingTime" type="time" class="input mono" /></label>
          <label class="field"><span>Evening sign-off</span><input v-model="n.eveningTime" type="time" class="input mono" /></label>
          <label class="field"><span>Bedtime</span><input v-model="n.bedTime" type="time" class="input mono" /></label>
          <label class="field"><span>Wind-down (min before bed)</span><input v-model.number="n.windDownMin" type="number" min="0" max="240" class="input mono" /></label>
          <label class="field"><span>Caffeine cutoff</span><input v-model="state.caffeineCutoff" type="time" class="input mono" /></label>
        </div>
        <p class="tiny muted">Times are in <b class="mono">{{ n.timezone }}</b> (taken from the device you last used).</p>
      </div>
    </section>

    <!-- pomodoro rhythm (synced) -->
    <section class="panel">
      <div class="panel-h"><span class="icon sm">timer</span><h2>Pomodoro</h2><span class="spacer"></span><span class="tiny muted">applies to all your devices</span></div>
      <div class="panel-b col">
        <label class="kind">
          <input v-model="n.pomodoro.on" type="checkbox" />
          <div><b>Plan in pomodoros</b><div class="small muted">Plan this task moves time in whole pomodoros, and <b>Auto times</b> / <b>Auto schedule</b> lay sittings out as work + breaks, with a long break between sets. Sittings already on the schedule keep their layout.</div></div>
        </label>
        <div class="grid">
          <label class="field"><span>Work (min)</span><input v-model.number="n.pomodoro.work" type="number" min="5" max="120" step="5" class="input mono" /></label>
          <label class="field"><span>Short break (min)</span><input v-model.number="n.pomodoro.short" type="number" min="0" max="60" class="input mono" /></label>
          <label class="field"><span>Long break (min)</span><input v-model.number="n.pomodoro.long" type="number" min="0" max="90" step="5" class="input mono" /></label>
          <label class="field"><span>Long break after (pomodoros)</span><input v-model.number="n.pomodoro.every" type="number" min="1" max="12" class="input mono" /></label>
        </div>
        <p class="tiny muted mono">One set: {{ n.pomodoro.every }} × {{ n.pomodoro.work }}m work = {{ setWall }} on the clock, then {{ n.pomodoro.long }}m off.</p>
      </div>
    </section>

    <!-- sync -->
    <section class="panel">
      <div class="panel-h"><span class="icon sm">sync</span><h2>Sync</h2><span class="spacer"></span>
        <span class="chip" :class="{ goal: sync.status === 'synced', plan: ['offline', 'syncing'].includes(sync.status), risk: ['signed-out', 'error'].includes(sync.status) }">{{ SYNC_LABEL[sync.status] }}</span></div>
      <div class="panel-b col small">
        <div class="row"><span class="muted">Server version</span><b class="mono">v{{ sync.version }}</b><span class="spacer"></span><span class="muted">last sync</span><b class="mono">{{ fmtTime(sync.lastSync) }}</b></div>
        <p v-if="sync.message" :class="sync.status === 'signed-out' || sync.status === 'error' ? 'danger' : 'muted'">{{ sync.message }}</p>
        <div class="row">
          <button class="btn" :disabled="sync.status === 'local'" @click="pull"><span class="icon sm">refresh</span>Sync now</button>
          <button v-if="sync.status === 'signed-out'" class="btn primary" @click="reload">Reload to sign in</button>
        </div>
        <p class="tiny muted">Every change is saved to the server within a couple of seconds and shows up on your other devices. If two devices edit at once, the latest edit wins and the server keeps a backup.</p>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">palette</span><h2>Appearance</h2></div>
      <div class="panel-b row"><span class="grow">Theme: <b class="mono">{{ ui.theme }}</b></span><button class="btn" @click="toggleTheme">Toggle light / dark</button></div>
    </section>
    <section class="panel">
      <div class="panel-h"><span class="icon sm">local_cafe</span><h2>Wellbeing limits</h2></div>
      <div class="panel-b row">
        <label class="field"><span>Caffeine limit (mg)</span><input v-model.number="state.caffeineLimit" type="number" class="input mono" /></label>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><span class="icon sm">database</span><h2>Data</h2></div>
      <div class="panel-b col">
        <div class="row wrap">
          <button class="btn" @click="exportJson"><span class="icon sm">download</span>Export JSON</button>
          <label class="btn"><span class="icon sm">upload</span>Import JSON<input type="file" accept="application/json" hidden @change="importJson" /></label>
          <span class="spacer"></span>
          <button class="btn danger-ghost" @click="reset"><span class="icon sm">restart_alt</span>Reset demo data</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings { padding: 16px; display: flex; flex-direction: column; gap: 12px; max-width: 820px; }
.wrap { flex-wrap: wrap; }
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.step { border: 1px solid var(--border); border-radius: 2px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.step ol { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
.kind { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--border); cursor: pointer; }
.kind input { margin-top: 3px; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 6px; }
.phone-help { border: 1px solid var(--border); border-radius: 2px; padding: 8px 12px; }
.phone-help summary { cursor: pointer; }
.phone-help[open] { display: flex; flex-direction: column; gap: 8px; }
.phone-help p { margin: 0; }
.phone-help ol { margin: 4px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
.devs { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border); padding-top: 10px; }
.dev { gap: 8px; padding: 4px 0; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
@media (max-width: 700px) { .steps, .grid { grid-template-columns: 1fr; } }
</style>

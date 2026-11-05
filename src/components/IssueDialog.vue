<script setup>
// Report an issue on the current screen (opened with I, the bug button, or the command palette).
import { ref, computed, watch, nextTick } from 'vue'
import { issues, reportIssue, KINDS, SEVERITIES } from '../issues'
import { toast } from '../store'

const titleEl = ref(null)
const form = ref(null)
const sending = ref(false)

watch(() => issues.dialog, async (d) => {
  if (!d) return
  form.value = { title: '', details: '', kind: 'bug', severity: 'medium', screen: d.screen, screenTitle: d.screenTitle, route: d.route }
  await nextTick()
  titleEl.value?.focus()
})
const d = computed(() => issues.dialog && form.value)
const sameScreen = computed(() => issues.list.filter((i) => i.screen === form.value?.screen && ['open', 'in-progress'].includes(i.status)))
const close = () => { issues.dialog = null }

async function submit() {
  if (!form.value.title.trim() || sending.value) return
  sending.value = true
  const r = await reportIssue({ ...form.value })
  sending.value = false
  close()
  toast(r === 'sent' ? 'Issue saved ✓' : 'Offline — issue saved on this device, will send later')
}
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); close() }
  else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
}
</script>

<template>
  <div v-if="d" class="scrim" @mousedown.self="close" @keydown="onKey">
    <form class="dlg" role="dialog" aria-label="Report an issue" @submit.prevent="submit">
      <header class="hd">
        <span class="icon warn">bug_report</span>
        <span class="grow">Report an issue</span>
        <span class="chip mono" :title="form.route">{{ form.screen || '—' }} · {{ form.screenTitle }}</span>
        <button type="button" class="btn icon-only" title="Close (Esc)" @click="close"><span class="icon sm">close</span></button>
      </header>
      <div class="bd">
        <label class="field"><span>What's wrong / what should change?</span>
          <input ref="titleEl" v-model="form.title" class="input big" maxlength="200" placeholder="e.g. Backlog drag handle is too small on the phone" required />
        </label>
        <label class="field"><span>Details (steps, expected vs. actual, ideas)</span>
          <textarea v-model="form.details" class="textarea" rows="5" maxlength="5000" placeholder="Optional"></textarea>
        </label>
        <div class="seg-row">
          <div class="seg" role="radiogroup" aria-label="Kind">
            <button v-for="k in KINDS" :key="k.key" type="button" class="btn sm" :class="{ active: form.kind === k.key }" role="radio" :aria-checked="form.kind === k.key" @click="form.kind = k.key">
              <span class="icon sm">{{ k.icon }}</span>{{ k.label }}
            </button>
          </div>
          <div class="seg" role="radiogroup" aria-label="Severity">
            <button v-for="s in SEVERITIES" :key="s" type="button" class="btn sm mono upper" :class="{ active: form.severity === s, [`sev-${s}`]: true }" role="radio" :aria-checked="form.severity === s" @click="form.severity = s">{{ s }}</button>
          </div>
        </div>
        <div class="loc">
          <label class="field"><span>Screen</span><input v-model.trim="form.screen" class="input mono" maxlength="20" /></label>
          <label class="field grow-field"><span>Route</span><input v-model.trim="form.route" class="input mono" maxlength="300" /></label>
        </div>
        <p v-if="sameScreen.length" class="tiny muted">
          {{ sameScreen.length }} open on this screen:
          <span v-for="i in sameScreen.slice(0, 3)" :key="i.id" class="mono"> {{ i.id }} {{ i.title }} ·</span>
          <router-link to="/issues" @click="close"> see all</router-link>
        </p>
      </div>
      <footer class="ft">
        <span class="tiny muted">Device, viewport, theme and build are attached automatically.</span>
        <span class="spacer"></span>
        <button type="button" class="btn" @click="close">Cancel</button>
        <button type="submit" class="btn primary" :disabled="!form.title.trim() || sending">Save <span class="kbd">⌘↵</span></button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 65; display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; }
.dlg { width: 560px; max-width: calc(100vw - 32px); max-height: 85vh; overflow: auto; background: var(--surface); border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border)); border-radius: 4px; display: flex; flex-direction: column; }
.hd { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.hd .chip { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bd { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.input.big { height: 34px; font-size: 15px; font-weight: 600; }
.textarea { resize: vertical; min-height: 80px; }
.seg-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; }
.seg { display: flex; gap: 4px; flex-wrap: wrap; }
.btn.sev-high.active { color: var(--danger); border-color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.btn.sev-medium.active { color: var(--warn); border-color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); }
.loc { display: grid; grid-template-columns: 110px 1fr; gap: 10px; }
.ft { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
@media (max-width: 640px) {
  .scrim { padding-top: calc(12px + env(safe-area-inset-top)); }
  .ft .tiny { display: none; }
  .ft .kbd { display: none; }
}
</style>

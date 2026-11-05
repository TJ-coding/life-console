<script setup>
// S-90 · Settings (prototype subset)
import { state, ui, toggleTheme, resetDemo, toast, ensureOrder } from '../store'
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
      ensureOrder()
      toast('Data imported')
    } catch { toast('Invalid JSON file') }
  })
}
function reset() { if (confirm('Reset all data to the demo seed?')) { resetDemo(); toast('Demo data restored') } }
</script>
<template>
  <div class="settings">
    <section class="panel">
      <div class="panel-h"><span class="icon sm">palette</span><h2>Appearance</h2></div>
      <div class="panel-b row"><span class="grow">Theme: <b class="mono">{{ ui.theme }}</b></span><button class="btn" @click="toggleTheme">Toggle light / dark</button></div>
    </section>
    <section class="panel">
      <div class="panel-h"><span class="icon sm">local_cafe</span><h2>Wellbeing limits</h2></div>
      <div class="panel-b row">
        <label class="field"><span>Caffeine limit (mg)</span><input v-model.number="state.caffeineLimit" type="number" class="input mono" /></label>
        <label class="field"><span>Caffeine cutoff</span><input v-model="state.caffeineCutoff" type="time" class="input mono" /></label>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><span class="icon sm">database</span><h2>Data</h2></div>
      <div class="panel-b col">
        <p class="small muted">Everything is stored in this browser's localStorage. There is no backend yet.</p>
        <div class="row">
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
.settings { padding: 16px; display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
</style>

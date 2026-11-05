<script setup>
// Split one task into parts spread over several days, with a live load preview per day.
import { computed, ref, watch } from 'vue'
import {
  ui, findTodo, todayISO, addDays, wd, fmtSlash, dayLoad, CAPACITY_H, evenParts, autoSpread, splitTodo, toast, partLabel,
} from '../store'

const t = computed(() => (ui.splitId ? findTodo(ui.splitId) : null))
const parts = ref([]) // [{ min, date }]
const T = computed(() => todayISO())
const week = computed(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ui.weekStart, i)))
const usable = (d) => d >= T.value && (!t.value?.due || d <= t.value.due)

function reset(n = 2) {
  if (!t.value) return
  parts.value = evenParts(t.value.timeMin, n).map((min) => ({ min, date: null }))
  autoAssign()
}
watch(() => ui.splitId, (id) => { if (id) reset(t.value?.timeMin >= 90 ? 3 : 2) })

function byChunk(size) {
  const n = Math.max(2, Math.ceil(t.value.timeMin / size))
  const mins = Array(n).fill(size)
  mins[n - 1] = t.value.timeMin - size * (n - 1)
  parts.value = mins.map((min) => ({ min, date: null }))
  autoAssign()
}
function autoAssign() {
  const days = week.value.filter((d) => usable(d) && week.value.indexOf(d) < 5) // weekdays first
  const pool = days.length ? days : week.value.filter(usable)
  if (!pool.length) { toast('No usable days this week — parts stay in the backlog'); return }
  const picks = autoSpread(t.value, parts.value.map((p) => p.min), pool)
  parts.value.forEach((p, i) => { p.date = picks[i] })
}
const addPart = () => parts.value.push({ min: 30, date: null })
const removePart = (i) => parts.value.splice(i, 1)

const sum = computed(() => parts.value.reduce((s, p) => s + (Number(p.min) || 0), 0))
/** Day loads without this task, and with the planned parts added. */
const preview = computed(() => week.value.map((d) => {
  const base = dayLoad(d).total - (t.value?.scheduled?.date === d ? t.value.timeMin / 60 : 0)
  const add = parts.value.filter((p) => p.date === d).reduce((s, p) => s + (Number(p.min) || 0), 0) / 60
  return { d, base, add, after: base + add }
}))
const pmax = computed(() => Math.max(CAPACITY_H + 1, ...preview.value.map((p) => p.after)))
const valid = computed(() => parts.value.length >= 2 && parts.value.every((p) => Number(p.min) > 0))

function apply() {
  if (!valid.value) return
  const made = splitTodo(t.value.id, parts.value.map((p) => ({ min: Number(p.min), date: p.date || null })))
  toast(`Split ${made[0].id} into ${made.length} parts`)
  ui.splitId = null
}
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); ui.splitId = null }
  if (e.key === 'Enter' && !['BUTTON', 'SELECT'].includes(e.target.tagName)) { e.preventDefault(); apply() }
}
</script>

<template>
  <div v-if="t" class="scrim" @mousedown.self="ui.splitId = null" @keydown="onKey">
    <div class="dlg" role="dialog" aria-label="Split task across days">
      <header class="hd">
        <span class="icon">call_split</span>
        <div class="grow">
          <div class="tiny upper muted">Split across days <span v-if="partLabel(t)" class="mono">· part {{ partLabel(t) }}</span></div>
          <div class="ttl ellipsis">{{ t.title }}</div>
        </div>
        <span class="mono">{{ t.timeMin }}m</span>
        <button class="btn icon-only" title="Close (Esc)" @click="ui.splitId = null"><span class="icon sm">close</span></button>
      </header>

      <div class="bd">
        <div class="row wrap">
          <span class="tiny upper muted lbl">Parts</span>
          <button v-for="n in [2, 3, 4, 5]" :key="n" class="btn sm" :class="{ active: parts.length === n }" @click="reset(n)">{{ n }}</button>
          <span class="tiny upper muted lbl gap">or chunks of</span>
          <button v-for="c in [30, 45, 60, 90]" :key="c" class="btn sm" :disabled="c >= t.timeMin" @click="byChunk(c)">{{ c }}m</button>
        </div>

        <div class="parts">
          <div v-for="(p, i) in parts" :key="i" class="prow">
            <span class="mono small muted">{{ i + 1 }}/{{ parts.length }}</span>
            <input v-model.number="p.min" type="number" min="5" step="5" class="input mono mins" />
            <span class="small muted">min on</span>
            <select v-model="p.date" class="select grow">
              <option :value="null">Backlog (decide later)</option>
              <option v-for="d in week" :key="d" :value="d" :disabled="d < T">
                {{ wd(d) }} {{ fmtSlash(d) }}{{ d < T ? ' · past' : t.due && d > t.due ? ' · after due!' : '' }}
              </option>
            </select>
            <button class="btn sm icon-only" :disabled="parts.length <= 2" title="Remove part" @click="removePart(i)"><span class="icon sm">close</span></button>
          </div>
          <div class="row">
            <button class="btn sm" @click="addPart"><span class="icon sm">add</span>Part</button>
            <button class="btn sm" @click="autoAssign"><span class="icon sm">auto_fix_high</span>Auto-assign days</button>
            <span class="spacer"></span>
            <span class="mono small" :class="sum === t.timeMin ? 'muted' : 'warn'">
              total {{ sum }}m / {{ t.timeMin }}m<template v-if="sum !== t.timeMin"> · estimate will change</template>
            </span>
          </div>
        </div>

        <div class="pv">
          <div class="tiny upper muted">Day load preview (this week)</div>
          <div v-for="p in preview" :key="p.d" class="pvrow" :class="{ off: p.d < T }">
            <span class="mono small dl">{{ wd(p.d) }} {{ fmtSlash(p.d) }}</span>
            <div class="track">
              <i class="base" :style="{ width: (p.base / pmax) * 100 + '%' }"></i>
              <i v-if="p.add" class="add" :style="{ left: (p.base / pmax) * 100 + '%', width: (p.add / pmax) * 100 + '%' }"></i>
              <b class="cap" :style="{ left: (CAPACITY_H / pmax) * 100 + '%' }"></b>
            </div>
            <span class="mono small val" :class="p.after > CAPACITY_H ? 'danger' : ''">
              <span v-if="p.after > CAPACITY_H" class="icon tiny-i">warning</span>{{ p.after.toFixed(1) }}h
            </span>
          </div>
          <div class="legend small"><span><i class="lg base"></i>already planned</span><span><i class="lg add"></i>this split</span><span><b class="lg cap"></b>{{ CAPACITY_H }}h capacity</span></div>
        </div>
      </div>

      <footer class="ft">
        <span class="small muted grow">Parts keep the title, links, priority and due date. Merge them back from the task drawer.</span>
        <button class="btn" @click="ui.splitId = null">Cancel</button>
        <button class="btn primary" :disabled="!valid" @click="apply"><span class="icon sm">call_split</span>Split into {{ parts.length }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 55; display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; }
.dlg { width: 600px; max-width: calc(100vw - 32px); max-height: 84vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border)); border-radius: 4px; }
.hd { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.ttl { font-weight: 600; font-size: 15px; }
.bd { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; overflow: auto; }
.wrap { flex-wrap: wrap; gap: 4px; }
.lbl { margin-right: 4px; }
.lbl.gap { margin-left: 12px; }
.parts { display: flex; flex-direction: column; gap: 6px; }
.prow { display: flex; align-items: center; gap: 8px; }
.mins { width: 70px; }
.btn:disabled { opacity: 0.35; cursor: not-allowed; }
.pv { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--border); padding-top: 12px; }
.pvrow { display: grid; grid-template-columns: 82px 1fr 56px; align-items: center; gap: 8px; }
.pvrow.off { opacity: 0.45; }
.track { position: relative; height: 10px; background: var(--surface-2); border-radius: 2px; }
.track i { position: absolute; top: 0; bottom: 0; }
.base { left: 0; background: var(--muted); opacity: 0.55; border-radius: 2px 0 0 2px; }
.add { background: var(--info); border-radius: 0 3px 3px 0; margin-left: 2px; }
.cap { position: absolute; top: -3px; bottom: -3px; width: 0; border-left: 2px solid var(--text); opacity: 0.6; }
.val { text-align: right; display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.tiny-i { font-size: 12px; }
.legend { display: flex; gap: 14px; color: var(--muted); }
.lg { display: inline-block; width: 10px; height: 8px; margin-right: 5px; vertical-align: middle; position: static; }
.lg.base { background: var(--muted); opacity: 0.55; }
.lg.add { background: var(--info); margin: 0 5px 0 0; }
.lg.cap { width: 0; height: 10px; border-left: 2px solid var(--text); opacity: 0.6; }
.ft { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
</style>

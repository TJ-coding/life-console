<script setup>
// The Briefing / Debrief frame: one card at a time, Back / Next (← → or Enter), a step counter, and the
// closing action on the last card. Which cards exist is fixed when the screen opens, so fixing an item
// never makes the deck jump; each card shows its own resolved state instead.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { wd, parseISO, MONTHS } from '../store'

const props = defineProps({
  title: String, date: String, action: String,
  cards: { type: Array, required: true }, // [{ key, label, tone?: 'danger'|'warn'|'ok' }]
  blocked: { type: Object, default: () => ({}) }, // { [key]: 'why Next is locked' }
})
const emit = defineEmits(['done'])
const i = ref(0)
const card = computed(() => props.cards[i.value])
const last = computed(() => i.value === props.cards.length - 1)
const lock = computed(() => props.blocked[card.value.key] || '')
const label = computed(() => { const d = parseISO(props.date); return `${wd(props.date)} ${d.getDate()} ${MONTHS[d.getMonth()]}` })

function next() { if (lock.value) return; last.value ? emit('done') : i.value++ }
function back() { if (i.value > 0) i.value-- }
function onKey(e) {
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'ArrowRight' || (e.key === 'Enter' && e.target === document.body)) { e.preventDefault(); next() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="deck">
    <header class="dh">
      <span class="ttl">{{ title }}</span>
      <span class="mono muted">{{ label }}</span>
      <span class="spacer"></span>
      <span class="steps" aria-hidden="true"><i v-for="(c, n) in cards" :key="c.key" :class="[{ on: n === i, past: n < i }, c.tone && 't-' + c.tone]" @click="i = n"></i></span>
      <span class="mono muted step">{{ i + 1 }}/{{ cards.length }}</span>
      <router-link to="/" class="mono esc">ESC</router-link>
    </header>

    <section class="card" :class="card.tone && 't-' + card.tone">
      <div class="clabel mono">{{ card.label }}</div>
      <slot :name="card.key" />
    </section>

    <footer class="df">
      <span v-if="lock" class="mono muted lockmsg">{{ lock }}</span>
      <span class="spacer"></span>
      <button v-if="i > 0" class="btn" @click="back"><span class="icon sm">chevron_left</span>Back</button>
      <button class="btn primary go" :disabled="!!lock" @click="next">{{ last ? action : 'Next' }}<span v-if="!last" class="icon sm">chevron_right</span></button>
    </footer>
  </div>
</template>

<style scoped>
.deck { max-width: 760px; margin: 0 auto; padding: 36px 24px 48px; display: flex; flex-direction: column; gap: 20px; min-height: 100%; box-sizing: border-box; }
.dh { display: flex; align-items: center; gap: 12px; }
.ttl { font: 700 15px/20px 'JetBrains Mono', monospace; letter-spacing: 0.14em; text-transform: uppercase; }
.steps { display: flex; gap: 4px; }
.steps i { width: 22px; height: 4px; background: var(--surface-2); border-radius: 1px; cursor: pointer; }
.steps i.past { background: var(--muted); }
.steps i.on { background: var(--text); }
.steps i.t-danger:not(.on) { background: color-mix(in srgb, var(--danger) 55%, transparent); }
.steps i.t-warn:not(.on) { background: color-mix(in srgb, var(--warn) 55%, transparent); }
.step { font-size: 12px; }
.esc { font-size: 10px; color: var(--muted); text-decoration: none; border: 1px solid var(--border); padding: 2px 6px; border-radius: 2px; }
.card { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--border); border-radius: 2px; padding: 28px 30px; display: flex; flex-direction: column; gap: 18px; box-sizing: border-box; }
.card.t-danger { border-left-color: var(--danger); }
.card.t-warn { border-left-color: var(--warn); }
.card.t-ok { border-left-color: var(--accent); }
.clabel { font-size: 12px; font-weight: 700; letter-spacing: 0.16em; color: var(--muted); }
.t-danger .clabel { color: var(--danger); }
.t-warn .clabel { color: var(--warn); }
.t-ok .clabel { color: var(--accent); }
.df { display: flex; align-items: center; gap: 10px; }
.go { font-size: 15px; padding: 10px 22px; }
.go:disabled { opacity: 0.4; cursor: not-allowed; }
.lockmsg { font-size: 12px; }
/* shared card content */
:slotted(.head) { margin: 0; font: 600 30px/36px Inter, sans-serif; }
:slotted(.hero) { font: 700 48px/52px 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
:slotted(.hero small) { font-size: 16px; font-weight: 500; color: var(--muted); }
:slotted(.say) { font-size: 16px; line-height: 24px; margin: 0; }
:slotted(.acts) { display: flex; gap: 10px; flex-wrap: wrap; }
:slotted(.acts .btn) { font-size: 14px; padding: 8px 16px; }
:slotted(.rows) { display: flex; flex-direction: column; }
:slotted(.r) { display: flex; align-items: center; gap: 14px; min-height: 46px; font-size: 15px; border-top: 1px solid var(--border); }
:slotted(.r .k) { flex: none; width: 64px; font-size: 13px; }
:slotted(.r .k.mark) { width: 14px; font-weight: 700; }
:slotted(.rows.big .r) { font-size: 17px; min-height: 52px; }
:slotted(.r .n) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:slotted(.r .d) { flex: none; font-size: 13px; color: var(--muted); }
:slotted(.clear) { color: var(--accent); font-size: 16px; display: flex; align-items: center; gap: 8px; }
:slotted(.danger) { color: var(--danger); }
:slotted(.warn) { color: var(--warn); }
@media (max-width: 640px) {
  .deck { padding: 16px 12px 24px; gap: 14px; }
  .dh { flex-wrap: wrap; }
  .steps { order: 9; width: 100%; }
  .steps i { flex: 1; }
  .card { padding: 20px 18px; }
  /* Back / Next stay within thumb reach at the bottom of the screen */
  .df { position: sticky; bottom: 0; margin-top: auto; padding: 10px 0 calc(10px + env(safe-area-inset-bottom)); background: var(--bg); }
  :slotted(.head) { font-size: 24px; line-height: 30px; }
  :slotted(.hero) { font-size: 34px; line-height: 40px; }
  :slotted(.r) { font-size: 14px; }
}
</style>

<script setup>
// The frame Briefing and Debrief share: a title line, the review sections, one closing action. Nothing else.
import { computed } from 'vue'
import { wd, parseISO, MONTHS } from '../store'

const props = defineProps({ title: String, date: String, action: String })
defineEmits(['done'])
const label = computed(() => { const d = parseISO(props.date); return `${wd(props.date)} ${d.getDate()} ${MONTHS[d.getMonth()]}` })
</script>

<template>
  <div class="sheet">
    <header class="sh">
      <h1>{{ title }} <span class="muted">· {{ label }}</span></h1>
      <router-link to="/" class="mono tiny muted esc">ESC</router-link>
    </header>
    <slot />
    <footer class="sf"><button class="btn primary big" @click="$emit('done')">{{ action }}</button></footer>
  </div>
</template>

<style scoped>
.sheet { max-width: 720px; margin: 0 auto; padding: 40px 24px 56px; display: flex; flex-direction: column; gap: 30px; }
.sh { display: flex; align-items: baseline; gap: 12px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
.sh h1 { margin: 0; flex: 1; font: 600 26px/32px Inter, sans-serif; letter-spacing: 0.02em; text-transform: uppercase; }
.sh h1 .muted { font-weight: 500; text-transform: none; letter-spacing: 0; }
.esc { text-decoration: none; border: 1px solid var(--border); padding: 2px 6px; border-radius: 2px; }
.sf { display: flex; justify-content: flex-end; }
.big { font-size: 15px; padding: 10px 22px; }
/* sections: an uppercase label line, then 15px rows */
:slotted(section) { display: flex; flex-direction: column; }
:slotted(.lbl) { display: flex; align-items: baseline; gap: 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding-bottom: 8px; border-bottom: 1px solid var(--border); }
:slotted(.lbl b) { color: var(--text); font-weight: 600; }
:slotted(.r) { display: flex; align-items: center; gap: 14px; min-height: 44px; font-size: 15px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
:slotted(.r .t), :slotted(.r .cd) { flex: none; width: 64px; }
:slotted(.r .t) { font-size: 13px; }
:slotted(.r .cd) { font-size: 14px; font-weight: 600; }
:slotted(.r .n) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:slotted(.r .d) { flex: none; font-size: 13px; }
:slotted(.none) { font-size: 15px; padding: 12px 0; color: var(--muted); }
@media (max-width: 640px) {
  .sheet { padding: 20px 16px 40px; gap: 24px; }
  .sh h1 { font-size: 20px; line-height: 26px; }
  :slotted(.r) { font-size: 14px; }
}
</style>

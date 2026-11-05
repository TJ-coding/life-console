<script setup>
// Headline for one deadline: what's due on the left, a big ticking countdown on the right.
// Used by the S-01 deadline card and the top of S-21. Click opens the deadline dialog.
import { ui, todayISO, relDay } from '../store'
import { minsTo, bigCountdown, urgency, dueStatus } from '../glance'
import Chip from './Chip.vue'

defineProps({ d: { type: Object, required: true }, label: { type: String, default: 'Next deadline' } })
</script>

<template>
  <button class="dl-hero" title="Open the deadline" @click="ui.deadlineId = d.id">
    <span class="what">
      <span class="inst-lbl"><span class="tiny upper muted">{{ label }}</span><span class="pill mono" :class="urgency(d.due)">{{ dueStatus(d.due) }}</span></span>
      <span class="name clamp2">{{ d.title }}</span>
      <span class="meta mono small muted">{{ relDay(d.due.slice(0, 10), todayISO()) }} · {{ d.due.slice(11) }}<Chip v-if="d.source" :id="d.source" /></span>
    </span>
    <span class="clock">
      <span class="inst-big mono" :class="urgency(d.due)">{{ bigCountdown(d.due) }}</span>
      <span class="small muted">{{ minsTo(d.due) <= 0 ? 'overdue by' : 'remaining' }}</span>
    </span>
  </button>
</template>

<style scoped>
.dl-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: center; width: 100%; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; padding: 0; }
.dl-hero:hover .name { text-decoration: underline dotted; }
.what { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pill { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; padding: 1px 6px; border: 1px solid currentColor; border-radius: 2px; }
.name { font-weight: 600; font-size: 22px; line-height: 28px; }
.meta { display: flex; align-items: center; gap: 8px; }
.clock { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.inst-big { font-size: 48px; line-height: 50px; }
@media (max-width: 700px) {
  .dl-hero { gap: 10px; }
  .name { font-size: 18px; line-height: 24px; }
  .inst-big { font-size: 30px; line-height: 34px; }
}
</style>

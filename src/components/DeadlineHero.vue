<script setup>
// Headline for one deadline: what's due on the left, a big ticking countdown on the right.
// The countdown runs to the internal (personal) target while it still stands — not passed yet —
// else to the hard due date. Used by the S-01 deadline card and the top of S-21.
// Click opens the deadline dialog.
import { computed } from 'vue'
import { ui, todayISO, relDay, fmtSlash } from '../store'
import { minsTo, bigCountdown, urgency, dueStatus, effDue } from '../glance'
import Chip from './Chip.vue'

const props = defineProps({ d: { type: Object, required: true }, label: { type: String, default: 'Next deadline' } })
const today = computed(() => { void ui.now; return todayISO() })
const int = computed(() => props.d.internal ?? '')
/** The internal target is the live deadline while its time hasn't passed yet. */
const intActive = computed(() => !!int.value && int.value >= today.value)
/** Moment the countdown actually targets: internal date (end of that day) or the hard due date. */
const eff = computed(() => effDue(props.d))
</script>

<template>
  <button class="dl-hero" title="Open the deadline" @click="ui.deadlineId = d.id">
    <span class="what">
      <span class="inst-lbl"><span class="tiny upper muted">{{ label }}</span><span class="pill mono" :class="urgency(eff)">{{ dueStatus(eff) }}</span></span>
      <span class="name clamp2">{{ d.title }}</span>
      <span class="meta mono small muted">
        <template v-if="intActive"><span class="int" title="Internal deadline (yours)">INT·{{ relDay(int, today) }} {{ fmtSlash(int) }}</span><span title="Hard due date">hard {{ relDay(d.due.slice(0, 10), today) }} {{ d.due.slice(11) }}</span></template>
        <template v-else>{{ relDay(d.due.slice(0, 10), today) }} · {{ d.due.slice(11) }}<span v-if="d.internal" class="int" :title="'Internal deadline (yours)'"> · INT {{ d.internal }}</span></template>
        <Chip v-if="d.source" :id="d.source" />
      </span>
    </span>
    <span class="clock">
      <span class="inst-big mono" :class="urgency(eff)">{{ bigCountdown(eff) }}</span>
      <span class="small muted">{{ minsTo(eff) <= 0 ? 'overdue by' : 'remaining' }}</span>
    </span>
  </button>
</template>

<style scoped>
.dl-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: center; width: 100%; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; padding: 0; }
.dl-hero:hover .name { text-decoration: underline dotted; }
.what { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pill { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; padding: 1px 6px; border: 1px solid currentColor; border-radius: 2px; }
.name { font-weight: 600; font-size: 22px; line-height: 28px; }
.meta .int { color: var(--info); }
.meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.clock { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.inst-big { font-size: 48px; line-height: 50px; }
@media (max-width: 700px) {
  .dl-hero { gap: 10px; }
  .name { font-size: 18px; line-height: 24px; }
  .inst-big { font-size: 30px; line-height: 34px; }
}
</style>

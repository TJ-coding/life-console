<script setup>
// Backlog-only mode (ISS-16): what this week's backlog is *for* — open deadlines within
// two weeks and the nearest goal milestones. Click a row to open it.
import { computed } from 'vue'
import { state, ui, todayISO, addDays, wd } from '../store'
import { countdown, urgency, inDays, sigState } from '../glance'
import Prio from './Prio.vue'

const until = computed(() => addDays(addDays(todayISO(), -21), 28)) // pulled week + the next 3: plan ahead, keep the list short
const dls = computed(() => state.deadlines
  .filter((d) => !d.done && d.due.slice(0, 10) >= addDays(todayISO(), -2) && d.due.slice(0, 10) <= until.value)
  .sort((a, b) => a.due.localeCompare(b.due)))

/* nearest goal time bounds across active plans, PSgs + SIGs, within two weeks */
const goals = computed(() => state.plans.filter((p) => p.status === 'active').flatMap((p) => [
  ...p.sigs.filter((s) => s.status !== 'done' && s.timeBound && /^\d{4}-\d{2}-\d{2}$/.test(s.timeBound))
    .map((s) => ({ id: s.no, title: s.name, due: s.timeBound, kind: 'sig', plan: p.id })),
  ...p.psgs.filter((g) => g.timeBound && /^\d{4}-\d{2}-\d{2}$/.test(g.timeBound))
    .map((g) => ({ id: g.no, title: g.name, due: g.timeBound, kind: 'psg', plan: p.id })),
]).filter((g) => g.due >= todayISO() && g.due <= until.value)
  .sort((a, b) => a.due.localeCompare(b.due)).slice(0, 8))

const open = (id) => { ui.deadlineId = id }
</script>

<template>
  <aside class="ctx">
    <header class="h row">
      <span class="icon sm">flag</span><b>What this week is for</b>
      <span class="spacer"></span>
      <span class="tiny muted mono">≤ 2 wks</span>
    </header>
    <div v-if="dls.length" class="sec-h tiny upper muted">Deadlines</div>
    <div v-for="d in dls" :key="d.id" class="row dl" :title="`Open ${d.id}`" @click="open(d.id)">
      <span class="mono small cd" :class="urgency(d.due)">{{ countdown(d.due) }}</span>
      <span class="grow ellipsis">{{ d.title }}</span>
      <Prio :p="d.priority" />
    </div>
    <div v-if="!dls.length" class="small muted pad">No deadlines in the next two weeks.</div>

    <div v-if="goals.length" class="sec-h tiny upper muted">Goal milestones</div>
    <div v-for="g in goals" :key="g.id" class="row dl gl" :class="sigState({ timeBound: g.due, status: 'doing' })" :title="`${g.plan} · ${g.kind === 'sig' ? 'SIG' : 'PSG'}`">
      <span class="mono small cd">{{ inDays(g.due) || 'today' }}</span>
      <span class="grow ellipsis"><span class="mono">{{ g.id }}</span> {{ g.title }}</span>
    </div>
    <div v-if="!dls.length && !goals.length" class="small pad">Nothing due soon — pure capacity week.</div>
    <p class="small muted tip">Add backlog tasks that feed these. Click ✚ Backlog-only again (or the arrow) to go back to the week.</p>
  </aside>
</template>

<style scoped>
.ctx { display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-left: 1px solid var(--border); overflow: auto; }
.h { gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; position: sticky; top: 0; background: var(--surface); z-index: 1; }
.sec-h { padding: 12px 12px 4px; }
.dl { gap: 10px; padding: 5px 12px; cursor: pointer; font-size: 13px; min-height: 30px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
.dl:hover { background: var(--surface-2); }
.cd { width: 64px; font-weight: 700; }
.gl.done, .gl.late .cd { color: var(--danger); }
.pad { padding: 6px 12px; }
.tip { padding: 10px 12px 14px; margin-top: auto; border-top: 1px solid var(--border); }
</style>

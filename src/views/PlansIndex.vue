<script setup>
// S-35 · Plans index — every strategic plan at a glance; create, pause, archive or delete.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { state, todayISO, planPct, nextCheckDate, relDay, diffDays, planIds, deletePlan, toast } from '../store'
import PlanTabs from '../components/PlanTabs.vue'

const router = useRouter()
const T = computed(() => todayISO())
const ORDER = { active: 0, paused: 1, archived: 2 }
const plans = computed(() => [...state.plans].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.planNo.localeCompare(b.planNo)))
const stats = (p) => {
  const ids = new Set(planIds(p))
  const todos = state.todos.filter((t) => t.links.some((l) => ids.has(l)))
  return {
    sigsDone: p.sigs.filter((s) => s.status === 'done').length,
    openTodos: todos.filter((t) => !t.done).length,
    linkedTodos: todos.length,
  }
}
function remove(p) {
  const s = stats(p)
  const extra = s.linkedTodos ? `\n\n${s.linkedTodos} task(s) link to its goals; they'll keep the links but the goals will be gone.` : ''
  if (!confirm(`Delete ${p.planNo} "${p.title}" with its ${p.psgs.length} PSGs and ${p.sigs.length} SIGs?${extra}\n\nTip: Archive keeps it out of the way without deleting.`)) return
  deletePlan(p.id)
  toast(`Deleted ${p.planNo}`)
}
const pctClass = (n) => (n >= 70 ? '' : n >= 40 ? 'info' : 'warn')
</script>

<template>
  <div class="pi">
    <PlanTabs />
    <div class="grid">
      <article v-for="p in plans" :key="p.id" class="panel card" :class="p.status" @click="router.push(`/strategy/${p.id}`)">
        <header class="row">
          <span class="mono plan-no">{{ p.planNo }}</span>
          <span class="spacer"></span>
          <select v-model="p.status" class="select sm mono" title="Status" @click.stop>
            <option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
          </select>
        </header>
        <h2>{{ p.title || 'Untitled plan' }}</h2>
        <p class="small muted intent">{{ p.intent || 'No intent written yet.' }}</p>
        <div class="row mono small"><span class="muted">progress</span><span class="spacer"></span><b>{{ planPct(p) }}%</b></div>
        <div class="bar" :class="pctClass(planPct(p))"><i :style="{ width: planPct(p) + '%' }"></i></div>
        <div class="facts mono small">
          <span><b>{{ p.psgs.length }}</b> PSGs</span>
          <span><b>{{ stats(p).sigsDone }}/{{ p.sigs.length }}</b> SIGs done</span>
          <span><b>{{ stats(p).openTodos }}</b> open tasks</span>
        </div>
        <div class="row small">
          <span class="icon sm muted">event_repeat</span>
          <span class="muted">next check</span>
          <b class="mono" :class="p.status === 'active' && diffDays(T, nextCheckDate(p)) <= 1 ? 'warn' : ''">{{ nextCheckDate(p) }} · {{ relDay(nextCheckDate(p), T) }}</b>
          <span class="spacer"></span>
          <button class="btn sm icon-only danger-ghost" title="Delete plan" @click.stop="remove(p)"><span class="icon sm">delete</span></button>
        </div>
      </article>
      <div v-if="!plans.length" class="empty">No strategic plans yet. Use <b>+ New plan</b> above.</div>
    </div>
    <p class="small muted note">Goal numbers (PSG-nn / SIG-nn.m) are unique across all plans, so tasks can link to any plan's goals. Paused and archived plans drop out of Today's goals and reviews.</p>
  </div>
</template>

<style scoped>
.pi { display: flex; flex-direction: column; min-height: 100%; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; padding: 16px; }
.card { padding: 14px 16px; gap: 8px; cursor: pointer; border-left: 3px solid var(--accent); }
.card:hover { border-color: var(--accent); }
.card.paused { border-left-color: var(--warn); }
.card.archived { border-left-color: var(--muted); opacity: 0.6; }
.plan-no { font-weight: 700; color: var(--accent); }
.paused .plan-no { color: var(--warn); }
.archived .plan-no { color: var(--muted); }
h2 { margin: 0; font-size: 17px; line-height: 22px; }
.intent { margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 16px; height: 32px; }
.facts { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); }
.facts b { color: var(--text); }
.select.sm { height: 24px; font-size: 11px; padding: 0 4px; }
.note { padding: 0 16px 16px; }
</style>

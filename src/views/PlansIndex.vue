<script setup>
// S-35 · Strategy overview — every active goal at a glance; plan management below.
// Questions, in order (docs/DESIGN.md): which goal is behind? what's the next milestone, and how long do I have?
// what should I work on next for each goal? when is the next plan check?
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { state, ui, todayISO, planPct, nextCheckDate, relDay, diffDays, planIds, deletePlan, toast, activePlans } from '../store'
import { psgGlance, nextMilestone, sigState, daysTo, inDays, minsTo, countdown, urgency, openDeadlines } from '../glance'
import PlanTabs from '../components/PlanTabs.vue'
import Prio from '../components/Prio.vue'

const router = useRouter()
const T = computed(() => todayISO())

/* ── goals at a glance ── */
const plansAtGlance = computed(() => activePlans().map((p) => ({
  plan: p,
  pct: planPct(p),
  check: nextCheckDate(p),
  goals: [...p.psgs].sort((a, b) => a.priority - b.priority).map(psgGlance),
})))
const behindCount = computed(() => plansAtGlance.value.reduce((n, x) => n + x.goals.filter((g) => g.behind).length, 0))
const milestone = computed(() => nextMilestone())
const msClass = (days) => (days < 0 ? 'danger' : days <= 7 ? 'warn' : 'ok')
const msBig = (days) => (days < 0 ? `${-days}d` : days === 0 ? 'today' : `${days}d`)
const openGoal = (plan, no) => router.push({ path: `/strategy/${plan.id}`, query: { goal: no } })
/** The soonest open deadline whose source is exactly this goal number. */
const deadlineFor = (no) => openDeadlines().find((d) => d.source === no) ?? null
const sigTitle = (s) => `${s.no} ${s.name} · ${s.pct ?? 0}%${s.timeBound ? ' · ' + s.timeBound : ''}`

/* ── plan management (all plans, any status) ── */
const ORDER = { active: 0, paused: 1, archived: 2 }
const plans = computed(() => [...state.plans].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.planNo.localeCompare(b.planNo)))
const stats = (p) => {
  const ids = new Set(planIds(p))
  const todos = state.todos.filter((t) => t.links.some((l) => ids.has(l)))
  return { sigsDone: p.sigs.filter((s) => s.status === 'done').length, openTodos: todos.filter((t) => !t.done).length, linkedTodos: todos.length }
}
function remove(p) {
  const s = stats(p)
  const extra = s.linkedTodos ? `\n\n${s.linkedTodos} task(s) link to its goals; they'll keep the links but the goals will be gone.` : ''
  if (!confirm(`Delete ${p.planNo} "${p.title}" with its ${p.psgs.length} PSGs and ${p.sigs.length} SIGs?${extra}\n\nTip: Archive keeps it out of the way without deleting.`)) return
  deletePlan(p.id)
  toast(`Deleted ${p.planNo}`)
}
</script>

<template>
  <div class="pi">
    <PlanTabs />

    <!-- headline: the nearest milestone, and how many goals are behind -->
    <section v-if="milestone" class="panel inst hero" :class="'u-' + msClass(milestone.days)">
      <button class="hero-b" title="Open this goal" @click="openGoal(milestone.plan, milestone.sig.no)">
        <span class="what">
          <span class="inst-lbl">
            <span class="tiny upper muted">Next milestone</span>
            <span class="pill mono" :class="msClass(milestone.days)">{{ milestone.days < 0 ? 'LATE' : milestone.days === 0 ? 'DUE TODAY' : `IN ${milestone.days} DAYS` }}</span>
            <span v-if="behindCount" class="pill mono danger">{{ behindCount }} GOAL{{ behindCount > 1 ? 'S' : '' }} BEHIND</span>
          </span>
          <span class="name clamp2"><span class="mono no">{{ milestone.sig.no }}</span> {{ milestone.sig.name }}</span>
          <span class="mono small muted">{{ milestone.sig.timeBound }} · {{ milestone.sig.psg }} · {{ milestone.plan.planNo }} · {{ milestone.sig.pct ?? 0 }}% done</span>
        </span>
        <span class="clock">
          <span class="inst-big mono" :class="msClass(milestone.days)">{{ msBig(milestone.days) }}</span>
          <span class="small muted">{{ milestone.days < 0 ? 'late' : 'to go' }}</span>
        </span>
      </button>
    </section>

    <!-- every active goal: one row each -->
    <section v-for="x in plansAtGlance" :key="x.plan.id" class="panel plan">
      <div class="panel-h plan-h">
        <span class="mono plan-no">{{ x.plan.planNo }}</span>
        <h2 class="plan-title ellipsis">{{ x.plan.title }}</h2>
        <span class="plan-bar bar"><i :style="{ width: x.pct + '%' }"></i></span>
        <span class="mono small">{{ x.pct }}%</span>
        <span class="spacer"></span>
        <span class="mono small" :class="diffDays(T, x.check) <= 1 ? 'warn' : 'muted'"><span class="icon sm">event_repeat</span> check {{ relDay(x.check, T).toLowerCase() }}</span>
        <router-link :to="`/strategy/${x.plan.id}`" class="btn sm">Open<span class="icon sm">chevron_right</span></router-link>
      </div>
      <template v-for="g in x.goals" :key="g.no">
        <!-- PSG -->
        <div class="goal psg-row" :class="{ behind: g.behind }" role="link" tabindex="0" @click="openGoal(x.plan, g.no)" @keydown.enter="openGoal(x.plan, g.no)">
          <span class="g-id"><Prio :p="g.priority" /><span class="mono g-no">{{ g.no }}</span></span>
          <span class="g-name"><span class="ttl ellipsis">{{ g.name }}</span><span v-if="g.behind" class="pill mono danger">BEHIND</span></span>
          <span class="g-prog"><span class="bar" :class="g.behind ? 'danger' : ''"><i :style="{ width: g.pct + '%' }"></i></span><b class="mono">{{ g.pct }}%</b></span>
          <span class="g-info small muted ellipsis">{{ g.indicators }}</span>
          <span class="g-dl"><button v-if="deadlineFor(g.no)" class="dl mono small" :class="urgency(deadlineFor(g.no).due)" :title="`Deadline: ${deadlineFor(g.no).title}`" @click.stop="ui.deadlineId = deadlineFor(g.no).id"><span class="icon sm">alarm</span>{{ minsTo(deadlineFor(g.no).due) <= 0 ? 'overdue' : countdown(deadlineFor(g.no).due) }}</button></span>
          <span class="g-tb mono small muted" :title="g.timeBound ? `Time bound: ${g.timeBound}` : ''">
            <template v-if="daysTo(g.timeBound) !== null">{{ g.timeBound.slice(5).replace('-', '/') }} · <span :class="{ danger: g.pct < 100 && daysTo(g.timeBound) < 0 }">{{ inDays(g.timeBound) }}</span></template>
            <template v-else>{{ g.timeBound || '—' }}</template>
          </span>
        </div>
        <!-- its SIGs -->
        <div v-for="sg in g.sigs" :key="sg.no" class="goal sig-row" :class="['st-' + sigState(sg), { next: g.next && g.next.no === sg.no }]" role="link" tabindex="0" @click="openGoal(x.plan, sg.no)" @keydown.enter="openGoal(x.plan, sg.no)">
          <span class="g-id"><span class="mono s-no">{{ sg.no }}</span></span>
          <span class="g-name"><span class="s-name ellipsis">{{ sg.name }}</span><span v-if="g.next && g.next.no === sg.no" class="pill mono info">NEXT</span></span>
          <span class="g-prog"><span class="bar thin" :class="sigState(sg) === 'late' ? 'danger' : ''"><i :style="{ width: (sg.pct ?? 0) + '%' }"></i></span><span class="mono small">{{ sg.pct ?? 0 }}%</span></span>
          <span class="g-info small muted ellipsis">{{ sg.criteria }}</span>
          <span class="g-dl"><button v-if="deadlineFor(sg.no)" class="dl mono small" :class="urgency(deadlineFor(sg.no).due)" :title="`Deadline: ${deadlineFor(sg.no).title}`" @click.stop="ui.deadlineId = deadlineFor(sg.no).id"><span class="icon sm">alarm</span>{{ minsTo(deadlineFor(sg.no).due) <= 0 ? 'overdue' : countdown(deadlineFor(sg.no).due) }}</button></span>
          <span class="g-tb mono small" :class="{ danger: sigState(sg) === 'late', warn: sigState(sg) === 'soon', ok: sigState(sg) === 'done', muted: sigState(sg) === 'ok' }">
            <template v-if="sigState(sg) === 'done'">done ✓</template>
            <template v-else-if="daysTo(sg.timeBound) !== null">{{ sg.timeBound.slice(5).replace('-', '/') }} · {{ inDays(sg.timeBound) }}</template>
            <template v-else>{{ sg.timeBound || '—' }}</template>
          </span>
        </div>
      </template>
      <div v-if="!x.goals.length" class="empty">No goals yet. <router-link :to="`/strategy/${x.plan.id}`">Add a PSG</router-link>.</div>
    </section>
    <div v-if="!plansAtGlance.length" class="panel empty-plans">No active plan. Activate one below or use <b>+ New plan</b> above.</div>

    <!-- plan management -->
    <h3 class="tiny upper muted all-h">All plans</h3>
    <div class="grid">
      <article v-for="p in plans" :key="p.id" class="panel card" :class="p.status" @click="router.push(`/strategy/${p.id}`)">
        <header class="row">
          <span class="mono plan-no">{{ p.planNo }}</span>
          <span class="ellipsis grow card-title">{{ p.title || 'Untitled plan' }}</span>
          <select v-model="p.status" class="select sm mono" title="Status" @click.stop>
            <option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
          </select>
        </header>
        <div class="facts mono small">
          <span><b>{{ planPct(p) }}%</b></span>
          <span><b>{{ p.psgs.length }}</b> PSGs</span>
          <span><b>{{ stats(p).sigsDone }}/{{ p.sigs.length }}</b> SIGs</span>
          <span><b>{{ stats(p).openTodos }}</b> open tasks</span>
          <span class="spacer"></span>
          <button class="btn sm icon-only danger-ghost" title="Delete plan" @click.stop="remove(p)"><span class="icon sm">delete</span></button>
        </div>
      </article>
    </div>
    <p class="small muted note">Goal numbers (PSG-nn / SIG-nn.m) are unique across all plans, so tasks can link to any plan's goals. Paused and archived plans drop out of the overview, Today and reviews.</p>
  </div>
</template>

<style scoped>
.pi { display: flex; flex-direction: column; gap: 12px; min-height: 100%; padding-bottom: 16px; }
.pi > .panel, .all-h, .grid, .note { margin: 0 16px; }
.hero { margin-top: 4px; padding: 16px 20px; border-left: 3px solid var(--border); }
.hero.u-warn { border-left-color: var(--warn); }
.hero.u-danger { border-left-color: var(--danger); background: color-mix(in srgb, var(--danger) 5%, var(--surface)); }
.hero-b { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: center; width: 100%; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; padding: 0; }
.hero-b:hover .name { text-decoration: underline dotted; }
.what { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.clock { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.inst-big { font-size: 48px; line-height: 50px; }
.name { font-weight: 600; font-size: 22px; line-height: 28px; }
.name .no { color: var(--info); font-size: 18px; }
.pill { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; padding: 1px 6px; border: 1px solid currentColor; border-radius: 2px; white-space: nowrap; }
/* plan section */
.plan-h { gap: 10px; }
.plan-no { font-weight: 700; color: var(--accent); white-space: nowrap; }
.plan-title { font-size: 15px; text-transform: none; letter-spacing: 0; max-width: 40%; }
.plan-bar { width: 120px; flex: none; }
.plan-h .icon { vertical-align: -3px; }
/* one row per goal; its SIGs indented below */
.goal {
  display: grid; align-items: center; gap: 16px; padding: 0 14px; border-bottom: 1px solid var(--border); cursor: pointer;
  grid-template-columns: 112px minmax(220px, 1.3fr) 200px minmax(160px, 1.4fr) 96px 130px;
  border-left: 3px solid transparent;
}
.goal:hover { background: var(--surface-2); }
.psg-row { min-height: 54px; background: color-mix(in srgb, var(--surface-2) 45%, transparent); }
.psg-row.behind { border-left-color: var(--danger); }
.sig-row { min-height: 40px; }
.sig-row .g-id { padding-left: 22px; }
.sig-row.st-late { border-left-color: var(--danger); }
.sig-row.next { border-left-color: var(--info); }
.sig-row.st-done .s-name { color: var(--muted); }
.g-id { display: flex; align-items: center; gap: 8px; }
.g-no { color: var(--accent); font-size: 13px; }
.s-no { color: var(--info); font-size: 12px; }
.g-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ttl { font-size: 16px; font-weight: 600; }
.s-name { font-size: 14px; }
.g-prog { display: flex; align-items: center; gap: 8px; }
.g-prog .bar { flex: 1; }
.bar.thin { height: 4px; }
.g-prog > b, .g-prog > .mono { width: 40px; text-align: right; }
.g-prog b { font-size: 14px; }
.g-info { min-width: 0; }
.pill.info { color: var(--info); }
.g-dl { display: flex; justify-content: flex-end; }
.dl { display: inline-flex; align-items: center; gap: 4px; border: 1px solid currentColor; border-radius: 2px; background: transparent; padding: 1px 6px; font: inherit; cursor: pointer; }
.dl.ok { color: var(--muted); }
.g-tb { text-align: right; white-space: nowrap; }
.empty-plans { padding: 16px; color: var(--muted); }
/* management */
.all-h { margin-top: 8px; margin-bottom: -4px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
.card { padding: 10px 14px; gap: 6px; cursor: pointer; border-left: 3px solid var(--accent); }
.card:hover { border-color: var(--accent); }
.card.paused { border-left-color: var(--warn); }
.card.archived { border-left-color: var(--muted); opacity: 0.6; }
.card-title { font-weight: 600; }
.paused .plan-no { color: var(--warn); }
.archived .plan-no { color: var(--muted); }
.facts { display: flex; align-items: center; gap: 14px; color: var(--muted); }
.facts b { color: var(--text); }
.select.sm { height: 24px; font-size: 11px; padding: 0 4px; }
@media (max-width: 1300px) {
  .goal { grid-template-columns: 100px minmax(160px, 1fr) 160px 96px 120px; }
  .g-info { display: none; }
}
@media (max-width: 700px) {
  .pi > .panel, .all-h, .grid, .note { margin: 0 12px; }
  .hero { padding: 14px; }
  .hero-b { gap: 10px; }
  .name { font-size: 18px; line-height: 24px; }
  .inst-big { font-size: 30px; line-height: 34px; }
  .plan-title { max-width: none; }
  .plan-bar { display: none; }
  .goal { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 8px 12px; }
  .g-id { grid-column: 1; }
  .g-tb { grid-column: 2; grid-row: 1; }
  .g-name, .g-prog { grid-column: 1 / -1; }
  .g-dl { grid-column: 1 / -1; justify-content: flex-start; }
  .g-dl:empty { display: none; }
  .sig-row .g-id, .sig-row .g-name { padding-left: 12px; }
}
</style>

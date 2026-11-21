<script setup>
// ISS-46 / ISS-43: where a task sits in the big picture, on top of its card —
// deadline › plan / goal › parent task(s) (IDs; names on hover, the parent task's name shown) — and every step is a way there: a deadline opens its
// dialog, a goal or plan opens Strategy at it, a parent task opens its drawer.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { state, ui, linkType, linkLabel, ancestorsOf, trailLinks, planOfLink } from '../store'

const props = defineProps({ todo: { type: Object, required: true }, inline: Boolean, full: Boolean }) // full: every step's name, wrapping (the task drawer)
const router = useRouter()
const steps = computed(() => [
  ...trailLinks(props.todo).map((id) => {
    const type = linkType(id)
    if (type === 'deadline') {
      const d = state.deadlines.find((x) => x.id === id)
      return { key: id, type, icon: 'flag', id, label: d?.title ?? '', title: d ? `Deadline ${id}: ${d.title} · due ${d.due.replace('T', ' ')} — open` : id }
    }
    const plan = planOfLink(id)
    return { key: id, type, icon: type === 'plan' ? 'map' : 'flag_circle', id, label: type === 'plan' ? plan?.title ?? '' : linkLabel(id), title: plan ? `${id}${linkLabel(id) ? ' ' + linkLabel(id) : ''} — open in Strategy (${plan.planNo})` : id, plan }
  }),
  ...ancestorsOf(props.todo).reverse().map((a) => ({ key: a.id, type: 'task', icon: 'subdirectory_arrow_right', id: a.id, label: a.title, title: `Open ${a.id} ${a.title}` })),
])
function go(s) {
  if (s.type === 'deadline') ui.deadlineId = s.id
  else if (s.type === 'task') ui.drawerId = s.id
  else if (s.plan) router.push(s.type === 'plan' ? `/strategy/${s.plan.id}` : { path: `/strategy/${s.plan.id}`, query: { goal: s.id } })
}
</script>

<template>
  <div v-if="steps.length" class="trail" :class="{ inline, full }">
    <span v-for="(s, i) in steps" :key="s.key" class="step" :class="{ shrink: s.type === 'task' }">
      <button type="button" class="st" :class="s.type" :title="s.title" @click.stop="go(s)" @dblclick.stop>
        <span class="icon">{{ s.icon }}</span><span class="mono sid">{{ s.id }}</span><span v-if="s.label && (full || (s.type === 'task' && !inline))" class="lb">{{ s.label }}</span>
      </button><span v-if="i < steps.length - 1" class="sep">›</span>
    </span>
  </div>
</template>

<style scoped>
.trail { display: flex; align-items: center; gap: 3px; min-width: 0; overflow: hidden; white-space: nowrap; font-size: 11px; }
/* Backlog by week: IDs only, before the title */
.trail.inline { display: inline-flex; vertical-align: middle; margin-right: 6px; flex: none; max-width: 50%; }
/* the task drawer: every step's name; whole steps wrap to the next line */
.trail.full { flex-wrap: wrap; row-gap: 2px; font-size: 12px; }
.step { display: inline-flex; align-items: center; gap: 3px; flex: none; max-width: 100%; }
.step.shrink { flex: 0 1 auto; min-width: 0; } /* on a card, a parent task's name gives way first (…) */
.trail.full .step { flex: none; }
.sep { color: var(--muted); flex: none; }
.st { display: inline-flex; align-items: center; gap: 3px; min-width: 0; max-width: 100%; white-space: nowrap; padding: 1px 4px; border: 1px solid transparent; border-radius: 2px; background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
.trail:not(.inline):not(.full) .st { margin-left: -4px; } /* flush with the card's text */
.trail.full { margin-left: -4px; } /* the drawer: shift the whole trail (a margin on each step squeezes its name) */
.st:hover { border-color: var(--info); color: var(--text); }
.st .icon { font-size: 13px; flex: none; }
.trail.full .st .icon { font-size: 14px; }
.sid { flex: none; }
.lb { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* the link chips' colours: deadlines and plans amber, goals accent */
.st.deadline, .st.plan { color: var(--warn); }
.st.goal { color: var(--accent); }
.st.task .lb { color: var(--text); }
</style>

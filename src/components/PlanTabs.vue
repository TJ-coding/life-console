<script setup>
// Tab strip across the Strategy screens: All plans · one tab per plan · + New plan.
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { state, createPlan, planPct, toast } from '../store'

const route = useRoute()
const router = useRouter()
const showArchived = ref(false)
const tabs = computed(() => state.plans.filter((p) => p.status !== 'archived' || p.id === route.params.planId || showArchived.value))
const archivedCount = computed(() => state.plans.filter((p) => p.status === 'archived').length)

const adding = ref(false)
const title = ref('')
const input = ref(null)
async function startAdd() {
  adding.value = true
  await nextTick()
  input.value?.focus()
}
function add() {
  const p = createPlan(title.value.trim() || 'New strategic plan')
  title.value = ''
  adding.value = false
  toast(`Created ${p.planNo}`)
  router.push(`/strategy/${p.id}`)
}
</script>

<template>
  <nav class="plantabs" aria-label="Strategic plans">
    <router-link to="/strategy" class="tab" :class="{ on: !route.params.planId }"><span class="icon sm">grid_view</span>All plans</router-link>
    <router-link v-for="p in tabs" :key="p.id" :to="`/strategy/${p.id}`" class="tab" :class="{ on: route.params.planId === p.id, [p.status]: true }" :title="`${p.planNo} · ${p.title} (${p.status})`">
      <span class="dot"></span><span class="mono">{{ p.planNo }}</span><span class="ttl ellipsis">{{ p.title }}</span><span class="mono pct">{{ planPct(p) }}%</span>
    </router-link>
    <button v-if="archivedCount" class="tab ghost" @click="showArchived = !showArchived">{{ showArchived ? 'Hide' : 'Show' }} archived ({{ archivedCount }})</button>
    <form v-if="adding" class="add" @submit.prevent="add">
      <input ref="input" v-model="title" class="input" placeholder="Plan title, e.g. Health & fitness 2027" @keydown.esc="adding = false" @blur="!title && (adding = false)" />
      <button class="btn sm primary" type="submit">Create</button>
    </form>
    <button v-else class="tab new" @click="startAdd"><span class="icon sm">add</span>New plan</button>
  </nav>
</template>

<style scoped>
.plantabs { display: flex; align-items: stretch; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--surface); overflow-x: auto; min-height: 40px; }
.tab { display: flex; align-items: center; gap: 6px; padding: 0 12px; color: var(--muted); border: 0; border-bottom: 2px solid transparent; background: transparent; cursor: pointer; white-space: nowrap; font: inherit; max-width: 280px; }
.tab:hover { color: var(--text); }
.tab.on { color: var(--text); border-bottom-color: var(--accent); }
.ttl { max-width: 160px; }
.pct { font-size: 11px; color: var(--muted); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
.paused .dot { background: var(--warn); }
.archived .dot { background: var(--muted); }
.archived .ttl { text-decoration: line-through; }
.new { color: var(--accent); }
.ghost { font-size: 11px; }
.add { display: flex; align-items: center; gap: 6px; padding: 0 8px; }
.add .input { width: 260px; height: 26px; }
</style>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { NAV, PLANNED } from '../nav'
const route = useRoute()
const mod = computed(() => NAV.find((n) => n.key === route.params.module))
const screens = computed(() => PLANNED[route.params.module] ?? [])
</script>
<template>
  <div class="ph">
    <section class="panel">
      <div class="panel-h"><span class="icon ok">{{ mod?.icon ?? 'help' }}</span><h2>{{ mod?.label ?? route.params.module }}</h2><span class="spacer"></span><span class="chip">NOT IN PROTOTYPE</span></div>
      <div class="panel-b col">
        <p class="muted">This module isn't built yet. It's planned in the spec with these screens:</p>
        <div v-for="s in screens" :key="s" class="scr mono">{{ s }}</div>
        <p class="small muted">Built so far: <router-link to="/">S-01 Today</router-link> · <router-link to="/week">S-10 Weekly Planner</router-link> · <router-link to="/todos">S-20 Todo Inbox</router-link> · <router-link to="/strategy">S-30 Strategic Plan</router-link></p>
      </div>
    </section>
  </div>
</template>
<style scoped>
.ph { padding: 16px; max-width: 760px; }
.scr { border: 1px dashed var(--border); border-radius: 2px; padding: 8px 10px; }
</style>

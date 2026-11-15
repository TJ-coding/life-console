<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { registry } from '../sdk'
import { edition, isEnabled, setAddOn } from '../edition'
const route = useRoute()
// a module that's registered but not built yet lists the spec's planned screens (modules/<id>/index.js `planned`)
const mod = computed(() => registry.nav.find((n) => n.key === route.params.module))
const screens = computed(() => registry.byId[route.params.module]?.planned ?? [])
// registered but not part of this edition: say so, and offer it (a notification or a link from another console
// never dead-ends)
const hidden = computed(() => !!registry.byId[route.params.module] && !isEnabled(route.params.module))
const add = () => setAddOn(route.params.module, true)
</script>
<template>
  <div class="ph">
    <section v-if="hidden" class="panel">
      <div class="panel-h"><span class="icon ok">{{ mod?.icon ?? 'help' }}</span><h2>{{ mod?.label ?? route.params.module }}</h2></div>
      <div class="panel-b col">
        <p>{{ mod?.label ?? route.params.module }} isn't part of {{ edition.name }}.</p>
        <p class="small muted">Adding it puts it in the menu of this console. Your planner stays the same; you can take it away again in Settings → Console.</p>
        <div class="row"><button class="btn primary" @click="add"><span class="icon sm">add</span>Add it</button></div>
      </div>
    </section>
    <section v-else class="panel">
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

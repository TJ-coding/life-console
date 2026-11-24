<script setup>
// A place in a screen that plugins can fill (platform/plugins-sdk.md "Slots"): today.card, todo.panel, week.strip,
// settings.section, strategy.goal. Renders nothing when no installed, enabled plugin fills it.
import { computed } from 'vue'
import { registry } from '../sdk'
import { isEnabled } from '../edition'
import PluginPart from './PluginPart.vue'

const props = defineProps({ name: { type: String, required: true }, data: { type: Object, default: () => ({}) } })
const parts = computed(() => (registry.slots?.[props.name] ?? []).filter((p) => isEnabled(p.module)))
</script>
<template>
  <div v-if="parts.length" class="plugin-slot" :data-slot="name">
    <PluginPart v-for="p in parts" :key="p.module" :part="p.part" :module="p.module" :data="data" />
  </div>
</template>

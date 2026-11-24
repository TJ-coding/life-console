<script setup>
// A Public plugin's page (/m/<name>): its part, mounted in a box, with the console's frame around it.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PluginPart from '../components/PluginPart.vue'
const route = useRoute()
const part = computed(() => route.meta.part)
</script>
<template>
  <div class="plugin-page">
    <PluginPart v-if="part" :key="route.fullPath" :part="part" :module="route.meta.module" :data="{ params: route.params, query: route.query }" />
  </div>
</template>
<style scoped>
.plugin-page { padding: 16px; }
</style>

<script setup>
// Goal / deadline / plan links, shown everywhere as `SIG-01.2`-style chips.
// A tooltip carries the human name (`linkLabel`), and `removable` adds a ✕ (ISS-18).
import { computed } from 'vue'
import { linkType, linkLabel } from '../store'
const props = defineProps({ id: { type: String, required: true }, removable: { type: Boolean, default: false } })
const emit = defineEmits(['remove'])
const label = computed(() => linkLabel(props.id))
</script>
<template>
  <span class="chip" :class="linkType(id)" :title="label ? `${id} ${label}` : id">{{ id
    }}<button v-if="removable" class="chip-x icon" title="Remove this link" @click.stop="emit('remove', id)">close</button></span>
</template>
<style>
.chip { position: relative; }
.chip-x { position: absolute; top: -7px; right: -7px; width: 14px; height: 14px; font-size: 13px; line-height: 14px; padding: 0; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); color: var(--muted); cursor: pointer; display: none; z-index: 2; }
.chip:hover .chip-x, .chip:focus-within .chip-x { display: block; }
.chip-x:hover { color: var(--danger); border-color: var(--danger); }
</style>

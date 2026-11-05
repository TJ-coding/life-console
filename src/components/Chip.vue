<script setup>
import { linkType } from '../store'
defineProps({ id: { type: String, required: true } })
</script>
<template><span class="chip" :class="linkType(id)">{{ id }}</span></template>

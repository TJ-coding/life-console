<script setup>
defineProps({ p: { type: Number, required: true } })
</script>
<template><span class="prio" :class="'p' + p">P{{ p }}</span></template>

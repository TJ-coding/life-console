<script setup>
// One-line deadline capture with a live preview. `date` is the default due date (e.g. the day column).
import { computed, ref, onMounted } from 'vue'
import { parseDeadline, addDeadline, toast, wd, fmtSlash } from '../store'
import Chip from './Chip.vue'

const props = defineProps({ date: { type: String, required: true }, compact: Boolean, placeholder: String, autofocus: Boolean })
const emit = defineEmits(['added', 'cancel'])
const text = ref('')
const input = ref(null)
// the HTML autofocus attribute only works on page load, so focus inserted inputs explicitly
onMounted(() => { if (props.autofocus) input.value?.focus() })
const p = computed(() => parseDeadline(text.value, props.date))
function add() {
  if (!p.value.title) return
  const d = addDeadline({ title: p.value.title, vital: p.value.vital, due: `${p.value.date}T${p.value.time}`, source: p.value.source, priority: p.value.priority })
  toast(`${d.id} due ${wd(p.value.date)} ${fmtSlash(p.value.date)} ${p.value.time}`)
  text.value = ''
  emit('added', d)
}
</script>

<template>
  <form class="dqa" :class="{ compact }" @submit.prevent="add">
    <div class="in">
      <span class="icon sm plus">alarm_add</span>
      <input
        ref="input" v-model="text" class="mono"
        :placeholder="placeholder ?? (compact ? '+ deadline… 17:00 p1' : 'New deadline… due:fri 17:00 #NLP-610 p1 ! vital points')"
        title="Syntax: title · due:fri|11-20|tomorrow · 17:00 · p1–p5 · #source · ! vital points · Enter to add, Esc to cancel"
        @keydown.esc="text = ''; emit('cancel')"
      />
    </div>
    <div v-if="text" class="pv">
      <span class="pc"><b>{{ p.title || '—' }}</b></span>
      <span class="pc mono">{{ wd(p.date) }} {{ fmtSlash(p.date) }} {{ p.time }}</span>
      <span class="pc mono">P{{ p.priority }}</span>
      <Chip v-if="p.source" :id="p.source" />
      <span v-if="p.vital && !compact" class="pc">{{ p.vital }}</span>
    </div>
  </form>
</template>

<style scoped>
.dqa { display: flex; flex-direction: column; gap: 4px; }
.in { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface-2); }
.in:focus-within { border-color: var(--info); }
.in input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-size: 12px; }
.compact .in { height: 24px; }
.compact .in input { font-size: 10px; }
.compact .plus { font-size: 13px; }
.plus { color: var(--warn); }
.pv { display: flex; flex-wrap: wrap; gap: 4px; }
.pc { border: 1px solid var(--border); border-radius: 2px; padding: 0 5px; font-size: 10px; color: var(--muted); }
.pc b { color: var(--text); font-weight: 500; }
</style>

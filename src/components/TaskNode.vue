<script setup>
// One linked task in the strategy tree, with its open subtasks nested under it (any depth).
import { computed } from 'vue'
import { ui, toggleTodo, childrenOf, subCount } from '../store'

defineOptions({ name: 'TaskNode' })
const props = defineProps({ todo: { type: Object, required: true }, depth: { type: Number, default: 0 }, focus: { type: Set, default: null } })
// with a goal selected on the plan page: its tasks light up, the others dim
const fx = computed(() => (!props.focus ? '' : props.focus.has(props.todo.id) ? 'fx-rel' : 'fx-dim'))
const kids = computed(() => childrenOf(props.todo.id))
const open = computed(() => kids.value.filter((k) => !k.done))
const sub = computed(() => (kids.value.length ? subCount(props.todo) : null))
const fmtMin = (m) => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`)
</script>

<template>
  <div class="task" :class="[fx, { done: todo.done }]" :style="{ paddingLeft: 4 + depth * 14 + 'px' }" @click="ui.drawerId = todo.id">
    <span v-if="depth" class="muted mk">↳</span>
    <input type="checkbox" :checked="todo.done" :title="sub ? 'Mark it and all its subtasks done' : 'Mark done'" @click.stop @change="toggleTodo(todo.id)" />
    <span class="grow ellipsis" :title="todo.title">{{ todo.title }}</span>
    <span v-if="sub" class="mono tiny info" :title="`${sub.done} of ${sub.total} subtasks done`">{{ sub.done }}/{{ sub.total }}</span>
    <span v-else class="mono tiny muted">{{ fmtMin(todo.timeMin) }}</span>
  </div>
  <TaskNode v-for="k in open" :key="k.id" :todo="k" :depth="depth + 1" :focus="focus" />
</template>

<style scoped>
.task { display: flex; align-items: center; gap: 6px; min-height: 24px; font-size: 12.5px; cursor: pointer; border-radius: 2px; padding-right: 4px; }
.task:hover { background: var(--surface-2); }
.task input { margin: 0; }
.task.done .grow { text-decoration: line-through; color: var(--muted); }
.task.fx-rel { background: color-mix(in srgb, var(--info) 8%, transparent); }
.task.fx-dim { opacity: 0.32; }
.task.fx-dim:hover { opacity: 0.7; }
.mk { font-size: 11px; margin-right: -2px; }
</style>

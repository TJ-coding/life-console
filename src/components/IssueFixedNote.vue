<script setup>
// When issues you reported are fixed: a thank-you with confetti (like the tour's finish), what changed,
// and a request to check it. Looks good → seen. Not fixed → reopen it with a reply saying why.
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { issues, fixedUnseen, markSeen, replyIssue } from '../issues'
import { ui, toast } from '../store'
import { auth } from '../auth'
import { burst } from '../confetti'

const router = useRouter()
const canvas = ref(null)
const list = ref([]) // the issues this note is about (kept while it's open, even as they're handled)
const reopenFor = ref(null) // id whose "not fixed" form is open
const why = ref('')
const done = ref({}) // id → 'reopened'
const busy = ref(false)

const open = computed(() => list.value.length > 0)
const waiting = computed(() => (auth.status === 'signed-in' && !ui.tourOpen && !issues.dialog ? fixedUnseen() : []))
watch(waiting, async (w) => {
  if (open.value || !w.length) return
  list.value = [...w]
  await nextTick()
  burst(canvas.value, { alive: () => open.value })
}, { immediate: true })

function close() {
  markSeen(list.value.map((i) => i.id).filter((id) => !done.value[id]))
  list.value = []; reopenFor.value = null; why.value = ''; done.value = {}
}
function tryIt(i) {
  markSeen([i.id])
  close()
  router.push(i.route || '/')
}
async function reopen(i) {
  if (!why.value.trim()) return
  busy.value = true
  try {
    await replyIssue(i.id, why.value.trim(), true)
    done.value = { ...done.value, [i.id]: 'reopened' }
    reopenFor.value = null; why.value = ''
    toast(`${i.id} reopened · thanks for checking`)
  } catch (e) { toast(`Couldn't reopen: ${e.message}`) } finally { busy.value = false }
}
const startReopen = async (i) => { reopenFor.value = i.id; why.value = ''; await nextTick(); document.querySelector('.ifn-why')?.focus() }
function onKey(e) { if (e.key === 'Escape' && !reopenFor.value) close() }
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ifn-scrim" @keydown="onKey">
      <canvas ref="canvas" class="ifn-confetti"></canvas>
      <div class="ifn panel" role="dialog" aria-labelledby="ifn-h" tabindex="-1">
        <div class="ifn-top">
          <span class="icon ifn-ic">celebration</span>
          <div>
            <h2 id="ifn-h">{{ list.length === 1 ? 'Your report is fixed' : `${list.length} of your reports are fixed` }} — thank you!</h2>
            <p class="small muted">Life Console gets better every time you speak up. We're building it together.</p>
          </div>
        </div>
        <p class="small ask">Please give it a try. If it isn't fixed for you, reopen it and tell us what's still wrong.</p>
        <ul class="ifn-list">
          <li v-for="i in list" :key="i.id" :class="{ re: done[i.id] }">
            <div class="row hd">
              <span class="mono small muted">{{ i.id }}</span>
              <b class="grow">{{ i.title }}</b>
              <span v-if="i.screen" class="mono tiny muted">{{ i.screen }}</span>
            </div>
            <p v-if="i.resolution" class="small res"><span class="icon sm ok">task_alt</span>{{ i.resolution }}</p>
            <div v-if="done[i.id]" class="small info row"><span class="icon sm">replay</span>Reopened. Thanks for checking, we'll look again.</div>
            <div v-else-if="reopenFor === i.id" class="col why">
              <textarea v-model="why" class="textarea small ifn-why" rows="2" placeholder="What's still not right?" @keydown.esc.stop="reopenFor = null" @keydown.meta.enter="reopen(i)" @keydown.ctrl.enter="reopen(i)"></textarea>
              <div class="row"><span class="spacer"></span>
                <button class="btn sm" @click="reopenFor = null">Cancel</button>
                <button class="btn sm primary" :disabled="!why.trim() || busy" @click="reopen(i)"><span class="icon sm">replay</span>Reopen</button>
              </div>
            </div>
            <div v-else class="row acts">
              <button class="btn sm" @click="tryIt(i)"><span class="icon sm">open_in_new</span>Try it</button>
              <button class="btn sm ghost" @click="startReopen(i)"><span class="icon sm">sentiment_dissatisfied</span>Not fixed for me</button>
            </div>
          </li>
        </ul>
        <div class="row foot"><span class="spacer"></span><button class="btn primary" @click="close">Thanks!</button></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ifn-scrim { position: fixed; inset: 0; z-index: 230; display: flex; align-items: center; justify-content: center; padding: 16px; background: color-mix(in srgb, var(--bg) 60%, transparent); }
.ifn-confetti { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.ifn { position: relative; width: min(560px, 100%); max-height: calc(100dvh - 32px); overflow: auto; padding: 18px 18px 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4); }
.ifn-top { display: flex; gap: 12px; align-items: flex-start; }
.ifn-ic { font-size: 30px; color: var(--accent); flex: none; }
h2 { margin: 0 0 2px; font-size: 17px; }
.ifn-top p, .ask { margin: 0; }
.ifn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ifn-list li { border: 1px solid var(--border); border-radius: 2px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.ifn-list li.re { border-color: color-mix(in srgb, var(--info) 50%, var(--border)); }
.hd { gap: 8px; align-items: baseline; }
.res { margin: 0; display: flex; gap: 6px; color: var(--muted); }
.res .icon { flex: none; }
.acts { gap: 6px; }
.why { gap: 6px; }
.why textarea { width: 100%; }
.foot { padding-top: 2px; }
</style>

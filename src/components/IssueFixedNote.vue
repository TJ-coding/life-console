<script setup>
// When issues you reported are fixed: a thank-you with confetti (like the tour's finish), once, and then a
// checklist docked on the right that stays while you use the app until every fix is checked off:
// Try it (opens its screen) · ✓ Works (seen) · Not fixed (reopen it with a reply saying why).
// "Celebrated" is remembered per device so the confetti shows once; "checked" is the server's seenAt.
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { issues, fixedUnseen, markSeen, replyIssue } from '../issues'
import { ui, toast } from '../store'
import { auth } from '../auth'
import { burst } from '../confetti'

const CELEBRATED = 'life-console/fixes-celebrated' // ids the thank-you note has shown (per account: auth.js DATA_KEYS)
const MIN = 'life-console/fixes-min' // the checklist is minimised (a device preference)
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode: fine */ } }

const router = useRouter()
const canvas = ref(null)
const celebrated = ref(read(CELEBRATED, []))
const min = ref(read(MIN, false))
const reopenFor = ref(null) // id whose "not fixed" box is open
const why = ref('')
const busy = ref(false)

const ready = computed(() => auth.status === 'signed-in' && !ui.tourOpen && !issues.dialog)
const toCheck = computed(() => (ready.value ? fixedUnseen() : []))
const fresh = computed(() => toCheck.value.filter((i) => !celebrated.value.includes(i.id)))
const note = ref([]) // the issues the thank-you note is showing
watch(fresh, async (f) => {
  if (note.value.length || !f.length) return
  note.value = [...f]
  await nextTick()
  burst(canvas.value, { alive: () => note.value.length > 0 })
}, { immediate: true })

function celebrate() { // the note is done: from now on these live in the checklist
  celebrated.value = [...new Set([...celebrated.value, ...note.value.map((i) => i.id)])].slice(-200)
  write(CELEBRATED, celebrated.value)
  note.value = []
  setMin(false)
}
function setMin(v) { min.value = v; write(MIN, v) }
function tryIt(i) {
  if (note.value.length) celebrate()
  router.push(i.route || '/')
}
async function works(i) {
  await markSeen([i.id])
  if (!toCheck.value.length) toast('All checked. Thank you for helping build Life Console!')
}
const startReopen = async (i) => { reopenFor.value = i.id; why.value = ''; await nextTick(); document.querySelector('.fx-why')?.focus() }
async function reopen(i) {
  if (!why.value.trim()) return
  busy.value = true
  try {
    await replyIssue(i.id, why.value.trim(), true) // reopened: it leaves the checklist
    reopenFor.value = null; why.value = ''
    toast(`${i.id} reopened · thanks for checking`)
  } catch (e) { toast(`Couldn't reopen: ${e.message}`) } finally { busy.value = false }
}
</script>

<template>
  <Teleport to="body">
    <!-- the thank-you, once per fix -->
    <div v-if="note.length" class="ifn-scrim" @keydown.esc="celebrate">
      <canvas ref="canvas" class="ifn-confetti"></canvas>
      <div class="ifn panel" role="dialog" aria-labelledby="ifn-h">
        <div class="ifn-top">
          <span class="icon ifn-ic">celebration</span>
          <div>
            <h2 id="ifn-h">{{ note.length === 1 ? 'Your report is fixed' : `${note.length} of your reports are fixed` }}. Thank you!</h2>
            <p class="small muted">Life Console gets better every time you speak up. We're building it together.</p>
          </div>
        </div>
        <ul class="ifn-list">
          <li v-for="i in note" :key="i.id">
            <div class="row hd"><span class="mono small muted">{{ i.id }}</span><b class="grow">{{ i.title }}</b></div>
            <p v-if="i.resolution" class="small res"><span class="icon sm ok">task_alt</span>{{ i.resolution }}</p>
          </li>
        </ul>
        <p class="small ask">Please give {{ note.length === 1 ? 'it' : 'them' }} a try. A checklist stays on the right until you've checked {{ note.length === 1 ? 'it' : 'each one' }}: tick it off if it works, or reopen it and tell us what's still wrong.</p>
        <div class="row foot"><span class="spacer"></span><button class="btn primary" autofocus @click="celebrate">Let's check {{ note.length === 1 ? 'it' : 'them' }}</button></div>
      </div>
    </div>

    <!-- the checklist: stays until every fix is checked off or reopened -->
    <aside v-else-if="toCheck.length" class="fx panel" :class="{ min }" aria-label="Fixes to check">
      <button class="fx-h" :title="min ? 'Show the fixes to check' : 'Minimise'" @click="setMin(!min)">
        <span class="icon sm ok">task_alt</span>
        <span class="grow">Check your fixes</span>
        <span class="mono small">{{ toCheck.length }} left</span>
        <span class="icon sm muted">{{ min ? 'expand_less' : 'expand_more' }}</span>
      </button>
      <ul v-if="!min" class="fx-list">
        <li v-for="i in toCheck" :key="i.id">
          <button class="fx-t" :title="`Open ${i.route || '/'} to try it`" @click="tryIt(i)">
            <span class="mono tiny muted">{{ i.id }}</span><span class="grow">{{ i.title }}</span><span class="icon sm muted">open_in_new</span>
          </button>
          <p v-if="i.resolution" class="tiny muted res">{{ i.resolution }}</p>
          <div v-if="reopenFor === i.id" class="col why">
            <textarea v-model="why" class="textarea small fx-why" rows="2" placeholder="What's still not right?" @keydown.esc.stop="reopenFor = null" @keydown.meta.enter="reopen(i)" @keydown.ctrl.enter="reopen(i)"></textarea>
            <div class="row"><span class="spacer"></span>
              <button class="btn sm" @click="reopenFor = null">Cancel</button>
              <button class="btn sm primary" :disabled="!why.trim() || busy" @click="reopen(i)"><span class="icon sm">replay</span>Reopen</button>
            </div>
          </div>
          <div v-else class="row acts">
            <button class="btn sm" title="It works: tick it off" @click="works(i)"><span class="icon sm ok">check</span>Works</button>
            <button class="btn sm ghost" title="Not fixed for you: reopen it with a note" @click="startReopen(i)">Not fixed</button>
          </div>
        </li>
      </ul>
    </aside>
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
.ifn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ifn-list li { border: 1px solid var(--border); border-radius: 2px; padding: 7px 10px; display: flex; flex-direction: column; gap: 4px; }
.hd { gap: 8px; align-items: baseline; }
.res { margin: 0; display: flex; gap: 6px; color: var(--muted); }
.res .icon { flex: none; }
.foot { padding-top: 2px; }

/* the docked checklist */
.fx { position: fixed; right: 16px; bottom: 44px; z-index: 60; width: 300px; max-height: min(60vh, 520px); display: flex; flex-direction: column; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.fx-h { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
.fx:not(.min) .fx-h { border-bottom: 1px solid var(--border); }
.fx-list { list-style: none; margin: 0; padding: 6px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.fx-list li { border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
.fx-t { display: flex; align-items: baseline; gap: 6px; border: 0; padding: 0; background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.fx-t:hover .grow { color: var(--accent); }
.fx-list .res { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.acts { gap: 6px; }
.why { gap: 6px; }
.why textarea { width: 100%; }
@media (max-width: 640px) { .fx { left: 8px; right: 8px; width: auto; bottom: calc(64px + env(safe-area-inset-bottom)); } }
</style>

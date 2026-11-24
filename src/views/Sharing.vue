<script setup>
// S-98 Sharing and your data (goals 9-11): your address, plans you share and plans shared with you (ActivityPub),
// where your planner's Solid pod is, and moving. Sharing, pod changes and moving happen on the trusted page.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api, trustUrl } from '../sdk/client.js'
import { state, toast } from '../store'

const me = ref(null) // { address, movedTo, shares }
const inbox = ref([])
const pod = ref(null)
const open = ref(null) // { item, data }
const sharePlan = ref('')
const shareTo = ref('')
const shareEdit = ref(false)
const err = ref('')
async function refresh() {
  err.value = ''
  try {
    me.value = await api('GET', '/api/federation/shares')
    inbox.value = (await api('GET', '/api/federation/inbox')).items
    pod.value = await api('GET', '/api/pod')
  } catch (e) { err.value = e.status === 401 ? 'Sign in to share.' : e.message }
}
const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
onMounted(() => { refresh(); document.addEventListener('visibilitychange', onVisible) })
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

const plans = computed(() => state.plans ?? [])
const planTitle = (id) => plans.value.find((p) => p.id === id)?.title ?? id
async function setStatus(item, status) { await api('POST', `/api/federation/inbox/${item.id}`, { status }); refresh() }
async function view(item) {
  try { open.value = { item, data: await api('GET', `/api/federation/shared/${item.id}`) } } catch (e) { toast(e.message); refresh() }
}
async function savePct(sig, pct) {
  try {
    await api('POST', `/api/federation/shared/${open.value.item.id}/update`, { patch: { sigs: [{ no: sig.no, pct: Number(pct) }] } })
    toast('Sent to the owner')
    view(open.value.item)
  } catch (e) { toast(e.message) }
}
const writeNow = async () => { await api('POST', '/api/pod/mirror'); toast('Writing your planner to the pod') }
</script>

<template>
  <div class="sh col">
    <p v-if="err" class="danger small">{{ err }}</p>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">share</span><h2>Sharing</h2><span class="spacer"></span><span v-if="me?.address" class="mono small">{{ me.address }}</span></div>
      <div class="panel-b col">
        <p v-if="me && !me.address" class="small muted">Choose a handle in <router-link to="/m/plugins">Plugins → Publishing</router-link>: it becomes your address for sharing.</p>
        <p v-if="me?.movedTo" class="small warn">This account moved to {{ me.movedTo }}: this server forwards to it.</p>
        <template v-if="me?.address && !me.movedTo">
          <div class="row wrap">
            <select v-model="sharePlan" aria-label="Plan"><option value="" disabled>Plan to share</option><option v-for="p in plans" :key="p.id" :value="p.id">{{ p.title || p.id }}</option></select>
            <input v-model="shareTo" placeholder="@someone@their-server" aria-label="Their address" />
            <label class="small"><input v-model="shareEdit" type="checkbox" /> can edit</label>
            <a class="btn" :class="{ disabled: !sharePlan || !shareTo }" :href="trustUrl('share', { plan: sharePlan, to: shareTo, access: shareEdit ? 'edit' : 'view' })">Share…</a>
          </div>
          <div v-for="s in me.shares" :key="s.id" class="row">
            <span class="grow"><b>{{ planTitle(s.recordId) }}</b> <span class="muted small">with</span> <span class="mono small">{{ s.actor }}</span> <span class="chip">{{ s.access }}</span></span>
            <a class="btn" :href="trustUrl('unshare', { id: s.id })">Stop sharing</a>
          </div>
        </template>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">inbox</span><h2>Shared with me</h2></div>
      <div class="panel-b col">
        <p v-if="!inbox.length" class="muted small">Nothing yet. People on any Life Console server can share plans with your address.</p>
        <div v-for="i in inbox" :key="i.id" class="row">
          <span class="grow"><b>{{ i.name || 'A plan' }}</b> <span class="muted small">from</span> <span class="mono small">{{ i.actor }}</span> <span class="chip">{{ i.access }}</span></span>
          <template v-if="i.status === 'new'"><button class="btn primary" @click="setStatus(i, 'accepted')">Accept</button><button class="btn" @click="setStatus(i, 'declined')">Decline</button></template>
          <button v-else-if="i.status === 'accepted'" class="btn" @click="view(i)">Open</button>
          <span v-else class="small muted">{{ i.status === 'revoked' ? 'no longer shared' : i.status }}</span>
        </div>
        <div v-if="open" class="shared col">
          <div class="row"><b class="grow">{{ open.data.plan.title }}</b><span class="chip">{{ open.data.plan.health }}</span><button class="btn" @click="open = null">Close</button></div>
          <p v-if="open.data.plan.vision" class="small">{{ open.data.plan.vision }}</p>
          <div v-for="g in open.data.plan.psgs" :key="g.no" class="col">
            <div class="mono small">{{ g.no }} {{ g.title }}</div>
            <div v-for="m in open.data.plan.sigs.filter((x) => x.psg === g.no)" :key="m.no" class="row small">
              <span class="mono muted">{{ m.no }}</span><span class="grow">{{ m.title }}</span>
              <input v-if="open.item.access === 'edit'" type="number" min="0" max="100" :value="m.pct" class="pct" aria-label="Percent done" @change="savePct(m, $event.target.value)" />
              <span v-else>{{ m.pct ?? 0 }}%</span>
            </div>
          </div>
          <p class="tiny muted">Read live from its owner's server{{ open.item.access === 'edit' ? '; your changes are sent to them' : '' }}.</p>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">database</span><h2>Your data</h2><span class="spacer"></span><span class="tiny muted">Solid pod</span></div>
      <div class="panel-b col">
        <p v-if="pod?.needsHandle" class="small muted">Choose a handle to get a pod on this server.</p>
        <p v-else-if="pod" class="small">Your planner is written to <span class="mono">{{ pod.base }}</span>{{ pod.own ? ' (your own Solid server)' : ' (the pod built into this server)' }} after every save, as JSON-LD any Solid app can read.</p>
        <div class="row wrap">
          <button v-if="pod && !pod.needsHandle" class="btn" @click="writeNow">Write it now</button>
          <a class="btn" :href="trustUrl(pod?.own ? 'pod-builtin' : 'pod-use')">{{ pod?.own ? 'Use this server\'s pod' : 'Use my own Solid pod…' }}</a>
          <a class="btn" :href="trustUrl('pod-import')">Copy my planner from a pod…</a>
          <a v-if="me?.address && !me.movedTo" class="btn" :href="trustUrl('move')">Move my account…</a>
        </div>
        <p class="small muted">Moving: copy your planner into the new server first (there: Copy my planner from a pod), then Move my account here. Your address and the people you share with come along.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sh { gap: 12px; padding: 16px; max-width: 980px; }
.shared { border: 1px solid var(--border); border-radius: 8px; padding: 10px; gap: 6px; margin-top: 6px; }
.pct { width: 64px; }
input, select { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit; }
.btn.disabled { pointer-events: none; opacity: .5; }
.warn { color: var(--warn); } .danger { color: var(--danger); }
</style>

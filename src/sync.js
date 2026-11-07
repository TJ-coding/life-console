// Sync the planner document with the server so every device (Mac, phone) shares one planner.
//
// Model: one JSON document with a version number on the server.
// - Local edits are pushed (debounced) with the version they were based on.
// - Other devices' edits are pulled on an interval, on focus and when coming back online.
// - Conflict (both sides changed): three-way merge against the last synced copy (merge.js), so
//   independent edits on two devices are both kept; same-field clashes go to the newest edit.
// Without a server (vite dev, static hosting) sync quietly stays off and the app works locally.
import { reactive, watch, nextTick } from 'vue'
import { state, normalizeState, toast, hadLocalData, migrateDoc, SCHEMA_VERSION } from './store'
import { merge3 } from './merge'
import { auth, bindUser } from './auth'

const K = { base: 'life-console/sync-base', version: 'life-console/sync-version', dirty: 'life-console/sync-dirty', edited: 'life-console/sync-edited', device: 'life-console/device' }
const ls = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}

export const sync = reactive({
  status: 'starting', // starting | choose | local | syncing | synced | offline | signed-out | error
  outdated: false, // a newer app version is deployed (or the server holds a newer data schema): reload
  pending: null, // server copy awaiting the user's choice (first sync of a device that has its own data)
  version: Number(ls.get(K.version)) || 0,
  lastSync: null,
  message: '',
})
export function deviceName() {
  let n = ls.get(K.device)
  if (!n) {
    const ua = navigator.userAgent
    n = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Browser'
    ls.set(K.device, n)
  }
  return n
}
export const setDeviceName = (n) => ls.set(K.device, n.trim().slice(0, 40) || deviceName())

let dirty = ls.get(K.dirty) === '1'
let applying = false
let pushTimer = null
let busy = false

class AuthError extends Error {}
/** Not syncing in these states (no server, waiting for a choice, outdated code, signed out). */
const SKIP = ['local', 'choose', 'outdated', 'signed-out']
/** This tab's build = its hashed entry script (matches the server's `build` when up to date). */
const MY_BUILD = (document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') || '').split('/').pop() || 'dev'
const checkBuild = (h) => { if (h?.build && MY_BUILD !== 'dev' && h.build !== 'dev' && h.build !== MY_BUILD) sync.outdated = true }
/** Data written by a newer app version must not be applied or overwritten by this (older) code. */
function tooNew(doc) {
  if ((Number(doc?.state?.schemaVersion) || 1) > SCHEMA_VERSION) { sync.outdated = true; sync.status = 'outdated'; return true }
  return false
}
/** fetch JSON from our API; detect a Cloudflare Access login redirect as "signed out". */
async function call(path, opts = {}) {
  const res = await fetch(`/api${path}`, { redirect: 'manual', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...opts })
  if (res.type === 'opaqueredirect') throw Object.assign(new AuthError('signed out'), { proxy: true }) // a login proxy (e.g. Cloudflare Access) in front
  if (res.status === 401) throw new AuthError('signed out')
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) throw new Error(res.status === 404 ? 'no-server' : `HTTP ${res.status}`)
  return { status: res.status, body: await res.json() }
}

function markDirty() {
  dirty = true
  ls.set(K.dirty, '1')
  ls.set(K.edited, new Date().toISOString())
}
const plain = (v) => JSON.parse(JSON.stringify(v))
/** The last document both this device and the server agreed on (the merge base). */
const saveBase = (doc) => ls.set(K.base, JSON.stringify(doc))
const readBase = () => { try { return JSON.parse(ls.get(K.base)) } catch { return null } }
function markClean(version) {
  saveBase(plain(state))
  dirty = false
  sync.version = version
  sync.lastSync = new Date()
  ls.set(K.dirty, '0')
  ls.set(K.version, String(version))
}
/** Merge the server's newer copy into this device's edits; stays dirty so the result gets pushed. */
async function mergeRemote(remote) {
  remote = { ...remote, state: migrateDoc(plain(remote.state)) } // older-schema server copy → current shape first
  const base = migrateDoc(readBase())
  const merged = base ? merge3(base, plain(state), remote.state) : plain(state) // no base (old client): keep local
  applying = true
  for (const k of Object.keys(state)) delete state[k]
  Object.assign(state, merged)
  normalizeState()
  sync.version = remote.version
  ls.set(K.version, String(remote.version))
  saveBase(remote.state)
  await nextTick()
  applying = false
  markDirty()
}
async function applyRemote(remote) {
  applying = true
  for (const k of Object.keys(state)) delete state[k]
  Object.assign(state, JSON.parse(JSON.stringify(remote.state)))
  normalizeState()
  markClean(remote.version)
  await nextTick()
  applying = false
}
function fail(err) {
  if (err instanceof AuthError) {
    sync.status = 'signed-out'
    sync.message = err.proxy ? 'Sign-in expired — reload to sign in again' : 'Signed out — sign in to sync'
    if (!err.proxy) auth.status = 'signed-out' // shows the sign-in screen; unsaved edits stay on this device
  }
  else if (!navigator.onLine || err instanceof TypeError) { sync.status = 'offline'; sync.message = 'Offline — changes are kept and will sync' }
  else { sync.status = 'error'; sync.message = err.message }
}

async function pushNow(force = false) {
  clearTimeout(pushTimer)
  if (!dirty || busy || SKIP.includes(sync.status)) return
  busy = true
  sync.status = 'syncing'
  try {
    const body = JSON.stringify({ state, baseVersion: sync.version, force, device: deviceName() })
    const r = await call('/state', { method: 'PUT', body })
    if (r.status === 409) {
      if (tooNew(r.body)) return
      // another device saved meanwhile: merge its changes with ours, then save the result
      await mergeRemote(r.body)
      busy = false
      toast('Merged changes from another device')
      return pushNow(force)
    }
    if (r.status !== 200) throw new Error(r.body?.error || `HTTP ${r.status}`)
    markClean(r.body.version)
    sync.status = 'synced'
    sync.message = ''
  } catch (err) {
    fail(err)
  } finally {
    busy = false
  }
}
const schedulePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => pushNow(), 1500) }

export async function pull() {
  if (SKIP.includes(sync.status) || busy) return
  if (dirty) return pushNow()
  try {
    const r = await call(`/state?since=${sync.version}`)
    if (r.body.changed && r.body.state && tooNew(r.body)) return
    if (r.body.changed && r.body.version !== sync.version && r.body.state) {
      await applyRemote(r.body)
      toast('Updated with changes from another device')
    }
    sync.status = 'synced'
    sync.message = ''
    sync.lastSync = new Date()
  } catch (err) {
    fail(err)
  }
}

/** First contact: reconcile this device's copy with the server's. */
async function reconcile() {
  const r = await call('/state')
  const remote = r.body
  if (remote.state && tooNew(remote)) return
  if (!remote.version || !remote.state) { markDirty(); return pushNow(true) } // empty server: seed it from this device
  if (!ls.get(K.version)) {
    // this device has never synced: a fresh browser just adopts the server copy,
    // but one that already holds its own planner data asks which copy to keep
    if (!hadLocalData) { await applyRemote(remote); sync.status = 'synced'; return }
    sync.pending = remote
    sync.status = 'choose'
    return
  }
  if (!dirty) {
    if (remote.version !== sync.version) await applyRemote(remote)
    sync.status = 'synced'
    return
  }
  if (remote.version === sync.version) return pushNow() // only we changed
  // both changed while apart: merge, then save the merged result
  await mergeRemote(remote)
  toast('Merged changes from another device')
  return pushNow()
}

/** Resolve the first-sync choice: 'server' adopts the server copy, 'device' replaces it with this one. */
export async function chooseSync(which) {
  const remote = sync.pending
  sync.pending = null
  if (which === 'server') {
    await applyRemote(remote)
    sync.status = 'synced'
    toast('Loaded your planner from the server')
  } else {
    sync.status = 'syncing'
    sync.version = remote.version
    markDirty()
    await pushNow(true)
    toast('This device’s planner is now on the server (previous copy backed up)')
  }
}

/**
 * Connect to the server: no server → local-only mode; signed out → the sign-in screen (auth.status);
 * signed in → reconcile and keep syncing. `resumeSync()` runs again after every sign-in.
 */
export async function startSync() {
  try {
    const h = (await call('/health')).body
    checkBuild(h)
    auth.signups = h.auth?.signups ?? 'open'
    auth.passwordReset = !!h.auth?.passwordReset
    auth.password = h.auth?.password !== false
    auth.google = !!h.auth?.google
    auth.analytics = h.analytics?.script && h.analytics?.siteId ? h.analytics : null
  } catch (err) {
    if (err instanceof AuthError) { fail(err); return }
    auth.status = 'none'
    sync.status = 'local' // no server: local-only mode (e.g. `npm run dev` without the API)
    sync.message = 'Not connected to a server — data stays in this browser'
    return
  }
  try {
    const me = await call('/auth/me')
    if (!bindUser(me.body.user)) return // another account's data was here: wiped, reloading
  } catch (err) {
    fail(err)
    return
  }
  await resumeSync()
}

let started = false
export async function resumeSync() {
  sync.status = 'syncing'
  sync.message = ''
  try { await reconcile() } catch (err) { fail(err) }
  if (started) return
  started = true

  watch(state, () => {
    if (applying) return
    markDirty()
    if (sync.status !== 'choose') schedulePush()
  }, { deep: true })

  setInterval(() => { if (document.visibilityState === 'visible') pull() }, 30000)
  // notice new deploys while the tab stays open (cheap health check every 2 minutes and on focus)
  const buildCheck = () => call('/health').then((r) => checkBuild(r.body)).catch(() => {})
  setInterval(() => { if (document.visibilityState === 'visible') buildCheck() }, 120000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') buildCheck() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull() })
  window.addEventListener('online', () => pull())
  // phones suspend apps without warning: flush unsaved edits when the page is hidden or closed
  const flush = () => {
    if (!dirty || SKIP.includes(sync.status)) return
    const body = JSON.stringify({ state, baseVersion: sync.version, device: deviceName() })
    if (body.length < 60000) fetch('/api/state', { method: 'PUT', body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }).catch(() => {})
    // not awaited: if it conflicted, the next start merges; if it landed, the next start sees it
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
}

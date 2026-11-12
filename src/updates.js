// Server updates (admins of a self-hosted server): "a newer Life Console is out", the changes, and, when the
// server runs the optional `updater` service, a button that updates it. Server side: server/updates.mjs.
import { reactive, watch } from 'vue'
import { auth, isAdmin } from './auth'

const DISMISS_KEY = 'life-console/update-dismissed' // a UI preference (per device), not planner data
export const serverUpdate = reactive({
  info: null, // GET /api/admin/update
  busy: false, // a check or an update is in progress
  error: '',
  dismissed: (() => { try { return localStorage.getItem(DISMISS_KEY) || '' } catch { return '' } })(),
})

async function call(path, method = 'GET', data = {}) {
  const res = await fetch(`/api/admin/update${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(method !== 'GET' ? { body: JSON.stringify(data) } : {}) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `server answered ${res.status}`)
  return body
}

export async function loadUpdate() {
  if (!isAdmin()) return
  try { serverUpdate.info = await call(''); serverUpdate.error = '' } catch { /* offline or an older server: no notice */ }
}
export async function checkUpdate() {
  serverUpdate.busy = true
  try { serverUpdate.info = await call('/check', 'POST'); serverUpdate.error = '' } catch (e) { serverUpdate.error = e.message } finally { serverUpdate.busy = false }
}

/** The server-wide auto-update switch (admins). */
export async function setAutoUpdate(on) {
  try { serverUpdate.info = await call('', 'PATCH', { autoUpdate: on }); serverUpdate.error = '' } catch (e) { serverUpdate.error = e.message }
}

/** Show the top banner? Only for admins, only for a build they haven't dismissed. */
export const showBanner = () => {
  const i = serverUpdate.info
  return !!(isAdmin() && i?.available && i.latest?.tag !== serverUpdate.dismissed)
}
export function dismissBanner() {
  serverUpdate.dismissed = serverUpdate.info?.latest?.tag || ''
  try { localStorage.setItem(DISMISS_KEY, serverUpdate.dismissed) } catch { /* ignore */ }
}

/** Ask the updater to update, then wait: the server restarts on the new image, and this page reloads onto it. */
export async function applyUpdate() {
  const from = serverUpdate.info?.current?.sha
  serverUpdate.busy = true
  serverUpdate.error = ''
  try {
    serverUpdate.info = await call('/apply', 'POST')
  } catch (e) {
    serverUpdate.busy = false
    serverUpdate.error = e.message
    return
  }
  const started = Date.now()
  const tick = async () => {
    let i = null
    try { i = await call('') } catch { /* the app is restarting */ }
    if (i) serverUpdate.info = i
    if (i && i.current.sha !== from) { window.location.reload(); return } // the new build answers
    if (i?.updater.state === 'failed') { serverUpdate.busy = false; serverUpdate.error = 'The update failed: the server is still on the old version (details below).'; return }
    if (Date.now() - started > 10 * 60000) { serverUpdate.busy = false; serverUpdate.error = 'Still not updated after 10 minutes: check the updater with  docker compose logs updater'; return }
    setTimeout(tick, 3000)
  }
  setTimeout(tick, 3000)
}

// look once a session (the server itself checks GitHub every few hours), when an admin is signed in
watch(() => auth.user?.role, (role) => { if (role === 'admin') loadUpdate() }, { immediate: true })
setInterval(() => { if (!serverUpdate.busy) loadUpdate() }, 3 * 3600e3)

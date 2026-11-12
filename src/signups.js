// Sign-ups (admins): who may create an account on this server. SIGNUPS on the server sets the default; the
// switch in Settings overrides it until reset. Server side: server/signups.mjs.
import { reactive, watch } from 'vue'
import { auth, isAdmin } from './auth'

export const signupsAdmin = reactive({
  info: null, // GET /api/admin/signups: { mode, source: 'admin'|'default', defaultMode, changedAt }
  busy: false,
  error: '',
})

async function call(method = 'GET', data) {
  const res = await fetch('/api/admin/signups', { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `server answered ${res.status}`)
  return body
}

export async function loadSignups() {
  if (!isAdmin()) return
  try { signupsAdmin.info = await call(); signupsAdmin.error = '' } catch { /* offline or an older server: no panel */ }
}
/** 'open' | 'closed', or null for the server's SIGNUPS default. */
export async function setSignups(mode) {
  signupsAdmin.busy = true
  try { signupsAdmin.info = await call('PATCH', { mode }); signupsAdmin.error = '' } catch (e) { signupsAdmin.error = e.message } finally { signupsAdmin.busy = false }
}

// load when an admin is signed in (also after signing in on this page); forget it for anyone else
watch(() => auth.user?.role, (role) => { if (role === 'admin') loadSignups(); else signupsAdmin.info = null }, { immediate: true })

// Accounts on the client: who is signed in, the sign-in / sign-up / reset calls, and keeping one
// browser's local planner copy tied to one account (signing in as someone else starts clean).
import { reactive } from 'vue'

const USER_KEY = 'life-console/user'
/** Everything that belongs to the signed-in person's planner (UI preferences are kept). */
const DATA_KEYS = ['life-console/v1', 'life-console/sync-base', 'life-console/sync-version', 'life-console/sync-dirty', 'life-console/sync-edited', 'life-console/issue-queue', 'life-console/last-plan']
const ls = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}
const resetFromHash = () => /^#\/reset\/([\w-]+)/.exec(location.hash)?.[1] ?? null
/** A failed Google sign-in comes back as #/?auth_error=… : show it once on the sign-in screen, then tidy the URL. */
function errorFromHash() {
  const m = /[?&]auth_error=([^&]*)/.exec(location.hash)
  if (!m) return ''
  history.replaceState(null, '', location.pathname + '#/')
  try { return decodeURIComponent(m[1]) } catch { return 'Sign-in failed' }
}

export const auth = reactive({
  status: 'unknown', // unknown | signed-in | signed-out | none (no server: local-only)
  user: null, // { id, email, name, role }
  signups: 'open',
  passwordReset: false,
  password: true, // email + password sign-in offered by this server
  google: false, // "Continue with Google" offered by this server
  error: errorFromHash(),
  resetToken: resetFromHash(), // from a password-reset email link (#/reset/<token>)
})
export const isAdmin = () => auth.user?.role === 'admin'

let onSignedIn = () => {}
/** main.js registers what to (re)start once someone is signed in: sync, issues, push. */
export const setSignedInHandler = (fn) => { onSignedIn = fn }

async function api(method, path, body) {
  const r = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  let data = {}
  try { data = await r.json() } catch { /* not json */ }
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status })
  return data
}

export function wipeLocalData() {
  for (const k of DATA_KEYS) ls.del(k)
  ls.del(USER_KEY)
}

/**
 * Tie this browser's local copy to `user`. Data saved here for a different account is wiped and the
 * page reloads (returns false). A copy from before accounts existed belongs to the first sign-in.
 */
export function bindUser(user) {
  auth.user = user
  auth.status = 'signed-in'
  const prev = ls.get(USER_KEY)
  if (prev && prev !== user.id) {
    wipeLocalData()
    ls.set(USER_KEY, user.id)
    location.reload()
    return false
  }
  ls.set(USER_KEY, user.id)
  return true
}

async function finish(data) {
  if (!bindUser(data.user)) return
  if (auth.resetToken) { auth.resetToken = null; history.replaceState(null, '', '#/') }
  await onSignedIn()
}

/** Full-page redirect: the server sends the browser to Google and back to #/ signed in (or with auth_error). */
export const signInWithGoogle = () => { location.href = '/api/auth/google/start' }
export const signIn = async (email, password) => finish(await api('POST', '/auth/login', { email, password }))
export const signUp = async (email, password, name) => finish(await api('POST', '/auth/signup', { email, password, name }))
export const requestReset = (email) => api('POST', '/auth/forgot', { email })
export const resetPassword = async (password) => finish(await api('POST', '/auth/reset', { token: auth.resetToken, password }))
export const changePassword = (current, password) => api('POST', '/auth/password', { current, password })
export async function rename(name) { auth.user = (await api('PATCH', '/auth/me', { name })).user }

/** Sign out here: the server ends the session, and this browser forgets the planner copy. */
export async function signOut(endpoint) {
  await api('POST', '/auth/logout', { endpoint }).catch(() => {})
  wipeLocalData()
  location.replace(location.pathname + '#/')
  location.reload()
}
export async function deleteAccount(password, confirm) {
  await api('DELETE', '/auth/me', { password, confirm })
  wipeLocalData()
  location.replace(location.pathname + '#/')
  location.reload()
}

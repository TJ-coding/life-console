// Web Push on this device: permission, subscription and a test send.
import { reactive } from 'vue'
import { deviceName } from './sync'

const ua = navigator.userAgent
export const env = {
  ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
  android: /Android/.test(ua),
  standalone: window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true,
  secure: window.isSecureContext,
}
export const push = reactive({
  supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && env.secure,
  permission: 'Notification' in window ? Notification.permission : 'unsupported',
  subscribed: false,
  endpoint: null,
  busy: false,
  error: '',
})

const b64ToBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
async function json(path, opts = {}) {
  const r = await fetch(`/api${path}`, { credentials: 'same-origin', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, ...opts })
  if (r.type === 'opaqueredirect' || !(r.headers.get('content-type') || '').includes('json')) throw new Error('Not signed in to the server — reload the app')
  const body = await r.json()
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
  return body
}

export async function refreshPush() {
  if (!push.supported) return
  push.permission = Notification.permission
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  push.subscribed = !!sub
  push.endpoint = sub?.endpoint ?? null
  // re-register with the server (cheap, idempotent) so a reset server still knows this device
  if (sub) json('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), label: deviceName() }) }).catch(() => {})
}

/** Must be called from a click/tap (iOS requires a user gesture). */
export async function enablePush() {
  push.error = ''
  push.busy = true
  try {
    const perm = await Notification.requestPermission()
    push.permission = perm
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this app in system settings' : 'Permission was not granted')
    const reg = await navigator.serviceWorker.ready
    const { publicKey } = await json('/push/key')
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }))
    await json('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), label: deviceName() }) })
    push.subscribed = true
    push.endpoint = sub.endpoint
  } catch (err) {
    push.error = err.message
  } finally {
    push.busy = false
  }
}
export async function disablePush() {
  push.busy = true
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await json('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
      await sub.unsubscribe()
    }
    push.subscribed = false
    push.endpoint = null
  } finally {
    push.busy = false
  }
}
export const testPush = () => json('/push/test', { method: 'POST', body: JSON.stringify({ endpoint: push.endpoint }) })
export const listDevices = () => json('/push/devices')

/* Android/desktop Chrome install prompt */
export const install = reactive({ available: false, prompt: null })
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); install.prompt = e; install.available = true })
window.addEventListener('appinstalled', () => { install.available = false; env.standalone = true })
export async function promptInstall() {
  if (!install.prompt) return
  install.prompt.prompt()
  await install.prompt.userChoice
  install.prompt = null
  install.available = false
}

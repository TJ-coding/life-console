// Life Console service worker: offline app shell + Web Push notifications.
const CACHE = 'life-console-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', (e) => {
  self.skipWaiting()
  // best effort: behind Cloudflare Access an expired session redirects, so never fail install over it
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}))
})
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

const cacheable = (res) => res && res.ok && res.type === 'basic' && !res.redirected
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  if (req.mode === 'navigate') {
    // network first so new deploys show up; fall back to the cached shell offline
    e.respondWith(fetch(req).then((res) => {
      if (cacheable(res)) caches.open(CACHE).then((c) => c.put('/', res.clone()))
      return res
    }).catch(() => caches.match('/')))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    // content-hashed files never change: cache first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (cacheable(res)) caches.open(CACHE).then((c) => c.put(req, res.clone()))
      return res
    })))
    return
  }
  // everything else: stale-while-revalidate
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (cacheable(res)) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res }).catch(() => hit)
    return hit || net
  }))
})

/* ── push ── */
self.addEventListener('push', (e) => {
  let p = {}
  try { p = e.data ? e.data.json() : {} } catch { p = { title: 'Life Console', body: e.data?.text() } }
  e.waitUntil(self.registration.showNotification(p.title || 'Life Console', {
    body: p.body || '',
    tag: p.tag,
    renotify: !!p.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: p.url || '/', ...(p.data || {}) },
    actions: p.actions || [],
    // p.vibrate === false → stay silent: the owner turns vibration off in Settings (ISS-13)
    vibrate: p.vibrate === false ? [] : undefined,
    timestamp: Date.now(),
  }))
})

self.addEventListener('notificationclick', (e) => {
  const n = e.notification
  n.close()
  const { url = '/', todoId } = n.data || {}
  if (e.action === 'done' && todoId) {
    e.waitUntil(fetch('/api/todo/done', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: todoId }) })
      .then((r) => self.registration.showNotification(r.ok ? 'Marked done ✓' : 'Could not mark done — open the app', { tag: 'done-ack', icon: '/icons/icon-192.png', badge: '/icons/badge-72.png' }))
      .catch(() => {}))
    return
  }
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const target = new URL(url, location.origin).href
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(target).catch(() => {}); return }
    }
    await self.clients.openWindow(target)
  })())
})

// the push service rotated the subscription: register the new one with the server
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const { publicKey } = await (await fetch('/api/push/key', { credentials: 'same-origin' })).json()
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0))
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), label: 'renewed' }) })
  })())
})

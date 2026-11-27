// The server's own preview runner, for AI apps (server/mcp.mjs): Claude builds an extension without the person's
// browser, and the workshop page is only where they look at the result.
//
// It drives a headless Chromium in a separate container (the `previewer` service in docker-compose.yml: no internet,
// on a network only the app shares) over the DevTools protocol, and opens the same /preview.html the workshop
// frames. So a draft runs exactly as it does for the person: on demo data, never on a real planner, and the browser
// has no cookies or storage of anyone's. Each run gets its own throwaway browser context.
// Off unless PREVIEWER_URL is set (self-hosters can leave it off and keep the in-browser preview only).
import dns from 'node:dns/promises'

const VIEWPORTS = { phone: { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 }, desktop: { width: 1280, height: 900, mobile: false, deviceScaleFactor: 1 } }
const RUN_MS = 20000
const MAX_AT_ONCE = 2
const MAX_STEPS = 30

/** A tiny DevTools-protocol client over one WebSocket (flat sessions). */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const handlers = new Set()
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('previewer unreachable')) })
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method) for (const h of handlers) h(msg)
  }
  ws.onclose = () => { for (const { reject } of pending.values()) reject(new Error('previewer closed the connection')); pending.clear() }
  const send = async (method, params = {}, sessionId) => {
    await opened
    const id = ++seq
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }
  return { send, on: (h) => { handlers.add(h); return () => handlers.delete(h) }, close: () => { try { ws.close() } catch { /* gone */ } } }
}

// Runs inside the preview page. Finds an element across shadow roots: a CSS selector, or text=… for the element
// whose own text is exactly that (buttons, labels).
const PAGE_HELPERS = `(() => {
  const roots = () => { const out = [document]; for (let i = 0; i < out.length; i++) for (const el of out[i].querySelectorAll('*')) if (el.shadowRoot) out.push(el.shadowRoot); return out }
  const find = (sel) => {
    const text = /^text=(.*)$/s.exec(sel)
    for (const r of roots()) {
      if (text) { for (const el of r.querySelectorAll('button,a,label,summary,option,[role=button],span,div,p,b,h1,h2,h3,text')) if ((el.textContent || '').trim() === text[1].trim() && ![...el.children].some((c) => (c.textContent || '').trim() === text[1].trim())) return el }
      else { const el = r.querySelector(sel); if (el) return el }
    }
    return null
  }
  const box = (sel) => { const el = find(sel); if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }
  const focus = (sel) => { const el = find(sel); if (!el) return false; el.focus(); if ('value' in el && el.select) el.select(); return true }
  const parts = () => [...document.querySelectorAll('#out .part')].map((p) => {
    const el = p.shadowRoot ? [...p.shadowRoot.children].find((n) => n.tagName !== 'STYLE') : p
    return { label: p.previousElementSibling?.textContent ?? '', text: String(el?.innerText ?? el?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 800) }
  })
  window.__lc = { find, box, focus, parts }
  window.__lcOut = { result: null, errors: [], toasts: [] }
  window.addEventListener('message', (e) => {
    const d = e.data
    if (d?.source !== 'lc-preview') return
    if (d.type === 'result') window.__lcOut.result = d
    else if (d.type === 'error') window.__lcOut.errors.push(d.text)
    else if (d.type === 'toast') window.__lcOut.toasts.push(d.text)
  })
})()`

export function createPreviewer({ url = '', pageUrl = '', log = () => {} } = {}) {
  if (!url || !pageUrl) return { on: false }
  let running = 0
  const queue = []
  const slot = () => new Promise((resolve) => { if (running < MAX_AT_ONCE) { running++; resolve() } else queue.push(resolve) })
  const free = () => { const next = queue.shift(); if (next) next(); else running-- }

  /** Chrome only answers /json for an IP or localhost Host header, so resolve the service name first. */
  async function browserWs() {
    const u = new URL(url)
    const ip = /^[\d.]+$|^\[/.test(u.hostname) || u.hostname === 'localhost' ? u.hostname : (await dns.lookup(u.hostname)).address
    const r = await fetch(`${u.protocol}//${ip}:${u.port || 9222}/json/version`, { signal: AbortSignal.timeout(4000) })
    if (!r.ok) throw new Error(`previewer answered ${r.status}`)
    const ws = new URL((await r.json()).webSocketDebuggerUrl)
    ws.hostname = ip; ws.port = u.port || '9222' // it names itself 127.0.0.1 inside its container
    return ws.toString()
  }

  /**
   * Run a draft: { code, name, theme: 'dark'|'light', viewports: ['phone'|'desktop'], steps: [...], shots: bool }.
   * Steps (after the first render): { click: sel } · { type: text, into?: sel } · { key: 'Enter'|'Tab'|'ArrowLeft'… }
   * · { drag: sel, by: [dx, dy] } · { wait: ms }. Returns the preview's result plus { steps: [...], shots: [{ viewport, png }] }.
   */
  async function run({ code, name = 'draft', theme = 'dark', viewports = ['desktop'], steps = [], shots = false }) {
    await slot()
    let c, ctx
    const started = Date.now()
    const left = () => Math.max(500, RUN_MS - (Date.now() - started))
    try {
      c = cdp(await browserWs())
      ctx = (await c.send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId
      const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx })
      const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true })
      const s = (m, p) => c.send(m, p, sessionId)
      const evaluate = async (expression) => {
        const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text)
        return r.result.value
      }
      const until = async (expression, ms) => {
        const end = Date.now() + ms
        for (;;) { const v = await evaluate(expression); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 100)) }
      }
      const vp = (v) => s('Emulation.setDeviceMetricsOverride', VIEWPORTS[v])
      await s('Page.enable')
      await s('Runtime.enable')
      await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme === 'light' ? 'light' : 'dark' }] })
      await vp(viewports[0] ?? 'desktop')
      await s('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS })
      const loaded = new Promise((resolve) => { const off = c.on((m) => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) { off(); resolve() } }) })
      await s('Page.navigate', { url: pageUrl })
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 8000))])
      if (!(await until('!!window.__lc', 4000))) throw new Error("the preview page didn't load")
      await evaluate(`window.postMessage(${JSON.stringify({ type: 'run', code, name, theme })}, '*')`)
      const result = await until('window.__lcOut.result', Math.min(8000, left()))
      if (!result) throw new Error('the preview gave no result in time (an endless loop, or a crash?)')

      // the agent's steps: real input events, so pointer and keyboard handlers run as they do for a person
      const mouse = (type, x, y, buttons = 1) => s('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse' })
      const did = []
      for (const st of (Array.isArray(steps) ? steps : []).slice(0, MAX_STEPS)) {
        if (Date.now() - started > RUN_MS) { did.push('stopped: out of time'); break }
        try {
          if (st.click || st.drag) {
            const sel = st.click ?? st.drag
            const p = await evaluate(`window.__lc.box(${JSON.stringify(String(sel))})`)
            if (!p) { did.push(`${st.click ? 'click' : 'drag'} ${sel}: not found`); continue }
            await mouse('mouseMoved', p.x, p.y, 0)
            await mouse('mousePressed', p.x, p.y)
            if (st.drag) {
              const [dx, dy] = (st.by ?? [0, 0]).map(Number)
              for (let i = 1; i <= 8; i++) await mouse('mouseMoved', p.x + (dx * i) / 8, p.y + (dy * i) / 8)
              await mouse('mouseReleased', p.x + dx, p.y + dy, 0)
              did.push(`dragged ${sel} by ${dx},${dy}`)
            } else { await mouse('mouseReleased', p.x, p.y, 0); did.push(`clicked ${sel}`) }
          } else if (st.type !== undefined) {
            if (st.into && !(await evaluate(`window.__lc.focus(${JSON.stringify(String(st.into))})`))) { did.push(`type into ${st.into}: not found`); continue }
            await s('Input.insertText', { text: String(st.type) })
            did.push(`typed "${String(st.type).slice(0, 40)}"${st.into ? ` into ${st.into}` : ''}`)
          } else if (st.key) {
            const key = String(st.key)
            const code = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32 }[key]
            const base = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: st.shift ? 8 : 0 }
            await s('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key === 'Enter' ? { text: '\r' } : key.length === 1 ? { text: key } : {}) })
            await s('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
            did.push(`pressed ${st.shift ? 'Shift+' : ''}${key}`)
          } else if (st.wait) {
            await new Promise((r) => setTimeout(r, Math.min(Number(st.wait) || 0, 2000)))
            did.push(`waited ${st.wait}ms`)
          } else did.push(`skipped an unknown step: ${JSON.stringify(st).slice(0, 80)}`)
          await new Promise((r) => setTimeout(r, 60))
        } catch (e) { did.push(`step failed: ${e.message}`) }
      }
      const after = await evaluate('({ parts: window.__lc.parts(), errors: window.__lcOut.errors, toasts: window.__lcOut.toasts })')
      const errors = [...new Set([...(result.errors ?? []), ...after.errors])]
      const out = { ...result, ok: result.ok && !errors.length, parts: after.parts, errors, toasts: after.toasts, steps: did, shots: [] }
      if (shots) {
        for (const v of viewports.slice(0, 2)) {
          await vp(v)
          await new Promise((r) => setTimeout(r, 150))
          const { contentSize } = await s('Page.getLayoutMetrics')
          const height = Math.min(Math.ceil(contentSize.height), 2400)
          const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: VIEWPORTS[v].width, height, scale: 1 } })
          out.shots.push({ viewport: v, png: data })
        }
      }
      return out
    } catch (e) {
      log(`[previewer] ${e.message}`)
      return { ok: false, errors: [`previewer: ${e.message}`], previewerFailed: true }
    } finally {
      if (c && ctx) await c.send('Target.disposeBrowserContext', { browserContextId: ctx }).catch(() => {})
      c?.close()
      free()
    }
  }

  return { on: true, run }
}

// The server's own preview runner, for AI apps (server/mcp.mjs): Claude builds an extension without the person's
// browser, and the workshop page is only where they look at the result.
//
// It drives a headless Chromium in a separate container (the `previewer` service in docker-compose.yml: no internet,
// on a network only the app shares) over the DevTools protocol, and opens the same preview.html the workshop
// frames. The browser fetches nothing over the network: the app answers every request itself, from its built files,
// through the protocol (Fetch.fulfillRequest), so the container needs no route to the app and a draft can't reach
// anything. A draft runs as it does for the person: on demo data, never on a real planner, with no cookies or storage
// of anyone's. Each run gets its own throwaway browser context.
// Off unless PREVIEWER_URL is set (self-hosters can leave it off and keep the in-browser preview only).
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import path from 'node:path'

const VIEWPORTS = { phone: { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 }, desktop: { width: 1280, height: 900, mobile: false, deviceScaleFactor: 1 } }
const RUN_MS = 40000
const ORIGIN = 'http://lc-preview.invalid' // never resolved: every request to it is answered by the app
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }
const PAGE_CSP = `default-src 'none'; script-src ${ORIGIN} blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src ${ORIGIN}; connect-src 'none'; base-uri 'none'; form-action 'none'`
const MAX_AT_ONCE = 2
const MAX_STEPS = 80

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
    if (!text) { for (const r of roots()) { const el = r.querySelector(sel); if (el) return el } return null }
    // text=…: something you can act on first (a button before a label that says the same), then anything
    const want = text[1].trim()
    const same = (el) => (el.textContent || '').trim() === want && ![...el.children].some((c) => (c.textContent || '').trim() === want)
    for (const q of ['button,a,[role=button],[role=tab],summary,input[type=submit]', 'label,option,span,div,p,b,h1,h2,h3,li,td,text'])
      for (const r of roots()) for (const el of r.querySelectorAll(q)) if (same(el)) return el
    return null
  }
  const box = (sel) => { const el = find(sel); if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }
  const focus = (sel) => { const el = find(sel); if (!el) return false; el.focus(); if ('value' in el && el.select) el.select(); return true }
  // what each part shows, as text; icons' ligature names ("close", "scatter_plot") left out
  const textOf = (el) => { const c = el.cloneNode(true); for (const i of c.querySelectorAll('.lc-icon,.icon,.material-symbols-outlined')) i.remove(); document.body.append(c); const t = c.innerText ?? c.textContent; c.remove(); return t }
  const parts = () => [...document.querySelectorAll('#out .part')].map((p) => {
    const el = p.shadowRoot ? [...p.shadowRoot.children].find((n) => n.tagName !== 'STYLE') : p
    return { label: p.previousElementSibling?.textContent ?? '', text: String(el ? textOf(el) : '').replace(/\\s+/g, ' ').trim().slice(0, 800) }
  })
  /** Choose an option in a <select> by its value or its visible text, as a person would. */
  const choose = (sel, want) => {
    const el = find(sel)
    if (!el || el.tagName !== 'SELECT') return 'not a select'
    const o = [...el.options].find((x) => x.value === want || x.textContent.trim() === want)
    if (!o) return 'no option "' + want + '" (has: ' + [...el.options].map((x) => x.textContent.trim()).slice(0, 8).join(', ') + ')'
    el.value = o.value
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    return ''
  }
  // no icon font here (no internet): an icon becomes an icon-sized dashed box, not its name as a long word
  const ICONS = '.lc-icon,.icon,.material-symbols-outlined{display:inline-block!important;width:1.2em!important;height:1.2em!important;overflow:hidden!important;color:transparent!important;border:1px dashed var(--muted,#888);box-sizing:border-box;vertical-align:middle;font-size:inherit}'
  const iconBoxes = () => { for (const r of roots()) if (!r.querySelector?.(':scope > style[data-lc-icons]')) { const st = document.createElement('style'); st.dataset.lcIcons = '1'; st.textContent = ICONS; (r === document ? document.head : r).appendChild(st) } }
  window.__lc = { find, box, focus, parts, iconBoxes, choose }
  window.__lcOut = { result: null, errors: [], toasts: [] }
  window.addEventListener('message', (e) => {
    const d = e.data
    if (d?.source !== 'lc-preview') return
    if (d.type === 'result') window.__lcOut.result = d
    else if (d.type === 'error') window.__lcOut.errors.push(d.text)
    else if (d.type === 'toast') window.__lcOut.toasts.push(d.text)
  })
})()`

export function createPreviewer({ url = '', dist = '', log = () => {} } = {}) {
  if (!url || !dist) return { on: false }
  const pageUrl = `${ORIGIN}/preview.html`
  /** A request from the preview page: only preview.html and the built assets, read from disk. */
  async function answer(reqUrl) {
    const u = new URL(reqUrl)
    if (u.origin !== ORIGIN || !(u.pathname === '/preview.html' || /^\/(assets|vendor)\/[\w.-]+$/.test(u.pathname))) return null
    try {
      const body = await fs.readFile(path.join(dist, u.pathname))
      const headers = [{ name: 'Content-Type', value: TYPES[path.extname(u.pathname)] ?? 'application/octet-stream' }]
      if (u.pathname === '/preview.html') headers.push({ name: 'Content-Security-Policy', value: PAGE_CSP })
      return { responseCode: 200, responseHeaders: headers, body: body.toString('base64') }
    } catch { return { responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: '' } }
  }
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
   * Run a draft: { files (or code), name, theme: 'dark'|'light', viewports: ['phone'|'desktop'], steps: [...], shots: bool }.
   * Steps (after the first render): { click: sel } · { type: text, into?: sel } · { key: 'Enter'|'Tab'|'ArrowLeft'… }
   * · { drag: sel, by: [dx, dy] } · { wait: ms }. Returns the preview's result plus { steps: [...], shots: [{ viewport, png }] }.
   */
  async function run({ code, files, name = 'draft', theme = 'dark', viewports = ['desktop'], steps = [], shots = false, fullPage = false }) {
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
      // every request is answered here: the preview's own files from disk, anything else (Google Fonts, a draft's
      // fetch) fails at once (a request that hangs would hold back the preview's script)
      const seen = { blocked: [], console: [] }
      c.on((m) => {
        if (m.sessionId !== sessionId) return
        if (m.method === 'Fetch.requestPaused') {
          const { requestId, request } = m.params
          answer(request.url).then((r) => r
            ? s('Fetch.fulfillRequest', { requestId, ...r })
            : (seen.blocked.push(request.url.slice(0, 120)), s('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })))
            .catch(() => {})
        } else if (m.method === 'Runtime.exceptionThrown') seen.console.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails?.text)
        else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') seen.console.push(m.params.entry.text)
      })
      await s('Log.enable')
      await s('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
      await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme === 'light' ? 'light' : 'dark' }] })
      await vp(viewports[0] ?? 'desktop')
      await s('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS })
      const loaded = new Promise((resolve) => { const off = c.on((m) => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) { off(); resolve() } }) })
      await s('Page.navigate', { url: pageUrl })
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 8000))])
      if (!(await until('!!window.__lc', 4000))) throw new Error("the preview page didn't load")
      await evaluate(`window.postMessage(${JSON.stringify({ type: 'run', files: files ?? { 'index.js': code }, name, theme })}, '*')`)
      const result = await until('window.__lcOut.result', Math.min(8000, left()))
      if (result) await evaluate('window.__lc.iconBoxes()')
      if (!result) {
        const at = await evaluate('location.href + " (" + document.readyState + ")"').catch(() => '?')
        const why = [...seen.console.slice(0, 3), ...(seen.blocked.length ? [`blocked: ${seen.blocked.slice(0, 3).join(', ')}`] : [])].join('; ')
        throw new Error(`the preview gave no result in time at ${at}${why ? `: ${why}` : ' (an endless loop?)'}`)
      }

      // the agent's steps: real input events, so pointer and keyboard handlers run as they do for a person
      const mouse = (type, x, y, buttons = 1) => s('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse' })
      const did = []
      const midShots = []
      const list = Array.isArray(steps) ? steps : []
      if (list.length > MAX_STEPS) did.push(`only the first ${MAX_STEPS} of ${list.length} steps run`)
      for (const st of list.slice(0, MAX_STEPS)) {
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
          } else if (st.select) {
            const err = await evaluate(`window.__lc.choose(${JSON.stringify(String(st.select))}, ${JSON.stringify(String(st.value ?? st.option ?? ''))})`)
            did.push(err ? `select ${st.select}: ${err}` : `chose "${st.value ?? st.option}" in ${st.select}`)
          } else if (st.screenshot) {
            // a picture now, in the middle of the steps (the first viewport), e.g. before and after a drag
            await evaluate('window.__lc.iconBoxes()')
            const v0 = VIEWPORTS[viewports[0] ?? 'desktop']
            const { data } = await s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: v0.width, height: v0.height, scale: 1 / v0.deviceScaleFactor } })
            midShots.push({ viewport: `${viewports[0] ?? 'desktop'}: ${String(st.screenshot === true ? `after step ${did.length}` : st.screenshot).slice(0, 60)}`, png: data })
            did.push(`screenshot${st.screenshot === true ? '' : ` "${st.screenshot}"`}`)
          } else if (st.wait) {
            await new Promise((r) => setTimeout(r, Math.min(Number(st.wait) || 0, 2000)))
            did.push(`waited ${st.wait}ms`)
          } else did.push(`skipped an unknown step: ${JSON.stringify(st).slice(0, 80)}`)
          await new Promise((r) => setTimeout(r, 60))
        } catch (e) { did.push(`step failed: ${e.message}`) }
      }
      const after = await evaluate('(window.__lc.iconBoxes(), { parts: window.__lc.parts(), errors: window.__lcOut.errors, toasts: window.__lcOut.toasts })')
      const errors = [...new Set([...(result.errors ?? []), ...after.errors])]
      // screenshots asked for mid-way always come back; the final ones only with `shots`
      const out = { ...result, ok: result.ok && !errors.length, parts: after.parts, errors, toasts: after.toasts, steps: did, shots: midShots }
      if (shots) {
        for (const v of viewports.slice(0, 2)) {
          await vp(v)
          await new Promise((r) => setTimeout(r, 150))
          // one screen high unless the whole page is asked for, at 1 CSS pixel per pixel (a phone's 2× costs 4× the tokens)
          const { contentSize } = await s('Page.getLayoutMetrics')
          const height = fullPage ? Math.min(Math.ceil(contentSize.height), 2400) : Math.min(Math.ceil(contentSize.height), VIEWPORTS[v].height)
          const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage, clip: { x: 0, y: 0, width: VIEWPORTS[v].width, height, scale: 1 / VIEWPORTS[v].deviceScaleFactor } })
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

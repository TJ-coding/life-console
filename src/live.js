// Claude (or another AI app connected to the workshop over MCP, server/mcp.mjs) working on this account's extensions:
// every console page listens, so its requests to confirm something and the changes it made show wherever you are.
import { reactive } from 'vue'
import { toast } from './store'
import { trustUrl, api } from './sdk/client.js'
import { loadPlugins } from './sdk/loader.js'
import { typingIn } from './keys.js'

/** The focused element, inside shadow roots too. */
const deepActive = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a }

/** `tick` goes up whenever Claude changed an extension (the Extensions screen refreshes on it). */
export const live = reactive({ tick: 0 })
let source = null
let devTimer

export function startLive() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource('/api/live')
  source.onmessage = (e) => {
    let m
    try { m = JSON.parse(e.data) } catch { return }
    if (m.type === 'ask') {
      // installing, updating and switching on are confirmed on the trusted page, as when you do them yourself
      const url = trustUrl(m.kind, m.params ?? {}, `/app${location.hash.split('?')[0] || '#/m/extensions'}`)
      toast(`Claude asks: ${m.text}`, { label: 'Review', run: () => { location.href = url } }, 45000)
    } else if (m.type === 'dev') {
      // a live test is on (or the draft under it changed): load the new version
      clearTimeout(devTimer)
      devTimer = setTimeout(loadPlugins, 200)
    } else if (m.type === 'dev-off') {
      // the draft's code is still running on this page (its parts, listeners from start()): only a reload stops it.
      // Reload now, unless the person is typing (then ask, so nothing they're writing is lost)
      if (typingIn({ target: document.activeElement, composedPath: () => [deepActive()] })) toast('Live test ended: reload to stop the draft', { label: 'Reload', run: () => location.reload() }, 60000)
      else location.reload()
    } else if (m.type === 'changed') {
      live.tick++
      // a removed or switched-off extension keeps running on this page until it reloads
      toast(m.text, /removed|switched off/.test(m.text) ? { label: 'Reload', run: () => location.reload() } : null)
    }
  }
}
/** Stop the live test from the console's bar; `undo` puts the planner back to the snapshot taken when it started. */
export async function stopDevTest(undo = false) {
  if (undo && !confirm('Put your planner back as it was when the live test started? Changes made since then, yours too, are undone.')) return
  try {
    await api('POST', '/api/workshop/dev/stop', { undo })
    // a reload is what stops the draft's code on this page (and loads the restored planner)
    location.reload()
  } catch (e) { toast(e.message) }
}
export function stopLive() { source?.close(); source = null }

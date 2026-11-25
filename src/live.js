// Claude (or another AI app connected to the workshop over MCP, server/mcp.mjs) working on this account's extensions:
// every console page listens, so its requests to confirm something and the changes it made show wherever you are.
import { reactive } from 'vue'
import { toast } from './store'
import { trustUrl } from './sdk/client.js'

/** `tick` goes up whenever Claude changed an extension (the Extensions screen refreshes on it). */
export const live = reactive({ tick: 0 })
let source = null

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
    } else if (m.type === 'changed') {
      live.tick++
      // a removed or switched-off extension keeps running on this page until it reloads
      toast(m.text, /removed|switched off/.test(m.text) ? { label: 'Reload', run: () => location.reload() } : null)
    }
  }
}
export function stopLive() { source?.close(); source = null }

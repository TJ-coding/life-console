// Small client for the plugin platform's endpoints, and the trusted page links (consent never happens in the console).
export async function api(method, path, body) {
  const r = await fetch(path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `request failed (${r.status})`), { status: r.status, trust: j.trust })
  return j
}
/** The trusted page for an action. It opens in this tab and comes back to where you are, with a short notice. */
export function trustUrl(kind, params = {}, backTo = null) {
  const here = backTo ?? `/app${(typeof location !== 'undefined' ? location.hash : '#/m/extensions').split('?')[0]}`
  const q = new URLSearchParams({ do: kind, ...params, back: here })
  return `/trust?${q}`
}
export const openTrust = (kind, params) => { location.href = trustUrl(kind, params) }

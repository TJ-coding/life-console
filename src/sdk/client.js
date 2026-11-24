// Small client for the plugin platform's endpoints, and the trusted page links (consent never happens in the console).
export async function api(method, path, body) {
  const r = await fetch(path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `request failed (${r.status})`), { status: r.status, trust: j.trust })
  return j
}
/** The trusted page for an action, opened in a tab of its own (the console can't reach it). */
export function trustUrl(kind, params = {}) {
  const q = new URLSearchParams({ do: kind, ...params })
  return `/trust?${q}`
}
export const openTrust = (kind, params) => window.open(trustUrl(kind, params), '_blank', 'noopener')

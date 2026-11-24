// OAuth connections (goal 8, gap G7): "Connect Strava once". The server admin registers an app with the provider and
// sets its client id and secret; the person connects on the trusted page; the tokens go into the vault (encrypted,
// never shown) and the broker adds them to requests, refreshing them when they expire. Plugins only ever say
// lc.connections.request('strava', …).
//
// Providers: built-in presets (Strava, GitHub, Google Calendar) plus any OAUTH_<NAME>_* settings:
//   OAUTH_STRAVA_CLIENT_ID, OAUTH_STRAVA_CLIENT_SECRET            (required to switch a preset on)
//   OAUTH_<NAME>_AUTH_URL, _TOKEN_URL, _SITE, _SCOPE, _TITLE     (a custom provider, or overrides for a preset)
export const PRESETS = {
  strava: { title: 'Strava', authUrl: 'https://www.strava.com/oauth/authorize', tokenUrl: 'https://www.strava.com/oauth/token', site: 'www.strava.com', scope: 'read,activity:read' },
  github: { title: 'GitHub', authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', site: 'api.github.com', scope: 'read:user repo' },
  'google-calendar': { title: 'Google Calendar', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', site: 'www.googleapis.com', scope: 'https://www.googleapis.com/auth/calendar.readonly', extra: { access_type: 'offline', prompt: 'consent' } },
}

/** The providers this server can connect to (those with a client id and secret). */
export function providersFrom(env = process.env) {
  const names = new Set([...Object.keys(PRESETS), ...Object.keys(env).map((k) => /^OAUTH_([A-Z0-9_]+)_CLIENT_ID$/.exec(k)?.[1]?.toLowerCase().replace(/_/g, '-')).filter(Boolean)])
  const out = {}
  for (const name of names) {
    const K = `OAUTH_${name.toUpperCase().replace(/-/g, '_')}_`
    const id = env[`${K}CLIENT_ID`], secret = env[`${K}CLIENT_SECRET`]
    if (!id || !secret) continue
    const base = PRESETS[name] ?? {}
    const p = {
      name, title: env[`${K}TITLE`] || base.title || name, clientId: id, clientSecret: secret,
      authUrl: env[`${K}AUTH_URL`] || base.authUrl, tokenUrl: env[`${K}TOKEN_URL`] || base.tokenUrl,
      site: (env[`${K}SITE`] || base.site || '').toLowerCase(), scope: env[`${K}SCOPE`] ?? base.scope ?? '', extra: base.extra ?? {},
    }
    if (p.authUrl && p.tokenUrl && p.site) out[name] = p
  }
  return out
}

/** Exchange an authorization code (or a refresh token) for tokens. */
export async function tokenRequest(p, params, fetchImpl = fetch) {
  const body = new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, ...params })
  const r = await fetchImpl(p.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw Object.assign(new Error(`${p.title} refused the connection${j.error ? `: ${j.error}` : ''}`), { status: 502 })
  return {
    access: j.access_token,
    refresh: j.refresh_token ?? params.refresh_token ?? null,
    expiresAt: j.expires_at ? j.expires_at * 1000 : j.expires_in ? Date.now() + j.expires_in * 1000 : null,
  }
}

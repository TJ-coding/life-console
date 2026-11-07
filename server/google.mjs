// "Sign in with Google" (OpenID Connect authorization-code flow with PKCE, done on the server).
//
//   GET /api/auth/google/start     → 302 to Google; state, nonce and PKCE verifier ride in a short-lived cookie
//   GET /api/auth/google/callback  → code exchanged at Google's token endpoint over TLS; the ID token from that
//                                    direct response is trusted per OIDC Core §3.1.3.7 (no JWKS needed), after
//                                    checking iss, aud, exp, nonce and email_verified.
import crypto from 'node:crypto'
import { httpError, parseCookies } from './auth.mjs'

const FLOW_COOKIE = 'lc_oauth'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const b64url = (buf) => Buffer.from(buf).toString('base64url')

export function createGoogle(cfg) {
  const redirectUri = `${cfg.appUrl}/api/auth/google/callback`
  const flowCookie = (value, maxAge) => `${FLOW_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`

  /** Where to send the browser, plus the cookie that remembers this attempt. */
  function start() {
    const state = b64url(crypto.randomBytes(24))
    const nonce = b64url(crypto.randomBytes(24))
    const verifier = b64url(crypto.randomBytes(32))
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
    const url = new URL(cfg.googleAuthUrl)
    url.search = new URLSearchParams({
      client_id: cfg.googleClientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    }).toString()
    return { location: url.toString(), cookie: flowCookie(b64url(JSON.stringify({ state, nonce, verifier })), 600) }
  }
  const clearFlow = () => flowCookie('', 0)

  /** Verify the callback and return the Google identity { sub, email, name }. */
  async function finish(req, query) {
    if (query.get('error')) throw httpError(400, query.get('error') === 'access_denied' ? 'Google sign-in was cancelled' : `Google said: ${query.get('error')}`)
    let flow
    try { flow = JSON.parse(Buffer.from(parseCookies(req.headers.cookie)[FLOW_COOKIE] || '', 'base64url').toString()) } catch { flow = null }
    const state = query.get('state') || ''
    if (!flow?.state || state.length !== flow.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) {
      throw httpError(400, 'Sign-in expired or was started in another browser — try again')
    }
    const r = await fetch(cfg.googleTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: query.get('code') || '', client_id: cfg.googleClientId, client_secret: cfg.googleClientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier }),
    })
    const tok = await r.json().catch(() => ({}))
    if (!r.ok || !tok.id_token) throw httpError(502, `Google sign-in failed (${tok.error || r.status})`)
    let c
    try { c = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()) } catch { throw httpError(502, 'Google sent an unreadable ID token') }
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
    if (!ISSUERS.includes(c.iss) || !aud.includes(cfg.googleClientId) || !(c.exp * 1000 > Date.now()) || c.nonce !== flow.nonce || !c.sub) {
      throw httpError(401, 'Google ID token failed validation')
    }
    if (!c.email || c.email_verified !== true) throw httpError(403, 'Your Google account email is not verified')
    return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: String(c.name || '').slice(0, 80) }
  }
  return { start, finish, clearFlow, redirectUri }
}

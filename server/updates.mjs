// Update notices for self-hosted servers, and the optional one-click update.
//
// Which version is this? The published image carries its commit (LC_BUILD_SHA, a build argument set by CI).
// Is there a newer one? GitHub's compare API (this commit…main) lists the commits since, and the image registry
// says which of them have a published image (sha-<short>), so we never announce a build that can't be pulled yet.
// Checked at start-up and every UPDATE_CHECK_HOURS; nothing is sent except the commit hash in the URL.
//
// One-click update: the app can't update itself (it must never hold the Docker socket: it faces the internet).
// The optional `updater` service in docker-compose.yml does, and the two share only a folder (UPDATE_DIR):
//   updater.json  the updater's heartbeat, rewritten every few seconds ("a button can work here")
//   request       written by the app when an admin presses Update; the updater deletes it and runs
//                 `docker compose pull app backup && docker compose up -d --wait app backup`
//   status.json   the updater's result: {state: running|done|failed, at (unix seconds)}
//   status.log    the output of those commands (shown to the admin when an update fails)
//   settings.json {autoUpdate, lastAutoTag}: the admin's auto-update switch (default AUTO_UPDATE, on), and the
//                 last build auto-update asked for, so a failed update isn't retried in a loop
//
// Auto-update: with the updater running and the switch on, a published newer build is requested by the app
// itself (checked every minute against the last GitHub check), exactly as if an admin had pressed Update.
// The app can only ask; what runs is fixed in the updater, so a compromised app can't run anything else.
import fs from 'node:fs'
import path from 'node:path'

const HEARTBEAT_MS = 60000 // the updater rewrites its heartbeat every 5 s; a minute of silence = not running
const REQUEST_STALE_MS = 10 * 60000

/** `ghcr.io/owner/name` → { registry: 'https://ghcr.io', repo: 'owner/name' }; Docker Hub names get its registry. */
export function parseImage(image) {
  const parts = String(image || '').split('/')
  const hasHost = parts.length > 1 && /[.:]|^localhost$/.test(parts[0])
  const host = hasHost ? parts.shift() : 'registry-1.docker.io'
  if (!hasHost && parts.length === 1) parts.unshift('library')
  return { registry: `${/^localhost|^127\./.test(host) ? 'http' : 'https'}://${host}`, repo: parts.join('/') }
}

const firstLine = (s) => String(s || '').split('\n')[0].trim()
const isMerge = (c) => (c.parents?.length || 0) > 1 || /^Merge (pull request|branch)/.test(firstLine(c.commit?.message))

export function createUpdates({ cfg, log = () => {}, fetchImpl = fetch }) {
  const sha = cfg.buildSha
  const pinned = !!cfg.lcVersion && cfg.lcVersion !== 'latest'
  const info = { checkedAt: null, error: '', latest: null, behind: 0, changes: [] }
  const reason = !cfg.updateCheck ? 'off' : !/^[0-9a-f]{7,40}$/.test(sha || '') ? 'unknown-build' : !cfg.githubRepo ? 'no-repo' : ''
  const img = parseImage(cfg.lcImage)

  const gh = (p) => fetchImpl(`${cfg.githubApi}${p}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'life-console' }, signal: AbortSignal.timeout(10000) })

  /** Does the registry have this tag? Anonymous pull token per the registry's WWW-Authenticate challenge. */
  let token = ''
  async function hasTag(tag) {
    const url = `${cfg.registryUrl || img.registry}/v2/${img.repo}/manifests/${tag}`
    const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'
    const head = () => fetchImpl(url, { method: 'HEAD', headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(10000) })
    let r = await head()
    if (r.status === 401) {
      const ch = r.headers.get('www-authenticate') || ''
      const realm = /realm="([^"]+)"/.exec(ch)?.[1]
      if (!realm) return false
      const q = new URLSearchParams()
      const service = /service="([^"]+)"/.exec(ch)?.[1]
      if (service) q.set('service', service)
      q.set('scope', /scope="([^"]+)"/.exec(ch)?.[1] || `repository:${img.repo}:pull`)
      const t = await fetchImpl(`${realm}?${q}`, { signal: AbortSignal.timeout(10000) })
      token = t.ok ? ((await t.json()).token || '') : ''
      if (!token) return false
      r = await head()
    }
    return r.ok
  }

  let checking = null
  async function check() {
    if (reason) return
    checking ||= (async () => {
      try {
        const r = await gh(`/repos/${cfg.githubRepo}/compare/${sha}...${cfg.updateBranch}`)
        if (r.status === 404) throw new Error(`commit ${sha.slice(0, 7)} isn't on ${cfg.githubRepo} (a fork or a local build?)`)
        if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
        const cmp = await r.json()
        const commits = cmp.status === 'ahead' || cmp.status === 'diverged' ? (cmp.commits || []) : []
        // newest first; the newest commit with a published image is the one people can update to
        let latest = null
        for (const c of [...commits].reverse().slice(0, 15)) {
          if (await hasTag(`sha-${c.sha.slice(0, 7)}`)) { latest = c; break }
        }
        const upto = latest ? commits.indexOf(latest) : -1
        const included = commits.slice(0, upto + 1)
        info.latest = latest ? { sha: latest.sha, tag: `sha-${latest.sha.slice(0, 7)}`, date: latest.commit?.committer?.date || latest.commit?.author?.date || null } : null
        info.behind = included.length
        info.changes = included.filter((c) => !isMerge(c)).reverse().slice(0, 30).map((c) => ({ sha: c.sha.slice(0, 7), title: firstLine(c.commit?.message).slice(0, 140), date: c.commit?.author?.date || null }))
        info.error = ''
        if (latest) log(`[update] a newer build is available: ${info.latest.tag} (${info.behind} commit${info.behind === 1 ? '' : 's'} ahead of ${sha.slice(0, 7)})`)
      } catch (e) {
        info.error = e.name === 'TimeoutError' ? 'GitHub or the image registry did not answer' : e.message
      } finally {
        info.checkedAt = new Date().toISOString()
        checking = null
      }
    })()
    return checking
  }

  /* ── the updater's shared folder ── */
  const dir = cfg.updateDir
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }
  const mtime = (f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs } catch { return 0 } }
  const tail = (f, n) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').slice(-n) } catch { return '' } }
  function updater() {
    if (!dir) return { present: false }
    const present = Date.now() - mtime('updater.json') < HEARTBEAT_MS
    const st = readJson('status.json')
    const requestedAt = mtime('request')
    const requested = !!requestedAt && Date.now() - requestedAt < REQUEST_STALE_MS
    return {
      present,
      requested,
      state: requested ? 'requested' : st?.state || null,
      log: st?.state === 'failed' ? tail('status.log', 2000) : '',
      at: Number(st?.at) ? new Date(Number(st.at) * 1000).toISOString() : null,
    }
  }

  const settings = () => { const j = readJson('settings.json') || {}; return { autoUpdate: typeof j.autoUpdate === 'boolean' ? j.autoUpdate : cfg.autoUpdate, lastAutoTag: j.lastAutoTag || '' } }
  const saveSettings = (patch) => {
    if (!dir) throw Object.assign(new Error('No updater folder on this server (UPDATE_DIR)'), { status: 409 })
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...settings(), ...patch }))
  }
  /** Switch auto-update on or off (admins, Settings → Server updates). */
  function setAutoUpdate(on) {
    saveSettings({ autoUpdate: !!on })
    log(`[update] auto-update ${on ? 'on' : 'off'}`)
    return status()
  }

  function status() {
    const u = updater()
    const st = settings()
    return {
      enabled: !reason,
      reason, // off | unknown-build | no-repo
      current: { sha: sha ? sha.slice(0, 7) : null, version: cfg.lcVersion || 'latest', image: cfg.lcImage },
      pinned,
      available: !!info.latest,
      latest: info.latest,
      behind: info.behind,
      changes: info.changes,
      checkedAt: info.checkedAt,
      error: info.error,
      updater: u,
      canApply: !!info.latest && !pinned && u.present,
      autoUpdate: st.autoUpdate, // the switch; it only acts while the updater runs and the version isn't pinned
    }
  }

  /** Auto-update: request the newest published build once, if the switch is on and nothing is in progress. */
  function maybeAutoUpdate() {
    if (reason || !dir || pinned || !info.latest) return
    const s = status()
    if (!s.autoUpdate || !s.updater.present || ['requested', 'running'].includes(s.updater.state)) return
    if (settings().lastAutoTag === info.latest.tag) return // already tried this one (and we're still here, so it failed)
    saveSettings({ lastAutoTag: info.latest.tag })
    log(`[update] auto-update to ${info.latest.tag}`)
    apply()
  }

  /** An admin pressed Update: leave the request for the updater. */
  function apply() {
    const s = status()
    if (!s.updater.present) throw Object.assign(new Error('The updater service isn\'t running on this server: update with docker compose (see Settings → Server updates)'), { status: 409 })
    if (pinned) throw Object.assign(new Error(`This server is pinned to LC_VERSION=${cfg.lcVersion}: change it in .env, then run docker compose up -d`), { status: 409 })
    if (s.updater.state === 'requested' || s.updater.state === 'running') return s
    fs.writeFileSync(path.join(dir, 'request'), JSON.stringify({ at: new Date().toISOString(), from: sha, to: info.latest?.tag || 'latest' }))
    log(`[update] update requested (${sha.slice(0, 7)} → ${info.latest?.tag || 'latest'})`)
    return status()
  }

  let timer = null
  let autoTimer = null
  return {
    status,
    check,
    apply,
    setAutoUpdate,
    maybeAutoUpdate,
    start() {
      if (reason) { if (reason === 'unknown-build' && cfg.updateCheck) log('[update] update notices off: this build has no LC_BUILD_SHA (built from source?)'); return }
      check()
      timer = setInterval(check, Math.max(1, cfg.updateCheckHours) * 3600e3)
      timer.unref()
      // the updater may start after the app, and the switch may change: look again every minute (no network)
      autoTimer = setInterval(() => { try { maybeAutoUpdate() } catch (e) { log('[update] auto-update failed:', e.message) } }, 60000)
      autoTimer.unref()
    },
    stop() { clearInterval(timer); clearInterval(autoTimer) },
  }
}

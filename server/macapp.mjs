// The Mac menu-bar app ("Life Console Now", source in mac/): where its latest release is.
//
// Mac releases are GitHub releases tagged mac-vX.Y.Z (built by .github/workflows/mac-release.yml) carrying
// LifeConsoleNow.zip (what the app's one-click update installs) and LifeConsoleNow.dmg (for people). This server
// looks them up at most hourly, so neither visitors' browsers nor the app talk to GitHub:
//   GET /api/mac/latest   {available, version, notes, url, zip, dmg, sha256} for the app's update check
//   GET /download/mac     → the latest .dmg      GET /download/mac.zip → the latest .zip (Terminal install)
const TAG = /^mac-v(\d+\.\d+\.\d+)$/

export function createMacApp({ cfg, log = () => {}, fetchImpl = fetch }) {
  let cache = { at: 0, info: { available: false } }
  let pending = null

  async function load() {
    const r = await fetchImpl(`${cfg.githubApi}/repos/${cfg.githubRepo}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'life-console' }, signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) throw new Error(`GitHub releases: HTTP ${r.status}`)
    const rel = (await r.json()).find((x) => !x.draft && !x.prerelease && TAG.test(x.tag_name || ''))
    if (!rel) return { available: false }
    const asset = (ext) => (rel.assets || []).find((a) => a.name?.toLowerCase().endsWith(ext))
    const zip = asset('.zip'), dmg = asset('.dmg')
    if (!zip) return { available: false }
    return {
      available: true,
      version: TAG.exec(rel.tag_name)[1],
      notes: String(rel.body || '').slice(0, 2000),
      url: rel.html_url,
      zip: zip.browser_download_url,
      dmg: dmg?.browser_download_url || zip.browser_download_url,
      sha256: /^sha256:([0-9a-f]{64})$/.exec(zip.digest || '')?.[1] || '',
    }
  }

  /** The latest Mac release; a failed lookup keeps the last good answer (and retries after 5 minutes). */
  async function latest() {
    if (!cfg.githubRepo) return { available: false }
    if (Date.now() - cache.at < 3600e3) return cache.info
    pending ??= load()
      .then((info) => { cache = { at: Date.now(), info } })
      .catch((e) => { log('[mac] release lookup failed:', e.message); cache.at = Date.now() - 3600e3 + 300e3 })
      .finally(() => { pending = null })
    await pending
    return cache.info
  }
  /** Where /download/mac sends people: the asset, or the releases page while there's none. */
  async function downloadUrl(kind) {
    const i = await latest()
    if (i.available) return kind === 'zip' ? i.zip : i.dmg
    return `https://github.com/${cfg.githubRepo || 'TJ-coding/life-console'}/releases`
  }
  return { latest, downloadUrl }
}

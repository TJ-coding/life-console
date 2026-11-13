// The Mac menu-bar app's release lookup (server/macapp.mjs): GET /api/mac/latest and the /download/mac redirects.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMacApp } from '../server/macapp.mjs'

const asset = (name, digest) => ({ name, browser_download_url: `https://github.test/dl/${name}`, ...(digest ? { digest } : {}) })
const SHA = 'a'.repeat(64)
const RELEASES = [
  { tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [asset('server.zip')] },           // a server release: skipped
  { tag_name: 'mac-v1.3.0', draft: true, prerelease: false, assets: [asset('LifeConsoleNow.zip')] }, // drafts: skipped
  { tag_name: 'mac-v1.2.0', draft: false, prerelease: true, assets: [asset('LifeConsoleNow.zip')] }, // pre-releases: skipped
  { tag_name: 'mac-v1.1.0', draft: false, prerelease: false, body: 'Notes', html_url: 'https://github.test/r/mac-v1.1.0',
    assets: [asset('LifeConsoleNow.zip', `sha256:${SHA}`), asset('LifeConsoleNow.dmg')] },
  { tag_name: 'mac-v1.0.0', draft: false, prerelease: false, assets: [asset('LifeConsoleNow.zip')] },
]
function fakeGitHub(releases, status = 200) {
  const f = async (url) => { f.calls.push(url); return { ok: status === 200, status, json: async () => releases } }
  f.calls = []
  return f
}
const cfg = { githubRepo: 'o/r', githubApi: 'https://api.github.test' }

test('latest: the newest published mac-v release with its zip, dmg and checksum; server releases, drafts and pre-releases skipped', async () => {
  const gh = fakeGitHub(RELEASES)
  const m = createMacApp({ cfg, fetchImpl: gh })
  assert.deepEqual(await m.latest(), {
    available: true, version: '1.1.0', notes: 'Notes', url: 'https://github.test/r/mac-v1.1.0',
    zip: 'https://github.test/dl/LifeConsoleNow.zip', dmg: 'https://github.test/dl/LifeConsoleNow.dmg', sha256: SHA,
  })
  assert.equal(gh.calls[0], 'https://api.github.test/repos/o/r/releases?per_page=30')
  await m.latest(); await m.latest()
  assert.equal(gh.calls.length, 1, 'looked up at most hourly, not per request')
  assert.equal(await m.downloadUrl('dmg'), 'https://github.test/dl/LifeConsoleNow.dmg')
  assert.equal(await m.downloadUrl('zip'), 'https://github.test/dl/LifeConsoleNow.zip')
})

test('latest: no Mac release yet, GitHub down or no repo → not available, and downloads go to the releases page', async () => {
  for (const m of [createMacApp({ cfg, fetchImpl: fakeGitHub(RELEASES.slice(0, 1)) }), createMacApp({ cfg, fetchImpl: fakeGitHub([], 503) })]) {
    assert.deepEqual(await m.latest(), { available: false })
    assert.equal(await m.downloadUrl('dmg'), 'https://github.com/o/r/releases')
  }
  const none = fakeGitHub(RELEASES)
  assert.deepEqual(await createMacApp({ cfg: { ...cfg, githubRepo: '' }, fetchImpl: none }).latest(), { available: false })
  assert.equal(none.calls.length, 0, 'GITHUB_REPO empty: GitHub is never contacted')
})

test('latest: a failed lookup keeps the last good answer', async () => {
  const gh = fakeGitHub(RELEASES)
  const m = createMacApp({ cfg, fetchImpl: gh })
  assert.equal((await m.latest()).version, '1.1.0')
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 2 * 3600e3 // the hour is up …
    const failing = createMacApp({ cfg, fetchImpl: fakeGitHub([], 500) })
    assert.equal((await failing.latest()).available, false)
  } finally { Date.now = realNow }
})

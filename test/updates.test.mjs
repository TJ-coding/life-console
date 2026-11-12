// Update notices and the one-click update hand-off (server/updates.mjs), against a fake GitHub and image registry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createUpdates, parseImage } from '../server/updates.mjs'

const OURS = 'a'.repeat(40)
const sha = (c) => c.repeat(40)
const commit = (s, message, parents = 1) => ({ sha: s, parents: Array(parents).fill({}), commit: { message, author: { date: '2026-11-10T10:00:00Z' }, committer: { date: '2026-11-10T10:00:00Z' } } })
// main has 4 commits since ours (oldest first): a feature, its merge (published), another feature, its merge (CI still running)
const COMMITS = [commit(sha('b'), 'Briefing cards\n\nlong body'), commit(sha('c'), 'Merge pull request #52 from x/y', 2), commit(sha('d'), 'Days filter'), commit(sha('e'), 'Merge pull request #53 from x/z', 2)]

function fakeNet({ published = [sha('c')], compare = { status: 'ahead', commits: COMMITS }, compareStatus = 200 } = {}) {
  const calls = []
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url)
    const u = new URL(url)
    if (u.host === 'api.github.test') {
      assert.equal(u.pathname, `/repos/o/r/compare/${OURS}...main`)
      return new Response(JSON.stringify(compare), { status: compareStatus })
    }
    if (u.pathname === '/token') return Response.json({ token: 'anon' })
    const tag = u.pathname.split('/').pop()
    if (opts.headers?.Authorization !== 'Bearer anon') return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://reg.test/token",service="reg.test",scope="repository:o/r:pull"' } })
    return new Response(null, { status: published.some((s) => `sha-${s.slice(0, 7)}` === tag) ? 200 : 404 })
  }
  return { fetchImpl, calls }
}
const cfgWith = (over = {}) => ({ updateCheck: true, updateCheckHours: 6, updateBranch: 'main', buildSha: OURS, githubRepo: 'o/r', githubApi: 'https://api.github.test', lcImage: 'reg.test/o/r', lcVersion: 'latest', registryUrl: '', updateDir: '', autoUpdate: true, ...over })

test('image names map to their registry', () => {
  assert.deepEqual(parseImage('ghcr.io/tj-coding/life-console'), { registry: 'https://ghcr.io', repo: 'tj-coding/life-console' })
  assert.deepEqual(parseImage('someone/lc'), { registry: 'https://registry-1.docker.io', repo: 'someone/lc' })
  assert.deepEqual(parseImage('localhost:5000/lc'), { registry: 'http://localhost:5000', repo: 'lc' })
})

test('announces the newest commit that has a published image, with the changes up to it', async () => {
  const net = fakeNet()
  const u = createUpdates({ cfg: cfgWith(), fetchImpl: net.fetchImpl })
  await u.check()
  const s = u.status()
  assert.equal(s.enabled, true)
  assert.equal(s.available, true)
  assert.equal(s.latest.tag, `sha-${sha('c').slice(0, 7)}`, 'sha-eeeeeee is not on the registry yet')
  assert.equal(s.behind, 2)
  assert.deepEqual(s.changes.map((c) => c.title), ['Briefing cards'], 'merge commits and unpublished commits are left out')
  assert.equal(s.canApply, false, 'no updater running')
  assert.ok(net.calls.some((c) => c.startsWith('https://reg.test/token?') && c.includes('scope=repository%3Ao%2Fr%3Apull')))
})

test('up to date, unknown builds and GitHub errors', async () => {
  let u = createUpdates({ cfg: cfgWith(), fetchImpl: fakeNet({ compare: { status: 'identical', commits: [] } }).fetchImpl })
  await u.check()
  assert.equal(u.status().available, false)
  assert.equal(u.status().error, '')

  u = createUpdates({ cfg: cfgWith(), fetchImpl: fakeNet({ published: [] }).fetchImpl })
  await u.check()
  assert.equal(u.status().available, false, 'nothing published yet = nothing to announce')

  u = createUpdates({ cfg: cfgWith(), fetchImpl: fakeNet({ compareStatus: 404 }).fetchImpl })
  await u.check()
  assert.match(u.status().error, /isn't on o\/r/)

  const net = fakeNet()
  u = createUpdates({ cfg: cfgWith({ buildSha: '' }), fetchImpl: net.fetchImpl })
  await u.check()
  assert.equal(u.status().enabled, false)
  assert.equal(u.status().reason, 'unknown-build')
  u = createUpdates({ cfg: cfgWith({ updateCheck: false }), fetchImpl: net.fetchImpl })
  await u.check()
  assert.equal(u.status().reason, 'off')
  assert.equal(net.calls.length, 0, 'never contacts GitHub when off or without a build commit')
})

test('one-click update: only with a live updater, never when pinned; request and failure log through the shared folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-updates-'))
  const u = createUpdates({ cfg: cfgWith({ updateDir: dir }), fetchImpl: fakeNet().fetchImpl })
  await u.check()
  assert.equal(u.status().updater.present, false)
  assert.throws(() => u.apply(), (e) => e.status === 409)

  fs.writeFileSync(path.join(dir, 'updater.json'), '{"at":1}') // heartbeat (fresh mtime)
  assert.equal(u.status().canApply, true)
  const s = u.apply()
  assert.equal(s.updater.state, 'requested')
  assert.match(fs.readFileSync(path.join(dir, 'request'), 'utf8'), /sha-ccccccc/)
  u.apply() // pressing again while it's pending is harmless

  fs.renameSync(path.join(dir, 'request'), path.join(dir, 'request.taken')) // the updater takes it
  fs.writeFileSync(path.join(dir, 'status.json'), `{"state":"failed","at":${Math.floor(Date.now() / 1000)}}`)
  fs.writeFileSync(path.join(dir, 'status.log'), 'pulling\nError: manifest unknown\n')
  const f = u.status().updater
  assert.equal(f.state, 'failed')
  assert.match(f.log, /manifest unknown/)
  assert.ok(f.at)

  const old = new Date(Date.now() - 5 * 60000)
  fs.utimesSync(path.join(dir, 'updater.json'), old, old)
  assert.equal(u.status().updater.present, false, 'a silent updater counts as gone')

  fs.rmSync(dir, { recursive: true })
})

test('auto-update: on by default, requests the new build once, and the admin switch turns it off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-auto-'))
  const beat = () => fs.writeFileSync(path.join(dir, 'updater.json'), '{"at":1}')
  const req = path.join(dir, 'request')
  const u = createUpdates({ cfg: cfgWith({ updateDir: dir, autoUpdate: true }), fetchImpl: fakeNet().fetchImpl })
  await u.check()
  assert.equal(u.status().autoUpdate, true)
  u.maybeAutoUpdate()
  assert.equal(fs.existsSync(req), false, 'no updater running: nothing requested')

  beat()
  u.maybeAutoUpdate()
  assert.match(fs.readFileSync(req, 'utf8'), /sha-ccccccc/)
  // the updater takes it and fails; the old app is still here and must not retry the same build forever
  fs.renameSync(req, `${req}.taken`)
  fs.writeFileSync(path.join(dir, 'status.json'), `{"state":"failed","at":${Math.floor(Date.now() / 1000)}}`)
  u.maybeAutoUpdate()
  assert.equal(fs.existsSync(req), false, 'a failed build is not retried automatically')
  assert.equal(u.status().canApply, true, 'but an admin can still press Update')

  // switched off: a newer build is announced but not installed
  assert.equal(u.setAutoUpdate(false).autoUpdate, false)
  const off = createUpdates({ cfg: cfgWith({ updateDir: dir, autoUpdate: true }), fetchImpl: fakeNet({ published: [sha('c'), sha('e')] }).fetchImpl })
  await off.check()
  assert.equal(off.status().autoUpdate, false, 'the admin\'s choice outlives restarts and beats AUTO_UPDATE')
  off.maybeAutoUpdate()
  assert.equal(fs.existsSync(req), false)
  off.setAutoUpdate(true)
  off.maybeAutoUpdate()
  assert.match(fs.readFileSync(req, 'utf8'), /sha-eeeeeee/, 'a newer build than the failed one is tried')

  // AUTO_UPDATE=off is only the starting value
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-auto-'))
  assert.equal(createUpdates({ cfg: cfgWith({ updateDir: fresh, autoUpdate: false }) }).status().autoUpdate, false)
  fs.rmSync(dir, { recursive: true }); fs.rmSync(fresh, { recursive: true })
})

test('pinned servers never update themselves', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-pinned-'))
  const pinned = createUpdates({ cfg: cfgWith({ updateDir: dir, lcVersion: 'sha-aaaaaaa' }), fetchImpl: fakeNet().fetchImpl })
  await pinned.check()
  fs.writeFileSync(path.join(dir, 'updater.json'), '{"at":1}')
  assert.equal(pinned.status().pinned, true)
  assert.equal(pinned.status().canApply, false)
  assert.throws(() => pinned.apply(), /pinned/)
  pinned.maybeAutoUpdate()
  assert.equal(fs.existsSync(path.join(dir, 'request')), false)
  fs.rmSync(dir, { recursive: true })
})

// Tiny JSON-file persistence in DATA_DIR (a Docker volume in production).
import fs from 'node:fs'
import path from 'node:path'

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const file = (name) => path.join(dir, name)
  function read(name, fallback) {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')) } catch { return fallback }
  }
  /** Atomic write: write a temp file then rename over the target. */
  function write(name, value) {
    const target = file(name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value))
    fs.renameSync(tmp, target)
  }
  /** Keep a copy of a state document before it is overwritten (last `keep` copies). */
  function backup(doc, keep = 30) {
    if (!doc?.version) return
    write(path.join('history', `v${String(doc.version).padStart(6, '0')}-${Date.now()}.json`), doc)
    const files = fs.readdirSync(file('history')).sort()
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(file(path.join('history', f)))
  }
  return { read, write, backup, dir }
}

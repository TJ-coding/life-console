// Renders the free printable templates (templates/pdf/<name>.html) to public/media/templates/<name>.pdf,
// plus a <name>.webp preview, with headless Chrome. The PDFs are committed, so the build and the server never need a browser.
//
// puppeteer-core isn't a project dependency (keep it out of the app): install it in a scratch folder and pass that folder.
//   mkdir -p /tmp/pup && npm i --prefix /tmp/pup puppeteer-core@23.11.1
//   PUPPETEER_DIR=/tmp/pup node scripts/template-pdfs.mjs [name …]
// Optional: CHROME=<path to Chrome> (default: the macOS Google Chrome app).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'templates', 'pdf')
const out = path.join(root, 'public', 'media', 'templates')

if (!process.env.PUPPETEER_DIR) {
  console.error('Set PUPPETEER_DIR to a folder with puppeteer-core installed (see the comment at the top of this file).')
  process.exit(1)
}
const puppeteer = createRequire(path.join(path.resolve(process.env.PUPPETEER_DIR), 'noop.js'))('puppeteer-core')

const names = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(src).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5))
fs.mkdirSync(out, { recursive: true })
// which page (0-based) becomes <name>.webp, the preview on the template's web page
const PREVIEW_PAGE = { 'weekly-time-blocking-planner': 1 }

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--allow-file-access-from-files'],
})
try {
  for (const name of names) {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(path.join(src, `${name}.html`)).href, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    const file = path.join(out, `${name}.pdf`)
    // @page in each source sets the paper size and margins; the title becomes the PDF's title
    await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true, tagged: true })
    const pages = (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    // a preview image for the web page (and image search): the page that shows the method best
    const shot = path.join(out, `${name}.webp`)
    await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1.4 })
    await page.emulateMediaType('print')
    const sheet = (await page.$$('.page'))[PREVIEW_PAGE[name] ?? 0]
    await page.evaluate((el) => { el.style.background = '#fff'; el.style.padding = '8mm' }, sheet)
    await sheet.screenshot({ path: shot, type: 'webp', quality: 82 })
    console.log(`${path.relative(root, file)}: ${pages} page(s), ${Math.round(fs.statSync(file).size / 1024)} KB; preview ${Math.round(fs.statSync(shot).size / 1024)} KB`)
    await page.close()
  }
} finally {
  await browser.close()
}

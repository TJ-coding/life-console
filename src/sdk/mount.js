// Rendering a plugin's part (a page, a slot, a settings section) into the console. A part is either a Vue component
// (Core plugins) or { mount(el, lc, props) → cleanup?, shadow? } (any framework, or none). Public parts render
// inside a Shadow DOM by default, so their styles can't restyle the console by accident; `shadow: false` opts out.
// Errors stay inside the part's box: the console keeps working.
import { h, render as vueRender } from 'vue'
import { makeLc } from './lc.js'
import { KIT, KIT_CLASSES } from './kit.js'

const isVueComponent = (p) => p && typeof p === 'object' && !p.mount && (p.setup || p.render || p.template || p.__name || p.name || p.components)

/** Mount `part` into `el`; returns a cleanup function. onError(e) is called when it fails. */
export function mountPart(el, part, { pluginId, props = {}, publicPart = false, styles = null, onError = () => {} } = {}) {
  if (!el || !part) return () => {}
  try {
    if (isVueComponent(part) || typeof part === 'function') {
      vueRender(h(part, props), el)
      return () => vueRender(null, el)
    }
    if (typeof part.mount !== 'function') throw new Error('a part needs mount(el, lc) or a Vue component')
    let target = el
    if (publicPart && part.shadow !== false) {
      const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
      // the look kit: plain HTML looks native and the lc-* classes work (src/sdk/kit.js)
      root.innerHTML = `<style>${KIT}</style><div></div>`
      // the plugin's own `styles`: the copy in <head> (loader.js) can't reach inside a shadow root
      if (styles) { const st = document.createElement('style'); st.textContent = styles; root.insertBefore(st, root.lastElementChild) }
      target = root.lastElementChild
    } else if (publicPart && !document.getElementById('lc-kit')) {
      const st = document.createElement('style'); st.id = 'lc-kit'; st.textContent = KIT_CLASSES; document.head.appendChild(st)
    }
    const cleanup = part.mount(target, makeLc(pluginId), props)
    return () => { try { if (typeof cleanup === 'function') cleanup() } catch { /* ignore */ } el.shadowRoot ? (el.shadowRoot.innerHTML = '') : (el.innerHTML = '') }
  } catch (e) {
    console.warn(`[plugin] ${pluginId} failed to render`, e)
    onError(e)
    return () => {}
  }
}

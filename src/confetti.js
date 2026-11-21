// A confetti burst drawn on a canvas, gone after ~3 s: the tour's finish and the "your issue is fixed" note.
// Decoration only; nothing under prefers-reduced-motion. alive(): stop early when it returns false.
export function burst(cv, { cx = innerWidth / 2, cy = innerHeight * 0.42, count = 160, alive = () => true } = {}) {
  if (!cv || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const dpr = devicePixelRatio || 1
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const css = getComputedStyle(document.documentElement)
  const colors = ['--accent', '--info', '--warn', '--danger', '--cat-research', '--cat-academic'].map((v) => css.getPropertyValue(v).trim() || '#3fb68b')
  const power = count > 100 ? 9 : 6
  const bits = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * power
    return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: 3 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, round: Math.random() < 0.3 }
  })
  const t0 = performance.now()
  const frame = (t) => {
    const k = (t - t0) / 3000
    g.clearRect(0, 0, innerWidth, innerHeight)
    if (k >= 1 || !alive()) return
    g.globalAlpha = 1 - k * k
    for (const b of bits) {
      b.vy += 0.22; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.rot += b.vr
      g.save(); g.translate(b.x, b.y); g.rotate(b.rot); g.fillStyle = b.c
      if (b.round) { g.beginPath(); g.arc(0, 0, b.r * 0.6, 0, 7); g.fill() } else g.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2)
      g.restore()
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

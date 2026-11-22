// Goal dates: the dated PSGs and SIGs of active plans, as their own kind of dated item.
// A deadline is a hard date set from outside (entries close, a bill); a goal date is your own target for an
// outcome. They appear side by side (Deadlines screen, Today, reminders) but look and behave differently: a goal
// date has progress, and a missed one is "late", never "overdue". Nothing is stored: they are read from the plans,
// so moving a goal's time bound moves its date everywhere, and finishing the goal clears it.
// Pure (no Vue): the app and the server's reminder scheduler both use it.

const DATE = /^\d{4}-\d{2}-\d{2}$/
const pctOf = (g) => Math.max(0, Math.min(100, Number(g.pct) || 0))

/**
 * Open goal dates, soonest first: [{ key, no, kind: 'psg'|'sig', psg, planId, planNo, title, date, pct }].
 * A goal that already has an open deadline linked to it on the same day is left out (the deadline marks that day).
 */
export function goalDates(state) {
  const out = []
  for (const p of state?.plans ?? []) {
    if ((p.status ?? 'active') !== 'active') continue
    const sigs = p.sigs ?? []
    const add = (g, kind, pct) => {
      if (!DATE.test(g.timeBound ?? '') || g.status === 'done' || pct >= 100) return
      out.push({ key: `${p.id}/${g.no}`, no: g.no, kind, psg: kind === 'sig' ? g.psg : g.no, planId: p.id, planNo: p.planNo, title: g.name || g.no, date: g.timeBound, pct })
    }
    for (const g of p.psgs ?? []) {
      const kids = sigs.filter((s) => s.psg === g.no)
      add(g, 'psg', kids.length ? Math.round(kids.reduce((a, s) => a + pctOf(s), 0) / kids.length) : 0)
    }
    for (const s of sigs) add(s, 'sig', pctOf(s))
  }
  const marked = new Set((state?.deadlines ?? []).filter((d) => !d.done && d.source && d.due).map((d) => `${d.source}@${d.due.slice(0, 10)}`))
  return out.filter((g) => !marked.has(`${g.no}@${g.date}`)).sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no))
}

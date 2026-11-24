// The shared vocabulary every plugin speaks (goal 5, platform/plugins-vocabulary.md): types, "kind of", traits,
// tags, links and sameAs. Plain JSON, no RDF inside. Pure JS (no Vue): the browser, the server and Node tests use it.
//
// A taxonomy is the merge of the core and common terms with every installed plugin's additions and the person's
// own tags (buildTaxonomy). Names are dotted: `core.Todo`, `habits.Habit`; a term's prefix (before the first dot)
// is its owner's namespace, and only that owner may define terms under it.

/** Traits: named field sets that views understand. check(record) returns an error string or null. */
const isStr = (v) => typeof v === 'string' && v.length > 0
const isDateish = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
export const TRAITS = {
  titled: { desc: 'Has a title', check: (r) => (isStr(r.title) ? null : 'needs a title') },
  dated: { desc: 'Has a due date, or a start and end', check: (r) => (r.due == null || isDateish(r.due) || r.due === '' ? null : 'due must be a date') },
  scheduled: { desc: 'Has a scheduled time or a linked time block', check: () => null },
  status: { desc: 'Done or not, or a status tag', check: (r) => (r.done == null || typeof r.done === 'boolean' ? null : 'done must be true or false') },
  progress: { desc: 'Progress from 0 to 1', check: (r) => (r.progress == null || (typeof r.progress === 'number' && r.progress >= 0 && r.progress <= 1) ? null : 'progress must be between 0 and 1') },
  recurring: { desc: 'Repeats', check: (r) => (r.repeat == null || isRepeat(r.repeat) ? null : 'repeat must be daily, weekdays, weekly:<days> or every:<n>') },
  happened: { desc: 'Happened at a time', check: (r) => (r.at == null || isDateish(r.at) ? null : 'at must be a date-time') },
  estimated: { desc: 'Has a time estimate in minutes', check: (r) => (r.timeMin == null || Number.isFinite(r.timeMin) ? null : 'timeMin must be a number') },
  partOf: { desc: 'Belongs to a project, plan, goal or parent', check: () => null },
  serves: { desc: 'Serves a goal', check: () => null },
  about: { desc: 'Is about a tag or a record', check: () => null },
}
/** daily | weekdays | weekly:mon,wed | every:3 (days) */
export function isRepeat(v) {
  if (v === 'daily' || v === 'weekdays') return true
  if (typeof v !== 'string') return false
  if (/^every:[1-9]\d{0,2}$/.test(v)) return true
  const m = /^weekly:([a-z,]+)$/.exec(v)
  return !!m && m[1].split(',').every((d) => DAYS.includes(d))
}
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** The fixed relations; a plugin's own link must be a kind of one of these. */
export const LINKS = {
  partOf: 'Belongs to a project, plan, goal or parent record',
  serves: 'Works towards a goal',
  supports: 'Is evidence for a claim',
  contradicts: 'Is evidence against a claim',
  blocks: 'Has to happen before another record',
  about: 'Is about a tag or a record',
  relatedTo: 'Is related (the catch-all)',
}

/** Core types: the planner's own records. `store` is where they live in the planner document. */
export const CORE_TYPES = {
  'core.Todo': { label: 'Task', store: 'todos', traits: ['titled', 'dated', 'scheduled', 'status', 'estimated', 'partOf'], sameAs: 'schema:Action' },
  'core.TimeBlock': { label: 'Time block', store: 'timeBlocks', traits: ['titled', 'dated', 'scheduled'], sameAs: 'schema:Event' },
  'core.Deadline': { label: 'Deadline', store: 'deadlines', traits: ['titled', 'dated', 'status'], sameAs: 'schema:Event' },
  'core.Plan': { label: 'Plan', store: 'plans', traits: ['titled', 'progress'], sameAs: 'schema:Project' },
  'core.Goal': { label: 'Goal', traits: ['titled', 'dated', 'progress', 'partOf'] },
  'core.Milestone': { label: 'Milestone', traits: ['titled', 'dated', 'status', 'partOf'] },
  'core.Routine': { label: 'Routine', traits: ['titled', 'recurring'] },
  'core.Reminder': { label: 'Reminder', store: 'reminders', traits: ['titled', 'dated', 'recurring'] },
  'core.LogEntry': { label: 'Log entry', traits: ['titled', 'happened', 'about'] },
  'core.Review': { label: 'Review', store: 'reviews', traits: ['happened'], sameAs: 'schema:Review' },
  'core.Note': { label: 'Note', traits: ['titled', 'about'] },
  'core.Person': { label: 'Person', traits: ['titled'], sameAs: 'schema:Person' },
}
/** Common types: shared by many plugins, ours, open to proposals. */
export const COMMON_TYPES = {
  'common.Paper': { label: 'Paper', traits: ['titled', 'about', 'status'], sameAs: 'schema:ScholarlyArticle' },
  'common.Book': { label: 'Book', traits: ['titled', 'about', 'status'], sameAs: 'schema:Book' },
  'common.Course': { label: 'Course', traits: ['titled'], sameAs: 'schema:Course' },
  'common.Workout': { label: 'Workout', kindOf: 'core.LogEntry', traits: ['titled', 'happened', 'about'], sameAs: 'schema:ExerciseAction' },
  'common.Habit': { label: 'Habit', kindOf: 'core.Routine', traits: ['titled', 'recurring', 'progress', 'serves'] },
  'common.Meeting': { label: 'Meeting', kindOf: 'core.TimeBlock', traits: ['titled', 'dated', 'scheduled'], sameAs: 'schema:Event' },
  'common.Expense': { label: 'Expense', kindOf: 'core.LogEntry', traits: ['titled', 'happened'] },
  'common.Experiment': { label: 'Experiment', kindOf: 'core.Milestone', traits: ['titled', 'dated', 'status', 'partOf'] },
}
/** Tag trees: id → { label, parent }. */
export const CORE_TAGS = {
  'core.kinds': { label: 'Kinds of work' },
  'core.kinds.research': { label: 'Research', parent: 'core.kinds' },
  'core.kinds.academic': { label: 'Academic', parent: 'core.kinds' },
  'core.kinds.experiment': { label: 'Experiment', parent: 'core.kinds' },
  'core.kinds.kaizen': { label: 'Kaizen', parent: 'core.kinds' },
  'core.status': { label: 'Status' },
  'core.status.open': { label: 'Open', parent: 'core.status' },
  'core.status.doing': { label: 'Doing', parent: 'core.status' },
  'core.status.done': { label: 'Done', parent: 'core.status' },
  'core.status.dropped': { label: 'Dropped', parent: 'core.status' },
  'core.areas': { label: 'Areas of life' },
  'common.activities': { label: 'Activities' },
  ...Object.fromEntries(['run', 'ride', 'swim', 'walk', 'strength', 'yoga'].map((a) => [`common.activities.${a}`, { label: a[0].toUpperCase() + a.slice(1), parent: 'common.activities' }])),
}
export const CORE_EVENTS = ['record.changed', 'todo.done', 'block.started', 'block.ended', 'goal.progressed', 'day.closed', 'week.started']

const NAME = /^[a-z][a-z0-9-]*(\.[A-Za-z0-9-]+)+$/
/** The namespace (owner prefix) of a dotted name: `habits.Habit` → `habits`. */
export const prefixOf = (name) => String(name).split('.')[0]
const RESERVED = new Set(['core', 'common', 'schema', 'x'])

/**
 * Merge the core and common vocabulary with plugins' additions and the person's own tags.
 * plugins: [{ id: 'alice/habits', ns: 'habits', types, tags, links, traits, events, sameAs }]
 * own: { tags: { id: { label, parent } } } (the person's tags, under `me.`)
 * Returns the taxonomy plus `problems`: additions it refused (it never throws on a plugin's mistake).
 */
export function buildTaxonomy(plugins = [], own = {}) {
  const types = {}, tags = { ...CORE_TAGS }, links = { ...LINKS }, traits = { ...TRAITS }, events = new Set(CORE_EVENTS)
  const same = new Map() // term → canonical term
  const owners = {} // namespace → plugin id
  const problems = []
  for (const [k, v] of Object.entries({ ...CORE_TYPES, ...COMMON_TYPES })) types[k] = { ...v, owner: prefixOf(k) }
  const ownsIt = (p, name, what) => {
    if (!NAME.test(name)) { problems.push(`${p.id}: ${what} "${name}" must be a dotted name like ${p.ns}.Thing`); return false }
    const pre = prefixOf(name)
    if (pre !== p.ns) { problems.push(`${p.id}: ${what} "${name}" must start with "${p.ns}." (the extension's name): call it ${p.ns}.${name.split('.').slice(1).join('.')}, or name the extension ${pre}`); return false }
    return true
  }
  for (const p of plugins) {
    if (!p?.ns || RESERVED.has(p.ns) || !/^[a-z][a-z0-9-]*$/.test(p.ns)) { problems.push(`${p?.id}: namespace "${p?.ns}" isn't allowed`); continue }
    if (owners[p.ns] && owners[p.ns] !== p.id) { problems.push(`${p.id}: namespace "${p.ns}" already belongs to ${owners[p.ns]}`); continue }
    owners[p.ns] = p.id
    for (const t of p.types ?? []) {
      if (!ownsIt(p, t.type, 'type')) continue
      const bad = (t.traits ?? []).filter((x) => !TRAITS[x] && !(p.traits ?? []).some((y) => y.id === x))
      if (bad.length) problems.push(`${p.id}: ${t.type} names unknown traits ${bad.join(', ')} (ignored)`)
      types[t.type] = { label: t.label ?? t.type, kindOf: t.kindOf, traits: (t.traits ?? []).filter((x) => !bad.includes(x)), fields: t.fields ?? {}, sameAs: t.sameAs, owner: p.ns, plugin: p.id }
    }
    for (const g of p.tags ?? []) if (ownsIt(p, g.id, 'tag')) tags[g.id] = { label: g.label ?? g.id, parent: g.parent }
    for (const l of p.links ?? []) {
      if (!ownsIt(p, l.id, 'link')) continue
      if (!LINKS[l.kindOf]) { problems.push(`${p.id}: link ${l.id} must be a kind of one of ${Object.keys(LINKS).join(', ')}`); continue }
      links[l.id] = { desc: l.desc ?? '', kindOf: l.kindOf }
    }
    for (const tr of p.traits ?? []) if (ownsIt(p, tr.id, 'trait')) traits[tr.id] = { desc: tr.desc ?? '', fields: tr.fields ?? [], check: () => null }
    for (const e of p.events ?? []) if (ownsIt(p, e, 'event')) events.add(e)
    for (const s of p.sameAs ?? []) same.set(s.from, s.to)
  }
  for (const [id, g] of Object.entries(own.tags ?? {})) if (id.startsWith('me.')) tags[id] = { label: g.label ?? id, parent: g.parent }
  // kind-of must point at a known type and must not loop
  for (const [k, t] of Object.entries(types)) {
    if (t.kindOf && !types[t.kindOf]) { problems.push(`${k}: kind of unknown type ${t.kindOf} (ignored)`); delete t.kindOf }
    const seen = new Set([k])
    for (let c = t.kindOf; c; c = types[c]?.kindOf) {
      if (seen.has(c)) { problems.push(`${k}: kind-of loop (ignored)`); delete t.kindOf; break }
      seen.add(c)
    }
  }
  return makeTaxonomy({ types, tags, links, traits, events, same, problems })
}

function makeTaxonomy({ types, tags, links, traits, events, same, problems }) {
  /** Follow sameAs to the canonical term (two plugins' "Run" become one tag). */
  const canonical = (term) => { let t = term; const seen = new Set(); while (same.has(t) && !seen.has(t)) { seen.add(t); t = same.get(t) } return t }
  /** The chain from a type up through its kind-of parents. */
  const ancestry = (type) => { const out = []; for (let t = canonical(type); t && types[t] && !out.includes(t); t = types[t].kindOf) out.push(t); return out }
  const isKindOf = (type, ancestor) => ancestry(type).includes(canonical(ancestor))
  /** Every trait a type has, its own and its parents'. */
  const traitsOf = (type) => [...new Set(ancestry(type).flatMap((t) => types[t].traits ?? []))]
  /** Where records of a type live in the planner document: its own store, or the nearest parent's (core records), else entities. */
  const storeOf = (type) => ancestry(type).map((t) => types[t].store).find(Boolean) ?? 'entities'
  /** Is a tag under another one (or the same)? */
  const isUnder = (tag, ancestor) => { const a = canonical(ancestor); for (let t = canonical(tag), n = 0; t && n < 50; t = tags[t]?.parent, n++) if (t === a) return true; return false }
  /** Is a link a kind of a standard link (or that link itself)? */
  const linkBase = (link) => (LINKS[link] ? link : links[link]?.kindOf ?? null)
  /** Check a record against its type: traits and declared fields. Returns a list of problems (empty = valid). */
  function validate(type, record) {
    const t = types[canonical(type)]
    if (!t) return [`unknown type ${type}`]
    const errs = []
    for (const tr of traitsOf(type)) { const e = traits[tr]?.check?.(record); if (e) errs.push(e) }
    for (const anc of ancestry(type)) {
      for (const [f, spec] of Object.entries(types[anc].fields ?? {})) {
        const v = record[f]
        if (v == null || v === '') { if (spec.required) errs.push(`${f} is required`); continue }
        if (spec.enum && !spec.enum.includes(v)) errs.push(`${f} must be one of ${spec.enum.join(', ')}`)
        if (spec.type === 'number' && !Number.isFinite(v)) errs.push(`${f} must be a number`)
        if (spec.type === 'text' && typeof v !== 'string') errs.push(`${f} must be text`)
        if (spec.type === 'boolean' && typeof v !== 'boolean') errs.push(`${f} must be true or false`)
      }
    }
    return errs
  }
  return { types, tags, links, traits, events, problems, canonical, ancestry, isKindOf, traitsOf, storeOf, isUnder, linkBase, validate }
}

/** The vocabulary as JSON-LD (the export, never the engine): a context and the classes, for federation or other tools. */
export function toJsonLd(tax, base = 'https://life-console.dev/ns/') {
  const uri = (n) => (n.startsWith('schema:') ? `https://schema.org/${n.slice(7)}` : `${base}${prefixOf(n)}#${n.split('.').slice(1).join('.')}`)
  return {
    '@context': { rdfs: 'http://www.w3.org/2000/01/rdf-schema#', skos: 'http://www.w3.org/2004/02/skos/core#', owl: 'http://www.w3.org/2002/07/owl#' },
    '@graph': [
      ...Object.entries(tax.types).map(([k, t]) => ({ '@id': uri(k), '@type': 'rdfs:Class', 'rdfs:label': t.label, ...(t.kindOf ? { 'rdfs:subClassOf': { '@id': uri(t.kindOf) } } : {}), ...(t.sameAs ? { 'owl:equivalentClass': { '@id': uri(t.sameAs) } } : {}) })),
      ...Object.entries(tax.tags).map(([k, g]) => ({ '@id': uri(k), '@type': 'skos:Concept', 'skos:prefLabel': g.label, ...(g.parent ? { 'skos:broader': { '@id': uri(g.parent) } } : {}) })),
    ],
  }
}

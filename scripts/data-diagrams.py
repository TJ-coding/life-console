#!/usr/bin/env python3
"""Generates the /docs/data diagrams: python3 scripts/data-diagrams.py docs/media. Each SVG carries its own light and dark colours."""
import sys, os
OUT = sys.argv[1]

STYLE = """<style>
.pg{fill:#0f1216;stroke:#2a313b}.cd{fill:#171b21;stroke:#2a313b}.in{fill:#0f1216;stroke:#2a313b}
.t{fill:#e6e9ee;font:600 15px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.p{fill:#e6e9ee;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.m{fill:#9aa4b2;font:13px ui-monospace,"JetBrains Mono",Menlo,monospace}
.k{fill:#2bd4e6;font:600 13px ui-monospace,"JetBrains Mono",Menlo,monospace}
.h{fill:#2bd4e6}.hs{stroke:#2bd4e6}.ib{fill:#5aa2ff}.is{stroke:#5aa2ff}.w{fill:#e5a03a}.ws{stroke:#e5a03a}
.ln{stroke:#2a313b}.mu{stroke:#9aa4b2}.gl{fill:none;stroke:#9aa4b2;stroke-width:1.6}
.band{fill:#e5a03a;fill-opacity:.14;stroke:#e5a03a;stroke-opacity:.5}
.hl{fill:#2bd4e6;fill-opacity:.12}.hli{fill:#5aa2ff;fill-opacity:.14}
@media (prefers-color-scheme: light){
.pg{fill:#f4f5f7;stroke:#d9dde3}.cd{fill:#fff;stroke:#d9dde3}.in{fill:#f4f5f7;stroke:#d9dde3}
.t,.p{fill:#1b1f24}.m{fill:#5d6673}.k{fill:#1f8a63}.h{fill:#1f8a63}.hs{stroke:#1f8a63}.ib{fill:#1f62c9}.is{stroke:#1f62c9}
.w{fill:#a15c00}.ws{stroke:#a15c00}.ln{stroke:#d9dde3}.mu{stroke:#5d6673}.gl{stroke:#5d6673}
.band{fill:#a15c00;stroke:#a15c00}.hl{fill:#1f8a63}.hli{fill:#1f62c9}}
</style>"""

def svg(name, w, h, title, body):
    defs = """<defs>
<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="h"/></marker>
<marker id="b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ib"/></marker>
<marker id="g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:#9aa4b2"/></marker>
</defs>"""
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">\n<title>{title}</title>\n{STYLE}\n{defs}\n<rect class="pg" x=".5" y=".5" width="{w-1}" height="{h-1}" rx="3"/>\n{body}\n</svg>\n'
    open(os.path.join(OUT, name), 'w').write(s)

def box(x, y, w, h, c='cd'): return f'<rect class="{c}" x="{x}" y="{y}" width="{w}" height="{h}" rx="2"/>'
def txt(x, y, s, c='p', a='start'): return f'<text class="{c}" x="{x}" y="{y}" text-anchor="{a}">{s}</text>'
def line(x1, y1, x2, y2, c='hs', m='a', both=False, dash=False, wd=2):
    extra = (' stroke-dasharray="5 4"' if dash else '') + (f' marker-start="url(#{m})"' if both else '')
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" class="{c}" stroke-width="{wd}" marker-end="url(#{m})"{extra}/>'
laptop = lambda x, y: f'<rect class="gl" x="{x+3}" y="{y}" width="22" height="14" rx="1.5"/><path class="gl" d="M{x} {y+17}h28"/>'
phone = lambda x, y: f'<rect class="gl" x="{x+7}" y="{y-2}" width="13" height="21" rx="2.5"/><path class="gl" d="M{x+11.5} {y+15}h4"/>'
server = lambda x, y: f'<rect class="gl" x="{x}" y="{y}" width="24" height="7" rx="1"/><rect class="gl" x="{x}" y="{y+10}" width="24" height="7" rx="1"/><circle cx="{x+19}" cy="{y+3.5}" r="1.3" class="h"/><circle cx="{x+19}" cy="{y+13.5}" r="1.3" class="h"/>'

# 1. Where the planner lives
b = []
for (y, name, glyph) in [(24, 'Laptop', laptop), (168, 'Phone', phone)]:
    b += [box(20, y, 230, 120), glyph(34, y + 18), txt(72, y + 32, name, 't'),
          box(36, y + 52, 198, 52, 'in'), txt(50, y + 74, 'Browser copy', 'p'), txt(50, y + 93, 'whole planner, offline', 'm')]
b += [box(390, 24, 230, 264), server(404, 40), txt(442, 56, 'Server', 't')]
for i, (t, s) in enumerate([('Planner document', 'one per account · v42'), ('Snapshots', 'hourly · last 200'), ('Daily backups', 'kept 14 days')]):
    y = 76 + i * 70
    b += [box(406, y, 198, 52, 'in'), txt(420, y + 22, t, 'p'), txt(420, y + 41, s, 'm')]
    if i: b.append(line(505, y - 17, 505, y - 2, 'mu', 'g', wd=1.5))
b += [line(236, 102, 404, 102, both=True), line(236, 246, 404, 112, both=True), txt(320, 92, 'sync', 'k', 'middle')]
svg('data-where.svg', 640, 312, 'Each device keeps a full copy of the planner in its browser and syncs it with one document on the server, which keeps snapshots and daily backups', '\n'.join(b))

# 2. How an edit travels
b = []
lanes = [(70, 'Laptop', laptop), (150, 'Server', server), (230, 'Phone', phone)]
for y, n, g in lanes:
    b += [g(20, y - 9), txt(58, y + 5, n, 't'), f'<line x1="120" y1="{y}" x2="620" y2="{y}" class="ln" stroke-width="2"/>']
b += ['<rect class="band" x="430" y="212" width="124" height="36" rx="2"/>', txt(440, 270, 'offline: still editing', 'm')]
dots = [(160, 70, 'h'), (270, 150, 'h'), (380, 230, 'ib'), (462, 230, 'w'), (520, 230, 'w'), (600, 150, 'h')]
b += [line(162, 72, 266, 146), txt(226, 112, '1.5 s', 'k'),
      line(272, 152, 376, 226, 'is', 'b'), txt(340, 186, 'pull · every 30 s', 'm'),
      line(558, 226, 597, 156, 'ws', 'a'), txt(566, 196, 'back online', 'm', 'end')]
b += [f'<circle cx="{x}" cy="{y}" r="6" class="{c}"/>' for x, y, c in dots]
b += [txt(150, 48, 'edit: saved in the browser at once', 'p'), txt(282, 140, 'v42', 'k'), txt(600, 136, 'v43', 'k', 'middle'),
      txt(394, 270, 'gets v42', 'm', 'end')]
svg('data-sync.svg', 640, 296, 'An edit is saved in the browser at once, reaches the server about 1.5 seconds later, and other devices pull it; offline edits are sent when the connection returns', '\n'.join(b))

# 3. Three-way merge
b = []
cols = [
    (20, 'Base', 'last sync', [('T-1 Draft report 60m', ''), ('T-2 Gym', ''), ('T-3 Call bank', '')]),
    (225, 'This device', 'yours', [('T-1 Draft report 90m', 'hl'), ('T-2 Gym', ''), ('T-3 Call bank', ''), ('T-4 Book dentist', 'hl')]),
    (430, 'Server', 'other device', [('T-1 Draft report 60m', ''), ('T-2 Gym ✓ done', 'hli'), ('T-3 Call bank', 'del')]),
]
for x, t, s, rows in cols:
    b += [box(x, 20, 190, 176), txt(x + 14, 46, t, 't'), txt(x + 176, 46, s, 'm', 'end')]
    for i, (r, c) in enumerate(rows):
        y = 62 + i * 32
        if c in ('hl', 'hli'): b.append(f'<rect class="{c}" x="{x+8}" y="{y}" width="174" height="26" rx="2"/>')
        b.append(txt(x + 14, y + 18, r, 'm'))
        if c == 'del': b.append(f'<line x1="{x+12}" y1="{y+14}" x2="{x+116}" y2="{y+14}" class="mu" stroke-width="1.5"/>')
b += [line(115, 198, 230, 240, 'mu', 'g', wd=1.5), line(320, 198, 320, 240, 'mu', 'g', wd=1.5), line(525, 198, 410, 240, 'mu', 'g', wd=1.5)]
b += [box(120, 244, 400, 176), txt(134, 270, 'Merged', 't'), txt(506, 270, 'every change kept', 'm', 'end')]
for i, (r, src, c) in enumerate([('T-1 Draft report 90m', 'this device', 'hl'), ('T-2 Gym ✓ done', 'server', 'hli'),
                                 ('T-3 Call bank', 'deleted on server', 'del'), ('T-4 Book dentist', 'this device', 'hl')]):
    y = 286 + i * 32
    if c != 'del': b.append(f'<rect class="{c}" x="128" y="{y}" width="384" height="26" rx="2"/>')
    b += [txt(134, y + 18, r, 'm'), txt(506, y + 18, src, 'm', 'end')]
    if c == 'del': b.append(f'<line x1="132" y1="{y+14}" x2="236" y2="{y+14}" class="mu" stroke-width="1.5"/>')
svg('data-merge.svg', 640, 440, 'Three-way merge: the base, this device and the server are compared item by item, so an edit on one device and a change on another are both kept', '\n'.join(b))

# 4. The planner document
rows = [('todos', 'tasks and subtasks'), ('timeBlocks', 'fixed blocks on the timeline'), ('deadlines', 'countdowns'),
        ('plans', 'visions, goals and milestones'), ('notes · sleep · …', 'logs, keyed by date'),
        ('settings', 'notifications, timezone'), ('modules.<id>', "each plugin's own data"), ('schemaVersion', 'which format it is in')]
h = 80 + len(rows) * 34 + 20
b = [f'<path class="cd" d="M20 20h566l34 34v{h-60}h-600z"/>', f'<path class="in" d="M586 20v34h34z"/>',
     txt(40, 52, 'planner.json', 't'), txt(560, 52, 'one per account', 'm', 'end')]
for i, (k, d) in enumerate(rows):
    y = 74 + i * 34
    b += [f'<line x1="36" y1="{y}" x2="604" y2="{y}" class="ln"/>', txt(44, y + 22, k.replace('<', '&lt;').replace('>', '&gt;'), 'k'), txt(250, y + 22, d, 'p')]
svg('data-document.svg', 640, h, 'The planner document: tasks, timeline blocks, deadlines, plans, daily logs, settings and plugin data, all in one file per account', '\n'.join(b))

# 5. Safety nets
rows = [('Browser copy', 'every edit, at once', 'on each device'), ('Server document', '~1.5 s later', 'versioned: v1, v2, v3…'),
        ('Snapshots', 'at most hourly', 'last 200 kept'), ('Daily backups', 'every 24 h', '14 days · 28 before updates'),
        ('Your export', 'whenever you like', 'a JSON file you keep')]
b = []
for i, (t, when, keep) in enumerate(rows):
    y = 20 + i * 62
    b += [box(60, y, 560, 50), f'<rect x="60" y="{y}" width="4" height="50" class="{"ib" if i == 4 else "h"}"/>',
          txt(80, y + 30, t, 't'), txt(270, y + 30, when, 'p'), txt(604, y + 30, keep, 'm', 'end')]
b += [line(32, 30, 32, 314, 'mu', 'g', wd=1.5), f'<text class="m" transform="translate(24 172) rotate(-90)" text-anchor="middle">further back</text>']
svg('data-safety.svg', 640, 20 + 5 * 62 + 8, 'Five copies of your planner: the browser copy, the server document, hourly snapshots, daily backups and your own export', '\n'.join(b))
# 6. Solid pod (coming next)
b = []
b += [box(20, 24, 170, 120), laptop(34, 40), txt(72, 54, 'Your devices', 't'),
      box(34, 72, 142, 56, 'in'), txt(46, 96, 'Browser copy', 'p'), txt(46, 115, 'as today', 'm')]
b += [box(222, 24, 170, 120), server(236, 40), txt(272, 54, 'Life Console', 't'),
      box(236, 72, 142, 56, 'in'), txt(248, 96, 'Database', 'p'), txt(248, 115, 'sync · merge', 'm')]
b += [line(176, 100, 236, 100, both=True)]
b += [box(424, 24, 196, 238), '<circle cx="446" cy="48" r="11" class="gl"/>', '<circle cx="446" cy="48" r="4" class="h"/>',
      txt(466, 54, 'Your Solid pod', 't')]
for i, f in enumerate(['todos.jsonld', 'deadlines.jsonld', 'plans.jsonld', 'settings.jsonld', 'blocks/2026-11.jsonld', 'other.json']):
    y = 110 + i * 26
    b += [f'<path class="gl" d="M440 {y-12}h9l4 4v12h-13z"/>', txt(462, y + 1, f, 'm')]
b += [line(378, 100, 432, 100), txt(440, 80, 'copied after each save', 'm')]
b += [box(20, 168, 372, 94, 'in'), txt(34, 194, 'Stays on the server, never in the pod', 'p'),
      txt(34, 218, 'sign-in · sessions · tokens', 'm'), txt(34, 240, 'notification devices · key vault', 'm')]
b += [txt(20, 286, 'The pod: built into Life Console, or your own Solid server', 'm')]
svg('data-pod.svg', 640, 300, 'Coming next: after each save, Life Console writes the planner to your Solid pod as standard JSON-LD files; sign-in, sessions, notification devices and keys stay on the server', '\n'.join(b))
# 7. Sharing over ActivityPub (coming next)
b = []
b += [box(20, 24, 250, 222), server(34, 40), txt(70, 56, 'Your Life Console', 't'),
      box(34, 72, 222, 66, 'in'), txt(48, 98, 'Shared plan SP-03', 'p'), txt(48, 120, 'view or edit · revocable', 'm'),
      box(34, 160, 222, 70, 'in'), '<circle cx="54" cy="188" r="9" class="gl"/>', '<circle cx="54" cy="188" r="3.5" class="h"/>',
      txt(72, 193, 'Your pod', 'p'), txt(48, 216, 'only your server opens it', 'm')]
b += [box(400, 56, 220, 84), server(414, 72), txt(450, 88, 'Their Life Console', 't'), txt(414, 112, 'reads it live', 'm'), txt(414, 130, 'sends edits back', 'm')]
b += [box(400, 168, 220, 70), txt(414, 196, 'Mastodon and co.', 't'), txt(414, 220, 'gets a copy', 'm')]
b += [line(256, 98, 400, 98, both=True), txt(328, 88, 'live, signed', 'k', 'middle'),
      line(256, 118, 398, 198, 'is', 'b'), txt(336, 188, 'a copy', 'm', 'end')]
b += [txt(20, 276, 'Revoke: your server stops answering and tells theirs', 'm')]
svg('data-share.svg', 640, 296, 'Coming next: share a plan with someone on another server. Another Life Console reads it live with signed requests and sends edits back; other fediverse servers get a copy; your pod is never opened from outside', '\n'.join(b))
print('ok')

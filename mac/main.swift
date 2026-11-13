// Life Console Now — native macOS menu-bar app: what you should be doing right now (build: mac/build.sh).
// Port of src/now.js (useNow), src/glance.js (deadline countdowns) and server/pomodoro.mjs. No dependencies.
import AppKit
import SwiftUI
import ServiceManagement
import UserNotifications
import CryptoKit

let defaults = UserDefaults.standard

/* ───────────── helpers ───────────── */
func pad(_ n: Int) -> String { String(format: "%02d", n) }
func toMin(_ s: String) -> Int { let p = s.split(separator: ":").compactMap { Int($0) }; return p.count == 2 ? p[0] * 60 + p[1] : 0 }
func fromMin(_ m: Int) -> String { "\(pad(m / 60)):\(pad(m % 60))" }
func fmtDur(_ sec: Int) -> String { let s = max(0, sec), h = s / 3600, m = (s % 3600) / 60; return h > 0 ? "\(h)h \(pad(m))m" : "\(m)m" }
func clip(_ s: String, _ n: Int) -> String { n <= 1 ? "" : s.count > n ? String(s.prefix(n - 1)) + "…" : s }
func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue ?? (v as? String).flatMap(Double.init) }
func isoDay(_ d: Date) -> String { let c = Calendar.current.dateComponents([.year, .month, .day], from: d); return "\(c.year!)-\(pad(c.month!))-\(pad(c.day!))" }
func parseLocal(_ s: String) -> Date? {
  let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = s.count > 10 ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd"
  return f.date(from: String(s.prefix(16)))
}
/** Compact countdown like glance.js: 42m · 5h 07m · 3d 7h (− when past). */
func countdown(_ mins: Int) -> String {
  let a = abs(mins)
  let s = a < 60 ? "\(a)m" : a < 1440 ? "\(a / 60)h \(pad(a % 60))m" : "\(a / 1440)d \((a % 1440) / 60)h"
  return mins < 0 ? "−\(s)" : s
}

/* ───────────── pomodoro (server/pomodoro.mjs) ───────────── */
struct Rhythm { var work = 25, short = 5, long = 15, every = 4 }
func rhythm(_ settings: [String: Any]?) -> Rhythm {
  let p = settings?["pomodoro"] as? [String: Any] ?? [:]
  func int(_ k: String, _ lo: Int, _ hi: Int, _ d: Int) -> Int { guard let v = num(p[k]), v.isFinite else { return d }; return max(lo, min(hi, Int(v.rounded()))) }
  return Rhythm(work: int("work", 5, 120, 25), short: int("short", 0, 60, 5), long: int("long", 0, 90, 15), every: int("every", 1, 12, 4))
}
func wallMin(_ workMin: Int, _ r: Rhythm) -> Int {
  var left = max(0, workMin), t = 0, end = 0, i = 0
  while left > 0 { let w = min(r.work, left); left -= w; end = t + w; t += w + (left > 0 ? ((i + 1) % r.every == 0 ? r.long : r.short) : 0); i += 1 }
  return end
}

/* ───────────── "now" (src/now.js) ───────────── */
struct Todo { let id, title: String; let done: Bool; let timeMin, priority: Int; let order: Double; let links: [String]
  let date, start: String?; let parent, splitGroup: String?; let pomo: Bool }
struct Block: Identifiable { let id: String; let title, start, end, category: String; let link, todoId: String? }
struct Deadline: Identifiable { let id, title: String; let due: Date; let mins: Int }
struct Now {
  enum Mode { case busy, free, idle }
  var mode = Mode.idle, text = "Nothing scheduled", meta = ""
  var current, next: Block?; var suggestion: Todo?; var suggestionCategory = "experiment"
  var blocks: [Block] = []; var unscheduled: [Todo] = []; var deadlines: [Deadline] = []
  var nowMin = 0, nowSec = 0, gap = 0
  var missedAt: String?   // now.js missedAt: the suggested todo's start time today has already passed
  var progress: Double { guard let c = current else { return 0 }; let tot = Double(toMin(c.end) - toMin(c.start)) * 60; return tot > 0 ? min(1, Double(nowSec - toMin(c.start) * 60) / tot) : 0 }
  var remaining: Int { current.map { toMin($0.end) * 60 - nowSec } ?? 0 }

  /** What the menu-bar headline and floating widget show: the running block, else the next scheduled block,
   *  else PLAN: a prompt to schedule what's next (with how many of today's todos still have no time). */
  var toSchedule = 0      // today's open todos with no time still ahead of them (unscheduled, or their time passed)
  var topToSchedule: Todo?  // the highest-priority of them
  var topCategory = "experiment"
  var planning: Bool { current == nil && next == nil }
  struct Bar { var mode = Mode.idle, plan = false, title = "", meta = "", longMeta = "" }
  var bar: Bar {
    if current != nil { return Bar(mode: .busy, title: text, meta: fmtDur(remaining), longMeta: "\(fmtDur(remaining)) left") }
    if let nx = next { let inS = "in \(fmtDur(toMin(nx.start) * 60 - nowSec))"; return Bar(mode: .free, title: nx.title, meta: inS, longMeta: "\(nx.start) · \(inS)") }
    // nothing left on today's timeline: ask to schedule rather than presenting an unscheduled todo as "next"
    let k = toSchedule > 0 ? "\(toSchedule) unscheduled" : ""
    return Bar(mode: .free, plan: true, title: topToSchedule?.title ?? "Schedule what's next", meta: k, longMeta: k)
  }
}

func compute(_ state: [String: Any], at now: Date = Date()) -> Now {
  let c = Calendar.current.dateComponents([.hour, .minute, .second], from: now)
  let T = isoDay(now)
  let nowSec = c.hour! * 3600 + c.minute! * 60 + c.second!, nowMin = nowSec / 60
  let todos: [Todo] = (state["todos"] as? [[String: Any]] ?? []).map { t in
    let sch = t["scheduled"] as? [String: Any]
    return Todo(id: t["id"] as? String ?? "", title: t["title"] as? String ?? "", done: t["done"] as? Bool ?? false,
                timeMin: Int(num(t["timeMin"]) ?? 0), priority: Int(num(t["priority"]) ?? 3), order: num(t["order"]) ?? 0,
                links: t["links"] as? [String] ?? [], date: sch?["date"] as? String, start: sch?["start"] as? String,
                parent: t["parent"] as? String, splitGroup: (t["split"] as? [String: Any])?["group"] as? String, pomo: t["pomo"] as? Bool ?? false) }
  let byPriority: (Todo, Todo) -> Bool = { a, b in a.done != b.done ? !a.done : a.priority != b.priority ? a.priority < b.priority : a.order < b.order }
  let parents = Set(todos.compactMap { $0.parent })
  let r = rhythm(state["settings"] as? [String: Any])
  let plans = state["plans"] as? [[String: Any]] ?? []
  let sigs = plans.flatMap { $0["sigs"] as? [[String: Any]] ?? [] }
  let goalNos = Set(plans.flatMap { ($0["psgs"] as? [[String: Any]] ?? []) + ($0["sigs"] as? [[String: Any]] ?? []) }.compactMap { $0["no"].map { "\($0)" } })
  func sigPsg(_ no: String) -> String? { sigs.first { "\($0["no"] ?? "")" == no }?["psg"] as? String }
  func linkType(_ id: String) -> String {
    if goalNos.contains(id) || id.hasPrefix("PSG-") || id.hasPrefix("SIG-") { return "goal" }
    for (p, t) in [("DL-", "deadline"), ("SP-", "plan"), ("R-", "risk"), ("IPB-", "ipb"), ("KZ-", "kaizen")] where id.hasPrefix(p) { return t }
    return "course"
  }
  func categoryOf(_ t: Todo) -> String {
    let types = t.links.map(linkType)
    if types.contains("course") { return "academic" }
    if types.contains("goal") || types.contains("plan") { return "research" }
    if types.contains("kaizen") { return "kaizen" }
    return "experiment"
  }
  func partLabel(_ t: Todo) -> String {
    guard let g = t.splitGroup else { return "" }
    let sib = todos.filter { $0.splitGroup == g }.sorted { a, b in
      let da = a.date ?? "9999", db = b.date ?? "9999"; if da != db { return da < db }
      let sa = a.start ?? "", sb = b.start ?? ""; if sa != sb { return sa < sb }; return a.order < b.order }
    guard sib.count > 1, let i = sib.firstIndex(where: { $0.id == t.id }) else { return "" }
    return "\(i + 1)/\(sib.count)"
  }
  func related(_ t: Todo, _ b: Block) -> Bool { guard let l = b.link else { return false }; return t.links.contains { $0 == l || sigPsg($0) == l } }

  var blocks: [Block] = (state["timeBlocks"] as? [[String: Any]] ?? []).filter { ($0["date"] as? String) == T && !($0["done"] as? Bool ?? false) }.map {
    Block(id: $0["id"] as? String ?? UUID().uuidString, title: $0["title"] as? String ?? "", start: $0["start"] as? String ?? "00:00", end: $0["end"] as? String ?? "00:00",
          category: $0["category"] as? String ?? "research", link: $0["link"] as? String, todoId: nil) }
  for t in todos where t.date == T && t.start != nil && !t.done {
    let pl = partLabel(t), dur = t.pomo ? wallMin(t.timeMin > 0 ? t.timeMin : 30, r) : (t.timeMin > 0 ? t.timeMin : 30)
    blocks.append(Block(id: t.id, title: pl.isEmpty ? t.title : "\(t.title) (\(pl))", start: t.start!, end: fromMin(min(1440, toMin(t.start!) + dur)),
                        category: categoryOf(t), link: t.links.first, todoId: t.id))
  }
  blocks.sort { toMin($0.start) < toMin($1.start) }

  var n = Now(); n.blocks = blocks; n.nowMin = nowMin; n.nowSec = nowSec
  let current = blocks.filter { toMin($0.start) <= nowMin && nowMin < toMin($0.end) }.max { toMin($0.start) < toMin($1.start) }
  let next = blocks.first { toMin($0.start) > nowMin }
  let gap = (next.map { toMin($0.start) } ?? 1440) * 60 - nowSec
  let queue = todos.filter { $0.date == T }.sorted(by: byPriority).filter { !$0.done && $0.id != current?.todoId && !($0.start.map { toMin($0) > nowMin } ?? false) }
  var suggestion: Todo?
  if let cur = current, cur.todoId == nil { suggestion = queue.first { related($0, cur) } ?? todos.filter { !$0.done && !parents.contains($0.id) && related($0, cur) }.sorted(by: byPriority).first }
  else if current == nil { suggestion = queue.first { $0.timeMin * 60 <= gap } ?? queue.first }

  if let cur = current { n.mode = .busy; n.text = cur.title; n.meta = "\(fmtDur(toMin(cur.end) * 60 - nowSec)) left" }
  else if let s = suggestion { n.mode = .free; n.text = s.title; n.meta = "free \(fmtDur(gap))" }
  else if let nx = next { n.mode = .free; n.text = "Free until \(nx.start)"; n.meta = nx.title }
  n.current = current; n.next = next; n.suggestion = suggestion; n.gap = gap
  n.suggestionCategory = suggestion.map(categoryOf) ?? "experiment"
  if n.mode == .free, let st = suggestion?.start, suggestion?.date == T, toMin(st) < nowMin { n.missedAt = st }
  n.unscheduled = queue.filter { $0.start == nil && $0.id != suggestion?.id }
  n.toSchedule = queue.count
  n.topToSchedule = queue.first   // queue is in priority order
  n.topCategory = queue.first.map(categoryOf) ?? "experiment"
  // planning: the list under the card holds the rest of what still needs a time (passed ones included), so it adds up
  if n.planning { n.unscheduled = Array(queue.dropFirst()) }

  // Deadlines (glance.js effDue): the personal internal target while it still stands, else the hard due.
  n.deadlines = (state["deadlines"] as? [[String: Any]] ?? []).compactMap { d -> Deadline? in
    guard !(d["done"] as? Bool ?? false), let dueS = d["due"] as? String else { return nil }
    let target = d["internal"] as? String ?? ""
    let eff = !target.isEmpty && target >= T ? "\(target)T23:59" : dueS
    guard let due = parseLocal(eff) else { return nil }
    return Deadline(id: d["id"] as? String ?? UUID().uuidString, title: d["title"] as? String ?? "", due: due, mins: Int((due.timeIntervalSince(now) / 60).rounded()))
  }.sorted { $0.due < $1.due }.prefix(20).map { $0 }   // the panel and the widget each show their own count
  return n
}

/* ───────────── theme (src/styles.css tokens) ───────────── */
func rgb(_ h: UInt32) -> NSColor { NSColor(srgbRed: CGFloat((h >> 16) & 255) / 255, green: CGFloat((h >> 8) & 255) / 255, blue: CGFloat(h & 255) / 255, alpha: 1) }
func tok(_ dark: UInt32, _ light: UInt32) -> Color {
  Color(nsColor: NSColor(name: nil) { ap in ap.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? rgb(dark) : rgb(light) })
}
enum K {
  static let bg = tok(0x0e1116, 0xf7f7f5), surface = tok(0x161b22, 0xffffff), surface2 = tok(0x1f2630, 0xeef0f2)
  static let border = tok(0x2a323d, 0xd9dde2), text = tok(0xe6edf3, 0x1a1f24), muted = tok(0x8b96a3, 0x5f6b77)
  static let accent = tok(0x3fb68b, 0x1e8a63), info = tok(0x4c9aff, 0x2563eb), warn = tok(0xe3b341, 0xb7791f), danger = tok(0xf25f5c, 0xc53030)
  static let onAccent = tok(0x0e1116, 0xffffff), stamp = tok(0xd94a3d, 0xc0392b)
  static func cat(_ c: String) -> Color {
    switch c {
    case "research": return tok(0x3987e5, 0x2a78d6)
    case "academic": return tok(0xd95926, 0xeb6834)
    case "kaizen": return tok(0xc98500, 0xeda100)
    default: return tok(0x199e70, 0x1baf7a)
    }
  }
  static let mono = Font.system(size: 11, weight: .medium, design: .monospaced)
}

/* ───────────── model ───────────── */
final class Model: ObservableObject {
  @Published var state: [String: Any]?
  @Published var stale = false
  @Published var error: String?
  @Published var now = Date()
  @Published var syncing = false
  @Published var lastSync: Date?
  var onRefit: (() -> Void)?
  var onConnect: (() -> Void)?
  var onPlan: (() -> Void)?
  var onSettings: (() -> Void)?
  @Published var showHUD = defaults.object(forKey: "hud") as? Bool ?? false { didSet { defaults.set(showHUD, forKey: "hud"); onChange?() } }
  /** The floating widget's size, 0.75…3 (the slider in the panel; 1 = the original size). */
  @Published var hudScale = defaults.object(forKey: "hudScale") as? Double ?? 1 { didSet { defaults.set(hudScale, forKey: "hudScale"); onChange?() } }
  /** How many of the closest deadlines to list under the widget (0 = none) and in the panel (Settings…). */
  @Published var hudDeadlines = defaults.object(forKey: "hudDeadlines") as? Int ?? 3 { didSet { defaults.set(hudDeadlines, forKey: "hudDeadlines"); onChange?() } }
  @Published var panelDeadlines = defaults.object(forKey: "panelDeadlines") as? Int ?? 3 { didSet { defaults.set(panelDeadlines, forKey: "panelDeadlines"); onChange?() } }
  var onDeadlines: (() -> Void)?
  static let hudScaleRange = 0.75...3.0
  var onChange: (() -> Void)?

  var url: String { (defaults.string(forKey: "url") ?? Model.defaultServer).trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) }
  var token: String { defaults.string(forKey: "token") ?? "" }
  var connected: Bool { !token.isEmpty }
  static let defaultServer = "https://life-console.dev"
  static let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"

  /* ── updates: the server says which Mac release is newest (GET /api/mac/latest, server/macapp.mjs) ── */
  struct Update { let version, notes, zip, sha256: String }
  @Published var update: Update?
  @Published var installing = false
  @Published var updateError: String?
  @Published var checkedNoUpdate = false
  var onUpdateFound: ((Update) -> Void)?
  var onInstall: (() -> Void)?
  /** "1.10.0" > "1.9.2" */
  static func newer(_ a: String, than b: String) -> Bool {
    let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
    for i in 0..<max(x.count, y.count) { let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0; if p != q { return p > q } }
    return false
  }
  /** At launch and every 6 hours (force: the menu's "Check for Updates"). */
  func checkUpdate(force: Bool = false) {
    let last = defaults.double(forKey: "updateCheckedAt")
    guard force || Date().timeIntervalSince1970 - last > 6 * 3600, let u = URL(string: url + "/api/mac/latest") else { return }
    defaults.set(Date().timeIntervalSince1970, forKey: "updateCheckedAt")
    URLSession.shared.dataTask(with: URLRequest(url: u, timeoutInterval: 15)) { data, _, _ in
      DispatchQueue.main.async {
        guard let d = data, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], j["available"] as? Bool == true,
              let v = j["version"] as? String, let zip = j["zip"] as? String, Model.newer(v, than: Model.version) else {
          self.update = nil; if force { self.checkedNoUpdate = true }; return
        }
        let up = Update(version: v, notes: j["notes"] as? String ?? "", zip: zip, sha256: j["sha256"] as? String ?? "")
        let isNew = self.update?.version != v
        self.update = up; self.updateError = nil
        if isNew { self.onUpdateFound?(up) }
        // end-to-end update test (a copy with its own BUNDLE_ID): install without a click
        if ProcessInfo.processInfo.environment["LCNOW_TEST_AUTOINSTALL"] == "1" { self.onInstall?() }
      }
    }.resume()
  }
  /** Use a different server/account: drop the old account's cached planner. */
  func connect(server: String, token: String) {
    defaults.set(server, forKey: "url"); defaults.set(token, forKey: "token")
    defaults.removeObject(forKey: "cache"); state = nil; error = nil; stale = false
    fetch(); checkUpdate(force: true)
  }
  var snapshot: Now? { state.map { compute($0, at: now) } }

  init() {
    if let d = defaults.data(forKey: "cache"), let s = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { state = s; stale = true }
  }

  func request(_ path: String, method: String = "GET", body: [String: Any]? = nil, done: @escaping (Int, Data?) -> Void) {
    guard let u = URL(string: url + path), !token.isEmpty else { return done(0, nil) }
    var req = URLRequest(url: u, timeoutInterval: 10); req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let b = body { req.setValue("application/json", forHTTPHeaderField: "Content-Type"); req.httpBody = try? JSONSerialization.data(withJSONObject: b) }
    URLSession.shared.dataTask(with: req) { data, resp, _ in
      DispatchQueue.main.async { done((resp as? HTTPURLResponse)?.statusCode ?? 0, data) }
    }.resume()
  }

  func fetch() {
    guard !token.isEmpty else { error = "Add your server and API token in Settings"; onChange?(); return }
    syncing = true
    request("/api/state") { code, data in
      self.syncing = false
      if code == 200, let d = data, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let s = j["state"] as? [String: Any] {
        self.state = s; self.stale = false; self.error = nil; self.lastSync = Date()
        if let c = try? JSONSerialization.data(withJSONObject: s) { defaults.set(c, forKey: "cache") }
      } else {
        self.stale = true; self.error = code == 401 ? "API token refused — check Settings" : "Can’t reach Life Console"
      }
      self.now = Date(); self.onChange?()
    }
  }

  func markDone(_ id: String) {
    // optimistic: hide it now, then confirm with the server
    if var s = state, var todos = s["todos"] as? [[String: Any]], let i = todos.firstIndex(where: { ($0["id"] as? String) == id }) {
      todos[i]["done"] = true; s["todos"] = todos; state = s; onChange?()
    }
    request("/api/todo/done", method: "POST", body: ["id": id]) { _, _ in self.fetch() }
  }
  func tick() { now = Date(); onChange?() }
  /** Put the on-screen headline back in its default spot (top-right, under the menu bar) and show it. */
  func resetHUD() { defaults.removeObject(forKey: "hudRight"); defaults.removeObject(forKey: "hudTop"); showHUD = true; onChange?() }
}

/* ───────────── panel UI ───────────── */
struct SectionLabel: View {
  let text: String; var trailing: String? = nil
  var body: some View {
    HStack {
      Text(text).font(.system(size: 10, weight: .bold)).tracking(1.2).foregroundColor(K.muted)
      Spacer()
      if let t = trailing { Text(t).font(K.mono).foregroundColor(K.muted) }
    }
  }
}

struct Card<Content: View>: View {
  @ViewBuilder let content: Content
  var body: some View {
    content.padding(12).frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: 10).fill(K.surface))
      .overlay(RoundedRectangle(cornerRadius: 10).stroke(K.border, lineWidth: 1))
  }
}

struct Chip: View {
  let text: String; let color: Color
  var body: some View {
    Text(text).font(.system(size: 10, weight: .heavy)).tracking(1).foregroundColor(color)
      .padding(.horizontal, 7).padding(.vertical, 3)
      .background(Capsule().fill(color.opacity(0.15)))
  }
}

struct Panel: View {
  @ObservedObject var m: Model
  let open: () -> Void, settings: () -> Void, quit: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if let u = m.update { updateBanner(u) }
      if !m.connected { connectCard }
      if m.stale, let e = m.error, m.connected {
        Label(e, systemImage: "wifi.exclamationmark").font(.system(size: 11, weight: .semibold)).foregroundColor(K.warn)
      }
      if let n = m.snapshot {
        nowCard(n)
        if let nx = n.next { nextRow(nx, n) }
        if !n.blocks.isEmpty { timeline(n) }
        if !n.unscheduled.isEmpty { unscheduled(n) }
        if !n.deadlines.isEmpty && m.panelDeadlines > 0 { deadlines(n) }
      } else if m.connected {
        Card { Text(m.error ?? "Loading…").foregroundColor(K.muted) }
      }
      footer
    }
    .padding(14).frame(width: 360).background(K.bg)
  }

  func updateBanner(_ u: Model.Update) -> some View {
    HStack(spacing: 10) {
      Image(systemName: "arrow.down.circle.fill").font(.system(size: 20)).foregroundColor(K.accent)
      VStack(alignment: .leading, spacing: 2) {
        Text("Update available · \(u.version)").font(.system(size: 13, weight: .semibold)).foregroundColor(K.text)
        Text(m.updateError ?? (m.installing ? "Downloading and installing…" : "You have \(Model.version). Installs and restarts in seconds."))
          .font(.system(size: 11)).foregroundColor(m.updateError != nil ? K.warn : K.muted).fixedSize(horizontal: false, vertical: true)
      }
      Spacer()
      Button { m.onInstall?() } label: {
        Text(m.installing ? "Installing…" : "Install").font(.system(size: 12, weight: .semibold)).foregroundColor(K.onAccent)
          .padding(.horizontal, 12).padding(.vertical, 6).background(RoundedRectangle(cornerRadius: 6).fill(K.accent.opacity(m.installing ? 0.5 : 1)))
      }.buttonStyle(.plain).disabled(m.installing)
    }
    .padding(12).background(RoundedRectangle(cornerRadius: 10).fill(K.accent.opacity(0.10)))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(K.accent.opacity(0.5), lineWidth: 1))
  }

  var connectCard: some View {
    Card {
      VStack(alignment: .leading, spacing: 8) {
        Text("Connect your account").font(.system(size: 15, weight: .semibold)).foregroundColor(K.text)
        Text("Sign in to Life Console in your browser, then choose Settings → Mac menu-bar app → Connect.")
          .font(.system(size: 12)).foregroundColor(K.muted).fixedSize(horizontal: false, vertical: true)
        HStack {
          Button { m.onConnect?() } label: {
            Label("Connect", systemImage: "link").font(.system(size: 12, weight: .semibold)).foregroundColor(K.onAccent)
              .padding(.horizontal, 10).padding(.vertical, 5).background(RoundedRectangle(cornerRadius: 6).fill(K.accent))
          }.buttonStyle(.plain)
          Spacer()
          Button("Other server…", action: settings).buttonStyle(.borderless).font(.system(size: 12)).foregroundColor(K.muted)
        }
      }
    }
  }

  @ViewBuilder func nowCard(_ n: Now) -> some View {
    if n.planning { planCard(n) } else { activeCard(n) }
  }

  /** No block running and nothing else scheduled today: prompt to plan. */
  func planCard(_ n: Now) -> some View {
    Card {
      VStack(alignment: .leading, spacing: 9) {
        HStack { Chip(text: "PLAN", color: K.info); Spacer() }
        HStack(alignment: .top, spacing: 9) {
          if n.topToSchedule != nil { RoundedRectangle(cornerRadius: 2).fill(K.cat(n.topCategory)).frame(width: 4) }
          VStack(alignment: .leading, spacing: 3) {
            Text(n.topToSchedule?.title ?? "Schedule what's next").font(.system(size: 16, weight: .semibold)).foregroundColor(K.text)
              .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Text(n.topToSchedule.map { t in "Highest priority · \(t.timeMin)m · \(n.toSchedule) unscheduled today" } ?? "Nothing left on today's timeline.")
              .font(.system(size: 12)).foregroundColor(K.muted)
          }
        }.fixedSize(horizontal: false, vertical: true)
        HStack {
          Spacer()
          Button { m.onPlan?() } label: {
            Label("Plan in Life Console", systemImage: "calendar.badge.plus").font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
              .padding(.horizontal, 10).padding(.vertical, 5).background(RoundedRectangle(cornerRadius: 6).fill(K.info))
          }.buttonStyle(.plain)
        }
      }
    }
  }

  @ViewBuilder func activeCard(_ n: Now) -> some View {
    Card {
      VStack(alignment: .leading, spacing: 9) {
        HStack {
          switch n.mode {
          case .busy: Chip(text: "NOW", color: K.accent)
          case .free: if let m = n.missedAt { Chip(text: "MISSED \(m)", color: K.warn) } else { Chip(text: n.suggestion != nil ? "UP NEXT" : "FREE", color: K.info) }
          case .idle: Chip(text: "CLEAR", color: K.muted)
          }
          Spacer()
          if let c = n.current { Text("\(c.start)–\(c.end)").font(K.mono).foregroundColor(K.muted) }
          else if n.mode == .free { Text("free \(fmtDur(n.gap))").font(K.mono).foregroundColor(K.muted) }
        }
        HStack(alignment: .top, spacing: 9) {
          if n.mode != .idle {
            RoundedRectangle(cornerRadius: 2).fill(K.cat(n.current?.category ?? n.suggestionCategory)).frame(width: 4)
          }
          VStack(alignment: .leading, spacing: 3) {
            Text(n.mode == .busy ? n.text : n.suggestion?.title ?? n.text)
              .font(.system(size: 16, weight: .semibold)).foregroundColor(K.text).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            if let s = n.suggestion, n.mode == .busy { Text("Work on: \(s.title)").font(.system(size: 12)).foregroundColor(K.muted).lineLimit(1) }
            if let s = n.suggestion, n.mode == .free { Text("\(s.timeMin)m · \(s.timeMin * 60 <= n.gap ? "fits before the next block" : "longer than this gap")").font(.system(size: 12)).foregroundColor(K.muted) }
            if n.mode == .idle { Text("Nothing left on today’s timeline.").font(.system(size: 12)).foregroundColor(K.muted) }
          }
        }.fixedSize(horizontal: false, vertical: true)
        if n.mode == .busy {
          GeometryReader { g in
            ZStack(alignment: .leading) {
              Capsule().fill(K.surface2)
              Capsule().fill(K.accent).frame(width: max(6, g.size.width * n.progress))
            }
          }.frame(height: 6)
          HStack {
            Text(fmtDur(n.remaining) + " left").font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundColor(K.accent)
            Spacer()
            if let id = n.current?.todoId { doneButton(id) }
          }
        }
      }
    }
  }

  func doneButton(_ id: String) -> some View {
    Button { m.markDone(id) } label: {
      Label("Mark done", systemImage: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundColor(K.onAccent)
        .padding(.horizontal, 10).padding(.vertical, 5).background(RoundedRectangle(cornerRadius: 6).fill(K.accent))
    }.buttonStyle(.plain)
  }

  func nextRow(_ nx: Block, _ n: Now) -> some View {
    HStack(spacing: 8) {
      Text("NEXT").font(.system(size: 10, weight: .bold)).tracking(1.2).foregroundColor(K.muted)
      Circle().fill(K.cat(nx.category)).frame(width: 7, height: 7)
      Text(nx.title).font(.system(size: 12, weight: .medium)).foregroundColor(K.text).lineLimit(1)
      Spacer()
      Text("\(nx.start) · in \(fmtDur(toMin(nx.start) * 60 - n.nowSec))").font(K.mono).foregroundColor(K.muted)
    }.padding(.horizontal, 4)
  }

  func timeline(_ n: Now) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      SectionLabel(text: "TODAY", trailing: "\(n.blocks.filter { toMin($0.end) > n.nowMin }.count) left")
      VStack(spacing: 2) {
        ForEach(n.blocks.prefix(10)) { b in
          let past = toMin(b.end) <= n.nowMin, cur = b.id == n.current?.id
          HStack(spacing: 8) {
            Text(b.start).font(K.mono).foregroundColor(cur ? K.accent : K.muted).frame(width: 40, alignment: .leading)
            RoundedRectangle(cornerRadius: 1.5).fill(K.cat(b.category)).frame(width: 3, height: 16)
            Text(b.title).font(.system(size: 12, weight: cur ? .semibold : .regular)).foregroundColor(past ? K.muted : K.text).strikethrough(past).lineLimit(1)
            Spacer()
            Text(fmtDur((toMin(b.end) - toMin(b.start)) * 60)).font(K.mono).foregroundColor(K.muted)
          }
          .padding(.horizontal, 6).padding(.vertical, 4)
          .background(RoundedRectangle(cornerRadius: 6).fill(cur ? K.accent.opacity(0.12) : .clear))
          .contentShape(Rectangle()).onTapGesture(perform: open)
        }
      }
    }
  }

  func unscheduled(_ n: Now) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      SectionLabel(text: n.planning ? "ALSO UNSCHEDULED" : "UNSCHEDULED TODAY", trailing: "\(n.unscheduled.count)")
      ForEach(n.unscheduled.prefix(5), id: \.id) { t in
        HStack(spacing: 8) {
          Image(systemName: "circle").font(.system(size: 10)).foregroundColor(K.muted)
          Text(t.title).font(.system(size: 12)).foregroundColor(K.text).lineLimit(1)
          Spacer()
          Text("\(t.timeMin)m").font(K.mono).foregroundColor(K.muted)
        }.padding(.horizontal, 6)
      }
    }
  }

  func deadlines(_ n: Now) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      SectionLabel(text: "DEADLINES")
      ForEach(n.deadlines.prefix(m.panelDeadlines)) { d in
        let col = d.mins <= 720 ? K.danger : d.mins <= 2880 ? K.warn : K.accent
        HStack(spacing: 8) {
          Image(systemName: d.mins <= 0 ? "exclamationmark.triangle.fill" : "flag.fill").font(.system(size: 10)).foregroundColor(col)
          Text(d.title).font(.system(size: 12)).foregroundColor(K.text).lineLimit(1)
          Spacer()
          Text(d.mins <= 0 ? "OVERDUE" : countdown(d.mins)).font(K.mono).foregroundColor(col)
        }.padding(.horizontal, 6)
      }
    }
  }

  var footer: some View {
    HStack(spacing: 6) {
      Button(action: open) {
        Label("Open Life Console", systemImage: "arrow.up.right.square").font(.system(size: 12, weight: .semibold)).foregroundColor(K.text)
          .padding(.horizontal, 10).padding(.vertical, 6).background(RoundedRectangle(cornerRadius: 6).fill(K.surface2))
      }.buttonStyle(.plain)
      if !m.showHUD {
        Button { m.showHUD = true } label: {
          Label("Show headline", systemImage: "rectangle.inset.topright.filled").font(.system(size: 12, weight: .semibold)).foregroundColor(K.accent)
            .padding(.horizontal, 10).padding(.vertical, 6).background(RoundedRectangle(cornerRadius: 6).fill(K.accent.opacity(0.12)))
        }.buttonStyle(.plain).help("Show the headline pill on screen again")
      }
      Spacer()
      Menu {
        Toggle("Show Headline on Screen", isOn: $m.showHUD)
        Button("Refresh") { m.fetch() }
        Button(m.checkedNoUpdate && m.update == nil ? "Up to Date (\(Model.version))" : "Check for Updates") { m.checkUpdate(force: true) }
        Divider()
        Button("Settings…") { m.onSettings?() }.keyboardShortcut(",")
        Divider()
        Button("Quit Life Console Now", action: quit)
      } label: { Image(systemName: "gearshape") }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().foregroundColor(K.muted)
    }.padding(.top, 2)
  }
}


/** Settings window (gear menu → Settings…): the widget, the menu bar, login, account. */
struct SettingsView: View {
  @ObservedObject var m: Model
  let changeServer: () -> Void, connect: () -> Void, refit: () -> Void
  @State private var loginOn = SMAppService.mainApp.status == .enabled
  var body: some View {
    Form {
      Section("Widget in the screen's corner") {
        Toggle("Show the widget", isOn: $m.showHUD)
        LabeledContent("Size") {
          HStack(spacing: 8) {
            Image(systemName: "textformat.size.smaller").foregroundColor(.secondary)
            NotchedSlider(value: Binding(get: { m.hudScale }, set: { m.hudScale = $0; if !m.showHUD { m.showHUD = true } }), range: Model.hudScaleRange, notches: 10)
              .frame(minWidth: 180)
            Image(systemName: "textformat.size.larger").foregroundColor(.secondary)
            Text("\(Int((m.hudScale * 100).rounded()))%").monospacedDigit().foregroundColor(.secondary).frame(width: 40, alignment: .trailing)
          }
        }
        Stepper(value: $m.hudDeadlines, in: 0...10) {
          HStack { Text("Deadlines below it"); Spacer(); Text(m.hudDeadlines == 0 ? "None" : "Closest \(m.hudDeadlines)").foregroundColor(.secondary) }
        }
        HStack { Text("Position"); Spacer(); Button("Back to the Corner") { m.resetHUD() } }
      }
      Section("Panel") {
        Stepper(value: $m.panelDeadlines, in: 0...10) {
          HStack { Text("Deadlines"); Spacer(); Text(m.panelDeadlines == 0 ? "None" : "Closest \(m.panelDeadlines)").foregroundColor(.secondary) }
        }
      }
      Section {
        HStack { Text("Headline size"); Spacer(); Button("Fit Menu Bar Again", action: refit) }
      } header: { Text("Menu bar") } footer: {
        Text("When the menu bar is full, the headline shortens until it fits. After freeing space, let it grow back.").font(.caption).foregroundColor(.secondary)
      }
      Section("General") {
        Toggle("Open at login", isOn: Binding(get: { loginOn }, set: { on in
          if on { try? SMAppService.mainApp.register() } else { try? SMAppService.mainApp.unregister() }
          loginOn = SMAppService.mainApp.status == .enabled
        }))
        LabeledContent("Version") {
          HStack { Text(Model.version).foregroundColor(.secondary)
            Button(m.checkedNoUpdate && m.update == nil ? "Up to Date" : "Check for Updates") { m.checkUpdate(force: true) } }
        }
      }
      Section("Account") {
        LabeledContent("Server") { Text(m.url).foregroundColor(.secondary).textSelection(.enabled) }
        LabeledContent("Status") { Text(!m.connected ? "Not connected" : m.error ?? "Connected").foregroundColor(m.connected && m.error == nil ? .secondary : .orange) }
        HStack { Button("Connect from Life Console…", action: connect); Spacer(); Button("Server & Token…", action: changeServer) }
      }
    }
    .formStyle(.grouped).frame(width: 460)
  }
}

/** NSSlider with tick marks ("notches"): continuous, but snaps to a notch within 2 % of it. */
struct NotchedSlider: NSViewRepresentable {
  @Binding var value: Double
  let range: ClosedRange<Double>
  let notches: Int
  func makeNSView(context: Context) -> NSSlider {
    let s = NSSlider(value: value, minValue: range.lowerBound, maxValue: range.upperBound, target: context.coordinator, action: #selector(Coordinator.changed(_:)))
    s.numberOfTickMarks = notches; s.allowsTickMarkValuesOnly = false; s.tickMarkPosition = .below; s.isContinuous = true
    s.controlSize = .small
    return s
  }
  func updateNSView(_ s: NSSlider, context: Context) { if abs(s.doubleValue - value) > 0.001 { s.doubleValue = value } }
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  final class Coordinator: NSObject {
    var parent: NotchedSlider
    init(_ p: NotchedSlider) { parent = p }
    @objc func changed(_ s: NSSlider) {
      let tick = s.closestTickMarkValue(toValue: s.doubleValue)
      let snapped = abs(tick - s.doubleValue) < (parent.range.upperBound - parent.range.lowerBound) * 0.02 ? tick : s.doubleValue
      parent.value = (snapped * 100).rounded() / 100
    }
  }
}

/* ───────────── on-screen headline: the app's NOW pill (App.vue .nowpill) ───────────── */
struct HUD: View {
  static let inset: CGFloat = 8                 // the window is this much larger than the pill on every side
  @ObservedObject var m: Model
  let open: () -> Void
  @State private var hover = false
  var body: some View {
    if let n = m.snapshot {
      let bar = n.bar, z = CGFloat(m.hudScale)   // every size below scales with Widget Size
      let busy = bar.mode == .busy, free = bar.mode == .free
      let tagColor = busy ? K.stamp : bar.plan ? K.info : free ? K.accent : K.border
      VStack(alignment: .trailing, spacing: 4 * z) {
      HStack(spacing: 8 * z) {
        Text(busy ? "NOW" : bar.plan ? "PLAN" : free ? "NEXT" : "IDLE").font(.system(size: 10 * z, weight: .bold, design: .monospaced)).tracking(0.6 * z)
          .foregroundColor(busy ? .white : free ? tagColor : K.muted)
          .padding(.horizontal, 6 * z).padding(.vertical, 2 * z)
          .background(RoundedRectangle(cornerRadius: 2 * z).fill(busy ? K.stamp : K.surface))
          .overlay(RoundedRectangle(cornerRadius: 2 * z).stroke(tagColor, lineWidth: 1))
        Text(bar.title).font(.system(size: 13 * z, weight: .medium)).foregroundColor(K.text)
          .lineLimit(1).truncationMode(.tail).frame(maxWidth: 320 * z, alignment: .leading)
        if !bar.longMeta.isEmpty {
          Text(bar.longMeta).font(.system(size: 11 * z, weight: .medium, design: .monospaced)).foregroundColor(K.muted).lineLimit(1).frame(maxWidth: 160 * z)
        }
      }
      .padding(.leading, 4 * z).padding(.trailing, 10 * z).frame(height: 30 * z)
      .fixedSize(horizontal: true, vertical: false)   // its own width, not the deadline list's
      .background(K.surface2)
      .overlay(alignment: .bottomLeading) {
        if busy { GeometryReader { g in Rectangle().fill(K.accent).frame(width: g.size.width * n.progress, height: 2 * z).frame(maxHeight: .infinity, alignment: .bottom) } }
      }
      .clipShape(RoundedRectangle(cornerRadius: 3 * z))
      .overlay(RoundedRectangle(cornerRadius: 3 * z).stroke(busy ? K.stamp.opacity(0.6) : K.border, lineWidth: 1))
      .contentShape(Rectangle())
      .onTapGesture(count: 2) { m.resetHUD() }
      .onTapGesture(perform: open)
      .help("Click: Focus mode · Drag: move · Double-click: back to the corner")
      if m.hudDeadlines > 0 && !n.deadlines.isEmpty { deadlineList(n, z) }
      }
      .padding(HUD.inset)                       // transparent margin so the close button can sit on the corner
      .overlay(alignment: .topLeading) {
        // one-click hide on the pill's top-left corner, like a macOS notification; shown on hover; a fixed size whatever the widget size
        if hover {
          Button { m.showHUD = false } label: {
            Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).foregroundColor(K.text)
              .frame(width: 16, height: 16).background(Circle().fill(K.surface2)).overlay(Circle().stroke(K.border, lineWidth: 1))
              .shadow(color: .black.opacity(0.25), radius: 1.5, y: 0.5)
          }.buttonStyle(.plain).help("Hide (bring it back from the menu-bar panel → Show headline)")
        }
      }
      .onHover { hover = $0 }
      .fixedSize()
    }
  }
}

extension HUD {
  /** The closest n deadlines (Settings → Widget), under the pill; click → the Deadlines page. */
  func deadlineList(_ n: Now, _ z: CGFloat) -> some View {
    VStack(alignment: .leading, spacing: 4 * z) {
      ForEach(n.deadlines.prefix(m.hudDeadlines)) { d in
        let col = d.mins <= 720 ? K.danger : d.mins <= 2880 ? K.warn : K.accent
        HStack(spacing: 7 * z) {
          Image(systemName: d.mins <= 0 ? "exclamationmark.triangle.fill" : "flag.fill").font(.system(size: 9 * z)).foregroundColor(col)
          Text(d.title).font(.system(size: 12 * z)).foregroundColor(K.text).lineLimit(1).truncationMode(.tail)
            .frame(maxWidth: 300 * z, alignment: .leading)
          Spacer(minLength: 10 * z)
          Text(d.mins <= 0 ? "OVERDUE" : countdown(d.mins)).font(.system(size: 11 * z, weight: .medium, design: .monospaced)).foregroundColor(col)
        }
      }
    }
    .padding(.horizontal, 9 * z).padding(.vertical, 7 * z)
    .background(K.surface2)
    .clipShape(RoundedRectangle(cornerRadius: 3 * z))
    .overlay(RoundedRectangle(cornerRadius: 3 * z).stroke(K.border, lineWidth: 1))
    .contentShape(Rectangle()).onTapGesture { m.onDeadlines?() }
    .help("Click: the Deadlines page")
  }
}

/** The pill floats over other apps' windows, so its first click must act (hide / open), not just focus it. */
final class FirstMouseHost<V: View>: NSHostingView<V> { override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true } }

/* ───────────── menu-bar glyph: the radar from the app icon, as a template image ───────────── */
func radarGlyph() -> NSImage {
  let img = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { r in
    NSColor.black.set()
    let c = NSPoint(x: 9, y: 9)
    func ring(_ rad: CGFloat, _ w: CGFloat, _ a: CGFloat) {
      let p = NSBezierPath(ovalIn: NSRect(x: c.x - rad, y: c.y - rad, width: rad * 2, height: rad * 2)); p.lineWidth = w
      NSColor.black.withAlphaComponent(a).setStroke(); p.stroke()
    }
    ring(7.6, 1.5, 1); ring(4.6, 1.2, 0.55); ring(1.9, 1.1, 0.55)
    let sweep = NSBezierPath(); sweep.lineWidth = 1.5; sweep.lineCapStyle = .round
    sweep.move(to: c); sweep.line(to: NSPoint(x: 16.2, y: 5.4)); NSColor.black.setStroke(); sweep.stroke()
    NSBezierPath(ovalIn: NSRect(x: c.x - 1.5, y: c.y - 1.5, width: 3, height: 3)).fill()
    NSBezierPath(ovalIn: NSRect(x: 10.6, y: 2.6, width: 3.4, height: 3.4)).fill()
    return true
  }
  img.isTemplate = true
  return img
}

/**
 * The menu-bar headline, drawn in the status item itself so it never moves when you swipe between Spaces:
 * [radar] [NOW|NEXT tag] [title slot] [time]. The radar is dropped while a block is running (NOW leads instead).
 * The title slot has a fixed width; a longer title ends in "…" and scrolls (marquee) while the pointer is over it.
 * Colours resolve at draw time, so it follows light and dark menu bars.
 */
final class HeadlineView: NSView {
  var mode: Now.Mode = .idle, meta = "", stale = false
  var plan = false
  var title = "" { didSet { if title != oldValue { textW = ceil((title as NSString).size(withAttributes: [.font: font]).width) } } }
  var slot: CGFloat = 0                         // max width of the title slot
  private let font = NSFont.menuBarFont(ofSize: 0)
  private let tagFont = NSFont.monospacedSystemFont(ofSize: 9.5, weight: .bold)
  private let metaFont = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
  private let gap: CGFloat = 36                 // space between the end of the title and its repeat while scrolling
  private let radar = radarGlyph()
  private var textW: CGFloat = 0               // measured once per title, not per frame
  // marquee: the title is rendered once into an image strip that Core Animation slides (near-zero CPU)
  private let clip = NSView(), strip = CALayer()
  private var marqueeKey = "", hovering = false

  override init(frame: NSRect) {
    super.init(frame: frame)
    clip.wantsLayer = true; clip.layer?.masksToBounds = true; clip.layer?.addSublayer(strip); clip.isHidden = true
    strip.anchorPoint = .zero
    addSubview(clip)
  }
  required init?(coder: NSCoder) { fatalError() }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }   // clicks go to the status item button
  private var tagText: String? { mode == .busy ? "NOW" : plan ? "PLAN" : mode == .free ? "NEXT" : nil }
  private var showRadar: Bool { tagText == nil }   // the NOW / NEXT / MISSED tag leads when there is one
  private var tagW: CGFloat { tagText.map { ceil(($0 as NSString).size(withAttributes: [.font: tagFont, .kern: 0.6]).width) + 10 } ?? 0 }
  private var titleW: CGFloat { title.isEmpty ? 0 : min(slot, textW) }
  private var overflows: Bool { !title.isEmpty && textW > titleW }
  private var metaW: CGFloat { meta.isEmpty ? 0 : ceil((meta as NSString).size(withAttributes: [.font: metaFont]).width) }
  private var parts: [CGFloat] { [showRadar ? 18 : 0, tagW, titleW, metaW, stale ? 10 : 0].filter { $0 > 0 } }
  var fittingWidth: CGFloat { parts.reduce(0, +) + CGFloat(max(0, parts.count - 1)) * 6 + 8 }
  private var lineH: CGFloat { ceil(font.ascender - font.descender) }
  private var titleRect: NSRect {
    let x = 4 + (showRadar ? 24 : 0) + (tagText == nil ? 0 : tagW + 6)
    return NSRect(x: x, y: ((bounds.height - lineH) / 2).rounded(), width: titleW, height: lineH)
  }

  override func draw(_ dirty: NSRect) {
    let h = bounds.height
    var x: CGFloat = 4
    if showRadar {
      let tinted = NSImage(size: radar.size, flipped: false) { r in self.radar.draw(in: r); NSColor.labelColor.set(); r.fill(using: .sourceAtop); return true }
      tinted.draw(in: NSRect(x: x, y: (h - 18) / 2, width: 18, height: 18)); x += 18 + 6
    }
    if let tag = tagText {
      let box = NSRect(x: x + 0.5, y: (h - 13) / 2, width: tagW - 1, height: 13)
      let path = NSBezierPath(roundedRect: box, xRadius: 2.5, yRadius: 2.5)
      let fg: NSColor
      if mode == .busy { rgb(0xd94a3d).setFill(); path.fill(); fg = .white }
      else {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        fg = plan ? (dark ? rgb(0x4c9aff) : rgb(0x2563eb)) : (dark ? rgb(0x3fb68b) : rgb(0x1e8a63))
        fg.setStroke(); path.lineWidth = 1; path.stroke()
      }
      let str = NSAttributedString(string: tag, attributes: [.font: tagFont, .kern: 0.6, .foregroundColor: fg])
      let sz = str.size()
      str.draw(at: NSPoint(x: box.midX - sz.width / 2 + 0.3, y: box.midY - sz.height / 2 + 0.5))
      x += tagW + 6
    }
    if titleW > 0 {
      let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.labelColor]
      if !overflows { (title as NSString).draw(at: titleRect.origin, withAttributes: attrs) }
      else if !hovering {
        // truncate by hand ("…"); while hovered the marquee layer draws the title instead
        var chars = Array(title)
        while !chars.isEmpty && ((String(chars) + "…") as NSString).size(withAttributes: attrs).width > titleW { chars.removeLast() }
        ((String(chars).trimmingCharacters(in: .whitespaces) + "…") as NSString).draw(at: titleRect.origin, withAttributes: attrs)
      }
      x += titleW + 6
    }
    if metaW > 0 {
      let mh = ceil(metaFont.ascender - metaFont.descender)
      (meta as NSString).draw(at: NSPoint(x: x, y: (h - mh) / 2), withAttributes: [.font: metaFont, .foregroundColor: NSColor.secondaryLabelColor])
      x += metaW + 6
    }
    if stale {
      ("⚠︎" as NSString).draw(at: NSPoint(x: x, y: (h - 14) / 2), withAttributes: [.font: NSFont.systemFont(ofSize: 10), .foregroundColor: NSColor.systemOrange])
    }
  }

  override func viewDidChangeEffectiveAppearance() { marqueeKey = ""; syncMarquee() }

  // hover → marquee
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    trackingAreas.forEach(removeTrackingArea)
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  override func mouseEntered(with event: NSEvent) { hovering = true; marqueeKey = ""; syncMarquee(); needsDisplay = true }
  override func mouseExited(with event: NSEvent) { hovering = false; syncMarquee(); needsDisplay = true }

  /** While hovered and the title overflows its slot: scroll it (short rest at the start of each pass). */
  func syncMarquee() {
    guard overflows, hovering else { clip.isHidden = true; strip.removeAllAnimations(); marqueeKey = ""; return }
    let scale = window?.backingScaleFactor ?? 2
    let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    CATransaction.begin(); CATransaction.setDisableActions(true)
    clip.isHidden = false; clip.frame = titleRect
    CATransaction.commit()
    let key = "\(title)|\(dark)|\(scale)|\(titleW)"
    guard key != marqueeKey else { return }
    marqueeKey = key

    // render "title   title" once, in the menu bar's text colour
    let w = textW * 2 + gap, size = NSSize(width: w, height: lineH)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(ceil(w * scale)), pixelsHigh: Int(ceil(lineH * scale)), bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = size
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.labelColor]
      (title as NSString).draw(at: .zero, withAttributes: attrs)
      (title as NSString).draw(at: NSPoint(x: textW + gap, y: 0), withAttributes: attrs)
    }
    NSGraphicsContext.restoreGraphicsState()

    CATransaction.begin(); CATransaction.setDisableActions(true)
    strip.contents = rep.cgImage; strip.contentsScale = scale
    strip.frame = NSRect(origin: .zero, size: size)
    CATransaction.commit()

    let rest: Double = 0.5, run = Double(textW + gap) / 36         // ~36 pt/s
    let a = CAKeyframeAnimation(keyPath: "position.x")
    a.values = [0, 0, -(textW + gap)]
    a.keyTimes = [0, NSNumber(value: rest / (rest + run)), 1]
    a.duration = rest + run; a.repeatCount = .infinity
    strip.removeAllAnimations(); strip.add(a, forKey: "marquee")
  }
}

/** The app's artwork as a small rounded square for the menu bar (falls back to the radar glyph). */
func menuIcon() -> NSImage {
  guard let p = Bundle.main.path(forResource: "MenuIcon", ofType: "png"), let src = NSImage(contentsOfFile: p) else { return radarGlyph() }
  return NSImage(size: NSSize(width: 18, height: 18), flipped: false) { r in
    NSBezierPath(roundedRect: r, xRadius: 4.5, yRadius: 4.5).addClip()
    src.draw(in: r); return true
  }
}

/* ───────────── app ───────────── */
final class App: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  let popover = NSPopover()
  let model = Model()
  let hud = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  var hudHost: FirstMouseHost<HUD>!
  var placing = false

  func applicationWillFinishLaunching(_ note: Notification) {
    // lifeconsole-now://connect?server=…&token=… from Settings → Mac menu-bar app → Connect (also when it launches us)
    NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:reply:)), forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    UNUserNotificationCenter.current().delegate = self
    model.onUpdateFound = { [weak self] u in self?.notifyUpdate(u) }
    model.onInstall = { [weak self] in self?.installUpdate() }
    model.onConnect = { [weak self] in self?.openConnectPage() }
    model.onPlan = { [weak self] in self?.openPath("/app#/week") }
    model.onSettings = { [weak self] in self?.openSettings() }
    model.onDeadlines = { [weak self] in self?.openPath("/app#/deadlines") }
    if !defaults.bool(forKey: "loginAsked") { defaults.set(true, forKey: "loginAsked"); try? SMAppService.mainApp.register() }

    item.button?.target = self; item.button?.action = #selector(toggle)
    let hc = NSHostingController(rootView: Panel(m: model, open: { [weak self] in self?.openApp() }, settings: { [weak self] in self?.configure() }, quit: { NSApp.terminate(nil) }))
    hc.sizingOptions = .preferredContentSize
    popover.contentViewController = hc; popover.behavior = .transient; popover.animates = true

    hud.level = .statusBar; // menu-bar level: stays put while swiping between Spaces (.floating fades out and back in)
    hud.isOpaque = false; hud.backgroundColor = .clear; hud.hasShadow = true
    hud.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    hud.isMovableByWindowBackground = true; hud.hidesOnDeactivate = false
    hudHost = FirstMouseHost(rootView: HUD(m: model, open: { [weak self] in self?.openFocus() }))
    hud.contentView = hudHost
    NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: hud, queue: .main) { [weak self] _ in self?.hudMoved() }
    NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.renderHUD() }

    model.onChange = { [weak self] in self?.renderTitle(); self?.renderHUD() }
    model.onRefit = { [weak self] in self?.compact = 0; self?.renderTitle() }
    renderTitle(); renderHUD()
    if model.connected { model.fetch() } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.showPanel() } }
    model.checkUpdate()
    Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.model.fetch() }
    Timer.scheduledTimer(withTimeInterval: 1800, repeats: true) { [weak self] _ in self?.model.checkUpdate() }
    Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.model.tick() }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.model.fetch() }
  }

  let headline = HeadlineView()
  func renderTitle() {
    guard let b = item.button else { return }
    if headline.superview == nil { b.image = nil; b.title = ""; b.addSubview(headline) }
    let n = model.snapshot
    let bar = n?.bar ?? Now.Bar()
    let title = bar.mode == .idle ? "" : bar.title, meta = bar.meta
    // compact steps (only ever shrinks, see checkFit): the title slot narrows; the time always stays
    headline.mode = bar.mode; headline.plan = bar.plan; headline.title = title
    headline.slot = [150, 110, 80, 56, 0][compact]
    headline.meta = meta
    headline.stale = model.stale && model.error != nil
    item.length = headline.fittingWidth
    headline.frame = NSRect(x: 0, y: 0, width: item.length, height: b.bounds.height)
    headline.needsDisplay = true
    headline.syncMarquee()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.checkFit() }
  }

  /**
   * macOS hides a status item that doesn't fit instead of shrinking it: step down until it shows. It only ever shrinks
   * (remembered across launches), so it settles on a size that fits next to every app's menus and never blinks when
   * you switch apps or swipe between Spaces.
   */
  var compact = defaults.integer(forKey: "compactV5") { didSet { defaults.set(compact, forKey: "compactV5") } }
  func checkFit(confirming: Bool = false) {
    guard compact < 4, !itemShown(), menuBarShowing() else { return }
    // a real overflow persists; a swipe, full-screen app or menu-bar reflow is gone a second later
    if !confirming { DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in self?.checkFit(confirming: true) }; return }
    compact += 1; renderTitle()
  }
  /** Ask the window server: a hidden item may still sit at the screen edge, so geometry alone can't tell. */
  func itemShown() -> Bool {
    guard let w = item.button?.window else { return true }
    let info = (CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(w.windowNumber)) as? [[String: Any]])?.first
    return (info?[kCGWindowIsOnscreen as String] as? Bool ?? false) && NSScreen.screens.contains { $0.frame.contains(w.frame) }
  }
  /** Is the menu bar actually on screen (macOS's own Control Centre items visible at the top)? Not in full screen or mid-swipe. */
  func menuBarShowing() -> Bool {
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    return list.contains {
      ($0[kCGWindowOwnerName as String] as? String) == "Control Centre" && ($0[kCGWindowLayer as String] as? Int) == 25
        && num(($0[kCGWindowBounds as String] as? [String: Any])?["Y"]) == 0
    }
  }

  @objc func toggle() {
    guard let b = item.button else { return }
    if popover.isShown { popover.performClose(nil) } else {
      model.tick(); model.fetch()
      popover.show(relativeTo: b.bounds, of: b, preferredEdge: .minY)
      popover.contentViewController?.view.window?.makeKey()
    }
  }
  /** Keep the pill pinned by its top-right corner (offsets saved when you drag it) while its width changes. */
  func renderHUD() {
    guard model.showHUD, model.snapshot != nil, let vf = (hud.screen ?? NSScreen.main)?.visibleFrame else { hud.orderOut(nil); return }
    hudHost.layoutSubtreeIfNeeded()
    let size = hudHost.fittingSize
    let right = defaults.object(forKey: "hudRight") as? Double ?? 12 - Double(HUD.inset), top = defaults.object(forKey: "hudTop") as? Double ?? 10 - Double(HUD.inset)
    let f = NSRect(x: vf.maxX - right - size.width, y: vf.maxY - top - size.height, width: size.width, height: size.height)
    if hud.frame != f { placing = true; hud.setFrame(f, display: true); placing = false }
    if !hud.isVisible { hud.orderFrontRegardless() }
  }
  func hudMoved() {
    guard !placing, let vf = (hud.screen ?? NSScreen.main)?.visibleFrame else { return }
    defaults.set(Double(vf.maxX - hud.frame.maxX), forKey: "hudRight"); defaults.set(Double(vf.maxY - hud.frame.maxY), forKey: "hudTop")
  }
  /** The pill: Focus mode, or the week planner while it asks you to schedule what's next. */
  func openFocus() { openPath(model.snapshot?.planning == true ? "/app#/week" : "/app#/focus") }
  func openPath(_ p: String) { popover.performClose(nil); if let u = URL(string: model.url + p) { NSWorkspace.shared.open(u) } }
  var settingsWindow: NSWindow?
  func openSettings() {
    popover.performClose(nil)
    if settingsWindow == nil {
      let hc = NSHostingController(rootView: SettingsView(m: model, changeServer: { [weak self] in self?.configure() },
                                                          connect: { [weak self] in self?.openConnectPage() },
                                                          refit: { [weak self] in self?.model.onRefit?() }))
      hc.sizingOptions = .preferredContentSize
      let w = NSWindow(contentViewController: hc)
      w.title = "Life Console Now Settings"; w.styleMask = [.titled, .closable]; w.isReleasedWhenClosed = false
      w.center(); settingsWindow = w
    }
    NSApp.activate(ignoringOtherApps: true)
    settingsWindow?.makeKeyAndOrderFront(nil)
  }

  func showPanel() {
    guard let b = item.button, !popover.isShown else { return }
    popover.show(relativeTo: b.bounds, of: b, preferredEdge: .minY)
    popover.contentViewController?.view.window?.makeKey()
  }

  /* ── connecting an account ── */
  /** /app: the app itself, even on servers where / is the landing page for signed-out visitors. */
  func openConnectPage() { if let u = URL(string: model.url + "/app#/settings?mac=connect") { NSWorkspace.shared.open(u) } }
  @objc func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
    guard let s = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue, let c = URLComponents(string: s),
          c.scheme == "lifeconsole-now", c.host == "connect" else { return }
    let q = Dictionary((c.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    guard let server = q["server"].flatMap(URL.init(string:)), ["https", "http"].contains(server.scheme ?? ""), let host = server.host,
          let token = q["token"], token.hasPrefix("lct_") else { return }
    NSApp.activate(ignoringOtherApps: true)
    let a = NSAlert(); a.icon = NSApp.applicationIconImage
    a.messageText = "Connect Life Console Now to \(host)?"
    a.informativeText = "Your schedule from \(server.absoluteString) will show in the menu bar." + (model.connected ? " This replaces the account it shows now." : "")
    a.addButton(withTitle: "Connect"); a.addButton(withTitle: "Cancel")
    guard a.runModal() == .alertFirstButtonReturn else { return }
    model.connect(server: server.absoluteString, token: token)
    showPanel()
  }

  /* ── updates: notify once per version, install with one click ── */
  func notifyUpdate(_ u: Model.Update) {
    guard defaults.string(forKey: "notifiedVersion") != u.version, ProcessInfo.processInfo.environment["LCNOW_TEST_AUTOINSTALL"] != "1" else { return }
    defaults.set(u.version, forKey: "notifiedVersion")
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound]) { ok, _ in
      guard ok else { return }
      let c = UNMutableNotificationContent()
      c.title = "Life Console Now \(u.version) is available"
      c.body = "Click to install. It restarts in a few seconds."
      center.add(UNNotificationRequest(identifier: "update-\(u.version)", content: c, trigger: nil))
    }
  }
  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    DispatchQueue.main.async { self.showPanel() }
    done()
  }
  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) { done([.banner, .sound]) }

  /**
   * Download the release zip, check its SHA-256 (from GitHub via the server) and that it really is this app at the
   * announced version, then a tiny script swaps the bundle in place once we've quit, and starts the new one.
   */
  func installUpdate() {
    guard let u = model.update, !model.installing, let zipURL = URL(string: u.zip) else { return }
    let dest = Bundle.main.bundlePath
    guard FileManager.default.isWritableFile(atPath: (dest as NSString).deletingLastPathComponent) else {
      model.updateError = "Can’t write to \((dest as NSString).deletingLastPathComponent). Move the app to Applications first."; return
    }
    model.installing = true; model.updateError = nil
    let fail: (String) -> Void = { msg in DispatchQueue.main.async { self.model.installing = false; self.model.updateError = msg } }
    URLSession.shared.downloadTask(with: zipURL) { tmp, resp, err in
      guard let tmp, (resp as? HTTPURLResponse)?.statusCode == 200 else { return fail("Download failed: \(err?.localizedDescription ?? "server error"). Try again.") }
      do {
        let data = try Data(contentsOf: tmp)
        if !u.sha256.isEmpty {
          let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
          guard digest == u.sha256.lowercased() else { return fail("The download didn’t match its checksum, so it wasn’t installed.") }
        }
        let work = FileManager.default.temporaryDirectory.appendingPathComponent("lcnow-update-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        let zip = work.appendingPathComponent("update.zip"); try data.write(to: zip)
        let unzip = Process(); unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto"); unzip.arguments = ["-x", "-k", zip.path, work.path]
        try unzip.run(); unzip.waitUntilExit()
        let newApp = work.appendingPathComponent("Life Console Now.app")
        let info = NSDictionary(contentsOf: newApp.appendingPathComponent("Contents/Info.plist"))
        guard unzip.terminationStatus == 0, info?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
              info?["CFBundleShortVersionString"] as? String == u.version else { return fail("The download wasn’t a valid Life Console Now \(u.version).") }
        let script = work.appendingPathComponent("swap.sh")
        try """
        #!/bin/sh
        while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
        rm -rf "$3.previous"
        if mv "$3" "$3.previous" && mv "$2" "$3"; then rm -rf "$3.previous"; else [ -d "$3" ] || mv "$3.previous" "$3"; fi
        xattr -dr com.apple.quarantine "$3" 2>/dev/null
        open "$3"
        """.write(to: script, atomically: true, encoding: .utf8)
        let swap = Process(); swap.executableURL = URL(fileURLWithPath: "/bin/sh")
        swap.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), newApp.path, dest]
        try swap.run()
        DispatchQueue.main.async { NSApp.terminate(nil) }
      } catch { fail("Couldn’t install: \(error.localizedDescription)") }
    }.resume()
  }

  func openApp() { popover.performClose(nil); if let u = URL(string: model.url) { NSWorkspace.shared.open(u) } }
  func configure() {
    popover.performClose(nil)
    NSApp.activate(ignoringOtherApps: true)
    let a = NSAlert(); a.messageText = "Life Console Now"; a.icon = NSApp.applicationIconImage
    a.informativeText = "Your Life Console server and an API token. Easiest: in Life Console open Settings → Mac menu-bar app → Connect, which fills these in for you."
    let u = NSTextField(frame: NSRect(x: 0, y: 30, width: 320, height: 24)); u.stringValue = model.url; u.placeholderString = "https://…"
    let t = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24)); t.stringValue = model.token; t.placeholderString = "API token"
    let v = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 54)); v.addSubview(u); v.addSubview(t); a.accessoryView = v
    a.addButton(withTitle: "Save"); a.addButton(withTitle: "Cancel")
    if a.runModal() == .alertFirstButtonReturn {
      model.connect(server: u.stringValue.trimmingCharacters(in: .whitespaces), token: t.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
    }
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

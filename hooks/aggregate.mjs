// Scans ~/.claude/projects/**/*.jsonl (sessions and subagents), caches one summary per file,
// asks git for lines added/deleted per day, prints one JSON report on stdout.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const HOME = os.homedir()
const ROOT = path.join(HOME, '.claude', 'projects')
const CACHE = path.join(HOME, '.claude', 'crab-ledger-cache.json')
const DAYS = 30
const GAP = 5 * 60 * 1000
const VER = 7

// $ per million tokens: [input, output]. Cache write = 1.25x input, read = 0.1x input. Rough.
const PRICES = [
  [/haiku/, [1, 5]],
  [/sonnet/, [3, 15]],
  [/opus/, [5, 25]],
  [/fable/, [10, 50]],
]
const price = m => (PRICES.find(([re]) => re.test(m || '')) || [0, [3, 15]])[1]
const costOf = (m, u) => {
  const [pi, po] = price(m)
  return (
    (u.in * pi + u.out * po + u.cw * pi * 1.25 + u.cr * pi * 0.1) / 1e6
  )
}
const comps = (m, u) => {
  const [pi, po] = price(m)
  return { in: (u.in * pi) / 1e6, out: (u.out * po) / 1e6, cw: (u.cw * pi * 1.25) / 1e6, cr: (u.cr * pi * 0.1) / 1e6 }
}
const famOf = m => (/opus/.test(m || '') ? 'opus' : /sonnet/.test(m || '') ? 'sonnet' : /haiku/.test(m || '') ? 'haiku' : /fable/.test(m || '') ? 'fable' : 'other')
const relPath = p => String(p).replaceAll('\\', '/').replace(/^(.*\/GitHub\/[^/]+\/)\.claude\/worktrees\/[^/]+\//, '$1').replace(/^.*\/GitHub\//, '')
const normCmd = c => c.replace(/"[^"]*"|'[^']*'/g, '""').replace(/[A-Za-z]:[\\/]\S*|\/\S+/g, '<p>').replace(/\b[0-9a-f]{7,}\b/g, '<h>').replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim()
// what counts as "the same task" when a tool call comes back: only things worth repeating (not each Edit)
const keyOf = b => {
  const i = b.input || {}
  if (b.name === 'Read' && i.file_path) return `Read ${relPath(i.file_path)}`
  if (b.name === 'Bash' || b.name === 'PowerShell') {
    const c = normCmd(String(i.command || '').split('\n')[0].replace(/^\s*cd\s+\S+\s*(&&|;)\s*/, ''))
    return c ? `${b.name} ${c.split(' ').slice(0, 3).join(' ')}` : null
  }
  if (b.name === 'Grep' && i.pattern) return `Grep ${String(i.pattern).slice(0, 40)}`
  if (b.name === 'Glob' && i.pattern) return `Glob ${String(i.pattern).slice(0, 40)}`
  if (b.name === 'Agent' || b.name === 'Task') return `Agent ${i.subagent_type || ''}: ${String(i.description || '').toLowerCase().split(/\s+/).slice(0, 5).join(' ')}`
  return null
}
const CAT = { Read: 'read', Grep: 'read', Glob: 'read', LS: 'read', WebFetch: 'read', WebSearch: 'read', ToolSearch: 'read', Edit: 'write', Write: 'write', MultiEdit: 'write', NotebookEdit: 'write', Bash: 'run', PowerShell: 'run', Monitor: 'run' }
const ZERO_ACT = () => ({ think: 0, read: 0, write: 0, run: 0, input: 0, wait: 0 })
const dayOf = ms => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function walk(dir, out) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
}

function summarize(file, isAgent) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const msgs = new Map() // id -> {ts, model, usage}
  const reads = [] // {id, path, ts, turn, model}
  const sizes = new Map() // tool_use_id -> chars
  const stamps = []
  const cwds = new Set()
  const tools = new Map() // tool_use id -> {ts, model, name, w, d}
  const actByDay = {}
  const rk = {}
  let prevTs = null
  let turn = 0
  for (const line of lines) {
    if (!line || line[0] !== '{') continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    const ts = r.timestamp ? Date.parse(r.timestamp) : NaN
    if (!Number.isNaN(ts)) {
      stamps.push(ts)
      // the time since the record before: who was working?
      if (prevTs !== null && ts - prevTs > 0 && ts - prevTs <= GAP) {
        let cat = 'wait', hit = null
        if (r.type === 'assistant') cat = 'think'
        else if (r.type === 'user' && r.message) {
          const c = r.message.content
          if (typeof c === 'string') cat = 'input'
          else if (Array.isArray(c)) {
            const tr = c.find(x => x.type === 'tool_result')
            if (tr) { hit = tools.get(tr.tool_use_id); cat = (hit && CAT[hit.name]) || 'wait' } else cat = 'input'
          }
        }
        const d0 = dayOf(ts)
        ;(actByDay[d0] ||= ZERO_ACT())[cat] += ts - prevTs
        if (hit && hit.key && !/^Agent/.test(hit.key)) ((rk[hit.key] ||= {})[d0] ||= { n: 0, ms: 0 }).ms += ts - prevTs
      }
      prevTs = ts
    }
    if (r.cwd) cwds.add(r.cwd)
    const m = r.message
    if (r.type === 'assistant' && m && m.usage) {
      const u = m.usage
      const id = m.id || r.uuid
      if (!msgs.has(id)) turn++
      msgs.set(id, {
        ts, turn: msgs.has(id) ? msgs.get(id).turn : turn, model: m.model,
        u: { in: u.input_tokens || 0, out: u.output_tokens || 0, cw: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0 },
      })
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === 'tool_use' && !tools.has(b.id)) {
            const i = b.input || {}
            const n = t => (typeof t === 'string' && t ? t.split('\n').length : 0)
            let w = 0, d = 0
            if (b.name === 'Write') w = n(i.content)
            else if (b.name === 'Edit') { w = n(i.new_string); d = n(i.old_string) }
            else if (b.name === 'MultiEdit' && Array.isArray(i.edits)) for (const e of i.edits) { w += n(e.new_string); d += n(e.old_string) }
            const key = keyOf(b)
            tools.set(b.id, { ts, model: m.model, name: b.name, w, d, edit: w + d > 0, key })
            if (key && !Number.isNaN(ts)) ((rk[key] ||= {})[dayOf(ts)] ||= { n: 0, ms: 0 }).n++
          }
          if (b.type === 'tool_use' && b.name === 'Read' && b.input && b.input.file_path && !reads.some(x => x.id === b.id)) {
            reads.push({ id: b.id, path: String(b.input.file_path), ts, turn: msgs.get(id).turn, model: m.model })
          }
        }
      }
    } else if (r.type === 'user' && m && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          const c = b.content
          const n = typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, x) => a + (x.text ? x.text.length : 0), 0) : 0
          sizes.set(b.tool_use_id, n)
        }
      }
    }
  }
  // per-day usage
  const byDay = {}
  for (const x of msgs.values()) {
    if (Number.isNaN(x.ts)) continue
    const d = dayOf(x.ts)
    const o = (byDay[d] ||= { in: 0, out: 0, cw: 0, cr: 0, cost: 0, msgs: 0, c: { in: 0, out: 0, cw: 0, cr: 0 }, fam: {} })
    o.in += x.u.in; o.out += x.u.out; o.cw += x.u.cw; o.cr += x.u.cr
    o.cost += costOf(x.model, x.u); o.msgs++
    const cc = comps(x.model, x.u)
    for (const k of Object.keys(cc)) o.c[k] += cc[k]
    const fm = famOf(x.model)
    o.fam[fm] = (o.fam[fm] || 0) + costOf(x.model, x.u)
  }
  // active intervals
  stamps.sort((a, b) => a - b)
  const iv = []
  let s = stamps[0], p = stamps[0]
  for (let i = 1; i < stamps.length; i++) {
    if (stamps[i] - p > GAP) { if (p > s) iv.push([s, p]); s = stamps[i] }
    p = stamps[i]
  }
  if (stamps.length && p > s) iv.push([s, p])
  // rereads: price a result of T tokens as one cache write plus a cache read on each later turn
  const total = turn
  const seen = new Map()
  const rr = {}
  for (const r of reads) {
    const k = r.path
      .replaceAll('\\', '/')
      .replace(/^(.*\/GitHub\/[^/]+\/)\.claude\/worktrees\/[^/]+\//, '$1')
      .replace(/^.*\/GitHub\//, '')
    const n = (seen.get(k) || 0) + 1
    seen.set(k, n)
    const tok = (sizes.get(r.id) || 0) / 3.5
    const [pi] = price(r.model)
    const cost = (tok * pi * 1.25 + tok * pi * 0.1 * Math.max(0, total - r.turn)) / 1e6
    const d = Number.isNaN(r.ts) ? '' : dayOf(r.ts)
    const o = ((rr[k] ||= {})[d] ||= { n: 0, r: 0, tok: 0, cost: 0 })
    o.n++
    if (n > 1) { o.r++; o.tok += tok; o.cost += cost }
  }
  // per agent type and model family, per day: what it spent, how long it worked, what it wrote
  let type = 'main'
  if (isAgent) {
    type = 'agent'
    try { type = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).agentType || 'agent' } catch {}
    type = type.replace(/^.*:/, '')
  }
  const ag = {}
  const bucket = (fam, day) => {
    const k = `${type}|${fam}`
    return ((ag[k] ||= {})[day] ||= { runs: 0, cost: 0, tok: 0, out: 0, msgs: 0, tools: 0, edits: 0, lw: 0, ld: 0, ms: 0, ...ZERO_ACT() })
  }
  const famCost = {}
  let first = null
  for (const x of msgs.values()) {
    if (Number.isNaN(x.ts)) continue
    const fm = famOf(x.model), day = dayOf(x.ts), c = costOf(x.model, x.u)
    const b = bucket(fm, day)
    b.cost += c; b.msgs++; b.out += x.u.out; b.tok += x.u.in + x.u.out + x.u.cw + x.u.cr
    famCost[fm] = (famCost[fm] || 0) + c
    if (!first || x.ts < first.ts) first = { ts: x.ts, fm, day }
  }
  for (const t of tools.values()) {
    if (Number.isNaN(t.ts)) continue
    const b = bucket(famOf(t.model), dayOf(t.ts))
    b.tools++
    if (t.edit) { b.edits++; b.lw += t.w; b.ld += t.d }
  }
  if (first) bucket(first.fm, first.day).runs++
  const dom = Object.keys(famCost).sort((a, b) => famCost[b] - famCost[a])[0]
  if (dom) {
    for (const [a, z] of iv) {
      let t0 = a
      while (t0 < z) {
        const end = new Date(t0); end.setHours(24, 0, 0, 0)
        const e2 = Math.min(z, end.getTime())
        bucket(dom, dayOf(t0)).ms += e2 - t0
        t0 = e2
      }
    }
  }
  if (dom) for (const [day, a] of Object.entries(actByDay)) for (const c of Object.keys(a)) bucket(dom, day)[c] += a[c]
  const rkTop = Object.fromEntries(
    Object.entries(rk)
      .map(([k, per]) => [k, per, Object.values(per).reduce((t, o) => t + o.ms + o.n * 1000, 0)])
      .sort((a, b) => b[2] - a[2]).slice(0, 150).map(([k, per]) => [k, per]),
  )
  return { agent: isAgent, byDay, iv, reads: rr, cwds: [...cwds], ag, rk: rkTop, rkb: dom ? `${type}|${dom}` : null }
}

let cache = { v: VER, files: {} }
try {
  const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  if (c.v === VER) cache = c
} catch {}

const files = []
walk(ROOT, files)
const cutoff = Date.now() - (DAYS + 2) * 86400e3
const live = {}
let scanned = 0
for (const f of files) {
  let st
  try { st = fs.statSync(f) } catch { continue }
  if (st.mtimeMs < cutoff) continue
  const key = f
  const hit = cache.files[key]
  if (hit && hit.m === st.mtimeMs && hit.s === st.size) { live[key] = hit; continue }
  try {
    live[key] = { m: st.mtimeMs, s: st.size, d: summarize(f, /[\\/]subagents[\\/]/.test(f)) }
    scanned++
  } catch {}
}
cache.files = live
try { fs.writeFileSync(CACHE, JSON.stringify(cache)) } catch {}

// ---- merge
const days = {}
const dayRow = d => (days[d] ||= { day: d, in: 0, out: 0, cw: 0, cr: 0, cost: 0, add: 0, del: 0, iv: [], agentCost: 0, msgs: 0, c: { in: 0, out: 0, cw: 0, cr: 0 }, fam: {} })
const cwds = new Set()
const agents = {}
const repAll = {} // key -> {byDay, files}
const repBy = {} // bucket -> key -> {day -> {n, ms}}
const rereads = {}
for (const { d } of Object.values(live)) {
  for (const [day, o] of Object.entries(d.byDay)) {
    const r = dayRow(day)
    r.in += o.in; r.out += o.out; r.cw += o.cw; r.cr += o.cr; r.cost += o.cost
    if (d.agent) r.agentCost += o.cost
    r.msgs += o.msgs
    for (const k of Object.keys(o.c)) r.c[k] += o.c[k]
    for (const [fm, c] of Object.entries(o.fam)) r.fam[fm] = (r.fam[fm] || 0) + c
  }
  for (const [a, b] of d.iv) {
    // split an interval at midnight so each day gets its share
    let s = a
    while (s < b) {
      const day = dayOf(s)
      const end = new Date(s); end.setHours(24, 0, 0, 0)
      const e = Math.min(b, end.getTime())
      dayRow(day).iv.push([s, e])
      s = e
    }
  }
  for (const c of d.cwds) cwds.add(c)
  for (const [key, per] of Object.entries(d.rk || {})) {
    const g = (repAll[key] ||= { byDay: {}, files: 0 })
    g.files++
    for (const [day, o] of Object.entries(per)) {
      const x = (g.byDay[day] ||= { n: 0, ms: 0 })
      x.n += o.n; x.ms += o.ms
      if (d.rkb) {
        const y = (((repBy[d.rkb] ||= {})[key] ||= {})[day] ||= { n: 0, ms: 0 })
        y.n += o.n; y.ms += o.ms
      }
    }
  }
  for (const [k, per] of Object.entries(d.ag || {})) {
    for (const [day, o] of Object.entries(per)) {
      const a = ((agents[k] ||= {})[day] ||= { runs: 0, cost: 0, tok: 0, out: 0, msgs: 0, tools: 0, edits: 0, lw: 0, ld: 0, ms: 0, ...ZERO_ACT() })
      for (const f of Object.keys(a)) a[f] += o[f]
    }
  }
  for (const [p, per] of Object.entries(d.reads)) {
    for (const [day, o] of Object.entries(per)) {
      const x = (rereads[p] ||= { path: p, reads: 0, rereads: 0, cost: 0, tok: 0, byDay: {} })
      x.byDay[day] = (x.byDay[day] || 0) + o.cost
      x.reads += o.n; x.rereads += o.r; x.cost += o.cost; x.tok += o.tok
    }
  }
}

// ---- git: lines added/deleted per commit day, every repo a session ran in
const tops = new Set()
for (const c of cwds) {
  if (!fs.existsSync(c)) continue
  try {
    tops.add(execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: c, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() && c)
  } catch {}
}
const hashes = new Set()
const repos = new Map()
for (const c of tops) {
  try {
    const common = path.resolve(c, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: c, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
    if (!repos.has(common)) repos.set(common, c)
  } catch {}
}
for (const c of repos.values()) {
  try {
    const out = execFileSync('git', ['log', '--all', '--no-merges', `--since=${DAYS + 2}.days`, '--date=format-local:%Y-%m-%d', '--pretty=format:@%H %ad', '--numstat'], { cwd: c, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] })
    let day = null
    for (const l of out.split('\n')) {
      if (l[0] === '@') {
        const [h, d] = l.slice(1).split(' ')
        day = hashes.has(h) ? null : d
        hashes.add(h)
      } else if (day && l) {
        const [a, b] = l.split('\t')
        if (a === '-' || b === '-') continue
        const na = +a, nb = +b
        if (na + nb > 3000) continue // generated or vendored: not typing
        const r = dayRow(day)
        r.add += na; r.del += nb
      }
    }
  } catch {}
}

// ---- today's uncommitted work: counted as an estimate until it is committed
let pendAdd = 0, pendDel = 0
{
  const seen = new Set()
  for (const c of tops) {
    try {
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: c, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (seen.has(top)) continue
      seen.add(top)
      const o = execFileSync('git', ['diff', 'HEAD', '--numstat'], { cwd: top, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })
      for (const l of o.split('\n')) {
        const [a, b] = l.split('\t')
        if (!l || a === '-' || b === '-') continue
        if (+a + +b > 3000) continue
        pendAdd += +a; pendDel += +b
      }
    } catch {}
  }
}

// ---- report
const union = iv => {
  iv.sort((x, y) => x[0] - y[0])
  let t = 0, cs = null, ce = null
  for (const [a, b] of iv) {
    if (cs === null) { cs = a; ce = b }
    else if (a <= ce) ce = Math.max(ce, b)
    else { t += ce - cs; cs = a; ce = b }
  }
  if (cs !== null) t += ce - cs
  return t / 60000
}
const out = []
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(); d.setDate(d.getDate() - i)
  const k = dayOf(d.getTime())
  const r = days[k] || dayRow(k)
  const tok = r.in + r.out + r.cw + r.cr
  const min = union(r.iv)
  const pend = i === 0 ? pendAdd + pendDel : 0
  const add = r.add + (i === 0 ? pendAdd : 0), del = r.del + (i === 0 ? pendDel : 0)
  const lines = add + del
  out.push({ day: k, tok, out: r.out, cost: r.cost, min, add, del, lines, eff: 0, est: pend > 0, pend, agentShare: r.cost ? r.agentCost / r.cost : 0 })
}
// efficiency: geometric mean of lines per dollar and lines per hour
const eff = (lines, cost, min) => (lines > 0 && cost > 0 && min > 0 ? Math.sqrt((lines / cost) * (lines / (min / 60))) : 0)
for (const r of out) r.eff = eff(r.lines, r.cost, r.min)
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0)
const win = a => ({ cost: sum(a, x => x.cost), tok: sum(a, x => x.tok), min: sum(a, x => x.min), lines: sum(a, x => x.lines) })
const w = win(out.slice(-7))
// 100 = the median active day of the last 30
const nz = out.map(x => x.eff).filter(x => x > 0).sort((a, b) => a - b)
const base = nz.length ? nz[Math.floor(nz.length / 2)] : 1
for (const r of out) r.eff = (r.eff / base) * 100
const raw = x => (x.lines > 0 && x.cost > 0 && x.min > 0 ? Math.sqrt((x.lines / x.cost) * (x.lines / (x.min / 60))) : 0)
// trend: last 3 active days against the active days before them (up to 7)
const act = out.filter(x => x.cost > 0 && x.lines > 0)
let trend = null
if (act.length >= 2) {
  const cut = Math.min(3, Math.ceil(act.length / 2))
  const rec = win(act.slice(-cut)), bef = win(act.slice(-cut - 7, -cut))
  const a = raw(rec), b = raw(bef)
  if (a > 0 && b > 0) trend = { pct: (a / b - 1) * 100, recent: cut, before: Math.min(7, act.length - cut) }
}
const week = { ...w, eff: (raw(w) / base) * 100, trend, est: out[out.length - 1].est, pend: out[out.length - 1].pend }
// re-reads over the last 7 days
const recent = new Set(out.slice(-7).map(x => x.day))
const top = Object.values(rereads)
  .map(x => {
    let cost = 0
    for (const [d, c] of Object.entries(x.byDay)) if (recent.has(d)) cost += c
    return { path: x.path, reads: x.reads, rereads: x.rereads, cost, tok: Math.round(x.tok) }
  })
  .filter(x => x.rereads > 0 && x.cost > 0)
  .sort((a, b) => b.cost - a.cost)
  .slice(0, 8)
let rereadAll = 0
for (const x of Object.values(rereads)) for (const [d, c] of Object.entries(x.byDay)) if (recent.has(d)) rereadAll += c
const last7 = out.slice(-7).map(x => days[x.day])
const mix = { in: 0, out: 0, cw: 0, cr: 0, agent: 0, msgs: 0, crTok: 0, fam: {} }
for (const r of last7) {
  for (const k of ['in', 'out', 'cw', 'cr']) mix[k] += r.c[k]
  mix.agent += r.agentCost; mix.msgs += r.msgs; mix.crTok += r.cr
  for (const [fm, c] of Object.entries(r.fam)) mix.fam[fm] = (mix.fam[fm] || 0) + c
}
const tot = mix.in + mix.out + mix.cw + mix.cr || 1
const ctxAvg = mix.msgs ? mix.crTok / mix.msgs : 0
const rep7 = {}
for (const [key, g] of Object.entries(repAll)) {
  let n = 0, ms = 0
  for (const [day, o] of Object.entries(g.byDay)) if (recent.has(day)) { n += o.n; ms += o.ms }
  if (n >= 3) rep7[key] = { key, n, ms, files: g.files }
}
const repeated = Object.values(rep7).sort((a, b) => b.ms - a.ms || b.n - a.n).slice(0, 8).map(x => ({ key: x.key, n: x.n, min: x.ms / 60000, files: x.files }))
const agentRows = []
for (const [k, per] of Object.entries(agents)) {
  const [type, fam] = k.split('|')
  const row = { type, fam, runs: 0, cost: 0, tok: 0, out: 0, msgs: 0, tools: 0, edits: 0, lw: 0, ld: 0, min: 0, act: ZERO_ACT(), repMin: 0 }
  for (const [day, o] of Object.entries(per)) {
    if (!recent.has(day)) continue
    for (const f of ['runs', 'cost', 'tok', 'out', 'msgs', 'tools', 'edits', 'lw', 'ld']) row[f] += o[f]
    row.min += o.ms / 60000
    for (const c of Object.keys(row.act)) row.act[c] += o[c] / 60000
  }
  for (const [key, per] of Object.entries(repBy[k] || {})) {
    if (!rep7[key]) continue
    for (const [day, o] of Object.entries(per)) if (recent.has(day)) row.repMin += o.ms / 60000
  }
  if (row.msgs > 0) agentRows.push(row)
}
agentRows.sort((a, b) => b.cost - a.cost)
const tips = []
if (top[0] && rereadAll > 0.03 * tot) {
  const f = top[0]
  tips.push({ kind: 'reread', save: rereadAll * 0.7, title: `Stop re-reading ${f.path.split('/').pop()}`,
    why: `${f.rereads} re-reads in 7 days. Every Read puts thousands of tokens back in the context and you pay for them again on each later turn. Grep or use a symbol index first, then Read with offset/limit on the stretch you need.` })
}
if (ctxAvg > 120000 && mix.cr / tot > 0.4) {
  tips.push({ kind: 'context', save: mix.cr * (1 - 90000 / ctxAvg) * 0.8, title: 'Keep sessions shorter',
    why: `The average context is ${Math.round(ctxAvg / 1000)}k tokens and cache reads are ${Math.round((mix.cr / tot) * 100)}% of the cost: every turn re-reads all of it. A /compact or a fresh task at ~100k cuts it almost in proportion.` })
}
const opus = (mix.fam.opus || 0) + (mix.fam.fable || 0)
if (opus / tot > 0.55) {
  tips.push({ kind: 'model', save: (mix.fam.opus || 0) * 0.3 * 0.4 + (mix.fam.fable || 0) * 0.3 * 0.8, title: 'Give cheaper models more of the work',
    why: `Opus/Fable are ${Math.round((opus / tot) * 100)}% of the spend. Sonnet costs about 40% less: if a third of the work (typos, renames, docs already decided) moves to a Sonnet subagent, the code is the same but the bill is not.` })
}
if (mix.cw / tot > 0.25) {
  tips.push({ kind: 'cachewrite', save: mix.cw * 0.25, title: 'Avoid invalidating the cache',
    why: `Cache writes are ${Math.round((mix.cw / tot) * 100)}% of the cost. Pauses over 5 minutes, model switches mid-session and edits to CLAUDE.md make you pay for the whole context again.` })
}
if (mix.out / tot > 0.25) {
  tips.push({ kind: 'output', save: mix.out * 0.2, title: 'Shorter answers and thinking',
    why: `Output is ${Math.round((mix.out / tot) * 100)}% of the cost and each token weighs 5 times an input token. Lower effort on simple tasks and "diff only" instructions reduce it.` })
}
{
  const fam = {}
  for (const r of agentRows) if (r.type !== 'main') { const f = (fam[r.fam] ||= { cost: 0, lw: 0 }); f.cost += r.cost; f.lw += r.lw }
  const rate = f => (fam[f] && fam[f].cost > 1 && fam[f].lw > 0 ? fam[f].lw / fam[f].cost : 0)
  const ro = rate('opus'), rs = rate('sonnet')
  if (ro > 0 && rs > 1.5 * ro) {
    tips.push({ kind: 'agentyield', save: fam.opus.cost * 0.3 * 0.4, title: 'Sonnet subagents write more per dollar',
      why: `Sonnet subagents wrote ${Math.round(rs)} lines per $ against ${Math.round(ro)} for Opus ones this week. Route mechanical edits and tests to them.` })
  }
}
{
  const by = t => { const rows = agentRows.filter(r => r.type === t); return { cost: sum(rows, r => r.cost), runs: sum(rows, r => r.runs) } }
  const dp = by('deep'), st = by('standard')
  const dAvg = dp.runs ? dp.cost / dp.runs : 0
  const sAvg = st.runs ? st.cost / st.runs : 0
  if (dp.runs >= 2 && dp.cost > 0.1 * (w.cost || 1) && (sAvg === 0 ? dAvg > 10 : dAvg > 2 * sAvg)) {
    tips.push({ kind: 'deepscope', save: dp.cost * 0.4, title: 'Scope deep runs to a short brief',
      why: `${dp.runs} deep runs cost ${usd(dp.cost)} (${usd(dAvg)} each${sAvg ? ` against ${usd(sAvg)} for standard` : ''}). Have an Explore or light agent find files, line ranges and symbols first, then hand deep that note only: a small context at xhigh costs a fraction.` })
  }
}
{
  const r = repeated.find(x => !x.key.startsWith('Read ') && x.min >= 2)
  if (r) {
    const share = r.min / (w.min || 1)
    const [tool, ...rest] = r.key.split(' ')
    tips.push({ kind: 'repeat', save: share * w.cost * 0.5, title: `Repeated task: ${tool === 'Agent' ? 'subagent' : tool} ${rest.join(' ').trim()}`.slice(0, 70),
      why: `${r.n} times in 7 days across ${r.files} sessions, ${Math.round(r.min)} min of waiting. Turn it into a script or a skill, narrow it to what changed, or reuse the result instead of running it again.` })
  }
}
const idle = out.slice(-7).filter(x => x.cost > 0 && x.lines === 0)
if (idle.length && sum(idle, x => x.cost) > 0.15 * (w.cost || 1)) {
  tips.push({ kind: 'idle', save: sum(idle, x => x.cost) * 0.3, title: 'Spend with no lines in git',
    why: `${idle.length} days with spend and no commit (${usd(sum(idle, x => x.cost))}). Fine if it was research; if it was trial and error, a written plan first or an Explore subagent costs less.` })
}
function usd(n) { return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}` }
tips.sort((a, b) => b.save - a.save)
const mixOut = { in: mix.in, out: mix.out, cw: mix.cw, cr: mix.cr, agent: mix.agent, ctxAvg, fam: mix.fam, rereadAll }
const final = JSON.stringify({ at: Date.now(), days: out, rereads: top, week, scanned, mix: mixOut, tips: tips.slice(0, 4), agents: agentRows.slice(0, 10), repeated })
// other tools can read the last report from this file
try { fs.writeFileSync(path.join(HOME, '.claude', 'crab-ledger-report.json'), final) } catch {}
console.log(final)

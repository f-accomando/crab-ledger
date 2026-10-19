import type { Op, OpState, Team } from '../types'
import { GREEN, AMBER, RED, BLUE } from './draw'
import { CSS, crab } from './live'

// Operators of a shared repo: sync/operators.toml (the registry), the header block of sync/<ID>.md, and SYNC.md as the fallback.
export type { Op, OpState, Team }

export type Reg = { id: string; name: string; kind: string; file: string; ledger: string; branches: string[]; cost: string }
export const OPS_SILENT_MIN = 60

/** The ETA as an instant, when it is written as an ISO time. */
const etaMs = (eta: string): number | undefined => (/\dT\d/.test(eta) ? isoMs(eta) : undefined)

/** WORKING or WAITING and past the declared ETA, or (no ISO ETA) not updated for 60 minutes. The tag stays as declared; FREE and DONE are never overdue. */
export const isOverdue = (o: Op, now: number): boolean => {
  if (o.state !== 'WORKING' && o.state !== 'WAITING') return false
  const e = etaMs(o.eta)
  if (e !== undefined) return now > e
  return o.updated !== undefined && now - o.updated > OPS_SILENT_MIN * 60_000
}

const stateOf = (s: string): [OpState, string] => {
  const m = /^`?\s*(DONE|WORKING|WAITING|IDLE|FREE)\b\s*(.*?)`?$/.exec(s.trim())
  return m ? [m[1] as OpState, (m[2] ?? '').replace(/`+$/, '').trim()] : ['?', s.trim()]
}

/** A template placeholder such as `{supervisor}` is shown as plain text: `Supervisor`. */
export const plain = (s: string): string => {
  const m = /^\{\s*(.+?)\s*\}$/.exec(s.trim())
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1) : s
}

// The few TOML forms the registry uses: [[operator]] blocks of `key = "string"` and `key = ["a", "b"]`; # comments.
export const parseToml = (text: string): Reg[] => {
  const out: Record<string, string | string[]>[] = []
  let cur: Record<string, string | string[]> | null = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '').trim()
    if (!line) continue
    if (line === '[[operator]]') {
      cur = {}
      out.push(cur)
      continue
    }
    const m = /^([A-Za-z_]+)\s*=\s*(.+)$/.exec(line)
    if (!m || !cur) continue
    const v = m[2]!.trim()
    cur[m[1]!] = v.startsWith('[') ? [...v.matchAll(/"([^"]*)"/g)].map(x => x[1]!) : v.replace(/^"|"$/g, '')
  }
  return out
    .map(r => ({
      id: String(r.id ?? ''),
      name: plain(String(r.name ?? r.id ?? '')),
      kind: String(r.kind ?? 'ai'),
      file: String(r.file ?? ''),
      ledger: String(r.ledger ?? ''),
      branches: Array.isArray(r.branches) ? r.branches : [],
      cost: String(r.cost ?? 'none'),
    }))
    .filter(o => o.id)
}

// "---\nkey: value\n---" at the top of the file.
export const parseBlock = (text: string): Record<string, string> | null => {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const o: Record<string, string> = {}
  for (const l of m[1]!.split(/\r?\n/)) {
    const k = /^([A-Za-z_]+):\s*(.*?)\s*(?:#.*)?$/.exec(l)
    if (k) o[k[1]!] = k[2]!
  }
  return o
}

// ISO 8601 with a zone is compared as an instant (UTC); a time without a zone is read as the local time of this machine.
export const isoMs = (s: string): number | undefined => {
  const t = s.trim()
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t) && /\d{4}-\d{2}-\d{2}T/.test(t)) {
    const v = Date.parse(t)
    return Number.isNaN(v) ? undefined : v
  }
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(t)
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!).getTime() : undefined
}

type FileInfo = { source: 'block' | 'text'; state: OpState; task: string; waitingOn: string; progress?: number; eta: string; updated?: number; wakeup?: 'yes' | 'no'; ack?: number }
export const parseFile = (text: string): FileInfo | null => {
  const b = parseBlock(text)
  if (b && b.state) {
    const [state] = stateOf(b.state)
    const pr = Number(b.progress)
    return {
      source: 'block',
      state,
      task: b.task ?? '',
      waitingOn: b.waiting_on ?? '',
      progress: b.progress && Number.isFinite(pr) ? Math.max(0, Math.min(100, pr)) : undefined,
      eta: b.eta ?? '',
      updated: b.updated ? isoMs(b.updated) : undefined,
      wakeup: b.wakeup === 'yes' || b.wakeup === 'no' ? b.wakeup : undefined,
      ack: b.ack ? isoMs(b.ack) : undefined,
    }
  }
  const up = /^\**Ultimo aggiornamento:?\**:?\s*([^\n]+)/m.exec(text)
  const st = /^\**Stato:?\**:?\s*([^\n]+)/m.exec(text)
  if (!up && !st) return null
  const [state, task] = st ? stateOf(st[1]!) : (['?', ''] as [OpState, string])
  return { source: 'text', state, task, waitingOn: '', eta: '', updated: up ? isoMs(up[1]!) : undefined }
}

/** The Log of SYNC.md: one row per line `| time | who | ... |`, the time as ISO 8601 (a date with no time is skipped). */
export const logRows = (sync: string): { at: number; by: string }[] => {
  const out: { at: number; by: string }[] = []
  for (const l of sync.split('\n')) {
    const c = l.split('|').map(x => x.trim())
    if (c.length < 6 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(c[1] ?? '')) continue
    const at = isoMs(c[1]!)
    if (at !== undefined) out.push({ at, by: c[2] ?? '' })
  }
  return out
}

// Repos without a registry: the names of the table rows are mapped to the files by hand.
const NAME_FILE: Record<string, string> = { 'claude local': 'SPV', 'claude cloud': 'CLD', antigravity: 'AGY' }

export const parseOps = (sync: string, files: Record<string, string>, now: number, reg?: Reg[]): { ops: Op[]; chain: string } => {
  const rows = new Map<string, { state: OpState; task: string; detail: string; eta: string }>()
  for (const line of sync.split('\n')) {
    const c = line.split('|').map(x => x.trim())
    if (c.length < 6 || !/^\*\*.+\*\*$/.test(c[1] ?? '')) continue
    const [state, task] = stateOf(c[2] ?? '')
    rows.set(c[1]!.replace(/\*/g, '').toLowerCase(), { state, task, detail: (c[3] ?? '').replace(/`/g, ''), eta: c[4] ?? '' })
  }
  const log = logRows(sync)
  const list: { id?: string; name: string }[] = reg?.length
    ? reg.filter(r => r.kind !== 'human').map(r => ({ id: r.id, name: r.name }))
    : [...rows.keys()].filter(n => n !== 'utente').map(n => ({ id: NAME_FILE[n], name: n.replace(/\b\w/g, ch => ch.toUpperCase()) }))
  const ops: Op[] = list.map(({ id, name }) => {
    const row = rows.get(name.toLowerCase())
    const fi = id && files[id] ? parseFile(files[id]!) : null
    const op: Op = { id, name, state: row?.state ?? '?', task: row?.task ?? '', detail: row?.detail ?? '', eta: row?.eta ?? '', source: 'table', overdue: false, clash: false }
    if (fi) {
      op.updated = fi.updated
      op.fileState = fi.state
      op.fileTask = fi.task
      if (fi.source === 'block') {
        Object.assign(op, { source: 'block', state: fi.state, task: fi.task, waitingOn: fi.waitingOn || undefined, progress: fi.progress, eta: fi.eta || op.eta, detail: '', wakeup: fi.wakeup, ack: fi.ack })
        if (fi.ack !== undefined && id) op.unread = log.filter(r => r.by.toLowerCase() !== id.toLowerCase() && r.at > fi.ack!).length
      } else {
        op.source = 'text'
        op.clash = !!row && fi.state !== row.state && !(fi.state === 'FREE' && row.state === 'DONE')
        if (!row) Object.assign(op, { state: fi.state, task: fi.task })
      }
      op.overdue = isOverdue(op, now)
    }
    return op
  })
  const chain = /Catena[^\n]*/.exec(sync)?.[0] ?? ''
  return { ops, chain }
}

// --- the look of each operator: a costume and an accent color, drawn from the id so it is stable but not generic

export const LOOKS = ['planner', 'coder', 'research', 'mechanic', 'light', 'deep']
export const ACCENTS = ['#D97757', '#9B7BD6', '#3FA7A0', '#E0A030', '#5B8DEF', '#D0658F', '#7FA34A', '#C2693F']
export type Look = { costume: string; color: string }
const hash = (s: string) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}
/** A costume and an accent for every id: pseudo-random from the id, moved on to the next free one when two would look the same. */
export const looksOf = (ids: string[]): Record<string, Look> => {
  const usedC = new Set<number>()
  const usedA = new Set<number>()
  const pick = (start: number, n: number, used: Set<number>) => {
    let i = start % n
    while (used.has(i) && used.size < n) i = (i + 1) % n
    used.add(i)
    return i
  }
  const out: Record<string, Look> = {}
  for (const id of ids) {
    const h = hash(id)
    out[id] = { costume: LOOKS[pick(h, LOOKS.length, usedC)]!, color: ACCENTS[pick(h >>> 8, ACCENTS.length, usedA)]! }
  }
  return out
}

// --- Operators day by day

export const OP_COLORS = ['#D97757', '#9B7BD6', '#3FA7A0', '#E0A030', '#5B8DEF']
export const WRITER_LINES = 200
const WORK_CAP_MIN = OPS_SILENT_MIN

/** A glob of the registry (`feat/antigravity-*`) as a regexp over a ref name. */
export const globRe = (g: string) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)

const localDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export { localDay }

/** Minutes in state WORKING per local day, from the versions of an operator's file (oldest first); one stretch counts at most the silence limit. */
export const workMinutes = (versions: { at: number; state: OpState }[], now: number): Record<string, number> => {
  const out: Record<string, number> = {}
  versions.forEach((v, i) => {
    if (v.state !== 'WORKING') return
    let t = v.at
    const end = Math.min(versions[i + 1]?.at ?? now, v.at + WORK_CAP_MIN * 60_000)
    while (t < end) {
      const d = new Date(t)
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
      const to = Math.min(end, midnight)
      const k = localDay(t)
      out[k] = (out[k] ?? 0) + (to - t) / 60_000
      t = to
    }
  })
  return out
}

/** One row of an operator's ledger. Schema 1 (a closed work order: wo, iso, tokens, min, lines, add, del) or the older task row (t: task, status: done, at). */
export type LedgerRow = { day: string; tok: number; min: number; lw: number; add: number; del: number; wo: boolean }
export const ledgerRows = (jsonl: string): LedgerRow[] => {
  const out: LedgerRow[] = []
  for (const l of jsonl.split(/\r?\n/)) {
    try {
      const j = JSON.parse(l)
      if (j.wo && j.iso && !Number.isNaN(Date.parse(j.iso))) {
        const k = j.lines ?? {}
        const lw = k.code !== undefined || k.docs !== undefined || k.data !== undefined ? (k.code ?? 0) + 0.3 * (k.docs ?? 0) + 0.15 * (k.data ?? 0) : (j.add ?? 0) + (j.del ?? 0)
        out.push({ day: localDay(Date.parse(j.iso)), tok: +j.tokens || 0, min: +j.min || 0, lw, add: +j.add || 0, del: +j.del || 0, wo: true })
      } else if (j.t === 'task' && j.status === 'done' && j.at) out.push({ day: localDay(Date.parse(j.at)), tok: 0, min: 0, lw: 0, add: 0, del: 0, wo: false })
    } catch {
      /* a broken line is skipped */
    }
  }
  return out
}

const isWriter = (t: Team, id: string, d: string) => {
  const l = t.lines[`${d}|${id}`] ?? [0, 0]
  return l[0] + l[1] >= WRITER_LINES
}
// Writers: lines per working hour. The others: tasks closed per working hour. 100 = the median of the operator's own days of that kind (3 days at least); a day counts after 60 working minutes.
const rate = (t: Team, id: string, d: string, w: boolean) => {
  const m = t.work[`${d}|${id}`] ?? 0
  if (m < 60 || isWriter(t, id, d) !== w) return 0
  const l = t.lines[`${d}|${id}`] ?? [0, 0]
  return (w ? l[0] + l[1] : (t.tasks[`${d}|${id}`] ?? 0)) / (m / 60)
}
export const effOf = (t: Team, id: string, d: string): number => {
  const w = isWriter(t, id, d)
  const all = t.all.map(x => rate(t, id, x, w)).filter(x => x > 0).sort((a, b) => a - b)
  if (all.length < 3) return 0 // a baseline needs at least 3 tracked days of that kind
  const med = all.length ? ((all[Math.floor((all.length - 1) / 2)] ?? 0) + (all[Math.floor(all.length / 2)] ?? 0)) / 2 : 0
  const r = rate(t, id, d, w)
  return r > 0 && med > 0 ? Math.round((r / med) * 100) : 0
}

const kk = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
export const TEAM_RH = 30
export const teamHeight = (t: Team) => 10 + t.days.length * TEAM_RH
export const teamSvg = (W: number, t: Team, looks: Record<string, Look> = {}): string => {
  const BX = 46
  const BW = W - BX - 6
  const rows = t.days
    .map((d, i) => {
      const y = 6 + i * TEAM_RH
      const per = t.ops.map(o => t.lines[`${d}|${o.id}`] ?? [0, 0])
      const total = per.reduce((s, [a, b]) => s + a + b, 0)
      const [, mo, da] = d.split('-')
      let x = BX
      const segs = per
        .map(([a, b], j) => {
          const w = ((a + b) / (total || 1)) * BW
          const r = `<rect x="${x}" y="${y}" width="${w}" height="13" fill="${looks[t.ops[j]!.id]?.color ?? OP_COLORS[j % OP_COLORS.length]}"/>`
          x += w
          return r
        })
        .join('')
      const list = t.ops
        .map((o, j) => {
          const c = looks[o.id]?.color ?? OP_COLORS[j % OP_COLORS.length]
          const id = o.id.toLowerCase()
          const [a, b] = per[j] ?? [0, 0]
          if (!(t.work[`${d}|${o.id}`] ?? 0) && a + b === 0) return `<tspan fill="${c}">${id}</tspan> –`
          const e = effOf(t, o.id, d)
          const eff = e > 0 ? e : '–'
          const lg = t.led[`${d}|${o.id}`]
          const lpm = lg && lg.tok > 0 && lg.lw > 0 ? ` ${kk(Math.round(lg.lw / (lg.tok / 1e6)))} l/Mtok` : ''
          return isWriter(t, o.id, d)
            ? `<tspan fill="${c}">${id}</tspan> +${kk(a)}/−${b} eff ${eff}${lpm}`
            : `<tspan fill="${c}">${id}</tspan> <tspan fill="${BLUE}">eff ${eff}${lpm}</tspan>`
        })
        .join(' · ')
      return `<text class="s" x="6" y="${y + 11}" font-size="11">${da}/${mo}</text><rect class="k" x="${BX}" y="${y}" width="${BW}" height="13" rx="6.5"/><clipPath id="tm${i}"><rect x="${BX}" y="${y}" width="${BW}" height="13" rx="6.5"/></clipPath><g clip-path="url(#tm${i})">${segs}</g><text class="m" x="${BX}" y="${y + 26}" font-size="10">${list} · ${kk(total)} lines</text>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${teamHeight(t)}" viewBox="0 0 ${W} ${teamHeight(t)}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${CSS}${rows}</svg>`
}

// --- the operator cards

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
const COSTUME: Record<string, string> = { spv: 'planner', 'claude local': 'planner', cld: 'research', 'claude cloud': 'research', agy: 'mechanic', antigravity: 'mechanic' }
export const stateColor = (o: Op) =>
  o.overdue ? RED : o.state === 'DONE' ? GREEN : o.state === 'WORKING' ? BLUE : o.state === 'WAITING' ? AMBER : o.state === 'IDLE' ? RED : o.state === 'FREE' ? '#4FB0A8' : '#8E929A'
export const ago = (ms: number) => (ms < 90_000 ? 'now' : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min ago` : `${(ms / 3_600_000).toFixed(1)} h ago`)
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
/** "2026-10-14T10:30+02:00" shows as the local clock time; the table's free text stays as written. */
const etaText = (eta: string) => {
  if (!eta || eta === '-') return ''
  const v = /\dT\d/.test(eta) ? isoMs(eta) : undefined
  return `ETA ${v !== undefined ? hhmm(v) : eta}`
}

export const OP_H = 92
export const opSvg = (W: number, o: Op, now: number, look?: Look): string => {
  const col = stateColor(o)
  const live = o.state === 'WORKING' && !o.overdue
  const age = o.updated !== undefined ? Math.max(0, now - o.updated) : undefined
  // the bar is the time left to the declared ETA (full at the last update, empty at the ETA); with no ISO ETA it is 60 minutes from the last update
  const eta = etaMs(o.eta)
  const span = eta !== undefined && o.updated !== undefined && eta > o.updated ? eta - o.updated : OPS_SILENT_MIN * 60_000
  const left = eta !== undefined ? eta - now : age === undefined ? 0 : span - age
  const fresh = age === undefined ? 0 : Math.max(0, Math.min(1, left / span))
  const freshCol = age === undefined ? '#8E929A' : left <= 0 ? RED : fresh > 0.25 ? GREEN : AMBER
  const X = 44
  const BW = W - X - 6
  // the tag is the declared state; being past the ETA shows in its color and in the warning
  const shown = o.state
  const sub = o.task ? o.task : o.detail
  const waits = o.state === 'WAITING' && o.waitingOn ? `waiting on ${o.waitingOn}` : ''
  const lines = [sub, waits || (o.clash || o.detail === sub ? '' : o.detail)].filter(Boolean)
  const warn = o.clash
    ? `table says ${o.state}, its own file says ${o.fileState}${o.fileTask ? ' ' + o.fileTask : ''}`
    : o.overdue
      ? etaMs(o.eta) !== undefined
        ? `${ago(now - etaMs(o.eta)!).replace(' ago', '')} past its ETA, no update`
        : `no update for ${ago(age ?? 0).replace(' ago', '')}`
      : ''
  // how it is reachable: does it wake itself up, and how much of the Log of SYNC.md has it read
  const read =
    o.source !== 'block' ? '' : o.ack === undefined ? '<tspan fill="#E0A030">never read</tspan>' : o.unread ? `<tspan fill="#E0A030">${o.unread} unread</tspan>` : '<tspan fill="#3B9C5F">read ✓</tspan>'
  const wake = o.wakeup ? `wakes itself: ${o.wakeup}` : ''
  const badges = o.source === 'block' ? `<text class="m" x="${X}" y="86" font-size="10">${[wake, read].filter(Boolean).join(' · ')}</text>` : ''
  const progress = o.progress !== undefined ? `${o.progress}% · ` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${OP_H}" viewBox="0 0 ${W} ${OP_H}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${CSS}
${crab(0, 16, look?.costume ?? COSTUME[(o.id ?? o.name).toLowerCase()] ?? COSTUME[o.name.toLowerCase()] ?? 'other', look?.color ?? col, live)}
<text class="t" x="${X}" y="17" font-size="13" font-weight="600">${xml(o.name)}</text>
<rect x="${X + 100}" y="6" width="${shown.length * 6.4 + 12}" height="16" rx="8" fill="${col}"/><text x="${X + 106}" y="17.5" font-size="10" font-weight="700" fill="#fff">${xml(shown)}</text>
<text class="s" x="${W - 6}" y="17" font-size="11" text-anchor="end">${xml(progress + etaText(o.eta))}</text>
<text class="t" x="${X}" y="33" font-size="11">${xml(fit(lines[0] ?? '', Math.floor(BW / 5.6)))}</text>
<text class="s" x="${X}" y="46" font-size="10.5">${xml(fit(lines[1] ?? '', Math.floor(BW / 5.4)))}</text>
<rect class="k" x="${X}" y="54" width="${BW}" height="5" rx="2.5"/>${age === undefined ? '' : `<rect x="${X}" y="54" width="${Math.max(3, fresh * BW)}" height="5" rx="2.5" fill="${freshCol}"/>`}
<text class="m" x="${X}" y="72" font-size="10">${age === undefined ? 'no file of its own: freshness not tracked' : `last update ${xml(hhmm(o.updated!))} · ${xml(ago(age))}`}${o.source === 'text' ? ' · old format' : ''}</text>
${badges}
${warn ? `<text x="${W - 6}" y="72" font-size="10" text-anchor="end" fill="${o.overdue ? RED : AMBER}">${xml(fit('⚠ ' + warn, Math.floor((BW - 120) / 5.3)))}</text>` : ''}
</svg>`
}

import type { Op, OpState, Team } from '../types'
import { GREEN, AMBER, RED, BLUE } from './draw'
import { CSS, crab } from './live'

// Operators of a shared repo: sync/operators.toml (the registry), the header block of sync/<ID>.md, and SYNC.md as the fallback.
export type { Op, OpState, Team }

export type Reg = { id: string; name: string; kind: string; file: string; ledger: string; branches: string[]; cost: string }
export const OPS_SILENT_MIN = 60

const stateOf = (s: string): [OpState, string] => {
  const m = /^`?\s*(DONE|WORKING|WAITING|IDLE|FREE)\b\s*(.*?)`?$/.exec(s.trim())
  return m ? [m[1] as OpState, (m[2] ?? '').replace(/`+$/, '').trim()] : ['?', s.trim()]
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
      name: String(r.name ?? r.id ?? ''),
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

type FileInfo = { source: 'block' | 'text'; state: OpState; task: string; waitingOn: string; progress?: number; eta: string; updated?: number }
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
    }
  }
  const up = /^\**Ultimo aggiornamento:?\**:?\s*([^\n]+)/m.exec(text)
  const st = /^\**Stato:?\**:?\s*([^\n]+)/m.exec(text)
  if (!up && !st) return null
  const [state, task] = st ? stateOf(st[1]!) : (['?', ''] as [OpState, string])
  return { source: 'text', state, task, waitingOn: '', eta: '', updated: up ? isoMs(up[1]!) : undefined }
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
  const list: { id?: string; name: string }[] = reg?.length
    ? reg.filter(r => r.kind !== 'human').map(r => ({ id: r.id, name: r.name }))
    : [...rows.keys()].filter(n => n !== 'utente').map(n => ({ id: NAME_FILE[n], name: n.replace(/\b\w/g, ch => ch.toUpperCase()) }))
  const ops: Op[] = list.map(({ id, name }) => {
    const row = rows.get(name.toLowerCase())
    const fi = id && files[id] ? parseFile(files[id]!) : null
    const op: Op = { id, name, state: row?.state ?? '?', task: row?.task ?? '', detail: row?.detail ?? '', eta: row?.eta ?? '', source: 'table', silent: false, clash: false }
    if (fi) {
      op.updated = fi.updated
      op.fileState = fi.state
      op.fileTask = fi.task
      if (fi.source === 'block') {
        Object.assign(op, { source: 'block', state: fi.state, task: fi.task, waitingOn: fi.waitingOn || undefined, progress: fi.progress, eta: fi.eta || op.eta, detail: '' })
      } else {
        op.source = 'text'
        op.clash = !!row && fi.state !== row.state && !(fi.state === 'FREE' && row.state === 'DONE')
        if (!row) Object.assign(op, { state: fi.state, task: fi.task })
      }
      op.silent = op.updated !== undefined && now - op.updated > OPS_SILENT_MIN * 60_000 && (op.state === 'WORKING' || fi.state === 'WORKING')
    }
    return op
  })
  const chain = /Catena[^\n]*/.exec(sync)?.[0] ?? ''
  return { ops, chain }
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
export const TEAM_RH = 34
export const teamHeight = (t: Team) => 10 + t.days.length * TEAM_RH
export const teamSvg = (W: number, t: Team): string => {
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
          const r = `<rect x="${x}" y="${y}" width="${w}" height="13" fill="${OP_COLORS[j % OP_COLORS.length]}"/>`
          x += w
          return r
        })
        .join('')
      const list = t.ops
        .map((o, j) => {
          const c = OP_COLORS[j % OP_COLORS.length]
          const id = o.id.toLowerCase()
          const [a, b] = per[j] ?? [0, 0]
          if (!(t.work[`${d}|${o.id}`] ?? 0) && a + b === 0) return `<tspan fill="${c}">${id}</tspan> –`
          const e = effOf(t, o.id, d)
          const eff = e > 0 ? e : '–'
          return isWriter(t, o.id, d)
            ? `<tspan fill="${c}">${id}</tspan> +${kk(a)}/−${b} eff ${eff}`
            : `<tspan fill="${c}">${id}</tspan> <tspan fill="${BLUE}">${t.tasks[`${d}|${o.id}`] ?? 0} tasks eff ${eff}</tspan>`
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
  o.silent ? RED : o.state === 'DONE' ? GREEN : o.state === 'WORKING' ? BLUE : o.state === 'WAITING' ? AMBER : o.state === 'IDLE' ? RED : o.state === 'FREE' ? '#4FB0A8' : '#8E929A'
export const ago = (ms: number) => (ms < 90_000 ? 'now' : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min ago` : `${(ms / 3_600_000).toFixed(1)} h ago`)
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
/** "2026-10-14T10:30+02:00" shows as the local clock time; the table's free text stays as written. */
const etaText = (eta: string) => {
  if (!eta || eta === '-') return ''
  const v = /\dT\d/.test(eta) ? isoMs(eta) : undefined
  return `ETA ${v !== undefined ? hhmm(v) : eta}`
}

export const OP_H = 80
export const opSvg = (W: number, o: Op, now: number): string => {
  const col = stateColor(o)
  const live = o.state === 'WORKING' && !o.silent
  const age = o.updated !== undefined ? Math.max(0, now - o.updated) : undefined
  const fresh = age === undefined ? 0 : Math.max(0, 1 - age / (OPS_SILENT_MIN * 60_000))
  const freshCol = age === undefined ? '#8E929A' : age < 15 * 60_000 ? GREEN : age < OPS_SILENT_MIN * 60_000 ? AMBER : RED
  const X = 44
  const BW = W - X - 6
  // the tag is one word; why it is IDLE or who it waits for goes in the lines around it
  const shown = o.silent ? 'IDLE' : o.state
  const sub = o.task ? o.task : o.detail
  const waits = o.state === 'WAITING' && o.waitingOn ? `waiting on ${o.waitingOn}` : ''
  const lines = [sub, waits || (o.silent || o.clash || o.detail === sub ? '' : o.detail)].filter(Boolean)
  const warn = o.clash
    ? `table says ${o.state}, its own file says ${o.fileState}${o.fileTask ? ' ' + o.fileTask : ''}`
    : o.silent
      ? `no update for ${ago(age ?? 0).replace(' ago', '')}: counts as IDLE (rule: ${OPS_SILENT_MIN} min)`
      : ''
  const progress = o.progress !== undefined ? `${o.progress}% · ` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${OP_H}" viewBox="0 0 ${W} ${OP_H}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${CSS}
${crab(0, 16, COSTUME[(o.id ?? o.name).toLowerCase()] ?? COSTUME[o.name.toLowerCase()] ?? 'other', col, live)}
<text class="t" x="${X}" y="17" font-size="13" font-weight="600">${xml(o.name)}</text>
<rect x="${X + 100}" y="6" width="${shown.length * 6.4 + 12}" height="16" rx="8" fill="${col}"/><text x="${X + 106}" y="17.5" font-size="10" font-weight="700" fill="#fff">${xml(shown)}</text>
<text class="s" x="${W - 6}" y="17" font-size="11" text-anchor="end">${xml(progress + etaText(o.eta))}</text>
<text class="t" x="${X}" y="33" font-size="11">${xml(fit(lines[0] ?? '', Math.floor(BW / 5.6)))}</text>
<text class="s" x="${X}" y="46" font-size="10.5">${xml(fit(lines[1] ?? '', Math.floor(BW / 5.4)))}</text>
<rect class="k" x="${X}" y="54" width="${BW}" height="5" rx="2.5"/>${age === undefined ? '' : `<rect x="${X}" y="54" width="${Math.max(3, fresh * BW)}" height="5" rx="2.5" fill="${freshCol}"/>`}
<text class="m" x="${X}" y="72" font-size="10">${age === undefined ? 'no file of its own: freshness not tracked' : `last update ${xml(hhmm(o.updated!))} · ${xml(ago(age))}`}${o.source === 'text' ? ' · old format' : ''}</text>
${warn ? `<text x="${W - 6}" y="72" font-size="10" text-anchor="end" fill="${o.silent ? RED : AMBER}">${xml(fit('⚠ ' + warn, Math.floor((BW - 120) / 5.3)))}</text>` : ''}
</svg>`
}

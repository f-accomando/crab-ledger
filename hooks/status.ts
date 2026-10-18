import type { Status, StArea } from '../types'
import { AMBER, BLUE, GREEN, RED, fit, textW, xml } from './draw'
import { CSS, crab } from './live'

// The sync status page (status.md): parsed into blocks, drawn as one SVG.
export type { Status }

const sections = (md: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  let cur = ''
  for (const raw of md.split(/\r?\n/)) {
    const m = /^##\s+(.*)$/.exec(raw)
    if (m) {
      cur = m[1]!.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase()
      out[cur] = []
      continue
    }
    if (!cur || raw.startsWith('```')) continue
    out[cur]!.push(raw)
  }
  return out
}

const area = (name: string, m: RegExpExecArray | null, o: number): StArea | null =>
  m ? { name, pct: +m[o]!, done: +m[o + 1]!, total: +m[o + 2]!, rev: +m[o + 3]!, asg: +m[o + 4]!, una: +m[o + 5]! } : null

export const parseStatus = (md: string): Status | null => {
  const sec = sections(md)
  if (!Object.keys(sec).length) return null
  const head = (sec.status ?? []).join(' ')
  const s: Status = {
    stamp: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(head)?.[1] ?? '',
    next: /next update (\S+)/.exec(head)?.[1] ?? '',
    meta: /\((.*)\)/.exec(head)?.[1] ?? '',
    ops: [],
    unassigned: [],
    awaiting: [],
    recent: [],
    legacy: [],
    requests: [],
    note: '',
    total: null,
    areas: [],
  }
  for (const l of sec.operators ?? []) {
    const m = /^(\S+)\s+(\S+)\s+age\s+(\S+)\s*(.*)$/.exec(l)
    if (m) {
      s.ops.push({ id: m[1]!, state: m[2]!, age: m[3]!, task: m[4]!.trim(), queue: [], review: [] })
      continue
    }
    const o = s.ops[s.ops.length - 1]
    if (!o) continue
    const q = /^\s+queue:\s*(.*)$/.exec(l)
    if (q) o.queue = q[1]!.split(',').map(x => x.trim()).filter(Boolean)
    const r = /^\s+awaiting review:\s*(.*)$/.exec(l)
    if (r) o.review = r[1]!.split(',').map(x => x.trim()).filter(Boolean).map(x => ({ wo: x.split(/\s+/)[0]!, sha: x.split(/\s+/)[1] ?? '' }))
  }
  s.unassigned = (sec['wos not assigned'] ?? []).join(' ').split(',').map(x => x.trim()).filter(Boolean)
  for (const l of sec.reviews ?? []) {
    if (l.startsWith('awaiting')) for (const m of l.matchAll(/(\S+) ([0-9a-f]{6,}) \(([^)]+)\)/g)) s.awaiting.push({ wo: m[1]!, sha: m[2]!, op: m[3]! })
    else if (l.startsWith('recent:')) for (const m of l.slice(7).matchAll(/(\d+ \d\d:\d\d) (\w+)\s+([^,]+)/g)) s.recent.push({ when: m[1]!, verdict: m[2]!, wo: m[3]!.trim() })
    else if (l.startsWith('legacy')) s.legacy = (l.split('): ')[1] ?? '').split(',').map(x => x.trim()).filter(Boolean)
  }
  s.requests = (sec['requests for the user'] ?? []).map(l => l.trim()).filter(Boolean)
  for (const l of sec['beta progress'] ?? []) {
    if (l.startsWith('Assumption')) s.note = l
    else if (l.startsWith('[')) s.total = area('Beta', /\]\s+(\d+)%\s+done (\d+) \/ (\d+)\s+review (\d+)\s+assigned (\d+)\s+unassigned (\d+)/.exec(l), 1)
    else {
      const m = /^(\S+)\s+\[[#-]+\]\s+(\d+)%\s+(\d+)\/(\d+)\s+rev (\d+) asg (\d+) una (\d+)/.exec(l)
      const a = area(m?.[1] ?? '', m, 2)
      if (a) s.areas.push(a)
    }
  }
  return s.stamp || s.ops.length || s.total ? s : null
}

/** minutes since the stamp of the page ("2026-10-18 11:15", local time); undefined when it cannot be read */
export const stampAge = (stamp: string, now: number): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(stamp)
  return m ? Math.max(0, Math.round((now - new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!).getTime()) / 60_000)) : undefined
}

/** "D09-1e" -> "D09", "W15b" -> "W" */
const groupOf = (wo: string) => (wo.includes('-') ? wo.split('-')[0]! : (/^[A-Za-z]+/.exec(wo)?.[0] ?? wo))

const STATE_COL: Record<string, string> = { WORKING: GREEN, WAITING: AMBER, DONE: '#8E929A', FREE: BLUE, IDLE: RED }

const wrap = (s: string, size: number, maxW: number): string[] => {
  const lines: string[] = []
  let cur = ''
  for (const w of s.split(/\s+/)) {
    if (cur && textW(`${cur} ${w}`, size) > maxW) {
      lines.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  return lines
}

type Chip = { t: string; col?: string }
// chips in rows that wrap at maxW; returns the markup and its height
const chips = (items: Chip[], x0: number, y: number, maxW: number): { svg: string; h: number } => {
  const size = 10.5
  let x = x0
  let row = 0
  let svg = ''
  for (const c of items) {
    const t = fit(c.t, size, maxW - 14)
    const w = textW(t, size) + 12
    if (x > x0 && x + w > x0 + maxW) {
      x = x0
      row++
    }
    const cy = y + row * 22
    svg += c.col
      ? `<rect x="${x}" y="${cy}" width="${w}" height="18" rx="9" fill="${c.col}" fill-opacity=".16"/><text x="${x + 6}" y="${cy + 12.5}" font-size="${size}" font-weight="600" fill="${c.col}">${xml(t)}</text>`
      : `<rect class="k" x="${x}" y="${cy}" width="${w}" height="18" rx="9"/><text class="t" x="${x + 6}" y="${cy + 12.5}" font-size="${size}">${xml(t)}</text>`
    x += w + 4
  }
  return { svg, h: items.length ? (row + 1) * 22 : 0 }
}

export type Look = { costume: string; color: string }

export const statusSvg = (W: number, s: Status, looks: Record<string, Look>, now: number): { svg: string; h: number } => {
  let y = 0
  let b = ''
  const title = (t: string, n?: number) => {
    b += `<text class="t" x="0" y="${y + 12}" font-size="13" font-weight="700">${xml(t)}${n !== undefined ? ` <tspan class="m" font-weight="400" font-size="11">${n}</tspan>` : ''}</text>`
    y += 22
  }
  const gap = () => (y += 14)

  // header: the whole Beta in one bar
  const t = s.total
  const age = stampAge(s.stamp, now)
  b += `<text class="t" x="0" y="30" font-size="30" font-weight="700">${t ? t.pct : '–'}<tspan font-size="15">%</tspan></text>`
  const BX = 76
  const BW = W - BX
  if (t && t.total > 0) {
    b += `<rect class="k" x="${BX}" y="8" width="${BW}" height="14" rx="7"/>`
    let x = BX
    for (const [n, col] of [[t.done, GREEN], [t.rev, BLUE], [t.asg, AMBER]] as const) {
      const w = (n / t.total) * BW
      if (w > 0) b += `<rect x="${x}" y="8" width="${w}" height="14" fill="${col}"/>`
      x += w
    }
    b += `<text class="s" x="${BX}" y="38" font-size="11"><tspan fill="${GREEN}">●</tspan> done ${t.done}/${t.total}  <tspan fill="${BLUE}">●</tspan> review ${t.rev}  <tspan fill="${AMBER}">●</tspan> assigned ${t.asg}  <tspan fill="#8E929A">●</tspan> open ${t.una}</text>`
  }
  const stale = age !== undefined && age > 35
  b += `<text class="m" x="0" y="58" font-size="10.5">${xml([s.stamp && `updated ${s.stamp.slice(11)}`, s.next && `next ${s.next}`, s.meta].filter(Boolean).join(' · '))}</text>`
  if (stale) b += `<text x="${W}" y="58" font-size="10.5" text-anchor="end" fill="${AMBER}">⚠ page is ${age! >= 90 ? `${(age! / 60).toFixed(1)}h` : `${age}m`} old</text>`
  y = 82

  // needs the user
  if (s.requests.length) {
    const lines = s.requests.flatMap(r => wrap(r, 11, W - 20))
    const h = 28 + lines.length * 15
    b += `<rect x="0" y="${y}" width="${W}" height="${h}" rx="8" fill="${AMBER}" fill-opacity=".12" stroke="${AMBER}" stroke-opacity=".6"/>`
    b += `<text x="10" y="${y + 17}" font-size="12" font-weight="700" fill="${AMBER}">Needs you · ${s.requests.length}</text>`
    s.requests.forEach((r, i) => {
      const before = s.requests.slice(0, i).flatMap(q => wrap(q, 11, W - 20)).length
      wrap(r, 11, W - 20).forEach((ln, j) => (b += `<text class="t" x="10" y="${y + 33 + (before + j) * 15}" font-size="11">${xml(ln)}</text>`))
    })
    y += h
    gap()
  }

  // operators
  if (s.ops.length) {
    title('Operators', s.ops.length)
    s.ops.forEach((o, i) => {
      const col = STATE_COL[o.state] ?? '#8E929A'
      const look = looks[o.id]
      const X = 48
      const running = o.state === 'WORKING'
      const top = y
      b += crab(0, top + 4, look?.costume ?? 'other', look?.color ?? col, running)
      b += `<text class="t" x="${X}" y="${top + 14}" font-size="13" font-weight="700">${xml(o.id)}</text>`
      const pw = o.state.length * 6.4 + 14
      b += `<rect x="${X + 44}" y="${top + 3}" width="${pw}" height="16" rx="8" fill="${col}"/><text x="${X + 51}" y="${top + 14.5}" font-size="10" font-weight="700" fill="#fff">${xml(o.state)}</text>`
      const ageMin = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(o.age)
      const stale = running && ageMin && (+(ageMin[1] ?? 0) * 60 + +(ageMin[2] ?? 0)) >= 60
      b += `<text x="${W}" y="${top + 14}" font-size="11" text-anchor="end" class="${stale ? '' : 's'}"${stale ? ` fill="${RED}"` : ''}>${xml(o.age)} ago</text>`
      b += `<text class="t" x="${X}" y="${top + 32}" font-size="11.5">${xml(fit(o.task, 11.5, W - X))}</text>`
      let yy = top + 40
      const q = o.queue.map((w, k) => ({ t: w, col: k === 0 && running ? col : undefined }))
      if (q.length) {
        b += `<text class="m" x="${X}" y="${yy + 9}" font-size="9.5">QUEUE</text>`
        const c = chips(q, X, yy + 13, W - X)
        b += c.svg
        yy += 13 + c.h
      }
      if (o.review.length) {
        b += `<text class="m" x="${X}" y="${yy + 11}" font-size="9.5">WAITING FOR REVIEW</text>`
        const c = chips(o.review.map(r => ({ t: `${r.wo} ${r.sha.slice(0, 7)}`.trim(), col: BLUE })), X, yy + 15, W - X)
        b += c.svg
        yy += 15 + c.h
      }
      y = Math.max(yy + 6, top + 50)
      if (i < s.ops.length - 1) b += `<line class="ln" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`
      y += 8
    })
    gap()
  }

  // reviews
  if (s.awaiting.length || s.recent.length) {
    title('Reviews', s.awaiting.length ? s.awaiting.length : undefined)
    if (s.awaiting.length) {
      b += `<text class="m" x="0" y="${y + 9}" font-size="9.5">AWAITING</text>`
      const c = chips(s.awaiting.map(a => ({ t: `${a.wo} ${a.sha.slice(0, 7)} · ${a.op}`, col: looks[a.op]?.color ?? BLUE })), 0, y + 13, W)
      b += c.svg
      y += 13 + c.h + 4
    }
    if (s.recent.length) {
      b += `<text class="m" x="0" y="${y + 9}" font-size="9.5">RECENT</text>`
      const c = chips(s.recent.map(r => ({ t: `${r.when.slice(3)} ${r.verdict === 'OK' ? '✓' : '✗'} ${r.wo}`, col: r.verdict === 'OK' ? GREEN : AMBER })), 0, y + 13, W)
      b += c.svg
      y += 13 + c.h + 4
    }
    if (s.legacy.length) {
      b += `<text class="m" x="0" y="${y + 10}" font-size="10.5">${s.legacy.length} older deliveries have no REVIEW row</text>`
      y += 18
    }
    gap()
  }

  // progress by area: the unfinished ones as bars, the complete ones in one line
  if (s.areas.length) {
    const open = s.areas.filter(a => a.done < a.total).sort((a, c) => c.total - c.done - (a.total - a.done))
    const full = s.areas.filter(a => a.done >= a.total)
    title('Progress by area', s.areas.length)
    const NW = 52
    const RW = 150
    const bw = Math.max(40, W - NW - RW)
    for (const a of open) {
      b += `<text class="t" x="0" y="${y + 11}" font-size="11" font-weight="600">${xml(a.name)}</text><rect class="k" x="${NW}" y="${y + 2}" width="${bw}" height="10" rx="5"/>`
      let x = NW
      for (const [n, col] of [[a.done, GREEN], [a.rev, BLUE], [a.asg, AMBER]] as const) {
        const w = (n / a.total) * bw
        if (w > 0) b += `<rect x="${x}" y="${y + 2}" width="${w}" height="10" fill="${col}"/>`
        x += w
      }
      const extra = [a.rev && `${a.rev} rev`, a.asg && `${a.asg} asg`, a.una && `${a.una} open`].filter(Boolean).join(' · ')
      b += `<text class="s" x="${W}" y="${y + 11}" font-size="10.5" text-anchor="end">${a.done}/${a.total}${extra ? ` · ${xml(extra)}` : ''}</text>`
      y += 20
    }
    if (full.length) {
      b += `<text class="m" x="0" y="${y + 11}" font-size="10.5">${xml(fit(`✓ complete: ${full.map(a => a.name).join(', ')}`, 10.5, W))}</text>`
      y += 20
    }
    gap()
  }

  // not assigned, grouped by area
  if (s.unassigned.length) {
    title('Not assigned', s.unassigned.length)
    const groups = new Map<string, number>()
    for (const w of s.unassigned) groups.set(groupOf(w), (groups.get(groupOf(w)) ?? 0) + 1)
    const c = chips([...groups].sort((a, b2) => b2[1] - a[1]).map(([g, n]) => ({ t: `${g} ×${n}` })), 0, y, W)
    b += c.svg
    y += c.h
  }
  y += 8
  return { h: y, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${CSS}${b}</svg>` }
}

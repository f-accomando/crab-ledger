import type { Report } from '../types'

// Pure SVG builders for the desktop pane. Colors follow the light/dark scheme through CSS classes.
export const GREEN = '#3B9C5F'
export const AMBER = '#E0A030'
export const RED = '#D0453F'
export const BLUE = '#5B8DEF'
export const CLAY = '#D97757'
const INK = '#1F1E1D'
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

export const num = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}G` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${Math.round(n)}`
export const usd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)
export const dur = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`)

export const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const charEm = (ch: string) => (/[\s.,:;'|!il1()[\]/]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56)
export const textW = (s: string, size: number) => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
export const fit = (s: string, size: number, maxW: number) => {
  if (textW(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textW(`…${out}${ch}`, size) > maxW) break
    out += ch
  }
  return `${out}…`
}

const CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#e9e8e5}.ln{stroke:#c9c8c4}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2f2f2d}.ln{stroke:#4a4a47}}
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob 1s steps(1) infinite}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.wave{transform-origin:0% 100%;animation:wv .6s ease-in-out infinite}@keyframes wv{50%{transform:rotate(-28deg)}}
.tw{animation:bl 1s steps(1) infinite}.tw2{animation:bl 1s steps(1) infinite -.5s}@keyframes bl{50%{opacity:.1}}
.drop{animation:dr 1.6s ease-in infinite}@keyframes dr{0%{transform:translateY(0);opacity:1}80%{transform:translateY(7px);opacity:.2}100%{transform:translateY(7px);opacity:0}}
@media (prefers-reduced-motion: reduce){.run .la,.run .lb,.run .bd,.wave,.tw,.tw2,.drop{animation:none!important}}
</style>`

const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${CSS}${body}</svg>`

type Mood = 'up' | 'down' | 'flat'
export const moodOf = (r: Report | null): Mood => {
  const t = r?.week.trend
  return !t ? 'flat' : t.pct >= 3 ? 'up' : t.pct <= -3 ? 'down' : 'flat'
}

// A pixel crab on a 30x28 grid. It always breathes; the face and the props follow the trend.
export const crab = (x: number, y: number, scale: number, mood: Mood): string => {
  const px = (cx: number, cy: number, w: number, h: number, c: string, cls = '') =>
    `<rect ${cls ? `class="${cls}" ` : ''}x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`
  const face =
    mood === 'up'
      ? px(12, 17, 1, 1, INK) + px(13, 18, 4, 1, INK) + px(17, 17, 1, 1, INK)
      : mood === 'down'
        ? px(12, 19, 1, 1, INK) + px(13, 18, 4, 1, INK) + px(17, 19, 1, 1, INK)
        : px(13, 18, 4, 1, INK)
  const arm =
    mood === 'up'
      ? `<g class="wave">${px(23, 8, 4, 4, CLAY)}${px(23, 12, 4, 2, CLAY)}</g>`
      : px(23, 14, 4, 4, CLAY)
  const extra =
    mood === 'up'
      ? `<g class="tw">${px(3, 4, 1, 3, '#F5C542')}${px(2, 5, 3, 1, '#F5C542')}</g><g class="tw2">${px(27, 2, 1, 3, '#F5C542')}${px(26, 3, 3, 1, '#F5C542')}</g>`
      : mood === 'down'
        ? `<g class="drop">${px(24, 5, 2, 3, '#7FB8E8')}${px(25, 4, 1, 1, '#7FB8E8')}</g>`
        : ''
  const body = `${px(7, 10, 16, 12, CLAY)}${px(3, 14, 4, 4, CLAY)}${arm}${px(9, 12, 2, 2, INK)}${px(19, 12, 2, 2, INK)}${face}${extra}`
  const legs = (cls: string, xs: number[]) => `<g class="${cls}">${xs.map(lx => px(lx, 22, 2, 4, CLAY)).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"><g class="run"><g class="bd">${body}</g>${legs('la', [7, 17])}${legs('lb', [11, 21])}</g></g>`
}

const barColor = (eff: number, lines: number) => (lines === 0 ? '#8E929A' : eff >= 100 ? GREEN : AMBER)

export const headerSvg = (W: number, r: Report): string => {
  const t = r.week.trend
  const mood = moodOf(r)
  const col = mood === 'up' ? GREEN : mood === 'down' ? RED : AMBER
  const verdict = !t
    ? 'not enough history yet'
    : mood === 'up'
      ? `▲ improving ${t.pct >= 0 ? '+' : ''}${t.pct.toFixed(0)}%`
      : mood === 'down'
        ? `▼ worsening ${t.pct.toFixed(0)}%`
        : `▬ steady ${t.pct.toFixed(0)}%`
  const effs = r.days.slice(-14)
  const n = effs.length
  const gap = 3
  const bw = (W - 12 - gap * (n - 1)) / n
  const H0 = 30
  const bars = effs
    .map((d, i) => {
      const h = d.eff > 0 ? Math.max(3, effPos(d.eff) * H0) : 2
      return `<rect x="${6 + i * (bw + gap)}" y="${118 + H0 - h}" width="${bw}" height="${h}" rx="2" fill="${d.eff > 0 ? (d.eff >= 100 ? GREEN : AMBER) : '#8E929A'}" opacity="${d.eff > 0 ? 1 : 0.35}"/>`
    })
    .join('')
  const yBase = 118 + H0 - effPos(100) * H0
  const body = `${crab(6, 8, 2.6, mood)}
<text class="s" x="94" y="22" font-size="11">EFFICIENCY</text>
<text x="94" y="62" font-size="38" font-weight="700" fill="${col}">${Math.round(r.week.eff)}</text>
<text class="m" x="${94 + textW(String(Math.round(r.week.eff)), 38) + 6}" y="62" font-size="12">pt</text>
<text x="94" y="82" font-size="13" font-weight="600" fill="${col}">${xml(verdict)}</text>
<text class="m" x="94" y="98" font-size="10.5">${r.week.est ? `estimate · ${num(r.week.pend)} uncommitted lines counted · ` : ''}100 = your typical day${r.week.provisional ? ` (from ${r.week.baseDays} days)` : ''} · log scale</text>
<line class="ln" x1="6" x2="${W - 6}" y1="${yBase}" y2="${yBase}" stroke-width="1" stroke-dasharray="3 3"/>
${bars}
<text class="m" x="6" y="114" font-size="10">last ${n} days</text>`
  return svg(W, 156, body)
}

export const weekSvg = (W: number, r: Report): string => {
  const w = r.week
  const last7 = r.days.slice(-7)
  const add = last7.reduce((s, d) => s + d.add, 0)
  const del = last7.reduce((s, d) => s + d.del, 0)
  const cw = W / 4
  const tile = (i: number, label: string, value: string, sub: string, color?: string) =>
    `<text class="s" x="${i * cw + 6}" y="14" font-size="10.5">${label}</text>
<text ${color ? `fill="${color}"` : 'class="t"'} x="${i * cw + 6}" y="36" font-size="18" font-weight="650">${xml(value)}</text>
<text class="m" x="${i * cw + 6}" y="51" font-size="10">${xml(sub)}</text>`
  const m = r.mix
  const total = m.cr + m.cw + m.out + m.in || 1
  const parts = [
    { k: 'cache read', v: m.cr, c: BLUE },
    { k: 'cache write', v: m.cw, c: AMBER },
    { k: 'output', v: m.out, c: CLAY },
    { k: 'input', v: m.in, c: '#8E929A' },
  ]
  let x = 6
  const bw = W - 12
  const segs = parts
    .map(p => {
      const sw = (p.v / total) * bw
      const s = `<rect x="${x}" y="82" width="${Math.max(0, sw)}" height="14" fill="${p.c}"/>`
      x += sw
      return s
    })
    .join('')
  const legend = parts
    .map((p, i) => {
      const lx = 6 + (i % 2) * (W / 2)
      const ly = 114 + Math.floor(i / 2) * 15
      return `<rect x="${lx}" y="${ly - 8}" width="8" height="8" rx="2" fill="${p.c}"/><text class="s" x="${lx + 13}" y="${ly}" font-size="10.5">${p.k} ${Math.round((p.v / total) * 100)}% · ${usd(p.v)}</text>`
    })
    .join('')
  return svg(
    W,
    146,
    `${tile(0, 'COST 7D', usd(w.cost), 'API equiv.')}${tile(1, 'TOKENS', num(w.tok), `${num(m.ctxAvg)} avg ctx`)}${tile(2, 'TIME', dur(w.min), 'active')}${tile(3, 'LINES', num(add + del), `+${num(add)} −${num(del)}`, GREEN)}
<text class="s" x="6" y="76" font-size="10.5">WHERE THE MONEY GOES</text>
<clipPath id="r"><rect x="6" y="82" width="${bw}" height="14" rx="7"/></clipPath><g clip-path="url(#r)"><rect class="k" x="6" y="82" width="${bw}" height="14"/>${segs}</g>
${legend}`,
  )
}

// efficiency on a log scale: 100 sits in the middle, 25 and 400 are the edges (half and double are equally far from 100)
const LO = 25, HI = 400
export const effPos = (eff: number) => (eff <= 0 ? 0 : Math.min(1, Math.max(0, Math.log(eff / LO) / Math.log(HI / LO))))

export const daysSvg = (W: number, r: Report, count: number): string => {
  const days = r.days.slice(-count)
  // bar length = efficiency on a log scale (dashed tick = 100, your typical day, in the middle); the cost is the number on the right
  const RH = 34
  const BX = 46
  const BW = W - BX - 64
  const tick = BX + effPos(100) * BW
  const rows = days
    .map((d, i) => {
      const y = 26 + i * RH
      const w = d.eff > 0 ? Math.max(3, effPos(d.eff) * BW) : 0
      const col = barColor(d.eff, d.lines)
      const [, mo, da] = d.day.split('-')
      return `<text class="s" x="6" y="${y + 11}" font-size="11">${da}/${mo}</text>
<rect class="k" x="${BX}" y="${y}" width="${BW}" height="13" rx="6.5"/>
<rect x="${BX}" y="${y}" width="${w}" height="13" rx="6.5" fill="${col}"/>
<text class="t" x="${W - 6}" y="${y + 11}" font-size="12" font-weight="600" text-anchor="end">${usd(d.cost)}</text>
<text class="m" x="${BX}" y="${y + 26}" font-size="10">${num(d.read)} read · ${num(d.out)} out · ${dur(d.min)} · <tspan fill="${GREEN}">+${num(d.add)}</tspan> <tspan fill="${RED}">−${num(d.del)}</tspan> · eff ${d.eff > 0 ? Math.round(d.eff) : '–'}${d.est ? ' (estimate)' : ''}${d.agentShare > 0.05 ? ` · agents ${Math.round(d.agentShare * 100)}%` : ''}</text>`
    })
    .join('')
  const leg = (x: number, c: string, t: string) => `<rect x="${x}" y="3" width="8" height="8" rx="2" fill="${c}"/><text class="s" x="${x + 12}" y="11" font-size="10">${t}</text>`
  return svg(W, 30 + days.length * RH, `${leg(6, GREEN, 'above average')}${leg(W * 0.36, AMBER, 'below')}${leg(W * 0.56, '#8E929A', 'no commits')}${rows}<line class="ln" x1="${tick}" x2="${tick}" y1="22" y2="${30 + days.length * RH - 6}" stroke-width="1" stroke-dasharray="3 3"/>
<text class="m" x="${tick}" y="19" font-size="9" text-anchor="middle">100</text>`)
}

export const rereadSvg = (W: number, r: Report): string => {
  const list = r.rereads.slice(0, 6)
  const top = Math.max(...list.map(f => f.cost), 0.01)
  const RH = 36
  const BW = W - 12
  const rows = list
    .map((f, i) => {
      const y = i * RH + 2
      const name = fit(f.path, 12, BW - 56)
      return `<text class="t" x="6" y="${y + 12}" font-size="12">${xml(name)}</text>
<text x="${W - 6}" y="${y + 12}" font-size="12" font-weight="600" text-anchor="end" fill="${AMBER}">${usd(f.cost)}</text>
<rect class="k" x="6" y="${y + 18}" width="${BW}" height="6" rx="3"/>
<rect x="6" y="${y + 18}" width="${Math.max(3, (f.cost / top) * BW)}" height="6" rx="3" fill="${AMBER}"/>
<text class="m" x="6" y="${y + 34}" font-size="10">${f.reads} reads · ${f.rereads} re-reads</text>`
    })
    .join('')
  return svg(W, Math.max(20, list.length * RH + 4), rows)
}

const FAM: Record<string, string> = { opus: CLAY, fable: '#9B7BD6', sonnet: BLUE, haiku: GREEN }

export const ACT: [string, string, string][] = [
  ['think', 'model', '#A78BFA'],
  ['read', 'read', '#38BDF8'],
  ['write', 'write', '#34D399'],
  ['run', 'run', '#FBBF24'],
  ['input', 'input', '#94A3B8'],
  ['wait', 'wait', '#CBD5E1'],
]

export const AGENT_RH = 76
export const agentsHeight = (n: number) => 40 + Math.min(7, n) * AGENT_RH

export const agentsSvg = (W: number, r: Report): string => {
  const list = r.agents.slice(0, 7)
  const topCost = Math.max(...list.map(a => a.cost), 0.01)
  // efficiency per agent, 100 = the median of its own group:
  //  writers: geometric mean of lines/$ and lines/hour (as the days); readers (no lines written): tasks completed per $
  const writes = (a: (typeof list)[number]) => a.lw > 0
  const enough = (a: (typeof list)[number]) => a.cost > 0 && a.runs > 0 && (a.runs >= 2 || a.cost >= 1)
  const effRaw = (a: (typeof list)[number]) =>
    !enough(a) ? 0 : writes(a) ? (a.min > 0 ? Math.sqrt((a.lw / a.cost) * (a.lw / (a.min / 60))) : 0) : Math.max(0, a.runs - a.stall) / a.cost
  const medOf = (w: boolean) => {
    const v = list.filter(a => writes(a) === w).map(effRaw).filter(x => x > 0).sort((x, y) => x - y)
    return v.length ? v[Math.floor(v.length / 2)] : 0
  }
  const medW = medOf(true), medR = medOf(false)
  const RH = AGENT_RH
  const BW = W - 12
  const rows = list
    .map((a, i) => {
      const y = 40 + i * RH
      const col = FAM[a.fam] ?? '#8E929A'
      const name = a.type === 'main' ? 'main session' : a.type
      const label = fit(`${name} · ${a.fam}`, 12, BW - 60)
      const perDollar = a.cost > 0 ? a.lw / a.cost : 0
      const unit = a.type === 'main' ? (a.runs === 1 ? 'session' : 'sessions') : a.runs === 1 ? 'run' : 'runs'
      const rep = a.min > 0 && a.repMin > 0 ? ` · ↻ ${Math.round((a.repMin / a.min) * 100)}% repeated` : ''
      const sub1 = `${a.runs} ${unit} · ${dur(a.min)} worked${rep}`
      const med = writes(a) ? medW : medR
      const eff = med > 0 ? (effRaw(a) / med) * 100 : 0
      const done = Math.max(0, a.runs - a.stall)
      const lead = writes(a) ? `+${num(a.lw)}/−${num(a.ld)} lines · ${Math.round(perDollar)} lines/$` : `${done}/${a.runs} done · ${(a.cost > 0 ? done / a.cost : 0).toFixed(1)} tasks/$`
      const sub2 = `${lead} · ${usd(a.runs ? a.cost / a.runs : a.cost)}/run · eff ${eff > 0 ? Math.round(eff) : '–'}`
      const total = ACT.reduce((t, [k]) => t + (a.act[k as keyof typeof a.act] || 0), 0) || 1
      const full = BW // the whole bar is 100% of this agent's time
      let x = 6
      const segs = ACT.map(([k, , c]) => {
        const w = ((a.act[k as keyof typeof a.act] || 0) / total) * full
        const s = w > 0.3 ? `<rect x="${x}" y="${y + 28}" width="${w}" height="7" fill="${c}"/>` : ''
        x += w
        return s
      }).join('')
      return `<circle cx="10" cy="${y + 6}" r="4" fill="${col}"/>
<text class="t" x="20" y="${y + 10}" font-size="12" font-weight="600">${xml(label)}</text>
<text x="${W - 6}" y="${y + 10}" font-size="12" font-weight="600" text-anchor="end" fill="${col}">${usd(a.cost)}</text>
<rect class="k" x="6" y="${y + 17}" width="${BW}" height="8" rx="4"/>
<rect x="6" y="${y + 17}" width="${Math.max(3, (a.cost / topCost) * BW)}" height="8" rx="4" fill="${col}"/>
<rect class="k" x="6" y="${y + 28}" width="${BW}" height="7" rx="3.5"/>
<clipPath id="c${i}"><rect x="6" y="${y + 28}" width="${full}" height="7" rx="3.5"/></clipPath><g clip-path="url(#c${i})">${segs}</g>
<rect class="k" x="6" y="${y + 38}" width="${BW}" height="4" rx="2"/>${eff > 0 ? `<rect x="6" y="${y + 38}" width="${Math.max(3, effPos(eff) * BW)}" height="4" rx="2" fill="${writes(a) ? (eff >= 100 ? GREEN : AMBER) : BLUE}"/>` : ''}<line class="ln" x1="${6 + BW / 2}" x2="${6 + BW / 2}" y1="${y + 36}" y2="${y + 44}" stroke-width="1"/>
<text class="m" x="6" y="${y + 53}" font-size="10">${xml(sub1)}</text>
<text class="m" x="6" y="${y + 66}" font-size="10">${xml(sub2)}</text>`
    })
    .join('')
  const legend = ACT.map(([, label, c], i) => {
    const lx = 6 + i * (BW / 6)
    return `<rect x="${lx}" y="19" width="7" height="7" rx="2" fill="${c}"/><text class="s" x="${lx + 10}" y="26" font-size="9.5">${label}</text>`
  }).join('')
  const head = `<text class="s" x="6" y="11" font-size="10">top bar = cost · middle = how the time was spent (full bar = 100%) · thin = efficiency, log (green/amber lines, blue tasks done)</text>${legend}`
  return svg(W, agentsHeight(list.length), `${head}${rows}`)
}

export const repeatedSvg = (W: number, r: Report): string => {
  const list = r.repeated.slice(0, 5)
  const top = Math.max(...list.map(x => x.min), 0.01)
  const RH = 34
  const BW = W - 12
  const rows = list
    .map((x, i) => {
      const y = 2 + i * RH
      const [tool, ...rest] = x.key.split(' ')
      const label = fit(`${tool === 'Agent' ? 'subagent' : tool} ${rest.join(' ')}`, 12, BW - 56)
      return `<text class="t" x="6" y="${y + 11}" font-size="12">${xml(label)}</text>
<text x="${W - 6}" y="${y + 11}" font-size="12" font-weight="600" text-anchor="end" fill="${RED}">${dur(x.min)}</text>
<rect class="k" x="6" y="${y + 17}" width="${BW}" height="5" rx="2.5"/>
<rect x="6" y="${y + 17}" width="${Math.max(3, (x.min / top) * BW)}" height="5" rx="2.5" fill="${RED}"/>
<text class="m" x="6" y="${y + 32}" font-size="10">${x.n} times · ${x.files} sessions</text>`
    })
    .join('')
  return svg(W, Math.max(20, list.length * RH + 4), rows)
}

import type { AgentRow, LiveAgent } from '../types'
import { AMBER, BLUE, CLAY, GREEN, RED, dur, usd } from './draw'

// Live subagents: state, progress, ETA, efficiency, grade and the SVG card of each one.

const INK = '#1F1E1D'
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
export const FAMCOL: Record<string, string> = { opus: CLAY, fable: '#9B7BD6', sonnet: BLUE, haiku: GREEN }

// $ per million tokens: [input, output]; cache write 1.25x input, read 0.1x (as aggregate.mjs).
const PRICES: [RegExp, [number, number]][] = [
  [/haiku/, [1, 5]],
  [/sonnet/, [3, 15]],
  [/opus/, [5, 25]],
  [/fable/, [10, 50]],
]
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
export const famOf = (m: string) => (/opus/.test(m) ? 'opus' : /sonnet/.test(m) ? 'sonnet' : /haiku/.test(m) ? 'haiku' : /fable/.test(m) ? 'fable' : 'other')
export const costOf = (model: string, u: Usage): number => {
  const [pi, po] = (PRICES.find(([re]) => re.test(model)) ?? [0, [3, 15]])[1]
  return (((u.input_tokens || 0) * pi + (u.output_tokens || 0) * po + (u.cache_creation_input_tokens || 0) * pi * 1.25 + (u.cache_read_input_tokens || 0) * pi * 0.1) / 1e6)
}

const bare = (t: string) => t.replace(/^[^:]*:/, '').toLowerCase()

// What this kind of agent usually costs and lasts: the 7-day history of its type and model.
export const typical = (agents: AgentRow[] | undefined, type: string, fam: string) => {
  const rows = (agents ?? []).filter(a => a.type !== 'main' && bare(a.type) === bare(type) && a.runs >= 2)
  const mine = rows.find(a => a.fam === fam) ?? rows[0]
  if (mine) return { min: Math.max(0.3, mine.min / mine.runs), cost: Math.max(0.01, mine.cost / mine.runs), known: true }
  return { min: 4, cost: fam === 'haiku' ? 0.15 : fam === 'sonnet' ? 0.4 : 0.8, known: false }
}

const MS = 60_000
export const stats = (a: LiveAgent, at: number) => {
  const el = Math.max(0, (a.end ?? Math.max(at, a.start)) - a.start)
  const isRun = a.status === 'running'
  const p = !isRun ? 1 : Math.min(0.95, Math.max(el / (a.expMin * MS), a.cost / a.expCost))
  const left = isRun ? Math.max(0, a.expMin * MS - el) : 0
  // efficiency: cost and time against the typical run of the same type; 100 = typical. While running, projected at the end.
  const ok = !isRun || p >= 0.15
  const cost = isRun ? a.cost / p : a.cost
  const min = isRun ? el / MS / p : el / MS
  const eff = ok && cost > 0 && min > 0 ? Math.sqrt((a.expCost / cost) * (a.expMin / min)) * 100 : 0
  const grade = a.status === 'failed' ? 'F' : eff >= 140 ? 'A' : eff >= 100 ? 'B' : eff >= 70 ? 'C' : eff >= 45 ? 'D' : 'E'
  return { el, p, left, eff, grade, over: isRun && el > a.expMin * MS }
}

const LO = 25, HI = 400
const pos = (e: number) => (e <= 0 ? 0 : Math.min(1, Math.max(0, Math.log(e / LO) / Math.log(HI / LO))))
export const clock = (ms: number) => dur(ms / MS).replace(/^0m$/, '<1m')
export const leftText = (a: LiveAgent, s: ReturnType<typeof stats>) =>
  a.status !== 'running' ? `took ${clock(s.el)}` : s.over ? 'over typical' : `~${clock(s.left)} left`

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

// --- the crab and its props: a pixel crab on a 30x28 grid, one costume per role.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void
const body = (f: Fill, arm = 0) => {
  f(7, 10, 16, 12, CLAY); f(3, 14, 4, 4, CLAY); f(23, 14 + arm, 4, 4, CLAY, 'it')
  f(9, 12, 2, 2, INK); f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la'); f(17, 22, 2, 4, CLAY, 'la'); f(11, 22, 2, 4, CLAY, 'lb'); f(21, 22, 2, 4, CLAY, 'lb')
}
const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))
// a body whose raised claw can ride a prop (armCls), or stay still with the body
const plain = (f: Fill, arm = 0, armCls = 'bd') => {
  f(7, 10, 16, 12, CLAY); f(3, 14, 4, 4, CLAY); f(23, 14 + arm, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK); f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la'); f(17, 22, 2, 4, CLAY, 'la'); f(11, 22, 2, 4, CLAY, 'lb'); f(21, 22, 2, 4, CLAY, 'lb')
}
const costumes: Record<string, (f: Fill, c: string) => void> = {
  // planner: beret and a rolled plan
  planner: (f, c) => { body(f, -4); f(9, 6, 12, 3, c); f(11, 4, 8, 2, c); f(25, 4, 5, 9, '#F4E9C8', 'it'); f(26, 7, 3, 1, c, 'it') },
  // coder: headphones and a pen
  coder: (f, c) => { body(f, -4); f(7, 8, 16, 1, '#3A3A3C'); f(6, 8, 1, 7, '#3A3A3C'); f(23, 8, 1, 7, '#3A3A3C'); f(5, 11, 3, 5, c); f(22, 11, 3, 5, c); f(27, 5, 1, 10, '#3A3A3C', 'it') },
  // research / explore: a magnifier
  research: (f, c) => { body(f, -4); f(9, 7, 12, 2, '#7A4A26'); f(24, 2, 5, 1, '#3A3A3C', 'it'); f(23, 3, 1, 4, '#3A3A3C', 'it'); f(29, 3, 1, 4, '#3A3A3C', 'it'); f(24, 7, 5, 1, '#3A3A3C', 'it'); f(24, 3, 5, 4, c, 'it'); f(26, 8, 1, 5, '#7A4A26', 'it') },
  // mechanic: hard hat and a wrench
  mechanic: (f, c) => { body(f); f(8, 5, 14, 5, '#F5C542'); f(7, 9, 16, 1, '#C99A1E'); f(13, 6, 4, 2, c); f(0, 10, 3, 4, '#8E929A') },
  // light: mortarboard and a book
  light: (f, c) => { body(f, -4); f(5, 6, 20, 2, '#2B2B2B'); f(9, 8, 12, 2, '#2B2B2B'); f(24, 6, 1, 6, '#F5C542'); f(24, 8, 6, 6, c, 'it'); f(25, 9, 4, 1, '#F8F6F1', 'it') },
  // deep: miner's helmet with a lamp, and a pickaxe
  deep: (f, c) => { body(f, -4); f(8, 5, 14, 4, c); f(7, 9, 16, 1, '#6B3A1E'); f(13, 2, 4, 3, '#FFE066'); f(27, 5, 1, 11, '#7A4A26', 'it'); f(23, 4, 8, 2, '#8E929A', 'it') },
  // runner: a sweatband and a clipboard with a check mark (executes, then verifies)
  runner: (f, c) => { body(f, -4); f(6, 6, 18, 2, c); f(24, 4, 6, 9, '#7A4A26', 'it'); f(25, 5, 4, 7, '#F8F6F1', 'it'); f(26, 3, 2, 2, '#8E929A', 'it'); f(25, 9, 1, 1, '#3FA76A', 'it'); f(26, 10, 1, 1, '#3FA76A', 'it'); f(27, 9, 1, 1, '#3FA76A', 'it'); f(28, 8, 1, 1, '#3FA76A', 'it') },
  // ported from savvy-progress: one costume per tier, drawn with its own animations (see CSS)
  // astronaut (fable): a glass dome, floats instead of walking
  astronaut: (f, t) => {
    plain(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // detective (heavy, tracker): a deerstalker and a sweeping magnifier
  detective: (f, t) => {
    plain(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // engineer (careful): a hard hat and a wrench that turns a bolt
  engineer: (f, t) => {
    plain(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // chef (medium): a toque, tosses the omelette
  chef: (f, t) => {
    plain(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // racer (light): a helmet, runs at double pace with a checkered flag
  racer: (f, t) => {
    plain(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // pirate (Explore): a bicorn and a cutlass that fences
  pirate: f => {
    plain(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  // ninja (ops): a dark hood with an eye slit, a headband in the agent color, a spinning shuriken
  ninja: (f, t) => {
    plain(f)
    f(7, 7, 16, 7, '#2B2B30'); f(9, 11, 12, 3, CLAY); f(9, 12, 2, 2, INK); f(19, 12, 2, 2, INK)
    f(7, 9, 16, 1, t); f(23, 9, 3, 1, t); f(25, 10, 2, 2, t)
    stamp(f, 25, 2, ['..s..', '.sss.', 'ss.ss', '.sss.', '..s..'], { s: '#C9CCD2' }, 'shu')
  },
  other: f => body(f),
}
// the color of a tier, as in savvy-progress; the others take the color of the model
export const TIERCOL: Record<string, string> = { astronaut: '#7F77DD', detective: '#D85A30', engineer: '#BA7517', chef: '#378ADD', racer: '#1D9E75' }
export const costumeOf = (type: string): string => {
  const t = bare(type)
  return /plan/.test(t) ? 'planner' : /cod/.test(t) ? 'coder' : /research/.test(t) ? 'research' : /savvy-fable/.test(t) ? 'astronaut' : /savvy-heavy|tracker/.test(t) ? 'detective' : /savvy-careful/.test(t) ? 'engineer' : /savvy-medium|standard/.test(t) ? 'chef' : /savvy-light/.test(t) ? 'racer' : t === 'explore' ? 'pirate' : /mechanic/.test(t) ? 'mechanic' : /runner/.test(t) ? 'runner' : /(^|-)ops$/.test(t) ? 'ninja' : /deep|heavy|careful|fable/.test(t) ? 'deep' : /light|medium/.test(t) ? 'light' : 'other'
}
export const crab = (x: number, y: number, costume: string, color: string, running: boolean): string => {
  const g: Record<string, string[]> = { bd: [], la: [], lb: [], it: [] }
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => (g[cls] ??= []).push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  ;(costumes[costume] ?? costumes.other)!(f, color)
  return `<g transform="translate(${x},${y}) scale(1.1)" shape-rendering="crispEdges"><g class="c-${costume}${running ? ' run' : ''}"><g class="bd">${g.bd!.join('')}<g class="it">${g.it!.join('')}</g>${Object.keys(g).filter(k => !['bd', 'la', 'lb', 'it'].includes(k)).map(k => `<g class="${k}">${g[k]!.join('')}</g>`).join('')}</g><g class="la">${g.la!.join('')}</g><g class="lb">${g.lb!.join('')}</g></g></g>`
}

export const CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#e9e8e5}.ln{stroke:#c9c8c4}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2f2f2d}.ln{stroke:#4a4a47}}
.run g{transform-box:fill-box}
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}.run .bd{animation:bob 1s steps(1) infinite}
.run .it{transform-origin:50% 100%;animation:sw .5s ease-in-out infinite}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}@keyframes sw{50%{transform:rotate(-14deg)}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
.c-astronaut.run{animation:float 1s ease-in-out infinite}
.c-astronaut.run .la,.c-astronaut.run .lb,.c-astronaut.run .bd{animation:none}
.c-astronaut.run .ant{animation:blink 1s steps(1) infinite}
.c-astronaut.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-detective.run .it{animation:scan 1s steps(1) infinite}
.c-detective.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-engineer.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-chef.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-chef.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-racer.run .la{animation-duration:.25s}.c-racer.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-racer.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-pirate.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
.c-ninja.run .shu{transform-origin:50% 50%;animation:spin .5s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g,.run .la,.run .lb,.run .bd,.run .it,.live,.ant,.star,.gl,.pan,.egg,.flag,.shu{animation:none!important}}
</style>`

export const LIVE_H = 74
export const CRAB_W = 42
export const CRAB_H = 50
export const gradeColor = (g: string) => (g === 'A' || g === 'B' ? GREEN : g === 'C' ? AMBER : RED)

// The card is two drawings side by side: the crab (with the close button under it) and the text and bars.
export const crabSvg = (a: LiveAgent): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CRAB_W}" height="${CRAB_H}" viewBox="0 0 ${CRAB_W} ${CRAB_H}">${CSS}${crab(0, 14, costumeOf(a.type), TIERCOL[costumeOf(a.type)] ?? FAMCOL[a.fam] ?? '#8E929A', a.status === 'running')}</svg>`

export const liveSvg = (W: number, a: LiveAgent, at: number): string => {
  const s = stats(a, at)
  const col = TIERCOL[costumeOf(a.type)] ?? FAMCOL[a.fam] ?? '#8E929A'
  const BW = W - 6
  const running = a.status === 'running'
  const effCol = s.eff >= 100 ? GREEN : AMBER
  const head = fit(a.desc || a.type, Math.max(12, Math.floor((BW - 20) / 7.5)))
  const meta = `${bare(a.type)} · ${a.fam} · ${a.steps} steps · ${usd(a.cost)}`
  const right = running ? `${Math.round(s.p * 100)}% · ${leftText(a, s)}` : `${a.status === 'failed' ? 'failed' : 'done'} · ${leftText(a, s)}`
  const mark = running
    ? `<circle class="live" cx="${W - 8}" cy="16" r="3.5" fill="${col}"/>`
    : a.status === 'failed'
      ? `<path d="M${W - 12} 12l8 8M${W - 4} 12l-8 8" stroke="${RED}" stroke-width="1.8" stroke-linecap="round"/>`
      : `<path d="M${W - 13} 16l3.5 3.5 6.5-7" fill="none" stroke="${GREEN}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  const effText = `${s.eff > 0 ? `eff ${Math.round(s.eff)}${running ? ' (projected)' : ''}` : 'eff –'}${a.known ? '' : ' · no history yet, rough guess'}`
  const grade = running ? '' : `<tspan font-weight="700" fill="${gradeColor(s.grade)}">  ·  ≈${s.grade}</tspan>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LIVE_H}" viewBox="0 0 ${W} ${LIVE_H}" font-family="${FONT}">${CSS}
<text class="t" x="0" y="18" font-size="13" font-weight="600">${xml(head)}</text>
<text class="s" x="0" y="33" font-size="11">${xml(meta)}</text>
<text class="s" x="${W - 22}" y="33" font-size="11" text-anchor="end">${xml(right)}</text>
<rect class="k" x="0" y="40" width="${BW}" height="7" rx="3.5"/><rect x="0" y="40" width="${Math.max(3, s.p * BW)}" height="7" rx="3.5" fill="${a.status === 'failed' ? RED : col}"/>
<rect class="k" x="0" y="51" width="${BW}" height="4" rx="2"/>${s.eff > 0 ? `<rect x="0" y="51" width="${Math.max(3, pos(s.eff) * BW)}" height="4" rx="2" fill="${effCol}"/>` : ''}<line class="ln" x1="${BW / 2}" x2="${BW / 2}" y1="49" y2="57" stroke-width="1"/>
<text class="m" x="0" y="68" font-size="10">${xml(effText)}${grade}</text>
${mark}</svg>`
}

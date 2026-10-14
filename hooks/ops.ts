import type { Op, OpState } from '../types'
import { GREEN, AMBER, RED, BLUE } from './draw'
import { CSS, crab } from './live'

// Operators of a shared repo (SYNC.md + sync/<NAME>.md): who works, who waits, who went silent.
export type { Op, OpState }

const stateOf = (s: string): [OpState, string] => {
  const m = /^`?\s*(DONE|WORKING|WAITING|IDLE|FREE)\b\s*(.*?)`?$/.exec(s.trim())
  return m ? [m[1] as OpState, (m[2] ?? '').replace(/`+$/, '').trim()] : ['?', s.trim()]
}
export const OPS_SILENT_MIN = 60

const NAME_FILE: Record<string, string> = { 'claude local': 'SPV', 'claude cloud': 'CLD', antigravity: 'AGY' }
export const fileOf = (name: string) => NAME_FILE[name.toLowerCase()]

// "2026-10-14 09:20 CEST (ora di Roma)" -> ms; times are read as local time of the machine.
const stamp = (s: string): number | undefined => {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s)
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!).getTime() : undefined
}

export const parseOps = (sync: string, files: Record<string, string>, now: number): { ops: Op[]; chain: string } => {
  const ops: Op[] = []
  for (const line of sync.split('\n')) {
    const c = line.split('|').map(x => x.trim())
    if (c.length < 6 || !/^\*\*.+\*\*$/.test(c[1] ?? '')) continue
    const name = c[1]!.replace(/\*/g, '')
    const [state, task] = stateOf(c[2] ?? '')
    const op: Op = { name, state, task, detail: (c[3] ?? '').replace(/`/g, ''), eta: c[4] ?? '', silent: false, clash: false }
    const f = files[fileOf(name) ?? '']
    if (f) {
      const up = /^\**Ultimo aggiornamento:?\**:?\s*([^\n]+)/m.exec(f)
      const st = /^\**Stato:?\**:?\s*([^\n]+)/m.exec(f)
      op.updated = up ? stamp(up[1]!) : undefined
      if (st) [op.fileState, op.fileTask] = stateOf(st[1]!)
      op.silent = op.updated !== undefined && now - op.updated > OPS_SILENT_MIN * 60_000 && (op.fileState === 'WORKING' || op.state === 'WORKING')
      op.clash = !!op.fileState && op.fileState !== op.state && !(op.fileState === 'FREE' && op.state === 'DONE')
    }
    ops.push(op)
  }
  const chain = /Catena[^\n]*/.exec(sync)?.[0] ?? ''
  return { ops, chain }
}

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
const COSTUME: Record<string, string> = { 'claude local': 'planner', 'claude cloud': 'research', antigravity: 'mechanic' }
export const stateColor = (o: Op) => (o.silent ? RED : o.state === 'DONE' ? GREEN : o.state === 'WORKING' ? BLUE : o.state === 'WAITING' ? AMBER : o.state === 'IDLE' ? RED : o.state === 'FREE' ? '#4FB0A8' : '#8E929A')
export const ago = (ms: number) => (ms < 90_000 ? 'now' : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min ago` : `${(ms / 3_600_000).toFixed(1)} h ago`)

export const OP_H = 80
export const opSvg = (W: number, o: Op, now: number): string => {
  const col = stateColor(o)
  const live = (o.state === 'WORKING' && !o.silent)
  const age = o.updated !== undefined ? Math.max(0, now - o.updated) : undefined
  const fresh = age === undefined ? 0 : Math.max(0, 1 - age / (OPS_SILENT_MIN * 60_000))
  const freshCol = age === undefined ? '#8E929A' : age < 15 * 60_000 ? GREEN : age < OPS_SILENT_MIN * 60_000 ? AMBER : RED
  const X = 44, BW = W - X - 6
  const shown = o.silent ? 'IDLE (silent)' : o.state
  const sub = `${o.task ? o.task : o.detail}`
  const lines = [sub, o.silent || o.clash ? '' : o.detail === sub ? '' : o.detail].filter(Boolean)
  const warn = o.clash ? `table says ${o.state}, its own file says ${o.fileState}${o.fileTask ? ' ' + o.fileTask : ''}` : o.silent ? `no update for ${ago(age ?? 0).replace(' ago', '')}: counts as IDLE (rule: ${OPS_SILENT_MIN} min)` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${OP_H}" viewBox="0 0 ${W} ${OP_H}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${CSS}
${crab(0, 16, COSTUME[o.name.toLowerCase()] ?? 'other', col, live)}
<text class="t" x="${X}" y="17" font-size="13" font-weight="600">${xml(o.name)}</text>
<rect x="${X + 100}" y="6" width="${shown.length * 6.4 + 12}" height="16" rx="8" fill="${col}"/><text x="${X + 106}" y="17.5" font-size="10" font-weight="700" fill="#fff">${xml(shown)}</text>
<text class="s" x="${W - 6}" y="17" font-size="11" text-anchor="end">${o.eta && o.eta !== '-' ? 'ETA ' + xml(o.eta) : ''}</text>
<text class="t" x="${X}" y="33" font-size="11">${xml(fit(lines[0] ?? '', Math.floor(BW / 5.6)))}</text>
<text class="s" x="${X}" y="46" font-size="10.5">${xml(fit(lines[1] ?? '', Math.floor(BW / 5.4)))}</text>
<rect class="k" x="${X}" y="54" width="${BW}" height="5" rx="2.5"/>${age === undefined ? '' : `<rect x="${X}" y="54" width="${Math.max(3, fresh * BW)}" height="5" rx="2.5" fill="${freshCol}"/>`}
<text class="m" x="${X}" y="72" font-size="10">${age === undefined ? 'no file of its own: freshness not tracked' : `last update ${xml(new Date(o.updated!).toTimeString().slice(0, 5))} · ${xml(ago(age))}`}</text>
${warn ? `<text x="${W - 6}" y="72" font-size="10" text-anchor="end" fill="${o.silent ? RED : AMBER}">${xml(fit('⚠ ' + warn, Math.floor((BW - 120) / 5.3)))}</text>` : ''}
</svg>`
}

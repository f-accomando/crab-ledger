export type Day = {
  day: string
  tok: number
  out: number
  cost: number
  min: number
  add: number
  del: number
  lines: number
  eff: number
  agentShare: number
}
export type Reread = { path: string; reads: number; rereads: number; cost: number; tok: number }
export type Report = {
  at: number
  days: Day[]
  rereads: Reread[]
  week: { cost: number; tok: number; min: number; lines: number; eff: number; trend: { pct: number; recent: number; before: number } | null }
  scanned: number
  mix: { in: number; out: number; cw: number; cr: number; agent: number; ctxAvg: number; fam: Record<string, number>; rereadAll: number }
  tips: { kind: string; save: number; title: string; why: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'crab-ledger': { report: Report | null; note: string }
  }
}

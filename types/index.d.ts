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
  /** true while today has uncommitted lines counted as an estimate */
  est: boolean
  /** uncommitted lines (added + deleted) included in `lines` */
  pend: number
}
export type AgentRow = { type: string; fam: string; runs: number; cost: number; tok: number; out: number; msgs: number; tools: number; edits: number; lw: number; ld: number; min: number; act: Record<'think' | 'read' | 'write' | 'run' | 'input' | 'wait', number>; repMin: number }
export type Reread = { path: string; reads: number; rereads: number; cost: number; tok: number }
export type Report = {
  at: number
  days: Day[]
  rereads: Reread[]
  week: { cost: number; tok: number; min: number; lines: number; eff: number; trend: { pct: number; recent: number; before: number } | null; est: boolean; pend: number }
  scanned: number
  mix: { in: number; out: number; cw: number; cr: number; agent: number; ctxAvg: number; fam: Record<string, number>; rereadAll: number }
  agents: AgentRow[]
  repeated: { key: string; n: number; min: number; files: number }[]
  tips: { kind: string; save: number; title: string; why: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'crab-ledger': { report: Report | null; note: string }
  }
}

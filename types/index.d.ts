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
export type AgentRow = { type: string; fam: string; runs: number; stall: number; cost: number; tok: number; out: number; msgs: number; tools: number; edits: number; lw: number; ld: number; min: number; act: Record<'think' | 'read' | 'write' | 'run' | 'input' | 'wait', number>; repMin: number }
/** A subagent of this session, followed live; removed from the panel by the user once it ended. */
export type LiveAgent = {
  id: string
  type: string
  desc: string
  model: string
  fam: string
  status: 'running' | 'done' | 'failed'
  start: number
  end?: number
  cost: number
  steps: number
  /** typical minutes and dollars of one run of this type (7-day history), the yardstick of progress, ETA and efficiency */
  expMin: number
  expCost: number
  /** false when no history existed and the yardstick is a rough default */
  known: boolean
}
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
    'crab-ledger': { report: Report | null; note: string; live: LiveAgent[]; now: number }
  }
}

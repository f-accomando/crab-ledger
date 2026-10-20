export type Day = {
  day: string
  tok: number
  read: number
  lw: number
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
export type OpState = 'DONE' | 'WORKING' | 'WAITING' | 'IDLE' | 'FREE' | '?'
/** One operator (an AI) of a repo that coordinates through sync/operators.toml, or the table of SYNC.md as a fallback. */
export type Op = {
  /** short id from the registry ("SPV"); absent when read from the table of SYNC.md */
  id?: string
  name: string
  state: OpState
  task: string
  detail: string
  eta: string
  waitingOn?: string
  /** does it wake itself up (timer, scheduler)? as the operator declares it */
  wakeup?: 'yes' | 'no'
  /** ms since epoch of the last Log row of SYNC.md the operator confirmed reading */
  ack?: number
  /** Log rows of SYNC.md written by others after its ack; undefined when it declares no ack */
  unread?: number
  /** 0-100 as the operator reports it */
  progress?: number
  /** how the state was read: its own header block, its older free text, or the table of SYNC.md */
  source: 'block' | 'text' | 'table'
  fileState?: OpState
  fileTask?: string
  /** ms since epoch of the last update the operator wrote */
  updated?: number
  /** WORKING or WAITING past its declared ETA (no ETA: not updated for 60 minutes); the tag stays as declared */
  overdue: boolean
  /** the table and the operator's own file disagree (only when the operator has no header block) */
  clash: boolean
}
/** What the "Operators day by day" strip shows: measured from git (lines, WORKING time) and from the operators' task records. */
export type Team = {
  ops: { id: string; name: string }[]
  /** the last 3 days with data, oldest first (the latest at the bottom, as in Day by day) */
  days: string[]
  /** "YYYY-MM-DD|ID" -> [added, deleted] */
  lines: Record<string, [number, number]>
  /** "YYYY-MM-DD|ID" -> minutes in state WORKING */
  work: Record<string, number>
  /** "YYYY-MM-DD|ID" -> tasks closed */
  tasks: Record<string, number>
  /** "YYYY-MM-DD|ID" -> what the operator declared when closing work orders (ledger schema 1): tokens, minutes, weighted lines */
  led: Record<string, { n: number; tok: number; min: number; lw: number }>
  /** every day with tracked time, for the baseline of the efficiency */
  all: string[]
}
export type Reread = { path: string; reads: number; rereads: number; cost: number; tok: number }
export type Report = {
  at: number
  days: Day[]
  rereads: Reread[]
  week: { cost: number; tok: number; read: number; lw: number; min: number; lines: number; eff: number; baseDays: number; provisional: boolean; trend: { pct: number; recent: number; before: number } | null; est: boolean; pend: number }
  scanned: number
  mix: { in: number; out: number; cw: number; cr: number; agent: number; ctxAvg: number; fam: Record<string, number>; rereadAll: number }
  agents: AgentRow[]
  repeated: { key: string; n: number; min: number; files: number }[]
  tips: { kind: string; save: number; title: string; why: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'crab-ledger': { report: Report | null; note: string; live: LiveAgent[]; now: number; ops: { ops: Op[]; chain: string; team: Team | null } }
  }
}

import { test, expect } from 'claude-code/testing'
import { effOf, globRe, isoMs, parseBlock, parseFile, parseOps, parseToml, plain, workMinutes } from '../hooks/ops'

const SYNC = `| Agente | Stato | Dettaglio | ETA |
|---|---|---|---|
| **Claude cloud** | \`WAITING Claude local\` | manca il record.py | - |
| **Antigravity** | \`WORKING AGY-08\` | bozza | 45 min |
| **utente** | \`WORKING nulla\` | decisioni | - |

Catena che blocca i video: 1 -> 2
`
const stamp = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

test('without a registry the table rows are read, a silent WORKING operator counts as IDLE and a clash is flagged; utente is not an operator', async () => {
  const now = new Date(2026, 9, 14, 12, 0).getTime()
  const files = {
    CLD: `**Ultimo aggiornamento:** ${stamp(new Date(now - 5 * 60_000))}\n**Stato:** \`WORKING video 4\``,
    AGY: `> **Aggiorna "Ultimo aggiornamento" ogni 15 min**\n\n**Ultimo aggiornamento:** ${stamp(new Date(now - 3 * 3_600_000))}\n**Stato:** \`WORKING AGY-08\``,
  }
  const { ops, chain } = parseOps(SYNC, files, now)
  expect(ops.map(o => o.name)).toEqual(['Claude Cloud', 'Antigravity'])
  expect(ops[0]!.clash).toBe(true)
  expect(ops[0]!.silent).toBe(false)
  expect(ops[1]!.silent).toBe(true)
  expect(chain).toMatch(/^Catena/)
})

test('no table and no registry, no operators', async () => {
  expect(parseOps('# nothing here', {}, 0).ops).toEqual([])
})

const TOML = `schema = 1
# comment
[[operator]]
id = "SPV"
name = "Claude local"
kind = "ai"
file = "sync/SPV.md"
branches = ["feat/claude-video3d"]
cost = "measured"

[[operator]]
id = "AGY"
name = "Antigravity"
kind = "ai"
file = "sync/AGY.md"
ledger = "sync/AGY.ledger.jsonl"
branches = ["feat/antigravity-*", "agy/*"]   # globs
cost = "none"          # no dollars

[[operator]]
id = "UTE"
name = "utente"
kind = "human"
`

test('the registry is read and the glob of a branch matches', async () => {
  const reg = parseToml(TOML)
  expect(reg.map(r => r.id)).toEqual(['SPV', 'AGY', 'UTE'])
  expect(reg[1]!.branches).toEqual(['feat/antigravity-*', 'agy/*'])
  expect(reg[1]!.cost).toBe('none')
  expect(globRe('feat/antigravity-*').test('feat/antigravity-map3d')).toBe(true)
  expect(globRe('agy/*').test('agy/sdk-720')).toBe(true)
  expect(globRe('agy/*').test('feat/agy/x')).toBe(false)
})

test('the header block is the truth, times are compared as instants and humans are left out', async () => {
  const now = Date.parse('2026-10-14T12:30:00+02:00')
  const spv = `---\nschema: 1\nid: SPV\nstate: WAITING\ntask: review\nwaiting_on: utente\nprogress: 60\neta: 2026-10-14T13:00+02:00\nupdated: 2026-10-14T12:20+02:00\n---\n# SPV\n`
  const agy = `---\nid: AGY\nstate: WORKING\ntask: AGY-09\nupdated: 2026-10-14T09:00:00Z\n---\n`
  expect(parseBlock(spv)?.waiting_on).toBe('utente')
  expect(isoMs('2026-10-14T12:20+02:00')).toBe(Date.parse('2026-10-14T10:20:00Z'))
  expect(parseFile(spv)?.progress).toBe(60)
  const { ops } = parseOps(SYNC, { SPV: spv, AGY: agy }, now, parseToml(TOML))
  expect(ops.map(o => o.id)).toEqual(['SPV', 'AGY'])
  expect(ops[0]!.source).toBe('block')
  expect(ops[0]!.waitingOn).toBe('utente')
  expect(ops[0]!.silent).toBe(false)
  // AGY says WORKING since 09:00Z = 11:00 in Rome: 90 minutes of silence
  expect(ops[1]!.silent).toBe(true)
})

test('WORKING time is counted per day and one stretch is cut at the silence limit', async () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 14, h, m).getTime()
  const w = workMinutes([{ at: t(9), state: 'WORKING' }, { at: t(9, 20), state: 'WAITING' }, { at: t(10), state: 'WORKING' }, { at: t(14), state: 'DONE' }], t(15))
  expect(Math.round(w['2026-10-14']!)).toBe(20 + 60)
})

test('efficiency: writers by lines per hour, the others by tasks per hour, 100 = own median, 3 days needed', async () => {
  const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`
  const team = {
    ops: [{ id: 'SPV', name: 'Claude local' }],
    days: [day(14)],
    lines: { [`${day(12)}|SPV`]: [500, 100], [`${day(13)}|SPV`]: [1000, 200], [`${day(14)}|SPV`]: [2000, 400], [`${day(15)}|SPV`]: [10, 5] } as Record<string, [number, number]>,
    work: { [`${day(12)}|SPV`]: 120, [`${day(13)}|SPV`]: 120, [`${day(14)}|SPV`]: 120, [`${day(15)}|SPV`]: 120 },
    tasks: { [`${day(15)}|SPV`]: 3 },
    all: [day(12), day(13), day(14), day(15)],
  }
  // writer days: 300, 600, 1200 lines/h -> median 600
  expect(effOf(team, 'SPV', day(13))).toBe(100)
  expect(effOf(team, 'SPV', day(14))).toBe(200)
  // the day under 200 lines is not a writer day: only one such day, no baseline
  expect(effOf(team, 'SPV', day(15))).toBe(0)
})

test('with an ETA, IDLE starts 10 minutes after it; FREE and DONE are never silent', async () => {
  const mk = (state: string, eta: string, updated: string) => `---\nid: SPV\nstate: ${state}\ntask: x\neta: ${eta}\nupdated: ${updated}\n---\n`
  const reg = parseToml('[[operator]]\nid = "SPV"\nname = "Claude local"\nkind = "ai"\nfile = "sync/SPV.md"\n')
  const at = (iso: string) => Date.parse(iso)
  const silent = (state: string, eta: string, upd: string, now: string) => parseOps('', { SPV: mk(state, eta, upd) }, at(now), reg).ops[0]!.silent
  expect(silent('WORKING', '2026-10-15T12:00+02:00', '2026-10-15T10:00+02:00', '2026-10-15T12:09+02:00')).toBe(false)
  expect(silent('WORKING', '2026-10-15T12:00+02:00', '2026-10-15T10:00+02:00', '2026-10-15T12:11+02:00')).toBe(true)
  expect(silent('WAITING', '2026-10-15T12:00+02:00', '2026-10-15T10:00+02:00', '2026-10-15T12:11+02:00')).toBe(true)
  expect(silent('FREE', '', '2026-10-15T08:00+02:00', '2026-10-15T20:00+02:00')).toBe(false)
  expect(silent('DONE', '', '2026-10-15T08:00+02:00', '2026-10-15T20:00+02:00')).toBe(false)
  expect(silent('WORKING', '', '2026-10-15T10:00+02:00', '2026-10-15T11:10+02:00')).toBe(true)
})

test('a template placeholder is shown as plain text', async () => {
  expect(plain('{supervisor}')).toBe('Supervisor')
  expect(plain('{da handshake}')).toBe('Da handshake')
  expect(plain('Claude local')).toBe('Claude local')
  const toml = ['[[operator]]', 'id = "SPV"', 'name = "{supervisor}"', 'kind = "ai"'].join('\n')
  expect(parseToml(toml)[0]!.name).toBe('Supervisor')
})

test('wakeup and ack are read, and the unread rows of the Log are counted (not the operator\'s own)', async () => {
  const log = [
    '| Timestamp | Operatore | Branch | Azione | Messaggio |',
    '|---|---|---|---|---|',
    '| 2026-10-15T10:00+02:00 | SPV | `x` | `INIT` | a |',
    '| 2026-10-15T12:00+02:00 | AGY | `x` | `REVIEW: APPROVED` | b |',
    '| 2026-10-15T13:00+02:00 | SPV | `x` | `RULE` | c |',
    '| 2026-10-15T14:00+02:00 | SPV | `x` | `RULE` | d |',
  ].join('\n')
  const f = (ack: string) => `---\nid: AGY\nstate: FREE\nwakeup: no\nack: ${ack}\nupdated: 2026-10-15T14:05+02:00\n---\n`
  const reg = parseToml('[[operator]]\nid = "AGY"\nname = "Antigravity"\nkind = "ai"\nfile = "sync/AGY.md"\n')
  const op = (ack: string) => parseOps(log, { AGY: f(ack) }, Date.parse('2026-10-15T15:00+02:00'), reg).ops[0]!
  expect(op('2026-10-15T12:30+02:00').wakeup).toBe('no')
  expect(op('2026-10-15T12:30+02:00').unread).toBe(2)
  expect(op('2026-10-15T14:00+02:00').unread).toBe(0)
  expect(op('').unread).toBeUndefined()
})

import { test, expect } from 'claude-code/testing'
import { parseOps } from '../hooks/ops'

const SYNC = `| Agente | Stato | Dettaglio | ETA |
|---|---|---|---|
| **Claude cloud** | \`WAITING Claude local\` | manca il record.py | - |
| **Antigravity** | \`WORKING AGY-08\` | bozza | 45 min |
| **utente** | \`WORKING nulla\` | decisioni | - |

Catena che blocca i video: 1 -> 2
`
const stamp = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

test('SYNC.md rows are read, a silent WORKING operator counts as IDLE and a clash is flagged', async () => {
  const now = new Date(2026, 9, 14, 12, 0).getTime()
  const files = {
    CLD: `**Ultimo aggiornamento:** ${stamp(new Date(now - 5 * 60_000))}\n**Stato:** \`WORKING video 4\``,
    AGY: `> **Aggiorna "Ultimo aggiornamento" ogni 15 min**\n\n**Ultimo aggiornamento:** ${stamp(new Date(now - 3 * 3_600_000))}\n**Stato:** \`WORKING AGY-08\``,
  }
  const { ops, chain } = parseOps(SYNC, files, now)
  expect(ops.map(o => o.name)).toEqual(['Claude cloud', 'Antigravity', 'utente'])
  expect(ops[0]!.clash).toBe(true)
  expect(ops[0]!.silent).toBe(false)
  expect(ops[1]!.silent).toBe(true)
  expect(ops[2]!.updated).toBeUndefined()
  expect(chain).toMatch(/^Catena/)
})

test('no SYNC.md table, no operators', async () => {
  expect(parseOps('# nothing here', {}, 0).ops).toEqual([])
})

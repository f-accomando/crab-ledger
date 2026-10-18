import { test, expect } from 'claude-code/testing'
import { parseStatus, stampAge, statusSvg } from '../hooks/status'
import { looksOf } from '../hooks/ops'

const FENCE = String.fromCharCode(96).repeat(3)
const PAGE = [
  '# bm sync status',
  '## Status',
  FENCE,
  '2026-10-18 11:15   next update 11:30   (branch sync/x, Log rows 128)',
  FENCE,
  '## Operators',
  FENCE,
  'NET  WORKING  age 33m            D09-2a',
  '     queue: D09-2a, D09-2b',
  '     awaiting review: D09-5b 7521d3b3, D09-5c 6ffc4ded',
  'SPV  DONE     age 14h21m         review AGY-1..5',
  FENCE,
  '## WOs not assigned (3)',
  FENCE,
  'CO-7, D09-1e, W15b',
  FENCE,
  '## Reviews',
  FENCE,
  'awaiting (2): D09-5b 7521d3b3 (NET), D09-5c 6ffc4ded (NET)',
  'recent: 18 11:05 OK  w09e, 18 10:50 CHG w17b',
  'legacy, delivered before 17 Oct with no REVIEW row matched (2): R-NET5, NET-KEYS',
  FENCE,
  '## Requests for the user',
  FENCE,
  'CI:73 - BLOCKED W15a: no Mesa build in WSL',
  FENCE,
  '## Beta progress',
  FENCE,
  'Assumption: Beta scope = all WO files.',
  '[############--------] 59%  done 92 / 156  review 9  assigned 22  unassigned 33',
  'D09    [----------] 5% 2/43  rev 5 asg 6 una 30',
  'API    [##########] 100% 1/1  rev 0 asg 0 una 0',
  FENCE,
].join(String.fromCharCode(10))

test('the status page is parsed into operators, reviews, requests and progress', async () => {
  const s = parseStatus(PAGE)!
  expect(s.stamp).toBe('2026-10-18 11:15')
  expect(s.next).toBe('11:30')
  expect(s.ops.map(o => o.id)).toEqual(['NET', 'SPV'])
  expect(s.ops[0]!.queue).toEqual(['D09-2a', 'D09-2b'])
  expect(s.ops[0]!.review[1]!.sha).toBe('6ffc4ded')
  expect(s.ops[1]!.age).toBe('14h21m')
  expect(s.unassigned.length).toBe(3)
  expect(s.awaiting[0]!.op).toBe('NET')
  expect(s.recent[1]!.verdict).toBe('CHG')
  expect(s.legacy).toEqual(['R-NET5', 'NET-KEYS'])
  expect(s.requests.length).toBe(1)
  expect(s.total!.pct).toBe(59)
  expect(s.areas.map(a => a.name)).toEqual(['D09', 'API'])
  expect(parseStatus('nothing here')).toBe(null)
})

test('the status drawing holds every section and flags an old page', async () => {
  const s = parseStatus(PAGE)!
  const now = new Date(2026, 9, 18, 13, 0).getTime()
  expect(stampAge(s.stamp, now)).toBe(105)
  const { svg, h } = statusSvg(400, s, looksOf(['NET', 'SPV']), now)
  expect(h > 200).toBe(true)
  for (const word of ['Needs you', 'Operators', 'Reviews', 'Progress by area', 'Not assigned', 'old']) expect(svg).toContain(word)
})

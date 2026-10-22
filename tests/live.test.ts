import { test, expect } from 'claude-code/testing'
import { costumeOf, crab } from '../hooks/live'

test('bm-runner has its own costume', async () => {
  expect(costumeOf('bm-runner')).toBe('runner')
  expect(costumeOf('bm-mechanic')).toBe('mechanic')
  expect(crab(0, 0, 'runner', '#5B8DEF', false)).not.toBe(crab(0, 0, 'other', '#5B8DEF', false))
})

test('the costumes ported from savvy-progress are picked by name and each differs from the plain crab', async () => {
  const pick: Record<string, string> = { 'savvy-fable': 'astronaut', 'savvy-heavy': 'detective', 'savvy-careful': 'engineer', 'savvy-medium': 'chef', 'savvy-light': 'racer', Explore: 'pirate', 'bm-ops': 'ninja', 'bm-research': 'research', 'bm-light': 'light', standard: 'chef' }
  for (const [type, costume] of Object.entries(pick)) expect(costumeOf(type)).toBe(costume)
  for (const c of ['astronaut', 'detective', 'engineer', 'chef', 'racer', 'pirate', 'ninja']) {
    expect(crab(0, 0, c, '#D85A30', true)).not.toBe(crab(0, 0, 'other', '#D85A30', true))
    expect(crab(0, 0, c, '#D85A30', true)).toContain('c-' + c)
  }
})

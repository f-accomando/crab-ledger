import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LiveAgent, Op, Report } from '../types'
import { OP_H, fileOf, opSvg, parseOps, stateColor } from './ops'
import { CRAB_H, CRAB_W, LIVE_H, costOf, crabSvg, famOf, leftText, liveSvg, stats, typical } from './live'
import { agentsHeight, agentsSvg, daysSvg, dur, headerSvg, moodOf, num, repeatedSvg, rereadSvg, usd, weekSvg } from './draw'

const PANE = 'crab-ledger'
const report = atom({ plugin: 'crab-ledger', key: 'report' } as const, null)
const note = atom({ plugin: 'crab-ledger', key: 'note' } as const, 'loading…')
const live = atom({ plugin: 'crab-ledger', key: 'live' } as const, [] as LiveAgent[])
const opsAtom = atom({ plugin: 'crab-ledger', key: 'ops' } as const, { ops: [] as Op[], chain: '' })
const nowAt = atom({ plugin: 'crab-ledger', key: 'now' } as const, 0)


// The crab on the status line: claws open and shut, the face follows the trend.
const crab = (r: Report | null, frame: number) => {
  const t = r?.week.trend
  const face = !t ? '-,,-' : t.pct >= 3 ? '^,,^' : t.pct <= -3 ? ';,,;' : '°,,°'
  const claws = frame % 2 === 0 ? ['V', 'V'] : ['v', 'v']
  return `${claws[0]}(${face})${claws[1]}`
}
const statusText = (r: Report | null, frame: number) => {
  if (!r) return `${crab(r, frame)} ledger…`
  const today = r.days[r.days.length - 1]
  const t = r.week.trend
  const arrow = !t ? '' : t.pct >= 3 ? ` ▲${t.pct.toFixed(0)}%` : t.pct <= -3 ? ` ▼${Math.abs(t.pct).toFixed(0)}%` : ' ▬'
  return `${crab(r, frame)}${arrow} ${usd(today.cost)} · ${dur(today.min)} today · 7d ${usd(r.week.cost)}`
}

// Operators: SYNC.md of the repo's remote default branch, read through git (a fetch at most every 5 minutes).
let opsBusy = false
let lastFetch = 0
async function refreshOps($: any) {
  if (opsBusy) return
  opsBusy = true
  try {
    const git = async (args: string[], timeoutMs = 20000) => {
      const r = await $.process.run(['git', ...args], { timeoutMs })
      return r.exitCode === 0 ? (r.stdout as string) : null
    }
    const at = await $.clock.now()
    if ((await git(['rev-parse', '--git-dir'])) === null) return void (await update($, opsAtom, () => ({ ops: [], chain: '' })))
    if (at - lastFetch > 300_000) {
      lastFetch = at
      await git(['fetch', '-q', 'origin'], 40000)
    }
    const sync = await git(['show', 'origin/HEAD:SYNC.md'])
    if (sync === null) return void (await update($, opsAtom, () => ({ ops: [], chain: '' })))
    const files: Record<string, string> = {}
    for (const n of ['SPV', 'CLD', 'AGY']) {
      const t = await git(['show', `origin/HEAD:sync/${n}.md`])
      if (t !== null) files[n] = t
    }
    const parsed = parseOps(sync, files, at)
    await update($, opsAtom, () => parsed)
  } catch {
    /* no repo, no network: the section stays as it was */
  } finally {
    opsBusy = false
  }
}

let busy = false
let frame = 0
let lastKey = ''
let current: Report | null = null

async function refresh($: any) {
  if (busy) return
  busy = true
  try {
    const run = await $.process.run(['node', `${$.plugin.root}/hooks/aggregate.mjs`], { timeoutMs: 600000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.slice(0, 200))
    current = JSON.parse(run.stdout) as Report
    // Redraw the pane only when the numbers changed: a new `at` alone is no reason to repaint.
    const key = JSON.stringify([current.days, current.rereads, current.week, current.mix, current.tips])
    if (key !== lastKey) {
      lastKey = key
      const stamp = new Date(current.at).toTimeString().slice(0, 5)
      const fresh = current
      await update($, report, () => fresh)
      await update($, note, () => `updated ${stamp}`)
    }
    $.ui.status(statusText(current, frame))
  } catch (err) {
    await update($, note, () => `error: ${String((err as Error).message ?? err).slice(0, 120)}`)
  } finally {
    busy = false
  }
}

export const register: Register = (on, options) => {
  const wantSubagents = options?.showSubagents !== false
  const wantOperators = options?.showOperators !== false
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ledger',
      description: 'Open the crab ledger: tokens, time, git lines, cost and efficiency per day',
    })
    void $.ui.open({ id: PANE, title: 'Crab ledger' })
    void refresh($)
    if (wantOperators) void refreshOps($)
    $.clock.every(90_000, () => {
      void refresh($)
      if (wantOperators) void refreshOps($)
    })
    $.clock.every(2_000, async () => {
      if ((await read($, live)).some(a => a.status === 'running')) {
        const at = await $.clock.now()
        await update($, nowAt, () => at)
      }
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)
    if (!e.agentId && wantOperators) void refreshOps($)
    if (e.agentId) {
      const at = await $.clock.now()
      await update($, live, list => list.map(a => (a.id !== e.agentId ? a : { ...a, status: e.reason === 'answer' ? 'done' : 'failed', end: at })))
      await update($, nowAt, () => at)
    }

    return next(e)
  })

  // Subagents, followed live: the card shows progress, ETA and efficiency against the typical run of the same type.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || !started.agentId) return started
    const at = await $.clock.now()
    const model = String(started.model ?? '')
    const fam = famOf(model)
    const t = typical(current?.agents, e.subagentType, fam)
    const run: LiveAgent = { id: started.agentId, type: e.subagentType, desc: e.description ?? '', model, fam, status: 'running', start: at, cost: 0, steps: 0, expMin: t.min, expCost: t.cost, known: t.known }
    await update($, live, list => [...list.filter(a => a.id !== run.id), run].slice(-30))
    await update($, nowAt, () => at)

    return started
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (!e.agentId || !u) return result
    const model = u.model || e.model || ''
    await update($, live, list => list.map(a => (a.id !== e.agentId ? a : { ...a, status: 'running', end: undefined, model, fam: famOf(model), steps: a.steps + 1, cost: a.cost + costOf(model, u) })))

    return result
  })

  on('command.run', { command: 'ledger' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Crab ledger' })
    void refresh($)

    return { text: 'Crab ledger opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const r = await read($, report)
    const msg = await read($, note)

    if (!r) {
      return (
        <Box flexDirection="column">
          <Text bold>{crab(null, 0)} Crab ledger</Text>
          <Text dimColor>{msg}</Text>
        </Box>
      )
    }

    const mood = moodOf(r)
    const t = r.week.trend
    const verdict = !t
      ? 'not enough history yet'
      : mood === 'up'
        ? `improving ▲ +${t.pct.toFixed(0)}%`
        : mood === 'down'
          ? `worsening ▼ ${t.pct.toFixed(0)}%`
          : `steady ▬ ${t.pct.toFixed(0)}%`
    const tColor = mood === 'up' ? 'green' : mood === 'down' ? 'red' : 'yellow'
    const rows = e.viewport?.rows ?? 40
    let W0 = 300
    const agentsLive = await read($, live)
    const at = Math.max(await read($, nowAt), ...agentsLive.map(a => a.start), 0)
    const opsData = await read($, opsAtom)
    const opsBlock = (Svg: any) =>
      !wantOperators || opsData.ops.length === 0 ? null : (
        <Box flexDirection="column">
          <Text bold>Operators <Text dimColor>(SYNC.md · bar = time since last update, empty at 60 min)</Text></Text>
          {opsData.ops.map(o =>
            Svg ? (
              <Svg key={`o${o.name}`} source={opSvg(W0, o, at)} alt={`${o.name}: ${o.silent ? 'IDLE (silent)' : o.state}`} width={W0} height={OP_H} />
            ) : (
              <Text key={`o${o.name}`}>
                <Text color={stateColor(o) === '#D0453F' ? 'red' : o.state === 'WORKING' ? 'blue' : o.state === 'DONE' ? 'green' : 'yellow'}>●</Text> {o.name} <Text bold>{o.silent ? 'IDLE (silent)' : o.state}</Text> <Text dimColor>{o.task || o.detail}{o.clash ? ` · ⚠ file says ${o.fileState}` : ''}</Text>
              </Text>
            ),
          )}
        </Box>
      )
    const dismiss = (id: string) => update($, live, list => list.filter(a => a.id !== id))
    const closeBtn = (a: LiveAgent) => <Button key={`x${a.id}`} label="close" plain onPress={() => dismiss(a.id)} />
    const liveBlock = (W: number | null, Svg: any) =>
      !wantSubagents || agentsLive.length === 0 ? null : (
        <Box flexDirection="column">
          <Text bold>Subagents <Text dimColor>(bar = task progress vs a typical run · thin = efficiency, 100 = typical)</Text></Text>
          {agentsLive.map(a => {
            const st = stats(a, at)
            return (
              <Box key={a.id} flexDirection="column">
                {Svg ? (
                  <Box flexDirection="row">
                    <Box flexDirection="column">
                      <Svg key={`c${a.id}`} source={crabSvg(a)} alt={a.type} width={CRAB_W} height={CRAB_H} />
                      {a.status !== 'running' && closeBtn(a)}
                    </Box>
                    <Svg key={`l${a.id}`} source={liveSvg((W ?? 300) - CRAB_W, a, at)} alt={`${a.desc || a.type}: ${a.status}, efficiency ${Math.round(st.eff)}${a.status !== 'running' ? `, grade ${st.grade}` : ''}`} width={(W ?? 300) - CRAB_W} height={LIVE_H} />
                  </Box>
                ) : (
                  <Text>
                    <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : 'yellow'}>{a.status === 'running' ? '▣' : a.status === 'done' ? '✓' : '✗'}</Text> {a.desc || a.type}{' '}
                    <Text dimColor>
                      {'█'.repeat(Math.round(st.p * 10)).padEnd(10, '░')} {Math.round(st.p * 100)}% · {leftText(a, st)} · {a.type.replace(/^[^:]*:/, '')}·{a.fam} · eff {st.eff > 0 ? Math.round(st.eff) : '–'}
                      {a.status !== 'running' ? ` · ≈${st.grade}` : ''}
                    </Text>
                  </Text>
                )}
                {!Svg && a.status !== 'running' && closeBtn(a)}
              </Box>
            )
          })}
        </Box>
      )

    const tips = (
      <Box flexDirection="column">
        <Text bold>What to optimize <Text dimColor>(weekly estimate)</Text></Text>
        {r.tips.length === 0 && <Text dimColor>Nothing obvious: keep going.</Text>}
        {r.tips.map((tip, i) => (
          <Box key={tip.kind} flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>
                {i + 1}. {tip.title}
              </Text>{' '}
              <Text color="green" bold>
                ≈ −{usd(tip.save)}
              </Text>
            </Text>
            <Text dimColor>{tip.why}</Text>
          </Box>
        ))}
      </Box>
    )

    if ('Svg' in ui) {
      const { Svg } = ui as unknown as { Svg: (p: { source: string; alt: string; width?: number; height?: number }) => unknown }
      const W = Math.max(260, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      W0 = W
      const count = Math.max(5, Math.min(14, Math.floor((rows - 14) / 3)))
      const draw = (key: string, source: string, alt: string, height: number) => (
        <Svg key={key} source={source} alt={alt} width={W} height={height} />
      )

      return (
        <Box flexDirection="column" gap={1}>
          {draw('head', headerSvg(W, r), `Efficiency ${Math.round(r.week.eff)}: ${verdict}`, 156)}
          {draw('week', weekSvg(W, r), `Last 7 days: ${usd(r.week.cost)}, ${num(r.week.tok)} tokens, ${dur(r.week.min)}`, 146)}
          {liveBlock(W, Svg)}
          {opsBlock(Svg)}
          <Text bold>Day by day <Text dimColor>(bar = efficiency, number = cost)</Text></Text>
          {draw('days', daysSvg(W, r, count), 'Efficiency per day', 30 + Math.min(count, r.days.length) * 34)}
          <Text bold>Agents by type and model <Text dimColor>(7 days)</Text></Text>
          {r.agents.length === 0 ? <Text dimColor>none</Text> : draw('ag', agentsSvg(W, r), 'Agents by type and model', agentsHeight(r.agents.length))}
          <Text bold>Repeated tasks <Text dimColor>(3+ times in 7 days, time waited)</Text></Text>
          {r.repeated.length === 0 ? <Text dimColor>none</Text> : draw('rt', repeatedSvg(W, r), 'Repeated tasks', Math.max(20, Math.min(5, r.repeated.length) * 34 + 4))}
          <Text bold>Most re-read files <Text dimColor>(7 days, estimated cost)</Text></Text>
          {r.rereads.length === 0 ? <Text dimColor>none</Text> : draw('re', rereadSvg(W, r), 'Most re-read files', Math.max(20, Math.min(6, r.rereads.length) * 36 + 4))}
          {tips}
          <Text dimColor>{msg} · list prices per model; git ignores changes over 3000 lines per file.</Text>
        </Box>
      )
    }

    // Terminal: the same content in blocks.
    const cols = Math.max(32, Math.min(64, e.viewport?.columns ?? 44))
    const top = Math.max(...r.days.map(d => d.cost), 0.01)
    const barW = Math.max(8, cols - 22)
    const bar = (x: number) => '█'.repeat(Math.round((Math.log1p(x) / Math.log1p(top)) * barW)).padEnd(barW, '░') // log scale: small days stay visible
    return (
      <Box flexDirection="column">
        <Text bold>
          {crab(r, 0)} Crab ledger <Text dimColor>{msg}</Text>
        </Text>
        <Text>
          Efficiency{' '}
          <Text bold color={tColor}>
            {Math.round(r.week.eff)} pt · {verdict}
          </Text>
        </Text>
        <Text>
          7g: {usd(r.week.cost)} · {num(r.week.tok)} tok · {dur(r.week.min)}
        </Text>
        <Text> </Text>
        {liveBlock(null, null)}
        {opsBlock(null)}
        {wantSubagents && agentsLive.length > 0 && <Text> </Text>}
        {r.days.slice(-Math.max(5, Math.min(14, Math.floor((rows - 22) / 2)))).map(d => (
          <Box key={d.day} flexDirection="column">
            <Text>
              <Text dimColor>{d.day.slice(5)} </Text>
              <Text color={d.lines === 0 ? undefined : d.eff >= 100 ? 'green' : 'yellow'}>{bar(d.cost)}</Text> {usd(d.cost)}
            </Text>
            <Text dimColor>
              {'      '}
              {num(d.tok)} tok · {dur(d.min)} · +{num(d.add)}/−{num(d.del)} · e{d.eff > 0 ? Math.round(d.eff) : '–'}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Text bold>Agents <Text dimColor>(7 days)</Text></Text>
        {r.agents.slice(0, 6).map(a => (
          <Text key={`${a.type}|${a.fam}`}>
            <Text color="yellow">{usd(a.cost)}</Text> {a.type === 'main' ? 'main' : a.type}·{a.fam}{' '}
            <Text dimColor>
              {a.runs}× · {dur(a.min)} · +{num(a.lw)}/−{num(a.ld)} · {Math.round(a.cost > 0 ? a.lw / a.cost : 0)} l/$ · ↻ {Math.round(a.min > 0 ? (a.repMin / a.min) * 100 : 0)}%
            </Text>
          </Text>
        ))}
        <Text> </Text>
        <Text bold>Most re-read files</Text>
        {r.rereads.slice(0, 5).map(f => (
          <Text key={f.path}>
            <Text color="yellow">{usd(f.cost)}</Text> {f.path.slice(-(cols - 24))} <Text dimColor>{f.rereads}×</Text>
          </Text>
        ))}
        <Text> </Text>
        {tips}
      </Box>
    )
  })
}

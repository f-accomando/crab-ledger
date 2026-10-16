import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LiveAgent, Op, OpState, Report, Team } from '../types'
import { OP_H, WRITER_LINES, effOf, globRe, ledgerRows, looksOf, localDay, opSvg, parseFile, parseOps, parseToml, stateColor, teamHeight, teamSvg, workMinutes } from './ops'
import type { Reg } from './ops'
import { CRAB_H, CRAB_W, LIVE_H, costOf, crabSvg, famOf, leftText, liveSvg, stats, typical } from './live'
import { agentsHeight, agentsSvg, daysSvg, dur, headerSvg, moodOf, num, repeatedSvg, rereadSvg, usd, weekSvg } from './draw'

const PANE = 'crab-ledger'
const report = atom({ plugin: 'crab-ledger', key: 'report' } as const, null)
const note = atom({ plugin: 'crab-ledger', key: 'note' } as const, 'loading…')
const live = atom({ plugin: 'crab-ledger', key: 'live' } as const, [] as LiveAgent[])
const opsAtom = atom({ plugin: 'crab-ledger', key: 'ops' } as const, { ops: [] as Op[], chain: '', team: null as Team | null })
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

// Operators: sync/operators.toml, the header blocks of sync/<ID>.md and SYNC.md of the repo's remote default branch, read through git (a fetch at most every 5 minutes).
let opsBusy = false
let lastFetch = 0
let teamKey = ''
let teamCache: Team | null = null
const stateAt = new Map<string, OpState>()
const NOT_CODE = /\.(pdf|png|jpe?g|gif|webp|ico|bmp|mp4|mov|mp3|ogg|wav|zip|gz|7z|woff2?|ttf|bin|img|glb)$/i
const DAYS_BACK = 7

async function readTeam(git: (a: string[], t?: number) => Promise<string | null>, reg: Reg[], sync: string, at: number, ref: string): Promise<Team | null> {
  const ai = reg.filter(r => r.kind !== 'human')
  const heads = (await git(['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/remotes/origin'])) ?? ''
  const key = `${heads}|${localDay(at)}|${ref}`
  if (key === teamKey) return teamCache
  teamKey = key
  const names = heads.split('\n').map(l => l.split(' ')[1] ?? '').filter(Boolean).map(n => n.replace(/^origin\//, ''))
  const since = `--since=${new Date(at - DAYS_BACK * 86_400_000).toISOString()}`
  // lines, by branch: every commit that is on the operator's branches and not yet on the default branch; a commit on several goes to the smallest set
  const sets: Record<string, Set<string>> = {}
  const refsOf: Record<string, string[]> = {}
  for (const o of ai) {
    const res = o.branches.map(globRe)
    refsOf[o.id] = names.filter(n => n !== 'HEAD' && res.some(re => re.test(n))).map(n => `origin/${n}`)
    sets[o.id] = refsOf[o.id]!.length ? new Set(((await git(['rev-list', '--no-merges', since, ...refsOf[o.id]!, '^origin/HEAD'])) ?? '').split('\n').filter(Boolean)) : new Set()
  }
  const owner = new Map<string, string>()
  for (const o of ai) for (const h of sets[o.id]!) if (!owner.has(h) || sets[owner.get(h)!]!.size > sets[o.id]!.size) owner.set(h, o.id)
  const lines: Team['lines'] = {}
  for (const o of ai) {
    if (!refsOf[o.id]!.length) continue
    const out = (await git(['log', '--no-merges', since, '--numstat', '--format=@%H|%aI', ...refsOf[o.id]!, '^origin/HEAD'], 60000)) ?? ''
    let day = ''
    let mine = false
    for (const l of out.split('\n')) {
      if (l.startsWith('@')) {
        const [h, d] = l.slice(1).split('|')
        mine = owner.get(h!) === o.id
        day = localDay(Date.parse(d!))
        continue
      }
      if (!mine) continue
      const [a, del, f] = l.split('\t')
      if (!f || !/^\d+$/.test(a ?? '') || !/^\d+$/.test(del ?? '') || NOT_CODE.test(f) || +a! + +del! > 3000) continue
      const cell = (lines[`${day}|${o.id}`] ??= [0, 0])
      cell[0] += +a!
      cell[1] += +del!
    }
  }
  // time in WORKING: the versions of the operator's file on the default branch
  const work: Team['work'] = {}
  for (const o of ai) {
    if (!o.file) continue
    const log = ((await git(['log', since, '--format=%H|%aI', '--reverse', ref, '--', o.file])) ?? '').split('\n').filter(Boolean).slice(-120)
    const versions: { at: number; state: OpState }[] = []
    for (const l of log) {
      const [h, d] = l.split('|')
      let st = stateAt.get(`${h}|${o.file}`)
      if (!st) {
        const txt = await git(['show', `${h}:${o.file}`])
        st = (txt && parseFile(txt)?.state) || '?'
        stateAt.set(`${h}|${o.file}`, st)
      }
      versions.push({ at: Date.parse(d!), state: st })
    }
    for (const [d, m] of Object.entries(workMinutes(versions, at))) work[`${d}|${o.id}`] = m
  }
  // tasks closed: the operator's .ledger.jsonl, else the Log of SYNC.md (DONE / READY rows whose author names it)
  const tasks: Team['tasks'] = {}
  const led: Team['led'] = {}
  for (const o of ai) {
    // the registry names the ledger; an operator that closes work orders has sync/<ID>.ledger.jsonl even when the registry says nothing
    // sync_hdr.py --close writes sync/OP-<ID>.ledger.jsonl; older setups have sync/<ID>.ledger.jsonl
    let rows: ReturnType<typeof ledgerRows> = []
    for (const p of [o.ledger, `sync/OP-${o.id}.ledger.jsonl`, `sync/${o.id}.ledger.jsonl`]) {
      const jl = p ? await git(['show', `${ref}:${p}`]) : null
      if (jl && (rows = ledgerRows(jl)).length) break
    }
    if (rows.length) {
      for (const r of rows) {
        const k = `${r.day}|${o.id}`
        tasks[k] = (tasks[k] ?? 0) + 1
        if (r.wo) {
          // no commits seen on the operator's branches (none registered, or merged already): the diff it declared stands in for them
          if (!refsOf[o.id]!.length) {
            const cell = (lines[k] ??= [0, 0])
            cell[0] += r.add
            cell[1] += r.del
          }
          const c = (led[k] ??= { n: 0, tok: 0, min: 0, lw: 0 })
          c.n++
          c.tok += r.tok
          c.min += r.min
          c.lw += r.lw
        }
      }
      continue
    }
    const words = o.name.toLowerCase().split(/\s+/)
    for (const l of sync.split('\n')) {
      const c = l.split('|').map(x => x.trim())
      if (c.length < 7 || !/^\d{4}-\d{2}-\d{2}/.test(c[1] ?? '')) continue
      const who = (c[2] ?? '').toLowerCase()
      if (!(who.includes(o.id.toLowerCase()) || words.every(w => who.includes(w))) || !/DONE|READY/.test(c[4] ?? '')) continue
      const k = `${c[1]!.slice(0, 10)}|${o.id}`
      tasks[k] = (tasks[k] ?? 0) + 1
    }
  }
  const dayset = new Set<string>()
  for (const k of [...Object.keys(lines), ...Object.keys(work)]) dayset.add(k.split('|')[0]!)
  const days = [...dayset].sort().slice(-3) // oldest first, the latest day at the bottom, as in Day by day
  const all = [...new Set(Object.keys(work).map(k => k.split('|')[0]!))]
  teamCache = days.length ? { ops: ai.map(o => ({ id: o.id, name: o.name })), days, lines, work, tasks, led, all } : null
  return teamCache
}

async function refreshOps($: any, syncBranch: string) {
  if (opsBusy) return
  opsBusy = true
  try {
    const git = async (args: string[], timeoutMs = 20000) => {
      const r = await $.process.run(['git', ...args], { timeoutMs })
      return r.exitCode === 0 ? (r.stdout as string) : null
    }
    const none = { ops: [] as Op[], chain: '', team: null as Team | null }
    const at = await $.clock.now()
    if ((await git(['rev-parse', '--git-dir'])) === null) return void (await update($, opsAtom, () => none))
    if (at - lastFetch > 300_000) {
      lastFetch = at
      await git(['fetch', '-q', 'origin'], 40000)
    }
    // the branch that holds the sync: the one named in the settings, else the most recently updated origin/sync/* that has a registry, else the default branch
    let ref = 'origin/HEAD'
    if (syncBranch && syncBranch !== 'auto') ref = syncBranch.startsWith('origin/') ? syncBranch : `origin/${syncBranch}`
    else {
      const cands = ((await git(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/remotes/origin/sync/'])) ?? '').split('\n').filter(Boolean)
      for (const c of cands) {
        if ((await git(['cat-file', '-e', `${c}:sync/operators.toml`])) !== null) {
          ref = c
          break
        }
      }
    }
    const toml = await git(['show', `${ref}:sync/operators.toml`])
    const reg = toml ? parseToml(toml) : []
    // an operator with a status file but no registry block yet (SPV has not added it) still takes part: its file and ledger are read
    if (reg.length) {
      const known = new Set(reg.map(r => r.id.toUpperCase()))
      const tree = ((await git(['ls-tree', '--name-only', ref, 'sync/'])) ?? '').split('\n')
      for (const p of tree) {
        const id = /^sync\/([A-Za-z0-9-]{2,12})\.md$/.exec(p.trim())?.[1]
        if (!id || id.startsWith('_') || known.has(id.toUpperCase())) continue
        const txt = await git(['show', `${ref}:${p.trim()}`])
        if (!txt || parseFile(txt)?.source !== 'block') continue
        known.add(id.toUpperCase())
        reg.push({ id, name: id, kind: 'ai', file: p.trim(), ledger: '', branches: [], cost: '' })
      }
    }
    const sync = (await git(['show', `${ref}:SYNC.md`])) ?? ''
    if (!sync && !reg.length) return void (await update($, opsAtom, () => none))
    const files: Record<string, string> = {}
    const wanted = reg.length ? reg.filter(r => r.file).map(r => [r.id, r.file] as const) : (['SPV', 'CLD', 'AGY'] as const).map(n => [n, `sync/${n}.md`] as const)
    for (const [id, f] of wanted) {
      const t = await git(['show', `${ref}:${f}`])
      if (t !== null) files[id] = t
    }
    const parsed = { ...parseOps(sync, files, at, reg), team: reg.length ? await readTeam(git, reg, sync, at, ref) : null }
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
  const syncBranch = String(options?.syncBranch ?? 'auto')
  const autoClose = Math.max(0, Number(options?.autoCloseSeconds ?? 60) || 0) * 1000
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ledger',
      description: 'Open the crab ledger: tokens, time, git lines, cost and efficiency per day',
    })
    void $.ui.open({ id: PANE, title: 'Crab ledger' })
    void refresh($)
    if (wantOperators) void refreshOps($, syncBranch)
    $.clock.every(90_000, () => {
      void refresh($)
      if (wantOperators) void refreshOps($, syncBranch)
    })
    $.clock.every(5_000, async () => {
      const list = await read($, live)
      const at = await $.clock.now()
      // a finished card closes by itself after autoClose ms (0 = never)
      if (autoClose && list.some(a => a.status !== 'running' && a.end !== undefined && at - a.end >= autoClose)) {
        await update($, live, l => l.filter(a => a.status === 'running' || a.end === undefined || at - a.end < autoClose))
      }
      if (list.some(a => a.status === 'running')) await update($, nowAt, () => at)
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)
    if (!e.agentId && wantOperators) void refreshOps($, syncBranch)
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
          <Text bold>Operators <Text dimColor>(sync/ · bar = time since last update, empty at 60 min)</Text></Text>
          {opsData.ops.map(o =>
            Svg ? (
              <Svg key={`o${o.name}`} source={opSvg(W0, o, at, looks[o.id ?? o.name])} alt={`${o.name}: ${o.silent ? 'IDLE' : o.state}`} width={W0} height={OP_H} />
            ) : (
              <Text key={`o${o.name}`}>
                <Text color={stateColor(o) === '#D0453F' ? 'red' : o.state === 'WORKING' ? 'blue' : o.state === 'DONE' ? 'green' : 'yellow'}>●</Text> {o.name} <Text bold>{o.silent ? 'IDLE' : o.state}</Text> <Text dimColor>{o.task || o.detail}{o.state === 'WAITING' && o.waitingOn ? ` · waiting on ${o.waitingOn}` : ''}{o.silent ? ' · silent for over 60 min' : ''}{o.clash ? ` · ⚠ file says ${o.fileState}` : ''}</Text>
              </Text>
            ),
          )}
        </Box>
      )
    const team = wantOperators ? opsData.team : null
    const looks = looksOf(opsData.ops.map(o => o.id ?? o.name))
    const teamBlock = (Svg: any) =>
      !team ? null : (
        <Box flexDirection="column">
          <Text bold>Operators day by day <Text dimColor>(bar = share of lines per operator · eff = lines/h, or tasks/h under {WRITER_LINES} lines)</Text></Text>
          {Svg ? (
            <Svg key="team" source={teamSvg(W0, team, looks)} alt="Operators day by day" width={W0} height={teamHeight(team)} />
          ) : (
            team.days.map(d => (
              <Text key={d}>
                <Text dimColor>{d.slice(5)} </Text>
                {team.ops.map(o => {
                  const l = team.lines[`${d}|${o.id}`] ?? [0, 0]
                  const e = effOf(team, o.id, d)
                  return `${o.id.toLowerCase()} ${l[0] + l[1] >= WRITER_LINES ? `+${l[0]}/−${l[1]} ` : ''}eff ${e > 0 ? e : '–'} · `
                })}
                {num(team.ops.reduce((n, o) => n + (team.lines[`${d}|${o.id}`]?.[0] ?? 0) + (team.lines[`${d}|${o.id}`]?.[1] ?? 0), 0))} lines
              </Text>
            ))
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
      const count0 = Math.max(5, Math.min(14, Math.floor((rows - 14) / 3)))
      const count = team ? Math.min(7, count0) : count0
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
          {teamBlock(Svg)}
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
              {num(d.read)} read · {num(d.out)} out · {dur(d.min)} · +{num(d.add)}/−{num(d.del)} · e{d.eff > 0 ? Math.round(d.eff) : '–'}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        {teamBlock(null)}
        {team && <Text> </Text>}
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

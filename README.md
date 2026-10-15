# crab-ledger

A side pane for Claude Code that shows where your tokens, time and money go, and whether you
are getting more efficient. An animated pixel crab keeps the score.

It reads the session logs Claude Code already writes in `~/.claude/projects` (main sessions and
subagents) and asks `git` for the lines you added and deleted. Nothing leaves your machine.

## What it shows

- **Efficiency**: one number (100 = your typical day) and a verdict: improving, steady or worsening, from your
  last active days against the ones before. It is the geometric mean of weighted lines per million tokens read
  (input + cache write + cache read, so long contexts and re-reading lower it) and weighted lines per active hour.
  A line of code counts 1, of documentation 0.3, of data or config 0.15; PDF, images and other media are not counted.
  A day gets its own score only after 60 active minutes or $50; until then it shows a dash. Messages that a resumed
  or copied session file repeats are counted once. With fewer than 8 scored days the 100 is provisional: the panel
  says how many days it comes from and gives no verdict yet. The crab raises a claw when it improves and sweats when it worsens.
- **Last 7 days** (a proxy for the weekly allowance): cost, tokens, active time, lines, and a bar
  that splits the cost into cache read, cache write, output and input.
- **Subagents** (live, between Last 7 days and Day by day): one card per subagent of the session,
  with a pixel crab in the costume of its role (planner, coder, research, mechanic, light, deep) and
  the color of its model. The big bar is task progress and the estimate of the time left, measured against a typical run
  of the same type and model (your last 7 days); the thin bar is efficiency (cost and time against that typical run,
  log scale, 100 = typical). When the task ends the card shows an approximate final grade (A-F) next to the
  efficiency, and a small `close` under the crab removes it from the panel.
- **Operators** (only in a repo with a `sync/operators.toml` or a `SYNC.md`): the AIs that coordinate through
  `sync/`, read from the remote default branch (`git fetch` at most every 5 minutes, your working tree is not touched).
  One card each: state (`DONE`, `WORKING`, `WAITING`, `IDLE`, `FREE`; who it waits for is on the second line), task, progress, ETA and a bar for the time
  since its last update (empty at 60 minutes). A `WORKING` or `WAITING` operator counts as `IDLE` 10 minutes after its `eta` (60 minutes without update when it has no `eta`); `FREE` and `DONE` never do. People
  (`kind = "human"`) are not shown. See [sync/ convention](#sync-convention).
- **Operators day by day** (up to 3 days, and Day by day drops to 7 days): a bar per day split by operator (share of
  lines, measured from the git branches of the registry) and one line `spv +662/-185 eff 52 · cld ... · 3.2k lines`.
  Efficiency per operator: lines per working hour for a writer (200 lines or more that day), tasks closed per working
  hour for the others (blue); 100 = the operator's own median, and it needs 3 tracked days. Working time is the time in
  `WORKING` in the history of its file (a stretch counts 60 minutes at most).
- **Day by day** (30 days kept): a bar per day on a log scale (efficiency; the dashed tick at 100 is in the middle), green above your average, amber below, grey with
  no commits; tokens, minutes, git lines and the share spent by subagents.
- **Agents by type and model**: per agent, cost (top bar), how its time was spent (middle bar, always
  100% wide so the split is easy to compare) and efficiency (thin bar, log scale, tick = the median
  of its group). Agents that write lines are scored on lines per dollar and per hour (green above the
  tick, amber below); read-only agents (explore, research, planner) on tasks completed per dollar
  (blue). A run that closes with BLOCKED, FAILED x2 or REJECTED does not count as completed.
- **Most re-read files**: reads, re-reads and estimated cost over 7 days.
- **What to optimize**: up to four tips with the estimated weekly saving and the reason (long
  contexts, expensive models for small tasks, cache invalidation, long outputs, re-reads, big
  files read whole, `deep` agents started without a scout, subagents that stop BLOCKED or
  FAILED, an oversized `CLAUDE.md`).
- **Status line**: a small crab with the trend, today's cost and time, and the 7-day cost.

Open it with `/ledger`. On the desktop app it draws SVG graphics; in a terminal it falls back
to block characters.

## Install

```
/plugin install crab-ledger --marketplace f-accomando/crab-ledger
```

Answer `y` to add the marketplace, then pick a scope. (The `/plugin` command is available in a
terminal session, not in the desktop app's Code tab. A mod installed from a terminal at user
scope also loads in the desktop app.) To try it from a clone without installing:

```
claude --plugin-dir /path/to/crab-ledger
```

or set `CLAUDE_CODE_PLUGIN_DIRS` to that path.

## Requirements

`node` and `git` on your `PATH`. The log scan is incremental: it keeps a cache in
`~/.claude/crab-ledger-cache.json` and the last report in `~/.claude/crab-ledger-report.json`.

## How the numbers are made

- **Cost** uses list prices per model family and counts input, output, cache write (1.25x input)
  and cache read (0.1x input). It is an API-equivalent estimate, not your bill.
- **Active time** is the union of the minutes with activity across sessions and subagents (gaps
  over 5 minutes do not count).
- **Git lines** are the non-merge commits of every repository a session ran in, by commit day;
  changes over 3000 lines in one file are ignored as generated.
- **Re-read cost** prices a Read result as one cache write plus a cache read on each later turn.

## Develop

`claude plugin validate .` and `claude plugin test .` from the repository folder. The pane is in
`hooks/register.tsx`, the SVG drawing in `hooks/draw.ts`, the log scan in `hooks/aggregate.mjs`.

## License

MIT, see [LICENSE](LICENSE).

## Settings

Two switches in the plugin's settings (`/config`, plugin options), both on by default: **Show live subagents** and
**Show operators**. Turning one off hides the section (and, for operators, stops the `git fetch`).

## Sync convention

A repo that coordinates several operators can put these files in `sync/` (all optional, the ledger falls back to the
table of `SYNC.md` when they are missing):

- `sync/operators.toml`, written by the supervisor: `[[operator]]` blocks with `id`, `name`, `kind` (`ai` or `human`),
  `file`, `ledger`, `branches` (globs) and `cost` (`measured`, `reported` or `none`).
- `sync/<ID>.md`, written by that operator only: a block at the top, between `---` lines, with `id`, `state`
  (`DONE`, `WORKING`, `WAITING`, `IDLE`, `FREE`), `task`, `waiting_on`, `progress` (0-100), `eta` and `updated`, all
  times in ISO 8601 with a time zone (compared in UTC). The text below the block is free.
- `sync/<ID>.ledger.jsonl`, append only: `{"t":"task","id":"AGY-08","status":"done","at":"..."}` closes a task.
  Without it, the tasks closed are the DONE and READY rows of the Log in `SYNC.md`.

The sync files are read from a branch. With the default setting (**Sync branch** = `auto`) the ledger takes the most
recently updated `origin/sync/*` branch that has a `sync/operators.toml`, and falls back to the default branch of the
repo. Name a branch in the setting to pin it (for example when several projects have a sync branch).

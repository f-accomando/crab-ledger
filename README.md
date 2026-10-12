# crab-ledger

A side pane for Claude Code that shows where your tokens, time and money go, and whether you
are getting more efficient. An animated pixel crab keeps the score.

It reads the session logs Claude Code already writes in `~/.claude/projects` (main sessions and
subagents) and asks `git` for the lines you added and deleted. Nothing leaves your machine.

## What it shows

- **Efficiency**: one number (100 = your typical day, from lines per dollar and lines per hour)
  and a verdict: improving, steady or worsening, from your last active days against the ones
  before. The crab raises a claw when it improves and sweats when it worsens.
- **Last 7 days** (a proxy for the weekly allowance): cost, tokens, active time, lines, and a bar
  that splits the cost into cache read, cache write, output and input.
- **Day by day** (30 days kept): a bar per day, green above your average, amber below, grey with
  no commits; tokens, minutes, git lines and the share spent by subagents.
- **Most re-read files**: reads, re-reads and estimated cost over 7 days.
- **What to optimize**: up to four tips with the estimated weekly saving and the reason (long
  contexts, expensive models for small tasks, cache invalidation, long outputs, re-reads).
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

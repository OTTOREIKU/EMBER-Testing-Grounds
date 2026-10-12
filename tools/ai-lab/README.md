# The AI lab

The tools the computer opponent is measured and proven with. Every behaviour of the computer is a named skill or
weight (`app/src/ai/tactician.ts`, `evaluate.ts`); a change to one is measured in games before it ships, and a change
that should not move play is shown not to.

## Playing games

The players themselves live beside the tests, in `app/tests`, because they load the engine the tests load
(`_engine.mjs`):

| Tool | What it does |
|---|---|
| `app/tests/_squadprobe.mjs` | Random squads (or the community set) on any battlefield and Main Task, played start to end by two computer seats: one line per game, then a tally. The workhorse of every measurement. |
| `app/tests/_policies.mjs` | Reads a policy spec: `tactician`, `veteran`, `brawler`, `recruit`, or `tactician:<skills>:<weights>` with ONE colon between the parts. |
| `app/tests/_samegames.mjs`, `_samesmoke.mjs` | The seeded games behind the eight guard hashes. |
| `app/tests/_hudprint.mjs`, `_moveprint.mjs`, `_launchprint.mjs` (with `_p7d_lib.mjs`) | The three snapshots of what the Match Centre prints. |
| `app/tests/_baseline.mjs`, `_squadmatch.mjs`, `_community.mjs`, `_lossprobe.mjs`, `_dronesets.mjs`, `_droneswaps.mjs`, `_stall8527.mjs` | Narrower probes kept for the questions they answered. |

```
cd app
FOE=tactician node tests/_squadprobe.mjs 1 50 veteran 500 1 > rs-vet-a.out
```

## Proving a change

| Tool | What it does |
|---|---|
| `runall.mjs` | The whole suite, a few files at a time (`PAR`). |
| `guards.sh` | The eight guard hashes. |
| `verify.sh <out> [<baselines>]` | Suite, type check, guards, the three snapshots against a baseline, build. |
| `freeze.sh <dir>` | A frozen copy of the tree to measure on while the repo moves. |
| `specs_check.mjs` | That each policy spec parses, before a run is queued on it. |
| `printdiff.mjs` | Two snapshot prints, compared. |

## Reading a run

Run from the folder that holds the `rs-<tag>-*.out` files:

| Tool | What it does |
|---|---|
| `rs_pair.py <base> <arm>` | An arm against a baseline on the same seeds: wins, games turned each way, a sign test. |
| `rs_time.py <tag>` | Thinking time a game. |
| `duelsum.py <tag> ...` | The subject's wins against its foe, from the runs' closing tallies. |
| `bymission.py <a> <b>` | Two arms by Main Task. |
| `throughown.py`, `throughpair.py` | Shots through one's own Mechs (the `LINES=1` census). |
| `thinkstats.py` | Each answer's thinking time, from a `THINKLOG` file. |
| `cpuprof.py` | A V8 profile (`node --cpu-prof`) by function and module. |

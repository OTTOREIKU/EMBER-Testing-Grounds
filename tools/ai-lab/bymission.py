"""Two arms on the same seeds, by Main Task: bymission.py <tag A> <tag B> (reads rs-<tag>-a.out).

Each line '<seed> [subject sX] <map>/<mission> | ... | over <winner> <vp>' is one game; the subject wins when the winner
is its seat, a level game counts half. For each Main Task (and each family: blackbox, control, terminal, vip) prints the
games both arms played, each arm's wins, and the seeds turned to a win and from one by B against A.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

LINE = re.compile(r'^(\d+) \[subject (s[12])\] \S+?/(\S+) .*\| over (\S+)')


def read(tag):
    out = {}
    for line in Path(f'rs-{tag}-a.out').read_text(encoding='utf-8', errors='replace').splitlines():
        m = LINE.match(line)
        if not m:
            continue
        seed, subject, mission, winner = m.groups()
        score = 1.0 if winner == subject else 0.5 if winner == 'level' else 0.0
        out[seed] = (mission, score)
    return out


a, b = sys.argv[1], sys.argv[2]
A, B = read(a), read(b)
rows = defaultdict(lambda: [0, 0.0, 0.0, 0, 0])
for seed in A.keys() & B.keys():
    mission, sa = A[seed]
    _, sb = B[seed]
    for key in (mission, mission.split('-')[0] + ' (all)'):
        r = rows[key]
        r[0] += 1
        r[1] += sa
        r[2] += sb
        r[3] += 1 if sb > sa else 0
        r[4] += 1 if sb < sa else 0
print(f'{"Main Task":34} games  {a:>6} {b:>6}  up  down')
for key in sorted(rows, key=lambda k: (k.split('-')[0].split(' ')[0], ' (all)' not in k, k)):
    g, sa, sb, up, down = rows[key]
    print(f'{key:34} {g:5}  {sa:6.1f} {sb:6.1f}  {up:3} {down:4}')

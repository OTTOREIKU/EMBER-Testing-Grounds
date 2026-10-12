"""Random squads paired: an arm against a baseline on the same seeds (files rs-<prefix>-<a..d>.out).
   python rs_pair.py <baseline prefix> <arm prefix> [<arm prefix> ...]
Each line '<seed> [subject sX] ... | over <winner> <vp>' is one game; the subject wins when the winner is its seat
(a level game counts half). Prints each arm's total, the seeds turned to a win and from one, and a two-sided
sign test on the turned seeds."""
import math
import re
import sys
from pathlib import Path

# The run's files are read where the reader is run (the measurement's own folder).
HERE = Path.cwd()
LINE = re.compile(r'^(\d+) \[subject (s[12])\].*\| over (\S+)')


def games(prefix):
    out = {}
    for part in 'abcd':
        f = HERE / f'rs-{prefix}-{part}.out'
        if not f.exists():
            continue
        for line in f.read_text(encoding='utf-8', errors='replace').splitlines():
            m = LINE.match(line)
            if not m:
                continue
            seed, seat, winner = int(m.group(1)), m.group(2), m.group(3)
            out[seed] = 1.0 if winner == seat else (0.5 if winner not in ('s1', 's2') else 0.0)
    return out


def sign_p(up, down):
    n = up + down
    if n == 0:
        return 1.0
    k = min(up, down)
    tail = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return min(1.0, 2 * tail)


base = games(sys.argv[1])
wins = lambda g, seeds: sum(1 for s in seeds if g[s] == 1.0)
level = lambda g, seeds: sum(1 for s in seeds if g[s] == 0.5)
print(f'{sys.argv[1]}: won {wins(base, base)} of {len(base)} ({level(base, base)} level)')
for arm in sys.argv[2:]:
    got = games(arm)
    both = sorted(set(base) & set(got))
    up = sum(1 for s in both if got[s] > base[s])
    down = sum(1 for s in both if got[s] < base[s])
    print(f'{arm}: won {wins(got, both)} of {len(both)} ({level(got, both)} level) against {wins(base, both)} ({level(base, both)} level)'
          f'  (turned to a win {up}, from one {down}, the same {len(both) - up - down}; sign test p {sign_p(up, down):.2f})'
          + (f'  [{len(got)} games in the files]' if len(got) != len(both) else ''))

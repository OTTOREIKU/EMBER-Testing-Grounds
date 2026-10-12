"""Each answer's thinking time from _squadprobe THINKLOG files: thinkstats.py <think-x.tsv> ...

Lines: seed, who, seat, kind, options, ms. Per file: answers, games, seconds a game; by question kind the count,
median, 90th and 99th percentile, the longest, and the share of all thinking; then the twelve longest answers.
"""
import sys
from collections import defaultdict
from pathlib import Path


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * (len(xs) - 1) + 0.5))] if xs else 0.0


for f in sys.argv[1:]:
    rows = []
    for line in Path(f).read_text(encoding='utf-8').splitlines():
        p = line.split('\t')
        if len(p) == 6:
            rows.append((p[0], p[1], p[2], p[3], int(p[4]), float(p[5])))
    if not rows:
        print(f'{f}: empty')
        continue
    games = len({r[0] for r in rows})
    total = sum(r[5] for r in rows)
    print(f'\n######## {f}: {len(rows)} answers, {games} games, {total / 1000:.1f} s thinking, {total / 1000 / games:.1f} s a game, '
          f'{len(rows) / games:.0f} answers a game; all answers median {q([r[5] for r in rows], .5):.1f} ms, '
          f'90% {q([r[5] for r in rows], .9):.0f} ms, 99% {q([r[5] for r in rows], .99):.0f} ms, longest {max(r[5] for r in rows):.0f} ms')
    by = defaultdict(list)
    for r in rows:
        by[r[3]].append(r[5])
    print(f'{"kind":28} {"answers":>7} {"median":>8} {"90%":>8} {"99%":>8} {"longest":>8} {"share":>6}')
    for k, xs in sorted(by.items(), key=lambda x: -sum(x[1])):
        print(f'{k[:28]:28} {len(xs):7} {q(xs, .5):8.1f} {q(xs, .9):8.0f} {q(xs, .99):8.0f} {max(xs):8.0f} {100 * sum(xs) / total:5.1f}%')
    print('the twelve longest:')
    for r in sorted(rows, key=lambda r: -r[5])[:12]:
        print(f'  {r[5]:8.0f} ms  seed {r[0]} {r[2]} {r[3]} ({r[4]} options)')

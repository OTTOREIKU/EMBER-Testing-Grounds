"""Two arms on the same seeds, by MARGIN (M23, 2026-10-12): rs_margin.py <baseline tag> <arm tag> [<arm tag> ...]
(reads rs-<tag>-a.out, or the rs-<tag>-q*.out parts while a run is going, in the directory it is run from).

rs_pair.py's sign test counts only the games whose winner changed, and a lever that wins a point here and a Part there
shows only when enough of those tip a game. Here every game counts: for each seed both arms played, the subject's
Victory Point margin (its Victory Points less the foe's) and its points margin (the points of the foe's units
destroyed less its own), the arm's less the baseline's. Each is tested by a paired randomization test (each game's
difference given either sign at random, 20000 times: no assumption on the shape of the differences), with the mean,
a bootstrap 95% interval, and the win sign test beside them for comparison."""
import math
import random
import re
import sys
from pathlib import Path

LINE = re.compile(r'^\s*(\d+) \[subject (s[12])\].*\| over (\S+) (\d+)-(\d+) lost (\d+)/(\d+)')


def games(tag):
    files = [Path(f'rs-{tag}-a.out')] if Path(f'rs-{tag}-a.out').exists() else sorted(Path('.').glob(f'rs-{tag}-q*.out'))
    out = {}
    for f in files:
        for line in f.read_text(encoding='utf-8', errors='replace').splitlines():
            m = LINE.match(line)
            if not m:
                continue
            seed, seat, winner = int(m.group(1)), m.group(2), m.group(3)
            v1, v2, l1, l2 = (int(m.group(i)) for i in range(4, 8))
            mine, theirs = (v1, v2) if seat == 's1' else (v2, v1)
            lost_mine, lost_theirs = (l1, l2) if seat == 's1' else (l2, l1)
            win = 1.0 if winner == seat else (0.5 if winner not in ('s1', 's2') else 0.0)
            out[seed] = (win, mine - theirs, lost_theirs - lost_mine)
    return out


def sign_p(up, down):
    n = up + down
    if n == 0:
        return 1.0
    k = min(up, down)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n)


def flip_p(diffs, rounds=20000, rng=random.Random(1)):
    """Two-sided paired randomization test of the mean difference."""
    nz = [d for d in diffs if d]
    if not nz:
        return 1.0
    seen = abs(sum(nz))
    hits = 0
    for _ in range(rounds):
        if abs(sum(d if rng.random() < 0.5 else -d for d in nz)) >= seen - 1e-9:
            hits += 1
    return (hits + 1) / (rounds + 1)


def boot_ci(diffs, rounds=4000, rng=random.Random(2)):
    n = len(diffs)
    means = sorted(sum(rng.choice(diffs) for _ in range(n)) / n for _ in range(rounds))
    return means[int(0.025 * rounds)], means[int(0.975 * rounds)]


base_tag = sys.argv[1]
base = games(base_tag)
for arm_tag in sys.argv[2:]:
    arm = games(arm_tag)
    both = sorted(set(base) & set(arm))
    if not both:
        print(f'{base_tag} -> {arm_tag}: no seeds in common')
        continue
    up = sum(1 for s in both if arm[s][0] > base[s][0])
    down = sum(1 for s in both if arm[s][0] < base[s][0])
    changed = sum(1 for s in both if arm[s] != base[s])
    print(f'{base_tag} -> {arm_tag}: {len(both)} games, {changed} changed; wins {sum(arm[s][0] for s in both):g} against '
          f'{sum(base[s][0] for s in both):g} (turned to a win {up}, from one {down}; sign test p {sign_p(up, down):.3f})')
    for i, what in ((1, 'Victory Point margin'), (2, 'points margin')):
        diffs = [arm[s][i] - base[s][i] for s in both]
        mean = sum(diffs) / len(diffs)
        lo, hi = boot_ci(diffs)
        print(f'   {what:22} {sum(base[s][i] for s in both) / len(both):+7.2f} -> {sum(arm[s][i] for s in both) / len(both):+7.2f} a game:'
              f' {mean:+.2f} (95% {lo:+.2f} to {hi:+.2f}); randomization p {flip_p(diffs):.3f}')

"""The Drones' Automatic-Phase activations and those they attacked in, on the SAME games: dshotpair.py <off> <on> ...
(pairs of tags; reads rs-<tag>-a.out, or the rs-<tag>-q*.out parts while a run is going). Only the seeds both tags
played and whose game lines differ are counted (a game that played the same has the same census), so an off arm
without the census can be filled in later by replaying just its changed seeds (`--seeds` prints them, one a line).
Per pair: the games that changed, and in them the subject's Drones attacked/activations off and on, the foe's."""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = re.compile(r'^\s*(\d+) \[subject (s[12])\](.*)$')
SHOTS = re.compile(r'^\s+droneshots s1 (\d+)/(\d+) s2 (\d+)/(\d+)')


def read(tag):
    files = [HERE / f'rs-{tag}-a.out'] if (HERE / f'rs-{tag}-a.out').exists() else sorted(HERE.glob(f'rs-{tag}-q*.out'))
    out = {}
    for f in files:
        seed = None
        for line in f.read_text(encoding='utf-8', errors='replace').splitlines():
            m = GAME.match(line)
            if m:
                seed, seat, rest = m.group(1), m.group(2), m.group(3)
                out[seed] = {'seat': seat, 'line': rest.strip(), 'shots': None}
                continue
            m = SHOTS.match(line)
            if m and seed in out:
                v = [int(x) for x in m.groups()]
                mine, theirs = ((v[0], v[1]), (v[2], v[3])) if out[seed]['seat'] == 's1' else ((v[2], v[3]), (v[0], v[1]))
                out[seed]['shots'] = (mine, theirs)
                seed = None
    return out


def pct(a, b):
    return f'{100.0 * a / b:5.1f}%' if b else '   - '


args = [a for a in sys.argv[1:] if not a.startswith('--')]
if '--seeds' in sys.argv:
    a, b = read(args[0]), read(args[1])
    for s in sorted(set(a) & set(b), key=int):
        if a[s]['line'] != b[s]['line']:
            print(s)
    sys.exit(0)
for off, on in zip(args[0::2], args[1::2]):
    a, b = read(off), read(on)
    both = sorted(set(a) & set(b), key=int)
    changed = [s for s in both if a[s]['line'] != b[s]['line']]
    counted = [s for s in changed if a[s]['shots'] and b[s]['shots']]
    t = [[0, 0] for _ in range(4)]
    for s in counted:
        for k, (x, y) in enumerate((a[s]['shots'][0], b[s]['shots'][0], a[s]['shots'][1], b[s]['shots'][1])):
            t[k][0] += x
            t[k][1] += y
    print(f'{off} -> {on}: {len(both)} games both, {len(changed)} changed, {len(counted)} of them with both censuses')
    if counted:
        print(f'   subject Drones attacked in {t[0][0]}/{t[0][1]} {pct(*t[0])} off, {t[1][0]}/{t[1][1]} {pct(*t[1])} on;'
              f' the foe {pct(*t[2])} -> {pct(*t[3])}')

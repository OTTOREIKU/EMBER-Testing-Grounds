"""The shots through one's own Mechs on the SAME games: throughpair.py <off> <on> ... (pairs of tags, rs-<tag>-a.out).

throughown.py counts every game of a tag; this counts only the seeds both tags played (same squads, same map, same
seat), so a lever's census is not read across different games. Prints, per pair, the subject's Firing attacks through
its own Mech (all, then Drones), off against on, and the foe's for control, with the games where the rate went down,
up or stayed (by game, the subject's own count of shots through its own).
"""
import re
import sys
from pathlib import Path

GAME = re.compile(r'^\s*(\d+) \[subject (s[12])\].*\| over (\S+)')
LINES = re.compile(r'^\s+lines s1 (\d+)/(\d+) s2 (\d+)/(\d+) drones s1 (\d+)/(\d+) s2 (\d+)/(\d+)')


def read(tag):
    out = {}
    seed = seat = None
    for line in Path(f'rs-{tag}-a.out').read_text(encoding='utf-8', errors='replace').splitlines():
        m = GAME.match(line)
        if m:
            seed, seat = m.group(1), m.group(2)
            continue
        m = LINES.match(line)
        if m and seed:
            v = [int(x) for x in m.groups()]
            s1 = [v[0], v[1], v[4], v[5]]
            s2 = [v[2], v[3], v[6], v[7]]
            out[seed] = (s1, s2) if seat == 's1' else (s2, s1)
            seed = None
    return out


def pct(a, b):
    return f'{100.0 * a / b:5.1f}%' if b else '   - '


args = sys.argv[1:]
print(f'{"off -> on":15} {"games":>5}   {"subject off":>17} {"on":>17}   {"drones off":>16} {"on":>16}   {"foe off":>7} {"on":>7}')
for off, on in zip(args[0::2], args[1::2]):
    a, b = read(off), read(on)
    both = sorted(set(a) & set(b))
    t = [[0] * 4 for _ in range(4)]
    for s in both:
        for k, src in enumerate((a[s][0], b[s][0], a[s][1], b[s][1])):
            for i in range(4):
                t[k][i] += src[i]
    so, sn, fo, fn = t
    print(f'{off + " -> " + on:15} {len(both):5}   {so[0]:5}/{so[1]:<5} {pct(so[0], so[1])} {sn[0]:5}/{sn[1]:<5} {pct(sn[0], sn[1])}'
          f'   {so[2]:4}/{so[3]:<4} {pct(so[2], so[3])} {sn[2]:4}/{sn[3]:<4} {pct(sn[2], sn[3])}'
          f'   {pct(fo[0], fo[1])} {pct(fn[0], fn[1])}')

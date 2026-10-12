"""The shots through one's own Mechs, from _squadprobe LINES=1 runs: throughown.py <tag> ... (reads rs-<tag>-a.out).

Each game is its line ('<seed> [subject sX] ... | over <winner> ...') and, under it, the census line
'  lines s1 <thr>/<shots> s2 <thr>/<shots> drones s1 <thr>/<shots> s2 <thr>/<shots>'. For each tag: the subject's
Firing attacks and how many went through a Mech of its own squad (Unit Protection for the target), the Drones'
apart, and the same for the foe (the Ace) for comparison; with the games counted and the subject's wins.
"""
import re
import sys
from pathlib import Path

GAME = re.compile(r'^\s*(\d+) \[subject (s[12])\].*\| over (\S+)')
LINES = re.compile(r'^\s+lines s1 (\d+)/(\d+) s2 (\d+)/(\d+) drones s1 (\d+)/(\d+) s2 (\d+)/(\d+)')


def pct(a, b):
    return f'{100.0 * a / b:5.1f}%' if b else '   - '


print(f'{"tag":7} {"games":>5} {"won":>6}   {"subject thr/shots":>18} {"drones":>14}   {"foe thr/shots":>15} {"drones":>14}')
for tag in sys.argv[1:]:
    path = Path(f'rs-{tag}-a.out')
    if not path.exists():
        print(f'{tag:7} (no file)')
        continue
    games = won = 0
    sub = [0, 0, 0, 0]
    foe = [0, 0, 0, 0]
    seat = None
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        m = GAME.match(line)
        if m:
            seat = m.group(2)
            games += 1
            won += 1 if m.group(3) == seat else 0
            continue
        m = LINES.match(line)
        if m and seat:
            v = [int(x) for x in m.groups()]
            s1 = [v[0], v[1], v[4], v[5]]
            s2 = [v[2], v[3], v[6], v[7]]
            mine, theirs = (s1, s2) if seat == 's1' else (s2, s1)
            for i in range(4):
                sub[i] += mine[i]
                foe[i] += theirs[i]
            seat = None
    print(f'{tag:7} {games:5} {won:6}   {sub[0]:5}/{sub[1]:<5} {pct(sub[0], sub[1])}  {sub[2]:4}/{sub[3]:<4} {pct(sub[2], sub[3])}'
          f'   {foe[0]:5}/{foe[1]:<5} {pct(foe[0], foe[1])}  {foe[2]:4}/{foe[3]:<4} {pct(foe[2], foe[3])}')

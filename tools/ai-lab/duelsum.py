"""The subject's duel against FOE, summed over a tag's probe files: duelsum.py <tag> ...

Reads each rs-<tag>-q*.out's closing tally ({"games":..., "duel":{"subject","foe","level","unfinished"}}).
"""
import glob
import json
import sys

for tag in sys.argv[1:]:
    s = f = lv = un = 0
    for path in glob.glob(f'rs-{tag}-q*.out'):
        for line in open(path, encoding='utf-8', errors='replace'):
            if line.startswith('{"games"'):
                d = json.loads(line).get('duel', {})
                s += d.get('subject', 0)
                f += d.get('foe', 0)
                lv += d.get('level', 0)
                un += d.get('unfinished', 0)
    n = s + f + lv
    share = f'{100 * s / n:.0f}%' if n else '-'
    print(f'{tag}: the subject won {s}, its foe {f}, level {lv}, unfinished {un} ({share} to the subject)')

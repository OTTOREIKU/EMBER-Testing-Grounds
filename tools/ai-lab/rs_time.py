"""The thinking time of each arm of a queued measurement: the sum of the chunks' "ms" (rs-<tag>-q*.out).
   python rs_time.py <tag> [<tag> ...]"""
import glob
import json
import sys
from pathlib import Path

# The run's files are read where the reader is run (the measurement's own folder).
HERE = Path.cwd()
for tag in sys.argv[1:]:
    ms = 0
    games = 0
    for f in glob.glob(str(HERE / f'rs-{tag}-q*.out')):
        for line in open(f, encoding='utf-8', errors='replace'):
            if line.startswith('{'):
                row = json.loads(line)
                ms += row.get('ms', 0)
                games += row.get('games', 0)
    per = ms / games / 1000 if games else 0
    print(f'{tag}: {games} games, {ms / 60000:.1f} min in all, {per:.1f} s a game')

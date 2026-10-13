"""The blind-spot census read (M22, 2026-10-12): blindspots.py <tag> [<tag> ...] (reads rs-<tag>-a.out and, where it
exists, blind-<tag>-a.jsonl, or their -q parts while a run is going, in the directory it is run from; the runs made with the probe's BLINDSPOTS=1).

For each tag and each side (the subject, the foe), each kind of unit (a Drone by its card, a Mech by its longest
gun): its activations, the share with no attack on offer at all (the Porcupine's sign), the share of those with one on
offer that ended without one (a shot passed up), the units of the kind alive three rounds or more, the share of them
that never moved and, of those armed, that never struck. Then the counts a game (Drones never given a Command, Command
Phases passed with a Drone to give one to, Charges made and left unspent, Box carriers walking away). A kind is
marked * where a share stands out (see FLAGS) on enough of a sample, and its cases from the log are listed."""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
# (share, the least sample it is read on)
FLAGS = {'noTarget': (0.70, 40), 'passed': (0.15, 20), 'still': (0.50, 10), 'silent': (0.50, 10)}


def card_names():
    for data in (os.environ.get('EMBER_DATA'), HERE / '..' / '..' / 'data', 'E:/ClaudeProjects/Ember Obsidian Protocol/TestingGrounds/data'):
        if not data:
            continue
        names = {}
        for f in ('cards.json', 'cards_extra.json'):
            p = Path(data) / f
            if not p.exists():
                continue
            raw = json.loads(p.read_text(encoding='utf-8'))
            for c in raw if isinstance(raw, list) else raw.get('cards', list(raw.values()) if isinstance(raw, dict) else []):
                if isinstance(c, dict) and 'id' in c:
                    n = c.get('name')
                    names[str(c['id'])] = (n.get('en') if isinstance(n, dict) else n) or str(c['id'])
        if names:
            return names
    return {}


NAMES = card_names()
named = lambda kind: f"{kind} {NAMES.get(kind.split(':', 1)[1], '')}".strip() if kind.startswith('drone:') else kind
pct = lambda a, b: f'{100.0 * a / b:5.1f}%' if b else '    -'


def read(tag):
    cards, sums = defaultdict(Counter), defaultdict(Counter)
    outs = [Path(f'rs-{tag}-a.out')] if Path(f'rs-{tag}-a.out').exists() else sorted(Path('.').glob(f'rs-{tag}-q*.out'))
    lines = [x for f in outs for x in f.read_text(encoding='utf-8', errors='replace').splitlines()]
    for line in lines:
        if not line.startswith('{') or 'blindCards' not in line:
            continue
        t = json.loads(line)
        for k, v in t.get('blindCards', {}).items():
            cards[k].update(v)
        for who, v in t.get('blindSums', {}).items():
            sums[who].update(v)
    cases = []
    logs = [Path(f'blind-{tag}-a.jsonl')] if Path(f'blind-{tag}-a.jsonl').exists() else sorted(Path('.').glob(f'blind-{tag}-q*.jsonl'))
    for log in logs:
        cases += [json.loads(x) for x in log.read_text(encoding='utf-8', errors='replace').splitlines() if x.strip()]
    return cards, sums, cases


for tag in sys.argv[1:]:
    cards, sums, cases = read(tag)
    print(f'######## {tag}')
    for who in ('subject', 'foe'):
        rows = [(k.split('|', 1)[1], v) for k, v in cards.items() if k.startswith(f'{who}|')]
        if not rows:
            continue
        g = sums.get(who, Counter())
        print(f'  {who} ({g["games"]} games): kind, activations, no attack on offer, passed up (of offered), units alive 3+ rounds, never moved (of those that can), never struck (of armed)')
        rows.sort(key=lambda r: -r[1]['acts'])
        for kind, v in rows:
            shares = {
                'noTarget': ((v['acts'] - v['offered']) / v['acts'] if v['acts'] else 0, v['acts']),
                'passed': (v['passed'] / v['offered'] if v['offered'] else 0, v['offered']),
                'still': (v['still'] / v.get('mobile', v['units']) if v.get('mobile', v['units']) else 0, v.get('mobile', v['units'])),
                'silent': (v['silent'] / v['armed'] if v['armed'] else 0, v['armed']),
            }
            marks = [k for k, (share, n) in shares.items() if n >= FLAGS[k][1] and share >= FLAGS[k][0]]
            print(f'  {"*" if marks else " "} {named(kind)[:44]:44} {v["acts"]:5} {pct(v["acts"] - v["offered"], v["acts"])}'
                  f' {pct(v["passed"], v["offered"])} of {v["offered"]:<4} {v["units"]:4} {pct(v["still"], v.get("mobile", v["units"]))}'
                  f' {pct(v["silent"], v["armed"])} of {v["armed"]:<4} {" ".join(marks)}')
        if g['games']:
            per = lambda k: g[k] / g['games']
            print(f'    a game: {per("neverCommanded"):.2f} Drones never commanded, {per("cmdPass"):.2f} Commands passed with a Drone to'
                  f' give one to, {per("chargesMade"):.2f} Charges made ({per("chargesLeft"):.2f} left unspent at the end),'
                  f' {per("boxAway"):.2f} Box carriers walking away')
    if cases:
        print(f'  THE CASES LOGGED ({len(cases)}), by what and kind:')
        what = Counter((c['who'], re.sub(r'\d+', 'N', c['what'].split(' with ')[0]), named(c['kind'])) for c in cases)
        for (who, w, kind), n in what.most_common(15):
            print(f'    {n:5}  {who:7} {kind[:40]:40} {w[:70]}')

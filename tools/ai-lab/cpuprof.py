"""Read a V8 .cpuprofile (node --cpu-prof) of a bundled game run: cpuprof.py <file.cpuprofile> [top].

Self time and inclusive time by function, each function placed in its source module by the esbuild bundle's
`// src/...` section comments (the bundle the profile names), and self time summed by module.
"""
import bisect
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
prof = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
top = int(sys.argv[2]) if len(sys.argv) > 2 else 40
nodes = {n['id']: n for n in prof['nodes']}
parent = {}
for n in prof['nodes']:
    for c in n.get('children', []):
        parent[c] = n['id']

maps = {}


def module_of(url, line):
    if not url.startswith('file:'):
        return url or '(native)'
    if url not in maps:
        p = unquote(urlparse(url).path).lstrip('/')
        marks = []
        try:
            for i, text in enumerate(Path(p).read_text(encoding='utf-8', errors='replace').splitlines()):
                m = re.match(r'^// (\S*src/\S+\.ts)$', text)
                if m:
                    marks.append((i, m.group(1).split('src/', 1)[1]))
        except OSError:
            pass
        maps[url] = ([a for a, _ in marks], [b for _, b in marks], Path(p).name)
    lines, names, base = maps[url]
    k = bisect.bisect_right(lines, line) - 1
    return f'src/{names[k]}' if k >= 0 else base


def key(nid):
    cf = nodes[nid]['callFrame']
    name = cf['functionName'] or '(anonymous)'
    return (name, module_of(cf['url'], cf['lineNumber']), cf['lineNumber'] + 1)


self_us = defaultdict(float)
samples, deltas = prof['samples'], prof['timeDeltas']
for i, nid in enumerate(samples):
    d = deltas[i + 1] if i + 1 < len(deltas) else 0
    self_us[nid] += d
total = sum(self_us.values())

path_keys = {}


def keys_on_path(nid):
    if nid in path_keys:
        return path_keys[nid]
    chain = []
    x = nid
    while x is not None and x not in path_keys:
        chain.append(x)
        x = parent.get(x)
    base = path_keys[x] if x is not None else frozenset()
    for y in reversed(chain):
        base = base | {key(y)}
        path_keys[y] = base
    return path_keys[nid]


self_by = defaultdict(float)
incl_by = defaultdict(float)
mod_self = defaultdict(float)
for nid, us in self_us.items():
    if not us:
        continue
    k = key(nid)
    self_by[k] += us
    mod_self[k[1]] += us
    for kk in keys_on_path(nid):
        incl_by[kk] += us


def row(k, us):
    return f'{us / 1e6:9.2f} s {100 * us / total:5.1f}%  {k[0][:44]:44} {k[1]}:{k[2]}'


print(f'profile {sys.argv[1]}: {total / 1e6:.1f} s sampled')
print('\n== self time, by function')
for k, us in sorted(self_by.items(), key=lambda x: -x[1])[:top]:
    print(row(k, us))
print('\n== inclusive time, by function (each sample once per function on its stack)')
for k, us in sorted(incl_by.items(), key=lambda x: -x[1])[:top]:
    print(row(k, us))
print('\n== self time, by module')
for m, us in sorted(mod_self.items(), key=lambda x: -x[1])[:25]:
    print(f'{us / 1e6:9.2f} s {100 * us / total:5.1f}%  {m}')

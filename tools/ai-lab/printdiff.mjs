import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
const ka = Object.keys(a.prints), kb = Object.keys(b.prints);
const diff = ka.filter((k) => a.prints[k] !== b.prints[k]);
const missing = ka.filter((k) => !(k in b.prints)), added = kb.filter((k) => !(k in a.prints));
console.log(`before ${ka.length}, after ${kb.length}; differ ${diff.length}; missing ${missing.length}; added ${added.length}`);
const kinds = {};
for (const k of diff) { const kind = k.split('|').slice(3).join('|').replace(/\|[0-9A-Za-z_@]+$/, ''); kinds[kind] = (kinds[kind] || 0) + 1; }
if (diff.length) console.log(kinds);
for (const k of diff.slice(0, 3)) {
  const x = a.full[k], y = b.full[k];
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  console.log('---', k, 'first difference at', i, '\n  before:', x.slice(Math.max(0, i - 120), i + 200), '\n  after: ', y.slice(Math.max(0, i - 120), i + 200));
}

// Validates the hand-read Ammo counts in data/ammo_overrides.json. A typo in an
// action id would silently do nothing, so every key is checked against the cards.
import { readFileSync } from 'node:fs';

const cards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const patch = JSON.parse(readFileSync(new URL('../../data/ammo_overrides.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const actions = new Map();
for (const c of cards) for (const a of c.actions ?? []) actions.set(a.id, { ...a, card: c });

console.log('Drone Ammo overrides\n');

const entries = Object.entries(patch.actions ?? {});
check('the file has entries', entries.length > 0, true);

for (const [id, n] of entries) {
  const a = actions.get(id);
  check(`${id} names a real action`, !!a, true);
  if (!a) continue;
  check(`${id} is ${a.name.en || a.name.zh}`, typeof a.name.en === 'string' || typeof a.name.zh === 'string', true);
  check(`${id} count is a positive whole number`, Number.isInteger(n) && n > 0, true);
  // Ammo belongs to the unit that spends it, and only Drones are patched here.
  check(`${id} is on a drone`, a.card.category, 'drone');
  // Every entry exists because the bundle recorded nothing; if one ever starts
  // carrying real data, the override should be reviewed rather than left to win.
  check(`${id} is still missing from the bundle`, a.storage ?? 0, 0);
}

// A note for every entry, since these came off card scans rather than the data.
const notes = patch._notes ?? {};
for (const [id] of entries) check(`${id} records where the count came from`, typeof notes[id] === 'string' && notes[id].length > 10, true);
check('no note is orphaned', Object.keys(notes).filter((k) => !(k in (patch.actions ?? {}))), []);

// Volley X spends one Ammo per Projectile launched, so a Volley action with
// fewer Ammo than X could never fire a full volley. That would suggest a misread.
const volleyOf = (a) => {
  const hay = [a.description?.zh ?? '', ...(a.keywords ?? []).map((k) => k.inline ?? k.key ?? '')].join(' ');
  const m = /齐射(\d+)/.exec(hay);
  return m ? Number(m[1]) : null;
};
for (const [id, n] of entries) {
  const a = actions.get(id);
  const v = a && volleyOf(a);
  if (v) check(`${id} has enough ammo for one Volley ${v}`, n >= v, true);
}

// The gap this file exists to close: drone actions that put something on the
// board and record no ammo. Everything the sweep found should now be covered.
const launchers = [];
for (const c of cards) {
  if (c.category !== 'drone') continue;
  for (const a of c.actions ?? []) {
    if (a.type === 'Projectile' || /发射|投放|布设|部署/.test(a.description?.zh ?? '')) launchers.push(a.id);
  }
}
const uncovered = launchers.filter((id) => !(id in (patch.actions ?? {})) && !(actions.get(id)?.storage > 0));
check('every launching drone action has an ammo count', uncovered, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// OTTO's rulings of 2026-09-03 that touched code: the Match Centre's End Phase
// walks the book's order (3.7.1 Remove Units, 3.7.2 Token Management, 3.7.3
// Check Tasks), and the data merge can remove an action a card no longer has -
// though the four GoF Command Coordination actions it was built for are KEPT
// until the printed GoF cards arrive.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Rulings 2026-09-03\n');

// ---------- End Phase order ----------
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const steps = hud.slice(hud.indexOf('const steps: { id: string; label: string }[] = ['), hud.indexOf('const steps: { id: string; label: string }[] = [') + 900);
const order = ['remove', 'tokens', 'smoke', 'tasks'].map((id) => steps.indexOf(`id: '${id}'`));
check('every step is still offered', order.every((i) => i >= 0), true);
check('Remove Units comes first (3.7.1)', order[0] < order[1], true);
check('Token Management second (3.7.2), with Smoke beside it (4.16)', order[1] < order[2] && order[2] < order[3], true);
check('Check Tasks last (3.7.3)', order[3] === Math.max(...order), true);
const guide = readFileSync(new URL('../src/playguide.ts', import.meta.url), 'utf8');
check('the guide already walked that order', guide.indexOf("'remove'") < guide.indexOf("'tokens'") && guide.indexOf("'tokens'") < guide.indexOf("'tasks'"), true);

// ---------- removing an action at load ----------
const dataSrc = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
check('the merge knows how to remove an action', /if \(fix\.remove === true\) \{\s*\n\s*c\.actions = \(c\.actions \?\? \[\]\)\.filter\(\(x\) => x !== a\);/.test(dataSrc), true);
check('over a copy of the list, so the walk does not skip the neighbour', /for \(const a of \[\.\.\.\(c\.actions \?\? \[\]\)\]\)/.test(dataSrc), true);

// OTTO's ruling (2026-09-28): the company's parts lists are the newest and
// highest source, for every faction, so where a list and a card disagree the
// list wins. It retires the 2026-09-03 keep ruling (a GoF card printing an
// Action the list lacks kept it until the printed cards arrived). GoF 1.021
// prints none of these five, so they come off at load.
const patch = JSON.parse(readFileSync(new URL('../../data/action_overrides.json', import.meta.url), 'utf8')).actions ?? {};
const gone = ['ZYBP-101_B', 'ZYBP-202_B', 'ZHLA-102_B', 'ZHLA-201_B', 'ZYDR-108_A'];
check('the five Actions GoF 1.021 does not print are removed, and nothing else',
  Object.entries(patch).filter(([, v]) => v.remove === true).map(([k]) => k).sort(), [...gone].sort());
const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;
const byId = new Map(cards.map((c) => [c.id, c]));
check('each is a real Action of its card in the raw data, so the removal lands', gone.map((id) => byId.get(id.split('_')[0]).actions.some((a) => a.id === id)), gone.map(() => true));
check('and ZYBP-101 is not handed a keyword line in its place', /Command Coordination/.test(patch['ZYBP-101_A']?.description?.en ?? ''), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

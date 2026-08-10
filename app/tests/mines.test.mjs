// Mines (rulebook 4.7, FAQ M3/M6/M7/M19/M22/M24).
//   A Mine detonates when a GROUND Unit is in its Grid, however it got there.
//   The trigger is derived from the board, so a Crush that shoves a Drone onto
//   a Mine (M7) is caught by the same rule as a Maneuver onto one.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const dataSrc = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');

const slice = (src, from, to, what) => {
  const a = src.indexOf(from);
  // The card predicates run to the end of data.ts, so `to` may be null.
  const b = to === null ? src.length : src.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`could not locate ${what}`);
  return src.slice(a, b);
};

// The card predicates and the trigger geometry, sliced rather than mirrored so
// a change to either shows up here. largeGridOf is three lines of arithmetic
// and is mirrored to keep rules.ts's DOM-ish imports out.
const predicates = slice(dataSrc, '// The three deployable barricades.', null, 'the card predicates in data.ts');
const mines = slice(unitsSrc, '// ---------- Mines (rulebook 4.7', 'export function makeDroneToken', 'the Mines block in units.ts');
const scope = slice(unitsSrc, 'export function explosionScope', 'export function needsSightToLanding', 'explosionScope in units.ts');

const tmp = new URL('./_mines.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type Card = any;\ntype CardAction = any;\ntype GameData = any;\ntype Token = any;\n'
    + 'function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }\n'
    + predicates
    + mines
    + scope,
);
const M = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Mines — rulebook 4.7, FAQ M3/M6/M7/M19/M22/M24\n');

// ---------- the predicates, against the real cards ----------

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
const byId = new Map(cards.map((c) => [String(c.id), c]));

check('the GM-35 is the one Mine in the box', cards.filter((c) => M.isMine(c)).map((c) => String(c.id)), ['074']);
check('Pholcus is a self-propelled Mine, not a Mine', [M.isMine(byId.get('156')), M.isAutoMine(byId.get('156'))], [false, true]);
check('and nothing else carries that keyword', cards.filter((c) => M.isAutoMine(c)).map((c) => String(c.id)), ['156']);
// The two keywords share a suffix, so a substring test would fold them together.
check('the Mine test is exact, not a substring', M.isMine(byId.get('156')), false);
check('the GM-35 Trigger carries the explosion dice', (() => {
  const a = (byId.get('074').actions ?? []).find((x) => (x.redDice ?? 0) + (x.yellowDice ?? 0) > 0);
  return a ? [a.id, a.redDice, a.yellowDice, a.range ?? 0] : null;
})(), ['074_A', 3, 1, 0]);

// FAQ M22: the blast catches every unit in the Grid. The card prints "all
// ground units" and the FAQ widens it, so the wizard must read it as "all".
check('a Mine blast reads as all-units, not single (M22)',
  M.explosionScope((byId.get('074').actions ?? [])[0]), 'all');
// Pholcus damages its target only — the printed English is what governs.
check("Pholcus's jump stays single-target", M.explosionScope((byId.get('167').actions ?? [])[0]), 'single');

// ---------- the trigger ----------

const data = { byId: new Map([...byId].map(([k, v]) => [k, v])) };
const tok = (uid, cardId, col, row, over = {}) => ({
  uid, side: over.side ?? 's1', kind: over.kind ?? 'drone', cardId, col, row,
  size: over.size ?? 1, facing: 0, aerial: over.aerial ?? false, label: over.label ?? `U${uid}`,
  partStates: over.partStates ?? { main: 'intact' }, statuses: [], ammo: {}, ...over,
});
// The Mine itself is a Projectile and therefore Aerial in the model, which is
// what lets a Flying unit land on it (E10/M24).
const mineAt = (uid, col, row, side = 's1') => tok(uid, '074', col, row, { side, kind: 'projectile', aerial: true, label: 'GM-35' });
const mech = (uid, col, row, side = 's2') => tok(uid, 'MT1', col, row, { side, kind: 'mech', size: 3, label: 'Mech', partStates: { torso: 'intact' } });

data.byId.set('MT1', { id: 'MT1', category: 'mech_part', actions: [] });
data.byId.set('RAVEN', { id: 'RAVEN', category: 'drone', flyingOrElevated: 'flying', actions: [] });
data.byId.set('DFLY', { id: 'DFLY', category: 'drone', flyingOrElevated: 'elevated', actions: [] });

check('an untouched Mine owes nothing', M.minesOwed(data, [mineAt(1, 4, 4), mech(2, 30, 30)]), []);

const stepped = M.minesOwed(data, [mineAt(1, 4, 4), mech(2, 3, 3)]);
check('a Mech in the Grid sets it off', stepped.map((x) => [x.uid, x.actionId]), [[1, '074_A']]);
check('and the whole Grid is in the blast', stepped[0].victims, [2]);

// FAQ M6: indiscriminate. Its own side sets it off just the same.
check('an ally sets it off too (M6)',
  M.minesOwed(data, [mineAt(1, 4, 4, 's1'), mech(2, 3, 3, 's1')]).length, 1);

// FAQ M3/M24: a transparent-base Flying Unit lands on top of the Mine.
check('a Flying Unit never triggers it (M3/M24)',
  M.minesOwed(data, [mineAt(1, 4, 4), tok(2, 'RAVEN', 4, 4)]), []);
check('nor does an Aerial one', M.minesOwed(data, [mineAt(1, 4, 4), tok(2, 'DFLY', 4, 4, { aerial: true })]), []);
// ...but once a Ground Unit does set it off, everything in the Grid is caught,
// the Flying and Aerial units above it included (M22).
const mixed = M.minesOwed(data, [mineAt(1, 4, 4), tok(2, 'RAVEN', 4, 5), tok(3, 'DFLY', 5, 4, { aerial: true }), mech(4, 3, 3)]);
check('a Ground Unit catches the Flying and Aerial with it (M22)', mixed[0]?.victims.sort(), [2, 3, 4]);

// The Grid, not the cell: a 3x3 Mech overlaps a whole Large Grid.
check('the test is per Large Grid, not per cell',
  M.minesOwed(data, [mineAt(1, 5, 5), mech(2, 3, 3)]).length, 1);
check('a Mech in the next Grid is clear',
  M.minesOwed(data, [mineAt(1, 6, 6), mech(2, 3, 3)]).length, 0);

// FAQ M6 second half: a Mine Deployed into a Grid holding one sets off the
// Mine that was already there — and only that one.
const two = M.minesOwed(data, [mineAt(1, 4, 4), mineAt(9, 4, 5)]);
check('a new Mine sets off the older one (M6)', two.map((x) => x.uid), [1]);
check('and the new Mine is the one in the blast', two[0].victims, [9]);

// A destroyed Mine is not a Mine, and a reserve unit is not on the board.
check('a destroyed Mine owes nothing',
  M.minesOwed(data, [{ ...mineAt(1, 4, 4), partStates: { main: 'destroyed' } }, mech(2, 3, 3)]), []);
check('a unit still in reserve does not set one off',
  M.minesOwed(data, [mineAt(1, 4, 4), { ...mech(2, 3, 3), deployed: false }]), []);

// ---------- Ground Unit ----------

check('a Mech is a Ground Unit', M.isGroundUnit(data, mech(1, 3, 3)), true);
check('a transparent base is not', M.isGroundUnit(data, tok(1, 'RAVEN', 3, 3)), false);
check('an elevated base is not', M.isGroundUnit(data, tok(1, 'DFLY', 3, 3, { aerial: true })), false);
check('a Mine is not a Ground Unit either', M.isGroundUnit(data, mineAt(1, 3, 3)), false);

// The whole model rests on this: a Mine is Aerial, which is what keeps it off
// the Crush list (a Ground Unit sets it off instead - GM-35 card, FAQ M7/M8)
// and lets a Flying Unit land on top of it (E10/M24).
check('the Mine is Aerial in the model', M.isAerial(byId.get('074')), true);
check('and is not one of the Barricades', M.isBarricade(byId.get('074')), false);

// ---------- Pholcus, the Mine that unfolds (FAQ M8/M18/M28) ----------

check('the folded Pholcus unfolds into the Drone', M.unfoldsInto(byId.get('156')), '167');
check('and the Drone is the far side of that table', M.isUnfolded(byId.get('167')), true);
check('nothing else in the box unfolds', cards.filter((c) => M.unfoldsInto(c)).map((c) => String(c.id)), ['156']);
check('a GM-35 Mine does not unfold', M.unfoldsInto(byId.get('074')), undefined);
// M8: destroying it or its self-detonation grants no score, which is what the
// printed 0 means - a Low Value Unit.
check('the unfolded Pholcus is Low Value', byId.get('167').score, 0);
// M28: the jump is a Detonation with its own range, so terrain never gates it.
check('its automatic attack is a ranged Detonation', (() => {
  const a = (byId.get('167').actions ?? [])[0];
  return [a.type, a.speed, a.range, a.yellowDice];
})(), ['Detonation', 'auto', 1, 6]);

// The folded Projectile owes its replacement; the Drone form owes nothing.
const folded = tok(1, '156', 4, 4, { kind: 'projectile', aerial: true, label: 'Pholcus' });
check('a folded Pholcus owes its Unfold (M18.3)',
  M.unfoldsOwed(data, [folded]).map((x) => [x.uid, x.actionId, x.into]), [[1, '156_A', '167']]);
check('and a GM-35 owes none', M.unfoldsOwed(data, [mineAt(2, 4, 4)]), []);

// M18.4: coming up in an occupied Grid detonates on the spot, ally or not.
const unfolded = tok(1, '167', 4, 4, { kind: 'drone', label: 'Pholcus' });
const onTop = M.minesOwed(data, [unfolded, mech(2, 3, 3, 's1')]);
check('an Unfold into an occupied Grid detonates at once (M18.4)',
  onTop.map((x) => [x.uid, x.actionId, x.victims]), [[1, '167_A', [2]]]);
check('and an empty Grid owes nothing', M.minesOwed(data, [unfolded, mech(2, 30, 30)]), []);
// It is a Drone, not a Mine: walking past one is a Crush, not a trigger.
check('the unfolded form is not a Mine', M.isMine(byId.get('167')), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

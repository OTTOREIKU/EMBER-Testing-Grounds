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
// minesLayable reads the Mech's Parts and asks each Action how it delivers, so
// both of those come along rather than being stubbed — a stub would pass while
// the real lookup was broken.
const slots = slice(unitsSrc, 'export const PART_SLOTS', 'export const SLOT_LABEL', 'PART_SLOTS in units.ts');
const delivery = slice(unitsSrc, '// How a Projectile Action delivers.', '// The Interception attempts', 'projectileDelivery in units.ts');
const cardsOf = slice(unitsSrc, 'export function tokenCards', '// ---------- Tarantula Loads', 'tokenCards in units.ts');
// M18.6's mandatory Detonation picks its targets with the SAME nearest-target
// reader every other automatic attack uses, so it is sliced rather than faked.
// autoTargetsFor runs to the AA Radar block, which sweeps in the O9/O10 Neutral
// fallback that sits between them — deliberate, they are one rule read together.
const autoTargets = slice(unitsSrc, 'export function autoTargetsFor', "// ---------- The Hyena's AA Radar", 'autoTargetsFor in units.ts');
// Same as loads.test.mjs: the real actionRange, with only the aura lookup
// stubbed, so autoTargetsFor measures reach the way the app does.
const rangeFn = slice(unitsSrc, "// A Firing Action", "export function hasFlexibleTiming", "actionRange in units.ts");
const auraStub = `export function auraValueOn(_d: any, _t: any, _u: any, _k: string): number { return 0; }
`;

const tmp = new URL('./_mines.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type Card = any;\ntype CardAction = any;\ntype GameData = any;\ntype Token = any;\ntype PartSlot = any;\ntype TerrainPiece = any;\n'
    + 'function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }\n'
    // Grid-distance and the two lookups autoTargetsFor leans on. Range in this
    // game is MANHATTAN over large Grids - `dc + dr`, matching rangeBetween in
    // rules.ts. It was mirrored here as Chebyshev at first and every pin still
    // passed, because they all sat on one axis where the two metrics agree; the
    // diagonal case below is what tells them apart. The Repeater and Highlight
    // paths are exercised in their own files, so they are neutral here.
    + 'function rangeBetween(a: any, b: any): any { const p = largeGridOf(a), q = largeGridOf(b);\n'
    + '  return { range: Math.abs(p.c - q.c) + Math.abs(p.r - q.r) }; }\n'
    + 'function isElectronicAttack(_a: any): boolean { return false; }\n'
    // The Amplify half of actionRange, likewise neutral here (amplify.test.mjs).
    + 'function isElectronicSupport(_a: any): boolean { return false; }\nfunction amplifyBonus(_d: any, _t: any): number { return 0; }\n'
    + 'function statusCount(list: any, id: string): number { return (list ?? []).filter((x: any) => x === id).length; }\n'
    + slots
    + delivery
    + cardsOf
    + auraStub + rangeFn + autoTargets
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

// ---------- Laying them: Auto Mine Laying (FAQ M7, M29) ----------

// The Mine Layer is a Backpack, so the Mech is built with one in that slot and
// the real tokenCards/projectileDelivery pair does the finding.
const layer = (uid, over = {}) => tok(uid, 'MT1', 4, 4, {
  side: 's1', kind: 'mech', size: 3, label: 'Digger',
  mech: { torso: 'MT1', backpack: '006', ...(over.mech ?? {}) },
  partStates: over.partStates ?? { torso: 'intact', backpack: 'intact' },
  ...over,
});
const route = (...gs) => gs.map(([c, r]) => ({ c, r }));

check('the GLP-15 is the one card that Lays', cards.filter((c) => (c.actions ?? []).some((a) => M.projectileDelivery(a) === 'lay')).map((c) => String(c.id)), ['006']);
check('and what it Lays is the GM-35', (() => {
  const l = M.minesLayable(data, layer(1), route([1, 1]), 1, false);
  return l && [l.actionId, l.cardId];
})(), ['006_A', '074']);

// M7: the Mines go anywhere on the route, and the price is Move Range, so a
// Mech that spent everything walking has nothing left to Lay with.
check('no spare Move Range Lays nothing', M.minesLayable(data, layer(1), route([1, 1], [1, 2]), 0, false), null);
check('the whole route is offered on a ground move', (() => {
  const l = M.minesLayable(data, layer(1), route([1, 1], [1, 2], [1, 3]), 2, false);
  return l && [l.grids.map((g) => `${g.c},${g.r}`), l.max];
})(), [['1,1', '1,2', '1,3'], 2]);
// The cap is whichever runs out first: the spare Range, or the Grids to put
// them in.
check('two spare points over a three-Grid route Lays at most 2', (() => M.minesLayable(data, layer(1), route([1, 1], [1, 2], [1, 3]), 2, false).max)(), 2);
check('four spare points over a two-Grid route Lays at most 2', (() => M.minesLayable(data, layer(1), route([1, 1], [1, 2]), 4, false).max)(), 2);

// M29: a Flight Move's path is only its two ends, however far the drawn route
// wandered, so the Grids between are not on it to Lay in.
check('a Flight Move offers only its ends (M29)', (() => {
  const l = M.minesLayable(data, layer(1), route([1, 1], [1, 2], [1, 3], [1, 4]), 3, true);
  return l && [l.grids.map((g) => `${g.c},${g.r}`), l.max];
})(), [['1,1', '1,4'], 2]);
check('and a Flight Move that went nowhere offers the one Grid', (() => {
  const l = M.minesLayable(data, layer(1), route([2, 2]), 2, true);
  return l && l.grids.map((g) => `${g.c},${g.r}`);
})(), ['2,2']);

// A destroyed Part lends nothing, which is the rule every borrowed Action follows.
check('a destroyed Mine Layer Lays nothing',
  M.minesLayable(data, layer(1, { partStates: { torso: 'intact', backpack: 'destroyed' } }), route([1, 1], [1, 2]), 2, false), null);
check('a Mech without the Backpack Lays nothing',
  M.minesLayable(data, layer(1, { mech: { torso: 'MT1', backpack: undefined } }), route([1, 1], [1, 2]), 2, false), null);
// Only a Mech Maneuvers, and the card says "when the mech Moves or Maneuvers".
check('a Drone Lays nothing', M.minesLayable(data, tok(1, '006', 4, 4), route([1, 1], [1, 2]), 2, false), null);
check('an empty route Lays nothing', M.minesLayable(data, layer(1), [], 2, false), null);

// A Mine laid into a Grid that already holds one sets the older one off (M6),
// which the trigger derivation already covers — the laid Mine just has to reach
// the board with a higher uid, which the command mints in order.
check('a Mine laid onto an enemy Mine sets that one off (M6)',
  M.minesOwed(data, [mineAt(1, 4, 4, 's2'), mineAt(9, 4, 4, 's1')]).map((x) => [x.uid, x.victims]),
  [[1, [9]]]);

// ---------- M18.6: the Detonation it does not get to decline ----------

// Keyed on the Action's shape rather than the card id, so the pin is really
// asking "is this still the only card built this way".
check('the Unfolded Pholcus is the only Detonation+auto card in the box',
  cards.filter((c) => (c.actions ?? []).some((a) => a.type === 'Detonation' && a.speed === 'auto')).map((c) => String(c.id)),
  ['167']);

const pholcus = (uid, c, r, side = 's1') => tok(uid, '167', c * 3 + 1, r * 3 + 1, { side, kind: 'drone', label: 'Pholcus' });
const foe = (uid, c, r, over = {}) => tok(uid, 'MT1', c * 3 + 1, r * 3 + 1, { side: 's2', kind: 'mech', size: 3, label: `Foe${uid}`, partStates: { torso: 'intact' }, ...over });

check('an enemy in range makes it owe a Detonation', (() => {
  const o = M.autoDetonationsOwed(data, [pholcus(1, 4, 4), foe(2, 5, 4)]);
  return o.map((x) => [x.uid, x.actionId, x.targets]);
})(), [[1, '167_A', [2]]]);
// Range 1 on the card, so two Grids away is out of reach and nothing is owed.
check('an enemy out of range owes nothing', M.autoDetonationsOwed(data, [pholcus(1, 4, 4), foe(2, 6, 4)]), []);
// The diagonal is the case that tells Manhattan from Chebyshev: one Grid across
// and one down is range 2 here, NOT range 1, so a Range-1 Detonation cannot
// reach it. Every other pin in this file sits on one axis, where both metrics
// agree and a wrong one would pass unnoticed.
check('a diagonal neighbour is range 2, so out of reach of Range 1',
  M.autoDetonationsOwed(data, [pholcus(1, 4, 4), foe(2, 5, 5)]), []);
check('an ALLY in range owes nothing', M.autoDetonationsOwed(data, [pholcus(1, 4, 4), foe(2, 5, 4, { side: 's1' })]), []);
check('alone on the board it owes nothing', M.autoDetonationsOwed(data, [pholcus(1, 4, 4)]), []);
// A destroyed unit is not a target, and a dead Pholcus does not act.
check('a destroyed enemy is not a target',
  M.autoDetonationsOwed(data, [pholcus(1, 4, 4), foe(2, 5, 4, { partStates: { torso: 'destroyed' } })]), []);
check('a destroyed Pholcus owes nothing',
  M.autoDetonationsOwed(data, [tok(1, '167', 13, 13, { kind: 'drone', label: 'Pholcus', partStates: { main: 'destroyed' } }), foe(2, 5, 4)]), []);
check('one still waiting to deploy owes nothing',
  M.autoDetonationsOwed(data, [tok(1, '167', 13, 13, { kind: 'drone', label: 'Pholcus', deployed: false }), foe(2, 5, 4)]), []);
// The rule makes the Detonation mandatory, not the victim: ties come back whole
// so the player still picks which Grid it jumps to.
check('tied nearest targets are all returned, so the player still chooses', (() => {
  const o = M.autoDetonationsOwed(data, [pholcus(1, 4, 4), foe(2, 5, 4), foe(3, 3, 4)]);
  return o[0].targets.sort();
})(), [2, 3]);
// The FOLDED Projectile has no Detonation action at all — it Unfolds first
// (M18.3), and cannot act in the round it does (M8).
check('the folded Pholcus owes no Detonation', M.autoDetonationsOwed(data, [tok(1, '156', 13, 13, { kind: 'projectile', aerial: true, label: 'folded' }), foe(2, 5, 4)]), []);
// A GM-35 is a Mine, not an automatic attacker: it waits to be stood on.
check('a GM-35 owes no automatic Detonation', M.autoDetonationsOwed(data, [mineAt(1, 13, 13), foe(2, 14, 13)]), []);

// ---------- O9/O10: the Neutral fallback ----------

// A container is Breakable Terrain; buildings and both Defense walls are not,
// which is exactly how O10's "Buildings are not valid targets" is enforced.
const box = (id, c, r) => ({ id, type: 'container', isFragile: true, height: 1, blocksLos: false, providesProtection: false,
  subCells: [{ col: c * 3 + 1, row: r * 3 + 1 }] });
const wall = (id, c, r) => ({ id, type: 'building', isFragile: false, height: 3, blocksLos: true, providesProtection: true,
  subCells: [{ col: c * 3 + 1, row: r * 3 + 1 }] });
// Range 1, like the Pholcus's own attack, so reach is easy to reason about.
const autoAct = { id: 'A1', type: 'Firing', speed: 'auto', range: 1 };
const drone = (uid, c, r, side = 's1') => tok(uid, '167', c * 3 + 1, r * 3 + 1, { side, kind: 'drone', label: 'Drone' });

check('with no enemy in range, the nearest Breakable Terrain is offered',
  M.autoNeutralTargets(data, [drone(1, 4, 4)], [box('t1', 5, 4)], drone(1, 4, 4), autoAct).map((x) => x.id), ['t1']);
// O9 is a FALLBACK: enemies always outrank Neutrals, so while one is in reach
// this must stay silent rather than adding to the list.
check('an enemy in range suppresses it entirely', (() => {
  const me = drone(1, 4, 4);
  return M.autoNeutralTargets(data, [me, foe(2, 5, 4)], [box('t1', 5, 4)], me, autoAct);
})(), []);
// O10, and it needs no list of its own: a building is not fragile.
check('a building is never offered, however close',
  M.autoNeutralTargets(data, [drone(1, 4, 4)], [wall('w1', 4, 4), wall('w2', 5, 4)], drone(1, 4, 4), autoAct), []);
check('terrain out of range is not offered',
  M.autoNeutralTargets(data, [drone(1, 4, 4)], [box('t1', 6, 4)], drone(1, 4, 4), autoAct), []);
// "The nearest" is the whole rule, so a farther piece loses even in range.
check('only the nearest is offered, not everything in range',
  M.autoNeutralTargets(data, [drone(1, 4, 4)], [box('near', 5, 4), box('far', 4, 4)], drone(1, 4, 4), { ...autoAct, range: 4 }).map((x) => x.id),
  ['far']);
// Ties come back together, the same way tied enemies do.
check('tied nearest pieces both come back',
  M.autoNeutralTargets(data, [drone(1, 4, 4)], [box('a', 5, 4), box('b', 3, 4)], drone(1, 4, 4), autoAct).map((x) => x.id), ['a', 'b']);
// Manhattan again: the diagonal is 2, so Range 1 cannot reach it.
check('a diagonal piece is range 2, so Range 1 misses it',
  M.autoNeutralTargets(data, [drone(1, 4, 4)], [box('t1', 5, 5)], drone(1, 4, 4), autoAct), []);
check('an empty board offers nothing', M.autoNeutralTargets(data, [drone(1, 4, 4)], [], drone(1, 4, 4), autoAct), []);

// ---------- THE PHOLCUS EDITION SPLIT (asked at a table, 2026-09-01) ----------
//
// Card 167's Automatic Attack says DIFFERENT THINGS in the two printings, and
// the difference is a rule:
//
//   EN  "On Detonation, cause Explosion damage to target unit."
//   ZH  "引爆时，对格内所有单位造成爆炸伤害"  - all units in the Grid.
//
// We follow the ENGLISH, and not merely by policy: the publisher's own
// championship-legal parts list (Part Data UN 1.02 [EN Public], "UN Drones EN",
// row 167 / LHDR-401) prints the English wording verbatim. That is the company's
// own English, not a community translation, so this is a real edition
// difference rather than a bad rendering of one original.
//
// The GM-35 Mine is the contrast that proves the reader is not just defaulting:
// its English DOES say all, and it comes back 'all'.
console.log('\nthe Pholcus, and what its two printings say');

const blast = (byId.get('167').actions ?? []).find((a) => a.type === 'Detonation');
check('the English still says a single target',
  /Explosion damage to target unit/i.test(blast.description.en), true);
check('while the Chinese still says every unit in the Grid',
  /所有单位/.test(blast.description.zh), true);
check('reading only the Chinese would give the other answer',
  M.explosionScope({ description: { zh: blast.description.zh } }), 'all');

// BOTH BOARDS, computed rather than grepped. explosionScope reads the printed
// English and drops to the CHINESE when a card has none - 63 damaging actions
// are in that state - so a page that fed it a translation and a page that did
// not could disagree about how many units an explosion hits. They pass the same
// thing now; this asserts the ANSWERS match for every damaging action in the
// box, which stays true even if the call signature changes again.
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const xlate = readJson('../../data/action_translations.json').translations ?? {};
const overrides = readJson('../../data/action_overrides.json').actions ?? {};
const disagree = [];
for (const c of cards) {
  for (const a of c.actions ?? []) {
    if (((a.redDice ?? 0) + (a.yellowDice ?? 0)) === 0) continue;
    const merged = { ...a, description: { ...a.description, ...(overrides[a.id] ?? {}).description } };
    const withXlate = M.explosionScope(merged, (xlate[a.id] ?? {}).english ?? undefined);
    const without = M.explosionScope(merged);
    if (withXlate !== without) disagree.push(`${c.id} ${a.id}`);
  }
}
check('no damaging action reads differently with the translation than without', disagree, []);
check('and both boards hand explosionScope the same translation', [
  /explosionScope\(action, data\.actionTranslation\(action\.id\)\?\.english/
    .test(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')),
  /explosionScope\(a, ctx\.data\.actionTranslation\(a\.id\)\?\.english/
    .test(readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8')),
], [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

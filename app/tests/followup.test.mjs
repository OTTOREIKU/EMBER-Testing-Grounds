// The bonus attack a card grants when it destroys a Part (FAQ B8).
//   The Katana's Chop reads "If this attack causes part destruction, may
//   perform |Slash| with this part immediately", and B8 settles the obvious
//   question: the bonus Slash must hit the SAME unit Chop hit, not a fresher
//   target. The target lock is structural — the combat helper re-runs the
//   attack against the same defender, so it cannot wander — and what is
//   testable here is which action gets offered, and off which Part.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const dataSrc = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
const cut = (from, to, what) => {
  const a = unitsSrc.indexOf(from);
  const b = unitsSrc.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('could not locate ' + what);
  return unitsSrc.slice(a, b);
};
const tmp = new URL('./_followup.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type Card = any;\ntype CardAction = any;\ntype GameData = any;\ntype Token = any;\ntype PartSlot = any;\n'
    + 'const PART_SLOTS = ["torso","chasis","leftHand","rightHand","backpack"];\n'
    + cut('export function tokenCards', '// ---------- Tarantula Loads', 'tokenCards')
    + cut('// A bonus attack a card grants', '// The Interception attempts', 'followUpAfterKill')
    + 'function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }\n'
    + 'function rangeBetween(a: any, b: any): any { const p = largeGridOf(a), q = largeGridOf(b);\n'
    + '  return { range: Math.abs(p.c - q.c) + Math.abs(p.r - q.r) }; }\n'
    + 'function alive(t: any): boolean { const k = t.kind === "mech" ? "torso" : "main";\n'
    + '  return (t.partStates?.[k] ?? "intact") !== "destroyed"; }\n'
    // isGroundUnit reads the card's flying base; sliced from data.ts rather
    // than stubbed so the real predicate decides what "ground" means. Note
    // isBarricade sits BEFORE isFlyingBase in that file, so it cannot be the
    // end marker — an end marker that precedes the start yields an EMPTY slice
    // and the failure reads as "isFlyingBase is not defined".
    + dataSrc.slice(dataSrc.indexOf('export function isFlyingBase'), dataSrc.indexOf('export function isAerial'))
    + cut('// A Mine\'s trigger asks for a GROUND Unit', 'export function minesOwed', 'isGroundUnit')
    + cut('// Which Moving Actions are a position SWAP', '// ---------- The Hyena', 'blinkTargets'),
);
const { followUpAfterKill, blinkTargets, isPositionSwap } = await import(tmp.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
const byId = new Map(cards.map((c) => [String(c.id), c]));
const data = { byId };

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Bonus attack on a kill — FAQ B8\n');

const katana = byId.get('145');
const chop = (katana.actions ?? []).find((a) => (a.name?.en ?? '') === 'Chop');
const slash = (katana.actions ?? []).find((a) => (a.name?.en ?? '') === 'Slash');
check('the Katana is in the data with both actions', [!!chop, !!slash], [true, true]);

// A Mech holding the Katana in one hand.
const mech = (over = {}) => ({
  uid: 1, side: 's1', kind: 'mech', cardId: '145', col: 3, row: 3, size: 3, facing: 0,
  mech: { torso: '546', leftHand: '145' }, partStates: { torso: 'intact', leftHand: 'intact' },
  ammo: {}, statuses: [], ...over,
});

check('Chop offers the Slash printed on the same Part',
  (() => { const f = followUpAfterKill(data, mech(), chop); return f && [f.card.id, f.action.name?.en]; })(),
  ['145', 'Slash']);
// The bonus does not chain: Slash's own text names nothing, so a kill with the
// bonus attack grants no further attack.
check('the Slash itself grants nothing, so it cannot chain',
  followUpAfterKill(data, mech(), slash), null);

// Any ordinary attack is unaffected — the offer is driven by the printed
// |name| reference, so a card that does not use it never triggers this.
const rifle = byId.get('025');
const single = (rifle.actions ?? [])[0];
check('an ordinary Firing action offers nothing', followUpAfterKill(data, mech(), single), null);

// "with this part" is the wording, so the named action is looked up on the card
// that struck. A Mech that is NOT holding the Katana gets nothing even if the
// action is passed in.
check('a Mech not carrying that Part gets no bonus',
  followUpAfterKill(data, mech({ mech: { torso: '546' } }), chop), null);

// The whole box currently has exactly one card written this way. If that ever
// changes the rule already covers it — but the count is pinned so the change
// is noticed rather than assumed.
const withPipe = cards.filter((c) => (c.actions ?? []).some((a) =>
  /\|[^|]+\|/.test(`${a.description?.en ?? ''}${a.description?.zh ?? ''}`)));
check('exactly one card grants a bonus attack this way', withPipe.map((c) => String(c.id)), ['145']);

// ---------- Prototype Blink (FAQ E17/E20) ----------

const taurus = byId.get('555');
const blink = (taurus.actions ?? []).find((a) => (a.name?.en ?? '') === 'Prototype Blink');
check('the Taurus carries Prototype Blink at Range 4', [!!blink, blink?.range, blink?.type], [true, 4, 'Moving']);

// It is typed Moving, so without this test it would fall into route-drawing.
check('it is recognised as a position swap, not a walk', isPositionSwap(blink), true);
// An ordinary Sprint must NOT be, or every Movement Action becomes a teleport.
const sprint = (byId.get('534')?.actions ?? [])[0];
check('an ordinary Sprint is not a swap', isPositionSwap(sprint), false);
check('and neither is a Firing action', isPositionSwap(chop), false);

const at = (uid, c, r, over = {}) => ({
  uid, side: 's1', kind: 'mech', cardId: '555', col: c * 3 + 1, row: r * 3 + 1, size: 3, facing: 0,
  aerial: false, label: `M${uid}`, mech: { torso: '555' }, partStates: { torso: 'intact' },
  ammo: {}, statuses: [], ...over,
});
const me = at(1, 4, 4);

check('a Ground Mech of the same size in range can be swapped with',
  blinkTargets(data, [me, at(2, 5, 4)], me, blink).map((x) => x.uid), [2]);
// E20.4 is explicit that either side may be taken.
check('an ALLY is a legal target too (E20.4)',
  blinkTargets(data, [me, at(2, 5, 4, { side: 's2' })], me, blink).map((x) => x.uid), [2]);
// Manhattan again: Range 4 reaches (4,4)->(8,4) but not (9,4).
check('range 4 reaches four Grids', blinkTargets(data, [me, at(2, 8, 4)], me, blink).length, 1);
check('and not five', blinkTargets(data, [me, at(2, 9, 4)], me, blink).length, 0);
// E20.4: "Drones, Terrain and similar targets cannot be chosen".
check('a Drone is refused however close',
  blinkTargets(data, [me, at(2, 5, 4, { kind: 'drone', size: 1 })], me, blink), []);
// The printed card adds this and the FAQ never mentions it, so it is the clause
// most easily lost: the target must be the SAME SIZE.
check('a Mech of a different size is refused (printed card)',
  blinkTargets(data, [me, at(2, 5, 4, { size: 2 })], me, blink), []);
// E20.4 again: ground only.
check('an Aerial Mech is refused',
  blinkTargets(data, [me, at(2, 5, 4, { aerial: true })], me, blink), []);
check('a destroyed Mech is not a partner',
  blinkTargets(data, [me, at(2, 5, 4, { partStates: { torso: 'destroyed' } })], me, blink), []);
check('nor one still waiting to deploy',
  blinkTargets(data, [me, at(2, 5, 4, { deployed: false })], me, blink), []);
check('and never itself', blinkTargets(data, [me], me, blink), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

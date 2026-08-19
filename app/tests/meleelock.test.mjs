// Checks the four Melee Lock conditions and who can be locked (rulebook 4.3.5,
// with the worked notes on book p.46).
import { readFileSync, writeFileSync } from 'node:fs';

const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const rStart = rules.indexOf('export const LG');
const rEnd = rules.indexOf('export function rangeBetween');
writeFileSync(
  new URL('./_meleelock.rules.ts', import.meta.url),
  'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + rules.slice(rStart, rEnd),
);

const melee = readFileSync(new URL('../src/melee.ts', import.meta.url), 'utf8');
const body = melee.slice(melee.indexOf('const MELEE_FIRING'));
writeFileSync(
  new URL('./_meleelock.slice.ts', import.meta.url),
  `type GameData = any;\ntype CardAction = any;\ntype PartSlot = any;\ntype TerrainPiece = any;\ntype Token = any;
import { largeGridOf, losBetween, standingSpot } from './_meleelock.rules.ts';
const statusCount = (list: any, id: string) => (list ?? []).filter((x: string) => x === id).length;
const isDeployed = (t: any) => t.deployed !== false;
const tokenCards = (data: any, t: any) => data.cardsOf(t);
` + body,
);
const M = await import(new URL('./_meleelock.slice.ts', import.meta.url).href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

// A Mech carries Punch/Kick on the Chassis and both Hands, so the fixture only
// has to say which parts survive; a Drone carries whatever its card prints.
const PUNCH = { id: 'COMMON_PUNCH_MELEE', slots: ['chasis', 'leftHand', 'rightHand'] };
const data = {
  commonActions: [PUNCH],
  cardsOf: (t) => t.cards ?? [],
};
const mech = (uid, side, c, r, extra = {}) => ({
  uid, side, kind: 'mech', label: `m${uid}`, size: 1, aerial: false, stance: 'offensive',
  col: c * 3 + 1, row: r * 3 + 1, cards: [],
  partStates: { torso: 'intact', chasis: 'intact', leftHand: 'intact', rightHand: 'intact' },
  ...extra,
});
const drone = (uid, side, c, r, actions, extra = {}) => ({
  uid, side, kind: 'drone', label: `d${uid}`, size: 1, aerial: false, stance: 'offensive',
  col: c * 3 + 1, row: r * 3 + 1, partStates: { main: 'intact' },
  cards: [{ slot: 'main', card: { actions } }], ...extra,
});
const wall = (c, r) => ({
  id: `w${c}${r}`, type: 'building', height: 3, blocksLos: true, providesProtection: true, isFragile: false,
  subCells: [0, 1, 2].flatMap((dc) => [0, 1, 2].map((dr) => ({ col: c * 3 + dc, row: r * 3 + dr }))),
});
const lock = (me, others, terrain = []) => M.lockersOf(data, me, [me, ...others], terrain).map((t) => t.uid);

console.log('Melee Lock\n');

// Condition 1: the locker needs a Melee Action.
const target = mech(1, 's1', 2, 2);
check('an adjacent enemy mech locks', lock(target, [mech(2, 's2', 2, 3)]), [2]);
check('a shutdown mech cannot lock', lock(target, [mech(2, 's2', 2, 3, { stance: 'shutdown' })]), []);
check('a mech with no chassis or hands cannot lock', lock(target, [mech(2, 's2', 2, 3, { partStates: { torso: 'intact', chasis: 'destroyed', leftHand: 'destroyed', rightHand: 'destroyed' } })]), []);
check('one surviving hand is enough', lock(target, [mech(2, 's2', 2, 3, { partStates: { chasis: 'destroyed', leftHand: 'destroyed', rightHand: 'intact' } })]), [2]);
check('a drone with no melee action cannot lock', lock(target, [drone(3, 's2', 2, 3, [{ type: 'Firing' }])]), []);
check('a drone with one can', lock(target, [drone(3, 's2', 2, 3, [{ type: 'Melee' }])]), [3]);
check('a drone whose hull is gone cannot', lock(target, [drone(3, 's2', 2, 3, [{ type: 'Melee' }], { partStates: { main: 'destroyed' } })]), []);

// Condition 2: adjacency, which includes the diagonals.
check('a diagonal neighbour locks', lock(target, [mech(2, 's2', 3, 3)]), [2]);
check('two grids away does not', lock(target, [mech(2, 's2', 2, 4)]), []);
check('sharing a grid does', lock(target, [mech(2, 's2', 2, 2)]), [2]);

// Condition 3: line of sight.
check('a wall between them blocks the lock', lock(target, [mech(2, 's2', 2, 4)], [wall(2, 3)]), []);

// Condition 4: the target must not be a Flying Unit. Optical Camouflage runs
// the OTHER way (FAQ I8): a camouflaged unit CAN be locked, but locks nobody.
check('an aerial unit is never locked', lock({ ...target, aerial: true }, [mech(2, 's2', 2, 3)]), []);
check('a camouflaged unit can still be locked (I8)', lock({ ...target, statuses: ['camouflage'] }, [mech(2, 's2', 2, 3)]), [2]);
check('a camouflaged unit locks nobody (I8)', lock(target, [mech(2, 's2', 2, 3, { statuses: ['camouflage'] })]), []);
check('an undeployed enemy does not lock', lock(target, [mech(2, 's2', 2, 3, { deployed: false })]), []);
check('an undeployed unit is not locked either', lock({ ...target, deployed: false }, [mech(2, 's2', 2, 3)]), []);

// Sides, and locking by more than one enemy at once.
check('a friendly mech never locks', lock(target, [mech(2, 's1', 2, 3)]), []);
check('two enemies both lock', lock(target, [mech(2, 's2', 2, 3), mech(4, 's2', 1, 2)]), [2, 4]);
check('and meleeLocked agrees', M.meleeLocked(data, target, [target, mech(2, 's2', 2, 3)], []), true);
check('with nobody near, it does not', M.meleeLocked(data, target, [target], []), false);

// Break Away asks the question of Grids the unit has not reached yet, which is
// what makes the cost vary along a route.
const cost = M.breakAwayCost(data, target, [target, mech(2, 's2', 2, 3)], []);
check('leaving the starting grid is taxed', cost(2, 2), 1);
check('the grid next to the locker too', cost(3, 3), 1);
check('but a grid out of reach is free', cost(2, 0), 0);
check('and the answer is stable when asked twice', [cost(2, 2), cost(2, 2)], [1, 1]);

// Melee Firing is the printed exemption from the Firing ban.
check('a melee firing action is exempt', M.isMeleeFiring({ keywords: [{ key: '近战射击' }] }), true);
check('an ordinary one is not', M.isMeleeFiring({ keywords: [{ key: '狙击' }] }), false);
check('and neither is one with no keywords', M.isMeleeFiring({}), false);

// Forced Movement only shifts what has Movement in principle (4.3.4).
check('a mech can always be force-moved', M.canBeForceMoved(data, mech(1, 's1', 0, 0)), true);
check('even one with a destroyed chassis', M.canBeForceMoved(data, mech(1, 's1', 0, 0, { partStates: { chasis: 'destroyed' } })), true);
check('a drone that moves can be', M.canBeForceMoved(data, drone(3, 's2', 0, 0, [{ type: 'Moving' }])), true);
check('so can one with a printed move value', M.canBeForceMoved(data, { kind: 'drone', cards: [{ slot: 'main', card: { move: 2 } }] }), true);
check('a deployable that cannot move cannot be', M.canBeForceMoved(data, drone(3, 's2', 0, 0, [{ type: 'Firing' }])), false);

// ---------- Melee Firing (近战射击) ----------
//
// "This action can still be performed during Melee Lock." Reported from a live
// game 2026-08-19: card 540 S9 Meteor Shield + IGX106 Ion Shotgun was barred
// from firing while locked even though its Single Shot prints the keyword.
//
// The reader matched on `k.key`, but an Action prints its keywords as `inline`
// — so it found 0 of the 26 Actions that carry it and EVERY Melee Firing weapon
// was silently barred. Driven against the real cards, because a fixture would
// have been written in whichever shape the code already read.
{
  const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
  const all = Array.isArray(raw) ? raw : raw.cards;
  const acts = all.flatMap((c) => (c.actions ?? []).map((a) => ({ card: String(c.id), a })));
  const carry = acts.filter(({ a }) => (a.keywords ?? []).some((k) => (k.inline ?? k.key) === '近战射击'));
  check('the shipped cards really do carry Melee Firing', carry.length > 20, true);
  check('and none of them stores it as `key`, which is what the reader used to check',
    acts.filter(({ a }) => (a.keywords ?? []).some((k) => k.key === '近战射击')).length, 0);
  // The card from the report.
  const shotgun = acts.find(({ card, a }) => card === '540' && a.id === '540_B').a;
  check('540_B Ion Shotgun is Melee Firing', M.isMeleeFiring(shotgun), true);
  check('and every card that prints it now reads as such',
    carry.filter(({ a }) => !M.isMeleeFiring(a)).map(({ card }) => card), []);
  // The ban still applies to a gun that does NOT print it.
  const plain = acts.find(({ a }) => a.type === 'Firing' && !(a.keywords ?? []).some((k) => (k.inline ?? k.key) === '近战射击')).a;
  check('a Firing Action without the keyword is still barred while locked', M.isMeleeFiring(plain), false);
}

// ---------- LPA-20 Panzer's 阻拦 Obstruct ----------
//
// "When Breaking Away from the piloted mech, the Enemy Unit needs to consume 1
// additional Move Range or 1 Link." breakAwayCost lives in this file's slice,
// so the price is driven here — with the PILOT taken from the shipped
// cards.json, because which pilot is the whole rule and a fixture id would pass
// against a reader keyed on the wrong card.
{
  const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
  const all = Array.isArray(raw) ? raw : raw.cards;
  const byId = new Map(all.map((c) => [String(c.id), c]));
  const panzer = byId.get('LPA-20');
  // The negative control is a real UN LV4 pilot whose trait is a dice exchange,
  // so it can never bend a movement price.
  const sealock = byId.get('LPA-24');
  if (!panzer || !sealock) throw new Error('LPA-20 or LPA-24 is missing from cards.json');
  check('LPA-20 is the Obstruct card and LPA-24 is not',
    [panzer.trait, sealock.trait], ['阻拦', '追击']);
  check('and its curated effect names the surcharge',
    panzer.traitEffects?.map((e) => [e.type, e.value]), [['breakaway_extra_cost_or_link', 1]]);

  const flees = mech(1, 's1', 2, 2);
  const piloted = (uid, c, r, id) => mech(uid, 's2', c, r, { mech: { torso: '002', pilot: id } });
  const ordinary = M.breakAwayCost(data, flees, [flees, piloted(2, 2, 3, sealock.id)], []);
  check('an ordinary locker still charges 1 to leave a Grid', ordinary(2, 2), 1);
  const held = M.breakAwayCost(data, flees, [flees, piloted(2, 2, 3, panzer.id)], []);
  check('a Panzer charges 2', held(2, 2), 2);
  const both = M.breakAwayCost(data, flees, [flees, piloted(2, 2, 3, panzer.id), piloted(3, 3, 3, sealock.id)], []);
  check('and the surcharge is PER LOCKER, so one of each costs 3', both(2, 2), 3);
  check('a Grid the Panzer cannot reach is still free', held(2, 0), 0);

  // The trait sits on the LOCKER, never on the unit leaving: a Panzer running
  // away from somebody else pays the ordinary price.
  const panzerFlees = mech(1, 's1', 2, 2, { mech: { torso: '002', pilot: panzer.id } });
  const away = M.breakAwayCost(data, panzerFlees, [panzerFlees, piloted(2, 2, 3, sealock.id)], []);
  check('a Panzer BREAKING AWAY pays the ordinary 1, because the trait is the locker\'s', away(2, 2), 1);

  // The sentence and the price come off one helper, or a board quotes a number
  // the search does not charge.
  const note = M.breakAwayNote(data, flees, [flees, piloted(2, 2, 3, panzer.id)], []);
  check('the note reports the real cost, not the locker count', /costs 2 extra Movement Range/.test(note), true);
  check('and names the Panzer as the reason', /m2 charges 1 more \(Obstruct, LPA-20\)/.test(note), true);
  // The "or 1 Link" alternative is a live open ruling, so it is DISCLOSED
  // rather than priced — warn, do not hide.
  check('and discloses the Link alternative the app does not price',
    /may instead be paid as 1 Link/.test(note), true);
  // TWO Obstruct lockers, which is where the sentence used to part company with
  // its own number: the verb agreed with the locker count while both prices
  // stayed hard-coded at 1, so the note quoted a 2-Range surcharge and then
  // offered to sell it for 1 Link. Both halves come off held.length now, and
  // this is the case that says so.
  const twoPanzers = M.breakAwayNote(data, flees, [flees, piloted(2, 2, 3, panzer.id), piloted(3, 3, 3, panzer.id)], []);
  check('two Panzers cost 4 extra Movement Range between them',
    /costs 4 extra Movement Range/.test(twoPanzers), true);
  check('and the Obstruct sentence quotes the SAME number twice',
    [/m2 and m3 charge 2 more \(Obstruct, LPA-20\)/.test(twoPanzers), /may instead be paid as 2 Link/.test(twoPanzers)],
    [true, true]);
  // Two lockers, two separate printed "or 1 Link" offers — the surcharge is not
  // one lump the mover must buy out in full.
  check('and says the Link may be taken one locker at a time',
    /one per Obstruct locker and each choosable on its own/.test(twoPanzers), true);
  const plainNote = M.breakAwayNote(data, flees, [flees, piloted(2, 2, 3, sealock.id)], []);
  check('an ordinary lock says none of that', [/costs 1 extra/.test(plainNote), /Obstruct/.test(plainNote)], [true, false]);
  check('and an unlocked unit gets no note at all', M.breakAwayNote(data, flees, [flees], []), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

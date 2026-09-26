// MECHANICS AUDIT, PHASE 4 (2026-09-26): movement and position, driven through
// the real command layer, the real readers and the shipped cards. Each block is
// one finding of Project-Documents/MECHANICS-AUDIT.md (the letters match its
// sections), pinned by behaviour rather than by the shape of the source, and
// each was mutation-checked: put its fix back the way it was and it fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_mechanics4.entry.ts', import.meta.url);
const out = new URL('./_mechanics4.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { check, apply } from '../src/commands';",
  "export { loadData } from '../src/data';",
  "export { glueAfter } from '../src/glue';",
  "export { newScriptState } from '../src/types';",
  "export * as U from '../src/units';",
  "export * as D from '../src/data';",
  "export * as R from '../src/rules';",
  "export * as ML from '../src/melee';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const { U, D, R, ML } = M;
const data = await M.loadData();

// ---------- a scripted table, the way a strict guided page holds one ----------
function table() {
  return {
    v: 3, map: '', tokens: [], nextUid: 1,
    round: { n: 1, phase: 2, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    script: { ...M.newScriptState('s1'), strict: true },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
  };
}
const G = (c, r) => ({ col: c * 3, row: r * 3 });
const L = (extra = {}) => ({ torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2', ...extra });
function put(s, side, loadout, c, r, extra = {}) {
  const t = { ...U.makeMechToken(s, data, loadout, side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
function droneOn(s, side, cardId, c, r, extra = {}) {
  const t = { ...U.makeDroneToken(s, data, data.byId.get(cardId), side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
const send = (s, cmd) => {
  const v = M.check(data, s, cmd);
  if (v.ok) { M.apply(data, s, cmd); M.glueAfter(data, s, cmd); }
  return v;
};
const ok = (s, cmd) => M.check(data, s, cmd).ok;
const why = (s, cmd) => M.check(data, s, cmd).why ?? '';
const card = (cardId, actionId) => data.byId.get(cardId)?.actions?.find((a) => a.id === actionId);
const opp = (uid, over = {}) => ({ uid, timing: 'movement', extra: undefined, maneuver: 1, action: 2, extras: [], maneuvered: false, moved: false, started: false, overload: 0, performed: [], spentExtras: [], ...over });
const gridOf = (t) => [Math.floor(t.col / 3), Math.floor(t.row / 3)];

console.log('Phase 4: movement and position\n');

// ================= A. Flight (A1, A2, A3) =================
{
  // A1: the GoF 1.021 movement column. Valkyrie, Harpy and the Eagles fly; SU1
  // is Aerial.
  check('A1 the five GoF flyers are Flying bases',
    ['ZHDR-204', 'ZHDR-205', 'ZHDR-206', 'ZHDR-303', 'ZHDR-304'].map((id) => D.isFlyingBase(data.byId.get(id))), [true, true, true, true, true]);
  check('A1 and SU1 is Aerial', D.isAerial(data.byId.get('ZYDR-108')), true);
  const s = table();
  const eagle = droneOn(s, 's1', 'ZHDR-206', 4, 4);
  check('A1 a Flying base is not a Ground Unit', U.isGroundUnit(data, eagle), false);
  // A3: 4.3.5 condition 4 exempts a Flying Unit from Melee Lock, not only an
  // Aerial one.
  put(s, 's2', L(), 5, 4);
  check('A3 an adjacent enemy Mech does not Melee Lock it', ML.lockersOf(data, eagle, s.tokens, []).length, 0);
  // A2: a cruising White Dwarf is a Flying Unit at all times.
  const dwarf = put(s, 's1', L({ torso: '288' }), 8, 8);
  check('A2 Cruise Mode flies every move', U.flightGrant(data, dwarf), 'always');
  check('A2 and is no Ground Unit', U.isGroundUnit(data, dwarf), false);
  const walker = put(s, 's1', L(), 8, 2);
  check('A2 the control: an ordinary Mech walks and is a Ground Unit', [U.flightGrant(data, walker), U.isGroundUnit(data, walker)], ['none', true]);
}

// ================= B. Forced Movement (B2, B4) and C. Crush =================
{
  // C2: Beacons are ground Deployables; a Mine stays Aerial.
  const beacons = ['072', '075', '076', '077', 'PDAM-006'].filter((id) => data.byId.get(id));
  check('C2 every Beacon is a Beacon and not Aerial', beacons.map((id) => [D.isBeacon(data.byId.get(id)), D.isAerial(data.byId.get(id))]), beacons.map(() => [true, false]));
  const s = table();
  const beacon = droneOn(s, 's2', '072', 5, 5);
  // B2: 4.3.4, a unit that cannot move cannot be Force-Moved.
  check('B2 a Beacon cannot be Force-Moved', ML.canBeForceMoved(data, beacon), false);
  const mech = put(s, 's1', L(), 5, 4);
  check('B2 a forceMove to another Grid is refused',
    ok(s, { kind: 'forceMove', seat: 's1', uid: mech.uid, targetUid: beacon.uid, to: G(5, 6) }), false);
  check('B2 while turning it where it stands is not',
    ok(s, { kind: 'forceMove', seat: 's1', uid: mech.uid, targetUid: beacon.uid, to: { col: beacon.col, row: beacon.row }, facing: 2 }), true);
  // C2: a Crush destroys one outright rather than passing over it.
  check('C2 a Large Mech Crushes a Beacon', !!R.crushTargets(mech, 5, 5, [], s.tokens)?.units.some((u) => u.uid === beacon.uid), true);
}
{
  // C1: the victim goes to "any of the three grids shown": never the Grid the
  // crusher is stepping out of, which it is still standing in.
  const s = table();
  const crusher = put(s, 's1', L(), 1, 0);
  const victim = droneOn(s, 's2', '160', 1, 2);
  const esc = R.crushEscapeGrids(victim, { c: 1, r: 2 }, crusher, { c: 1, r: 1 }, [], s.tokens).map((g) => `${g.c},${g.r}`).sort();
  check('C1 the escapes leave out the step-out Grid', esc.includes('1,1'), false);
  check('C1 and offer the three others', esc, ['0,2', '1,3', '2,2']);
  // C5: the two refusals crushTargets makes and the command did not.
  const hidden = put(s, 's1', L(), 6, 6, { statuses: ['camouflage'] });
  const d2 = droneOn(s, 's2', '160', 6, 7);
  const swap = { kind: 'crushSwap', seat: 's1', uid: hidden.uid, to: G(6, 7), swaps: [{ uid: d2.uid, to: { col: 19, row: 19 } }] };
  check('C5 a camouflaged crusher is refused', /camouflaged Unit cannot Crush/.test(why(s, swap)), true);
}
{
  // C3: a Firefly in Low Profile passes through a smaller unit; the Crush only
  // happens where its route ends.
  const s = table();
  const fly = put(s, 's1', L({ pilot: 'LPA-21' }), 1, 1, { statuses: ['lowProfile'] });
  droneOn(s, 's2', '160', 2, 1);
  const opts = { crushable: (c, r) => R.crushTargets(fly, c, r, [], s.tokens) !== null, phaseThrough: U.phasesThroughUnits(data, s.tokens, fly) };
  const grids = R.reachableGrids(fly, 3, [], s.tokens, false, opts).map((g) => `${g.c},${g.r}`);
  check('C3 it reaches past the Drone it phases through', grids.includes('3,1'), true);
  check('C3 and may still end on it, where the Crush happens', grids.includes('2,1'), true);
}

// ================= D. Melee Lock and Break Away =================
{
  const s = table();
  const me = put(s, 's1', L(), 4, 4, { link: 4 });
  const panzer = put(s, 's2', L({ pilot: 'LPA-20' }), 5, 4);
  // D2: Obstruct makes the step out cost 2, and 1 of it may be paid in Link.
  const away = ML.breakAwayCost(data, me, s.tokens, []);
  check('D2 a Panzer lock costs 2 to leave', away(4, 4), 2);
  const base = { exitCost: away };
  const paid = { exitCost: away, linkPay: { budget: ML.breakAwayLinkBudget(me), payable: ML.obstructSurcharge(data, me, s.tokens, []) } };
  const reach = (o) => R.reachableGrids(me, 2, [], s.tokens, false, o).map((g) => `${g.c},${g.r}`);
  // Leaving costs 1 for the step and 2 for the lock: 3, one more than the
  // Maneuver has. The Obstruct half of the lock may be paid in Link.
  check('D2 without Link a 2-step Maneuver cannot leave the lock at all', reach(base).includes('3,4'), false);
  check('D2 with Link it can, 1 for the Obstruct surcharge', reach(paid).includes('3,4'), true);
  const path = R.movePath(me, { c: 3, r: 4 }, 2, [], s.tokens, false, paid);
  check('D2 and the route owes exactly 1 Link', R.breakAwayLinkDue(path, 2, false, paid), 1);
  check('D2 never the last Link', ML.breakAwayLinkBudget({ ...me, link: 1 }), 0);
  const mv = { kind: 'maneuver', seat: 's1', uid: me.uid, to: G(4, 4), breakAwayLink: 4 };
  s.script.opp = opp(me.uid);
  check('D2 the maneuver refuses paying the last Link', /never spends its last Link/.test(why(s, mv)), true);
  void panzer;
}
{
  // D5: a Repaired Part acts (FAQ J23), so it locks.
  const s = table();
  const wreck = put(s, 's2', L(), 5, 4);
  for (const slot of ['chasis', 'leftHand', 'rightHand']) wreck.partStates[slot] = 'destroyed';
  const target = put(s, 's1', L(), 4, 4);
  check('D5 with its limbs destroyed it locks nobody', ML.lockersOf(data, target, s.tokens, []).length, 0);
  wreck.repairedSlots = ['rightHand'];
  check('D5 a Repaired arm locks again', ML.lockersOf(data, target, s.tokens, []).length, 1);
}
{
  // D6: the Firing ban is the command's too, on a board it can see.
  const s = table();
  const shooter = put(s, 's1', L(), 4, 4, { timing: 'firing' });
  put(s, 's2', L(), 5, 4);
  s.script.opp = opp(shooter.uid, { timing: 'firing' });
  const fire = { kind: 'performAction', seat: 's1', uid: shooter.uid, actionId: '058_B', partKey: '058_B' };
  check('D6 a Melee Locked Mech is refused a Firing Action', /Melee Locked/.test(why(s, fire)), true);
  s.tokens.pop();
  check('D6 and allowed it once free', ok(s, fire), true);
  // D1: the Lock does not stop Interception (ruled I2).
  const guard = put(s, 's1', L(), 9, 9);
  put(s, 's2', L(), 10, 9);
  const rows = U.guidedActions(data, guard, { tokens: s.tokens, terrain: [] }).filter((g) => g.intercept);
  check('D1 a Locked unit may still Intercept', rows.every((g) => !/Melee Lock/i.test(g.intercept.reason ?? '')), true);
}

// ================= E. The Maneuver, Stationary and Movement Actions =================
{
  // E1: a free Movement, here a Shock Attack walk, spoils [Stationary].
  const s = table();
  const lancer = put(s, 's1', L({ rightHand: 'ZHRA-103' }), 4, 4, { stance: 'offensive', timing: 'melee' });
  s.script.opp = opp(lancer.uid, { timing: 'melee' });
  check('E1 the Spear\'s attack carries a Movement', U.actionMoves(card('ZHRA-103', 'ZHRA-103_A')), true);
  send(s, { kind: 'performAction', seat: 's1', uid: lancer.uid, actionId: 'ZHRA-103_A', partKey: 'ZHRA-103_A' });
  check('E1 so a free move is owed', s.script.opp.moveOwed, true);
  send(s, { kind: 'maneuver', seat: 's1', uid: lancer.uid, to: G(5, 4), free: true, actionId: 'ZHRA-103_A' });
  check('E1 and making it marks the Opportunity moved', s.script.opp.moved, true);
  // The same on a table with no board, where the pad sends it.
  const t = table();
  t.noBoard = true;
  const pad = put(t, 's1', L({ rightHand: 'ZHRA-103' }), 4, 4, { stance: 'offensive' });
  t.script.opp = opp(pad.uid, { timing: 'melee', performed: ['ZHRA-103_A'], moveOwed: true });
  send(t, { kind: 'maneuver', seat: 's1', uid: pad.uid, to: { col: 0, row: 0 }, free: true, actionId: 'ZHRA-103_A' });
  check('E1 a boardless free move marks it too', t.script.opp.moved, true);
}
{
  // E2: never the last Link.
  const run = card('181', '181_A');
  check('E2 exactly the cost is refused', typeof U.nonHumanoidStop({ label: 'C', link: 1, statuses: [] }, run), 'string');
  check('E2 one more is allowed', U.nonHumanoidStop({ label: 'C', link: 2, statuses: [] }, run), null);
}
{
  // E3: Unstoppable is the printed exception to Immobilized.
  const s = table();
  const cent = put(s, 's1', L({ chasis: '181' }), 4, 4, { statuses: ['immobilized'], link: 4 });
  const rows = U.guidedActions(data, cent, { tokens: s.tokens, terrain: [] });
  const rowOf = (id) => rows.find((g) => g.action.id === id);
  const unstoppable = ['181_A', '181_B'].find((id) => /不可阻挡|Unstoppable/i.test(JSON.stringify(card('181', id))));
  if (unstoppable) check('E3 the Unstoppable Move Action is not greyed by Immobilized', /Immobilized/.test(rowOf(unstoppable)?.blocked ?? ''), false);
  check('E3 the Standard Sprint still is', /Immobilized/.test(rows.find((g) => g.action.type === 'Moving' && g.action.id !== unstoppable)?.blocked ?? 'Immobilized'), true);
}
{
  // E6: the Mortar's [Stationary] Range +1 reaches its launch.
  const s = table();
  const mortar = put(s, 's1', L({ leftHand: 'ZHLA-201' }), 4, 4);
  const act = card('ZHLA-201', 'ZHLA-201_A');
  check('E6 standing still it reaches 9', U.projectileReach(data, mortar, act, opp(mortar.uid)), (act.range ?? 0) + 1);
  check('E6 having moved it reaches 8', U.projectileReach(data, mortar, act, opp(mortar.uid, { moved: true })), act.range ?? 0);
}
{
  // E7 / I10: a destroyed Chassis performs no Movement Action; E8: the
  // Maneuver may only turn it.
  const s = table();
  const lame = put(s, 's1', L({ backpack: '088' }), 4, 4);
  lame.partStates.chasis = 'destroyed';
  s.script.opp = opp(lame.uid);
  check('I10 no Movement Action on a destroyed Chassis', /Chassis is destroyed/.test(why(s, { kind: 'performAction', seat: 's1', uid: lame.uid, actionId: '088_A', partKey: '088_A' })), true);
  check('E8 its Maneuver is refused a step', ok(s, { kind: 'maneuver', seat: 's1', uid: lame.uid, to: G(5, 4) }), false);
  check('E8 but may turn it', ok(s, { kind: 'maneuver', seat: 's1', uid: lame.uid, to: G(4, 4), facing: 2 }), true);
  // E8: a ceiling for everyone else too.
  const walker = put(s, 's1', L(), 8, 8);
  s.script.opp = opp(walker.uid);
  check('E8 a Maneuver Value of 1 is refused two Grids', ok(s, { kind: 'maneuver', seat: 's1', uid: walker.uid, to: G(10, 8) }), false);
  check('E8 and allowed one', ok(s, { kind: 'maneuver', seat: 's1', uid: walker.uid, to: G(9, 8) }), true);
  // E7: Blink is a Movement Action, and needs an Opportunity in a guided game.
  const taurus = put(s, 's1', L({ torso: '555' }), 2, 8, { statuses: ['immobilized'] });
  const blinkId = (data.byId.get('555')?.actions ?? []).find((a) => U.isPositionSwap(a))?.id;
  if (blinkId) {
    s.script.opp = opp(taurus.uid);
    const partner = put(s, 's1', L(), 3, 8);
    check('E7 an Immobilized Taurus cannot Blink', ok(s, { kind: 'blink', seat: 's1', uid: taurus.uid, actionId: blinkId, targetUid: partner.uid }), false);
    taurus.statuses = [];
    s.script.opp = null;
    check('E7 nor Blink outside its own Opportunity', ok(s, { kind: 'blink', seat: 's1', uid: taurus.uid, actionId: blinkId, targetUid: partner.uid }), false);
  }
}

// ================= G. Smoke and line of sight =================
{
  // G1: any clear base-to-base line is sight, not only the centre line.
  const a = { uid: 1, col: 0, row: 3, size: 3, aerial: false };
  const b = { uid: 2, col: 12, row: 3, size: 3, aerial: false };
  // A screen in Grid (2,1) sits on the centre line; Grid (2,1) covers rows 3-5,
  // so every line between two bases on rows 3-5 crosses it.
  check('G1 a screen across every line blocks', R.firingSight(a, b, [], [], [{ col: 2, row: 1, side: 's2' }]), 'smoked');
  // A Medium target half out of the screen's row: some lines pass clear.
  const b2 = { uid: 2, col: 12, row: 5, size: 2, aerial: false };
  const clearOne = R.firingSight({ ...a, row: 5, size: 2 }, b2, [], [], [{ col: 2, row: 1, side: 's2' }]);
  check('G1 a clear line past it is sight', clearOne !== 'smoked', true);
  check('G1 smokeBlocks agrees with firingSight', R.smokeBlocks({ ...a, row: 5, size: 2 }, b2, [{ col: 2, row: 1, side: 's2' }]), clearOne === 'smoked');
  // F2: an Aerial unit in a smoked Grid is no exception.
  check('F2 an Aerial unit standing in smoke cannot be seen', R.firingSight(a, { ...b, aerial: true }, [], [], [{ col: 4, row: 1, side: 's2' }]), 'smoked');
  check('G12 inSmoke reads the screens', [R.inSmoke(b, [{ col: 4, row: 1, side: 's2' }]), R.inSmoke(b, [])], [true, false]);
}
{
  // G2: an Automatic Firing Action takes the nearest enemy IN SIGHT.
  const s = table();
  const drone = droneOn(s, 's1', '160', 4, 4, { facing: 1 });
  const near = put(s, 's2', L(), 6, 4);
  const far = put(s, 's2', L(), 7, 5);
  const auto = (card(drone.cardId, (data.byId.get(drone.cardId)?.actions ?? []).find((a) => a.speed === 'auto' && a.type === 'Firing')?.id));
  if (auto) {
    const smoke = [{ col: 6, row: 4, side: 's2' }];
    const legal = U.autoTargetsFor(data, s.tokens, drone, { ...auto, range: 9 }, { terrain: [], smoke }).map((x) => x.uid);
    check('G2 a smoked nearer enemy gives way to a clear farther one', legal, [far.uid]);
    check('G2 with no board the Range alone decides', U.autoTargetsFor(data, s.tokens, drone, { ...auto, range: 9 }).map((x) => x.uid), [near.uid]);
    // The Porcupine prints Omni-direction Firing, which waives the arc: strip it
    // to see the arc bind an ordinary Automatic Action.
    drone.facing = 3;
    check('G2 an Omni-direction one still shoots behind it', U.autoTargetsFor(data, s.tokens, drone, { ...auto, range: 9 }, { terrain: [], smoke: [] }).length > 0, true);
    const plain = { ...auto, range: 9, keywords: (auto.keywords ?? []).filter((k) => !/全向/.test(JSON.stringify(k))) };
    check('G2 an ordinary one takes nobody behind its Forward Arc', U.autoTargetsFor(data, s.tokens, drone, plain, { terrain: [], smoke: [] }).length, 0);
  }
}
{
  // G6: one screen per squad per Grid, and removal by owner.
  const s = table();
  s.smoke = [{ col: 3, row: 3, side: 's1' }, { col: 3, row: 3, side: 's2' }];
  check('G6 a second screen of the same squad is refused', ok(s, { kind: 'placeSmoke', seat: 's1', for: 's1', at: { col: 3, row: 3 } }), false);
  send(s, { kind: 'removeSmoke', seat: 's1', side: 's2', at: { col: 3, row: 3 } });
  check('G6 removal takes the named squad\'s screen', s.smoke.map((x) => x.side), ['s1']);
  // G7: dissipation once per End Phase.
  const e = table();
  e.round.phase = 5;
  e.smoke = [{ col: 1, row: 1, side: 's1' }];
  check('G7 the first dissipation goes', send(e, { kind: 'dissipateSmoke', seat: 's1' }).ok, true);
  check('G7 and records the round', e.smokeRound, 1);
  check('G7 a second in the same End Phase is refused', ok(e, { kind: 'dissipateSmoke', seat: 's1' }), false);
  send(e, { kind: 'resetRounds', seat: 's1' });
  check('G7 winding the rounds back clears it', e.smokeRound, undefined);
}
{
  // H5 and 4.6.2: Link Shock waives distance only; Extended Melee needs sight.
  const a = { uid: 1, side: 's1', col: 0, row: 0, size: 3, facing: 1, aerial: false };
  const far = { uid: 2, side: 's2', col: 27, row: 0, size: 3, facing: 0, aerial: false };
  const shock = R.losNote(a, far, { type: 'Melee', range: 0, anyDistance: true }, [], [], [], true);
  check('H5 Link Shock is told distance does not matter', [/Link Shock/.test(shock), /not adjacent/.test(shock)], [true, false]);
  const behind = R.losNote({ ...a, facing: 3 }, far, { type: 'Melee', range: 0, anyDistance: true }, [], [], [], true);
  check('H5 but keeps the Forward Arc', /✕ NOT in forward arc/.test(behind), true);
  const wall = { id: 'w', subCells: [{ col: 4, row: 0 }, { col: 4, row: 1 }, { col: 4, row: 2 }], blocksLos: true };
  const harpoon = R.losNote(a, { ...far, col: 6 }, { type: 'Melee', range: 4 }, [wall], [], [], true);
  check('4.6.2 Extended Melee is refused through 3-inch terrain', /Extended Melee needs line of sight/.test(harpoon), true);
}

// ================= H / I16. Tether =================
{
  const s = table();
  const holder = put(s, 's1', L(), 4, 4);
  const held = put(s, 's2', L({ torso: '096' }), 5, 4, { statuses: ['camouflage'] });
  U.tetherTo(holder, held, 2);
  // I16: a Manifestation is held by the leash.
  check('I16 no Manifestation Grid past the leash is offered',
    U.manifestTargets(data, s.tokens, [], held, s).every((g) => Math.abs(g.c - 4) + Math.abs(g.r - 4) <= 2), true);
  const hop = { kind: 'reveal', seat: 's2', uid: held.uid, to: G(7, 4) };
  check('I16 and a reveal past it is refused', /cannot Manifest beyond 2 Grids/.test(why(s, hop)), true);
  // H3: a Penetration recorded by hand cuts the initiator's Tether.
  send(s, { kind: 'setPartState', seat: 's1', uid: holder.uid, slot: 'rightHand', state: 'destroyed' });
  check('H3 a hand-set Penetration on the initiator ends it', [holder.tether, held.tether], [undefined, undefined]);
}
{
  // H1: on a table with no board, a partner gone from the table ends it, and
  // the players may end one they judged.
  const s = table();
  s.noBoard = true;
  const a = put(s, 's1', L(), 1, 1);
  const b = put(s, 's2', L(), 9, 9);
  U.tetherTo(a, b, 2);
  U.settleTethers(data, s);
  check('H1 no board measures no distance, so it stands', !!a.tether?.length, true);
  check('H1 the table may end it', send(s, { kind: 'cutTether', seat: 's2', uid: b.uid, targetUid: a.uid }).ok && !a.tether && !b.tether, true);
  U.tetherTo(a, b, 2);
  b.partStates.torso = 'destroyed';
  U.settleTethers(data, s);
  check('H1 and a destroyed partner ends it', [a.tether, b.tether], [undefined, undefined]);
}

// ================= Data =================
{
  const box = JSON.parse(readFileSync(new URL('../../data/box_contents_overrides.json', import.meta.url), 'utf8'));
  const taurus = box.boxes?.SINGLE_UN_TAURUS ?? box.SINGLE_UN_TAURUS;
  check('the Single Pack Taurus holds the TM35N Alligator torso too', taurus?.cards?.['097'] ?? taurus?.['097'], 1);
  const kw = JSON.parse(readFileSync(new URL('../../data/keyword_overrides.json', import.meta.url), 'utf8'));
  const push = kw.overrides?.['推动X'] ?? kw['推动X'];
  check('I9 Push X is any straight direction the pusher chooses', /any direction the pushing player chooses/.test(JSON.stringify(push)), true);
  // G10 (FAQ D10): a Reaper destroyed outright places no Emergency Smoke.
  const reapers = ['PRDR-103_D', 'PRDR-104_D'].map((id) => card(id.split('_')[0], id));
  check('D10 both Reaper Emergency Smoke Actions are in the data', reapers.map((a) => !!a), [true, true]);
  check('D10 and neither is usable after its Part is destroyed', reapers.map((a) => !!a?.usableAfterDestroyed), [false, false]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

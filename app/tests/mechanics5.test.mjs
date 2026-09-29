// MECHANICS AUDIT, PHASE 5 (2026-09-27): drones, projectiles and deployables,
// driven through the real command layer, the real readers and the shipped cards.
// Each block is one finding of Project-Documents/MECHANICS-AUDIT.md (the letters
// match its sections), pinned by behaviour rather than by the shape of the
// source, and each was mutation-checked: put its fix back the way it was and it
// fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { installDom, makeEl, settle, textOf } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_mechanics5.entry.ts', import.meta.url);
const out = new URL('./_mechanics5.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { check, apply, ammoPay, ammoAvailable, liveIntercepts, strictNow, swarmFor } from '../src/commands';",
  "export { loadData } from '../src/data';",
  "export { glueAfter } from '../src/glue';",
  "export { newScriptState, PHASES, baseCells, baseBox, isLineUnit } from '../src/types';",
  "export * as U from '../src/units';",
  "export * as D from '../src/data';",
  "export * as R from '../src/rules';",
  "export * as T from '../src/ticks';",
  "export * as Lp from '../src/loop';",
  "export * as Su from '../src/setup';",
  "export { AttackHelper } from '../src/combat';",
  "export { guideAct } from '../pad/guided';",
  "export { slotPool, BUILD_SLOTS } from '../src/mechbuilder';",
  "export { parseSquadJson } from '../src/importer';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const { U, D, R, T } = M;
const data = await M.loadData();
const dice = JSON.parse(readFileSync(new URL('../../data/dice.json', import.meta.url), 'utf8'));

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
// A free table: no setup, so no guided game.
function freeTable() {
  return U.migrateState({ v: 3, tokens: [], nextUid: 1, round: { n: 1, phase: 2, firstPlayer: 's1' } }, data);
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
// A Carrier Tarantula (162) with a Load on its back, seeded the way a squad
// deploys one: makeDroneToken fills the Load's Ammo and Interception pools too.
function carrierOn(s, side, load, c, r, extra = {}) {
  const t = { ...U.makeDroneToken(s, data, data.byId.get('162'), side, load), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
const actionsOf = (t) => U.tokenCards(data, t).flatMap((c) => c.card.actions ?? []);
// The Blue dice the real attack window hands a defender (4.6).
function bluePool(atk, def) {
  const gun = actionsOf(atk).find((a) => a.type === 'Firing');
  const h = new M.AttackHelper(data, dice, makeEl('div'), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => [atk, def];
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(atk, gun, def, '');
  if (def.kind === 'mech') h.pickPart('torso');
  return h.ctx.defensePool.blue;
}
// The Yellow a Firing Action opens with in the real attack window.
function attackYellow(atk, def, action, noBoard = false) {
  const h = new M.AttackHelper(data, dice, makeEl('div'), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => [atk, def, ...lenders];
  h.terrain = () => [];
  h.smoke = () => [];
  h.noBoard = noBoard;
  h.start(atk, action, def, '');
  return h.ctx.attackPool.yellow;
}
let lenders = [];
const send = (s, cmd) => {
  const v = M.check(data, s, cmd);
  if (v.ok) { M.apply(data, s, cmd); M.glueAfter(data, s, cmd); }
  return v;
};
const ok = (s, cmd) => M.check(data, s, cmd).ok;
// An Action Opportunity the guide has opened for `uid`, as mechanics4 builds one.
const opp = (uid, over = {}) => ({ uid, timing: 'movement', extra: undefined, maneuver: 1, action: 2, extras: [], maneuvered: false, moved: false, started: false, overload: 0, performed: [], spentExtras: [], ...over });
const actionOf = (cardId, actionId) => data.byId.get(cardId)?.actions?.find((a) => a.id === actionId);

console.log('Phase 5: drones, projectiles and deployables\n');

// ================= B3. the GoF Crossbow has no Interception (GoF 1.021) =================
{
  // GoF 1.021 prints Single Shot, 3R, Range 6, Omni-direction and Melee Firing,
  // and no Intercept. The override cleared the English and the Chinese; the
  // Japanese still read 迎撃1, and interceptCapacity reads the Japanese too.
  check('B3 the Crossbow\'s Action reads no Intercept', U.interceptCapacity(actionOf('ZHDR-102', 'ZHDR-102_A')), undefined);
  const s = table();
  const crossbow = droneOn(s, 's2', 'ZHDR-102', 5, 5);
  check('B3 so the Crossbow deploys with no Interception Tokens', crossbow.intercept?.['ZHDR-102_A'] ?? 0, 0);
  check('B3 the control: the AMS-190 still reads Intercept 3', U.interceptCapacity(actionOf('003', '003_A')), 3);
}

// ================= A4. the Rumba guides a real Missile (FAQ M25) =================
{
  // "When Ally Missile targeting units within range of this beacon, may reroll
  // {Eye}" (PDAM-006). Every Missile's Guided Attack is typed Delay in the data,
  // and the rule's Firing/Tactic gate reached none of them.
  const s = table();
  const rumba = droneOn(s, 's1', 'PDAM-006', 5, 5);
  const target = put(s, 's2', L(), 5, 6);
  for (const [cardId, actionId] of [['071', '071_A'], ['157', '157_A']]) {
    const missile = droneOn(s, 's1', cardId, 5, 8);
    const a = actionOf(cardId, actionId);
    check(`A4 ${actionId} is typed ${a.type} and the Rumba guides it`, [a.type, U.missileGuidance(data, s.tokens, missile, target, a).map((x) => x.uid)], ['Delay', [rumba.uid]]);
  }
  const enemyMissile = droneOn(s, 's2', '071', 5, 8);
  check('A4 an enemy Missile is not guided', U.missileGuidance(data, s.tokens, enemyMissile, put(s, 's1', L(), 5, 4), actionOf('071', '071_A')).length, 0);
}

// ================= G3. a Carrier gains none of its Load's attributes (O4; p.94) =================
{
  // "The Drone does not gain the Actions or attributes of the Part." The Load
  // is listed as the Drone's Backpack, and six readers counted it as the
  // Drone's own: its Dodge, its Interception, its Freehand and its Cloak.
  const s = table();
  const shooter = put(s, 's1', L(), 5, 8);
  const bare = carrierOn(s, 's2', '', 5, 5);
  const jets = carrierOn(s, 's2', 'PDBP-201', 5, 5);
  check('G3 the Ojs200 prints Dodge 2', data.byId.get('PDBP-201').dodge, 2);
  check('G3 a Carrier in Mobility has Blue to roll', bluePool(shooter, bare) > 0, true);
  check('G3 a Carrier with the Ojs200 rolls its own Dodge and no more', bluePool(shooter, jets), bluePool(shooter, bare));
  check('G3 the control: a Mech in Mobility wearing it rolls the 2',
    bluePool(shooter, put(s, 's2', L({ backpack: 'PDBP-201' }), 5, 5, { stance: 'mobility' }))
      - bluePool(shooter, put(s, 's2', L(), 5, 5, { stance: 'mobility' })), 2);

  // Interception: the AMS-190 on a Carrier's back is seeded (it can be lent),
  // but the Carrier never fires it.
  const t = table();
  const launcher = put(t, 's1', L(), 5, 9);
  const ams = carrierOn(t, 's2', '003', 5, 5);
  const missile = droneOn(t, 's1', '071', 5, 6);
  check('G3 the Load\'s Interception pool is seeded on the Carrier', ams.intercept?.['003_A'], 3);
  const owedAms = (x) => U.interceptsOwed(data, t.tokens, [], launcher, [missile]).some((o) => o.uid === x.uid && o.actionId === '003_A');
  check('G3 but the Carrier is owed no Interception', U.interceptsOwed(data, t.tokens, [], launcher, [missile]).filter((o) => o.uid === ams.uid).length, 0);
  // The control's hands intercept too (041_A), so these name the AMS-190's Action.
  const wearer = put(t, 's2', L({ backpack: '003' }), 3, 5);
  check('G3 the control: a Mech wearing the AMS-190 is owed one', owedAms(wearer), true);
  wearer.partStates.backpack = 'destroyed';
  check('G3 and not once that Backpack is destroyed (B6)', owedAms(wearer), false);

  // I25: a Mech in Contact with the Carrier intercepts with the lent AMS, as its
  // own Firing Action (M26, O3/O16), paying from the Tokens on the Carrier.
  // Its own hands intercept too (041_A); emptied, so only the Load answers.
  const lentTo = put(t, 's2', L(), 5, 4, { intercept: {} });
  check('I25 a Mech touching the Carrier is owed an attempt with the lent AMS', owedAms(lentTo), true);
  check('I25 and is among the units that could intercept, the Carrier not', [U.interceptorsAgainst(data, t.tokens, 's1').some((x) => x.uid === lentTo.uid), U.interceptorsAgainst(data, t.tokens, 's1').some((x) => x.uid === ams.uid)], [true, false]);
  check('I25 its Tokens are the Carrier\'s', [U.interceptPayer(data, t.tokens, lentTo, '003_A')?.uid, U.interceptHeld(data, t.tokens, lentTo, '003_A')], [ams.uid, 3]);
  const far = put(t, 's2', L(), 9, 9);
  check('I25 out of Contact it is not', owedAms(far), false);
  t.script.intercepts = [{ uid: lentTo.uid, actionId: '003_A', targetUid: missile.uid }];
  check('I25 the owed attempt is spent from the Carrier\'s pool', [send(t, { kind: 'spendIntercept', seat: 's2', uid: lentTo.uid, actionId: '003_A' }).ok, ams.intercept['003_A']], [true, 2]);
  ams.intercept['003_A'] = 0;
  check('I25 and with the pool spent, it has nothing to intercept with', ok(t, { kind: 'spendIntercept', seat: 's2', uid: lentTo.uid, actionId: '003_A' }), false);

  // Freehand and the Cloak.
  const arm = carrierOn(s, 's2', '087', 7, 5);
  check('G3 a Carrier has no Freehand from an MSH2 Load', U.freehandSlots(data, arm).map((h) => h.slot), []);
  check('G3 the control: a Mech wearing the MSH2 has it', U.freehandSlots(data, put(s, 's2', L({ backpack: '087' }), 7, 7)).map((h) => h.slot).includes('backpack'), true);
  const cloak = carrierOn(s, 's2', 'ZYBP-201', 9, 5);
  check('G3 a Carrier cannot switch on its Load\'s Cloak', U.canActivateCamo(data, cloak), false);
  check('G3 the control: a Mech wearing the Cloak can', U.canActivateCamo(data, put(s, 's2', L({ backpack: 'ZYBP-201' }), 9, 7)), true);
}

// ================= G1. a lent Load's passives reach the Mech (FAQ O3, O16, O17) =================
{
  // "If multiple Carrier Tarantulas carrying the CSC60 Cooler are in Contact
  // with the same Mech, can the effects of those CSC60 stack when the Mech
  // performs a Firing Action? Yes." (O17). The 117 fires a 4Y Laser.
  const s = table();
  const laser = actionOf('117', '117_A');
  const hand = data.byId.get('117').type;
  const me = put(s, 's1', L({ [hand]: '117', backpack: '083' }), 5, 5);
  const target = put(s, 's2', L(), 5, 2);
  // The Mech covers cells 15..17 both ways; a Carrier (2x2) at 18 or at 13 is
  // edge to edge with it.
  const right = carrierOn(s, 's1', '083', 0, 0, { col: 18, row: 15 });
  const left = carrierOn(s, 's1', '083', 0, 0, { col: 13, row: 15 });
  lenders = [];
  check('G1 the 117 prints 4Y', laser.yellowDice, 4);
  check('G1 alone, its own CSC60 makes it 5Y', attackYellow(me, target, laser), 5);
  lenders = [right, left];
  check('G1 with two Carriers lending a CSC60 each, 7Y (O17)', attackYellow(me, target, laser), 7);
  check('G1 the engine reader agrees', U.coolingBonus(data, me, laser, { red: 0, yellow: 4 }, U.loanedParts(data, s.tokens, me)).yellow, 3);
  check('G1 a table with no board cannot see Contact, so lends nothing (G4)', attackYellow(me, target, laser, true), 5);
  right.col = 20;
  check('G1 a Carrier out of Contact lends nothing', attackYellow(me, target, laser), 6);
  lenders = [];

  // 086_B Ammo Delivery: an empty Pod fires out of the Pack's magazine, and a
  // lent Pack's magazine sits on the Carrier (O3/O16; "Ammo follows the Part").
  const f = freeTable();
  const pod = put(f, 's1', L({ leftHand: '129' }), 5, 5);
  pod.ammo['129_A'] = 0;
  const pack = carrierOn(f, 's1', '086', 0, 0, { col: 18, row: 15 });
  check('G1 the Pack\'s magazine is seeded on the Carrier', pack.ammo['086_A'], 2);
  const paid = M.ammoPay(data, f, pod, '129_A');
  check('G1 the empty Pod is paid out of the lent Pack, on the Carrier', [paid.from.uid, paid.poolId], [pack.uid, '086_A']);
  check('G1 so it has two shots in all', M.ammoAvailable(data, f, pod, '129_A'), 2);
  const row = U.guidedActions(data, pod, { tokens: f.tokens, terrain: [] }).find((g) => g.action.id === '129_A');
  check('G1 and its row is offered with those two', [row?.available, row?.ammoLeft], [true, 2]);
  pack.col = 20;
  check('G1 out of Contact, the Pod is simply empty', M.ammoAvailable(data, f, pod, '129_A'), 0);

  // The GLP-15's Auto Mine Laying, lent: Contact is judged where the walk
  // began, and the Mech may leave the Carrier behind.
  const w = freeTable();
  const walker = put(w, 's1', L(), 5, 3);
  const layer = carrierOn(w, 's1', '006', 0, 0, { col: 18, row: 15 });
  const route = [{ c: 5, r: 5 }, { c: 5, r: 4 }, { c: 5, r: 3 }];
  const lay = U.minesLayable(data, walker, route, 2, false, w.tokens);
  check('G1 a Mech that began its walk touching a GLP-15 Carrier may Lay', lay && [lay.actionId, lay.cardId, lay.max], ['006_A', '074', 2]);
  check('G1 the control: without the Carrier it may not', U.minesLayable(data, walker, route, 2, false, []), null);
  const layCmd = { kind: 'layMine', seat: 's1', uid: walker.uid, actionId: '006_A', cardId: '074', to: { col: 16, row: 13 } };
  check('G1 and the command takes the lent Layer though the walk left Contact', M.check(data, w, layCmd).ok, true);
  layer.row = 9;
  check('G1 a Carrier touching only where the walk ended lends nothing', U.minesLayable(data, walker, route, 2, false, w.tokens), null);
  layer.droneBackpack = '';
  check('G1 and with no Mine Layer on any Carrier the command refuses', M.check(data, w, layCmd).ok, false);
}

// ================= G2. a lent Load's Freehand reaches [Two-Handed] (FAQ O16, O3) =================
{
  // "can a Mech in Contact with it gain all the attributes of that Load during
  // actions, including ... Freehand? Yes." (O16), and O3 names the MSH2. The
  // 058 rifle prints [Two-Handed] +2 Range; the L() Mech has no Freehand at all.
  const f = table();
  const me = put(f, 's1', L(), 5, 5);
  f.script.opp = opp(me.uid, { timing: 'firing' });
  const target = put(f, 's2', L(), 5, 2);
  const rifle = actionOf('058', '058_A');
  check('G2 the Mech alone has no hand to give', U.twoHandedUse(data, me, rifle), null);
  const arm = carrierOn(f, 's1', '087', 0, 0, { col: 18, row: 15 });
  const use = U.twoHandedUse(data, me, rifle, [], U.loanedParts(data, f.tokens, me));
  check('G2 a Carrier\'s MSH2 in Contact is the Freehand', use?.slot, `load:${arm.uid}`);
  check('G2 so the rifle gains its +2 Range', use?.action.range, rifle.range + 2);
  check('G2 and the lent MSH2\'s own rider, Omni-direction Firing', use?.support?.keywords, ['全向射击']);
  const cmd = { kind: 'performAction', seat: 's1', uid: me.uid, actionId: '058_A', twoHanded: true };
  const v = M.check(data, f, cmd);
  check('G2 the command takes the designation', [v.ok, v.why ?? ''], [true, '']);
  const root = makeEl('div');
  const h = new M.AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => f.tokens;
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(me, use.action, target, '');
  h.pickPart('torso');
  check('G2 and the window names the lent Part', textOf(root).join(' ').includes('[Two-Handed]: MSH2'), true);
  arm.col = 20;
  check('G2 out of Contact, no hand again', U.twoHandedUse(data, me, rifle, [], U.loanedParts(data, f.tokens, me)), null);
  const no = M.check(data, f, cmd);
  check('G2 and the command refuses the designation', [no.ok, /Two-Handed/.test(no.why ?? '')], [false, true]);
  check('G2 the control: one-handed it goes through', ok(f, { ...cmd, twoHanded: undefined }), true);
}

// ================= B1. a launched Beacon is owed an Interception (4.7.2) =================
{
  // "Regardless of whether the Projectile is an Aerial Unit, during Launching
  // the Projectile is considered an Aerial Unit at the Grid it was Launched
  // from and at the Landing Point" (4.7.2; M20 names the MES Beacon Launcher).
  // Since Phase 4 a Beacon is a ground unit, and every door dropped it.
  const s = table();
  const launcher = put(s, 's1', L({ leftHand: '064' }), 5, 9);
  const beacon = droneOn(s, 's1', '072', 5, 6, { parentUid: launcher.uid });
  const guard = put(s, 's2', L({ backpack: '003' }), 5, 5);
  check('B1 the MES Beacon is a ground unit', !!beacon.aerial, false);
  const owed = U.interceptsOwed(data, s.tokens, [], launcher, [beacon]).filter((o) => o.actionId === '003_A');
  check('B1 its Launch owes the AMS-190 an attempt at it', owed.map((o) => [o.uid, o.targetUid]), [[guard.uid, beacon.uid]]);
  check('B1 the queue takes it', send(s, { kind: 'queueIntercepts', seat: 's1', items: owed }).ok, true);
  check('B1 and every door reads it as owed', U.interceptOwedAt(s, guard.uid, '003_A', beacon.uid), true);
  check('B1 the control: not by another Part', U.interceptOwedAt(s, guard.uid, '041_A', beacon.uid), false);

  // The Match Centre's own queue, the real function cut out of matchhud.ts: it
  // kept only `p.aerial` Units, so a Beacon was never queued there at all.
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const at = hud.indexOf('function queueInterceptsFor(');
  const src = hud.slice(at, hud.indexOf('\n}\n', at) + 3);
  const { code } = await transform(src, { loader: 'ts' });
  const queueInterceptsFor = new Function('interceptsOwed', 'squadLabel', `${code}\nreturn queueInterceptsFor;`)(U.interceptsOwed, (x) => x);
  const h = table();
  const hl = put(h, 's1', L({ leftHand: '064' }), 5, 9);
  const hb = droneOn(h, 's1', '072', 5, 6, { parentUid: hl.uid });
  const hg = put(h, 's2', L({ backpack: '003' }), 5, 5);
  const sent = [];
  queueInterceptsFor({ data, state: h, send: (c) => { sent.push(c); return { ok: true }; }, noteNow() {} }, hl, [hb]);
  check('B1 the Match Centre queues the launched Beacon', sent.flatMap((c) => c.items ?? []).some((o) => o.uid === hg.uid && o.targetUid === hb.uid), true);
}

// ================= B2. an attempt nothing can pay is not owed (4.9) =================
{
  // A Volley of 2 into the Range of a Part holding 1 Token queues two attempts;
  // the second could never be paid, and stranded the Match Centre's panel.
  const s = table();
  const launcher = put(s, 's1', L({ leftHand: '064' }), 5, 9);
  const one = droneOn(s, 's1', '072', 5, 6, { parentUid: launcher.uid });
  const two = droneOn(s, 's1', '072', 6, 6, { parentUid: launcher.uid });
  const guard = put(s, 's2', L({ backpack: '003' }), 5, 5);
  guard.intercept['003_A'] = 1;
  const items = [one, two].map((p) => ({ uid: guard.uid, actionId: '003_A', targetUid: p.uid }));
  const hand = { uid: guard.uid, actionId: '041_A', targetUid: one.uid };
  send(s, { kind: 'queueIntercepts', seat: 's1', items: [...items, hand] });
  check('B2 three attempts owed', s.script.intercepts.length, 3);
  check('B2 spending the last Token is allowed', send(s, { kind: 'spendIntercept', seat: 's2', uid: guard.uid, actionId: '003_A' }).ok, true);
  check('B2 and strikes off every attempt that Part owed', s.script.intercepts.filter((x) => x.actionId === '003_A').length, 0);
  check('B2 but not another Part\'s', s.script.intercepts, [hand]);
  // The control: a Part with a Token left still owes the rest.
  const t = table();
  const l2 = put(t, 's1', L({ leftHand: '064' }), 5, 9);
  const a = droneOn(t, 's1', '072', 5, 6, { parentUid: l2.uid });
  const b = droneOn(t, 's1', '072', 6, 6, { parentUid: l2.uid });
  const g2 = put(t, 's2', L({ backpack: '003' }), 5, 5);
  g2.intercept['003_A'] = 2;
  send(t, { kind: 'queueIntercepts', seat: 's1', items: [a, b].map((p) => ({ uid: g2.uid, actionId: '003_A', targetUid: p.uid })) });
  send(t, { kind: 'spendIntercept', seat: 's2', uid: g2.uid, actionId: '003_A' });
  send(t, { kind: 'resolveIntercept', seat: 's2', uid: g2.uid, actionId: '003_A', targetUid: a.uid });
  check('B2 the control: with a Token left the other attempt stands', t.script.intercepts.map((x) => x.targetUid), [b.uid]);
}

// ================= A1. an "all Units" blast resolves every unit it caught (4.7.6, M21) =================
{
  // Both boards deleted the Projectile after the first attack, so the second
  // unit was never reached. The boards now keep it while explosionScope reads
  // "all" and strike each resolved unit off (the flow itself is a page flow,
  // checked on the tabletop in the browser); these pin the reading that
  // decides it, for every card the finding named.
  const scopeOf = (cardId) => {
    const a = (data.byId.get(cardId)?.actions ?? []).find((x) => x.redDice || x.yellowDice);
    return a ? U.explosionScope(a, data.actionTranslation(a.id)?.english ?? undefined) : null;
  };
  for (const [id, name] of [['ZHAM-004', 'Shrapnel Shell'], ['154', 'M7 Grenade'], ['PDAM-007', 'FG12'], ['PDAM-005', 'FG33 Sardina'], ['PDAM-004', 'AS3-B'], ['074', 'GM-35 Mine']]) {
    check(`A1 the ${name} is an "all Units" blast`, scopeOf(id), 'all');
  }
  check('A1 the control: a Missile strikes one target', scopeOf('071'), 'single');
}

// ================= F2. the GoF Command cards at their 1.021 rules (ruling I1) =================
{
  // The prices were already 1.021; the rules were 1.02. From the GoF 1.021 list:
  // Warrior (172) Designated Defense + Swarm Tactics, Dragoon (175) A2K Data
  // Link, Chariot (176) M2 Data Link, and the Integrated Data Link Pod
  // "Command Generation +1".
  const nameOf = (id) => actionOf(id.split('_')[0], id)?.name?.en;
  check('F2 the Warrior prints Designated Defense and Swarm Tactics', [nameOf('172_A'), nameOf('172_B')], ['Designated Defense', 'Swarm Tactics']);
  check('F2 the Dragoon prints A2K Data Link', nameOf('175_A'), 'A2K Data Link');
  const f = freeTable();
  const warrior = put(f, 's1', L({ torso: '172' }), 1, 1);
  const dragoon = put(f, 's1', L({ torso: '175' }), 3, 1);
  const chariot = put(f, 's1', L({ torso: '176' }), 5, 1);
  const podded = put(f, 's1', L({ torso: '172', backpack: 'ZYBP-102' }), 7, 1);
  const dragoonPod = put(f, 's1', L({ torso: '175', backpack: 'ZYBP-102' }), 9, 1);
  check('F2 Command Generation: Warrior 1, Dragoon 2, Chariot 2',
    [warrior, dragoon, chariot].map((t) => U.commandGeneration(data, t)), [1, 2, 2]);
  check('F2 the Pod adds 1: Warrior 2, Dragoon 3', [podded, dragoonPod].map((t) => U.commandGeneration(data, t)), [2, 3]);
  check('F2 and a Shutdown Mech generates the default 1', U.commandGeneration(data, { ...dragoonPod, stance: 'shutdown' }), 1);
  check('F2 the Pod no longer Coordinates at the end of the Opportunity', U.coordinationOnOpportunityEnd(data, podded), 0);
  check('F2 the A2 and M2 riders are gone', [U.commandRiderOf(data, dragoon), U.commandRiderOf(data, chariot)],
    [{ autoActions: false, preMove: 0 }, { autoActions: false, preMove: 0 }]);
  const melee = actionsOf(warrior).find((a) => a.type === 'Melee');
  check('F2 Melee Synergy is gone: the Warrior\'s Melee Action carries no Coordination', U.coordinationFor(data, warrior, melee), 0);
  check('F2 neither Data Link line reads as Coordination the Passive carries',
    [U.commandCoordination(actionOf('175', '175_A')), U.commandCoordination(actionOf('176', '176_A'))], [0, 0]);
  // M2: "This Mech's Command Coordination may issue up to 2 Commands".
  const coArm = ['ZHLA-102', 'ZHLA-201', 'ZHRA-201', 'ZHRA-202']
    .flatMap((id) => (data.byId.get(id)?.actions ?? []).map((a) => [id, a]))
    .find(([, a]) => U.commandCoordination(a) === 1);
  const slotOf = (id) => data.byId.get(id).type;
  const withArm = (torso) => put(f, 's1', L({ torso, [slotOf(coArm[0])]: coArm[0] }), 11, 1);
  check('F2 a Coordination 1 Action is worth 2 on the Chariot', U.coordinationFor(data, withArm('176'), coArm[1]), 2);
  check('F2 and 1 on the Warrior', U.coordinationFor(data, withArm('172'), coArm[1]), 1);
  // A2K: "This Mech may perform one Command Coordination after Maneuver".
  check('F2 the Dragoon Coordinates once after a Maneuver, the others do not',
    [dragoon, chariot, warrior].map((t) => U.coordinationAfterManeuver(data, t)), [1, 0, 0]);

  // Designated Defense matches the shields, "this part" (OTTO, 2026-09-28):
  // the Warrior may take the damage on its own Torso, in any Stance.
  const hurt = put(f, 's1', L({ torso: '172' }), 1, 3, { stance: 'offensive' });
  hurt.partStates.leftHand = 'destroyed';
  check('F2 the Warrior may designate its own Torso, in any Stance', U.selfHitParts(data, hurt).map((x) => [x.slot, x.label]),
    [['torso', 'Designated Defense']]);
  hurt.partStates.torso = 'destroyed';
  check('F2 and nothing once the Torso is destroyed', U.selfHitParts(data, hurt), []);
  check('F2 the control: the Dragoon may designate none', U.selfHitParts(data, dragoon), []);
}

// ================= F2. Swarm Tactics: the token goes on, each Drone once =================
{
  // "After this Mech issues a Command to a GoF Medium Drone, may remove this
  // Command Token and continue issuing a Command to another Ally Drone." Read
  // with 3.2.2 and FAQ O1 (OTTO asked for this reading, 2026-09-28): the one
  // token goes on AT ONCE, before the other squad issues, to an Ally Drone that
  // has had no Command this Phase, and on again from each GoF Medium Drone it
  // reaches. Every Drone still takes one Command per Phase; read the other way,
  // one token commanded two Hounds endlessly.
  const faceUp = (t) => (t.statuses ?? []).filter((x) => x === 'command').length;
  const bears = (t) => (t.statuses ?? []).filter((x) => x === 'command' || x === 'commandUsed').length;
  const commandPhase = () => {
    const s = table();
    s.round.phase = M.PHASES.indexOf('Command');
    s.script.turn = 's1';
    return s;
  };
  const s = commandPhase();
  const warrior = put(s, 's1', L({ torso: '172' }), 1, 1, { statuses: ['command'] });
  const hound = droneOn(s, 's1', 'ZHDR-201', 3, 3);
  const hound2 = droneOn(s, 's1', 'ZHDR-202', 5, 3);
  const valkyrie = droneOn(s, 's1', 'ZHDR-303', 6, 3);
  const bob = put(s, 's1', L(), 9, 9, { statuses: ['command'] });
  put(s, 's2', L(), 20, 20, { statuses: ['command'] });
  droneOn(s, 's2', '160', 22, 22);
  s.commandTokens = { s1: 2, s2: 1 };
  check('F2 the Hound is a GoF Medium Drone, the Valkyrie is not', [U.isGofMediumDrone(data, hound), U.isGofMediumDrone(data, valkyrie)], [true, false]);
  check('F2 and neither is a UN medium Drone', U.isGofMediumDrone(data, droneOn(table(), 's1', '160', 1, 1)), false);
  const v1 = send(s, { kind: 'designate', seat: 's1', uid: hound.uid, fromUid: warrior.uid });
  check('F2 the Warrior commands the Hound, paying its token', [v1.ok, faceUp(warrior), bears(hound)], [true, 0, 1]);
  check('F2 Swarm Tactics waits to go on, and the turn stays with the squad', [s.script.swarm, s.script.turn], [{ issuer: warrior.uid, from: hound.uid }, 's1']);
  check('F2 the Hound has had its Command this Phase', s.script.commanded.includes(hound.uid), true);
  // One activation at a time (F9): the Hound's ends before the next Drone's.
  send(s, { kind: 'endOpportunity', seat: 's1', uid: hound.uid });
  check('F2 the token may go on only to a Drone with no Command yet', M.Lp.eligibleUnits(s, 'Command', 's1', data).map((x) => x.uid).sort(), [hound2.uid, valkyrie.uid].sort());
  check('F2 never the Hound again', ok(s, { kind: 'designate', seat: 's1', uid: hound.uid, fromUid: warrior.uid }), false);
  check('F2 nor another Mech\'s Command in between', /Swarm Tactics is going on/.test(M.check(data, s, { kind: 'designate', seat: 's1', uid: hound2.uid, fromUid: bob.uid }).why ?? ''), true);
  check('F2 and in the Command Phase it moves by designation, not Coordination', ok(s, { kind: 'coordinateCommand', seat: 's1', uid: warrior.uid, targetUid: hound2.uid }), false);
  const v2 = send(s, { kind: 'designate', seat: 's1', uid: hound2.uid, fromUid: warrior.uid });
  check('F2 it goes on to the second Hound, the Warrior paying nothing more', [v2.ok, faceUp(warrior), bears(hound2), faceUp(bob)], [true, 0, 1, 1]);
  check('F2 and from that GoF Medium Drone on again', s.script.swarm, { issuer: warrior.uid, from: hound2.uid });
  send(s, { kind: 'endOpportunity', seat: 's1', uid: hound2.uid });
  send(s, { kind: 'designate', seat: 's1', uid: valkyrie.uid, fromUid: warrior.uid });
  check('F2 a Large Drone ends it: the turn passes', [s.script.swarm ?? null, bears(valkyrie), s.script.turn], [null, 1, 's2']);
  check('F2 one token, three Drones, each once', [hound, hound2, valkyrie].map((d) => s.script.commanded.includes(d.uid)), [true, true, true]);

  // The endless chain the other reading allowed: two Hounds, one token.
  const loop = commandPhase();
  const w2 = put(loop, 's1', L({ torso: '172' }), 1, 1, { statuses: ['command'] });
  const a = droneOn(loop, 's1', 'ZHDR-201', 3, 3);
  const b = droneOn(loop, 's1', 'ZHDR-202', 5, 3);
  put(loop, 's2', L(), 20, 20);
  droneOn(loop, 's2', '160', 22, 22);
  loop.commandTokens = { s1: 1, s2: 0 };
  const taken = [];
  const offered = [];
  for (const d of [a, b, a, b]) {
    const v = send(loop, { kind: 'designate', seat: 's1', uid: d.uid, fromUid: w2.uid });
    taken.push(v.ok);
    offered.push(M.Lp.eligibleUnits(loop, 'Command', 's2', data).length);
    send(loop, { kind: 'endOpportunity', seat: 's1', uid: d.uid });
  }
  check('F2 two Hounds and one token make two Commands, never an endless chain', taken, [true, true, false, false]);
  check('F2 and the other squad, out of tokens, is never offered the Warrior\'s', offered, [0, 0, 0, 0]);
  check('F2 and with no Drone left to take it, nothing waits', loop.script.swarm ?? null, null);

  // Stopping: the token stays spent where it is, and the other squad issues.
  const st = commandPhase();
  const w3 = put(st, 's1', L({ torso: '172' }), 1, 1, { statuses: ['command'] });
  const h3 = droneOn(st, 's1', 'ZHDR-201', 3, 3);
  droneOn(st, 's1', 'ZHDR-202', 5, 3);
  const foeDrone = droneOn(st, 's2', '160', 20, 20);
  put(st, 's2', L(), 22, 22, { statuses: ['command'] });
  st.commandTokens = { s1: 1, s2: 1 };
  send(st, { kind: 'designate', seat: 's1', uid: h3.uid, fromUid: w3.uid });
  send(st, { kind: 'endOpportunity', seat: 's1', uid: h3.uid });
  check('F2 only the waiting squad may stop it', [ok(st, { kind: 'endSwarm', seat: 's2' }), ok(st, { kind: 'endSwarm', seat: 's1' })], [false, true]);
  send(st, { kind: 'endSwarm', seat: 's1' });
  check('F2 stopped: nothing waits, the Hound keeps the token, the turn passes', [st.script.swarm ?? null, bears(h3), faceUp(w3), st.script.turn], [null, 1, 0, 's2']);
  check('F2 and the other squad issues next', ok(st, { kind: 'designate', seat: 's2', uid: foeDrone.uid }), true);

  // A Pass declines it too, and a destroyed Warrior has no token to move on.
  const pt = commandPhase();
  const wp = put(pt, 's1', L({ torso: '172' }), 1, 1, { statuses: ['command'] });
  const hp = droneOn(pt, 's1', 'ZHDR-201', 3, 3);
  const hp2 = droneOn(pt, 's1', 'ZHDR-202', 5, 3);
  const bp = put(pt, 's1', L(), 9, 9, { statuses: ['command'] });
  put(pt, 's2', L(), 20, 20, { statuses: ['command'] });
  droneOn(pt, 's2', '160', 22, 22);
  pt.commandTokens = { s1: 2, s2: 1 };
  const dw = structuredClone(pt);
  send(pt, { kind: 'designate', seat: 's1', uid: hp.uid, fromUid: wp.uid });
  send(pt, { kind: 'endOpportunity', seat: 's1', uid: hp.uid });
  send(pt, { kind: 'passTurn', seat: 's1' });
  check('F2 a Pass declines it too', [pt.script.swarm ?? null, pt.script.turn], [null, 's2']);
  send(dw, { kind: 'designate', seat: 's1', uid: hp.uid, fromUid: wp.uid });
  send(dw, { kind: 'endOpportunity', seat: 's1', uid: hp.uid });
  dw.tokens.find((x) => x.uid === wp.uid).partStates.torso = 'destroyed';
  check('F2 a destroyed Warrior has no token to move on', [M.swarmFor(dw, 's1'), ok(dw, { kind: 'designate', seat: 's1', uid: hp2.uid, fromUid: bp.uid })], [null, true]);

  // 3.2.2 is per Phase, not per token: a Drone commanded this Phase whose
  // token came off by hand (removeStatus) still cannot take another.
  const hand = commandPhase();
  const wh = put(hand, 's1', L({ torso: '172' }), 1, 1, { statuses: ['command'] });
  const bh = put(hand, 's1', L(), 9, 9, { statuses: ['command'] });
  const ha = droneOn(hand, 's1', 'ZHDR-201', 3, 3);
  const hb = droneOn(hand, 's1', 'ZHDR-202', 5, 3);
  put(hand, 's2', L(), 20, 20);
  hand.commandTokens = { s1: 2, s2: 0 };
  send(hand, { kind: 'designate', seat: 's1', uid: hb.uid, fromUid: bh.uid });
  send(hand, { kind: 'endOpportunity', seat: 's1', uid: hb.uid });
  hb.statuses = [];
  send(hand, { kind: 'designate', seat: 's1', uid: ha.uid, fromUid: wh.uid });
  check('F2 a Drone commanded this Phase is nowhere to go on to, token or none', hand.script.swarm ?? null, null);

  // Only a GoF Medium Drone passes it on: a Large one first starts nothing.
  const lg = commandPhase();
  const wg = put(lg, 's1', L({ torso: '172' }), 1, 1, { statuses: ['command'] });
  const vg = droneOn(lg, 's1', 'ZHDR-303', 3, 3);
  droneOn(lg, 's1', 'ZHDR-201', 5, 3);
  put(lg, 's2', L(), 20, 20, { statuses: ['command'] });
  droneOn(lg, 's2', '160', 22, 22);
  lg.commandTokens = { s1: 1, s2: 1 };
  send(lg, { kind: 'designate', seat: 's1', uid: vg.uid, fromUid: wg.uid });
  check('F2 a Command to a Large Drone starts nothing, and the turn passes', [lg.script.swarm ?? null, lg.script.turn], [null, 's2']);

  // The control: a Mech without Swarm Tactics.
  const t = commandPhase();
  const dragoon = put(t, 's1', L({ torso: '175' }), 1, 1, { statuses: ['command'] });
  const hound4 = droneOn(t, 's1', 'ZHDR-201', 3, 3);
  droneOn(t, 's1', 'ZHDR-202', 5, 3);
  t.commandTokens = { s1: 1, s2: 0 };
  send(t, { kind: 'designate', seat: 's1', uid: hound4.uid, fromUid: dragoon.uid });
  check('F2 the control: the Dragoon\'s token stays on the Hound, and nothing waits', [faceUp(dragoon), t.script.swarm ?? null], [0, null]);

  // Command Coordination, later in the round, the same way: the token goes
  // on at once, beyond the Coordination X, and each Drone once.
  // In its Opportunity, off an Action that carries Coordination (F9).
  const c = table();
  c.round.phase = M.PHASES.indexOf('Action');
  const w = put(c, 's1', L({ torso: '172', leftHand: 'ZHLA-102' }), 1, 1, { statuses: ['command'] });
  const h1 = droneOn(c, 's1', 'ZHDR-201', 3, 3);
  const h2 = droneOn(c, 's1', 'ZHDR-202', 6, 3);
  c.script.opp = opp(w.uid, { timing: 'projectile', performed: ['ZHLA-102_A'] });
  check('F2 Coordination to a Hound is taken, paying the token', [send(c, { kind: 'coordinateCommand', seat: 's1', uid: w.uid, targetUid: h1.uid }).ok, faceUp(w), bears(h1)], [true, 0, 1]);
  check('F2 and Swarm Tactics waits to go on', c.script.swarm, { issuer: w.uid, from: h1.uid });
  send(c, { kind: 'endOpportunity', seat: 's1', uid: h1.uid });
  check('F2 never back to the same Hound', ok(c, { kind: 'coordinateCommand', seat: 's1', uid: w.uid, targetUid: h1.uid }), false);
  check('F2 a different Drone takes it with no token left on the Warrior', [send(c, { kind: 'coordinateCommand', seat: 's1', uid: w.uid, targetUid: h2.uid }).ok, bears(h2)], [true, 1]);
  check('F2 and with no Drone left to take it, nothing waits', c.script.swarm ?? null, null);

  // A Drone already bearing a token cannot take it (4.15.2), so it does not
  // count as somewhere to go on to.
  const hd = table();
  hd.round.phase = M.PHASES.indexOf('Action');
  const wd = put(hd, 's1', L({ torso: '172', leftHand: 'ZHLA-102' }), 1, 1, { statuses: ['command'] });
  const d1 = droneOn(hd, 's1', 'ZHDR-201', 3, 3);
  droneOn(hd, 's1', 'ZHDR-202', 6, 3, { statuses: ['commandUsed'] });
  hd.script.opp = opp(wd.uid, { timing: 'projectile', performed: ['ZHLA-102_A'] });
  send(hd, { kind: 'coordinateCommand', seat: 's1', uid: wd.uid, targetUid: d1.uid });
  check('F2 a Drone already bearing a token is nowhere to go on to', hd.script.swarm ?? null, null);

  // At once or not at all: the Warrior's Opportunity ending lets it lapse.
  const lp = table();
  lp.round.phase = M.PHASES.indexOf('Action');
  const wl = put(lp, 's1', L({ torso: '172', leftHand: 'ZHLA-102' }), 1, 1, { statuses: ['command'] });
  const l1 = droneOn(lp, 's1', 'ZHDR-201', 3, 3);
  const l2 = droneOn(lp, 's1', 'ZHDR-202', 6, 3);
  lp.script.opp = opp(wl.uid, { timing: 'projectile', performed: ['ZHLA-102_A'] });
  send(lp, { kind: 'coordinateCommand', seat: 's1', uid: wl.uid, targetUid: l1.uid });
  send(lp, { kind: 'endOpportunity', seat: 's1', uid: l1.uid });
  check('F2 the Hound\'s own activation ending keeps it waiting', lp.script.swarm, { issuer: wl.uid, from: l1.uid });
  send(lp, { kind: 'endOpportunity', seat: 's1', uid: wl.uid });
  check('F2 the Warrior\'s Opportunity ending lets it lapse', [lp.script.swarm ?? null, ok(lp, { kind: 'coordinateCommand', seat: 's1', uid: wl.uid, targetUid: l2.uid })], [null, false]);
}

// ================= F1. a Coordinated Drone acts now (4.15.3) =================
{
  // "The same effect as a Command sent in the Command Phase": the Drone
  // performs 1 Movement Action or 1 Command Action. coordinateCommand moved the
  // token and opened no activation, so outside the tabletop's free drag the
  // Drone could do neither.
  const s = table();
  s.round.phase = M.PHASES.indexOf('Action');
  const mech = put(s, 's1', L({ leftHand: 'ZHLA-102' }), 5, 5, { statuses: ['command'] });
  const card = data.cards.find((c) => c.category === 'drone'
    && (c.actions ?? []).some((a) => a.speed === 'command') && (c.actions ?? []).some((a) => a.speed === 'auto'));
  const drone = droneOn(s, 's1', card.id, 8, 5);
  s.script.opp = opp(mech.uid, { timing: 'firing', performed: ['ZHLA-102_A'] });
  check('F1 the Coordination is taken', send(s, { kind: 'coordinateCommand', seat: 's1', uid: mech.uid, targetUid: drone.uid }).ok, true);
  check('F1 and the Drone acts now, nested inside the Mech\'s Opportunity',
    [s.script.opp?.uid, s.script.opp?.commanded, s.script.oppStack.at(-1)?.uid], [drone.uid, true, mech.uid]);
  const commandAct = card.actions.find((a) => a.speed === 'command');
  const autoAct = card.actions.find((a) => a.speed === 'auto');
  const v = M.check(data, s, { kind: 'performAction', seat: 's1', uid: drone.uid, actionId: commandAct.id });
  check(`F1 its Command-icon Action (${commandAct.id}) is open to it`, [v.ok, v.why ?? ''], [true, '']);
  const no = M.check(data, s, { kind: 'performAction', seat: 's1', uid: drone.uid, actionId: autoAct.id });
  check('F1 its Automatic Action is not: the Command Phase\'s icon lock', [no.ok, /Automatic Action/.test(no.why ?? '')], [false, true]);
  const mv = M.check(data, s, { kind: 'maneuver', seat: 's1', uid: drone.uid, to: { col: drone.col + 3, row: drone.row } });
  check('F1 or it may Move', [mv.ok, mv.why ?? ''], [true, '']);
  check('F1 ending it resumes the Mech', [send(s, { kind: 'endOpportunity', seat: 's1', uid: drone.uid }).ok, s.script.opp?.uid], [true, mech.uid]);
  check('F1 and the Drone is not marked as having acted', s.script.acted.includes(drone.uid), false);
  // The Opportunity survives a save and a reload.
  check('F1 the flag survives the normaliser', M.T && U.migrateState(JSON.parse(JSON.stringify({ ...s, script: { ...s.script, opp: { ...opp(drone.uid), extra: true, commanded: true } } })), data).script.opp.commanded, true);
}

// ================= H1. the Bit Port Launches and Recovers (ruling I23) =================
{
  // 292_A: "Launch or Recover 1 'White Dwarf' Bit in any stance", Range 6,
  // 1 Ammo Token; 292_B's Thruster works while that Token is on the Port.
  // Nothing read the rule: no Bit was ever launched and the Thruster never
  // switched off.
  const f = freeTable();
  const wd = put(f, 's1', L({ backpack: '292' }), 5, 5);
  const row = () => U.guidedActions(data, wd, { tokens: f.tokens, terrain: [] }).find((g) => g.action.id === '292_A');
  check('H1 the Port offers the Bit\'s three faces', row()?.projectiles.map((c) => c.id), ['293', '294', '295']);
  check('H1 with its Token on the Port the Thruster is on', [wd.ammo['292_A'], U.blueLightningDodges(data, wd)], [1, true]);
  const v = send(f, { kind: 'launch', seat: 's1', uid: wd.uid, actionId: '292_A', cardId: '294', to: { col: 22, row: 16 }, facing: 0 });
  const bit = f.tokens.find((x) => x.cardId === '294');
  check('H1 the Launch places the Bit in the Stance picked', [v.ok, bit?.kind, bit?.parentUid], [true, 'drone', wd.uid]);
  check('H1 spends the Token, and the Thruster goes off', [wd.ammo['292_A'], U.blueLightningDodges(data, wd)], [0, false]);
  check('H1 the empty Port still offers its Action, to Recover', [row()?.available, row()?.ammoLeft], [true, 0]);
  check('H1 a launched Bit is no squad problem', U.factionProblems(data, f.tokens).filter((x) => x.kind === 'launched-only').length, 0);
  const rec = { kind: 'recoverBit', seat: 's1', uid: wd.uid, actionId: '292_A', targetUid: bit.uid };
  const far = { ...bit, col: 60, row: 16 };
  check('H1 a Bit beyond Range 6 cannot be Recovered', M.check(data, { ...f, tokens: f.tokens.map((x) => (x.uid === bit.uid ? far : x)) }, rec).ok, false);
  check('H1 the Recover is taken', send(f, rec).ok, true);
  check('H1 the Bit leaves and the Token comes back, so the Thruster is on again',
    [f.tokens.some((x) => x.uid === bit.uid), wd.ammo['292_A'], U.blueLightningDodges(data, wd)], [false, 1, true]);
  check('H1 a full Port Recovers nothing', ok(f, { ...rec, targetUid: droneOn(f, 's1', '293', 6, 5, { parentUid: wd.uid }).uid }), false);
  check('H1 and an enemy Bit is never its to Recover', (() => {
    wd.ammo['292_A'] = 0;
    return ok(f, { ...rec, targetUid: droneOn(f, 's2', '295', 6, 6, { parentUid: 999 }).uid });
  })(), false);
  // p.82: never part of a Squad, never deployed at setup.
  check('H1 a Bit fielded as a squad unit is flagged', U.factionProblems(data, [droneOn(freeTable(), 's1', '293', 1, 1)]).map((x) => x.kind), ['launched-only']);
  check('H1 and the Port with no Bit to Recover is out of ammo', (() => {
    const g = freeTable();
    const lone = put(g, 's1', L({ backpack: '292' }), 5, 5);
    lone.ammo['292_A'] = 0;
    const r = U.guidedActions(data, lone, { tokens: g.tokens, terrain: [] }).find((x) => x.action.id === '292_A');
    return [r?.available, r?.reason];
  })(), [false, 'out of ammo']);
}

// ================= D1. the pad's Pholcus Unfolds, and the Unfolded one attacks =================
{
  // pad/guided sent every Projectile Action to the detonation resolver, which
  // destroyed the folded Pholcus rather than Unfolding it (M18.3), and the
  // Unfolded Pholcus's Automatic Attack (167_A) was only a toast. Driven through
  // the pad's own click handler, with a page that records what it is asked.
  const s = table();
  s.round.phase = M.PHASES.indexOf('Delay');
  const pholcus = droneOn(s, 's1', '156', 5, 5);
  s.script.opp = opp(pholcus.uid);
  const calls = [];
  const base = {
    data, state: () => s, me: () => 's1',
    send: (cmd) => { calls.push(cmd.kind); const v = M.check(data, s, cmd); if (v.ok) { M.apply(data, s, cmd); M.glueAfter(data, s, cmd); } return v.ok; },
    check: (cmd) => M.check(data, s, cmd),
    detonate: (_uid, actionId) => calls.push(`detonate:${actionId}`),
  };
  const api = new Proxy(base, { get: (o, k) => (k in o ? o[k] : () => undefined) });
  const press = (id) => M.guideAct(api, 'g-perform', { dataset: { uid: String(pholcus.uid), id } });
  press('156_A');
  await settle();
  check('D1 the folded Pholcus Unfolds rather than detonating', calls, ['performAction', 'unfold']);
  check('D1 into the Unfolded Drone', [pholcus.cardId, pholcus.kind], ['167', 'drone']);
  // Its Unfold prints "must undergo Detonation immediately" for an occupied
  // Grid, which read as an Immediate Detonation: every page offered its blast
  // as it landed. A Delayed Action is never Immediate (found in the Phase 5
  // follow-up's browser pass).
  check('D1 the folded Pholcus is no Immediate Projectile, the M7 Grenade is', [U.immediateDetonation(data.byId.get('156'))?.id ?? null, U.immediateDetonation(data.byId.get('154'))?.id], [null, '154_A']);
  s.round.phase = M.PHASES.indexOf('Automatic');
  s.script.opp = opp(pholcus.uid);
  calls.length = 0;
  press('167_A');
  await settle();
  check('D1 its Automatic Attack is paid and goes to the detonation resolver', calls, ['performAction', 'detonate:167_A']);
}

// ================= F8p, G4p. the pad's Overwatch Strike and lent attacks (Phase 5 follow-up) =================
{
  // The KK9's Overwatch Strike had no pad flow, and a lent Load's attack or
  // launch was only "resolve it on the table". Driven through the pad's own
  // click handler with a page that records what it is asked; pad.ts's own
  // halves are pinned by source.
  const s = table();
  s.round.phase = M.PHASES.indexOf('Command');
  const kk9 = droneOn(s, 's1', 'LHDR-KK9', 5, 5);
  const mech = put(s, 's1', L(), 5, 7);
  const foe = put(s, 's2', L(), 5, 2);
  s.script.opp = opp(kk9.uid);
  const calls = [];
  const base = {
    data, state: () => s, me: () => 's1',
    send: (cmd) => { calls.push(cmd.kind); const v = M.check(data, s, cmd); if (v.ok) { M.apply(data, s, cmd); M.glueAfter(data, s, cmd); } return v.ok; },
    check: (cmd) => M.check(data, s, cmd),
    overwatch: (uid, actionId) => calls.push(`overwatch:${uid}:${actionId}`),
    attack: (uid, actionId, opts) => calls.push(`attack:${uid}:${actionId}:${opts?.granted ? 'granted' : ''}:${opts?.only ?? ''}`),
  };
  const api = new Proxy(base, { get: (o, k) => (k in o ? o[k] : () => undefined) });
  M.guideAct(api, 'g-perform', { dataset: { uid: String(kk9.uid), id: 'LHDR-KK9_B' } });
  await settle();
  check('F8p the pad\'s Perform on the Overwatch Strike asks its enemy and Mech', calls, [`overwatch:${kk9.uid}:LHDR-KK9_B`]);
  s.script.reactions = [{ uid: mech.uid, actionId: 'LHDR-KK9_B', count: 0, range: 0, kind: 'overwatch', fromUid: foe.uid }];
  calls.length = 0;
  M.guideAct(api, 'g-overwatch', { dataset: { uid: String(mech.uid), id: 'LHDR-KK9_B', gun: '058_A' } });
  check('F8p the Mech\'s row fires a granted Firing Action at that enemy only', calls, [`attack:${mech.uid}:058_A:granted:${foe.uid}`]);
  const pad = readFileSync(new URL('../pad/pad.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const guided = readFileSync(new URL('../pad/guided.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check('F8p a Guided call pays the KK9, then calls the strike', /if \(!send\(\{ kind: 'performAction', seat: t\.side, uid: t\.uid, actionId \}\)\) return;\s*if \(send\(\{ \.\.\.call, chain: 'join' \}\)\)/.test(pad), true);
  check('F8p and the reaction row is named for it', /r\.kind === 'overwatch' \? 'Overwatch Strike'/.test(guided), true);
  check('F8p Freeform has its own door on the KK9\'s row', /overwatchOf\(g\.action\)\s*\? `<button class="pad-chip on pad-perform" data-act="overwatch"/.test(pad), true);
  // G4p: the lent door routes an attack, an Electronic Attack or a launch to its
  // tool, and each payment takes the loan as its Part (O7).
  check('G4p the lent door opens the target pick for a lent attack', /lentPart = \{ uid: by\.uid, actionId, key \};\s*const electronic = /.test(pad), true);
  check('G4p and the launch for a lent launcher', /lentPart = \{ uid: by\.uid, actionId, key \};\s*void launchFrom\(by, actionId, cardId\);/.test(pad), true);
  check('G4p every payment on the way takes the loan', [(pad.match(/= lentPay\(/g) ?? []).length, (pad.match(/\.\.\.lent(All)?\b/g) ?? []).length], [4, 4]);
  // The attack is declared in the Target panel now (notices, 2026-09-29); the
// Action is still found through actionOfUnit, a lent one included.
check('G4p the attack and launch find a lent Action', [/function commitDeclared\(\)[\s\S]{0,1200}const a = actionOfUnit\(attacker, d\.actionId\);/.test(pad), /async function launchFrom[\s\S]{0,200}const action = actionOfUnit\(t, actionId\);/.test(pad)], [true, true]);
  const attackSrc = readFileSync(new URL('../pad/attack.ts', import.meta.url), 'utf8');
  const ewSrc = readFileSync(new URL('../pad/ew.ts', import.meta.url), 'utf8');
  check('G4p and so do the attack window and the counter-roll', [/loanedParts\(a\.data, a\.state\(\)\.tokens, t, \{ anywhere: true \}\)/.test(attackSrc), /loanedParts\(a\.data, a\.state\(\)\.tokens, t, \{ anywhere: true \}\)/.test(ewSrc)], [true, true]);
}

// ================= E1. walls stand as 3-inch terrain (AS3; Barricade, p.92) =================
{
  // "This unit is considered as 3-inch terrain" (the AS3 walls), and the Turtle
  // Shell's Barricade: "When another Ally Unit is the target of an Attack, this
  // Unit is considered as 3-inch high Terrain". Both stood as small units that
  // blocked no sight and paid no Terrain Protection.
  const firing = { type: 'Firing' };
  const scene = (wallCard, wallSide) => {
    const s = table();
    const shooter = put(s, 's1', L(), 2, 5);
    const target = put(s, 's2', L(), 8, 5);
    const wall = wallCard ? droneOn(s, wallSide, wallCard, 0, 0, { col: 16, row: 16 }) : null;
    return { s, shooter, target, wall };
  };
  const cover = (x) => R.protectionFor(x.shooter, x.target, firing, [], x.s.tokens, []);
  check('E1 the control: an open line pays nothing', cover(scene(null)).white, 0);
  const a = scene('PDAM-003', 's2');
  check('E1 an AS3 wall in the line pays Terrain Protection', [cover(a).white, /Terrain Protection/.test(cover(a).note)], [2, true]);
  check('E1 whoever deployed it', cover(scene('PDAM-004', 's1')).white, 2);
  // Squarely between two one-cell units every line crosses it: blocked, where
  // a unit in the way only ever obstructs.
  const n = table();
  const near = droneOn(n, 's1', '159', 0, 0, { col: 10, row: 16 });
  const far = droneOn(n, 's2', '159', 0, 0, { col: 18, row: 16 });
  const sight = () => R.firingSight(near, far, [], n.tokens, []);
  const open = sight();
  droneOn(n, 's2', 'PDAM-003', 0, 0, { col: 14, row: 16 });
  check('E1 and a wall squarely in the way blocks the line', [open, sight()], ['clear', 'blocked']);
  const guard = scene('158', 's2');
  check('E1 a Turtle Shell guarding its ally is 3-inch terrain', cover(guard).white, 2);
  const foe = scene('158', 's1');
  check('E1 but not for a Firing Action at its enemy: it is only a small unit then', [cover(foe).white, /not Large/.test(cover(foe).note)], [0, true]);
}

// ================= E1b. a wall is a 1x3 line, across its facing (OTTO, 2026-09-28) =================
{
  // The data prints the AS3 walls and the Turtle Shell as a 1x3 line
  // (boardProfile footprint), and terrain stands wholly inside one Grid (p.21).
  // Facing North or South it runs East-West, East or West it runs North-South.
  const cellsOf = (x) => M.baseCells(x).map((c) => `${c.col},${c.row}`);
  check('E1b a wall facing North runs East-West along its row', cellsOf({ col: 15, row: 16, size: 1, cardId: 'PDAM-003', facing: 0 }), ['15,16', '16,16', '17,16']);
  check('E1b facing East it runs North-South down its column', cellsOf({ col: 16, row: 15, size: 1, cardId: 'PDAM-004', facing: 1 }), ['16,15', '16,16', '16,17']);
  check('E1b the Turtle Shell is one too, and a Drone stays square', [M.isLineUnit({ cardId: '158' }), cellsOf({ col: 4, row: 4, size: 2, cardId: '159', facing: 0 })], [true, ['4,4', '4,5', '5,4', '5,5']]);
  // Sight: a line one cell off the old single cell. A 1x1 wall at (15,16)
  // let a shooter at row 17 through; the line across (15..17, 16) does not.
  const n = table();
  const near = droneOn(n, 's1', '159', 0, 0, { col: 16, row: 12 });
  const far = droneOn(n, 's2', '159', 0, 0, { col: 17, row: 20 });
  const sight = () => R.firingSight(near, far, [], n.tokens, []);
  const open = sight();
  const wall = droneOn(n, 's2', 'PDAM-003', 0, 0, { col: 15, row: 16, facing: 0 });
  check('E1b the whole line blocks what it crosses', [open, sight()], ['clear', 'blocked']);
  wall.facing = 1;
  check('E1b turned, the same wall leaves the line clear', sight(), 'clear');
  wall.facing = 0;
  check('E1b and stands as terrain on all three cells', R.unitTerrain(n.tokens, null).find((p) => p.id === `unit:${wall.uid}`).subCells.map((c) => `${c.col},${c.row}`), ['15,16', '16,16', '17,16']);
  check('E1b nothing stands on it: the Grid\'s middle row is taken', R.spotsInGrid(droneOn(table(), 's1', '159', 0, 0, { col: 16, row: 17 }), [], n.tokens).filter((x) => x.row === 16).map((x) => x.ok), [false, false, false]);
  check('E1b Contact is the line\'s edge', [R.inContact(wall, { ...near, col: 17, row: 15, size: 1 }), R.inContact(wall, { ...near, col: 18, row: 15, size: 1 })], [true, false]);
  // Placement: the middle line of the Grid first, then another, never across Grids.
  check('E1b a line in an empty Grid takes the middle', R.lineSpot(5, 5, 0, [], []), { col: 15, row: 16 });
  const busy = table();
  droneOn(busy, 's1', '159', 0, 0, { col: 16, row: 16 });
  check('E1b one in the way, it takes another row', R.lineSpot(5, 5, 0, [], busy.tokens), { col: 15, row: 15 });
  check('E1b and across, a column', R.lineSpot(5, 5, 1, [], busy.tokens), { col: 15, row: 15 });
  // The launch check holds the line to one Grid and a facing, on any board.
  const l = freeTable();
  const reaper = droneOn(l, 's1', 'PRDR-105', 5, 5);
  const deploy = (to, facing) => ({ kind: 'launch', seat: 's1', uid: reaper.uid, actionId: 'PRDR-105_B', cardId: 'PDAM-003', to, facing });
  check('E1b a wall launched inside one Grid is taken', ok(l, deploy({ col: 15, row: 16 }, 0)), true);
  check('E1b one that would cross into the next Grid is refused', ok(l, deploy({ col: 16, row: 16 }, 0)), false);
  check('E1b and down a column it starts on the Grid\'s top row', [ok(l, deploy({ col: 16, row: 15 }, 1)), ok(l, deploy({ col: 16, row: 16 }, 1))], [true, false]);
}

// ================= C1. a Mine in a Grid the walk enters stops it (ruling I16) =================
{
  // The GM-35 fires "when Ground Units enter the grid" (M6) and the Movement
  // goes on past it (M19). Ruling I16: stop, resolve the blast, then go on with
  // the Range left unless the Chassis is destroyed. minesOwed asked only who
  // stood in the Grid after the move, so a walk through one left it armed.
  const s = table();
  s.round.phase = M.PHASES.indexOf('Action');
  // The chassis's own Movement Action, 020_A, Range 4: a Maneuver is one or
  // two Grids, so passing through a Mine is a Movement Action's case.
  const walker = put(s, 's1', L(), 5, 8);
  const sprint = actionOf('020', '020_A');
  const range = sprint.range;
  check('C1 the fixture Movement Action reaches 4 Grids', [sprint.type, range], ['Moving', 4]);
  const mine = droneOn(s, 's2', '074', 0, 0, { col: 16, row: 19 });
  s.script.opp = opp(walker.uid);
  check('C1 the Movement Action is paid', send(s, { kind: 'performAction', seat: 's1', uid: walker.uid, actionId: '020_A' }).ok, true);
  const route = [{ c: 5, r: 8 }, { c: 5, r: 7 }, { c: 5, r: 6 }, { c: 5, r: 5 }, { c: 5, r: 4 }];
  check('C1 the Mine two Grids along the route stops it there', U.mineStopIndex(data, s.tokens, walker, route, false), 2);
  check('C1 a flight enters only its landing', U.mineStopIndex(data, s.tokens, walker, route, true), -1);
  check('C1 and a Mine in the landing Grid is the landing\'s, as before', U.mineStopIndex(data, s.tokens, walker, route.slice(0, 3), false), -1);
  const left = range - 2;
  const first = { kind: 'maneuver', seat: 's1', uid: walker.uid, to: G(5, 6), via: [G(5, 7), G(5, 6)], free: true, actionId: '020_A', halt: left };
  check('C1 the stop keeps back no more than the Movement had', ok(s, { ...first, halt: left + 1 }), false);
  check('C1 the walk stops in the mined Grid with the rest kept back', [send(s, first).ok, s.script.opp?.mineHalt], [true, left]);
  check('C1 and the Mine owes its blast, the walker caught in it', U.minesOwed(data, s.tokens).some((x) => x.uid === mine.uid && x.victims.includes(walker.uid)), true);
  const on = { kind: 'maneuver', seat: 's1', uid: walker.uid, to: G(5, 6 - left), resume: true };
  // The blast first: the Go on waits while it is owed on the walker, and its
  // owner resolves it before the rest is judged (ruled R4; audit Phase 7, P7D 4).
  check('C1 not while the Mine\'s blast is still owed on it', ok(s, on), false);
  send(s, { kind: 'despawn', seat: 's2', uid: mine.uid, targetUid: mine.uid });
  check('C1 the blast resolved, the Mine is gone', s.tokens.some((x) => x.uid === mine.uid), false);
  check('C1 it goes no further than the Grids left', ok(s, { ...on, to: G(5, 5 - left) }), false);
  walker.partStates.chasis = 'destroyed';
  check('C1 and not at all on a destroyed Chassis', ok(s, on), false);
  walker.partStates.chasis = 'intact';
  const v = send(s, on);
  check('C1 it goes on with the rest, on the Tick already paid', [v.ok, v.why ?? '', s.script.opp?.mineHalt], [true, '', undefined]);
  check('C1 and the Maneuver Tick is still unspent: the walk belonged to the Movement Action', s.script.opp?.maneuvered, false);
  check('C1 once: nothing is left to go on with', ok(s, on), false);
}

// ================= C1b. a Knockback through a Mine stops there too (ruling I16) =================
{
  // Forced Movement enters the Grids of its line like any walk, so a mined Grid
  // on the way stops the victim, the Mine goes off, and the rest of the line
  // follows once the blast is resolved, if the unit still stands. Both boards
  // cut the line with the same reader the walk uses (audit Phase 5, C1b).
  const s = table();
  const victim = put(s, 's2', L(), 5, 5);
  droneOn(s, 's1', '074', 0, 0, { col: 16, row: 19 });
  const line = [{ c: 5, r: 6 }, { c: 5, r: 7 }, { c: 5, r: 8 }];
  const start = { c: 5, r: 5 };
  check('C1b a Knockback 3 line with a Mine in its first Grid stops there, 2 Grids left',
    (() => { const stop = U.mineStopIndex(data, s.tokens, victim, [start, ...line], false); return [stop, line.slice(0, stop).length, 3 - stop]; })(), [1, 1, 2]);
  check('C1b a Mine in the Grid the line ends in is the landing\'s, and stops nothing', U.mineStopIndex(data, s.tokens, victim, [start, ...line.slice(0, 1)], false), -1);
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check('C1b the tabletop cuts its Knockback line at the first Mine',
    /const stop = mineStopIndex\(data, state\.tokens, victim, \[\{ c: Math\.floor\(victim\.col \/ 3\), r: Math\.floor\(victim\.row \/ 3\) \}, \.\.\.line\], false\);\s*const path = stop > 0 \? line\.slice\(0, stop\) : line;/.test(main), true);
  check('C1b with the Grids the line had left', /const rest = stop > 0 \? kb\.grids - stop : 0;/.test(main) && /const rest = stop > 0 \? kb\.grids - stop : 0;/.test(hud), true);
  check('C1b and holds the rest for after the blast', /if \(rest > 0 && !fatal\) \{\s*pushOn = \{ by: attacker, victimUid: victim\.uid, action, dir, grids: rest \};/.test(main), true);
  check('C1b which goes on from the blast\'s own Go on door', /function offerGoOn\(\): void \{\s*offerPushOn\(\);/.test(main), true);
  check('C1b and pays Push\'s Link once', /push: kb\.push && !resume, facing/.test(main), true);
  check('C1b the Match Centre cuts it with the same reader',
    /const stop = mineStopIndex\(ctx\.data, ctx\.state\.tokens, victim, \[largeGridOf\(victim\), \.\.\.line\], false\);\s*const path = stop > 0 \? line\.slice\(0, stop\) : line;/.test(hud), true);
  check('C1b holds the rest on the forcing seat', /if \(out\.rest > 0 && !fatal && m\) pushOn = \{/.test(hud), true);
  check('C1b opens it once no Mine is owed on the unit', /if \(minesOwed\(ctx\.data, ctx\.state\.tokens\)\.some\(\(x\) => x\.victims\.includes\(victim\.uid\)\)\) return;/.test(hud), true);
  check('C1b and pays Push\'s Link once there too', /push: out\.kb\.push && !out\.resumed, facing/.test(hud), true);
}

// ================= A3. an Explosion and Optical Camouflage (p.71; ruling I13) =================
{
  // "including Melee/Shooting/Explosion damage": a camouflaged unit is Scanned
  // first, a unit with Electronic Value 0 or "-" cannot target one, and an
  // Attack on every unit in Range needs no Scan. The lists offered it freely.
  const s = table();
  s.round.phase = M.PHASES.indexOf('Delay');
  const razor = droneOn(s, 's1', '071', 5, 5);
  const rocket = droneOn(s, 's1', '267', 6, 5);
  const grenade = droneOn(s, 's1', '154', 5, 6);
  const hidden = put(s, 's2', L(), 5, 4, { statuses: ['camouflage'] });
  const open = put(s, 's2', L(), 6, 4);
  const det = (t, id) => actionOf(t.cardId, id);
  check('A3 a Missile Scans a camouflaged unit before its Explosion', U.explosionCamo(data, razor, det(razor, '071_A'), hidden), { scan: true });
  check('A3 an Electronic Value 0 Rocket cannot target it at all', 'why' in (U.explosionCamo(data, rocket, det(rocket, '267_A'), hidden) ?? {}), true);
  check('A3 a blast at every unit in Range needs no Scan', U.explosionCamo(data, grenade, det(grenade, '154_A'), hidden), null);
  check('A3 and an uncamouflaged unit is simply picked', U.explosionCamo(data, razor, det(razor, '071_A'), open), null);
  s.script.opp = opp(razor.uid);
  const scan = M.check(data, s, { kind: 'startCounterRoll', seat: 's1', uid: razor.uid, actionId: 'COMMON_SCAN', targetUid: hidden.uid });
  check('A3 and the engine lets the Missile open that Scan as the Initiator', [scan.ok, scan.why ?? ''], [true, '']);
  // What the three lists read back once the Scan is settled, on either seat:
  // a won one owes the target its Manifestation, a lost one leaves it hidden.
  check('A3 a won Scan leaves the unit appearing, a lost one failed', [
    U.blastScanState([{ uid: hidden.uid, kind: 'manifest', fromUid: razor.uid }], razor, hidden),
    U.blastScanState([], razor, hidden),
    U.blastScanState([], razor, open),
  ], ['appearing', 'failed', null]);
}

// ================= A2. a Missile's flight to its target is intercepted (4.9; p.67, p.94) =================
{
  // "Fly into target grid and undergo Detonation": the units in Range of
  // either end intercept that flight (p.67's worked example), and a Missile
  // Group is intercepted "during flight" (p.94). Every resolver exploded from
  // the Landing Grid without moving the Missile at all.
  check('A2 a Missile flies into its target\'s Grid', U.fliesToTarget(actionOf('071', '071_A')), true);
  check('A2 a Grenade does not', U.fliesToTarget(actionOf('154', '154_A')), false);
  const s = table();
  s.round.phase = M.PHASES.indexOf('Delay');
  const razor = droneOn(s, 's1', '071', 5, 3);
  const target = put(s, 's2', L(), 5, 6);
  check('A2 the target stands inside the Missile Range of 3', actionOf('071', '071_A').range, 3);
  const guard = put(s, 's2', L({ backpack: '003' }), 6, 6);
  const far = put(s, 's2', L({ backpack: '003' }), 1, 11);
  const flight = U.missileFlight(data, s.tokens, [], razor, target);
  check('A2 it comes down in the target\'s Grid', flight.to, { col: 16, row: 19 });
  const owedBy = (u) => flight.owed.filter((o) => o.uid === u.uid && o.targetUid === razor.uid && o.actionId === '003_A').length;
  check('A2 the AMS-190 beside the landing is owed an attempt', owedBy(guard), 1);
  check('A2 one out of Range of both ends is not', owedBy(far), 0);
  const fly = { kind: 'flyToTarget', seat: 's1', uid: razor.uid, actionId: '071_A', targetUid: target.uid };
  check('A2 a target beyond the Missile\'s Range is refused', ok(s, { ...fly, targetUid: far.uid }), false);
  const flown = send(s, fly);
  check('A2 the flight is its own command, and lands where the reading said', [flown.ok, flown.why ?? '', razor.col, razor.row], [true, '', flight.to.col, flight.to.row]);
  check('A2 a Grenade flies nowhere', ok(s, { ...fly, uid: droneOn(s, 's1', '154', 5, 5).uid, actionId: '154_A' }), false);
}

// ======================================================================
// THE SECOND PASS (MED and LOW), 2026-09-27
// ======================================================================

// ================= F6. "--" reaches the Adjacent Grids (4.2.2) =================
{
  // The lists print these Melee Actions' range as "--" (Melee): the Adjacent
  // Grids, diagonals included. Range 1 put a diagonal enemy out of reach.
  const dashed = ['ZHDR-201_A', 'ZHDR-202_A', 'ZHDR-203_A', 'ZHDR-302_A', 'ZHLA-101_B', 'ZHLA-304_B', 'ZHRA-304_B', 'MHKX-L_B', 'MHKX-R_B'];
  check('F6 all nine read "--" (Range 0)', dashed.map((id) => actionOf(id.replace(/_[AB]$/, ''), id)?.range), dashed.map(() => 0));
  check('F6 the control: the PL35 chassis prints a real Range 1', actionOf('182', '182_B')?.range, 1);
  const s = table();
  const hound = droneOn(s, 's1', 'ZHDR-201', 5, 5);
  const tear = actionOf('ZHDR-201', 'ZHDR-201_A');
  const diagonal = put(s, 's2', L(), 6, 6);
  check('F6 the Hound\'s Tear reaches a diagonal enemy', U.autoTargetsFor(data, s.tokens, hound, tear).map((x) => x.uid), [diagonal.uid]);
  const beside = put(s, 's2', L(), 5, 6);
  check('F6 and an orthogonal neighbour is nearer', U.autoTargetsFor(data, s.tokens, hound, tear).map((x) => x.uid), [beside.uid]);
  const t2 = table();
  const h2 = droneOn(t2, 's1', 'ZHDR-201', 5, 5);
  put(t2, 's2', L(), 7, 5);
  check('F6 two Grids away is out of reach', U.autoTargetsFor(data, t2.tokens, h2, tear).length, 0);
}

// ================= F5. the Tactic Actions named "Command Coordination" =================
{
  // "Give 1 Command Token to 1 Ally Drone", the keyword in the NAME alone: all
  // of them read Coordination 0, so the offer never came. The four front-face
  // ones went with GoF 1.021 (OTTO, 2026-09-28: the lists outrank the cards);
  // the four Discard faces stay.
  const ids = ['ZHLA-102-T_A', 'ZHLA-201-T_A', 'ZHRA-201-T_A', 'ZHRA-202-T_A'];
  check('F5 the four Discard faces Coordinate one Drone', ids.map((id) => U.commandCoordination(actionOf(id.replace(/_[AB]$/, ''), id))), ids.map(() => 1));
  check('F5 and the four front faces are gone',
    ['ZYBP-101', 'ZYBP-202', 'ZHLA-102', 'ZHLA-201'].map((id) => (data.byId.get(id).actions ?? []).map((a) => a.id)),
    [['ZYBP-101_A'], ['ZYBP-202_A'], ['ZHLA-102_A'], ['ZHLA-201_A']]);
  const f = freeTable();
  const m = put(f, 's1', L({ leftHand: 'ZHLA-102' }), 5, 5);
  check('F5 and the Missile carries it on the Mech that performs it', U.coordinationFor(data, m, actionOf('ZHLA-102', 'ZHLA-102_A')), 1);
  check('F5 the control: a Missile Action is still its own Coordination 1', U.commandCoordination(actionOf('ZHLA-102', 'ZHLA-102_A')), 1);
}

// ================= B8, B9, B10. Interception on a strict table (4.9, M5, M27; ruling I11) =================
{
  const s = table();
  const launcher = put(s, 's1', L({ leftHand: '064' }), 5, 9);
  const beacon = droneOn(s, 's1', '072', 5, 6, { parentUid: launcher.uid });
  const guard = put(s, 's2', L({ backpack: '003' }), 5, 5);
  const spend = (t) => ({ kind: 'spendIntercept', seat: 's2', uid: t.uid, actionId: '003_A' });
  // B9: only an owed attempt is made on a strict board.
  check('B9 nothing owed, so the strict board refuses the spend', ok(s, spend(guard)), false);
  const owed = U.interceptsOwed(data, s.tokens, [], launcher, [beacon]).filter((o) => o.actionId === '003_A');
  send(s, { kind: 'queueIntercepts', seat: 's1', items: owed });
  check('B9 the Launch owes it, so the spend is made', ok(s, spend(guard)), true);
  // The order every page now keeps: pay, then strike the attempt off.
  check('B9 settling the attempt first leaves the spend nothing to pay', (() => {
    const c = JSON.parse(JSON.stringify(s));
    M.apply(data, c, { kind: 'resolveIntercept', seat: 's2', uid: guard.uid, actionId: '003_A', targetUid: beacon.uid });
    return ok(c, spend(guard));
  })(), false);
  // Fire Control Interference names Interception; a destroyed Part performs nothing.
  guard.statuses = ['fci'];
  check('B9 Fire Control Interference refuses it', ok(s, spend(guard)), false);
  guard.statuses = [];
  guard.partStates.backpack = 'destroyed';
  check('B9 so does a destroyed Part', ok(s, spend(guard)), false);
  guard.partStates.backpack = 'intact';
  // B10: owed and makeable, so the skip and the phase wait (M5).
  check('B10 the skip waits on the owed attempt', ok(s, { kind: 'clearIntercepts', seat: 's2' }), false);
  check('B10 and so does the phase', /Interception/.test(M.check(data, s, { kind: 'advancePhase', seat: 's1' }).why ?? ''), true);
  guard.statuses = ['fci'];
  check('B10 an attempt nobody can make is not live', M.liveIntercepts(s).length, 0);
  check('B10 so the skip clears it', ok(s, { kind: 'clearIntercepts', seat: 's2' }), true);
  guard.statuses = [];
  // B8: never restored at a strict table; Undo takes back a slip.
  check('B8 the spend lands', send(s, spend(guard)).ok, true);
  check('B8 and the Token never comes back', ok(s, { kind: 'restoreIntercept', seat: 's2', uid: guard.uid, actionId: '003_A' }), false);
  check('B10 paid but not yet struck off, it still holds the phase', /Interception/.test(M.check(data, s, { kind: 'advancePhase', seat: 's1' }).why ?? ''), true);
  send(s, { kind: 'resolveIntercept', seat: 's2', uid: guard.uid, actionId: '003_A', targetUid: beacon.uid });
  check('B8 once it is struck off, nothing holds the phase', /Interception/.test(M.check(data, s, { kind: 'advancePhase', seat: 's1' }).why ?? ''), false);

  // The controls: the sandbox and Teaching keep their hand controls.
  const f = freeTable();
  const fg = put(f, 's2', L({ backpack: '003' }), 5, 5);
  check('B9 the control: the sandbox spends by hand', send(f, { kind: 'spendIntercept', seat: 's2', uid: fg.uid, actionId: '003_A' }).ok, true);
  check('B8 the control: and puts one back', ok(f, { kind: 'restoreIntercept', seat: 's2', uid: fg.uid, actionId: '003_A' }), true);
  const teach = table();
  teach.script.strict = false;
  const tl = put(teach, 's1', L({ leftHand: '064' }), 5, 9);
  const tb = droneOn(teach, 's1', '072', 5, 6, { parentUid: tl.uid });
  const tg = put(teach, 's2', L({ backpack: '003' }), 5, 5);
  send(teach, { kind: 'queueIntercepts', seat: 's1', items: U.interceptsOwed(data, teach.tokens, [], tl, [tb]) });
  check('B10 the control: Teaching may skip', ok(teach, { kind: 'clearIntercepts', seat: 's2' }), true);
  check('B9 the control: a strict table with no board judges for itself', (() => {
    const c = table();
    c.noBoard = true;
    const g = put(c, 's2', L({ backpack: '003' }), 5, 5);
    return ok(c, { kind: 'spendIntercept', seat: 's2', uid: g.uid, actionId: '003_A' });
  })(), true);
  check('B9 the control: Fire Control Interference refuses the sandbox too', (() => {
    tg.statuses = ['fci'];
    return ok(freeTable(), { kind: 'spendIntercept', seat: 's2', uid: tg.uid, actionId: '003_A' });
  })(), false);

  // The Match Centre lists what can be made: the engine's own reading. An
  // attempt under Fire Control Interference held its panel open for good.
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const at = hud.indexOf('function owedItems(');
  const { code } = await transform(hud.slice(at, hud.indexOf('\n}\n', at) + 3), { loader: 'ts' });
  const owedItems = new Function('ensureScript', 'liveIntercepts', 'alive', `${code}\nreturn owedItems;`)((x) => x.script, M.liveIntercepts, () => true);
  const h = table();
  const hl = put(h, 's1', L({ leftHand: '064' }), 5, 9);
  const hb = droneOn(h, 's1', '072', 5, 6, { parentUid: hl.uid });
  const hg = put(h, 's2', L({ backpack: '003' }), 5, 5);
  send(h, { kind: 'queueIntercepts', seat: 's1', items: U.interceptsOwed(data, h.tokens, [], hl, [hb]).filter((o) => o.actionId === '003_A') });
  hg.statuses = ['fci'];
  check('B9 the Match Centre drops the attempt nobody can make', owedItems({ state: h }).length, 0);
  hg.statuses = [];
  check('B9 and lists it again once it can be made', owedItems({ state: h }).map((x) => x.uid), [hg.uid]);

  // The tabletop guide pays before it settles: its row no longer strikes the
  // attempt off ahead of the spend.
  const pg = readFileSync(new URL('../src/playguide.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const row = pg.slice(pg.indexOf("'[data-intercept]'"), pg.indexOf('this.cb.onIntercept('));
  check('B9 the guide row leaves the settling to the spend', /resolveIntercept/.test(row), false);
}

// ================= B4. every Interception is a Firing Action for its modifiers (M26; ruling I9) =================
{
  // The AMS-190, AMS-192, AMS-193 and the Ot50 ADS print their Interception
  // Passive, and every modifier gates on a Firing Action, so the Caracal's
  // reroll, smoke and Low Profile never reached those four.
  const ids = ['003_A', '264_A', '286_A', '553_B'];
  check('B4 the four Passive Intercepts stay Passive on the card', ids.map((id) => actionOf(id.split('_')[0], id).type), ids.map(() => 'Passive'));
  const s = table();
  const launcher = put(s, 's1', L({ leftHand: '064' }), 5, 9);
  const beacon = droneOn(s, 's1', '072', 5, 6, { parentUid: launcher.uid });
  const guard = put(s, 's2', L({ backpack: '003' }), 5, 5);
  const caracal = put(s, 's2', L({ torso: '092' }), 7, 6);
  const ams = actionOf('003', '003_A');
  check('B4 the Caracal lends the Passive card nothing', U.missileGuidance(data, s.tokens, guard, beacon, ams, { terrain: [] }).map((x) => x.uid), []);
  check('B4 but lends the Interception its reroll', U.missileGuidance(data, s.tokens, guard, beacon, U.asInterception(ams), { terrain: [] }).map((x) => x.uid), [caracal.uid]);
  const helper = () => {
    const h = new M.AttackHelper(data, dice, makeEl('div'), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
    h.tokens = () => s.tokens;
    h.terrain = () => [];
    h.smoke = () => [];
    return h;
  };
  const h = helper();
  h.start(guard, ams, beacon, 'Interception', 0, '', false, true);
  check('B4 the attack window runs the Interception as a Firing Action', h.ctx.action.type, 'Firing');
  beacon.statuses = ['lowProfile'];
  check('B4 so a Low Profile Token reaches it', h.lowProfileOn(h.ctx).on, true);
  beacon.statuses = [];
  const plain = helper();
  plain.start(guard, ams, beacon, '', 0, '', false, false);
  check('B4 the control: only an Interception is retyped', plain.ctx.action.type, 'Passive');
  check('B4 the control: a Firing Intercept is the same Action', U.asInterception(actionOf('041', '041_A')) === actionOf('041', '041_A'), true);
}

// ================= B5. a Deploy owes no Interception (FAQ M20) =================
{
  // The Reaper's AS3 wall prints no English: its Deploy (设置) read as a Launch
  // and owed Interceptions. The bundle types it Deploying.
  const wall = actionOf('PRDR-105', 'PRDR-105_B');
  check('B5 the AS3 wall is Deployed', U.projectileDelivery(wall), 'deploy');
  const bare = { ...wall, projectileType: undefined };
  check('B5 and 设置 alone says so', U.projectileDelivery(bare), 'deploy');
  check('B5 and so does the projectileType of the bundle alone', U.projectileDelivery({ id: 'x', name: {}, description: {}, projectileType: 'Deploying' }), 'deploy');
  const layer = actionOf('006', '006_A');
  check('B5 布撒 alone is a Lay', U.projectileDelivery({ ...layer, name: {}, description: { zh: layer.description.zh } }), 'lay');
  check('B5 the English is the authority: the Rumba Launches though its Chinese says 设置', U.projectileDelivery(actionOf('PRDR-204', 'PRDR-204_C')), 'launch');
  check('B5 the control: the MES Beacon Launches', U.projectileDelivery(actionOf('064', '064_A')), 'launch');
  check('B5 the control: the Auto Mine Layer Lays', U.projectileDelivery(layer), 'lay');
}

// ================= A5. a Detonation takes the target its card names (4.7.5; p.94; ruling I12) =================
{
  // "Target 1 Enemy Unit" picks among enemies, a Unit Type the card names goes
  // first while one is in Range, and a Missile Group's Units attack one
  // target. Both boards listed every unit in Range, allies included.
  const s = table();
  const missile = droneOn(s, 's1', '071', 5, 5);
  const ally = put(s, 's1', L(), 5, 6);
  const foe = put(s, 's2', L(), 6, 5);
  const gun = actionOf('071', '071_A');
  check('A5 "Target 1 Enemy Unit" does not take an ally', U.detonationBar(s.tokens, missile, gun, [ally, foe], ally), 'ally');
  check('A5 it takes the enemy', U.detonationBar(s.tokens, missile, gun, [ally, foe], foe), '');
  const pk3 = droneOn(s, 's1', 'ZHAM-003', 5, 5);
  const shell = actionOf('ZHAM-003', 'ZHAM-003_A');
  const drone = droneOn(s, 's2', 'ZHDR-201', 4, 5);
  check('A5 the PK3 takes an Enemy Mech before a Drone', [U.detonationBar(s.tokens, pk3, shell, [foe, drone], drone), U.detonationBar(s.tokens, pk3, shell, [foe, drone], foe)], ['Mechs first', '']);
  check('A5 and the Drone when no Mech is in Range', U.detonationBar(s.tokens, pk3, shell, [drone], drone), '');
  check('A5 an allied Mech does not hold the priority', U.detonationBar(s.tokens, pk3, shell, [ally, drone], drone), '');
  check('A5 a table with no board names the priority rather than applying it', U.detonationBar(s.tokens, pk3, shell, [foe, drone], drone, { tableJudges: true }), '');
  check('A5 the pad names it', U.detonationPriority(shell), 'Mechs');
  const grenade = droneOn(s, 's1', '154', 5, 5);
  check('A5 the control: an "all Units" blast takes allies too', U.detonationBar(s.tokens, grenade, actionOf('154', '154_A'), [ally, foe], ally), '');

  // A Missile Group: the first Unit picks, the rest follow (ruling I12).
  const f = freeTable();
  const pod = put(f, 's1', L({ torso: '091', leftHand: '129', backpack: '086' }), 5, 9);
  send(f, { kind: 'launch', seat: 's1', uid: pod.uid, actionId: '129_A', cardId: '157', to: G(5, 6), facing: 0 });
  const group = f.tokens.filter((x) => x.cardId === '157');
  check('A5 an RKG70 launch puts down one group of three', [group.length, new Set(group.map((x) => x.group)).size, group[0].group], [3, 1, group[0].uid]);
  const a = put(f, 's2', L(), 5, 4);
  const b = put(f, 's2', L(), 6, 5);
  const rkg = actionOf('157', '157_A');
  const [first, second, third] = group;
  check('A5 nothing is fixed before the first pick', U.detonationBar(f.tokens, second, rkg, [a, b], b), '');
  check('A5 the first Unit flies at its pick', send(f, { kind: 'flyToTarget', seat: 's1', uid: first.uid, actionId: '157_A', targetUid: a.uid }).ok, true);
  check('A5 the rest follow it', [second.groupTarget, third.groupTarget], [a.uid, a.uid]);
  check('A5 so the second may not pick another', [U.detonationBar(f.tokens, second, rkg, [a, b], b), ok(f, { kind: 'flyToTarget', seat: 's1', uid: second.uid, actionId: '157_A', targetUid: b.uid })], ["group's target", false]);
  check('A5 and takes the group target', [U.detonationBar(f.tokens, second, rkg, [a, b], a), ok(f, { kind: 'flyToTarget', seat: 's1', uid: second.uid, actionId: '157_A', targetUid: a.uid })], ['', true]);
  const re = U.migrateState(JSON.parse(JSON.stringify(f)), data);
  check('A5 the group and its target survive a reload', re.tokens.filter((x) => x.cardId === '157').map((x) => [x.group, x.groupTarget ?? null]), [[first.uid, null], [first.uid, a.uid], [first.uid, a.uid]]);
  a.partStates.torso = 'destroyed';
  check('A5 once that target is gone, the rest pick again', ok(f, { kind: 'flyToTarget', seat: 's1', uid: second.uid, actionId: '157_A', targetUid: b.uid }), true);
  check('A5 the control: a single Missile is no group', (() => {
    const g = freeTable();
    const rack = put(g, 's1', L({ leftHand: '064' }), 5, 9);
    send(g, { kind: 'launch', seat: 's1', uid: rack.uid, actionId: '064_A', cardId: '072', to: G(5, 6), facing: 0 });
    return g.tokens.find((x) => x.cardId === '072')?.group;
  })(), undefined);
}

// ================= A6. the PK3 stays when it has no target (GoF 1.021) =================
{
  // 4.7.5 destroys a Projectile whose Delayed Action finds no target "unless
  // otherwise specified", and GoF 1.021 prints that the PK3 is not removed.
  check('A6 the PK3 prints that it is not removed with no target', U.keptWithoutTarget(actionOf('ZHAM-003', 'ZHAM-003_A')), true);
  check('A6 the control: an ordinary Missile is destroyed instead', U.keptWithoutTarget(actionOf('071', '071_A')), false);
}

// ================= A7. a launch is performed in the unit's own activation (4.7.3) =================
{
  // The card's Launch door sent a launch with no activation behind it: an
  // uncommanded Hyena Missile launched in any phase, and a Mech launched
  // outside its Opportunity for no Tick.
  const s = table();
  const m = put(s, 's1', L({ leftHand: '064' }), 5, 9);
  const rack = { kind: 'launch', seat: 's1', uid: m.uid, actionId: '064_A', cardId: '072', to: G(5, 6), facing: 0 };
  check('A7 a Mech without the Opportunity cannot launch', ok(s, rack), false);
  s.script.opp = opp(m.uid);
  check('A7 in its Opportunity it may', ok(s, rack), true);
  const hyena = droneOn(s, 's1', '079', 3, 3);
  const missile = { kind: 'launch', seat: 's1', uid: hyena.uid, actionId: '079_A', cardId: '071', to: G(3, 5), facing: 0 };
  check('A7 an uncommanded Hyena Missile cannot launch', ok(s, missile), false);
  s.round.phase = M.PHASES.indexOf('Automatic');
  s.script.opp = opp(hyena.uid);
  check('A7 nor in the Automatic Phase, a Command-icon Action', ok(s, missile), false);
  s.round.phase = M.PHASES.indexOf('Command');
  check('A7 its Command activation may', ok(s, missile), true);

  // The controls: the sandbox and Teaching keep the card door.
  const f = freeTable();
  const fm = put(f, 's1', L({ leftHand: '064' }), 5, 9);
  check('A7 the control: the sandbox launches from the card', ok(f, { ...rack, uid: fm.uid }), true);
  const teach = table();
  teach.script.strict = false;
  const tm = put(teach, 's1', L({ leftHand: '064' }), 5, 9);
  check('A7 the control: Teaching launches from the card', ok(teach, { ...rack, uid: tm.uid }), true);
}

// ================= A8. the smaller Projectile findings (LOW) =================
{
  // The launch check bounded nothing: a Range 3 launch 18 Grids away passed.
  const f = freeTable();
  const m = put(f, 's1', L({ leftHand: '064' }), 5, 9);
  const shot = (c, r) => ({ kind: 'launch', seat: 's1', uid: m.uid, actionId: '064_A', cardId: '072', to: G(c, r), facing: 0 });
  check('A8 a Landing Point within Range 6 is taken', ok(f, shot(5, 3)), true);
  check('A8 one beyond it is refused', ok(f, shot(5, 2)), false);
  check('A8 counted orthogonally, as the pages light it', [ok(f, shot(8, 6)), ok(f, shot(8, 5))], [true, false]);
  const nb = freeTable();
  nb.noBoard = true;
  const nm = put(nb, 's1', L({ leftHand: '064' }), 5, 9);
  check('A8 the control: a table with no board has no distances', ok(nb, { ...shot(0, 0), uid: nm.uid }), true);

  // The Swift prints no Cruising in GoF 1.021 (ruling I3).
  const swift = actionOf('ZHAM-001A', 'ZHAM-001A_A');
  check('A8 the Swift prints no Cruising', [/Cruis/i.test(swift.description.en), /巡航/.test(swift.description.zh ?? ''), (swift.keywords ?? []).length], [false, false, 0]);
  check('A8 and still flies to its target', U.fliesToTarget(swift), true);

  // The Pholcus rack launches the folded Pholcus only (FAQ M18.3).
  const r = freeTable();
  // A free hand: the rack's Pholcus is Thrown (4.17; audit Phase 7, P7A 6).
  const rack = put(r, 's1', L({ backpack: '082', leftHand: '037' }), 5, 5);
  const offered = U.guidedActions(data, rack).find((g) => g.action.id === '082_A')?.projectiles.map((c) => c.id);
  check('A8 the Pholcus rack offers the folded Pholcus, not the Unfolded Drone', offered, ['156']);
  const launch = (cardId) => ({ kind: 'launch', seat: 's1', uid: rack.uid, actionId: '082_A', cardId, to: G(5, 4), facing: 0 });
  check('A8 and the check refuses the Unfolded one', [ok(r, launch('156')), ok(r, launch('167'))], [true, false]);

  // 3.6.1 designates units to perform a Delayed Action: no Mine, wall or
  // Passive Beacon.
  const s = table();
  s.round.phase = M.PHASES.indexOf('Delay');
  const missile = droneOn(s, 's1', '071', 2, 2);
  droneOn(s, 's1', '074', 3, 3);
  droneOn(s, 's1', 'PDAM-003', 4, 4);
  droneOn(s, 's1', '076', 6, 6);
  const link = droneOn(s, 's1', '075', 7, 7);
  check('A8 the Delay loop designates the Missile and the Link Beacon only', M.Lp.eligibleUnits(s, 'Delay', 's1', data).map((x) => x.uid), [missile.uid, link.uid]);
  check('A8 the control: without the cards it lists every Projectile', M.Lp.eligibleUnits(s, 'Delay', 's1').length, 5);

  // An Immediate Projectile that came through its Interception is owed its
  // Detonation now.
  const g = table();
  const grenade = droneOn(g, 's1', '154', 5, 5);
  const guard = put(g, 's2', L({ backpack: '003' }), 5, 7);
  const owed = [{ uid: guard.uid, actionId: '003_A', targetUid: grenade.uid }];
  check('A8 an Immediate Projectile waits while an Interception is owed at it', U.immediatesOwed(data, g.tokens, owed).length, 0);
  check('A8 and is owed its Detonation once none is', U.immediatesOwed(data, g.tokens, []), [{ uid: grenade.uid, actionId: '154_A' }]);
  check('A8 the control: a Delayed Missile is not', U.immediatesOwed(data, [droneOn(table(), 's1', '071', 1, 1)], []).length, 0);
}

// ================= E2. a Low Value Drone is never deployed at setup (p.82) =================
{
  // "cannot be placed during the Deployment stage": deployUnit refused only
  // Projectiles, so a Bit, the Delphinium, a Dragonfly, SU1 and SU2 all passed.
  const s = table();
  s.setup.stage = 'deploy';
  const bit = droneOn(s, 's1', '293', 5, 5, { deployed: false });
  const hound = droneOn(s, 's1', 'ZHDR-201', 5, 6, { deployed: false });
  // In s1's White strip, A11-L12: the engine now judges the Deployment Zone
  // (audit Phase 6, A3).
  const place = (t) => ({ kind: 'deployUnit', seat: 's1', uid: t.uid, to: G(1, 10) });
  check('E2 a Low Value Drone is never deployed', ok(s, place(bit)), false);
  check('E2 an ordinary Drone is', ok(s, place(hound)), true);
  check('E2 and the Bit is not waited on', M.Su.deployable(s, 's1', data).map((x) => x.uid), [hound.uid]);
  hound.deployed = true;
  check('E2 so deployment finishes without it', M.Su.deploymentComplete(s, data), true);
  check('E2 the control: without the cards every Drone waits, as before', M.Su.deployable(s, 's1').map((x) => x.uid), [bit.uid]);
}

// ================= F9. the smaller Drone and Command findings (LOW) =================
{
  // SU1 and SU2 (ruling I2): the DLSP-2 launches SU2, which it could never do.
  // SU1 loses the Single Shot GoF 1.021 moved to SU2: OTTO ruled on 2026-09-28
  // that the company's lists outrank the cards, retiring the 2026-09-03 keep.
  check('F9 SU1 prints Armor Patch alone (GoF 1.021)', (data.byId.get('ZYDR-108').actions ?? []).map((a) => a.id), ['ZYDR-108_B']);
  check('F9 and its Omni-direction Firing chip went with the Single Shot', data.byId.get('ZYDR-108').keywords, []);
  const r = freeTable();
  const pack = put(r, 's1', L({ backpack: 'DLSP-2' }), 5, 5);
  check('F9 the DLSP-2 launches SU2', U.guidedActions(data, pack).find((g) => g.action.id === 'DLSP-2_A')?.projectiles.map((c) => c.id), ['SU2']);
  check('F9 and the check takes it', ok(r, { kind: 'launch', seat: 's1', uid: pack.uid, actionId: 'DLSP-2_A', cardId: 'SU2', to: G(5, 3), facing: 0 }), true);

  // One activation at a time (3.2.2).
  const commandPhase = () => {
    const s = table();
    s.round.phase = M.PHASES.indexOf('Command');
    s.script.turn = 's1';
    s.commandTokens = { s1: 2, s2: 0 };
    return s;
  };
  const s = commandPhase();
  const mech = put(s, 's1', L(), 1, 1, { statuses: ['command', 'command'] });
  const d1 = droneOn(s, 's1', 'ZHDR-201', 3, 3);
  const d2 = droneOn(s, 's1', 'ZHDR-202', 6, 3);
  check('F9 the first Drone is designated', send(s, { kind: 'designate', seat: 's1', uid: d1.uid, fromUid: mech.uid }).ok, true);
  s.script.turn = 's1';
  check('F9 no second while its activation is open', ok(s, { kind: 'designate', seat: 's1', uid: d2.uid, fromUid: mech.uid }), false);
  send(s, { kind: 'endOpportunity', seat: 's1', uid: d1.uid });
  s.script.turn = 's1';
  check('F9 once it ends, the next may be', ok(s, { kind: 'designate', seat: 's1', uid: d2.uid, fromUid: mech.uid }), true);
  check('F9 the control: an activation whose unit has left the board is over', (() => {
    const t = commandPhase();
    const m2 = put(t, 's1', L(), 1, 1, { statuses: ['command'] });
    const x = droneOn(t, 's1', 'ZHDR-202', 6, 3);
    t.script.opp = opp(999);
    return ok(t, { kind: 'designate', seat: 's1', uid: x.uid, fromUid: m2.uid });
  })(), true);

  // Command Coordination rides on an Action or Maneuver this Mech performed
  // in its own Opportunity (4.15.3); a Shutdown Mech coordinates nothing.
  const c = table();
  c.round.phase = M.PHASES.indexOf('Action');
  const coordinator = put(c, 's1', L({ leftHand: 'ZHLA-102' }), 1, 1, { statuses: ['command'] });
  const hound = droneOn(c, 's1', 'ZHDR-201', 3, 3);
  const coord = { kind: 'coordinateCommand', seat: 's1', uid: coordinator.uid, targetUid: hound.uid };
  check('F9 no Coordination outside its Opportunity', ok(c, coord), false);
  c.script.opp = opp(coordinator.uid, { timing: 'projectile' });
  check('F9 nor with nothing performed that carries it', ok(c, coord), false);
  c.script.opp = opp(coordinator.uid, { timing: 'projectile', performed: ['ZHLA-102_A'] });
  check('F9 the Missile carries it, so the Coordination is sent', ok(c, coord), true);
  coordinator.stance = 'shutdown';
  check('F9 a Shutdown Mech coordinates nothing', ok(c, coord), false);
  coordinator.stance = 'offensive';
  const f = freeTable();
  const fm = put(f, 's1', L(), 1, 1, { statuses: ['command'] });
  const fd = droneOn(f, 's1', 'ZHDR-201', 3, 3);
  check('F9 the control: the sandbox hands one out by hand', ok(f, { kind: 'coordinateCommand', seat: 's1', uid: fm.uid, targetUid: fd.uid }), true);

  // Additional Instructions (ruling I7): a Command of its own, a Command
  // Action only, and too late once the squad has passed.
  const a = commandPhase();
  a.tactics = { s1: ['274'], s2: [] };
  const am = put(a, 's1', L(), 1, 1, { statuses: ['command'] });
  const ad = droneOn(a, 's1', 'ZHDR-201', 3, 3);
  check('F9 Additional Instructions is played on the Drone', send(a, { kind: 'playTactic', seat: 's1', uid: ad.uid, cardId: '274' }).ok, true);
  check('F9 its free Command designates it', send(a, { kind: 'designate', seat: 's1', uid: ad.uid }).ok, true);
  check('F9 and the activation takes a Command Action only', [a.script.opp?.commandOnly, ok(a, { kind: 'maneuver', seat: 's1', uid: ad.uid, to: { col: ad.col, row: ad.row - 3 } })], [true, false]);
  send(a, { kind: 'endOpportunity', seat: 's1', uid: ad.uid });
  a.script.turn = 's1';
  check('F9 the Drone keeps its own Command', ok(a, { kind: 'designate', seat: 's1', uid: ad.uid, fromUid: am.uid }), true);
  send(a, { kind: 'designate', seat: 's1', uid: ad.uid, fromUid: am.uid });
  check('F9 and that activation may Move', [a.script.opp?.commandOnly ?? null, ok(a, { kind: 'maneuver', seat: 's1', uid: ad.uid, to: { col: ad.col, row: ad.row - 3 } })], [null, true]);
  const after = commandPhase();
  after.tactics = { s1: ['274'], s2: [] };
  const bm = put(after, 's1', L(), 1, 1, { statuses: ['command'] });
  const bd = droneOn(after, 's1', 'ZHDR-201', 3, 3);
  send(after, { kind: 'designate', seat: 's1', uid: bd.uid, fromUid: bm.uid });
  send(after, { kind: 'endOpportunity', seat: 's1', uid: bd.uid });
  after.script.turn = 's1';
  send(after, { kind: 'playTactic', seat: 's1', uid: bd.uid, cardId: '274' });
  check('F9 played after its own Command, it still designates the Drone', ok(after, { kind: 'designate', seat: 's1', uid: bd.uid }), true);
  const late = commandPhase();
  late.tactics = { s1: ['274'], s2: [] };
  const ld = droneOn(late, 's1', 'ZHDR-201', 3, 3);
  late.script.passed = ['s1'];
  check('F9 Additional Instructions is refused once the squad has passed', ok(late, { kind: 'playTactic', seat: 's1', uid: ld.uid, cardId: '274' }), false);

  // The Neutral fallback: a Container the Action could target, in sight, in
  // front and within the lengthened reach (ruling I5).
  const box = (id, cc, rr) => ({ id, type: 'container', isFragile: true, height: 1, blocksLos: false, providesProtection: false, subCells: [{ col: cc * 3 + 1, row: rr * 3 + 1 }] });
  const wall = (id, cc, rr) => ({ id, type: 'building', isFragile: false, height: 3, blocksLos: true, providesProtection: true, subCells: [{ col: cc * 3, row: rr * 3 }, { col: cc * 3 + 1, row: rr * 3 }, { col: cc * 3 + 2, row: rr * 3 }, { col: cc * 3, row: rr * 3 + 1 }, { col: cc * 3 + 1, row: rr * 3 + 1 }, { col: cc * 3 + 2, row: rr * 3 + 1 }, { col: cc * 3, row: rr * 3 + 2 }, { col: cc * 3 + 1, row: rr * 3 + 2 }, { col: cc * 3 + 2, row: rr * 3 + 2 }] });
  const gun = { id: 'A1', type: 'Firing', speed: 'auto', range: 2 };
  const n = table();
  const me = droneOn(n, 's1', 'ZHDR-201', 4, 4, { facing: 0 });
  check('F9 a Container in front and in Range is offered', U.autoNeutralTargets(data, n.tokens, [box('t1', 4, 2)], me, gun).map((x) => x.id), ['t1']);
  check('F9 not one behind a wall', U.autoNeutralTargets(data, n.tokens, [box('t1', 4, 2), wall('w1', 4, 3)], me, gun).map((x) => x.id), []);
  check('F9 nor one behind it', U.autoNeutralTargets(data, n.tokens, [box('t1', 4, 6)], me, gun).map((x) => x.id), []);
  const far = [box('t1', 4, 0)];
  check('F9 Range 2 does not reach 4 Grids', U.autoNeutralTargets(data, n.tokens, far, me, gun).map((x) => x.id), []);
  put(n, 's1', L({ torso: '173' }), 3, 4);
  check('F9 but the Centurion lengthens it by 2', U.autoNeutralTargets(data, n.tokens, far, me, gun).map((x) => x.id), ['t1']);

  // The YP23's Data Link: "may perform a 2 grid Move before performing its
  // Action" (GoF 1.021), which read as 0.
  const y = table();
  check('F9 the YP23 moves a commanded Drone 2 Grids first', U.commandRiderOf(data, put(y, 's1', L({ torso: 'YP23' }), 1, 1)).preMove, 2);
  check('F9 the control: an ordinary Torso moves it none', U.commandRiderOf(data, put(y, 's1', L(), 2, 2)).preMove, 0);
}

// ================= G5, H6. the command layer's ties, a Load's faction, Cruise Mode (LOW) =================
{
  // A lent Action names its Carrier, and the loan has to be real (FAQ O3/O7).
  const s = table();
  const me = put(s, 's1', L(), 5, 5);
  const carrier = carrierOn(s, 's1', '005', 0, 0, { col: 18, row: 15 });
  s.script.opp = opp(me.uid, { timing: 'firing' });
  const lent = (uid) => ({ kind: 'performAction', seat: 's1', uid: me.uid, actionId: '005_A', partKey: `005_A@${uid}` });
  check('G5 a Carrier in Contact lends its Load\'s Action', ok(s, lent(carrier.uid)), true);
  check('G5 a key naming no such Carrier is refused', ok(s, lent(9999)), false);
  carrier.col = 24;
  check('G5 nor once the Carrier is out of Contact', ok(s, lent(carrier.uid)), false);
  carrier.col = 18;

  // A launch takes a card its Action launches: the Vigilant's Cluster Grenade
  // does not throw the Rumba.
  const f = freeTable();
  const vigilant = droneOn(f, 's1', 'PRDR-204', 5, 5);
  const throwIt = (actionId, cardId) => ({ kind: 'launch', seat: 's1', uid: vigilant.uid, actionId, cardId, to: G(5, 4), facing: 0 });
  check('G5 the Cluster Grenade Action throws the Sardina', ok(f, throwIt('PRDR-204_A', 'PDAM-005')), true);
  check('G5 not the Rumba', ok(f, throwIt('PRDR-204_A', 'PDAM-006')), false);
  check('G5 which its own Beacon Action launches', ok(f, throwIt('PRDR-204_C', 'PDAM-006')), true);

  // A Stance Change is performed in the unit's own activation.
  const b = table();
  b.round.phase = M.PHASES.indexOf('Command');
  const bit = droneOn(b, 's1', '293', 5, 5);
  const change = (data.byId.get('293').actions ?? []).find((a) => U.formSwitch(a));
  const to = U.formSwitch(change).find((id) => id !== '293');
  const swap = { kind: 'switchForm', seat: 's1', uid: bit.uid, actionId: change.id, cardId: to };
  check('G5 no Stance Change outside the Bit\'s activation', ok(b, swap), false);
  b.script.opp = opp(bit.uid);
  check('G5 in it, the Bit turns over', ok(b, swap), true);
  check('G5 the control: the sandbox turns it by hand', (() => {
    const t = freeTable();
    const x = droneOn(t, 's1', '293', 5, 5);
    return ok(t, { ...swap, uid: x.uid });
  })(), true);

  // A Load is its Carrier's faction (ruling I26).
  const q = freeTable();
  const offLoad = carrierOn(q, 's1', '005', 2, 2);
  const onLoad = carrierOn(q, 's1', '083', 6, 6);
  const problems = U.factionProblems(data, q.tokens).filter((p) => p.kind === 'mixed-load');
  check('G5 an RDL Load on a UN Carrier is named', problems.map((p) => p.label), [offLoad.label]);
  check('G5 the control: a UN Load is not', problems.some((p) => p.label === onLoad.label), false);

  // H6: a cruising White Dwarf performs no lent Load Action.
  const w = table();
  const cruiser = put(w, 's1', L({ torso: '288' }), 5, 5);
  check('H6 a cruising White Dwarf performs no lent Action', typeof U.actionPartWhy(data, cruiser, actionOf('005', '005_A')), 'string');
  const walker = put(w, 's1', L({ torso: '287' }), 8, 8);
  check('H6 the control: out of Cruise Mode it may', U.actionPartWhy(data, walker, actionOf('005', '005_A')), null);
  check('H6 the Thruster prints "may exchange"', /may exchange \{lightning\}/.test(actionOf('292', '292_B').description.en), true);
}

// ================= H2, H3, H4. the White Dwarf in Cruise Mode =================
{
  // H4: the list greys what Cruise Mode refuses, so the guide cannot run an
  // arm's attack the payment then refuses.
  const s = table();
  const cruiser = put(s, 's1', L({ torso: '288' }), 5, 5);
  const rows = U.guidedActions(data, cruiser, { tokens: s.tokens, terrain: [] });
  const arm = rows.find((g) => g.action.id === '041_A');
  check('H4 a cruising White Dwarf\'s arm Action is greyed', [arm?.available, /Cruise Mode/.test(arm?.reason ?? '')], [false, true]);
  check('H4 its Torso still acts', rows.filter((g) => g.slot === 'torso').every((g) => g.available), true);
  const carrier = carrierOn(s, 's1', '005', 0, 0, { col: 18, row: 15 });
  const lentRow = U.guidedActions(data, cruiser, { tokens: s.tokens, terrain: [] }).find((g) => g.lentBy?.uid === carrier.uid);
  check('H6 and a lent Load Action is greyed with it', lentRow?.available, false);
  const walker = put(s, 's1', L({ torso: '287' }), 1, 1);
  check('H4 the control: out of Cruise Mode the arm acts', U.guidedActions(data, walker, { tokens: s.tokens, terrain: [] }).find((g) => g.action.id === '041_A')?.available, true);

  // H3: deployed in Cruise Mode, it is in Mobility (ruling I28).
  const d = table();
  d.setup.stage = 'deploy';
  const wd = put(d, 's1', L({ torso: '288' }), 1, 1, { deployed: false, stance: 'offensive' });
  send(d, { kind: 'deployUnit', seat: 's1', uid: wd.uid, to: G(1, 10), stance: 'offensive' });
  check('H3 a White Dwarf deployed in Cruise Mode is in Mobility', wd.stance, 'mobility');
  const other = put(d, 's2', L(), 8, 8, { deployed: false });
  d.setup.placed = { s1: 1, s2: 0 };
  send(d, { kind: 'deployUnit', seat: 's2', uid: other.uid, to: G(8, 1), stance: 'defensive' });
  check('H3 the control: any other Mech lands in the Stance picked', other.stance, 'defensive');

  // H2: a Surplus reaches another Part of a cruising White Dwarf (FAQ N7).
  const h = new M.AttackHelper(data, dice, makeEl('div'), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  const shooter = put(s, 's2', L(), 5, 2);
  h.tokens = () => s.tokens;
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(shooter, actionOf('058', '058_A') ?? actionsOf(shooter).find((a) => a.type === 'Firing'), cruiser, '');
  check('H2 its other Parts are there for a Surplus', h.otherPartFor('torso'), true);
}

// ================= C2, C3, C4, C6. Mines: on entry, together, their own kind, a bounded Lay =================
{
  const owedUids = (s) => U.minesOwed(data, s.tokens).map((x) => x.uid);

  // C3: a Mine fires on ENTRY (ruling I15). Deployed onto a Ground unit that
  // already stands there, it waits; the GLP-15's Range 1 Deploy was a
  // repeatable Explosion on any adjacent Ground unit.
  const f = freeTable();
  const layer = put(f, 's1', L({ backpack: '006' }), 5, 5);
  const foe = put(f, 's2', L(), 5, 4);
  check('C3 the GLP-15 Deploys a Mine onto the enemy', send(f, { kind: 'launch', seat: 's1', uid: layer.uid, actionId: '006_B', cardId: '074', to: G(5, 4), facing: 0 }).ok, true);
  const mine = f.tokens.find((x) => x.cardId === '074');
  check('C3 it spares the Mech that stood there', owedUids(f).includes(mine.uid), false);
  const walkIn = put(f, 's2', L(), 7, 7);
  walkIn.col = foe.col + 1;
  walkIn.row = foe.row;
  check('C3 a Ground unit that enters its Grid sets it off', owedUids(f).includes(mine.uid), true);
  walkIn.col = 27;
  walkIn.row = 27;
  foe.col += 1;
  check('C3 and so does the spared one once it has moved', owedUids(f).includes(mine.uid), true);
  const own = freeTable();
  const walker = put(own, 's1', L({ backpack: '006' }), 5, 5);
  send(own, { kind: 'layMine', seat: 's1', uid: walker.uid, actionId: '006_A', cardId: '074', to: G(5, 5) });
  check('C3 a Mine Laid in the layer\'s own end Grid goes off as it enters (M7)', owedUids(own).length, 1);
  // Laid or launched alike, a unit already standing in the Grid is spared
  // (OTTO, 2026-09-28, for consistency); the layer is not, as M7 Lays before it
  // enters.
  const laidOn = freeTable();
  const layer2 = put(laidOn, 's1', L({ backpack: '006' }), 5, 6);
  const standing = put(laidOn, 's1', L(), 5, 5);
  send(laidOn, { kind: 'layMine', seat: 's1', uid: layer2.uid, actionId: '006_A', cardId: '074', to: G(5, 5) });
  const laidMine = laidOn.tokens.find((x) => x.cardId === '074');
  check('C3 a Mine Laid where an ally stands spares it', [owedUids(laidOn), (laidMine.mine?.spared ?? []).map((x) => x.uid)], [[], [standing.uid]]);
  send(laidOn, { kind: 'forceMove', seat: 's1', uid: standing.uid, targetUid: standing.uid, to: { col: standing.col, row: standing.row - 3 } });
  send(laidOn, { kind: 'forceMove', seat: 's1', uid: standing.uid, targetUid: standing.uid, to: { col: standing.col, row: standing.row + 3 } });
  check('C3 until it moves and comes back', owedUids(laidOn), [laidMine.uid]);

  // Spared only until it moves: back onto the very cell it stood on is an
  // entry like any other, over two commands or in one walk out of the Grid.
  const sparedOn = () => {
    const t = freeTable();
    const by = put(t, 's1', L({ backpack: '006' }), 5, 5);
    const sat = put(t, 's2', L(), 5, 4);
    send(t, { kind: 'launch', seat: 's1', uid: by.uid, actionId: '006_B', cardId: '074', to: G(5, 4), facing: 0 });
    return { t, sat, home: { col: sat.col, row: sat.row }, mine: t.tokens.find((x) => x.cardId === '074') };
  };
  // Each walk in an Opportunity of its own, as the Action Phase gives one.
  const walk = (x, to, extra = {}) => {
    x.t.script.opp = opp(x.sat.uid);
    return [send(x.t, { kind: 'maneuver', seat: 's2', uid: x.sat.uid, to, ...extra }).ok, owedUids(x.t).includes(x.mine.uid)];
  };
  const b = sparedOn();
  check('C3 a turn on the spot keeps the reprieve', walk(b, b.home, { facing: 1 }), [true, false]);
  check('C3 out of its Grid, nothing is owed', walk(b, G(5, 3)), [true, false]);
  check('C3 back onto the very cell it stood on, it sets the Mine off', walk(b, b.home), [true, true]);
  const w = sparedOn();
  check('C3 and so does one walk out of the Grid and back', walk(w, w.home, { via: [G(5, 3)] }), [true, true]);

  // C2: Mines in one Grid go off together, and one never destroys another
  // (FAQ I13); the second stays owed once the first has killed the unit.
  const two = freeTable();
  const m1 = droneOn(two, 's2', '074', 5, 5);
  const m2 = droneOn(two, 's2', '074', 5, 5, { col: 16, row: 16 });
  // It enters by a command, as in play: that is where the sweep marks them.
  const victim = put(two, 's1', L(), 4, 5);
  send(two, { kind: 'forceMove', seat: 's1', uid: victim.uid, targetUid: victim.uid, to: { col: 15, row: 15 } });
  const trig = U.minesOwed(data, two.tokens);
  check('C2 both Mines go off together', trig.map((x) => x.uid).sort(), [m1.uid, m2.uid].sort());
  check('C2 and neither blast lists the other Mine', trig.every((x) => !x.victims.some((v) => v === m1.uid || v === m2.uid)), true);
  check('C2 nor lets it be picked', U.detonationBar(two.tokens, m1, actionOf('074', '074_A'), [m2, victim], m2), 'a Mine');
  victim.partStates.torso = 'destroyed';
  send(two, { kind: 'despawn', seat: 's2', uid: m1.uid, targetUid: m1.uid });
  check('C2 the first resolved and the Mech dead, the second is still owed', owedUids(two), [m2.uid]);
  const m6 = freeTable();
  const older = droneOn(m6, 's2', '074', 5, 5);
  const newer = droneOn(m6, 's1', '074', 5, 5, { col: 16, row: 16 });
  const blast = U.minesOwed(data, m6.tokens).find((x) => x.uid === older.uid);
  check('C2 the control: a Mine Deployed into one sets it off, and may be caught (M6)', [!!blast, blast?.victims.includes(newer.uid)], [true, true]);

  // C4: a Mine is its own kind (ruling I14): Melee may hit it, and sight to it
  // is a ground unit's, which is how it gets Protection.
  const k = table();
  const hound = droneOn(k, 's1', 'ZHDR-201', 5, 5);
  const target = droneOn(k, 's2', '074', 5, 4);
  check('C4 the Hound\'s Melee Tear takes a Mine', U.autoTargetsFor(data, k.tokens, hound, actionOf('ZHDR-201', 'ZHDR-201_A')).map((x) => x.uid), [target.uid]);
  const wall = { id: 'w', type: 'building', isFragile: false, height: 3, blocksLos: true, providesProtection: true, subCells: [{ col: 15, row: 9 }, { col: 16, row: 9 }, { col: 17, row: 9 }] };
  const far = droneOn(k, 's2', '074', 5, 2);
  const beacon = droneOn(k, 's2', '071', 6, 2);
  check('C4 terrain blocks the line to a Mine', R.losBetween(hound, far, [wall], k.tokens), 'blocked');
  check('C4 the control: a Missile is Aerial, and no terrain blocks it', R.losBetween(hound, beacon, [wall], k.tokens), 'clear');

  // C6: a Lay is bounded (ruling I20): an intact GLP-15, during the layer's
  // own Movement, on a route it could have walked.
  const g = table();
  const mover = put(g, 's1', L({ backpack: '006' }), 5, 5);
  const lay = (c, r) => ({ kind: 'layMine', seat: 's1', uid: mover.uid, actionId: '006_A', cardId: '074', to: G(c, r) });
  check('C6 no Lay outside the layer\'s own Movement', ok(g, lay(5, 4)), false);
  g.script.opp = opp(mover.uid, { moved: true, maneuvered: true, movedFrom: { col: 15, row: 21 }, route: ['5,7', '5,6', '5,5'] });
  check('C6 on the route it walked, the Lay is taken', ok(g, lay(5, 6)), true);
  check('C6 a Grid no route of that Movement passes is refused', ok(g, lay(1, 1)), false);
  check('C6 nor one beside the route, however near', ok(g, lay(4, 6)), false);
  mover.partStates.backpack = 'destroyed';
  check('C6 and a destroyed GLP-15 Lays nothing', ok(g, lay(5, 6)), false);
  mover.partStates.backpack = 'intact';

  // The route travels with the Lay (the tabletop Lays before its Maneuver is
  // recorded), and a Flight Move's path is only its two ends (FAQ M29).
  const r = table();
  const flier = put(r, 's1', L({ backpack: '006' }), 5, 5);
  r.script.opp = opp(flier.uid);
  const walked = [G(5, 8), G(5, 7), G(5, 6), G(5, 5)];
  const rlay = (c, rr, extra = {}) => ({ kind: 'layMine', seat: 's1', uid: flier.uid, actionId: '006_A', cardId: '074', to: G(c, rr), route: walked, ...extra });
  check('C6 a carried walk: any Grid on it, before the Maneuver is recorded', [ok(r, rlay(5, 7)), ok(r, rlay(5, 8)), ok(r, rlay(5, 5))], [true, true, true]);
  check('C6 but not off it', ok(r, rlay(6, 7)), false);
  check('C6 a carried flight: its start and landing only (M29)', [ok(r, rlay(5, 8, { flying: true })), ok(r, rlay(5, 5, { flying: true })), ok(r, rlay(5, 7, { flying: true }))], [true, true, false]);
  check('C6 and the route ends where the layer stands', ok(r, { ...rlay(5, 7), route: [G(5, 8), G(5, 7), G(5, 6)] }), false);
  check('C6 no longer than its Movement', ok(r, { ...rlay(5, 7), route: [G(5, 11), G(5, 10), G(5, 9), G(5, 8), G(5, 7), G(5, 6), G(5, 5)] }), false);
  r.script.opp = opp(flier.uid, { moved: true, movedFrom: G(5, 8), route: ['5,8', '5,5'] });
  check('C6 once recorded, its start is one the Movement had', [ok(r, rlay(5, 7)), ok(r, { ...rlay(4, 5), route: [G(4, 5), G(5, 5)] })], [true, false]);
  r.script.opp = opp(flier.uid, { route: ['5,5'] });
  check('C6 and with none carried, a Grid the Opportunity holds is no Movement until it moved', ok(r, { kind: 'layMine', seat: 's1', uid: flier.uid, actionId: '006_A', cardId: '074', to: G(5, 5) }), false);
  check('C6 the control: the sandbox Lays anywhere by hand', (() => {
    const t = freeTable();
    const x = put(t, 's1', L({ backpack: '006' }), 5, 5);
    return ok(t, { kind: 'layMine', seat: 's1', uid: x.uid, actionId: '006_A', cardId: '074', to: G(1, 1) });
  })(), true);
}

// ================= D2, D3, D4, D5. the Pholcus (FAQ M18; rulings I18, I19) =================
{
  const delay = () => {
    const s = table();
    s.round.phase = M.PHASES.indexOf('Delay');
    s.script.turn = 's1';
    return s;
  };
  const owedBy = (s, uid) => U.minesOwed(data, s.tokens).find((x) => x.uid === uid);

  // D2: M18.4 is an event of the Unfold. It came up among the units in its
  // Grid, Aerial units and Mines aside, and a unit sharing it later owes none.
  const s = delay();
  const pholcus = droneOn(s, 's1', '156', 5, 5);
  const foe = put(s, 's2', L(), 5, 5);
  check('D2 the Unfold in an occupied Grid owes the blast', send(s, { kind: 'unfold', seat: 's1', uid: pholcus.uid }).ok && pholcus.unfoldBlast, true);
  check('D2 at the unit it came up among', owedBy(s, pholcus.uid)?.victims, [foe.uid]);
  const empty = delay();
  const quiet = droneOn(empty, 's1', '156', 5, 5);
  const flyer = droneOn(empty, 's2', '071', 5, 5);
  send(empty, { kind: 'unfold', seat: 's1', uid: quiet.uid });
  check('D2 an Aerial unit in the Grid is no occupant (I18)', !!quiet.unfoldBlast, false);
  const later = put(empty, 's2', L(), 5, 5);
  check('D2 and a unit sharing its Grid later owes nothing', owedBy(empty, quiet.uid), undefined);
  void flyer; void later;

  // D3: the Unfold "must" happen (M18.3).
  const d = delay();
  const folded = droneOn(d, 's1', '156', 3, 3);
  check('D3 its squad may not pass with the Unfold owed', ok(d, { kind: 'passTurn', seat: 's1' }), false);
  check('D3 nor may the phase turn', /Unfold/.test(M.check(data, d, { kind: 'advancePhase', seat: 's1' }).why ?? ''), true);
  check('D3 the other squad may pass', ok(d, { kind: 'passTurn', seat: 's2' }), true);
  send(d, { kind: 'unfold', seat: 's1', uid: folded.uid });
  check('D3 once it has Unfolded, the pass is taken', ok(d, { kind: 'passTurn', seat: 's1' }), true);
  const teach = delay();
  teach.script.strict = false;
  droneOn(teach, 's1', '156', 3, 3);
  check('D3 the control: Teaching lets a house rule pass', ok(teach, { kind: 'passTurn', seat: 's1' }), true);

  // D4: the folded Pholcus's landing Reveals by Contact, with I10's
  // Deployables.
  check('D4 the folded Pholcus breaks camouflage by Contact', U.breaksCamoByContact(data, droneOn(table(), 's1', '156', 1, 1)), true);
  check('D4 the control: a Missile does not', U.breaksCamoByContact(data, droneOn(table(), 's1', '071', 1, 1)), false);

  // D5: its Detonation takes the owed target: one of the units it came up
  // among (M18.4), or else the nearest enemy (M18.6).
  const jump = actionOf('167', '167_A');
  const other = put(s, 's2', L(), 6, 5);
  check('D5 the M18.4 blast takes a unit in its Grid', U.detonationBar(s.tokens, pholcus, jump, [foe, other], foe), '');
  check('D5 not one beside it', U.detonationBar(s.tokens, pholcus, jump, [foe, other], other), 'not in its Grid');
  const auto = table();
  const drone = droneOn(auto, 's1', '167', 5, 5);
  const near = put(auto, 's2', L(), 5, 6);
  const farther = put(auto, 's2', L(), 7, 5);
  const ally = put(auto, 's1', L(), 4, 5);
  check('D5 the Automatic Detonation takes the nearest enemy', U.detonationBar(auto.tokens, drone, jump, [near, farther, ally], near), '');
  check('D5 not a farther one', U.detonationBar(auto.tokens, drone, jump, [near, farther, ally], farther), 'not the nearest');
  check('D5 nor an ally', U.detonationBar(auto.tokens, drone, jump, [near, farther, ally], ally), 'ally');
  check('D5 the control: the PK3 is not held to the nearest', U.detonationBar(auto.tokens, droneOn(auto, 's1', 'ZHAM-003', 5, 5), actionOf('ZHAM-003', 'ZHAM-003_A'), [near, farther], farther), '');
}

// ================= F3. Automatic Actions are obligatory (3.5; ruling I4) =================
{
  const auto = () => {
    const s = table();
    s.round.phase = M.PHASES.indexOf('Automatic');
    s.script.turn = 's1';
    return s;
  };
  const s = auto();
  const hound = droneOn(s, 's1', 'ZHDR-201', 5, 5);
  put(s, 's2', L(), 5, 4);
  check('F3 a Drone with a legal target owes its Automatic Action', U.autoShotOwed(data, s.tokens, hound, { terrain: [], smoke: [] })?.id, 'ZHDR-201_A');
  check('F3 so its squad may not pass', ok(s, { kind: 'passTurn', seat: 's1' }), false);
  check('F3 the other squad, with none owed, may', ok(s, { kind: 'passTurn', seat: 's2' }), true);
  send(s, { kind: 'designate', seat: 's1', uid: hound.uid });
  check('F3 nor may its activation end untouched', ok(s, { kind: 'endOpportunity', seat: 's1', uid: hound.uid }), false);
  send(s, { kind: 'performAction', seat: 's1', uid: hound.uid, actionId: 'ZHDR-201_A' });
  check('F3 once it has acted, the activation ends', ok(s, { kind: 'endOpportunity', seat: 's1', uid: hound.uid }), true);

  const free = auto();
  droneOn(free, 's1', 'ZHDR-201', 5, 5);
  put(free, 's2', L(), 9, 9);
  check('F3 the control: with no legal target it passes freely', ok(free, { kind: 'passTurn', seat: 's1' }), true);
  const teach = auto();
  teach.script.strict = false;
  droneOn(teach, 's1', 'ZHDR-201', 5, 5);
  put(teach, 's2', L(), 5, 4);
  check('F3 the control: Teaching lets a house rule pass', ok(teach, { kind: 'passTurn', seat: 's1' }), true);
}

// ================= F8. the KK9's Overwatch Strike (FAQ K15) =================
{
  // "Designate 1 Enemy Unit within range as the target, allow 1 Ally Mech to
  // immediately perform 1 Firing Action against it. Then remove this Drone."
  // Nothing read it, and the Mech's Firing Action was refused outside its
  // activation.
  const s = table();
  s.round.phase = M.PHASES.indexOf('Command');
  const kk9 = droneOn(s, 's1', 'LHDR-KK9', 5, 5);
  const gunner = put(s, 's1', L(), 2, 2);
  const foe = put(s, 's2', L(), 5, 3);
  const far = put(s, 's2', L(), 9, 9);
  const call = (targetUid, mechUid = gunner.uid) => ({ kind: 'overwatch', seat: 's1', uid: kk9.uid, actionId: 'LHDR-KK9_B', targetUid, mechUid });
  check('F8 the KK9 reads as an Overwatch Strike', U.overwatchOf(actionOf('LHDR-KK9', 'LHDR-KK9_B')), true);
  check('F8 no strike outside the KK9\'s activation', ok(s, call(foe.uid)), false);
  s.script.opp = opp(kk9.uid);
  check('F8 an enemy out of Range is refused', ok(s, call(far.uid)), false);
  gunner.stance = 'shutdown';
  check('F8 a Shutdown Mech cannot fire', ok(s, call(foe.uid)), false);
  gunner.stance = 'offensive';
  check('F8 the strike is called', send(s, call(foe.uid)).ok, true);
  check('F8 the KK9 is removed', s.tokens.some((x) => x.uid === kk9.uid), false);
  check('F8 and the Mech owes one Firing Action at the enemy', s.script.reactions.filter((r) => r.kind === 'overwatch').map((r) => [r.uid, r.fromUid]), [[gunner.uid, foe.uid]]);
  const fire = actionsOf(gunner).find((a) => a.type === 'Firing');
  const melee = actionsOf(gunner).find((a) => a.type === 'Melee');
  if (melee) check('F8 the grant buys no Melee Action', ok(s, { kind: 'performAction', seat: 's1', uid: gunner.uid, actionId: melee.id, granted: true }), false);
  const v8 = send(s, { kind: 'performAction', seat: 's1', uid: gunner.uid, actionId: fire.id, granted: true });
  check('F8 it buys a Firing Action, outside any Opportunity', [v8.ok, v8.why ?? ''], [true, '']);
  check('F8 spent once', ok(s, { kind: 'performAction', seat: 's1', uid: gunner.uid, actionId: fire.id, granted: true }), false);
  check('F8 the debt survives a reload', U.migrateState(JSON.parse(JSON.stringify({ ...s, script: { ...s.script, reactions: [{ uid: gunner.uid, actionId: 'LHDR-KK9_B', count: 0, range: 0, kind: 'overwatch', fromUid: foe.uid }] } })), data).script.reactions.length, 1);
}

// ================= B7, C5, G4. the pad's table-judged halves =================
{
  // B7: who could owe an Interception, for a table that judges the Range.
  const s = freeTable();
  const guard = put(s, 's2', L({ backpack: '003' }), 5, 5);
  const jammed = put(s, 's2', L({ backpack: '003' }), 6, 6, { statuses: ['fci'] });
  const broken = put(s, 's2', L({ backpack: '003' }), 7, 7);
  broken.partStates.backpack = 'destroyed';
  broken.intercept = { '003_A': 3 };
  const ally = put(s, 's1', L({ backpack: '003' }), 1, 1);
  check('B7 an enemy with a Token left may owe one; not under FCI, a destroyed Part or an ally', U.interceptorsAgainst(data, s.tokens, 's1').map((x) => x.uid), [guard.uid]);
  void jammed; void ally;

  // C5: with no board the table says whether the Unfold's Grid was occupied.
  const pad = () => {
    const t = table();
    t.noBoard = true;
    t.round.phase = M.PHASES.indexOf('Delay');
    return t;
  };
  const a = pad();
  const p1 = droneOn(a, 's1', '156', 0, 0);
  put(a, 's2', L(), 0, 0);
  send(a, { kind: 'unfold', seat: 's1', uid: p1.uid, occupied: false });
  check('C5 an empty Grid the table reports owes no blast, placeholders or not', !!p1.unfoldBlast, false);
  const b = pad();
  const p2 = droneOn(b, 's1', '156', 0, 0);
  send(b, { kind: 'unfold', seat: 's1', uid: p2.uid, occupied: true });
  check('C5 an occupied one owes it', !!p2.unfoldBlast, true);
  const m = pad();
  const mine = droneOn(m, 's2', '074', 0, 0);
  const walker = put(m, 's1', L(), 0, 0);
  send(m, { kind: 'forceMove', seat: 's1', uid: walker.uid, targetUid: walker.uid, to: { col: 1, row: 1 } });
  check('C5 no Mine is marked from placeholder cells', !!mine.mine?.owed, false);

  // G4: with no board a lent Action is found, the table judging the Contact.
  const g = table();
  g.noBoard = true;
  const mech = put(g, 's1', L(), 0, 0);
  const carrier = carrierOn(g, 's1', '005', 0, 0, { col: 30, row: 30 });
  g.script.opp = opp(mech.uid, { timing: 'firing' });
  check('G4 a lent Action is taken on a table with no board', ok(g, { kind: 'performAction', seat: 's1', uid: mech.uid, actionId: '005_A', partKey: `005_A@${carrier.uid}` }), true);
}

// ================= I24. a Load's Dodge, during the Mech's own Action (FAQ O16, O5) =================
{
  const s = table();
  const me = put(s, 's1', L(), 5, 5, { stance: 'mobility' });
  carrierOn(s, 's1', '083', 0, 0, { col: 18, row: 15 });
  const foe = put(s, 's2', L(), 5, 2);
  const blue = (acting) => {
    const h = new M.AttackHelper(data, dice, makeEl('div'), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
    h.tokens = () => s.tokens;
    h.terrain = () => [];
    h.smoke = () => [];
    h.actingUid = () => acting;
    h.start(foe, actionsOf(foe).find((a) => a.type === 'Firing'), me, '');
    h.pickPart('torso');
    return h.ctx.defensePool.blue;
  };
  const base = blue(null);
  check('I24 the CSC60 a Carrier lends counts its Dodge while the Mech acts', blue(me.uid), base + 1);
  check('I24 not when it is targeted passively', blue(foe.uid), base);
}

// ================= F3 again: only an Action the Drone can perform is owed (audit Phase 6, B1) =================
{
  // Under Fire Control Interference, or Melee Locked, a Drone cannot fire, and
  // every page greys the row. Owing the shot anyway refused the pass and the end
  // of the activation alike, so a strict table could not leave the phase.
  const auto = () => {
    const s = table();
    s.round.phase = M.PHASES.indexOf('Automatic');
    s.script.turn = 's1';
    return s;
  };
  const owes = (s, t) => U.autoShotOwed(data, s.tokens, t, { terrain: [], smoke: [] })?.id ?? null;
  const s = auto();
  const valk = droneOn(s, 's1', 'ZHDR-303', 5, 5);
  put(s, 's2', L(), 5, 2);
  check('F3 the control: the Valkyrie owes its Automatic Firing Action', owes(s, valk), 'ZHDR-303_A');
  valk.statuses = ['fci'];
  check('F3 under Fire Control Interference it owes nothing', owes(s, valk), null);
  check('F3 so its squad may pass', ok(s, { kind: 'passTurn', seat: 's1' }), true);
  send(s, { kind: 'designate', seat: 's1', uid: valk.uid });
  check('F3 and its activation may end untouched', ok(s, { kind: 'endOpportunity', seat: 's1', uid: valk.uid }), true);
  const lock = auto();
  const reaper = droneOn(lock, 's1', 'PRDR-101', 5, 5);
  put(lock, 's2', L(), 5, 4);
  check('F3 a Melee Locked Drone owes no Firing Action', owes(lock, reaper), null);
  check('F3 so a Melee Locked squad may pass', ok(lock, { kind: 'passTurn', seat: 's1' }), true);
}

// ================= the cards the company lists have and we lacked (OTTO, 2026-09-28) =================
{
  const card = (id) => data.byId.get(id);
  const row = (id) => {
    const c = card(id);
    return c ? [c.name?.en, c.category, c.faction, c.score ?? null] : null;
  };
  check('LC Grenadier-72, a GoF pilot of 4 points', row('ZPA-72'), ['Grenadier-72', 'pilot', 'GOF', 4]);
  check('LC and its dial is every other Grenadier\'s', ['swift', 'melee', 'projectile', 'firing', 'moving', 'tactic'].map((k) => card('ZPA-72')?.[k]),
    ['swift', 'melee', 'projectile', 'firing', 'moving', 'tactic'].map((k) => card('ZPA-46')?.[k]));
  check('LC Combatant A-76, a PD pilot of 10 points', row('XPA-A76'), ['Combatant A-76', 'pilot', 'PD', 10]);
  check('LC the GA-3 HE Grenade, an RDL Projectile', row('070'), ['GA-3 HE Grenade', 'projectile', 'RDL', null]);
  const ga3 = card('070')?.actions?.[0];
  check('LC and its Delayed Detonation, 3Y at Range 1', [ga3?.name?.en, ga3?.type, ga3?.yellowDice, ga3?.range], ['Delayed Detonation', 'Delay', 3, 1]);
  check('LC the two Painting Type Drones', [row('523'), row('524')], [['DTG-30Art "Hyena" Painting Type', 'drone', 'RDL', 99], ['ADK15Art "Porcupine" Painting Type', 'drone', 'UN', 99]]);
  check('LC and the Claymore Civilian Type', row('576'), ['N13 Vanguard III “Claymore” Civilian Type', 'drone', 'GOF', 99]);
  check('LC the UN trainees carry the list\'s names', ['LPA-27', 'LPA-30', 'LPA-31', 'LPA-34', 'LPA-66'].map((id) => card(id)?.name?.en),
    ['Rifleman-27', 'Rifleman-30', 'Charger-31', 'Charger-34', 'Rifleman-66']);
  check('LC and the left discard S100 no longer shares the right one\'s name', [card('S100+R6SS-L-T')?.name?.en, card('116')?.name?.en],
    ['S100 Shield + R6SS SMG (L) (D)', 'S100 Shield + R6SS SMG (R) (D)']);

  // The tournament trophies: in the Reference, and nowhere a squad is built
  // (OTTO, 2026-09-28).
  check('LC the three trophies, reference-only', ['258', '259', '560'].map((id) => [row(id), card(id)?.referenceOnly]),
    [[['[G&T] Mini Tournament Trophy', 'mech_part', 'RDL', 99], true], [['[G&T] Mini Tournament Trophy', 'mech_part', 'UN', 99], true],
      [['Asia Championship Trophy', 'mech_part', 'RDL', 99], true]]);
  const slot = (type) => M.BUILD_SLOTS.find((x) => x.type === type);
  const offered = (type) => M.slotPool(data, slot(type)).map((c) => c.id);
  check('LC no builder offers one', [offered('rightHand').filter((id) => id === '258' || id === '259'), offered('leftHand').includes('560')], [[], false]);
  check('LC while the hands still offer everything else', offered('rightHand').includes('115') && offered('leftHand').includes('S100+R6SS-L'), true);
  const imported = M.parseSquadJson({ mechs: [{ parts: { torso: '012', rightHand: '258', leftHand: '560' } }] }, data.byId);
  check('LC an imported squad naming one is told the card is unknown', [imported.unknownIds.sort(), imported.mechs[0].loadout.rightHand ?? null], [['258', '560'], null]);
  check('LC and the pad\'s Find leaves them out',
    /d\.cards\.filter\(\(c\) => !c\.referenceOnly && pick\(c\)\)/.test(readFileSync(new URL('../pad/pad.ts', import.meta.url), 'utf8')), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

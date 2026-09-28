// MECHANICS AUDIT, PHASE 6 (2026-09-28): the round, missions and squads,
// driven through the real command layer, the real scorers and the shipped
// cards. Each block is one finding of Project-Documents/MECHANICS-AUDIT.md (the
// letters match its sections), pinned by behaviour rather than by the shape of
// the source, and each was mutation-checked: put its fix back the way it was
// and it fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom, makeEl } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_mechanics6.entry.ts', import.meta.url);
const out = new URL('./_mechanics6.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { check, apply, strictNow } from '../src/commands';",
  "export { loadData } from '../src/data';",
  "export { glueAfter, openActivation } from '../src/glue';",
  "export { newScriptState, PHASES } from '../src/types';",
  "export * as Ty from '../src/types';",
  "export * as U from '../src/units';",
  "export * as D from '../src/data';",
  "export * as R from '../src/rules';",
  "export * as T from '../src/ticks';",
  "export * as Lp from '../src/loop';",
  "export * as Su from '../src/setup';",
  "export * as Tk from '../src/tasks';",
  "export * as Sc from '../src/scoring';",
  "export * as Tc from '../src/tactics';",
  "export { AttackHelper } from '../src/combat';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const { U, Ty, Tk, Sc, Tc } = M;
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
const actionsOf = (t) => U.tokenCards(data, t).flatMap((c) => c.card.actions ?? []);
const actionOf = (cardId, actionId) => data.byId.get(cardId)?.actions?.find((a) => a.id === actionId);
const send = (s, cmd) => {
  const v = M.check(data, s, cmd);
  if (v.ok) { M.apply(data, s, cmd); M.glueAfter(data, s, cmd); }
  return v;
};
const ok = (s, cmd) => M.check(data, s, cmd).ok;
const why = (s, cmd) => M.check(data, s, cmd).why ?? '';
// An Action Opportunity the guide has opened for `uid`, as mechanics4 builds one.
const opp = (uid, over = {}) => ({ uid, timing: 'movement', extra: undefined, maneuver: 1, action: 2, extras: [], maneuvered: false, moved: false, started: false, overload: 0, performed: [], spentExtras: [], ...over });
void makeEl; void dice; void actionsOf; void actionOf; void why; void opp; void freeTable; void droneOn; void Ty; void Tk; void Sc; void Tc;

console.log('Phase 6: the round, missions and squads\n');

// ================= C2. Fire Control Interference refuses a Firing Action in the engine (6.3.2, FAQ J5) =================
{
  // Only the lists greyed it: the check, the granted door and the defence call
  // all accepted a Firing Action from a unit bearing the Token.
  const s = table();
  const me = put(s, 's1', L(), 5, 5);
  const foe = put(s, 's2', L(), 5, 2);
  s.script.opp = opp(me.uid, { timing: 'firing' });
  const fire = { kind: 'performAction', seat: 's1', uid: me.uid, actionId: '041_A' };
  const defend = { kind: 'callDefense', seat: 's1', uid: me.uid, targetUid: foe.uid, actionId: '041_A', white: 1, blue: 0 };
  check('C2 the control: a Firing Action is taken', ok(s, fire), true);
  check('C2 the control: and its defence called', ok(s, defend), true);
  me.statuses = ['fci'];
  check('C2 under Fire Control Interference it is refused', ok(s, fire), false);
  check('C2 and so is its defence call', ok(s, defend), false);
  s.script.reactions = [{ uid: me.uid, actionId: 'LHDR-KK9_B', count: 0, range: 0, kind: 'overwatch', fromUid: foe.uid }];
  check('C2 and a granted Overwatch Firing Action', ok(s, { ...fire, granted: true }), false);
}

// ================= C5, C9, I9. Token faces: green never turns, camouflage takes the markers, Pursuit is red =================
{
  // C5 (2.5.3, FAQ J22): a tap on the green Low Profile Token turned it red,
  // and the End Phase then removed it.
  const s = freeTable();
  const me = put(s, 's1', L(), 5, 5, { statuses: ['lowProfile', 'fragile'] });
  const step = (id) => M.apply(data, s, { kind: 'ageStatus', seat: 's1', uid: me.uid, targetUid: me.uid, statusId: id });
  step('fragile');
  check('C5 the control: a yellow token turns red', [me.statuses.includes('fragile'), (me.expiring ?? []).includes('fragile')], [true, true]);
  step('lowProfile');
  check('C5 a step takes a green Low Profile off instead of turning it red', [me.statuses.includes('lowProfile'), (me.expiring ?? []).includes('lowProfile')], [false, false]);
  check('C5 a green token is drawn green even with a stale marker', M.D.tokenFace('lowProfile', 'green', true).colour, M.D.tokenFace('lowProfile', 'green', false).colour);
  const old = { statuses: ['lowProfile'], expiring: ['lowProfile'] };
  Ty.ageTokens(old);
  check('C5 and the End Phase keeps it, dropping the stale marker', [old.statuses, old.expiring ?? null], [['lowProfile'], null]);

  // C9 (FAQ J14): camouflage strips the Hexagons, and now their markers too.
  const c = freeTable();
  const oct = put(c, 's1', L(), 5, 5, { statuses: ['highlight'], expiring: ['highlight'] });
  M.apply(data, c, { kind: 'applyStatus', seat: 's1', uid: oct.uid, targetUid: oct.uid, statusId: 'camouflage' });
  check('C9 camouflage strips the Hexagons and their red markers', [oct.statuses.includes('highlight'), oct.expiring ?? null], [false, null]);

  // I9: the GoF glossary prints Pursuit red on both faces.
  const p = freeTable();
  const mark = put(p, 's2', L(), 5, 5);
  M.apply(data, p, { kind: 'applyStatus', seat: 's1', uid: mark.uid, targetUid: mark.uid, statusId: 'pursuit' });
  check('I9 Pursuit arrives showing red', Ty.tokenFaces(mark, 'pursuit'), [{ face: 'red', n: 1 }]);
  Ty.ageTokens(mark);
  check('I9 and leaves at the End Phase of the round it came', mark.statuses.includes('pursuit'), false);
  const tt = put(p, 's2', L(), 7, 7);
  M.apply(data, p, { kind: 'applyStatus', seat: 's1', uid: tt.uid, targetUid: tt.uid, statusId: 'targetTracer' });
  Ty.ageTokens(tt);
  check('I9 the control: Target Tracer turns red and stays a round', [tt.statuses.includes('targetTracer'), (tt.expiring ?? []).includes('targetTracer')], [true, true]);
}

// ================= C8. A Repaired Part intercepts (FAQ J23; ruling I11) =================
{
  // "Broken in every way except that it can still perform actions": the list
  // offered the Interception, and the queue, the interceptor list and the
  // spend all refused it as a destroyed Part.
  const s = table();
  const d = put(s, 's1', L(), 0, 8);
  const launcher = put(s, 's2', L({ pilot: 'FPA-01' }), 3, 8);
  const missile = droneOn(s, 's2', '075', 3, 11, { kind: 'projectile' });
  const owed = () => U.interceptsOwed(data, s.tokens, [], launcher, [missile]).some((x) => x.uid === d.uid);
  const listed = () => U.interceptorsAgainst(data, s.tokens, 's2').some((x) => x.uid === d.uid);
  d.partStates.leftHand = 'destroyed';
  check('C8 the control: a destroyed L-320 owes and offers nothing', [owed(), listed()], [false, false]);
  d.repairedSlots = ['leftHand'];
  check('C8 once Repaired it owes an Interception and stands among the interceptors', [owed(), listed()], [true, true]);
  send(s, { kind: 'queueIntercepts', seat: 's2', items: U.interceptsOwed(data, s.tokens, [], launcher, [missile]) });
  check('C8 and it may spend the Token', ok(s, { kind: 'spendIntercept', seat: 's1', uid: d.uid, actionId: '041_A' }), true);
}

// ================= C1. Amplify Profile refreshes a red Highlight (FAQ J22; ruling I13) =================
{
  // "If a unit already has a red Highlight Token and gains another one of the
  // same type, the token is flipped to its yellow side." The self-grant
  // refused any worn copy, so Amplify Profile could never do it.
  const grant = U.selfStatusGrant(actionOf('007', '007_A'));
  const s = freeTable();
  const me = put(s, 's1', L(), 5, 5, { statuses: ['highlight'], expiring: ['highlight'] });
  check('C1 Amplify Profile grants a Highlight', grant?.statusId, 'highlight');
  check('C1 on a red Highlight it may be performed', U.selfGrantWhy(me, grant), null);
  me.expiring = undefined;
  check('C1 the control: on a yellow one it changes nothing and is refused', U.selfGrantWhy(me, grant) !== null, true);
  const viper = put(s, 's1', L(), 7, 7, { statuses: ['lowProfile'], expiring: ['lowProfile'] });
  check('C1 and a Low Profile is never refreshed, whatever its marker', U.selfGrantWhy(viper, { statusId: 'lowProfile', stacks: 1 }) !== null, true);
}

// ================= G4. The "Unsale" parts carry the publisher lists' factions (ruling I31) =================
{
  // The UNSALE box was tagged PD wholesale, so nine UN Parts read as PD and a
  // UN Cobra raised a false mixed-Mech warning; the KK9 and the two Reapers,
  // in no released box, had no faction at all.
  const fac = (id) => data.factionOf(data.byId.get(id));
  check('G4 the Cobra, Black Cat and Nile cores are UN', ['TM39D', 'TM31RS', 'TM35NA'].map(fac), ['UN', 'UN', 'UN']);
  check('G4 so are the S100 + R6SS, the K21, the XTC arm and the R33S',
    ['S100+R6SS-L', 'S100+R6SS-L-T', 'K21', 'K21-T', 'XTC', 'R33S'].map(fac), ['UN', 'UN', 'UN', 'UN', 'UN', 'UN']);
  check('G4 the KK9 is UN, the two Reapers PD', ['LHDR-KK9', 'PRDR-102', 'PRDR-103'].map(fac), ['UN', 'PD', 'PD']);
  const s = freeTable();
  put(s, 's1', { torso: 'TM39D', chasis: '099', leftHand: 'S100+R6SS-L', rightHand: 'XTC', backpack: '', pilot: 'LPA-20' }, 5, 5);
  check('G4 a UN Cobra on a UN chassis with a UN Pilot is one faction', U.factionProblems(data, s.tokens).map((p) => p.kind), []);
}

// ================= H1, H3, H5, H6. Tactics Cards: discarded once used, Cruise Mode, a Mech free to move, on the board =================
{
  // H1 (FAQ P2): "Once used, it is discarded and cannot be used again during
  // the game." The check tested only this round's plays.
  const s = table();
  s.round.phase = M.PHASES.indexOf('End');
  const me = put(s, 's1', L(), 5, 5, { link: 1 });
  s.tactics = { s1: ['275'], s2: [] };
  const play = { kind: 'playTactic', seat: 's1', uid: me.uid, cardId: '275' };
  check('H1 the control: Battlefield Recovery is played', send(s, play).ok, true);
  s.round.n = 2;
  me.link = 1;
  check('H1 once used it is discarded: refused in a later round', [ok(s, play), why(s, play).includes('discarded')], [false, true]);
  check('H1 the card stays in the hand, its points paid', s.tactics.s1, ['275']);
  check('H1 and the doors read the round it was used in', [Tc.tacticUsedRound(s, 's1', '275'), Tc.tacticUsedRound(s, 's1', '279')], [1, null]);

  // H3 (ruling I33): Remote Restart brings a cruising White Dwarf back in
  // Mobility only, as its Reboot does.
  const c = table();
  c.round.phase = M.PHASES.indexOf('End');
  const wd = put(c, 's1', L({ torso: '288' }), 5, 5, { stance: 'shutdown', link: 0 });
  c.tactics = { s1: ['279'], s2: [] };
  const restart = (pick) => ({ kind: 'playTactic', seat: 's1', uid: wd.uid, cardId: '279', pick });
  check('H3 a cruising White Dwarf restarts in Mobility only', [ok(c, restart('offensive')), ok(c, restart('defensive')), ok(c, restart('mobility'))], [false, false, true]);
  const plain = put(c, 's1', L(), 8, 8, { stance: 'shutdown', link: 0 });
  check('H3 the control: an ordinary Mech may choose any Stance', ok(c, { kind: 'playTactic', seat: 's1', uid: plain.uid, cardId: '279', pick: 'offensive' }), true);

  // H5 (ruling I34): Hit and Run on a Mech that cannot Maneuver was accepted
  // and spent, then its Maneuver refused.
  const ctx = { maxLink: () => 4, cruising: () => false };
  const h = table();
  const mover = put(h, 's1', L(), 5, 5, { statuses: ['immobilized'] });
  const hitRun = Tc.tacticSpec('276');
  check('H5 an Immobilized Mech is no Hit and Run target', Tc.tacticTargets(hitRun, h, 's1', ctx).map((t) => t.uid), []);
  mover.statuses = [];
  check('H5 the control: one free to move is', Tc.tacticTargets(hitRun, h, 's1', ctx).map((t) => t.uid), [mover.uid]);

  // H6: a Low Value Drone waiting in a squad list is not on the board.
  const d = table();
  const pup = droneOn(d, 's1', 'ZHDR-201', 5, 5, { deployed: false });
  const extra = Tc.tacticSpec('274');
  check('H6 an undeployed Drone is no Tactics target', Tc.tacticTargets(extra, d, 's1', ctx).map((t) => t.uid), []);
  pup.deployed = true;
  check('H6 the control: on the board it is', Tc.tacticTargets(extra, d, 's1', ctx).map((t) => t.uid), [pup.uid]);
}

// ================= G1. One squad total, the Pilot counted once (p.82) =================
{
  // The pad added pilotCard's score on top of tokenCards, which already lists
  // the Pilot, so a legal 900 read 40 to 70 over. Every page reads this now.
  const s = freeTable();
  const me = put(s, 's1', L(), 5, 5);
  const parts = U.tokenCards(data, me).reduce((n, c) => n + (c.card.score ?? 0), 0);
  const pilot = U.pilotCard(data, me)?.score ?? 0;
  const hand = data.byId.get('276')?.score ?? 0;
  check('G1 the Pilot has a price, so a double count shows', [pilot > 0, hand > 0], [true, true]);
  check('G1 the total is the Parts, the Pilot once, and the hand', U.squadPoints(data, s.tokens, 's1', ['276']), parts + hand);
  check('G1 the other squad owes none of it', U.squadPoints(data, s.tokens, 's2', []), 0);
}

// ================= D1, D2, D4. VIP's Parts, Mercy and Integrity Loss, the dead the pad keeps =================
{
  const lines = (s, final) => Sc.previewScore(data, s, final, { settle: false, zoneCells: () => [] }).lines.map((l) => `${l.side}+${l.vp}`);

  // D1: "If neither Commander is destroyed after 5 rounds, each player gains 3
  // Victory Points for each Part of the Enemy Commander that has been
  // Destroyed." Only the 10 was scored.
  const v = freeTable();
  v.mission = 'vip-commander-assassination';
  const a = put(v, 's1', L(), 2, 2);
  const b = put(v, 's2', L(), 8, 8);
  v.tasks = { ...Tk.newTaskState(), leader: { s1: a.uid, s2: b.uid } };
  a.partStates.leftHand = 'destroyed';
  b.partStates.leftHand = 'destroyed';
  b.partStates.rightHand = 'destroyed';
  check('D1 in the last round each side scores 3 a destroyed Part of the enemy Commander', lines(v, true), ['s1+6', 's2+3']);
  check('D1 not before the last round', lines(v, false), []);
  // D4: the pad keeps a dead Commander in its tokens, and the 10 read it as
  // standing.
  b.partStates.torso = 'destroyed';
  check('D4 a Commander tapped dead, still in the tokens, pays the 10 and ends the Parts count', lines(v, true), ['s1+10']);

  // D4: Escort paid for a dead unit the pad keeps.
  const e = freeTable();
  const guard = put(e, 's1', L(), 2, 2);
  e.tasks = { ...Tk.newTaskState(), secondary: { s1: 'escort' }, secTarget: { s1: guard.uid } };
  check('D4 the control: Escort pays for a Mech still standing', lines(e, true), ['s1+3']);
  guard.partStates.torso = 'destroyed';
  check('D4 and not for one the pad keeps dead in its tokens', lines(e, true), []);

  // D2: Mercy, "Enemy Mechs removed to Integrity Loss do not count".
  const mercy = (kill) => {
    const s = table();
    s.round.phase = M.PHASES.indexOf('End');
    const hunter = put(s, 's1', L(), 2, 2);
    const wreck = put(s, 's2', L(), 8, 8, { lastDamagedBy: { side: 's1', uid: hunter.uid } });
    wreck.partStates.leftHand = 'destroyed';
    wreck.partStates.rightHand = 'destroyed';
    s.tasks = { ...Tk.newTaskState(), secondary: { s1: 'mercy' } };
    kill(s, hunter, wreck);
    return s;
  };
  const byIntegrity = mercy((s) => send(s, { kind: 'markEndStep', seat: 's1', step: 'remove' }));
  check('D2 the Integrity-Loss removal is still s1\'s kill (FAQ P4)', [byIntegrity.tasks.kills.s1.mechs, byIntegrity.tokens.length], [1, 1]);
  check('D2 and Mercy still pays', lines(byIntegrity, true), ['s1+2']);
  const byCombat = mercy((s, hunter, wreck) => send(s, { kind: 'recordKill', seat: 's1', uid: hunter.uid, targetUid: wreck.uid, what: 'unit' }));
  check('D2 the control: a Mech destroyed in combat costs Mercy', lines(byCombat, true), []);

  // D4: a Mech killed by a Torso tap was credited again by the round's
  // Integrity-Loss sweep.
  const p = table();
  p.round.phase = M.PHASES.indexOf('End');
  const shooter = put(p, 's1', L(), 2, 2);
  const target = put(p, 's2', L(), 8, 8);
  for (const slot of ['leftHand', 'rightHand', 'torso']) send(p, { kind: 'setPartState', seat: 's1', uid: target.uid, slot, state: 'destroyed' });
  const before = p.tasks.kills.s1.mechs;
  send(p, { kind: 'markEndStep', seat: 's1', step: 'remove' });
  check('D4 a Mech tapped dead is credited once, not again at the round\'s removal', [before, p.tasks.kills.s1.mechs], [1, 1]);
  void shooter;
}

// ================= B. The End Phase and the end of the game =================
{
  const END = M.PHASES.indexOf('End');
  const lines = (s, final) => Sc.previewScore(data, s, final, { settle: false, zoneCells: () => [] }).lines.map((l) => `${l.side}+${l.vp}`);

  // B8 (FAQ P21; ruling I1): wiping out the enemy decides nothing; the VP do.
  // A concession is the one early end.
  // The pad keeps a wiped squad's Mechs in its tokens, every Part destroyed:
  // that squad used to lose whatever it had scored.
  const w = freeTable();
  const gone = put(w, 's1', L(), 2, 2);
  for (const slot of Object.keys(gone.partStates)) gone.partStates[slot] = 'destroyed';
  put(w, 's2', L(), 8, 8);
  w.tasks = { ...Tk.newTaskState(), vp: { s1: 9, s2: 1 } };
  check('B8 a squad with every unit destroyed still wins on Victory Points', Tk.gameResult(Tk.normaliseTasks(w.tasks), w.tokens).winner, 's1');
  // Level on VP: 2 Parts standing against a dead Mech whose 3 intact Parts no
  // longer count.
  const tie = freeTable();
  const worn = put(tie, 's1', L(), 2, 2);
  worn.partStates.leftHand = 'destroyed';
  worn.partStates.rightHand = 'destroyed';
  const dead = put(tie, 's2', L(), 8, 8);
  dead.partStates.torso = 'destroyed';
  tie.tasks = { ...Tk.newTaskState(), vp: { s1: 3, s2: 3 } };
  check('B8 the tiebreak counts only what still stands', Tk.gameResult(Tk.normaliseTasks(tie.tasks), tie.tokens).winner, 's1');
  const c = table();
  c.tasks = { ...Tk.newTaskState(), vp: { s1: 0, s2: 7 } };
  check('B8 the control: nothing to concede before a game', ok({ ...freeTable() }, { kind: 'concede', seat: 's2' }), false);
  check('B8 a squad concedes', send(c, { kind: 'concede', seat: 's2' }).ok, true);
  check('B8 and loses whatever the score', Tk.gameResult(Tk.normaliseTasks(c.tasks), c.tokens).winner, 's1');
  check('B8 nothing more is scored', ok(c, { kind: 'award', seat: 's1', vp: { s1: 1, s2: 0 }, keys: [] }), false);

  // B2 (ruling I2): a fallen VIP Commander ends the game at this End Phase.
  const v = table();
  v.round.n = 2;
  v.mission = 'vip-commander-assassination';
  const a = put(v, 's1', L(), 2, 2);
  const b = put(v, 's2', L(), 8, 8);
  v.tasks = { ...Tk.newTaskState(), leader: { s1: a.uid, s2: b.uid }, secondary: { s1: 'escort' }, secTarget: { s1: a.uid } };
  check('B2 the control: with both Commanders standing, round 2 of 5 ends nothing', Sc.gameEndsThisRound(data, v), false);
  b.partStates.torso = 'destroyed';
  check('B2 a fallen Commander ends the game this round', Sc.gameEndsThisRound(data, v), true);
  check('B2 so the Award settles the end-of-game Tasks too', lines(v, Sc.gameEndsThisRound(data, v)), ['s1+10', 's1+3']);

  // D3: hand VP touch the VP and nothing else.
  const h = table();
  h.round.phase = END;
  h.tasks = { ...Tk.newTaskState(), kills: { s1: { ...Tk.newKills(), mechs: 1 }, s2: Tk.newKills() } };
  check('D3 a hand VP is taken', send(h, { kind: 'adjustVp', seat: 's1', side: 's2', by: 1 }).ok, true);
  check('D3 it marks no kill paid and ticks no step', [h.tasks.vp.s2, h.tasks.paidKills.s1.mechs, h.script.endDone], [1, 0, []]);

  // B5, B6, B7: the strict End Phase, in order and once.
  const e = table();
  e.round.phase = END;
  e.tasks = Tk.newTaskState();
  const step = (id) => ({ kind: 'markEndStep', seat: 's1', step: id });
  const award = { kind: 'award', seat: 's1', vp: { s1: 1, s2: 0 }, keys: [] };
  check('B5 the round does not turn with nothing done', ok(e, { kind: 'advancePhase', seat: 's1' }), false);
  check('B6 Token Management waits for Remove Units', ok(e, step('tokens')), false);
  check('B6 and the Award for both', ok(e, award), false);
  send(e, step('remove'));
  check('B7 Remove Units runs once', ok(e, step('remove')), false);
  send(e, step('tokens'));
  check('B7 Token Management runs once: a second aged everything twice', ok(e, step('tokens')), false);
  check('B6 the Award may follow them', send(e, award).ok, true);
  check('B7 and is paid once a round', ok(e, award), false);
  check('B7 the Tasks step may still be ticked after it', ok(e, step('tasks')), true);
  send(e, step('tasks'));
  check('B5 with every step done the round turns', ok(e, { kind: 'advancePhase', seat: 's1' }), true);
  check('B5 a strict game refuses a phase jump and a reset', [ok(e, { kind: 'setPhase', seat: 's1', phase: 0 }), ok(e, { kind: 'resetRounds', seat: 's1' })], [false, false]);
  e.script.strict = false;
  check('B5 the control: Teaching keeps its correction tools', [ok(e, { kind: 'setPhase', seat: 's1', phase: 0 }), ok(e, { kind: 'resetRounds', seat: 's1' })], [true, true]);

  // B7, B9: keyed lines pay once. Control once a round, a Black Box once a game.
  const k = freeTable();
  k.round.n = 3;
  k.tasks = { ...Tk.newTaskState(), items: [{ id: 'z', kind: 'control', zone: 'Alpha', control: 's1' }] };
  const ctl = Tk.scoreMain({ family: 'control', vp: 1, zones: ['Alpha'], fromRound: 2, cadence: 'per-round' }, Tk.normaliseTasks(k.tasks), k.tokens, 3, false);
  check('B7 a Control line carries its round', ctl.lines.map((l) => l.key), ['main:s1:r3']);
  const box = Tk.scoreMain({ family: 'blackbox', vp: 2, zones: ['Bravo'], fromRound: 1, cadence: 'at-end' }, { ...Tk.normaliseTasks(k.tasks), items: [{ id: 'bx', kind: 'blackbox', zone: 'Bravo', bearerUid: put(k, 's1', L(), 1, 1).uid }] }, k.tokens, 6, true);
  check('B9 a Black Box line pays once in a game, an Extra round included', box.lines.map((l) => l.key), ['main:s1:end']);

  // B3, B4: a table with no guided game sweeps as the End Phase OPENS, so its
  // Award scores after the removal and the tokens.
  const f = freeTable();
  f.round.phase = M.PHASES.indexOf('Delay');
  const hunter = put(f, 's1', L(), 2, 2, { statuses: ['fragile'] });
  const wreck = put(f, 's2', L(), 8, 8, { lastDamagedBy: { side: 's1', uid: hunter.uid } });
  wreck.partStates.leftHand = 'destroyed';
  wreck.partStates.rightHand = 'destroyed';
  M.apply(data, f, { kind: 'advancePhase', seat: 's1', sweep: true });
  check('B3 into the End Phase: the wreck leaves and its kill is paid for', [f.tokens.some((x) => x.uid === wreck.uid), Tk.normaliseTasks(f.tasks).kills.s1.mechs], [false, 1]);
  check('B3 and the tokens have aged', (hunter.expiring ?? []).includes('fragile'), true);
  M.apply(data, f, { kind: 'advancePhase', seat: 's1', sweep: true });
  check('B3 leaving it ages nothing a second time', [hunter.statuses.includes('fragile'), f.round.n], [true, 2]);
  const g = table();
  g.round.phase = M.PHASES.indexOf('Delay');
  const gm = put(g, 's1', L(), 2, 2, { statuses: ['fragile'] });
  M.apply(data, g, { kind: 'advancePhase', seat: 's1', sweep: true });
  check('B4 the control: a guided game ignores the sweep, its steps do the work', (gm.expiring ?? []).includes('fragile'), false);

  // A8: starting the rounds over returns the token to the roll's winner and
  // clears what was stamped with a round.
  const r = table();
  r.script.strict = false;
  r.setup.first = 's2';
  r.round = { n: 3, phase: 2, firstPlayer: 's1' };
  r.script.endDone = ['2:end:tasks'];
  r.tasks = { ...Tk.newTaskState(), scored: ['pad-round:2', 'main:s1:r2', 'sec:s1:escort'] };
  send(r, { kind: 'resetRounds', seat: 's1' });
  check('A8 the First Player Token goes back to the roll\'s winner', r.round.firstPlayer, 's2');
  check('A8 and the round-stamped keys go, the one-off lines stay paid', [r.script.endDone, Tk.normaliseTasks(r.tasks).scored], [[], ['sec:s1:escort']]);
}

// ================= H2. A Tactics Card at the moment its text names (5.4.2; rulings I28, I29) =================
{
  // Only the phase was checked: System Repair and Tactical Disposition were
  // accepted in the enemy's turn, and Hit and Run on any Mech at any moment.
  const ctx = { maxLink: () => 4, cruising: () => false };
  const setUp = () => {
    const s = table();
    s.tactics = { s1: ['276', '277', '278'], s2: [] };
    const mine = put(s, 's1', L(), 2, 2, { statuses: ['fci'] });
    const other = put(s, 's1', L(), 4, 4);
    const foe = put(s, 's2', L(), 8, 8);
    const pup = droneOn(s, 's1', 'ZHDR-201', 6, 6);
    return { s, mine, other, foe, pup };
  };
  const repair = (s, t) => {
    const pick = Tc.tacticSpec('277').choices(t, s, ctx)[0]?.id;
    return { kind: 'playTactic', seat: 's1', uid: t.uid, cardId: '277', pick };
  };
  const a = setUp();
  check('H2 System Repair refused with no Opportunity open', ok(a.s, repair(a.s, a.mine)), false);
  a.s.script.opp = opp(a.foe.uid);
  check('H2 and during the enemy\'s Opportunity', ok(a.s, repair(a.s, a.mine)), false);
  a.s.script.opp = opp(a.pup.uid);
  check('H2 and during an ally Drone\'s activation (ruling I29)', ok(a.s, repair(a.s, a.mine)), false);
  a.s.script.opp = opp(a.other.uid);
  check('H2 during an ally Mech\'s Opportunity it is played, on any ally', ok(a.s, repair(a.s, a.mine)), true);
  check('H2 Tactical Disposition keeps the same moment', [ok(a.s, { kind: 'playTactic', seat: 's1', uid: a.mine.uid, cardId: '278', pick: 'defensive' })], [true]);
  a.s.script.opp = opp(a.foe.uid);
  check('H2 and not in the enemy\'s turn', ok(a.s, { kind: 'playTactic', seat: 's1', uid: a.mine.uid, cardId: '278', pick: 'defensive' }), false);

  // Hit and Run: "Use when the Action Opportunity of an Ally Mech ends,
  // perform Maneuver with that Mech."
  const b = setUp();
  const hit = (uid) => ({ kind: 'playTactic', seat: 's1', uid, cardId: '276' });
  check('H2 Hit and Run refused before any Opportunity ends', ok(b.s, hit(b.other.uid)), false);
  b.s.script.opp = opp(b.other.uid);
  send(b.s, { kind: 'endOpportunity', seat: 's1', uid: b.other.uid });
  check('H2 the ending is recorded', b.s.script.lastEnded, { uid: b.other.uid, round: 1 });
  b.s.script.opp = opp(b.foe.uid);
  check('H2 as it ends, it is played on that Mech', ok(b.s, hit(b.other.uid)), true);
  check('H2 and on no other', ok(b.s, hit(b.mine.uid)), false);
  check('H2 the target list names only that Mech', Tc.tacticTargets(Tc.tacticSpec('276'), b.s, 's1', ctx).map((t) => t.uid), [b.other.uid]);
  b.s.script.opp = opp(b.foe.uid, { started: true });
  check('H2 once the next unit has started, the moment has passed', ok(b.s, hit(b.other.uid)), false);
  // The stamp lives in the saved script, so a reload keeps the moment.
  check('H2 a saved game keeps the ending', Ty.normaliseScript(JSON.parse(JSON.stringify(b.s.script)), 's1').lastEnded, { uid: b.other.uid, round: 1 });
  // One that ended last round is no moment now.
  const c = setUp();
  c.s.script.lastEnded = { uid: c.other.uid, round: 1 };
  c.s.round.n = 2;
  check('H2 an ending from last round opens nothing', ok(c.s, hit(c.other.uid)), false);

  // A free table keeps no Opportunities, so nothing is judged there.
  const f = freeTable();
  f.tactics = { s1: ['277'], s2: [] };
  const fm = put(f, 's1', L(), 2, 2, { statuses: ['fci'] });
  check('H2 the control: a free table plays it with no Opportunity', ok(f, repair(f, fm)), true);
}

// ================= I18. the tiebreak leaves Low Value Drones out (p.82, 5.2.4; Phase 5 I21) =================
{
  // "more Mech Parts and Drones remaining": a 0-point Bit is not part of the
  // Squad (p.82), so it breaks no tie. An ordinary Drone does.
  const low = Sc.lowValueOf(data);
  const s = freeTable();
  put(s, 's1', L(), 2, 2);
  put(s, 's2', L(), 8, 8);
  const bit = droneOn(s, 's1', '293', 3, 3);
  s.tasks = { ...Tk.newTaskState(), vp: { s1: 4, s2: 4 } };
  check('I18 the Bit is a Low Value unit', low(bit), true);
  check('I18 a Bit breaks no tie', Tk.gameResult(Tk.normaliseTasks(s.tasks), s.tokens, low).winner, null);
  droneOn(s, 's2', 'ZHDR-201', 7, 7);
  check('I18 the control: an ordinary Drone does', Tk.gameResult(Tk.normaliseTasks(s.tasks), s.tokens, low).winner, 's2');
}

// ================= E1-E4. Terminals and Remote Access (p.87, 5.3.3; FAQ P6, P12; rulings I25, I26) =================
{
  const theft = data.missions.cards.find((c) => c.id === 'terminal-data-extraction');
  const zones = data.zoneData.zones;
  const cells = (id) => zones.find((z) => z.id === id)?.cells ?? [];
  const setUp = () => {
    const s = table();
    s.mission = theft.id;
    s.tasks = Tk.taskItemsFor(zones, theft);
    return s;
  };
  const itemIn = (s, zone) => Tk.normaliseTasks(s.tasks).items.find((i) => i.zone === zone);
  const access = (s, t, zone) => ({ kind: 'accessTerminal', seat: t.side, uid: t.uid, itemId: itemIn(s, zone).id });
  const remote = (t) => ({ kind: 'performAction', seat: t.side, uid: t.uid, actionId: 'COMMON_REMOTE_ACCESS' });
  const acted = (uid) => opp(uid, { timing: 'tactical', started: true, action: 1, performed: ['COMMON_REMOTE_ACCESS'] });

  // E1: the Range runs to the NEAREST Grid of the zone (FAQ P6). From G6 the
  // middle of Bravo (C7) is 5 away, and its nearest Grid (C6) is 4.
  check('E1 from G6, Bravo is at Range 4', Tk.rangeToZone(G(6, 5), cells('bravo')), 4);
  const a = setUp();
  const me = put(a, 's1', L(), 6, 5);
  // Hotel's J6 is 3 away; Charlie and Golf are out of reach.
  check('E1 so its Terminal is in reach', Tk.terminalsInReach(Tk.normaliseTasks(a.tasks).items, me, 4, cells).map((i) => i.zone), ['bravo', 'hotel']);

  // E4: the middle of an L-shaped zone is off the zone; the Item is drawn on it.
  const inZone = (id) => {
    const g = Tk.zoneCentreGrid(zones, id);
    return cells(id).some((c) => { const r = Tk.cellToGrid(c); return r.c === g.c && r.r === g.r; });
  };
  check('E4 the Charlie Terminal is drawn in Charlie', inZone('charlie'), true);
  check('E4 and the Golf Terminal in Golf', inZone('golf'), true);
  check('E4 the control: Bravo keeps its middle Grid, C7', Tk.zoneCentreGrid(zones, 'bravo'), { c: 2, r: 6 });

  // E2: the access is the success of a Remote Access, and nothing else.
  a.script.opp = acted(me.uid);
  check('E2 the control: after Remote Access, in reach, it is taken', ok(a, access(a, me, 'bravo')), true);
  check('E2 a Terminal out of Range is refused', ok(a, access(a, me, 'golf')), false);
  const b = setUp();
  const mech = put(b, 's1', L(), 6, 5);
  const other = put(b, 's1', L(), 5, 5);
  check('E2 with no Opportunity open it is refused', ok(b, access(b, mech, 'bravo')), false);
  b.script.opp = acted(other.uid);
  check('E2 and in another Mech\'s Opportunity', ok(b, access(b, mech, 'bravo')), false);
  b.script.opp = opp(mech.uid, { timing: 'tactical' });
  check('E2 and before the Action is performed', ok(b, access(b, mech, 'bravo')), false);
  b.script.opp = acted(mech.uid);
  mech.stance = 'shutdown';
  check('E2 a Mech in Shutdown is refused', ok(b, access(b, mech, 'bravo')), false);
  mech.stance = 'defensive';
  const pup = droneOn(b, 's1', 'ZHDR-201', 6, 5);
  b.script.opp = acted(pup.uid);
  check('E2 a Drone is refused', ok(b, access(b, pup, 'bravo')), false);
  // A table with no board judges no Range; a free one keeps no Opportunities.
  const nb = setUp();
  nb.noBoard = true;
  const far = put(nb, 's1', L(), 0, 0);
  nb.script.opp = acted(far.uid);
  check('E2 with no board the table judges the Range', ok(nb, access(nb, far, 'golf')), true);
  const f = freeTable();
  f.mission = theft.id;
  f.tasks = Tk.taskItemsFor(zones, theft);
  const fm = put(f, 's1', L(), 6, 5);
  check('E2 a free table asks no Opportunity', ok(f, access(f, fm, 'bravo')), true);

  // E3, I26: a Remote Access that could access nothing is not performed.
  const c = setUp();
  const cm = put(c, 's1', L(), 6, 5);
  c.script.opp = opp(cm.uid, { timing: 'tactical' });
  check('E3 the control: with a Terminal in reach it is performed', ok(c, remote(cm)), true);
  for (const i of c.tasks.items) if (i.zone === 'bravo' || i.zone === 'hotel') i.accessed = 's2';
  check('E3 with every one in reach accessed it is refused', ok(c, remote(cm)), false);
  c.tasks = Tk.newTaskState();
  check('E3 and with no Terminal on the table', ok(c, remote(cm)), false);
  check('E3 and it says there is none', /no Terminal on the table/.test(why(c, remote(cm))), true);
  // I25: the roll in words, the same on every page.
  const words = Tk.remoteAccessRollText('Hound', 2);
  check('E3 the roll names both pools and the tie', [/2 Yellow Dice/.test(words), /3 Yellow Dice/.test(words), /no Focus/.test(words), /tie goes to Hound/.test(words)], [true, true, true, true]);
}

// ================= F. Black Boxes (5.3.1, 3.4.4; FAQ P3, P7-P11, E19; rulings I19, I20, I22, I24) =================
{
  const box = (s, extra = {}) => {
    const item = { id: 'blackbox-t', kind: 'blackbox', zone: 'echo', control: null, accessed: null, ...extra };
    s.tasks = { ...Tk.newTaskState(), items: [item] };
    return item;
  };
  const itemOf = (s) => Tk.normaliseTasks(s.tasks).items.find((i) => i.id === 'blackbox-t');
  const drop = (s, by, to) => ({ kind: 'dropBlackBox', seat: by.side, uid: by.uid, itemId: 'blackbox-t', to });

  // F1: the attack that Penetrates a bearer and destroys it still owes the
  // drop. The kill took the bearer off the board first, and the drop was
  // refused, so the Box stayed on nobody and scored for nobody.
  const a = table();
  const shooter = put(a, 's1', L(), 2, 2);
  const bearer = put(a, 's2', L(), 5, 5);
  box(a, { bearerUid: bearer.uid, bearerSlot: 'leftHand' });
  M.apply(data, a, { kind: 'applyPenetration', seat: 's1', uid: shooter.uid, targetUid: bearer.uid, slot: 'torso' });
  check('F1 the Penetration stamps the bearer\'s base on its Box', itemOf(a).dropFrom, { col: 15, row: 15, size: bearer.size });
  M.apply(data, a, { kind: 'recordKill', seat: 's1', uid: shooter.uid, targetUid: bearer.uid, what: 'unit' });
  check('F1 the kill leaves the owed drop to the attacker', itemOf(a).bearerUid, bearer.uid);
  const above = { col: 16, row: 14 };
  check('F1 the attacker still drops it, beside where the bearer stood', ok(a, drop(a, shooter, above)), true);
  send(a, drop(a, shooter, above));
  check('F1 and it lands there, owed no more', [itemOf(a).bearerUid, itemOf(a).col, itemOf(a).row, itemOf(a).dropFrom], [undefined, 16, 14, undefined]);

  // F6, I24: edge to edge with the base, never under it, never at a corner,
  // never on terrain, and only when a Penetration owes it.
  const b = table();
  const hit = put(b, 's1', L(), 2, 2);
  const carrier = put(b, 's2', L(), 5, 5);
  box(b, { bearerUid: carrier.uid, bearerSlot: 'leftHand' });
  check('F6 no Penetration, no drop', ok(b, drop(b, hit, { col: 16, row: 14 })), false);
  M.apply(data, b, { kind: 'applyPenetration', seat: 's1', uid: hit.uid, targetUid: carrier.uid, slot: 'leftHand' });
  check('F6 the control: on the shared edge, it lands', ok(b, drop(b, hit, { col: 16, row: 14 })), true);
  check('F6 never under the bearer', ok(b, drop(b, hit, { col: 16, row: 16 })), false);
  check('F6 never at a corner', ok(b, drop(b, hit, { col: 14, row: 14 })), false);
  check('F6 and never two Grids off', ok(b, drop(b, hit, { col: 16, row: 13 })), false);
  const [mapId, pieces] = Object.entries(data.terrain.layouts).find(([, v]) => Array.isArray(v) && v.some((p) => p.subCells?.length));
  const cell = pieces.find((p) => p.subCells?.length).subCells[0];
  const c = table();
  c.map = mapId;
  const bit = droneOn(c, 's2', 'ZHDR-201', 0, 0, { col: cell.col, row: cell.row + 1 });
  const by = put(c, 's1', L(), 8, 8);
  box(c, { bearerUid: bit.uid, bearerSlot: 'main', dropFrom: { col: bit.col, row: bit.row, size: bit.size } });
  check('F6 never on terrain (FAQ P9)', ok(c, drop(c, by, { col: cell.col, row: cell.row })), false);
  const nb = table();
  nb.noBoard = true;
  const nbBy = put(nb, 's1', L(), 1, 1);
  const nbBearer = put(nb, 's2', L(), 1, 1);
  box(nb, { bearerUid: nbBearer.uid, bearerSlot: 'leftHand' });
  check('F6 a table with no board places the model itself', ok(nb, drop(nb, nbBy, { col: 3, row: 3 })), true);

  // F5: a pick-up in the unit's own Opportunity, from a Grid it moved
  // through or stands in, on a guided board.
  const d = table();
  const mover = put(d, 's1', L({ leftHand: '023' }), 2, 2);
  const other = put(d, 's1', L(), 8, 8);
  box(d, { col: 4 * 3 + 1, row: 2 * 3 + 1 });
  const take = { kind: 'takeBlackBox', seat: 's1', uid: mover.uid, itemId: 'blackbox-t', slot: 'leftHand' };
  check('F5 not outside its own Opportunity', ok(d, take), false);
  d.script.opp = opp(other.uid);
  check('F5 nor in another unit\'s', ok(d, take), false);
  d.script.opp = opp(mover.uid);
  check('F5 nor from a Grid it never entered', ok(d, take), false);
  M.apply(data, d, { kind: 'maneuver', seat: 's1', uid: mover.uid, to: G(5, 2), via: [G(3, 2), G(4, 2)], free: true });
  check('F5 the Movement records the Grids it entered', d.script.opp.route, ['2,2', '3,2', '4,2', '5,2']);
  check('F5 so the Box it walked over is picked up', ok(d, take), true);
  // F10, I22: a flight enters only its start and landing Grids.
  const e = table();
  const flier = put(e, 's1', L({ leftHand: '023' }), 2, 2);
  box(e, { col: 4 * 3 + 1, row: 2 * 3 + 1 });
  e.script.opp = opp(flier.uid);
  M.apply(data, e, { kind: 'maneuver', seat: 's1', uid: flier.uid, to: G(6, 2), via: [G(3, 2), G(4, 2), G(5, 2)], free: true, flying: true });
  check('F10 a flight records its start and landing only', e.script.opp.route, ['2,2', '6,2']);
  check('F10 so the Box it flew over is not picked up', ok(e, { ...take, uid: flier.uid }), false);
  const f = freeTable();
  const loose = put(f, 's1', L({ leftHand: '023' }), 2, 2);
  box(f, { col: 8 * 3 + 1, row: 8 * 3 + 1 });
  check('F5 the control: a free table leaves the route to the page', ok(f, { ...take, uid: loose.uid }), true);

  // F7: a Part bearing a Box serves no [Two-Handed] (5.3.1).
  const g = table();
  const burst = put(g, 's1', L({ leftHand: '023' }), 2, 2);
  const fire = actionOf('058', '058_A');
  check('F7 the control: a free Freehand serves Two-Handed', !!U.twoHandedUse(data, burst, fire, Tk.boxHands(g.tasks, burst.uid)), true);
  box(g, { bearerUid: burst.uid, bearerSlot: 'leftHand' });
  check('F7 the hand bearing a Box does not', U.twoHandedUse(data, burst, fire, Tk.boxHands(g.tasks, burst.uid)), null);
  g.script.opp = opp(burst.uid, { timing: 'firing' });
  check('F7 and the engine refuses the designation', ok(g, { kind: 'performAction', seat: 's1', uid: burst.uid, actionId: '058_A', twoHanded: true }), false);

  // F8, I19: a Carrier carries a Box on a Freehand Load (FAQ P11).
  const h = freeTable();
  const tarantula = { ...U.makeDroneToken(h, data, data.byId.get('162'), 's1', '087'), ...G(2, 2), facing: 0, deployed: true, statuses: [], log: [] };
  h.tokens.push(tarantula);
  box(h, { col: 2 * 3 + 1, row: 2 * 3 + 1 });
  check('F8 the Load\'s Freehand carries a Box', U.freehandSlots(data, tarantula, [], [], true).map((x) => x.slot), ['backpack']);
  check('F8 and the take is accepted', ok(h, { kind: 'takeBlackBox', seat: 's1', uid: tarantula.uid, itemId: 'blackbox-t', slot: 'backpack' }), true);
  check('F8 the control: nothing else of the Load reaches the Carrier (O4)', U.freehandSlots(data, tarantula).length, 0);

  // F9, I20: a bearer leaving with no drop owed leaves its Box where it stood.
  const k = freeTable();
  const worn = put(k, 's1', L(), 6, 6);
  worn.partStates = { ...worn.partStates, leftHand: 'destroyed', rightHand: 'destroyed', backpack: 'destroyed' };
  box(k, { bearerUid: worn.uid, bearerSlot: 'chasis' });
  k.round.phase = 4;
  send(k, { kind: 'advancePhase', seat: 's1', sweep: true });
  check('F9 Integrity Loss removes the bearer', k.tokens.some((x) => x.uid === worn.uid), false);
  check('F9 and leaves its Box in its Grid', [itemOf(k).bearerUid, itemOf(k).col, itemOf(k).row], [undefined, 19, 19]);
  const ab = table();
  const faller = put(ab, 's2', L(), 7, 7);
  const pusher = put(ab, 's1', L(), 1, 1);
  box(ab, { bearerUid: faller.uid, bearerSlot: 'leftHand' });
  M.apply(data, ab, { kind: 'recordKill', seat: 's1', uid: pusher.uid, targetUid: faller.uid, what: 'unit' });
  check('F9 a kill with no drop owed (the Abyss) leaves it where the bearer fell', [itemOf(ab).bearerUid, itemOf(ab).col, itemOf(ab).row], [undefined, 22, 22]);

  // F4: with no board, a carried Box is claimed for its bearer's squad.
  const p = freeTable();
  p.noBoard = true;
  const holder = put(p, 's2', L(), 1, 1);
  box(p, { bearerUid: holder.uid, bearerSlot: 'leftHand' });
  const claim = (side) => ({ kind: 'claimItem', seat: 's1', itemId: 'blackbox-t', side });
  check('F4 the pad claims a carried Box for its bearer\'s squad', ok(p, claim('s2')), true);
  check('F4 and for no other', ok(p, claim('s1')), false);
  check('F4 and clears it', ok(p, claim(null)), true);
  const q = freeTable();
  const onBoard = put(q, 's2', L(), 1, 1);
  box(q, { bearerUid: onBoard.uid, bearerSlot: 'leftHand' });
  check('F4 the control: a board reads the Box, never a claim', ok(q, claim('s2')), false);
}

// ================= F9. a unit taken off the board leaves its Box behind (ruling I20) =================
{
  // The tabletop's Remove and the Match Centre's both despawn; the Box went
  // with the unit.
  const s = freeTable();
  const u = put(s, 's1', L(), 3, 4);
  s.tasks = { ...Tk.newTaskState(), items: [{ id: 'bb', kind: 'blackbox', zone: 'echo', control: null, accessed: null, bearerUid: u.uid, bearerSlot: 'leftHand' }] };
  send(s, { kind: 'despawn', seat: 's1', uid: u.uid, targetUid: u.uid });
  const it = Tk.normaliseTasks(s.tasks).items[0];
  check('F9 a despawned bearer leaves its Box in its Grid', [it.bearerUid, it.col, it.row], [undefined, 10, 13]);
}

// ================= A, F3, G. Setup and squads (3.1, 5.1, 5.2.1; FAQ P1, P2, P23; rulings I3-I5, I17, I23, I30, I32) =================
{
  const at = (stage) => {
    const s = table();
    s.setup.stage = stage;
    s.round.firstPlayer = 's1';
    return s;
  };
  const sec = (seat, cardId) => ({ kind: 'pickSecondary', seat, cardId });
  const cards = data.secondary.filter((c) => !c.designate || c.designate === 'none').map((c) => c.id);

  // A1, I3: the edge follows the roll and the Main Task; the Secondaries, their
  // targets and the Boxes follow the edge.
  const r = at('roll');
  r.setup.rolls = { s1: [2], s2: [1] };
  send(r, { kind: 'acceptRoll', seat: 's1' });
  check('A1 the roll hands over to the edge', r.setup.stage, 'side');
  check('A1 the Main Task may still be chosen before the edge', ok(r, { kind: 'configureTable', seat: 's1', mission: 'terminal-data-extraction' }), true);
  check('A1 and no Secondary yet', ok(r, sec('s1', cards[0])), false);
  send(r, { kind: 'pickEdge', seat: 's1', edge: 'black' });
  check('A1 the edge opens the Tasks step', r.setup.stage, 'tasks');
  check('A1 the Main Task is settled once the edge is picked', ok(r, { kind: 'configureTable', seat: 's1', mission: 'terminal-data-extraction' }), false);

  // A2, I5, I17: the First Player first; final once both are revealed; never
  // the same card.
  const t = at('tasks');
  check('A2 the second player waits for the First Player', ok(t, sec('s2', cards[0])), false);
  check('A2 the First Player picks first', send(t, sec('s1', cards[0])).ok, true);
  check('A2 the First Player may change it while the other has not chosen', ok(t, sec('s1', cards[1])), true);
  check('A2 the other squad cannot take the same card', ok(t, sec('s2', cards[0])), false);
  check('A2 and takes another', send(t, sec('s2', cards[1])).ok, true);
  const third = data.secondary.map((c) => c.id).find((id) => id !== cards[0] && id !== cards[1]);
  check('A2 both revealed, both are final', [ok(t, sec('s1', third)), ok(t, sec('s2', third))], [false, false]);
  check('A2 the control: a free table picks as it likes', ok(freeTable(), sec('s2', cards[0])), true);
  check('A5 no pick once deployment begins', ok(at('deploy'), sec('s1', cards[0])), false);

  // F3, I23: the Boxes' default spots mirror, and the players place them
  // alternately from the First Player.
  const asset = data.missions.cards.find((m) => m.id === 'blackbox-asset-preservation');
  const boxes = Tk.taskItemsFor(data.zoneData.zones, asset).items;
  const grid = (i) => `${Math.floor(i.col / 3)},${Math.floor(i.row / 3)}`;
  const byZone = Object.fromEntries(boxes.map((i) => [i.zone, grid(i)]));
  check('F3 the default Boxes sit on mirrored Grids', byZone, { alpha: '2,2', charlie: '2,9', golf: '9,2', india: '9,9' });
  // Bravo and Hotel each have two Grids equally near the middle: the tie goes
  // the way a half turn keeps, so the pair still mirrors.
  const frag = data.missions.cards.find((m) => m.id === 'blackbox-fragment-recovery');
  const fr = Object.fromEntries(Tk.taskItemsFor(data.zoneData.zones, frag).items.map((i) => [i.zone, grid(i)]));
  check('F3 a tie still mirrors', [fr.bravo, fr.hotel, fr.delta, fr.foxtrot], ['2,5', '9,6', '5,3', '6,8']);
  const p = at('tasks');
  p.mission = asset.id;
  p.tasks = Tk.taskItemsFor(data.zoneData.zones, asset);
  const place = (seat, zone, col, row) => ({ kind: 'placeTaskItem', seat, itemId: `blackbox-${zone}`, to: { col, row } });
  check('F3 not before the Tasks step', ok(at('side'), place('s1', 'alpha', 4, 4)), false);
  check('F3 the second player waits for the First Player', ok(p, place('s2', 'india', 31, 31)), false);
  check('F3 a Box goes in its own zone', ok(p, place('s1', 'alpha', 31, 31)), false);
  check('F3 the First Player places one', send(p, place('s1', 'alpha', 4, 3)).ok, true);
  check('F3 and it stands there, placed by them', (() => { const i = Tk.normaliseTasks(p.tasks).items.find((x) => x.zone === 'alpha'); return [i.col, i.row, i.set]; })(), [4, 3, 's1']);
  check('F3 then the other squad', [ok(p, place('s1', 'golf', 28, 7)), ok(p, place('s2', 'golf', 28, 7))], [false, true]);
  check('F3 a placed Box is placed', ok(p, place('s2', 'alpha', 7, 7)), false);
  p.tasks.secondary = { s1: cards[0], s2: cards[1] };
  check('F3 a strict Tasks step waits for every Box', ok(p, { kind: 'finishTasks', seat: 's1' }), false);
  for (const i of p.tasks.items) i.set = i.set ?? 's1';
  check('F3 and closes once they are down', ok(p, { kind: 'finishTasks', seat: 's1' }), true);

  // A3, A6, I4: one unit to a Grid, in the zone, the base clear of terrain,
  // and the Grids next to a full zone (FAQ P23).
  const d = at('deploy');
  const a1 = put(d, 's1', L(), 1, 10);
  const b1 = put(d, 's1', L(), 2, 10);
  const nudge = (u, c, row) => ({ kind: 'deployUnit', seat: 's1', uid: u.uid, to: G(c, row), stance: 'offensive' });
  check('A3 the control: a free Grid of the zone takes it', ok(d, nudge(b1, 3, 10)), true);
  check('A3 never a Grid another unit holds', ok(d, nudge(b1, 1, 10)), false);
  check('A3 never outside the zone', ok(d, nudge(b1, 3, 5)), false);
  // A zone only one browser can read leaves the zone to the page, and the
  // Grid still has to be free.
  d.zoneSet = 'custom:mine';
  check('A3 one unit to a Grid, whatever the zone', ok(d, nudge(b1, 1, 10)), false);
  delete d.zoneSet;
  void a1;
  const full = at('deploy');
  full.deployZones = { black: ['A1'], white: ['L12'] };
  put(full, 's1', L(), 11, 11);
  const late = put(full, 's1', L(), 11, 10);
  check('A6 a full zone opens the Grids next to it (FAQ P23)', ok(full, nudge(late, 10, 11)), true);
  check('A6 and only the nearest ring while it has room', ok(full, nudge(late, 9, 11)), false);
  const [mapId, pieces] = Object.entries(data.terrain.layouts).find(([, v]) => Array.isArray(v) && v.some((x) => x.subCells?.length));
  const cell = pieces.find((x) => x.subCells?.length).subCells[0];
  const tc = Math.floor(cell.col / 3);
  const tr = Math.floor(cell.row / 3);
  const rough = at('deploy');
  rough.map = mapId;
  rough.deployZones = { black: ['A1'], white: [`${String.fromCharCode(65 + tc)}${tr + 1}`] };
  const onRock = put(rough, 's1', L(), 0, 0);
  check('A3 a base cannot overlap terrain (p.6)', ok(rough, nudge(onRock, tc, tr)), false);
  // With no board there are no Grids to judge. The pad sends every unit to
  // the same placeholder cell, and its second unit was refused as if the
  // first stood in that Grid (found in the browser pass).
  const padTable = at('deploy');
  padTable.noBoard = true;
  put(padTable, 's1', L(), 0, 0);
  const second = put(padTable, 's1', L(), 0, 0);
  check('A3 a table with no board places every unit', ok(padTable, nudge(second, 0, 0)), true);

  // A4: a new game starts whole.
  const f = freeTable();
  const hurt = put(f, 's1', L(), 3, 3, { statuses: ['fci', 'fragile'], link: 1, stance: 'shutdown', lastDamagedBy: { side: 's2', uid: 9 } });
  hurt.partStates.leftHand = 'destroyed';
  hurt.partStates.torso = 'damaged';
  const bit = droneOn(f, 's1', '293', 4, 4, { parentUid: hurt.uid });
  f.tasks = { ...Tk.newTaskState(), vp: { s1: 7, s2: 3 }, secondary: { s1: cards[0], s2: cards[1] } };
  f.tacticsPlayed = { s1: ['1:276'], s2: [] };
  f.removedTerrain = ['x1'];
  check('A4 a new game starts', send(f, { kind: 'startMatch', seat: 's1' }).ok, true);
  const fresh = f.tokens.find((x) => x.uid === hurt.uid);
  // The Command Phase the new game opens hands out its own Command Token
  // (3.2.1); the old game's Tokens are gone.
  check('A4 its units come back whole', [fresh.partStates.leftHand, fresh.partStates.torso, (fresh.statuses ?? []).filter((x) => x !== 'command'), fresh.link, fresh.lastDamagedBy], ['intact', 'intact', [], data.byId.get('FPA-04-2').LV, undefined]);
  check('A4 keeping who they are', [fresh.uid, fresh.label, fresh.deployed], [hurt.uid, hurt.label, false]);
  check('A4 a launched unit is not in the squad', f.tokens.some((x) => x.uid === bit.uid), false);
  check('A4 the score, the Secondaries and the spent cards go', [Tk.normaliseTasks(f.tasks).vp, Tk.normaliseTasks(f.tasks).secondary, f.tacticsPlayed, f.removedTerrain], [{ s1: 0, s2: 0 }, {}, { s1: [], s2: [] }, []]);

  // A5: the locks.
  check('A5 the board size goes with the map', ok(at('roll'), { kind: 'configureTable', seat: 's1', grids: 16 }), false);
  check('A5 a whole TaskState goes with the Main Task', ok(at('tasks'), { kind: 'configureTable', seat: 's1', tasks: { ...Tk.newTaskState(), vp: { s1: 0, s2: 30 } } }), false);
  check('A5 the length is fixed once the game is under way', ok(table(), { kind: 'configureTable', seat: 's1', roundLimit: 7 }), false);
  check('A5 the control: before then it is set', ok(at('tasks'), { kind: 'configureTable', seat: 's1', roundLimit: 7 }), true);
  const bounty = data.secondary.find((c) => c.designate === 'enemy-mech').id;
  const named = (stage) => {
    const s = at(stage);
    s.tasks = { ...Tk.newTaskState(), secondary: { s1: bounty } };
    const foe = put(s, 's2', L(), 5, 1);
    return [s, { kind: 'designateTask', seat: 's1', what: 'target', for: 's1', uid: foe.uid }];
  };
  check('A5 the control: a target is named in the Tasks step', ok(...named('tasks')), true);
  check('A5 and not once anything deploys', ok(...named('deploy')), false);
  const roll = at('roll');
  roll.setup.rolls = { s1: [2], s2: [] };
  check('A5 a squad rolls once', [ok(roll, { kind: 'rollSetup', seat: 's1', hits: [3] }), ok(roll, { kind: 'rollSetup', seat: 's2', hits: [1] })], [false, true]);
  roll.setup.rolls = { s1: [2], s2: [2] };
  check('A5 and again on a tie', ok(roll, { kind: 'rollSetup', seat: 's1', hits: [3] }), true);
  M.Lp.setLocalSeat('s2');
  try {
    check('A5 across a table, the guest does not set the length', ok(at('tasks'), { kind: 'configureTable', seat: 's2', roundLimit: 7 }), false);
    const mid = table();
    check('A5 nor ends a game under way', ok(mid, { kind: 'endMatch', seat: 's2' }), false);
    check('A5 the host does', ok(mid, { kind: 'endMatch', seat: 's1' }), true);
    mid.tasks = { ...Tk.newTaskState(), conceded: 's2' };
    check('A5 and a game that is over ends from either seat', ok(mid, { kind: 'endMatch', seat: 's2' }), true);
  } finally {
    M.Lp.setLocalSeat(null);
  }

  // A7: Environment Cards before deployment.
  const env = data.environments.cards[0].id;
  check('A7 an Environment Card goes down in the Tasks step', ok(at('tasks'), { kind: 'setEnvironment', seat: 's1', at: { col: 5, row: 5 }, card: env }), true);
  check('A7 not once units are going down', ok(at('deploy'), { kind: 'setEnvironment', seat: 's1', at: { col: 5, row: 5 }, card: env }), false);

  // G2, G3, G6: squad legality.
  const g = freeTable();
  put(g, 's1', L({ pilot: 'FPA-04' }), 1, 1);
  put(g, 's1', L({ pilot: 'FPA-04-2' }), 2, 2);
  put(g, 's1', L({ leftHand: '', rightHand: '', pilot: 'FPA-05' }), 3, 3);
  droneOn(g, 's1', '522', 4, 4);
  const kinds = U.factionProblems(data, g.tokens).map((x) => x.kind).sort();
  check('G2, G3, G6 two versions of one Pilot, an armless Mech and a Low Value Drone', kinds, ['duplicate-pilot', 'incomplete-mech', 'launched-only']);
  const join = (loadout) => ({ kind: 'importSquad', seat: 's1', name: 'Late', mechs: [{ loadout }], drones: [] });
  const strictDeploy = at('deploy');
  check('G3 a strict table refuses a Mech it could not deploy', ok(strictDeploy, join({ torso: '012', chasis: '020', pilot: 'FPA-05' })), false);
  check('G3 the control: a whole one joins', ok(strictDeploy, join({ torso: '012', chasis: '020', leftHand: '041', pilot: 'FPA-05' })), true);
  check('G3 an open table takes it, and warns', ok(freeTable(), join({ torso: '012', chasis: '020', pilot: 'FPA-05' })), true);
}

// ================= C3, C4. J12: an effect's Low Profile against a Highlight (ruling I12) =================
{
  // "If both Highlight and Low Profile are gained simultaneously through
  // effects such as Aura, then neither effect takes effect" (J12). Only the
  // MES aura was read, and only by the Highlight half.
  const s = freeTable();
  const shooter = put(s, 's2', L(), 5, 1);
  const inAura = put(s, 's1', L(), 2, 8, { statuses: ['highlight'] });
  droneOn(s, 's1', '072', 2, 9);
  check('C3 the control: the MES aura cancels a Highlight', U.hasHighlight(data, s.tokens, inAura), false);
  const key = put(s, 's1', L({ pilot: 'FPA-06-2' }), 11, 8, { statuses: ['highlight'] });
  droneOn(s, 's1', '077', 11, 9);
  check('C3 KeyHole\'s concealment in an ally\'s aura cancels it too', U.hasHighlight(data, s.tokens, key), false);
  const plain = put(s, 's1', L(), 11, 2, { statuses: ['highlight'] });
  check('C3 the control: a plain Highlight binds', U.hasHighlight(data, s.tokens, plain, { shooter }), true);
  droneOn(s, 's1', 'ZHDR-204', 5, 2);
  check('C3 a Misty Eagle beside the shooter cancels it for that shooter', U.hasHighlight(data, s.tokens, plain, { shooter }), false);
  const far = put(s, 's2', L(), 0, 11);
  check('C3 and not for another shooter', U.hasHighlight(data, s.tokens, plain, { shooter: far }), true);

  // The attack window: under a Highlight the aura's Low Profile is off.
  const h = new M.AttackHelper(data, dice, makeEl('div'), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => s.tokens;
  const ctx = { attacker: shooter, defender: inAura, action: { id: 'x', type: 'Firing' } };
  check('C3 the window: a Highlighted defender in the aura has no Low Profile', h.lowProfileOn(ctx).on, false);
  inAura.statuses = [];
  check('C3 the control: without the Highlight the aura stands', h.lowProfileOn(ctx).on, true);
  inAura.statuses = ['lowProfile', 'highlight'];
  check('C3 a Low Profile Token is no effect, and stands', h.lowProfileOn(ctx).on, true);
  inAura.statuses = [];

  // C4: no board, no positions: the table says.
  h.noBoard = true;
  check('C4 with no board nothing is read off positions', h.lowProfileOn(ctx).on, false);
  h.tableLowProfile = true;
  check('C4 and the table\'s word is taken', h.lowProfileOn(ctx).on, true);
  check('C4 with no board the Highlight binds', U.hasHighlight(data, s.tokens, key, { noBoard: true }), true);
  const quiet = freeTable();
  const lone = put(quiet, 's1', L(), 3, 3);
  put(quiet, 's2', L(), 6, 6);
  check('C4 the pad asks only when a source could be in play', [U.effectLowProfileCould(data, s.tokens, inAura), U.effectLowProfileCould(data, quiet.tokens, lone)], [true, false]);
}

// ================= C6. The SU1's Armor Patch mends an ally, then leaves (ZYDR-108_B) =================
{
  // "Remove 1 Damaged Token from Ally Unit, then remove this Unit." It was read
  // as mending its own Parts (Structure 0: never Damaged), and repairPart
  // refused a Drone, so it never did anything.
  const patch = actionOf('ZYDR-108', 'ZYDR-108_B');
  check('C6 the spec reads an ally, and the leaving', (({ ally, removeSelf }) => [ally, removeSelf])(U.repairSpec(patch)), [true, true]);
  const s = freeTable();
  const su1 = droneOn(s, 's1', 'ZYDR-108', 4, 4);
  const hurt = put(s, 's1', L(), 5, 4);
  hurt.partStates.leftHand = 'damaged';
  const foe = put(s, 's2', L(), 4, 5);
  foe.partStates.leftHand = 'damaged';
  const far = put(s, 's1', L(), 10, 10);
  far.partStates.leftHand = 'damaged';
  const mend = (target, over = {}) => ({ kind: 'repairPart', seat: 's1', uid: su1.uid, slot: 'leftHand', mode: 'mend', targetUid: target.uid, actionId: 'ZYDR-108_B', ...over });
  check('C6 an enemy is no ally', ok(s, mend(foe)), false);
  check('C6 an ally beyond Range 2 is out of reach', ok(s, mend(far)), false);
  check('C6 it gives no Repaired Token', ok(s, mend(hurt, { mode: 'repaired' })), false);
  check('C6 only an Action that mends an ally', ok(s, mend(hurt, { actionId: 'ZYDR-108_A' })), false);
  check('C6 an ally in Range is mended', send(s, mend(hurt)).ok, true);
  check('C6 its Damaged Part is intact again', hurt.partStates.leftHand, 'intact');
  check('C6 and the SU1 leaves the board', s.tokens.some((x) => x.uid === su1.uid), false);
  const nb = freeTable();
  nb.noBoard = true;
  const su = droneOn(nb, 's1', 'ZYDR-108', 0, 0);
  const away = put(nb, 's1', L(), 11, 11);
  away.partStates.rightHand = 'damaged';
  check('C6 with no board the table judges the Range', ok(nb, { kind: 'repairPart', seat: 's1', uid: su.uid, slot: 'rightHand', mode: 'mend', targetUid: away.uid, actionId: 'ZYDR-108_B' }), true);
  check('C6 the pad lists every damaged ally', U.allyRepairTargets(data, nb.tokens, su, patch, true).map((x) => [x.unit.uid, x.slot]), [[away.uid, 'rightHand']]);
}

// ================= D5, D8. Kills: the wreck that detonates, and a tapped kill's killer =================
{
  // D5: Martyrdom (ZHDR-302) detonates as it is destroyed. The kill took it off
  // the board first, so nothing was ever owed.
  const s = freeTable();
  const shooter = put(s, 's2', L(), 5, 1);
  const zealot = droneOn(s, 's1', 'ZHDR-302', 5, 5);
  const plain = droneOn(s, 's1', 'ZHDR-201', 7, 7);
  zealot.partStates.main = 'destroyed';
  send(s, { kind: 'recordKill', seat: 's2', uid: shooter.uid, targetUid: zealot.uid, what: 'unit' });
  check('D5 a unit that detonates as it dies stays as a wreck', s.tokens.some((x) => x.uid === zealot.uid), true);
  check('D5 so its blast is owed', U.martyrdomOwed(data, s.tokens).map((x) => x.uid), [zealot.uid]);
  check('D5 and the kill still counts', Tk.normaliseTasks(s.tasks).kills.s2.drones, 1);
  plain.partStates.main = 'destroyed';
  send(s, { kind: 'recordKill', seat: 's2', uid: shooter.uid, targetUid: plain.uid, what: 'unit' });
  check('D5 the control: any other unit leaves the board', s.tokens.some((x) => x.uid === plain.uid), false);

  // D8: a tap into Destroyed names its killer. It went to the other squad as
  // uid 0: Weapons Test never counted it, and an own kill broke Mercy.
  const p = freeTable();
  p.noBoard = true;
  const tester = put(p, 's1', L(), 1, 1);
  const mate = put(p, 's1', L(), 2, 2);
  const foe = put(p, 's2', L(), 3, 3);
  p.tasks = { ...Tk.newTaskState(), secTarget: { s1: tester.uid } };
  const tap = (u, slot, by) => ({ kind: 'setPartState', seat: 's1', uid: u.uid, slot, state: 'destroyed', ...(by !== undefined ? { by } : {}) });
  send(p, tap(foe, 'leftHand', tester.uid));
  check('D8 a tapped kill named for the Test Unit counts for Weapons Test', Tk.normaliseTasks(p.tasks).testKills.s1, 1);
  send(p, tap(mate, 'leftHand', tester.uid));
  check('D8 an own kill credits the enemy nothing', Tk.normaliseTasks(p.tasks).kills.s2.partsAndDrones, 0);
  send(p, tap(mate, 'rightHand'));
  check('D8 the control: a kill named for nobody goes to the other squad', Tk.normaliseTasks(p.tasks).kills.s2.partsAndDrones, 1);
  check('D8 an attacker not on the table is refused', ok(p, tap(foe, 'rightHand', 999)), false);
  // A tap back out retracts what the tap in credited.
  send(p, { kind: 'setPartState', seat: 's1', uid: foe.uid, slot: 'leftHand', state: 'intact' });
  check('D8 and a tap back out takes back the same credit', Tk.normaliseTasks(p.tasks).testKills.s1, 0);
}

// ================= J. The Reference: a Tactics Card reaches its entry =================
{
  // The Tactics Cards entry had no match term, and a Tactics Card prints no
  // rules line a term could hit, so the entry reached no card at all. The
  // card detail now hands the term in by category.
  check('J the Tactics Cards entry answers to its term',
    data.mechanicsFor('tactics card').map((m) => m.id), ['tactics_cards']);
  const refcards = readFileSync(new URL('../src/refcards.ts', import.meta.url), 'utf8');
  check('J a Tactics Card detail hands that term in by its category',
    /mechBlocks\(c\.description\?\.en, c\.description\?\.zh, c\.category === 'tactics_or_upgrade' \? 'tactics card' : undefined\)/.test(refcards), true);
  // No Terminals mission said "remote access"; the entry now answers to the
  // setup line all three print, and to nothing else on a card.
  check('J the Terminals setup line reaches Remote Access',
    data.mechanicsFor('Place 1 terminal in each of the Bravo, Echo and Hotel tactical zones.').map((m) => m.id), ['remote_access']);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

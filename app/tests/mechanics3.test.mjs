// MECHANICS AUDIT, PHASE 3 (2026-09-25): stealth and electronic warfare, driven
// through the real command layer, the real readers and the shipped cards. Each
// block is one finding of Project-Documents/MECHANICS-AUDIT.md (the letters
// match its sections), pinned by behaviour rather than by the shape of the
// source, and each was mutation-checked: put its fix back the way it was and it
// fails.
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
const entry = new URL('./_mechanics3.entry.ts', import.meta.url);
const out = new URL('./_mechanics3.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { check, apply } from '../src/commands';",
  "export { loadData } from '../src/data';",
  "export { glueAfter } from '../src/glue';",
  "export { newScriptState } from '../src/types';",
  "export { losNote } from '../src/rules';",
  "export * as U from '../src/units';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const U = M.U;
const data = await M.loadData();

// ---------- a scripted table, the way a strict guided page holds one ----------
function table() {
  return {
    v: 3, map: 'none', tokens: [], nextUid: 1,
    round: { n: 1, phase: 2, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    script: { ...M.newScriptState('s1'), strict: true },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
  };
}
// A Large Grid's top-left cell: col/row are small cells, three to a Grid.
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
const open = (s) => M.glueAfter(data, s, { kind: 'noteRoll', seat: 's1', what: 'x' });
const send = (s, cmd) => {
  const v = M.check(data, s, cmd);
  if (v.ok) { M.apply(data, s, cmd); M.glueAfter(data, s, cmd); }
  return v;
};
const ok = (s, cmd) => M.check(data, s, cmd).ok;
const card = (cardId, actionId) => data.byId.get(cardId)?.actions?.find((a) => a.id === actionId);
const common = (id) => data.commonActions.find((a) => a.id === id);
const due = (s) => (s.script.revealDue ?? []).map((d) => `${d.uid}:${d.why}${d.byUid !== undefined ? `@${d.byUid}` : ''}`);

console.log('Phase 3: stealth and electronic warfare\n');

// ================= B. Silence (4.12.1, 4.12.3) =================
{
  const s = table();
  const viper = put(s, 's1', L({ torso: '094' }), 2, 2);
  const ghost = put(s, 's1', L({ chasis: '100' }), 5, 2);
  // B1: 27 Parts list Silence in their keyword footer; only Stealth Movement
  // makes a Maneuver Silent (4.12.3, FAQ I2).
  check('B1 a Viper torso does not make the Maneuver Silent', U.maneuverIsSilent(data, viper), false);
  check('B1 the Stealth Chassis does', U.maneuverIsSilent(data, ghost), true);
  check('B1 not once it is destroyed (FAQ I2)', U.maneuverIsSilent(data, { ...ghost, partStates: { ...ghost.partStates, chasis: 'destroyed' } }), false);
  check('B1 but a Repaired one still acts (FAQ J23)',
    U.maneuverIsSilent(data, { ...ghost, partStates: { ...ghost.partStates, chasis: 'destroyed' }, repairedSlots: ['chasis'] }), true);
  // B2: "All Move Actions and Maneuver of this part have Silence".
  check('B2 the Stealth Chassis Sprint is Silent', U.isSilentAction(data, s.tokens, ghost, card('100', '100_A')), true);
  const jumper = put(s, 's1', L({ chasis: '100', backpack: '088' }), 8, 2);
  check('B2 a Backpack\'s Move Action on it is not', U.isSilentAction(data, s.tokens, jumper, card('088', '088_A')), false);
  check('F14 a Crawl with the Chassis is Silent, with an arm it is not',
    [U.isSilentAction(data, s.tokens, ghost, common('COMMON_CRAWL'), 'COMMON_CRAWL@chasis'),
      U.isSilentAction(data, s.tokens, ghost, common('COMMON_CRAWL'), 'COMMON_CRAWL@leftHand')], [true, false]);
  // F14: Dynamic Perception names "All Actions"; a Maneuver is not one.
  droneOn(s, 's2', 'ZHDR-206', 4, 3);
  check('F14 an enemy Patrol Eagle leaves the Maneuver Silent', U.maneuverIsSilent(data, ghost), true);
  check('F14 and takes the Sprint\'s Silence', U.isSilentAction(data, s.tokens, ghost, card('100', '100_A')), false);
  // F11: the GoF 1.021 MR24 prints no Silence on either Action.
  check('F11 MR24 (ZHRA-202) prints no Silence', ['ZHRA-202_A', 'ZHRA-202_B'].map((id) => U.isSilentAction(data, [], viper, card('ZHRA-202', id))), [false, false]);
  // F10: the Common Scan is played Silent, citing FAQ I18.
  check('F10 the Common Scan is Silent', U.isSilentAction(data, [], viper, common('COMMON_SCAN')), true);
}

// ================= C. Optical Camouflage, Reveal and Manifestation =================
{
  // C1: Range counted orthogonally (4.2.1): Stealth 2 reaches 12 Grids, not 24.
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 6, 6, { statuses: ['camouflage'] });
  const spots = U.manifestTargets(data, s.tokens, [], oct, s);
  check('C1 Stealth 2 offers the 12 Grids within Range 2', spots.length, 12);
  check('C1 the reveal refuses a diagonal two Grids out (Range 4)', ok(s, { kind: 'reveal', seat: 's1', uid: oct.uid, to: G(8, 8) }), false);
  check('C1 and takes one at Range 2', [ok(s, { kind: 'reveal', seat: 's1', uid: oct.uid, to: G(7, 7) }), ok(s, { kind: 'reveal', seat: 's1', uid: oct.uid, to: G(8, 6) })], [true, true]);
  // C11: an Abyss is no landing for a Ground Unit (FAQ I17).
  s.environments = [{ card: 'abyss', col: 7, row: 6 }];
  check('C11 the picker offers no Abyss', U.manifestTargets(data, s.tokens, [], oct, s).some((g) => g.c === 7 && g.r === 6), false);
  check('C11 and the reveal refuses one', ok(s, { kind: 'reveal', seat: 's1', uid: oct.uid, to: G(7, 6) }), false);
  // F4: its player chooses the facing where it appears.
  send(s, { kind: 'reveal', seat: 's1', uid: oct.uid, to: G(8, 6), facing: 2 });
  check('F4 it appears where picked, facing as chosen', [Math.floor(oct.col / 3), Math.floor(oct.row / 3), oct.facing, oct.statuses.includes('camouflage')], [8, 6, 2, false]);
}
{
  // C6: FAQ I20, "Revealed in place, but it cannot move".
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 6, 6, { statuses: ['camouflage', 'immobilized'] });
  check('C6 an Immobilized unit is offered nowhere', U.manifestTargets(data, s.tokens, [], oct, s).length, 0);
  check('C6 a hop is refused, a Reveal in place is not',
    [ok(s, { kind: 'reveal', seat: 's1', uid: oct.uid, to: G(7, 6) }), ok(s, { kind: 'reveal', seat: 's1', uid: oct.uid })], [false, true]);
}
{
  // C4: the engine records each Reveal as the command that causes it applies.
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 2, 2, { statuses: ['camouflage'], timing: 'swift' });
  // Swift first, Tactical last (TIMINGS), so the Octopus goes first on Swift.
  put(s, 's2', L({ pilot: 'FPA-01' }), 10, 10, { timing: 'tactical' });
  open(s);
  check('C4 its Opportunity is open', s.script.opp?.uid, oct.uid);
  // Ambush starts it on the Swift dial, and prints Silence.
  check('C4 a Silent Action owes nothing', [send(s, { kind: 'performAction', seat: 's1', uid: oct.uid, actionId: '096_A', partKey: '096_A' }).ok, due(s)], [true, []]);
  send(s, { kind: 'performAction', seat: 's1', uid: oct.uid, actionId: '041_A', partKey: '041_A' });
  check('C4 a non-Silence Action owes a Reveal', due(s), [`${oct.uid}:act`]);
  send(s, { kind: 'reveal', seat: 's1', uid: oct.uid });
  check('C4 and the Reveal pays it', due(s), []);
}
{
  // The activating Action itself (Medium, so its own Opportunity on a Tactical
  // dial): 4.12.2's trigger is an Action performed while IN the state.
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 2, 2, { statuses: ['camouflage'], timing: 'tactical' });
  open(s);
  check('C4 the Action that activates camouflage owes nothing',
    [send(s, { kind: 'performAction', seat: 's1', uid: oct.uid, actionId: '096_B', partKey: '096_B' }).ok, due(s)], [true, []]);
}
{
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 2, 2, { statuses: ['camouflage'] });
  M.apply(data, s, { kind: 'maneuver', seat: 's1', uid: oct.uid, to: G(3, 2) });
  check('C4 a Maneuver without Silence owes one', due(s), [`${oct.uid}:move`]);
  s.script.revealDue = [];
  M.apply(data, s, { kind: 'maneuver', seat: 's1', uid: oct.uid, to: G(4, 2), free: true });
  check('C4 a Move Action\'s own move owes nothing more', due(s), []);
}
{
  // C5: Contact is an EVENT, a Movement by either unit ending in Contact (FAQ I4).
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 6, 6, { statuses: ['camouflage'] });
  const a = put(s, 's2', L({ pilot: 'FPA-01' }), 10, 6);
  const b = put(s, 's2', L({ pilot: 'FPA-01' }), 2, 6);
  M.apply(data, s, { kind: 'maneuver', seat: 's2', uid: a.uid, to: G(7, 6) });
  check('C5 an enemy ending a Movement in Contact owes a Reveal', due(s), [`${oct.uid}:touch@${a.uid}`]);
  M.apply(data, s, { kind: 'maneuver', seat: 's2', uid: b.uid, to: G(5, 6) });
  check('C5 and a SECOND enemy arriving owes another', due(s), [`${oct.uid}:touch@${a.uid}`, `${oct.uid}:touch@${b.uid}`]);
  s.script.revealDue = [];
  M.apply(data, s, { kind: 'setStance', seat: 's2', uid: a.uid, stance: 'defensive' });
  check('C5 a Contact that merely persists owes nothing', due(s), []);
}
{
  // FAQ I14: activating in Contact moves nobody, so it Reveals nothing. A
  // second camouflaged unit elsewhere makes apply() run the Contact sweep for
  // this command; with nothing camouflaged beforehand it skips it, and the
  // check would pass for that reason alone.
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 6, 6);
  put(s, 's2', L({ pilot: 'FPA-01' }), 7, 6);
  put(s, 's1', L({ torso: '096' }), 1, 11, { statuses: ['camouflage'] });
  M.apply(data, s, { kind: 'applyStatus', seat: 's1', uid: oct.uid, targetUid: oct.uid, statusId: 'camouflage' });
  check('I14 activating camouflage while in Contact owes nothing', [oct.statuses.includes('camouflage'), due(s)], [true, []]);
}
{
  // C7: a Mine stepped onto never Reveals (I24, M19); one laid into Contact does (I10).
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 2, 2, { statuses: ['camouflage'] });
  const mine = droneOn(s, 's2', '074', 3, 2, { kind: 'projectile', size: 1 });
  const before = U.positionsOf(s.tokens);
  oct.col = G(3, 2).col;
  check('C7 moving onto an enemy Mine owes no Reveal (FAQ I24, M19)', U.contactRevealsOwed(data, s.tokens, before).length, 0);
  oct.col = G(2, 2).col;
  const laid = new Map([...before].filter(([uid]) => uid !== mine.uid));
  mine.col = G(2, 2).col + 3;
  check('C7 a Mine laid into Contact does (FAQ I10)', U.contactRevealsOwed(data, s.tokens, laid).map((x) => x.by.uid), [mine.uid]);
}
{
  // C11: the camouflage gates, and the fifth trigger.
  const s = table();
  const oct = put(s, 's1', L({ torso: '096' }), 2, 2);
  const plain = put(s, 's1', L(), 5, 2);
  const foe = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 8, 2);
  const cam = (seat, t) => ok(s, { kind: 'applyStatus', seat, uid: t.uid, targetUid: t.uid, statusId: 'camouflage' });
  check('C11 camouflage goes on one\'s own unit with a camouflage Part',
    [cam('s1', oct), cam('s1', plain), ok(s, { kind: 'applyStatus', seat: 's1', uid: oct.uid, targetUid: foe.uid, statusId: 'camouflage' })], [true, false, false]);
  const cloak = put(s, 's1', L({ backpack: 'ZYBP-201' }), 11, 2, { statuses: ['camouflage'] });
  M.apply(data, s, { kind: 'setPartState', seat: 's1', uid: cloak.uid, slot: 'backpack', state: 'destroyed' });
  check('C11 losing the Cloak Reveals it in place (4.12.2)', [cloak.statuses.includes('camouflage'), Math.floor(cloak.col / 3)], [false, 11]);
  const hidden = put(s, 's1', L(), 14, 2, { statuses: ['camouflage'] });
  M.apply(data, s, { kind: 'setPartState', seat: 's1', uid: hidden.uid, slot: 'leftHand', state: 'destroyed' });
  check('C11 a camouflage with no camouflage Part to lose is left alone', hidden.statuses.includes('camouflage'), true);
  const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  check('C11 deploying camouflaged needs a camouflage Part', /if \(cmd\.camo && !canActivateCamo\(data, t\)\) return no/.test(cmds), true);
}
{
  // C2: the Forward Arc is a requirement of the attack (4.2.5): strict refuses it.
  const s = table();
  const gun = put(s, 's1', L(), 4, 4, { facing: 1 });
  const back = put(s, 's2', L({ pilot: 'FPA-01' }), 2, 4);
  const shot = card('058', '058_A');
  check('C2 strict marks a target behind the attacker ✕, freeplay ⚠',
    [M.losNote(gun, back, shot, [], s.tokens, [], true).includes('✕ NOT in forward arc'), M.losNote(gun, back, shot, [], s.tokens, []).includes('⚠ NOT in forward arc')], [true, true]);
}

// ================= A. The Scan (4.12.4, FAQ I11, I12, I18) =================
{
  const s = table();
  const gun = put(s, 's1', L({ backpack: '089' }), 2, 2, { facing: 1 });
  const hidden = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 9, 2, { statuses: ['camouflage'] });
  const free = (actionId, over = {}) => ({ kind: 'startCounterRoll', seat: 's1', uid: gun.uid, actionId: 'COMMON_SCAN', targetUid: hidden.uid, thenAttack: { actionId }, ...over });
  // A3/F8: the free Scan at the attack's own reach: R6 rifle, target at Range 7.
  check('A3 a free Scan past the attack\'s reach is refused', ok(s, free('058_A')), false);
  hidden.col = G(8, 2).col;
  check('A3 at the attack\'s Range 6 it opens, where the Common Scan is Range 6 too', ok(s, free('058_A')), true);
  // And past the Common Scan's own 6 when the attack reaches further: "the
  // Common Action: Scan, aside from its range" (FAQ I18).
  const sniper = put(s, 's1', L({ leftHand: '552' }), 2, 8, { facing: 1 });
  const distant = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 10, 8, { statuses: ['camouflage'] });
  check('A3 a free Scan reaches as far as an R12 attack, past the Common Scan\'s 6',
    [ok(s, { kind: 'startCounterRoll', seat: 's1', uid: sniper.uid, actionId: 'COMMON_SCAN', targetUid: distant.uid, thenAttack: { actionId: '552_B' } }),
      ok(s, { kind: 'startCounterRoll', seat: 's1', uid: sniper.uid, actionId: 'COMMON_SCAN', targetUid: distant.uid })], [true, false]);
  const behind = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 1, 2, { statuses: ['camouflage'] });
  check('F8 and the attack must be able to designate the marker: not behind it', ok(s, free('058_A', { targetUid: behind.uid })), false);
  // A1/D1: the one reading of a won Scan: Tokens off, the Reveal and the attack queued.
  const win = U.ewWinCommands(data, gun, hidden, common('COMMON_SCAN'), { thenAttack: { actionId: '058_A' } });
  check('A1 a won Scan queues the Reveal and the attack behind it',
    win.cmds.filter((c) => c.kind === 'queueReactions').flatMap((c) => c.items.map((i) => `${i.kind}:${i.uid}`)), [`manifest:${hidden.uid}`, `scanAttack:${gun.uid}`]);
  // A5/F9: a Scan measures from the scanner, never through a Repeater.
  const far = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 2, 11, { statuses: ['camouflage'] });
  droneOn(s, 's1', '165', 2, 6);
  check('A5 a Scan out of its own Range is refused, a Repeater near or not',
    ok(s, { kind: 'startCounterRoll', seat: 's1', uid: gun.uid, actionId: 'COMMON_SCAN', targetUid: far.uid }), false);
  check('A5 while an Electronic Attack at the same unit goes through the Repeater',
    ok(s, { kind: 'startCounterRoll', seat: 's1', uid: gun.uid, actionId: '089_A', targetUid: far.uid }), true);
}
{
  // A4: the Scan Battlefield Scans every enemy it can change, one Counter-roll each.
  const s = table();
  const hyena = droneOn(s, 's1', '080', 2, 2);
  const a = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 3, 2, { statuses: ['camouflage'] });
  const b = put(s, 's2', L({ torso: '094', pilot: 'FPA-01' }), 2, 4, { statuses: ['lowProfile'] });
  put(s, 's2', L({ pilot: 'FPA-01' }), 4, 2);
  check('A4 080_A is a Scan', U.isScanAction(card('080', '080_A')), true);
  check('A4 it names the scannable enemies in Range', U.electronicAllTargets(data, s.tokens, hyena, card('080', '080_A')).map((x) => x.uid), [a.uid, b.uid]);
  send(s, { kind: 'startCounterRoll', seat: 's1', uid: hyena.uid, actionId: '080_A', targetUid: a.uid });
  check('A4 one Counter-roll now, the rest queued', [s.script.counter?.responderUid, s.script.counter?.rest], [a.uid, [b.uid]]);
  send(s, { kind: 'clearCounterRoll', seat: 's1' });
  check('A4 and the next opens as the record clears', [s.script.counter?.responderUid, s.script.counter?.rest], [b.uid, undefined]);
}

// ================= D. Electronic Attacks (4.11) =================
{
  const s = table();
  const al = put(s, 's1', L({ torso: '097' }), 2, 2);
  const foe = put(s, 's2', L({ pilot: 'FPA-01' }), 4, 2, { link: 3 });
  const drone = droneOn(s, 's2', '164', 5, 2);
  const kinds = (a, resp) => U.ewWinCommands(data, al, resp, a).cmds.map((c) => c.kind === 'applyStatus' ? `status:${c.statusId}` : c.kind);
  // D1: the nested effect, named from its Chinese; no Fire Control fallback.
  check('D1 Manipulation Interference gives Immobilized', kinds(card('097', '097_B'), foe), ['status:immobilized']);
  check('D1 the EC50 Pod gives Fire Control Interference', kinds(card('089', '089_A'), foe), ['status:fci']);
  // D2: Scream: -1 Link per success.
  check('D2 Scream drains 1 Link', kinds(card('ZHDR-205', 'ZHDR-205_A'), foe), ['drainLink']);
  // D3: Overload Inject destroys a Drone; The Red Shoes hands over its move.
  check('D3 Overload Inject destroys its target', kinds(card('XTC', 'XTC_A'), drone), ['recordKill']);
  check('D3 The Red Shoes queues control to the Initiator',
    U.ewWinCommands(data, al, foe, card('TM35NA', 'TM35NA_B')).cmds.flatMap((c) => c.items ?? []).map((i) => `${i.kind}:${i.uid}>${i.fromUid}`), [`control:${al.uid}>${foe.uid}`]);
  // D5: only an Electronic Attack, a Scan or Target Tracing opens one, and
  // only at the kinds the card prints.
  check('D5 a Firing Action opens no Counter-roll', ok(s, { kind: 'startCounterRoll', seat: 's1', uid: al.uid, actionId: '041_A', targetUid: foe.uid }), false);
  const missile = droneOn(s, 's2', '075', 3, 3, { kind: 'projectile' });
  check('D5 Manipulation Interference names a Mech or a Drone, not a Projectile',
    [ok(s, { kind: 'startCounterRoll', seat: 's1', uid: al.uid, actionId: '097_B', targetUid: foe.uid }), ok(s, { kind: 'startCounterRoll', seat: 's1', uid: al.uid, actionId: '097_B', targetUid: missile.uid })], [true, false]);
  // D4: a "-" cannot be the Responder (4.11.2, I25).
  const mine = droneOn(s, 's2', '074', 2, 3, { kind: 'projectile' });
  check('D4 the GM-35 Mine prints a dash', U.electronicDash(data, mine), true);
  // Through the EC50 Pod, whose Fire Control Interference names any unit, so
  // only the dash can be what refuses the Mine.
  const pod = put(s, 's1', L({ backpack: '089' }), 2, 6);
  check('D4 and cannot be the Responder of an Action that names any unit',
    [ok(s, { kind: 'startCounterRoll', seat: 's1', uid: pod.uid, actionId: '089_A', targetUid: foe.uid }), ok(s, { kind: 'startCounterRoll', seat: 's1', uid: pod.uid, actionId: '089_A', targetUid: mine.uid })], [true, false]);
}
{
  // D2: Scream on every enemy Mech in Range 4, Strength +1 on the Drone's side.
  const s = table();
  const eagle = droneOn(s, 's1', 'ZHDR-205', 2, 2);
  const a = put(s, 's2', L({ pilot: 'FPA-01' }), 3, 2);
  const b = put(s, 's2', L({ pilot: 'FPA-01' }), 2, 5);
  droneOn(s, 's2', '164', 2, 3);
  put(s, 's2', L({ pilot: 'FPA-01' }), 9, 9);
  const scream = card('ZHDR-205', 'ZHDR-205_A');
  check('D2 Scream names every enemy MECH in Range 4', U.electronicAllTargets(data, s.tokens, eagle, scream).map((x) => x.uid), [a.uid, b.uid]);
  check('D2 with Strength +1 on the Initiator\'s roll',
    U.electronicStrength(data, s.tokens, eagle, 'initiator', scream) - U.electronicStrength(data, s.tokens, eagle, 'initiator'), 1);
  check('D2 and none on the Responder\'s', U.electronicStrength(data, s.tokens, a, 'responder', scream), U.electronicStrength(data, s.tokens, a, 'responder'));
}
{
  // D3: the controlled move spends the debt, costs the target no Tick, and
  // Immobilized still stops it.
  const s = table();
  const al = put(s, 's1', L({ torso: 'TM35NA' }), 2, 2);
  const foe = put(s, 's2', L({ pilot: 'FPA-01' }), 4, 2, { statuses: ['lowProfile'] });
  s.script.reactions = [{ uid: al.uid, actionId: 'TM35NA_B', count: 1, range: 0, kind: 'control', fromUid: foe.uid }];
  const steer = { kind: 'controlledMove', seat: 's1', uid: al.uid, targetUid: foe.uid, to: G(5, 2) };
  check('D3 the controller may move the enemy unit once', ok(s, steer), true);
  send(s, steer);
  check('D3 which moves, sheds its Low Profile, and spends the debt',
    [Math.floor(foe.col / 3), foe.statuses.includes('lowProfile'), s.script.reactions.length], [5, false, 0]);
  check('D3 and cannot move it twice', ok(s, steer), false);
  s.script.reactions = [{ uid: al.uid, actionId: 'TM35NA_B', count: 1, range: 0, kind: 'control', fromUid: foe.uid }];
  foe.statuses = ['immobilized'];
  check('D3 Immobilized still stops it (6.3.2)', ok(s, steer), false);
}
{
  // D7: a Carrier neither counts nor uses its own Load (FAQ O4).
  const s = table();
  const tara = droneOn(s, 's1', '162', 2, 2, { droneBackpack: '089', partStates: { main: 'intact', backpack: 'intact' } });
  check('D7 the Carrier rolls its own Electronic Value alone', U.electronicValue(data, tara), data.byId.get('162').electronic);
  check('D7 and cannot open its Load\'s Electronic Attack', ok(s, { kind: 'startCounterRoll', seat: 's1', uid: tara.uid, actionId: '089_A', targetUid: put(s, 's2', L({ pilot: 'FPA-01' }), 4, 2).uid }), false);
}
{
  // D8: Target Tracing's command spends the Token and says it was the reaction.
  const s = table();
  const hunter = put(s, 's1', L({ torso: '174' }), 2, 2, { statuses: ['command'] });
  const foe = put(s, 's2', L({ pilot: 'FPA-01' }), 20, 20, { link: 3 });
  const trace = { kind: 'startCounterRoll', seat: 's1', uid: hunter.uid, actionId: '174_B', targetUid: foe.uid, reaction: true };
  check('D8 a Mech with ONE Command Token opens the roll', ok(s, trace), true);
  send(s, trace);
  check('D8 the Token is spent by it, and the record keeps the reaction', [hunter.statuses, s.script.counter?.reaction], [['commandUsed'], true]);
  check('D8 and a win takes the attacker\'s Link', U.ewWinCommands(data, hunter, foe, card('174', '174_B'), { reaction: true }).cmds.map((c) => `${c.kind}:${c.n}`), ['drainLink:1']);
}
{
  // D9: the Whistle, the whole board for Focus, Warfare Node with Amplify, ECP10.
  const s = table();
  const whistle = put(s, 's1', L({ backpack: 'ZYBP-202' }), 2, 2, { statuses: ['command'] });
  const raven = droneOn(s, 's1', '166', 3, 3);
  const foe = put(s, 's2', L({ pilot: 'FPA-01' }), 5, 3);
  s.script.counter = { initiatorUid: raven.uid, responderUid: foe.uid, actionId: '166_A', initRoll: [0], respRoll: [0], initFocused: false, respFocused: false, initDeclare: null, respDeclare: null, provoke: null };
  check('D9 a Drone with a Whistle Mech in Range declares first', U.counterStage(data, s.tokens, s.script.counter), 'declareI');
  const blow = { kind: 'declareCounterFocus', seat: 's1', uid: raven.uid, use: true, whistleUid: whistle.uid };
  check('D9 and may reroll on its Command Token', ok(s, blow), true);
  send(s, blow);
  check('D9 which the Whistle Mech pays', whistle.statuses, ['commandUsed']);
  const aurora = put(s, 's1', L({ torso: '018', pilot: 'FPA-06' }), 10, 10);
  const ally = put(s, 's1', L(), 15, 10);
  check('D9 Warfare Node reaches one further with KeyHole aboard (Amplify)', !!U.warfareNodeBoost(data, s.tokens, ally), true);
  aurora.mech = { ...aurora.mech, pilot: 'FPA-04-2' };
  check('D9 and not without', !!U.warfareNodeBoost(data, s.tokens, ally), false);
  const dog = put(s, 's1', L({ backpack: 'ECP10' }), 3, 5);
  check('F18 ECP10 makes a Drone Responder Offensive too', U.counterOffensive(data, s.tokens, raven, foe, 'responder'), true);
  dog.col = G(12, 12).col;
  check('F18 and not out of its Range', U.counterOffensive(data, s.tokens, raven, foe, 'responder'), false);
}
{
  // D10/F16: Yoyu Provokes in either role (4.11.2).
  const s = table();
  const yoyu = put(s, 's1', L({ pilot: 'LPA-22' }), 2, 2, { stance: 'defensive' });
  const foe = put(s, 's2', L({ pilot: 'FPA-01' }), 4, 2, { stance: 'defensive' });
  const c = { initiatorUid: yoyu.uid, responderUid: foe.uid, actionId: 'COMMON_SCAN', initRoll: [0], respRoll: [0], initFocused: false, respFocused: false, initDeclare: false, respDeclare: false, provoke: null };
  s.script.counter = c;
  check('F16 Yoyu that wins as Initiator is offered it', U.provokeOffer(data, s.tokens, c, true)?.target?.uid, foe.uid);
  check('F16 and the command takes it', ok(s, { kind: 'provoke', seat: 's1', uid: yoyu.uid, targetUid: foe.uid, take: true }), true);
  check('F16 Yoyu that loses as Initiator is offered nothing', U.provokeOffer(data, s.tokens, c, false), null);
}

// ================= E. Highlight (6.2.1; FAQ J3, J12, J18) =================
{
  const s = table();
  const gun = put(s, 's1', L(), 2, 2);
  const lit = put(s, 's2', L({ pilot: 'FPA-01' }), 4, 2, { statuses: ['highlight'] });
  const plain = put(s, 's2', L({ pilot: 'FPA-01' }), 3, 3);
  const decoy = droneOn(s, 's2', '076', 5, 5, { kind: 'projectile' });
  check('E3 a Highlight Token or a card that prints it (FAQ J3)', [U.hasHighlight(data, s.tokens, lit), U.hasHighlight(data, s.tokens, decoy), U.hasHighlight(data, s.tokens, plain)], [true, true, false]);
  check('E1 a Firing Action must take the Highlighted', U.highlightTargets(data, s.tokens, card('058', '058_A'), [lit, plain]).map((x) => x.uid), [lit.uid]);
  check('F15 a Melee one is not bound (FAQ J18)', U.highlightTargets(data, s.tokens, card('041', '041_B'), [lit, plain]), []);
  droneOn(s, 's2', '072', 4, 3, { kind: 'projectile' });
  check('E4 an aura\'s Low Profile with Highlight: neither applies (FAQ J12)', U.hasHighlight(data, s.tokens, lit), false);
  // E2: Target Tag's picker: no Low Value Unit, no camouflaged unit.
  const tagger = droneOn(s, 's1', 'PRDR-202', 2, 6);
  const tag = card('PRDR-202', 'PRDR-202_A');
  const grant = U.targetStatusGrant(tag);
  const hidden = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 3, 6, { statuses: ['camouflage'] });
  const pool = U.targetStatusTargets(data, s.tokens, tagger, tag, grant).map((x) => x.uid);
  check('E2 Target Tag gives Highlight', grant?.statusId, 'highlight');
  check('E2 and its picker offers neither a camouflaged unit nor a Low Value Unit',
    [pool.includes(hidden.uid), pool.includes(decoy.uid), pool.includes(plain.uid)], [false, false, true]);
  // G5/J18: an Automatic Electronic Attack takes the nearest, Highlight or not.
  const raven = droneOn(s, 's1', '166', 2, 9);
  const near = put(s, 's2', L({ pilot: 'FPA-01' }), 3, 9);
  put(s, 's2', L({ pilot: 'FPA-01' }), 2, 11, { statuses: ['highlight'] });
  check('D9 an Automatic Electronic Attack takes the nearest, Highlight or not',
    U.autoTargetsFor(data, s.tokens, raven, card('166', '166_A')).map((x) => x.uid), [near.uid]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

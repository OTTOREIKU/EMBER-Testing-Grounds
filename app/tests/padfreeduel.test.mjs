// PAD PLAYTEST FIXES, BATCH 2 (OTTO, 2026-11-18): a Freeform ROOM plays an
// attack and an Electronic Counter-roll on both phones, as a Guided game does.
//
// From the playtest: once the table went to Freeform "the combat resolutions
// were only on the screen of the attacker", and an EC roll waited for a
// defence roll the defender's phone never asked for. OTTO picked "like Guided,
// both phones play". A Freeform pad table has no script on purpose (a script is
// the Guided loop), so the record both phones share lives on `state.duel`
// there (commands.ts duelOf). A table with no seat (the sandbox, one phone)
// still keeps neither.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, mech } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('PAD playtest fixes, batch 2: Freeform attacks and EC rolls on both phones\n');

installDom();
const { data, mod } = await loadCombat('padfreeduel', [], [
  "export { check as checkCmd, apply as applyCmd, duelOf } from '../src/commands';",
  "export { setLocalSeat } from '../src/loop';",
  "export { migrateState } from '../src/units';",
  "export { initAttack, mountAttack, syncMirror } from '../pad/attack';",
  "export { initEw, beginElectronic } from '../pad/ew';",
]);

const rifle = data.cards.find((c) => c.id === 'ZHRA-201');
const firing = rifle?.actions?.find((a) => a.id === 'ZHRA-201_B');
const torso = data.cards.find((c) => c.type === 'torso');
const chasis = data.cards.find((c) => c.type === 'chasis');
const kit = (t, hand) => {
  t.mech = { torso: torso.id, chasis: chasis.id, rightHand: hand ?? '', leftHand: '', backpack: '', pilot: '' };
  return t;
};
const freeform = () => ({
  v: 3, map: '', tokens: [kit(mech(1, 's1', 'Attacker', 1), rifle.id), kit(mech(2, 's2', 'Defender', 3))],
  nextUid: 3, round: { n: 1, phase: 2, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 }, markers: [], smoke: [],
  removedTerrain: [], tactics: { s1: [], s2: [] }, tacticsPlayed: { s1: [], s2: [] }, noBoard: true, setup: null,
});
const ok = (s, cmd) => mod.checkCmd(data, s, cmd).ok;
const call = { kind: 'callDefense', seat: 's1', uid: 1, targetUid: 2, actionId: firing.id, white: 2, blue: 1 };

// ---------- the sandbox and one phone: unchanged ----------
{
  mod.setLocalSeat(null);
  const s = freeform();
  check('a table with no seat still has no defence handshake', ok(s, call), false);
  mod.applyCmd(data, s, { kind: 'setCombatView', seat: 's1', view: { attackerUid: 1, targetUid: 2, actionId: firing.id, mode: 'attack', step: 'attack', targetPart: null, attack: null, defense: null, log: [] } });
  check('and keeps no shared record', s.duel ?? null, null);
}

// ---------- a Freeform room: the Guided handshake, on its own record ----------
{
  mod.setLocalSeat('s1');
  const s = freeform();
  check('there is no script, as a Freeform pad table never has one', s.script ?? null, null);
  check('the attacker may ask the defender for their roll', ok(s, call), true);
  mod.applyCmd(data, s, call);
  check('the ask is kept on the room\'s record', s.duel?.combat?.targetUid, 2);
  check('and read through the one door', mod.duelOf(s) === s.duel, true);
  check('a second ask while one waits is refused', ok(s, call), false);
  const answer = { kind: 'answerDefense', seat: 's2', faces: [{ color: 'white', face: 1 }, { color: 'white', face: 2 }, { color: 'blue', face: 0 }] };
  check('only the defending squad answers', ok(s, { ...answer, seat: 's1' }), false);
  check('the defender answers from their own phone', ok(s, answer), true);
  mod.applyCmd(data, s, answer);
  check('their faces land on the record', s.duel.combat.faces?.length, 3);
  mod.applyCmd(data, s, { kind: 'clearDefense', seat: 's1' });
  check('and the attacker clears it', s.duel.combat, null);
  for (const k of ['focusAnswer', 'meleeEvade', 'dodgeEnhance', 'kcArmor']) {
    const cmd = k === 'focusAnswer' ? { kind: k, seat: 's2', use: true } : { kind: k, seat: 's2' };
    check(`the defender's ${k} is accepted in a Freeform room`, ok(s, cmd), true);
  }
  const view = { attackerUid: 1, targetUid: 2, actionId: firing.id, mode: 'attack', step: 'attack', targetPart: null, attack: null, defense: null, log: ['Line'] };
  check('the attacker publishes the window', ok(s, { kind: 'setCombatView', seat: 's1', view }), true);
  mod.applyCmd(data, s, { kind: 'setCombatView', seat: 's1', view });
  check('and the other phone holds it', s.duel.combatView?.attackerUid, 1);
  mod.applyCmd(data, s, { kind: 'setCombatView', seat: 's1', view: null });
  check('until it is taken back', s.duel.combatView, null);

  // The Counter-roll record, the same way.
  check('no Counter-roll is open to clear yet', ok(s, { kind: 'clearCounterRoll', seat: 's1' }), false);
  mod.applyCmd(data, s, { kind: 'startCounterRoll', seat: 's1', uid: 1, actionId: firing.id, targetUid: 2 });
  check('an Electronic Counter-roll opens on the room\'s record', [s.duel.counter?.initiatorUid, s.duel.counter?.responderUid], [1, 2]);
  check('so a second one is refused while it runs', ok(s, { kind: 'startCounterRoll', seat: 's1', uid: 1, actionId: firing.id, targetUid: 2 }), false);
  mod.applyCmd(data, s, { kind: 'rollCounter', seat: 's2', uid: 2, faces: [1, 2] });
  check('the Responder\'s own roll lands on it', s.duel.counter.respRoll, [1, 2]);
  check('and the Initiator closes it', ok(s, { kind: 'clearCounterRoll', seat: 's1' }), true);
  mod.applyCmd(data, s, { kind: 'clearCounterRoll', seat: 's1' });
  check('closed', s.duel.counter, null);

  // Nothing survives a phase turn, as in a Guided game.
  mod.applyCmd(data, s, call);
  mod.applyCmd(data, s, { kind: 'startCounterRoll', seat: 's1', uid: 1, actionId: firing.id, targetUid: 2 });
  mod.applyCmd(data, s, { kind: 'advancePhase', seat: 's1' });
  check('a phase turn clears a stranded attack and Counter-roll', [s.duel.combat, s.duel.combatView, s.duel.counter], [null, null, null]);
}

// ---------- a phone that rejoins mid-attack (PAD playtest check 2.1, 2026-11-20) ----------
// A late joiner is handed the whole table through migrateState, which rebuilds
// it from a whitelist: the room's record was dropped there, and the old
// colour-to-side rename turned the call's `blue` pool into a side id, so the
// defender's phone never saw the call and the attacker waited for good.
{
  mod.setLocalSeat('s1');
  const s = freeform();
  const view = { attackerUid: 1, targetUid: 2, actionId: firing.id, mode: 'attack', step: 'defense', targetPart: null, attack: null, defense: null, log: ['Line'] };
  mod.applyCmd(data, s, { kind: 'setCombatView', seat: 's1', view });
  mod.applyCmd(data, s, call);
  const back = mod.migrateState(JSON.parse(JSON.stringify(s)), data);
  // As the pad reads a checkpoint (pad.ts migrated): a table that came without a script stays without one.
  back.script = undefined;
  check('a rejoining phone keeps the waiting defence call', [back.duel?.combat?.targetUid, back.duel?.combat?.white, back.duel?.combat?.blue], [2, 2, 1]);
  check('and the attacker\'s published window', back.duel?.combatView?.attackerUid, 1);
  check('so the defender may still answer', ok(back, { kind: 'answerDefense', seat: 's2', faces: [{ color: 'white', face: 1 }] }), true);
  mod.applyCmd(data, s, { kind: 'answerDefense', seat: 's2', faces: [{ color: 'blue', face: 0 }, { color: 'white', face: 2 }] });
  const rolled = mod.migrateState(JSON.parse(JSON.stringify(s)), data);
  check('Blue defence faces keep their colour through a rejoin', rolled.duel?.combat?.faces?.map((f) => f.color), ['blue', 'white']);
  const guided = { ...JSON.parse(JSON.stringify(freeform())), script: { combat: { attackerUid: 1, targetUid: 2, actionId: firing.id, white: 2, blue: 1, faces: null } } };
  check('a Guided game\'s waiting defence call survives a rejoin too', mod.migrateState(guided, data).script?.combat?.blue, 1);
  check('an old colour-named save still reads its sides', mod.migrateState({ ...JSON.parse(JSON.stringify(freeform())), round: { n: 1, phase: 2, firstPlayer: 'red' } }, data).round.firstPlayer, 's2');
  check('a table that never had the record still has none', 'duel' in mod.migrateState(JSON.parse(JSON.stringify(freeform())), data), false);
  check('a malformed record reads back empty', mod.migrateState({ ...JSON.parse(JSON.stringify(freeform())), duel: { combat: 'x', combatView: 7, counter: [] } }, data).duel, { combat: null, combatView: null, counter: null });
}

// ---------- the pad's glue: the defender is asked on their own phone ----------
{
  mod.setLocalSeat('s1');
  const s = freeform();
  const sent = [];
  let opened = 0;
  const api = (me) => ({
    data, state: () => s, me: () => me, solo: false, inRoom: () => true,
    send: (cmd) => { sent.push(cmd); return true; }, check: () => ({ ok: true }), toast() {}, render() {},
    openCombat() { opened++; }, closeCombat() {}, combatOpen: () => false,
    rollDice: async () => ({ dice: [], handsOff: false }), blackDie: () => null, confirmCancel: async () => true,
  });
  mod.initAttack(api('s1'));
  const h = mod.mountAttack(makeEl('div'));
  const atk = s.tokens[0], def = s.tokens[1];
  void h.defenseRoller({ white: 2, blue: 0 }, atk, def, firing.id);
  check('in a Freeform room the attacker\'s phone asks the defender instead of rolling for them', sent.map((c) => c.kind), ['callDefense']);

  // The defender's phone draws the attacker's window.
  s.duel = { combat: null, combatView: { attackerUid: 1, targetUid: 2, actionId: firing.id, mode: 'attack', step: 'attack', targetPart: null, attack: null, defense: null, log: [] }, counter: null };
  mod.initAttack(api('s2'));
  mod.syncMirror();
  check('and the defender\'s phone opens it', opened > 0, true);

  // An Electronic Attack opens the shared record rather than a one-phone exchange.
  sent.length = 0;
  mod.initEw({ ...api('s1'), rollFaces: async () => [] });
  mod.beginElectronic(atk, firing.id, def);
  check('an EC roll in a Freeform room opens on both phones', sent.map((c) => c.kind), ['startCounterRoll']);
  sent.length = 0;
  mod.initEw({ ...api('s1'), solo: true, rollFaces: async () => [] });
  mod.beginElectronic(atk, firing.id, def);
  check('while one phone holding both squads keeps its own exchange', sent.map((c) => c.kind), []);
}

// ---------- read: what stays on one phone, and why ----------
{
  const ew = readFileSync(new URL('../pad/ew.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fn = (name) => ew.slice(ew.indexOf(`export function ${name}(`), ew.indexOf('\n}\n', ew.indexOf(`export function ${name}(`)));
  check('EC rolls and Remote Access share the record in a Freeform room', ['beginElectronic', 'beginElectronicAll', 'beginTerminal'].every((n) => fn(n).includes('if (shared())')), true);
  check('the free Scan, a Projectile\'s Scan and Target Tracing still need a Guided game to share', ['beginFreeScan', 'beginBlastScan', 'beginTrace'].every((n) => fn(n).includes('a.state().script && !a.solo')), true);
}

mod.setLocalSeat(null);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

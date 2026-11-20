// PAD PLAYTEST FIXES, BATCH 4 (OTTO, 2026-11-18/19): GoF HALO, Command
// Coordination and the game record, looked at in Guided and in Freeform.
//
// 2.6 Command Coordination was never offered after an attack or a launch (the
//     pad offered it only after the Actions guided.ts routes itself), so the
//     MR21/MR24 Railguns, the Swift and Mortar launchers and the P7 core's
//     Melee grant never came up. HALO's paid declares vanished without a word
//     when the Mech had no face-up Command Token.
// 2.7 Game over and Concede needed the Guided setup, which switching to
//     Freeform drops, so such a game could not be ended and logged.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, mech } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (text, head) => {
  const i = text.indexOf(head);
  return i < 0 ? '' : text.slice(i, text.indexOf('\n}\n', i));
};

console.log('PAD playtest fixes, batch 4: HALO, Command Coordination, the game record\n');

installDom();
const { data, mod } = await loadCombat('padrules4', [], [
  "export { check as checkCmd, apply as applyCmd, gameRunning } from '../src/commands';",
  "export { haloWithoutToken, coordinationFor, dodgeEnhanceOf } from '../src/units';",
]);

const torso = data.cards.find((c) => c.type === 'torso');
const chasis = data.cards.find((c) => c.type === 'chasis');
const kit = (t, slots) => { t.mech = { torso: torso.id, chasis: chasis.id, rightHand: '', leftHand: '', backpack: '', pilot: '', ...slots }; return t; };

// ---------- 2.6 HALO says why it is missing ----------
{
  const halo = kit(mech(1, 's2', 'Halo', 1), { backpack: 'ZYBP-302' });
  check('HALO with no Command Token says so, naming both declares', mod.haloWithoutToken(data, halo), 'HALO: Halo has no face-up Command Token, so Dodge Enhancement and Melee Evasion cannot be used. Keep one back in the Command Phase to use them (4.15.4).');
  halo.statuses = ['command'];
  check('with a face-up Command Token there is nothing to say', mod.haloWithoutToken(data, halo), null);
  const mp = kit(mech(2, 's2', 'MP', 1), { backpack: 'ZYBP-302-MP' });
  if (data.byId.get('ZYBP-302-MP')) {
    check('the mass-production HALO names only the Melee Evasion that still pays', mod.haloWithoutToken(data, mp), 'HALO: MP has no face-up Command Token, so Melee Evasion cannot be used. Keep one back in the Command Phase to use it (4.15.4).');
    check('and its Dodge Enhancement is free', mod.dodgeEnhanceOf(data, mp), { free: true });
  }
  const shut = kit(mech(3, 's2', 'Off', 1), { backpack: 'ZYBP-302' });
  shut.stance = 'shutdown';
  check('a Shutdown Mech uses no Passive, so it is not said', mod.haloWithoutToken(data, shut), null);
  check('a Mech without HALO has nothing said', mod.haloWithoutToken(data, kit(mech(4, 's2', 'Plain', 1))), null);
  const c = src('src/combat.ts');
  check('the defence step draws the line', c.includes("p.dataset.note = 'halo-idle'"), true);
  check('a free Dodge Enhancement is not logged as spending a Command Token', c.includes('(ZYBP-302-MP, no Command Token)'), true);
}

// ---------- 2.6 Command Coordination after an attack or a launch ----------
{
  const rg = data.cards.find((x) => x.id === 'ZHRA-201');
  const shot = rg.actions.find((a) => a.type === 'Firing');
  const gunner = kit(mech(5, 's1', 'Gunner', 1), { rightHand: 'ZHRA-201' });
  check('the MR21 Railgun\'s shot carries Command Coordination 1', mod.coordinationFor(data, gunner, shot), 1);
  const p = src('pad/pad.ts');
  check('a paid Action is held for Coordination, Guided', body(p, 'function send(cmd: Command)').includes("if (cmd.kind === 'performAction') holdCoordination(unitOf(cmd.uid), cmd.actionId);"), true);
  check('and Freeform', body(p, 'function spendFree(').includes('if (paid) holdCoordination(t, actionId);'), true);
  const hold = body(p, 'function holdCoordination(');
  check('only attacks and launches are held (guided.ts offers the rest itself)', hold.includes("a.type !== 'Firing' && a.type !== 'Melee' && a.type !== 'Projectile'"), true);
  const due = body(p, 'function coordinationDue(');
  check('it waits while the attack window or a question is up', due.includes("panel === 'combat'") && due.includes(".dlg-back"), true);
  check('a Riposte owed is answered first (FAQ C7)', due.includes("r.kind === 'riposte'"), true);
  check('an Opportunity a Riposte ended skips it, saying so (FAQ C8)', due.includes('FAQ C8'), true);
  check('no Command Token left is said, not silent', due.includes('no face-up Command Token left to issue'), true);
  check('no Drone able to take one is said too', due.includes('no Ally Drone on the table can take a Command'), true);
  check('settled on every redraw', p.includes('queueMicrotask(settleCoordination);'), true);
}

// ---------- 2.6 Freeform deals Command Tokens (OTTO, 2026-11-19) ----------
{
  const table = (phase, extra = {}) => ({ v: 3, map: '', tokens: [kit(mech(1, 's1', 'A', 1)), kit(mech(2, 's2', 'B', 3))], nextUid: 3, round: { n: 2, phase, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 }, markers: [], smoke: [], removedTerrain: [], tactics: { s1: [], s2: [] }, tacticsPlayed: { s1: [], s2: [] }, noBoard: true, setup: null, ...extra });
  const deal = { kind: 'dealCommands', seat: 's1' };
  const s = table(0);
  check('a Freeform table may deal as its Command Phase opens', mod.checkCmd(data, s, deal).ok, true);
  mod.applyCmd(data, s, deal);
  check('every Mech gets its Command Token face-up', s.tokens.map((t) => (t.statuses ?? []).filter((x) => x === 'command').length), [1, 1]);
  check('and the pool counts them', s.commandTokens, { s1: 1, s2: 1 });
  check('once a round', mod.checkCmd(data, s, deal).ok, false);
  check('only as the Command Phase opens', mod.checkCmd(data, table(2), deal).ok, false);
  check('never in a Guided game, which deals its own', mod.checkCmd(data, table(0, { script: {} }), deal).ok, false);
  check('not before both squads are on the table', mod.checkCmd(data, { ...table(0), tokens: [kit(mech(1, 's1', 'A', 1))] }, deal).ok, false);
  const p = src('pad/pad.ts');
  const fn = body(p, 'function dealCommands(');
  check('one phone deals for the table: the host, or an Offline Game\'s phone', fn.includes('if (!solo && !(view.room && view.host)) return;'), true);
  check('dealt on the redraw, as the phase opens', p.includes('queueMicrotask(dealCommands);'), true);
  check('the round it was dealt survives a reload', src('src/units.ts').includes('commandsDealt: (s as { commandsDealt: number }).commandsDealt'), true);
}

// ---------- 2.7 the game record ----------
{
  const freeform = (tokens) => ({ v: 3, map: '', tokens, nextUid: 9, round: { n: 2, phase: 2, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 }, markers: [], smoke: [], removedTerrain: [], tactics: { s1: [], s2: [] }, tacticsPlayed: { s1: [], s2: [] }, noBoard: true, setup: null });
  const both = freeform([mech(1, 's1', 'A', 1), mech(2, 's2', 'B', 3)]);
  check('a Freeform table with a Mech on each side is a game running', mod.gameRunning(both), true);
  check('an empty table is not', mod.gameRunning(freeform([])), false);
  check('one squad alone is not', mod.gameRunning(freeform([mech(1, 's1', 'A', 1)])), false);
  check('a Freeform game, or one switched from Guided, can be conceded', mod.checkCmd(data, both, { kind: 'concede', seat: 's2' }).ok, true);
  check('an empty table still cannot', mod.checkCmd(data, freeform([]), { kind: 'concede', seat: 's2' }).ok, false);
  const p = src('pad/pad.ts');
  check('Game over is offered whenever a game is under way', p.includes('${gameUnderway() && !complete() ? `<button class="pad-btn primary" data-act="game-over"'), true);
  check('and Concede', p.includes("${gameUnderway() && !gameOver() ? '<button class=\"pad-btn\" data-act=\"concede\""), true);
  check('a table waiting to start its Guided game is not under way', body(p, 'function gameUnderway(').includes('wantsGuided() && !guidedOn(table)'), true);
  check('the player is told before the end whether the game will be logged', p.includes('data-note="log-plan"') && body(p, 'function logPlanNote(').includes('Game logging is off, so this game will not be logged.'), true);
  const leave = body(p, 'async function leaveOk(');
  check('leaving a started, unfinished game offers Game over first', leave.includes("{ id: 'over', label: 'Game over, log it', primary: true }"), true);
  check('Leave, Close the table and Leave the game all ask it', (p.match(/(?:await|void) leaveOk\(\)/g) ?? []).length, 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// PAD PLAYTEST FIXES, BATCH 1 (OTTO, 2026-11-18): the two phones' screens.
//
// From two playtests: the "Attack resolved" box only ever showed for the
// attacker; an attack popup sometimes stayed open on one phone after the
// attack was over; an EC roll once left the whole PAD screen blank; and in a
// Freeform room the order menu never had the other player's dials.
//
// What is DRIVEN here: the real AttackHelper (through the DOM shim), the real
// command layer's check() and apply(), and the pad's own attack.ts glue. What
// is only READ: the two pad.ts render hooks, because pad.ts boots a whole page
// the moment it loads. The manual checklist in Project-Documents covers those
// on two real phones (PAD-PLAYTEST-FIXES.md, Batch 1).
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('PAD playtest fixes, batch 1: both phones see the same thing\n');

installDom();
const { AttackHelper, data, dice, mod } = await loadCombat('padcombatsync', [], [
  "export { check as checkCmd, apply as applyCmd } from '../src/commands';",
  "export { initAttack, mountAttack, sweepView, attackFinished } from '../pad/attack';",
]);

let __seed = 20261118;
Math.random = () => { __seed = (__seed * 1103515245 + 12345) % 2147483648; return __seed / 2147483648; };

const rifle = data.cards.find((c) => c.id === 'ZHRA-201');
const firing = rifle?.actions?.find((a) => a.id === 'ZHRA-201_B');
const torso = data.cards.find((c) => c.type === 'torso'
  && !(c.actions ?? []).some((a) => (a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => /defender_designate/.test(e.type ?? '')))));
const chasis = data.cards.find((c) => c.type === 'chasis');
const kit = (t, hand) => {
  t.mech = { torso: torso.id, chasis: chasis.id, rightHand: hand ?? '', leftHand: '', backpack: '', pilot: '' };
  return t;
};
check('the fixture weapon is still on its card', !!firing, true);

const texts = (root) => {
  const out = [];
  const walk = (el) => {
    if (!el) return;
    if (el.innerHTML) out.push(String(el.innerHTML));
    if (el.textContent) out.push(String(el.textContent));
    for (const c of el.children ?? []) walk(c);
  };
  walk(root);
  return out.join(' ');
};
const press = (root, want) => {
  const b = findButtons(root).find((x) => label(x).includes(want));
  if (!b) throw new Error(`no control matching ${want}`);
  b.click();
  return b;
};

// ---------- 1.3: the "Attack resolved" box reaches the other phone ----------
{
  const atk = kit(mech(1, 's1', 'Attacker', 1), rifle.id);
  const def = kit(mech(2, 's2', 'Defender', 3));
  const all = [atk, def];
  const root = makeEl('div');
  const views = [];
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => ({ ok: true }));
  h.tokens = () => all;
  h.terrain = () => [];
  h.smoke = () => [];
  h.publishView = (v) => { if (v) views.push(JSON.parse(JSON.stringify(v))); };
  h.start(atk, firing, def, 'Line of sight is clear.');
  h.pickPart('torso');
  press(root, 'Roll attack dice');
  await settle();
  press(root, 'Continue to Defense');
  h.ctx.defensePool = { white: 1, blue: 0 };
  press(root, 'Roll defense dice');
  await settle();
  for (let i = 0; i < 4 && findButtons(root).some((b) => label(b) === 'Pass'); i++) press(root, 'Pass');
  press(root, 'Resolve');
  // An attack with no Penetration still ends through finish(); one with one
  // asks for it to be applied first.
  if (findButtons(root).some((b) => label(b).includes('Apply Penetration'))) { press(root, 'Apply Penetration'); await settle(); }
  const done = findButtons(root).find((b) => label(b) === 'Done');
  check('the attack reached its "Attack resolved" box', !!done, true);
  const last = views.at(-1);
  check('the last view it published carries the summary', !!last?.summary, true);
  check('naming who attacked whom', String(last?.summary?.head ?? '').includes('Attacker to Defender'), true);
  check('with the plain lines of the box (no markup)', (last?.summary?.lines ?? []).length > 0 && !(last?.summary?.lines ?? []).some((l) => /</.test(l)), true);
  check('the window is no longer live, but says its summary is up', [h.active, h.finishedShown], [false, true]);
  done?.click();
  check('Done puts the summary away', h.finishedShown, false);

  // The defender's phone draws it from that view.
  const wroot = makeEl('div');
  let closed = 0;
  const w = new AttackHelper(data, dice, wroot, () => {}, () => { closed++; }, () => {}, () => {}, () => {}, () => {}, () => {});
  w.tokens = () => all;
  w.terrain = () => [];
  w.smoke = () => [];
  w.showMirror(last, atk, def, firing, 'defender');
  check('the defender sees "Attack resolved"', texts(wroot).includes('Attack resolved'), true);
  check('with the same lines', last.summary.lines.every((l) => texts(wroot).includes(l.replace(/&/g, '&amp;').replace(/</g, '&lt;')) || texts(wroot).includes(l)), true);
  check('and it counts as being watched, so the pad keeps the panel up', w.watching, true);
  press(wroot, 'Close');
  check('Close puts it away', [w.watching, closed], [false, 1]);
  w.showMirror(last, atk, def, firing, 'defender');
  check('and it stays away while that summary is still published', w.watching, false);
  const next = { ...last, summary: null, step: 'attack', attack: null, defense: null, resolution: null, log: [], logStep: [] };
  w.showMirror(next, atk, def, firing, 'defender');
  check('the next attack still opens on the defender\'s phone', w.watching && !findButtons(wroot).some((b) => label(b) === 'Close'), true);

  // A watcher who closed the window MID-attack still gets the outcome.
  const w2root = makeEl('div');
  const w2 = new AttackHelper(data, dice, w2root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  w2.tokens = () => all;
  w2.terrain = () => [];
  w2.smoke = () => [];
  w2.showMirror(next, atk, def, firing, 'defender');
  w2.dismissMirror();
  w2.showMirror(last, atk, def, firing, 'defender');
  check('a defender who closed the fight still sees how it ended', texts(w2root).includes('Attack resolved'), true);
}

// ---------- the command layer carries the summary, and refuses junk ----------
const tableState = (over = {}) => ({
  v: 3, map: '', tokens: [kit(mech(1, 's1', 'A', 1), rifle.id), kit(mech(2, 's2', 'B', 3)), kit(mech(3, 's2', 'C', 5))],
  nextUid: 4, round: { n: 1, phase: 2, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 }, markers: [], smoke: [],
  removedTerrain: [], tactics: { s1: [], s2: [] }, tacticsPlayed: { s1: [], s2: [] }, noBoard: true, setup: null, ...over,
});
{
  const s = tableState({ script: {} });
  const view = { attackerUid: 1, targetUid: 2, actionId: firing.id, mode: 'attack', step: 'resolve', targetPart: 'torso', attack: null, defense: null, log: ['x'], summary: { head: 'A to B', lines: ['3 damage icons'] } };
  check('a view with a summary is accepted', mod.checkCmd(data, s, { kind: 'setCombatView', seat: 's1', view }).ok, true);
  check('a summary that is not text is refused', mod.checkCmd(data, s, { kind: 'setCombatView', seat: 's1', view: { ...view, summary: { head: 'x', lines: [{}] } } }).ok, false);
  check('as is a summary of 1000 lines', mod.checkCmd(data, s, { kind: 'setCombatView', seat: 's1', view: { ...view, summary: { head: 'x', lines: Array(1000).fill('y') } } }).ok, false);
  mod.applyCmd(data, s, { kind: 'setCombatView', seat: 's1', view });
  check('applied, it is kept on the shared record', s.script.combatView?.summary, { head: 'A to B', lines: ['3 damage icons'] });
  check('as a copy, not the sender\'s own object', s.script.combatView.summary !== view.summary, true);
}

// ---------- 1.4: Freeform dials, shown once Planning is over ----------
{
  const show = (seat, dials) => ({ kind: 'showTimings', seat, dials });
  const timing = 'firing';
  const planning = tableState({ round: { n: 1, phase: 1, firstPlayer: 's1' } });
  check('not during the Planning Phase', mod.checkCmd(data, planning, show('s2', [{ uid: 2, timing }])).ok, false);
  const s = tableState();
  const ok = mod.checkCmd(data, s, show('s2', [{ uid: 2, timing }, { uid: 3, timing: undefined }]));
  check('a squad shows its own dials in the Action Phase', ok.ok, true);
  check('never the other squad\'s', mod.checkCmd(data, s, show('s2', [{ uid: 1, timing }])).ok, false);
  check('and never a Timing that does not exist', mod.checkCmd(data, s, show('s2', [{ uid: 2, timing: 'warp' }])).ok, false);
  mod.applyCmd(data, s, show('s2', [{ uid: 2, timing }]));
  check('applied, the other phone has the dial', s.tokens.find((t) => t.uid === 2).timing, timing);
  check('and nothing else changed', s.tokens.find((t) => t.uid === 1).timing, undefined);
}

// ---------- 1.2: the attacking phone takes its view back ----------
{
  const s = tableState({ script: { combatView: { attackerUid: 1, targetUid: 2, actionId: firing.id, mode: 'attack', step: 'resolve', targetPart: null, attack: null, defense: null, log: [] } } });
  const sent = [];
  let open = true;
  mod.initAttack({
    data, state: () => s, me: () => 's1', solo: false, inRoom: () => true,
    send: (cmd) => { sent.push(cmd); return true; }, check: () => ({ ok: true }), toast() {}, render() {},
    openCombat() {}, closeCombat() {}, combatOpen: () => open,
    rollDice: async () => ({ dice: [], handsOff: false }), blackDie: () => null, confirmCancel: async () => true,
  });
  const helper = mod.mountAttack(makeEl('div'));
  mod.sweepView();
  check('a view nobody is driving any more is taken back', sent.map((c) => [c.kind, c.view]), [['setCombatView', null]]);
  sent.length = 0;
  helper.summaryHeld = true;
  check('the pad can tell its summary is up', mod.attackFinished(), true);
  mod.sweepView();
  check('but not while this phone still shows the "Attack resolved" box', sent.length, 0);
  open = false;
  mod.sweepView();
  check('closing the panel takes it back', sent.map((c) => [c.kind, c.view]), [['setCombatView', null]]);
}

// ---------- the pad's render hooks (read, not driven) ----------
{
  const pad = readFileSync(new URL('../pad/pad.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const branch = pad.slice(pad.indexOf("  if (panel === 'combat') {\n    if (paint('pad-panel', combatPanel()))"), pad.indexOf('  } else if (panel) {'));
  check('1.2: the combat panel\'s own redraw takes back a stale view too', /syncMirror\(\); sweepView\(\);/.test(branch), true);
  check('1.1: and closes an empty panel', branch.includes('guardEmptyCombat()'), true);
  const guard = pad.slice(pad.indexOf('function combatIdle'), pad.indexOf('// FREEFORM DIALS'));
  check('1.1: empty means no attack, mirror, summary or Counter-roll', ['attackActive()', 'attackWatching()', 'attackFinished()', 'ewActive()', 'ewWatching()'].every((x) => guard.includes(x)), true);
  check('1.1: and only after the moment a window takes to start', /setTimeout\([\s\S]*combatIdle\(\)/.test(guard), true);
  const share = pad.slice(pad.indexOf('function shareDials'), pad.indexOf('// ---------- wiring'));
  check('1.4: dials are shown only in a Freeform room, after Planning', ['view.room', 'guidedOn(table)', 'table.round.phase < 2'].every((x) => share.includes(x)), true);
  check('1.4: checked before sending, so a refusal is not repeated every redraw', /check\(data, table, cmd\)\.ok\) send\(cmd\)/.test(share), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

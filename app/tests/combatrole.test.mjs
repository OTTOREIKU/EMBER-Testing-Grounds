// The combat renderer's ROLE, which is a permission model and not a display
// flag (Project-Documents/COMBAT-PANEL-REDESIGN.md, "Ratified: ONE renderer
// with a ROLE", OTTO 2026-08-19).
//
// Two halves, and both DRIVE the real thing rather than reading its source.
//
//   1. combatRoleFor, the one derivation. The four ratified constraints are
//      each a future bug if broken, and each has an assertion here that a
//      plausible wrong implementation fails.
//   2. AttackHelper.render() under each role, through the same DOM harness
//      rejoin.test.mjs uses. The safety property of this slice is that the
//      FREEPLAY board, which is single-player and always the attacker, comes
//      out unchanged: one player presses every button there and must not
//      notice that roles exist at all.
//
// Note on the harness: makeEl().click() fires the handlers whatever `disabled`
// says, because the shim is not a browser. That is what lets ONE script walk
// all four configurations down the same path, and it is why every assertion
// below reads the `disabled` FLAG, which is the thing a browser enforces,
// rather than inferring permission from whether a press did something.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The combat role, and what each one may press\n');

installDom();
const { AttackHelper, data, dice, mod } = await loadCombat('combatrole', ['combatRoleFor']);
const { combatRoleFor } = mod;

// ---------- 1. the derivation ----------
const s = (side) => ({ side });

check('combatRoleFor is exported as one function', typeof combatRoleFor, 'function');

// CONSTRAINT 1: derived from the COMBAT, not from the seat. The same viewer
// gets a different answer in a different attack, which is the whole point.
check('the same seat is the attacker in one attack',
  combatRoleFor('s1', { attacker: s('s1'), defender: s('s2') }), 'attacker');
check('and the defender in another',
  combatRoleFor('s1', { attacker: s('s2'), defender: s('s1') }), 'defender');
// The four-player case, which is the one that has to keep working. `Side` is
// two members today, so this passes a seat the type does not name yet: the
// derivation must answer on the participants it was handed and must not carry
// any idea of how many seats exist.
check('a seat that is in neither half of the attack is a spectator',
  combatRoleFor('s3', { attacker: s('s1'), defender: s('s2') }), 'spectator');
check('even when the attack is between two other people entirely',
  combatRoleFor('s4', { attacker: s('s2'), defender: s('s3') }), 'spectator');

// CONSTRAINT 2: SPECTATOR IS THE BASE CASE. Everything unmatched lands here,
// including a viewer holding no seat at all, which is a real spectator today.
check('a viewer with no seat is a spectator', combatRoleFor(null, { attacker: s('s1'), defender: s('s2') }), 'spectator');
check('and so is one whose seat is not known yet', combatRoleFor(undefined, { attacker: s('s1'), defender: s('s2') }), 'spectator');
check('with no attack on the table at all, still a spectator', combatRoleFor('s1', null), 'spectator');
check('and with half an attack, where a token has not resolved',
  combatRoleFor('s1', { attacker: null, defender: s('s2') }), 'spectator');

// THE MUTATION THIS EXISTS TO CATCH. "Not the attacker" must never be read as
// "the defender": that holds at two seats and silently breaks at four, and it
// is already wrong today for a player shooting one of their own units.
check('a bystander to a self-inflicted attack is a spectator, never the defender',
  combatRoleFor('s2', { attacker: s('s1'), defender: s('s1') }), 'spectator');
// The acting side keeps the initiative when it owns both ends.
check('and the player who owns both ends of it is the attacker',
  combatRoleFor('s1', { attacker: s('s1'), defender: s('s1') }), 'attacker');

// CONSTRAINT 4: no `ally` member. Team membership is a separate axis arriving
// with 2 vs 2, and folding it in here is what would have to be unpicked.
const seats = [null, 's1', 's2', 's3', 's4'];
const produced = new Set();
for (const v of seats) for (const a of seats.slice(1)) for (const d of seats.slice(1)) {
  produced.add(combatRoleFor(v, { attacker: s(a), defender: s(d) }));
}
check('the derivation can only ever produce the three roles',
  [...produced].sort(), ['attacker', 'defender', 'spectator']);
const src = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
const decl = src.slice(src.indexOf('export type CombatRole'), src.indexOf(';', src.indexOf('export type CombatRole')));
check('and the type names exactly those three', decl.includes("'attacker'") && decl.includes("'defender'") && decl.includes("'spectator'"), true);
check('with no ally member folded into it, that being a separate axis', /\bally\b/i.test(decl), false);

// ---------- 2. the renderer under each role ----------
//
// One scripted attack, walked four times: the freeplay board, the same board
// told it is the attacker, a networked attacker with the defender at another
// screen, and then the defender and a spectator of that same attack.

const card = data.cards.find((c) => c.id === 'ZHRA-201');
const action = card?.actions?.find((a) => a.id === 'ZHRA-201_B');
if (!action) throw new Error('ZHRA-201_B is gone from the card data; pick another Firing Action');

const ser = (el) => ({
  t: el.tagName ?? null, c: el.className ?? '', txt: el.textContent ?? '',
  html: el.innerHTML ?? '', dis: el.disabled === true,
  kids: (el.children ?? []).map(ser),
});

// Deterministic dice, so two walks of the same script see the same faces and a
// difference between them can only be the role.
const seeded = () => {
  let seed = 12345;
  return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
};

async function walk({ role, remoteDefender }) {
  Math.random = seeded();
  const atk = mech(1, 's1', 'Attacker', 1);
  const def = mech(2, 's2', 'Defender', 3);
  const root = makeEl('div');
  const helper = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  helper.tokens = () => [atk, def];
  helper.terrain = () => [];
  helper.smoke = () => [];
  if (role) helper.role = role;
  if (remoteDefender) helper.focusRemote = () => true;

  const frames = [];
  const missed = [];
  const shot = (name) => frames.push({ name, tree: ser(root), buttons: findButtons(root).map((b) => ({ label: label(b), dis: b.disabled === true })) });
  const press = (want) => {
    const b = findButtons(root).find((x) => label(x).includes(want));
    // A control that is not there AT ALL is recorded rather than thrown, so a
    // role that hides something fails a named assertion instead of taking the
    // file down with a stack trace. Absent is the exact regression this guards.
    if (!b) { missed.push(want); return; }
    b.click();
  };

  helper.start(atk, action, def, '');
  shot('part');
  helper.pickPart('torso');
  shot('attack');
  press('Roll attack dice');
  await settle();
  shot('attack rolled');
  press('Continue to Defense');
  shot('defense');
  // The harness Mech carries no Part cards, so its Armor reads zero and the
  // defence roll would come back empty. canFocus needs dice on the table, so
  // the defender's half of Focus (4.4.1-5) would never be asked and the frame
  // where the SAME two buttons change hands would not exist. The roll button
  // reads the pool when it is pressed, so writing it here is enough.
  helper.ctx.defensePool = { white: 2, blue: 1 };
  press('Roll defense dice');
  await settle();
  shot('focus: the attacker declares');
  press('Pass');
  shot('focus: the defender declares');
  press('Pass');
  shot('ready to resolve');
  press('Resolve');
  shot('resolution');
  // `missed` rides on the array itself: JSON.stringify walks only the indexed
  // elements, so the tree comparisons below are untouched by it.
  frames.missed = missed;
  return frames;
}

const freeplay = await walk({});
const asAttacker = await walk({ role: 'attacker' });
const networkedAttacker = await walk({ role: 'attacker', remoteDefender: true });
const asDefender = await walk({ role: 'defender', remoteDefender: true });
const asSpectator = await walk({ role: 'spectator', remoteDefender: true });

// The whole script has to be walkable in EVERY role, because the controls are
// disabled and never removed. A role that hides one stalls the walk here.
check('the freeplay board finds every control the script asks for', freeplay.missed, []);
check('a networked attacker finds them all too', networkedAttacker.missed, []);
check('the defender finds them all', asDefender.missed, []);
check('and a spectator finds them all', asSpectator.missed, []);

// THE SAFETY PROPERTY. The freeplay board never sets a role, so the default has
// to be the attacker and the two walks have to be the same tree down to the
// last attribute. A regression here means the single-player board changed.
check('the renderer defaults to the attacker, which is the freeplay board',
  JSON.stringify(freeplay) === JSON.stringify(asAttacker), true);
check('and the freeplay board reaches the resolution', freeplay.at(-1).name, 'resolution');
check('with nothing anywhere in it disabled',
  freeplay.flatMap((f) => f.buttons).filter((b) => b.dis).map((b) => b.label), []);

// DISABLED, NOT ABSENT. Every other role sees the SAME controls, which is what
// makes it the same box rather than a degraded copy. Compared frame by frame,
// because a control that merely moved between steps would still be a loss.
const labelsOf = (frames) => frames.map((f) => ({ at: f.name, labels: f.buttons.map((b) => b.label) }));
check('a networked attacker sees every control the freeplay board does',
  labelsOf(networkedAttacker), labelsOf(freeplay));
check('the defender sees every control the attacker does', labelsOf(asDefender), labelsOf(freeplay));
check('and so does a spectator', labelsOf(asSpectator), labelsOf(freeplay));

// A spectator may press nothing at all. This is the base case, not the
// leftover: with four players it is what most people are looking at.
check('a spectator has every control inert',
  asSpectator.flatMap((f) => f.buttons).filter((b) => !b.dis).map((b) => b.label), []);

// The split down the middle of one attack. Read at the frame where the control
// belongs to a known side, so a rename of the step cannot quietly weaken it.
const at = (frames, name) => frames.find((f) => f.name === name).buttons;
const state = (frames, name, want) => {
  const b = at(frames, name).find((x) => x.label.includes(want));
  return b ? (b.dis ? 'disabled' : 'enabled') : 'missing';
};

check("the attacker's roll is the attacker's to press", state(asAttacker, 'attack', 'Roll attack dice'), 'enabled');
check('and the defender may not press it', state(asDefender, 'attack', 'Roll attack dice'), 'disabled');
check('but still sees it, so they know what is being waited on', state(asDefender, 'attack', 'Roll attack dice') !== 'missing', true);
check("the defence roll is the defender's", state(asDefender, 'defense', 'Roll defense dice'), 'enabled');
check('and a networked attacker may not press it', state(networkedAttacker, 'defense', 'Roll defense dice'), 'disabled');
check('while on the one-screen board the same player presses both',
  state(freeplay, 'defense', 'Roll defense dice'), 'enabled');

// Focus (4.4.1-5) is declared by the attacker first and the defender second, so
// the same two buttons change hands between two consecutive frames. That is the
// sharpest test that the gate is per-CONTROL and not per-window.
check("the attacker's Focus declare is theirs", state(asAttacker, 'focus: the attacker declares', 'Pass'), 'enabled');
check('and is inert for the defender', state(asDefender, 'focus: the attacker declares', 'Pass'), 'disabled');
check("one step later the defender's declare is theirs", state(asDefender, 'focus: the defender declares', 'Pass'), 'enabled');
// This pair is the drift the redesign named: the mirror asked the defender to
// Focus while the attacker's own window drew a waiting sentence and no buttons
// at all, so nobody watching could see WHAT was being decided.
check('and the networked attacker sees that question rather than a blank',
  state(networkedAttacker, 'focus: the defender declares', 'Focus'), 'disabled');
check('with the pass beside it, also inert',
  state(networkedAttacker, 'focus: the defender declares', 'Pass'), 'disabled');

check('resolving the attack stays the attacker\'s move', state(asAttacker, 'ready to resolve', 'Resolve'), 'enabled');
check('and a spectator may not resolve someone else\'s attack', state(asSpectator, 'ready to resolve', 'Resolve'), 'disabled');

// ---------- the named hazard, which this slice moved nothing in ----------
//
// The combat deadlock (task #5) was render() publishing the mirror before
// beginFocus() had settled the stage. focuspublish.test.mjs is the real guard;
// this is a second lock on the same door, because the role work edits the very
// step builders that call beginFocus.
const render = src.slice(src.indexOf('private render(): void {'), src.indexOf('// ---------- Multi-Target', src.indexOf('private render(): void {')));
check('render still publishes after the step is built, not before',
  render.indexOf('this.publishMirror();') > render.indexOf('this.root.replaceChildren(el);'), true);
// Nothing about the role travels. The role is answered on each client from the
// combat it is already holding, so no whitelist had to learn a new field.
check('the role is never published on the wire', /role:/.test(src.slice(src.indexOf('private publishMirror'), src.indexOf('private render(): void {'))), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

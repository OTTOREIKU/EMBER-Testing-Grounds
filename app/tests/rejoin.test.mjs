// A rejoin destroys an attack in progress, reported from the same live online
// game 2026-08-19: "He tried to leave and rejoin but when he rejoined his
// screen said there wasn't an attack happening at all, so somehow it cleared an
// attack mid progress on his leaving."
//
// The chain, all on the client that leaves and comes back. relay.leave() nulls
// `room`; render() then falls to the non-HUD branch and writes markup with no
// `hudmode` class, destroying #hud-shell and #combat-body. Rejoining finds no
// shell, so ensureHud re-enters its one-time block, seeds an EMPTY #combat-body
// and calls mountSide() — which used to build a SECOND AttackHelper over the
// new element and write "No attack in progress" under it. The attack lived in
// the first helper's memory and nowhere else, so it was simply gone.
//
// Two severities. A returning DEFENDER only lost their own screen — and could
// not get it back, because the mirror is written under `mirror !== lastMirror`
// and that cache is module state that outlived the DOM it described. A
// returning ATTACKER was worse: an idle helper makes combatBusy() false, and
// the next render's sweepCombatView() sends `view: null`, which is the only
// thing in the app that clears the shared mirror — deleting the fight for BOTH
// players. That is "it cleared an attack mid progress".
//
// Half of this is drivable and half is DOM lifecycle. The helper keeping its
// attack across a root swap is driven for real; the shell rebuild is asserted
// by source shape, the way focuspublish.test.mjs asserts its ordering, because
// there is no jsdom here and the mechanism IS the shape.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, textOf, mech } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('An attack survives the HUD being rebuilt\n');

// ---------- driven: the helper keeps its attack across a new element ----------
installDom();
const { AttackHelper, data, dice } = await loadCombat('rejoin');

const atk = mech(1, 's1', 'Attacker', 1);
const def = mech(2, 's2', 'Defender', 3);
const card = data.cards.find((c) => c.id === 'ZHRA-201');
const action = card?.actions?.find((a) => a.id === 'ZHRA-201_B');
if (!action) throw new Error('ZHRA-201_B is gone from the card data; pick another Firing Action');

const first = makeEl('div');
const helper = new AttackHelper(data, dice, first, () => {}, () => {});
helper.tokens = () => [atk, def];
helper.terrain = () => [];
helper.smoke = () => [];
helper.focusRemote = () => false;
let published = 0;
helper.publishView = () => { published++; };

helper.start(atk, action, def, '');
helper.pickPart('torso');
const ctx = helper.ctx;
check('an attack is running', helper.active, true);
check('and the window drew it', textOf(first).some((t) => /Attacker/.test(t)), true);

// The rejoin: the old element is gone and a new empty #combat-body has taken
// its place. The page hands it over rather than building a second helper.
const second = makeEl('div');
check('the helper can be handed a new element', typeof helper.remount, 'function');
if (typeof helper.remount === 'function') helper.remount(second);

check('the attack survives the element being replaced', helper.active, true);
check('on the very same context', helper.ctx === ctx, true);
check('with the step it was on', helper.ctx.step, 'attack');
check('and the Part it had chosen', helper.ctx.targetPart, 'torso');
check('the new element is drawn into', textOf(second).some((t) => /Attacker/.test(t)), true);
check('and the mirror is republished from the redraw', published > 0, true);

// An idle helper takes the element and nothing else — the page paints its own
// empty state, and a remount must not conjure an attack out of nothing.
const idle = new AttackHelper(data, dice, makeEl('div'), () => {}, () => {});
const third = makeEl('div');
if (typeof idle.remount === 'function') idle.remount(third);
check('an idle helper stays idle when it is remounted', idle.active, false);
check('and nothing is drawn into the new element', third.children.length, 0);

// ---------- the shell rebuild, by source shape ----------
const matchSrc = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const typesSrc = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const combatSrc = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');

// mountSide is called from ensureHud's one-time block and nowhere else, so
// every shell rebuild runs it.
check('mountSide is still reached only from the HUD shell being built',
  (hudSrc.match(/ctx\.mountSide\(\)/g) ?? []).length, 1);

const mount = matchSrc.slice(
  matchSrc.indexOf('function mountSide(): void {'),
  matchSrc.indexOf('// The last combat view THIS client published'),
);
check('mountSide re-points a live helper at the new element',
  /attackHelper\.remount\(document\.getElementById\('combat-body'\)/.test(mount), true);
check('and only builds one when there is none', /if \(diceData && attackHelper\)/.test(mount), true);
// A MIRROR owns those pixels exactly as much as an attack of this client's own
// does, and it is deliberately not `active`, so the guard names both.
check('the idle line never paints over a live attack',
  /if \(!combatBusy\(\) && !attackHelper\?\.watching\) renderCombatIdle\(\);/.test(mount), true);

// The mirror used to be MARKUP the HUD wrote, cached in two module variables
// that outlived the DOM they described: a player who left the table and came
// back mid-attack found the cache equal to the markup the unchanged view
// produces, skipped the write, and was left reading an empty Combat window.
// There is no cache to go stale now, because there is no markup: the helper
// draws the mirror and remount() redraws it into the new element. The guard is
// that the cache stayed gone rather than that it is reset correctly.
check('the HUD keeps no markup cache of the mirror to go stale',
  /lastMirror/.test(hudSrc), false);
check('the mirror is drawn by the same helper a rejoin remounts',
  /ctx\.syncCombatMirror\(\)/.test(hudSrc), true);

// The sweep is the only thing that clears the shared view, and it used to infer
// "no attack" from this client's own helper alone.
const sweep = matchSrc.slice(
  matchSrc.indexOf('function sweepCombatView(): void {'),
  matchSrc.indexOf('function terrainNow()'),
);
check('the sweep reads WHOSE attack is on the board', /state\.script\?\.combatView/.test(sweep), true);
check('and refuses to null one belonging to the other seat', /at\.side === seat/.test(sweep), true);
check('the null only goes out for our own', /if \(mine\) send\(\{ kind: 'setCombatView'/.test(sweep), true);

// Whitelists silently drop what they do not name, and these five are questions
// only the defender's mirror asks. A checkpoint — a rejoin, a resync, or the
// routine one the host is asked for every 40 revisions — used to erase them.
const norm = typesSrc.slice(
  typesSrc.indexOf('function normaliseCombatView(raw: unknown)'),
  typesSrc.indexOf('function normaliseRollback('),
);
for (const field of ['evadeUsed', 'evadeReady', 'dodgeDieUsed', 'dodgeDieReady', 'designate']) {
  check(`a checkpoint carries ${field} through`, new RegExp(`\\b${field}:`).test(norm), true);
}
check('and the designated Parts are bounded like the rest', /slice\(0, 8\)/.test(norm), true);

// ---------- the deadlock fix this must not undo (8b78fab) ----------
const renderAt = combatSrc.indexOf('private render(): void {');
const render = combatSrc.slice(renderAt, combatSrc.indexOf('// ---------- Multi-Target', renderAt));
const built = render.indexOf('this.root.replaceChildren(el);');
const publish = render.indexOf('this.publishMirror();');
check('the mirror is still published AFTER the step is built',
  built > 0 && publish > built, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

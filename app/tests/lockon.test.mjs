// KK9 LOCK ON (LHDR-KK9_A, UN 1.02 list): "When Ally Units perform Firing
// actions against targets within range, target -1B."
//
// OTTO, 2026-10-05: "Lets wire this in and we can change it later if something
// in the way it functions changes at actual release." The KK9 ships in no
// released box. The rule is an aura on the ENEMY units within the KK9's Range
// (data/action_overrides.json gives the card its structured rule), and it bites
// only on a Firing Action made by a unit of the KK9's own side: that target
// rolls 1 Blue die fewer in its Defense Roll.
//
// Against the REAL merged data (loadCombat runs the app's own loadData), so
// these pins fail if the override is lost as well as if the engine forgets it.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
const { AttackHelper, data, dice } = await loadCombat('lockon');

console.log('KK9 Lock On: the target of an ally\'s shot rolls 1 Blue fewer\n');

const kk9 = data.byId.get('LHDR-KK9');
const lockOn = (kk9?.actions ?? []).find((a) => a.id === 'LHDR-KK9_A');
const eff = lockOn?.gameRules?.[0]?.effects?.[0];
check('the merged KK9 carries Lock On as an aura on enemy units, -1, at Range 1',
  [eff?.type, eff?.effectTypes, eff?.targetSide, eff?.value, lockOn?.range], ['aura', ['firing_target_blue_penalty'], 'enemy', -1, 1]);

// A Mech's Large Grid is 3 cells; Range is counted in Large Grids.
const mech = (uid, side, lbl, col, stance = 'offensive') => ({
  uid, side, kind: 'mech', cardId: '172', label: lbl, col, row: 0,
  size: 3, facing: 1, aerial: false, stance, link: 3, deployed: true,
  mech: { torso: '172', chasis: '181' }, partStates: { torso: 'intact', chasis: 'intact' }, ammo: {}, statuses: [], log: [],
});
const drone = (uid, side, col) => ({
  uid, side, kind: 'drone', cardId: 'LHDR-KK9', label: `KK9 ${uid}`, col, row: 0,
  size: 1, facing: 3, aerial: true, stance: 'offensive', deployed: true,
  partStates: { main: 'intact' }, ammo: {}, statuses: [], log: [],
});
const rifle = data.byId.get('541').actions.find((a) => a.type === 'Firing');
const fist = data.cards.flatMap((c) => c.actions ?? []).find((a) => a.type === 'Melee' && (a.range ?? 0) >= 1);

// The defender's pool as the window builds it: in Mobility Stance its 181
// chassis rolls Dodge 3 as Blue, which gives the subtraction something to eat.
function poolFor(drones, action = rifle, attackerSide = 's1') {
  const atk = mech(1, attackerSide, 'Attacker', 0);
  const def = mech(2, attackerSide === 's1' ? 's2' : 's1', 'Defender', 9, 'mobility');
  const root = makeEl('div');
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => [atk, def, ...drones];
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(atk, action, def, '');
  h.pickPart('torso');
  return h.ctx.defensePool;
}

const clean = poolFor([]);
check('the clean pool has Blue to lose', clean.blue >= 3, true);
check('A KK9 OF THE SHOOTER\'S SIDE BESIDE THE TARGET: 1 Blue fewer', poolFor([drone(3, 's1', 12)]).blue, clean.blue - 1);
check('two KK9s, each its own source, 2 fewer', poolFor([drone(3, 's1', 12), drone(4, 's1', 6)]).blue, clean.blue - 2);
check('White is untouched: the card names Blue', poolFor([drone(3, 's1', 12)]).white, clean.white);
check('a KK9 out of Range takes nothing', poolFor([drone(3, 's1', 30)]).blue, clean.blue);
check('a KK9 of the TARGET\'S side takes nothing from its own ally', poolFor([drone(3, 's2', 12)]).blue, clean.blue);
check('a Melee Action takes nothing: the card names Firing actions', fist ? poolFor([drone(3, 's1', 12)], fist).blue === poolFor([], fist).blue : 'no melee action', true);

// The pad's list of what holds at the roll names it on the defender.
{
  const { M } = await import('./_engine.mjs').then((x) => x.loadEngine('lockon-units', ["export * as UN from '../src/units';"]));
  const atk = mech(1, 's1', 'Attacker', 0);
  const def = mech(2, 's2', 'Defender', 9, 'mobility');
  const k = drone(3, 's1', 12);
  const said = M.UN.aurasAtRoll(data, [atk, def, k], atk, def, rifle, false).map((x) => [x.src.uid, x.unit.uid, x.text]);
  check('the table is asked at the roll whether it holds: KK9 on the defender, -1B', said, [[3, 2, '-1B']]);
  check('and the reader answers 1 for that shot, 0 for its own side\'s target',
    [M.UN.lockOnPenalty(data, [atk, def, k], atk, def, rifle), M.UN.lockOnPenalty(data, [atk, def, drone(3, 's2', 12)], atk, def, rifle)], [1, 0]);
}

// ---------- the source says so ----------
{
  const combat = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check('the window takes it off the Blue after Hindered and before Immobilized deletes the pool, and says so above the pool',
    [/blue = Math\.max\(0, blue - statusCount\(d\.statuses, 'hindered'\)\);[\s\S]{0,400}blue = Math\.max\(0, blue - lockOnPenalty\(/.test(combat),
      /lockOnPenalty\([\s\S]{0,1600}if \(statusCount\(d\.statuses, 'immobilized'\) > 0\) blue = 0;/.test(combat),
      /: Lock On, so \$\{esc\(c\.defender\.label\)\} rolls <b>\$\{n\} Blue fewer<\/b> below\./.test(combat)], [true, true, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

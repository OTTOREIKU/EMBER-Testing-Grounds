// The odds, shown to a player in the combat window (AI-OPPONENT-PLAN.md, M9.3;
// OTTO, 2026-10-03: "Yes", to showing them).
//
// The computer has weighed every attack by its exact odds since M5: the chance
// of a Hit, of a Penetration, of a Part and of the unit destroyed, read off
// the combat window itself (ai/odds.ts forecastOf). Now the player's own
// window shows the same numbers on its Attack Roll step, before a die is
// thrown, through a hook the Match Centre hands it (`oddsOf`): the window
// cannot work them out itself, since the odds module reads the window.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle, textOf } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The odds, shown to a player\n');

installDom();
const { AttackHelper, data, dice, mod } = await loadCombat('playerodds', [], ["export { forecastOf } from '../src/ai/odds';"]);

const torso = data.cards.find((c) => c.type === 'torso');
const chasis = data.cards.find((c) => c.type === 'chasis');
// The Laser arm the on-hit test uses: a Firing Action with a pool.
const laser = data.cards.find((c) => c.id === '117');
const shot = laser?.actions?.find((a) => a.type === 'Firing');
const kit = (t, hand) => { t.mech = { torso: torso.id, chasis: chasis.id, leftHand: hand ?? '', rightHand: '', backpack: '', pilot: '' }; return t; };

// Opens one attack and stops at the Attack Roll step, its dice not thrown.
function open(hook) {
  const atk = kit(mech(1, 's1', 'Attacker', 1), laser.id);
  const def = kit(mech(2, 's2', 'Defender', 3), '');
  const root = makeEl('div');
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => [atk, def];
  h.terrain = () => [];
  h.smoke = () => [];
  if (hook) h.oddsOf = hook;
  h.start(atk, shot, def, 'clear');
  h.pickPart('torso');
  return { h, root, text: () => textOf(root).join(' ') };
}

// ---------- the line ----------
{
  check('the fixture: an arm with a Firing Action and a pool', [!!shot, (shot?.yellowDice ?? 0) + (shot?.redDice ?? 0) > 0], [true, true]);
  const seen = [];
  const x = open((r) => { seen.push(r); const f = mod.forecastOf(r); return { hit: f.hit, pen: f.pen, destroy: f.destroy, kill: f.kill }; });
  const f = mod.forecastOf(seen[0]);
  const pct = (v) => (v > 0 && v < 0.005 ? 'under 1%' : `${Math.round(v * 100)}%`);
  const t = x.text();
  check('on the Attack Roll step, before the roll, the window asks for the odds of the attack in hand, with its own reading',
    [seen.length > 0, typeof seen[0]?.attack, /Roll attack dice/.test(t)], [true, 'object', true]);
  check('and shows them in one line: the chance of a Hit and of a Penetration, as the computer reads them (forecastOf)',
    [/Odds:/.test(t), t.includes(pct(f.hit)), t.includes('to Hit'), t.includes(pct(f.pen)), t.includes('to Penetrate'), f.hit >= f.pen, f.pen > 0], [true, true, true, true, true, true, true]);
  check('a destroyed Part and a destroyed unit where the odds give them, the unit by its name',
    [f.kill > 0 ? t.includes('to destroy Defender') : true, f.destroy > f.kill + 0.005 ? t.includes('to destroy a Part') : !t.includes('to destroy a Part')], [true, true]);
  // Once the dice are thrown the odds are behind it.
  const roll = findButtons(x.root).find((b) => /roll attack dice/i.test(label(b)));
  roll?.click();
  await settle();
  check('once the attack dice are thrown the line is gone', [!!roll, /Odds:/.test(x.text())], [true, false]);
}
{
  const x = open(null);
  check('a page that hands in no odds shows none (the computer\'s own headless windows among them)', /Odds:/.test(x.text()), false);
  const y = open(() => null);
  check('nor where the odds cannot be read', /Odds:/.test(y.text()), false);
  const z = open(() => ({ hit: 0.004, pen: 0.001, destroy: 0, kill: 0 }));
  check('a chance under one in two hundred is "under 1%", never 0%', [z.text().includes('under 1%'), / 0% /.test(z.text())], [true, false]);
}

// ---------- the Match Centre hands it in ----------
{
  const match = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
  check('the Match Centre gives its combat window the odds, from the computer\'s own reading',
    [/import \{ forecastOf \} from '\.\/ai\/odds';/.test(match), /attackHelper\.oddsOf = \(r\) => \{ const f = forecastOf\(r\); return \{ hit: f\.hit, pen: f\.pen, destroy: f\.destroy, kill: f\.kill \}; \};/.test(match)], [true, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

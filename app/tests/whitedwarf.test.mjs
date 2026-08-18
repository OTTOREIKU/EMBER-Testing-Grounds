// White Dwarf Thruster (292 ACE-001 Bit Port). The reader is tested against the
// real card in auras.test.mjs; what is checked here is where it lands in
// resolve(), because it shares the Defense Roll's Lightning with KC Armor and
// the two would otherwise fight over the same icons.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

console.log('White Dwarf Thruster\n');

const combat = src('combat.ts'), units = src('units.ts');

// ---------- Blue only ----------
// countIcons throws every colour into one tally, so this needed its own read.
check('the roll is counted by colour, which countIcons cannot do',
  /private iconsOnColour\(roll: Rolled\[\], colour: DieColor, type: string, upgradeHollow: boolean\)/.test(combat), true);
check('and it is asked for BLUE lightning specifically',
  /iconsOnColour\(c\.defenseRoll, 'blue', 'lightning'/.test(combat), true);
check('read under the defender\'s own stance, like every other defence tally',
  /'lightning', c\.defender\.stance === 'defensive'\)/.test(combat), true);

// ---------- Ordering against KC Armor ----------
// The automatic transform runs first; the elective one takes what is left.
check('the Thruster is applied before KC Armor',
  /const dwarf = c\.defenseRoll && blueLightningDodges[\s\S]{0,700}const kcSwapped = c\.kcUsed/.test(combat), true);
check('it adds Dodge and takes those Lightning off the tally',
  /def\.dodge = \(def\.dodge \?\? 0\) \+ dwarf;\s*\n\s*def\.lightning = Math\.max\(0, \(def\.lightning \?\? 0\) - dwarf\);/.test(combat), true);
// So a Mech with both does not have the same icon counted twice.
check('so KC Armor can only take the Lightning the Thruster left',
  /def\.lightning = Math\.max\(0[\s\S]{0,600}const kcSwapped = c\.kcUsed \? def\.lightning \?\? 0 : 0;/.test(combat), true);

// ---------- The condition is not a cost ----------
check('the reader checks the ammo bag rather than spending it',
  /\(t\.ammo\?\.\[needs\] \?\? 0\) <= 0\) continue;/.test(units), true);
check('and it reads the structured rule, not the ability name',
  /x\.type === 'transform_dice_face' && x\.from === 'lightning' && x\.to === 'evade'/.test(units), true);
// source_is_target is what makes it defence-side: it is read off the DEFENDER.
check('it is asked about the defender', /blueLightningDodges\(this\.data, c\.defender\)/.test(combat), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

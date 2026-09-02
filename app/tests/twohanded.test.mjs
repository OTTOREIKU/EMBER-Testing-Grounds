// [Two-Handed] and the Freehand designation. The rider parser and the support
// readers are driven against all 30 printed cards in auras.test.mjs; this
// checks the wiring, and above all that all THREE sites which adjust an Action
// before an attack apply it — a site that misses it is a weapon that quietly
// loses its Range on one page only.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

console.log('Two-Handed designation\n');

const units = src('units.ts'), combat = src('combat.ts'), hud = src('matchhud.ts'), main = src('main.ts');

// ---------- One helper, three call sites ----------
// `granted`, not `steadied`, since the conditional keyword grants slid in
// between the two (shockattack.test.mjs): stationary -> grants -> two-handed.
check('the Match Centre applies it in both places it adjusts an Action',
  (hud.match(/twoHandedUse\(ctx\.data, by, granted\)\?\.action \?\? granted/g) ?? []).length, 2);
check('and freeplay in its one', /twoHandedUse\(data, t, granted\)\?\.action \?\? granted/.test(main), true);
check('both sit AFTER the Stationary adjustment, so the riders compound',
  /const steadied = raw \? stationaryAdjusted[\s\S]{0,500}twoHandedUse/.test(hud)
  && /const steadied = stationaryAdjusted[\s\S]{0,500}twoHandedUse/.test(main), true);

// ---------- Applied, not asked ----------
check('the choice is made for the player, with the reasoning recorded',
  /The designation is APPLIED rather than asked/.test(units), true);
check('and the Part picked is one that gives something back, when there is one',
  /hands\.find\(\(h\) => freehandSupport\(data, t, h\.slot, a\)\) \?\? hands\[0\]/.test(units), true);
check('no hand free means no designation, rather than a free upgrade',
  /if \(!hands\.length\) return null;/.test(units), true);
// A hand carrying a Black Box is already excluded upstream, which is what makes
// applying it safe rather than presumptuous.
check('the free hands come from the same reader the Black Box rules use',
  /const hands = freehandSlots\(data, t, taken, loans\);/.test(units), true);

// ---------- It is reported, not silent ----------
// Keyed on the note itself, not on the icon that precedes it: this read `✋`
// until the emoji sweep replaced it with ICON_BLOCKED, and the icon is the part
// most likely to change again.
check('the attack panel says what the hand bought',
  /<p class="ah-los">\$\{ICON_BLOCKED\} \$\{use\.note\}\.<\/p>/.test(combat), true);
check('and still names the bonus when no hand can be spared',
  /const sup = freehandSupportNote\(this\.data, c\.attacker, c\.action\);/.test(combat), true);

// ---------- Multi-Target stops warning about a condition that is now met ----------
check('multiTargetLimit takes the designation',
  /export function multiTargetLimit\(a: CardAction, designated = false\)/.test(units), true);
check('and clears only the Freehand condition, never the Charge one',
  /const met = designated && cond === 'freehand_designated';/.test(units), true);
check('the Charged condition is still named as untracked',
  /\[Charged\] still is not/.test(units), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

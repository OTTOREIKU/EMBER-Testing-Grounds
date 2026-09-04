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

const units = src('units.ts'), combat = src('combat.ts'), hud = src('matchhud.ts'), main = src('main.ts'), match = src('match.ts');

// ---------- One helper, every call site ----------
// `granted`, not `steadied`, since the conditional keyword grants slid in
// between the two (shockattack.test.mjs): stationary -> grants -> two-handed.
// FAQ A16 turned the application into an OFFER: the Match Centre reads it
// through handsFor at both of its sites, freeplay asks askTwoHanded at both of
// its doors, and match.ts applies it where the attack actually starts - which
// it used to skip, so the Match Centre rolled a Two-Handed weapon without the
// rider its own picker had promised.
check('the Match Centre reads it in both places it adjusts an Action',
  (hud.match(/handsFor\(ctx, by, granted, m\.twoHanded\)/g) ?? []).length, 2);
check('and freeplay asks it at both of its doors',
  (main.match(/askTwoHanded\(t, granted\)/g) ?? []).length, 2);
check('and the Match Centre applies it where the attack starts',
  /twoHandedUse\(data, t, granted\)\?\.action \?\? granted/.test(match), true);
check('both sit AFTER the Stationary adjustment, so the riders compound',
  /const steadied = raw \? stationaryAdjusted[\s\S]{0,900}handsFor/.test(hud)
  && /const steadied = stationaryAdjusted[\s\S]{0,900}askTwoHanded/.test(main), true);

// ---------- Offered, not applied (FAQ A16) ----------
check('the helper applies and the pages offer, with the reasoning recorded',
  /the pages OFFER it \(FAQ A16/.test(units), true);
check('a declined designation is a marked one-handed copy on every page',
  /twoHandedDeclined: true/.test(hud) && /twoHandedDeclined: true/.test(main) && /twoHandedDeclined: true/.test(match), true);
check('and the combat window reports the decline instead of re-deriving the bonus',
  /if \(c\.action\.twoHandedDeclined\) return/.test(combat), true);
check('and the mirror rebuilds the same one-handed Action',
  /attackActionOf\(at, view\.actionId, !!view\.twoHandedDeclined\)/.test(match), true);
check('which travels on the published view',
  /twoHandedDeclined: c\.action\.twoHandedDeclined \|\| undefined/.test(combat), true);
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

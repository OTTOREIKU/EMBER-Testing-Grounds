// Dodge Enhancement (ZYBP-302) end to end. The arithmetic has its own tests in
// offset.test.mjs and the reader in auras.test.mjs; what is left is the round
// trip, which spans five files and cannot be exercised without a browser. It is
// checked here by reading the sources, the same way the HUD wiring tests do.
//
// The three-reader rule applies: commands.ts must accept the command, match.ts
// must route it into the helper, and matchhud.ts must bind the mirror button —
// a gap in any one of them shows up as a button that does nothing.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

console.log('Dodge Enhancement round trip\n');

const combat = src('combat.ts'), commands = src('commands.ts');
const match = src('match.ts'), hud = src('matchhud.ts'), units = src('units.ts');

// ---------- The declaration travels ----------
check('the command exists', /\{ kind: 'dodgeEnhance'; seat: Side \}/.test(commands), true);
check('and is a table command, so a seat may send it for the other side',
  (commands.match(/'designateHit', 'meleeEvade', 'dodgeEnhance',/g) ?? []).length, 2);
check('applyRemote hands it to the open attack window',
  /cmd\.kind === 'dodgeEnhance'/.test(commands), true);
check('match.ts routes it into the helper',
  /if \(cmd\.kind === 'dodgeEnhance'\) attackHelper\?\.dodgeEnhanceDeclared\(\);/.test(match), true);

// ---------- The button exists on BOTH screens ----------
check('the remote defender is offered it in their mirror',
  /data-act="dodgeenhance"/.test(match), true);
check('the mirror button is bound', /data-act="dodgeenhance"\]', \(\) => ctx\.mirrorDodgeEnhance\(\)/.test(hud), true);
check('the mirror spends the Token by its own command, then declares',
  /function mirrorDodgeEnhance[\s\S]*?kind: 'spendCommand'[\s\S]*?kind: 'dodgeEnhance'/.test(match), true);
check('and the one-screen game gets its own button',
  /Dodge Enhancement: spend a Command Token/.test(combat), true);
check('which also spends the Token before declaring',
  /Dodge Enhancement: spend a Command Token[\s\S]*?kind: 'spendCommand'[\s\S]*?kind: 'dodgeEnhance'[\s\S]*?this\.dodgeEnhanceDeclared\(\)/.test(combat), true);

// Melee Evasion shipped without a one-screen button; it is added alongside.
check('Melee Evasion has one now too',
  /Melee Evasion: spend a Command Token[\s\S]*?this\.evadeDeclared\(\)/.test(combat), true);

// ---------- What the attacker's window decides ----------
check('only the attacker judges availability, and publishes it',
  /dodgeDieReady: !c\.dodgeDieUsed && c\.step === 'defense' && dodgeEnhanceReady\(this\.data, c\.defender\)/.test(combat), true);
check('the mirror draws only what it was told',
  /view\.dodgeDieReady && iAmDefender/.test(match), true);
check('declaring twice is refused', /if \(!c \|\| c\.dodgeDieUsed\) return;/.test(combat), true);

// ---------- The arithmetic is reached ----------
check('resolve feeds offsetIcons a per-die breakdown only once declared',
  /c\.dodgeDieUsed \? this\.attackIconsPerDie\(c\) : undefined/.test(combat), true);
check('the breakdown follows the Lightning swap, or a traded Heavy would belong to no die',
  /icon\.type === 'lightning' && swapLightning/.test(combat), true);
check('and the Eye swaps, which are chosen by the player',
  /icon\.type === 'eye' && eyesLeft > 0/.test(combat), true);
check('the reader is a real export, not a stub', /export function dodgeEnhanceReady/.test(units), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

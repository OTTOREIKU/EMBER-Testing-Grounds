// Martyrdom (ZHDR-302 N52 "Zealot") end to end. The reader has its own tests in
// auras.test.mjs against the real card; this checks the wiring, and in
// particular that the resolution reuses the existing Detonation flow rather
// than growing a second one.
//
// The card's effect asks for three things and the flow already does all three:
// an Explosion attack per target, allies included, and the wreck removed after.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

console.log('Martyrdom round trip\n');

const units = src('units.ts'), hud = src('matchhud.ts'), main = src('main.ts');

// ---------- The reader ----------
check('it keys on the structured trigger, not on the ability name',
  /eff\.type === 'detonation' && eff\.trigger === 'on_destroyed'/.test(units), true);
// The one thing that makes this reader different from every other owed-reader.
check('and it wants a unit that is NOT alive, which is why it cannot extend autoDetonationsOwed',
  /if \(t\.deployed === false \|\| alive\(t\)\) continue;/.test(units), true);
check('autoDetonationsOwed still filters the opposite way',
  /for \(const t of tokens\.filter\(alive\)\)/.test(units), true);
check('the blast is not narrowed by side', /o\.uid !== t\.uid && alive\(o\) && rangeBetween/.test(units), true);

// ---------- Both screens ----------
check('the Match Centre derives it off the board', /function martyrdomsOwed\(ctx: HudCtx\)/.test(hud), true);
check('and shows it only to the owner', /martyrdomOwed\(ctx\.data, ctx\.state\.tokens\)[\s\S]{0,300}mine\(ctx, x\.t\.side\)/.test(hud), true);
check('it takes the panel ahead of the end-of-attack debts',
  /martyrdomsOwed\(ctx\)\.length\) return martyrdomPanel\(ctx\);[\s\S]{0,400}reactionsOwed\(ctx\)\.length\) return reactionPanel/.test(hud), true);
check('freeplay sweeps for it too', /function sweepMartyrdoms\(\): void/.test(main), true);
check('and the sweep actually runs', /sweepAutoDetonations\(\);\s*\n\s*sweepMartyrdoms\(\);/.test(main), true);
// A separate set: the two triggers are unrelated and the auto-boom one is
// cleared whenever the phase leaves Automatic.
check('freeplay guards it with its own seen-set, not the auto-boom one',
  /const martyrSeen = new Set<number>\(\);/.test(main), true);

// ---------- It reuses the Detonation flow ----------
check('both screens hand off to startDetonation',
  /data-minego="\$\{x\.t\.uid\}" data-mineact="\$\{esc\(x\.actionId\)\}">Resolve the Detonation</.test(hud)
  && /startDetonation\(t, next\.actionId\)/.test(main), true);
// Which is what supplies `destroyAfter: true` for free.
check('and that flow despawns the wreck when it closes',
  /data-act="detdone"[\s\S]{0,300}kind: 'despawn'/.test(hud), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

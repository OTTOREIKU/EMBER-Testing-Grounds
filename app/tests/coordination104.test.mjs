// FAQ 1.04 C8 and C9: when an attacking Action's Command Coordination happens.
//
// C8: a successful Parry with the M4 Combat Claw's Riposte ends the attacker's
// Action Opportunity at once, and Command Coordination comes AFTER the attack,
// so the Riposte skips it. C9: after an attack the attacker's effects resolve
// first and the defender's second, so Coordination comes before the Hunter's
// Target Tracing. Both pages offered it the moment the target was picked,
// before a die was rolled, so neither ruling could hold.
//
// The offer is a dialog and the order is page glue, so these pin the shape of
// the glue on both pages: the attack's Coordination is HELD, a Riposte still
// owed holds it back, a closed Opportunity skips it, and it comes before the
// defender's other reactions.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (s, a, b) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  return i >= 0 && j > i ? s.slice(i, j) : '';
};

console.log('FAQ 1.04 C8/C9: an attack\'s Command Coordination waits for the attack\n');

// ---------- the play guide (the tabletop's guided play) ----------
const guide = src('playguide.ts');
const tryBlock = slice(guide, 'const coord = coordinationFor(this.data, t, row.action);', 'this.cb.onChanged();\n    });');
check('the guide HOLDS an attack\'s Coordination instead of offering it at the pick',
  /if \(row\.action\.type === 'Firing' \|\| row\.action\.type === 'Melee'\) \{\s*this\.coordHeld = \{ uid: t\.uid, upTo: coord \};/.test(tryBlock), true);
check('and still offers any other Action\'s at once', /void this\.offerCoordination\(s, t, coord\)/.test(tryBlock), true);
const settle = slice(guide, '  settleCoordination(): Promise<void> {', '\n  }\n');
check('a Riposte still owed by the same attack holds it back (C7, C8)',
  /r\.kind === 'riposte' && r\.fromUid === p\.uid/.test(settle), true);
check('an Opportunity that has ended skips it (C8)', /s\.script\?\.opp\?\.uid !== p\.uid/.test(settle), true);
check('it runs once, however often it is asked', /if \(this\.coordRun\) return this\.coordRun;/.test(settle), true);
check('and it lapses with the Opportunity', /if \(this\.coordHeld\?\.uid === o\.uid\) this\.coordHeld = null;/.test(guide), true);

// ---------- the tabletop page ----------
const main = src('main.ts');
const prompt = slice(main, '  function renderReactionPrompt(): void {', 'const seat = getLocalSeat();');
check('the defender\'s reactions wait for the held Coordination (C9)',
  /playGuide\.coordinationHeld\(\)/.test(prompt) && /playGuide\.settleCoordination\(\)\.then\(\(\) => renderReactionPrompt\(\)\)/.test(prompt), true);
check('except a Riposte from that attack, which is answered first',
  /r\.kind === 'riposte' && r\.fromUid === held/.test(prompt), true);
check('the attack window\'s close settles one that drew no reactions',
  /checkInterceptFollowUp\(\);[\s\S]{0,420}void playGuide\.settleCoordination\(\);/.test(main), true);

// ---------- the Match Centre ----------
const hud = src('matchhud.ts');
const offerFor = slice(hud, 'function offerCoordinationFor(ctx: HudCtx', '\n}\n');
check('the Match Centre HOLDS an attack\'s Coordination at the commit',
  /if \(act\.type === 'Firing' \|\| act\.type === 'Melee'\) \{\s*coordHeld = \{ uid: t\.uid, upTo \};/.test(offerFor), true);
const hudSettle = slice(hud, 'function settleHeldCoordination(ctx: HudCtx): void {', '\n}\n');
check('it waits while the attack window is open', /ctx\.combatBusy\(\)/.test(hudSettle), true);
check('and while the defender owes a Riposte decision (C7, C8)', /r\.kind === 'riposte' && r\.fromUid === p\.uid/.test(hudSettle), true);
check('and skips it once the Opportunity has ended (C8)', /sc\.opp\?\.uid !== p\.uid/.test(hudSettle), true);
check('every render asks, so the defender\'s answer settles it on arrival',
  /ctx\.syncSide\([^\n]*\);\n\s*\/\/[^\n]*\n\s*settleHeldCoordination\(ctx\);/.test(hud), true);
check('and ending the Opportunity lets it lapse', /if \(t && coordHeld\?\.uid === t\.uid\) coordHeld = null;/.test(hud), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

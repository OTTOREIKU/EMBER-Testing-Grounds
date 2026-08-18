// Riposte / Reposte (050 FCC-12 Grappler, ZHLA-202 M4 Combat Claw) end to end.
// The reader is tested in auras.test.mjs and both command gates in
// commands.test.mjs; this checks the chain.
//
// It is the most invasive ability of phase 4 because both halves reach into the
// turn structure: one ends the OTHER seat's Action Opportunity, and the other
// performs an Action outside any Opportunity at all.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

console.log('Riposte round trip\n');

const units = src('units.ts'), combat = src('combat.ts'), commands = src('commands.ts');
const match = src('match.ts'), main = src('main.ts'), hud = src('matchhud.ts');

// ---------- The trigger: a Parry that HELD, on the Part that made it ----------
check('a Parry was really declared and nothing got through',
  /parried: !!c\.designatedParry && !c\.penetrated \? c\.targetPart : null/.test(combat), true);
check('and the reader is asked about that slot, not about the Mech',
  /ripostePart\(this\.data, defender, parried\)/.test(combat), true);
check('the reader matches the sentence, since the two cards spell the name differently',
  /Successful Parry with this part/.test(units) && /以本部件招架成功时/.test(units), true);

// ---------- Half one: ending the OTHER seat's Opportunity ----------
check('it is a table command, because no seat-scoped one may reach the other turn',
  /'designateHit', 'meleeEvade', 'dodgeEnhance', 'riposte',/.test(commands), true);
check('and the debt is what authorises it',
  /case 'riposte': \{[\s\S]{0,500}r\.kind === 'riposte'/.test(commands), true);
check('it refuses an Opportunity that is no longer open',
  /sc\.opp \|\| sc\.opp\.uid !== cmd\.fromUid/.test(commands), true);
// The two branches of endOpportunity are the rule, not an implementation detail.
check('a nested Extra pops the stack instead of recording an activation',
  /case 'riposte': \{[\s\S]{0,700}sc\.opp = sc\.oppStack\.pop\(\) \?\? null;/.test(commands), true);

// ---------- Half two: the Action outside an Opportunity ----------
check('performAction can be granted', /granted\?: boolean/.test(commands), true);
check('but the flag is never self-authorising — the debt is checked',
  /if \(cmd\.granted\) \{[\s\S]{0,300}r\.kind === 'riposte'\);[\s\S]{0,200}Nothing has granted/.test(commands), true);
check('and it buys a Melee Action only',
  /a\.type !== 'Melee'\) return no\('A Riposte grants a Melee Action/.test(commands), true);
check('the grant is spent by the Action apply, so one Riposte cannot buy two',
  /if \(cmd\.granted && sc\) \{[\s\S]{0,300}sc\.reactions\.splice\(at, 1\);/.test(commands), true);

// ---------- Both screens ----------
check('the Match Centre offers it', /r\.kind === 'riposte'/.test(hud), true);
check('and only lists Melee Actions to pick from',
  /data-ripostego[\s\S]{0,60}<\/button>/.test(hud) && /\.filter\(\(a\) => a\.type === 'Melee'\)/.test(hud), true);
check('the picked Melee rides the ordinary attack pick with the flag set',
  /pendingAction = \{ kind: 'performAction'[\s\S]{0,80}granted: true \};\s*\n\s*startAttackPick/.test(hud), true);
// Pressing it twice must not strand the debt: the first press already ended it.
check('and re-entering does not re-send the ending',
  /ensureScript\(s\)\.opp\?\.uid === r\.fromUid\) \{/.test(hud), true);
check('freeplay offers it too', /r\.kind === 'riposte'/.test(main), true);
check('and opens the Melee directly, since the play guide is built around an Opportunity',
  /granted: true \}\);[\s\S]{0,200}attackHelper\.start\(defender, melee, from/.test(main), true);
check('both senders tag the debt with the attacker',
  /kind: 'riposte' as const, fromUid: attacker\.uid/.test(match)
  && /kind: 'riposte' as const, fromUid: attacker\.uid/.test(main), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

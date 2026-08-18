// Defense Reaction (ZHLA-101 Buckler, ZHLA-301 Heavy Shield) end to end. The
// reader is tested in auras.test.mjs and the command gate in commands.test.mjs;
// this checks the chain, which is the part no unit test reaches.
//
// It is the first reaction triggered by PENETRATION rather than by the Action's
// type, so the flag has to survive to where the debts are written -- and under
// Multi-Target that is the end of the whole Action (FAQ B7), not the end of the
// sequence that got through.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

console.log('Defense Reaction round trip\n');

const combat = src('combat.ts'), commands = src('commands.ts'), types = src('types.ts');
const match = src('match.ts'), main = src('main.ts'), hud = src('matchhud.ts');

// ---------- The trigger ----------
check('the flag is set where the Penetration lands', /c\.penetrated = true;/.test(combat), true);
check('and it is the ONLY gate on this reaction, not the Action type',
  /if \(penetrated\) \{[\s\S]{0,120}defenseReactionOn\(this\.data, defender\)/.test(combat), true);
check('the end of the attack carries it through on the rider',
  /const rider = \{[^}]*penetrated: !!c\.penetrated \}/.test(combat), true);
// Under Multi-Target the sequence's ctx is gone by the time debts are written,
// so the flag is parked on the target entry instead.
check('a Multi-Target parks the flag on the target that took it',
  /this\.multi\.targets\[this\.multi\.index\]; if \(at\) at\.penetrated = true;/.test(combat), true);
check('and reads it back for that same target',
  /this\.reactionsFor\(m\.action, hit, m\.attacker, m\.targets\[m\.index\]\?\.penetrated\)/.test(combat), true);

// ---------- The debt ----------
check('the queue can carry a stance debt', /'smoke' \| 'trace' \| 'stance'/.test(commands), true);
check('and so can the saved state', /'smoke' \| 'trace' \| 'stance'/.test(types), true);
check('both senders tag it',
  /kind: 'stance' as const/.test(match) && /kind: 'stance' as const/.test(main), true);

// ---------- The command ----------
// The reason this is not a setStance: the lock has to keep working for everyone.
check('it is its own command, not a setStance that ignores the lock',
  /\{ kind: 'defenseReaction'; seat: Side; uid: number \}/.test(commands), true);
check('check() enforces the Part, the Stance and the Shutdown bar',
  /case 'defenseReaction': \{[\s\S]{0,600}defenseReactionOn\(data, t\)/.test(commands), true);
check('apply() just sets the Stance', /case 'defenseReaction': \{[\s\S]{0,300}t\.stance = 'defensive';/.test(commands), true);

// ---------- Both screens ----------
check('the Match Centre offers it', /r\.kind === 'stance'/.test(hud), true);
check('and sends the command when taken',
  /if \(stance\) \{[\s\S]{0,200}kind: 'defenseReaction'/.test(hud), true);
check('freeplay offers it too', /r\.kind === 'stance'/.test(main), true);
check('and sends the same command',
  /if \(go\) perform\(data, state, \{ kind: 'defenseReaction'/.test(main), true);
check('declining still clears the debt on both',
  /kind: 'resolveReaction'[\s\S]{0,200}if \(go\) perform/.test(main), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

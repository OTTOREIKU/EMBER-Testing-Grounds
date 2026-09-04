// Target Tracing (174) end to end. The reader has its own tests in
// auras.test.mjs; what is checked here is the chain, which spans six files and
// has TWO separate Electronic Warfare implementations to satisfy — freeplay
// drives combat.ts's ElectronicHelper, the Match Centre drives its own
// counter-roll in shared state. A gap in either is a button that does nothing.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

console.log('Target Tracing round trip\n');

const combat = src('combat.ts'), commands = src('commands.ts'), types = src('types.ts');
const match = src('match.ts'), main = src('main.ts'), hud = src('matchhud.ts');

// ---------- The trigger ----------
// Melee OR Firing, and only from an enemy MECH. Emergency Smoke stays Firing-only.
check('a trace answers Melee or Firing',
  /const meleeOrFiring = action\.type === 'Firing' \|\| action\.type === 'Melee';/.test(combat), true);
check('but only an enemy Mech sets it off',
  /attacker\.kind === 'mech' && attacker\.side !== defender\.side/.test(combat), true);
check('Emergency Smoke is still Firing-only',
  /if \(action\.type === 'Firing'\) out\.push\(\.\.\.attackReactionsOf/.test(combat), true);
check('the attacker is threaded through to the reaction',
  /onReaction: \(defender: Token, reaction: AttackReaction, attacker: Token\)/.test(combat), true);

// ---------- The debt ----------
check('the queue item can say which reaction it is', /kind\?: 'smoke' \| 'trace'[^;]*; fromUid\?: number/.test(commands), true);
check('and the saved state carries the same shape', /kind\?: 'smoke' \| 'trace'[^;]*; fromUid\?: number/.test(types), true);
check('a trace debt must name the attacker to be queued',
  /it\.kind === 'trace' && !state\.tokens\.some\(\(x\) => x\.uid === it\.fromUid\)/.test(commands), true);
check('a reload drops a trace debt with no attacker, rather than stranding the panel',
  /x\.kind !== 'trace' \|\| typeof x\.fromUid === 'number'/.test(types), true);
// An older save has no `kind` at all; those are all Emergency Smoke.
check('an untagged debt is still valid, so old boards keep working',
  /kind\?: 'smoke'/.test(types) && !/kind: 'smoke' \| 'trace';/.test(types), true);

// ---------- Opening the Counter-roll ----------
check('a reaction opening is not gated by the Action Range',
  /if \(!cmd\.reaction && !origins\.some/.test(commands), true);
check('but it must really be one — the rule is in check\(\), not in the button',
  /cmd\.reaction && targetTracingOn\(data, t\)\?\.actionId !== cmd\.actionId/.test(commands), true);

// ---------- Both screens ----------
check('the Match Centre offers it in the reaction panel', /r\.kind === 'trace'/.test(hud), true);
check('and spends the Token by its own command before opening the roll',
  /kind: 'spendCommand'[\s\S]{0,200}kind: 'startCounterRoll'[\s\S]{0,80}reaction: true/.test(hud), true);
check('freeplay offers it too', /r\.kind === 'trace'/.test(main), true);
check('and spends the Token the same way',
  /kind: 'spendCommand'[\s\S]{0,200}electronicHelper\.start\(defender, act, from, \{ linkLoss: 1 \}\)/.test(main), true);
check('both senders tag the debt they write',
  /kind: 'trace' as const, fromUid: attacker\.uid/.test(match)
  && /kind: 'trace' as const, fromUid: attacker\.uid/.test(main), true);

// ---------- The effect ----------
// The card hands out no token, so neither path may fall through to the default.
check('the Match Centre drains a Link instead of applying Fire Control Interference',
  /targetTracingOn\(ctx\.data, init\)\?\.actionId === c\.actionId[\s\S]{0,200}kind: 'drainLink'/.test(hud), true);
check('and freeplay drains it from the contest itself',
  /if \(c\.linkLoss\) \{[\s\S]{0,200}kind: 'drainLink'/.test(combat), true);
check('the helper carries the loss rather than reading a card that has no rules',
  // `then` beside it is the free Scan's callback (FAQ I12), not a card rule.
  /start\(initiator: Token, action: CardAction, responder: Token, opts: \{ linkLoss\?: number; then\?: \(initiatorWins: boolean\) => void \} = \{\}\)/.test(combat), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

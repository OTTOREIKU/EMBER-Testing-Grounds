// IMMOBILIZED (6.3.2) - the movement ban, which used to exist only in freeplay's UI.
//
// The Token has two clauses. The no-Blue-dice clause has always been in
// combat.ts, shared and correct on both boards. THE MOVEMENT BAN was two
// handlers in main.ts and nothing else: zero references in the command layer,
// the Match Centre, or the rules geometry. So an Immobilized unit moved freely
// online, and even in freeplay only the DRAG was refused while the move planner
// opened happily and let the same unit walk.
//
// The rule now lives at the COMMAND, which is what makes it true on both boards
// and against a relayed command. Unstoppable (181) is the printed exception and
// is judged per ACTION, never per card.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = unitsSrc.indexOf('// ---------- IMMOBILIZED, AND THE ONE KEYWORD THAT IGNORES IT ----------');
const end = unitsSrc.indexOf('// ---------- ON-HIT RIDERS');
if (start < 0 || end < 0) throw new Error('could not locate the Immobilized readers in units.ts');
const tmp = new URL('./_immob.slice.ts', import.meta.url);
writeFileSync(tmp, `type CardAction = any;\ntype Token = any;
const statusCount = (list: any[] | undefined, id: string): number => (list ?? []).filter((s) => s === id).length;
` + unitsSrc.slice(start, end));
const U = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Immobilized: the movement ban is a rule now, not a courtesy\n');

const clean = { label: 'Walker', statuses: [] };
const stuck = { label: 'Walker', statuses: ['immobilized'] };

// ---------- the ban itself ----------
check('a clean unit may move', U.immobilizedStop(clean, null), null);
check('an Immobilized unit may not', typeof U.immobilizedStop(stuck, null), 'string');
check('and is told which rule stopped it', /6\.3\.2/.test(U.immobilizedStop(stuck, null)), true);
check('the refusal names changing facing, which is the half players miss',
  /facing/i.test(U.immobilizedStop(stuck, null)), true);
// Stacking: the token stacks, and any number of them still means "cannot move".
check('two tokens ban it just the same',
  typeof U.immobilizedStop({ ...stuck, statuses: ['immobilized', 'immobilized'] }, null), 'string');

// ---------- Unstoppable, the printed exception ----------
// PER ACTION. Card 181 carries the keyword at CARD level but only its Run prints
// it inline; its Sprint does not. Reading the card would exempt both and hand
// the Sprint a rule it has not got.
const run = { id: '181_A', keywords: [{ inline: '异形X' }, { inline: '不可阻挡' }] };
const sprint = { id: '181_B', keywords: [] };
check('the Run is Unstoppable', U.isUnstoppable(run), true);
check('the Sprint on the SAME CARD is not', U.isUnstoppable(sprint), false);
check('so an Immobilized Centaur may still Run', U.immobilizedStop(stuck, run), null);
check('but may not Sprint', typeof U.immobilizedStop(stuck, sprint), 'string');
check('and a bare Maneuver carries no Action, so it can never be Unstoppable',
  typeof U.immobilizedStop(stuck, null), 'string');
check('a clean unit is unaffected either way', U.immobilizedStop(clean, sprint), null);
// The English spelling too, since the data prints both.
check('Unstoppable is read in English as well',
  U.isUnstoppable({ description: { en: '· Unstoppable' } }), true);
check('and unrelated text does not trip it',
  U.isUnstoppable({ description: { en: 'Moving in a straight line' } }), false);

// ---------- where the rule LIVES ----------
{
  const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');

  // THE COMMAND IS THE RULE. Both boards' movers are courtesies on top of it;
  // this is the one that holds against a relayed command from a stale client.
  // 2000, not 1400: the RWS gate (a Mech commanded in the Command Phase does
  // not move) sits between the Shutdown line and the Immobilized one now.
  const man = cmds.slice(cmds.indexOf("case 'maneuver': {"), cmds.indexOf("case 'maneuver': {") + 2000);
  check('the maneuver command refuses an Immobilized unit',
    /immobilizedStop\(t,/.test(man), true);
  // Judged off the Action that TRAVELLED, so a sender cannot claim Unstoppable
  // by omitting it - and cannot lose it by the UI forgetting to pass it.
  check('and judges Unstoppable off the action on the wire',
    /cmd\.actionId \? findAction\(data, state, cmd\.actionId\)|cmd\.actionId \? findAction\(data, state, cmd\.uid, cmd\.actionId\)/.test(man), true);
  check('the command carries the action id at all', /actionId\?: string; flying\?: boolean \}/.test(cmds), true);

  // FORCED MOVEMENT STAYS LEGAL. Being displaced by somebody else is not a
  // Movement Action, which is the whole reason the two are separate commands.
  const force = cmds.slice(cmds.indexOf("case 'forceMove': {"), cmds.indexOf("case 'forceMove': {") + 900);
  check('but forced movement is NOT refused', /immobilizedStop/.test(force), false);

  // Both planners refuse before the player draws a route, so the rule is felt
  // as a message rather than as a move that silently fails on commit.
  check('freeplay refuses to open the move planner', /const stopped = immobilizedStop\(t, opts\.action \?\? null\)/.test(main), true);
  check('and the Match Centre does too', /const stopped = immobilizedStop\(t, opts\.actionId \? actionOn\(ctx, t, opts\.actionId\) : null\)/.test(hud), true);
  // The Match Centre had NOTHING before this - the token simply moved.
  check('the Match Centre now references the rule at all', /immobilizedStop/.test(hud), true);
  // And the Movement Action reaches the gate on both boards, or Unstoppable
  // could never fire and card 181 would lose the rule it exists for.
  check('freeplay hands the Movement Action to the planner',
    // The label names the straight-line bonus when the Action prints one
    // (Jet Dash), so it is a template now; the Action still rides along.
    /startMove\(uid, \{ range, label: `\$\{what\}[\s\S]{0,200}?, airborne: isAirborneAction\(action\), action \}/.test(main), true);
  check('the Match Centre hands over the action id', /actionId: a\.id,/.test(hud), true);
  check('and the plan carries it onto the command it sends', /actionId: m\.actionId/.test(hud), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

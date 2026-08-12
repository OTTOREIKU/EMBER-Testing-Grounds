// Static guards for the two ways multiplayer wiring breaks. Both classes have
// now bitten repeatedly, both are invisible to every behavioural test, and both
// are cheap to catch by reading the source — which is exactly what this does.
//
// CLASS 1 — a local mutation of shared state. If a client changes something
// the fingerprint hashes or check() reads, and never sends a command for it,
// the two boards silently disagree. Caught five times: Black Boxes, Task
// designations, the Tactics hand, Charge Tokens, Interception Tokens.
//
// CLASS 2 — a tool that opens without paying. `routeAction` returning true
// means "the Ticks wait in pendingAction until this tool succeeds", so every
// branch that returns true owes a commitAction somewhere. Caught twice:
// Prototype Blink and the Pholcus Unfold.
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const main = read('main.ts');
const hud = read('matchhud.ts');
const guide = read('playguide.ts');
const secrecy = read('secrecy.ts');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Multiplayer wiring guards\n');

// ---------- Class 1: shared fields must not be assigned by a page ----------
//
// Every token field the fingerprint hashes is a shared fact. A page assigning
// one directly is the bug; the command layer is the only place allowed to.
const FINGERPRINTED = ['charge', 'intercept', 'ammo', 'partStates', 'statuses', 'mech', 'droneBackpack', 'repairedSlots', 'lastDamagedBy', 'expiring'];
for (const field of FINGERPRINTED) {
  // Confirm the field really is hashed, so this list cannot rot into fiction.
  check(`${field} is in the board fingerprint`, secrecy.includes(field), true);
}
// Two assignments are allowed, and only these two: the freeplay mech editor,
// which squads.ts disables the moment a game exists ("Swapping Parts mid-game
// would rewrite a unit the other player has already been shooting at, so the
// editor is a free play tool only"). Counted rather than pattern-matched, so a
// THIRD one anywhere fails even if it looks like these.
const ALLOWED = { 'main.ts': { mech: 1, partStates: 1 } };
for (const [name, src] of [['main.ts', main], ['matchhud.ts', hud], ['playguide.ts', guide]]) {
  for (const field of FINGERPRINTED) {
    // `t.charge = ...` and friends. Reads are fine; assignment is not.
    const writes = [...src.matchAll(new RegExp(`\\b\\w+\\.${field}\\s*=[^=]`, 'g'))].map((m) => m[0].trim());
    check(`${name} assigns .${field} only where allowed`, writes.length, ALLOWED[name]?.[field] ?? 0);
  }
}

// state.tasks is the same story one level up: designations and Terminal access
// decide scoring, and both used to be written in place on the freeplay page.
// The survivors are all `state.tasks = null` — Clear everything and Clear zones,
// board wipes with no game running, so there is no opponent to tell. Setting up
// Tasks travels as `configureTable`; the rule is that nothing here may assign a
// task state, only drop one, so this checks the VALUE rather than the count.
const taskWrites = [...main.matchAll(/state\.tasks = (\w+)/g)].map((m) => m[1]);
check('state.tasks is only ever wiped, never assigned', [...new Set(taskWrites)], ['null']);

// ---------- Class 2: every routeAction branch that returns true pays ----------
//
// The branches are read out of the source rather than listed here, so a new
// tool is covered the day it is written.
const route = hud.slice(hud.indexOf('function routeAction'), hud.indexOf('\nfunction launchPickPanel'));
check('routeAction was located', route.length > 200, true);
// Each `return true` means a tool took over. Either it commits inline, or it
// hands off to a named plan/pick whose resolver commits.
// Each tool routeAction can hand off to, named either inline or through its
// opener. A branch that opens something not on this list is a tool nobody has
// checked pays its Ticks.
const tools = ['chargePlan', 'resupplyPick', 'repairPick', 'openAttackPick', 'blinkPlan', 'startMovePlan', 'startLaunchPlan'];
for (const plan of tools) {
  check(`${plan} is opened by routeAction`, route.includes(plan), true);
}
// The inline one: a branch that both acts and returns true in place, so it has
// nothing later to pay for it.
check('the Unfold branch pays before it returns',
  /commitAction\(ctx\);\s*\n\s*ctx\.send\(\{ kind: 'unfold'/.test(route), true);
// The count of commitAction call sites, so deleting one is loud. Nine tools
// plus the no-tool path: move (x2 — the plan and the route), launch, blink,
// attack, EW, charge, resupply, repair, unfold, and doact's own.
check('every tool has a commitAction', [...hud.matchAll(/commitAction\(ctx\)/g)].length, 11);

// ---------- The ATTRIBUTED seat stamp ----------
//
// A table command is re-stamped with the sender's seat when networked. Any
// whose apply() READS cmd.seat must therefore carry an override, or a choice
// one player drives on another's behalf is recorded as the wrong squad's.
const commands = read('commands.ts');
for (const kind of ['placeSmoke', 'designateTask']) {
  const decl = commands.slice(commands.indexOf(`kind: '${kind}'`));
  check(`${kind} carries a 'for' override past the seat stamp`,
    decl.slice(0, decl.indexOf('\n')).includes('for?: Side'), true);
}
// And the reverse: the set of ATTRIBUTED commands whose apply reads cmd.seat
// must stay exactly those two, so a new one is caught the day it is added.
const attributed = commands.slice(commands.indexOf('const ATTRIBUTED = new Set'), commands.indexOf('function tableLevel'));
// JS regex has no inline (?s), so the dot-all is spelled [\s\S] instead — the
// first version threw "Invalid group" and took the whole file down with it.
const seatSensitive = [...attributed.matchAll(/'(\w+)'/g)].map((m) => m[1]).filter((k) => {
  const open = commands.indexOf(`if (cmd.kind === '${k}')`);
  if (open < 0) return false;
  const end = commands.indexOf('\n  }', open);
  return end > open && /cmd\.seat/.test(commands.slice(open, end));
});
check('only placeSmoke and designateTask read their seat when applied',
  seatSensitive.sort(), ['designateTask', 'placeSmoke']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

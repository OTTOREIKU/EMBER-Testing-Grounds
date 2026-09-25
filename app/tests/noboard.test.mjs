// A table with NO BOARD (the pad): the engine's positional rules are left to
// the table, and the sweeps that would misfire on placeholder cells are off.
// Pinned against the source, because each gate is a one-line condition that a
// tidy-up could drop without any driven test noticing until a pad game scored
// a zone nobody stood in.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('No board\n');

const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const secrecy = readFileSync(new URL('../src/secrecy.ts', import.meta.url), 'utf8');
const pad = readFileSync(new URL('../pad/pad.ts', import.meta.url), 'utf8');

check('the flag is a table field', /noBoard\?: boolean;/.test(types), true);
check('configureTable carries it', /roundLimit\?: number; noBoard\?: boolean \}/.test(cmds), true);
check('and writes it', /if \(cmd\.noBoard !== undefined\) state\.noBoard = cmd\.noBoard \? true : undefined;/.test(cmds), true);
check('a checkpoint keeps it', /\.\.\.\(\(s as \{ noBoard\?: boolean \}\)\.noBoard \? \{ noBoard: true \} : \{\}\)/.test(units), true);
check('the fingerprint hashes it, so two phones agree they have none', /s\.noBoard \?\? null/.test(secrecy), true);

// The two per-command sweeps: a tether measured between placeholders never
// parts, one High Temperature card would stamp every unit at once.
check('the tether sweep stops at the flag',
  /export function settleTethers\(data: GameData, state: GameState\): void \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(state\.noBoard\) return;/.test(units), true);
check('so does the environment sweep',
  /export function settleEnvironments\(data: GameData, state: GameState\): EnvEvent\[\] \{\s*\n\s*const events: EnvEvent\[\] = \[\];\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(state\.noBoard\) return events;/.test(units), true);
// And apply() still runs both after every command (tether.test pins the pair).
check('while apply keeps one sweep per command',
  /applyCommand\(data, state, cmd\);\s*\n\s*settleTethers\(data, state\);/.test(cmds), true);
// Zone control is read off the board; the by-hand claim is the record.
check('the End Phase task step does not settle control without a board', /cmd\.step === 'tasks' && !state\.noBoard/.test(cmds), true);
check('nor does the Award', /if \(!state\.noBoard\) settleControl\(tasks, zoneCells\(data, state\)/.test(cmds), true);
// The Maneuver cannot measure a distance, so the Tick is spent and no free
// pre-move is handed out.
// takeMoveGrant rides between them since the Phase 2 audit (B8): a `free` or
// `granted` boardless move still takes the grant that authorised it.
check('a boardless Maneuver spends the Tick outright',
  /case 'maneuver': \{[\s\S]{0,900}?if \(state\.noBoard\) \{[\s\S]*?sc\.opp = lockStance\(t, spendManeuver\(o0\)\);\s*\n\s*takeMoveGrant\(state, cmd\);\s*\n\s*return;/.test(cmds), true);
// One Non-Humanoid charge, paid before the branch (nonhumanoid.test counts it).
check('and the Link is paid once, above the branch',
  /const cost = nonHumanoidCost\([^\n]*\n\s*if \(cost > 0\)[^\n]*\n\s*if \(state\.noBoard\) \{/.test(cmds), true);
check('and never writes a position', /if \(state\.noBoard\) \{[\s\S]{0,900}?return;\s*\n\s*\}\s*\n\s*const from = cmd\.from \?\? \{ col: t\.col, row: t\.row \};/.test(cmds), true);
check('Forced Movement keeps facing and Link but not the cell', /if \(!state\.noBoard\) \{\s*\n\s*target\.col = cmd\.to\.col;\s*\n\s*target\.row = cmd\.to\.row;\s*\n\s*\}/.test(cmds), true);
check('the tether leash is not judged without a board', /const leash = state\.noBoard \? null : tetherCap\(t, state\.tokens\);/.test(cmds), true);
check('the electronic Range is the table\'s to judge', /if \(!cmd\.reaction && !origins\.some\(\(from\) => gridRange\(from, target\) <= reach\) && !state\.noBoard\)/.test(cmds), true);
check('placing in a Grid is refused', /case 'placeInGrid': \{\s*\n\s*if \(state\.noBoard\) return no\(/.test(cmds), true);
check('so is the Crush exchange', /case 'crushSwap': \{\s*\n\s*if \(state\.noBoard\) return no\(/.test(cmds), true);

// What the flag deliberately does NOT touch: the attack path never read a
// position in check(), so it needs no gate - and none was added.
check('performAction stays ungated', /case 'performAction': \{[\s\S]{0,3000}?noBoard/.test(cmds.slice(cmds.indexOf("case 'performAction': {"), cmds.indexOf("case 'performAction': {") + 3000)), false);
check('applyPenetration stays ungated', /noBoard/.test(cmds.slice(cmds.indexOf("case 'applyPenetration': {"), cmds.indexOf("case 'applyPenetration': {") + 1200)), false);

check('the pad\'s tables are born without a board', /noBoard: true,\s*\n\s*\};\s*\n\}\s*\n\s*\nlet table: GameState = freshTable\(\);/.test(pad), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

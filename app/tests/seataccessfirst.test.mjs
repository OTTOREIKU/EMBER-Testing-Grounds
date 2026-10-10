// A TERMINAL ITS SQUAD HOLDS, SECURED (2026-10-10; the challenger's game 7, AI-OPPONENT-PLAN.md finding 17). A
// Terminal is accessed once a round, by whoever comes first; the side alone in its zone has it only at the End Phase,
// and a Mech within 4 of the zone can Remote Access it before then. In game 7 my Remote Accesses spent Bravo and Echo
// under the Ace's lone Mechs, because tactician.ts `access` priced a held zone's Terminal at nothing. With
// `accessFirst` (OFF until measured) it is worth securing where an enemy Mech can still take it first
// (`terminalAtRisk`).
import { readFileSync } from 'node:fs';
import { loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A held Terminal, secured\n');

const { M } = await loadEngine('seataccessfirst', ["export * as AI from '../src/ai/index';"]);
const AI = M.AI;

// Echo of game 7: F6 G6 F7 G7, the Ace (s2) holding it; my Mech B at G2 (4 from G6).
const echo = { id: 'echo', name: 'Echo', scoring: true, holder: 's2', cells: ['5,5', '6,5', '5,6', '6,6'] };
const mech = (side, col, row, extra = {}) => ({ side, kind: 'mech', alive: true, deployed: true, done: false, dialHidden: false, timing: 'tactical', grid: { col, row }, ...extra });
const view = (units) => ({ seat: 's2', other: 's1', units, zones: [echo] });

check('an enemy Mech 4 from the zone, its turn to come, on a Tactical dial: at risk', AI.terminalAtRisk(echo, view([mech('s1', 6, 1)]), 4), true);
check('5 from it: not', AI.terminalAtRisk(echo, view([mech('s1', 6, 0)]), 4), false);
check('its turn behind it: not', AI.terminalAtRisk(echo, view([mech('s1', 6, 1, { done: true })]), 4), false);
check('a Firing dial, shown: not (the Remote Access is a Tactical Action)', AI.terminalAtRisk(echo, view([mech('s1', 6, 1, { timing: 'firing' })]), 4), false);
check('a dial not yet shown: at risk', AI.terminalAtRisk(echo, view([mech('s1', 6, 1, { timing: 'firing', dialHidden: true })]), 4), true);
check('a Movement dial (Flexible Timing reaches Tactical): at risk', AI.terminalAtRisk(echo, view([mech('s1', 6, 1, { timing: 'movement' })]), 4), true);
check('an enemy Drone: not (only a Mech Remote Accesses)', AI.terminalAtRisk(echo, view([{ ...mech('s1', 6, 1), kind: 'drone' }]), 4), false);
check('a Mech of its own squad: not', AI.terminalAtRisk(echo, view([mech('s2', 6, 1)]), 4), false);
check('a destroyed Mech: not', AI.terminalAtRisk(echo, view([mech('s1', 6, 1, { alive: false })]), 4), false);
check('no Terminals on the table (reach 0): not', AI.terminalAtRisk(echo, view([mech('s1', 6, 1)]), 0), false);

check('the skill is OFF unless named', AI.SKILLS.accessFirst, false);
const tac = readFileSync(new URL('../src/ai/tactician.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = tac.slice(tac.indexOf('function access('), tac.indexOf('\n}\n', tac.indexOf('function access(')));
check('access secures a held Terminal at risk only with the skill, and as one nobody holds',
  [body.includes('const atRisk = zone.holder === c.view.seat && c.skills.accessFirst && terminalAtRisk(now, c.view, task.reach);'),
    body.includes('const gain = zone.holder === c.view.seat ? (atRisk ? 1 : 0) : zone.holder ? 2 : 1;')], [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

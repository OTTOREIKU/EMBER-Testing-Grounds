// THE COMBAT WINDOW READS AN ATTACK'S EFFECTIVE RANGE (2026-10-14, played on the table against the Ace): an RT-12T
// Oasis Tactical Core's Firing Coordination gives the Firing Actions of the Mechs in its aura +1 Range, its own Mech's
// too (a unit is its own ally, FAQ Q4), so the engine let an R-35 Heavy Railgun (Range 12) shoot at Range 13. The Match
// Centre's window, reading the printed number, said "beyond action range (R12)" over a legal shot. Freeplay's own
// reading already passed the effective Range in.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The combat window reads the effective Range\n');

const { M, data } = await loadEngine('auranote', ["export * as TURN from '../src/turn';"]);
data.solo.squads['t-oasis'] = {
  name: 'Oasis', faction: 'RDL', points: 0,
  mechs: [{ name: 'Oasis', loadout: { torso: '558', chasis: '020', leftHand: '029', rightHand: '043', pilot: 'FPA-06' } }],
  drones: [],
};
data.solo.squads['t-mark'] = {
  name: 'Mark', faction: 'UN', points: 0,
  mechs: [{ name: 'Mark', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-auranote', map: 'none', mission: 'none', seats: { s1: 't-oasis', s2: 't-mark' } };
const t = tableAtRoundOne(M, data, scenario);
if (t.refused.length) throw new Error(t.refused.join('; '));
const s = t.state;
const oasis = s.tokens.find((x) => x.label === 'Oasis');
const mark = s.tokens.find((x) => x.label === 'Mark');
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
// Facing south, the target down and across: in the Forward Arc, 13 Grids off, nothing between.
at(oasis, 0, 0, 2); at(mark, 6, 7, 0);
const note = (mark) => M.TURN.attackOpening(data, s, oasis.uid, '043_A', mark.uid)?.note ?? '';
const n13 = note(mark);
check('THE STAGE: the R-35 prints Range 12 and the Oasis aura reaches its own Mech (+1)',
  [data.byId.get('043').actions[0].range, M.U.actionRange(data, s.tokens, oasis, data.byId.get('043').actions[0])], [12, 13]);
check('AT RANGE 13 the window gives no range warning', [/Range 13/.test(n13), n13.includes('beyond action range')], [true, false]);
at(mark, 7, 7);
const n14 = note(mark);
check('AT RANGE 14 it warns, and names the effective Range', [/Range 14/.test(n14), n14.includes('beyond action range (R13)')], [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

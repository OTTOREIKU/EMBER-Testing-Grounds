// A MECH WITH AN RWS PART, A ROUND ON (`rwsNext`, 2026-10-13). OTTO: the community builds around the Ls197R
// Autocannon of the Crisis II box, "trying to have this unit shoot as many times in a round as possible". An Ally may
// send such a Mech a Command in the Command Phase to fire it, once for each such Part a round (遥控武器, FAQ A20/A22;
// Supplementary Rules 1.04, 3.4), and the Command Phase begins the round: nothing moves first, so a Crisis that ends
// its turn out of Range fires nothing on a Command. The engine opens that turn for the look ahead (`later` with
// 'command', for a Mech its RWS Actions alone), and the Tactician reads it at `rwsNext` for each RWS Part.
//
// Staged on the real engine, on an empty board, in round 1's Action Phase: a Crisis II (both autocannons, Range 6)
// with its Opportunity open, seven Grids from UN's Rifle: one Grid of its Maneuver from Range.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An RWS Mech, a round on\n');

const { M, data } = await loadEngine('seatrws', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-crisis'] = {
  name: 'Crisis', faction: 'RDL', points: 0,
  mechs: [{ name: 'Crisis', loadout: { torso: '547', chasis: '548', leftHand: '550', rightHand: '551', pilot: 'XPA-59' } }],
  drones: [],
};
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-rws', map: 'none', mission: 'none', seats: { s1: 't-crisis', s2: 't-rifle' } };
const t = botTable(M, data, scenario, { seed: 5, policies: AI.eagerPolicy });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
at(U.Crisis, 4, 1, 2); at(U.Rifle, 4, 8, 0);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
s.script.revealed = ['s1', 's2'];
s.script.acted = [U.Rifle.uid];
s.script.opp = null;
M.G.opportunity(data, s);
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
const crisis = view.units.find((u) => u.uid === U.Crisis.uid);
const rws = crisis.weapons.filter((x) => x.rws);
check('THE STAGE: the Crisis\'s Opportunity is open; it carries two RWS Parts of Range 6, seven Grids from the Rifle',
  [d?.kind, d?.unit === U.Crisis.uid, rws.length, rws.map((x) => x.printed)], ['opp.act', true, 2, [6, 6]]);
check('and the Rifle carries none', view.units.find((u) => u.uid === U.Rifle.uid).weapons.some((x) => x.rws), false);

// The engine's half: the turn a Command would open at the next Command Phase.
const near = (g) => Math.abs(g.c - 4) + Math.abs(g.r - 8) <= 6;
const walks = d.options.filter((o) => o.tags[0] === 'move' && o.facts?.to);
// (A walk ends facing one way: the shots need the Rifle in the arc as well as in Range.)
const shotsAt = (o) => [...new Set((o?.later?.(['attack'], 'command')?.options ?? []).filter((x) => x.tags.includes('attack')).map((x) => x.facts?.actionId))].sort();
const inReach = walks.find((o) => near(o.facts.to) && shotsAt(o).length > 0);
const outs = walks.filter((o) => !near(o.facts.to));
check('A COMMAND A ROUND ON, from a Grid in Range: each autocannon\'s Single Shot is on offer, and nothing else',
  [!!inReach, shotsAt(inReach), (inReach?.later?.(['attack', 'move'], 'command')?.options ?? []).some((x) => x.tags[0] === 'move')], [true, ['550_A', '551_A'], false]);
check('from every Grid out of Range, nothing', [outs.length > 0, outs.every((o) => shotsAt(o).length === 0)], [true, true]);
check('and a Mech with no RWS Part has no such turn', d.here().turnOf(U.Rifle.uid, ['attack'], 'command'), null);

// The Tactician's half: what each plan is worth a turn on, without and with it.
const nexts = (rwsNext) => {
  const out = new Map();
  for (const p of AI.weighed(d, view, {}, { rwsNext })) {
    const k = `${p.at.col},${p.at.row}`;
    out.set(k, Math.max(out.get(k) ?? -Infinity, p.next));
  }
  return out;
};
{
  const off = nexts(0), on = nexts(1);
  const both = [...on.keys()].filter((k) => off.has(k)).map((k) => ({ g: { c: Number(k.split(',')[0]), r: Number(k.split(',')[1]) }, gain: on.get(k) - off.get(k) }));
  const ins = both.filter((x) => near(x.g)), outs = both.filter((x) => !near(x.g));
  check('WITH IT a Grid in Range of the Rifle is worth more a turn on (what the two Commands could fire there); a Grid out of Range the same',
    [ins.length > 0 && ins.every((x) => x.gain > 0), outs.length > 0 && outs.every((x) => Math.abs(x.gain) < 1e-9)], [true, true]);
}
check('as it ships (2026-10-13): 0 until measured', AI.TACTICIAN.rwsNext, 0);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

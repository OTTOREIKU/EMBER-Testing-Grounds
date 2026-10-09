// THE LONE WOLF (`lanes`, 2026-10-09; a community player's notes with RDL_DroneEscort: most objective maps have three
// lanes, most squads hold one and contest the middle, "if you are able to contest 2 lanes you tend to win most of the
// time", so keep one "Lone Wolf"; OTTO: "try the strategy of hold 1 and push off enemy with solo unit").
//
// On a Main Task that scores zones, of the squad's units that hold zones the one with the longest walk (and of equals
// the most points standing) goes alone: the zone the rest of the squad is around is not its to walk to. Staged on the
// copied Alley (Forward Advance: Bravo B6-C7, Echo F6-G7, Hotel J6-K7 across the middle of the board): of the RDL
// Mechs the other above Bravo (B3), the wolf in D3 between Bravo and Echo, the UN squad far down the board; the
// wolf's Opportunity on a Movement dial, the pull of its walk toward each zone weighed with the skill and without.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The lone wolf\n');

const { M, data } = await loadEngine('seatlanes', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const t = botTable(M, data, { ...data.solo.scenarios[0] }, { seed: 3, policies: { s1: AI.tacticianPolicy, s2: AI.tacticianPolicy } });
await t.run({ maxSteps: 8000, until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && M.TY.PHASES[st.round.phase] === 'Action' });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; x.deployed = true; };
at(U['Wild Cat'], 10, 11, 0); at(U['ADK15P Porcupine Ion Type'], 11, 11, 0); at(U['ADK60S Raven Interference Type'], 9, 11, 0); at(U['ADK30C Tarantula Carrier Type'], 8, 11, 0);
const view0 = M.SEAT.viewOf(data, s, 's1');
const stride = (u) => u.move + Math.max(0, ...u.weapons.filter((x) => x.usable && x.type === 'Moving').map((x) => x.range));
const mire = view0.units.find((u) => u.label === 'Mire');
const dune = view0.units.find((u) => u.label === 'Dune');
const wolf = stride(mire) !== stride(dune) ? (stride(mire) > stride(dune) ? U.Mire : U.Dune) : (mire.points * mire.health >= dune.points * dune.health ? U.Mire : U.Dune);
const body = wolf === U.Mire ? U.Dune : U.Mire;
// The other Mech above Bravo (B3), the wolf between Bravo and Echo (D3): a walk west is nearer Bravo, one east nearer Echo.
at(wolf, 3, 2, 2); at(body, 1, 2, 2);
wolf.timing = 'movement'; body.timing = 'movement'; U['Wild Cat'].timing = 'firing';
s.script.turn = 's1';
s.script.acted = [body.uid];
s.script.opp = M.TY.newOpportunity(wolf.uid, 'movement');
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, s, 's1');
const zoneOf = (g) => view.zones.find((z) => z.scoring && z.cells.includes(`${g.col},${g.row}`))?.name ?? null;
const near = (g, name) => Math.min(...view.zones.find((z) => z.name === name).cells.map((c) => c.split(',').map(Number)).map(([c, r]) => Math.abs(g.col - c) + Math.abs(g.row - r)));
const bestOf = (rows) => rows.filter((r) => r.priced).reduce((a, b) => (!a || b.worth > a.worth ? b : a), null);
const offRows = M.SEAT.pondering(() => AI.weighed(d, view));
const onRows = M.SEAT.pondering(() => AI.weighed(d, view, { lanes: true }));
const off = bestOf(offRows);
const on = bestOf(onRows);
// The pull of the walk (each plan's `shape`) toward each zone: the best of the plans ending nearer it than the other.
const pull = (rows, to, from) => Math.max(...rows.filter((r) => r.how === 'move' && near(r.at, to) < near(r.at, from)).map((r) => r.shape));
check('THE STAGE: the wolf is asked its Opportunity, the zones are the three of Forward Advance, held by nobody',
  [d?.kind, d?.unit === wolf.uid, view.zones.filter((z) => z.scoring).map((z) => [z.name, z.holder ?? z.control]).sort()], ['opp.act', true, [['Bravo', null], ['Echo', null], ['Hotel', null]]]);
console.log(`       the wolf ${wolf.label}; without: ${off?.label} (${off?.at.col},${off?.at.row}); with: ${on?.label} (${on?.at.col},${on?.at.row})`);
console.log(`       the pull toward Bravo / Echo: without ${pull(offRows, 'Bravo', 'Echo').toFixed(2)} / ${pull(offRows, 'Echo', 'Bravo').toFixed(2)}, with ${pull(onRows, 'Bravo', 'Echo').toFixed(2)} / ${pull(onRows, 'Echo', 'Bravo').toFixed(2)}`);
const same = (a, b) => Math.abs(a - b) < 1e-9;
check('as it ships there is no `lanes`, and Bravo draws the wolf’s walk as Echo does',
  [AI.SKILLS.lanes, Math.abs(pull(offRows, 'Bravo', 'Echo') - pull(offRows, 'Echo', 'Bravo')) < 0.5], [false, true]);
check('WITH IT the zone the rest of the squad is around no longer draws its walk: toward Bravo it is worth what Bravo drew less, toward Echo the same, and Echo now draws it',
  [pull(offRows, 'Bravo', 'Echo') - pull(onRows, 'Bravo', 'Echo') > 0.5, same(pull(offRows, 'Echo', 'Bravo'), pull(onRows, 'Echo', 'Bravo')), pull(onRows, 'Echo', 'Bravo') > pull(onRows, 'Bravo', 'Echo')],
  [true, true, true]);
{
  // The other Mech is no wolf: it weighs its walk as it did.
  s.script.acted = [wolf.uid];
  s.script.opp = M.TY.newOpportunity(body.uid, 'movement');
  const d2 = t.drivers.s1.pending();
  const v2 = M.SEAT.viewOf(data, s, 's1');
  const same = (a, b) => JSON.stringify(a.map((p) => [p.label, p.worth])) === JSON.stringify(b.map((p) => [p.label, p.worth]));
  check('the rest of the squad weighs every plan as it did', [d2?.unit === body.uid, same(M.SEAT.pondering(() => AI.weighed(d2, v2)), M.SEAT.pondering(() => AI.weighed(d2, v2, { lanes: true })))], [true, true]);
}
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

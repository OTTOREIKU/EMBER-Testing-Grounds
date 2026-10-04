// A LOAD LENT, AND A BETTER TARGET (OTTO's playtest, 2026-10-03;
// AI-OPPONENT-PLAN.md, "OTTO'S FIRST PLAYTEST", notes 1 and 2).
//
// A Carrier lends its Load to the Ally Mechs in Contact with it (162: "Ally
// Mechs in Contact with this drone may regard the Load of this drone as their
// own Part when they perform actions"), and Contact is bases meeting edge to
// edge (rules.ts inContact). The engine's own spot in a Grid leans the way the
// walk came in and met a Mech only by chance, and nothing priced a Load, so the
// computer's Carrier sat in a corner all game. Now the seam offers, for a Drone
// carrying a whole Load, each Movement and each deployment also set down
// against an Ally Mech beside it (tag `lend`), and marks an answer whose own
// spot touches one already (`lendsTo`); the Tactician's weight `lend` prices a
// Grid by what the Load adds to that Mech's next turn there, as the engine
// reckons it. And the Raven backed away from a wall it could jam from: every
// enemy in reach was counted as shooting it. With `decoy`, an enemy with a
// better target of this squad's in its sights shoots this unit only as often
// as it is worth against that one. Each check names the weights it is put
// to; what they are as shipped is checked last.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Load lent, and a better target\n');

const { M, data } = await loadEngine('seatlend', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const CARRIER = 'ADK30C Tarantula Carrier Type';
const RAVEN = 'ADK60S Raven Interference Type';

// A copied game played to round 1's Command Phase, then staged: the RDL Mechs
// up the board facing south, the Wild Cat (its R7K Tactical Rifle a Laser), the
// UN Drones where asked, and `unit` Commanded. The Carrier's Load is a CSC60
// Cooler: +1 Yellow to a Laser Firing Action.
const staged = async ({ scenario = 1, weights = {}, unit = CARRIER, cat = [5, 8], car = [3, 9], raven = [10, 11], mire = [4, 3], dune = [7, 3] } = {}) => {
  const t = botTable(M, data, data.solo.scenarios[scenario], { seed: 1, policies: { s1: AI.brawlerPolicy, s2: AI.makeTactician({}, weights) }, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => st.setup?.stage === 'done' && st.script && M.TY.PHASES[st.round.phase] === 'Command' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, [c, r], f) => { x.col = c * 3; x.row = r * 3; x.facing = f; x.deployed = true; };
  at(U['Wild Cat'], cat, 0); at(U[CARRIER], car, 0); at(U[RAVEN], raven, 0);
  at(U.Mire, mire, 2); at(U.Dune, dune, 2); at(U['ADK15P Porcupine Ion Type'], [9, 10], 0);
  const me = U[unit];
  s.round.phase = M.TY.PHASES.indexOf('Command');
  s.script.stage = `${s.round.n}:${s.round.phase}`;
  s.script.turn = 's2'; s.script.acted = []; s.script.passed = [];
  s.script.commanded = [me.uid];
  s.script.opp = M.TY.newOpportunity(me.uid, undefined);
  return { t, s, U, d: t.drivers.s2.pending(), view: M.SEAT.viewOf(data, s, 's2') };
};
const lastMove = (o) => [...(o.commands ?? [])].reverse().find((x) => x.kind === 'maneuver');
const touching = (s, uid, spot, other) => M.R.inContact({ ...s.tokens.find((x) => x.uid === uid), col: spot.col, row: spot.row }, other);
// The best Penetration a Firing attack of the Wild Cat's has at its next turn,
// on the table an answer leaves.
const bestPen = (out, cat) => Math.max(0, ...(out?.turnOf(cat.uid, ['attack'], 'firing')?.options ?? []).filter((o) => o.run?.routine === 'attack').map((o) => o.chance?.()?.pen ?? 0));

{
  // THE SEAM. The Intersection, the Wild Cat at F9, the Carrier at D10.
  const { t, s, U, d, view } = await staged();
  const cat = U['Wild Cat'];
  const unitView = (label) => view.units.find((u) => u.label === label);
  check('a Drone carrying a whole Load lends (the view says so); a Drone without one, and a Mech, do not',
    [unitView(CARRIER)?.lends, unitView(RAVEN)?.lends, unitView('Wild Cat')?.lends], [true, false, false]);
  const lent = d.options.filter((o) => o.tags.includes('lend'));
  check('the Carrier is offered its Movements set down against the Wild Cat beside where they end, each saying so',
    [lent.length > 0, lent.every((o) => o.label.endsWith(', against Wild Cat') && o.facts?.lendsTo === cat.uid && o.tags[0] === 'move')], [true, true]);
  check('each such answer puts its base against the Wild Cat\'s (Contact: the bases meet edge to edge)',
    lent.every((o) => { const m = lastMove(o); return !!m && touching(s, U[CARRIER].uid, m.to, cat); }), true);
  const twin = (o) => d.options.find((x) => x.id === o.id.replace(/:lend$/, ''));
  check('and is offered only where the same Movement\'s own spot would not have touched it',
    lent.every((o) => { const p = twin(o); const m = p && lastMove(p); return !!p && !p.tags.includes('lend') && p.facts?.lendsTo === undefined && !!m && !touching(s, U[CARRIER].uid, m.to, cat); }), true);
  const plainMoves = d.options.filter((o) => o.tags[0] === 'move' && !o.tags.includes('lend'));
  const ownTouch = plainMoves.filter((o) => { const m = lastMove(o); return !!m && touching(s, U[CARRIER].uid, m.to, cat); });
  check('a Movement whose own spot touches the Wild Cat already says so (and has no twin); one whose spot does not, does not',
    [ownTouch.length > 0, ownTouch.every((o) => o.facts?.lendsTo === cat.uid && !d.options.some((x) => x.id === `${o.id}:lend`)),
      plainMoves.filter((o) => !ownTouch.includes(o)).every((o) => o.facts?.lendsTo === undefined)], [true, true, true]);
  const e9 = d.options.find((o) => o.id.startsWith('move:') && o.id.endsWith(':lend') && o.facts?.to?.c === 4 && o.facts?.to?.r === 8);
  check('the engine says what the Load adds: on the table the move against the Wild Cat leaves, its rifle Penetrates more often than on the one the same move leaves without Contact',
    [!!e9, e9 ? bestPen(e9.after?.(), cat) > bestPen(twin(e9)?.after?.(), cat) : null], [true, true]);
  // THE TACTICIAN. With both weights at 0 the Load is no reason to stand anywhere.
  const OFF = { lend: 0, decoy: 0 };
  const off = AI.makeTactician({}, OFF).choose(d, view, new AI.Rng('x'));
  check('with `lend` 0 and `decoy` 0 the Carrier stays where it is: a move into Contact is weighed as before, and the answers set down against a Mech not at all',
    [d.options.find((o) => o.id === off.option)?.tags.includes('lend') ?? false, off.reason], [false, 'end_activation']);
  const rows = (tune) => M.SEAT.pondering(() => AI.weighed(d, view, undefined, tune));
  check('with `lend` 0 not one of the plans the Carrier weighs is a Movement set down against a Mech; with `lend` they are among them',
    [rows(OFF).some((p) => p.label.endsWith(', against Wild Cat')), rows({ lend: 2 }).some((p) => p.label.endsWith(', against Wild Cat'))], [false, true]);
  const atE9 = (tune) => rows(tune).find((p) => p.how === 'move' && p.at.col === 4 && p.at.row === 8 && p.priced);
  const plain = atE9({ lend: 2, decoy: 0 });
  const shielded = atE9({ lend: 2, decoy: 2 });
  check('with `lend`, standing against the Wild Cat is worth what the Load adds to its next shot; the RDL Mechs would shoot the Carrier there all the same (`decoy` 0)',
    [plain?.next > 0, plain?.risk > 0.5], [true, true]);
  check('with `decoy` the enemy that has the Wild Cat in its sights is counted as shooting the Carrier beside it far less often',
    [!!shielded, shielded ? shielded.risk < plain.risk / 2 && shielded.cost < plain.cost : null], [true, true]);
  const both = AI.makeTactician({}, { lend: 2, decoy: 2 }).choose(d, view, new AI.Rng('x'));
  check('and with both, the Carrier is Commanded against the Wild Cat',
    [d.options.find((o) => o.id === both.option)?.facts?.lendsTo, both.reason], [cat.uid, 'move_to_strike_next']);
  t.close();
}
{
  // A Drone with no Load is offered no such answer.
  const { t, d } = await staged({ unit: RAVEN, raven: [3, 9], car: [10, 11] });
  check('the Raven, which carries no Load, is offered nothing set down against a Mech', [d?.kind, d?.options.some((o) => o.tags.includes('lend'))], ['activation.act', false]);
  t.close();
}
{
  // DEPLOYMENT. With `lend`, a Drone with a Load is set down after the Mechs it
  // could lend it to, and against one; the seam offers that spot.
  const offered = [];
  const t = botTable(M, data, data.solo.scenarios[0], { seed: 1, policies: { s1: AI.brawlerPolicy, s2: AI.makeTactician({}, { lend: 2 }) }, glue: M.HUD.glueAfter });
  await t.run({
    until: (st) => st.setup?.stage === 'done' && st.script && M.TY.PHASES[st.round.phase] === 'Command',
    onStep: (seat, r) => { if (seat === 's2' && r.decision.kind === 'setup.deploy') offered.push(...r.decision.options.filter((o) => o.facts?.lendsTo !== undefined)); },
  });
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const put = (o) => o.commands.find((x) => x.kind === 'deployUnit');
  check('once the Wild Cat is down, the deployment offers the Carrier spots touching it, each saying so (its own spot, or one set down against it)',
    [offered.length > 0, offered.every((o) => o.facts.uid === U[CARRIER].uid && o.facts.lendsTo === U['Wild Cat'].uid && M.R.inContact({ ...U[CARRIER], col: put(o).to.col, row: put(o).to.row }, U['Wild Cat']))], [true, true]);
  check('and with `lend` the Carrier is put down touching the Wild Cat, which then has its Load',
    [M.R.inContact(U[CARRIER], U['Wild Cat']), M.U.loanedParts(data, t.state.tokens, U['Wild Cat']).length > 0], [true, true]);
  t.close();
}
{
  // A BETTER TARGET. The Raven behind the high wall in F3, the RDL Mechs north of
  // it: the Dune at G2 sees round the end of the wall to F4.
  const raven = async (cat) => {
    const { t, d, view } = await staged({ scenario: 0, unit: RAVEN, raven: [5, 3], car: [8, 10], mire: [5, 0], dune: [6, 1], cat });
    const stay = (tune) => M.SEAT.pondering(() => AI.weighed(d, view, undefined, tune)).find((p) => p.how === 'stay');
    const out = [stay({ decoy: 0 }), stay({ decoy: 1 }), stay({ decoy: 2 })];
    t.close();
    return out;
  };
  const [alone0, alone1, alone2] = await raven([5, 9]);
  check('with nothing else of the squad\'s in an enemy\'s sights, the Raven behind the wall is what it would shoot, `decoy` or not',
    [alone0.cost > 0, alone1.cost === alone0.cost && alone2.cost === alone0.cost, alone1.risk === alone0.risk], [true, true, true]);
  const [open0, open1, open2] = await raven([8, 4]);
  check('with the Wild Cat in the open in the Dune\'s sights, the Raven behind the wall is counted as shot less often, and less again at a higher `decoy`',
    [open1.cost < open0.cost, open2.cost < open1.cost, open1.risk < open0.risk, open2.risk < open1.risk], [true, true, true, true]);
}
{
  // AS SHIPPED.
  check('as shipped, `lend` and `decoy` are what was measured in (AI-OPPONENT-PLAN.md, "OTTO\'S FIRST PLAYTEST")',
    [AI.TACTICIAN.lend, AI.TACTICIAN.decoy], [2, 1]);
  const { t, d, view } = await staged();
  const shipped = AI.tacticianPolicy.choose(d, view, new AI.Rng('x'));
  check('so as shipped the Carrier on the Intersection is Commanded against the Wild Cat, which has its Load',
    [d.options.find((o) => o.id === shipped.option)?.facts?.lendsTo, shipped.reason], [view.units.find((u) => u.label === 'Wild Cat')?.uid, 'move_to_strike_next']);
  t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

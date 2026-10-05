// AN ENEMY THAT SPRINTS FIRST, AND THE BOXES A PLAN PICKS UP (AI-OPPONENT-PLAN.md,
// "THE NIGHT OF 2026-10-04"; the Tactician's skills `sprints` and `held`).
// Only the Starting Action of an Opportunity must match the dial (3.4.3): with
// the Ticks left any Action may follow it, so a Mech dialled to Movement may
// Sprint and then strike. The exposure asked such an enemy's turn on the
// Movement Timing, where no attack is live before the Sprint, and read it as no
// danger this round. And a plan that picks up Boxes was priced on the unit as
// it stood, empty-handed, so what a Penetration there would drop counted
// nothing. Random game 71010 (Key Facility, the last round): a carrier walked
// onto two Boxes beside a Movement-dialled Warfare Core at "cost 0.00", was
// Sprinted at and Chopped, and the 16 Victory Points went with the Boxes.
// Staged on the copied Key Facility table, on open ground.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An enemy that Sprints first, and the Boxes a plan picks up\n');

const { M, data } = await loadEngine('seatsprint', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const { owed, newMind } = M.SEAT;
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const keyGame = { ...data.solo.scenarios[0], id: 't-sprint', mission: 'blackbox-key-facilities' };

// The last round's Action Phase, the Dune's Firing Opportunity open, the Mire
// done; the Wild Cat six Grids south of the Dune with its turn still to come on
// the dial `cat` (its Single Shot reaches 8); a Box in the Grid south of the
// Dune; the Drones out of the way.
const staged = async (cat = 'movement') => {
  const t = botTable(M, data, { ...keyGame, map: 'none' }, { seed: 2, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Dune, 5, 5, 2); at(U.Mire, 0, 0, 2); at(U['Wild Cat'], 5, 11, 0); at(U.Porcupine, 11, 0, 0); at(U.Raven, 0, 11, 0); at(U.Tarantula, 1, 11, 0);
  const tasks = M.TK.normaliseTasks(s.tasks);
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  boxes.forEach((b, i) => { b.col = (i === 0 ? 5 : 11) * 3 + 1; b.row = (i === 0 ? 6 : 6 + i) * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
  s.tasks = tasks;
  s.round.n = 5; s.script.stage = '5:2';
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  U['Wild Cat'].timing = cat;
  s.script.revealed = ['s1', 's2'];
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Dune.uid && x.uid !== U['Wild Cat'].uid).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  return { t, s, U, d, view: viewOf(s, 's1') };
};

// ---------- the seam ----------
{
  const { t, s, U } = await staged();
  // The Wild Cat's own question, as the Dune's look ahead asks it.
  const out = t.drivers.s1.pending().here?.();
  const short = out?.turnOf(U['Wild Cat'].uid, [`reach:${U.Dune.uid}`], 'movement')?.options ?? [];
  const long = out?.turnOf(U['Wild Cat'].uid, [`reachAll:${U.Dune.uid}`], 'movement')?.options ?? [];
  const struck = (o) => (o.then?.([`strike:${U.Dune.uid}`])?.options ?? []).some((x) => x.facts?.targetUid === U.Dune.uid);
  check('ON A MOVEMENT DIAL NO ATTACK IS LIVE BEFORE THE SPRINT (3.4.3): `reach:` (the Maneuver\'s moves) finds none to strike the Dune from',
    short.length, 0);
  check('`reachAll:` gives the Movement Actions\' moves as well: Sprints after which the Wild Cat could strike the Dune, three at most, each with an attack on it live',
    [long.length > 0, long.length <= 3, long.every((o) => o.tags.includes('moving')), long.every(struck)], [true, true, true, true]);
  t.close();
}

// ---------- the exposure ----------
{
  const { t, U, d, view } = await staged();
  const take = d.options.find((o) => o.tags[0] === 'move' && o.tags.includes('take'));
  // (Each skill named in every check: whether either is on by default is not this test's to know.)
  const cost = (skills) => AI.exposureAt(d, view, take.id, Infinity, { focus: false, sprints: false, held: false, ...skills }).cost;
  check('STANDING IN THE BOX\'S GRID, the Wild Cat on Movement is no danger without `sprints`; with it the Sprint and the shot after it are priced',
    [!!take, cost({}), cost({ sprints: true }) > 0.2], [true, 0, true]);
  // The plan that ends in the Box's Grid picking it up (of the facings, the one the plans keep).
  const to = take.facts.to;
  const rows = (skills) => AI.weighed(d, view, { focus: false, sprints: false, held: false, ...skills }).find((p) => p.how === 'move' && /picking up the Black Box/.test(p.label) && p.at.col === to.c && p.at.row === to.r);
  const plain = rows({ sprints: true });
  const held = rows({ sprints: true, held: true });
  check('AND WITH `held` THE PLAN THAT PICKS UP THE BOX is priced holding it: a Penetration there loses the Box, and it costs more',
    [held.cost > plain.cost + 0.5, held.mission === plain.mission], [true, true]);
  check('with `held` alone the Wild Cat is still read as no danger, and the plan costs what it did',
    rows({ held: true }).cost, rows({}).cost);
  t.close();
  const fire = await staged('firing');
  const fireTake = fire.d.options.find((o) => o.tags[0] === 'move' && o.tags.includes('take'));
  check('a Wild Cat dialled to Firing shoots from where its Maneuver leaves it, and is priced the same with `sprints` and without',
    AI.exposureAt(fire.d, fire.view, fireTake.id, Infinity, { focus: false, sprints: true }).cost, AI.exposureAt(fire.d, fire.view, fireTake.id, Infinity, { focus: false, sprints: false }).cost);
  fire.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

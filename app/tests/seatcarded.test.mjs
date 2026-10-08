// A MODE CHANGED IS A TABLE CHANGED (AI-OPPONENT-PLAN.md: the Tactician's skill
// `carded`). What a decision has worked out (what standing in each Grid costs,
// what each answer leads to a turn on) is kept while the table stands as it
// did, and the key it was kept by read every Part's state but not which card
// the Part was. A White Dwarf (ACE-001) changed to Cruise Mode for the Beam
// Cannon's launch, the next question read the costs worked out in Assault Mode,
// and it changed back without launching (random game 51040, an Occupation on
// the Alley, staged here as `_squadprobe.mjs` dealt it).
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Mode changed is a table changed\n');

const { M, data } = await loadEngine('seatcarded', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const dwarf = { name: 'Core Part', loadout: { torso: '287', chasis: '289', leftHand: '291', rightHand: '290', backpack: '292', pilot: 'ACE-01' } };
data.solo.squads['carded-s1'] = { name: 'COLLABORATION 460', faction: 'COLLABORATION', points: 460, mechs: [dwarf], drones: [{ cardId: 'PRDR-101' }, { cardId: 'PRDR-204' }] };
data.solo.squads['carded-s2'] = { name: 'COLLABORATION 340', faction: 'COLLABORATION', points: 340, mechs: [dwarf], drones: [] };
const scenario = { id: 'probe-51040', map: 'alley', mission: 'control-flank-attack', rounds: 5, secondaries: false, tactics: false, seats: { s1: 'carded-s1', s2: 'carded-s2' } };

// The answers of s2's White Dwarf in the second round, with each policy on both
// seats, staged where the game was found: played as dealt to that White Dwarf's
// first answer of the round, then the table put back as the game had it there
// (the other White Dwarf in (12,27), this one's dial on Swift) and its first two
// answers the game's (the Mobility Stance, the Maneuver to C5 that crushes the
// terrain there), because since each line of sight is walked cell by cell
// (2026-10-08, losexact.test.mjs) the round goes otherwise before it. From
// there each answer is the policy's own, and the one right after a change of
// Mode is asked too of a policy that has worked nothing out yet.
async function round2(skills) {
  const W = { press: 0, nextAfter: 0 };
  const policy = AI.makeTactician(skills, W);
  let snap = null;
  let t = null;
  const first = {
    name: 'first',
    choose(d, view, rng) {
      if (!snap && view.seat === 's2' && view.round === 2 && d.kind === 'opp.act' && d.options.length > 1) snap = JSON.parse(JSON.stringify(t.state));
      return policy.choose(d, view, rng);
    },
  };
  t = botTable(M, data, scenario, { seed: 51040, policies: { s1: first, s2: first }, glue: M.HUD.glueAfter });
  await t.run({ maxSteps: 12000, until: () => !!snap });
  const s = t.state;
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, snap);
  s.tokens.find((x) => x.uid === 1).col = 12;
  s.tokens.find((x) => x.uid === 4).timing = 'swift';
  s.script.opp.timing = 'swift';
  const force = ['Core Part: mobility Stance', 'Core Part: Maneuver to C5, crushing the terrain there, facing south'];
  const said = [];
  let asFresh = null;
  const watch = {
    name: 'watch',
    choose(d, view, rng) {
      const mine = view.seat === 's2' && view.round === 2 && d.kind === 'opp.act' && d.options.length > 1;
      if (mine && asFresh === null && / Mode, ACE-001/.test(said[said.length - 1] ?? '')) {
        asFresh = policy.choose(d, view, new AI.Rng('asked')).why === AI.makeTactician(skills, W).choose(d, view, new AI.Rng('asked')).why;
      }
      const forced = mine ? force.shift() : undefined;
      const pick = forced ? { option: d.options.find((o) => o.label === forced)?.id, why: 'as the game had it' } : policy.choose(d, view, rng);
      if (mine) said.push(String(d.options.find((o) => o.id === pick.option)?.label ?? ''));
      return pick;
    },
  };
  t.drivers.s1.policy = watch;
  t.drivers.s2.policy = watch;
  await t.run({ maxSteps: 12000, until: (st) => st.round.n > 2 });
  t.close();
  return { said, asFresh };
}
const now = await round2({});
const then = await round2({ carded: false });
const modes = (r) => r.said.filter((x) => / Mode, ACE-001/.test(x)).length;

// (The launch is the Bit's: the Beam Cannon 'Hodr' rides it, `"White Dwarf" Bit (...) to <Grid>`.)
check('THE WHITE DWARF CHANGES TO CRUISE MODE FOR THE BEAM CANNON, AND LAUNCHES IT',
  [modes(now), now.said.some((x) => /Cruise Mode, ACE-001/.test(x)), now.said.some((x) => /"White Dwarf" Bit .* to [A-L]\d+/.test(x))], [1, true, true]);
// On the old key it changed back the next Action in the game, the launch unmade;
// on this table the price it read is still the old one, though it no longer
// turns the answer.
check('RIGHT AFTER THE CHANGE IT ANSWERS AS A POLICY ASKED AFRESH; WITHOUT IT (the old key) its answer is priced with what it worked out in Assault Mode',
  [now.asFresh, then.asFresh], [true, false]);

// A DESTROYED PART IS NOT A DAMAGED ONE (2026-10-04 night): the key read each
// Part's state by its first letter, and "damaged" and "destroyed" share it.
// One policy asked on a table where the White Dwarf's last gun is Damaged, and
// then on the same table with it destroyed, answered the second from what it
// had worked out for the first: the same Glenn Launcher shot, priced at 3.55
// where asked afresh it is 3.73.
{
  const t = botTable(M, data, scenario, { seed: 51040, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const [mine, theirs] = ['s1', 's2'].map((side) => s.tokens.find((x) => x.side === side && x.kind === 'mech'));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
  at(mine, 2, 5, 1); at(theirs, 6, 5, 3);
  mine.partStates = { ...mine.partStates, leftHand: 'destroyed', rightHand: 'damaged' };
  const sc = s.script;
  s.round.phase = 2; sc.stage = '1:2'; sc.passed = []; sc.revealed = ['s1', 's2'];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  sc.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mine.uid).map((x) => x.uid);
  sc.opp = null;
  M.G.opportunity(data, s);
  const W = { press: 0, nextAfter: 0 };
  const ask = (p) => p.choose(t.drivers.s1.pending(), M.SEAT.viewOf(data, s, 's1'), new AI.Rng('key')).why;
  const kept = AI.makeTactician({}, W);
  const old = AI.makeTactician({ carded: false }, W);
  ask(kept); ask(old);
  mine.partStates = { ...mine.partStates, rightHand: 'destroyed' };
  const after = { kept: ask(kept), old: ask(old), fresh: ask(AI.makeTactician({}, W)), freshOld: ask(AI.makeTactician({ carded: false }, W)) };
  check('A DESTROYED PART IS NOT A DAMAGED ONE: asked again once the White Dwarf\'s last gun goes from Damaged to destroyed, a policy answers as one asked afresh; on the old key it answered from what it had worked out with the gun',
    [after.kept === after.fresh, after.old === after.freshOld], [true, false]);
  t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

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

// The answers of s2's White Dwarf in the second round, with each policy on both seats.
async function round2(skills) {
  // (Played as the game was found, before `press` 10 and `nextAfter` 1 were adopted.)
  const policy = AI.makeTactician(skills, { press: 0, nextAfter: 0 });
  const said = [];
  const watch = {
    name: 'watch',
    choose(d, view, rng) {
      const pick = policy.choose(d, view, rng);
      if (view.seat === 's2' && view.round === 2 && d.kind === 'opp.act' && d.options.length > 1) said.push(String(d.options.find((o) => o.id === pick.option)?.label ?? ''));
      return pick;
    },
  };
  const t = botTable(M, data, scenario, { seed: 51040, policies: { s1: watch, s2: watch }, glue: M.HUD.glueAfter });
  await t.run({ maxSteps: 12000, until: (st) => st.round.n > 2 });
  t.close();
  return said;
}
const now = await round2({});
const then = await round2({ carded: false });
const modes = (said) => said.filter((x) => / Mode, ACE-001/.test(x)).length;

// (The launch is the Bit's: the Beam Cannon 'Hodr' rides it, `"White Dwarf" Bit (...) to <Grid>`.)
check('THE WHITE DWARF CHANGES TO CRUISE MODE FOR THE BEAM CANNON, AND LAUNCHES IT',
  [modes(now), now.some((x) => /Cruise Mode, ACE-001/.test(x)), now.some((x) => /"White Dwarf" Bit .* to [A-L]\d+/.test(x))], [1, true, true]);
check('WITHOUT IT (the old key) it changed back the next Action, the launch unmade', modes(then), 2);

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

// FOCUS FIRE (AI-OPPONENT-PLAN.md, M13): a blow that leaves an enemy's vital
// Part Damaged, where a unit of the squad whose turn is still to come this
// round could then finish it, is worth what that unit would gain on
// destroying it (`gang`, the Tactician's weight; 0 asks nothing). The units
// still to come are asked by the engine what they could attack from where
// they stand, on the Timing each has dialled. Staged on the copied Alley game.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Focus fire\n');

const { M, data } = await loadEngine('seatgang', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);

// The copied Alley game on open ground, in round 2's Action Phase: the Dune
// (RDL) holds its Opportunity on Firing, the Wild Cat (UN) four Grids east of
// it in its rifle's sights; the Mire beside the Dune, on Firing too, with the
// Wild Cat in its sights as well. `change` sets the rest.
const staged = async (change = () => {}) => {
  const t = botTable(M, data, { ...data.solo.scenarios[0], map: 'none' }, { seed: 2, policies: { s1: AI.makeTactician({ focus: false }), s2: AI.eagerPolicy } });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const U = Object.fromEntries(t.state.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Dune, 4, 4, 1); at(U.Mire, 4, 6, 1); at(U['Wild Cat'], 8, 5, 3); at(U.Porcupine, 11, 11, 0); at(U.Raven, 10, 11, 0); at(U.Tarantula, 9, 11, 0);
  const s = t.state;
  s.round.n = 2; s.script.stage = '2:2';
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  s.script.revealed = ['s1', 's2'];
  // The Wild Cat has had its turn; the Mire's is still to come.
  s.script.acted = [U['Wild Cat'].uid];
  change(U, s);
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = t.drivers.s1.pending();
  return { t, U, d, view: viewOf(s, 's1') };
};
// What the Dune's best shot at the Wild Cat is worth to it, with focus fire
// weighed or not.
const shotAt = (x, gang) => {
  const rows = AI.weighed(x.d, x.view, { focus: false }, { gang });
  return rows.find((p) => p.how === 'stay')?.now ?? 0;
};

{
  const x = await staged();
  const aimed = x.d.options.filter((o) => o.run?.routine === 'attack' && o.facts?.targetUid === x.U['Wild Cat'].uid);
  const mireSees = (() => {
    const out = x.d.here?.();
    const turn = out?.turnOf(x.U.Mire.uid, ['attack'], 'firing');
    return (turn?.options ?? []).some((o) => o.run?.routine === 'attack' && o.facts?.targetUid === x.U['Wild Cat'].uid);
  })();
  const plain = shotAt(x, 0);
  const backed = shotAt(x, 1);
  check('THE DUNE\'S SHOT AT THE WILD CAT, WITH THE MIRE STILL TO COME AND THE WILD CAT IN ITS SIGHTS TOO, IS WORTH MORE FOR THE FOLLOW UP IT OPENS (`gang`)',
    [x.d?.kind, x.d?.unit === x.U.Dune.uid, aimed.length > 0, mireSees, backed > plain + 1e-6], ['opp.act', true, true, true, true]);
  check('and with `gang` at 0 it is worth what it was (nothing is asked)', Math.abs(shotAt(x, 0) - plain) < 1e-9, true);
  x.t.close();
}
{
  // The Mire has had its turn: nobody is left to finish the Wild Cat this round.
  const done = await staged((U, s) => { s.script.acted = [U['Wild Cat'].uid, U.Mire.uid]; });
  check('WITH THE MIRE\'S TURN BEHIND IT, nobody is left to follow up: the shot is worth the same either way',
    Math.abs(shotAt(done, 1) - shotAt(done, 0)) < 1e-9, true);
  done.t.close();
  // The Wild Cat's Torso already Damaged: the Dune's Penetration there is the kill, which the shot's own odds count.
  const hurt = await staged((U) => { U['Wild Cat'].partStates.torso = 'damaged'; });
  check('WITH THE WILD CAT\'S TORSO DAMAGED ALREADY, the shot opens nothing more: worth the same either way',
    Math.abs(shotAt(hurt, 1) - shotAt(hurt, 0)) < 1e-9, true);
  hurt.t.close();
  // The Mire facing away, the Wild Cat behind it: it could not follow up from where it stands.
  const away = await staged((U) => { U.Mire.facing = 3; });
  check('WITH THE WILD CAT OUT OF THE MIRE\'S ARC, the shot is worth the same either way',
    Math.abs(shotAt(away, 1) - shotAt(away, 0)) < 1e-9, true);
  away.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

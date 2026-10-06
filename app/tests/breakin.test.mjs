// A CONTAINER ATTACKED BY A SEAT, AND BROKEN OPEN OVER A BLACK BOX (OTTO's A1,
// 2026-10-05: "YES to ... attacking Containers").
//
// The seam offers each Container a Firing or Melee Action could target as one
// answer (owed.ts, tagged `container`): the Action's payment, then the piece
// destroyed (a Container is Breakable, no roll). Nothing values it but the
// Tactician's `breakIn`: a Container over a loose Black Box, where the Main
// Task pays for Boxes and the nearest unit to the Box is its own squad's.
// Staged on the real engine: the copied squads on the Alley, Key Facility (a Box
// paid 4 Victory Points as the game ends), a Box lying in the Container at G4,
// the Ace's Mire at I4 facing west on its Firing Opportunity, the enemy far off.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Container broken open over a Black Box\n');

const { M, data } = await loadEngine('breakin', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const { owed, newMind } = M.SEAT;
const AI = M.AI;
const clone = (x) => JSON.parse(JSON.stringify(x));
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const keyGame = { ...data.solo.scenarios[0], id: 't-breakin', mission: 'blackbox-key-facilities' };
const base = tableAtRoundOne(M, data, keyGame);
if (base.refused.length) throw new Error(base.refused.join('; '));
M.L.setLocalSeat('s1');

const piece = M.TURN.terrainOf(data, base.state).find((p) => p.id === 'terrain_4');
check('the Alley has a Container in G4 (terrain_4), Breakable', [!!piece?.isFragile, Math.floor(piece.subCells[0].col / 3), Math.floor(piece.subCells[0].row / 3)], [true, 6, 3]);

// The table as staged, the question the seam puts to the Mire, and the Ace's answer.
function stage(wildCat = [11, 11]) {
  const s = clone(base.state);
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Mire, 8, 3, 3); at(U.Dune, 0, 0, 2); at(U['Wild Cat'], wildCat[0], wildCat[1], 0); at(U.Porcupine, 11, 9, 0); at(U.Raven, 9, 11, 0); at(U.Tarantula, 11, 10, 0);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.passed = []; s.script.revealed = ['s1', 's2']; s.script.opp = null;
  for (const t of s.tokens) if (t.kind === 'mech') { t.timing = 'movement'; t.stance = 'offensive'; }
  const tasks = M.TK.normaliseTasks(s.tasks);
  const boxes = tasks.items.filter((i) => i.kind === 'blackbox');
  boxes.forEach((b, i) => { b.col = (4 + i) * 3 + 1; b.row = 11 * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
  boxes[0].col = piece.subCells[0].col; boxes[0].row = piece.subCells[0].row;
  s.tasks = tasks;
  U.Mire.timing = 'firing';
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Mire.uid).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  const d = owed(data, s, 's1', newMind());
  return { s, U, d, box: boxes[0].id, view: M.SEAT.viewOf(data, s, 's1') };
}
const answer = (st, policy) => policy.choose(st.d, st.view, new AI.Rng('1:breakin'));

{
  const st = stage();
  const o = st.d.options.find((x) => x.id === 'container:536_A:terrain_4');
  check('THE SEAM offers the Container as an answer of its own, tagged `container` first, with where it is',
    [st.d.kind, o?.label, o?.tags[0], o?.facts?.piece, o?.facts?.at], ['opp.act', 'Single Shot at the Container in G4', 'container', 'terrain_4', { col: 6, row: 3 }]);
  check('it pays the Action, then destroys the piece: no roll, a Container is Breakable',
    (o?.commands ?? []).map((c) => [c.kind, c.actionId ?? null, c.pieces ?? null]), [['performAction', '536_A', null], ['destroyTerrain', null, ['terrain_4']]]);
  const plain = answer(st, AI.makeTactician({ breakIn: false }));
  check('WITHOUT `breakIn` the Ace leaves it shut', plain.option.startsWith('container:'), false);
  const shipped = answer(st, AI.tacticianPolicy);
  check('THE ACE AS SHIPPED shoots it open, and says why in plain words',
    [shipped.option, String(shipped.why).startsWith('Single Shot at the Container in G4: the Black Box in it can be taken')], ['container:536_A:terrain_4', true]);
  // The answer's commands, as the table takes them.
  let ok = true;
  for (const c of o.commands) {
    const v = M.C.check(data, st.s, c);
    ok = ok && v.ok;
    if (v.ok) { M.C.apply(data, st.s, c); M.G.glueAfter(data, st.s, c); }
  }
  const item = M.TK.normaliseTasks(st.s.tasks).items.find((i) => i.id === st.box);
  check('the table takes them: the Container is gone and the Box lies loose in G4',
    [ok, M.TURN.terrainOf(data, st.s).some((p) => p.id === 'terrain_4'), item.bearerUid ?? null, Math.floor(item.col / 3), Math.floor(item.row / 3)], [true, false, null, 6, 3]);
}
{
  const st = stage([5, 3]);
  const near = answer(st, AI.tacticianPolicy);
  const without = answer(st, AI.makeTactician({ breakIn: false }));
  check('with the enemy\'s Wild Cat beside the Container, nearer the Box than the Mire, it is left shut: `breakIn` changes nothing there',
    [near.option.startsWith('container:'), near.option === without.option], [false, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

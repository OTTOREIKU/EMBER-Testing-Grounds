// A COMBAT WINDOW'S LINES FIT WHAT THE TABLE ACCEPTS (types.ts `fitViewLine`;
// found 2026-10-06 in a random-squad game of the computer against itself).
//
// The attacking squad publishes its combat window for the other screen
// (setCombatView), and check() refuses a view with a log line over 400
// characters: a peer is not trusted with the size of what lands in the other
// player's window. The Automatic Shield's note runs past that whenever two
// Scutums qualify (the names alone are 25 characters each, said four times),
// so every publish of that attack was refused, the defender was never shown
// the attack it had to answer, and the game stood still. The window now cuts
// each line it publishes to the bound. Staged on the stalled game's own units:
// an RDL Assault Core shooting a Claymore with two Scutums beside it.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A combat window\'s lines fit what the table accepts\n');

const { M, data } = await loadEngine('viewline', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;

data.solo.squads['t-gunner'] = {
  name: 'Gunner', faction: 'RDL', points: 0,
  mechs: [{ name: 'Gunner', loadout: { torso: '019', chasis: '249', leftHand: '029', rightHand: '536', pilot: 'FPA-11' } }],
  drones: [],
};
data.solo.squads['t-shields'] = {
  name: 'Shields', faction: 'GOF', points: 0,
  mechs: [{ name: 'Keeper', loadout: { torso: '172', chasis: 'PLK400-SK', leftHand: 'ZHLA-201', rightHand: 'MHKX-R', backpack: 'ZYBP-102', pilot: 'ZPA-38' } }],
  drones: [{ cardId: 'ZHDR-101' }, { cardId: 'ZHDR-101' }, { cardId: 'ZHDR-103' }],
};
const scenario = { ...data.solo.scenarios[0], id: 't-viewline', map: 'none', seats: { s1: 't-gunner', s2: 't-shields' } };

// ---------- the bound itself ----------
{
  const line = 'x'.repeat(450);
  check('a line over the bound is cut to it, and says it was cut', [M.TY.fitViewLine(line).length, M.TY.fitViewLine(line).endsWith('…')], [M.TY.VIEW_LINE_MAX, true]);
  check('a line within it is left as it is', M.TY.fitViewLine('Automatic Shield.'), 'Automatic Shield.');
}

// ---------- played: the shot two Scutums both qualify for ----------
M.L.setLocalSeat(null);
{
  let target = 0;
  const script = (want) => ({
    name: 'scripted',
    choose(d, view, rng) {
      const id = want(d, view);
      return id && d.options.some((o) => o.id === id) ? { option: id, why: 'scripted' } : AI.eagerPolicy.choose(d, view, rng);
    },
  });
  const t = botTable(M, data, scenario, {
    seed: 11,
    policies: {
      s1: script((d) => (d.kind === 'opp.act' ? `attack:536_A:${target}` : d.kind === 'attack.part' ? 'part.roll' : null)),
      s2: script((d) => (d.kind === 'opp.act' ? 'end' : null)),
    },
  });
  await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 2 });
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const [s1, s2] = t.state.tokens.filter((x) => x.cardId === 'ZHDR-101');
  const claymore = t.state.tokens.find((x) => x.cardId === 'ZHDR-103');
  // Where they stood in the game that stalled.
  const at = (x, col, row, facing) => { x.col = col; x.row = row; x.facing = facing; };
  at(U.Gunner, 15, 3, 2); at(s1, 15, 16, 0); at(s2, 12, 16, 0); at(claymore, 12, 19, 0); at(U.Keeper, 30, 33, 0);
  for (const x of [s1, s2, claymore]) x.stance = 'defensive';
  U.Gunner.timing = 'firing';
  U.Gunner.stance = 'offensive';
  t.state.script.acted = [U.Keeper.uid];
  t.state.script.opp = null;
  M.G.opportunity(data, t.state);
  target = claymore.uid;
  const views = [];
  t.watch((cmd) => { if (cmd.kind === 'setCombatView' && cmd.view) views.push(cmd.view); });
  const end = await t.run({ until: (st) => views.length > 0 && !st.script.combatView, maxSteps: 300 });
  const lines = views.flatMap((v) => v.log ?? []);
  const note = lines.find((l) => l.startsWith('Automatic Shield:')) ?? '';
  check('PLAYED: the shot at the Claymore is published, and nothing the window sends is refused',
    [end.kind, views.length > 0, t.refused.map((r) => `${r.seat}:${r.kind}: ${r.why}`)], ['paused', true, []]);
  check('the attack lands on a Scutum, and its note names the other one that qualified',
    [[s1.uid, s2.uid].includes(views.at(-1)?.targetUid), note.includes('also qualifies')], [true, true]);
  check('no line the window published is longer than the table accepts', lines.every((l) => l.length <= M.TY.VIEW_LINE_MAX), true);
  check('the note was longer than that, and is cut to it', note.length, M.TY.VIEW_LINE_MAX);
  t.close();
}

// ---------- the source says so ----------
{
  const { readFileSync } = await import('node:fs');
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check('check() refuses a longer line by the same bound the window cuts to (the log and the resolution alike)',
    (src('commands.ts').match(/l\.length > VIEW_LINE_MAX/g) ?? []).length, 2);
  check('the window cuts its log and its resolution lines as it publishes them',
    [/log: c\.log\.map\(\(l\) => fitViewLine\(/.test(src('combat.ts')), /text: c\.resolution\.text\.map\(fitViewLine\)/.test(src('combat.ts'))], [true, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

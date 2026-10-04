// AN ATTACK WHOSE HIT JAMS (AI-OPPONENT-PLAN.md, M12: `suppress`, the
// Tactician's weight; 0 weighs an attack by its damage alone). A Laser
// Suppression (552_B on the Ot41 Laser Suppression System, PRDR-102_C on the
// Reaper Type III) does no damage; its Hit puts a Fire Control Interference
// Token on the target, which keeps it from Firing. The night's census found it
// offered 54 times and never taken. The seat's view now says what a Hit puts on
// the target (`WeaponView.riders`), and the Tactician weighs the jam as it
// weighs an Electronic Attack's won roll, for the chance of a Hit. Staged on the
// copied VIP game, on open ground: the Mire's left arm is the Ot41.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('An attack whose Hit jams\n');

const { M, data } = await loadEngine('seatsuppress', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
// RDL to act in round 2's Action Phase: the Mire on a Firing dial, every other
// Mech having acted; the Dune well back, the Wild Cat to the south.
const staged = async (place) => {
  const vip = data.solo.scenarios.find((s) => /vip/.test(s.mission)) ?? data.solo.scenarios[1];
  const t = botTable(M, data, { ...vip, map: 'none' }, { seed: 5, policies: { s1: AI.makeTactician({ focus: false }), s2: AI.eagerPolicy } });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Porcupine, 11, 0, 2); at(U.Raven, 11, 1, 2); at(U.Tarantula, 10, 0, 2);
  // A copy: a Mech token holds its squad's loadout itself.
  U.Mire.mech = { ...U.Mire.mech, leftHand: '552' };
  at(U.Dune, 2, 2, 2);
  place(U, at);
  s.round.n = 2; s.script.stage = '2:2';
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U.Mire.uid).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
  return { t, U, d: t.drivers.s1.pending(), view: M.SEAT.viewOf(data, s, 's1') };
};
{
  const x = await staged((U, at) => { at(U.Mire, 5, 3, 2); at(U['Wild Cat'], 5, 13, 0); });
  const mire = x.view.units.find((u) => u.uid === x.U.Mire.uid);
  const weapon = (id) => mire.weapons.find((w) => w.actionId === id);
  // A Laser Weapon's rider is the Fragile Token (units.ts onHitRiders, route A).
  const laser = data.cards.flatMap((c) => c.actions ?? []).find((a) => a.type === 'Firing' && (a.keywords ?? []).some((k) => /激光武器/.test(k.inline ?? k.key ?? '')));
  const lit = laser ? M.U.onHitRiders(laser).map((r) => r.statusId) : null;
  check('THE SEAT\'S VIEW SAYS WHAT A HIT PUTS ON THE TARGET: the Laser Suppression a Fire Control Interference Token, the rifle nothing (and a Laser Weapon, read the same way, a Fragile Token)',
    [weapon('552_B')?.riders, weapon('536_A')?.riders ?? null, lit], [['fci'], null, ['fragile']]);
  const shot = x.d?.options.find((o) => o.tags[0] === 'attack' && o.facts?.actionId === '552_B');
  const f = shot?.chance?.();
  const off = AI.weighed(x.d, x.view, { focus: false }, { suppress: 0 });
  const on = AI.weighed(x.d, x.view, { focus: false }, { suppress: 1 });
  check('WITH ONLY THE LASER SUPPRESSION IN REACH OF THE WILD CAT: at `suppress` 0 it is worth its damage, none, and no plan does anything; at 1 it is worth the jam for the chance of a Hit, staying makes it, so does the plan chosen, and the reason says the chance to jam',
    [!!f && f.hit > 0 && f.pen === 0, off.every((p) => !p.does), /Laser Suppression at Wild Cat/.test(on.find((p) => p.label === 'stay')?.does ?? ''),
      /Laser Suppression at Wild Cat \(\d+% to jam it\)/.test(on[0]?.does ?? ''), (on[0]?.now ?? 0) > 0],
    [true, true, true, true, true]);
  x.t.close();
}
{
  // The Wild Cat in reach of the rifle too: a Single Shot with two chances in
  // three to Penetrate is worth more than a chance in four to jam.
  const y = await staged((U, at) => { at(U.Mire, 5, 3, 2); at(U['Wild Cat'], 5, 9, 0); });
  const on = AI.weighed(y.d, y.view, { focus: false }, { suppress: 1 });
  const stay = on.find((p) => p.label === 'stay');
  check('WITH THE RIFLE IN REACH TOO, the Mire still shoots the rifle: the jam is worth less than the shot',
    [/Single Shot at Wild Cat/.test(stay?.does ?? ''), /Single Shot at Wild Cat/.test(on[0]?.does ?? '')], [true, true]);
  y.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// A HIGHLIGHT PUT ON A UNIT OF ITS OWN SQUAD (AI-OPPONENT-PLAN.md, M12: `taunt`,
// the Tactician's weight; 0 never plans one). An enemy's Firing Action that can
// target a unit with Highlight must target it (6.2.1; FAQ J18), so the unit
// draws the fire of every enemy that has it in its sights: worth what that
// spares the rest of the squad, less what it costs the unit. And what standing
// in a Grid costs, kept by the facing a plan leaves the unit in (`faced`), found
// staging it. Staged on the copied VIP game, on open ground: the Mire's Torso is
// the TM35B Bison Assault Core (098, Amplify Profile: "This mech gains a
// Highlight Token", a Swift Action), the Dune its squad's Commander, the Wild
// Cat to the south.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Highlight on a unit of its own\n');

const { M, data } = await loadEngine('seattaunt', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
// The copied VIP game (RDL's Mire and Dune against UN), in round 2's Action
// Phase, RDL to act: `who` holds its Opportunity on a Swift dial with the Bison
// Core, every other Mech has acted. With `drone` (a card id) a Drone of RDL's
// is put down at `droneAt` and holds the Opportunity instead, every Mech
// having acted, the Bison Core still on `who`.
const staged = async (who, place, { bison = true, drone = null, droneAt = [0, 0] } = {}) => {
  const vip = data.solo.scenarios.find((s) => /vip/.test(s.mission)) ?? data.solo.scenarios[1];
  // (Played and compared by the Ace as it was staged, `press` 0 and `nextAfter` 0: both adopted since, at 10 and
  // 1, they change how a squad that is behind deploys and walks and what a plan that acts counts a turn on.)
  const t = botTable(M, data, { ...vip, map: 'none' }, { seed: 5, policies: { s1: AI.makeTactician({ focus: false }, { press: 0, nextAfter: 0 }), s2: AI.eagerPolicy } });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [name(x), x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Porcupine, 11, 0, 2); at(U.Raven, 11, 1, 2); at(U.Tarantula, 10, 0, 2);
  // A copy: a Mech token holds its squad's loadout itself, and a Part changed in
  // place would be changed in every later game of that squad (the engine's own
  // Part changes make a new one, units.ts).
  if (bison) U[who].mech = { ...U[who].mech, torso: '098' };
  place(U, at);
  s.round.n = 2; s.script.stage = '2:2';
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  s.script.revealed = ['s1', 's2'];
  if (drone) {
    const x = { ...M.U.makeDroneToken(s, data, data.byId.get(drone), 's1'), col: droneAt[0] * 3 + 1, row: droneAt[1] * 3 + 1, facing: 2 };
    s.tokens.push(x);
    U.drone = x;
    s.script.acted = s.tokens.filter((y) => y.kind === 'mech').map((y) => y.uid);
    s.script.opp = M.TY.newOpportunity(x.uid, undefined);
  } else {
    U[who].timing = 'swift';
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[who].uid).map((x) => x.uid);
    s.script.opp = null;
    M.G.opportunity(data, s);
  }
  const d = t.drivers.s1.pending();
  return { t, U, d, view: M.SEAT.viewOf(data, s, 's1') };
};
const lit = (rows) => rows.find((p) => /Amplify Profile/.test(p.label));
{
  // The Wild Cat (E9) has both in its sights: the Commander (E5) and the Mire (F5).
  const x = await staged('Mire', (U, at) => { at(U.Dune, 4, 4, 2); at(U.Mire, 5, 4, 0); at(U['Wild Cat'], 4, 8, 0); });
  const lead = x.view.units.find((u) => u.commander && u.side === 's1');
  const offered = x.d?.options.some((o) => o.tags.includes('token:highlight') && o.tags.includes('self'));
  const off = AI.weighed(x.d, x.view, { focus: false }, { taunt: 0, press: 0, nextAfter: 0 });
  const on = AI.weighed(x.d, x.view, { focus: false }, { taunt: 1, press: 0, nextAfter: 0 });
  check('AT `taunt` 0 THE MIRE\'S AMPLIFY PROFILE IS NEVER PLANNED; AT 1, WITH ITS COMMANDER IN THE WILD CAT\'S SIGHTS, IT IS WORTH WHAT IT SPARES THE COMMANDER AND BECOMES ITS PLAN',
    [x.d?.kind, offered, !!lead && lead.uid !== x.U.Mire.uid, !lit(off), (lit(on)?.now ?? 0) > 1, /Amplify Profile/.test(on[0]?.label ?? '')],
    ['opp.act', true, true, true, true, true]);
  // The Highlight costs the Mire what the Wild Cat would rather have shot: its
  // own price, read on the table the Highlight leaves, is dearer than staying.
  const stay = on.find((p) => p.label === 'stay');
  check('THE HIGHLIGHT COSTS THE MIRE ITSELF MORE THAN STAYING: the Wild Cat shoots it whatever it would rather have shot',
    [!!stay && !!lit(on) && lit(on).priced && stay.priced, (lit(on)?.cost ?? 0) > (stay?.cost ?? Infinity)], [true, true]);
  // FACING: the stay is priced for the facing the Mire stands in (north), the
  // turn to face the Wild Cat for its own, whichever was asked first.
  const turnOff = off.find((p) => p.label.includes('turn to face south'));
  const stayOff = off.find((p) => p.label === 'stay');
  const old = AI.weighed(x.d, x.view, { focus: false, faced: false }, { taunt: 0, press: 0, nextAfter: 0 });
  const stayOld = old.find((p) => p.label === 'stay');
  const turnOld = old.find((p) => p.label.includes('turn to face south'));
  check('WHAT STANDING COSTS IS KEPT BY FACING (`faced`): the stay costs the same whichever plan was priced first, and more than the turn to face the Wild Cat; without it the stay took the turn\'s price',
    [!!stayOff && !!stay && Math.abs(stayOff.cost - stay.cost) < 1e-9, !!turnOff && turnOff.priced && turnOff.cost < stayOff.cost - 0.1,
      !!stayOld && !!turnOld && turnOld.priced && Math.abs(stayOld.cost - turnOld.cost) < 1e-9],
    [true, true, true]);
  x.t.close();
}
{
  // The Commander far off (A1), out of the Wild Cat's reach: nothing to spare.
  const y = await staged('Mire', (U, at) => { at(U.Dune, 0, 0, 2); at(U.Mire, 5, 4, 0); at(U['Wild Cat'], 4, 8, 0); });
  const on = AI.weighed(y.d, y.view, { focus: false }, { taunt: 1, press: 0, nextAfter: 0 });
  check('WITH NOTHING OF THE SQUAD\'S IN THE WILD CAT\'S REACH BUT THE MIRE, the Highlight spares nothing and is not the plan',
    [!!lit(on), Math.abs(lit(on)?.now ?? 1) < 1e-9, /Amplify Profile/.test(on[0]?.label ?? '')], [true, true, false]);
  y.t.close();
}
{
  // The Commander's own Highlight: the Wild Cat's best target already, so it
  // spares the Mire next to nothing, and is not the plan.
  const z = await staged('Dune', (U, at) => { at(U.Dune, 4, 4, 2); at(U.Mire, 5, 4, 0); at(U['Wild Cat'], 4, 8, 0); });
  const off = AI.weighed(z.d, z.view, { focus: false }, { taunt: 0, press: 0, nextAfter: 0 });
  const on = AI.weighed(z.d, z.view, { focus: false }, { taunt: 1, press: 0, nextAfter: 0 });
  const charge = on.find((p) => p.how === 'charge');
  check('ON THE COMMANDER ITSELF (the Wild Cat\'s best target already) the Highlight spares next to nothing, costs the Commander no less than staying, and is not the plan',
    [!lit(off), !!lit(on) && !!charge && lit(on).now - charge.now < 0.5, !!lit(on) && lit(on).cost >= (on.find((p) => p.label === 'stay')?.cost ?? Infinity) - 1e-9, /Amplify Profile/.test(on[0]?.label ?? '')],
    [true, true, true, false]);
  z.t.close();
}

{
  // TARGET TAG (PRDR-202_A, the LD-5M Vigilant: "choose one target in range
  // with line of sight; it gains a Highlight Token"): the Vigilant's own
  // Opportunity, every Mech having acted, the Mire (the Bison Core: armour the
  // Wild Cat would rather not shoot at) beside the Commander.
  const w = await staged('Mire', (U, at) => { at(U.Dune, 4, 4, 2); at(U.Mire, 5, 4, 0); at(U['Wild Cat'], 4, 8, 0); }, { drone: 'PRDR-202', droneAt: [6, 3] });
  const vigilant = w.U.drone;
  const { d, view } = w;
  const off = AI.weighed(d, view, { focus: false }, { taunt: 0, press: 0, nextAfter: 0 });
  const on = AI.weighed(d, view, { focus: false }, { taunt: 1, press: 0, nextAfter: 0 });
  const tag = (rows, who) => rows.find((p) => /Target Tag/.test(p.label) && p.label.endsWith(`on ${who}`));
  const tags = (d?.options ?? []).filter((o) => o.tags.includes('token:highlight')).map((o) => `${o.tags[1]}:${o.facts.targetUid === w.U.Mire.uid ? 'Mire' : o.facts.targetUid === w.U.Dune.uid ? 'Dune' : o.facts.targetUid === w.U['Wild Cat'].uid ? 'Wild Cat' : 'other'}`);
  check('TARGET TAG ON THE MIRE BESIDE ITS COMMANDER: offered on each unit in sight, never planned at `taunt` 0; at 1 the Highlight on the Mire is worth what it spares the Commander, a good deal more than one on the Commander itself (the Wild Cat\'s best target already), one on the enemy is not planned, and the one on the Mire is the Vigilant\'s plan',
    [d?.kind, d?.unit === vigilant.uid, ['ally:Mire', 'ally:Dune', 'enemy:Wild Cat'].every((x) => tags.includes(x)), !off.some((p) => /Target Tag/.test(p.label)),
      (tag(on, w.U.Mire.label)?.now ?? 0) > 1, (tag(on, w.U.Mire.label)?.now ?? 0) > (tag(on, w.U.Dune.label)?.now ?? Infinity) + 1, !tag(on, w.U['Wild Cat'].label), /Target Tag.*on Mire$/.test(on[0]?.label ?? '')],
    ['opp.act', true, true, true, true, true, true, true]);
  w.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

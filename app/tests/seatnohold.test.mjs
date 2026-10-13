// NO COMMAND HELD BACK (`noHold`, 2026-10-13). OTTO: "In every in person game a player would never keep back a command
// token unless it could be used for an ability ... a UN and RDL squad will always use the token even if it's just to
// move the unit". A token the squad does not give is reserved for a Mech's Coordination or for a Part that consumes
// one, and swept at the End Phase (4.15); every card that can use one held is a GoF card (`keepsCommand`). The census
// found 0.7 to 0.9 Commands a game withheld with a Drone to take one, mostly support Drones whose every Grid looks
// the same to the walk. Measured level on wins, and ON for the Ace and the Veteran (OTTO, 2026-10-13: "We want these to
// feel closer to human players rather than just beating players outright so I would rather it's on").
//
// Staged on the real engine, on an empty board: UN's Rifle and a Raven EC Type (its EC Repeater a Passive, nothing to
// strike with), RDL's Dune at the far end. The Command Phase's question, and the Raven's turn once it is Commanded.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('No Command held back\n');

const { M, data } = await loadEngine('seatnohold', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;

{
  // The cards that let a Mech use a token it holds. A GoF Mech on the PL1 Standard Chassis (its Sprint carries Command
  // Coordination 1) keeps one; the same Mech with that Chassis destroyed and nothing else that uses one does not.
  const gof = (states) => ({ kind: 'mech', side: 's1', mech: { torso: '172', chasis: '179', leftHand: 'ZHLA-202', rightHand: 'ZHRA-101-T', pilot: 'ZPA-37' }, partStates: states, statuses: [] });
  check('A GoF Mech whose Chassis gives Command Coordination keeps a token; with that Chassis destroyed it does not',
    [M.U.keepsCommand(data, gof({})), M.U.keepsCommand(data, gof({ chasis: 'destroyed' }))], [true, false]);
}

data.solo.squads['t-un'] = {
  name: 'Ours', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '165' }],
};
data.solo.squads['t-rdl'] = {
  name: 'Theirs', faction: 'RDL', points: 0,
  mechs: [{ name: 'Dune', loadout: { torso: '014', chasis: '020', leftHand: '032', rightHand: '033', pilot: 'FPA-63' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-nohold', map: 'none', mission: 'none', seats: { s1: 't-un', s2: 't-rdl' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy }, glue: M.HUD.glueAfter });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
const U = Object.fromEntries(t.state.tokens.map((x) => [x.kind === 'drone' ? 'Raven' : x.label, x]));
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; x.facing = f; };
at(U.Raven, 6, 12, 0); at(U.Rifle, 2, 12, 0); at(U.Dune, 6, 2, 2);
const d = t.drivers.s1.pending();
const view = M.SEAT.viewOf(data, t.state, 's1');
const raven = view.units.find((u) => u.uid === U.Raven.uid);
check('THE STAGE: the Command Phase asks who is given a Command; the Raven has nothing to strike with, and no Mech of either squad keeps a token',
  [d?.kind, raven?.weapons.filter((x) => x.type === 'Firing' || x.type === 'Melee' || x.type === 'Projectile').length, view.units.filter((u) => u.kind === 'mech').map((u) => u.keepsCommand)],
  ['loop.designate.command', 0, [false, false]]);

const choose = (p, dd, vv = view) => { const c = p.choose(dd, vv, new AI.Rng('nohold')); return { reason: c.reason, o: dd.options.find((o) => o.id === c.option) }; };
// As it ships (on for the Ace and the Veteran), and with the switch off (as the Brawler plays).
const OFF = AI.makeTactician({ noHold: false });
{
  const off = choose(OFF, d);
  check('WITHOUT IT the Command is withheld: no Drone gains by one', [off.reason, off.o?.tags.includes('pass')], ['command_withheld', true]);
  const on = choose(AI.tacticianPolicy, d);
  const vet = choose(AI.veteranPolicy, d);
  check('WITH IT the Raven is given the Command all the same, by the Ace and by the Veteran',
    [on.reason, on.o?.facts?.uid === U.Raven.uid, vet.reason, vet.o?.facts?.uid === U.Raven.uid], ['command_opportunity', true, 'command_opportunity', true]);
  check('and not by the Brawler', choose(AI.brawlerPolicy, d).reason, 'command_withheld');
}
{
  const turn = d.options.find((o) => o.tags.includes('designate') && o.facts?.uid === U.Raven.uid)?.then?.();
  const off = choose(OFF, turn);
  const on = choose(AI.tacticianPolicy, turn);
  check('ITS TURN: without it the Raven, Commanded, ends where it stands; with it the Raven moves',
    [turn?.kind, off.reason, on.reason, on.o?.tags[0]], ['activation.act', 'end_activation', 'command_opportunity', 'move']);
  const near = choose(AI.makeTactician({}, { holdSlack: 0 }), d);
  check('at `holdSlack` 0 no Command is spent for nothing', near.reason, 'command_withheld');
}
{
  // A squad with a Mech that could use the token later in the round keeps it (the GoF case).
  const keeps = { ...view, units: view.units.map((u) => (u.side === 's1' && u.kind === 'mech' ? { ...u, keepsCommand: true } : u)) };
  check('A SQUAD WITH A MECH THAT KEEPS A TOKEN withholds it as before', choose(AI.tacticianPolicy, d, keeps).reason, 'command_withheld');
}
check('as it ships (2026-10-13): on for the Ace and the Veteran, off for the Brawler and the Recruit made of it',
  [AI.SKILLS.noHold, AI.VETERAN_SKILLS.noHold ?? AI.SKILLS.noHold, AI.BRAWLER_SKILLS.noHold, AI.TACTICIAN.holdSlack], [true, true, false, 0.25]);
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

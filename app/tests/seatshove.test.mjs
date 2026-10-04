// Knockback and Push, made by a seat (AI-OPPONENT-PLAN.md, M8.2t).
//
// Knockback X is not optional: "After this action ends, the target is forced
// to move X grids along the attack direction." A player is asked it by the
// Match Centre's Forced Movement panel (matchhud.ts shovePanel). A computer
// seat's attack window remembered the move it owed (botcombat.ts
// `shoveOwed`) and nothing ever read it, so in a game against the computer its
// Knockback did not knock back. Now the seat is asked `shove.make`: the line
// is the rules' (turn.ts forcedMove, the panel's own reading moved where both
// read it), and the forcing player picks the victim's facing (3.4.4), and for
// a Push the direction. A Penetrated bearer's Black Box waits for the move and
// lands where the bearer ends up (FAQ E19), as the page has it.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Knockback and Push, made by a seat\n');

const { M, data } = await loadEngine('seatshove', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);

// RDL: the Ram, whose Torso (RT-08 Tempest, 015) strikes in Melee with an
// [On Hit] Knockback 1 (015_B). UN: two riflemen.
const rifle = (name) => ({ name, loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
data.solo.squads['k-ram'] = { name: 'Ram', faction: 'RDL', points: 0, mechs: [{ name: 'Ram', loadout: { torso: '015', chasis: '534', leftHand: '535', pilot: 'FPA-03' } }], drones: [] };
data.solo.squads['k-rifles'] = { name: 'Rifles', faction: 'UN', points: 0, mechs: [rifle('Wolf'), rifle('Cat')], drones: [] };
const vip = { ...data.solo.scenarios[1], id: 't-shove', map: 'none', seats: { s1: 'k-ram', s2: 'k-rifles' } };
const boxes = { ...data.solo.scenarios[0], id: 't-shove-box', mission: 'blackbox-key-facilities', map: 'none', seats: { s1: 'k-ram', s2: 'k-rifles' } };
const gridOf = (x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });

// The attack lands: every attack die on its best face, every defence die
// blank, the Part die on the left arm (so the Wolf is hurt, not destroyed).
// The roll for First Player is a real one.
const BEST = { red: 0, yellow: 0, white: 7, blue: 5, black: 2 };
// The scripted seat: the Ram's 015_B at the Wolf; the rest the Tactician's
// (with the skills asked for), the Forced Movement among it.
const scripted = (skills) => {
  const brain = AI.makeTactician({ focus: false, ...skills });
  return {
    name: 'scripted',
    choose(d, view, rng) {
      if (d.kind === 'opp.act') {
        const ram = d.options.find((o) => o.run?.routine === 'attack' && o.run.args?.actionId === '015_B');
        if (ram) return { option: ram.id, why: 'scripted' };
        const end = d.options.find((o) => o.tags.includes('end'));
        if (end) return { option: end.id, why: 'scripted' };
      }
      return brain.choose(d, view, rng);
    },
  };
};
// The Action Phase, the Ram's Opportunity open on the Melee dial at C6 facing
// east, the Wolf at D6 facing west, the Cat far off (or where `cat` says).
const table = async ({ scenario = vip, skills = {}, cat = [11, 11], arrange } = {}) => {
  const first = new AI.Rng('shove:first');
  let fixed = false;
  const t = botTable(M, data, scenario, {
    seed: 4, policies: { s1: scripted(skills), s2: AI.legalPolicy }, glue: M.HUD.glueAfter,
    dice: (pool, label) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: !fixed || /First Player/.test(label) ? first.int(data.dice.dice[color].sides) : BEST[color] }))),
  });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  fixed = true;
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Ram, 2, 5, 1); at(U.Wolf, 3, 5, 3); at(U.Cat, cat[0], cat[1], 0);
  arrange?.({ s, U, at });
  const landed = [];
  t.watch((cmd) => landed.push(cmd));
  s.round.n = 1; s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  U.Ram.timing = 'melee'; U.Wolf.timing = 'firing'; U.Cat.timing = 'firing';
  s.script.acted = [U.Wolf.uid, U.Cat.uid];
  M.G.opportunity(data, s);
  // Until the Ram's Opportunity is over.
  const end = await t.run({ until: (st) => !st.script.opp || st.script.opp.uid !== U.Ram.uid, maxSteps: 200 });
  return { t, s, U, landed, end };
};
const asked = (t) => t.drivers.s1.log.filter((l) => l.kind === 'shove.make');

// ---------- the reading ----------
{
  const t = botTable(M, data, vip, { seed: 4, policies: AI.legalPolicy, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Ram, 2, 5, 1); at(U.Wolf, 3, 5, 3); at(U.Cat, 11, 11, 0);
  const a = M.TURN.actionOf(data, t.state, U.Ram, '015_B');
  const out = M.TURN.forcedMove(data, t.state, U.Ram, U.Wolf, a);
  const made = M.TURN.forcedCommands(data, t.state, U.Ram, U.Wolf, a, { facing: 1 });
  check('turn.ts forcedMove reads 015_B: Knockback 1, [On Hit], east along the attack, to E6; forcedCommands sends it as the panel does',
    [out?.kb, out?.heading, out?.end, made.commands.map((c) => [c.kind, c.targetUid === U.Wolf.uid, c.facing, c.push]), made.fatal],
    [{ grids: 1, push: false, onHit: true }, 'east', { c: 4, r: 5 }, [['forceMove', true, 1, false]], false]);
  at(U.Cat, 4, 5, 0);
  check('a line a unit blocks from its first Grid sends nothing', M.TURN.forcedCommands(data, t.state, U.Ram, U.Wolf, a).commands.length, 0);
  t.close();
}

// ---------- played, with the skill ----------
{
  const x = await table();
  const q = asked(x.t);
  const wolf = x.s.tokens.find((u) => u.uid === x.U.Wolf.uid);
  check('the Ram strikes the Wolf, and the seat is asked the Forced Movement its Knockback owes, once',
    [x.end.kind, x.landed.some((c) => c.kind === 'setCombatView' && c.view?.actionId === '015_B'), q.length, q[0]?.options], ['paused', true, 1, 5]);
  check('it is made: the Wolf forced one Grid east to E6, left facing away from the Ram (west of it), nothing refused, and the seat forgets it',
    [gridOf(wolf), wolf.facing, q[0]?.reason, x.t.drivers.s1.mind.shove ?? null, x.t.refused], [{ c: 4, r: 5 }, 1, 'shove_by_value', null, []]);
  check('and the other seat, whose window only showed it the attack, is never asked to make it',
    [x.t.drivers.s2.log.some((l) => l.kind === 'shove.make'), x.t.drivers.s2.mind.shove ?? null], [false, null]);
  x.t.close();
}

// ---------- without it: the safe answer ----------
{
  const x = await table({ skills: { shove: false } });
  const wolf = x.s.tokens.find((u) => u.uid === x.U.Wolf.uid);
  check('WITHOUT the skill the move is still made (it is not optional): the safe answer, the Wolf at E6 still facing west',
    [asked(x.t).length, asked(x.t)[0]?.option, gridOf(wolf), wolf.facing, x.t.refused], [1, 'shove:-:-', { c: 4, r: 5 }, 3, []]);
  x.t.close();
}

// ---------- blocked ----------
{
  const x = await table({ cat: [4, 5] });
  const q = asked(x.t);
  const wolf = x.s.tokens.find((u) => u.uid === x.U.Wolf.uid);
  // It faced the Ram (west): the turn that puts its back to it is worth making.
  check('the Cat at E6 blocks the line: the Wolf stays at D6, and is turned where it stands to put its back to the Ram (FAQ B4/B5)',
    [q.length, gridOf(wolf), q[0]?.reason, wolf.facing, x.t.refused],
    [1, { c: 3, r: 5 }, 'shove_turned', 1, []]);
  x.t.close();
}

// ---------- a Box knocked loose lands after the move (FAQ E19) ----------
{
  const x = await table({
    scenario: boxes,
    arrange: ({ s, U }) => {
      const tasks = M.TK.normaliseTasks(s.tasks);
      const items = tasks.items.filter((i) => i.kind === 'blackbox');
      items.forEach((b, i) => { b.col = (8 + (i % 3)) * 3 + 1; b.row = (i < 3 ? 0 : 11) * 3 + 1; b.bearerUid = undefined; b.bearerSlot = undefined; });
      Object.assign(items[0], { bearerUid: U.Wolf.uid, bearerSlot: 'leftHand', col: undefined, row: undefined });
      s.tasks = tasks;
    },
  });
  const order = x.landed.filter((c) => c.kind === 'forceMove' || c.kind === 'dropBlackBox').map((c) => c.kind);
  const drop = x.landed.find((c) => c.kind === 'dropBlackBox');
  const wolf = x.s.tokens.find((u) => u.uid === x.U.Wolf.uid);
  const near = drop ? Math.abs(Math.floor(drop.to.col / 3) - gridOf(wolf).c) + Math.abs(Math.floor(drop.to.row / 3) - gridOf(wolf).r) : -1;
  check('the Wolf Penetrated drops its Box only once it has been forced to E6, beside where it now stands',
    [order, gridOf(wolf), near <= 1, x.t.refused], [['forceMove', 'dropBlackBox'], { c: 4, r: 5 }, true, []]);
  x.t.close();
}

// ---------- the Centaur's shove (M8.2u) ----------
// 181_A, the PLK400 "Centaur" Chassis's Sprint: "If there is an Enemy Ground
// Unit in the adjacent grid in front of the Mech after performing this
// Action, may cause Push 1." The page opens its shove panel once the walk has
// landed (matchhud.ts startShove, no victim named); a seat is asked
// `shove.make` with the victim open, and may let it go by.
data.solo.squads['k-centaur'] = { name: 'Centaur', faction: 'GOF', points: 0, mechs: [{ name: 'Centaur', loadout: { torso: '174', chasis: '181', leftHand: 'ZHLA-101', rightHand: 'ZHRA-101', pilot: 'ZPA-43' } }], drones: [] };
const centaurGame = { ...vip, id: 't-centaur', seats: { s1: 'k-centaur', s2: 'k-rifles' } };
// The Centaur's Sprint to E6: facing east the Wolf at F6 is in front of it,
// facing north nobody is.
const sprintTo = (facing) => (d) => d.options.find((o) => o.facts?.actionId === '181_A' && o.facts?.to?.c === 4 && o.facts?.to?.r === 5 && o.facts?.facing === facing && !o.tags.includes('take'));
// `script` answers the Centaur's own turn where it names an answer; `arrange`
// changes the table first; the dice after setup are faces that do nothing (a
// Mine's blast leaves the Centaur standing, and able to Go on).
const QUIET = { red: 7, yellow: 7, white: 7, blue: 5, black: 0 };
const centaur = async ({ skills = {}, facing = 1, arrange, script } = {}) => {
  const brain = AI.makeTactician({ focus: false, ...skills });
  let sprinted = false;
  const policy = {
    name: 'scripted',
    choose(d, view, rng) {
      if (d.kind === 'opp.act') {
        const named = script?.(d);
        if (named) return { option: named.id, why: 'scripted' };
        const go = !script && !sprinted ? sprintTo(facing)(d) : undefined;
        if (go) { sprinted = true; return { option: go.id, why: 'scripted' }; }
        const end = d.options.find((o) => o.tags.includes('end'));
        if (end) return { option: end.id, why: 'scripted' };
      }
      return brain.choose(d, view, rng);
    },
  };
  const rolls = new AI.Rng('centaur:first');
  let fixed = false;
  const t = botTable(M, data, centaurGame, {
    seed: 4, policies: { s1: policy, s2: AI.legalPolicy }, glue: M.HUD.glueAfter,
    dice: (pool, label) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: !fixed || /First Player/.test(label) ? rolls.int(data.dice.dice[color].sides) : QUIET[color] }))),
  });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  fixed = true;
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Centaur, 1, 5, 1); at(U.Wolf, 5, 5, 3); at(U.Cat, 11, 11, 0);
  const put = (cardId, side, c, r) => { const x = { ...M.U.makeDroneToken(s, data, data.byId.get(cardId), side), col: c * 3 + 1, row: r * 3 + 1, facing: 3 }; s.tokens.push(x); return x; };
  arrange?.({ s, U, at, put });
  s.round.n = 1; s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  U.Centaur.timing = 'movement'; U.Wolf.timing = 'firing'; U.Cat.timing = 'firing';
  s.script.acted = [U.Wolf.uid, U.Cat.uid];
  M.G.opportunity(data, s);
  const first = t.drivers.s1.pending();
  const wolfLink = U.Wolf.link;
  const landed = [];
  t.watch((cmd) => landed.push(cmd));
  const end = await t.run({ until: (st) => !st.script.opp || st.script.opp.uid !== U.Centaur.uid, maxSteps: 200 });
  return { t, s, U, first, wolfLink, landed, end };
};
{
  const x = await centaur();
  const east = sprintTo(1)(x.first);
  const north = sprintTo(0)(x.first);
  check('the Sprint to E6 facing the Wolf carries the shove; facing north, with nobody in front, it does not',
    [!!east, east?.facts?.shoves?.actionId, !!north, north?.facts?.shoves ?? null], [true, '181_A', true, null]);
  const q = asked(x.t);
  const d = x.t.drivers.s1.log.find((l) => l.kind === 'shove.make');
  const wolf = x.s.tokens.find((u) => u.uid === x.U.Wolf.uid);
  check('PLAYED: once the Sprint has landed the seat is asked the shove, once; the Tactician Pushes the Wolf (a Mech Pushed loses 1 Link) one Grid, nothing refused',
    [x.end.kind, q.length, q[0]?.reason, Math.abs(gridOf(wolf).c - 5) + Math.abs(gridOf(wolf).r - 5), wolf.link, x.t.refused, x.t.drivers.s1.mind.shove ?? null],
    ['paused', 1, 'shove_by_value', 1, x.wolfLink - 1, [], null]);
  check('the push it sent is the panel\'s: a forceMove of the Wolf with the Push\'s Link', x.landed.filter((c) => c.kind === 'forceMove').map((c) => [c.targetUid === x.U.Wolf.uid, c.push]), [[true, true]]);
  x.t.close();
}
{
  // The question's answers: each direction and facing for the Wolf, and
  // leaving it be the safe answer (the shove is optional).
  const x = await centaur({ skills: { shove: false } });
  const q = asked(x.t);
  const wolf = x.s.tokens.find((u) => u.uid === x.U.Wolf.uid);
  check('WITHOUT the skill the safe answer lets it go by: the Wolf where it stood, its Link untouched',
    [q.length, q[0]?.option, gridOf(wolf), wolf.link, x.t.refused], [1, 'shove:leave', { c: 5, r: 5 }, x.wolfLink, []]);
  x.t.close();
}
{
  const x = await centaur({ facing: 0 });
  check('a Sprint that ends with nobody in front asks nothing', [x.end.kind, asked(x.t).length, x.t.refused], ['paused', 0, []]);
  x.t.close();
}
{
  // The seam's question, read directly on the table the Sprint leaves.
  const x = await centaur({ skills: { shove: false } });
  x.t.close();
  const t = botTable(M, data, centaurGame, { seed: 4, policies: AI.legalPolicy, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x2) => [x2.label, x2]));
  const at = (x2, c, r, f) => { x2.col = c * 3; x2.row = r * 3; if (f !== undefined) x2.facing = f; };
  at(U.Centaur, 4, 5, 1); at(U.Wolf, 5, 5, 3); at(U.Cat, 11, 11, 0);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2'];
  U.Centaur.timing = 'movement'; s.script.acted = [U.Wolf.uid, U.Cat.uid];
  M.G.opportunity(data, s);
  const mind = { ...M.SEAT.newMind(), shove: { uid: U.Centaur.uid, actionId: '181_A', targetUid: null } };
  const d = M.SEAT.owed(data, s, 's1', mind);
  const dirs = new Set(d.options.filter((o) => o.tags.includes('shove') && !o.tags.includes('leave')).map((o) => o.id.split(':')[2]));
  // West is the Centaur's own Grid: that line is blocked from its first Grid.
  check('the question: the Wolf in front, every direction a Push may take that is not blocked (north, east, south: west is the Centaur), each facing, and leaving it be the safe answer',
    [d.kind, d.facts.optional, d.fallback, [...dirs].sort().join(','), d.options.some((o) => o.facts?.link === 1)], ['shove.make', true, 'shove:leave', '0,1,2', true]);
  t.close();
}
{
  // MADE ONLY WHERE IT GAINS: with both its arms gone the Centaur can do
  // nothing to anybody, so where a victim stands is all one to it; a Mech
  // Pushed still loses 1 Link (worth `link`), a Drone loses nothing.
  const unarmed = ({ U }) => { U.Centaur.partStates = { ...U.Centaur.partStates, leftHand: 'destroyed', rightHand: 'destroyed' }; };
  const mech = await centaur({ arrange: unarmed });
  const drone = await centaur({ arrange: (x) => { unarmed(x); x.at(x.U.Wolf, 9, 0, 2); x.put('163', 's2', 5, 5); } });
  check('an unarmed Centaur still Pushes the Wolf, for its Link, and lets a Drone in front be: the push would gain it nothing',
    [asked(mech.t)[0]?.reason, mech.s.tokens.find((u) => u.uid === mech.U.Wolf.uid).link, asked(drone.t).length, asked(drone.t)[0]?.reason, asked(drone.t)[0]?.option, mech.t.refused, drone.t.refused],
    ['shove_by_value', mech.wolfLink - 1, 1, 'shove_left', 'shove:leave', [], []]);
  mech.t.close(); drone.t.close();
}
{
  // A FLYING UNIT IN FRONT IS NO VICTIM ("an Enemy Ground Unit"): a Raven.
  const x = await centaur({ arrange: ({ U, at, put }) => { at(U.Wolf, 9, 0, 2); put('164', 's2', 5, 5); } });
  check('a Raven Scout (Flying) in front of the Sprint\'s end: the answer carries no shove, and nothing is asked',
    [sprintTo(1)(x.first)?.facts?.shoves ?? null, asked(x.t).length, x.t.refused], [null, 0, []]);
  x.t.close();
}
{
  // A SPRINT A MINE STOPS shoves after its Go on (the page's `haltCarry`):
  // the Centaur's walk east stops on an enemy Mine at D6, the blast is
  // resolved, it goes on to E6, and the Wolf in front is asked about then.
  let step = 0;
  const x = await centaur({
    arrange: ({ put }) => { put('074', 's2', 3, 5); },
    script: (d) => {
      if (step === 0) {
        const halt = d.options.find((o) => o.tags.includes('halt') && o.facts?.actionId === '181_A' && o.facts?.facing === 1);
        if (halt) { step = 1; return halt; }
      }
      if (step === 1) {
        const on = d.options.find((o) => o.tags.includes('resume') && o.facts?.to?.c === 4 && o.facts?.to?.r === 5 && o.facts?.facing === 1 && !o.tags.includes('take'));
        if (on) { step = 2; return on; }
      }
      return null;
    },
  });
  const centaurNow = x.s.tokens.find((u) => u.uid === x.U.Centaur.uid);
  const blasted = x.landed.some((c) => c.kind === 'setCombatView' && c.view?.attackerUid !== undefined && c.view.targetUid === x.U.Centaur.uid);
  check('THE MINE: the Sprint stops in its Grid, its blast is made, the Go on lands in E6 facing the Wolf, and only then is the shove asked, once',
    [step, blasted, gridOf(centaurNow), asked(x.t).length, x.t.drivers.s1.mind.shoveLater ?? null, x.t.refused], [2, true, { c: 4, r: 5 }, 1, null, []]);
  x.t.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

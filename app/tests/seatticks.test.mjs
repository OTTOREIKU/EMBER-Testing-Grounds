// Ticks bought, answered by a seat (M7.6; FAQ L2, L8; AI-OPPONENT-PLAN.md,
// M8.2l).
//
// Three ways a Mech buys an Action Tick in its own Opportunity, each one
// command the turn panel sends and the engine holds to its rules: a pilot's
// Link for a Tick (FPA-04-2 Hammerhead Domestic Expert, the RDL starters'
// pilot: in Offensive Stance, once an Opportunity, never the last Link, never
// after a Reboot; it fixes the Stance), an Overloading Pack's Link for Ticks
// (090_A), and a Part's Tick for the Stance it asks (547_B Attack Mode; it fixes
// the Stance). No seat was ever offered one, the copied squads' pilot among
// them. Now each is an answer where the engine takes it, and the Tactician
// buys one where the turn it opens is worth more than the Link it costs.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Ticks bought\n');

const { M, data } = await loadEngine('seatticks', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);

// The copied squads (the Raid starters: the Mire flies FPA-04-2), a UN Mech
// with the Overloading Pack, and the Crisis II.
const [raid] = data.solo.scenarios;
const un = (name, extra = {}) => ({ name, loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2', ...extra } });
data.solo.squads['k-over'] = { name: 'Overload', faction: 'UN', points: 0, mechs: [un('Volt', { backpack: '090' })], drones: [] };
data.solo.squads['k-crisis'] = { name: 'Crisis', faction: 'PD', points: 0, mechs: [{ name: 'Crisis', loadout: { torso: '547', chasis: '548', leftHand: '550', rightHand: '551', backpack: '545', pilot: 'XPA-59' } }], drones: [] };
data.solo.squads['k-rdl'] = { name: 'Gunners', faction: 'RDL', points: 0, mechs: [
  { name: 'Dune', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] };

// A table past its setup, staged in the Action Phase on an open board: the
// Mech named on its Opportunity, the enemy named in front of it, the rest out
// of the way.
const table = async (scenario, who, foe, opts = {}) => {
  const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies: opts.policies ?? AI.tacticianPolicy, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  s.tokens.forEach((x, i) => at(x, i % 12, x.side === 's1' ? 0 : 11, x.side === 's1' ? 2 : 0));
  at(U[who], 4, 4, 2);
  if (foe) at(U[foe], 4, opts.far ? 11 : 7, 0);
  U[who].stance = opts.stance ?? 'offensive';
  if (opts.link !== undefined) U[who].link = opts.link;
  s.round.phase = 2; s.script.stage = '1:2'; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[who].uid).map((x) => x.uid);
  M.G.opportunity(data, s);
  return { t, s, U, d: t.drivers[U[who].side].pending() };
};
const ticks = (d) => (d?.options ?? []).filter((o) => o.tags[0] === 'tick').map((o) => o.id);
const run = (s, commands) => commands.map((cmd) => { const v = M.C.check(data, s, cmd); if (v.ok) { M.C.apply(data, s, cmd); M.G.glueAfter(data, s, cmd); } return v.ok; });
const closeAll = (...xs) => { for (const x of xs) x.t.close(); };

// ---------- the cards ----------
{
  const w = await table(raid, 'Mire', 'Wild Cat');
  check('the cards are what the test means them to be: the Mire\'s pilot trades 1 Link for 1 Tick in Offensive Stance; 090_A is the Overload; 547_B is a Tick for Offensive Stance',
    [M.U.pilotCard(data, w.U.Mire)?.id, (({ maxLink, perLink, stance }) => ({ maxLink, perLink, stance }))(M.U.linkTickTraitOn(data, w.U.Mire)), data.overload.map((g) => g.actionId),
      M.U.opportunityBonusOn(data, { ...w.U.Mire, mech: { ...w.U.Mire.mech, torso: '547' } })?.stance],
    ['FPA-04-2', { maxLink: 1, perLink: 1, stance: 'offensive' }, ['090_A'], 'offensive']);
  closeAll(w);
}

// ---------- the seam ----------
{
  const w = await table(raid, 'Mire', 'Wild Cat');
  const o = w.d.options.find((x) => x.id === 'tick:link');
  check('A PILOT\'S LINK FOR A TICK IS AN ANSWER: the one command the turn panel sends',
    [ticks(w.d), o?.tags, o?.commands], [['tick:link'], ['tick', 'linkTick'], [{ kind: 'linkTick', seat: 's1', uid: w.U.Mire.uid }]]);
  const was = { link: w.U.Mire.link, ticks: w.s.script.opp.action };
  check('TAKEN, a Link is spent, a Tick gained and the Stance fixed; and it is not offered again this Opportunity',
    [run(w.s, o.commands), w.U.Mire.link, w.s.script.opp.action, !!w.s.script.opp.stanceLocked, ticks(w.t.drivers.s1.pending())],
    [[true], was.link - 1, was.ticks + 1, true, []]);
  const def = await table(raid, 'Mire', 'Wild Cat', { stance: 'defensive' });
  const low = await table(raid, 'Mire', 'Wild Cat', { link: 1 });
  const dune = await table(raid, 'Dune', 'Wild Cat');
  check('not in another Stance (FAQ L2), never for the last Link (4.10), nor for a Mech whose pilot has no such trait',
    [ticks(def.d), ticks(low.d), ticks(dune.d)], [[], [], []]);
  M.L.setLocalSeat('s1');
  const again = await table(raid, 'Mire', 'Wild Cat');
  check('it answers to the kind `tick`', M.SEAT.owed(data, again.s, 's1', M.SEAT.newMind(), { only: ['tick'] })?.options.map((x) => x.id), ['tick:link']);
  M.L.setLocalSeat(null);
  closeAll(w, def, low, dune, again);
}
{
  const over = await table({ ...raid, id: 't-over', seats: { s1: 'k-over', s2: 'k-rdl' } }, 'Volt', 'Dune');
  const o = over.d.options.find((x) => x.id === 'tick:overload');
  const was = { link: over.U.Volt.link, ticks: over.s.script.opp.action };
  check('THE OVERLOADING PACK\'S OVERLOAD IS AN ANSWER, and taken it spends a Link for Ticks',
    [ticks(over.d), o?.commands, run(over.s, o?.commands ?? []), over.U.Volt.link, over.s.script.opp.action > was.ticks],
    [['tick:overload'], [{ kind: 'overload', seat: 's1', uid: over.U.Volt.uid }], [true], was.link - 1, true]);
  const crisis = await table({ ...raid, id: 't-crisis', seats: { s1: 'k-crisis', s2: 'k-rdl' } }, 'Crisis', 'Dune');
  const a = crisis.d.options.find((x) => x.id === 'tick:attack-mode');
  const before = crisis.s.script.opp.action;
  const calm = await table({ ...raid, id: 't-crisis', seats: { s1: 'k-crisis', s2: 'k-rdl' } }, 'Crisis', 'Dune', { stance: 'mobility' });
  check('ATTACK MODE IS AN ANSWER IN OFFENSIVE STANCE, and taken it adds a Tick and fixes the Stance; in another Stance it is not offered',
    [ticks(crisis.d), a?.commands, run(crisis.s, a?.commands ?? []), crisis.s.script.opp.action, !!crisis.s.script.opp.stanceLocked, ticks(calm.d)],
    [['tick:attack-mode'], [{ kind: 'attackMode', seat: 's1', uid: crisis.U.Crisis.uid }], [true], before + 1, true, []]);
  closeAll(over, crisis, calm);
}

// ---------- the Tactician ----------
{
  // The Wild Cat in front of the Mire: a Tick more is a shot more.
  const w = await table(raid, 'Mire', 'Wild Cat');
  const view = viewOf(w.s, 's1');
  const pick = AI.tacticianPolicy.choose(w.d, view, new AI.Rng('t'));
  // What the Tick opens, and what the turn is without it, as the Tactician
  // plans each.
  const withTick = AI.weighed(w.d.options.find((x) => x.id === 'tick:link').then(), view, {})[0];
  const without = AI.weighed(w.d, view, { ticks: false })[0];
  check('THE TACTICIAN BUYS THE TICK WHERE THE TURN IT OPENS IS WORTH MORE THAN THE LINK: here, with an enemy in front of it',
    [pick.option, pick.reason, Math.abs(pick.score - (withTick.worth - without.worth - AI.TACTICIAN.link)) < 1e-6, pick.score > 0], ['tick:link', 'tick_by_value', true, true]);
  // Nobody in reach: a Tick more buys nothing worth a Link.
  const far = await table(raid, 'Mire', 'Wild Cat', { far: true });
  check('and keeps its Link where a Tick more would buy nothing worth it: nobody in reach',
    AI.tacticianPolicy.choose(far.d, viewOf(far.s, 's1'), new AI.Rng('t')).option === 'tick:link', false);
  // Attack Mode costs no Link: the Stance it fixes is in the plan it leads to.
  const crisis = await table({ ...raid, id: 't-crisis', seats: { s1: 'k-crisis', s2: 'k-rdl' } }, 'Crisis', 'Dune');
  const cview = viewOf(crisis.s, 's1');
  const mode = AI.tacticianPolicy.choose(crisis.d, cview, new AI.Rng('t'));
  const opened = AI.weighed(crisis.d.options.find((x) => x.id === 'tick:attack-mode').then(), cview, {})[0];
  const plain = AI.weighed(crisis.d, cview, { ticks: false })[0];
  check('the Crisis takes Attack Mode by the turn it opens, and pays no Link for it',
    [mode.option, mode.reason, Math.abs(mode.score - (opened.worth - plain.worth)) < 1e-6], ['tick:attack-mode', 'tick_by_value', true]);
  crisis.t.close();
  const off = AI.makeTactician({ ticks: false });
  check('with its skill off (`ticks`) it buys none, nor do the Brawler and the eager policy, which know nothing of it',
    [off.choose(w.d, view, new AI.Rng('t')).option, AI.brawlerPolicy.choose(w.d, view, new AI.Rng('t')).option, AI.eagerPolicy.choose(w.d, view, new AI.Rng('t')).option].map((x) => x.startsWith('tick')),
    [false, false, false]);
  closeAll(w, far);
}

// ---------- whole games ----------
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], bought: {} };
  const scenarios = [raid, { ...raid, id: 't-over-games', seats: { s1: 'k-over', s2: 'k-rdl' } }, { ...raid, id: 't-crisis-games', seats: { s1: 'k-crisis', s2: 'k-rdl' } }];
  for (const [policy, seeds] of [['legal', [1]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]]]) {
    for (const seed of seeds) {
      for (const scenario of scenarios) {
        const t = botTable(M, data, scenario, { seed, policies: AI[`${policy}Policy`], glue: M.HUD.glueAfter });
        t.watch((cmd) => { if (['linkTick', 'overload', 'attackMode'].includes(cmd.kind)) tally.bought[cmd.kind] = (tally.bought[cmd.kind] ?? 0) + 1; });
        let end;
        try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
        tally.games += 1;
        if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed} ${scenario.id}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
        tally.refused += t.refused.length;
      }
    }
  }
  check('FIFTEEN GAMES (the copied squads, an Overloading Pack, a Crisis II), on the page\'s glue, four policies: every one ends as a game should, nothing refused, and Ticks were bought in them',
    [tally.over, tally.games, tally.refused, tally.broken, (tally.bought.linkTick ?? 0) > 0], [15, 15, 0, [], true]);
  console.log(`       Ticks bought ${JSON.stringify(tally.bought)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);

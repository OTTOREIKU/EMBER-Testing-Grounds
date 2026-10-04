// The pilot traits a seat plays (AI-OPPONENT-PLAN.md, M8.2r).
//
// FIREWATCH (ZPA-38, GoF 1.021): "When this Mech gains Action Opportunity, may
// consume 1 Link to generate a Command Token", which a Command Coordination
// may then hand to a Drone. ASTER (ZPA-36): in the Command Phase, a face-up
// Command Token of Aster's Mech consumed for 1 Link on an Ally Mech, once a
// round. The Match Centre offers each in its turn panel; the seam offered
// neither. Now Firewatch is an answer beside the Ticks bought as a Mech's
// Opportunity opens, and Aster an answer beside the Command Phase's
// designations and at its Continue, each where the engine takes it.
import { readFileSync } from 'node:fs';
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The pilot traits\n');

const { M, data } = await loadEngine('seatpilots', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const rifle = (name) => ({ name, loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
// GoF: a Tracer flown by Firewatch, a Chariot flown by Aster, and two Drones
// whose guns are Command Actions (a Ram, a Ballista). UN: two riflemen. The
// VIP game's Main Task scores no zones, so a plan is about the fight.
data.solo.squads['r-pilots'] = {
  name: 'Pilots', faction: 'GOF', points: 0,
  mechs: [
    { name: 'Tracer', loadout: { torso: '174', chasis: '179', leftHand: 'ZHLA-101', rightHand: 'ZHRA-101', pilot: 'ZPA-38' } },
    { name: 'Chariot', loadout: { torso: '176', chasis: '180', leftHand: 'ZHLA-302', rightHand: 'ZHRA-102', pilot: 'ZPA-36' } },
  ],
  drones: [{ cardId: 'ZHDR-107' }, { cardId: 'ZHDR-106' }],
};
data.solo.squads['r-rifles'] = { name: 'Riflemen', faction: 'UN', points: 0, mechs: [rifle('Wolf'), rifle('Cat')], drones: [] };
const scenario = { ...data.solo.scenarios[1], id: 't-pilots', seats: { s1: 'r-pilots', s2: 'r-rifles' } };
const NAMES = { 'ZHDR-107': 'Ram', 'ZHDR-106': 'Ballista' };
const held = (t) => (t.statuses ?? []).filter((x) => x === 'command').length;

// A table past its setup on an open board, the units where it is told.
const table = async (where, policies = AI.tacticianPolicy) => {
  const t = botTable(M, data, { ...scenario, map: 'none' }, { seed: 3, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  const U = {};
  for (const x of s.tokens) U[NAMES[x.cardId] ?? x.label] = x;
  // A unit stands from the top-left cell of its Grid: a Large one fills it.
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  for (const [k, v] of Object.entries(where)) at(U[k], ...v);
  const send = (cmds) => cmds.map((cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.HUD.glueAfter(data, s, cmd); return v.ok; });
  // A Mech's face-up Command Tokens, set.
  const tokens = (x, n) => { x.statuses = [...(x.statuses ?? []).filter((y) => y !== 'command'), ...Array(n).fill('command')]; M.C.syncCommandPool(s); };
  // The Action Phase of a round, `first` the one to act, on `dial` (Firing,
  // where the guns fire): every other Mech has acted but those named in
  // `waiting`, which are on the Tactical dial, after it.
  const action = (first, { round = 1, waiting = [], dial = 'firing' } = {}) => {
    s.round.n = round; s.round.phase = 2; s.script.stage = `${round}:2`; s.script.opp = null; s.script.revealed = ['s1', 's2']; s.script.passed = [];
    for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'tactical';
    U[first].timing = dial;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== U[first].uid && !waiting.includes(NAMES[x.cardId] ?? x.label)).map((x) => x.uid);
    M.G.opportunity(data, s);
    return t.drivers.s1.pending();
  };
  // The Command Phase of a round, with the Tokens it generates; then each
  // Mech's face-up Tokens set where `hold` says.
  const command = ({ round = 1, hold = {}, commanded = [] } = {}) => {
    s.round.n = round; s.round.phase = 0; s.script.stage = `${round}:0`; s.script.opp = null; s.script.acted = []; s.script.passed = []; s.script.turn = 's1';
    s.ready = {};
    M.G.enterPhase(data, s);
    s.script.commanded = commanded.map((k) => U[k].uid);
    for (const [k, n] of Object.entries(hold)) tokens(U[k], n);
    return t.drivers.s1.pending();
  };
  return { t, s, U, at, send, tokens, action, command };
};
const AWAY = { Chariot: [10, 0, 2], Ballista: [0, 0, 2], Cat: [11, 11, 0] };

// ---------- the cards ----------
{
  const card = (id) => data.byId.get(id);
  check('the pilots are what the test means them to be: Firewatch and Aster, GoF', [card('ZPA-38').name.en, card('ZPA-36').name.en, data.factionOf(card('ZPA-38')), data.factionOf(card('ZPA-36'))], ['Firewatch', 'Aster', 'GOF', 'GOF']);
}

// ---------- Firewatch: the seam ----------
{
  const x = await table({ Tracer: [5, 4, 2], Ram: [4, 5, 2], Wolf: [5, 8, 0], ...AWAY });
  x.tokens(x.U.Tracer, 0);
  const d = x.action('Tracer');
  const fw = d.options.find((o) => o.id === 'tick:firewatch');
  check('AS THE TRACER\'S OPPORTUNITY OPENS, FIREWATCH IS OFFERED beside the Ticks bought: one command, the Link and the Token in it',
    [d.kind, d.unit, fw?.tags, fw?.commands], ['opp.act', x.U.Tracer.uid, ['tick', 'firewatch'], [{ kind: 'firewatch', seat: 's1', uid: x.U.Tracer.uid }]]);
  const link = x.U.Tracer.link;
  check('THE ENGINE TAKES IT: a Link less and a face-up Command Token', [x.send(fw.commands), x.U.Tracer.link, held(x.U.Tracer)], [[true], link - 1, 1]);
  check('and it is offered no more this Opportunity', x.t.drivers.s1.pending()?.options.some((o) => o.id === 'tick:firewatch'), false);
  const c = x.action('Chariot', { round: 2 });
  check('the Chariot, whose pilot is Aster, is offered none', [c?.unit, c?.options.some((o) => o.id === 'tick:firewatch')], [x.U.Chariot.uid, false]);
  x.t.close();
}
{
  // Not once the Opportunity has begun, nor at the last Link.
  const x = await table({ Tracer: [5, 4, 2], Ram: [4, 5, 2], Wolf: [5, 8, 0], ...AWAY });
  let d = x.action('Tracer');
  x.send(d.options.find((o) => o.tags.includes('pivot') && o.facts?.facing === 3).commands);
  d = x.t.drivers.s1.pending();
  check('NOT ONCE THE TRACER HAS MANEUVERED: it is taken as the Opportunity opens', d?.options.some((o) => o.id === 'tick:firewatch'), false);
  x.U.Tracer.link = 1;
  const e = x.action('Tracer', { round: 2 });
  check('nor at its last Link (4.10)', [e?.unit, e?.options.some((o) => o.id === 'tick:firewatch')], [x.U.Tracer.uid, false]);
  x.t.close();
}

// ---------- Firewatch: the Tactician ----------
{
  // The Tracer holds no Token and has the Wolf in its Range; so has the Ram,
  // whose gun is a Command Action. Firewatch's Token lets the Tracer's shot
  // hand the Ram a Command.
  const x = await table({ Tracer: [5, 4, 2], Ram: [4, 5, 2], Wolf: [5, 8, 0], ...AWAY });
  x.tokens(x.U.Tracer, 0); x.tokens(x.U.Chariot, 0);
  const d = x.action('Tracer', { waiting: ['Wolf'] });
  const view = viewOf(x.s, 's1');
  const pick = AI.tacticianPolicy.choose(d, view, new AI.Rng('f'));
  check('THE TACTICIAN TAKES FIREWATCH WHERE THE COORDINATION IT BUYS IS WORTH MORE THAN THE LINK: the Tracer\'s shot hands the Ram a Command, with the Wolf in the Ram\'s gun\'s Range',
    [pick.option, pick.reason, pick.score > 0], ['tick:firewatch', 'tick_by_value', true]);
  check('with the skill off it is not taken', AI.makeTactician({ firewatch: false }).choose(d, view, new AI.Rng('f')).option === 'tick:firewatch', false);
  check('nor with a Link reckoned dearer than the Command it buys', AI.makeTactician({}, { link: 50 }).choose(d, view, new AI.Rng('f')).option === 'tick:firewatch', false);
  // Holding a Token already, the Tracer has that Coordination either way.
  x.tokens(x.U.Tracer, 1);
  const held1 = x.t.drivers.s1.pending();
  const kept = AI.tacticianPolicy.choose(held1, viewOf(x.s, 's1'), new AI.Rng('f'));
  check('HOLDING A TOKEN ALREADY, IT IS NOT TAKEN: the Coordination after the shot is there without it', [held1.options.some((o) => o.id === 'tick:firewatch'), kept.option === 'tick:firewatch'], [true, false]);
  x.t.close();
}
{
  // No Drone on the board: the Token would buy nothing.
  const x = await table({ Tracer: [5, 4, 2], Ram: [4, 5, 2], Wolf: [5, 8, 0], ...AWAY });
  x.s.tokens = x.s.tokens.filter((y) => y.kind !== 'drone');
  x.tokens(x.U.Tracer, 0);
  const d = x.action('Tracer', { waiting: ['Wolf'] });
  const pick = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng('f'));
  check('WITH NO DRONE TO HAND IT TO, FIREWATCH IS NOT TAKEN', [d.options.some((o) => o.id === 'tick:firewatch'), pick.option === 'tick:firewatch'], [true, false]);
  x.t.close();
}

// ---------- Aster: the seam ----------
{
  const x = await table({ Tracer: [5, 4, 2], Ram: [4, 5, 2], Wolf: [5, 8, 0], ...AWAY });
  x.U.Tracer.link = M.U.maxLink(data, x.U.Tracer) - 1;
  const d = x.command({ hold: { Chariot: 1 } });
  const aster = d?.options.filter((o) => o.tags[0] === 'aster') ?? [];
  check('IN THE COMMAND PHASE, ASTER IS OFFERED BESIDE THE DESIGNATIONS: the Chariot\'s Token for 1 Link on each Ally Mech short of one, and none at full Link',
    [d?.kind, aster.map((o) => o.facts.targetUid), aster[0]?.commands], ['loop.designate.command', [x.U.Tracer.uid], [{ kind: 'asterRestore', seat: 's1', uid: x.U.Chariot.uid, targetUid: x.U.Tracer.uid }]]);
  check('its facts say what else the Token could do: one held face-up, and the Chariot\'s Actions carry Command Coordination', [aster[0]?.facts.held, aster[0]?.facts.coordinates], [1, true]);
  const only = (kinds) => M.SEAT.owed(data, x.s, 's1', M.SEAT.newMind(), { only: kinds })?.options.some((o) => o.tags[0] === 'aster');
  check('an asker that names its kinds is shown Aster only when it names `aster`', [only(['designate']), only(['aster'])], [false, true]);
  // The Ram commanded (the Tracer's Token pays): inside its activation, none.
  x.send(d.options.find((o) => o.id === `designate:${x.U.Ram.uid}`).commands);
  const inside = x.t.drivers.s1.pending();
  check('not inside a Drone\'s activation', [inside?.kind, inside?.unit, inside?.options.some((o) => o.tags[0] === 'aster')], ['activation.act', x.U.Ram.uid, false]);
  x.send(inside.options.find((o) => o.id === 'end').commands);
  const again = x.t.drivers.s1.pending()?.options.find((o) => o.tags[0] === 'aster');
  const link = x.U.Tracer.link;
  check('THE ENGINE TAKES IT, back beside the designations: the Tracer has its Link, the Chariot\'s Token is spent',
    [!!again, x.send(again.commands), x.U.Tracer.link, held(x.U.Chariot)], [true, [true], link + 1, 0]);
  x.U.Tracer.link -= 1;
  x.tokens(x.U.Chariot, 1);
  check('and once a round: it is offered no more', x.t.drivers.s1.pending()?.options.some((o) => o.tags[0] === 'aster'), false);
  x.t.close();
}

// ---------- Aster: the Tactician ----------
{
  // No Drone on the board: the squad is asked nothing of the Command Phase but
  // its Continue, and the Chariot's Token has nothing else to do.
  const x = await table({ Tracer: [5, 4, 2], Ram: [4, 5, 2], Wolf: [5, 8, 0], ...AWAY });
  x.s.tokens = x.s.tokens.filter((y) => y.kind !== 'drone');
  // Both Mechs are short of a Link; the Tracer has lost its Railgun arm.
  x.U.Tracer.link = M.U.maxLink(data, x.U.Tracer) - 1;
  x.U.Chariot.link = M.U.maxLink(data, x.U.Chariot) - 1;
  x.U.Tracer.partStates = { ...x.U.Tracer.partStates, rightHand: 'destroyed' };
  const d = x.command({ hold: { Chariot: 1, Tracer: 0 } });
  const view = viewOf(x.s, 's1');
  const worth = (u) => AI.unitWorth(view.units.find((y) => y.uid === u.uid), view, AI.TACTICIAN);
  const most = worth(x.U.Tracer) > worth(x.U.Chariot) ? x.U.Tracer : x.U.Chariot;
  const pick = AI.tacticianPolicy.choose(d, view, new AI.Rng('a'));
  check('WITH NO DRONE TO COMMAND, THE TACTICIAN SPENDS THE TOKEN ON ASTER\'S LINK, at the Command Phase\'s Continue, for the Mech worth most of those short of one',
    [d?.kind, d?.options.filter((o) => o.tags[0] === 'aster').length, worth(x.U.Tracer) !== worth(x.U.Chariot), pick.option, pick.reason],
    ['phase.ready', 2, true, `aster:${x.U.Chariot.uid}:${most.uid}`, 'aster_link']);
  check('with the skill off it goes on', AI.makeTactician({ aster: false }).choose(d, viewOf(x.s, 's1'), new AI.Rng('a')).option, 'ready');
  x.t.close();
}
{
  // Both Drones have had their Command this phase: the Chariot's Token is kept
  // for a Command Coordination in the Action Phase, unless it holds more Tokens
  // than there are Drones to hand them to.
  const x = await table({ Tracer: [5, 4, 2], Ram: [4, 5, 2], Wolf: [5, 8, 0], ...AWAY });
  x.U.Tracer.link = M.U.maxLink(data, x.U.Tracer) - 1;
  const d = x.command({ hold: { Chariot: 1, Tracer: 0 }, commanded: ['Ram', 'Ballista'] });
  const kept = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng('a'));
  check('A TOKEN THE CHARIOT COULD HAND A DRONE IN ITS OWN TURN IS KEPT', [d?.kind, d?.options.some((o) => o.tags[0] === 'aster'), kept.option], ['phase.ready', true, 'ready']);
  x.tokens(x.U.Chariot, 3);
  const d2 = x.t.drivers.s1.pending();
  const spent = AI.tacticianPolicy.choose(d2, viewOf(x.s, 's1'), new AI.Rng('a'));
  check('one of three, with two Drones to hand them to, is spent on the Link', spent.option, `aster:${x.U.Chariot.uid}:${x.U.Tracer.uid}`);
  x.t.close();
}
{
  // Beside the designations: both Drones Immobilized and nothing in their
  // guns' Range, so a Command buys neither anything, and the Chariot holds
  // more Tokens than there are Drones to hand them to.
  const x = await table({ Tracer: [2, 0, 2], Ram: [1, 0, 2], Ballista: [0, 0, 2], Chariot: [3, 0, 2], Wolf: [11, 11, 0], Cat: [10, 11, 0] });
  for (const k of ['Ram', 'Ballista']) x.U[k].statuses = [...(x.U[k].statuses ?? []), 'immobilized'];
  x.U.Tracer.link = M.U.maxLink(data, x.U.Tracer) - 1;
  const d = x.command({ hold: { Chariot: 3, Tracer: 0 } });
  const pick = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng('a'));
  check('BESIDE THE DESIGNATIONS, WHERE NO DRONE GAINS BY A COMMAND, THE TACTICIAN SPENDS A TOKEN NOTHING ELSE WOULD USE ON ASTER\'S LINK',
    [d?.kind, d?.options.some((o) => o.tags[0] === 'designate'), pick.option, pick.reason], ['loop.designate.command', true, `aster:${x.U.Chariot.uid}:${x.U.Tracer.uid}`, 'aster_link']);
  x.t.close();
}
{
  // The Ram has the Wolf in its gun's Range: a Command is worth giving it, and
  // the Token goes to it before Aster has one, however many the Chariot holds.
  const x = await table({ Tracer: [5, 4, 2], Ram: [4, 5, 2], Wolf: [5, 8, 0], ...AWAY });
  x.U.Tracer.link = M.U.maxLink(data, x.U.Tracer) - 1;
  const d = x.command({ hold: { Chariot: 3, Tracer: 0 } });
  const pick = AI.tacticianPolicy.choose(d, viewOf(x.s, 's1'), new AI.Rng('a'));
  check('WHERE A DRONE GAINS BY A COMMAND, THE TOKEN GOES TO IT BEFORE ASTER',
    [d?.kind, d?.options.some((o) => o.tags[0] === 'aster'), pick.reason], ['loop.designate.command', true, 'command_by_value']);
  x.t.close();
}

// ---------- the register ----------
{
  const cover = src('./aicover.mjs');
  check('the coverage register has both as answers a seat gives', [/firewatch: \['seat'/.test(cover), /asterRestore: \['seat'/.test(cover)], [true, true]);
}

// ---------- whole games ----------
// Firewatch and Aster in whole games, five policies; and a seat that takes
// every trait answer it is offered (the Tactician otherwise), so each runs
// through the engine to the game's end.
const taker = {
  name: 'taker',
  choose(d, view, rng) {
    const xs = d.options.filter((o) => o.id === 'tick:firewatch' || o.tags[0] === 'aster');
    if (xs.length) return { option: xs[Math.floor(rng.next() * xs.length)].id, why: 'every trait it may' };
    return AI.tacticianPolicy.choose(d, view, rng);
  },
};
M.L.setLocalSeat(null);
{
  const games = { ...data.solo.scenarios[0], id: 't-pilots-games', seats: { s1: 'r-pilots', s2: 'r-rifles' } };
  const tally = { games: 0, over: 0, refused: 0, broken: [], firewatch: 0, aster: 0 };
  for (const [policy, seeds] of [['legal', [1, 2]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]], ['taker', [1, 2]]]) {
    for (const seed of seeds) {
      const t = botTable(M, data, games, { seed, policies: { s1: policy === 'taker' ? taker : AI[`${policy}Policy`], s2: AI.tacticianPolicy }, glue: M.HUD.glueAfter });
      t.watch((cmd) => { if (cmd.kind === 'firewatch') tally.firewatch += 1; if (cmd.kind === 'asterRestore') tally.aster += 1; });
      let end;
      try { end = await t.run({ maxSteps: 16000 }); } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
      tally.games += 1;
      if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
      tally.refused += t.refused.length;
    }
  }
  check('EIGHT GAMES with Firewatch and Aster in them, on the page\'s glue, five policies: every one ends as a game should, nothing refused, and each trait was used in them',
    [tally.over, tally.games, tally.refused, tally.broken, tally.firewatch > 0, tally.aster > 0], [8, 8, 0, [], true, true]);
  console.log(`       Firewatch ${tally.firewatch}, Aster ${tally.aster}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);

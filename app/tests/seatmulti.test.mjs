// Multi-Target, answered by a seat (FAQ B7, A25; AI-OPPONENT-PLAN.md, M8.2j).
//
// A Multi-Target Action settles its pool once and splits it between up to X
// targets, each then attacked in a sequence of its own, all resolved as one
// (B7). The computer fired the whole pool at the one target it clicked: the
// split's dice controls had no name it could press, so its one answer was
// Begin. Nor could it put odds on such an attack at all, before it or inside
// it. Now the window offers every split the card allows (each target a die at
// least, the settled total never changed), each with the odds of every share;
// the Tactician takes the split worth most, the other policies Begin.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Multi-Target\n');

const { M, data } = await loadEngine('seatmulti', ["export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';", "export * as ODDS from '../src/ai/odds';"]);
const AI = M.AI;
const T = M.TURN;
const viewOf = (state, seat) => M.SEAT.viewOf(data, state, seat);

// PD: a Crisis (H2-B Crisis II, Multi-Target 5). RDL: a Stratus (the ACX-350
// Stratus Prototype HMG, [Two-Handed] Multi-Target 3) with a Cleaver in the
// other hand, a Freehand; and one with a Type 55 Shield and Cleaver, which is
// none. UN: a gunner with the R7MG LMG ([Charged] Multi-target 3 or
// Suppression); the riflemen, with a Drone.
const rifle = (name) => ({ name, loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '541', backpack: '538', pilot: 'LPA-23-2' } });
data.solo.squads['m-crisis'] = { name: 'Crisis', faction: 'PD', points: 0, mechs: [{ name: 'Crisis', loadout: { torso: '547', chasis: '548', leftHand: '550', rightHand: '551', backpack: '545', pilot: 'XPA-59' } }], drones: [] };
data.solo.squads['m-stratus'] = { name: 'Stratus', faction: 'RDL', points: 0, mechs: [{ name: 'Stratus', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '038', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] };
data.solo.squads['m-shield'] = { name: 'Shield', faction: 'RDL', points: 0, mechs: [{ name: 'Stratus', loadout: { torso: '533', chasis: '534', leftHand: '023', rightHand: '038', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] };
data.solo.squads['m-lmg'] = { name: 'Gunner', faction: 'UN', points: 0, mechs: [{ name: 'Gunner', loadout: { torso: '539', chasis: '099', leftHand: '540', rightHand: '556', backpack: '538', pilot: 'LPA-23-2' } }], drones: [] };
data.solo.squads['m-rifles'] = { name: 'Riflemen', faction: 'UN', points: 0, mechs: [rifle('Wolf'), rifle('Cat')], drones: [{ cardId: 'PRDR-202' }] };
data.solo.squads['m-rifles3'] = { name: 'Riflemen', faction: 'UN', points: 0, mechs: [rifle('Wolf'), rifle('Cat')], drones: [{ cardId: 'PRDR-202' }, { cardId: 'PRDR-202' }] };
data.solo.squads['m-rdl'] = { name: 'Gunners', faction: 'RDL', points: 0, mechs: [
  { name: 'Dune', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } },
  { name: 'Sand', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] };
const scenario = { ...data.solo.scenarios[0], id: 't-multi' };

// The number of splits a window should offer: each set of the other
// candidates the limit allows, times the ways to share the pool between the
// set and the target clicked, a die at least each (counted the long way).
const choose = (n, k) => (k < 0 || k > n ? 0 : k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k);
const ways = (red, yellow, k) => {
  if (k === 1) return red + yellow >= 1 ? 1 : 0;
  let n = 0;
  for (let r = 0; r <= red; r++) for (let y = 0; y <= yellow; y++) if (r + y >= 1) n += ways(red - r, yellow - y, k - 1);
  return n;
};
const splitsOf = (pool, candidates, limit) => {
  let n = 0;
  for (let added = 1; added <= Math.min(limit - 1, candidates); added++) n += choose(candidates, added) * ways(pool.red, pool.yellow, added + 1);
  return n;
};

// A table past its setup, staged in the Action Phase on an open board.
const table = async (seats, arrange, policies, seed = 3) => {
  const t = botTable(M, data, { ...scenario, map: 'none', seats }, { seed, policies, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' });
  const s = t.state;
  // The Drones by their order: Drone, Drone2.
  const U = {};
  let drones = 0;
  for (const x of s.tokens) U[x.kind === 'drone' ? (drones++ ? `Drone${drones}` : 'Drone') : x.label] = x;
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  const sc = s.script;
  s.round.phase = 2; sc.stage = '1:2'; sc.opp = null; sc.revealed = ['s1', 's2']; sc.passed = [];
  for (const x of s.tokens) if (x.kind === 'mech') x.timing = 'firing';
  arrange({ s, U, at });
  return { t, s, U };
};
const turnOf = (s, mech, timing = 'firing') => {
  mech.timing = timing;
  s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
  s.script.opp = null;
  M.G.opportunity(data, s);
};
// The riflemen in a row in front of the attacker, the Drones beside them.
const facing = ({ U, at }, who) => { at(U[who], 4, 3, 2); at(U.Wolf, 3, 7, 0); at(U.Cat, 5, 7, 0); at(U.Drone, 4, 8, 0); if (U.Drone2) at(U.Drone2, 2, 8, 0); };

// A seat that makes the attack named and answers the split as told, and
// otherwise plays as the Tactician; what it was asked is kept.
const tact = AI.makeTactician({ focus: false });
const scripted = (shot, split) => {
  const seen = { split: null, view: null, after: [] };
  const policy = {
    name: 'scripted',
    choose(d, view, rng) {
      if (d.kind === 'opp.act') {
        const o = d.options.find(shot);
        if (o) return { option: o.id, why: 'scripted' };
      }
      if (d.kind === 'attack.split') {
        seen.split = d; seen.view = view;
        return { option: split(d, view, rng) ?? d.fallback, why: 'scripted' };
      }
      if (seen.split && d.kind.startsWith('attack.')) seen.after.push({ kind: d.kind, target: d.facts.targetUid, odds: d.options.some((o) => !!o.chance?.()) });
      return tact.choose(d, view, rng);
    },
  };
  return { seen, policy };
};
const attackOn = (actionId, targetUid, extra = (o) => !o.tags.includes('spend-charge')) => (o) => o.run?.routine === 'attack' && o.facts?.actionId === actionId && o.facts?.targetUid === targetUid && extra(o);
const done = (who) => (st) => st.script.opp?.uid !== who.uid && !st.script.combatView;
const splitIds = (d) => (d?.options ?? []).filter((o) => o.tags.includes('split'));

// ---------- the cards ----------
{
  const x = await table({ s1: 'm-stratus', s2: 'm-rifles' }, (w) => facing(w, 'Stratus'));
  const { s, U } = x;
  const shield = await table({ s1: 'm-shield', s2: 'm-rifles' }, (w) => facing(w, 'Stratus'));
  const lmg = await table({ s1: 'm-lmg', s2: 'm-rdl' }, ({ U: V, at }) => { at(V.Gunner, 4, 3, 2); at(V.Dune, 3, 7, 0); at(V.Sand, 5, 7, 0); });
  const crisis = await table({ s1: 'm-crisis', s2: 'm-rifles' }, (w) => facing(w, 'Crisis'));
  const held = (w, who, actionId, target, extra = {}) => T.multiTargetHeld(data, w.s, { uid: w.U[who].uid, actionId, targetUid: w.U[target].uid, ...extra });
  check('A MULTI-TARGET\'S LIMIT IS THE COMPUTER\'S ONLY WHERE IT HOLDS: printed outright (547_A, 5); gained under [Two-Handed] with a Freehand designated (038_A, 3), and not when the hand is declined or there is no Freehand; gained under [Charged] only with the Charge spent on that arm (556_A, 3)',
    [held(crisis, 'Crisis', '547_A', 'Wolf'), held(x, 'Stratus', '038_A', 'Wolf'), held(x, 'Stratus', '038_A', 'Wolf', { twoHandedDeclined: true }), held(shield, 'Stratus', '038_A', 'Wolf'),
      held(lmg, 'Gunner', '556_A', 'Dune'), held(lmg, 'Gunner', '556_A', 'Dune', { charged: true, chargeChoice: 'multi_target_3' }), held(lmg, 'Gunner', '556_A', 'Dune', { charged: true, chargeChoice: 'suppression' })],
    [{ limit: 5, condition: null }, { limit: 3, condition: null }, null, null, null, { limit: 3, condition: null }, null]);
  check('  (while the window, which leaves the condition to the player, opens every one of them on its split)',
    [!!T.attackOpening(data, s, U.Stratus.uid, '038_A', U.Wolf.uid)?.multi, !!T.attackOpening(data, shield.s, shield.U.Stratus.uid, '038_A', shield.U.Wolf.uid)?.multi], [true, true]);
  for (const w of [x, shield, lmg, crisis]) w.t.close();
}

// ---------- the odds ----------
{
  const w = await table({ s1: 'm-crisis', s2: 'm-rifles' }, (v) => facing(v, 'Crisis'));
  turnOf(w.s, w.U.Crisis);
  const odds = new M.ODDS.Odds(data);
  const a = { uid: w.U.Crisis.uid, actionId: '547_A', targetUid: w.U.Wolf.uid, mode: 'attack' };
  const r = odds.read(w.s, a);
  const pens = [1, 3, 6].map((y) => odds.share(r, { red: 0, yellow: y }).pen);
  check('A MULTI-TARGET HAS ODDS: read as its Begin makes it, the whole pool (5 Yellow and the Stationary one) on the target named; and one target\'s share is the attack with those dice alone, worth less the fewer they are',
    [r?.attack, JSON.stringify(odds.share(r, r.attack)) === JSON.stringify(odds.forecast(w.s, a)), pens[0] < pens[1] && pens[1] < pens[2]], [{ red: 0, yellow: 6 }, true, true]);
  const d = w.t.drivers.s1.pending();
  const shot = d.options.find(attackOn('547_A', w.U.Wolf.uid));
  check('and the attack the seam offers carries them (it was priced blind)', JSON.stringify(shot?.chance?.()) === JSON.stringify(odds.forecast(w.s, { ...a, before: shot?.run?.args?.before ?? [] })), true);
  w.t.close();
}

// ---------- the split ----------
const two = { s1: null, s2: null };
let live = null;
const watcher = {
  name: 'watcher',
  choose(d, view, rng) {
    if (live && live.seen.split && d.facts?.targetUid === live.cat && d.kind.startsWith('defence.')) live.mirror.push(two.t.drivers.s2.combat.reading()?.attack ?? null);
    return tact.choose(d, view, rng);
  },
};
{
  const plan = scripted(attackOn('547_A', null), () => null);
  const w = await table({ s1: 'm-crisis', s2: 'm-rifles' }, (v) => facing(v, 'Crisis'), { s1: { name: 'x', choose: (d, v, g) => plan.policy.choose(d, v, g) }, s2: watcher });
  two.t = w.t;
  const { s, U, t } = w;
  const wolf = U.Wolf.uid, cat = U.Cat.uid, drone = U.Drone.uid;
  // The Wolf the primary; the split taken is 3 Yellow at the Wolf and 3 at the Cat.
  const mine = scripted(attackOn('547_A', wolf), (d) => d.options.find((o) => o.id === `split:${wolf}=0r3y,${cat}=0r3y`)?.id);
  plan.policy.choose = mine.policy.choose;
  live = { seen: mine.seen, cat, mirror: [] };
  turnOf(s, U.Crisis);
  const views = [];
  const defences = [];
  t.watch((cmd) => {
    if (cmd.kind === 'setCombatView' && cmd.view?.multi && cmd.view.step !== 'split') views.push(`${cmd.view.targetUid}:${cmd.view.attackPool.red}r${cmd.view.attackPool.yellow}y`);
    if (cmd.kind === 'callDefense') defences.push(cmd.targetUid);
  });
  const end = await t.run({ until: done(U.Crisis), maxSteps: t.steps() + 120 });
  const d = mine.seen.split;
  const splits = splitIds(d);
  const sums = splits.map((o) => o.facts.split.reduce((n, x) => n + x.red + x.yellow, 0));
  check('THE SPLIT IS OFFERED: Begin, and every split the limit allows of the Wolf (the target clicked) with the Cat, the Drone or both, each with a die at least',
    [d?.kind, d?.fallback, d?.options[0]?.id, splits.length, splits.length === splitsOf({ red: 0, yellow: 6 }, 2, 5), sums.every((n) => n === 6), splits.every((o) => o.facts.split.every((x) => x.red + x.yellow >= 1) && o.facts.split[0].uid === wolf),
      new Set(splits.flatMap((o) => o.facts.split.map((x) => x.uid))).size, new Set(d.options.map((o) => o.id)).size === d.options.length],
    ['attack.split', 'split.begin', 'split.begin', 20, true, true, true, 3, true]);
  const picked = d.options.find((o) => o.id === `split:${wolf}=0r3y,${cat}=0r3y`);
  check('each split names its shares, and the dice controls it is pressed with are never answers of their own',
    [picked?.label, picked?.facts?.split, d.options.filter((o) => /^split\.(less|more|add|drop|scan)/.test(o.id)).length],
    ['Split the pool: 3 Yellow at Wolf, 3 Yellow at Cat', [{ uid: wolf, red: 0, yellow: 3 }, { uid: cat, red: 0, yellow: 3 }], 0]);
  const shares = picked?.shares?.() ?? [];
  const whole = d.options[0].shares?.() ?? [];
  check('and says what each share is likely to do: Begin the whole pool on the Wolf, the split 3 Yellow on each, read a target at a time',
    [whole.map((x) => [x.targetUid, x.pool]), shares.map((x) => [x.targetUid, x.pool]), whole[0]?.chance?.pen > shares[0]?.chance?.pen, shares.every((x) => x.chance && x.chance.pen > 0)],
    [[[wolf, { red: 0, yellow: 6 }]], [[wolf, { red: 0, yellow: 3 }], [cat, { red: 0, yellow: 3 }]], true, true]);
  check('TAKEN, THE WINDOW MAKES ONE SEQUENCE FOR EACH TARGET, ON ITS SHARE: the Wolf with 3 Yellow, then the Cat with 3, each defending with its own roll, and the attack ends with nothing refused',
    [[...new Set(views)], defences, end.kind, t.refused, !s.script.combatView], [[`${wolf}:0r3y`, `${cat}:0r3y`], [wolf, cat], 'paused', [], true]);
  const second = mine.seen.after.filter((x) => x.target === cat);
  check('the questions of the second sequence are about the Cat, with odds read on its share; and the defending seat\'s picture of it reads the same share',
    [second.length > 0, second.some((x) => x.odds), mine.seen.after.filter((x) => x.target !== wolf && x.target !== cat).length, live.mirror.length > 0, live.mirror.every((x) => x?.yellow === 3)],
    [true, true, 0, true, true]);
  // The Tactician's own answer to the same question, and what it reads.
  const view = mine.seen.view;
  const worth = (o) => (o.shares?.() ?? []).reduce((n, x) => n + AI.gainOf(x.chance, view.units.find((u) => u.uid === x.targetUid), view, AI.TACTICIAN), 0);
  const best = d.options.reduce((b, o) => (worth(o) > worth(b) + 1e-9 ? o : b), d.options[0]);
  const c = tact.choose(d, view, new AI.Rng('t'));
  check('THE TACTICIAN TAKES THE ANSWER WORTH MOST: each share weighed as the window\'s other questions weigh a shot, Begin among them; here a split',
    [c.option, c.reason, Math.abs(c.score - worth(best)) < 1e-9, best.tags.includes('split')], [best.id, 'split_by_value', true, true]);
  const pick = (p) => p.choose(d, view, new AI.Rng('p')).option;
  check('with its skill off (`spread`) it begins with the whole pool, and so do the safe answer and the eager policy; the legal policy draws among them',
    [pick(AI.makeTactician({ focus: false, spread: false })), pick(AI.safePolicy), pick(AI.eagerPolicy), d.options.some((o) => o.id === pick(AI.legalPolicy))], ['split.begin', 'split.begin', 'split.begin', true]);
  live = null;
  t.close();
}
{
  // Hand-made: Begin worth more than any split, and the other way about.
  const view = { seat: 's1', other: 's2', units: [
    { uid: 1, side: 's1', kind: 'mech', grid: { col: 0, row: 0 }, deployed: true, alive: true, weapons: [], health: 1, points: 100, parts: [] },
    { uid: 2, side: 's2', kind: 'drone', grid: { col: 2, row: 0 }, deployed: true, alive: true, weapons: [], health: 1, points: 40, parts: [] },
    { uid: 3, side: 's2', kind: 'drone', grid: { col: 3, row: 0 }, deployed: true, alive: true, weapons: [], health: 1, points: 40, parts: [] },
  ], zones: [], vp: { s1: 0, s2: 0 }, round: 1, roundLimit: 5, opportunity: null };
  const f = (kill) => ({ hit: 1, pen: kill, damage: 0, destroy: kill, kill, link: 0, parts: [], pick: null });
  const q = (beginKill, eachKill) => ({ id: 'q', kind: 'attack.split', seat: 's1', unit: 1, fallback: 'split.begin', facts: { attackerUid: 1, targetUid: 2 }, options: [
    { id: 'split.begin', label: 'Begin', tags: [], shares: () => [{ targetUid: 2, pool: { red: 0, yellow: 6 }, chance: f(beginKill) }] },
    { id: 'split:2=0r3y,3=0r3y', label: 'Split', tags: ['attack', 'split'], facts: { split: [{ uid: 2, red: 0, yellow: 3 }, { uid: 3, red: 0, yellow: 3 }] },
      shares: () => [{ targetUid: 2, pool: { red: 0, yellow: 3 }, chance: f(eachKill) }, { targetUid: 3, pool: { red: 0, yellow: 3 }, chance: f(eachKill) }] }] });
  check('BEGIN IS TAKEN WHERE THE WHOLE POOL IS WORTH MORE (one kill nearly sure against two halves unlikely), and the split where the shares are',
    [tact.choose(q(0.9, 0.3), view, new AI.Rng('a')).option, tact.choose(q(0.9, 0.3), view, new AI.Rng('a')).reason, tact.choose(q(0.5, 0.45), view, new AI.Rng('a')).option],
    ['split.begin', 'split_whole', 'split:2=0r3y,3=0r3y']);
  // A share nobody can put odds on is no share worth nothing: the split it is
  // in is not weighed at all, however good its other share looks.
  const blind = q(0.5, 0.6);
  const [first] = blind.options[1].shares();
  blind.options[1].shares = () => [first, { targetUid: 3, pool: { red: 0, yellow: 3 }, chance: null }];
  check('and a split with a share the odds cannot read is left alone, whatever its other share is worth', tact.choose(blind, view, new AI.Rng('a')).option, 'split.begin');
}

// ---------- the conditions ----------
{
  const run = async (seats, who, shot, opts = {}) => {
    const plan = scripted(() => false, () => null);
    const w = await table(seats, opts.arrange ?? ((v) => facing(v, who)), { s1: { name: 'x', choose: (d, v, g) => plan.policy.choose(d, v, g) }, s2: tact });
    const mine = scripted(shot(w.U), () => null);
    plan.policy.choose = mine.policy.choose;
    opts.before?.(w);
    turnOf(w.s, w.U[who]);
    const end = await w.t.run({ until: done(w.U[who]), maxSteps: w.t.steps() + 120 });
    w.t.close();
    return { d: mine.seen.split, end, refused: w.t.refused };
  };
  // Three enemies beside the Wolf, the limit three targets in all.
  const free = await run({ s1: 'm-stratus', s2: 'm-rifles3' }, 'Stratus', (U) => attackOn('038_A', U.Wolf.uid));
  const none = await run({ s1: 'm-shield', s2: 'm-rifles' }, 'Stratus', (U) => attackOn('038_A', U.Wolf.uid));
  check('THE STRATUS WITH A FREEHAND IS OFFERED SPLITS OF UP TO THREE TARGETS (7 Yellow), with three enemies to add beside the Wolf; the one with no Freehand begins only, its window\'s split notwithstanding',
    [splitIds(free.d).length === splitsOf(free.d?.options[0]?.shares?.()[0]?.pool ?? { red: 0, yellow: 0 }, 3, 3), free.d?.options[0]?.shares?.()[0]?.pool,
      new Set(splitIds(free.d).flatMap((o) => o.facts.split.map((x) => x.uid))).size, Math.max(...splitIds(free.d).map((o) => o.facts.split.length)), splitIds(none.d).length, none.d?.options.map((o) => o.id), free.refused, none.refused],
    [true, { red: 0, yellow: 7 }, 4, 3, 0, ['split.begin'], [], []]);
  const charged = (arm) => async () => run({ s1: 'm-lmg', s2: 'm-rdl' }, 'Gunner', (U) => attackOn('556_A', U.Dune.uid, (o) => (arm ? o.id.endsWith(`:charged:${arm}`) : !o.tags.includes('spend-charge'))), {
    arrange: ({ U, at }) => { at(U.Gunner, 4, 3, 2); at(U.Dune, 3, 7, 0); at(U.Sand, 5, 7, 0); },
    before: (w) => { w.U.Gunner.charge = ['rightHand']; },
  });
  const multi = await charged('multi_target_3')();
  const sup = await charged('suppression')();
  const kept = await charged(null)();
  check('the R7MG spends its Charge on the Multi-target arm and is offered its splits; on Suppression, or with the Charge kept, its attack takes one target and no split is asked',
    [splitIds(multi.d).length > 0, Math.max(...splitIds(multi.d).map((o) => o.facts.split.length)), sup.d, kept.d, [multi.refused, sup.refused, kept.refused]],
    [true, 2, null, null, [[], [], []]]);
}

// ---------- whole games ----------
// Two Crises whose one gun each is its Multi-Target Torso, and the Stratus.
// A split needs two enemies in reach at once, which in play is not often, so
// beside the four policies a seat that takes the widest split it is offered
// plays the same games: the split is then made in a whole game, to its end.
data.solo.squads['m-crises'] = { name: 'Crises', faction: 'PD', points: 0, mechs: [
  { name: 'Crisis', loadout: { torso: '547', chasis: '548', leftHand: '552', rightHand: '553', backpack: 'PDBP-201', pilot: 'XPA-59' } },
  { name: 'Chance', loadout: { torso: '546', chasis: '549', leftHand: '552', rightHand: '553', backpack: 'PDBP-201', pilot: 'XPA-60' } }], drones: [] };
const splitter = {
  name: 'splitter',
  choose(d, view, rng) {
    const all = splitIds(d);
    if (d.kind === 'attack.split' && all.length) return { option: all[all.length - 1].id, why: 'the widest split' };
    return tact.choose(d, view, rng);
  },
};
M.L.setLocalSeat(null);
{
  const tally = { games: 0, over: 0, refused: 0, broken: [], fired: 0, asked: 0, offered: 0, splits: 0 };
  const pairs = [{ s1: 'm-crises', s2: 'm-rifles' }, { s1: 'm-stratus', s2: 'm-rifles' }];
  for (const [policy, seeds] of [['legal', [1, 2]], ['eager', [1]], ['brawler', [1]], ['tactician', [1, 2]], ['splitter', [1, 2, 3]]]) {
    for (const seed of seeds) {
      for (const seats of pairs) {
        const t = botTable(M, data, { ...scenario, id: 't-multi-games', seats }, { seed, policies: policy === 'splitter' ? { s1: splitter, s2: tact } : AI[`${policy}Policy`], glue: M.HUD.glueAfter });
        const was = { s1: null, s2: null };
        t.watch((cmd) => {
          if (cmd.kind === 'performAction' && ['546_A', '547_A', '038_A'].includes(cmd.actionId)) tally.fired += 1;
          if (cmd.kind !== 'setCombatView') return;
          const v = cmd.view;
          if (v?.multi && v.step !== 'split' && was[cmd.seat] === 'split' && v.multi.targets.length > 1) tally.splits += 1;
          was[cmd.seat] = v?.step ?? null;
        });
        let end;
        try {
          end = await t.run({ maxSteps: 16000, onStep: (seat, r) => { if (r.decision?.kind === 'attack.split') { tally.asked += 1; if (r.decision.options.length > 1) tally.offered += 1; } } });
        } catch (err) { end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] }; } finally { t.close(); }
        tally.games += 1;
        if (end.kind === 'over') tally.over += 1; else tally.broken.push(`${policy} ${seed} ${seats.s1}: ${end.kind} ${end.why ?? ''} ${end.decision ?? ''}`);
        tally.refused += t.refused.length;
      }
    }
  }
  check('EIGHTEEN GAMES with Multi-Target guns in them, on the page\'s glue, five policies: every one ends as a game should, nothing refused; the guns are fired, the split is asked, and pools are split in them',
    [tally.over, tally.games, tally.refused, tally.broken, tally.fired > 0, tally.asked > 0, tally.splits > 0], [18, 18, 0, [], true, true, true]);
  console.log(`       Multi-Target attacks ${tally.fired}, splits asked ${tally.asked} (${tally.offered} with a split to make), made ${tally.splits}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
M.L.setLocalSeat(null);
if (fail) process.exit(1);

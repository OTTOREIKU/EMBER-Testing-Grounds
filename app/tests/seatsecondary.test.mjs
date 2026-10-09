// SECONDARY TASKS FOR THE COMPUTER (2026-10-09; OTTO: "we need to start getting secondary tasks in there as much as
// possible"). Until now a computer seat took the first card offered and named the first Mech offered, and nothing it
// weighed knew a card was in play. Now:
//   - the seat's view shows both squads' cards (each player reveals theirs, FAQ P1): what each names, what each paid;
//   - `secName` names a card's Mech or zone for the card (tactician.ts secondaryName);
//   - `secondary` counts what the cards pay where it is decided: a unit's worth (evaluate.ts secondaryStake), an
//     attack by a Weapons Test's Mech (testWorth), what the cards would pay as the game ends (marginOf);
//   - the learned judge's numbers read each side's card (features.ts, the third group).
// On the real engine for the view, written-out views for the rest (the tactician test's way).
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Secondary Tasks for the computer\n');

const { M, data } = await loadEngine('seatsecondary', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';", "export * as SOLO from '../src/solo';"]);
const AI = M.AI;
const W = AI.TACTICIAN;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const rng = new AI.Rng('seatsecondary');
const toughness = (u) => u.parts.filter((p) => p.state !== 'destroyed').reduce((n, p) => n + p.armor + p.structure, 0);

{
  // THE VIEW, ON A REAL TABLE: the Raid game with Secondary Tasks on. RDL (s1) takes Escort, UN (s2) Behead; each
  // seat names with `secName`.
  const named = AI.makeTactician({ secName: true });
  const taking = (card) => ({
    name: 'taking',
    choose(d, view, r) {
      if (d.kind === 'setup.secondary') return { option: `secondary:${card}`, reason: 'test', why: 'test' };
      return named.choose(d, view, r);
    },
  });
  const scenario = { ...data.solo.scenarios[0], secondaries: true };
  const t = botTable(M, data, scenario, { seed: 7, policies: { s1: taking('escort'), s2: taking('decapitation') }, glue: M.HUD.glueAfter });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 1 });
  const v1 = M.SEAT.viewOf(data, t.state, 's1');
  const v2 = M.SEAT.viewOf(data, t.state, 's2');
  const rdlMechs = v1.units.filter((u) => u.side === 's1' && u.kind === 'mech');
  const toughest = rdlMechs.reduce((a, b) => (toughness(b) > toughness(a) ? b : a));
  const sec = v1.secondary;
  check('BOTH CARDS ARE IN BOTH SEATS\' VIEWS (each player reveals theirs): Escort for RDL, Behead for UN, what each pays and how',
    [sec.s1?.id, sec.s1?.kind, sec.s1?.vp, sec.s2?.id, sec.s2?.kind, sec.s2?.vp, JSON.stringify(v2.secondary) === JSON.stringify(sec)],
    ['escort', 'survive-designated', 3, 'decapitation', 'destroy-designated', 5, true]);
  check('RDL names its own Escort and its own Head (UN\'s Behead is named by the squad it hunts): its Mech hardest to destroy, for both',
    [sec.s1?.target, sec.s2?.target, rdlMechs.length > 1], [toughest.uid, toughest.uid, true]);
  check('nothing paid yet, nothing destroyed', [sec.s1?.paid, sec.s2?.paid, sec.s1?.kills.mechs, sec.s2?.testKills], [0, 0, 0, 0]);
  const off = M.SEAT.viewOf(data, { ...t.state, tasks: { ...t.state.tasks, secondary: {} } }, 's1');
  check('a game without them shows none', [off.secondary.s1, off.secondary.s2], [null, null]);
  t.close();
}

// ---------- written-out views ----------
const part = (slot, armor = 4, structure = 1, state = 'intact') => ({ slot, cardId: slot, state, armor, structure, points: 20, repaired: false });
const weapon = (type, yellow, red, more = {}) => ({ slot: 'rightHand', actionId: `${type}-${yellow}-${red}`, name: type, type, range: type === 'Melee' ? 0 : 6, yellow, red, usable: true, ...more });
const unit = (uid, side, kind, col, row, more = {}) => ({
  uid, side, kind, cardId: 'x', label: `${kind} ${uid}`, grid: { col, row }, cell: { col: col * 3, row: row * 3 }, size: kind === 'mech' ? 3 : 1, facing: 0,
  deployed: true, alive: true, stance: 'offensive', dialHidden: false, statuses: [], aerial: false, ground: true, locks: kind === 'mech', camouflaged: false,
  revealing: false, parts: kind === 'mech' ? ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'].map((s) => part(s)) : [part('main')], health: 1,
  points: kind === 'mech' ? 110 : 60, weapons: [], maneuver: kind === 'mech' ? 1 : 0, move: kind === 'mech' ? 1 : 5, commander: false, charged: [],
  lowValue: false, done: false, hands: 0, lends: false, ...more,
});
const card = (id, kind, vp, more = {}) => ({ id, name: id, kind, vp, target: null, zone: null, paid: 0, kills: { mechs: 0, drones: 0, integrity: 0 }, testKills: 0, ...more });
const viewOf = (units, more = {}) => ({
  seat: 's1', other: 's2', round: 1, roundLimit: 5, phase: 2, phaseName: 'Action', firstPlayer: 's1', setup: 'done', mission: null, task: null, noSecondary: false,
  secondary: { s1: null, s2: null }, units, zones: [], boxes: [], vp: { s1: 0, s2: 0 }, commandTokens: { s1: 0, s2: 0 }, opportunity: null, ...more,
});
const ask = (kind, options, facts) => ({ id: kind, kind, seat: 's1', options, fallback: options[0].id, facts });
const mechOption = (u) => ({ id: `mech:${u.uid}`, label: u.label, tags: ['designate', 'target'], commands: [{}] });

// Our two Mechs: a hard one with a short gun and a soft one with a big blade; theirs: a hard one and a soft one.
const hard = unit(1, 's1', 'mech', 1, 1, { parts: ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'].map((s) => part(s, 8, 3)), weapons: [weapon('Firing', 2, 0)] });
const soft = unit(2, 's1', 'mech', 2, 1, { weapons: [weapon('Melee', 4, 3)] });
const theirHard = unit(3, 's2', 'mech', 9, 9, { parts: ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'].map((s) => part(s, 8, 3)) });
const theirSoft = unit(4, 's2', 'mech', 10, 9, { parts: ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'].map((s) => part(s, 2, 1)) });
const drone = unit(5, 's2', 'drone', 8, 8);
const dragonfly = unit(6, 's2', 'drone', 8, 7, { lowValue: true, points: 0 });
const units = [hard, soft, theirHard, theirSoft, drone, dragonfly];

{
  // WHAT A CARD NAMES (`secName`).
  const on = AI.makeTactician({ secName: true });
  const plain = AI.makeTactician({ secName: false });
  const ours = [mechOption(soft), mechOption(hard)];
  const theirs = [mechOption(theirHard), mechOption(theirSoft)];
  const name = (policy, holder, cardOf, options) => {
    const v = viewOf(units, { secondary: { s1: holder === 's1' ? cardOf : null, s2: holder === 's2' ? cardOf : null } });
    return policy.choose(ask('setup.designate.target', options, { what: 'target', for: holder, owner: options[0].id === `mech:${soft.uid}` ? 's1' : 's2' }), v, rng);
  };
  check('BEHEAD is the other squad\'s card: the Head it will hunt is ours to name, our Mech hardest to destroy',
    [name(on, 's2', card('decapitation', 'destroy-designated', 5), ours).option, name(on, 's2', card('decapitation', 'destroy-designated', 5), ours).reason], [`mech:${hard.uid}`, 'secondary_head']);
  check('a BOUNTY is the enemy Mech easiest to destroy', name(on, 's1', card('bounty-hunt', 'destroy-designated', 4), theirs).option, `mech:${theirSoft.uid}`);
  check('an ESCORT is our own Mech hardest to destroy', name(on, 's1', card('escort', 'survive-designated', 3), ours).option, `mech:${hard.uid}`);
  check('a TEST UNIT is our own Mech with the most Firing and Melee dice', name(on, 's1', card('weapons-test', 'per-kill-by-unit', 1), [mechOption(hard), mechOption(soft)]).option, `mech:${soft.uid}`);
  check('a PLANNED OBSOLESCENCE (paying when it falls) is our own Mech likeliest to fall', name(on, 's1', card('disposal-procedure', 'destroy-designated', 2), [mechOption(hard), mechOption(soft)]).option, `mech:${soft.uid}`);
  check('without the skill, the first Mech offered, as before', name(plain, 's1', card('escort', 'survive-designated', 3), ours).option, `mech:${soft.uid}`);
  // The Excavation Site: three zones, ours along row 0, theirs along row 11.
  const zone = (id, cells, scoring) => ({ id, name: id, cells, holder: null, control: null, scoring });
  const zones = [zone('far', ['5,10', '6,10'], false), zone('home', ['5,2', '6,2'], false), zone('main', ['5,1', '6,1'], true)];
  const v = viewOf(units, { zones, secondary: { s1: card('potential-excavation-area', 'hold-zone', 2), s2: null } });
  const zq = ask('setup.designate.zone', zones.map((z) => ({ id: `zone:${z.id}`, label: z.id, tags: ['designate', 'zone'], commands: [{}] })),
    { what: 'zone', for: 's1', owner: null, zone: ['0,0', '5,0', '11,0'], foeZone: ['0,11', '5,11', '11,11'] });
  check('an EXCAVATION SITE is the zone nearest our deployment and farthest from theirs; one the Main Task scores counts two Grids further off',
    [on.choose(zq, v, rng).option, on.choose(zq, v, rng).reason], ['zone:home', 'secondary_zone']);
}
{
  // WHAT A UNIT IS WORTH, BY THE CARDS (`secondary`).
  const S = { ...W, secondary: 1 };
  const worth = (u, s1, s2, w = S) => AI.unitWorth(u, viewOf(units, { secondary: { s1, s2 } }), w);
  const base = (u) => AI.unitWorth(u, viewOf(units), W);
  const Z = { ...W, secondary: 0 };
  check('it ships at 1 (measured: 105 of 183 against 90); at 0 nothing changes', [W.secondary, near(worth(theirSoft, card('bounty-hunt', 'destroy-designated', 4, { target: theirSoft.uid }), null, Z), base(theirSoft))], [1, true]);
  check('a BOUNTY named on an enemy Mech: worth the card more to whoever destroys it', near(worth(theirSoft, card('bounty-hunt', 'destroy-designated', 4, { target: theirSoft.uid }), null) - base(theirSoft), 4), true);
  check('THE OTHER SQUAD\'S BEHEAD named on our Mech: worth the card more to keep', near(worth(hard, null, card('decapitation', 'destroy-designated', 5, { target: hard.uid })) - base(hard), 5), true);
  check('and once paid, nothing more', near(worth(hard, null, card('decapitation', 'destroy-designated', 5, { target: hard.uid, paid: 5 })) - base(hard), 0), true);
  check('our ESCORT: worth the card more to keep', near(worth(hard, card('escort', 'survive-designated', 3, { target: hard.uid }), null) - base(hard), 3), true);
  check('our PLANNED OBSOLESCENCE: its fall pays us the card, so it is worth that much less', near(worth(soft, card('disposal-procedure', 'destroy-designated', 2, { target: soft.uid }), null) - base(soft), -2), true);
  const annihilation = card('annihilation', 'per-kill', 2);
  check('ANNIHILATION: each enemy Mech the card more, each enemy Drone 1, a Low Value Drone nothing; our own units nothing',
    [worth(theirHard, annihilation, null) - base(theirHard), worth(drone, annihilation, null) - base(drone), worth(dragonfly, annihilation, null) - base(dragonfly), worth(hard, annihilation, null) - base(hard)].map((x) => Math.round(x * 1e9) / 1e9), [2, 1, 0, 0]);
  check('MERCY while it can still be had: an enemy Mech destroyed costs us the card; once a Mech is down, nothing; Integrity Loss does not count',
    [worth(theirHard, card('mercy', 'no-mech-lost', 2), null) - base(theirHard), worth(theirHard, card('mercy', 'no-mech-lost', 2, { kills: { mechs: 1, drones: 0, integrity: 0 } }), null) - base(theirHard),
      worth(theirHard, card('mercy', 'no-mech-lost', 2, { kills: { mechs: 1, drones: 0, integrity: 1 } }), null) - base(theirHard)].map((x) => Math.round(x * 1e9) / 1e9), [-2, 0, -2]);
  // A WEAPONS TEST: an attack by its Mech.
  const test = card('weapons-test', 'per-kill-by-unit', 1, { target: soft.uid });
  const v = viewOf(units, { secondary: { s1: test, s2: null } });
  const f = { hit: 1, pen: 0.6, damage: 0.2, destroy: 0.5, kill: 0.1, link: 0, parts: [], pick: null };
  check('A WEAPONS TEST: an attack by its Mech is worth the card for each Part it may destroy (a Drone: each it may destroy); by another Mech, nothing',
    [AI.testWorth(soft, theirHard, f, v, S), AI.testWorth(soft, drone, f, v, S), AI.testWorth(hard, theirHard, f, v, S), AI.testWorth(soft, theirHard, f, v, Z)], [0.5, 0.1, 0, 0]);
  // WHAT THE CARDS WOULD PAY AS THE GAME ENDS, in the margin.
  const margin = (s1, s2, more = {}) => AI.marginOf(viewOf(units, { secondary: { s1, s2 }, ...more }), S) - AI.marginOf(viewOf(units, more), S);
  const end4 = W.missionFuture ** 4;
  check('THE MARGIN: our Escort standing, round 1 of 5, the card less four rounds\' doubt; in the last round all of it; their Mercy kept, against us',
    [near(margin(card('escort', 'survive-designated', 3, { target: hard.uid }), null), 3 * end4), near(margin(card('escort', 'survive-designated', 3, { target: hard.uid }), null, { round: 5 }), 3),
      near(margin(null, card('mercy', 'no-mech-lost', 2)), -2 * end4)], [true, true, true]);
  const held = [{ id: 'dig', name: 'dig', cells: ['1,1'], holder: 's1', control: null, scoring: false }];
  check('an Excavation Site we hold alone pays; one nobody holds does not',
    [near(margin(card('potential-excavation-area', 'hold-zone', 2, { zone: 'dig' }), null, { zones: held, round: 5 }), 2),
      near(margin(card('potential-excavation-area', 'hold-zone', 2, { zone: 'dig' }), null, { zones: [{ ...held[0], holder: null }], round: 5 }), 0)], [true, true]);
}
{
  // THE LEARNED JUDGE'S NUMBERS: each side's card (features.ts, the third group), on a Look of the test's own.
  const look = (secondary, more = {}) => {
    const v = viewOf(units, { secondary, ...more });
    return { view: () => v, seen: (u, grids) => grids.map(() => []), walk: (u, from) => from.map(() => null) };
  };
  const read = (secondary, more) => AI.featureMap(look(secondary, more));
  const none = read({ s1: null, s2: null });
  check('NO CARD: nothing on, nothing named (-1)', [none.my_secOn, none.my_secVp, none.my_secHealth, none.their_secHealth, none.my_secLive], [0, 0, -1, -1, 0]);
  const escort = read({ s1: card('escort', 'survive-designated', 3, { target: hard.uid }), s2: card('annihilation', 'per-kill', 2, { paid: 3 }) });
  check('ESCORT for us: on, its kind, its Victory Points; what it would pay now and could still pay, the card; its Mech whole',
    [escort.my_secOn, escort.my_secEscort, escort.my_secVp, escort.my_secNow, escort.my_secLive, escort.my_secHealth, escort.my_secDestroy], [1, 1, 3, 3, 3, 1, 0]);
  check('ANNIHILATION for them: paid 3 so far; what it could still pay, our Mechs at 2 and nothing else of ours', [escort.their_secKills, escort.their_secPaid, escort.their_secLive, escort.d_secPaid], [1, 3, 4, -3]);
  const lost = read({ s1: card('escort', 'survive-designated', 3, { target: hard.uid }), s2: null }, { units: units.map((u) => (u.uid === hard.uid ? { ...u, alive: false, health: 0 } : u)) });
  check('its Mech destroyed: nothing now, nothing to come, its health 0', [lost.my_secNow, lost.my_secLive, lost.my_secHealth], [0, 0, 0]);
  const bounty = read({ s1: card('bounty-hunt', 'destroy-designated', 4, { target: theirSoft.uid }), s2: card('mercy', 'no-mech-lost', 2, { kills: { mechs: 1, drones: 0, integrity: 0 } }) });
  check('A BOUNTY still standing: 4 to come, its health; THEIR MERCY lost to a Mech destroyed: nothing now or to come',
    [bounty.my_secDestroy, bounty.my_secLive, bounty.my_secHealth, bounty.their_secMercy, bounty.their_secNow, bounty.their_secLive], [1, 4, 1, 1, 0, 0]);
  const reach = read({ s1: null, s2: card('bounty-hunt', 'destroy-designated', 4, { target: soft.uid }) }, {
    units: units.map((u) => (u.uid === theirSoft.uid ? { ...u, grid: { col: 3, row: 1 }, weapons: [weapon('Firing', 3, 0, { range: 4 })] } : u)),
  });
  check('THEIR BOUNTY on our Mech: the dice they could bring on it next round', [reach.their_secReach, reach.their_secSeen], [3, 0]);
}

{
  // THE BRAWLER'S CARD (`hunter`; OTTO, 2026-10-09: it "would probably be more inclined to take secondary tasks that
  // are related to killing enemy mechs rather than objectives since it's built to be more aggressive").
  const cards = ['decapitation', 'bounty-hunt', 'annihilation', 'escort', 'weapons-test', 'disposal-procedure', 'mercy', 'potential-excavation-area'];
  const q = { id: 's', kind: 'setup.secondary', seat: 's1', options: cards.map((c) => ({ id: `secondary:${c}`, label: `Secondary Task: ${c}`, tags: ['secondary'], commands: [{}] })), fallback: 'secondary:decapitation', facts: {} };
  const hunter = AI.brawlerPolicy;
  const two = viewOf(units);
  const one = viewOf(units.filter((u) => u.uid !== theirHard.uid));
  check('THE BRAWLER takes a card that pays for the enemy destroyed: Annihilation, which pays for every one',
    [hunter.choose(q, two, rng).option, hunter.choose(q, two, rng).reason], ['secondary:annihilation', 'secondary_hunter']);
  check('against a squad of one Mech, Behead: its Head can only be that Mech', hunter.choose(q, one, rng).option, 'secondary:decapitation');
  check('the Ace, no hunter, takes the safe answer: its own choice of card is to be read off the games', AI.tacticianPolicy.choose(q, two, rng).option, 'secondary:decapitation');
  const bounty = viewOf(units, { secondary: { s1: card('bounty-hunt', 'destroy-designated', 4), s2: null } });
  const named = hunter.choose(ask('setup.designate.target', [mechOption(theirHard), mechOption(theirSoft)], { what: 'target', for: 's1', owner: 's2' }), bounty, rng);
  check('and names for its card as the Ace does: its Bounty the enemy Mech easiest to destroy', [named.option, named.reason], [`mech:${theirSoft.uid}`, 'secondary_bounty']);
  const dialog = M.SOLO.OPPONENTS.brawler.policy;
  check('THE BRAWLER OF THE SETUP DIALOG is a hunter', dialog.choose(q, two, rng).option, 'secondary:annihilation');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

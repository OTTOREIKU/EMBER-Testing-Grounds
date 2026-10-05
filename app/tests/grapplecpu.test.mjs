// What a computer seat's hit does to the unit it struck (OTTO, 2026-10-05:
// "I just saw the AI use it on another AI and neither disarm or pull were
// performed, the enemy unit that was attacked with grapple hook is still in the
// same spot and has both weapons").
//
// The Grappling Hook (050_A) prints "[On Hit] Causes Drag or Disarm": one of
// the two happens, and the attacker picks which. The window offered both on
// its last screen, and a computer seat never pressed either: the Brawler took
// a bonus attack there and nothing else, the Tactician answers that question
// as the Brawler does, and the Drag (a Grid, then a facing) was not offered to
// a seat at all. Staged here on the real engine, in the real combat window,
// with the dice fixed: a hit on a Part with a Discard Card is a Disarm, a hit
// on the Torso a Drag, pulled straight in with its back to the attacker; the
// window is not closed while what a hit CAUSES is still to be taken; and the
// effects a hit MAY have (the Lash's Immobilized Token) are taken too.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('What a computer seat\'s hit does to the unit it struck\n');

const { M, data } = await loadEngine('grapplecpu', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as TURN from '../src/turn';"]);
const AI = M.AI;

// The Grappler: the Big Hand Grappler on the left arm (050_A Grappling Hook,
// Melee, Range 3). The Whipper: the Multifunctional Whip (139_A Lash: MAY Drag
// the target or give it an Immobilized Token). The prey: a Mech with a Rifle
// on its right arm (541, whose Discard Card is 542) and nothing on its left (a
// Buckler there would take the hit off the Rifle).
data.solo.squads['t-hookers'] = {
  name: 'Hookers', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Grappler', loadout: { torso: '539', chasis: '099', leftHand: '050', rightHand: '541', pilot: 'LPA-23-2' } },
    { name: 'Whipper', loadout: { torso: '539', chasis: '099', leftHand: '139', rightHand: '541', pilot: 'LPA-23-2' } },
  ],
  drones: [],
};
data.solo.squads['t-hooked'] = {
  name: 'Hooked', faction: 'GOF', points: 0,
  mechs: [{ name: 'Rifleman', loadout: { torso: '174', chasis: '179', rightHand: '541', pilot: 'ZPA-43' } }],
  drones: [],
};
const scenario = { ...data.solo.scenarios[0], id: 't-grapplecpu', map: 'none', seats: { s1: 't-hookers', s2: 't-hooked' } };

// Every Attack die a hit, every Defence die blank, the Part Die as named
// (0 the Torso, 3 the right arm). Light: one light hit a Yellow die, the Red
// die an Eye and each White die a Defense, which leaves a Part it hits
// standing.
const hitOn = (black) => ({ red: 0, yellow: 0, white: 7, blue: 7, black });
const lightOn = (black) => ({ red: 7, yellow: 2, white: 0, blue: 7, black });
const dice = (faces) => (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: faces[color] ?? 0 })));
// The attack is the test's; everything after the hit is the policy's.
const script = (want, policy) => ({
  name: 'scripted',
  choose(d, view, rng) {
    const id = want(d, view);
    if (id && d.options.some((o) => o.id === id)) return { option: id, why: 'scripted' };
    return (d.kind === 'attack.finish' ? policy : AI.eagerPolicy).choose(d, view, rng);
  },
});
async function staged(wants, policy, faces) {
  const seeded = new AI.Rng('7:staged');
  let fixed = null;
  const t = botTable(M, data, scenario, {
    seed: 7,
    dice: (pool) => (fixed ? dice(fixed)(pool) : Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: seeded.int(data.dice.dice[color].sides) })))),
    policies: { s1: script((d, v) => wants.s1?.(d, v), policy), s2: script((d, v) => wants.s2?.(d, v), policy) },
  });
  await t.run({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' && s.round.phase === 2 });
  fixed = faces;
  const U = Object.fromEntries(t.state.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  for (const x of t.state.tokens) if (x.kind === 'mech') x.stance = 'offensive';
  const turnOf = (mech, timing) => {
    mech.timing = timing;
    t.state.script.acted = t.state.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    t.state.script.opp = null;
    return M.G.opportunity(data, t.state);
  };
  return { t, U, at, turnOf };
}

// One attack by `who` with `action` on the Rifleman, played until its window
// has come down: what the attacker's last screen offered, each time it was
// asked, and what was sent.
async function hook(who, action, policy, faces) {
  let target = 0;
  const s = await staged({
    s1: (d) => (d.kind === 'opp.act' ? `attack:${action}:${target}` : d.kind === 'attack.part' ? 'part.roll' : null),
    s2: (d) => (d.kind === 'opp.act' ? 'end' : null),
  }, policy, faces);
  const other = who === 'Grappler' ? 'Whipper' : 'Grappler';
  s.at(s.U[who], 5, 4, 2); s.at(s.U[other], 0, 0, 2); s.at(s.U.Rifleman, 5, 6, 0);
  target = s.U.Rifleman.uid;
  const asked = [];
  // The commands themselves (the table's `sent` keeps their kinds).
  const sent = [];
  s.t.watch((cmd) => sent.push(cmd));
  const before = s.t.sent.length;
  s.turnOf(s.U[who], 'melee');
  const r = await s.t.run({
    until: (st) => s.t.sent.slice(before).some((x) => x.kind === 'applyPenetration') && !st.script.combatView,
    onStep: (seat, step) => { if (seat === 's1' && step.decision.kind === 'attack.finish') asked.push({ ids: step.decision.options.map((o) => o.id), took: step.option?.id ?? null }); },
    maxSteps: 400,
  });
  const prey = s.t.state.tokens.find((x) => x.uid === target);
  const out = {
    end: r.kind,
    refused: s.t.refused.map((x) => `${x.kind}: ${x.why}`),
    asked,
    sent: sent.map((x) => x.kind),
    moved: sent.filter((x) => x.kind === 'forceMove' && x.targetUid === target).map((x) => [Math.floor(x.to.col / 3), Math.floor(x.to.row / 3), x.facing]),
    disarmed: sent.filter((x) => x.kind === 'disarm').map((x) => x.slot),
    grid: prey ? [Math.floor(prey.col / 3), Math.floor(prey.row / 3), prey.facing] : null,
    right: prey?.mech?.rightHand ?? null,
    statuses: prey?.statuses ?? [],
  };
  s.t.close();
  return out;
}

const brawler = AI.brawlerPolicy;
const ace = AI.tacticianPolicy;

// ---------- a hit on the Torso: no Discard Card, so the Drag ----------
{
  const r = await hook('Grappler', '050_A', brawler, hitOn(0));
  check('the Brawler\'s Grappling Hook on the Torso pulls the Rifleman straight in: to the Grid beside the Grappler on its side, its back turned to it, and nothing is refused',
    [r.end, r.refused, r.moved, r.grid, r.disarmed], ['paused', [], [[5, 5, 2]], [5, 5, 2], []]);
  check('and its last screen did not offer Done while the Drag was still to be made',
    [r.asked.length >= 1, r.asked[0]?.ids.includes('finish.done'), r.asked[0]?.ids.some((id) => id.startsWith('finish.drag:')), r.asked.at(-1)?.ids], [true, false, true, ['finish.done']]);
}
{
  const r = await hook('Grappler', '050_A', ace, hitOn(0));
  check('so does the Ace\'s (it answers that question as the Brawler does)', [r.end, r.refused, r.moved, r.grid], ['paused', [], [[5, 5, 2]], [5, 5, 2]]);
}

// ---------- a hit on the Rifle: it has a Discard Card, so the Disarm ----------
{
  const r = await hook('Grappler', '050_A', brawler, lightOn(3));
  check('a Grappling Hook on the right arm Disarms it: the Rifle turns to its Discard Card, the Rifleman is not moved, and nothing is refused',
    [r.end, r.refused, r.disarmed, r.right, r.moved, r.asked[0]?.took], ['paused', [], ['rightHand'], '542', [], 'finish.disarm']);
}
{
  // The same hit with every die landing destroys the Rifle outright: there is
  // no card left to flip, so no Disarm is offered (it was, and the table
  // refused it), and the Drag is what the hit causes.
  const r = await hook('Grappler', '050_A', brawler, hitOn(3));
  check('a hit that destroys the Rifle offers no Disarm: the Rifleman is Dragged instead, and nothing is refused',
    [r.end, r.refused, r.asked[0]?.ids.includes('finish.disarm'), r.disarmed, r.moved], ['paused', [], false, [], [[5, 5, 2]]]);
}

// ---------- what a hit MAY do is taken too ----------
{
  const r = await hook('Whipper', '139_A', brawler, hitOn(0));
  check('a Lash gives the Rifleman its Immobilized Token rather than leave it be (a may, and the Brawler takes it)',
    [r.end, r.refused, r.statuses.includes('immobilized'), r.moved], ['paused', [], true, []]);
  check('and Done was offered beside it, a may being one the attacker may let go by',
    r.asked[0]?.ids.includes('finish.done'), true);
}

// ---------- the source says so ----------
{
  const { readFileSync } = await import('node:fs');
  const combat = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const bot = readFileSync(new URL('../src/ai/botcombat.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check('the window marks what a hit CAUSES (not the Whip\'s may), and each Drag Grid says where it lands and who',
    [/const must = \(disarmOn\(c\.action\) \|\| dragPrinted\(c\.action\)\) && !immobilizeChoiceOn\(c\.action\) && !faceAwayOnHit\(c\.action\);/.test(combat),
      /b\.dataset\.at = `\$\{s\.spot\.col\},\$\{s\.spot\.row\}`;/.test(combat), /b\.dataset\.uid = String\(defUid\);/.test(combat)], [true, true, true]);
  check('a Drag, an Immobilized Token and a turn the table refuses are not claimed as made',
    [(combat.match(/if \(!accepted\(this\.onCommand\(\{ kind: 'forceMove'/g) ?? []).length, /if \(!accepted\(this\.onCommand\(\{ kind: 'applyStatus', seat, uid: atkUid, targetUid: defUid, statusId: 'immobilized'/.test(combat)], [2, true]);
  check('a seat is offered each Drag as a Grid and a facing together, and an effect refused is not offered again',
    [/const o = add\(id, `\$\{b\.label\}, facing \$\{FACINGS\[f\]\}`, tags, \[\['finish\.drag', b\.arg\], \['finish\.face', String\(f\)\]\]\);/.test(bot), /this\.tried\.add\(id\)/.test(bot)], [true, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

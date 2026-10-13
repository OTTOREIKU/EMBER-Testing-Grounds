// AI lab (tools/ai-lab/README.md): random legal squads on any battlefield and Main Task, played by two computer
// seats, to find what the seam does not carry yet (AI-OPPONENT-PLAN.md, M8).
//   node tests/_squadprobe.mjs <first seed> <last seed> [policy=legal] [points=400] [secondaries 0|1]
// One line a game, then a tally as one line of JSON. VERBOSE=1 prints each squad.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { botTable, loadEngine } from './_engine.mjs';
import { policyOf } from './_policies.mjs';
// The scratch bundle is named by the arguments; a long policy spec (the tuner's, M14) is hashed, with the
// opponent's spec, so the name stays short enough for the file system and two runs never share one.
const plainName = process.argv.slice(2).join('-').replace(/[^a-z0-9-]/gi, '_');
const bundleName = plainName.length <= 60 && !process.env.FOE?.includes('=') ? plainName
  : createHash('sha256').update(`${process.argv.slice(2).join('|')}|${process.env.FOE ?? ''}|${process.pid}`).digest('hex').slice(0, 16);
// (The process's own number too: two runs of the same seeds with another switch, SWAP or PROBE_FAMILY, took
// each other's bundle away.)
const { M, data } = await loadEngine(`squadprobe-${bundleName}-${process.pid}`,
  ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as D from '../src/data';", "export * as HUD from '../src/matchhud';", "export * as TURN from '../src/turn';"]);
// The table is run on the page's glue (the queue of Smoke Screens a round's end owes), as a game
// against the computer is; PLAIN=1 runs it on glue.ts alone, as it was before M8.2c.
const glue = process.env.PLAIN ? undefined : M.HUD.glueAfter;

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 10);
const policyName = process.argv[4] ?? 'legal';
const budget = Number(process.argv[5] ?? 400);
const secondaries = process.argv[6] === '1';
// Any name `_policies.mjs` knows: skills and weights after colons, HIDE / HIDETAG in the environment.
// LEARNED_MODEL=<compact model file> (M17 L3, scratchpad compact_v.py): the learned judge every Tactician with a
// `learned` weight reads, in place of the one the site ships (which _engine.mjs sets otherwise); LEARNED_MODEL=none
// plays with no judge. Refused (and the run stopped) where its numbers are not features.ts's.
if (process.env.LEARNED_MODEL && process.env.LEARNED_MODEL !== 'none' && !M.AI.useModel(JSON.parse(readFileSync(process.env.LEARNED_MODEL, 'utf8')))) throw new Error('the model reads other numbers');
const named = policyOf(M.AI, policyName);
if (!named) throw new Error(`no policy called ${policyName}`);
// PLANS=1: where a Tactics Card is chosen inside an activation, the plans it was weighed against.
// BOXPLANS=1: the same, where the unit to act carries a Black Box.
const policy = (process.env.PLANS || process.env.BOXPLANS) ? {
  name: named.name,
  ...(named.trueRange ? { trueRange: true } : {}),
  choose(d, view, rng) {
    const c = named.choose(d, view, rng);
    const o = d.options.find((x) => x.id === c.option);
    const bearer = process.env.BOXPLANS && /^(opp|activation)\.act$/.test(d.kind) && view.boxes?.some((b) => b.bearer === d.unit);
    // The dial of a unit carrying a Box: each Timing's best plans.
    if (process.env.BOXPLANS && d.kind === 'planning.dial' && view.boxes?.some((b) => b.bearer === d.unit)) {
      if (process.env.BOXDUMP && globalThis.__t) { writeFileSync(`${process.env.BOXDUMP}-r${view.round}-u${d.unit}.json`, JSON.stringify(globalThis.__t.state)); }
      console.log(`       BOX-DIAL ${view.seat} r${view.round} chose ${o?.label ?? c.option} (${c.why ?? ''})`.slice(0, 300));
      for (const x of d.options) {
        const turn = x.then?.();
        if (!turn) continue;
        const top = M.AI.weighed(turn, view).slice(0, 3);
        console.log(`         ${x.label}: ${top.map((p) => `${p.worth.toFixed(2)} ${p.how} ${p.label.slice(0, 60)} [now ${p.now.toFixed(2)} next ${p.next.toFixed(2)} mis ${p.mission.toFixed(2)} shape ${p.shape.toFixed(2)} cost ${p.cost.toFixed(2)}]`).join(' || ')}`.slice(0, 900));
      }
    }
    if (bearer) console.log(`       BOX-BEARER ${view.seat} r${view.round} ${d.kind} chose: ${o?.label ?? c.option}`.slice(0, 220));
    if (bearer && process.env.BOXOPTS && globalThis.__t?.state.script?.opp) { const T = globalThis.__t; const tok = T.state.tokens.find((x) => x.uid === d.unit); console.log(`         rows: ${M.TURN.actionRows(data, T.state, tok, T.state.script.opp).map((r) => `${r.a.id}:${r.v.ok ? 'ok' : r.v.why}`).join(' | ')}`.slice(0, 1500)); }
    if (bearer && process.env.BOXOPTS) { const u = view.units.find((x) => x.uid === d.unit); console.log(`         unit: ${JSON.stringify({ stance: u?.stance, link: u?.link, linkMax: u?.linkMax, timing: u?.timing, statuses: u?.statuses, parts: u?.parts?.map((p) => `${p.slot}:${p.state ?? ''}`), weapons: u?.weapons?.map((w) => `${w.name}/${w.type}/${w.range}/${w.usable ? 'usable' : 'not'}`) })}`.slice(0, 1500)); }
    if (bearer && process.env.BOXOPTS) console.log(`         options: ${d.options.map((x) => x.label.replace(/^[^:]*: /, '')).filter((l, i, a) => a.indexOf(l) === i).slice(0, 60).join(' / ')}`.slice(0, 3000));
    if (bearer || (process.env.PLANS && o?.tags.includes('tactic') && /^(opp|activation)\.act$/.test(d.kind))) {
      for (const p of M.AI.weighed(d, view).slice(0, 6)) console.log(`         ${p.priced ? '*' : ' '} ${p.worth.toFixed(2)} ${p.how.padEnd(7)} ${p.label.slice(0, 54).padEnd(54)} now ${p.now.toFixed(2)} next ${p.next.toFixed(2)} mis ${p.mission.toFixed(2)} shape ${p.shape.toFixed(2)} cost ${p.cost.toFixed(2)} risk ${p.risk.toFixed(2)}`);
    }
    return c;
  },
} : named;
// LINES=1 (2026-10-10; OTTO, watching the Veteran: "The AI in this game is firing through it's own unit almost every
// time"): each Firing attack a seat chooses, and whether a Mech of its own squad stands in the lines to the target
// (Unit Protection for the target, 4.5.3, as rules.ts protectionFor reads it: any Large unit in the way). Asked on
// the table as the attack is chosen, which is where it is made from (a Maneuver is a question of its own). Printed
// under the game's line, `  lines s1 <through>/<shots> s2 <through>/<shots>`; the choices are untouched.
let linesGame = null;
const linesWatch = (p) => ({
  ...p,
  ponder: undefined,
  choose(d, view, rng) {
    const c = p.choose(d, view, rng);
    const o = d.options.find((x) => x.id === c.option);
    const s = globalThis.__t?.state;
    if (linesGame && s && o && /^(opp|activation)\.act$/.test(d.kind) && o.tags.includes('attack') && o.tags.includes('firing')
      && typeof o.facts?.targetUid === 'number') {
      const by = s.tokens.find((x) => x.uid === (o.facts.uid ?? d.unit));
      const at = s.tokens.find((x) => x.uid === o.facts.targetUid);
      if (by && at && !by.aerial && !at.aerial) {
        const own = s.tokens.filter((x) => x.side === by.side && x.uid !== by.uid && x.size === 3 && !x.aerial && x.deployed !== false);
        const tally = linesGame[by.side];
        tally[1] += 1;
        if (own.length && M.R.losBetween(by, at, [], own) !== 'clear') tally[0] += 1;
        if (by.kind === 'drone') { tally[3] += 1; if (own.length && M.R.losBetween(by, at, [], own) !== 'clear') tally[2] += 1; }
      }
    }
    return c;
  },
});
// DRONESHOTS=1 (2026-10-12; OTTO, watching the Veteran: its Porcupine stood where it had no shooting angle): each
// Drone's activations in the Automatic Phase, and those it attacked in. Printed under the game's line,
// `  droneshots s1 <attacked>/<activations> s2 <attacked>/<activations>`; the choices are untouched.
let dshotGame = null;
const dshotWatch = (p) => ({
  ...p,
  ponder: undefined,
  choose(d, view, rng) {
    const c = p.choose(d, view, rng);
    const me = view.units.find((u) => u.uid === d.unit);
    if (dshotGame && d.kind === 'activation.act' && view.phaseName === 'Automatic' && me && me.kind !== 'mech' && me.kind !== 'projectile') {
      const turn = `${view.round}:${d.unit}`;
      const tally = dshotGame[view.seat];
      tally.acts.add(turn);
      if (d.options.find((x) => x.id === c.option)?.tags.includes('attack')) tally.shots.add(turn);
    }
    return c;
  },
});
// DODGES=1 (2026-10-12; the defender places its own Dodges against a [Lightning] attack, LIVE that day): each time a
// seat is asked where its Dodges go, and the answer it gave. Printed under the game's line, `  dodges s1 <n> s2 <n>`;
// the answers' labels (numbers as N) tallied in the run's JSON line (`dodgeAnswers`).
let dodgeGame = null;
const dodgeWatch = (p) => ({
  ...p,
  ponder: undefined,
  choose(d, view, rng) {
    const c = p.choose(d, view, rng);
    if (dodgeGame && d.kind === 'defence.dodges') {
      dodgeGame[view.seat] += 1;
      const label = d.options.find((x) => x.id === c.option)?.label ?? c.option;
      bump((tally.dodgeAnswers ??= {}), `${String(label).replace(/\d+/g, 'N')} (of ${d.options.length})`);
    }
    return c;
  },
});
// BLINDSPOTS=1 (M22, 2026-10-12; OTTO: "lets mark all of these down for our next current plan and you can begin on 1
// and 2"): behaviour that may be a blind spot, counted, the choices untouched. Each unit's activation (a Mech's
// Opportunity, a Drone's activation in the Command or the Automatic Phase): whether an attack was on offer (an answer
// tagged attack, or electronic and not a Terminal's), whether one was made (a launch counts as one), and whether it
// ended with one still on offer (passed up). Over the game, for each seat: units alive three rounds or more that
// never moved (of those that can), and, of those carrying something to strike with, that never struck (an
// Interception, an Overwatch Strike or a Riposte counts); Drones that could have been given a Command and never were; Command
// Phases passed with a Drone to give one to; Charges made, and those still unspent as the game ends; Movements of a
// Box's bearer that end further from where Boxes pay. Under the game's line `  blind s1 <json> s2 <json>`; in the
// run's JSON line, by kind of unit (a Drone by its card, a Mech by its longest gun) and by subject and foe
// (`blindCards`); with BLINDLOG=<file> one JSON line a case (seed, who, round, unit, kind, what).
let blindGame = null;
// LOSSLOG=1 (M24, 2026-10-13, the missile defence; OTTO: "analyze why the community squads lost"): each unit a side
// loses, put down to the last attack begun before it fell (a Projectile's strike or blast, a Mech's or a Drone's own
// attack), or to anything else (Integrity Loss in the End Phase, a Mine, a crush), with its points:
// "  losses s1 {...} s2 {...}" after each game, and the run's tally (`lossSums`).
let lossGame = null;
function lossStep(t, r) {
  const up = (x) => x.kind !== 'projectile' && x.deployed !== false && (x.kind === 'mech' ? x.partStates.torso !== 'destroyed' : x.partStates.main !== 'destroyed');
  const tags = r?.option?.tags ?? [];
  const actor = typeof r?.decision?.unit === 'number' ? t.state.tokens.find((x) => x.uid === r.decision.unit) : undefined;
  if (r?.decision?.kind === 'blast.resolve' || tags.includes('detonate') || (actor?.kind === 'projectile' && tags.includes('attack'))) lossGame.by = 'projectile';
  else if (tags.includes('attack') && actor) lossGame.by = actor.kind === 'drone' ? 'drone attack' : 'mech attack';
  const now = new Map(t.state.tokens.filter(up).map((x) => [x.uid, x]));
  if (lossGame.standing) {
    for (const [uid, x] of lossGame.standing) {
      if (now.has(uid)) continue;
      const by = /^(phase|end)/.test(String(r?.decision?.kind ?? '')) ? 'end phase' : lossGame.by ?? 'other';
      const g = (lossGame[x.side][by] ??= { n: 0, pts: 0 });
      g.n += 1;
      g.pts += lossGame.pts.get(uid)?.pts ?? 0;
    }
  }
  lossGame.standing = now;
  // (And each side's Projectiles: every one that came onto the table, and every one that struck: its own attack, or
  // its blast. One that never struck was Intercepted, found nothing in reach, or put down no blast: a Smoke Grenade,
  // a Mine still waiting, a Beacon.)
  for (const x of t.state.tokens) if (x.kind === 'projectile' && !lossGame.projSeen.has(x.uid)) lossGame.projSeen.set(x.uid, x.side);
  if (actor?.kind === 'projectile' && (tags.includes('attack') || tags.includes('detonate') || r?.decision?.kind === 'blast.resolve')) lossGame.projHit.add(actor.uid);
}
const blindKind = (u) => {
  if (u.kind !== 'mech') return `drone:${u.cardId}`;
  const guns = u.weapons.filter((w) => w.type === 'Firing').map((w) => w.range);
  const far = guns.length ? Math.max(...guns) : 0;
  return `mech:${far === 0 ? 'melee' : far <= 4 ? 'short' : far <= 8 ? 'mid' : 'long'}`;
};
const blindStrike = (o) => !!o && (o.tags.includes('attack') || (o.tags.includes('electronic') && !o.tags.includes('terminal')));
const blindActed = (o) => blindStrike(o) || (!!o && o.tags[0] === 'launch' && !o.tags.includes('smoke'));
const blindArmed = (u) => u.weapons.some((w) => ['Firing', 'Melee', 'Projectile'].includes(w.type));
const blindFresh = () => ({ acts: new Map(), struckBy: new Set(), units: new Map(), droneSeen: new Set(), commanded: new Set(), cmdPass: 0, chargesMade: 0, boxAway: 0, rwsAsked: 0, rwsAim: 0, rwsGiven: 0, rwsAimPassed: 0, rwsShots: 0, rwsRounds: new Map(), launches: 0, projActed: new Set(), projStruck: new Set(), icptAsked: 0, icptMade: 0 });
const blindWho = (seat) => (blindGame && seat === blindGame.subjectSeat ? 'subject' : 'foe');
function blindLog(seat, round, u, what) {
  if (!process.env.BLINDLOG || !blindGame) return;
  appendFileSync(process.env.BLINDLOG, `${JSON.stringify({ seed: blindGame.seed, who: blindWho(seat), seat, round, uid: u.uid, label: u.label, kind: blindKind(u), what })}\n`);
}
function blindPayCells(view) {
  const task = view.task;
  const zones = task?.family === 'blackbox'
    ? view.zones.filter((z) => !!task.scoringZone && (z.name === task.scoringZone || z.id === task.scoringZone))
    : view.zones.filter((z) => z.scoring);
  return zones.flatMap((z) => z.cells).map((ref) => { const [col, row] = String(ref).split(',').map(Number); return { col, row }; });
}
function blindSee(d, view, c) {
  const g = blindGame[view.seat];
  for (const u of view.units) {
    if (u.side !== view.seat || u.kind === 'projectile' || !u.alive || !u.deployed) continue;
    const seen = g.units.get(u.uid);
    if (!seen) g.units.set(u.uid, { u, first: u.grid, from: view.round, to: view.round, moved: false });
    else { seen.u = u; seen.to = view.round; if (seen.first.col !== u.grid.col || seen.first.row !== u.grid.row) seen.moved = true; }
  }
  const chosen = d.options.find((x) => x.id === c.option);
  // A strike made outside the unit's own activation (an Interception, an Overwatch Strike, a Riposte) is one all the same.
  if (blindActed(chosen)) { const by = typeof chosen.facts?.uid === 'number' ? chosen.facts.uid : d.unit; if (typeof by === 'number') g.struckBy.add(by); }
  if ((d.kind === 'opp.act' || d.kind === 'activation.act') && typeof d.unit === 'number') {
    const u = view.units.find((x) => x.uid === d.unit);
    if (!u || u.kind === 'projectile') return;
    const key = `${view.round}:${view.phaseName ?? ''}:${d.unit}`;
    let a = g.acts.get(key);
    if (!a) { a = { kind: blindKind(u), u, round: view.round, offered: false, struck: false, passed: false }; g.acts.set(key, a); }
    const offered = d.options.some(blindStrike);
    if (offered) a.offered = true;
    if (blindActed(chosen)) { a.struck = true; g.struckBy.add(u.uid); }
    if (offered && !a.passed && chosen?.tags.includes('end')) { a.passed = true; blindLog(view.seat, view.round, u, `ended its ${view.phaseName ?? ''} activation with ${d.options.filter(blindStrike).map((o) => o.label).slice(0, 3).join(' / ')} on offer`); }
    if (chosen?.tags.includes('charge')) g.chargesMade += 1;
    const to = chosen?.tags[0] === 'move' ? chosen.facts?.to : null;
    if (to && view.boxes?.some((b) => b.bearer === u.uid)) {
      const pay = blindPayCells(view);
      const far = (gr) => Math.min(...pay.map((q) => Math.abs(q.col - gr.col) + Math.abs(q.row - gr.row)));
      if (pay.length && far({ col: to.c, row: to.r }) > far(u.grid)) { g.boxAway += 1; blindLog(view.seat, view.round, u, `carried a Box from ${far(u.grid)} Grids of where it pays to ${far({ col: to.c, row: to.r })}`); }
    }
  }
  // Every Projectile the squad launches (a Smoke Grenade aside), each launch of a Volley one (M24, the missile barrage).
  if (chosen?.tags[0] === 'launch' && !chosen.tags.includes('smoke')) g.launches += 1;
  // THE MISSILE DEFENCE (M24, 2026-10-13): each of the squad's Projectiles asked to act (its strike, or its blast), and
  // those that struck something; each Interception the squad was offered, and those it made.
  const flying = typeof d.unit === 'number' ? view.units.find((u) => u.uid === d.unit) : undefined;
  if (flying?.kind === 'projectile' && flying.side === view.seat && (d.kind === 'activation.act' || d.kind === 'blast.resolve')) {
    g.projActed.add(d.unit);
    if (blindActed(chosen) || chosen?.tags.includes('detonate')) g.projStruck.add(d.unit);
  }
  if (d.kind === 'intercept.attempt') {
    g.icptAsked += 1;
    if (chosen?.tags.includes('intercept') && !chosen.tags.includes('decline')) g.icptMade += 1;
  }
  if (d.kind === 'loop.designate.command') {
    const designates = d.options.filter((o) => o.tags.includes('designate'));
    for (const o of designates) if (typeof o.facts?.uid === 'number') g.droneSeen.add(o.facts.uid);
    if (chosen?.tags.includes('designate') && typeof chosen.facts?.uid === 'number') g.commanded.add(chosen.facts.uid);
    if (chosen?.tags.includes('pass') && designates.length) g.cmdPass += 1;
    // RWS (2026-10-13, OTTO's ask): a Mech offered a Command (an Ls197R Autocannon), whether its Command would have a
    // shot, whether it was given one, and whether the squad passed with that shot on offer.
    const mechs = designates.filter((o) => view.units.find((u) => u.uid === o.facts?.uid)?.kind === 'mech');
    if (mechs.length) {
      g.rwsAsked += 1;
      const aimed = mechs.some((o) => (o.then?.()?.options ?? []).some(blindStrike));
      if (aimed) g.rwsAim += 1;
      if (mechs.includes(chosen)) g.rwsGiven += 1;
      // Each round's first such question: a shot, or the nearest enemy's distance from the RWS Mech (Grids).
      if (!g.rwsRounds.has(view.round)) {
        const me = view.units.find((u) => u.uid === mechs[0].facts.uid);
        const foes = view.units.filter((u) => u.side !== view.seat && u.alive && u.deployed && u.kind !== 'projectile');
        const near = me && foes.length ? Math.min(...foes.map((u) => Math.abs(u.grid.col - me.grid.col) + Math.abs(u.grid.row - me.grid.row))) : 99;
        g.rwsRounds.set(view.round, aimed ? 'shot' : near <= 6 ? 'inRange' : near <= 9 ? 'near' : 'far');
      }
      if (aimed && chosen?.tags.includes('pass')) { g.rwsAimPassed += 1; blindLog(view.seat, view.round, view.units.find((u) => u.uid === mechs[0].facts.uid), 'passed the Command Phase with an RWS shot on offer'); }
    }
  }
  if (d.kind === 'activation.act' && view.phaseName === 'Command' && view.units.find((u) => u.uid === d.unit)?.kind === 'mech' && blindActed(chosen)) g.rwsShots += 1;
}
const blindWatch = (p) => ({
  ...p,
  ponder: undefined,
  choose(d, view, rng) {
    const c = p.choose(d, view, rng);
    if (blindGame) blindSee(d, view, c);
    return c;
  },
});
// The game's line of counts, and the run's tally by kind of unit.
function blindEnd(state) {
  const line = {};
  for (const seat of ['s1', 's2']) {
    const g = blindGame[seat];
    const acts = [...g.acts.values()];
    let still = 0, silent = 0;
    const who = blindWho(seat);
    const cards = (tally.blindCards ??= {});
    const row = (kind) => (cards[`${who}|${kind}`] ??= { acts: 0, offered: 0, struck: 0, passed: 0, units: 0, mobile: 0, armed: 0, still: 0, silent: 0 });
    for (const x of g.units.values()) {
      if (x.to - x.from + 1 < 3) continue;
      const r = row(blindKind(x.u));
      r.units += 1;
      const mobile = (x.u.kind === 'mech' ? x.u.maneuver : x.u.move) > 0;
      if (mobile) r.mobile += 1;
      if (!x.moved && mobile) { still += 1; r.still += 1; blindLog(seat, x.to, x.u, `stood where it deployed for ${x.to - x.from + 1} rounds`); }
      if (blindArmed(x.u)) {
        r.armed += 1;
        if (!g.struckBy.has(x.u.uid)) { silent += 1; r.silent += 1; blindLog(seat, x.to, x.u, `struck nothing in ${x.to - x.from + 1} rounds`); }
      }
    }
    const never = [...g.droneSeen].filter((uid) => !g.commanded.has(uid)).length;
    const held = state ? state.tokens.filter((x) => x.side === seat && (x.charge ?? []).length) : [];
    const chargesLeft = held.reduce((n, x) => n + x.charge.length, 0);
    for (const x of held) { const seen = g.units.get(x.uid); if (seen) blindLog(seat, seen.to, seen.u, `held ${x.charge.length} Charge${x.charge.length === 1 ? '' : 's'} unspent as the game ended`); }
    line[seat] = {
      acts: acts.length, offered: acts.filter((a) => a.offered).length, struck: acts.filter((a) => a.struck).length, passed: acts.filter((a) => a.passed).length,
      still, silent, neverCommanded: never, cmdPass: g.cmdPass, chargesMade: g.chargesMade, chargesLeft, boxAway: g.boxAway, launches: g.launches, projActed: g.projActed.size, projStruck: g.projStruck.size, icptAsked: g.icptAsked, icptMade: g.icptMade,
      ...(g.rwsAsked ? { rwsAsked: g.rwsAsked, rwsAim: g.rwsAim, rwsGiven: g.rwsGiven, rwsAimPassed: g.rwsAimPassed, rwsShots: g.rwsShots,
        rwsRounds: [...g.rwsRounds.entries()].sort((a, b) => a[0] - b[0]).map(([r, k]) => `${r}:${k}`).join(' ') } : {}),
    };
    for (const a of acts) {
      const r = row(a.kind);
      r.acts += 1; r.offered += a.offered ? 1 : 0; r.struck += a.struck ? 1 : 0; r.passed += a.passed ? 1 : 0;
    }
    const sums = (tally.blindSums ??= {});
    const s = (sums[who] ??= { games: 0 });
    s.games += 1;
    for (const [k, v] of Object.entries(line[seat])) if (typeof v === 'number') s[k] = (s[k] ?? 0) + v;
  }
  console.log(`  blind s1 ${JSON.stringify(line.s1)} s2 ${JSON.stringify(line.s2)}`);
}
// FOE=<policy>: a match, the policy named in the arguments (the subject) against this one, the seats
// swapped from one seed to the next; the tally counts the subject's wins and Victory Points.
const foe = process.env.FOE ? policyOf(M.AI, process.env.FOE) : null;
// FACTORIAL=<name>=<value>,...: the levers drawn on or off for each seed (below).
const FACT = process.env.FACTORIAL ? process.env.FACTORIAL.split(',').map((x) => { const [k, v] = x.split('='); return [k, Number(v)]; }) : null;
if (process.env.FOE && !foe) throw new Error(`no policy called ${process.env.FOE}`);

const MAPS = data.terrain.maps.map((m) => m.id);
// PROBE_FAMILY=terminal (or a card's id) keeps the games to one kind of Main Task.
const MISSIONS = data.missions.cards.filter((c) => !process.env.PROBE_FAMILY || c.family === process.env.PROBE_FAMILY || c.id === process.env.PROBE_FAMILY).map((c) => c.id);
const FACTIONS = ['RDL', 'UN', 'GOF', 'PD', 'COLLABORATION'];
const SLOTS = [['torso', 'torso'], ['chasis', 'chasis'], ['leftHand', 'leftHand'], ['rightHand', 'rightHand'], ['backpack', 'backpack'], ['pilot', 'pilot']];
const buildable = (c) => !M.D.isDiscardCard(c) && !M.D.isModeFace(c) && !c.referenceOnly;
const pools = {};
for (const f of FACTIONS) {
  pools[f] = { drones: data.cards.filter((c) => c.category === 'drone' && (c.score ?? 0) > 0 && (c.score ?? 0) < 99 && data.factionOf(c) === f) };
  for (const [key, type] of SLOTS) {
    pools[f][key] = data.cards.filter((c) => (key === 'pilot' ? c.category === 'pilot' : c.category === 'mech_part' && c.type === type) && buildable(c) && data.factionOf(c) === f);
  }
}
const loads = data.cards.filter((c) => M.U.canBeLoad(c) && buildable(c));
const price = (id) => (id ? data.byId.get(id)?.score ?? 0 : 0);

function mechOf(rng, f) {
  const p = pools[f];
  if (!p.torso.length || !p.chasis.length || !p.pilot.length || !(p.leftHand.length + p.rightHand.length)) return null;
  const pick = (key, odds) => (p[key].length && rng.next() < odds ? rng.pick(p[key]).id : undefined);
  const loadout = { torso: pick('torso', 1), chasis: pick('chasis', 1), leftHand: pick('leftHand', 0.85), rightHand: pick('rightHand', 0.85), backpack: pick('backpack', 0.8), pilot: pick('pilot', 1) };
  if (!loadout.leftHand && !loadout.rightHand) loadout[p.leftHand.length ? 'leftHand' : 'rightHand'] = rng.pick(p.leftHand.length ? p.leftHand : p.rightHand).id;
  for (const k of Object.keys(loadout)) if (!loadout[k]) delete loadout[k];
  return { name: M.D.cardName(data.byId.get(loadout.torso)).split(' ').slice(-2).join(' '), loadout, points: Object.values(loadout).reduce((n, id) => n + price(id), 0) };
}

function droneOf(rng, f) {
  const p = pools[f].drones;
  if (!p.length) return null;
  const card = rng.pick(p);
  const out = { cardId: card.id, points: card.score ?? 0 };
  if (M.U.isCarrier(card)) {
    const mine = loads.filter((c) => data.factionOf(c) === f);
    if (mine.length) { const load = rng.pick(mine); out.backpack = load.id; out.points += load.score ?? 0; }
  }
  return out;
}

// PROBE_DRONE=<card id> (M12): both squads of that Drone's allegiance, each with one of it, the rest
// at random as ever (the faction is still drawn, so a seed's other draws stay where they were).
const forced = process.env.PROBE_DRONE ? data.byId.get(process.env.PROBE_DRONE) : null;
if (process.env.PROBE_DRONE && !forced) throw new Error(`no card called ${process.env.PROBE_DRONE}`);
// PROBE_LOAD=1 (2026-10-09, `leash`): a forced Carrier carries a Load of the squad's allegiance, drawn by lot (one draw
// more than PROBE_DRONE alone makes, so a seed's squads are not that run's).
const forcedLoad = (rng, f) => {
  if (!process.env.PROBE_LOAD || !forced || !M.U.isCarrier(forced)) return null;
  const mine = loads.filter((c) => data.factionOf(c) === f);
  return mine.length ? rng.pick(mine) : null;
};
// PROBE_PART=<card id> (2026-10-04 night, `patch`): both squads of that Part's allegiance, the first Mech of it in
// each carrying the Part in its slot in place of what was drawn there, the rest at random as ever.
const part = process.env.PROBE_PART ? data.byId.get(process.env.PROBE_PART) : null;
if (process.env.PROBE_PART && !part) throw new Error(`no card called ${process.env.PROBE_PART}`);

// A squad of one allegiance, with now and then a mercenary unit beside it.
function squadOf(rng, budgetNow, want) {
  const drawn = rng.pick(FACTIONS);
  const faction = forced ? data.factionOf(forced) : part ? data.factionOf(part) : want ?? drawn;
  const mechs = [];
  const load = forcedLoad(rng, faction);
  const drones = forced ? [{ cardId: forced.id, ...(load ? { backpack: load.id } : {}) }] : [];
  let total = forced ? (forced.score ?? 0) + (load?.score ?? 0) : 0;
  for (let tries = 0; tries < 40 && mechs.length + drones.length < 7; tries++) {
    const merc = rng.next() < 0.15 ? rng.pick(['PD', 'COLLABORATION']) : faction;
    const wantMech = !mechs.length || rng.next() < 0.45;
    const unit = wantMech ? mechOf(rng, merc) : droneOf(rng, merc);
    if (!unit || total + unit.points > budgetNow) continue;
    total += unit.points;
    if (wantMech) mechs.push({ name: unit.name, loadout: unit.loadout });
    else drones.push({ cardId: unit.cardId, ...(unit.backpack ? { backpack: unit.backpack } : {}) });
  }
  if (!mechs.length) {
    // The budget fitted none at random: the cheapest Mech of the faction, whatever it costs.
    let best = null;
    for (let i = 0; i < 60; i++) { const m = mechOf(rng, faction); if (m && (!best || m.points < best.points)) best = m; }
    if (best) { mechs.push({ name: best.name, loadout: best.loadout }); total += best.points; }
  }
  const host = part ? mechs.find((m) => data.factionOf(data.byId.get(m.loadout.torso)) === data.factionOf(part)) : null;
  if (host) { total += (part.score ?? 0) - price(host.loadout[part.type]); host.loadout[part.type] = part.id; }
  return { name: `${faction} ${total}`, faction, points: total, mechs, drones };
}

// (PROBE_SET=scenarios, the M12 custom set built from the demo scenarios, left with them on 2026-10-12: the
// community squads, PROBE_COMMUNITY, are the custom set now.)

// PROBE_COMMUNITY=<file> (2026-10-04, OTTO's Discord saves): both squads drawn from those squads ({ name: SoloSquad },
// tests/_community.mjs), within PROBE_MIN and PROBE_MAX points; each game's line names them.
const COMMUNITY = process.env.PROBE_COMMUNITY
  ? Object.values(JSON.parse(readFileSync(process.env.PROBE_COMMUNITY, 'utf8'))).filter((s) => s.points >= Number(process.env.PROBE_MIN ?? 0) && s.points <= Number(process.env.PROBE_MAX ?? 99999))
  : null;
if (COMMUNITY && COMMUNITY.length < 2) throw new Error('PROBE_COMMUNITY: fewer than two squads in the bounds');
// PROBE_SQUAD=<name> (with PROBE_COMMUNITY, 2026-10-04 night): the subject plays that squad in every game, the
// other squad drawn from the set as ever (the draws made as ever, so a seed's table stays where it was).
// PROBE_SQUADFILE=<file> (2026-10-05 late night, OTTO's Drone compositions): PROBE_SQUAD is read from that file ({ name:
// SoloSquad }) instead, and the other squad is drawn at random at the budget as ever (or from PROBE_COMMUNITY where
// that is set), so every squad of the file meets the same opponent on the same seed.
const SQUADFILE = process.env.PROBE_SQUADFILE ? JSON.parse(readFileSync(process.env.PROBE_SQUADFILE, 'utf8')) : null;
const FIXED = process.env.PROBE_SQUAD ? (SQUADFILE ? SQUADFILE[process.env.PROBE_SQUAD] ?? null : COMMUNITY?.find((s) => s.name === process.env.PROBE_SQUAD)) : null;
if (process.env.PROBE_SQUAD && !FIXED) throw new Error(`PROBE_SQUAD: no squad called ${process.env.PROBE_SQUAD} in the set`);
// PROBE_SUBJECTS=<file> (2026-10-06, the melee plan): the subject plays the squads of that file ({ name: SoloSquad })
// in turn, one a seed (the seed modulo their number), the other squad drawn as ever (PROBE_COMMUNITY or at random).
const SUBJECTS = process.env.PROBE_SUBJECTS ? Object.values(JSON.parse(readFileSync(process.env.PROBE_SUBJECTS, 'utf8'))) : null;

const tally = { games: 0, over: 0, ends: {}, why: {}, kinds: {}, vp: {}, ms: 0 };
// ENDOPEN=<R> (M16, item 2, the last round searched: how open is a game when its last round begins?). The game is
// played to its last round's Planning Phase, the table copied, and that round played out R times from the copy by
// fresh policies of the same names, each copy with dice of its own; the subject's share of those games (a level one
// counts half) goes on the game's line as `open <p>/<R>`, and the tally counts the games by it (`open`). The game
// itself then goes on as it would have. ENDOPEN_FOE=<policy>: the copies' foe is that policy (the subject's own name
// is kept), to read how much a different player of the last round would change it.
// ENDOPEN_ROUND=<n>: the table copied at round n's Planning Phase instead, and the copies played from there to the
// end (how open the game is two rounds out, three...).
async function endOpen(t, scenario, seed, subjectSeat, R) {
  const snap = structuredClone(t.state);
  const foeSeat = subjectSeat === 's1' ? 's2' : 's1';
  const foeName = process.env.ENDOPEN_FOE ?? process.env.FOE ?? policyName;
  const scores = [];
  for (let r = 0; r < R; r++) {
    const u = botTable(M, data, scenario, { seed: `${seed}:end${r}`, policies: { [subjectSeat]: policyOf(M.AI, policyName), [foeSeat]: policyOf(M.AI, foeName) }, glue });
    for (const k of Object.keys(u.state)) delete u.state[k];
    Object.assign(u.state, structuredClone(snap));
    let e;
    try { e = await u.run({ maxSteps: 6000 }); } catch (err) { e = { kind: 'threw', why: String(err?.message ?? err) }; } finally { u.close(); }
    if (e.kind !== 'over') continue;
    const w = e.result.winner;
    scores.push(w === subjectSeat ? 1 : w === foeSeat ? 0 : 0.5);
  }
  M.L.setLocalSeat('s1');
  return { p: scores.length ? scores.reduce((a, x) => a + x, 0) / scores.length : null, n: scores.length };
}
// ENDCHOICES=<K>:<R> (M16 E1, what another answer would have won). The game's last round is stepped by hand; at the
// first answer of each of the subject's activations, the Ace's own answer and the first answers of its next best plans
// (`firstAnswers`, K in all) are each forced on a copy of the table and the rest of the game played R times by fresh
// policies. Copy r of every answer throws the same dice (the same seed), so the answers are compared on the same luck.
// One line for each activation (`E1`): each answer, its share of the subject's wins, the Ace's own marked `*`.
// ENDSEEDS=<seed,...> plays only those seeds (the open ones E0 found).
async function endChoices(t, scenario, seed, subjectSeat, d, K, R) {
  const view = M.SEAT.viewOf(data, t.state, subjectSeat);
  const chose = policyOf(M.AI, policyName).choose(d, view, new M.AI.Rng(`${seed}:e1`))?.option;
  M.L.setLocalSeat('s1');
  if (!chose) return null;
  const alts = M.AI.firstAnswers(d, view).filter((x) => x.first && x.first !== chose && d.options.some((o) => o.id === x.first)).slice(0, K - 1);
  if (!alts.length) return null;
  const cands = [{ first: chose, label: d.options.find((o) => o.id === chose)?.label ?? chose, chosen: true }, ...alts.map((a) => ({ first: a.first, label: a.label, chosen: false }))];
  const snap = structuredClone(t.state);
  const foeSeat = subjectSeat === 's1' ? 's2' : 's1';
  const foeName = process.env.ENDOPEN_FOE ?? process.env.FOE ?? policyName;
  for (const c of cands) {
    const scores = [];
    for (let r = 0; r < R; r++) {
      const ace = policyOf(M.AI, policyName);
      let forced = false;
      const force = {
        name: ace.name,
        choose(dd, vv, rr) {
          if (!forced && dd.kind === d.kind && dd.unit === d.unit && dd.options.some((o) => o.id === c.first)) { forced = true; return { option: c.first, reason: 'forced', why: 'E1' }; }
          return ace.choose(dd, vv, rr);
        },
      };
      const u = botTable(M, data, scenario, { seed: `${seed}:e1:${r}`, policies: { [subjectSeat]: force, [foeSeat]: policyOf(M.AI, foeName) }, glue });
      for (const k of Object.keys(u.state)) delete u.state[k];
      Object.assign(u.state, structuredClone(snap));
      let e;
      try { e = await u.run({ maxSteps: 6000 }); } catch (err) { e = { kind: 'threw', why: String(err?.message ?? err) }; } finally { u.close(); }
      if (e.kind !== 'over' || !forced) continue;
      const w = e.result.winner;
      scores.push(w === subjectSeat ? 1 : w === foeSeat ? 0 : 0.5);
    }
    c.p = scores.length ? scores.reduce((a, x) => a + x, 0) / scores.length : null;
    c.n = scores.length;
  }
  M.L.setLocalSeat('s1');
  return cands;
}
const ENDSEEDS = process.env.ENDSEEDS ? new Set(process.env.ENDSEEDS.split(',').map(Number)) : null;
// POSITIONS=<file prefix> (M17 L0, the learned evaluator's data): the table as each seat sees it, read into numbers
// (src/ai/features.ts, the reading the Ace will use in play), each time the round, the phase or the count of units
// that have had their turn changes; when the game ends every row of it is written to <prefix>-<from>-<to>.jsonl with
// how the game ended for that seat: `y` 1 won, 0.5 level, 0 lost; `m` its Victory Point margin; `t` its margin of
// Parts and Drones standing (5.2.4). A row: g seed, fam the Main Task's family, r round, ph phase, s seat, f numbers.
// The first line of a file names the numbers (`names`), the policies and the points.
const POSITIONS = process.env.POSITIONS ? `${process.env.POSITIONS}-${from}-${to}.jsonl` : null;
if (POSITIONS) writeFileSync(POSITIONS, `${JSON.stringify({ names: M.AI.FEATURES, policy: policyName, foe: process.env.FOE ?? null, budget, community: !!COMMUNITY })}\n`);
let posRows = [];
let posKey = '';
// The walks to the zones, kept for the game (seat.ts lookOf; the Ace's driver keeps its own the same way).
let posWalks = new Map();
function positionStep(t, seed, family) {
  const st = t.state;
  const key = `${st.round.n}:${st.round.phase}:${st.tokens.filter((x) => x.acted || x.done).length}:${st.script?.acted?.length ?? 0}`;
  if (key === posKey) return;
  posKey = key;
  // Each seat's reading of the table with the engine's sight and walks (features.ts Look), the lines of sight walked
  // once for both seats.
  M.SEAT.pondering(() => {
    for (const s of ['s1', 's2']) posRows.push({ g: seed, fam: family, r: st.round.n, ph: st.round.phase, s, f: M.AI.featuresOf(M.SEAT.lookOf(data, st, s, posWalks)) });
  });
}
function positionsEnd(t, end) {
  posWalks = new Map();
  if (!POSITIONS || !posRows.length) return;
  const won = end.kind === 'over' ? end.result.winner : undefined;
  const vp = t ? M.TK.normaliseTasks(t.state.tasks).vp : { s1: 0, s2: 0 };
  const v1 = M.SEAT.viewOf(data, t.state, 's1');
  const tie = M.AI.standingFor(v1, 's1') - M.AI.standingFor(v1, 's2');
  const out = [];
  if (end.kind === 'over') {
    for (const row of posRows) {
      const other = row.s === 's1' ? 's2' : 's1';
      const y = won === row.s ? 1 : won === other ? 0 : 0.5;
      out.push(JSON.stringify({ ...row, y, m: (vp[row.s] ?? 0) - (vp[other] ?? 0), t: row.s === 's1' ? tie : -tie }));
    }
  }
  if (out.length) appendFileSync(POSITIONS, `${out.join('\n')}\n`);
  posRows = [];
  posKey = '';
}
// TIES=<file> (2026-10-07, the tie census): each tie the Tactician meets between answers of two DIFFERENT Actions
// priced alike (tactician.ts TIES: between attacks, launches, or deeds of different kinds), either seat's, counted
// once for each game, round and unit; written to <file> and the most frequent printed (`tally.ties`, the count).
const ties = process.env.TIES ? new Map() : null;
let tieTable = null;
let tieSeed = 0;
if (ties) {
  M.AI.TIES.hook = (x) => {
    const pair = [x.actionA, x.actionB].sort().join(' ~ ');
    const k = `${x.where}|${pair}`;
    const row = ties.get(k) ?? { where: x.where, pair, seen: new Set(), example: `${x.a}  /  ${x.b}  (worth ${x.value.toFixed(2)})` };
    row.seen.add(`${tieSeed}:${tieTable?.state.round.n ?? 0}:${x.unit}`);
    ties.set(k, row);
  };
}
// SQUADLOG=1 (2026-10-07, M18's S0, the coordination census; OTTO: "go ahead and start the S0 census"): how each
// squad acts together, round by round, either seat's: (1) DIALLED AT ONE TARGET, a round in which two or more of a
// squad's Mechs had their dials set to attack the same enemy (tactician.ts DIALS: the plan each Timing was chosen by);
// (2) A TARGET GONE, a Mech whose dial's target was already destroyed when its activation began, and of those the
// activations that then attacked nothing; (3) BLADES ALONE, a round in which one of a squad's blade Mechs struck in
// Melee while another of its blades did not, against BLADES TOGETHER, two or more striking; (4) ZONES CROWDED, on a
// Main Task with two or more scoring zones, a round's Action Phase ending with two or more of a squad's units in one
// zone and none in another; (5) A LOCK BEFORE THE GUN, an enemy gunner (a Mech with a Firing Action that does not
// print Melee Firing) whose activation began beside a Mech of the squad. `tally.squad`, printed.
// (Counted for each role apart, 2026-10-07: the subject's squad and the other, so a policy given to one seat is
// read against the other's in the very same games.)
const squadZero = () => ({ squadRounds: 0, dialled: 0, sameTarget: 0, planned: 0, lost: 0, lostIdle: 0, bladeRounds: 0, bladeAlone: 0, bladeTogether: 0, zoneRounds: 0, crowded: 0, gunActs: 0, gunLocked: 0 });
const squad = process.env.SQUADLOG ? { subject: squadZero(), foe: squadZero() } : null;
let sqGame = null;
// CAMOLOG=1 (2026-10-08; OTTO: "have we account for camo on UN parts? So everything involving camo gameplay with low
// profile and silence"): the SUBJECT's camouflage play, counted after every answer of the game (tally.camo):
//   camoUnits   units of the subject's seen in Optical Camouflage at least once in a game
//   camoRounds  rounds those units began standing; hiddenRounds  of them, hidden as the round began
//   deployHidden units hidden as round 1 began; cloaks  a unit of the subject's put back into camouflage later
//   silent      an answer of an Opportunity by a unit hidden before it that left it hidden (an Action with Silence)
//   shownBy     a unit of the subject's seen after its own answer, by the answer's kind (the act that gave it away)
//   found       a hidden unit of the subject's seen after an answer of the OTHER squad's (a Scan won, a Highlight)
//   reveals     the Reveals asked of the subject (revealStay in place, revealHop to another Grid)
//   hunted      the other squad's designations of a hidden unit of the subject's (the attack that Scans first)
//   lostHidden  units of the subject's destroyed while hidden; lostCamo  camouflage units destroyed at all
//   revealByAct / revealByScan  what a Reveal followed: the unit's own act (its kind in revealActs) or a designation
//               of it by the other squad, whichever came last
let camoGame = null;
// LANELOG=1 (2026-10-09, `lanes`; a community player's notes with RDL_DroneEscort: most objective maps have three
// lanes, most squads hold one and contest the middle, "if you are able to contest 2 lanes you tend to win most of the
// time"): on a Main Task that scores two zones or more, as each round's End Phase begins, how many of them each squad
// holds and how many it stands in (a unit of its own that holds zones, in one of the zone's Grids), by role; and for
// each game, whether the squad that stood in two zones or more in more of its rounds won. `tally.lanes`, printed.
let laneGame = null;
// SUPPORTLOG=1 (2026-10-09; OTTO: "a lot of lists run the MUE/N-20 Echoes Support Backpack and build one unit around
// simply supporting their squadmates ... buff a squadmate to give extra action and then repair a link on them after"):
// the SUBJECT's support Mechs (a 009 Echoes backpack: Coordinate, 009_A; a 018 Aurora core: Strengthen Link, 018_B), in
// each of their Opportunities: whether it was on the Tactical dial (both are Tactics), and each Action offered (the
// engine offers it only with a squadmate in its Range 4) and made, and both made in one Opportunity. `tally.support`.
const SUPPORT = { coordinate: '009_A', strengthen: '018_B' };
let supportGame = null;
function supportStep(t, seat, r, subjectSeat) {
  const d = r.decision;
  if (seat !== subjectSeat || d?.kind !== 'opp.act' || !supportGame.mechs.has(d.unit)) return;
  const key = `${t.state.round.n}:${d.unit}`;
  let o = supportGame.opps.get(key);
  if (!o) supportGame.opps.set(key, o = { tactical: t.state.tokens.find((x) => x.uid === d.unit)?.timing === 'tactical', offered: {}, made: {} });
  for (const [name, id] of Object.entries(SUPPORT)) {
    if (d.options.some((x) => x.facts?.actionId === id)) o.offered[name] = true;
    if (r.option?.facts?.actionId === id) o.made[name] = true;
  }
}
function supportEnd() {
  if (!supportGame?.mechs.size) return;
  const S = (tally.support ??= { games: 0, mechs: 0, opps: 0, tactical: 0, offered: { coordinate: 0, strengthen: 0 }, made: { coordinate: 0, strengthen: 0 }, pair: 0 });
  S.games += 1; S.mechs += supportGame.mechs.size;
  for (const o of supportGame.opps.values()) {
    S.opps += 1; if (o.tactical) S.tactical += 1;
    for (const name of Object.keys(SUPPORT)) { if (o.offered[name]) S.offered[name] += 1; if (o.made[name]) S.made[name] += 1; }
    if (o.made.coordinate && o.made.strengthen) S.pair += 1;
  }
}
function laneStep(t, subjectSeat) {
  const st = t.state;
  if (M.TY.PHASES[st.round.phase] !== 'End' || laneGame.round === st.round.n) return;
  laneGame.round = st.round.n;
  for (const seat of ['s1', 's2']) {
    const view = M.SEAT.viewOf(data, st, seat);
    const zones = view.zones.filter((z) => z.scoring && z.cells.length);
    if (zones.length < 2) return;
    const mine = view.units.filter((u) => u.side === seat && u.alive && u.deployed && u.kind !== 'projectile' && !u.lowValue);
    const stood = zones.filter((z) => mine.some((u) => z.cells.includes(`${u.grid.col},${u.grid.row}`))).length;
    laneGame.rows.push({ seat, role: seat === subjectSeat ? 'subject' : 'foe', held: zones.filter((z) => (z.holder ?? z.control) === seat).length, stood });
  }
}
function laneEnd(won) {
  if (!laneGame?.rows.length) return;
  const L = (tally.lanes ??= { games: 0, rounds: 0, held: {}, stood: {}, winner: { held: 0, stood: 0, n: 0 }, loser: { held: 0, stood: 0, n: 0 }, spread: { won: 0, lost: 0, level: 0, even: 0 } });
  L.games += 1;
  const two = { s1: 0, s2: 0 };
  for (const r of laneGame.rows) {
    L.rounds += 1;
    bump(L.held, `${r.role}:${r.held}`);
    bump(L.stood, `${r.role}:${r.stood}`);
    if (r.stood >= 2) two[r.seat] += 1;
    if (won === 's1' || won === 's2') {
      const side = r.seat === won ? L.winner : L.loser;
      side.held += r.held; side.stood += r.stood; side.n += 1;
    }
  }
  // The squad that stood in two zones or more in more rounds than the other: did it win?
  if (two.s1 === two.s2) L.spread.even += 1;
  else {
    const wide = two.s1 > two.s2 ? 's1' : 's2';
    if (won === wide) L.spread.won += 1; else if (won === 's1' || won === 's2') L.spread.lost += 1; else L.spread.level += 1;
  }
}
function camoStep(t, seat, r, subjectSeat) {
  const c = (tally.camo ??= { games: 0, camoUnits: 0, camoRounds: 0, hiddenRounds: 0, deployHidden: 0, cloaks: 0, silent: 0, shownBy: {}, found: 0, reveals: 0, revealStay: 0, revealHop: 0, hunted: 0, lostHidden: 0, lostCamo: 0 });
  c.revealByAct ??= 0; c.revealByScan ??= 0; c.revealActs ??= {};
  const view = M.SEAT.viewOf(data, t.state, subjectSeat);
  const mine = view.units.filter((u) => u.side === subjectSeat && u.kind !== 'projectile');
  const now = new Set(mine.filter((u) => u.alive && u.camouflaged).map((u) => u.uid));
  const g = camoGame;
  for (const uid of now) {
    if (!g.ever.has(uid)) { g.ever.add(uid); c.camoUnits += 1; if (t.state.round.n <= 1 && !g.started) c.deployHidden += 1; }
    else if (!g.prev.has(uid)) c.cloaks += 1;
  }
  for (const uid of g.prev) {
    if (now.has(uid)) continue;
    const u = mine.find((x) => x.uid === uid);
    if (!u || !u.alive) { c.lostHidden += 1; continue; }
    if (seat === subjectSeat) bump(c.shownBy, String(r.option?.tags?.[0] ?? r.decision?.kind ?? '?'));
    else c.found += 1;
  }
  if (seat === subjectSeat && /^(opp|activation)\.act$/.test(r.decision?.kind ?? '') && g.prev.has(r.decision.unit) && now.has(r.decision.unit)
    && !['end', 'pass'].includes(r.option?.tags?.[0] ?? '')) c.silent += 1;
  g.step = (g.step ?? 0) + 1;
  g.acted ??= new Map(); g.hunt ??= new Map();
  if (seat === subjectSeat && /^(opp|activation)\.act$/.test(r.decision?.kind ?? '') && !['end', 'pass'].includes(r.option?.tags?.[0] ?? '')) g.acted.set(r.decision.unit, { at: g.step, tag: String(r.option?.tags?.[0] ?? '?') });
  if (seat === subjectSeat && r.decision?.kind === 'reveal.make') {
    c.reveals += 1; if (r.option?.tags?.includes('stay')) c.revealStay += 1; else c.revealHop += 1;
    const own = g.acted.get(r.decision.unit);
    if ((g.hunt.get(r.decision.unit) ?? -1) > (own?.at ?? -1)) c.revealByScan += 1; else { c.revealByAct += 1; bump(c.revealActs, own?.tag ?? '?'); }
  }
  if (seat !== subjectSeat && r.option?.tags?.includes('hidden')) { c.hunted += 1; const tg = r.option?.facts?.targetUid; if (typeof tg === 'number') g.hunt.set(tg, g.step); }
  // A round begun: who of the camouflage units stands, and who of them is hidden.
  if (t.state.round.n !== g.round && M.SU.normaliseSetup(t.state.setup)?.stage === 'done') {
    g.round = t.state.round.n;
    if (g.round >= 1) g.started = true;
    const standing = mine.filter((u) => u.alive && g.ever.has(u.uid));
    c.camoRounds += standing.length;
    c.hiddenRounds += standing.filter((u) => now.has(u.uid)).length;
  }
  // A destroyed unit leaves the view altogether (2026-10-08: counted only when it was still listed, so never).
  for (const uid of g.ever) {
    const u = mine.find((x) => x.uid === uid);
    if ((!u || !u.alive) && !g.dead.has(uid)) { g.dead.add(uid); c.lostCamo += 1; }
  }
  g.prev = now;
}
if (squad) M.AI.DIALS.hook = (x) => { if (sqGame) (sqGame.dials[`${x.seat}:${x.round}`] ??= []).push(x); };
const MELEE_FIRING = '\u8fd1\u6218\u5c04\u51fb';
function squadGame(t, subject) {
  const blade = new Set(), gunner = new Set();
  for (const x of t.state.tokens) {
    if (x.kind !== 'mech') continue;
    let bl = 0, gun = 0, plain = false;
    for (const id of Object.values(x.mech ?? {})) {
      for (const a of data.byId.get(String(id))?.actions ?? []) {
        const v = 2 * (a.redDice ?? 0) + (a.yellowDice ?? 0);
        if (a.type === 'Melee') bl = Math.max(bl, v);
        else if (a.type === 'Firing') {
          gun = Math.max(gun, v);
          if (!(a.keywords ?? []).some((k) => (k.inline ?? k.key) === MELEE_FIRING)) plain = true;
        }
      }
    }
    if (bl > 0 && bl >= gun) blade.add(x.uid);
    if (plain) gunner.add(x.uid);
  }
  return { dials: {}, started: new Set(), lostNow: [], attacked: new Set(), struck: {}, pre: null, lastPhase: -1, blade, gunner, subject };
}
const liveOf = (st) => st.tokens.filter((x) => x.deployed !== false && x.kind !== 'projectile' && (x.kind === 'mech' ? x.partStates.torso !== 'destroyed' : x.partStates.main !== 'destroyed'));
const gridOf = (x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });
// The board before an answer: who is alive, and which Ground Mechs stand beside an enemy Mech that Locks them.
function squadSnap(st) {
  const live = liveOf(st);
  const alive = new Set(live.map((x) => x.uid));
  const locked = new Set();
  for (const x of live) {
    if (x.kind !== 'mech' || x.aerial) continue;
    const g = gridOf(x);
    if (live.some((y) => y.side !== x.side && y.kind === 'mech' && !(y.statuses ?? []).includes('camouflage') && Math.abs(gridOf(y).c - g.c) <= 1 && Math.abs(gridOf(y).r - g.r) <= 1)) locked.add(x.uid);
  }
  return { alive, locked };
}
function squadStep(t, r) {
  const st = t.state;
  const kind = r.decision?.kind;
  const u = r.decision?.unit;
  if ((kind === 'opp.act' || kind === 'activation.act') && typeof u === 'number') {
    const k = `${st.round.n}:${u}`;
    if (!sqGame.started.has(k)) {
      sqGame.started.add(k);
      const me = st.tokens.find((x) => x.uid === u);
      if (me?.kind === 'mech') {
        const plan = (sqGame.dials[`${me.side}:${st.round.n}`] ?? []).find((x) => x.uid === u);
        const own = squad[me.side === sqGame.subject ? 'subject' : 'foe'];
        const locker = squad[me.side === sqGame.subject ? 'foe' : 'subject'];
        if (plan && plan.target !== null) {
          own.planned += 1;
          if (sqGame.pre && !sqGame.pre.alive.has(plan.target)) { own.lost += 1; sqGame.lostNow.push(k); }
        }
        if (sqGame.gunner.has(u) && sqGame.pre) { locker.gunActs += 1; if (sqGame.pre.locked.has(u)) locker.gunLocked += 1; }
      }
    }
    const tag = r.option?.tags?.[0];
    if (tag === 'attack' || tag === 'launch') sqGame.attacked.add(k);
    const aid = String(r.option?.facts?.actionId ?? '');
    if (tag === 'attack' && sqGame.blade.has(u)) {
      const act = data.byId.get(aid.split('_')[0])?.actions?.find((a) => a.id === aid);
      if (act?.type === 'Melee' || aid.startsWith('COMMON_PUNCH')) (sqGame.struck[st.round.n] ??= new Set()).add(u);
    }
  }
  if (sqGame.lastPhase === 2 && st.round.phase !== 2) squadRound(st, st.round.n);
  sqGame.lastPhase = st.round.phase;
  sqGame.pre = squadSnap(st);
}
function squadRound(st, n) {
  for (const seat of ['s1', 's2']) {
    const sq = squad[seat === sqGame.subject ? 'subject' : 'foe'];
    sq.squadRounds += 1;
    const dials = (sqGame.dials[`${seat}:${n}`] ?? []).filter((x) => x.target !== null);
    const per = {};
    for (const x of dials) per[x.target] = (per[x.target] ?? 0) + 1;
    if (dials.length >= 2) { sq.dialled += 1; if (Object.values(per).some((v) => v >= 2)) sq.sameTarget += 1; }
    for (const k of sqGame.lostNow) {
      const [rn, uid] = k.split(':').map(Number);
      if (rn === n && st.tokens.find((x) => x.uid === uid)?.side === seat && !sqGame.attacked.has(k)) sq.lostIdle += 1;
    }
    const mine = (uid) => st.tokens.find((x) => x.uid === uid)?.side === seat;
    const struck = [...(sqGame.struck[n] ?? [])].filter(mine);
    const standing = st.tokens.filter((x) => x.side === seat && sqGame.blade.has(x.uid) && x.partStates.torso !== 'destroyed').map((x) => x.uid);
    const blades = new Set([...standing, ...struck]);
    if (blades.size >= 2 && struck.length >= 1) {
      sq.bladeRounds += 1;
      if (struck.length === 1) sq.bladeAlone += 1; else sq.bladeTogether += 1;
    }
    const view = M.SEAT.viewOf(data, st, seat);
    const zones = view.zones.filter((z) => z.scoring);
    if (zones.length >= 2) {
      sq.zoneRounds += 1;
      const own = view.units.filter((x) => x.side === seat && x.alive && x.deployed && x.kind !== 'projectile');
      const counts = zones.map((z) => own.filter((x) => z.cells.includes(`${x.grid.col},${x.grid.row}`)).length);
      if (Math.max(...counts) >= 2 && Math.min(...counts) === 0) sq.crowded += 1;
    }
  }
  sqGame.lostNow = sqGame.lostNow.filter((k) => Number(k.split(':')[0]) !== n);
}
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const t0 = performance.now();
for (let seed = from; seed <= to; seed++) {
  // PROBE_UNTIL=<epoch ms>: no game begun after it (a night's run stops between games, and every game played is whole).
  if (process.env.PROBE_UNTIL && Date.now() > Number(process.env.PROBE_UNTIL)) break;
  if (ENDSEEDS && !ENDSEEDS.has(seed)) continue;
  tieSeed = seed;
  const rng = new M.AI.Rng(`${seed}:squads`);
  const scenario = {
    id: `probe-${seed}`, map: rng.pick(MAPS), mission: rng.pick(MISSIONS), rounds: 5, secondaries, tactics: false,
    seats: { s1: `probe-s1`, s2: `probe-s2` },
  };
  data.solo.squads['probe-s1'] = COMMUNITY ? rng.pick(COMMUNITY) : squadOf(rng, budget);
  data.solo.squads['probe-s2'] = COMMUNITY ? rng.pick(COMMUNITY) : squadOf(rng, budget);
  if (FIXED) data.solo.squads[(process.env.SWAP ? seed % 2 === 0 : seed % 2 === 1) ? 'probe-s1' : 'probe-s2'] = FIXED;
  if (SUBJECTS) data.solo.squads[(process.env.SWAP ? seed % 2 === 0 : seed % 2 === 1) ? 'probe-s1' : 'probe-s2'] = SUBJECTS[seed % SUBJECTS.length];
  // DUMP=1: the game's table and both squads as JSON (to stage it in a test).
  if (process.env.DUMP) console.log(`DUMP ${JSON.stringify({ scenario, s1: data.solo.squads['probe-s1'], s2: data.solo.squads['probe-s2'] })}`);
  // DUMPONLY=1: the squads only, no game (to find a seed whose squads carry a card).
  if (process.env.DUMPONLY) continue;
  let end;
  let t;
  let open = null;
  let worthAtStart = new Map();
  // SWAP=1 seats the subject where it would not be (the same seeds played again the other way round).
  const parity = seed % 2 ? 's1' : 's2';
  const subjectSeat = process.env.SWAP ? (parity === 's1' ? 's2' : 's1') : parity;
  let policyNow = policy;
  let foeNow = foe;
  // FACTORIAL=<name>=<value>,... (M14: many levers measured at once). For each seed each lever is drawn on
  // or off (`fx`, from the seed); the subject plays with the levers drawn on and the opponent with the
  // others (a foldover: every game sets one half against the other), so one run reads every lever's worth
  // (`factorial.py`). The game's line carries the draw.
  let fx = '';
  if (FACT) {
    const draw = new M.AI.Rng(`${seed}:factorial`);
    const on = FACT.map(() => draw.next() < 0.5);
    fx = on.map((b) => (b ? '1' : '0')).join('');
    // A lever named `+<skill>` is a skill turned on (2026-10-06, the melee screen); the rest are weights.
    const pick = (want) => Object.fromEntries(FACT.filter(([k], i) => on[i] === want && !k.startsWith('+')));
    const skills = (want) => Object.fromEntries(FACT.filter(([k], i) => on[i] === want && k.startsWith('+')).map(([k]) => [k.slice(1), true]));
    policyNow = M.AI.makeTactician(skills(true), pick(true));
    foeNow = M.AI.makeTactician(skills(false), pick(false));
  }
  // LAUNCHDIAG=<label part>: at the first questions (LAUNCHN, default 2) offering launches whose label holds it, each
  // such launch's reach (`strike`), what the engine says its own turn would offer (`later`), and the plans that use it.
  if (process.env.LAUNCHDIAG) {
    let left = Number(process.env.LAUNCHN ?? 2);
    const diag = (inner) => (inner ? { ...inner, ponder: undefined, choose(d, view, rng) {
      const ls = d.options.filter((o) => o.tags.includes('launch') && String(o.label).includes(process.env.LAUNCHDIAG));
      if (left > 0 && ls.length && (d.kind === 'opp.act' || d.kind === 'activation.act')) {
        left -= 1;
        const foes = view.units.filter((u) => u.side !== view.seat && u.alive && u.deployed && u.kind !== 'projectile');
        console.log(`       LAUNCH r${view.round} ${view.seat} ${ls.length} launches; enemies at ${foes.map((f) => `${f.label}@${f.grid.col},${f.grid.row}`).join(' ')}`);
        for (const o of ls.slice(0, 3)) {
          const turn = o.later?.(['attack', 'unfold']);
          console.log(`         ${o.label} | strike ${o.facts?.strike} | later: ${turn ? `${turn.kind} ${turn.options.length} [${turn.options.slice(0, 4).map((x) => x.label).join(' / ')}]` : 'none'}`.slice(0, 300));
        }
        const rows = M.AI.weighed(d, view).filter((r) => String(r.does).includes(process.env.LAUNCHDIAG) || String(r.label).includes(process.env.LAUNCHDIAG));
        console.log(`         plans using it: ${rows.length}${rows[0] ? ` (best ${rows[0].worth.toFixed(2)}: ${rows[0].does})` : ''}`);
      }
      return inner.choose(d, view, rng);
    } } : inner);
    policyNow = diag(policyNow);
    foeNow = diag(foeNow);
  }
  // WEIGH=<round>:<label part>: at the first Opportunity question of that round whose answers name the unit,
  // every plan the Tactician weighed for it, with its terms (why a planned shot was not taken).
  if (process.env.WEIGH) {
    const [wr, wpart, wnth = '1'] = process.env.WEIGH.split(':');
    let shown = false;
    let met = 0;
    // WEIGHAFTER=<label part>: the question asked right after an answer whose label holds it, instead.
    let armed = !process.env.WEIGHAFTER;
    const watch = (inner) => (inner ? { ...inner, ponder: undefined, choose(d, view, rng) {
      if (!shown && armed && d.kind === (process.env.WEIGHKIND ?? 'opp.act') && view.round === Number(wr) && d.options.some((o) => String(o.label).includes(wpart)) && ++met === Number(wnth)) {
        shown = true;
        const g = (x) => `${String.fromCharCode(65 + x.col)}${x.row + 1}`;
        console.log(`       WEIGH r${view.round} ${view.seat} ${d.options.length} options`);
        // DIAGOPT=<label part>: each enemy Mech's attacks on the unit, on the table the named answer leaves and on
        // the table as it stands (two readings of one place that should agree).
        if (process.env.DIAGOPT) {
          const me = view.units.find((u) => u.uid === d.unit);
          const o = d.options.find((x) => String(x.label).includes(process.env.DIAGOPT));
          for (const [name, out] of [['after ' + (o?.label ?? '-').slice(0, 40), o?.after?.()], ['here', d.here?.()]]) {
            if (!out) { console.log(`         DIAG ${name}: no table`); continue; }
            for (const e of view.units.filter((u) => u.side !== view.seat && u.alive && u.deployed)) {
              const turn = out.turnOf(e.uid, [`strike:${me.uid}`], e.timing ?? undefined);
              const shots = (turn?.options ?? []).filter((x) => x.run?.routine === 'attack' && x.facts?.targetUid === me.uid);
              console.log(`         DIAG ${name}: ${e.label} (${e.timing ?? '-'}) ${shots.length} shots ${shots.slice(0, 3).map((x) => x.label).join(' / ')}`.slice(0, 260));
              if (e.kind === 'mech') {
                const mv = out.turnOf(e.uid, ['move'], 'movement')?.options ?? [];
                const seenBy = out.seen(me.uid, [me.grid], mv.filter((m) => m.facts?.to).slice(0, 40).map((m) => ({ col: m.facts.to.c, row: m.facts.to.r })))[0] ?? [];
                console.log(`         DIAG ${name}: ${e.label} moves on Movement ${mv.length} (${mv.filter((m) => m.later).length} with a later), of the first 40 seen from the unit ${seenBy.length}`);
                const steps = out.turnOf(e.uid, [`reach:${me.uid}`], e.timing ?? undefined)?.options ?? [];
                let after = 0; const seen = [];
                for (const st of steps) { const sh = (st.then?.([`strike:${me.uid}`])?.options ?? []).filter((x) => x.run?.routine === 'attack' && x.facts?.targetUid === me.uid); if (sh.length) { after += 1; if (seen.length < 2) seen.push(`${st.label} -> ${sh[0].label} ${Math.round((sh[0].chance?.()?.pen ?? 0) * 100)}%`); } }
                console.log(`         DIAG ${name}: ${e.label} reach steps ${steps.length}, with a shot after ${after}: ${seen.join(' / ')}`.slice(0, 300));
              }
            }
          }
        }
        globalThis.__dbgClose = !!process.env.DBGCLOSE;
        for (const r of M.AI.weighed(d, view, JSON.parse(process.env.WEIGHS ?? "{}"), JSON.parse(process.env.WEIGHW ?? "{}")).slice(0, 14)) console.log(`         ${r.priced ? ' ' : '?'} ${r.worth.toFixed(2).padStart(6)} now ${r.now.toFixed(2)} next ${r.next.toFixed(2)} shape ${r.shape.toFixed(2)} cost ${r.cost.toFixed(2)} risk ${r.risk.toFixed(2)} ${r.how} ${g(r.at)} | ${r.label.slice(0, 60)}${r.does ? ` | ${r.does.slice(0, 50)}` : ''}`);
      }
      const pick = inner.choose(d, view, rng);
      if (process.env.WEIGHAFTER && !armed && view.round === Number(wr) && String(d.options.find((o) => o.id === pick.option)?.label ?? '').includes(process.env.WEIGHAFTER)) armed = true;
      return pick;
    } } : inner);
    policyNow = watch(policyNow);
    foeNow = watch(foeNow);
  }
  // CMDLOG=<label part> (M22, 2026-10-12, the Command-only Drones): at every Command Phase question of either seat that
  // offers a Command to a Drone whose label holds it, each Drone's best plans with a Command (the default switches),
  // their terms, and the answer given. The choices are untouched.
  if (process.env.CMDLOG) {
    const part = process.env.CMDLOG;
    const cmdWatch = (inner) => (inner ? { ...inner, ponder: undefined, choose(d, view, rng) {
      const pick = inner.choose(d, view, rng);
      if (d.kind === 'loop.designate.command' && d.options.some((o) => String(o.label).includes(part))) {
        const g = (x) => (x ? `${String.fromCharCode(65 + x.col)}${x.row + 1}` : '?');
        console.log(`       CMD r${view.round} ${view.seat} -> ${d.options.find((o) => o.id === pick.option)?.label ?? pick.option} | ${String(pick.why ?? '').slice(0, 80)}`);
        for (const o of d.options.filter((x) => x.tags.includes('designate'))) {
          const turn = o.then?.();
          const rows = turn ? M.AI.weighed(turn, view, JSON.parse(process.env.WEIGHS ?? '{}'), JSON.parse(process.env.WEIGHW ?? '{}')).slice(0, 3) : [];
          console.log(`         ${o.label.slice(0, 50)}: ${rows.map((r) => `${r.worth.toFixed(2)} ${r.how} ${g(r.at)} [now ${r.now.toFixed(2)} next ${r.next.toFixed(2)} mis ${r.mission.toFixed(2)} shape ${r.shape.toFixed(2)}]`).join(' | ')}`.slice(0, 400));
        }
      }
      return pick;
    } } : inner);
    policyNow = cmdWatch(policyNow);
    foeNow = cmdWatch(foeNow);
  }
  // SECRANDOM=1 (2026-10-09, the data nights with Secondary Tasks; argv[6] 1): each seat takes its Secondary Task by
  // lot, from the game's own seed and the seat, so every card is played by every kind of squad (the learned judge
  // learns them all); what a card names is still the seat's own policy's choice.
  if (secondaries && process.env.SECRANDOM) {
    const lot = (inner) => inner && {
      name: inner.name,
      choose(d, view, rng) {
        if (d.kind !== 'setup.secondary') return inner.choose(d, view, rng);
        const r = new M.AI.Rng(`${seed}:secondary:${view.seat}`);
        return { option: d.options[Math.floor(r.next() * d.options.length)].id, reason: 'secondary_by_lot', why: 'by lot' };
      },
    };
    policyNow = lot(policyNow);
    foeNow = lot(foeNow);
  }
  if (process.env.LINES) {
    linesGame = { s1: [0, 0, 0, 0], s2: [0, 0, 0, 0] };
    policyNow = linesWatch(policyNow);
    if (foeNow) foeNow = linesWatch(foeNow);
  }
  if (process.env.LOSSLOG) lossGame = { s1: {}, s2: {}, standing: null, by: null, pts: new Map(), projSeen: new Map(), projHit: new Set() };
  if (process.env.BLINDSPOTS) {
    blindGame = { seed, subjectSeat, s1: blindFresh(), s2: blindFresh() };
    policyNow = blindWatch(policyNow);
    if (foeNow) foeNow = blindWatch(foeNow);
  }
  if (process.env.DODGES) {
    dodgeGame = { s1: 0, s2: 0 };
    policyNow = dodgeWatch(policyNow);
    if (foeNow) foeNow = dodgeWatch(foeNow);
  }
  if (process.env.DRONESHOTS) {
    dshotGame = { s1: { acts: new Set(), shots: new Set() }, s2: { acts: new Set(), shots: new Set() } };
    policyNow = dshotWatch(policyNow);
    if (foeNow) foeNow = dshotWatch(foeNow);
  }
  // THINKLOG=<file> (2026-10-11, the code audit): each answer's thinking time, one line a question (seed, who, seat,
  // the question's kind, its options, ms), the choices untouched.
  if (process.env.THINKLOG) {
    const timed = (p, who) => ({
      ...p,
      ponder: undefined,
      choose(d, view, rng) {
        const t0 = performance.now();
        const c = p.choose(d, view, rng);
        appendFileSync(process.env.THINKLOG, `${seed}\t${who}\t${view.seat}\t${d.kind}\t${d.options.length}\t${(performance.now() - t0).toFixed(2)}\n`);
        return c;
      },
    });
    policyNow = timed(policyNow, 'subject');
    if (foeNow) foeNow = timed(foeNow, 'foe');
  }
  try {
    t = botTable(M, data, scenario, { seed, policies: foeNow ? { [subjectSeat]: policyNow, [subjectSeat === 's1' ? 's2' : 's1']: foeNow } : policyNow, glue });
    tieTable = t;
    if (squad) sqGame = squadGame(t, subjectSeat);
    if (process.env.LANELOG) laneGame = { round: 0, rows: [] };
    if (process.env.SUPPORTLOG) supportGame = { opps: new Map(), mechs: new Set(t.state.tokens.filter((x) => x.side === subjectSeat && x.kind === 'mech' && Object.values(x.mech ?? {}).some((id) => id === '009' || id === '018')).map((x) => x.uid)) };
    if (process.env.CAMOLOG) { camoGame = { prev: new Set(), ever: new Set(), dead: new Set(), round: 0, started: false }; (tally.camo ??= { games: 0, camoUnits: 0, camoRounds: 0, hiddenRounds: 0, deployHidden: 0, cloaks: 0, silent: 0, shownBy: {}, found: 0, reveals: 0, revealStay: 0, revealHop: 0, hunted: 0, lostHidden: 0, lostCamo: 0 }).games += 1; }
    globalThis.__t = t;
    // Each unit's points as the table is set, so the game's line can say what each side lost (` lost <s1>/<s2>`).
    worthAtStart = new Map(t.state.tokens.filter((x) => x.kind !== 'projectile').map((x) => [x.uid, { side: x.side, pts: M.U.squadPoints(data, [x], x.side) }]));
    if (lossGame) lossGame.pts = worthAtStart;
    // TACTICS=1: both squads hold all six Tactics Cards (M8.2q).
    if (process.env.TACTICS) {
      t.state.tactics = { s1: ['274', '275', '276', '277', '278', '279'], s2: ['274', '275', '276', '277', '278', '279'] };
      t.watch((cmd) => { if (cmd.kind === 'playTactic') bump((tally.cards ??= {}), cmd.cardId); });
    }
    if (t.refused.length) end = { kind: 'setup-refused', why: `${t.refused[0].kind}: ${t.refused[0].why}` };
    else {
      // TRACE=1: each refused command as it happens, with the last answers of both seats.
      let traced = 0;
      // BOXLOG=1: each Black Box at each round's start and the Box-minded answers of both seats.
      let roundSeen = 0;
      // DIALCHECK=1: the dials of this game set for an attack, by seat and unit.
      let dialPlans = null;
      // MODEFLAP=1: the Mode changes of each activation.
      let modeSeen = null;
      // DITHER=1: each activation's Grids and Stances, and where each unit was last seen.
      let ditherSeen = null;
      let ditherPos = null;
      // SHUTDOWN=1: the Mechs seen in Shutdown Stance.
      let shutSeen = null;
      // MELEELOG=1 (2026-10-06, the melee plan): the subject's melee Mechs (the strongest blade at least the strongest
      // gun, a red die two yellow): the round of each one's first Melee attack, its Melee attacks, whether it was
      // destroyed before it made one, and at each round's Action Phase the Grids to the nearest enemy.
      let melee = null;
      let meleeRound = 0;
      const meleeKind = (actionId) => { const card = data.byId.get(String(actionId).split('_')[0]); return card?.actions?.find((a) => a.id === actionId)?.type ?? null; };
      const boxLog = (why) => {
        const items = M.TK.normaliseTasks(t.state.tasks).items.filter((i) => i.kind === 'blackbox');
        const at = (i) => { const b = i.bearerUid !== undefined ? t.state.tokens.find((x) => x.uid === i.bearerUid) : null; return b ? `${b.side}:${b.label}@${Math.floor(b.col / 3)},${Math.floor(b.row / 3)}${b.kind === 'mech' ? '' : `(${b.kind})`}` : `loose@${Math.floor((i.col ?? -3) / 3)},${Math.floor((i.row ?? -3) / 3)}`; };
        const alive = (side) => { const v = M.SEAT.viewOf(data, t.state, side); return t.state.tokens.filter((x) => x.side === side && x.kind !== 'projectile' && (x.kind === 'mech' ? x.partStates.torso !== 'destroyed' : x.partStates.main !== 'destroyed') && x.deployed !== false).map((x) => `${x.label}@${Math.floor(x.col / 3)},${Math.floor(x.row / 3)} h${v.units.find((u) => u.uid === x.uid)?.hands ?? '?'}`).join(' '); };
        console.log(`     ${why} r${t.state.round.n} boxes: ${items.map(at).join(' | ')}\n        s1: ${alive('s1')}\n        s2: ${alive('s2')}`);
      };
      if (process.env.ENDOPEN) {
        const pre = await t.run({ until: (st) => st.round.n >= (Number(process.env.ENDOPEN_ROUND) || scenario.rounds) && st.round.phase === 1, maxSteps: 12000 });
        if (pre.kind === 'paused') {
          open = await endOpen(t, scenario, seed, subjectSeat, Number(process.env.ENDOPEN));
          if (open.p !== null) {
            const o = (tally.open ??= { games: 0, sum: 0, decided: 0, leaning: 0, open: 0 });
            o.games += 1; o.sum += open.p;
            if (open.p <= 0.1 || open.p >= 0.9) o.decided += 1; else if (open.p <= 0.25 || open.p >= 0.75) o.leaning += 1; else o.open += 1;
          }
        }
      }
      let stopped = null;
      if (process.env.ENDCHOICES) {
        const [K, R] = process.env.ENDCHOICES.split(':').map(Number);
        const pre = await t.run({ until: (st) => st.round.n >= scenario.rounds && st.round.phase === 1, maxSteps: 12000 });
        if (pre.kind === 'paused') {
          let lastUnit = null;
          for (let i = 0; i < 6000 && !stopped; i++) {
            const d = t.drivers[subjectSeat].pending();
            if (d && /^(opp|activation)\.act$/.test(d.kind) && d.unit !== lastUnit) {
              lastUnit = d.unit;
              const rows = await endChoices(t, scenario, seed, subjectSeat, d, K, R);
              const who = t.state.tokens.find((x) => x.uid === d.unit)?.label ?? d.unit;
              if (rows) console.log(`E1 ${seed} r${t.state.round.n} ${who}: ${rows.map((x) => `${x.chosen ? '*' : ''}${String(x.label).slice(0, 60)} ${x.p === null ? '-' : x.p.toFixed(2)}/${x.n}`).join(' | ')}`);
            }
            stopped = await t.step();
          }
        } else stopped = pre;
      }
      end = stopped ?? await t.run({ maxSteps: 12000, onStep: (process.env.CARDLOG || process.env.TRACE || process.env.BOXLOG || process.env.CARDOFFERS || process.env.ABILITIES || process.env.TAGS || process.env.COVERLOG || process.env.DECISIONS || process.env.DIALCHECK || process.env.ENDSHOT || process.env.MODEFLAP || process.env.PARTS || process.env.DITHER || process.env.SHUTDOWN || process.env.MELEELOG || process.env.SQUADLOG || process.env.POSITIONS || process.env.CAMOLOG || process.env.LANELOG || process.env.SUPPORTLOG || process.env.LOSSLOG) ? (seat, r) => {
        if (lossGame) lossStep(t, r);
        if (squad && sqGame) squadStep(t, r);
        if (process.env.CAMOLOG && camoGame) camoStep(t, seat, r, subjectSeat);
        if (process.env.LANELOG && laneGame) laneStep(t, subjectSeat);
        if (process.env.SUPPORTLOG && supportGame) supportStep(t, seat, r, subjectSeat);
        if (POSITIONS) positionStep(t, seed, data.missions.cards.find((c) => c.id === scenario.mission)?.family ?? '?');
        if (process.env.MELEELOG) {
          if (!melee) {
            melee = new Map();
            for (const x of t.state.tokens) {
              if (x.side !== subjectSeat || x.kind !== 'mech') continue;
              let blade = 0, gun = 0;
              for (const id of Object.values(x.mech ?? {})) {
                for (const a of data.byId.get(String(id))?.actions ?? []) {
                  const v = 2 * (a.redDice ?? 0) + (a.yellowDice ?? 0);
                  if (a.type === 'Melee') blade = Math.max(blade, v); else if (a.type === 'Firing') gun = Math.max(gun, v);
                }
              }
              if (blade > 0 && blade >= gun) melee.set(x.uid, { first: 0, strikes: 0, shots: 0, kinds: {} });
            }
          }
          if (t.state.round.phase === 2 && t.state.round.n !== meleeRound) {
            meleeRound = t.state.round.n;
            const grid = (x) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });
            const foes = t.state.tokens.filter((x) => x.side !== subjectSeat && x.kind !== 'projectile' && x.deployed !== false && (x.kind === 'mech' ? x.partStates.torso !== 'destroyed' : x.partStates.main !== 'destroyed')).map(grid);
            for (const uid of melee.keys()) {
              const me = t.state.tokens.find((x) => x.uid === uid);
              if (!me || me.partStates.torso === 'destroyed' || !foes.length) continue;
              const g = grid(me);
              const gap = Math.min(...foes.map((f) => Math.max(Math.abs(f.c - g.c), Math.abs(f.r - g.r))));
              const row = ((tally.melee ??= { mechs: 0, struck: 0, diedFirst: 0, firstSum: 0, strikes: 0, gap: {} }).gap[meleeRound] ??= { sum: 0, n: 0 });
              row.sum += gap; row.n += 1;
            }
          }
          const by = r.option?.facts?.uid ?? r.decision.unit;
          if (seat === subjectSeat && r.option?.tags?.[0] === 'attack' && melee.has(by) && meleeKind(r.option.facts?.actionId) === 'Firing') melee.get(by).shots += 1;
          // AT ITS DIAL: whether an enemy stood within its blade's reach on a Melee dial (its Maneuver, then
          // beside), and whether it dialled Melee then (`dialReach`, `dialReachMelee`).
          if (seat === subjectSeat && r.decision.kind === 'planning.dial' && melee.has(r.decision.unit)) {
            const v = M.SEAT.viewOf(data, t.state, seat);
            const me = v.units.find((u) => u.uid === r.decision.unit);
            const foes = v.units.filter((u) => u.side !== seat && u.alive && u.deployed && u.kind !== 'projectile' && !u.camouflaged);
            // A Maneuver steps orthogonally (rules.ts searchMoves) and a blade strikes a Grid beside it, diagonals
            // too (brawler.ts reaches): within reach where the gaps less one each sum to the Maneuver at most
            // (2026-10-06; the first form, Chebyshev within the Maneuver + 1, counted Grids it could not reach).
            const short = (f) => Math.max(0, Math.abs(f.grid.col - me.grid.col) - 1) + Math.max(0, Math.abs(f.grid.row - me.grid.row) - 1);
            if (me && foes.some((f) => short(f) <= me.maneuver)) {
              const ml = (tally.melee ??= { mechs: 0, struck: 0, diedFirst: 0, firstSum: 0, strikes: 0, gap: {} });
              ml.dialReach = (ml.dialReach ?? 0) + 1;
              if (String(r.option?.facts?.timing ?? r.option?.id ?? '').includes('melee')) ml.dialReachMelee = (ml.dialReachMelee ?? 0) + 1;
              const k = `reach:${r.option?.facts?.timing ?? r.option?.id ?? '?'}`;
              (ml.reachDials ??= {})[k] = (ml.reachDials[k] ?? 0) + 1;
            }
          }
          // What each of its answers in its own Opportunities was, by the answer's first tag.
          if (seat === subjectSeat && (r.decision.kind === 'opp.act' || r.decision.kind === 'planning.dial') && melee.has(r.decision.unit)) {
            const k = r.decision.kind === 'planning.dial' ? `dial:${r.option?.facts?.timing ?? r.option?.id ?? '?'}` : (r.option?.tags?.[0] ?? '?');
            const kinds = melee.get(r.decision.unit).kinds;
            kinds[k] = (kinds[k] ?? 0) + 1;
          }
          if (seat === subjectSeat && r.option?.tags?.[0] === 'attack' && melee.has(by) && meleeKind(r.option.facts?.actionId) === 'Melee') {
            const m = melee.get(by);
            m.strikes += 1;
            if (!m.first) m.first = t.state.round.n;
          }
        }
        // DECISIONS=1: every answer chosen from more than one, with its why (a random game read by eye).
        if (process.env.DECISIONS && r.decision.options.length > 1) {
          const e = t.drivers[seat].log.at(-1);
          console.log(`       ${seat} r${e?.round} [${r.decision.kind}] ${String(r.option?.label ?? '').slice(0, 100)}${e?.why ? ` | ${String(e.why).slice(0, 170)}` : ''}`);
        }
        // PARTS=<seat>:<round>: after each answer of that seat in that round, its Mechs' Parts and Modes.
        if (process.env.PARTS) {
          const [ps, pr] = process.env.PARTS.split(':');
          if (seat === ps && t.state.round.n === Number(pr) && (r.decision.kind === 'opp.act' || r.decision.kind === 'activation.act')) {
            for (const m of t.state.tokens.filter((x) => x.side === ps && x.kind === 'mech')) console.log(`       PARTS ${seat} r${pr} after "${String(r.option?.label).slice(0, 60)}": ${m.label} ${JSON.stringify(m.partStates)} ${JSON.stringify(m.mech)}`.slice(0, 400));
          }
        }
        // DITHER=1: each activation in which a unit came back to a Grid it had left, or changed its Stance twice
        // (`tally.dither`: activations with a move, those that came back; Stances changed, twice); printed.
        if (process.env.DITHER && (r.decision.kind === 'opp.act' || r.decision.kind === 'activation.act')) {
          const who = seat === subjectSeat ? 'subject' : 'foe';
          const k = `${seat}:${r.decision.unit}:${t.state.round.n}:${t.state.round.phase}`;
          const u = t.state.tokens.find((x) => x.uid === r.decision.unit);
          const row = ((tally.dither ??= {})[who] ??= { moved: 0, back: 0, stances: 0, stanceTwice: 0 });
          const seen = (ditherSeen ??= new Map());
          const was = seen.get(k) ?? { grids: [], stances: 0, back: false, moved: false };
          const at = (ditherPos ??= new Map());
          if (u) {
            const g = `${Math.floor(u.col / 3)},${Math.floor(u.row / 3)}`;
            // Where it began this activation: where it was last seen before it.
            if (!was.grids.length) was.grids.push(at.get(u.uid) ?? g);
            if (r.option?.tags?.includes('move')) {
              if (!was.moved) { was.moved = true; row.moved += 1; }
              if (was.grids.includes(g) && was.grids[was.grids.length - 1] !== g && !was.back) { was.back = true; row.back += 1; console.log(`       BACK ${seat} r${t.state.round.n} ${u.label} to ${g} after ${was.grids.join('>')} | ${String(r.option.label).slice(0, 80)}`); }
              was.grids.push(g);
            }
            if (r.option?.tags?.includes('stance')) {
              was.stances += 1;
              if (was.stances === 1) row.stances += 1;
              if (was.stances === 2) { row.stanceTwice += 1; console.log(`       STANCE TWICE ${seat} r${t.state.round.n} ${u.label} | ${String(r.option.label).slice(0, 80)}`); }
            }
          }
          seen.set(k, was);
        }
        if (process.env.DITHER) {
          const at = (ditherPos ??= new Map());
          for (const x of t.state.tokens) if (x.deployed !== false) at.set(x.uid, `${Math.floor(x.col / 3)},${Math.floor(x.row / 3)}`);
        }
        // SHUTDOWN=1: each Mech that goes into Shutdown Stance, by the seat's role, with the answer just given
        // (`tally.shutdown`); printed.
        if (process.env.SHUTDOWN) {
          const down = (shutSeen ??= new Set());
          for (const x of t.state.tokens) {
            if (x.kind !== 'mech' || x.stance !== 'shutdown' || down.has(x.uid)) continue;
            down.add(x.uid);
            const who = x.side === subjectSeat ? 'subject' : 'foe';
            ((tally.shutdown ??= {})[who] ??= { mechs: 0 }).mechs += 1;
            console.log(`       SHUTDOWN ${x.side} r${t.state.round.n} ${x.label} link ${x.link ?? '?'} after ${seat}: ${String(r.option?.label ?? r.decision.kind).slice(0, 90)}`);
          }
        }
        // MODEFLAP=1: each activation in which one unit changed its Mode (or a Bit its face) more than once, by
        // the seat's role (`tally.modeflap`: activations with a Mode change, those with two or more); printed.
        if (process.env.MODEFLAP && (r.decision.kind === 'opp.act' || r.decision.kind === 'activation.act')) {
          const who = seat === subjectSeat ? 'subject' : 'foe';
          const k = `${seat}:${r.decision.unit}:${t.state.round.n}:${t.state.round.phase}`;
          if (r.option?.tags?.includes('mode') || r.option?.tags?.includes('form')) {
            const n = ((modeSeen ??= new Map()).get(k) ?? 0) + 1;
            modeSeen.set(k, n);
            const row = ((tally.modeflap ??= {})[who] ??= { changed: 0, twice: 0 });
            if (n === 1) row.changed += 1;
            if (n === 2) { row.twice += 1; console.log(`       MODE TWICE ${seat} r${t.state.round.n} ${r.option.label}`.slice(0, 220)); }
          }
        }
        // ENDSHOT=1: each activation ended (or Opportunity) with an attack still on offer, by the seat's role
        // (`tally.endshot`: ended, ended with a shot on offer); ENDSHOW=1 prints each with the best shot's odds.
        if (process.env.ENDSHOT && (r.decision.kind === 'opp.act' || r.decision.kind === 'activation.act') && r.option?.tags?.includes('end')) {
          const who = seat === subjectSeat ? 'subject' : 'foe';
          const shots = r.decision.options.filter((o) => o.run?.routine === 'attack');
          const row = ((tally.endshot ??= {})[who] ??= { ended: 0, withShot: 0 });
          row.ended += 1;
          if (shots.length) {
            row.withShot += 1;
            if (process.env.ENDSHOW) {
              const e = t.drivers[seat].log.at(-1);
              const odds = shots.map((o) => ({ o, f: o.chance?.() })).filter((x) => x.f).sort((a, b) => (b.f.pen ?? 0) - (a.f.pen ?? 0))[0];
              console.log(`       END WITH SHOT ${seat} r${t.state.round.n} ${shots.length} on offer, best ${odds ? `${odds.o.label} (${Math.round((odds.f.pen ?? 0) * 100)}% pen, ${Math.round((odds.f.kill ?? 0) * 100)}% kill)` : shots[0].label} | ${String(e?.why ?? '').slice(0, 120)}`.slice(0, 330));
            }
          }
        }
        // DIALCHECK=1: each Timing Dial set for a plan that OPENS with an attack (no walk first), and whether that
        // attack is still on offer when the Mech's Opportunity comes (`tally.dialcheck`, by the seat's role;
        // DIALSHOW=1 prints each one lost).
        if (process.env.DIALCHECK) {
          const who = seat === subjectSeat ? 'subject' : 'foe';
          const e = t.drivers[seat].log.at(-1);
          if (r.decision.kind === 'planning.dial' && e?.why) {
            const m = /^it opens with (.+?); /.exec(String(e.why));
            if (m && / at /.test(m[1]) && !/: (Maneuver|Sprint|move|Charge)/.test(m[1])) (dialPlans ??= new Map()).set(`${seat}:${r.decision.unit}`, { label: m[1], round: t.state.round.n, who });
          }
          if ((r.decision.kind === 'opp.act') && dialPlans) {
            const p = dialPlans.get(`${seat}:${r.decision.unit}`);
            if (p && p.round === t.state.round.n && !p.checked) {
              p.checked = true;
              const kept = r.decision.options.some((o) => o.label === p.label);
              const taken = r.option?.label === p.label;
              const row = ((tally.dialcheck ??= {})[who] ??= { planned: 0, kept: 0, lost: 0, taken: 0 });
              row.planned += 1;
              row[kept ? 'kept' : 'lost'] += 1;
              if (taken) row.taken += 1;
              const e2 = t.drivers[seat].log.at(-1);
              if (!taken && process.env.DIALSHOW) console.log(`       DIAL ${kept ? 'NOT TAKEN' : 'LOST'} ${seat} r${p.round} ${p.label} | chose ${r.option?.label} | ${String(e2?.why ?? '').slice(0, 140)}`.slice(0, 340));
            }
          }
        }
        // COVERLOG=1 (2026-10-05 night; OTTO's W5: the Raven jamming through walls from out of the line of fire,
        // the missile Drones hiding behind full cover): each launch, jam or attack a DRONE of either seat makes, by
        // how many enemy units see the Grid it stands in as it makes it (`tally.cover`, by seat: 0, 1, 2 or more).
        if (process.env.COVERLOG) {
          const kind = r.option?.tags?.[0];
          const me = t.state.tokens.find((x) => x.uid === r.decision.unit);
          if (me?.kind === 'drone' && (kind === 'launch' || kind === 'electronic' || kind === 'attack')) {
            const at = { col: Math.floor(me.col / 3), row: Math.floor(me.row / 3) };
            const eyes = r.decision.here?.().seen(me.uid, [at])?.[0]?.length ?? 0;
            const who = seat === subjectSeat ? 'subject' : 'foe';
            const row = ((tally.cover ??= {})[`${who} ${kind}`] ??= { acts: 0, unseen: 0, one: 0, more: 0 });
            row.acts += 1;
            if (eyes === 0) row.unseen += 1; else if (eyes === 1) row.one += 1; else row.more += 1;
          }
        }
        // TAGS=<tag>,<tag> (M12): for each tag, the questions of each seat that offered an answer carrying it
        // and those whose answer carried it (`tally.tags`, by tag and seat).
        if (process.env.TAGS) {
          const who = seat === subjectSeat ? 'subject' : 'foe';
          for (const tag of process.env.TAGS.split(',')) {
            if (!r.decision.options.some((o) => o.tags.includes(tag))) continue;
            const row = ((tally.tags ??= {})[`${tag} ${who}`] ??= { offered: 0, chosen: 0 });
            row.offered += 1;
            if (r.option?.tags?.includes(tag)) row.chosen += 1;
          }
        }
        // ABILITIES=1 (M12, the ability census): for each Action of a card, the questions of the SUBJECT's seat
        // that offered it (counted once a question) and those whose answer was it (`tally.abilities`, by action
        // id: offered, chosen, and the kind of question); printed sorted at the end.
        if (process.env.ABILITIES && seat === subjectSeat) {
          const ab = (tally.abilities ??= {});
          const actionOf = (o) => (typeof o?.facts?.actionId === 'string' ? o.facts.actionId : o?.run?.args?.actionId ?? null);
          const offered = new Set(r.decision.options.map(actionOf).filter((x) => typeof x === 'string'));
          const chose = actionOf(r.option);
          for (const id of offered) {
            const row = (ab[id] ??= { offered: 0, chosen: 0, kinds: {} });
            row.offered += 1;
            row.kinds[r.decision.kind] = (row.kinds[r.decision.kind] ?? 0) + 1;
            if (chose === id) row.chosen += 1;
          }
        }
        // CARDOFFERS=1: for each card, the questions that offered it and those that played it, by the
        // subject's seat and the other's; for System Repair (277) the Tokens its targets carried, offered
        // and played (`tally.offers`).
        if (process.env.CARDOFFERS) {
          const who = seat === subjectSeat ? 'subject' : 'foe';
          const offers = (tally.offers ??= {});
          const cards = new Set(r.decision.options.filter((o) => o.tags.includes('tactic')).map((o) => String(o.facts?.cardId)));
          for (const id of cards) {
            const row = (offers[`${id} ${who}`] ??= { offered: 0, played: 0 });
            row.offered += 1;
            if (r.option?.tags?.includes('tactic') && String(r.option.facts?.cardId) === id) row.played += 1;
          }
          if (cards.has('277')) {
            const view = M.SEAT.viewOf(data, t.state, seat);
            const marks = (uid) => (view.units.find((u) => u.uid === uid)?.statuses ?? []).join('+') || '(none)';
            for (const o of r.decision.options.filter((x) => String(x.facts?.cardId) === '277')) bump((tally.repair ??= {}), `${who} offered ${marks(o.facts.uid)}`);
            // (Played, the Token is gone from the table already: the answer's label names it.)
            if (String(r.option?.facts?.cardId) === '277') bump(tally.repair, `${who} PLAYED ${String(r.option.label).split(', ').slice(1).join(', ')}${r.option.facts.uid === r.decision.unit ? ' (itself)' : ''}`);
            // CARDWHY=1: each Fire Control Interference that could have been repaired, and what was done instead.
            if (process.env.CARDWHY) {
              for (const o of r.decision.options.filter((x) => String(x.facts?.cardId) === '277' && /fci/.test(marks(x.facts.uid)))) {
                const u = view.units.find((x) => x.uid === o.facts.uid);
                const actor = view.units.find((x) => x.uid === r.decision.unit);
                console.log(`       277? r${view.round} ${seat} ${r.decision.kind} acting ${actor?.label ?? '?'} | on ${u?.label} (${u?.kind}${u?.uid === actor?.uid ? ', itself' : ''}, ${u?.done ? 'done' : 'to act'}, dial ${u?.timing ?? '-'}, ${marks(o.facts.uid)}) | chose ${r.option?.label ?? r.option?.id}`.slice(0, 320));
              }
            }
          }
        }
        if (process.env.BOXLOG) {
          if (t.state.round.n !== roundSeen && t.state.round.phase >= 2) { roundSeen = t.state.round.n; boxLog('start of the Action Phase'); }
          const e = t.drivers[seat].log.at(-1);
          if (e && /opp\.act|activation\.act/.test(e.kind) && /box|Box|fetch|carr/.test(`${e.label} ${e.why ?? ''} ${e.reason ?? ''}`)) console.log(`       ${seat} r${e.round} ${e.label} [${e.reason ?? ''}] ${e.why ?? ''}`.slice(0, 280));
        }
        if (process.env.TRACE && t.refused.length > traced) {
          for (const x of t.refused.slice(traced)) {
            console.log(`       REFUSED ${x.seat} ${x.kind}: ${x.why} ${JSON.stringify(x.cmd ?? {}).slice(0, 260)}`);
            for (const s of ['s1', 's2']) for (const e of t.drivers[s].log.slice(-3)) console.log(`         ${s} r${e.round} [${e.kind}] ${e.label} (${e.reason}) ${e.why ?? ''}`.slice(0, 260));
          }
          traced = t.refused.length;
        }
        if (!process.env.CARDLOG || !r.option?.tags?.includes('tactic')) return;
        const e = t.drivers[seat].log.at(-1);
        console.log(`       ${seat} r${e?.round} ${r.decision.kind}: ${r.option.label} [${e?.reason ?? ''}] ${e?.why ?? ''}`.slice(0, 300));
      } : undefined });
      if (process.env.MELEELOG && melee) {
        const ml = (tally.melee ??= { mechs: 0, struck: 0, diedFirst: 0, firstSum: 0, strikes: 0, gap: {} });
        for (const [uid, m] of melee) {
          const me = t.state.tokens.find((x) => x.uid === uid);
          const dead = !me || me.partStates.torso === 'destroyed';
          ml.mechs += 1;
          ml.strikes += m.strikes;
          ml.shots = (ml.shots ?? 0) + m.shots;
          for (const [k, v] of Object.entries(m.kinds)) (ml.kinds ??= {})[k] = (ml.kinds[k] ?? 0) + v;
          if (m.first) { ml.struck += 1; ml.firstSum += m.first; } else if (dead) ml.diedFirst += 1;
        }
      }
      // STALLDUMP=<prefix>: a game that does not end as a game should leaves its table in <prefix>-<seed>.json.
      if (process.env.STALLDUMP && end.kind !== 'over') writeFileSync(`${process.env.STALLDUMP}-${seed}.json`, JSON.stringify(t.state));
      // SLOW=1: each game's three slowest decisions of each seat, and how many took over a second; the tally
      // keeps every decision's time in buckets.
      if (process.env.SLOW) {
        for (const s of ['s1', 's2']) {
          const log = t.drivers[s].log;
          const top = [...log].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, 3);
          console.log(`       ${s} ${log.length} decisions, ${log.filter((e) => (e.ms ?? 0) > 1000).length} over 1 s; slowest: ${top.map((e) => `${e.ms} ms r${e.round} [${e.kind}] ${String(e.label).slice(0, 60)}`).join(' | ')}`);
          const b = (tally.slow ??= { under100: 0, under500: 0, under1000: 0, under3000: 0, over3000: 0, max: 0 });
          for (const e of log) {
            const ms = e.ms ?? 0;
            b.max = Math.max(b.max, ms);
            if (ms < 100) b.under100 += 1; else if (ms < 500) b.under500 += 1; else if (ms < 1000) b.under1000 += 1; else if (ms < 3000) b.under3000 += 1; else b.over3000 += 1;
          }
        }
      }
    }
  } catch (err) {
    end = { kind: 'threw', why: `${err?.message ?? err}`.split('\n')[0] };
    if (process.env.STACK) console.log(err?.stack);
  } finally {
    t?.close();
  }
  tally.games += 1;
  const kind = end.kind === 'over' && t?.refused.length ? 'over-with-refusals' : end.kind;
  bump(tally.ends, kind);
  if (end.kind === 'over') tally.over += 1;
  else {
    const why = `${end.kind}: ${(end.decision ? `[${end.decision}] ` : '') + String(end.why ?? '').replace(/\d+/g, 'N').slice(0, 140)}`;
    bump(tally.why, why);
  }
  for (const r of t?.refused ?? []) bump(tally.kinds, `${r.kind}: ${String(r.why).replace(/\d+/g, 'N').slice(0, 110)}`);
  // What the Main Task paid, by its family: a mission the seats cannot play pays nothing.
  const vpNow = t ? M.TK.normaliseTasks(t.state.tasks).vp : { s1: 0, s2: 0 };
  if (POSITIONS && t) positionsEnd(t, end);
  if (process.env.LANELOG && t) laneEnd(end.kind === 'over' ? end.result.winner : undefined);
  if (process.env.SUPPORTLOG && t) supportEnd();
  const family = data.missions.cards.find((c) => c.id === scenario.mission)?.family ?? '?';
  const fam = (tally.vp[family] ??= { games: 0, scored: 0, vp: 0 });
  fam.games += 1; fam.vp += vpNow.s1 + vpNow.s2; if (vpNow.s1 + vpNow.s2 > 0) fam.scored += 1;
  if (foeNow) {
    const foeSeat = subjectSeat === 's1' ? 's2' : 's1';
    const duel = (tally.duel ??= { subject: 0, foe: 0, level: 0, unfinished: 0, subjectVp: 0, foeVp: 0 });
    const won = end.kind === 'over' ? end.result.winner : undefined;
    if (end.kind !== 'over') duel.unfinished += 1; else if (won === subjectSeat) duel.subject += 1; else if (won === foeSeat) duel.foe += 1; else duel.level += 1;
    duel.subjectVp += vpNow[subjectSeat]; duel.foeVp += vpNow[foeSeat];
    const byFam = (tally.duelVp ??= {});
    const f2 = (byFam[family] ??= { games: 0, subject: 0, foe: 0, subjectVp: 0, foeVp: 0 });
    f2.games += 1; f2.subjectVp += vpNow[subjectSeat]; f2.foeVp += vpNow[foeSeat];
    if (won === subjectSeat) f2.subject += 1; else if (won === foeSeat) f2.foe += 1;
  }
  const openNote = open ? ` | open ${open.p === null ? '-' : open.p.toFixed(2)}/${open.n}` : '';
  // With Secondary Tasks: each seat's card and what it paid of what it could (` | sec s1 escort 3/3 s2 mercy 0/2`).
  const secs = secondaries && t ? M.SEAT.viewOf(data, t.state, 's1').secondary : null;
  const secNote = secs ? ` | sec ${['s1', 's2'].map((s) => (secs[s] ? `${s} ${secs[s].id} ${secs[s].paid}/${secs[s].vp}` : `${s} -`)).join(' ')}` : '';
  const sq = (k) => { const s = data.solo.squads[k]; return `${COMMUNITY ? `${s.name} ` : ''}${s.faction} ${s.points}p ${s.mechs.length}m+${s.drones.length}d`; };
  const last = t ? `r${t.state.round.n} ${M.TY.PHASES[t.state.round.phase]}` : '';
  const lost = { s1: 0, s2: 0 };
  for (const [uid, w] of worthAtStart) {
    const x = t?.state.tokens.find((y) => y.uid === uid);
    if (!x || (x.kind === 'mech' ? x.partStates.torso === 'destroyed' : x.partStates.main === 'destroyed')) lost[w.side] += w.pts;
  }
  console.log(`${String(seed).padStart(4)} ${foeNow ? `[subject ${subjectSeat}] ` : ''}${fx ? `[fx ${fx}] ` : ''}${scenario.map}/${scenario.mission} | ${sq('probe-s1')} v ${sq('probe-s2')} | ${kind}${end.kind === 'over' ? ` ${end.result.winner ?? 'level'} ${vpNow.s1}-${vpNow.s2} lost ${lost.s1}/${lost.s2}` : ` (${last}) ${(end.decision ? `[${end.decision}${end.option ? ` -> ${end.option}` : ''}] ` : '') + (end.why ?? '')}`}`.slice(0, 400) + openNote + secNote);
  if (blindGame) blindEnd(t?.state);
  if (lossGame) {
    if (t) lossStep(t, null);
    console.log(`  losses s1 ${JSON.stringify(lossGame.s1)} s2 ${JSON.stringify(lossGame.s2)}`);
    const proj = (side) => { const mine = [...lossGame.projSeen].filter(([, sd]) => sd === side).map(([uid]) => uid); return `${mine.filter((uid) => lossGame.projHit.has(uid)).length}/${mine.length}`; };
    console.log(`  projectiles struck/launched s1 ${proj('s1')} s2 ${proj('s2')}`);
  }
  if (dodgeGame) console.log(`  dodges s1 ${dodgeGame.s1} s2 ${dodgeGame.s2}`);
  if (dshotGame) console.log(`  droneshots s1 ${dshotGame.s1.shots.size}/${dshotGame.s1.acts.size} s2 ${dshotGame.s2.shots.size}/${dshotGame.s2.acts.size}`);
  if (linesGame) console.log(`  lines s1 ${linesGame.s1[0]}/${linesGame.s1[1]} s2 ${linesGame.s2[0]}/${linesGame.s2[1]} drones s1 ${linesGame.s1[2]}/${linesGame.s1[3]} s2 ${linesGame.s2[2]}/${linesGame.s2[3]}`);
  if (end.kind !== 'over' && t?.state.script) {
    // What the table is waiting on: every debt the script holds, the open activation, and the last commands.
    const sc = t.state.script;
    const o = sc.opp;
    const holder = o ? t.state.tokens.find((x) => x.uid === o.uid) : null;
    const debts = {
      ...(sc.intercepts?.length ? { intercepts: sc.intercepts } : {}),
      ...(sc.reactions?.length ? { reactions: sc.reactions.map((r) => ({ kind: r.kind ?? 'smoke', uid: r.uid, actionId: r.actionId })) } : {}),
      ...(sc.revealDue?.length ? { revealDue: sc.revealDue } : {}),
      ...(sc.swarm ? { swarm: sc.swarm } : {}),
      ...(sc.counter ? { counter: { stage: sc.counter.stage ?? null, initiator: sc.counter.initiatorUid ?? sc.counter.initiator ?? null } } : {}),
      ...(sc.smokeOwed?.length ? { smokeOwed: sc.smokeOwed.length } : {}),
      ...(sc.rollback ? { rollback: true } : {}),
      ...(sc.combatView ? { combatView: true } : {}),
      ...(o ? { opp: { unit: holder ? `${holder.side} ${holder.label} (${holder.kind} ${holder.cardId})` : o.uid, maneuver: o.maneuver, action: o.action, performed: o.performed, mineHalt: o.mineHalt ?? null } } : {}),
      turn: sc.turn, acted: sc.acted.length, passed: sc.passed, ready: t.state.ready ?? null,
    };
    const key = Object.keys(debts).filter((k) => !['turn', 'acted', 'passed', 'ready', 'opp'].includes(k)).join('+') || (o ? `opp of a ${holder?.kind ?? '?'}` : 'no debt, no opp');
    bump(tally.kinds, `waiting on: ${key}`);
    console.log(`       waiting on: ${JSON.stringify(debts)}`.slice(0, 900));
    console.log(`       last sent: ${t.sent.slice(-8).map((x) => `${x.seat}:${x.kind}${x.ok ? '' : '(refused)'}`).join(' ')}`);
    for (const seat of ['s1', 's2']) {
      const last = t.drivers[seat].log.at(-1);
      if (last) console.log(`       ${seat} last: [${last.kind}] ${last.label} ${last.why ? `(${last.why})` : ''}`.slice(0, 300));
    }
  }
  if (process.env.VERBOSE) {
    for (const k of ['probe-s1', 'probe-s2']) {
      const s = data.solo.squads[k];
      console.log(`       ${k}: ${s.mechs.map((m) => `[${Object.values(m.loadout).join(' ')}]`).join(' ')} ${s.drones.map((d) => d.cardId + (d.backpack ? `+${d.backpack}` : '')).join(' ')}`);
    }
  }
}
tally.ms = Math.round(performance.now() - t0);
// The ability census, the Actions offered most and chosen least first, with the card and the Action's name.
if (ties) {
  const rows = [...ties.values()].map((r) => ({ where: r.where, pair: r.pair, times: r.seen.size, example: r.example }))
    .sort((a, b) => b.times - a.times);
  writeFileSync(process.env.TIES, JSON.stringify(rows, null, 1));
  tally.ties = rows.reduce((n, r) => n + r.times, 0);
  for (const r of rows.slice(0, 25)) console.log(`  TIE ${r.where.padEnd(7)} ${String(r.times).padStart(5)}  ${r.pair}   e.g. ${r.example}`.slice(0, 260));
}
if (tally.support) {
  const S = tally.support;
  console.log(`  SUPPORT ${S.games} games, ${S.mechs} support Mechs, ${S.opps} Opportunities (${S.tactical} on the Tactical dial); Coordinate offered ${S.offered.coordinate} made ${S.made.coordinate}; Strengthen Link offered ${S.offered.strengthen} made ${S.made.strengthen}; both in one ${S.pair}`);
}
if (tally.lanes) {
  const L = tally.lanes;
  const avg = (x) => (x.n ? `held ${(x.held / x.n).toFixed(2)} stood ${(x.stood / x.n).toFixed(2)}` : '-');
  console.log(`  LANES ${L.games} games, ${L.rounds} squad-rounds; zones held ${JSON.stringify(L.held)}; stood in ${JSON.stringify(L.stood)}`);
  console.log(`  LANES the winner a round: ${avg(L.winner)}; the loser: ${avg(L.loser)}; the squad in two zones or more in more rounds won ${L.spread.won}, lost ${L.spread.lost}, level ${L.spread.level} (as many rounds each: ${L.spread.even})`);
}
if (squad) {
  tally.squad = squad;
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  for (const [role, sq] of Object.entries(squad)) console.log(`  SQUAD ${role} ${sq.squadRounds} squad-rounds: dialled at one target ${sq.sameTarget} of ${sq.dialled} (${pct(sq.sameTarget, sq.dialled)}); a target gone ${sq.lost} of ${sq.planned} (${pct(sq.lost, sq.planned)}), then attacked nothing ${sq.lostIdle}; blades alone ${sq.bladeAlone}, together ${sq.bladeTogether} of ${sq.bladeRounds}; zones crowded ${sq.crowded} of ${sq.zoneRounds} (${pct(sq.crowded, sq.zoneRounds)}); a Lock before the gun ${sq.gunLocked} of ${sq.gunActs} (${pct(sq.gunLocked, sq.gunActs)})`);
}
if (tally.abilities) {
  const rows = Object.entries(tally.abilities).map(([id, r]) => {
    const card = data.byId.get(id.replace(/_[A-Z]$/, ''));
    const action = card?.actions?.find((a) => a.id === id);
    return { id, card: card ? M.D.cardName(card) : '?', action: action?.name?.en ?? action?.name?.zh ?? '?', type: action?.type ?? '?', ...r, rate: r.chosen / r.offered };
  }).sort((a, b) => a.rate - b.rate || b.offered - a.offered);
  writeFileSync(process.env.ABILITIES === '1' ? 'abilities.json' : process.env.ABILITIES, JSON.stringify(rows, null, 1));
  for (const x of rows.slice(0, 40)) console.log(`  ${x.id.padEnd(12)} ${String(x.chosen).padStart(5)} of ${String(x.offered).padStart(5)}  ${x.type.padEnd(10)} ${x.card.slice(0, 28).padEnd(28)} ${x.action.slice(0, 26)}  ${Object.keys(x.kinds).join(',')}`);
}
console.log(JSON.stringify(tally));

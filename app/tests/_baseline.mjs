// AI lab (tools/ai-lab/README.md): seeded games between two policies, AI-OPPONENT-PLAN.md M6.3 and M7.9.
//   node tests/_baseline.mjs <scenario index> <seat measured> <opponent> <first seed> <last seed> [policy measured]
// A policy is `legal`, `eager`, `brawler` or `tactician`. The Tactician takes its skills after a colon:
//   tactician                  every skill
//   tactician:mission,exposure only those
//   tactician:-stance,-spend   all but those
//   tactician:none             none of them
// and weights after a second colon, as name=value pairs: tactician::exposure=0.5,future=0.3
// One line of JSON at the end.
import { createHash } from 'node:crypto';
import { botTable, loadEngine } from './_engine.mjs';
// The scratch bundle is named by everything that tells two runs apart, the
// MISSION and MAP among it: two runs at once with the same arguments and
// another mission took each other's bundle away (2026-10-02). A long policy
// (the tuner's thirty-one weights) is named by a hash of it: the plain name
// ran past the 260 characters a Windows path may have (2026-10-04).
const plainName = [...process.argv.slice(2), process.env.MISSION ?? '', process.env.MAP ?? '', process.env.HAND ?? '', process.env.FOEHAND ?? ''].join('-').replace(/[^a-z0-9-]/gi, '_');
const bundleName = plainName.length <= 80 ? plainName : createHash('sha256').update(plainName).digest('hex').slice(0, 16);
const { M, data } = await loadEngine(`baseline-${bundleName}`, ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
function policyOf(name) {
  if (name === 'brawler') return M.AI.brawlerPolicy;
  // The Brawler with its habits, named as _policies.mjs names it.
  if (name.startsWith('brawler:')) throw new Error(`${name}: the Brawler's habits went with the copy (M21)`);
  if (name === 'eager') return M.AI.eagerPolicy;
  if (name === 'legal') return M.AI.legalPolicy;
  // The levels (M9.1): recruit[:rate] is the Brawler making mistakes at that rate; veteran the Tactician without its look ahead.
  if (name === 'recruit' || name.startsWith('recruit:')) return name.includes(':') ? M.AI.blundering(M.AI.brawlerPolicy, Number(name.split(':')[1]), 'recruit') : M.AI.recruitPolicy;
  if (name === 'veteran') return M.AI.veteranPolicy;
  if (name.startsWith('tactician')) {
    const [, spec = '', tune = ''] = name.split(':');
    const names = spec.split(',').filter(Boolean);
    const all = Object.keys(M.AI.SKILLS);
    let skills = {};
    if (names.includes('none')) skills = Object.fromEntries(all.map((k) => [k, false]));
    else if (names.some((n) => !n.startsWith('-') && !n.startsWith('+'))) skills = Object.fromEntries(all.map((k) => [k, names.includes(k)]));
    else skills = Object.fromEntries(names.map((n) => [n.slice(1), n.startsWith('+')]));
    for (const k of Object.keys(skills)) if (!all.includes(k)) throw new Error(`no skill called ${k}`);
    const weights = Object.fromEntries(tune.split(',').filter(Boolean).map((x) => { const [k, v] = x.split('='); if (!(k in M.AI.TACTICIAN)) throw new Error(`no weight called ${k}`); return [k, Number(v)]; }));
    return M.AI.makeTactician(skills, weights);
  }
  throw new Error(`no policy called ${name}`);
}
// LEADER=<label> makes the seat measured name that Mech its Commander, whatever its policy would choose.
const led = (policy) => (!process.env.LEADER ? policy : {
  name: policy.name,
  ...(policy.trueRange ? { trueRange: true } : {}),
  choose(d, view, rng) {
    if (d.kind === 'setup.designate.leader') {
      const o = d.options.find((x) => x.label.includes(process.env.LEADER));
      if (o) return { option: o.id, reason: 'forced_commander', why: 'named by the harness' };
    }
    return policy.choose(d, view, rng);
  },
});
// MISSION=<Main Task id> and MAP=<battlefield id> play the copied squads on another table (M8).
const scenario = { ...data.solo.scenarios[Number(process.argv[2] ?? 0)], ...(process.env.MISSION ? { mission: process.env.MISSION } : {}), ...(process.env.MAP ? { map: process.env.MAP } : {}) };
const seat = process.argv[3] ?? 's1';
const foe = process.argv[4] ?? 'legal';
const from = Number(process.argv[5] ?? 1);
const to = Number(process.argv[6] ?? 10);
// The policy in the seat being measured: the Brawler unless another is named.
const subject = process.argv[7] ?? 'brawler';
const other = seat === 's1' ? 's2' : 's1';
// HAND=<ids, or all> deals the seat measured a plain hand of Tactics Cards, and FOEHAND the other seat (M8.2q).
const handOf = (v) => (!v ? [] : v === 'all' ? ['274', '275', '276', '277', '278', '279'] : v.split(','));
const hands = { [seat]: handOf(process.env.HAND), [other]: handOf(process.env.FOEHAND) };
const out = { scenario: scenario.id, subject, brawler: seat, against: foe, cards: {}, games: 0, won: 0, lost: 0, level: 0, broken: [], vpFor: 0, vpAgainst: 0, rounds: 0, decisions: 0, lostUnits: 0, killedUnits: 0, ms: 0, slowest: 0, bySeed: [] };
const t0 = performance.now();
for (let seed = from; seed <= to; seed++) {
  const t = botTable(M, data, scenario, { seed, policies: { [seat]: led(policyOf(subject)), [other]: policyOf(foe) } });
  if (hands[seat].length || hands[other].length) {
    t.state.tactics = { ...hands };
    t.watch((cmd) => { if (cmd.kind === 'playTactic' && cmd.seat === seat) out.cards[cmd.cardId] = (out.cards[cmd.cardId] ?? 0) + 1; });
  }
  let end;
  try {
    // SLOWLOG=<ms>: each decision of the seat measured that took longer, with the seed, the round and phase,
    // the question and its answer.
    end = await t.run({ maxSteps: 8000, onStep: (s) => {
      if (s !== seat) return;
      const e = t.drivers[s].log.at(-1);
      out.slowest = Math.max(out.slowest, e.ms);
      if (process.env.SLOWLOG && e.ms > Number(process.env.SLOWLOG)) console.log(`SLOW ${e.ms} ms seed ${seed} r${e.round} p${t.state.round.phase} [${e.kind}] ${String(e.label).slice(0, 90)}`);
    } });
  } catch (err) {
    end = { kind: 'threw', why: err.message };
  } finally {
    t.close();
  }
  if (end.kind !== 'over' || t.refused.length) { out.broken.push(`seed ${seed}: ${end.kind} ${end.why ?? ''} ${t.refused.length ? JSON.stringify(t.refused[0]) : ''}`.slice(0, 300)); continue; }
  const vp = M.TK.normaliseTasks(t.state.tasks).vp;
  out.games += 1;
  if (end.result.winner === seat) out.won += 1; else if (end.result.winner === other) out.lost += 1; else out.level += 1;
  out.bySeed.push(`${seed}${end.result.winner === seat ? 'W' : end.result.winner === other ? 'L' : 'D'}${vp[seat]}-${vp[other]}`);
  out.vpFor += vp[seat]; out.vpAgainst += vp[other];
  out.rounds += t.state.round.n;
  out.decisions += t.steps();
  // Units of each squad no longer standing: gone from the board, or dead on it.
  const standing = (side) => t.state.tokens.filter((x) => x.side === side && x.kind !== 'projectile' && (x.kind === 'mech' ? x.partStates.torso !== 'destroyed' : x.partStates.main !== 'destroyed')).length;
  const fielded = (side) => (side === 's1' ? data.solo.squads[scenario.seats.s1] : data.solo.squads[scenario.seats.s2]);
  const size = (sq) => (sq.mechs?.length ?? 0) + (sq.drones?.length ?? 0);
  out.lostUnits += size(fielded(seat)) - standing(seat);
  out.killedUnits += size(fielded(other)) - standing(other);
}
out.ms = Math.round(performance.now() - t0);
const n = Math.max(1, out.games);
console.log(JSON.stringify({ ...out, winRate: +(out.won / n).toFixed(3), vpFor: +(out.vpFor / n).toFixed(2), vpAgainst: +(out.vpAgainst / n).toFixed(2), rounds: +(out.rounds / n).toFixed(2), decisions: Math.round(out.decisions / n), lostUnits: +(out.lostUnits / n).toFixed(2), killedUnits: +(out.killedUnits / n).toFixed(2), secondsPerGame: +(out.ms / 1000 / Math.max(1, to - from + 1)).toFixed(2) }));

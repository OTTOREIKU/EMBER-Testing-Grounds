// AI lab (tools/ai-lab/README.md): a fingerprint of seeded games, to prove a saving changes nothing.
//   node tests/_samegames.mjs <policy> <opponent> [games per row = 3] [first seed = 1]
// Run it before a change that is meant to be a saving only, and after: the
// last line must be the same line. Each game is told as every answer both
// seats gave, in order; the fingerprint is a hash of all of them.
import { createHash } from 'node:crypto';
import { botTable, loadEngine } from './_engine.mjs';
import { policyOf } from './_policies.mjs';
const { M, data } = await loadEngine('samegames', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const subject = process.argv[2] ?? 'tactician:-focus';
const foe = process.argv[3] ?? 'brawler';
const n = Number(process.argv[4] ?? 3);
const first = Number(process.argv[5] ?? 1);
const all = createHash('sha256');
for (const [g, scenario] of data.solo.scenarios.entries()) {
  for (const seat of ['s1', 's2']) {
    const other = seat === 's1' ? 's2' : 's1';
    const told = [];
    for (let seed = first; seed < first + n; seed++) {
      const t = botTable(M, data, scenario, { seed, policies: { [seat]: policyOf(M.AI, subject), [other]: policyOf(M.AI, foe) } });
      let end;
      try { end = await t.run({ maxSteps: 8000 }); } catch (err) { end = { kind: 'threw', why: err.message }; } finally { t.close(); }
      const log = ['s1', 's2'].map((s) => t.drivers[s].log.map((e) => `${e.kind}>${e.option}`).join('|')).join('||');
      const vp = M.TK.normaliseTasks(t.state.tasks).vp;
      const h = createHash('sha256').update(log).digest('hex').slice(0, 10);
      all.update(log);
      told.push(`${seed}:${end.kind === 'over' ? `${vp[seat]}-${vp[other]}` : end.kind}:${h}`);
    }
    console.log(`game ${g} as ${seat}  ${told.join('  ')}`);
  }
}
console.log(`SAME GAMES ${subject} v ${foe} x${n}: ${all.digest('hex').slice(0, 16)}`);

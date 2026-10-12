// AI lab (tools/ai-lab/README.md): the games _baseline.mjs plays (the copied games, scenario 0 or 1), with every unit the seat measured loses
// written out: the round and phase, the unit, the other seat's answer that took it, and the unit's own last answers
// before. One JSON line a game. node tests/_lossprobe.mjs <scenario index> <seat> <foe> <first seed> <last seed> [subject]
import { botTable, loadEngine } from './_engine.mjs';

const [sc = '0', seat = 's1', foe = 'veteran', fromS = '1', toS = '1', subject = 'tactician'] = process.argv.slice(2);
const { M, data } = await loadEngine(`lossprobe-${sc}-${seat}-${foe}-${fromS}-${toS}-${subject}`.replace(/[^a-z0-9-]/gi, '_'), ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const policyOf = (name) => (name === 'veteran' ? M.AI.veteranPolicy : name === 'brawler' ? M.AI.brawlerPolicy : M.AI.makeTactician({}, {}));
const scenario = { ...data.solo.scenarios[Number(sc)] };
const other = seat === 's1' ? 's2' : 's1';
const standing = (x) => x.kind === 'projectile' || (x.kind === 'mech' ? x.partStates.torso !== 'destroyed' : x.partStates.main !== 'destroyed');
const grid = (x) => `${String.fromCharCode(65 + Math.floor(x.col / 3))}${Math.floor(x.row / 3) + 1}`;
for (let seed = Number(fromS); seed <= Number(toS); seed++) {
  const t = botTable(M, data, scenario, { seed, policies: { [seat]: policyOf(subject), [other]: policyOf(foe) } });
  const losses = [];
  const own = new Map();
  const hitBy = new Map();
  const alive = () => new Map(t.state.tokens.filter((x) => x.side === seat && x.kind !== 'projectile' && standing(x)).map((x) => [x.uid, x]));
  let before = null;
  let end;
  try {
    end = await t.run({ maxSteps: 8000, onStep: (s, r) => {
      const label = String(r.option?.label ?? r.decision?.kind ?? '');
      const unit = r.decision?.unit;
      if (s === seat && unit !== undefined && /^(opp|activation)\.act$/.test(r.decision?.kind ?? '')) {
        const u = t.state.tokens.find((x) => x.uid === unit);
        const list = own.get(unit) ?? [];
        list.push(`r${t.state.round.n} ${label}${u ? ` [${grid(u)}]` : ''}`);
        own.set(unit, list.slice(-3));
      }
      if (s === other && /^(opp|activation)\.act$/.test(r.decision?.kind ?? '')) {
        for (const x of t.state.tokens) if (x.side === seat && label.includes(` at ${x.label}`)) hitBy.set(x.uid, `r${t.state.round.n} ${label}`);
      }
      const now = alive();
      if (before) {
        for (const [uid, x] of before) {
          if (now.has(uid)) continue;
          losses.push({ round: t.state.round.n, phase: t.state.round.phase, unit: x.label, at: grid(x), hitBy: hitBy.get(uid) ?? '', ownLast: own.get(uid) ?? [] });
        }
      }
      before = now;
    } });
  } catch (err) {
    end = { kind: 'threw', why: err.message };
  } finally {
    t.close();
  }
  const vp = M.TK.normaliseTasks(t.state.tasks).vp;
  console.log(JSON.stringify({ seed, winner: end.result?.winner ?? end.kind, won: end.result?.winner === seat, vp: `${vp[seat]}-${vp[other]}`, losses }));
}

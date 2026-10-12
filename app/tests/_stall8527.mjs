// AI lab (tools/ai-lab/README.md): a table a probe left stalled (STALLDUMP), asked why. Which unit holds the
// Opportunity, what the engine says to ending it, what owed() asks each seat, and the unit's own state.
//   node tests/_stall8527.mjs <stall.json>
import { readFileSync } from 'node:fs';
import { loadEngine } from './_engine.mjs';
const { M, data } = await loadEngine('stall8527', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as OWED from '../src/owed';", "export * as TURN from '../src/turn';"]);
const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const o = state.script.opp;
const t = state.tokens.find((x) => x.uid === o.uid);
console.log('phase', state.round.n, state.round.phase, 'opp', JSON.stringify(o));
console.log('unit', t.label, t.kind, t.cardId, 'side', t.side, 'deployed', t.deployed, 'parts', JSON.stringify(t.partStates), 'statuses', JSON.stringify(t.statuses ?? t.status ?? null));
console.log('end?', JSON.stringify(M.C.check(data, state, { kind: 'endOpportunity', seat: t.side, uid: t.uid })));
for (const seat of ['s1', 's2']) {
  const d = M.OWED.owed(data, state, seat, M.OWED.newMind());
  console.log(seat, 'owed:', d ? `${d.kind} (${d.options.length}) ${d.options.map((x) => x.label).slice(0, 8).join(' | ')}` : null);
}
console.log('script', JSON.stringify({ ...state.script, opp: undefined, log: undefined }).slice(0, 600));
// What the engine counts as owed, and at whom.
const terrain = M.C.knownTerrain ? M.C.knownTerrain(data, state) : null;
const board = { terrain: terrain ?? [], smoke: state.smoke ?? [] };
const owedShot = M.U.autoShotOwed(data, state.tokens, t, board);
console.log('owed action', owedShot?.id, owedShot?.name, owedShot?.type, 'range', owedShot?.range, 'terrain known', !!terrain);
if (owedShot) for (const x of M.U.autoTargetsFor(data, state.tokens, t, owedShot, board)) console.log('  engine target', x.label ?? x.uid ?? JSON.stringify(x).slice(0, 120));
console.log('card actions', JSON.stringify((data.byId.get(t.cardId)?.actions ?? []).map((a) => ({ id: a.id, name: a.name, type: a.type, speed: a.speed, range: a.range }))));
const at = (x) => `${x.label}@${Math.floor(x.col / 3)},${Math.floor(x.row / 3)} f${x.facing} ${x.kind}${x.aerial ? ' aerial' : ''}${(x.statuses ?? []).length ? ` [${x.statuses.map((s) => s.kind ?? s).join(',')}]` : ''}`;
console.log('board:', state.tokens.filter((x) => x.deployed !== false).map(at).join(' | '));
console.log('smoke', JSON.stringify(state.smoke ?? []).slice(0, 300));
// The seam's own road: the row, its payment, the attack's lines, and the free Scan behind the payment.
for (const row of M.TURN.actionRows(data, state, t, o)) {
  console.log('row', row.key, row.a.id, 'ok', JSON.stringify(row.v), 'route', M.TURN.actionRoute(data, t, row.a));
  const pay = M.TURN.actionPayment(data, state, t, row.a, row.key);
  console.log('  pay', JSON.stringify(pay));
  const reading = M.TURN.attackLines(data, state, { uid: t.uid, actionId: row.a.id });
  for (const x of reading?.lines ?? []) {
    console.log('  line', x.t.label, 'blocked', x.blocked, 'hidden', x.hidden, 'why', x.why ?? '');
    if (pay.ok && pay.cmd) {
      const scan = { kind: 'startCounterRoll', seat: t.side, uid: t.uid, actionId: 'COMMON_SCAN', targetUid: x.t.uid, thenAttack: { actionId: row.a.id } };
      console.log('  scan after pay', JSON.stringify(M.C.checkAfter(data, state, pay.cmd, scan)));
    }
  }
}
console.log('electronic value', M.U.electronicValue ? M.U.electronicValue(data, t, []) : '?', 'dash', M.U.electronicDash ? M.U.electronicDash(data, t) : '?');

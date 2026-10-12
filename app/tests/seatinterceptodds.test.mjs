// A LAUNCH THAT OWES INTERCEPTION, AT ITS ODDS (AI-OPPONENT-PLAN.md:
// `interceptOdds`, the Tactician's weight; 0 prices any Interception owed at the
// flat `launch` discount, and a Missile's at none). The seam's launch answer
// carries the Interception it would owe (`queueIntercepts`); the driver now adds
// the chance the Projectile comes through it (`Option.survive`): each
// interceptor trying while it has Interception Tokens left (FAQ M5), each try
// at the combat window's own odds of destroying it. Played on the Power Spike
// squads (RDL's Hyena Missiles against UN's Porcupine CIWS) on Key Facility.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A launch at its Interception odds\n');

const { M, data } = await loadEngine('seatinterceptodds', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';", "export * as ODDS from '../src/ai/odds';"]);
// The two sides of the old Power Spike demo board, as its data held them (the
// demo scenarios left the repo on 2026-10-12): UN's Burst Striker with a Raven
// and a Porcupine, RDL's Railgun Gunner and Missile Brawler with a Hyena.
data.solo.squads['io-s1'] = {
  name: 'power-spike:s1', faction: 'RDL', points: 0,
  mechs: [{ name: 'UN Burst Striker', loadout: { torso: '091', chasis: '101', leftHand: '540', rightHand: '145', backpack: '081', pilot: 'LPA-19' } }],
  drones: [{ cardId: '166' }, { cardId: '160' }],
};
data.solo.squads['io-s2'] = {
  name: 'power-spike:s2', faction: 'RDL', points: 0,
  mechs: [
    { name: 'RDL Railgun Gunner', loadout: { torso: '012', chasis: '021', leftHand: '032', rightHand: '030', backpack: '002', pilot: 'FPA-01' } },
    { name: 'RDL Missile Brawler', loadout: { torso: '012', chasis: '020', leftHand: '023', backpack: '004', pilot: 'FPA-14' } },
  ],
  drones: [{ cardId: '079' }],
};
const p = M.AI.makeTactician();
const t = botTable(M, data, { ...data.solo.scenarios[0], id: 'io-7', seats: { s1: 'io-s1', s2: 'io-s2' }, mission: 'blackbox-key-facilities' }, { seed: 7, policies: { s1: p, s2: p }, glue: M.HUD.glueAfter });
let hit = null;
await t.run({ maxSteps: 12000, until: () => ['s1', 's2'].some((s) => { const d = t.drivers[s].pending(); if (d && d.options.some((o) => o.survive)) { hit = { s, d }; return true; } return false; }) });
const owing = hit ? hit.d.options.filter((o) => o.survive) : [];
const o = owing[0];
const queued = o?.commands.find((c) => c.kind === 'queueIntercepts');
// The same chance worked out by hand from the window's odds of one try.
const item = queued?.items[0];
const by = item ? t.state.tokens.find((x) => x.uid === item.uid) : null;
const payer = by ? M.U.interceptPayer(data, t.state.tokens, by, item.actionId) : null;
const tries = Math.max(1, payer?.intercept?.[item.actionId] ?? 1);
const odds = new M.ODDS.Odds(data);
const one = item ? odds.forecast(t.state, { uid: item.uid, actionId: item.actionId, targetUid: item.targetUid, mode: 'intercept', before: o.commands.filter((c) => c.kind !== 'queueIntercepts') }) : null;
check('A LAUNCH THAT OWES INTERCEPTION CARRIES THE CHANCE ITS PROJECTILE COMES THROUGH: every answer that owes it, and the chance is the one try\'s miss, once for each Token the interceptor has left',
  [!!hit, owing.length > 0 && owing.every((x) => x.tags.includes('intercepted')), queued?.items.length === 1, tries > 1, !!one && Math.abs(o.survive() - (1 - one.kill) ** tries) < 1e-9, o.survive() > 0 && o.survive() < 1],
  [true, true, true, true, true, true]);
// (What the Tactician makes of the chance is `tactician.test`'s: a launch
// priced at it.)
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

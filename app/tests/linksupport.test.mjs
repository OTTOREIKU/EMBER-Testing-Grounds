// Link and Tokens (the 2026-09-25 audit, Project-Documents/LINK-AND-TOKENS-AUDIT.md).
//
// Read against the REAL card database, because the whole gap was in the data:
// Strengthen Link, the Link Beacon and System Cleanup each carried their rule
// as a structured effect that nothing read, so all of them spent their Tick and
// did nothing on every page. The readers and the shared Stabilize question are
// sliced in; the pages are pinned as text, because the other half of the audit
// was three pages asking the same question three different ways.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};

console.log('Link and Token support\n');

const units = read('../src/units.ts');
const types = read('../src/types.ts');
const rules = read('../src/rules.ts');

const body = `
type Token = any; type GameData = any; type PartSlot = any; type CardAction = any; type Card = any; type StatusDef = any;
export function tokenCards(data: any, t: any): any[] {
  const out: any[] = [];
  for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot']) {
    const id = t.mech?.[slot]; const c = id ? data.byId.get(id) : undefined;
    if (c) out.push({ slot, card: c });
  }
  if (t.kind !== 'mech') { const c = data.byId.get(t.cardId); if (c) out.push({ slot: 'main', card: c }); }
  return out;
}
function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }
// A Repeater is any of this side's units flagged so: electronicOrigins' own
// reach test is repeaters.test.mjs's, and what is pinned here is that
// Electronic Support asks for the origins at all while a Beacon does not.
export function electronicOrigins(_d: any, tokens: any[], t: any): any[] {
  return [t, ...tokens.filter((r: any) => r.repeater && r.side === t.side && r.uid !== t.uid)];
}
export function actionRange(_d: any, _tokens: any[], _t: any, a: any): number { return a.range ?? 0; }
export function maxLink(_d: any, t: any): number { return t.lv ?? 4; }
`
  + cut(rules, 'export function rangeBetween', 'export function inArc', 'rangeBetween')
  + cut(types, 'export const STATUSES', 'export interface RoundState', 'STATUSES and the token helpers')
  + cut(units, 'export interface AuraSource', '// LPA-21 Firefly', 'the aura readers')
  + cut(units, '// ---------- Link and Token support', '// ---------- Covert carry', 'the Link and Token support readers');

const tmp = new URL('./_linksupport.slice.ts', import.meta.url);
writeFileSync(tmp, body);
const L = await import(tmp.href);

const cards = JSON.parse(read('../../data/cards.json'));
const pool = Array.isArray(cards) ? cards : cards.cards;
const data = { byId: new Map(pool.map((c) => [c.id, c])) };
const act = (id) => pool.flatMap((c) => c.actions ?? []).find((a) => a.id === id);

// ---------- the readers, against every action in the data ----------
const every = pool.flatMap((c) => (c.actions ?? []).map((a) => a));
const linkIds = every.filter((a) => L.linkSupportOf(a)).map((a) => a.id).sort();
const cleanIds = every.filter((a) => L.tokenCleanupOf(a)).map((a) => a.id).sort();
check('exactly the three Link cards restore Link', linkIds, ['018_B', '075_A', '504_A']);
check('exactly the two cleanup cards remove a Token', cleanIds, ['504_B', 'TM31RS_B']);
check('018_B Strengthen Link (Aurora) reaches every Ally Mech in range', L.linkSupportOf(act('018_B')), { selection: 'all', amount: 1 });
check('504_A Strengthen Link (Nimbus) reaches one', L.linkSupportOf(act('504_A')), { selection: 'chosen', amount: 1 });
check('075_A Link Support (B3/1 Link Beacon) reaches every Ally Mech in range', L.linkSupportOf(act('075_A')), { selection: 'all', amount: 1 });
check('System Cleanup takes one Square Token', L.tokenCleanupOf(act('504_B')), { shape: 'square', count: 1 });
check('the two Strengthen Links are Electronic Support, the Beacon is not',
  [L.isElectronicSupport(act('018_B')), L.isElectronicSupport(act('504_A')), L.isElectronicSupport(act('075_A'))], [true, true, false]);

// ---------- who they reach ----------
const mech = (uid, side, col, over = {}) => ({ uid, side, kind: 'mech', label: `M${uid}`, col, row: 3, size: 3, stance: 'offensive', link: 1, lv: 4, partStates: { torso: 'intact' }, statuses: [], mech: {}, ...over });
const aurora = mech(1, 's1', 3, { link: 4 });
const board = [
  aurora,
  mech(2, 's1', 12),                                   // Range 3: in reach of Range 4
  mech(3, 's1', 30),                                   // Range 9: out
  mech(4, 's1', 6, { stance: 'shutdown', link: 0 }),   // Shutdown, in reach
  mech(5, 's2', 6),                                    // an enemy, in reach
  mech(6, 's1', 9, { link: 4 }),                       // in reach and already full
];
const reached = (tokens, src, a) => L.linkSupportTargets(data, tokens, src, a).map((x) => x.uid);
check('Strengthen Link: the Ally Mechs in range and short of Link, Shutdown included (FAQ L3)', reached(board, aurora, act('018_B')), [2, 4]);
const relay = { uid: 7, side: 's1', kind: 'drone', repeater: true, col: 30, row: 3, size: 1, partStates: { main: 'intact' }, statuses: [] };
check('a Repeater is a starting point for Electronic Support (6.2.1)', reached([...board, relay], aurora, act('018_B')), [2, 3, 4]);
const beacon = { uid: 8, side: 's1', kind: 'projectile', cardId: '075', col: 3, row: 3, size: 1, partStates: { main: 'intact' }, statuses: [] };
check('a Link Beacon measures from itself, never from a Repeater', reached([...board, relay, beacon], beacon, act('075_A')), [2, 4]);
const hurt = mech(9, 's1', 3, { statuses: ['fci', 'fragile'], expiring: ['fci'] });
check('System Cleanup reaches the Ally Units wearing a Square Token',
  L.tokenCleanupTargets(data, [aurora, hurt, mech(10, 's1', 6, { statuses: ['highlight'] })], aurora, act('504_B'), L.tokenCleanupOf(act('504_B'))).map((x) => x.uid), [9]);

// ---------- ZHDR-303 Appease, off the real card ----------
const valk = { uid: 11, side: 's1', kind: 'drone', cardId: 'ZHDR-303', label: 'Valkyrie', col: 6, row: 3, size: 1, stance: 'offensive', partStates: { main: 'intact' }, statuses: [] };
check('the Valkyrie carries the one round-end Link aura in the data', L.roundEndLinkAuras(data, valk).map((a) => a.id), ['ZHDR-303_B']);
check('it reaches an Ally Mech within Range 2', L.roundEndLinkSources(data, [valk, mech(12, 's1', 3)], mech(12, 's1', 3)).length, 1);
check('and not one out of range', L.roundEndLinkSources(data, [valk, mech(12, 's1', 30)], mech(12, 's1', 30)).length, 0);
check('no other unit in the data carries one',
  pool.filter((c) => c.category !== 'pilot' && L.roundEndLinkAuras(data, { kind: 'drone', cardId: c.id, partStates: { main: 'intact' } }).length).map((c) => c.id), ['ZHDR-303']);

// ---------- the shared Stabilize question ----------
const ask = (over) => L.stabiliseAsk(data, mech(20, 's1', 3, over));
check('every Token worn, by face', ask({ statuses: ['fci', 'fci', 'lowProfile'], expiring: ['fci'] }).picks.map((p) => p.id), ['fci:red', 'fci:yellow', 'lowProfile']);
check('the rows name what comes off', ask({ statuses: ['fci', 'fci'], expiring: ['fci', 'fci'] }).picks.map(L.stabiliseRowLabel), ['Remove Fire Control Interference, red (2 worn)']);
check('keeping them all is offered when a Link is missing (FAQ J4)', ask({ statuses: ['fci'], link: 2 }).keep, true);
check('and not at full Link, where it would change nothing (FAQ J8)', ask({ statuses: ['fci'], link: 4 }).keep, false);
check('a red face says it comes off at the End Phase anyway', /End Phase anyway/.test(ask({ statuses: ['fci'], expiring: ['fci'] }).body), true);
check('a Triangle or a State is not on the list', ask({ statuses: ['repaired', 'camouflage'] }).picks, []);

// ---------- the pages: one question, asked before anything is paid ----------
const pad = read('../pad/pad.ts');
const guided = read('../pad/guided.ts');
const hud = read('../src/matchhud.ts');
const main = read('../src/main.ts');
const squads = read('../src/squads.ts');
const guide = read('../src/playguide.ts');
check('the pad\'s Link + is a plain Recover, not Stabilize',
  [pad.includes('data-act="link-up" aria-label="Recover 1 Link"'), /case 'link-up':[^\n]*kind: 'recoverLink'/.test(pad), pad.includes('data-act="stabilise" aria-label')], [true, true, false]);
check('the pad no longer takes a lone Token without asking', /worn\.length < 2/.test(pad), false);
check('all four Stabilize doors ask the shared question',
  [pad, main, hud, guide].map((src) => src.includes('stabiliseAsk(')), [true, true, true, true]);
check('and each has a Cancel that cancels',
  [pad, main, guide].map((src) => src.includes("'__cancel'")).concat(hud.includes('data-act="stabcancel"')), [true, true, true, true]);
check('the Guided pad pays for Stabilize only once it is answered',
  /api\.stabilise\?\.\(t\.uid, \(\) => api\.send\(\{ kind: 'performAction'/.test(guided), true);
const route = cut(hud, 'function routeAction(', 'function launchPickPanel', 'routeAction');
check('the Match Centre asks Stabilize in routeAction, before it pays', route.includes("if (a.id === 'COMMON_STABILIZE')"), true);
check('and routes a Link Beacon before the Detonation branch',
  route.indexOf('linkSupportOf(a)') > 0 && route.indexOf('linkSupportOf(a)') < route.indexOf("t.kind === 'projectile' && a.type !== 'Passive'"), true);
const perform = cut(main, 'function performGuided(', 'async function performStabilize', 'performGuided');
check('the tabletop routes a Link Beacon before the Detonation branch',
  perform.indexOf('linkSupportOf(action)') > 0 && perform.indexOf('linkSupportOf(action)') < perform.indexOf("t.kind === 'projectile' && action.type !== 'Passive'"), true);
check('the Guided pad routes a Link Beacon before the Detonation branch',
  guided.indexOf('linkSupportOf(a.action)') > 0 && guided.indexOf('linkSupportOf(a.action)') < guided.indexOf("if (a && t.kind === 'projectile' && a.action.type !== 'Passive')"), true);
check('the tabletop squad panel\'s + goes through the capped command',
  [/lk-plus[\s\S]{0,400}kind: 'recoverLink'/.test(squads), /t\.link = \(t\.link \?\? 0\) \+ 1/.test(squads)], [true, false]);
check('the pad asks about Appease as a round turns, on both phones',
  [/function afterAdvance[\s\S]{0,300}askAppease\(\)/.test(pad), /kind === 'advancePhase' && table\.round\.phase === 0[^\n]*askAppease\(\)/.test(pad)], [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

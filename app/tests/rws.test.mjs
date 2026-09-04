// RWS 遥控武器 (Ls197R Autocannon 550/551; FAQ A20/A22): during the Command
// Phase an Ally may send a Command to this Mech to perform the Action, once per
// Part per round - the one case where a MECH is designated in that phase. The
// readers run against the shipped cards; the loop rules against the real
// loop.ts; the command-layer gates are pinned by source.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('RWS: a Mech commanded in the Command Phase\n');

// ---------- the readers, against the shipped cards ----------
const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const from = units.indexOf('// ---------- Self-applied Tokens');
const to = units.indexOf('export function interceptCapacity(');
if (from < 0 || to <= from) throw new Error('could not locate the RWS readers in units.ts');
const readers = new URL('./_rws.readers.ts', import.meta.url);
writeFileSync(readers, `type CardAction = any; type GameData = any; type Token = any; type PartSlot = any; type GameState = any;
function statusCount(list: any, id: string): number { return (list ?? []).filter((x: any) => x === id).length; }
function tokenCards(data: any, t: any): any[] {
  if (t.kind === 'mech') return Object.entries(t.mech ?? {}).map(([slot, id]) => ({ slot, card: data.byId.get(id) })).filter((x: any) => x.card);
  return [{ slot: 'main', card: data.byId.get(t.cardId) }].filter((x: any) => x.card);
}
` + units.slice(from, to));
const R = await import(readers.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;
const data = { byId: new Map(cards.map((c) => [c.id, c])) };
const act = (id) => cards.flatMap((c) => c.actions ?? []).find((a) => a.id === id);

check('550_A Single Shot is an RWS Action', R.isRwsAction(act('550_A')), true);
check('and so is 551_A', R.isRwsAction(act('551_A')), true);
check('a Firing Action without the keyword is not', R.isRwsAction(act('027_A')), false);
check('and nothing else in the box prints it',
  cards.flatMap((c) => c.actions ?? []).filter((a) => R.isRwsAction(a)).map((a) => a.id).sort(), ['550_A', '551_A']);

const crisis = (over = {}) => ({
  uid: 7, side: 's1', kind: 'mech', label: 'Crisis', stance: 'offensive',
  mech: { torso: '547', chasis: '179', leftHand: '550', rightHand: '551' },
  partStates: { torso: 'intact', chasis: 'intact', leftHand: 'intact', rightHand: 'intact' }, statuses: [], ...over,
});
check('a Crisis with both autocannons has two RWS Parts', R.rwsActionsOf(data, crisis()).map((x) => x.slot), ['leftHand', 'rightHand']);
check('a wrecked arm fires nothing', R.rwsActionsOf(data, crisis({ partStates: { torso: 'intact', leftHand: 'destroyed', rightHand: 'intact' } })).map((x) => x.slot), ['rightHand']);
check('a Drone has none', R.rwsActionsOf(data, { uid: 9, kind: 'drone', cardId: '550', partStates: { main: 'intact' } }), []);

const state = (ledger = []) => ({ round: { n: 2 }, script: { oncePerRound: ledger } });
check('two Parts, no Commands yet: two left', R.rwsCommandsLeft(data, state(), crisis()), 2);
check('one Command taken this round: one left', R.rwsCommandsLeft(data, state([R.rwsCommandKey(2, 7)]), crisis()), 1);
check('two taken: none', R.rwsCommandsLeft(data, state([R.rwsCommandKey(2, 7), R.rwsCommandKey(2, 7)]), crisis()), 0);
check("last round's Commands do not count", R.rwsCommandsLeft(data, state([R.rwsCommandKey(1, 7), R.rwsCommandKey(1, 7)]), crisis()), 2);
check('the fired key names the Part', R.rwsFiredKey(2, 7, '550_A'), '2:rws:7:550_A');

// ---------- the loop, against the real loop.ts ----------
const loopSrc = readFileSync(new URL('../src/loop.ts', import.meta.url), 'utf8');
const loop = new URL('./_rws.loop.ts', import.meta.url);
writeFileSync(loop, [
  'type GameState = any;', 'type Side = any;', 'type Token = any;', 'type Timing = any;', 'type GameData = any;',
  'const TIMINGS: any[] = [];',
  'const commandGeneration = (_d: any, t: any) => t.gen ?? 1;',
  // The fixture says how many RWS Commands the Mech has left; the reader above
  // is driven against the real cards separately.
  'const rwsCommandsLeft = (_d: any, _s: any, t: any) => t.rws ?? 0;',
].join('\n') + '\n' + loopSrc.replace(/^import[^\n]*\n/gm, ''));
const L = await import(loop.href);

const mech = (uid, side, rws = 0, extra = {}) => ({ uid, side, kind: 'mech', label: `M${uid}`, stance: 'offensive', rws, partStates: { torso: 'intact', chasis: 'intact' }, ...extra });
const drone = (uid, side) => ({ uid, side, kind: 'drone', label: `D${uid}`, partStates: { main: 'intact' } });
const game = (tokens, script = {}, cmd = { s1: 3, s2: 3 }) => ({
  tokens, commandTokens: cmd, round: { n: 1 },
  script: { turn: 's1', done: [], acted: [], commanded: [], passed: [], freeCommand: [], oncePerRound: [], stage: '', mode: 'hotseat', seats: {}, ...script },
});
const ids = (list) => list.map((t) => t.uid).sort((a, b) => a - b);
const DATA = {};

const g = game([mech(1, 's1', 1), mech(2, 's1', 0), drone(3, 's1'), mech(4, 's2', 1)]);
check('with the cards to read, the RWS Mech joins the Drones in the Command Phase', ids(L.eligibleUnits(g, 'Command', 's1', DATA)), [1, 3]);
check('a Mech with no RWS Command left does not', ids(L.eligibleUnits(g, 'Command', 's1', DATA)).includes(2), false);
check('without the cards, the list is the Drones alone (older callers)', ids(L.eligibleUnits(g, 'Command', 's1')), [3]);
check('the other squad sees its own RWS Mech', ids(L.eligibleUnits(g, 'Command', 's2', DATA)), [4]);
check('a Shutdown Mech performs nothing, RWS included (4.1.1)',
  ids(L.eligibleUnits(game([mech(1, 's1', 1, { stance: 'shutdown' }), drone(3, 's1')]), 'Command', 's1', DATA)), [3]);
check('a squad out of Command Tokens cannot send one to the Mech either',
  ids(L.eligibleUnits(game([mech(1, 's1', 1)], {}, { s1: 0, s2: 3 }), 'Command', 's1', DATA)), []);
check('the Automatic Phase never lists it', ids(L.eligibleUnits(g, 'Automatic', 's1', DATA)), [3]);
const only = game([mech(1, 's1', 1), drone(3, 's2')], { commanded: [3] });
check('canAct threads the cards through', [L.canAct(only, 'Command', 's1'), L.canAct(only, 'Command', 's1', DATA)], [false, true]);
check('and loopComplete waits for the RWS Mech', [L.loopComplete(only, 'Command'), L.loopComplete(only, 'Command', DATA)], [true, false]);
check('and nextTurn hands the turn to the squad that can still command it', L.nextTurn(only, 'Command', 's2', DATA), 's1');

// ---------- the command layer and the pages, by source ----------
const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/playguide.ts', import.meta.url), 'utf8');
check('designate judges eligibility with the cards', /eligibleUnits\(state, phase, cmd\.seat, data\)\.some/.test(cmds), true);
check('and every turn derivation in the command layer too',
  (cmds.match(/nextTurn\(state, phase, [a-z.]+, data\)/g) ?? []).length >= 3 && /loopComplete\(state, ph, data\)/.test(cmds), true);
check('the one-token cap stays a Drone rule', /phase === 'Command' && t\.kind === 'drone' && !sc\.freeCommand\.includes\(cmd\.uid\) && heldCommands\(t\) > 0/.test(cmds), true);
check('designating a Mech writes the Command to the ledger, not the commanded list',
  /if \(t\.kind === 'mech'\) sc\.oncePerRound\.push\(rwsCommandKey\(state\.round\.n, t\.uid\)\);\s*\n\s*else if \(!sc\.commanded\.includes\(cmd\.uid\)\) sc\.commanded\.push\(cmd\.uid\);/.test(cmds), true);
const perf = cmds.slice(cmds.indexOf("case 'performAction': {"), cmds.indexOf("case 'performAction': {") + 5200);
check('a Mech in the Command Phase performs only an RWS Action', /if \(!isRwsAction\(a\)\) return no\(/.test(perf), true);
check('once per Part per round', /rwsFiredKey\(state\.round\.n, cmd\.uid, a\.id\)\)\)/.test(perf), true);
check('and it costs the activation the Command bought, not Ticks', /return fromVerdict\(canActivate\(o\)\);\s*\n\s*\}\s*\n\s*\n\s*\/\/ Riposte/.test(perf), true);
const applyPerf = cmds.slice(cmds.lastIndexOf("case 'performAction': {"), cmds.lastIndexOf("case 'performAction': {") + 4000);
check('the apply marks the Part fired and spends the activation',
  /sc\.oncePerRound\.push\(rwsFiredKey\(state\.round\.n, t\.uid, a\.id\)\);\s*\n\s*if \(o\) sc\.opp = spendActivation\(o, a\);/.test(applyPerf), true);
const man = cmds.slice(cmds.indexOf("case 'maneuver': {"), cmds.indexOf("case 'maneuver': {") + 2000);
check('and a commanded Mech does not move', /A Mech commanded through RWS fires that Part and does not move/.test(man), true);
check('the Match Centre lists the Mech with an RWS chip', /t\.kind === 'mech' \? 'RWS' : t\.kind/.test(hud), true);
check('and offers only its RWS Actions while it is activated', /\.filter\(\(\{ a \}\) => !rwsOnly \|\| isRwsAction\(a\)\)/.test(hud), true);
check('priced as the Command, not as Ticks', /const price = rwsOnly \? 'RWS'/.test(hud), true);
check('the guide lists the Mech\'s RWS Actions and nothing else of its', /if \(phase !== 'Command' \|\| !isRwsAction\(a\)\) continue;/.test(guide), true);
check('and hides its Move button', /phase === 'Command' && chosen\.kind !== 'mech'/.test(guide), true);
check('both pages derive the turn with the cards',
  /eligibleUnits\(s, phase, turn, ctx\.data\)/.test(hud) && /eligibleUnits\(s, phase, turn, this\.data\)/.test(guide), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

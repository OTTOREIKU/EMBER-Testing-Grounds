// Command Generation X against the real cards — rulebook 3.2.1.
//
// A Mech generates 1 Command by default, but six Torso cards print a different
// number and 3.2.1 says a special case gives "a different amount", so X
// REPLACES the 1 rather than adding to it. The digit is never on the keyword:
// every card spells it "指令生成X" with a literal X and prints the real value on
// a Passive Action instead, which is why the reader has to go through the
// Action's description. If a future card puts the number somewhere else, the
// census at the bottom is what catches it.
import { readFileSync, writeFileSync } from 'node:fs';

const cards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const list = Array.isArray(cards) ? cards : (cards.cards ?? cards);

const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = src.indexOf('// ---------- Commands (rulebook 3.2.1) ----------');
const end = src.indexOf('// ---------- Charge (rulebook 4.14) ----------');
if (start < 0 || end < start) throw new Error('could not slice the Commands section out of units.ts');
const tmp = new URL('./_commandgen.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  [
    'type GameData = any;', 'type Token = any;', 'type PartSlot = any;',
    // The real tokenCards walks a Mech's loadout; the fixture hands the cards
    // over directly so this test stays about the number, not the loadout.
    'const tokenCards = (_d: any, t: any) => t.cards;',
  ].join('\n') + '\n' + src.slice(start, end),
);
const { commandGeneration } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Command Generation X — rulebook 3.2.1\n');

const byId = new Map(list.map((c) => [String(c.id), c]));
const mech = (torsoId, state = 'intact') => ({
  kind: 'mech',
  partStates: { torso: state },
  cards: [{ slot: 'torso', card: byId.get(String(torsoId)) }],
});

// The six torsos that print a number, read straight off the card data.
check('P7 Warrior generates 4', commandGeneration(null, mech('172')), 4);
check('P7-A3 Centurion generates 4', commandGeneration(null, mech('173')), 4);
check('P22 Hunter generates 4', commandGeneration(null, mech('174')), 4);
check('P28 Dragoon generates 2', commandGeneration(null, mech('175')), 2);
check('P24 Chariot generates 2', commandGeneration(null, mech('176')), 2);
check('TM31Q Wild Cat generates 2', commandGeneration(null, mech('539')), 2);

// A torso with no Command Generation falls back to the rulebook default.
const plain = list.find((c) => c.type === 'torso' && !JSON.stringify(c).includes('指令生成'));
check('a plain torso generates the default 1', commandGeneration(null, mech(plain.id)), 1);

// A destroyed Part is not read, so the Mech drops back to the default rather
// than keeping a bonus off a card that is gone.
check('a destroyed generator torso falls back to 1', commandGeneration(null, mech('172', 'destroyed')), 1);

// Only Mechs generate. Drones receive Commands, they do not make them.
check('a drone generates none', commandGeneration(null, { kind: 'drone', partStates: {}, cards: [] }), 0);
check('a projectile generates none', commandGeneration(null, { kind: 'projectile', partStates: {}, cards: [] }), 0);

// The census: every card whose text mentions Command Generation must be one the
// reader can actually get a number out of. This is the guard that fires if the
// publisher adds a seventh, or moves the digit onto the keyword.
const mentions = list.filter((c) => JSON.stringify(c).includes('指令生成'));
const readable = mentions.filter((c) =>
  (c.actions ?? []).some((a) => /指令生成\s*\d+/.test(a.description?.zh ?? '') || /Command\s+Generation\s*\d+/i.test(a.description?.en ?? '')),
);
check('every Command Generation card prints a readable number', mentions.length - readable.length, 0);
check('the six known generators are all of them', mentions.map((c) => String(c.id)).sort(), ['172', '173', '174', '175', '176', '539']);

// ---------- who keeps a Command Token, and until when ----------
//
// Two different sweeps, and collapsing them into one deletes the GoF economy.
// 3.2.3 ends the Command Phase by removing the Command Tokens of all DRONES.
// A Mech's unissued tokens stay on its Torso — 4.15.2 says tokens may be
// RESERVED, and 4.15.3/4.15.4 are what they are reserved for. 3.7.2 then takes
// every remaining token in the End Phase. This shipped wrong once, with both
// sweeps clearing everything, and nothing in the suite caught it.
const cmdSrc = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const sweeps = cmdSrc.slice(
  cmdSrc.indexOf('// The Command Phase begins by putting the tokens ON the Mechs'),
  cmdSrc.indexOf('// The sandbox and the teaching guide warn rather than block'),
);
for (const want of ['seedCommandTokens', 'clearDroneCommands', 'clearCommandTokens']) {
  if (!sweeps.includes(`export function ${want}`)) throw new Error(`could not slice ${want} out of commands.ts`);
}
const tmp2 = new URL('./_commandsweep.slice.ts', import.meta.url);
writeFileSync(
  tmp2,
  [
    'type GameState = any;', 'type Side = any;', 'type GameData = any;',
    'const statusCount = (l: any, id: string) => (l ?? []).filter((s: any) => s === id).length;',
    'const alive = (t: any) => Object.values(t.partStates).filter((p: any) => p !== "destroyed").length > 0;',
    'const commandGeneration = (_d: any, t: any) => (t.kind === "mech" ? (t.gen ?? 1) : 0);',
  ].join('\n') + '\n' + sweeps,
);
const sweep = await import(tmp2.href);

const held = (s, uid) => (s.tokens.find((t) => t.uid === uid).statuses ?? []).filter((x) => x === 'command').length;
const board = () => ({
  commandTokens: { s1: 0, s2: 0 },
  tokens: [
    { uid: 1, side: 's1', kind: 'mech', gen: 4, partStates: { torso: 'intact' }, statuses: [] },
    { uid: 2, side: 's1', kind: 'mech', gen: 1, partStates: { torso: 'intact' }, statuses: [] },
    { uid: 3, side: 's1', kind: 'drone', partStates: { main: 'intact' }, statuses: [] },
    { uid: 4, side: 's2', kind: 'mech', gen: 1, partStates: { torso: 'intact' }, statuses: [] },
  ],
});

const s = board();
sweep.seedCommandTokens(null, s);
check('the Command Generation 4 Torso is seeded with 4', held(s, 1), 4);
check('a plain Mech is seeded with 1', held(s, 2), 1);
check('a Drone is seeded with none', held(s, 3), 0);
check('the pool matches what the Mechs hold', s.commandTokens, { s1: 5, s2: 1 });

// Issue two of the four the way designate does, then end the Command Phase.
s.tokens[0].statuses = ['command', 'command'];
s.tokens[2].statuses = ['command'];
s.commandTokens.s1 = 3;
sweep.clearDroneCommands(s);
check('3.2.3 takes the Command off the Drone', held(s, 3), 0);
check('3.2.3 leaves the Mech its reserved tokens', held(s, 1), 2);
check('3.2.3 leaves the pool alone, so a reserved token is still spendable', s.commandTokens.s1, 3);

// A Command Coordination token handed out later, then the End Phase sweep.
s.tokens[2].statuses = ['command'];
sweep.clearCommandTokens(s);
check('3.7.2 takes every Command Token off the Mechs', [held(s, 1), held(s, 2), held(s, 4)], [0, 0, 0]);
check('3.7.2 takes the later Command off the Drone too', held(s, 3), 0);
check('3.7.2 zeroes the pool', s.commandTokens, { s1: 0, s2: 0 });

// Seeding always starts from a clean board, and touches nothing else.
s.tokens[0].statuses = ['command', 'fragile'];
s.tokens[2].statuses = ['command'];
sweep.seedCommandTokens(null, s);
check('seeding clears stale Commands first', held(s, 3), 0);
check('seeding leaves other tokens alone', s.tokens[0].statuses.filter((x) => x === 'fragile').length, 1);
check('a re-seeded generator is back to exactly its printed number', held(s, 1), 4);

// ---------- the two keywords, read off the real cards ----------
//
// Command Coordination X (4.15.3) hands a reserved token to a Drone outside the
// Command Phase. Command-consuming Actions (4.15.4) spend one of the Mech's own.
// Both are written with a literal X in the keyword and the real number in the
// Action text, same as Command Generation.
const kw = src.slice(
  src.indexOf('// Command Coordination X (4.15.3)'),
  src.indexOf('// ---------- Charge (rulebook 4.14) ----------'),
);
const tmp3 = new URL('./_commandkw.slice.ts', import.meta.url);
writeFileSync(
  tmp3,
  ['type CardAction = any;', 'type GameData = any;', 'type Token = any;', 'type PartSlot = any;',
   'const pilotCard = (_d: any, t: any) => t.pilot;',
   'const tokenCards = (_d: any, t: any) => t.cards ?? [];'].join('\n') + '\n' + kw,
);
const K = await import(tmp3.href);

const actionsOf = (id) => (byId.get(String(id))?.actions ?? []);
const coOf = (cid, aid) => K.commandCoordination(actionsOf(cid).find((a) => a.id === aid));

check('the Data Link Pod carries Command Coordination 1', coOf('ZYBP-102', 'ZYBP-102_A'), 1);
check('the Dual Swift Launcher carries it too', coOf('ZHLA-102', 'ZHLA-102_A'), 1);
check('the MR21 Railgun carries it', coOf('ZHRA-201', 'ZHRA-201_A'), 1);
// The Warrior Torso's Melee Synergy GRANTS the keyword to the Mech's Melee
// Actions rather than carrying it. Reading it as a Passive with Coordination 1
// would hand out a free Command every round off an Action nobody performs.
check('Melee Synergy grants rather than carries', coOf('172', '172_B'), 0);
check('and is recognised as a grant', K.grantsCommandCoordination(actionsOf('172').find((a) => a.id === '172_B')), true);

// Exactly five Actions carry it directly; the sixth match in the data is the grant.
const carriers = [];
for (const c of list) for (const a of c.actions ?? []) if (K.commandCoordination(a) > 0) carriers.push(`${c.id}/${a.id}`);
check('five Actions carry Command Coordination', carriers.sort(), [
  'ZHLA-102/ZHLA-102_A', 'ZHLA-201/ZHLA-201_A', 'ZHRA-201/ZHRA-201_A', 'ZHRA-202/ZHRA-202_A', 'ZYBP-102/ZYBP-102_A',
].sort());

// Consuming. Two live on Actions and two on PILOT cards, which have no actions
// at all — reading only `actions` finds half of them and looks complete.
const spendActions = [];
for (const c of list) for (const a of c.actions ?? []) if (K.consumesCommand(a)) spendActions.push(`${c.id}/${a.id}`);
check('two Actions consume a Command', spendActions.sort(), ['ZHDR-304/ZHDR-304_B', 'ZYBP-202/ZYBP-202_A'].sort());
const spendPilots = list.filter((c) => c.category === 'pilot' && K.textConsumesCommand(c.traitDescription?.zh, c.traitDescription?.en));
check('and two pilots do, via traitDescription', spendPilots.map((c) => c.id).sort(), ['ZPA-35', 'ZPA-36']);
check('Chef is one of them', spendPilots.some((c) => c.name.en === 'Chef'), true);

// canSpendCommand has to see the pilot, or holding a token back looks pointless
// on the two Mechs where it matters most.
const withPilot = { kind: 'mech', partStates: {}, cards: [], pilot: byId.get('ZPA-35') };
check('a Mech piloted by Chef can spend a Command', K.canSpendCommand(null, withPilot), true);
const bare = { kind: 'mech', partStates: {}, cards: [], pilot: byId.get('ZPA-36') };
check('so can one piloted by Aster', K.canSpendCommand(null, bare), true);
check('a Mech with neither cannot', K.canSpendCommand(null, { kind: 'mech', partStates: {}, cards: [] }), false);
check('a Drone never can', K.canSpendCommand(null, { kind: 'drone', partStates: {}, cards: [] }), false);

// ---------- handing one out, and spending one ----------
//
// Both move a token that already exists rather than creating or destroying one,
// which is what keeps the pool honest: a Command is only ever generated at the
// start of the Command Phase and only ever removed by a sweep.
// lastIndexOf, not indexOf: every command kind appears TWICE in commands.ts,
// once in check() and once in apply(), and check() comes first. Slicing from
// the first match reads the refusal branches and finds none of the writes,
// which is a test that passes for the wrong reason waiting to happen.
const cmdFns = cmdSrc.slice(
  cmdSrc.lastIndexOf("    case 'spendCommand': {"),
  cmdSrc.lastIndexOf("    case 'designate': {"),
);
if (!cmdFns.includes('syncCommandPool')) throw new Error('sliced the check branches, not the apply ones');
check('the spendCommand apply branch was located', cmdFns.includes("t.statuses = [...l, 'commandUsed']"), true);
check('coordinateCommand lands its token face-down', cmdFns.includes("to.statuses = [...(to.statuses ?? []), 'commandUsed']"), true);
// 4.15.4 flips, it does not remove: the token stays on the Torso until the End
// Phase. A removal here would quietly make Command Generation 4 worth 4 fewer
// tokens at the End Phase sweep than the rules say it holds.
check('spending flips rather than removes', /l\.splice\(at, 1\);\s*\n\s*t\.statuses = \[\.\.\.l, 'commandUsed'\]/.test(cmdFns), true);

// The capacity rule reads the board, so a Drone wearing a face-DOWN token is
// full. Reading only the face-up id would let a Drone take a second Command.
const capacity = cmdSrc.slice(cmdSrc.indexOf('export function heldCommands'), cmdSrc.indexOf('export function readyCommands'));
check('heldCommands counts both faces', capacity.includes("'command'") && capacity.includes("'commandUsed'"), true);
const ready = cmdSrc.slice(cmdSrc.indexOf('export function readyCommands'), cmdSrc.indexOf('export function commandIssuers'));
check('readyCommands counts only the face-up side', ready.includes("'commandUsed'"), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

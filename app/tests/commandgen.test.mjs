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
  ['type CardAction = any;', 'type GameData = any;', 'type Token = any;', 'type PartSlot = any;', 'type Timing = any;',
   'const pilotCard = (_d: any, t: any) => t.pilot;',
   'const tokenCards = (_d: any, t: any) => t.cards ?? [];',
   // Sliced from ticks.ts rather than hand-written, so the six Action Types the
   // grant can be scoped to cannot drift apart from the real map.
   readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8')
     .slice(
       readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8').indexOf('export const TIMING_OF_TYPE'),
       readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8').indexOf('export const LENGTH_OF_SIZE'),
     ),
   'const timingOf = (a: any) => (a.type ? TIMING_OF_TYPE[a.type] : undefined);',
  ].join('\n') + '\n' + kw,
);
const K = await import(tmp3.href);

const actionsOf = (id) => (byId.get(String(id))?.actions ?? []);
const coOf = (cid, aid) => K.commandCoordination(actionsOf(cid).find((a) => a.id === aid));

// The Data Link Pod's Coordination is NOT per-Action: its Passive fires when
// the Mech's Action Opportunity ends, so it is counted by
// coordinationOnOpportunityEnd instead and deliberately reads 0 here.
check('the Data Link Pod carries no per-Action Coordination', coOf('ZYBP-102', 'ZYBP-102_A'), 0);
check('the Dual Swift Launcher carries it', coOf('ZHLA-102', 'ZHLA-102_A'), 1);
check('the MR21 Railgun carries it', coOf('ZHRA-201', 'ZHRA-201_A'), 1);
// The Warrior Torso's Melee Synergy GRANTS the keyword to the Mech's Melee
// Actions rather than carrying it. Reading it as a Passive with Coordination 1
// would hand out a free Command every round off an Action nobody performs.
check('Melee Synergy grants rather than carries', coOf('172', '172_B'), 0);
check('and is recognised as a grant', K.grantsCommandCoordination(actionsOf('172').find((a) => a.id === '172_B')), true);

// Six Actions in the data mention the keyword, and they split three ways. Four
// carry it per-Action, one fires it when the Opportunity ends, one grants it to
// a whole Action type. Every one has to land in exactly one bucket, or a card
// either does nothing or hands out a Command it should not.
const carriers = [];
const enders = [];
const granters = [];
for (const c of list) {
  for (const a of c.actions ?? []) {
    const where = `${c.id}/${a.id}`;
    if (K.commandCoordination(a) > 0) carriers.push(where);
    if (K.endsOpportunityCoordination(a)) enders.push(where);
    if (K.coordinationGrant(a)) granters.push(where);
  }
}
check('four Actions carry Command Coordination per-Action', carriers.sort(), [
  'ZHLA-102/ZHLA-102_A', 'ZHLA-201/ZHLA-201_A', 'ZHRA-201/ZHRA-201_A', 'ZHRA-202/ZHRA-202_A',
].sort());
check('one fires it when the Opportunity ends', enders, ['ZYBP-102/ZYBP-102_A']);
check('one grants it to an Action type', granters, ['172/172_B']);
check('the three buckets do not overlap', [...carriers, ...enders, ...granters].length, new Set([...carriers, ...enders, ...granters]).size);

// Consuming. Two live on Actions and two on PILOT cards, which have no actions
// at all — reading only `actions` finds half of them and looks complete.
const spendActions = [];
for (const c of list) for (const a of c.actions ?? []) if (K.consumesCommand(a)) spendActions.push(`${c.id}/${a.id}`);
check('two Actions consume a Command', spendActions.sort(), ['ZHDR-304/ZHDR-304_B', 'ZYBP-202/ZYBP-202_A'].sort());
const spendPilots = list.filter((c) => c.category === 'pilot' && K.textConsumesCommand(c.traitDescription?.zh, c.traitDescription?.en));
check('and two pilots do, via traitDescription', spendPilots.map((c) => c.id).sort(), ['ZPA-35', 'ZPA-36']);
check('Chef is one of them', spendPilots.some((c) => c.name.en === 'Chef'), true);
// The English side has to survive words between the verb and the noun. The
// Harpy's printed card reads "consume 1 ADDITIONAL Command Token", which a
// tight `consume \d+ Command Token` misses while matching the other three —
// and Aster's card genuinely prints "Cmmand".
check('English: the Harpy wording matches', K.textConsumesCommand(undefined, 'may consume 1 additional Command Token and -2 Movement to drag 1 adjacent Ally Mech'), true);
check('English: the printed Cmmand typo matches', K.textConsumesCommand(undefined, 'may consume 1 Cmmand Token to restore 1 Link'), true);
check('English: an unrelated sentence does not', K.textConsumesCommand(undefined, 'Give 1 Command Token to 1 Ally Drone.'), false);

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

// ---------- WHEN the Drone sweep runs, not just what it does ----------
//
// 3.2.3 strips the Drones' tokens on the way OUT of the Command Phase and at no
// other transition: a token handed over later through Command Coordination
// stays on the Drone's card until the End Phase (4.15.4). The first cut of
// matchhud's glue ran the sweep on entering EVERY non-Command phase, which
// deleted a Coordination token one phase early — so both drivers' guards are
// pinned at the source level, leaving-check and sweep together.
const hudSrc = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const hudEnter = hudSrc.slice(hudSrc.indexOf('export function enterPhase'), hudSrc.indexOf('export function glueAfter'));
check('matchhud strips Drones only when LEAVING phase 0', /else if \(sc\.stage\.split\(':'\)\[1\] === '0'\) \{[\s\S]*?clearDroneCommands/.test(hudEnter), true);
const pgSrc = readFileSync(new URL('../src/playguide.ts', import.meta.url), 'utf8');
check('the guide keys the same sweep on the phase being left', /if \(leaving === '0'\) clearDroneCommands/.test(pgSrc), true);

// ---------- the two Passives that change WHEN or WHETHER Coordination fires ----------
//
// Neither carries the keyword for itself, and reading either as if it did hands
// out a free Command off an Action nobody performs. Both were inert until 82.
const pod = actionsOf('ZYBP-102').find((a) => a.id === 'ZYBP-102_A');
check('the Data Link Pod is an end-of-Opportunity trigger', K.endsOpportunityCoordination(pod), true);
check('so it carries no per-Action Coordination', K.commandCoordination(pod), 0);
check('and Melee Synergy is not an end-of-Opportunity one', K.endsOpportunityCoordination(actionsOf('172').find((a) => a.id === '172_B')), false);
// A Firing action with the keyword printed on it stays a per-Action carrier.
check('a printed carrier is not swept up as a trigger', K.endsOpportunityCoordination(actionsOf('ZHRA-201').find((a) => a.id === 'ZHRA-201_A')), false);

const podMech = { kind: 'mech', partStates: { backpack: 'intact' }, cards: [{ slot: 'backpack', card: byId.get('ZYBP-102') }] };
check('the Pod owes 1 Coordination when its Opportunity ends', K.coordinationOnOpportunityEnd(null, podMech), 1);
check('a destroyed Pod owes none', K.coordinationOnOpportunityEnd(null, { ...podMech, partStates: { backpack: 'destroyed' } }), 0);
check('a Mech without one owes none', K.coordinationOnOpportunityEnd(null, { kind: 'mech', partStates: {}, cards: [] }), 0);
check('a Drone never owes any', K.coordinationOnOpportunityEnd(null, { kind: 'drone', partStates: {}, cards: [] }), 0);

// Melee Synergy grants Coordination 1 to this Mech's MELEE Actions only.
const synergy = actionsOf('172').find((a) => a.id === '172_B');
check('the grant reads its scope off the card', K.coordinationGrant(synergy), { timing: 'melee', n: 1 });
check('a plain carrier grants nothing', K.coordinationGrant(actionsOf('ZHRA-201').find((a) => a.id === 'ZHRA-201_A')), null);

const warrior = { kind: 'mech', partStates: { torso: 'intact' }, cards: [{ slot: 'torso', card: byId.get('172') }] };
const meleeAct = { id: 'X', type: 'Melee', description: { zh: '', en: '' } };
const firingAct = { id: 'Y', type: 'Firing', description: { zh: '', en: '' } };
check('a Melee Action on the Warrior Torso gains 1', K.coordinationFor(null, warrior, meleeAct), 1);
check('a Firing Action on it gains nothing', K.coordinationFor(null, warrior, firingAct), 0);
check('the grant stacks onto a printed carrier', K.coordinationFor(null, warrior, { ...meleeAct, description: { zh: '· 指令协调1', en: '' } }), 2);
check('a destroyed Torso grants nothing', K.coordinationFor(null, { ...warrior, partStates: { torso: 'destroyed' } }, meleeAct), 0);
check('another squad’s Mech is unaffected', K.coordinationFor(null, { kind: 'mech', partStates: {}, cards: [] }, meleeAct), 0);

// Both drivers must ask coordinationFor rather than the bare keyword, or a
// granted Coordination silently never applies.
check('the guide asks coordinationFor', /const coord = coordinationFor\(this\.data, t, row\.action\)/.test(pgSrc), true);
check('the Match Centre asks coordinationFor', /const upTo = coordinationFor\(ctx\.data, t, act\)/.test(hudSrc), true);
check('the guide offers on Opportunity end', /coordinationOnOpportunityEnd\(this\.data, t\)/.test(pgSrc), true);
check('the Match Centre offers on Opportunity end', /coordinationOnOpportunityEnd\(ctx\.data, t\)/.test(hudSrc), true);

// ---------- the four consuming effects, each hooked where it triggers ----------
//
// None of the four is "perform an Action and spend a token", which is why they
// live in four different places rather than behind one button.
const combatSrc = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

// Chef: the exchange is COUNTED on the combat state, never applied to a
// rendered total — the attack tally is derived again at the attack step and at
// resolve, so a total edited in one place would not survive the other.
check('Chef exchange lives on the combat state', /eyeSwaps: number;/.test(combatSrc), true);
// FOUR readers now: the attack-step summary, resolve(), the Concussion/Wrecking
// drain, and the step card that shows the roll's result once the step is behind
// you. Every one goes through the same tally, which is the point of counting
// them: a new reader has to come here and say so rather than deriving its own
// total, because a total derived twice is two totals that can disagree.
check('every attack reader goes through attackIcons', (combatSrc.match(/this\.attackIcons\(c\)/g) ?? []).length, 4);
// attackIcons is the ONLY thing allowed to read the raw attack roll; everything
// else must come through it, or an exchange shows in one place and not another.
const attackIconsBody = combatSrc.slice(
  combatSrc.indexOf('private attackIcons(c: Ctx)'),
  combatSrc.indexOf('private resolve()'),
);
check('attackIcons reads the raw roll', /countIcons\(c\.attackRoll/.test(attackIconsBody), true);
// TWO readers now, not one. eyeContest is the second, and it is not a competing
// total: it derives the {Eye} SPLIT that attackIcons and attackIconsPerDie both
// consume, so it sits upstream of both rather than beside them. Still pinned to
// a hard number, because the rule this guards is unchanged -- a THIRD reader
// deriving its own total is exactly what must not happen, and would fail here.
check('and only attackIcons and the contest derivation do',
  (combatSrc.match(/countIcons\(c\.attackRoll/g) ?? []).length, 2);
// Pulse and Ion Weapons trade {Lightning} for {Heavy Hit} inside the same
// single reader, so the attack-step summary and resolve() can never disagree
// about the exchange. Ion only fires against a target bearing a Fragile Token.
check('the Lightning exchange rides attackIcons', /lightning: 0, heavyHit: \(counts\.heavyHit \?\? 0\) \+ counts\.lightning/.test(attackIconsBody), true);
check('Ion is gated on the Fragile Token', /ex === 'ion' && statusCount\(c\.defender\.statuses, 'fragile'\) <= 0/.test(combatSrc), true);
check('the swap count is written for the notes', /c\.lightningSwapped = ex \? counts\.lightning \?\? 0 : 0/.test(attackIconsBody), true);

// The clamp is what stops an exchange surviving a reroll that removed the Eyes.
// 503 Close Assault later folded a FREE swap in beside the Command-Token one
// (Math.max of the two, so neither double-counts an icon). The outer clamp is
// the guarantee and still has to hold: no exchange may outlive the Eyes.
// Both now live in eyeContest, and are matched INSIDE it rather than anywhere in
// the file -- a tighter assertion than the one this replaces, which would have
// been satisfied by the arithmetic sitting anywhere at all.
const eyeContestBody = (() => {
  const a = combatSrc.indexOf('private eyeContest(c: Ctx)');
  const b = combatSrc.indexOf('private attackIconsPerDie');
  if (a < 0 || b <= a) throw new Error('eyeContest slice runs backwards or is missing');
  return combatSrc.slice(a, b);
})();
check('the exchange is clamped to the Eyes actually showing',
  /Math\.min\(Math\.max\(paid, free\), eyes\)/.test(eyeContestBody), true);
check('and "eyes" is the roll\'s own Eye count, so the clamp means what it says',
  /const eyes = counts\.eye \?\? 0;/.test(eyeContestBody), true);
check('and the free swap cannot double-count with the paid one',
  /Math\.max\(paid, free\)/.test(eyeContestBody), true);
// The attacker's assignment is clamped to the contest for the same reason the
// exchange is clamped to the Eyes: a Focus reroll can shrink it underneath.
check('and the attacker\'s assignment is clamped to what is contested',
  /Math\.min\(Math\.max\(c\.eyeToLight \?\? 0, 0\), contested\)/.test(eyeContestBody), true);
check('a fresh roll clears the exchange', /c\.eyeSwaps = 0;/.test(combatSrc), true);
check('Chef is gated on a Melee Action', /timingOf\(c\.action\) !== 'melee'/.test(combatSrc), true);
check('Chef needs a face-up token', /statusCount\(c\.attacker\.statuses, 'command'\)/.test(combatSrc), true);

// Whistle: a SECOND source of rerolls, funded by a nearby Ally Mech's token
// rather than by Link, so it must not touch the Focus allowance.
check('Whistle does not consume the Focus reroll', /Whistle reroll[\s\S]{0,900}?c\.rerolls\[which\]\[side\] = true/.test(combatSrc), false);
check('Whistle spends the FUNDER’s token, not the roller’s', /kind: 'spendCommand', seat: funders\[0\]\.side, uid: funders\[0\]\.uid/.test(combatSrc), true);
const wf = src.slice(src.indexOf('export function whistleFunders'), src.indexOf('// ---------- Charge (rulebook 4.14) ----------'));
check('Whistle only funds a Drone roll', /roller\.kind !== 'drone'/.test(wf), true);
check('Whistle checks Range 4', /WHISTLE_RANGE = 4/.test(src) && /rangeBetween\(m, roller\)\.range <= WHISTLE_RANGE/.test(wf), true);
check('Whistle needs a face-up token on the Mech', /statusCount\(m\.statuses, 'command'\) <= 0/.test(wf), true);

// Harpy: the -2 comes out of the ALLOWANCE, so the drag is declared before the
// route is drawn. Offering it afterwards would show a reach the player cannot
// have, which is the whole reason it is not in the post-move chain.
// The offer itself lives in commandpick.ts, SHARED by freeplay and the Match
// Centre, so its gates are pinned there and each page is pinned to consume it.
const pickSrc = readFileSync(new URL('../src/commandpick.ts', import.meta.url), 'utf8');
// The -2 was later lifted into a named `range` so the PLAN and the PAINT read
// one value. Before that the highlight showed two Grids the unit could not use,
// while the route itself was capped correctly — which is what made the lie hard
// to spot (BUG-2). The ordering pinned here is unchanged: declare, then set the
// allowance, because the -1 comes out of the allowance (GoF 1.021; was -2
// when this pin was written from the card scan).
check('the Harpy drag is declared before the move',
  /const drag = await offerHarpyDrag\(t, steps\);[\s\S]{0,600}?const range = drag \? steps - 1 : steps/.test(mainSrc), true);
check('and the plan and the paint both take that one allowance',
  /steps: range/.test(mainSrc) && /showReachable\([^)]*range/.test(mainSrc), true);
check('and it needs a Mech holding a face-up token', /readyCommands\(m\) > 0/.test(pickSrc), true);
check('the dragged unit must be adjacent', /inContact\(t, o\)/.test(pickSrc), true);
check('the Match Centre asks the same shared offer', /offerHarpyDrag\(ctx\.data, s, t, maneuverRange\(ctx\.data, t\)\)[\s\S]{0,400}?movePlan\.steps -= 1/.test(hudSrc), true);
check('and tows into the vacated Grid there too', /drag[\s\S]{0,600}?standingSpot\(prevGrid\.c, prevGrid\.r/.test(hudSrc), true);
check('no free spot means no token is spent', /could not be dragged[\s\S]{0,80}not consumed/.test(mainSrc) && /could not be dragged[\s\S]{0,80}not consumed/.test(hudSrc), true);
// Two audit catches, pinned so they stay caught. An Automatic Phase drone move
// is not a Command Movement, so a guided game only offers the drag in phase 0;
// and the ally lands in the Grid the Harpy VACATED before falling back to the
// final one — a Large Mech fills a whole Grid, so the final-Grid spot can never
// fit one and the card would never be able to drag a Mech at all.
check('the drag is only offered on a Command Movement', /state\.script && PHASES\[state\.round\.phase\] !== 'Command'/.test(pickSrc), true);
check('the ally is towed into the vacated Grid first', /prevGrid[\s\S]{0,220}?standingSpot\(prevGrid\.c, prevGrid\.r/.test(mainSrc), true);

// Aster: the only one whose whole effect sits inside a phase we already drive.
check('Aster is capped by the once-per-round ledger', /oncePerRound\.includes\(asterKey\(state, t\.uid\)\)/.test(cmdSrc), true);
check('Aster is gated to the Command Phase', /Aster restores Link during the Command Phase/.test(cmdSrc), true);
// The port half: both pages render the button off the same blockers and drive
// the same shared dialog, so grey reasons and target lists cannot diverge.
check('the guide renders Aster off the shared blockers', /asterBlockers\(s, t\)/.test(pgSrc), true);
check('the Match Centre renders Aster off the same blockers', /asterBlockers\(s, t\)/.test(hudSrc), true);
check('both pages drive the shared runAster', /runAster\(this\.data, s, uid/.test(pgSrc) && /runAster\(ctx\.data, s, t\.uid/.test(hudSrc), true);
check('Aster refuses a target already at full Link', /is already at full Link/.test(cmdSrc), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

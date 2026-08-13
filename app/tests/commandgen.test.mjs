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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

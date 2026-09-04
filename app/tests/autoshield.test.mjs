// 自动盾牌 Automatic Shield (FAQ A2/A12), against the REAL card database.
//
//   "When Adjacent Ally Units are the target of Firing Actions and Line of Sight
//   also passes through this Unit, the target of the Attack WILL BE this Unit."
//
// It is the only keyword in the game that changes the DEFENDER of a declared
// attack, and it is mandatory — "will be", not "may". Two halves are tested
// here: the geometry and the card reader, which run for real off rules.ts,
// cards.json and units.ts; and the wiring into combat.ts, which has no DOM
// harness and so is pinned by source shape the way defensereaction.test.mjs
// pins its chain.
//
// Five cards carry it: ZHDR-101 Scutum, ZHDR-301 Apologist, 295 "White Dwarf"
// Bit, and the 552/553 Mech arms, which gain it in Defensive Stance only.
import { readFileSync, writeFileSync } from 'node:fs';

const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const cut = (s, from, to, what) => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a);
  if (a < 0 || b < 0 || b <= a) throw new Error(`could not locate ${what}`);
  return s.slice(a, b);
};

// rules.ts from LG to the end, exactly as _protection.slice.ts takes it — the
// geometry AND protectionFor, because the last section here is the divide
// between ZHDR-101's two clauses and needs both.
//
// The units.ts cuts are 1102-1194 (the shield block), 2237-2240 (alive),
// 2552-2559 (isElectronicAttack) and 2806-2825 (tokenCards) as the file stands.
// Checked against every other slice range in this suite before adding: none of
// the four overlaps another cut in this file.
const rStart = rules.indexOf('let GRIDS');
if (rStart < 0) throw new Error('could not locate the sight rules in rules.ts');
const body = 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n'
  + 'type Card = any;\ntype CardAction = any;\ntype GameData = any;\ntype PartSlot = any;\n'
  + 'const PART_SLOTS = ["torso", "chasis", "leftHand", "rightHand", "backpack"];\n'
  + rules.slice(rStart)
  + cut(units, 'export function tokenCards', '// ---------- defender-side dice keywords', 'tokenCards')
  + cut(units, 'function alive(t: Token)', 'function coversGrid', 'the alive helper')
  + cut(units, 'export function isElectronicAttack', '// `loans` is passed ONLY where', 'isElectronicAttack')
  + cut(units, '// ---------- 自动盾牌 Automatic Shield', '// 503 Close Assault', 'the Automatic Shield block');
const tmp = new URL('./_autoshield.slice.ts', import.meta.url);
writeFileSync(tmp, body);
const { automaticShieldFor, automaticShieldOn, lineCrossesUnit, losBetween, protectionFor, rangeBetween } = await import(tmp.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
const byId = new Map(cards.map((c) => [String(c.id), c]));
const data = { byId };

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

console.log('Automatic Shield — FAQ A2/A12\n');

// ---------- fixtures ----------
//
// Small-cell coordinates, as everywhere else: a Large Grid is 3x3 of them.
// Attacker size 3 at (1,4) is Large Grid (0,1); the target size 3 at (16,4) is
// Grid (5,1); a shield at (13,5) is Grid (4,1), which is Adjacent to the target
// and standing in the line.
const unit = (uid, col, row, over = {}) => ({
  uid, side: over.side ?? 's1', kind: over.kind ?? 'drone', col, row,
  size: over.size ?? 1, facing: 0, aerial: over.aerial ?? false,
  label: over.label ?? `u${uid}`, partStates: {}, ...over,
});
const attacker = unit(1, 1, 4, { size: 3, side: 's1', kind: 'mech', label: 'Wolf' });
const target = unit(2, 16, 4, { size: 3, side: 's2', kind: 'mech', label: 'Bear' });
// The real Scutum, so the card reader is exercised by every geometry case too.
const scutum = (uid, col, row, over = {}) =>
  unit(uid, col, row, { side: 's2', kind: 'drone', cardId: 'ZHDR-101', stance: 'defensive', label: 'Scutum', ...over });
const firing = { id: 'f', type: 'Firing', name: { en: 'Rifle' } };
const board = (...extra) => [attacker, target, ...extra];
const shieldOf = (r) => (r ? r.shield.label : null);

// ---------- the geometry: A12's two clauses ----------
//
// "Adjacent" and "line of sight passes through" are asked separately, and both
// have to hold. losBetween is handed EMPTY terrain and a ONE-element token list,
// which is the same idiom protectionFor already uses to ask whether one
// particular unit is in the way.

const inLine = scutum(3, 13, 5);
check('a shield Adjacent to the target and in the line takes the shot',
  shieldOf(automaticShieldFor(data, board(inLine), attacker, target, firing)), 'Scutum');
check('and the geometry underneath it really is obstructed and adjacent',
  [losBetween(attacker, target, [], [inLine]), rangeBetween(inLine, target).adjacent], ['obstructed', true]);

// In the line but two Grids short of the target: clause 1's ground, not A12's.
const farUp = scutum(3, 7, 5);
check('a shield in the line but not Adjacent does not fire',
  automaticShieldFor(data, board(farUp), attacker, target, firing), null);
check('and it is the adjacency that refuses it, not the line',
  [losBetween(attacker, target, [], [farUp]), rangeBetween(farUp, target).adjacent], ['obstructed', false]);

// Adjacent but off the line, and adjacent but standing BEHIND the target: both
// are ordinary neighbours, and A12 asks for both clauses.
check('a shield Adjacent but off the line does not fire',
  automaticShieldFor(data, board(scutum(3, 13, 7)), attacker, target, firing), null);
check('nor does one standing behind the target',
  automaticShieldFor(data, board(scutum(3, 19, 5)), attacker, target, firing), null);

// ---------- 295 and Aerial: RULED AND BUILT 2026-08-24 ----------
//
// This block used to fail BY DESIGN. All three "White Dwarf" Bit faces are
// flyingOrElevated: 'elevated', which isAerial reads as Aerial (FAQ E1), and the
// shield test was `losBetween(...) !== 'clear'` — the OBSTRUCTION question,
// which skips Aerial tokens as obstructors. So the one card whose entire rules
// text is this keyword could never fire.
//
// OTTO's ruling: implement what the card SAYS. The rulebook glossary and the
// GoF 1.021 list both print "Line of Sight also passes through this Unit", not
// "obstructs" — and those two questions coincide for every ground shield and
// part company only for an Aerial one. `lineCrossesUnit` asks the printed
// question as pure geometry, so no exception had to be invented.
//
// The scope was measured before the change: ZERO Aerial units are size 3, so
// Unit Protection (4.5.3, Large only) cannot be reached by this even though it
// calls the same losBetween. Card 295 is the only carrier affected.
check('the crossing test sees an Aerial unit the obstruction test skips',
  [losBetween(attacker, target, [], [scutum(3, 13, 5, { aerial: true })]),
    lineCrossesUnit(attacker, target, scutum(3, 13, 5, { aerial: true }))],
  ['clear', true]);
check('so an Aerial shield in a blocking position now fires',
  automaticShieldFor(data, board(scutum(3, 13, 5, { aerial: true })), attacker, target, firing)?.shield?.uid, 3);
check('295 is elevated on every face, which isAerial reads as Aerial (E1)',
  ['293', '294', '295'].map((id) => byId.get(id)?.flyingOrElevated), ['elevated', 'elevated', 'elevated']);
// And the ground case is UNCHANGED, which is what makes the swap safe: the two
// questions have the same answer whenever nothing Aerial is involved.
check('a ground shield still fires exactly as before',
  automaticShieldFor(data, board(scutum(3, 13, 5)), attacker, target, firing)?.shield?.uid, 3);
check('and a ground unit off the line still does not',
  automaticShieldFor(data, board(scutum(3, 19, 5)), attacker, target, firing), null);
check('an Aerial TARGET cannot be shielded either, because the line is never obstructed',
  automaticShieldFor(data, [attacker, { ...target, aerial: true }, inLine], attacker, { ...target, aerial: true }, firing), null);
check('and neither can a shot from an Aerial attacker be redirected',
  automaticShieldFor(data, [{ ...attacker, aerial: true }, target, inLine], { ...attacker, aerial: true }, target, firing), null);

// ---------- which Actions ----------
//
// The printed rule says "the target of Firing Actions", so Melee, Electronic and
// Detonation are all out. A Firing-TYPED Electronic Attack is not a Firing
// Action for this purpose, which is the same reading Emergency Smoke takes.
check('a Melee Action never redirects',
  automaticShieldFor(data, board(inLine), attacker, target, { ...firing, type: 'Melee' }), null);
check('nor a Passive',
  automaticShieldFor(data, board(inLine), attacker, target, { ...firing, type: 'Passive' }), null);
check('nor a Firing-typed Electronic Attack',
  automaticShieldFor(data, board(inLine), attacker, target,
    { ...firing, gameRules: [{ effects: [{ type: 'electronic', mode: 'attack' }] }] }), null);
check('and the prose form of an Electronic Attack is caught too',
  automaticShieldFor(data, board(inLine), attacker, target,
    { ...firing, description: { zh: '· 电子攻击' } }), null);

// ---------- who may shield whom ----------
//
// "Adjacent ALLY Units": the shield is by definition the target's own ally, so
// an allied shot — which freeplay lets through past a warning (Supplement 1.4.1)
// — has nothing to redirect. Deliberate, not an oversight.
const friendlyTarget = { ...target, side: 's1' };
check('a shot at your own unit is never redirected',
  automaticShieldFor(data, [attacker, friendlyTarget, inLine], attacker, friendlyTarget, firing), null);
check('a shield on the ATTACKER\'s side does not shield the enemy target',
  automaticShieldFor(data, board(scutum(3, 13, 5, { side: 's1' })), attacker, target, firing), null);
check('a destroyed shield shields nothing',
  automaticShieldFor(data, board(scutum(3, 13, 5, { partStates: { main: 'destroyed' } })), attacker, target, firing), null);
check('and one that is not on the board yet shields nothing either',
  automaticShieldFor(data, board(scutum(3, 13, 5, { deployed: false })), attacker, target, firing), null);
// The target cannot shield itself, and neither can the attacker be conscripted.
check('the target is not a candidate to shield itself',
  automaticShieldFor(data, [attacker, { ...target, cardId: 'ZHDR-101', kind: 'drone' }],
    attacker, { ...target, cardId: 'ZHDR-101', kind: 'drone' }, firing), null);

// ---------- two shields: the deterministic pick, and the others named ----------
//
// Nothing printed says WHO chooses when two shields both qualify; at the table
// the defending player would. Slice 1 picks the nearest to the attacker, then
// the lowest uid, and names the rest so the players can override it by hand.
// See explicitlyOut 3 for the machinery a real answer would need.
// Grid (4,1) is Range 4 from the attacker and grid (4,2) is Range 5, so `far`
// really does lose on distance rather than on the uid tiebreak below.
const near = scutum(4, 13, 4, { label: 'Near' });
const far = scutum(5, 13, 6, { label: 'Far' });
const pair = automaticShieldFor(data, board(near, far), attacker, target, firing);
check('with two qualifying shields the nearest to the attacker is taken',
  [pair.shield.label, pair.others.map((t) => t.label)], ['Near', ['Far']]);
check('and the two really are at different Ranges from the attacker',
  [rangeBetween(attacker, near).range, rangeBetween(attacker, far).range], [4, 5]);
// Equal range falls back to the uid so both clients sort the same board the same
// way — only the attacker's ever publishes the result, but a divergent sort here
// would still be a bug waiting for a rollback to expose it. Both of these sit in
// grid (4,1), so the range is a genuine tie.
const tieA = scutum(9, 12, 5, { label: 'Tie9' });
const tieB = scutum(6, 14, 5, { label: 'Tie6' });
check('a tie on range falls back to the lowest uid',
  automaticShieldFor(data, board(tieA, tieB), attacker, target, firing).shield.label, 'Tie6');
check('and that really was a tie',
  [rangeBetween(attacker, tieA).range, rangeBetween(attacker, tieB).range], [4, 4]);

// ---------- two designations collapsing onto ONE shield ----------
//
// The state the split screen had never seen before this: one Scutum standing
// between the attacker and two different enemies is the shield for both, so one
// Multi-Target can put two sequences on the same unit. That is the literal
// reading of a mandatory "will be", and it is what the app now does.
const second = unit(7, 16, 7, { size: 3, side: 's2', kind: 'mech', label: 'Boar' });
const between = scutum(8, 13, 6, { label: 'Both' });
check('one shield can be the answer for two different designations',
  [shieldOf(automaticShieldFor(data, [attacker, target, second, between], attacker, target, firing)),
   shieldOf(automaticShieldFor(data, [attacker, target, second, between], attacker, second, firing))],
  ['Both', 'Both']);

// ---------- the card reader ----------
//
// partKeyword's shape rather than a call to partKeyword: that returns only the
// FIRST match, and a Mech can hold a 552 in one hand and a 553 in the other.
const drone = (cardId, over = {}) => ({
  uid: 30, side: 's2', kind: 'drone', cardId, stance: 'defensive', partStates: {}, ...over,
});
const mech = (slots, over = {}) => ({
  uid: 31, side: 's2', kind: 'mech', mech: slots, stance: 'offensive', partStates: {}, ...over,
});

check('ZHDR-101 Scutum carries Automatic Shield', automaticShieldOn(data, drone('ZHDR-101')), true);
check('ZHDR-301 Apologist carries it', automaticShieldOn(data, drone('ZHDR-301')), true);
check('295 White Dwarf Bit carries it', automaticShieldOn(data, drone('295')), true);
check('its sibling Vanguard does not', automaticShieldOn(data, drone('ZHDR-102')), false);
check('a destroyed Drone carries nothing', automaticShieldOn(data, drone('ZHDR-101', { partStates: { main: 'destroyed' } })), false);
// A Drone plays the Stance printed on its card and setStance refuses anything
// that is not a Mech, so the three Drones need no Stance gate of their own.
check('the three Drones all print Defensive Stance',
  ['ZHDR-101', 'ZHDR-301', '295'].map((id) => byId.get(id)?.stance), ['defensive', 'defensive', 'defensive']);

// The 552/553 gate. The card-level `keywords` array carries 自动盾牌
// UNCONDITIONALLY on both arms; only the printed action text says it is gained
// in Defensive Stance. That text match is the ONLY thing separating two Mech
// arms from three Drones, so both halves are pinned: cards.json is regenerated
// from the community bundle, and a re-scan that reflowed the line would
// otherwise silently ungate them into shielding in every Stance.
check('552 prints the gate verbatim',
  byId.get('552')?.actions?.[0]?.description?.zh,
  '· 在防御姿态下，本机可以指定本部件受击。\r\n· 【防御姿态】获得自动盾牌');
check('553 prints the same gate',
  byId.get('553')?.actions?.[0]?.description?.zh,
  '· 在防御姿态下，本机可以指定本部件受击。\r\n· 【防御姿态】获得自动盾牌');
check('and both still carry the keyword unconditionally at card level',
  ['552', '553'].map((id) => (byId.get(id)?.keywords ?? []).some((k) => k.key === '自动盾牌')), [true, true]);
check('552 in Offensive Stance does not shield', automaticShieldOn(data, mech({ rightHand: '552' })), false);
check('552 in Defensive Stance does', automaticShieldOn(data, mech({ rightHand: '552' }, { stance: 'defensive' })), true);
check('553 in Defensive Stance does too', automaticShieldOn(data, mech({ leftHand: '553' }, { stance: 'defensive' })), true);
check('and a Shutdown Mech holding one does not',
  automaticShieldOn(data, mech({ rightHand: '552' }, { stance: 'shutdown' })), false);
// The shield is the PART, not the Mech: a blown arm stops shielding, and the
// other hand carries on. This is the case partKeyword itself would get wrong.
check('a destroyed 552 arm stops shielding',
  automaticShieldOn(data, mech({ rightHand: '552' }, { stance: 'defensive', partStates: { rightHand: 'destroyed' } })), false);
check('but the intact 553 in the other hand carries on',
  automaticShieldOn(data, mech({ rightHand: '552', leftHand: '553' },
    { stance: 'defensive', partStates: { rightHand: 'destroyed' } })), true);
// The pilot slot is skipped, the same way every other part reader skips it.
check('a Pilot card is never read for the keyword',
  automaticShieldOn(data, mech({ pilot: 'ZHDR-101' }, { stance: 'defensive' })), false);
// The full list, so a sixth card appearing gets noticed rather than quietly
// gaining a mechanic nobody tested it with.
check('exactly five cards carry the keyword',
  cards.filter((c) => (c.keywords ?? []).some((k) => /自动盾牌|Automatic\s*Shield/i.test(`${k.key ?? ''} ${k.en ?? ''}`)))
    .map((c) => String(c.id)).sort(),
  ['295', '552', '553', 'ZHDR-101', 'ZHDR-301']);

// A 552 arm really does shield on the board, not just in the reader.
const armed = unit(9, 13, 5, { side: 's2', kind: 'mech', size: 1, label: 'Sd3', mech: { rightHand: '552' }, stance: 'defensive' });
check('a Mech holding a 552 in Defensive Stance takes the shot',
  shieldOf(automaticShieldFor(data, board(armed), attacker, target, firing)), 'Sd3');
check('and the same Mech in Offensive Stance does not',
  automaticShieldFor(data, board({ ...armed, stance: 'offensive' }), attacker, target, firing), null);

// ---------- ZHDR-101's two clauses divide on adjacency ----------
//
// Clause 1 is Mobile Bunker: a medium Drone that may provide Unit Protection to
// Allies. Clause 2 is this. In the geometry clause 2 covers — Adjacent AND in
// the line — the shot now lands on the Scutum, which cannot protect ITSELF, so
// the +2 disappears there. That is correct: A12 replaces the target.
//
// Whoever shipped clause 1 will read that as a regression, which is why it is
// spelled out here and in protection.test.mjs.
const isBunker = (t) => t.uid === 3;
check('clause 1: a Scutum in the line but NOT Adjacent still grants +2',
  protectionFor(attacker, target, firing, [], board(farUp), [], false, isBunker).white, 2);
check('clause 2: the same Scutum Adjacent and in the line takes the shot instead',
  shieldOf(automaticShieldFor(data, board(inLine), attacker, target, firing)), 'Scutum');
// And once it IS the defender, losBetween excludes it from obstructing itself,
// so there is nothing left for clause 1 to pay out.
check('and it cannot protect itself once it is the one being shot at',
  protectionFor(attacker, inLine, firing, [], board(inLine), [], false, isBunker).white, 0);

// ---------- the wiring into combat.ts ----------
//
// No DOM harness reaches AttackHelper, so this half pins the shape the way
// defensereaction.test.mjs pins its chain. Every line below is a place the
// feature dies silently if it moves.
const combat = src('combat.ts');

// DESIGNATION timing, and the departure it is: openSequence recomputes
// protection and losNote per sequence, so the app already lets Knockback between
// sequences move the numbers. The redirect deliberately does NOT follow that,
// because A12 keys on designation and B7 settles the whole Action at
// declaration. There are exactly three doors an attack is designated through.
check('the swap fires at exactly three sites',
  (combat.match(/this\.shieldSwap\(/g) ?? []).length, 3);
// SLICE the body rather than budgeting characters for it. This was a character
// window (2200, then 2600) and it had to be re-tuned every time openSequence
// grew, most recently when Armor Piercing added its per-sequence note and again
// when the single renderer landed. A budget that needs maintenance fails on
// growth rather than on the thing it guards, which is a test that cries wolf.
// Cutting from the declaration to the next one says exactly what is meant: no
// shieldSwap call lives inside this method.
const openSeq = combat.slice(
  combat.indexOf('private openSequence('),
  combat.indexOf('private multiCandidates'),
);
check('openSequence was located and is the whole body', openSeq.length > 500, true);
check('openSequence gets no swap of its own', openSeq.includes('shieldSwap'), false);
check('start() carries the redirect flag',
  /start\(\s*\n\s*attacker: Token,[\s\S]{0,320}?redirect = true,/.test(combat), true);
check('and it is switched off by Explosion and Interception as well',
  /const swap = \(redirect && !explosion && !intercept\) \? this\.shieldSwap\(attacker, defender, action\) : null;/.test(combat), true);
// The board is re-read ONLY on the swap branch, so an attack on a board with no
// Automatic Shield on it is byte-identical to what it was before.
check('the board is re-read only when a swap actually fired',
  /if \(swap\) \{\s*\n\s*defender = swap\.shield;[\s\S]{0,400}?const rb = this\.readBoard\(attacker, defender, action\);/.test(combat), true);
// RISK 1: two callers hand start() carefully-worded fixed notes, and both are
// excluded by their own flag rather than by inspection.
check('the Interception note is still handed in with the intercept flag set',
  /Interception: line of sight always exists[\s\S]{0,120}?true,\s*\n\s*\);/.test(src('main.ts')), true);
check('and the Explosion note with the explosion flag set',
  /'Explosion damage: no line of sight or facing check\.', 0, '', true\)/.test(src('main.ts')), true);
// RISK 2: the single easiest line in this change to drop in review.
check('the FAQ B8 bonus attack switches the redirect OFF',
  /must take the same target as the attack that granted it \(FAQ B8\)\.',\s*\n\s*0, '', false, false, false\)/.test(combat), true);
check('and it is the ONLY call site that does',
  (combat.match(/false, false, false\)/g) ?? []).length, 1);

// startMulti settles the redirect before the pool is ever shown, so m.targets
// carries the shield and advanceMulti's reaction crediting and `at.penetrated`
// are right with no write-back.
check('startMulti swaps before it builds the target list',
  /const swap = this\.shieldSwap\(attacker, primary, action\);\s*\n\s*const first = swap\?\.shield \?\? primary;/.test(combat), true);
check('and the first row records both who was designated and who is shot',
  /targets: \[\{ defender: first, declared: swap \? primary : undefined,/.test(combat), true);
check('MultiState carries the declared unit', /declared\?: Token;/.test(combat), true);

// The four split-screen edits, all forced by two designations collapsing onto
// one shield.
check('multiCandidates dedups on what was DESIGNATED',
  /new Set\(m\.targets\.map\(\(t\) => \(t\.declared \?\? t\.defender\)\.uid\)\)/.test(combat), true);
check('the + button runs the swap and labels the redirect',
  /\+ \$\{u\.label\}\$\{swap \? ` → \$\{swap\.shield\.label\}` : ''\}/.test(combat), true);
check('and pushes the shield with the designation beside it',
  /m\.targets\.push\(\{ defender: swap\?\.shield \?\? u, declared: swap \? u : undefined, red: 0, yellow: 0 \}\)/.test(combat), true);
check('the Drop button compares rows by identity, not by uid',
  /if \(row !== m\.targets\[0\]\)/.test(combat) && /m\.targets\.filter\(\(t\) => t !== row\)/.test(combat), true);
check('the row label names the unit the dice will land on',
  /row\.declared \? `\$\{row\.declared\.label\} → \$\{row\.defender\.label\}` : row\.defender\.label/.test(combat), true);
check('and so does the Begin button',
  /m\.targets\[0\]\.declared \? `\$\{m\.targets\[0\]\.declared\.label\} → \$\{m\.targets\[0\]\.defender\.label\}`/.test(combat), true);
// openSequence hands each sequence a FRESH log, so the declaration line has to
// carry the redirect too or the log the player reads during the dice never
// mentions the unit they actually clicked.
check('and the declaration line names both ends of a redirected row',
  /m\.targets\.map\(\(t\) => `\$\{t\.declared \? `\$\{t\.declared\.label\} → ` : ''\}\$\{t\.defender\.label\}/.test(combat), true);

// FAQ B7 owes each defender its reaction once per ACTION, and two sequences on
// one shield must not offer its Emergency Smoke twice.
check('flushReactions de-duplicates per unit per reaction',
  /const key = `\$\{p\.defender\.uid\}\|\$\{p\.reaction\.actionId\}`;/.test(combat), true);
check('and skips the repeat rather than firing it',
  /if \(seen\.has\(key\)\) continue;\s*\n\s*seen\.add\(key\);\s*\n\s*this\.onReaction/.test(combat), true);
// Proof the dedup key is the right one for the collapse case above: two
// sequences, one shield, one debt.
const pending = [{ defender: between, reaction: { actionId: 'x' } }, { defender: between, reaction: { actionId: 'x' } }];
check('so one shield hit by two sequences owes one reaction, not two',
  new Set(pending.map((p) => `${p.defender.uid}|${p.reaction.actionId}`)).size, 1);

// The log has to say why the name in the declaration is not the unit that was
// clicked, and it has to name the shields it beat.
check('the note cites the ruling and says it is mandatory',
  /Automatic Shield: \$\{swap\.shield\.label\} is Adjacent[\s\S]{0,400}?mandatory, "will be", not "may"[\s\S]{0,40}?FAQ A2\/A12/.test(combat), true);
check('and it says the on-hit effects travel with the target (A2)',
  /Suppression and other on-hit effects transfer with the target/.test(combat), true);
check('the shields it beat are named so the table can overrule the pick',
  /swap\.others\.length[\s\S]{0,200}?nothing printed says who picks/.test(combat), true);

// ---------- disclosure on both pages ----------
//
// Read-only, one line each. Neither can change the outcome, so a page that
// forgets it renders less rather than differently — which is why there is no
// call-site grep of the kind protection.test.mjs needs for protectionFor.
const hud = src('matchhud.ts'), main = src('main.ts');
check('the Match Centre target list discloses the redirect',
  /automaticShieldFor\(ctx\.data, s\.tokens, by, t, a\)/.test(hud)
    && /⤳ Automatic Shield: \$\{shield\.shield\.label\} takes this shot \(FAQ A12\)/.test(hud), true);
// The row stays pressable: the redirect is mandatory, so there is nothing to
// veto. Only ✕ blocked line of sight disables a row, and a unit in the way
// obstructs without blocking.
check('and the row is still pressable, because the redirect is not a veto',
  // Only ✕ line of sight disables a row - a camouflaged target is pressable
  // since the free Scan on designation (FAQ I12) - and the shield never does.
  /const blocked = !hidden && note\.includes\('✕'\);/.test(hud) && !/shield[\s\S]{0,80}?disabled/.test(hud), true);
check('freeplay discloses it on hover, before the click and before the Tick',
  /automaticShieldFor\(data, state\.tokens, sel, hov, aimed\)/.test(main)
    && /⤳ \$\{shield\.shield\.label\} shields it/.test(main), true);
check('and only while a Firing target is actually being chosen',
  /pendingAttack\?\.mode === 'attack'/.test(main), true);

// ---------- RISK 10: nothing on the wire validates the swapped target ----------
//
// That is what makes this work with no protocol change, and it is also why a
// future validation pass on these two commands would break the keyword with no
// test failing. Both check sites carry a comment saying so; this pins the
// comments, because the comment IS the guard.
const commands = src('commands.ts');
check('callDefense says the defender may legitimately not be the designated target',
  /Automatic Shield\s*\n\s*\/\/ moves the defender of a declared attack \(FAQ A12\)/.test(commands), true);
check('setCombatView says the same about view.targetUid',
  /`view\.targetUid` is NOT checked against the\s*\n\s*\/\/ designated target on purpose/.test(commands), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

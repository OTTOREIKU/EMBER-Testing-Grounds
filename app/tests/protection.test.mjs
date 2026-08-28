// Terrain Protection, Unit Protection and the firing arcs (rulebook 4.2/4.4.2/
// 4.5.3, FAQ A1/E15/I24).
//   Two readings the FAQ changed and nothing pinned: terrain pressed against the
//   attacker's own base grants the defender nothing (A1), and units sharing a
//   Large Grid still have a front and a rear, read off the small grids (E15) —
//   unless their footprints overlap, which makes them mutually in front (I24).
//   Unit Protection was pinned by nothing at all, which is how every Drone on
//   the board came to hand out +2 White for years; 4.5.3 gives it to LARGE
//   Units only, and the last section here is that baseline and its one printed
//   exception.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const start = src.indexOf('let GRIDS');
// protectionFor is the last thing in the file, so the slice runs to the end.
if (start < 0) throw new Error('could not locate the sight rules in rules.ts');
const tmp = new URL('./_protection.slice.ts', import.meta.url);
writeFileSync(tmp, 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + src.slice(start));
const { inArc, losBetween, losNote, protectionFor, rangeBetween } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Protection and arcs — 4.2/4.4.2/4.5.3, FAQ A1/E15/I24\n');

// Small-cell coordinates throughout: a Large Grid is 3x3 of them.
const unit = (col, row, over = {}) =>
  ({ uid: over.uid ?? 1, side: over.side ?? 's1', kind: 'mech', col, row, size: over.size ?? 1,
     facing: over.facing ?? 0, aerial: over.aerial ?? false, partStates: {}, ...over });
// Terrain tall enough to obstruct: losBetween only cares about isFragile for
// crushing, height is what blocks.
// `providesProtection` defaults TRUE here because this helper builds 3-inch
// walls, and in the shipped data every piece carries the flag: 84 of 84, with
// the 1-inch Containers set false and everything 2-inch or taller set true. A
// helper that left it undefined was agreeing with a protectionFor that never
// asked the question.
const wall = (id, cells, over = {}) =>
  ({ id, height: 3, isFragile: false, providesProtection: true, subCells: cells.map(([col, row]) => ({ col, row })), ...over });
// A 1-inch Container: obstructs the line, pays the defender nothing (4.5,
// rules/04:115). Same shape as a wall, one flag apart, so a test can show the
// difference is the height and not the geometry.
const crate = (id, cells) => wall(id, cells, { height: 1, isFragile: true, providesProtection: false });
const firing = { type: 'Firing' };

// ---------- A1: terrain against your own base is not cover ----------

// Attacker at cell (4,4), defender four Grids away on the same row, with a wall
// in the cell directly in front of the attacker.
const me = unit(4, 4, { uid: 1 });
const far = unit(16, 4, { uid: 2, side: 's2' });
const hugged = wall('t1', [[5, 4]]);
const midway = wall('t2', [[10, 4]]);

check('a wall in the way is Terrain Protection',
  protectionFor(me, far, firing, [midway], [], []).white, 2);
check('but the wall the attacker is pressed against is not (A1)',
  protectionFor(me, far, firing, [hugged], [], []).white, 0);
// Contact is an edge, not a corner: a diagonal touch still shields. The shot
// has to run diagonally for the corner piece to be in the way at all.
const diag = unit(16, 16, { uid: 7, side: 's2' });
check('a corner touch is not Contact, so it still counts',
  protectionFor(me, diag, firing, [wall('t3', [[5, 5]])], [], []).white, 2);
// Both at once: the hugged piece drops out, the far one still protects.
check('only the hugged piece drops out',
  protectionFor(me, far, firing, [hugged, midway], [], []).white, 2);
check('and the note says which protection applied',
  protectionFor(me, far, firing, [midway], [], []).note.includes('Terrain Protection'), true);

// A 3x3 Mech is in Contact along its whole edge, not just from one cell.
const big = unit(3, 3, { uid: 1, size: 3 });
check('a large unit is in Contact along its whole face (A1)',
  protectionFor(big, far, firing, [wall('t4', [[6, 5]])], [], []).white, 0);

// Only Firing Actions ever roll Protection.
check('a Melee Action gets no Protection at all',
  protectionFor(me, far, { type: 'Melee' }, [midway], [], []).white, 0);

// ---------- E15/I24: arcs inside one Large Grid ----------

// Both in Large Grid (1,1), attacker facing north (0) at the bottom of it.
const a = unit(4, 5, { uid: 1, facing: 0 });
const infront = unit(4, 3, { uid: 2, side: 's2' });
const behind = unit(4, 5, { uid: 3, side: 's2' });

check('sharing a Grid is not a shrug: north is in front (E15)',
  [inArc(a, infront, 'forward'), inArc(a, infront, 'rear')], [true, false]);
check('and the same cell overlaps, so it is mutually in front (I24)',
  [inArc(a, behind, 'forward'), inArc(a, behind, 'rear')], [true, false]);
// The classic case the ruling is about: an Aerial unit sitting over a ground
// one can never Back Attack it.
const over = unit(4, 5, { uid: 4, side: 's2', aerial: true });
check('an Aerial unit above a ground one never gets the rear',
  inArc(a, over, 'rear'), false);
check('nor does the ground one, looking back up', inArc(over, a, 'rear'), false);

// A unit genuinely behind, still inside the Grid.
const a2 = unit(4, 3, { uid: 1, facing: 0 });
const trailing = unit(4, 5, { uid: 5, side: 's2' });
check('a unit south of a north-facing attacker is in its rear',
  [inArc(a2, trailing, 'rear'), inArc(a2, trailing, 'forward')], [true, false]);
// Sideways is neither arc: the cone test is 45 degrees off the facing.
check('directly beside is in neither arc',
  [inArc(a2, unit(3, 3, { uid: 6 }), 'forward'), inArc(a2, unit(3, 3, { uid: 6 }), 'rear')], [false, false]);

// Across Grids the test is the Large Grid, as before.
check('across Grids the arc reads the Large Grid',
  inArc(unit(4, 10, { facing: 0 }), unit(4, 1, { uid: 2 }), 'forward'), true);
check('and behind across Grids is the rear',
  inArc(unit(4, 1, { facing: 0 }), unit(4, 10, { uid: 2 }), 'rear'), true);

// rangeBetween agrees about sharing a Grid, which is what sends the arc test
// down the small-grid branch in the first place.
check('two units in one Grid are at range 0', rangeBetween(a, behind).range, 0);
check('and it says they share the Grid', rangeBetween(a, behind).sameGrid, true);

// ---------- 4.5.3: only LARGE Units provide Unit Protection ----------
//
// "Only Large Units provide Unit Protection (medium Units do not). Both Ally
// and Enemy Units provide Unit Protection." Every Mech in this app is size 3,
// so what the size test decides is what a DRONE in the way is worth — and the
// answer for a medium one is nothing, where it used to be +2 White to whoever
// happened to be shot at. Protection is not stackable within its own kind and
// stacks across the two kinds, for a ceiling of +4.
// Blockers sit between me (4,4) and far (16,4): a Large one spans three cells
// of that row, a medium one two, and both stand squarely across the line.
const largeAt = (uid, col, side = 's1') => unit(col, 3, { uid, side, size: 3 });
const mediumAt = (uid, col, side = 's1') => unit(col, 4, { uid, side, size: 2 });
const board = (...extra) => [me, far, ...extra];
const bigBlocker = largeAt(10, 6);
const midBlocker = mediumAt(11, 10);

check('a Large unit in the line is Unit Protection',
  protectionFor(me, far, firing, [], board(bigBlocker), []).white, 2);
check('and an ENEMY Large unit protects exactly as an Ally does',
  protectionFor(me, far, firing, [], board(largeAt(10, 6, 's2')), []).white, 2);
check('the note names what provided it',
  protectionFor(me, far, firing, [], board(bigBlocker), []).note,
  'Unit Protection (obstructed by a Large unit)');
// The baseline change. A medium unit still OBSTRUCTS — the line reads
// "obstructed" everywhere else — it simply pays nothing for it.
check('a medium unit in the line provides no Unit Protection',
  protectionFor(me, far, firing, [], board(midBlocker), []).white, 0);
check('and a small one provides none either',
  protectionFor(me, far, firing, [], board(unit(10, 4, { uid: 12, size: 1 })), []).white, 0);
check('the medium unit really is standing in the line, so the zero is the rule and not the geometry',
  losBetween(me, far, [], board(midBlocker)), 'obstructed');
// The trap: a zero handed over with "Obstructed line of sight" tells the player
// the app found cover and then forgot to add it.
check('the zero explains itself instead of reporting a bare obstruction',
  protectionFor(me, far, firing, [], board(midBlocker), []).note,
  'Obstructed, but the unit in the way is not Large, so there is no Unit Protection (4.5.3)');
check('with nothing in the way at all the note stays empty, as before',
  protectionFor(me, far, firing, [], board(), []).note, '');
check('Unit Protection does not stack with a second Large unit',
  protectionFor(me, far, firing, [], board(bigBlocker, largeAt(13, 12)), []).white, 2);
check('but it does stack with Terrain Protection, for +4',
  protectionFor(me, far, firing, [midway], board(bigBlocker), []).white, 4);
// The half-answer is the one that looks broken: terrain pays, the medium unit
// beside it does not, and the player sees +2 where the table said +4.
check('a Terrain-only +2 says why the unit beside it added nothing',
  protectionFor(me, far, firing, [midway], board(midBlocker), []),
  { white: 2, note: 'Terrain Protection (obstructed by terrain ≥2") — the unit in the way is not Large, so there is no Unit Protection (4.5.3)' });
// An Aerial unit is not in the line at all (4.5.3), so it neither protects nor
// leaves the defender an explanation to read.
check('an Aerial Large unit in the way is not in the way',
  [protectionFor(me, far, firing, [], board({ ...bigBlocker, aerial: true }), []).white,
   protectionFor(me, far, firing, [], board({ ...bigBlocker, aerial: true }), []).note], [0, '']);
check('and an Aerial defender claims no Protection from a Large unit either',
  protectionFor(me, { ...far, aerial: true }, firing, [], board(bigBlocker), []).white, 0);
// Pinned because it is the one loss this change hands the table: the deployed
// Barricades are size 1, so they stop paying +2 as UNITS. The AS3 walls are
// printed "counts as 3-inch terrain", and until that bullet is modelled they
// obstruct for nothing. A future terrain fix should break this line.
check('a deployed Barricade is size 1, so it no longer pays as a unit',
  protectionFor(me, far, firing, [], board(unit(10, 4, { uid: 15, size: 1, barricade: true })), []).white, 0);

// ---------- ZHDR-101 Mobile Bunker: the one exception ----------
//
// "本机可以为友军提供单位保护" — this unit may provide Unit Protection to Ally
// Units. The Scutum is a medium Drone, so the card is only worth anything on
// top of the baseline above. rules.ts is handed the predicate rather than
// reading the card, and it decides who is an Ally itself.
//
// Clause 2 of the same card is Automatic Shield, and it now takes the shot
// outright when the Scutum is ADJACENT to the target and in the line (FAQ A12).
// Every case below sits deliberately on the clause-1 side of that divide: the
// bunker is at Large Grid (3,1) against a target at (5,1), so Range 2 and not
// Adjacent. Nothing here changed and nothing here should — a reader who sees
// the +2 vanish in the adjacent case is looking at A12 replacing the target,
// not at a regression. autoshield.test.mjs pins both sides of the divide.
const isBunker = (t) => t.uid === 14;
const bunkerFor = (side) => mediumAt(14, 10, side);

check('the Mobile Bunker protects an Ally despite being medium',
  protectionFor(me, far, firing, [], board(bunkerFor('s2')), [], false, isBunker).white, 2);
check('and the note credits the card rather than claiming a Large unit',
  protectionFor(me, far, firing, [], board(bunkerFor('s2')), [], false, isBunker).note,
  'Unit Protection (an Ally unit in the way provides it — ZHDR-101 Mobile Bunker)');
// "to Ally Units", so the side of the DEFENDER is what it turns on — the same
// Scutum standing in front of an enemy is just a medium unit.
check('it does nothing for a unit that is not its Ally',
  protectionFor(me, far, firing, [], board(bunkerFor('s1')), [], false, isBunker).white, 0);
check('and that zero still explains itself',
  protectionFor(me, far, firing, [], board(bunkerFor('s1')), [], false, isBunker).note,
  'Obstructed, but the unit in the way is not Large, so there is no Unit Protection (4.5.3)');
check('with no predicate handed in it is just another medium unit',
  protectionFor(me, far, firing, [], board(bunkerFor('s2')), []).white, 0);
check('it does not stack on top of a Large unit already in the line',
  protectionFor(me, far, firing, [], board(largeAt(10, 6, 's2'), bunkerFor('s2')), [], false, isBunker).white, 2);
check('and the Large unit is what the note names when both are there',
  protectionFor(me, far, firing, [], board(largeAt(10, 6, 's2'), bunkerFor('s2')), [], false, isBunker).note,
  'Unit Protection (obstructed by a Large unit)');
// 095 outranks both: it ignores Terrain and Unit Protection alike, so the
// exception cannot smuggle dice past it.
check('095 still ignores the Protection the Bunker would have given',
  protectionFor(me, far, firing, [midway], board(bunkerFor('s2')), [], true, isBunker).white, 0);

// ---------- every call site must be handed the card data ----------
//
// protectionFor takes both card readings as arguments because rules.ts holds no
// card data. A site that omits one compiles and runs, and the rule is simply
// dead on that page: that is exactly how 095 came to be dead on Multi-Target
// (combat.ts) and in the Match Centre (match.ts) without a test noticing.
const source = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
for (const [file, callee] of [['combat.ts', 'protectionFor'], ['main.ts', 'protectionForShared'],
  ['match.ts', 'protectionFor'], ['matchhud.ts', 'protectionFor']]) {
  const text = source(file);
  check(`${file} hands protectionFor the 095 reading`,
    new RegExp(`${callee}\\([\\s\\S]{0,400}?ignoresProtectionOnHighlight`).test(text), true);
  check(`${file} hands protectionFor the ZHDR-101 predicate`,
    new RegExp(`${callee}\\([\\s\\S]{0,400}?providesUnitProtectionToAllies`).test(text), true);
}

// ---------- HEIGHT DECIDES WHETHER TERRAIN PAYS (4.5, rules/04:115) ----------
// OTTO from live play: "are the destructible boxes (green 1'') accidentally
// providing obstructed to line of site? ... the card to pick him says 'obstructed
// so the defender gets +2 white'".
//
// They were. The rule is explicit: "Only Terrain with height 2 inches or more
// provides Terrain Protection. 1-inch terrain can partially obstruct LoS but
// grants no protection and no modifiers." The worked example at rules/04:121 is
// the same board: 1-inch terrain between A and C gives nothing.
//
// `providesProtection` already carried the answer and is false for both
// Container sizes in all 84 shipped terrain pieces. protectionFor simply never
// asked it, while printing a note that claimed terrain ">=2\"".
{
  // One line, one obstructor, twice: the ONLY difference is the height flag.
  // This file's own helper: small-cell coordinates, size 3 for a Mech.
  const a = unit(0, 0, { uid: 1, side: 's1', size: 3 });
  const d = unit(0, 12, { uid: 2, side: 's2', size: 3 });

  const tall = protectionFor(a, d, firing, [wall('w', [[1, 6], [1, 7], [1, 8]])], [], []);
  check('a 3-inch wall in the line is Terrain Protection', tall.white, 2);

  const low = protectionFor(a, d, firing, [crate('c', [[1, 6], [1, 7], [1, 8]])], [], []);
  check('but a 1-inch Container in the same line pays nothing', low.white, 0);
  check('and does not claim to', /Terrain Protection/.test(low.note), false);

  // It still OBSTRUCTS: the rule says 1-inch terrain can obstruct and simply
  // grants nothing for it, so the geometry must be unchanged and only the
  // payment different. Asserted so a future fix cannot "solve" this by making
  // crates invisible to line of sight.
  check('the crate is still in the way as far as sight is concerned',
    losBetween(a, d, [crate('c', [[1, 6], [1, 7], [1, 8]])], []), 'obstructed');

  // A wall behind the crate still pays, so the filter drops the crate and not
  // the whole line.
  const both = protectionFor(a, d, firing,
    [crate('c', [[1, 4], [1, 5]]), wall('w', [[1, 6], [1, 7], [1, 8]])], [], []);
  check('and a real wall behind it is unaffected', both.white, 2);
}

// ---------- RANGE IS A REFUSAL ONLINE AND A WARNING AT THE TABLE ----------
// OTTO from live play: "I just tried to shoot at another mech from across the
// map, it was way out of my range (10 spaces away and my range is only 6)
// however the game let me still pick the mech and then roll combat like usual."
//
// He was right, and the record says why: the 2026-08-16 ruling that made the
// Match Centre strict blocked LOS and left "range, arc ... overridable warnings
// on both pages". Only losNote's LOS readings emitted the marker the picker
// disables rows on, so Range was a warning nobody was stopped by on the one page
// that is supposed to stop them. OTTO reversed that for Range on 2026-08-20.
//
// Arc stays a warning on both pages, which is the part of the old ruling that
// did not change, and freeplay keeps the whole thing overridable.
{
  const shooter = unit(4, 4, { uid: 1 });
  // Twelve small cells is four Large Grids; well outside a Range 2 action and
  // comfortably inside a Range 6 one.
  const away = unit(16, 4, { uid: 2, side: 's2' });
  const gap = rangeBetween(shooter, away).range;
  check('the fixture really is out of reach of a short weapon', gap > 2, true);
  check('and inside a long one', gap <= 6, true);

  const short = { type: 'Firing', range: 2 };
  const long = { type: 'Firing', range: 6 };

  // FREEPLAY, which is every caller that does not ask for strict.
  const warned = losNote(shooter, away, short, [], [], []);
  check('freeplay still only warns about range', warned.includes('⚠ beyond action range'), true);
  check('and does not block it', warned.includes('✕'), false);

  // THE MATCH CENTRE.
  const refused = losNote(shooter, away, short, [], [], [], true);
  check('the Match Centre refuses it instead', refused.includes('✕ beyond action range'), true);
  check('and the row it draws has the marker it disables on', refused.includes('✕'), true);

  // In range is in range, on either page.
  check('a target inside the reach is refused by neither',
    [losNote(shooter, away, long, [], [], []), losNote(shooter, away, long, [], [], [], true)]
      .map((n) => n.includes('beyond action range')), [false, false]);

  // THE ARC IS NOT PART OF THIS. It was an overridable warning before the
  // reversal and stays one, so strict must not quietly promote it: the shooter
  // faces along +col here, so a target behind them is out of the forward arc and
  // in range at the same time.
  {
    const behind = unit(1, 4, { uid: 3, side: 's2' });
    const n = losNote(shooter, behind, long, [], [], [], true);
    check('an out-of-arc target still only warns, even strict', n.includes('⚠ NOT in forward arc'), true);
    check('and is not refused for it', n.includes('✕'), false);
  }

  // RANGE 0 means adjacent-only ("--" on the card), and a non-adjacent target is
  // just as illegal as one past a printed number.
  {
    const melee = { type: 'Melee', range: 0 };
    check('a melee action reaching across the board warns at the table',
      losNote(shooter, away, melee, [], [], []).includes('⚠ target not adjacent'), true);
    check('and is refused online', losNote(shooter, away, melee, [], [], [], true).includes('✕ target not adjacent'), true);
  }

  // THE REACH IS THE CALLER'S TO SUPPLY, which is the whole reason the Match
  // Centre passes `{ ...a, range: actionRange(...) }` rather than the action as
  // it comes off the card: an ally's firing-range aura lengthens the shot, and
  // refusing it on the printed number would break a legal attack. Pinned as the
  // SHAPE the caller uses, since actionRange itself lives in units.ts.
  {
    const printed = { type: 'Firing', range: 2 };
    const extended = { ...printed, range: 6 };
    check('the printed number alone would refuse this shot',
      losNote(shooter, away, printed, [], [], [], true).includes('✕'), true);
    check('and the effective reach lets it through',
      losNote(shooter, away, extended, [], [], [], true).includes('✕'), false);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

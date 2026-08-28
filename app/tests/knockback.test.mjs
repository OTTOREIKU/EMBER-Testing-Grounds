// Checks Knockback X and Push X: the direction taken, how far the victim
// travels, and where it stops (appendix K and P, and Forced Movement 4.3.4).
import { readFileSync, writeFileSync } from 'node:fs';

const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const rStart = rules.indexOf('let GRIDS');
const rEnd = rules.indexOf('export function losBetween');
const tmp = new URL('./_knockback.slice.ts', import.meta.url);
writeFileSync(tmp, 'type TerrainPiece = any;\ntype Token = any;\ntype Side = any;\ntype SmokeScreen = any;\n' + rules.slice(rStart, rEnd));
const { attackDirection, knockbackPath } = await import(tmp.href);

const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const kStart = units.indexOf('export interface Knockback');
const kEnd = units.indexOf('// Direct Fire needs sight');
const ktmp = new URL('./_knockback.units.ts', import.meta.url);
writeFileSync(ktmp, 'type CardAction = any;\n' + units.slice(kStart, kEnd));
const { knockbackOf } = await import(ktmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const unit = (uid, c, r, extra = {}) =>
  ({ uid, size: 1, aerial: false, facing: 0, col: c * 3 + 1, row: r * 3 + 1, partStates: {}, ...extra });
const wall = (c, r, isFragile = false) => ({
  id: `w${c}${r}`, type: 'building', height: 3, blocksLos: true, providesProtection: true, isFragile,
  subCells: [0, 1, 2].flatMap((dc) => [0, 1, 2].map((dr) => ({ col: c * 3 + dc, row: r * 3 + dr }))),
});
const cells = (p) => p.map((g) => `${g.c},${g.r}`);

console.log('Knockback and Push\n');

// ---------- direction ----------

// The victim travels away from the attacker along the dominant axis.
check('a shot from the north pushes south', attackDirection(unit(1, 2, 2), unit(2, 2, 5)), { dc: 0, dr: 1 });
check('from the south pushes north', attackDirection(unit(1, 2, 5), unit(2, 2, 2)), { dc: 0, dr: -1 });
check('from the west pushes east', attackDirection(unit(1, 0, 2), unit(2, 4, 2)), { dc: 1, dr: 0 });
check('from the east pushes west', attackDirection(unit(1, 4, 2), unit(2, 0, 2)), { dc: -1, dr: 0 });
// A mostly-sideways shot still snaps to the axis it leans on.
check('a shallow angle snaps to the long axis', attackDirection(unit(1, 0, 2), unit(2, 4, 3)), { dc: 1, dr: 0 });
// Dead on the diagonal there is no dominant axis, so the attacker's facing decides.
check('a perfect diagonal falls back to facing north', attackDirection(unit(1, 0, 0, { facing: 0 }), unit(2, 2, 2)), { dc: 0, dr: -1 });
check('facing east', attackDirection(unit(1, 0, 0, { facing: 1 }), unit(2, 2, 2)), { dc: 1, dr: 0 });
check('facing south', attackDirection(unit(1, 0, 0, { facing: 2 }), unit(2, 2, 2)), { dc: 0, dr: 1 });
check('facing west', attackDirection(unit(1, 0, 0, { facing: 3 }), unit(2, 2, 2)), { dc: -1, dr: 0 });

// ---------- distance travelled ----------

const v = unit(2, 5, 5);
const south = { dc: 0, dr: 1 };
check('a clear line travels the full distance', cells(knockbackPath(v, south, 3, [], [v])), ['5,6', '5,7', '5,8']);
check('knockback 1 moves one grid', cells(knockbackPath(v, south, 1, [], [v])), ['5,6']);

// Printed example: C stops early because Terrain blocks the rest of the line.
check('terrain stops it early', cells(knockbackPath(v, south, 3, [wall(5, 7)], [v])), ['5,6']);
check('terrain right behind means no move at all', cells(knockbackPath(v, south, 3, [wall(5, 6)], [v])), []);
// A Unit blocks the line only when it actually fills the Grid. A Large Grid is
// 3x3 small cells, so one small unit standing in it still leaves room and the
// victim slides in beside it.
const filler = (c, r) => ({ uid: 90 + c + r, size: 3, aerial: false, facing: 0, col: c * 3, row: r * 3, partStates: {} });
check('a large unit stops it early', cells(knockbackPath(v, south, 3, [], [v, filler(5, 7)])), ['5,6']);
check('a large unit right behind means no move at all', cells(knockbackPath(v, south, 3, [], [v, filler(5, 6)])), []);
check('but one small unit does not block a small victim', cells(knockbackPath(v, south, 2, [], [v, unit(3, 5, 6)])), ['5,6', '5,7']);
// The board edge is a hard stop too.
check('the board edge stops it', cells(knockbackPath(unit(2, 5, 10), south, 3, [], [unit(2, 5, 10)])), ['5,11']);
check('and a victim on the edge does not move', cells(knockbackPath(unit(2, 5, 11), south, 3, [], [unit(2, 5, 11)])), []);

// A Flying victim is blocked by Units and Terrain here, which is the one place
// Flying Movement does not pass through things.
const flyer = unit(2, 5, 5, { aerial: true });
check('an aerial victim is blocked by terrain too', cells(knockbackPath(flyer, south, 3, [wall(5, 6)], [flyer])), []);
check('and by units', cells(knockbackPath(flyer, south, 2, [], [flyer, filler(5, 6)])), []);

// A Large victim needs the whole Grid free to be pushed into it.
const big = { uid: 2, size: 3, aerial: false, facing: 0, col: 15, row: 15, partStates: {} };
check('a large victim moves through open ground', cells(knockbackPath(big, south, 2, [], [big])), ['5,6', '5,7']);
check('but a low wall in the way stops it', cells(knockbackPath(big, south, 2, [wall(5, 6)], [big])), []);

// ---------- reading the number off the card ----------

const act = (zh, en) => ({ description: { zh, en }, keywords: [] });
// 510_A prints the On Hit condition; ZHDR-301_A does not.
check('a melee on-hit rider is read', knockbackOf(act('· 命中时，造成击退1。')), { grids: 1, push: false, onHit: true });
check('a plain knockback is read', knockbackOf(act('· 霰射 · 近战射击\n· 击退1')), { grids: 1, push: false, onHit: false });
check('push is flagged separately', knockbackOf(act('· 可对其造成推动1。')), { grids: 1, push: true, onHit: false });
check('a bigger number survives', knockbackOf(act('击退3')), { grids: 3, push: false, onHit: false });
check('the english text works too', knockbackOf(act('', 'Knockback 2')), { grids: 2, push: false, onHit: false });
check('so does a spaced spelling', knockbackOf(act('', 'Knock Back 2')), { grids: 2, push: false, onHit: false });
// The printed English wins over the Chinese. Card 182's Kick is 推动1 in Chinese
// but prints "Knock Back 1", which costs the target no Link, so reading the
// Chinese there would invent a Link cost the English edition does not have.
check('printed english beats the chinese', knockbackOf(act('推动2', 'Knock Back 2')), { grids: 2, push: false, onHit: false });
check('and the real card 182 case', knockbackOf(act('·【命中】造成推动1。', '· [On Hit] Knock Back 1.')), { grids: 1, push: false, onHit: true });
check('chinese is read only when no english exists', knockbackOf(act('推动2', '')), { grids: 2, push: true, onHit: false });
// D1: THE BRACKETED TAG IS HOW THE DATA ACTUALLY WRITES THE CONDITION -- 22
// actions carry 【命中】 or [命中] and only a handful use the prose 命中时 the
// test above covers. The case above passes through the ENGLISH, so it never
// exercised the Chinese reader; these do, and they failed before the widening.
check('a bracketed on-hit tag is read from the chinese', knockbackOf(act('·【命中】造成击退1。')), { grids: 1, push: false, onHit: true });
check('the square-bracket spelling too', knockbackOf(act('·[命中]造成击退1。')), { grids: 1, push: false, onHit: true });
check('and with the spacing the data uses', knockbackOf(act('· [命中] 造成推动2')), { grids: 2, push: true, onHit: true });
// The counter-case that keeps the widening honest: bare 命中 in ordinary prose
// is NOT the condition tag, so matching it would flag an unconditional shove as
// on-hit and suppress it on a miss. PDLH-202_A is the live example of the form.
check('bare prose 命中 is not a condition tag', knockbackOf(act('· 击退1。命中后将本卡替换。')), { grids: 1, push: false, onHit: false });
// Both English spellings of Knock Back mean the plain version, so a loose string
// match can never silently drain a Mech's Link. Only "Push" carries that cost.
check('ambiguous english knock back is not a push', knockbackOf(act('', 'On Hit, Knock Back 1')), { grids: 1, push: false, onHit: true });
check('but the explicit english word push is', knockbackOf(act('', 'Push 2')), { grids: 2, push: true, onHit: false });
// A separately supplied translation counts as English and outranks the Chinese.
check('a supplied translation outranks the chinese', knockbackOf(act('推动3'), 'Knock Back 3'), { grids: 3, push: false, onHit: false });
// Punch/Kick puts the distance after the noun instead of after the keyword.
check('punch and kick shove is read', knockbackOf(act('', '· Shove a target 1 Grid.')), { grids: 1, push: false, onHit: false });
// A translation supplied separately is searched as well.
check('a separate translation is searched', knockbackOf(act(''), 'Knockback 4'), { grids: 4, push: false, onHit: false });
// Anything without the keyword is left alone.
check('an ordinary action has none', knockbackOf(act('· 装甲穿透1')), undefined);
check('and an empty action has none', knockbackOf({}), undefined);
// The bare keyword placeholder carries no number, so it must not read as 1.
check('the bare placeholder alone is not enough', knockbackOf({ keywords: [{ inline: '击退X' }] }), undefined);

// ---------- [Stationary] (same parser home) ----------
// "No Movement this Action Opportunity" pays the printed bonus. The two
// machine shapes are Range +N and +NY, exactly as the Mire's railguns and the
// SMG family print them — the reason a still Mech could never reach.
const { stationaryBonus, stationaryAdjusted } = await import(ktmp.href);
const rail = { range: 6, yellowDice: 0, redDice: 3, description: { en: '· [Stationary] Range +2 grids.\n·Armor Piercing 1' } };
const smg = { range: 4, yellowDice: 3, description: { en: '· Laser Weapon\n· [Stationary] +1Y.' } };
check('Range +N is read', stationaryBonus(rail), { range: 2, yellow: 0 });
check('+NY is read', stationaryBonus(smg), { range: 0, yellow: 1 });
check('no keyword reads nothing', stationaryBonus({ description: { en: 'Suppression' } }), null);
const still = { maneuvered: false, moved: false };
const walked = { maneuvered: true, moved: false };
check('a still Mech gets the range', stationaryAdjusted(rail, still).range, 8);
check('a still Mech gets the dice', stationaryAdjusted(smg, still).yellowDice, 4);
check('a Mech that maneuvered gets neither', stationaryAdjusted(rail, walked).range, 6);
check('no Opportunity means no bonus', stationaryAdjusted(rail, null).range, 6);
check('an unmarked action passes through untouched', stationaryAdjusted({ range: 5 }, still).range, 5);

// ---------- Pulse and Ion Weapons (same parser home) ----------
// "May exchange {Lightning} for {Heavy Hit}" — Pulse unconditionally, Ion only
// against a target bearing a Fragile Token. The condition is checked at the
// tally, so the parser only names which keyword is present.
const { lightningExchangeOf } = await import(ktmp.href);
check('pulse weapon is read', lightningExchangeOf({ description: { en: '· Pulse Weapon' }, keywords: [{ inline: '频闪武器' }] }), 'pulse');
check('the chinese inline keyword alone is enough', lightningExchangeOf({ keywords: [{ inline: '频闪武器' }] }), 'pulse');
check('ion weapon is read', lightningExchangeOf({ description: { zh: '· 离子武器' } }), 'ion');
check('english ion weapon is read', lightningExchangeOf({ description: { en: '· Ion Weapon' } }), 'ion');
check('a word ending in ion is not an ion weapon', lightningExchangeOf({ description: { en: 'Suppression Weapon' } }), null);
check('a plain action has neither', lightningExchangeOf({ description: { en: '· Concussion' } }), null);
check('an empty action has neither', lightningExchangeOf({}), null);

// Concussion/Wrecking spend the same Lightning the exchanges trade, one Link
// per icon — Wrecking's also count as damage.
const { lightningLinkDrain } = await import(ktmp.href);
check('concussion is read', lightningLinkDrain({ keywords: [{ inline: '震撼' }] }), 'concussion');
check('english concussion is read', lightningLinkDrain({ description: { en: '· Concussion' } }), 'concussion');
check('wrecking is read', lightningLinkDrain({ description: { zh: '· 粉碎' } }), 'wrecking');
check('a pulse action is not a drain', lightningLinkDrain({ keywords: [{ inline: '频闪武器' }] }), null);
check('an empty action drains nothing', lightningLinkDrain({}), null);

// ---------- Barricades are exempt from Forced Movement (FAQ E6/M13) ----------
//
// "Neutral Unit - Deployables - Barricade ... can neither move, be moved, nor
// be Crushed" (Rules Supplement 1.1.3, via FAQ A3/E6/M13/M14). The Crush half
// was implemented; the FORCED MOVEMENT half was written into two comments
// (types.ts, data.ts) and nowhere else, so a Knockback or a Push shoved a
// Turtle Shell across the board. Regression guard for BUG-6.
//
// One empty path covers both boards: main.ts and matchhud.ts each build their
// own shove UI on this function and both already read an empty path as
// "blocked, it does not move", so neither ever sends the forceMove.
const shell = unit(2, 5, 5, { barricade: true });
check('a Knockback does not move a Barricade', cells(knockbackPath(shell, south, 3, [], [shell])), []);
check('nor does a 1-Grid one', cells(knockbackPath(shell, south, 1, [], [shell])), []);
check('and no direction is different', cells(knockbackPath(shell, { dc: -1, dr: 0 }, 3, [], [shell])), []);
// The control: the same unit in the same clear line, minus the flag. Without
// this the check above would pass on a function that had stopped working.
check('while an ordinary victim in that line still travels',
  cells(knockbackPath(unit(2, 5, 5), south, 3, [], [unit(2, 5, 5)])), ['5,6', '5,7', '5,8']);
// The sibling half, already correct before BUG-6 and pinned here so the pair
// cannot drift: a Grid holding a Barricade cannot be entered at all, which is
// stronger than "the Barricade survives".
const { crushTargets } = await import(tmp.href);
const stomper = { uid: 9, size: 3, aerial: false, facing: 0, col: 0, row: 0, partStates: {} };
const shellAt = { uid: 2, size: 1, aerial: false, facing: 0, col: 4, row: 4, partStates: {}, barricade: true };
check('a Large Unit cannot Crush a Barricade, or enter its Grid',
  crushTargets(stomper, 1, 1, [], [stomper, shellAt]), null);
check('and the same Grid without the flag is a Crush',
  crushTargets(stomper, 1, 1, [], [stomper, { ...shellAt, barricade: undefined }])?.units.map((u) => u.uid), [2]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

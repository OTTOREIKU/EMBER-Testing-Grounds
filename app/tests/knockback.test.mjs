// Checks Knockback X and Push X: the direction taken, how far the victim
// travels, and where it stops (appendix K and P, and Forced Movement 4.3.4).
import { readFileSync, writeFileSync } from 'node:fs';

const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const rStart = rules.indexOf('export const LG');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

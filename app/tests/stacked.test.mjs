// UNITS SHARING ONE SPOT ARE SHOWN AS A STACK.
//
// OTTO (2026-10-09): "if I fire two missiles into the same grid I only see the one missile and there is no indicator
// there is a second so my opponent might not realize there is a second one." A launch puts its Projectile exactly
// where the launcher names, so two launches into one Grid land on the same spot and the one drawn last hides the
// other. types.ts stacksOf finds such groups; the board (board.ts renderTokens, the one drawing of tokens both the
// freeplay table and the Match Centre use) puts the count on each, and a press on the count brings the next one up.
// The node harness has no SVG, so the drawing is held by its wiring here and was looked at in a browser.
import { readFileSync } from 'node:fs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Units sharing one spot\n');

const { M, data } = await loadEngine('stacked');
const [, vip] = data.solo.scenarios;
const { state } = tableAtRoundOne(M, data, vip);
const stacks = (s) => M.TY.stacksOf(s.tokens).map((g) => g.map((t) => t.uid));

check('a table as deployed has no stack', stacks(state), []);

// The Mire's Quad Missile Rack launches two Razors into the same Grid, as the Ace did in the challenger's game 3.
const mire = state.tokens.find((t) => t.label === 'Mire');
const to = { col: 16, row: 16 };
const launch = { kind: 'launch', seat: mire.side, uid: mire.uid, actionId: '004_A', cardId: '071', to, facing: mire.facing };
M.C.apply(data, state, launch);
M.C.apply(data, state, launch);
const razors = state.tokens.filter((t) => t.kind === 'projectile').map((t) => t.uid);
check('two launches into one spot put two Razors there', [razors.length, new Set(state.tokens.filter((t) => t.kind === 'projectile').map((t) => `${t.col},${t.row}`)).size], [2, 1]);
check('and they are one stack', stacks(state), [razors]);

// Moved apart, they are two units again.
const second = state.tokens.find((t) => t.uid === razors[1]);
second.col += 3;
check('one moved a Grid away: no stack', stacks(state), []);
second.col -= 3;

// A unit not deployed stands nowhere, however its token is parked.
const waiting = { ...state.tokens.find((t) => t.uid === razors[0]), uid: 99999, deployed: false };
check('a unit not deployed joins no stack', stacks({ tokens: [...state.tokens, waiting] }), [razors]);

// Bases of different sizes centred on one point hide each other too: a Small unit over a Large one's middle.
const big = { uid: 1, col: 9, row: 9, size: 3 };
const small = { uid: 2, col: 10, row: 10, size: 1 };
const off = { uid: 3, col: 9, row: 9, size: 1 };
check('a Small base centred on a Large one is stacked with it', M.TY.stacksOf([big, small, off]).map((g) => g.map((t) => t.uid)), [[1, 2]]);

// The drawing: every board draws tokens through Board.renderTokens, which marks each stack.
const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const render = board.slice(board.indexOf('  renderTokens(state: GameState'), board.indexOf('\n  }\n', board.indexOf('  renderTokens(state: GameState')));
check('renderTokens marks every unit of every stack with the count', [render.includes('stacksOf(this.onBoard)'), render.includes('this.stackBadge(t, uids, key)')], [true, true]);
const badge = board.slice(board.indexOf('  private stackBadge('), board.indexOf('\n  }\n', board.indexOf('  private stackBadge(')));
check('the count is the number of units in the stack', badge.includes('n.textContent = String(uids.length);'), true);
check('a press on it brings the next unit up, round and round', badge.includes('uids[(uids.indexOf(t.uid) + 1) % uids.length]'), true);
check('and the one brought up, or the one selected, stays on top through a redraw',
  [render.includes('this.stackFront.get(key)'), render.includes('uids.includes(this.selectedUid)'), badge.includes('this.stackFront.set(key, next)')], [true, true, true]);
for (const page of ['main.ts', 'matchhud.ts']) {
  const src = readFileSync(new URL(`../src/${page}`, import.meta.url), 'utf8');
  check(`${page} draws its board with that Board`, /new Board\(/.test(src) && /from '\.\/board'/.test(src), true);
}
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
check('the count has its own look', ['.token-stack-dot', '.token-stack-n'].every((c) => css.includes(c)), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

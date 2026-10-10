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

// SMART STACKING (OTTO, 2026-10-10: two Razors launched onto a Mire wore three counts, and their names lay over
// each other): types.ts stackView says how a stack is shown. The largest base at the bottom, the front unit over the
// others of its size; ONE count, worn by the largest; ONE name under it, the front unit's, else the largest's.
const onMire = JSON.parse(JSON.stringify(tableAtRoundOne(M, data, vip).state));
const mire2 = onMire.tokens.find((t) => t.label === 'Mire');
const over = { kind: 'launch', seat: mire2.side, uid: mire2.uid, actionId: '004_A', cardId: '071', to: { col: mire2.col + 1, row: mire2.row + 1 }, facing: mire2.facing };
M.C.apply(data, onMire, over);
M.C.apply(data, onMire, over);
const [r1, r2] = onMire.tokens.filter((t) => t.kind === 'projectile');
const [heap] = M.TY.stacksOf(onMire.tokens);
check('two Razors launched onto the Mire are one stack of three with it', heap?.map((t) => t.label), ['Mire', r1.label, r2.label]);
const view = (group, front) => { const v = M.TY.stackView(group, front); return { order: v.order.map((t) => t.label), bearer: v.bearer.label, named: v.named.label }; };
const nameUnder = (group, front) => { const v = M.TY.stackView(group, front); return { bearer: v.bearer.label, host: v.host?.label ?? null, named: v.named?.label ?? null }; };
check('nothing in front: the Mire at the bottom wears the one count, and its name is the one shown',
  view(heap, null), { order: ['Mire', r1.label, r2.label], bearer: 'Mire', named: 'Mire' });
check("Razor 2 selected (OTTO's case): still one count, on the Mire, and the name shown is the Razor's",
  view(heap, r2.uid), { order: ['Mire', r1.label, r2.label], bearer: 'Mire', named: r2.label });
check('Razor 1 in front: drawn over Razor 2, the Mire still at the bottom', view(heap, r1.uid), { order: ['Mire', r2.label, r1.label], bearer: 'Mire', named: r1.label });
const pair = M.TY.stacksOf(state.tokens)[0];
check('two Razors alone: the one on top wears the count and its name', view(pair, null), { order: [pair[0].label, pair[1].label], bearer: pair[1].label, named: pair[1].label });
check('the other one in front comes up, with its name', view(pair, pair[0].uid), { order: [pair[1].label, pair[0].label], bearer: pair[0].label, named: pair[0].label });
// A line unit (an AS3 wall, the Turtle Shell) draws no name of its own: over one, the name sits under the top-most
// unit that draws one. The count stays on the wall.
const wall = { uid: 90, label: 'AS3 Wall', cardId: 'PDAM-003', kind: 'deployable', col: 4, row: 6, size: 1, facing: 0, deployed: true };
const onWall = [wall, { uid: 91, label: 'Razor A', kind: 'projectile', col: 5, row: 6, size: 1, deployed: true }, { uid: 92, label: 'Razor B', kind: 'projectile', col: 5, row: 6, size: 1, deployed: true }];
check('(the wall and two Razors in its middle cell are one stack)', M.TY.stacksOf(onWall).map((g) => g.map((t) => t.uid)), [[90, 91, 92]]);
check('over a wall, nothing in front: the count on the wall, the top Razor shows its own name', nameUnder(onWall, null), { bearer: 'AS3 Wall', host: 'Razor B', named: 'Razor B' });
check('Razor A selected: its name, under the top-most Razor', nameUnder(onWall, 91), { bearer: 'AS3 Wall', host: 'Razor A', named: 'Razor A' });
check('the wall selected: its name, so the one looked at is named', nameUnder(onWall, 90), { bearer: 'AS3 Wall', host: 'Razor B', named: 'AS3 Wall' });
check('two walls alone: no name to show', nameUnder([wall, { ...wall, uid: 93 }], null), { bearer: 'AS3 Wall', host: null, named: null });

// The drawing: every board draws tokens through Board.renderTokens, and a stack is arranged by arrangeStacks after
// every drawing and every change of selection.
const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (head) => board.slice(board.indexOf(head), board.indexOf('\n  }\n', board.indexOf(head)));
const render = body('  renderTokens(state: GameState');
const arrange = body('  private arrangeStacks(');
const badge = body('  private stackBadge(');
const select = body('  setSelected(uid: number | null)');
check('the tokens are drawn, then each stack is arranged', render.includes('this.arrangeStacks();'), true);
check('as stackView says: the order drawn, one count on the largest, one name under it',
  [arrange.includes('stackView(group, front)'), arrange.includes('this.tokenNode(bearer.uid)?.appendChild(this.stackBadge(bearer, uids, key, named?.uid ?? bearer.uid));'),
    arrange.includes('label.textContent = t.uid === host?.uid && named ? named.label : t.label;'), arrange.includes("label.classList.toggle('stack-quiet', t.uid !== host?.uid);")],
  [true, true, true, true]);
check('the front is the unit the count brought up, else the one selected',
  /const front = brought !== undefined && uids\.includes\(brought\) \? brought\s*: this\.selectedUid !== null && uids\.includes\(this\.selectedUid\) \? this\.selectedUid : null;/.test(arrange), true);
check('the count is the number of units in the stack', badge.includes('n.textContent = String(uids.length);'), true);
check('a press on it brings the next unit to the front, round and round',
  [badge.includes('uids[(uids.indexOf(front) + 1) % uids.length]'), badge.includes('this.stackFront.set(key, next)')], [true, true]);
check('a selection arranges the stacks again, and a unit selected in a stack is its front',
  [select.includes('this.arrangeStacks();'), select.includes('this.stackFront.delete(')], [true, true]);
for (const page of ['main.ts', 'matchhud.ts']) {
  const src = readFileSync(new URL(`../src/${page}`, import.meta.url), 'utf8');
  check(`${page} draws its board with that Board`, /new Board\(/.test(src) && /from '\.\/board'/.test(src), true);
}
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
check('the count has its own look, and a quiet name is hidden',
  ['.token-stack-dot', '.token-stack-n', '.token-label.stack-quiet { display: none; }'].every((c) => css.includes(c)), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

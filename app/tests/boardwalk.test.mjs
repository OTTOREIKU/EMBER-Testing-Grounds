// A unit's walk across the board settles ONCE (board.ts animateMove).
//
// WHY THIS FILE EXISTS. Every walk has two things that say it is over: the
// animation's own finish and a timer set beside it, because a page that is not
// being drawn never finishes an animation. Both arrive, in either order, and
// the walk's `done` is where a page RECORDS the Movement. Until 2026-10-01 the
// guard against the second arrival was a mark set and cleared inside one call,
// so it guarded nothing: the Match Centre sent every move a second time (the
// engine refused it and the notice line said so), and where the animation
// finished late the second send landed in whatever the game had become by
// then. Every other test drives the pages with a board whose animateMove calls
// back at once, once, so nothing could see it.
//
// Driven on the real method with the two arrivals held in hand, so each order
// is played out rather than left to a clock.
import { loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A walk across the board settles once\n');

const { M } = await loadEngine('boardwalk', ["export { Board, CELL } from '../src/board';"]);
const { Board, CELL } = M;

// A token's element, as much of one as a walk touches.
function token({ throws = false } = {}) {
  const classes = new Set();
  const g = {
    dataset: {}, attrs: {}, anims: [],
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; },
    animate(frames, opts) {
      if (throws) throw new Error('no animations here');
      const a = { frames, opts, onfinish: null };
      this.anims.push(a);
      return a;
    },
  };
  return { g, classes };
}

// As much of a board as a walk touches: its walks under way, and the token it
// holds for the unit now (`board.now`, which a test may swap for a rebuilt one).
function boardOf(g, uid = 7) {
  const board = { walks: new Map(), now: g };
  board.gTokens = { querySelector: (sel) => (board.now && sel === `[data-uid="${uid}"]` ? board.now : null) };
  return board;
}

// One walk started, with its timer caught instead of left to run.
function walk(g, stops, uid = 7, board = boardOf(g, uid)) {
  const timers = [];
  let done = 0;
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  try {
    Board.prototype.animateMove.call(board, uid, stops, () => { done++; });
  } finally {
    globalThis.setTimeout = real;
  }
  return { timers, done: () => done, board };
}

const ROUTE = [{ col: 3, row: 3 }, { col: 6, row: 3 }, { col: 6, row: 6 }];
const LANDED = `translate(${6 * CELL}, ${6 * CELL})`;

// ---------- how a walk is set going ----------
{
  const { g, classes } = token();
  const w = walk(g, ROUTE);
  check('a walk is one animation through every stop, and one timer set a little past its end',
    [g.anims.length, g.anims[0].frames.map((f) => f.transform), g.anims[0].opts.duration, w.timers.map((t) => t.ms)],
    [1, ROUTE.map((s) => `translate(${s.col * CELL}px, ${s.row * CELL}px)`), 260 + 2 * 170, [260 + 2 * 170 + 120]]);
  check('while it walks the token is marked moving, it has not been put down, and nothing is recorded',
    [classes.has('moving'), g.attrs.transform ?? null, w.done()], [true, null, 0]);
  const long = token();
  walk(long.g, Array.from({ length: 12 }, (_, i) => ({ col: i * 3, row: 0 })));
  check('a long route is still walked in a second and a half', long.g.anims[0].opts.duration, 1500);
}

// ---------- the two arrivals, in each order ----------
{
  const { g, classes } = token();
  const w = walk(g, ROUTE);
  w.timers[0].fn();
  check('the timer first: the walk settles, the token stands at its last stop and is no longer moving',
    [w.done(), g.attrs.transform, classes.has('moving')], [1, LANDED, false]);
  g.anims[0].onfinish();
  check('the animation finishing after it, however late, records nothing more', w.done(), 1);
  g.anims[0].onfinish();
  w.timers[0].fn();
  check('nor does either of them arriving again', w.done(), 1);
}
{
  const { g, classes } = token();
  const w = walk(g, ROUTE);
  g.anims[0].onfinish();
  check('the animation first, as a page being drawn has it: the walk settles the same way',
    [w.done(), g.attrs.transform, classes.has('moving')], [1, LANDED, false]);
  w.timers[0].fn();
  check('and the timer, a moment later, records nothing more', w.done(), 1);
}
{
  const { g } = token({ throws: true });
  const w = walk(g, ROUTE);
  check('where nothing can be animated the walk settles at once', [w.done(), g.attrs.transform], [1, LANDED]);
  w.timers[0].fn();
  check('and its timer records nothing more', w.done(), 1);
}

// ---------- one element, walked again ----------
{
  const { g } = token();
  const first = walk(g, ROUTE);
  first.timers[0].fn();
  g.anims[0].onfinish();
  const back = [{ col: 6, row: 6 }, { col: 3, row: 6 }];
  const second = walk(g, back);
  check('a token that has walked before walks again: a second animation, nothing recorded yet',
    [g.anims.length, second.done()], [2, 0]);
  g.anims[1].onfinish();
  second.timers[0].fn();
  check('and that walk settles once too, at its own last stop',
    [second.done(), g.attrs.transform, first.done()], [1, `translate(${3 * CELL}, ${6 * CELL})`, 1]);
  first.timers[0].fn();
  g.anims[0].onfinish();
  check('the first walk, arriving again after the second, moves nothing and records nothing',
    [first.done(), second.done(), g.attrs.transform], [1, 1, `translate(${3 * CELL}, ${6 * CELL})`]);
  check('the walk leaves no mark on the element', Object.keys(g.dataset), []);
}

// ---------- the board drawn again in the middle of a walk ----------
// renderTokens builds every token afresh. Until 2026-10-03 the walk went with
// the token it began on, so the unit stood still and then jumped: a Movement
// Action pays as its walk begins, and in a game against the computer or across
// a room the other seat's news arrives at any moment (OTTO's playtest: "the
// first unit I move a turn does the animation and then the second one skips it").
{
  const first = token();
  const w = walk(first.g, ROUTE);
  const rebuilt = token();
  w.board.now = rebuilt.g;
  Board.prototype.resumeWalk.call(w.board, rebuilt.g, 7);
  const a = rebuilt.g.anims[0];
  check('A TOKEN BUILT MID-WALK TAKES THE WALK UP: the same route and length, from where the walk had got to, and it is marked moving',
    [rebuilt.g.anims.length, a.frames.map((f) => f.transform), a.opts.duration, typeof a.currentTime === 'number' && a.currentTime >= 0 && a.currentTime <= a.opts.duration, rebuilt.classes.has('moving')],
    [1, ROUTE.map((s) => `translate(${s.col * CELL}px, ${s.row * CELL}px)`), 260 + 2 * 170, true, true]);
  w.timers[0].fn();
  check('the walk settles on the token the board holds now: put down at its last stop, no longer moving, recorded once',
    [rebuilt.g.attrs.transform, rebuilt.classes.has('moving'), w.done()], [LANDED, false, 1]);
  first.g.anims[0].onfinish();
  check('the token it began on finishing later records nothing more', w.done(), 1);
  const after = token();
  Board.prototype.resumeWalk.call(w.board, after.g, 7);
  check('once settled the walk is over: a token built after it is drawn where the unit stands, with no walk',
    [after.g.anims.length, after.classes.has('moving'), w.board.walks.size], [0, false, 0]);
  const other = token();
  const w2 = walk(other.g, ROUTE);
  const stranger = token();
  Board.prototype.resumeWalk.call(w2.board, stranger.g, 8);
  check('a token of another unit built mid-walk takes up no walk of this one', [stranger.g.anims.length, stranger.classes.has('moving')], [0, false]);
  const plain = token({ throws: true });
  Board.prototype.resumeWalk.call(w2.board, plain.g, 7);
  check('where the rebuilt token cannot be animated it is put down at the walk\'s end', plain.g.attrs.transform, LANDED);
  w2.timers[0].fn();
}

// ---------- nothing to walk ----------
{
  const none = walk(null, ROUTE);
  check('a unit with no token on this board is recorded at once: no timer is set',
    [none.done(), none.timers.length], [1, 0]);
  const { g } = token();
  const still = walk(g, [{ col: 3, row: 3 }]);
  check('a route of one stop is no walk: recorded at once, nothing animated, no timer',
    [still.done(), g.anims.length, still.timers.length], [1, 0, 0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

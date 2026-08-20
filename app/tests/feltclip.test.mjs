// THE FELT MUST NOT BE ABLE TO RUN OFF THE BOTTOM OF THE COMBAT WINDOW.
//
// OTTO reported this as a Surplus-round deadlock: as the DEFENDER he spent a
// Link to Focus and the "Focus: reroll selected" / "Keep the roll" buttons never
// appeared, while the ATTACKER could see those same buttons under the defence
// dice. The attack could not go on, because the press belonged to the defender.
//
// Nothing was wrong with the state. mirror.test.mjs drives that exact sequence
// through the real publish and the real mirror and the buttons are built, live,
// on the defender's own window. They were built off the bottom of the panel.
//
// Three things combined:
//   - .combatpop is a FIXED height and #combat-body clips it with
//     `overflow: hidden`, so anything past the bottom edge is unreachable --
//     a hidden overflow grows no scrollbar.
//   - .ah-side was `align-self: start` with no overflow of its own, so the
//     column was sized to its content and simply overran the row. The comment
//     on it claimed the log's max-height capped the column; the log is capped,
//     the FELT below it is not, and a wide pool wraps to three or four rows of
//     dice in a 262px column with two hands of it.
//   - .ah-felt clips its own content too (`overflow: hidden`, which is what
//     rounds its corners), so a felt squeezed by a short panel cuts its own
//     bottom off rather than scrolling.
//
// And felt() puts the VIEWER'S OWN hand last, which is why one player lost the
// controls and the other kept them, and why it read as the two clients
// disagreeing rather than as a layout fault: the buttons hang off the end of a
// hand, so the half that gets cut is always the one only that viewer can press.
//
// The layout itself was measured in a browser against these stylesheets before
// and after the fix (clipped at a 600px pane with a wide pool, reachable at
// every pane down to 400px after). This file guards the declarations that made
// it true, because the node harness has no layout engine and cannot re-measure.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The felt: the controls under your own dice stay reachable\n');

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const match = readFileSync(new URL('../src/match.css', import.meta.url), 'utf8');

// The body of one rule, found by its selector and read to the closing brace.
// Declarations only, so a comment mentioning a property cannot pass for one.
//
// The selector has to sit at the START of a rule, not merely appear inside one.
// A plain indexOf for `.ah-felt {` finds `.ah-side .ah-felt {` forty lines
// earlier and reads the wrong body, which is a way to write a test that passes
// while checking nothing -- it caught itself here on the first run.
const rule = (css, selector) => {
  const want = selector + ' {';
  for (let at = css.indexOf(want); at >= 0; at = css.indexOf(want, at + 1)) {
    let b = at - 1;
    while (b >= 0 && /\s/.test(css[b])) b--;
    // A rule begins after the previous one closes, after a comment, or at the
    // top of the file; anything else means this is the tail of a longer
    // selector.
    if (b < 0 || css[b] === '}' || css[b] === '/' || css[b] === '{') {
      const open = css.indexOf('{', at);
      const close = css.indexOf('}', open);
      if (open < 0 || close < 0) return null;
      return css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    }
  }
  return null;
};

// The premise. If either of these ever stops being true the reasoning above
// needs revisiting rather than the rules below being kept out of habit.
{
  const body = rule(match, '.combatpop #combat-body');
  check('the combat body is still the clipping box', /overflow:\s*hidden/.test(body ?? ''), true);
  const pop = rule(match, '.combatpop');
  check('and the window is still a fixed height, not a maximum',
    /(^|[^-])height:\s*min\(/.test(pop ?? ''), true);
}

// The side column.
{
  const side = rule(styles, '.attack-helper > .ah-side');
  check('the side column exists', !!side, true);
  // `align-self: start` sizes a grid item to its content, which is exactly how
  // the column came to overrun a row it was supposed to be bounded by.
  check('and is NOT sized to its own content', /align-self:\s*start/.test(side ?? ''), false);
  check('but scrolls when its content does not fit', /overflow-y:\s*auto/.test(side ?? ''), true);
  check('and may actually be shortened, which min-height: 0 is what allows',
    /min-height:\s*0/.test(side ?? ''), true);
  // The reading column has always scrolled; asserted here so the pair cannot
  // drift apart again.
  const main = rule(styles, '.attack-helper > .ah-main');
  check('the reading column scrolls too', /overflow-y:\s*auto/.test(main ?? ''), true);
}

// Which part yields the room. The trace is a thing you read; the felt carries
// controls, and one of them may be the only press that can continue the game.
{
  const felt = rule(styles, '.ah-side > .ah-felt');
  const log = rule(styles, '.ah-side > .ah-log');
  check('the felt refuses to shrink', /flex:\s*none/.test(felt ?? ''), true);
  check('and the trace is what gives up the room instead',
    /flex:\s*0\s+1\s+auto/.test(log ?? ''), true);
  // The reason the felt must not shrink rather than merely being allowed to
  // scroll: it hides its own overflow, so shrinking it deletes content.
  check('because a shrunk felt would clip rather than scroll',
    /overflow:\s*hidden/.test(rule(styles, '.ah-felt') ?? ''), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

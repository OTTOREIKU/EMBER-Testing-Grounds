// TWO SQUADS OF ONE FACTION MUST STILL READ AS TWO SIDES.
//
// OTTO (2026-10-09), watching an RDL squad play an RDL squad: every token on the
// board wore the same red faction outline, "it's confusing who is on whos team",
// while the computer's Thinking tab listed one side in blue and one in red, which
// are UN's and RDL's own colours. He chose: in EVERY match squad 1 is ORANGE and
// squad 2 is TEAL, on the board outlines, the Thinking tab and the HUD, and the
// faction stays as a faint tint on the token and the squad cards.
//
// The node harness has no layout engine, so this guards the declarations that
// make it true: the two side colours, the rules that wear them, and the three
// rules that keep the faction.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Side colours: squad 1 orange, squad 2 teal, whatever the factions\n');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const styles = read('../src/styles.css');
const match = read('../src/match.css');
const pad = read('../pad/pad.css');
const padTs = read('../pad/pad.ts');
const board = read('../src/board.ts');

// The custom properties a stylesheet's FIRST :root block declares.
const rootVars = (css) => {
  const at = css.indexOf(':root {');
  const body = css.slice(at, css.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
};
// The body of one rule, by its exact selector at the start of a rule.
const rule = (css, selector) => {
  const want = selector + ' {';
  for (let at = css.indexOf(want); at >= 0; at = css.indexOf(want, at + 1)) {
    let b = at - 1;
    while (b >= 0 && /\s/.test(css[b])) b--;
    if (b < 0 || css[b] === '}' || css[b] === '/' || css[b] === '{') {
      const open = css.indexOf('{', at);
      return css.slice(open + 1, css.indexOf('}', open)).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    }
  }
  return null;
};

const root = rootVars(styles);
const side1 = root['--side-s1'], side2 = root['--side-s2'];
check('styles.css names a colour for each side', [!!side1, !!side2], [true, true]);
check('and they are two colours', side1 !== side2, true);
const taken = ['--rdl', '--un', '--gof', '--pd', '--collab', '--neutral', '--accent', '--green'].map((k) => root[k]);
const container = /container:\s*'(#[0-9a-f]{6})'/i.exec(board)?.[1]?.toLowerCase();
check("neither is a faction's colour, the accent or the board's green", [side1, side2].some((c) => [...taken, container].includes(c)), false);
check('--s1 and --s2 are the sides', [root['--s1'], root['--s2']], ['var(--side-s1)', 'var(--side-s2)']);

// A mirror match: both squads RDL, so --sq-s1 and --sq-s2 hold the same faction
// colour. Everything that says WHICH SIDE must therefore read --side-*.
for (const s of ['s1', 's2']) {
  const base = rule(styles, `.side-${s} .token-base`) ?? '';
  check(`${s}: the token outline is the side`, /stroke:\s*var\(--side-s[12]\)/.exec(base)?.[0], `stroke: var(--side-${s})`);
  check(`${s}: the token fill keeps a faint faction tint`, /fill:\s*color-mix\(in srgb, var\(--sq-s[12]\) 13%, #fff\)/.test(base) && base.includes(`var(--sq-${s})`), true);
  for (const sel of [`.side-${s} .token-facing`, `.move-path.side-${s}`, `.tz-claim-${s}`, `.tz-claimtag.tz-claim-${s}`, `.smoke-hatch-${s}`, `.smoke-${s} .smoke-frame`,
    `.task-item.side-${s} circle`, `.task-item.side-${s} .task-icon`, `.ao-row.side-${s} .ao-name`, `.token-head.side-${s}`, `.rt-first.side-${s}`,
    `.pg-turn .side-${s}`, `.pg-tokens .side-${s}`, `.pg-active .side-${s}`, `.pg-dial-unit.side-${s}`]) {
    check(`${s}: ${sel} wears the side`, (rule(styles, sel) ?? '').includes(`var(--side-${s})`), true);
  }
}
// The faction is left in exactly three rules: the token fill, its squad badge and
// the squad cards. A new rule reading --sq-* to say which side would bring the
// mirror-match confusion back.
const factionReads = [...styles.matchAll(/^([^{}\n]+)\{[^{}]*var\(--sq-s[12]\)/gm)].map((m) => m[1].trim());
check('only the faint-tint rules read the faction', factionReads, [
  '.side-s1 .token-base', '.side-s2 .token-base', '.side-s1 .token-squad-dot', '.side-s2 .token-squad-dot', '.squad-s1 .squad-unit', '.squad-s2 .squad-unit',
]);

// The Match Centre and the computer's games: the HUD, the Thinking tab.
const m = rootVars(match);
check('the Match Centre takes the sides from styles.css', [m['--s1'], m['--s2']], ['var(--side-s1)', 'var(--side-s2)']);
check("the Thinking tab's names wear --s1/--s2", [rule(match, 'b.s1'), rule(match, 'b.s2')], ['color: var(--s1);', 'color: var(--s2);']);

// The pad has its own palette; same two colours, and its side colour is the side's.
const p = rootVars(pad);
check('the pad uses the same two colours', [p['--side-s1'], p['--side-s2']], [side1, side2]);
check('the pad\'s --s1 and --s2 are the sides', [p['--s1'], p['--s2']], ['var(--side-s1)', 'var(--side-s2)']);
check('the pad colours a side by its seat, not its faction', /function sideColour\(s: Side\): string \{\n\s*return `var\(--side-\$\{s\}\)`;/.test(padTs), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

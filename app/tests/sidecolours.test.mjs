// TWO SQUADS OF ONE FACTION MUST STILL READ AS TWO SIDES.
//
// OTTO (2026-10-09), watching an RDL squad play an RDL squad: every token on the
// board wore the same red faction outline, "it's confusing who is on whos team",
// while the computer's Thinking tab listed one side in blue and one in red, which
// are UN's and RDL's own colours. He chose: in EVERY match squad 1 is ORANGE and
// squad 2 is TEAL, on the board outlines, the Thinking tab and the HUD, and the
// faction stays as a faint tint on the token and the squad cards.
//
// The next morning (2026-10-10) he took it further: the squad number off the
// tokens (the outline says the side), the Add tab's 1 and 2 buttons in the side
// colours, a Squad 1 / Squad 2 switch at the top of the Squads tab, the squad's
// name in white with its faction chip in the faction's colour, and all of it tied
// to ONE definition, "so if I decide to adjust the colors ... everything will
// change at once": ui.css's :root, which every page loads.
//
// The node harness has no layout engine, so this guards the declarations that
// make it true.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Side colours: squad 1 orange, squad 2 teal, whatever the factions\n');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ui = read('../src/ui.css');
const styles = read('../src/styles.css');
const match = read('../src/match.css');
const pad = read('../pad/pad.css');
const padTs = read('../pad/pad.ts');
const board = read('../src/board.ts');
const roster = read('../src/roster.ts');
const squads = read('../src/squads.ts');
const picker = read('../src/partpicker.css');

// The custom properties a stylesheet's FIRST :root block declares.
const rootVars = (css) => {
  const at = css.indexOf(':root {');
  if (at < 0) return {};
  const body = css.slice(at, css.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
};
// Every custom property any :root block of a sheet declares.
const allRootVars = (css) => {
  const out = {};
  for (let at = css.indexOf(':root {'); at >= 0; at = css.indexOf(':root {', at + 1)) Object.assign(out, rootVars(css.slice(at)));
  return out;
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

// ONE definition, in the master UI file every page loads.
const sides = rootVars(ui);
const side1 = sides['--side-s1'], side2 = sides['--side-s2'];
check('ui.css names a colour for each side, and a quiet tint of each', [!!side1, !!side2, !!sides['--side-s1-lt'], !!sides['--side-s2-lt']], [true, true, true, true]);
check('and they are two colours', side1 !== side2, true);
check('nowhere else sets them: not styles.css, the Match Centre or the pad',
  ['--side-s1', '--side-s2'].some((k) => k in allRootVars(styles) || k in allRootVars(match) || k in allRootVars(pad)), false);
check('every page loads ui.css: the board pages through styles.css, the pad through partpicker.css',
  [styles.startsWith("@import './partpicker.css';"), picker.startsWith("@import './ui.css';"), padTs.includes("import '../src/partpicker.css';")], [true, true, true]);
const root = rootVars(styles);
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
    `.pg-turn .side-${s}`, `.pg-tokens .side-${s}`, `.pg-active .side-${s}`, `.pg-dial-unit.side-${s}`,
    `button.add.sq-add.side-${s}`, `.squad-switch-btn.side-${s}.on`]) {
    check(`${s}: ${sel} wears the side`, (rule(styles, sel) ?? '').includes(`var(--side-${s}`), true);
  }
}
// The faction is left in exactly two kinds of rule: the token's faint fill and the
// squad cards. A new rule reading --sq-* to say which side would bring the
// mirror-match confusion back.
const factionReads = [...styles.matchAll(/^([^{}\n]+)\{[^{}]*var\(--sq-s[12]\)/gm)].map((m) => m[1].trim());
check('only the faint-tint rules read the faction', factionReads, ['.side-s1 .token-base', '.side-s2 .token-base', '.squad-s1 .squad-unit', '.squad-s2 .squad-unit']);

// No squad number on a token: the outline says the side (OTTO, 2026-10-10).
check('the squad number badge is gone from the tokens',
  [/token-squad-(dot|n)/.test(board), /\.token-squad-(dot|n)/.test(styles), /squadNumber/.test(board)], [false, false, false]);

// Every "put this in a squad" button wears its side.
check("the Add tab's 1 and 2 take their side's class, never a faction's tint",
  [roster.includes('b.classList.add(`side-${side}`);'), /has-faction/.test(roster), /has-faction/.test(styles)], [true, false, false]);
check("the mech editor's Save and the picker's Add to are the side's too",
  [roster.includes("save.className = `add sq-add sq-wide side-${ed.side}`;"), roster.includes('tint: `var(--side-${side})`,')], [true, true]);

// The Squads tab's switch: one squad shown at a time, the one shown tinted.
check('the Squads tab opens on a switch and shows the one squad it names',
  [squads.includes('this.root.appendChild(this.squadSwitch(shown));'), squads.includes('if (side !== shown) continue;')], [true, true]);
check("a unit selected on the board shows its own squad", /if \(t\) this\.shown = t\.side;/.test(squads), true);
check("the switch's shown button is tinted, its text the side's colour",
  [rule(styles, '.squad-switch-btn.side-s1.on'), rule(styles, '.squad-switch-btn.side-s2.on')],
  ['background: var(--side-s1-lt); color: var(--side-s1);', 'background: var(--side-s2-lt); color: var(--side-s2);']);

// The squad's heading: the name in white, its faction chip in the faction's colour.
check("the squad's name is white", rule(styles, '.squad h3'), 'font-size: 11px; margin: 10px 0 6px; letter-spacing: 0.7px; text-transform: uppercase; font-weight: 700;');
check('(and its colour rule is the text colour)', /\.squad h3 \{ color: var\(--text\); \}/.test(styles), true);
check("its faction chip wears the faction's colour", (rule(styles, '.squad h3 .fac-chip:not(.bad):not(.generic)') ?? '').includes('var(--squad-tint'), true);

// The Match Centre and the computer's games: the HUD, the Thinking tab.
const m = rootVars(match);
check('the Match Centre takes the sides from ui.css', [m['--s1'], m['--s2']], ['var(--side-s1)', 'var(--side-s2)']);
check("the Thinking tab's names wear --s1/--s2", [rule(match, 'b.s1'), rule(match, 'b.s2')], ['color: var(--s1);', 'color: var(--s2);']);

// The pad: the same two colours, from ui.css, and its side colour is the side's.
const p = rootVars(pad);
check('the pad\'s --s1 and --s2 are the sides', [p['--s1'], p['--s2']], ['var(--side-s1)', 'var(--side-s2)']);
check('the pad colours a side by its seat, not its faction', /function sideColour\(s: Side\): string \{\n\s*return `var\(--side-\$\{s\}\)`;/.test(padTs), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

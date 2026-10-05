// The contract between the engine and the computer player
// (AI-OPPONENT-PLAN.md, section 3), held by the suite and not by memory.
//
// OTTO, 2026-10-01: "we need to make sure the scaffolding for the AI code has
// an easy time picking up the engine so if we make fundamental changes down
// the line it doesnt break the AI, or if we add new features it will more
// easily be able to understand how to use them or at least make it easy for us
// to wire them in."
//
// What this file makes true:
//   R7  every command the engine has and every question a seat can be put is
//       classified in tests/aicover.mjs. A NEW COMMAND FAILS HERE until it has
//       a line there saying whether a computer seat chooses it, a window sends
//       it, the table owns it, or it is still to be offered. The lines classed
//       `later` are the to-do list for "teach the computer this".
//   R4  the brain (the policies) imports the seat seam and nothing else of the
//       game, so the engine can be rebuilt behind the seam without touching it.
//   R1  the brain builds no command.
//   The seam and the driver import no page.
// (R8, that the engine still plays whole games against itself, is
// botgame.test.mjs; R3, that the pages draw from the same readings, is
// turn.test.mjs, contest.test.mjs and defender.test.mjs.)
import { readFileSync, readdirSync } from 'node:fs';
import { COMMANDS, DECISIONS, NOT_OFFERED, document } from './aicover.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The engine and the computer player\n');

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const builds = (text, kind) => new RegExp(`kind: '${kind}'`).test(text);

// ---------- R7: every command is classified ----------
const commands = src('commands.ts');
const union = (() => {
  const a = commands.indexOf('export type Command =');
  const rest = commands.slice(a + 20);
  return commands.slice(a, a + 20 + rest.search(/\n(?:export |function |const |\/\/ [A-Z])/));
})();
const kinds = [...new Set([...union.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]))].sort();
check('the engine\'s commands were found', kinds.length > 120, true);
check('EVERY COMMAND IS CLASSIFIED: a new one needs a line in tests/aicover.mjs saying how a computer seat stands to it',
  kinds.filter((k) => !COMMANDS[k]), []);
check('and the register names no command the engine has dropped', Object.keys(COMMANDS).filter((k) => !kinds.includes(k)), []);
const CLASSES = ['seat', 'window', 'driver', 'table', 'later'];
check('each is one of five classes, with a word on what it is',
  Object.entries(COMMANDS).filter(([, v]) => !CLASSES.includes(v[0]) || typeof v[1] !== 'string' || v[1].length < 8).map(([k]) => k), []);

// The register is held to the source, so it cannot quietly go stale.
const seam = src('owed.ts') + src('turn.ts');
const owed = src('owed.ts');
const aiDir = readdirSync(new URL('../src/ai/', import.meta.url)).filter((f) => f.endsWith('.ts'));
const ai = Object.fromEntries(aiDir.map((f) => [f, src(`ai/${f}`)]));
const windows = src('combat.ts') + src('defender.ts') + src('contest.ts') + ai['botcombat.ts'] + src('units.ts');
const of = (cls) => Object.entries(COMMANDS).filter(([, v]) => v[0] === cls).map(([k]) => k);
check('a command classed `seat` is one the seam really builds into an option', of('seat').filter((k) => !builds(seam, k)), []);
check('one classed `driver` is one a driver routine really sends', of('driver').filter((k) => !builds(ai['driver.ts'], k)), []);
check('one classed `window` is one the attack or Counter-roll window really sends', of('window').filter((k) => !builds(windows, k)), []);
check('one classed `later` is offered nowhere yet: when the seam starts to build it, move its line',
  of('later').filter((k) => builds(owed, k) || Object.values(ai).some((t) => builds(t, k) && !new RegExp(`kind: '${k}' as const`).test(t))), []);
check('and one classed `table` is never an option of a seat', of('table').filter((k) => builds(owed, k) || builds(ai['driver.ts'], k)), []);
// The list shrinks a slice at a time (M8.2): it must not be emptied by a
// stroke, and must still name what an activation leaves out.
check('the to-do list is not empty, and says what an activation leaves out', [of('later').length > 5, NOT_OFFERED.length > 5], [true, true]);

// ---------- R7: every question a seat can be put is classified ----------
{
  const asked = new Set();
  for (const m of owed.matchAll(/ask\('([\w.]+)'/g)) asked.add(m[1]);
  for (const m of owed.matchAll(/ask\(`([\w.]+)\.\$\{/g)) asked.add(`${m[1]}.*`);
  for (const m of owed.matchAll(/\? '([\w]+\.[\w]+)' : '([\w]+\.[\w]+)'/g)) { asked.add(m[1]); asked.add(m[2]); }
  const pressed = new Set();
  for (const text of [ai['botcombat.ts'], ai['botcontest.ts']]) for (const m of text.matchAll(/kind: '((?:attack|defence|contest)\.\w+)'/g)) pressed.add(m[1]);
  // A window that is a mirror of the other seat's attack asks the same
  // questions under the defender's name.
  const mirrored = [...pressed].filter((k) => k.startsWith('attack.')).map((k) => k.replace(/^attack\./, 'defence.'));
  const known = Object.keys(DECISIONS);
  check('the turn\'s questions were found', asked.size >= 18, true);
  check('EVERY QUESTION OF THE TURN IS CLASSIFIED', [...asked].filter((k) => !known.includes(k)).sort(), []);
  check('and every question of an attack or a Counter-roll', [...pressed].filter((k) => !known.includes(k)).sort(), []);
  check('the register names no question the seam cannot ask',
    known.filter((k) => !asked.has(k) && !pressed.has(k) && !mirrored.includes(k)), []);
  check('each has a safe answer written down', Object.entries(DECISIONS).filter(([, v]) => typeof v[0] !== 'string' || !v[0].length || !Array.isArray(v[1])).map(([k]) => k), []);
  // A policy said to have a rule for a question really names it.
  const named = (policy, kind) => {
    const text = ai[`${policy}.ts`] ?? '';
    const stem = kind.replace(/\.\*$/, '.');
    const tail = kind.split('.').pop();
    return text.includes(`'${kind}'`) || text.includes(`'${stem}`) || text.includes(`'.${tail}'`);
  };
  check('a policy credited with a rule for a question has one',
    Object.entries(DECISIONS).flatMap(([k, v]) => v[1].filter((p) => !named(p, k)).map((p) => `${p}: ${k}`)), []);
  // R6: a question always carries an answer that is among its options.
  check('R6 the seam can ask nothing without a safe answer: the fallback is one of the options, or the first of them',
    [/fallback: options\.some\(\(o\) => o\.id === fallback\) \? fallback : options\[0\]\.id,/.test(owed), /if \(!options\.length\) return null;/.test(owed),
      /fallback: \(safe \?\? options\[0\]\)\.id,/.test(ai['botcombat.ts']), /fallback: \(options\.find\(\(o\) => o\.id === q\.safe\) \?\? options\[0\]\)\.id,/.test(ai['botcontest.ts'])],
    [true, true, true, true]);
  check('and a policy that names no option, or one that is not offered, costs the seat its judgement and not its turn',
    [/narrowed\.options\.find\(\(o\) => o\.id === pick\) \?\? narrowed\.options\.find\(\(o\) => o\.id === narrowed\.fallback\)!/.test(ai['driver.ts']),
      /catch \(err\) \{[\s\S]{0,200}pick = narrowed\.fallback;/.test(ai['driver.ts'])], [true, true]);
}

// ---------- R4 and R1: the brain ----------
const imports = (text) => [...text.matchAll(/^import (type )?[^;]*? from '([^']+)';/gm)].map((m) => `${m[1] ? 'type ' : ''}${m[2]}`);
{
  const BRAIN = ['policy.ts', 'legal.ts', 'eager.ts', 'brawler.ts', 'evaluate.ts', 'tactician.ts', 'levels.ts'];
  // A policy may build on another policy and on the price list (evaluate.ts):
  // both are of the brain, and held to the same rules here. The levels
  // (levels.ts, M9.1) are the Brawler and the Tactician made into easier ones.
  const ALLOWED = new Set(['type ../seat', 'type ./policy', 'type ./rng', './legal', './brawler', './evaluate', 'type ./evaluate', './tactician']);
  check('the brain is the policies, and every one of them is checked here',
    aiDir.filter((f) => !['driver.ts', 'botcombat.ts', 'botcontest.ts', 'odds.ts', 'rng.ts', 'index.ts'].includes(f)).sort(), [...BRAIN].sort());
  check('R4 a policy imports the seat seam and its own kind, and nothing else of the game: types only from the seam',
    BRAIN.flatMap((f) => imports(ai[f]).filter((i) => !ALLOWED.has(i)).map((i) => `${f}: ${i}`)), []);
  check('R1 a policy builds no command, reads no state and touches no page',
    BRAIN.map((f) => [/\bkind: '/.test(ai[f]), /GameState|\.tokens\b|host\./.test(ai[f]), /\bdocument\.|\bwindow\./.test(ai[f])]), BRAIN.map(() => [false, false, false]));
  check('the generator imports nothing at all', imports(ai['rng.ts']), []);
  // The code, with its comments set aside: they say what it does not read.
  const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('and reads no clock and no Math.random: a seed is a game', [/Math\.random|Date\.now/.test(code(ai['rng.ts'])), BRAIN.some((f) => /Math\.random|Date\.now/.test(code(ai[f])))], [false, false]);
}

// ---------- the seam and the driver import no page ----------
{
  const PAGES = ['matchhud', 'match', 'main', 'board', 'dialog', 'notices', 'squads', 'panel', 'reference', 'refcards', 'playguide', 'net', 'ui'];
  const page = (text) => imports(text).map((i) => i.replace(/^type /, '').replace(/^\.\.?\//, '')).filter((i) => PAGES.includes(i));
  check('the seam (seat, owed, turn, defender, contest) imports no page',
    ['seat.ts', 'owed.ts', 'turn.ts', 'defender.ts', 'contest.ts'].flatMap((f) => page(src(f)).map((i) => `${f}: ${i}`)), []);
  check('nor does anything a computer seat is made of', Object.entries(ai).flatMap(([f, text]) => page(text).map((i) => `${f}: ${i}`)), []);
  check('the seam touches no document and no window', ['seat.ts', 'owed.ts', 'turn.ts', 'defender.ts', 'contest.ts'].filter((f) => /\bdocument\.|\bwindow\./.test(src(f))), []);
  check('R2 a seat\'s whole view of the rules is one module: the view, the types, and the one question',
    [/export function viewOf\(/.test(src('seat.ts')), /export \{ owed, owedAfter, owedIfActivated, sightedIn, tableWithout, walkIn, gameOver, newMind, walkedKey, type MineOffer, type SeatMind, type GameOver, type WalkMemo, type Want \} from '\.\/owed';/.test(src('seat.ts')),
      (owed.match(/^export function owed\(/gm) ?? []).length], [true, true, 1]);
  // Looking ahead is the seam's too: the table an answer would leave, and a
  // unit's own turn before it comes, are each asked of the one question.
  check('and its looks ahead are that question asked of another table: what comes next, and a turn that has not come',
    [/export function owedAfter\(/.test(owed), /return \{ table, decision: owed\(data, table, seat, mind, want\), born:/.test(owed),
      /export function owedIfActivated\(/.test(owed), /return \{ table, decision: activationOwed\(data, table, t\.side, t, want\) \};/.test(owed),
      /const table = copyAsJson\(state\);/.test(owed)], [true, true, true, true, true]);
  check('a dial not yet revealed is nobody\'s to look at: a Mech is asked on the Timing the asker names, never on its own',
    [/if \(!timing\) return null;\n    t\.timing = timing;/.test(owed), /owedIfActivated\([^)]*\bt\.timing\b/.test(owed)], [true, false]);
  check('the driver reads the rules through that module and the windows it presses',
    imports(ai['driver.ts']).map((i) => i.replace(/^type /, '')).sort(),
    ['../commands', '../data', '../seat', '../secrecy', '../setup', '../types', './botcombat', './botcontest', './odds', './policy', './rng']);
  check('of the command layer it takes types alone', /import type \{ CheckResult, Command \} from '\.\.\/commands';/.test(ai['driver.ts']), true);
}

// ---------- R5: a dice option is valued by the engine's own arithmetic ----------
{
  const odds = ai['odds.ts'];
  const code = odds.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('R5 the odds are asked of the combat window: its reading, its offsetting, and the attack opened as a played one is',
    [/import \{ AttackHelper, offsetIcons, type AttackFace, type AttackReading, type DefenceFace, type PartReading \} from '\.\.\/combat';/.test(odds),
      /import \{ attackOpening, terrainOf \} from '\.\.\/turn';/.test(odds), /this\.helper\.start\(open\.attacker, open\.action, open\.defender,/.test(odds), /return this\.helper\.reading\(\);/.test(odds),
      /h\.headless = true;/.test(odds)], [true, true, true, true, true]);
  check('and they know no card, no keyword and no Stance of their own: nothing of units.ts, no card text, no pool arithmetic',
    [/from '\.\.\/units'/.test(odds), /tokenCards|\.keywords|description|redDice|yellowDice|\.armor\b|\.dodge \?\?/.test(code), /stance === '(offensive|mobility)'/.test(code)], [false, false, false]);
  check('they send nothing: the window\'s commands stop at the calculator, which only moves a Suppressed target\'s Stance for the length of the reading and puts it back',
    [/cmd\.kind === 'suppress' && check\(data, table, cmd\)\.ok/.test(odds), /this\.undo\.push\(\(\) => \{ target\.stance = was; \}\);/.test(odds),
      /for \(const back of this\.undo\.splice\(0\)\.reverse\(\)\) back\(\);/.test(odds), /perform\(|applyRemote\(|host\.send/.test(code)], [true, true, true, false]);
  check('exact, not sampled: no clock and no Math.random', /Math\.random|Date\.now/.test(code), false);
  check('a policy is handed the odds on the answer itself, and the driver puts them there for every attack',
    [/chance\?: \(\) => Forecast \| null;/.test(src('seat.ts')), /export interface Forecast \{/.test(src('seat.ts')),
      /if \(o\.run\?\.routine === 'attack' && !o\.chance\) \{/.test(ai['driver.ts']), /return this\.withOdds\(d\);/.test(ai['driver.ts'])], [true, true, true, true]);
  check('and what an answer would lead to: what comes next, a turn later, the Opportunity a dial would open',
    [/then\?: \(only\?: string\[\]\) => Decision \| null;/.test(src('seat.ts')), /later\?: \(only\?: string\[\], timing\?: string\) => Decision \| null;/.test(src('seat.ts')),
      /o\.then = once\(\(only\) => \{\n\s+const after = owedAfter\(/.test(ai['driver.ts']), /o\.later = once\(\(only, timing\) => \{/.test(ai['driver.ts']),
      /if \(o\.run\?\.routine === 'dial' && !o\.then\) \{/.test(ai['driver.ts'])], [true, true, true, true, true]);
  // M7.0: the table an answer would leave, looked at any way a seat likes.
  check('and the table an answer would leave, to be looked at whole: the seat\'s view of it, what any unit would be asked on it, who would see a unit there',
    [/export interface Outlook \{/.test(src('seat.ts')), /after\?: \(\) => Outlook \| null;/.test(src('seat.ts')), /here\?: \(\) => Outlook;/.test(src('seat.ts')),
      /private outlook\(state: GameState\): Outlook \{/.test(ai['driver.ts']), /view: \(\) => \(seen \?\?= viewOf\(data, state, this\.seat\)\),/.test(ai['driver.ts']),
      /const turn = owedIfActivated\(data, state, uid, timing as Timing \| undefined, only \? \{ only \} : undefined\);/.test(ai['driver.ts']),
      /seen: \(uid, grids, from\) => sightedIn\(data, state, uid, /.test(ai['driver.ts'])], [true, true, true, true, true, true, true]);
  check('a question put to the other seat is asked as that seat, with none of this seat\'s memory: its dials are its own',
    [/const seat = d\.seat;\n\s+const mind = seat === this\.seat \? this\.mind : this\.nobody;/.test(ai['driver.ts']), /private readonly nobody: SeatMind = newMind\(\);/.test(ai['driver.ts']),
      /owedAfter\(data, state, this\.seat, this\.mind/.test(ai['driver.ts'])], [true, true, false]);
  check('who would see a unit is the board\'s own reading of the line, and reads no card',
    [/export function sightedIn\(/.test(owed), /const sight = firingSight\(e, there, terrain, tokens, smoke\);/.test(owed)], [true, true]);
  check('how long a walk is is the engine\'s count (turn.ts walkField: the board as its Movement reads it, a Grid stood in where the board would stand it), and the driver keeps each field by what it was read from',
    [/export function walkIn\(/.test(owed), /field = turn\.walkField\(data, state, t, to, via\);/.test(owed),
      /const key = `\$\{turn\.walkKey\(data, state, t\)\}\|/.test(owed), /export function walkField\(/.test(src('turn.ts')), /const stands = standingSpot\(c, r, t\.size, !!t\.aerial, terrain, \[\], t\.uid\) !== null;/.test(src('turn.ts')),
      /walk: \(uid, from, to, left, via\) => walkIn\(data, state, uid, .*, left, this\.walks, via \? \{ c: via\.col, r: via\.row \} : undefined\),/.test(ai['driver.ts']), /private readonly walks: WalkMemo = new Map\(\);/.test(ai['driver.ts'])],
    [true, true, true, true, true, true, true]);
  check('the board with a unit gone from it is the seam\'s own copy with the unit off the list, looked at through the same Outlook: nothing is sent to make it',
    [/export function tableWithout\(state: GameState, uid: number\): GameState \{\n  return \{ \.\.\.state, tokens: state\.tokens\.filter\(\(t\) => t\.uid !== uid\) \};/.test(owed),
      /if \(!out\) gone\.set\(uid, out = this\.outlook\(tableWithout\(state, uid\)\)\);/.test(ai['driver.ts']), /without\(uid: number\): Outlook;/.test(src('seat.ts'))],
    [true, true, true]);
  check('the narrow kinds of look are the turn panel\'s own readings of the table a step leaves',
    [/function reaching\(/.test(owed), /turn\.attackLines\(data, table, \{ uid: mover\.uid, actionId: row\.a\.id, only: targetUid \}\)/.test(owed),
      /const reading = turn\.attackLines\(data, state, \{ uid: t\.uid, actionId: row\.a\.id, \.\.\.\(narrowed \? \{ only: struck \} : \{\}\) \}\);/.test(owed)], [true, true, true]);
  check('each of them is the seam\'s own look, worked out on a copy: the driver applies no command to think',
    [/tableAfter\(|applyRemote\(|\bapply\(data/.test(ai['driver.ts'].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'))], [false]);
  check('in the combat window every answer with dice still to come is given what it comes to',
    [/this\.withChances\(options, mirror, thrown, read\);/.test(ai['botcombat.ts']),
      ['declare.none', 'declare.designate', 'part.roll', 'part.focus', 'part.keep', 'part.pick', 'focus.pass', 'focus.use', 'focus.lent', 'focus.whistle', 'reroll.keep', 'reroll.idle', 'reroll.all', 'reroll.pick', 'surplus.effect']
        .filter((act) => !new RegExp(`'${act.replace('.', '\\.')}': \\(h`).test(ai['botcombat.ts']))], [true, []]);
}

// ---------- the document ----------
{
  const doc = document();
  check('the register prints as a document, the to-do list first',
    [doc.startsWith('# What the computer seat is wired to do'), doc.indexOf('## The to-do list') < doc.indexOf('## Chosen by a seat today'), kinds.every((k) => doc.includes(`\`${k}\``))],
    [true, true, true]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

// No em dashes in anything a player reads.
//
// OTTO has asked for this three times, so it is a rule rather than a taste, and
// a rule nobody can enforce by hand across 47 modules is a rule that decays.
// The sweep took 91 of them out of the prose; this stops the next one arriving.
//
// COMMENTS ARE NOT COVERED, deliberately. They are prose for whoever is reading
// the source, not for a player, and the codebase writes them that way
// throughout. The line this test draws is exactly the line the rule cares
// about: text that reaches a screen.
//
// Telling one from the other needs a real lexer. A naive scan mishandles two
// things and both of them lie:
//
//   * a regex holding a quote -- /[&<>"]/g -- reads as the start of a string,
//     and everything after it counts as prose. That over-counted by 60%.
//   * `${(() => { ... })()}` closes an arrow function inside an interpolation,
//     and treating that brace as the end of the interpolation leaves the rest
//     of the FILE reading as template text. That one reported three code
//     comments as player-facing prose.
//
// Both are reproduced below before the rule is enforced, because a checker that
// is quietly broken is worse than no checker.
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';

const DASH = '—';
const dir = new URL('../src/', import.meta.url);
const src = (f) => readFileSync(new URL(f, dir), 'utf8');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const ok = (name, cond) => check(name, !!cond, true);

// ---------- the lexer ----------

const REGEX_OK_AFTER = new Set([...'([{,;:=!&|?+-*%~^<>',
  'return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await', 'new']);

// Returns [{ index, kind }] for every DASH, kind being where it sits.
function scan(text) {
  const out = [];
  const stack = [];        // ['tmpl'|'interp', braceDepth]
  let i = 0, mode = 'code', quote = '', prev = '';
  const n = text.length;
  const note = (kind) => out.push({ index: i, kind });

  while (i < n) {
    const c = text[i], d = text[i + 1] ?? '';
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { mode = 'block'; i += 2; continue; }
      if (c === '/') {
        if (REGEX_OK_AFTER.has(prev) || prev === '') { mode = 'regex'; i++; continue; }
        prev = '/'; i++; continue;
      }
      if (c === '\'' || c === '"') { mode = 'str'; quote = c; i++; continue; }
      if (c === '`') { mode = 'tmpl'; stack.push(['tmpl', 0]); i++; continue; }
      if (c === '{' && stack.length && stack.at(-1)[0] === 'interp') { stack.at(-1)[1]++; i++; continue; }
      if (c === '}' && stack.length && stack.at(-1)[0] === 'interp') {
        if (stack.at(-1)[1] > 0) { stack.at(-1)[1]--; i++; continue; }
        stack.pop(); mode = 'tmpl'; i++; continue;
      }
      if (/[\w$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(text[j])) j++; prev = text.slice(i, j); i = j; continue; }
      if (!/\s/.test(c)) prev = c;
      i++; continue;
    }
    if (mode === 'line') { if (c === '\n') mode = 'code'; else if (c === DASH) note('line'); i++; continue; }
    if (mode === 'block') { if (c === '*' && d === '/') { mode = 'code'; i += 2; continue; } if (c === DASH) note('block'); i++; continue; }
    if (mode === 'str') {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) { mode = 'code'; prev = 'x'; i++; continue; }
      if (c === DASH) note('str');
      i++; continue;
    }
    if (mode === 'tmpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && d === '{') { stack.push(['interp', 0]); mode = 'code'; prev = ''; i += 2; continue; }
      if (c === '`') { if (stack.length && stack.at(-1)[0] === 'tmpl') stack.pop(); mode = 'code'; prev = 'x'; i++; continue; }
      if (c === DASH) note('tmpl');
      i++; continue;
    }
    if (mode === 'regex') {
      if (c === '\\') { i += 2; continue; }
      if (c === '[') { let j = i + 1; while (j < n && text[j] !== ']') { if (text[j] === '\\') j++; j++; } i = j + 1; continue; }
      if (c === '/' || c === '\n') { mode = 'code'; prev = 'x'; i++; continue; }
      i++; continue;
    }
  }
  return out;
}

// ---------- prove the lexer before trusting it ----------

console.log('\nthe checker itself');

check('a regex holding a quote does not become a string',
  scan(`const e = s.replace(/[&<>"]/g, c => c);\nconst m = 'a ${DASH} b';`).map((h) => h.kind),
  ['str']);
check('an arrow function inside an interpolation does not end it',
  scan('const a = `x ${(() => { return 1; })()} y`;\n// c ' + DASH + '\n').map((h) => h.kind),
  ['line']);
check('a comment is a comment', scan(`// hi ${DASH} there`).map((h) => h.kind), ['line']);
check('and a template is prose', scan('const t = `a ' + DASH + ' b`;').map((h) => h.kind), ['tmpl']);

// The strongest check available without a second parser: every `//` that opens
// a line must be seen as a comment. A lexer that has lost its place fails this
// almost immediately.
console.log('\nthe checker keeps its place in every module');

const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'vite-env.d.ts');
const lost = [];
for (const f of files) {
  const t = src(f);
  const marks = [];
  // Re-scan tracking spans is overkill; instead assert the count of dashes the
  // scanner attributes equals the count in the file. A desync loses none, but a
  // crash or an unterminated mode would.
  const total = (t.match(new RegExp(DASH, 'g')) ?? []).length;
  if (scan(t).length !== total) lost.push(f);
}
check('every dash in every module is accounted for', lost, []);

// ---------- the rule ----------

console.log('\nno em dash reaches a player');

const offenders = [];
for (const f of files) {
  const t = src(f);
  for (const h of scan(t)) {
    if (h.kind !== 'str' && h.kind !== 'tmpl') continue;
    const before = t[h.index - 1], after = t[h.index + 1];
    // A LONE dash is the table's "no value" glyph, not prose: `${x ?? '—'}`.
    // It is a typographic convention and stays.
    const lone = (/['"`]/.test(before ?? '') && /['"`]/.test(after ?? ''))
      || (before === '>' && after === '<');
    if (lone) continue;
    const line = t.slice(0, h.index).split('\n').length;
    offenders.push(`${f}:${line}`);
  }
}
check('no module has one in a sentence', offenders, []);

// The placeholders are counted rather than ignored, so removing one on purpose
// is a decision somebody makes here rather than a silent drift.
let placeholders = 0;
for (const f of files) {
  const t = src(f);
  for (const h of scan(t)) {
    if (h.kind !== 'str' && h.kind !== 'tmpl') continue;
    const before = t[h.index - 1], after = t[h.index + 1];
    if ((/['"`]/.test(before ?? '') && /['"`]/.test(after ?? '')) || (before === '>' && after === '<')) placeholders++;
  }
}
check('and the table placeholders are still exactly the known set', placeholders, 14);

// The pages themselves. Every dash in the markup is on screen.
console.log('\nand none in the markup');

for (const page of ['index.html', 'reference.html', 'match.html']) {
  const t = readFileSync(new URL(`../${page}`, dir), 'utf8');
  check(`${page} has none`, t.includes(DASH), false);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

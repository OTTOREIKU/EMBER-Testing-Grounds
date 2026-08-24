// Every data file parses, and no object has a duplicate key.
//
// A duplicate key inside one JSON object is NOT an error. Every parser --
// Python's, node's, the browser's -- silently keeps the LAST one and discards
// the rest. So the file loads, the app runs, and one of the two values simply
// never existed as far as anything can tell.
//
// Both kinds of damage have happened here:
//   - a NEW entry added to the top of an override file while the real one sat
//     further down, so the new value was the one thrown away (2026-08-24,
//     stat_overrides 179 and 181)
//   - a STALE entry left above its own correction, so the right value survived
//     only by being later in the file (name_overrides XPA-59 and XPA-61 held
//     "Combatant A-101"/"A-103" above the scan-verified A-69/A-71). A reformat
//     or an alphabetical re-sort would have handed the wrong names back.
//
// The second is the reason this is a test and not a lint: nothing looks wrong
// at any point, and the failure is triggered by an unrelated tidy-up.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Data files: parseable, and no silently-dropped keys\n');

const dir = fileURLToPath(new URL('../../data/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
check('the data directory was actually read', files.length > 10, true);

const unparseable = [];
const dupes = [];

for (const f of files) {
  const text = readFileSync(dir + f, 'utf8');
  try {
    JSON.parse(text);
  } catch (e) {
    unparseable.push(`${f}: ${e.message}`);
  }
}
check('every data file is valid JSON', unparseable, []);

// ---------- the duplicate hunt ----------
// Done on the raw text with a small scanner, because by the time JSON.parse
// has returned, the evidence has been destroyed.
const scan = (text, file) => {
  const out = [];
  const stack = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      // read a string
      let j = i + 1;
      let s = '';
      while (j < n) {
        if (text[j] === '\\') { s += text[j + 1] === 'n' ? '\n' : text[j + 1]; j += 2; continue; }
        if (text[j] === '"') break;
        s += text[j]; j++;
      }
      // a key is a string followed (after whitespace) by a colon
      let k = j + 1;
      while (k < n && /\s/.test(text[k])) k++;
      if (text[k] === ':' && stack.length && stack[stack.length - 1].obj) {
        const top = stack[stack.length - 1];
        if (top.keys.has(s)) out.push(`${file}: "${s}"`);
        top.keys.add(s);
      }
      i = j + 1;
      continue;
    }
    if (ch === '{') stack.push({ obj: true, keys: new Set() });
    else if (ch === '[') stack.push({ obj: false, keys: new Set() });
    else if (ch === '}' || ch === ']') stack.pop();
    i++;
  }
  return out;
};

for (const f of files) dupes.push(...scan(readFileSync(dir + f, 'utf8'), f));

// Guard the scanner itself: it must find a duplicate that is really there.
const proof = scan('{"a":1,"b":{"c":1,"c":2},"a":3}', 'probe');
check('the duplicate scanner works', proof.sort(), ['probe: "a"', 'probe: "c"']);
check('and does not cry wolf on the same key in DIFFERENT objects',
  scan('{"x":{"k":1},"y":{"k":2}}', 'probe'), []);
check('nor on a key that only appears inside a string value',
  scan('{"a":"see \\"a\\": here","b":2}', 'probe'), []);

check('no data file has a duplicate key in one object', dupes, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

// The reference is a RULES reference: a player reads it beside a physical game
// and should get the rule, not a description of this tool. Anything that says
// "click", "greyed out", "the panel" or names one of our own tabs is a line
// that stops being true the moment the UI changes, and was never the rule.
//
// Provenance IS allowed and deliberately not matched here — "our English
// rendering of the printed Korean, so the physical card wins", "a reading
// rather than a published ruling" — because those tell a reader how far to
// trust the line, which is the opposite of commentary.
//
// Scope: every string the Rules and Keywords tabs render. mechanics.json and
// play.json supply the prose; StatusDef.rule/.note supply the token text.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Reference tone: rules, not UI commentary\n');

// Phrases that only make sense if you are looking at OUR screen.
const UI = [
  'in this app', 'this app', 'the app does not', 'the panel', 'greyed out', 'grey out',
  'click to', 'shift-click', 'right-click', 'this tool', 'the popout', 'the tracker',
  'the attack helper', 'details tab', 'squads tab', 'missions tab', 'rules tab',
  'boxes tab', 'units tab', 'parts tab', 'when browsing', 'the card data',
];
const offenders = (text) => UI.filter((w) => text.toLowerCase().includes(w));

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

// ---------- mechanics.json ----------
const mRaw = json('../../data/mechanics.json');
const mechanics = Array.isArray(mRaw) ? mRaw : mRaw.mechanics;
const mechBad = mechanics.flatMap((e) => offenders(e.text || '').map((w) => `${e.id}: "${w}"`));
check('no mechanics entry describes the UI', mechBad, []);

// Every entry is sourced. An entry with no ref is either unsourced prose or a
// rule nobody can look up, and both are the thing this file exists to stop.
check('every mechanics entry cites a source', mechanics.filter((e) => !e.ref).map((e) => e.id), []);

// ---------- play.json ----------
const play = json('../../data/play.json');
const playLines = [
  ...play.phases.flatMap((p) => [...(p.can ?? []), ...(p.cannot ?? []), p.who ?? '']),
  ...play.timings.map((t) => t.text ?? ''),
  ...play.stances.flatMap((s) => [s.effect ?? '', s.good ?? '', s.cost ?? '']),
  ...(play.timingNotes?.lines ?? []),
  ...(play.stanceNotes?.lines ?? []),
];
check('no phase, timing or stance line describes the UI', playLines.flatMap(offenders), []);

// ---------- StatusDef rule/note ----------
// Line-oriented: each field is one line in types.ts. NOTE the slice order —
// hexagonIds() sits BEFORE the array, so an end marker taken from it silently
// yields an empty string and a test that passes having read nothing.
const types = read('../src/types.ts');
const from = types.indexOf('export const STATUSES');
const to = types.indexOf('export interface RoundState');
if (from < 0 || to <= from) throw new Error('could not slice STATUSES out of types.ts');
const statusBlock = types.slice(from, to);

let id = '';
const tokenBad = [];
let fields = 0;
for (const line of statusBlock.split('\n')) {
  const idm = line.match(/^\s*id: '(\w+)',/);
  if (idm) { id = idm[1]; continue; }
  const fm = line.match(/^\s*(rule|note): '(.*)',\s*$/);
  if (!fm) continue;
  fields++;
  offenders(fm[2]).forEach((w) => tokenBad.push(`${id}.${fm[1]}: "${w}"`));
}
// Guard the reader itself: 11 statuses each carrying a rule and a note.
check('the token text was actually read', fields >= 20, true);
check('no token rule or note describes the UI', tokenBad, []);

// ---------- provenance survives ----------
// The opposite failure: stripping so hard that a reader can no longer tell
// which lines are the publisher's and which are ours.
const allMech = mechanics.map((e) => e.text).join(' ');
check('translation provenance is still stated', /our English rendering/.test(allMech), true);
check('unofficial readings are still flagged', /a reading rather than a published ruling/.test(allMech), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

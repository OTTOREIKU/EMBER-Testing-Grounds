// Checks that a saved script block from an older build cannot break startup.
// A slice-1 save has no `stage`, and reading `sc.stage.split(':')` on it threw
// "can't access property split, sc.stage is undefined" before this normaliser.
import { readFileSync, writeFileSync } from 'node:fs';

const srcUrl = new URL('../src/types.ts', import.meta.url);
const src = readFileSync(srcUrl, 'utf8');
// normaliseScript leans on normaliseOpportunity, so the slice starts above both.
const start = src.indexOf('export function newOpportunity');
const end = src.indexOf("export type BattleScale");
if (start < 0 || end < 0) throw new Error('could not locate the script helpers in types.ts');
const tmp = new URL('./_script.slice.ts', import.meta.url);
writeFileSync(tmp, 'type Side = any;\ntype ScriptState = any;\ntype Opportunity = any;\ntype ExtraTick = any;\ntype Timing = any;\n' + src.slice(start, end));
const { normaliseScript, newScriptState } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const keys = Object.keys(newScriptState('blue')).sort();

console.log('Script state normalisation\n');

// Every shape must come back complete, because the round loop indexes these directly.
const shapes = {
  undefined: undefined,
  null: null,
  empty: {},
  'slice-1 save (no stage)': { turn: 'blue', acted: [], commanded: [], passed: [], mode: 'hotseat', seats: { blue: 'local', red: 'local' } },
  'slice-3 save (still carries the dropped step list)': { turn: 'blue', done: ['1:Command:0'], acted: [], commanded: [], passed: [], stage: '1:0', mode: 'hotseat', seats: { blue: 'local', red: 'local' } },
  garbage: { turn: 'purple', done: 'nope', acted: null, commanded: 7, passed: {}, stage: 42, mode: 'weird', seats: null },
};
for (const [name, raw] of Object.entries(shapes)) {
  const out = normaliseScript(raw, 'blue');
  check(`${name}: has every field`, Object.keys(out).sort(), keys);
  check(`${name}: stage is a string`, typeof out.stage, 'string');
  for (const arr of ['acted', 'commanded', 'passed']) {
    check(`${name}: ${arr} is an array`, Array.isArray(out[arr]), true);
  }
}

// Real values must survive rather than being reset, or a reload would lose the round.
const opp = { uid: 7, timing: 'firing', maneuver: 0, action: 1, extras: [], maneuvered: true, started: true, performed: ['a1'], spentExtras: [] };
const intercepts = [{ uid: 3, actionId: 'PRDR-101_C', targetUid: 9 }];
const live = { turn: 'red', acted: [7, 8], commanded: [9], passed: ['blue'], stage: '2:3', mode: 'hidden', seats: { blue: 'local', red: 'remote' }, opp, intercepts };
check('a complete script is preserved exactly', normaliseScript(live, 'blue'), live);
// A half-spent Action Opportunity has to survive a reload, or the Mech would get
// its Ticks back and could act twice.
check('a live opportunity keeps its spent ticks', normaliseScript(live, 'blue').opp, opp);
check('a script with no opportunity reads back null', normaliseScript({ ...live, opp: undefined }, 'blue').opp, null);
check('a junk opportunity is dropped rather than half-restored', normaliseScript({ ...live, opp: { nope: 1 } }, 'blue').opp, null);
// An Interception the rules oblige must survive a reload, or the chain is lost.
check('owed interceptions survive', normaliseScript(live, 'blue').intercepts, intercepts);
check('a missing list reads back empty', normaliseScript({ ...live, intercepts: undefined }, 'blue').intercepts, []);
check('half-formed entries are dropped', normaliseScript({ ...live, intercepts: [{ uid: 1 }, ...intercepts] }, 'blue').intercepts, intercepts);
// The tickable step list was dropped once the guide started driving each phase.
// A save that still carries it must load without it rather than resurrecting it.
check('the dropped step list is not carried forward', 'done' in normaliseScript(shapes['slice-3 save (still carries the dropped step list)'], 'blue'), false);
check('an empty stage means no phase has been entered', normaliseScript({}, 'blue').stage, '');

// Defaults follow the first player, since the loop opens with them.
check('turn defaults to the first player', normaliseScript({}, 'red').turn, 'red');
check('a bad turn falls back to the first player', normaliseScript({ turn: 'purple' }, 'red').turn, 'red');
check('an unknown mode falls back to hotseat', normaliseScript({ mode: 'weird' }, 'blue').mode, 'hotseat');
check('hidden mode is honoured', normaliseScript({ mode: 'hidden' }, 'blue').mode, 'hidden');
check('a partial seats map is filled in', normaliseScript({ seats: { blue: 'remote' } }, 'blue').seats, { blue: 'remote', red: 'local' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

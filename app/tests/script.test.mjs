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
// normaliseScript migrates old side ids through asSide, which lives above the
// slice, so it is pulled in from source rather than stubbed: a stub would let a
// broken migration pass.
const sideStart = src.indexOf('export const LEGACY_SIDE');
const sideEnd = src.indexOf('export type Stance');
if (sideStart < 0 || sideEnd < 0) throw new Error('could not locate the side helpers in types.ts');
writeFileSync(
  tmp,
  'type Side = any;\ntype ScriptState = any;\ntype Opportunity = any;\ntype ExtraTick = any;\ntype Timing = any;\n'
    + src.slice(sideStart, sideEnd) + src.slice(start, end),
);
const { normaliseScript, newScriptState } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const keys = Object.keys(newScriptState('s1')).sort();

console.log('Script state normalisation\n');

// Every shape must come back complete, because the round loop indexes these directly.
const shapes = {
  undefined: undefined,
  null: null,
  empty: {},
  'slice-1 save (no stage)': { turn: 's1', acted: [], commanded: [], passed: [], mode: 'hotseat', seats: { s1: 'local', s2: 'local' } },
  'slice-3 save (still carries the dropped step list)': { turn: 's1', done: ['1:Command:0'], acted: [], commanded: [], passed: [], stage: '1:0', mode: 'hotseat', seats: { s1: 'local', s2: 'local' } },
  garbage: { turn: 'purple', done: 'nope', acted: null, commanded: 7, passed: {}, stage: 42, mode: 'weird', seats: null },
};
for (const [name, raw] of Object.entries(shapes)) {
  const out = normaliseScript(raw, 's1');
  check(`${name}: has every field`, Object.keys(out).sort(), keys);
  check(`${name}: stage is a string`, typeof out.stage, 'string');
  for (const arr of ['acted', 'commanded', 'passed']) {
    check(`${name}: ${arr} is an array`, Array.isArray(out[arr]), true);
  }
}

// Real values must survive rather than being reset, or a reload would lose the round.
const opp = { uid: 7, timing: 'firing', maneuver: 0, action: 1, extras: [], maneuvered: true, moved: true, started: true, overload: 1, performed: ['a1'], spentExtras: [] };
// An interrupted opportunity waiting under a nested Extra one (FAQ K21) must
// survive a reload with its spent ticks and the extra flag intact.
const oppStack = [{ uid: 8, timing: 'melee', extra: true, maneuver: 1, action: 0, extras: [], maneuvered: false, moved: false, started: true, overload: 0, performed: ['a2'], spentExtras: [] }];
const intercepts = [{ uid: 3, actionId: 'PRDR-101_C', targetUid: 9 }];
// A defender's owed Emergency Smoke (FAQ B7). It lives in shared state because
// the ATTACKING client queues it and only the DEFENDER's may answer it, so a
// reload that dropped it would hand out a free reaction or lose one.
const reactions = [{ uid: 5, actionId: '546_B', count: 2, range: 1 }];
const endDone = ['2:end:remove', '2:end:tokens'];
// Abilities capped at once per round, keyed the same way so they prune together.
const oncePerRound = ['2:aster:7'];
// A rollback one seat has asked for and the other has not answered.
const rollback = { by: 's2', round: 2, phase: 2, label: 'Action Phase' };
// The points the host says it can return to, one of them sealed by a die roll.
const rollbackCatalog = [{ round: 1, phase: 0, available: true }, { round: 2, phase: 1, available: false }];
// A defence roll in the air: the Wild Cat shot at, 6 White owed, not yet rolled.
const combat = { attackerUid: 7, targetUid: 9, actionId: '032_A', white: 6, blue: 1, faces: null };
// The attacker's combat window as the defender's mirror draws it: mid-attack,
// part chosen, attack faces down, defence still owed.
const combatView = {
  attackerUid: 7, targetUid: 9, actionId: '032_A', mode: 'attack', step: 'defense',
  targetPart: 'rightHand', attack: [{ color: 'red', face: 2 }, { color: 'yellow', face: 0 }],
  defense: null, log: ['Black Die: rightArm.'],
  // Non-default on purpose, like everything else here: the Focus flow's place
  // must survive the trip or the defender's mirror asks at the wrong moment.
  focus: { stage: 'declareD', attackerUse: true, defenderUse: false },
};
// Every value here is deliberately NOT the default, so a field that
// normaliseScript forgets to carry across fails rather than coincidentally
// matching what it would have defaulted to.
const counter = { initiatorUid: 7, responderUid: 9, actionId: 'EWA', initRoll: [0, 3], respRoll: null, initFocused: true, respFocused: false };
const live = { turn: 's2', acted: [7, 8], extraOpps: [8], commanded: [9], freeCommand: [], passed: ['s1'], stage: '2:3', mode: 'hidden', strict: true, commits: { s1: 'deadbeef' }, revealed: ['s2'], seats: { s1: 'local', s2: 'remote' }, opp, oppStack, intercepts, reactions, counter, endDone, oncePerRound, rollback, rollbacks: 3, rollbackCatalog, combat, combatView };

// This fixture has lagged behind ScriptState four times now, each costing a
// confusing deep-equal diff. Naming the missing field turns that into an
// instruction, since the fixture must list every field the state has.
const missing = Object.keys(newScriptState('s1')).filter((k) => !(k in live));
check(`the fixture covers every ScriptState field${missing.length ? ` — add: ${missing.join(', ')}` : ''}`, missing, []);

check('a complete script is preserved exactly', normaliseScript(live, 's1'), live);
// A half-spent Action Opportunity has to survive a reload, or the Mech would get
// its Ticks back and could act twice.
check('a live opportunity keeps its spent ticks', normaliseScript(live, 's1').opp, opp);
check('a script with no opportunity reads back null', normaliseScript({ ...live, opp: undefined }, 's1').opp, null);
check('a junk opportunity is dropped rather than half-restored', normaliseScript({ ...live, opp: { nope: 1 } }, 's1').opp, null);
// An Interception the rules oblige must survive a reload, or the chain is lost.
check('owed interceptions survive', normaliseScript(live, 's1').intercepts, intercepts);
check('a missing list reads back empty', normaliseScript({ ...live, intercepts: undefined }, 's1').intercepts, []);
check('half-formed entries are dropped', normaliseScript({ ...live, intercepts: [{ uid: 1 }, ...intercepts] }, 's1').intercepts, intercepts);
// Same for an owed reaction: it is a debt one client raised and the other must
// pay, so losing it on a rejoin is a rule silently skipped.
check('owed reactions survive', normaliseScript(live, 's1').reactions, reactions);
check('a missing reaction list reads back empty', normaliseScript({ ...live, reactions: undefined }, 's1').reactions, []);
check('half-formed reactions are dropped', normaliseScript({ ...live, reactions: [{ uid: 1 }, ...reactions] }, 's1').reactions, reactions);
// A Counter-roll is a live two-player exchange, so a reload mid-roll must not
// lose whose dice are already down (4.11.2).
check('an open counter-roll survives', normaliseScript(live, 's1').counter, counter);
check('no counter-roll reads back null', normaliseScript({ ...live, counter: undefined }, 's1').counter, null);
check('a half-formed one is dropped rather than restored', normaliseScript({ ...live, counter: { initiatorUid: 1 } }, 's1').counter, null);
check('junk faces are filtered out of a roll',
  normaliseScript({ ...live, counter: { ...counter, initRoll: [0, 'x', 3] } }, 's1').counter.initRoll, [0, 3]);
// A half-finished End Phase has to survive a reload, since 3.7 fixes the order.
check('finished end steps survive', normaliseScript(live, 's1').endDone, endDone);
check('a missing end list reads back empty', normaliseScript({ ...live, endDone: undefined }, 's1').endDone, []);
check('non-string end steps are dropped', normaliseScript({ ...live, endDone: [1, ...endDone] }, 's1').endDone, endDone);
check('once-per-round uses survive', normaliseScript(live, 's1').oncePerRound, oncePerRound);
check('a missing once-per-round list reads back empty', normaliseScript({ ...live, oncePerRound: undefined }, 's1').oncePerRound, []);
check('non-string once-per-round keys are dropped', normaliseScript({ ...live, oncePerRound: [1, ...oncePerRound] }, 's1').oncePerRound, oncePerRound);
// The branch count is a tally of what has HAPPENED to the game, so it has to
// survive a reload — a client that reads it back as zero stamps a branch the
// others left behind, and everything it sends is dropped.
check('the branch count survives', normaliseScript(live, 's1').rollbacks, 3);
check('a missing count reads back zero', normaliseScript({ ...live, rollbacks: undefined }, 's1').rollbacks, 0);
check('a nonsense count reads back zero', normaliseScript({ ...live, rollbacks: -2 }, 's1').rollbacks, 0);
check('an owed defence survives a reload', normaliseScript(live, 's1').combat, combat);
check('a missing defence call reads back null', normaliseScript({ ...live, combat: undefined }, 's1').combat, null);
// Half a call is no call: a pool with no target is not a question anyone can
// answer, so it is dropped rather than shown as a roll button.
check('a call with no target is dropped', normaliseScript({ ...live, combat: { white: 6, blue: 0 } }, 's1').combat, null);
check('answered faces survive', normaliseScript({ ...live, combat: { ...combat, faces: [{ color: 'white', face: 2 }] } }, 's1').combat.faces, [{ color: 'white', face: 2 }]);
// The mirror is display state, but a reload mid-attack must not blank the
// defender's window — and junk in it must not be drawn as dice.
check('a published combat window survives', normaliseScript(live, 's1').combatView, combatView);
check('a missing window reads back null', normaliseScript({ ...live, combatView: undefined }, 's1').combatView, null);
check('a window with no attacker is dropped', normaliseScript({ ...live, combatView: { step: 'attack' } }, 's1').combatView, null);
check('junk faces are dropped from the window',
  normaliseScript({ ...live, combatView: { ...combatView, attack: [{ color: 'red', face: 2 }, { nope: 1 }] } }, 's1').combatView.attack, [{ color: 'red', face: 2 }]);
check('the published catalog survives', normaliseScript(live, 's1').rollbackCatalog, rollbackCatalog);
check('a missing catalog reads back empty', normaliseScript({ ...live, rollbackCatalog: undefined }, 's1').rollbackCatalog, []);
// Every entry is a button promising to return the board to a named moment, so
// a half-written one is dropped rather than offered.
check('an entry with no phase is dropped',
  normaliseScript({ ...live, rollbackCatalog: [{ round: 1 }, ...rollbackCatalog] }, 's1').rollbackCatalog, rollbackCatalog);
check('a pending rollback survives', normaliseScript(live, 's1').rollback, rollback);
check('no rollback reads back null', normaliseScript({ ...live, rollback: undefined }, 's1').rollback, null);
// Round and phase are what identify the target; without them there is nothing
// to roll back TO, so a half-written ask is dropped rather than half-trusted.
check('a rollback with no target is dropped', normaliseScript({ ...live, rollback: { by: 's1' } }, 's1').rollback, null);
// The tickable step list was dropped once the guide started driving each phase.
// A save that still carries it must load without it rather than resurrecting it.
check('the dropped step list is not carried forward', 'done' in normaliseScript(shapes['slice-3 save (still carries the dropped step list)'], 's1'), false);
check('an empty stage means no phase has been entered', normaliseScript({}, 's1').stage, '');

// Defaults follow the first player, since the loop opens with them.
check('turn defaults to the first player', normaliseScript({}, 's2').turn, 's2');
check('a bad turn falls back to the first player', normaliseScript({ turn: 'purple' }, 's2').turn, 's2');
check('an unknown mode falls back to hotseat', normaliseScript({ mode: 'weird' }, 's1').mode, 'hotseat');
check('hidden mode is honoured', normaliseScript({ mode: 'hidden' }, 's1').mode, 'hidden');
check('a partial seats map is filled in', normaliseScript({ seats: { s1: 'remote' } }, 's1').seats, { s1: 'remote', s2: 'local' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Checks the command layer: check() as the single home of a rule, apply() as a
// deterministic mutation, perform() as the warn-don't-block pairing. The tick
// rules are the real ticks.ts, not stubs, so a command cannot pass here while
// disagreeing with the engine.
import { readFileSync, writeFileSync } from 'node:fs';

const commands = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const ticks = readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const timings = types.slice(types.indexOf('export const TIMINGS'), types.indexOf('export type TokenShape'));
const tmp = new URL('./_commands.slice.ts', import.meta.url);
// tokenCards and maxLink are mirrored minimally rather than sliced from
// units.ts, whose import graph drags in the whole app. The mirrors only feed
// fixtures these tests control.
const stubs = `
export function tokenCards(data: any, t: any): any[] {
  if (t.kind === 'mech') {
    return Object.entries(t.mech ?? {}).map(([slot, id]) => ({ slot, card: data.byId.get(id) })).filter((x: any) => x.card);
  }
  return [{ slot: 'main', card: data.byId.get(t.cardId) }].filter((x: any) => x.card);
}
export function maxLink(data: any, t: any): number {
  const pilot = t.kind === 'mech' && t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
  return pilot?.LV ?? 99;
}
`;
writeFileSync(
  tmp,
  'type GameState = any;\ntype Side = any;\ntype Stance = any;\ntype Timing = any;\ntype TimingDef = any;\ntype Facing = any;\ntype GameData = any;\ntype CardAction = any;\ntype ExtraTick = any;\ntype Opportunity = any;\n'
    + timings
    + ticks.replace(/^import[^\n]*\n/gm, '')
    + stubs
    + commands.replace(/^import[^\n]*\n/gm, ''),
);
const C = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const mech = (uid, side, extra = {}) => ({
  uid, side, kind: 'mech', stance: 'offensive', label: `M${uid}`, col: 3, row: 3, facing: 0,
  mech: { torso: 'T1', pilot: 'P1' }, partStates: { torso: 'intact' }, ...extra,
});
const opp = (uid, over = {}) => ({
  uid, timing: 'firing', maneuver: 1, action: 2, extras: [], maneuvered: false,
  moved: false, started: false, overload: 0, performed: [], spentExtras: [], ...over,
});
const world = (tokens, phase = 1, o = null) => ({
  tokens,
  round: { n: 1, phase, firstPlayer: 's1' },
  script: { opp: o, acted: [], extraOpps: [], passed: [], turn: 's1' },
});
const fire = { id: 'A1', type: 'Firing', size: 's', name: { en: 'Shot' } };
const fireM = { id: 'A2', type: 'Firing', size: 'm', name: { en: 'Barrage' } };
const ovlAct = { id: '090_A', type: 'Passive', size: 'm', name: { en: 'Overload' } };
const data = {
  byId: new Map([
    ['T1', { id: 'T1', actions: [fire, fireM] }],
    ['T2', { id: 'T2', actions: [ovlAct] }],
    ['P1', { id: 'P1', LV: 4 }],
  ]),
  commonActions: [{ id: 'COMMON_CHARGE', type: 'Tactic', size: 's', name: { en: 'Charge' } }],
  overload: [{ actionId: '090_A', card: '090', label: 'Overload' }],
};

console.log('The command layer\n');

// ---------- shared gates ----------

const s0 = world([mech(1, 's1'), mech(2, 's2')]);
check('a missing unit is refused', C.check(data, s0, { kind: 'setTiming', seat: 's1', uid: 99, timing: 'firing' }).ok, false);
check('another squad\'s unit is refused for any command', C.check(data, s0, { kind: 'setTiming', seat: 's1', uid: 2, timing: 'firing' }).ok, false);

// ---------- setTiming ----------

const st = (over = {}) => ({ kind: 'setTiming', seat: 's1', uid: 1, timing: 'firing', ...over });
check('a legal dial set passes', C.check(data, s0, st()).ok, true);
check('clearing the dial is legal too', C.check(data, s0, st({ timing: undefined })).ok, true);
check('a made-up timing is refused', C.check(data, s0, st({ timing: 'sideways' })).ok, false);
check('outside the planning phase it is refused', C.check(data, world([mech(1, 's1')], 2), st()).ok, false);
check('check never mutates', (() => { const w = world([mech(1, 's1')]); C.check(data, w, st()); return w.tokens[0].timing; })(), undefined);
const w1 = world([mech(1, 's1')]);
C.apply(data, w1, st());
check('apply sets the dial', w1.tokens[0].timing, 'firing');

// ---------- setStance ----------

const sc = (over = {}) => ({ kind: 'setStance', seat: 's1', uid: 1, stance: 'defensive', ...over });
check('a legal stance change passes', C.check(data, s0, sc()).ok, true);
check('a drone has no stance choice', C.check(data, world([{ uid: 1, side: 's1', kind: 'drone', stance: 'defensive', label: 'D', partStates: {} }]), sc()).ok, false);
const shut = () => world([mech(1, 's1', { stance: 'shutdown' })]);
check('leaving shutdown needs a reboot', C.check(data, shut(), sc()).ok, false);
check('entering shutdown voluntarily is allowed', C.check(data, s0, sc({ stance: 'shutdown' })).ok, true);
const shut2 = shut();
const v2 = C.perform(data, shut2, sc({ stance: 'mobility' }));
check('perform overrules the shutdown rule and says why', [shut2.tokens[0].stance, v2.ok], ['mobility', false]);

// ---------- reboot ----------

const rb = (over = {}) => ({ kind: 'reboot', seat: 's1', uid: 1, stance: 'defensive', ...over });
check('an active mech cannot reboot', C.check(data, s0, rb()).ok, false);
check('a shutdown mech can', C.check(data, shut(), rb()).ok, true);
check('rebooting into shutdown is refused', C.check(data, shut(), rb({ stance: 'shutdown' })).ok, false);
const wr = world([mech(1, 's1', { stance: 'shutdown', link: 0 })], 2, opp(1));
C.apply(data, wr, rb());
check('reboot restores the stance', wr.tokens[0].stance, 'defensive');
check('reboot restores 1 link', wr.tokens[0].link, 1);
check('reboot leaves one action tick', [wr.script.opp.maneuver, wr.script.opp.action], [0, 1]);
check('and re-arms the starting action rule', wr.script.opp.started, false);
// Link never climbs past the pilot's Link Value.
const wcap = world([mech(1, 's1', { stance: 'shutdown', link: 4 })], 2, opp(1));
C.apply(data, wcap, rb());
check('link is capped at the pilot value', wcap.tokens[0].link, 4);

// ---------- maneuver ----------

const mv = (over = {}) => ({ kind: 'maneuver', seat: 's1', uid: 1, to: { col: 6, row: 3 }, facing: 1, ...over });
check('a maneuver needs the opportunity', C.check(data, world([mech(1, 's1')], 2), mv()).ok, false);
const wm = () => world([mech(1, 's1')], 2, opp(1));
check('with the opportunity it passes', C.check(data, wm(), mv()).ok, true);
check('off the board is refused', C.check(data, wm(), mv({ to: { col: 99, row: 3 } })).ok, false);
const wm2 = wm();
C.apply(data, wm2, mv());
check('apply moves the token', [wm2.tokens[0].col, wm2.tokens[0].row, wm2.tokens[0].facing], [6, 3, 1]);
check('and spends the maneuver tick', [wm2.script.opp.maneuver, wm2.script.opp.maneuvered, wm2.script.opp.moved], [0, true, true]);
check('a second maneuver is refused', C.check(data, wm2, mv()).ok, false);

// ---------- performAction ----------

const pa = (over = {}) => ({ kind: 'performAction', seat: 's1', uid: 1, actionId: 'A1', ...over });
check('an unknown action is refused', C.check(data, wm(), pa({ actionId: 'NOPE' })).ok, false);
check('a known action with ticks passes', C.check(data, wm(), pa()).ok, true);
check('a common action is found too', C.check(data, wm(), pa({ actionId: 'COMMON_CHARGE' })).ok, false);
const wp = wm();
C.apply(data, wp, pa());
check('apply spends one tick for a short', wp.script.opp.action, 1);
C.apply(data, wp, pa({ actionId: 'A2' }));
check('a medium after a short cannot pay', C.check(data, wp, pa({ actionId: 'A2' })).ok, false);
// The dial gate lives in the same check the engine uses.
const wwrong = world([mech(1, 's1')], 2, opp(1, { timing: 'melee' }));
check('the starting action must match the dial', C.check(data, wwrong, pa()).ok, false);

// ---------- overload ----------

const ov = (over = {}) => ({ kind: 'overload', seat: 's1', uid: 1, ...over });
check('no pack means no overload', C.check(data, wm(), ov()).ok, false);
const packMech = (link) => mech(1, 's1', { mech: { torso: 'T2', pilot: 'P1' }, link });
const wo = (link) => world([packMech(link)], 2, opp(1));
check('with the pack and link it passes', C.check(data, wo(3), ov()).ok, true);
check('with no link it is refused', C.check(data, wo(0), ov()).ok, false);
const wov = wo(3);
C.apply(data, wov, ov());
check('overload trades 1 link for 1 tick', [wov.tokens[0].link, wov.script.opp.action, wov.script.opp.overload], [2, 3, 1]);
C.apply(data, wov, ov());
check('a third overload is refused', C.check(data, wov, ov()).ok, false);
// Spending the last link shuts the mech down inside the same command.
const wlast = wo(1);
C.apply(data, wlast, ov());
check('the last link shuts the mech down', wlast.tokens[0].stance, 'shutdown');

// ---------- determinism ----------

const a = wm();
const b = wm();
C.apply(data, a, mv());
C.apply(data, b, mv());
check('apply is deterministic across copies', JSON.stringify(a.script.opp), JSON.stringify(b.script.opp));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

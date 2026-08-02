// Checks the command layer: check() as the single home of a rule, apply() as a
// deterministic mutation, perform() as the warn-don't-block pairing. The tick
// rules are the real ticks.ts, not stubs, so a command cannot pass here while
// disagreeing with the engine.
import { readFileSync, writeFileSync } from 'node:fs';

const commands = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const ticks = readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const setupSrc = readFileSync(new URL('../src/setup.ts', import.meta.url), 'utf8');
const tacticsSrc = readFileSync(new URL('../src/tactics.ts', import.meta.url), 'utf8');
const tasksSrc = readFileSync(new URL('../src/tasks.ts', import.meta.url), 'utf8');
const timings = types.slice(types.indexOf('export const PHASES'), types.indexOf('export type TokenShape'));
const statuses = types.slice(types.indexOf('export function hexagonIds'), types.indexOf('export interface RoundState'));
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
  'type GameState = any;\ntype Side = any;\ntype Stance = any;\ntype Timing = any;\ntype TimingDef = any;\ntype Facing = any;\ntype GameData = any;\ntype CardAction = any;\ntype ExtraTick = any;\ntype Opportunity = any;\ntype Token = any;\ntype StatusDef = any;\ntype PartSlot = any;\ntype PartState = any;\n'
    + timings
    + statuses
    + setupSrc.replace(/^import[^\n]*\n/gm, '')
    + tacticsSrc.replace(/^import[^\n]*\n/gm, '')
    + tasksSrc.replace(/^import[^\n]*\n/gm, '')
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
  script: { opp: o, acted: [], extraOpps: [], commanded: [], freeCommand: [], passed: [], turn: 's1' },
});
const fire = { id: 'A1', type: 'Firing', size: 's', name: { en: 'Shot' } };
const fireM = { id: 'A2', type: 'Firing', size: 'm', name: { en: 'Barrage' } };
const ovlAct = { id: '090_A', type: 'Passive', size: 'm', name: { en: 'Overload' } };
const data = {
  byId: new Map([
    ['T1', { id: 'T1', actions: [fire, fireM] }],
    ['T2', { id: 'T2', actions: [ovlAct] }],
    ['T3', { id: 'T3', structure: 2, actions: [] }],
    ['T4', { id: 'T4', actions: [{ id: 'L1', type: 'Projectile', size: 'm', name: { en: 'Launcher' }, storage: 3 }] }],
    ['D1', { id: 'D1', actions: [] }],
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

// ---------- playTactic ----------

const drone = (uid, side, over = {}) => ({
  uid, side, kind: 'drone', stance: 'defensive', label: `D${uid}`, col: 9, row: 9, facing: 0,
  cardId: 'D1', partStates: { main: 'intact' }, ...over,
});
const hand = (tokens, phase, cards) => {
  const w = world(tokens, phase);
  w.tactics = { s1: cards, s2: [] };
  return w;
};
const pt = (over = {}) => ({ kind: 'playTactic', seat: 's1', uid: 1, cardId: '275', ...over });

check('a card not in hand is refused', C.check(data, hand([mech(1, 's1')], 5, []), pt()).ok, false);
const wt = hand([mech(1, 's1')], 5, ['275']);
check('in hand and in phase it passes', C.check(data, wt, pt()).ok, true);
const wt2 = hand([mech(1, 's1')], 5, ['275']);
wt2.tacticsPlayed = { s1: ['1:274'], s2: [] };
check('a second card in one round is refused (5.4.2)', C.check(data, wt2, pt()).ok, false);
check('the wrong phase is refused during a game', C.check(data, hand([mech(1, 's1')], 2, ['275']), pt()).ok, false);
const wfree = hand([mech(1, 's1')], 2, ['275']);
wfree.script = null;
check('outside a guided game the phase is free', C.check(data, wfree, pt()).ok, true);
check('an ineligible target is refused', C.check(data, hand([mech(1, 's1', { stance: 'shutdown' })], 5, ['275']), pt()).ok, false);
const wpick = hand([mech(1, 's1', { statuses: ['fci', 'fci'] })], 2, ['277']);
check('a choice card without a pick is refused', C.check(data, wpick, pt({ cardId: '277' })).ok, false);
check('a made-up pick is refused', C.check(data, wpick, pt({ cardId: '277', pick: 'nope' })).ok, false);
check('a real pick passes', C.check(data, wpick, pt({ cardId: '277', pick: 'fci' })).ok, true);
C.apply(data, wpick, pt({ cardId: '277', pick: 'fci' }));
check('System Repair removes exactly one token', wpick.tokens[0].statuses, ['fci']);
check('and stamps the round it was played in', wpick.tacticsPlayed.s1, ['1:277']);
check('and writes the card log into the token', wpick.tokens[0].log?.length, 1);
C.apply(data, wt, pt());
check('Battlefield Recovery restores 1 Link', wt.tokens[0].link, 1);
const wdr = hand([drone(1, 's1')], 0, ['274']);
wdr.script.commanded = [1];
C.apply(data, wdr, pt({ cardId: '274' }));
check('Additional Instructions frees the Command Action', [wdr.script.commanded, wdr.script.freeCommand], [[], [1]]);

// ---------- deployUnit ----------

const dep = (over = {}) => ({ kind: 'deployUnit', seat: 's1', uid: 1, to: { col: 4, row: 33 }, stance: 'mobility', camo: false, ...over });
const depWorld = () => {
  const w = world([mech(1, 's1', { deployed: false }), mech(2, 's2', { deployed: false }), mech(3, 's1', { deployed: false })], 0);
  w.setup = { stage: 'deploy', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } };
  return w;
};

check('an already-deployed unit is refused', C.check(data, world([mech(1, 's1')]), dep()).ok, false);
const wnodep = depWorld();
wnodep.setup.stage = 'roll';
check('placement outside the deploy stage is refused', C.check(data, wnodep, dep()).ok, false);
check('the First Player places first', C.check(data, depWorld(), dep()).ok, true);
check('the other squad must wait its turn', C.check(data, depWorld(), dep({ seat: 's2', uid: 2 })).ok, false);
const wdep = depWorld();
C.apply(data, wdep, dep({ camo: true }));
check('apply lands the unit', [wdep.tokens[0].col, wdep.tokens[0].row, wdep.tokens[0].facing, wdep.tokens[0].deployed], [4, 33, 2, true]);
check('with the chosen stance and camouflage', [wdep.tokens[0].stance, wdep.tokens[0].statuses], ['mobility', ['camouflage']]);
check('and counts the placement', wdep.setup.placed.s1, 1);
check('then the turn alternates', C.check(data, wdep, dep({ uid: 3 })).ok, false);

// ---------- applyPenetration ----------

const pen = (over = {}) => ({ kind: 'applyPenetration', seat: 's1', uid: 1, targetUid: 2, slot: 'torso', ...over });
const duel = (defOver = {}) => world([
  mech(1, 's1'),
  mech(2, 's2', { mech: { torso: 'T3', pilot: 'P1' }, link: 2, ...defOver }),
]);

check('a missing target is refused', C.check(data, duel(), pen({ targetUid: 9 })).ok, false);
check('a slot the target does not have is refused', C.check(data, duel(), pen({ slot: 'backpack' })).ok, false);
check('a destroyed Part cannot be hit again', C.check(data, duel({ partStates: { torso: 'destroyed' } }), pen()).ok, false);
const wpen = duel();
C.apply(data, wpen, pen());
check('an intact Part with Structure goes damaged', [wpen.tokens[1].partStates.torso, wpen.tokens[1].link], ['damaged', 2]);
C.apply(data, wpen, pen());
check('a damaged Part goes destroyed and costs 1 Link', [wpen.tokens[1].partStates.torso, wpen.tokens[1].link], ['destroyed', 1]);
const wlink = duel({ link: 1, partStates: { torso: 'damaged' } });
C.apply(data, wlink, pen());
check('the last Link shuts the Mech down', [wlink.tokens[1].link, wlink.tokens[1].stance], [0, 'shutdown']);
const wdrone = world([mech(1, 's1'), drone(2, 's2')]);
C.apply(data, wdrone, pen({ slot: 'main' }));
check('a Part with no Structure is destroyed outright', wdrone.tokens[1].partStates.main, 'destroyed');

// ---------- applyStatus ----------

const st2 = (over = {}) => ({ kind: 'applyStatus', seat: 's1', uid: 1, targetUid: 2, statusId: 'fci', ...over });
check('a status for a missing target is refused', C.check(data, duel(), st2({ targetUid: 9 })).ok, false);
check('a made-up status is refused', C.check(data, duel(), st2({ statusId: 'confetti' })).ok, false);
const wst = duel();
C.apply(data, wst, st2({ stacks: 2 }));
check('apply stacks the token', wst.tokens[1].statuses, ['fci', 'fci']);

// ---------- focus ----------

const fc = (over = {}) => ({ kind: 'focus', seat: 's1', uid: 1, ...over });
check('Focus needs a Link to spend', C.check(data, world([mech(1, 's1', { link: 0 })]), fc()).ok, false);
const wf = world([mech(1, 's1', { link: 2 })]);
check('with Link in hand it passes', C.check(data, wf, fc()).ok, true);
C.apply(data, wf, fc());
check('Focus spends exactly 1 Link', wf.tokens[0].link, 1);
C.apply(data, wf, fc());
check('and the last one shuts the Mech down', [wf.tokens[0].link, wf.tokens[0].stance], [0, 'shutdown']);

// ---------- forceMove ----------

const fm = (over = {}) => ({ kind: 'forceMove', seat: 's1', uid: 1, targetUid: 2, to: { col: 12, row: 9 }, ...over });
check('a force-move of a missing target is refused', C.check(data, duel(), fm({ targetUid: 9 })).ok, false);
check('off the board is refused', C.check(data, duel(), fm({ to: { col: 99, row: 9 } })).ok, false);
const wfm = duel();
C.apply(data, wfm, fm());
check('the victim is moved', [wfm.tokens[1].col, wfm.tokens[1].row], [12, 9]);
check('knockback alone costs no Link', wfm.tokens[1].link, 2);
const wpush = duel();
C.apply(data, wpush, fm({ push: true }));
check('Push costs the victim 1 Link', wpush.tokens[1].link, 1);
const wpush2 = duel({ link: 1 });
C.apply(data, wpush2, fm({ push: true }));
check('and the last Link shuts it down', [wpush2.tokens[1].link, wpush2.tokens[1].stance], [0, 'shutdown']);
const wpushd = world([mech(1, 's1'), drone(2, 's2')]);
C.apply(data, wpushd, fm({ push: true }));
check('Push never touches a Drone\'s Link', wpushd.tokens[1].link, undefined);
// The actor may be spent scenery: a grenade's Knockback lands after the
// projectile has left the board.
check('a departed actor may still force the move', C.check(data, duel(), fm({ uid: 99 })).ok, true);
const wgone = duel();
C.apply(data, wgone, fm({ uid: 99, push: true }));
check('and its apply still lands', [wgone.tokens[1].col, wgone.tokens[1].link], [12, 1]);

// ---------- spendAmmo / restoreAmmo ----------

const ammoMech = (ammo) => mech(1, 's1', { mech: { torso: 'T4', pilot: 'P1' }, ammo });
const sa = (over = {}) => ({ kind: 'spendAmmo', seat: 's1', uid: 1, actionId: 'L1', ...over });
const ra = (over = {}) => ({ kind: 'restoreAmmo', seat: 's1', uid: 1, actionId: 'L1', ...over });
check('an untracked Action is refused', C.check(data, world([ammoMech({})]), sa()).ok, false);
const wam = world([ammoMech({ L1: 2 })]);
check('with Ammo in store it passes', C.check(data, wam, sa()).ok, true);
C.apply(data, wam, sa());
check('spend takes one', wam.tokens[0].ammo.L1, 1);
C.apply(data, wam, sa());
check('empty is refused', C.check(data, wam, sa()).ok, false);
C.apply(data, wam, sa());
check('and apply never goes below zero', wam.tokens[0].ammo.L1, 0);
C.apply(data, wam, ra({ amount: 5 }));
check('restore caps at the printed Storage', wam.tokens[0].ammo.L1, 3);
check('full is refused', C.check(data, wam, ra()).ok, false);

// ---------- recordKill ----------

const rk = (over = {}) => ({ kind: 'recordKill', seat: 's1', uid: 1, targetUid: 2, what: 'unit', ...over });
check('a kill needs the victim on the board', C.check(data, duel(), rk({ targetUid: 9 })).ok, false);
const wk = duel();
C.apply(data, wk, rk({ what: 'part' }));
check('a destroyed enemy Part is tallied', wk.tasks.kills.s1.partsAndDrones, 1);
check('and the Mech stays on the board', wk.tokens.length, 2);
C.apply(data, wk, rk());
check('a destroyed Unit is tallied and removed', [wk.tasks.kills.s1.mechs, wk.tokens.length], [1, 1]);
const wlow = world([mech(1, 's1'), drone(2, 's2')]);
C.apply(data, wlow, rk());
check('a Low Value Drone is removed but never scores', [wlow.tasks.kills.s1.drones, wlow.tokens.length], [0, 1]);
const wown = world([mech(1, 's1'), mech(2, 's1')]);
C.apply(data, wown, rk());
check('friendly fire removes but never scores', [wown.tasks.kills.s1.mechs, wown.tokens.length], [0, 1]);

// ---------- destroyTerrain ----------

const dt = (over = {}) => ({ kind: 'destroyTerrain', seat: 's1', uid: 1, pieces: ['w1'], ...over });
const wter = world([mech(1, 's1')]);
check('destroying nothing is refused', C.check(data, wter, dt({ pieces: [] })).ok, false);
C.apply(data, wter, dt({ pieces: ['w1', 'w2'] }));
check('destroyed terrain is recorded', wter.removedTerrain, ['w1', 'w2']);
check('destroying it again is refused', C.check(data, wter, dt()).ok, false);
C.apply(data, wter, dt({ pieces: ['w1', 'w3'] }));
check('and re-recording dedupes', wter.removedTerrain, ['w1', 'w2', 'w3']);

// ---------- determinism ----------

const a = wm();
const b = wm();
C.apply(data, a, mv());
C.apply(data, b, mv());
check('apply is deterministic across copies', JSON.stringify(a.script.opp), JSON.stringify(b.script.opp));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

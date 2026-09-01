// The End Phase Award, and the one thing that must never happen to it: a
// refused Award followed by the step mark.
//
// THE DEFECT THIS FILE EXISTS FOR. `award` and `markEndStep step='tasks'` both
// write `${round}:end:tasks`, and the Match Centre reads that key to stop a
// second press. So a call site that sent the Award, ignored the CheckResult and
// then sent the mark anyway ticked the round off as settled while nothing had
// been paid — the round's Victory Points were gone for BOTH squads, with no
// retry and no message. It shipped that way.
//
// Driven against the real card database and the real zone overlay, because the
// Award's apply settles Zone control (5.3.2) as part of the same reading of the
// board, and a fixture board would not exercise it.
import { readFileSync, writeFileSync } from 'node:fs';

// ---------- the slice: the real command layer, plus the HUD's End Phase glue ----------
const commands = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const ticks = readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const setupSrc = readFileSync(new URL('../src/setup.ts', import.meta.url), 'utf8');
const tacticsSrc = readFileSync(new URL('../src/tactics.ts', import.meta.url), 'utf8');
const tasksSrc = readFileSync(new URL('../src/tasks.ts', import.meta.url), 'utf8');
const loopSrc = readFileSync(new URL('../src/loop.ts', import.meta.url), 'utf8');
const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/playguide.ts', import.meta.url), 'utf8');

const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  return s.slice(i, j);
};

// Four cuts out of types.ts and they are disjoint today: asSide 105-112,
// PHASES 185-196, the status table 239-415, the script helpers 479-850. Checked
// before adding, because a range that overlaps another declares the same
// function twice — the trap that has bitten this suite five times.
const sides = cut(types, 'export const LEGACY_SIDE', 'export type Stance', 'asSide');
const timings = cut(types, 'export const PHASES', 'export type TokenShape', 'PHASES');
const statuses = cut(types, 'export function hexagonIds', 'export interface RoundState', 'the status table');
const scriptState = cut(types, 'export function newOpportunity', 'export type BattleScale', 'the script helpers');
const smokeRules = cut(rules, 'export function smokeKey', 'export function smokeBlocks', 'smokeKey');
const commandGen = cut(unitsSrc, '// ---------- Commands (rulebook 3.2.1) ----------', '// ---------- Charge (rulebook 4.14) ----------', 'Command Generation');
// The phase-7 pilot predicates, which commands.ts asks inside applyPenetration,
// advancePhase, focus and restoreLink — and advancePhase's round rollover is
// exactly what this file drives. Sliced rather than mirrored, and starting
// AFTER pilotCard/maxLink so the stubs below are not shadowed. Overlap-checked
// against every other cut here: the nearest is Command Generation, which ends
// far above it.
const pilotTraits = cut(unitsSrc, '// ---------- Pilot traits (phase 7) ----------', '// A Mech Maneuvers at the Maneuver Value', 'the phase-7 pilot predicates');
// Two cuts out of matchhud.ts, also disjoint: ensureScript 124-129 and
// settleEndStep, which sits immediately above the wiring section at the bottom.
const ensureScript = cut(hud, 'export function ensureScript', 'export function enterPhase', 'ensureScript');
const settleStep = cut(hud, 'export function settleEndStep', '// ---------- wiring ----------', 'settleEndStep');

// tokenCards and the token factories are mirrored rather than sliced: units.ts
// drags the whole app in behind it, and these mirrors still read the REAL card
// database, so a Mech built here carries the printed Parts.
const stubs = `
type HudCtx = any;
export function riderOnDrone(_data: any, _tokens: any, _t: any): any {
  return { autoActions: false, preMove: 0 };
}
// apply() sweeps the Tether chips after every command. Nothing in these
// fixtures carries a Harpoon, so the honest stub is a no-op; the removal
// conditions themselves are pinned in tether.test.mjs against the real card.
export function settleTethers(_data: any, _state: any): void {}
export function settleEnvironments(_data: any, _state: any): any[] { return []; }
export function cutTethersOn(_data: any, _state: any, _t: any, _role: any): void {}
export function tetherCap(_t: any, _tokens: any[]): any { return undefined; }
export function tetherTo(_a: any, _b: any, _range: number): void {}
export function transformPartOn(_data: any, _t: any, _slot: any, _cardId: string): void {}
export function transformFaces(_data: any, _c: any): string[] { return []; }
export function hasFlexibleTiming(_data: any, _tokens: any, _t: any): boolean {
  return false;
}
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
export function pilotCard(data: any, t: any): any {
  return t.kind === 'mech' && t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
}
export function repeatersFor(_data: any, _tokens: any[], _t: any): any[] { return []; }
export function electronicOrigins(_data: any, _tokens: any[], t: any): any[] { return [t]; }
export function loanedParts(_data: any, _tokens: any[], _t: any): any[] { return []; }
export function extrasFor(_data: any, _t: any): any[] { return []; }
export function makeDroneToken(state: any, data: any, card: any, side: any, backpack?: string): any {
  return {
    uid: state.nextUid++, side, kind: card.category === 'projectile' ? 'projectile' : 'drone',
    cardId: card.id, droneBackpack: backpack, label: card.id, size: 1, aerial: false, stance: 'offensive',
    partStates: { main: 'intact', ...(backpack ? { backpack: 'intact' } : {}) }, ammo: {},
  };
}
export function makeMechToken(state: any, data: any, loadout: any, side: any, name?: string): any {
  const partStates: any = {};
  for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack']) {
    if (loadout[slot]) partStates[slot] = 'intact';
  }
  const pilot = loadout.pilot ? data.byId.get(loadout.pilot) : undefined;
  return {
    uid: state.nextUid++, side, kind: 'mech', cardId: loadout.torso ?? '', mech: loadout,
    label: name ?? 'Mech', size: 3, aerial: false, stance: 'offensive',
    link: pilot?.LV ?? 3, partStates, ammo: {},
  };
}
// dissipationFor needs NO stub: it already sits inside the smokeKey cut above,
// and adding one declares it twice. Checked, because that is the trap.
// scorePreview is a READER: what the board owes each squad. Its arithmetic
// belongs to tasks.test.mjs, and settleEndStep only has to do the right thing
// with the answer — so the answer is handed in here, which is also the only way
// to get the refused one that made the defect. Mutable object rather than a
// reassignable binding, because an ES module export cannot be written from
// outside.
export const scoreStub: { result: any } = { result: { lines: [], s1: 0, s2: 0 } };
export function scorePreview(_ctx: any, _finalRound: boolean): any { return scoreStub.result; }
// Grace Note measures a distance, so the pilot block wants the Large-Grid sum.
// Nothing here is about range; the real Manhattan arithmetic is enough.
export function largeGridOf(t: any): any { return { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }; }
export function rangeBetween(a: any, b: any): any {
  const ga = largeGridOf(a), gb = largeGridOf(b);
  const dc = Math.abs(ga.c - gb.c), dr = Math.abs(ga.r - gb.r);
  return { range: dc + dr, adjacent: dc <= 1 && dr <= 1, sameGrid: dc === 0 && dr === 0 };
}
`;

const tmp = new URL('./_endaward.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type GameState = any;\ntype Side = any;\ntype Stance = any;\ntype Timing = any;\ntype TimingDef = any;\ntype Facing = any;\ntype GameData = any;\ntype CardAction = any;\ntype ExtraTick = any;\ntype Opportunity = any;\ntype Token = any;\ntype StatusDef = any;\ntype PartSlot = any;\ntype PartState = any;\n'
    + sides
    + timings
    + statuses
    + scriptState
    + setupSrc.replace(/^import[^\n]*\n/gm, '')
    + tacticsSrc.replace(/^import[^\n]*\n/gm, '')
    + tasksSrc.replace(/^import[^\n]*\n/gm, '')
    + loopSrc.replace(/^import[^\n]*\n/gm, '')
    + smokeRules
    + ticks.replace(/^import[^\n]*\n/gm, '')
    + commandGen
    + stubs
    + pilotTraits
    + commands.replace(/^import[^\n]*\n/gm, '')
    + ensureScript
    + settleStep,
);
const C = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('End Phase Award\n');

// ---------- the real database and the real zone overlay ----------
const repo = new URL('../../', import.meta.url);
const loadJson = (p) => JSON.parse(readFileSync(new URL(p, repo), 'utf8'));
const cards = loadJson('data/cards.json');
const byId = new Map(cards.map((c) => [c.id, c]));
const zoneData = { zones: loadJson('data/zones.json').zones ?? [] };
const data = { byId, commonActions: [], overload: [], zoneData };

// Bravo is B6/C6/B7/C7 on the printed board, so a base standing in Large Grid
// (1,5) is inside it. Real Parts and a real pilot, so lowValueUnit and the
// fielded roster read the shipped cards rather than a fixture.
const ZONE = 'bravo';
const bravo = zoneData.zones.find((z) => z.id === ZONE);
check('the real zone overlay still has Bravo', !!bravo?.cells?.length, true);
const torso = cards.find((c) => c.type === 'torso');
const pilot = cards.find((c) => c.category === 'pilot' && typeof c.LV === 'number');
check('the real database still has a Torso and a pilot to build with', !!torso && !!pilot, true);

const holder = () => ({
  uid: 1, side: 's1', kind: 'mech', label: 'Holder', col: 4, row: 16, facing: 0, size: 3,
  stance: 'offensive', deployed: true, link: pilot.LV,
  cardId: torso.id, mech: { torso: torso.id, pilot: pilot.id }, partStates: { torso: 'intact' }, ammo: {},
});

// Round 2, End Phase, one Control Zone item and one Mech standing in it.
const board = () => ({
  nextUid: 9,
  round: { n: 2, phase: C.PHASES.length - 1, firstPlayer: 's1' },
  roundLimit: 5,
  tokens: [holder()],
  tasks: { items: [{ id: 'ctl-bravo', kind: 'control', zone: ZONE }], vp: { s1: 0, s2: 0 }, scored: [], secondary: {} },
  script: { ...C.newScriptState('s1'), strict: true },
});

// A room is always strict, whatever the guide is set to, so the seat is held
// for the whole file: this is the Match Centre's command path, not freeplay's.
C.setLocalSeat('s1');

// ---------- the asymmetry that made the defect possible ----------
//
// check() is the authoritative reader, and it judges these two commands
// DIFFERENTLY: the Award weighs the numbers, the step mark never looks at them.
// That gap is exactly what a call site which ignores the Award's verdict falls
// into, so it is pinned rather than assumed.
// The refusable fixture used to be a NEGATIVE award. It is not one any more:
// cards 300 and 500 print "-1 Victory Point if this Part is destroyed", so a
// negative delta is a real score now and the total floors at zero instead
// (vprider.test.mjs owns that half). A fraction is still not a score, and it is
// what this file needs — something check() genuinely refuses, so the ordering
// defect below can be reproduced at all.
const stA = board();
check('check() refuses an Award that is not a score',
  C.check(data, stA, { kind: 'award', seat: 's1', vp: { s1: 1.5, s2: 0 }, keys: [] }).ok, false);
check('and the reason is one a player can read',
  C.check(data, stA, { kind: 'award', seat: 's1', vp: { s1: 1.5, s2: 0 }, keys: [] }).why, 'That is not a score.');
check('while a negative one is now allowed through',
  C.check(data, stA, { kind: 'award', seat: 's1', vp: { s1: -2, s2: 0 }, keys: [] }).ok, true);
check('but the step mark passes regardless of what the round was worth',
  C.check(data, stA, { kind: 'markEndStep', seat: 's1', step: 'tasks' }).ok, true);

// And both of them tick the SAME key, which is why the mark can hide a refusal.
const stKeyA = board();
C.apply(data, stKeyA, { kind: 'award', seat: 's1', vp: { s1: 1, s2: 0 }, keys: [] });
const stKeyB = board();
C.apply(data, stKeyB, { kind: 'markEndStep', seat: 's1', step: 'tasks' });
check('the Award and the step mark write the same checklist key',
  [stKeyA.script.endDone, stKeyB.script.endDone], [['2:end:tasks'], ['2:end:tasks']]);

// ---------- driving the HUD's End Phase step ----------
//
// The Match Centre's send() in miniature: one door, the real perform() behind
// it, and a record of everything that went through so the ORDER can be read.
const makeCtx = (state) => ({
  data, state, seat: 's1', networked: true, zonesOn: false,
  sent: [], notes: [], refreshes: 0,
  send(cmd) { this.sent.push(cmd); return C.perform(data, state, cmd); },
  noteNow(text) { this.notes.push(text); },
  refresh() { this.refreshes += 1; },
});

// THE REGRESSION. The board owes a score the command layer will refuse.
const st = board();
const ctx = makeCtx(st);
C.scoreStub.result = { lines: [{ side: 's1', vp: 1.5, why: 'a score the command layer cannot take', key: '2:main' }], s1: 1.5, s2: 0 };
C.settleEndStep(ctx, 's1', 'tasks');
check('a refused Award is NOT followed by the step mark', ctx.sent.map((c) => c.kind), ['award']);
check('so the End Phase checklist stays open', st.script.endDone, []);
check('and neither squad has been paid', C.normaliseTasks(st.tasks).vp, { s1: 0, s2: 0 });
check('the player is told, in the panel, that nothing was settled', ctx.notes.length, 1);
// Defensive read: with the bug back in, there is no note at all, and this file
// has to report that as a failure rather than throw over it and hide the rest.
const said = ctx.notes[0] ?? '';
check('and the note carries the refusal reason and the retry',
  [said.includes('That is not a score.'), /press Settle Task control again/.test(said)],
  [true, true]);
// The step being open is only worth anything if the button is still live: the
// panel disables the row off this same key, so an empty list IS the retry path.
check('nothing marks the round settled behind the refusal',
  st.script.endDone.includes('2:end:tasks'), false);

// ---------- and it is genuinely retryable ----------
C.scoreStub.result = { lines: [{ side: 's1', vp: 2, why: '1 controlled Zone at 2 VP each', key: '2:main' }], s1: 2, s2: 0 };
C.settleEndStep(ctx, 's1', 'tasks');
check('pressing again once the score is sound pays it', C.normaliseTasks(st.tasks).vp, { s1: 2, s2: 0 });
check('and settles the step', st.script.endDone, ['2:end:tasks']);
check('the line is recorded as paid', C.normaliseTasks(st.tasks).scored, ['2:main']);
// The Award judges control as part of the same reading of the board that scores
// it (5.3.2) — real zone cells, real Mech, real settleControl.
check('the Award settled Zone control off the real board',
  C.normaliseTasks(st.tasks).items[0].control, 's1');
check('the whole press went through as award then mark', ctx.sent.map((c) => c.kind), ['award', 'award', 'markEndStep']);

// The retry must not have become a second payday. Both players can see this
// button, so the guard that stops a double award has to survive the fix.
C.scoreStub.result = { lines: [{ side: 's1', vp: 2, why: '1 controlled Zone at 2 VP each', key: '2:main' }], s1: 2, s2: 0 };
C.settleEndStep(ctx, 's1', 'tasks');
check('a settled round cannot be awarded twice', C.normaliseTasks(st.tasks).vp, { s1: 2, s2: 0 });
check('and the extra press sends only the idempotent mark',
  ctx.sent.slice(3).map((c) => c.kind), ['markEndStep']);

// A round with nothing to score still closes: no Award is owed, so no Award can
// be refused, and the step must not be left hanging.
const stNil = board();
const ctxNil = makeCtx(stNil);
C.scoreStub.result = { lines: [], s1: 0, s2: 0 };
C.settleEndStep(ctxNil, 's1', 'tasks');
check('a round that scores nothing still ticks the step', stNil.script.endDone, ['2:end:tasks']);
check('and sends no Award at all', ctxNil.sent.map((c) => c.kind), ['markEndStep']);

C.setLocalSeat(null);

// ---------- the other two readers ----------
//
// One rule, three readers: commands.ts is pinned above by driving it. The HUD's
// button must go through the same function this file drives rather than a
// second inlined copy of the sequence, and freeplay has to honour the verdict
// too or the same press behaves differently on the two pages.
check('the HUD button goes through settleEndStep',
  /on\('\[data-endstep\]', \(el\) => settleEndStep\(ctx, me\(\), el\.dataset\.endstep!\)\);/.test(hud), true);
// Two, and only two: the End Phase step above, and the manual +1 button a local
// game keeps because there the players are the referee. A third would be a
// second copy of the sequence, which is how the readers drift apart.
check('the HUD sends an Award from exactly those two places',
  hud.split("kind: 'award'").length - 1, 2);

const awardFn = cut(guide, 'private awardScore()', '// Stabilize System (6.1)', "the guide's awardScore");
check('freeplay reads the Award verdict', /const paid = perform\(/.test(awardFn), true);
check('and turns a refusal into something the player sees', /this\.warn = paid\.ok/.test(awardFn), true);
check('and reads whether the round is still open off the checklist, not the verdict',
  /endDone\.includes\(`\$\{s\.round\.n\}:end:tasks`\)/.test(awardFn), true);
const endFn = cut(guide, 'private endHtml(s: GameState)', '// ---------- pre-game setup', "the guide's End Phase panel");
check('and the End Phase panel has somewhere to draw it',
  /this\.warn \? `<p class="pg-warn">/.test(endFn), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

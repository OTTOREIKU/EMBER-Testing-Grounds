// The freeplay BOARD's half of rulebook 4.12.3 (book p.73): "Performing any
// Action that does not have the Silence Keyword causes Units in the Optical
// Camouflage State to be Revealed AND Low Profile Tokens to be removed."
//
// The command layer owns the rule — commands.ts shedLowProfile, on the apply of
// `maneuver` and `performAction`, driven by commands.test.mjs. This file covers
// the ONE surface that does not reach those commands down every path.
//
// WHY main.ts NEEDS ITS OWN SITES AT ALL, since the command has the rule:
//   * playguide's tryManeuver sends `maneuver`, but two of the three callers of
//     startMove send nothing — the Tactics-card-granted Maneuver, and the
//     designation-stage move. settle() is where all three meet.
//   * playguide's Mech action row sends `performAction`, but its DRONE row
//     (performUnitAction, every Command-Phase and Automatic-Phase action) only
//     designates. performGuided is where both meet.
// The Match Centre needs neither: matchhud sends `maneuver` for a walk, a drag
// and a pivot, and `performAction` for a Mech's Action and a Drone's activation
// alike, so it inherits the rule whole.
//
// HOW THIS IS DRIVEN, and what it is honest about. main.ts is a single 6000-line
// `async function init()` closure over the live DOM, so it cannot be imported in
// node. Both edited blocks are SLICED out and executed with their free variables
// passed in — the shipped lines run, and a recording `perform` says what command
// they actually sent. That is a wiring test. The one thing a slice cannot show
// is that every branch of performGuided routes through the wrapper, so that is
// asserted structurally, and labelled as such where it happens.
import { readFileSync, writeFileSync } from 'node:fs';

// As LF whatever the checkout wrote, so the performGuided cut below ends at the
// next function on an LF working copy too (it ran to the end of the file there).
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`could not locate ${what}`);
  if (s.indexOf(a, i + 1) >= 0) throw new Error(`${what}: start marker is not unique`);
  return s.slice(i, j);
};

// The two blocks under test, lifted verbatim and wrapped in a callable. The
// wrappers supply exactly the free variables the closure gave them, and nothing
// else — an extra one here could hide a reference the real site does not have.
// From the Reveal half down, since both halves read one `moveSilent` worked out
// above them (a Movement Action asks its own Silence, a bare Maneuver the
// Maneuver's: audit Phase 3, B2). promptReveal and `m` come in as parameters.
const settleBlock = cut(mainSrc,
  '      // Movement is a non-Silence action unless Stealth Movement grants it',
  "      // An enemy AERIAL unit's Movement triggers Interception",
  'the settle() Silence and Low Profile block');
// The opts carry the Common Action's Part too since the Phase 2 audit (E7).
const doneBlock = cut(mainSrc,
  '    const done = (performed: boolean, opts?: { twoHanded?: boolean; partKey?: string }): void => {',
  '    if (!t || !action) return done(false);',
  'the performGuided done wrapper');

// statusCount is the REAL one, and the Silence readers are the real ones: which
// Actions keep the Token is the whole rule, and a mirror of isSilentAction here
// would let this pass while the app disagreed. rangeBetween comes from rules.ts
// so an aura's reach is the reach the app gives it. Only tokenCards is stubbed,
// the way every other test here stubs it.
const body = `
type Token = any; type GameData = any; type PartSlot = any; type CardAction = any;
type Card = any; type GameState = any;
export function tokenCards(data: any, t: any): any[] {
  const out: any[] = [];
  for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack']) {
    const id = t.mech?.[slot]; const c = id ? data.byId.get(id) : undefined;
    if (c) out.push({ slot, card: c });
  }
  if (t.kind !== 'mech') { const c = data.byId.get(t.cardId); if (c) out.push({ slot: 'main', card: c }); }
  return out;
}
`
  + cut(types, 'export function statusCount', 'export function ageTokens', 'statusCount')
  + cut(rules, 'export function largeGridOf', '// Where inside Large Grid', 'largeGridOf')
  + cut(rules, 'export function rangeBetween', 'export function inArc', 'rangeBetween')
  // The aura walker silenceDenied reads, then the Silence classifiers. Both cuts
  // are clear of the two rules.ts cuts above (different file) and of each other:
  // Auras is 1583-1656 in units.ts, Silence 572-700.
  + cut(units, '// ---------- Auras (FAQ Q1-Q4, J2) ----------', '// LPA-21 Firefly', 'the aura walker')
  + cut(units, '// ---------- Silence (rulebook 4.12', '// ---------- Who breaks Optical Camouflage', 'the Silence classifiers')
  // Stealth Movement is read off a Part that can still act (FAQ I2, J23).
  + cut(units, '// A Part that can still initiate an Action', '// The Parts that may initiate this Common Action now', 'partUsable')
  + `
// ---------- the two main.ts blocks, verbatim ----------
export function settleShed(t: any, startPos: any, data: any, state: any, perform: any, logTo: any, m: any = {}, promptReveal: any = () => {}): void {
${settleBlock}}
export function makeDone(t: any, action: any, data: any, state: any, perform: any, logTo: any, report: any): any {
${doneBlock}  return done;
}
`;

const tmp = new URL('./_lowprofile.slice.ts', import.meta.url);
writeFileSync(tmp, body);
const M = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Low Profile on the freeplay board — 4.12.3\n');

// ---------- fixtures ----------

// Shaped after the real cards, and the block at the bottom of this file checks
// that claim against data/cards.json rather than asserting it in a comment.
const data = { byId: new Map([
  ['LPT', { id: 'LPT', actions: [
    { id: 'LP_FIRE', type: 'Firing', size: 's', range: 4, name: { en: 'Shot' } },
    { id: 'LP_HUSH', type: 'Firing', size: 's', range: 4, name: { en: 'Silent Single Shot' }, keywords: [{ key: '静默', en: 'Silence' }] },
    { id: 'LP_PASS', type: 'Passive', speed: 'passive', name: { en: 'Always On' } },
  ] }],
  // A Stealth Chassis, shaped after card 100 LM210S: Stealth Movement is a
  // grant_silent_movement rule reaching the Maneuver and the Part's own Move
  // Actions, which is what the Silence readers ask. NOT the card-level keyword,
  // which is the card's glossary footer (audit Phase 3, B1), and NOT PL29,
  // which lost Silence in the v1.021 redesign (both pinned at the bottom).
  ['STL', { id: 'STL', type: 'chasis', actions: [
    { id: 'STL_A', type: 'Moving', size: 'm', range: 3, name: { en: 'Sprint' } },
    { id: 'STL_B', type: 'Passive', speed: 'passive', name: { en: 'Stealth Movement' },
      gameRules: [{ effects: [{ type: 'grant_silent_movement', appliesTo: ['moving_action', 'adjust_move'] }] }] },
  ] }],
  // A Move Action on a Backpack, which the Stealth Chassis does not reach.
  ['JET', { id: 'JET', type: 'backpack', actions: [{ id: 'JET_A', type: 'Moving', size: 'm', range: 3, name: { en: 'Jump' } }] }],
  // ZHDR-206 Patrol Eagle, Dynamic Perception (data/action_overrides.json).
  ['EYE', { id: 'EYE', category: 'drone', actions: [{
    id: 'EYE_A', type: 'Passive', speed: 'passive', range: 3, name: { en: 'Dynamic Perception' },
    gameRules: [{ effects: [{ type: 'aura', effectTypes: ['silence_denied'], targetSide: 'enemy', targetUnitType: 'unit' }] }],
  }] }],
]) };

const lp = (over = {}) => ({
  uid: 1, side: 's1', kind: 'mech', label: 'Ghost', col: 3, row: 3, facing: 0, size: 3,
  stance: 'offensive', statuses: ['lowProfile'], mech: { torso: 'LPT' },
  partStates: { torso: 'intact' }, ...over,
});
const stealthy = (over = {}) => lp({
  mech: { torso: 'LPT', chasis: 'STL' }, partStates: { torso: 'intact', chasis: 'intact' }, ...over,
});
const eagle = (col, row) => ({
  uid: 7, side: 's2', kind: 'drone', label: 'Patrol Eagle', cardId: 'EYE',
  col, row, size: 1, stance: 'mobility', partStates: { main: 'intact' }, statuses: [],
});
// The recording collaborators. `sent` is the whole point: it says what command
// the shipped line actually issued, not that a function was in scope.
const rig = (tokens) => {
  const sent = [];
  const logged = [];
  return {
    state: { tokens, round: { n: 1, phase: 1, firstPlayer: 's1' } },
    sent, logged,
    perform: (_d, _s, cmd) => { sent.push(cmd); return { ok: true }; },
    logTo: (_t, text) => { logged.push(text); },
  };
};

// ---------- settle(): the board's Maneuver ----------

{
  const r = rig([lp()]);
  M.settleShed(r.state.tokens[0], { col: 3, row: 3 }, data, r.state, r.perform, r.logTo);
  check('a non-Silence Maneuver on the board sends removeStatus for the Token',
    r.sent, [{ kind: 'removeStatus', seat: 's1', uid: 1, targetUid: 1, statusId: 'lowProfile' }]);
  check('...and says so in the unit log, citing the rule',
    /Low Profile Token comes off \(4\.12\.3\)/.test(r.logged[0] ?? ''), true);
}
{
  const r = rig([stealthy()]);
  M.settleShed(r.state.tokens[0], { col: 3, row: 3 }, data, r.state, r.perform, r.logTo);
  check('a live Stealth Chassis keeps it, so nothing is sent (card 100 LM210S)', r.sent, []);
}
{
  // The guard that keeps an ordinary move quiet: removeStatus REFUSES a Token
  // the unit never had, and an unguarded send would toast that refusal after
  // every step a player takes.
  const r = rig([lp({ statuses: [] })]);
  M.settleShed(r.state.tokens[0], { col: 3, row: 3 }, data, r.state, r.perform, r.logTo);
  check('a unit with no Token sends nothing at all — no refusal on screen', r.sent, []);
}
{
  // The Patrol Eagle takes the Silence of an enemy's ACTIONS, and a Maneuver is
  // not one (ruled 2026-09-25, audit Phase 3, F14). It used to shed here.
  const mover = stealthy({ col: 33, row: 3 });
  const r = rig([mover, eagle(6, 3)]);
  M.settleShed(mover, { col: 3, row: 3 }, data, r.state, r.perform, r.logTo);
  check('a Stealth Chassis Maneuver out of a Patrol Eagle aura keeps the Token (F14)', r.sent, []);
}
const stlSprint = data.byId.get('STL').actions[0];
const jetJump = data.byId.get('JET').actions[0];
{
  // FAQ O11/O15: a Move Action is judged at the START grid as well as the
  // landing. The Eagle sits beside where the unit STOOD and 10 Grids from where
  // it lands, so a landing-only reading would hand the Silence back.
  const mover = stealthy({ col: 33, row: 3 });
  const r = rig([mover, eagle(6, 3)]);
  M.settleShed(mover, { col: 3, row: 3 }, data, r.state, r.perform, r.logTo, { action: stlSprint });
  check('the Chassis Sprint walking OUT of the aura sheds: the start grid is judged (FAQ O11/O15)', r.sent.length, 1);
  const clear = stealthy({ col: 33, row: 3 });
  const r2 = rig([clear, eagle(6, 3)]);
  M.settleShed(clear, { col: 27, row: 3 }, data, r2.state, r2.perform, r2.logTo, { action: stlSprint });
  check('and clear of it at both ends it keeps the Token', r2.sent, []);
}
{
  // Stealth Movement reaches "this part's" Move Actions: a Backpack's Jump on a
  // Stealth Chassis Mech is not Silent (audit Phase 3, B2). The board asked the
  // Maneuver's Silence for both until then.
  const jumper = stealthy({ mech: { torso: 'LPT', chasis: 'STL', backpack: 'JET' }, partStates: { torso: 'intact', chasis: 'intact', backpack: 'intact' } });
  const r = rig([jumper]);
  M.settleShed(jumper, { col: 3, row: 3 }, data, r.state, r.perform, r.logTo, { action: jetJump });
  check('a Backpack\'s Move Action on a Stealth Chassis sheds the Token (B2)', r.sent.length, 1);
  const r2 = rig([stealthy()]);
  M.settleShed(r2.state.tokens[0], { col: 3, row: 3 }, data, r2.state, r2.perform, r2.logTo, { action: stlSprint });
  check('while the Chassis\'s own Sprint keeps it', r2.sent, []);
}
{
  // The Reveal half reads the same answer, and asks the table (4.12.2).
  const prompts = [];
  const ghost = lp({ statuses: ['camouflage'] });
  const r = rig([ghost]);
  M.settleShed(ghost, { col: 3, row: 3 }, data, r.state, r.perform, r.logTo, {}, (_t, why) => prompts.push(why));
  check('a camouflaged unit\'s non-Silence Maneuver prompts the Reveal', prompts, ['Ghost moved without Silence.']);
  const quiet = [];
  const hidden = stealthy({ statuses: ['camouflage'] });
  const r2 = rig([hidden, eagle(6, 3)]);
  M.settleShed(hidden, { col: 3, row: 3 }, data, r2.state, r2.perform, r2.logTo, {}, (_t, why) => quiet.push(why));
  check('and a Stealth Chassis Maneuver beside an Eagle prompts nothing (F14)', quiet, []);
  const named = [];
  const r3 = rig([hidden, eagle(6, 3)]);
  M.settleShed(hidden, { col: 3, row: 3 }, data, r3.state, r3.perform, r3.logTo, { action: stlSprint }, (_t, why) => named.push(why));
  check('while its Sprint beside one names the Eagle as the reason',
    /Patrol Eagle \(Dynamic Perception\) denies it/.test(named[0] ?? ''), true);
}

// ---------- performGuided(): the board's Actions ----------

const drive = (tokens, action, performed) => {
  const r = rig(tokens);
  const seen = [];
  const done = M.makeDone(tokens[0], action, data, r.state, r.perform, r.logTo, (p) => seen.push(p));
  done(performed);
  return { sent: r.sent, seen, logged: r.logged };
};
const act = (id) => data.byId.get('LPT').actions.find((a) => a.id === id);

{
  const d = drive([lp()], act('LP_FIRE'), true);
  check('a performed non-Silence Action sends removeStatus for the Token',
    d.sent, [{ kind: 'removeStatus', seat: 's1', uid: 1, targetUid: 1, statusId: 'lowProfile' }]);
  check('...and still reports the Action as performed to its caller', d.seen, [true]);
}
{
  // Backing out of a target pick costs nothing — the same law the Tick is under.
  const d = drive([lp()], act('LP_FIRE'), false);
  check('an Action backed out of keeps the Token, as it keeps the Tick', d.sent, []);
  check('...and the cancel still reaches the caller', d.seen, [false]);
}
{
  const d = drive([lp()], act('LP_HUSH'), true);
  check('a Silent Action keeps the Token (the printed keyword)', d.sent, []);
  check('...and reports normally, so Silence costs the caller nothing', d.seen, [true]);
}
{
  // 4.12.3 exempts Passive Actions BY NAME. LP_PASS prints no Silence, so the
  // passive test is the only thing that can be keeping the Token here.
  const d = drive([lp()], act('LP_PASS'), true);
  check('a PASSIVE Action keeps it, though it prints no Silence (4.12.3)', d.sent, []);
}
{
  const d = drive([lp({ statuses: [] })], act('LP_FIRE'), true);
  check('and a unit with no Token sends nothing', d.sent, []);
}
{
  // The aura reaches Actions as well as Maneuvers — ZHDR-206 strips Silence from
  // "all Actions of enemy units within range", so the Silent shot loses it too.
  const t = lp();
  const d = (() => {
    const r = rig([t, eagle(6, 3)]);
    const seen = [];
    M.makeDone(t, act('LP_HUSH'), data, r.state, r.perform, r.logTo, (p) => seen.push(p))(true);
    return r.sent;
  })();
  check('an enemy Patrol Eagle denies the Silence, so even the Silent shot sheds it', d.length, 1);
}

// ---------- the funnel, asserted structurally ----------
//
// STRUCTURAL, not driven, and said plainly: the slice above proves the wrapper
// is correct, but not that every one of performGuided's twenty-odd branches goes
// through it. That is a property of the enclosing closure, which cannot be
// imported. The shape that makes it true is that the CALLER's callback is
// renamed `report` and reached only from inside the wrapper — so if `report(`
// appears anywhere else in the body, some branch is bypassing the rule.
{
  const at = mainSrc.indexOf('function performGuided(uid: number, actionId: string, report:');
  const end = mainSrc.indexOf('\n  function ', at);
  check('performGuided takes the caller callback as `report`, not `done`', at >= 0, true);
  const bodyText = mainSrc.slice(at, end);
  check('and `report(` is called exactly once — only the wrapper reaches it',
    (bodyText.match(/\breport\(/g) ?? []).length, 1);
  check('so every branch that finishes an Action calls the wrapper instead',
    (bodyText.match(/\bdone\(/g) ?? []).length > 5, true);
}

// ---------- the fixtures are not inventions ----------
//
// Every card above is shaped after a real one. Checked rather than claimed,
// because a fixture that has drifted from the data tests nothing.
{
  const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
  const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
  const silent = (k) => k.key === '静默' || k.en === 'Silence';
  // READ THE MERGED CARD, NOT cards.json. data.ts applies stat_overrides with
  // Object.assign, so an override's `keywords` REPLACES the community bundle's
  // — and one card uses that to take a keyword away. Asserting against the raw
  // file here would have pinned a Silence the shipped app does not have.
  const stat = JSON.parse(readFileSync(new URL('../../data/stat_overrides.json', import.meta.url), 'utf8')).cards ?? {};
  const merged = (id) => ({ ...cards.find((c) => String(c.id) === id), ...(stat[id] ?? {}) });
  // THE LIVE EXAMPLE IS CARD 100, NOT 180, and getting this wrong cost a whole
  // debugging pass. Card 180 PL29 was the Stealth Chassis every comment in this
  // engine quotes, but the publisher's GoF parts list v1.021 REDESIGNED it into
  // the PL29 All-terrain Chassis, "losing Silence and gaining a Jump" —
  // stat_overrides.json carries that as `keywords: []`. So a PL29 Mech now
  // sheds its Low Profile Token on any Maneuver, correctly.
  check('card 100 LM210S Stealth Chassis carries Silence in the SHIPPED data',
    (merged('100').keywords ?? []).some(silent), true);
  check('and card 180 PL29 no longer does — the v1.021 redesign took it away',
    [(cards.find((c) => String(c.id) === '180').keywords ?? []).some(silent),
      (merged('180').keywords ?? []).some(silent)],
    [true, false]);
  // What the readers actually ask since the audit's Phase 3 (B1) is Stealth
  // Movement's grant_silent_movement rule, not the card-level keyword: that is
  // the card's glossary footer, and 27 Parts list Silence there because one of
  // their Actions prints it. The action overrides are applied, as the app does,
  // since 180_B still carried the grant in the bundle and one of them clears it.
  const ovActs = JSON.parse(readFileSync(new URL('../../data/action_overrides.json', import.meta.url), 'utf8')).actions ?? {};
  const grantsOf = (c) => (c.actions ?? []).flatMap((a) => {
    const rules = ovActs[a.id]?.gameRules ?? a.gameRules ?? [];
    return rules.flatMap((g) => (g.effects ?? []).filter((e) => e.type === 'grant_silent_movement').map((e) => e.appliesTo ?? []));
  });
  check('card 100\'s Stealth Movement grants Silence to its Move Actions and the Maneuver',
    grantsOf(cards.find((c) => String(c.id) === '100')), [['moving_action', 'adjust_move']]);
  check('and card 180\'s stale grant is cleared by the override',
    [(cards.find((c) => String(c.id) === '180').actions ?? []).some((a) => (a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => e.type === 'grant_silent_movement'))),
      grantsOf(cards.find((c) => String(c.id) === '180')).length],
    [true, 0]);
  // What maneuverPrintsSilence can actually find on a Mech today. Pinned as a
  // set so a data refresh that drops the last one is loud rather than silently
  // making the Maneuver carve-out unreachable.
  const silentParts = cards
    .filter((c) => grantsOf(c).some((to) => to.includes('adjust_move')))
    .map((c) => String(c.id)).sort();
  check('exactly two Chassis grant Silence to a Maneuver', silentParts, ['100', '250']);
  check('while many more Parts list Silence in their keyword footer, which is not read',
    cards.filter((c) => c.category === 'mech_part' && (merged(String(c.id)).keywords ?? []).some(silent)).length > 10, true);
  const eagleCard = cards.find((c) => String(c.id) === 'ZHDR-206');
  check('and ZHDR-206 Patrol Eagle really has a Passive at Range 3',
    (eagleCard?.actions ?? []).find((a) => a.id === 'ZHDR-206_A')?.range, 3);
  // The aura itself is an override, not community data — cards.json gives that
  // Passive no gameRules at all, which is exactly why the override exists.
  const ov = JSON.parse(readFileSync(new URL('../../data/action_overrides.json', import.meta.url), 'utf8'));
  const kinds = ov.actions?.['ZHDR-206_A']?.gameRules?.[0]?.effects?.[0];
  check('the silence_denied aura comes from the override, enemy-side, any unit type',
    [kinds?.effectTypes, kinds?.targetSide, kinds?.targetUnitType],
    [['silence_denied'], 'enemy', 'unit']);
  // A Low Profile Token is a HEXAGON, which is why one removal is enough: a unit
  // may bear only one (2.5.3) and addStatus enforces it on the way in.
  check('and Low Profile is a Hexagon Token, so it can never stack',
    /id: 'lowProfile',[\s\S]{0,200}?shape: 'hexagon'/.test(types), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

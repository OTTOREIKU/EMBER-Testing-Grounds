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

const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
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
const settleBlock = cut(mainSrc,
  "      // 4.12.3's OTHER consequence",
  "      // An enemy AERIAL unit's Movement triggers Interception",
  'the settle() Low Profile block');
const doneBlock = cut(mainSrc,
  '    const done = (performed: boolean): void => {',
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
  + `
// ---------- the two main.ts blocks, verbatim ----------
export function settleShed(t: any, startPos: any, data: any, state: any, perform: any, logTo: any): void {
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
  // A Stealth Chassis: the Silence keyword sits on the CARD, not on an Action,
  // which is what maneuverPrintsSilence reads. Shaped after card 100 LM210S —
  // NOT after PL29, which lost the keyword in the v1.021 redesign (pinned at
  // the bottom of this file).
  ['STL', { id: 'STL', type: 'chasis', keywords: [{ key: '静默', en: 'Silence' }], actions: [] }],
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
  // FAQ O11/O15: judged at the START grid as well as the landing. The Eagle sits
  // beside where the unit STOOD and 10 Grids from where it lands, so a
  // landing-only reading would hand the Silence back.
  const mover = stealthy({ col: 33, row: 3 });
  const r = rig([mover, eagle(6, 3)]);
  M.settleShed(mover, { col: 3, row: 3 }, data, r.state, r.perform, r.logTo);
  check('walking OUT of a Patrol Eagle aura still sheds — the start grid is judged (FAQ O11/O15)',
    r.sent.length, 1);
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
  const end = mainSrc.indexOf('\r\n  function ', at);
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
  // What maneuverPrintsSilence can actually find on a Mech today. Pinned as a
  // set so a data refresh that drops the last one is loud rather than silently
  // making the Maneuver carve-out unreachable.
  const silentParts = cards
    .map((c) => ({ ...c, ...(stat[c.id] ?? {}) }))
    .filter((c) => c.category === 'mech_part' && (c.keywords ?? []).some(silent))
    .filter((c) => c.type === 'chasis')
    .map((c) => String(c.id)).sort();
  check('exactly two Chassis grant Silence to a Maneuver', silentParts, ['100', '250']);
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

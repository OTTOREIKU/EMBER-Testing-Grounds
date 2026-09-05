// Tactics Cards (rulebook 5.4.2): the six specs driven against fixtures, and
// the two pages' doors pinned. The pass of 2026-09-05 found the Match Centre
// squad panel's Play button sending a bare command the engine refuses (first
// token, no pick), a Stance change offering Shutdown as a choice, and the
// squad panel reading a timing off card actions the six cards do not have.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Tactics Cards\n');

const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const tactics = readFileSync(new URL('../src/tactics.ts', import.meta.url), 'utf8');
// STATUSES is the real list: which Tokens System Repair may remove is a rule
// about token SHAPES, and a mirrored list here could drift from it.
const statuses = types.slice(types.indexOf('export const STATUSES'), types.indexOf('export interface RoundState'));
if (!statuses) throw new Error('could not locate STATUSES in types.ts');
const tmp = new URL('./_tactics.slice.ts', import.meta.url);
writeFileSync(tmp, 'type GameState = any; type Side = any; type Stance = any; type Token = any; type StatusDef = any;\n'
  + 'function alive(t: any): boolean { return (t.partStates?.main ?? t.partStates?.torso ?? "intact") !== "destroyed"; }\n'
  + statuses + tactics.replace(/^import[^\n]*\n/gm, ''));
const T = await import(tmp.href);

const ctx = { maxLink: (t) => t.lv ?? 4 };
const mech = (uid, side, over = {}) => ({ uid, side, kind: 'mech', label: `M${uid}`, stance: 'offensive', link: 2, lv: 4, partStates: { torso: 'intact' }, statuses: [], ...over });
const drone = (uid, side, over = {}) => ({ uid, side, kind: 'drone', label: `D${uid}`, stance: 'defensive', partStates: { main: 'intact' }, statuses: [], ...over });
const proj = (uid, side) => ({ uid, side, kind: 'projectile', label: `P${uid}`, stance: 'defensive', partStates: { main: 'intact' }, statuses: [] });
const game = (tokens) => ({ tokens, round: { n: 1, phase: 2 } });
const ids = (list) => list.map((t) => t.uid);

check('all six cards have a spec', ['274', '275', '276', '277', '278', '279'].map((id) => !!T.tacticSpec(id)), [true, true, true, true, true, true]);
check('and each says what it does', ['274', '275', '276', '277', '278', '279'].every((id) => typeof T.tacticSpec(id).text === 'string' && T.tacticSpec(id).text.length > 20), true);
check('an unknown card has none', T.tacticSpec('999'), null);

// ---------- 274 Additional Instructions ----------
{
  const s = game([drone(1, 's1'), drone(2, 's1', { partStates: { main: 'destroyed' } }), mech(3, 's1'), drone(4, 's2')]);
  const spec = T.tacticSpec('274');
  check('274 is a Command Phase card', [spec.phase, spec.freeCommand], ['Command', true]);
  check('it targets your own living Drones', ids(T.tacticTargets(spec, s, 's1', ctx)), [1]);
  check('and the other squad sees only theirs', ids(T.tacticTargets(spec, s, 's2', ctx)), [4]);
}

// ---------- 275 Battlefield Recovery ----------
{
  const spec = T.tacticSpec('275');
  const full = mech(1, 's1', { link: 4 });
  const low = mech(2, 's1', { link: 2 });
  const shut = mech(3, 's1', { link: 0, stance: 'shutdown' });
  const s = game([full, low, shut]);
  check('275 is an End Phase card', spec.phase, 'End');
  check('a Mech at full Link and a Shutdown Mech are not targets', ids(T.tacticTargets(spec, s, 's1', ctx)), [2]);
  spec.apply(low, s, ctx, null);
  check('it restores exactly 1 Link', low.link, 3);
  spec.apply(full, s, ctx, null);
  check('and never past the pilot\'s Link Value', full.link, 4);
}

// ---------- 276 Hit and Run ----------
{
  const spec = T.tacticSpec('276');
  const s = game([mech(1, 's1'), mech(2, 's1', { stance: 'shutdown' }), drone(3, 's1')]);
  check('276 is an Action Phase card that grants a Maneuver', [spec.phase, spec.maneuver], ['Action', true]);
  check('for a Mech that is not Shut Down', ids(T.tacticTargets(spec, s, 's1', ctx)), [1]);
}

// ---------- 277 System Repair ----------
{
  const spec = T.tacticSpec('277');
  const tokened = mech(1, 's1', { statuses: ['fragile', 'fragile', 'highlight'] });
  const clean = mech(2, 's1');
  const dr = drone(3, 's1', { statuses: ['lowProfile'] });
  const camo = mech(4, 's1', { statuses: ['camouflage'] });
  const s = game([tokened, clean, dr, camo, proj(5, 's1')]);
  check('277 targets any unit of yours wearing a Square or Hexagon Token', ids(T.tacticTargets(spec, s, 's1', ctx)), [1, 3]);
  check('a State is not a Token it can remove', ids(T.tacticTargets(spec, s, 's1', ctx)).includes(4), false);
  const picks = spec.choices(tokened, s, ctx);
  check('the choices are the Tokens worn, counted', picks.map((p) => [p.id, p.label]), [['fragile', 'Fragile ×2'], ['highlight', 'Highlight']]);
  spec.apply(tokened, s, ctx, 'fragile');
  check('and removing one takes ONE off', tokened.statuses, ['fragile', 'highlight']);
}

// ---------- 278 Tactical Disposition ----------
{
  const spec = T.tacticSpec('278');
  const m = mech(1, 's1', { stance: 'offensive' });
  const s = game([m, mech(2, 's1', { stance: 'shutdown' })]);
  check('278 leaves a Shutdown Mech alone', ids(T.tacticTargets(spec, s, 's1', ctx)), [1]);
  check('and offers the two OTHER real Stances, never Shutdown (4.1)', spec.choices(m, s, ctx).map((p) => p.id), ['defensive', 'mobility']);
  spec.apply(m, s, ctx, 'mobility');
  check('the change lands', m.stance, 'mobility');
}

// ---------- 279 Remote Restart ----------
{
  const spec = T.tacticSpec('279');
  const shut = mech(1, 's1', { stance: 'shutdown', link: 0 });
  const up = mech(2, 's1');
  const s = game([shut, up]);
  check('279 is an End Phase card for a Shutdown Mech', [spec.phase, ids(T.tacticTargets(spec, s, 's1', ctx))], ['End', [1]]);
  check('it restarts into one of the three real Stances', spec.choices(shut, s, ctx).map((p) => p.id), ['offensive', 'defensive', 'mobility']);
  spec.apply(shut, s, ctx, 'defensive');
  check('leaving Shutdown with 1 Link, as a Reboot does (4.1.1)', [shut.stance, shut.link], ['defensive', 1]);
}

check('tacticFitsPhase reads the spec', [T.tacticFitsPhase('274', 'Command'), T.tacticFitsPhase('274', 'Action'), T.tacticFitsPhase('275', 'End')], [true, false, true]);

// ---------- the doors ----------
const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const match = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const squads = readFileSync(new URL('../src/squads.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const chk = cmds.slice(cmds.indexOf("case 'playTactic': {"), cmds.indexOf("case 'playTactic': {") + 1400);
check('the command reads the sender\'s hand', /is not in this squad's hand/.test(chk), true);
check('one per squad per round (5.4.2)', /A squad may play only 1 Tactics Card per round \(5\.4\.2\)/.test(chk), true);
check('in the card\'s own phase once a game is running', /state\.script && PHASES\[state\.round\.phase\] !== spec\.phase/.test(chk), true);
check('against a legal target with a legal pick', /tacticTargets\(spec, state, cmd\.seat, ctx\)\.some\(\(x\) => x\.uid === cmd\.uid\)/.test(chk) && /spec\.choices\(t, state, ctx\)\.some\(\(o\) => o\.id === cmd\.pick\)/.test(chk), true);
check('the Match Centre squad panel goes through the turn panel\'s picker, not a bare send',
  /onPlayTactic: \(side, id\) => \{\s*\n\s*startTacticPick\(side, id\);/.test(match) && !/kind: 'playTactic', seat: side, uid: state\.tokens\.find/.test(match), true);
check('which the HUD exports', /export function startTacticPick\(side: Side, cardId: string\)/.test(hud), true);
check('the squad panel reads the timing off the spec, not off actions the cards do not have',
  /tacticSpec\(id\)\?\.timing/.test(squads) && !/card\.actions\?\.\[0\]\?\.name\?\.en/.test(squads), true);
check('and shows what the card does', /tacticSpec\(id\)\?\.text/.test(squads), true);
check('freeplay asks target then pick, the same two questions', /spec\.prompt/.test(main) && /spec\.choiceTitle \?\? spec\.name/.test(main), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// WHO STANDS INSIDE AN AURA, ON A TABLE WITH NO BOARD (OTTO, 2026-09-29).
// The pad cannot measure an aura's Range, and a Guided pad stands every unit
// on one placeholder cell, so every aura reached everyone. The table says who
// stands inside instead (setAuraReach, kept on the aura's own unit), and every
// aura rule reads that record. Driven against the shipped cards; the pad's
// wiring is pinned as text at the end.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_aurareach.entry.ts', import.meta.url);
const out = new URL('./_aurareach.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export * as U from '../src/units';",
  "export * as C from '../src/commands';",
  "export { boardFingerprint } from '../src/secrecy';",
  "export { labelFor } from '../src/ledger';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const { U, C } = M;
const data = await M.loadData();

console.log('Aura reach on a table with no board\n');

const L = (extra = {}) => ({ torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2', ...extra });
const raw = (noBoard) => ({ v: 3, tokens: [], nextUid: 1, round: { n: 1, phase: 2, firstPlayer: 's1' }, ...(noBoard ? { noBoard: true } : {}) });
function mech(s, side, loadout) {
  const t = { ...U.makeMechToken(s, data, loadout, side), col: 0, row: 0, facing: 0, deployed: true, statuses: [], log: [] };
  s.tokens.push(t);
  return t;
}
function drone(s, side, cardId) {
  const t = { ...U.makeDroneToken(s, data, data.byId.get(cardId), side), col: 0, row: 0, facing: 0, deployed: true, statuses: [], log: [] };
  s.tokens.push(t);
  return t;
}
// A Guided pad's table: every unit on the one placeholder cell, where Range
// used to put everybody inside every aura.
function padTable() {
  const s = U.migrateState(raw(true), data);
  const dune = mech(s, 's1', L({ torso: '014' }));   // Tactical Coordination: ally Mechs, Range 3
  const ally = mech(s, 's1', L());
  const scout = drone(s, 's1', 'PRDR-202');
  const foe = mech(s, 's2', L());
  const eagle = drone(s, 's2', 'ZHDR-206');           // Dynamic Perception: enemy units, Silence denied
  return { s: U.migrateState(JSON.parse(JSON.stringify(s)), data), ids: { dune: dune.uid, ally: ally.uid, scout: scout.uid, foe: foe.uid, eagle: eagle.uid } };
}
const unit = (s, uid) => s.tokens.find((t) => t.uid === uid);
const tick = (s, sourceUid, actionId, targetUid, on = true) => {
  const target = unit(s, targetUid);
  return C.perform(data, s, { kind: 'setAuraReach', seat: target.side, uid: target.uid, sourceUid, actionId, targetUid, on });
};

// ---------- the record's presence is the mode ----------
{
  const { s, ids } = padTable();
  check('every unit of a board-less table carries a record after a load', s.tokens.every((t) => t.auraReaches && typeof t.auraReaches === 'object'), true);
  const b = U.migrateState({ ...raw(false), tokens: JSON.parse(JSON.stringify(s.tokens)) }, data);
  check('...and no unit of a board\'s does', b.tokens.some((t) => t.auraReaches !== undefined), false);
  const late = { ...U.makeMechToken(s, data, L(), 's1'), col: 0, row: 0, facing: 0, deployed: true, statuses: [], log: [] };
  s.tokens.push(late);
  C.perform(data, s, { kind: 'applyStatus', seat: 's1', uid: ids.dune, targetUid: ids.dune, statusId: 'fragile' });
  check('a unit that arrives by a command carries one too, once any command lands', !!unit(s, late.uid).auraReaches, true);
}

// ---------- an ally aura: Tactical Coordination ----------
{
  const { s, ids } = padTable();
  const dune = unit(s, ids.dune);
  const tc = U.auraActionOf(data, dune, '014_A');
  check('the Dune Tactical Core projects an aura the record can hold', !!tc, true);
  check('nobody is inside until ticked, though every unit shares one placeholder cell',
    U.auraEffectsOn(data, s.tokens, unit(s, ids.ally)).has('flexible_timing'), false);
  check('the aura\'s own unit is always inside (a unit is its own ally)', U.auraEffectsOn(data, s.tokens, dune).has('flexible_timing'), true);
  check('only the units it can touch are offered: an ally Mech, never a Drone, an enemy or itself',
    U.auraReachable(s.tokens, dune, tc).map((t) => t.uid), [ids.ally]);
  const refuse = (targetUid) => C.check(data, s, { kind: 'setAuraReach', seat: unit(s, targetUid).side, uid: targetUid, sourceUid: ids.dune, actionId: '014_A', targetUid, on: true });
  check('the engine refuses a tick the aura could never hold', [refuse(ids.scout).ok, refuse(ids.foe).ok, refuse(ids.dune).ok], [false, false, false]);
  check('...and says why in plain words', /cannot reach/.test(refuse(ids.scout).why ?? ''), true);
  check('...and refuses an Action that is no aura', C.check(data, s, { kind: 'setAuraReach', seat: 's1', uid: ids.ally, sourceUid: ids.dune, actionId: '__proto__', targetUid: ids.ally, on: true }).ok, false);
  check('a tick lands', tick(s, ids.dune, '014_A', ids.ally).ok, true);
  check('...and the aura reaches that unit now', U.auraEffectsOn(data, s.tokens, unit(s, ids.ally)).has('flexible_timing'), true);
  check('...kept on the aura\'s own unit, by its Action', unit(s, ids.dune).auraReaches['014_A'], [ids.ally]);
  tick(s, ids.dune, '014_A', ids.ally, false);
  check('untick it and it is out again', U.auraEffectsOn(data, s.tokens, unit(s, ids.ally)).has('flexible_timing'), false);
  const board = U.migrateState({ ...raw(false), tokens: JSON.parse(JSON.stringify(s.tokens)) }, data);
  check('a board measures the Range itself, so it keeps no record',
    C.check(data, board, { kind: 'setAuraReach', seat: 's1', uid: ids.ally, sourceUid: ids.dune, actionId: '014_A', targetUid: ids.ally, on: true }).ok, false);
}

// ---------- an enemy aura: the Patrol Eagle takes Silence ----------
{
  const { s, ids } = padTable();
  const eagle = unit(s, ids.eagle);
  const dp = U.auraActionOf(data, eagle, 'ZHDR-206_A');
  const offered = U.auraReachable(s.tokens, eagle, dp).map((t) => t.uid).sort((a, b) => a - b);
  check('an enemy aura offers only the other squad\'s units', offered, [ids.dune, ids.ally, ids.scout].sort((a, b) => a - b));
  const silentAct = { id: 'X', description: { zh: '静默' } };
  check('a Silent Action keeps its Silence while nobody is ticked in the Eagle\'s aura',
    U.isSilentAction(data, s.tokens, unit(s, ids.ally), silentAct), true);
  tick(s, ids.eagle, 'ZHDR-206_A', ids.ally);
  check('...and loses it once the table ticks the unit inside',
    U.isSilentAction(data, s.tokens, unit(s, ids.ally), silentAct), false);
  check('...naming the Eagle, for the notice line', U.actionSilenceDenier(data, s.tokens, unit(s, ids.ally), silentAct)?.source?.uid, ids.eagle);
}

// ---------- what an attack and a Counter-roll are asked about ----------
{
  const s = U.migrateState(raw(true), data);
  const shooter = mech(s, 's1', L({ torso: '558' }));   // Firing Coordination: ally Mechs' Firing, Range
  const wing = mech(s, 's1', L());
  const target = mech(s, 's2', L());
  const guard = mech(s, 's2', L({ torso: '559' }));     // Defense optimization: ally units, +White
  const chance = mech(s, 's2', L({ torso: 'PDTR-202' })); // EW Suppression: enemy units, Strength
  const t = U.migrateState(JSON.parse(JSON.stringify(s)), data);
  const u = (x) => unit(t, x.uid);
  const gun = { id: 'G', type: 'Firing', range: 4 };
  const sword = { id: 'S', type: 'Melee', range: 0 };
  const names = (list) => list.map((c) => `${c.act.id}>${c.unit.uid}:${c.text}`).sort();
  check('a Firing attack by an ally of the Oasis is asked about its Range, and the target about the Escarpment\'s White dice',
    names(U.aurasAtRoll(data, t.tokens, u(wing), u(target), gun, false)), [`558_A>${wing.uid}:+1 Range`, `559_A>${target.uid}:+1W`].sort());
  check('...the Oasis\'s own attack is not asked about its own aura, which always holds',
    names(U.aurasAtRoll(data, t.tokens, u(shooter), u(target), gun, false)).some((x) => x.startsWith('558_A')), false);
  check('...a Melee attack is asked about the White dice only',
    names(U.aurasAtRoll(data, t.tokens, u(wing), u(target), sword, false)), [`559_A>${target.uid}:+1W`]);
  check('...and a Counter-roll only about Strength, on the side the aura works against',
    names(U.aurasAtRoll(data, t.tokens, u(wing), u(target), { id: 'E' }, true)), [`PDTR-202_B>${wing.uid}:${u(wing).label}: Strength -1`]);
  const guardDown = U.migrateState(JSON.parse(JSON.stringify(t)), data);
  unit(guardDown, guard.uid).partStates.torso = 'destroyed';
  check('an aura whose unit is destroyed is not asked about',
    names(U.aurasAtRoll(data, guardDown.tokens, unit(guardDown, wing.uid), unit(guardDown, target.uid), sword, false)), []);
}

// ---------- a load keeps only a clean record ----------
{
  const { s, ids } = padTable();
  const dirty = JSON.parse(JSON.stringify(s));
  dirty.tokens.find((t) => t.uid === ids.dune).auraReaches = { '014_A': [ids.ally, ids.ally, 'x', 3.5, 9], 'bad key!': [1], 'n': 'not a list' };
  const back = U.migrateState(dirty, data);
  check('a load keeps whole uids once each, in order, under Action ids only', unit(back, ids.dune).auraReaches, { '014_A': [ids.ally, 9].sort((a, b) => a - b) });
}

// ---------- the fingerprint and the History ----------
{
  const { s, ids } = padTable();
  const before = M.boardFingerprint(s);
  const bare = JSON.parse(JSON.stringify(s));
  for (const t of bare.tokens) delete t.auraReaches;
  check('an empty record hashes like no record, so every other board hashes as before', M.boardFingerprint(bare), before);
  tick(s, ids.dune, '014_A', ids.ally);
  check('a tick changes the fingerprint, so two boards that disagree are caught', M.boardFingerprint(s) !== before, true);
  const label = M.labelFor({ kind: 'setAuraReach', seat: 's1', uid: ids.ally, sourceUid: ids.dune, actionId: '014_A', targetUid: ids.ally, on: true }, s,
    { action: (uid, id) => (uid === ids.dune && id === '014_A' ? 'Tactical Coordination' : undefined) }).label;
  check('the History says it in words', label, `${unit(s, ids.ally).label} stands in Tactical Coordination`);
}

// ---------- the pad ----------
const pad = src('../pad/pad.ts');
check('pad: the count sits on the aura\'s own Action row and opens its In reach list',
  [/const reach = reachChip\(t, g\.action, g\.available\);/.test(pad), /data-act="aura-open"/.test(pad), /if \(panel === 'aura'\) return auraPanel\(\);/.test(pad)],
  [true, true, true]);
check('pad: the list offers only the units the aura can touch',
  /const units = auraReachable\(table\.tokens, src, a\);/.test(pad), true);
check('pad: an attack and a Counter-roll show the auras that change their numbers, lit as the record stands',
  [/\$\{auraRow\(auraChips\(t, foe, a, false\)\)\}/.test(pad), /auraRow\(auraChips\(t, foe, a, true\)\)/.test(pad), /const on = inAuraReach\(c\.src, c\.act\.id, c\.unit\);/.test(pad)],
  [true, true, true]);
check('pad: Silence is read off the record, not asked',
  [/askSilenceAura/.test(pad), /const aura = actionSilenceDenier\(data!, table\.tokens, now, a\);/.test(pad)], [false, true]);
check('pad: Appease starts from the record, and its answer is the record',
  [/on: inAuraReach\(v, a\.id, x\)/.test(pad), /kind: 'setAuraReach', \.\.\.sourceFor\(x\), sourceUid: v\.uid, actionId: a\.id/.test(pad)], [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

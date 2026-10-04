// The Supplementary Rules 1.04 (Phase 8 of Project-Documents/
// PUBLISHER-1.04-CHANGES.md): the rules the app got wrong against the
// Supplement, each fixed and pinned here, with the glossary and Rules text and
// the changelog lines that say what changed. The Shock Attack walk's "up to X"
// is driven through the engine in mechanics7.test.mjs, beside the rest of that
// walk's rules.
//
// Read against the REAL card database and the real modules, bundled, because
// every one of these was a question of which card carries what.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
// The Match Centre's turn readings (which Actions, which targets, which Grids)
// live in turn.ts since 2026-10-01, shared with the seat seam; the pins that
// named them in matchhud.ts follow them there.
const turnSrc = readFileSync(new URL('../src/turn.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom, makeEl, textOf } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Supplementary Rules 1.04\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_supplement104.entry.ts', import.meta.url);
const out = new URL('./_supplement104.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export { check as commandCheck } from '../src/commands';",
  "export { newScriptState } from '../src/types';",
  "export * as Un from '../src/units';",
  "export * as Ru from '../src/rules';",
  "export * as R from '../src/refcards';",
  "export { SquadTracker } from '../src/squads';",
  "export { setLocalSeat } from '../src/loop';",
  "export { apply as commandApply } from '../src/commands';",
  "export { glueAfter } from '../src/glue';",
  "export { boardFingerprint } from '../src/secrecy';",
  "export { controlOf } from '../src/tasks';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const U = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);
const data = await U.loadData();
U.R.useCardData(data);
const card = (id) => data.byId.get(id);
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const combat = src('../src/combat.ts');

// A scripted table, the mechanics5 way, for the checks that need a board.
function table() {
  return {
    v: 3, map: '', tokens: [], nextUid: 1,
    round: { n: 1, phase: 2, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    script: { ...U.newScriptState('s1'), strict: true },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
  };
}
const G = (c, r) => ({ col: c * 3, row: r * 3 });
const L = (extra = {}) => ({ torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2', ...extra });
function put(s, side, loadout, c, r, extra = {}) {
  const t = { ...U.Un.makeMechToken(s, data, loadout, side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
function droneOn(s, side, cardId, c, r, extra = {}) {
  const t = { ...U.Un.makeDroneToken(s, data, data.byId.get(cardId), side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
// A free table (no setup, so no guided game), and a command sent through the
// engine the way a page sends one.
function freeTable() {
  return U.Un.migrateState({ v: 3, tokens: [], nextUid: 1, round: { n: 1, phase: 2, firstPlayer: 's1' } }, data);
}
const send = (s, cmd) => {
  const v = U.commandCheck(data, s, cmd);
  if (v.ok) { U.commandApply(data, s, cmd); U.glueAfter(data, s, cmd); }
  return v;
};
const mech = (parts, states = {}) => ({
  uid: 61, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive', statuses: [],
  mech: parts, partStates: Object.fromEntries(Object.keys(parts).map((k) => [k, states[k] ?? 'intact'])),
});

// ---------- 3.7 Dense Armor ----------
console.log('3.7 Dense Armor');
// A P28 core with an SS30 Heavy Shield: both Parts carry the passive, and the
// hit Part is the one that answers. The first-found reader used to say Torso
// for every hit, so the shield never stripped a die.
const both = mech({ torso: '175', leftHand: 'ZHLA-301', rightHand: '002' });
check('a hit on the shield is a Dense Armor hit', U.Un.denseArmorSlot(data, both, 'leftHand'), 'leftHand');
check('and so is a hit on the core', U.Un.denseArmorSlot(data, both, 'torso'), 'torso');
check('a hit on a Part without it is not', U.Un.denseArmorSlot(data, both, 'rightHand'), null);
check('nor a hit on a destroyed shield',
  U.Un.denseArmorSlot(data, mech({ torso: '175', leftHand: 'ZHLA-301' }, { leftHand: 'destroyed' }), 'leftHand'), null);
check('the P24 core too', U.Un.denseArmorSlot(data, mech({ torso: '176' }), 'torso'), 'torso');
check('asked without a Part it still names the first carrier', U.Un.denseArmorSlot(data, both), 'torso');
// The strip asks through denseOn since 2026-10-01 (the odds read the same
// answer for every Part in turn); the table-dice note still asks directly.
check('both attack-window readers pass the hit Part',
  [(combat.match(/denseArmorSlot\(this\.data, c\.defender, c\.targetPart \?\? 'main'\)/g) ?? []).length,
    /const slot = this\.denseOn\(c\.targetPart \?\? 'main'\);/.test(combat), /return denseArmorSlot\(this\.data, c\.defender, slot\);/.test(combat)], [1, true, true]);
const kwNames = (id) => (card(id).keywords ?? []).map((k) => k.en);
check('the two Armored Cores lose the retired keyword chip', [kwNames('175'), kwNames('176')],
  [['Command Generation X'], ['Command Generation X']]);
check('and keep the Passive Action it became',
  ['175_B', '176_B'].map((id) => card(id.slice(0, 3)).actions.find((a) => a.id === id)?.name?.en), ['Dense Armor', 'Dense Armor']);
const dense = data.keyword('Dense Armor');
check('the glossary says it is no longer a keyword', /^No longer a keyword\./.test(dense.en.value), true);
check('and still states the rule', /remove every Attack Die showing a blank face/.test(dense.en.value), true);
const denseSheet = U.R.keywordDetail('Dense Armor');
check('its sheet carries a closed Changelog bar', /<details class="ref-log">[\s\S]*?Changed in 1\.04/.test(denseSheet), true);
check('with both changes, newest first',
  [...denseSheet.matchAll(/<li><span class="log-ver">([^<]+)<\/span>/g)].map((m) => m[1]), ['1.04', 'GoF 1.021']);
check('under the glossary text, before the card list',
  /<\/p>\s*<details class="ref-log">[\s\S]*?Appears on/.test(denseSheet), true);
check('the cards whose Action is named Dense Armor are listed on it',
  ['175', '176', 'ZHLA-301'].every((id) => denseSheet.includes(`data-card="${id}"`)), true);
check('a keyword with no changes has no bar', /ref-log/.test(U.R.keywordDetail('Drag') ?? ''), false);

// ---------- 1.2 Barricades: the Turtle Shell is 2 inches ----------
console.log('\n1.2 Barricades');
{
  const firing = { type: 'Firing' };
  // The Phase 5 scene: a shooter, a target, and a Barricade between them.
  const scene = (wallCard, wallSide) => {
    const s = table();
    const shooter = put(s, 's1', L(), 2, 5);
    const target = put(s, 's2', L(), 8, 5);
    if (wallCard) droneOn(s, wallSide, wallCard, 0, 0, { col: 16, row: 16 });
    return { s, shooter, target };
  };
  const cover = (x) => U.Ru.protectionFor(x.shooter, x.target, firing, [], x.s.tokens, []);
  check('the heights: AS3 walls 3 inches, the Turtle Shell 2',
    ['PDAM-003', 'PDAM-004', '158'].map((id) => U.Ru.barricadeHeight({ cardId: id })), [3, 3, 2]);
  check('the Turtle Shell covers its own ally', cover(scene('158', 's2')).white, 2);
  const foe = cover(scene('158', 's1'));
  check('and its enemy just the same, as Terrain Protection', [foe.white, /Terrain Protection/.test(foe.note)], [2, true]);
  check('never as Unit Protection, which only Large units give', /Unit Protection \(/.test(foe.note), false);
  // Squarely between two one-cell units: the AS3 wall blocks, the Turtle
  // Shell only obstructs, for a shot at anyone.
  const sightPast = (wallCard, wallSide) => {
    const n = table();
    const near = droneOn(n, 's1', '159', 0, 0, { col: 10, row: 16 });
    const far = droneOn(n, 's2', '159', 0, 0, { col: 18, row: 16 });
    droneOn(n, wallSide, wallCard, 0, 0, { col: 14, row: 16 });
    return U.Ru.firingSight(near, far, [], n.tokens, []);
  };
  check('a 3-inch wall blocks the line', sightPast('PDAM-003', 's2'), 'blocked');
  check('the Turtle Shell blocks no line, even in front of its ally', [sightPast('158', 's2'), sightPast('158', 's1')], ['obstructed', 'obstructed']);
  check('as terrain it names its height', U.Ru.unitTerrain(scene('158', 's1').s.tokens).map((p) => [p.height, p.blocksLos, p.providesProtection]), [[2, false, true]]);
}

// ---------- 1.1.1 Terrain: what "can see" means ----------
console.log('\n1.1.1 Terrain');
{
  // TM31RS / 539 Coordinated Observation: "targets that are visible to this
  // mech". A 2-inch piece between the observer and the target obstructs; it
  // does not hide. This demanded a fully clear line.
  const s = table();
  const observer = put(s, 's1', L({ torso: '539' }), 2, 2);
  const shooter = put(s, 's1', L(), 2, 8);
  const target = put(s, 's2', L(), 8, 2);
  const shot = { id: 'x', type: 'Firing', range: 12, name: { en: 'Shot' } };
  const low = [{ id: 'lw', type: 'low_wall', subCells: [{ col: 15, row: 6 }, { col: 15, row: 7 }, { col: 15, row: 8 }], height: 2, blocksLos: false, providesProtection: true, isFragile: false }];
  const high = [{ ...low[0], id: 'hw', type: 'high_wall', height: 3, blocksLos: true }];
  const guides = (terrain) => U.Un.missileGuidance(data, s.tokens, shooter, target, shot, { terrain }).map((t) => t.uid);
  check('the control: an open line lends the reroll', guides([]), [observer.uid]);
  check('a 2-inch wall in the line still lends it', [U.Ru.losBetween(observer, target, low, s.tokens), guides(low)], ['obstructed', [observer.uid]]);
  check('a 3-inch one hides the target', [U.Ru.losBetween(observer, target, high, s.tokens), guides(high)], ['blocked', []]);
  // The observer's own shot crosses the wall.
  const note = U.Ru.losNote(observer, target, shot, low, s.tokens, []);
  check('the sight note says what pays, not that the defender is paid',
    [/obstructed: 2" or taller terrain, or a Large unit/.test(note), /may claim/.test(note)], [true, false]);
}

// ---------- 1.3 Mines ----------
console.log('\n1.3 Mines');
{
  // One Movement Lays two Mines into one Grid: placed together, so neither
  // sets the other off. The second used to fire the first, by uid order.
  const s = freeTable();
  const layer = put(s, 's1', L({ backpack: '006' }), 1, 1);
  const walk = [G(1, 1), G(2, 1), G(3, 1)].map((p) => ({ col: p.col + 1, row: p.row + 1 }));
  const lay = (c, r, route) => ({ kind: 'layMine', seat: 's1', uid: layer.uid, actionId: '006_A', cardId: '074', to: { col: c * 3 + 1, row: r * 3 + 1 }, route });
  send(s, lay(2, 1, walk));
  send(s, lay(2, 1, walk));
  const mines = s.tokens.filter((x) => x.cardId === '074');
  const owed = () => U.Un.minesOwed(data, s.tokens).map((x) => x.uid).sort();
  check('two Mines one Movement Lays carry one batch', [mines.length, !!mines[0].mine.batch, mines[0].mine.batch === mines[1].mine.batch], [2, true, true]);
  check('so neither sets the other off', owed(), []);
  const back = U.Un.migrateState(JSON.parse(JSON.stringify(s)), data);
  check('the batch survives a save', back.tokens.find((x) => x.uid === mines[0].uid).mine.batch, mines[0].mine.batch);
  const other = JSON.parse(JSON.stringify(s));
  other.tokens.find((x) => x.uid === mines[0].uid).mine.batch = 'lay:elsewhere';
  check('and a board that disagrees about it does not fingerprint the same', U.boardFingerprint(s) === U.boardFingerprint(other), false);
  // A later Movement's Mine into the same Grid still sets off the ones there.
  send(s, lay(2, 1, [...walk].reverse()));
  check('a Mine a later Movement places there sets off both', owed(), mines.map((m) => m.uid).sort());

  // Placement: a small Ground Unit keeps clear of terrain. The Alley layout
  // fills Grid (6, 4) with a building.
  const alley = data.terrain.layouts.alley;
  const onTerrain = (p) => alley.some((q) => q.subCells.some((x) => x.col === p.col && x.row === p.row));
  check('a Grid terrain fills has no spot for a Mine', U.Ru.mineSpot(6, 4, alley), null);
  check('where the Aerial shortcut put it on the building', onTerrain(U.Ru.standingSpot(6, 4, 1, true, alley, [])), true);
  const walled = alley.find((q) => q.type !== 'building' && q.subCells.length === 3);
  const wg = { c: Math.floor(walled.subCells[0].col / 3), r: Math.floor(walled.subCells[0].row / 3) };
  const spot = U.Ru.mineSpot(wg.c, wg.r, alley);
  check('a Grid a wall crosses gives it a free cell', [!!spot, spot && onTerrain(spot), spot && Math.floor(spot.col / 3) === wg.c && Math.floor(spot.row / 3) === wg.r], [true, false, true]);
  const map = freeTable();
  map.map = 'alley';
  const layer2 = put(map, 's1', L({ backpack: '006' }), 5, 4);
  const onBuilding = { kind: 'layMine', seat: 's1', uid: layer2.uid, actionId: '006_A', cardId: '074', to: { col: 19, row: 13 } };
  check('the engine refuses a Mine on terrain', /cannot stand on terrain/.test(U.commandCheck(data, map, onBuilding).why ?? ''), true);
  check('and takes one on a free cell', U.commandCheck(data, map, { ...onBuilding, to: { col: 16, row: 13 } }).ok, true);

  // A landed Mine is not an Interception target on either board, and a Mine
  // on a Fragile Platform has entered it.
  check('Interception lists no landed Mine, on either board',
    [/!strictNow\(state\) && x\.aerial && !x\.mine && rangeBetween/.test(src('../src/main.ts')), /\(x\.aerial && !x\.mine && rangeBetween\(by, x\)/.test(src('../src/matchhud.ts'))], [true, true]);
  const plat = freeTable();
  const pm = droneOn(plat, 's2', '074', 0, 0, { col: 13, row: 13 });
  plat.environments = [{ card: 'fragile-platform', col: 4, row: 4 }];
  const events = U.Un.settleEnvironments(data, plat);
  check('a Mine placed on a Fragile Platform ends it, as a Ground Unit entering', [events.map((e) => [e.what, e.uid]), plat.environments ?? null], [[['collapse', pm.uid]], null]);
}

// ---------- 1.1.3 / 1.4.2 Containers ----------
console.log('\n1.1.3, 1.4.2 Containers');
{
  // A Container is a Neutral Unit: an "all Units" Explosion must take it and a
  // single-target one may leave it, so it no longer stops the PK3 staying.
  const main = src('../src/main.ts');
  const hud = src('../src/matchhud.ts');
  check('the PK3 stays unless a unit is in Range or it took a Container, on both boards',
    [/const stays = !legal\.length && !burst\.terrainHit && keptWithoutTarget\(action\);/.test(main),
      // Read in turn.ts detonationReading since 2026-10-01, which the panel
      // hands what its Detonation has done so far.
      /const stays = damaging && !!a && !legal\.length && !soFar\.terrainHit && keptWithoutTarget\(a\);/.test(turnSrc)
        && /turn\.detonationReading\(ctx\.data, s, detonateNow!\.uid, detonateNow!\.actionId, detonateNow!\)/.test(hud)], [true, true]);
  check('taking a Container spends it, on both boards',
    [/burst\.terrainHit = true;\n\s*startDetonation\(proj, actionId\);/.test(main), /if \(detonateNow\) detonateNow\.terrainHit = true;/.test(hud)], [true, true]);
  check('an "all Units" blast destroys every Container it caught, on both boards',
    [/const left = scope === 'all' \? terrain\.map\(\(x\) => x\.piece\.id\)/.test(main),
      /explosionScope\(a, ctx\.data\.actionTranslation\(a\.id\)\?\.english \?\? undefined\) === 'all'\) \{\n\s*const left = fragileTerrainWithin\(ctx, proj, a\.range \?\? 0\)/.test(hud)], [true, true]);
  const gm35 = card('074').actions.find((a) => a.id === '074_A');
  const pk3 = card('ZHAM-003').actions.find((a) => a.id === 'ZHAM-003_A');
  check('the GM-35 blast is an "all Units" one, the PK3 a single target it may keep',
    [U.Un.explosionScope(gm35, data.actionTranslation(gm35.id)?.english ?? undefined), U.Un.explosionScope(pk3, undefined), U.Un.keptWithoutTarget(pk3)], ['all', 'single', true]);

  // And in an attack (OTTO, 2026-09-30, "go with your suggestion"): a Container
  // in a Firing or Melee Action's reach and sight is a target, and Breakable
  // (3.1) destroys it with no roll. Omni-direction here, so the arc is moot.
  const range = table();
  const shooter = put(range, 's1', L(), 2, 2, { stance: 'offensive' });
  const gun0 = U.Un.tokenCards(data, shooter).flatMap((x) => x.card.actions ?? []).find((a) => a.type === 'Firing' && (a.range ?? 0) >= 2);
  const gun = { ...gun0, keywords: [...(gun0.keywords ?? []), { key: '全向', en: 'Omni-direction' }] };
  const piece = (id, type, gc, gr, fragile) => ({ id, type, subCells: [{ col: gc * 3 + 1, row: gr * 3 + 1 }], height: type === 'container' ? 1 : 2, blocksLos: false, providesProtection: !fragile, isFragile: fragile });
  const terrain = [piece('near', 'container', 3, 2, true), piece('far', 'container', 2 + (gun.range ?? 0) + 2, 2, true), piece('wall', 'low_wall', 2, 3, false)];
  check('a Firing Action may target a Container in its reach, never one past it, nor a wall',
    U.Un.containerTargets(data, range.tokens, terrain, shooter, gun, []).map((b) => b.id), ['near']);
  check('the attack lists offer them on both boards, and a pick destroys it with the attacker named',
    [/containerTargets\(data, s\.tokens, terrain, by, a, smoke\)/.test(turnSrc), /data-attackbox="\$\{esc\(b\.id\)\}"/.test(hud),
      /kind: 'destroyTerrain', seat: by\.side, uid: by\.uid, pieces: \[id\]/.test(hud),
      /containerTargets\(data, state\.tokens, currentTerrain\(\), attacker, act, state\.smoke \?\? \[\]\)/.test(main)],
    [true, true, true, true]);
  check('taking one off by hand asks first, as a house rule on a strict table, on both boards',
    [/title: 'Remove this terrain by hand\?'/.test(hud), /Removing one by hand, with no Action, is a house rule/.test(main)], [true, true]);
}

// ---------- 1.2 / 1.3 Control Zones ----------
console.log('\n1.2, 1.3 Control Zones');
{
  // "They cannot capture Task Targets or interact with Control Zones", shared
  // with every Deployable because of the Low Value Tag, so no Low Value unit in a
  // Zone contests it: OTTO ruled it for the rest of them too, 2026-09-30 ("low
  // value units can no longer block/contest zones").
  const zone = ['B2'];
  const at = (uid, side, extra) => ({ uid, side, kind: 'mech', stance: 'offensive', col: 4, row: 4, partStates: { torso: 'intact' }, ...extra });
  const mechIn = at(1, 's1', {});
  check('an enemy Barricade in the Zone contests nothing', U.controlOf(zone, [mechIn, at(2, 's2', { kind: 'projectile', aerial: false, barricade: true })]), 's1');
  check('nor an enemy Mine', U.controlOf(zone, [mechIn, at(3, 's2', { kind: 'projectile', aerial: true, mine: {} })]), 's1');
  check('nor an enemy Missile', U.controlOf(zone, [mechIn, at(4, 's2', { kind: 'projectile', aerial: true })]), 's1');
  check('while a Shutdown Mech, which is not Low Value, still does',
    U.controlOf(zone, [mechIn, at(5, 's2', { stance: 'shutdown' })]), null);
}

// ---------- 1.8 a full circle on the spot ----------
console.log('\n1.8 Turning on the spot');
{
  // "An in-place 360° rotation": it faces where it began, and it is no longer
  // Stationary. A free Movement (a Shock walk here) that only spun was not
  // recorded as Movement at all.
  const opp = (uid, over = {}) => ({ uid, timing: 'movement', extra: undefined, maneuver: 1, action: 2, extras: [], maneuvered: false, moved: false, started: false, overload: 0, performed: [], spentExtras: [], ...over });
  const s = table();
  const lancer = put(s, 's1', L({ rightHand: 'ZHRA-103' }), 4, 4, { stance: 'offensive', timing: 'melee' });
  s.script.opp = opp(lancer.uid, { timing: 'melee' });
  send(s, { kind: 'performAction', seat: 's1', uid: lancer.uid, actionId: 'ZHRA-103_A', partKey: 'ZHRA-103_A' });
  const stay = { kind: 'maneuver', seat: 's1', uid: lancer.uid, to: { col: lancer.col, row: lancer.row }, facing: lancer.facing, free: true, actionId: 'ZHRA-103_A' };
  const plain = JSON.parse(JSON.stringify(s));
  send(plain, stay);
  send(s, { ...stay, spun: true });
  check('a free Movement that turned a full circle is Movement; one that did nothing is not', [s.script.opp.moved, plain.script.opp.moved], [true, false]);
  check('the tabletop counts its turns, so a full circle can be confirmed',
    [/return !!t && \(t\.facing !== m\.facing0 \|\| Math\.abs\(m\.spin \?\? 0\) >= 4\);/.test(src('../src/main.ts')), /movePlan\.spin = \(movePlan\.spin \?\? 0\) \+ \(d === 1 \? 1 : -1\);/.test(src('../src/main.ts'))], [true, true]);
  // The pivot's command is built in turn.ts moveOrder since 2026-10-01; the
  // Match Centre sends it and says the full circle off the same reading.
  check('the Match Centre says so to the engine',
    [/const full = m\.facing === t\.facing && Math\.abs\(m\.spin\) >= 4;[\s\S]{0,300}\.\.\.\(full \? \{ spun: true \} : \{\}\)/.test(turnSrc),
      /const turned = ctx\.send\(order\.command\)\.ok;\s*\n\s*if \(turned\) ctx\.noteNow\(order\.full/.test(src('../src/matchhud.ts'))], [true, true]);

  // "That unit may not perform that action": the engine refuses an Action with
  // nothing to change, in the words the pages grey it with (ruled 2026-09-30,
  // OTTO). The RT-15/S Nimbus's System Cleanup takes a Square Token off an
  // Ally, so with none worn it has nothing to do.
  const c = table();
  const nimbus = put(c, 's1', L({ torso: '504' }), 4, 4, { stance: 'offensive', timing: 'tactical' });
  const ally = put(c, 's1', L(), 5, 4, { stance: 'offensive' });
  c.script.opp = opp(nimbus.uid, { timing: 'tactical' });
  const cleanup = { kind: 'performAction', seat: 's1', uid: nimbus.uid, actionId: '504_B', partKey: '504_B' };
  const refused = U.commandCheck(data, c, cleanup);
  ally.statuses = ['fragile'];
  check('in the engine too: a System Cleanup with no Square Token on any Ally is refused, with one it is not',
    [refused.ok, /wears a Square Token/.test(refused.why ?? ''), U.commandCheck(data, c, cleanup).ok], [false, true, true]);
  check('every Action is asked, not only Reveal and Scan',
    /const idle = actionIdleWhy\(data, t, a, \{\n\s*tokens: state\.tokens,/.test(src('../src/commands.ts')), true);
}

// ---------- 3.8 Assault X ----------
console.log('\n3.8 Assault X');
check('any unit may make the move; a Mech needs its Chassis',
  [U.Un.shockMoveAllowed({ kind: 'drone', partStates: {} }), U.Un.shockMoveAllowed({ kind: 'mech', partStates: { chasis: 'destroyed' } })], [true, false]);
check('the walk is "up to X": the ceiling is X, not the Maneuver Value',
  /const x = shockAttackOf\(grantAdjusted\(a, t, o\?\.uid === t\.uid \? o : null\)\);\n\s*return x > 0 \? x : base;/.test(src('../src/commands.ts')), true);

// ---------- 1.11 Tactic Cards: hidden until played ----------
console.log('\n1.11 Tactic Cards');
{
  // The real squad panel, drawn into the test DOM. s2 holds three cards and
  // used one in round 1; the table is in round 2.
  const tr = new U.SquadTracker(data, makeEl('div'), new Proxy({}, { get: () => () => {} }));
  tr.state = {
    v: 3, tokens: [], nextUid: 1, round: { n: 2, phase: 2, firstPlayer: 's1' },
    tactics: { s1: ['274', '275'], s2: ['276', '277', '278'] }, tacticsPlayed: { s1: [], s2: ['1:277'] },
    script: { ...U.newScriptState('s1') },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
  };
  const names = (side) => textOf(tr.tacticsBlock(side));
  U.setLocalSeat('s1');
  try {
    const theirs = names('s2');
    check('in a room the other squad shows the card it has used', theirs.includes('System Repair'), true);
    check('and only a count for the rest', [theirs.includes('2 hidden until played'), theirs.includes('Hit and Run'), theirs.includes('Tactical Disposition')], [true, false, false]);
    check('a seat still sees its own hand', names('s1').filter((x) => x === 'Play').length, 2);
  } finally {
    U.setLocalSeat(null);
  }
  check('at one table both hands show, as before', ['Hit and Run', 'System Repair', 'Tactical Disposition'].every((n) => names('s2').includes(n)), true);
  check('the play guide lists only the local seat\'s hand in a room',
    /const me = getLocalSeat\(\);\n\s*for \(const side of \['s1', 's2'\] as const\) \{\n\s*if \(me && side !== me\) continue;/.test(src('../src/playguide.ts')), true);
  check('and the Add tab ticks only the local seat\'s cards',
    /heldTactics: \(\) => \{\n\s*const me = getLocalSeat\(\);\n\s*const mine = \(side: Side\): string\[\] => \(!me \|\| me === side \? handIds\(state, side, handRoom\) : \[\]\);/.test(src('../src/main.ts')), true);
}

// ---------- the Reference: glossary, Rules entries and their changelogs ----------
console.log('\nThe Reference');
{
  const kw = (name) => data.keyword(name);
  check('Assault X is a second name for Shock Attack X, with or without its number',
    [kw('Assault X')?.key, kw('Assault 1')?.key, kw('Shock Attack 1')?.key], ['冲锋X', '冲锋X', '冲锋X']);
  check('and its text says up to X, and that only the move needs the Chassis',
    [/move up to X Grids/.test(kw('Shock Attack X').en.value), /may still perform the Action/.test(kw('Shock Attack X').en.value), /require a chasis/.test(kw('Shock Attack X').en.value)], [true, true, false]);
  check('Cleaving and Scatter-shot say the repeat is rerolled and ANY cannot pick it',
    ['Cleaving', 'Scatter-shot'].map((n) => /rerolled, and on ANY that Part cannot be chosen/.test(kw(n).en.value)), [true, true]);
  check('the Turtle Shell is 2-inch cover for anyone, with no ally condition left',
    [/2 inches high/.test(kw('Mobile Cover').en.value), /another Ally Unit/.test(kw('Mobile Cover').en.value), /another Ally Unit/.test(kw('Barricade').en.value)], [true, false, false]);
  check('Barricade is the Deployable category now, a banner tag',
    [/^Deployable subtype tag on the card banner/.test(kw('Barricade').en.value), /Turtle Shell 2/.test(kw('Barricade').en.value)], [true, true]);
  check('and its sheet lists no stance Action that merely shares the name',
    /data-card="045"/.test(U.R.keywordDetail('Barricade') ?? ''), false);
  check('the two new tags are in the glossary', [kw('Breakable')?.key, kw('Transformation')?.key], ['Breakable', 'Transformation']);
  check('the Mine and Deployable tags say what 1.3 and 1.2 add',
    [/never set each other off/.test(kw('Mine').en.value), /interact with Control Zones/.test(kw('Deployable').en.value)], [true, true]);
  // Every glossary entry 1.04 changed carries its line, under the text.
  const changedKw = ['Dense Armor', 'Shock Attack X', 'Cleaving', 'Scatter-shot', 'Barricade', 'Mobile Cover', 'Wall', 'Deployable', 'Mine', 'Breakable', 'Transformation'];
  check('each changed glossary entry shows its Changelog', changedKw.filter((n) => !/<details class="ref-log">[\s\S]*?1\.04/.test(U.R.keywordDetail(n) ?? '')), []);

  // The Rules entries: the short view, the Advanced text, and the tag.
  const entry = (id) => data.mechanics.find((m) => m.id === id);
  const has = (id, re) => re.test([entry(id).basic, ...(entry(id).points ?? []), entry(id).text].join('\n'));
  check('Mines: laid together, and clear of terrain',
    [has('mines', /Mines one Action places never set each other off/), has('mines', /cannot stand on terrain/), has('mines', /Interception may not/)], [true, true, true]);
  check('Surplus Damage: a different Part', has('surplus_damage', /ANY cannot pick it/), true);
  check('Tactics Cards: hidden until played', has('tactics_cards', /hidden until played/), true);
  check('Low Value Units: none blocks a Zone', has('low_value_unit', /does not stop the other side taking it/), true);
  check('The Maneuver: a full circle', has('maneuver', /a full circle included/), true);
  check('Detonation: the Containers', has('detonation', /Containers are Neutral/), true);
  check('no Rules text calls a Container terrain any more',
    data.mechanics.filter((m) => /Breakable Terrain|Destructible Terrain/.test([m.basic, ...(m.points ?? []), m.text].join(' '))).map((m) => m.id), []);
  const tagged = ['mines', 'surplus_damage', 'tactics_cards', 'low_value_unit', 'maneuver', 'detonation']
    .filter((id) => !/<summary>Advanced <span class="mech-adv-new">Updated 1\.04<\/span><\/summary>/.test(U.R.mechanicBody(entry(id))));
  check('each changed Rules entry says so on its closed Advanced', tagged, []);
  check('and cites the Supplement', ['mines', 'surplus_damage', 'tactics_cards', 'low_value_unit', 'maneuver', 'detonation', 'tether', 'white_dwarf']
    .filter((id) => !/Supplementary Rules 1\.04/.test(entry(id).ref)), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

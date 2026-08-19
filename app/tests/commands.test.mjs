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
const loopSrc = readFileSync(new URL('../src/loop.ts', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const smokeRules = rules.slice(rules.indexOf('export function smokeKey'), rules.indexOf('export function smokeBlocks'));
// interceptCapacity and consumesCharge are pure, so they are sliced in rather
// than stubbed: a mirror of those keyword regexes here could drift from the
// ones the app really reads.
const interceptParser = unitsSrc.slice(
  unitsSrc.indexOf('export function interceptCapacity'),
  unitsSrc.indexOf('// Every card id currently on the board'),
);
if (!interceptParser) throw new Error('could not locate interceptCapacity in units.ts');
// Starts at CHARGE_KEYWORD, not at the function: the regex is a module-level
// const just above it and slicing from the export leaves it undefined.
const chargeParser = unitsSrc.slice(
  unitsSrc.indexOf('const CHARGE_KEYWORD'),
  unitsSrc.indexOf('export function isChargeAction'),
);
if (!chargeParser) throw new Error('could not locate consumesCharge in units.ts');
// electronicValue reads the stubbed tokenCards, so slicing it in keeps the
// Electronic Value rule (Parts only, destroyed Parts excluded) in one place.
const evReader = unitsSrc.slice(
  unitsSrc.indexOf('export function electronicValue'),
  unitsSrc.indexOf('export function defaultUnitLabel'),
);
if (!evReader) throw new Error('could not locate electronicValue in units.ts');
// takeBlackBox asks freehandSlots which Parts can carry one, so the Freehand
// keyword test is sliced rather than mirrored. SLOT_LABEL rides along because
// it is a module-level const the function reads.
// The Data Link riders are sliced in, not stubbed: the A2 gate is a RULE and
// commands.test.mjs is where rules are pinned. They read the stubbed tokenCards
// above, which is enough for these fixtures.
const riders = unitsSrc.slice(
  unitsSrc.indexOf('export interface CommandRider'),
  unitsSrc.indexOf('export interface ParryPart'),
);
if (!riders) throw new Error('could not locate the Data Link riders in units.ts');
// Sliced, not stubbed: whether a launch COMMITS a lock_one Action is a rule and
// commands.ts's apply is where it is enforced. Checked first that no existing
// cut in this file already spans it — the sixth time that trap was considered.
const covert = unitsSrc.slice(
  unitsSrc.indexOf('export function covertCarryLock'),
  unitsSrc.indexOf('// The launch list a lock_one Action'),
);
if (!covert) throw new Error('could not locate covertCarryLock in units.ts');
// targetTracingOn needs NO slice of its own: it sits inside the range
// interceptParser already takes, so adding one declares it twice. Fourth time
// this trap has bitten -- check every existing slice's range before adding.
const slotLabels = unitsSrc.slice(
  unitsSrc.indexOf('export const SLOT_LABEL'),
  unitsSrc.indexOf('let uidSource'),
);
if (!slotLabels) throw new Error('could not locate SLOT_LABEL in units.ts');
const freehand = unitsSrc.slice(
  unitsSrc.indexOf('export function freehandSlots'),
  unitsSrc.indexOf('// ---------- Charge (rulebook 4.14) ----------'),
);
if (!freehand) throw new Error('could not locate freehandSlots in units.ts');
// Card 547's Attack Mode reader. Sliced rather than mirrored so the gate the
// command applies is driven by the card's OWN structured effect, read by the
// real function — a mirror could invent a requiredStance the data never had.
// It sits between resupplyOf and ExtraActivation, which is outside every other
// range cut from units.ts in this file; check that before moving it, because a
// function landing inside an existing range gets declared twice.
const attackMode = unitsSrc.slice(
  unitsSrc.indexOf('// ---------- Attack Mode (H2-B "Crisis" II, card 547) ----------'),
  unitsSrc.indexOf('export interface ExtraActivation'),
);
if (!attackMode) throw new Error('could not locate the Attack Mode reader in units.ts');
// layMine's check asks whether the Action really Lays, and that reading is a
// regex over the card's own wording — mirroring it here could drift from the
// one the app applies, which is the whole point of the check.
const delivery = unitsSrc.slice(
  unitsSrc.indexOf('export function projectileDelivery'),
  unitsSrc.indexOf('// The Interception attempts'),
);
if (!delivery) throw new Error('could not locate projectileDelivery in units.ts');
// Prototype Blink's check asks blinkTargets who is a legal partner, and every
// clause of that answer is a rule (ground, same size, Mech, in range). Sliced,
// not stubbed, for the same reason: a mirror could pass while the app refuses.
// isFlyingBase comes from data.ts and rangeBetween/largeGridOf from rules.ts,
// so the Manhattan reach the check applies is the real one.
const dataSrc = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
const grids = rules.slice(rules.indexOf('export function largeGridOf'), rules.indexOf('// Where inside Large Grid'))
  + rules.slice(rules.indexOf('export function rangeBetween'), rules.indexOf('export function inArc'))
  // placeInGrid's legality is spotsInGrid's, so the real one is sliced in
  // rather than mirrored — a second copy of the occupancy rule would drift.
  + rules.slice(rules.indexOf('export function spotsInGrid'), rules.indexOf('interface MoveSearch'));
const flyingBase = dataSrc.slice(dataSrc.indexOf('export function isFlyingBase'), dataSrc.indexOf('export function isAerial'));
const ground = unitsSrc.slice(unitsSrc.indexOf('export function isGroundUnit'), unitsSrc.indexOf('export function minesOwed'));
const blinking = unitsSrc.slice(unitsSrc.indexOf('// Which Moving Actions are a position SWAP'), unitsSrc.indexOf("// ---------- The Hyena"));
if (!grids || !flyingBase || !ground || !blinking) throw new Error('could not locate the blink helpers');
// Tether X (PDLH-202). Sliced, not mirrored, for the usual reason: apply()
// sweeps the chips after EVERY command and check() refuses a Maneuver that
// would break the leash, so both are command-layer rules and this is where
// command-layer rules are pinned. Four small cuts, all checked against every
// other range this file already takes:
//   * data.ts isModeFace..zeroCostReason — the face index and what may become
//     what. Sits between isDiscardCard and unitSize, outside the isFlyingBase
//     cut below and outside camo/mines' cuts of the same file.
//   * units.ts PART_SLOTS..SLOT_LABEL — butts up against `slotLabels` above
//     without overlapping it (that one STARTS at SLOT_LABEL).
//   * units.ts the Tether block itself, at the bottom of the file above
//     legacyZoneSet, inside no other range.
const faces = dataSrc.slice(
  dataSrc.indexOf('export function isModeFace'),
  dataSrc.indexOf('export function zeroCostReason'),
);
const partSlots = unitsSrc.slice(
  unitsSrc.indexOf('export const PART_SLOTS'),
  unitsSrc.indexOf('export const SLOT_LABEL'),
);
const tethering = unitsSrc.slice(
  unitsSrc.indexOf('// ---------- runtime Part faces and Tether X'),
  unitsSrc.indexOf('function legacyZoneSet'),
);
const meleeSrc = readFileSync(new URL('../src/melee.ts', import.meta.url), 'utf8');
const leash = meleeSrc.slice(meleeSrc.indexOf('// ---------- Tether X'));
if (!faces || !partSlots || !tethering || !leash) throw new Error('could not locate the Tether machinery');
const timings = types.slice(types.indexOf('export const PHASES'), types.indexOf('export type TokenShape'));
const statuses = types.slice(types.indexOf('export function hexagonIds'), types.indexOf('export interface RoundState'));
const tmp = new URL('./_commands.slice.ts', import.meta.url);
// tokenCards and maxLink are mirrored minimally rather than sliced from
// units.ts, whose import graph drags in the whole app. The mirrors only feed
// fixtures these tests control.
const stubs = `
// Flexible Timing reaches a Mech from an ally's AURA, which needs the whole
// board. These fixtures have no aura sources, so the honest stub is "never" —
// the adjacency rule itself is covered properly in ticks.test.mjs.
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
export function makeDroneToken(state: any, data: any, card: any, side: any, backpack?: string): any {
  return {
    uid: state.nextUid++, side, kind: card.category === 'projectile' ? 'projectile' : 'drone',
    cardId: card.id, droneBackpack: backpack, label: card.id, size: 1, aerial: false, stance: 'offensive',
    partStates: { main: 'intact', ...(backpack ? { backpack: 'intact' } : {}) }, ammo: {},
  };
}
export function repeatersFor(data: any, tokens: any[], t: any): any[] {
  const grid = (x: any) => ({ c: Math.floor(x.col / 3), r: Math.floor(x.row / 3) });
  const apart = (a: any, b: any) => Math.abs(grid(a).c - grid(b).c) + Math.abs(grid(a).r - grid(b).r);
  return tokens.filter((r: any) => r.uid !== t.uid && r.side === t.side && r.deployed !== false
    && (r.partStates?.main ?? 'intact') !== 'destroyed'
    && data.byId.get(r.cardId)?.repeater
    && apart(t, r) <= (data.byId.get(r.cardId)?.repeaterRange ?? 0));
}
export function electronicOrigins(data: any, tokens: any[], t: any): any[] {
  return [t, ...repeatersFor(data, tokens, t)];
}
export function loanedParts(data: any, tokens: any[], t: any): any[] {
  if (t.kind !== 'mech') return [];
  const touch = (a: any, b: any): boolean => {
    const gapX = Math.max(a.col - (b.col + b.size), b.col - (a.col + a.size));
    const gapY = Math.max(a.row - (b.row + b.size), b.row - (a.row + a.size));
    if (gapX < 0 && gapY < 0) return true;
    return (gapX === 0 && gapY < 0) || (gapY === 0 && gapX < 0);
  };
  return tokens
    .filter((d: any) => d.uid !== t.uid && d.side === t.side && d.deployed !== false && d.droneBackpack
      && (d.partStates?.main ?? 'intact') !== 'destroyed'
      && (d.partStates?.backpack ?? 'intact') !== 'destroyed'
      && data.byId.get(d.cardId)?.carrier && touch(t, d))
    .map((d: any) => ({ slot: 'load:' + d.uid, card: data.byId.get(d.droneBackpack), from: d }))
    .filter((x: any) => !!x.card);
}
// The magazine top-up a transformed Part gets. Its own rule — a face arrives
// full, a spent count stays spent — belongs to ammo.test.mjs; what matters here
// is that transformPartOn calls it, so the honest stub records the call.
// Display, not a rule: it only ever reaches a refusal message.
export function cardName(c: any): string { return c?.name?.en ?? c?.id ?? '?'; }
export const synced: string[] = [];
export function syncMagazines(_data: any, t: any): void { synced.push(String(t.uid)); }
export function unfoldsInto(c: any): any { return c?.unfoldsInto; }
export function unfoldToken(state: any, data: any, t: any, into: any): void {
  Object.assign(t, {
    cardId: into.id, kind: into.category === 'projectile' ? 'projectile' : 'drone',
    label: into.id, size: 1, aerial: false, stance: into.stance ?? 'offensive',
    partStates: { main: 'intact' }, ammo: {},
  });
}
export function newOpportunity(uid: number, timing?: any): any {
  return { uid, timing, extra: undefined, maneuver: 1, action: 2, extras: [], maneuvered: false, moved: false, started: false, overload: 0, performed: [], spentExtras: [] };
}
export function extrasFor(data: any, t: any): any[] {
  const have = new Set(tokenCards(data, t).flatMap((x: any) => (x.card.actions ?? []).map((a: any) => a.id)));
  return (data.extraTicks ?? []).filter((g: any) => have.has(g.actionId)).map((g: any) => ({ id: g.actionId, label: g.label, timing: g.timing, check: g.check }));
}
export function makeMechToken(state: any, data: any, loadout: any, side: any, name?: string): any {
  const partStates: any = {};
  const ammo: any = {};
  for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack']) {
    if (loadout[slot]) partStates[slot] = 'intact';
  }
  for (const id of Object.values(loadout)) {
    for (const a of (data.byId.get(id)?.actions ?? [])) if ((a.storage ?? 0) > 0) ammo[a.id] = a.storage;
  }
  const pilot = loadout.pilot ? data.byId.get(loadout.pilot) : undefined;
  return {
    uid: state.nextUid++, side, kind: 'mech', cardId: loadout.torso ?? '', mech: loadout,
    label: name ?? 'Mech', size: 3, aerial: false, stance: 'offensive',
    link: pilot?.LV ?? 3, partStates, ammo,
  };
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
    + loopSrc.replace(/^import[^\n]*\n/gm, '')
    + smokeRules
    + ticks.replace(/^import[^\n]*\n/gm, '')
    + interceptParser
    + chargeParser
    + evReader
    + slotLabels + riders + covert
    + freehand
    + attackMode
    + delivery
    + grids
    + flyingBase
    + ground
    + blinking
    + faces
    + partSlots
    + stubs
    // After the stubs: the Tether block reads the stubbed tokenCards and
    // syncMagazines, and a function hoists but a `const` stub does not.
    + tethering
    + leash
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
  uid, side, kind: 'mech', stance: 'offensive', label: `M${uid}`, col: 3, row: 3, facing: 0, size: 3,
  mech: { torso: 'T1', pilot: 'P1' }, partStates: { torso: 'intact' }, ...extra,
});
const opp = (uid, over = {}) => ({
  uid, timing: 'firing', maneuver: 1, action: 2, extras: [], maneuvered: false,
  moved: false, started: false, overload: 0, performed: [], spentExtras: [], ...over,
});
const world = (tokens, phase = 1, o = null) => ({
  tokens,
  round: { n: 1, phase, firstPlayer: 's1' },
  script: { opp: o, oppStack: [], acted: [], extraOpps: [], commanded: [], freeCommand: [], passed: [], turn: 's1', endDone: [], commits: {}, revealed: [] },
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
    ['T5', { id: 'T5', actions: [fire, { id: 'I2', type: 'Passive', name: { en: 'CIWS' }, range: 2, keywords: [{ inline: '拦截2' }] }] }],
    ['T6', { id: 'T6', actions: [{ id: 'C1', type: 'Firing', size: 's', name: { en: 'Charged Shot' }, keywords: [{ inline: '充能' }] }] }],
    ['EW1', { id: 'EW1', electronic: 5, actions: [{ id: 'EWA', type: 'Firing', size: 's', range: 4, name: { en: 'Fire Control Interference' }, keywords: [{ en: 'Electronic Attack' }] }] }],
    ['EW2', { id: 'EW2', electronic: 3, actions: [] }],
    ['D1', { id: 'D1', actions: [] }],
    // A Mine Layer Backpack and the Mine it Lays: "Lay" in the Action name is
    // what projectileDelivery reads to tell Laying from a Launch.
    ['ML1', { id: 'ML1', projectile: ['MN1'], actions: [{ id: 'LAY1', type: 'Passive', name: { en: 'Auto Mine Laying' }, range: 0 }] }],
    // The Taurus core: Prototype Blink is typed Moving and reads as a position
    // exchange, which is how it is told apart from an ordinary Sprint.
    ['TAU', { id: 'TAU', actions: [{ id: 'BLINK', type: 'Moving', size: 'm', range: 4, name: { en: 'Prototype Blink' }, description: { en: '· The Unit may exchanges positions with one Ground Mech Unit of the same size within its range.' } }] }],
    ['MN1', { id: 'MN1', category: 'projectile', actions: [] }],
    // Freehand is what lets a Part carry a Black Box (5.3.1).
    ['FH1', { id: 'FH1', actions: [], keywords: [{ en: 'Freehand' }] }],
    // Two of the six Tactics Cards, which are held in hand rather than deployed.
    ['274', { id: '274', category: 'tactics_or_upgrade', score: 30, actions: [] }],
    ['275', { id: '275', category: 'tactics_or_upgrade', score: 30, actions: [] }],
    ['P1', { id: 'P1', LV: 4 }],
    // A Harpoon and its Tether Mode face: ONE physical card, so throwIndex
    // names the far side and the price tells a derived face from a build
    // choice. HARP2 fits the same slot and is related to nothing, which is what
    // separates "same card" from "same shape" in the transform check.
    ['HARP', { id: 'HARP', category: 'mech_part', type: 'leftHand', score: 54, name: { en: 'Harpoon' }, throwIndex: 'HARP-T', actions: [] }],
    ['HARP-T', { id: 'HARP-T', category: 'mech_part', type: 'leftHand', score: 0, name: { en: 'Harpoon (Tether Mode)' }, actions: [] }],
    ['HARP2', { id: 'HARP2', category: 'mech_part', type: 'leftHand', score: 40, name: { en: 'Other Arm' }, actions: [] }],
    // A Carrier Tarantula and the Backpacks it lends (FAQ O3-O8/O16-O18).
    ['CAR', { id: 'CAR', category: 'drone', carrier: true, actions: [] }],
    ['REP', { id: 'REP', category: 'drone', repeater: true, repeaterRange: 6, actions: [] }],
    ['BP1', { id: 'BP1', category: 'mech_part', type: 'backpack', electronic: 1, actions: [{ id: 'BP1_A', type: 'Firing', size: 's', range: 4, name: { en: 'Lent Gun' }, storage: 2 }] }],
    // A second lendable Backpack, this one a LAUNCHER. Separate from BP1 rather
    // than a second Action on it, because BP1 doubles as an inert Torso in two
    // later fixtures and giving it another Action couples them to this one.
    ['BP2', { id: 'BP2', category: 'mech_part', type: 'backpack', actions: [{ id: 'BP2_L', type: 'Projectile', size: 'm', range: 4, name: { en: 'Lent Launcher' }, storage: 2 }] }],
    // The folded Pholcus and the Drone it is replaced by (FAQ M18).
    ['156', { id: '156', category: 'projectile', unfoldsInto: '167', actions: [{ id: '156_A', type: 'Delay', name: { en: 'Unfold' } }] }],
    // A Torso whose Data Link carries the A2 rider. The wording is the card's
    // own, misspelling included, so the matcher is tested against reality.
    ['A2T', { id: 'A2T', category: 'mech_part', actions: [{ id: 'A2T_A', type: 'Passive', speed: 'passive', name: { en: 'A2 Data Link' },
      description: { en: '· Command Generation 2 · When recieving Command from this Mech, the Ally Drone may perform Automatic Actions instead of Command Actions.' } }] }],
    ['M2T', { id: 'M2T', category: 'mech_part', actions: [{ id: 'M2T_A', type: 'Passive', speed: 'passive', name: { en: 'M2 Data Link' },
      description: { en: '· Command Generation 2 · When receiving Command from this Mech, the Ally Drone may move 1 grid before performing Actions.' } }] }],
    ['167', { id: '167', category: 'drone', stance: 'mobility', score: 0, actions: [{ id: '167_A', type: 'Detonation', speed: 'auto', range: 1, yellowDice: 6, name: { en: 'Automatic Attack' } }] }],
  ]),
  commonActions: [{ id: 'COMMON_CHARGE', type: 'Tactic', size: 's', name: { en: 'Charge' } }],
  overload: [{ actionId: '090_A', card: '090', label: 'Overload' }],
  zoneData: { zones: [] },
  secondary: [
    { id: 'SEC1', name: 'Recon' },
    { id: 'decapitation', name: 'Behead', designate: 'enemy-own-mech' },
    { id: 'bounty-hunt', name: 'Bounty Hunt', designate: 'enemy-mech' },
    { id: 'escort', name: 'Escort', designate: 'own-mech' },
    { id: 'annihilation', name: 'Annihilation', designate: 'none' },
  ],
};
// transformFaces builds its index off the whole array, the way data.ts does at
// runtime, so the fixture has to offer one as well as the id map.
data.cards = [...data.byId.values()];

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

// ---------- the round track ----------

const ap = () => ({ kind: 'advancePhase', seat: 's1' });
const wadv = world([mech(1, 's1')], 4);
C.apply(data, wadv, ap());
check('a phase advance steps forward', wadv.round.phase, 5);
wadv.tokens[0].timing = 'firing';
wadv.tasks = { items: [{ kind: 'terminal', accessed: 's1' }, { kind: 'blackbox', accessed: 's2' }] };
C.apply(data, wadv, ap());
check('the End Phase wraps to a new round', [wadv.round.n, wadv.round.phase, wadv.round.firstPlayer], [2, 0, 's2']);
check('which clears the dials', wadv.tokens[0].timing, undefined);
check('and flips Terminals face-up, leaving Black Boxes alone', [wadv.tasks.items[0].accessed, wadv.tasks.items[1].accessed], [null, 's2']);
check('and empties both Command Token pools', wadv.commandTokens, { s1: 0, s2: 0 });
const wsetup = world([mech(1, 's1')]);
wsetup.setup = { stage: 'deploy', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } };
check('no advancing past an unfinished setup', C.check(data, wsetup, ap()).ok, false);
check('a made-up phase is refused', C.check(data, world([]), { kind: 'setPhase', seat: 's1', phase: 9 }).ok, false);
const wjump = world([]);
C.apply(data, wjump, { kind: 'setPhase', seat: 's1', phase: 3 });
check('a phase jump lands', wjump.round.phase, 3);
const wres = world([], 4);
wres.round.n = 3;
wres.tacticsPlayed = { s1: ['2:274'], s2: [] };
C.apply(data, wres, { kind: 'resetRounds', seat: 's1' });
check('the reset rewinds the track', [wres.round.n, wres.round.phase], [1, 0]);
check('and unstamps the played cards', wres.tacticsPlayed, { s1: [], s2: [] });
const wtok = world([]);
check('spending from an empty pool is refused', C.check(data, wtok, { kind: 'adjustCommandTokens', seat: 's1', pool: 's1', delta: -1 }).ok, false);
C.apply(data, wtok, { kind: 'adjustCommandTokens', seat: 's1', pool: 's1', delta: 2 });
C.apply(data, wtok, { kind: 'adjustCommandTokens', seat: 's1', pool: 's1', delta: -1 });
check('token adjustments accumulate', wtok.commandTokens.s1, 1);

// ---------- the guided loops ----------

const eo = (over = {}) => ({ kind: 'endOpportunity', seat: 's1', uid: 1, ...over });
check('ending needs the open opportunity', C.check(data, world([mech(1, 's1')], 2), eo()).ok, false);
const wend = world([mech(1, 's1')], 2, opp(1));
check('with it open it passes', C.check(data, wend, eo()).ok, true);
C.apply(data, wend, eo());
check('a normal opportunity records the mech as acted', [wend.script.acted, wend.script.opp], [[1], null]);
const wex = world([mech(1, 's1')], 2, opp(1));
wex.script.acted = [1];
wex.script.extraOpps = [1];
C.apply(data, wex, eo());
check('an extra opportunity spends the grant instead', [wex.script.acted, wex.script.extraOpps], [[1], []]);

const dg = (over = {}) => ({ kind: 'designate', seat: 's1', uid: 2, ...over });
const wcmd = () => {
  // The pool is a readout of the face-up Command Tokens the Mechs are holding
  // (4.15), so it is staged by giving Mechs their tokens rather than by setting
  // the number. Setting the number alone used to "work" and described a board
  // that cannot exist: two Commands owned by nobody, and a side whose only
  // unit was a Drone somehow holding one. s2 needs a Mech of its own here or it
  // can never take its turn in the Command Phase.
  const w = world([mech(1, 's1'), drone(2, 's1'), drone(3, 's2'), mech(4, 's2')], 0);
  w.tokens[0].statuses = ['command', 'command'];
  w.tokens[3].statuses = ['command'];
  w.commandTokens = { s1: 2, s2: 1 };
  return w;
};
check('designating out of turn is refused', C.check(data, wcmd(), dg({ seat: 's2', uid: 3 })).ok, false);
check('a mech is never designated in the Command Phase', C.check(data, wcmd(), dg({ uid: 1 })).ok, false);
check('on turn with a drone it passes', C.check(data, wcmd(), dg()).ok, true);
const wc1 = wcmd();
C.apply(data, wc1, dg());
check('a Command designation spends the token', [wc1.commandTokens.s1, wc1.script.commanded], [1, [2]]);
check('and the turn alternates', wc1.script.turn, 's2');

// ---------- who Commanded this Drone ----------
//
// A Command Token on a Drone records nothing about where it came from, but
// several cards are worded "when receiving Command from THIS Mech" — the A2
// Data Link (Automatic Actions) and the M2 (a grid of movement first). So the
// issuer is remembered on the Drone, cleared when the End Phase sweeps the
// tokens, and carried in the board fingerprint because check() will read it.

check('the Drone remembers which Mech Commanded it', wc1.tokens[1].commandedBy, 1);
// fromUid names the Mech explicitly; without one the fullest Mech pays.
const wcmdNamed = wcmd();
wcmdNamed.tokens.push({ ...wcmdNamed.tokens[0], uid: 5, statuses: ['command'] });
C.apply(data, wcmdNamed, dg({ fromUid: 5 }));
check('and it remembers the one that was NAMED', wcmdNamed.tokens.find((t) => t.uid === 2).commandedBy, 5);
// Command Coordination hands one out mid-round; same record.
const wcmdCoord = wcmd();
C.apply(data, wcmdCoord, { kind: 'coordinateCommand', seat: 's1', uid: 1, targetUid: 2 });
check('a Coordinated Command is remembered too', wcmdCoord.tokens[1].commandedBy, 1);
// 3.7.2 takes every Command Token in the End Phase, and the record goes with it.
const wcmdSweep = wcmd();
C.apply(data, wcmdSweep, dg());
check('the record exists before the sweep', wcmdSweep.tokens[1].commandedBy, 1);
C.clearCommandTokens(wcmdSweep);
check('and is gone after it', wcmdSweep.tokens[1].commandedBy, undefined);

// ---------- A2 Data Link: the Commanded Drone may act Automatically ----------
//
// The Command Phase normally refuses a Drone's Automatic Action (3.2.2/3.5).
// "When receiving Command from this Mech, the Ally Drone may perform Automatic
// Actions instead of Command Actions" relaxes that — but only for a Drone
// Commanded BY a Mech carrying the rider, which is why commandedBy exists.

const autoAct = { id: '167_A', speed: 'auto', type: 'Detonation' };
const paAuto = { kind: 'performAction', seat: 's1', uid: 2, actionId: '167_A' };
const wa2 = (commandedBy) => {
  const w = world([
    mech(1, 's1', { mech: { torso: 'A2T', pilot: 'P1' } }),
    { ...drone(2, 's1', { cardId: '167' }), commandedBy },
  ], 0, opp(2));
  return w;
};
check('an Automatic Action is refused in the Command Phase',
  C.check(data, wa2(undefined), paAuto).ok, false);
check('and the refusal cites the Automatic Phase',
  (C.check(data, wa2(undefined), paAuto).why ?? '').includes('Automatic Phase'), true);
check('a Drone Commanded by the A2 Mech may perform it',
  C.check(data, wa2(1), paAuto).ok, true);
// The rider is read off the ISSUER, so a Command from a Mech without one
// changes nothing.
const wPlain = world([
  mech(1, 's1', { mech: { torso: 'T1', pilot: 'P1' } }),
  { ...drone(2, 's1', { cardId: '167' }), commandedBy: 1 },
], 0, opp(2));
check('a Command from a Mech with no rider does not',
  C.check(data, wPlain, paAuto).ok, false);



const wfree2 = wcmd();
wfree2.commandTokens = { s1: 0, s2: 1 };
wfree2.script.freeCommand = [2];
C.apply(data, wfree2, dg());
check('a free Command spends the card instead', [wfree2.commandTokens.s1, wfree2.script.freeCommand, wfree2.script.commanded], [0, [], [2]]);
const wauto = world([drone(2, 's1'), drone(3, 's2')], 3);
C.apply(data, wauto, dg());
check('an Automatic designation just records the act', [wauto.script.acted, wauto.script.turn], [[2], 's2']);

check('a pass outside the loop phases is refused', C.check(data, world([], 2), { kind: 'passTurn', seat: 's1' }).ok, false);
const wpass = world([drone(2, 's1'), drone(3, 's2')], 3);
C.apply(data, wpass, { kind: 'passTurn', seat: 's1' });
check('a pass sits the squad out and hands the turn over', [wpass.script.passed, wpass.script.turn], [['s1'], 's2']);
check('passing twice is refused', C.check(data, wpass, { kind: 'passTurn', seat: 's1' }).ok, false);

const ge = (over = {}) => ({ kind: 'grantExtra', seat: 's1', uid: 1, linkCost: 1, ...over });
check('a grant the mech cannot pay for is refused', C.check(data, world([mech(1, 's1', { link: 0 })]), ge()).ok, false);
const wge = world([mech(1, 's1', { link: 3 })]);
C.apply(data, wge, ge());
check('Coordinate pays the Link and opens the extra opportunity NOW (K21)',
  [wge.tokens[0].link, wge.script.opp?.uid, wge.script.opp?.extra, wge.script.extraOpps], [2, 1, true, []]);

// The full echo: mech 2's opportunity is interrupted, mech 1 acts inside it
// with its own dial timing (K7), and mech 2 resumes when the extra ends. The
// echoed mech is NOT marked as having acted (K19).
const wnest = world([mech(1, 's1', { link: 3, timing: 'melee' }), mech(2, 's1', { link: 3 })], 2, opp(2));
C.apply(data, wnest, ge({ uid: 1 }));
check('the grant nests inside the open opportunity',
  [wnest.script.opp?.uid, wnest.script.opp?.extra, wnest.script.opp?.timing, wnest.script.oppStack.map((o) => o.uid)],
  [1, true, 'melee', [2]]);
check('the extra reads as one while it runs', C.onExtraOpportunity(wnest, 1), true);
check('the interrupted opportunity does not', C.onExtraOpportunity(wnest, 2), false);
C.apply(data, wnest, eo({ uid: 1 }));
check('ending the extra resumes the granter, echoed mech not acted (K19)',
  [wnest.script.opp?.uid, wnest.script.opp?.extra, wnest.script.oppStack, wnest.script.acted], [2, undefined, [], []]);

// Chained echoes stack and unwind in reverse (K8).
const wchain = world([mech(1, 's1', { link: 3 }), mech(2, 's1', { link: 3 }), mech(3, 's1', { link: 3 })], 2, opp(1));
C.apply(data, wchain, ge({ uid: 2 }));
C.apply(data, wchain, ge({ uid: 3 }));
check('two grants nest two deep', [wchain.script.opp?.uid, wchain.script.oppStack.map((o) => o.uid)], [3, [1, 2]]);
C.apply(data, wchain, eo({ uid: 3 }));
C.apply(data, wchain, eo({ uid: 2 }));
check('and unwind in reverse to the original mech', [wchain.script.opp?.uid, wchain.script.oppStack, wchain.script.acted], [1, [], []]);
C.apply(data, wchain, eo({ uid: 1 }));
check('whose own opportunity still ends normally', [wchain.script.opp, wchain.script.acted], [null, [1]]);

// Paying the grant down to 0 Link is a Shutdown like any other spend.
const wgz = world([mech(1, 's1', { link: 1 })]);
C.apply(data, wgz, ge());
check('a grant that drains the Link shuts the mech down', [wgz.tokens[0].link, wgz.tokens[0].stance], [0, 'shutdown']);

// ---------- the End Phase checklist ----------

const me = (step) => ({ kind: 'markEndStep', seat: 's1', step });
check('the checklist belongs to the End Phase', C.check(data, world([], 2), me('tokens')).ok, false);
const wme = world([mech(1, 's1', { statuses: ['fci'], expiring: ['fci'] })], 5);
wme.commandTokens = { s1: 2, s2: 0 };
C.apply(data, wme, me('tokens'));
check('the tokens step ages every unit', wme.tokens[0].statuses, []);
check('and clears the unspent Command Tokens', wme.commandTokens, { s1: 0, s2: 0 });
check('and ticks the checklist', wme.script.endDone, ['1:end:tokens']);
const wrm = world([
  mech(1, 's1', { partStates: { torso: 'intact', chasis: 'destroyed', leftHand: 'destroyed', rightHand: 'destroyed', backpack: 'destroyed' } }),
  mech(2, 's2', { partStates: { torso: 'intact', chasis: 'intact', leftHand: 'intact' } }),
], 5);
C.apply(data, wrm, me('remove'));
check('Integrity Loss removes the spent mech', wrm.tokens.map((t) => t.uid), [2]);
const wts = world([], 5);
wts.tasks = { items: [] };
C.apply(data, wts, me('tasks'));
check('the tasks step ticks the checklist', wts.script.endDone, ['1:end:tasks']);

// A negative Award used to be refused outright. It is ACCEPTED now: cards 300
// and 500 print "-1 Victory Point if this Part is destroyed", that penalty
// settles once at the end of the game, and there is no matching + in the same
// award to net it against — so a lone -1 is the base case, not an error. The
// floor lives on the running total in apply(); the full rider arithmetic is in
// vprider.test.mjs.
check('a negative Award is accepted', C.check(data, world([], 5), { kind: 'award', seat: 's1', vp: { s1: -1, s2: 0 }, keys: [] }).ok, true);
check('and it says so, because the total will floor at zero',
  C.check(data, world([], 5), { kind: 'award', seat: 's1', vp: { s1: -1, s2: 0 }, keys: [] }).note?.includes('floored at 0'), true);
check('a fractional score is still not a score', C.check(data, world([], 5), { kind: 'award', seat: 's1', vp: { s1: 1.5, s2: 0 }, keys: [] }).ok, false);
check('and neither is a wild one', C.check(data, world([], 5), { kind: 'award', seat: 's1', vp: { s1: 0, s2: 999 }, keys: [] }).ok, false);
const waw = world([], 5);
const aw = { kind: 'award', seat: 's1', vp: { s1: 3, s2: 1 }, keys: ['1:main'] };
C.apply(data, waw, aw);
check('the Award banks the points and marks the lines paid', [waw.tasks.vp, waw.tasks.scored], [{ s1: 3, s2: 1 }, ['1:main']]);
C.apply(data, waw, aw);
check('and a paid line is never marked twice', waw.tasks.scored, ['1:main']);

// ---------- forced movement facing (3.4.4, FAQ B4/B5) ----------

const wfmv = world([mech(1, 's1'), mech(2, 's2', { col: 9, row: 3, facing: 0 })]);
C.apply(data, wfmv, { kind: 'forceMove', seat: 's1', uid: 1, targetUid: 2, to: { col: 12, row: 3 }, facing: 2 });
check('the forcing player sets the victim facing', [wfmv.tokens[1].col, wfmv.tokens[1].facing], [12, 2]);
C.apply(data, wfmv, { kind: 'forceMove', seat: 's1', uid: 1, targetUid: 2, to: { col: 12, row: 3 } });
check('and omitting the facing leaves it alone', wfmv.tokens[1].facing, 2);

// ---------- integrity-loss kill credit (FAQ P4) ----------

const wilv = world([
  mech(1, 's1'),
  mech(2, 's2', { mech: { torso: 'T1', chasis: 'C1', pilot: 'P1' }, partStates: { torso: 'intact', chasis: 'intact' }, link: 3 }),
], 5);
C.apply(data, wilv, { kind: 'applyPenetration', seat: 's1', uid: 1, targetUid: 2, slot: 'chasis' });
check('the last part-destroyer is remembered', wilv.tokens[1].lastDamagedBy, { side: 's1', uid: 1 });
C.apply(data, wilv, { kind: 'markEndStep', seat: 's1', step: 'remove' });
check('integrity loss removes the mech and credits the kill (P4)',
  [wilv.tokens.some((x) => x.uid === 2), (wilv.tasks.kills ?? []).length > 0 || JSON.stringify(wilv.tasks).includes('s1')],
  [false, true]);

// ---------- the fielded roster: a squad is what was BROUGHT ----------
//
// Integrity Loss takes the Mech off the board, so a game record read from the
// tokens at the final bell would be missing it — and the same squad would then
// record differently depending on who died. rememberFielded runs off every
// perform/applyRemote so a unit is noted while it is still standing.

const wfld = world([
  mech(1, 's1'),
  mech(2, 's2', { mech: { torso: 'T1', chasis: 'C1', pilot: 'P1' }, partStates: { torso: 'intact', chasis: 'intact' }, link: 3 }),
], 5);
check('a fresh board has no roster yet', wfld.fielded, undefined);
C.rememberFielded(data, wfld);
const s2Before = JSON.stringify(wfld.fielded.s2);
check('the roster notes each unit under its own uid, so two of a Part stay two',
  [Object.keys(wfld.fielded.s2), wfld.fielded.s2['2']],
  [['2'], C.tokenCards(data, wfld.tokens[1]).map((x) => x.card.id)]);
C.apply(data, wfld, { kind: 'markEndStep', seat: 's1', step: 'remove' });
check('the Mech leaves the board but stays in the roster',
  [wfld.tokens.some((x) => x.uid === 2), JSON.stringify(wfld.fielded.s2) === s2Before],
  [false, true]);
// Re-noting after the unit is gone must not quietly drop it.
C.rememberFielded(data, wfld);
check('a later command does not forget the dead', JSON.stringify(wfld.fielded.s2) === s2Before, true);
check('a Projectile is never rostered',
  (() => {
    const wp = world([{ uid: 9, side: 's1', kind: 'projectile', cardId: 'T1', col: 1, row: 1, facing: 0, size: 1, partStates: {}, ammo: {}, intercept: {} }]);
    C.rememberFielded(data, wp);
    return Object.keys(wp.fielded.s1).length;
  })(), 0);

// Behaviour above proves the function; these prove it is still plumbed in.
// A roster nobody fills is worse than none, because the recorder trusts it and
// stops falling back to the board.
const noBlanks = (s) => s.replace(/\s+/g, ' ');
check('perform notes the roster straight after applying',
  noBlanks(commands).includes('apply(data, state, cmd); rememberFielded(data, state);'), true);
check('applyRemote notes it too, once the remote flag is down',
  noBlanks(commands).includes('applyingRemote = false; } rememberFielded(data, state);'), true);

// ---------- per-Part Repaired (FAQ D7/J21/J23) ----------

const wrp = world([mech(1, 's1', { mech: { torso: 'T1', chasis: 'C1', pilot: 'P1' }, partStates: { torso: 'intact', chasis: 'destroyed' }, link: 2 })]);
check('a live part cannot take a Repaired Token', C.check(data, wrp, { kind: 'repairPart', seat: 's1', uid: 1, slot: 'torso', mode: 'repaired' }).ok, false);
C.apply(data, wrp, { kind: 'repairPart', seat: 's1', uid: 1, slot: 'chasis', mode: 'repaired' });
check('repairing marks the slot and leaves it destroyed (J21)',
  [wrp.tokens[0].repairedSlots, wrp.tokens[0].partStates.chasis, wrp.tokens[0].link],
  [['chasis'], 'destroyed', 2]);
check('a second Token on the same Part is refused', C.check(data, wrp, { kind: 'repairPart', seat: 's1', uid: 1, slot: 'chasis', mode: 'repaired' }).ok, false);
C.apply(data, wrp, { kind: 'breakRepaired', seat: 's2', uid: 1, targetUid: 1, slot: 'chasis' });
check('a hit removes the Token without a Link loss (J23)',
  [wrp.tokens[0].repairedSlots, wrp.tokens[0].link], [undefined, 2]);

const wmd = world([mech(1, 's1', { partStates: { torso: 'damaged' } })]);
C.apply(data, wmd, { kind: 'repairPart', seat: 's1', uid: 1, slot: 'torso', mode: 'mend' });
check('mending turns Damaged back to intact', wmd.tokens[0].partStates.torso, 'intact');

// The other half of J23 lives in the combat wizard, which is DOM-bound and
// cannot be sliced — so it is guarded at the source. `pickPart` must catch a
// Repaired slot BEFORE it sets `targetPart`, send the breakRepaired, and then
// redirect the whole attack to the Torso. Getting the order wrong would roll a
// Penetration against a Part that should simply have come off.
const combatSrc = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
const pickPartFn = combatSrc.slice(
  combatSrc.indexOf('private pickPart('),
  combatSrc.indexOf('private poolEditor('),
);
check('the Repaired branch is inside pickPart', pickPartFn.includes('repairedSlots'), true);
check('and it fires BEFORE the hit location is committed',
  pickPartFn.indexOf('repairedSlots') < pickPartFn.indexOf('c.targetPart = slot'), true);
check('it sends breakRepaired rather than a Penetration', pickPartFn.includes("kind: 'breakRepaired'"), true);
check('and redirects the attack to the Torso (J23)', pickPartFn.includes("this.pickPart('torso')"), true);
// A Torso bearing one would recurse forever, so the slot test must exclude it.
check('the Torso itself is excluded from the redirect', pickPartFn.includes("slot !== 'torso'"), true);

// ---------- stabilise and reveal (6.1) ----------

// Either half justifies the action (FAQ J4/J6-J8): refusal needs BOTH no
// removable Token AND a full Link.
check('nothing at all to change is refused (J8)', C.check(data, world([mech(1, 's1', { link: 4 })]), { kind: 'stabilise', seat: 's1', uid: 1 }).ok, false);
check('missing Link alone justifies Stabilize (J6)', C.check(data, world([mech(1, 's1', { link: 1 })]), { kind: 'stabilise', seat: 's1', uid: 1 }).ok, true);
check('a Token alone justifies Stabilize at full Link (J7)', C.check(data, world([mech(1, 's1', { statuses: ['fci'], link: 4 })]), { kind: 'stabilise', seat: 's1', uid: 1 }).ok, true);
const wsb = world([mech(1, 's1', { statuses: ['fci', 'fci'], expiring: ['fci'], link: 1 })]);
C.apply(data, wsb, { kind: 'stabilise', seat: 's1', uid: 1 });
check('Stabilize sheds one token and restores 1 Link', [wsb.tokens[0].statuses, wsb.tokens[0].link], [['fci'], 2]);
const wsk = world([mech(1, 's1', { statuses: ['fci'], link: 1 })]);
C.apply(data, wsk, { kind: 'stabilise', seat: 's1', uid: 1, keepTokens: true });
check('keepTokens takes the Link and leaves the Tokens (J4)', [wsk.tokens[0].statuses, wsk.tokens[0].link], [['fci'], 2]);
const wlk = world([mech(1, 's1', { link: 1 })]);
C.apply(data, wlk, { kind: 'stabilise', seat: 's1', uid: 1 });
check('a token-less Stabilize still restores the Link (J6)', wlk.tokens[0].link, 2);

check('reveal needs the camouflage', C.check(data, world([mech(1, 's1')]), { kind: 'reveal', seat: 's1', uid: 1 }).ok, false);
const wrev = world([mech(1, 's1', { statuses: ['camouflage'] })]);
C.apply(data, wrev, { kind: 'reveal', seat: 's1', uid: 1 });
check('reveal drops the camouflage state', wrev.tokens[0].statuses, []);

// ---------- pre-game setup ----------

const wmap = world([]);
C.apply(data, wmap, { kind: 'lockMap', seat: 's1' });
check('locking the map opens the roll', wmap.setup.stage, 'roll');
check('locking twice is refused', C.check(data, wmap, { kind: 'lockMap', seat: 's1' }).ok, false);
C.apply(data, wmap, { kind: 'rollSetup', seat: 's1', hits: [2, 1] });
C.apply(data, wmap, { kind: 'rollSetup', seat: 's2', hits: [0, 1] });
check('the rolls ride as hits', wmap.setup.rolls, { s1: [2, 1], s2: [0, 1] });
C.apply(data, wmap, { kind: 'acceptRoll', seat: 's1' });
// The roll hands over to the TASKS step, not the edges (FAQ P1).
check('accepting crowns the First Player', [wmap.round.firstPlayer, wmap.setup.stage], ['s1', 'tasks']);
check('edges wait for the tasks step', C.check(data, wmap, { kind: 'pickEdge', seat: 's1', edge: 'black' }).ok, false);
C.apply(data, wmap, { kind: 'finishTasks', seat: 's1' });
check('and the tasks step hands over to the edges', wmap.setup.stage, 'side');
check('the other squad cannot pick the edge', C.check(data, wmap, { kind: 'pickEdge', seat: 's2', edge: 'black' }).ok, false);
C.apply(data, wmap, { kind: 'pickEdge', seat: 's1', edge: 'black' });
check('the edge pick splits the table', [wmap.setup.stage, wmap.setup.edge], ['deploy', { s1: 'black', s2: 'white' }]);
const wtie = world([]);
wtie.setup = { stage: 'roll', rolls: { s1: [1], s2: [1] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } };
check('a tied roll cannot be accepted', C.check(data, wtie, { kind: 'acceptRoll', seat: 's1' }).ok, false);
check('deployment cannot finish early', C.check(data, world([mech(1, 's1', { deployed: false })]), { kind: 'finishDeployment', seat: 's1' }).ok, false);
const wfd = world([mech(1, 's1')]);
wfd.script.stage = '1:0';
C.apply(data, wfd, { kind: 'finishDeployment', seat: 's1' });
check('finishing deployment starts the game proper', [wfd.setup.stage, wfd.script.stage], ['done', '']);
const wld = world([], 1);
C.apply(data, wld, { kind: 'lockDials', seat: 's1' });
check('locking the dials stamps the stage', wld.script.stage, '1:1:locked');
check('outside Planning the lock is refused', C.check(data, world([], 2), { kind: 'lockDials', seat: 's1' }).ok, false);

// ---------- the intercept queue ----------

const it = { uid: 1, actionId: 'I1', targetUid: 9 };
const wq = world([mech(1, 's1')], 2);
wq.script.intercepts = [];
C.apply(data, wq, { kind: 'queueIntercepts', seat: 's2', items: [it, { uid: 1, actionId: 'I1', targetUid: 10 }] });
check('owed interceptions are queued', wq.script.intercepts.length, 2);
check('a queued interception may resolve', C.check(data, wq, { kind: 'resolveIntercept', seat: 's1', ...it }).ok, true);
C.apply(data, wq, { kind: 'resolveIntercept', seat: 's1', ...it });
check('resolving consumes exactly one', [wq.script.intercepts.length, wq.script.intercepts[0].targetUid], [1, 10]);
check('an interception not owed is refused', C.check(data, wq, { kind: 'resolveIntercept', seat: 's1', ...it }).ok, false);
C.apply(data, wq, { kind: 'clearIntercepts', seat: 's1' });
check('skipping clears the queue', wq.script.intercepts, []);

// ---------- Interception Tokens (4.9) ----------
// They are placed at Deployment, spent one per attempt and never restored, so
// the count is a shared number and has to travel like Ammo does.
const wi = () => world([mech(1, 's1', { mech: { torso: 'T5', pilot: 'P1' }, intercept: { I2: 2 } })], 2);
const spend = (over = {}) => ({ kind: 'spendIntercept', seat: 's1', uid: 1, actionId: 'I2', ...over });
check('an Action with no Interception Tokens is refused', C.check(data, wi(), spend({ actionId: 'A1' })).ok, false);
check('a Part holding Tokens may spend one', C.check(data, wi(), spend()).ok, true);
const wspend = wi();
C.apply(data, wspend, spend());
check('spending takes exactly one', wspend.tokens[0].intercept.I2, 1);
C.apply(data, wspend, spend());
check('and the Part can empty', wspend.tokens[0].intercept.I2, 0);
check('an empty Part cannot Intercept again', C.check(data, wspend, spend()).ok, false);
check('the other squad cannot spend it', C.check(data, wi(), spend({ seat: 's2' })).ok, false);
// The restore is the undo for a misclick, capped by what the card prints.
C.apply(data, wspend, { kind: 'restoreIntercept', seat: 's1', uid: 1, actionId: 'I2' });
check('an undo puts one back', wspend.tokens[0].intercept.I2, 1);
C.apply(data, wspend, { kind: 'restoreIntercept', seat: 's1', uid: 1, actionId: 'I2' });
C.apply(data, wspend, { kind: 'restoreIntercept', seat: 's1', uid: 1, actionId: 'I2' });
check('but never past the printed Intercept X', wspend.tokens[0].intercept.I2, 2);
check('and a full Part refuses the undo', C.check(data, wspend, { kind: 'restoreIntercept', seat: 's1', uid: 1, actionId: 'I2' }).ok, false);

// ---------- Electronic Counter-rolls (4.11.2) ----------
// Both sides roll their own Electronic Value, so each seat submits its own
// faces and neither can send the other's.
const ewMech = (uid, side, torso, extra = {}) => ({
  uid, side, kind: 'mech', stance: 'offensive', label: `E${uid}`, col: 3, row: 3, facing: 0,
  mech: { torso, pilot: 'P1' }, partStates: { torso: 'intact' }, ...extra,
});
const ewWorld = (over = {}) => {
  const w = world([ewMech(1, 's1', 'EW1'), ewMech(2, 's2', 'EW2', { col: 9, row: 3 })], 2, opp(1));
  Object.assign(w.script, over);
  return w;
};
const startEw = (over = {}) => ({ kind: 'startCounterRoll', seat: 's1', uid: 1, actionId: 'EWA', targetUid: 2, ...over });
check('an Electronic Attack in range opens', C.check(data, ewWorld(), startEw()).ok, true);
check('a friendly target is refused', C.check(data, ewWorld(), startEw({ targetUid: 1 })).ok, false);
const wfar = ewWorld();
wfar.tokens[1].col = 33;
check('and one beyond the Action Range is refused', C.check(data, wfar, startEw()).ok, false);
const wnoEv = ewWorld();
wnoEv.tokens[0].mech = { torso: 'T1', pilot: 'P1' };
check('a unit with Electronic Value 0 cannot Initiate', C.check(data, wnoEv, startEw()).ok, false);
const wew = ewWorld();
C.apply(data, wew, startEw());
check('the Counter-roll is opened on the shared state',
  [wew.script.counter.initiatorUid, wew.script.counter.responderUid, wew.script.counter.initRoll], [1, 2, null]);
check('a second one is refused while it is open', C.check(data, wew, startEw()).ok, false);
check('the Initiator may roll', C.check(data, wew, { kind: 'rollCounter', seat: 's1', uid: 1, faces: [0, 1, 2] }).ok, true);
check('a unit outside the Counter-roll may not', C.check(data, wew, { kind: 'rollCounter', seat: 's1', uid: 9, faces: [0] }).ok, false);
C.apply(data, wew, { kind: 'rollCounter', seat: 's1', uid: 1, faces: [0, 1, 2] });
check('its faces are recorded', wew.script.counter.initRoll, [0, 1, 2]);
check('and it cannot simply roll again', C.check(data, wew, { kind: 'rollCounter', seat: 's1', uid: 1, faces: [3] }).ok, false);
check('but it may Focus once', C.check(data, wew, { kind: 'rollCounter', seat: 's1', uid: 1, faces: [3], focused: true }).ok, true);
C.apply(data, wew, { kind: 'rollCounter', seat: 's1', uid: 1, faces: [3], focused: true });
check('the Focus reroll replaces the faces', [wew.script.counter.initRoll, wew.script.counter.initFocused], [[3], true]);
check('and not twice', C.check(data, wew, { kind: 'rollCounter', seat: 's1', uid: 1, faces: [4], focused: true }).ok, false);
C.apply(data, wew, { kind: 'rollCounter', seat: 's2', uid: 2, faces: [5, 6] });
check('the Responder rolls for itself', wew.script.counter.respRoll, [5, 6]);
C.apply(data, wew, { kind: 'clearCounterRoll', seat: 's1' });
check('and clearing closes it', wew.script.counter, null);

// ---------- a Movement Action's move (3.4.4) ----------
// It rides on the Action Tick the Action already paid, so it must not also
// spend the Maneuver Tick — and it needs an Action to have been performed.
const wmv = (over = {}) => world([mech(1, 's1')], 2, opp(1, over));
const freeMove = { kind: 'maneuver', seat: 's1', uid: 1, to: { col: 9, row: 9 }, free: true };
check('a free move needs an Action behind it', C.check(data, wmv(), freeMove).ok, false);
check('and passes once one is performed', C.check(data, wmv({ performed: ['A1'] }), freeMove).ok, true);
const wSpentMan = wmv({ performed: ['A1'], maneuver: 0, maneuvered: true });
check('even with the Maneuver Tick already gone', C.check(data, wSpentMan, freeMove).ok, true);
C.apply(data, wSpentMan, freeMove);
check('it moves the unit', [wSpentMan.tokens[0].col, wSpentMan.tokens[0].row], [9, 9]);
const wnorm = wmv({ performed: ['A1'] });
C.apply(data, wnorm, freeMove);
check('and leaves the Maneuver Tick alone', [wnorm.script.opp.maneuver, wnorm.script.opp.maneuvered], [1, false]);
const wman = wmv();
C.apply(data, wman, { kind: 'maneuver', seat: 's1', uid: 1, to: { col: 9, row: 9 } });
check('while an ordinary Maneuver still spends it', [wman.script.opp.maneuver, wman.script.opp.maneuvered], [0, true]);

// A Movement a card handed out belongs to the card. Hit and Run moves a Mech as
// its Opportunity *ends*, when there is none left to check against or charge.
const granted = { kind: 'maneuver', seat: 's1', uid: 1, to: { col: 9, row: 9 }, granted: true };
check('a granted Movement needs no Opportunity', C.check(data, world([mech(1, 's1')], 2), granted).ok, true);
const wgr = wmv({ performed: ['A1'], maneuver: 1 });
C.apply(data, wgr, granted);
check('and spends no Maneuver Tick', [wgr.script.opp.maneuver, wgr.script.opp.maneuvered], [1, false]);
check('but still moves the unit', [wgr.tokens[0].col, wgr.tokens[0].row], [9, 9]);
check('an ungranted move with no Opportunity is still refused', C.check(data, world([mech(1, 's1')], 2), mv()).ok, false);

// ---------- Charge Tokens (4.14) ----------
const wc2 = () => world([mech(1, 's1', { mech: { torso: 'T6', chasis: 'T1', pilot: 'P1' }, partStates: { torso: 'intact', chasis: 'intact' } })], 2);
const chg = (over = {}) => ({ kind: 'setCharge', seat: 's1', uid: 1, slot: 'torso', on: true, ...over });
check('a Part whose Action spends a Charge may hold one', C.check(data, wc2(), chg()).ok, true);
check('a Part with no Chargeable Action may not', C.check(data, wc2(), chg({ slot: 'chasis' })).ok, false);
const wchg = wc2();
C.apply(data, wchg, chg());
check('turning it face-up records the slot', wchg.tokens[0].charge, ['torso']);
check('and a Charged Part cannot be Charged again', C.check(data, wchg, chg()).ok, false);
check('but it can be spent', C.check(data, wchg, chg({ on: false })).ok, true);
C.apply(data, wchg, chg({ on: false }));
check('spending it leaves nothing behind', wchg.tokens[0].charge, undefined);
check('and an uncharged Part has nothing to spend', C.check(data, wchg, chg({ on: false })).ok, false);
check('the other squad cannot flip it', C.check(data, wc2(), chg({ seat: 's2' })).ok, false);
const wdead = wc2();
wdead.tokens[0].partStates.torso = 'destroyed';
check('a destroyed Part holds nothing', C.check(data, wdead, chg()).ok, false);

// ---------- launch and despawn ----------

const wl = world([mech(1, 's1', { mech: { torso: 'T4', pilot: 'P1' }, ammo: { L1: 2 } })], 2);
wl.nextUid = 50;
C.apply(data, wl, { kind: 'launch', seat: 's1', uid: 1, actionId: 'L1', cardId: 'D1', to: { col: 9, row: 9 }, facing: 2 });
const born = wl.tokens[1];
check('a launch spawns the projectile where it landed', [born.uid, born.parentUid, born.col, born.row, born.facing], [50, 1, 9, 9, 2]);
check('and spends the Ammo with it', wl.tokens[0].ammo.L1, 1);
check('and the uid counter advanced', wl.nextUid, 51);
check('launching a made-up card is refused', C.check(data, wl, { kind: 'launch', seat: 's1', uid: 1, actionId: 'L1', cardId: 'NOPE', to: { col: 9, row: 9 }, facing: 0 }).ok, false);
C.apply(data, wl, { kind: 'despawn', seat: 's1', uid: 1, targetUid: 50 });
check('a despawn takes it back off', wl.tokens.length, 1);
// Every launch costs an Ammo Token (4.13), and apply clamps the count at zero
// - so without check() refusing, an empty magazine fired forever, in a strict
// game as much as the sandbox. The volley UI found this the hard way.
const shot = { kind: 'launch', seat: 's1', uid: 1, actionId: 'L1', cardId: 'D1', to: { col: 9, row: 9 }, facing: 0 };
check('a launch with Ammo left is allowed', C.check(data, wl, shot).ok, true);
wl.tokens[0].ammo.L1 = 0;
check('a launch with no Ammo left is refused', C.check(data, wl, shot).ok, false);
delete wl.tokens[0].ammo.L1;
check('an Action with no tracked Ammo is not gated by it', C.check(data, wl, shot).ok, true);

// ---------- Owed reactions: Emergency Smoke (FAQ B7/D10) ----------
//
// The ATTACKING client queues the debt and only the DEFENDER may answer it,
// which is the whole reason it is shared state rather than a local prompt.
const wrx = world([
  mech(1, 's1', { mech: { torso: 'T1', pilot: 'P1' } }),
  mech(2, 's2', { mech: { torso: 'T1', pilot: 'P1' }, ammo: { REACT: 1 } }),
], 2);
const queueR = { kind: 'queueReactions', seat: 's1', items: [{ uid: 2, actionId: 'REACT', count: 2, range: 1 }] };
check('the attacker may queue a reaction against the other squad', C.check(data, wrx, queueR).ok, true);
check('but not for a unit that is not on the board',
  C.check(data, wrx, { ...queueR, items: [{ uid: 99, actionId: 'REACT', count: 2, range: 1 }] }).ok, false);
C.apply(data, wrx, queueR);
check('the debt lands in shared script state', wrx.script.reactions, [{ uid: 2, actionId: 'REACT', count: 2, range: 1 }]);
// Actor-scoped, so check() gives the ownership rule for free.
check('the attacker may NOT answer it',
  C.check(data, wrx, { kind: 'resolveReaction', seat: 's1', uid: 2, actionId: 'REACT' }).ok, false);
check('the defender may', C.check(data, wrx, { kind: 'resolveReaction', seat: 's2', uid: 2, actionId: 'REACT' }).ok, true);
C.apply(data, wrx, { kind: 'resolveReaction', seat: 's2', uid: 2, actionId: 'REACT' });
check('answering clears the debt', wrx.script.reactions, []);
// Cleared and spent in ONE command, so a drop between them cannot leave a free
// Emergency Smoke behind.
check('and spends the use in the same breath', wrx.tokens[1].ammo.REACT, 0);
check('a debt already paid cannot be paid twice',
  C.check(data, wrx, { kind: 'resolveReaction', seat: 's2', uid: 2, actionId: 'REACT' }).ok, false);
// Appended, not replaced: a second attack can land while an earlier reaction
// is still unanswered and neither is forfeit.
C.apply(data, wrx, queueR);
C.apply(data, wrx, { kind: 'queueReactions', seat: 's1', items: [{ uid: 2, actionId: 'OTHER', count: 1, range: 0 }] });
check('a second debt queues behind the first', wrx.script.reactions.map((r) => r.actionId), ['REACT', 'OTHER']);

// ---------- Prototype Blink (FAQ E17/E20) ----------

const wbl = world([
  mech(1, 's1', { mech: { torso: 'TAU', pilot: 'P1' }, col: 12, row: 12, size: 3 }),
  mech(2, 's2', { mech: { torso: 'T1', pilot: 'P1' }, col: 21, row: 12, size: 3 }),
], 2);
const bl = (over = {}) => ({ kind: 'blink', seat: 's1', uid: 1, actionId: 'BLINK', targetUid: 2, facing: 2, targetFacing: 0, ...over });
check('a Ground Mech in range can be blinked with', C.check(data, wbl, bl()).ok, true);
check('an absent target is refused', C.check(data, wbl, bl({ targetUid: 99 })).ok, false);
// Forced Movement means BOTH facings are the Taurus player's to set, so a
// command missing one is not a legal Blink.
check('a bad facing is refused', C.check(data, wbl, bl({ targetFacing: 7 })).ok, false);
// The named Action must really BE a swap, or any Action with a Range could be
// sent as a blink command and teleport off it.
check('an ordinary Action cannot be sent as a blink', C.check(data, wbl, bl({ actionId: 'A1' })).ok, false);
C.apply(data, wbl, bl());
check('the two units trade Grids', [
  [wbl.tokens[0].col, wbl.tokens[0].row], [wbl.tokens[1].col, wbl.tokens[1].row],
], [[21, 12], [12, 12]]);
check('and the Taurus player set both facings (E17)', [wbl.tokens[0].facing, wbl.tokens[1].facing], [2, 0]);

// The multiplayer property: one command, applied to two mirrored boards, must
// leave them byte-identical. A swap is the case most likely to half-apply, so
// it is stated here rather than assumed.
const seatL = world([
  mech(1, 's1', { mech: { torso: 'TAU', pilot: 'P1' }, col: 12, row: 12, size: 3 }),
  mech(2, 's2', { mech: { torso: 'T1', pilot: 'P1' }, col: 21, row: 12, size: 3 }),
], 2);
const seatR = structuredClone(seatL);
C.apply(data, seatL, bl());
C.apply(data, seatR, bl());
check('a mirrored blink lands identically on both seats', JSON.stringify(seatL), JSON.stringify(seatR));

// ---------- laying Mines (FAQ M7) ----------

// Given an Ammo counter it has no business touching, so "no Ammo moved" is a
// real assertion rather than a missing key reading as absence.
const wlay = world([mech(1, 's1', { mech: { torso: 'T4', backpack: 'ML1', pilot: 'P1' }, ammo: { LAY1: 2, L1: 3 } })], 2);
wlay.nextUid = 70;
const lay = (over = {}) => ({ kind: 'layMine', seat: 's1', uid: 1, actionId: 'LAY1', cardId: 'MN1', to: { col: 12, row: 6 }, ...over });
check('a Mine Layer may Lay', C.check(data, wlay, lay()).ok, true);
// The route and the Move Range that paid for it are the driver's business; the
// command only knows the Action really Lays something.
check('an Action that does not Lay is refused', C.check(data, wlay, lay({ actionId: 'L1' })).ok, false);
check('a made-up Mine is refused', C.check(data, wlay, lay({ cardId: 'NOPE' })).ok, false);
check('and a spot off the board is refused', C.check(data, wlay, lay({ to: { col: 99, row: 6 } })).ok, false);
C.apply(data, wlay, lay());
const laid = wlay.tokens[1];
check('laying puts the Mine on the board where it was named', [laid.uid, laid.parentUid, laid.col, laid.row], [70, 1, 12, 6]);
check('it belongs to the layer', laid.side, 's1');
// Auto Mine Laying has no magazine — it is paid for in Move Range, which the
// shorter route already spent.
check('and no Ammo moved', [wlay.tokens[0].ammo.LAY1, wlay.tokens[0].ammo.L1], [2, 3]);
check('the uid counter advanced, so the next Mine sorts after this one', wlay.nextUid, 71);

// The multiplayer property, stated directly: the same command applied to two
// mirrored boards must leave them byte-identical, because that is all the
// relay guarantees — it orders and forwards, it does not referee. Any hidden
// dependence on local state (a random, a clock, a render) shows up here.
const seatA = world([mech(1, 's1', { mech: { torso: 'T4', backpack: 'ML1', pilot: 'P1' } })], 2);
seatA.nextUid = 70;
const seatB = structuredClone(seatA);
const layCmd = { kind: 'layMine', seat: 's1', uid: 1, actionId: 'LAY1', cardId: 'MN1', to: { col: 12, row: 6 } };
C.apply(data, seatA, layCmd);
C.apply(data, seatB, layCmd);
check('a mirrored layMine lands identically on both seats', JSON.stringify(seatA), JSON.stringify(seatB));

// ---------- smoke screens ----------

const ws = world([]);
check('smoke lands only on the board', C.check(data, ws, { kind: 'placeSmoke', seat: 's1', at: { col: 20, row: 3 } }).ok, false);
C.apply(data, ws, { kind: 'placeSmoke', seat: 's1', at: { col: 3, row: 3 } });
C.apply(data, ws, { kind: 'placeSmoke', seat: 's1', at: { col: 4, row: 3 } });
C.apply(data, ws, { kind: 'placeSmoke', seat: 's1', at: { col: 9, row: 9 } });
check('screens are recorded with their side', ws.smoke.length, 3);
// A defender's Emergency Smoke is driven from the ATTACKING client, whose seat
// the attribution stamp overwrites — `for` is what keeps the Screen theirs.
C.apply(data, ws, { kind: 'placeSmoke', seat: 's1', for: 's2', at: { col: 6, row: 6 } });
check('`for` names the owner past the seat stamp', ws.smoke.find((x) => x.col === 6 && x.row === 6)?.side, 's2');
C.apply(data, ws, { kind: 'removeSmoke', seat: 's2', at: { col: 6, row: 6 } });
C.apply(data, ws, { kind: 'dissipateSmoke', seat: 's1' });
check('dissipation removes only the isolated screen', ws.smoke.map((x) => `${x.col},${x.row}`), ['3,3', '4,3']);
C.apply(data, ws, { kind: 'removeSmoke', seat: 's1', at: { col: 3, row: 3 } });
check('a group pick removes one screen', ws.smoke.map((x) => `${x.col},${x.row}`), ['4,3']);
check('removing missing smoke is refused', C.check(data, ws, { kind: 'removeSmoke', seat: 's1', at: { col: 9, row: 9 } }).ok, false);

// ---------- pass-and-play (rulebook 3.3) ----------

const hiddenWorld = () => {
  const w = world([mech(1, 's1'), mech(2, 's2')], 1);
  w.script.mode = 'hidden';
  return w;
};
check('a made-up mode is refused', C.check(data, world([]), { kind: 'setMode', seat: 's1', mode: 'psychic' }).ok, false);
const wmode = world([]);
C.apply(data, wmode, { kind: 'setMode', seat: 's1', mode: 'hidden' });
check('setMode flips the table over to pass-and-play', wmode.script.mode, 'hidden');
check('handing over needs pass-and-play', C.check(data, world([], 1), { kind: 'handOver', seat: 's1' }).ok, false);
const wh = hiddenWorld();
check('and belongs to the Planning Phase', C.check(data, ((x) => { x.round.phase = 2; return x; })(hiddenWorld()), { kind: 'handOver', seat: 's1' }).ok, false);
check('the squad without the device cannot hand it over', C.check(data, wh, { kind: 'handOver', seat: 's2' }).ok, false);
check('the holder can', C.check(data, wh, { kind: 'handOver', seat: 's1' }).ok, true);
// The dial filter: the seat not holding the device is masked.
check('the holder\'s own dial is open', C.dialHidden(wh, wh.tokens[0]), false);
check('the other squad\'s dial is masked', C.dialHidden(wh, wh.tokens[1]), true);
check('and setting it is refused', C.check(data, wh, st({ seat: 's2', uid: 2 })).ok, false);
check('while the holder sets its own freely', C.check(data, wh, st()).ok, true);
C.apply(data, wh, { kind: 'handOver', seat: 's1' });
check('the hand-over swaps the device', wh.script.turn, 's2');
check('and the masks swap with it', [C.dialHidden(wh, wh.tokens[0]), C.dialHidden(wh, wh.tokens[1])], [true, false]);
wh.script.stage = '1:1:locked';
check('the lock reveals every dial', [C.dialHidden(wh, wh.tokens[0]), C.dialHidden(wh, wh.tokens[1])], [false, false]);
check('an open table never masks', C.dialHidden(world([mech(1, 's1')], 1), { side: 's2' }), false);

// ---------- networked dial secrecy (3.3) ----------

const HASH = 'a'.repeat(64);
const planning = () => world([mech(1, 's1'), mech(2, 's2')], 1);
const commit = (over = {}) => ({ kind: 'commitTimings', seat: 's1', hash: HASH, ...over });

check('a commitment belongs to the Planning Phase', C.check(data, world([], 2), commit()).ok, false);
check('a stub of a hash is refused', C.check(data, planning(), commit({ hash: 'short' })).ok, false);
const wc = planning();
check('a real commitment passes', C.check(data, wc, commit()).ok, true);
C.apply(data, wc, commit());
check('and is recorded against the seat', wc.script.commits.s1, HASH);
// A reloaded client has lost the dials and salt behind its hash — they are
// local by design — so a REPLACEMENT commitment is allowed until anyone
// reveals. This is the way back from the "pick your dials" loop a real game
// locked into after a mid-Planning refresh.
check('a replacement commitment is allowed before any reveal', C.check(data, wc, commit()).ok, true);

const reveal = (over = {}) => ({
  kind: 'revealTimings', seat: 's1', salt: 'abc',
  dials: [{ uid: 1, timing: 'firing' }], ...over,
});
// The pairing is the whole guarantee, so a reveal with nothing to check
// against must not be accepted.
check('a reveal with no commitment behind it is refused', C.check(data, planning(), reveal()).ok, false);
check('with a commitment it passes', C.check(data, wc, reveal()).ok, true);
C.apply(data, wc, reveal());
check('the reveal sets that squad\'s dial', wc.tokens[0].timing, 'firing');
check('and marks the squad revealed', wc.script.revealed, ['s1']);
check('revealing twice is refused', C.check(data, wc, reveal()).ok, false);
// The replacement door shuts the moment anyone reveals — from then on a new
// hash could be chosen with the other squad's dials on the table.
check('a replacement commitment is refused once a reveal is in', C.check(data, wc, commit()).ok, false);

// A reveal must never be able to write the other player's plan.
const wx = planning();
C.apply(data, wx, commit({ seat: 's2' }));
C.apply(data, wx, reveal({ seat: 's2', dials: [{ uid: 1, timing: 'melee' }, { uid: 2, timing: 'swift' }] }));
check('a reveal cannot set the other squad\'s dial', wx.tokens[0].timing, undefined);
check('only its own', wx.tokens[1].timing, 'swift');

// Last round's commitments must not survive to be checked against new dials.
const wround = world([mech(1, 's1', { timing: 'firing' })], 5);
wround.script.commits = { s1: HASH, s2: HASH };
wround.script.revealed = ['s1', 's2'];
C.apply(data, wround, { kind: 'advancePhase', seat: 's1' });
check('a new round clears the commitments', [wround.script.commits, wround.script.revealed], [{}, []]);
check('and the dials with them', wround.tokens[0].timing, undefined);

// ---------- what actually leaves this client ----------
// The crux of dial secrecy over a network: a dial must never be mirrored as it
// is set, or whoever confirms first hands their plan to the other player.

const sent = [];
C.onPerformed((cmd) => sent.push(cmd.kind));
const wsecret = planning();
C.perform(data, wsecret, st());
check('setting a dial is never mirrored to the other player', sent, []);
check('but it still applies locally', wsecret.tokens[0].timing, 'firing');
C.perform(data, wsecret, { kind: 'setStance', seat: 's1', uid: 1, stance: 'defensive' });
check('an ordinary command is mirrored', sent, ['setStance']);
sent.length = 0;
C.perform(data, wsecret, commit({ hash: HASH }));
C.perform(data, wsecret, reveal());
check('the commitment and the reveal both travel', sent, ['commitTimings', 'revealTimings']);
check('and only setTiming is withheld', [C.isSecret(st()), C.isSecret(reveal()), C.isSecret(commit())], [true, false, false]);
// A command arriving from the other player must not be echoed back.
sent.length = 0;
C.applyRemote(data, wsecret, { kind: 'setStance', seat: 's2', uid: 2, stance: 'mobility' });
check('a received command is not bounced back', sent, []);
C.onPerformed(null);

// ---------- a move from the other player is not trusted ----------
// The relay forwards but does not referee, and the client at the other end is
// not ours to trust. Everything arriving is put through the same check().

const wrem = world([mech(1, 's1', { stance: 'shutdown' }), mech(2, 's2')], 2);
const illegal = { kind: 'setStance', seat: 's2', uid: 1, stance: 'mobility' };
const bad = C.applyRemote(data, wrem, illegal);
check('a move on a unit the sender does not own is refused', bad.ok, false);
check('and the board is untouched', wrem.tokens[0].stance, 'shutdown');

const legal = { kind: 'setStance', seat: 's2', uid: 2, stance: 'defensive' };
const good = C.applyRemote(data, wrem, legal);
check('a legal move from the other player is applied', [good.ok, wrem.tokens[1].stance], [true, 'defensive']);

// Breaking a rule locally must not be pushed onto an opponent, so an online
// game is strict whatever the guide is set to.
const wonline = world([mech(1, 's1', { stance: 'shutdown' })], 2);
wonline.script.strict = false;
C.setLocalSeat('s1');
const v = C.perform(data, wonline, sc({ stance: 'mobility' }));
check('an online game refuses an illegal move even in teaching mode', [v.ok, wonline.tokens[0].stance], [false, 'shutdown']);
C.setLocalSeat(null);
const voff = C.perform(data, wonline, sc({ stance: 'mobility' }));
check('while a local teaching game still warns and allows it', [voff.ok, wonline.tokens[0].stance], [false, 'mobility']);

// ---------- what a client is allowed to see ----------

const wd = planning();
C.setLocalSeat('s1');
check('my own dial is never hidden from me', C.dialHidden(wd, wd.tokens[0]), false);
check('the other squad\'s is hidden before they reveal', C.dialHidden(wd, wd.tokens[1]), true);
C.apply(data, wd, commit({ seat: 's2' }));
check('a commitment alone does not reveal anything', C.dialHidden(wd, wd.tokens[1]), true);
C.apply(data, wd, reveal({ seat: 's2', dials: [{ uid: 2, timing: 'melee' }] }));
check('once they reveal it is visible', C.dialHidden(wd, wd.tokens[1]), false);
// Outside Planning nothing is secret.
const wa = world([mech(1, 's1'), mech(2, 's2')], 2);
check('no dial is hidden outside the Planning Phase', C.dialHidden(wa, wa.tokens[1]), false);
C.setLocalSeat(null);
check('with no seat the networked filter is inert', C.dialHidden(planning(), planning().tokens[1]), false);

// ---------- the strict tracker ----------

const wstrict = world([mech(1, 's1', { stance: 'shutdown' })]);
C.apply(data, wstrict, { kind: 'setStrict', seat: 's1', strict: true });
check('setStrict flips the tracker on', wstrict.script.strict, true);
const vs = C.perform(data, wstrict, sc({ stance: 'mobility' }));
check('strict refuses instead of warning', [vs.ok, wstrict.tokens[0].stance], [false, 'shutdown']);
let told = null;
C.onRefused((why) => { told = why; });
C.perform(data, wstrict, sc({ stance: 'mobility' }));
check('and the reason reaches the presenter', typeof told, 'string');
C.onRefused(() => {});
C.apply(data, wstrict, { kind: 'setStrict', seat: 's1', strict: false });
const vt = C.perform(data, wstrict, sc({ stance: 'mobility' }));
check('teaching performs anyway and says why', [vt.ok, wstrict.tokens[0].stance], [false, 'mobility']);

// ---------- importSquad ----------

const squadCmd = (over = {}) => ({
  kind: 'importSquad', seat: 's1', name: 'Test',
  mechs: [{ loadout: { torso: 'T1', pilot: 'P1' } }],
  drones: [{ cardId: 'D1' }],
  ...over,
});
const openTable = () => ({ tokens: [], nextUid: 1, round: { n: 1, phase: 0, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 } });

check('a squad may join an open table', C.check(data, openTable(), squadCmd()).ok, true);
check('an empty squad is refused', C.check(data, openTable(), squadCmd({ mechs: [], drones: [] })).ok, false);
check('an unknown card is refused', C.check(data, openTable(), squadCmd({ mechs: [{ loadout: { torso: 'NOPE' } }] })).ok, false);
check('an unknown drone backpack is refused', C.check(data, openTable(), squadCmd({ drones: [{ cardId: 'D1', backpack: 'NOPE' }] })).ok, false);
check('a mech with no torso or chassis is refused', C.check(data, openTable(), squadCmd({ mechs: [{ loadout: { pilot: 'P1' } }] })).ok, false);

const during = { ...openTable(), script: { strict: true }, setup: { ...C.newSetup(), stage: 'deploy' } };
check('a squad may still join during deployment', C.check(data, during, squadCmd()).ok, true);
C.apply(data, during, squadCmd());
check('during setup the units wait for deployment', during.tokens.map((t) => t.deployed), [false, false]);
check('the mech carries its loadout and pilot link', [during.tokens[0].kind, during.tokens[0].link], ['mech', 4]);

const late = { ...openTable(), script: { strict: true }, setup: { ...C.newSetup(), stage: 'done' } };
check('a game past deployment refuses the squad', C.check(data, late, squadCmd()).ok, false);
// End game clears the setup but leaves the script for the record, and that
// table is back in free play — a lingering script must not lock it.
check('a lingering script without a setup does not lock the table', C.check(data, { ...openTable(), script: { strict: true } }, squadCmd()).ok, true);

const freeA = openTable();
C.apply(data, freeA, squadCmd());
check('on an open table the units land straight away', freeA.tokens.every((t) => t.deployed !== false), true);
const freeB = openTable();
C.apply(data, freeB, squadCmd());
check('and a mirrored seat lands them identically', JSON.stringify(freeB.tokens), JSON.stringify(freeA.tokens));
const freeC = openTable();
C.apply(data, freeC, squadCmd({ seat: 's2' }));
check('each squad arrives from its own edge', freeA.tokens[0].row < freeC.tokens[0].row, true);

// ---------- the table lifecycle ----------

const table = openTable();
check('configuring nothing is refused', C.check(data, table, { kind: 'configureTable', seat: 's1' }).ok, false);
check('a made-up scale is refused', C.check(data, table, { kind: 'configureTable', seat: 's1', scale: 'huge' }).ok, false);
C.apply(data, table, { kind: 'configureTable', seat: 's1', map: 'alley', scale: 'skirmish', roundLimit: 4 });
check('the table takes map, scale and length', [table.map, table.scale, table.roundLimit], ['alley', 'skirmish', 4]);
check('with no game running, ending is refused', C.check(data, table, { kind: 'endMatch', seat: 's1' }).ok, false);
check('starting a match is allowed', C.check(data, table, { kind: 'startMatch', seat: 's1' }).ok, true);
C.apply(data, table, { kind: 'startMatch', seat: 's1' });
check('the match begins at setup, round 1', [C.normaliseSetup(table.setup)?.stage, table.round.n], ['map', 1]);
check('a second start is refused', C.check(data, table, { kind: 'startMatch', seat: 's1' }).ok, false);
table.setup = { ...C.newSetup(), stage: 'roll' };
check('the battlefield locks once the game starts', C.check(data, table, { kind: 'configureTable', seat: 's1', map: 'other' }).ok, false);
check('but the game length may still change', C.check(data, table, { kind: 'configureTable', seat: 's1', roundLimit: 6 }).ok, true);
C.apply(data, table, { kind: 'endMatch', seat: 's1' });
check('ending clears the setup and the tasks', [table.setup, table.tasks], [null, null]);

// Ready is a lobby signal: it stops the host starting while the other player
// is still reading, and means nothing once the match is under way.
const lobby = openTable();
C.apply(data, lobby, { kind: 'setReady', seat: 's2', ready: true });
check('a seat can declare itself ready', [lobby.ready.s2, lobby.ready.s1], [true, undefined]);
C.apply(data, lobby, { kind: 'setReady', seat: 's2', ready: false });
check('and can take it back', lobby.ready.s2, false);
C.apply(data, lobby, { kind: 'startMatch', seat: 's1' });
check('starting the match clears the ready flags', JSON.stringify(lobby.ready), '{}');
check('ready is refused once the match runs', C.check(data, lobby, { kind: 'setReady', seat: 's2', ready: true }).ok, false);

// The same signal returns during deployment: Round 1 begins only when both
// squads have agreed, and touching the board withdraws that agreement.
const depLobby = { ...openTable(), tokens: [mech(1, 's1')], script: { strict: true }, setup: { ...C.newSetup(), stage: 'deploy' } };
check('ready is allowed during deployment', C.check(data, depLobby, { kind: 'setReady', seat: 's1', ready: true }).ok, true);
C.apply(data, depLobby, { kind: 'setReady', seat: 's1', ready: true });
C.apply(data, depLobby, { kind: 'setReady', seat: 's2', ready: true });
C.apply(data, depLobby, { kind: 'deployUnit', seat: 's1', uid: 1, to: { col: 2, row: 2 } });
check('a nudge after ready withdraws both agreements', JSON.stringify(depLobby.ready), '{}');
C.apply(data, depLobby, { kind: 'setReady', seat: 's1', ready: true });
C.apply(data, depLobby, { kind: 'finishDeployment', seat: 's1' });
check('finishing deployment consumes the ready flags', JSON.stringify(depLobby.ready), '{}');

// Neither of those agreements is only a drawn button: across a table the rule
// is checked here, so one player cannot start the game or end deployment on
// the other's behalf however the click was made.
const gate = { ...openTable(), tokens: [mech(1, 's1')], setup: { ...C.newSetup(), stage: 'deploy' } };
C.setLocalSeat('s1');
check('deployment will not finish with nobody ready',
  C.check(data, gate, { kind: 'finishDeployment', seat: 's1' }).ok, false);
C.apply(data, gate, { kind: 'setReady', seat: 's1', ready: true });
check('nor with only my own agreement',
  C.check(data, gate, { kind: 'finishDeployment', seat: 's1' }).ok, false);
C.apply(data, gate, { kind: 'setReady', seat: 's2', ready: true });
check('and finishes once both squads agree',
  C.check(data, gate, { kind: 'finishDeployment', seat: 's1' }).ok, true);

const launch = openTable();
check('a match will not start while the other player is not ready',
  C.check(data, launch, { kind: 'startMatch', seat: 's1' }).ok, false);
// Locking the battlefield used to build a setup out of nothing, which made it
// a back door into a running match that no agreement guarded.
check('and locking the battlefield is not a way in either',
  C.check(data, launch, { kind: 'lockMap', seat: 's1' }).ok, false);
C.apply(data, launch, { kind: 'setReady', seat: 's2', ready: true });
check('and starts once they are', C.check(data, launch, { kind: 'startMatch', seat: 's1' }).ok, true);
C.apply(data, launch, { kind: 'startMatch', seat: 's1' });
check('after which the battlefield locks normally',
  C.check(data, launch, { kind: 'lockMap', seat: 's1' }).ok, true);
C.setLocalSeat(null);
check('a solo game needs no such signal',
  C.check(data, openTable(), { kind: 'startMatch', seat: 's1' }).ok, true);
check('and finishes deployment on its own', C.check(data, gate, { kind: 'finishDeployment', seat: 's1' }).ok, true);

// A Task that names a Mech is only set up once it has been named, and the card
// decides who does the naming: Behead has the OPPONENT name one of their own.
const desig = { ...openTable(), tokens: [mech(1, 's1'), mech(2, 's2')] };
C.apply(data, desig, { kind: 'pickSecondary', seat: 's1', cardId: 'decapitation' });
const owed = C.taskDesignations(data, desig);
check('Behead leaves one thing to name', owed.length, 1);
check('it belongs to the squad that scores it, and the other names it',
  [owed[0].side, owed[0].by, owed[0].owner], ['s1', 's2', 's2']);
check('the scorer cannot name it themselves',
  C.check(data, desig, { kind: 'designateTask', seat: 's1', what: 'target', for: 's1', uid: 2 }).ok, false);
check('nor can the namer point at the wrong squad',
  C.check(data, desig, { kind: 'designateTask', seat: 's2', what: 'target', for: 's1', uid: 1 }).ok, false);
check('but the opponent may name one of their own',
  C.check(data, desig, { kind: 'designateTask', seat: 's2', what: 'target', for: 's1', uid: 2 }).ok, true);
C.apply(data, desig, { kind: 'designateTask', seat: 's2', what: 'target', for: 's1', uid: 2 });
check('and it is stored against the squad that scores it', desig.tasks.secTarget.s1, 2);
check('after which nothing is outstanding', C.taskDesignations(data, desig).length, 0);
// Changing the card must not keep a target chosen for the old one.
C.apply(data, desig, { kind: 'pickSecondary', seat: 's1', cardId: 'annihilation' });
check('changing the Task drops the name it carried', desig.tasks.secTarget.s1, undefined);

// Bounty Hunt names an enemy Mech, but the choice is the scorer's.
const bounty = { ...openTable(), tokens: [mech(1, 's1'), mech(2, 's2')] };
C.apply(data, bounty, { kind: 'pickSecondary', seat: 's1', cardId: 'bounty-hunt' });
const bo = C.taskDesignations(data, bounty)[0];
check('Bounty Hunt is the scorer\'s call about an enemy Mech', [bo.by, bo.owner], ['s1', 's2']);

check('an unknown Secondary Task is refused', C.check(data, openTable(), { kind: 'pickSecondary', seat: 's1', cardId: 'NOPE' }).ok, false);
const sec = openTable();
C.apply(data, sec, { kind: 'pickSecondary', seat: 's2', cardId: 'SEC1' });
check('a Secondary pick lands on that squad alone', [sec.tasks.secondary.s2, sec.tasks.secondary.s1], ['SEC1', null]);

// Networked, an attribution seat is stamped with the sender's own, because
// the relay refuses anything sent as the other player.
let stamped = null;
C.onPerformed((c) => { stamped = c; });
C.setLocalSeat('s2');
C.perform(data, openTable(), { kind: 'adjustCommandTokens', seat: 's1', pool: 's1', delta: 2 });
check('a table command travels stamped as the sender', stamped?.seat, 's2');
C.setLocalSeat(null);
C.onPerformed(() => {});

// ---------- Black Boxes (5.3.1) ----------
//
// The Freehand test is the real freehandSlots, so a Part that cannot carry one
// here cannot carry one in the app either.

// One Freehand arm and one ordinary torso, so "which Parts may carry it" is a
// real question rather than a formality.
const boxWorld = (over = {}) => ({
  ...world([
    mech(1, 's1', { mech: { torso: 'T1', rightHand: 'FH1', pilot: 'P1' }, partStates: { torso: 'intact', rightHand: 'intact' }, col: 12, row: 12 }),
    mech(2, 's2', { col: 15, row: 15 }),
  ]),
  tasks: { items: [{ id: 'bb1', kind: 'blackbox', zone: 'echo', col: 13, row: 13 }], ...over },
});
const take = (over = {}) => ({ kind: 'takeBlackBox', seat: 's1', uid: 1, itemId: 'bb1', slot: 'rightHand', ...over });

check('a Freehand Part may take a loose Black Box', C.check(data, boxWorld(), take()).ok, true);
check('a Part without the Freehand keyword may not', C.check(data, boxWorld(), take({ slot: 'torso' })).ok, false);
check('an unknown Box is refused', C.check(data, boxWorld(), take({ itemId: 'nope' })).ok, false);

const held = boxWorld();
C.apply(data, held, take());
check('the Box moves onto the unit', [held.tasks.items[0].bearerUid, held.tasks.items[0].bearerSlot], [1, 'rightHand']);
check('and leaves the board', [held.tasks.items[0].col, held.tasks.items[0].row], [undefined, undefined]);
check('taking it twice is refused', C.check(data, held, take()).ok, false);
// A Part bearing one has its Freehand treated as invalid, so a second Box
// needs a second Freehand Part.
const two = { ...held, tasks: { items: [...held.tasks.items, { id: 'bb2', kind: 'blackbox', zone: 'golf', col: 13, row: 13 }] } };
check('a second Box needs another free Freehand', C.check(data, two, take({ itemId: 'bb2' })).ok, false);
// Give it a second Freehand Part and the second Box goes on that one.
const twoHands = JSON.parse(JSON.stringify(two));
twoHands.tokens[0].mech.leftHand = 'FH1';
twoHands.tokens[0].partStates.leftHand = 'intact';
check('a second Freehand Part may take the second Box', C.check(data, twoHands, take({ itemId: 'bb2', slot: 'leftHand' })).ok, true);
check('but not the Part already holding one', C.check(data, twoHands, take({ itemId: 'bb2', slot: 'rightHand' })).ok, false);

const destroyed = boxWorld();
destroyed.tokens[0].partStates.rightHand = 'destroyed';
check('a destroyed Part carries nothing', C.check(data, destroyed, take()).ok, false);
const proj = boxWorld();
proj.tokens[0].kind = 'projectile';
check('a Projectile never picks one up', C.check(data, proj, take()).ok, false);
check('nor may the other squad command the unit', C.check(data, boxWorld(), take({ seat: 's2' })).ok, false);

// Dropping: the ATTACKER says where, so the seat is deliberately not the
// bearer's, and the Grid has to touch the bearer's own.
const drop = (over = {}) => ({ kind: 'dropBlackBox', seat: 's2', uid: 2, itemId: 'bb1', to: { col: 13, row: 13 }, ...over });
check('a loose Box cannot be dropped', C.check(data, boxWorld(), drop()).ok, false);
check('the attacker drops it beside the bearer', C.check(data, held, drop()).ok, true);
check('and not across the board', C.check(data, held, drop({ to: { col: 33, row: 33 } })).ok, false);
check('a diagonal Grid is still contact', C.check(data, held, drop({ to: { col: 10, row: 10 } })).ok, true);
check('off the board is refused', C.check(data, held, drop({ to: { col: -1, row: 4 } })).ok, false);

const dropped = JSON.parse(JSON.stringify(held));
C.apply(data, dropped, drop());
check('the Box lands where the attacker said', [dropped.tasks.items[0].col, dropped.tasks.items[0].row], [13, 13]);
check('and nobody is carrying it', dropped.tasks.items[0].bearerUid, undefined);
// The attacker may be a Projectile that is spent before the Grid is chosen.
const gone = JSON.parse(JSON.stringify(held));
gone.tokens = gone.tokens.filter((t) => t.uid !== 2);
check('a drop survives its attacker leaving the board', C.check(data, gone, drop()).ok, true);

// ---------- a Drone's activation (2.4.1) ----------
//
// One Action or one Movement, never both. A Mech's Passives are length-less
// too, so this has to key off the unit rather than off the Action.

// The attack carries the AUTOMATIC icon, like both starter drones' attacks do,
// so it is legal in the Automatic Phase fixture below (3.5).
const dAct = { id: 'DA', type: 'Firing', speed: 'auto', name: { en: 'Full-auto' } }; // no size: no Tick price
const dData = { ...data, byId: new Map([...data.byId, ['DR1', { id: 'DR1', actions: [dAct] }]]) };
const droneTok = () => ({ uid: 1, side: 's1', kind: 'drone', stance: 'offensive', label: 'D1', col: 3, row: 3, facing: 0, cardId: 'DR1', partStates: { main: 'intact' }, ammo: {} });
const droneAt = (over = {}) => world([droneTok()], 3, opp(1, over));
// The same Drone activated by a Command instead (phase 0), where the move is.
const droneCmdAt = (over = {}) => world([droneTok()], 0, opp(1, over));
const dPerform = { kind: 'performAction', seat: 's1', uid: 1, actionId: 'DA' };
const dMove = { kind: 'maneuver', seat: 's1', uid: 1, to: { col: 9, row: 9 } };

check('a fresh Drone may act', C.check(dData, droneAt(), dPerform).ok, true);
check('and may move instead', C.check(dData, droneCmdAt(), dMove).ok, true);

// The icon lock (3.2.2 ② / 3.5): the Automatic Action is refused on a Command,
// and Movement is refused in the Automatic Phase — both were let through in a
// real game, an Automatic attack firing off a Command and drones walking in
// the Automatic Phase.
check('an Automatic Action is refused on a Command', C.check(dData, droneCmdAt(), dPerform).ok, false);
check('a Drone cannot move in the Automatic Phase', C.check(dData, droneAt(), dMove).ok, false);
check('and is told why', C.check(dData, droneAt(), dMove).why.includes('Automatic'), true);

// Acting spends the whole activation.
const dActed = droneAt();
C.apply(dData, dActed, dPerform);
check('acting closes the activation', [dActed.script.opp.started, dActed.script.opp.maneuver], [true, 0]);
check('so it cannot act again', C.check(dData, dActed, dPerform).ok, false);
check('and cannot then move', C.check(dData, dActed, dMove).ok, false);
// Only one of the two flags is ever set, so the refusal can name what it was.
check('and is told it acted, not that it moved', C.check(dData, dActed, dPerform).why.includes('already acted'), true);
check('while one that moved is told it moved', C.check(dData, (() => { const w = droneAt(); C.apply(dData, w, dMove); return w; })(), dPerform).why.includes('already moved'), true);

// And moving spends it just the same — this is the bug that let a Drone move
// and then shoot in a real game.
const dMoved = droneAt();
C.apply(dData, dMoved, dMove);
check('moving closes the activation too', dMoved.script.opp.maneuvered, true);
check('so it cannot then act', C.check(dData, dMoved, dPerform).ok, false);

// A Mech's Passive is length-less as well, and must NOT eat its Opportunity.
const passive = { id: 'P9', type: 'Passive', name: { en: 'Data Link' } };
const mData = { ...data, byId: new Map([...data.byId, ['T9', { id: 'T9', actions: [passive] }]]) };
const wPass = world([mech(1, 's1', { mech: { torso: 'T9', pilot: 'P1' } })], 2, opp(1));
C.apply(mData, wPass, { kind: 'performAction', seat: 's1', uid: 1, actionId: 'P9' });
check('a Mech Passive spends none of its Opportunity', [wPass.script.opp.action, wPass.script.opp.maneuver, wPass.script.opp.started], [2, 1, false]);

// ---------- the Stance lock (4.1) ----------
//
// A Mech chooses its Stance each Action Opportunity, BEFORE the choice to
// Maneuver — and the dial stays live until it does one of them, because
// cycling it to see which Actions each Stance opens up is how the choice gets
// made. An earlier version enforced 4.1 by refusing every Action until a
// Stance was pressed, which OTTO found got in the way of exactly that reading.
// So: free to change while nothing has happened, set the moment it acts.

const mAct = { kind: 'performAction', seat: 's1', uid: 1, actionId: 'A1' };
const mMove = { kind: 'maneuver', seat: 's1', uid: 1, to: { col: 6, row: 3 } };
const stanceTo = (x) => ({ kind: 'setStance', seat: 's1', uid: 1, stance: x });
C.setLocalSeat('s1');

const wlock = world([mech(1, 's1')], 2, opp(1));
check('a Mech may act without pressing a Stance first', C.check(data, wlock, mAct).ok, true);
check('and may Maneuver', C.check(data, wlock, mMove).ok, true);
check('the dial is open before it acts', C.check(data, wlock, stanceTo('mobility')).ok, true);
C.apply(data, wlock, stanceTo('mobility'));
check('choosing does not lock by itself', wlock.script.opp.stanceLocked === true, false);
check('so it may still be changed again', C.check(data, wlock, stanceTo('defensive')).ok, true);

// Acting is what closes it.
const wacted = world([mech(1, 's1')], 2, opp(1));
C.apply(data, wacted, mAct);
check('performing an Action sets the Stance', wacted.script.opp.stanceLocked, true);
check('and a different Stance is then refused', C.check(data, wacted, stanceTo('mobility')).ok, false);
check('with 4.1 as the reason', (C.check(data, wacted, stanceTo('mobility')).why ?? '').includes('4.1'), true);
check('re-picking the SAME Stance is not a change, so it passes',
  C.check(data, wacted, stanceTo(wacted.tokens[0].stance)).ok, true);

// Maneuvering closes it just as an Action does.
const wmoved = world([mech(1, 's1')], 2, opp(1));
C.apply(data, wmoved, mMove);
check('a Maneuver sets the Stance too', wmoved.script.opp.stanceLocked, true);

// A Drone plays the Stance printed on its card, so there is nothing to lock.
const wdstance = world([drone(1, 's1')], 2, opp(1));
C.apply(data, wdstance, { kind: 'maneuver', seat: 's1', uid: 1, to: { col: 6, row: 3 } });
check('a Drone never gains a Stance lock', wdstance.script.opp.stanceLocked === true, false);

// A Reboot IS the stance choice (4.1.1), and consumes the Opportunity but one Tick.
const wshut = world([mech(1, 's1', { stance: 'shutdown', link: 2 })], 2, opp(1));
C.apply(data, wshut, { kind: 'reboot', seat: 's1', uid: 1, stance: 'defensive' });
check('a Reboot sets the Stance for its one Tick', wshut.script.opp.stanceLocked, true);

C.setLocalSeat(null);
const wfreeplay = world([mech(1, 's1')], 2, opp(1));
check('freeplay acts freely as well', C.check(data, wfreeplay, mAct).ok, true);

// ---------- the Focus handshake (4.4.1-5) ----------
//
// The remote defender's declare and reroll ride in commands the way the
// defence roll does. The board carries nothing for them to change — the
// attacking client's combat window consumes them as they are observed — so
// the checks are about shape, not state.

const wfoc = world([mech(1, 's1')], 2, opp(1));
check('a Focus answer needs a running game', C.check(data, { tokens: [], round: { n: 1, phase: 2, firstPlayer: 's1' } }, { kind: 'focusAnswer', seat: 's2', use: true }).ok, false);
check('a boolean answer passes', C.check(data, wfoc, { kind: 'focusAnswer', seat: 's2', use: true }).ok, true);
check('a non-boolean answer is refused', C.check(data, wfoc, { kind: 'focusAnswer', seat: 's2', use: 'yes' }).ok, false);
check('a Focus reroll with matching lists passes', C.check(data, wfoc, { kind: 'focusReroll', seat: 's2', indices: [0, 2], faces: [{ color: 'white', face: 1 }, { color: 'blue', face: 3 }] }).ok, true);

// ---------- Designate the hit Part (Shield Up / Mobile Defense) ----------
//
// The defender may take a hit on a Part that Designates instead of the one the
// Black Die found. Online the choice is THEIRS, so it travels as a command the
// attacker's open window consumes — the same shape as focusAnswer, and like it
// the board carries nothing for apply() to change.

check('a Designate needs a running game',
  C.check(data, { tokens: [], round: { n: 1, phase: 2, firstPlayer: 's1' } }, { kind: 'designateHit', seat: 's2', slot: 'leftHand' }).ok, false);
check('a slot passes', C.check(data, wfoc, { kind: 'designateHit', seat: 's2', slot: 'leftHand' }).ok, true);
check('an empty slot is refused', C.check(data, wfoc, { kind: 'designateHit', seat: 's2', slot: '' }).ok, false);
check('a non-string slot is refused', C.check(data, wfoc, { kind: 'designateHit', seat: 's2', slot: 7 }).ok, false);
// It is the DEFENDER's answer, so it is not tied to a unit the sender owns.
check('it is actor-optional, like the rest of the combat handshake',
  C.check(data, wfoc, { kind: 'designateHit', seat: 's2', slot: 'torso' }).ok, true);
const wdes = world([mech(1, 's1')], 2, opp(1));
const beforeDes = JSON.stringify(wdes);
C.apply(data, wdes, { kind: 'designateHit', seat: 's2', slot: 'leftHand' });
check('apply changes no board state', JSON.stringify(wdes), beforeDes);

check('an empty reroll is the "kept it" answer and passes', C.check(data, wfoc, { kind: 'focusReroll', seat: 's2', indices: [], faces: [] }).ok, true);
check('mismatched lists are refused', C.check(data, wfoc, { kind: 'focusReroll', seat: 's2', indices: [0], faces: [] }).ok, false);
check('an absurd die index is refused', C.check(data, wfoc, { kind: 'focusReroll', seat: 's2', indices: [99], faces: [{ color: 'white', face: 1 }] }).ok, false);
check('a malformed face is refused', C.check(data, wfoc, { kind: 'focusReroll', seat: 's2', indices: [0], faces: [{ color: 7, face: 'x' }] }).ok, false);

// ---------- standing spot inside a Grid (4.2.3) ----------
//
// Costs no Movement Range and never leaves the Grid, but it decides Contact,
// so it is a real command rather than a drag. A unit at col/row 3,3 is in
// Large Grid 1,1, whose Small cells run 3..5 on both axes.

const spotAt = (col, row) => ({ kind: 'placeInGrid', seat: 's1', uid: 1, to: { col, row } });
const wspot = world([mech(1, 's1', { size: 1, col: 4, row: 4 }), mech(2, 's2', { col: 30, row: 30 })], 2);
check('a spot in the same Grid passes', C.check(data, wspot, spotAt(3, 5)).ok, true);
check('a spot in the NEXT Grid is refused', C.check(data, wspot, spotAt(6, 4)).ok, false);
check('and says it is not a Maneuver', C.check(data, wspot, spotAt(6, 4)).why.includes('Maneuver'), true);
check('off the board is refused', C.check(data, wspot, spotAt(-1, 4)).ok, false);
C.apply(data, wspot, spotAt(3, 5));
check('the unit takes the spot', [wspot.tokens[0].col, wspot.tokens[0].row], [3, 5]);
// A Large unit fills its Grid, so there is nothing to choose.
const wbig = world([mech(1, 's1', { size: 3, col: 3, row: 3 })], 2);
check('a Large unit has no spot to pick', C.check(data, wbig, spotAt(4, 4)).ok, false);
// Another unit standing on the cell blocks it.
const wblock = world([mech(1, 's1', { size: 1, col: 4, row: 4 }), mech(2, 's2', { size: 1, col: 3, row: 5 })], 2);
check('an occupied cell is refused', C.check(data, wblock, spotAt(3, 5)).ok, false);

// ---------- Concussion/Wrecking's Link drain (4.10) ----------
//
// Each Lightning in the Attack Roll strips 1 Link, sent once by the attacking
// client as the resolution applies. Actor-optional like recordKill: a spent
// Projectile's Wrecking still lands.

const wdrain = world([mech(1, 's1'), mech(2, 's2', { link: 2, col: 9, row: 9 })], 2);
check('a drain on a mech passes', C.check(data, wdrain, { kind: 'drainLink', seat: 's1', uid: 1, targetUid: 2, n: 1 }).ok, true);
check('a drone has no Link to lose', C.check(data, world([mech(1, 's1'), { uid: 3, side: 's2', kind: 'drone', stance: 'defensive', label: 'D', col: 9, row: 9, cardId: 'D1', partStates: { main: 'intact' } }], 2), { kind: 'drainLink', seat: 's1', uid: 1, targetUid: 3, n: 1 }).ok, false);
check('a silly count is refused', C.check(data, wdrain, { kind: 'drainLink', seat: 's1', uid: 1, targetUid: 2, n: 0 }).ok, false);
C.apply(data, wdrain, { kind: 'drainLink', seat: 's1', uid: 1, targetUid: 2, n: 1 });
check('the Link comes off', wdrain.tokens[1].link, 1);
C.apply(data, wdrain, { kind: 'drainLink', seat: 's1', uid: 1, targetUid: 2, n: 5 });
check('it clamps at zero and Shuts Down', [wdrain.tokens[1].link, wdrain.tokens[1].stance], [0, 'shutdown']);
check('a KC Armor declare needs a running game', C.check(data, { tokens: [], round: { n: 1, phase: 2, firstPlayer: 's1' } }, { kind: 'kcArmor', seat: 's2' }).ok, false);
check('and passes with one', C.check(data, wdrain, { kind: 'kcArmor', seat: 's2' }).ok, true);

// ---------- the hand of Tactics Cards (5.4) ----------
//
// It has to travel: check() for playTactic reads the SENDER's hand, so a hand
// set locally is one the receiving client would refuse a play against.

const tacHand = (over = {}) => ({ kind: 'setTactics', seat: 's1', cards: ['274'], ...over });
check('a squad may take a Tactics Card', C.check(data, openTable(), tacHand()).ok, true);
check('an empty hand is allowed', C.check(data, openTable(), tacHand({ cards: [] })).ok, true);
check('something that is not a Tactics Card is refused', C.check(data, openTable(), tacHand({ cards: ['T1'] })).ok, false);
check('an unknown card is refused', C.check(data, openTable(), tacHand({ cards: ['NOPE'] })).ok, false);
check('an absurd hand is refused', C.check(data, openTable(), tacHand({ cards: Array(9).fill('274') })).ok, false);

const wHand = openTable();
C.apply(data, wHand, tacHand({ cards: ['274', '275'] }));
check('the hand lands on that squad alone', [wHand.tactics.s1, wHand.tactics.s2], [['274', '275'], []]);
// The whole hand travels each time, so a command applied twice cannot double it.
C.apply(data, wHand, tacHand({ cards: ['274', '275'] }));
check('applying it again does not double the hand', wHand.tactics.s1, ['274', '275']);
C.apply(data, wHand, tacHand({ cards: ['274'] }));
check('and putting one back replaces the hand', wHand.tactics.s1, ['274']);

// Hands are chosen with the squad, not drawn mid-match.
const midGame = { ...openTable(), setup: { ...C.newSetup(), stage: 'done' } };
check('the hand closes once the game is running', C.check(data, midGame, tacHand()).ok, false);
const deploying = { ...openTable(), setup: { ...C.newSetup(), stage: 'deploy' } };
check('but is still open during deployment', C.check(data, deploying, tacHand()).ok, true);

// ---------- determinism ----------

const a = wm();
const b = wm();
C.apply(data, a, mv());
C.apply(data, b, mv());
check('apply is deterministic across copies', JSON.stringify(a.script.opp), JSON.stringify(b.script.opp));

// ---------- Pholcus unfolds (FAQ M8/M18) ----------

const pho = (uid = 1, over = {}) => ({
  uid, side: 's1', kind: 'projectile', cardId: '156', label: 'Pholcus', col: 3, row: 3,
  facing: 0, size: 1, aerial: true, stance: 'mobility', partStates: { main: 'intact' }, ammo: {}, ...over,
});
const uf = (over = {}) => ({ kind: 'unfold', seat: 's1', uid: 1, ...over });
// The replacement is a Delay Phase act, which is exactly why the Drone cannot
// attack in the round it Unfolds - the Automatic Phase is already past (M8).
check('unfolding outside the Delay Phase is refused', C.check(data, world([pho()], 2), uf()).ok, false);
check('and in the Delay Phase it passes', C.check(data, world([pho()], 4), uf()).ok, true);
check('a unit that does not Unfold is refused', C.check(data, world([mech(1, 's1')], 4), uf()).ok, false);
check('and the other squad may not Unfold it', C.check(data, world([pho()], 4), uf({ seat: 's2' })).ok, false);
const wuf = world([pho()], 4);
C.apply(data, wuf, uf());
check('the Projectile becomes its Drone form in place',
  [wuf.tokens[0].cardId, wuf.tokens[0].kind, wuf.tokens[0].aerial], ['167', 'drone', false]);
check('and keeps the same piece on the same spot',
  [wuf.tokens[0].uid, wuf.tokens[0].col, wuf.tokens[0].row, wuf.tokens[0].side], [1, 3, 3, 's1']);

// ---------- Tarantula Loads (FAQ O3-O8, O16-O18) ----------

// A Carrier standing against the Mech, with a Backpack on its back.
const loadCarrier = (uid, over = {}) => ({
  uid, side: 's1', kind: 'drone', cardId: 'CAR', droneBackpack: 'BP1', label: `T${uid}`,
  col: 6, row: 3, facing: 0, size: 1, aerial: false, stance: 'mobility',
  partStates: { main: 'intact', backpack: 'intact' }, ammo: { BP1_A: 2 }, ...over,
});
const loadAct = (over = {}) => ({ kind: 'performAction', seat: 's1', uid: 1, actionId: 'BP1_A', ...over });

// The Mech has no such Part of its own; the loan is what makes the Action legal.
const wLoanNear = world([mech(1, 's1'), loadCarrier(2)], 2, opp(1, { timing: 'firing' }));
check('a Load lends its Action to the Mech in Contact', C.check(data, wLoanNear, loadAct()).ok, true);
const wLoanFar = world([mech(1, 's1'), loadCarrier(2, { col: 20 })], 2, opp(1, { timing: 'firing' }));
check('but only while they are touching', C.check(data, wLoanFar, loadAct()).ok, false);
const wLoanBare = world([mech(1, 's1'), loadCarrier(2, { droneBackpack: undefined })], 2, opp(1, { timing: 'firing' }));
check('a Tarantula may carry nothing at all (O8)', C.check(data, wLoanBare, loadAct()).ok, false);
const wLoanEnemy = world([mech(1, 's1'), loadCarrier(2, { side: 's2' })], 2, opp(1, { timing: 'firing' }));
check('and an enemy Tarantula lends nothing', C.check(data, wLoanEnemy, loadAct()).ok, false);

// The magazine stays on the Drone that is carrying the Part.
const wLoanAmmo = world([mech(1, 's1'), loadCarrier(2)], 2, opp(1, { timing: 'firing' }));
C.apply(data, wLoanAmmo, { kind: 'spendAmmo', seat: 's1', uid: 1, actionId: 'BP1_A' });
check("firing a Load spends the Tarantula Ammo, not the Mech magazine",
  [wLoanAmmo.tokens[1].ammo.BP1_A, wLoanAmmo.tokens[0].ammo?.BP1_A], [1, undefined]);

// FAQ O7: two Tarantulas carrying the same Backpack are two Parts, so the same
// Action may be taken once from each in one Opportunity.
const wLoanTwo = world([mech(1, 's1'), loadCarrier(2), loadCarrier(3, { col: 2 })], 2, opp(1, { timing: 'firing' }));
C.apply(data, wLoanTwo, loadAct({ partKey: 'BP1_A@2' }));
check('the first loan is recorded against its lender', wLoanTwo.script.opp.performed, ['BP1_A@2']);
check('the second Tarantula lends the same Action again (O7)',
  C.check(data, wLoanTwo, loadAct({ partKey: 'BP1_A@3' })).ok, true);
check('but the same lender cannot repeat it',
  C.check(data, wLoanTwo, loadAct({ partKey: 'BP1_A@2' })).ok, false);

// FAQ O5: the Initiator of a Counter-roll counts its Loads. T1 carries no
// Electronic Value, so the only way this passes is the borrowed Pod.
const wLoanEw = world([mech(1, 's1'), loadCarrier(2), mech(9, 's2', { col: 9 })], 2, opp(1));
check('a borrowed Pod lets a Mech Initiate a Counter-roll (O5)',
  C.check(data, wLoanEw, { kind: 'startCounterRoll', seat: 's1', uid: 1, targetUid: 9, actionId: 'BP1_A' }).ok, true);
const wLoanNoEw = world([mech(1, 's1'), mech(9, 's2', { col: 9 })], 2, opp(1));
check('and without one it is refused',
  C.check(data, wLoanNoEw, { kind: 'startCounterRoll', seat: 's1', uid: 1, targetUid: 9, actionId: 'BP1_A' }).ok, false);

// FAQ O19: an allied Repeater lends its position, and the Action's own Range is
// measured from there rather than from the attacker.
const relayDrone = (uid, col) => ({
  uid, side: 's1', kind: 'drone', cardId: 'REP', label: `R${uid}`, col, row: 3, facing: 0,
  size: 1, aerial: false, stance: 'mobility', partStates: { main: 'intact' }, ammo: {},
});
const ewShot = (over = {}) => ({ kind: 'startCounterRoll', seat: 's1', uid: 1, targetUid: 9, actionId: 'BP1_A', ...over });
const wRelayNone = world([mech(1, 's1'), loadCarrier(2), mech(9, 's2', { col: 33 })], 2, opp(1));
check('a target beyond the Action Range is refused', C.check(data, wRelayNone, ewShot()).ok, false);
const wRelay = world([mech(1, 's1'), loadCarrier(2), relayDrone(3, 21), mech(9, 's2', { col: 33 })], 2, opp(1));
check('but a Repeater covering the Mech brings it in Range (O19)', C.check(data, wRelay, ewShot()).ok, true);

// ---------- M2 Data Link: a grid before acting ----------
//
// A Drone's activation normally buys ONE Action or ONE Movement (2.4.1). "May
// move 1 grid before performing Actions" leaves the activation open for a move
// within that allowance, and only that one. canActivate did not change: the
// free move simply never sets `maneuvered`.

const m2World = (torso) => world([
  mech(1, 's1', { mech: { torso, pilot: 'P1' } }),
  { ...drone(2, 's1', { cardId: '167', col: 9, row: 9 }), commandedBy: 1 },
], 0, opp(2));
const mvTo = (col, row) => ({ kind: 'maneuver', seat: 's1', uid: 2, to: { col, row } });

// A Large Grid is 3 small cells, so col 9 -> 12 is exactly one grid.
const wM2 = m2World('M2T');
C.apply(data, wM2, mvTo(12, 9));
check('a 1-grid move leaves the activation open', wM2.script.opp.maneuvered, false);
check('and is recorded as the free grid', wM2.script.opp.preMoved, true);
C.apply(data, wM2, mvTo(15, 9));
check('a second move spends the activation', wM2.script.opp.maneuvered, true);

const wM2Far = m2World('M2T');
C.apply(data, wM2Far, mvTo(21, 9));
check('a move beyond the allowance spends it outright', wM2Far.script.opp.maneuvered, true);
check('and is not the free grid', wM2Far.script.opp.preMoved, undefined);

const wNoRider = m2World('T1');
C.apply(data, wNoRider, mvTo(12, 9));
check('without the rider even one grid closes it', wNoRider.script.opp.maneuvered, true);

// "BEFORE performing Actions": once it has acted, the grid is gone.
const wM2Acted = m2World('M2T');
wM2Acted.script.opp.started = true;
C.apply(data, wM2Acted, mvTo(12, 9));
check('and it is not offered after the Drone has acted', wM2Acted.script.opp.preMoved, undefined);


// ---------- Melee Evasion travels like KC Armor ----------
//
// A defender-side declaration consumed by the attacker's open window. The board
// carries nothing for apply() to change: the Command Token is spent by its own
// spendCommand, so neither seat can end up with a half-applied ability.

check('a Melee Evasion needs a running game',
  C.check(data, { tokens: [], round: { n: 1, phase: 2, firstPlayer: 's1' } }, { kind: 'meleeEvade', seat: 's2' }).ok, false);
check('and passes with one', C.check(data, wfoc, { kind: 'meleeEvade', seat: 's2' }).ok, true);
const wEvade = world([mech(1, 's1')], 2, opp(1));
const beforeEvade = JSON.stringify(wEvade);
C.apply(data, wEvade, { kind: 'meleeEvade', seat: 's2' });
check('apply changes no board state', JSON.stringify(wEvade), beforeEvade);


// ---------- Dodge Enhancement travels the same way ----------
//
// Its card-mate, and deliberately the same shape: a defender-side declaration
// the attacker's window consumes, with the Token spent by its own command.

check('a Dodge Enhancement needs a running game',
  C.check(data, { tokens: [], round: { n: 1, phase: 2, firstPlayer: 's1' } }, { kind: 'dodgeEnhance', seat: 's2' }).ok, false);
check('and passes with one', C.check(data, wfoc, { kind: 'dodgeEnhance', seat: 's2' }).ok, true);
const wDodgeDie = world([mech(1, 's1')], 2, opp(1));
const beforeDodgeDie = JSON.stringify(wDodgeDie);
C.apply(data, wDodgeDie, { kind: 'dodgeEnhance', seat: 's2' });
check('apply changes no board state', JSON.stringify(wDodgeDie), beforeDodgeDie);

// ---------- Target Tracing opens a Counter-roll it has no Range for ----------
//
// The reaction flag skips the Range test, so the gate that keeps it honest is
// "does this Mech actually carry the Passive". That is the whole rule.
const traceCard = {
  id: 'TT1', category: 'part', slot: 'torso', electronic: 3,
  actions: [{ id: 'TT1_A', name: { en: 'Target Tracing' }, type: 'Passive',
    description: { en: '· When this mech is attacked by an Enemy Mech, it may spend 1 Command Token to perform an Electronic Counter Roll against the Attacker. If successful, the Attacker loses 1 Link.' } }],
};
data.byId.set('TT1', traceCard);
const tracer = (statuses = ['command']) => ({
  uid: 1, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive', link: 3, statuses,
  mech: { torso: 'TT1' }, partStates: { torso: 'intact' }, label: 'Hunter', ammo: {},
});
const far = { uid: 2, kind: 'mech', side: 's2', col: 30, row: 30, stance: 'offensive', link: 3,
  mech: { torso: 'TT1' }, partStates: { torso: 'intact' }, label: 'Prey', ammo: {}, statuses: [] };
const wTrace = world([tracer(), far], 2, opp(1));
const traceCmd = (over = {}) => ({ kind: 'startCounterRoll', seat: 's1', uid: 1, targetUid: 2, actionId: 'TT1_A', ...over });
check('a Counter-roll at Range 30 is refused as an Action', C.check(data, wTrace, traceCmd()).ok, false);
check('and allowed as a reaction, which the attack already paid the Range for',
  C.check(data, wTrace, traceCmd({ reaction: true })).ok, true);
check('a Mech without the Passive cannot claim the reaction',
  C.check(data, world([{ ...tracer(), mech: { torso: 'BP1' } }, far], 2, opp(1)), traceCmd({ reaction: true })).ok, false);
check('naming a different Action does not open it either',
  C.check(data, wTrace, traceCmd({ reaction: true, actionId: 'TT1_B' })).ok, false);
check('and no Command Token means no reaction at all',
  C.check(data, world([tracer([]), far], 2, opp(1)), traceCmd({ reaction: true })).ok, false);
// The reaction skips Range, never the other 4.11.2 bars.
check('an ally is still not a legal Responder',
  C.check(data, world([tracer(), { ...far, side: 's1', uid: 2 }], 2, opp(1)), traceCmd({ reaction: true })).ok, false);

// ---------- Defense Reaction changes Stance when 4.1 would not ----------
//
// Its own command precisely so the Stance lock stays intact for everyone else:
// a setStance that ignored `stanceLocked` would hand the freedom to every Mech.
const drCard = {
  id: 'DR1', category: 'part', slot: 'torso', structure: 2,
  actions: [{ id: 'DR1_A', name: { en: 'Defense Reaction' }, type: 'Passive',
    description: { en: '· If Penetration occurs against any Part of this Mech, it may immediately change to Defensive Stance.' } }],
};
data.byId.set('DR1', drCard);
const shielded = (over = {}) => ({
  uid: 1, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive', link: 3, statuses: [],
  mech: { torso: 'DR1' }, partStates: { torso: 'intact' }, label: 'Buckler', ammo: {}, ...over,
});
const drCmd = { kind: 'defenseReaction', seat: 's1', uid: 1 };
const wDr = world([shielded()], 2, opp(1));
check('a Mech carrying it may react', C.check(data, wDr, drCmd).ok, true);
// The lock is the whole reason this is not a setStance.
const locked = world([shielded()], 2, { ...opp(1), stanceLocked: true });
check('and the Stance lock does not stop it',
  C.check(data, locked, drCmd).ok, true);
check('while an ordinary Stance change is still locked out',
  C.check(data, locked, { kind: 'setStance', seat: 's1', uid: 1, stance: 'defensive' }).ok, false);
check('a Mech without the Part cannot',
  C.check(data, world([shielded({ mech: { torso: 'BP1' } })], 2, opp(1)), drCmd).ok, false);
check('nor one already in Defensive Stance',
  C.check(data, world([shielded({ stance: 'defensive' })], 2, opp(1)), drCmd).ok, false);
check('nor one that is Shut Down, which takes a Reboot',
  C.check(data, world([shielded({ stance: 'shutdown' })], 2, opp(1)), drCmd).ok, false);
check('nor one whose Torso is gone',
  C.check(data, world([shielded({ partStates: { torso: 'destroyed' } })], 2, opp(1)), drCmd).ok, false);
const wApply = world([shielded()], 2, opp(1));
C.apply(data, wApply, drCmd);
check('applying it puts the Mech in Defensive Stance', wApply.tokens[0].stance, 'defensive');

// ---------- Riposte: the one Action performed outside an Opportunity ----------
//
// The `granted` flag must never be self-authorising. Everything below is about
// that: the debt in shared state is the only thing that lets it through, and it
// buys a Melee Action and nothing else.
const clawCard = {
  id: 'RP1', category: 'part', slot: 'leftHand',
  actions: [
    { id: 'RP1_A', name: { en: 'Tear' }, type: 'Melee', size: 's', range: 1 },
    { id: 'RP1_S', name: { en: 'Shoot' }, type: 'Firing', size: 's', range: 4 },
    { id: 'RP1_B', name: { en: 'Reposte' }, type: 'Passive',
      description: { en: '· On a Successful Parry with this part, the Attacker must immediately end the current Action Opportunity, and then the Defender may immediately perform a Melee Action.' } },
  ],
};
data.byId.set('RP1', clawCard);
const claw = { uid: 1, kind: 'mech', side: 's1', col: 0, row: 0, stance: 'offensive', link: 3, statuses: [],
  mech: { torso: 'RP1' }, partStates: { torso: 'intact' }, label: 'Claw', ammo: {} };
const foe = { uid: 2, kind: 'mech', side: 's2', col: 1, row: 0, stance: 'offensive', link: 3, statuses: [],
  mech: { torso: 'RP1' }, partStates: { torso: 'intact' }, label: 'Foe', ammo: {} };
const owing = (extra = {}) => {
  const w = world([claw, foe], 2, opp(2));
  w.script.reactions = [{ uid: 1, actionId: 'RP1_B', count: 0, range: 0, kind: 'riposte', fromUid: 2, ...extra }];
  return w;
};
const grantedMelee = { kind: 'performAction', seat: 's1', uid: 1, actionId: 'RP1_A', granted: true };
check('an Action outside an Opportunity is refused without a grant',
  C.check(data, world([claw, foe], 2, opp(2)), grantedMelee).ok, false);
check('and allowed with one', C.check(data, owing(), grantedMelee).ok, true);
check('but the grant buys a MELEE Action, not any Action',
  C.check(data, owing(), { ...grantedMelee, actionId: 'RP1_S' }).ok, false);
check('a debt owed to another unit does not authorise this one',
  C.check(data, owing({ uid: 2 }), grantedMelee).ok, false);
// Spent by the Action's own apply, so one Riposte can never buy two Melees.
const wSpend = owing();
C.apply(data, wSpend, grantedMelee);
check('taking it spends the grant', wSpend.script.reactions.length, 0);
check('so a second Melee is refused', C.check(data, wSpend, grantedMelee).ok, false);
check('and it charges no Ticks, because it belongs to no Opportunity',
  JSON.stringify(wSpend.script.opp), JSON.stringify(owing().script.opp));

// ---------- and the half that ends the ATTACKER's Opportunity ----------
const ripCmd = { kind: 'riposte', seat: 's1', uid: 1, fromUid: 2 };
check('the riposte command needs the debt too',
  C.check(data, world([claw, foe], 2, opp(2)), ripCmd).ok, false);
check('and it must name the Opportunity that is actually open',
  C.check(data, owing(), { ...ripCmd, fromUid: 9 }).ok, false);
check('with both, it passes', C.check(data, owing(), ripCmd).ok, true);
const wEnd = owing();
C.apply(data, wEnd, ripCmd);
check('applying it ends that Opportunity', wEnd.script.opp, null);
check('and marks the attacker as having acted', wEnd.script.acted, [2]);
// K19: a nested Extra Opportunity resumes what it interrupted and never marks
// the echoed Mech as acted.
const wNested = owing();
wNested.script.opp = { ...opp(2), extra: true };
wNested.script.oppStack = [opp(1)];
C.apply(data, wNested, ripCmd);
check('a nested Extra resumes what it interrupted', wNested.script.opp?.uid, 1);
check('and never records the echoed Mech as having acted', wNested.script.acted, []);

// ---------- Attack Mode (H2-B "Crisis" II, card 547) ----------
//
// The REAL card, not a fixture: the gate is driven by the structured
// `action_opportunity_bonus` effect the publisher's data actually carries, so a
// regenerated cards.json that drops `requiredStance` or `actionPoints` fails
// here rather than quietly loosening the rule in a game.
const realCards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const crisis = (Array.isArray(realCards) ? realCards : realCards.cards ?? []).find((c) => String(c.id) === '547');
if (!crisis) throw new Error('card 547 is missing from cards.json');
data.byId.set('547', crisis);

const am = (over = {}) => ({ kind: 'attackMode', seat: 's1', uid: 1, ...over });
// The Crisis torso, plus the fixture gun in a hand so there is a Short Action
// to open with — card 547's own Full-auto is Medium, and the point below is
// what a Short Action leaves behind.
const crisisMech = (over = {}) => mech(1, 's1', {
  mech: { torso: '547', rightHand: 'T1', pilot: 'P1' },
  partStates: { torso: 'intact', rightHand: 'intact' },
  ...over,
});
const wCrisis = (over = {}, o = opp(1)) => world([crisisMech(over)], 2, o);
check('a Mech with no such Part is refused', C.check(data, world([mech(1, 's1')], 2, opp(1)), am()).ok, false);
check('the Crisis torso in Offensive Stance passes', C.check(data, wCrisis(), am()).ok, true);
// 4.1 lets the dial be cycled until the Mech acts, so the Stance is judged
// HERE rather than when the Opportunity was minted — which is the whole reason
// this is a declared command instead of a bonus newOpportunity hands out.
check('the same Mech in Mobility Stance is refused', C.check(data, wCrisis({ stance: 'mobility' }), am()).ok, false);
check('and once it has acted the window has closed',
  C.check(data, wCrisis({}, opp(1, { started: true, action: 1, performed: ['A1'] })), am()).ok, false);
check('outside its own Action Opportunity it is refused', C.check(data, wCrisis({}, null), am()).ok, false);

const wCrisisGo = wCrisis();
C.apply(data, wCrisisGo, am());
check('it adds an ORDINARY action tick and banks the flag',
  [wCrisisGo.script.opp.action, wCrisisGo.script.opp.attackMode, wCrisisGo.script.opp.extras.length], [3, true, 0]);
check('taking it twice is refused', C.check(data, wCrisisGo, am()).ok, false);
// THE anti-abuse mechanism. Taking the Tick IS the Stance choice, exactly as a
// Reboot is (4.1.1), so "flip to Offensive, bank the Tick, flip to Mobility,
// act" is refused by setStance's existing 4.1 gate and nothing has to revoke
// the Tick or re-check the Stance anywhere.
check('taking it sets the Stance for the Opportunity', wCrisisGo.script.opp.stanceLocked, true);
check('so flipping out of Offensive afterwards is refused',
  C.check(data, wCrisisGo, { kind: 'setStance', seat: 's1', uid: 1, stance: 'mobility' }).ok, false);
check('while staying in Offensive is still fine',
  C.check(data, wCrisisGo, { kind: 'setStance', seat: 's1', uid: 1, stance: 'offensive' }).ok, true);
// FAQ K14, end to end, and against the card's OWN Medium Action: the bought
// Tick joins the base pool, so one base Tick plus this one pays for Full-auto.
// An Extra Tick could not — it pays for a Short Action alone and never
// combines (3.4.5), which is the reading this ruling threw out.
const wCrisisMed = wCrisis();
C.apply(data, wCrisisMed, pa({ actionId: 'A1' }));
check('one base tick is left after a Short Action', wCrisisMed.script.opp.action, 1);
check('and it cannot pay for the card\'s Medium Full-auto',
  C.check(data, wCrisisMed, pa({ actionId: '547_A' })).ok, false);
C.apply(data, wCrisisMed, am());
check('the Attack Mode tick combines with it', C.check(data, wCrisisMed, pa({ actionId: '547_A' })).ok, true);
// Claiming it mid-Opportunity is refused by check(), which is where the rule
// lives — apply() above was driven past that gate deliberately, to isolate the
// Tick arithmetic from the window rule tested separately.
check('though claiming it that late is refused', C.check(data, wCrisis({}, opp(1, { started: true, action: 1 })), am()).ok, false);

// ---------- transformPart and Tether X (PDLH-202, 287/288) ----------
//
// The card readers are pinned against the real cards.json in tether.test.mjs.
// What belongs HERE is the command layer's half: what check() refuses, and what
// apply() leaves on the board.

const tp = (over = {}) => ({ kind: 'transformPart', seat: 's1', uid: 1, slot: 'leftHand', cardId: 'HARP-T', ...over });
const wTransform = (over = {}) => world([mech(1, 's1', {
  mech: { torso: 'T1', leftHand: 'HARP', pilot: 'P1' },
  partStates: { torso: 'intact', leftHand: 'intact' },
  col: 3, row: 3, ...over,
}), mech(2, 's2', {
  col: 9, row: 3,
  mech: { torso: 'T1', leftHand: 'T3', pilot: 'P1' },
  partStates: { torso: 'intact', leftHand: 'intact' },
})]);
check('a Part turns over to its own far face', C.check(data, wTransform(), tp()).ok, true);
// Being the same physical card is the whole permission. A card that merely fits
// the slot is not a face of it.
check('but not into an unrelated card of the same type',
  C.check(data, wTransform(), tp({ cardId: 'HARP2' })).ok, false);
check('nor into one that does not fit the slot',
  C.check(data, wTransform(), tp({ cardId: 'T1' })).ok, false);
check('an empty slot has nothing to turn over', C.check(data, wTransform(), tp({ slot: 'backpack' })).ok, false);
check('and a destroyed Part has no card left',
  C.check(data, wTransform({ partStates: { torso: 'intact', leftHand: 'destroyed' } }), tp()).ok, false);
const wTp = wTransform();
C.apply(data, wTp, tp());
check('apply rewrites the slot', wTp.tokens[0].mech.leftHand, 'HARP-T');

// The chips. Placed on a unit the Harpoon just hit, so they always start inside
// their own leash.
const th = (over = {}) => ({ kind: 'tether', seat: 's1', uid: 1, targetUid: 2, range: 4, ...over });
check('a Tether within X is placed', C.check(data, wTransform(), th()).ok, true);
check('one already beyond X is refused',
  C.check(data, world([mech(1, 's1', { col: 3, row: 3 }), mech(2, 's2', { col: 33, row: 3 })]), th()).ok, false);
check('a unit cannot Tether itself', C.check(data, wTransform(), th({ targetUid: 1 })).ok, false);
const wTether = wTransform();
C.apply(data, wTether, th());
check('apply writes a mirrored pair', [wTether.tokens[0].tether, wTether.tokens[1].tether], [
  [{ uid: 2, range: 4, role: 'initiator' }],
  [{ uid: 1, range: 4, role: 'tethered' }],
]);

// The asymmetry, at the command layer. Only the tethered end is capped, and it
// is capped on the DESTINATION, which needs no pathfinder — so unlike Break
// Away this one rule does belong in check().
const leashMove = (uid, col) => ({ kind: 'maneuver', seat: uid === 1 ? 's1' : 's2', uid, to: { col, row: 3 }, granted: true });
check('the tethered unit is refused a move past the leash', C.check(data, wTether, leashMove(2, 33)).ok, false);
check('and allowed one inside it', C.check(data, wTether, leashMove(2, 15)).ok, true);
check('while the INITIATOR may walk out — that is a removal, not an illegal move',
  C.check(data, wTether, leashMove(1, 33)).ok, true);

// ...and walking out is what removes it, through the sweep apply() runs after
// every command rather than through anything the mover had to remember.
const wWalk = wTransform();
C.apply(data, wWalk, th());
C.apply(data, wWalk, leashMove(1, 33));
check('so the sweep takes both chips off afterwards',
  [wWalk.tokens[0].tether, wWalk.tokens[1].tether], [undefined, undefined]);

// The Penetration break: the INITIATOR only, stamped where the Penetration
// lands so both pages and a replay get it from the same place.
const wPen = wTransform();
C.apply(data, wPen, th());
C.apply(data, wPen, { kind: 'applyPenetration', seat: 's1', uid: 1, targetUid: 2, slot: 'leftHand' });
check('Penetrating the tethered unit leaves the chips on',
  [wPen.tokens[0].tether?.length, wPen.tokens[1].tether?.length], [1, 1]);
C.apply(data, wPen, { kind: 'applyPenetration', seat: 's2', uid: 2, targetUid: 1, slot: 'leftHand' });
check('Penetrating the initiator takes them off',
  [wPen.tokens[0].tether, wPen.tokens[1].tether], [undefined, undefined]);

// ---------- Launching a BORROWED launcher (FAQ O3/O16) ----------
//
// Regression guard for BUG-4. spendAmmo and restoreAmmo already went through
// ammoHolder; `launch` read t.ammo raw. The Mech has no entry for a borrowed
// Action at all, so the raw read found undefined, check() said nothing and
// apply() debited nothing — a lent Missile Pod fired all game for free. The
// same shape one slot over from the "firing a Load spends the Tarantula Ammo"
// case above, which is what made this one easy to miss.
const launcherCarrier = (uid, over = {}) => ({
  uid, side: 's1', kind: 'drone', cardId: 'CAR', droneBackpack: 'BP2', label: `T${uid}`,
  col: 6, row: 3, facing: 0, size: 1, aerial: false, stance: 'mobility',
  partStates: { main: 'intact', backpack: 'intact' }, ammo: { BP2_L: 2 }, ...over,
});
const lentShot = { kind: 'launch', seat: 's1', uid: 1, actionId: 'BP2_L', cardId: 'D1', to: { col: 9, row: 9 }, facing: 0 };
const wLent = world([mech(1, 's1', { ammo: {} }), launcherCarrier(2)], 2, opp(1, { timing: 'firing' }));
wLent.nextUid = 60;
check('a borrowed launcher with Ammo left may fire', C.check(data, wLent, lentShot).ok, true);
C.apply(data, wLent, lentShot);
check('and the Projectile is spawned', [wLent.tokens[2]?.uid, wLent.tokens[2]?.parentUid], [60, 1]);
// The whole bug in one line: the count has to come off the DRONE.
check('the Tarantula pays for it, and the Mech magazine is untouched',
  [wLent.tokens[1].ammo.BP2_L, wLent.tokens[0].ammo?.BP2_L], [1, undefined]);
// An empty lender must refuse, exactly as an empty magazine of the Mech's own
// does. Before the fix this returned ok and the launch was free.
const wLentDry = world([mech(1, 's1', { ammo: {} }), launcherCarrier(2, { ammo: { BP2_L: 0 } })], 2, opp(1, { timing: 'firing' }));
check('an empty Tarantula magazine refuses the launch (4.13)', C.check(data, wLentDry, lentShot).ok, false);
C.apply(data, wLentDry, lentShot);
check('and a sandbox apply cannot drive it below zero', wLentDry.tokens[1].ammo.BP2_L, 0);
// The undo path was already correct; pinned so the pair cannot drift apart —
// a launch and its take-back must land on the same unit.
const wLentBack = world([mech(1, 's1', { ammo: {} }), launcherCarrier(2)], 2, opp(1, { timing: 'firing' }));
C.apply(data, wLentBack, lentShot);
C.apply(data, wLentBack, { kind: 'restoreAmmo', seat: 's1', uid: 1, actionId: 'BP2_L' });
check('taking it back credits the same Tarantula', wLentBack.tokens[1].ammo.BP2_L, 2);
// Out of Contact there is no loan at all, so the refusal comes one line earlier
// than the magazine — findAction never finds the Action. Pinned with the reason,
// not just the verdict: an ammoHolder that fell back to the Mech would also
// return ok:false here, and the two failures mean opposite things.
const wLentFar = world([mech(1, 's1', { ammo: {} }), launcherCarrier(2, { col: 30 })], 2, opp(1, { timing: 'firing' }));
const farVerdict = C.check(data, wLentFar, lentShot);
check('with no Tarantula in Contact the Action is not this Mech\'s at all',
  [farVerdict.ok, /no such Action/.test(farVerdict.why ?? '')], [false, true]);
// And the Mech's OWN magazine still behaves exactly as it did: ammoHolder
// returns the unit itself the moment it has an entry of its own.
const wOwn = world([mech(1, 's1', { mech: { torso: 'T4', pilot: 'P1' }, ammo: { L1: 1 } }), launcherCarrier(2)], 2);
wOwn.nextUid = 70;
const ownShot = { kind: 'launch', seat: 's1', uid: 1, actionId: 'L1', cardId: 'D1', to: { col: 9, row: 9 }, facing: 0 };
C.apply(data, wOwn, ownShot);
check('a Mech firing its own launcher still pays from its own magazine',
  [wOwn.tokens[0].ammo.L1, wOwn.tokens[1].ammo.BP2_L], [0, 2]);
check('and is refused once that magazine is empty', C.check(data, wOwn, ownShot).ok, false);

// ---------- Barricades are exempt from Forced Movement (FAQ E6/M13) ----------
//
// Regression guard for BUG-6. Knockback, Push, the Crush shuffle and the
// Harpy's tow all travel as one forceMove, so the exemption is stated once in
// check() rather than at each sender. rules.ts stops the UI offering the shove;
// this is what holds when a stale networked client sends it anyway.
const shellTok = (over = {}) => ({
  uid: 5, side: 's2', kind: 'projectile', cardId: '158', label: 'Turtle Shell',
  col: 9, row: 9, facing: 0, size: 1, aerial: false, stance: 'offensive',
  partStates: { main: 'intact' }, ammo: {}, barricade: true, ...over,
});
const wShell = () => world([mech(1, 's1', { ammo: {} }), shellTok()], 2);
const shove = (over = {}) => ({ kind: 'forceMove', seat: 's1', uid: 1, targetUid: 5, to: { col: 9, row: 12 }, ...over });
check('a Barricade cannot be shoved to another Grid', C.check(data, wShell(), shove()).ok, false);
check('and a Push is refused just the same', C.check(data, wShell(), shove({ push: true })).ok, false);
// 3.4.4 lets the forcing player turn a victim that could not be moved at all,
// and that turn rides on the SAME command with the position unchanged. Refusing
// it would take away a choice the rules give.
check('but turning it where it stands is still allowed',
  C.check(data, wShell(), shove({ to: { col: 9, row: 9 }, facing: 2 })).ok, true);
// The control: the identical command against the identical token minus the flag.
const wNotShell = world([mech(1, 's1', { ammo: {} }), shellTok({ barricade: undefined })], 2);
check('an ordinary Deployable in the same spot is shoved normally', C.check(data, wNotShell, shove()).ok, true);
C.apply(data, wNotShell, shove());
check('and it really does move', [wNotShell.tokens[1].col, wNotShell.tokens[1].row], [9, 12]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

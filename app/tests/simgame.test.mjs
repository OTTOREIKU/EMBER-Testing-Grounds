// Plays whole games through the command layer with the real card database, so
// the rules get exercised together rather than one mechanic at a time. A seeded
// driver walks setup, deployment and full rounds by proposing commands and
// letting check() filter them, mirroring the deterministic glue the play guide
// runs between commands (phase-entry resets, opening Action Opportunities).
//
// Four properties are asserted:
//   * check() is pure — a refused command leaves the state byte-identical
//   * every applied command leaves the state structurally sane (finite numbers,
//     unique uids, ammo and pools never negative, everything on the board)
//   * the game always progresses — a legal command exists at every step
//   * the finished game replays deterministically from the initial state,
//     which is the property networked mirroring stands on
import { readFileSync, writeFileSync } from 'node:fs';

// ---------- the same slice commands.test.mjs compiles, plus the script state ----------
const commands = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const ticks = readFileSync(new URL('../src/ticks.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const setupSrc = readFileSync(new URL('../src/setup.ts', import.meta.url), 'utf8');
const tacticsSrc = readFileSync(new URL('../src/tactics.ts', import.meta.url), 'utf8');
const tasksSrc = readFileSync(new URL('../src/tasks.ts', import.meta.url), 'utf8');
const loopSrc = readFileSync(new URL('../src/loop.ts', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
const smokeRules = rules.slice(rules.indexOf('export function smokeKey'), rules.indexOf('export function smokeBlocks'));
const timings = types.slice(types.indexOf('export const PHASES'), types.indexOf('export type TokenShape'));
const statuses = types.slice(types.indexOf('export function hexagonIds'), types.indexOf('export interface RoundState'));
const tmp = new URL('./_simgame.slice.ts', import.meta.url);
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
export function pilotCard(data: any, t: any): any {
  return t.kind === 'mech' && t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
}
export function extrasFor(data: any, t: any): any[] {
  const have = new Set(tokenCards(data, t).flatMap((x: any) => (x.card.actions ?? []).map((a: any) => a.id)));
  return (data.extraTicks ?? []).filter((g: any) => have.has(g.actionId)).map((g: any) => ({ id: g.actionId, label: g.label, timing: g.timing, check: g.check }));
}
export function makeDroneToken(state: any, data: any, card: any, side: any, backpack?: string): any {
  return {
    uid: state.nextUid++, side, kind: card.category === 'projectile' ? 'projectile' : 'drone',
    cardId: card.id, droneBackpack: backpack, label: card.id, size: 1, aerial: false, stance: 'offensive',
    partStates: { main: 'intact', ...(backpack ? { backpack: 'intact' } : {}) }, ammo: {},
  };
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
let sliceSrc =
  'type GameState = any;\ntype Side = any;\ntype Stance = any;\ntype Timing = any;\ntype TimingDef = any;\ntype Facing = any;\ntype GameData = any;\ntype CardAction = any;\ntype ExtraTick = any;\ntype Opportunity = any;\ntype Token = any;\ntype StatusDef = any;\ntype PartSlot = any;\ntype PartState = any;\n'
  + timings
  + statuses
  + setupSrc.replace(/^import[^\n]*\n/gm, '')
  + tacticsSrc.replace(/^import[^\n]*\n/gm, '')
  + tasksSrc.replace(/^import[^\n]*\n/gm, '')
  + loopSrc.replace(/^import[^\n]*\n/gm, '')
  + smokeRules
  + ticks.replace(/^import[^\n]*\n/gm, '')
  + stubs
  + commands.replace(/^import[^\n]*\n/gm, '');
// The driver builds real script states and opportunities, which live outside
// the ranges above; pull them (and asSide, which normaliseScript leans on) in
// only when the ranges did not already cover them.
if (!/export function asSide/.test(sliceSrc)) {
  sliceSrc += types.slice(types.indexOf('export const LEGACY_SIDE'), types.indexOf('export type Stance'));
}
if (!/export function newScriptState/.test(sliceSrc)) {
  sliceSrc += types.slice(types.indexOf('export function newOpportunity'), types.indexOf('export type BattleScale'));
}
writeFileSync(tmp, sliceSrc);
const C = await import(tmp.href);

// ---------- the real card database, merged the way data.ts merges it ----------
const repo = new URL('../../', import.meta.url);
const loadJson = (p) => JSON.parse(readFileSync(new URL(p, repo), 'utf8'));
const cards = loadJson('data/cards.json');
const byId = new Map(cards.map((c) => [c.id, c]));
for (const [cid, patch] of Object.entries(loadJson('data/stat_overrides.json').cards ?? {})) {
  const c = byId.get(cid);
  if (c) for (const [k, v] of Object.entries(patch)) if (!k.startsWith('_')) c[k] = v;
}
const ammoOv = loadJson('data/ammo_overrides.json').actions ?? {};
const actOv = loadJson('data/action_overrides.json').actions ?? {};
for (const c of cards) {
  for (const a of c.actions ?? []) {
    if (ammoOv[a.id] !== undefined) a.storage = ammoOv[a.id];
    const fix = actOv[a.id];
    if (fix) for (const [k, v] of Object.entries(fix)) {
      if (k.startsWith('_')) continue;
      if (k === 'name' && v && typeof v === 'object') a.name = { ...a.name, ...v };
      else a[k] = v;
    }
  }
}
const common = loadJson('data/common_actions.json');
const data = { byId, commonActions: common.actions ?? [], overload: common.overload ?? [], zoneData: { zones: [] } };

const partsOf = (ty) => cards.filter((c) => c.type === ty && (c.actions ?? []).length >= 0);
const pilots = cards.filter((c) => c.category === 'pilot' && typeof c.LV === 'number');
const drones = cards.filter((c) => c.category === 'drone');
const projectiles = cards.filter((c) => c.category === 'projectile');
const SLOTS = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];

// ---------- seeded driver ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const irnd = (rng, n) => Math.floor(rng() * n);

function mkMech(uid, side, rng) {
  const mech = {};
  for (const s of SLOTS) mech[s] = pick(rng, partsOf(s)).id;
  // The first Mech carries the Overloading Pack when the database has it, so
  // the overload path gets walked instead of being refused every game.
  if (uid === 1 && byId.has('090')) mech.backpack = '090';
  const pilot = pick(rng, pilots);
  mech.pilot = pilot.id;
  const partStates = Object.fromEntries(SLOTS.map((s) => [s, 'intact']));
  const ammo = {};
  for (const s of SLOTS) for (const a of byId.get(mech[s]).actions ?? []) if ((a.storage ?? 0) > 0) ammo[a.id] = a.storage;
  return {
    uid, side, kind: 'mech', cardId: mech.torso, mech, label: `${side}-M${uid}`,
    col: 0, row: 0, size: 1, facing: 0, aerial: false, stance: 'offensive',
    link: pilot.LV, partStates, ammo, deployed: false,
  };
}
function mkDrone(uid, side, rng) {
  const card = pick(rng, drones);
  const ammo = {};
  for (const a of card.actions ?? []) if ((a.storage ?? 0) > 0) ammo[a.id] = a.storage;
  return {
    uid, side, kind: 'drone', cardId: card.id, label: `${side}-D${uid}`,
    col: 0, row: 0, size: 1, facing: 0, aerial: false, stance: 'offensive',
    partStates: { main: 'intact' }, ammo, deployed: false,
  };
}

function newGame(rng) {
  const tokens = [];
  let uid = 1;
  for (const side of ['s1', 's2']) {
    tokens.push(mkMech(uid++, side, rng), mkMech(uid++, side, rng));
    tokens.push(mkDrone(uid++, side, rng));
  }
  // Every known Tactics Card is in play every game: three to each hand, so
  // across the seeds all six specs get judged and applied in game context.
  const deck = Object.keys(C.TACTIC_SPECS);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = irnd(rng, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    v: 3, map: 'm1', tokens, nextUid: uid,
    round: { n: 1, phase: 0, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    markers: [], smoke: [], removedTerrain: [],
    script: { ...C.newScriptState('s1'), strict: true },
    setup: C.newSetup(),
    tactics: { s1: deck.slice(0, 3), s2: deck.slice(3, 6) }, tacticsPlayed: { s1: [], s2: [] },
    tasks: null, mission: null, scenario: null, roundLimit: 3, sideNames: {},
  };
}

// ---------- tactics ----------
const tacticCtx = { maxLink: (t) => (t.mech?.pilot ? byId.get(t.mech.pilot)?.LV ?? 99 : 99) };

function tacticCandidates(s, rng, out) {
  const phaseName = C.PHASES[s.round.phase];
  for (const seat of ['s1', 's2']) {
    for (const cardId of s.tactics?.[seat] ?? []) {
      const spec = C.tacticSpec(cardId);
      if (!spec || spec.phase !== phaseName) continue;
      const targets = C.tacticTargets(spec, s, seat, tacticCtx);
      if (!targets.length) continue;
      const t = pick(rng, targets);
      const cmd = { kind: 'playTactic', seat, uid: t.uid, cardId };
      if (spec.choices) {
        const opts = spec.choices(t, s, tacticCtx);
        if (!opts.length) continue;
        cmd.pick = pick(rng, opts).id;
      }
      out.push(cmd);
    }
  }
}

// ---------- the guide glue, mirrored from playguide.ts ----------
// Both networked clients run this same deterministic bookkeeping between
// commands, so the simulator is a faithful third client.
const PKEY = { swift: 'swift', melee: 'melee', projectile: 'projectile', firing: 'firing', movement: 'moving', tactical: 'tactic' };
const init = (t, timing) => {
  const p = t.mech?.pilot ? byId.get(t.mech.pilot) : null;
  return p ? p[PKEY[timing]] : undefined;
};

function enterPhase(s) {
  const sc = s.script;
  if (s.round.phase === 0) {
    s.commandTokens = { s1: C.commandTokensFor(s, 's1'), s2: C.commandTokensFor(s, 's2') };
    sc.commanded = [];
    sc.freeCommand = [];
  }
  if (s.round.phase === 0 || s.round.phase === 2) sc.acted = [];
  sc.endDone = sc.endDone.filter((k) => k.startsWith(`${s.round.n}:`));
  sc.opp = null;
  sc.passed = [];
  sc.turn = s.round.firstPlayer;
  sc.stage = `${s.round.n}:${s.round.phase}`;
}

function glue(s) {
  const sc = s.script;
  if (s.round.phase === 2 && !sc.opp) {
    const next = C.nextActivation(s, init);
    if (next) sc.opp = C.newOpportunity(next.uid, next.timing);
  }
}

function applyOne(s, cmd) {
  glue(s);
  const v = C.perform(data, s, cmd);
  if (v.ok) {
    if (cmd.kind === 'advancePhase' || cmd.kind === 'finishDeployment') enterPhase(s);
    else if (cmd.kind === 'designate') s.script.opp = C.newOpportunity(cmd.uid, undefined);
  }
  return v;
}

// ---------- structural sanity ----------
function findBad(v, path) {
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} is ${v}`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (v[i] === undefined) return `${path}[${i}] is undefined`;
      const bad = findBad(v[i], `${path}[${i}]`);
      if (bad) return bad;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const bad = findBad(x, `${path}.${k}`);
      if (bad) return bad;
    }
  }
  return null;
}

const PART_OK = new Set(['intact', 'damaged', 'destroyed']);
function sanity(s) {
  const bad = findBad(s, 'state');
  if (bad) return bad;
  if (s.round.phase < 0 || s.round.phase >= C.PHASES.length) return `phase ${s.round.phase} off the track`;
  if (s.round.n < 1) return `round ${s.round.n}`;
  for (const side of ['s1', 's2']) if ((s.commandTokens[side] ?? 0) < 0) return `command tokens ${side} negative`;
  const uids = new Set();
  for (const t of s.tokens) {
    if (uids.has(t.uid)) return `uid ${t.uid} appears twice`;
    uids.add(t.uid);
    if (t.col < 0 || t.col > 35 || t.row < 0 || t.row > 35) return `${t.label} off the board at ${t.col},${t.row}`;
    for (const [slot, p] of Object.entries(t.partStates)) if (!PART_OK.has(p)) return `${t.label} ${slot} state "${p}"`;
    for (const [aid, n] of Object.entries(t.ammo)) if (n < 0) return `${t.label} ammo ${aid} negative`;
  }
  return null;
}

// ---------- candidate generation ----------
const STATUS_IDS = (C.STATUSES ?? []).map((x) => x.id);
const near = (rng, t) => ({
  col: Math.max(0, Math.min(35, t.col + irnd(rng, 7) - 3)),
  row: Math.max(0, Math.min(35, t.row + irnd(rng, 7) - 3)),
});
const aliveMechs = (s, side) => s.tokens.filter((t) => t.side === side && t.kind === 'mech' && C.alive(t));

function actionCandidatesFor(s, rng, t, out) {
  const seat = t.side;
  const held = [];
  if (t.kind === 'mech') for (const slot of SLOTS) for (const a of byId.get(t.mech[slot])?.actions ?? []) held.push(a);
  else for (const a of byId.get(t.cardId)?.actions ?? []) held.push(a);
  for (const a of held) out.push({ kind: 'performAction', seat, uid: t.uid, actionId: a.id });
  if (data.commonActions.length) out.push({ kind: 'performAction', seat, uid: t.uid, actionId: pick(rng, data.commonActions).id });
  out.push({ kind: 'maneuver', seat, uid: t.uid, to: near(rng, t), facing: irnd(rng, 4) });
  for (const aid of Object.keys(t.ammo)) {
    out.push({ kind: 'spendAmmo', seat, uid: t.uid, actionId: aid });
    if (rng() < 0.1) out.push({ kind: 'restoreAmmo', seat, uid: t.uid, actionId: aid });
  }
  const launchers = held.filter((a) => a.type === 'Projectile');
  if (launchers.length && projectiles.length && rng() < 0.5) {
    out.push({ kind: 'launch', seat, uid: t.uid, actionId: pick(rng, launchers).id, cardId: pick(rng, projectiles).id, to: near(rng, t), facing: 0 });
  }
  const enemies = s.tokens.filter((x) => x.side !== seat);
  if (enemies.length) {
    const e = pick(rng, enemies);
    const slots = e.kind === 'mech' ? SLOTS : ['main'];
    out.push({ kind: 'applyPenetration', seat, uid: t.uid, targetUid: e.uid, slot: pick(rng, slots) });
    if (rng() < 0.3) out.push({ kind: 'applyStatus', seat, uid: t.uid, targetUid: e.uid, statusId: pick(rng, STATUS_IDS) });
    if (rng() < 0.2) out.push({ kind: 'forceMove', seat, uid: t.uid, targetUid: e.uid, to: near(rng, e), push: rng() < 0.5 });
    const dead = Object.values(e.partStates).every((p) => p === 'destroyed');
    if (dead) out.push({ kind: 'recordKill', seat, uid: t.uid, targetUid: e.uid, what: 'unit' });
  }
  if (t.kind === 'mech') {
    if (rng() < 0.2) out.push({ kind: 'focus', seat, uid: t.uid });
    if (rng() < 0.15) out.push({ kind: 'grantExtra', seat, uid: t.uid, linkCost: 1 });
    if (rng() < 0.1) out.push({ kind: 'overload', seat, uid: t.uid });
    if (t.stance === 'shutdown') out.push({ kind: 'reboot', seat, uid: t.uid, stance: 'offensive' });
    else if (rng() < 0.1) out.push({ kind: 'setStance', seat, uid: t.uid, stance: pick(rng, ['offensive', 'defensive', 'mobility']) });
    else if (rng() < 0.05) out.push({ kind: 'setStance', seat, uid: t.uid, stance: 'shutdown' });
  }
  if ((t.statuses ?? []).length) {
    out.push({ kind: 'stabilise', seat, uid: t.uid });
    if (t.statuses.includes('camouflage')) out.push({ kind: 'reveal', seat, uid: t.uid });
  }
  out.push({ kind: 'endOpportunity', seat, uid: t.uid });
  // Weight the pool toward wrapping up, so opportunities do not sprawl.
  out.push({ kind: 'endOpportunity', seat, uid: t.uid });
}

function candidates(s, rng) {
  const out = [];
  const sc = s.script;
  const su = C.normaliseSetup(s.setup);
  if (su && su.stage !== 'done') {
    if (su.stage === 'map') out.push({ kind: 'lockMap', seat: 's1' });
    if (su.stage === 'roll') {
      for (const seat of ['s1', 's2']) out.push({ kind: 'rollSetup', seat, hits: [irnd(rng, 4), irnd(rng, 4)] });
      out.push({ kind: 'acceptRoll', seat: 's1' });
    }
    if (su.stage === 'tasks') out.push({ kind: 'finishTasks', seat: s.round.firstPlayer });
    if (su.stage === 'side') out.push({ kind: 'pickEdge', seat: s.round.firstPlayer, edge: rng() < 0.5 ? 'black' : 'white' });
    if (su.stage === 'deploy') {
      const seat = C.deployTurn(s, su);
      if (seat) {
        for (const t of s.tokens.filter((x) => x.side === seat && x.kind !== 'projectile' && x.deployed === false)) {
          out.push({ kind: 'deployUnit', seat, uid: t.uid, to: { col: irnd(rng, 36), row: irnd(rng, 36) } });
        }
      }
      // A late squad joining mid-deployment: it must fold into the same
      // alternation as everything already waiting.
      if (rng() < 0.06) {
        const side = pick(rng, ['s1', 's2']);
        out.push({
          kind: 'importSquad', seat: side, name: 'Reinforcements',
          mechs: [{ loadout: { torso: pick(rng, partsOf('torso')).id, chasis: pick(rng, partsOf('chasis')).id, pilot: pick(rng, pilots).id } }],
          drones: rng() < 0.5 ? [{ cardId: pick(rng, drones).id }] : [],
        });
      }
      if (C.deploymentComplete(s)) out.push({ kind: 'finishDeployment', seat: 's1' });
    }
    return out;
  }

  const phaseName = C.PHASES[s.round.phase];
  if (s.round.phase === 1) {
    // A Mech that lost its torso is still on the board but has no dial to set
    // (3.3), so the lock must not wait on it.
    const dialMechs = (side) => aliveMechs(s, side).filter((t) => t.partStates.torso !== 'destroyed');
    for (const side of ['s1', 's2']) {
      for (const t of dialMechs(side)) {
        const timing = pick(rng, C.TIMINGS).id;
        if (t.timing !== timing) out.push({ kind: 'setTiming', seat: side, uid: t.uid, timing });
      }
    }
    if (sc.mode === 'hidden') out.push({ kind: 'handOver', seat: sc.turn });
    if (rng() < 0.04) out.push({ kind: 'setMode', seat: 's1', mode: sc.mode === 'hidden' ? 'hotseat' : 'hidden' });
    if (rng() < 0.1) {
      out.push({ kind: 'commitTimings', seat: 's1', hash: 'f'.repeat(32) });
      if (sc.commits.s1) out.push({ kind: 'revealTimings', seat: 's1', salt: 'salt', dials: aliveMechs(s, 's1').map((t) => ({ uid: t.uid, timing: t.timing })) });
    }
    const allSet = ['s1', 's2'].every((side) => dialMechs(side).every((t) => t.timing));
    if (allSet) {
      out.push({ kind: 'lockDials', seat: 's1' });
      out.push({ kind: 'advancePhase', seat: 's1' });
    }
    return out;
  }

  if (C.isLoopPhase(phaseName)) {
    glue(s);
    tacticCandidates(s, rng, out);
    if (sc.opp) {
      const t = s.tokens.find((x) => x.uid === sc.opp.uid);
      if (t) actionCandidatesFor(s, rng, t, out);
      else out.push({ kind: 'endOpportunity', seat: 's1', uid: sc.opp.uid }, { kind: 'endOpportunity', seat: 's2', uid: sc.opp.uid });
    } else {
      for (const t of C.eligibleUnits(s, phaseName, sc.turn)) out.push({ kind: 'designate', seat: sc.turn, uid: t.uid });
      for (const seat of ['s1', 's2']) if (!sc.passed.includes(seat)) out.push({ kind: 'passTurn', seat });
    }
    if (C.loopComplete(s, phaseName) && !sc.opp) out.push({ kind: 'advancePhase', seat: 's1' });
    if (sc.intercepts.length) {
      const i = pick(rng, sc.intercepts);
      out.push({ kind: 'resolveIntercept', seat: pick(rng, ['s1', 's2']), uid: i.uid, actionId: i.actionId, targetUid: i.targetUid });
    }
    return out;
  }

  if (s.round.phase === 2) {
    glue(s);
    tacticCandidates(s, rng, out);
    if (sc.opp) {
      const t = s.tokens.find((x) => x.uid === sc.opp.uid);
      if (t) actionCandidatesFor(s, rng, t, out);
      else sc.opp = null;
    }
    if (rng() < 0.1 && s.tokens.length) {
      const t = pick(rng, s.tokens);
      const enemy = s.tokens.find((x) => x.side !== t.side);
      if (enemy) out.push({ kind: 'queueIntercepts', seat: t.side, items: [{ uid: t.uid, actionId: 'X', targetUid: enemy.uid }] });
    }
    if (rng() < 0.05) out.push({ kind: 'placeSmoke', seat: pick(rng, ['s1', 's2']), at: { col: irnd(rng, 12), row: irnd(rng, 12) } });
    if ((s.smoke ?? []).length && rng() < 0.2) out.push({ kind: 'removeSmoke', seat: pick(rng, ['s1', 's2']), at: pick(rng, s.smoke) });
    if (rng() < 0.05) out.push({ kind: 'destroyTerrain', seat: 's1', uid: 0, pieces: [`piece-${irnd(rng, 6)}`] });
    if (rng() < 0.05) out.push({ kind: 'adjustCommandTokens', seat: 's1', pool: pick(rng, ['s1', 's2']), delta: rng() < 0.5 ? 1 : -1 });
    if (sc.intercepts.length && rng() < 0.2) out.push({ kind: 'clearIntercepts', seat: 's1' });
    const spent = s.tokens.filter((x) => x.kind === 'projectile');
    if (spent.length && rng() < 0.3) {
      const p = pick(rng, spent);
      out.push({ kind: 'despawn', seat: p.side, uid: p.uid, targetUid: p.uid });
    }
    if (C.actionPhaseComplete(s, init)) out.push({ kind: 'advancePhase', seat: 's1' });
    return out;
  }

  // End Phase: the checklist, then over the top into the next round.
  tacticCandidates(s, rng, out);
  for (const step of ['tokens', 'remove', 'tasks']) {
    if (!sc.endDone.includes(`${s.round.n}:end:${step}`)) out.push({ kind: 'markEndStep', seat: pick(rng, ['s1', 's2']), step });
  }
  if (rng() < 0.2) out.push({ kind: 'award', seat: 's1', vp: { s1: irnd(rng, 2), s2: irnd(rng, 2) }, keys: [] });
  if ((s.smoke ?? []).length && rng() < 0.5) out.push({ kind: 'dissipateSmoke', seat: 's1' });
  const doneAll = ['tokens', 'remove', 'tasks'].every((st) => sc.endDone.includes(`${s.round.n}:end:${st}`));
  if (doneAll) out.push({ kind: 'advancePhase', seat: 's1' });
  return out;
}

// Commands that must be refused wherever the game stands: the wrong seat, a
// dead reference, off-board grids, an overdrawn pool.
function adversaries(s, rng) {
  const out = [{ kind: 'adjustCommandTokens', seat: 's1', pool: 's1', delta: -999 }];
  const enemy = s.tokens.find((t) => t.side === 's2');
  if (enemy) {
    out.push({ kind: 'setTiming', seat: 's1', uid: enemy.uid, timing: 'firing' });
    out.push({ kind: 'maneuver', seat: 's1', uid: enemy.uid, to: { col: 1, row: 1 } });
  }
  const mine = s.tokens.find((t) => t.side === 's1');
  if (mine) {
    out.push({ kind: 'maneuver', seat: 's1', uid: mine.uid, to: { col: 99, row: 1 } });
    out.push({ kind: 'spendAmmo', seat: 's1', uid: mine.uid, actionId: 'no-such-action' });
    // A unit already down may be nudged during the deploy stage (3.1.4), so
    // re-deploying is only an offence once deployment has closed.
    if (mine.deployed !== false && C.normaliseSetup(s.setup)?.stage !== 'deploy') {
      out.push({ kind: 'deployUnit', seat: 's1', uid: mine.uid, to: { col: 1, row: 1 } });
    }
  }
  out.push({ kind: 'applyPenetration', seat: 's1', uid: mine?.uid ?? 1, targetUid: 9999, slot: 'torso' });
  out.push({ kind: 'importSquad', seat: 's1', mechs: [{ loadout: { torso: 'no-such-card' } }], drones: [] });
  const su = C.normaliseSetup(s.setup);
  if (su && su.stage === 'done') {
    // A perfectly well-formed squad is still refused once deployment closed.
    out.push({ kind: 'importSquad', seat: 's1', mechs: [{ loadout: { torso: partsOf('torso')[0].id } }], drones: [] });
  }
  if (mine) {
    // A card the squad does not hold, and a choice the card does not offer.
    const hand = s.tactics?.s1 ?? [];
    const stray = Object.keys(C.TACTIC_SPECS).find((id) => !hand.includes(id));
    if (stray) out.push({ kind: 'playTactic', seat: 's1', uid: mine.uid, cardId: stray });
    const choiceCard = hand.find((id) => C.tacticSpec(id)?.choices);
    if (choiceCard) out.push({ kind: 'playTactic', seat: 's1', uid: mine.uid, cardId: choiceCard, pick: 'no-such-choice' });
  }
  return out;
}

// ---------- run ----------
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const GAMES = Number(process.env.SIM_GAMES ?? 16);
const ROUNDS = 3;
const STEP_CAP = 1600;
const applied = new Map();
const tacticPlays = new Map();
let refusals = 0;

console.log('Simulated games over the command layer\n');

for (let seed = 1; seed <= GAMES; seed++) {
  const rng = mulberry32(seed * 2654435761);
  const state = newGame(rng);
  const initial = structuredClone(state);
  const log = [];
  let steps = 0;
  let broke = null;

  while (state.round.n <= ROUNDS && steps < STEP_CAP) {
    steps++;

    // Rule enforcement: the adversarial commands must always be refused.
    for (const bad of adversaries(state, rng)) {
      if (C.check(data, state, bad).ok) { broke = `accepted a ${bad.kind} that breaks the rules: ${JSON.stringify(bad)}`; break; }
    }
    if (broke) break;

    const pool = candidates(state, rng);
    // candidates() may run the guide glue, which legitimately opens an
    // opportunity — recapture the baseline before judging purity.
    const glued = JSON.stringify(state);
    let chosen = null;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = irnd(rng, i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const cmd of pool) {
      if (C.check(data, state, cmd).ok) { chosen = cmd; break; }
      refusals++;
    }
    if (JSON.stringify(state) !== glued) { broke = 'check() itself mutated the state'; break; }
    if (!chosen) {
      broke = `no legal command at round ${state.round.n} phase ${state.round.phase} (stage ${state.script.stage}, turn ${state.script.turn}, passed ${JSON.stringify(state.script.passed)})`;
      break;
    }

    const v = applyOne(state, chosen);
    if (!v.ok) { broke = `check() allowed ${chosen.kind} but perform() refused: ${v.why}`; break; }
    log.push(chosen);
    applied.set(chosen.kind, (applied.get(chosen.kind) ?? 0) + 1);
    if (chosen.kind === 'playTactic') tacticPlays.set(chosen.cardId, (tacticPlays.get(chosen.cardId) ?? 0) + 1);

    const bad = sanity(state);
    if (bad) { broke = `after ${chosen.kind}: ${bad}`; break; }
  }

  if (!broke && state.round.n <= ROUNDS) broke = `stalled after ${STEP_CAP} steps at round ${state.round.n} phase ${state.round.phase}`;
  check(`game ${seed} plays ${ROUNDS} rounds without breaking (${log.length} commands)`, broke, null);

  // The whole game must replay to the same final state from the same start:
  // networked mirroring is exactly this replay.
  const replayed = structuredClone(initial);
  let replayBroke = null;
  for (const cmd of log) {
    const v = applyOne(replayed, cmd);
    if (!v.ok) { replayBroke = `${cmd.kind} refused on replay: ${v.why}`; break; }
  }
  if (!replayBroke && JSON.stringify(replayed) !== JSON.stringify(state)) replayBroke = 'the replayed state differs';
  check(`game ${seed} replays deterministically`, replayBroke, null);
}

// Coverage floor: a driver that quietly stopped proposing a core command would
// leave that rule untested without failing anything, so the floor makes the
// silence loud.
const CORE = [
  'lockMap', 'rollSetup', 'acceptRoll', 'finishTasks', 'pickEdge', 'deployUnit', 'finishDeployment',
  'setTiming', 'lockDials', 'advancePhase', 'designate', 'maneuver', 'performAction',
  'endOpportunity', 'passTurn', 'applyPenetration', 'spendAmmo', 'markEndStep',
  'playTactic', 'importSquad',
];
for (const kind of CORE) {
  check(`the games exercised ${kind}`, (applied.get(kind) ?? 0) > 0, true);
}

// All six cards live in the deals every game; at this many seeds a card that
// never lands means its targeting or the driver has gone quiet.
check('at least four of the six Tactics Cards saw play', tacticPlays.size >= 4, true);

const covered = [...applied.entries()].sort((a, b) => b[1] - a[1]);
const perCard = [...tacticPlays.entries()].sort()
  .map(([id, n]) => `${C.tacticSpec(id)?.name ?? id}:${n}`).join(' ');
console.log(`\n  tactics played: ${perCard || '(none)'}`);
console.log(`\n  commands applied across ${GAMES} games (${covered.reduce((a, [, n]) => a + n, 0)} total, ${refusals} refusals):`);
console.log('  ' + covered.map(([k, n]) => `${k}:${n}`).join(' '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

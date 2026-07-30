import { DEFAULT_BOARD } from './boards';
import type { GameData } from './data';
import { cardName, isAerial, unitSize } from './data';
import type { Card, CardAction, GameState, MechLoadout, PartSlot, Side, Stance, TerrainPiece, Timing, Token } from './types';
import { normaliseScript, statusCount, TIMINGS } from './types';
import { normaliseSetup } from './setup';
import { isMeleeFiring, lockersOf } from './melee';
import { normaliseTasks } from './tasks';

export const PART_SLOTS: PartSlot[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];
export const SLOT_LABEL: Record<PartSlot | 'pilot' | 'main', string> = {
  torso: 'Torso',
  chasis: 'Chassis',
  leftHand: 'L.Arm',
  rightHand: 'R.Arm',
  backpack: 'Pack',
  pilot: 'Pilot',
  main: 'Hull',
};

let uidSource = { next: (s: GameState) => s.nextUid++ };

function initAmmo(cards: Card[]): Record<string, number> {
  const ammo: Record<string, number> = {};
  for (const c of cards) {
    for (const a of c.actions ?? []) {
      if (a.storage && a.storage > 0) ammo[a.id] = a.storage;
    }
  }
  return ammo;
}

// Gives a token the Ammo and Interception Tokens its current Parts print,
// without touching a count it already carries. Needed after a Part is swapped
// in, since nothing else re-seeds until the next load.
export function syncMagazines(data: GameData, t: Token): void {
  const cards = tokenCards(data, t).map(({ card }) => card);
  t.ammo = { ...initAmmo(cards), ...(t.ammo ?? {}) };
  t.intercept = { ...initIntercept(cards), ...(t.intercept ?? {}) };
}

export function volleyOf(a: CardAction): number {
  const hay = [
    a.description?.zh ?? '',
    a.description?.en ?? '',
    ...(a.keywords ?? []).map((k) => k.inline ?? k.key ?? ''),
  ].join(' ');
  const m = /(?:齐射|斉射|Vol+(?:ey|y))\s*(\d+)/i.exec(hay);
  return m ? Math.max(1, Number(m[1])) : 1;
}

export interface Knockback {
  grids: number;
  push: boolean;
  onHit: boolean;
}

export function knockbackOf(a: CardAction, english?: string): Knockback | undefined {
  const printed = (a.description?.en ?? '').trim() || (english ?? '').trim();
  const hay = printed || [a.description?.zh ?? '', ...(a.keywords ?? []).map((k) => k.inline ?? '')].join(' ');
  const onHit = /命中时|命中時|\[?on hit\]?/i.test(hay);
  const m = /(击退|擊退|推动|推動|Knock ?back|Push)\s*(\d+)/i.exec(hay);
  if (m) return { grids: Math.max(1, Number(m[2])), push: /推动|推動|Push/i.test(m[1]), onHit };
  const shove = /(?:Shove|推挤|推擠)[^.。]*?(\d+)\s*(?:Grid|格)/i.exec(hay);
  if (shove) return { grids: Math.max(1, Number(shove[1])), push: false, onHit };
  return undefined;
}

export interface Resupply {
  actionId: string;
  amount: number;
  range: number;
  allies: boolean;
}

export function resupplyOf(a: CardAction): Resupply | undefined {
  for (const g of a.gameRules ?? []) {
    for (const e of g.effects ?? []) {
      const eff = e as { type?: string; actionId?: string; amount?: number; range?: number; targetSide?: string };
      if (eff.type !== 'resupply_action_ammo' || !eff.actionId) continue;
      return {
        actionId: eff.actionId,
        amount: Math.max(1, eff.amount ?? 1),
        range: eff.range ?? 0,
        allies: eff.targetSide !== 'self',
      };
    }
  }
  return undefined;
}

export function freehandSlots(data: GameData, t: Token, taken: string[] = []): { slot: PartSlot | 'pilot' | 'main'; label: string }[] {
  const out: { slot: PartSlot | 'pilot' | 'main'; label: string }[] = [];
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    if (taken.includes(slot)) continue;
    if (!(card.keywords ?? []).some((k) => k.en === 'Freehand' || k.key === '空手')) continue;
    out.push({ slot, label: SLOT_LABEL[slot] });
  }
  return out;
}

// ---------- Charge (rulebook 4.14) ----------

// Only 5 cards carry machine-readable gameRules for this, and they are a
// disjoint set from the 7 that spend a Charge Token through the KC Armor or
// Charged keywords, so the keyword text has to be read as well or a card like
// TM31KC offers no Charge control at all.
const CHARGE_KEYWORD = /充能|KC装甲|\bCharged\b|\bKC Armor\b/i;

export function consumesCharge(a: CardAction): boolean {
  if ((a.gameRules ?? []).some((g) => g.consumesCharge === true
    || (g.conditions ?? []).some((c) => c.type === 'charge_available'))) return true;
  return (a.keywords ?? []).some((k) => CHARGE_KEYWORD.test(k.inline ?? k.key ?? ''));
}

export function isChargeAction(a: CardAction): boolean {
  return a.id === 'COMMON_CHARGE'
    || (a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => (e as { type?: string }).type === 'set_unit_charge'));
}

export function isCharged(t: Token, slot: string): boolean {
  return (t.charge ?? []).includes(slot);
}

export function chargeableSlots(data: GameData, t: Token): { slot: PartSlot | 'pilot' | 'main'; label: string; charged: boolean }[] {
  const out: { slot: PartSlot | 'pilot' | 'main'; label: string; charged: boolean }[] = [];
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    if (!(card.actions ?? []).some((a) => consumesCharge(a))) continue;
    out.push({ slot, label: SLOT_LABEL[slot], charged: isCharged(t, slot) });
  }
  return out;
}

export function explosionScope(a: CardAction, english?: string): 'single' | 'all' {
  const printed = (a.description?.en ?? '').trim() || (english ?? '').trim();
  const hay = printed || a.description?.zh || '';
  if (/all\s+units|所有单位|每个单位/i.test(hay)) return 'all';
  return 'single';
}

export function needsSightToLanding(a: CardAction): boolean {
  const hay = [
    a.description?.zh ?? '',
    a.description?.en ?? '',
    ...(a.keywords ?? []).map((k) => k.inline ?? k.key ?? ''),
  ].join(' ');
  if (/曲射|Fire in arc/i.test(hay)) return false;
  return /直射|Direct Fire/i.test(hay);
}

export function canActivateCamo(data: GameData, t: Token): boolean {
  for (const { card } of tokenCards(data, t)) {
    for (const a of card.actions ?? []) {
      const text = `${a.description?.zh ?? ''} ${a.description?.en ?? ''}`;
      if (/开启光学迷彩|Activate Optical Camouflage/i.test(text)) return true;
    }
  }
  return false;
}

export function interceptCapacity(a: CardAction): number | undefined {
  for (const k of a.keywords ?? []) {
    const m = /^拦截\s*(\d+)$/.exec((k.inline ?? '').trim());
    if (m) return Number(m[1]);
  }
  for (const text of [a.description?.en, a.description?.zh, a.description?.jp]) {
    const m = /(?:Intercept|拦截|迎撃)\s*(\d+)/.exec(text ?? '');
    if (m) return Number(m[1]);
  }
  return undefined;
}

// Every card id currently on the board, so the Add tab can subtract what is
// already in play from what the inventory says you own.
export function deployedCardCounts(tokens: Token[]): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (id?: string) => {
    if (!id) return;
    out.set(id, (out.get(id) ?? 0) + 1);
  };
  for (const t of tokens) {
    if (t.kind === 'mech') {
      for (const slot of PART_SLOTS) bump(t.mech?.[slot]);
      bump(t.mech?.pilot);
      continue;
    }
    bump(t.cardId);
    bump(t.droneBackpack);
  }
  return out;
}

export interface SmokePlacement {
  count: number;
  connected: boolean;
}

export function smokePlacement(a: CardAction): SmokePlacement | undefined {
  const texts = [a.description?.en, a.description?.zh, a.description?.jp, ...(a.keywords ?? []).map((k) => k.inline ?? k.en ?? k.key ?? '')];
  const blob = texts.filter(Boolean).join(' ');
  if (!/Smoke Screen|烟幕|煙幕/i.test(blob)) return undefined;
  const en = /place (?:up to )?(\d+) Smoke Screens?/i.exec(blob);
  const zh = /放置\s*(\d+)\s*(?:个)?(?:烟幕|煙幕)/.exec(blob);
  const count = Number(en?.[1] ?? zh?.[1] ?? 0);
  if (!count) return undefined;
  return { count, connected: /Connected|相连|連結/i.test(blob) };
}

function initIntercept(cards: Card[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) {
    for (const a of c.actions ?? []) {
      const n = interceptCapacity(a);
      if (n !== undefined) out[a.id] = n;
    }
  }
  return out;
}

// The furthest an Intercept Action on this unit reaches, so a launch can say
// whose Interception it woke up.
export function interceptReach(data: GameData, t: Token): number {
  let best = 0;
  for (const { card } of tokenCards(data, t)) {
    for (const a of card.actions ?? []) {
      if (interceptCapacity(a) === undefined) continue;
      best = Math.max(best, a.range ?? 0);
    }
  }
  return best;
}

export function interceptLeft(t: Token): number {
  return Object.values(t.intercept ?? {}).reduce((s, n) => s + n, 0);
}

export function interceptTotal(data: GameData, t: Token): number {
  let n = 0;
  for (const { card } of tokenCards(data, t)) {
    for (const a of card.actions ?? []) n += interceptCapacity(a) ?? 0;
  }
  return n;
}

export function makeDroneToken(state: GameState, data: GameData, card: Card, side: Side, backpack?: string): Omit<Token, 'col' | 'row' | 'facing'> {
  const cards = [card, backpack ? data.byId.get(backpack) : undefined].filter((x): x is Card => !!x);
  return {
    uid: uidSource.next(state),
    side,
    kind: card.category === 'projectile' ? 'projectile' : 'drone',
    cardId: card.id,
    droneBackpack: backpack,
    label: shortName(card),
    size: unitSize(card),
    aerial: isAerial(card),
    stance: (card.stance as Stance) || 'offensive',
    partStates: { main: 'intact', ...(backpack ? { backpack: 'intact' } : {}) },
    ammo: initAmmo(cards),
    intercept: initIntercept(cards),
  };
}

export function makeMechToken(state: GameState, data: GameData, loadout: MechLoadout, side: Side, name?: string): Omit<Token, 'col' | 'row' | 'facing'> {
  const cards = mechCards(data, loadout);
  const pilot = loadout.pilot ? data.byId.get(loadout.pilot) : undefined;
  const torso = loadout.torso ? data.byId.get(loadout.torso) : undefined;
  const partStates: Token['partStates'] = {};
  for (const slot of PART_SLOTS) if (loadout[slot]) partStates[slot] = 'intact';
  return {
    uid: uidSource.next(state),
    side,
    kind: 'mech',
    cardId: loadout.torso ?? '',
    mech: loadout,
    label: mechLabel(data, loadout, name),
    size: 3,
    aerial: false,
    stance: 'offensive',
    link: pilot?.LV ?? 3,
    partStates,
    ammo: initAmmo(cards),
    intercept: initIntercept(cards),
  };
}

function mechLabel(data: GameData, loadout: MechLoadout, name?: string): string {
  if (name) return tidyUnitLabel(name);
  const torso = loadout.torso ? data.byId.get(loadout.torso) : undefined;
  return torso ? compactName(torso) : 'Mech';
}

const TYPE_SUFFIXES = [
  'Electronic Warfare Core',
  'High-mobility Chassis',
  'Standard Chassis',
  'Armored Chassis',
  'Support Chassis',
  'Stealth Chassis',
  'Assault Chassis',
  'Agile Chassis',
  'Battle Core',
  'Tactical Core',
  'Assault Core',
  'Support Core',
  'Command Core',
  'Armored Core',
  'Stealth Core',
  'Combat Core',
  'Recon Core',
  'Node Core',
  'ECM Core',
  'Chassis Part',
  'Core Part',
  'Trial Model',
  'Experimental',
  'Chassis',
  'Core',
];

export function shortName(card: Card): string {
  return compactName(card);
}

export function isElectronicAttack(a: CardAction): boolean {
  if ((a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => e.type === 'electronic' && e.mode === 'attack'))) return true;
  const text = `${a.description?.en ?? ''} ${a.description?.zh ?? ''} ${(a.keywords ?? [])
    .map((k) => `${k.en ?? ''} ${k.key ?? ''} ${k.inline ?? ''}`)
    .join(' ')}`.toLowerCase();
  return text.includes('electronic attack') || text.includes('电子攻击');
}

export function electronicValue(data: GameData, t: Token): number {
  return tokenCards(data, t)
    .filter(({ slot }) => slot !== 'pilot')
    .filter(({ slot }) => (t.partStates[slot as PartSlot | 'main'] ?? 'intact') !== 'destroyed')
    .reduce((sum, { card }) => sum + (card.electronic ?? 0), 0);
}

export function defaultUnitLabel(data: GameData, t: Token): string {
  if (t.kind === 'mech') return mechLabel(data, t.mech ?? {});
  const card = t.cardId ? data.byId.get(t.cardId) : undefined;
  return card ? shortName(card) : t.label;
}

export function tidyUnitLabel(name: string): string {
  return (
    name
      .replace(/\s+/g, ' ')
      .replace(/^(?:blue|red|un|rdl|gof|pd)\s+/i, '')
      .replace(/\s*\bM\.?A\.?P\.?s?\b\.?/gi, ' ')
      .replace(/\s*\(mech\)\s*/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/[\s.·,-]+$/, '')
      .trim() || name
  );
}

export function compactName(card: Card): string {
  const raw = (card.name.en || card.name.zh || card.id).replace(/\s+/g, ' ').trim();
  const paren = /\s(\([^)]*\))$/.exec(raw);
  let base = paren ? raw.slice(0, paren.index).trim() : raw;
  for (let i = 0; i < 3; i++) {
    const hit = TYPE_SUFFIXES.find((s) => base.toLowerCase().endsWith(' ' + s.toLowerCase()));
    if (!hit) break;
    const next = base.slice(0, base.length - hit.length).trim();
    if (next.length < 3) break;
    base = next;
  }
  return paren ? `${base} ${paren[1]}` : base;
}

export function mechCards(data: GameData, loadout: MechLoadout): Card[] {
  return PART_SLOTS.map((s) => (loadout[s] ? data.byId.get(loadout[s]!) : undefined)).filter((x): x is Card => !!x);
}

// ---------- faction legality ----------

export interface FactionProblem {
  kind: 'mixed-mech' | 'mixed-squad';
  label: string;
  detail: string;
}

export function tokenFactions(data: GameData, t: Token): { factions: string[]; unknown: number } {
  const seen = new Set<string>();
  let unknown = 0;
  for (const { card } of tokenCards(data, t)) {
    const f = data.factionOf(card);
    if (f) seen.add(f);
    else unknown++;
  }
  return { factions: [...seen], unknown };
}

// Factions that hire out rather than field their own squads. Confirmed with the
// community: Planetring Dynamics and the White Dwarf collaboration are both
// mercenary, so they may serve alongside RDL, UN or GoF. GoF itself is a real
// allegiance and still cannot mix with RDL or UN.
export const MERCENARY_FACTIONS = ['PD', 'COLLABORATION'];

export function factionProblems(data: GameData, tokens: Token[]): FactionProblem[] {
  const out: FactionProblem[] = [];
  const squad = new Set<string>();
  for (const t of tokens) {
    const { factions } = tokenFactions(data, t);
    factions.forEach((f) => squad.add(f));
    if (t.kind === 'mech' && factions.length > 1) {
      const parts = tokenCards(data, t)
        .map(({ slot, card }) => ({ slot, f: data.factionOf(card), card }))
        .filter((x) => x.f);
      out.push({
        kind: 'mixed-mech',
        label: t.label,
        detail: `${factions.join(' and ')} parts on one mech: ${parts.map((p) => `${cardName(p.card)} (${p.f})`).join(', ')}`,
      });
    }
  }
  const allegiance = [...squad].filter((f) => !MERCENARY_FACTIONS.includes(f));
  if (allegiance.length > 1) {
    out.push({
      kind: 'mixed-squad',
      label: 'Squad',
      detail: `This squad mixes ${allegiance.join(' and ')}. A squad may only contain units from a single faction, though mercenaries may join any of them.`,
    });
  }
  return out;
}

export function pilotCard(data: GameData, t: Token): Card | undefined {
  return t.kind === 'mech' && t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
}

// A Mech Maneuvers at the Maneuver Value printed on its Chassis; a Drone moves at
// its own value. Mobility Stance doubles it (rulebook 3.4.3).
export function maneuverRange(data: GameData, t: Token): number {
  const card = t.kind === 'mech' && t.mech?.chasis ? data.byId.get(t.mech.chasis) : data.byId.get(t.cardId);
  const base = card?.move ?? 0;
  return t.stance === 'mobility' ? base * 2 : base;
}

export function initiativeFor(data: GameData, t: Token, timing: Timing): number | undefined {
  const def = TIMINGS.find((x) => x.id === timing);
  const pilot = pilotCard(data, t);
  if (!def || !pilot) return undefined;
  const v = pilot[def.pilotKey];
  return typeof v === 'number' ? v : undefined;
}

export function tokenCards(data: GameData, t: Token): { slot: PartSlot | 'pilot' | 'main'; card: Card }[] {
  if (t.kind === 'mech' && t.mech) {
    const out: { slot: PartSlot | 'pilot'; card: Card }[] = [];
    for (const slot of PART_SLOTS) {
      const id = t.mech[slot];
      const card = id ? data.byId.get(id) : undefined;
      if (card) out.push({ slot, card });
    }
    const pilot = t.mech.pilot ? data.byId.get(t.mech.pilot) : undefined;
    if (pilot) out.push({ slot: 'pilot', card: pilot });
    return out;
  }
  const out: { slot: 'main' | 'backpack'; card: Card }[] = [];
  const main = data.byId.get(t.cardId);
  if (main) out.push({ slot: 'main', card: main });
  const bp = t.droneBackpack ? data.byId.get(t.droneBackpack) : undefined;
  if (bp) out.push({ slot: 'backpack', card: bp });
  return out as { slot: PartSlot | 'main'; card: Card }[];
}

export interface GuidedAction {
  action: CardAction;
  card: Card;
  slot: PartSlot | 'pilot' | 'main';
  available: boolean;
  reason?: string;
  ammoLeft?: number;
  intercept?: { left: number; max: number; can: boolean; reason?: string };
  // Present only on an Action carrying the Charge Icon (4.14).
  charge?: { charged: boolean };
  projectiles: Card[];
}

export interface ActionWorld {
  tokens: Token[];
  terrain: TerrainPiece[];
}

export function guidedActions(data: GameData, t: Token, world?: ActionWorld): GuidedAction[] {
  const out: GuidedAction[] = [];
  const lockers = world ? lockersOf(data, t, world.tokens, world.terrain) : [];
  for (const { slot, card } of tokenCards(data, t)) {
    const partState = t.partStates[slot as PartSlot | 'main'] ?? 'intact';
    for (const a of card.actions ?? []) {
      let available = true;
      let reason: string | undefined;
      if (t.stance === 'shutdown') {
        available = false;
        reason = 'shutdown (Reboot only)';
      } else if (partState === 'destroyed') {
        available = false;
        reason = `${SLOT_LABEL[slot]} destroyed`;
      } else if (a.type === 'Firing' && statusCount(t.statuses, 'fci') > 0) {
        available = false;
        reason = 'Fire Control Interference blocks Firing';
      } else if (a.type === 'Firing' && lockers.length && !isMeleeFiring(a)) {
        available = false;
        reason = `Melee Locked by ${lockers.map((o) => o.label).join(', ')}`;
      } else if (a.type === 'Moving' && statusCount(t.statuses, 'immobilized') > 0) {
        available = false;
        reason = 'Immobilized blocks Movement';
      }
      const ammoLeft = a.storage && a.storage > 0 ? t.ammo[a.id] ?? a.storage : undefined;
      if (available && ammoLeft === 0) {
        available = false;
        reason = 'out of ammo';
      }

      const max = interceptCapacity(a);
      let intercept: GuidedAction['intercept'];
      if (max !== undefined) {
        const left = t.intercept?.[a.id] ?? max;
        let can = true;
        let iReason: string | undefined;
        if (!available) {
          can = false;
          iReason = reason;
        } else if (statusCount(t.statuses, 'fci') > 0) {
          can = false;
          iReason = 'Fire Control Interference blocks Interception';
        } else if (left === 0) {
          can = false;
          iReason = 'no Interception Tokens left';
        }
        intercept = { left, max, can, reason: iReason };
        // A Passive Intercept part exists only to Intercept, so an empty one has nothing left to do.
        if (available && !can && a.type === 'Passive') {
          available = false;
          reason = iReason;
        }
      }

      const projectiles = Array.isArray(card.projectile)
        ? card.projectile.map((id) => data.byId.get(id)).filter((x): x is Card => !!x)
        : [];
      const charge = consumesCharge(a) ? { charged: isCharged(t, slot) } : undefined;
      out.push({ action: a, card, slot, available, reason, ammoLeft, intercept, charge, projectiles: a.type === 'Projectile' ? projectiles : [] });
    }
  }
  return out;
}

function legacyZoneSet(s: unknown): string {
  const o = (s ?? {}) as { mission?: string | null; deployLayout?: string | null; map?: string };
  if (o.mission) return `mission:${o.mission}`;
  if (o.deployLayout) return `board:${o.deployLayout}`;
  if (o.map?.startsWith('custom:')) return o.map;
  return '';
}

function normaliseTactics(raw: unknown): Record<Side, string[]> {
  const v = (raw ?? {}) as Partial<Record<Side, unknown>>;
  const side = (x: unknown): string[] => (Array.isArray(x) ? x.filter((n): n is string => typeof n === 'string') : []);
  return { blue: side(v.blue), red: side(v.red) };
}

export function migrateState(raw: unknown, data: GameData): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as {
    v?: number;
    map?: string;
    tokens?: unknown[];
    nextUid?: number;
    round?: GameState['round'];
    commandTokens?: GameState['commandTokens'];
  };
  if (!Array.isArray(s.tokens)) return null;
  if (s.v !== 1 && s.v !== 2 && s.v !== 3) return null;
  const state: GameState = {
    v: 3,
    map: s.map ?? '',
    tokens: [],
    nextUid: s.nextUid ?? 1,
    round: s.round ?? { n: 1, phase: 0, firstPlayer: 'blue' },
    commandTokens: s.commandTokens ?? { blue: 0, red: 0 },
    markers: (s as { markers?: GameState['markers'] }).markers ?? [],
    smoke: (s as { smoke?: GameState['smoke'] }).smoke ?? [],
    script: normaliseScript((s as { script?: unknown }).script, (s.round ?? { firstPlayer: 'blue' }).firstPlayer ?? 'blue'),
    removedTerrain: (s as { removedTerrain?: string[] }).removedTerrain ?? [],
    scale: (s as { scale?: GameState['scale'] }).scale ?? 'standard',
    roundLimit: (s as { roundLimit?: number }).roundLimit ?? 5,
    sideNames: (s as { sideNames?: GameState['sideNames'] }).sideNames ?? {},
    mission: (s as { mission?: string | null }).mission ?? null,
    tasks: (s as { tasks?: unknown }).tasks ? normaliseTasks((s as { tasks?: unknown }).tasks) : null,
    scenario: (s as { scenario?: string | null }).scenario ?? null,
    setup: normaliseSetup((s as { setup?: unknown }).setup),
    showZones: (s as { showZones?: boolean }).showZones ?? false,
    deployLayout: (s as { deployLayout?: string | null }).deployLayout ?? null,
    zoneSet: (s as { zoneSet?: string }).zoneSet ?? legacyZoneSet(s),
    boardTheme: (s as { boardTheme?: string }).boardTheme ?? DEFAULT_BOARD,
    tactics: normaliseTactics((s as { tactics?: unknown }).tactics),
    tacticsPlayed: normaliseTactics((s as { tacticsPlayed?: unknown }).tacticsPlayed),
  };
  for (const rawTok of s.tokens) {
    const t = rawTok as Partial<Token>;
    if (t.uid === undefined || t.col === undefined || t.row === undefined) continue;
    const card = t.cardId ? data.byId.get(t.cardId) : undefined;
    const cards =
      t.kind === 'mech' && t.mech ? mechCards(data, t.mech) : card ? [card] : [];
    const pilot = t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
    const partStates =
      t.partStates ??
      (t.kind === 'mech' && t.mech
        ? Object.fromEntries(PART_SLOTS.filter((sl) => t.mech![sl]).map((sl) => [sl, 'intact']))
        : { main: 'intact' });
    let label = t.label ?? '?';
    if (/[぀-ヿ一-鿿]/.test(label) || label.includes('…')) {
      const nameSource = t.kind === 'mech' && t.mech?.torso ? data.byId.get(t.mech.torso) : card;
      if (nameSource) label = compactName(nameSource);
    } else {
      const tidied = tidyUnitLabel(label);
      if (tidied.length < label.length) label = tidied;
    }

    state.tokens.push({
      uid: t.uid,
      side: t.side ?? 'blue',
      kind: t.kind ?? 'drone',
      cardId: t.cardId ?? '',
      mech: t.mech,
      parentUid: t.parentUid,
      droneBackpack: t.droneBackpack,
      label,
      col: t.col,
      row: t.row,
      size: t.size ?? 1,
      facing: t.facing ?? 0,
      aerial: t.aerial ?? false,
      stance: t.stance ?? ((card?.stance as Stance) || 'offensive'),
      link: t.link ?? (t.kind === 'mech' ? pilot?.LV ?? 3 : undefined),
      timing: t.timing,
      deployed: t.deployed === false ? false : undefined,
      expiring: Array.isArray(t.expiring) ? t.expiring.filter((x) => typeof x === 'string') : undefined,
      partStates: partStates as Token['partStates'],
      // Top up rather than default. `?? initAmmo` only fired when the field was
      // absent, so a token carrying an empty object, which is what a save from
      // before Ammo existed holds, could never gain a count and every launcher
      // on it silently spent nothing. A key already present always wins, so a
      // magazine spent down to 0 is not refilled.
      ammo: { ...initAmmo(cards), ...(t.ammo ?? {}) },
      intercept: { ...initIntercept(cards), ...(t.intercept ?? {}) },
      charge: Array.isArray(t.charge) && t.charge.length ? t.charge.filter((x: unknown) => typeof x === 'string') : undefined,
      log: t.log ?? [],
      statuses: (t.statuses ?? []).filter((s: string) => s !== 'interception'),
    });
  }
  return state;
}

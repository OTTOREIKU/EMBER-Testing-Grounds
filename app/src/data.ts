import type { Card, CardAction, ExtraTickCheck, LangText, Side, TerrainData } from './types';

// A squad is numbered, not factioned. The internal id stays a colour word so
// saved games and scenarios keep loading, but nothing displays it: the number
// below is what a player sees, and the colour comes from the squad's faction.
export const SQUAD_ORDER: Side[] = ['s1', 's2'];

export function squadNumber(side: Side): number {
  const at = SQUAD_ORDER.indexOf(side);
  return at < 0 ? 1 : at + 1;
}

export function squadName(side: Side, custom?: string): string {
  return custom?.trim() || `Squad ${squadNumber(side)}`;
}

// Display only. The names live in GameState, but the board, the roster and the
// unit panel all render squad labels without a state reference, and threading
// one through fifty call sites to print a word is not worth it. main.ts
// refreshes this whenever the state changes.
let currentSquadNames: Partial<Record<Side, string>> = {};

export function setSquadNames(names: Partial<Record<Side, string>> | undefined): void {
  currentSquadNames = names ?? {};
}

export function squadLabel(side: Side): string {
  return squadName(side, currentSquadNames[side]);
}

export interface BoxDef {
  key: string;
  id: number;
  name: LangText;
  faction?: string[];
  hasImage?: boolean;
  // From box_status.json: whether the box has ever been produced and sold.
  // Undefined means nobody has checked, which is not the same as false.
  released?: boolean;
  product?: string;
  // Kept in the data but never listed: something nobody can buy again, such as
  // the Kickstarter Game Pack. Its cards stay and still name it, so a card that
  // came from one is still explained.
  hidden?: boolean;
}

interface BoxStatus {
  boxes?: Record<string, { released?: boolean; product?: string; hasImage?: boolean; hidden?: boolean }>;
}

interface QrIds {
  cards?: Record<string, number>;
}

// ---------- faction resolution ----------

export const BASE_FACTIONS = ['RDL', 'UN', 'GOF'] as const;

export const FACTION_LABEL: Record<string, string> = {
  RDL: 'RDL',
  UN: 'UN',
  GOF: 'GoF',
  PD: 'PD',
  COLLABORATION: 'Collab',
};

function normaliseBoxes(cards: Card[]): void {
  for (const c of cards) {
    const box = (c as { box?: string }).box;
    if (!box || c.containedIn?.length) continue;
    c.containedIn = [{ box, quantityPerBox: 1 }];
  }
}

function buildFactionIndex(cards: Card[], boxes: BoxDef[]): Map<string, string | null> {
  const boxFaction = new Map(boxes.map((b) => [b.key, b.faction ?? []]));
  const out = new Map<string, string | null>();
  for (const c of cards) {
    if (c.faction) {
      out.set(c.id, c.faction.toUpperCase());
      continue;
    }
    const keys = (c.containedIn ?? []).map((e) => e.box).filter(Boolean) as string[];
    const single = new Set<string>();
    const any = new Set<string>();
    for (const k of keys) {
      const f = boxFaction.get(k);
      if (!f || !f.length) continue;
      f.forEach((x) => any.add(x));
      if (f.length === 1) single.add(f[0]);
    }
    const resolved = single.size ? single : any;
    out.set(c.id, resolved.size === 1 ? [...resolved][0] : null);
  }
  return out;
}

const BASE = import.meta.env.BASE_URL;

export function assetUrl(path: string): string {
  return `${BASE}assets/${path}`;
}

export function dataUrl(file: string): string {
  return `${BASE}data/${file}`;
}

export function boxCoverUrl(id: number): string {
  return assetUrl(`box_cover/${id}.webp`);
}

export function factionArtUrl(key: string): string {
  return assetUrl(`factions/${key}.jpg`);
}

export interface FactionDef {
  key: string;
  name: string;
  short: string;
  supplier?: string;
  hook?: string;
  text: string;
  // PD and the White Dwarf collaboration have no published lore or key art, so
  // their write-ups are ours and must not be credited to the publisher.
  ours?: boolean;
  // Whether key art exists for the faction. A flag rather than an onerror,
  // matching BoxDef.hasImage: the art is lazy-loaded inside a scroll container,
  // so a missing file never requests and never fires an error to react to.
  // Absent means yes, so the three lore factions need no entry.
  art?: boolean;
  // Kept in the data but not listed in the Factions tab. PD and the White Dwarf
  // are real factions for squad building but have no lore or art, so they sat
  // oddly beside three illustrated write-ups; the entries stay ready for
  // whatever presentation replaces it.
  hidden?: boolean;
}

export interface KeywordDef {
  key: string;
  zh?: { name?: string; value?: string };
  en?: { name?: string; value?: string };
  jp?: { name?: string; value?: string };
}

export interface MechanicDef {
  id: string;
  name: string;
  ref?: string;
  match: string[];
  text: string;
}

export interface MissionFamily {
  id: string;
  name: string;
  nameKo?: string;
  text: string;
  faq?: { q: string; a: string }[];
}

export interface MissionCard {
  id: string;
  family: string;
  name: string;
  nameKo?: string;
  setup: string;
  scoring: string;
  vp?: number;
  // The first Round this Task can pay out, and whether it pays every Round or
  // once at the end. Both are read off the printed English on the card.
  fromRound?: number;
  cadence?: 'per-round' | 'at-end';
  zones?: string[];
  scoringZone?: string;
  deployment?: string;
  inRulebook?: boolean;
}

export interface MissionData {
  families: MissionFamily[];
  cards: MissionCard[];
}

export interface PhaseDef {
  id: string;
  name: string;
  order: number;
  ref?: string;
  who?: string;
  can: string[];
  cannot: string[];
}

export interface TimingDef {
  id: string;
  name: string;
  order: number;
  text: string;
}

export interface StanceDef {
  id: string;
  name: string;
  short: string;
  ref?: string;
  effect: string;
  good: string;
  cost: string;
}

export interface SecondaryTask {
  id: string;
  name: string;
  nameKo?: string;
  token?: string | null;
  setup: string;
  scoring: string;
  vp?: number;
  // How the card scores, and who names its target, both read off the printed
  // card text so the End Phase can settle it without a human reading prose.
  kind?: 'destroy-designated' | 'survive-designated' | 'per-kill' | 'per-kill-by-unit' | 'no-mech-lost' | 'hold-zone';
  designate?: 'none' | 'own-mech' | 'enemy-mech' | 'enemy-own-mech' | 'zone';
  inRulebook?: boolean;
}

export interface ZoneDef {
  id: string;
  name: string;
  cells: string[];
}

export interface DeploymentDef {
  id: string;
  name: string;
  note?: string;
  black: { from: string; to: string };
  white: { from: string; to: string };
}

export interface ZoneData {
  zones: ZoneDef[];
  deployments: DeploymentDef[];
  missionDeployment: Record<string, string>;
}

const NO_ZONES: ZoneData = { zones: [], deployments: [], missionDeployment: {} };

export function parseGridRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-La-l])(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  const col = m[1].toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[2]) - 1;
  if (col < 0 || col > 11 || row < 0 || row > 11) return null;
  return { col, row };
}

export interface PlayData {
  phases: PhaseDef[];
  timings: TimingDef[];
  timingNotes?: { ref?: string; lines: string[] };
  stances: StanceDef[];
  stanceNotes?: { ref?: string; lines: string[] };
}

export interface CommonAction extends CardAction {
  slots: string[];
  silence?: boolean;
  requires?: string;
  phase?: string;
}

export interface ExtraTickGrant {
  actionId: string;
  card: string;
  label: string;
  timing: string;
  condition: string;
  check?: ExtraTickCheck;
}

interface AmmoOverrides {
  actions?: Record<string, number>;
}

// The generated cards.json records no Ammo for almost every Drone action, so the
// printed counts are patched back in here (see data/ammo_overrides.json).
function applyAmmo(cards: Card[], patch: AmmoOverrides): void {
  const byId = patch.actions ?? {};
  for (const c of cards) {
    for (const a of c.actions ?? []) {
      const n = byId[a.id];
      if (typeof n === 'number') a.storage = n;
    }
  }
}

interface ActionOverrides {
  actions?: Record<string, Partial<CardAction>>;
}

// Per-action corrections keyed by action id, for fields the community database
// got wrong or never recorded — a Firing action with no range, a timing filed
// under the generic Tactic. Source is the publisher's parts lists; see
// data/action_overrides.json.
function applyActionFixes(cards: Card[], patch: ActionOverrides): void {
  const byId = patch.actions ?? {};
  for (const c of cards) {
    for (const a of c.actions ?? []) {
      const fix = byId[a.id];
      if (!fix) continue;
      for (const [k, v] of Object.entries(fix)) {
        if (k.startsWith('_')) continue;
        // A name patch only ever supplies `en`; replacing the object outright
        // would throw away the Chinese the card already has.
        if (k === 'name' && v && typeof v === 'object') a.name = { ...a.name, ...v };
        else (a as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }
}

interface StatOverrides {
  cards?: Record<string, Partial<Card>>;
}

// A few printed stats are wrong in the community database, so the scanned values
// are patched back in here (see data/stat_overrides.json).
function applyStats(cards: Card[], patch: StatOverrides): void {
  const byId = patch.cards ?? {};
  for (const c of cards) {
    const fix = byId[c.id];
    if (fix) Object.assign(c, fix);
  }
}

export interface OverloadGrant {
  actionId: string;
  card: string;
  label: string;
}

interface CommonActionData {
  actions?: CommonAction[];
  extraTicks?: ExtraTickGrant[];
  overload?: OverloadGrant[];
}

const NO_COMMON: CommonActionData = { actions: [], extraTicks: [], overload: [] };

export interface GameData {
  cards: Card[];
  byId: Map<string, Card>;
  terrain: TerrainData;
  boxes: BoxDef[];
  factionOf(card: Card): string | null;
  keywords: KeywordDef[];
  keyword(nameOrKey: string): KeywordDef | undefined;
  mechanics: MechanicDef[];
  mechanicsFor(...text: (string | undefined)[]): MechanicDef[];
  actionTranslation(actionId: string): { english: string | null; confidence: string; note?: string } | undefined;
  // The same thing for a card's OWN text, for the handful whose description.en
  // is a copy of the Chinese rather than a translation of it.
  cardTranslation(cardId: string): { english: string | null; confidence: string; note?: string } | undefined;
  missions: MissionData;
  secondary: SecondaryTask[];
  zoneData: ZoneData;
  play: PlayData;
  commonActions: CommonAction[];
  extraTicks: ExtraTickGrant[];
  overload: OverloadGrant[];
  factions: FactionDef[];
}

interface KeywordOverrides {
  overrides?: Record<string, Partial<KeywordDef>>;
}

interface ActionTranslations {
  translations?: Record<string, { english: string | null; confidence: string; note?: string }>;
  cards?: Record<string, { english: string | null; confidence: string; note?: string }>;
}

interface NameOverrides {
  cards?: Record<string, { en: string }>;
  actions?: Record<string, { en: string }>;
  // `en` is the trait DESCRIPTION and `name` is the trait NAME, and an entry may
  // carry either alone: 20 of the 22 publisher names correct nothing but the
  // name, and XPA-62 corrects nothing but the text. Both optional for that
  // reason — see the merge below, which is guarded per field.
  traits?: Record<string, { en?: string; name?: string }>;
  boxes?: Record<string, { en: string }>;
}

interface FactionOverrides {
  cards?: Record<string, { faction: string }>;
}

interface BoxContentsOverrides {
  boxes?: Record<string, { cards?: Record<string, number> }>;
}

// Each listed box is authoritative: strip it from every card first, then re-add
// only what the override names, so a wrongly grouped set is corrected in both
// directions rather than merely gaining entries.
function applyBoxContents(cards: Card[], patch: BoxContentsOverrides): void {
  const boxes = patch.boxes ?? {};
  const keys = new Set(Object.keys(boxes));
  if (!keys.size) return;
  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const c of cards) {
    if (!c.containedIn?.length) continue;
    c.containedIn = c.containedIn.filter((e) => !keys.has(e.box));
  }
  for (const [box, def] of Object.entries(boxes)) {
    for (const [id, n] of Object.entries(def.cards ?? {})) {
      const card = byId.get(id);
      if (!card) continue;
      card.containedIn = [...(card.containedIn ?? []), { box, quantityPerBox: n }];
    }
  }
}

const NO_MISSIONS: MissionData = { families: [], cards: [] };
const NO_PLAY: PlayData = { phases: [], timings: [], stances: [] };

interface TacticEntry {
  name: string;
  faction?: string;
  timing?: string;
  text: string;
}

function applyTactics(cards: Card[], table: Record<string, TacticEntry>): void {
  for (const c of cards) {
    const t = table[c.id];
    if (!t) continue;
    c.name = { ...c.name, en: t.name };
    if (t.faction) c.faction = t.faction;
    if (!(c.actions ?? []).length) {
      c.actions = [
        {
          id: `${c.id}_T`,
          name: { en: t.timing ?? 'Tactics Card' },
          type: 'Tactic',
          description: { en: t.text },
        } as CardAction,
      ];
    }
  }
}

export async function loadData(): Promise<GameData> {
  const [cards, terrain, boxes, rawKeywords, patch, boxStatus, qrIds, mech, xlate, names, missions, tactics, play, secondary, zoneData, facPatch, boxPatch, common, ammoPatch, statPatch, actionPatch, factionData, extraCards] = await Promise.all([
    fetch(dataUrl('cards.json')).then((r) => r.json() as Promise<Card[]>),
    fetch(dataUrl('terrain_layouts.json')).then((r) => r.json() as Promise<TerrainData>),
    fetch(dataUrl('boxes.json')).then((r) => r.json() as Promise<BoxDef[]>),
    fetch(dataUrl('keywords.json')).then((r) => r.json() as Promise<KeywordDef[]>),
    fetch(dataUrl('keyword_overrides.json'))
      .then((r) => (r.ok ? (r.json() as Promise<KeywordOverrides>) : { overrides: {} }))
      .catch(() => ({ overrides: {} }) as KeywordOverrides),
    fetch(dataUrl('box_status.json'))
      .then((r) => (r.ok ? (r.json() as Promise<BoxStatus>) : { boxes: {} }))
      .catch(() => ({ boxes: {} }) as BoxStatus),
    fetch(dataUrl('qr_ids.json'))
      .then((r) => (r.ok ? (r.json() as Promise<QrIds>) : { cards: {} }))
      .catch(() => ({ cards: {} }) as QrIds),
    fetch(dataUrl('mechanics.json'))
      .then((r) => (r.ok ? (r.json() as Promise<{ mechanics: MechanicDef[] }>) : { mechanics: [] }))
      .catch(() => ({ mechanics: [] as MechanicDef[] })),
    fetch(dataUrl('action_translations.json'))
      .then((r) => (r.ok ? (r.json() as Promise<ActionTranslations>) : { translations: {} }))
      .catch(() => ({ translations: {} }) as ActionTranslations),
    fetch(dataUrl('name_overrides.json'))
      .then((r) => (r.ok ? (r.json() as Promise<NameOverrides>) : ({} as NameOverrides)))
      .catch(() => ({}) as NameOverrides),
    fetch(dataUrl('missions.json'))
      .then((r) => (r.ok ? (r.json() as Promise<MissionData>) : NO_MISSIONS))
      .catch(() => NO_MISSIONS),
    fetch(dataUrl('tactics.json'))
      .then((r) => (r.ok ? (r.json() as Promise<{ tactics?: Record<string, TacticEntry> }>) : { tactics: {} }))
      .catch(() => ({ tactics: {} })),
    fetch(dataUrl('play.json'))
      .then((r) => (r.ok ? (r.json() as Promise<PlayData>) : NO_PLAY))
      .catch(() => NO_PLAY),
    fetch(dataUrl('secondary.json'))
      .then((r) => (r.ok ? (r.json() as Promise<{ cards?: SecondaryTask[] }>) : { cards: [] }))
      .catch(() => ({ cards: [] as SecondaryTask[] })),
    fetch(dataUrl('zones.json'))
      .then((r) => (r.ok ? (r.json() as Promise<ZoneData>) : NO_ZONES))
      .catch(() => NO_ZONES),
    fetch(dataUrl('faction_overrides.json'))
      .then((r) => (r.ok ? (r.json() as Promise<FactionOverrides>) : ({} as FactionOverrides)))
      .catch(() => ({}) as FactionOverrides),
    fetch(dataUrl('box_contents_overrides.json'))
      .then((r) => (r.ok ? (r.json() as Promise<BoxContentsOverrides>) : ({} as BoxContentsOverrides)))
      .catch(() => ({}) as BoxContentsOverrides),
    fetch(dataUrl('common_actions.json'))
      .then((r) => (r.ok ? (r.json() as Promise<CommonActionData>) : NO_COMMON))
      .catch(() => NO_COMMON),
    fetch(dataUrl('ammo_overrides.json'))
      .then((r) => (r.ok ? (r.json() as Promise<AmmoOverrides>) : ({} as AmmoOverrides)))
      .catch(() => ({}) as AmmoOverrides),
    fetch(dataUrl('stat_overrides.json'))
      .then((r) => (r.ok ? (r.json() as Promise<StatOverrides>) : ({} as StatOverrides)))
      .catch(() => ({}) as StatOverrides),
    fetch(dataUrl('action_overrides.json'))
      .then((r) => (r.ok ? (r.json() as Promise<ActionOverrides>) : ({} as ActionOverrides)))
      .catch(() => ({}) as ActionOverrides),
    fetch(dataUrl('factions.json'))
      .then((r) => (r.ok ? (r.json() as Promise<{ factions?: FactionDef[] }>) : { factions: [] }))
      .catch(() => ({ factions: [] as FactionDef[] })),
    fetch(dataUrl('cards_extra.json'))
      .then((r) => (r.ok ? (r.json() as Promise<{ cards?: Card[] }>) : { cards: [] }))
      .catch(() => ({ cards: [] as Card[] })),
  ]);

  // Cards the community bundle does not have. cards.json is regenerated from
  // that bundle, so a card added there by hand would vanish on the next
  // regeneration; this file is the same escape hatch the override files are.
  // An id already present wins from cards.json and the extra is dropped, so the
  // file can never quietly redefine a real card - use stat_overrides for that.
  for (const extra of extraCards.cards ?? []) {
    if (cards.some((c) => c.id === extra.id)) continue;
    cards.push(extra);
  }

  cleanCardText(cards);
  applyTactics(cards, tactics.tactics ?? {});
  normaliseBoxes(cards);
  applyBoxContents(cards, boxPatch);
  applyAmmo(cards, ammoPatch);
  applyActionFixes(cards, actionPatch);
  applyStats(cards, statPatch);

  for (const b of boxes) {
    const bn = names.boxes?.[b.key];
    if (bn) b.name = { ...b.name, en: bn.en };
    const st = boxStatus.boxes?.[b.key];
    if (st) {
      b.released = st.released;
      b.product = st.product;
      b.hidden = st.hidden;
      // Covers we have sourced ourselves; boxes.json only knows the ones the
      // builder bundle shipped with.
      if (st.hasImage) b.hasImage = true;
    }
  }

  for (const c of cards) {
    // A numeric id is already the QR number; a serial-style one needs the
    // lookup, and only where it has been verified against the publisher.
    c.qrId = /^\d+$/.test(c.id) ? Number(c.id) : qrIds.cards?.[c.id];
    const cn = names.cards?.[c.id];
    if (cn) c.name = { ...c.name, en: cn.en };
    const tn = names.traits?.[c.id];
    // PER FIELD, not per entry. This used to assign `en: tn.en` for any entry
    // at all, which blanked the English description of every pilot whose
    // override corrects only the NAME — 20 of the 22 publisher names do.
    if (tn?.en) c.traitDescription = { ...c.traitDescription, en: tn.en };
    if (tn?.name) c.traitNameEn = tn.name;
    for (const a of c.actions ?? []) {
      const an = names.actions?.[a.id];
      if (an) a.name = { ...a.name, en: an.en };
    }
  }
  const byId = new Map(cards.map((c) => [c.id, c]));

  const overrides = patch.overrides ?? {};
  const keywords = rawKeywords.map((k) => {
    const o = overrides[k.key];
    return o ? { ...k, ...o, en: { ...k.en, ...o.en } } : k;
  });
  const haveKeys = new Set(keywords.map((k) => k.key));
  for (const [key, def] of Object.entries(overrides)) {
    if (!haveKeys.has(key)) keywords.push({ key, ...def } as KeywordDef);
  }
  for (const k of keywords) {
    for (const lang of ['en', 'zh', 'jp'] as const) {
      const entry = k[lang];
      if (entry?.name) entry.name = cleanName(entry.name);
      if (entry?.value) entry.value = cleanRulesText(entry.value);
    }
  }

  const index = new Map<string, KeywordDef>();
  const add = (key: string | undefined, def: KeywordDef) => {
    if (key) index.set(key.trim().toLowerCase(), def);
  };
  for (const k of keywords) {
    add(k.key, k);
    add(k.zh?.name, k);
    add(k.en?.name?.replace(/^[•·\s]+/, ''), k);
    add(k.jp?.name, k);
  }
  const keyword = (nameOrKey: string): KeywordDef | undefined => {
    if (!nameOrKey) return undefined;
    const raw = nameOrKey.trim().replace(/^[•·\s]+/, '').toLowerCase();
    return index.get(raw) ?? index.get(raw.replace(/\d+/g, 'x')) ?? index.get(raw.replace(/\d+/g, ''));
  };

  const mechanics = mech.mechanics ?? [];
  const mechanicsFor = (...text: (string | undefined)[]): MechanicDef[] => {
    const hay = text.filter(Boolean).join(' ').toLowerCase();
    if (!hay) return [];
    return mechanics.filter((m) => m.match.some((p) => hay.includes(p.toLowerCase())));
  };

  const translations = xlate.translations ?? {};
  const actionTranslation = (actionId: string) => translations[actionId];
  const cardXlate = xlate.cards ?? {};
  const cardTranslation = (cardId: string) => cardXlate[cardId];

  const factionIndex = buildFactionIndex(cards, boxes);
  for (const [id, o] of Object.entries(facPatch.cards ?? {})) {
    if (o?.faction) factionIndex.set(id, o.faction.toUpperCase());
  }
  const factionOf = (card: Card): string | null => factionIndex.get(card.id) ?? null;

  return {
    cards,
    byId,
    terrain,
    boxes,
    factionOf,
    keywords,
    keyword,
    mechanics,
    mechanicsFor,
    actionTranslation,
    cardTranslation,
    missions: { families: missions.families ?? [], cards: missions.cards ?? [] },
    secondary: secondary.cards ?? [],
    zoneData: {
      zones: zoneData.zones ?? [],
      deployments: zoneData.deployments ?? [],
      missionDeployment: zoneData.missionDeployment ?? {},
    },
    play: {
      phases: play.phases ?? [],
      timings: play.timings ?? [],
      timingNotes: play.timingNotes,
      stances: play.stances ?? [],
      stanceNotes: play.stanceNotes,
    },
    commonActions: common.actions ?? [],
    extraTicks: common.extraTicks ?? [],
    overload: common.overload ?? [],
    factions: factionData.factions ?? [],
  };
}

export function cardName(c: Card | undefined): string {
  if (!c) return '?';
  return c.name.en || c.name.zh || c.id;
}

// The pilot trait's name AS PRINTED FOR A READER: the publisher's English where
// we have it, the card's Chinese where we do not, never blank. Written once and
// beside cardName for the same reason cardName is written once — five surfaces
// print this (panel, reference summary, reference detail, inventory compare,
// part picker) and a per-page fallback is how two of them end up disagreeing.
//
// XPA-62 is the one trait-bearing pilot with no publisher English, so the
// Chinese arm is live rather than defensive.
//
// NOT for mechanicsFor. See Card.traitNameEn in types.ts: the matcher keys on
// the Chinese, and it is handed `c.trait` at every call site on purpose.
export function traitName(c: Card | undefined): string {
  return (c?.traitNameEn || c?.trait || '').trim();
}

function cleanName(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+\)/g, ')')
    .replace(/\(\s+/g, '(')
    .trim();
}

// Misspellings in the generated card text. cards.json is rebuilt from the
// community bundle, so a correction made there would vanish on the next
// extract; fixing them on load survives that. Each one is checked against the
// printed card scan before it goes in.
// Printed slips, not edition differences. Each term below is spelled one way on
// almost every card and another way on one or two, so the odd one out is a
// misprint rather than a distinct rule. The majority spelling wins, except for
// Anti-Armor, where card 074 settles it by carrying the term in its own name.
const TYPOS: [RegExp, string][] = [
  [/Anti-Aromor/g, 'Anti-Armor'],
  [/Anti-armor/g, 'Anti-Armor'],
  [/DIrect Fire/g, 'Direct Fire'],
  [/\[On hit\]/g, '[On Hit]'],
  [/\[Two-handed\]/g, '[Two-Handed]'],
];

function cleanRulesText(s: string): string {
  for (const [re, fix] of TYPOS) s = s.replace(re, fix);
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/。/g, '.')
    .replace(/([.!?])[.!?]+/g, '$1')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/！/g, '!')
    .replace(/？/g, '?')
    .replace(/[·•][ \t]*[·•]/g, '·')
    .replace(/\|([^|\n]{1,40})\|/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/([;,:])([A-Za-z])/g, '$1 $2')
    .replace(/([a-z0-9)])\.([A-Z])/g, '$1. $2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[·•][ \t]*$/g, '')
    .replace(/[ \t]+$/g, '')
    .trim();
}

function cleanCardText(cards: Card[]): void {
  for (const c of cards) {
    for (const k of ['en', 'zh', 'jp'] as const) {
      if (c.name[k]) c.name[k] = cleanName(c.name[k]!);
      if (c.description?.[k]) c.description[k] = cleanRulesText(c.description[k]!);
    }
    for (const a of c.actions ?? []) {
      for (const k of ['en', 'zh', 'jp'] as const) {
        if (a.name[k]) a.name[k] = cleanName(a.name[k]!);
        if (a.description?.[k]) a.description[k] = cleanRulesText(a.description[k]!);
      }
    }
    if (c.traitDescription) {
      for (const k of ['en', 'zh', 'jp'] as const) {
        if (c.traitDescription[k]) c.traitDescription[k] = cleanRulesText(c.traitDescription[k]!);
      }
    }
  }
}

export function rulesLines(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.replace(/^[·•\s]+/, '').trim())
    .filter(Boolean);
}

// A box worth listing. UNSALE is not a product at all, and `hidden` marks one
// nobody can buy again, such as the Kickstarter Game Pack. Both keep their cards
// and are still named on them; they simply never pad a list of boxes.
export function isListedBox(b: BoxDef): boolean {
  return b.key !== 'UNSALE' && !b.hidden;
}

export function cardImageUrl(id: string): string {
  return assetUrl(`cards/en/${id}.webp`);
}

const ACTION_ICONS = new Set(['firing', 'melee', 'moving', 'projectile', 'tactic', 'passive', 'swift']);

export function actionIconUrl(type: string | undefined): string | null {
  if (!type) return null;
  const key = type.toLowerCase();
  return ACTION_ICONS.has(key) ? assetUrl(`tokens/tab/icon_${key}.webp`) : null;
}

const STAT_ICONS: Record<string, string> = {
  armor: 'armor',
  structure: 'armor',
  dodge: 'dodge',
  parray: 'parray',
  electronic: 'electronic',
  move: 'swift',
  LV: 'LV',
  swift: 'swift',
  melee: 'melee',
  projectile: 'projectile',
  firing: 'firing',
  moving: 'moving',
  tactic: 'tactic',
};

export function statIconUrl(field: string): string | null {
  const name = STAT_ICONS[field];
  return name ? assetUrl(`tokens/tab/icon_${name}.webp`) : null;
}

export const TOKEN_PRINT: Record<string, string[]> = {
  fci: ['fci-yellow', 'fci-red'],
  fragile: ['fragile-yellow', 'fragile-red'],
  immobilized: ['immobilized-yellow', 'immobilized-red'],
  highlight: ['highlight-yellow', 'highlight-red'],
  lowProfile: ['lowProfile-green', 'lowProfile-red'],
  targetTracer: ['targetTracer-yellow', 'targetTracer-red'],
  repaired: ['repaired'],
  // Round tokens: one printed face each. Ammo and Charge are only ever added
  // and removed here, and a spent Interception is drawn dimmed rather than
  // flipped, so the back face — solid black on the real token — is never seen.
  interception: ['interception'],
  ammo: ['ammo'],
  charge: ['charge-green'],
  // Command is the one Round token whose back face IS seen, and often: 4.15
  // issues it to a Drone face-down and flips a Mech's own one face-down when an
  // Action consumes it. The two faces are modelled as two statuses rather than
  // one with a flag, so the strip and the popout draw them without knowing the
  // rule. `command-used` is the front blacked out, which is how the real backs
  // are printed.
  command: ['command'],
  commandUsed: ['command-used'],
};

// The four Stance tokens, the Rectangle that sits on a Mech's base. Not in
// TOKEN_PRINT because a Stance is not a status a unit bears — it is one of four
// exclusive states — so it is looked up directly by name.
export function stancePrintUrl(stance: string): string {
  return tokenPrintUrl(`stance-${stance}`);
}

// The printed background colours, sampled from the token art itself and matching
// the rulebook's token anatomy: colour is DURATION, not identity —
//   green  = indefinite, never auto-transitions
//   yellow = flips to its reverse (red) side at the end of the round
//   red    = removed at the end of the round
// This is why a per-token identity tint is the wrong model to draw with: two
// tokens sharing a colour are telling you they come off at the same time, which
// is the thing a player actually needs to read across a board.
export const TOKEN_DURATION: Record<'green' | 'yellow' | 'red' | 'none', string> = {
  green: '#a8c090',
  yellow: '#fccc18',
  red: '#e43c54',
  // Triangle/round tokens carry no decay at all; Repaired's own printed blue.
  none: '#b4cce4',
};

// Which printed face a token is currently showing. A yellow-side token that has
// been flipped is showing red and comes off at the end of this round, so the
// face IS the rule — reading it is how a player knows what survives the End
// Phase. Returns null when we hold no scan for that token yet.
export function tokenFace(id: string, decay: string | undefined, expiring: boolean): {
  art: string | null;
  colour: string;
} {
  const faces = TOKEN_PRINT[id];
  const side: 'green' | 'yellow' | 'red' | 'none' = expiring ? 'red' : decay === 'green' ? 'green' : decay ? 'yellow' : 'none';
  if (!faces) return { art: null, colour: TOKEN_DURATION[side] };
  // `lowProfile-green` flips to `lowProfile-red`; a token with a single face
  // (Repaired) shows it whatever the state.
  const want = faces.find((f) => f.endsWith(`-${side}`));
  return { art: want ?? faces[0], colour: TOKEN_DURATION[side] };
}

export function tokenPrintUrl(name: string): string {
  return assetUrl(`tokens/print/${name}.webp`);
}

// The publisher's own quick-reference cards, the ones that come in the box and
// sit beside the board. Kept as a list rather than four loose ids because the
// Rules tab shows them in printed order.
export const HELP_CARDS: { id: string; name: string; note: string }[] = [
  { id: 'game-sequence', name: 'Game Sequence', note: 'The six phases of a round, in order, with what happens in each.' },
  { id: 'action-opportunity', name: 'Action Opportunity', note: 'What a Mech may do when its Timing comes up, and what each Tick buys.' },
  { id: 'common-actions', name: 'Common Actions', note: 'The Actions every Mech has without a Part printing them.' },
  { id: 'action-anatomy', name: 'Anatomy of an Action', note: 'How to read an Action block on a Part Card: type, length, range, keywords.' },
];

export function helpCardUrl(id: string): string {
  return assetUrl(`help/${id}.webp`);
}

export function secondaryImageUrl(id: string): string {
  return assetUrl(`secondary/${id}.webp`);
}

export function missionImageUrl(id: string): string {
  return assetUrl(`missions/${id}.webp`);
}

export function tabImageUrl(id: string): string {
  return assetUrl(`tokens/tab/${id}.webp`);
}

export function mechPartUrl(id: string): string {
  return assetUrl(`mech_parts/${id}.webp`);
}

export function portraitUrl(id: string): string {
  return assetUrl(`tokens/tab/${id}.webp`);
}

// The face a Part is flipped to once it is thrown away (4.17). It is never a
// build choice: it comes with its parent Part and sits under it.
export function isDiscardCard(c: Card): boolean {
  return /\(D\)|（抛弃卡）|抛弃卡/.test(`${c.name.en ?? ''}${c.name.zh ?? ''}`);
}

// The far face of a Part that a RULE flips you onto mid-game rather than one you
// build with: Tether Mode (PDLH-202-T), and any future card written the same
// way. Told apart from a legal build choice by the price, not by the name — the
// White Dwarf prints BOTH its Modes at 72 points, so either is a real squad
// choice, while a face that costs nothing is one you can only arrive at.
//
// Optional-chained where isDiscardCard above is not, deliberately: this one is
// asked about EVERY equipped card after every command, by the Tether sweep, so
// it has to survive a card the bundle handed us without a name.
export function isModeFace(c: Card): boolean {
  return !c.score && /tether mode|cruise mode|\(deployed\)/i.test(c.name?.en ?? '');
}

// A Mode face a TETHER is holding open (PDLH-202-T). The flip back is triggered
// by the Tether ending, so the trigger has to name the state it belongs to: a
// Mode face put on by something else must not come off when a leash is cut.
export function isTetherFace(c: Card): boolean {
  return isModeFace(c) && /tether mode|牵引状态|牽引状態/i.test(`${c.name?.en ?? ''}${c.name?.zh ?? ''}`);
}

// ---------- the two faces of one physical card ----------
//
// `throwIndex` is a ONE-WAY edge: the front face names the back, the back names
// nothing. 62 cards carry one and for 61 of them the far face is a Discard Card,
// so this index is a LOOKUP and never a permission — knowing PDLH-202 and
// PDLH-202-T are the same piece of cardboard says nothing about whether a Mech
// may flip between them. transformFaces() is what answers that, and it asks a
// rule.
//
// Keyed off the card array rather than built into GameData, so the tests that
// assemble their own arrays get the same index without a loader.
const faceIndexCache = new WeakMap<Card[], Map<string, string>>();

function faceIndex(cards: Card[]): Map<string, string> {
  const hit = faceIndexCache.get(cards);
  if (hit) return hit;
  const m = new Map<string, string>();
  // Forward edges first, then the reverse ones the data does not carry, so a
  // printed edge always wins over an inferred one.
  for (const c of cards) if (c.throwIndex && c.throwIndex !== c.id) m.set(c.id, c.throwIndex);
  for (const c of cards) {
    if (c.throwIndex && c.throwIndex !== c.id && !m.has(c.throwIndex)) m.set(c.throwIndex, c.id);
  }
  faceIndexCache.set(cards, m);
  return m;
}

export function faceOf(cards: Card[], id: string): string | undefined {
  return faceIndex(cards).get(id);
}

// Every other face this card may legally BECOME at the table. Two data shapes
// feed it and they say different things:
//   * `transformPartIds` — the White Dwarf's Mode set (287/288), listed on both
//     faces and including the card itself. A whole-set declaration.
//   * `throwIndex` — the "other face" pointer, which only counts as a transform
//     when one of the two faces is a runtime Mode. Taken at face value it would
//     make all 61 Discard Cards transformable, which is 4.17 backwards.
export function transformFaces(data: GameData, c: Card): string[] {
  const out = new Set<string>();
  for (const id of c.transformPartIds ?? []) if (id !== c.id && data.byId.get(id)) out.add(id);
  const other = faceOf(data.cards, c.id);
  const far = other ? data.byId.get(other) : undefined;
  if (far && (isModeFace(far) || isModeFace(c))) out.add(far.id);
  return [...out];
}

export function zeroCostReason(c: Card): string | null {
  if (c.score) return null;
  if (isDiscardCard(c)) return 'discard state of a paid part';
  if (isModeFace(c)) return 'alternate mode of a paid part';
  if (c.category === 'projectile') return 'Low Value Unit — Projectiles cost 0';
  if (c.category === 'drone') return 'Low Value Unit — costs 0, gives no VP';
  return null;
}

export function unitSize(c: Card): 1 | 2 | 3 {
  if (c.type === 'large') return 3;
  if (c.type === 'medium') return 2;
  return 1;
}

// The three deployable barricades. The Rules Supplement (1.1.3, via FAQ A3/E6/
// M13/M14) classes them "Neutral Unit - Deployables - Barricade": they stand on
// the ground, block movement, RECEIVE Protection like any unit, and can neither
// move, be moved, nor be Crushed. They no longer GIVE Unit Protection: 4.5.3
// grants that to Large Units only and unitSize() reads these as size 1. The
// printed "counts as 3-inch terrain" bullet on the AS3 walls is what ought to
// pay them, and nothing models it yet — see PHASE6-PLAN D-9. Everything else projectile-shaped
// really is Aerial (missiles, grenades, beacons, mines).
export const BARRICADE_CARDS = new Set(['PDAM-003', 'PDAM-004', '158']);

export function isBarricade(c: Card): boolean {
  return BARRICADE_CARDS.has(c.id);
}

// The one card in the box that becomes another. The folded SGM-2 "Pholcus"
// Projectile is REPLACED by its Drone form in the Delay Phase of the round it
// lands - not optionally, the FAQ says it must (M18.3) - and if the Grid it
// lands in is occupied it detonates on the spot, ally or not (M18.4). Written
// as a table rather than matched off the card text, because the replacement
// names the target card in Chinese only.
export const UNFOLDS_INTO: Record<string, string> = { '156': '167' };

export function unfoldsInto(c: Card): string | undefined {
  return UNFOLDS_INTO[c.id];
}

// The far side of that table: a unit that has already Unfolded.
export function isUnfolded(c: Card): boolean {
  return Object.values(UNFOLDS_INTO).includes(c.id);
}

// Mines and the one card that only looks like one. A GM-35 carries the printed
// keyword on its own; Pholcus carries the SELF-PROPELLED variant, which is a
// different unit entirely - it never triggers on entry, it unfolds and hunts
// (FAQ M18). The two strings share a suffix, so both tests are exact.
const MINE_KEYWORD = '地雷';
const AUTO_MINE_KEYWORD = '自行地雷';

function keywordSet(c: Card): string[] {
  return (c.keywords ?? []).map((k) => (k.inline ?? k.key ?? k.en ?? '').trim());
}

// A Mine detonates when a GROUND Unit enters its Grid (FAQ M6, GM-35 card).
export function isMine(c: Card): boolean {
  return keywordSet(c).includes(MINE_KEYWORD);
}

// The folded SGM-2 "Pholcus": a Projectile that becomes a Drone (FAQ M18).
export function isAutoMine(c: Card): boolean {
  return keywordSet(c).includes(AUTO_MINE_KEYWORD);
}

// The square TRANSPARENT base. A Flying Unit may land in a mined Grid and sits
// on top of the Mine without setting it off (FAQ M3/M24) - it is not a Ground
// Unit, which is what a Mine's trigger asks about.
export function isFlyingBase(c: Card): boolean {
  return c.flyingOrElevated === 'flying';
}

// The data's two flight classes follow the printed bases (FAQ E1): 'flying' is
// the square transparent base (Ravens) that crosses terrain but must land on
// open ground, 'elevated' is the round base (Dragonfly, the Bits) that is
// Aerial and may sit on terrain or units. No card carries the literal value
// 'aerial'; testing for it alone grounded all five elevated drones.
export function isAerial(c: Card): boolean {
  if (c.category === 'projectile') return !isBarricade(c);
  return c.flyingOrElevated === 'elevated' || c.flyingOrElevated === 'aerial';
}

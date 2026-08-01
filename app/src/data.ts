import type { Card, CardAction, ExtraTickCheck, LangText, Side, TerrainData } from './types';

export const SIDE_LABEL: Record<Side, string> = { blue: 'UN', red: 'RDL' };

export interface BoxDef {
  key: string;
  id: number;
  name: LangText;
  faction?: string[];
  hasImage?: boolean;
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
}

interface NameOverrides {
  cards?: Record<string, { en: string }>;
  actions?: Record<string, { en: string }>;
  traits?: Record<string, { en: string }>;
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
  const [cards, terrain, boxes, rawKeywords, patch, mech, xlate, names, missions, tactics, play, secondary, zoneData, facPatch, boxPatch, common, ammoPatch, statPatch, factionData] = await Promise.all([
    fetch(dataUrl('cards.json')).then((r) => r.json() as Promise<Card[]>),
    fetch(dataUrl('terrain_layouts.json')).then((r) => r.json() as Promise<TerrainData>),
    fetch(dataUrl('boxes.json')).then((r) => r.json() as Promise<BoxDef[]>),
    fetch(dataUrl('keywords.json')).then((r) => r.json() as Promise<KeywordDef[]>),
    fetch(dataUrl('keyword_overrides.json'))
      .then((r) => (r.ok ? (r.json() as Promise<KeywordOverrides>) : { overrides: {} }))
      .catch(() => ({ overrides: {} }) as KeywordOverrides),
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
    fetch(dataUrl('factions.json'))
      .then((r) => (r.ok ? (r.json() as Promise<{ factions?: FactionDef[] }>) : { factions: [] }))
      .catch(() => ({ factions: [] as FactionDef[] })),
  ]);

  cleanCardText(cards);
  applyTactics(cards, tactics.tactics ?? {});
  normaliseBoxes(cards);
  applyBoxContents(cards, boxPatch);
  applyAmmo(cards, ammoPatch);
  applyStats(cards, statPatch);

  for (const b of boxes) {
    const bn = names.boxes?.[b.key];
    if (bn) b.name = { ...b.name, en: bn.en };
  }

  for (const c of cards) {
    const cn = names.cards?.[c.id];
    if (cn) c.name = { ...c.name, en: cn.en };
    const tn = names.traits?.[c.id];
    if (tn) c.traitDescription = { ...c.traitDescription, en: tn.en };
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
  repaired: ['repaired'],
};

export function tokenPrintUrl(name: string): string {
  return assetUrl(`tokens/print/${name}.webp`);
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

export function zeroCostReason(c: Card): string | null {
  if (c.score) return null;
  if (isDiscardCard(c)) return 'discard state of a paid part';
  if (/tether mode|cruise mode|\(deployed\)/i.test(c.name.en ?? '')) return 'alternate mode of a paid part';
  if (c.category === 'projectile') return 'Low Value Unit — Projectiles cost 0';
  if (c.category === 'drone') return 'Low Value Unit — costs 0, gives no VP';
  return null;
}

export function unitSize(c: Card): 1 | 2 | 3 {
  if (c.type === 'large') return 3;
  if (c.type === 'medium') return 2;
  return 1;
}

export function isAerial(c: Card): boolean {
  if (c.category === 'projectile') return true;
  return c.flyingOrElevated === 'aerial';
}

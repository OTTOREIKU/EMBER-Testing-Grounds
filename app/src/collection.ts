import type { Card, Token } from './types';
import { faceOf, type GameData } from './data';

// The two fields the counting reads, so a test may hand in a card list alone.
export type CardIndex = Pick<GameData, 'cards' | 'byId'>;
import { deployedCardCounts } from './units';
import type { EmberApi } from './api';

// A player's collection: the boxes they own by count, and the BUILT PIECES -
// the models actually assembled from those boxes, by card. A box holds three
// backpack cards; the sprues build one backpack at a time, and a variant Part
// shares pieces with its sibling, so what the table can field is what was
// built. Where a card has a built-pieces entry, that count is the truth for
// the card and the boxes stop counting it; a card bought outside any box fits
// the same field.
// One copy on this device, one on the account when signed in - the pad, the
// freeplay board and the Match Centre all read this store, so a box ticked on
// the board and a single added on the pad land in the same place.
//
// The whole thing is OFF unless the switch is on: every picker shows every
// card, the way it always has, until a player asks to build from what they own.

export interface Collection {
  boxes: Record<string, number>;
  cards: Record<string, number>;
  // When this copy last changed. The newer of the two copies wins a sync.
  updatedAt: number;
  // Only the built pieces count: the boxes are ignored and a card with no
  // built entry has none. For a table where what matters is the models that
  // exist, not the cards that were bought. Travels with a shared shelf.
  builtOnly?: boolean;
}

// Its OWN key, on purpose. The board kept box counts under 'ember-inventory-v1'
// before this store existed, and reading them here pre-filled a collection
// nobody had entered - and pushed it to the account on first sign-in. A
// collection starts empty and holds only what a player put in it (OTTO,
// 2026-09-17). The old key is left where it is and never read.
const KEY = 'ember-collection-v1';

interface Stored {
  owned?: Record<string, number>;
  cards?: Record<string, number>;
  filterEnabled?: boolean;
  builtOnly?: boolean;
  updatedAt?: number;
  // The account this copy belongs to. A different account signing in on the
  // same device takes its own shelf from the server rather than inheriting
  // this one - and never pushes this one up as its own.
  owner?: number;
}

const listeners = new Set<() => void>();

function read(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function write(s: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage may be full or blocked; the in-memory copy still serves this page.
  }
}

function clean(r: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r ?? {})) {
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n > 0) out[k] = Math.min(99, n);
  }
  return out;
}

export function loadCollection(): Collection {
  const s = read();
  return { boxes: clean(s.owned), cards: clean(s.cards), updatedAt: s.updatedAt ?? 0, builtOnly: !!s.builtOnly };
}

// Whether pickers should be limited to the collection. Shared with the board's
// "Only show what I own": the same switch, wherever it is flipped.
export function collectionOn(): boolean {
  return !!read().filterEnabled;
}

export function setCollectionOn(on: boolean): void {
  write({ ...read(), filterEnabled: on });
  announce();
}

// A device setting like the switch above: not synced, not stamped.
export function builtOnlyOn(): boolean {
  return !!read().builtOnly;
}

export function setBuiltOnly(on: boolean): void {
  write({ ...read(), builtOnly: on });
  announce();
}

function announce(): void {
  for (const fn of listeners) fn();
}

export function onCollection(fn: () => void): void {
  listeners.add(fn);
}

export function saveCollection(col: Collection, opts: { stamp?: boolean } = {}): void {
  const s = read();
  write({
    ...s,
    owned: clean(col.boxes),
    cards: clean(col.cards),
    updatedAt: opts.stamp === false ? col.updatedAt : Date.now(),
    owner: api?.user?.id ?? s.owner,
  });
  announce();
  if (opts.stamp !== false) schedulePush();
}

// Whether this device's copy may stand for the signed-in account: it is
// theirs, or nobody's yet.
function mine(): boolean {
  const owner = read().owner;
  return owner === undefined || owner === api?.user?.id;
}

// Cards the table uses more of than the collection holds, among the given
// tokens' cards. What an imported squad is warned about.
export function shortfalls(data: CardIndex, col: Collection, tokens: Token[], among: Token[]): { card: Card; short: number }[] {
  const out: { card: Card; short: number }[] = [];
  const seen = new Set<string>();
  for (const id of deployedCardCounts(among).keys()) {
    const card = data.byId.get(id);
    if (!card) continue;
    const key = physicalKey(data, id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!tracked(data, col, card)) continue;
    const short = inUse(data, tokens, card) - copiesOf(data, col, card);
    if (short > 0) out.push({ card, short });
  }
  return out;
}

export function hasAny(col: Collection): boolean {
  return Object.values(col.boxes).some((n) => n > 0) || Object.values(col.cards).some((n) => n > 0);
}

// ---------- counting ----------
//
// A card is a PHYSICAL object, and a Part's Discard Card or a Mode's other
// face is printed on the back of the same one. Counts are folded onto one
// key for the pair, so the Part shows as owned when its back was recorded and
// a flipped unit is not charged twice.

export function physicalKey(data: CardIndex, id: string): string {
  const other = faceOf(data.cards, id);
  return other && other < id ? other : id;
}

function faces(data: CardIndex, card: Card): Card[] {
  const other = faceOf(data.cards, card.id);
  const far = other ? data.byId.get(other) : undefined;
  return far ? [card, far] : [card];
}

// Whether the collection can say anything about owning this card. Listed in a
// box or recorded as a single: yes. Listed nowhere while nearly every card of
// its kind is: also yes - it is a card no box on sale ships (the GoF torsos),
// so the answer is "none" until it is recorded as a single. A KIND the data
// mostly cannot place (Projectiles ship with their launchers, the Tactics deck
// has no box recorded) is left unlimited, because there the data cannot tell,
// not the player.
export function tracked(data: CardIndex, col: Collection, card: Card): boolean {
  if (faces(data, card).some((c) => (c.containedIn ?? []).length > 0 || (col.cards[c.id] ?? 0) > 0)) return true;
  return kindHasBoxData(data, card.category);
}

// Four in five of the kind's cards placed in a box is the line: Parts, Drones
// and Pilots are well over it, Projectiles and Tactics Cards far under.
const KIND_COVERAGE = 0.8;
const kindCache = new WeakMap<CardIndex, Map<string, boolean>>();
function kindHasBoxData(data: CardIndex, category: string): boolean {
  let m = kindCache.get(data);
  if (!m) { m = new Map(); kindCache.set(data, m); }
  let v = m.get(category);
  if (v === undefined) {
    const kind = data.cards.filter((c) => c.category === category);
    const placed = kind.filter((c) => (c.containedIn ?? []).length > 0).length;
    v = kind.length > 0 && placed / kind.length >= KIND_COVERAGE;
    m.set(category, v);
  }
  return v;
}

// How many copies the collection holds. A built-pieces entry on either face
// answers outright: it is what stands on the shelf, whatever the boxes hold.
// Without one, boxes times what each box ships, over both faces of the card.
//
// quantityPerBox 0 means the card ships with its parent rather than as a
// counted copy: Discard Cards sit under their Part Card (4.17), and alternate
// modes are the same physical card. You still get one with the box, so a 0
// must not read as "you do not own this" - but nor may it double a Part that
// lists both its faces, so each box is charged once per pair.
export function copiesOf(data: CardIndex, col: Collection, card: Card): number {
  const all = faces(data, card);
  // Both faces are one physical piece, so an entry on each is the same models
  // counted twice: the larger entry stands, never the sum.
  const built = all.map((c) => col.cards[c.id]).filter((v): v is number => v !== undefined);
  if (built.length) return Math.max(...built);
  if (col.builtOnly) return 0;
  let n = 0;
  const perBox = new Map<string, number>();
  for (const c of all) {
    for (const ci of c.containedIn ?? []) {
      perBox.set(ci.box, Math.max(perBox.get(ci.box) ?? 0, Math.max(1, ci.quantityPerBox)));
    }
  }
  for (const [box, qty] of perBox) n += (col.boxes[box] ?? 0) * qty;
  return n;
}

// How many copies are already on the table, both faces folded together.
export function inUse(data: CardIndex, tokens: Token[], card: Card): number {
  const counts = deployedCardCounts(tokens);
  let n = 0;
  for (const c of faces(data, card)) n += counts.get(c.id) ?? 0;
  return n;
}

// What is left to put down. null means no limit: the collection is empty, or
// the data cannot place the card in any box.
export function remaining(data: CardIndex, col: Collection, tokens: Token[], card: Card): number | null {
  if (!hasAny(col) || !tracked(data, col, card)) return null;
  return Math.max(0, copiesOf(data, col, card) - inUse(data, tokens, card));
}

// ---------- the account copy ----------

let api: EmberApi | null = null;
let pushTimer = 0;

function schedulePush(): void {
  if (!api?.user) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { void pushCollection(); }, 800);
}

export async function pushCollection(): Promise<void> {
  if (!api?.user || !mine()) return;
  const col = loadCollection();
  try {
    const r = await api.putInventory(col.boxes, col.cards);
    // Take the server's clock for the stamp so the next pull compares like
    // with like; the contents are already what was just sent.
    write({ ...read(), updatedAt: r.updatedAt, owner: api.user.id });
  } catch {
    // Offline or signed out: this device keeps its copy and tries again on
    // the next change.
  }
}

// Reconcile with the account: the newer copy wins outright. A device that
// never recorded anything simply takes the account's shelf.
export async function pullCollection(): Promise<void> {
  if (!api?.user) return;
  let remote: { boxes: Record<string, number>; cards: Record<string, number>; updatedAt: number };
  try {
    remote = await api.getInventory();
  } catch {
    return;
  }
  const local = loadCollection();
  const remoteHas = Object.keys(remote.boxes).length + Object.keys(remote.cards).length > 0;
  const adopt = (): void => {
    write({ ...read(), owned: clean(remote.boxes), cards: clean(remote.cards), updatedAt: remote.updatedAt, owner: api!.user!.id });
    announce();
  };
  // Someone else's shelf on this device: the account takes its own, whatever
  // the clocks say, and the other player's copy is not pushed into it.
  if (!mine()) { adopt(); return; }
  if (remote.updatedAt > local.updatedAt || (!hasAny(local) && remoteHas)) {
    adopt();
  } else if (hasAny(local) && local.updatedAt > remote.updatedAt) {
    await pushCollection();
  } else {
    write({ ...read(), owner: api.user.id });
  }
}

// Called once per page with its EmberApi: the shelf is pulled when an account
// appears and pushed after every change while one is signed in.
export function bindCollection(a: EmberApi): void {
  api = a;
  a.onChange((who) => { if (who) void pullCollection(); });
  if (a.user) void pullCollection();
  // Another tab on this origin (the board beside the pad) writing the store.
  window.addEventListener('storage', (ev) => { if (ev.key === KEY) announce(); });
}

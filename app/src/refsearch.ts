// The search RANKER and the per-pool predicates, shared by the reference page
// and the pad's Find. They lived in reference.ts; the pad needed the same
// answers, and a second rank() would put a different thing first on the phone
// than on the reference for the same word. The page-only pools (boxes,
// factions, battlefield, the dice) stay on the reference, which is the only
// page that lists them.
import { cardName, type KeywordDef, type MechanicDef, type MissionCard, type PhaseDef, type SecondaryTask, type StanceDef, type TimingDef } from './data';
import type { Card, StatusDef } from './types';

export const norm = (s: string) => s.toLowerCase();

// Every predicate below tests one haystack of name PLUS body text, and every
// list came out in data order -- so typing "Proje" listed the six keywords that
// talk about Projectiles above Projectile itself. The thing whose NAME matches
// is what the reader typed; everything else is context and belongs under it.
export function rank(name: string, q: string): number {
  const n = norm(name.replace(/^[•·\s]+/, '').trim());
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  // A word inside the name: "Smoke Grenade" for "grenade". Below a prefix of
  // the whole name, above a match buried mid-word.
  if (n.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 2;
  if (n.includes(q)) return 3;
  return 4;
}

// Filter and rank together, so no pool can be filtered without being ordered.
// `cmp` is the resting order a tab wants when nothing is typed (alphabetical,
// or by box number); with a query it becomes the tiebreak inside a rank, which
// is what keeps equally-relevant rows in a sensible order rather than whatever
// the data file happened to hold.
export function found<T>(
  list: readonly T[],
  q: string,
  match: (x: T, q: string) => boolean,
  nameOf: (x: T) => string,
  cmp?: (a: T, b: T) => number,
): T[] {
  const hits = list.filter((x) => match(x, q));
  const base = cmp ? [...hits].sort(cmp) : hits;
  if (!q) return base;
  return base
    .map((x, i) => ({ x, i, r: rank(nameOf(x), q) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((e) => e.x);
}

// The name each pool is known by, which is the half of the haystack that ranks.
export const nmKeyword = (k: KeywordDef) => k.en?.name ?? k.key;
export const nmCard = (c: Card) => cardName(c);
export const nmMission = (m: MissionCard) => m.name;
export const nmSecondary = (s: SecondaryTask) => s.name;
export const nmMechanic = (m: MechanicDef) => m.name;
export const nmPlay = (x: { name: string }) => x.name;
export const nmStatus = (d: StatusDef) => d.label;

// ---------- one predicate per pool, shared by the tab lists AND the badges ----------
//
// The counts painted onto the tab strip and the rows a tab then shows have to
// come from the SAME test, or a badge promises matches the tab fails to
// produce. So every filter lives here once, and both callers read it.
export const matchKeyword = (k: KeywordDef, q: string): boolean =>
  !q || norm(`${k.en?.name ?? ''} ${k.en?.value ?? ''} ${k.key} ${k.zh?.name ?? ''}`).includes(q);
export const matchMission = (m: MissionCard, q: string): boolean =>
  !q || norm(`${m.name} ${m.nameKo ?? ''} ${m.setup} ${m.scoring} ${(m.zones ?? []).join(' ')}`).includes(q);
export const matchSecondary = (s: SecondaryTask, q: string): boolean =>
  !q || norm(`${s.name} ${s.nameKo ?? ''} ${s.setup} ${s.scoring} ${s.token ?? ''}`).includes(q);
export const matchCard = (c: Card, q: string): boolean => {
  if (!q) return true;
  const kw = (c.keywords ?? []).map((k) => k.en || k.inline || k.key).join(' ');
  const acts = (c.actions ?? []).map((a) => `${a.name.en ?? ''} ${a.description?.en ?? ''}`).join(' ');
  return norm(`${cardName(c)} ${c.id} ${c.type ?? ''} ${kw} ${acts}`).includes(q);
};
export const matchMechanic = (m: MechanicDef, q: string): boolean =>
  !q || norm(`${m.name} ${m.text} ${m.ref ?? ''}`).includes(q);
export const matchPhase = (x: PhaseDef, q: string): boolean =>
  !q || norm(`${x.name} ${x.who ?? ''} ${x.can.join(' ')} ${x.cannot.join(' ')}`).includes(q);
export const matchTiming = (x: TimingDef, q: string): boolean =>
  !q || norm(`${x.name} timing ${x.text}`).includes(q);
export const matchStance = (x: StanceDef, q: string): boolean =>
  !q || norm(`${x.name} ${x.short} stance ${x.effect} ${x.good} ${x.cost}`).includes(q);
export const matchStatus = (d: StatusDef, q: string): boolean =>
  !q || norm(`${d.label} ${d.icon} ${d.shape} ${d.note} ${d.decay ?? ''} token`).includes(q);

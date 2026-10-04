// THE ODDS OF AN ATTACK, before a die is thrown (AI-OPPONENT-PLAN.md, M5).
//
// Rule R5 of the plan: a dice option is valued through the engine's own pools
// and its own resolution. So nothing here knows a weapon, a keyword or a
// Stance. It opens the attack in a combat window nobody sees (the same
// AttackHelper a player's attack runs in, headless), and that window is asked
// for its reading (combat.ts AttackReading): the Attack and Defence pools as
// it deals them, what each face of each die comes to as its resolution counts
// it, where the hit may land and who chooses, and how each Part would answer.
// A Part, an aura or a keyword that changes what a played attack does changes
// the reading, and the odds with it.
//
// What is worked out HERE is only what dice do: every hand the two pools can
// throw, each offset by the engine's own offsetIcons, and the one step down
// the damage ladder a Penetration is (4.4.4), with the Surplus round a
// Mutilation or a Scatter-shot adds (4.8). Exact, not sampled: a pool is at
// most a few thousand distinct hands.
//
// WHAT IT ASSUMES of the choices a roll leaves open, so that a number means
// one thing: neither side spends a Link on a reroll (a seat weighs that when
// it is asked, with the dice in front of it); no Dodge is held back for
// {Lightning}; the defender declares the Parry or the Shield that costs the
// attacker most; an attacker who may choose the Part, or the Surplus keyword,
// takes the one worth most to it. Cleaving is read as going to another Part of
// the same target (its other arm, another Unit in Range, is not weighed yet).
import { AttackHelper, offsetIcons, type AttackFace, type AttackReading, type DefenceFace, type PartReading } from '../combat';
import { check, type Command } from '../commands';
import type { GameData } from '../data';
import { tableAfter } from '../glue';
import type { Forecast } from '../seat';
import { boxHands } from '../tasks';
import { counterReading, counterVerdict, type CounterReading } from '../contest';
import { attackOpening, terrainOf } from '../turn';
import type { DiceData, GameState } from '../types';
import type { AttackArgs } from './botcombat';

// ---------- what a hand of dice comes to ----------

// A pool's hands, by what they come to, with the chance of each. Each total is
// packed into one number, five bits to a count.
type Sums = Map<number, number>;

const pack = (a: number, b: number, c = 0): number => a | (b << 5) | (c << 10);

function throwDice(into: Sums, one: Sums, n: number): Sums {
  let cur = into;
  for (let i = 0; i < n; i++) {
    const next: Sums = new Map();
    for (const [k, p] of cur) for (const [k1, p1] of one) next.set(k + k1, (next.get(k + k1) ?? 0) + p * p1);
    cur = next;
  }
  return cur;
}

// One die of a colour: each thing a face can come to, with its chance.
function oneDie<T>(faces: T[], key: (f: T, i: number) => number): Sums {
  const out: Sums = new Map();
  faces.forEach((f, i) => { const k = key(f, i); out.set(k, (out.get(k) ?? 0) + 1 / faces.length); });
  return out;
}

// The Attack Roll: Heavy Hits, Light Hits and the {Lightning} that counts. A
// die Dense Armor takes off the table comes to nothing.
export function attackSums(
  pool: { red: number; yellow: number },
  faces: { red: AttackFace[]; yellow: AttackFace[] },
  stripped?: { red: boolean[]; yellow: boolean[] },
): Sums {
  let cur: Sums = new Map([[0, 1]]);
  for (const color of ['red', 'yellow'] as const) {
    const one = oneDie(faces[color], (f, i) => (stripped?.[color][i] ? 0 : pack(f.heavy, f.light, f.bolt)));
    cur = throwDice(cur, one, pool[color]);
  }
  return cur;
}

// The Defence Roll: the icons its {Dodge} and its {Defense} can cancel.
export function defenceSums(pool: { white: number; blue: number }, faces: { white: DefenceFace[]; blue: DefenceFace[] }): Sums {
  let cur: Sums = new Map([[0, 1]]);
  for (const color of ['white', 'blue'] as const) {
    cur = throwDice(cur, oneDie(faces[color], (f) => pack(f.dodge, f.defense)), pool[color]);
  }
  return cur;
}

// The engine's own offsetting (combat.ts offsetIcons), remembered: the same
// four counts come up thousands of times.
interface Offset { hits: number; pen: number; heavy: number; light: number; spare: number }
const OFFSETS = new Map<number, Offset>();
function offset(heavy: number, light: number, dodge: number, defense: number): Offset {
  const k = heavy | (light << 5) | (dodge << 10) | (defense << 15);
  let o = OFFSETS.get(k);
  if (!o) {
    const r = offsetIcons(heavy, light, dodge, defense);
    o = { hits: r.hits, pen: r.penetrating, heavy: r.unoffset.heavy, light: r.unoffset.light, spare: r.spareDodge };
    OFFSETS.set(k, o);
  }
  return o;
}

// How the attack's {Lightning} and its damage are counted, read off the faces
// themselves: a Wrecking's un-cancelled {Lightning} is a Hit and a Penetration
// of its own, and an Action that causes no damage never Penetrates.
function traits(r: AttackReading): { wrecking: boolean; harmless: boolean } {
  const all = [...r.faces.red, ...r.faces.yellow];
  return {
    wrecking: all.some((f) => f.bolt > 0 && f.pen > f.heavy + f.light),
    harmless: all.some((f) => f.heavy + f.light > 0 && f.pen === 0),
  };
}

// One roll resolved: an Attack hand against a Defence hand. `dodge` is every
// {Dodge} the defender has, a Melee Evasion's included.
export interface Settled { hits: number; pen: number; carried: { heavy: number; light: number }; bolt: number }
export function settle(
  r: AttackReading, a: { heavy: number; light: number; bolt: number }, d: { dodge: number; defense: number },
): Settled {
  const { wrecking, harmless } = traits(r);
  const o = offset(a.heavy, a.light, d.dodge, d.defense);
  // A {Dodge} left over after the Hits cancels a {Lightning} (FAQ D2).
  const bolt = a.bolt - Math.min(a.bolt, o.spare);
  const wreck = wrecking ? bolt : 0;
  return {
    hits: o.hits + wreck,
    pen: harmless ? 0 : o.pen + wreck,
    carried: harmless ? { heavy: 0, light: 0 } : { heavy: o.heavy, light: o.light },
    bolt,
  };
}

// What the dice on the table come to, by the reading's own faces: the hand a
// seat is looking at when it is asked about a reroll.
export function handOf(
  r: AttackReading, part: PartReading | null, attack: { color: string; face: number }[], defense: { color: string; face: number }[], evade = false,
): { attack: { heavy: number; light: number; bolt: number }; defence: { dodge: number; defense: number } } {
  const a = { heavy: 0, light: 0, bolt: 0 };
  for (const x of attack) {
    const color = x.color as 'red' | 'yellow';
    const f = r.faces[color]?.[x.face];
    if (!f || part?.stripped[color][x.face]) continue;
    a.heavy += f.heavy; a.light += f.light; a.bolt += f.bolt;
  }
  const d = { dodge: evade ? 1 : 0, defense: 0 };
  for (const x of defense) {
    const f = r.faces[x.color as 'white' | 'blue']?.[x.face];
    if (!f) continue;
    d.dodge += f.dodge; d.defense += f.defense;
  }
  return { attack: a, defence: d };
}

// ---------- what an attack comes to ----------

// How an attack ends, and how likely each ending is. An ending is named by
// what it did: `none`, `hit` (Hits and no Penetration), or the Parts it moved
// down the ladder, `torso>damaged` or `leftHand>destroyed|torso>damaged`.
type Ends = Map<string, number>;

interface Case {
  ends: Ends;
  // The {Lightning} expected to get past the Dodges.
  bolt: number;
  // Where the first hit lands, and the chance it lands there AND Penetrates.
  where: Map<string, [share: number, pen: number]>;
  // The Part an attacker who may choose takes.
  pick: string | null;
}

export interface Weights { kill: number; destroy: number; damage: number }
// The worth of an ending to the attacker when no one says otherwise: the
// Brawler's (plan section 5).
export const WORTH: Weights = { kill: 150, destroy: 50, damage: 25 };

const changesOf = (end: string): [string, string][] =>
  (end === 'none' || end === 'hit' ? [] : end.split('|').map((x) => x.split('>') as [string, string]));

// Whether an ending takes the unit off the board: its Torso (a Drone's `main`)
// destroyed, or a Mech left with two Parts or fewer, which leaves at the end
// of the round (Integrity Loss). One that was already down to two is not
// killed a second time.
function killed(r: AttackReading, changes: [string, string][]): boolean {
  const gone = changes.filter(([, s]) => s === 'destroyed');
  if (!gone.length) return false;
  if (!r.mech) return true;
  if (gone.some(([slot]) => slot === 'torso')) return true;
  return r.partsLeft > 2 && r.partsLeft - gone.length <= 2;
}

function worthOf(r: AttackReading, end: string, w: Weights): number {
  const changes = changesOf(end);
  if (!changes.length) return 0;
  return (killed(r, changes) ? w.kill : 0)
    + (changes.some(([, s]) => s === 'destroyed') ? w.destroy : 0)
    + (changes.some(([, s]) => s === 'damaged') ? w.damage : 0);
}

// What a Surplus round adds to an attack that has already done `first`: the
// worth of its own changes, a kill counting only if the unit was not already
// lost to the first hit. This is the worth a seat sees when it is asked in
// the Surplus round itself, where the table already shows the first hit.
function gainOf(r: AttackReading, first: [string, string][], end: string, w: Weights): number {
  const more = changesOf(end);
  if (!more.length) return 0;
  return (killed(r, [...first, ...more]) && !killed(r, first) ? w.kill : 0)
    + (more.some(([, s]) => s === 'destroyed') ? w.destroy : 0)
    + (more.some(([, s]) => s === 'damaged') ? w.damage : 0);
}

const worthOfEnds = (r: AttackReading, ends: Ends, w: Weights): number => {
  let sum = 0;
  for (const [end, p] of ends) sum += p * worthOf(r, end, w);
  return sum;
};

function addEnds(into: Ends, from: Ends, scale: number): void {
  for (const [end, p] of from) into.set(end, (into.get(end) ?? 0) + p * scale);
}

// Several cases, each with its chance, as one.
function mix(cases: [Case, number][]): Case {
  const out: Case = { ends: new Map(), bolt: 0, where: new Map(), pick: null };
  for (const [c, share] of cases) {
    if (share <= 0) continue;
    addEnds(out.ends, c.ends, share);
    out.bolt += c.bolt * share;
    for (const [slot, [s, p]] of c.where) {
      const at = out.where.get(slot) ?? [0, 0];
      out.where.set(slot, [at[0] + s * share, at[1] + p * share]);
    }
    out.pick ??= c.pick;
  }
  return out;
}

// What a Surplus round is spent on: the keyword, what it comes to, and the
// Part an attacker handed the choice (an `any` face) puts it on.
interface SurplusPlan { keyword: string | null; ends: Ends; any: string | null }

// One attack's whole arithmetic, with what it has already worked out. The
// three choices it assumes are its own methods, so a seat that has to MAKE one
// of them in the window can ask what was assumed: pickPart, declaration,
// surplusPlan.
export class Sheet {
  private readonly wrecking: boolean;
  private readonly harmless: boolean;
  private readonly attack = new Map<string, Sums>();
  private readonly defence = new Map<string, Sums>();
  private readonly second = new Map<string, number>();
  private readonly cases = new Map<string, Case>();
  private readonly surplus = new Map<string, SurplusPlan>();

  constructor(private readonly r: AttackReading, private readonly w: Weights = WORTH) {
    const t = traits(r);
    this.wrecking = t.wrecking;
    this.harmless = t.harmless;
  }

  private attackOn(part: PartReading): Sums {
    const key = JSON.stringify(part.stripped);
    let s = this.attack.get(key);
    if (!s) this.attack.set(key, s = attackSums(this.r.attack, this.r.faces, part.stripped));
    return s;
  }

  private defenceOf(pool: { white: number; blue: number }): Sums {
    const key = `${pool.white}:${pool.blue}`;
    let s = this.defence.get(key);
    if (!s) this.defence.set(key, s = defenceSums(pool, this.r.faces));
    return s;
  }

  private worthOf(ends: Ends): number {
    return worthOfEnds(this.r, ends, this.w);
  }

  // The chance a Surplus round Penetrates: the carried icons against a fresh
  // Defence Roll, with no Attack Roll and nothing of the Action's (4.8).
  secondPen(pool: { white: number; blue: number }, heavy: number, light: number): number {
    const key = `${pool.white}:${pool.blue}:${heavy}:${light}`;
    const known = this.second.get(key);
    if (known !== undefined) return known;
    let p = 0;
    for (const [dk, dp] of this.defenceOf(pool)) {
      if (offset(heavy, light, dk & 31, dk >> 5).pen > 0) p += dp;
    }
    this.second.set(key, p);
    return p;
  }

  // After a Penetration on the Part `slot` with icons left over: the keyword
  // worth most to the attacker of those with somewhere to go (FAQ D1), what
  // the round comes to, and where an `any` face is put.
  surplusPlan(slot: string, heavy: number, light: number): SurplusPlan {
    const key = `${slot}:${heavy}:${light}`;
    const known = this.surplus.get(key);
    if (known) return known;
    const r = this.r;
    const part = r.parts.find((x) => x.slot === slot);
    // Each keyword with somewhere to go: what the whole attack then comes to,
    // and what the round itself adds, which is what its choices are made by.
    const options: (SurplusPlan & { gain: number })[] = [];
    if (part) {
      const base = `${part.slot}>${part.next}`;
      const first: [string, string][] = [[part.slot, part.next]];
      const gain = (end: string, p: number): number => p * gainOf(r, first, end, this.w);
      // A unit the first Penetration destroyed has no other Part (D4).
      const standing = r.mech ? !(part.slot === 'torso' && part.next === 'destroyed') : part.next !== 'destroyed';
      const others = r.mech && standing ? r.parts.filter((q) => q.slot !== part.slot) : [];
      for (const keyword of r.surplus) {
        if (keyword === 'Mutilation') {
          // The same Part again, now defending with its Structure; one
          // destroyed outright has nothing left to strike (FAQ D9).
          if (part.next !== 'damaged' || !part.mutilated) continue;
          const q = this.secondPen(part.mutilated, heavy, light);
          options.push({ keyword, ends: new Map([[`${part.slot}>destroyed`, q], [base, 1 - q]]), any: null, gain: gain(`${part.slot}>destroyed`, q) });
          continue;
        }
        // Scatter-shot, and Cleaving's first arm: another Part, by the Part Die.
        if (!others.length) continue;
        const hitOn = (q: PartReading): { q: PartReading; ends: Ends; gain: number } => {
          const p2 = this.secondPen(q.surplus, heavy, light);
          // In slot order, so the same ending has one name however it came about.
          const both = [base, `${q.slot}>${q.next}`].sort().join('|');
          return { q, ends: new Map([[both, p2], [base, 1 - p2]]), gain: gain(`${q.slot}>${q.next}`, p2) };
        };
        const chosen = others.map(hitOn).reduce((a, b) => (b.gain > a.gain ? b : a));
        const landings: { ends: Ends; gain: number }[] = [];
        for (const face of r.location.die) {
          if (face === 'any') { landings.push(chosen); continue; }
          // The original Part again is rerolled (FAQ D4), unless the first
          // Penetration destroyed it: a Part that is gone sends the die to
          // the Torso.
          const to = face === part.slot ? (part.next === 'destroyed' ? 'torso' : null) : face;
          const q = to ? others.find((x) => x.slot === to) : undefined;
          if (q) landings.push(hitOn(q));
        }
        if (!landings.length) continue;
        const ends: Ends = new Map();
        for (const e of landings) addEnds(ends, e.ends, 1 / landings.length);
        options.push({ keyword, ends, any: chosen.q.slot, gain: landings.reduce((n, e) => n + e.gain, 0) / landings.length });
      }
    }
    const top = options.length ? options.reduce((a, b) => (b.gain > a.gain ? b : a)) : null;
    const best: SurplusPlan = top
      ? { keyword: top.keyword, ends: top.ends, any: top.any }
      : { keyword: null, ends: new Map(part ? [[`${part.slot}>${part.next}`, 1]] : []), any: null };
    this.surplus.set(key, best);
    return best;
  }

  // A hit on one Part, against one Defence pool.
  on(part: PartReading, parried: boolean): Case {
    const pool = parried && part.parried ? part.parried : part.defense;
    const key = `${part.slot}:${pool.white}:${pool.blue}`;
    const known = this.cases.get(key);
    if (known) return known;
    const ends: Ends = new Map();
    let bolt = 0;
    let pen = 0;
    const add = (end: string, p: number): void => { ends.set(end, (ends.get(end) ?? 0) + p); };
    const defence = this.defenceOf(pool);
    for (const [ak, ap] of this.attackOn(part)) {
      const heavy = ak & 31;
      const light = (ak >> 5) & 31;
      const bolts = ak >> 10;
      for (const [dk, dp] of defence) {
        const p = ap * dp;
        const o = offset(heavy, light, dk & 31, dk >> 5);
        const through = bolts - Math.min(bolts, o.spare);
        const wreck = this.wrecking ? through : 0;
        bolt += p * through;
        if (this.harmless || o.pen + wreck <= 0) {
          add(o.hits + wreck > 0 ? 'hit' : 'none', p);
          continue;
        }
        pen += p;
        // Wrecking's {Lightning} is damage and never Surplus (FAQ D3).
        if (o.heavy + o.light > 0 && this.r.surplus.length) addEnds(ends, this.surplusPlan(part.slot, o.heavy, o.light).ends, p);
        else add(`${part.slot}>${part.next}`, p);
      }
    }
    const out: Case = { ends, bolt, where: new Map([[part.slot, [1, pen]]]), pick: null };
    this.cases.set(key, out);
    return out;
  }

  private worth(c: Case): number {
    return this.worthOf(c.ends);
  }

  // The Part an attacker who may choose takes: the one worth most to it. A
  // Parry declared on `parryOn` counts only there.
  private chosen(parryOn: string | null): Case {
    const all = this.r.parts.map((part) => ({ part, c: this.on(part, part.slot === parryOn) }));
    const best = all.reduce((a, b) => (this.worth(b.c) > this.worth(a.c) ? b : a));
    return { ...best.c, pick: best.part.slot };
  }

  pickPart(parryOn: string | null = null): string | null {
    return this.r.parts.length ? this.chosen(parryOn).pick : null;
  }

  // The Part Die decides, an `any` face being the attacker's to pick.
  private byDie(parryOn: string | null): Case {
    const cases: [Case, number][] = [];
    for (const face of this.r.location.die) {
      const part = face === 'any' ? undefined : this.r.parts.find((x) => x.slot === face);
      if (face !== 'any' && !part) continue;
      cases.push([part ? this.on(part, part.slot === parryOn) : this.chosen(parryOn), 1]);
    }
    return mix(cases.map(([c, n]) => [c, n / cases.length]));
  }

  // What each thing the defender may declare before the Part Die comes to,
  // the first being nothing at all.
  private answers(): { offer: { slot: string; parry: number } | null; c: Case }[] {
    const loc = this.r.location;
    // With nothing declared: the attacker's Part where it may designate, the
    // Part Die otherwise.
    const out: { offer: { slot: string; parry: number } | null; c: Case }[] = [
      { offer: null, c: loc.attackerPicks ? this.chosen(null) : this.byDie(null) },
    ];
    for (const offer of loc.declare) {
      const part = this.r.parts.find((x) => x.slot === offer.slot);
      if (!part) continue;
      // Both sides may designate, so neither does and the die decides, the
      // Parry counting only if it finds its Part (FAQ A14, 4.6.3). Otherwise
      // the declared Part takes the hit, with its Parry.
      out.push({ offer, c: loc.attackerPicks ? this.byDie(offer.parry > 0 ? offer.slot : null) : this.on(part, offer.parry > 0) });
    }
    return out;
  }

  // What declaring `slot` comes to, or declaring nothing (null).
  answer(slot: string | null): Case | null {
    if (this.r.location.fixed || !this.r.parts.length) return null;
    return this.answers().find((x) => (x.offer?.slot ?? null) === slot)?.c ?? null;
  }

  // The Part Die, with a Parry declared on `parryOn` counting only there.
  die(parryOn: string | null = null): Case {
    return this.byDie(parryOn);
  }

  // A Surplus round's hit on one Part, FROM HERE: its Penetration, or nothing.
  surplusOn(slot: string, heavy: number, light: number): Ends {
    const q = this.r.parts.find((x) => x.slot === slot);
    if (!q) return new Map([['none', 1]]);
    const p2 = this.secondPen(q.surplus, heavy, light);
    return new Map([[`${q.slot}>${q.next}`, p2], ['none', 1 - p2]]);
  }

  // The Part Die of a Surplus round already under way, from here: the Part the
  // first hit landed on is rerolled (FAQ D4), and an `any` face is the
  // attacker's, put on the Part worth most.
  surplusDie(original: string | null, heavy: number, light: number): { ends: Ends; any: string | null } {
    const others = this.r.parts.filter((q) => q.slot !== original);
    if (!others.length) return { ends: new Map([['none', 1]]), any: null };
    const chosen = others.map((q) => ({ q, ends: this.surplusOn(q.slot, heavy, light) })).reduce((a, b) => (this.worthOf(b.ends) > this.worthOf(a.ends) ? b : a));
    const landings: Ends[] = [];
    for (const face of this.r.location.die) {
      if (face === 'any') { landings.push(chosen.ends); continue; }
      if (face === original) continue;
      if (others.some((q) => q.slot === face)) landings.push(this.surplusOn(face, heavy, light));
    }
    const ends: Ends = new Map();
    for (const e of landings) addEnds(ends, e, 1 / landings.length);
    return { ends: landings.length ? ends : new Map([['none', 1]]), any: chosen.q.slot };
  }

  // What the defender is taken to declare: whatever costs the attacker most,
  // and nothing where nothing does better than that.
  declaration(): { slot: string; parry: number } | null {
    if (this.r.location.fixed || !this.r.parts.length) return null;
    return this.answers().reduce((a, b) => (this.worth(b.c) < this.worth(a.c) ? b : a)).offer;
  }

  whole(): Case {
    const r = this.r;
    const nothing: Case = { ends: new Map([['none', 1]]), bolt: 0, where: new Map(), pick: null };
    if (r.location.fixed) {
      const part = r.parts.find((x) => x.slot === r.location.fixed);
      return part ? this.on(part, false) : nothing;
    }
    if (!r.parts.length) return nothing;
    return this.answers().reduce((a, b) => (this.worth(b.c) < this.worth(a.c) ? b : a)).c;
  }
}

// A case as chances.
function forecastFrom(r: AttackReading, c: Case): Forecast {
  let hit = 0;
  let pen = 0;
  let damage = 0;
  let destroy = 0;
  let kill = 0;
  let link = 0;
  for (const [end, p] of c.ends) {
    if (end === 'none') continue;
    hit += p;
    const changes = changesOf(end);
    if (!changes.length) continue;
    pen += p;
    const gone = changes.filter(([, s]) => s === 'destroyed').length;
    if (changes.some(([, s]) => s === 'damaged')) damage += p;
    if (gone) destroy += p;
    if (killed(r, changes)) kill += p;
    if (r.mech && !r.keepsLink) link += p * gone;
  }
  if (r.mech && r.drain) link += c.bolt;
  return {
    hit, pen, damage, destroy, kill, link,
    parts: [...c.where].map(([slot, [share, through]]) => ({ slot, share, pen: share > 0 ? through / share : 0 })),
    pick: c.pick,
  };
}

// The reading as chances: the whole attack, before any of it.
export function forecastOf(r: AttackReading, w: Weights = WORTH): Forecast {
  return forecastFrom(r, new Sheet(r, w).whole());
}

// What a forecast is worth to the attacker, by the same weights its choices
// were made with: the number a seat compares two answers by.
export function worthOfForecast(f: Forecast, w: Weights = WORTH): number {
  return w.kill * f.kill + w.destroy * f.destroy + w.damage * f.damage;
}

// ---------- the odds of a Counter-roll (4.11.2) ----------

// The chance that the Initiator wins an Electronic Counter-roll, before a die
// is thrown, from the window's own reading of it (contest.ts counterReading:
// how many dice each side throws, and what each face of a die comes to for
// that side). Every pair of hands the two pools can throw is given the
// engine's verdict (counterVerdict: the {Lightning} first, the Light Hits to
// break a tie, a roll level on both to the Initiator). Neither side is taken
// to Focus.
export function counterChance(r: CounterReading): number {
  const hand = (h: CounterReading['init']): Sums => throwDice(new Map([[0, 1]]), oneDie(h.faces, (f) => pack(f.lightning, f.light)), h.dice);
  const read = (k: number): { lightning: number; light: number } => ({ lightning: k & 31, light: (k >> 5) & 31 });
  const mine = hand(r.init);
  const theirs = hand(r.resp);
  let won = 0;
  for (const [a, pa] of mine) for (const [b, pb] of theirs) if (counterVerdict(read(a), read(b)).initiatorWins) won += pa * pb;
  return won;
}

// A forecast that comes about only with chance `p`.
const withChance = (f: Forecast, p: number): Forecast => ({
  hit: f.hit * p, pen: f.pen * p, damage: f.damage * p, destroy: f.destroy * p, kill: f.kill * p, link: f.link * p,
  parts: f.parts.map((x) => ({ ...x, share: x.share * p })), pick: f.pick,
});

// ---------- the attack in hand ----------

// One way of rerolling: the dice thrown again, by their place in the roll.
export interface Reroll { indices: number[]; forecast: Forecast }

// What each thing a seat may still do in the window comes to, FROM HERE: the
// Part Die kept or thrown again, a Part designated, a Parry declared, the dice
// left as they lie or some of them rerolled, a Surplus keyword taken. An
// attack whose first Penetration has been applied is forecast for what is
// left of it. Each answer assumes what the whole forecast assumes of every
// choice after it.
export class InHand {
  readonly sheet: Sheet;

  constructor(private readonly r: AttackReading, private readonly w: Weights = WORTH) {
    this.sheet = new Sheet(r, w);
  }

  get reading(): AttackReading {
    return this.r;
  }

  private from(ends: Ends, bolt = 0, pick: string | null = null): Forecast {
    return forecastFrom(this.r, { ends, bolt, where: new Map(), pick });
  }

  private get parryOn(): string | null {
    const d = this.r.hand.declared;
    return d && d.parry > 0 ? d.slot : null;
  }

  // The defender declares `slot` before the Part Die, or nothing (null).
  declare(slot: string | null): Forecast | null {
    const c = this.sheet.answer(slot);
    return c ? forecastFrom(this.r, c) : null;
  }

  // The Part Die is rolled.
  partRoll(): Forecast {
    const h = this.r.hand;
    if (h.round > 0) {
      const d = this.sheet.surplusDie(h.original, h.carried.heavy, h.carried.light);
      return this.from(d.ends, 0, d.any);
    }
    return forecastFrom(this.r, this.sheet.die(this.parryOn));
  }

  // The attacker puts the hit on `slot`.
  partPick(slot: string): Forecast | null {
    const h = this.r.hand;
    const part = this.r.parts.find((x) => x.slot === slot);
    if (!part) return null;
    if (h.round > 0) return this.from(this.sheet.surplusOn(slot, h.carried.heavy, h.carried.light), 0, slot);
    return forecastFrom(this.r, { ...this.sheet.on(part, slot === this.parryOn), pick: slot });
  }

  // The Part Die is kept where it has landed.
  dieKept(): Forecast | null {
    const h = this.r.hand;
    if (!h.die) return null;
    if (h.die !== 'any') return this.partPick(h.die);
    if (h.round > 0) {
      const any = this.sheet.surplusDie(h.original, h.carried.heavy, h.carried.light).any;
      return any ? this.partPick(any) : null;
    }
    const pick = this.sheet.pickPart(this.parryOn);
    return pick ? this.partPick(pick) : null;
  }

  // What one settled roll does to the Part the hit is on.
  private endsOf(s: Settled): Ends {
    const h = this.r.hand;
    const part = this.r.parts.find((x) => x.slot === h.part);
    if (!part || s.pen <= 0) return new Map([[s.hits > 0 ? 'hit' : 'none', 1]]);
    if (h.round > 0) return new Map([[`${part.slot}>${part.next}`, 1]]);
    const left = s.carried.heavy + s.carried.light;
    return left > 0 && this.r.surplus.length
      ? this.sheet.surplusPlan(part.slot, s.carried.heavy, s.carried.light).ends
      : new Map([[`${part.slot}>${part.next}`, 1]]);
  }

  // The Attack hand as it lies: the dice, or in a Surplus round the icons
  // carried into it.
  private attackNow(skip: Set<number> = new Set()): { heavy: number; light: number; bolt: number } | null {
    const h = this.r.hand;
    if (h.round > 0) return { heavy: h.carried.heavy, light: h.carried.light, bolt: 0 };
    if (!h.attack) return null;
    return handOf(this.r, null, h.attack.filter((_, i) => !skip.has(i)), []).attack;
  }

  private defenceNow(skip: Set<number> = new Set()): { dodge: number; defense: number } | null {
    const h = this.r.hand;
    if (!h.defense) return null;
    return handOf(this.r, null, [], h.defense.filter((_, i) => !skip.has(i)), h.evade).defence;
  }

  // In a Surplus round nothing of the Action's is counted: the carried icons
  // against the Defence Roll, and no more (4.8).
  private settleNow(a: { heavy: number; light: number; bolt: number }, d: { dodge: number; defense: number }): Settled {
    if (this.r.hand.round === 0) return settle(this.r, a, d);
    const o = offset(a.heavy, a.light, d.dodge, d.defense);
    return { hits: o.hits, pen: o.pen, carried: { heavy: 0, light: 0 }, bolt: 0 };
  }

  // The dice are left as they lie.
  stands(): Forecast | null {
    const a = this.attackNow();
    const d = this.defenceNow();
    if (!a || !d || !this.r.hand.part) return null;
    const s = this.settleNow(a, d);
    return this.from(this.endsOf(s), s.bolt);
  }

  // These dice of one side's roll are thrown again, the rest left. A die
  // thrown again is not Dense Armor's to take: that was before any reroll.
  reroll(side: 'attack' | 'defence', indices: number[]): Forecast | null {
    const h = this.r.hand;
    const skip = new Set(indices);
    if (!skip.size) return this.stands();
    if (!h.part || (side === 'attack' && h.round > 0)) return null;
    const ends: Ends = new Map();
    let bolt = 0;
    if (side === 'attack') {
      const fixed = this.attackNow(skip);
      const d = this.defenceNow();
      if (!fixed || !d || !h.attack) return null;
      const pool = { red: 0, yellow: 0 };
      for (const i of skip) { const c = h.attack[i]?.color; if (c === 'red' || c === 'yellow') pool[c] += 1; }
      for (const [k, p] of attackSums(pool, this.r.faces)) {
        const s = this.settleNow({ heavy: fixed.heavy + (k & 31), light: fixed.light + ((k >> 5) & 31), bolt: fixed.bolt + (k >> 10) }, d);
        addEnds(ends, this.endsOf(s), p);
        bolt += p * s.bolt;
      }
    } else {
      const a = this.attackNow();
      const fixed = this.defenceNow(skip);
      if (!a || !fixed || !h.defense) return null;
      const pool = { white: 0, blue: 0 };
      for (const i of skip) { const c = h.defense[i]?.color; if (c === 'white' || c === 'blue') pool[c] += 1; }
      for (const [k, p] of defenceSums(pool, this.r.faces)) {
        const s = this.settleNow(a, { dodge: fixed.dodge + (k & 31), defense: fixed.defense + (k >> 5) });
        addEnds(ends, this.endsOf(s), p);
        bolt += p * s.bolt;
      }
    }
    return this.from(ends, bolt);
  }

  // Every way of rerolling one side's dice that differs from another: two
  // dice of a colour showing the same face are one choice, not two. The first
  // is to throw none of them. Empty where there is nothing to reroll, and cut
  // short at `limit`.
  rerolls(side: 'attack' | 'defence', limit = 96): Reroll[] {
    const dice = side === 'attack' ? this.r.hand.attack : this.r.hand.defense;
    if (!dice || !dice.length) return [];
    const groups = new Map<string, number[]>();
    dice.forEach((x, i) => { const k = `${x.color}:${x.face}`; groups.set(k, [...(groups.get(k) ?? []), i]); });
    let picks: number[][] = [[]];
    for (const members of groups.values()) {
      const next: number[][] = [];
      for (const base of picks) for (let n = 0; n <= members.length; n++) next.push([...base, ...members.slice(0, n)]);
      picks = next;
      if (picks.length > limit * 4) break;
    }
    const out: Reroll[] = [];
    for (const indices of picks.slice(0, limit)) {
      const forecast = this.reroll(side, indices);
      if (forecast) out.push({ indices: indices.slice().sort((a, b) => a - b), forecast });
    }
    return out;
  }

  // The reroll worth most to whoever makes it: most to the attacker of its own
  // dice, least to the attacker of the defender's.
  bestReroll(side: 'attack' | 'defence'): Reroll | null {
    const all = this.rerolls(side);
    if (!all.length) return null;
    const sign = side === 'attack' ? 1 : -1;
    return all.reduce((a, b) => (sign * worthOfForecast(b.forecast, this.w) > sign * worthOfForecast(a.forecast, this.w) ? b : a));
  }

  // The Surplus is spent on this keyword (FAQ D1).
  keyword(name: string): Forecast | null {
    const h = this.r.hand;
    if (h.round === 0 || !h.original) return null;
    if (name === 'Mutilation') return this.from(this.sheet.surplusOn(h.original, h.carried.heavy, h.carried.light));
    const d = this.sheet.surplusDie(h.original, h.carried.heavy, h.carried.light);
    return this.from(d.ends, 0, d.any);
  }
}

// ---------- the window nobody sees ----------

// Asks the engine's combat window for an attack's reading, on any table: the
// one in play, or one a seat is only thinking about.
export class Odds {
  private readonly helper: AttackHelper;
  private table: GameState | null = null;
  // What the window changed on the table while it was asked, to be put back.
  private undo: (() => void)[] = [];
  private readonly known = new Map<string, Forecast>();

  constructor(private readonly data: GameData) {
    // The window sends nothing. The one thing an attack does to the table as
    // it is declared is Suppression, which moves the target's Stance before
    // its Defence pool is read: done here for the length of the reading.
    const send = (cmd: Command): { ok: boolean } => {
      const table = this.table;
      if (table && cmd.kind === 'suppress' && check(data, table, cmd).ok) {
        const target = table.tokens.find((t) => t.uid === cmd.targetUid);
        if (target) {
          const was = target.stance;
          target.stance = 'defensive';
          this.undo.push(() => { target.stance = was; });
        }
      }
      return { ok: true };
    };
    const h = new AttackHelper(data, data.dice as unknown as DiceData, document.createElement('div'),
      () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, send);
    h.headless = true;
    h.instant = true;
    h.role = 'attacker';
    h.tokens = () => this.table?.tokens ?? [];
    h.boxHands = (uid) => (this.table ? boxHands(this.table.tasks, uid) : []);
    h.opportunity = () => this.table?.script?.opp ?? null;
    h.actingUid = () => this.table?.script?.opp?.uid ?? null;
    h.terrain = () => (this.table ? terrainOf(data, this.table) : []);
    h.smoke = () => this.table?.smoke ?? [];
    this.helper = h;
  }

  // The reading of an attack as the window would open it on `state`, once
  // what is sent before it (its payment, a Charge spent, a Missile's flight)
  // has landed. Null where the attack cannot be opened. A Multi-Target is read
  // as its Begin makes it with nothing split: the whole pool on the target
  // named (FAQ B7). A split is read a target at a time (`share`).
  read(state: GameState, a: AttackArgs & { before?: Command[] }): AttackReading | null {
    const before = a.before ?? [];
    const table = before.length ? tableAfter(this.data, state, before) : state;
    if (!table) return null;
    const open = attackOpening(this.data, table, a.uid, a.actionId, a.targetUid, a.mode ?? 'attack', a);
    if (!open) return null;
    this.table = table;
    try {
      this.helper.start(open.attacker, open.action, open.defender, open.note, open.protection.white, open.protection.note,
        a.mode === 'explosion', a.mode === 'intercept');
      return this.helper.reading();
    } finally {
      this.helper.cancel();
      for (const back of this.undo.splice(0).reverse()) back();
      this.table = null;
    }
  }

  // The chances of an attack. Two attacks the window reads alike are worked
  // out once.
  forecast(state: GameState, a: AttackArgs & { before?: Command[] }, w: Weights = WORTH): Forecast | null {
    const r = this.read(state, a);
    return r ? this.chances(r, w) : null;
  }

  // ONE TARGET'S SHARE OF A MULTI-TARGET (FAQ B7): the attack read on it
  // (`read`), made with the dice allotted to it and no others. The pool is
  // the Action's, settled once and then split, so nothing of the target's own
  // is added to it here.
  share(r: AttackReading, pool: { red: number; yellow: number }, w: Weights = WORTH): Forecast {
    const attack = { red: pool.red, yellow: pool.yellow };
    return this.chances({ ...r, attack, hand: { ...r.hand, pool: { ...r.hand.pool, attack } } }, w);
  }

  private chances(r: AttackReading, w: Weights): Forecast {
    const key = JSON.stringify([r.mech, r.attack, r.faces, r.surplus, r.drain, r.location, r.parts, r.partsLeft, r.keepsLink, w]);
    let f = this.known.get(key);
    if (!f) {
      f = forecastOf(r, w);
      if (this.known.size > 4000) this.known.clear();
      this.known.set(key, f);
    }
    return f;
  }

  // AN ATTACK ON A UNIT IN OPTICAL CAMOUFLAGE, made through the one free Scan
  // that designates it (4.12.2; FAQ I11, I12): the chance of the Scan, times
  // the attack as it would then be made on the unit standing where its marker
  // does. Its player says where it appears, within its Stealth value of there,
  // and a seat cannot know: the marker is the one place it can reckon with.
  // `before` is the attack's payment. Null where the attack could not be
  // opened on the unit were it seen, or with no dice to read.
  hidden(state: GameState, a: AttackArgs & { before?: Command[] }, w: Weights = WORTH): Forecast | null {
    const table = tableAfter(this.data, state, a.before ?? []);
    const target = table?.tokens.find((t) => t.uid === a.targetUid);
    const scan = table ? counterReading(this.data, table, a.uid, a.targetUid, 'COMMON_SCAN') : null;
    if (!table || !target || !scan) return null;
    // The table is a copy: the unit is shown on it as the Scan would show it.
    target.statuses = (target.statuses ?? []).filter((x) => x !== 'camouflage');
    const f = this.forecast(table, { ...a, before: [] }, w);
    return f ? withChance(f, counterChance(scan)) : null;
  }
}

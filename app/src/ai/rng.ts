// The computer's dice and coin: one small seeded generator, so a game against
// it can be played again move for move from its seed (AI-OPPONENT-PLAN.md,
// decision D4). Nothing in a computer seat reads Math.random.

// FNV-1a, to turn a label into a seed.
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// sfc32: four words of state, a long period, and good enough to pass the
// usual batteries, which a 32-bit state is not once a tuner plays thousands of
// games off neighbouring seeds.
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 1;

  constructor(seed: number | string) {
    const s = typeof seed === 'string' ? seedOf(seed) : seed >>> 0;
    this.a = s;
    this.b = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    this.c = Math.imul(s ^ 0x7f4a7c15, 0xc2b2ae35) >>> 0;
    this.d = 1;
    // The first outputs of a freshly seeded sfc32 are correlated with the seed.
    for (let i = 0; i < 15; i++) this.word();
  }

  private word(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  // In [0, 1).
  next(): number {
    return this.word() / 4294967296;
  }

  // In [0, n).
  int(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n);
  }

  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }

  // One of the list, each with its own weight. A list whose weights are all
  // zero is picked from evenly.
  weighted<T>(list: readonly T[], weight: (x: T) => number): T {
    const w = list.map((x) => Math.max(0, weight(x)));
    const total = w.reduce((n, x) => n + x, 0);
    if (total <= 0) return this.pick(list);
    let roll = this.next() * total;
    for (let i = 0; i < list.length; i++) {
      roll -= w[i];
      if (roll < 0) return list[i];
    }
    return list[list.length - 1];
  }

  hex(bytes: number): string {
    let out = '';
    for (let i = 0; i < bytes; i++) out += this.int(256).toString(16).padStart(2, '0');
    return out;
  }

  // A second stream that shares nothing with this one but the seed it came
  // from, so the dice and the choices can each be replayed alone.
  fork(label: string): Rng {
    return new Rng((this.word() ^ seedOf(label)) >>> 0);
  }

  snapshot(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  restore(s: readonly [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = s;
  }
}

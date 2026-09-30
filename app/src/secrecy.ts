import type { GameState, Side, Timing } from './types';

// The networked Timing Dial secrecy (3.3): each seat publishes a hash of its
// dials, and the dials themselves only once both hashes are in. Shared by the
// board page and the Match Centre, because the hash must be byte-identical
// across pages or a cross-page game reads an honest reveal as cheating.

export interface DialEntry {
  uid: number;
  timing?: Timing;
}

export function dialsOf(state: GameState, seat: Side): DialEntry[] {
  return state.tokens
    .filter((t) => t.side === seat && t.kind === 'mech')
    .map((t) => ({ uid: t.uid, timing: t.timing }));
}

// The commitment covers the dials in a fixed order, so the same choices
// always hash the same way regardless of token order on the board.
export async function hashDials(salt: string, dials: DialEntry[]): Promise<string> {
  const canonical = JSON.stringify(
    [...dials].sort((a, b) => a.uid - b.uid).map((d) => [d.uid, d.timing ?? null]),
  );
  const bytes = new TextEncoder().encode(`${salt}|${canonical}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- a sealed Tactics hand (Supplementary Rules 1.04, 1.11) ----------
//
// A card's commitment: SHA-256 of the card and a salt its owner keeps. Hiding,
// because nobody can test a card id against it without the salt; binding,
// because nobody can find a second card and salt that give the same one, which
// a short hash like the fingerprint's would allow. Synchronous, because the
// engine's check() proves a play against it and check() never waits.
export function sealTactic(cardId: string, salt: string): string {
  return sha256Hex(`tactic|${cardId}|${salt}`);
}

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

// FIPS 180-4 SHA-256 over the text's UTF-8 bytes, as lowercase hex; the same
// digest crypto.subtle gives (tactichand.test pins it against node:crypto).
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const size = ((bytes.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(size);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = bytes.length * 8;
  view.setUint32(size - 8, Math.floor(bits / 0x100000000));
  view.setUint32(size - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < size; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// ---------- board fingerprint ----------
//
// A short digest of everything the two clients must agree on, sent with each
// command so the receiver can tell that the boards matched *before* it. The
// revision machinery already catches a command going missing; this catches the
// case it structurally cannot — both sides applying the same command at the
// same revision and ending up different, which is what a non-deterministic
// apply() looks like. The numbers agree, so nothing else would ever notice.
//
// Three rules for what goes in:
//   1. Only facts a command put there. Anything local — a UI toggle, a Timing
//      Dial before its reveal — legitimately differs, and including it would
//      report an honest game as a desync every Planning Phase.
//   2. **Nothing derived.** `script` is turn bookkeeping each client works out
//      for itself and never sends: `enterPhase` derives it from a command, but
//      `opportunity()` mints `script.opp` from inside a *render*. The sender
//      hashes before its next render and the receiver after its last one, so
//      the two disagree by one frame on every command — which is exactly the
//      false alarm that stopped a live game on 2026-08-05. The board is
//      commanded; the bookkeeping is computed. Only hash what is commanded.
//   3. Fixed order, always. Sort by id, list fields explicitly rather than
//      leaning on object key order, or the same board hashes two ways.
//
// Not a security boundary: it detects accident, not tampering, so a fast
// non-cryptographic hash is the right tool. `hashDials` above is the one that
// has to resist a lying client.

function fold(s: string): string {
  // FNV-1a, 32-bit. Synchronous, which is what lets this ride along on the
  // send path instead of turning every command into a promise.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const keyed = (o: Record<string, unknown> | undefined | null): [string, unknown][] =>
  Object.entries(o ?? {}).sort((a, b) => a[0].localeCompare(b[0]));

export function boardFingerprint(state: GameState): string {
  const s = state as GameState & Record<string, unknown>;
  const tokens = [...(s.tokens ?? [])]
    .sort((a, b) => a.uid - b.uid)
    .map((t) => [
      t.uid, t.side, t.kind, t.cardId, t.col, t.row, t.facing, t.size,
      t.stance, t.link ?? null, t.deployed !== false, t.aerial === true,
      keyed(t.partStates as unknown as Record<string, unknown>),
      [...(t.statuses ?? [])].sort(),
      keyed(t.ammo), keyed(t.intercept as unknown as Record<string, unknown>),
      // All commanded, all rules-bearing, and all invisible to this hash until
      // 2026-08-11: which Parts are Charged, which tokens show their red face,
      // a Drone's Load, and the Mech loadout itself. A drift in any of them
      // changes what check() will accept, so it has to be caught here.
      [...(t.charge ?? [])].sort(),
      [...(t.expiring ?? [])].sort(),
      t.droneBackpack ?? null,
      // Who Commanded this unit. Rules-bearing: the A2/M2 Data Links change
      // what a Commanded Drone may do, so a drift here would have one client
      // offering an Action the other refuses.
      t.commandedBy ?? null,
      // The Tether chips (PDLH-202). Rules-bearing twice over: the leash
      // REFUSES Grids the other client would offer, and the pair is what holds
      // the Harpoon's Tether Mode face on. Listed in uid order, which tetherTo
      // and migrateState both keep, so the same board hashes one way.
      (t.tether ?? []).map((x) => `${x.uid}:${x.range}:${x.role}`),
      // A lock_one commitment: once made it REMOVES options from the launch
      // picker, so a drift would have one client offering a Projectile the
      // other refuses.
      t.lockedProjectile ? keyed(t.lockedProjectile as unknown as Record<string, unknown>) : null,
      t.mech ? keyed(t.mech as unknown as Record<string, unknown>) : null,
      // Repaired Tokens are commanded (repairPart/breakRepaired) and READ BACK
      // by check() on both, so a drift makes one client refuse a repair the
      // other accepted.
      [...(t.repairedSlots ?? [])].sort(),
      // Who last destroyed a Part of this Mech. Commanded by applyPenetration
      // and read by the End Phase Integrity-Loss removal to decide who scores
      // the kill (P4) — so a drift here does not just desync, it awards the VP
      // to different sides on the two boards.
      t.lastDamagedBy ? `${t.lastDamagedBy.side}:${t.lastDamagedBy.uid}` : null,
      // The High Temperature entry marker. Rules-bearing: it decides whether
      // the NEXT settleEnvironments grants a Fragile Token, so a drift cooks
      // a unit on one board and not the other.
      t.envSeen ?? null,
      // A Missile Group and the target it follows (A5): check() refuses a
      // different target, so a drift would have one board refuse the other's pick.
      t.group ?? null,
      t.groupTarget ?? null,
      // A Mine's spared units and its owed mark (C2, C3): minesOwed reads both.
      // Its batch too (1.3), and only when it has one, so every other Mine
      // hashes as it did.
      t.mine ? `${(t.mine.spared ?? []).map((x) => `${x.uid}@${x.col},${x.row}`).sort().join(';')}|${t.mine.owed ? 1 : 0}${t.mine.batch ? `|${t.mine.batch}` : ''}` : null,
      // The Pholcus's M18.4 blast, owed by its Unfold (D2).
      t.unfoldBlast ? 1 : null,
      // The Pholcus's jump (1.9): minesOwed holds the Mines it set off while it
      // stands. Only when set, so every other unit hashes as it did.
      ...(t.jumpBlast ? ['jump'] : []),
      // Who stands inside its auras on a table with no board: every aura rule
      // reads it, so a drift changes dice on one board only. Only a record
      // with someone in it is hashed, so every other board hashes as before.
      ...(() => {
        const r = Object.entries(t.auraReaches ?? {}).filter(([, v]) => v.length).map(([k, v]) => `${k}:${[...v].sort((x, y) => x - y).join(',')}`).sort();
        return r.length ? [r] : [];
      })(),
      // NOT hashed, deliberately: `label` and `log` are display, `timing` is
      // secret until the reveal, and `aerial`/`barricade` are re-derived from
      // the card by migrateState so they cannot drift while cardId agrees.
      // Deliberately no `timing`: a dial is secret until both squads reveal
      // (3.3), so the two clients hold different ones and are meant to.
    ]);
  const tasks = (s.tasks ?? null) as { vp?: unknown; items?: { id: string }[] } | null;
  const items = [...(tasks?.items ?? [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((i) => keyed(i as unknown as Record<string, unknown>));
  return fold(JSON.stringify([
    s.round?.n, s.round?.phase, s.round?.firstPlayer,
    s.map, s.mission ?? null, s.scale ?? null, s.roundLimit ?? null, s.noBoard ?? null,
    // The Season Rules the table plays: they change what check() accepts (a
    // Stabilize System costing 2 Action Ticks), so a drift is a desync.
    s.season ?? null,
    // Whose simultaneous blast resolves next (1.9): check() refuses the other's.
    s.blastLast ?? null,
    keyed(s.commandTokens as unknown as Record<string, unknown>),
    tokens,
    [...(s.removedTerrain ?? [])].sort(),
    [...(s.smoke ?? [])].map((x) => keyed(x as unknown as Record<string, unknown>)),
    // The Environment Cards on the table. Rules-bearing four ways over: an
    // Abyss refuses Grids, Rugged prices exits, a Fragile Platform ends
    // movement, High Temperature hands out tokens - so a drift has one client
    // offering a route the other refuses.
    [...((s.environments ?? []) as { card: string; col: number; row: number }[])]
      .map((e) => `${e.card}:${e.col}:${e.row}`).sort(),
    tasks?.vp ?? null, items,
    // Hands stopped being local information when they became a command: both
    // seats are told both hands, and playTactic's once-per-round check READS
    // tacticsPlayed on the receiving side, so a drift here makes one client
    // refuse a play the other accepted — the exact failure this hash exists
    // to surface. (Rule 1's old example named the hand as a local thing;
    // that stopped being true when the hand went on the wire.)
    keyed(s.tactics as Record<string, unknown> | undefined),
    // A sealed hand's commitments: playTactic proves a card against them.
    keyed(s.tacticsSealed as Record<string, unknown> | undefined),
    keyed(s.tacticsPlayed as Record<string, unknown> | undefined),
    // The round whose End Phase has dissipated the smoke. dissipateSmoke's
    // check READS it, so a drift has one client refusing a dissipation the
    // other makes (audit Phase 4, G7).
    s.smokeRound ?? null,
    // No `script`: see rule 2. Where the units stand and what they have spent
    // is the thing worth agreeing on, and it is all commanded.
  ]));
}

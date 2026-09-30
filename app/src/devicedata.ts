// What this device keeps for a signed-in player's games, forgotten when they
// sign out (security audit, 2026-09-30): on a shared device the next person
// must not find the tables they sat at, with a Rejoin button and the other
// player's name, nor the salts that prove their hidden Tactics Cards or their
// unrevealed Timing Dials. The saved builds and the collection clear
// themselves (library.ts, collection.ts), because they sync with the account
// first.
//
// Only a sign-out clears these. Opening a page with no session does not: a
// player whose session simply ran out keeps a table they can sign back in to.

// The pad's recent tables, the Match Centre's last room, and the pad's own
// dial secret.
const KEYS = ['ember.pad.rooms', 'ember-last-room', 'ember.pad.dials'];
// Per room: the sealed Tactics hand (tactichand.ts) and the Match Centre's
// dial secret.
const PREFIXES = ['ember-hand:', 'mc-dialsecret-'];

export function forgetRoomsAndSecrets(): void {
  try {
    for (const key of KEYS) localStorage.removeItem(key);
    const found: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && PREFIXES.some((p) => key.startsWith(p))) found.push(key);
    }
    for (const key of found) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept to forget.
  }
}

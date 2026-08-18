import { ApiError, EmberApi, type Account, type MyRecord, type SquadEntry } from './api';
import { Relay, type RollKind } from './net';
import { applyRemote, check, onBeforeApply, onPerformed, onRefused, perform, type Command, type CheckResult } from './commands';
import { clearHistory, recordSnapshot, rollbackCatalog, undoToPhase } from './history';
import { setLocalSeat } from './loop';
import { cardName, dataUrl, loadData, missionImageUrl, squadLabel, type GameData } from './data';
import { tacticSpec } from './tactics';
import { flushBoxDrops, queueBoxDrop, objectiveCells } from './matchhud';
import { printedDeployment } from './overlays';
import { kcArmorReady, knockbackOf, migrateState, multiTargetLimit, squadAllegiance, tokenCards, unfoldsOwed, type AttackReaction } from './units';
import { countHits, normaliseSetup } from './setup';
import { gameResult, normaliseTasks, taskItemsFor } from './tasks';
import { loadSquads, saveSquad, type SavedSquad } from './squadstore';
import { loadMechPresets } from './presets';
import { installTooltip, preloadCards } from './tooltip';
import { warmAllImagesWhenIdle } from './images';
import { runFirstVisitPreload } from './preload';
import { importSquadFile } from './importer';
import { boardFingerprint, dialsOf, hashDials, newSalt, type DialEntry } from './secrecy';
import { animateRemoteMove, clearRangeOverlayFor, ensureHud, glueAfter, showRangeOverlay, showSideTab, startAttackPick, startBoxDrop, startDetonation, startElectronicPick, startInterceptPick, startLaunchPlan, startShove, startSmokePlan, type DiceLine, type HudCtx } from './matchhud';
import { AttackHelper } from './combat';
import { losNote, protectionFor } from './rules';
import { SquadTracker } from './squads';
import { Panel } from './panel';
import { iconSvg } from './dice';
import type { CombatView, DiceData, DieColor, GameState, Side, Token } from './types';
import { SLOT_LABEL, stationaryAdjusted } from './units';
import { PHASES } from './types';

// The Match Centre: a separate page for networked play, so the freeplay board
// never has to hide or lock anything — its controls simply are not here.
// Part 1 was the shell (sign in, account, the room door). Part 2 is the lobby:
// the host sets the battlefield and rules, both seats bring squads, and every
// choice travels as the same commands the board uses. Part 3 is the HUD.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The board this page holds and mirrors. Empty until squads arrive, but real:
// a host seeding a room from here must hand the guest a valid table.
function freshBoard(): GameState {
  return {
    v: 3,
    map: 'alley',
    tokens: [],
    nextUid: 1,
    round: { n: 1, phase: 0, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    markers: [],
    smoke: [],
    removedTerrain: [],
    tactics: { s1: [], s2: [] },
    tacticsPlayed: { s1: [], s2: [] },
    tasks: null,
    mission: null,
    scenario: null,
    roundLimit: 5,
    scale: 'standard',
    sideNames: {},
    zoneSet: '',
    showZones: false,
  };
}

const root = document.getElementById('mc')!;
const api = new EmberApi();

let data: GameData | null = null;
let account: Account | null = null;
let record: MyRecord | null = null;
let state: GameState = freshBoard();

type Step = 'room' | 'battlefield' | 'squads' | 'rules';
let step: Step = 'room';
// ?dev=1 renders the HUD without a room, for building and testing it solo.
const devSeat: Side | null = new URLSearchParams(location.search).get('dev') ? 's1' : null;
// The zone overlay is a per-player view preference, held here rather than in
// GameState so a checkpoint can never overwrite it. Always starts on.
let zonesVisible = true;
let diceData: DiceData | null = null;
const diceFeed: DiceLine[] = [];
// The dials this seat picked and the salt behind its commitment. The dials
// themselves never enter shared state before the reveal (3.3), so this is the
// ONLY copy — a page refresh or a relay checkpoint would erase it, leaving a
// commitment in shared state that this client can no longer re-commit or
// reveal, which locked a real game in a "pick your dials" loop. Persisted per
// room, restored on load and after every checkpoint.
let dialSecret: { round: number; salt: string; dials: DialEntry[] } | null = null;

function dialSecretKey(): string | null {
  const room = relay.state.room;
  return room ? `mc-dialsecret-${room.id}` : null;
}

function persistDialSecret(): void {
  const key = dialSecretKey();
  if (!key) return;
  try {
    if (dialSecret) localStorage.setItem(key, JSON.stringify(dialSecret));
    else localStorage.removeItem(key);
  } catch { /* a full store only costs the reload safety, not the game */ }
}

// Brings the secret back after a reload or checkpoint, and re-applies this
// seat's own dials onto the fresh tokens — they were applied locally through a
// secret command, so no checkpoint can ever carry them.
function recoverDialSecret(): void {
  const seat = relay.state.seat;
  const key = dialSecretKey();
  if (!seat || !key) return;
  if (!dialSecret) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw) as { round: number; salt: string; dials: DialEntry[] };
        if (p && typeof p.round === 'number' && typeof p.salt === 'string' && Array.isArray(p.dials)) dialSecret = p;
      }
    } catch { /* unreadable is the same as absent */ }
  }
  if (!dialSecret || dialSecret.round !== state.round.n) return;
  if (state.round.phase !== 1) return;
  for (const d of dialSecret.dials) {
    const t = state.tokens.find((x) => x.uid === d.uid);
    if (t && t.side === seat) t.timing = d.timing;
  }
}
let acctOpen = false;
let pickerOpen = false;
let loginErr: string | null = null;
let doorErr: string | null = null;
let lobbyNote: string | null = null;
let acctNote: { ok: boolean; text: string } | null = null;
let busy = false;
let copied = false;
// Set when the door is joining a table only to shut it down.
let closeOnArrival = false;

// A catch-up walks the board through the whole tail of history at once. Each
// step is a real state change, but drawing every one of them is what turned a
// rejoin into ten seconds of frozen page, so the screen is left alone until
// the replay lands and then drawn once.
let catchingUp = false;
// Asking for the board back is the right answer to a command that will not
// apply, but only the first time: if the replay itself is what refuses, an
// unthrottled ask becomes a loop of checkpoint, replay, refuse, ask.
// The code for the Rejoin door, and when we were last sat at it.
//
// The server reaps an idle room after an hour, so anything older than that is
// a code for a table that is not there. Without the timestamp the door went on
// offering yesterday's game, which is exactly what the server's own hour is
// meant to prevent.
const LAST_ROOM = 'ember-last-room';
const REJOIN_WINDOW_MS = 60 * 60 * 1000;

function rememberRoom(id: string): void {
  localStorage.setItem(LAST_ROOM, JSON.stringify({ id, at: Date.now() }));
}

function forgetRoom(): void {
  localStorage.removeItem(LAST_ROOM);
}

function lastRoom(): string | null {
  const raw = localStorage.getItem(LAST_ROOM);
  if (!raw) return null;
  // Bare codes are what earlier versions wrote. Undatable, so not offered.
  if (!raw.startsWith('{')) { forgetRoom(); return null; }
  try {
    const { id, at } = JSON.parse(raw) as { id?: string; at?: number };
    if (typeof id !== 'string' || typeof at !== 'number') { forgetRoom(); return null; }
    if (Date.now() - at > REJOIN_WINDOW_MS) { forgetRoom(); return null; }
    return id;
  } catch {
    forgetRoom();
    return null;
  }
}

let lastResync = 0;

function resyncSoon(): void {
  const now = Date.now();
  if (now - lastResync < 6000) {
    lobbyNote = 'The two boards disagree and would not settle. Leave and rejoin the table if this does not clear.';
    return;
  }
  lastResync = now;
  relay.requestResync();
}

const relay = new Relay(api.base, {
  onCommand(cmd) {
    if (!data) return;
    // Where the unit stood before their command lands, so the board can walk
    // it across rather than teleport it once the move has been applied.
    const moving = cmd.kind === 'maneuver' || cmd.kind === 'forceMove' ? cmd.uid : null;
    const walker = moving === null ? undefined : state.tokens.find((t) => t.uid === moving);
    const from = walker ? { col: walker.col ?? 0, row: walker.row ?? 0 } : null;
    const verdict = applyRemote(data, state, cmd);
    if (!verdict.ok) {
      // The reason a remote command was refused is the whole diagnosis of a
      // "would not settle", so it goes to the console — the panel note cannot
      // hold a dozen of them.
      console.warn(`remote ${cmd.kind} refused: ${verdict.why}`);
      resyncSoon();
      if (!catchingUp) render();
      return;
    }
    glueAfter(data, state, cmd);
    clearFeedAfter(cmd);
    rewindIfAgreed(cmd);
    settleDefense(cmd);
    publishCatalog();
    // Nothing below this line belongs in a replay: the commitments and reveals
    // are being re-read from history, and answering them again would send this
    // client's reveal a second time.
    if (catchingUp) return;
    advanceIfBothReady(cmd);
    if (from && moving !== null) {
      const now = state.tokens.find((t) => t.uid === moving);
      // A Maneuver carries the route it took; a Forced Movement is a straight
      // line by definition, so there is nothing to carry.
      const via = cmd.kind === 'maneuver' ? cmd.via : undefined;
      if (now) animateRemoteMove(moving, from, { col: now.col ?? 0, row: now.row ?? 0 }, via);
    }
    // Their commitment may be the second one, which releases our reveal; and
    // their reveal is checked against the hash they promised.
    if (cmd.kind === 'commitTimings') maybeReveal();
    if (cmd.kind === 'revealTimings') {
      const promised = state.script?.commits[cmd.seat];
      if (promised) {
        void hashDials(cmd.salt, cmd.dials).then((actual) => {
          if (actual !== promised) {
            lobbyNote = `${squadLabel(cmd.seat)}'s revealed dials do not match their commitment.`;
            render();
          }
        });
      }
    }
    render();
  },
  onCheckpoint(raw) {
    if (!data) return;
    const s = migrateState(raw, data);
    if (s) state = s;
    // A checkpoint REPLACES the board — note `state = s`, a new reference —
    // either because we joined late or because we drifted. Every snapshot taken
    // before it describes a game this client can no longer vouch for, and a
    // rollback into one would be worse than having none.
    clearHistory();
    // The ring the catalog described is gone with it, so the next comparison
    // must not match a list that no longer has anything behind it.
    publishedCatalog = '';
    asked = null;
    // Where a player who was not here for a rollback finds out which branch of
    // history everyone else is on. Without this their very first command is
    // stamped with branch zero and the host drops it, on a table that looks
    // perfectly connected from both ends.
    relay.setBranch(state.script?.rollbacks ?? 0);
    // The board this replaces it with IS the answer to "Rolling back…", so the
    // note has served its purpose. Left up, it would sit there for the rest of
    // the game claiming a rewind is still in flight.
    if (lobbyNote === 'Rolling back…') lobbyNote = null;
    // The checkpoint knows nothing of this seat's unrevealed dials — they are
    // local by design — so put them back before the panel decides they were
    // never picked, and answer a reveal the replaced board may be waiting on.
    recoverDialSecret();
    if (!catchingUp) {
      maybeReveal();
      render();
    }
  },
  onCatchUp(active) {
    catchingUp = active;
    if (active) return;
    // The board is whole again: draw it, and answer anything the replay
    // walked past — a commitment made while we were away may be waiting on
    // this client's reveal, and a reloaded page holds its half of the dial
    // secret only after recovery.
    recoverDialSecret();
    maybeReveal();
    // A host that has just caught up rebuilt its snapshot ring from scratch,
    // so the catalog in shared state may describe a ring that no longer
    // exists. Republish now rather than waiting for the next command to
    // notice — publishCatalog itself sends nothing when they already agree.
    publishCatalog();
    render();
  },
  onNeedCheckpoint() {
    // Only answer with a board we actually have. A client that has just
    // loaded holds an empty table, and handing that over would wipe the match
    // for everyone — which is the same mistake as republishing on rejoin, one
    // step further along.
    const room = relay.state.room;
    const seeded = running() || state.tokens.length > 0;
    const seedingANewRoom = relay.state.host && (room?.revision ?? 0) === 0;
    if (seeded || seedingANewRoom) relay.publishCheckpoint();
  },
  // Every roll in the room lands here, the roller's included, so both players
  // read the same line and watch the same faces. The roller adds nothing of
  // its own; doing so is what left the other player with a number and no dice.
  onRolled(dice, seat, label, _mine, kind) {
    // Attack and defence pools render inside the combat window on BOTH
    // screens now — the attacker's live helper and the defender's mirror — so
    // a feed line under them would say the same thing twice, in the corner
    // OTTO's opponent was left squinting at.
    const inCombatWindow = (label === 'Attack' || label === 'Defence' || label === 'Focus reroll')
      && (combatBusy() || !!state.script?.combatView);
    if (!inCombatWindow) pushRoll(seat, label, dice, kind);
    render();
  },
  onClosed() {
    // The table is gone for everyone, so the remembered code is worthless.
    forgetRoom();
    state = freshBoard();
    closeOnArrival = false;
    doorErr = 'That table has been closed.';
    render();
  },
  onChange(view) {
    setLocalSeat(view.room ? view.seat : null);
    // Remembered for the Rejoin door: a dropped connection should not need
    // the code typed back in.
    if (view.room) rememberRoom(view.room.id);
    // A refused join with nothing to show for it means the code is dead, so
    // the door stops offering it rather than failing the same way twice.
    else if (view.error && !view.room) forgetRoom();
    // Arriving only to shut the table: the close needs a seat at it first.
    if (view.room && closeOnArrival) {
      closeOnArrival = false;
      relay.closeRoom();
      return;
    }
    if (!catchingUp) render();
  },
  snapshot: () => JSON.parse(JSON.stringify(state)) as unknown,
  fingerprint: () => boardFingerprint(state),
});

// Everything performed on this page mirrors, same as on the board — and a
// strict refusal is worth a note here rather than silence.
onPerformed((cmd) => relay.publish(cmd));

// The rollback target, read one moment before apply() clears it. The historian
// runs before every command, local and remote alike, which is exactly when the
// pending ask is still on the board — so both clients capture the same target
// off the same command without either having to be told what it was.
let asked: { round: number; phase: number } | null = null;
onBeforeApply((s, cmd) => {
  if (cmd.kind === 'rollbackAnswer' && cmd.accept) {
    const r = s.script?.rollback;
    asked = r ? { round: r.round, phase: r.phase } : null;
  }
  recordSnapshot(s, cmd.kind);
});
onRefused((why) => {
  lobbyNote = why;
  render();
});

// ---------- the command path ----------

// A running match pauses whenever a seat is empty or its player has dropped:
// nothing may happen that the absent player cannot see happening.
function paused(): { side: Side; gone: boolean } | null {
  const room = relay.state.room;
  if (!room || !running()) return null;
  for (const side of ['s1', 's2'] as Side[]) {
    if (!room.seats[side]) return { side, gone: true };
    if (!room.online[side]) return { side, gone: false };
  }
  return null;
}

// Dice belong to the moment they were rolled for. Once the game has moved on —
// the roll-off accepted, a phase turned, an activation ended — leaving them on
// screen only invites someone to read last week's numbers as this turn's.
const CLEARS_THE_FEED = new Set([
  'acceptRoll', 'pickEdge', 'finishDeployment', 'advancePhase', 'setPhase',
  'designate', 'endOpportunity', 'passTurn', 'startMatch', 'endMatch',
]);

// The dice and the note both describe the moment that has just ended, so they
// go together. Without this the note outlived it by a mile — an attack line was
// still sitting at the top of the panel several activations later, while its
// mech had long since stopped being the one moving.
function clearFeedAfter(cmd: Command): void {
  if (!CLEARS_THE_FEED.has(cmd.kind)) return;
  diceFeed.length = 0;
  lobbyNote = null;
}

// One door for everything this page performs: the command, then the same
// deterministic guide glue every client runs, ours or theirs.
function send(cmd: Command): CheckResult {
  if (!data) return { ok: false, why: 'Still loading.' };
  // A spectator holds no seat, and nothing they do may touch the board. This
  // has to be a refusal HERE rather than only a hidden button, because the
  // damage is silent: perform() would apply the command to this client's own
  // state and relay.publish() drops it for want of a seat, so the watcher's
  // board would quietly drift away from the game they are watching with no
  // error anywhere. The server refuses these too — this is the same rule kept
  // on both sides of the wire rather than trusted to one.
  if (relay.state.room && !relay.state.seat) {
    return { ok: false, why: 'You are watching this table, so you cannot change the board.' };
  }
  const p = paused();
  if (p) return { ok: false, why: `Paused. Waiting for ${squadLabel(p.side)}'s player.` };
  const v = perform(data, state, cmd);
  if (v.ok) {
    glueAfter(data, state, cmd);
    clearFeedAfter(cmd);
    rewindIfAgreed(cmd);
    settleDefense(cmd);
    advanceIfBothReady(cmd);
    publishCatalog();
  }
  return v;
}

// A rollback both players agreed to. The rewind is done HERE rather than inside
// apply(), because a command that rewrote the board from inside apply() would be
// undoing the history entry it had just created.
//
// The host tells the table which points it can actually return to.
//
// Only the host rewinds, so only the host's ring decides what is reachable, and
// a guest offering a menu built from its own would be offering choices that may
// not exist. Sent as an ordinary command so it lands in shared state and both
// seats read the same list — which is also why there is no version number to
// compare: neither side can be holding a staler copy than the other.
//
// Cheap despite running after every command, because the answer only CHANGES
// when a phase begins or a die roll seals one, and it is not sent otherwise. A
// catalog command records a snapshot of its own, but at the round and phase the
// table is already in, so it adds no boundary and cannot set itself off again.
let publishedCatalog = '';
function publishCatalog(): void {
  const seat = mySeat();
  if (!seat || !isHost() || catchingUp || !state.script) return;
  const entries = rollbackCatalog().map(({ round, phase, available }) => ({ round, phase, available }));
  const key = JSON.stringify(entries);
  if (key === publishedCatalog) return;
  // Latched BEFORE the send, and un-latched on refusal — both halves matter.
  // The send re-enters this function on its way out, and the catalog command's
  // own snapshot can begin a new phase's history, so the nested call computes a
  // different key; the latch is what stops that at one extra round instead of
  // recursing forever. And send() refuses while the table is paused, so a key
  // left latched over a refusal would mark this catalog as published when it
  // never travelled — the guest then keeps a menu of points the host may no
  // longer hold, which is the very thing this list exists to prevent.
  publishedCatalog = key;
  if (!send({ kind: 'setRollbackCatalog', seat, entries }).ok) publishedCatalog = '';
}

// ONE ring decides the rewound board, and it is the host's.
//
// The obvious version has both clients undo their own ring off the same
// command. It is wrong, because the two rings are not the same length —
// setTiming is secret and never travels, so a player who set three dials holds
// three snapshots the opponent does not, and the older end of a 40-deep ring
// falls off at different moments on each side. A client that no longer holds
// the target would quietly do nothing while the other rewound: two boards, no
// complaint, which is the failure this whole layer exists to avoid.
//
// So the guest does not rewind at all. The host rewinds from its own ring and
// publishes a checkpoint; the guest's board is REPLACED by it. Costs the guest
// one round trip before the board moves, which is nothing against undoing
// several minutes of play, and it makes disagreement structurally impossible.
function rewindIfAgreed(cmd: Command): void {
  if (cmd.kind !== 'rollbackAnswer' || !cmd.accept) return;
  const to = asked;
  asked = null;
  if (!to) return;
  // Both seats leave the old branch here, at the same command, reading the same
  // count out of the same shared state. Anything either of them composed before
  // this moment is stamped with the branch being abandoned and will be dropped
  // on arrival instead of landing on the rewound board — which is what used to
  // happen, silently, because a stale command's revision is not ours and the
  // drift check therefore never fired on it.
  const branch = state.script?.rollbacks ?? 0;
  relay.setBranch(branch);
  if (!isHost()) {
    // Every snapshot here describes a board the checkpoint is about to discard,
    // and onCheckpoint would drop them anyway. Cleared early so nothing can be
    // undone into the gap while the rewind is in the air.
    clearHistory();
    lobbyNote = 'Rolling back…';
    render();
    return;
  }
  const snap = undoToPhase(state, to.round, to.phase);
  if (!snap) {
    // Only reachable if the asker offered a point the host has already dropped.
    // Nothing has moved on either board, so this is safe — but it is not silent.
    lobbyNote = 'That point is too far back to return to. Nothing was undone.';
    render();
    return;
  }
  // The snapshot predates the answer that agreed to this rollback, so restoring
  // it puts the branch count back as well. The count is a tally of what has
  // HAPPENED to the game rather than part of the position, so it survives the
  // rewind — and it has to, because the checkpoint below is where a player who
  // joins later learns which branch everyone is on.
  if (state.script) state.script.rollbacks = branch;
  // The server still holds every command that has just been undone, so a
  // resync or a late joiner would replay them straight back. Publishing a
  // checkpoint truncates its log to the rewound board — relay.ts drops
  // everything at or before the checkpoint revision.
  relay.publishCheckpoint();
  render();
}

// The faces a roll landed on, read from the same printed data both players
// hold. Every count on screen comes through here, so what a player is told
// their roll was worth is derived from the very faces they are shown.
function facesOf(dice: { color: string; face: number }[]) {
  return dice.map((d) => diceData?.dice[d.color as DieColor]?.faces[d.face] ?? []);
}

let feedSeq = 0;

function pushRoll(seat: Side, label: string | null, dice: { color: string; face: number }[], kind: RollKind): void {
  const faces = facesOf(dice);
  let result: { n: number; unit: string }[];
  if (kind === 'hits') {
    // The table-edge roll is decided on Hits alone, which is why a face
    // carrying two Hit icons is worth two: the count is of icons, not of dice.
    const n = countHits(faces);
    result = [{ n, unit: n === 1 ? 'Hit' : 'Hits' }];
  } else {
    const counts: Record<string, number> = {};
    for (const face of faces) for (const icon of face) counts[icon.type] = (counts[icon.type] ?? 0) + 1;
    const pretty = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase();
    result = Object.entries(counts).map(([k, n]) => ({ n, unit: pretty(k) }));
  }
  feedSeq += 1;
  diceFeed.push({ seat, label: label ?? 'rolled', result, kind, dice, n: feedSeq });
}

// Server dice in a room; honest local dice in dev. Either way the Hits per
// die come from the same printed faces, and the faces come back so the feed
// can show what landed. In a room the feed line is added when the server
// announces the roll to everyone, so both players get it the same way.
async function rollHits(n: number, label: string): Promise<{ hits: number[]; dice: { color: string; face: number }[] }> {
  if (!diceData) return { hits: Array.from({ length: n }, () => 0), dice: [] };
  const faces = diceData.dice.yellow;
  let idx: number[];
  if (relay.state.room && relay.state.seat) {
    const rolled = await relay.rollDice({ yellow: n }, label, 'hits');
    idx = rolled.map((d) => d.face);
  } else {
    idx = Array.from({ length: n }, () => Math.floor(Math.random() * faces.sides));
  }
  const dice = idx.map((i) => ({ color: 'yellow', face: i }));
  const hits = idx.map((i) => countHits([faces.faces[i] ?? []]));
  if (!relay.state.room) pushRoll(devSeat ?? 's1', label, dice, 'hits');
  return { hits, dice };
}

// ---------- the left side panel, borrowed whole from freeplay ----------

let squadTracker: SquadTracker | null = null;
let panel: Panel | null = null;
// The freeplay §4.4 pipeline, rendering into the Combat tab. It never touches
// the board itself — every change it makes leaves as a command — which is what
// makes it safe to run on a networked table.
let attackHelper: AttackHelper | null = null;

function combatBusy(): boolean {
  return !!attackHelper?.active;
}

function renderCombatIdle(): void {
  const body = document.getElementById('combat-body');
  if (!body) return;
  body.innerHTML = attackHelper
    ? `<p class="dim combat-idle">No attack in progress. Open a unit's card in the Details tab and use
       <b>⌖ Attack…</b> or <b>💥 Detonate…</b> on one of its Actions.</p>`
    : '<p class="dim combat-idle">The dice data did not load, so attacks cannot be resolved here. Reload the page to try again.</p>';
}

// Server dice in a room so neither client picks its own numbers; local dice
// solo. Same rule the freeplay board follows.
function combatRoller() {
  return relay.state.room && relay.state.seat
    ? (pool: Record<string, number>, tag?: string) => relay.rollDice(pool, tag)
    : null;
}

// The attacker's helper, parked on the defence step until the answering
// command brings the defender's faces. The colours are the helper's DieColor
// union; the wire carries plain strings, so the cast happens at this seam and
// nowhere deeper.
let pendingDefense: ((faces: { color: DieColor; face: number; selected: boolean }[]) => void) | null = null;

// A defence pool as raw faces — server dice in a room so both players watch
// them land, local otherwise (the solo harness).
async function rollDefensePool(white: number, blue: number): Promise<{ color: DieColor; face: number; selected: boolean }[]> {
  const pool: Record<string, number> = {};
  if (white) pool.white = white;
  if (blue) pool.blue = blue;
  if (relay.state.room && relay.state.seat) {
    const rolled = await relay.rollDice(pool, 'Defence', 'pool');
    return rolled.map((d) => ({ color: d.color as DieColor, face: d.face, selected: false }));
  }
  return Object.entries(pool).flatMap(([c, n]) =>
    Array.from({ length: n }, () => ({ color: c as DieColor, face: Math.floor(Math.random() * (diceData!.dice[c as DieColor]?.sides ?? 6)), selected: false })),
  );
}

// Both halves of the handshake, run off the commands so the order is the wire's
// order: the ANSWER hands the faces to the waiting helper and closes the shared
// record; a CLEAR that arrives while we are still waiting is the attacker
// cancelling the attack (or a rollback tearing it down), so the wait ends.
// The second half of the phase-turning agreement: when a setReady completes
// the pair mid-game, the COMPLETER's client sends the advance. Both clients
// derive the same completer from the same command, so exactly one asks — and
// check('advancePhase') consumes the flags, so even a duplicate is refused
// rather than turning the phase twice. Deployment keeps its own ready flow:
// the setup stage gate below leaves it alone.
function advanceIfBothReady(cmd: Command): void {
  if (cmd.kind !== 'setReady' || !cmd.ready) return;
  if (!relay.state.room || !running()) return;
  const su = normaliseSetup(state.setup);
  if (!su || su.stage !== 'done') return;
  if (!(state.ready?.s1 && state.ready?.s2)) return;
  if (mySeat() !== cmd.seat) return;
  send({ kind: 'advancePhase', seat: cmd.seat });
}

function settleDefense(cmd: Command): void {
  if (cmd.kind === 'answerDefense' && pendingDefense) {
    const resolve = pendingDefense;
    pendingDefense = null;
    resolve(cmd.faces.map((f) => ({ color: f.color as DieColor, face: f.face, selected: false })));
    // The record served its purpose the moment the faces landed; clearing it
    // is what lets the next attack ask again, and it is the ATTACKER's to
    // clear because the attacker's helper is the consumer.
    send({ kind: 'clearDefense', seat: mySeat() ?? 's1' });
  }
  if (cmd.kind === 'clearDefense' && pendingDefense) {
    pendingDefense = null;
  }
  // The remote defender's half of Focus (4.4.1-5), consumed by the attacking
  // client's open combat window the same way the defence roll is. The helper
  // ignores both when it is not mid-Focus, so the defender's own echo of its
  // command is harmless.
  if (cmd.kind === 'focusAnswer') attackHelper?.focusAnswered(cmd.use);
  if (cmd.kind === 'focusReroll') attackHelper?.focusRerolled(cmd.indices, cmd.faces);
  if (cmd.kind === 'kcArmor') attackHelper?.kcArmed();
}

function startAttack(uid: number, actionId: string, targetUid: number, mode: 'attack' | 'intercept' | 'explosion' = 'attack'): void {
  if (!data || !attackHelper) return;
  const attacker = state.tokens.find((t) => t.uid === uid);
  const defender = state.tokens.find((t) => t.uid === targetUid);
  const printed = tokenCards(data, attacker ?? ({} as never))
    .flatMap(({ card }) => card.actions ?? [])
    .find((a) => a.id === actionId) ?? data.commonActions.find((a) => a.id === actionId);
  // [Stationary] rides into the helper too, so the pool and the printed Range
  // it shows are the ones the condition earned.
  const oppNow = state.script?.opp;
  const action = printed ? stationaryAdjusted(printed, oppNow?.uid === uid ? oppNow : null) : printed;
  if (!attacker || !defender || !action) return;
  const terrain = terrainNow();
  const smoke = state.smoke ?? [];
  // Interception and Explosion both hand the defender no Terrain or Unit
  // Protection, and neither checks arc or line of sight — so the reading of the
  // board that an ordinary attack needs would be wrong guidance for them.
  const note = mode === 'intercept'
    ? 'Interception: line of sight always exists and no Forward Arc is required, and the target claims no Terrain or Unit Protection (4.9).'
    : mode === 'explosion'
      ? 'Explosion damage ignores line of sight and facing, and the defender claims no Terrain or Unit Protection (4.7.6).'
      : losNote(attacker, defender, action, terrain, state.tokens, smoke);
  const prot = mode === 'attack'
    ? protectionFor(attacker, defender, action, terrain, state.tokens, smoke)
    : { white: 0, note: '' };
  attackHelper.roller = combatRoller();
  // Multi-Target opens on the helper's own split step: the extra targets, the
  // shared pool and the split all live there, so this page needs no second
  // targeting flow and cannot drift from freeplay. Interception and Explosion
  // are single-target by rule and route to the ordinary front door.
  const multi = mode === 'attack' ? multiTargetLimit(action) : undefined;
  if (multi) attackHelper.startMulti(attacker, action, defender, multi);
  else attackHelper.start(attacker, action, defender, note, prot.white, prot.note, mode === 'explosion', mode === 'intercept');
  render();
}

function mountSide(): void {
  if (!data) return;
  squadTracker = new SquadTracker(data, document.getElementById('squad-body')!, {
    onSelect: (uid) => syncSide(uid),
    onChanged: () => render(),
    // Editing a squad mid-match belongs to the lobby, so these are inert here.
    // Taking a wreck off the board. Your own units only — the command layer
    // refuses the other squad's, and the removal travels so both boards clear
    // the same token.
    onDelete: (uid) => {
      const t = state.tokens.find((x) => x.uid === uid);
      if (t) send({ kind: 'despawn', seat: t.side, uid, targetUid: uid });
      render();
      syncSide(null);
    },
    onEditMech: () => {},
    onPlayTactic: (side, id) => {
      send({ kind: 'playTactic', seat: side, uid: state.tokens.find((t) => t.side === side)?.uid ?? 0, cardId: id });
      render();
    },
    scenarioName: () => null,
    onShowScenario: () => {},
  });
  panel = new Panel(data, {
    world: () => ({ tokens: state.tokens, terrain: terrainNow() }),
    // Card buttons that would open the freeplay dice tray stay inert; rolls
    // in a match come from the turn panel and the server.
    onRollDice: () => {},
    // A magazine is a number both players have to agree on, so the card's own
    // buttons send the same commands the board sends rather than sitting dead.
    // The ones that need a board flow of their own — launching, shoving,
    // detonating and starting an Interception — hand off to the turn panel,
    // which is where this HUD asks every question.
    onSpendAmmo: (t, actionId) => {
      send({ kind: 'spendAmmo', seat: t.side, uid: t.uid, actionId });
      render();
      syncSide(t.uid);
    },
    onRestoreAmmo: (t, actionId) => {
      send({ kind: 'restoreAmmo', seat: t.side, uid: t.uid, actionId });
      render();
      syncSide(t.uid);
    },
    // The card has chosen the Part; the turn panel asks which Aerial Unit,
    // since Interception may only ever attack the one that triggered it (4.9).
    onSpendIntercept: (t, actionId) => {
      startInterceptPick(t.uid, actionId);
      render();
    },
    onRestoreIntercept: (t, actionId) => {
      send({ kind: 'restoreIntercept', seat: t.side, uid: t.uid, actionId });
      render();
      syncSide(t.uid);
    },
    // The card has chosen the Action and the Projectile; the board asks where.
    onLaunch: (t, action, projectile) => {
      startLaunchPlan(t.uid, action.id, projectile.id, projectile.name?.en || projectile.id);
    },
    // The card names the Action; the turn panel asks which enemy, reading the
    // range, arc and line of sight off the board for each one.
    onStartAttack: (t, actionId) => {
      startAttackPick(t.uid, actionId);
      render();
    },
    // The Counter-roll is a two-seat exchange rather than a wizard on one
    // screen, because both sides roll and either may spend its own Link (4.11).
    onStartElectronic: (t, actionId) => {
      startElectronicPick(t.uid, actionId);
      render();
    },
    // What an Action reaches, drawn on the board until something else is asked
    // for. Movement counts terrain and Break Away; a plain Range does not.
    onShowMoveRange: (t, steps) => {
      showRangeOverlay(t.uid, 'move', steps);
    },
    onShowActionRange: (t, range) => {
      showRangeOverlay(t.uid, 'range', range);
    },
    // Resolving a Projectile's Delayed Action: the turn panel asks what it
    // caught, then destroys it (4.7.5).
    onDetonate: (t, actionId) => {
      // Pholcus's Delayed Action is a replacement, not a payload (FAQ M18).
      if (data && unfoldsOwed(data, [t]).some((x) => x.actionId === actionId)) {
        send({ kind: 'unfold', seat: t.side, uid: t.uid });
        render();
        return;
      }
      startDetonation(t.uid, actionId);
      render();
    },
    // A shove is a Knockback with no Attack behind it, so the panel asks which
    // enemy Ground Unit in the Grid ahead takes it.
    onShove: (t, actionId) => {
      startShove(t.uid, actionId);
      render();
    },
    // The card's own pip, flipping one Part's token directly (4.14). The
    // guided moments — a Charge Action, and an Action marked [Charged] — ask
    // in the turn panel instead.
    onCharge: (t, slot, on) => {
      send({ kind: 'setCharge', seat: t.side, uid: t.uid, slot, on });
      render();
      syncSide(t.uid);
    },
    tacticNote: () => null,
  });
  if (diceData) {
    attackHelper = new AttackHelper(
      data,
      diceData,
      document.getElementById('combat-body')!,
      () => render(),
      () => {
        // Closing the helper while a defence call is still in the air is the
        // attacker cancelling the attack: take the question back, or the
        // defender is left rolling dice for a shot that no longer exists.
        if (pendingDefense && state.script?.combat) {
          pendingDefense = null;
          send({ kind: 'clearDefense', seat: mySeat() ?? 's1' });
        }
        renderCombatIdle();
        showSideTab(null, 'details');
        render();
      },
      // Unit logs are a freeplay habit; here the turn panel's note carries what
      // the roll worked out, so the other player is not left guessing.
      (t, text) => { void t; lobbyNote = text; },
      (attacker, defender, action, hits) => {
        // This fires after EVERY completed attack, so the Knockback keyword has
        // to be tested here — opening the Forced Movement panel unconditionally
        // greeted every ordinary shot with "this Action carries none". An
        // On-Hit Knockback that scored nothing does not trigger either.
        const kb = knockbackOf(action, data?.actionTranslation(action.id)?.english ?? undefined);
        const shoving = !!kb && !(kb.onHit && hits === 0) && attacker.kind !== 'projectile';
        if (attacker.kind === 'projectile') send({ kind: 'despawn', seat: attacker.side, uid: attacker.uid, targetUid: attacker.uid });
        else if (shoving) startShove(attacker.uid, action.id, defender.uid);
        // With no Forced Movement to wait for, a queued Black Box question is
        // asked now; with one, the shove flow flushes it when it settles (E19).
        if (!shoving) flushBoxDrops();
        render();
      },
      (killer, victim, what) => {
        send({ kind: 'recordKill', seat: killer.side, uid: killer.uid, targetUid: victim.uid, what });
        render();
      },
      // A Penetrated bearer drops its Black Box, and the ATTACKER says where
      // (5.3.1) — so the question opens on this seat, not the victim's.
      (victim, attacker) => {
        // Queued rather than asked at once: Forced Movement resolves first and
        // the Box lands around the NEW position (FAQ E19).
        const box = normaliseTasks(state.tasks).items
          .find((i) => i.kind === 'blackbox' && i.bearerUid === victim.uid);
        if (box) queueBoxDrop(box.id, victim.uid, attacker.side, attacker.uid);
        render();
      },
      (cmd) => { send(cmd); },
    );
    attackHelper.tokens = () => state.tokens;
    attackHelper.terrain = () => terrainNow();
    attackHelper.smoke = () => state.smoke ?? [];
    // The defender's dice belong to the defending player. When the unit being
    // shot at is the OTHER seat's, the roll is asked for through shared state:
    // callDefense records what is owed, their client shows the roll button,
    // and answerDefense brings the faces back. A unit of our own defending —
    // the solo harness, a detonation on an ally — keeps the direct roll, since
    // the button would be ours either way.
    attackHelper.defenseRoller = (pool, attacker, defender, actionId) => new Promise((resolve) => {
      const seatNow = mySeat();
      if (!relay.state.room || !seatNow || defender.side === seatNow) {
        void rollDefensePool(pool.white, pool.blue).then(resolve);
        return;
      }
      pendingDefense = resolve;
      send({ kind: 'callDefense', seat: attacker.side, uid: attacker.uid, targetUid: defender.uid, actionId, white: pool.white, blue: pool.blue });
    });
    // Focus (4.4.1-5): the defender's declare and reroll belong to their own
    // player when that player is at another screen — the mirror asks them.
    attackHelper.focusRemote = (defender) => !!relay.state.room && !!mySeat() && defender.side !== mySeat();
    // The defender's own reaction to being shot at. The helper holds these back
    // until every sequence of a Multi-Target has resolved (FAQ B7), so by the
    // time this fires the Screens are already too late to shield anyone the
    // same Action hit — which is exactly the ruling.
    //
    // It becomes a DEBT IN SHARED STATE rather than a panel on this client.
    // The attacking seat is the only one that knows the attack finished, but
    // the Screens are the defender's to place and their Ammo is theirs to
    // spend — and a client may only ever command its own units. Same shape as
    // Interception's owed queue, for the same reason.
    attackHelper.onReaction = (defender, reaction) => {
      send({
        kind: 'queueReactions', seat: mySeat() ?? defender.side,
        items: [{ uid: defender.uid, actionId: reaction.actionId, count: reaction.smoke.count, range: reaction.smoke.range }],
      });
      render();
    };
    // The defender's mirror. Published on change only — the helper redraws
    // many times per step and each publish is a command on the wire.
    attackHelper.publishView = (view) => {
      if (!relay.state.room || !mySeat()) return;
      const key = JSON.stringify(view);
      if (key === publishedCombatView) return;
      publishedCombatView = key;
      send({ kind: 'setCombatView', seat: mySeat()!, view: view as CombatView | null });
    };
  }
  renderCombatIdle();
}

// The last combat view THIS client published, so a repaint sends nothing and a
// closed window can be told apart from one that never opened. The teardown
// lives in render()'s sweep rather than an onClose hook: whatever way the
// helper ends — Done, cancel, a rollback — the next render sees it idle.
let publishedCombatView = '';

function sweepCombatView(): void {
  if (!relay.state.room || !mySeat()) return;
  if (!combatBusy() && publishedCombatView && publishedCombatView !== 'null') {
    publishedCombatView = 'null';
    send({ kind: 'setCombatView', seat: mySeat()!, view: null });
  }
}

function terrainNow() {
  const gone = new Set(state.removedTerrain ?? []);
  return (data?.terrain.layouts[state.map] ?? []).filter((p) => !gone.has(p.id));
}

function syncSide(uid: number | null): void {
  squadTracker?.update(state, uid);
  const t = uid !== null ? state.tokens.find((x) => x.uid === uid) : undefined;
  // A range ring belongs to the unit whose card asked for it. Selecting
  // another unit (or nothing) is the "something else" that dismisses it — it
  // used to sit on the board until the next explicit ask. Redrawn here
  // because several callers render before they sync.
  if (clearRangeOverlayFor(uid)) render();
  if (t) panel?.showToken(t);
  else panel?.clear();
  sealSideForWatchers();
}

// A spectator reads the cards and changes nothing on them.
//
// Enforced here rather than inside Panel because it is the Match Centre's
// policy, not the card's: the same Panel is the freeplay board's, where every
// one of these buttons is exactly right. Panel has no read-only mode and some
// thirty button sites, so threading a flag through all of them would be a lot
// of edits to say one thing. The buttons are disabled AFTER each render — the
// panel rebuilds its body every time, so this has to run every time with it.
//
// This is presentation only. `send()` refuses a seatless client outright, so
// the board is already safe if any of this is ever missed; what this adds is
// not offering the player a control that would only tell them no.
function sealSideForWatchers(): void {
  if (!relay.state.room || relay.state.seat) return;
  for (const host of ['#details-body', '#squad-body']) {
    const el = document.querySelector(host);
    if (!el) continue;
    for (const b of el.querySelectorAll('button')) b.disabled = true;
    el.classList.add('watching');
  }
}

// An attack pool: server dice in a room, local otherwise, and the face icons
// summarised into the shared feed either way.
async function rollPool(y: number, r: number, label: string): Promise<void> {
  if (!diceData) return;
  const pool: Record<string, number> = {};
  if (y) pool.yellow = y;
  if (r) pool.red = r;
  let rolled: { color: string; face: number }[];
  if (relay.state.room && relay.state.seat) {
    rolled = await relay.rollDice(pool, label, 'pool');
  } else {
    rolled = Object.entries(pool).flatMap(([c, n]) =>
      Array.from({ length: n }, () => ({ color: c, face: Math.floor(Math.random() * (diceData!.dice[c as DieColor]?.sides ?? 6)) })),
    );
  }
  if (!relay.state.room) {
    pushRoll(relay.state.seat ?? devSeat ?? 's1', label, rolled, 'pool');
    render();
  }
}

// The commit half of the dial secrecy; the reveal follows once both are in.
function lockDialsNetworked(): void {
  const seat = relay.state.seat;
  if (!seat || !data) return;
  const sc = state.script;
  // A commitment already made is only honoured while this client still holds
  // the secret behind it. Lost secret means the reveal can never come, so the
  // seat commits AFRESH — check() allows the replacement until anyone reveals.
  if (sc?.commits[seat] && dialSecret?.round === state.round.n) return;
  const dials = dialsOf(state, seat);
  const salt = newSalt();
  dialSecret = { round: state.round.n, salt, dials };
  persistDialSecret();
  void hashDials(salt, dials).then((hash) => {
    send({ kind: 'commitTimings', seat, hash });
    maybeReveal();
    render();
  });
}

function maybeReveal(): void {
  const seat = relay.state.seat;
  const sc = state.script;
  if (!seat || !sc || !dialSecret || dialSecret.round !== state.round.n) return;
  if (!sc.commits.s1 || !sc.commits.s2) return;
  if (sc.revealed.includes(seat)) return;
  send({ kind: 'revealTimings', seat, salt: dialSecret.salt, dials: dialSecret.dials });
}

// ---------- small readers ----------

const mySeat = (): Side | null => relay.state.seat;
const isHost = (): boolean => relay.state.host;
const running = (): boolean => !!normaliseSetup(state.setup);

function mapName(id: string): string {
  const m = data?.terrain.maps.find((x) => x.id === id);
  return m?.name.en || id || 'no map';
}

function missionName(): string {
  if (!state.mission) return 'no Main Task';
  const m = data?.missions.cards.find((x) => x.id === state.mission);
  return m?.name ?? state.mission;
}

function sideSummary(side: Side): { mechs: number; drones: number; points: number } {
  let mechs = 0;
  let drones = 0;
  let points = 0;
  if (data) {
    for (const t of state.tokens) {
      if (t.side !== side || t.kind === 'projectile') continue;
      if (t.kind === 'mech') mechs++;
      else drones++;
      points += tokenCards(data, t).reduce((n, { card }) => n + (card.score ?? 0), 0);
    }
    // A Tactics Card is never on the board but is paid for out of the same
    // budget, so leaving it out understated what a squad had spent.
    for (const id of state.tactics?.[side] ?? []) points += data.byId.get(id)?.score ?? 0;
  }
  return { mechs, drones, points };
}

// The Tactics Cards held in hand rather than deployed (5.4). No longer picked
// here: the hand belongs to the SQUAD — built in freeplay, saved with it, and
// it arrives with whatever list "Bring a squad" brings. This is only the
// read-out, so a player can see what came with their squad and what it cost.
// check() for playTactic reads the sender's hand, and the other client has to
// have it, which is why the hand still travels as setTactics underneath.
//
// Folded away by default. Plenty of squads never take one, and rows of
// something you are not using are rows in the way of the units you are.
let tacticsOpen = false;

function tacticsPicker(side: Side): string {
  if (!data) return '';
  const held = state.tactics?.[side] ?? [];
  if (!held.length) return '';
  const points = held.reduce((n, id) => n + (data?.byId.get(id)?.score ?? 0), 0);
  const summary = `${held.length} in hand · ${points}p`;
  // `data-tip-card` is all the preview needs: the page installs one delegated
  // listener that shows any card's scan on hover, so a player can read what a
  // Tactic in their hand does.
  const rows = !tacticsOpen ? '' : held
    .map((id) => {
      const c = data?.byId.get(id);
      if (!c) return '';
      const when = tacticSpec(c.id)?.timing ?? '';
      return `<div class="tacpick on" data-tip-card="${esc(c.id)}" title="${esc(when)}">
        <span class="tn">${esc(cardName(c))}</span>
        <span class="tw">${esc(when)}</span>
        <span class="tp">${c.score ?? 0}p</span></div>`;
    })
    .join('')
    + '<p class="quiet" style="margin:6px 0 0">The hand comes with the squad — build it on the freeplay board and save or bring the squad. Only 1 is played per round (5.4.2).</p>';
  return `<div class="tacbox">
    <button class="taclabel" id="mc-tactoggle" aria-expanded="${tacticsOpen}">
      <span class="tcaret">${tacticsOpen ? '▾' : '▸'}</span>Tactics Cards<span class="tsum">${esc(summary)}</span>
    </button>
    ${rows}
  </div>`;
}

// ---------- pieces ----------

function barHtml(): string {
  const v = relay.state;
  // Who is actually here, not just who holds a seat. Saying "both seated" over
  // a paused board is the bar contradicting the veil in front of it.
  const away = v.room ? (['s1', 's2'] as Side[]).find((s) => v.room!.seats[s] && !v.room!.online[s]) : undefined;
  // A watcher's pill says what they are before it says anything about the
  // seats: "both seated" on a screen you cannot act on reads as a game you are
  // simply locked out of, rather than one you joined to watch.
  const watching = !!v.room && !v.seat;
  const conn = v.room
    ? v.status === 'connecting'
      ? '<span class="pill bad">● reconnecting</span>'
      : watching
        ? '<span class="pill" title="Both seats were taken, so you joined as a spectator.">● watching</span>'
        : away
          ? `<span class="pill bad">● ${esc(squadLabel(away))} is away</span>`
          : v.status === 'playing'
            ? '<span class="pill live">● both seated</span>'
            : '<span class="pill">● waiting for the other player</span>'
    : '';
  // The line's own health, beside the seat pill. Quiet when there is nothing to
  // say: a round trip nobody would notice and no lost beats is not information,
  // it is noise on a bar a player reads all game.
  const h = relay.health();
  const bits: string[] = [];
  if (h.latencyMs !== null && h.latencyMs >= 250) bits.push(`${h.latencyMs}ms`);
  if (h.lossPct >= 10) bits.push(`${h.lossPct}% lost`);
  // Worth its own words rather than a number. A throttled timer means the tab
  // is in the background, which looks exactly like a dead connection from the
  // other side of the table and is the thing players most often misread.
  if (h.backgrounded) bits.push('this tab is in the background');
  if (h.queued) bits.push(`${h.queued} waiting to send`);
  const link = bits.length && v.room
    ? `<span class="pill bad" id="mc-health" title="Click to copy a connection report">${esc(bits.join(' · '))}</span>`
    : v.room
      ? `<span class="pill quiet" id="mc-health" title="Click to copy a connection report">⌁</span>`
      : '';
  return `<div class="mc-bar">
    <a class="mc-logo" href="./index.html">EMBER <em>Testing Grounds</em><small>Match Centre</small></a>
    ${v.room ? `<span class="pill code" id="mc-code" title="Copy the room code">${esc(v.room.id)}${copied ? ' ✓' : ''}</span>` : ''}
    ${conn}${link}
    <span class="spacer"></span>
    <button class="mc-account" id="mc-acct">${account ? esc(account.username) : 'Sign in'}</button>
    <a class="mc-backbtn" href="./index.html">Back to Board</a>
    ${v.room ? '<button class="mc-backbtn ghostbtn" id="mc-door" title="Leave this table and go back to the Match Centre">Match Centre</button>' : ''}
  </div>`;
}

function loginHtml(): string {
  return `<div class="mc-col" style="max-width:400px">
    <h1 class="mc-h">Sign in</h1>
    <p class="mc-sub">Online play needs an account, so a room knows who is sitting in each seat.</p>
    <div class="panel">
      <label class="f" for="mc-user">Username</label>
      <input class="f" id="mc-user" autocomplete="username" />
      <label class="f" for="mc-pass">Password</label>
      <input class="f" id="mc-pass" type="password" autocomplete="current-password" />
      ${loginErr ? `<div class="mc-err">${esc(loginErr)}</div>` : ''}
      <button class="btn wide" id="mc-login"${busy ? ' disabled' : ''}>Sign in</button>
      <p class="quiet">Accounts are invite-only. Register from the board's Multiplayer popup with the code you were given.</p>
    </div>
  </div>`;
}

function doorHtml(): string {
  return `<div class="mc-col">
    <h1 class="mc-h">Start a match</h1>
    <div class="mc-row">
      <div class="panel door">
        <h3>Host a game</h3>
        <button class="btn wide" id="mc-host"${busy ? ' disabled' : ''}>Host a game</button>
      </div>
      <div class="panel door">
        <h3>Join with a code</h3>
        <input class="f codebox" id="mc-joincode" maxlength="8" placeholder="CODE" />
        <button class="btn wide" id="mc-join"${busy ? ' disabled' : ''}>Join</button>
      </div>
    </div>
    ${doorErr ? `<div class="mc-err">${esc(doorErr)}</div>` : ''}
    ${lastRoom()
      ? `<div class="panel" style="margin-top:12px"><h3>Rejoin ${esc(lastRoom()!)}</h3>
          <p class="hint">Your seat is kept for you.</p>
          <div class="rejoinrow">
            <button class="btn wide" id="mc-rejoin" style="margin-top:0">Rejoin</button>
            <button class="btn ghost closex" id="mc-closeroom" title="Close this table for good">✕</button>
          </div></div>`
      : ''}
  </div>`;
}

function seatHtml(side: Side): string {
  const v = relay.state;
  const room = v.room!;
  const who = room.seats[side];
  const here = room.online[side];
  const mine = v.seat === side;
  if (!who) {
    return `<div class="seatcard empty">
      <div class="who"><span class="sq">${side === 's1' ? 'SQ1' : 'SQ2'}</span><i>empty seat · share the code</i></div>
    </div>`;
  }
  return `<div class="seatcard ${side}">
    <div class="who"><span class="sq">${side === 's1' ? 'SQ1' : 'SQ2'}</span>${esc(who)}${mine ? ' <i>(you)</i>' : ''}${v.host && mine ? ' <i>· host</i>' : ''}</div>
    <div class="st${here ? ' on' : ''}">${here ? '● connected' : '○ away · seat kept'}</div>
  </div>`;
}

// The lobby's battlefield preview, drawn in the board's own language: flat
// dark field, thin Large-Grid lines, terrain in the renderer's palette, the
// Main Task's zones in amber, and the printed Deployment Zones with labels —
// visible before any setup exists, because edges are decided later.
function previewSvg(mapId: string): string {
  if (!data) return '';
  const pieces = data.terrain.layouts[mapId] ?? [];
  // One shape per piece, not one per Small Grid. Drawn from the same bounding
  // box and the same fills the board itself uses, so a 3x1 wall reads as a wall
  // here rather than as three tiles that happen to be touching, and what a
  // player picks is what they get.
  const fill: Record<string, string> = {
    building: '#4b5563', high_wall: '#6b7280', low_wall: '#d1d5db', container: '#2fae6e',
  };
  const cells = pieces
    .map((p) => {
      const cols = p.subCells.map((c) => c.col);
      const rows = p.subCells.map((c) => c.row);
      const x0 = Math.min(...cols);
      const y0 = Math.min(...rows);
      const w = Math.max(...cols) - x0 + 1;
      const h = Math.max(...rows) - y0 + 1;
      return `<rect x="${x0 + 0.05}" y="${y0 + 0.05}" width="${w - 0.1}" height="${h - 0.1}" rx="${p.type === 'container' ? 0.12 : 0.08}"`
        + ` fill="${fill[p.type] ?? '#39424e'}" opacity="0.95"`
        + ` stroke="${p.blocksLos ? '#111827' : '#0006'}" stroke-width="${p.blocksLos ? 0.06 : 0.04}"/>`;
    })
    .join('');
  // Large-Grid lines every 3 cells, like the board, plus a faint fine grid.
  let lines = '';
  for (let i = 0; i <= 36; i += 3) {
    const w = i % 9 === 0 ? 0.1 : 0.06;
    lines += `<line x1="${i}" y1="0" x2="${i}" y2="36" stroke="rgba(255,255,255,.09)" stroke-width="${w}"/>`;
    lines += `<line x1="0" y1="${i}" x2="36" y2="${i}" stroke="rgba(255,255,255,.09)" stroke-width="${w}"/>`;
  }
  const zones = objectiveCells(data, state)
    .map((z) => `<rect x="${z.c}" y="${z.r}" width="1" height="1" fill="rgba(240,180,41,.18)"/>`)
    .join('');
  // The printed shape straight from the data, independent of any setup.
  const shapeId = (state.mission && data.zoneData.missionDeployment[state.mission]) || 'strips';
  const dep = printedDeployment(data, shapeId);
  const depRect = (shape: { rect?: { col: number; row: number; cols: number; rows: number }; label?: string } | undefined, light: boolean) => {
    if (!shape?.rect) return '';
    const { col, row, cols, rows } = shape.rect;
    const x = col * 3;
    const y = row * 3;
    return `<rect x="${x}" y="${y}" width="${cols * 3}" height="${rows * 3}" fill="${light ? 'rgba(238,241,245,.10)' : 'rgba(15,18,22,.45)'}" stroke="${light ? 'rgba(238,241,245,.45)' : 'rgba(120,130,145,.6)'}" stroke-width="0.12" stroke-dasharray="0.7 0.4"/>
      <text x="${x + (cols * 3) / 2}" y="${y + (rows * 3) / 2 + 0.4}" text-anchor="middle" font-size="1.1" fill="${light ? 'rgba(238,241,245,.75)' : 'rgba(160,170,185,.85)'}" font-family="var(--mono)">${esc(shape.label ?? '')}</text>`;
  };
  return `<svg class="mapsvg flatmap" viewBox="0 0 36 36" aria-hidden="true">
    <rect x="0" y="0" width="36" height="36" fill="#12161b"/>
    ${lines}${depRect(dep?.black, false)}${depRect(dep?.white, true)}${zones}${cells}</svg>`;
}

// ---------- lobby ----------

interface StepMeta {
  id: Step;
  label: string;
  sub: string;
  dot: 'done' | 'wait' | 'off';
  locked: boolean;
}

function stepMeta(): StepMeta[] {
  const v = relay.state;
  const seated = (v.room?.seats.s1 ? 1 : 0) + (v.room?.seats.s2 ? 1 : 0);
  const a = sideSummary('s1');
  const b = sideSummary('s2');
  const guest = !isHost();
  return [
    { id: 'room', label: 'Room', sub: `${seated} of 2 seated`, dot: seated === 2 ? 'done' : 'wait', locked: false },
    { id: 'battlefield', label: 'Battlefield', sub: `${mapName(state.map)} · ${missionName()}`, dot: 'done', locked: guest },
    {
      id: 'squads',
      label: 'Squads',
      sub: `${a.mechs + a.drones ? `${a.points}p` : '—'} vs ${b.mechs + b.drones ? `${b.points}p` : '—'}`,
      dot: a.mechs + a.drones && b.mechs + b.drones ? 'done' : 'wait',
      locked: false,
    },
    { id: 'rules', label: 'Rules', sub: `${state.scale ?? 'standard'} · ${state.roundLimit ?? 5} rounds`, dot: 'done', locked: guest },
  ];
}

function railHtml(): string {
  const steps = stepMeta()
    .map(
      (s) => `<div class="step${step === s.id ? ' on' : ''}${s.locked ? ' locked' : ''}" data-step="${s.id}">
        <span class="label">${s.label}${s.locked ? ' <small>host</small>' : ''}<span class="sub">${esc(s.sub)}</span></span>
        <span class="dot ${s.dot}"></span>
      </div>`,
    )
    .join('');
  // The guest is whichever seat is not mine — seats are sticky by account,
  // so the host does not always hold s1.
  const guestSeat: Side = mySeat() === 's2' ? 's1' : 's2';
  const guestReady = !!state.ready?.[guestSeat];
  const seatsFull = !!relay.state.room?.seats.s1 && !!relay.state.room?.seats.s2;
  const squadsIn = sideSummary('s1').mechs + sideSummary('s1').drones > 0
    && sideSummary('s2').mechs + sideSummary('s2').drones > 0;
  // A seat can be held by someone who has stepped away, and a Ready pressed
  // ten minutes ago is no promise they are still at the table. Starting a
  // match into an empty chair is how the first round happens without them.
  const away = (['s1', 's2'] as Side[]).find((s) => relay.state.room?.seats[s] && !relay.state.room?.online[s]);
  // The host cannot start while the guest is still reading the battlefield.
  const canLaunch = isHost() && !running() && seatsFull && squadsIn && guestReady && !away;
  const why = !seatsFull ? 'Waiting for the other player to sit down.'
    : away ? `${squadLabel(away)} is away.<br>The match waits for them.`
      : !squadsIn ? 'Both squads have to be brought in.'
        : !guestReady ? 'Waiting for the other player to press Ready.'
          : 'Both squads are in and ready.';
  const mine = mySeat();
  const iAmReady = mine ? !!state.ready?.[mine] : false;
  const foot = running()
    ? `<div class="foot"><b>Match running</b>Round ${state.round.n} · ${PHASES[state.round.phase]} Phase</div>`
    // A watcher is neither the host nor a seated guest, so without this they
    // are handed the guest's Ready button — a button for a readiness they do
    // not have and cannot give.
    : !mine
      ? `<div class="foot">
          <b>Watching</b>
          <span class="quiet">Both seats were taken when you joined, so you are here as a spectator.<br>The table will start without you when the players are ready.</span>
        </div>`
      : isHost()
      // The line above the button says what it is waiting on, and it changes
      // as the table fills. Above, because the foot is pinned to the bottom of
      // the rail: text that grows and shrinks then never moves the button.
      ? `<div class="foot">
          <span class="quiet">${esc(why)}</span>
          <button class="btn wide" id="mc-launch" style="margin-top:0"${canLaunch ? '' : ' disabled'}>Launch match</button>
        </div>`
      : `<div class="foot">
          <span class="quiet">${iAmReady ? 'Waiting for the host to launch.' : 'Ready when you have looked over the battlefield.'}</span>
          <button class="btn wide${iAmReady ? ' ghost' : ''}" id="mc-ready" style="margin-top:0">${iAmReady ? '✓ Ready (tap to undo)' : 'Ready'}</button>
        </div>`;
  return `<div class="mc-rail">
    <div class="grouphead">Match setup</div>
    ${steps}
    ${foot}
  </div>`;
}

function roomStep(): string {
  return `<div class="steppane">
    <div class="stephead"><h3>Room</h3></div>
    <div class="roomhead">
      <span class="codebig" id="mc-code2" title="Copy the room code">${esc(relay.state.room!.id)}${copied ? ' ✓' : ''}</span>
      <span class="who">Give this code to your opponent.</span>
    </div>
    ${seatHtml('s1')}
    ${seatHtml('s2')}
    <button class="btn ghost" id="mc-leave" style="margin-top:10px">Leave the table</button>
  </div>`;
}

function battlefieldStep(): string {
  const editable = isHost() && !running();
  const maps = (data?.terrain.maps ?? [])
    .map(
      (m, i) => `<div class="opt${state.map === m.id ? ' sel' : ''}${editable ? '' : ' still'}" ${editable ? `data-map="${m.id}"` : ''}>
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>${esc(m.name.en || m.id)}
      </div>`,
    )
    .join('');
  const missions = [
    `<div class="miscard${!state.mission ? ' sel' : ''}${editable ? '' : ' still'}" ${editable ? 'data-mission=""' : ''}>
      <span class="mn">No Main Task</span><span class="mf">free battle</span>
    </div>`,
    ...(data?.missions.cards ?? []).map(
      (m) => `<div class="miscard${state.mission === m.id ? ' sel' : ''}${editable ? '' : ' still'}" ${editable ? `data-mission="${m.id}"` : ''}>
        <span class="mn">${esc(m.name)}</span><span class="mf">${esc(m.family)} · ${esc(m.deployment ?? '')}</span>
      </div>`,
    ),
  ].join('');
  const chosen = state.mission ? data?.missions.cards.find((m) => m.id === state.mission) : undefined;
  const taskPanel = chosen
    ? `<div class="mispanel">
        <img src="${esc(missionImageUrl(chosen.id))}" alt="${esc(chosen.name)} card">
        <div class="mp-line"><b>Setup</b>${esc(chosen.setup ?? '')}</div>
        <div class="mp-line"><b>Scoring</b>${esc(chosen.scoring ?? '')}</div>
        <div class="mp-line"><b>VP</b>${esc(String(chosen.vp ?? ''))}${chosen.cadence ? ` · ${esc(chosen.cadence)}` : ''}${chosen.fromRound ? ` · from round ${chosen.fromRound}` : ''}</div>
      </div>`
    : `<div class="mispanel empty"><p class="quiet">Pick a Main Task to read its card here.<br>A free battle plays without one.</p></div>`;
  return `<div class="steppane">
    <div class="stephead"><h3>Battlefield</h3></div>
    ${editable ? '' : `<p class="hint">${running() ? 'Locked while the game runs.' : 'Host only.'}</p>`}
    <div class="pickgrid three">
      <div class="mappanel">
        <div class="previewhead"><span class="t">Preview</span><span class="n">${esc(mapName(state.map))}</span></div>
        ${previewSvg(state.map)}
      </div>
      ${taskPanel}
      <div class="maplist">${maps}
        <p class="quiet">Custom maps stay on the board page. A guest may not have them.</p>
      </div>
    </div>
    <div class="missionrow">${missions}</div>
  </div>`;
}

function squadsStep(): string {
  const rows = (['s1', 's2'] as Side[])
    .map((side) => {
      const v = relay.state;
      const who = v.room?.seats[side];
      const mine = v.seat === side;
      const s = sideSummary(side);
      const has = s.mechs + s.drones > 0;
      const named = state.sideNames?.[side];
      // The units actually standing on your side, each removable. Bringing the
      // same list twice is easy to do by accident, and before this there was no
      // way to take one back off without leaving the table.
      const roster = mine && has && !running()
        ? `<div class="roster">${state.tokens
            .filter((t) => t.side === side && t.kind !== 'projectile')
            .map((t) => `<div class="rosterrow"><span class="rn">${esc(t.label)}</span>
              <span class="rk">${t.kind}</span>
              <button class="rx" data-drop="${t.uid}" title="Take ${esc(t.label)} back off">✕</button></div>`)
            .join('')}</div>`
        : '';
      return `<div class="seatcard ${side}">
        <div class="who"><span class="sq">${side === 's1' ? 'SQ1' : 'SQ2'}</span>${who ? esc(who) : '<i>empty seat</i>'}${mine ? ' <i>(you)</i>' : ''}</div>
        <div class="st${has ? ' on' : ''}">${has
          ? `✓ ${named ? `${esc(named)} · ` : ''}${s.mechs} mech${s.mechs === 1 ? '' : 's'}, ${s.drones} drone${s.drones === 1 ? '' : 's'} · ${s.points} points`
          : mine ? 'no squad yet' : 'no squad yet · waiting on them'}</div>
        ${roster}
        ${mine && !running() ? `<button class="btn${has ? ' ghost' : ''}" id="mc-bring" style="margin-top:9px">${has ? 'Add another unit' : 'Bring a squad'}</button>` : ''}
        ${mine && !running() ? tacticsPicker(side) : ''}
      </div>`;
    })
    .join('');
  return `<div class="steppane">
    <div class="stephead"><h3>Squads</h3></div>
    ${rows}
    <p class="quiet">Add as many as you like, and take any back off with ✕ before the match starts.</p>
  </div>`;
}

function rulesStep(): string {
  const editable = isHost() && !running();
  const scales = (['skirmish', 'standard', 'large'] as const)
    .map(
      (s) => `<span class="chip${(state.scale ?? 'standard') === s ? ' sel' : ''}${editable ? '' : ' still'}" ${editable ? `data-scale="${s}"` : ''}>${s[0].toUpperCase()}${s.slice(1)}</span>`,
    )
    .join('');
  const rounds = [3, 4, 5, 6, 8]
    .map(
      (n) => `<span class="chip${(state.roundLimit ?? 5) === n ? ' sel' : ''}${editable ? '' : ' still'}" ${editable ? `data-rounds="${n}"` : ''}>${n} rounds</span>`,
    )
    .join('');
  return `<div class="steppane">
    <div class="stephead"><h3>Rules</h3></div>
    ${editable ? '' : '<p class="hint">Host only.</p>'}
    <div class="sect2">Battle scale</div>
    <div class="missionrow" style="margin-top:6px">${scales}</div>
    <div class="sect2" style="margin-top:14px">Game length</div>
    <div class="missionrow" style="margin-top:6px">${rounds}</div>
    <p class="quiet">Scale caps squad points: 600 / 900 / 1200+.</p>
  </div>`;
}

// The finished game, kept on the account that reports it. Both players may
// record the same match; the server files each report against its reporter,
// which is why the seat travels with it.
async function recordMatch(): Promise<string | null> {
  if (!data) return 'Still loading.';
  if (!account) return 'Sign in to keep a record.';
  const tasks = normaliseTasks(state.tasks);
  const vp = tasks.vp;
  // The same verdict the panel shows, tiebreak and all (5.2.4). Recording a
  // draw where the board settled it would put the wrong result on both accounts.
  const winner = gameResult(tasks, state.tokens).winner;
  const entries = (side: Side) => {
    const out: { id: string; cat: SquadEntry['cat'] }[] = [];
    for (const t of state.tokens) {
      if (t.side !== side || t.kind === 'projectile') continue;
      for (const { card } of tokenCards(data!, t)) {
        out.push({ id: card.id, cat: (card.category ?? 'mech_part') as SquadEntry['cat'] });
      }
    }
    for (const id of state.tactics?.[side] ?? []) if (data!.byId.get(id)) out.push({ id, cat: 'tactics_or_upgrade' });
    // The server caps a squad at 80 entries; no real list comes close.
    return out.slice(0, 80);
  };
  try {
    await api.recordGame({
      mode: 'online',
      mission: state.mission ?? null,
      scale: state.scale ?? null,
      rounds: Math.max(1, Math.min(20, state.round.n)),
      winnerSeat: winner,
      mySeat: mySeat(),
      players: (['s1', 's2'] as Side[]).map((side) => ({
        seat: side,
        faction: squadAllegiance(data!, state.tokens.filter((t) => t.side === side)).faction,
        vp: Math.max(0, vp[side]),
        squad: entries(side),
      })),
    });
    record = await api.myRecord().catch(() => record);
    return null;
  } catch (err) {
    return `${(err as ApiError).message} The game itself is unaffected.`;
  }
}

function hudCtx(): HudCtx {
  return {
    data: data!,
    state,
    // In the dev harness there is no room, so no seat: every control renders
    // as yours, which is exactly what walking both sides solo needs.
    seat: relay.state.seat,
    networked: !!relay.state.room,
    send,
    check: (cmd) => (data ? check(data, state, cmd) : { ok: false, why: 'Still loading.' }),
    rollHits,
    rollPool,
    rollDefense: rollDefensePool,
    diceFeed,
    note: lobbyNote,
    noteNow: (text) => { lobbyNote = text; },
    zonesOn: zonesVisible,
    toggleZones: () => {
      zonesVisible = !zonesVisible;
      render();
    },
    mountSide,
    syncSide,
    combatBusy,
    combatMirrorHtml,
    mirrorFocus: mirrorFocusAct,
    startAttack,
    showTab: (name) => showSideTab(null, name),
    diceData,
    recordMatch,
    refresh: () => render(),
  };
}

// ---------- the defender's combat mirror ----------
//
// The attack runs on the attacker's client; this draws what their window
// published so the other player watches the same fight — the part chosen, the
// faces as they land, the narration — instead of a dice feed in the corner.
// Read-only except for the one thing that IS the defender's: their roll.

function faceRow(faces: { color: string; face: number }[]): string {
  if (!diceData) return '';
  return `<div class="ah-roll">${faces.map((f) => {
    const def = diceData!.dice[f.color as DieColor];
    const icons = def?.faces[f.face] ?? [];
    return `<span class="die die-${f.color}">${icons.length ? icons.map((ic) => iconSvg(ic)).join('') : '<span class="blank">·</span>'}</span>`;
  }).join('')}</div>`;
}

function combatMirrorHtml(): string | null {
  const view = state.script?.combatView;
  // The attacker's own window outranks the mirror — this is for everyone else.
  if (!view || combatBusy()) return null;
  const at = state.tokens.find((t) => t.uid === view.attackerUid);
  const df = state.tokens.find((t) => t.uid === view.targetUid);
  const action = at ? tokenCards(data!, at).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === view.actionId) : undefined;
  const name = action?.name?.en || view.actionId;
  const modeNote = view.mode === 'intercept' ? 'Interception (4.9)' : view.mode === 'explosion' ? 'Explosion damage (4.7.6)' : '';
  const call = state.script?.combat;
  const myRoll = call && !call.faces && df && mySeat() === df.side
    ? `<div class="ah-step"><p>Your defence: <b>${call.white} White${call.blue ? ` + ${call.blue} Blue` : ''}</b>. Both players see the dice land.</p>
       <button class="ah-primary" data-act="rolldefense">🎲 Roll ${call.white} White${call.blue ? ` + ${call.blue} Blue` : ''}</button></div>`
    : '';
  // The defending player's half of Focus (4.4.1-5), asked here because the
  // attacker's window is on the other screen. The declare is two buttons; the
  // reroll renders THEIR defense dice as toggles and rolls server faces for
  // whatever is picked.
  const iAmDefender = !!df && mySeat() === df.side;
  // KC Armor (4.10): offered to the defending player while their Defense Roll
  // shows Lightning, until they take it or the attack resolves.
  const kcReady = iAmDefender && df && !view.kcUsed && df.kind === 'mech' ? kcArmorReady(data!, df) : null;
  const kcLightning = view.defense?.filter((f) => (diceData!.dice[f.color as DieColor]?.faces[f.face] ?? []).some((ic) => ic.type === 'lightning')).length ?? 0;
  const kcUi = kcReady && kcLightning > 0
    ? `<div class="ah-step"><button class="ah-alt" data-act="kcarmor">KC Armor: consume a Charge Token — your [Lightning] become [Defense]</button></div>`
    : '';
  const focus = view.focus;
  let focusUi = '';
  if (focus && iAmDefender && focus.stage === 'declareD') {
    focusUi = `<div class="ah-step"><p><b>Focus (4.4.1-5)</b>: you may spend 1 Link (${df.link ?? 0} left) to reroll any of your Defense dice.</p>
      <button class="ah-primary" data-act="focususe">Focus — spend 1 Link</button>
      <button class="ah-alt" data-act="focuspass">Pass</button></div>`;
  } else if (focus && iAmDefender && focus.stage === 'rerollD' && focus.defenderUse && view.defense?.length) {
    focusUi = `<div class="ah-step"><p>Pick the Defense dice to reroll, then roll. The Link is already spent.</p>
      <div class="ah-roll">${view.defense.map((f, i) => {
        const dieDef = diceData!.dice[f.color as DieColor];
        const icons = dieDef?.faces[f.face] ?? [];
        return `<button class="die die-${f.color}${mirrorFocusSel.has(i) ? ' sel' : ''}" data-fdie="${i}">${icons.length ? icons.map((ic) => iconSvg(ic)).join('') : '<span class="blank">·</span>'}</button>`;
      }).join('')}</div>
      <button class="ah-primary" data-act="focusreroll"${mirrorFocusSel.size ? '' : ' disabled'}>🎲 Reroll ${mirrorFocusSel.size || 'the selected'} ${mirrorFocusSel.size === 1 ? 'die' : 'dice'}</button>
      <button class="ah-alt" data-act="focuskeep">Keep the roll</button></div>`;
  }
  return `<div class="attack-helper">
    <div class="ah-head"><b>${esc(at?.label ?? '?')}</b> → <b>${esc(df?.label ?? '?')}</b>
      <span class="dim">${esc(name)}${modeNote ? ` · ${esc(modeNote)}` : ''}</span></div>
    <p class="ah-los dim">${esc(at?.label ?? 'The attacker')}'s player is resolving this attack. You are seeing their combat window.</p>
    ${view.targetPart ? `<div class="ah-step"><p>Target Part: <b>${esc(SLOT_LABEL[view.targetPart as keyof typeof SLOT_LABEL] ?? view.targetPart)}</b></p></div>` : ''}
    ${view.attack?.length ? `<div class="ah-step"><p>Attack Roll</p>${faceRow(view.attack)}</div>` : ''}
    ${myRoll}
    ${view.defense?.length ? `<div class="ah-step"><p>Defense Roll</p>${faceRow(view.defense)}</div>` : ''}
    ${kcUi}
    ${focusUi}
    ${view.log.length ? `<div class="ah-log">${view.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
  </div>`;
}

// Which Defense dice the mirror's Focus reroll has picked, by index into the
// published view. Cleared whenever the flow moves on.
const mirrorFocusSel = new Set<number>();

// The mirror's Focus buttons, handled here because this page owns the seat,
// the server dice and the send. Reads the CURRENT view at click time; reached
// from the HUD through ctx.mirrorFocus.
function mirrorFocusAct(act: string, dieIndex?: number): void {
  const seat = mySeat();
  const view = state.script?.combatView;
  const df = view ? state.tokens.find((t) => t.uid === view.targetUid) : undefined;
  if (!seat || !view || !df || df.side !== seat) return;
  if (act === 'die' && dieIndex !== undefined) {
    if (mirrorFocusSel.has(dieIndex)) mirrorFocusSel.delete(dieIndex);
    else mirrorFocusSel.add(dieIndex);
    render();
    return;
  }
  if (act === 'kc') {
    // The Charge spend travels as an ordinary setCharge; the kcArmor command
    // only tells the attacker's window the trade was declared.
    const kc = df.kind === 'mech' ? kcArmorReady(data!, df) : null;
    if (!kc) return;
    send({ kind: 'setCharge', seat, uid: df.uid, slot: kc.slot, on: false });
    send({ kind: 'kcArmor', seat });
    render();
    return;
  }
  if (act === 'use') {
    send({ kind: 'focus', seat, uid: df.uid });
    send({ kind: 'focusAnswer', seat, use: true });
    mirrorFocusSel.clear();
    render();
    return;
  }
  if (act === 'pass') {
    send({ kind: 'focusAnswer', seat, use: false });
    mirrorFocusSel.clear();
    render();
    return;
  }
  if (act === 'keep') {
    send({ kind: 'focusReroll', seat, indices: [], faces: [] });
    mirrorFocusSel.clear();
    render();
    return;
  }
  if (act === 'reroll') {
    const defense = view.defense ?? [];
    const indices = [...mirrorFocusSel].filter((i) => defense[i]).sort((a, b) => a - b);
    if (!indices.length) return;
    const white = indices.filter((i) => defense[i].color === 'white').length;
    const blue = indices.filter((i) => defense[i].color === 'blue').length;
    mirrorFocusSel.clear();
    void rollDefensePool(white, blue).then((faces) => {
      // Server faces come back grouped by colour; hand them back to the
      // chosen dice colour-by-colour so every index gets a face of its own
      // die's colour.
      const byColor: Record<string, { color: string; face: number }[]> = {};
      for (const f of faces) (byColor[f.color] ??= []).push({ color: f.color, face: f.face });
      const out = indices.map((i) => byColor[defense[i].color]?.shift() ?? { color: defense[i].color, face: 0 });
      send({ kind: 'focusReroll', seat, indices, faces: out });
      render();
    });
  }
}

// A tiny dev harness behind ?dev=1: seeds two demo squads and starts, so the
// HUD can be walked solo while it is being built.
function devPane(): string {
  return `<div class="mc-col" style="max-width:420px">
    <h1 class="mc-h">HUD dev harness</h1>
    <p class="mc-sub">No room. This walks the in-match HUD locally.</p>
    <div class="panel"><button class="btn wide" id="mc-devseed" style="margin-top:0">Seed two demo squads and start</button></div>
  </div>`;
}

function devSeed(): void {
  if (!data) return;
  const first = (ty: string) => data!.cards.find((c) => c.type === ty)?.id ?? '';
  const pilot = data!.cards.find((c) => c.category === 'pilot' && typeof c.LV === 'number')?.id ?? '';
  const drone = data!.cards.find((c) => c.category === 'drone')?.id ?? '';
  for (const side of ['s1', 's2'] as Side[]) {
    send({
      kind: 'importSquad', seat: side, name: 'Demo',
      // The GLP-15 rides along so the Auto Mine Laying offer is walkable in
      // the harness — it is the one flow a demo squad could never reach.
      mechs: [{ loadout: { torso: first('torso'), chasis: first('chasis'), rightHand: first('rightHand'), backpack: '006', pilot } }],
      drones: drone ? [{ cardId: drone }] : [],
    });
  }
  // A Tactics Card each, so the timing strip has something to remind about.
  state.tactics = { s1: ['274', '275'], s2: ['276'] };
  send({ kind: 'startMatch', seat: devSeat ?? 's1' });
  send({ kind: 'lockMap', seat: devSeat ?? 's1' });
  render();
}

function lobbyHtml(): string {
  const pane = step === 'room' ? roomStep()
    : step === 'battlefield' ? battlefieldStep()
      : step === 'squads' ? squadsStep()
        : rulesStep();
  return `<div class="mc-lobby">
    ${railHtml()}
    <div class="mc-stagepane">
      ${lobbyNote ? `<div class="mc-err" style="margin:0 0 12px">${esc(lobbyNote)}</div>` : ''}
      ${pane}
    </div>
  </div>`;
}

// ---------- the squad picker ----------

// Whatever squads stand on the freeplay board right now, readable because the
// two pages share an origin. Testing a list there and bringing it here should
// not require a save first.
function boardSquads(): { key: Side; label: string; mechs: SavedSquad['mechs']; drones: SavedSquad['drones']; tactics: string[] }[] {
  try {
    const raw = localStorage.getItem('ember-testing-grounds-v1');
    if (!raw) return [];
    const board = JSON.parse(raw) as GameState;
    return (['s1', 's2'] as Side[])
      .map((side) => {
        const units = (board.tokens ?? []).filter((t) => t.side === side && t.kind !== 'projectile' && t.parentUid === undefined);
        const mechs = units.filter((t) => t.kind === 'mech' && (t.mech?.torso || t.mech?.chasis)).map((t) => ({ name: t.label, loadout: { ...t.mech } }));
        const drones = units.filter((t) => t.kind === 'drone').map((t) => ({ cardId: t.cardId, backpack: t.droneBackpack }));
        // A Tactics Card is never a token, so it has to be read off the board
        // separately — otherwise a squad brought over arrives without the hand
        // it was built with.
        const tactics = (board.tactics?.[side] ?? []).filter((id) => !!data?.byId.get(id));
        return { key: side, label: `${board.sideNames?.[side] ?? squadLabel(side)} (freeplay board)`, mechs, drones, tactics };
      })
      .filter((s) => s.mechs.length + s.drones.length > 0);
  } catch {
    return [];
  }
}

// What a list actually holds, so two entries with the same units read as the
// same units. A squad saved from the freeplay board and the board itself are
// the usual pair, and without this they look like unrelated choices.
function squadContents(mechs: SavedSquad['mechs'], drones: SavedSquad['drones']): string {
  const names = [
    ...mechs.map((m) => m.name || (m.loadout.torso && data?.byId.get(m.loadout.torso)?.name?.en) || 'Mech'),
    ...drones.map((d) => data?.byId.get(d.cardId)?.name?.en || d.cardId),
  ];
  if (!names.length) return '';
  const shown = names.slice(0, 4).join(', ');
  return `<span class="pickwhat">${esc(shown)}${names.length > 4 ? ` +${names.length - 4} more` : ''}</span>`;
}

function pickerHtml(): string {
  const section = (title: string, rows: string) => (rows ? `<div class="picksect">${title}</div>${rows}` : '');
  const fromBoard = boardSquads()
    .map(
      (s) => `<button class="pickrow" data-boardsquad="${s.key}">
        <span class="nm">${esc(s.label)}</span>
        <span class="ct">${s.mechs.length}M ${s.drones.length}D${s.tactics.length ? ` ${s.tactics.length}T` : ''}</span>
        ${squadContents(s.mechs, s.drones)}
      </button>`,
    )
    .join('');
  const savedSquads = loadSquads()
    .map(
      (s) => `<button class="pickrow" data-squad="${esc(s.id)}">
        <span class="nm">${esc(s.name)}</span>
        <span class="ct">${s.mechs.length}M ${s.drones.length}D${s.tactics?.length ? ` ${s.tactics.length}T` : ''}</span>
        ${squadContents(s.mechs, s.drones)}
      </button>`,
    )
    .join('');
  // A single saved Mech, for topping a squad up rather than bringing a whole
  // second one.
  const savedMechs = loadMechPresets()
    .map((p) => {
      const torso = p.mech.torso ? data?.byId.get(p.mech.torso)?.name?.en : undefined;
      return `<button class="pickrow" data-mechpreset="${esc(p.id)}">
        <span class="nm">${esc(p.name)}</span>
        <span class="ct">1M</span>
        ${torso ? `<span class="pickwhat">${esc(torso)}</span>` : ''}
      </button>`;
    })
    .join('');
  const any = fromBoard || savedSquads || savedMechs;
  return `<div class="mc-veil" id="mc-veil2">
    <div class="acct">
      <button class="x" id="mc-picker-x">✕</button>
      <h3>Bring a squad or a mech</h3>
      <div class="role">Whatever you pick joins your side on both screens and waits for deployment. Pick again to add more.</div>
      ${section('On the freeplay board', fromBoard)}
      ${section('Saved squads', savedSquads)}
      ${section('Saved mechs', savedMechs)}
      ${any ? '' : '<p class="hint">Nothing saved on this device yet.<br>Import a squad file below and it is kept here.</p>'}
      <button class="btn ghost wide" id="mc-file" style="margin-top:10px">From a squad file…</button>
      <input type="file" id="mc-fileinput" accept=".json,.png" hidden />
    </div>
  </div>`;
}

function bringSquad(name: string, mechs: SavedSquad['mechs'], drones: SavedSquad['drones'], tactics?: string[]): void {
  const seat = mySeat();
  if (!seat || !data) return;
  lobbyNote = null;
  const v = perform(data, state, { kind: 'importSquad', seat, name, mechs, drones });
  if (v.ok) {
    // A hand brought with the squad adds to whatever is already held, the same
    // way topping up with another list adds units rather than replacing them.
    // Merged through a Set: a second list carrying a card already held would
    // otherwise build a duplicate hand, which check() refuses whole (FAQ P2).
    if (tactics?.length) {
      const merged = [...new Set([...(state.tactics?.[seat] ?? []), ...tactics])];
      perform(data, state, { kind: 'setTactics', seat, cards: merged });
    }
    pickerOpen = false;
    relay.publishCheckpoint();
  }
  render();
}

// ---------- render ----------

function render(): void {
  // A closed combat window takes the published mirror down with it, whatever
  // way it closed — the sweep sees the helper idle and sends the null.
  sweepCombatView();
  const hud = !!data && ((running() && !!relay.state.room) || (!!devSeat && running()));
  // Three fixed hosts, so the stateful board survives every re-render: the
  // bar and veils redraw freely, the body only redraws outside HUD mode.
  if (!document.getElementById('mc-barhost')) {
    root.innerHTML = '<div id="mc-barhost"></div><div id="mc-bodyhost"></div><div id="mc-veilhost"></div>';
  }
  const barhost = document.getElementById('mc-barhost')!;
  const bodyhost = document.getElementById('mc-bodyhost')!;
  const veilhost = document.getElementById('mc-veilhost')!;
  // The height chain only clamps in HUD mode; the lobby and door scroll.
  root.classList.toggle('hudmode', hud);
  barhost.innerHTML = barHtml();
  const p = hud ? paused() : null;
  const pauseVeil = p
    ? `<div class="mc-veil pauseveil"><div class="acct" style="text-align:center">
        <div class="waitbox"><div class="spin">◐</div>
        <div class="msg">Match paused</div>
        <div class="sub">${esc(squadLabel(p.side))}'s player ${p.gone ? 'left the table' : 'lost their connection'}.<br>Everything waits until they return.<br>Their seat is kept.</div></div>
        <button class="btn ghost" id="mc-leave" style="margin-top:6px">Leave the table</button>
      </div></div>`
    : '';
  veilhost.innerHTML = `${acctOpen ? acctHtml() : ''}${pickerOpen ? pickerHtml() : ''}${pauseVeil}`;
  if (hud) {
    const stage = bodyhost.querySelector('.mc-stage.hudmode');
    let host = stage as HTMLElement | null;
    if (!host) {
      bodyhost.innerHTML = '<div class="mc-stage wide hudmode"></div>';
      host = bodyhost.querySelector('.mc-stage') as HTMLElement;
    }
    ensureHud(host, hudCtx());
  } else {
    const inner = !data
      ? `<div class="mc-col" style="max-width:400px"><p class="mc-sub">Loading the card database…</p></div>`
      : devSeat
        ? devPane()
        : !account
          ? loginHtml()
          : relay.state.room
            ? lobbyHtml()
            : doorHtml();
    const wide = data && account && relay.state.room;
    bodyhost.innerHTML = `<div class="mc-stage${wide ? ' wide' : ''}">${inner}</div>`;
  }
  wire();
}

function acctHtml(): string {
  if (!account) return '';
  const r = record?.record;
  return `<div class="mc-veil" id="mc-veil">
    <div class="acct">
      <button class="x" id="mc-acct-x">✕</button>
      <h3>${esc(account.username)}</h3>
      <div class="role">${esc(account.role)}${account.displayName ? ` · ${esc(account.displayName)}` : ''}</div>
      <div class="sect">Record</div>
      ${r
        ? `<div class="rec">
            <div><b>${r.played}</b><span>played</span></div>
            <div><b>${r.won}</b><span>won</span></div>
            <div><b>${r.drawn}</b><span>drawn</span></div>
            <div><b>${r.lost}</b><span>lost</span></div>
          </div>`
        : '<p class="hint">Loading the record…</p>'}
      <div class="sect">Change password</div>
      <label class="f" for="mc-cur">Current password</label>
      <input class="f" id="mc-cur" type="password" autocomplete="current-password" />
      <label class="f" for="mc-new">New password</label>
      <input class="f" id="mc-new" type="password" autocomplete="new-password" />
      ${acctNote ? `<div class="${acctNote.ok ? 'mc-ok' : 'mc-err'}">${esc(acctNote.text)}</div>` : ''}
      <div class="row2">
        <button class="btn" id="mc-change"${busy ? ' disabled' : ''}>Change password</button>
        <button class="btn danger" id="mc-out">Sign out</button>
      </div>
    </div>
  </div>`;
}

async function attempt(fn: () => Promise<void>, showErr: (m: string) => void): Promise<void> {
  if (busy) return;
  busy = true;
  render();
  try {
    await fn();
  } catch (e) {
    showErr(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
  } finally {
    busy = false;
    render();
  }
}

// A connection report on the clipboard, ready to paste into a bug report.
//
// Every desync we have ever been told about arrived as "the boards disagreed",
// with nothing attached and nothing anyone could reconstruct afterwards. This
// is the wire's side of that: what the room was, what the link was doing, and
// every connect, close and reconnect leading up to it. The board is not in it —
// that is a checkpoint away on the server, and a player pasting this into
// Discord should not be pasting their whole position with it.
function copyDiagnostics(): void {
  const report = JSON.stringify(relay.diagnostics(), null, 2);
  void navigator.clipboard?.writeText(report).then(() => {
    lobbyNote = 'Connection report copied. Paste it wherever you are reporting this.';
    render();
  });
}

function copyCode(): void {
  const room = relay.state.room;
  if (!room) return;
  void navigator.clipboard?.writeText(room.id).then(() => {
    copied = true;
    render();
    setTimeout(() => {
      copied = false;
      render();
    }, 1500);
  });
}

function wire(): void {
  const $ = (id: string) => document.getElementById(id);
  $('mc-acct')?.addEventListener('click', () => {
    if (!account) return;
    acctOpen = true;
    acctNote = null;
    render();
    if (!record) void api.myRecord().then((r) => { record = r; render(); }).catch(() => {});
  });
  $('mc-acct-x')?.addEventListener('click', () => { acctOpen = false; render(); });
  $('mc-veil')?.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).id === 'mc-veil') { acctOpen = false; render(); }
  });
  $('mc-picker-x')?.addEventListener('click', () => { pickerOpen = false; render(); });
  $('mc-veil2')?.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).id === 'mc-veil2') { pickerOpen = false; render(); }
  });
  $('mc-code')?.addEventListener('click', copyCode);
  $('mc-code2')?.addEventListener('click', copyCode);
  $('mc-health')?.addEventListener('click', copyDiagnostics);

  $('mc-login')?.addEventListener('click', () => {
    const user = ($('mc-user') as HTMLInputElement | null)?.value.trim() ?? '';
    const pass = ($('mc-pass') as HTMLInputElement | null)?.value ?? '';
    loginErr = null;
    void attempt(async () => {
      account = await api.login(user, pass);
    }, (m) => { loginErr = m; });
  });
  $('mc-pass')?.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') $('mc-login')?.click();
  });

  $('mc-host')?.addEventListener('click', () => {
    doorErr = null;
    relay.host();
  });
  $('mc-rejoin')?.addEventListener('click', () => {
    const code = lastRoom();
    doorErr = null;
    if (code) relay.join(code);
  });
  // Closing a table you are not sitting at means sitting down first: the room
  // is closed over the same socket that plays in it.
  $('mc-closeroom')?.addEventListener('click', () => {
    const code = localStorage.getItem('ember-last-room');
    if (!code) return;
    doorErr = null;
    closeOnArrival = true;
    relay.join(code);
    render();
  });
  $('mc-door')?.addEventListener('click', () => {
    relay.leave();
    step = 'room';
    render();
  });
  $('mc-join')?.addEventListener('click', () => {
    const code = ($('mc-joincode') as HTMLInputElement | null)?.value.trim() ?? '';
    doorErr = code ? null : 'Enter the room code you were given.';
    if (code) relay.join(code);
    else render();
  });
  $('mc-joincode')?.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') $('mc-join')?.click();
  });
  $('mc-leave')?.addEventListener('click', () => {
    localStorage.removeItem('ember-last-room');
    relay.leave();
  });

  // The lobby rail and steps.
  for (const el of root.querySelectorAll<HTMLElement>('[data-step]')) {
    el.addEventListener('click', () => {
      step = el.dataset.step as Step;
      lobbyNote = null;
      render();
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-map]')) {
    el.addEventListener('click', () => {
      if (data) perform(data, state, { kind: 'configureTable', seat: mySeat() ?? 's1', map: el.dataset.map! });
      render();
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-mission]')) {
    el.addEventListener('click', () => {
      if (!data) return;
      const id = el.dataset.mission!;
      const m = id ? data.missions.cards.find((x) => x.id === id) : undefined;
      perform(data, state, {
        kind: 'configureTable', seat: mySeat() ?? 's1',
        mission: m ? m.id : null,
        tasks: m ? taskItemsFor(data.zoneData.zones, m) : null,
        zoneSet: m ? `mission:${m.id}` : '',
      });
      render();
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-scale]')) {
    el.addEventListener('click', () => {
      if (data) perform(data, state, { kind: 'configureTable', seat: mySeat() ?? 's1', scale: el.dataset.scale as GameState['scale'] });
      render();
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-rounds]')) {
    el.addEventListener('click', () => {
      if (data) perform(data, state, { kind: 'configureTable', seat: mySeat() ?? 's1', roundLimit: Number(el.dataset.rounds) });
      render();
    });
  }
  $('mc-launch')?.addEventListener('click', () => {
    if (!data) return;
    lobbyNote = null;
    // Only lock the battlefield if the match actually started. The refusal
    // that stops one player launching without the other must stop the whole
    // launch, not just its first half.
    if (send({ kind: 'startMatch', seat: mySeat() ?? 's1' }).ok) {
      // The battlefield was chosen in the lobby, so the separate lock step
      // (3.1.2) is already answered — go straight to the First Player roll.
      send({ kind: 'lockMap', seat: mySeat() ?? 's1' });
    }
    render();
  });
  $('mc-devseed')?.addEventListener('click', () => devSeed());
  $('mc-ready')?.addEventListener('click', () => {
    const seat = mySeat();
    if (!seat) return;
    send({ kind: 'setReady', seat, ready: !state.ready?.[seat] });
    render();
  });

  $('mc-bring')?.addEventListener('click', () => {
    pickerOpen = true;
    render();
  });
  for (const el of root.querySelectorAll<HTMLElement>('[data-squad]')) {
    el.addEventListener('click', () => {
      const sq = loadSquads().find((s) => s.id === el.dataset.squad);
      if (sq) bringSquad(sq.name, sq.mechs, sq.drones, sq.tactics);
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-boardsquad]')) {
    el.addEventListener('click', () => {
      const sq = boardSquads().find((s) => s.key === el.dataset.boardsquad);
      if (sq) bringSquad(sq.label.replace(' (freeplay board)', ''), sq.mechs, sq.drones, sq.tactics);
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-mechpreset]')) {
    el.addEventListener('click', () => {
      const p = loadMechPresets().find((x) => x.id === el.dataset.mechpreset);
      if (p) bringSquad(p.name, [{ name: p.name, loadout: p.mech }], []);
    });
  }
  // Taking a unit back off before the match starts. The command layer already
  // does this for a wreck mid-game; here it is the undo for bringing the wrong
  // list, or the same one twice.
  for (const el of root.querySelectorAll<HTMLElement>('[data-drop]')) {
    el.addEventListener('click', () => {
      const uid = Number(el.dataset.drop);
      const t = state.tokens.find((x) => x.uid === uid);
      if (!t) return;
      send({ kind: 'despawn', seat: t.side, uid, targetUid: uid });
      // The hand belongs to the squad, and with no picker here there is no
      // other way to put a mistaken one back. Dropping the LAST unit reads as
      // swapping squads, so the Tactics Cards leave with it; dropping one
      // unit of several does not touch the hand.
      const seat = mySeat();
      if (seat && t.side === seat
        && !state.tokens.some((x) => x.side === seat)
        && (state.tactics?.[seat] ?? []).length) {
        send({ kind: 'setTactics', seat, cards: [] });
      }
      relay.publishCheckpoint();
      render();
    });
  }
  $('mc-tactoggle')?.addEventListener('click', () => { tacticsOpen = !tacticsOpen; render(); });
  $('mc-file')?.addEventListener('click', () => $('mc-fileinput')?.click());
  $('mc-fileinput')?.addEventListener('change', () => {
    const input = $('mc-fileinput') as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !data) return;
    void importSquadFile(file, data.byId)
      .then((squad) => {
        saveSquad(squad.name, squad.mechs, squad.drones, Date.now(), squad.tactics);
        bringSquad(squad.name, squad.mechs, squad.drones, squad.tactics);
      })
      .catch((e: Error) => {
        lobbyNote = `Squad import failed: ${e.message}`;
        render();
      })
      .finally(() => {
        input.value = '';
      });
  });

  $('mc-change')?.addEventListener('click', () => {
    const cur = ($('mc-cur') as HTMLInputElement | null)?.value ?? '';
    const next = ($('mc-new') as HTMLInputElement | null)?.value ?? '';
    acctNote = null;
    void attempt(async () => {
      await api.changePassword(cur, next);
      acctNote = { ok: true, text: 'Password changed. Other sessions are signed out.' };
    }, (m) => { acctNote = { ok: false, text: m }; });
  });
  $('mc-out')?.addEventListener('click', () => {
    void attempt(async () => {
      relay.leave();
      await api.logout();
      account = null;
      record = null;
      acctOpen = false;
    }, (m) => { acctNote = { ok: false, text: m }; });
  });
}

// The dial lock lives here rather than in the HUD module, because this page
// owns the salt and the relay.
root.addEventListener('mc-lockdials', () => {
  if (relay.state.room) lockDialsNetworked();
  render();
});

// ---------- boot ----------

render();
void (async () => {
  const [d, user, dice] = await Promise.all([
    loadData(),
    api.refresh(),
    fetch(dataUrl('dice.json')).then((r) => r.json() as Promise<DiceData>).catch(() => null),
  ]);
  data = d;
  account = user;
  diceData = dice;
  // The squad list and the card panel already tag their rows with
  // `data-tip-card`; this is the delegated listener that turns those into the
  // hover previews the freeplay board has. Nothing else was missing.
  installTooltip();
  preloadCards(d.cards.map((c) => c.id));
  // This page never warmed the full art set at all, so every card scan it
  // showed was fetched cold the first time a player hovered it.
  void runFirstVisitPreload().then(() => warmAllImagesWhenIdle());
  render();
})();

// The pad — a phone-first record sheet for a live, in-person table.
//
// ONE SCREEN AT THE TABLE. The 2026-09-06 study found the old pad was a hub
// with spokes: a room screen with three buttons, and Sheet, Tasks and Add
// squad each ending in Back. This version has no hub. Once a table is open
// the phone shows the table bar (round, both scores, who is here), one strip
// of units for whichever squad the dock points at, and that unit's sheet - and
// a fixed five-item dock along the bottom: Yours, Theirs, Tasks, Find, More.
// Tasks, Find and More are panels that slide OVER the sheet and close back
// onto it; nothing on this page is a page you have to come back from.
//
// WHAT THIS PAGE DELIBERATELY DOES NOT DO: import match.ts. That module has no
// exports and runs side effects the moment it loads - it grabs #mc, builds a
// Relay, a HUD and a board, and boots the whole card database.
//
// It DOES reuse EmberApi and Relay verbatim: both are DOM-free, and the session
// cookie is set on the apex domain at path '/', so a player already signed in
// on the board is already signed in here.
//
// AND IT DRAWS EVERY CARD WITH THE REFERENCE'S OWN RENDERERS. The detail sheet
// here is the reference page's #ref-detail, markup and stylesheet both; the
// tiles in Find are the reference's cardRow tiles; a Part's actions open on
// the sheet through the same actionBlock the reference prints. Nothing on the
// pad restyles a card. If a card looks different here, the bug is here.
import './pad.css';
// The reference page's stylesheet, because the renderers are written for it.
// Safe beside pad.css: its body rules are scoped to `body.ref-body`, and its
// :root tokens are the same values pad.css declares.
import '../src/reference.css';
// The picker's own chrome and the app dialogs, extracted out of styles.css so
// a phone can open one without downloading 3400 lines of desktop board layout.
import '../src/partpicker.css';
// The attack window's own stylesheet, shared with the board and the Match
// Centre: the pad draws the same window.
import '../src/combat.css';
import { EmberApi, ApiError, type Account, type RegistrationInfo, type SquadEntry } from '../src/api';
import { Relay, type NetView, type RolledDie } from '../src/net';
import { applyRemote, check, onBeforeApply, onPerformed, onRefused, perform, taskDesignations, type Command } from '../src/commands';
import { glueAfter } from '../src/glue';
import { askDesignation, designationsFor, activeOpp, continueAllowed, finishIfBothReady, guideAct, guideOnRemote, guidedOn, performButton, startGuided, startIfBothReady, turnHtml, type GuideApi } from './guided';
import { countHits, normaliseSetup, tasksLocked } from '../src/setup';
import { attackActive, attackOnCommand, attackWatching, beginAttack, initAttack, isAttackAction, mountAttack, sweepView, syncMirror, type TableVerdict } from './attack';
import { registerOffline } from '../src/offline';
import { askTablePool, askTableRoll, askTargetPart } from './tabledice';
import type { RollGroup } from '../src/combat';
import { beginElectronic, ewActive, ewWatching, initEw, mountEw, syncContest } from './ew';
import { clearHistory, historyDepth, historyEntries, undoLast, recordSnapshot } from '../src/history';
import { labelFor, namesFrom, type LedgerNames } from '../src/ledger';
import { setLocalSeat } from '../src/loop';
import { actionIconUrl, BASE_FACTIONS, battlefieldCardUrl, cardName, discardFaceOf, environmentAllowance, environmentImageUrl, FACTION_LABEL, parseGridRef, isDiscardCard, isListedBox, isMine, loadData, mechPartUrl, missionImageUrl, secondaryImageUrl, stancePrintUrl, statIconIsPlated, statIconUrl, tabImageUrl, tokenFace, tokenPrintUrl, traitName, type GameData } from '../src/data';
import { importSquadFile } from '../src/importer';
import { deleteMechPreset, isBuiltInPreset, loadMechPresets, saveMechPreset, type MechPreset } from '../src/presets';
import { deleteSquad, isBuiltInSquad, loadSquads, saveSquad, type SavedSquad } from '../src/squadstore';
import { bindLibrary, onLibrary } from '../src/library';
import { hiddenBuiltIns, restoreBuiltIns } from '../src/builtins';
import { actionBlock, cardDetail, cardRow, fillPortraits, keywordCard, keywordDetail, kwLabel, linkKeywords, traitBlock, useCardData } from '../src/refcards';
import { found, matchCard, matchKeyword, matchMechanic, matchMission, matchPhase, matchSecondary, matchStance, matchStatus, matchTiming, nmCard, nmKeyword, nmMechanic, nmMission, nmPlay, nmSecondary, nmStatus, norm } from '../src/refsearch';
import { mountCardImage, mountCardImageCopy } from '../src/images';
import { squadColour } from '../src/icons';
import { groupByFaction, openPartPicker } from '../src/partpicker';
import { bindCollection, builtOnlyOn, collectionOn, copiesOf, hasAny, loadCollection, onCollection, remaining, saveCollection, setBuiltOnly, setCollectionOn, shortfalls, type Collection } from '../src/collection';
import { choiceDialog, confirmDialog, promptDialog } from '../src/dialog';
import { checkForUpdates, watchForUpdates } from '../src/updates';
import { normaliseTasks, taskItemsFor, type TaskState } from '../src/tasks';
import { previewScore } from '../src/scoring';
import { tacticFitsPhase, tacticSpec, tacticTargets, type TacticCtx } from '../src/tactics';
import { explosionScope, freehandSlots, targetStatusGrant, immediateDetonation, smokePlacement, squadAllegiance, twoHandedUse } from '../src/units';
import { gameResult } from '../src/tasks';
import { canBeLoad, chargeableSlots, electronicDash, electronicValue, guidedActions, initiativeFor, interceptCapacity, isCarrier, isDeployable, isElectronicAttack, maneuverRange, maxLink, migrateState, parryParts, pilotCard, structureOf, tokenCards, volleyOf } from '../src/units';
import { lengthOf, LENGTH_NAME, timingOf } from '../src/ticks';
import { MECH_LAYER_ORDER, newScriptState, PHASES, SCALES, statusesFor, statusStacks, STATUSES, TIMINGS } from '../src/types';
import type { Card, CardAction, DieColor, GameState, ImportedSquad, MechLoadout, PartSlot, PartState, Side, Stance, Token } from '../src/types';

const root = document.getElementById('pad-root')!;
const api = new EmberApi();

// THE PAD HOLDS A REAL GameState.
//
// It has no board and never draws a coordinate, but the command layer is the
// whole point of reusing this engine: `importSquad` here is the same command,
// checked by the same check(), that the tabletop sends. Inventing a lighter
// shape would mean re-implementing validation the engine already does, and it
// would stop the pad ever syncing with a board client.
//
// Units are parked wherever the engine puts them and their col/row is never
// read. Do NOT try to strip those fields: the wire format, the fingerprint and
// migrateState all assume a Token has them.
function freshTable(): GameState {
  return {
    v: 3,
    map: '',
    tokens: [],
    nextUid: 1,
    round: { n: 1, phase: 0, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    markers: [],
    smoke: [],
    removedTerrain: [],
    tactics: { s1: [], s2: [] },
    tacticsPlayed: { s1: [], s2: [] },
    // A record sheet beside a physical game: the engine leaves everything that
    // reads a position to the table.
    noBoard: true,
  };
}

let table: GameState = freshTable();

// A NEW table starts empty, and something has to say so.
//
// `table` is module state and the relay never clears it: leaving a room and
// opening another one carried the previous table's units into it. Called from
// the places a player changes tables, rather than from onChange - a reconnect
// to the SAME room also fires onChange, and resetting there would wipe the
// host's board before it could republish it.
function resetTable(): void {
  table = freshTable();
  picks.s1 = null;
  picks.s2 = null;
  resetSheetViews();
  side = null;
  panel = null;
  looks = [];
  // The ledger belongs to the table that made it. Undoing into a game that is
  // no longer on the screen would restore a board nobody is playing.
  clearHistory();
}
let data: GameData | null = null;
let dataError: string | null = null;

// A snapshot read back in, MIGRATED the way the Match Centre migrates its
// checkpoints, so a table saved on last month's build reloads with this
// month's fields - with one correction. migrateState always normalises a
// `script`, and a script is the GUIDED game: with one present, advancePhase
// demands the designation loop be finished and both players ready, which a
// record sheet with no board can never satisfy. That is exactly what stopped
// two playtesters at "Both players press Continue". A table that arrived
// without a script stays without one; a table opened from the board keeps its.
function migrated(raw: unknown): GameState | null {
  const m = data ? migrateState(raw, data) : null;
  if (!m) return null;
  const had = !!raw && typeof raw === 'object' && !!(raw as { script?: unknown }).script;
  if (!had) m.script = undefined;
  // A checkpoint written by an earlier pad build can carry a script that was
  // never anything but the normaliser's blank: nobody designated, nobody
  // passed, no round was ever scripted. That blank is the fabricated one, so
  // it goes too - which is what lets a table already open when this shipped
  // turn its phase without reloading.
  else if (m.script && JSON.stringify(m.script) === JSON.stringify(newScriptState(m.round.firstPlayer))) m.script = undefined;
  return m;
}

const relay = new Relay(api.base, {
  onRolled: () => {},
  // The other phone's commands land on the shared table. applyRemote is the
  // same door the board uses, so a squad imported over there appears here -
  // and an edit to one of OUR units, or to the score, is announced, because
  // the player holding this phone may be looking at a different sheet.
  onCommand: (cmd) => {
    if (!data) return;
    applyRemote(data, table, cmd as Command);
    glueAfter(data, table, cmd as Command);
    attackOnCommand(cmd as Command);
    if (!catchingUp) {
      toastRemote(cmd as Command);
      guideOnRemote(guide, cmd as Command);
      // The other player's Continue may have completed the pair - for the
      // phase turn, for starting a guided game, or for ending deployment.
      if ((cmd as Command).kind === 'setReady') {
        if (wantsGuided() && !guidedOn(table)) startIfBothReady(guide);
        else if (guidedOn(table)) { finishIfBothReady(guide); maybeAdvance(); }
        else maybeAdvance();
      }
    }
    render();
  },
  // A late joiner is handed the whole table. It arrives as `unknown` because
  // net.ts refuses to care what a board is - and it is MIGRATED, exactly as the
  // Match Centre migrates its checkpoints: a raw cast silently drops any field
  // migrateState knows about that the sender's build did not.
  onCheckpoint: (s) => {
    table = migrated(s) ?? ((s && typeof s === 'object') ? (s as GameState) : table);
    render();
  },
  onCatchUp: (active) => {
    catchingUp = active;
    if (!active) render();
  },
  onClosed: () => {
    if (closedRoom) forgetRoom(closedRoom);
    toast('The other player closed the table.');
    render();
  },
  // The host republishes the table when the server has dropped its history.
  onNeedCheckpoint: () => relay.publishCheckpoint(),
  onChange: (v) => {
    view = v;
    // WITHOUT THIS, perform() IS NOT STRICT.
    //
    // `strict` is `!!state.script?.strict || !!getLocalSeat()`, so a pad that
    // never named its seat APPLIED commands its own check() had refused and
    // then published them. It also seat-stamps attributed commands, which is
    // what stops a guest's table command being silently dropped by the server.
    setLocalSeat(v.room ? v.seat : null);
    // Every change while seated refreshes the row on the lobby, so the hour
    // the relay allows is counted from the last time we were actually there.
    if (v.room) {
      closedRoom = v.room.id;
      rememberRoom();
      if (setupPending && v.host) {
        setupPending = false;
        panel = 'setup';
      }
    }
    // A relay failure that is really an expired session looks EXACTLY like a
    // dropped connection: the upgrade is answered 401, the browser cannot tell
    // the difference, and net.ts retries forever saying "Connection lost". So
    // when it keeps failing, ask the API who we are.
    if (v.status === 'offline' && account) void recheckSession();
    render();
  },
  snapshot: () => table,
});

// Everything performed here mirrors, exactly as on the board and in the Match
// Centre. This REPLACES publishing by hand at the call site.
onPerformed((cmd) => relay.publish(cmd));

// The ledger's name resolver. Built once and cached because labelFor is called
// for EVERY command and must not rescan the card list each time - and the sheet
// borrows it to name an Ammo pool by the Action that spends it.
let ledgerNames: LedgerNames | undefined;
function names(): LedgerNames | undefined {
  if (!ledgerNames && data) ledgerNames = namesFrom(data);
  return ledgerNames;
}

// The undo ledger. onBeforeApply fires for the other player's commands too, so
// the history holds the whole table's story rather than half of it.
onBeforeApply((s, cmd) => {
  const meta = labelFor(cmd, s, names());
  recordSnapshot(s, cmd.kind, { human: meta.label, seat: meta.seat, role: meta.role });
});

// A strict refusal is the engine teaching a rule, which is the whole point of
// this app - so it is shown, never swallowed.
onRefused((why) => {
  error = why;
  render();
});

// 'collection' is the lobby's own page for the player's collection, the same
// panel the table's More opens, reachable before any game so a shelf can be
// set up ahead of sitting down with someone.
type Screen = 'signin' | 'register' | 'lobby' | 'collection' | 'table';
// The panels that slide over the sheet. Null is the resting state: the sheet.
type Panel = 'tasks' | 'find' | 'more' | 'build' | 'setup' | 'target' | 'combat' | 'inventory' | null;
type FindScope = 'all' | 'table' | 'parts' | 'units' | 'pilots' | 'tactics' | 'keywords' | 'tasks' | 'rules';

let account: Account | null = null;
let view: NetView = relay.state;
// The last room this pad sat in, so a `closed` from the server - which arrives
// after the view has already lost the room - can name what to forget.
let closedRoom: string | null = null;
let screen: Screen = 'signin';
let busy = false;
let error: string | null = null;
let recheckAt = 0;
let catchingUp = false;
// Which squad the strip is showing. Null means your own, which is what the
// Yours dock item sets; Theirs sets the other seat. Kept as a side rather than
// a dock label so a seat change on reconnect cannot leave it pointing at the
// wrong squad.
let side: Side | null = null;
// Which unit the sheet is showing. A uid rather than an index: units arrive and
// leave, and an index would quietly slide onto a different Mech.
// The unit each side's sheet is on. Two on a wide screen, one at a time on
// a phone, and a side remembers its own pick when the other is looked at.
const picks: Record<Side, number | null> = { s1: null, s2: null };
// Which Part row is open on the sheet, showing its Actions. One at a time: the
// sheet is a list, and two open rows push the tokens off the screen.
// WHAT IS OPEN ON A SHEET BELONGS TO THAT SHEET. These were single values, so
// folding the Actions on P1 folded them on P2, and on a wide screen opening one
// player's Torso opened the other's (OTTO, 2026-09-21). One record per side:
// `drawSide` is the sheet being drawn, `actSide` the sheet a tap came from.
interface SheetView { slot: string | null; action: string | null; tokPick: boolean; tokManage: string | null; acts: boolean }
let drawSide: Side = 's1';
let actSide: Side = 's1';
// Which action in the unit's action list is open, by action id.
let panel: Panel = null;
// The host is shown the table setup once, when the room comes up.
let setupPending = false;
// Which picker the Tasks panel has open, if any.
let picking: 'main' | 'secondary' | 'environment' | null = null;
// Whose Secondary the picker is choosing. Only ever the other squad's solo,
// where one phone keeps both.
let pickFor: Side = 's1';
// The Secondary picker was opened from the Guided strip, so a pick goes back
// to the game instead of staying on Tasks.
let pickFromGuide = false;
// Whether the token picker is open. A flag rather than a <details>: the sheet
// redraws on every relay change, and an open <details> would snap shut.
// The worn token being inspected, if any. Tapping a worn token opens the
// token's own rule text with the Remove a deliberate second tap.
// The search. `q` lives here and not in the input, so a redraw mid-word keeps
// what was typed; the input is only ever written back from it.
const find: { q: string; scope: FindScope } = { q: '', scope: 'all' };
// The Collection panel's search for a card to record built pieces of.
let invSearch = '';

// SOLO. A player at a table on their own, or one keeping the sheet for both
// squads because only one of them has a phone out. Same screen, with the two
// constraints of a SHARED table lifted: the server refuses a command sent as
// the other squad, so in a room you may only touch your own units; solo has
// no server, so the player keeps the whole table's sheet and the table is
// kept on this phone.
let solo = false;
// Which squad a squad is being added to. Only meaningful solo: in a room a
// squad can only ever be your own.
let squadSide: Side = 's1';

const SOLO_KEY = 'ember.pad.solo';
const GAMES_KEY = 'ember.pad.games';
const ROOMS_KEY = 'ember.pad.rooms';
const NOTES_KEY = 'ember.pad.notes';
const RECENT_KEY = 'ember.pad.recent';
const ACTS_KEY = 'ember.pad.acts';
const FOLDS_KEY = 'ember.pad.folds';
// The More panel's folds (saved units, saved squads), closed until opened and
// remembered on this phone.
let folds: Record<string, boolean> = (() => { try { return JSON.parse(stored(FOLDS_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; } })();
function foldOpen(key: string): boolean { return !!folds[key]; }
// The sheet's Actions fold, remembered on this phone; open until closed.
// The Actions fold, per side. The old single 'open' / 'closed' still reads, as
// both sides' starting state.
const sheetView: Record<Side, SheetView> = (() => {
  const raw = stored(ACTS_KEY);
  let acts: Partial<Record<Side, boolean>> = {};
  if (raw === 'closed') acts = { s1: false, s2: false };
  else if (raw && raw !== 'open') { try { acts = JSON.parse(raw) as Partial<Record<Side, boolean>>; } catch { acts = {}; } }
  const mk = (side: Side): SheetView => ({ slot: null, action: null, tokPick: false, tokManage: null, acts: acts[side] !== false });
  return { s1: mk('s1'), s2: mk('s2') };
})();
function resetSheetViews(): void {
  for (const v of [sheetView.s1, sheetView.s2]) { v.slot = null; v.action = null; v.tokPick = false; v.tokManage = null; }
}
// The server reaps an idle room after an hour, so a code older than that is a
// code for a table that is not there. Same window the Match Centre uses.
const ROOM_WINDOW_MS = 60 * 60 * 1000;

// localStorage can throw outright in a private window, so every touch of it
// is guarded, and a phone with site data blocked tracks for this session only.
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    // Kept in memory for the session, which is better than refusing.
  }
}

// SAVED GAMES. A solo game is a record on this phone that a player can leave
// and come back to, the way a room is a record on the server: more than one
// game in a day, each kept until it is deleted. The earlier single slot is
// carried into the list the first time it is read.
type SavedGame = { id: string; name: string; at: number; table: GameState };
let soloId: string | null = null;

function readJson<T>(key: string): T | null {
  try {
    const raw = stored(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function savedGames(): SavedGame[] {
  const list = readJson<unknown>(GAMES_KEY);
  const games = Array.isArray(list)
    ? list.filter((g): g is SavedGame => !!g && typeof g.id === 'string' && typeof g.at === 'number' && !!g.table && typeof g.table === 'object')
    : [];
  const old = readJson<GameState>(SOLO_KEY);
  if (old && typeof old === 'object' && !games.length) {
    games.push({ id: `g${Date.now().toString(36)}`, name: 'Tracked game', at: Date.now(), table: old });
    store(GAMES_KEY, JSON.stringify(games));
    store(SOLO_KEY, null);
  }
  return games;
}

function writeGames(games: SavedGame[]): void {
  store(GAMES_KEY, JSON.stringify(games.slice(0, 30)));
}

// What a saved game is called in the list: the two squads, or the round it
// reached, or simply that it is empty. Recomputed on every save so a squad
// added later names the game.
function gameName(): string {
  const me = mySeat();
  const mine = unitsOf(me).map((t) => t.label);
  const theirs = unitsOf(otherSeat()).map((t) => t.label);
  if (!mine.length && !theirs.length) return 'Empty table';
  const side = (u: string[]) => (u.length ? (u.length > 2 ? `${u[0]} +${u.length - 1}` : u.join(', ')) : 'nobody');
  return `${side(mine)} vs ${side(theirs)}`;
}

function saveSolo(): void {
  if (!solo || !soloId) return;
  const games = savedGames().filter((g) => g.id !== soloId);
  games.unshift({ id: soloId, name: gameName(), at: Date.now(), table });
  writeGames(games);
}

function deleteGame(id: string): void {
  writeGames(savedGames().filter((g) => g.id !== id));
}

// THE TABLES RECENTLY SAT AT. The relay keeps a room open for an hour after
// its last activity and lets a player back in by code, so leaving a table is
// not closing it: the code is kept here and offered on the lobby until the
// hour is up, unless the host closes the table or the row is dismissed.
type RecentRoom = { id: string; at: number; host: boolean; with: string | null };

function recentRooms(): RecentRoom[] {
  const list = readJson<unknown>(ROOMS_KEY);
  const rooms = Array.isArray(list)
    ? list.filter((r): r is RecentRoom => !!r && typeof r.id === 'string' && typeof r.at === 'number')
    : [];
  return rooms.filter((r) => Date.now() - r.at < ROOM_WINDOW_MS);
}

function rememberRoom(): void {
  const room = view.room;
  if (!room) return;
  const other = room.seats[otherSeat()];
  const rooms = recentRooms().filter((r) => r.id !== room.id);
  rooms.unshift({ id: room.id, at: Date.now(), host: view.host, with: other ?? null });
  store(ROOMS_KEY, JSON.stringify(rooms.slice(0, 10)));
}

function forgetRoom(id: string): void {
  store(ROOMS_KEY, JSON.stringify(recentRooms().filter((r) => r.id !== id)));
}

function ago(at: number): string {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}

// THE ONE THING ON THIS PAGE THAT NEVER TRAVELS. A scratch list per player. It
// is not a command, it is not in GameState, and it is not sent.
let notes = stored(NOTES_KEY) ?? '';

// What was opened from Find lately, so the empty search is already useful.
type Recent = { kind: 'card' | 'keyword'; key: string };
let recents: Recent[] = (() => {
  try {
    const raw = stored(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((r): r is Recent => !!r && (r.kind === 'card' || r.kind === 'keyword') && typeof r.key === 'string') : [];
  } catch {
    return [];
  }
})();

function remember(r: Recent): void {
  recents = [r, ...recents.filter((x) => !(x.kind === r.kind && x.key === r.key))].slice(0, 8);
  store(RECENT_KEY, JSON.stringify(recents));
}

// WHAT HAS BEEN TYPED LIVES HERE, NOT IN THE DOM. Every field mirrors itself in
// on `input` and is written back out as a `value` attribute, so a redraw is
// never destructive, whatever causes it.
const form = { user: '', pass: '', ruser: '', rpass: '', code: '', join: '' };
// Whether the door is open and whether it wants a code, read from the server
// at startup. The server enforces it regardless; this only shapes the form.
let reg: RegistrationInfo | null = null;

async function recheckSession(): Promise<void> {
  const now = Date.now();
  if (now - recheckAt < 15000) return;
  recheckAt = now;
  const who = await api.refresh();
  if (!who && account) {
    account = null;
    screen = 'signin';
    error = 'Your session ended. Sign in again to get back to the table.';
    relay.leave();
    render();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// ---------- the screens before a table ----------

function head(): string {
  return `<div class="pad-head">
    <span class="pad-mark">Ember Pad</span>
    <span class="pad-sub">${account ? esc(account.username) : 'record sheet'}</span>
  </div>`;
}

function errHtml(): string {
  return error ? `<p class="pad-err">${esc(error)}</p>` : '';
}

function signinHtml(): string {
  return `${head()}
    <div class="pad-card">
      <h1 class="pad-h">Sign in</h1>
      ${errHtml()}
      <label class="pad-field">
        <span class="pad-label">Username</span>
        <input class="pad-input" id="pad-user" value="${esc(form.user)}" autocomplete="username" autocapitalize="none" autocorrect="off" />
      </label>
      <label class="pad-field">
        <span class="pad-label">Password</span>
        <input class="pad-input" id="pad-pass" type="password" value="${esc(form.pass)}" autocomplete="current-password" />
      </label>
      <button class="pad-btn primary" data-act="signin"${busy ? ' disabled' : ''}>${busy ? 'Signing in…' : 'Sign in'}</button>
      <button class="pad-link" data-act="to-register">I need an account</button>
      <div class="pad-or">or without an account</div>
      <button class="pad-btn" data-act="solo">Offline Game</button>
    </div>
    ${lobbyLists()}`;
}

function registerHtml(): string {
  const closed = reg?.mode === 'closed';
  const inviteNeeded = reg?.inviteRequired ?? true;
  if (closed) {
    return `${head()}
    <div class="pad-card">
      <h1 class="pad-h">Create an account</h1>
      <p class="pad-lead">New accounts are closed at the moment.</p>
      <button class="pad-link" data-act="to-signin">I already have one</button>
    </div>`;
  }
  return `${head()}
    <div class="pad-card">
      <h1 class="pad-h">Create an account</h1>
      ${errHtml()}
      <label class="pad-field">
        <span class="pad-label">Username</span>
        <input class="pad-input" id="pad-ruser" value="${esc(form.ruser)}" autocomplete="username" autocapitalize="none" autocorrect="off" />
      </label>
      <label class="pad-field">
        <span class="pad-label">Password</span>
        <input class="pad-input" id="pad-rpass" type="password" value="${esc(form.rpass)}" autocomplete="new-password" />
      </label>
      ${inviteNeeded ? `<label class="pad-field">
        <span class="pad-label">Invite code</span>
        <input class="pad-input code" id="pad-code" value="${esc(form.code)}" autocapitalize="characters" autocorrect="off" spellcheck="false" />
      </label>` : ''}
      <button class="pad-btn primary" data-act="register"${busy ? ' disabled' : ''}>${busy ? 'Creating…' : 'Create account'}</button>
      <button class="pad-link" data-act="to-signin">I already have one</button>
    </div>`;
}

// The collection as a door screen: the table's panel inside a lobby card.
function collectionHtml(): string {
  return `${head()}
    <div class="pad-card pad-card-panel">
      ${data ? inventoryPanel() : `<div class="pad-panel-in">${panelHead('Collection')}<p class="pad-status">Loading the card database…</p></div>`}
    </div>`;
}

function lobbyHtml(): string {
  const connecting = view.status === 'connecting';
  return `${head()}
    <div class="pad-card">
      <h1 class="pad-h">At the table</h1>
      ${errHtml()}
      <button class="pad-btn primary" data-act="host"${busy || connecting ? ' disabled' : ''}>Open a table</button>
      <div class="pad-or">or join one</div>
      <label class="pad-field">
        <span class="pad-label">Table code</span>
        <input class="pad-input code" id="pad-join-code" value="${esc(form.join)}"
               autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text" maxlength="7" />
      </label>
      <button class="pad-btn" data-act="join"${busy || connecting ? ' disabled' : ''}>Join table</button>
      ${connecting ? '<p class="pad-status">Connecting…</p>' : ''}

      <div class="pad-or">or on your own</div>
      <button class="pad-btn" data-act="solo">Track a new game</button>

      <div class="pad-or">before you play</div>
      <button class="pad-btn" data-act="inventory">My collection</button>
    </div>
    ${lobbyLists()}
    <div class="pad-foot">
      <button class="pad-btn" data-act="signout">Sign out</button>
    </div>`;
}

// The tables to go back to: rooms the relay still holds, and games kept on
// this phone. A row opens it; the small cross forgets it - a room is only
// forgotten here, a game is deleted, and the confirm says which.
function lobbyLists(): string {
  const rooms = account ? recentRooms() : [];
  const games = savedGames();
  if (!rooms.length && !games.length) return '';
  const roomRows = rooms.map((r) => `<div class="pad-seat pad-resume">
      <button class="pad-resume-b" data-act="rejoin" data-id="${esc(r.id)}">
        <span class="pad-seat-name mono">${esc(r.id)}</span>
        <span class="pad-seat-sub">${r.with ? `with ${esc(r.with)}` : 'waiting for a player'} · ${r.host ? 'yours' : 'joined'} · ${ago(r.at)}</span>
      </button>
      <button class="ui-x" data-act="room-x" data-id="${esc(r.id)}" aria-label="Forget this table">✕</button>
    </div>`).join('');
  const gameRows = games.map((g) => `<div class="pad-seat pad-resume">
      <button class="pad-resume-b" data-act="resume" data-id="${esc(g.id)}">
        <span class="pad-seat-name">${esc(g.name)}</span>
        <span class="pad-seat-sub">Round ${g.table.round?.n ?? 1} · ${ago(g.at)}</span>
      </button>
      <button class="ui-x" data-act="game-x" data-id="${esc(g.id)}" aria-label="Delete this game">✕</button>
    </div>`).join('');
  return `<div class="pad-card">
      ${rooms.length ? `<p class="pad-label pad-sec" style="margin-top:0">Recent tables</p>${roomRows}` : ''}
      ${games.length ? `<p class="pad-label pad-sec"${rooms.length ? '' : ' style="margin-top:0"'}>Saved games</p>${gameRows}` : ''}
    </div>`;
}

// ---------- who is who ----------

function mySeat(): Side {
  return (view.seat ?? 's1') as Side;
}

function otherSeat(): Side {
  return mySeat() === 's1' ? 's2' : 's1';
}

// The squad the strip and sheet are showing.
function shownSide(): Side {
  return side ?? mySeat();
}

// Whether this pad may record for a unit at all. In a room that is your own
// squad and nothing else - check() refuses another squad's unit and the server
// refuses another squad's seat. Solo has neither, so everything on the table is
// yours to keep.
function canCommand(t: Token): boolean {
  return solo || t.side === mySeat();
}

function unitsOf(s: Side): Token[] {
  return table.tokens.filter((t) => t.side === s);
}

// ---------- the destroyed ----------
//
// A destroyed unit stays on the strip for the rest of the round it died in
// (its records are still being written), then leaves it at the round turn -
// the End Phase's own Remove Units step (3.7.1). It stays in the state and is
// listed under More. The round it was first seen dead is remembered here, on
// this phone: a reload shows every dead unit for the round it reloads in.
const deadSince = new Map<number, number>();

function isDead(u: Token): boolean {
  return (u.partStates[u.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed';
}

function noteDead(): void {
  for (const u of table.tokens) {
    if (isDead(u)) { if (!deadSince.has(u.uid)) deadSince.set(u.uid, table.round.n); }
    else deadSince.delete(u.uid);
  }
}

// Off the strip: dead since an earlier round.
function swept(u: Token): boolean {
  return isDead(u) && (deadSince.get(u.uid) ?? table.round.n) < table.round.n;
}

function stripUnits(s: Side): Token[] {
  return unitsOf(s).filter((u) => !swept(u));
}

// Same card, same side: a volley reads as one chip until it is opened. A
// group holding the unit on the sheet opens by itself - and stays open
// against the head, which is what made a launched volley look stuck: every
// tap toggled openGroup while the member on the sheet forced it open again.
// closedGroup is the player's "no": it beats the member rule until the next
// selection.
let openGroup: string | null = null;
let closedGroup: string | null = null;

function groupKey(u: Token): string | null {
  return u.kind === 'mech' ? null : `${u.side}:${u.cardId}`;
}

// Stabilize System (6.1): the Link, and a Token if the player chooses. One
// kind worn, or none: no question. Two or more: ask, with keeping them all
// as a choice (J4).
function stabilise(t: Token): void {
  const worn = statusStacks(t.statuses).filter(({ def }) => def.shape === 'square' || def.shape === 'hexagon');
  if (worn.length < 2) { send({ kind: 'stabilise', seat: t.side, uid: t.uid }); return; }
  void (async () => {
    const pick = await choiceDialog({
      title: 'Stabilize System',
      choices: [
        ...worn.map(({ def, n }) => ({ id: def.id, label: n > 1 ? `${def.label} ×${n}` : def.label })),
        { id: '__keep', label: 'Keep the Tokens', cancel: true },
      ],
      stacked: true,
    });
    if (pick === null) return;
    send(pick === '__keep'
      ? { kind: 'stabilise', seat: t.side, uid: t.uid, keepTokens: true }
      : { kind: 'stabilise', seat: t.side, uid: t.uid, statusId: pick });
  })();
}

function unitOf(uid: number | null): Token | null {
  return table.tokens.find((x) => x.uid === uid) ?? null;
}

// The unit the sheet should show: whatever was chosen on this side, else the
// first of the side.
function unitFor(s: Side): Token | null {
  const chosen = unitOf(picks[s]);
  // A swept unit opened from the destroyed list still shows its sheet.
  if (chosen && chosen.side === s) return chosen;
  return stripUnits(s)[0] ?? null;
}

function shownUnit(): Token | null {
  return unitFor(shownSide());
}

// Two sheets side by side from 960px: yours left, theirs right.
function wide(): boolean {
  return window.matchMedia('(min-width: 960px)').matches;
}

// Which side's sheet an element sits in - the column on a wide screen, the
// shown side otherwise (panels and the bar belong to the shown side).
function columnSide(el: Element): Side {
  if (!wide()) return shownSide();
  if (el.closest('#pad-sheet2, #pad-strip2')) return otherSeat();
  if (el.closest('#pad-sheet, #pad-strip')) return mySeat();
  return shownSide();
}

// The first real card of a squad decides its colour, the way the board tints a
// squad: a squad with no single allegiance takes the neutral.
function sideFaction(s: Side): string | null {
  if (!data) return null;
  const t = unitsOf(s)[0];
  if (!t) return null;
  const core = tokenCards(data, t).find((x) => x.slot === 'torso' || x.slot === 'main')?.card;
  return core ? data.factionOf(core) : null;
}

function sideColour(s: Side): string {
  return squadColour(sideFaction(s));
}

function pendingGuidedHtml(): string {
  const empty = (['s1', 's2'] as Side[]).filter((s) => !table.tokens.some((t) => t.side === s));
  const waiting = view.room && readiness().me;
  return `<div class="pad-turn-h mine"><b>Guided game</b><span>not started</span></div>
    ${empty.length ? `<p class="pad-turn-note">${esc(empty.length > 1 ? 'Neither side has a squad yet.'
      : empty[0] === mySeat() ? 'You have no squad yet.'
      : `${view.room?.seats[empty[0]] ?? 'The other side'} has no squad yet.`)}</p>` : ''}
    <div class="pad-chips">
      <button class="pad-chip on" data-act="g-start"${waiting ? ' disabled' : ''}>${waiting ? 'Waiting for the other player…' : 'Start the guided game'}</button>
      <button class="pad-chip" data-act="open-setup">Setup</button>
    </div>`;
}

// A seat by number. "Yours" and "Theirs" read wrong the moment one phone
// tracks both squads, or a sentence needed a subject (OTTO, 2026-09-21).
function seatTag(s: Side): string {
  return s === 's1' ? 'P1' : 'P2';
}

// The player's name at a table, Player 1 / Player 2 otherwise.
function sideName(s: Side): string {
  const room = view.room;
  if (room?.seats[s]) return room.seats[s]!;
  return s === 's1' ? 'Player 1' : 'Player 2';
}

// For a chip or a label with no room to spare: the name while it is short,
// the seat tag otherwise.
function shortSide(s: Side): string {
  const name = view.room?.seats[s];
  return name && name.length <= 8 ? name : seatTag(s);
}

// A side as the SUBJECT of a sentence: the player's name in a room, Player 1
// or Player 2 otherwise. It used the squad's own name when tracking solo
// ("RAID-RDL-Starter goes first"), which read as a unit rather than a
// player (OTTO, 2026-09-21).
function actorName(s: Side): string {
  return sideName(s);
}

// ---------- squads ----------
//
// Three doors, all ending at the same `importSquad` command so the other pad
// receives the squad however it was built here: a Watermelon file (JSON or the
// builder's PNG), a built-in or saved preset, or a Mech built here.

function sendSquad(name: string, mechs: { name?: string; loadout: MechLoadout }[],
                   drones: { cardId: string; backpack?: string }[]): boolean {
  if (!data) return false;
  const seat = solo ? squadSide : mySeat();
  const cmd: Command = { kind: 'importSquad', seat, name, mechs, drones };
  const firstUid = table.nextUid;
  // No relay.publish here: onPerformed above sends it, and only once it has
  // actually applied.
  const verdict = perform(data, table, cmd);
  if (!verdict.ok) {
    error = verdict.why ?? 'That squad could not join.';
    render();
    return false;
  }
  saveSolo();
  // A file or a saved build arrives whole, past the pickers' filter: what the
  // shelf in use does not hold is named, and the squad joins all the same.
  const shelf = shelfFor();
  if (shelf) {
    const short = shortfalls(data, shelf, shelfTokens(), table.tokens.filter((t) => t.uid >= firstUid));
    if (short.length) toast(`Not in the collection: ${short.map((s) => `${cardName(s.card)} (${s.short} short)`).join(', ')}.`);
  }
  // The squad that just joined is the one to look at.
  side = seat;
  picks.s1 = null;
  picks.s2 = null;
  return true;
}

async function importFromFile(file: File): Promise<void> {
  if (!data) return;
  let squad: ImportedSquad;
  try {
    squad = await importSquadFile(file, data.byId);
  } catch (err) {
    error = (err as Error).message || 'That file could not be read.';
    render();
    return;
  }
  const ok = sendSquad(
    squad.name,
    squad.mechs.map((m) => ({ name: m.name, loadout: m.loadout })),
    squad.drones,
  );
  if (!ok) return;
  // The hand comes with the squad, merged into whatever the side already
  // holds; a duplicate would be refused whole (FAQ P2).
  if (squad.tactics?.length) {
    const seat = solo ? squadSide : mySeat();
    const merged = [...new Set([...(table.tactics?.[seat] ?? []), ...squad.tactics])];
    send({ kind: 'setTactics', seat, cards: merged });
  }
  // NEVER swallow unknownIds. A squad built in the community builder can name a
  // Part we do not ship; dropping those in silence hands a player a squad
  // quietly missing a weapon.
  if (squad.unknownIds.length) {
    const n = squad.unknownIds.length;
    toast(`${squad.name} joined, but ${n} part${n === 1 ? '' : 's'} could not be matched and ${n === 1 ? 'was' : 'were'} left out: `
      + `${squad.unknownIds.slice(0, 6).join(', ')}${n > 6 ? '…' : ''}`);
  } else {
    toast(`${squad.name} joined.`);
  }
  error = null;
  panel = null;
  render();
}

// ---------- the sheet ----------
//
// WHO MAY RECORD WHAT. The relay server refuses any command whose inner `seat`
// is not the sender's own, and applyPenetration's seat is the ATTACKER's - it
// stamps `lastDamagedBy`, which decides who is owed the Integrity-Loss kill
// (FAQ P4). So damage is recorded by the player who DEALT it, through the
// table's setPartState under our own seat, and the self controls (Link, Stance,
// Ammo, Charge) sit only on units this pad commands. Do NOT "fix" this by
// letting a player mark their own damage through applyPenetration.

const SLOTS: PartSlot[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];
const SLOT_LABEL: Record<string, string> = {
  torso: 'Torso', chasis: 'Chassis', leftHand: 'Left hand', rightHand: 'Right hand', backpack: 'Backpack',
  main: 'Unit', pilot: 'Pilot',
};
const STANCES: Stance[] = ['offensive', 'defensive', 'mobility', 'shutdown'];
const STANCE_LABEL: Record<Stance, string> = {
  offensive: 'Offensive', defensive: 'Defensive', mobility: 'Mobility', shutdown: 'Shutdown',
};
const KIND_LABEL: Record<Token['kind'], string> = { mech: 'Mech', drone: 'Drone', projectile: 'Projectile' };
const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));
const STATE_MARK: Record<PartState, string> = { intact: '●', damaged: '◐', destroyed: '✕' };
const STATE_LABEL: Record<PartState, string> = { intact: 'intact', damaged: 'damaged', destroyed: 'destroyed' };

// The printed Stance token behind its name, so the dial reads the way the one
// on the base does.
function stanceBtn(s: Stance, on: boolean, attr: string): string {
  return `<button class="pad-stance${on ? ' on' : ''}" ${attr}>
    <img src="${esc(stancePrintUrl(s))}" alt="" />
    <span>${STANCE_LABEL[s]}</span>
  </button>`;
}

// The actor a token edit travels under. These are BOOKKEEPING edits, not
// attacks - no kill credit rides on applyStatus - so the only constraint that
// matters is whose seat the wire will accept: in a room the relay accepts only
// OUR seat, so the actor is one of our units whatever the target.
function sourceFor(target: Token): { seat: Side; uid: number } {
  if (solo) return { seat: target.side, uid: target.uid };
  const me = mySeat();
  const own = table.tokens.find((x) => x.side === me);
  return own ? { seat: me, uid: own.uid } : { seat: target.side, uid: target.uid };
}

// Sends a command and redraws. Every tap on the sheet comes through here, so
// the refusal path and the redraw cannot be forgotten at a call site.
//
// CHECKED HERE RATHER THAN LEFT TO perform(): perform() is only strict when a
// local seat is set, which happens in a room. Solo would otherwise APPLY
// commands its own check() had refused. Asking first makes both modes behave
// the same, and the engine gets to teach the rule either way.
function send(cmd: Command): boolean {
  if (!data) return false;
  error = null;
  const verdict = check(data, table, cmd);
  if (!verdict.ok) {
    error = verdict.why ?? 'That cannot be done.';
    render();
    document.querySelector('.pad-err')?.scrollIntoView({ block: 'nearest' });
    return false;
  }
  perform(data, table, cmd);
  glueAfter(data, table, cmd);
  seedTaskItems();
  saveSolo();
  render();
  return true;
}

// The Main Task's Items (its Zones, Terminals or Black Boxes). A page with a
// board seeds them when the mission is set; the pad only ever sent the mission,
// so the table had no Items and nothing about Control, Terminals or Black
// Boxes could ever score. Seeded here after any command, whenever the Items on
// the table are not the ones the mission calls for - which also covers a Main
// Task that arrives through the draw. The rest of the TaskState rides along.
function seedTaskItems(): void {
  if (!data) return;
  const m = missionOf();
  if (!m) return;
  const want = taskItemsFor(data.zoneData.zones, m).items;
  const tasks = normaliseTasks(table.tasks);
  const same = tasks.items.length === want.length && want.every((w) => tasks.items.some((i) => i.id === w.id));
  if (same) return;
  perform(data, table, { kind: 'configureTable', seat: mySeat(), tasks: { ...tasks, items: want } });
}

// ---------- guided play ----------
//
// The scripted game, on this phone. guided.ts draws the turn strip and sends
// the step's commands; this is what it borrows from the pad.
// Freeform or Guided is the TABLE'S setting (guidedPlay), not this phone's:
// the player who joined used to see Freeform while the host sat ready for a
// Guided game, and had to guess to pick it themselves.
function wantsGuided(): boolean {
  return !!table.guidedPlay;
}
// The Opportunity the sheet was last brought to, so a player who looks at
// another unit mid-Opportunity is not dragged back on every render.
let shownOpp: number | null = null;

const guide: GuideApi = {
  get data() { return data!; },
  state: () => table,
  me: () => mySeat(),
  get solo() { return solo; },
  inRoom: () => !!view.room,
  send: (cmd) => send(cmd),
  toast: (text) => toast(text),
  rollHits,
  render: () => render(),
  selectUnit: (uid) => { const t = unitOf(uid); if (t) { picks[t.side] = uid; side = t.side; } },
  sideName: (s) => sideName(s),
  actorName: (s) => actorName(s),
  esc,
  pressContinue: () => pressContinue(),
  readiness: () => readiness(),
  check: (cmd) => check(data!, table, cmd),
  endGame: () => { void endGame(); },
  detonate: (uid, actionId) => { const t = unitOf(uid); if (t) void detonate(t, actionId); },
  stabilise: (uid) => { const t = unitOf(uid); if (t) stabilise(t); },
  pickDiscard: async (uid) => { const t = unitOf(uid); return t ? pickDiscard(t) : null; },
  tactics: (side) => ({
    playable: guidedOn(table) && !playedThisRound(side)
      ? handOf(side).filter((id) => tacticFitsPhase(id, PHASES[table.round.phase] ?? '')).map((id) => ({ id, name: data ? cardName(data.byId.get(id)!) : id }))
      : [],
    play: (id) => { void playTactic(side, id); },
  }),
  attack: (uid, actionId, opts) => {
    const t = unitOf(uid);
    if (!t) return;
    targetFor = { uid, actionId, mode: opts?.electronic ? 'electronic' : 'attack', granted: opts?.granted };
    panel = 'target';
    render();
  },
  launch: (uid, actionId, cardId) => {
    const t = unitOf(uid);
    if (t) void launchFrom(t, actionId, cardId);
  },
};

// ---------- the attack window ----------
//
// What attack.ts borrows from the pad. The window itself is the shared
// AttackHelper; see attack.ts for what the table is asked before it opens.
// What the target pick is for: an attack, an Interception (aerial enemies
// only), or an Electronic Attack (the counter-roll). `granted` marks a
// Riposte's free Melee.
type PickMode = 'attack' | 'intercept' | 'electronic';
let targetFor: { uid: number; actionId: string; mode: PickMode; granted?: boolean } | null = null;

initAttack({
  get data() { return data!; },
  state: () => table,
  me: () => mySeat(),
  get solo() { return solo; },
  inRoom: () => !!view.room,
  send: (cmd) => send(cmd),
  check: (cmd) => check(data!, table, cmd),
  toast: (text) => toast(text),
  render: () => render(),
  openCombat: () => { if (panel !== 'combat') { panel = 'combat'; render(); } },
  closeCombat: () => {
    if (panel === 'combat') { panel = null; render(); }
    // "Undo the whole attack": back to the table as it stood before the
    // Action was paid, one snapshot at a time, now that the window is shut.
    if (undoAttackTo !== null) {
      const to = undoAttackTo;
      undoAttackTo = null;
      let n = 0;
      while (historyDepth() > to && undoLast(table)) n++;
      if (n) { relay.publishCheckpoint(); saveSolo(); error = null; toast('The attack was undone.'); render(); }
    }
    attackDepth = null;
    if (detonating) void continueDetonation();
  },
  // Closing a live attack costs something, and the window used to close
  // without a word: a Guided Action stayed spent and the only way back was
  // knowing to Undo afterwards. Solo, the whole attack can be taken back from
  // here. In a room it cannot - the dice were rolled in front of the other
  // player - so there the choice is to keep going or to abandon it.
  confirmCancel: async () => {
    const canUndo = !view.room && attackDepth !== null && historyDepth() > attackDepth;
    const pick = await choiceDialog({
      title: 'Leave this attack?',
      body: guidedOn(table) ? 'The Action stays spent.' : undefined,
      choices: [
        { id: 'keep', label: 'Keep going', primary: true },
        ...(canUndo ? [{ id: 'undo', label: 'Undo the whole attack' }] : []),
        { id: 'abandon', label: 'Abandon it', cancel: true },
      ],
      stacked: true,
    });
    if (pick === 'undo') { undoAttackTo = attackDepth; return true; }
    return pick === 'abandon';
  },
  rollDice: async (pool, label, brief) => {
    const dice = data?.dice;
    // Table rolls: the pad says what to pick up and what to watch for, and
    // the table rolls. Entering the faces is there for help with the sums.
    if (table.tableDice && dice) {
      // A reroll carries no brief: it is only ever made by a player who is
      // already entering their dice, so it goes straight to the faces.
      if (!brief) {
        let faces = await askTableRoll(dice, pool, label);
        while (faces === null) faces = await askTableRoll(dice, pool, label);
        if (view.room && view.seat) send({ kind: 'noteRoll', seat: mySeat(), what: label ?? 'dice' });
        return { dice: faces, handsOff: false };
      }
      const answer = await askTablePool(dice, pool, label, brief.watch, brief.blocks);
      if (view.room && view.seat) send({ kind: 'noteRoll', seat: mySeat(), what: label ?? 'dice' });
      return answer === 'rolled' ? { dice: [], handsOff: true } : { dice: answer, handsOff: false };
    }
    return { dice: await rollDice(pool, label, 'pool'), handsOff: false };
  },
  // The Black Die at the table: which of the target's Parts did it name?
  blackDie: () => (table.tableDice && data?.dice ? (defender) => {
    const d = data!;
    const parts = tokenCards(d, defender).filter(({ slot }) => slot !== 'pilot').map(({ slot, card }) => ({
      slot: String(slot),
      label: SLOT_LABEL[slot] ?? String(slot),
      name: cardName(card),
      state: defender.partStates[slot as PartSlot | 'main'] ?? 'intact',
    }));
    return askTargetPart(d.dice!, defender.label, parts);
  } : null),
});

initEw({
  get data() { return data!; },
  state: () => table,
  me: () => mySeat(),
  get solo() { return solo; },
  inRoom: () => !!view.room,
  send: (cmd) => send(cmd),
  toast: (text) => toast(text),
  render: () => render(),
  openCombat: () => { if (panel !== 'combat') { panel = 'combat'; render(); } },
  closeCombat: () => { if (panel === 'combat') { panel = null; render(); } },
  rollFaces: (n, label, groups) => rollFaces(n, label, groups),
});

// An Interception: the table judges Range to the projectile, the Token is
// spent, and the window opens with line of sight given (4.9).
async function askTableAndIntercept(by: Token, actionId: string, target: Token): Promise<void> {
  const clear = await choiceDialog({
    title: `${by.label} intercepts ${target.label}`,
    body: 'Range to the projectile, at its start or its landing, on the table (4.9).',
    choices: [{ id: 'yes', label: 'In range', primary: true }, { id: 'no', label: 'Not this target', cancel: true }],
    stacked: true,
  });
  if (clear !== 'yes') return;
  if (!send({ kind: 'spendIntercept', seat: by.side, uid: by.uid, actionId })) return;
  panel = 'combat';
  render();
  if (!beginAttack(by, actionId, target, { protection: 0, backAttack: false, intercept: true })) { panel = null; render(); }
}

// An Electronic Attack: only Range matters (4.11.1), judged on the table; a
// Guided game pays the Action first.
async function askTableAndElectronic(attacker: Token, actionId: string, defender: Token): Promise<void> {
  const clear = await choiceDialog({
    title: `${attacker.label} targets ${defender.label}`,
    body: 'Range, on the table. Terrain and line of sight are ignored (4.11.1).',
    choices: [{ id: 'yes', label: 'In range', primary: true }, { id: 'no', label: 'Not this target', cancel: true }],
    stacked: true,
  });
  if (clear !== 'yes') return;
  if (guidedOn(table) && !send({ kind: 'performAction', seat: attacker.side, uid: attacker.uid, actionId, ...bothHands(attacker, actionId) })) return;
  panel = 'combat';
  render();
  if (!beginElectronic(attacker, actionId, defender)) { panel = null; render(); }
}

// How deep the undo history stood when the attack in hand began, and where
// "Undo the whole attack" should take it back to once the window has shut.
let attackDepth: number | null = null;
let undoAttackTo: number | null = null;

// The table is asked what the board used to read, then the window opens.
async function askTableAndAttack(attacker: Token, actionId: string, defender: Token, granted = false): Promise<void> {
  const a = tokenCards(data!, attacker).flatMap((c) => c.card.actions ?? []).find((x) => x.id === actionId)
    ?? data!.commonActions.find((x) => x.id === actionId);
  // One question: the shot as the table sees it. A line of sight may exist
  // and still pass a Terrain Object or a Unit, and each gives the defender
  // +2 White; both together give +4 (4.4.2). Melee claims no Protection and
  // its range is base contact whatever number the data carries.
  const melee = a?.type === 'Melee';
  // 4.5.2: with an Aerial Unit at either end the line of sight cannot be
  // obstructed, so neither Protection can be claimed and neither is offered.
  const open = melee || attacker.aerial || defender.aerial;
  const range = melee ? 'Base contact' : a?.range !== undefined ? `Range ${a.range}` : 'Range as printed';
  const seen = await choiceDialog({
    title: `${attacker.label} attacks ${defender.label}`,
    body: `${range} · judged on the table.`,
    choices: open
      ? [{ id: '0', label: melee ? 'In reach' : 'In range', primary: true }, { id: 'no', label: 'Not this target', cancel: true }]
      : [
        { id: '0', label: 'In range, line of sight clear', primary: true },
        { id: '2t', label: 'In range, behind terrain (+2 White)' },
        { id: '2u', label: 'In range, behind a unit (+2 White)' },
        { id: '4', label: 'In range, behind terrain and a unit (+4 White)' },
        { id: 'no', label: 'Not this target', cancel: true },
      ],
    stacked: true,
  });
  if (seen === null || seen === 'no') return;
  const prot = seen === '4' ? '4' : seen.startsWith('2') ? '2' : '0';
  const rear = await choiceDialog({
    title: 'Arc',
    body: `Is ${attacker.label} in ${defender.label}'s rear arc?`,
    choices: [{ id: 'no', label: 'No', primary: true }, { id: 'yes', label: 'Yes, a back attack' }],
    stacked: true,
  });
  if (rear === null) return;
  // 4.14: a [Charged] effect applies only if the Charge Token is consumed for
  // this Action, and that is the player's choice, so it is asked.
  const chargeSlot = a && !granted && /\[Charged\]|\[充能\]/i.test(`${a.description?.en ?? ''} ${a.description?.zh ?? ''}`)
    ? chargeableSlots(data!, attacker).find((x) => x.charged
      && tokenCards(data!, attacker).some((c) => String(c.slot) === String(x.slot) && (c.card.actions ?? []).some((y) => y.id === actionId)))
    : undefined;
  let chargeSpent = false;
  if (chargeSlot) {
    const spend = await choiceDialog({
      title: `${a!.name.en}: Charge`,
      body: `${chargeSlot.label} is Charged (4.14).`,
      choices: [{ id: 'yes', label: 'Consume the Charge', primary: true }, { id: 'no', label: 'Keep it' }],
      stacked: true,
    });
    if (spend === null) return;
    chargeSpent = spend === 'yes';
  }
  const verdict: TableVerdict = {
    chargeSpent,
    protection: prot === '4' ? 4 : prot === '2' ? 2 : 0,
    protectionFrom: seen === '4' ? 'both' : seen === '2u' ? 'unit' : seen === '2t' ? 'terrain' : undefined,
    backAttack: rear === 'yes',
  };
  attackDepth = historyDepth();
  // In a guided game the Action is paid for first; a refusal is the engine's
  // answer and the window stays shut. Freeform opens the window outright.
  if (guidedOn(table) && !send({ kind: 'performAction', seat: attacker.side, uid: attacker.uid, actionId, ...(granted ? { granted: true } : bothHands(attacker, actionId)) })) return;
  if (chargeSpent && chargeSlot) send({ kind: 'setCharge', seat: attacker.side, uid: attacker.uid, slot: String(chargeSlot.slot), on: false });
  panel = 'combat';
  render();
  if (!beginAttack(attacker, actionId, defender, verdict)) { panel = null; render(); }
}

// A target at a glance, for picking one: its Stance, the Tokens it wears
// (Fragile is what a combo is looking for) and what it has already lost.
function targetState(u: Token): string {
  const out: string[] = [];
  if (u.kind === 'mech' && u.stance) out.push(u.stance.charAt(0).toUpperCase() + u.stance.slice(1));
  for (const { def, n } of statusStacks(u.statuses)) out.push(n > 1 ? `${def.label} ×${n}` : def.label);
  const states = Object.values(u.partStates ?? {});
  const gone = states.filter((x) => x === 'destroyed').length;
  const hurt = states.filter((x) => x === 'damaged').length;
  if (gone) out.push(`${gone} destroyed`);
  if (hurt) out.push(`${hurt} damaged`);
  return out.join(' · ');
}

function targetPanel(): string {
  const t = targetFor ? unitOf(targetFor.uid) : null;
  if (!t) return `<div class="pad-panel-in">${panelHead('Target')}<p class="pad-status">Nothing to attack with.</p></div>`;
  const a = tokenCards(data!, t).flatMap((c) => c.card.actions ?? []).find((x) => x.id === targetFor!.actionId)
    ?? data!.commonActions.find((x) => x.id === targetFor!.actionId);
  const mode = targetFor?.mode;
  const enemies = table.tokens.filter((u) => u.side !== t.side && u.deployed !== false
    && (u.partStates[u.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') !== 'destroyed'
    && !(mode === 'attack' && a?.type === 'Melee' && u.aerial)
    // An Interception answers a projectile or a flyer (4.9); an Electronic
    // Value of "-" cannot Respond (4.11.2).
    && !(mode === 'intercept' && !u.aerial)
    && !(mode === 'electronic' && electronicDash(data!, u)));
  return `<div class="pad-panel-in">${panelHead(mode === 'intercept' ? 'Intercept' : a?.name.en ?? 'Attack')}
    <p class="pad-lead">${esc(t.label)} · pick the target.</p>
    ${enemies.length
      ? enemies.map((u) => `<button class="pad-seat" data-act="pick-target" data-uid="${u.uid}">
          <span class="pad-seat-name">${esc(u.label)}${targetState(u) ? `<small class="pad-seat-toks">${esc(targetState(u))}</small>` : ''}</span><span class="pad-seat-tag">${esc(KIND_LABEL[u.kind])}</span></button>`).join('')
      : '<p class="pad-note">No enemy unit on the table.</p>'}
  </div>`;
}

// A Passive that detonates on a trigger the table judges: it rolls dice or
// says Explosion / Detonation in its text.
function blastsOnItsOwn(a: CardAction): boolean {
  return !!((a.yellowDice ?? 0) || (a.redDice ?? 0)) || /detonat|explosion|引爆|爆炸/i.test(`${a.description?.en ?? ''} ${a.description?.zh ?? ''}`);
}

// A launch: the Action is paid in a Guided game, then one `launch` per
// projectile in the volley (4.7.1), each spending its Ammo Token (4.13). The
// projectiles land on the placeholder cell; the table places them.
async function launchFrom(t: Token, actionId: string, cardId: string): Promise<void> {
  if (!data) return;
  const action = tokenCards(data, t).flatMap((c) => c.card.actions ?? []).find((x) => x.id === actionId);
  if (!action) return;
  // Volley X: the repeats are optional (4.7.3 step 3), so a volley may be
  // smaller than printed. Asked BEFORE the Action is paid, so backing out is
  // free, and never for more than the Ammo left.
  const ammo = guidedActions(data, t).find((g) => g.action.id === actionId)?.ammoLeft;
  const most = Math.min(volleyOf(action), ammo ?? Infinity);
  let count = Math.max(1, most);
  if (most > 1) {
    const pick = await choiceDialog({
      title: `${action.name.en || 'Volley'} · Volley ${volleyOf(action)}`,
      body: 'How many are launched?',
      choices: Array.from({ length: most }, (_, i) => most - i).map((k, i) => ({ id: String(k), label: String(k), primary: i === 0 })),
    });
    if (pick === null) return;
    count = Number(pick);
  }
  if (guidedOn(table) && !send({ kind: 'performAction', seat: t.side, uid: t.uid, actionId, ...bothHands(t, actionId) })) return;
  const card = data.byId.get(cardId);
  const before = new Set(table.tokens.map((x) => x.uid));
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (!send({ kind: 'launch', seat: t.side, uid: t.uid, actionId, cardId, to: { col: 0, row: 0 }, facing: t.facing })) break;
    n++;
  }
  // Counted off the table: a Missile Group lands as several Units (6.2).
  const units = table.tokens.filter((x) => !before.has(x.uid)).length;
  if (n) toast(`${t.label}: ${card ? cardName(card) : 'projectile'}${units > 1 ? ` ×${units}` : ''} launched.`);
  // 4.7.4: an Immediate Projectile detonates as it lands, so its Detonation
  // opens here, one landed Projectile after another.
  const now = card ? immediateDetonation(card) : null;
  if (now) {
    const landed = table.tokens.filter((x) => !before.has(x.uid) && x.cardId === cardId).map((x) => x.uid);
    detonateQueue = landed.map((uid) => ({ uid, actionId: now.id }));
    nextDetonation();
  }
}

// Immediate Projectiles waiting their turn to detonate (a volley of grenades).
let detonateQueue: { uid: number; actionId: string }[] = [];
function nextDetonation(): void {
  if (detonating) return;
  const next = detonateQueue.shift();
  if (!next) return;
  const proj = unitOf(next.uid);
  if (proj && !isDead(proj)) void detonate(proj, next.actionId);
  else nextDetonation();
}

// Under More: every destroyed unit, folded, the ones already off the strip
// first. A row opens the unit's sheet.
function destroyedList(): string {
  const dead = table.tokens.filter(isDead);
  if (!dead.length) return '';
  const row = (u: Token) => `<button class="pad-seat" data-act="unit" data-uid="${u.uid}">
      <span class="pad-seat-name">${esc(u.label)}</span>
      <span class="pad-seat-tag">${esc(sideName(u.side))}${swept(u) ? '' : ' · this round'}</span></button>`;
  return `<details class="pad-fold"><summary class="pad-label pad-sec">Destroyed<b>${dead.length}</b></summary>
    ${[...dead.filter(swept), ...dead.filter((u) => !swept(u))].map(row).join('')}</details>`;
}

// The window's panel: one root the helper mounts into and keeps across
// redraws. Its markup never changes, so paint() never replaces the root.
function combatPanel(): string {
  return `<div class="pad-panel-in pad-combat"><div id="combat-body"></div><div id="ew-body"></div></div>`;
}

// n Yellow dice: the server's in a room, so both phones watch the same faces
// land; this phone's own solo. The Hits per die come from the printed faces.
// Every roll the pad makes comes through here, as die FACES. Three sources:
// the table's own dice read off and entered (the Dice setting), the server's
// in a room - a client that generates its own faces could simply choose them -
// and the pad's otherwise. A room still notes the roll when the dice were the
// table's, so Undo is sealed the same way whoever threw them.
async function rollDice(pool: Record<string, number>, label: string | undefined, kind: 'pool' | 'hits', groups?: RollGroup[]): Promise<RolledDie[]> {
  const dice = data?.dice;
  // The first-player roll and the Electronic Counter-roll come through here,
  // and the pad needs their numbers to go on - who plays first, who won the
  // contest - so at the table these are entered rather than left hands-off.
  // Backing out asks again: the roll cannot be skipped.
  if (table.tableDice && dice) {
    let entered = await askTableRoll(dice, pool, label, groups);
    while (entered === null) entered = await askTableRoll(dice, pool, label, groups);
    if (view.room && view.seat) send({ kind: 'noteRoll', seat: mySeat(), what: label ?? 'dice' });
    return entered;
  }
  if (view.room && view.seat) {
    const rolled = await relay.rollDice(pool, label, kind);
    send({ kind: 'noteRoll', seat: mySeat(), what: label ?? 'dice' });
    return rolled;
  }
  return Object.entries(pool).flatMap(([color, n]) =>
    Array.from({ length: n ?? 0 }, () => ({ color, face: Math.floor(Math.random() * (dice?.dice[color as DieColor]?.sides ?? 6)) })));
}

// Yellow dice, as face indices.
async function rollFaces(n: number, label: string, groups?: RollGroup[]): Promise<number[]> {
  try {
    return (await rollDice({ yellow: n }, label, 'hits', groups)).map((d) => d.face);
  } catch {
    toast('The server did not answer the roll.');
    return [];
  }
}

// Yellow dice, as the Hits each one shows: the first-player roll.
async function rollHits(n: number, label: string): Promise<number[]> {
  const yellow = data?.dice?.dice.yellow;
  const idx = await rollFaces(n, label);
  if (!yellow) return idx.map(() => 1);
  return idx.map((i) => countHits([yellow.faces[i] ?? []]));
}

// The damage ladder, freeplay's rule exactly: a Part with no Structure has no
// Damaged step and goes straight to Destroyed, and the cycle wraps so a state
// set by mistake costs one more tap rather than an Undo.
function nextState(t: Token, slot: PartSlot | 'main'): PartState {
  const st = t.partStates[slot] ?? 'intact';
  if (st === 'intact') return structureOf(data!, t, slot) > 0 ? 'damaged' : 'destroyed';
  if (st === 'damaged') return 'destroyed';
  return 'intact';
}

// A token as it is PRINTED. tokenFace picks the face the board would draw - a
// decaying token flips green/yellow to red - so the pad and the board show a
// unit wearing the same thing.
function tokenArt(id: string, expiring: boolean): string {
  const def = STATUS_BY_ID.get(id);
  const face = tokenFace(id, def?.decay, expiring);
  return face.art ? tokenPrintUrl(face.art) : '';
}

// ---------- the table bar ----------

// WHO HAS PRESSED CONTINUE. The Match Centre's phase turn is a two-player
// agreement, and OTTO wants the pad's to be one too: one player reading a
// card is not a player who agreed to move on. The engine's own agreement
// lives inside the guided script, which a record sheet has no way to satisfy
// (it would also wait for a designation loop nobody runs here), so the pad
// runs the same agreement itself on `state.ready`, which setReady writes and
// advancePhase clears. Solo has nobody to agree with and turns the phase.
function roundLimit(): number {
  return table.roundLimit ?? 5;
}

// Past the last round's End Phase the game is over: the round counter stands
// one past the limit, which travels with the table, so both phones agree.
function gameOver(): boolean {
  return table.round.n > roundLimit();
}

function scaleOf(): { name: string; points: number } {
  const s = SCALES.find((x) => x.id === (table.scale ?? 'standard')) ?? SCALES[1];
  return { name: s.name, points: s.points };
}

// The phase turn. Leaving the End Phase sweeps the Tokens (3.7.2) with it.
function advanceCmd(seat: Side): Command {
  return { kind: 'advancePhase', seat, sweep: table.round.phase === PHASES.length - 1 };
}

function afterAdvance(): void {
  toast(gameOver() ? 'Game over.' : `${PHASES[table.round.phase]} Phase, round ${table.round.n}.`);
}

function readiness(): { me: boolean; them: boolean } {
  const r = table.ready ?? {};
  return { me: !!r[mySeat()], them: !!r[otherSeat()] };
}

// Turns the phase once BOTH are ready - from ONE seat only. Both pads see the
// pair complete, one on its own press and one on the other's arriving, and
// two advancePhase commands would turn the phase twice. Seat 1 is the one
// that sends; seat 2's press is a setReady that seat 1 answers.
function maybeAdvance(): void {
  if (!view.room) return;
  if (wantsGuided() && !guidedOn(table)) return;
  if (guidedOn(table) && !continueAllowed(guide)) return;
  const rd = readiness();
  if (!rd.me || !rd.them || mySeat() !== 's1') return;
  if (send(advanceCmd('s1'))) afterAdvance();
}

function pressContinue(): void {
  if (gameOver()) return;
  if (guidedOn(table) && !continueAllowed(guide)) return;
  if (!view.room) {
    if (send(advanceCmd(mySeat()))) afterAdvance();
    return;
  }
  const me = mySeat();
  if (readiness().me) {
    // A second tap takes the readiness back, for the player who pressed
    // early and then found a Token to place.
    if (send({ kind: 'setReady', seat: me, ready: false })) toast('Not ready yet.');
    return;
  }
  if (!send({ kind: 'setReady', seat: me, ready: true })) return;
  if (!readiness().them) toast(`Waiting for ${sideName(otherSeat())} to continue.`);
  maybeAdvance();
}

function barHtml(): string {
  const room = view.room;
  const me = mySeat();
  const them = otherSeat();
  const vp = normaliseTasks(table.tasks).vp;
  let who: string;
  if (view.status === 'offline' && room) who = '<span class="pad-bar-warn">Reconnecting…</span>';
  else if (catchingUp) who = '<span class="pad-bar-dim">Catching up…</span>';
  else if (room) {
    const name = room.seats[them];
    who = `<span class="pad-dot${room.online[them] ? ' on' : ''}"></span><span class="pad-bar-name">${
      name ? esc(name) : `<span class="pad-bar-dim">${esc(room.id)}</span>`}</span>`;
  } else who = '<span class="pad-bar-name pad-bar-dim">Solo</span>';
  const r = table.round;
  const rd = readiness();
  if (gameOver()) {
    return `<div class="pad-bar-l" data-act="dock" data-dock="more" role="button">${who}</div>
    <button class="pad-bar-round over" data-act="dock" data-dock="tasks"><b>Game over</b><small>${roundLimit()} rounds</small></button>
    <button class="pad-bar-vp" data-act="dock" data-dock="tasks" title="Tasks and score">
      <b style="color:${sideColour(me)}">${vp[me]}</b><span>:</span><b style="color:${sideColour(them)}">${vp[them]}</b>
    </button>`;
  }
  const roundLabel = `<b>R${r.n}<i>/${roundLimit()}</i></b><small>${esc(PHASES[r.phase] ?? '')}</small>`;
  // In a room the chip is the Continue of a two-player agreement, and says
  // where the agreement stands; solo it simply turns the phase.
  const stalled = guidedOn(table) && !continueAllowed(guide);
  const state = stalled ? ' off' : !room ? '' : rd.me && !rd.them ? ' wait' : rd.them && !rd.me ? ' go' : '';
  const hint = !room ? '' : rd.me && !rd.them
    ? `<em>waiting for ${esc(sideName(them))}</em>`
    : rd.them && !rd.me ? `<em>${esc(sideName(them))} is ready</em>` : '<em>Continue</em>';
  return `<div class="pad-bar-l" data-act="dock" data-dock="more" role="button">${who}</div>
    <button class="pad-bar-round${state}" data-act="phase" title="${room ? (rd.me ? 'Waiting for the other player. Tap again to take it back.' : 'Ready to move on') : 'Next phase'}">
      ${roundLabel}${hint}
    </button>
    <button class="pad-bar-vp" data-act="dock" data-dock="tasks" title="Tasks and score">
      <b style="color:${sideColour(me)}">${vp[me]}</b><span>:</span><b style="color:${sideColour(them)}">${vp[them]}</b>
    </button>`;
}

// ---------- the unit strip ----------

function stripHtml(s: Side = shownSide()): string {
  const units = stripUnits(s);
  const t = unitFor(s);
  const colour = sideColour(s);
  if (!units.length) {
    return `<span class="pad-strip-empty">${s === mySeat() ? 'No units yet' : `${esc(sideName(s))} has no units yet`}</span>`;
  }
  const chip = (u: Token, sub = false) => `<button class="pad-tab${sub ? ' sub' : ''}${u.uid === t?.uid ? ' on' : ''}${isDead(u) ? ' dead' : ''}" style="--side:${colour}"
      data-act="unit" data-uid="${u.uid}"><span class="pad-tab-dot"></span>${esc(chipName(u))}</button>`;
  // Several of one card fold into one chip; it opens in place, and stays open
  // while one of its members is the sheet.
  const groups = new Map<string, Token[]>();
  for (const u of units) { const k = groupKey(u); if (k) groups.set(k, [...(groups.get(k) ?? []), u]); }
  const drawn = new Set<string>();
  return units.map((u) => {
    const k = groupKey(u);
    const g = k ? groups.get(k) ?? [] : [];
    if (!k || g.length < 2) return chip(u);
    if (drawn.has(k)) return '';
    drawn.add(k);
    const open = openGroup === k || (closedGroup !== k && g.some((m) => m.uid === t?.uid));
    const alive = g.filter((m) => !isDead(m)).length;
    const card = data?.byId.get(u.cardId);
    const head = `<button class="pad-tab group${open ? ' open' : ''}${!alive ? ' dead' : ''}" style="--side:${colour}" data-act="group" data-key="${esc(k)}" aria-expanded="${open}">
      <span class="pad-tab-dot"></span>${esc(card ? cardName(card) : u.label)}<b>×${g.length}</b><i>${open ? '▴' : '▾'}</i></button>`;
    return head + (open ? g.map((m) => chip(m, true)).join('') : '');
  }).join('');
}

// A Mech on the strip goes by its PILOT: two Mechs on the same Torso share a
// name, two pilots never do. The sheet's own title stays the unit's label.
function chipName(u: Token): string {
  if (u.kind !== 'mech' || !data) return u.label;
  const pilot = pilotCard(data, u);
  return pilot ? cardName(pilot) : u.label;
}

// ---------- the sheet ----------

function sheetHtml(s: Side = shownSide()): string {
  drawSide = s;
  if (!data) {
    return `<div class="pad-sheet-in"><p class="pad-status">${dataError ? esc(dataError) : 'Loading the card database…'}</p></div>`;
  }
  const t = unitFor(s);
  const top = `${errHtml()}`;
  if (!t) {
    const mineSide = solo || s === mySeat();
    return `<div class="pad-sheet-in">${top}
      <div class="pad-empty">
        <p class="pad-lead">${mineSide ? 'Nothing on this side of the table yet.' : `Waiting for ${esc(actorName(s))} to add a squad.`}</p>
        ${mineSide ? `<button class="pad-btn primary" data-act="add-squad" data-side="${s}">Add a squad</button>` : ''}
      </div>
    </div>`;
  }
  const mine = canCommand(t);
  const yours = t.side === mySeat();
  const link = t.link ?? 0;
  // A Mech whose Torso is destroyed is out of the game (4.4.4): no Link to
  // spend, no Stance to hold, no Ammo or Charge to track. The Parts stay, for
  // the record, and the damage marks still work.
  const wrecked = (t.partStates[t.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed';
  const isMech = t.kind === 'mech' && !wrecked;
  return `<div class="pad-sheet-in">${top}
    ${unitHead(t, yours)}
    ${isMech ? `<div class="pad-row">
      <span class="pad-label">Link</span>
      <div class="pad-count">
        ${mine ? '<button class="pad-step" data-act="link-down" aria-label="Spend 1 Link">−</button>' : ''}
        <span class="pad-num">${link}<span class="pad-of"> / ${maxLink(data, t)}</span></span>
        ${mine ? '<button class="pad-step" data-act="stabilise" aria-label="Stabilize System">+</button>' : ''}
      </div>
    </div>` : ''}
    ${mine && isMech && t.stance === 'shutdown' ? `<div class="pad-row wrap">
      <span class="pad-label">Reboot to</span>
      <div class="pad-stances">${STANCES.filter((x) => x !== 'shutdown').map((x) => stanceBtn(x, false, `data-act="reboot" data-stance="${x}"`)).join('')}</div>
    </div>` : ''}
    ${mine && isMech && t.stance !== 'shutdown' ? `<div class="pad-row wrap">
      <span class="pad-label">Stance</span>
      <div class="pad-stances">${STANCES.map((x) => stanceBtn(x, t.stance === x, `data-act="stance" data-stance="${x}"`)).join('')}</div>
    </div>` : ''}
    ${mine && isMech && t.stance !== 'shutdown' && !guidedOn(table) ? `<div class="pad-row wrap">
      <span class="pad-label">Timing · this phone</span>
      <div class="pad-chips pad-dials">${TIMINGS.map((tm) => {
        const init = initiativeFor(data!, t, tm.id);
        // setTiming is a SECRET command (never published): on a free table the
        // dial is this phone's own note, set in the Planning Phase (3.3). The
        // physical dial on the table is what the other player reads.
        const ic = actionIconUrl(tm.pilotKey);
        return `<button class="pad-chip pad-dial${t.timing === tm.id ? ' on' : ''}" data-act="timing" data-timing="${tm.id}"${table.round.phase === 1 ? '' : ' disabled'}>${ic ? `<img src="${ic}" alt="">` : ''}${tm.short}${init !== undefined ? ` ${init}` : ''}</button>`;
      }).join('')}</div>
    </div>` : ''}

    ${statStrip(t)}
    ${(() => { const list = actionList(t, mine && !wrecked); return list ? `<details class="pad-fold pad-acts-fold"${sheetView[drawSide].acts ? ' open' : ''}><summary class="pad-label pad-sec">Actions</summary>${list}</details>` : ''; })()}

    <p class="pad-label pad-sec">Parts</p>
    ${partRows(t)}

    ${mine && !wrecked && ammoRows(t) ? `<p class="pad-label pad-sec">Ammo</p>${ammoRows(t)}` : ''}
    ${mine && !wrecked && interceptRows(t) ? `<p class="pad-label pad-sec">Intercept</p>${interceptRows(t)}` : ''}
    ${mine && !wrecked && !guidedOn(table) && loadRow(t) ? `<p class="pad-label pad-sec">Load</p>${loadRow(t)}` : ''}
    ${mine && !wrecked && chargeRow(t) ? `<p class="pad-label pad-sec">Charge</p>${chargeRow(t)}` : ''}

    <p class="pad-label pad-sec">Tokens</p>
    ${tokenRow(t)}
  </div>`;
}

// ---------- the unit's numbers, added up the way the rules add them ----------
//
// The cards give the numbers per Part; the table asks for the unit's. Dodge is
// the Blue dice a Mobility Stance defence rolls: the sum over intact Parts.
// Parry is the sum of what the surviving Parts can Parry with. Electronic
// and Move come through the engine's own readers, so a transformed Torso or
// a Mobility doubling reads here exactly as it does in combat. Armor stays on
// the Part rows, because a hit lands on a Part.
function statStrip(t: Token): string {
  const d = data!;
  const cards = tokenCards(d, t).filter((c) => c.slot !== 'pilot');
  const live = cards.filter((c) => (t.partStates[c.slot as PartSlot | 'main'] ?? 'intact') !== 'destroyed');
  const chip = (field: string, value: number | string, label: string) => {
    const ic = statIconUrl(field);
    const mark = ic
      ? statIconIsPlated(field) ? `<img class="stat-plate" src="${ic}" alt="">` : `<span class="stat-mark" style="--src:url(${ic})"></span>`
      : '';
    const zero = Number(value) === 0 ? ' zero' : '';
    return `<div class="ds">${mark}<span class="dsv"><b class="${field === 'structure' ? `boxed${zero}` : zero.trim()}">${value}</b><i>${esc(label)}</i></span></div>`;
  };
  const points = cards.reduce((n, c) => n + (c.card.score ?? 0), 0) + (t.kind === 'mech' ? (pilotCard(d, t)?.score ?? 0) : 0);
  const structure = live.reduce((n, c) => n + ((t.partStates[c.slot as PartSlot | 'main'] ?? 'intact') === 'intact' ? (c.card.structure ?? 0) : 0), 0);
  const dodge = live.reduce((n, c) => n + (c.card.dodge ?? 0), 0);
  const parry = parryParts(d, t, { melee: true, backAttack: false }).reduce((n, p) => n + p.value, 0);
  return `<div class="ref-stats pad-stats">
    ${chip('score', points, 'Points')}
    ${chip('structure', structure, 'Structure')}
    ${chip('dodge', dodge, 'Dodge')}
    ${chip('parray', parry, 'Parry')}
    ${chip('electronic', electronicValue(d, t), 'Electronic')}
    ${chip('move', maneuverRange(d, t), 'Move')}
  </div>`;
}

// EVERY action the unit has, in one list, grouped the way the Timing Dial is
// read - Swift, Melee, Projectile, Firing, Movement, Tactical - with the ones
// the dial never sets (Automatic, Command, Passive) last. Each row is the
// reference's own action block with its body folded; a tap unfolds it. What
// the unit cannot do right now (a destroyed Part, no Ammo, Shutdown) is
// dimmed and says why, in the engine's words.
// The pad takes a free hand whenever the unit has one for the Action - the
// window resolves the attack that way - so the payment is told the same, and
// a card that performs Two-Handed at a shorter length is charged that length.
function bothHands(t: Token, actionId: string): { twoHanded?: true } {
  if (!data) return {};
  const a = tokenCards(data, t).flatMap((c) => c.card.actions ?? []).find((x) => x.id === actionId);
  return a && twoHandedUse(data, t, a) ? { twoHanded: true } : {};
}

function actionList(t: Token, mine: boolean): string {
  const d = data!;
  const acts = guidedActions(d, t);
  if (!acts.length) return '';
  const order = new Map<string, number>(TIMINGS.map((x, i) => [x.id, i]));
  const rank = (a: (typeof acts)[number]) => {
    const dialless = a.action.speed === 'auto' || a.action.speed === 'command' || a.action.speed === 'passive';
    const tm = dialless ? undefined : timingOf(a.action);
    return (tm !== undefined ? order.get(tm) ?? 90 : 99) * 10 + (['short', 'medium', 'long'].indexOf(lengthOf(a.action) ?? 'long') + 1);
  };
  const sorted = [...acts].sort((x, y) => rank(x) - rank(y));
  let lastGroup = '';
  const rows: string[] = [];
  for (const g of sorted) {
    const dialless = g.action.speed === 'auto' || g.action.speed === 'command' || g.action.speed === 'passive';
    const tm = dialless ? undefined : timingOf(g.action);
    const group = tm ? (TIMINGS.find((x) => x.id === tm)?.name ?? tm) : 'Automatic and Command';
    if (group !== lastGroup) {
      rows.push(`<p class="pad-label pad-sec pad-act-group">${esc(group)}</p>`);
      lastGroup = group;
    }
    const open = sheetView[drawSide].action === g.action.id;
    const len = lengthOf(twoHandedUse(d, t, g.action)?.action ?? g.action);
    // The Part by NAME as well as slot: two arms can print the same "Single
    // Shot", and the Laser and the Ion one are told apart by the weapon.
    const meta = [
      SLOT_LABEL[g.slot] ?? g.slot,
      t.kind === 'mech' && g.slot !== 'pilot' ? cardName(g.card) : '',
      len ? LENGTH_NAME[len] : '',
      g.ammoLeft !== undefined ? `Ammo ${g.ammoLeft}` : '',
      g.intercept ? `Intercept ${g.intercept.left}` : '',
      g.charge ? (g.charge.charged ? 'Charged' : 'No Charge') : '',
    ].filter(Boolean).join(' · ');
    const perform = guidedOn(table)
      ? performButton(guide, t, g.action, g.partKey)
      // A Projectile's Detonation, and a Passive that IS a blast: a Mine's
      // Trigger and the Explosive Wall's Self-Destruct print dice or an
      // Explosion and fire off the table (a Ground Unit entering the Grid, the
      // Wall being destroyed). The table says when; the pad resolves it.
      : (mine && g.available && t.kind === 'projectile' && (g.action.type !== 'Passive' || blastsOnItsOwn(g.action))
        ? `<button class="pad-chip on pad-perform" data-act="detonate" data-id="${esc(g.action.id)}">${g.action.type === 'Passive' ? 'Trigger' : 'Detonate'}</button>`
        : mine && g.available && isAttackAction(g.action)
        ? `<button class="pad-chip on pad-perform" data-act="attack" data-uid="${t.uid}" data-id="${esc(g.action.id)}">Attack</button>`
        : mine && g.available && isElectronicAttack(g.action)
          ? `<button class="pad-chip on pad-perform" data-act="attack" data-mode="electronic" data-uid="${t.uid}" data-id="${esc(g.action.id)}">Electronic</button>`
          : mine && g.available && targetStatusGrant(g.action)
            // Target Tag and its like: a Tactic that puts a Token on a chosen
            // unit. Freeform pays no Ticks, so the button only asks who.
            ? `<button class="pad-chip on pad-perform" data-act="tag" data-uid="${t.uid}" data-id="${esc(g.action.id)}">Use</button>`
          : mine && g.available && g.projectiles.length
            ? g.projectiles.map((p) => `<button class="pad-chip on pad-perform" data-act="launch" data-id="${esc(g.action.id)}" data-projectile="${esc(p.id)}">Launch${g.projectiles.length > 1 ? ` ${esc(cardName(p))}` : ''}</button>`).join('')
            : '');
    rows.push(`<div class="pad-act${open ? ' open' : ''}${g.available ? '' : ' off'}" data-act="open-action" data-id="${esc(g.action.id)}" role="button" aria-expanded="${open}">
      ${actionBlock(g.card, g.action)}
      <div class="pad-act-meta">${esc(meta)}${!g.available && g.reason ? ` · <em>${esc(g.reason)}</em>` : ''}${perform ? `<span class="pad-act-go">${perform}</span>` : ''}</div>
    </div>`);
  }
  rows.push(...commonRows(t, mine));
  return `<div class="pad-acts">${rows.join('')}</div>`;
}

// The Common Actions (6.1) plus Remote Access (5.3.3): every Mech has them
// beside what its Parts print, folded under their own heading, closed until
// opened. Only what this Mech can ever use is listed: Charge needs a Part
// with a Charge Icon, Discard a Handheld Part, Reveal the Optical Camouflage
// State, Remote Access a Terminal on the table - a Mech without them never
// sees the row. A destroyed Part dims a row rather than hiding it. The pad
// does not pay Ticks on a free table, so there a row only offers what has a
// tool - the attack window for the Punch, the counter-roll for the Scan, the
// Link for Stabilize, the reveal for Reveal.
// The card in a slot, by name, for a question that lists Parts.
function partName(t: Token, slot: string): string {
  const id = t.mech?.[slot as PartSlot];
  const card = id ? data?.byId.get(id) : undefined;
  return card ? cardName(card) : slot;
}

// |Discard| (6.1, 4.17): a Handheld Part goes to its Discard Card. The flip is
// the engine's `disarm`, aimed at the Mech's own Part - the same procedure the
// book gives a forced Disarm.
async function pickDiscard(t: Token): Promise<string | null> {
  if (!data) return null;
  const held = tokenCards(data, t).filter(({ slot, card }) => slot !== 'pilot'
    && (t.partStates[slot as PartSlot] ?? 'intact') !== 'destroyed' && !!discardFaceOf(data!, card));
  if (!held.length) { toast(`${t.label} holds nothing it can Discard.`); return null; }
  // Always asked, even with one Part to name: a Discard is not taken back by
  // tapping again, the way a Charge Token is.
  return choiceDialog({ title: 'Discard', choices: [...held.map((x) => ({ id: String(x.slot), label: `${SLOT_LABEL[x.slot] ?? x.slot} · ${cardName(x.card)}` })), { id: '__no', label: 'Cancel', cancel: true }], stacked: true })
    .then((pick) => (pick === '__no' ? null : pick));
}

async function discardPart(t: Token): Promise<void> {
  const slot = await pickDiscard(t);
  if (slot !== null) send({ kind: 'disarm', seat: t.side, uid: t.uid, targetUid: t.uid, slot });
}

function commonRows(t: Token, mine: boolean): string[] {
  const d = data!;
  if (t.kind !== 'mech' || !t.mech) return [];
  if ((t.partStates.torso ?? 'intact') === 'destroyed') return [];
  const intact = (s: string) => !!t.mech?.[s as PartSlot] && (t.partStates[s as PartSlot] ?? 'intact') !== 'destroyed';
  const torso = d.byId.get(t.mech.torso ?? '');
  const rows: string[] = [];
  const relevant = (a: CardAction): boolean => {
    if (a.id === 'COMMON_CHARGE') return chargeableSlots(d, t).length > 0;
    if (a.id === 'COMMON_DISCARD') return tokenCards(d, t).some(({ slot, card }) => slot !== 'pilot' && !!discardFaceOf(d, card));
    if (a.id === 'COMMON_REVEAL') return (t.statuses ?? []).includes('camouflage');
    if (a.id === 'COMMON_REMOTE_ACCESS') return missionOf()?.family === 'terminal';
    return true;
  };
  const acts = d.commonActions.filter((a) => a.type !== 'Passive' && relevant(a));
  if (!acts.length) return [];
  for (const a of acts) {
    const slots = (a as { slots?: string[] }).slots ?? [];
    const reason = slots.length && !slots.some(intact) ? 'No intact Part can perform this.' : undefined;
    const available = !reason;
    const open = sheetView[drawSide].action === a.id;
    const len = lengthOf(a);
    const tm = timingOf(a);
    const meta = [
      slots.map((s) => SLOT_LABEL[s] ?? s).join(' / '),
      tm ? (TIMINGS.find((x) => x.id === tm)?.name ?? tm) : '',
      len ? LENGTH_NAME[len] : '',
    ].filter(Boolean).join(' · ');
    const perform = guidedOn(table)
      ? performButton(guide, t, a, a.id)
      : (mine && available && a.type === 'Melee'
        ? `<button class="pad-chip on pad-perform" data-act="attack" data-uid="${t.uid}" data-id="${esc(a.id)}">Attack</button>`
        : mine && available && a.id === 'COMMON_SCAN'
          ? `<button class="pad-chip on pad-perform" data-act="attack" data-mode="electronic" data-uid="${t.uid}" data-id="${esc(a.id)}">Electronic</button>`
          : mine && available && a.id === 'COMMON_STABILIZE'
            ? `<button class="pad-chip on pad-perform" data-act="stabilise">Stabilize</button>`
            : mine && available && a.id === 'COMMON_REVEAL'
              ? `<button class="pad-chip on pad-perform" data-act="reveal">Reveal</button>`
              // Charge and Discard act on a PART, so the row asks which one. The
              // Charge strip lower on the sheet still flips a token by hand, but
              // nothing tied it to this Action and the row looked inert.
              : mine && available && a.id === 'COMMON_CHARGE'
                ? (chargeableSlots(d, t).some((x) => !x.charged)
                  ? `<button class="pad-chip on pad-perform" data-act="charge-pick">Charge</button>`
                  : '<span class="pad-perform-no">Every Part is Charged</span>')
                : mine && available && a.id === 'COMMON_DISCARD'
                  ? `<button class="pad-chip on pad-perform" data-act="discard-pick">Discard</button>`
                  : '');
    rows.push(`<div class="pad-act${open ? ' open' : ''}${available ? '' : ' off'}" data-act="open-action" data-id="${esc(a.id)}" role="button" aria-expanded="${open}">
      ${torso ? actionBlock(torso, a) : ''}
      <div class="pad-act-meta">${esc(meta)}${reason ? ` · <em>${esc(reason)}</em>` : ''}${perform ? `<span class="pad-act-go">${perform}</span>` : ''}</div>
    </div>`);
  }
  return [`<details class="pad-fold pad-common-fold" data-fold="common-${drawSide}"${foldOpen(`common-${drawSide}`) ? ' open' : ''}>
      <summary><span class="pad-label pad-sec pad-act-group">Common Actions</span><b>${acts.length}</b></summary>
      ${rows.join('')}
    </details>`];
}

// The unit as it LOOKS: its Parts stacked into one picture, in the order the
// board and the squad panel stack them, with the pilot's portrait beside it
// and the name between. A destroyed arm or backpack drops out of the picture,
// as it does on the board; the core stays, wrecked or not.
function unitArt(t: Token): string {
  const layers: string[] = [];
  if (t.kind === 'mech' && t.mech) {
    for (const slot of MECH_LAYER_ORDER) {
      const id = t.mech[slot];
      if (!id) continue;
      if (t.partStates[slot] === 'destroyed' && slot !== 'torso' && slot !== 'chasis') continue;
      layers.push(mechPartUrl(id));
    }
  }
  if (!layers.length && t.cardId) layers.push(tabImageUrl(t.cardId));
  if (!layers.length) return '';
  return `<span class="pad-mech-art" aria-hidden="true">${layers.map((h) => `<img src="${esc(h)}" alt="" />`).join('')}</span>`;
}

function unitHead(t: Token, yours: boolean): string {
  const cards = tokenCards(data!, t);
  const core = cards.find((c) => c.slot === 'torso' || c.slot === 'main')?.card;
  const fac = core ? data!.factionOf(core) : null;
  const pilot = t.kind === 'mech' ? pilotCard(data!, t) : undefined;
  const line = [sideName(t.side), KIND_LABEL[t.kind], t.kind === 'mech' ? STANCE_LABEL[t.stance] ?? t.stance : ''].filter(Boolean).join(' · ');
  return `<div class="pad-uhead card-framed"${fac ? ` data-fac="${esc(fac)}"` : ''}>
    ${unitArt(t)}
    <div class="pad-uhead-t">
      <h1 class="pad-h">${esc(t.label)}</h1>
      <p class="pad-lead">${esc(line)}</p>
      ${canCommand(t) ? `<button class="pad-chip pad-rename" data-act="rename">Rename</button>${t.kind === 'mech' ? '<button class="pad-chip pad-rename" data-act="save-build">Save build</button>' : ''}<button class="pad-chip pad-rename" data-act="remove">Remove</button>` : ''}
    </div>
    ${pilot ? `<button class="pilot-thumb pad-uhead-pilot" data-act="card" data-id="${esc(pilot.id)}" data-portrait="${esc(pilot.id)}" aria-label="Read ${esc(cardName(pilot))}"></button>` : ''}
  </div>`;
}

// The Parts, one row each, as the reference draws a card: the faction glow and
// the Part's own art ghosted behind the name. The row OPENS to show the Part's
// Actions through the reference's own action renderer; the mark at its right
// cycles the damage state; the `i` opens the whole card.
function partRows(t: Token): string {
  const cards = tokenCards(data!, t);
  const rows: string[] = [];
  if (t.kind === 'mech') {
    const pilot = cards.find((c) => c.slot === 'pilot')?.card;
    if (pilot) rows.push(pilotRow(pilot));
  }
  const slots: (PartSlot | 'main')[] = t.kind === 'mech' ? SLOTS : ['main', 'backpack'];
  for (const slot of slots) {
    const card = cards.find((c) => c.slot === slot)?.card;
    if (card) rows.push(partRow(t, slot, card));
  }
  return rows.join('');
}

function partRow(t: Token, slot: PartSlot | 'main', card: Card): string {
  const st = t.partStates[slot] ?? 'intact';
  const fac = data!.factionOf(card);
  const open = sheetView[drawSide].slot === slot;
  const stats: string[] = [];
  if (card.armor) stats.push(`A${card.armor}`);
  if (card.structure) stats.push(`S${card.structure}`);
  if (card.move) stats.push(`M${card.move}`);
  return `<div class="pad-prow${open ? ' open' : ''}">
    <div class="pad-part-row">
      <button class="pad-part card-framed pt-${st}"${fac ? ` data-fac="${esc(fac)}"` : ''} data-act="open" data-slot="${slot}" aria-expanded="${open}">
        <span class="ref-art" data-partart="${esc(card.id)}" aria-hidden="true"></span>
        <span class="pad-part-slot">${SLOT_LABEL[slot]}</span>
        <span class="pad-part-name">${esc(cardName(card))}</span>
        ${stats.length ? `<span class="pad-part-stats mono">${stats.join(' ')}</span>` : ''}
      </button>
      <button class="pad-part-state pt-${st}" data-act="hit" data-slot="${slot}" aria-label="${esc(cardName(card))} is ${STATE_LABEL[st]}. Mark the next state">${STATE_MARK[st]}</button>
      <button class="pad-part-info" data-act="card" data-id="${esc(card.id)}" aria-label="Read ${esc(cardName(card))}">i</button>
    </div>
    ${open ? `<div class="pad-part-open">${partOpen(card, st)}</div>` : ''}
  </div>`;
}

// What an open Part row shows: its Actions, exactly as the reference prints
// them, and the keywords on the card as links into the glossary.
function partOpen(card: Card, st: PartState): string {
  const acts = (card.actions ?? []).map((a) => actionBlock(card, a)).join('');
  const kws = [...new Set((card.keywords ?? []).map(kwLabel).filter(Boolean))]
    .map((label) => `<a class="kw-link" data-kw="${esc(label)}">${esc(label)}</a>`)
    .join('');
  const text = card.description?.en?.trim() && !/[぀-ヿ一-鿿]/.test(card.description.en) ? card.description.en : '';
  return `${acts || '<p class="ref-note">No Actions on this Part.</p>'}
    ${text ? `<div class="ref-cardtext"><p>${linkKeywords(text).replace(/\n/g, '<br>')}</p></div>` : ''}
    ${kws ? `<div class="ref-kwlinks">${kws}</div>` : ''}`;
}

// The pilot, as a row with the portrait the reference's tiles carry. Opens to
// the Pilot Trait, through the reference's own block.
function pilotRow(pilot: Card): string {
  const open = sheetView[drawSide].slot === 'pilot';
  const fac = data!.factionOf(pilot);
  return `<div class="pad-prow${open ? ' open' : ''}">
    <div class="pad-part-row">
      <button class="pad-part pad-part-pilot card-framed"${fac ? ` data-fac="${esc(fac)}"` : ''} data-act="open" data-slot="pilot" aria-expanded="${open}">
        <span class="pilot-thumb pad-pilot-thumb" data-portrait="${esc(pilot.id)}"></span>
        <span class="pad-part-slot">Pilot</span>
        <span class="pad-part-name">${esc(cardName(pilot))}</span>
        ${pilot.trait ? `<span class="pad-part-stats">${esc(traitName(pilot))}</span>` : ''}
      </button>
      <button class="pad-part-info" data-act="card" data-id="${esc(pilot.id)}" aria-label="Read ${esc(cardName(pilot))}">i</button>
    </div>
    ${open ? `<div class="pad-part-open">${traitBlock(pilot) || '<p class="ref-note">No trait on this pilot.</p>'}</div>` : ''}
  </div>`;
}

function tokenRow(t: Token): string {
  // statusStacks counts what the unit is ACTUALLY wearing, including a token
  // whose definition does not list this unit's kind. The PICKER keeps the
  // statusesFor filter, because that list is about what may be put ON.
  const worn = statusStacks(t.statuses);
  const expiring = new Set(t.expiring ?? []);
  const chips = worn.map(({ def, n }) => {
    const art = tokenArt(def.id, expiring.has(def.id));
    return `<button class="pad-tok${sheetView[drawSide].tokManage === def.id ? ' on' : ''}${expiring.has(def.id) ? ' red' : ''}" data-act="tok" data-tok="${esc(def.id)}" title="${esc(def.label)}">
      ${art ? `<img src="${esc(art)}" alt="${esc(def.label)}" />` : `<span class="pad-tok-txt">${esc(def.icon)}</span>`}
      ${n > 1 ? `<span class="pad-tok-n">${n}</span>` : ''}
    </button>`;
  }).join('');
  const tokPick = sheetView[drawSide].tokPick;
  const tokManage = sheetView[drawSide].tokManage;
  const managed = tokManage ? worn.find((w) => w.def.id === tokManage)?.def : null;
  const add = statusesFor(t.kind).map((d) => {
    const art = tokenArt(d.id, false);
    return `<button class="pad-tok pad-tok-pick" data-act="tok-add" data-tok="${esc(d.id)}">
      ${art ? `<img src="${esc(art)}" alt="" />` : `<span class="pad-tok-txt">${esc(d.icon)}</span>`}
      <span class="pad-tok-name">${esc(d.label)}</span>
    </button>`;
  }).join('');
  return `<div class="pad-toks">
      ${chips}
      <button class="pad-tok pad-tok-add${tokPick ? ' on' : ''}" data-act="tok-open" aria-label="Place a Token">+</button>
    </div>
    ${managed ? `<div class="pad-tokpop pad-tokinfo">
      <div class="pad-tokinfo-head">
        <b>${esc(managed.label)}</b>
        <button class="pad-chip" data-act="tok-drop" data-tok="${esc(managed.id)}">Take the Token off</button>
        <button class="pad-chip" data-act="tok-close">Close</button>
      </div>
      <p class="pad-tokinfo-rule">${linkKeywords(managed.rule)}</p>
    </div>` : ''}
    ${tokPick ? `<div class="pad-tokpop">${add}</div>` : ''}`;
}

// Ammo is keyed by the Action that spends it, and only the pools a unit
// actually tracks are listed.
function ammoRows(t: Token): string {
  return Object.entries(t.ammo ?? {}).map(([id, n]) => `<div class="pad-row">
      <span class="pad-part-name">${esc(names()?.action?.(t.uid, id) ?? id)}</span>
      <div class="pad-count">
        <button class="pad-step" data-act="ammo-down" data-id="${esc(id)}">−</button>
        <span class="pad-num">${n}</span>
        <button class="pad-step" data-act="ammo-up" data-id="${esc(id)}">+</button>
      </div>
    </div>`).join('');
}

// Interception Tokens (4.9), one pool per Action that carries them. Spent
// only: the rule never gives them back, and Undo covers a slip.
function interceptRows(t: Token): string {
  const cards = tokenCards(data!, t);
  return Object.entries(t.intercept ?? {}).map(([id, n]) => {
    const action = cards.flatMap((c) => c.card.actions ?? []).find((a) => a.id === id);
    const cap = action ? interceptCapacity(action) : undefined;
    return `<div class="pad-row">
      <span class="pad-part-name">${esc(names()?.action?.(t.uid, id) ?? id)}</span>
      <div class="pad-count">
        <button class="pad-step" data-act="intercept-down" data-id="${esc(id)}"${n > 0 ? '' : ' disabled'}>−</button>
        <span class="pad-num">${n}${cap !== undefined ? `<span class="pad-of"> / ${cap}</span>` : ''}</span>
        <button class="pad-step" data-act="intercept-up" data-id="${esc(id)}"${cap !== undefined && n >= cap ? ' disabled' : ''}>+</button>
        <button class="pad-chip on pad-perform" data-act="intercept" data-id="${esc(id)}"${n > 0 ? '' : ' disabled'}>Intercept</button>
      </div>
    </div>`;
  }).join('');
}

// Only the Parts that have an Action spending a Charge Token (4.14).
function chargeRow(t: Token): string {
  const slots = chargeableSlots(data!, t);
  if (!slots.length) return '';
  return `<div class="pad-chips">${slots.map((s) => `<button class="pad-chip${s.charged ? ' on' : ''}"
    data-act="charge" data-slot="${esc(s.slot)}" data-on="${s.charged ? '0' : '1'}">${esc(s.label)}</button>`).join('')}</div>`;
}

// ---------- the dock ----------

function dockHtml(): string {
  const me = mySeat();
  const them = otherSeat();
  const lit: string = panel ?? (shownSide() === me ? 'yours' : 'theirs');
  const item = (id: string, label: string, extra = '') =>
    `<button class="pad-dock-b${lit === id ? ' on' : ''}" data-act="dock" data-dock="${id}" aria-pressed="${lit === id}">${extra}<span>${label}</span></button>`;
  const dot = (s: Side) => `<span class="pad-dock-dot" style="background:${sideColour(s)}"></span>`;
  return item('yours', seatTag(me), dot(me))
    + item('theirs', seatTag(them), dot(them))
    + item('tasks', 'Tasks')
    + item('find', 'Find')
    + item('more', 'More');
}

// ---------- the panels ----------

function panelHtml(): string {
  if (!data) return `<div class="pad-panel-in"><p class="pad-status">Loading the card database…</p></div>`;
  if (panel === 'setup') return setupPanel();
  if (panel === 'target') return targetPanel();
  if (panel === 'combat') return combatPanel();
  if (panel === 'tasks') return tasksPanel();
  if (panel === 'find') return findPanel();
  if (panel === 'build') return buildPanel();
  if (panel === 'inventory') return inventoryPanel();
  return morePanel();
}

function panelHead(title: string): string {
  return `<div class="pad-panel-head">
    <h2 class="pad-h">${esc(title)}</h2>
    <button class="dlg-close pad-panel-x" data-act="close-panel" aria-label="Close">✕</button>
  </div>`;
}

// ---------- table setup ----------
//
// Rounds and battle scale, both configureTable fields the table already
// carries, so a guest sees the host's choice and either may change it.

function setupPanel(): string {
  const limit = roundLimit();
  const rounds = [...new Set([3, 4, 5, 6, limit])].sort((a, b) => a - b);
  return `<div class="pad-panel-in">${panelHead(view.room ? 'Table' : 'Game')}
    ${errHtml()}
    <p class="pad-label pad-sec" style="margin-top:0">Rounds</p>
    <div class="pad-chips">${rounds.map((n) => `<button class="pad-chip${n === limit ? ' on' : ''}" data-act="set-rounds" data-n="${n}">${n}</button>`).join('')}</div>
    <p class="pad-label pad-sec">Points</p>
    <div class="pad-chips">${SCALES.map((s) => `<button class="pad-chip${(table.scale ?? 'standard') === s.id ? ' on' : ''}" data-act="set-scale" data-id="${s.id}">${s.points}<span class="fc-n">${esc(s.name)}</span></button>`).join('')}</div>
    <p class="pad-label pad-sec">Play</p>
    <div class="pad-chips">
      <button class="pad-chip${wantsGuided() || guidedOn(table) ? '' : ' on'}" data-act="set-mode" data-mode="free"${guidedOn(table) ? ' disabled' : ''}>Freeform</button>
      <button class="pad-chip${wantsGuided() || guidedOn(table) ? ' on' : ''}" data-act="set-mode" data-mode="guided"${guidedOn(table) ? ' disabled' : ''}>Guided</button>
    </div>
    <p class="pad-label pad-sec">Dice</p>
    <div class="pad-chips">
      <button class="pad-chip${table.tableDice ? ' on' : ''}" data-act="set-dice" data-dice="table" aria-pressed="${!!table.tableDice}">Table rolls</button>
      <button class="pad-chip${table.tableDice ? '' : ' on'}" data-act="set-dice" data-dice="pad" aria-pressed="${!table.tableDice}">Pad rolls</button>
    </div>
    <p class="pad-label pad-sec">Layout</p>
    <div class="pad-chips">${data!.terrain.maps.map((m) => `<button class="pad-chip${table.map === m.id ? ' on' : ''}" data-act="set-layout" data-id="${esc(m.id)}">${esc(m.name.en || m.id)}</button>`).join('')}<button class="pad-chip${table.map ? '' : ' on'}" data-act="set-layout" data-id="">None</button></div>
    <div class="pad-foot">
      <button class="pad-btn primary" data-act="${wantsGuided() && !guidedOn(table) ? 'g-start' : 'close-panel'}">${
        wantsGuided() && !guidedOn(table) ? (view.room && readiness().me ? 'Waiting for the other player…' : 'Start the guided game') : 'Start'}</button>
    </div>
    ${overrideHtml()}
  </div>`;
}

// A running Guided game, corrected or left behind. Both are the HOST's: a
// correction changes what both players agreed to, and leaving Guided cannot be
// taken back. The other player is only told the state.
function overrideHtml(): string {
  if (!guidedOn(table)) return '';
  const host = solo || view.host;
  const on = !!table.unlocked;
  if (!host) return on ? '<p class="pad-note">The host has unlocked the game: the Tasks, the layout and the squads can be changed.</p>' : '';
  return `<p class="pad-label pad-sec">Override</p>
    <button class="pad-btn${on ? ' primary' : ''}" data-act="unlock" data-on="${on ? '0' : '1'}" aria-pressed="${on}">${on ? 'Unlocked · tap to lock' : 'Unlock'}</button>
    ${on ? '<p class="pad-note">The Main Task, the layout and the squads can now be changed, though Guided play normally settles them. Lock it again when the correction is made.</p>' : ''}
    <button class="pad-btn" data-act="leave-guided">Switch to Freeform</button>`;
}

// ---------- tasks ----------
//
// The pad shows which Task each squad is playing and the card itself; the
// players read it and keep their own VP. Everything that tried to derive a
// score from a board the pad does not have was doing arithmetic on guesses.

function missionOf() {
  return data && table.mission ? data.missions.cards.find((c) => c.id === table.mission) : undefined;
}

function secondaryOf(s: Side) {
  const id = normaliseTasks(table.tasks).secondary[s];
  return id && data ? data.secondary.find((c) => c.id === id) : undefined;
}

function taskCard(attr: string, art: string, name: string, text: string, tag: string): string {
  return `<button class="pad-task" ${attr}>
    <img class="pad-task-art" src="${esc(art)}" alt="" loading="lazy" />
    <span class="pad-task-body">
      <span class="pad-task-name">${esc(name)}</span>
      ${text ? `<span class="pad-task-text">${esc(text)}</span>` : ''}
    </span>
    <span class="pad-task-tag">${esc(tag)}</span>
  </button>`;
}

// What a side's Tasks were pointed at when they were designated: the enemy
// Mech a Bounty names, a Leader, a Tactical Zone. Chosen once in setup and
// not shown again anywhere, so a player could not check it mid-game.
// Three Main Task cards dealt; each squad discards one on Tasks (3.1.3).
function drawThree(): void {
  if (!data) return;
  const pool = [...data.missions.cards.map((c) => c.id)];
  const three: string[] = [];
  while (three.length < 3 && pool.length) three.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  send({ kind: 'configureTable', seat: mySeat(), tasks: { ...normaliseTasks(table.tasks), draw: three, drawDiscards: {} } });
}

// The engine freezes the Main Task once the table edges are picked (FAQ P1).
function mainTaskLocked(): boolean {
  return tasksLocked(normaliseSetup(table.setup)) && !table.unlocked;
}

// Whatever a side's Task still needs named, asked one after another. Each
// answer takes one off the list; backing out of a question stops the asking
// and leaves the Choose button on the Tasks card.
async function askOwed(forSide: Side): Promise<void> {
  let left = designationsFor(guide, forSide);
  while (left.length) {
    await askDesignation(guide, left[0]);
    const now = designationsFor(guide, forSide);
    if (now.length >= left.length) break;
    left = now;
  }
}

function designated(s: Side): string {
  const tasks = normaliseTasks(table.tasks);
  // One row per thing the Task was pointed at: a small label, the name, and
  // for a unit a View button that goes to its sheet.
  const row = (label: string, value: string, tail = '') =>
    `<div class="pad-desig"><span class="pad-desig-k">${esc(label)}:</span><span class="pad-desig-v">${esc(value)}</span>${tail}</div>`;
  const unitRow = (label: string, uid: number | undefined): string => {
    const u = uid === undefined ? undefined : unitOf(uid);
    return u ? row(label, u.label, `<button class="pad-chip" data-act="view-unit" data-uid="${u.uid}">View</button>`) : '';
  };
  // The Commanders are the MAIN Task's (VIP: Assassination), so they sit on
  // its card, not here.
  const rows: string[] = [unitRow('Target', tasks.secTarget[s])];
  const zoneId = tasks.zone[s];
  if (zoneId) {
    // By the zone's printed name, not its id.
    const zone = (table.zones?.length ? table.zones : data?.zoneData.zones ?? []).find((z) => z.id === zoneId)?.name ?? zoneId;
    // A hold-zone Task pays on who stands in the zone at the end. The pad has
    // no board to read that from, so it is SAID, like a Black Box's zone.
    const card = secondaryOf(s);
    const held = !!tasks.zoneHeld?.[s];
    rows.push(row('Zone', zone, card?.kind === 'hold-zone'
      ? `<button class="pad-chip${held ? ' on' : ''}" data-act="zone-held" data-side="${s}" data-held="${held ? '0' : '1'}" aria-pressed="${held}">Held</button>`
      : ''));
  }
  // Still to be named, and by whom. The button is there for whoever may answer
  // on this phone; across a table the other player's choice is only reported.
  const owed = data ? taskDesignations(data, table).filter((d) => d.side === s && d.what !== 'leader') : [];
  const mineToName = owed.some((d) => solo || d.by === mySeat());
  const ask = !owed.length ? ''
    : mineToName
      ? `<button class="pad-chip on" data-act="designate" data-side="${s}">Choose: ${esc(owed.map((d) => d.label).join(', '))}</button>`
      : `<p class="pad-note">${esc(sideName(owed[0].by))} chooses: ${esc(owed.map((d) => d.label).join(', '))}</p>`;
  return `${rows.join('')}${ask}`;
}

// What the MAIN Task was pointed at: each squad's Commander under VIP:
// Assassination, always in seat order so the two never swap places.
function mainDesignated(): string {
  if (!data || missionOf()?.family !== 'vip') return '';
  const tasks = normaliseTasks(table.tasks);
  const owed = taskDesignations(data, table).filter((d) => d.what === 'leader');
  return (['s1', 's2'] as Side[]).map((s) => {
    const u = tasks.leader[s] === undefined ? undefined : unitOf(tasks.leader[s]!);
    const label = `${shortSide(s)} Commander`;
    if (u) {
      return `<div class="pad-desig"><span class="pad-desig-k">${esc(label)}:</span><span class="pad-desig-v">${esc(u.label)}</span><button class="pad-chip" data-act="view-unit" data-uid="${u.uid}">View</button></div>`;
    }
    const mine = owed.find((d) => d.side === s);
    if (!mine) return '';
    return solo || mine.by === mySeat()
      ? `<button class="pad-chip on" data-act="designate-leader" data-side="${s}">Choose: ${esc(label)}</button>`
      : `<p class="pad-note">${esc(sideName(mine.by))} chooses: ${esc(label)}</p>`;
  }).join('');
}

// The Task Items as the table has them, and what this round would pay. The
// pad has no board, so Control, Terminals and where a Black Box is carried are
// SAID (claimItem, takeBlackBox); kills are already counted as attacks
// resolve. The arithmetic is scoring.ts, the same one every page uses.
function scoreSheet(tasks: TaskState): string {
  const m = missionOf();
  // No Main Task is no reason to hide the sheet: the Secondaries and the kills
  // score without one.
  if (!data) return '';
  const me = mySeat();
  const them = otherSeat();
  const zoneName = (id: string) => data!.zoneData.zones.find((z) => z.id === id)?.name ?? id;
  const wantsZone = (m as { scoringZone?: string } | undefined)?.scoringZone;
  const claimChips = (itemId: string, held: Side | null | undefined) => `<span class="pad-chips">
      <button class="pad-chip${!held ? ' on' : ''}" data-act="claim" data-item="${esc(itemId)}" data-side="">None</button>
      <button class="pad-chip${held === me ? ' on' : ''}" data-act="claim" data-item="${esc(itemId)}" data-side="${me}">${esc(shortSide(me))}</button>
      <button class="pad-chip${held === them ? ' on' : ''}" data-act="claim" data-item="${esc(itemId)}" data-side="${them}">${esc(shortSide(them))}</button>
    </span>`;
  const rows = tasks.items.map((i) => {
    if (i.kind !== 'blackbox') {
      return `<div class="pad-item"><span class="pad-item-name">${esc(zoneName(i.zone))}<small>${i.kind === 'control' ? 'Control' : 'Terminal'}</small></span>${claimChips(i.id, i.kind === 'control' ? i.control : i.accessed)}</div>`;
    }
    const bearer = i.bearerUid !== undefined ? unitOf(i.bearerUid) : null;
    return `<div class="pad-item"><span class="pad-item-name">Black Box · ${esc(zoneName(i.zone))}<small>${bearer ? esc(`${bearer.label} · ${sideName(bearer.side)}`) : 'On the table'}</small></span>
      <span class="pad-chips">
        ${bearer
          ? `${wantsZone ? `<button class="pad-chip${i.accessed === bearer.side ? ' on' : ''}" data-act="claim" data-item="${esc(i.id)}" data-side="${i.accessed === bearer.side ? '' : bearer.side}">In ${esc(wantsZone)}</button>` : ''}
             <button class="pad-chip" data-act="box-drop" data-item="${esc(i.id)}">Dropped</button>`
          : `<button class="pad-chip" data-act="box-take" data-item="${esc(i.id)}">Picked up</button>`}
      </span></div>`;
  }).join('');
  const last = table.round.n >= roundLimit();
  const got = previewScore(data, table, last, { settle: false, zoneCells: () => [] });
  // Scored once a round. A Guided game writes the End step; a Freeform one has
  // no script, so the Award carries a key for the round and it is read back
  // off the same `scored` list the scorers use - shared, so both phones agree.
  const paid = (table.script?.endDone ?? []).includes(`${table.round.n}:end:tasks`)
    || tasks.scored.includes(`pad-round:${table.round.n}`);
  const lines = got.lines.map((l) => `<div class="pad-score-line"><b style="color:${sideColour(l.side)}">${l.vp > 0 ? '+' : ''}${l.vp}</b><span>${esc(sideName(l.side))} · ${esc(l.why)}</span></div>`).join('');
  return `${rows ? `<p class="pad-label pad-sec">Task Items</p>${rows}` : ''}
    <p class="pad-label pad-sec">Round ${table.round.n}${paid ? ' · scored' : ''}</p>
    ${paid ? '' : lines || '<p class="pad-note">Nothing scores yet.</p>'}
    ${got.lines.length && !paid ? `<button class="pad-btn primary" data-act="award">Award ${got[me]} : ${got[them]}</button>` : ''}`;
}

// Who carries a Black Box: a unit with a free Freehand Part (5.3.1).
async function takeBox(itemId: string): Promise<void> {
  if (!data) return;
  const tasks = normaliseTasks(table.tasks);
  const able = table.tokens.filter((u) => u.kind !== 'projectile' && u.deployed !== false && !isDead(u))
    .map((u) => ({ u, hands: freehandSlots(data!, u, tasks.items.filter((i) => i.bearerUid === u.uid && i.bearerSlot).map((i) => i.bearerSlot!)) }))
    .filter((x) => x.hands.length);
  if (!able.length) { toast('No unit has a free Freehand Part to carry it (5.3.1).'); return; }
  const who = await choiceDialog({ title: 'Black Box', choices: able.map((x) => ({ id: String(x.u.uid), label: `${x.u.label} · ${sideName(x.u.side)}` })), stacked: true });
  if (who === null) return;
  const pick = able.find((x) => String(x.u.uid) === who)!;
  const slot = pick.hands.length === 1 ? String(pick.hands[0].slot)
    : await choiceDialog({ title: pick.u.label, choices: pick.hands.map((h) => ({ id: String(h.slot), label: h.label })), stacked: true });
  if (slot === null) return;
  send({ kind: 'takeBlackBox', seat: pick.u.side, uid: pick.u.uid, itemId, slot });
}

function tasksPanel(): string {
  const me = mySeat();
  const them = otherSeat();
  const tasks = normaliseTasks(table.tasks);
  const mission = missionOf();

  if (picking === 'main') {
    return `<div class="pad-panel-in">${panelHead('Main Task')}
      <p class="pad-lead">Tap the card the table is playing.</p>
      <div class="pad-tasklist">${data!.missions.cards.map((c) =>
        taskCard(`data-act="pick-task" data-kind="mission" data-id="${esc(c.id)}"`, missionImageUrl(c.id), c.name, c.scoring, `${c.vp ?? 0} VP`)).join('')}</div>
      <button class="pad-btn" data-act="pick-cancel">Cancel</button>
    </div>`;
  }
  if (picking === 'environment') {
    return `<div class="pad-panel-in">${panelHead('Environment Card')}
      <div class="pad-tasklist">${data!.environments.cards.map((c) =>
        taskCard(`data-act="pick-task" data-kind="environment" data-id="${esc(c.id)}"`, environmentImageUrl(c.id), c.name, c.text, '')).join('')}</div>
      <button class="pad-btn" data-act="pick-cancel">Cancel</button>
    </div>`;
  }
  if (picking === 'secondary') {
    return `<div class="pad-panel-in">${panelHead('Secondary Task')}
      <p class="pad-lead">${esc(sideName(pickFor))}.</p>
      <div class="pad-tasklist">${data!.secondary.map((c) =>
        taskCard(`data-act="pick-task" data-kind="secondary" data-id="${esc(c.id)}"`, secondaryImageUrl(c.id), c.name, c.scoring ?? '', `${c.vp ?? 0} VP`)).join('')}</div>
      <button class="pad-btn" data-act="pick-cancel">Cancel</button>
    </div>`;
  }

  const draw = tasks.draw ?? [];
  const disc = tasks.drawDiscards ?? {};
  // Three dealt, each squad discards one, the last is played (3.1.3). Solo
  // takes both discards on one phone.
  const drawHtml = draw.length ? `<p class="pad-label pad-sec">Main Task</p>
    <div class="pad-tasklist">${draw.map((id) => {
      const c = data!.missions.cards.find((x) => x.id === id);
      if (!c) return '';
      const by = disc.s1 === id ? 's1' : disc.s2 === id ? 's2' : null;
      const canDiscard = !by && (solo ? true : !disc[me]);
      return `<div class="pad-task${by ? ' discarded' : ''}">
        <img class="pad-task-art" src="${esc(missionImageUrl(c.id))}" alt="" loading="lazy" data-mission="${esc(c.id)}" />
        <span class="pad-task-body"><span class="pad-task-name">${esc(c.name)}</span>${by ? `<span class="pad-task-text">discarded by ${esc(sideName(by))}</span>` : ''}</span>
        ${canDiscard ? `<button class="pad-chip" data-act="discard-task" data-id="${esc(c.id)}">Discard${solo && disc.s1 ? ` (${esc(sideName('s2'))})` : ''}</button>` : ''}
      </div>`;
    }).join('')}</div>
    ${mainTaskLocked() ? '<p class="pad-note">The Main Task is settled once the table edges are picked (FAQ P1), so this draw cannot finish.</p>' : ''}
    <button class="pad-btn" data-act="draw-cancel">Cancel the draw</button>` : '';

  const layout = data!.terrain.maps.find((m) => m.id === table.map);
  const layoutHtml = `<p class="pad-label pad-sec">Layout</p>
    ${layout
      ? `<div class="pad-task chosen">
          <img class="pad-task-card" src="${esc(battlefieldCardUrl(layout.id))}" alt="${esc(layout.name.en || layout.id)}" data-battlefield="${esc(layout.id)}" />
          <span class="pad-task-row"><span class="pad-task-name">${esc(layout.name.en || layout.id)}</span><button class="pad-chip" data-act="open-setup">change</button></span>
        </div>`
      : '<button class="pad-btn" data-act="open-setup">Choose</button>'}`;

  // Environment Cards (5.4.1): placed on Grids while the battlefield is set
  // up, no more than the layout allows. The pad records which card covers
  // which Grid; the table places them.
  const placed = table.environments ?? [];
  const cap = environmentAllowance(data!, table);
  const envName = (id: string) => data!.environments.cards.find((c) => c.id === id)?.name ?? id;
  const envHtml = `<p class="pad-label pad-sec">Environment Cards <b>${placed.length}/${cap}</b></p>
    ${placed.length ? `<div class="pad-chips" style="margin-bottom:8px">${placed.map((e) => `<span class="pad-chip pad-env">${esc(envName(e.card))} · ${String.fromCharCode(65 + e.col)}${e.row + 1}<button class="ui-x" data-act="env-lift" data-at="${e.col},${e.row}" aria-label="Take ${esc(envName(e.card))} off">✕</button></span>`).join('')}</div>` : ''}
    ${placed.length < cap ? '<button class="pad-btn" data-act="pick-env">Place a card</button>' : ''}`;

  const slot = (label: string, card: { id: string; name: string } | undefined,
                art: (id: string) => string, imgAttr: string, act: string | null, pointed = '') => `
    <p class="pad-label pad-sec">${label}</p>
    ${card
      ? `<div class="pad-task chosen">
          <span class="pad-task-row">
            <span class="pad-task-name">${esc(card.name)}</span>
            ${act ? `<button class="pad-chip" data-act="${act}">change</button>` : ''}
          </span>
          ${pointed}
          <img class="pad-task-card" src="${esc(art(card.id))}" alt="${esc(card.name)}" ${imgAttr} />
        </div>`
      : act
        ? `<button class="pad-btn" data-act="${act}">Choose</button>`
        : '<p class="pad-note">Not chosen.</p>'}`;

  const vpSide = (s: Side, label: string) => `<div class="pad-vp-side">
      <button class="pad-step" data-act="vp" data-by="-1" data-side="${s}" aria-label="${label}: one less">−</button>
      <span class="pad-vp-n" style="color:${sideColour(s)}">${tasks.vp[s]}</span>
      <button class="pad-step" data-act="vp" data-by="1" data-side="${s}" aria-label="${label}: one more">+</button>
      <span class="pad-label">${esc(label)}</span>
    </div>`;

  const result = finished() ? gameResult(tasks, table.tokens) : null;
  const recordHtml = !result ? '' : `<p class="pad-label pad-sec">Game over</p>
    <p class="pad-lead">${result.winner ? `${esc(sideName(result.winner))} wins: ${esc(result.why)}.` : `A draw: ${esc(result.why)}.`}</p>
    ${recordedFor === recordKey()
      ? '<p class="pad-note">Recorded to Stats.</p>'
      : account
        ? '<button class="pad-btn primary" data-act="record">Record this match</button>'
        : '<p class="pad-note">Sign in to record it to Stats.</p>'}`;
  return `<div class="pad-panel-in">${panelHead('Tasks')}
    ${errHtml()}
    ${recordHtml}
    <div class="pad-vp">${vpSide(me, shortSide(me))}${vpSide(them, shortSide(them))}</div>
    ${scoreSheet(tasks)}
    ${layoutHtml}
    ${envHtml}
    ${drawHtml || (mission
      ? slot('Main Task', mission, missionImageUrl, `data-mission="${esc(mission.id)}"`, mainTaskLocked() ? null : 'pick-main', mainDesignated())
      : `<p class="pad-label pad-sec">Main Task</p>
         ${mainTaskLocked()
           // Offering a draw the engine will refuse to finish is how a table got
           // stuck on "discard" with no way to a Main Task.
           ? '<p class="pad-note">Not chosen. The Main Task is settled once the table edges are picked (FAQ P1).</p>'
           : '<div class="pad-chips"><button class="pad-chip on" data-act="draw-tasks">Draw 3</button><button class="pad-chip" data-act="pick-main">Choose</button></div>'}`)}
    ${slot(`${sideName(me)} · Secondary`, secondaryOf(me), secondaryImageUrl, secondaryOf(me) ? `data-secondary="${esc(secondaryOf(me)!.id)}"` : '', 'pick-sec', designated(me))}
    ${slot(`${sideName(them)} · Secondary`, secondaryOf(them), secondaryImageUrl, secondaryOf(them) ? `data-secondary="${esc(secondaryOf(them)!.id)}"` : '', solo ? 'pick-sec-them' : null, designated(them))}
    <p class="pad-label pad-sec">Notes</p>
    <textarea class="pad-input" id="pad-notes" rows="3" placeholder="Notes"></textarea>
  </div>`;
}

// ---------- more ----------

// A running game whose deployment has closed takes no more units (the rule
// lives in importSquad's check; this only reads the same setup stage).
function squadsClosed(): boolean {
  return normaliseSetup(table.setup)?.stage === 'done' && !table.unlocked;
}

function morePanel(): string {
  const room = view.room;
  const me = mySeat();
  const hist = historyEntries().slice(-5).reverse();
  const seats = room ? (['s1', 's2'] as const).map((s) => {
    const name = room.seats[s];
    const online = room.online[s];
    const mine = view.seat === s;
    if (!name) {
      return `<div class="pad-seat"><span class="pad-dot"></span>
        <span class="pad-seat-name pad-bar-dim">Waiting for a player…</span></div>`;
    }
    return `<div class="pad-seat${mine ? ' me' : ''}">
      <span class="pad-dot${online ? ' on' : ''}"></span>
      <span class="pad-seat-name">${esc(name)}</span>
      <span class="pad-seat-tag">${mine ? 'you' : online ? 'here' : 'away'}</span>
    </div>`;
  }).join('') : '';
  const r = table.round;
  return `<div class="pad-panel-in">${panelHead(room ? 'Table' : 'Tracking solo')}
    ${errHtml()}
    ${room ? `<div class="pad-room">${esc(room.id)}</div>
      ${seats}` : ''}

    <p class="pad-label pad-sec">Round</p>
    <div class="pad-row">
      <span class="pad-label">${roundLimit()} rounds · ${scaleOf().points} points</span>
      <button class="pad-chip" data-act="open-setup">Change</button>
    </div>
    <div class="pad-row">
      <span class="pad-num">${gameOver() ? 'Over' : `R${r.n}`}<span class="pad-of"> · ${gameOver() ? 'final' : esc(PHASES[r.phase] ?? '')}</span></span>
      <div class="pad-chips">
        <button class="pad-chip" data-act="phase-back">Back a phase</button>
        ${gameOver() ? '' : `<button class="pad-chip on" data-act="phase">${room ? (readiness().me ? 'Waiting…' : 'Continue') : 'Next phase'}</button>`}
      </div>
    </div>
    <button class="pad-btn" data-act="rounds-reset" style="margin-top:8px">Start the rounds over</button>

    <p class="pad-label pad-sec">Squads</p>
    ${solo ? `<div class="pad-chips pad-squad-pick" style="margin-bottom:8px">
      <button class="pad-chip${squadSide === 's1' ? ' on' : ''}" data-act="squad-side" data-side="s1">P1</button>
      <button class="pad-chip${squadSide === 's2' ? ' on' : ''}" data-act="squad-side" data-side="s2">P2</button>
      <span class="pad-squad-pts">${sidePoints(squadSide)} pts</span>
    </div>` : `<p class="pad-label" style="margin-bottom:8px">${sidePoints(mySeat())} pts on the table</p>`}
    ${squadsClosed()
      // 3.1.4: a squad joins before deployment is finished. The engine refused
      // the add and said so in an error line that was easy to miss, while the
      // buttons went on looking usable.
      ? '<p class="pad-note">The squads are set: deployment is finished (3.1.4). End the game to change them.</p>'
      : `<button class="pad-btn primary" data-act="file">Squad file…</button>
    <button class="pad-btn" data-act="build">Build a Mech</button>
    <button class="pad-btn" data-act="drone">Add a Drone</button>`}
    <button class="pad-btn" data-act="projectile">Add a Projectile</button>
    ${collectionRows()}
    <p class="pad-label pad-sec">Tactics Cards</p>
    ${tacticsHtml(solo ? squadSide : mySeat())}
    ${savedHtml()}

    ${attackActive() || attackWatching() || ewActive() || ewWatching() ? `<p class="pad-label pad-sec">Attack</p><button class="pad-btn" data-act="dock" data-dock="combat">Open the attack window</button>` : ''}
    ${destroyedList()}
    <p class="pad-label pad-sec">History</p>
    ${hist.length ? `<div class="pad-hist">${hist.map((h) => `<div class="pad-hist-row"><span>${esc(h.human ?? h.kind)}</span><small>R${h.round}</small></div>`).join('')}</div>` : '<p class="pad-note">Nothing recorded yet.</p>'}
    <button class="pad-btn" data-act="undo"${historyDepth() ? '' : ' disabled'}>Undo the last thing</button>

    <p class="pad-label pad-sec">Rules</p>
    <div class="pad-chips">
      <button class="pad-chip" data-act="find-scope" data-scope="rules">Phases, timings, stances, tokens</button>
      <button class="pad-chip" data-act="find-scope" data-scope="keywords">Glossary</button>
    </div>

    <div class="pad-foot">
      ${room
        ? `<button class="pad-btn" data-act="leave">Leave the table</button>
           ${view.host ? '<button class="pad-btn danger" data-act="close-room">Close the table for everyone</button>' : ''}`
        : `<button class="pad-btn" data-act="solo-leave">Leave the game</button>
           <button class="pad-btn danger" data-act="solo-end">Delete this game</button>`}
      ${account
        ? `<button class="pad-btn" data-act="signout">Sign out</button>
           <p class="pad-note">Signed in as ${esc(account.username)}${room ? ` · seat ${me === 's1' ? '1' : '2'}` : ''}</p>`
        : `<button class="pad-btn" data-act="solo-to-signin">Sign in</button>
           <p class="pad-note">Not signed in</p>`}
    </div>
  </div>`;
}

// ---------- the mech builder ----------
//
// The BOARD'S picker, not a phone copy of it. openPartPicker already knows how
// to group by faction, show the art, pin two cards against each other and warn
// when a Part would break a Mech's single-faction rule (5.1). What the pad
// supplies is the slot list around it.

const BUILD_SLOTS: { key: keyof MechLoadout; label: string; type: string }[] = [
  { key: 'torso', label: 'Torso', type: 'torso' },
  { key: 'chasis', label: 'Chassis', type: 'chasis' },
  { key: 'leftHand', label: 'Left arm', type: 'leftHand' },
  { key: 'rightHand', label: 'Right arm', type: 'rightHand' },
  { key: 'backpack', label: 'Backpack', type: 'backpack' },
  { key: 'pilot', label: 'Pilot', type: 'pilot' },
];

let build: MechLoadout = {};

// The faction the build has already committed to, or null while it is still
// open. A Mech may only use Parts from one faction (5.1).
function buildFaction(): string | null {
  if (!data) return null;
  for (const s of BUILD_SLOTS) {
    if (s.key === 'pilot') continue;
    const id = build[s.key];
    const card = id ? data.byId.get(id) : undefined;
    const f = card ? data.factionOf(card) : null;
    if (f) return f;
  }
  return null;
}

function buildPoints(): number {
  const d = data;
  if (!d) return 0;
  return BUILD_SLOTS.reduce((n, s) => {
    const id = build[s.key];
    return n + (id ? (d.byId.get(id)?.score ?? 0) : 0);
  }, 0);
}

function openBuildSlot(slot: typeof BUILD_SLOTS[number]): void {
  const d = data;
  if (!d) return;
  const pool = d.cards
    .filter((c) => (slot.key === 'pilot' ? c.category === 'pilot' : c.category === 'mech_part' && c.type === slot.type))
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));
  openPartPicker({
    data: d,
    slotLabel: slot.label,
    groups: groupByFaction(d, pool),
    chosen: build[slot.key],
    lockedFaction: slot.key === 'pilot' ? null : buildFaction(),
    // What the other slots of this build already took comes off the shelf too;
    // the slot being filled does not, so a card can be re-picked.
    remaining: (c) => {
      const left = leftOf(c);
      if (left === null) return null;
      const taken = BUILD_SLOTS.filter((s) => s.key !== slot.key && build[s.key] === c.id).length;
      return Math.max(0, left - taken);
    },
    actions: [{
      label: `Set ${slot.label}`,
      run: (card) => {
        build = { ...build, [slot.key]: card.id };
        render();
      },
    }],
  });
}

// ---------- Detonation (4.7.5, 4.7.6) ----------
//
// A Projectile's Delayed Action, the Match Centre's detonation resolver with
// the table naming who is within range. Damage goes through the attack window
// as Explosion damage, one target after another; an effect card applies its
// Token; a smoke card is placed on the table. The Projectile is destroyed at
// the end (4.7.5).
// `hit` is every unit this blast has already reached: one Detonation touches
// a unit once, so it drops off the list instead of being pickable again.
let detonating: { uid: number; actionId: string; single?: boolean; fired?: boolean; hit?: number[] } | null = null;

function detonationText(a: CardAction): string {
  const en = a.description?.en?.trim();
  if (en && !/[぀-ヿ一-鿿]/.test(en)) return en;
  return data?.actionTranslation(a.id)?.english?.trim() || a.description?.zh?.trim() || '';
}

async function detonate(proj: Token, actionId: string): Promise<void> {
  if (!data) return;
  const a = tokenCards(data, proj).flatMap((c) => c.card.actions ?? []).find((x) => x.id === actionId);
  if (!a) return;
  const name = a.name.en || actionId;
  const smoke = smokePlacement(a);
  if (smoke) {
    toast(`${proj.label}: ${smoke.count} Smoke Screen${smoke.count === 1 ? '' : 's'} on the table.`);
    send({ kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid });
    nextDetonation();
    return;
  }
  detonating = { uid: proj.uid, actionId };
  await continueDetonation();
}

// Asks for the next unit the blast reaches; the window's close brings the
// question back until Done, which destroys the Projectile.
async function continueDetonation(): Promise<void> {
  const d = detonating;
  if (!d || !data) return;
  const proj = unitOf(d.uid);
  const a = proj ? tokenCards(data, proj).flatMap((c) => c.card.actions ?? []).find((x) => x.id === d.actionId) : undefined;
  if (!proj || !a) { detonating = null; return; }
  // A single-target card is done once its one attack has closed.
  if (d.single && d.fired) {
    detonating = null;
    send({ kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid });
    toast(`${proj.label} detonated and is destroyed (4.7.5).`);
    nextDetonation();
    return;
  }
  const name = a.name.en || d.actionId;
  const damaging = !!((a.yellowDice ?? 0) || (a.redDice ?? 0));
  const scope = explosionScope(a, data.actionTranslation(a.id)?.english ?? undefined);
  const effectStatus = damaging ? null : (/interfer|jam|stun/i.test(`${name} ${detonationText(a)}`) ? 'fci' : null);
  // Range 0 is the Projectile's own Grid, and reads better said that way.
  const reach = a.range ? `within Range ${a.range}` : 'in its Grid';
  const units = table.tokens.filter((x) => x.uid !== proj.uid && x.deployed !== false && !isDead(x) && !(d.hit ?? []).includes(x.uid));
  const pick = await choiceDialog({
    title: `${name} · ${proj.label}`,
    body: damaging
      ? scope === 'all' ? `Every unit ${reach}, allies too, takes a separate attack (4.7.6). Name each one.` : `One target ${reach}.`
      : effectStatus ? `Each unit ${reach} the card affects gains the Token.` : `${detonationText(a) || 'See the card.'} Apply it on the table.`,
    choices: [
      ...units.map((x) => ({ id: String(x.uid), label: `${x.side === proj.side ? 'Ally' : 'Enemy'} · ${x.label}` })),
      { id: '__done', label: 'Done, the Projectile is destroyed', primary: true },
      { id: '__keep', label: 'Cancel', cancel: true },
    ],
    stacked: true,
  });
  if (pick === null || pick === '__keep') { detonating = null; return; }
  if (pick === '__done') {
    detonating = null;
    send({ kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid });
    toast(`${proj.label} detonated and is destroyed (4.7.5).`);
    nextDetonation();
    return;
  }
  const hit = unitOf(Number(pick));
  if (!hit) { void continueDetonation(); return; }
  if (damaging) {
    detonating = { ...d, single: scope !== 'all', fired: true, hit: [...(d.hit ?? []), hit.uid] };
    panel = 'combat';
    render();
    if (!beginAttack(proj, d.actionId, hit, { protection: 0, backAttack: false, explosion: true })) { panel = null; detonating = null; render(); }
    return;
  }
  if (effectStatus) send({ kind: 'applyStatus', seat: proj.side, uid: proj.uid, targetUid: hit.uid, statusId: effectStatus });
  else toast(`${hit.label}: ${name}, applied on the table.`);
  detonating = { ...d, hit: [...(d.hit ?? []), hit.uid] };
  void continueDetonation();
}

// ---------- the record (Stats) ----------
//
// The finished game, kept under the account the way the Match Centre keeps
// one: the squads as BROUGHT (the fielded roster, or the table when nothing
// was recorded), the hand, the mission, the rounds and the result. Once per
// table on this phone.
let recordedFor: string | null = null;

function recordKey(): string {
  return view.room?.id ?? soloId ?? 'table';
}

// A game is finished when the rounds have run out (Freeform turns the round
// past the limit) or, in a Guided game, when the last round's End steps are
// all done - endMatch then wipes the tasks and the score, so the record is
// offered before it.
function finished(): boolean {
  if (gameOver()) return true;
  if (!guidedOn(table) || table.round.n < roundLimit()) return false;
  const done = table.script?.endDone ?? [];
  return ['remove', 'tokens', 'tasks'].every((id) => done.includes(`${table.round.n}:end:${id}`));
}

// Guided's "End the game": the record first, when there is an account and
// it has not been kept yet, then the engine's endMatch.
async function endGame(): Promise<void> {
  const me = mySeat();
  if (account && recordedFor !== recordKey()) {
    const pick = await choiceDialog({
      title: 'End the game',
      body: 'Ending it clears the score. Record it to Stats first?',
      choices: [
        { id: 'record', label: 'Record and end', primary: true },
        { id: 'end', label: 'End without recording' },
        { id: 'cancel', label: 'Cancel', cancel: true },
      ],
      stacked: true,
    });
    if (pick === null || pick === 'cancel') return;
    if (pick === 'record') {
      const why = await recordMatch();
      if (why) { toast(why); return; }
      toast('Recorded to Stats.');
    }
  }
  send({ kind: 'endMatch', seat: me });
}

async function recordMatch(): Promise<string | null> {
  if (!data) return 'Still loading.';
  if (!account) return 'Sign in to keep a record.';
  const tasks = normaliseTasks(table.tasks);
  const winner = gameResult(tasks, table.tokens).winner;
  const entries = (side: Side): SquadEntry[] => {
    const out: SquadEntry[] = [];
    const push = (id: string): void => {
      const card = data!.byId.get(id);
      if (card) out.push({ id, cat: (card.category ?? 'mech_part') as SquadEntry['cat'] });
    };
    const roster = table.fielded?.[side];
    if (roster && Object.keys(roster).length) {
      for (const ids of Object.values(roster)) for (const id of ids) push(id);
    } else {
      for (const t of table.tokens) {
        if (t.side !== side || t.kind === 'projectile') continue;
        for (const { card } of tokenCards(data!, t)) push(card.id);
      }
    }
    for (const id of table.tactics?.[side] ?? []) if (data!.byId.get(id)) out.push({ id, cat: 'tactics_or_upgrade' });
    return out.slice(0, 80);
  };
  try {
    await api.recordGame({
      mode: view.room ? 'online' : 'hotseat',
      mission: table.mission ?? null,
      scale: table.scale ?? null,
      rounds: Math.max(1, Math.min(20, Math.min(table.round.n, roundLimit()))),
      winnerSeat: winner,
      mySeat: view.room ? mySeat() : null,
      players: (['s1', 's2'] as Side[]).map((side) => ({
        seat: side,
        faction: squadAllegiance(data!, table.tokens.filter((t) => t.side === side)).faction,
        vp: Math.max(0, tasks.vp[side]),
        squad: entries(side),
      })),
    });
    recordedFor = recordKey();
    return null;
  } catch (err) {
    return `${(err as ApiError).message} The game itself is unaffected.`;
  }
}

// ---------- Tactics Cards (5.4) ----------
//
// The hand is table state (`tactics` per side), set at any time from More; a
// card is played from More or, in a Guided game, from the turn strip when its
// phase is on. One per squad per round; the engine holds the rule.

function tacticCtx(): TacticCtx {
  return { maxLink: (t) => (data ? pilotCard(data, t)?.LV ?? 0 : 0) };
}

function handOf(side: Side): string[] {
  return table.tactics?.[side] ?? [];
}

function playedThisRound(side: Side): boolean {
  return (table.tacticsPlayed?.[side] ?? []).some((e) => e.startsWith(`${table.round.n}:`));
}

function openTacticPicker(side: Side): void {
  const d = data;
  if (!d) return;
  const held = new Set(handOf(side));
  const pool = d.cards
    .filter((c) => c.category === 'tactics_or_upgrade' && !isDiscardCard(c) && !held.has(c.id))
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));
  openPartPicker({
    data: d,
    slotLabel: 'Tactics Card',
    groups: groupByFaction(d, pool),
    lockedFaction: null,
    badge: (c) => tacticSpec(c.id)?.timing ?? '',
    // A hand is not on the table, so the copies both hands hold come off by hand.
    remaining: (c) => {
      const shelf = shelfFor();
      if (!shelf || !hasShelfData(c)) return null;
      const held = (['s1', 's2'] as const).reduce((n, s) => n + handOf(s).filter((id) => id === c.id).length, 0);
      return Math.max(0, copiesOf(d, shelf, c) - held);
    },
    actions: [{ label: 'Add to hand', run: (card) => { send({ kind: 'setTactics', seat: side, cards: [...handOf(side), card.id] }); render(); } }],
  });
}

function tacticsHtml(side: Side): string {
  const d = data;
  if (!d) return '';
  const held = handOf(side);
  const played = playedThisRound(side);
  const phase = PHASES[table.round.phase] ?? '';
  const rows = held.map((id) => {
    const card = d.byId.get(id);
    const spec = tacticSpec(id);
    if (!card) return '';
    const fits = !guidedOn(table) || tacticFitsPhase(id, phase);
    const thisOne = (table.tacticsPlayed?.[side] ?? []).includes(`${table.round.n}:${id}`);
    return `<div class="pad-row">
      <span class="pad-part-name">${esc(cardName(card))}<small class="pad-of"> · ${esc(spec?.timing ?? '')}</small></span>
      <div class="pad-chips">
        ${spec ? `<button class="pad-chip${played || !fits ? '' : ' on'}" data-act="tactic-play" data-side="${side}" data-id="${esc(id)}"${played || !fits ? ' disabled' : ''}>${thisOne ? 'Played' : 'Play'}</button>` : ''}
        <button class="pad-chip" data-act="tactic-drop" data-side="${side}" data-id="${esc(id)}">✕</button>
      </div>
    </div>`;
  }).join('');
  return `${rows}<button class="pad-btn" data-act="tactic-add" data-side="${side}">Add a Tactics Card</button>`;
}

// The card's questions, as dialogs: which unit when several qualify, which
// option when the card offers a choice. The free Maneuver a card grants is
// made on the table.
async function playTactic(side: Side, cardId: string): Promise<void> {
  const spec = tacticSpec(cardId);
  if (!data || !spec) return;
  const ctx = tacticCtx();
  const targets = tacticTargets(spec, table, side, ctx);
  if (!targets.length) { toast(`${spec.name}: ${spec.none}`); return; }
  let t = targets[0];
  if (targets.length > 1) {
    const pick = await choiceDialog({ title: spec.name, body: spec.prompt, choices: targets.map((x) => ({ id: String(x.uid), label: x.label })), stacked: true });
    if (pick === null) return;
    t = targets.find((x) => String(x.uid) === pick) ?? t;
  }
  let choice: string | undefined;
  if (spec.choices) {
    const opts = spec.choices(t, table, ctx);
    if (!opts.length) { toast(`${spec.name}: ${spec.none}`); return; }
    if (opts.length === 1) choice = opts[0].id;
    else {
      const pick = await choiceDialog({ title: spec.choiceTitle ?? spec.name, body: t.label, choices: opts.map((o) => ({ id: o.id, label: o.note ? `${o.label} · ${o.note}` : o.label })), stacked: true });
      if (pick === null) return;
      choice = pick;
    }
  }
  if (!send({ kind: 'playTactic', seat: side, uid: t.uid, cardId, pick: choice })) return;
  toast(t.log?.at(-1)?.text ?? `${sideName(side)} plays ${spec.name}.`);
  if (spec.maneuver) {
    // The granted Maneuver is recorded (facing and the Opportunity's books)
    // and made on the table.
    if (guidedOn(table)) send({ kind: 'maneuver', seat: side, uid: t.uid, to: { col: 0, row: 0 }, facing: t.facing, granted: true });
    toast(`${t.label}: Maneuver on the table.`);
  }
}

// The Parts a carrier may carry, as a picker; `run` gets the chosen one.
function openLoadPicker(carrier: Card, seat: Side, run: (load: Card) => void): void {
  const d = data;
  if (!d) return;
  const parts = d.cards
    .filter((c) => c.category === 'mech_part' && canBeLoad(c) && !isDiscardCard(c))
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));
  openPartPicker({
    data: d,
    slotLabel: `Load for ${cardName(carrier)}`,
    groups: groupByFaction(d, parts),
    lockedFaction: d.factionOf(carrier) ?? sideFaction(seat),
    remaining: leftOf,
    actions: [{ label: 'Carry this', run }],
  });
}

// A carrier's Load on the sheet: on a free table it comes and goes at will;
// a scripted game fixes it at setup, so the row is not drawn there (setLoad
// refuses it too).
function loadRow(t: Token): string {
  const d = data;
  if (!d || t.kind !== 'drone') return '';
  const own = d.byId.get(t.cardId);
  if (!own || !isCarrier(own)) return '';
  const held = t.droneBackpack ? d.byId.get(t.droneBackpack) : undefined;
  return `<div class="pad-row">
    <span class="pad-part-name">${held ? esc(cardName(held)) : 'No Load'}</span>
    <div class="pad-chips">
      ${held ? '<button class="pad-chip" data-act="load-off">Take off</button>' : ''}
      <button class="pad-chip" data-act="load-pick">${held ? 'Change' : 'Add a Load'}</button>
    </div>
  </div>`;
}

// ---------- saved units and squads ----------
//
// The same two libraries the board keeps (presets.ts, squadstore.ts): the
// shipped starters and what the player saved, on this device and on the
// account. A saved entry can be removed here; the shipped ones cannot.

// A saved build's points and faction, read the way the sheet reads a Mech's:
// every Part plus the pilot, and the Torso's faction for the tint.
function loadoutPoints(m: MechLoadout): number {
  return Object.values(m).reduce((n, id) => n + (id ? data?.byId.get(id)?.score ?? 0 : 0), 0);
}
function loadoutFaction(m: MechLoadout): string | null {
  const core = m.torso ? data?.byId.get(m.torso) : undefined;
  return core && data ? data.factionOf(core) : null;
}
function savedSquadPoints(sq: SavedSquad): number {
  const drones = sq.drones.reduce((n, d) => n + (data?.byId.get(d.cardId)?.score ?? 0) + (d.backpack ? data?.byId.get(d.backpack)?.score ?? 0 : 0), 0);
  const tactics = (sq.tactics ?? []).reduce((n, id) => n + (data?.byId.get(id)?.score ?? 0), 0);
  return sq.mechs.reduce((n, m) => n + loadoutPoints(m.loadout), 0) + drones + tactics;
}

// What a side has brought: every unit's Parts and pilot, plus its hand.
function sidePoints(s: Side): number {
  if (!data) return 0;
  const d = data;
  const units = table.tokens.filter((x) => x.side === s && x.kind !== 'projectile' && x.parentUid === undefined)
    .reduce((n, t) => n + tokenCards(d, t).reduce((m, c) => m + (c.card.score ?? 0), 0) + (t.kind === 'mech' ? (pilotCard(d, t)?.score ?? 0) : 0), 0);
  const hand = (table.tactics?.[s] ?? []).reduce((n, id) => n + (d.byId.get(id)?.score ?? 0), 0);
  return units + hand;
}

function savedHtml(): string {
  const units = loadMechPresets();
  const squads = loadSquads();
  // Tinted with the faction, the way the strip tints a squad; points on the
  // right, so a build can be weighed before it is added.
  const row = (act: string, del: string, id: string, name: string, tag: string, points: number, faction: string | null) => `<div class="pad-saved">
      <button class="pad-seat pad-saved-row" data-act="${act}" data-id="${esc(id)}" style="--fac:${squadColour(faction)}">
        <span class="pad-seat-name">${esc(name)}</span>
        <span class="pad-seat-tag">${tag}</span>
        <span class="pad-saved-pts">${points}</span>
      </button>
      <button class="pad-chip pad-saved-x" data-act="${del}" data-id="${esc(id)}" aria-label="Remove ${esc(name)}">✕</button>
    </div>`;
  // Two folds, closed until opened and remembered: a long library must not
  // stretch the panel, and a nested scroll on a phone is worse than a fold.
  const fold = (key: string, title: string, n: number, body: string) => `<details class="pad-fold pad-lib-fold" data-fold="${key}"${foldOpen(key) ? ' open' : ''}>
      <summary><span class="pad-label pad-sec">${title}</span><b>${n}</b></summary>
      ${body}
    </details>`;
  const seat = solo ? squadSide : mySeat();
  const anyUnits = table.tokens.some((x) => x.side === seat && x.kind !== 'projectile' && x.parentUid === undefined);
  const hidden = hiddenBuiltIns().length;
  return `${fold('units', 'Saved units', units.length,
      units.length ? units.map((m) => row('preset', 'preset-del', m.id, m.name, m.saved ? 'saved' : 'default', loadoutPoints(m.mech), loadoutFaction(m.mech))).join('') : '<p class="pad-label">None yet. Save a Mech from its sheet.</p>')}
    ${fold('squads', 'Saved squads', squads.length,
      (squads.length ? squads.map((s) => row('squad', 'squad-del', s.id, s.name, `${s.mechs.length}M ${s.drones.length}D${s.tactics?.length ? ` ${s.tactics.length}T` : ''}${s.saved ? '' : ' · default'}`, savedSquadPoints(s), s.mechs[0] ? loadoutFaction(s.mechs[0].loadout) : null)).join('') : '<p class="pad-label">None yet.</p>')
      + (anyUnits ? '<button class="pad-btn" data-act="save-squad" style="margin-top:8px">Save this squad</button>' : ''))}
    ${hidden ? `<button class="pad-link" data-act="restore-builtins">Show the built-in starters again (${hidden})</button>` : ''}`;
}

// ---------- the collection ----------
//
// Off by default: every picker lists every card, as it always has. Switched
// on, the pickers hide what this phone's collection has none of. In a room a
// seat may open its shelf to the table; the other player then builds from it
// when they have not switched on a collection of their own.

// The shelf a picker on this phone draws from, or null for no limit.
function shelfFor(): Collection | null {
  const mine = loadCollection();
  if (collectionOn() && hasAny(mine)) return mine;
  const theirs = view.room ? table.inventory?.[otherSeat()] : undefined;
  if (theirs) return { boxes: theirs.boxes, cards: theirs.cards, updatedAt: 0, builtOnly: !!theirs.builtOnly };
  return null;
}

// Whether the shelf in use is this phone's own, unshared, in a room: then only
// this seat's units come off it, since the other squad was built elsewhere.
// A shared shelf, or solo tracking, feeds both squads and counts both.
function shelfTokens(): Token[] {
  const mine = loadCollection();
  const own = collectionOn() && hasAny(mine);
  if (view.room && own && !table.inventory?.[mySeat()]) return table.tokens.filter((t) => t.side === mySeat());
  return table.tokens;
}

function hasShelfData(c: Card): boolean {
  const shelf = shelfFor();
  return !!shelf && ((c.containedIn ?? []).length > 0 || (shelf.cards[c.id] ?? 0) > 0);
}

function leftOf(c: Card): number | null {
  const shelf = shelfFor();
  if (!shelf || !data) return null;
  return remaining(data, shelf, shelfTokens(), c);
}

// A shelf already open to the table follows its edits.
function reshare(col: Collection): void {
  if (!view.room || !table.inventory?.[mySeat()]) return;
  send({ kind: 'setInventory', seat: mySeat(), shared: true, boxes: col.boxes, cards: col.cards, builtOnly: !!col.builtOnly });
}

// The two switches, side by side wherever the collection is offered.
// "Only built pieces" implies building from the collection, so turning it on
// turns that on too.
function collectionChips(on: boolean): string {
  const built = builtOnlyOn();
  return `<button class="pad-chip${on ? ' on' : ''}" data-act="inv-toggle" aria-pressed="${on}">Build from collection</button>
      <button class="pad-chip${on && built ? ' on' : ''}" data-act="inv-built-only" aria-pressed="${on && built}">Only built pieces</button>`;
}

function collectionSummary(col: Collection): string {
  const boxes = Object.values(col.boxes).reduce((a, b) => a + b, 0);
  const singles = Object.values(col.cards).reduce((a, b) => a + b, 0);
  if (!boxes && !singles) return 'Nothing recorded yet';
  const parts = [];
  if (boxes) parts.push(`${boxes} box${boxes === 1 ? '' : 'es'}`);
  if (singles) parts.push(`${singles} built piece${singles === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

// The More panel's Collection rows.
function collectionRows(): string {
  const col = loadCollection();
  const on = collectionOn();
  const room = view.room;
  const shared = !!table.inventory?.[mySeat()];
  const theirs = room ? table.inventory?.[otherSeat()] : undefined;
  return `<p class="pad-label pad-sec">Collection</p>
    <div class="pad-row">
      <span class="pad-label">${esc(collectionSummary(col))}</span>
      <button class="pad-chip" data-act="inventory">Edit</button>
    </div>
    <div class="pad-chips">
      ${collectionChips(on)}
      ${room ? `<button class="pad-chip${shared ? ' on' : ''}" data-act="inv-share" aria-pressed="${shared}"${hasAny(col) || shared ? '' : ' disabled'}>Open it to the table</button>` : ''}
    </div>
    ${on && !hasAny(col) ? '<p class="pad-label">Nothing is recorded, so every card still shows.</p>' : ''}
    ${theirs && !(on && hasAny(col)) ? `<p class="pad-label">${esc(sideName(otherSeat()))} has opened their collection to you; the pickers draw from it.</p>` : ''}`;
}

function invFoundHtml(): string {
  const d = data;
  if (!d) return '';
  const q = invSearch.trim().toLowerCase();
  if (!q) return '';
  const order = [...BASE_FACTIONS, 'PD', 'COLLABORATION'];
  const rank = (c: Card) => { const i = order.indexOf(d.factionOf(c) ?? ''); return i < 0 ? order.length : i; };
  // A card already recorded has its own row with steppers just below, so the
  // search offers only what is not in the list yet.
  const have = loadCollection().cards;
  const found = d.cards
    .filter((c) => !isDiscardCard(c) && !(have[c.id] > 0) && (cardName(c).toLowerCase().includes(q) || c.id.includes(q)))
    .sort((a, b) => rank(a) - rank(b) || cardName(a).localeCompare(cardName(b)))
    .slice(0, 8);
  if (!found.length) return '<p class="pad-label">No card by that name.</p>';
  return found.map((c) => `<div class="pad-row">
      <span class="pad-part-name" data-card="${esc(c.id)}">${esc(cardName(c))}<span class="pad-inv-tag">${esc(FACTION_LABEL[d.factionOf(c) ?? ''] ?? '')}</span></span>
      <div class="pad-chips"><button class="pad-chip" data-act="inv-card" data-id="${esc(c.id)}" data-d="1">Add one</button></div>
    </div>`).join('');
}

function inventoryPanel(): string {
  const d = data!;
  const col = loadCollection();
  const on = collectionOn();
  const boxes = d.boxes.filter(isListedBox).sort((a, b) => (a.name.en || a.key).localeCompare(b.name.en || b.key));
  // By faction, the mercenaries after the three armies, then anything the data
  // has not placed; within a faction what is owned comes first.
  const order = [...BASE_FACTIONS, 'PD', 'COLLABORATION'];
  const rank = (f: string) => { const i = order.indexOf(f); return i < 0 ? (f ? order.length : order.length + 1) : i; };
  const facOf = (b: typeof boxes[number]) => (b.faction ?? [])[0] ?? '';
  const facLabel = (f: string) => (f ? (FACTION_LABEL[f] ?? f) : 'Faction not recorded');
  const grouped = <T,>(items: T[], fac: (x: T) => string, first: (x: T) => boolean, draw: (x: T) => string): string => {
    const facs = [...new Set(items.map(fac))].sort((a, b) => rank(a) - rank(b));
    return facs.map((f) => {
      const members = items.filter((x) => fac(x) === f).sort((a, b) => Number(first(b)) - Number(first(a)));
      return `<p class="pad-label pad-inv-fac">${esc(facLabel(f))}</p><div class="pad-inv-group">${members.map(draw).join('')}</div>`;
    }).join('');
  };
  const boxRow = (b: typeof boxes[number]) => {
    const n = col.boxes[b.key] ?? 0;
    return `<div class="pad-row pad-inv-row${n ? ' owned' : ''}">
      <span class="pad-part-name">${esc(b.name.en || b.name.zh || b.key)}</span>
      <div class="pad-chips pad-inv-count">
        ${n ? `<button class="pad-chip pad-inv-all" data-act="inv-box-all" data-key="${esc(b.key)}" title="Add everything in this box as built pieces">Build all</button>` : ''}
        <button class="pad-chip" data-act="inv-box" data-key="${esc(b.key)}" data-d="-1" aria-label="One fewer"${n ? '' : ' disabled'}>−</button>
        <span class="pad-inv-n">${n}</span>
        <button class="pad-chip" data-act="inv-box" data-key="${esc(b.key)}" data-d="1" aria-label="One more">+</button>
      </div>
    </div>`;
  };
  const singles = Object.entries(col.cards)
    .map(([id, n]) => ({ card: d.byId.get(id), id, n }))
    .filter((e) => e.card)
    .sort((a, b) => cardName(a.card).localeCompare(cardName(b.card)));
  return `<div class="pad-panel-in">${panelHead('Collection')}
    ${errHtml()}
    <p class="pad-label" style="margin-top:0">${esc(collectionSummary(col))}${account ? ' · saved to your account' : ''}</p>
    <div class="pad-chips" style="margin-bottom:8px">
      ${collectionChips(on)}
    </div>

    <p class="pad-label pad-sec">Built pieces</p>
    <input class="pad-input" id="pad-inv-q" type="search" placeholder="Find a card to record…" value="${esc(invSearch)}" autocomplete="off">
    <div id="pad-inv-found">${invFoundHtml()}</div>
    ${singles.length ? grouped(singles, (e) => d.factionOf(e.card!) ?? '', () => true, (e) => `<div class="pad-row pad-inv-row owned">
      <span class="pad-part-name" data-card="${esc(e.id)}">${esc(cardName(e.card))}</span>
      <div class="pad-chips pad-inv-count">
        <button class="pad-chip" data-act="inv-card" data-id="${esc(e.id)}" data-d="-1" aria-label="One fewer">−</button>
        <span class="pad-inv-n">${e.n}</span>
        <button class="pad-chip" data-act="inv-card" data-id="${esc(e.id)}" data-d="1" aria-label="One more">+</button>
      </div>
    </div>`) : '<p class="pad-label">None recorded. Boxes count in full until a card gets a built count.</p>'}

    <p class="pad-label pad-sec">Boxes</p>
    ${grouped(boxes, facOf, (b) => (col.boxes[b.key] ?? 0) > 0, boxRow)}
    ${hasAny(col) ? '<button class="pad-btn danger" data-act="inv-clear" style="margin-top:12px">Clear the collection</button>' : ''}
    <button class="pad-btn" data-act="inv-back" style="margin-top:8px">Back</button>
  </div>`;
}

// A Drone, or a Projectile (missiles, mines, beacons, walls - everything a
// unit deploys or fires), joins on its own: one card, the same importSquad the
// Mech builder sends. A carrier may take its Load on the way in, through a
// second picker over the Parts that can be one (the board's Load door).
function openDronePicker(kind: 'drone' | 'projectile'): void {
  const d = data;
  if (!d) return;
  const seat = solo ? squadSide : mySeat();
  const pool = d.cards
    .filter((c) => c.category === kind && !isDiscardCard(c))
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));
  const add = (card: Card, load?: string): void => {
    if (sendSquad(cardName(card), [], [{ cardId: card.id, backpack: load }])) {
      error = null;
      panel = null;
      toast(`${cardName(card)} added.`);
    }
    render();
  };
  openPartPicker({
    data: d,
    slotLabel: kind === 'drone' ? 'Drone' : 'Projectile',
    groups: groupByFaction(d, pool),
    lockedFaction: sideFaction(seat),
    badge: (c) => (kind === 'projectile' ? (isMine(c) ? 'Mine' : isDeployable(c) ? 'Deployable' : '') : isCarrier(c) ? 'Carrier' : ''),
    remaining: leftOf,
    actions: [{
      label: 'Add to squad',
      run: (card) => {
        if (!isCarrier(card)) { add(card); return; }
        // A carrier may take its Load on the way in.
        void choiceDialog({
          title: cardName(card),
          choices: [{ id: 'load', label: 'Add with a Load', primary: true }, { id: 'bare', label: 'Add without a Load' }, { id: 'no', label: 'Cancel', cancel: true }],
          stacked: true,
        }).then((pick) => {
          if (pick === 'bare') add(card);
          else if (pick === 'load') openLoadPicker(card, seat, (load) => add(card, load.id));
        });
      },
    }],
  });
}

function buildPanel(): string {
  const d = data!;
  const pts = buildPoints();
  const fac = buildFaction();
  const rows = BUILD_SLOTS.map((s) => {
    const id = build[s.key];
    const card = id ? d.byId.get(id) : undefined;
    const f = card ? d.factionOf(card) : null;
    return `<div class="pad-part-row">
      <button class="pad-part card-framed"${f ? ` data-fac="${esc(f)}"` : ''} data-act="build-slot" data-slot="${s.key}">
        ${card ? (s.key === 'pilot'
          ? `<span class="pilot-thumb pad-pilot-thumb" data-portrait="${esc(card.id)}"></span>`
          : `<span class="ref-art" data-partart="${esc(card.id)}" aria-hidden="true"></span>`) : ''}
        <span class="pad-part-slot">${s.label}</span>
        <span class="pad-part-name">${card ? esc(cardName(card)) : 'empty'}</span>
        <span class="pad-part-stats mono">${card?.score ? `${card.score}p` : ''}</span>
      </button>
      ${card ? `<button class="pad-part-info" data-act="card" data-id="${esc(card.id)}" aria-label="Read ${esc(cardName(card))}">i</button>` : ''}
    </div>`;
  }).join('');
  const torsoName = build.torso ? cardName(d.byId.get(build.torso)!) : '';
  return `<div class="pad-panel-in">${panelHead(editing ? 'Edit a saved unit' : 'Build a Mech')}
    ${errHtml()}
    <div class="pad-row">
      <span class="pad-seat-name">${esc(buildName.trim() || torsoName || 'Unnamed')}</span>
      <button class="pad-chip" data-act="build-rename">Rename</button>
    </div>
    <div class="pad-row">
      <span class="pad-label">${fac ? esc(fac) : 'any faction'}${solo ? ` · for ${squadSide === 's1' ? 'P1' : 'P2'}` : ''}</span>
      <span class="pad-num">${pts}<span class="pad-of">p</span></span>
    </div>
    ${rows}
    <div class="pad-melon">
      <a class="pad-btn pad-melon-link" href="https://watermelon02.github.io/builder-web/" target="_blank" rel="noopener">${MELON_ICON}Squad Builder</a>
      <button class="pad-btn" data-act="build-import">Import a build</button>
    </div>
    <div class="pad-foot">
      <button class="pad-btn primary" data-act="build-add"${build.torso ? '' : ' disabled'}>Add to squad</button>
      ${editing ? `<button class="pad-btn" data-act="build-overwrite"${buildChanged() && build.torso ? '' : ' disabled'}>Overwrite</button>` : ''}
      <button class="pad-btn" data-act="build-back">Back</button>
    </div>
  </div>`;
}

// The builder site's mark, the same one the board's Squad Builder link wears.
const MELON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M2,6A10,10 0 0,0 22,6Z M3.5,6A8.5,8.5 0 0,0 20.5,6Z"/><path fill-rule="evenodd" d="M4.4,6A7.6,7.6 0 0,0 19.6,6Z"/></svg>';

// One Mech out of a builder export (.json or the squad .png) into the six
// slots, to edit, save or add. A file holding several asks which.
async function importBuild(file: File): Promise<void> {
  if (!data) return;
  let squad: ImportedSquad;
  try {
    squad = await importSquadFile(file, data.byId);
  } catch (err) {
    error = (err as Error).message || 'That file could not be read.';
    render();
    return;
  }
  if (!squad.mechs.length) { error = 'That file holds no Mech.'; render(); return; }
  let at = 0;
  if (squad.mechs.length > 1) {
    const pick = await choiceDialog({
      title: squad.name,
      choices: squad.mechs.map((m, i) => {
        const torso = m.loadout.torso ? data!.byId.get(m.loadout.torso) : undefined;
        return { id: String(i), label: m.name || (torso ? cardName(torso) : `Mech ${i + 1}`) };
      }),
      stacked: true,
    });
    if (pick === null) return;
    at = Number(pick);
  }
  build = { ...squad.mechs[at].loadout };
  error = squad.unknownIds.length ? `Left out, not in the card data: ${squad.unknownIds.join(', ')}.` : null;
  render();
}

// ---------- find ----------
//
// One search over everything a player at the table asks for: the Parts on the
// table, the glossary, the card database, the Task cards and the rules. The
// results are the reference's own tiles, drawn by the reference's renderers,
// so a card looks the same here as it does there, and every tile opens the
// same detail sheet.

const SCOPES: { id: FindScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'table', label: 'On the table' },
  { id: 'parts', label: 'Parts' },
  { id: 'units', label: 'Units' },
  { id: 'pilots', label: 'Pilots' },
  { id: 'tactics', label: 'Tactics' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'rules', label: 'Rules' },
];

// The input is written WITHOUT its value: the query lives in `find.q`, and the
// field is set from it after the paint. A value attribute here would change
// the panel's markup on every keystroke, and a redraw would replace the field
// under the thumb typing into it.
function findPanel(): string {
  return `<div class="pad-panel-in pad-find">
    <div class="pad-find-head">
      <input class="pad-input" id="pad-find-q" type="search" placeholder="Parts, keywords, tasks, rules…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" />
      <button class="dlg-close pad-panel-x" data-act="close-panel" aria-label="Close">✕</button>
    </div>
    <div class="pad-find-scopes" id="pad-find-scopes"></div>
    <div class="pad-find-body" id="pad-find-body"></div>
  </div>`;
}

type FindGroup = { id: FindScope; label: string; total: number; tiles: string[] };

function findGroups(q: string, scope: FindScope): FindGroup[] {
  const d = data!;
  const groups: FindGroup[] = [];
  const cap = scope === 'all' ? 6 : 400;
  const want = (id: FindScope) => scope === 'all' || scope === id;
  const alpha = (a: Card, b: Card) => cardName(a).localeCompare(cardName(b));

  // Recents lead an empty search: what was just read is what is wanted again.
  if (!q && scope === 'all' && recents.length) {
    const tiles = recents.map((r) => {
      if (r.kind === 'card') {
        const c = d.byId.get(r.key);
        return c ? cardRow(c) : '';
      }
      const k = d.keyword(r.key);
      return k ? keywordCard(k) : '';
    }).filter(Boolean);
    if (tiles.length) groups.push({ id: 'all', label: 'Recent', total: tiles.length, tiles });
  }

  if (want('table')) {
    const tiles: string[] = [];
    for (const t of table.tokens) {
      for (const { slot, card } of tokenCards(d, t)) {
        if (q && !matchCard(card, q) && !norm(t.label).includes(q)) continue;
        tiles.push(`<div class="pad-find-on"><span class="pad-find-cap"><b style="color:${sideColour(t.side)}">${esc(t.label)}</b> · ${SLOT_LABEL[slot] ?? slot}</span>${cardRow(card)}</div>`);
      }
    }
    if (tiles.length) groups.push({ id: 'table', label: 'On the table', total: tiles.length, tiles: tiles.slice(0, cap) });
  }

  if (want('keywords') && (q || scope === 'keywords')) {
    const kws = found(d.keywords, q, matchKeyword, nmKeyword);
    if (kws.length) groups.push({ id: 'keywords', label: 'Keywords', total: kws.length, tiles: kws.slice(0, cap).map((k) => keywordCard(k)) });
  }

  const pools: [FindScope, string, (c: Card) => boolean][] = [
    ['parts', 'Parts', (c) => c.category === 'mech_part'],
    ['units', 'Units', (c) => c.category === 'drone' || c.category === 'projectile'],
    ['pilots', 'Pilots', (c) => c.category === 'pilot'],
    ['tactics', 'Tactics', (c) => c.category === 'tactics_or_upgrade'],
  ];
  for (const [id, label, pick] of pools) {
    if (!want(id) || (!q && scope !== id)) continue;
    const pool = found(d.cards.filter(pick), q, matchCard, nmCard, alpha);
    if (pool.length) groups.push({ id, label, total: pool.length, tiles: pool.slice(0, cap).map((c) => cardRow(c)) });
  }

  if (want('tasks') && (q || scope === 'tasks')) {
    const mains = found(d.missions.cards, q, matchMission, nmMission);
    const secs = found(d.secondary, q, matchSecondary, nmSecondary);
    const tiles = [
      ...mains.map((m) => taskCard(`data-mission="${esc(m.id)}"`, missionImageUrl(m.id), m.name, m.scoring, `Main · ${m.vp ?? 0} VP`)),
      ...secs.map((s) => taskCard(`data-secondary="${esc(s.id)}"`, secondaryImageUrl(s.id), s.name, s.scoring ?? '', `Secondary · ${s.vp ?? 0} VP`)),
    ];
    if (tiles.length) groups.push({ id: 'tasks', label: 'Tasks', total: tiles.length, tiles: tiles.slice(0, cap) });
  }

  if (want('rules') && (q || scope === 'rules')) {
    const tile = (title: string, body: string, foot: string) =>
      `<article class="card"><div class="card-title">${esc(title)}</div><div class="card-body">${body}</div>${foot ? `<div class="card-foot">${foot}</div>` : ''}</article>`;
    const mechs = found(d.mechanics, q, matchMechanic, nmMechanic)
      .map((m) => tile(m.name, linkKeywords(m.text), m.ref ? `<span class="tag mono">${esc(m.ref)}</span>` : ''));
    const phases = found(d.play.phases, q, matchPhase, nmPlay)
      .map((p) => tile(`${p.order}. ${p.name} Phase`,
        `${p.who ? `<p>${esc(p.who)}</p>` : ''}${p.can.length ? `<p class="play-can"><b>Can</b> ${esc(p.can.join(' · '))}</p>` : ''}${p.cannot.length ? `<p class="play-cant"><b>Cannot</b> ${esc(p.cannot.join(' · '))}</p>` : ''}`,
        p.ref ? `<span class="tag mono">${esc(p.ref)}</span>` : '<span class="tag">phase</span>'));
    const timings = found(d.play.timings, q, matchTiming, nmPlay)
      .map((x) => tile(`${x.name} timing`, linkKeywords(x.text), '<span class="tag">timing</span>'));
    const stances = found(d.play.stances, q, matchStance, nmPlay)
      .map((x) => tile(`${x.name} stance`, `<p>${linkKeywords(x.effect)}</p><p class="play-can"><b>Good for</b> ${esc(x.good)}</p><p class="play-cant"><b>Costs</b> ${esc(x.cost)}</p>`,
        x.ref ? `<span class="tag mono">${esc(x.ref)}</span>` : ''));
    const toks = found(STATUSES, q, matchStatus, nmStatus)
      .map((s) => {
        const art = tokenArt(s.id, false);
        return `<article class="card tok-card"><div class="card-title">${art ? `<span class="tok-art"><img class="tok-print" src="${esc(art)}" alt="" /></span>` : ''}${esc(s.label)}</div><div class="card-body">${linkKeywords(s.rule)}</div><div class="card-foot"><span class="tag">${esc(s.shape)} token</span>${s.decay ? `<span class="tag">${esc(s.decay)}</span>` : ''}</div></article>`;
      });
    const tiles = [...mechs, ...phases, ...timings, ...stances, ...toks];
    if (tiles.length) groups.push({ id: 'rules', label: 'Rules', total: tiles.length, tiles: tiles.slice(0, cap) });
  }
  return groups;
}

function findScopesHtml(groups: FindGroup[]): string {
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g.id, (counts.get(g.id) ?? 0) + g.total);
  return SCOPES.map((s) => `<button class="pad-chip${find.scope === s.id ? ' on' : ''}" data-act="find-scope" data-scope="${s.id}">${s.label}${
    s.id !== 'all' && find.q.trim() && counts.has(s.id) ? `<span class="fc-n">${counts.get(s.id)}</span>` : ''}</button>`).join('');
}

function findBodyHtml(groups: FindGroup[]): string {
  const q = norm(find.q.trim());
  if (!groups.length) {
    return `<p class="ref-count">${q ? 'No matches.' : find.scope === 'all' ? 'Type to search, or pick a scope.' : 'Nothing here.'}</p>`;
  }
  return groups.map((g) => `<div class="ref-group">
      <div class="ref-group-head">${esc(g.label)} <span class="fc-n">${g.total}</span></div>
      <div class="pad-find-tiles">${g.tiles.join('')}</div>
      ${g.total > g.tiles.length ? `<button class="pad-btn" data-act="find-scope" data-scope="${g.id}">All ${g.total} in ${esc(g.label)}</button>` : ''}
    </div>`).join('');
}

// Repaints the search's two live regions without touching the input.
function paintFind(): void {
  if (panel !== 'find' || !data) return;
  const groups = findGroups(norm(find.q.trim()), find.scope);
  paint('pad-find-scopes', findScopesHtml(groups));
  if (paint('pad-find-body', findBodyHtml(groups))) {
    const body = document.getElementById('pad-find-body');
    if (body) fillPortraits(body, true);
  }
  const input = document.getElementById('pad-find-q') as HTMLInputElement | null;
  if (input && input.value !== find.q) input.value = find.q;
}

// ---------- the detail sheet: the reference's own ----------
//
// The markup is reference.html's #ref-detail, verbatim, and reference.css
// styles it by those ids, so a card here IS the card there. The navigation is
// the reference's too: a keyword opened from a card goes BACK to that card.

type Look = { kind: 'card' | 'keyword'; key: string; tab?: string; scroll?: number };
let looks: Look[] = [];

const detail = () => document.getElementById('ref-detail');
const detailScroller = () => detail()?.querySelector('.ref-detail-inner') as HTMLElement | null;

function lookHtml(v: Look): string | null {
  if (!data) return null;
  if (v.kind === 'card') {
    const c = data.byId.get(v.key);
    return c ? cardDetail(c) : null;
  }
  return keywordDetail(v.key);
}

function lookLabel(v: Look): string {
  if (!data) return v.key;
  if (v.kind === 'card') return cardName(data.byId.get(v.key));
  const def = data.keyword(v.key);
  return def?.en?.name?.replace(/^[•·\s]+/, '') || v.key;
}

function openLook(kind: Look['kind'], rawKey: string): void {
  if (!data) return;
  const key = kind === 'keyword' ? data.keyword(rawKey)?.key ?? rawKey : rawKey;
  const v: Look = { kind, key };
  const html = lookHtml(v);
  if (html === null) return;
  const sheet = detail();
  if (!sheet) return;
  if (sheet.hidden) looks = [];
  else {
    const top = looks[looks.length - 1];
    if (top && top.kind === kind && top.key === key) return;
    const under = looks[looks.length - 2];
    if (under && under.kind === kind && under.key === key) return backLook();
    if (top) top.scroll = detailScroller()?.scrollTop ?? 0;
  }
  looks.push(v);
  remember({ kind, key });
  paintDetail(html, 0);
}

function backLook(): void {
  if (looks.length < 2) return closeLook();
  looks.pop();
  const prev = looks[looks.length - 1];
  const html = lookHtml(prev);
  if (html === null) return closeLook();
  paintDetail(html, prev.scroll ?? 0);
  if (prev.tab) showTab(prev.tab);
}

function closeLook(): void {
  const sheet = detail();
  if (sheet) sheet.hidden = true;
  looks = [];
}

// Switching tabs is pure DOM and never a re-render: repainting would remount
// the card image and throw away the scroll position.
function showTab(which: string): void {
  const top = looks[looks.length - 1];
  if (top) top.tab = which;
  const content = document.getElementById('ref-detail-content');
  if (!content) return;
  for (const b of content.querySelectorAll<HTMLElement>('[data-dtab]')) {
    const on = b.dataset.dtab === which;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const p of content.querySelectorAll<HTMLElement>('[data-dpanel]')) p.hidden = p.dataset.dpanel !== which;
}

function paintDetail(html: string, scrollTop: number): void {
  const sheet = detail();
  const content = document.getElementById('ref-detail-content');
  if (!sheet || !content) return;
  content.innerHTML = html;
  // The card image is MOUNTED rather than written as an <img>: images.ts holds
  // the retry and the cards that have no scan. The thumbnail on the Card tab
  // and the full one on the Photo tab hold the same scan and need DIFFERENT
  // mounts - the cache holds one element per id, so the thumb takes a copy.
  content.querySelectorAll<HTMLElement>('[data-img]').forEach((slot) => {
    const isThumb = !!slot.closest('.dthumb');
    (isThumb ? mountCardImageCopy : mountCardImage)(slot, slot.dataset.img!, isThumb ? 'dthumb-img' : 'ref-cardimg');
    const img = slot.querySelector('img');
    // A card with no scan loses its Photo tab and its thumbnail, exactly as on
    // the reference, rather than promising a picture that is not there.
    const drop = () => {
      slot.closest('.ref-scan')?.remove();
      content.querySelector('.dthumb')?.remove();
      const tab = content.querySelector<HTMLElement>('[data-dtab="photo"]');
      const pane = content.querySelector<HTMLElement>('[data-dpanel="photo"]');
      if (tab) tab.hidden = true;
      if (pane && !pane.hidden) showTab('card');
    };
    if (!img) { drop(); return; }
    if (img.complete && !img.naturalWidth) drop();
    else img.addEventListener('error', drop, { once: true });
  });
  fillPortraits(content, false);
  sheet.hidden = false;
  const scroller = detailScroller();
  if (scroller) scroller.scrollTop = scrollTop;
  const back = document.getElementById('ref-detail-back') as HTMLButtonElement | null;
  const prev = looks.length >= 2 ? looks[looks.length - 2] : null;
  if (back) {
    back.hidden = !prev;
    const label = prev ? `Back to ${lookLabel(prev)}` : 'Back';
    back.title = label;
    back.setAttribute('aria-label', label);
  }
}

// Any card worth reading at full size: a Task card's zones and scoring are too
// small in a row. The reference's own lightbox, markup and all.
function showImage(src: string, label: string): void {
  document.querySelector('.mis-lightbox')?.remove();
  const box = document.createElement('div');
  box.className = 'mis-lightbox';
  box.innerHTML = `<div class="mis-lightbox-inner">
      <button class="mis-close" title="Close">✕</button>
      <img src="${esc(src)}" alt="${esc(label)} card">
      <p>${esc(label)}</p>
    </div>`;
  box.addEventListener('click', (ev) => {
    if (ev.target === box || (ev.target as HTMLElement).closest('.mis-close')) box.remove();
  });
  document.body.appendChild(box);
}

// ---------- toasts ----------
//
// What the OTHER phone did, said in a line at the bottom of the screen: the
// player holding this one may be reading a different sheet. Each carries an
// Undo, because the table's undo is a checkpoint either phone may publish.

let toasts: { id: number; text: string; undo: boolean }[] = [];
let toastSeq = 0;
// Set by a long press on a worn Token, and consumed by the click the browser
// fires when the finger lifts, so the hold does not also age the Token.
let heldTok = false;
// A saved unit opened in the builder by a HOLD on its row: the preset, and its
// loadout as it was opened, so Overwrite lights only once something changed.
let editing: { id: string; name: string; was: MechLoadout } | null = null;
let heldSaved = false;
// The name the build carries: a saved unit's when editing, else what Rename
// set, else the Torso's card name when it is added.
let buildName = '';
function buildChanged(): boolean {
  if (!editing) return false;
  // Parts and pilot only: a rename saves itself the moment it is set.
  return BUILD_SLOTS.some((s) => (build[s.key] ?? '') !== (editing!.was[s.key] ?? ''));
}

function toast(text: string, undo = false): void {
  const id = ++toastSeq;
  toasts = [...toasts.slice(-2), { id, text, undo }];
  paint('pad-toasts', toastsHtml());
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    paint('pad-toasts', toastsHtml());
  }, undo ? 4500 : 2600);
}

function toastsHtml(): string {
  return toasts.map((t) => `<div class="pad-toast" data-toast="${t.id}"><span>${esc(t.text)}</span>${
    t.undo ? '<button class="pad-chip" data-act="undo">Undo</button>' : ''}<button class="ui-x" data-act="toast-x" data-id="${t.id}" aria-label="Dismiss">✕</button></div>`).join('');
}

// Which remote commands are worth announcing: anything done TO one of our
// units, and anything about the table as a whole. The other player's edits to
// their own units are theirs to make and show on their tab.
function toastRemote(cmd: Command): void {
  const c = cmd as Command & { uid?: number; targetUid?: number };
  const tableWide = new Set(['award', 'pickSecondary', 'configureTable', 'advancePhase', 'setPhase', 'resetRounds', 'importSquad']);
  if (cmd.kind === 'setReady') {
    const ready = (cmd as { ready?: boolean }).ready;
    toast(ready ? `${sideName(otherSeat())} is ready to move on.` : `${sideName(otherSeat())} is not ready yet.`);
    return;
  }
  const target = table.tokens.find((x) => x.uid === (c.targetUid ?? c.uid));
  if (!tableWide.has(cmd.kind) && !(target && target.side === mySeat())) return;
  toast(labelFor(cmd, table, names()).label, true);
}

function undo(): void {
  const undone = undoLast(table);
  if (!undone) return;
  // THE UNDO HAS TO TRAVEL. The history stack is local, so stepping back here
  // would otherwise leave the other pad holding the version with the mistake
  // still in it. There is no "undo" command to publish - the pad states the
  // result instead: this IS the table now.
  relay.publishCheckpoint();
  saveSolo();
  error = null;
  toast(`Undid ${undone.human ?? undone.label}.`);
  render();
}

// ---------- render ----------
//
// REGIONS, NOT A SCREEN. The table screen is a fixed skeleton whose regions
// are each repainted only when their markup changes, so a relay ping does not
// rebuild the sheet under a thumb, a scroll position survives a token being
// placed, and the eye keeps its place. The screens before a table are small
// and are still drawn whole.

const painted = new Map<string, string>();

function paint(id: string, html: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  if (painted.get(id) === html) return false;
  el.innerHTML = html;
  painted.set(id, html);
  // Rewriting a container replaces every region inside it with a fresh,
  // empty element, so what the cache remembers for those ids is stale: the
  // Find panel's scope bar came back blank whenever it was reopened with the
  // same scope, because its html "had not changed".
  for (const k of [...painted.keys()]) {
    if (k !== id && el.querySelector(`#${k}`)) painted.delete(k);
  }
  return true;
}

// The strip, the sheet, the panel and the toasts share ONE box between the
// bar and the dock, so a panel covers exactly that box however tall the bar
// and dock come out - on a phone both grow with the notch and the home
// indicator, and a panel sized from fixed heights sat over the dock.
const SKELETON = `<header class="pad-bar" id="pad-bar"></header>
  <div class="pad-mid" id="pad-mid">
    <div class="pad-turn" id="pad-turn" hidden></div>
    <div class="pad-strip" id="pad-strip"></div>
    <main class="pad-sheet" id="pad-sheet"></main>
    <div class="pad-strip pad-strip-2" id="pad-strip2"></div>
    <main class="pad-sheet pad-sheet-2" id="pad-sheet2"></main>
    <div class="pad-panel" id="pad-panel" hidden></div>
    <div class="pad-toasts" id="pad-toasts"></div>
  </div>
  <nav class="pad-dock" id="pad-dock"></nav>
  <div id="ref-detail" hidden>
    <div class="ref-detail-inner">
      <div class="ref-detail-tools">
        <button id="ref-detail-back" data-act="look-back" title="Back" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <button id="ref-detail-close" data-act="look-close" title="Close">✕</button>
      </div>
      <div id="ref-detail-content"></div>
    </div>
  </div>`;

function render(): void {
  if (data) noteDead();
  // The relay is the authority on where we are once signed in: a reconnect
  // that lands us back in a room must not leave the lobby showing.
  // Solo stands on its own: it never touches the server, so it needs no
  // account, and a signed-out phone lands back on the sign-in screen when
  // the game is left.
  const atTable = !!view.room || solo;
  if (atTable && (account || solo)) screen = 'table';
  else if (screen === 'table' || ((screen === 'lobby' || screen === 'collection') && !account)) screen = account ? 'lobby' : 'signin';

  if (screen !== 'table') {
    // Back on the door screens, so a new build published mid-game is offered
    // now rather than mid-sheet; the watcher itself is gated the same way.
    if (root.className === 'table') void checkForUpdates();
    root.className = '';
    painted.clear();
    looks = [];
    root.innerHTML = screen === 'signin' ? signinHtml() : screen === 'register' ? registerHtml() : screen === 'collection' ? collectionHtml() : lobbyHtml();
    return;
  }

  if (root.className !== 'table' || !document.getElementById('pad-bar')) {
    root.className = 'table';
    root.innerHTML = SKELETON;
    painted.clear();
    looks = [];
  }
  // A guided Opportunity opening on one of our units brings that unit's
  // sheet up, once, so the action list is the one with the Perform buttons.
  const act = data ? activeOpp(guide) : null;
  if (act && act.mine && act.uid !== shownOpp) {
    shownOpp = act.uid;
    const u = unitOf(act.uid);
    if (u) { picks[u.side] = u.uid; side = u.side; sheetView[u.side].action = null; }
  } else if (!act) shownOpp = null;
  paint('pad-bar', barHtml());
  const turn = document.getElementById('pad-turn');
  if (turn) {
    // Guided was chosen but not started: squads and cards are still being
    // added from More, and the Start button used to live only in the Setup
    // panel, two taps away each time. The strip keeps it in reach.
    const pending = !!data && wantsGuided() && !guidedOn(table);
    const on = (!!data && guidedOn(table)) || pending;
    turn.hidden = !on;
    if (pending) paint('pad-turn', pendingGuidedHtml());
    else if (on) paint('pad-turn', turnHtml(guide));
  }
  const two = !!data && wide();
  const left = two ? mySeat() : shownSide();
  const mountSheet = (id: string, s: Side | null) => {
    if (paint(id, s ? sheetHtml(s) : '')) {
      const sheet = document.getElementById(id);
      if (sheet) {
        fillPortraits(sheet, true);
        for (const img of sheet.querySelectorAll<HTMLImageElement>('.pad-mech-art img')) {
          img.addEventListener('error', () => img.remove(), { once: true });
        }
      }
    }
  };
  paint('pad-strip', stripHtml(left));
  mountSheet('pad-sheet', left);
  paint('pad-strip2', two ? stripHtml(otherSeat()) : '');
  mountSheet('pad-sheet2', two ? otherSeat() : null);
  paint('pad-dock', dockHtml());
  // The other phone's attack, mirrored here; a view this phone no longer
  // drives, taken back.
  if (data && panel !== 'combat' && !attackActive()) { syncMirror(); sweepView(); }
  if (data && panel !== 'combat' && !ewActive()) syncContest();
  const p = document.getElementById('pad-panel')!;
  p.hidden = !panel;
  if (panel === 'combat') {
    if (paint('pad-panel', combatPanel())) {
      const body = document.getElementById('combat-body');
      if (body) mountAttack(body);
      const ew = document.getElementById('ew-body');
      if (ew) mountEw(ew);
    }
    if (data) { syncMirror(); syncContest(); }
  } else if (panel) {
    if (paint('pad-panel', panelHtml())) {
      fillPortraits(p, true);
      if (panel === 'find') {
        paintFind();
        document.getElementById('pad-find-q')?.focus();
      }
    } else if (panel === 'find') paintFind();
    const ta = document.getElementById('pad-notes') as HTMLTextAreaElement | null;
    if (ta && ta.value !== notes) ta.value = notes;
  }
  paint('pad-toasts', toastsHtml());
}

// ---------- wiring: one delegated handler ----------
//
// Installed ONCE, on the root, and reading `data-act` off whatever was tapped.
// The regions above are repainted piecemeal, so per-element listeners would
// have to be re-attached region by region; delegation needs nothing. The
// reference's renderers write their own anchors - data-kw, data-card,
// data-dtab, data-mission - and this answers those too, which is the whole
// bridge: every piece of printed text on a card is a way into the rulebook.

function openPanel(which: Panel): void {
  panel = panel === which ? null : which;
  error = null;
  picking = null;
  render();
}

function selectSide(s: Side): void {
  side = s;
  panel = null;
  // Nothing is closed: each side keeps what it had open, so flicking between
  // P1 and P2 comes back to the sheet as it was left.
  render();
}

function moveUnit(by: number): void {
  const units = unitsOf(shownSide());
  const t = shownUnit();
  if (!t || units.length < 2) return;
  const i = units.findIndex((u) => u.uid === t.uid);
  const next = units[(i + by + units.length) % units.length];
  picks[next.side] = next.uid;
  // A different unit: only ITS side's sheet starts afresh.
  { const w = sheetView[next.side]; w.slot = null; w.action = null; w.tokPick = false; w.tokManage = null; }
  render();
}

function act(el: HTMLElement, ev: Event): void {
  const a = el.dataset.act!;
  if (screen === 'table') actSide = columnSide(el);
  const v = sheetView[actSide];
  const t = screen === 'table' ? unitFor(columnSide(el)) : null;
  switch (a) {
    // ----- before a table -----
    case 'to-register': error = null; screen = 'register'; render(); return;
    case 'to-signin': error = null; screen = 'signin'; render(); return;
    case 'signin':
      void run(async () => {
        account = await api.login(form.user, form.pass);
        form.pass = '';
        screen = 'lobby';
      });
      return;
    case 'register':
      void run(async () => {
        account = await api.register(form.ruser, form.rpass, form.code.trim());
        form.rpass = '';
        screen = 'lobby';
      });
      return;
    case 'signout':
      void run(async () => {
        relay.leave();
        solo = false;
        await api.logout();
        account = null;
        screen = 'signin';
      });
      return;
    case 'host': error = null; resetTable(); setupPending = true; relay.host(); render(); return;
    case 'join': {
      const code = form.join.trim().toUpperCase();
      if (!code) {
        error = 'Type the code the other player read out, or track solo instead.';
        render();
        return;
      }
      error = null;
      resetTable();
      relay.join(code);
      render();
      return;
    }
    case 'solo': {
      resetTable();
      solo = true;
      soloId = `g${Date.now().toString(36)}`;
      error = null;
      panel = 'setup';
      saveSolo();
      render();
      return;
    }
    case 'resume': {
      const g = savedGames().find((x) => x.id === el.dataset.id);
      if (!g) return;
      resetTable();
      solo = true;
      soloId = g.id;
      table = migrated(g.table) ?? g.table;
      error = null;
      toast(`Picked up ${g.name}.`);
      render();
      return;
    }
    case 'solo-leave':
    case 'solo-to-signin':
      saveSolo();
      solo = false;
      soloId = null;
      resetTable();
      screen = account ? 'lobby' : 'signin';
      error = null;
      render();
      return;
    case 'game-x':
    case 'solo-end':
      void (async () => {
        const id = a === 'game-x' ? el.dataset.id! : soloId;
        if (!id) return;
        const g = savedGames().find((x) => x.id === id);
        const sure = await confirmDialog({
          title: `Delete ${g?.name ?? 'this game'}?`,
          confirmLabel: 'Delete it',
          danger: true,
        });
        if (!sure) return;
        deleteGame(id);
        if (id === soloId) {
          solo = false;
          soloId = null;
          resetTable();
          screen = 'lobby';
        }
        render();
      })();
      return;
    case 'rejoin':
      error = null;
      resetTable();
      relay.join(el.dataset.id!);
      render();
      return;
    case 'room-x': forgetRoom(el.dataset.id!); render(); return;
    case 'leave': relay.leave(); resetTable(); screen = 'lobby'; render(); return;
    case 'close-room':
      void (async () => {
        const id = view.room?.id;
        const sure = await confirmDialog({
          title: 'Close the table for everyone?',
          confirmLabel: 'Close it',
          danger: true,
        });
        if (!sure) return;
        relay.closeRoom();
        if (id) forgetRoom(id);
        relay.leave();
        resetTable();
        screen = 'lobby';
        render();
      })();
      return;

    // ----- the dock and the bar -----
    case 'dock': {
      const which = el.dataset.dock!;
      if (which === 'yours') selectSide(mySeat());
      else if (which === 'theirs') selectSide(otherSeat());
      else openPanel(which as Panel);
      return;
    }
    case 'claim': {
      const side = (el.dataset.side || null) as Side | null;
      send({ kind: 'claimItem', seat: mySeat(), itemId: el.dataset.item!, side });
      return;
    }
    case 'box-take': void takeBox(el.dataset.item!); return;
    case 'box-drop': {
      const box = normaliseTasks(table.tasks).items.find((i) => i.id === el.dataset.item);
      const bearer = box?.bearerUid !== undefined ? unitOf(box.bearerUid) : null;
      if (!box || !bearer) return;
      // Off the Box first, so a later carrier does not inherit the claim.
      if (box.accessed) send({ kind: 'claimItem', seat: mySeat(), itemId: box.id, side: null });
      send({ kind: 'dropBlackBox', seat: bearer.side, uid: bearer.uid, itemId: box.id, to: { col: bearer.col, row: bearer.row } });
      return;
    }
    case 'award': {
      if (!data) return;
      const got = previewScore(data, table, table.round.n >= roundLimit(), { settle: false, zoneCells: () => [] });
      if (!got.lines.length) return;
      send({ kind: 'award', seat: mySeat(), vp: { s1: got.s1, s2: got.s2 }, keys: [...got.lines.map((l) => l.key).filter((k): k is string => !!k), `pad-round:${table.round.n}`] });
      return;
    }
    case 'close-panel':
      if (screen === 'collection') { screen = 'lobby'; error = null; render(); return; }
      panel = null; picking = null; error = null; render(); return;
    case 'open-setup': panel = 'setup'; render(); return;
    case 'set-mode': send({ kind: 'configureTable', seat: mySeat(), guidedPlay: el.dataset.mode === 'guided' }); return;
    case 'set-dice': send({ kind: 'configureTable', seat: mySeat(), tableDice: el.dataset.dice === 'table' }); return;
    case 'attack': {
      const t = unitOf(Number(el.dataset.uid));
      if (!t) return;
      targetFor = { uid: t.uid, actionId: el.dataset.id!, mode: (el.dataset.mode as PickMode) ?? 'attack' };
      panel = 'target';
      render();
      return;
    }
    case 'intercept': {
      if (!t) return;
      targetFor = { uid: t.uid, actionId: el.dataset.id!, mode: 'intercept' };
      panel = 'target';
      render();
      return;
    }
    case 'pick-target': {
      const t = targetFor ? unitOf(targetFor.uid) : null;
      const d = unitOf(Number(el.dataset.uid));
      if (!t || !d || !targetFor) return;
      const { actionId, mode, granted } = targetFor;
      targetFor = null;
      panel = null;
      render();
      if (mode === 'intercept') void askTableAndIntercept(t, actionId, d);
      else if (mode === 'electronic') void askTableAndElectronic(t, actionId, d);
      else void askTableAndAttack(t, actionId, d, !!granted);
      return;
    }
    case 'g-start':
      if (!table.tokens.length) { toast('Add the squads first.'); return; }
      startGuided(guide);
      panel = null;
      render();
      return;
    case 'g-main':
      // From the Guided strip: draw three (the discards are made on Tasks), or
      // pick one outright and come straight back.
      panel = 'tasks';
      if (el.dataset.how === 'draw') { pickFromGuide = false; drawThree(); return; }
      pickFromGuide = true;
      picking = 'main';
      render();
      return;
    case 'g-secondary':
      pickFromGuide = true;
      picking = 'secondary';
      pickFor = (el.dataset.side as Side) ?? mySeat();
      panel = 'tasks';
      render();
      return;
    case 'set-rounds': send({ kind: 'configureTable', seat: mySeat(), roundLimit: Number(el.dataset.n) }); return;
    case 'set-scale': send({ kind: 'configureTable', seat: mySeat(), scale: el.dataset.id as GameState['scale'] }); return;
    case 'phase': pressContinue(); return;
    case 'phase-back': {
      const r = table.round;
      if (r.phase > 0) send({ kind: 'setPhase', seat: mySeat(), phase: r.phase - 1 });
      else toast('The round starts here. Use the rounds reset to go back further.');
      return;
    }
    case 'rounds-reset':
      void (async () => {
        const sure = await confirmDialog({ title: 'Start the rounds over?', body: 'Round 1, Command Phase.', confirmLabel: 'Start over' });
        if (sure) send({ kind: 'resetRounds', seat: mySeat() });
      })();
      return;

    // ----- the strip and the sheet -----
    case 'group': {
      const k = el.dataset.key ?? null;
      const wasOpen = el.getAttribute('aria-expanded') === 'true';
      openGroup = wasOpen ? null : k;
      closedGroup = wasOpen ? k : null;
      render();
      return;
    }
    case 'unit':
      // From the destroyed list the unit may sit on the other side.
      // Only the sheet the unit belongs to starts afresh; the other keeps
      // whatever it had open.
      { const u = unitOf(Number(el.dataset.uid)); if (u) { picks[u.side] = u.uid; side = u.side; }
        const w = sheetView[u?.side ?? actSide]; w.slot = null; w.action = null; w.tokPick = false; w.tokManage = null; }
      closedGroup = null;
      error = null;
      render();
      return;
    case 'open':
      v.slot = v.slot === el.dataset.slot ? null : el.dataset.slot!;
      render();
      return;
    case 'open-action':
      v.action = v.action === el.dataset.id ? null : el.dataset.id!;
      render();
      return;
    case 'card':
      openLook('card', el.dataset.id!);
      return;
    case 'rename':
      if (!t) return;
      void (async () => {
        const next = await promptDialog({
          title: `Rename ${t.label}`,
          value: t.label,
          confirmLabel: 'Rename',
        });
        if (next === null) return;
        // NOT tidyUnitLabel: that strips the colour a squad file prefixes its
        // units with, and a callsign a player typed is theirs as typed - a
        // playtest's "Blue Two" came back as "Two". Whitespace only.
        const label = next.replace(/\s+/g, ' ').trim().slice(0, 40);
        if (label && label !== t.label) send({ kind: 'renameUnit', seat: t.side, uid: t.uid, label });
      })();
      return;
    case 'hit': {
      if (!t) return;
      // A TAP CYCLES, as freeplay's inspector does. The hit was resolved on the
      // table and the player is writing it down, so a wrong tap costs one more
      // tap rather than an Undo. The seat is OURS - who recorded it - because
      // setPartState is a table command and the relay refuses any other.
      const slot = el.dataset.slot as PartSlot | 'main';
      send({ kind: 'setPartState', seat: mySeat(), uid: t.uid, slot: slot as PartSlot, state: nextState(t, slot) });
      return;
    }
    case 'stance': if (t) send({ kind: 'setStance', seat: t.side, uid: t.uid, stance: el.dataset.stance as Stance }); return;
    case 'reboot': if (t) send({ kind: 'reboot', seat: t.side, uid: t.uid, stance: el.dataset.stance as Stance }); return;
    // NOT restoreLink: that command is ZPA-40 Elation's own ability. Stabilize
    // System (6.1) is how a Mech actually takes a Link back.
    case 'stabilise': if (t) stabilise(t); return;
    case 'reveal': if (t) send({ kind: 'reveal', seat: t.side, uid: t.uid }); return;
    case 'link-down': if (t) send({ kind: 'drainLink', seat: t.side, uid: t.uid, targetUid: t.uid, n: 1 }); return;
    case 'ammo-down': if (t) send({ kind: 'spendAmmo', seat: t.side, uid: t.uid, actionId: el.dataset.id! }); return;
    case 'ammo-up': if (t) send({ kind: 'restoreAmmo', seat: t.side, uid: t.uid, actionId: el.dataset.id!, amount: 1 }); return;
    case 'intercept-down': if (t) send({ kind: 'spendIntercept', seat: t.side, uid: t.uid, actionId: el.dataset.id! }); return;
    case 'intercept-up': if (t) send({ kind: 'restoreIntercept', seat: t.side, uid: t.uid, actionId: el.dataset.id! }); return;
    case 'remove': {
      if (!t) return;
      void (async () => {
        const ok = await choiceDialog({
          title: `Remove ${t.label}?`,
          body: 'It leaves the table and its records with it.',
          choices: [{ id: 'yes', label: 'Remove', primary: true }, { id: 'no', label: 'Keep it', cancel: true }],
          stacked: true,
        });
        if (ok !== 'yes') return;
        if (send({ kind: 'despawn', seat: t.side, uid: t.uid, targetUid: t.uid })) { picks[t.side] = null; render(); }
      })();
      return;
    }
    case 'load-off': if (t) send({ kind: 'setLoad', seat: t.side, uid: t.uid }); return;
    case 'timing': {
      if (!t) return;
      const tm = el.dataset.timing as Token['timing'];
      send({ kind: 'setTiming', seat: t.side, uid: t.uid, timing: t.timing === tm ? undefined : tm });
      return;
    }
    case 'load-pick': {
      const own = t && data ? data.byId.get(t.cardId) : undefined;
      if (!t || !own) return;
      openLoadPicker(own, t.side, (load) => { send({ kind: 'setLoad', seat: t.side, uid: t.uid, cardId: load.id }); render(); });
      return;
    }
    case 'tag': {
      const by = unitOf(Number(el.dataset.uid));
      const a = by && data ? tokenCards(data, by).flatMap((c) => c.card.actions ?? []).find((x) => x.id === el.dataset.id) : undefined;
      const grant = a ? targetStatusGrant(a) : null;
      if (!by || !a || !grant) return;
      void (async () => {
        const units = table.tokens.filter((x) => x.uid !== by.uid && x.deployed !== false && !isDead(x)
          && (grant.side === 'any' || (grant.side === 'enemy') === (x.side !== by.side)));
        if (!units.length) { toast(`${a.name.en ?? 'This Action'}: there is no unit to target.`); return; }
        const pick = await choiceDialog({
          title: a.name.en ?? 'Target',
          body: a.range ? `One target within Range ${a.range}, in line of sight.` : 'One target.',
          choices: units.map((x) => ({ id: String(x.uid), label: `${x.side === by.side ? 'Ally' : 'Enemy'} · ${x.label}` })),
          stacked: true,
        });
        if (pick !== null) send({ kind: 'applyStatus', seat: by.side, uid: by.uid, targetUid: Number(pick), statusId: grant.statusId, stacks: grant.stacks });
      })();
      return;
    }
    case 'charge-pick': {
      if (!t || !data) return;
      const open = chargeableSlots(data, t).filter((x) => !x.charged);
      if (!open.length) return;
      void (async () => {
        const slot = open.length === 1 ? String(open[0].slot)
          : await choiceDialog({ title: 'Charge', choices: open.map((x) => ({ id: String(x.slot), label: `${x.label} · ${partName(t, String(x.slot))}` })), stacked: true });
        if (slot !== null) send({ kind: 'setCharge', seat: t.side, uid: t.uid, slot, on: true });
      })();
      return;
    }
    case 'discard-pick': {
      if (!t || !data) return;
      void discardPart(t);
      return;
    }
    case 'charge': if (t) send({ kind: 'setCharge', seat: t.side, uid: t.uid, slot: el.dataset.slot!, on: el.dataset.on === '1' }); return;
    case 'tok-open':
      v.tokPick = !v.tokPick; v.tokManage = null; render();
      // The list opens under the Tokens row, usually below the fold: bring it
      // into view rather than leaving the player to go and find it.
      // render() is synchronous, so the list is already in the page here.
      if (v.tokPick) {
        document.querySelector('.pad-tokpop')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        // A smooth scroll is only a request: where the browser does not animate
        // (reduced motion, a background tab) it can simply not happen, so the
        // list is put in view outright if it still is not.
        window.setTimeout(() => {
          const pop = document.querySelector('.pad-tokpop');
          const r = pop?.getBoundingClientRect();
          if (pop && r && (r.bottom > window.innerHeight || r.top < 0)) pop.scrollIntoView({ block: 'nearest' });
        }, 450);
      }
      return;
    case 'tok-close': v.tokManage = null; render(); return;
    case 'tok': {
      // A TAP AGES THE TOKEN, one step down the End Phase's ladder; a hold
      // opens its rule (the pointer handlers below set tokManage and swallow
      // the click that follows the hold).
      if (heldTok) { heldTok = false; return; }
      if (!t) return;
      const id = el.dataset.tok!;
      const def = STATUS_BY_ID.get(id);
      const red = (t.expiring ?? []).includes(id);
      const gone = red || !def?.decay;
      v.tokManage = null;
      if (send({ kind: 'ageStatus', ...sourceFor(t), targetUid: t.uid, statusId: id })) {
        toast(gone ? `${def?.label ?? id} comes off.` : `${def?.label ?? id} turns red.`, true);
      }
      return;
    }
    case 'tok-add':
      if (!t) return;
      v.tokPick = false;
      send({ kind: 'applyStatus', ...sourceFor(t), targetUid: t.uid, statusId: el.dataset.tok! });
      return;
    case 'tok-drop':
      if (!t) return;
      v.tokManage = null;
      send({ kind: 'removeStatus', ...sourceFor(t), targetUid: t.uid, statusId: el.dataset.tok! });
      return;
    case 'add-squad':
      if (solo) squadSide = (el.dataset.side as Side) ?? squadSide;
      panel = 'more';
      render();
      return;

    // ----- tasks -----
    case 'vp': {
      const by = Number(el.dataset.by);
      const who = el.dataset.side as Side;
      send({ kind: 'award', seat: mySeat(), vp: { s1: who === 's1' ? by : 0, s2: who === 's2' ? by : 0 }, keys: [] });
      return;
    }
    case 'pick-main': picking = 'main'; render(); return;
    case 'draw-tasks': drawThree(); return;
    case 'draw-cancel': {
      // Out of a draw that cannot finish (or is simply not wanted).
      const { draw: _d, drawDiscards: _dd, ...rest } = normaliseTasks(table.tasks);
      send({ kind: 'configureTable', seat: mySeat(), tasks: rest });
      return;
    }
    case 'discard-task': {
      const cur = normaliseTasks(table.tasks);
      const draw = cur.draw ?? [];
      const disc = { ...(cur.drawDiscards ?? {}) };
      // In a room each squad discards its own; solo the first discard is
      // yours and the second is theirs.
      const who: Side = solo ? (disc.s1 ? 's2' : 's1') : mySeat();
      disc[who] = el.dataset.id!;
      const left = draw.filter((id) => id !== disc.s1 && id !== disc.s2);
      if (disc.s1 && disc.s2 && left.length === 1) {
        const { draw: _d, drawDiscards: _dd, ...rest } = cur;
        send({ kind: 'configureTable', seat: mySeat(), mission: left[0], tasks: rest });
      } else {
        send({ kind: 'configureTable', seat: mySeat(), tasks: { ...cur, drawDiscards: disc } });
      }
      return;
    }
    case 'set-layout': send({ kind: 'configureTable', seat: mySeat(), map: el.dataset.id ?? '' }); return;
    case 'designate': void askOwed(el.dataset.side as Side); return;
    case 'unlock': send({ kind: 'configureTable', seat: mySeat(), unlocked: el.dataset.on === '1' }); return;
    case 'leave-guided':
      void confirmDialog({
        title: 'Switch to Freeform?',
        body: 'The turn strip and its rules go. The units, damage, Tokens, Tasks, score and round stay as they are. This cannot be switched back.',
        confirmLabel: 'Switch to Freeform',
      }).then((go) => { if (go && send({ kind: 'leaveGuided', seat: mySeat() })) { panel = null; render(); } });
      return;
    case 'designate-leader': {
      const i = data ? taskDesignations(data, table).findIndex((d) => d.what === 'leader' && d.side === el.dataset.side) : -1;
      if (i >= 0) void askDesignation(guide, i);
      return;
    }
    case 'zone-held': send({ kind: 'claimZone', seat: mySeat(), side: el.dataset.side as Side, held: el.dataset.held === '1' }); return;
    case 'view-unit': {
      // To the unit's own sheet, on whichever side it stands.
      const u = unitOf(Number(el.dataset.uid));
      if (!u) return;
      picks[u.side] = u.uid;
      side = u.side;
      panel = null;
      picking = null;
      render();
      return;
    }
    case 'pick-sec': pickFromGuide = false; picking = 'secondary'; pickFor = mySeat(); render(); return;
    case 'pick-sec-them': pickFromGuide = false; picking = 'secondary'; pickFor = otherSeat(); render(); return;
    case 'pick-cancel': picking = null; render(); return;
    case 'pick-env': error = null; picking = 'environment'; render(); return;
    case 'env-lift': {
      const [col, row] = el.dataset.at!.split(',').map(Number);
      send({ kind: 'setEnvironment', seat: mySeat(), at: { col, row }, card: null });
      return;
    }
    case 'pick-task': {
      const id = el.dataset.id!;
      picking = null;
      if (el.dataset.kind === 'mission') {
        if (!send({ kind: 'configureTable', seat: mySeat(), mission: id })) return;
        if (pickFromGuide) { pickFromGuide = false; panel = null; render(); }
        // VIP: Assassination needs each squad's Commander named; asked at once,
        // like a Secondary's target, for whichever this phone may answer.
        void (async () => {
          const mine = () => (data ? taskDesignations(data, table) : []).map((d, i) => ({ d, i }))
            .filter(({ d }) => d.what === 'leader' && (solo || d.by === mySeat()));
          let left = mine();
          while (left.length) {
            await askDesignation(guide, left[0].i);
            const now = mine();
            if (now.length >= left.length) break;
            left = now;
          }
        })();
        return;
      }
      if (el.dataset.kind === 'environment') {
        // The Grid it covers, as the table reads it: a letter and a number.
        void promptDialog({
          title: data!.environments.cards.find((c) => c.id === id)?.name ?? 'Environment Card',
          body: 'Which Grid does it cover?',
          placeholder: 'C7',
          confirmLabel: 'Place',
        }).then((ref) => {
          if (ref === null) { render(); return; }
          const at = parseGridRef(ref);
          if (!at) { error = 'That is not a Grid. Type a letter and a number, such as C7.'; render(); return; }
          send({ kind: 'setEnvironment', seat: mySeat(), at, card: id });
        });
        return;
      }
      if (!send({ kind: 'pickSecondary', seat: pickFor, cardId: id })) return;
      // Picked from the turn strip: back to the game, and whatever the Task
      // needs named (a Bounty's Mech, a Leader, a Zone) is asked at once rather
      // than left behind a second Choose button.
      if (pickFromGuide) {
        pickFromGuide = false;
        panel = null;
        render();
      }
      // Freeform too: a Task that names a Mech or a Zone had nowhere to name
      // it outside a Guided game, so Behead could be chosen and never aimed.
      void askOwed(pickFor);
      return;
    }

    // ----- more -----
    case 'squad-side': squadSide = el.dataset.side as Side; render(); return;
    case 'file': {
      // Built on demand rather than living in the template: the panel is
      // repainted on relay changes, which would orphan a picker mid-selection.
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.png,application/json,image/png';
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (f) void importFromFile(f);
      });
      input.click();
      return;
    }
    case 'build': error = null; build = {}; editing = null; buildName = ''; panel = 'build'; render(); return;
    case 'build-rename':
      void promptDialog({
        title: 'Name',
        ...(editing ? {} : { body: 'The name the Mech takes when it is added.' }),
        value: buildName.trim() || (build.torso && data ? cardName(data.byId.get(build.torso)!) : ''),
        placeholder: 'Name',
        confirmLabel: 'Set',
      }).then((name) => {
        if (name === null) return;
        buildName = name;
        // Editing a saved unit: the new name is saved on the spot, with the
        // Parts AS SAVED (not the ones on screen). A rename alone was easy to
        // make and then walk away from without pressing Overwrite.
        const trimmed = name.trim();
        if (editing && trimmed && trimmed.toLowerCase() !== editing.name.toLowerCase()) {
          saveMechPreset(trimmed, editing.was, Date.now());
          deleteMechPreset(editing.id);
          const renamed = loadMechPresets().find((m: MechPreset) => m.name.toLowerCase() === trimmed.toLowerCase());
          editing = { id: renamed?.id ?? editing.id, name: trimmed, was: { ...editing.was } };
          toast(`Renamed to ${trimmed}.`);
        }
        render();
      });
      return;
    case 'build-overwrite': {
      if (!editing || !buildChanged() || !build.torso) return;
      // The saved unit takes the new Parts under its own name; a DEFAULT one
      // is shadowed by a saved copy of the same name, which is how the store
      // reworks a shipped build.
      // The name was settled by Rename; Overwrite carries the Parts and pilot.
      saveMechPreset(editing.name, build, Date.now());
      toast(`${editing.name} saved.`);
      editing = null;
      build = {};
      buildName = '';
      panel = 'more';
      render();
      return;
    }
    case 'build-import': {
      // Built on demand, like the squad file's: the panel repaints on relay
      // changes, which would orphan an input living in the template.
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.png,application/json,image/png';
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (f) void importBuild(f);
      });
      input.click();
      return;
    }
    case 'inventory':
      error = null; invSearch = '';
      if (screen === 'lobby') screen = 'collection'; else panel = 'inventory';
      render();
      return;
    case 'inv-back':
      error = null;
      if (screen === 'collection') screen = 'lobby'; else panel = 'more';
      render();
      return;
    case 'inv-clear':
      void confirmDialog({
        title: 'Clear the collection?',
        body: 'Every box count and built piece is removed, here and on your account.',
        confirmLabel: 'Clear it',
        cancelLabel: 'Keep it',
      }).then((go) => {
        if (!go) return;
        const empty: Collection = { boxes: {}, cards: {}, updatedAt: 0 };
        saveCollection(empty);
        reshare(empty);
        render();
      });
      return;
    case 'inv-toggle': {
      // Three states, in order: nothing, the collection, the collection's
      // built pieces only. Switching the collection off drops the third too,
      // so the next switch-on is the plain collection - the remembered
      // "built only" used to come back with it.
      const next = !collectionOn();
      setCollectionOn(next);
      if (!next && builtOnlyOn()) setBuiltOnly(false);
      reshare(loadCollection());
      render();
      return;
    }
    case 'inv-built-only': {
      const next = !(collectionOn() && builtOnlyOn());
      setBuiltOnly(next);
      if (next && !collectionOn()) setCollectionOn(true);
      // A shelf already open to the table follows the switch.
      reshare(loadCollection());
      render();
      return;
    }
    case 'inv-share': {
      const shared = !!table.inventory?.[mySeat()];
      const col = loadCollection();
      send(shared
        ? { kind: 'setInventory', seat: mySeat(), shared: false }
        : { kind: 'setInventory', seat: mySeat(), shared: true, boxes: col.boxes, cards: col.cards, builtOnly: !!col.builtOnly });
      return;
    }
    case 'inv-box': {
      const col = loadCollection();
      const key = el.dataset.key!;
      const n = Math.max(0, Math.min(9, (col.boxes[key] ?? 0) + Number(el.dataset.d)));
      if (n) col.boxes[key] = n; else delete col.boxes[key];
      saveCollection(col);
      reshare(col);
      render();
      return;
    }
    case 'inv-box-all': {
      // Every card the box ships, as built pieces, times the boxes owned: the
      // starting point for a player who built the lot, trimmed from there.
      if (!data) return;
      const col = loadCollection();
      const key = el.dataset.key!;
      const boxes = Math.max(1, col.boxes[key] ?? 0);
      let added = 0;
      for (const c of data.cards) {
        if (isDiscardCard(c)) continue;
        const entry = (c.containedIn ?? []).find((e) => e.box === key);
        if (!entry) continue;
        const n = Math.max(1, entry.quantityPerBox) * boxes;
        if ((col.cards[c.id] ?? 0) >= n) continue;
        col.cards[c.id] = Math.min(99, n);
        added++;
      }
      saveCollection(col);
      reshare(col);
      toast(added ? `${added} card${added === 1 ? '' : 's'} added as built.` : 'Already all there.');
      render();
      return;
    }
    case 'inv-card': {
      const col = loadCollection();
      const id = el.dataset.id!;
      const n = Math.max(0, Math.min(99, (col.cards[id] ?? 0) + Number(el.dataset.d)));
      if (n) col.cards[id] = n; else delete col.cards[id];
      saveCollection(col);
      reshare(col);
      // Added from the search: the search stays, so several can be added in a
      // row, and the field keeps the caret through the redraw.
      const fromSearch = !!el.closest('#pad-inv-found');
      render();
      if (fromSearch) {
        const q = document.getElementById('pad-inv-q') as HTMLInputElement | null;
        if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }
      return;
    }
    case 'drone': error = null; openDronePicker('drone'); return;
    case 'projectile': error = null; openDronePicker('projectile'); return;
    case 'tactic-add': error = null; openTacticPicker(el.dataset.side as Side); return;
    case 'record':
      void recordMatch().then((why) => { toast(why ?? 'Recorded to Stats.'); render(); });
      return;
    case 'tactic-drop': {
      const side = el.dataset.side as Side;
      send({ kind: 'setTactics', seat: side, cards: handOf(side).filter((id) => id !== el.dataset.id) });
      return;
    }
    case 'tactic-play': void playTactic(el.dataset.side as Side, el.dataset.id!); return;
    case 'detonate': if (t) void detonate(t, el.dataset.id!); return;
    case 'launch': {
      if (!t) return;
      // Not data-card: that attribute is the sheet's card-look hook.
      void launchFrom(t, el.dataset.id!, el.dataset.projectile!);
      return;
    }
    case 'build-back': editing = null; buildName = ''; error = null; panel = 'more'; render(); return;
    case 'build-slot': {
      const s = BUILD_SLOTS.find((x) => x.key === el.dataset.slot);
      if (s) openBuildSlot(s);
      return;
    }
    case 'build-add': {
      if (!data) return;
      const torso = build.torso ? data.byId.get(build.torso) : undefined;
      const label = buildName.trim();
      if (sendSquad(label || (torso ? cardName(torso) : 'Mech'), [{ ...(label ? { name: label } : {}), loadout: build }], [])) {
        build = {};
        buildName = '';
        editing = null;
        error = null;
        panel = null;
        toast('Mech added.');
      }
      render();
      return;
    }
    case 'preset': {
      if (heldSaved) { heldSaved = false; return; }
      const preset = loadMechPresets().find((m: MechPreset) => m.id === el.dataset.id);
      if (!preset) return;
      if (sendSquad(preset.name, [{ name: preset.name, loadout: preset.mech }], [])) {
        error = null;
        panel = null;
        toast(`${preset.name} added.`);
      }
      render();
      return;
    }
    case 'squad': {
      const sq = loadSquads().find((s) => s.id === el.dataset.id);
      if (!sq || !data) return;
      if (sendSquad(sq.name, sq.mechs, sq.drones)) {
        // The hand comes with the squad (5.4), merged the way a file import is.
        if (sq.tactics?.length) {
          const seat = solo ? squadSide : mySeat();
          const merged = [...new Set([...(table.tactics?.[seat] ?? []), ...sq.tactics.filter((id) => data!.byId.get(id))])];
          send({ kind: 'setTactics', seat, cards: merged });
        }
        error = null;
        panel = null;
        toast(`${sq.name} added.`);
      }
      render();
      return;
    }
    case 'preset-del':
    case 'squad-del': {
      const id = el.dataset.id!;
      const isSquad = a === 'squad-del';
      const name = isSquad ? loadSquads().find((s) => s.id === id)?.name : loadMechPresets().find((m) => m.id === id)?.name;
      if (!name) return;
      const builtIn = isSquad ? isBuiltInSquad(id) : isBuiltInPreset(id);
      void confirmDialog({
        title: `Remove "${name}"?`,
        body: builtIn
          ? 'The built-in starter is put away, here and on your account. A link under the lists brings the starters back.'
          : isSquad ? 'The saved squad is removed from this device and your account.' : 'The saved build is removed from this device and your account.',
        confirmLabel: 'Remove',
        cancelLabel: 'Keep',
      }).then((go) => {
        if (!go) return;
        if (isSquad) deleteSquad(id); else deleteMechPreset(id);
        render();
      });
      return;
    }
    case 'restore-builtins': restoreBuiltIns(); render(); return;
    case 'save-squad': {
      if (!data) return;
      const seat = solo ? squadSide : mySeat();
      const units = table.tokens.filter((x) => x.side === seat && x.kind !== 'projectile' && x.parentUid === undefined);
      const mechs = units.filter((x) => x.kind === 'mech' && (x.mech?.torso || x.mech?.chasis)).map((x) => ({ name: x.label, loadout: { ...x.mech } }));
      const drones = units.filter((x) => x.kind === 'drone').map((x) => ({ cardId: x.cardId, backpack: x.droneBackpack }));
      if (!mechs.length && !drones.length) { error = 'Nothing on this side to save yet.'; render(); return; }
      // The hand is part of the squad (5.4): saved with it, or it reloads cheaper.
      const tactics = (table.tactics?.[seat] ?? []).filter((id) => !!data!.byId.get(id));
      void promptDialog({
        title: 'Save this squad',
        body: `${mechs.length} mech${mechs.length === 1 ? '' : 's'}, ${drones.length} drone${drones.length === 1 ? '' : 's'}${tactics.length ? ` and ${tactics.length} Tactics Card${tactics.length === 1 ? '' : 's'}` : ''}. Reusing a name overwrites it.`,
        value: /^Player [12]$/.test(sideName(seat)) ? '' : sideName(seat),
        placeholder: 'Squad name',
        confirmLabel: 'Save',
      }).then((name) => {
        if (!name) return;
        saveSquad(name, mechs, drones, Date.now(), tactics);
        toast(`Squad "${name.trim()}" saved.`);
        render();
      });
      return;
    }
    case 'save-build': {
      if (!t || t.kind !== 'mech') return;
      void promptDialog({
        title: 'Save this build',
        body: 'The Mech\'s Parts and Pilot, as a saved unit. Reusing a name overwrites it.',
        value: t.label,
        placeholder: 'Build name',
        confirmLabel: 'Save',
      }).then((name) => {
        if (!name) return;
        saveMechPreset(name, t.mech ?? {}, Date.now());
        toast(`Build "${name.trim()}" saved.`);
        render();
      });
      return;
    }
    case 'undo': undo(); return;
    case 'toast-x':
      toasts = toasts.filter((x) => String(x.id) !== el.dataset.id);
      paint('pad-toasts', toastsHtml());
      return;

    // ----- find -----
    case 'find-scope':
      find.scope = el.dataset.scope as FindScope;
      if (panel !== 'find') {
        panel = 'find';
        render();
      } else paintFind();
      return;

    // ----- the detail sheet -----
    case 'look-back': backLook(); return;
    case 'look-close': closeLook(); return;
  }
  if (a.startsWith('g-') && data) guideAct(guide, a, el);
  void ev;
}

function installEvents(): void {
  root.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    // The detail's own tabs, answered before anything else: they are buttons
    // inside a panel full of keyword links, and they navigate nowhere.
    const dtab = target.closest<HTMLElement>('[data-dtab]');
    if (dtab) { ev.preventDefault(); showTab(dtab.dataset.dtab!); return; }
    const kw = target.closest<HTMLElement>('[data-kw]');
    if (kw) { ev.preventDefault(); openLook('keyword', kw.dataset.kw!); return; }
    const kwItem = target.closest<HTMLElement>('[data-kwitem]');
    if (kwItem) { ev.preventDefault(); openLook('keyword', kwItem.dataset.kwitem!); return; }
    const mis = target.closest<HTMLElement>('[data-mission]');
    if (mis && data) {
      ev.preventDefault();
      const m = data.missions.cards.find((x) => x.id === mis.dataset.mission);
      showImage(missionImageUrl(mis.dataset.mission!), m?.name ?? mis.dataset.mission!);
      return;
    }
    const bf = target.closest<HTMLElement>('[data-battlefield]');
    if (bf && data) {
      ev.preventDefault();
      const m = data.terrain.maps.find((x) => x.id === bf.dataset.battlefield);
      showImage(battlefieldCardUrl(bf.dataset.battlefield!), m?.name.en ?? bf.dataset.battlefield!);
      return;
    }
    const sec = target.closest<HTMLElement>('[data-secondary]');
    if (sec && data) {
      ev.preventDefault();
      const s = data.secondary.find((x) => x.id === sec.dataset.secondary);
      showImage(secondaryImageUrl(sec.dataset.secondary!), s?.name ?? sec.dataset.secondary!);
      return;
    }
    // The pad has no Boxes page, so a box link is a dead end here and is left
    // inert rather than opening nothing.
    if (target.closest('[data-box]')) { ev.preventDefault(); return; }
    const card = target.closest<HTMLElement>('[data-card]');
    if (card?.dataset.card) { ev.preventDefault(); openLook('card', card.dataset.card); return; }
    const el = target.closest<HTMLElement>('[data-act]');
    // A Token's box closes on any tap outside it and its strip.
    // Whichever sheet has a Token's box open: a tap outside it closes it.
    if ((sheetView.s1.tokManage || sheetView.s2.tokManage) && !target.closest('.pad-tokinfo, .pad-toks')) { sheetView.s1.tokManage = sheetView.s2.tokManage = null; render(); }
    // The Actions fold remembers its state on this phone.
    if (target.closest('.pad-acts-fold > summary')) {
      const d = target.closest<HTMLDetailsElement>('.pad-acts-fold')!;
      window.setTimeout(() => { sheetView[columnSide(d)].acts = d.open; store(ACTS_KEY, JSON.stringify({ s1: sheetView.s1.acts, s2: sheetView.s2.acts })); }, 0);
    }
    if (target.closest('.pad-fold[data-fold] > summary')) {
      const d = target.closest<HTMLDetailsElement>('.pad-fold[data-fold]')!;
      window.setTimeout(() => { folds = { ...folds, [d.dataset.fold!]: d.open }; store(FOLDS_KEY, JSON.stringify(folds)); }, 0);
    }
    if (el && !(el as HTMLButtonElement).disabled) act(el, ev);
    // Tapping the dark around the detail closes it, as on the reference.
    else if (target.id === 'ref-detail') closeLook();
  });

  root.addEventListener('input', (ev) => {
    const el = ev.target as HTMLInputElement;
    switch (el.id) {
      case 'pad-user': form.user = el.value; return;
      case 'pad-pass': form.pass = el.value; return;
      case 'pad-ruser': form.ruser = el.value; return;
      case 'pad-rpass': form.rpass = el.value; return;
      case 'pad-code': form.code = el.value; return;
      case 'pad-join-code': form.join = el.value; return;
      case 'pad-find-q': find.q = el.value; paintFind(); return;
      case 'pad-inv-q': invSearch = el.value; paint('pad-inv-found', invFoundHtml()); return;
      // Written straight through without a redraw: this is a textarea someone
      // is typing into, and re-rendering would move the caret to the end.
      case 'pad-notes': notes = el.value; store(NOTES_KEY, notes); return;
    }
  });

  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.target as HTMLElement).id === 'pad-join-code') {
      (root.querySelector('[data-act="join"]') as HTMLButtonElement | null)?.click();
    }
  });

  // A HOLD on a worn Token opens its rule. Timed from pointerdown and cancelled
  // by a lift or a move, so a scroll that starts on a Token is still a scroll.
  let holdTimer: number | undefined;
  let holdAt: { x: number; y: number } | null = null;
  root.addEventListener('pointerdown', (ev) => {
    const tok = (ev.target as HTMLElement).closest<HTMLElement>('.pad-tok[data-tok]');
    // A hold on a saved unit opens it in the builder (a tap adds it).
    const saved = (ev.target as HTMLElement).closest<HTMLElement>('.pad-saved-row[data-act="preset"]');
    window.clearTimeout(holdTimer);
    if (saved) {
      holdAt = { x: ev.clientX, y: ev.clientY };
      holdTimer = window.setTimeout(() => {
        heldSaved = true;
        const preset = loadMechPresets().find((m: MechPreset) => m.id === saved.dataset.id);
        if (!preset) return;
        editing = { id: preset.id, name: preset.name, was: { ...preset.mech } };
        build = { ...preset.mech };
        buildName = preset.name;
        error = null;
        panel = 'build';
        render();
      }, 450);
      return;
    }
    if (!tok) return;
    holdAt = { x: ev.clientX, y: ev.clientY };
    holdTimer = window.setTimeout(() => {
      heldTok = true;
      // A second hold on the same Token puts its box away.
      { const w = sheetView[columnSide(tok)]; w.tokManage = w.tokManage === tok.dataset.tok ? null : tok.dataset.tok!; w.tokPick = false; }
      
      render();
    }, 450);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointermove'] as const) {
    root.addEventListener(ev, (e) => {
      if (ev === 'pointermove') {
        const pe = e as PointerEvent;
        if (pe.buttons === 0) return;
        // A finger drifts a few pixels while holding; only a real move cancels.
        if (holdAt && Math.hypot(pe.clientX - holdAt.x, pe.clientY - holdAt.y) < 10) return;
      }
      window.clearTimeout(holdTimer);
    });
  }
  root.addEventListener('contextmenu', (ev) => {
    if ((ev.target as HTMLElement).closest('.pad-tok, .pad-saved-row')) ev.preventDefault();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const box = document.querySelector('.mis-lightbox');
    if (box) { box.remove(); return; }
    if (detail() && !detail()!.hidden) { closeLook(); return; }
    if (panel) { panel = null; render(); }
  });

  // A sideways swipe on the sheet moves along the strip, the way a player
  // flips between record sheets on the table. Mostly-horizontal and long
  // enough that a scroll never counts.
  let touch: { x: number; y: number } | null = null;
  root.addEventListener('touchstart', (ev) => {
    const t = ev.touches[0];
    touch = (ev.target as HTMLElement).closest('#pad-sheet, #pad-strip') && t ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  root.addEventListener('touchend', (ev) => {
    if (!touch) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (panel || (detail() && !detail()!.hidden)) return;
    moveUnit(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// Every network action funnels through here so the busy flag, the error line
// and the redraw are impossible to forget at a call site.
async function run(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  error = null;
  render();
  try {
    await fn();
  } catch (err) {
    const e = err as ApiError;
    error = e.offline
      ? 'Cannot reach the server. Check the signal and try again.'
      : (e.issues?.length ? e.issues.join(' ') : e.message) || 'That did not work.';
  } finally {
    busy = false;
    render();
  }
}

// ---------- boot ----------

void (async () => {
  installEvents();
  // The collection follows the account: pulled when one appears, pushed after
  // every change. The panel and the pickers redraw when it moves.
  bindCollection(api);
  onCollection(() => { if (screen === 'table' || screen === 'collection') render(); });
  // The saved units and squads follow the account the same way.
  bindLibrary(api);
  onLibrary(() => { if (screen === 'table') render(); });
  // refresh() never throws: an unreachable server reads as signed out, which is
  // the right first screen either way. The registration mode rides beside the
  // session check: the register screen needs the answer before it draws.
  const [who, mode] = await Promise.all([api.refresh(), api.registration().catch(() => null)]);
  account = who;
  reg = mode;
  screen = account ? 'lobby' : 'signin';
  render();
  // The "new version" notice, only on the door screens: a sheet mid-game is
  // not the place to be asked to reload, and the check runs again on the way
  // back out of a game.
registerOffline();
  watchForUpdates({ when: () => screen !== 'table' });

  // The card database loads AFTER the first paint, deliberately. Signing in and
  // opening a table need none of it, and a phone on venue signal should not
  // stare at a blank screen waiting for the catalogue.
  try {
    data = await loadData();
    // The shared card renderers keep their own reference to it. No boxRow is
    // lent: the pad has no Boxes tab to open.
    useCardData(data);
  } catch {
    dataError = 'The card database could not be loaded. Check the signal and reload.';
  }
  render();
})();

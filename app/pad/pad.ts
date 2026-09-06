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
import { EmberApi, ApiError, type Account, type RegistrationInfo } from '../src/api';
import { Relay, type NetView } from '../src/net';
import { applyRemote, check, onBeforeApply, onPerformed, onRefused, perform, type Command } from '../src/commands';
import { clearHistory, historyDepth, historyEntries, undoLast, recordSnapshot } from '../src/history';
import { labelFor, namesFrom, type LedgerNames } from '../src/ledger';
import { setLocalSeat } from '../src/loop';
import { cardName, loadData, mechPartUrl, missionImageUrl, secondaryImageUrl, stancePrintUrl, tokenFace, tokenPrintUrl, traitName, type GameData } from '../src/data';
import { importSquadFile } from '../src/importer';
import { loadMechPresets, type MechPreset } from '../src/presets';
import { actionBlock, cardDetail, cardRow, fillPortraits, keywordCard, keywordDetail, kwLabel, linkKeywords, traitBlock, useCardData } from '../src/refcards';
import { found, matchCard, matchKeyword, matchMechanic, matchMission, matchPhase, matchSecondary, matchStance, matchStatus, matchTiming, nmCard, nmKeyword, nmMechanic, nmMission, nmPlay, nmSecondary, nmStatus, norm } from '../src/refsearch';
import { mountCardImage, mountCardImageCopy } from '../src/images';
import { squadColour } from '../src/icons';
import { groupByFaction, openPartPicker } from '../src/partpicker';
import { confirmDialog } from '../src/dialog';
import { normaliseTasks } from '../src/tasks';
import { chargeableSlots, maxLink, migrateState, pilotCard, structureOf, tokenCards } from '../src/units';
import { PHASES, statusesFor, statusStacks, STATUSES } from '../src/types';
import type { Card, GameState, ImportedSquad, MechLoadout, PartSlot, PartState, Side, Stance, Token } from '../src/types';

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
  sheetUid = null;
  openSlot = null;
  side = null;
  panel = null;
  looks = [];
  // The ledger belongs to the table that made it. Undoing into a game that is
  // no longer on the screen would restore a board nobody is playing.
  clearHistory();
}
let data: GameData | null = null;
let dataError: string | null = null;

const relay = new Relay(api.base, {
  onRolled: () => {},
  // The other phone's commands land on the shared table. applyRemote is the
  // same door the board uses, so a squad imported over there appears here -
  // and an edit to one of OUR units, or to the score, is announced, because
  // the player holding this phone may be looking at a different sheet.
  onCommand: (cmd) => {
    if (!data) return;
    applyRemote(data, table, cmd as Command);
    if (!catchingUp) toastRemote(cmd as Command);
    render();
  },
  // A late joiner is handed the whole table. It arrives as `unknown` because
  // net.ts refuses to care what a board is - and it is MIGRATED, exactly as the
  // Match Centre migrates its checkpoints: a raw cast silently drops any field
  // migrateState knows about that the sender's build did not.
  onCheckpoint: (s) => {
    const m = data ? migrateState(s, data) : null;
    if (m) table = m;
    else if (s && typeof s === 'object') table = s as GameState;
    render();
  },
  onCatchUp: (active) => {
    catchingUp = active;
    if (!active) render();
  },
  onClosed: () => {
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

type Screen = 'signin' | 'register' | 'lobby' | 'table';
// The panels that slide over the sheet. Null is the resting state: the sheet.
type Panel = 'tasks' | 'find' | 'more' | 'build' | null;
type FindScope = 'all' | 'table' | 'parts' | 'units' | 'pilots' | 'tactics' | 'keywords' | 'tasks' | 'rules';

let account: Account | null = null;
let view: NetView = relay.state;
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
let sheetUid: number | null = null;
// Which Part row is open on the sheet, showing its Actions. One at a time: the
// sheet is a list, and two open rows push the tokens off the screen.
let openSlot: string | null = null;
let panel: Panel = null;
// Which picker the Tasks panel has open, if any.
let picking: 'main' | 'secondary' | null = null;
// Whose Secondary the picker is choosing. Only ever the other squad's solo,
// where one phone keeps both.
let pickFor: Side = 's1';
// Whether the token picker is open. A flag rather than a <details>: the sheet
// redraws on every relay change, and an open <details> would snap shut.
let tokPick = false;
// The worn token being inspected, if any. Tapping a worn token opens the
// token's own rule text with the Remove a deliberate second tap.
let tokManage: string | null = null;
// The search. `q` lives here and not in the input, so a redraw mid-word keeps
// what was typed; the input is only ever written back from it.
const find: { q: string; scope: FindScope } = { q: '', scope: 'all' };

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
const NOTES_KEY = 'ember.pad.notes';
const RECENT_KEY = 'ember.pad.recent';

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

function saveSolo(): void {
  if (solo) store(SOLO_KEY, JSON.stringify(table));
}

function loadSolo(): GameState | null {
  try {
    const raw = stored(SOLO_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as unknown;
    return s && typeof s === 'object' ? (s as GameState) : null;
  } catch {
    return null;
  }
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
    </div>`;
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
      <button class="pad-btn" data-act="solo">Track solo</button>
      ${loadSolo() ? '<p class="pad-note">A tracked game is saved on this phone.</p>' : ''}
    </div>
    <div class="pad-foot">
      <button class="pad-link" data-act="signout">Sign out</button>
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

function unitOf(uid: number | null): Token | null {
  return table.tokens.find((x) => x.uid === uid) ?? null;
}

// The unit the sheet should show: whatever was chosen on this side, else the
// first of the side.
function shownUnit(): Token | null {
  const s = shownSide();
  const chosen = unitOf(sheetUid);
  if (chosen && chosen.side === s) return chosen;
  return unitsOf(s)[0] ?? null;
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

function sideName(s: Side): string {
  const room = view.room;
  if (room?.seats[s]) return room.seats[s]!;
  return s === mySeat() ? 'Yours' : 'Theirs';
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
  // No relay.publish here: onPerformed above sends it, and only once it has
  // actually applied.
  const verdict = perform(data, table, cmd);
  if (!verdict.ok) {
    error = verdict.why ?? 'That squad could not join.';
    render();
    return false;
  }
  saveSolo();
  // The squad that just joined is the one to look at.
  side = seat;
  sheetUid = null;
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
  saveSolo();
  render();
  return true;
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
  return `<div class="pad-bar-l" data-act="dock" data-dock="more" role="button">${who}</div>
    <button class="pad-bar-round" data-act="phase" title="Next phase">
      <b>R${r.n}</b><small>${esc(PHASES[r.phase] ?? '')}</small>
    </button>
    <button class="pad-bar-vp" data-act="dock" data-dock="tasks" title="Tasks and score">
      <b style="color:${sideColour(me)}">${vp[me]}</b><span>:</span><b style="color:${sideColour(them)}">${vp[them]}</b>
    </button>`;
}

// ---------- the unit strip ----------

function stripHtml(): string {
  const s = shownSide();
  const units = unitsOf(s);
  const t = shownUnit();
  const colour = sideColour(s);
  if (!units.length) {
    return `<span class="pad-strip-empty">${s === mySeat() ? 'No units yet' : `${esc(sideName(s))} has no units yet`}</span>`;
  }
  return units.map((u) => {
    const core = u.partStates[u.kind === 'mech' ? 'torso' : 'main'] ?? 'intact';
    return `<button class="pad-tab${u.uid === t?.uid ? ' on' : ''}${core === 'destroyed' ? ' dead' : ''}" style="--side:${colour}"
      data-act="unit" data-uid="${u.uid}"><span class="pad-tab-dot"></span>${esc(u.label)}</button>`;
  }).join('');
}

// ---------- the sheet ----------

function sheetHtml(): string {
  if (!data) {
    return `<div class="pad-sheet-in"><p class="pad-status">${dataError ? esc(dataError) : 'Loading the card database…'}</p></div>`;
  }
  const t = shownUnit();
  const s = shownSide();
  const top = `${errHtml()}`;
  if (!t) {
    const mineSide = solo || s === mySeat();
    return `<div class="pad-sheet-in">${top}
      <div class="pad-empty">
        <p class="pad-lead">${mineSide ? 'Nothing on this side of the table yet.' : `Waiting for ${esc(sideName(s))} to add a squad.`}</p>
        ${mineSide ? `<button class="pad-btn primary" data-act="add-squad" data-side="${s}">Add a squad</button>` : ''}
      </div>
    </div>`;
  }
  const mine = canCommand(t);
  const yours = t.side === mySeat();
  const link = t.link ?? 0;
  const isMech = t.kind === 'mech';
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

    <p class="pad-label pad-sec">Parts</p>
    ${partRows(t)}

    ${mine && ammoRows(t) ? `<p class="pad-label pad-sec">Ammo</p>${ammoRows(t)}` : ''}
    ${mine && chargeRow(t) ? `<p class="pad-label pad-sec">Charge</p>${chargeRow(t)}` : ''}

    <p class="pad-label pad-sec">Tokens</p>
    ${tokenRow(t)}
  </div>`;
}

// The unit's name over its core Part's art, tinted by the Part's faction the
// way the reference tints a tile, with the pilot's portrait beside it.
function unitHead(t: Token, yours: boolean): string {
  const cards = tokenCards(data!, t);
  const core = cards.find((c) => c.slot === 'torso' || c.slot === 'main')?.card;
  const fac = core ? data!.factionOf(core) : null;
  const pilot = t.kind === 'mech' ? pilotCard(data!, t) : undefined;
  const line = [yours ? 'Yours' : 'Theirs', KIND_LABEL[t.kind], t.kind === 'mech' ? STANCE_LABEL[t.stance] ?? t.stance : ''].filter(Boolean).join(' · ');
  return `<div class="pad-uhead card-framed"${fac ? ` data-fac="${esc(fac)}"` : ''}>
    ${core ? `<span class="ref-art"><img src="${esc(mechPartUrl(core.id))}" alt="" /></span>` : ''}
    <div class="pad-uhead-t">
      <h1 class="pad-h">${esc(t.label)}</h1>
      <p class="pad-lead">${esc(line)}</p>
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
  const open = openSlot === slot;
  const stats: string[] = [];
  if (card.armor) stats.push(`A${card.armor}`);
  if (card.structure) stats.push(`S${card.structure}`);
  if (card.move) stats.push(`M${card.move}`);
  return `<div class="pad-prow${open ? ' open' : ''}">
    <div class="pad-part-row">
      <button class="pad-part card-framed pt-${st}"${fac ? ` data-fac="${esc(fac)}"` : ''} data-act="open" data-slot="${slot}" aria-expanded="${open}">
        <span class="ref-art"><img src="${esc(mechPartUrl(card.id))}" alt="" loading="lazy" /></span>
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
  return `${st === 'destroyed' ? '<p class="ref-note pad-dead-note">Destroyed: its Actions cannot be used (4.4.4).</p>' : ''}
    ${acts || '<p class="ref-note">No Actions on this Part.</p>'}
    ${text ? `<div class="ref-cardtext"><p>${linkKeywords(text).replace(/\n/g, '<br>')}</p></div>` : ''}
    ${kws ? `<div class="ref-kwlinks">${kws}</div>` : ''}`;
}

// The pilot, as a row with the portrait the reference's tiles carry. Opens to
// the Pilot Trait, through the reference's own block.
function pilotRow(pilot: Card): string {
  const open = openSlot === 'pilot';
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
    return `<button class="pad-tok${tokManage === def.id ? ' on' : ''}" data-act="tok" data-tok="${esc(def.id)}" title="${esc(def.label)}">
      ${art ? `<img src="${esc(art)}" alt="${esc(def.label)}" />` : `<span class="pad-tok-txt">${esc(def.icon)}</span>`}
      ${n > 1 ? `<span class="pad-tok-n">${n}</span>` : ''}
    </button>`;
  }).join('');
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
        <button class="pad-chip" data-act="tok-drop" data-tok="${esc(managed.id)}">Remove</button>
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
  return item('yours', 'Yours', dot(me))
    + item('theirs', 'Theirs', dot(them))
    + item('tasks', 'Tasks')
    + item('find', 'Find')
    + item('more', 'More');
}

// ---------- the panels ----------

function panelHtml(): string {
  if (!data) return `<div class="pad-panel-in"><p class="pad-status">Loading the card database…</p></div>`;
  if (panel === 'tasks') return tasksPanel();
  if (panel === 'find') return findPanel();
  if (panel === 'build') return buildPanel();
  return morePanel();
}

function panelHead(title: string): string {
  return `<div class="pad-panel-head">
    <h2 class="pad-h">${esc(title)}</h2>
    <button class="dlg-close pad-panel-x" data-act="close-panel" aria-label="Close">✕</button>
  </div>`;
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
  if (picking === 'secondary') {
    return `<div class="pad-panel-in">${panelHead('Secondary Task')}
      <p class="pad-lead">${pickFor === me ? 'Yours.' : `${esc(sideName(pickFor))}.`}</p>
      <div class="pad-tasklist">${data!.secondary.map((c) =>
        taskCard(`data-act="pick-task" data-kind="secondary" data-id="${esc(c.id)}"`, secondaryImageUrl(c.id), c.name, c.scoring ?? '', `${c.vp ?? 0} VP`)).join('')}</div>
      <button class="pad-btn" data-act="pick-cancel">Cancel</button>
    </div>`;
  }

  const slot = (label: string, card: { id: string; name: string } | undefined,
                art: (id: string) => string, imgAttr: string, act: string | null) => `
    <p class="pad-label pad-sec">${label}</p>
    ${card
      ? `<div class="pad-task chosen">
          <img class="pad-task-card" src="${esc(art(card.id))}" alt="${esc(card.name)}" ${imgAttr} />
          <span class="pad-task-row">
            <span class="pad-task-name">${esc(card.name)}</span>
            ${act ? `<button class="pad-chip" data-act="${act}">change</button>` : ''}
          </span>
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

  return `<div class="pad-panel-in">${panelHead('Tasks')}
    ${errHtml()}
    <div class="pad-vp">${vpSide(me, 'Yours')}${vpSide(them, 'Theirs')}</div>
    ${slot('Main Task', mission, missionImageUrl, mission ? `data-mission="${esc(mission.id)}"` : '', 'pick-main')}
    ${slot('Your Secondary', secondaryOf(me), secondaryImageUrl, secondaryOf(me) ? `data-secondary="${esc(secondaryOf(me)!.id)}"` : '', 'pick-sec')}
    ${slot('Their Secondary', secondaryOf(them), secondaryImageUrl, secondaryOf(them) ? `data-secondary="${esc(secondaryOf(them)!.id)}"` : '', solo ? 'pick-sec-them' : null)}
    <p class="pad-label pad-sec">Notes</p>
    <textarea class="pad-input" id="pad-notes" rows="3" placeholder="Your own notes. They stay on this phone."></textarea>
  </div>`;
}

// ---------- more ----------

function morePanel(): string {
  const room = view.room;
  const me = mySeat();
  const presets = loadMechPresets();
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
      <p class="pad-note" style="text-align:center;margin:0 0 10px">Read the code out for the other player to join.</p>
      ${seats}` : '<p class="pad-lead">One phone keeps both squads. Everything here stays on this phone.</p>'}

    <p class="pad-label pad-sec">Round</p>
    <div class="pad-row">
      <span class="pad-num">R${r.n}<span class="pad-of"> · ${esc(PHASES[r.phase] ?? '')}</span></span>
      <div class="pad-chips">
        <button class="pad-chip" data-act="phase-back">Back a phase</button>
        <button class="pad-chip on" data-act="phase">Next phase</button>
      </div>
    </div>
    <button class="pad-link" data-act="rounds-reset">Start the rounds over</button>

    <p class="pad-label pad-sec">Squads</p>
    ${solo ? `<div class="pad-chips" style="margin-bottom:8px">
      <button class="pad-chip${squadSide === 's1' ? ' on' : ''}" data-act="squad-side" data-side="s1">Yours</button>
      <button class="pad-chip${squadSide === 's2' ? ' on' : ''}" data-act="squad-side" data-side="s2">Theirs</button>
    </div>` : ''}
    <button class="pad-btn primary" data-act="file">Squad file…</button>
    <button class="pad-btn" data-act="build">Build a Mech</button>
    ${presets.length ? `<p class="pad-label" style="margin-top:10px">Saved builds</p>${presets.map((m) => `<button class="pad-seat" data-act="preset" data-id="${esc(m.id)}">
        <span class="pad-seat-name">${esc(m.name)}</span>
        <span class="pad-seat-tag">${m.saved ? 'saved' : 'built in'}</span>
      </button>`).join('')}` : ''}

    <p class="pad-label pad-sec">History</p>
    ${hist.length ? `<div class="pad-hist">${hist.map((h) => `<div class="pad-hist-row"><span>${esc(h.human ?? h.kind)}</span><small>R${h.round}</small></div>`).join('')}</div>` : '<p class="pad-note">Nothing recorded yet.</p>'}
    <button class="pad-btn" data-act="undo"${historyDepth() ? '' : ' disabled'}>Undo the last thing</button>

    <p class="pad-label pad-sec">Rules</p>
    <div class="pad-chips">
      <button class="pad-chip" data-act="find-scope" data-scope="rules">Phases, timings, stances, tokens</button>
      <button class="pad-chip" data-act="find-scope" data-scope="keywords">Glossary</button>
    </div>

    <div class="pad-foot">
      ${room ? '<button class="pad-btn" data-act="leave">Leave the table</button>' : '<button class="pad-btn" data-act="solo-end">Finish and clear</button>'}
      <button class="pad-link" data-act="signout">Sign out</button>
      <p class="pad-note">Signed in as ${esc(account?.username ?? '')}${room ? ` · seat ${me === 's1' ? '1' : '2'}` : ''}</p>
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
    actions: [{
      label: `Set ${slot.label}`,
      run: (card) => {
        build = { ...build, [slot.key]: card.id };
        render();
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
          : `<span class="ref-art"><img src="${esc(mechPartUrl(card.id))}" alt="" loading="lazy" /></span>`) : ''}
        <span class="pad-part-slot">${s.label}</span>
        <span class="pad-part-name">${card ? esc(cardName(card)) : 'empty'}</span>
        <span class="pad-part-stats mono">${card?.score ? `${card.score}p` : ''}</span>
      </button>
      ${card ? `<button class="pad-part-info" data-act="card" data-id="${esc(card.id)}" aria-label="Read ${esc(cardName(card))}">i</button>` : ''}
    </div>`;
  }).join('');
  return `<div class="pad-panel-in">${panelHead('Build a Mech')}
    ${errHtml()}
    <div class="pad-row">
      <span class="pad-label">${fac ? esc(fac) : 'any faction'}${solo ? ` · for ${squadSide === 's1' ? 'yours' : 'theirs'}` : ''}</span>
      <span class="pad-num">${pts}<span class="pad-of">p</span></span>
    </div>
    ${rows}
    <div class="pad-foot">
      <button class="pad-btn primary" data-act="build-add"${build.torso ? '' : ' disabled'}>Add to squad</button>
      <button class="pad-btn" data-act="build-back">Back</button>
    </div>
  </div>`;
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
    if (kws.length) groups.push({ id: 'keywords', label: 'Keywords', total: kws.length, tiles: kws.slice(0, cap).map(keywordCard) });
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
    if (pool.length) groups.push({ id, label, total: pool.length, tiles: pool.slice(0, cap).map(cardRow) });
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

function toast(text: string, undo = false): void {
  const id = ++toastSeq;
  toasts = [...toasts.slice(-2), { id, text, undo }];
  paint('pad-toasts', toastsHtml());
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    paint('pad-toasts', toastsHtml());
  }, undo ? 7000 : 4500);
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
  return true;
}

// The strip, the sheet, the panel and the toasts share ONE box between the
// bar and the dock, so a panel covers exactly that box however tall the bar
// and dock come out - on a phone both grow with the notch and the home
// indicator, and a panel sized from fixed heights sat over the dock.
const SKELETON = `<header class="pad-bar" id="pad-bar"></header>
  <div class="pad-mid" id="pad-mid">
    <div class="pad-strip" id="pad-strip"></div>
    <main class="pad-sheet" id="pad-sheet"></main>
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
  // The relay is the authority on where we are once signed in: a reconnect
  // that lands us back in a room must not leave the lobby showing.
  const atTable = !!view.room || solo;
  if (account && atTable) screen = 'table';
  else if (account && screen === 'table') screen = 'lobby';

  if (screen !== 'table') {
    root.className = '';
    painted.clear();
    looks = [];
    root.innerHTML = screen === 'signin' ? signinHtml() : screen === 'register' ? registerHtml() : lobbyHtml();
    return;
  }

  if (root.className !== 'table' || !document.getElementById('pad-bar')) {
    root.className = 'table';
    root.innerHTML = SKELETON;
    painted.clear();
    looks = [];
  }
  paint('pad-bar', barHtml());
  paint('pad-strip', stripHtml());
  if (paint('pad-sheet', sheetHtml())) {
    const sheet = document.getElementById('pad-sheet');
    if (sheet) fillPortraits(sheet, true);
  }
  paint('pad-dock', dockHtml());
  const p = document.getElementById('pad-panel')!;
  p.hidden = !panel;
  if (panel) {
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
  openSlot = null;
  tokPick = false;
  tokManage = null;
  render();
}

function moveUnit(by: number): void {
  const units = unitsOf(shownSide());
  const t = shownUnit();
  if (!t || units.length < 2) return;
  const i = units.findIndex((u) => u.uid === t.uid);
  const next = units[(i + by + units.length) % units.length];
  sheetUid = next.uid;
  openSlot = null;
  tokPick = false;
  tokManage = null;
  render();
}

function act(el: HTMLElement, ev: Event): void {
  const a = el.dataset.act!;
  const t = screen === 'table' ? shownUnit() : null;
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
    case 'host': error = null; resetTable(); relay.host(); render(); return;
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
      // A tracked game picks up where it was left, MIGRATED rather than cast so
      // a game tracked on last month's build reloads with this month's fields.
      const saved = loadSolo();
      if (saved) {
        table = (data ? migrateState(saved, data) : null) ?? saved;
        toast('Picked up where you left off.');
      }
      error = null;
      render();
      return;
    }
    case 'solo-end':
      void (async () => {
        const sure = await confirmDialog({
          title: 'Finish and clear?',
          body: 'The tracked game is cleared from this phone.',
          confirmLabel: 'Clear it',
          danger: true,
        });
        if (!sure) return;
        solo = false;
        store(SOLO_KEY, null);
        resetTable();
        screen = 'lobby';
        render();
      })();
      return;
    case 'leave': relay.leave(); resetTable(); screen = 'lobby'; render(); return;

    // ----- the dock and the bar -----
    case 'dock': {
      const which = el.dataset.dock!;
      if (which === 'yours') selectSide(mySeat());
      else if (which === 'theirs') selectSide(otherSeat());
      else openPanel(which as Panel);
      return;
    }
    case 'close-panel': panel = null; picking = null; error = null; render(); return;
    case 'phase':
      if (send({ kind: 'advancePhase', seat: mySeat() })) toast(`${PHASES[table.round.phase]} Phase, round ${table.round.n}.`);
      return;
    case 'phase-back': {
      const r = table.round;
      if (r.phase > 0) send({ kind: 'setPhase', seat: mySeat(), phase: r.phase - 1 });
      else toast('The round starts here. Use the rounds reset to go back further.');
      return;
    }
    case 'rounds-reset':
      void (async () => {
        const sure = await confirmDialog({ title: 'Start the rounds over?', body: 'Round 1, Command Phase. Units and scores stay as they are.', confirmLabel: 'Start over' });
        if (sure) send({ kind: 'resetRounds', seat: mySeat() });
      })();
      return;

    // ----- the strip and the sheet -----
    case 'unit':
      sheetUid = Number(el.dataset.uid);
      error = null;
      openSlot = null;
      tokPick = false;
      tokManage = null;
      render();
      return;
    case 'open':
      openSlot = openSlot === el.dataset.slot ? null : el.dataset.slot!;
      render();
      return;
    case 'card':
      openLook('card', el.dataset.id!);
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
    case 'stabilise': if (t) send({ kind: 'stabilise', seat: t.side, uid: t.uid }); return;
    case 'link-down': if (t) send({ kind: 'drainLink', seat: t.side, uid: t.uid, targetUid: t.uid, n: 1 }); return;
    case 'ammo-down': if (t) send({ kind: 'spendAmmo', seat: t.side, uid: t.uid, actionId: el.dataset.id! }); return;
    case 'ammo-up': if (t) send({ kind: 'restoreAmmo', seat: t.side, uid: t.uid, actionId: el.dataset.id!, amount: 1 }); return;
    case 'charge': if (t) send({ kind: 'setCharge', seat: t.side, uid: t.uid, slot: el.dataset.slot!, on: el.dataset.on === '1' }); return;
    case 'tok-open': tokPick = !tokPick; tokManage = null; render(); return;
    case 'tok': tokManage = tokManage === el.dataset.tok ? null : el.dataset.tok!; tokPick = false; render(); return;
    case 'tok-add':
      if (!t) return;
      tokPick = false;
      send({ kind: 'applyStatus', ...sourceFor(t), targetUid: t.uid, statusId: el.dataset.tok! });
      return;
    case 'tok-drop':
      if (!t) return;
      tokManage = null;
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
    case 'pick-sec': picking = 'secondary'; pickFor = mySeat(); render(); return;
    case 'pick-sec-them': picking = 'secondary'; pickFor = otherSeat(); render(); return;
    case 'pick-cancel': picking = null; render(); return;
    case 'pick-task': {
      const id = el.dataset.id!;
      picking = null;
      if (el.dataset.kind === 'mission') send({ kind: 'configureTable', seat: mySeat(), mission: id });
      else send({ kind: 'pickSecondary', seat: pickFor, cardId: id });
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
    case 'build': error = null; build = {}; panel = 'build'; render(); return;
    case 'build-back': error = null; panel = 'more'; render(); return;
    case 'build-slot': {
      const s = BUILD_SLOTS.find((x) => x.key === el.dataset.slot);
      if (s) openBuildSlot(s);
      return;
    }
    case 'build-add': {
      if (!data) return;
      const torso = build.torso ? data.byId.get(build.torso) : undefined;
      if (sendSquad(torso ? cardName(torso) : 'Mech', [{ loadout: build }], [])) {
        build = {};
        error = null;
        panel = null;
        toast('Mech added.');
      }
      render();
      return;
    }
    case 'preset': {
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
  // refresh() never throws: an unreachable server reads as signed out, which is
  // the right first screen either way. The registration mode rides beside the
  // session check: the register screen needs the answer before it draws.
  const [who, mode] = await Promise.all([api.refresh(), api.registration().catch(() => null)]);
  account = who;
  reg = mode;
  screen = account ? 'lobby' : 'signin';
  render();

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

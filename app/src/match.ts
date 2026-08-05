import { ApiError, EmberApi, type Account, type MyRecord, type SquadEntry } from './api';
import { Relay, type RollKind } from './net';
import { applyRemote, check, onPerformed, onRefused, perform, type Command, type CheckResult } from './commands';
import { setLocalSeat } from './loop';
import { cardName, dataUrl, loadData, missionImageUrl, squadLabel, type GameData } from './data';
import { tacticSpec } from './tactics';
import { objectiveCells } from './matchhud';
import { printedDeployment } from './overlays';
import { knockbackOf, migrateState, squadAllegiance, tokenCards } from './units';
import { countHits, normaliseSetup } from './setup';
import { gameResult, normaliseTasks, taskItemsFor } from './tasks';
import { loadSquads, saveSquad, type SavedSquad } from './squadstore';
import { loadMechPresets } from './presets';
import { installTooltip, preloadCards } from './tooltip';
import { importSquadFile } from './importer';
import { boardFingerprint, dialsOf, hashDials, newSalt, type DialEntry } from './secrecy';
import { animateRemoteMove, ensureHud, glueAfter, showRangeOverlay, showSideTab, startAttackPick, startBoxDrop, startDetonation, startElectronicPick, startInterceptPick, startLaunchPlan, startShove, type DiceLine, type HudCtx } from './matchhud';
import { AttackHelper } from './combat';
import { losNote, protectionFor } from './rules';
import { SquadTracker } from './squads';
import { Panel } from './panel';
import { iconSvg } from './dice';
import type { DiceData, DieColor, GameState, Side } from './types';
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
let dialSecret: { round: number; salt: string; dials: DialEntry[] } | null = null;
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
      resyncSoon();
      if (!catchingUp) render();
      return;
    }
    glueAfter(data, state, cmd);
    clearFeedAfter(cmd);
    // Nothing below this line belongs in a replay: the commitments and reveals
    // are being re-read from history, and answering them again would send this
    // client's reveal a second time.
    if (catchingUp) return;
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
    if (!catchingUp) render();
  },
  onCatchUp(active) {
    catchingUp = active;
    if (active) return;
    // The board is whole again: draw it, and answer anything the replay
    // walked past — a commitment made while we were away may be waiting on
    // this client's reveal.
    maybeReveal();
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
    pushRoll(seat, label, dice, kind);
    render();
  },
  onClosed() {
    // The table is gone for everyone, so the remembered code is worthless.
    localStorage.removeItem('ember-last-room');
    state = freshBoard();
    closeOnArrival = false;
    doorErr = 'That table has been closed.';
    render();
  },
  onChange(view) {
    setLocalSeat(view.room ? view.seat : null);
    // Remembered for the Rejoin door: a dropped connection should not need
    // the code typed back in.
    if (view.room) localStorage.setItem('ember-last-room', view.room.id);
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

function clearFeedAfter(cmd: Command): void {
  if (CLEARS_THE_FEED.has(cmd.kind)) diceFeed.length = 0;
}

// One door for everything this page performs: the command, then the same
// deterministic guide glue every client runs, ours or theirs.
function send(cmd: Command): CheckResult {
  if (!data) return { ok: false, why: 'Still loading.' };
  const p = paused();
  if (p) return { ok: false, why: `Paused — waiting for ${squadLabel(p.side)}'s player.` };
  const v = perform(data, state, cmd);
  if (v.ok) {
    glueAfter(data, state, cmd);
    clearFeedAfter(cmd);
  }
  return v;
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

function startAttack(uid: number, actionId: string, targetUid: number, mode: 'attack' | 'intercept' | 'explosion' = 'attack'): void {
  if (!data || !attackHelper) return;
  const attacker = state.tokens.find((t) => t.uid === uid);
  const defender = state.tokens.find((t) => t.uid === targetUid);
  const action = tokenCards(data, attacker ?? ({} as never))
    .flatMap(({ card }) => card.actions ?? [])
    .find((a) => a.id === actionId) ?? data.commonActions.find((a) => a.id === actionId);
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
  attackHelper.start(attacker, action, defender, note, prot.white, prot.note, mode === 'explosion');
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
        if (attacker.kind === 'projectile') send({ kind: 'despawn', seat: attacker.side, uid: attacker.uid, targetUid: attacker.uid });
        else if (kb && !(kb.onHit && hits === 0)) startShove(attacker.uid, action.id, defender.uid);
        render();
      },
      (killer, victim, what) => {
        send({ kind: 'recordKill', seat: killer.side, uid: killer.uid, targetUid: victim.uid, what });
        render();
      },
      // A Penetrated bearer drops its Black Box, and the ATTACKER says where
      // (5.3.1) — so the question opens on this seat, not the victim's.
      (victim, attacker) => {
        const box = normaliseTasks(state.tasks).items
          .find((i) => i.kind === 'blackbox' && i.bearerUid === victim.uid);
        if (box) startBoxDrop(box.id, victim.uid, attacker.side, attacker.uid);
        render();
      },
      (cmd) => { send(cmd); },
    );
  }
  renderCombatIdle();
}

function terrainNow() {
  const gone = new Set(state.removedTerrain ?? []);
  return (data?.terrain.layouts[state.map] ?? []).filter((p) => !gone.has(p.id));
}

function syncSide(uid: number | null): void {
  squadTracker?.update(state, uid);
  const t = uid !== null ? state.tokens.find((x) => x.uid === uid) : undefined;
  if (t) panel?.showToken(t);
  else panel?.clear();
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
  if (sc?.commits[seat]) return;
  const dials = dialsOf(state, seat);
  const salt = newSalt();
  dialSecret = { round: state.round.n, salt, dials };
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

// The six Tactics Cards, held in hand rather than deployed (5.4). Chosen here
// because they are bought with the squad, and they have to travel: check() for
// playTactic reads the sender's hand, and the other client has to have it.
function tacticsPicker(side: Side): string {
  if (!data) return '';
  const held = state.tactics?.[side] ?? [];
  const cards = data.cards
    .filter((c) => c.category === 'tactics_or_upgrade')
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));
  if (!cards.length) return '';
  const rows = cards
    .map((c) => {
      const n = held.filter((x) => x === c.id).length;
      const when = tacticSpec(c.id)?.timing ?? '';
      return `<button class="tacpick${n ? ' on' : ''}" data-tacpick="${esc(c.id)}" title="${esc(when)}">
        <span class="tn">${esc(cardName(c))}</span>
        <span class="tw">${esc(when)}</span>
        <span class="tp">${n ? `×${n}` : `${c.score ?? 0}p`}</span></button>`;
    })
    .join('');
  return `<div class="tacbox">
    <div class="taclabel">Tactics Cards${held.length ? ` — ${held.length} in hand` : ''}</div>
    ${rows}
    <p class="quiet" style="margin:6px 0 0">Tap to add, tap again to take one back. Each costs points against your total, and only 1 may be played per round (5.4.2).</p>
  </div>`;
}

// ---------- pieces ----------

function barHtml(): string {
  const v = relay.state;
  // Who is actually here, not just who holds a seat. Saying "both seated" over
  // a paused board is the bar contradicting the veil in front of it.
  const away = v.room ? (['s1', 's2'] as Side[]).find((s) => v.room!.seats[s] && !v.room!.online[s]) : undefined;
  const conn = v.room
    ? v.status === 'connecting'
      ? '<span class="pill bad">● reconnecting</span>'
      : away
        ? `<span class="pill bad">● ${esc(squadLabel(away))} is away</span>`
        : v.status === 'playing'
          ? '<span class="pill live">● both seated</span>'
          : '<span class="pill">● waiting for the other player</span>'
    : '';
  return `<div class="mc-bar">
    <a class="mc-logo" href="./index.html">EMBER <em>Testing Grounds</em><small>Match Centre</small></a>
    ${v.room ? `<span class="pill code" id="mc-code" title="Copy the room code">${esc(v.room.id)}${copied ? ' ✓' : ''}</span>` : ''}
    ${conn}
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
    ${localStorage.getItem('ember-last-room')
      ? `<div class="panel" style="margin-top:12px"><h3>Rejoin ${esc(localStorage.getItem('ember-last-room')!)}</h3>
          <p class="hint">Seats are kept by account, so dropping out never loses your place.</p>
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
      <div class="who"><span class="sq">${side === 's1' ? 'SQ1' : 'SQ2'}</span><i>empty seat — share the code</i></div>
    </div>`;
  }
  return `<div class="seatcard ${side}">
    <div class="who"><span class="sq">${side === 's1' ? 'SQ1' : 'SQ2'}</span>${esc(who)}${mine ? ' <i>(you)</i>' : ''}${v.host && mine ? ' <i>· host</i>' : ''}</div>
    <div class="st${here ? ' on' : ''}">${here ? '● connected' : '○ away — their seat is kept'}</div>
  </div>`;
}

// The lobby's battlefield preview, drawn in the board's own language: flat
// dark field, thin Large-Grid lines, terrain in the renderer's palette, the
// Main Task's zones in amber, and the printed Deployment Zones with labels —
// visible before any setup exists, because edges are decided later.
function previewSvg(mapId: string): string {
  if (!data) return '';
  const pieces = data.terrain.layouts[mapId] ?? [];
  const fill = (t: string) => (t === 'container' ? 'rgba(61,220,132,.5)' : t === 'low_wall' ? '#4a5563' : '#39424e');
  const cells = pieces
    .flatMap((p) => p.subCells.map((c) => `<rect x="${c.col + 0.08}" y="${c.row + 0.08}" width="0.84" height="0.84" rx="0.1" fill="${fill(p.type)}"/>`))
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
    : away ? `${squadLabel(away)} is away — the match waits for them.`
      : !squadsIn ? 'Both squads have to be brought in.'
        : !guestReady ? 'Waiting for the other player to press Ready.'
          : 'Both squads are in and ready.';
  const mine = mySeat();
  const iAmReady = mine ? !!state.ready?.[mine] : false;
  const foot = running()
    ? `<div class="foot"><b>Match running</b>Round ${state.round.n} · ${PHASES[state.round.phase]} Phase</div>`
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
          <button class="btn wide${iAmReady ? ' ghost' : ''}" id="mc-ready" style="margin-top:0">${iAmReady ? '✓ Ready — tap to undo' : 'Ready'}</button>
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
        <p class="quiet">Custom maps stay on the board page for now — a guest may not have them.</p>
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
          ? `✓ ${named ? `${esc(named)} — ` : ''}${s.mechs} mech${s.mechs === 1 ? '' : 's'}, ${s.drones} drone${s.drones === 1 ? '' : 's'} · ${s.points} points`
          : mine ? 'no squad yet' : 'no squad yet — waiting on them'}</div>
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
    startAttack,
    showTab: (name) => showSideTab(null, name),
    diceData,
    recordMatch,
    refresh: () => render(),
  };
}

// A tiny dev harness behind ?dev=1: seeds two demo squads and starts, so the
// HUD can be walked solo while it is being built.
function devPane(): string {
  return `<div class="mc-col" style="max-width:420px">
    <h1 class="mc-h">HUD dev harness</h1>
    <p class="mc-sub">No room — this walks the in-match HUD locally.</p>
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
      mechs: [{ loadout: { torso: first('torso'), chasis: first('chasis'), rightHand: first('rightHand'), pilot } }],
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
function boardSquads(): { key: Side; label: string; mechs: SavedSquad['mechs']; drones: SavedSquad['drones'] }[] {
  try {
    const raw = localStorage.getItem('ember-testing-grounds-v1');
    if (!raw) return [];
    const board = JSON.parse(raw) as GameState;
    return (['s1', 's2'] as Side[])
      .map((side) => {
        const units = (board.tokens ?? []).filter((t) => t.side === side && t.kind !== 'projectile' && t.parentUid === undefined);
        const mechs = units.filter((t) => t.kind === 'mech' && (t.mech?.torso || t.mech?.chasis)).map((t) => ({ name: t.label, loadout: { ...t.mech } }));
        const drones = units.filter((t) => t.kind === 'drone').map((t) => ({ cardId: t.cardId, backpack: t.droneBackpack }));
        return { key: side, label: `${board.sideNames?.[side] ?? squadLabel(side)} (freeplay board)`, mechs, drones };
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
        <span class="ct">${s.mechs.length}M ${s.drones.length}D</span>
        ${squadContents(s.mechs, s.drones)}
      </button>`,
    )
    .join('');
  const savedSquads = loadSquads()
    .map(
      (s) => `<button class="pickrow" data-squad="${esc(s.id)}">
        <span class="nm">${esc(s.name)}</span>
        <span class="ct">${s.mechs.length}M ${s.drones.length}D</span>
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
      ${any ? '' : '<p class="hint">Nothing saved on this device yet — import a squad from a builder file below, and it will be remembered here.</p>'}
      <button class="btn ghost wide" id="mc-file" style="margin-top:10px">From a squad file…</button>
      <input type="file" id="mc-fileinput" accept=".json,.png" hidden />
    </div>
  </div>`;
}

function bringSquad(name: string, mechs: SavedSquad['mechs'], drones: SavedSquad['drones']): void {
  const seat = mySeat();
  if (!seat || !data) return;
  lobbyNote = null;
  const v = perform(data, state, { kind: 'importSquad', seat, name, mechs, drones });
  if (v.ok) {
    pickerOpen = false;
    relay.publishCheckpoint();
  }
  render();
}

// ---------- render ----------

function render(): void {
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
        <div class="sub">${esc(squadLabel(p.side))}'s player ${p.gone ? 'left the table' : 'lost their connection'}.<br>Everything waits until they return — their seat is kept.</div></div>
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
    const code = localStorage.getItem('ember-last-room');
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
      if (sq) bringSquad(sq.name, sq.mechs, sq.drones);
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-boardsquad]')) {
    el.addEventListener('click', () => {
      const sq = boardSquads().find((s) => s.key === el.dataset.boardsquad);
      if (sq) bringSquad(sq.label.replace(' (freeplay board)', ''), sq.mechs, sq.drones);
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
      relay.publishCheckpoint();
      render();
    });
  }
  // The hand is chosen by tapping: once to take a card, again to put it back.
  // The whole hand travels each time, so a repeat cannot double it.
  for (const el of root.querySelectorAll<HTMLElement>('[data-tacpick]')) {
    el.addEventListener('click', () => {
      const seat = mySeat();
      if (!seat) return;
      const id = el.dataset.tacpick!;
      const held = [...(state.tactics?.[seat] ?? [])];
      const at = held.lastIndexOf(id);
      if (at >= 0) held.splice(at, 1);
      else held.push(id);
      send({ kind: 'setTactics', seat, cards: held });
      relay.publishCheckpoint();
      render();
    });
  }
  $('mc-file')?.addEventListener('click', () => $('mc-fileinput')?.click());
  $('mc-fileinput')?.addEventListener('change', () => {
    const input = $('mc-fileinput') as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !data) return;
    void importSquadFile(file, data.byId)
      .then((squad) => {
        saveSquad(squad.name, squad.mechs, squad.drones, Date.now());
        bringSquad(squad.name, squad.mechs, squad.drones);
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
  render();
})();

import { ApiError, EmberApi, type Account, type MyRecord } from './api';
import { Relay } from './net';
import { applyRemote, onPerformed, onRefused, perform, type Command, type CheckResult } from './commands';
import { setLocalSeat } from './loop';
import { dataUrl, loadData, squadLabel, type GameData } from './data';
import { migrateState, tokenCards } from './units';
import { countHits, normaliseSetup } from './setup';
import { taskItemsFor } from './tasks';
import { loadSquads, saveSquad, type SavedSquad } from './squadstore';
import { importSquadFile } from './importer';
import { dialsOf, hashDials, newSalt, type DialEntry } from './secrecy';
import { glueAfter, hudHtml, wireHud, type DiceLine, type HudCtx } from './matchhud';
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

const relay = new Relay(api.base, {
  onCommand(cmd) {
    if (!data) return;
    const verdict = applyRemote(data, state, cmd);
    if (!verdict.ok) {
      relay.requestResync();
      render();
      return;
    }
    glueAfter(data, state, cmd);
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
    render();
  },
  onNeedCheckpoint() {
    relay.publishCheckpoint();
  },
  onRolled(dice, seat, label, isMine) {
    if (isMine || !diceData) return;
    const hits = dice.reduce((n, d) => n + countHits([diceData!.dice[d.color as DieColor]?.faces[d.face] ?? []]), 0);
    diceFeed.push({ seat, text: `${label ?? 'rolled'} — ${hits} Hit${hits === 1 ? '' : 's'}` });
    render();
  },
  onChange(view) {
    setLocalSeat(view.room ? view.seat : null);
    render();
  },
  snapshot: () => JSON.parse(JSON.stringify(state)) as unknown,
});

// Everything performed on this page mirrors, same as on the board — and a
// strict refusal is worth a note here rather than silence.
onPerformed((cmd) => relay.publish(cmd));
onRefused((why) => {
  lobbyNote = why;
  render();
});

// ---------- the command path ----------

// One door for everything this page performs: the command, then the same
// deterministic guide glue every client runs, ours or theirs.
function send(cmd: Command): CheckResult {
  if (!data) return { ok: false, why: 'Still loading.' };
  const v = perform(data, state, cmd);
  if (v.ok) glueAfter(data, state, cmd);
  return v;
}

// Server dice in a room; honest local dice in dev. Either way the Hits per
// die come from the same printed faces.
async function rollHits(n: number, label: string): Promise<number[]> {
  if (!diceData) return Array.from({ length: n }, () => 0);
  const faces = diceData.dice.yellow;
  let idx: number[];
  if (relay.state.room && relay.state.seat) {
    const dice = await relay.rollDice({ yellow: n }, label);
    idx = dice.map((d) => d.face);
  } else {
    idx = Array.from({ length: n }, () => Math.floor(Math.random() * faces.sides));
  }
  const hits = idx.map((i) => countHits([faces.faces[i] ?? []]));
  const total = hits.reduce((a, b) => a + b, 0);
  diceFeed.push({ seat: relay.state.seat ?? devSeat ?? 's1', text: `${label} — ${total} Hit${total === 1 ? '' : 's'}` });
  return hits;
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
    rolled = await relay.rollDice(pool, label);
  } else {
    rolled = Object.entries(pool).flatMap(([c, n]) =>
      Array.from({ length: n }, () => ({ color: c, face: Math.floor(Math.random() * (diceData!.dice[c as DieColor]?.sides ?? 6)) })),
    );
  }
  const counts: Record<string, number> = {};
  for (const d of rolled) {
    for (const icon of diceData.dice[d.color as DieColor]?.faces[d.face] ?? []) {
      counts[icon.type] = (counts[icon.type] ?? 0) + 1;
    }
  }
  const pretty = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase();
  const text = `${label} — ${Object.entries(counts).map(([k, n]) => `${n}× ${pretty(k)}`).join(', ') || 'all blank'}`;
  diceFeed.push({ seat: relay.state.seat ?? 's1', text });
  render();
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
  }
  return { mechs, drones, points };
}

// ---------- pieces ----------

function barHtml(): string {
  const v = relay.state;
  const conn = v.room
    ? v.status === 'playing'
      ? '<span class="pill live">● both seated</span>'
      : v.status === 'connecting'
        ? '<span class="pill bad">● reconnecting</span>'
        : '<span class="pill">● waiting for the other player</span>'
    : '';
  return `<div class="mc-bar">
    <a class="mc-logo" href="./index.html">EMBER <em>Testing Grounds</em><small>Match Centre</small></a>
    ${v.room ? `<span class="pill code" id="mc-code" title="Copy the room code">${esc(v.room.id)}${copied ? ' ✓' : ''}</span>` : ''}
    ${conn}
    <span class="spacer"></span>
    <a class="mc-back" href="./index.html">← Board</a>
    <button class="mc-account" id="mc-acct">${account ? esc(account.username) : 'Sign in'}</button>
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
    <p class="mc-sub">One player opens a table and shares the code. The host sets the battlefield and the rules; both players bring a squad.</p>
    <div class="mc-row">
      <div class="panel">
        <h3>Open a table</h3>
        <p class="hint">You become the host. You pick the map, the Main Task and the game length, then launch when both squads are in.</p>
        <button class="btn wide" id="mc-host"${busy ? ' disabled' : ''}>Open a table</button>
      </div>
      <div class="panel">
        <h3>Join with a code</h3>
        <p class="hint">From whoever opened the table. You bring a squad and pick your Secondary Task; they handle the rest.</p>
        <input class="f codebox" id="mc-joincode" maxlength="8" placeholder="CODE" />
        <button class="btn wide" id="mc-join"${busy ? ' disabled' : ''}>Join</button>
      </div>
    </div>
    ${doorErr ? `<div class="mc-err">${esc(doorErr)}</div>` : ''}
    <p class="quiet" style="margin-top:14px">Playing solo or hotseat? That stays on the <a href="./index.html" style="color:var(--text2)">board</a> — this page is only for linked games.</p>
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

// A small honest map: every occupied terrain cell as a rect, coloured by kind.
function previewSvg(mapId: string): string {
  const pieces = data?.terrain.layouts[mapId] ?? [];
  const fill = (t: string) => (t === 'container' ? 'rgba(61,220,132,.55)' : t === 'low_wall' ? '#4a5563' : '#39424e');
  const cells = pieces
    .flatMap((p) => p.subCells.map((c) => `<rect x="${c.col + 0.06}" y="${c.row + 0.06}" width="0.88" height="0.88" rx="0.12" fill="${fill(p.type)}"/>`))
    .join('');
  return `<svg class="mapsvg" viewBox="0 0 36 36" aria-hidden="true"><rect x="0" y="0" width="36" height="36" fill="none"/>${cells}</svg>`;
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
  const canLaunch = isHost() && !running()
    && !!relay.state.room?.seats.s1 && !!relay.state.room?.seats.s2
    && sideSummary('s1').mechs + sideSummary('s1').drones > 0
    && sideSummary('s2').mechs + sideSummary('s2').drones > 0;
  const foot = running()
    ? `<div class="foot"><b>Match running</b>Round ${state.round.n} · ${PHASES[state.round.phase]} Phase</div>`
    : isHost()
      ? `<div class="foot">
          <button class="btn wide" id="mc-launch" style="margin-top:0"${canLaunch ? '' : ' disabled'}>Launch match</button>
          <span class="quiet" style="display:block;margin-top:6px">${canLaunch ? 'Both squads are in.' : 'Needs both seats filled and both squads brought.'}</span>
        </div>`
      : `<div class="foot"><b>The host launches</b>when both squads are in.</div>`;
  return `<div class="mc-rail">
    <div class="grouphead">Match setup</div>
    ${steps}
    ${foot}
  </div>`;
}

function roomStep(): string {
  return `<div class="steppane">
    <div class="stephead"><h3>Room</h3><span>who is at the table</span></div>
    <div class="roomhead">
      <span class="codebig" id="mc-code2" title="Copy the room code">${esc(relay.state.room!.id)}${copied ? ' ✓' : ''}</span>
      <span class="who">Give this code to your opponent.<br>${isHost() ? 'You are the host: the table settings are yours.' : 'The host sets up the table; you bring a squad.'}</span>
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
    `<span class="chip${!state.mission ? ' sel' : ''}${editable ? '' : ' still'}" ${editable ? 'data-mission=""' : ''}>No Main Task</span>`,
    ...(data?.missions.cards ?? []).map(
      (m) => `<span class="chip${state.mission === m.id ? ' sel' : ''}${editable ? '' : ' still'}" ${editable ? `data-mission="${m.id}"` : ''}>${esc(m.name)}</span>`,
    ),
  ].join('');
  return `<div class="steppane">
    <div class="stephead"><h3>Battlefield</h3><span>the map and the Main Task, set before the first roll (3.1.1)</span></div>
    ${editable ? '' : `<p class="hint">${running() ? 'The battlefield is locked while the game runs.' : 'The host sets the battlefield. You are watching it live.'}</p>`}
    <div class="pickgrid">
      <div class="mappanel">
        <div class="previewhead"><span class="t">Preview</span><span class="n">${esc(mapName(state.map))}</span></div>
        ${previewSvg(state.map)}
      </div>
      <div class="maplist">${maps}
        <p class="quiet">Custom maps stay on the board page for now — a guest may not have them.</p>
      </div>
    </div>
    <div class="missionrow">${missions}</div>
    <p class="quiet">Picking a Main Task lays its zones and Task Items on both boards in one step.</p>
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
      return `<div class="seatcard ${side}">
        <div class="who"><span class="sq">${side === 's1' ? 'SQ1' : 'SQ2'}</span>${who ? esc(who) : '<i>empty seat</i>'}${mine ? ' <i>(you)</i>' : ''}</div>
        <div class="st${has ? ' on' : ''}">${has ? `✓ ${s.mechs} mech${s.mechs === 1 ? '' : 's'}, ${s.drones} drone${s.drones === 1 ? '' : 's'} · ${s.points} points` : mine ? 'no squad yet' : 'no squad yet — waiting on them'}</div>
        ${mine && !running() ? `<button class="btn${has ? ' ghost' : ''}" id="mc-bring" style="margin-top:9px">${has ? 'Add another squad' : 'Bring a squad'}</button>` : ''}
      </div>`;
    })
    .join('');
  return `<div class="steppane">
    <div class="stephead"><h3>Squads</h3><span>each seat brings its own — they land on both screens</span></div>
    ${rows}
    <p class="quiet">Squads come from your saved library or a builder file, and wait undeployed until the match starts. To change a squad, leave and rejoin — a proper remove lands with the HUD.</p>
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
    <div class="stephead"><h3>Rules</h3><span>battle scale and game length</span></div>
    ${editable ? '' : '<p class="hint">The host sets the rules. You are watching them live.</p>'}
    <div class="sect2">Battle scale</div>
    <div class="missionrow" style="margin-top:6px">${scales}</div>
    <div class="sect2" style="margin-top:14px">Game length</div>
    <div class="missionrow" style="margin-top:6px">${rounds}</div>
    <p class="quiet">Scale caps squad points (600 / 900 / 1200+). The rulebook plays 5 rounds at every scale.</p>
  </div>`;
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
    rollHits,
    rollPool,
    diceFeed,
    note: lobbyNote,
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
  send({ kind: 'startMatch', seat: devSeat ?? 's1' });
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

function pickerHtml(): string {
  const saved = loadSquads();
  const items = saved
    .map(
      (s) => `<button class="pickrow" data-squad="${esc(s.id)}">
        <span class="nm">${esc(s.name)}</span>
        <span class="ct">${s.mechs.length}M ${s.drones.length}D</span>
      </button>`,
    )
    .join('');
  return `<div class="mc-veil" id="mc-veil2">
    <div class="acct">
      <button class="x" id="mc-picker-x">✕</button>
      <h3>Bring a squad</h3>
      <div class="role">It joins your side on both screens and waits for deployment.</div>
      ${items || '<p class="hint">No saved squads yet — import one from a builder file below, and it will be remembered here.</p>'}
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
  const inner = !data
    ? `<div class="mc-col" style="max-width:400px"><p class="mc-sub">Loading the card database…</p></div>`
    : hud
      ? hudHtml(hudCtx())
      : devSeat
        ? devPane()
        : !account
          ? loginHtml()
          : relay.state.room
            ? lobbyHtml()
            : doorHtml();
  const wide = data && ((account && relay.state.room) || hud);
  root.innerHTML = `${barHtml()}<div class="mc-stage${wide ? ' wide' : ''}${hud ? ' hudmode' : ''}">${inner}</div>${acctOpen ? acctHtml() : ''}${pickerOpen ? pickerHtml() : ''}`;
  wire();
  if (hud) wireHud(root, hudCtx());
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
  $('mc-join')?.addEventListener('click', () => {
    const code = ($('mc-joincode') as HTMLInputElement | null)?.value.trim() ?? '';
    doorErr = code ? null : 'Enter the room code you were given.';
    if (code) relay.join(code);
    else render();
  });
  $('mc-joincode')?.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') $('mc-join')?.click();
  });
  $('mc-leave')?.addEventListener('click', () => relay.leave());

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
    send({ kind: 'startMatch', seat: mySeat() ?? 's1' });
    render();
  });
  $('mc-devseed')?.addEventListener('click', () => devSeed());

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
  render();
})();

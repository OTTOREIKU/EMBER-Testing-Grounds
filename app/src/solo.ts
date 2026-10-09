// A GAME AGAINST THE COMPUTER, as the page that hosts it holds it
// (AI-OPPONENT-PLAN.md, M4). The Match Centre plays it exactly as it plays a
// room: its own seat through perform(), the other seat's commands arriving
// through the relay. This is the other end of that relay: it sets the table a
// scenario names, sits a driver (src/ai) in the second seat, tells it of every
// command that lands, and lets it answer AT A PERSON'S PACE.
//
// THE PACE IS THE HOST'S (decision D7; OTTO, 2026-10-01: a computer that runs
// its whole turn in under two seconds "definitely appear[s] as if an AI
// instantly calculated everything"). The driver holds no timer. Before it acts
// it waits here for a moment sized to the decision, and after it acts it waits
// for the table to come to rest: the walk finished on the player's board, the
// dice landed and read. None of it is drawn from the computer's own seeded
// stream, so a game replays from its seed whatever the speed.
import { check, type CheckResult, type Command } from './commands';
import type { GameData, SoloScenario, SoloSquad } from './data';
import { Driver, type Host, type LogEntry } from './ai/driver';
import { eagerPolicy } from './ai/eager';
import { legalPolicy } from './ai/legal';
import { tacticianPolicy } from './ai/tactician';
import { recruitPolicy, veteranPolicy } from './ai/levels';
import { brawlerPolicy } from './ai/styles';
import type { Policy } from './ai/policy';
import { Rng } from './ai/rng';
import type { LoopbackRelay } from './loopback';
import { newSalt, sealTactic } from './secrecy';
import { handCommand, type HeldCard } from './tactichand';
import { RIVAL, SOLO_OWN, SPEEDS, WATCH_SCALE, type SoloOwn, type Speed } from './soloask';
import type { Decision, Option } from './seat';
import { mapConfig, missionConfig } from './tableconfig';
import { alive } from './loop';
import { SLOT_LABEL } from './units';
import { PHASES, STATUSES, type GameState, type PartSlot, type PartState, type Side, type Token } from './types';

// ---------- what the address asks for ----------

// The speeds and the address itself are soloask.ts's, which a page that only
// offers a game imports alone.
export { ownGame, RIVAL, RIVALS, SOLO_OWN, SOLO_OWN_KEY, SPEEDS, soloAsk, soloQuery, type SoloOwn, type Speed } from './soloask';

// Who sits in the other seat. The plan's opponents arrive here by name. The
// TACTICIAN is the one a game is played against (soloask.ts RIVAL): it weighs
// every answer in Victory Points, the mission and what could be done to it
// included; it is the ACE of the three levels a player may pick (M9.1, ai/
// levels.ts), beside the VETERAN (the Tactician without its look ahead) and the
// RECRUIT (the Brawler, making mistakes). The BRAWLER is our own aggressive
// style of the Tactician (ai/styles.ts; OTTO, 2026-10-05: it "should want to
// fight the opponents and cause them to have to reposition or have to back off
// of objectives, it just shouldn't throw away units"): return fire weighed at
// half the Ace's, the other squad's Box carriers and Commander walked at, an
// outranged unit closing in, and with Secondary Tasks on a card that pays for
// the enemy destroyed (OTTO, 2026-10-09: "it's built to be more aggressive").
// Until 2026-10-09 the Brawler was a copy of the other app's AI rebuilt on
// this engine, and the Recruit was made of it; the copy is gone (M21).
// The other two are for
// the suite and for comparison: the eager one shoots at anything and weighs
// nothing, and the legal one draws its answers by lot.
export const OPPONENT = RIVAL;
export const OPPONENTS: Record<string, { name: string; policy: Policy }> = {
  tactician: { name: 'Computer (Ace)', policy: tacticianPolicy },
  veteran: { name: 'Computer (Veteran)', policy: veteranPolicy },
  recruit: { name: 'Computer (Recruit)', policy: recruitPolicy },
  brawler: { name: 'Computer (Brawler)', policy: brawlerPolicy },
  eager: { name: 'Computer (eager)', policy: eagerPolicy },
  legal: { name: 'Computer (random)', policy: legalPolicy },
};

export interface SoloSpec {
  scenario: SoloScenario;
  // The squad in each seat: a shipped game's by name, or the player's own.
  squads: Record<Side, SoloSquad>;
  // The seat the player holds, and the computer's.
  human: Side;
  bot: Side;
  seed: number;
  speed: Speed;
  opponent: string;
  // The player's own seat is played by a computer too, and the player watches:
  // that computer is `opponent2` (OTTO, 2026-10-05: "load a second computer in
  // to fight it").
  watch: boolean;
  opponent2: string;
  // The Season Rules the game is played with (Supplementary Rules 1.04,
  // section 8), or none for the main rules (OTTO, 2026-10-05: "a toggle to
  // turn these seasonal rules on or off when choosing the AI settings").
  season: string | null;
}

const other = (s: Side): Side => (s === 's1' ? 's2' : 's1');

// A game of the player's own, held to the data: a battlefield and a Main Task
// that exist, and a squad with something in it for each seat. The First Player
// is rolled for and picks an edge as in any game; each squad plays the Tactics
// Cards it brings.
function ownScenario(data: GameData, own: SoloOwn | null | undefined): SoloScenario | string {
  if (!own) return 'No game of your own is set up on this device. Set one up on the tabletop: Setup, then Play the computer.';
  if (!data.terrain.maps.some((m) => m.id === own.map)) return `There is no battlefield called "${own.map}".`;
  if (!data.missions.cards.some((c) => c.id === own.mission)) return `There is no Main Task called "${own.mission}".`;
  const tactics = !!(own.squads.s1.tactics?.length || own.squads.s2.tactics?.length);
  return { id: SOLO_OWN, map: own.map, mission: own.mission, rounds: own.rounds, secondaries: own.secondaries, tactics, seats: { s1: 'own:s1', s2: 'own:s2' } };
}

// The game the address names, or in plain words why there is none. `own` is
// the game the player put together, when the address asks for that one
// (soloask.ts SOLO_OWN): the page reads it out of its storage and hands it in.
export function soloSpec(data: GameData, ask: Record<string, string>, newSeed: () => number, own?: SoloOwn | null): SoloSpec | string {
  const mine = ask.solo === SOLO_OWN;
  const scenario = mine ? ownScenario(data, own) : data.solo.scenarios.find((x) => x.id === ask.solo);
  if (typeof scenario === 'string') return scenario;
  if (!scenario) return `There is no game against the computer called "${ask.solo}".`;
  if (!mine) {
    for (const seat of ['s1', 's2'] as Side[]) {
      if (!data.solo.squads[scenario.seats[seat]]) return `The squad "${scenario.seats[seat]}" of that game is missing.`;
    }
  }
  const squads: Record<Side, SoloSquad> = mine && own ? own.squads : { s1: data.solo.squads[scenario.seats.s1], s2: data.solo.squads[scenario.seats.s2] };
  // The side asked for by faction (rdl, un), by seat, or the first by default.
  const want = (ask.side ?? '').toLowerCase();
  const byFaction = (['s1', 's2'] as Side[]).find((seat) => !!want && (squads[seat].faction ?? '').toLowerCase() === want);
  const human: Side = want === 's1' || want === 's2' ? want : byFaction ?? 's1';
  const n = Number(ask.seed);
  const seed = ask.seed !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : newSeed();
  const speed = SPEEDS.find((x) => x.id === ask.pace)?.id ?? 'normal';
  const opponent = ask.ai && OPPONENTS[ask.ai] ? ask.ai : OPPONENT;
  const opponent2 = ask.ai2 && OPPONENTS[ask.ai2] ? ask.ai2 : OPPONENT;
  // Only a season the data holds.
  const season = ask.season && (data.seasons ?? []).some((s) => s.id === ask.season) ? ask.season : null;
  return { scenario, squads, human, bot: other(human), seed, speed, opponent, watch: ask.watch === '1', opponent2, season };
}

// What the host sends to set the table before either seat is taken: the
// battlefield, the Main Task with its zones and Task items (tableconfig.ts, as
// the lobby sends them), the game's length, both squads and the hands they
// bring (`soloHands`), the start, and the battlefield locked, since the
// scenario chose it (3.1.2). The squads are the spec's: a shipped game's by
// default.
export function soloSetup(data: GameData, scenario: SoloScenario, squads?: Record<Side, SoloSquad>, hands: Command[] = [], season: string | null = null): Command[] {
  const out: Command[] = [
    { kind: 'configureTable', seat: 's1', ...mapConfig(data, scenario.map, null) },
    { kind: 'configureTable', seat: 's1', ...missionConfig(data, scenario.map, scenario.mission) },
    { kind: 'configureTable', seat: 's1', roundLimit: scenario.rounds, ...(scenario.secondaries === false ? { noSecondary: true } : {}) },
    // The Season Rules, set while the table may still be set (a house setting,
    // fixed once setup is done: commands.ts configureTable).
    ...(season ? [{ kind: 'configureTable', seat: 's1', season } as Command] : []),
  ];
  for (const seat of ['s1', 's2'] as Side[]) {
    const sq = squads?.[seat] ?? data.solo.squads[scenario.seats[seat]];
    out.push({ kind: 'importSquad', seat, name: sq.name, mechs: sq.mechs, drones: sq.drones });
  }
  out.push(...hands);
  out.push({ kind: 'startMatch', seat: 's1' }, { kind: 'lockMap', seat: 's1' });
  return out;
}

// The room a game against the computer is played in (the loopback's), which a
// sealed hand is kept for on this device (tactichand.ts).
export const SOLO_ROOM = 'SOLO';

// THE HANDS OF TACTICS CARDS (5.4; Supplementary Rules 1.04, 1.11), dealt sealed
// as across a room. The player's by the page's own `handCommand`, its salts kept
// on this device for the solo room, where the Tactics panel finds them; a
// computer's with salts made here and handed to its seat alone (`Driver.deal`):
// nothing of the page, its storage included, holds the computer's cards. In a
// game the player only watches both seats are a computer's.
export interface SoloHands {
  commands: Command[];
  held: Partial<Record<Side, HeldCard[]>>;
}

export function soloHands(spec: Pick<SoloSpec, 'squads' | 'human' | 'watch'>, salt: () => string = newSalt): SoloHands {
  const out: SoloHands = { commands: [], held: {} };
  for (const seat of ['s1', 's2'] as Side[]) {
    const ids = [...new Set(spec.squads[seat].tactics ?? [])];
    if (!ids.length) continue;
    if (seat === spec.human && !spec.watch) {
      out.commands.push(handCommand(seat, ids, SOLO_ROOM));
      continue;
    }
    const held = ids.map((id) => ({ id, salt: salt() }));
    out.held[seat] = held;
    out.commands.push({ kind: 'setTactics', seat, sealed: held.map((c) => sealTactic(c.id, c.salt)).sort() });
  }
  return out;
}

// ---------- the pace ----------

// How long the computer takes over a decision before it answers, at Normal
// speed, as a low and a high in milliseconds: short for bookkeeping, longer to
// pick a unit or a Stance, longest before a Movement or an attack is declared.
// Inside an attack each press is a beat of its own, and the result is held
// before the window closes.
export function thinkMs(d: Decision, o: Option): [number, number] {
  const k = d.kind;
  const has = (tag: string): boolean => o.tags.includes(tag);
  if (k.startsWith('attack.') || k.startsWith('defence.') || k.startsWith('contest.')) {
    if (k === 'attack.finish' || k === 'contest.close') return [1500, 2300];
    if (k === 'attack.apply' || k === 'contest.apply' || k === 'attack.surplus') return [1100, 1700];
    if (k.endsWith('.focus') || k.endsWith('.partfocus') || k.endsWith('.declare') || k.endsWith('.designate') || k.endsWith('.provoke')) return [1000, 1700];
    if (k.endsWith('.reroll')) return [900, 1400];
    return [700, 1100];
  }
  if (k === 'opp.act' || k === 'activation.act') {
    if (has('end')) return [600, 1000];
    if (has('move') || has('blink') || has('attack') || has('electronic') || has('launch') || has('detonate') || has('overwatch')) return [1300, 2400];
    // A Command handed to a Drone in the middle of a turn (4.15.3) is a unit
    // picked, as one is in the Command Phase.
    if (has('coordinate') || has('grant')) return [900, 1500];
    return [800, 1400];
  }
  // A blast owed, an Interception to make: an attack declared like another;
  // Smoke put down is a placement chosen; the end of a blast is a step of
  // bookkeeping.
  if (k === 'blast.resolve' || k === 'intercept.attempt') return has('attack') ? [1300, 2400] : has('smoke') ? [1100, 1900] : [700, 1200];
  // A reaction to being attacked: a blow struck back is an attack declared,
  // Smoke is placed, and the rest is taken or left over a moment. A Screen to
  // give up as a round ends is picked as a unit is.
  if (k === 'reaction.answer') return has('attack') ? [1300, 2400] : has('smoke') ? [1100, 1900] : [800, 1400];
  if (k === 'smoke.thin') return [900, 1500];
  // A Tactics Card: Hit and Run's step is a Movement declared, a card played
  // is a card chosen and its unit picked, and one let go by a moment's thought.
  if (k === 'tactic.after' || k === 'tactic.end' || (k === 'phase.ready' && has('tactic'))) {
    return has('pass') ? [600, 1000] : has('move') ? [1300, 2400] : [900, 1500];
  }
  // A unit Revealed, and where it appears: a Grid chosen, as one is to deploy in.
  if (k === 'reveal.make') return [900, 1600];
  if (k === 'opp.reboot' || k.startsWith('loop.designate.')) return has('pass') ? [700, 1200] : [900, 1500];
  if (k === 'setup.deploy' || k === 'setup.edge' || k === 'setup.secondary' || k === 'setup.box' || k.startsWith('setup.designate.')) return [900, 1600];
  if (k === 'setup.roll') return [700, 1200];
  // The dials are set over a moment, one Mech at a time.
  if (k === 'planning.dial') return [600, 1100];
  // Bookkeeping: a ready, a reveal, a step of the End Phase.
  return [450, 850];
}

// How long the table is left at rest after an answer, at Normal speed, once
// any walk has ended: dice are left on screen to be read, a declared attack is
// looked at, a step of bookkeeping needs no more than a breath.
export function restMs(d: Decision, o: Option): number {
  const k = d.kind;
  if (k.endsWith('.roll') || k.endsWith('.reroll') || k === 'attack.part') return 1100;
  if (k.startsWith('attack.') || k.startsWith('defence.') || k.startsWith('contest.')) return 500;
  if (o.tags.includes('move') || o.tags.includes('launch')) return 350;
  if (o.tags.includes('attack') || o.tags.includes('electronic')) return 700;
  return 200;
}

// ---------- the table ----------

export interface SoloHost {
  data: GameData;
  // The page's board. Read afresh: a rollback replaces it.
  state(): GameState;
  loop: LoopbackRelay;
  // A unit is still walking across the player's board.
  walking(): boolean;
  // The table changed in a way the page draws: a computer stopped, the game
  // ended, a pause began or ended.
  changed(): void;
  // A computer seat has begun or finished a decision: what it is doing, in a
  // few words, or null when it is waiting.
  status?(seat: Side, doing: string | null): void;
  // A computer seat has done something the other squad sees, and says why, in
  // a line (`whyLine`, M9.2).
  told?(seat: Side, line: string): void;
  // What the computers have thought has grown or changed (`thinking`).
  thought?(): void;
  // A computer seat has answered a question, the table taking it or not: its
  // log's entry for it (the game's log, botlog.ts).
  decided?(seat: Side, entry: LogEntry): void;
  // A computer seat has stopped and waits for the player (`trouble`).
  halted?(seat: Side, kind: 'refused' | 'stuck', why: string): void;
  // The game is over (`over`): said once.
  ended?(): void;
  // The page's own door and dice, for a game the player only watches: the
  // computer in the page's seat sends as a press on the page does.
  page?: {
    send(cmd: Command): CheckResult;
    roll(pool: Record<string, number>, label: string, kind: 'hits' | 'pool'): Promise<{ color: string; face: number }[]>;
  };
  // Waits. A suite passes one that returns at once.
  sleep?(ms: number): Promise<void>;
  // How often the table is looked at with nothing having landed, in case a
  // wake was missed; 0 for never (a suite).
  heartbeatMs?: number;
}

// Thrown through the driver's pace when the table is taken down under it, so
// an answer already chosen is never sent to a game that has gone.
class Stopped extends Error {}

// What a computer seat is doing, said the way the turn panel would.
function doing(d: Decision, o: Option): string {
  const k = d.kind;
  if (k.startsWith('attack.') || k.startsWith('defence.') || k.startsWith('contest.')) return 'in the combat window';
  if (o.tags.includes('tactic') && !o.tags.includes('pass')) return 'playing a Tactics Card';
  if (o.tags.includes('tactic')) return 'thinking';
  if (k === 'opp.act' || k === 'activation.act') return o.tags.includes('end') ? 'ending its turn' : o.tags.includes('coordinate') ? 'commanding a Drone' : 'acting';
  if (k === 'blast.resolve') return o.tags.includes('smoke') ? 'placing Smoke' : 'resolving a Detonation';
  if (k === 'intercept.attempt') return 'intercepting';
  if (k === 'reaction.answer') return o.tags.includes('smoke') ? 'placing Smoke' : 'answering the attack';
  if (k === 'smoke.thin') return 'thinning its Smoke';
  if (k === 'reveal.make') return 'revealing a unit';
  if (k === 'mine.lay') return 'laying a Mine';
  if (k === 'planning.dial' || k === 'planning.commit') return 'setting its dials';
  if (k === 'setup.deploy') return 'deploying';
  return 'thinking';
}

// WHY, IN A LINE (M9.2; OTTO, 2026-10-03: "sure on the why lines"): what the
// computer has just done and what for, in a player's words, for the page's
// notice line (an `event`: the other player did something). Said only of what
// the other squad sees done, a unit's turn and a Command given: never a dial
// before it is revealed, nor a Tactics Card let go by, which would tell what a
// sealed hand holds. Null where there is nothing worth saying: the end of a
// turn, a step whose reason is the board's to show. Keyed by the reason a
// policy gives (`Choice.reason`); a table with no prototype, so a reason that
// is not in it is never answered by something inherited.
const BECAUSE: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  // Where it walks.
  take_zone: 'for the mission', access_terminal: 'for the mission', take_box: 'for the mission',
  occupy_objective: 'for the mission', contact_before_occupation: 'to close with the enemy',
  advance: 'to close in', move_to_attack: 'to attack from there', move_to_strike_next: 'to be in reach next turn',
  safer_attack: 'to attack from a safer Grid', break_in: 'to free the Black Box in it', hold_zone: 'to hold the zone',
  take_cover: 'out of the enemy\'s sights', movement_unlocks_better_target: 'to reach a better target',
  reposition_opening: 'to find something to attack', intent_opening: 'to attack',
  // What it does.
  attack_value: 'its best attack', attack_result_value: 'its best attack', attack_revealed: 'at the unit its Scan found',
  launch_value: 'where it does most', projectile_blast_value: 'where it does most', blast_value: 'where it does most',
  jam_value: 'to jam the enemy', support_value: 'to keep its squad going', overwatch_value: 'to lend a shot',
  patch_value: 'to mend an ally next round', spotter_value: 'to call in a shot', sentry_value: 'to jam an enemy every round', beacon_value: 'to support its squad', mine_value: 'to mine the enemy\'s way', veil_value: 'to give its squad Low Profile', tag_value: 'to mark a target for its squad',
  stance_by_value: 'for what that Stance lets it do', preparation_unlocks_attack: 'to open an attack',
  charge_for_attack: 'to charge a Part for its attack', smoke_for_cover: 'to hide behind it', smoke_for_squad: 'to hide its squad', smoke_ahead: 'to cover its squad as it moves up',
  cloak: 'to be hard to target', low_profile: 'to be hard to target', draw_fire: 'to draw the enemy\'s fire', mode_by_value: 'for what it can do then',
  tactic_by_value: 'worth more played than kept', coordinate_by_value: 'to put a Drone to work',
  tick_by_value: 'for the turn it opens', reboot: 'to get back into the fight', restore_link: 'to restore its Link',
  // A Command given.
  command_by_value: 'the Command that does most', command_opportunity: 'so no Command goes unspent',
  aster_link: 'to turn a spare Command into Link', tactic_command: 'a Command its Tactics Card pays for',
  // A level's mistake (ai/levels.ts).
  blunder: 'a mistake',
});
const TOLD = new Set(['opp.act', 'activation.act', 'loop.designate.command']);

// `who` is the name of the unit whose turn it is: said first where the answer
// does not say it ("Single Shot at Mire" is Dune's).
export function whyLine(d: Decision, o: Option, reason: string | undefined, who?: string): string | null {
  if (!TOLD.has(d.kind) || !reason || o.tags.includes('end') || o.tags.includes('pass')) return null;
  const because = Object.prototype.hasOwnProperty.call(BECAUSE, reason) ? BECAUSE[reason] : undefined;
  if (!because) return null;
  const named = !who || o.label.startsWith(`${who}:`) || o.label.startsWith(`${who} `);
  return `${named ? '' : `${who}: `}${o.label} (${because})`;
}

// WHAT OF THE COMPUTER'S DECISIONS A REPORT MAY CARRY (M15, a game log kept on
// the player's own device): what it did on the table, which the player has
// seen happen; never what is still hidden from them. A Timing Dial only once
// both are revealed (the Planning Phase of its round is over), no Secondary
// Task and no designation made at setup, and a Tactics Card only where it was
// played: a question about a card that ended in a pass would tell which card
// the computer holds.
export function publicDecisions(log: readonly LogEntry[], state: GameState): LogEntry[] {
  return log.filter((e) => seenByOther(e, state)).map((e) => ({ ...e }));
}

// Whether the other squad has seen this answer given (`publicDecisions`).
function seenByOther(e: { kind: string; option: string; round: number }, state: GameState): boolean {
  const round = state.round?.n ?? 0;
  const phase = state.round?.phase ?? 0;
  if (e.kind === 'planning.dial') return e.round < round || (e.round === round && phase > PHASES.indexOf('Planning'));
  if (e.kind === 'planning.commit' || e.kind === 'setup.secondary' || e.kind.startsWith('setup.designate')) return false;
  if (e.kind === 'tactic.after' || e.kind === 'tactic.end') return e.option.startsWith('tactic:');
  return true;
}

// ---------- what the computer is thinking ----------

// WHAT A COMPUTER DID (OTTO, 2026-10-05: a Thinking tab "where I can watch how
// the computer chooses to make moves and follow along"; and once he had watched
// one: "Just the unit, what it did and any relevant damage or markers on it").
// Every answer worth a line, told as its commands go to the table (`given`
// null while the board shows it), marked once the table has taken it, and once
// what it did is over (an attack's window closed), what it did to each unit.
export interface Thought {
  n: number;
  seat: Side;
  round: number;
  phase: number;
  kind: string;
  option: string;
  // The unit the question was about, by name, where there is one.
  unit?: string;
  label: string;
  given: 'done' | 'refused' | null;
  // What it did to each unit: a Part damaged or destroyed, the unit destroyed,
  // a Token gained.
  result?: ThoughtResult[];
}

export interface ThoughtResult {
  unit: string;
  side: Side;
  said: string[];
}

// The questions a line is told of: what a unit does with its turn, a Command
// given, where a unit is deployed, its dial, an answer to the other squad's
// move (a reaction, an Interception, a blast, a Reveal), a Mine laid, a Tactics
// Card played. Never a step inside an attack, whose result is told on the
// attack's own line, nor the bookkeeping of setting up and readying.
const TOLD_IN_THINKING = new Set([
  'opp.act', 'activation.act', 'opp.reboot', 'loop.designate.command', 'setup.deploy', 'planning.dial',
  'reaction.answer', 'intercept.attempt', 'blast.resolve', 'reveal.make', 'mine.lay', 'smoke.thin',
  'phase.ready', 'tactic.after', 'tactic.end',
]);

// An answer worth a line: to such a question, with more than one answer, and
// not one let go by, nor the end of a turn that picks nothing up. A Ready, or a
// moment for a Tactics Card, is a line only where a card is played.
export function worthAThought(d: Decision, o: Option): boolean {
  if (!TOLD_IN_THINKING.has(d.kind) || d.options.length < 2 || o.tags.includes('pass')) return false;
  if (o.tags.includes('end') && !o.tags.includes('take')) return false;
  if (d.kind === 'phase.ready' || d.kind === 'tactic.after' || d.kind === 'tactic.end') return o.tags.includes('tactic');
  return true;
}

// The table as it bears on the lines: each unit's Parts and Tokens.
type Marks = Map<number, { label: string; side: Side; kind: Token['kind']; alive: boolean; parts: Partial<Record<string, PartState>>; tokens: Map<string, number> }>;

// The Tokens a line does not tell: a Command Token is handed out and swept every
// round.
const UNTOLD_TOKENS = new Set(['command', 'commandUsed']);

export function marksOf(state: GameState): Marks {
  const out: Marks = new Map();
  for (const t of state.tokens) {
    const tokens = new Map<string, number>();
    for (const id of t.statuses ?? []) if (!UNTOLD_TOKENS.has(id)) tokens.set(id, (tokens.get(id) ?? 0) + 1);
    out.set(t.uid, { label: t.label, side: t.side, kind: t.kind, alive: alive(t), parts: { ...t.partStates }, tokens });
  }
  return out;
}

// What changed for each unit between two tables, in a player's words: "Torso
// damaged", "L.Arm destroyed", "destroyed", "gains Highlight". A Projectile
// that left the board went off; it was not destroyed.
export function resultOf(before: Marks, after: Marks): ThoughtResult[] {
  const out: ThoughtResult[] = [];
  for (const [uid, was] of before) {
    const now = after.get(uid);
    if (!now && was.kind === 'projectile') continue;
    const said: string[] = [];
    if (was.alive && (!now || !now.alive)) said.push('destroyed');
    else if (now) {
      for (const [slot, part] of Object.entries(now.parts)) {
        const had = was.parts[slot] ?? 'intact';
        if (part === had || part === 'intact') continue;
        const name = SLOT_LABEL[slot as PartSlot | 'main'] ?? slot;
        said.push(`${name} ${part === 'destroyed' ? 'destroyed' : 'damaged'}`);
      }
      for (const [id, n] of now.tokens) {
        if (n > (was.tokens.get(id) ?? 0)) said.push(`gains ${STATUSES.find((s) => s.id === id)?.label ?? id}`);
      }
    }
    if (said.length) out.push({ unit: was.label, side: was.side, said });
  }
  return out;
}

// What the page's Thinking tab may show. In a game the player watches, both
// computers' every line. In a game the player plays, the computer's answers
// once given and only what the player has seen it do (`seenByOther`).
export function thoughtsFor(thoughts: readonly Thought[], state: GameState, o: { watch: boolean; bot: Side }): Thought[] {
  if (o.watch) return thoughts.map((t) => ({ ...t }));
  return thoughts.filter((t) => t.seat === o.bot && t.given === 'done' && seenByOther(t, state)).map((t) => ({ ...t }));
}

// How many thoughts the table keeps: a whole game's worth of turns.
const THOUGHTS = 400;

// How long the computer may hold the page's thread before it hands it back in
// the middle of a decision: under one drawn frame, so nothing on the page is
// seen to stop.
const FRAME_MS = 12;

// How long a computer may think before the page says it is thinking: a slow
// machine's long thought is not shown as a computer waiting on the player.
const THINKING_MS = 300;
// The least moment before an answer at Normal speed, however long the thought.
const BEAT_MS = 100;

// One computer seat and the loop that keeps asking it.
interface Runner {
  seat: Side;
  driver: Driver;
  pumping: boolean;
  again: boolean;
  refusals: number;
  // When the question in hand was put to it, and whether the page has been
  // told it is thinking about it.
  asked: number;
  shown: boolean;
}

export class SoloTable {
  // The computer in the other seat.
  readonly driver: Driver;
  // The computer in the page's own seat, in a game the player only watches.
  readonly player: Driver | null = null;
  speed: Speed;
  // Why a computer seat has stopped, when one has.
  trouble: { seat: Side; kind: 'refused' | 'stuck'; why: string } | null = null;
  over = false;
  private held = false;
  private stopped = false;
  private readonly runners: Runner[] = [];
  private beat: ReturnType<typeof setInterval> | undefined;
  private release: (() => void)[] = [];
  // When the page last had its thread back from a computer that was thinking.
  private breathed = 0;
  // How many rollbacks the table has had: one more is a board replaced under
  // the computer, which forgets what it remembered of the old one (M9.4).
  private rollbacks = 0;
  // What each computer did, newest last (`Thought`), and the table as each
  // line began, kept until what it did is over (`settle`).
  private readonly thoughts: Thought[] = [];
  private thoughtN = 0;
  private readonly before = new Map<number, Marks>();

  // THE PAGE'S THREAD, handed back to it in the middle of a decision: at once
  // while the computer has held it for less than a frame, and by a timer's
  // turn once it has. A thought that has run long is said to be one.
  private breathe(seat: Side): Promise<void> {
    const r = this.runners.find((x) => x.seat === seat);
    if (r && !r.shown && performance.now() - r.asked > THINKING_MS) {
      r.shown = true;
      this.h.status?.(seat, 'thinking');
    }
    if (performance.now() - this.breathed < FRAME_MS) return Promise.resolve();
    return new Promise<void>((done) => { setTimeout(() => { this.breathed = performance.now(); done(); }, 0); });
  }

  // `hands` is each computer seat's hand as `soloHands` dealt it.
  constructor(private readonly h: SoloHost, readonly spec: SoloSpec, hands: SoloHands['held'] = {}) {
    this.speed = spec.speed;
    const { data } = h;
    // Each computer plays at its own level: the page's seat, in a game the
    // player watches, at the second one picked.
    const seated = (seat: Side, send: (cmd: Command) => CheckResult, roll: Host['roll']): Driver => {
      const policy = OPPONENTS[seat === spec.bot ? spec.opponent : spec.opponent2]?.policy ?? OPPONENTS[OPPONENT].policy;
      const driver = new Driver(seat, {
        data,
        state: () => h.state(),
        send,
        roll,
        pace: (d, o, think) => this.pace(seat, d, o, think),
        settled: (d, o) => this.rest(d, o),
        chose: (d, o) => this.chose(seat, d, o),
        // A long decision is worked out in steps, and the page has its thread
        // back between them: a frame is drawn, a click is heard. A step may be
        // a millisecond's work and a timer's turn is four, so the thread is
        // handed back once the computer has held it for a frame's length, and
        // not at every step.
        breathe: () => this.breathe(seat),
      }, policy, new Rng(`${spec.seed}:${seat}`), {
        prefer: spec.scenario.edges ? [`edge:${spec.scenario.edges[seat]}`] : [],
      });
      this.runners.push({ seat, driver, pumping: false, again: false, refusals: 0, asked: 0, shown: false });
      return driver;
    };
    // The computer's command is judged here so the driver has its verdict, and
    // then delivered as a second player's is.
    this.driver = seated(spec.bot, (cmd) => this.send(cmd), async (pool, label, kind) => {
      // The Part Die is the attacking page's own in a room and is announced by
      // nobody; every other roll is the room's, shown to both seats and marked
      // on the table as a player's page marks its own (match.ts sealedRoll).
      const quiet = 'black' in pool;
      const dice = await h.loop.roll(spec.bot, pool, label, kind ?? 'pool', quiet);
      if (!quiet) this.send({ kind: 'noteRoll', seat: spec.bot, what: label });
      return dice;
    });
    const page = h.page;
    if (spec.watch && page) {
      this.player = seated(spec.human, (cmd) => (this.stopped ? { ok: false, why: 'The table has been taken down.' } : page.send(cmd)),
        (pool, label, kind) => ('black' in pool ? h.loop.roll(spec.human, pool, label, 'pool', true) : page.roll(pool, label, kind ?? 'pool')));
    }
    for (const r of this.runners) r.driver.deal(hands[r.seat] ?? []);
  }

  private send(cmd: Command): CheckResult {
    if (this.stopped) return { ok: false, why: 'The table has been taken down.' };
    const v = check(this.h.data, this.h.state(), cmd);
    if (!v.ok) return v;
    this.h.loop.deliver(cmd, this.spec.bot);
    this.landed(cmd);
    // A second computer seat (a watched game) may be the one this answers.
    if (this.runners.length > 1) this.wake();
    return v;
  }

  // Every seat here is told of every command that lands, its own included; and
  // a line whose attack has just closed is told what it did.
  private landed(cmd: Command): void {
    for (const r of this.runners) r.driver.observe(cmd);
    if (this.before.size) this.settle();
  }

  // Begins: the computer hears of every command the page performs, and is
  // asked what it owes.
  start(): void {
    this.h.loop.onPublished((cmd) => {
      if (this.stopped) return;
      this.landed(cmd);
      this.wake();
    });
    const every = this.h.heartbeatMs ?? 1500;
    if (every > 0) this.beat = setInterval(() => this.wake(), every);
    this.wake();
  }

  // Takes the computer out of its seat for good (the page is leaving).
  stop(): void {
    this.stopped = true;
    if (this.beat !== undefined) clearInterval(this.beat);
    this.h.loop.onPublished(null);
    for (const r of this.release.splice(0)) r();
  }

  get paused(): boolean {
    return this.held;
  }

  // The computer waits where it is, an answer it was about to give included.
  pause(): void {
    if (this.held) return;
    this.held = true;
    for (const r of this.runners) this.h.status?.(r.seat, null);
    this.h.changed();
  }

  resume(): void {
    if (!this.held) return;
    this.held = false;
    for (const r of this.release.splice(0)) r();
    this.h.changed();
    this.wake();
  }

  // After a stop the player has read: the computer is asked again, and an
  // answer that was refused is not given a second time.
  retry(): void {
    this.trouble = null;
    for (const r of this.runners) r.refusals = 0;
    this.h.changed();
    this.wake();
  }

  // The last things the computer decided, newest last, for a report.
  get log(): LogEntry[] {
    return this.driver.log;
  }

  // What the page's Thinking tab may show, newest last (`thoughtsFor`).
  thinking(): Thought[] {
    return thoughtsFor(this.thoughts, this.h.state(), { watch: this.spec.watch, bot: this.spec.bot });
  }

  // An answer being given, told as its commands go to the table: the line
  // appears as the board shows it.
  private chose(seat: Side, d: Decision, o: Option): void {
    if (!worthAThought(d, o)) return;
    const state = this.h.state();
    // The unit the question is about, or the one the answer puts down.
    const uid = d.unit ?? (typeof o.facts?.uid === 'number' ? o.facts.uid : undefined);
    const unit = uid === undefined ? undefined : state.tokens.find((t) => t.uid === uid)?.label;
    // (Setting the table up is no round's: the Thinking tab files it under Setup.)
    const setup = d.kind.startsWith('setup.');
    const n = ++this.thoughtN;
    this.thoughts.push({
      n, seat, round: setup ? 0 : state.round?.n ?? 0, phase: setup ? 0 : state.round?.phase ?? 0, kind: d.kind, option: o.id,
      ...(unit ? { unit } : {}), label: o.label, given: null,
    });
    this.before.set(n, marksOf(state));
    if (this.thoughts.length > THOUGHTS) this.before.delete(this.thoughts.shift()!.n);
    this.h.thought?.();
  }

  // WHAT A LINE DID, once it is over: what changed for each unit since it was
  // chosen. An attack is over when its window closes (the attacker takes its
  // published picture down; an Electronic Counter-roll, its record), so a line
  // given while one is open waits; a line not yet given, or refused, has done
  // nothing.
  private settle(): void {
    const script = this.h.state().script;
    if (script?.combatView || script?.counter) return;
    let now: Marks | null = null;
    let told = false;
    for (const [n, was] of this.before) {
      const t = this.thoughts.find((x) => x.n === n);
      if (t?.given === null) continue;
      this.before.delete(n);
      if (t?.given !== 'done') continue;
      now ??= marksOf(this.h.state());
      const result = resultOf(was, now);
      if (result.length) { t.result = result; told = true; }
    }
    if (told) this.h.thought?.();
  }

  // And what became of it: given, refused by the table, or never given (the
  // question changed while the computer took its moment).
  private gave(seat: Side, given: 'done' | 'refused' | null, option?: string): void {
    let at = this.thoughts.length - 1;
    while (at >= 0 && !(this.thoughts[at].seat === seat && this.thoughts[at].given === null)) at -= 1;
    if (at < 0 || (option !== undefined && this.thoughts[at].option !== option)) return;
    if (given) this.thoughts[at].given = given;
    else this.before.delete(this.thoughts.splice(at, 1)[0].n);
    this.h.thought?.();
    if (given) this.settle();
  }

  wake(): void {
    if (this.stopped || this.held || this.trouble || this.over) return;
    for (const r of this.runners) {
      if (r.pumping) { r.again = true; continue; }
      r.pumping = true;
      void this.pump(r);
    }
  }

  private halt(seat: Side, kind: 'refused' | 'stuck', why: string): void {
    this.trouble = { seat, kind, why };
    this.h.halted?.(seat, kind, why);
    for (const r of this.runners) this.h.status?.(r.seat, null);
    this.h.changed();
  }

  // One decision after another until the seat is asked nothing. Only one of
  // these runs for a seat at a time; a command that lands meanwhile asks for
  // another look once it ends.
  private async pump(r: Runner): Promise<void> {
    try {
      for (;;) {
        r.again = false;
        if (this.stopped || this.held || this.trouble || this.over) return;
        const rolled = this.h.state().script?.rollbacks ?? 0;
        if (rolled !== this.rollbacks) {
          this.rollbacks = rolled;
          for (const x of this.runners) x.driver.forget();
        }
        r.asked = performance.now();
        r.shown = false;
        const step = await r.driver.step();
        if (this.stopped) return;
        if (step.kind === 'acted') this.gave(r.seat, 'done', step.option.id);
        else if (step.kind === 'refused') this.gave(r.seat, 'refused', step.option.id);
        else if (step.kind === 'moot') this.gave(r.seat, null);
        if (step.kind === 'acted' || step.kind === 'refused') {
          const entry = r.driver.log.at(-1);
          if (entry) this.h.decided?.(r.seat, entry);
        }
        if (step.kind === 'acted') {
          r.refusals = 0;
          const unit = step.decision.unit;
          const who = unit === undefined ? undefined : this.h.state().tokens.find((t) => t.uid === unit)?.label;
          const line = whyLine(step.decision, step.option, r.driver.log.at(-1)?.reason, who);
          if (line) this.h.told?.(r.seat, line);
          continue;
        }
        if (step.kind === 'moot') continue;
        if (step.kind === 'over') {
          if (!this.over) {
            this.over = true;
            for (const x of this.runners) this.h.status?.(x.seat, null);
            this.h.ended?.();
            this.h.changed();
          }
          return;
        }
        if (step.kind === 'refused') {
          // An answer the table would not take is not given again (the driver
          // remembers), so the next look picks another. Three in a row and the
          // player is told instead.
          console.warn(`the computer's "${step.option.label}" was refused: ${step.why}`);
          r.refusals += 1;
          if (r.refusals < 3) continue;
          this.halt(r.seat, 'refused', step.why);
          return;
        }
        if (step.kind === 'stuck') {
          this.halt(r.seat, 'stuck', step.why);
          return;
        }
        // Idle: it is another seat's move, unless something landed while it looked.
        this.h.status?.(r.seat, null);
        if (!r.again) return;
      }
    } catch (err) {
      if (!(err instanceof Stopped)) {
        console.error(err);
        this.halt(r.seat, 'stuck', err instanceof Error ? err.message : String(err));
      }
    } finally {
      r.pumping = false;
      if (r.again && !this.stopped) queueMicrotask(() => this.wake());
    }
  }

  private sleep(ms: number): Promise<void> {
    if (this.h.sleep) return this.h.sleep(ms);
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  private scale(): number {
    if (this.spec.watch) return WATCH_SCALE[this.speed] ?? WATCH_SCALE.normal;
    return SPEEDS.find((x) => x.id === this.speed)?.scale ?? 1;
  }

  // The moment before an answer. A pause holds the answer too, and a table
  // taken down takes it back.
  // `think` is the time the answer took to choose, which is part of the
  // moment, not added to it: on a slow machine the thought is the wait, and
  // what is left of it is a beat, for the page to say what the computer is
  // doing before it does it.
  private async pace(seat: Side, d: Decision, o: Option, think = 0): Promise<void> {
    this.h.status?.(seat, doing(d, o));
    const [lo, hi] = thinkMs(d, o);
    // Never the computer's own stream: the spread is how the wait feels, not a
    // part of the game.
    const wait = (lo + Math.random() * (hi - lo)) * this.scale();
    await this.sleep(Math.max(BEAT_MS * this.scale(), wait - think));
    while (this.held && !this.stopped) await new Promise<void>((resolve) => { this.release.push(resolve); });
    if (this.stopped) throw new Stopped();
  }

  // The table at rest after an answer: a walk watched to its end, then a beat.
  private async rest(d: Decision, o: Option): Promise<void> {
    for (let i = 0; i < 240 && this.h.walking() && !this.stopped; i++) await this.sleep(50);
    await this.sleep(restMs(d, o) * this.scale());
  }
}

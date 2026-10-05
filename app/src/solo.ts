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
import { brawlerPolicy } from './ai/brawler';
import { eagerPolicy } from './ai/eager';
import { legalPolicy } from './ai/legal';
import { tacticianPolicy } from './ai/tactician';
import { recruitPolicy, veteranPolicy } from './ai/levels';
import type { Policy } from './ai/policy';
import { Rng } from './ai/rng';
import type { LoopbackRelay } from './loopback';
import { newSalt, sealTactic } from './secrecy';
import { handCommand, type HeldCard } from './tactichand';
import { RIVAL, SOLO_OWN, SPEEDS, type SoloOwn, type Speed } from './soloask';
import type { Decision, Option } from './seat';
import { mapConfig, missionConfig } from './tableconfig';
import { PHASES, type GameState, type Side } from './types';

// ---------- what the address asks for ----------

// The speeds and the address itself are soloask.ts's, which a page that only
// offers a game imports alone.
export { ownGame, RIVAL, RIVALS, SOLO_OWN, SOLO_OWN_KEY, SPEEDS, soloAsk, soloQuery, type SoloOwn, type Speed } from './soloask';

// Who sits in the other seat. The plan's opponents arrive here by name. The
// TACTICIAN is the one a game is played against (soloask.ts RIVAL): it weighs
// every answer in Victory Points, the mission and what could be done to it
// included; it is the ACE of the three levels a player may pick (M9.1, ai/
// levels.ts), beside the VETERAN (the Tactician without its look ahead) and the
// RECRUIT (the Brawler, making mistakes). The BRAWLER is the one it was built
// to beat, kept to be played against beside it: it takes the best attack its
// odds offer and walks at whatever it cannot yet reach. The other two are for
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
  // The player's own seat is played by a computer too, and the player watches.
  watch: boolean;
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
  return { scenario, squads, human, bot: other(human), seed, speed, opponent, watch: ask.watch === '1' };
}

// What the host sends to set the table before either seat is taken: the
// battlefield, the Main Task with its zones and Task items (tableconfig.ts, as
// the lobby sends them), the game's length, both squads and the hands they
// bring (`soloHands`), the start, and the battlefield locked, since the
// scenario chose it (3.1.2). The squads are the spec's: a shipped game's by
// default.
export function soloSetup(data: GameData, scenario: SoloScenario, squads?: Record<Side, SoloSquad>, hands: Command[] = []): Command[] {
  const out: Command[] = [
    { kind: 'configureTable', seat: 's1', ...mapConfig(data, scenario.map, null) },
    { kind: 'configureTable', seat: 's1', ...missionConfig(data, scenario.map, scenario.mission) },
    { kind: 'configureTable', seat: 's1', roundLimit: scenario.rounds, ...(scenario.secondaries === false ? { noSecondary: true } : {}) },
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
  take_cover: 'out of the enemy\'s sights', movement_unlocks_better_target: 'to reach a better target',
  reposition_opening: 'to find something to attack', intent_opening: 'to attack',
  // What it does.
  attack_value: 'its best attack', attack_result_value: 'its best attack', attack_revealed: 'at the unit its Scan found',
  launch_value: 'where it does most', projectile_blast_value: 'where it does most', blast_value: 'where it does most',
  jam_value: 'to jam the enemy', support_value: 'to keep its squad going', overwatch_value: 'to lend a shot',
  patch_value: 'to mend an ally next round', spotter_value: 'to call in a shot',
  stance_by_value: 'for what that Stance lets it do', preparation_unlocks_attack: 'to open an attack',
  charge_for_attack: 'to charge a Part for its attack', smoke_for_cover: 'to hide behind it',
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
  const round = state.round?.n ?? 0;
  const phase = state.round?.phase ?? 0;
  const planning = PHASES.indexOf('Planning');
  return log.filter((e) => {
    if (e.kind === 'planning.dial') return e.round < round || (e.round === round && phase > planning);
    if (e.kind === 'planning.commit' || e.kind === 'setup.secondary' || e.kind.startsWith('setup.designate')) return false;
    if (e.kind === 'tactic.after' || e.kind === 'tactic.end') return e.option.startsWith('tactic:');
    return true;
  }).map((e) => ({ ...e }));
}

// How long the computer may hold the page's thread before it hands it back in
// the middle of a decision: under one drawn frame, so nothing on the page is
// seen to stop.
const FRAME_MS = 12;

// One computer seat and the loop that keeps asking it.
interface Runner {
  seat: Side;
  driver: Driver;
  pumping: boolean;
  again: boolean;
  refusals: number;
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

  // THE PAGE'S THREAD, handed back to it in the middle of a decision: at once
  // while the computer has held it for less than a frame, and by a timer's
  // turn once it has.
  private breathe(): Promise<void> {
    if (performance.now() - this.breathed < FRAME_MS) return Promise.resolve();
    return new Promise<void>((done) => { setTimeout(() => { this.breathed = performance.now(); done(); }, 0); });
  }

  // `hands` is each computer seat's hand as `soloHands` dealt it.
  constructor(private readonly h: SoloHost, readonly spec: SoloSpec, hands: SoloHands['held'] = {}) {
    this.speed = spec.speed;
    const { data } = h;
    const policy = OPPONENTS[spec.opponent].policy;
    const seated = (seat: Side, send: (cmd: Command) => CheckResult, roll: Host['roll']): Driver => {
      const driver = new Driver(seat, {
        data,
        state: () => h.state(),
        send,
        roll,
        pace: (d, o) => this.pace(seat, d, o),
        settled: (d, o) => this.rest(d, o),
        // A long decision is worked out in steps, and the page has its thread
        // back between them: a frame is drawn, a click is heard. A step may be
        // a millisecond's work and a timer's turn is four, so the thread is
        // handed back once the computer has held it for a frame's length, and
        // not at every step.
        breathe: () => this.breathe(),
      }, policy, new Rng(`${spec.seed}:${seat}`), {
        prefer: spec.scenario.edges ? [`edge:${spec.scenario.edges[seat]}`] : [],
      });
      this.runners.push({ seat, driver, pumping: false, again: false, refusals: 0 });
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

  // Every seat here is told of every command that lands, its own included.
  private landed(cmd: Command): void {
    for (const r of this.runners) r.driver.observe(cmd);
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
        const step = await r.driver.step();
        if (this.stopped) return;
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
    return SPEEDS.find((x) => x.id === this.speed)?.scale ?? 1;
  }

  // The moment before an answer. A pause holds the answer too, and a table
  // taken down takes it back.
  private async pace(seat: Side, d: Decision, o: Option): Promise<void> {
    this.h.status?.(seat, doing(d, o));
    const [lo, hi] = thinkMs(d, o);
    // Never the computer's own stream: the spread is how the wait feels, not a
    // part of the game.
    await this.sleep((lo + Math.random() * (hi - lo)) * this.scale());
    while (this.held && !this.stopped) await new Promise<void>((resolve) => { this.release.push(resolve); });
    if (this.stopped) throw new Stopped();
  }

  // The table at rest after an answer: a walk watched to its end, then a beat.
  private async rest(d: Decision, o: Option): Promise<void> {
    for (let i = 0; i < 240 && this.h.walking() && !this.stopped; i++) await this.sleep(50);
    await this.sleep(restMs(d, o) * this.scale());
  }
}

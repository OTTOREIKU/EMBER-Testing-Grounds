// THE ELECTRONIC COUNTER-ROLL'S ANSWERS (rulebook 4.11).
//
// The one interaction where both players roll and both may spend Link, so it
// cannot be driven from one chair: each seat submits its own faces for its own
// unit, and both clients derive the verdict from `resolveCounterRoll`. The
// record is shared state (`script.counter`), and every press on the window
// that draws it is a question one of the two seats owns, so it travels as a
// command. This is the one sender of those commands.
//
// It lived in matchhud.ts (contestAct) and sent through the page. A computer
// seat answers the same questions with no page, so it is here, the Match
// Centre calls it, and the two cannot come to send different things for the
// same press (AI-OPPONENT-PLAN.md, rule R3). Every comment below came across
// with the line it explains.
import type { EwAct, EwArg } from './combat';
import type { CheckResult, Command } from './commands';
import type { GameData } from './data';
import { normaliseTasks, TERMINAL_EV, TERMINAL_UID, terminalStandIn } from './tasks';
import { actionOf } from './turn';
import { statusCount, zonesOf } from './types';
import type { CounterRoll, DiceData, GameState, Side, Token } from './types';
import { counterOffensive, electronicStrength, ewWinCommands, focusIsFree, resolveCounterRoll, tallyCounter } from './units';

export interface ContestEnv {
  data: GameData;
  state: GameState;
  // The seat sending: its own on a shared table.
  seat: Side;
  // Sends one command as this seat.
  send: (cmd: Command) => CheckResult;
  // `n` Yellow dice from the table's dice source, told to the table as `label`.
  rollHits: (n: number, label: string) => Promise<{ dice: { face: number }[] }>;
  // Told to the player: a refusal (the default), something done, or the dice
  // source failing.
  say?: (text: string, kind?: 'refused' | 'done' | 'system') => void;
  // Called once a press has been dealt with, so a page can redraw.
  done?: () => void;
}

// THE READING OF A COUNTER-ROLL, before a die is thrown: how many Yellow dice
// each side would be dealt (the pool `roll` deals below), and what each face
// of a die comes to for that side, its hollow faces counted only where it is
// treated as Offensive (4.11.2). For whoever wants the odds of one
// (ai/odds.ts): the arithmetic of dice is done there, and nothing there knows
// an Electronic Value or a Stance. The verdict on two hands is `counterVerdict`.
// Null where either unit is not on the table, or with no dice to read.
export interface CounterHand { dice: number; faces: { lightning: number; light: number }[] }
export interface CounterReading { init: CounterHand; resp: CounterHand }
export function counterReading(data: GameData, state: GameState, initUid: number, respUid: number, actionId: string): CounterReading | null {
  const dice = data.dice as unknown as DiceData | null;
  const init = state.tokens.find((x) => x.uid === initUid);
  const resp = state.tokens.find((x) => x.uid === respUid);
  if (!dice?.dice?.yellow?.faces?.length || !init || !resp) return null;
  const hand = (t: Token, other: Token, role: 'initiator' | 'responder'): CounterHand => {
    const offensive = counterOffensive(data, state.tokens, t, other, role);
    return {
      dice: role === 'initiator' ? electronicStrength(data, state.tokens, t, role, actionOf(data, state, t, actionId)) : electronicStrength(data, state.tokens, t, role),
      faces: dice.dice.yellow.faces.map((_f, i) => tallyCounter(dice, [i], offensive)),
    };
  };
  return { init: hand(init, resp, 'initiator'), resp: hand(resp, init, 'responder') };
}
export const counterVerdict = resolveCounterRoll;

// The record's Responder: a unit, or for a Remote Access the Terminal's
// stand-in, placed where its token stands (ruling I25).
export function counterResponder(data: GameData, state: GameState, c: CounterRoll, init: Token | undefined): Token | undefined {
  if (c.terminal === undefined) return state.tokens.find((x) => x.uid === c.responderUid);
  const item = normaliseTasks(state.tasks).items.find((i) => i.id === c.terminal);
  if (!item || !init) return undefined;
  const name = zonesOf(data.zoneData.zones, state).find((z) => z.id === item.zone)?.name ?? item.zone;
  return terminalStandIn(item, init.side, name);
}

// Every press the window can make, answered in one place. Each is a question
// one of the two seats owns, so it travels as a command.
export function contestAct(env: ContestEnv, act: EwAct, arg?: EwArg): void {
  const { data, state: s, send } = env;
  const say = env.say ?? (() => {});
  const done = env.done ?? (() => {});
  const c = s.script?.counter;
  if (!c) return;
  const init = s.tokens.find((x) => x.uid === c.initiatorUid);
  const resp = counterResponder(data, s, c, init);
  if (!init || !resp) { send({ kind: 'clearCounterRoll', seat: env.seat }); done(); return; }
  // The Terminal's hand is the opponent's to roll, as a table command: no
  // unit on the board is it, and it never Focuses (ruling I25).
  if (act === 'roll' && arg?.uid === TERMINAL_UID && c.terminal !== undefined) {
    void env.rollHits(TERMINAL_EV, `rolls ${TERMINAL_EV} for the ${resp.label}`).then((res) => {
      const v = send({ kind: 'rollTerminal', seat: env.seat, faces: res.dice.map((d) => d.face) });
      if (!v.ok && v.why) say(v.why);
      done();
    }).catch(() => {
      say('The server did not answer the roll. Press it again.', 'system');
      done();
    });
    return;
  }
  const unit = arg?.uid !== undefined ? s.tokens.find((x) => x.uid === arg.uid) : undefined;
  if (act === 'roll' && unit) {
    // electronicStrength, not electronicValue: the Initiator's Tarantula Loads
    // (FAQ O5) and the EW Suppression aura of ZHDR-202_B / PDTR-202_B both ride
    // on the pool, and rolling the printed stat drops them. So would an
    // Action's Strength +X, the Initiator's only (audit Phase 3, D2), though
    // no card prints one since the 2026-09-28 list ruling retired Scream's.
    const ev = unit.uid === init.uid
      ? electronicStrength(data, s.tokens, unit, 'initiator', actionOf(data, s, init, c.actionId))
      : electronicStrength(data, s.tokens, unit, 'responder');
    void env.rollHits(ev, `rolls ${ev} for the Electronic Counter-roll`).then((res) => {
      send({ kind: 'rollCounter', seat: unit.side, uid: unit.uid, faces: res.dice.map((d) => d.face) });
      done();
    }).catch(() => {
      say('The server did not answer the roll. Press it again.', 'system');
      done();
    });
    return;
  }
  if (act === 'declare' && unit) {
    // FAQ G4: the declare travels on its own and pays the Link on arrival, so
    // the reroll after it - and any retry of that reroll - costs nothing more.
    const v = send({
      kind: 'declareCounterFocus', seat: unit.side, uid: unit.uid, use: !!arg?.use,
      ...(arg?.whistleUid !== undefined ? { whistleUid: arg.whistleUid } : {}),
    });
    if (!v.ok && v.why) say(v.why);
    done();
    return;
  }
  if (act === 'focus' && unit) {
    // THE PLAYER'S CHOICE OF WHICH DICE (4.10: "reroll any Dice in that roll").
    // The old panel rerolled the whole pool, which is a different and more
    // generous rule than the one printed.
    const had = unit.uid === init.uid ? c.initRoll : c.respRoll;
    const idx = (arg?.indices ?? []).filter((i) => had && i >= 0 && i < had.length);
    if (!had) return;
    // Keeping the roll closes this side's reroll turn with the faces it had.
    if (!idx.length) {
      send({ kind: 'rollCounter', seat: unit.side, uid: unit.uid, faces: had.slice(), focused: true });
      done();
      return;
    }
    // The Link was paid at the declare. It used to be spent HERE, and a retry
    // after a server that did not answer spent it a second time.
    void env.rollHits(idx.length, focusIsFree(data, unit)
      ? 'Focuses the Counter-roll for free (Will to Survive)'
      : 'Focuses the Counter-roll').then((res) => {
      const faces = had.slice();
      idx.forEach((at, k) => { const f = res.dice[k]?.face; if (f !== undefined) faces[at] = f; });
      send({ kind: 'rollCounter', seat: unit.side, uid: unit.uid, faces, focused: true });
      done();
    }).catch(() => {
      say('The server did not answer the Focus reroll. Press it again: the Link is already paid, and a retry costs nothing more.', 'system');
      done();
    });
    return;
  }
  if (act === 'provoke' || act === 'provokepass') {
    // Yoyu is whichever side the window named: it Provokes in either role
    // (4.11.2; audit Phase 3, F16). An older press names nobody, and meant the
    // Responder, which was the only role it used to have.
    const take = act === 'provoke';
    const yoyu = arg?.uid === init.uid ? init : resp;
    const other = yoyu === init ? resp : init;
    const verdict = send({ kind: 'provoke', seat: yoyu.side, uid: yoyu.uid, targetUid: other.uid, take });
    say(verdict.ok
      ? take
        ? `${yoyu.label} provokes ${other.label} into Offensive Stance (LPA-22 Yoyu).`
        : `${yoyu.label} leaves ${other.label}'s Stance alone.`
      : `${yoyu.label} cannot provoke ${other.label}: ${verdict.why}`, verdict.ok ? 'done' : 'refused');
    done();
    return;
  }
  if (act === 'apply') {
    const a = actionOf(data, s, init, c.actionId);
    // On a shared table the combat window's applyEffects NEVER RUNS (the
    // verdict is derived, nobody presses Resolve), so the Initiator's seat
    // sends the effects from here, through the reading every seam shares
    // (ewWinCommands). This copy used to find the first top-level status and
    // fall back to Fire Control Interference, so Manipulation Interference gave
    // FCI instead of Immobilized and Scream, The Red Shoes and Overload Inject
    // gave FCI too (audit Phase 3, D1). A Scan strips Low Profile and owes a
    // camouflaged target its Manifestation, with the free Scan's attack queued
    // behind it (FAQ I12); Target Tracing drains 1 Link, and the record says
    // it was the reaction because its Command Token is already spent.
    if (!a) { send({ kind: 'clearCounterRoll', seat: init.side }); done(); return; }
    const win = ewWinCommands(data, init, resp, a, { reaction: !!c.reaction, thenAttack: c.thenAttack, terminal: c.terminal });
    let won = true;
    for (const cmd of win.cmds) won = send(cmd).ok && won;
    if (won) say(win.lines.length
      ? `${init.label} succeeds: ${win.lines.join('; ')}.`
      : `${init.label} succeeds, and ${a.name?.en || a.id} has nothing this table can apply: follow the card.`, 'done');
    send({ kind: 'clearCounterRoll', seat: init.side });
    done();
    return;
  }
  if (act === 'close') {
    // A free Scan that was not applied ends the attack that earned it (FAQ
    // I11): the Tick is spent, the remaining Ticks are not. Said by whoever
    // closes the window, once, and only when no attack was queued behind it.
    // A Multi-Target's extra designation queues none: its applied Scan owes
    // the Reveal alone, and a failed one drops only that designation (ruled
    // R3; audit Phase 7, P7C 4).
    const owed = s.script?.reactions ?? [];
    const applied = c.thenAttack?.extra
      ? owed.some((r) => r.kind === 'manifest' && r.uid === resp.uid) || statusCount(resp.statuses, 'camouflage') === 0
      : owed.some((r) => r.kind === 'scanAttack' && r.uid === init.uid);
    // Only the Initiator's seat closes it until the Initiator has lost (ruled
    // R3; audit Phase 7, P7D 1), so the line waits for the close to land.
    const closed = send({ kind: 'clearCounterRoll', seat: env.seat });
    if (!closed.ok) {
      if (closed.why) say(closed.why);
    } else if (c.thenAttack && !applied) {
      say(c.thenAttack.extra
        ? `${init.label}'s Scan was not applied, so its attack cannot designate ${resp.label}. Its other targets stand (FAQ I11).`
        : `${init.label}'s Scan was not applied, so its attack on ${resp.label} ends. The Action Tick is spent; any remaining Ticks may still be used (FAQ I11).`, 'done');
    }
    done();
  }
}

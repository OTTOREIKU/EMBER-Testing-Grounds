// THE ELECTRONIC COUNTER-ROLL on the pad: the shared ElectronicHelper
// (combat.ts), mounted beside the attack window, driven the way the Match
// Centre drives it. A Guided game holds the exchange on `script.counter`, so
// both phones draw the one record and each presses only its own hand; a
// Freeform table has no record and runs the helper's own local exchange on
// the attacker's phone, the defender rolling across the table.
import type { RollGroup } from '../src/combat';
import type { Command } from '../src/commands';
import { ElectronicHelper, type EwAct, type EwArg } from '../src/combat';
import { contestAct as sendContestAct, counterResponder } from '../src/contest';
import { forSeat } from './attack';
import { tokenCards, loanedParts } from '../src/units';
import { TERMINAL_UID, terminalStandIn, type TaskItem } from '../src/tasks';
import { type CardAction, type DiceData, type GameState, type Side, type Token } from '../src/types';
import type { NoticeKind } from '../src/notices';
import type { GameData } from '../src/data';

export interface EwApi {
  data: GameData;
  state(): GameState;
  me(): Side;
  solo: boolean;
  inRoom(): boolean;
  send(cmd: Command): boolean;
  toast(text: string, kind?: NoticeKind): void;
  render(): void;
  openCombat(): void;
  closeCombat(): void;
  // Yellow dice as FACE indices - the table's, the server's or the pad's.
  // This used to borrow the first-player roll's helper, which answers in HIT
  // COUNTS, and sent those on as faces: a blank die (0 hits) became face 0,
  // the double Light Hit, so every Counter-roll on two phones read too strong.
  rollFaces(n: number, label: string, groups?: RollGroup[]): Promise<number[]>;
}

let api: EwApi | null = null;
let helper: ElectronicHelper | null = null;
let root: HTMLElement | null = null;

export function initEw(a: EwApi): void {
  api = a;
}

export function ewActive(): boolean {
  return !!helper?.active;
}

export function ewWatching(): boolean {
  return !!helper?.watching;
}

// The printed Action, or a common one (the free Scan is COMMON_SCAN).
function actionOf(t: Token, actionId: string): CardAction | undefined {
  const a = api!;
  return tokenCards(a.data, t).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === actionId)
    ?? a.data.commonActions.find((x) => x.id === actionId)
    // A lent Load's, the table having judged the Contact (FAQ O5).
    ?? loanedParts(a.data, a.state().tokens, t, { anywhere: true }).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === actionId);
}

export function mountEw(into: HTMLElement): ElectronicHelper | null {
  const a = api!;
  const dice = a.data.dice as unknown as DiceData | null;
  if (!dice) return null;
  root = into;
  if (helper) {
    helper.remount(into);
    return helper;
  }
  const h = new ElectronicHelper(
    a.data,
    dice,
    into,
    () => a.render(),
    () => { a.closeCombat(); a.render(); },
    () => {},
    // The local exchange (Freeform) applies its own effects through here, and
    // hears back whether each was taken. The Responder's Focus is the other
    // squad's command and travels inside an onBehalf (forSeat).
    (cmd) => a.send(forSeat(cmd)),
  );
  h.tokens = () => a.state().tokens;
  h.contestAct = (act, arg) => contestAct(act, arg);
  helper = h;
  return h;
}

// Opens the exchange. Guided: the command, and the record draws it on both
// phones. Freeform: the helper's own exchange, here.
// `joined`: a Guided game paid the Action in the same tap, so the exchange's
// opening chains to it for Undo.
export function beginElectronic(attacker: Token, actionId: string, defender: Token, joined = false): boolean {
  const a = api!;
  // Solo holds both hands on one phone, which is the local exchange's whole
  // shape; the shared record is for two phones.
  if (a.state().script && !a.solo) {
    return a.send({ kind: 'startCounterRoll', seat: attacker.side, uid: attacker.uid, actionId, targetUid: defender.uid, ...(joined ? { chain: 'join' as const } : {}) });
  }
  if (!root) return false;
  const h = mountEw(root);
  if (!h) { a.toast('No dice data loaded.', 'system'); return false; }
  const action = actionOf(attacker, actionId);
  if (!action) return false;
  h.roller = async (pool, label, groups) => (await a.rollFaces(pool.yellow ?? 0, label ?? 'Electronic Counter-roll', groups)).map((face) => ({ color: 'yellow', face }));
  h.start(attacker, action, defender);
  a.openCombat();
  return true;
}

// An Action on every enemy in Range (Scream, ZHDR-205_A; the Scan Battlefield,
// 080_A and 522_A): one Counter-roll per target the table judged in Range, in
// turn. In a room the command carries the rest and the record opens each as
// the last clears; on one phone the local exchange chains them (audit Phase 3,
// D2 and A4).
export function beginElectronicAll(attacker: Token, actionId: string, targets: Token[], joined = false): boolean {
  const a = api!;
  if (!targets.length) return false;
  if (a.state().script && !a.solo) {
    return a.send({
      kind: 'startCounterRoll', seat: attacker.side, uid: attacker.uid, actionId,
      targetUid: targets[0].uid, also: targets.slice(1).map((t) => t.uid), ...(joined ? { chain: 'join' as const } : {}),
    });
  }
  if (!root) return false;
  const h = mountEw(root);
  if (!h) { a.toast('No dice data loaded.', 'system'); return false; }
  const action = actionOf(attacker, actionId);
  if (!action) return false;
  h.roller = async (pool, label, groups) => (await a.rollFaces(pool.yellow ?? 0, label ?? 'Electronic Counter-roll', groups)).map((face) => ({ color: 'yellow', face }));
  const run = (i: number): void => {
    const target = a.state().tokens.find((x) => x.uid === targets[i]?.uid);
    if (!target) { if (i + 1 < targets.length) run(i + 1); return; }
    const by = a.state().tokens.find((x) => x.uid === attacker.uid) ?? attacker;
    a.openCombat();
    h.start(by, action, target, i + 1 < targets.length ? { after: () => run(i + 1) } : {});
  };
  run(0);
  return true;
}

// The free Scan on designating a camouflaged unit (FAQ I12). In a room the
// command carries the attack behind it, and a win queues the Reveal and the
// resumed attack through the shared reading (ewWinCommands). On one phone the
// local exchange Scans, and its win queues the same resumed attack here.
// `extra`: a Multi-Target's further designation, made from its split. Its win
// owes the Reveal alone, the split offering the unit once it has appeared, and
// a failure drops only that designation (ruled R3; audit Phase 7, P7C 4).
export function beginFreeScan(attacker: Token, attackId: string, defender: Token, joined = false, extra = false): boolean {
  const a = api!;
  if (a.state().script && !a.solo) {
    return a.send({
      kind: 'startCounterRoll', seat: attacker.side, uid: attacker.uid, actionId: 'COMMON_SCAN',
      targetUid: defender.uid, thenAttack: { actionId: attackId, ...(extra ? { extra: true } : {}) }, ...(joined ? { chain: 'join' as const } : {}),
    });
  }
  if (!root) return false;
  const h = mountEw(root);
  if (!h) { a.toast('No dice data loaded.', 'system'); return false; }
  const scan = a.data.commonActions.find((x) => x.id === 'COMMON_SCAN') as CardAction | undefined;
  if (!scan) return false;
  h.roller = async (pool, label, groups) => (await a.rollFaces(pool.yellow ?? 0, label ?? 'Electronic Counter-roll', groups)).map((face) => ({ color: 'yellow', face }));
  h.start(attacker, scan, defender, {
    then: (win) => {
      if (!win) {
        a.toast(extra
          ? `The Scan failed, so ${defender.label} cannot be designated by this attack. Its other targets stand (FAQ I11).`
          : `The Scan failed, so the attack on ${defender.label} ends. The Action Tick is spent (FAQ I11).`, 'warn');
        return;
      }
      if (!extra) a.send({ kind: 'queueReactions', seat: attacker.side, items: [{ uid: attacker.uid, actionId: attackId, count: 1, range: 0, kind: 'scanAttack', fromUid: defender.uid }] });
    },
  });
  a.openCombat();
  return true;
}

// A Detonation's Scan of a camouflaged target (p.71; audit Phase 5, A3): the
// Projectile is the Initiator and no attack rides behind it, the Explosion
// being the pad's own to resume once the Counter-roll has closed. In a room
// it goes to the table; alone, the local exchange runs it.
export function beginBlastScan(proj: Token, defender: Token): boolean {
  const a = api!;
  if (a.state().script && !a.solo) {
    return a.send({ kind: 'startCounterRoll', seat: proj.side, uid: proj.uid, actionId: 'COMMON_SCAN', targetUid: defender.uid });
  }
  if (!root) return false;
  const h = mountEw(root);
  if (!h) { a.toast('No dice data loaded.', 'system'); return false; }
  const scan = a.data.commonActions.find((x) => x.id === 'COMMON_SCAN') as CardAction | undefined;
  if (!scan) return false;
  h.roller = async (pool, label, groups) => (await a.rollFaces(pool.yellow ?? 0, label ?? 'Electronic Counter-roll', groups)).map((face) => ({ color: 'yellow', face }));
  h.start(proj, scan, defender, {});
  a.openCombat();
  return true;
}

// Remote Access against a Terminal (p.87; ruling I25). The Terminal's stand-in
// is the Responder: in a room the record draws it on both phones and the
// opponent's phone rolls the Terminal's dice (rollTerminal); on one phone the
// local exchange rolls both hands. Either way the dice come from rollFaces, so
// Table rolls enters them from the table like every other roll, and a win
// accesses the Terminal (ewWinCommands). The pages used to ask how a roll made
// off the page had gone (OTTO, 2026-09-28).
export function beginTerminal(attacker: Token, actionId: string, item: TaskItem, zoneName: string, joined = false): boolean {
  const a = api!;
  if (a.state().script && !a.solo) {
    return a.send({
      kind: 'startCounterRoll', seat: attacker.side, uid: attacker.uid, actionId,
      targetUid: TERMINAL_UID, terminal: item.id, ...(joined ? { chain: 'join' as const } : {}),
    });
  }
  if (!root) return false;
  const h = mountEw(root);
  if (!h) { a.toast('No dice data loaded.', 'system'); return false; }
  const action = actionOf(attacker, actionId);
  if (!action) return false;
  h.roller = async (pool, label, groups) => (await a.rollFaces(pool.yellow ?? 0, label ?? 'Electronic Counter-roll', groups)).map((face) => ({ color: 'yellow', face }));
  h.start(attacker, action, terminalStandIn(item, attacker.side, zoneName), { terminal: item.id });
  a.openCombat();
  return true;
}

// Target Tracing (174): "may spend 1 Command Token to perform an Electronic
// Counter Roll against the Attacker. If successful, the Attacker loses 1
// Link." In a room the command that opens the record spends the Token and
// marks the reaction; on one phone the local exchange runs it, the Token spent
// first by its own command and the Link carried on the exchange. Chained to
// the resolveReaction that cleared the debt, one tap and one Undo.
export function beginTrace(tracer: Token, actionId: string, attacker: Token): boolean {
  const a = api!;
  if (a.state().script && !a.solo) {
    return a.send({ kind: 'startCounterRoll', seat: tracer.side, uid: tracer.uid, actionId, targetUid: attacker.uid, reaction: true, chain: 'join' });
  }
  if (!root) return false;
  const h = mountEw(root);
  if (!h) { a.toast('No dice data loaded.', 'system'); return false; }
  const action = actionOf(tracer, actionId);
  if (!action) return false;
  if (!a.send({ kind: 'spendCommand', seat: tracer.side, uid: tracer.uid, chain: 'join' })) return false;
  h.roller = async (pool, label, groups) => (await a.rollFaces(pool.yellow ?? 0, label ?? 'Electronic Counter-roll', groups)).map((face) => ({ color: 'yellow', face }));
  h.start(tracer, action, attacker, { linkLoss: 1 });
  a.openCombat();
  return true;
}

// The shared record, drawn or torn down. Run on every render.
export function syncContest(): void {
  const a = api!;
  const s = a.state();
  const c = s.script?.counter ?? null;
  if (!c) {
    if (helper?.watching) { helper.closeContest(); a.closeCombat(); }
    return;
  }
  const init = s.tokens.find((t) => t.uid === c.initiatorUid);
  const resp = counterResponder(a.data, s, c, init);
  const action = init ? actionOf(init, c.actionId) : undefined;
  if (!init || !resp || !action) { if (helper?.watching) helper.closeContest(); return; }
  if (!root) { a.openCombat(); return; }
  const h = mountEw(root);
  if (!h) return;
  const seat = a.me();
  const role = seat === init.side ? 'initiator' : seat === resp.side ? 'responder' : 'spectator';
  h.showContest(c, init, resp, action, role);
  h.redraw();
  a.openCombat();
}

// Every press the window makes, as commands: the one sender the Match Centre
// and a computer seat use too (src/contest.ts), given the pad's own ways in.
// The pad kept a copy of it until the code audit (2026-10-12), which had
// drifted: it said nothing of a Provoke, of a win with nothing to apply, or of
// a free Scan's attack that ends with it (FAQ I11).
function contestAct(act: EwAct, arg?: EwArg): void {
  const a = api!;
  sendContestAct({
    data: a.data,
    state: a.state(),
    seat: a.me(),
    // The pad's send tells the player about a refusal itself.
    send: (cmd) => ({ ok: a.send(cmd) }),
    // Dice the server never answered come back empty, and the pad has said so.
    rollHits: async (n, label) => {
      const faces = await a.rollFaces(n, label);
      return faces.length === n ? { dice: faces.map((face) => ({ face })) } : null;
    },
    say: (text, kind) => a.toast(text, kind ?? 'refused'),
    done: () => a.render(),
    // A lent Load's Action wherever the carrier stands (FAQ O5).
    actionOf: (t, actionId) => actionOf(t, actionId),
    // The faces are asked for under the unit's own name.
    rollLabel: (unit, what) => `${unit.label}: ${what === 'focus' ? 'Focus reroll' : 'Electronic Counter-roll'}`,
    // The result and the close are one tap for Undo.
    chain: true,
  }, act, arg);
}

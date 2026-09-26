// THE ELECTRONIC COUNTER-ROLL on the pad: the shared ElectronicHelper
import type { RollGroup } from '../src/combat';
// (combat.ts), mounted beside the attack window, driven the way the Match
// Centre drives it. A Guided game holds the exchange on `script.counter`, so
// both phones draw the one record and each presses only its own hand; a
// Freeform table has no record and runs the helper's own local exchange on
// the attacker's phone, the defender rolling across the table.
import type { Command } from '../src/commands';
import { ElectronicHelper, type EwAct, type EwArg } from '../src/combat';
import { forSeat } from './attack';
import { electronicStrength, ewWinCommands, tokenCards } from '../src/units';
import { type CardAction, type DiceData, type GameState, type Side, type Token } from '../src/types';
import type { GameData } from '../src/data';

export interface EwApi {
  data: GameData;
  state(): GameState;
  me(): Side;
  solo: boolean;
  inRoom(): boolean;
  send(cmd: Command): boolean;
  toast(text: string): void;
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
    ?? a.data.commonActions.find((x) => x.id === actionId);
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
  if (!h) { a.toast('No dice data loaded.'); return false; }
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
  if (!h) { a.toast('No dice data loaded.'); return false; }
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
export function beginFreeScan(attacker: Token, attackId: string, defender: Token, joined = false): boolean {
  const a = api!;
  if (a.state().script && !a.solo) {
    return a.send({
      kind: 'startCounterRoll', seat: attacker.side, uid: attacker.uid, actionId: 'COMMON_SCAN',
      targetUid: defender.uid, thenAttack: { actionId: attackId }, ...(joined ? { chain: 'join' as const } : {}),
    });
  }
  if (!root) return false;
  const h = mountEw(root);
  if (!h) { a.toast('No dice data loaded.'); return false; }
  const scan = a.data.commonActions.find((x) => x.id === 'COMMON_SCAN') as CardAction | undefined;
  if (!scan) return false;
  h.roller = async (pool, label, groups) => (await a.rollFaces(pool.yellow ?? 0, label ?? 'Electronic Counter-roll', groups)).map((face) => ({ color: 'yellow', face }));
  h.start(attacker, scan, defender, {
    then: (win) => {
      if (!win) { a.toast(`The Scan failed, so the attack on ${defender.label} ends. The Action Tick is spent (FAQ I11).`); return; }
      a.send({ kind: 'queueReactions', seat: attacker.side, items: [{ uid: attacker.uid, actionId: attackId, count: 1, range: 0, kind: 'scanAttack', fromUid: defender.uid }] });
    },
  });
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
  if (!h) { a.toast('No dice data loaded.'); return false; }
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
  const resp = s.tokens.find((t) => t.uid === c.responderUid);
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

// Every press the window makes, as commands - the Match Centre's contestAct.
function contestAct(act: EwAct, arg?: EwArg): void {
  const a = api!;
  const s = a.state();
  const c = s.script?.counter;
  if (!c) return;
  const init = s.tokens.find((x) => x.uid === c.initiatorUid);
  const resp = s.tokens.find((x) => x.uid === c.responderUid);
  if (!init || !resp) { a.send({ kind: 'clearCounterRoll', seat: a.me() }); a.render(); return; }
  const unit = arg?.uid !== undefined ? s.tokens.find((x) => x.uid === arg.uid) : undefined;
  if (act === 'roll' && unit) {
    // The Initiator's pool carries its Action's Strength +X (Scream; audit
    // Phase 3, D2).
    const ev = unit.uid === init.uid
      ? electronicStrength(a.data, s.tokens, unit, 'initiator', actionOf(init, c.actionId))
      : electronicStrength(a.data, s.tokens, unit, 'responder');
    void a.rollFaces(ev, `${unit.label}: Electronic Counter-roll`).then((faces) => {
      if (faces.length !== ev) return;
      a.send({ kind: 'rollCounter', seat: unit.side, uid: unit.uid, faces });
      a.render();
    });
    return;
  }
  // ZPA-38 Firewatch, as the Match Centre sends it (audit Phase 2, D4).
  if (act === 'firewatch' && unit) {
    a.send({ kind: 'firewatch', seat: unit.side, uid: unit.uid });
    a.render();
    return;
  }
  if (act === 'declare' && unit) {
    // FAQ G4: the declare pays the Link on arrival (declareCounterFocus), so
    // the reroll after it costs nothing more, even asked for twice.
    // A Drone may pay its reroll with a Whistle's Command Token (ZYBP-202).
    a.send({
      kind: 'declareCounterFocus', seat: unit.side, uid: unit.uid, use: !!arg?.use,
      ...(arg?.whistleUid !== undefined ? { whistleUid: arg.whistleUid } : {}),
    });
    a.render();
    return;
  }
  if (act === 'focus' && unit) {
    const had = unit.uid === init.uid ? c.initRoll : c.respRoll;
    const idx = (arg?.indices ?? []).filter((i) => had && i >= 0 && i < had.length);
    if (!had) return;
    // Keeping the roll closes this side's reroll turn with the faces it had.
    if (!idx.length) {
      a.send({ kind: 'rollCounter', seat: unit.side, uid: unit.uid, faces: had.slice(), focused: true });
      a.render();
      return;
    }
    void a.rollFaces(idx.length, `${unit.label}: Focus reroll`).then((rolled) => {
      if (rolled.length !== idx.length) return;
      const faces = had.slice();
      idx.forEach((at, k) => { faces[at] = rolled[k]; });
      a.send({ kind: 'rollCounter', seat: unit.side, uid: unit.uid, faces, focused: true });
      a.render();
    });
    return;
  }
  if (act === 'provoke' || act === 'provokepass') {
    // Yoyu is whichever side the window named: either role (4.11.2; audit
    // Phase 3, F16). A press naming nobody meant the Responder.
    const yoyu = arg?.uid === init.uid ? init : resp;
    const other = yoyu === init ? resp : init;
    a.send({ kind: 'provoke', seat: yoyu.side, uid: yoyu.uid, targetUid: other.uid, take: act === 'provoke' });
    a.render();
    return;
  }
  if (act === 'apply') {
    const action = actionOf(init, c.actionId);
    // The result and the close are one tap: every command after the first
    // joins it for Undo (commands.ts CommandChain).
    let sent = 0;
    const join = () => (sent++ ? { chain: 'join' as const } : {});
    // The reading every seam shares (ewWinCommands). This copy used to find the
    // first top-level status and fall back to Fire Control Interference, so
    // Manipulation Interference gave FCI instead of Immobilized, and Scream,
    // The Red Shoes and Overload Inject gave FCI too; a free Scan's attack lost
    // its Charge (audit Phase 3, D1). Target Tracing is the record's own
    // `reaction`, its Command Token already spent.
    if (action) {
      const win = ewWinCommands(a.data, init, resp, action, { reaction: !!c.reaction, thenAttack: c.thenAttack });
      for (const cmd of win.cmds) a.send({ ...cmd, ...join() } as Command);
      if (win.lines.length) a.toast(`${init.label} succeeds: ${win.lines.join('; ')}.`);
    }
    a.send({ kind: 'clearCounterRoll', seat: init.side, ...join() });
    a.render();
    return;
  }
  if (act === 'close') {
    a.send({ kind: 'clearCounterRoll', seat: a.me() });
    a.render();
  }
}

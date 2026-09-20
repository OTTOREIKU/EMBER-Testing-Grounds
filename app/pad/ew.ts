// THE ELECTRONIC COUNTER-ROLL on the pad: the shared ElectronicHelper
import type { RollGroup } from '../src/combat';
// (combat.ts), mounted beside the attack window, driven the way the Match
// Centre drives it. A Guided game holds the exchange on `script.counter`, so
// both phones draw the one record and each presses only its own hand; a
// Freeform table has no record and runs the helper's own local exchange on
// the attacker's phone, the defender rolling across the table.
import type { Command } from '../src/commands';
import { ElectronicHelper, type EwAct } from '../src/combat';
import { electronicStrength, isScanAction, scanStrips, targetTracingOn, tokenCards } from '../src/units';
import { statusCount, STATUSES, type CardAction, type DiceData, type GameState, type Side, type Token } from '../src/types';
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
    // The local exchange (Freeform) applies its own effects through here.
    (cmd) => { a.send(cmd); },
  );
  h.tokens = () => a.state().tokens;
  h.contestAct = (act, arg) => contestAct(act, arg);
  helper = h;
  return h;
}

// Opens the exchange. Guided: the command, and the record draws it on both
// phones. Freeform: the helper's own exchange, here.
export function beginElectronic(attacker: Token, actionId: string, defender: Token): boolean {
  const a = api!;
  // Solo holds both hands on one phone, which is the local exchange's whole
  // shape; the shared record is for two phones.
  if (a.state().script && !a.solo) {
    return a.send({ kind: 'startCounterRoll', seat: attacker.side, uid: attacker.uid, actionId, targetUid: defender.uid });
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
function contestAct(act: EwAct, arg?: { uid?: number; indices?: number[] }): void {
  const a = api!;
  const s = a.state();
  const c = s.script?.counter;
  if (!c) return;
  const init = s.tokens.find((x) => x.uid === c.initiatorUid);
  const resp = s.tokens.find((x) => x.uid === c.responderUid);
  if (!init || !resp) { a.send({ kind: 'clearCounterRoll', seat: a.me() }); a.render(); return; }
  const unit = arg?.uid !== undefined ? s.tokens.find((x) => x.uid === arg.uid) : undefined;
  if (act === 'roll' && unit) {
    const ev = electronicStrength(a.data, s.tokens, unit, unit.uid === init.uid ? 'initiator' : 'responder');
    void a.rollFaces(ev, `${unit.label}: Electronic Counter-roll`).then((faces) => {
      if (faces.length !== ev) return;
      a.send({ kind: 'rollCounter', seat: unit.side, uid: unit.uid, faces });
      a.render();
    });
    return;
  }
  if (act === 'focus' && unit) {
    const had = unit.uid === init.uid ? c.initRoll : c.respRoll;
    const idx = (arg?.indices ?? []).filter((i) => had && i >= 0 && i < had.length);
    if (!had || !idx.length) return;
    if (!a.send({ kind: 'focus', seat: unit.side, uid: unit.uid })) { a.render(); return; }
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
    a.send({ kind: 'provoke', seat: resp.side, uid: resp.uid, targetUid: init.uid, take: act === 'provoke' });
    a.render();
    return;
  }
  if (act === 'apply') {
    const action = actionOf(init, c.actionId);
    if (action && isScanAction(action)) {
      const strip = scanStrips(resp);
      for (let i = 0; i < strip; i++) {
        a.send({ kind: 'removeStatus', seat: init.side, uid: init.uid, targetUid: resp.uid, statusId: 'lowProfile' });
      }
      if (statusCount(resp.statuses, 'camouflage') > 0) {
        a.send({
          kind: 'queueReactions', seat: init.side,
          items: [
            { uid: resp.uid, actionId: action.id, count: 1, range: 0, kind: 'manifest', fromUid: init.uid },
            ...(c.thenAttack ? [{ uid: init.uid, actionId: c.thenAttack.actionId, count: 1, range: 0, kind: 'scanAttack' as const, fromUid: resp.uid }] : []),
          ],
        });
      }
      a.send({ kind: 'clearCounterRoll', seat: init.side });
      a.render();
      return;
    }
    if (targetTracingOn(a.data, init)?.actionId === c.actionId) {
      a.send({ kind: 'drainLink', seat: init.side, uid: init.uid, targetUid: resp.uid, n: 1 });
    } else {
      const named = (action?.gameRules ?? []).flatMap((g) => g.effects ?? [])
        .find((e) => (e as { type?: string }).type === 'apply_status') as { status?: string; stacks?: number } | undefined;
      const def = STATUSES.find((x) => x.label === named?.status || x.id === named?.status) ?? STATUSES.find((x) => x.id === 'fci')!;
      a.send({ kind: 'applyStatus', seat: init.side, uid: init.uid, targetUid: resp.uid, statusId: def.id, stacks: named?.stacks ?? 1 });
    }
    a.send({ kind: 'clearCounterRoll', seat: init.side });
    a.render();
    return;
  }
  if (act === 'close') {
    a.send({ kind: 'clearCounterRoll', seat: a.me() });
    a.render();
  }
}

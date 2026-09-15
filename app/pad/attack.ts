// THE ATTACK WINDOW on the pad: the shared AttackHelper (combat.ts), the very
// window the board and the Match Centre draw, mounted in a panel on a phone.
//
// Nothing here restyles or re-implements it. What this module does is what
// match.ts does around the helper - answer its callbacks, publish its view for
// the other phone, mirror the other phone's view for the defender, and turn
// the defender's presses into commands - with one difference: the board's
// three positional verdicts (range and sight, Protection, back attack) are
// asked of the TABLE before the window opens, because the phone has no board
// to read them from.
import type { GameData } from '../src/data';
import type { Command, CheckResult } from '../src/commands';
import { AttackHelper, combatRoleFor, type MirrorAct } from '../src/combat';
import { grantAdjusted, kcArmorReady, multiTargetLimit, stationaryAdjusted, tokenCards, twoHandedUse } from '../src/units';
import type { CardAction, DiceData, DieColor, GameState, Side, Token } from '../src/types';
import type { RolledDie } from '../src/net';

export interface AttackApi {
  data: GameData;
  state(): GameState;
  me(): Side;
  solo: boolean;
  inRoom(): boolean;
  send(cmd: Command): boolean;
  check(cmd: Command): CheckResult;
  toast(text: string): void;
  render(): void;
  // The window's panel: shown while an attack is live here or mirrored here.
  openCombat(): void;
  closeCombat(): void;
  rollDice(pool: Record<string, number>, label?: string): Promise<RolledDie[]>;
}

// The table's answers to what the board used to read.
export interface TableVerdict {
  protection: 0 | 2;
  backAttack: boolean;
  // An Interception (4.9): line of sight is given, no arc, no Protection.
  intercept?: boolean;
  // Explosion damage from a detonating Projectile (4.7.6): no sight, no
  // facing, no Protection; only the defender may Focus.
  explosion?: boolean;
}

let api: AttackApi | null = null;
let helper: AttackHelper | null = null;
let root: HTMLElement | null = null;
// The defender's dice, owed to the attacker's window: the promise is resolved
// when the defender's answerDefense arrives.
let pendingDefense: ((faces: { color: DieColor; face: number; selected: boolean }[]) => void) | null = null;
// What was last published, so a redraw does not republish the same view.
let publishedKey = '';

// Whether the other phone takes part in this attack. The handshake commands
// (setCombatView, callDefense, the defender's answers) live on the script, so
// a Freeform table has no wire for them: there the attacker's phone presses
// both sides, as the one-screen board does, and the defender answers across
// the table. A Guided game has the script and gets the Match Centre's mirror.
function mirrored(): boolean {
  const a = api!;
  return a.inRoom() && !!a.state().script;
}

export function initAttack(a: AttackApi): void {
  api = a;
}

export function attackActive(): boolean {
  return !!helper?.active;
}

export function attackWatching(): boolean {
  return !!helper?.watching;
}

// The action as the window should see it: the stationary bonus, then the
// [condition] grants, then Two-Handed - the same order every other site uses.
function attackActionOf(t: Token, actionId: string): CardAction | undefined {
  const a = api!;
  const printed = tokenCards(a.data, t).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === actionId)
    ?? a.data.commonActions.find((x) => x.id === actionId);
  if (!printed) return undefined;
  const oppNow = a.state().script?.opp;
  const opp = oppNow?.uid === t.uid ? oppNow : null;
  const granted = grantAdjusted(stationaryAdjusted(printed, opp), t, opp);
  return twoHandedUse(a.data, t, granted)?.action ?? granted;
}

export function isAttackAction(a: CardAction): boolean {
  return a.type === 'Firing' || a.type === 'Melee';
}

async function rollDefensePool(white: number, blue: number): Promise<{ color: DieColor; face: number; selected: boolean }[]> {
  const a = api!;
  if (white <= 0 && blue <= 0) return [];
  const pool: Record<string, number> = {};
  if (white) pool.white = white;
  if (blue) pool.blue = blue;
  if (a.inRoom()) {
    const rolled = await a.rollDice(pool, 'Defence');
    return rolled.map((d) => ({ color: d.color as DieColor, face: d.face, selected: false }));
  }
  const dice = a.data.dice;
  return Object.entries(pool).flatMap(([c, n]) =>
    Array.from({ length: n }, () => ({ color: c as DieColor, face: Math.floor(Math.random() * (dice?.dice[c]?.sides ?? 6)), selected: false })),
  );
}

// Builds the helper once and keeps it: an attack in progress lives in this
// object's memory and nowhere on the wire, so a redraw remounts rather than
// rebuilds.
export function mountAttack(into: HTMLElement): AttackHelper | null {
  const a = api!;
  const dice = a.data.dice as unknown as DiceData | null;
  if (!dice) return null;
  root = into;
  if (helper) {
    helper.remount(into);
    return helper;
  }
  const h = new AttackHelper(
    a.data,
    dice,
    into,
    () => a.render(),
    () => {
      if (pendingDefense && a.state().script?.combat) {
        pendingDefense = null;
        a.send({ kind: 'clearDefense', seat: a.me() });
      }
      a.closeCombat();
      a.render();
    },
    () => {},
    // Forced Movement is the table's to carry out; the sheet says so.
    (_attacker, defender, _action, hits) => {
      if (hits > 0) a.toast(`${defender.label}: Knockback, settle it on the table.`);
    },
    (killer, victim, what) => {
      a.send({ kind: 'recordKill', seat: killer.side, uid: killer.uid, targetUid: victim.uid, what });
    },
    () => {},
    (cmd) => { a.send(cmd); },
  );
  h.tokens = () => a.state().tokens;
  // No terrain and no smoke: every position-aware bonus that reads them is
  // null-guarded in the helper and stays off.
  h.noBoard = true;
  h.publishView = (view) => {
    if (!mirrored()) return;
    const key = JSON.stringify(view);
    if (key === publishedKey) return;
    // Marked before the send: the send redraws the pad, and a redraw must find
    // this view already published.
    const before = publishedKey;
    publishedKey = key;
    if (!a.send({ kind: 'setCombatView', seat: a.me(), view })) publishedKey = before;
  };
  h.mirrorAct = (act, arg) => mirrorAct(act, arg);
  h.focusRemote = (defender) => mirrored() && defender.side !== a.me();
  // A reaction the attack earned the defender (Emergency Smoke, Defense
  // Reaction, Riposte, Target Tracing). A scripted game owes it on the record
  // and the turn strip asks; a free table is told.
  h.onReaction = (defender, reaction, attacker) => {
    if (a.state().script) {
      a.send({
        kind: 'queueReactions', seat: a.me(),
        items: [reaction.smoke
          ? { uid: defender.uid, actionId: reaction.actionId, count: reaction.smoke.count, range: reaction.smoke.range, kind: 'smoke' as const }
          : reaction.stance
            ? { uid: defender.uid, actionId: reaction.actionId, count: 0, range: 0, kind: 'stance' as const }
            : reaction.riposte
              ? { uid: defender.uid, actionId: reaction.actionId, count: 0, range: 0, kind: 'riposte' as const, fromUid: attacker.uid }
              : { uid: defender.uid, actionId: reaction.actionId, count: 0, range: 0, kind: 'trace' as const, fromUid: attacker.uid }],
      });
    } else {
      a.toast(`${defender.label} may react: ${reaction.name}.`);
    }
    a.render();
  };
  h.defenseRoller = (pool, attacker, defender, actionId) => {
    if (!mirrored() || defender.side === a.me()) return rollDefensePool(pool.white, pool.blue);
    return new Promise((resolve) => {
      pendingDefense = resolve;
      a.send({ kind: 'callDefense', seat: attacker.side, uid: attacker.uid, targetUid: defender.uid, actionId, white: pool.white, blue: pool.blue });
    });
  };
  helper = h;
  return h;
}

// Opens the window for an attack the table has already judged.
export function beginAttack(attacker: Token, actionId: string, defender: Token, verdict: TableVerdict): boolean {
  const a = api!;
  if (!root) return false;
  const h = mountAttack(root);
  if (!h) { a.toast('No dice data loaded.'); return false; }
  const action = attackActionOf(attacker, actionId);
  if (!action) return false;
  h.roller = a.inRoom() ? (pool, tag) => a.rollDice(pool, tag) : null;
  h.backAttack = verdict.backAttack;
  if (verdict.explosion) {
    h.start(
      attacker, action, defender,
      'Explosion damage: line of sight and facing do not apply, and the defender claims no Terrain or Unit Protection (4.7.6).',
      0, '', true, false, false,
    );
    return true;
  }
  if (verdict.intercept) {
    h.start(
      attacker, action, defender,
      'Interception: line of sight always exists and no Forward Arc is required, and the target claims no Terrain or Unit Protection (4.9).',
      0, '', false, true, false,
    );
    return true;
  }
  const losNote = 'Range and line of sight as judged on the table.';
  const protectionNote = verdict.protection ? 'Protection, as judged on the table (+2 White)' : '';
  // A Multi-Target Action opens the split screen; the table's answers cover
  // the primary and the other targets are picked there.
  const multi = multiTargetLimit(action);
  if (multi) {
    h.tableRead = { losNote, protection: verdict.protection, protectionNote };
    h.startMulti(attacker, action, defender, multi);
    return true;
  }
  h.start(
    attacker, action, defender,
    losNote,
    verdict.protection,
    protectionNote,
    false, false,
    // No Automatic Shield swap: the table has already named the defender.
    false,
  );
  return true;
}

// The defender's (or a spectator's) copy of a window published by the other
// phone, and the tear-down when it is gone. Run on every render.
export function syncMirror(): void {
  const a = api!;
  const s = a.state();
  const view = s.script?.combatView ?? null;
  if (helper?.active) return;
  if (!view) {
    if (helper?.watching) { helper.closeMirror(); a.closeCombat(); }
    return;
  }
  const at = s.tokens.find((t) => t.uid === view.attackerUid);
  const df = s.tokens.find((t) => t.uid === view.targetUid);
  const action = at ? attackActionOf(at, view.actionId) : undefined;
  if (!at || !df || !action) { if (helper?.watching) helper.closeMirror(); return; }
  const role = combatRoleFor(a.me(), { attacker: at, defender: df });
  if (role === 'attacker') return;
  // A phone that has never shown the window has no root yet: the panel opens
  // first, its paint mounts the helper, and that render lands back here.
  if (!root) { a.openCombat(); return; }
  const h = mountAttack(root);
  if (!h) return;
  h.backAttack = null;
  h.showMirror(view, at, df, action, role);
  a.openCombat();
}

// A view this phone published and no longer drives is taken back.
export function sweepView(): void {
  const a = api!;
  const s = a.state();
  if (!a.inRoom() || helper?.active) return;
  const view = s.script?.combatView;
  if (!view) { publishedKey = ''; return; }
  const at = s.tokens.find((t) => t.uid === view.attackerUid);
  if (!at || at.side !== a.me()) return;
  if (a.send({ kind: 'setCombatView', seat: a.me(), view: null })) publishedKey = '';
}

// The other phone's half of the handshake, landing here.
export function attackOnCommand(cmd: Command): void {
  const a = api!;
  if (cmd.kind === 'answerDefense' && pendingDefense) {
    const resolve = pendingDefense;
    pendingDefense = null;
    resolve(cmd.faces.map((f) => ({ color: f.color as DieColor, face: f.face, selected: false })));
    a.send({ kind: 'clearDefense', seat: a.me() });
  }
  if (cmd.kind === 'clearDefense') pendingDefense = null;
  const h = helper;
  if (!h?.active) return;
  if (cmd.kind === 'focusAnswer') h.focusAnswered(cmd.use);
  if (cmd.kind === 'focusReroll') h.focusRerolled(cmd.indices, cmd.faces);
  if (cmd.kind === 'kcArmor') h.kcArmed();
  if (cmd.kind === 'designateHit') h.designateAnswered(cmd.slot);
  if (cmd.kind === 'meleeEvade') h.evadeDeclared();
  if (cmd.kind === 'dodgeEnhance') h.dodgeEnhanceDeclared();
}

// The defender's presses on the mirror, as commands. Each cost gates its
// declare, as on the Match Centre.
function mirrorAct(act: MirrorAct, arg?: string | number[]): boolean {
  const a = api!;
  const s = a.state();
  const seat = a.me();
  const view = s.script?.combatView;
  const df = view ? s.tokens.find((t) => t.uid === view.targetUid) : undefined;
  if (!view || !df || df.side !== seat) return false;
  const pay = (cmd: Command): boolean => {
    const v = a.check(cmd);
    if (!v.ok) { a.toast(v.why); return false; }
    return a.send(cmd);
  };
  switch (act) {
    case 'rolldefense': {
      const call = s.script?.combat;
      if (!call || call.faces) return false;
      void rollDefensePool(call.white, call.blue).then((faces) => {
        a.send({ kind: 'answerDefense', seat, faces });
        a.render();
      }).catch(() => a.toast('The dice did not come back. Roll again.'));
      return true;
    }
    case 'kcarmor': {
      const kc = df.kind === 'mech' ? kcArmorReady(a.data, df) : null;
      if (!kc) return false;
      if (!pay({ kind: 'setCharge', seat, uid: df.uid, slot: kc.slot, on: false })) return false;
      a.send({ kind: 'kcArmor', seat });
      return true;
    }
    case 'meleeevade':
      if (!pay({ kind: 'spendCommand', seat, uid: df.uid })) return false;
      a.send({ kind: 'meleeEvade', seat });
      return true;
    case 'dodgeenhance':
      if (!pay({ kind: 'spendCommand', seat, uid: df.uid })) return false;
      a.send({ kind: 'dodgeEnhance', seat });
      return true;
    case 'designate':
      if (typeof arg !== 'string') return false;
      a.send({ kind: 'designateHit', seat, slot: arg });
      return true;
    case 'focususe':
      if (!pay({ kind: 'focus', seat, uid: df.uid })) return false;
      a.send({ kind: 'focusAnswer', seat, use: true });
      return true;
    case 'focuspass':
      return a.send({ kind: 'focusAnswer', seat, use: false });
    case 'focuskeep':
      a.send({ kind: 'focusReroll', seat, indices: [], faces: [] });
      return true;
    case 'focusreroll': {
      const defense = view.defense ?? [];
      const indices = (Array.isArray(arg) ? arg : []).filter((i) => defense[i]).sort((x, y) => x - y);
      if (!indices.length) return false;
      const white = indices.filter((i) => defense[i].color === 'white').length;
      const blue = indices.filter((i) => defense[i].color === 'blue').length;
      void rollDefensePool(white, blue).then((faces) => {
        const byColor: Record<string, { color: string; face: number }[]> = {};
        for (const f of faces) (byColor[f.color] ??= []).push({ color: f.color, face: f.face });
        const out = indices.map((i) => byColor[defense[i].color]?.shift() ?? { color: defense[i].color, face: 0 });
        a.send({ kind: 'focusReroll', seat, indices, faces: out });
        a.render();
      }).catch(() => a.toast('The reroll dice did not come back. Reroll again.'));
      return true;
    }
  }
  return false;
}

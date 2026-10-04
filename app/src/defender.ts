// THE DEFENDER'S ANSWERS. Every question an attack puts to the defending
// player is one only they can answer, and the attacking window is parked on
// it, so the answer travels as a command and the window that drew the question
// never edits its own copy of the fight. This is the one sender of those
// commands: the Match Centre's mirror presses come here, and so do a computer
// seat's (src/ai/botcombat.ts), so the two cannot answer differently.
//
// The Command Token or the Charge is spent by its OWN command in every case:
// the declaration and the cost travel separately so neither seat can end up
// with a half-applied ability, and THE COST GATES THE DECLARE. They used to
// travel unconditionally paired, so a refused spend still sent the declare
// and the attacker's window granted the effect unpaid.
import type { MirrorAct } from './combat';
import type { CheckResult, Command } from './commands';
import type { GameData } from './data';
import type { GameState, Side } from './types';
import { dodgeEnhanceOf, kcArmorReady } from './units';

export interface DefenderEnv {
  data: GameData;
  state: GameState;
  // The seat answering: only the defending player answers any of these, and
  // check() refuses them from anywhere else in any case.
  seat: Side;
  send(cmd: Command): CheckResult;
  // A defence pool from the table's dice, so the attacker watches the same
  // faces land.
  roll(white: number, blue: number): Promise<{ color: string; face: number }[]>;
  // Says something to the player answering, when there is one.
  say?(kind: 'refused' | 'system', text: string): void;
  // Called when an answer has gone, for a page to redraw.
  done?(): void;
}

// Returns whether the press actually WENT. A window latches its paid buttons
// on true, so a refused send (a paused table, the last Link) leaves the button
// live, since retry is the only path a refused press has, while a sent one
// goes quiet until the attacker's republished view answers it.
export function defenderAct(env: DefenderEnv, act: MirrorAct, arg?: string | number[]): boolean {
  const { state, seat, send } = env;
  const view = state.script?.combatView;
  const df = view ? state.tokens.find((t) => t.uid === view.targetUid) : undefined;
  if (!view || !df || df.side !== seat) return false;
  if (act === 'rolldefense') {
    const call = state.script?.combat;
    // One roll per call: the ask is cleared by answerDefense, so a second press
    // while the first is in the air finds no call and does nothing.
    if (!call || call.faces) return false;
    void env.roll(call.white, call.blue).then((faces) => {
      send({ kind: 'answerDefense', seat, faces });
      env.done?.();
    }).catch(() => {
      env.say?.('system', 'The dice did not come back. Nothing was recorded, so roll again.');
      env.done?.();
    });
    return true;
  }
  if (act === 'kcarmor') {
    // The Charge spend travels as an ordinary setCharge; the kcArmor command
    // only tells the attacker's window the trade was declared.
    const kc = df.kind === 'mech' ? kcArmorReady(env.data, df) : null;
    if (!kc) return false;
    const paid = send({ kind: 'setCharge', seat, uid: df.uid, slot: kc.slot, on: false });
    if (!paid.ok) { env.say?.('refused', paid.why); return false; }
    send({ kind: 'kcArmor', seat });
    env.done?.();
    return true;
  }
  if (act === 'meleeevade') {
    const paid = send({ kind: 'spendCommand', seat, uid: df.uid });
    if (!paid.ok) { env.say?.('refused', paid.why); return false; }
    send({ kind: 'meleeEvade', seat });
    env.done?.();
    return true;
  }
  if (act === 'dodgeenhance') {
    // The mass-production HALO (GoF 1.021) spends nothing.
    const paid = dodgeEnhanceOf(env.data, df)?.free ? { ok: true as const } : send({ kind: 'spendCommand', seat, uid: df.uid });
    if (!paid.ok) { env.say?.('refused', paid.why); return false; }
    send({ kind: 'dodgeEnhance', seat });
    env.done?.();
    return true;
  }
  if (act === 'designate') {
    // The choice is the defender's; the ATTACKER's open window is what actually
    // moves the hit, which is the same shape focusAnswer has.
    if (typeof arg !== 'string') return false;
    send({ kind: 'designateHit', seat, slot: arg });
    env.done?.();
    return true;
  }
  if (act === 'focususe') {
    // The Link spend gates the answer: a refused `focus` with the answer
    // still sent would advance the attacker's stage to a reroll nobody paid
    // for. And the refusal is SAID: 4.10's last-Link floor is a real rule a
    // player can hit, and a button that eats the press in silence is what
    // teaches them to keep clicking.
    const paid = send({ kind: 'focus', seat, uid: df.uid });
    if (!paid.ok) { env.say?.('refused', paid.why); return false; }
    send({ kind: 'focusAnswer', seat, use: true });
    env.done?.();
    return true;
  }
  if (act === 'focuspass') {
    const went = send({ kind: 'focusAnswer', seat, use: false });
    env.done?.();
    return went.ok;
  }
  if (act === 'focuskeep') {
    send({ kind: 'focusReroll', seat, indices: [], faces: [] });
    env.done?.();
    return true;
  }
  if (act === 'focusreroll') {
    // The dice were picked in the mirror window, which holds the selection
    // across its own repaints; only the indexes travel.
    const defense = view.defense ?? [];
    const indices = (Array.isArray(arg) ? arg : []).filter((i) => defense[i]).sort((a, b) => a - b);
    if (!indices.length) return false;
    const white = indices.filter((i) => defense[i].color === 'white').length;
    const blue = indices.filter((i) => defense[i].color === 'blue').length;
    void env.roll(white, blue).then((faces) => {
      // The table's faces come back grouped by colour; hand them back to the
      // chosen dice colour-by-colour so every index gets a face of its own
      // die's colour.
      const byColor: Record<string, { color: string; face: number }[]> = {};
      for (const f of faces) (byColor[f.color] ??= []).push({ color: f.color, face: f.face });
      const out = indices.map((i) => byColor[defense[i].color]?.shift() ?? { color: defense[i].color, face: 0 });
      send({ kind: 'focusReroll', seat, indices, faces: out });
      env.done?.();
    }).catch(() => {
      // The Link is already spent by the declare, so a roll that never came
      // back has to SAY so: the buttons are still on screen and pressing again
      // is the retry.
      env.say?.('system', 'The reroll dice did not come back. Nothing was recorded, so reroll again.');
      env.done?.();
    });
    return true;
  }
  return false;
}

import type { CombatView, Facing, GameState, MechLoadout, Opportunity, PartSlot, RollbackPoint, Side, SmokeScreen, Stance, Timing, Token } from './types';
import { addStatus, ageTokens, newOpportunity, PHASES, statusCount, STATUSES, TIMINGS } from './types';
import type { GameData } from './data';
import { cardName, transformFaces, unfoldsInto, discardFaceOf } from './data';
import { covertCarryLock, ammoDeliveryPool, opportunityBonusOn, ripostePart, defenseReactionOn, targetTracingOn, riderOnDrone, hasFlexibleTiming, commandGeneration, blinkTargets, isPositionSwap, electronicOrigins, isSilentAction, maneuverIsSilent, loanedParts, unfoldToken, formSwitch, switchFormTo, extrasFor, consumesCharge, cutTethersOn, electronicDash, electronicValue, immobilizedStop, isScanAction, scannable, manifestationRange, nonHumanoidCost, nonHumanoidStop, freehandSlots, interceptCapacity, anyStartTiming, focusIsFree, keepsLinkOnPartLoss, makeDroneToken, structureOf, makeMechToken, maneuverRange, maxLink, partsLeft, pilotCard, pilotIs, projectileDelivery, provokeWhy, settleTethers, SLOT_LABEL, tetherTo, tokenCards, transformPartOn } from './units';
import { tetherCap } from './melee';
import { canActivate, canAttackMode, canManeuver, canOverload, canPerform, spendAction, spendActivation, spendAttackMode, spendManeuver, spendOverload } from './ticks';
import { tacticSpec, tacticTargets, type TacticCtx } from './tactics';
import { battlefieldLocked, deploymentComplete, deployTurn, firstPlayerFrom, newSetup, normaliseSetup, tasksLocked } from './setup';
import { applyKill, normaliseTasks, pendingDesignations, recordPartLoss, recordUnitLoss, settleControl, type Designation } from './tasks';
import { alive, canAct, dialHidden, droneActionWhy, droneMoveWhy, eligibleUnits, getLocalSeat, isLoopPhase, loopComplete, nextTurn, onExtraOpportunity } from './loop';
import { dissipationFor, rangeBetween, spotsInGrid } from './rules';

// ---------- the command layer (multiplayer phase 1) ----------

// A command is a named, serialisable intent: what a player is trying to do,
// rather than what became true afterwards. Everything downstream of 1v1 —
// hotseat handoff, the strict tracker, networking, stats, undo — needs that
// distinction, so mutations move behind this vocabulary one at a time.
//
// check() is the single place a rule lives, and it never mutates. apply()
// mutates the state it is given, in place like the rest of the app, and
// assumes the command was checked: given the same state and command it always
// does the same thing, which is what replaying a log or mirroring a remote
// seat requires. Both take the card database, because a command carries ids
// and both ends of a wire already hold the same cards. Dice will ride inside
// their commands as rolled faces, never re-rolled by the receiver.
//
// Movement commands record the destination the interactive move arrived at,
// so their apply is a no-op locally and the real move on a mirrored seat.
// Path legality stays with the move UI, which only offers reachable grids;
// check() covers everything that does not need the pathfinder.

export type Command =
  | { kind: 'setTiming'; seat: Side; uid: number; timing?: Timing }
  // Where inside its own Large Grid a unit stands. Costs no Movement Range and
  // never leaves the Grid, but it decides Contact, which is judged at
  // Small-Grid resolution (4.2.3) — so a Drone that lands dead centre may need
  // shifting to the edge it actually touches.
  | { kind: 'placeInGrid'; seat: Side; uid: number; to: { col: number; row: number } }
  | { kind: 'setStance'; seat: Side; uid: number; stance: Stance }
  | { kind: 'reboot'; seat: Side; uid: number; stance: Stance }
  // `free` is a Movement Action moving the unit on the Action Tick it has
  // already paid for, so it must not also spend the Maneuver Tick. Everything
  // else that moves a unit under its own power is a Maneuver.
  //
  // `via` is the route walked, purely so the other player watches the same walk
  // instead of a slide through the wall the mover went around. Nothing reads it
  // but the animation, and a command without it still lands correctly.
  //
  // `granted` is a Movement a card handed out rather than one the Opportunity
  // paid for — Hit and Run (276) moves a Mech as its Opportunity *ends*, when
  // there is no Opportunity left to check or to charge.
  //
  // `from` is where the Movement STARTED, and it is sent only when the unit has
  // already been placed by the command before this one: a Crush that ends in a
  // position exchange (4.3.6) moves both Units in a single crushSwap, so the
  // maneuver that RECORDS the Movement arrives with the crusher already standing
  // on its landing Grid. Every other sender leaves it out and the token's own
  // position is the start, exactly as before — which is what the M2 Data Link
  // pre-move arithmetic below measures against.
  //
  // NOT taken on trust: check() reads the board for the placement this claims
  // has happened, because the field is rules-bearing and the sender is the
  // thing that reader distrusts. See the guard in the `maneuver` case.
  // `actionId` is the Movement Action being performed, when there is one. It
  // exists so the Immobilized ban can judge Unstoppable AT THE COMMAND rather
  // than trusting whichever UI sent the move: the exception is per ACTION (181's
  // Run has it, its Sprint does not), so the action has to travel.
  | { kind: 'maneuver'; seat: Side; uid: number; to: { col: number; row: number }; facing?: Facing; free?: boolean; granted?: boolean; via?: { col: number; row: number }[]; from?: { col: number; row: number }; actionId?: string }
  // A Crush with no escape square (4.3.6, book p.47): "If NONE of the Grids
  // within Range of that Forced Movement can be entered, the crushed Unit
  // instead exchanges positions with the Crushing Unit."
  //
  // ONE command that moves EVERY token involved, and that is the whole point of
  // it existing rather than being a maneuver plus a nudge: the undo ring and the
  // networked rollback both snapshot BETWEEN commands, so a two-command exchange
  // has a window in which the crusher is standing on the unit it is trading
  // places with. `uid` is the crusher and `to` its landing spot; `swaps` are the
  // crushed Units and the spots they take in the Grid the crusher vacates.
  //
  // Deliberately carries NO Opportunity accounting — see check() for why.
  | { kind: 'crushSwap'; seat: Side; uid: number; to: { col: number; row: number }; facing?: Facing; swaps: { uid: number; to: { col: number; row: number }; facing?: Facing }[] }
  // `granted` is an Action a CARD handed out rather than one the Action
  // Opportunity paid for -- Riposte's immediate Melee. It is never
  // self-authorising: check() looks for the matching debt in shared state, so a
  // client cannot act out of turn by asserting the flag.
  | { kind: 'performAction'; seat: Side; uid: number; actionId: string; partKey?: string; granted?: boolean }
  | { kind: 'overload'; seat: Side; uid: number }
  // Card 547's Attack Mode. A DECLARED command rather than a bonus minted with
  // the Opportunity, because the Stance it depends on is chosen during the
  // Opportunity (4.1) — newOpportunity still holds the previous round's Stance
  // and cannot judge it. The card prints "may", so it is never automatic.
  | { kind: 'attackMode'; seat: Side; uid: number }
  | { kind: 'playTactic'; seat: Side; uid: number; cardId: string; pick?: string }
  // Nothing in 3.1.4 fixes which way a unit faces as it lands, so the facing is
  // the player's to choose while the placement is still theirs to take back.
  | { kind: 'deployUnit'; seat: Side; uid: number; to: { col: number; row: number }; stance?: Stance; camo?: boolean; facing?: Facing }
  | { kind: 'applyPenetration'; seat: Side; uid: number; targetUid: number; slot: PartSlot | 'main' }
  | { kind: 'applyStatus'; seat: Side; uid: number; targetUid: number; statusId: string; stacks?: number }
  // Taking one back off. Tokens are rules-bearing and fingerprinted — an
  // Immobilized or Fragile chip changes the defence pool — so a player peeling
  // one off by hand has to travel like putting it on does. One at a time,
  // matching the chip: a stacked Square loses its most recent entry.
  | { kind: 'removeStatus'; seat: Side; uid: number; targetUid: number; statusId: string }
  | { kind: 'focus'; seat: Side; uid: number }
  // ZPA-40 Shrike, 欢愉 Elation: "[Offensive Stance] When this Mech Destroys
  // enemy Parts with Melee Actions, restore 1 Link." Its own command rather
  // than a field on applyPenetration, whose payload is {seat, uid, targetUid,
  // slot} and carries neither the Action nor the Stance -- widening that shape
  // would touch replay compatibility for every Penetration ever recorded.
  // Emitted from combat.ts, where `c.action` and `c.attacker.stance` are both
  // in hand, and gated in check() so a client cannot mint Link with it.
  | { kind: 'restoreLink'; seat: Side; uid: number }
  | { kind: 'forceMove'; seat: Side; uid: number; targetUid: number; to: { col: number; row: number }; push?: boolean; facing?: Facing }
  | { kind: 'spendAmmo'; seat: Side; uid: number; actionId: string }
  | { kind: 'restoreAmmo'; seat: Side; uid: number; actionId: string; amount?: number }
  // The Round Tokens an Intercept X Part carries (4.9). They are spent, never
  // regained; the restore is an undo for a misclick, which a networked table
  // needs to travel like anything else that changes a shared number.
  | { kind: 'spendIntercept'; seat: Side; uid: number; actionId: string }
  | { kind: 'restoreIntercept'; seat: Side; uid: number; actionId: string }
  // A Part's Charge Token turned face-up or back down (4.14). Which Parts hold
  // one is a shared fact, so the flip has to travel like Ammo does.
  | { kind: 'setCharge'; seat: Side; uid: number; slot: string; on: boolean }
  | { kind: 'recordKill'; seat: Side; uid: number; targetUid: number; what: 'part' | 'unit' }
  // Concussion/Wrecking (4.10): the Attack Roll's Lightning strips the target
  // Mech's Link, sent once by the attacking client as the resolution applies.
  | { kind: 'drainLink'; seat: Side; uid: number; targetUid: number; n: number }
  | { kind: 'destroyTerrain'; seat: Side; uid: number; pieces: string[] }
  // A Black Box changing hands (5.3.1). Picking one up is optional and happens
  // as a unit's Movement passes through its Grid; the route itself stays with
  // the move UI, the way it does for `maneuver`. `slot` is the Freehand Part
  // that carries it, and that Part's Freehand counts as spent while it does.
  | { kind: 'takeBlackBox'; seat: Side; uid: number; itemId: string; slot: string }
  // Dropped when the bearer is Penetrated, and it is the ATTACKER who says
  // where it lands — hence a seat that is not the bearer's. `uid` is the
  // attacker, for attribution only: it may be a Projectile that is already
  // spent by the time the Grid is chosen, so this one is actor-optional.
  | { kind: 'dropBlackBox'; seat: Side; uid: number; itemId: string; to: { col: number; row: number } }
  | { kind: 'advancePhase'; seat: Side }
  | { kind: 'setPhase'; seat: Side; phase: number }
  | { kind: 'resetRounds'; seat: Side }
  | { kind: 'adjustCommandTokens'; seat: Side; pool: Side; delta: number }
  | { kind: 'endOpportunity'; seat: Side; uid: number }
  | { kind: 'designate'; seat: Side; uid: number; fromUid?: number }
  // Command Coordination (4.15.3): a Mech hands a reserved token to a Drone
  // outside the Command Phase. `uid` is the issuing Mech, `targetUid` the
  // Drone. Separate from designate because it is not a turn in a designation
  // loop - it happens off the back of an Action and alternates with nothing.
  | { kind: 'coordinateCommand'; seat: Side; uid: number; targetUid: number }
  // 4.15.4: an Action that consumes a Command flips one of this Mech's own
  // face-up tokens face-down. The token stays on the card - the End Phase is
  // what removes it - so this is a flip, never a removal.
  | { kind: 'spendCommand'; seat: Side; uid: number }
  // ZPA-36 Aster: once per round, in the Command Phase, consume 1 Command Token
  // to restore 1 Link to an Ally Mech. `uid` is Aster's Mech (it pays), and
  // `targetUid` the Mech being repaired - often the same one.
  | { kind: 'asterRestore'; seat: Side; uid: number; targetUid: number }
  | { kind: 'passTurn'; seat: Side }
  | { kind: 'grantExtra'; seat: Side; uid: number; linkCost: number }
  | { kind: 'markEndStep'; seat: Side; step: string }
  | { kind: 'award'; seat: Side; vp: { s1: number; s2: number }; keys: string[] }
  | { kind: 'stabilise'; seat: Side; uid: number; keepTokens?: boolean }
  | { kind: 'repairPart'; seat: Side; uid: number; slot: string; mode: 'repaired' | 'mend' }
  | { kind: 'breakRepaired'; seat: Side; uid: number; targetUid: number; slot: string }
  // `to` is Manifestation Movement, which 4.12.2 makes part of the same event
  // as the Reveal rather than a move that follows it - so it rides here rather
  // than in a second command a mirror could see arrive on its own.
  | { kind: 'reveal'; seat: Side; uid: number; to?: { col: number; row: number }; facing?: Facing }
  | { kind: 'lockMap'; seat: Side }
  | { kind: 'finishTasks'; seat: Side }
  | { kind: 'rollSetup'; seat: Side; hits: number[] }
  | { kind: 'acceptRoll'; seat: Side }
  // A die landed on the shared table (U7 finding, 2026-08-25): the room's dice
  // server rolled and both players watched. State-wise a no-op — its whole job
  // is to sit in the snapshot ring as a SEALED kind, because applyPenetration
  // and friends only mark rolls that carried consequences, and a MISSED attack
  // must seal the rollback timeline exactly like a hit.
  | { kind: 'noteRoll'; seat: Side; what: string }
  | { kind: 'pickEdge'; seat: Side; edge: 'black' | 'white' }
  | { kind: 'lockDials'; seat: Side }
  | { kind: 'finishDeployment'; seat: Side }
  // An Electronic Counter-roll (4.11.2). Both sides roll their own Electronic
  // Value in Yellow dice and either may Focus, so it cannot be driven from one
  // chair: each seat submits its own faces, and both clients derive the verdict.
  | {
      kind: 'startCounterRoll'; seat: Side; uid: number; actionId: string; targetUid: number;
      // Target Tracing opens this as a REACTION to being attacked rather than
      // as an Action, so the Action's own Range does not gate it -- whatever
      // reach the attack had is the reach this answers at (174).
      reaction?: boolean;
    }
  | { kind: 'rollCounter'; seat: Side; uid: number; faces: number[]; focused?: boolean }
  // LPA-22 Yoyu's 挑衅 Provoke, answered. `uid` is YOYU -- the Responder that
  // won the Counter-roll -- so this rides the actor path and inherits the "your
  // own units only" gate; `targetUid` is the Initiator whose Stance is being
  // turned. `take` false is a real command and not a no-op: the far seat has to
  // watch the question close, or it sits waiting on an answer that already
  // happened.
  | { kind: 'provoke'; seat: Side; uid: number; targetUid: number; take: boolean }
  // Suppression (glossary): the attacker's declaration switches the targeted
  // Mech to Defensive Stance. `uid` is the ATTACKER, so the actor gate holds;
  // the stance that changes is the TARGET's, the same shape provoke has.
  | { kind: 'suppress'; seat: Side; uid: number; targetUid: number }
  // Disarm 缴械: the attacker's hit flips the target's hit Part to its Discard
  // Card. `uid` is the ATTACKER for the actor gate; the flip lands on the
  // target -- transformPart could not carry this, because it is owner-gated
  // and was built for the White Dwarf flipping its OWN modes.
  | { kind: 'disarm'; seat: Side; uid: number; targetUid: number; slot: string }
  | { kind: 'clearCounterRoll'; seat: Side }
  | { kind: 'queueIntercepts'; seat: Side; items: { uid: number; actionId: string; targetUid: number }[] }
  | { kind: 'resolveIntercept'; seat: Side; uid: number; actionId: string; targetUid: number }
  | { kind: 'clearIntercepts'; seat: Side }
  // The defender's owed reaction to being shot at. Queued by the ATTACKING
  // client, which is the only one that knows the attack has finished, and
  // resolved by the DEFENDER's, because the Screens are theirs to place. Under
  // Multi-Target the whole batch is queued at once after the last sequence,
  // which is FAQ B7's ordering made structural.
  | {
      kind: 'queueReactions'; seat: Side;
      // `kind` absent means Emergency Smoke, which is every debt written before
      // Target Tracing existed and every one still on a saved board.
      items: { uid: number; actionId: string; count: number; range: number; kind?: 'smoke' | 'trace' | 'stance' | 'riposte' | 'manifest'; fromUid?: number }[];
    }
  | { kind: 'resolveReaction'; seat: Side; uid: number; actionId: string }
  // The "White Dwarf" Bit turning its card over (293/294/295). The set is read
  // from the ACTION rather than trusted from the wire, the same single-source
  // rule the Disarm face and the crushSwap step-out grid follow.
  | { kind: 'switchForm'; seat: Side; uid: number; actionId: string; cardId: string }
  // Remote Access turning a Terminal face-down for the rest of the round
  // (5.3.3). Worth VP at the End Phase, so it has to travel — freeplay used to
  // set `item.accessed` in place and the other client scored a different board.
  | { kind: 'accessTerminal'; seat: Side; uid: number; itemId: string }
  | { kind: 'launch'; seat: Side; uid: number; actionId: string; cardId: string; to: { col: number; row: number }; facing: Facing }
  | { kind: 'layMine'; seat: Side; uid: number; actionId: string; cardId: string; to: { col: number; row: number } }
  | { kind: 'blink'; seat: Side; uid: number; actionId: string; targetUid: number; facing: Facing; targetFacing: Facing }
  | { kind: 'despawn'; seat: Side; uid: number; targetUid: number }
  | { kind: 'unfold'; seat: Side; uid: number }
  // Turning a Part over to its other face without changing anything else about
  // the unit: the White Dwarf's Assault/Cruise Modes (287/288) on a Swift
  // Action, and the Harpoon flipping into Tether Mode when its shot connects.
  // Generic on purpose — the command carries the slot and the destination card,
  // and check() confirms the two faces really are the same physical card.
  | { kind: 'transformPart'; seat: Side; uid: number; slot: PartSlot; cardId: string }
  // Tether X (PDLH-202). `uid` is the INITIATING unit and `targetUid` the one
  // that ends up on a leash; the asymmetry is the whole rule, so it is carried
  // in the command rather than worked out on arrival. Removal is never
  // commanded: every one of the printed conditions is derived from the board by
  // settleTethers, or stamped where the Penetration lands.
  | { kind: 'tether'; seat: Side; uid: number; targetUid: number; range: number }
  // `for` names the squad the Screen belongs to when it is not the sender's:
  // a defender's Emergency Smoke is driven from the attacking client, whose
  // seat the ATTRIBUTED stamping will overwrite. Ownership decides stacking
  // and who dissipates it, so it has to survive the stamp.
  | { kind: 'placeSmoke'; seat: Side; at: { col: number; row: number }; for?: Side }
  | { kind: 'removeSmoke'; seat: Side; at: { col: number; row: number } }
  | { kind: 'dissipateSmoke'; seat: Side }
  | { kind: 'setMode'; seat: Side; mode: 'hotseat' | 'hidden' }
  | { kind: 'handOver'; seat: Side }
  | { kind: 'setStrict'; seat: Side; strict: boolean }
  // A whole squad arriving at the table, as data rather than as a local
  // mutation, so both ends of a wire mint the same units.
  | { kind: 'importSquad'; seat: Side; name?: string; mechs: { name?: string; loadout: MechLoadout }[]; drones: { cardId: string; backpack?: string }[] }
  // The table itself: map, zones, mission and scale used to be local
  // mutations, which is why a host's picks never reached the guest. Tasks
  // ride in the command pre-derived, like dials ride in a reveal.
  | { kind: 'configureTable'; seat: Side; map?: string; zoneSet?: string; mission?: string | null; tasks?: GameState['tasks']; scale?: GameState['scale']; roundLimit?: number }
  | { kind: 'startMatch'; seat: Side }
  | { kind: 'endMatch'; seat: Side }
  // A squad's open-information Secondary Task pick (3.1.3). The seat is the
  // side choosing, so a player can only ever pick their own.
  | { kind: 'pickSecondary'; seat: Side; cardId: string }
  // A squad's hand of Tactics Cards, chosen with the squad and held rather
  // than played onto the board (5.4). It travels because `check()` for
  // playTactic reads the *sender's* hand, which the receiving client would
  // otherwise never have seen — and because a hand set locally is a hand the
  // other player cannot see the cost of.
  | { kind: 'setTactics'; seat: Side; cards: string[] }
  // Naming the Mech or the Tactical Zone a Task is about. `seat` is whoever
  // makes the choice, which is not always whose Task it is — Behead has the
  // opponent name one of their own — so `for` carries the squad that scores it.
  | { kind: 'designateTask'; seat: Side; what: 'target' | 'zone' | 'leader'; for?: Side; uid?: number; zone?: string }
  // A seat declaring itself ready in the lobby, so the host cannot start
  // while the other player is still reading the battlefield.
  | { kind: 'setReady'; seat: Side; ready: boolean }
  // Rolling a shared board back, by consent. These travel as ordinary commands,
  // so the relay forwards them without needing to know what they mean and no
  // server change is required. The REWIND itself is not done here — a command
  // that rewrote the board while inside apply() would be undoing the history
  // entry it is currently creating. The page watches for the accepted answer
  // and calls history.undoTo() outside the command layer.
  // The two halves of a defence roll made by its owner. The attack pipeline
  // runs on the attacker's client, but the defender presses their own roll:
  // `callDefense` records what is owed in shared state, the defender's client
  // rolls (server dice, so both watch the faces land) and answers with
  // `answerDefense` carrying the faces — the same ride-in-the-command shape the
  // Electronic Counter-roll and the setup roll use. `clearDefense` closes the
  // record once the attacker's helper has consumed it, or when the attack is
  // cancelled out from under it.
  | { kind: 'callDefense'; seat: Side; uid: number; targetUid: number; actionId: string; white: number; blue: number }
  | { kind: 'answerDefense'; seat: Side; faces: { color: string; face: number }[] }
  | { kind: 'clearDefense'; seat: Side }
  // The remote defender's half of Focus (4.4.1-5): their declare, and their
  // reroll with the chosen dice and the server faces riding in the command —
  // the same shape the defence roll itself travels in. The Link is spent by
  // their own client through an ordinary `focus` command.
  | { kind: 'focusAnswer'; seat: Side; use: boolean }
  | { kind: 'designateHit'; seat: Side; slot: string }
  | { kind: 'meleeEvade'; seat: Side }
  | { kind: 'dodgeEnhance'; seat: Side }
  // Defense Reaction (ZHLA-101 / ZHLA-301). Its own command rather than a
  // setStance, because the whole point of the card is that it changes Stance at
  // a moment 4.1 does not allow -- and a setStance that ignored the lock would
  // hand every Mech the same freedom.
  | { kind: 'defenseReaction'; seat: Side; uid: number }
  // Riposte's first half. A TABLE_KIND because it ends the OTHER seat's Action
  // Opportunity, which no seat-scoped command may reach.
  | { kind: 'riposte'; seat: Side; uid: number; fromUid: number }
  | { kind: 'focusReroll'; seat: Side; indices: number[]; faces: { color: string; face: number }[] }
  // KC Armor (4.10): the remote defender's declare that its consumed Charge
  // Token turns the Defense Roll's Lightning into Defense. The Charge itself
  // is spent by the defender's own setCharge; this only reaches the window.
  | { kind: 'kcArmor'; seat: Side }
  // The attacker's combat window, published so the defender watches the same
  // attack unfold. Null tears the mirror down when the window closes.
  | { kind: 'setCombatView'; seat: Side; view: CombatView | null }
  | { kind: 'setRollbackCatalog'; seat: Side; entries: RollbackPoint[] }
  | { kind: 'rollbackRequest'; seat: Side; round: number; phase: number; label: string; seq?: number }
  | { kind: 'rollbackAnswer'; seat: Side; accept: boolean }
  // The two halves of the networked dial reveal (3.3). A seat publishes a
  // hash of its dials first and the dials themselves only once both hashes
  // are in, so neither player can see the other's before fixing their own.
  | { kind: 'commitTimings'; seat: Side; hash: string }
  | { kind: 'revealTimings'; seat: Side; salt: string; dials: { uid: number; timing?: Timing }[] };

// `note` is an allowed command that still has something to say — the award of a
// negative rider is the first of them. Warn, don't block: the rules have an
// answer (the total floors at zero), and refusing would lose the whole round's
// Victory Points for BOTH squads over one card.
export type CheckResult = { ok: true; note?: string } | { ok: false; why: string };

const STANCES: Stance[] = ['offensive', 'defensive', 'mobility', 'shutdown'];
const ok: CheckResult = { ok: true };
const no = (why: string): CheckResult => ({ ok: false, why });
const fromVerdict = (v: { ok: boolean; why?: string }): CheckResult => (v.ok ? ok : no(v.why ?? 'Not allowed.'));

const tacticCtx = (data: GameData): TacticCtx => ({ maxLink: (x) => maxLink(data, x) });

// A Low Value Unit has no Point Value (book p.82), which is how the card data
// marks them: the carried and generated Drones all cost 0.
function lowValueUnit(data: GameData, t: Token): boolean {
  if (t.kind === 'projectile') return true;
  if (t.kind !== 'drone') return false;
  return (data.byId.get(t.cardId ?? '')?.score ?? 0) === 0;
}

function ammoMax(data: GameData, t: Token, actionId: string): number | undefined {
  return tokenCards(data, t).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === actionId)?.storage;
}

function interceptMax(data: GameData, t: Token, actionId: string): number | undefined {
  const a = tokenCards(data, t).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === actionId);
  return a ? interceptCapacity(a) : undefined;
}

// Large-grid Manhattan distance, the only reach test an Electronic Warfare
// Action needs (4.11.1).
function gridRange(a: Token, b: Token): number {
  return Math.abs(Math.floor(a.col / 3) - Math.floor(b.col / 3)) + Math.abs(Math.floor(a.row / 3) - Math.floor(b.row / 3));
}

// A Part may hold a Charge Token only if one of its own Actions spends one.
function chargeable(data: GameData, t: Token, slot: string): boolean {
  return tokenCards(data, t).some(
    ({ slot: s, card }) => s === slot
      && (t.partStates[s as PartSlot | 'main'] ?? 'intact') !== 'destroyed'
      && (card.actions ?? []).some((a) => consumesCharge(a)),
  );
}

// Ammo belongs to the Part, and a Load's Part belongs to the Tarantula that is
// carrying it - so a Mech firing a borrowed Missile Rack spends the DRONE's
// magazine (FAQ O3/O16). Resolved here rather than in the drivers, so every
// path that spends Ammo lands on the same unit on both seats.
//
// Exported for the two launch UIs alone. A Volley is capped by whichever runs
// out first, the keyword or the magazine, and a page that sized that cap off
// its own `t.ammo` offered shots this file then refused.
export function ammoHolder(data: GameData, state: GameState, t: Token, actionId: string): Token {
  if (t.ammo?.[actionId] !== undefined) return t;
  const loan = loanedParts(data, state.tokens, t)
    .find(({ card }) => (card.actions ?? []).some((a) => a.id === actionId));
  return loan && loan.from.ammo?.[actionId] !== undefined ? loan.from : t;
}

// WHICH POOL pays, one axis over from ammoHolder's "whose TOKEN pays".
// 086_B Ammo Delivery lets a launch come out of the RKG70 Ammunition Pack's
// magazine instead of the Pod's own, so the Pod fires three times rather than
// one before a resupply.
//
// The printed pool always goes first and the Pack is a FALLBACK, never a
// prompt. The card says "may", but both magazines hold the same missiles and
// the Pack's only other use is refilling the Pod, so which one empties first
// changes nothing a player would want to decide — the same reading
// lightningExchangeOf records for its own printed "may".
export function ammoPay(
  data: GameData,
  state: GameState,
  t: Token,
  actionId: string,
): { from: Token; poolId: string } {
  const own = ammoHolder(data, state, t, actionId);
  if ((own.ammo?.[actionId] ?? 0) > 0) return { from: own, poolId: actionId };
  const lent = ammoDeliveryPool(data, t, actionId);
  return lent ? { from: t, poolId: lent } : { from: own, poolId: actionId };
}

function findAction(data: GameData, state: GameState, uid: number, actionId: string) {
  const t = state.tokens.find((x) => x.uid === uid);
  if (!t) return undefined;
  for (const { card } of tokenCards(data, t)) {
    const a = (card.actions ?? []).find((x) => x.id === actionId);
    if (a) return a;
  }
  // A Backpack carried by a Carrier Tarantula in Contact is this Mech's Part
  // while it acts (FAQ O3/O16), so its Actions are this Mech's Actions.
  for (const { card } of loanedParts(data, state.tokens, t)) {
    const a = (card.actions ?? []).find((x) => x.id === actionId);
    if (a) return a;
  }
  return data.commonActions.find((x) => x.id === actionId);
}

// The Action Opportunity being spent, but only if it belongs to this unit:
// commands never invent one, they spend the one the guide opened.
function oppOf(state: GameState, uid: number) {
  const o = state.script?.opp;
  return o && o.uid === uid ? o : undefined;
}

// Forced Movement, kill tallies, terrain destruction and the intercept queue
// may outlive their actor: a grenade's Knockback resolves after the spent
// projectile has left the board, and an owed Interception survives its unit
// dying. So these carry the actor for attribution, and the on-board gate binds
// only while it is still standing.
function actorOptional(cmd: Command): cmd is Command & { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' | 'resolveIntercept' | 'dropBlackBox' | 'drainLink' } {
  return cmd.kind === 'forceMove' || cmd.kind === 'recordKill' || cmd.kind === 'destroyTerrain' || cmd.kind === 'drainLink'
    || cmd.kind === 'resolveIntercept' || cmd.kind === 'dropBlackBox';
}

// The round track, the pre-game stages, the smoke and intercept books, the
// designation loop's pass and the End Phase checklist belong to the table, not
// to a unit, so these carry a seat and nothing else.
type TableKind =
  | 'advancePhase' | 'setPhase' | 'resetRounds' | 'adjustCommandTokens' | 'passTurn' | 'markEndStep' | 'award'
  | 'lockMap' | 'rollSetup' | 'acceptRoll' | 'noteRoll' | 'finishTasks' | 'pickEdge' | 'lockDials' | 'finishDeployment'
  | 'queueIntercepts' | 'clearIntercepts' | 'placeSmoke' | 'removeSmoke' | 'dissipateSmoke'
  // queueReactions only: `resolveReaction` names the defender's own unit, so it
  // goes through the actor path and gets the "your units only" check free.
  | 'queueReactions'
  | 'clearCounterRoll'
  | 'setMode' | 'handOver' | 'setStrict' | 'commitTimings' | 'revealTimings' | 'importSquad'
  | 'configureTable' | 'startMatch' | 'endMatch' | 'pickSecondary' | 'setTactics' | 'setReady' | 'designateTask'
  | 'callDefense' | 'answerDefense' | 'clearDefense' | 'setCombatView' | 'focusAnswer' | 'focusReroll' | 'kcArmor' | 'designateHit' | 'meleeEvade' | 'dodgeEnhance' | 'riposte'
  | 'setRollbackCatalog' | 'rollbackRequest' | 'rollbackAnswer';
const TABLE_KINDS = new Set<Command['kind']>([
  'advancePhase', 'setPhase', 'resetRounds', 'adjustCommandTokens', 'passTurn', 'markEndStep', 'award',
  'lockMap', 'rollSetup', 'acceptRoll', 'noteRoll', 'finishTasks', 'pickEdge', 'lockDials', 'finishDeployment',
  'queueIntercepts', 'clearIntercepts', 'placeSmoke', 'removeSmoke', 'dissipateSmoke',
  'queueReactions',
  'clearCounterRoll',
  'setMode', 'handOver', 'setStrict', 'commitTimings', 'revealTimings', 'importSquad',
  'configureTable', 'startMatch', 'endMatch', 'pickSecondary', 'setTactics', 'setReady', 'designateTask',
  'callDefense', 'answerDefense', 'clearDefense', 'setCombatView', 'focusAnswer', 'focusReroll', 'kcArmor', 'designateHit', 'meleeEvade', 'dodgeEnhance', 'riposte',
  'setRollbackCatalog', 'rollbackRequest', 'rollbackAnswer',
]);

// Table commands whose seat is attribution rather than a choice one squad
// owns. Networked, they are stamped with the sender's own seat, because the
// relay refuses anything sent as the other player — a guest advancing the
// phase with a hard-coded 's1' would apply locally and silently never travel.
const ATTRIBUTED = new Set<Command['kind']>([
  'advancePhase', 'setPhase', 'resetRounds', 'markEndStep', 'award',
  // Who asked and who answered is the whole record of a rollback, so both are
  // stamped with the sender's own seat like every other attributed command.
  'callDefense', 'answerDefense', 'clearDefense', 'setCombatView', 'focusAnswer', 'focusReroll', 'kcArmor', 'designateHit', 'meleeEvade', 'dodgeEnhance', 'riposte',
  'setRollbackCatalog', 'rollbackRequest', 'rollbackAnswer',
  'lockMap', 'acceptRoll', 'noteRoll', 'lockDials', 'finishDeployment',
  'queueIntercepts', 'clearIntercepts', 'placeSmoke', 'removeSmoke', 'dissipateSmoke',
  // Queued from the ATTACKING client but naming the defender's units, so the
  // seat is pure attribution and gets stamped like any other table command.
  'queueReactions',
  'setMode', 'setStrict', 'adjustCommandTokens', 'designateTask', 'clearCounterRoll',
  'configureTable', 'startMatch', 'endMatch',
]);
function tableLevel(cmd: Command): cmd is Command & { kind: TableKind } {
  return TABLE_KINDS.has(cmd.kind);
}

// The lookup the zone-control judgement reads its Grids from.
const zoneCells = (data: GameData) => (zone: string): string[] => data.zoneData.zones.find((z) => z.id === zone)?.cells ?? [];

// The first clear square for a newly arrived unit, scanning row by row from
// the squad's own edge — Squad 1 from the top of the board, Squad 2 from the
// bottom, the same orientation the interactive spot-finder uses. Pure function
// of the state, because a mirrored seat must land the unit on the same Grid.
const CELLS = 36;
function freeSpot(state: GameState, size: number, side: Side, aerial: boolean): { col: number; row: number } | null {
  const rows = [...Array(CELLS - size + 1).keys()];
  if (side === 's2') rows.reverse();
  for (const row of rows) {
    for (let col = 0; col <= CELLS - size; col++) {
      const clash = state.tokens.some(
        (t) =>
          t.deployed !== false
          && t.aerial === aerial
          && col < t.col + t.size && t.col < col + size
          && row < t.row + t.size && t.row < row + size,
      );
      if (!clash) return { col, row };
    }
  }
  return null;
}

function checkTable(data: GameData, state: GameState, cmd: Command & { kind: TableKind }): CheckResult {
  switch (cmd.kind) {
    case 'configureTable': {
      if (cmd.map === undefined && cmd.zoneSet === undefined && cmd.mission === undefined
        && cmd.tasks === undefined && cmd.scale === undefined && cmd.roundLimit === undefined) {
        return no('Nothing to configure.');
      }
      if (cmd.scale !== undefined && !['skirmish', 'standard', 'large'].includes(cmd.scale as string)) return no('That is not a battle scale.');
      if (cmd.roundLimit !== undefined && (!Number.isInteger(cmd.roundLimit) || cmd.roundLimit < 1 || cmd.roundLimit > 12)) return no('That is not a game length.');
      // Two locks with two clocks, and the difference is FAQ P1's setup order.
      // The MAP is agreed first and freezes the moment it is locked in —
      // everything after the map stage plays on it (3.1.2). The Main Task and
      // its zones are chosen AFTER the First Player roll, so they must stay
      // changeable through the roll and the tasks stage and freeze only when
      // edges are being picked. Gating them on the map's lock is the bug that
      // made the guide's own "Change the Main Task" button refuse in silence:
      // the button exists precisely in the window this used to close.
      const setup = normaliseSetup(state.setup);
      if (cmd.map !== undefined && battlefieldLocked(setup)) {
        return no('The battlefield is locked once the game starts (3.1.2). End the game to change it.');
      }
      if ((cmd.zoneSet !== undefined || cmd.mission !== undefined) && tasksLocked(setup)) {
        return no('The Tasks are settled once edges are picked (FAQ P1). End the game to change them.');
      }
      return ok;
    }
    case 'startMatch': {
      if (normaliseSetup(state.setup)) return no('A game is already running. End it before starting another.');
      // Across a table, the other player has to have said they are ready. A
      // disabled button is a hint, not a rule: the rule lives here, where both
      // clients run it and neither can start the game on the other's behalf.
      if (getLocalSeat()) {
        const other: Side = cmd.seat === 's1' ? 's2' : 's1';
        if (!state.ready?.[other]) return no('The other player has not pressed Ready yet.');
      }
      return ok;
    }
    case 'endMatch': {
      if (!normaliseSetup(state.setup)) return no('No game is running.');
      return ok;
    }
    case 'pickSecondary': {
      if (!(data.secondary ?? []).some((c) => c.id === cmd.cardId)) return no('That is not a Secondary Task card.');
      return ok;
    }
    case 'setTactics': {
      if (!Array.isArray(cmd.cards)) return no('That is not a hand.');
      if (cmd.cards.length > 8) return no('That is more Tactics Cards than any squad could pay for.');
      for (const id of cmd.cards) {
        const card = data.byId.get(id);
        if (!card || card.category !== 'tactics_or_upgrade') return no('That is not a Tactics Card.');
      }
      // Only one copy of each Tactics Card may be purchased (FAQ P2), so a
      // hand with a duplicate is refused whichever picker or import built it.
      if (new Set(cmd.cards).size !== cmd.cards.length) {
        return no('Only one copy of each Tactics Card may be included in a squad (FAQ P2).');
      }
      // The hand is chosen with the squad, so it closes when the game starts —
      // 5.4 has you holding them from the off, not drawing mid-match.
      const su = normaliseSetup(state.setup);
      if (su && su.stage === 'done') return no('The hand is set before the game begins.');
      return ok;
    }
    case 'designateTask': {
      const owed = taskDesignations(data, state);
      const forSide: Side = cmd.for ?? cmd.seat;
      const want = owed.find((d) => d.side === forSide && d.what === cmd.what);
      if (!want) return no('Nothing is waiting to be named for that Task.');
      // The card decides who chooses. Naming on someone else's behalf is how a
      // player would hand themselves an easy target.
      if (want.by !== cmd.seat) return no('That choice belongs to the other player.');
      if (cmd.what === 'zone') {
        if (!missionZones(data, state).some((z) => z.id === cmd.zone)) {
          return no('That is not a Tactical Zone on this battlefield.');
        }
        return ok;
      }
      const t = state.tokens.find((x) => x.uid === cmd.uid);
      if (!t || t.kind !== 'mech') return no('That is not a Mech.');
      if (t.side !== want.owner) return no(`${want.label} names one of the other squad's Mechs.`);
      return ok;
    }
    case 'setRollbackCatalog': {
      if (!state.script) return no('There is no game running.');
      return ok;
    }
    case 'callDefense': {
      const sc = state.script;
      if (!sc) return no('There is no game running.');
      // One defence in the air at a time: a second call while one waits would
      // leave two clients answering different questions.
      if (sc.combat) return no('A defence roll is already being waited on.');
      const at = state.tokens.find((x) => x.uid === cmd.uid);
      if (!at || at.side !== cmd.seat) return no('The attacker is not one of your units.');
      // "On the board" is the whole test, and deliberately so: Automatic Shield
      // moves the defender of a declared attack (FAQ A12), so the unit being
      // defended may legitimately not be the one the Action was designated
      // against. A future pass that tightened this into "must be the designated
      // target" would break the keyword with no test failing.
      if (!state.tokens.some((x) => x.uid === cmd.targetUid)) return no('That target is not on the board.');
      if (!Number.isInteger(cmd.white) || !Number.isInteger(cmd.blue) || cmd.white < 0 || cmd.blue < 0 || cmd.white + cmd.blue > 40) {
        return no('That is not a defence pool.');
      }
      return ok;
    }
    case 'answerDefense': {
      const sc = state.script;
      if (!sc?.combat) return no('No defence roll has been asked for.');
      if (sc.combat.faces) return no('The defence has already been rolled.');
      // Only the DEFENDING player answers: the dice belong to whoever owns the
      // unit being shot at, which is the whole point of asking.
      const t = state.tokens.find((x) => x.uid === sc.combat!.targetUid);
      if (!t || t.side !== cmd.seat) return no('The defence belongs to the defending squad.');
      if (!Array.isArray(cmd.faces) || cmd.faces.length > 40) return no('That is not a defence roll.');
      return ok;
    }
    case 'clearDefense': {
      // Idempotent: clearing an already-clear record is a no-op, not a
      // refusal. The attacker's answer-consumer and its cancel path can both
      // send one, and refusing the second read as a desync on the other
      // client — two refusals in six seconds is the resync alarm.
      return ok;
    }
    case 'focusAnswer': {
      if (!state.script) return no('There is no game running.');
      if (typeof cmd.use !== 'boolean') return no('That is not a Focus answer.');
      return ok;
    }
    case 'designateHit': {
      if (!state.script) return no('There is no game running.');
      if (typeof cmd.slot !== 'string' || !cmd.slot) return no('That is not a Part.');
      return ok;
    }
    case 'meleeEvade':
    case 'dodgeEnhance': {
      if (!state.script) return no('There is no game running.');
      return ok;
    }
    case 'riposte': {
      const sc = state.script;
      if (!sc) return no('There is no game running.');
      // The debt is the authority, exactly as it is for the granted Action --
      // this ends the OTHER seat's Opportunity, so it may not be sendable on a
      // say-so.
      if (!(sc.reactions ?? []).some((r) => r.uid === cmd.uid && r.kind === 'riposte')) {
        return no('Nothing has granted this unit a Riposte.');
      }
      if (!sc.opp || sc.opp.uid !== cmd.fromUid) {
        return no('That Mech is no longer in the Action Opportunity this would end.');
      }
      return ok;
    }
    case 'kcArmor': {
      if (!state.script) return no('There is no game running.');
      return ok;
    }
    case 'focusReroll': {
      if (!state.script) return no('There is no game running.');
      if (!Array.isArray(cmd.indices) || !Array.isArray(cmd.faces) || cmd.indices.length !== cmd.faces.length) {
        return no('That is not a Focus reroll.');
      }
      if (cmd.indices.length > 40 || cmd.indices.some((i) => typeof i !== 'number' || i < 0 || i > 40)) {
        return no('That is not a Focus reroll.');
      }
      if (cmd.faces.some((f) => !f || typeof f.color !== 'string' || typeof f.face !== 'number')) {
        return no('That is not a Focus reroll.');
      }
      return ok;
    }
    case 'setCombatView': {
      if (!state.script) return no('There is no game running.');
      const view = cmd.view;
      if (view === null) return ok;
      const at = state.tokens.find((x) => x.uid === view.attackerUid);
      // The window belongs to the attacking squad: nobody publishes an attack
      // for units they do not own. `view.targetUid` is NOT checked against the
      // designated target on purpose — Automatic Shield may have moved it (FAQ
      // A12), and only the attacker's client computes that swap. Ownership never
      // moves with it, because the shield is always the target's own ally.
      if (!at || at.side !== cmd.seat) return no('The combat window belongs to the attacking squad.');
      if ((view.attack?.length ?? 0) > 40 || (view.defense?.length ?? 0) > 40) return no('That is not a dice pool.');
      if ((view.log ?? []).some((l) => typeof l !== 'string' || l.length > 400)) return no('That is not a combat log.');
      // The resolution strip is drawn into the OTHER player's window, so it is
      // bounded here the way the pools and the log are. No legal attack makes
      // forty damage icons, and the summary is three lines plus its notes. The
      // two spare counts are bounded for a sharper reason than tidiness: they
      // are loop lengths on the receiving client, and the number comes from the
      // sending one.
      //
      // The lists are required to BE lists, not merely short: the renderer maps
      // over them, and a strip that throws mid-render takes the whole mirror
      // down with it rather than just being wrong.
      const res = view.resolution;
      const spare = (n: unknown) =>
        n !== undefined && n !== null && (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > 40);
      const list = (v: unknown) => !Array.isArray(v) || v.length > 40;
      // The ELEMENTS, not just the list lengths. Every icon lands in a class
      // name and a title attribute on the far screen, so a peer sending
      // `icons: [null]` or a 50KB `kind` costs the defender their whole HUD
      // render rather than just the box. Bounding the lists alone left that
      // open. `offset` is normalised by the renderer, so an unknown value is
      // survivable and only the shape is refused here.
      const icon = (v: unknown): boolean => {
        if (!v || typeof v !== 'object') return true;
        const k = (v as { kind?: unknown }).kind;
        return typeof k !== 'string' || k.length > 40;
      };
      const badIcons = (v: unknown) => list(v) || (v as unknown[]).some(icon);
      if (res && (!res.duel || badIcons(res.duel.icons) || badIcons(res.duel.triggers)
        || spare(res.duel.spareDodge) || spare(res.duel.idleDefense)
        || !Array.isArray(res.text)
        || res.text.some((l) => typeof l !== 'string' || l.length > 400))) {
        return no('That is not a combat resolution.');
      }
      return ok;
    }
    case 'rollbackRequest': {
      const sc = state.script;
      if (!sc) return no('There is no game running to roll back.');
      if (sc.rollback) return no('A rollback request is already waiting on an answer.');
      // The CURRENT phase is a legal target, and the most useful one: it means
      // the board as this phase began, which is not the board now. Only a
      // target genuinely ahead of the present is refused.
      if (cmd.round > state.round.n || (cmd.round === state.round.n && cmd.phase > state.round.phase)) {
        return no('A rollback goes backwards.');
      }
      // The target has to be one the HOST published, because the host's ring is
      // the only one that rewinds. Asking straight from a local undo history
      // could name a point the host has already dropped — the request would be
      // accepted, both players would watch it fail, and nothing would move.
      // Both seats read the same catalog out of the same shared state, so there
      // is no version to compare and no staler copy to be holding.
      // A UNIT ask (v2) names the exact catalog entry by seq; a phase ask (v1)
      // still matches on round and phase alone. Both go through the same gate:
      // the entry must exist in the HOST's published list and be reachable.
      const at = cmd.seq !== undefined
        ? sc.rollbackCatalog.find((p) => p.seq === cmd.seq)
        : sc.rollbackCatalog.find((p) => p.round === cmd.round && p.phase === cmd.phase && p.seq === undefined);
      if (!at) return no('That point is no longer one the table can return to.');
      if (at.sealed) return no('Dice were rolled inside that action, and a rollback never reaches past a roll.');
      if (!at.available) return no('Dice have been rolled since then, and a rollback never reaches past a roll.');
      return ok;
    }
    case 'rollbackAnswer': {
      const sc = state.script;
      if (!sc?.rollback) return no('Nothing has been asked.');
      // The asker cannot APPROVE their own rollback: consent is the whole
      // point, and a shared board rewound by one player is just a desync. They
      // may withdraw it, though — declining your own ask harms nobody, and it
      // is the only way to take a request back.
      if (sc.rollback.by === cmd.seat && cmd.accept) {
        return no('The other player has to agree to a rollback.');
      }
      return ok;
    }
    case 'setReady': {
      // Two moments wait on a ready signal: the lobby before launch, and the
      // deployment stage, where "Begin Round 1" needs both squads to agree.
      const su = normaliseSetup(state.setup);
      // 'done' joined the list when phase turns became a two-player agreement:
      // mid-game, Continue marks a seat ready and the completed pair advances.
      if (su && su.stage !== 'deploy' && su.stage !== 'done') return no('Nothing is waiting on a ready signal right now.');
      return ok;
    }
    case 'importSquad': {
      const mechs = Array.isArray(cmd.mechs) ? cmd.mechs : [];
      const drones = Array.isArray(cmd.drones) ? cmd.drones : [];
      if (!mechs.length && !drones.length) return no('The squad is empty.');
      for (const m of mechs) {
        if (!m.loadout?.torso && !m.loadout?.chasis) return no('A Mech needs at least a Torso or a Chassis.');
        for (const id of Object.values(m.loadout ?? {})) {
          if (id && !data.byId.get(id)) return no(`The database has no card "${id}", so this squad cannot be built.`);
        }
      }
      for (const d of drones) {
        if (!data.byId.get(d.cardId ?? '')) return no(`The database has no card "${d.cardId}", so this squad cannot be built.`);
        if (d.backpack && !data.byId.get(d.backpack)) return no(`The database has no card "${d.backpack}", so this squad cannot be built.`);
      }
      // In a running game a squad joins before deployment closes (3.1.4).
      // "Running" is what the round tracker calls it — a setup block exists.
      // End game clears the setup but leaves the script standing, so the
      // script alone must not lock a table that has gone back to free play.
      const su = normaliseSetup(state.setup);
      if (su && su.stage === 'done') {
        return no('Squads join before deployment is finished (3.1.4). End the game to change the table freely.');
      }
      return ok;
    }
    case 'advancePhase': {
      const su = normaliseSetup(state.setup);
      if (su && su.stage !== 'done') return no('Finish the pre-game roll and deployment first (3.1).');
      // A designation loop ends when neither squad can or will go on (3.2.3).
      // The rule used to live only in which panel drew a Continue button, and a
      // stale or racing press skipped a live Command Phase for both players —
      // OTTO lost Round 1's drone Commands to exactly that. Networked play
      // refuses; the sandbox and guide still warn through perform().
      if (getLocalSeat() && state.script) {
        const ph = PHASES[state.round.phase];
        if (isLoopPhase(ph) && !loopComplete(state, ph)) {
          return no(`The ${ph} Phase is not over: a squad can still designate, and a squad done for the phase passes instead (3.2.3).`);
        }
        // And even a finished phase turns only when BOTH players have pressed
        // Continue: one player reading a card is not a player who agreed to
        // move on, and being kicked out of a picker mid-thought is how it
        // felt. The flags are consumed by the advance, so every phase asks
        // afresh — the same agreement deployment already used.
        if (!(state.ready?.s1 && state.ready?.s2)) {
          return no('Both players press Continue before the phase turns.');
        }
      }
      return ok;
    }
    case 'setPhase': {
      if (!Number.isInteger(cmd.phase) || cmd.phase < 0 || cmd.phase >= PHASES.length) return no('That is not a phase.');
      return ok;
    }
    case 'resetRounds':
      return ok;
    case 'adjustCommandTokens': {
      if (!Number.isInteger(cmd.delta) || cmd.delta === 0) return no('Nothing to adjust.');
      if ((state.commandTokens?.[cmd.pool] ?? 0) + cmd.delta < 0) return no('A Command Token pool cannot go below zero.');
      return ok;
    }
    case 'passTurn': {
      if (!state.script) return no('There is no guided game running.');
      if (!isLoopPhase(PHASES[state.round.phase])) return no('There is no designation loop to pass in this phase.');
      if (state.script.passed.includes(cmd.seat)) return no('This squad has already passed for the phase (3.2.2).');
      return ok;
    }
    case 'markEndStep': {
      if (!state.script) return no('The End Phase checklist belongs to a guided game.');
      if (state.round.phase !== PHASES.length - 1) return no('These steps belong to the End Phase (3.7).');
      return ok;
    }
    case 'award': {
      // A side's award can legitimately be NEGATIVE: cards 300 and 500 both
      // print "-1 Victory Point if this Part is destroyed", the penalty settles
      // once at the end of the game, and there is no matching + in the same
      // award to net it against. A lone -1 is the base case, so the contract
      // has to accept it — the FLOOR lives on the running total in apply(),
      // never on the delta, because clamping the delta makes the -1 vanish.
      //
      // Bounded rather than merely finite while the line is open: a whole game
      // is worth well under 60 VP and no rider stack reaches -10, so anything
      // outside that is a bug in the caller rather than a score.
      if (!Number.isInteger(cmd.vp.s1) || !Number.isInteger(cmd.vp.s2)) return no('That is not a score.');
      const wild = (n: number): boolean => n < -10 || n > 60;
      if (wild(cmd.vp.s1) || wild(cmd.vp.s2)) return no('That is not a score.');
      // Warn, do not block: the award still lands, floored at zero (5.2.4).
      const banked = normaliseTasks(state.tasks).vp;
      if (banked.s1 + cmd.vp.s1 < 0 || banked.s2 + cmd.vp.s2 < 0) {
        return { ok: true, note: 'A squad cannot finish below zero Victory Points, so the penalty is floored at 0.' };
      }
      return ok;
    }
    case 'lockMap': {
      const su = normaliseSetup(state.setup);
      // Locking the battlefield is a step inside setup, so there has to be a
      // setup to be inside. Without this the command conjures one, which makes
      // it a second way to start a match — one that answers to none of the
      // agreements the real one does.
      if (!su) return no('No game is running.');
      if (su.stage !== 'map') return no('The battlefield is already locked (3.1.2).');
      return ok;
    }
    case 'rollSetup': {
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'roll') return no('The table-edge roll comes after the battlefield is locked (3.1.2).');
      if (!Array.isArray(cmd.hits) || !cmd.hits.length || cmd.hits.some((h) => !Number.isInteger(h) || h < 0)) return no('That is not a roll.');
      return ok;
    }
    case 'acceptRoll': {
      const su = normaliseSetup(state.setup);
      if (!su || !firstPlayerFrom(su)) return no('The roll is tied, so it must be made again (3.1.2).');
      return ok;
    }
    // Dice already landed on the shared table; recording that fact can never
    // be the thing that is refused.
    case 'noteRoll': {
      if (typeof cmd.what !== 'string') return no('That is not a roll record.');
      return ok;
    }
    case 'finishTasks': {
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'tasks') return no('The Tasks step is not open.');
      return ok;
    }
    case 'pickEdge': {
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'side') return no('The table-edge pick follows the First Player roll (3.1.2).');
      if (cmd.seat !== state.round.firstPlayer) return no('The First Player picks the table edge (3.1.2).');
      if (cmd.edge !== 'black' && cmd.edge !== 'white') return no('That is not a table edge.');
      return ok;
    }
    case 'lockDials': {
      if (!state.script) return no('There is no guided game running.');
      if (state.round.phase !== 1) return no('Dials lock at the end of the Planning Phase (3.3).');
      return ok;
    }
    case 'finishDeployment': {
      if (!deploymentComplete(state)) return no('Units are still waiting to deploy (3.1.4).');
      // Both squads confirm before Round 1 begins, and the confirmation is
      // checked here rather than only drawn in the panel, so neither player
      // can push the other out of deployment.
      if (getLocalSeat() && !(state.ready?.s1 && state.ready?.s2)) {
        return no('Both squads confirm their deployment before Round 1 begins.');
      }
      return ok;
    }
    case 'queueIntercepts': {
      if (!state.script) return no('There is no guided game running.');
      if (!cmd.items.length) return no('No Interceptions owed.');
      if (cmd.items.some((x) => !Number.isInteger(x.uid) || !Number.isInteger(x.targetUid) || typeof x.actionId !== 'string')) {
        return no('That is not an Interception.');
      }
      return ok;
    }
    case 'clearIntercepts': {
      if (!state.script) return no('There is no guided game running.');
      return ok;
    }
    case 'clearCounterRoll': {
      if (!state.script?.counter) return no('No Electronic Counter-roll is open.');
      return ok;
    }
    case 'placeSmoke': {
      const { col, row } = cmd.at;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 11 || row > 11) return no('That is not a Grid.');
      return ok;
    }
    case 'queueReactions': {
      if (!state.script) return no('There is no guided game running.');
      for (const it of cmd.items) {
        if (!state.tokens.some((x) => x.uid === it.uid)) return no('That unit is not on the board.');
        // A Target Tracing debt has to name the attacker: the Counter-roll it
        // opens is against them and nobody else.
        if (it.kind === 'trace' && !state.tokens.some((x) => x.uid === it.fromUid)) return no('That attacker is not on the board.');
      }
      return ok;
    }
    case 'removeSmoke': {
      if (!(state.smoke ?? []).some((x) => x.col === cmd.at.col && x.row === cmd.at.row)) return no('There is no Smoke Screen there.');
      return ok;
    }
    case 'dissipateSmoke':
      return ok;
    case 'setMode': {
      if (cmd.mode !== 'hotseat' && cmd.mode !== 'hidden') return no('That is not a table mode.');
      if (!state.script) return no('There is no guided game running.');
      return ok;
    }
    case 'handOver': {
      const sc = state.script;
      if (!sc || sc.mode !== 'hidden') return no('Handing over belongs to pass-and-play.');
      if (state.round.phase !== 1) return no('The device is handed over during the Planning Phase (3.3).');
      if (sc.stage === `${state.round.n}:1:locked`) return no('The dials are already locked in.');
      if (sc.turn !== cmd.seat) return no('The device is not with this squad.');
      return ok;
    }
    case 'setStrict': {
      if (!state.script) return no('There is no guided game running.');
      return ok;
    }
    case 'commitTimings': {
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      if (state.round.phase !== 1) return no('Dials are committed in the Planning Phase (3.3).');
      if (typeof cmd.hash !== 'string' || cmd.hash.length < 16) return no('That is not a commitment.');
      // A fresh commitment may REPLACE this seat's own — a reloaded client has
      // lost the dials and salt behind its old hash (they are local by design)
      // and re-committing is its only way back. The door closes the moment
      // anyone reveals: from then on a new hash could be chosen with the other
      // squad's dials on the table, which is the exact cheat the handshake
      // exists to prevent.
      if (sc.commits[cmd.seat] && sc.revealed.length) {
        return no('The dials are already being revealed, so the commitment cannot change this round.');
      }
      return ok;
    }
    case 'revealTimings': {
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      // A reveal is only meaningful against a commitment made earlier — that
      // pairing is the whole guarantee, so an uncommitted reveal is refused.
      if (!sc.commits[cmd.seat]) return no('That squad never committed its dials, so there is nothing to check the reveal against.');
      if (sc.revealed.includes(cmd.seat)) return no('This squad has already revealed.');
      if (typeof cmd.salt !== 'string' || !Array.isArray(cmd.dials)) return no('That is not a reveal.');
      return ok;
    }
  }
}

// The Tactical Zones this battlefield actually has: the Main Task places them,
// so anything else would be naming a place neither player can see.
export function missionZones(data: GameData, state: GameState): { id: string; name: string }[] {
  const mission = state.mission ? data.missions.cards.find((m) => m.id === state.mission) : undefined;
  const placed = new Set(mission?.zones ?? []);
  return (data.zoneData?.zones ?? []).filter((z) => placed.has(z.name) || placed.has(z.id));
}

// Everything Task Setup is still waiting to have named, and who names it.
export function taskDesignations(data: GameData, state: GameState): Designation[] {
  const mission = state.mission ? data.missions.cards.find((m) => m.id === state.mission) : undefined;
  return pendingDesignations(normaliseTasks(state.tasks), data.secondary ?? [], mission, state.tokens);
}

// The small cells a unit of this size covers standing at `at`. Mirrors the
// footprint standingSpot and spotsInGrid walk, kept here because check() must
// not import the board.
function cellsUnder(size: number, at: { col: number; row: number }): string[] {
  const out: string[] = [];
  for (let dc = 0; dc < size; dc++) for (let dr = 0; dr < size; dr++) out.push(`${at.col + dc},${at.row + dr}`);
  return out;
}

// Whether every Unit in a Crush exchange fits where it is being sent: not on
// each other, not on a third Unit, and not inside Terrain. The one rule the
// movement commands never enforced, and the whole reason a failed Crush used to
// leave two units sharing a Large Grid.
//
// Aerial Units are ignored on both sides of the test, exactly as standingSpot
// ignores them: they are above the Grid rather than in it.
function exchangeRoomWhy(
  data: GameData,
  state: GameState,
  crusher: Token,
  swapped: Token[],
  cmd: { to: { col: number; row: number }; swaps: { uid: number; to: { col: number; row: number } }[] },
): string | null {
  // A custom map's pieces live on the board page, so this reads the built-in
  // layout it can see — the same compromise placeInGrid makes. The unit
  // occupancy below is the half that keeps two clients agreeing either way.
  const gone = new Set(state.removedTerrain ?? []);
  const terrain = new Set<string>();
  for (const p of data.terrain?.layouts?.[state.map] ?? []) {
    if (gone.has(p.id)) continue;
    for (const cell of p.subCells) terrain.add(`${cell.col},${cell.row}`);
  }
  const leaving = new Set([crusher.uid, ...swapped.map((v) => v.uid)]);
  const held = new Map<string, string>();
  for (const o of state.tokens) {
    if (leaving.has(o.uid) || o.aerial || o.deployed === false) continue;
    for (const k of cellsUnder(o.size, o)) held.set(k, o.label);
  }
  const arriving: [Token, { col: number; row: number }][] = [[crusher, cmd.to]];
  for (const v of swapped) {
    const to = cmd.swaps.find((s) => s.uid === v.uid)?.to;
    if (to) arriving.push([v, to]);
  }
  for (const [unit, at] of arriving) {
    for (const k of cellsUnder(unit.size, at)) {
      const who = held.get(k);
      if (who) return `${unit.label} has nowhere to land in that Crush: ${who} is standing there.`;
      if (!unit.aerial && terrain.has(k)) return `${unit.label} has nowhere to land in that Crush: Terrain is in the way.`;
      held.set(k, unit.label);
    }
  }
  return null;
}

// The most Large Grids any one Movement of this Unit could cover, which is the
// only question check() can honestly ask about how far a Crush travelled — see
// the call site in `crushSwap` for why the route itself is out of reach here.
//
// A CEILING, deliberately, not a price. It is the largest allowance the Unit
// could have declared the Movement with, and nothing about what that Movement
// actually spent: Break Away (4.3.5) makes steps dearer, a Harpy's tow takes 2
// off the top (ZHDR-304), and neither can make a Movement reach FURTHER, so
// leaving both out only ever makes this more generous. Every step of a route is
// one orthogonal Grid and costs at least 1 (rules.ts searchMoves), so the Grid
// distance between the two ends of ANY legal Movement is at most this number.
//
// Two sources, because both pages take `action.range || maneuverRange` and the
// two are unrelated numbers: a Chassis prints a Maneuver Value of 1-2 Grids
// while a Sprint prints 4 and card 088's Long Jump prints 8. The gather is
// findAction's — the Unit's own Parts, plus a Backpack lent by a Carrier
// Tarantula in Contact, whose Actions are this Mech's Actions while it acts
// (FAQ O3/O16).
//
// A WRECKED PART DECLARES NOTHING, which is why the unit's own Parts are
// filtered on partStates and the ceiling is not simply the widest Range printed
// on the cards it is carrying. The two halves of this number disagreed without
// the filter: maneuverRange returns 0 outright for a destroyed Chassis (3.4.4,
// FAQ E4) and maneuverBonus already drops a destroyed Part, while the loop below
// read the wreck anyway. Driven by the round-5 reviewer (2026-08-19): a Mech
// with Chassis 179 and Backpack 088 BOTH destroyed reads Maneuver Value 0 and
// still bought an 8-Grid crushSwap off the Long Jump printed on the dead
// Jetpack, an allowance it could not have declared the Movement with.
//
// A LOANED Part is a different question and is deliberately not looked up here:
// its slot key names the LENDER (`load:<uid>`), not a slot of this Mech, so
// t.partStates could only answer about it by accident. loanedParts already
// refuses a Carrier whose own Part or Backpack is destroyed (FAQ O3/O16), so
// the state test for that half lives where the lending is decided.
function movementReach(data: GameData, state: GameState, t: Token): number {
  let reach = maneuverRange(data, t);
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates?.[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      if (a.type === 'Moving') reach = Math.max(reach, a.range ?? 0);
    }
  }
  for (const { card } of loanedParts(data, state.tokens, t)) {
    for (const a of card.actions ?? []) {
      if (a.type === 'Moving') reach = Math.max(reach, a.range ?? 0);
    }
  }
  return reach;
}

export function check(data: GameData, state: GameState, cmd: Command): CheckResult {
  if (tableLevel(cmd)) return checkTable(data, state, cmd);
  const t = state.tokens.find((x) => x.uid === cmd.uid);
  if (!actorOptional(cmd)) {
    if (!t) return no('That unit is not on the board.');
    if (t.side !== cmd.seat) return no(`${t.label} belongs to the other squad, and a player may only command their own units.`);
    return checkActed(data, state, cmd, t);
  }
  if (t && t.side !== cmd.seat) return no(`${t.label} belongs to the other squad, and a player may only command their own units.`);

  switch (cmd.kind) {
    case 'forceMove': {
      // The path and blocking rules stay with the caller, which computed where
      // the Forced Movement actually ends; this covers everything else.
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      // A Barricade "can neither move, be moved, nor be Crushed" (FAQ E6/M13,
      // Rules Supplement 1.1.3). Knockback, Push, the Crush shuffle and the
      // Harpy's tow all travel as this one command, so the exemption is stated
      // once here instead of at each of the eight senders. rules.ts
      // knockbackPath and crushTargets are the halves that stop the UI offering
      // it; this is the belt to those braces, and the only one that holds in a
      // networked game where a stale client could still send the shove.
      //
      // Only a change of PLACE is refused: 3.4.4 lets the forcing player turn a
      // victim that could not be moved at all, and this command carries that
      // turn as `facing` with the position left where it stands.
      if (target.barricade && (col !== target.col || row !== target.row)) {
        return no(`${target.label} is a Barricade: it can neither move nor be moved (FAQ E6/M13).`);
      }
      return ok;
    }
    case 'recordKill': {
      if (!state.tokens.some((x) => x.uid === cmd.targetUid)) return no('That target is not on the board.');
      return ok;
    }
    case 'drainLink': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.kind !== 'mech') return no('Only a Mech has Link to lose.');
      if (!Number.isInteger(cmd.n) || cmd.n < 1 || cmd.n > 12) return no('That is not a Link drain.');
      return ok;
    }
    case 'destroyTerrain': {
      if (!cmd.pieces.length) return no('No terrain named.');
      const gone = new Set(state.removedTerrain ?? []);
      if (cmd.pieces.every((p) => gone.has(p))) return no('That terrain is already destroyed.');
      return ok;
    }
    case 'resolveIntercept': {
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      if (!sc.intercepts.some((x) => x.uid === cmd.uid && x.actionId === cmd.actionId && x.targetUid === cmd.targetUid)) {
        return no('That Interception is not owed.');
      }
      return ok;
    }
    case 'dropBlackBox': {
      const box = normaliseTasks(state.tasks).items.find((i) => i.id === cmd.itemId);
      if (!box || box.kind !== 'blackbox') return no('That is not a Black Box.');
      if (box.bearerUid === undefined) return no('That Black Box is already on the board.');
      const bearer = state.tokens.find((x) => x.uid === box.bearerUid);
      if (!bearer) return no('Whatever was carrying that Black Box has left the board.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      // "In contact with the bearer's base" is the Grid it stands in or one
      // touching it, diagonals included (5.3.1).
      const near = Math.max(Math.abs(Math.floor(col / 3) - Math.floor(bearer.col / 3)), Math.abs(Math.floor(row / 3) - Math.floor(bearer.row / 3)));
      if (near > 1) return no(`A dropped Black Box lands in contact with ${bearer.label}'s base (5.3.1).`);
      return ok;
    }
  }
}

function checkActed(
  data: GameData,
  state: GameState,
  cmd: Exclude<Command, { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' | 'resolveIntercept' | 'dropBlackBox' | 'drainLink' | TableKind }>,
  t: Token,
): CheckResult {
  switch (cmd.kind) {
    case 'setTiming': {
      if (t.kind !== 'mech') return no('Only a Mech has a Timing Dial. Drones act in the Command and Automatic Phases instead.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech cannot set a dial.');
      if (cmd.timing !== undefined && !TIMINGS.some((x) => x.id === cmd.timing)) return no('That is not a Timing the dial can be set to.');
      if (state.round.phase !== 1) return no('Dials are set in the Planning Phase (3.3).');
      if (dialHidden(state, t)) return no('In pass-and-play a squad sets its dials on its own planning turn (3.3).');
      return ok;
    }
    case 'placeInGrid': {
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      if (t.size >= 3) return no('A Large unit fills its whole Grid, so there is nowhere else to stand in it.');
      if (Math.floor(col / 3) !== Math.floor(t.col / 3) || Math.floor(row / 3) !== Math.floor(t.row / 3)) {
        return no('This only shifts a unit inside the Grid it is already in — moving between Grids is a Maneuver.');
      }
      // A custom map's pieces live on the board page, so check() reads the
      // built-in layout it can see; a custom board still gets the same-Grid
      // and occupancy checks, which are the ones that keep the two clients
      // agreeing.
      const gone = new Set(state.removedTerrain ?? []);
      const terrain = (data.terrain?.layouts?.[state.map] ?? []).filter((p) => !gone.has(p.id));
      const spot = spotsInGrid(t, terrain, state.tokens).find((s) => s.col === col && s.row === row);
      if (!spot) return no('That is not a spot in this Grid.');
      if (!spot.ok) return no('Something is already standing there.');
      return ok;
    }
    case 'setStance': {
      if (t.kind !== 'mech') return no('Only a Mech chooses a Stance. A Drone plays the one printed on its card.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech has no Stance to change.');
      if (!STANCES.includes(cmd.stance)) return no('That is not a Stance.');
      if (t.stance === 'shutdown' && cmd.stance !== 'shutdown') {
        return no('Leaving Shutdown Stance takes a Reboot, which costs the Action Opportunity (4.1.1).');
      }
      // 4.1: the Stance is chosen at the START of the Action Opportunity, so it
      // may be cycled freely until the Mech does something — reading which
      // Actions each Stance opens up is how the choice gets made. The moment it
      // moves or acts the dial is set, which is the rule the old version tried
      // to enforce by refusing to act at all until a Stance was confirmed.
      const so = oppOf(state, cmd.uid);
      if (so?.stanceLocked && cmd.stance !== t.stance) {
        return no('This Mech has already acted this Action Opportunity, so its Stance is set (4.1).');
      }
      return ok;
    }
    case 'defenseReaction': {
      if (t.kind !== 'mech') return no('Only a Mech chooses a Stance.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech has no Stance to change.');
      if (t.stance === 'shutdown') return no('Leaving Shutdown Stance takes a Reboot (4.1.1).');
      if (t.stance === 'defensive') return no(`${t.label} is already in Defensive Stance.`);
      if (!defenseReactionOn(data, t)) return no(`${t.label} has no Part that reacts to a Penetration.`);
      return ok;
    }
    case 'reboot': {
      if (t.kind !== 'mech') return no('Only a Mech Reboots.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech cannot Reboot.');
      if (t.stance !== 'shutdown') return no('Only a Mech in Shutdown Stance may Reboot (4.1.1).');
      if (!STANCES.includes(cmd.stance) || cmd.stance === 'shutdown') return no('A Reboot ends in one of the three active Stances.');
      return ok;
    }
    case 'maneuver': {
      // IMMOBILIZED (6.3.2). Refused HERE rather than only in the two boards'
      // movers, because this is the rule and those were a courtesy: the ban
      // lived in two freeplay UI handlers and nowhere else, so it did not exist
      // online at all. Unstoppable is the printed exception and is read off the
      // Action that travelled, never off the card.
      //
      // Only VOLUNTARY movement. `forceMove` is somebody else displacing this
      // unit and stays legal, which is the whole reason the two are separate
      // commands.
      const moveAction = cmd.actionId ? findAction(data, state, cmd.uid, cmd.actionId) : null;
      const stopped = immobilizedStop(t, moveAction);
      if (stopped) return no(stopped);
      // NON-HUMANOID X (card 181's Run is Non-humanoid 1): the Link is a COST of
      // performing the Action, so a unit that cannot pay may not perform it. A
      // bare Maneuver carries no Action and can never owe this.
      const shortLink = nonHumanoidStop(t, moveAction);
      if (shortLink) return no(shortLink);
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      // WHERE THE MOVEMENT STARTED, and the only rules-bearing number on this
      // command the SENDER chooses. check() took it on trust, which is the very
      // mistake the crushSwap round refused to make when it declined to have
      // the pages send the step-out Grid: it makes this reader trust a number
      // the sender supplies, and the sender is the thing this reader exists to
      // distrust.
      //
      // DRIVEN before this guard existed (round-4 reviewer, 2026-08-19): a
      // Drone commanded by a Mech carrying M2 Data Link (card 176, preMove 1)
      // walked five Grids and sent the honest `to` with `from` set to the
      // LANDING Grid. apply() measured zero Grids travelled, handed it the M2
      // free pre-move, and left the Maneuver Tick unspent and the Drone open, a
      // five-Grid walk laundered into the free grid. `from: { col: 99, row: 99
      // }` wrote an OFF-BOARD start into the Opportunity's movedFrom, which is
      // what the start-and-landing readers are handed as "where it stood" (FAQ
      // O11/O15), so the Reveal sweep judged a unit that was nowhere.
      //
      // BOUNDED BY THE BOARD, never by the sender's word about itself. There is
      // exactly one honest sender, matchhud finishCrush's follow-up to a
      // crushSwap, and it is recognisable without asking: that command has
      // ALREADY placed the crusher on its landing spot (4.3.6 moves both Units
      // at once so no snapshot lands between the halves), so the token is
      // standing on `to` by the time this arrives. Every other Maneuver either
      // page sends travels while the token still stands where the Movement
      // began and leaves the field out, so asking the board whether the
      // placement really happened refuses nothing legitimate.
      //
      // ABOVE the `granted` return below, deliberately: finishCrush passes the
      // plan's own `granted` straight through, so a Hit and Run (276) Movement
      // that ends in a Crush carries `from` too, and a guard under that return
      // would be the one line a spoofer could step around.
      //
      // NO DISTANCE CEILING here, and that is a ruling rather than an omission.
      // The crushSwap guard below bounds a claim that can only be too FAR; the
      // lie this field buys is one that is too NEAR, and a ceiling cannot see
      // it. movementReach is not stable across the exchange either: a Carrier
      // Tarantula's loaned Backpack raises it (FAQ O3/O16) and the Contact that
      // lends it is broken by the very Movement being recorded, so a reach read
      // here could refuse the honest follow-up, which is the one thing this
      // must not do. What is left over, the exact Grid a real Crush started in,
      // is still the sender's word; closing that needs the engine to REMEMBER
      // the start in crushSwap rather than be told it, and that is a new piece
      // of fingerprinted state with its own round of work.
      if (cmd.from) {
        const fc = cmd.from.col, fr = cmd.from.row;
        if (!Number.isInteger(fc) || !Number.isInteger(fr) || fc < 0 || fr < 0 || fc > 35 || fr > 35) {
          return no('That is not a place on the board.');
        }
        if (t.col !== cmd.to.col || t.row !== cmd.to.row) {
          return no(`${t.label} is not standing where this Movement ends, so nothing has already placed it: a Movement starts from where the Unit stands, and only the 4.3.6 position exchange records one from anywhere else.`);
        }
      }
      // The Tether leash, and the one piece of path law that does belong here:
      // it is a test on the DESTINATION, so it needs no pathfinder. Only the
      // tethered end is capped — the initiator walking out is a removal
      // condition (PDLH-202), never an illegal move — and only a voluntary
      // Movement is judged, which is exactly what this command is: Forced
      // Movement travels as forceMove.
      const leash = tetherCap(t, state.tokens);
      if (leash && !leash(Math.floor(col / 3), Math.floor(row / 3))) {
        const x = (t.tether ?? []).filter((l) => l.role === 'tethered')[0]?.range ?? 0;
        return no(`${t.label} is Tethered and cannot voluntarily move beyond ${x} Grids of the unit holding it (PDLH-202).`);
      }
      // A Movement a card handed out belongs to the card, not to an Action
      // Opportunity: Hit and Run moves a Mech as its Opportunity ends, when
      // there is no longer one to check against or to charge.
      if (cmd.granted) return ok;
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this Mech\'s Action Opportunity.');
      // 3.2.2 ②: a Drone's Movement is the Command Phase's choice. Its
      // Automatic-Phase activation performs Automatic Actions only (3.5), so a
      // move there is refused — Projectiles are untouched, their flight is part
      // of the Delay activation (3.6).
      if (t.kind === 'drone') {
        const ph = PHASES[state.round.phase];
        const why = isLoopPhase(ph) ? droneMoveWhy(ph) : null;
        if (why) return no(why);
      }
      // A free move rides on an Action that has already been performed; without
      // one there is nothing that could have moved the unit.
      if (cmd.free) {
        return o.performed.length ? ok : no('No Action has been performed this Opportunity, so there is nothing to move with.');
      }
      return fromVerdict(canManeuver(o));
    }
    case 'crushSwap': {
      // 4.3.6: the crushed Unit with nowhere to go exchanges positions with the
      // Crushing Unit. The geometry stays with the caller — rules.ts
      // crushExchange is the one place it is worked out, and both pages call it
      // — so this covers what a stale networked client could still get wrong.
      if (!cmd.swaps.length) return no('A Crush exchange has to name the Unit being exchanged.');
      for (const p of [cmd.to, ...cmd.swaps.map((s) => s.to)]) {
        if (!Number.isInteger(p.col) || !Number.isInteger(p.row) || p.col < 0 || p.row < 0 || p.col > 35 || p.row > 35) {
          return no('That is not a place on the board.');
        }
      }
      // Only a Large Ground Unit Crushes, and only Units no larger than itself
      // (4.3.6; LPA-23 Onyx is the trait that lets the two be equal, so this
      // refuses LARGER and not merely equal). Flying cannot Crush at all (FAQ
      // E14) and neither can an Aerial Unit, which passes overhead.
      if (t.size !== 3 || t.aerial) return no('Only a Large Ground Unit Crushes (4.3.6).');
      const swapped: Token[] = [];
      for (const s of cmd.swaps) {
        const v = state.tokens.find((x) => x.uid === s.uid);
        if (!v) return no('That target is not on the board.');
        // 4.3.6 is "Units SMALLER than itself", and LPA-23 Onyx's 不屈 is the one
        // printed relaxation of it. rules.ts crushTargets asks exactly this, so
        // asking a looser question here would make the authoritative reader the
        // PERMISSIVE one: every Large Mech could crush an equal-size Unit through
        // a hand-built command, while the boards correctly refused to offer it.
        // Read the live pilot field for the same reason crushTargets does, which
        // is written out at INDOMITABLE_PILOT in rules.ts.
        const indomitable = t.kind === 'mech' && t.mech?.pilot === 'LPA-23';
        if (indomitable ? v.size > t.size : v.size >= t.size) {
          return no(`${v.label} is not smaller than ${t.label}, so it cannot be Crushed (4.3.6).`);
        }
        // A Barricade "can neither move, be moved, nor be Crushed" (FAQ E6/M13,
        // Rules Supplement 1.1.3). forceMove states this for the shove; the
        // exchange is a second way a Crush can move something, so it needs its
        // own line rather than leaning on rules.ts crushTargets alone.
        if (v.barricade) return no(`${v.label} is a Barricade: it can neither move nor be moved (FAQ E6/M13).`);
        swapped.push(v);
      }
      // The Tether leash, judged exactly as it is for a maneuver: the crusher's
      // half of the exchange is a VOLUNTARY Movement, and this command carries
      // it, so the same cap has to hold here or the two boards would disagree
      // about a Grid one of them refuses.
      const leash = tetherCap(t, state.tokens);
      if (leash && !leash(Math.floor(cmd.to.col / 3), Math.floor(cmd.to.row / 3))) {
        const x = (t.tether ?? []).filter((l) => l.role === 'tethered')[0]?.range ?? 0;
        return no(`${t.label} is Tethered and cannot voluntarily move beyond ${x} Grids of the unit holding it (PDLH-202).`);
      }
      // THE occupancy test, and the reason this is a command rather than two.
      // `maneuver` validates board bounds and the leash and nothing else, so a
      // Crush whose placement fell through to snapPlacement — which does no
      // occupancy and no terrain test at all — is how two units came to share
      // one Large Grid with nothing printed about it and nothing said to the
      // player.
      const why = exchangeRoomWhy(data, state, t, swapped, cmd);
      if (why) return no(why);
      // THE GEOMETRY, and the one line that makes the wrong-Grid class of bug
      // impossible to reintroduce from any caller. 4.3.6 puts the Crush at the
      // moment a Unit is "about to enter a Grid occupied by another Unit", and
      // the exchange stands in for "Forced Movement of 1 Grid" — so the pair
      // trade places across ONE Grid boundary and the crushed Unit always ends
      // orthogonally adjacent to where the crusher lands. Worked example (C)
      // has them adjacent.
      //
      // Measured before this existed: rules.ts derived the vacated Grid from a
      // crusher that had not moved yet, so a route (1,0)->(1,1)->(1,2) sent the
      // victim to (1,0) — two Grids off — and a freeplay drag from (0,0) onto a
      // Drone in (8,8) sent it sixteen. Neither page could see it; this reader
      // can, and it is the reader a stale networked client is measured against.
      //
      // TWO tests, because they pin the two ENDS of the same move and neither
      // implies the other. The first is the one the earlier round missed: a
      // Unit is only exchanging positions if it is STANDING in the Grid the
      // crusher is entering — that is what "the crushed Unit" means, and both
      // pages get their victim list from crushTargets(goal), which is exactly
      // that set. Without it the adjacency test alone accepted a Large Mech in
      // Grid(1,1) entering Grid(1,2) while naming a Drone sixteen Grids away in
      // Grid(8,8): the destination was adjacent, so check() said ok and apply()
      // teleported the Drone fourteen Grids. Not reachable from either page
      // today — and this is the reader that has to hold when it is.
      //
      // The crusher's own Grid is deliberately not tested FOR ADJACENCY, and
      // that is the trap: nothing has written its col/row when either page sends
      // this, so it still stands where the whole Movement began, which is the
      // very reading that caused the bug above. What that position can still
      // answer honestly is a DISTANCE, and the bound below the loop is that.
      const landing = { c: Math.floor(cmd.to.col / 3), r: Math.floor(cmd.to.row / 3) };
      for (const s of cmd.swaps) {
        // Always found — `swapped` was built from these same entries a few lines
        // up, and a missing Unit was refused there — but the lookup is what
        // gives the two tests below a Token to measure, so it is guarded rather
        // than asserted.
        const v = swapped.find((x) => x.uid === s.uid);
        if (!v) return no('That target is not on the board.');
        // Named for the VICTIM, because the crusher's own Grid is read further
        // down this same case block under a name of its own. Two bindings called
        // `at` in one case, meaning two different Units, is the shadow shape that
        // already left one guard dead in this file while tsc stayed clean.
        const victimAt = { c: Math.floor(v.col / 3), r: Math.floor(v.row / 3) };
        if (victimAt.c !== landing.c || victimAt.r !== landing.r) {
          return no(`${v.label} is not standing in the Grid ${t.label} is entering, so there are no positions for the two of them to exchange (4.3.6).`);
        }
        // The other end: the crushed Unit takes the Grid the crusher steps out
        // of, and the exchange stands in for "Forced Movement of 1 Grid", so it
        // lands orthogonally adjacent to where the crusher lands. Kept rather
        // than folded into the test above — that one says WHICH Unit is being
        // crushed, this one says HOW FAR it may travel, and a sender that got
        // the victim right can still name a destination across the board.
        const g = { c: Math.floor(s.to.col / 3), r: Math.floor(s.to.row / 3) };
        if (Math.abs(g.c - landing.c) + Math.abs(g.r - landing.r) !== 1) {
          return no(`${v.label} would end up more than one Grid from ${t.label}: an exchange trades places across a single Grid boundary (4.3.6).`);
        }
      }
      // HOW FAR THE CRUSHER MAY HAVE COME, and the line that stops this command
      // being a teleport. Everything above constrains the two Units against EACH
      // OTHER — the victim stands in the Grid the crusher enters, the pair end up
      // one Grid apart, neither lands on a third Unit — so a command that was
      // merely SELF-CONSISTENT sailed through from anywhere on the board.
      // DRIVEN before this line existed (round-3 reviewer, 2026-08-19): a Large
      // Mech standing in Grid(0,0) named a Drone in Grid(8,8) and sent it next
      // door to Grid(8,7); check() returned ok and apply() put the Mech sixteen
      // Grids away for no Movement, no Tick and no Action Opportunity, while the
      // identical `maneuver` to the same Grid was refused. Not reachable from
      // either page — applyRemote() gates purely on check(), so a stale or
      // hostile peer is exactly who this reader is for.
      //
      // A LEGALITY, the same shape as the Tether leash above rather than a
      // price. 4.3.6 resolves the Crush as a Unit is "about to enter" the Grid,
      // so the crusher walked there under its own power, and every step of a
      // route is one orthogonal Grid costing at least 1 (rules.ts searchMoves) —
      // so the Grid distance between the two ends of ANY legal Movement is at
      // most what that Movement was allowed. movementReach is that ceiling.
      //
      // It does NOT price the route, and must not try: this reader cannot see
      // one. The token still stands where the Movement began, the Grids it
      // walked through have already given way to the Crush, and reachableGrids
      // run here would be answering about a board that no longer exists. Hence a
      // bound that holds for every route rather than a test of the route taken.
      //
      // WHY IT CANNOT REFUSE A ROUTE EITHER PAGE REALLY DRAWS, which is also why
      // neither page carries a mirror of this line. rules.ts searchMoves expands
      // only the four orthogonal neighbours, charges at least 1 a step and
      // prunes anything dearer than the allowance, and extendPath caps a chained
      // set of waypoints at `steps - pathCost`. So every Grid either page can
      // offer as a goal sits at most `steps` Grids from where the Movement
      // began, and `steps` is `action.range || maneuverRange` on both (main.ts
      // startMove, matchhud.ts startMovePlan), which is precisely what
      // movementReach ceilings. Driven against the real reachableGrids over
      // every allowance from 1 to 8, walking and flying, cluttered and clear,
      // with the LPA-21 phase-through flag both ways: no goal ever came back
      // further from the start than the allowance it was drawn with. A copy of
      // this rule on the pages could only drift away from the one that binds.
      //
      // PINNED in commands.test.mjs, "how far the crusher may have come": the
      // sixteen-Grid command in the geometry block is caught by the ADJACENCY
      // line before any distance is measured, so this bound was shipped with
      // nothing defending it and deleting it outright left the suite at exit 0.
      //
      // The floor of one Grid is the freeplay DRAG, which is a placement rather
      // than a Movement: main.ts onMove only offers the exchange when the token
      // was picked up in the Grid next door, and a sandbox board will happily
      // drag a Mech whose Chassis is destroyed and whose Maneuver Value is
      // therefore 0 (3.4.4, FAQ E4). One Grid is also exactly what the exchange
      // stands in for — "Forced Movement of 1 Grid" — so it can never be too
      // little.
      //
      // NOT an Action Opportunity gate, which was the other half of the report.
      // Two legitimate senders have no Opportunity to show: the freeplay drag
      // opens none at all, and a GRANTED Maneuver — Hit and Run (276), which
      // moves a Mech as its Opportunity ENDS — reaches finishCrush after the
      // Opportunity is gone, on the networked page where such a gate would bite.
      // Refusing either is the one thing this reader must not do.
      const crusherAt = { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
      const crossed = Math.abs(crusherAt.c - landing.c) + Math.abs(crusherAt.r - landing.r);
      const reach = Math.max(1, movementReach(data, state, t));
      if (crossed > reach) {
        return no(`${t.label} stands ${crossed} Grids from the Grid it is Crushing, and no Movement of its reaches further than ${reach}: a Crush happens as a Unit is about to ENTER the Grid it Crushes (4.3.6).`);
      }
      // Deliberately NOT re-checked here: the Action Opportunity and the
      // Maneuver Tick. A Crush ends a Maneuver *or* a Movement Action (4.3.6),
      // and only the first spends a Maneuver Tick — the Movement's own
      // `maneuver` command is where that is settled, on both pages. Charging it
      // here as well would have check() refuse the very command that ends the
      // Movement.
      //
      // NOTHING BOUNDS REPETITION, and that is RECORDED rather than fixed.
      // Driven by the round-5 reviewer (2026-08-19): seven chained crushSwaps,
      // each one Grid and each legal on its own, walked a crusher 10 Grids with
      // script.opp still null and not a Tick spent. Every hop respects the
      // ceiling above; the COUNT does not, because this reader is handed one
      // command at a time and the engine holds no record that a Movement has
      // happened at all.
      //
      // WHY NOT THE OBVIOUS GATE. An Opportunity test is already refused above
      // for two named senders, and repetition does not rescue it: the freeplay
      // drag opens no Opportunity to count against, and a Hit and Run (276)
      // Maneuver arrives after its Opportunity has ended, so a per-Opportunity
      // counter would read null on exactly the two legitimate cases and bite
      // nobody else. A per-TICK counter fails for the same reason, since a Crush
      // that ends a Movement Action spends no Maneuver Tick.
      //
      // WHAT WOULD ACTUALLY CLOSE IT is the same missing piece the `from` note
      // in the `maneuver` case names: the engine has to REMEMBER a Movement
      // rather than be told about one. A crushSwap would record the Grid the
      // exchange started in and that a Movement has now ENDED (4.3.6 ends the
      // Maneuver or the Movement Action outright), the follow-up `maneuver`
      // would clear it, and a second crushSwap arriving against a live record
      // would be refused. That is new rules-bearing state, so it owes a
      // migrateState arm, a normaliseOpportunity arm and a boardFingerprint
      // field, and it wants its own round of work rather than a line here.
      //
      // NOT SHIPPED NOW because the exposure is small and the wrong fix is
      // expensive: neither page can send a second crushSwap (both send exactly
      // one, immediately followed by the `maneuver` that records the Movement),
      // the crusher gains no Action and no Tick by walking, and every hop still
      // has to find a real victim standing in the Grid it enters with no escape
      // square, which the occupancy and adjacency lines above already police.
      // A half-built gate that refused the freeplay drag would be a live
      // regression traded for a hypothetical one.
      return ok;
    }
    case 'performAction': {
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      // Riposte (050 / ZHLA-202) is the one Action performed outside an
      // Opportunity, and the grant has to be real: a queued riposte debt for
      // THIS unit is the proof, and it buys a Melee Action and nothing else.
      if (cmd.granted) {
        const owed = (state.script?.reactions ?? []).some((r) => r.uid === cmd.uid && r.kind === 'riposte');
        if (!owed) return no('Nothing has granted this unit an Action outside its Action Opportunity.');
        if (a.type !== 'Melee') return no('A Riposte grants a Melee Action (050 / ZHLA-202).');
        return ok;
      }
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this unit\'s Action Opportunity.');
      // Ticks are a Mech's economy. Everything else gets an activation worth
      // one Action or one Movement, and the unit is the only thing that says
      // which reading applies — a Mech's Passives are length-less too.
      if (t.kind !== 'mech') {
        // The icon lock (3.2.2 ② / 3.5): a Command performs Command-icon
        // Actions, the Automatic Phase performs Automatic ones. Drones only —
        // a Projectile's Delayed Action belongs to the Delay Phase (3.6).
        if (t.kind === 'drone') {
          const ph = PHASES[state.round.phase];
          const why = isLoopPhase(ph)
            ? droneActionWhy(ph, a, { autoActions: riderOnDrone(data, state.tokens, t).autoActions })
            : null;
          if (why) return no(why);
        }
        return fromVerdict(canActivate(o));
      }
      // partKey names which Part the Action came from, so the same Action
      // borrowed from two Tarantulas is two Parts, not one repeated (FAQ O7).
      return fromVerdict(canPerform(o, a, cmd.partKey || a.id, {
        flexible: hasFlexibleTiming(data, state.tokens, t, a),
        anyTiming: anyStartTiming(data, t),
      }));
    }
    case 'overload': {
      const ids = new Set(data.overload.map((g) => g.actionId));
      const has = tokenCards(data, t).some(({ card }) => (card.actions ?? []).some((a) => ids.has(a.id)));
      if (!has) return no('This Mech has no Overloading Pack.');
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this Mech\'s Action Opportunity.');
      return fromVerdict(canOverload(o, t.link ?? 0));
    }
    case 'attackMode': {
      // A Torso Part, so the holder is always a Mech — but say so, because the
      // lock apply() takes is lockStance(), which silently does nothing for a
      // Drone and would leave the bonus with no Stance gate at all.
      if (t.kind !== 'mech') return no('Only a Mech claims this: a Drone plays the Stance printed on its card.');
      const bonus = opportunityBonusOn(data, t);
      if (!bonus) return no('This Mech has no Part that adds an Action Tick to its Action Opportunity.');
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this Mech\'s Action Opportunity.');
      return fromVerdict(canAttackMode(o, t.stance, bonus.stance));
    }
    case 'playTactic': {
      const spec = tacticSpec(cmd.cardId);
      if (!spec) return no('That card is not a Tactics Card the guide can resolve.');
      if (!(state.tactics?.[cmd.seat] ?? []).includes(cmd.cardId)) return no(`${spec.name} is not in this squad's hand.`);
      if ((state.tacticsPlayed?.[cmd.seat] ?? []).some((e) => e.startsWith(`${state.round.n}:`))) {
        return no('A squad may play only 1 Tactics Card per round (5.4.2).');
      }
      if (state.script && PHASES[state.round.phase] !== spec.phase) {
        return no(`${spec.name} is played in the ${spec.phase} Phase (${spec.timing.toLowerCase()}), and it is the ${PHASES[state.round.phase]} Phase.`);
      }
      const ctx = tacticCtx(data);
      if (!tacticTargets(spec, state, cmd.seat, ctx).some((x) => x.uid === cmd.uid)) return no(spec.none);
      if (spec.choices && !spec.choices(t, state, ctx).some((o) => o.id === cmd.pick)) {
        return no(`That is not a choice ${spec.name} offers here.`);
      }
      return ok;
    }
    case 'deployUnit': {
      // Like the maneuver, the Deployment Zone and the standing-spot rules stay
      // with the placement UI, which only offers legal Grids.
      if (t.kind === 'projectile') return no('A Projectile is never deployed; it arrives when something launches it.');
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'deploy') {
        return no(t.deployed !== false ? `${t.label} is already on the board.` : 'Units are placed in the deployment stage of setup (3.1.4).');
      }
      // A unit already down may be nudged until deployment closes; only a
      // fresh placement spends the alternation turn (3.1.4).
      if (t.deployed === false && deployTurn(state, su) !== cmd.seat) return no('It is the other squad\'s turn to place a unit (3.1.4).');
      // Tasks come before deployment (3.1.3 then 3.1.4). Across a table that
      // ordering has to be a rule rather than a drawn panel, or the First
      // Player could take an edge and start placing while the other squad
      // never got the chance to choose one.
      if (getLocalSeat() && t.deployed === false) {
        const picked = normaliseTasks(state.tasks).secondary;
        if (!picked.s1 || !picked.s2) return no('Both squads pick a Secondary Task before anything deploys (3.1.3).');
        // A Task that names a Mech or a Zone is not set up until it has, and
        // naming it after seeing where everything stands would be choosing
        // with the board in front of you.
        if (taskDesignations(data, state).length) {
          return no('Every Task names its Mech or Zone before anything deploys (5.2.3).');
        }
      }
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      if (cmd.stance !== undefined && !STANCES.includes(cmd.stance)) return no('That is not a Stance.');
      return ok;
    }
    case 'applyPenetration': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      const card = tokenCards(data, target).find((x) => x.slot === cmd.slot)?.card;
      if (!card) return no(`${target.label} has no such Part to hit.`);
      if ((target.partStates[cmd.slot] ?? 'intact') === 'destroyed') {
        return no('That Part is already destroyed, and cannot be Penetrated again (4.4.4).');
      }
      return ok;
    }
    case 'applyStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      const def = STATUSES.find((x) => x.id === cmd.statusId);
      if (def?.shape === 'hexagon') {
        // A Low Value Unit never carries a Hexagon Token (Supplement 1.6 via
        // FAQ J3/M23): every Projectile, and any Drone worth 0 points.
        if (lowValueUnit(data, target)) return no('Low Value Units cannot gain Hexagon Tokens (Rules Supplement 1.6).');
        // Optical Camouflage refuses a Highlight but accepts Low Profile (I1).
        if (cmd.statusId === 'highlight' && statusCount(target.statuses, 'camouflage') > 0) {
          return no('A unit in Optical Camouflage cannot gain a Highlight Token (FAQ I1).');
        }
      }
      if (!STATUSES.some((s) => s.id === cmd.statusId)) return no('That is not a Token or State the game knows.');
      return ok;
    }
    case 'removeStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (!(target.statuses ?? []).includes(cmd.statusId)) return no('That unit is not carrying it.');
      return ok;
    }
    case 'focus': {
      // ZPA-39 Cadaver's Focus consumes nothing, so 4.10's floor has no spend
      // to bite on and a Cadaver may Focus at 1 Link — or at 0, Shutdown, where
      // it can still defend.
      if (focusIsFree(data, t)) return ok;
      // The last Link can never be spent voluntarily (4.10, FAQ L1).
      if ((t.link ?? 0) < 2) return no('Focus spends 1 Link, and the last Link can never be spent voluntarily (4.10).');
      return ok;
    }
    case 'restoreLink': {
      // The only source today is ZPA-40 Elation, and the gate is here rather
      // than at the emit so the rule holds against a replayed or relayed
      // command as well as against the button that sent it.
      if (t.kind !== 'mech') return no('Only a Mech has a Link Value.');
      if (!pilotIs(data, t, 'ZPA-40')) return no('That Mech is not piloted by Shrike.');
      if ((t.link ?? 0) >= maxLink(data, t)) return no(`${t.label} is already at its pilot's Link Value.`);
      return ok;
    }
    case 'spendAmmo': {
      // ammoPay, not ammoHolder: an empty Pod may still be paid for out of an
      // Ammunition Pack carrying 086_B. guidedActions already OFFERS the shot
      // on that basis, so checking the printed pool alone made the row appear
      // and then refuse when pressed.
      const { from, poolId } = ammoPay(data, state, t, cmd.actionId);
      const held = from.ammo[poolId];
      if (held === undefined) return no('That Action does not track Ammo.');
      if (held < 1) return no('No Ammo left for that Action (4.12).');
      return ok;
    }
    case 'restoreAmmo': {
      const from = ammoHolder(data, state, t, cmd.actionId);
      const held = from.ammo[cmd.actionId];
      if (held === undefined) return no('That Action does not track Ammo.');
      const max = ammoMax(data, from, cmd.actionId);
      if (max !== undefined && held >= max) return no('That Action is already at its full Storage.');
      return ok;
    }
    case 'takeBlackBox': {
      // A Low Value Unit may never interact with a Task Item (p.82), and a
      // Projectile is always one.
      if (t.kind === 'projectile') return no('A Projectile never picks up a Black Box.');
      const tasks = normaliseTasks(state.tasks);
      const box = tasks.items.find((i) => i.id === cmd.itemId);
      if (!box || box.kind !== 'blackbox') return no('That is not a Black Box.');
      if (box.bearerUid !== undefined) {
        return box.bearerUid === t.uid
          ? no(`${t.label} is already carrying that Black Box.`)
          : no('Another unit is already carrying that Black Box.');
      }
      if (box.col === undefined || box.row === undefined) return no('That Black Box is not on the board.');
      // A Part already bearing one has its Freehand treated as invalid (5.3.1),
      // so a Part can only ever hold a single Box.
      const taken = tasks.items.filter((i) => i.bearerUid === t.uid && i.bearerSlot).map((i) => i.bearerSlot!);
      const hands = freehandSlots(data, t, taken);
      if (!hands.length) {
        return no(`${t.label} has no free Freehand Part. Carrying a Black Box needs one, and a Part already holding one does not count (5.3.1).`);
      }
      if (!hands.some((h) => h.slot === cmd.slot)) return no('That Part cannot carry a Black Box.');
      return ok;
    }
    case 'spendIntercept': {
      const held = t.intercept?.[cmd.actionId];
      if (held === undefined) return no('That Action carries no Interception Tokens.');
      if (held < 1) return no('Every Interception Token on that Part is spent, and they are never restored (4.9).');
      return ok;
    }
    case 'restoreIntercept': {
      const held = t.intercept?.[cmd.actionId];
      if (held === undefined) return no('That Action carries no Interception Tokens.');
      const max = interceptMax(data, t, cmd.actionId);
      if (max !== undefined && held >= max) return no('That Part still holds every Interception Token it started with.');
      return ok;
    }
    case 'startCounterRoll': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.side === t.side) return no('An Electronic Attack is made against an enemy Unit (4.11.1).');
      // Electronic Value "-" cannot be the RESPONDER of a Counter-roll (4.11.2),
      // which is a different thing from an Electronic Value of 0: a 0 may be
      // targeted and simply rolls nothing. Gated here rather than only in
      // whoever drew the button, so a relayed command obeys it too.
      if (electronicDash(data, target)) return no(`${target.label} has no Electronic Value at all, so it cannot be the Responder of a Counter-roll (4.11.2).`);
      if (state.script?.counter) return no('An Electronic Counter-roll is already open.');
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      // Range only: Electronic Warfare ignores Terrain and line of sight
      // entirely (4.11.1), so the arc and sight checks a Firing Action needs
      // have no place here.
      const reach = a.range ?? 0;
      // A reaction still has to BE one: the Passive has to be live on this Mech
      // with a Command Token to spend. The rule lives here, not in whoever drew
      // the button.
      if (cmd.reaction && targetTracingOn(data, t)?.actionId !== cmd.actionId) {
        return no(`${t.label} has no Passive that answers an attack with a Counter-roll.`);
      }
      // SCAN (4.12.4) designates "an Enemy Unit in the Optical Camouflage State
      // or bearing a Low Profile Token". Against anything else it could change
      // nothing at all, which 6.1 forbids in the same words the Stabilize
      // refusal uses - and a Scan spent on a unit with nothing to strip is a
      // Tick and an End Phase gone.
      if (isScanAction(a) && !scannable(target)) {
        return no(`${target.label} is neither in the Optical Camouflage State nor bearing a Low Profile Token, so a Scan could not change anything (4.12.4).`);
      }
      // An allied Repeater lends its position as the origin, and the Action's
      // own Range is measured from there (FAQ O19). Derived rather than sent,
      // so both seats judge the same shot.
      const origins = electronicOrigins(data, state.tokens, t);
      if (!cmd.reaction && !origins.some((from) => gridRange(from, target) <= reach)) {
        return no(`${target.label} is beyond Range ${reach}${origins.length > 1 ? ', even through the Repeater' : ''}.`);
      }
      // EV 0 cannot Initiate; EV "-" cannot Respond (4.11.2).
      // The Initiator is performing an Action, so a Tarantula's Load counts for
      // it here (FAQ O5) - the Responder's passive roll never gains one.
      if (electronicValue(data, t, loanedParts(data, state.tokens, t)) <= 0) return no(`${t.label} has an Electronic Value of 0, so it cannot Initiate a Counter-roll (4.11.2).`);
      if (electronicValue(data, target) < 0) return no(`${target.label} cannot be the Responder of a Counter-roll (4.11.2).`);
      return ok;
    }
    case 'rollCounter': {
      const c = state.script?.counter;
      if (!c) return no('No Electronic Counter-roll is open.');
      if (cmd.uid !== c.initiatorUid && cmd.uid !== c.responderUid) return no('That unit is not in this Counter-roll.');
      if (!Array.isArray(cmd.faces) || cmd.faces.some((f) => !Number.isInteger(f) || f < 0)) return no('That is not a roll.');
      const mine = cmd.uid === c.initiatorUid ? c.initRoll : c.respRoll;
      const focused = cmd.uid === c.initiatorUid ? c.initFocused : c.respFocused;
      // A first roll, or one Focus reroll: Focus costs Link and the Link spend
      // is its own command, so this only guards against a free second roll.
      if (mine && !cmd.focused) return no('That unit has already rolled.');
      if (cmd.focused && (!mine || focused)) return no('Focus rerolls a roll that has been made, and only once here.');
      return ok;
    }
    case 'disarm': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.kind !== 'mech' || !target.mech) return no('Disarm flips a Part Card, and only a Mech carries them.');
      const held = target.mech[cmd.slot as PartSlot];
      const from = held ? data.byId.get(held) : undefined;
      if (!from) return no(`${target.label} has nothing in that slot.`);
      if ((target.partStates[cmd.slot as PartSlot] ?? 'intact') === 'destroyed') {
        return no(`${target.label}'s ${SLOT_LABEL[cmd.slot as PartSlot]} is destroyed — there is no card left to flip.`);
      }
      // The legality IS the pointer: a Part with no Discard Card has no
      // discard state (4.17), so a torso or a chassis cannot be disarmed.
      if (!discardFaceOf(data, from)) return no(`${cardName(from)} has no Discard Card, so it has no Discard State to change to.`);
      return ok;
    }
    case 'suppress': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.kind !== 'mech') return no('Suppression only moves a Mech: other units have no Stance dial to switch.');
      if (target.stance === 'shutdown') return no('A Shutdown Mech is immune to Suppression (glossary).');
      return ok;
    }
    case 'provoke': {
      // LPA-22 Yoyu, 挑衅 Provoke. `t` is Yoyu, so the actor gate above has
      // already refused a player answering for the other squad's pilot.
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      const why = provokeWhy(data, t, target);
      if (why) return no(why);
      // The VERDICT is not re-judged here, and cannot be: reading the faces
      // takes dice.json, which the command layer deliberately does not hold --
      // "Dice ride inside their commands as rolled faces". Exactly the same
      // line the `applyStatus` that lands a won Electronic Attack sits on. What
      // IS judged is that the answer belongs to the exchange it claims: the
      // Counter-roll below, and Yoyu's own seat above.
      const c = state.script?.counter;
      if (c) {
        // Yoyu answers as the RESPONDER (4.11.2, FAQ O5), turning the Mech that
        // opened the contest. An answer naming any other pair is not this
        // question.
        if (c.responderUid !== cmd.uid) return no(`${t.label} is not the Responder of this Counter-roll.`);
        if (c.initiatorUid !== cmd.targetUid) return no(`${target.label} did not open this Counter-roll.`);
        if (c.initRoll === null || c.respRoll === null) return no('The Counter-roll is not settled yet.');
        if (c.provoke) return no('That Counter-roll has already been answered.');
      }
      // No `else` refusal: freeplay's ElectronicHelper runs the whole contest
      // in one panel on one screen and never opens a shared `counter`, so a
      // board with none is the ordinary freeplay case rather than a stale
      // client. Its own helper is the gate there, the same way it is the only
      // gate on the applyStatus that helper sends.
      return ok;
    }
    case 'setCharge': {
      if (!chargeable(data, t, cmd.slot)) return no('That Part has no Action that spends a Charge Token (4.14).');
      const already = (t.charge ?? []).includes(cmd.slot);
      if (cmd.on && already) return no('That Part is already Charged, and a Charged Action cannot be Charged again until the token is spent (4.14).');
      if (!cmd.on && !already) return no('That Part is not holding a Charge Token.');
      return ok;
    }
    case 'endOpportunity': {
      if (!oppOf(state, cmd.uid)) return no('It is not this unit\'s Action Opportunity.');
      return ok;
    }
    case 'asterRestore': {
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      if (PHASES[state.round.phase] !== 'Command') return no('Aster restores Link during the Command Phase.');
      if (t.kind !== 'mech' || pilotCard(data, t)?.id !== 'ZPA-36') return no('That Mech is not piloted by Aster.');
      if (readyCommands(t) <= 0) return no(`${t.label} has no face-up Command Token to consume.`);
      if (sc.oncePerRound.includes(asterKey(state, t.uid))) return no(`${t.label} has already used Aster this round.`);
      const to = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!to || to.kind !== 'mech' || to.side !== cmd.seat || !alive(to)) return no('Aster restores Link to an Ally Mech.');
      if ((to.link ?? 0) >= maxLink(data, to)) return no(`${to.label} is already at full Link.`);
      return ok;
    }
    case 'spendCommand': {
      // 4.15.4 requires the Mech to BEAR a face-up Command Token to perform an
      // Action that consumes one, which is the whole reason reserving tokens is
      // a decision rather than a leftover.
      if (t.kind !== 'mech') return no('Only a Mech bears Command Tokens.');
      if (readyCommands(t) <= 0) return no(`${t.label} has no face-up Command Token to spend (4.15.4).`);
      return ok;
    }
    case 'coordinateCommand': {
      // 4.15.3. The issuer must be one of your own Mechs still holding a
      // face-up Command - a reserved one, since the Command Phase is over.
      const from = state.tokens.find((x) => x.uid === cmd.uid);
      if (!from || from.side !== cmd.seat || from.kind !== 'mech') return no('A Command is issued by one of your own Mechs (4.15.3).');
      if (readyCommands(from) <= 0) return no(`${from.label} has no face-up Command Token to hand out.`);
      const to = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!to || to.kind !== 'drone' || !alive(to)) return no('Command Coordination sends a Command to an Ally Drone.');
      if (to.side !== cmd.seat) return no('A Command only ever goes to an Ally Drone.');
      // A Drone bears one Command Token at a time (4.15.2). The Command Phase's
      // tokens were removed when that phase ended, which is exactly why a Drone
      // that already acted can take one now (4.15.3) - so this reads the board
      // rather than the phase's `commanded` list.
      if (heldCommands(to) > 0) return no(`${to.label} already has a Command Token, so it cannot take another (4.15.2).`);
      return ok;
    }
    case 'designate': {
      const phase = PHASES[state.round.phase];
      if (!isLoopPhase(phase)) return no('Designation happens in the Command, Automatic and Delay Phases.');
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      // Normalised the way both panels already display it, because the raw
      // pointer can be STUCK: only a designation or a pass ever moves it, so a
      // First Player with nothing to designate parks it on themselves forever —
      // their panel says "waiting for the other squad", the other squad's
      // designate is refused right here, and the phase deadlocks. Found in the
      // 2026-08-16 mock playtest, on the very first Command Phase driven with
      // the drones all on the second player's side.
      const turnNow = canAct(state, phase, sc.turn) ? sc.turn : (nextTurn(state, phase, sc.turn) ?? sc.turn);
      if (turnNow !== cmd.seat) return no('It is the other squad\'s turn to designate (3.2.2).');
      if (!eligibleUnits(state, phase, cmd.seat).some((x) => x.uid === cmd.uid)) return no(`${t.label} cannot be designated this phase.`);
      // Step 1 of 4.15.2 is naming the Mech that issues, so a named Mech has to
      // be one that actually holds a face-up Command. Omitting fromUid is still
      // legal - the fullest Mech pays - because replays and the Automatic and
      // Delay Phases send a designate with no issuer at all.
      // The capacity rule reads the BOARD, not just the phase's `commanded`
      // list: 4.15.2 caps a Drone at one physical Command Token, and FAQ N8 has
      // a White Dwarf Bit keep its token through a Stance change and be barred
      // from a second on exactly those grounds. A free Command (FAQ O14) places
      // no token, so it is not capped by this.
      if (phase === 'Command' && !sc.freeCommand.includes(cmd.uid) && heldCommands(t) > 0) {
        return no(`${t.label} already has a Command Token, so it cannot take another (4.15.2).`);
      }
      if (phase === 'Command' && cmd.fromUid !== undefined && !sc.freeCommand.includes(cmd.uid)) {
        const from = state.tokens.find((x) => x.uid === cmd.fromUid);
        if (!from || from.side !== cmd.seat || from.kind !== 'mech') return no('A Command is issued by one of your own Mechs (4.15.2).');
        if (readyCommands(from) <= 0) return no(`${from.label} has no face-up Command Token left to issue.`);
      }
      return ok;
    }
    case 'grantExtra': {
      if (t.kind !== 'mech') return no('Only a Mech takes an Extra Action Opportunity.');
      if ((t.link ?? 0) < cmd.linkCost) return no(`This needs ${cmd.linkCost} Link, and ${t.label} has ${t.link ?? 0}.`);
      return ok;
    }
    case 'stabilise': {
      // Either half of the action justifies it on its own (FAQ J4/J6/J7):
      // remove a Token, restore a Link, or both. Only a Mech with neither a
      // removable Token nor a missing Link has nothing to change (J8).
      const shed = (t.statuses ?? []).some((id) => {
        const d = STATUSES.find((x) => x.id === id);
        return d?.shape === 'square' || d?.shape === 'hexagon';
      });
      const pilot = pilotCard(data, t);
      const canLink = !!pilot && (t.link ?? 0) < (pilot.LV ?? 0);
      if (!shed && !canLink) return no('Nothing to stabilize: no Square or Hexagon Token to remove and no Link missing. An action that cannot produce any change cannot be performed (6.1).');
      return ok;
    }
    case 'reveal': {
      if (!(t.statuses ?? []).includes('camouflage')) return no('This unit is not in the Optical Camouflage State.');
      // MANIFESTATION MOVEMENT (4.12.2): "the Mech may appear within X Grids".
      // Teleportation, so nothing between the two Grids is consulted - only the
      // distance and whether the unit fits. The destination is judged HERE
      // rather than trusted, the same reason every other destination on the
      // wire is: the sender chooses it.
      if (cmd.to) {
        const range = manifestationRange(data, t);
        if (range <= 0) return no(`${t.label} has no Stealth value, so it Reveals where it stands.`);
        // Chebyshev on Large Grids: a Grid diagonally over is one Grid away,
        // the same measure Adjacent uses.
        const away = Math.max(
          Math.abs(Math.floor(cmd.to.col / 3) - Math.floor(t.col / 3)),
          Math.abs(Math.floor(cmd.to.row / 3) - Math.floor(t.row / 3)),
        );
        if (away > range) {
          return no(`Manifestation Movement reaches ${range} Grid${range === 1 ? '' : 's'}, and that is ${away} away.`);
        }
        const gone = new Set(state.removedTerrain ?? []);
        const terrain = (data.terrain?.layouts?.[state.map] ?? []).filter((p) => !gone.has(p.id));
        const at = { ...t, col: cmd.to.col, row: cmd.to.row };
        const spot = spotsInGrid(at, terrain, state.tokens).find((s) => s.col === cmd.to!.col && s.row === cmd.to!.row);
        if (!spot || !spot.ok) return no(`${t.label} does not fit there.`);
      }
      return ok;
    }
    case 'repairPart': {
      // SH-15 Damage Control: a destroyed Part of THIS mech gains a Repaired
      // Token, or a Damaged Part is mended. The Part stays destroyed for
      // Integrity and Link (FAQ J21/J23).
      if (t.kind !== 'mech') return no('Only a Mech has Parts to repair.');
      const st = t.partStates[cmd.slot as PartSlot | 'main'] ?? 'intact';
      if (cmd.mode === 'repaired') {
        if (st !== 'destroyed') return no('Only a destroyed Part can take a Repaired Token.');
        if ((t.repairedSlots ?? []).includes(cmd.slot)) return no('That Part already bears a Repaired Token.');
        return ok;
      }
      if (st !== 'damaged') return no('Only a Damaged Part can be mended.');
      return ok;
    }
    case 'breakRepaired': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (!(target.repairedSlots ?? []).includes(cmd.slot)) return no('That Part bears no Repaired Token.');
      return ok;
    }
    case 'launch': {
      if (!data.byId.get(cmd.cardId)) return no('That is not a card the database knows.');
      if (!findAction(data, state, cmd.uid, cmd.actionId)) return no('This unit has no such Action.');
      // Every launch costs one Ammo Token (4.13), and apply clamps the count at
      // zero - so without this line an empty magazine fired forever, in a
      // strict game as much as the sandbox, because nothing ever said no.
      //
      // ammoHolder, which answers WHOSE TOKEN pays, not the pool question: a
      // launcher lent by a Carrier Tarantula keeps its magazine on the DRONE
      // (FAQ O3/O16), and the Mech has no entry for the borrowed Action at all.
      // Reading t.ammo raw therefore found undefined, said nothing, and a
      // borrowed Missile Pod fired for free all game.
      const mag = ammoHolder(data, state, t, cmd.actionId);
      if (mag.ammo[cmd.actionId] !== undefined && mag.ammo[cmd.actionId] <= 0) {
        return no('No Ammo Tokens left for this Action (4.13).');
      }
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      return ok;
    }
    case 'resolveReaction': {
      if (!t) return no('That unit is not on the board.');
      const owed = (state.script?.reactions ?? []).some((r) => r.uid === cmd.uid && r.actionId === cmd.actionId);
      if (!owed) return no('That unit is owed no reaction.');
      return ok;
    }
    case 'accessTerminal': {
      if (!t) return no('That unit is not on the board.');
      const item = normaliseTasks(state.tasks).items.find((i) => i.id === cmd.itemId);
      if (!item || item.kind !== 'terminal') return no('That is not a Terminal.');
      // Once per round each, and the End Phase flips them all back (5.3.3).
      if (item.accessed) return no('That Terminal has already been accessed this round (5.3.3).');
      return ok;
    }
    case 'blink': {
      if (!t) return no('That unit is not on the board.');
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      // The named Action must really BE a position swap, or any Action with a
      // Range could be sent as a blink and teleport off it.
      if (!isPositionSwap(a)) return no('That Action does not exchange positions.');
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      // The whole legality of the swap is one derivation, so check() asks it
      // rather than restating the four clauses and drifting from them.
      if (!blinkTargets(data, state.tokens, t, a).some((x) => x.uid === cmd.targetUid)) {
        return no(`${target.label} cannot be exchanged with: Prototype Blink takes a GROUND MECH of the same size within Range ${a.range ?? 0}, enemy or allied (FAQ E20).`);
      }
      if (![0, 1, 2, 3].includes(cmd.facing) || ![0, 1, 2, 3].includes(cmd.targetFacing)) {
        return no('Both units need a facing: Prototype Blink is Forced Movement, so the Taurus player sets them (FAQ E17).');
      }
      return ok;
    }
    case 'layMine': {
      if (!t) return no('That unit is not on the board.');
      if (!data.byId.get(cmd.cardId)) return no('That is not a card the database knows.');
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      if (projectileDelivery(a) !== 'lay') return no('That Action does not Lay anything.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col > 35 || row > 35) {
        return no('That is not a place on the board.');
      }
      // Which Grids are legal and what the Move Range paid for is the route's
      // business, and the route is gone by the time this arrives — the driver
      // that drew it only offers Grids on it. Laying is a Passive, so unlike
      // every other Action there is no Tick to check here either.
      return ok;
    }
    case 'despawn': {
      if (!state.tokens.some((x) => x.uid === cmd.targetUid)) return no('That unit is not on the board.');
      return ok;
    }
    case 'switchForm': {
      if (!t) return no('That unit is not on the board.');
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      const forms = formSwitch(a);
      if (!forms) return no(`${t.label} has no Action that changes its form.`);
      // Both ends checked against the ACTION's own list: the card it is now has
      // to be in the set, and so does the one asked for. A sender naming a card
      // outside the group would otherwise turn a Bit into anything at all.
      if (!forms.includes(t.cardId)) return no(`${t.label} is not one of that Action's forms.`);
      if (!forms.includes(cmd.cardId)) return no('That is not a form this unit can take.');
      if (cmd.cardId === t.cardId) return no(`${t.label} is already in that Stance.`);
      if (!data.byId.get(cmd.cardId)) return no('That form is missing from the card data.');
      return ok;
    }
    case 'unfold': {
      if (!t) return no('That unit is not on the board.');
      const card = data.byId.get(t.cardId);
      const into = card ? unfoldsInto(card) : undefined;
      if (!into) return no(`${t.label} does not Unfold into anything.`);
      if (!data.byId.get(into)) return no('The Unfolded card is missing from the data.');
      // The replacement happens in the Delay Phase, which is also why the Drone
      // cannot attack in the round it Unfolds - the Automatic Phase is already
      // past (FAQ M8/M18.3).
      if (PHASES[state.round.phase] !== 'Delay') {
        return no(`${t.label} Unfolds in the Delay Phase (FAQ M18).`);
      }
      return ok;
    }
    case 'transformPart': {
      if (!t) return no('That unit is not on the board.');
      if (t.kind !== 'mech' || !t.mech) return no('Only a Mech carries Parts that can be turned over.');
      const held = t.mech[cmd.slot];
      const from = held ? data.byId.get(held) : undefined;
      if (!from) return no(`${t.label} has nothing in that slot.`);
      const into = data.byId.get(cmd.cardId);
      if (!into) return no('That is not a card the database knows.');
      // A destroyed Part is off the Mech: there is no card left to turn over.
      if ((t.partStates[cmd.slot] ?? 'intact') === 'destroyed') {
        return no(`${t.label}'s ${SLOT_LABEL[cmd.slot]} is destroyed.`);
      }
      // The two faces are one physical card, so the slot cannot change with the
      // flip — and being the SAME card is what makes a transform legal at all.
      if (into.type !== from.type) return no('That face does not fit the same slot.');
      if (!transformFaces(data, from).includes(into.id)) {
        return no(`${cardName(from)} does not turn into ${cardName(into)}.`);
      }
      return ok;
    }
    case 'tether': {
      if (!t) return no('That unit is not on the board.');
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.uid === t.uid) return no('A unit cannot Tether itself.');
      if (!Number.isInteger(cmd.range) || cmd.range < 1) return no('Tether X needs a leash length.');
      // The chip is placed on a unit the Harpoon just hit, so it always starts
      // inside its own leash; one placed outside would come straight back off
      // under the same rule that removes it.
      if (rangeBetween(t, target).range > cmd.range) {
        return no(`${target.label} is already further than ${cmd.range} Grids away.`);
      }
      return ok;
    }
  }
}

// Every command lands through here, so the board's derived relationships are
// settled in ONE place afterwards rather than sprinkled over the movement
// branches. A Tether comes off when the two ends drift apart, and they can
// drift on a Maneuver, a Knockback, a Push, a Prototype Blink, a Crush
// displacement or a unit being destroyed mid-attack — six paths, one of which
// would have been missed. The sweep is a no-op on a board with no chips on it.
export function apply(data: GameData, state: GameState, cmd: Command): void {
  applyCommand(data, state, cmd);
  settleTethers(data, state);
}

// ---------- 4.12.3's second consequence: the Low Profile Token ----------
//
// The rule prints TWO consequences in one sentence and this engine shipped only
// one of them. "Performing any Action that does not have the Silence Keyword
// causes Units in the Optical Camouflage State to be Revealed AND Low Profile
// Tokens to be removed" (rules/05_advanced_combat.md 4.12.3, book p.73). Every
// surface wired the Reveal half; nothing anywhere took the Token off, so a unit
// that gained one kept it for the rest of the game — an LPA-21 Firefly phased
// through units forever and every Firing Attack against it counted [Eye] as
// [Dodge]. units.ts records the gap this closes, above phasesThroughUnits.
//
// WHY IT LIVES IN apply() AND NOT BESIDE EITHER PAGE'S REVEAL. The two halves
// look like one rule but are not the same kind of thing. A Reveal is a PROMPT:
// the Match Centre's revealsOwed runs at RENDER time and offers a button,
// freeplay asks in a dialog, and both let a table wave it away as a house rule.
// This half is automatic, unconditional, and a state mutation — so it belongs
// in the command every surface already sends, where a mirrored seat replays it
// from the same command and cannot drift. It also means the Match Centre, the
// guide and the freeplay board cannot disagree about it, because there is one
// copy rather than three.
//
// THE REMOVAL GOES THROUGH removeStatus's OWN apply rather than filtering
// `statuses` here. That block also drops the token's `expiring` entry, and a
// Low Profile Token decays (green, types.ts), so a hand-rolled filter would
// leave a stale red-face marker behind on a unit no longer carrying the Token.
// One call is enough: Low Profile is a Hexagon Token and a unit may bear only
// one (2.5.3), which addStatus enforces on the way in.
function shedLowProfile(data: GameData, state: GameState, t: Token): void {
  if (statusCount(t.statuses, 'lowProfile') === 0) return;
  applyCommand(data, state, {
    kind: 'removeStatus', seat: t.side, uid: t.uid, targetUid: t.uid, statusId: 'lowProfile',
  });
}

function applyCommand(data: GameData, state: GameState, cmd: Command): void {
  if (cmd.kind === 'advancePhase') {
    // The both-ready agreement is consumed by the turn it authorised, so
    // every phase asks afresh — and a racing second advance finds the flags
    // gone and is refused, which is the idempotence.
    state.ready = {};
    const r = state.round;
    if (r.phase < PHASES.length - 1) {
      r.phase++;
    } else {
      r.phase = 0;
      r.n++;
      r.firstPlayer = r.firstPlayer === 's1' ? 's2' : 's1';
      state.commandTokens = { s1: 0, s2: 0 };
      for (const x of state.tokens) x.timing = undefined;
      // Last round's commitments describe dials that no longer exist, and
      // leaving them would let the next round's reveal check against them.
      if (state.script) {
        state.script.commits = {};
        state.script.revealed = [];
      }
      // All Terminal Tokens flip back face-up at the End Phase (5.3.3), so the
      // new round starts with every Terminal accessible again.
      for (const i of state.tasks?.items ?? []) if (i.kind === 'terminal') i.accessed = null;
      // LPA-19 Quartz, 沉著 Composure: "Recover 1 Link at the end of each
      // round." Hung on the round ROLLOVER rather than on a markEndStep id,
      // because the two pages' End-Phase step orders genuinely differ (the
      // guide runs remove/commons/tokens/tasks, the Match Centre runs
      // tokens/smoke/remove/tasks) and the same id would therefore fire at a
      // different moment on each. This runs once, from one command, for both.
      //
      // Two consequences worth stating rather than discovering:
      //  - the markEndStep 'remove' sweep has already taken any Mech down to
      //    <= 2 Parts, so a Quartz leaving on Integrity Loss does not recover;
      //  - a Shutdown Quartz goes 0 -> 1 and STAYS Shutdown. Every other +1
      //    Link path in the engine leaves Stance alone (stabilise, Aster) and
      //    only `reboot` clears it (4.1.1), so Composure is not a
      //    get-out-of-Shutdown card.
      for (const x of state.tokens) {
        if (x.kind !== 'mech' || !pilotIs(data, x, 'LPA-19')) continue;
        if (x.partStates?.torso === 'destroyed') continue;
        x.link = Math.min(maxLink(data, x), (x.link ?? 0) + 1);
      }
    }
    return;
  }
  if (cmd.kind === 'setPhase') {
    state.ready = {};
    state.round.phase = cmd.phase;
    return;
  }
  if (cmd.kind === 'resetRounds') {
    state.round.n = 1;
    state.round.phase = 0;
    state.commandTokens = { s1: 0, s2: 0 };
    // Plays are stamped with a round number, so winding the track back to 1
    // would leave round 1's cards reading as already spent.
    state.tacticsPlayed = { s1: [], s2: [] };
    if (state.script) {
      state.script.commits = {};
      state.script.revealed = [];
    }
    return;
  }
  if (cmd.kind === 'adjustCommandTokens') {
    if (!state.commandTokens) state.commandTokens = { s1: 0, s2: 0 };
    state.commandTokens[cmd.pool] = Math.max(0, state.commandTokens[cmd.pool] + cmd.delta);
    return;
  }
  if (cmd.kind === 'passTurn') {
    const sc = state.script;
    const phase = PHASES[state.round.phase];
    if (!sc || !isLoopPhase(phase)) return;
    if (!sc.passed.includes(cmd.seat)) sc.passed.push(cmd.seat);
    sc.turn = nextTurn(state, phase, cmd.seat) ?? cmd.seat;
    return;
  }
  if (cmd.kind === 'markEndStep') {
    const sc = state.script;
    if (!sc) return;
    if (cmd.step === 'tokens') {
      // Yellow tokens flip, red tokens come off (2.5.3). Command Tokens are
      // swept here and only here, because 3.7.2 takes ALL of them - the ones a
      // Mech reserved, the ones it consumed, and any a Drone picked up after
      // the Command Phase through Command Coordination. ageTokens cannot do it:
      // a Command Token has no printed decay colour, so it is not a Square
      // that ages, it is a component the End Phase collects.
      for (const x of state.tokens) ageTokens(x);
      clearCommandTokens(state);
    }
    if (cmd.step === 'remove') {
      // Integrity Loss (4.4.4): a Mech down to 2 Parts leaves in the End Phase.
      // The kill is credited to the LAST unit that reduced its Part count
      // (FAQ P4), which applyPenetration recorded on the way down.
      const dying = state.tokens.filter((x) => x.kind === 'mech' && Object.values(x.partStates).filter((p) => p !== 'destroyed').length <= 2);
      if (dying.length) {
        const tasks = normaliseTasks(state.tasks);
        for (const v of dying) {
          if (v.lastDamagedBy) applyKill(tasks, v.lastDamagedBy, { side: v.side, kind: v.kind, lowValue: lowValueUnit(data, v) }, 'unit');
          // Everything still bolted to it leaves with it. A Mech can withdraw
          // on Integrity Loss with a live backpack, and the -1 riders are owed
          // all the same — nothing on the board records that after this line.
          recordUnitLoss(tasks, v);
        }
        state.tasks = tasks;
      }
      state.tokens = state.tokens.filter((x) => !dying.includes(x));
    }
    if (cmd.step === 'tasks') {
      const tasks = normaliseTasks(state.tasks);
      settleControl(tasks, zoneCells(data), state.tokens, (x) => lowValueUnit(data, x));
      state.tasks = tasks;
    }
    const key = `${state.round.n}:end:${cmd.step}`;
    if (!sc.endDone.includes(key)) sc.endDone.push(key);
    return;
  }
  if (cmd.kind === 'award') {
    const tasks = normaliseTasks(state.tasks);
    // The Award judges control as part of the same reading of the board that
    // it scores (5.3.2), so the settlement happens here too.
    settleControl(tasks, zoneCells(data), state.tokens, (x) => lowValueUnit(data, x));
    // The ONE place a Victory Point total is floored. A printed rider can send
    // a delta negative (300, 500), and 5.2.4 knows no score below zero — but
    // the clamp belongs on the running TOTAL, never on the delta: a side on 6
    // taking a lone -1 finishes on 5, and clamping the delta would leave them
    // on 6. Here it covers the guide, the Match Centre, the hand-edit buttons,
    // replay and rollback identically.
    tasks.vp.s1 = Math.max(0, tasks.vp.s1 + cmd.vp.s1);
    tasks.vp.s2 = Math.max(0, tasks.vp.s2 + cmd.vp.s2);
    for (const k of cmd.keys) if (!tasks.scored.includes(k)) tasks.scored.push(k);
    tasks.paidKills = { s1: { ...tasks.kills.s1 }, s2: { ...tasks.kills.s2 } };
    tasks.paidTestKills = { ...tasks.testKills };
    state.tasks = tasks;
    const sc = state.script;
    if (sc) {
      const key = `${state.round.n}:end:tasks`;
      if (!sc.endDone.includes(key)) sc.endDone.push(key);
    }
    return;
  }
  if (cmd.kind === 'importSquad') {
    const su = normaliseSetup(state.setup);
    const staging = !!su && su.stage !== 'done';
    // The first list a side brings names it. Topping up afterwards leaves the
    // name alone — adding one mech should not rename the whole squad.
    if (cmd.name && !state.sideNames?.[cmd.seat]) {
      state.sideNames = { ...(state.sideNames ?? {}), [cmd.seat]: cmd.name };
    }
    const facing: Facing = cmd.seat === 's1' ? 2 : 0;
    const arrive = (tok: Token) => {
      if (staging) {
        // Setup is running, so the unit joins the squad rather than the board
        // and goes through the 3.1.4 deployment alternation like everything.
        tok.deployed = false;
      } else {
        // The open table places it straight away, on the first clear spot from
        // the squad's own edge. Terrain-blind on purpose: a mirrored placement
        // only has to agree on both clients, and free play lets the owner drag
        // it from there — the careful spot-finding stays with the local UI.
        const spot = freeSpot(state, tok.size, cmd.seat, tok.aerial);
        if (spot) { tok.col = spot.col; tok.row = spot.row; }
        else tok.deployed = false;
      }
      state.tokens.push(tok);
    };
    for (const m of (Array.isArray(cmd.mechs) ? cmd.mechs : [])) {
      arrive({ ...makeMechToken(state, data, m.loadout, cmd.seat, m.name), col: 0, row: 0, facing } as Token);
    }
    for (const d of (Array.isArray(cmd.drones) ? cmd.drones : [])) {
      const card = data.byId.get(d.cardId);
      if (!card) continue;
      arrive({ ...makeDroneToken(state, data, card, cmd.seat, d.backpack), col: 0, row: 0, facing } as Token);
    }
    return;
  }
  if (cmd.kind === 'configureTable') {
    // A new battlefield starts whole: the rubble belonged to the old one.
    if (cmd.map !== undefined) {
      state.map = cmd.map;
      state.removedTerrain = [];
    }
    if (cmd.zoneSet !== undefined) state.zoneSet = cmd.zoneSet;
    if (cmd.mission !== undefined) state.mission = cmd.mission;
    if (cmd.tasks !== undefined) state.tasks = cmd.tasks === null ? null : normaliseTasks(cmd.tasks);
    if (cmd.scale !== undefined) state.scale = cmd.scale;
    if (cmd.roundLimit !== undefined) state.roundLimit = cmd.roundLimit;
    return;
  }
  if (cmd.kind === 'startMatch') {
    // The state half of "Start game": both ends of a wire begin the identical
    // match. Anything already standing goes back to its squad for deployment.
    state.tokens = state.tokens.filter((t) => t.kind !== 'projectile');
    for (const t of state.tokens) t.deployed = false;
    state.smoke = [];
    state.round = { n: 1, phase: 0, firstPlayer: 's1' };
    state.commandTokens = { s1: 0, s2: 0 };
    state.setup = newSetup();
    state.script = undefined;
    // Ready flags belong to the lobby that is now over.
    state.ready = {};
    return;
  }
  if (cmd.kind === 'setRollbackCatalog') {
    const sc = state.script;
    if (sc) sc.rollbackCatalog = cmd.entries.map((p) => ({ ...p }));
    return;
  }
  if (cmd.kind === 'callDefense') {
    const sc = state.script;
    if (sc) sc.combat = { attackerUid: cmd.uid, targetUid: cmd.targetUid, actionId: cmd.actionId, white: cmd.white, blue: cmd.blue, faces: null };
    return;
  }
  if (cmd.kind === 'answerDefense') {
    // The faces ride in the command, never re-rolled by a receiver — the same
    // rule as the Counter-roll and the setup roll, so both boards hold the
    // identical dice whichever side rolled them.
    const sc = state.script;
    if (sc?.combat) sc.combat.faces = cmd.faces.map((f) => ({ ...f }));
    return;
  }
  if (cmd.kind === 'clearDefense') {
    const sc = state.script;
    if (sc) sc.combat = null;
    return;
  }
  if (cmd.kind === 'focusAnswer' || cmd.kind === 'focusReroll' || cmd.kind === 'kcArmor' || cmd.kind === 'designateHit' || cmd.kind === 'meleeEvade' || cmd.kind === 'dodgeEnhance') {
    // Consumed by the attacking client's combat window as the command is
    // observed, the same way answerDefense is — the board itself carries
    // nothing for them to change (KC Armor's Charge spend travels as its own
    // setCharge from the defender's client).
    return;
  }
  if (cmd.kind === 'setCombatView') {
    const sc = state.script;
    // The resolution is copied out too, not carried by the spread alone: on the
    // ATTACKER's own client this command is applied locally, and that object is
    // the one their open helper is holding. Shared, the board would keep a live
    // reference into the wizard's context.
    const res = cmd.view?.resolution;
    if (sc) {
      sc.combatView = cmd.view
        ? {
            ...cmd.view,
            attack: cmd.view.attack?.map((f) => ({ ...f })) ?? null,
            defense: cmd.view.defense?.map((f) => ({ ...f })) ?? null,
            log: [...cmd.view.log],
            focus: cmd.view.focus ? { ...cmd.view.focus } : null,
            resolution: res
              ? {
                  duel: {
                    ...res.duel,
                    icons: res.duel.icons.map((i) => ({ ...i })),
                    triggers: res.duel.triggers.map((i) => ({ ...i })),
                  },
                  text: [...res.text],
                }
              : null,
          }
        : null;
    }
    return;
  }
  if (cmd.kind === 'rollbackRequest') {
    // check() already refused this without a script, so it exists by here.
    const sc = state.script;
    if (sc) sc.rollback = { by: cmd.seat, round: cmd.round, phase: cmd.phase, label: cmd.label, ...(cmd.seq !== undefined ? { seq: cmd.seq } : {}) };
    return;
  }
  if (cmd.kind === 'rollbackAnswer') {
    // Only the ASK is cleared here. The rewind happens outside the command
    // layer: undoing from inside apply() would be rewriting the board while
    // sitting in the history entry this very command just created. The page
    // reads the accepted answer and calls history.undoTo() itself.
    const sc = state.script;
    if (!sc) return;
    // An ACCEPTED answer leaves one branch of history for another, and the
    // count is what names the new one. It has to move here, inside the command,
    // so that it reaches a player who joins later through the checkpoint —
    // exactly like every other shared fact.
    if (cmd.accept) sc.rollbacks += 1;
    sc.rollback = null;
    return;
  }
  if (cmd.kind === 'setReady') {
    state.ready = { ...(state.ready ?? {}), [cmd.seat]: cmd.ready };
    return;
  }
  if (cmd.kind === 'pickSecondary') {
    const tasks = normaliseTasks(state.tasks);
    tasks.secondary[cmd.seat] = cmd.cardId;
    // Changing the card drops whatever the old one had named, so a Task never
    // carries a target chosen for a different card.
    tasks.secTarget[cmd.seat] = undefined;
    tasks.zone[cmd.seat] = undefined;
    state.tasks = tasks;
    return;
  }
  if (cmd.kind === 'setTactics') {
    if (!state.tactics) state.tactics = { s1: [], s2: [] };
    // Replaces rather than appends: the command carries the whole hand, so a
    // repeat of one that was already applied cannot double it.
    state.tactics = { ...state.tactics, [cmd.seat]: [...cmd.cards] };
    return;
  }
  if (cmd.kind === 'designateTask') {
    const tasks = normaliseTasks(state.tasks);
    const forSide: Side = cmd.for ?? cmd.seat;
    if (cmd.what === 'zone') tasks.zone[forSide] = cmd.zone;
    else if (cmd.what === 'leader') tasks.leader[forSide] = cmd.uid;
    else tasks.secTarget[forSide] = cmd.uid;
    state.tasks = tasks;
    return;
  }
  if (cmd.kind === 'endMatch') {
    // The state half of "End game"; the result dialog and the recording offer
    // stay with the UI, which runs them before this lands.
    for (const t of state.tokens) t.deployed = undefined;
    state.setup = null;
    state.tasks = null;
    state.removedTerrain = [];
    state.tokens = state.tokens.filter((t) => t.kind !== 'projectile');
    state.smoke = [];
    state.tacticsPlayed = { s1: [], s2: [] };
    return;
  }
  if (cmd.kind === 'lockMap') {
    state.setup = { ...(normaliseSetup(state.setup) ?? newSetup()), stage: 'roll' };
    return;
  }
  if (cmd.kind === 'rollSetup') {
    // The dice were rolled by the sender; the command carries the Hits, so a
    // mirrored seat never re-rolls them.
    const su = normaliseSetup(state.setup) ?? newSetup();
    // A tie sends both squads back to the dice (3.1.2), so the first re-roll
    // clears the other side's stale total rather than being compared against
    // it — otherwise one player re-rolling alone would decide the tie.
    const tied = !!su.rolls.s1.length && !!su.rolls.s2.length && !firstPlayerFrom(su);
    const other: Side = cmd.seat === 's1' ? 's2' : 's1';
    su.rolls = { ...su.rolls, [cmd.seat]: cmd.hits };
    if (tied) su.rolls = { ...su.rolls, [other]: [] };
    state.setup = su;
    return;
  }
  // Applies nothing: the command exists to be SNAPSHOTTED, not to change the
  // board. The ring records it and the rollback floor stops at it.
  if (cmd.kind === 'noteRoll') return;
  if (cmd.kind === 'acceptRoll') {
    const su = normaliseSetup(state.setup) ?? newSetup();
    const winner = firstPlayerFrom(su);
    if (!winner) return;
    state.round.firstPlayer = winner;
    // The Tasks come next, not the edges: the roll decides who reveals their
    // Secondary Task first (FAQ P1 steps 3-5).
    state.setup = { ...su, stage: 'tasks' };
    return;
  }
  if (cmd.kind === 'finishTasks') {
    const su = normaliseSetup(state.setup) ?? newSetup();
    if (su.stage !== 'tasks') return;
    state.setup = { ...su, stage: 'side' };
    return;
  }
  if (cmd.kind === 'pickEdge') {
    const su = normaliseSetup(state.setup) ?? newSetup();
    const fp = state.round.firstPlayer;
    const other: Side = fp === 's1' ? 's2' : 's1';
    state.setup = { ...su, stage: 'deploy', edge: { ...su.edge, [fp]: cmd.edge, [other]: cmd.edge === 'black' ? 'white' : 'black' } };
    return;
  }
  if (cmd.kind === 'lockDials') {
    if (state.script) state.script.stage = `${state.round.n}:1:locked`;
    return;
  }
  if (cmd.kind === 'finishDeployment') {
    state.setup = { ...(normaliseSetup(state.setup) ?? newSetup()), stage: 'done' };
    // The deployment agreement is consumed; a fresh one is minted per stage.
    state.ready = {};
    // The Command Phase stage was entered before the roll decided the First
    // Player; clearing it makes the guide's stage sync run again now that the
    // real one is known (3.2.2 starts the command loop from them).
    if (state.script) state.script.stage = '';
    return;
  }
  if (cmd.kind === 'queueIntercepts') {
    if (state.script) state.script.intercepts = [...state.script.intercepts, ...cmd.items];
    return;
  }
  if (cmd.kind === 'resolveIntercept') {
    const sc = state.script;
    if (!sc) return;
    const at = sc.intercepts.findIndex((x) => x.uid === cmd.uid && x.actionId === cmd.actionId && x.targetUid === cmd.targetUid);
    if (at >= 0) sc.intercepts = sc.intercepts.filter((_, i) => i !== at);
    return;
  }
  if (cmd.kind === 'clearIntercepts') {
    if (state.script) state.script.intercepts = [];
    return;
  }
  if (cmd.kind === 'clearCounterRoll') {
    if (state.script) state.script.counter = null;
    return;
  }
  if (cmd.kind === 'placeSmoke') {
    state.smoke = [...(state.smoke ?? []), { col: cmd.at.col, row: cmd.at.row, side: cmd.for ?? cmd.seat }];
    return;
  }
  if (cmd.kind === 'queueReactions') {
    if (!state.script) return;
    // Appended rather than replaced: a second attack can land while an earlier
    // reaction is still unanswered, and neither is forfeit.
    state.script.reactions = [...(state.script.reactions ?? []), ...cmd.items];
    return;
  }
  if (cmd.kind === 'removeSmoke') {
    const list = [...(state.smoke ?? [])];
    const at = list.findIndex((x) => x.col === cmd.at.col && x.row === cmd.at.row);
    if (at >= 0) list.splice(at, 1);
    state.smoke = list;
    return;
  }
  if (cmd.kind === 'setMode') {
    if (state.script) state.script.mode = cmd.mode;
    return;
  }
  if (cmd.kind === 'setStrict') {
    if (state.script) state.script.strict = cmd.strict;
    return;
  }
  if (cmd.kind === 'commitTimings') {
    if (state.script) state.script.commits = { ...state.script.commits, [cmd.seat]: cmd.hash };
    return;
  }
  if (cmd.kind === 'revealTimings') {
    const sc = state.script;
    if (!sc) return;
    // Only ever writes dials onto that seat's own units, so a reveal cannot
    // reach across and rewrite the other player's plan.
    for (const d of cmd.dials) {
      const t = state.tokens.find((x) => x.uid === d.uid);
      if (t && t.side === cmd.seat) t.timing = d.timing;
    }
    if (!sc.revealed.includes(cmd.seat)) sc.revealed = [...sc.revealed, cmd.seat];
    return;
  }
  if (cmd.kind === 'handOver') {
    // Pass-and-play planning runs as two sub-turns on sc.turn: the First
    // Player sets their dials, hands the device over, and the other squad
    // sets theirs before the lock reveals both at once.
    const sc = state.script;
    if (sc) sc.turn = cmd.seat === 's1' ? 's2' : 's1';
    return;
  }
  if (cmd.kind === 'dissipateSmoke') {
    // Isolated screens come off for both sides in one judgement (4.16); the
    // Connected-group picks arrive as removeSmoke commands afterwards.
    const smoke = state.smoke ?? [];
    const doomed = new Set<SmokeScreen>();
    for (const side of ['s1', 's2'] as Side[]) for (const iso of dissipationFor(smoke, side).isolated) doomed.add(iso);
    state.smoke = smoke.filter((x) => !doomed.has(x));
    return;
  }
  if (cmd.kind === 'forceMove') {
    const target = state.tokens.find((x) => x.uid === cmd.targetUid);
    if (!target) return;
    target.col = cmd.to.col;
    target.row = cmd.to.row;
    // The player causing a Forced Movement decides the victim's facing (3.4.4),
    // and may also turn a victim that could not be moved at all.
    if (cmd.facing !== undefined) target.facing = cmd.facing;
    // Push costs the victim 1 Link on top of the movement (4.13), and losing
    // the last one is a Shutdown like any other.
    if (cmd.push && target.kind === 'mech') {
      target.link = Math.max(0, (target.link ?? 0) - 1);
      if (target.link === 0 && target.stance !== 'shutdown') target.stance = 'shutdown';
    }
    return;
  }
  if (cmd.kind === 'recordKill') {
    const victim = state.tokens.find((x) => x.uid === cmd.targetUid);
    if (!victim) return;
    const tasks = normaliseTasks(state.tasks);
    applyKill(tasks, { side: cmd.seat, uid: cmd.uid }, { side: victim.side, kind: victim.kind, lowValue: lowValueUnit(data, victim) }, cmd.what);
    // The payload carries no slot, so nothing here can say WHICH Part died —
    // but a removed Unit loses all of them, and that much is readable from the
    // victim while it is still in hand. The per-Part case is stamped in
    // applyPenetration instead.
    if (cmd.what === 'unit') recordUnitLoss(tasks, victim);
    state.tasks = tasks;
    // A destroyed Unit leaves the board (4.4.4); the tally above is all that
    // is left of it.
    if (cmd.what === 'unit') state.tokens = state.tokens.filter((x) => x.uid !== cmd.targetUid);
    return;
  }
  if (cmd.kind === 'destroyTerrain') {
    const gone = new Set(state.removedTerrain ?? []);
    state.removedTerrain = [...(state.removedTerrain ?? []), ...cmd.pieces.filter((p) => !gone.has(p))];
    return;
  }
  if (cmd.kind === 'drainLink') {
    const target = state.tokens.find((x) => x.uid === cmd.targetUid);
    if (!target || target.kind !== 'mech') return;
    target.link = Math.max(0, (target.link ?? 0) - cmd.n);
    // Link at 0 is an immediate Shutdown, the same rule every other Link loss
    // already enforces.
    if (target.link === 0 && target.stance !== 'shutdown') target.stance = 'shutdown';
    return;
  }
  // Above the actor lookup: the attacker who chose the Grid may be a Projectile
  // that is already spent by the time this lands.
  if (cmd.kind === 'dropBlackBox') {
    const tasks = normaliseTasks(state.tasks);
    const box = tasks.items.find((i) => i.id === cmd.itemId);
    if (!box) return;
    box.bearerUid = undefined;
    box.bearerSlot = undefined;
    box.col = cmd.to.col;
    box.row = cmd.to.row;
    state.tasks = tasks;
    return;
  }

  const t = state.tokens.find((x) => x.uid === cmd.uid);
  if (!t) return;
  const sc = state.script;

  switch (cmd.kind) {
    case 'setTiming':
      t.timing = cmd.timing;
      return;
    case 'placeInGrid':
      t.col = cmd.to.col;
      t.row = cmd.to.row;
      return;
    case 'setStance': {
      // Choosing does NOT lock: cycling the dial to compare Stances is free
      // right up until the Mech acts. lockStance() below is what closes it.
      t.stance = cmd.stance;
      return;
    }
    case 'defenseReaction': {
      // No Stance lock is consulted: reacting to a Penetration is the exception
      // the card buys, and check() has already confirmed it carries one.
      t.stance = 'defensive';
      return;
    }
    case 'reboot': {
      t.stance = cmd.stance;
      t.link = Math.min(maxLink(data, t), (t.link ?? 0) + 1);
      const o = oppOf(state, cmd.uid);
      if (o) {
        // 4.1.1: the Reboot consumes the Opportunity except for one Action
        // Tick, which must match the freshly chosen dial, so the Starting
        // Action rule is re-armed rather than already satisfied.
        o.maneuver = 0;
        o.maneuvered = true;
        o.action = 1;
        o.started = false;
        o.performed = [...o.performed, 'COMMON_REBOOT'];
        // A Reboot IS the Stance choice (4.1.1), so the one remaining Action
        // Tick must not be refused by the 4.1 lock gate.
        o.stanceLocked = true;
      }
      return;
    }
    case 'crushSwap': {
      // 4.3.6, and it is ONE mutation on purpose: every token the exchange
      // touches moves here, so no snapshot the undo ring or the networked
      // rollback takes can land between the two halves and leave the crusher
      // standing on the unit it traded places with.
      for (const s of cmd.swaps) {
        const v = state.tokens.find((x) => x.uid === s.uid);
        if (!v) continue;
        v.col = s.to.col;
        v.row = s.to.row;
        // 3.4.4 and FAQ E17: the player who CAUSES a Forced Movement decides the
        // moved Unit's Facing — E17 settles it for the Taurus Prototype Blink,
        // and an exchange is Forced Movement like any other, so the crushing
        // player is asked here exactly as they are for the ordinary Crush shove.
        if (s.facing !== undefined) v.facing = s.facing;
      }
      t.col = cmd.to.col;
      t.row = cmd.to.row;
      // The crusher's own Facing is only ever what the player set for the
      // Movement: 3.4.4 hands out the Facing of the unit being MOVED BY someone,
      // and nothing turns the Crushing Unit as a consequence of the exchange.
      if (cmd.facing !== undefined) t.facing = cmd.facing;
      // No Opportunity accounting, deliberately — see check(). The Movement that
      // caused this is recorded by its own `maneuver`, which is where the
      // Maneuver Tick is spent on both pages.
      return;
    }
    case 'maneuver': {
      const from = cmd.from ?? { col: t.col, row: t.row };
      t.col = cmd.to.col;
      t.row = cmd.to.row;
      if (cmd.facing !== undefined) t.facing = cmd.facing;
      // NON-HUMANOID X: the Link is spent for PERFORMING the Action, so it is
      // paid on the Movement Action itself and never on a bare Maneuver. check()
      // has already refused a unit that cannot afford it; the clamp is here
      // because apply() is also the rollback replayer's road and must not push a
      // Link negative if it ever arrives without its check.
      const cost = nonHumanoidCost(cmd.actionId ? findAction(data, state, cmd.uid, cmd.actionId) : null);
      if (cost > 0) t.link = Math.max(0, (t.link ?? 0) - cost);
      // 4.12.3: "Maneuver does not benefit from Silence unless otherwise
      // specified" — Maneuvering, INCLUDING changing facing without Movement,
      // removes the Low Profile Token. This one command carries both cases: a
      // pivot arrives with `to` equal to the Grid the unit already stands in,
      // which is exactly how the Match Centre sends a turn on the spot.
      //
      // Judged at the START and the landing grids, the same reading the Reveal
      // half is given (FAQ O11/O15): an enemy Patrol Eagle's aura strips the
      // Silence a Stealth Chassis prints (card 100 LM210S — NOT PL29, which
      // lost the keyword in the v1.021 redesign; see maneuverPrintsSilence in
      // units.ts), and a unit that walked out of that aura must not
      // retroactively get its Silence back. `from` is the
      // pre-move position captured above, spread over the token so the denier
      // is asked about the unit as it STOOD.
      if (!maneuverIsSilent(data, state.tokens, t, { ...t, col: from.col, row: from.row })) {
        shedLowProfile(data, state, t);
      }
      const o = oppOf(state, cmd.uid);
      // A Movement Action already paid with an Action Tick, and one a card
      // handed out was never charged to the Opportunity at all.
      if (o && sc && !cmd.free && !cmd.granted) {
        // M2 Data Link: "the Ally Drone may move 1 grid before performing
        // Actions". A move within that allowance leaves the activation open,
        // so the Drone may still act; anything longer, or a second one, spends
        // it as normal. Measured from where it STOOD, which is why `from` is
        // taken before the position is written above — and why a sender that
        // has already placed the unit, as the Crush exchange has, says so with
        // `cmd.from` rather than leaving this to measure zero Grids.
        const grids = Math.abs(Math.floor(cmd.to.col / 3) - Math.floor(from.col / 3))
          + Math.abs(Math.floor(cmd.to.row / 3) - Math.floor(from.row / 3));
        const rider = t.kind === 'drone' ? riderOnDrone(data, state.tokens, t) : { preMove: 0 };
        const freeGrid = rider.preMove > 0 && !o.preMoved && !o.started && grids <= rider.preMove;
        // `from` is kept on the Opportunity as well as used above, because a
        // Movement is judged at the start AND landing grids only (FAQ O11/O15)
        // and the readers that ask — the Match Centre's Reveal sweep, which
        // runs at render time — see the board only after it has moved. It is
        // the same `from` the M2 arithmetic uses, so there is one truth about
        // where this unit stood.
        sc.opp = freeGrid
          ? { ...o, moved: true, preMoved: true, movedFrom: from }
          : { ...lockStance(t, spendManeuver(o)), movedFrom: from };
      }
      return;
    }
    case 'performAction': {
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      const o = oppOf(state, cmd.uid);
      // 4.12.3, the half that is not a Reveal: ANY Action without the Silence
      // Keyword takes this unit's Low Profile Token off. Deliberately wider
      // than Maneuver — the rule says Action, and the Firing Attack that makes
      // the Token worth having is the commonest way to lose it.
      //
      // Before the granted return below, because a granted Action is still an
      // Action performed: a Riposte's free Melee swing is not Silent and the
      // Token goes with it. Nothing about 4.12.3 asks who paid the Tick.
      //
      // PASSIVE AND INTERCEPTION ARE CARVED OUT, and the carve-out is
      // load-bearing: 4.12.3 exempts both by name, so neither Reveals nor
      // sheds. Interception needs nothing here — it has its own
      // spendIntercept/resolveIntercept pair and never reaches this command.
      // Passive is tested EXPLICITLY rather than left to the senders. No page
      // sends one today (matchhud filters `isPassive` out of its action list,
      // the guide's phaseActions skips them, and a Mech's length-less Passive
      // sends nothing at all), but "no caller does that" is a habit, not a
      // rule, and the next caller would break the exemption in silence.
      const passive = a?.type === 'Passive' || a?.speed === 'passive';
      if (a && !passive && !isSilentAction(data, state.tokens, t, a)) {
        shedLowProfile(data, state, t);
      }
      // A granted Action spends its grant HERE, so taking the Action and
      // spending it are one step. Clearing the debt from the panel instead
      // leaves a window in which one Riposte buys several Melee Actions.
      if (cmd.granted && sc) {
        const at = (sc.reactions ?? []).findIndex((r) => r.uid === cmd.uid && r.kind === 'riposte');
        if (at >= 0) sc.reactions.splice(at, 1);
        // It belongs to no Opportunity, so there are no Ticks to charge.
        return;
      }
      if (a && o && sc) {
        sc.opp = t.kind === 'mech'
          // anyTiming rides along with flexible so the SPEND agrees with the
          // check that let the Action through -- miss it and a Starting Action
          // FPA-01 allowed is re-read as needing an Extra Tick it never used.
          ? lockStance(t, spendAction(o, a, cmd.partKey || a.id, { flexible: hasFlexibleTiming(data, state.tokens, t, a), anyTiming: anyStartTiming(data, t) }))
          : spendActivation(o, a);
      }
      return;
    }
    case 'overload': {
      t.link = Math.max(0, (t.link ?? 0) - 1);
      const o = oppOf(state, cmd.uid);
      if (o && sc) sc.opp = spendOverload(o);
      // Spending the last Link is a Shutdown like any other: the consequence
      // lives inside the command so a mirrored seat reaches the same state.
      if (t.link === 0 && t.stance !== 'shutdown') t.stance = 'shutdown';
      return;
    }
    case 'attackMode': {
      const o = oppOf(state, cmd.uid);
      if (!o || !sc) return;
      const points = opportunityBonusOn(data, t)?.actionPoints ?? 1;
      // Taking the Tick IS the Stance choice, the same reasoning a Reboot runs
      // on (4.1.1): the Mech has committed to Offensive to earn it. That lock
      // is the ENTIRE anti-abuse mechanism. Without it a Mech could bank the
      // Tick in Offensive Stance and flip to Mobility before spending it; with
      // it, setStance's existing 4.1 gate refuses the flip, so nothing here or
      // anywhere else has to re-check the Stance or hand the Tick back.
      sc.opp = lockStance(t, spendAttackMode(o, points));
      return;
    }
    case 'playTactic': {
      const spec = tacticSpec(cmd.cardId);
      if (!spec) return;
      const log = spec.apply(t, state, tacticCtx(data), cmd.pick ?? null);
      if (spec.freeCommand && sc) {
        sc.commanded = sc.commanded.filter((x) => x !== t.uid);
        if (!sc.freeCommand.includes(t.uid)) sc.freeCommand.push(t.uid);
      }
      if (!state.tacticsPlayed) state.tacticsPlayed = { s1: [], s2: [] };
      state.tacticsPlayed[cmd.seat].push(`${state.round.n}:${cmd.cardId}`);
      // The card's log line embeds values computed during the effect, so it is
      // written here, where a mirrored seat writes the identical line. The UI
      // reads it back off the token.
      t.log = [...(t.log ?? []), { round: state.round.n, text: log }].slice(-200);
      return;
    }
    case 'deployUnit': {
      const fresh = t.deployed === false;
      t.col = cmd.to.col;
      t.row = cmd.to.row;
      // Facing its own table edge is the default; a player who turned it before
      // confirming gets the way they pointed it.
      t.facing = cmd.facing ?? (t.side === 's1' ? 2 : 0);
      t.deployed = true;
      // A Mech picks its Stance as it lands; anything else keeps its printed one.
      if (t.kind === 'mech' && cmd.stance) t.stance = cmd.stance;
      if (cmd.camo) t.statuses = addStatus(t.statuses, 'camouflage');
      // Nudging a unit already down is not a placement, so the alternation
      // count only moves on the first landing.
      const su = normaliseSetup(state.setup);
      if (su && fresh) {
        su.placed = { ...su.placed, [t.side]: su.placed[t.side] + 1 };
        state.setup = su;
      }
      // Moving a unit after declaring ready withdraws that agreement for
      // everyone — the other player was ready for a different board.
      if (!fresh) state.ready = {};
      return;
    }
    case 'applyPenetration': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      const cur = target.partStates[cmd.slot] ?? 'intact';
      // structureOf, not card.structure: FPA-05 Anser gives a 0-Structure
      // Chassis 2, and the DAMAGE LADDER is where that matters most — without
      // it the Chassis still skips 'damaged' and dies to one Penetration, and
      // the trait does nothing at all.
      target.partStates[cmd.slot] = cur === 'intact' ? (structureOf(data, target, cmd.slot) > 0 ? 'damaged' : 'destroyed') : 'destroyed';
      // "The Tether Tokens are removed when the INITIATING unit is Penetrated"
      // (PDLH-202). Being Penetrated while tethered does nothing, which is the
      // point of the harpoon. Stamped here rather than in either page's
      // onPenetrated callback: this is the one place a Penetration becomes true
      // on both boards and in a replay, and those callbacks are per-page copies
      // that would drift the moment one of them was edited alone.
      cutTethersOn(data, state, target, 'initiator');
      if (target.partStates[cmd.slot] === 'destroyed' && target.kind === 'mech') {
        // FPA-03 Wu keeps his Link when a Part goes. The lastDamagedBy stamp
        // below is NOT inside the guard: the Integrity-Loss kill (FAQ P4) is
        // owed whether or not the Link moved.
        if (!keepsLinkOnPartLoss(data, target)) {
          target.link = Math.max(0, (target.link ?? 0) - 1);
          if (target.link === 0 && target.stance !== 'shutdown') target.stance = 'shutdown';
        }
        // The last unit to reduce the Part count gets the Integrity-Loss kill
        // if the Mech leaves in the End Phase (FAQ P4).
        target.lastDamagedBy = { side: cmd.seat, uid: cmd.uid };
      }
      if (target.partStates[cmd.slot] === 'destroyed') {
        // Same site, same reason as lastDamagedBy: cards 300 and 500 dock a
        // Victory Point at the end of the game "if this Part is destroyed", and
        // by then the unit may have left the board entirely. The board stops
        // being able to answer, so the answer is stamped as it happens.
        const tasks = normaliseTasks(state.tasks);
        recordPartLoss(tasks, target, cmd.slot);
        state.tasks = tasks;
      }
      return;
    }
    case 'applyStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      // addStatus owns the single-Hexagon rule (2.5.3), so stacking through it
      // keeps the displacement identical on every seat.
      for (let i = 0; i < (cmd.stacks ?? 1); i++) target.statuses = addStatus(target.statuses, cmd.statusId);
      // A replaced or refreshed Hexagon starts on its yellow face (FAQ J22):
      // the stale red marker would otherwise remove the fresh token a round
      // early. Squares keep theirs — each stacked entry ages on its own.
      const def = STATUSES.find((x) => x.id === cmd.statusId);
      if (def?.shape === 'hexagon') {
        const hexes = new Set(STATUSES.filter((x) => x.shape === 'hexagon').map((x) => x.id));
        target.expiring = (target.expiring ?? []).filter((x) => !hexes.has(x));
      }
      // A Command placed by hand is a Command the side may spend, so the pool
      // is recomputed from the board rather than nudged.
      if (COMMAND_FACES.has(cmd.statusId)) syncCommandPool(state);
      return;
    }
    case 'removeStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      // The LAST entry, so peeling one off a stacked Square leaves the rest —
      // the same end the freeplay chip reached by hand.
      const list = [...(target.statuses ?? [])];
      const at = list.lastIndexOf(cmd.statusId);
      if (at < 0) return;
      list.splice(at, 1);
      target.statuses = list;
      // A token that is gone has no expiry left to track.
      if (!list.includes(cmd.statusId)) {
        target.expiring = (target.expiring ?? []).filter((x) => x !== cmd.statusId);
      }
      // Same on the way out. A Drone's face-down token was paid for when the
      // Command was issued, and the pool only ever counts face-up Mech tokens,
      // so removing one by hand correctly changes nothing.
      if (COMMAND_FACES.has(cmd.statusId)) syncCommandPool(state);
      return;
    }
    case 'focus': {
      // Nothing is consumed for a Cadaver at <= 3 Parts, so nothing is debited
      // and the Shutdown consequence below cannot be reached by this route
      // either. All four Focus senders keep sending a plain `focus`: the rule
      // lives in the command, which is the single source of truth the four
      // disagreeing UI gates used not to have.
      if (focusIsFree(data, t)) return;
      t.link = Math.max(0, (t.link ?? 0) - 1);
      if (t.link === 0 && t.kind === 'mech' && t.stance !== 'shutdown') t.stance = 'shutdown';
      return;
    }
    case 'restoreLink': {
      // Clamped by the pilot's Link Value, the same ceiling stabilise, reboot
      // and Aster's restore all use. Stance is left alone: no +1 Link path in
      // this engine wakes a Shutdown Mech, only `reboot` does (4.1.1).
      t.link = Math.min(maxLink(data, t), (t.link ?? 0) + 1);
      return;
    }
    case 'spendAmmo': {
      // Debits whichever magazine check() said would pay. restoreAmmo below
      // deliberately does NOT go through ammoPay: a resupply refills the Part
      // it names, never whichever pool happened to pay last.
      const { from, poolId } = ammoPay(data, state, t, cmd.actionId);
      if (from.ammo[poolId] !== undefined) from.ammo[poolId] = Math.max(0, from.ammo[poolId] - 1);
      return;
    }
    case 'restoreAmmo': {
      const from = ammoHolder(data, state, t, cmd.actionId);
      if (from.ammo[cmd.actionId] === undefined) return;
      const max = ammoMax(data, from, cmd.actionId);
      const next = from.ammo[cmd.actionId] + (cmd.amount ?? 1);
      from.ammo[cmd.actionId] = max !== undefined ? Math.min(max, next) : next;
      return;
    }
    case 'takeBlackBox': {
      const tasks = normaliseTasks(state.tasks);
      const box = tasks.items.find((i) => i.id === cmd.itemId);
      if (!box) return;
      box.bearerUid = t.uid;
      box.bearerSlot = cmd.slot;
      // Off the board and onto the unit: a carried Box has no square of its own.
      box.col = undefined;
      box.row = undefined;
      state.tasks = tasks;
      return;
    }
    case 'spendIntercept': {
      const bag = t.intercept;
      if (!bag || bag[cmd.actionId] === undefined) return;
      bag[cmd.actionId] = Math.max(0, bag[cmd.actionId] - 1);
      return;
    }
    case 'restoreIntercept': {
      const bag = t.intercept;
      if (!bag || bag[cmd.actionId] === undefined) return;
      const max = interceptMax(data, t, cmd.actionId);
      const next = bag[cmd.actionId] + 1;
      bag[cmd.actionId] = max !== undefined ? Math.min(max, next) : next;
      return;
    }
    case 'startCounterRoll': {
      if (!sc) return;
      sc.counter = {
        initiatorUid: cmd.uid,
        responderUid: cmd.targetUid,
        actionId: cmd.actionId,
        initRoll: null,
        respRoll: null,
        initFocused: false,
        respFocused: false,
        provoke: null,
      };
      return;
    }
    case 'rollCounter': {
      const c = sc?.counter;
      if (!c) return;
      if (cmd.uid === c.initiatorUid) {
        c.initRoll = [...cmd.faces];
        if (cmd.focused) c.initFocused = true;
      } else if (cmd.uid === c.responderUid) {
        c.respRoll = [...cmd.faces];
        if (cmd.focused) c.respFocused = true;
      }
      return;
    }
    case 'disarm': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target || target.kind !== 'mech' || !target.mech) return;
      const held = target.mech[cmd.slot as PartSlot];
      const from = held ? data.byId.get(held) : undefined;
      const far = from ? discardFaceOf(data, from) : null;
      // Derived here rather than carried on the command, so the wire cannot
      // name a face the pointer does not: the same single-source rule the
      // crushSwap step-out grid follows.
      if (far) transformPartOn(data, target, cmd.slot as PartSlot, far.id);
      return;
    }
    case 'suppress': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target || target.stance === 'shutdown') return;
      // "Switches", so an already-Defensive Mech simply stays put. No Stance
      // lock is written, for the same reasons provoke writes none below: 4.1
      // owns the locking, and inventing one here would add a clause the
      // keyword does not print.
      target.stance = 'defensive';
      return;
    }
    case 'provoke': {
      // The answer is recorded FIRST and whichever way it went, so the far seat
      // stops waiting on a question that has been answered -- a decline is as
      // much of an outcome as a switch. Guarded on the pair, because a
      // Counter-roll that moved on while the answer was in flight is not the
      // one this answers.
      const c = sc?.counter;
      if (c && c.responderUid === cmd.uid && c.initiatorUid === cmd.targetUid && !c.provoke) {
        c.provoke = cmd.take ? 'taken' : 'passed';
      }
      if (!cmd.take) return;
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      target.stance = 'offensive';
      // No Stance lock is written here, and none is needed: 4.1 locks the dial
      // when a Mech moves or acts, and the Initiator of an Electronic Attack
      // has already acted -- lockStance ran on its performAction -- so setStance
      // will refuse to turn it back this Opportunity. Where it has NOT acted
      // (a Target Tracing Counter-roll opened as a reaction, 174), 4.1 says its
      // next Opportunity opens with a free choice of Stance anyway, so forcing
      // a lock here would invent a clause this card does not print.
      return;
    }
    case 'setCharge': {
      // Absent rather than empty when nothing is Charged, which is what
      // migrateState writes back and what isCharged reads.
      const held = new Set(t.charge ?? []);
      if (cmd.on) held.add(cmd.slot);
      else held.delete(cmd.slot);
      t.charge = held.size ? [...held] : undefined;
      return;
    }
    case 'riposte': {
      // Half one of the card: the attacker's Opportunity ends at once. Mirrors
      // endOpportunity's apply rather than calling it, because the two branches
      // are the rule -- a nested Extra resumes what it interrupted and never
      // marks the Mech as acted (K19/K21); a normal one is spent.
      if (!sc || sc.opp?.uid !== cmd.fromUid) return;
      if (sc.opp.extra) {
        sc.opp = sc.oppStack.pop() ?? null;
        return;
      }
      if (onExtraOpportunity(state, cmd.fromUid)) {
        const at = sc.extraOpps.indexOf(cmd.fromUid);
        if (at >= 0) sc.extraOpps.splice(at, 1);
      } else if (!sc.acted.includes(cmd.fromUid)) {
        sc.acted.push(cmd.fromUid);
      }
      sc.opp = null;
      return;
    }
    case 'endOpportunity': {
      if (!sc) return;
      // A nested Extra Opportunity resumes whoever it interrupted (FAQ K21)
      // and never marks the echoed Mech as having acted (K19).
      if (sc.opp?.uid === cmd.uid && sc.opp.extra) {
        sc.opp = sc.oppStack.pop() ?? null;
        return;
      }
      // Ledger-era saves still carry end-of-order debts; spend those the old
      // way. Ending a normal Opportunity records the Mech as having acted.
      if (onExtraOpportunity(state, cmd.uid)) {
        const at = sc.extraOpps.indexOf(cmd.uid);
        if (at >= 0) sc.extraOpps.splice(at, 1);
      } else if (!sc.acted.includes(cmd.uid)) {
        sc.acted.push(cmd.uid);
      }
      sc.opp = null;
      return;
    }
    case 'asterRestore': {
      // One flip and one Link, both here so a half-applied ability cannot exist
      // on one seat: the token is consumed the same way any 4.15.4 Action
      // consumes one, and the ledger stops a second use this round.
      const sc2 = state.script;
      const l2 = [...(t.statuses ?? [])];
      const at2 = l2.lastIndexOf('command');
      if (at2 < 0) return;
      l2.splice(at2, 1);
      t.statuses = [...l2, 'commandUsed'];
      syncCommandPool(state);
      const to = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (to) to.link = Math.min(maxLink(data, to), (to.link ?? 0) + 1);
      if (sc2) sc2.oncePerRound = [...sc2.oncePerRound, asterKey(state, t.uid)];
      return;
    }
    case 'spendCommand': {
      // Flipped, not removed: 4.15.4 says a consumed token stays on the Torso
      // face-down and can no longer be issued or used, and the End Phase
      // collects it with everything else.
      const l = [...(t.statuses ?? [])];
      const at = l.lastIndexOf('command');
      if (at < 0) return;
      l.splice(at, 1);
      t.statuses = [...l, 'commandUsed'];
      syncCommandPool(state);
      return;
    }
    case 'coordinateCommand': {
      // The token leaves the Mech face-up and lands on the Drone face-down,
      // the same physical move the Command Phase makes (4.15.3).
      const from = state.tokens.find((x) => x.uid === cmd.uid);
      const to = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!from || !to) return;
      const l = [...(from.statuses ?? [])];
      const at = l.lastIndexOf('command');
      if (at < 0) return;
      l.splice(at, 1);
      from.statuses = l;
      to.statuses = [...(to.statuses ?? []), 'commandUsed'];
      to.commandedBy = from.uid;
      syncCommandPool(state);
      return;
    }
    case 'designate': {
      const phase = PHASES[state.round.phase];
      if (!sc || !isLoopPhase(phase)) return;
      if (phase === 'Command') {
        // Additional Instructions buys one Command Action outright, so the
        // token stays in the pool for this designation only.
        const free = sc.freeCommand.includes(cmd.uid);
        if (free) sc.freeCommand = sc.freeCommand.filter((x) => x !== cmd.uid);
        else {
          // 4.15.2 steps 1-3: the player names the Mech, names the Drone, and
          // the token moves from that Mech onto the Drone's card FACE-DOWN.
          // `fromUid` carries the choice; without one — an older replay, or a
          // driver that has not been taught to ask — the fullest Mech pays, so
          // a Command Generation 4 Torso does not look spent while a
          // 1-Command Mech beside it still shows a token.
          const issuer = issuingMech(state, t.side, cmd.fromUid);
          if (issuer) {
            const l = [...(issuer.statuses ?? [])];
            l.splice(l.lastIndexOf('command'), 1);
            issuer.statuses = l;
            t.statuses = [...(t.statuses ?? []), 'commandUsed'];
            // Remembered so "when receiving Command from THIS Mech" can be
            // answered later — the token itself carries no origin.
            t.commandedBy = issuer.uid;
          }
          syncCommandPool(state);
        }
        if (!sc.commanded.includes(cmd.uid)) sc.commanded.push(cmd.uid);
      } else if (!sc.acted.includes(cmd.uid)) {
        sc.acted.push(cmd.uid);
      }
      sc.turn = nextTurn(state, phase, t.side) ?? t.side;
      return;
    }
    case 'grantExtra': {
      t.link = Math.max(0, (t.link ?? 0) - cmd.linkCost);
      if (t.link === 0 && t.stance !== 'shutdown') t.stance = 'shutdown';
      // IMMEDIATE and NESTED (FAQ K21, and K3's worked example): the echoed
      // Mech acts now with a complete Opportunity of its own - its OWN dial
      // timing governs the Starting Action (K7) and its dial-based Extra
      // Ticks ride along (K4) - and the granter resumes when it ends. Ending
      // it never marks the target as having acted, so a Mech echoed before
      // its own turn still takes that turn later (K19).
      if (sc) {
        if (sc.opp) sc.oppStack.push(sc.opp);
        const fresh = newOpportunity(cmd.uid, t.timing);
        fresh.extra = true;
        fresh.extras = extrasFor(data, t);
        sc.opp = fresh;
      }
      return;
    }
    case 'stabilise': {
      // Stabilize System (6.1): Torso removes 1 Square or Hexagon Token from
      // this Mech, then restores 1 Link. Both halves are optional in effect:
      // the player may keep the Tokens and take only the Link (FAQ J4), and a
      // token-less Mech may still recover the Link alone (J6).
      const shed = cmd.keepTokens ? undefined : (t.statuses ?? []).find((id) => {
        const d = STATUSES.find((x) => x.id === id);
        return d?.shape === 'square' || d?.shape === 'hexagon';
      });
      if (shed) {
        const list = [...(t.statuses ?? [])];
        list.splice(list.indexOf(shed), 1);
        t.statuses = list;
        t.expiring = (t.expiring ?? []).filter((id) => id !== shed);
        if (!t.expiring.length) t.expiring = undefined;
      }
      t.link = Math.min(maxLink(data, t), (t.link ?? 0) + 1);
      return;
    }
    case 'repairPart': {
      if (cmd.mode === 'mend') {
        t.partStates[cmd.slot as PartSlot | 'main'] = 'intact';
        return;
      }
      t.repairedSlots = [...(t.repairedSlots ?? []), cmd.slot];
      // The unit-level chip rides along for display.
      if (!(t.statuses ?? []).includes('repaired')) t.statuses = addStatus(t.statuses, 'repaired');
      return;
    }
    case 'breakRepaired': {
      // A Repaired Part chosen as the hit location is removed at once - no
      // Penetration, no rewards, no second Link loss (FAQ J23). The attack
      // redirect to the Core is the wizard's job.
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      target.repairedSlots = (target.repairedSlots ?? []).filter((x) => x !== cmd.slot);
      if (!target.repairedSlots.length) {
        target.repairedSlots = undefined;
        target.statuses = (target.statuses ?? []).filter((id) => id !== 'repaired');
      }
      return;
    }
    case 'reveal': {
      t.statuses = (t.statuses ?? []).filter((id) => id !== 'camouflage');
      // Manifestation Movement rides the same command, so the unit never sits
      // revealed at the marker position for a frame - the two halves are one
      // event (4.12.2) and a mirror replaying this sees one hop.
      if (cmd.to) {
        t.col = cmd.to.col;
        t.row = cmd.to.row;
        if (cmd.facing !== undefined) t.facing = cmd.facing;
      }
      return;
    }
    case 'launch': {
      const card = data.byId.get(cmd.cardId);
      if (!card) return;
      // The uid counter lives in the state, so a mirrored seat mints the same
      // one. The Ammo that paid for the shot is spent in the same breath.
      //
      // The magazine is read BEFORE the Projectile joins the board, and through
      // ammoHolder rather than off `t`: a lent launcher is paid out of the
      // Carrier Tarantula's tokens (FAQ O3/O16), the same unit spendAmmo and
      // restoreAmmo already debit, so a launch and its undo cannot land on two
      // different Drones.
      const mag = ammoHolder(data, state, t, cmd.actionId);
      const tok = makeDroneToken(state, data, card, t.side);
      state.tokens.push({ ...tok, parentUid: t.uid, col: cmd.to.col, row: cmd.to.row, facing: cmd.facing });
      if (mag.ammo[cmd.actionId] !== undefined) mag.ammo[cmd.actionId] = Math.max(0, mag.ammo[cmd.actionId] - 1);
      // A lock_one Action commits to what it first launched and is held to it
      // for the rest of the game (008_A, PRDR-105_B). Recorded here rather than
      // in the picker so both pages commit identically and a replay agrees.
      const launched = findAction(data, state, cmd.uid, cmd.actionId);
      if (launched && covertCarryLock(launched) && !t.lockedProjectile?.[cmd.actionId]) {
        t.lockedProjectile = { ...(t.lockedProjectile ?? {}), [cmd.actionId]: cmd.cardId };
      }
      return;
    }
    case 'accessTerminal': {
      const tasks = normaliseTasks(state.tasks);
      const item = tasks.items.find((i) => i.id === cmd.itemId);
      if (!item) return;
      item.accessed = t.side;
      state.tasks = tasks;
      return;
    }
    case 'resolveReaction': {
      const sc = state.script;
      if (sc) {
        const at = (sc.reactions ?? []).findIndex((r) => r.uid === cmd.uid && r.actionId === cmd.actionId);
        if (at >= 0) sc.reactions = [...sc.reactions.slice(0, at), ...sc.reactions.slice(at + 1)];
      }
      // The use is spent in the SAME command as the debt is cleared, so a
      // dropped connection between the two cannot leave a free Emergency
      // Smoke. The card prints storage 1, which syncMagazines seeded as Ammo.
      //
      // `t` and not ammoHolder, deliberately: attackReactionsOf (units.ts) reads
      // tokenCards ALONE and never loanedParts, so a borrowed Part can never owe
      // a reaction and there is no lender's magazine to find. Flagged as a
      // launch path by the phase-6 sweep; it is not one.
      if (t.ammo?.[cmd.actionId] !== undefined) {
        t.ammo[cmd.actionId] = Math.max(0, t.ammo[cmd.actionId] - 1);
      }
      return;
    }
    case 'blink': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      // A straight exchange, applied atomically so a mirrored seat can never
      // land one half of it. Teleportation, so nothing is checked along the way
      // and no Break Away is paid (E20.2) — the two units simply trade Grids.
      const from = { col: t.col, row: t.row };
      t.col = target.col;
      t.row = target.row;
      target.col = from.col;
      target.row = from.row;
      // Forced Movement, so the Taurus player set BOTH facings (E17/E20.5).
      t.facing = cmd.facing;
      target.facing = cmd.targetFacing;
      return;
    }
    case 'layMine': {
      const card = data.byId.get(cmd.cardId);
      if (!card) return;
      // Same shape as a launch minus the Ammo: Auto Mine Laying has no magazine,
      // it is paid for in Move Range, and that was spent by walking a shorter
      // route. Facing is the layer's own so a mirrored seat draws it identically.
      const tok = makeDroneToken(state, data, card, t.side);
      state.tokens.push({ ...tok, parentUid: t.uid, col: cmd.to.col, row: cmd.to.row, facing: t.facing });
      return;
    }
    case 'switchForm': {
      switchFormTo(data, t, cmd.cardId);
      return;
    }
    case 'unfold': {
      const card = data.byId.get(t.cardId);
      const into = card ? unfoldsInto(card) : undefined;
      const target = into ? data.byId.get(into) : undefined;
      if (target) unfoldToken(state, data, t, target);
      return;
    }
    case 'transformPart': {
      transformPartOn(data, t, cmd.slot, cmd.cardId);
      return;
    }
    case 'tether': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      tetherTo(t, target, cmd.range);
      return;
    }
    case 'despawn': {
      const gone = state.tokens.find((x) => x.uid === cmd.targetUid);
      state.tokens = state.tokens.filter((x) => x.uid !== cmd.targetUid);
      // A side emptied of units keeps no squad name, so the next list brought
      // in gets to name it. Only ever true in the lobby.
      if (gone && state.sideNames?.[gone.side]
        && !state.tokens.some((x) => x.side === gone.side && x.kind !== 'projectile')) {
        delete state.sideNames[gone.side];
      }
      return;
    }
  }
}

// What a strict refusal does with its reason. The command layer cannot toast,
// so the app registers a presenter once and every call site inherits it.
let refused: ((why: string) => void) | null = null;
export function onRefused(fn: (why: string) => void): void {
  refused = fn;
}

// Where a command goes after it has been applied locally, when a networked
// game is running. Registering it here rather than at each call site is the
// whole reason the command layer exists: every move in the app becomes
// sendable at once, and none of the UI has to know a socket is involved.
let mirror: ((cmd: Command) => void) | null = null;
export function onPerformed(fn: ((cmd: Command) => void) | null): void {
  mirror = fn;
}

// Called with the board as it stands BEFORE a command changes it, so a page can
// keep an undo history. Injected the same way as the mirror above rather than
// called directly from apply(), because apply() is exported and the test slices
// drive it straight — a hard dependency there would break every one of them.
// Both perform() and applyRemote() announce, so a networked history contains
// the other player's moves too, which is what makes a shared rollback possible.
let historian: ((state: GameState, cmd: Command) => void) | null = null;
export function onBeforeApply(fn: ((state: GameState, cmd: Command) => void) | null): void {
  historian = fn;
}

// Commands that must never leave this client. Setting a Timing Dial is the
// game's one piece of hidden information (3.3): it travels only inside a
// revealTimings, once both squads have committed to what they chose. Keeping
// the rule here rather than at the call site makes it structural — no future
// caller can forget it, and it can be tested.
const SECRET_KINDS = new Set<Command['kind']>(['setTiming']);

export function isSecret(cmd: Command): boolean {
  return SECRET_KINDS.has(cmd.kind);
}

// A squad is what a player BROUGHT, not what was left standing at the end.
// Integrity Loss takes a Mech off the board in the End Phase (4.4.4) and a
// destroyed Drone goes the same way, so a record read off the board at the
// final bell is missing every unit that died — and the same squad then records
// differently depending on its casualties, which splits one squad into several
// on the leaderboard and quietly biases "most used" towards whatever survives.
//
// So every command notes what is standing right now, keyed by uid: a unit is
// remembered before anything can remove it, two copies of the same Part stay
// two entries because their units are separate, and re-noting a unit it has
// already seen is a no-op.
//
// This hangs off perform() and applyRemote() rather than the end of apply(),
// which returns early from its switch in dozens of places. Both clients run
// the same commands, so both build the same roster; it is not in
// boardFingerprint because no rule reads it.
// 4.1: once a Mech has moved or acted, the Stance it did it in is the Stance it
// keeps for the rest of the Opportunity. Called after the spend, because
// spendAction/spendManeuver return a NEW Opportunity rather than mutating one.
function lockStance(t: Token, o: Opportunity): Opportunity {
  if (t.kind !== 'mech' || o.stanceLocked) return o;
  return { ...o, stanceLocked: true };
}

export function rememberFielded(data: GameData, state: GameState): void {
  const roster = state.fielded ?? (state.fielded = { s1: {}, s2: {} });
  for (const t of state.tokens) {
    if (t.kind === 'projectile') continue;
    const side = roster[t.side];
    if (!side) continue;
    const ids = tokenCards(data, t).map(({ card }) => card.id);
    if (ids.length) side[t.uid] = ids;
  }
}

// True while a command that arrived from the other player is being applied.
// Without it the mirror would bounce every received command straight back and
// the two clients would volley forever.
let applyingRemote = false;

// A command from the other player, checked with the same engine before it is
// allowed anywhere near this board.
//
// The relay orders and forwards but does not referee, and the client at the
// other end is not ours to trust — it could be modified. So the move is put
// through check() here, exactly as a local move is, and refused if the rules
// refuse it. Returning the verdict rather than throwing lets the caller tell
// the player and ask the server to resync, because a refusal can also mean the
// two boards have drifted rather than that anyone is cheating.
export function applyRemote(data: GameData, state: GameState, cmd: Command): CheckResult {
  const verdict = check(data, state, cmd);
  if (!verdict.ok) return verdict;
  historian?.(state, cmd);
  applyingRemote = true;
  try {
    apply(data, state, cmd);
  } finally {
    applyingRemote = false;
  }
  rememberFielded(data, state);
  return verdict;
}

// The Command Phase begins by putting the tokens ON the Mechs - 3.2.1 has them
// placed on the Torso Part Card, and 3.2.2 has each one travel from a Mech to
// the Drone it commands. Seeding them here rather than only counting a pool
// means the board shows where every Command came from, which is the part of
// the phase a new player has to see to understand it.
//
// It lives in the command layer because it writes `statuses`, a fingerprinted
// field: both seats have to reach the identical placement, and they do because
// the count comes from the cards rather than from anything local.
// Aster's once-per-round ledger key. Keyed by ROUND and by the Mech, so two
// Asters in one squad each get their own use.
export function asterKey(state: GameState, uid: number): string {
  return `${state.round.n}:aster:${uid}`;
}

// Both faces of the one physical token, for the sweeps and the transfer. A
// Command Token is removed whichever way up it is lying.
const COMMAND_FACES = new Set(['command', 'commandUsed']);

// How many Command Tokens this unit is bearing, either way up. 4.15.2's
// one-per-Drone capacity counts the physical token on the card, so a face-down
// one it was given still blocks a second.
export function heldCommands(t: Token): number {
  return statusCount(t.statuses, 'command') + statusCount(t.statuses, 'commandUsed');
}

// How many face-up Commands this Mech could still issue or spend. 4.15.4: a
// face-down token is out of the economy until the End Phase collects it.
export function readyCommands(t: Token): number {
  return statusCount(t.statuses, 'command');
}

// Every Mech on this side that could pay for a Command right now. This is the
// list step 1 of 4.15.2 asks the player to choose from, so the pickers and the
// command layer agree on who is eligible by sharing it.
export function commandIssuers(state: GameState, side: Side): Token[] {
  return state.tokens.filter((t) => t.side === side && t.kind === 'mech' && alive(t) && readyCommands(t) > 0);
}

// `state.commandTokens` is a READOUT of the face-up tokens the Mechs are
// holding, never a second ledger. It is recomputed after anything that moves a
// Command rather than nudged by ±1, because a count that is incremented
// separately from the thing it counts is how the two drifted apart before -
// and this one gates eligibility, so a drift is a rules bug and not a cosmetic
// one. Cached rather than derived at the call site only because the fingerprint
// and the saved state both already carry it.
export function syncCommandPool(state: GameState): void {
  const pool: Record<Side, number> = { s1: 0, s2: 0 };
  for (const t of state.tokens) {
    if (t.kind !== 'mech' || !alive(t)) continue;
    pool[t.side] += readyCommands(t);
  }
  state.commandTokens = pool;
}

// The Mech that pays: the one named, if it can, else the fullest. Falling back
// rather than refusing keeps an old replay and an un-taught driver working,
// while check() is what stops a LIVE player naming a Mech with nothing to give.
function issuingMech(state: GameState, side: Side, fromUid?: number): Token | undefined {
  const able = commandIssuers(state, side);
  const named = fromUid === undefined ? undefined : able.find((x) => x.uid === fromUid);
  return named ?? [...able].sort((a, b) => readyCommands(b) - readyCommands(a))[0];
}

export function seedCommandTokens(data: GameData, state: GameState): void {
  clearCommandTokens(state);
  for (const t of state.tokens) {
    if (t.kind !== 'mech' || !alive(t)) continue;
    const n = commandGeneration(data, t);
    for (let i = 0; i < n; i++) t.statuses = [...(t.statuses ?? []), 'command'];
  }
  syncCommandPool(state);
}

// End of the Command Phase: 3.2.3 removes the Command Tokens of all DRONES on
// the board, and only those. A Mech's unissued tokens stay on its Torso, which
// is the whole point of 4.15.2's "tokens may be reserved" - a Command
// Generation 4 Torso is meant to hold some back for an Action that consumes
// one (4.15.4) or hands one out through Command Coordination (4.15.3). They are
// swept later, by the End Phase (3.7.2). Clearing everything here reads as
// tidier and silently deletes the GoF economy.
export function clearDroneCommands(state: GameState): void {
  for (const t of state.tokens) {
    if (t.kind === 'mech') continue;
    t.statuses = (t.statuses ?? []).filter((s) => !COMMAND_FACES.has(s));
  }
  syncCommandPool(state);
}

// End Phase, 3.7.2 / 4.15.4: every Command Token comes off, wherever it sits
// and whether or not it was consumed.
export function clearCommandTokens(state: GameState): void {
  for (const t of state.tokens) {
    t.statuses = (t.statuses ?? []).filter((s) => !COMMAND_FACES.has(s));
    // The record of who issued it goes with the token it described. Leaving it
    // behind would let next round's reads answer from a Command that is gone.
    delete t.commandedBy;
  }
  state.commandTokens = { s1: 0, s2: 0 };
}

// The sandbox and the teaching guide warn rather than block, so they perform
// regardless and surface why when there is a why. The strict tracker refuses
// instead, right here, which is what makes every call site strict at once:
// one rule, two presentations.
export function perform(data: GameData, state: GameState, cmd: Command): CheckResult {
  // Attribution seats are stamped with the sender's own seat when networked,
  // so a table command clicked from either chair both applies and travels.
  const me = getLocalSeat();
  if (me && ATTRIBUTED.has(cmd.kind) && cmd.seat !== me) cmd = { ...cmd, seat: me };
  const verdict = check(data, state, cmd);
  // An online game is always strict, whatever the guide is set to. Both
  // clients have to refuse the same things or their boards drift apart, and a
  // player who waved a rule away locally would otherwise push the result onto
  // an opponent who never agreed to it.
  const strict = !!state.script?.strict || !!getLocalSeat();
  if (!verdict.ok && strict) {
    refused?.(verdict.why);
    return verdict;
  }
  historian?.(state, cmd);
  apply(data, state, cmd);
  rememberFielded(data, state);
  // Mirrored only after it has actually landed here, so the other player never
  // sees a move this client refused to make — and never if it is secret.
  if (!applyingRemote && !isSecret(cmd)) mirror?.(cmd);
  return verdict;
}

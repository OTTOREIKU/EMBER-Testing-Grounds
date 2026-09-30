import type { BoardGrids, CardAction, CombatView, Facing, FreeTicks, GameState, MechLoadout, Opportunity, PartSlot, PartState, RollbackPoint, ScriptState, Side, SmokeScreen, Stance, TerrainPiece, Timing, Token } from './types';
import { addStatus, ageTokens, cellsOf, isLineUnit, gridsOf, newOpportunity, normaliseCatalog, normaliseFreeTicks, PHASES, shedToken, statusCount, STATUSES, TIMINGS, tokenFaces } from './types';
import type { GameData } from './data';
import { cardName, isMine, isUnfolded, transformFaces, unfoldsInto, discardFaceOf, environmentAllowance, squadLabel } from './data';
import { auraActionOf, auraCanReach, interceptPayer, repairSpec, fliesToTarget, flightLanding, projectileReach, launchableCards, autoShotOwed, overwatchOf, settleMines, forgetMineSpares, minesOwed, unfoldsOwed, unfoldOccupants, coordinationFor, coordinatesAfterManeuver, coordinationOnOpportunityEnd, bitPortOf, bitsToRecover, camoPartLost, canActivateCamo, electronicAll, electronicAllTargets, whistleFunders, electronicTargetWhy, isElectronicAttack, ownCards, actionSilenceDenier, activatesCamo, contactRevealsOwed, positionsOf, envCardAt, isGroundUnit, initiativeFor, actionMoves, firewatchOn, focusPayer, stanceFeedbackOf, stanceFeedbackTargets, stanceShaped, actionPartWhy, extraActivationOf, overloadPackOn, cruising, selfStanceShift, spendsAmmoWhenPerformed, startOpts, counterStage, covertCarryLock, ammoDeliveryPool, opportunityBonusOn, ripostePart, defenseReactionOn, targetTracingOn, riderOnDrone, commandGeneration, swarmTacticsOn, isGofMediumDrone, blinkTargets, isPositionSwap, electronicOrigins, isSilentAction, maneuverIsSilent, loanedParts, unfoldToken, formSwitch, switchFormTo, extrasFor, consumesCharge, cutTethersOn, cutTetherBetween, electronicDash, electronicValue, immobilizedStop, chassisStop, isScanAction, scannable, manifestationRange, nonHumanoidCost, nonHumanoidStop, envHotEntries, settleEnvironments, freehandSlots, twoHandedUse, missileGroupOf, volleyFor, interceptCapacity, focusIsFree, keepsLinkOnPartLoss, makeDroneToken, structureOf, makeMechToken, maneuverRange, maxLink, partsLeft, pilotCard, pilotIs, projectileDelivery, provokeWhy, settleTethers, SLOT_LABEL, tetherTo, tokenCards, transformPartOn, actionRange, isRwsAction, rwsCommandKey, rwsFiredKey, selfStatusGrant, selfGrantWhy, straightLineBonus, grantAdjusted, shockAttackOf, linkTickTraitOn, isCarrier, canBeLoad, roundEndLinkSources, chargeSlotOf, discardPartOn, disarmOn, partUsable, throwWhy, shockMoveAllowed, actionIdleWhy, counterWon, multiTargetLimit, camoBrokenBy } from './units';
import { canBeForceMoved, crawlHolders, isMeleeFiring, lockersOf, tetherCap } from './melee';
import { actionIdOf, canActivate, canAttackMode, canManeuver, canOverload, canPerform, rebooted, REBOOT_ID, spendAction, spendActivation, spendAttackMode, spendManeuver, spendOverload, untouched } from './ticks';
import { tacticSpec, tacticTargets, tacticUsedRound, tacticWindowWhy, type TacticCtx } from './tactics';
import { battlefieldLocked, deploymentComplete, deployTurn, firstPlayerFrom, incompleteMechWhy, newSetup, normaliseSetup, tasksLocked } from './setup';
import { applyKill, boxHands, boxPlaceTurn, cellToGrid, deployGrids, deployOpenGrids, leaveBoxes, newTaskState, normaliseTasks, taskItemsFor, type TaskItem, type TaskState, pendingDesignations, rangeToZone, recordPartLoss, recordUnitLoss, remoteAccessWhy, settleControl, TERMINAL_EV, TERMINAL_UID, terminalStandIn, type Designation, retractKill, unrecordPartLoss } from './tasks';
import { alive, canAct, dialHidden, droneActionWhy, droneLockPhase, droneMoveWhy, eligibleUnits, getLocalSeat, isLoopPhase, loopComplete, nextTurn, onExtraOpportunity, tiedChoiceWhy } from './loop';
import { boxDropCells, dissipationFor, losNote, rangeBetween, spotsInGrid } from './rules';
import { cleanName } from './safetext';

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

// ONE TAP, ONE UNDO. A command sent as part of the one before it in the same
// gesture - the launch after the Action that paid for it, the Charge Token a
// Charge Action flips, the Command Token a Target Tracing spends - carries
// `chain: 'join'`, and the pad's Undo walks back through joined steps to the
// gesture's first command. Without it a smoke launch undid only the grenade's
// removal and left its Ammo spent (OTTO, 2026-09-24). On the WIRE rather than
// kept locally, so both phones in a room group the same history the same way;
// the relay stores commands as opaque JSON and needs no change. apply() never
// reads it. The ledger's groupLedger honours it too (role 'join').
export type CommandChain = { chain?: 'join' };

export type Command = (
  | { kind: 'setTiming'; seat: Side; uid: number; timing?: Timing }
  // Where inside its own Large Grid a unit stands. Costs no Movement Range and
  // never leaves the Grid, but it decides Contact, which is judged at
  // Small-Grid resolution (4.2.3) — so a Drone that lands dead centre may need
  // shifting to the edge it actually touches.
  | { kind: 'placeInGrid'; seat: Side; uid: number; to: { col: number; row: number } }
  | { kind: 'setStance'; seat: Side; uid: number; stance: Stance }
  // ZHDR-206_B Stance feedback: the Drone (`uid`) switches an Ally Mech's
  // Stance. Its own command because the ally is outside its own Opportunity,
  // where setStance rightly refuses it (audit Phase 2, D1).
  | { kind: 'stanceFeedback'; seat: Side; uid: number; actionId: string; targetUid: number; stance: Stance }
  // ZPA-38 Firewatch as GoF 1.021 prints it: 1 Link for a Command Token as the
  // Mech gains an Action Opportunity. The card's {Eye}-as-{Lightning} in an
  // Electronic Counter Roll is gone (OTTO, 2026-09-28: the lists win).
  | { kind: 'firewatch'; seat: Side; uid: number }
  // A callsign for a unit, so two identical builds can be told apart on a
  // sheet. Bookkeeping, not a rule: the label is not rules-bearing and the
  // fingerprint does not carry it. An empty label is refused rather than
  // defaulted, because the caller knows the fallback and the engine does not.
  | { kind: 'renameUnit'; seat: Side; uid: number; label: string }
  // A carrier Drone's Load, set or taken off on an existing token. The token
  // is rebuilt the way the board rebuilds it, so Ammo and Intercept follow.
  | { kind: 'setLoad'; seat: Side; uid: number; cardId?: string }
  // The pad's hand record of a free table's Ticks (3.4.5). null refills them.
  | { kind: 'setFreeTicks'; seat: Side; uid: number; ticks: FreeTicks | null }
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
  // `flying` rides along for the Environment Cards: a flight enters only its
  // landing Grid, so a High Temperature Grid under the route must know whether
  // the unit walked through it or flew over it. Absent means walked.
  | { kind: 'maneuver'; seat: Side; uid: number; to: { col: number; row: number }; facing?: Facing; free?: boolean; granted?: boolean; via?: { col: number; row: number }[]; from?: { col: number; row: number }; actionId?: string; flying?: boolean; breakAwayLink?: number
    // A Mine in a Grid the walk entered stopped it there (ruling I16): `halt`
    // is how many Grids of the Movement are left for later, and a `resume`
    // goes on with them once the blast is resolved (audit Phase 5, C1).
    // `spun`: it turned a full circle on the spot, so it ends facing where it
    // began and has still made a Movement (Supplementary Rules 1.04, 1.8).
    halt?: number; resume?: boolean; spun?: boolean }
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
  // twoHanded: the Action is performed with a designated Freehand, which on
  // some cards changes what it COSTS ("[Two-Handed] this action is considered
  // as Medium Action", card 129). The designation is the player's choice (FAQ
  // A16), so the command says which way it went and the engine pays that length.
  | { kind: 'performAction'; seat: Side; uid: number; actionId: string; partKey?: string; granted?: boolean; twoHanded?: boolean }
  | { kind: 'overload'; seat: Side; uid: number }
  // A pilot trait trading Link for an ordinary Action Tick (FPA-04-2 Domestic
  // Expert, FAQ L2). Same class of spend as overload, gated by the trait.
  | { kind: 'linkTick'; seat: Side; uid: number }
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
  // Who stands inside an aura, on a table with no board (OTTO, 2026-09-29):
  // `uid` is the sender's own unit, as for a Token, and `sourceUid` the aura's.
  | { kind: 'setAuraReach'; seat: Side; uid: number; sourceUid: number; actionId: string; targetUid: number; on: boolean }
  // Taking one back off. Tokens are rules-bearing and fingerprinted — an
  // Immobilized or Fragile chip changes the defence pool — so a player peeling
  // one off by hand has to travel like putting it on does. One at a time,
  // matching the chip: a stacked Square loses its most recent entry.
  // `face` names which of a stack's faces goes (yellow or red), for a picker
  // that asked; left out, a yellow one goes first (types.ts shedToken).
  | { kind: 'removeStatus'; seat: Side; uid: number; targetUid: number; statusId: string; face?: 'yellow' | 'red' }
  // One Token, one step along the End Phase's own ladder (2.5.3): a red face
  // comes off, a yellow face turns red, and a green Token or one with no decay
  // comes off.
  // The pad's tap on a worn Token. It has no script, so markEndStep never
  // runs there and this is the only sweep its Tokens get.
  | { kind: 'ageStatus'; seat: Side; uid: number; targetUid: number; statusId: string }
  | { kind: 'focus'; seat: Side; uid: number }
  // ZPA-40 Shrike, 欢愉 Elation (GoF 1.021): "When this Mech Destroys enemy
  // Parts with Melee Actions, restore 1 Link." Its own command rather
  // than a field on applyPenetration, whose payload is {seat, uid, targetUid,
  // slot} and carries no Action -- widening that shape
  // would touch replay compatibility for every Penetration ever recorded.
  // Emitted from combat.ts, where `c.action` is in hand, and gated in check()
  // so a client cannot mint Link with it.
  | { kind: 'restoreLink'; seat: Side; uid: number }
  // Link recovered from anything that is not the Mech's own Stabilize or
  // Reboot: an ally's Strengthen Link, a Link Beacon, the Valkyrie's Appease,
  // or a line the pad writes down off the physical table. Capped at the
  // pilot's Link Value, and a Shutdown Mech takes it and STAYS Shutdown: Link
  // may be restored to it by allies or external effects, and it does not
  // reboot (FAQ L3). Never touches a Token - only Stabilize ties the two
  // together. `uid` is the unit it came from (the Mech itself for a hand-kept
  // line) and `actionId` the effect, for the log; `targetUid` gains the Link.
  | { kind: 'recoverLink'; seat: Side; uid: number; targetUid: number; actionId?: string }
  // `via` is the pushed line as cells, one entry per Grid, for the same
  // reason maneuver carries it plus one of this command's own: a victim
  // knocked THROUGH a High Temperature Grid enters it, and by the time apply()
  // runs, only the payload remembers the line.
  | { kind: 'forceMove'; seat: Side; uid: number; targetUid: number; to: { col: number; row: number }; push?: boolean; facing?: Facing; via?: { col: number; row: number }[] }
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
  // A Black Box changing hands (5.3.1). Picking one up is optional (FAQ P10)
  // and happens as a unit's Movement passes through its Grid, or as its own
  // Action Opportunity ends in it (3.4.4, FAQ P8); a flight takes one only at
  // its start and landing Grids (ruling I22). On a strict board table the check
  // reads the route the maneuver recorded on the Opportunity (audit Phase 6,
  // F5). `slot` is the Freehand Part that carries it, and that Part's Freehand
  // counts as spent while it does.
  | { kind: 'takeBlackBox'; seat: Side; uid: number; itemId: string; slot: string }
  // Dropped when the bearer is Penetrated, and it is the ATTACKER who says
  // where it lands — hence a seat that is not the bearer's. `uid` is the
  // attacker, for attribution only: it may be a Projectile that is already
  // spent by the time the Grid is chosen, so this one is actor-optional.
  | { kind: 'dropBlackBox'; seat: Side; uid: number; itemId: string; to: { col: number; row: number } }
  // `sweep`: run the End Phase's Remove Units and Token Management (3.7.1,
  // 3.7.2) as the phase OPENS, for a table with no guided game to run
  // markEndStep: a Freeform pad, or the tabletop sandbox. Ignored in a guided
  // game, whose End Phase checklist does it (audit Phase 6, B3, B4).
  | { kind: 'advancePhase'; seat: Side; sweep?: boolean }
  | { kind: 'setPhase'; seat: Side; phase: number }
  | { kind: 'resetRounds'; seat: Side }
  | { kind: 'adjustCommandTokens'; seat: Side; pool: Side; delta: number }
  | { kind: 'endOpportunity'; seat: Side; uid: number }
  // The squad whose tied Mech holds the Opportunity sends `uid`, another of its
  // Mechs on the same Timing and Initiative, in its place (audit Phase 2, E6).
  | { kind: 'chooseTied'; seat: Side; uid: number }
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
  // Swarm Tactics' continuation declined: the Warrior's token stays spent on the
  // last Drone, and the turn passes as it would have (172_B).
  | { kind: 'endSwarm'; seat: Side }
  | { kind: 'grantExtra'; seat: Side; uid: number; linkCost: number }
  | { kind: 'markEndStep'; seat: Side; step: string }
  | { kind: 'award'; seat: Side; vp: { s1: number; s2: number }; keys: string[] }
  // Victory Points written by hand, off the physical table: they touch the VP
  // and nothing else. Sent as an Award they marked every owed kill paid and,
  // on a scripted table, the round's Tasks settled (audit Phase 6, D3). The
  // seat is who wrote it; `side` whose VP they are.
  | { kind: 'adjustVp'; seat: Side; side: Side; by: number }
  // A squad gives up. FAQ P21 has the game run its rounds and the Victory
  // Points decide, so this is the one early end a table chooses (ruling I1;
  // audit Phase 6, B8). The seat is the side conceding.
  | { kind: 'concede'; seat: Side }
  // `statusId` names WHICH Square or Hexagon Token comes off (6.1 leaves the
  // choice to the player), and `face` which face of a stack; without them the
  // first removable one goes, a yellow face before a red.
  | { kind: 'stabilise'; seat: Side; uid: number; keepTokens?: boolean; statusId?: string; face?: 'yellow' | 'red' }
  | { kind: 'repairPart'; seat: Side; uid: number; slot: string; mode: 'repaired' | 'mend'
    // An ally's Part, mended by the Action named (the SU1's Armor Patch,
    // ZYDR-108_B; audit Phase 6, C6).
    targetUid?: number; actionId?: string }
  | { kind: 'breakRepaired'; seat: Side; uid: number; targetUid: number; slot: string }
  // `to` is Manifestation Movement, which 4.12.2 makes part of the same event
  // as the Reveal rather than a move that follows it - so it rides here rather
  // than in a second command a mirror could see arrive on its own.
  | { kind: 'reveal'; seat: Side; uid: number; to?: { col: number; row: number }; facing?: Facing }
  | { kind: 'lockMap'; seat: Side }
  | { kind: 'finishTasks'; seat: Side }
  | { kind: 'rollSetup'; seat: Side; hits: number[] }
  // `first`: the table rolled its own dice and says who won (the pad's Table
  // rolls). Without it the winner is read off the recorded Hits, as ever.
  | { kind: 'acceptRoll'; seat: Side; first?: Side }
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
      // The free Scan a Firing or Melee designation of a camouflaged unit earns
      // (4.12.2, FAQ I12): the attack that waits behind this Counter-roll. It
      // carries the declaration's two answers, a Charge spent for it and a
      // declined [Two-Handed], which the resumed attack used to lose (audit
      // Phase 2, C7). `extra`: the Scan of a Multi-Target's extra camouflaged
      // target, whose success owes only the Reveal (ruled R3; audit Phase 7,
      // P7C 4).
      thenAttack?: { actionId: string; charged?: boolean; chargeChoice?: string; twoHandedDeclined?: boolean; extra?: boolean };
      // An Action on every enemy in Range, on a table with no board: the other
      // enemies the table judged in Range, in the order they roll. A board
      // derives them instead (audit Phase 3, D2 and A4).
      also?: number[];
      // A Remote Access rolled against this Terminal item (p.87). The
      // Responder is then the Terminal's stand-in and `targetUid` is
      // tasks.ts TERMINAL_UID (ruling I25).
      terminal?: string;
    }
  | { kind: 'rollCounter'; seat: Side; uid: number; faces: number[]; focused?: boolean }
  // The Terminal's own roll in a Remote Access: its Electronic Value of 3 in
  // Yellow dice, rolled by the Initiator's opponent (ruling I25). A table
  // command, since no unit on the board rolls it; it never Focuses.
  | { kind: 'rollTerminal'; seat: Side; faces: number[] }
  // A side's Focus declare in a shared Counter-roll (FAQ G4). It pays the Link
  // itself, the way `focus` does, so the reroll that follows cannot pay twice.
  // `whistleUid`: a Drone's reroll is paid instead with a Command Token off
  // that Ally Mech's Whistle (ZYBP-202; audit Phase 3, D9).
  | { kind: 'declareCounterFocus'; seat: Side; uid: number; use: boolean; whistleUid?: number }
  // The Red Shoes (TM35NA_B): the Initiator's player performs one of the
  // Responder's own Maneuvers or Move Actions (`actionId`), at no Tick cost,
  // spending the `control` debt the won Counter-roll queued. `uid` is the
  // controller, who owns the debt; `targetUid` is the unit that moves (ruled
  // 2026-09-25, audit Phase 3, F19).
  | {
      kind: 'controlledMove'; seat: Side; uid: number; targetUid: number; to: { col: number; row: number };
      facing?: Facing; via?: { col: number; row: number }[]; actionId?: string;
    }
  // A Lightning rider's Stance switch (ZHDR-303 Valkyrie, ZHDR-304 Harpy):
  // sent by the ATTACKER, whose Action it is, onto the Mech it hit.
  | { kind: 'forceShutdown'; seat: Side; uid: number; targetUid: number }
  // C1 of the 2026-09-25 audit. In a FREEFORM room one phone runs both halves
  // of an attack, so the defender's paid choices - a Focus, KC Armor's Charge
  // Token, a HALO Command Token - leave it as the DEFENDER's commands, and the
  // relay takes only commands sent as the sender's own squad. They applied on
  // that phone and never reached the other. Carried inside one sent as the
  // sender's own seat, they travel. Refused wherever there is a script: a
  // Guided game's two phones answer for their own units through the mirror.
  | { kind: 'onBehalf'; seat: Side; cmd: Command }
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
      // The debt as the record keeps it, so a new kind (The Red Shoes' control)
      // cannot be typed in one place and not the other.
      items: ScriptState['reactions'];
    }
  // `placed: false` is a declined Emergency Smoke: the debt clears and the one
  // use is kept (audit Phase 4, G9). Absent means the reaction was taken.
  | { kind: 'resolveReaction'; seat: Side; uid: number; actionId: string; placed?: boolean }
  // The "White Dwarf" Bit turning its card over (293/294/295). The set is read
  // from the ACTION rather than trusted from the wire, the same single-source
  // rule the Disarm face and the crushSwap step-out grid follow.
  | { kind: 'switchForm'; seat: Side; uid: number; actionId: string; cardId: string }
  // Remote Access turning a Terminal face-down for the rest of the round
  // (5.3.3). Worth VP at the End Phase, so it has to travel — freeplay used to
  // set `item.accessed` in place and the other client scored a different board.
  | { kind: 'accessTerminal'; seat: Side; uid: number; itemId: string }
  // A Task Item claimed BY HAND, for a table with no board to read it off.
  // Control is normally settled from the Grids (settleControl) and a Terminal
  // from direct access; the companion app has neither, so the players tell it
  // what the physical table shows. `side: null` gives the Item back to nobody.
  | { kind: 'claimItem'; seat: Side; itemId: string; side: Side | null }
  // A hold-zone Task settled BY HAND, the claimItem of a Secondary: `side` is
  // whose Task it is, `seat` only who recorded it.
  | { kind: 'claimZone'; seat: Side; side: Side; held: boolean }
  // A running Guided game becomes a Freeform one: the script and the setup go,
  // everything ON the table stays (units, damage, Tokens, Tasks, score, round).
  // One way only, and the host's call.
  | { kind: 'leaveGuided'; seat: Side }
  // A Part's damage state set OUTRIGHT, the way freeplay's inspector lets a
  // player cycle it by hand. applyPenetration is the RULE - it walks the ladder,
  // drops a Link, stamps who dealt it - and stays the only thing an attack
  // emits. This is the record-keeping edit beside it: a player fixing the sheet
  // to match a table that has already resolved the hit.
  | { kind: 'setPartState'; seat: Side; uid: number; slot: PartSlot | 'main'; state: PartState
    // Who destroyed it, when a tap records a Part going into Destroyed: the
    // kill was the other squad's, uid 0, so Weapons Test never counted it and
    // an own kill broke Mercy (audit Phase 6, D8).
    by?: number }
  | { kind: 'launch'; seat: Side; uid: number; actionId: string; cardId: string; to: { col: number; row: number }; facing: Facing }
  // `route`: the Grids of the Movement it is laid along, start to landing, and
  // `flying` when that was a Flight Move, whose path is only its two ends (FAQ
  // M29). Carried because the tabletop Lays before its Maneuver is recorded.
  | { kind: 'layMine'; seat: Side; uid: number; actionId: string; cardId: string; to: { col: number; row: number }; route?: { col: number; row: number }[]; flying?: boolean }
  | { kind: 'blink'; seat: Side; uid: number; actionId: string; targetUid: number; facing: Facing; targetFacing: Facing }
  | { kind: 'despawn'; seat: Side; uid: number; targetUid: number }
  // 292_A's other half: the Port takes a Bit back and its Ammo Token returns
  // (ruling I23). The Action itself is paid first, the way a launch is.
  | { kind: 'recoverBit'; seat: Side; uid: number; actionId: string; targetUid: number }
  // A Missile's own flight into its target's Grid, which its Delayed Action
  // prints ("Fly into target grid"). No Forced Movement, which a Projectile
  // cannot be subject to (4.3.4), and the Interception it owes is queued beside
  // it (audit Phase 5, A2).
  | { kind: 'flyToTarget'; seat: Side; uid: number; actionId: string; targetUid: number }
  // `occupied`: with no board the table says whether the Grid it Unfolds
  // in holds a unit (FAQ M18.4; audit Phase 5, C5).
  | { kind: 'unfold'; seat: Side; uid: number; occupied?: boolean }
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
  // The table ends a Tether it judged (a pad has no distances; audit Phase 4,
  // H1). Sent by either end's player, naming their own unit.
  | { kind: 'cutTether'; seat: Side; uid: number; targetUid: number }
  // `for` names the squad the Screen belongs to when it is not the sender's:
  // a defender's Emergency Smoke is driven from the attacking client, whose
  // seat the ATTRIBUTED stamping will overwrite. Ownership decides stacking
  // and who dissipates it, so it has to survive the stamp.
  | { kind: 'placeSmoke'; seat: Side; at: { col: number; row: number }; for?: Side }
  // Lay an Environment Card on a Grid, or clear that Grid with card: null.
  // Table-level: the cards belong to the battlefield, not to either squad, and
  // 5.4.1 has the two players placing them alternately as they set it up.
  | { kind: 'setEnvironment'; seat: Side; at: { col: number; row: number }; card: string | null }
  // `side`: whose screen. The seat is attribution (stamped with the sender's
  // own when networked), so it cannot say which of two screens sharing a Grid
  // is meant (audit Phase 4, G6). Absent, the first one there, as before.
  | { kind: 'removeSmoke'; seat: Side; at: { col: number; row: number }; side?: Side }
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
  | { kind: 'configureTable'; seat: Side; map?: string; grids?: BoardGrids; zones?: GameState['zones'] | null; deployZones?: GameState['deployZones'] | null; zoneSet?: string; mission?: string | null; tasks?: GameState['tasks']; scale?: GameState['scale']; tableDice?: boolean; guidedPlay?: boolean; unlocked?: boolean; roundLimit?: number; noBoard?: boolean }
  | { kind: 'startMatch'; seat: Side }
  | { kind: 'endMatch'; seat: Side }
  // A squad's open-information Secondary Task pick (3.1.3). The seat is the
  // side choosing, so a player can only ever pick their own.
  | { kind: 'pickSecondary'; seat: Side; cardId: string }
  // A Black Box placed at setup, in its named zone, alternately from the First
  // Player (5.2.1 step 3; ruling I23). `to` is a Small Grid; the Box's own
  // spot, sent back, keeps its default.
  | { kind: 'placeTaskItem'; seat: Side; itemId: string; to: { col: number; row: number } }
  // A squad's hand of Tactics Cards, chosen with the squad and held rather
  // than played onto the board (5.4). It travels because `check()` for
  // playTactic reads the *sender's* hand, which the receiving client would
  // otherwise never have seen — and because a hand set locally is a hand the
  // other player cannot see the cost of.
  | { kind: 'setTactics'; seat: Side; cards: string[] }
  // A seat opening its collection to the table, or closing it again. Carries
  // the whole shelf, so a repeat cannot double it; `shared` false takes it back.
  | { kind: 'setInventory'; seat: Side; shared: boolean; boxes?: Record<string, number>; cards?: Record<string, number>; builtOnly?: boolean }
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
  // The KK9's Overwatch Strike: the enemy it designates and the Ally Mech that
  // fires at it (LHDR-KK9_B; audit Phase 5, F8).
  | { kind: 'overwatch'; seat: Side; uid: number; actionId: string; targetUid: number; mechUid: number }
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
  | { kind: 'revealTimings'; seat: Side; salt: string; dials: { uid: number; timing?: Timing }[] }
) & CommandChain;

// `note` is an allowed command that still has something to say — the award of a
// negative rider is the first of them. Warn, don't block: the rules have an
// answer (the total floors at zero), and refusing would lose the whole round's
// Victory Points for BOTH squads over one card.
export type CheckResult = { ok: true; note?: string } | { ok: false; why: string };

const STANCES: Stance[] = ['offensive', 'defensive', 'mobility', 'shutdown'];
const ok: CheckResult = { ok: true };
const no = (why: string): CheckResult => ({ ok: false, why });
const fromVerdict = (v: { ok: boolean; why?: string }): CheckResult => (v.ok ? ok : no(v.why ?? 'Not allowed.'));

const tacticCtx = (data: GameData): TacticCtx => ({ maxLink: (x) => maxLink(data, x), cruising: (x) => cruising(data, x) });

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
// A Repaired Part still acts (FAQ J23), so it may still be Charged (E12).
function chargeable(data: GameData, t: Token, slot: string): boolean {
  return tokenCards(data, t).some(
    ({ slot: s, card }) => s === slot
      && ((t.partStates[s as PartSlot | 'main'] ?? 'intact') !== 'destroyed' || (t.repairedSlots ?? []).includes(s))
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
  const lent = ammoDeliveryPool(data, t, actionId, loanedParts(data, state.tokens, t));
  return lent ?? { from: own, poolId: actionId };
}

// How many shots the magazines behind one Action can pay for in all: its own,
// then the Ammunition Pack's that 086_B lends an empty Pod. A Volley and a
// launch tool size themselves off this, so a page never offers a shot launch
// refuses, nor refuses one it would take (audit Phase 2, C6). undefined when
// the Action tracks no Ammo at all.
export function ammoAvailable(data: GameData, state: GameState, t: Token, actionId: string): number | undefined {
  const own = ammoHolder(data, state, t, actionId).ammo?.[actionId];
  if (own === undefined) return undefined;
  const lent = ammoDeliveryPool(data, t, actionId, loanedParts(data, state.tokens, t));
  return own + (lent ? (lent.from.ammo?.[lent.poolId] ?? 0) : 0);
}

function findAction(data: GameData, state: GameState, uid: number, actionId: string) {
  const t = state.tokens.find((x) => x.uid === uid);
  if (!t) return undefined;
  // ownCards: a Carrier Tarantula never uses its own Load (FAQ O4).
  for (const { card } of ownCards(data, t)) {
    const a = (card.actions ?? []).find((x) => x.id === actionId);
    if (a) return a;
  }
  // A Backpack carried by a Carrier Tarantula in Contact is this Mech's Part
  // while it acts (FAQ O3/O16), so its Actions are this Mech's Actions.
  // A table with no board judges the Contact (audit Phase 5, G4).
  for (const { card } of loanedParts(data, state.tokens, t, { anywhere: !!state.noBoard })) {
    const a = (card.actions ?? []).find((x) => x.id === actionId);
    if (a) return a;
  }
  return data.commonActions.find((x) => x.id === actionId);
}

// A strict table: the guide's strict tracking, or any online game, which is
// always strict (see perform). The rules that only a strict table holds ask
// this, so the sandbox, Teaching and Freeform keep their hand controls.
export function strictNow(state: GameState): boolean {
  return !!state.script?.strict || !!getLocalSeat();
}

// A strict guided game under way: the script's own Strict flag (the Match
// Centre's and pad Guided's scripts are born strict) and a finished setup. A
// sandbox or a Freeform pad keeps its correction tools (audit Phase 6, B5).
function strictGuided(state: GameState): boolean {
  return !!state.script?.strict && normaliseSetup(state.setup)?.stage === 'done';
}

// The owed Interception attempts that can still be made: a unit on the board
// with a Token left on that Part, not in Shutdown and not under Fire Control
// Interference, at a target still standing. Interception "must be performed"
// while its conditions are met (M5), so a strict table holds the phase and the
// skip on these (audit Phase 5, B10).
export function liveIntercepts(state: GameState): { uid: number; actionId: string; targetUid: number }[] {
  return (state.script?.intercepts ?? []).filter((o) => {
    const x = state.tokens.find((u) => u.uid === o.uid);
    const target = state.tokens.find((u) => u.uid === o.targetUid);
    if (!x || !target || !alive(x) || !alive(target) || x.deployed === false) return false;
    if ((x.intercept?.[o.actionId] ?? 0) <= 0) return false;
    if (x.kind === 'mech' && x.stance === 'shutdown') return false;
    return statusCount(x.statuses, 'fci') <= 0;
  });
}

// The Action Opportunity being spent, but only if it belongs to this unit:
// commands never invent one, they spend the one the guide opened.
function oppOf(state: GameState, uid: number) {
  const o = state.script?.opp;
  return o && o.uid === uid ? o : undefined;
}

// A Penetrated bearer owes its Boxes to the attacker's drop (5.3.1, P3). Its
// base is stamped on each, so the drop can still be judged when the same
// attack takes the bearer off the board: the Box was lost that way, keeping a
// bearer nobody could see (audit Phase 6, F1).
// A unit that detonates as it is destroyed: the Zealot's Martyrdom (ZHDR-302)
// and the AS3-B's Self-Destruct, a Detonation `on_destroyed`.
function blowsWhenDestroyed(data: GameData, t: Token): boolean {
  return tokenCards(data, t).some(({ slot, card }) => slot !== 'pilot' && (card.actions ?? []).some((a) =>
    (a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => {
      const eff = e as { type?: string; trigger?: string };
      return eff.type === 'detonation' && eff.trigger === 'on_destroyed';
    }))));
}

// A unit as it comes out of its squad for a new game, keeping who it is: its
// uid, side and label, and its place in the log.
function freshUnit(data: GameData, state: GameState, t: Token): Token {
  const scratch = { ...state, tokens: [] as Token[], nextUid: state.nextUid };
  const card = data.byId.get(t.cardId);
  const made = t.kind === 'mech' && t.mech
    ? makeMechToken(scratch, data, t.mech, t.side, t.label)
    : card ? makeDroneToken(scratch, data, card, t.side, t.droneBackpack) : null;
  if (!made) return t;
  return { ...made, uid: t.uid, label: t.label, col: t.col, row: t.row, facing: t.facing, ...(t.log ? { log: t.log } : {}) };
}

// The Tasks for a new game: the Main Task and its Items stay, as the lobby may
// have set them, with nobody holding one and every Black Box back on its
// default spot; the score, the kills, the Secondaries and their targets go.
function freshTasks(data: GameData, state: GameState): TaskState | null {
  const was = normaliseTasks(state.tasks);
  const mission = state.mission ? data.missions.cards.find((m) => m.id === state.mission) : undefined;
  const own = state.zones && state.zones.length ? state.zones : data.zoneData.zones;
  const seeded = mission ? taskItemsFor(own, mission).items : [];
  const next = newTaskState();
  next.main = was.main;
  next.items = was.items.map((i) => {
    const base = { id: i.id, kind: i.kind, zone: i.zone, control: null, accessed: null } as TaskItem;
    if (i.kind !== 'blackbox') return { ...base, ...(i.col !== undefined ? { col: i.col, row: i.row } : {}) };
    const home = seeded.find((s) => s.id === i.id);
    return { ...base, col: home?.col ?? i.col, row: home?.row ?? i.row };
  });
  return next;
}

// `moved`: the attack's Forced Movement has moved the bearer, so a drop it
// already owes is judged at the new position (FAQ E19), an Abyss included.
function stampBoxDrops(state: GameState, t: Token, moved = false): void {
  const tasks = normaliseTasks(state.tasks);
  let owed = false;
  for (const i of tasks.items) {
    if (i.kind !== 'blackbox' || i.bearerUid !== t.uid || (moved && !i.dropFrom)) continue;
    i.dropFrom = { col: t.col, row: t.row, size: t.size };
    owed = true;
  }
  if (owed) state.tasks = tasks;
}

// The terrain the engine itself can see: a shipped layout or an authored map,
// less what has been destroyed. Null for a player's own custom map, which
// lives in one browser, so a rule that needs terrain leaves that board to its
// page rather than judging it on an empty table (audit Phase 4, D6).
// A Mine is a small Ground Unit (Supplementary Rules 1.04, 1.3), so it stands
// clear of terrain; units it may share a Grid with. Judged on the terrain the
// engine knows, which a table with no board or an unknown map does not have.
function mineOnTerrain(data: GameData, state: GameState, col: number, row: number): string | null {
  if (state.noBoard) return null;
  const terrain = knownTerrain(data, state);
  if (!terrain) return null;
  return terrain.some((p) => p.subCells.some((x) => x.col === col && x.row === row))
    ? 'A Mine is a Ground Unit, so it cannot stand on terrain (Supplementary Rules 1.04, 1.3). Pick a cell of that Grid the terrain leaves free.'
    : null;
}

function knownTerrain(data: GameData, state: GameState): TerrainPiece[] | null {
  if (!state.map) return [];
  const base = data.boardMaps?.find((m) => m.id === state.map)?.pieces ?? data.terrain?.layouts?.[state.map];
  if (!base) return null;
  const gone = new Set(state.removedTerrain ?? []);
  return base.filter((p) => !gone.has(p.id));
}

// A Movement a Tactics Card handed a unit (Hit and Run), owed until made.
// Kept in the once-per-round ledger, which is normalised and pruned by round
// already, so the grant cannot outlive the round it was played in.
function grantedMoveKey(state: GameState, uid: number): string {
  return `${state.round.n}:grantedMove:${uid}`;
}

// A maneuver takes whichever debt authorised it: a `free` one the Movement its
// Action paid for (Opportunity.moveOwed), a `granted` one the card's grant.
function takeMoveGrant(state: GameState, cmd: Extract<Command, { kind: 'maneuver' }>): void {
  const sc = state.script;
  if (!sc) return;
  if (cmd.free && sc.opp?.uid === cmd.uid && sc.opp.moveOwed) sc.opp = { ...sc.opp, moveOwed: undefined };
  if (cmd.granted) {
    const key = grantedMoveKey(state, cmd.uid);
    sc.oncePerRound = (sc.oncePerRound ?? []).filter((k) => k !== key);
  }
}

// Whether this Mech may Reboot now, and if not, why. One reading for check()
// and for the three pages that offer the row. A Shutdown Mech Reboots "the next
// time it gains an Action Opportunity" (FAQ K17; 4.1.1), so in a guided game
// that is its own Action Phase Opportunity - an Echo's included (FAQ L8) - and
// before it has done anything in it: one shut down part-way through its own
// turn Reboots at the start of its next. It used to be accepted at any time,
// during the enemy's turn and in the very Opportunity it shut down in, which
// handed it a fresh Tick (audit Phase 2, A1). A free table has no Opportunities
// and records the Reboot whenever the table says it happened.
export function rebootWhy(state: GameState, t: Token): string | null {
  if (t.kind !== 'mech') return 'Only a Mech Reboots.';
  if (t.stance !== 'shutdown') return 'Only a Mech in Shutdown Stance may Reboot (4.1.1).';
  if (!guidedGame(state)) return null;
  const o = oppOf(state, t.uid);
  if (!o || PHASES[state.round.phase] !== 'Action') {
    return `${t.label} Reboots when its own Action Opportunity comes, which its Timing Dial decides (4.1.1, FAQ K17).`;
  }
  if (!untouched(o)) return `${t.label} shut down during this Action Opportunity, so it Reboots at the start of its next one (FAQ K17).`;
  return null;
}

// A Shutdown Mech whose own Action Opportunity has just come round has one thing
// to do, and it must (FAQ K17: it "reboots the next time it gains an Action
// Opportunity"). Passing it by would keep the Mech Shutdown a whole round the
// rules never gave it. Ruled 2026-09-25 (audit Phase 2, E3).
export function rebootOwed(state: GameState, t: Token): boolean {
  return t.kind === 'mech' && t.stance === 'shutdown' && t.partStates.torso !== 'destroyed'
    && guidedGame(state) && rebootWhy(state, t) === null;
}

// A game being walked through Opportunity by Opportunity. NOT `state.script`
// alone: migrateState gives every loaded state a script, the sandbox and a
// Freeform pad table included, so the setup is what says a game is Guided
// (the pad's guidedOn reads the same). The Phase 2 gates first read the
// script, which refused a Freeform table its Reboot.
function guidedGame(state: GameState): boolean {
  return !!state.script && !!normaliseSetup(state.setup);
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

// The Red Shoes' live debt over a unit, held by one of `seat`'s own units: the
// proof that a Movement of that unit is the controller's to make. Only a won
// TM35NA_B queues it (ewWinCommands), and only the controlledMove that makes
// the Movement spends it, so it lives exactly as long as the control does
// (ruled R1; audit Phase 7, P7D 1).
function controlOver(state: GameState, uid: number, seat: Side): ScriptState['reactions'][number] | undefined {
  return (state.script?.reactions ?? []).find((r) => r.kind === 'control' && r.fromUid === uid
    && state.tokens.some((c) => c.uid === r.uid && c.side === seat));
}

// The round track, the pre-game stages, the smoke and intercept books, the
// designation loop's pass and the End Phase checklist belong to the table, not
// to a unit, so these carry a seat and nothing else.
type TableKind =
  | 'advancePhase' | 'setPhase' | 'resetRounds' | 'adjustCommandTokens' | 'passTurn' | 'endSwarm' | 'markEndStep' | 'award' | 'adjustVp' | 'concede'
  | 'lockMap' | 'rollSetup' | 'acceptRoll' | 'noteRoll' | 'finishTasks' | 'pickEdge' | 'lockDials' | 'finishDeployment'
  | 'queueIntercepts' | 'clearIntercepts' | 'placeSmoke' | 'removeSmoke' | 'dissipateSmoke'
  | 'setEnvironment'
  // queueReactions only: `resolveReaction` names the defender's own unit, so it
  // goes through the actor path and gets the "your units only" check free.
  | 'queueReactions'
  | 'clearCounterRoll' | 'rollTerminal'
  | 'setMode' | 'handOver' | 'setStrict' | 'commitTimings' | 'revealTimings' | 'importSquad'
  | 'configureTable' | 'startMatch' | 'endMatch' | 'pickSecondary' | 'placeTaskItem' | 'setTactics' | 'setInventory' | 'setReady' | 'designateTask'
  | 'callDefense' | 'answerDefense' | 'clearDefense' | 'setCombatView' | 'focusAnswer' | 'focusReroll' | 'kcArmor' | 'designateHit' | 'meleeEvade' | 'dodgeEnhance' | 'riposte'
  | 'setRollbackCatalog' | 'rollbackRequest' | 'rollbackAnswer'
  | 'claimItem' | 'claimZone' | 'leaveGuided' | 'setPartState' | 'onBehalf';
const TABLE_KINDS = new Set<Command['kind']>([
  'advancePhase', 'setPhase', 'resetRounds', 'adjustCommandTokens', 'passTurn', 'endSwarm', 'markEndStep', 'award', 'adjustVp', 'concede',
  'lockMap', 'rollSetup', 'acceptRoll', 'noteRoll', 'finishTasks', 'pickEdge', 'lockDials', 'finishDeployment',
  'queueIntercepts', 'clearIntercepts', 'placeSmoke', 'removeSmoke', 'dissipateSmoke',
  'setEnvironment',
  'queueReactions',
  'clearCounterRoll', 'rollTerminal',
  'setMode', 'handOver', 'setStrict', 'commitTimings', 'revealTimings', 'importSquad',
  'configureTable', 'startMatch', 'endMatch', 'pickSecondary', 'placeTaskItem', 'setTactics', 'setInventory', 'setReady', 'designateTask',
  'callDefense', 'answerDefense', 'clearDefense', 'setCombatView', 'focusAnswer', 'focusReroll', 'kcArmor', 'designateHit', 'meleeEvade', 'dodgeEnhance', 'riposte',
  'setRollbackCatalog', 'rollbackRequest', 'rollbackAnswer',
  'claimItem', 'claimZone', 'leaveGuided', 'setPartState', 'onBehalf',
]);

// What a Freeform phone may carry for the other squad (onBehalf): the spends a
// defender makes inside an attack or a Counter-roll that phone is running.
const ON_BEHALF = new Set<Command['kind']>(['focus', 'setCharge', 'spendCommand']);

// Table commands whose seat is attribution rather than a choice one squad
// owns. Networked, they are stamped with the sender's own seat, because the
// relay refuses anything sent as the other player — a guest advancing the
// phase with a hard-coded 's1' would apply locally and silently never travel.
const ATTRIBUTED = new Set<Command['kind']>([
  'advancePhase', 'setPhase', 'resetRounds', 'markEndStep', 'award', 'adjustVp',
  // Who asked and who answered is the whole record of a rollback, so both are
  // stamped with the sender's own seat like every other attributed command.
  'callDefense', 'answerDefense', 'clearDefense', 'setCombatView', 'focusAnswer', 'focusReroll', 'kcArmor', 'designateHit', 'meleeEvade', 'dodgeEnhance', 'riposte',
  'setRollbackCatalog', 'rollbackRequest', 'rollbackAnswer',
  'lockMap', 'acceptRoll', 'noteRoll', 'lockDials', 'finishDeployment',
  'queueIntercepts', 'clearIntercepts', 'placeSmoke', 'removeSmoke', 'dissipateSmoke',
  'setEnvironment',
  // Queued from the ATTACKING client but naming the defender's units, so the
  // seat is pure attribution and gets stamped like any other table command.
  'queueReactions',
  'setMode', 'setStrict', 'adjustCommandTokens', 'designateTask', 'clearCounterRoll',
  'configureTable', 'startMatch', 'endMatch', 'leaveGuided',
  // The seat on a hand-made claim is WHO RECORDED IT, never whose Item it is -
  // that rides in `side`. Stamped like any other table command so either player
  // may keep the sheet without the server refusing it as the other squad's.
  'claimItem', 'claimZone',
  // Same reasoning: a damage state written down off the physical table is
  // BOOKKEEPING, and either player may keep the book. Routed as a unit command
  // it carried the unit's own side as its seat, and the relay refuses any
  // command sent as the other squad - so recording a hit on the enemy applied
  // locally, was refused by the server, and the two pads drifted apart in
  // silence. The unit it names rides in `uid`; the seat is who recorded it.
  'setPartState',
  // Who carried it is the sender; whose unit it is rides in the inner command.
  'onBehalf',
]);
function tableLevel(cmd: Command): cmd is Command & { kind: TableKind } {
  return TABLE_KINDS.has(cmd.kind);
}

// The lookup the zone-control judgement reads its Grids from.
// Zone cells for scoring. Reads the TABLE's zones (an authored map's, when it
// has them) rather than the shipped nine, so Control is settled on the area the
// map actually painted.
//
// The fallback is spelled out here rather than imported from types.ts's
// zonesOf, for the SAME reason tasks.ts keeps a private grid-ref parser: this
// module is compiled standalone by two dozen test slices, which strip its
// imports, and a value import would break every one of them. It is one line and
// it is pinned against the canonical helper by mapeditor.test.mjs -- if the
// rule for "which zones is this table playing with" ever changes, both move.
const zoneCells = (data: GameData, state: GameState) => (zone: string): string[] => {
  const own = state.zones;
  const list = own && own.length ? own : data.zoneData.zones;
  return list.find((z) => z.id === zone)?.cells ?? [];
};

// The first clear square for a newly arrived unit, scanning row by row from
// the squad's own edge — Squad 1 from the top of the board, Squad 2 from the
// bottom, the same orientation the interactive spot-finder uses. Pure function
// of the state, because a mirrored seat must land the unit on the same Grid.
function freeSpot(state: GameState, size: number, side: Side, aerial: boolean): { col: number; row: number } | null {
  // Read off the STATE, never a module constant: the same command replayed on
  // a 16 or 18 Grid board has to scan that board, and a mirrored seat must
  // land the unit on the identical Grid.
  const cells = cellsOf(state);
  const rows = [...Array(cells - size + 1).keys()];
  if (side === 's2') rows.reverse();
  for (const row of rows) {
    for (let col = 0; col <= cells - size; col++) {
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
    case 'onBehalf': {
      if (state.script) return no('In a Guided game each squad answers for its own units.');
      const inner = cmd.cmd as Command | undefined;
      if (!inner || typeof inner !== 'object' || !ON_BEHALF.has(inner.kind)) return no('That cannot be sent for the other squad.');
      return check(data, state, inner);
    }
    case 'setPartState': {
      const target = state.tokens.find((x) => x.uid === cmd.uid);
      if (!target) return no('That unit is not on the board.');
      const card = tokenCards(data, target).find((x) => x.slot === cmd.slot)?.card;
      if (!card) return no('That unit has no such Part.');
      if (!['intact', 'damaged', 'destroyed'].includes(cmd.state)) return no('That is not a damage state.');
      // A Part with no Structure has no Damaged step to sit on (4.4.4), and
      // letting one be set there would show a state the printed card cannot.
      if (cmd.state === 'damaged' && structureOf(data, target, cmd.slot) <= 0) {
        return no('That Part has no Structure, so it is either intact or destroyed.');
      }
      if (cmd.by !== undefined && !state.tokens.some((x) => x.uid === cmd.by)) return no('The unit named as the attacker is not on the table.');
      return ok;
    }
    case 'leaveGuided': {
      if (cmd.seat !== 's1') return no('Only the host may take the game out of Guided play.');
      if (!normaliseSetup(state.setup)) return no('This is not a Guided game.');
      // Mid-attack or mid-Opportunity there is a half-paid Action on the table;
      // dropping the script under it would strand it.
      if (state.script?.combat) return no('Finish the attack first.');
      if (state.script?.opp) return no('End the open Action Opportunity first.');
      return ok;
    }
    case 'claimZone': {
      if (cmd.side !== 's1' && cmd.side !== 's2') return no('That is not a squad.');
      if (!normaliseTasks(state.tasks).zone[cmd.side]) return no('That squad has not designated a Tactical Zone.');
      return ok;
    }
    case 'claimItem': {
      const item = normaliseTasks(state.tasks).items.find((i) => i.id === cmd.itemId);
      if (!item) return no('There is no such Task Item.');
      // A Black Box is CARRIED, not claimed: it has a bearer and a slot, and
      // takeBlackBox is the command that says so. Letting this set one would
      // score a Box nobody is holding.
      if (cmd.side !== null && cmd.side !== 's1' && cmd.side !== 's2') return no('That is not a squad.');
      // With no board the table says where a carried Box is: Asset
      // Preservation's "In Echo" is a claim for the bearer's squad on a Box it
      // carries, and the only road a Box has to a score on the pad. Every Box
      // was refused, so it could never score there (audit Phase 6, F4).
      if (item.kind === 'blackbox') {
        const bearer = item.bearerUid !== undefined ? state.tokens.find((x) => x.uid === item.bearerUid) : undefined;
        if (!state.noBoard || !bearer) return no('A Black Box is picked up, not claimed.');
        if (cmd.side !== null && cmd.side !== bearer.side) return no(`${bearer.label} carries that Black Box, so only its own squad holds it.`);
      }
      return ok;
    }
    case 'configureTable': {
      if (cmd.map === undefined && cmd.grids === undefined && cmd.zones === undefined && cmd.deployZones === undefined
        && cmd.zoneSet === undefined && cmd.mission === undefined && cmd.tasks === undefined && cmd.scale === undefined
        && cmd.roundLimit === undefined && cmd.noBoard === undefined && cmd.tableDice === undefined && cmd.guidedPlay === undefined && cmd.unlocked === undefined) {
        return no('Nothing to configure.');
      }
      // The board size rides with the map it was authored at, so both seats
      // resolve identical geometry without either reading the other's map
      // storage. Only the sizes we ship are accepted.
      if (cmd.grids !== undefined && cmd.grids !== 12 && cmd.grids !== 16 && cmd.grids !== 18) return no('That is not a board size.');
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
      // The unlock is the HOST's alone (seat 1 opens every room; the seat on a
      // table command is the sender's own, so this holds on every client).
      if (cmd.unlocked !== undefined && cmd.seat !== 's1') return no('Only the host may unlock or lock the game.');
      // Unlocked, the two setup locks below stand aside: that is its whole job.
      if (state.unlocked) return ok;
      // The board size goes with the map; the zones, the Deployment Zones and
      // the Task Items go with the Main Task. A whole TaskState, VP included,
      // was accepted from the guest in round 3 (audit Phase 6, A5).
      if ((cmd.map !== undefined || cmd.grids !== undefined) && battlefieldLocked(setup)) {
        return no('The battlefield is locked once the game starts (3.1.2). End the game to change it.');
      }
      if ((cmd.zoneSet !== undefined || cmd.mission !== undefined || cmd.zones !== undefined || cmd.deployZones !== undefined || cmd.tasks !== undefined) && tasksLocked(setup)) {
        return no('The Tasks are settled once the edges are picked (3.1.2). End the game to change them.');
      }
      // The game's length, its scale and how it is played are the host's, and
      // are fixed once it is under way.
      const house = cmd.roundLimit !== undefined || cmd.scale !== undefined || cmd.noBoard !== undefined || cmd.guidedPlay !== undefined;
      if (house && getLocalSeat() && cmd.seat !== 's1') return no('Only the host sets the game length, the scale and the way it is played.');
      if (house && setup?.stage === 'done') return no('The game is under way, so its length, scale and way of play are fixed. End the game to change them.');
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
      const su = normaliseSetup(state.setup);
      if (!su) return no('No game is running.');
      // Across a table, a game under way is ended by the host, or by both
      // players agreeing, or once it is over. Either seat could wipe the
      // Tasks and the score for both, at any time (audit Phase 6, A5).
      if (getLocalSeat() && su.stage !== 'map' && cmd.seat !== 's1') {
        const tasks = normaliseTasks(state.tasks);
        const limit = state.roundLimit ?? 5;
        const over = !!tasks.conceded || state.round.n > limit
          || (state.round.n >= limit && !!state.script?.endDone.includes(`${state.round.n}:end:tasks`));
        if (!over && !state.ready?.s1) return no('Only the host ends a game under way. Concede it, or ask the host to end it.');
      }
      return ok;
    }
    case 'pickSecondary': {
      if (!(data.secondary ?? []).some((c) => c.id === cmd.cardId)) return no('That is not a Secondary Task card.');
      // In a game: chosen in the Tasks step, after the edges (3.1.3; ruling
      // I3), the First Player first (FAQ P1), final once both are revealed
      // (ruling I5), and never the card the other squad holds (the box has
      // one of each; ruling I17). Any seat picked at any stage, the second
      // player first, and a pick changed in round 3 (audit Phase 6, A2, A5).
      const su = normaliseSetup(state.setup);
      if (su) {
        if (su.stage !== 'tasks') return no('Secondary Tasks are chosen in the Tasks step of setup, after the edges are picked (3.1.3).');
        const tasks = normaliseTasks(state.tasks);
        const other: Side = cmd.seat === 's1' ? 's2' : 's1';
        const fp = state.round.firstPlayer;
        if (cmd.seat !== fp && !tasks.secondary[fp]) return no('The First Player chooses and reveals their Secondary Task first (FAQ P1).');
        if (tasks.secondary[cmd.seat] && tasks.secondary[other]) return no('Both Secondary Tasks are revealed, so they are final.');
        if (tasks.secondary[other] === cmd.cardId) return no('The other squad holds that Secondary Task, and the box has one of each.');
      }
      return ok;
    }
    case 'placeTaskItem': {
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'tasks') return no('Task Items are placed in the Tasks step of setup (5.2.1).');
      const tasks = normaliseTasks(state.tasks);
      const item = tasks.items.find((i) => i.id === cmd.itemId);
      if (!item || item.kind !== 'blackbox') return no('That is not a Black Box.');
      if (item.set) return no('That Black Box is already placed.');
      const turn = boxPlaceTurn(tasks, state.round.firstPlayer);
      if (turn !== cmd.seat) return no('The Black Boxes are placed alternately, starting from the First Player (5.2.1), and it is the other squad\'s turn.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
        return no('That is not a place on the board.');
      }
      // A table with no board places the model itself.
      if (!state.noBoard) {
        const cells = zoneCells(data, state)(item.zone);
        if (!cells.some((ref) => { const g = cellToGrid(ref); return !!g && g.c === Math.floor(col / 3) && g.r === Math.floor(row / 3); })) {
          return no('Each Black Box goes in the Tactical Zone its Main Task names.');
        }
        // At ground level, never on terrain (FAQ P9).
        const terrain = knownTerrain(data, state) ?? [];
        if (terrain.some((p) => p.subCells.some((s) => s.col === col && s.row === row))) return no('A Black Box stands on the ground, never on terrain (FAQ P9).');
      }
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
    case 'setInventory': {
      const counts = (r: unknown): boolean => {
        if (r === undefined) return true;
        if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
        const entries = Object.entries(r as Record<string, unknown>);
        if (entries.length > 400) return false;
        return entries.every(([k, v]) => k.length <= 64 && typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99);
      };
      if (!counts(cmd.boxes) || !counts(cmd.cards)) return no('That is not a collection.');
      return ok;
    }
    case 'designateTask': {
      // Named in the Tasks step, before anything deploys (5.2.3): a fresh
      // designation was accepted in round 3 (audit Phase 6, A5).
      const suNow = normaliseSetup(state.setup);
      if (suNow && (suNow.stage === 'deploy' || suNow.stage === 'done')) return no('Every Task names its Mech or Zone in the Tasks step, before anything deploys (5.2.3).');
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
      if (!Array.isArray(cmd.entries)) return no('That is not a rollback list.');
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
      // The attack a Fire Control Interference Token forbids never reaches a
      // defence roll either (6.3.2, FAQ J5; audit Phase 6, C2).
      const shot = findAction(data, state, cmd.uid, cmd.actionId);
      if (shot?.type === 'Firing' && statusCount(at.statuses, 'fci') > 0) {
        return no(`${at.label} bears a Fire Control Interference Token, so it cannot perform Firing Actions (6.3.2, FAQ J5).`);
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
        // Short of a Torso, a Chassis or an Arm, or with no Pilot, a Mech
        // cannot be deployed (2.2.2, 5.1; ruling I32). A strict table
        // refuses it; elsewhere the squad panel warns (audit Phase 6, G3).
        if (strictNow(state)) {
          const why = incompleteMechWhy(m.loadout, m.name || 'A Mech');
          if (why) return no(why);
        }
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
      if (su && su.stage === 'done' && !state.unlocked) {
        return no('Squads join before deployment is finished (3.1.4). End the game to change the table freely.');
      }
      return ok;
    }
    case 'advancePhase': {
      const su = normaliseSetup(state.setup);
      if (su && su.stage !== 'done') return no('Finish the pre-game roll and deployment first (3.1).');
      // The End Phase's steps "must be performed" (3.7): a strict table leaves
      // it only once they are done, the Smoke's with Smoke on the board. The
      // guide's End round left it with nothing done (audit Phase 6, B5).
      if (strictNow(state) && state.script && su?.stage === 'done' && state.round.phase === PHASES.length - 1) {
        const done = state.script.endDone;
        const missing = ['remove', 'tokens', 'tasks'].filter((x) => !done.includes(`${state.round.n}:end:${x}`));
        if ((state.smoke ?? []).length && state.smokeRound !== state.round.n) missing.push('smoke');
        if (missing.length) {
          const name: Record<string, string> = { remove: 'Remove Units', tokens: 'Token Management', tasks: 'Check Tasks', smoke: 'Smoke dissipation' };
          return no(`The End Phase is not done: ${missing.map((x) => name[x]).join(', ')} (3.7).`);
        }
      }
      // An owed Interception is resolved before play moves on (M5; B10).
      if (strictNow(state) && liveIntercepts(state).length) return no('An Interception is still owed, and it must be made while it can be (M5).');
      // And a folded Pholcus Unfolds before the Delay Phase ends (M18.3; D3).
      if (strictNow(state) && PHASES[state.round.phase] === 'Delay' && unfoldsOwed(data, state.tokens).length) {
        return no('A folded Pholcus must Unfold in the Delay Phase (FAQ M18.3).');
      }
      // Out of the Planning Phase only with every dial set, a Shutdown Mech's
      // included (FAQ K17): the rule lockDials holds, for the pages that turn
      // the phase without a lock (a solo Match Centre, the guide). A Mech with
      // no dial never activated, so it never got the Opportunity it Reboots in
      // (audit Phase 2, A2).
      if (su && state.script && state.round.phase === 1) {
        const unset = state.tokens.filter((x) => x.kind === 'mech' && x.deployed !== false && alive(x) && !x.timing);
        if (unset.length) {
          return no(`${unset.map((x) => x.label).join(', ')} ${unset.length === 1 ? 'has' : 'have'} no Timing Dial set. Every Mech sets one before the Action Phase, a Shutdown Mech included (3.3, FAQ K17).`);
        }
      }
      // A designation loop ends when neither squad can or will go on (3.2.3).
      // The rule used to live only in which panel drew a Continue button, and a
      // stale or racing press skipped a live Command Phase for both players —
      // OTTO lost Round 1's drone Commands to exactly that. Networked play
      // refuses; the sandbox and guide still warn through perform().
      if (getLocalSeat() && state.script) {
        const ph = PHASES[state.round.phase];
        if (isLoopPhase(ph) && !loopComplete(state, ph, data)) {
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
      // A strict guided game runs its phases in order: a jump skipped the End
      // Phase and replayed a round with no round turn (audit Phase 6, B5).
      if (strictGuided(state)) return no('A strict game runs its phases in order. Use Undo to take a step back.');
      return ok;
    }
    case 'resetRounds':
      if (strictGuided(state)) return no('A strict game runs its rounds in order. Use Undo to take a step back.');
      return ok;
    case 'adjustCommandTokens': {
      if (!Number.isInteger(cmd.delta) || cmd.delta === 0) return no('Nothing to adjust.');
      if ((state.commandTokens?.[cmd.pool] ?? 0) + cmd.delta < 0) return no('A Command Token pool cannot go below zero.');
      return ok;
    }
    case 'endSwarm': {
      if (!swarmFor(state, cmd.seat)) return no('Swarm Tactics is not waiting to go on.');
      return ok;
    }
    case 'passTurn': {
      if (!state.script) return no('There is no guided game running.');
      if (!isLoopPhase(PHASES[state.round.phase])) return no('There is no designation loop to pass in this phase.');
      if (state.script.passed.includes(cmd.seat)) return no('This squad has already passed for the phase (3.2.2).');
      // "Automatic Actions are obligatory" (3.5; ruling I4): a strict table
      // holds the pass while one of this squad's Drones has a legal target
      // for one (audit Phase 5, F3). A custom map's terrain is the page's.
      if (strictNow(state) && PHASES[state.round.phase] === 'Automatic' && !state.noBoard) {
        const terrain = knownTerrain(data, state);
        const owing = terrain
          ? eligibleUnits(state, 'Automatic', cmd.seat, data).find((d) => autoShotOwed(data, state.tokens, d, { terrain, smoke: state.smoke ?? [] }))
          : undefined;
        if (owing) return no(`${owing.label} has a legal target, and its Automatic Action is obligatory (3.5).`);
      }
      // A folded Pholcus "must" Unfold in the Delay Phase (M18.3): a strict
      // table holds its squad's pass (audit Phase 5, D3).
      if (strictNow(state) && PHASES[state.round.phase] === 'Delay'
        && unfoldsOwed(data, state.tokens).some((u) => state.tokens.find((x) => x.uid === u.uid)?.side === cmd.seat)) {
        return no('A folded Pholcus must Unfold in the Delay Phase (FAQ M18.3).');
      }
      return ok;
    }
    case 'markEndStep': {
      if (!state.script) return no('The End Phase checklist belongs to a guided game.');
      if (state.round.phase !== PHASES.length - 1) return no('These steps belong to the End Phase (3.7).');
      // "Performed in the following order": Remove Units, Token Management,
      // then the Tasks. A strict table holds the order, and runs Remove and
      // Tokens once: a second Token step aged everything twice and took a
      // yellow token gained this round (3.7; audit Phase 6, B6, B7). Marking
      // the Tasks again stays harmless, since the Award already marks it.
      if (strictNow(state)) {
        const done = state.script.endDone;
        const at = (step: string) => done.includes(`${state.round.n}:end:${step}`);
        if ((cmd.step === 'remove' || cmd.step === 'tokens') && at(cmd.step)) return no('That End Phase step is already done this round (3.7).');
        const before = cmd.step === 'tokens' ? ['remove'] : cmd.step === 'tasks' ? ['remove', 'tokens'] : [];
        const missing = before.filter((x) => !at(x));
        if (missing.length) {
          return no(`The End Phase goes in order: ${missing.map((x) => (x === 'remove' ? 'Remove Units' : 'Token Management')).join(' and ')} first (3.7).`);
        }
      }
      return ok;
    }
    case 'adjustVp': {
      if (cmd.side !== 's1' && cmd.side !== 's2') return no('That is not a squad.');
      if (!Number.isInteger(cmd.by) || cmd.by === 0 || Math.abs(cmd.by) > 60) return no('That is not a change of score.');
      return ok;
    }
    case 'concede': {
      if (normaliseSetup(state.setup)?.stage !== 'done') return no('There is no game running to concede.');
      if (normaliseTasks(state.tasks).conceded) return no('A squad has already conceded this game.');
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
      if (normaliseTasks(state.tasks).conceded) return no('A squad has conceded, so the game is over.');
      // A strict End Phase scores its Tasks once, and after Remove Units and
      // Token Management (3.7, "in the following order"; audit Phase 6, B6,
      // B7). A second Award for the round paid its unkeyed lines again.
      if (strictNow(state) && state.script && normaliseSetup(state.setup)?.stage === 'done' && state.round.phase === PHASES.length - 1) {
        const done = state.script.endDone;
        const at = (step: string) => done.includes(`${state.round.n}:end:${step}`);
        if (at('tasks')) return no(`Round ${state.round.n}'s Tasks are already scored (3.7.3).`);
        if (!at('remove') || !at('tokens')) return no('The Tasks are scored after Remove Units and Token Management (3.7).');
      }
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
      // Once each, and again only on a tie: the loser of the roll could roll
      // again and take First Player (audit Phase 6, A5).
      const tied = !!su.rolls.s1.length && !!su.rolls.s2.length && !firstPlayerFrom(su);
      if (su.rolls[cmd.seat].length && !tied) return no('That squad has rolled, and only a tie is rolled again (3.1.2).');
      return ok;
    }
    case 'acceptRoll': {
      const su = normaliseSetup(state.setup);
      if (cmd.first !== undefined) {
        if (cmd.first !== 's1' && cmd.first !== 's2') return no('That is not a squad.');
        if (!su || su.stage !== 'roll') return no('The First Player is settled once, after the battlefield is locked (3.1.2).');
        return ok;
      }
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
      // Across a table or on a strict one the step is a rule, not a drawn
      // panel: both Secondaries revealed, every target named, and on a board
      // every Black Box placed (3.1.3, 5.2.1).
      if (strictNow(state)) {
        const tasks = normaliseTasks(state.tasks);
        if (!tasks.secondary.s1 || !tasks.secondary.s2) return no('Both squads choose a Secondary Task first (3.1.3).');
        if (taskDesignations(data, state).length) return no('Every Task names its Mech or Zone first (5.2.3).');
        if (!state.noBoard && tasks.items.some((i) => i.kind === 'blackbox' && !i.set)) return no('Every Black Box is placed first, alternately from the First Player (5.2.1).');
      }
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
      // Every Mech sets a dial, a Shutdown one included: it Reboots when its
      // Timing comes round (FAQ K17: "the reboot timing is determined by the
      // pilot"). A Mech locked in with no dial never activates, so a Shutdown
      // Mech the pad left off its dial list stayed Shutdown for good (audit
      // Phase 2, A2). The Teaching guide still warns and lets a second press
      // through; strict play refuses here.
      const unset = state.tokens.filter((x) => x.kind === 'mech' && x.deployed !== false && alive(x) && !x.timing);
      if (unset.length) {
        return no(`${unset.map((x) => x.label).join(', ')} ${unset.length === 1 ? 'has' : 'have'} no Timing Dial set. Every Mech sets one, a Shutdown Mech included: it Reboots when its Timing comes (3.3, FAQ K17).`);
      }
      return ok;
    }
    case 'finishDeployment': {
      if (!deploymentComplete(state, data)) return no('Units are still waiting to deploy (3.1.4).');
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
      // Interception "must be performed" while it can be (M5; audit Phase 5, B10).
      if (strictNow(state) && liveIntercepts(state).length) return no('Interception must be made while it can be (M5): resolve the owed attempts first.');
      return ok;
    }
    case 'clearCounterRoll': {
      const c = state.script?.counter;
      if (!c) return no('No Electronic Counter-roll is open.');
      // Only the Initiator's seat closes it, at any stage, except that either
      // seat may once the verdict is in and the Initiator lost. The Responder's
      // Done closed a WON Electronic Attack or free Scan before its Apply, and
      // the win was lost on both boards with the Tick spent (ruled R3; audit
      // Phase 7, P7D 1). Across a table only, where a seat is a player: one
      // device holds both hands, and a stuck exchange in a room is covered by
      // the pause when a seat drops.
      if (getLocalSeat()) {
        const init = state.tokens.find((x) => x.uid === c.initiatorUid);
        if (init && cmd.seat !== init.side) {
          const item = c.terminal !== undefined ? normaliseTasks(state.tasks).items.find((i) => i.id === c.terminal) : undefined;
          const resp = c.terminal !== undefined
            ? (item ? terminalStandIn(item, init.side, item.zone) : undefined)
            : state.tokens.find((x) => x.uid === c.responderUid);
          if (resp && counterWon(data, state.tokens, c, init, resp) !== false) {
            return no(`${init.label}'s player closes this Electronic Counter-roll: a win is theirs to Apply, and either side may close it only once the Initiator has lost (4.11.2).`);
          }
        }
      }
      return ok;
    }
    case 'rollTerminal': {
      const c = state.script?.counter;
      if (!c || c.terminal === undefined) return no('No Remote Access is rolling against a Terminal.');
      if (c.respRoll) return no('The Terminal has already rolled: it never Focuses, so it rolls once (ruling I25).');
      if (!Array.isArray(cmd.faces) || cmd.faces.length !== TERMINAL_EV || cmd.faces.some((f) => !Number.isInteger(f) || f < 0)) {
        return no(`A Terminal rolls its Electronic Value of ${TERMINAL_EV} in Yellow dice (p.87).`);
      }
      // The Initiator's opponent rolls for it (ruling I25). One phone holding
      // both squads may roll either hand.
      const init = state.tokens.find((x) => x.uid === c.initiatorUid);
      if (getLocalSeat() && init && cmd.seat === init.side) return no('The opponent rolls the Terminal\'s dice, not the squad accessing it (ruling I25).');
      return ok;
    }
    case 'placeSmoke': {
      const { col, row } = cmd.at;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= gridsOf(state) || row >= gridsOf(state)) return no('That is not a Grid.');
      // One screen per squad per Grid: a second one of the same squad's would
      // be the same screen twice, and dissipation would take them one at a
      // time (audit Phase 4, G6). Both squads may still share a Grid.
      const owner = cmd.for ?? cmd.seat;
      if ((state.smoke ?? []).some((x) => x.col === col && x.row === row && x.side === owner)) {
        return no('That squad already has a Smoke Screen in that Grid.');
      }
      return ok;
    }
    case 'setEnvironment': {
      const { col, row } = cmd.at;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0
        || col >= gridsOf(state) || row >= gridsOf(state)) return no('That is not a Grid.');
      if (cmd.card !== null && !data.environments.cards.some((e) => e.id === cmd.card)) {
        return no('That is not an Environment Card.');
      }
      // 5.4.1 places them while the battlefield is set up, so a game already
      // past its setup refuses new cards. Clearing stays legal at any time:
      // the Fragile Platform takes itself off mid-game, and a table mirroring
      // that by hand must not be told no.
      // Before deployment: a card could go down under units already placed
      // (audit Phase 6, A7).
      const su = normaliseSetup(state.setup);
      if (cmd.card !== null && su && (su.stage === 'deploy' || su.stage === 'done')) {
        return no('Environment Cards are placed while the battlefield is set up (5.4.1), before anything deploys.');
      }
      // NO PER-CARD LIMIT. A "one of each" refusal used to live here and it was
      // INVENTED: nothing in 5.4.1, on the cards, or in the component lists says
      // how many copies of an Environment Card the box holds, and a scan folder
      // holding one picture of each is a scan folder, not a component count.
      // The only limit anyone can cite is the number printed on the Battlefield
      // Card, which is the cap checked below.
      const here = (state.environments ?? []).some((e) => e.col === col && e.row === row);
      // Clearing a Grid, and replacing the card on one, are both always legal:
      // neither puts another card on the table.
      if (cmd.card === null || here) return ok;
      const cap = environmentAllowance(data, state);
      if ((state.environments ?? []).length >= cap) {
        return no(`This battlefield takes ${cap} Environment Cards and already has ${cap}.`);
      }
      return ok;
    }
    case 'queueReactions': {
      if (!state.script) return no('There is no guided game running.');
      if (!Array.isArray(cmd.items)) return no('That is not a list of reactions.');
      for (const it of cmd.items) {
        // Checked field by field, like a loaded script's: the counts are
        // printed straight into the defender's panel.
        if (!it || typeof it.uid !== 'number' || typeof it.actionId !== 'string'
          || !Number.isFinite(it.count) || !Number.isFinite(it.range)) return no('That reaction is not well formed.');
        const who = state.tokens.find((x) => x.uid === it.uid);
        if (!who) return no('That unit is not on the board.');
        // A Shutdown defender owes no reaction: each is its own Passive or
        // Action (4.1, FAQ L3; audit Phase 2, A4).
        if (who.kind === 'mech' && who.stance === 'shutdown') return no(`${who.label} is in Shutdown Stance, so it takes no reaction (4.1).`);
        // A Target Tracing debt has to name the attacker: the Counter-roll it
        // opens is against them and nobody else.
        if (it.kind === 'trace' && !state.tokens.some((x) => x.uid === it.fromUid)) return no('That attacker is not on the board.');
      }
      return ok;
    }
    case 'removeSmoke': {
      if (!(state.smoke ?? []).some((x) => x.col === cmd.at.col && x.row === cmd.at.row && (cmd.side === undefined || x.side === cmd.side))) {
        return no(cmd.side === undefined ? 'There is no Smoke Screen there.' : 'That squad has no Smoke Screen there.');
      }
      return ok;
    }
    case 'dissipateSmoke':
      // Once per End Phase (4.16, p.77; audit Phase 4, G7).
      if (state.smokeRound === state.round.n) return no('The Smoke Screens have already dissipated in this End Phase (4.16).');
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
  // EVERY Tactical Zone on the battlefield, not only the ones the Main Task
  // uses. The board prints all nine (Alpha to India, 5.2) whatever the Main
  // Task, and Excavation Claim reads "you designate one Tactical Zone". This
  // used to be filtered to the Main Task's own zones, so with no Main Task yet,
  // or with VIP: Assassination (which places none), the list came up EMPTY and
  // the Task could not be aimed at all.
  //
  // The TABLE's zones, exactly as zoneCells reads them a few lines above: an
  // authored map's zones carry its own ids, and offering the shipped ones here
  // made a designation name a zone that neither scoring nor the board can find.
  // Spelled out rather than importing zonesOf for the same reason zoneCells is:
  // ~25 test slices compile this module standalone and strip its imports.
  const own = state.zones;
  const list = own && own.length ? own : (data.zoneData?.zones ?? []);
  return list.map((z) => ({ id: z.id, name: z.name }));
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
      if (a.type === 'Moving') reach = Math.max(reach, (a.range ?? 0) + straightLineBonus(a));
    }
  }
  for (const { card } of loanedParts(data, state.tokens, t)) {
    for (const a of card.actions ?? []) {
      if (a.type === 'Moving') reach = Math.max(reach, (a.range ?? 0) + straightLineBonus(a));
    }
  }
  return reach;
}

// The farthest one recorded Movement may carry a unit, as a CEILING only (ruled
// 2026-09-25, audit Phase 4, I10 and E8): a 9-Grid Maneuver on a Maneuver Value
// of 1 passed. The same allowance both planners draw with, and every step of a
// route is one orthogonal Grid (the crushSwap bound below says why), so no
// route either page can offer lands further from its start than this.
//   - A Maneuver, granted or not, moves at the Maneuver Value, which is 0 on a
//     destroyed Chassis: a turn on the spot is all it can record (FAQ E4).
//   - A Movement Action at its own Range, or the Maneuver Value when it prints
//     none (`action.range || maneuverRange`), plus a straight run's bonus.
//   - A Shock Attack walk at its X: "may additionally move up to X spaces"
//     (Supplementary Rules 1.04, 3.8). This used to take the larger of X and
//     the Maneuver Value, so a Shock Attack 1 walked a Mech's full Maneuver.
//   - Any other Action's Movement, or a Stance Change's, at the Maneuver Value.
function movementCeiling(data: GameData, state: GameState, t: Token, a: CardAction | null): number {
  const base = maneuverRange(data, t);
  if (!a) return base;
  if (a.type === 'Moving') return (a.range || base) + straightLineBonus(a);
  const o = oppOf(state, t.uid);
  const x = shockAttackOf(grantAdjusted(a, t, o?.uid === t.uid ? o : null));
  return x > 0 ? x : base;
}

// Whether `then` would be accepted once `first` has landed. The pages ask a
// Counter-roll's target before they pay its Action, so a refused target costs
// nothing, and the Counter-roll check asks that the Action be paid (ruled R2;
// audit Phase 7, P7C 2): the target is judged on a copy of the table with the
// payment made. A `first` the table refuses is not applied, and `then` is
// judged as the table stands.
export function checkAfter(data: GameData, state: GameState, first: Command, then: Command): CheckResult {
  if (!check(data, state, first).ok) return check(data, state, then);
  const next = JSON.parse(JSON.stringify(state)) as GameState;
  apply(data, next, first);
  return check(data, next, then);
}

export function check(data: GameData, state: GameState, cmd: Command): CheckResult {
  if (tableLevel(cmd)) return checkTable(data, state, cmd);
  const t = state.tokens.find((x) => x.uid === cmd.uid);
  if (!actorOptional(cmd)) {
    if (!t) return no('That unit is not on the board.');
    // The one exception: The Red Shoes' controller makes the 4.3.6 exchange of
    // the unit it is steering, since that unit's own player never makes this
    // Movement (ruling I5). The debt is the proof, and the exchange is judged
    // against the crusher like any other (ruled R1; audit Phase 7, P7D 1).
    const steering = cmd.kind === 'crushSwap' && !!controlOver(state, t.uid, cmd.seat);
    if (t.side !== cmd.seat && !steering) return no(`${t.label} belongs to the other squad, and a player may only command their own units.`);
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
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
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
      // The general rule the Barricade clause is one case of: "Units that
      // cannot move, such as Deployables, … cannot be subject to Forced
      // Movement" (4.3.4). Knockback moved Beacons and Mines, and the Harpy's
      // tow carried a player's own Mine (audit Phase 4, B2).
      if ((col !== target.col || row !== target.row) && !canBeForceMoved(data, target)) {
        return no(`${target.label} cannot move, so it cannot be subject to Forced Movement (4.3.4).`);
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
      // Where the bearer stands, after any Forced Movement of the attack (FAQ
      // E19), or its base as the Penetration found it once the same attack
      // has taken it off the board (audit Phase 6, F1).
      const base = bearer ? { col: bearer.col, row: bearer.row, size: bearer.size } : box.dropFrom;
      if (!base) return no('Whatever was carrying that Black Box has left the board.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
        return no('That is not a place on the board.');
      }
      // A table with no board places the model itself.
      if (!state.noBoard) {
        // Only a drop a Penetration owes (5.3.1, P3). Nothing else puts a
        // carried Box down, and a bearer's own player could drop one beside
        // it at any time (audit Phase 6, F6).
        if (!box.dropFrom) return no('A carried Black Box is dropped when its bearer is Penetrated (5.3.1), and no Penetration owes this one.');
        // In Contact with the base, edge to edge, never under it and never on
        // terrain (4.2.3, FAQ P9; ruling I24). The bearer's own Grid and all
        // eight around it were accepted, diagonals and buildings included.
        if (!boxDropCells(base, knownTerrain(data, state) ?? [], cellsOf(state)).some((x) => x.col === col && x.row === row)) {
          return no(`A dropped Black Box lands in a Small Grid in Contact with ${bearer?.label ?? 'the bearer'}'s base, edge to edge, and not on terrain (5.3.1, FAQ P9).`);
        }
      }
      return ok;
    }
  }
}

// Whether this unit's Remote Access may reach this Terminal now, or why not:
// the access itself, and the Counter-roll a Remote Access opens against the
// Terminal, answer to the one reading.
// The success of a Remote Access: a Mech's Common Action, performed with the
// Torso at Range 4, in its own Opportunity (p.87). Only the item was asked, so
// a Drone, a Shutdown Mech, a Mech 10 Grids away and an access in the End
// Phase with nothing performed were all accepted (audit Phase 6, E2).
function terminalAccessWhy(data: GameData, state: GameState, t: Token, itemId: string): string | null {
  const item = normaliseTasks(state.tasks).items.find((i) => i.id === itemId);
  if (!item || item.kind !== 'terminal') return 'That is not a Terminal.';
  // Once per round each, and the End Phase flips them all back (5.3.3).
  if (item.accessed) return 'That Terminal has already been accessed this round (5.3.3).';
  if (t.kind !== 'mech') return `${t.label} is not a Mech: Remote Access is a Mech's Common Action (p.87).`;
  if (t.stance === 'shutdown') return 'A Mech in Shutdown Stance cannot Maneuver or perform any Action other than Reboot (4.1.1).';
  const ra = findAction(data, state, t.uid, 'COMMON_REMOTE_ACCESS');
  if (!ra) return `${t.label} has no Remote Access.`;
  const partWhy = actionPartWhy(data, t, ra);
  if (partWhy) return partWhy;
  // To the NEAREST Grid of the zone (FAQ P6). The printed Range: neither a
  // Repeater nor KeyHole reaches it (FAQ P12).
  if (!state.noBoard) {
    const reach = ra.range ?? 4;
    const d = rangeToZone(t, zoneCells(data, state)(item.zone));
    if (d === null || d > reach) return `That Terminal's Tactical Zone is ${d ?? '?'} Grids from ${t.label}, and Remote Access reaches Range ${reach} (p.87).`;
  }
  if (state.script && normaliseSetup(state.setup)?.stage === 'done') {
    const o = state.script.opp;
    if (!o || o.uid !== t.uid) return `Remote Access is performed in ${t.label}'s own Action Opportunity (p.87).`;
    if (!o.performed.some((k) => actionIdOf(k) === 'COMMON_REMOTE_ACCESS')) {
      return 'Perform the Remote Access Action first: the Terminal is accessed when its Counter-roll succeeds (p.87).';
    }
  }
  return null;
}

function checkActed(
  data: GameData,
  state: GameState,
  cmd: Exclude<Command, { kind: 'forceMove' | 'recordKill' | 'destroyTerrain' | 'resolveIntercept' | 'dropBlackBox' | 'drainLink' | TableKind }>,
  t: Token,
): CheckResult {
  switch (cmd.kind) {
    case 'overwatch': {
      // "Designate 1 Enemy Unit within range as the target, allow 1 Ally Mech
      // to immediately perform 1 Firing Action against it. Then remove this
      // Drone." The Mech's Action is granted on the Riposte pattern, any
      // length (FAQ K15; audit Phase 5, F8).
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a || !overwatchOf(a)) return no('That Action calls no Overwatch Strike.');
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target || target.side === t.side || !alive(target) || target.deployed === false) return no('Overwatch Strike designates an Enemy Unit.');
      if (!state.noBoard && rangeBetween(t, target).range > (a.range ?? 0)) return no(`${target.label} is out of ${t.label}'s Range.`);
      const mech = state.tokens.find((x) => x.uid === cmd.mechUid);
      if (!mech || mech.kind !== 'mech' || mech.side !== t.side || !alive(mech)) return no('Overwatch Strike lets an Ally Mech fire.');
      if (mech.stance === 'shutdown') return no(`${mech.label} is in Shutdown Stance, so it performs nothing (4.1.1).`);
      if (guidedGame(state) && strictNow(state) && !oppOf(state, cmd.uid)) return no(`${t.label} does not hold an activation, so it calls no strike now.`);
      return ok;
    }
    case 'setTiming': {
      if (t.kind !== 'mech') return no('Only a Mech has a Timing Dial. Drones act in the Command and Automatic Phases instead.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech cannot set a dial.');
      if (cmd.timing !== undefined && !TIMINGS.some((x) => x.id === cmd.timing)) return no('That is not a Timing the dial can be set to.');
      if (state.round.phase !== 1) return no('Dials are set in the Planning Phase (3.3).');
      if (dialHidden(state, t)) return no('In pass-and-play a squad sets its dials on its own planning turn (3.3).');
      return ok;
    }
    case 'placeInGrid': {
      if (state.noBoard) return no('This table has no board to place a unit in.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
        return no('That is not a place on the board.');
      }
      if (t.size >= 3) return no('A Large unit fills its whole Grid, so there is nowhere else to stand in it.');
      if (Math.floor(col / 3) !== Math.floor(t.col / 3) || Math.floor(row / 3) !== Math.floor(t.row / 3)) {
        return no('This only shifts a unit inside the Grid it is already in. Moving between Grids is a Maneuver.');
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
    case 'renameUnit': {
      const label = typeof cmd.label === 'string' ? cleanName(cmd.label) : '';
      if (!label) return no('A unit needs a name.');
      if (label.length > 40) return no('That name is too long to fit on a sheet (40 characters).');
      return ok;
    }
    case 'setLoad': {
      if (t.kind !== 'drone') return no('Only a Drone carries a Load.');
      const own = data.byId.get(t.cardId);
      if (!own || !isCarrier(own)) return no(`${t.label} cannot carry a Load.`);
      // A scripted game fixes the squad at setup; a free table swaps at will.
      if (normaliseSetup(state.setup)) return no('A Load is part of the squad and is fixed once a game is set up.');
      if (cmd.cardId !== undefined) {
        const load = data.byId.get(cmd.cardId);
        if (!load || load.category !== 'mech_part' || !canBeLoad(load)) return no('That card cannot be carried as a Load.');
      }
      return ok;
    }
    case 'setFreeTicks': {
      // A guided game counts the same Ticks on script.opp and refuses what does
      // not fit, so a hand mark there would be a second, disagreeing count.
      if (guidedGame(state)) return no('In a guided game the Ticks are counted as each Action is performed.');
      if (t.kind !== 'mech') return no('Only a Mech spends Ticks (3.4.5). A Drone\'s activation is one Action or one Movement.');
      if (cmd.ticks !== null && !normaliseFreeTicks(cmd.ticks)) return no('That is not a record of Ticks.');
      return ok;
    }
    case 'setStance': {
      if (t.kind !== 'mech') return no('Only a Mech chooses a Stance. A Drone plays the one printed on its card.');
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech has no Stance to change.');
      if (!STANCES.includes(cmd.stance)) return no('That is not a Stance.');
      if (t.stance === 'shutdown' && cmd.stance !== 'shutdown') {
        return no('Leaving Shutdown Stance takes a Reboot, which costs the Action Opportunity (4.1.1).');
      }
      // Nor can it be chosen: "you may change its Stance to Defensive Stance,
      // Mobility Stance or Offensive Stance" (3.4.2). A Mech reaches Shutdown
      // at 0 Link or by a card that forces it, and those carry their own
      // commands (drainLink, forceShutdown).
      if (cmd.stance === 'shutdown' && t.stance !== 'shutdown') {
        return no('Shutdown is not a Stance a Mech chooses. It falls into it at 0 Link (3.4.2, 4.1).');
      }
      // Cruise Mode: "no other stance may be selected" (Collab additional
      // rules). The transform itself puts the Mech in Mobility.
      if (cruising(data, t) && cmd.stance !== 'mobility' && cmd.stance !== t.stance) {
        return no(`${t.label} is in Cruise Mode, where no Stance but Mobility may be selected (Ace Strategy additional rules).`);
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
      // Once a guided game is running, a Mech that does not hold the open
      // Action Phase Opportunity has no Stance choice to make (3.4.2, 4.1):
      // deployment sets it through deployUnit, and Suppression, Provoke, the
      // Tactics Cards, Barricade and Stance feedback carry their own commands.
      // This used to hold online only, so one-device guided play let a Stance
      // change at any time, and the RWS activation a Command buys in the
      // Command Phase (an Opportunity, but not an Action Opportunity) drew a
      // Stance row that never locked (audit Phase 2, A6/A7).
      if (state.script && normaliseSetup(state.setup)?.stage === 'done' && cmd.stance !== t.stance
        && (!so || PHASES[state.round.phase] !== 'Action')) {
        return no('A Mech chooses its Stance at the start of its own Action Opportunity (3.4.2, 4.1).');
      }
      return ok;
    }
    case 'firewatch': {
      if (!firewatchOn(data, t)) return no(`${t.label}'s pilot has no Firewatch, or the Mech is Shut Down and triggers no pilot skill (FAQ L3).`);
      // "When this Mech gains Action Opportunity": once each, and on a strict
      // table as it opens, before the Mech Maneuvers or performs anything. A
      // free table records what the table did.
      if (guidedGame(state) || state.script?.opp) {
        const o = oppOf(state, cmd.uid);
        if (!o) return no(`${t.label} takes Firewatch as it gains an Action Opportunity, and it does not hold one.`);
        if (o.firewatch) return no('Firewatch has already been taken this Action Opportunity.');
        if (strictNow(state) && (o.maneuvered || o.performed.length > 0)) return no(`Firewatch is taken as ${t.label} gains its Action Opportunity, before it Maneuvers or performs anything.`);
      }
      if ((t.link ?? 0) < 2) return no('Firewatch consumes 1 Link, and the last Link can never be spent voluntarily (4.10).');
      return ok;
    }
    case 'stanceFeedback': {
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a || !stanceFeedbackOf(a)) return no('That Action does not switch an ally\'s Stance.');
      // Performed in the Drone's own activation, when a game is running.
      if (guidedGame(state) && !oppOf(state, cmd.uid)) return no('It is not this unit\'s activation.');
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (!STANCES.includes(cmd.stance) || cmd.stance === 'shutdown') return no('Stance feedback switches to Defensive, Mobility or Offensive Stance.');
      if (!stanceFeedbackTargets(data, state.tokens, t, a, !!state.noBoard).some((x) => x.uid === target.uid)) {
        return no(`${target.label} is not an Ally Mech within Range that Stance feedback can reach: it must be standing, not in Shutdown Stance, and not in Cruise Mode.`);
      }
      if (target.stance === cmd.stance) return no(`${target.label} is already in that Stance.`);
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
      if (t.partStates.torso === 'destroyed') return no('A destroyed Mech cannot Reboot.');
      if (!STANCES.includes(cmd.stance) || cmd.stance === 'shutdown') return no('A Reboot ends in one of the three active Stances.');
      // A Shutdown is Cruise Mode's one exception ("system failures"), and in
      // Cruise Mode only Mobility may be selected, so it Reboots into it (D3).
      if (cruising(data, t) && cmd.stance !== 'mobility') return no(`${t.label} is in Cruise Mode, so it Reboots into Mobility Stance, the only one it may select.`);
      const why = rebootWhy(state, t);
      return why ? no(why) : ok;
    }
    case 'maneuver': {
      // SHUTDOWN (4.1.1): "it cannot Maneuver or perform any Actions other than
      // Reboot." Both panels used to draw the Maneuver row live for a Shutdown
      // Mech, and nothing here refused the walk.
      if (t.kind === 'mech' && t.stance === 'shutdown') return no('A Mech in Shutdown Stance cannot Maneuver or perform any Action other than Reboot (4.1.1).');
      // RWS: a Command sent to a Mech buys the autocannon's shot and nothing
      // else (遥控武器) - a Mech's Movement belongs to its Action Opportunity.
      if (t.kind === 'mech' && PHASES[state.round.phase] === 'Command' && oppOf(state, cmd.uid)) {
        return no('A Mech commanded through RWS fires that Part and does not move (遥控武器); it Maneuvers in its own Action Opportunity.');
      }
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
      // OBSTRUCT's "or 1 Link" (LPA-20): Link the route spent instead of
      // Range. The route is the sender's to price; what this reader can hold
      // is the floor, which is the rule's own (never the last Link, 4.10 and
      // FAQ L1, after whatever the Action itself costs; audit Phase 4, D2).
      if (cmd.breakAwayLink !== undefined) {
        const n = cmd.breakAwayLink;
        if (!Number.isInteger(n) || n < 0) return no('That is not an amount of Link.');
        if (n > 0 && t.kind !== 'mech') return no(`${t.label} has no Link to pay a Break Away with.`);
        const spare = (t.link ?? 0) - 1 - nonHumanoidCost(moveAction);
        if (n > spare) return no(`${t.label} cannot pay ${n} Link to Break Away: a Mech never spends its last Link (4.10, FAQ L1).`);
      }
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
        return no('That is not a place on the board.');
      }
      if (cmd.halt !== undefined && (!Number.isInteger(cmd.halt) || cmd.halt < 0)) return no('That is not a number of Grids.');
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
        if (!Number.isInteger(fc) || !Number.isInteger(fr) || fc < 0 || fr < 0 || fc >= cellsOf(state) || fr >= cellsOf(state)) {
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
      const leash = state.noBoard ? null : tetherCap(t, state.tokens);
      if (leash && !leash(Math.floor(col / 3), Math.floor(row / 3))) {
        const x = (t.tether ?? []).filter((l) => l.role === 'tethered')[0]?.range ?? 0;
        return no(`${t.label} is Tethered and cannot voluntarily move beyond ${x} Grids of the unit holding it (PDLH-202).`);
      }
      // A Movement Action is still one after it is paid: a destroyed Chassis
      // performs none but a Crawl (4.3.4; ruled 2026-09-25, audit Phase 4, I10;
      // ruled R1, audit Phase 7, P7B 3).
      if (moveAction?.type === 'Moving') {
        const chassis = chassisStop(t, moveAction);
        if (chassis) return no(chassis);
      }
      // Shock Attack X's move needs the Chassis: "Mechs require a chasis to
      // perform this Action", 冲锋X "does not take effect when the Mech's lower
      // limbs are destroyed". The pages held it and this did not, so a stale
      // or hostile peer walked a Mech with no legs (audit Phase 7, P7B 10). A
      // Repaired Chassis carries it (ruled R5). Immobilized stops it above (R6).
      if (cmd.free && moveAction && moveAction.type !== 'Moving' && t.kind === 'mech' && !shockMoveAllowed(t)) {
        const o0 = oppOf(state, t.uid);
        if (shockAttackOf(grantAdjusted(moveAction, t, o0 ?? null)) > 0) {
          return no(`${t.label}'s Chassis is destroyed, so it cannot make the move of Shock Attack: a Mech needs its Chassis for it (6.2.1).`);
        }
      }
      // The Crawl "Cannot be used to Break Away" (6.1): it never takes a Mech
      // out of a Grid in which it is Melee Locked, walked or flown (ruled R2;
      // audit Phase 7, P7B 14). Judged on the terrain the engine knows, from
      // where the Mech stands; a table with no board judges it itself.
      if (moveAction?.id === 'COMMON_CRAWL' && !state.noBoard && !cmd.from
        && (Math.floor(col / 3) !== Math.floor(t.col / 3) || Math.floor(row / 3) !== Math.floor(t.row / 3))) {
        const terrain = knownTerrain(data, state);
        const held = terrain ? crawlHolders(data, t, moveAction, state.tokens, terrain) : [];
        if (held.length) return no(`${t.label} is Melee Locked by ${held.map((x) => x.label).join(', ')}, and a Crawl cannot be used to Break Away (6.1): it may only turn in its Grid.`);
      }
      // HOW FAR, measured from where the unit stands, which is where every
      // Movement either page sends begins. Not for a table, which has no
      // distances, nor for the one sender that has already placed the unit
      // (`from`, the Crush exchange), for the reason given above. Asked last,
      // after whose turn and which phase it is, so a Movement that may not be
      // made at all is told why rather than how far.
      const tooFar = ((): string | null => {
        if (state.noBoard || cmd.from) return null;
        const crossed = Math.abs(Math.floor(col / 3) - Math.floor(t.col / 3)) + Math.abs(Math.floor(row / 3) - Math.floor(t.row / 3));
        const reach = movementCeiling(data, state, t, moveAction ?? null);
        // A Mine's stop keeps back no more than the Movement had (C1).
        if (crossed <= reach && cmd.halt && crossed + cmd.halt > reach) {
          return `${t.label} has ${reach - crossed} Grid${reach - crossed === 1 ? '' : 's'} of this Movement left, not ${cmd.halt}.`;
        }
        if (crossed <= reach) return null;
        return reach > 0
          ? `${t.label} can move at most ${reach} Grid${reach === 1 ? '' : 's'} with this Movement, and that Grid is ${crossed} away.`
          : `${t.label} cannot move with this Movement: it may only change its facing (FAQ E4).`;
      })();
      // A Movement a card handed out belongs to the card, not to an Action
      // Opportunity: Hit and Run moves a Mech as its Opportunity ends, when
      // there is no longer one to check against or to charge. It has to have
      // been handed out, though: playTactic leaves the grant for this unit, and
      // the move takes it. The flag used to authorise itself - during the
      // enemy's turn, in the Command Phase (audit Phase 2, B8).
      if (cmd.granted) {
        if (guidedGame(state) && !(state.script?.oncePerRound ?? []).includes(grantedMoveKey(state, cmd.uid))) {
          return no('Nothing has granted this unit a Movement: a card such as Hit and Run hands one out, and it is made then.');
        }
        return tooFar ? no(tooFar) : ok;
      }
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
        if (o.commandOnly) return no('Additional Instructions buys a Command Action, not a Move (ruling I7).');
      }
      // The rest of a Movement a Mine stopped (ruling I16): within the Grids it
      // had left, never on a destroyed Chassis, and on the Tick already paid
      // for it (audit Phase 5, C1).
      if (cmd.resume) {
        const left = o.mineHalt ?? 0;
        if (left <= 0) return no('No Mine stopped this unit\'s Movement, so there is nothing to go on with.');
        // The blast first: "The unit stops and the blast resolves; then the
        // unit goes on" (ruling I16, M19). Going on while it was still owed
        // walked the unit out of the Mine's Grid, and the blast then caught
        // nobody (ruled R4; audit Phase 7, P7D 4).
        if (minesOwed(data, state.tokens).some((x) => x.victims.includes(t.uid))) {
          return no(`A Mine's blast is still owed on ${t.label}: it resolves first, then the Movement goes on (M19).`);
        }
        const stop = chassisStop(t);
        if (stop) return no(stop);
        if (!state.noBoard) {
          const crossed = Math.abs(Math.floor(col / 3) - Math.floor(t.col / 3)) + Math.abs(Math.floor(row / 3) - Math.floor(t.row / 3));
          if (crossed > left) return no(`${t.label} has ${left} Grid${left === 1 ? '' : 's'} of that Movement left, and that Grid is ${crossed} away.`);
          if (cmd.halt && crossed + cmd.halt > left) return no(`${t.label} has ${left - crossed} Grid${left - crossed === 1 ? '' : 's'} of that Movement left, not ${cmd.halt}.`);
        }
        return ok;
      }
      // A free move rides on an Action already performed that carries a
      // Movement, and takes it: one Movement per such Action. It used to ride
      // on ANY performed Action, any number of times (audit Phase 2, B8).
      if (cmd.free) {
        if (!o.performed.length) return no('No Action has been performed this Opportunity, so there is nothing to move with.');
        if (!o.moveOwed) return no('The Action performed this Opportunity has no Movement left to make: a Moving Action, a Shock Attack or a Stance Change moves once.');
        return tooFar ? no(tooFar) : ok;
      }
      const tick = canManeuver(o);
      if (!tick.ok) return fromVerdict(tick);
      return tooFar ? no(tooFar) : ok;
    }
    case 'crushSwap': {
      if (state.noBoard) return no('This table has no board: settle the Crush on the table and record its Penetrations.');
      // 4.3.6: the crushed Unit with nowhere to go exchanges positions with the
      // Crushing Unit. The geometry stays with the caller — rules.ts
      // crushExchange is the one place it is worked out, and both pages call it
      // — so this covers what a stale networked client could still get wrong.
      if (!cmd.swaps.length) return no('A Crush exchange has to name the Unit being exchanged.');
      // The Red Shoes' one exchange: 4.3.6 ends the Movement in the Crush, so
      // a debt the controller's exchange has stamped makes no second one (ruled
      // R1; audit Phase 7, P7D 1). A chained exchange walked the steered unit
      // one Grid further on each time.
      if (t.side !== cmd.seat && controlOver(state, t.uid, cmd.seat)?.placed) {
        return no(`${t.label}'s Movement under The Red Shoes has already ended in its Crush (4.3.6).`);
      }
      for (const p of [cmd.to, ...cmd.swaps.map((s) => s.to)]) {
        if (!Number.isInteger(p.col) || !Number.isInteger(p.row) || p.col < 0 || p.row < 0 || p.col >= cellsOf(state) || p.row >= cellsOf(state)) {
          return no('That is not a place on the board.');
        }
      }
      // Only a Large Ground Unit Crushes, and only Units no larger than itself
      // (4.3.6; LPA-23 Onyx is the trait that lets the two be equal, so this
      // refuses LARGER and not merely equal). Flying cannot Crush at all (FAQ
      // E14) and neither can an Aerial Unit, which passes overhead.
      if (t.size !== 3 || !isGroundUnit(data, t)) return no('Only a Large Ground Unit Crushes (4.3.6).');
      // Nor does a camouflaged one (FAQ I3, I9): crushTargets refused it, this
      // did not (audit Phase 4, C5).
      if (statusCount(t.statuses, 'camouflage') > 0) return no(`${t.label} is in Optical Camouflage, and a camouflaged Unit cannot Crush (FAQ I3).`);
      const swapped: Token[] = [];
      for (const s of cmd.swaps) {
        const v = state.tokens.find((x) => x.uid === s.uid);
        if (!v) return no('That target is not on the board.');
        // An Aerial Unit occupies no Grid, so it is never Crushed (2.2.1).
        if (v.aerial) return no(`${v.label} is an Aerial Unit, which occupies no Grid, so it cannot be Crushed.`);
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
      // The Common Actions are a Mech's (3.4.3: "all Mechs have access to" them).
      // findAction falls back to them for any unit, so a Drone took a Punch, a
      // Crawl or a Stabilize, and a Projectile a Punch (audit Phase 7, P7B 11).
      if (t.kind !== 'mech' && (data.commonActions ?? []).some((c) => c.id === a.id)) {
        return no(`${a.name?.en || a.id} is a Common Action, and only a Mech has those (3.4.3).`);
      }
      if (t.kind === 'mech' && t.stance === 'shutdown') return no('A Mech in Shutdown Stance cannot Maneuver or perform any Action other than Reboot (4.1.1).');
      // The Charge and the Discard act on the Part that performs them, and the
      // Action's own apply Charges it or turns it over, so a guided game names
      // that Part (`id@slot`; ruled R2, audit Phase 7, P7A 2, 7).
      if ((a.id === 'COMMON_CHARGE' || a.id === 'COMMON_DISCARD') && guidedGame(state) && !cmd.partKey?.startsWith(`${a.id}@`)) {
        return no(`Name the Part that performs ${a.name?.en || a.id}: it acts on that one Part (FAQ H7, K5).`);
      }
      // Initiated through a Part that can still act (3.4.3), the Common Actions
      // included, and only the Torso in Cruise Mode.
      const partWhy = actionPartWhy(data, t, a, cmd.partKey, true);
      if (partWhy) return no(partWhy);
      // A unit's own Charge Action (543_B) turns its token face-up in its apply
      // as the Common Charge does, so a Charged one has nothing to Charge (FAQ H1).
      const ownCharge = a.id !== 'COMMON_CHARGE' ? chargeSlotOf(data, t, a, cmd.partKey) : null;
      if (ownCharge && (t.charge ?? []).includes(ownCharge)) {
        return no(`${t.label} is already Charged, and a Charged Action cannot be Charged again until the token is spent (4.14, FAQ H1).`);
      }
      // 4.17 ②: a Throw Action needs a free Freehand Part to designate, and a
      // hand bearing a Black Box is not free (5.3.1; ruled R7, audit Phase 7,
      // P7A 6). A Load lent in Contact may be the hand (FAQ O16).
      const thrown = throwWhy(data, t, a, boxHands(state.tasks, t.uid), loanedParts(data, state.tokens, t, { anywhere: !!state.noBoard }));
      if (thrown) return no(thrown);
      // A lent Action names its Carrier (FAQ O7), and the loan has to be real:
      // a Carrier in Contact holding that Load (FAQ O3; audit Phase 5, G5). A
      // table with no board judges the Contact itself.
      const lender = cmd.partKey && !(data.commonActions ?? []).some((c) => c.id === a.id) ? cmd.partKey.split('@')[1] : undefined;
      if (lender !== undefined && !loanedParts(data, state.tokens, t, { anywhere: !!state.noBoard }).some((l) => String(l.from.uid) === lender && (l.card.actions ?? []).some((x) => x.id === a.id))) {
        return no(`No Carrier in Contact lends ${t.label} that Action (FAQ O3).`);
      }
      // 4.13: an Action whose Ammo Tokens are all spent cannot be performed.
      // ammoPay, so an empty Pod may still draw on an Ammunition Pack (086_B).
      if (spendsAmmoWhenPerformed(a)) {
        const { from, poolId } = ammoPay(data, state, t, a.id);
        const held = from.ammo?.[poolId];
        if (held !== undefined && held < 1) return no(`No Ammo Tokens left for ${a.name?.en || a.id}, so it cannot be performed (4.13).`);
      }
      // A self-applied Token (Ambush, Amplify Profile) the unit already wears
      // is a change the Action cannot make (6.1; FAQ J1 for a second Ambush).
      const selfGrant = selfStatusGrant(a);
      if (selfGrant) {
        const why = selfGrantWhy(t, selfGrant);
        if (why) return no(why);
      }
      // So is a Remote Access with nothing it could access: no Terminal on the
      // table, or none in reach still face-up (J8's principle; ruling I26;
      // audit Phase 6, E3).
      if (a.id === 'COMMON_REMOTE_ACCESS') {
        const why = remoteAccessWhy(normaliseTasks(state.tasks).items, t, a.range ?? 4, state.noBoard ? null : zoneCells(data, state));
        if (why) return no(why);
        // Its roll is a Counter-roll the Mech Initiates, which Electronic
        // Value 0 cannot do (4.11.2): refused here, before the Tick is paid.
        if (electronicValue(data, t, loanedParts(data, state.tokens, t)) <= 0) return no(`${t.label} has an Electronic Value of 0, so it cannot Initiate the Counter-roll a Remote Access makes (4.11.2).`);
      }
      // As is |Reveal| out of the Optical Camouflage State, and a Scan with no
      // enemy anywhere on the table in the State or bearing a Low Profile
      // Token: p.31 (Note 2) and FAQ H2/J8, in the words their greyed rows
      // give. Only the pages refused them (audit Phase 7, P7C 8).
      if (a.id === 'COMMON_REVEAL' || isScanAction(a)) {
        const idle = actionIdleWhy(data, t, a, { tokens: state.tokens, noBoard: !!state.noBoard });
        if (idle) return no(idle);
      }
      // Movement Actions (6.3.2, 4.3.4): Immobilized stops them unless the
      // Action is Unstoppable, and so does a destroyed Chassis, whichever Part
      // prints them (ruled 2026-09-25, audit Phase 4, E7 and I10). Only the
      // pages asked, and the strict guide let an Immobilized Taurus Blink. The
      // Crawl is the exception an arm makes (ruled R1; audit Phase 7, P7B 3).
      if (a.type === 'Moving') {
        const stop = immobilizedStop(t, a) ?? chassisStop(t, a);
        if (stop) return no(stop);
      }
      // Non-humanoid X: "When performing this Action, -X Link Value", and a
      // Mech never spends its last Link (4.10, FAQ L1). The same reading the
      // move doors ask; pad Guided performs the Run with this command alone
      // (audit Phase 4, E2).
      const shortLink = t.kind === 'mech' ? nonHumanoidStop(t, a) : null;
      if (shortLink) return no(shortLink);
      // Melee Lock bans Firing Actions, Melee Firing excepted (4.3.5). Only the
      // action lists enforced it (audit Phase 4, D6). Judged on the terrain the
      // engine knows; a player's own custom map is left to the page.
      if (a.type === 'Firing' && !isMeleeFiring(a) && !state.noBoard) {
        const terrain = knownTerrain(data, state);
        const lockers = terrain ? lockersOf(data, t, state.tokens, terrain) : [];
        if (lockers.length) {
          return no(`${t.label} is Melee Locked by ${lockers.map((o) => o.label).join(', ')}, so it cannot perform Firing Actions except those with Melee Firing (4.3.5).`);
        }
      }
      // Fire Control Interference: "cannot perform Firing Actions or
      // Interception" (6.3.2, FAQ J5). Only the lists refused it, and the
      // granted and RWS doors below return before any later gate (audit
      // Phase 6, C2).
      if (a.type === 'Firing' && statusCount(t.statuses, 'fci') > 0) {
        return no(`${t.label} bears a Fire Control Interference Token, so it cannot perform Firing Actions (6.3.2, FAQ J5).`);
      }
      // RWS (遥控武器, FAQ A20/A22): the only Action a Mech performs in the
      // Command Phase is the autocannon a Command was sent for. It costs the
      // activation the Command bought, not Ticks - there is no Opportunity of
      // Ticks in this phase - and each Part fires once per round.
      // A granted Action is no RWS one: the KK9's Overwatch Strike hands a
      // Mech its Firing Action in this phase (audit Phase 5, F8).
      if (t.kind === 'mech' && PHASES[state.round.phase] === 'Command' && state.script && !cmd.granted) {
        const o = oppOf(state, cmd.uid);
        if (!o) return no('It is not this Mech\'s activation.');
        if (!isRwsAction(a)) return no('In the Command Phase a Mech performs only the RWS Action a Command was sent for (遥控武器); its own Action Opportunity comes in the Action Phase.');
        if ((state.script.oncePerRound ?? []).includes(rwsFiredKey(state.round.n, cmd.uid, a.id))) {
          return no('That Part has already fired on a Command this round: an RWS Part receives one Command per round (遥控武器).');
        }
        return fromVerdict(canActivate(o));
      }

      // Riposte (050 / ZHLA-202) is the one Action performed outside an
      // Opportunity, and the grant has to be real: a queued riposte debt for
      // THIS unit is the proof, and it buys a Melee Action and nothing else.
      if (cmd.granted) {
        const debts = (state.script?.reactions ?? []).filter((r) => r.uid === cmd.uid && (r.kind === 'riposte' || r.kind === 'overwatch'));
        if (!debts.length) return no('Nothing has granted this unit an Action outside its Action Opportunity.');
        // A Riposte buys a Melee Action, an Overwatch Strike a Firing one of
        // any length (FAQ K15; audit Phase 5, F8).
        const kind = a.type === 'Melee' ? 'riposte' : a.type === 'Firing' ? 'overwatch' : null;
        if (!kind || !debts.some((r) => r.kind === kind)) {
          return no(debts.some((r) => r.kind === 'riposte') ? 'A Riposte grants a Melee Action (050 / ZHLA-202).' : 'An Overwatch Strike grants a Firing Action (KK9).');
        }
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
          // A Coordination's activation is under the Command Phase's lock in
          // the middle of the Action Phase (audit Phase 5, F1).
          const ph = droneLockPhase(state);
          const why = ph
            ? droneActionWhy(ph, a, { autoActions: riderOnDrone(data, state.tokens, t).autoActions })
            : null;
          if (why) return no(why);
        }
        return fromVerdict(canActivate(o));
      }
      // partKey names which Part the Action came from, so the same Action
      // borrowed from two Tarantulas is two Parts, not one repeated (FAQ O7).
      // The length PAID can depend on the Stance (ZHRA-102_A "[Offensive
      // Stance] This action is considered a Short Action"; audit Phase 2, D2)
      // and on a designated Freehand (card 129), in that order.
      const shaped = stanceShaped(a, t.stance);
      // A Load lent by a Carrier in Contact can be the Freehand (FAQ O16).
      const use = cmd.twoHanded ? twoHandedUse(data, t, shaped, boxHands(state.tasks, t.uid), loanedParts(data, state.tokens, t)) : null;
      if (cmd.twoHanded && !use) return no('[Two-Handed] needs a free hand to designate, and this unit has none for that Action.');
      // FAQ K3: "A Mech affected by Echoes cannot use Echoes again on another
      // Mech during the Action Opportunity gained from Echoes." The guide
      // warned and let a second press through; the pad offered it (audit
      // Phase 2, B1).
      if (o.extra && extraActivationOf(a)) {
        return no(`${t.label} is taking an Extra Action Opportunity, and cannot grant another one inside it (FAQ K3). It may on its own Action Opportunity.`);
      }
      return fromVerdict(canPerform(o, use?.action ?? shaped, cmd.partKey || a.id, startOpts(data, state.tokens, t, a)));
    }
    case 'overload': {
      if (t.kind === 'mech' && t.stance === 'shutdown') return no('A Mech in Shutdown Stance cannot Maneuver or perform any Action other than Reboot (4.1.1).');
      if (!overloadPackOn(data, t)) return no('This Mech has no Overloading Pack it can still use: the Pack is missing or destroyed (3.4.3).');
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this Mech\'s Action Opportunity.');
      return fromVerdict(canOverload(o, t.link ?? 0));
    }
    case 'linkTick': {
      if (t.kind !== 'mech') return no('Only a Mech has a pilot to spend Link.');
      if (t.stance === 'shutdown') return no('A Mech in Shutdown Stance cannot Maneuver or perform any Action other than Reboot (4.1.1).');
      const trait = linkTickTraitOn(data, t);
      if (!trait) return no('This Mech\'s pilot has no trait that trades Link for an Action Tick.');
      const o = oppOf(state, cmd.uid);
      if (!o) return no('It is not this Mech\'s Action Opportunity.');
      // FAQ L2: the Stance comes first, then the declaration.
      if (trait.stance && t.stance !== trait.stance) {
        return no(`${trait.label} works in ${trait.stance.charAt(0).toUpperCase()}${trait.stance.slice(1)} Stance: switch Stance first, then declare it (FAQ L2).`);
      }
      if ((o.linkTicks ?? 0) >= trait.maxLink) return no(`${trait.label} trades at most ${trait.maxLink} Link per Action Opportunity, and it has been spent.`);
      // Any point in the Opportunity, as the publisher's English prints it
      // ("During piloted Mech's Action Opportunity", RDL 1.02) - but never
      // after a Reboot, which leaves "only 1 Action Tick" (4.1.1, FAQ L8). It
      // bought a second one there (audit Phase 2, B2).
      if (rebooted(o)) return no(`After a Reboot ${t.label} has only 1 Action Tick this Action Opportunity (4.1.1, FAQ L8), so ${trait.label} cannot add one.`);
      // A voluntary spend, so the last Link stays (4.10, FAQ L1).
      if ((t.link ?? 0) < 2) return no('This consumes Link, and the last Link can never be spent voluntarily (4.10).');
      return ok;
    }
    case 'attackMode': {
      if (t.kind === 'mech' && t.stance === 'shutdown') return no('A Mech in Shutdown Stance cannot Maneuver or perform any Action other than Reboot (4.1.1).');

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
      // Once used, discarded for the game (FAQ P2; audit Phase 6, H1). The
      // card stays in the hand, since its points were paid for the squad.
      const usedIn = tacticUsedRound(state, cmd.seat, cmd.cardId);
      if (usedIn !== null) return no(`${spec.name} was used in round ${usedIn} and is discarded: a Tactics Card is used once in a game (FAQ P2).`);
      if ((state.tacticsPlayed?.[cmd.seat] ?? []).some((e) => e.startsWith(`${state.round.n}:`))) {
        return no('A squad may play only 1 Tactics Card per round (5.4.2).');
      }
      if (state.script && PHASES[state.round.phase] !== spec.phase) {
        return no(`${spec.name} is played in the ${spec.phase} Phase (${spec.timing.toLowerCase()}), and it is the ${PHASES[state.round.phase]} Phase.`);
      }
      // And at the moment its own text names, in a guided game (5.4.2; audit
      // Phase 6, H2). A free table keeps no Opportunities to judge it by.
      if (state.script && normaliseSetup(state.setup)?.stage === 'done') {
        const w = tacticWindowWhy(spec, state, cmd.seat);
        if (w) return no(w);
      }
      // Additional Instructions comes too late once the squad has passed the
      // Command Phase (FAQ A21; ruling I7; audit Phase 5, F9).
      if (spec.freeCommand && state.script?.passed.includes(cmd.seat)) {
        return no(`Your squad has passed this Command Phase, so ${spec.name} comes too late (FAQ A21).`);
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
      // Nor a Low Value Drone (p.82; audit Phase 5, E2).
      if (lowValueUnit(data, t)) return no(`${t.label} is a Low Value Unit, which is never placed during the Deployment stage (p.82). It arrives when a card puts it down.`);
      const su = normaliseSetup(state.setup);
      if (!su || su.stage !== 'deploy') {
        return no(t.deployed !== false ? `${t.label} is already on the board.` : 'Units are placed in the deployment stage of setup (3.1.4).');
      }
      // A unit already down may be nudged until deployment closes; only a
      // fresh placement spends the alternation turn (3.1.4).
      if (t.deployed === false && deployTurn(state, su, data) !== cmd.seat) return no('It is the other squad\'s turn to place a unit (3.1.4).');
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
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
        return no('That is not a place on the board.');
      }
      // Wholly within an unoccupied Grid of the squad's Deployment Zone
      // (3.1.4; ruling I4): one unit to a Large Grid, the base clear of
      // terrain, and once every zone Grid is taken the Grids next to it,
      // working outward (FAQ P23). The zone and the spot were the UI's, and the
      // Match Centre landed a unit on another or on terrain (audit Phase 6,
      // A3, A6). A table with no board has no Grids to judge: the pad sends
      // every unit to the same placeholder cell, and the table places them.
      if (!state.noBoard) {
        const at = `${Math.floor(col / 3)},${Math.floor(row / 3)}`;
        const taken = new Set(state.tokens
          .filter((x) => x.uid !== t.uid && x.deployed !== false && x.kind !== 'projectile')
          .map((x) => `${Math.floor(x.col / 3)},${Math.floor(x.row / 3)}`));
        if (taken.has(at)) return no('A unit deploys wholly within an unoccupied Grid (3.1.4), and that one already holds a unit.');
        const zone = deployGrids(data.zoneData, state, su.edge[t.side]);
        if (zone && !deployOpenGrids(zone, taken, gridsOf(state)).has(at)) {
          return no('A unit deploys in its squad\'s Deployment Zone (3.1.4), or, once every Grid of it is taken, in the Grids next to it (FAQ P23).');
        }
        const terrain = t.aerial ? null : knownTerrain(data, state);
        if (terrain) {
          const solid = new Set(terrain.flatMap((p) => p.subCells.map((s) => `${s.col},${s.row}`)));
          for (let dc = 0; dc < t.size; dc++) {
            for (let dr = 0; dr < t.size; dr++) {
              if (solid.has(`${col + dc},${row + dr}`)) return no('The base cannot overlap terrain (p.6), so it does not fit there.');
            }
          }
        }
      }
      if (cmd.stance !== undefined && !STANCES.includes(cmd.stance)) return no('That is not a Stance.');
      // Shutdown is where a Mech falls at 0 Link, never a Stance it is given
      // (3.4.2 lists only Defensive, Mobility and Offensive).
      if (cmd.stance === 'shutdown' && t.kind === 'mech') return no('A Mech deploys in Defensive, Mobility or Offensive Stance. Shutdown is only ever reached at 0 Link (3.4.2).');
      // Deploying camouflaged needs a Part that can Activate Optical Camouflage
      // (4.12.2): the engine took one for any unit (audit Phase 3, C11).
      if (cmd.camo && !canActivateCamo(data, t)) return no(`${t.label} has no Part that Activates Optical Camouflage, so it cannot deploy in it (4.12.2).`);
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
      // Optical Camouflage is Activated by a unit's own Action (4.12.2), so it
      // goes on one's own unit, and only one with a Part that prints it. The
      // engine put it on any unit, the enemy's included (audit Phase 3, C11).
      if (cmd.statusId === 'camouflage') {
        if (target.side !== cmd.seat) return no('Optical Camouflage is Activated by the unit\'s own Action, never placed on an enemy (4.12.2).');
        if (!canActivateCamo(data, target)) return no(`${target.label} has no Part that Activates Optical Camouflage (4.12.2).`);
        // On a strict guided table only by that Action, just paid (`camoOwed`):
        // it went on by hand at any moment, and with a free `reveal` the two
        // made a repeatable hop. Deploying in the State is `deployUnit`'s, and a
        // free table keeps its hand tool (ruled R1; audit Phase 7, P7C 1).
        if (strictGuided(state) && state.script?.camoOwed?.uid !== target.uid) {
          return no(`Optical Camouflage is Activated by an Action (4.12.2): ${target.label} performs its Activate Optical Camouflage Action first.`);
        }
      }
      return ok;
    }
    case 'setAuraReach': {
      // The table's record of who stands inside an aura, kept only where no
      // board can measure it. Either player may set it, as either may place a
      // Token, so the aura may be the other squad's.
      if (!state.noBoard) return no('A board measures an aura\'s Range itself.');
      const src = state.tokens.find((x) => x.uid === cmd.sourceUid);
      const a = src ? auraActionOf(data, src, cmd.actionId) : undefined;
      if (!src || !a) return no('That is not an aura on the table.');
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (!auraCanReach(src, a, target)) return no(`${a.name.en ?? a.id} cannot reach ${target.label}.`);
      return ok;
    }
    case 'removeStatus':
    case 'ageStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (!(target.statuses ?? []).includes(cmd.statusId)) return no('That unit is not carrying it.');
      if (cmd.kind === 'removeStatus' && cmd.face && !tokenFaces(target, cmd.statusId).some((f) => f.face === cmd.face)) {
        return no(`None of those Tokens is showing its ${cmd.face} face.`);
      }
      return ok;
    }
    case 'focus': {
      // ZPA-39 Cadaver's Focus consumes nothing, so 4.10's floor has no spend
      // to bite on and a Cadaver may Focus at 1 Link. NOT in Shutdown: no pilot
      // skill triggers there (FAQ L3), so focusIsFree is off and the floor
      // bites. This used to say a Shutdown Cadaver could still Focus at 0.
      if (focusIsFree(data, t)) return ok;
      // A Drone has no Link of its own; a White Dwarf Bit may spend Karl
      // Fried's (ACE-01; audit Phase 2, D4).
      const payer = t.kind === 'mech' ? t : focusPayer(data, state.tokens, t);
      if (!payer) return no(`${t.label} has no Link to Focus with.`);
      // The last Link can never be spent voluntarily (4.10, FAQ L1).
      if ((payer.link ?? 0) < 2) return no('Focus spends 1 Link, and the last Link can never be spent voluntarily (4.10).');
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
    case 'recoverLink': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target || target.deployed === false) return no('That Mech is not on the table.');
      if (target.kind !== 'mech') return no('Only a Mech has a Link Value.');
      if ((target.partStates.torso ?? 'intact') === 'destroyed') return no(`${target.label} is destroyed, and has no Link to recover.`);
      // Link comes back from the Mech itself or from an ally, never from
      // across the table: every card that restores it names Ally Mechs.
      if (target.side !== cmd.seat) return no('Link is only ever restored to an Ally Mech.');
      if ((target.link ?? 0) >= maxLink(data, target)) return no(`${target.label} is already at its pilot's Link Value.`);
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
      if (held < 1) return no('No Ammo left for that Action (4.13).');
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
      // Picked up as a Movement passes its Grid, or as the unit's own Action
      // Opportunity ends in it (5.3.1, 3.4.4, FAQ P8). A guided board judges
      // both: this unit's own Opportunity, and a Grid its Movements entered or
      // the one it stands in. A Mech 11 Grids away was accepted, in any phase
      // (audit Phase 6, F5).
      if (state.script && normaliseSetup(state.setup)?.stage === 'done' && !state.noBoard) {
        const o = state.script.opp;
        if (!o || o.uid !== t.uid) return no(`${t.label} picks up a Black Box in its own Action Opportunity (5.3.1).`);
        const at = `${Math.floor(box.col / 3)},${Math.floor(box.row / 3)}`;
        if (at !== `${Math.floor(t.col / 3)},${Math.floor(t.row / 3)}` && !(o.route ?? []).includes(at)) {
          return no(`${t.label} has not moved through that Black Box's Grid in this Action Opportunity, and it is not in it (5.3.1).`);
        }
      }
      // A Part already bearing one has its Freehand treated as invalid (5.3.1),
      // so a Part can only ever hold a single Box. A Carrier carries one on a
      // Freehand Load (FAQ P11; ruling I19).
      const hands = freehandSlots(data, t, boxHands(state.tasks, t.uid), [], true);
      if (!hands.length) {
        return no(`${t.label} has no free Freehand Part. Carrying a Black Box needs one, and a Part already holding one does not count (5.3.1).`);
      }
      if (!hands.some((h) => h.slot === cmd.slot)) return no('That Part cannot carry a Black Box.');
      return ok;
    }
    case 'spendIntercept': {
      // 4.9 Interception is a Firing Action or a Passive; a Shutdown Mech has
      // neither (4.1).
      if (t.kind === 'mech' && t.stance === 'shutdown') return no(`${t.label} is in Shutdown Stance, so it cannot Intercept: no Action but Reboot and no Passive (4.1, 4.9).`);
      // Its own Part's Tokens, or a Carrier's Load in Contact (ruling I25).
      const payer = interceptPayer(data, state.tokens, t, cmd.actionId, !!state.noBoard);
      const held = payer?.intercept?.[cmd.actionId];
      if (held === undefined) return no('That Action carries no Interception Tokens.');
      if (held < 1) return no('Every Interception Token on that Part is spent, and they are never restored (4.9).');
      // Fire Control Interference names Interception, and a destroyed Part
      // performs nothing (3.4.3): the queue knew both, the spend did not
      // (audit Phase 5, B9).
      if (statusCount(t.statuses, 'fci') > 0) return no(`${t.label} bears Fire Control Interference, so it cannot Intercept.`);
      const slot = tokenCards(data, t).find(({ card }) => (card.actions ?? []).some((a) => a.id === cmd.actionId))?.slot;
      // A Repaired Part is "broken in every way except that it can still
      // perform actions" (FAQ J23), Interception included (ruling I11; audit
      // Phase 6, C8): units.ts partUsable's reading, kept inline here.
      if (slot && (t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed' && !(t.repairedSlots ?? []).includes(slot)) {
        return no('That Part is destroyed, so it cannot Intercept (3.4.3).');
      }
      // A strict table makes only an owed attempt (ruling I11): a Launch or an
      // Aerial unit's Movement is what owes one (4.9). A table with no board
      // owes nothing the engine can see, so it judges for itself.
      if (strictNow(state) && !state.noBoard && !(state.script?.intercepts ?? []).some((o) => o.uid === t.uid && o.actionId === cmd.actionId)) {
        return no('No Interception is owed to that Part: a Launch or an Aerial unit\'s Movement owes one (4.9).');
      }
      return ok;
    }
    case 'restoreIntercept': {
      // Interception Tokens "are normally not restored" (M27); a strict table
      // takes a mistaken spend back with Undo (audit Phase 5, B8).
      if (strictNow(state)) return no('Interception Tokens are never restored (4.9, M27). Undo takes back a mistaken spend.');
      const payer = interceptPayer(data, state.tokens, t, cmd.actionId, !!state.noBoard) ?? t;
      const held = payer.intercept?.[cmd.actionId];
      if (held === undefined) return no('That Action carries no Interception Tokens.');
      const max = interceptMax(data, payer, cmd.actionId);
      if (max !== undefined && held >= max) return no('That Part still holds every Interception Token it started with.');
      return ok;
    }
    case 'startCounterRoll': {
      // Whether an Electronic Attack or a reaction, the Initiator is acting,
      // and a Shutdown Mech performs no Action but Reboot and triggers nothing
      // of its own (4.1, FAQ L3). Target Tracing still opened one (Phase 2, A4).
      if (t.kind === 'mech' && t.stance === 'shutdown') return no(`${t.label} is in Shutdown Stance, so it cannot open an Electronic Counter-roll (4.1).`);
      // One paid Action, one Counter-roll (ruled R2; audit Phase 7, P7C 2). On
      // a strict guided table an Electronic Attack, a Scan or a Remote Access
      // opens the roll its Action paid for, once, and a free Scan rides the
      // attack that designates the camouflaged unit, once for each unit (FAQ
      // I11, I12). The command took any roll at any moment: in the enemy's
      // Opportunity, in the End Phase, a lost Terminal roll again on one Tick,
      // and a Drone's Common Scan. Target Tracing is a reaction with its own
      // proof (the Passive and its Command Token), and a Projectile Scans as
      // its Detonation resolves (FAQ M16).
      if (strictGuided(state) && !cmd.reaction && t.kind !== 'projectile') {
        const owed = state.script?.counterOwed;
        if (!owed || owed.uid !== t.uid || owed.actionId !== (cmd.thenAttack?.actionId ?? cmd.actionId)) {
          return no(cmd.thenAttack
            ? 'A free Scan comes with the attack that designates the camouflaged unit (FAQ I12): declare the attack first.'
            : `${t.label} has no Counter-roll paid for: the Action that makes it opens one roll, once (4.11.2).`);
        }
        if (cmd.thenAttack && (owed.scanned ?? []).includes(cmd.targetUid)) {
          return no('This attack has already made its free Scan of that unit: a failed Scan ends the attack on it (FAQ I11).');
        }
        // The designation the attack was declared at comes first; only a
        // Multi-Target designates more, each an `extra` one.
        if (cmd.thenAttack && !cmd.thenAttack.extra && (owed.scanned ?? []).length) {
          return no('This attack has already made its free Scan: it designated that target, and a failed Scan ends the attack (FAQ I11).');
        }
      }
      // A Remote Access against a Terminal (p.87; ruling I25). The Responder is
      // the Terminal's stand-in rather than a unit, so none of the target rules
      // below apply; the access rule does, since the Tick is already paid.
      if (cmd.terminal !== undefined) {
        if (state.script?.counter) return no('An Electronic Counter-roll is already open.');
        if (cmd.actionId !== 'COMMON_REMOTE_ACCESS') return no('Only a Remote Access rolls against a Terminal (5.3.3).');
        const why = terminalAccessWhy(data, state, t, cmd.terminal);
        if (why) return no(why);
        if (electronicValue(data, t, loanedParts(data, state.tokens, t)) <= 0) return no(`${t.label} has an Electronic Value of 0, so it cannot Initiate a Counter-roll (4.11.2).`);
        return ok;
      }
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
      // Only three things open a Counter-roll: an Electronic Attack, a Scan and
      // the Target Tracing reaction. The command took any Action at all, a
      // Firing one included (audit Phase 3, D5).
      if (!cmd.reaction && !isElectronicAttack(a) && !isScanAction(a)) {
        return no(`${a.name?.en || a.id} is not an Electronic Attack or a Scan, so it opens no Counter-roll.`);
      }
      // The target the card prints: 097_B "Mech/Drone", XTC_A "Drone/Projectile",
      // Scream "Mechs" (D5).
      const kindWhy = electronicTargetWhy(a, target);
      if (kindWhy) return no(kindWhy);
      // Range only: Electronic Warfare ignores Terrain and line of sight
      // entirely (4.11.1), so the arc and sight checks a Firing Action needs
      // have no place here. The effective reach: FPA-06 Amplify adds a Grid to
      // an Electronic Attack, and reading the printed number refused it.
      let reach = actionRange(data, state.tokens, t, a);
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
      // The free Scan on designation (4.12.2, FAQ I12): only a Scan may carry
      // an attack behind it, only against a camouflaged target, and the attack
      // has to be a Firing or Melee Action this unit can declare.
      if (cmd.thenAttack) {
        if (!isScanAction(a)) return no('Only a Scan carries an attack behind it (FAQ I12).');
        if (statusCount(target.statuses, 'camouflage') === 0) return no(`${target.label} is not in the Optical Camouflage State, so no free Scan is owed: attack it directly.`);
        const atk = findAction(data, state, cmd.uid, cmd.thenAttack.actionId);
        if (!atk || (atk.type !== 'Firing' && atk.type !== 'Melee')) return no('The free Scan precedes a Firing or Melee Action that designates the camouflaged unit (FAQ I12).');
        // An extra designation belongs to a Multi-Target Action, which selects
        // its targets at once and earns a free Scan for each camouflaged one
        // (the glossary's Multi-target X; ruled 2026-09-25, F3; R3, P7C 4).
        if (cmd.thenAttack.extra && !multiTargetLimit(atk)) return no(`${atk.name?.en || atk.id} takes one target, so it designates no extra one (Multi-target X).`);
        // The attack designates the marker, so it has to be an attack this unit
        // could make at the marker: its Range, its arc, its line of sight, not
        // an Aerial unit for a Melee (ruled 2026-09-25, audit Phase 3, F8). The
        // Scan it earns is "the Common Action: Scan, aside from its range"
        // (FAQ I18): the attack's reach, where it used to be the Scan's own 6.
        reach = actionRange(data, state.tokens, t, atk);
        if (!state.noBoard) {
          const gone = new Set(state.removedTerrain ?? []);
          const terrain = (data.terrain?.layouts?.[state.map] ?? []).filter((p) => !gone.has(p.id));
          const note = losNote(t, target, { ...atk, range: reach }, terrain, state.tokens, state.smoke ?? [], true);
          const fail = note.split(' · ').find((x) => x.includes('✕'));
          if (fail) return no(`${atk.name?.en || atk.id} cannot designate ${target.label}'s marker: ${fail.replace('✕ ', '')}.`);
        }
      }
      // An Action on every enemy in Range (Scream, the Scan Battlefield) opens
      // one Counter-roll per target, queued as the record clears; the one named
      // must be among them, and the rest are derived, so both seats queue the
      // same list (audit Phase 3, D2 and A4).
      if (electronicAll(a) && !cmd.reaction) {
        const pool = electronicAllTargets(data, state.tokens, t, a, !!state.noBoard);
        const outside = [target.uid, ...(state.noBoard ? cmd.also ?? [] : [])].find((u) => !pool.some((x) => x.uid === u));
        if (outside !== undefined) {
          const who = state.tokens.find((x) => x.uid === outside);
          return no(`${who?.label ?? 'That unit'} is not one of the enemies ${a.name?.en || a.id} reaches (Range ${reach}).`);
        }
        if (electronicValue(data, t, loanedParts(data, state.tokens, t)) <= 0) return no(`${t.label} has an Electronic Value of 0, so it cannot Initiate a Counter-roll (4.11.2).`);
        return ok;
      }
      // An allied Repeater lends its position as the origin, and the Action's
      // own Range is measured from there (FAQ O19). Derived rather than sent,
      // so both seats judge the same shot. For an Electronic Attack only: the
      // glossary gives a Repeater to "Electronic Attack or Electronic Support",
      // and a Scan measured through one was accepted at Range 12 (audit Phase
      // 3, A5; F9). A free Scan measures from the attacker, at its attack's reach.
      const origins = isElectronicAttack(a) && !cmd.thenAttack ? electronicOrigins(data, state.tokens, t) : [t];
      if (!cmd.reaction && !origins.some((from) => gridRange(from, target) <= reach) && !state.noBoard) {
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
      // In its turn (FAQ G4): both sides declare first, then the Initiator
      // rerolls, then the Responder. A reroll out of turn is refused rather
      // than applied, or a side could reroll after watching the other's.
      if (cmd.focused && counterStage(data, state.tokens, c) !== (cmd.uid === c.initiatorUid ? 'rerollI' : 'rerollR')) {
        return no('A Focus reroll waits for both sides to declare, and the Initiator rerolls first (FAQ G4).');
      }
      return ok;
    }
    case 'forceShutdown': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.kind !== 'mech') return no('Only a Mech has a Stance to switch.');
      if ((target.partStates.torso ?? 'intact') === 'destroyed') return no(`${target.label} is destroyed.`);
      if (target.stance === 'shutdown') return no(`${target.label} is already in Shutdown Stance.`);
      return ok;
    }
    case 'declareCounterFocus': {
      const c = state.script?.counter;
      if (!c) return no('No Electronic Counter-roll is open.');
      if (cmd.uid !== c.initiatorUid && cmd.uid !== c.responderUid) return no('That unit is not in this Counter-roll.');
      if (counterStage(data, state.tokens, c) !== (cmd.uid === c.initiatorUid ? 'declareI' : 'declareR')) {
        return no('It is not that side\'s turn to declare a Focus: once both hands are in, the Initiator declares first, then the Responder (FAQ G4).');
      }
      // The Whistle pays a Drone's reroll with an Ally Mech's Command Token,
      // not Link (ZYBP-202; audit Phase 3, D9).
      if (cmd.use && cmd.whistleUid !== undefined) {
        if (!whistleFunders(data, state.tokens, t).some((m) => m.uid === cmd.whistleUid)) {
          return no(`No Whistle within Range 4 of ${t.label} has a face-up Command Token to lend (ZYBP-202).`);
        }
        return ok;
      }
      if (cmd.use && !focusIsFree(data, t)) {
        // The payer: the Mech, or Karl Fried's for a White Dwarf Bit (D4).
        const payer = t.kind === 'mech' ? t : focusPayer(data, state.tokens, t);
        if (!payer) return no(`${t.label} has no Link to Focus with.`);
        if ((payer.link ?? 0) < 2) return no('Focus spends 1 Link, and the last Link can never be spent voluntarily (4.10).');
      }
      return ok;
    }
    case 'disarm': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.kind !== 'mech' || !target.mech) return no('Disarm flips a Part Card, and only a Mech carries them.');
      const held = target.mech[cmd.slot as PartSlot];
      const from = held ? data.byId.get(held) : undefined;
      if (!from) return no(`${target.label} has nothing in that slot.`);
      // A Repaired Part still acts (FAQ J23), so a free table may turn it over
      // for its own Discard; p.78's example carries its Repaired Token to the
      // Discard Card (ruled R4; audit Phase 7, P7A 10). A hit on one breaks it
      // first (J23), so a Disarm never finds one standing.
      if (!partUsable(target, cmd.slot)) {
        return no(`${target.label}'s ${SLOT_LABEL[cmd.slot as PartSlot]} is destroyed, so there is no card left to flip.`);
      }
      // The legality IS the pointer: a Part with no Discard Card has no
      // discard state (4.17), so a torso or a chassis cannot be disarmed.
      if (!discardFaceOf(data, from)) return no(`${cardName(from)} has no Discard Card, so it has no Discard State to change to.`);
      // On a strict guided table a Part turns over only through a Disarm the
      // last Action owes, recorded as that Action was paid, or through its own
      // Discard Action, whose apply turns it (ruled R3; audit Phase 7, P7A 8).
      // A free table keeps the hand tool.
      if (strictGuided(state)) {
        if (cmd.targetUid === cmd.uid) return no('A Mech drops its own equipment through the Discard Action (6.1).');
        const owed = state.script?.disarmOwed;
        if (!owed || owed.uid !== cmd.uid) return no(`${t.label} has no Disarm to cause: a Part turns to its Discard Card through a hit with Disarm (4.17).`);
      }
      return ok;
    }
    case 'suppress': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      if (target.kind !== 'mech') return no('Suppression only moves a Mech: other units have no Stance dial to switch.');
      if (target.stance === 'shutdown') return no('A Shutdown Mech is immune to Suppression (glossary).');
      // Cruise Mode: "not affected by suppression or any other effects that
      // change stance" (Ace Strategy additional rules; audit Phase 2, D3).
      if (cruising(data, target)) return no(`${target.label} is in Cruise Mode, which Suppression does not affect.`);
      return ok;
    }
    case 'provoke': {
      // LPA-22 Yoyu, 挑衅 Provoke. `t` is Yoyu, so the actor gate above has
      // already refused a player answering for the other squad's pilot.
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That target is not on the board.');
      const why = provokeWhy(data, t, target);
      if (why) return no(why);
      // The VERDICT is not re-judged here: "Dice ride inside their commands as
      // rolled faces". Exactly the same line the `applyStatus` that lands a won
      // Electronic Attack sits on; only a Terminal's access reads its roll's
      // faces (counterWon; ruled R2, audit Phase 7, P7C 2). What IS judged is
      // that the answer belongs to the exchange it claims: the Counter-roll
      // below, and Yoyu's own seat above.
      const c = state.script?.counter;
      if (c) {
        // Yoyu answers in EITHER role (4.11.2: an on-success Passive fires
        // "regardless of whether the Unit was acting as the Initiator or
        // Responder"), turning the other Mech in the contest. It used to be the
        // Responder only (ruled 2026-09-25, audit Phase 3, F16). An answer
        // naming any other pair is not this question.
        const pair = (c.responderUid === cmd.uid && c.initiatorUid === cmd.targetUid)
          || (c.initiatorUid === cmd.uid && c.responderUid === cmd.targetUid);
        if (!pair) return no(`${t.label} and ${target.label} are not the two sides of this Counter-roll.`);
        if (counterStage(data, state.tokens, c) !== 'done') return no('The Counter-roll is not settled yet: both hands, both Focus declares and their rerolls come first (FAQ G4).');
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
      // A token turns face-up through a Charge Action, whose own apply does it
      // (ruled R2), so on a strict guided table the hand flip is only the
      // refund of the token this unit last spent, for an attack it then
      // abandoned. Freeform and the sandbox keep the hand tool (audit Phase 7,
      // P7A 9).
      if (cmd.on && strictGuided(state)) {
        const back = state.script?.chargeBack;
        if (!back || back.uid !== cmd.uid || back.slot !== cmd.slot) return no('A Charge Token turns face-up through the Charge Action (4.14). Undo takes back a mistake.');
      }
      return ok;
    }
    case 'endOpportunity': {
      if (!oppOf(state, cmd.uid)) return no('It is not this unit\'s Action Opportunity.');
      // Nor may a Drone's Automatic activation end before its obligatory
      // Action (3.5; ruling I4; audit Phase 5, F3).
      if (strictNow(state) && PHASES[state.round.phase] === 'Automatic' && !state.noBoard && t.kind === 'drone' && untouched(oppOf(state, cmd.uid)!)) {
        const terrain = knownTerrain(data, state);
        if (terrain && autoShotOwed(data, state.tokens, t, { terrain, smoke: state.smoke ?? [] })) {
          return no(`${t.label} has a legal target, and its Automatic Action is obligatory (3.5).`);
        }
      }
      if (rebootOwed(state, t)) return no(`${t.label} is in Shutdown Stance and its Action Opportunity has come, so it Reboots now: choose the Stance it Reboots into (FAQ K17).`);
      // A Reveal is made at once (4.12.2): on a strict guided table the unit
      // that owes one ends no Action Opportunity of its own before making it.
      // It entered the enemy's turn still camouflaged, where an attack on it
      // needed a Scan the rules no longer asked (ruled R7; audit Phase 7, P7C 7).
      if (strictGuided(state) && statusCount(t.statuses, 'camouflage') > 0 && (state.script?.revealDue ?? []).some((x) => x.uid === t.uid)) {
        return no(`${t.label} owes its Reveal (4.12.2): make it, and choose where it appears, before its Action Opportunity ends.`);
      }
      return ok;
    }
    case 'chooseTied': {
      const why = tiedChoiceWhy(state, (x, tm) => initiativeFor(data, x, tm), t);
      return why ? no(why) : ok;
    }
    case 'asterRestore': {
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      if (PHASES[state.round.phase] !== 'Command') return no('Aster restores Link during the Command Phase.');
      if (t.kind !== 'mech' || pilotCard(data, t)?.id !== 'ZPA-36') return no('That Mech is not piloted by Aster.');
      // A pilot skill is the Mech's own effect, and a Shutdown unit triggers
      // none of those (FAQ L3, which names Quartz for the same reason).
      if (t.stance === 'shutdown') return no(`${t.label} is in Shutdown Stance, and a Shutdown Mech triggers none of its own skills, so Aster cannot restore Link (FAQ L3).`);
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
      // What spends one here is always an Action or a Passive of this Mech
      // (Target Tracing, HALO, the Whistle, Chef, a drag), and a Shutdown Mech
      // has neither (4.1, FAQ L3). Issuing its token to a Drone is `designate`,
      // which it still may (3.2.1; audit Phase 2, A4 and E13).
      if (t.stance === 'shutdown') return no(`${t.label} is in Shutdown Stance: nothing it does can consume a Command Token (4.1, 4.15.4).`);
      if (readyCommands(t) <= 0) return no(`${t.label} has no face-up Command Token to spend (4.15.4).`);
      return ok;
    }
    case 'coordinateCommand': {
      // 4.15.3. The issuer must be one of your own Mechs still holding a
      // face-up Command - a reserved one, since the Command Phase is over.
      const from = state.tokens.find((x) => x.uid === cmd.uid);
      if (!from || from.side !== cmd.seat || from.kind !== 'mech') return no('A Command is issued by one of your own Mechs (4.15.3).');
      // Swarm Tactics going on: the token it already issued moves to another
      // Drone, so no face-up token and no Coordination is spent (172_B). In
      // the Command Phase it moves by designation instead.
      const going = swarmByCoordination(state, from);
      if (!going && readyCommands(from) <= 0) return no(`${from.label} has no face-up Command Token to hand out.`);
      const to = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!to || to.kind !== 'drone' || !alive(to)) return no('Command Coordination sends a Command to an Ally Drone.');
      if (to.side !== cmd.seat) return no('A Command only ever goes to an Ally Drone.');
      // A Drone bears one Command Token at a time (4.15.2). The Command Phase's
      // tokens were removed when that phase ended, which is exactly why a Drone
      // that already acted can take one now (4.15.3) - so this reads the board
      // rather than the phase's `commanded` list.
      if (heldCommands(to) > 0) return no(`${to.label} already has a Command Token, so it cannot take another (4.15.2).`);
      // A Shutdown Mech triggers none of its own effects (4.1, FAQ L3).
      if (from.stance === 'shutdown') return no(`${from.label} is in Shutdown Stance, so it coordinates nothing (4.1).`);
      // A strict guided game: the Coordination rides on an Action or a
      // Maneuver this Mech performed in its own Opportunity (4.15.3), and one
      // was sent with nothing performed, in any phase (audit Phase 5, F9).
      if (guidedGame(state) && strictNow(state) && !going) {
        const o = oppOf(state, from.uid);
        if (!o) return no(`${from.label} does not hold the Action Opportunity, so it has no Coordination to send (4.15.3).`);
        const acts = tokenCards(data, from).flatMap(({ card }) => card.actions ?? []);
        const did = o.performed.map(actionIdOf);
        const owed = acts.some((a) => did.includes(a.id) && coordinationFor(data, from, a) > 0)
          || (o.maneuvered && acts.some((a) => coordinatesAfterManeuver(a)))
          || coordinationOnOpportunityEnd(data, from) > 0;
        if (!owed) return no(`${from.label} has performed nothing that carries Command Coordination this Opportunity (4.15.3).`);
      }
      return ok;
    }
    case 'designate': {
      const phase = PHASES[state.round.phase];
      if (!isLoopPhase(phase)) return no('Designation happens in the Command, Automatic and Delay Phases.');
      const sc = state.script;
      if (!sc) return no('There is no guided game running.');
      // One activation at a time (3.2.2): a designation while another unit's
      // was still open took the table from it (audit Phase 5, F9). One whose
      // unit has left the board is over.
      const open = sc.opp && sc.opp.uid !== cmd.uid ? state.tokens.find((x) => x.uid === sc.opp!.uid) : undefined;
      if (open && alive(open) && open.deployed !== false) return no(`${open.label}'s activation is still open: finish it first (3.2.2).`);
      // Normalised the way both panels already display it, because the raw
      // pointer can be STUCK: only a designation or a pass ever moves it, so a
      // First Player with nothing to designate parks it on themselves forever —
      // their panel says "waiting for the other squad", the other squad's
      // designate is refused right here, and the phase deadlocks. Found in the
      // 2026-08-16 mock playtest, on the very first Command Phase driven with
      // the drones all on the second player's side.
      const turnNow = canAct(state, phase, sc.turn, data) ? sc.turn : (nextTurn(state, phase, sc.turn, data) ?? sc.turn);
      if (turnNow !== cmd.seat) return no('It is the other squad\'s turn to designate (3.2.2).');
      if (!eligibleUnits(state, phase, cmd.seat, data).some((x) => x.uid === cmd.uid)) return no(`${t.label} cannot be designated this phase.`);
      // Step 1 of 4.15.2 is naming the Mech that issues, so a named Mech has to
      // be one that actually holds a face-up Command. Omitting fromUid is still
      // legal - the fullest Mech pays - because replays and the Automatic and
      // Delay Phases send a designate with no issuer at all.
      // The capacity rule reads the BOARD, not just the phase's `commanded`
      // list: 4.15.2 caps a Drone at one physical Command Token, and FAQ N8 has
      // a White Dwarf Bit keep its token through a Stance change and be barred
      // from a second on exactly those grounds. A free Command (FAQ O14) places
      // no token, so it is not capped by this.
      // Drones only: a Mech designated here is taking an RWS Command
      // (遥控武器), and its own face-up tokens are not a Command it received.
      // Its cap is per Part, judged by eligibleUnits through the ledger.
      if (phase === 'Command' && t.kind === 'drone' && !sc.freeCommand.includes(cmd.uid) && heldCommands(t) > 0) {
        return no(`${t.label} already has a Command Token, so it cannot take another (4.15.2).`);
      }
      // Swarm Tactics going on: this squad's next Command is the Warrior's
      // token moving to another Drone, or it stops first (172_B).
      const going = phase === 'Command' ? swarmFor(state, cmd.seat) : null;
      if (going) {
        const w = state.tokens.find((x) => x.uid === going.issuer);
        if (cmd.fromUid !== undefined && cmd.fromUid !== going.issuer) {
          return no(`Swarm Tactics is going on: ${w?.label ?? 'the Warrior'}'s Command Token moves to another Drone now, or it stops there first.`);
        }
        return ok;
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
      // In a guided game the grant has to come from somewhere: the granting
      // Mech performed Coordinate (or the Echo Pack) in its own Opportunity,
      // which left the debt this consumes. The command used to stand on its
      // own, and was taken during the enemy's turn, in the Command Phase, at
      // 0 Link and from inside an Echo Opportunity (FAQ K3; audit Phase 2, B1).
      // A free table records whatever the table did.
      const gop = state.script?.opp;
      if (guidedGame(state)) {
        const owed = gop?.grantOwed ? findAction(data, state, gop.uid, gop.grantOwed) : undefined;
        const g = owed ? extraActivationOf(owed) : undefined;
        const from = gop ? state.tokens.find((x) => x.uid === gop.uid) : undefined;
        if (!gop || !g || !from) return no('Nothing has granted an Extra Action Opportunity: the granting Mech performs Coordinate first, in its own Action Opportunity.');
        if (from.side !== t.side) return no('An Extra Action Opportunity goes to an Ally Mech.');
        if (g.excludeSelf && from.uid === t.uid) return no(`${from.label} grants this to an Ally Mech other than itself.`);
        if (cmd.linkCost !== g.linkCost) return no(`${owed?.name?.en || 'This grant'} costs ${g.linkCost} Link, as printed.`);
        if ((t.link ?? 0) < g.minimumLink) return no(`${t.label} needs at least ${g.minimumLink} Link to be chosen.`);
        if (!state.noBoard && gridRange(from, t) > g.range) return no(`${t.label} is beyond Range ${g.range} of ${from.label}.`);
      }
      // More than the cost, never exactly it: the last Link can never be spent
      // voluntarily (4.10), which is also why every card that grants this sets a
      // minimum above its cost. `<` let a Mech on exactly the cost pay down to 0
      // and Shut Down, which no menu offered and the command took.
      if ((t.link ?? 0) <= cmd.linkCost) return no(`This costs ${cmd.linkCost} Link and the last Link can never be spent voluntarily (4.10), so ${t.label} needs more than ${cmd.linkCost}; it has ${t.link ?? 0}.`);
      return ok;
    }
    case 'stabilise': {
      // Stabilize System is an Action (6.1, a Tactical Short Action), and a
      // Shutdown Mech performs none but Reboot (4.1.1).
      if (t.stance === 'shutdown') return no('A Mech in Shutdown Stance cannot Stabilize; it may only Reboot (4.1.1).');
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
      // Keeping every Token at full Link is the same no-change action by
      // another road (FAQ J8, H2), so it is refused the same way.
      if (cmd.keepTokens && !canLink) return no('Link is already full, so keeping every Token would change nothing. An action that cannot produce any change cannot be performed (FAQ J8).');
      if (cmd.statusId !== undefined) {
        const d = STATUSES.find((x) => x.id === cmd.statusId);
        if (!(t.statuses ?? []).includes(cmd.statusId)) return no('That Mech is not carrying that Token.');
        if (d?.shape !== 'square' && d?.shape !== 'hexagon') return no('Stabilize System removes a Square or Hexagon Token (6.1).');
        if (cmd.face && !tokenFaces(t, cmd.statusId).some((f) => f.face === cmd.face)) return no(`None of those Tokens is showing its ${cmd.face} face.`);
      }
      return ok;
    }
    case 'reveal': {
      if (!(t.statuses ?? []).includes('camouflage')) return no('This unit is not in the Optical Camouflage State.');
      // What Reveals a unit is 4.12.2's list: |Reveal| or an Action or a
      // Maneuver without Silence, and a Movement ending in Contact, each
      // recorded as it lands (`revealDue`); and an enemy's won Scan, whose
      // `manifest` debt this pays. The fifth, its activating Part destroyed,
      // needs no command. A strict guided table refuses any other Reveal, which
      // was a free Manifestation hop at any moment, the enemy's Opportunity and
      // the End Phase included (ruled R1; audit Phase 7, P7C 1).
      if (strictGuided(state)) {
        const sc0 = state.script!;
        // The Contact is read off the board as well as the record: the
        // tabletop walks a token before it records the walk, and a Movement
        // Action's walk not at all, so the engine never sees that Movement end
        // in Contact. A unit standing in Contact with an enemy that breaks
        // camouflage may Reveal; a table with no board judges Contact itself.
        const owed = (sc0.revealDue ?? []).some((x) => x.uid === t.uid)
          || (sc0.reactions ?? []).some((r) => r.uid === t.uid && r.kind === 'manifest')
          || (!state.noBoard && !!camoBrokenBy(data, state.tokens, t));
        if (!owed) return no(`Nothing Reveals ${t.label} now: a unit leaves Optical Camouflage when it performs |Reveal| or an Action or Maneuver without Silence, when a Movement ends with an enemy in Contact, or when an enemy's Scan against it succeeds (4.12.2).`);
      }
      // MANIFESTATION MOVEMENT (4.12.2): "the Mech may appear within X Grids".
      // Teleportation, so nothing between the two Grids is consulted - only the
      // distance and whether the unit fits. The destination is judged HERE
      // rather than trusted, the same reason every other destination on the
      // wire is: the sender chooses it.
      if (cmd.to) {
        // The one bounds check this destination gets: the UIs only offer
        // manifestTargets (already clamped to the board), so only a modified
        // client can name an off-board Grid - and distance + fit below never
        // ask whether the Grid exists. cellsOf, so a 16 or 18 Grid table
        // measures its own edge rather than the printed board's.
        if (cmd.to.col < 0 || cmd.to.row < 0 || cmd.to.col >= cellsOf(state) || cmd.to.row >= cellsOf(state)) {
          return no('That Grid is not on the board.');
        }
        const range = manifestationRange(data, t);
        if (range <= 0) return no(`${t.label} has no Stealth value, so it Reveals where it stands.`);
        // Manifestation Movement is a Movement, and an Immobilized unit makes
        // none: it Reveals where it stands (FAQ I20).
        if (immobilizedStop(t)) return no(`${t.label} bears an Immobilized Token, so it Reveals where it stands rather than Manifesting away (FAQ I20).`);
        // Range, counted in an orthogonal path of Large Grids (4.2.1), so a
        // diagonal neighbour is Range 2. It was a square until 2026-09-25
        // (audit Phase 3, C1).
        const away = Math.abs(Math.floor(cmd.to.col / 3) - Math.floor(t.col / 3))
          + Math.abs(Math.floor(cmd.to.row / 3) - Math.floor(t.row / 3));
        if (away > range) {
          return no(`Manifestation Movement reaches Range ${range}, and that Grid is Range ${away} away.`);
        }
        // Nor past a Tether: a Manifestation is not Forced Movement, so the
        // leash holds it like any Movement of its own (ruled 2026-09-25, audit
        // Phase 4, I16).
        const leash = tetherCap(t, state.tokens);
        if (leash && !leash(Math.floor(cmd.to.col / 3), Math.floor(cmd.to.row / 3))) {
          const x = (t.tether ?? []).filter((l) => l.role === 'tethered')[0]?.range ?? 0;
          return no(`${t.label} is Tethered and cannot Manifest beyond ${x} Grids of the unit holding it (PDLH-202).`);
        }
        // It follows Flying Movement rules (FAQ I17), and a flight may not land
        // in an Abyss.
        if (isGroundUnit(data, t) && envCardAt(state, Math.floor(cmd.to.col / 3), Math.floor(cmd.to.row / 3)) === 'abyss') {
          return no(`${t.label} cannot Manifest into an Abyss: the move follows Flying Movement rules, which may not land there (FAQ I17).`);
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
      // An ALLY's Damaged Part, mended by the Action named: the SU1's Armor
      // Patch, within its Range on a board (audit Phase 6, C6).
      if (cmd.targetUid !== undefined) {
        const a = cmd.actionId ? findAction(data, state, cmd.uid, cmd.actionId) : undefined;
        const spec = a ? repairSpec(a) : undefined;
        if (!a || !spec?.ally) return no('That Action mends no ally.');
        if (cmd.mode !== 'mend') return no(`${a.name?.en || a.id} removes a Damaged Token; it gives no Repaired one.`);
        const target = state.tokens.find((x) => x.uid === cmd.targetUid);
        if (!target || target.deployed === false) return no('That unit is not on the board.');
        if (target.side !== t.side || target.uid === t.uid) return no(`${a.name?.en || a.id} mends an Ally Unit.`);
        if (!state.noBoard && rangeBetween(t, target).range > (a.range ?? 0)) return no(`${target.label} is beyond Range ${a.range ?? 0}.`);
        if ((target.partStates[cmd.slot as PartSlot | 'main'] ?? 'intact') !== 'damaged') return no('Only a Damaged Part can be mended.');
        return ok;
      }
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
      const launcher = findAction(data, state, cmd.uid, cmd.actionId);
      if (!launcher) return no('This unit has no such Action.');
      // A Projectile Action is performed in the unit's own activation (4.7.3):
      // a Mech in its Action Opportunity, a Drone in the one its Command or its
      // Phase opened, under the icon lock (3.2.2, 3.5). The card's Launch door
      // sent one with neither, so an uncommanded Hyena Missile launched in any
      // phase and a Mech launched for no Tick (audit Phase 5, A7). A strict
      // guided game holds it; the sandbox, Teaching and Freeform keep the door.
      if (guidedGame(state) && strictNow(state)) {
        if (!oppOf(state, cmd.uid)) return no(`${t.label} does not hold an Action Opportunity, so it cannot launch now (4.7.3).`);
        if (t.kind === 'drone') {
          const ph = droneLockPhase(state);
          const why = ph ? droneActionWhy(ph, launcher, { autoActions: riderOnDrone(data, state.tokens, t).autoActions }) : null;
          if (why) return no(why);
        }
      }
      // Every launch costs one Ammo Token (4.13), and apply clamps the count at
      // zero - so without this line an empty magazine fired forever, in a
      // strict game as much as the sandbox, because nothing ever said no.
      //
      // ammoHolder, which answers WHOSE TOKEN pays, not the pool question: a
      // launcher lent by a Carrier Tarantula keeps its magazine on the DRONE
      // (FAQ O3/O16), and the Mech has no entry for the borrowed Action at all.
      // Reading t.ammo raw therefore found undefined, said nothing, and a
      // borrowed Missile Pod fired for free all game.
      //
      // And through ammoPay, which pool: an empty Pod may launch out of an
      // RKG70 Ammunition Pack's magazine (086_B Ammo Delivery). The row offered
      // it on that basis while this refused it (audit Phase 2, C6).
      const { from: mag, poolId } = ammoPay(data, state, t, cmd.actionId);
      if (mag.ammo[poolId] !== undefined && mag.ammo[poolId] <= 0) {
        return no('No Ammo Tokens left for this Action (4.13).');
      }
      // Throw (4.17 ②) is a rule of the Action, like its Ammo, so every table
      // holds it: the card's Launch door sends no performAction (ruled R7;
      // audit Phase 7, P7A 6).
      const thrown = throwWhy(data, t, launcher, boxHands(state.tasks, t.uid), loanedParts(data, state.tokens, t, { anywhere: !!state.noBoard }));
      if (thrown) return no(thrown);
      // Volley X: one performance launches at most X (4.7.3). Counted inside
      // the Opportunity, launches whose Units are still on the board, so a
      // take-back frees its shot. The pages capped it; this did not, and four
      // launches off one Volley 2 Action went through (audit Phase 2, C12). No
      // Extra Tick in the data pays for a Projectile Action, so one
      // performance per Opportunity is exact.
      const lo = oppOf(state, cmd.uid);
      const act = findAction(data, state, cmd.uid, cmd.actionId);
      if (lo && act) {
        const cap = volleyFor(data, t, act, lo);
        const live = (lo.launched ?? []).filter((x) => x.actionId === cmd.actionId && x.uids.some((u) => state.tokens.some((tk) => tk.uid === u))).length;
        if (live >= cap) return no(`${act.name?.en || 'This Action'} launches ${cap === 1 ? 'once' : `at most ${cap} times`} per performance (Volley ${cap}).`);
      }
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
        return no('That is not a place on the board.');
      }
      // The rack launches the folded Pholcus, which Unfolds into the Drone
      // (FAQ M18.3); the Unfolded one is never launched (audit Phase 5, A8).
      const shot = data.byId.get(cmd.cardId);
      if (shot && isUnfolded(shot)) return no(`${cardName(shot)} is never launched: the folded Pholcus Unfolds into it (FAQ M18.3).`);
      if (shot && isMine(shot)) {
        const offTerrain = mineOnTerrain(data, state, col, row);
        if (offTerrain) return no(offTerrain);
      }
      // A 1x3 line unit stands across its facing, wholly inside one Large Grid
      // (types.ts baseCells; OTTO, 2026-09-28).
      if (!state.noBoard && isLineUnit({ cardId: cmd.cardId })) {
        if (![0, 1, 2, 3].includes(cmd.facing)) return no(`${shot ? cardName(shot) : 'This unit'} is a 1x3 line, so it needs a facing.`);
        const across = cmd.facing === 1 || cmd.facing === 3;
        if (across ? row % 3 !== 0 : col % 3 !== 0) return no(`${shot ? cardName(shot) : 'This unit'} is a 1x3 line and stands wholly inside one Large Grid, across its facing.`);
      }
      // A card this Action launches, the list the pickers draw from (audit
      // Phase 5, G5). An Action whose card names nothing is left to the table.
      const may = launchableCards(data, state.tokens, t, cmd.actionId, !!state.noBoard);
      if (shot && may && may.length && !may.includes(cmd.cardId)) return no(`${launcher.name?.en || 'That Action'} does not launch ${cardName(shot)}.`);
      // HOW FAR: the Landing Point within the Action's Range, [Stationary] and
      // the Seagull's +2 included, the Grids the pages light (4.7.2). The check
      // bounded nothing, and a Range 3 launch 18 Grids away passed (audit
      // Phase 5, A8; Phase 4's I10 ceiling for movement). A table with no
      // board has no distances.
      if (!state.noBoard) {
        const reach = projectileReach(data, t, launcher, oppOf(state, cmd.uid));
        const far = Math.abs(Math.floor(col / 3) - Math.floor(t.col / 3)) + Math.abs(Math.floor(row / 3) - Math.floor(t.row / 3));
        if (far > reach) return no(`That Landing Point is ${far} Grids away, beyond ${launcher.name?.en || 'the Action'}'s Range ${reach} (4.7.2).`);
      }
      return ok;
    }
    case 'resolveReaction': {
      if (!t) return no('That unit is not on the board.');
      const owed = (state.script?.reactions ?? []).find((r) => r.uid === cmd.uid && r.actionId === cmd.actionId);
      if (!owed) return no('That unit is owed no reaction.');
      // An enemy's won Scan Reveals the unit (4.12.4), and its `manifest` debt
      // is paid by that Reveal, the `reveal` apply clearing it: on a strict
      // guided table it is not waved away while the unit is still camouflaged
      // (ruled R7; audit Phase 7, P7C 7).
      if (owed.kind === 'manifest' && strictGuided(state) && statusCount(t.statuses, 'camouflage') > 0) {
        return no(`${t.label} has been Scanned, so it Reveals (4.12.4): its player chooses where it appears, and that answers the Scan.`);
      }
      return ok;
    }
    case 'controlledMove': {
      // The Red Shoes' debt, owed to this unit for this target: the actor gate
      // above has already made the controller the sender's own unit.
      const owed = (state.script?.reactions ?? []).find((r) => r.uid === cmd.uid && r.kind === 'control' && r.fromUid === cmd.targetUid);
      if (!owed) return no(`${t.label} has taken control of nothing (The Red Shoes).`);
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return no('That unit is not on the board.');
      // The Crush ended this Movement where the exchange placed the unit
      // (4.3.6): the stamp is that spot, and the controlledMove recording the
      // Movement lands there and nowhere further (ruled R1; audit Phase 7,
      // P7D 1). Without it the exchange and then a Sprint moved it twice.
      if (owed.placed && (owed.placed.col !== cmd.to.col || owed.placed.row !== cmd.to.row)) {
        return no(`${target.label}'s Movement ended in the Crush exchange (4.3.6), so The Red Shoes leaves it where the exchange put it.`);
      }
      const act = cmd.actionId ? findAction(data, state, target.uid, cmd.actionId) : null;
      if (cmd.actionId && (!act || act.type !== 'Moving')) return no(`${target.label} has no such Move Action.`);
      // Still stopped by Immobilized (6.3.2), whoever is moving it.
      const stop = immobilizedStop(target, act);
      if (stop) return no(stop);
      // And a Move Action still needs the Chassis (4.3.4, audit Phase 4, I10),
      // but a Crawl, which an arm makes (ruled R1; audit Phase 7, P7B 3).
      if (act) {
        const chassis = chassisStop(target, act);
        if (chassis) return no(chassis);
      }
      if (!state.noBoard) {
        const { col, row } = cmd.to;
        if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
          return no('That is not a place on the board.');
        }
        // A Tether holds the controlled unit too: the Red Shoes moves it with
        // its own Movement, which is not Forced Movement (ruled 2026-09-25,
        // audit Phase 4, I16).
        const leash = tetherCap(target, state.tokens);
        if (leash && !leash(Math.floor(col / 3), Math.floor(row / 3))) {
          const x = (target.tether ?? []).filter((l) => l.role === 'tethered')[0]?.range ?? 0;
          return no(`${target.label} is Tethered and cannot be moved beyond ${x} Grids of the unit holding it (PDLH-202).`);
        }
        // The controlled unit's own Maneuver or Move Action is what moves it,
        // at that Movement's allowance and no further (audit Phase 4, E8).
        const crossed = Math.abs(Math.floor(col / 3) - Math.floor(target.col / 3)) + Math.abs(Math.floor(row / 3) - Math.floor(target.row / 3));
        const reach = movementCeiling(data, state, target, act ?? null);
        if (crossed > reach) {
          return no(`The Red Shoes moves ${target.label} with its own Movement, which reaches at most ${reach} Grid${reach === 1 ? '' : 's'}, and that Grid is ${crossed} away.`);
        }
        // Its own Crawl still cannot Break Away (6.1; ruled R2, audit Phase 7,
        // P7B 14).
        const terrain = crossed ? knownTerrain(data, state) : null;
        const held = terrain ? crawlHolders(data, target, act, state.tokens, terrain) : [];
        if (held.length) return no(`${target.label} is Melee Locked by ${held.map((x) => x.label).join(', ')}, and a Crawl cannot be used to Break Away (6.1).`);
      }
      return ok;
    }
    case 'accessTerminal': {
      if (!t) return no('That unit is not on the board.');
      const why = terminalAccessWhy(data, state, t, cmd.itemId);
      if (why) return no(why);
      // Only a won roll accesses it (p.87; ruled R2, audit Phase 7, P7C 2).
      // The shared window sends the access while the roll's record is still
      // open, so the record is read: settled, this Mech's, and won, the faces
      // judged the way both windows judge them (counterWon). A board that ran
      // the roll in its own local window keeps no record, and its window is
      // the judge there; at a strict guided table in a room that is only while
      // the paid Remote Access is still unspent, one access for one payment,
      // since a shared window spent it opening the record. A Freeform table
      // keeps its own judgement. The access was accepted straight after the
      // Tick, with no roll at all.
      const c = state.script?.counter;
      if (c && c.terminal === cmd.itemId) {
        if (c.initiatorUid !== t.uid) return no('That Counter-roll is not this Mech\'s.');
        const item = normaliseTasks(state.tasks).items.find((i) => i.id === cmd.itemId);
        const won = item ? counterWon(data, state.tokens, c, t, terminalStandIn(item, t.side, item.zone)) : null;
        if (won === null && (!c.initRoll || !c.respRoll || counterStage(data, state.tokens, c) !== 'done')) {
          return no('The Counter-roll against the Terminal is not settled yet: both hands and any Focus first (FAQ G4).');
        }
        if (won === false) return no('The Terminal held: a Remote Access that loses its Counter-roll accesses nothing (p.87).');
      } else if (getLocalSeat() && strictGuided(state)) {
        const owed = state.script?.counterOwed;
        if (owed?.uid !== t.uid || owed.actionId !== 'COMMON_REMOTE_ACCESS') {
          return no('A Terminal is accessed by winning the Counter-roll a Remote Access makes against it (p.87).');
        }
      }
      return ok;
    }
    case 'blink': {
      if (!t) return no('That unit is not on the board.');
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      // The named Action must really BE a position swap, or any Action with a
      // Range could be sent as a blink and teleport off it.
      if (!isPositionSwap(a)) return no('That Action does not exchange positions.');
      // A Movement Action like any other (6.3.2, 4.3.4), and in a guided game
      // it is performed inside this unit's own Opportunity. The swap passed
      // Immobilized, with no Chassis and with no Opportunity at all (audit
      // Phase 4, E7). The sandbox has no Opportunities, so that half is guided.
      const stop = immobilizedStop(t, a) ?? chassisStop(t, a);
      if (stop) return no(stop);
      if (guidedGame(state) && !oppOf(state, cmd.uid)) return no('It is not this unit\'s Action Opportunity.');
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
      // A lent Mine Layer was this Mech's Part where the walk began, and the
      // walk may have left its Carrier behind, so any allied Carrier's Load is
      // accepted here: the route is the driver's business (below; audit Phase
      // 5, G1).
      const a = findAction(data, state, cmd.uid, cmd.actionId)
        ?? loanedParts(data, state.tokens, t, { anywhere: true }).flatMap(({ card }) => card.actions ?? []).find((x) => x.id === cmd.actionId);
      if (!a) return no('This unit has no such Action.');
      if (projectileDelivery(a) !== 'lay') return no('That Action does not Lay anything.');
      const { col, row } = cmd.to;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cellsOf(state) || row >= cellsOf(state)) {
        return no('That is not a place on the board.');
      }
      // A Mine stands clear of terrain (Supplementary Rules 1.04, 1.3).
      const offTerrain = mineOnTerrain(data, state, col, row);
      if (offTerrain) return no(offTerrain);
      // Which Grids are legal and what the Move Range paid for is the route's
      // business, and the route is gone by the time this arrives — the driver
      // that drew it only offers Grids on it. Laying is a Passive, so unlike
      // every other Action there is no Tick to check here either.
      //
      // What the engine can hold (ruling I20; audit Phase 5, C6): a Mine Layer
      // that is intact, and on a strict guided table a Lay during the layer's
      // own Movement, in a Grid on some route from where that Movement began
      // to where it stands within its reach. Any Grid, in any phase, was taken.
      const owned = findAction(data, state, cmd.uid, cmd.actionId);
      const partWhy = owned ? actionPartWhy(data, t, owned) : null;
      if (partWhy) return no(partWhy);
      if (guidedGame(state) && strictNow(state) && !state.noBoard) {
        const o = oppOf(state, cmd.uid);
        if (!o) return no(`${t.label} Lays Mines during its own Movement (FAQ M7).`);
        const key = (p: { col: number; row: number }): string => `${Math.floor(p.col / 3)},${Math.floor(p.row / 3)}`;
        const at = key(cmd.to);
        const walked = (cmd.route ?? []).map(key);
        if (walked.length > 1) {
          // The Movement it rides has just ended where the layer stands, and
          // began where the Opportunity says it did once that is recorded.
          if (walked[walked.length - 1] !== key(t)) return no(`${t.label} Lays along the Movement it has just made, which ends where it stands (FAQ M7).`);
          if (o.moved && o.movedFrom && !(o.route ?? []).includes(walked[0])) return no(`That route did not start where ${t.label}'s Movement began (FAQ M7).`);
          const reach = Math.max(movementCeiling(data, state, t, null),
            ...tokenCards(data, t).flatMap(({ card }) => card.actions ?? []).filter((x) => x.type === 'Moving').map((x) => movementCeiling(data, state, t, x)));
          if (walked.length - 1 > reach) return no(`That route is longer than ${t.label}'s Movement (FAQ M7).`);
          // A Flight Move's path is only its start and landing (FAQ M29).
          const grids = cmd.flying || t.aerial ? [walked[0], walked[walked.length - 1]] : walked;
          if (!grids.includes(at)) {
            return no(cmd.flying || t.aerial
              ? `A Flight Move's path is only its start and landing Grids, so ${t.label} Lays in one of those (FAQ M29).`
              : `That Grid is not on ${t.label}'s route (FAQ M7).`);
          }
        } else {
          // No route carried: the Grids the Opportunity recorded, a flight's
          // two ends among them (4.3.2; ruling I22).
          if (!o.moved) return no(`${t.label} Lays Mines during its own Movement (FAQ M7).`);
          if (!(o.route ?? []).includes(at)) return no(`That Grid is on no route of ${t.label}'s Movement (FAQ M7).`);
        }
      }
      return ok;
    }
    case 'despawn': {
      if (!state.tokens.some((x) => x.uid === cmd.targetUid)) return no('That unit is not on the board.');
      return ok;
    }
    case 'recoverBit': {
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      const port = a ? bitPortOf(a) : undefined;
      if (!a || !port) return no('That Action recovers no Bit.');
      const bit = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!bit || !bitsToRecover(data, [bit], t, a, !!state.noBoard).length) {
        return no(`That is not one of your own "White Dwarf" Bits within Range ${port.range} (292_A).`);
      }
      const held = t.ammo?.[a.id];
      const max = ammoMax(data, t, a.id);
      if (held !== undefined && max !== undefined && held >= max) {
        return no('The Bit Port still holds its Ammo Token: a Bit is Recovered into an empty Port.');
      }
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
      // Performed in the unit's own activation, as the Stance Change Action it
      // is (audit Phase 5, G5). A strict guided game holds it.
      if (guidedGame(state) && strictNow(state) && !oppOf(state, cmd.uid)) return no(`${t.label} does not hold an activation, so it cannot change Stance now.`);
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
      // Not measured on a table with no board: every unit stands on a
      // placeholder cell there (a Freeform pad puts the squads 33 rows apart),
      // so the Tether was refused on every hit and the arm was left on its
      // Tether Mode face with no leash. settleTethers skips such a table too.
      if (!state.noBoard && rangeBetween(t, target).range > cmd.range) {
        return no(`${target.label} is already further than ${cmd.range} Grids away.`);
      }
      return ok;
    }
    case 'cutTether': {
      if (!t) return no('That unit is not on the board.');
      if (!(t.tether ?? []).some((x) => x.uid === cmd.targetUid)) return no('No Tether joins those two units.');
      return ok;
    }
    case 'flyToTarget': {
      if (!t || t.kind !== 'projectile') return no('Only a Projectile flies into its target\'s Grid.');
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (!a || !fliesToTarget(a)) return no('That Action flies nothing into a target\'s Grid.');
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target || target.deployed === false) return no('That target is not on the board.');
      if (!state.noBoard && rangeBetween(t, target).range > (a.range ?? 0)) return no(`${target.label} is out of ${t.label}'s Range.`);
      // A Missile Group's Units attack the same target: the one its first Unit
      // picked, while it stands (p.94; ruling I12; audit Phase 5, A5).
      const gt = t.groupTarget !== undefined ? state.tokens.find((x) => x.uid === t.groupTarget) : undefined;
      if (gt && gt.uid !== target.uid && alive(gt) && gt.deployed !== false) {
        return no(`A Missile Group's Units attack the same target, and this group's is ${gt.label} (p.94).`);
      }
      return ok;
    }
  }
}

// C4 of the 2026-09-25 audit. A hand-set Part state is the table's record of
// damage it resolved itself, so crossing INTO Destroyed carries what a
// Penetration carries - the Link (4.4.4, Fortitude aside), the lost-Part ledger
// cards 300 and 500 read, the kill that Annihilation, Weapon Test and Mercy
// count, and the Integrity-Loss credit (FAQ P4) - and crossing back OUT takes
// them off again, so a mis-tap costs one more tap and nothing else. It used to
// record the state and nothing more. The credit goes to the OTHER squad: no
// one else can have done it, and on a one-phone pad the recorder's own seat
// says nothing about who fired. The unit id is unknown, so it is 0, which no
// Weapon Test target ever is.
function handTapBookkeeping(data: GameData, state: GameState, t: Token, slot: string, was: PartState, now: PartState, by?: number): void {
  const into = was !== 'destroyed' && now === 'destroyed';
  const outOf = was === 'destroyed' && now !== 'destroyed';
  if (!into && !outOf) return;
  // The unit the tap names, or the other squad when it names none (D8). A tap
  // back out retracts what the tap in credited.
  const named = by !== undefined ? state.tokens.find((x) => x.uid === by) : undefined;
  const killer = named
    ? { side: named.side, uid: named.uid }
    : outOf && t.lastDamagedBy ? t.lastDamagedBy : { side: (t.side === 's1' ? 's2' : 's1') as Side, uid: 0 };
  const victim = { side: t.side, kind: t.kind, lowValue: lowValueUnit(data, t) };
  const whole = slot === (t.kind === 'mech' ? 'torso' : 'main');
  const tasks = normaliseTasks(state.tasks);
  if (into) {
    if (t.kind === 'mech') {
      if (!keepsLinkOnPartLoss(data, t)) {
        t.link = Math.max(0, (t.link ?? 0) - 1);
        if (t.link === 0 && t.stance !== 'shutdown') t.stance = 'shutdown';
      }
      t.lastDamagedBy = killer;
      recordPartLoss(tasks, t, slot);
      applyKill(tasks, killer, victim, 'part');
    }
    if (whole) {
      applyKill(tasks, killer, victim, 'unit');
      recordUnitLoss(tasks, t);
    }
  } else {
    if (t.kind === 'mech') {
      // The Link comes back; the Stance does not - leaving Shutdown takes a
      // Reboot whatever put the Mech there (4.1.1).
      if (!keepsLinkOnPartLoss(data, t)) t.link = Math.min(maxLink(data, t), (t.link ?? 0) + 1);
      unrecordPartLoss(tasks, t, slot);
      retractKill(tasks, killer, victim, 'part');
    }
    if (whole) {
      retractKill(tasks, killer, victim, 'unit');
      for (const s of Object.keys(t.partStates)) if (t.partStates[s as PartSlot | 'main'] !== 'destroyed') unrecordPartLoss(tasks, t, s);
    }
  }
  state.tasks = tasks;
}

// INTEGRITY LOSS (4.4.4, 3.7.1): a Mech down to 2 Parts leaves in the End
// Phase, the kill credited to the LAST unit that reduced its Part count (FAQ
// P4). One implementation for the Guided End Phase's Remove step and the
// scriptless round turn a Freeform pad makes, which never removed one at all.
function removeIntegrityLoss(data: GameData, state: GameState): void {
  // A Mech whose Torso is already destroyed was credited when it died: the pad
  // keeps it in its tokens for its destroyed list, and counting it here again
  // paid Annihilation twice (audit Phase 6, D4).
  const dying = state.tokens.filter((x) => x.kind === 'mech'
    && (x.partStates.torso ?? 'intact') !== 'destroyed'
    && Object.values(x.partStates).filter((p) => p !== 'destroyed').length <= 2);
  if (!dying.length) return;
  const tasks = normaliseTasks(state.tasks);
  for (const v of dying) {
    if (v.lastDamagedBy) applyKill(tasks, v.lastDamagedBy, { side: v.side, kind: v.kind, lowValue: lowValueUnit(data, v) }, 'unit', 'integrity');
    // Everything still bolted to it leaves with it. A Mech can withdraw
    // on Integrity Loss with a live backpack, and the -1 riders are owed
    // all the same — nothing on the board records that after this line.
    recordUnitLoss(tasks, v);
    // Its Black Boxes do not: they stay in the Grid it stood in (ruling I20).
    // They vanished with it (audit Phase 6, F9).
    leaveBoxes(tasks, v, true);
  }
  state.tasks = tasks;
  state.tokens = state.tokens.filter((x) => !dying.includes(x));
}

// WHAT A FOCUS COSTS, in one place: the `focus` command and a Counter-roll's
// Focus declare both pay through it, so the two cannot disagree about Cadaver
// or about the Shutdown at 0.
// A White Dwarf Bit's Focus is paid by the Mech Karl Fried pilots (ACE-01;
// audit Phase 2, D4), so the debit lands on the payer.
// High Temperature, the pass-through half of a walk: a Fragile Token for every
// hot Grid entered short of the landing (the landing is settleEnvironments').
function walkHeat(
  state: GameState,
  t: Token,
  from: { col: number; row: number },
  to: { col: number; row: number },
  via: { col: number; row: number }[],
): void {
  const landing = { c: Math.floor(to.col / 3), r: Math.floor(to.row / 3) };
  const start = { c: Math.floor(from.col / 3), r: Math.floor(from.row / 3) };
  const walked: { c: number; r: number }[] = [];
  for (const p of via) {
    const g = { c: Math.floor(p.col / 3), r: Math.floor(p.row / 3) };
    if ((g.c === start.c && g.r === start.r) || (g.c === landing.c && g.r === landing.r)) continue;
    if (!walked.some((w) => w.c === g.c && w.r === g.r)) walked.push(g);
  }
  for (const g of envHotEntries(state, walked)) {
    void g;
    t.statuses = addStatus(t.statuses, 'fragile');
  }
}

// One face-up Command Token consumed. Flipped, not removed: 4.15.4 says a
// consumed token stays on the Torso face-down and can no longer be issued or
// used, and the End Phase collects it with everything else.
function flipCommand(state: GameState, m: Token): void {
  const l = [...(m.statuses ?? [])];
  const at = l.lastIndexOf('command');
  if (at < 0) return;
  l.splice(at, 1);
  m.statuses = [...l, 'commandUsed'];
  syncCommandPool(state);
}

function payFocus(data: GameData, t: Token, tokens: Token[] = []): void {
  if (focusIsFree(data, t)) return;
  const payer = t.kind === 'mech' ? t : focusPayer(data, tokens, t);
  if (!payer) return;
  payer.link = Math.max(0, (payer.link ?? 0) - 1);
  if (payer.link === 0 && payer.kind === 'mech' && payer.stance !== 'shutdown') payer.stance = 'shutdown';
}

// Every command lands through here, so the board's derived relationships are
// settled in ONE place afterwards rather than sprinkled over the movement
// branches. A Tether comes off when the two ends drift apart, and they can
// drift on a Maneuver, a Knockback, a Push, a Prototype Blink, a Crush
// displacement or a unit being destroyed mid-attack — six paths, one of which
// would have been missed. The sweep is a no-op on a board with no chips on it.
export function apply(data: GameData, state: GameState, cmd: Command): void {
  // Where everything stood, but only while something is camouflaged: the
  // Contact Reveal is judged against it below.
  const before = state.tokens.some((x) => statusCount(x.statuses, 'camouflage') > 0) ? positionsOf(state.tokens) : null;
  applyCommand(data, state, cmd);
  settleTethers(data, state);
  // Same shape, next card down: the High Temperature entry token and the
  // Fragile Platform collapse are derived from where things now STAND, so
  // every road onto a Grid - landing, knockback, Crush displacement, Blink,
  // deployment - settles identically on both seats. Events are dropped here;
  // the freeplay board narrates from its own call, and the Match Centre lets
  // the board redraw speak.
  settleEnvironments(data, state);
  // A Mine set off stays owed until it is resolved (FAQ I13; audit Phase 5,
  // C2), marked the same way.
  settleMines(data, state);
  // 4.12.2's Contact trigger, the same way: a Movement of either unit that ends
  // in Contact, whatever command carried it (a Maneuver, a knockback, a Crush
  // swap, a Blink, a Beacon or Mine laid into Contact), derived here so both
  // seats owe the same Reveal (audit Phase 3, C5).
  if (before) {
    for (const { t, by } of contactRevealsOwed(data, state.tokens, before)) oweReveal(state, t.uid, 'touch', by.uid);
  }
  // And its fifth trigger: the Part that Activated the camouflage destroyed,
  // whatever destroyed it, Reveals the unit where it stands, with no
  // Manifestation to choose, so there is nothing to owe: it simply happens, on
  // both seats alike (audit Phase 3, C11).
  for (const t of state.tokens) {
    if (!camoPartLost(data, t)) continue;
    t.statuses = (t.statuses ?? []).filter((id) => id !== 'camouflage');
    if (state.script) state.script.revealDue = (state.script.revealDue ?? []).filter((x) => x.uid !== t.uid);
  }
}

// A Reveal owed by a camouflaged unit, recorded once per cause.
function oweReveal(state: GameState, uid: number, why: 'act' | 'move' | 'touch', byUid?: number): void {
  const sc = state.script;
  if (!sc) return;
  const list = sc.revealDue ?? [];
  if (list.some((x) => x.uid === uid && x.why === why && x.byUid === byUid)) return;
  sc.revealDue = [...list, byUid === undefined ? { uid, why } : { uid, why, byUid }];
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
// `statuses` here. That block also drops the token's `expiring` entry, so a
// hand-rolled filter would be a second copy of the rule that keeps a unit's
// faces in step with what it carries. Low Profile is green and never turns red
// (p.97, FAQ J22; audit Phase 6, C5), so today there is no red face to leave
// behind; the one path is what keeps it that way.
// One call is enough: Low Profile is a Hexagon Token and a unit may bear only
// one (2.5.3), which addStatus enforces on the way in.
function shedLowProfile(data: GameData, state: GameState, t: Token): void {
  if (statusCount(t.statuses, 'lowProfile') === 0) return;
  applyCommand(data, state, {
    kind: 'removeStatus', seat: t.side, uid: t.uid, targetUid: t.uid, statusId: 'lowProfile',
  });
}

// A free table's hand-marked Ticks (Token.freeTicks) belong to one Action
// Opportunity. Every path that starts the Opportunities over clears them, so a
// round, a reset or a new match never opens on last round's marks.
function clearFreeTicks(state: GameState): void {
  for (const x of state.tokens) delete x.freeTicks;
}

function applyCommand(data: GameData, state: GameState, cmd: Command): void {
  if (cmd.kind === 'advancePhase') {
    // No attack survives a phase turn. The defence handshake and the published
    // combat view are per-attack state; left standing, an attacker who
    // reloaded mid-attack could never clear them and every later callDefense
    // was refused for the rest of the game.
    if (state.script) {
      state.script.combat = null;
      state.script.combatView = null;
      // Nor a Charge refund or a Disarm the last hit owed (audit Phase 7, P7A 8, 9),
      // nor a Counter-roll or a camouflage an Action paid for (P7C 1, 2).
      delete state.script.chargeBack;
      delete state.script.disarmOwed;
      delete state.script.counterOwed;
      delete state.script.camoOwed;
    }
    // The both-ready agreement is consumed by the turn it authorised, so
    // every phase asks afresh — and a racing second advance finds the flags
    // gone and is refused, which is the idempotence.
    state.ready = {};
    const r = state.round;
    if (r.phase < PHASES.length - 1) {
      r.phase++;
      // Every Mech's Action Opportunity comes in this phase, so a free table's
      // hand-marked Ticks start over as it opens (3.4.5).
      if (PHASES[r.phase] === 'Action') clearFreeTicks(state);
      // The End Phase a table with no guided game turns in one go, AS IT OPENS
      // (3.7.1 then 3.7.2): Integrity Loss first, which a Freeform pad never
      // removed at all, then the tokens. At the phase's end the table's Award
      // came before the removal and missed its kill; now it scores after both
      // (audit Phase 6, B3). No guided game: no setup, as the tabletop sandbox
      // (whose guide gives it a script anyway, B4), or no script, as a
      // Freeform pad.
      if (PHASES[r.phase] === 'End' && cmd.sweep && (!state.script || !normaliseSetup(state.setup))) {
        removeIntegrityLoss(data, state);
        for (const x of state.tokens) ageTokens(x);
        clearCommandTokens(state);
      }
    } else {
      clearFreeTicks(state);
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
      //  - a Quartz in Shutdown does NOT recover. "A unit in Shutdown cannot
      //    trigger any effects on its own, including passive skills or pilot
      //    skills. For example, Quartz cannot restore Link through its own
      //    skill after entering Shutdown" (FAQ L3). This used to give it the
      //    Link and leave it Shutdown; the FAQ names this exact card.
      for (const x of state.tokens) {
        if (x.kind !== 'mech' || !pilotIs(data, x, 'LPA-19')) continue;
        if (x.partStates?.torso === 'destroyed') continue;
        if (x.stance === 'shutdown') continue;
        x.link = Math.min(maxLink(data, x), (x.link ?? 0) + 1);
      }
      // ZHDR-303 N503 "Valkyrie", 安抚 Appease: "At the end of each Round, all
      // Ally Mechs within range recover 1 Link." On the rollover beside
      // Composure, for the same reason: it is the one moment every page shares.
      // Read AFTER the Integrity Loss removal, so a Valkyrie that left this End
      // Phase restores nothing. Each Valkyrie in reach is its own aura, and a
      // Shutdown Mech takes the Link and stays down (FAQ L3). A table with no
      // board cannot measure the reach, so the pad asks its player instead.
      if (!state.noBoard) {
        const ended = r.n - 1;
        for (const x of state.tokens) {
          if (x.kind !== 'mech' || x.deployed === false || x.partStates?.torso === 'destroyed') continue;
          const from = roundEndLinkSources(data, state.tokens, x);
          if (!from.length) continue;
          const was = x.link ?? 0;
          x.link = Math.min(maxLink(data, x), was + from.length);
          if (x.link === was) continue;
          const who = from.map((s) => s.source.label).join(' and ');
          x.log = [...(x.log ?? []), { round: ended, text: `Appease (${who}): ${x.label} recovers Link at the end of the round, now ${x.link}.` }].slice(-200);
        }
      }
    }
    return;
  }
  if (cmd.kind === 'setPhase') {
    state.ready = {};
    // Forward into the Action Phase opens it, as advancePhase does. Back into
    // it from a later phase is a correction, and must not wipe the marks the
    // player went back to fix.
    if (PHASES[cmd.phase] === 'Action' && state.round.phase < cmd.phase) clearFreeTicks(state);
    state.round.phase = cmd.phase;
    return;
  }
  if (cmd.kind === 'resetRounds') {
    state.round.n = 1;
    state.round.phase = 0;
    state.commandTokens = { s1: 0, s2: 0 };
    clearFreeTicks(state);
    // Plays are stamped with a round number, so winding the track back to 1
    // would leave round 1's cards reading as already spent. The smoke marker
    // is a round number too, and would refuse round 1's dissipation.
    state.tacticsPlayed = { s1: [], s2: [] };
    delete state.smokeRound;
    if (state.script) {
      state.script.commits = {};
      state.script.revealed = [];
      // The End Phase checklist and the once-a-round ledger are stamped with a
      // round number, so round 1 again would read as already done.
      state.script.endDone = [];
      state.script.oncePerRound = [];
    }
    // The First Player Token goes back to the roll's winner, not to whoever
    // held it at the reset (3.1.2; audit Phase 6, A8).
    const su = normaliseSetup(state.setup);
    const first = su?.first ?? (su ? firstPlayerFrom(su) : null);
    if (first) state.round.firstPlayer = first;
    // And the round-stamped score keys, which would stop the replayed rounds
    // from paying. One-off lines (a Secondary, the VIP) stay paid with the VP.
    if (state.tasks) {
      const tasks = normaliseTasks(state.tasks);
      tasks.scored = tasks.scored.filter((k) => !/^pad-round:\d+$/.test(k) && !/^main:s[12]:r\d+$/.test(k));
      state.tasks = tasks;
    }
    return;
  }
  if (cmd.kind === 'adjustCommandTokens') {
    if (!state.commandTokens) state.commandTokens = { s1: 0, s2: 0 };
    state.commandTokens[cmd.pool] = Math.max(0, state.commandTokens[cmd.pool] + cmd.delta);
    return;
  }
  if (cmd.kind === 'endSwarm') {
    const sc = state.script;
    if (!sc) return;
    sc.swarm = null;
    const phase = PHASES[state.round.phase];
    if (phase === 'Command') sc.turn = nextTurn(state, phase, cmd.seat, data) ?? cmd.seat;
    return;
  }
  if (cmd.kind === 'passTurn') {
    const sc = state.script;
    const phase = PHASES[state.round.phase];
    if (!sc || !isLoopPhase(phase)) return;
    // Passing declines Swarm Tactics going on as well.
    if (swarmFor(state, cmd.seat)) sc.swarm = null;
    if (!sc.passed.includes(cmd.seat)) sc.passed.push(cmd.seat);
    sc.turn = nextTurn(state, phase, cmd.seat, data) ?? cmd.seat;
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
      removeIntegrityLoss(data, state);
    }
    if (cmd.step === 'tasks' && !state.noBoard) {
      const tasks = normaliseTasks(state.tasks);
      settleControl(tasks, zoneCells(data, state), state.tokens, (x) => lowValueUnit(data, x));
      state.tasks = tasks;
    }
    const key = `${state.round.n}:end:${cmd.step}`;
    if (!sc.endDone.includes(key)) sc.endDone.push(key);
    return;
  }
  if (cmd.kind === 'adjustVp') {
    // The VP and nothing else: no kill marked paid, no step ticked (audit
    // Phase 6, D3). Floored at zero like the Award (5.2.4).
    const tasks = normaliseTasks(state.tasks);
    tasks.vp[cmd.side] = Math.max(0, tasks.vp[cmd.side] + cmd.by);
    state.tasks = tasks;
    return;
  }
  if (cmd.kind === 'concede') {
    const tasks = normaliseTasks(state.tasks);
    tasks.conceded = cmd.seat;
    state.tasks = tasks;
    return;
  }
  if (cmd.kind === 'award') {
    const tasks = normaliseTasks(state.tasks);
    // The Award judges control as part of the same reading of the board that
    // it scores (5.3.2), so the settlement happens here too. With no board the
    // claims stand as the table set them (claimItem).
    if (!state.noBoard) settleControl(tasks, zoneCells(data, state), state.tokens, (x) => lowValueUnit(data, x));
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
    const squadName = typeof cmd.name === 'string' ? cleanName(cmd.name) : '';
    if (squadName && !state.sideNames?.[cmd.seat]) {
      state.sideNames = { ...(state.sideNames ?? {}), [cmd.seat]: squadName };
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
    if (cmd.noBoard !== undefined) state.noBoard = cmd.noBoard ? true : undefined;
    if (cmd.tableDice !== undefined) state.tableDice = cmd.tableDice ? true : undefined;
    if (cmd.guidedPlay !== undefined) state.guidedPlay = cmd.guidedPlay ? true : undefined;
    if (cmd.unlocked !== undefined) state.unlocked = cmd.unlocked ? true : undefined;
    if (cmd.map !== undefined) {
      state.map = cmd.map;
      state.removedTerrain = [];
    }
    // Written even when it is 12, and DELETED rather than stored, so a state
    // that went back to a printed map does not keep a stale larger size.
    if (cmd.grids !== undefined) {
      if (cmd.grids === 12) delete state.grids;
      else state.grids = cmd.grids;
    }
    // The zones this table plays with, already resolved from the map and Task
    // by whoever sent this (only they can read a custom map's storage). NULL
    // clears back to the shipped nine; absent leaves them alone.
    //
    // NORMALISED, never stored raw — the same treatment cmd.tasks gets below.
    // This command arrives over the wire, and a malformed payload that threw
    // inside apply() would stop the receiving seat's command stream dead. A
    // row that does not parse is dropped; a payload with nothing usable in it
    // reads as a clear, which is the shipped-default in both cases.
    if (cmd.zones !== undefined) {
      const zs = (Array.isArray(cmd.zones) ? cmd.zones : [])
        .filter((z) => z && typeof z.id === 'string' && typeof z.name === 'string' && Array.isArray(z.cells))
        .map((z) => ({ id: z.id, name: z.name, cells: z.cells.filter((c): c is string => typeof c === 'string') }));
      if (zs.length) state.zones = zs;
      else delete state.zones;
    }
    if (cmd.deployZones !== undefined) {
      const refs = (v: unknown): string[] =>
        (Array.isArray(v) ? v : []).filter((c): c is string => typeof c === 'string');
      const dz = { black: refs(cmd.deployZones?.black), white: refs(cmd.deployZones?.white) };
      if (dz.black.length || dz.white.length) state.deployZones = dz;
      else delete state.deployZones;
    }
    if (cmd.zoneSet !== undefined) state.zoneSet = cmd.zoneSet;
    if (cmd.mission !== undefined) {
      // A DIFFERENT Main Task drops what the old one had named. The Commanders
      // belong to VIP: Assassination alone, and they went on showing - and would
      // have gone on scoring - after the table changed to another Task. Done
      // here because a caller that sends only `mission` (the pad) keeps the rest
      // of the TaskState; one that sends `tasks` replaces it just below anyway.
      if (cmd.mission !== state.mission && state.tasks) {
        const kept = normaliseTasks(state.tasks);
        kept.leader = {};
        state.tasks = kept;
      }
      state.mission = cmd.mission;
    }
    if (cmd.tasks !== undefined) state.tasks = cmd.tasks === null ? null : normaliseTasks(cmd.tasks);
    if (cmd.scale !== undefined) state.scale = cmd.scale;
    if (cmd.roundLimit !== undefined) state.roundLimit = cmd.roundLimit;
    return;
  }
  if (cmd.kind === 'startMatch') {
    // The state half of "Start game": both ends of a wire begin the identical
    // match. Anything already standing goes back to its squad for deployment,
    // rebuilt from its loadout: every Part intact, Link full, no Tokens, Ammo
    // and Interception refilled. A launched unit is not part of the squad. A
    // rematch started damaged, on the old score, with its Tactics Cards spent
    // (audit Phase 6, A4).
    state.tokens = state.tokens
      .filter((t) => t.kind !== 'projectile' && t.parentUid === undefined)
      .map((t) => freshUnit(data, state, t));
    for (const t of state.tokens) t.deployed = false;
    state.tasks = freshTasks(data, state);
    state.tacticsPlayed = { s1: [], s2: [] };
    state.removedTerrain = [];
    clearFreeTicks(state);
    state.smoke = [];
    delete state.smokeRound;
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
    // Through the same normaliser a loaded script uses: the entries come from
    // the other side, and the undo menu prints their fields.
    if (sc) sc.rollbackCatalog = normaliseCatalog(cmd.entries);
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
    if (sc) sc.rollback = { by: cmd.seat, round: cmd.round, phase: cmd.phase, label: cleanName(String(cmd.label ?? '')) || 'an action', ...(cmd.seq !== undefined ? { seq: cmd.seq } : {}) };
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
  if (cmd.kind === 'placeTaskItem') {
    const tasks = normaliseTasks(state.tasks);
    const item = tasks.items.find((i) => i.id === cmd.itemId);
    if (!item) return;
    item.col = cmd.to.col;
    item.row = cmd.to.row;
    item.set = cmd.seat;
    state.tasks = tasks;
    return;
  }
  if (cmd.kind === 'pickSecondary') {
    const tasks = normaliseTasks(state.tasks);
    tasks.secondary[cmd.seat] = cmd.cardId;
    // Changing the card drops whatever the old one had named, so a Task never
    // carries a target chosen for a different card.
    tasks.secTarget[cmd.seat] = undefined;
    tasks.zone[cmd.seat] = undefined;
    if (tasks.zoneHeld) tasks.zoneHeld = { ...tasks.zoneHeld, [cmd.seat]: undefined };
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
  if (cmd.kind === 'setInventory') {
    const inv = { ...(state.inventory ?? {}) };
    if (cmd.shared) inv[cmd.seat] = { boxes: { ...(cmd.boxes ?? {}) }, cards: { ...(cmd.cards ?? {}) }, ...(cmd.builtOnly ? { builtOnly: true } : {}) };
    else delete inv[cmd.seat];
    if (Object.keys(inv).length) state.inventory = inv;
    else delete state.inventory;
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
    clearFreeTicks(state);
    state.setup = null;
    state.tasks = null;
    state.removedTerrain = [];
    state.tokens = state.tokens.filter((t) => t.kind !== 'projectile');
    state.smoke = [];
    delete state.smokeRound;
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
    const winner = cmd.first ?? firstPlayerFrom(su);
    if (!winner) return;
    state.round.firstPlayer = winner;
    // The edge comes next, picked by the winner knowing the Main Task, and
    // the Secondaries after it (ruling I3; audit Phase 6, A1). The winner is
    // kept for resetRounds (A8).
    state.setup = { ...su, stage: 'side', first: winner };
    return;
  }
  if (cmd.kind === 'finishTasks') {
    const su = normaliseSetup(state.setup) ?? newSetup();
    if (su.stage !== 'tasks') return;
    state.setup = { ...su, stage: 'deploy' };
    return;
  }
  if (cmd.kind === 'pickEdge') {
    const su = normaliseSetup(state.setup) ?? newSetup();
    const fp = state.round.firstPlayer;
    const other: Side = fp === 's1' ? 's2' : 's1';
    state.setup = { ...su, stage: 'tasks', edge: { ...su.edge, [fp]: cmd.edge, [other]: cmd.edge === 'black' ? 'white' : 'black' } };
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
  if (cmd.kind === 'rollTerminal') {
    const c = state.script?.counter;
    if (c && c.terminal !== undefined) c.respRoll = [...cmd.faces];
    return;
  }
  if (cmd.kind === 'clearCounterRoll') {
    const sc = state.script;
    if (!sc) return;
    // The next Responder of an Action on every enemy in Range, as a fresh
    // exchange: its own rolls, its own Focus, its own verdict. One that has
    // left the board since is passed over.
    const c = sc.counter;
    const at = (c?.rest ?? []).findIndex((u) => state.tokens.some((x) => x.uid === u));
    sc.counter = c && at >= 0 ? {
      initiatorUid: c.initiatorUid,
      responderUid: c.rest![at],
      actionId: c.actionId,
      initRoll: null,
      respRoll: null,
      initFocused: false,
      respFocused: false,
      initDeclare: null,
      respDeclare: null,
      provoke: null,
      thenAttack: null,
      ...(c.rest!.length > at + 1 ? { rest: c.rest!.slice(at + 1) } : {}),
    } : null;
    return;
  }
  if (cmd.kind === 'placeSmoke') {
    state.smoke = [...(state.smoke ?? []), { col: cmd.at.col, row: cmd.at.row, side: cmd.for ?? cmd.seat }];
    return;
  }
  if (cmd.kind === 'setEnvironment') {
    const rest = (state.environments ?? []).filter((e) => !(e.col === cmd.at.col && e.row === cmd.at.row));
    const next = cmd.card === null
      ? rest
      : [...rest, { card: cmd.card, col: cmd.at.col, row: cmd.at.row }];
    // Absent rather than empty, so a board with no cards on it serialises the
    // way every board did before Environment Cards existed.
    if (next.length) state.environments = next;
    else delete state.environments;
    // A High Temperature card laid UNDER a standing unit is not that unit
    // entering the Grid, but the settle sweep about to run cannot tell "the
    // card appeared beneath me" from "I appeared beneath the card" - both read
    // as standing there unmarked. Pre-marking the bystanders keeps the token
    // for actual entries.
    if (cmd.card === 'high-temperature') {
      for (const t of state.tokens) {
        if (Math.floor(t.col / 3) === cmd.at.col && Math.floor(t.row / 3) === cmd.at.row) {
          t.envSeen = `${cmd.at.col},${cmd.at.row}`;
        }
      }
    }
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
    const at = list.findIndex((x) => x.col === cmd.at.col && x.row === cmd.at.row && (cmd.side === undefined || x.side === cmd.side));
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
    state.smokeRound = state.round.n;
    return;
  }
  if (cmd.kind === 'forceMove') {
    const target = state.tokens.find((x) => x.uid === cmd.targetUid);
    if (!target) return;
    // High Temperature along the pushed line, landing excluded for the same
    // reason the maneuver excludes it: settleEnvironments owns endpoints.
    // Forced Movement is never a flight, so every Grid on the line is entered.
    if (cmd.via?.length) {
      const landing = { c: Math.floor(cmd.to.col / 3), r: Math.floor(cmd.to.row / 3) };
      const begin = { c: Math.floor(target.col / 3), r: Math.floor(target.row / 3) };
      const line: { c: number; r: number }[] = [];
      for (const p of cmd.via) {
        const g = { c: Math.floor(p.col / 3), r: Math.floor(p.row / 3) };
        if ((g.c === begin.c && g.r === begin.r) || (g.c === landing.c && g.r === landing.r)) continue;
        if (!line.some((w) => w.c === g.c && w.r === g.r)) line.push(g);
      }
      for (const g of envHotEntries(state, line)) {
        void g;
        target.statuses = addStatus(target.statuses, 'fragile');
      }
    }
    if (!state.noBoard) {
      target.col = cmd.to.col;
      target.row = cmd.to.row;
      stampBoxDrops(state, target, true);
    }
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
    // Into the Abyss, say: a Box no Penetration owes stays where it fell
    // (ruling I20; audit Phase 6, F9).
    if (cmd.what === 'unit') leaveBoxes(tasks, victim);
    state.tasks = tasks;
    // A destroyed Unit leaves the board (4.4.4); the tally above is all that
    // is left of it. One that detonates as it is destroyed stays as a wreck
    // until its blast is resolved, whose own despawn removes it: taken off
    // here, the Martyrdom and the Self-Destruct were never owed (audit Phase
    // 6, D5).
    if (cmd.what === 'unit' && !blowsWhenDestroyed(data, victim)) state.tokens = state.tokens.filter((x) => x.uid !== cmd.targetUid);
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
    delete box.dropFrom;
    box.col = cmd.to.col;
    box.row = cmd.to.row;
    state.tasks = tasks;
    return;
  }

  if (cmd.kind === 'onBehalf') {
    applyCommand(data, state, cmd.cmd);
    return;
  }
  if (cmd.kind === 'setPartState') {
    const target = state.tokens.find((x) => x.uid === cmd.uid);
    if (!target) return;
    const was = target.partStates[cmd.slot] ?? 'intact';
    target.partStates[cmd.slot] = cmd.state;
    handTapBookkeeping(data, state, target, cmd.slot, was, cmd.state, cmd.by);
    // A worse state tapped by hand is a Penetration recorded by hand, and the
    // initiator's Tether goes with it as applyPenetration's does (PDLH-202).
    // The pad records every Penetration this way, so its Tethers never ended
    // (audit Phase 4, H3).
    const rank = { intact: 0, damaged: 1, destroyed: 2 } as const;
    if (rank[cmd.state] > rank[was]) {
      cutTethersOn(data, state, target, 'initiator');
      stampBoxDrops(state, target);
    }
    return;
  }
  if (cmd.kind === 'leaveGuided') {
    // What the game WAS stays; what made it Guided goes. Not endMatch: that one
    // wipes the Tasks and the score, which is exactly what must survive here.
    state.setup = null;
    delete state.script;
    state.guidedPlay = undefined;
    state.unlocked = undefined;
    state.ready = undefined;
    // Every unit is simply on the table now; nothing is waiting to deploy.
    for (const t of state.tokens) t.deployed = undefined;
    return;
  }
  if (cmd.kind === 'claimZone') {
    const tasks = normaliseTasks(state.tasks);
    tasks.zoneHeld = { ...(tasks.zoneHeld ?? {}), [cmd.side]: cmd.held ? true : undefined };
    state.tasks = tasks;
    return;
  }
  if (cmd.kind === 'claimItem') {
    const tasks = normaliseTasks(state.tasks);
    const item = tasks.items.find((i) => i.id === cmd.itemId);
    if (!item) return;
    // The same two fields settleControl writes, so the scorers cannot tell a
    // hand-set claim from a board-read one - which is the point of it.
    if (item.kind === 'control') item.control = cmd.side;
    else item.accessed = cmd.side;
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
    case 'renameUnit': {
      t.label = cleanName(cmd.label);
      return;
    }
    case 'setLoad': {
      const card = data.byId.get(t.cardId);
      if (!card) return;
      const fresh = makeDroneToken(state, data, card, t.side, cmd.cardId);
      // Rebuilt so the pools follow the Load; what the unit has been through
      // (its cell, name, damage, tokens, log) stays.
      Object.assign(t, fresh, {
        uid: t.uid, col: t.col, row: t.row, facing: t.facing, deployed: t.deployed, label: t.label,
        statuses: t.statuses, log: t.log,
        partStates: { ...fresh.partStates, main: t.partStates.main ?? 'intact' },
      });
      return;
    }
    case 'setFreeTicks': {
      const ticks = cmd.ticks ? normaliseFreeTicks(cmd.ticks) : undefined;
      if (ticks) t.freeTicks = ticks;
      else delete t.freeTicks;
      return;
    }
    case 'setStance': {
      // Choosing does NOT lock: cycling the dial to compare Stances is free
      // right up until the Mech acts. lockStance() below is what closes it.
      t.stance = cmd.stance;
      return;
    }
    case 'firewatch': {
      // The Link and the token in one command, so no seat holds half of it.
      t.link = Math.max(0, (t.link ?? 0) - 1);
      t.statuses = [...(t.statuses ?? []), 'command'];
      syncCommandPool(state);
      const o = oppOf(state, cmd.uid);
      if (o && sc) sc.opp = { ...o, firewatch: true };
      if (t.link === 0 && t.stance !== 'shutdown') t.stance = 'shutdown';
      return;
    }
    case 'stanceFeedback': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (target && target.kind === 'mech' && target.stance !== 'shutdown') target.stance = cmd.stance;
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
        o.performed = [...o.performed, REBOOT_ID];
        // A Reboot IS the Stance choice (4.1.1), so the one remaining Action
        // Tick must not be refused by the 4.1 lock gate.
        o.stanceLocked = true;
        // "will only have 1 Action Tick" (4.1.1, FAQ L8): the Extra Ticks a
        // Part granted at the start of the Opportunity go with the rest.
        o.extras = [];
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
      // An exchange The Red Shoes' controller made stamps its debt with where
      // it left the unit: the controlledMove that spends the debt records the
      // Movement ending there (ruled R1; audit Phase 7, P7D 1).
      if (t.side !== cmd.seat) {
        const debt = controlOver(state, t.uid, cmd.seat);
        if (debt) debt.placed = { col: cmd.to.col, row: cmd.to.row };
      }
      // No Opportunity accounting, deliberately — see check(). The Movement that
      // caused this is recorded by its own `maneuver`, which is where the
      // Maneuver Tick is spent on both pages.
      return;
    }
    case 'maneuver': {
      // NON-HUMANOID X: the Link is spent for PERFORMING the Action, so it is
      // paid on the Movement Action itself and never on a bare Maneuver. check()
      // has already refused a unit that cannot afford it; the clamp is here
      // because apply() is also the rollback replayer's road and must not push a
      // Link negative if it ever arrives without its check. Paid before the
      // branch below: a board and a table charge it in this one place.
      const cost = nonHumanoidCost(cmd.actionId ? findAction(data, state, cmd.uid, cmd.actionId) : null);
      if (cost > 0) t.link = Math.max(0, (t.link ?? 0) - cost);
      // And the Link the route paid an Obstruct lock instead of Range (LPA-20;
      // audit Phase 4, D2), clamped for the replayer like the line above.
      if (cmd.breakAwayLink) t.link = Math.max(0, (t.link ?? 0) - cmd.breakAwayLink);
      if (state.noBoard) {
        // The table moved the piece. Nothing here can measure how far, so the
        // Maneuver Tick is spent outright - the M2 Data Link's free pre-move
        // depends on a distance, and a distance of nothing would hand it out
        // every time. The Low Profile consequence (4.12.3) still applies.
        if (cmd.facing !== undefined) t.facing = cmd.facing;
        if (!maneuverIsSilent(data, t)) {
          shedLowProfile(data, state, t);
          if (!cmd.free && !cmd.resume && statusCount(t.statuses, 'camouflage') > 0) oweReveal(state, t.uid, 'move');
        }
        const o0 = oppOf(state, cmd.uid);
        if (o0 && sc && !cmd.free && !cmd.granted) sc.opp = lockStance(t, spendManeuver(o0));
        // A free or granted one is sent only once the table says the unit
        // moved, and it is still Movement for [Stationary] (audit Phase 4, E1),
        // the same reading the board branch below gives it.
        else if (o0 && sc) sc.opp = { ...o0, moved: true };
        takeMoveGrant(state, cmd);
        return;
      }
      const from = cmd.from ?? { col: t.col, row: t.row };
      const faced = t.facing;
      t.col = cmd.to.col;
      t.row = cmd.to.row;
      if (cmd.facing !== undefined) t.facing = cmd.facing;
      // 4.12.3: "Maneuver does not benefit from Silence unless otherwise
      // specified" — Maneuvering, INCLUDING changing facing without Movement,
      // removes the Low Profile Token. This one command carries both cases: a
      // pivot arrives with `to` equal to the Grid the unit already stands in,
      // which is exactly how the Match Centre sends a turn on the spot.
      //
      // Silent only through a Stealth Chassis (card 100 LM210S, NOT PL29, which
      // lost it in the v1.021 redesign; see maneuverPrintsSilence in units.ts).
      // No aura strips it: the Patrol Eagle takes Silence from Actions, and a
      // Maneuver is not one (audit Phase 3, F14). A `free` move is the Movement
      // of an Action already performed, whose own Silence was judged then.
      if (!maneuverIsSilent(data, t)) {
        shedLowProfile(data, state, t);
        if (!cmd.free && !cmd.resume && statusCount(t.statuses, 'camouflage') > 0) oweReveal(state, t.uid, 'move');
      }
      // A Move Action's own Silence was judged where it began, by performAction.
      // Its landing is judged here: an enemy Patrol Eagle it lands beside takes
      // the Silence away at either end, the reading the freeplay settle gives it.
      if (cmd.free && cmd.actionId) {
        const act = findAction(data, state, cmd.uid, cmd.actionId);
        const began = { ...t, col: from.col, row: from.row };
        const denier = act?.type === 'Moving' && isSilentAction(data, state.tokens, began, act)
          ? actionSilenceDenier(data, state.tokens, t, act)
          : undefined;
        if (denier) {
          shedLowProfile(data, state, t);
          if (statusCount(t.statuses, 'camouflage') > 0) oweReveal(state, t.uid, 'act', denier.source.uid);
        }
      }
      // High Temperature, the pass-through half: every Grid the walk entered
      // short of the landing. The landing is settleEnvironments' turf - it
      // runs right after this in apply() and owns endpoint entries from every
      // command, so granting it here too would cook the unit twice. A flight
      // enters only its landing Grid, so it leaves nothing for this half.
      if (!cmd.flying && !t.aerial && cmd.via?.length) walkHeat(state, t, from, cmd.to, cmd.via);
      // A walk that left its Grid and came back to the cell it stood on has
      // ENTERED it, so a Mine that arrived on it spares it no longer; ending
      // anywhere else, settleMines sees that for itself (audit Phase 5, C3).
      if (cmd.via?.some((v) => Math.floor(v.col / 3) !== Math.floor(from.col / 3) || Math.floor(v.row / 3) !== Math.floor(from.row / 3))) {
        forgetMineSpares(state.tokens, t.uid);
      }
      const o = oppOf(state, cmd.uid);
      // A Movement Action already paid with an Action Tick, and one a card
      // handed out was never charged to the Opportunity at all.
      if (o && sc && !cmd.free && !cmd.granted && !cmd.resume) {
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
      } else if (o && sc && (from.col !== cmd.to.col || from.row !== cmd.to.row || t.facing !== faced || cmd.spun)) {
        // A free or granted Movement costs no Tick but is still Movement, and
        // [Stationary] asks whether the unit performed ANY Movement in its
        // Opportunity (p.96, FAQ K24), a turn on the spot included (E3). A
        // Shock Attack's walk left `moved` false, so the Tempest kept its Extra
        // Firing Tick and a Railgun its Stationary Range (audit Phase 4, E1).
        // A full circle on the spot too, which ends facing the same way
        // (Supplementary Rules 1.04, 1.8).
        sc.opp = { ...o, moved: true, movedFrom: o.movedFrom ?? from };
      }
      // The Mine's stop, and the going on (ruling I16; audit Phase 5, C1).
      if (sc?.opp && sc.opp.uid === t.uid && (cmd.halt !== undefined || cmd.resume)) {
        sc.opp = { ...sc.opp, mineHalt: cmd.halt && cmd.halt > 0 ? cmd.halt : undefined };
      }
      // The Grids this Movement entered, where a Black Box may be picked up: a
      // flight only its start and landing (4.3.2; ruling I22; audit Phase 6,
      // F5, F10).
      if (sc?.opp && sc.opp.uid === t.uid) {
        const key = (p: { col: number; row: number }): string => `${Math.floor(p.col / 3)},${Math.floor(p.row / 3)}`;
        const walked = [key(from), ...(cmd.flying || t.aerial ? [] : (cmd.via ?? []).map(key)), key(cmd.to)];
        sc.opp = { ...sc.opp, route: [...new Set([...(sc.opp.route ?? []), ...walked])].slice(-64) };
      }
      takeMoveGrant(state, cmd);
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
      if (a && !passive && !isSilentAction(data, state.tokens, t, a, cmd.partKey)) {
        shedLowProfile(data, state, t);
        // The same sentence's first half: the Reveal, recorded for every page to
        // read (audit Phase 3, C4). The activating Action is exempt, since
        // 4.12.2's trigger is for Actions performed while IN the state; any
        // Action before it found no camouflage to break.
        // An enemy aura that took the Action's Silence away is recorded with
        // it, so the Reveal can name it.
        if (statusCount(t.statuses, 'camouflage') > 0 && !activatesCamo(a)) {
          oweReveal(state, t.uid, 'act', actionSilenceDenier(data, state.tokens, t, a, cmd.partKey)?.source.uid);
        }
      }
      // The Ammo Token goes with the Action (4.13), for a granted one too. The
      // pages no longer spend it at the card button's click, which on the
      // Match Centre's card door would have paid it twice.
      if (a && spendsAmmoWhenPerformed(a)) {
        const { from, poolId } = ammoPay(data, state, t, a.id);
        if (from.ammo?.[poolId] !== undefined) from.ammo[poolId] = Math.max(0, from.ammo[poolId] - 1);
      }
      // NON-HUMANOID X at a table: pad Guided performs the Run with this command
      // and sends no `maneuver`, so the Link comes off here. On a board the move
      // pays it, the one road the sandbox also takes (audit Phase 4, E2).
      if (a && state.noBoard && t.kind === 'mech') {
        const cost = nonHumanoidCost(a);
        if (cost > 0) t.link = Math.max(0, (t.link ?? 0) - cost);
      }
      // A new Action closes what the last one left open: the refund of a Charge
      // spent for an attack then abandoned (the attack is being made now, or
      // another Action has begun), and the Disarm the last hit could cause.
      // An Action printing Disarm records that one as it is paid, before the
      // granted return, since a Riposte's Grappling Hook may Disarm too: every
      // page's attack window resolves the hit after the Action is paid (ruled
      // R3; audit Phase 7, P7A 8, 9).
      if (sc) {
        delete sc.chargeBack;
        if (a && disarmOn(a)) sc.disarmOwed = { uid: t.uid, actionId: a.id };
        else delete sc.disarmOwed;
        // The same for the Counter-roll this Action pays for: an Electronic
        // Attack, a Scan or a Remote Access buys one, and a Firing or Melee
        // Action the free Scan of each camouflaged unit it designates (FAQ
        // I12). A granted attack earns one too, so this comes before the
        // granted return (ruled R2; audit Phase 7, P7C 2).
        if (a && (isElectronicAttack(a) || isScanAction(a) || a.id === 'COMMON_REMOTE_ACCESS' || a.type === 'Firing' || a.type === 'Melee')) {
          sc.counterOwed = { uid: t.uid, actionId: a.id };
        } else delete sc.counterOwed;
        // And the Optical Camouflage an Action that Activates it may put on
        // (4.12.2; ruled R1, P7C 1).
        if (a && activatesCamo(a)) sc.camoOwed = { uid: t.uid, actionId: a.id };
        else delete sc.camoOwed;
      }
      // A granted Action spends its grant HERE, so taking the Action and
      // spending it are one step. Clearing the debt from the panel instead
      // leaves a window in which one Riposte buys several Melee Actions.
      if (cmd.granted && sc) {
        const kind = a?.type === 'Firing' ? 'overwatch' : 'riposte';
        const at = (sc.reactions ?? []).findIndex((r) => r.uid === cmd.uid && r.kind === kind);
        if (at >= 0) sc.reactions.splice(at, 1);
        // It belongs to no Opportunity, so there are no Ticks to charge.
        return;
      }
      // RWS in the Command Phase spends the activation the Command bought and
      // marks the Part fired (遥控武器: once per round).
      if (a && sc && t.kind === 'mech' && PHASES[state.round.phase] === 'Command' && isRwsAction(a)) {
        sc.oncePerRound.push(rwsFiredKey(state.round.n, t.uid, a.id));
        if (o) sc.opp = spendActivation(o, a);
        return;
      }
      if (a && o && sc) {
        // The length PAID: a designated Freehand can shorten it (card 129), and
        // the check above let the Action through on that same reading.
        const shaped = t.kind === 'mech' ? stanceShaped(a, t.stance) : a;
        const paidAs = (cmd.twoHanded ? twoHandedUse(data, t, shaped, boxHands(state.tasks, t.uid), loanedParts(data, state.tokens, t))?.action : null) ?? shaped;
        sc.opp = t.kind === 'mech'
          // The same startOpts the check read, so the SPEND agrees with the
          // check that let the Action through -- miss one and a Starting Action
          // FPA-01 or CQC allowed is re-read as needing an Extra Tick it never
          // used.
          ? lockStance(t, spendAction(o, paidAs, cmd.partKey || a.id, startOpts(data, state.tokens, t, a)))
          : spendActivation(o, a);
        // The grant this Action makes is owed until grantExtra hands it to an
        // ally, and only then (FAQ K3/K21; audit Phase 2, B1).
        if (sc.opp && extraActivationOf(a)) sc.opp.grantOwed = a.id;
        // And the Movement it carries, until a `free` maneuver makes it (B8).
        if (sc.opp && actionMoves(a)) sc.opp.moveOwed = true;
      }
      // The Charge and the Discard do their work in their own apply: the Part
      // the Action names is Charged (4.14) or turned over to its Discard Card
      // (4.17) by the command that pays for it. One command, one Undo, and no
      // page can pay without the effect or take the effect without paying (ruled
      // R2; audit Phase 7, P7A 2, 7). A unit's own Charge Action (543_B)
      // Charges the Part printing it. A bare key names nothing, and a table with
      // no guided game leaves the Part to its own tool.
      const chargeTo = a ? chargeSlotOf(data, t, a, cmd.partKey) : null;
      if (chargeTo && !(t.charge ?? []).includes(chargeTo)) t.charge = [...(t.charge ?? []), chargeTo];
      if (a?.id === 'COMMON_DISCARD' && t.kind === 'mech' && cmd.partKey?.startsWith('COMMON_DISCARD@')) {
        discardPartOn(data, t, cmd.partKey.slice('COMMON_DISCARD@'.length) as PartSlot);
      }
      // 045_B Barricade: "Switch this mech to Defensive Stance." An Action that
      // changes the Stance it is performed in, so it acts after the 4.1 lock the
      // spend just took, and leaves the lock on. Nothing read its change_stance
      // rule, and setStance afterwards was refused by that same lock (audit
      // Phase 2, D1). Cruise Mode passes every Stance change by.
      const shift = a ? selfStanceShift(a) : null;
      if (shift && t.kind === 'mech' && t.stance !== 'shutdown' && !cruising(data, t)) t.stance = shift;
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
    case 'linkTick': {
      const trait = linkTickTraitOn(data, t);
      const o = oppOf(state, cmd.uid);
      if (!trait || !o || !sc) return;
      t.link = Math.max(0, (t.link ?? 0) - 1);
      // The Tick IS the Stance choice, as Attack Mode's is: taking it locks the
      // Stance the trait asked for (FAQ L2), so the Mech cannot bank the Tick
      // and flip Stance before spending it.
      sc.opp = lockStance(t, { ...o, action: o.action + trait.perLink, linkTicks: (o.linkTicks ?? 0) + 1 });
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
      // A Command of its own: the Drone keeps the one its squad may still send
      // it (ruling I7; audit Phase 5, F9).
      if (spec.freeCommand && sc) {
        if (!sc.freeCommand.includes(t.uid)) sc.freeCommand.push(t.uid);
      }
      if (!state.tacticsPlayed) state.tacticsPlayed = { s1: [], s2: [] };
      state.tacticsPlayed[cmd.seat].push(`${state.round.n}:${cmd.cardId}`);
      // Hit and Run hands this unit a Maneuver, made by a `granted` maneuver
      // that takes the grant (audit Phase 2, B8).
      if (spec.maneuver && sc) sc.oncePerRound = [...(sc.oncePerRound ?? []), grantedMoveKey(state, t.uid)];
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
      // In Cruise Mode it is in Mobility: "Upon entering Cruise Mode, the mech
      // automatically switches to the mobility stance" (Ace Strategy
      // additional rules; ruling I28). Deployed so, it stood in Offensive, and
      // the Stance lock kept it there (audit Phase 5, H3).
      if (t.kind === 'mech' && cruising(data, t)) t.stance = 'mobility';
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
      stampBoxDrops(state, target);
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
    case 'setAuraReach': {
      const src = state.tokens.find((x) => x.uid === cmd.sourceUid);
      if (!src || !/^[A-Za-z0-9][\w-]*$/.test(cmd.actionId)) return;
      const inside = new Set((src.auraReaches ??= {})[cmd.actionId] ?? []);
      if (cmd.on) inside.add(cmd.targetUid);
      else inside.delete(cmd.targetUid);
      src.auraReaches[cmd.actionId] = [...inside].sort((x, y) => x - y);
      return;
    }
    case 'applyStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      // addStatus owns the single-Hexagon rule (2.5.3), so stacking through it
      // keeps the displacement identical on every seat.
      for (let i = 0; i < (cmd.stacks ?? 1); i++) target.statuses = addStatus(target.statuses, cmd.statusId);
      // The camouflage its Action paid for is on (ruled R1; audit Phase 7, P7C 1).
      if (cmd.statusId === 'camouflage' && sc?.camoOwed?.uid === target.uid) delete sc.camoOwed;
      // A replaced or refreshed Hexagon starts on its yellow face (FAQ J22):
      // the stale red marker would otherwise remove the fresh token a round
      // early. Squares keep theirs — each stacked entry ages on its own.
      const def = STATUSES.find((x) => x.id === cmd.statusId);
      // Camouflage strips the Hexagons too, and their red markers with them
      // (FAQ J14; audit Phase 6, C9).
      if (def?.shape === 'hexagon' || def?.clearsHexagons) {
        const hexes = new Set(STATUSES.filter((x) => x.shape === 'hexagon').map((x) => x.id));
        target.expiring = (target.expiring ?? []).filter((x) => !hexes.has(x));
      }
      // Red on both faces: it arrives showing red, one marker per entry, and
      // leaves at this round's End Phase (ruling I9). After the clean-up
      // above, which would otherwise take the marker straight off.
      if (def?.decay === 'red') {
        const n = statusCount(target.statuses, cmd.statusId);
        target.expiring = [...(target.expiring ?? []).filter((x) => x !== cmd.statusId), ...Array<string>(n).fill(cmd.statusId)];
      }
      if (target.expiring && !target.expiring.length) target.expiring = undefined;
      // A Command placed by hand is a Command the side may spend, so the pool
      // is recomputed from the board rather than nudged.
      if (COMMAND_FACES.has(cmd.statusId)) syncCommandPool(state);
      // 6.3.2 / FAQ J5: "Projectiles with an Electronic Value are destroyed
      // immediately if they obtain a Fire Control Interference Token." The EW
      // window has always SAID so and nothing ever did it, on any page. Here,
      // because every road to the Token - the window, a flash grenade, a hand
      // placing it - ends in this command. It leaves the board like any other
      // destroyed Unit (4.4.4); it is a Low Value Unit and scores nothing.
      if (cmd.statusId === 'fci' && target.kind === 'projectile' && electronicValue(data, target) > 0) {
        state.tokens = state.tokens.filter((x) => x.uid !== target.uid);
      }
      return;
    }
    case 'ageStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      const def = STATUSES.find((x) => x.id === cmd.statusId);
      const red = (target.expiring ?? []).includes(cmd.statusId);
      // Only a yellow token has a red side to turn to. A green one (Low
      // Profile) stays until it is removed, so a step takes it off (2.5.3, FAQ
      // J22; audit Phase 6, C5).
      if (red || def?.decay !== 'yellow') {
        // Through removeStatus's own apply, for the same reason shedLowProfile
        // goes that way: it owns the expiry bookkeeping and the Command pool.
        // A red step takes a RED face off a stack, and its marker with it
        // (types.ts shedToken): ageTokens flips every stacked entry, so
        // `expiring` can hold the id more than once.
        applyCommand(data, state, {
          kind: 'removeStatus', seat: cmd.seat, uid: cmd.uid, targetUid: cmd.targetUid, statusId: cmd.statusId,
          ...(red && def?.decay === 'yellow' ? { face: 'red' as const } : {}),
        });
        return;
      }
      target.expiring = [...(target.expiring ?? []), cmd.statusId];
      return;
    }
    case 'removeStatus': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      // ONE entry, so peeling one off a stacked Square leaves the rest - the
      // same end the freeplay chip reached by hand - of the face named, or a
      // yellow one first. shedToken keeps one red marker per red face left, so
      // a Token that is gone has no expiry left to track and a red survivor
      // stays red.
      if (!shedToken(target, cmd.statusId, cmd.face)) return;
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
      payFocus(data, t, state.tokens);
      return;
    }
    case 'restoreLink': {
      // Clamped by the pilot's Link Value, the same ceiling stabilise, reboot
      // and Aster's restore all use. Stance is left alone: no +1 Link path in
      // this engine wakes a Shutdown Mech, only `reboot` does (4.1.1).
      t.link = Math.min(maxLink(data, t), (t.link ?? 0) + 1);
      return;
    }
    case 'recoverLink': {
      // Same ceiling, same Stance rule: a Shutdown Mech regains the Link and
      // does not reboot (FAQ L3).
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (target) target.link = Math.min(maxLink(data, target), (target.link ?? 0) + 1);
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
      // A lent AMS pays from the Tokens on the Carrier (ruling I25).
      const payer = interceptPayer(data, state.tokens, t, cmd.actionId, !!state.noBoard);
      const bag = payer?.intercept;
      if (!payer || !bag || bag[cmd.actionId] === undefined) return;
      bag[cmd.actionId] = Math.max(0, bag[cmd.actionId] - 1);
      // A Part with no Token left owes nothing more: they are never restored
      // (4.9). A Volley of 2 into a Part holding 1 queued two attempts, and the
      // second, which nothing could pay, stranded the Match Centre's panel
      // (audit Phase 5, B2).
      if (bag[cmd.actionId] === 0 && sc?.intercepts) {
        sc.intercepts = sc.intercepts.filter((x) => !(x.actionId === cmd.actionId && (x.uid === t.uid || x.uid === payer.uid)));
      }
      return;
    }
    case 'restoreIntercept': {
      const payer = interceptPayer(data, state.tokens, t, cmd.actionId, !!state.noBoard) ?? t;
      const bag = payer.intercept;
      if (!bag || bag[cmd.actionId] === undefined) return;
      const max = interceptMax(data, payer, cmd.actionId);
      const next = bag[cmd.actionId] + 1;
      bag[cmd.actionId] = max !== undefined ? Math.min(max, next) : next;
      return;
    }
    case 'startCounterRoll': {
      if (!sc) return;
      // A Terminal never Focuses, so its declare is made as the record opens.
      const terminal = cmd.terminal !== undefined;
      sc.counter = {
        initiatorUid: cmd.uid,
        responderUid: terminal ? TERMINAL_UID : cmd.targetUid,
        actionId: cmd.actionId,
        initRoll: null,
        respRoll: null,
        initFocused: false,
        respFocused: false,
        initDeclare: null,
        respDeclare: terminal ? false : null,
        ...(terminal ? { terminal: cmd.terminal } : {}),
        provoke: null,
        thenAttack: cmd.thenAttack ? {
          actionId: cmd.thenAttack.actionId,
          ...(cmd.thenAttack.charged ? { charged: true } : {}),
          ...(cmd.thenAttack.chargeChoice ? { chargeChoice: cmd.thenAttack.chargeChoice } : {}),
          ...(cmd.thenAttack.twoHandedDeclined ? { twoHandedDeclined: true } : {}),
          ...(cmd.thenAttack.extra ? { extra: true } : {}),
        } : null,
      };
      // The roll its Action paid for is spent; a free Scan marks the unit its
      // attack has now Scanned, since that attack may designate others (ruled
      // R2; audit Phase 7, P7C 2).
      const owed = sc.counterOwed;
      if (owed && owed.uid === cmd.uid && !cmd.reaction) {
        if (cmd.thenAttack) owed.scanned = [...(owed.scanned ?? []), cmd.targetUid];
        else if (owed.actionId === cmd.actionId) delete sc.counterOwed;
      }
      // Target Tracing's Command Token, spent by the command that opens it. The
      // pages sent spendCommand first, and a Mech with one token then had none
      // face-up for this check to find: the roll was refused after the token
      // was gone (audit Phase 3, D8). The record keeps that it was the reaction.
      if (cmd.reaction) {
        flipCommand(state, t);
        sc.counter.reaction = true;
      }
      // The rest of an Action on every enemy in Range, in the order they come.
      const a = findAction(data, state, cmd.uid, cmd.actionId);
      if (a && electronicAll(a) && !cmd.reaction) {
        const rest = (state.noBoard ? [...new Set(cmd.also ?? [])] : electronicAllTargets(data, state.tokens, t, a).map((x) => x.uid))
          .filter((u) => u !== cmd.targetUid);
        if (rest.length) sc.counter.rest = rest;
      }
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
    case 'forceShutdown': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (target && target.kind === 'mech') target.stance = 'shutdown';
      return;
    }
    case 'declareCounterFocus': {
      const c = sc?.counter;
      if (!c) return;
      if (cmd.uid === c.initiatorUid) c.initDeclare = cmd.use;
      else if (cmd.uid === c.responderUid) c.respDeclare = cmd.use;
      else return;
      // The Whistle's Command Token, or else the Link, paid with the declare
      // through the focus command's own debit.
      const funder = cmd.use && cmd.whistleUid !== undefined ? state.tokens.find((x) => x.uid === cmd.whistleUid) : undefined;
      if (funder) flipCommand(state, funder);
      else if (cmd.use) payFocus(data, t, state.tokens);
      return;
    }
    case 'disarm': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target || target.kind !== 'mech' || !target.mech) return;
      // The Disarm it paid for is spent (ruled R3; audit Phase 7, P7A 8).
      if (sc?.disarmOwed?.uid === cmd.uid) delete sc.disarmOwed;
      // The far face is derived here rather than carried on the command, so the
      // wire cannot name a face the pointer does not: the same single-source
      // rule the crushSwap step-out grid follows. The Discard Action turns a
      // Part over through the same door (units.ts discardPartOn).
      discardPartOn(data, target, cmd.slot as PartSlot);
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
      // A spend may be refunded if the attack it paid for is abandoned before
      // any Action is performed; a refund uses that up (audit Phase 7, P7A 9).
      if (sc && !cmd.on) sc.chargeBack = { uid: t.uid, slot: cmd.slot };
      else if (sc?.chargeBack?.uid === t.uid && sc.chargeBack.slot === cmd.slot) delete sc.chargeBack;
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
      // A Counter-roll or a camouflage its Actions paid for is made in the
      // Opportunity or not at all (ruled R1, R2; audit Phase 7, P7C 1, 2).
      if (sc.counterOwed?.uid === cmd.uid) delete sc.counterOwed;
      if (sc.camoOwed?.uid === cmd.uid) delete sc.camoOwed;
      // Swarm Tactics goes on at once or not at all (172_B): the Warrior's
      // Opportunity ending with its token still waiting to move lets it lapse.
      if (sc.swarm?.issuer === cmd.uid) sc.swarm = null;
      // Hit and Run's moment: this Mech's Action Opportunity ending, an Extra
      // one included (ruling I28; audit Phase 6, H2).
      if (t.kind === 'mech' && PHASES[state.round.phase] === 'Action') sc.lastEnded = { uid: cmd.uid, round: state.round.n };
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
    case 'chooseTied': {
      if (!sc?.opp) return;
      sc.tieFirst = [t.uid, ...(sc.tieFirst ?? []).filter((u) => u !== t.uid)];
      // The glue derives this same Opportunity from the new order; opening it
      // here keeps a client that runs no glue on the same Mech.
      const fresh = newOpportunity(t.uid, sc.opp.timing);
      fresh.extras = extrasFor(data, t);
      sc.opp = fresh;
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
      flipCommand(state, t);
      return;
    }
    case 'coordinateCommand': {
      // The token leaves the Mech face-up and lands on the Drone face-down,
      // the same physical move the Command Phase makes (4.15.3).
      const from = state.tokens.find((x) => x.uid === cmd.uid);
      const to = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!from || !to) return;
      // Swarm Tactics going on moves the token it already issued (172_B), so
      // the Mech pays nothing more; otherwise its own face-up token goes.
      if (swarmByCoordination(state, from)) {
        if (sc) sc.swarm = null;
      } else {
        const l = [...(from.statuses ?? [])];
        const at = l.lastIndexOf('command');
        if (at < 0) return;
        l.splice(at, 1);
        from.statuses = l;
      }
      to.statuses = [...(to.statuses ?? []), 'commandUsed'];
      to.commandedBy = from.uid;
      swarmStarts(data, state, from, to);
      syncCommandPool(state);
      // "The same effect as a Command sent in the Command Phase" (4.15.3): the
      // Drone acts now, in an activation nested inside the Mech's the way an
      // Extra Action Opportunity nests (FAQ K21), so ending it resumes the Mech
      // and never marks the Drone as having acted. It used to sit commanded
      // with no activation to act in, and the Match Centre and pad Guided
      // refused its every Move and Action (audit Phase 5, F1).
      if (sc && PHASES[state.round.phase] === 'Action') {
        if (sc.opp) sc.oppStack.push({ ...sc.opp });
        const fresh = newOpportunity(to.uid, undefined);
        fresh.extra = true;
        fresh.commanded = true;
        sc.opp = fresh;
      }
      return;
    }
    case 'designate': {
      const phase = PHASES[state.round.phase];
      if (!sc || !isLoopPhase(phase)) return;
      if (phase === 'Command') {
        // Additional Instructions buys one Command Action outright, so the
        // token stays in the pool for this designation only.
        const free = sc.freeCommand.includes(cmd.uid);
        const going = swarmFor(state, t.side);
        if (going && t.kind === 'drone') {
          // Swarm Tactics going on: the Warrior's token moves from the last
          // Drone to this one, face-down, and the Warrior pays nothing more.
          // The last Drone keeps its Command this Phase (3.2.2), which the
          // face-down token it keeps on the card stands for (172_B).
          sc.swarm = null;
          t.statuses = [...(t.statuses ?? []), 'commandUsed'];
          t.commandedBy = going.issuer;
          const w = state.tokens.find((x) => x.uid === going.issuer);
          if (w) swarmStarts(data, state, w, t);
          syncCommandPool(state);
        } else if (free) sc.freeCommand = sc.freeCommand.filter((x) => x !== cmd.uid);
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
            swarmStarts(data, state, issuer, t);
          }
          syncCommandPool(state);
        }
        // A Mech is only ever designated here for RWS (遥控武器): the ledger
        // counts the Command against its Parts, once each per round. Drones
        // keep the `commanded` list, which is what excludes them from a second.
        if (t.kind === 'mech') sc.oncePerRound.push(rwsCommandKey(state.round.n, t.uid));
        else if (free && !going) {
          // Additional Instructions' Command Action: nothing else, and the
          // Drone keeps its own Command (ruling I7). The glue keeps the mark.
          sc.opp = { ...newOpportunity(cmd.uid, undefined), commandOnly: true };
        } else if (!sc.commanded.includes(cmd.uid)) sc.commanded.push(cmd.uid);
      } else if (!sc.acted.includes(cmd.uid)) {
        sc.acted.push(cmd.uid);
      }
      // Swarm Tactics goes on before the other squad issues: "continue issuing"
      // is this squad's turn still (3.2.3 uses "continue to issue" for issuing
      // on without the other player in between).
      sc.turn = swarmFor(state, t.side) ? t.side : nextTurn(state, phase, t.side, data) ?? t.side;
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
        // The debt is paid: the granter resumes with nothing more to hand out.
        if (sc.opp) sc.oppStack.push({ ...sc.opp, grantOwed: undefined });
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
      const shed = cmd.keepTokens ? undefined : cmd.statusId ?? (t.statuses ?? []).find((id) => {
        const d = STATUSES.find((x) => x.id === id);
        return d?.shape === 'square' || d?.shape === 'hexagon';
      });
      // Either face may go, yellow or red (6.1 names no colour), and the other
      // Tokens of a stack keep theirs (types.ts shedToken).
      if (shed) shedToken(t, shed, cmd.face);
      t.link = Math.min(maxLink(data, t), (t.link ?? 0) + 1);
      return;
    }
    case 'repairPart': {
      if (cmd.targetUid !== undefined) {
        const target = state.tokens.find((x) => x.uid === cmd.targetUid);
        if (target) target.partStates[cmd.slot as PartSlot | 'main'] = 'intact';
        // "then remove this Unit" (ZYDR-108_B).
        const a = cmd.actionId ? findAction(data, state, cmd.uid, cmd.actionId) : undefined;
        if (a && repairSpec(a)?.removeSelf) state.tokens = state.tokens.filter((x) => x.uid !== t.uid);
        return;
      }
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
      // Whatever it owed is paid: one Reveal answers every trigger, an enemy
      // Scan's `manifest` debt included. That debt used to be answered first and
      // on its own, so a reload before the picker left the unit camouflaged
      // with nothing owed (ruled R7; audit Phase 7, P7C 7).
      if (sc) {
        sc.revealDue = (sc.revealDue ?? []).filter((x) => x.uid !== t.uid);
        sc.reactions = (sc.reactions ?? []).filter((r) => !(r.uid === t.uid && r.kind === 'manifest'));
      }
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
      // ammoPay: the pool check() judged, the Pack's when the Pod is empty (086_B).
      const { from: mag, poolId } = ammoPay(data, state, t, cmd.actionId);
      // MISSILE GROUP X (6.2; the RKG70 Missile Group, card 157): "Each Missile
      // Group contains X Units... Resolve Interception and Explosion damage for
      // each Unit separately." One launch, ONE Ammo, X Units on the board. It
      // was one token for months, so a single hit removed the whole group and
      // it detonated once where the book resolves up to three. Minted one at a
      // time so each takes the next uid and the next numbered label.
      const minted: number[] = [];
      for (let i = 0; i < missileGroupOf(card); i++) {
        const tok = makeDroneToken(state, data, card, t.side);
        state.tokens.push({ ...tok, parentUid: t.uid, col: cmd.to.col, row: cmd.to.row, facing: cmd.facing });
        minted.push(tok.uid);
      }
      // One group, so its Units can follow one target (p.94; A5).
      if (minted.length > 1) for (const x of state.tokens) if (minted.includes(x.uid)) x.group = minted[0];
      // A Mine fires on ENTRY: a Ground unit already standing in the Grid it
      // is Deployed into is spared until it moves (ruling I15). As built, the
      // GLP-15's Range 1 Deploy was a repeatable Explosion on any adjacent
      // Ground unit (audit Phase 5, C3).
      for (const x of state.tokens) if (minted.includes(x.uid)) spareStanding(state, x, minted);
      // One launch, however many Units a Missile Group puts down, counted
      // against the Volley (C12).
      const lo = oppOf(state, cmd.uid);
      if (lo && sc) sc.opp = { ...lo, launched: [...(lo.launched ?? []), { actionId: cmd.actionId, uids: minted }] };
      if (mag.ammo[poolId] !== undefined) mag.ammo[poolId] = Math.max(0, mag.ammo[poolId] - 1);
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
      // The access spends the Remote Access that paid for it, where no shared
      // record did (ruled R2, P7C 2).
      if (sc?.counterOwed?.uid === t.uid && sc.counterOwed.actionId === 'COMMON_REMOTE_ACCESS') delete sc.counterOwed;
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
      // Declining spends nothing: the card says "may", and 4.13 spends Ammo on
      // a performance (ruled 2026-09-25, audit Phase 4, G9 and I15). Skip used
      // to spend the one use as well.
      //
      // `t` and not ammoHolder, deliberately: attackReactionsOf (units.ts) reads
      // tokenCards ALONE and never loanedParts, so a borrowed Part can never owe
      // a reaction and there is no lender's magazine to find. Flagged as a
      // launch path by the phase-6 sweep; it is not one.
      if (cmd.placed !== false && t.ammo?.[cmd.actionId] !== undefined) {
        t.ammo[cmd.actionId] = Math.max(0, t.ammo[cmd.actionId] - 1);
      }
      return;
    }
    case 'controlledMove': {
      const sc = state.script;
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      // The debt is spent by the move it paid for, in the same command.
      if (sc) {
        const at = (sc.reactions ?? []).findIndex((r) => r.uid === cmd.uid && r.kind === 'control' && r.fromUid === cmd.targetUid);
        if (at >= 0) sc.reactions = [...sc.reactions.slice(0, at), ...sc.reactions.slice(at + 1)];
      }
      const act = cmd.actionId ? findAction(data, state, target.uid, cmd.actionId) : null;
      // NON-HUMANOID X is paid by the unit performing the Action, whoever
      // steers it; a Maneuver pays nothing.
      const cost = nonHumanoidCost(act);
      if (cost > 0) target.link = Math.max(0, (target.link ?? 0) - cost);
      const from = { col: target.col, row: target.row };
      if (!state.noBoard) {
        target.col = cmd.to.col;
        target.row = cmd.to.row;
      }
      if (cmd.facing !== undefined) target.facing = cmd.facing;
      // It is the target's own Maneuver or Move Action, so 4.12.3 reads the
      // target's Silence: a Revealing, Token-shedding Movement unless it has it.
      const began = { ...target, ...from };
      const silent = act ? isSilentAction(data, state.tokens, target, act, undefined, began) : maneuverIsSilent(data, target);
      if (!silent) {
        shedLowProfile(data, state, target);
        if (statusCount(target.statuses, 'camouflage') > 0) {
          oweReveal(state, target.uid, act ? 'act' : 'move', act ? actionSilenceDenier(data, state.tokens, target, act, undefined, began)?.source.uid : undefined);
        }
      }
      if (!state.noBoard && !target.aerial && cmd.via?.length) walkHeat(state, target, from, cmd.to, cmd.via);
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
    case 'flyToTarget': {
      const target = state.tokens.find((x) => x.uid === cmd.targetUid);
      if (!target) return;
      const to = flightLanding(target);
      t.col = to.col;
      t.row = to.row;
      // The group's first pick names the target the rest follow (ruling I12).
      if (t.group !== undefined) {
        for (const x of state.tokens) if (x.group === t.group && x.uid !== t.uid) x.groupTarget = target.uid;
      }
      return;
    }
    case 'recoverBit': {
      // The Bit leaves the board and comes back, if it is launched again, as a
      // new unit (FAQ N4, N8).
      state.tokens = state.tokens.filter((x) => x.uid !== cmd.targetUid);
      const max = ammoMax(data, t, cmd.actionId);
      const held = t.ammo?.[cmd.actionId] ?? 0;
      t.ammo = { ...(t.ammo ?? {}), [cmd.actionId]: max !== undefined ? Math.min(max, held + 1) : held + 1 };
      return;
    }
    case 'layMine': {
      const card = data.byId.get(cmd.cardId);
      if (!card) return;
      // Same shape as a launch minus the Ammo: Auto Mine Laying has no magazine,
      // it is paid for in Move Range, and that was spent by walking a shorter
      // route. Facing is the layer's own so a mirrored seat draws it identically.
      const tok = makeDroneToken(state, data, card, t.side);
      const laid = { ...tok, parentUid: t.uid, col: cmd.to.col, row: cmd.to.row, facing: t.facing };
      // Every Mine one Movement Lays is placed at once, so none of them sets
      // off another (Supplementary Rules 1.04, 1.3); a Mine placed later into
      // the Grid still sets off the ones there (M6). The Movement is named by
      // its layer, the round and phase, and the route it walked, which both
      // boards send with each Lay.
      if (laid.mine) {
        const route = (cmd.route ?? []).map((p) => `${Math.floor(p.col / 3)},${Math.floor(p.row / 3)}`).join(';');
        laid.mine = { ...laid.mine, batch: `lay:${t.uid}:${state.round.n}:${state.round.phase}:${route}` };
      }
      state.tokens.push(laid);
      // Laid or launched alike, a unit already standing in the Grid is spared
      // until it moves (ruling I15; OTTO, 2026-09-28). Not the layer: M7 Lays
      // before it enters the target Grid, so a Mine in its own landing still
      // goes off as it arrives.
      spareStanding(state, laid, [t.uid]);
      return;
    }
    case 'switchForm': {
      switchFormTo(data, t, cmd.cardId);
      return;
    }
    case 'overwatch': {
      // The Mech's Firing Action is owed at the designated enemy, and the KK9
      // is removed (LHDR-KK9_B; audit Phase 5, F8).
      const sc = state.script;
      if (sc) sc.reactions = [...(sc.reactions ?? []), { uid: cmd.mechUid, actionId: cmd.actionId, count: 0, range: 0, kind: 'overwatch', fromUid: cmd.targetUid }];
      state.tokens = state.tokens.filter((x) => x.uid !== t.uid);
      return;
    }
    case 'unfold': {
      const card = data.byId.get(t.cardId);
      const into = card ? unfoldsInto(card) : undefined;
      const target = into ? data.byId.get(into) : undefined;
      if (target) {
        unfoldToken(state, data, t, target);
        // M18.4, "if its Grid is occupied it detonates at once", judged here
        // at the replacement and marked, Aerial units and Mines aside
        // (rulings I18, I19; audit Phase 5, D2).
        if (state.noBoard ? cmd.occupied === true : unfoldOccupants(state.tokens, t).length > 0) t.unfoldBlast = true;
      }
      return;
    }
    case 'transformPart': {
      transformPartOn(data, t, cmd.slot, cmd.cardId);
      return;
    }
    case 'cutTether': {
      cutTetherBetween(data, state, t, cmd.targetUid);
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
      // A unit taken off the board leaves its Black Boxes in the Grid it stood
      // in (ruling I20): they vanished with it (audit Phase 6, F9).
      if (gone) {
        const tasks = normaliseTasks(state.tasks);
        if (tasks.items.some((i) => i.bearerUid === gone.uid)) {
          leaveBoxes(tasks, gone, true);
          state.tasks = tasks;
        }
      }
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
// Swarm Tactics (172_B, GoF 1.021): "After this Mech issues a Command to a GoF
// Medium Drone, may remove this Command Token and continue issuing a Command to
// another Ally Drone." Read with 3.2.2 ("If a Drone has already received a
// Command Token, it cannot receive another during this phase") and FAQ O1: the
// Warrior's one token moves on AT ONCE, before the other squad issues, to an
// Ally Drone that has had no Command this Phase, and on again from each GoF
// Medium Drone it reaches. Every Drone still takes one Command per Phase: read
// the other way, one token commanded two Medium Drones endlessly (OTTO asked
// for this reading, 2026-09-28). In our model the Drone it left keeps its
// face-down token as the mark of that Command. Declining is `endSwarm` (or a
// Pass), and the token then stays spent where it is. Offered only while a
// Drone is left to take it.
function swarmStarts(data: GameData, state: GameState, issuer: Token, drone: Token): void {
  const sc = state.script;
  if (!sc || !swarmTacticsOn(data, issuer) || !isGofMediumDrone(data, drone)) return;
  if (!swarmTargets(state, issuer.side).length) return;
  sc.swarm = { issuer: issuer.uid, from: drone.uid };
}

// The Swarm Tactics continuation waiting on this squad, if any.
export function swarmFor(state: GameState, side: Side): { issuer: number; from: number } | null {
  const sw = state.script?.swarm;
  if (!sw) return null;
  const w = state.tokens.find((x) => x.uid === sw.issuer);
  return w && w.side === side && alive(w) ? sw : null;
}

// Outside the Command Phase the waiting token moves by Command Coordination.
function swarmByCoordination(state: GameState, from: Token): boolean {
  return PHASES[state.round.phase] !== 'Command' && swarmFor(state, from.side)?.issuer === from.uid;
}

// Where the Warrior's token may go on to: an Ally Drone with no Command Token
// on it and, in the Command Phase, none received this Phase.
export function swarmTargets(state: GameState, side: Side): Token[] {
  const sc = state.script;
  const commandPhase = PHASES[state.round.phase] === 'Command';
  return state.tokens.filter((d) => d.side === side && d.kind === 'drone' && alive(d) && d.deployed !== false
    && heldCommands(d) === 0 && !(commandPhase && (sc?.commanded ?? []).includes(d.uid)));
}

// A Mine fires on ENTRY: a Ground unit already standing in the Grid it
// arrives in is spared until it moves (ruling I15). `skip` are units that are
// not standing there yet: the rest of a Missile Group, or the layer.
function spareStanding(state: GameState, mine: Token, skip: number[]): void {
  if (!mine.mine) return;
  const g = { c: Math.floor(mine.col / 3), r: Math.floor(mine.row / 3) };
  const standing = state.tokens.filter((o) => o.uid !== mine.uid && !skip.includes(o.uid) && !o.mine && !o.aerial && o.deployed !== false
    && Math.floor(o.col / 3) <= g.c && g.c < Math.floor(o.col / 3) + Math.max(1, Math.ceil(o.size / 3))
    && Math.floor(o.row / 3) <= g.r && g.r < Math.floor(o.row / 3) + Math.max(1, Math.ceil(o.size / 3)));
  if (standing.length) mine.mine = { ...mine.mine, spared: standing.map((o) => ({ uid: o.uid, col: o.col, row: o.row })) };
}

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
  // In a room a player sends only their own squad's commands, the relay's own
  // rule (ATTRIBUTED above): one sent under the other seat applied on this
  // board and never reached the other, and the two split in silence, as a drag
  // of the other squad's unit did. Refused here instead, where the page says
  // why. Solo and pass-and-play hold no local seat (ruled R6; audit Phase 7,
  // P7D 3).
  if (me && cmd.seat !== me) {
    const why = `That is ${squadLabel(cmd.seat)}'s to do: in an online game each player acts only for their own squad.`;
    refused?.(why);
    return no(why);
  }
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
  // Every unit of a board-less table carries its aura record, one this command
  // just put down included, and a board's carry none (aurasOn reads the record
  // by its presence).
  if (state.noBoard) for (const t of state.tokens) t.auraReaches ??= {};
  else for (const t of state.tokens) if (t.auraReaches) delete t.auraReaches;
  // Mirrored only after it has actually landed here, so the other player never
  // sees a move this client refused to make — and never if it is secret.
  if (!applyingRemote && !isSecret(cmd)) mirror?.(cmd);
  return verdict;
}

import './styles.css';
import { Board, CELLS, footprint, snapPlacement, type BoardDeployment, type BoardZone, type DeployShape } from './board';
import { AttackHelper, ElectronicHelper } from './combat';
import { alertDialog, choiceDialog, confirmDialog, promptDialog } from './dialog';
import { gameResult, isLowValue, newTaskState, normaliseTasks, taskItemsFor, zoneCentreGrid, type GameResult, type TaskItem, type TaskState } from './tasks';
import { DiceTray } from './dice';
import { importSquadFile } from './importer';
import { factionColour, squadColour } from './icons';
import { applyRemote, onPerformed, onRefused, perform, type Command, onBeforeApply } from './commands';
import { Relay } from './net';
import { getLocalSeat, setLocalSeat } from './loop';
import { ApiError, EmberApi, type SquadEntry } from './api';
import { MultiplayerDialog } from './multiplayer';
import { Inventory } from './inventory';
import { BOARD_THEMES, boardTheme } from './boards';
import { bindTips, inspectOnHover, isInspectPinned, showInspect, unpinInspect } from './inspector';
import { cardName, dataUrl, isAerial, loadData, missionImageUrl, parseGridRef, rulesLines, secondaryImageUrl, type SecondaryTask, setSquadNames, SQUAD_ORDER, squadLabel, unitSize } from './data';
import {
  deleteCustomMap,
  emptyCustomMap,
  loadCustomMap,
  loadCustomMaps,
  makePiece,
  PALETTE,
  pieceCells,
  saveCustomMap,
  type CustomMap,
  type CustomZone,
  type PaletteItem,
} from './mapeditor';
import { Panel } from './panel';
import { tacticSpec, tacticTargets } from './tactics';
import { Roster } from './roster';
import { inContact, canStandIn, attackDirection, crushTargets, type CrushVictims, dissipationFor, extendPath, inArc, knockbackPath, largeGridOf, type LargeGrid, LG, losBetween, losNote as losNoteFor, type MoveOpts, pathCost, protectionFor as protectionForShared, rangeBetween, reachableGrids, smokeBlocks, spotsInGrid, standingSpot } from './rules';
import { breakAwayCost, canBeForceMoved, lockersOf } from './melee';
import { instantiateScenario, loadScenarios, type Scenario } from './scenarios';
import { loadReplays, ReplayPlayer, type ReplayScript, type ReplayStep, type ReplayTally } from './replay';
import { SquadTracker } from './squads';
import { warmAllImagesWhenIdle } from './images';
import { runFirstVisitPreload } from './preload';
import { watchForUpdates } from './updates';
import { installTooltip, preloadCards } from './tooltip';
import { PHASES, RoundTracker } from './tracker';
import { clearHistory, historyList, recordSnapshot, undoLast } from './history';
import { offerHarpyDrag as sharedHarpyDrag } from './commandpick';
import { PlayGuide } from './playguide';
import type { Card, CardAction, DiceData, DieColor, Facing, GameState, MechLoadout, PartSlot, Side, SmokeScreen, Stance, StatusDef, TerrainPiece, Timing, Token } from './types';
import { addStatus, normaliseScript, SCALES, statusCount, statusesFor, STATUSES } from './types';
import { actionIdOf } from './ticks';
import { electronicValue, martyrdomOwed, autoDetonationsOwed, autoNeutralTargets, blinkTargets, camoBrokenBy, flightGrant, isAirborneAction, isPositionSwap, loanedParts, minesLayable, minesOwed, multiTargetLimit, unfoldsOwed, repairSpec, autoTargetsFor, isSilentAction, maneuverIsSilent, chargeableSlots, squadAllegiance, defaultUnitLabel, deployedCardCounts, syncMagazines, explosionScope, factionProblems, freehandSlots, guidedActions, interceptCapacity, isChargeAction, knockbackOf, projectileDelivery, type Resupply, resupplyOf, SLOT_LABEL, stationaryAdjusted, interceptLeft, interceptsOwed, isElectronicAttack, makeDroneToken, makeMechToken, maneuverRange, migrateState, needsSightToLanding, smokePlacement, tokenCards, volleyOf, type AttackReaction } from './units';
import { registerOffline } from './offline';
import { battlefieldLocked, countHits, firstPlayerFrom, newSetup, normaliseSetup, tasksLocked, type SetupState } from './setup';
import { loadSquads, saveSquad, type SavedSquad } from './squadstore';
import { dialsOf, hashDials, newSalt } from './secrecy';
import { resolveZoneSetData } from './overlays';

const SAVE_KEY = 'ember-testing-grounds-v1';

async function init() {
  const data = await loadData();
  const dice = (await fetch(dataUrl('dice.json')).then((r) => r.json())) as DiceData;

  let state: GameState = loadState() ?? {
    v: 3,
    map: 'alley',
    tokens: [],
    nextUid: 1,
    round: { n: 1, phase: 0, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
  };
  let selectedUid: number | null = null;
  let replayActive = false;
  let pendingAttack: {
    attackerUid: number;
    actionId: string;
    mode: 'attack' | 'electronic';
    action?: CardAction;
    done?: (fired: boolean) => void;
  } | null = null;
  const editor: {
    active: boolean;
    item: PaletteItem | null;
    erase: boolean;
    vertical: boolean;
    working: TerrainPiece[];
    baseline: string;
    paint: null | { kind: 'zone'; zoneId: string } | { kind: 'deploy'; side: 'black' | 'white' };
    drag: null | { from: { col: number; row: number }; to: { col: number; row: number }; erase: boolean };
    zones: CustomZone[];
    deploy: { black: { col: number; row: number }[]; white: { col: number; row: number }[] };
  } = {
    active: false,
    item: null,
    erase: false,
    vertical: false,
    working: [],
    baseline: '[]',
    paint: null,
    drag: null,
    zones: [],
    deploy: { black: [], white: [] },
  };

  installTooltip();
  bindTips(document);
  preloadCards(data.cards.map((c) => c.id));
  // First visit gets the whole art set behind a progress screen; every visit
  // after that tops up whatever is missing in the background. Not awaited, so
  // the board is live underneath and Skip costs nothing.
  void runFirstVisitPreload().then(() => warmAllImagesWhenIdle());
  registerOffline();
  watchForUpdates();
  const inventory = new Inventory(data.boxes, () => roster.render(), data.cards);

  const tray = new DiceTray(dice, document.getElementById('dice-tray')!);

  // Penetrated Black Box bearers, held until the attack's Forced Movement has
  // resolved so the drop is asked at the position the bearer ends up in.
  const pendingBoxDrops: { victim: Token; attacker: Token }[] = [];

  const attackHelper = new AttackHelper(
    data,
    dice,
    document.getElementById('combat-body')!,
    () => onChanged(),
    () => {
      renderCombatIdle();
      const t = state.tokens.find((x) => x.uid === selectedUid);
      if (t) panel.showToken(t);
      showSideTab('details');
      checkInterceptFollowUp();
    },
    (t, text) => {
      t.log = [...(t.log ?? []), { round: state.round.n, text }];
      if (t.log.length > 200) t.log = t.log.slice(-200);
      renderUnitLog();
      save();
    },
    (attacker, defender, action, hits) => {
      void (async () => {
        // Forced Movement is part of the attack, so it resolves before a
        // Penetrated bearer drops its Black Box — the Box lands around the
        // NEW position (FAQ E19), which is why the drops queue until here.
        await resolveKnockback(attacker, defender, action, hits);
        for (const q of pendingBoxDrops.splice(0)) dropBlackBoxes(q.victim, q.attacker);
        if (attacker.kind === 'projectile') {
          state.tokens = state.tokens.filter((x) => x.uid !== attacker.uid);
          if (selectedUid === attacker.uid) selectToken(null);
          onChanged();
        }
      })();
    },
    (killer, victim, what) => {
      perform(data, state, { kind: 'recordKill', seat: killer.side, uid: killer.uid, targetUid: victim.uid, what });
      if (what === 'unit' && selectedUid === victim.uid) selectToken(null);
    },
    (victim, attacker) => pendingBoxDrops.push({ victim, attacker }),
    (cmd) => perform(data, state, cmd),
  );

  attackHelper.tokens = () => state.tokens;
  attackHelper.terrain = () => currentTerrain();
  attackHelper.smoke = () => state.smoke ?? [];
  // What a defender set off by being shot at. Queued rather than placed inline,
  // because under Multi-Target the helper holds it back until every attack has
  // resolved (FAQ B7) — by the time this runs, the ordering is already right.
  attackHelper.onReaction = (defender, reaction, attacker) => {
    // A BRAND-NEW board that has never been saved carries no script yet -
    // every loaded board gets one from migrateState, and every reader already
    // treats "no script" as the default script, but queueReactions' apply
    // stores the debt IN the script, so it has to exist. Materialise the same
    // default a reload would produce.
    state.script ??= normaliseScript(undefined, state.round.firstPlayer);
    perform(data, state, {
      kind: 'queueReactions', seat: defender.side,
      items: [reaction.smoke
        ? { uid: defender.uid, actionId: reaction.actionId, count: reaction.smoke.count, range: reaction.smoke.range, kind: 'smoke' as const }
        : reaction.stance
          ? { uid: defender.uid, actionId: reaction.actionId, count: 0, range: 0, kind: 'stance' as const }
          : { uid: defender.uid, actionId: reaction.actionId, count: 0, range: 0, kind: 'trace' as const, fromUid: attacker.uid }],
    });
    renderReactionPrompt();
  };

  const electronicHelper = new ElectronicHelper(
    data,
    dice,
    document.getElementById('combat-body')!,
    () => onChanged(),
    () => {
      renderCombatIdle();
      const t = state.tokens.find((x) => x.uid === selectedUid);
      if (t) panel.showToken(t);
      showSideTab('details');
    },
    (t, text) => {
      t.log = [...(t.log ?? []), { round: state.round.n, text }];
      if (t.log.length > 200) t.log = t.log.slice(-200);
      renderUnitLog();
      save();
    },
    (cmd) => perform(data, state, cmd),
  );
  electronicHelper.tokens = () => state.tokens;

  function combatBusy(): boolean {
    return attackHelper.active || electronicHelper.active;
  }

  const roundTracker = new RoundTracker(document.getElementById('round-tracker')!, () => onChanged(), (cmd) => perform(data, state, cmd));
  roundTracker.onStartGame = () => void (normaliseSetup(state.setup) ? endGame() : startGame());

  const playGuide = new PlayGuide(document.getElementById('board-wrap')!, data, {
    world: () => ({ tokens: state.tokens, terrain: currentTerrain() }),
    onUndo: () => undoMove(),
    undoLabel: () => undoName(),
    onStartGame: () => void startGame(),
    onAdvancePhase: () => roundTracker.advance(),
    onSelectUnit: (uid) => selectToken(uid),
    onShowDial: (uid) => {
      selectToken(uid);
      showSideTab('squad');
      // The Squads tab rebuilds more than once on selection, so a single frame
      // is not enough: the element the hint lands on gets replaced under it.
      let tries = 0;
      const point = (): void => {
        const trig = document.querySelector<HTMLElement>(`.dial-trig[data-dial-uid="${uid}"]`);
        if (trig) {
          trig.scrollIntoView({ block: 'center' });
          trig.classList.add('dial-hint');
        }
        if (++tries < 5) setTimeout(point, 100);
      };
      setTimeout(point, 0);
    },
    onMoveUnit: (uid, opts, done) => void startMove(uid, opts, done),
    onPerformAction: (uid, actionId, done) => performGuided(uid, actionId, done),
    onSetStance: (uid, stance) => {
      const t = state.tokens.find((x) => x.uid === uid);
      if (!t) return;
      perform(data, state, { kind: 'setStance', seat: t.side, uid, stance });
      onChanged();
    },
    onIntercept: (uid, actionId, targetUid) => {
      const t = state.tokens.find((x) => x.uid === uid);
      if (!t) return;
      interceptPrefer = targetUid;
      startIntercept(t, actionId);
    },
    onRollFirstPlayer: (side) => rollForFirstPlayer(side),
    onPlaceUnit: (uid, opts) => startDeployPlacement(uid, opts),
    onPickMission: () => openMissions(),
    onPickSecondary: (side) => void pickSecondary(side),
    onPlayTactic: (side, id) => void playTactic(side, id),
    onEndGame: () => void endGame(),
    onConfirmTimings: () => commitTimings(),
    // The removal itself is the guide's markEndStep command; this only tidies
    // a selection left pointing at a unit that is no longer there.
    onRemoveSpent: () => {
      if (selectedUid !== null && !state.tokens.some((t) => t.uid === selectedUid)) selectToken(null);
      onChanged();
    },
    mapLabel: () => mapSelect.options[mapSelect.selectedIndex]?.textContent ?? state.map ?? 'none',
    zoneLabel: () => zoneSetLabel(state.zoneSet ?? ''),
    onNote: (t, text) => logTo(t, text),
    onChanged: () => onChanged(),
  });

  roundTracker.blockedReason = (s) => playGuide.blockedReason(s);

  // Undo. Every command snapshots the board it is about to change, so a misclick
  // is one press away from gone. Registered here rather than inside the command
  // layer so the Match Centre can keep its own policy — a shared board cannot be
  // rewound by one player alone.
  onBeforeApply((s, cmd) => recordSnapshot(s, cmd.kind));

  // What the next undo would take back, in words a player recognises. The ring
  // labels steps by command kind, which is developer vocabulary; anything not
  // named here falls back to something honest rather than to jargon.
  const UNDO_NAMES: Record<string, string> = {
    advancePhase: 'the phase change',
    setPhase: 'the phase change',
    setTiming: 'a Timing Dial',
    designate: 'a designation',
    passTurn: 'a pass',
    maneuver: 'a move',
    setStance: 'a Stance change',
    spendTicks: 'an Action',
    spendAmmo: 'an Ammo spend',
    spendCommand: 'a Command spend',
    coordinateCommand: 'a Command Coordination',
    applyPenetration: 'a Penetration',
    recordKill: 'a removal',
    placeSmoke: 'a smoke screen',
    forceMove: 'a Forced Movement',
    acceptRoll: 'the First Player roll',
    markEndStep: 'an End Phase step',
    award: 'a score award',
    grantExtra: 'an Extra Opportunity',
    endActivation: 'an activation end',
  };
  function undoName(): string | null {
    const last = historyList().at(-1);
    if (!last) return null;
    return UNDO_NAMES[last.label] ?? 'the last step';
  }

  function undoMove(): void {
    // A half-drawn route belongs to a board that is about to be replaced.
    if (movePlan) cancelMove();
    const snap = undoLast(state);
    if (!snap) {
      setHint('Nothing left to undo.');
      return;
    }
    selectToken(null);
    onChanged();
    setHint(`Undid ${snap.label} · back to round ${snap.round}, ${PHASES[snap.phase]} Phase.`);
  }

  const panel = new Panel(data, {
    world: () => ({ tokens: state.tokens, terrain: currentTerrain() }),
    onRollDice(pool) {
      tray.addToPool(pool, true);
      tray.roll();
    },
    onSpendAmmo(t, actionId) {
      perform(data, state, { kind: 'spendAmmo', seat: t.side, uid: t.uid, actionId });
      onChanged();
      if (!combatBusy()) panel.showToken(t);
    },
    onRestoreAmmo(t, actionId) {
      perform(data, state, { kind: 'restoreAmmo', seat: t.side, uid: t.uid, actionId });
      onChanged();
      if (!combatBusy()) panel.showToken(t);
    },
    onSpendIntercept(t, actionId) {
      startIntercept(t, actionId);
    },
    onRestoreIntercept(t, actionId) {
      const act = tokenCards(data, t)
        .flatMap(({ card }) => card.actions ?? [])
        .find((a) => a.id === actionId);
      const max = act ? interceptCapacity(act) : undefined;
      const left = t.intercept?.[actionId];
      if (left === undefined || max === undefined || left >= max) return;
      t.intercept![actionId] = left + 1;
      onChanged();
      if (!combatBusy()) panel.showToken(t);
    },
    onLaunch(t, action, projectile) {
      startLaunch(t, action, projectile, () => {});
    },
    onStartAttack(t, actionId) {
      pendingAttack = { attackerUid: t.uid, actionId, mode: 'attack' };
      document.body.classList.add('targeting');
      // The card's own Attack button is a second way in, beside the guide's
      // performGuided - so the O9 Neutral fallback has to be said here too, or
      // it only reaches players who are following the guide. Through setHint,
      // not a bare textContent write - that is what hides the shortcut keys
      // while the instruction is up.
      const act = tokenCards(data, t).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === actionId);
      const neutral = act?.speed === 'auto'
        ? autoNeutralTargets(data, state.tokens, currentTerrain(), t, act)
        : [];
      setHint(neutral.length
        ? `⌖ No enemy is in range, so this Automatic Action MAY take the nearest Breakable Terrain instead — ${
          neutral.map((n) => gridOfTerrain(n.id)).join(' or ')
        } — destroyed by clicking the piece (FAQ O9). Esc cancels.`
        : '⌖ Click the TARGET unit on the board (Esc cancels)');
    },
    onStartElectronic(t, actionId) {
      pendingAttack = { attackerUid: t.uid, actionId, mode: 'electronic' };
      document.body.classList.add('targeting');
      setHint('⚡ Click the TARGET of the Electronic Attack (Esc cancels)');
    },
    onShowMoveRange(t, steps) {
      const flying = !!data.byId.get(t.cardId)?.moveAsFlight;
      const grids = reachableGrids(t, steps, currentTerrain(), state.tokens, flying, moveOpts(t, flying));
      board.showReachable(grids, steps);
    },
    onShowActionRange(t, range, label) {
      board.showRangeRings(t, range);
      const inRange = unitsWithin(t, range);
      setHint(`${label}: R${range} shown. ${inRange.length} unit${inRange.length === 1 ? '' : 's'} in range. Line of sight and arc still apply.`);
    },
    onDetonate(t, actionId) {
      if (unfoldsOwed(data, [t]).some((x) => x.actionId === actionId)) {
        perform(data, state, { kind: 'unfold', seat: t.side, uid: t.uid });
        logTo(t, `${t.label} Unfolds into its Drone form (FAQ M18).`);
        onChanged();
        return;
      }
      startDetonation(t, actionId);
    },
    onShove(t, actionId) {
      const action = findAction(t, actionId);
      if (action) void offerShove(t, action);
    },
    tacticNote(t) {
      return state.script?.freeCommand.includes(t.uid)
        ? 'Additional Instructions: this Drone has 1 Command Action owed, and taking it spends no Command Token.'
        : null;
    },
    // The sandbox may nudge anything; a linked game gates on the seat.
    spotsInGrid: (t) => spotsInGrid(t, currentTerrain(), state.tokens),
    onPlaceInGrid(t, to) {
      perform(data, state, { kind: 'placeInGrid', seat: t.side, uid: t.uid, to });
      onChanged();
      panel.showToken(t);
    },
    onCharge(t, slot, on) {
      setCharge(t, slot, on);
      onChanged();
      panel.showToken(t);
    },
    // Rebuilt rather than patched: the Load feeds the drone's Ammo and Intercept
    // pools, so setting `droneBackpack` alone would leave a Part on its back
    // with no magazine. Same trick as unfoldToken - make a fresh token and keep
    // only what identifies this one on the board.
    onSetLoad(t, cardId) {
      const card = data.byId.get(t.cardId);
      if (!card || t.kind !== 'drone') return;
      const fresh = makeDroneToken(state, data, card, t.side, cardId);
      Object.assign(t, fresh, {
        uid: t.uid, col: t.col, row: t.row, facing: t.facing, deployed: t.deployed, label: t.label,
      });
      logTo(t, cardId ? `Loaded with ${cardName(data.byId.get(cardId))}.` : 'Load taken off.');
      onChanged();
      panel.showToken(t);
    },
  });

  const squadTracker = new SquadTracker(data, document.getElementById('squad-body')!, {
    onSelect(uid, focusSlot) {
      selectToken(uid);
      if (focusSlot) {
        const t = state.tokens.find((x) => x.uid === uid);
        if (t) panel.showToken(t, focusSlot);
        showSideTab('details');
      } else {
        showSideTab('squad');
      }
    },
    onChanged() {
      onChanged();
      const t = state.tokens.find((x) => x.uid === selectedUid);
      if (t) panel.showToken(t);
    },
    onDelete(uid) {
      void removeUnit(uid);
    },
    onEditMech(uid) {
      const t = state.tokens.find((x) => x.uid === uid);
      if (!t || t.kind !== 'mech') return;
      roster.editMech(uid, t.side, t.label, t.mech ?? {});
      showSideTab('add');
    },
    onPlayTactic(side, id) {
      void playTactic(side, id);
    },
    scenarioName(id) {
      return scenarios.find((x) => x.id === id)?.name ?? null;
    },
    onShowScenario() {
      const scn = scenarios.find((x) => x.id === state.scenario);
      if (!scn) return;
      document.getElementById('details-body')!.replaceChildren(scenarioBriefing(scn));
      showSideTab('details');
    },
  });

  const board = new Board(document.getElementById('board-wrap')!, {
    onSelect(uid) {
      // Planning a move turns panning off, which makes the board treat every click
      // as a background deselect. Keep the unit being moved selected.
      if (movePlan && uid === null) return;
      if (pendingAttack && uid !== null && uid !== pendingAttack.attackerUid) {
        const attacker = state.tokens.find((x) => x.uid === pendingAttack!.attackerUid);
        const defender = state.tokens.find((x) => x.uid === uid);
        const action = pendingAttack.action ?? (attacker && findAction(attacker, pendingAttack.actionId));
        const mode = pendingAttack.mode;
        const done = pendingAttack.done;
        const intercepting = pendingIntercept;
        if (intercepting && defender && !defender.aerial) {
          void alertDialog({
            title: 'Not an Interception target',
            body: `Interception only ever attacks the Aerial Unit that triggered it, and ${defender.label} is not Aerial (rulebook 4.9). Pick the Missile or Projectile, or press Esc.`,
          });
          return;
        }
        endTargeting();
        pendingIntercept = null;
        if (attacker && defender && action) {
          if (mode === 'electronic') {
            electronicHelper.start(attacker, action, defender);
          } else if (intercepting) {
            spendIntercept(attacker, intercepting.actionId, action.name.en || action.name.zh || action.id);
            attackHelper.start(
              attacker,
              action,
              defender,
              'Interception: line of sight always exists and no Forward Arc is required (4.9).',
              0,
              '',
              false,
              true,
            );
            interceptFollowUp = { uid: attacker.uid, actionId: intercepting.actionId, targetUid: defender.uid };
          } else if (action.speed === 'auto' && (() => {
            const legal = autoTargetsFor(data, state.tokens, attacker, action);
            return legal.length > 0 && !legal.some((x) => x.uid === defender.uid);
          })()) {
            // Automatic Actions take the nearest legal target, Highlighted
            // first (3.5.2, FAQ O21). The strict tracker refuses anything
            // else; teaching warns and lets a house rule through.
            const legal = autoTargetsFor(data, state.tokens, attacker, action);
            const names = legal.map((x) => x.label).join(', ');
            if (state.script?.strict) {
              void alertDialog({
                title: 'Not the nearest target',
                body: `An Automatic Action must take the nearest legal target${legal.some((x) => statusCount(x.statuses, 'highlight') > 0) ? ', and a Highlighted one first' : ''} (3.5.2, FAQ O21). Here that is ${names}.`,
              });
              done?.(false);
              return;
            }
            void confirmDialog({
              title: 'Not the nearest target',
              body: `An Automatic Action normally takes the nearest legal target (3.5.2, FAQ O21) - here ${names}. Attack ${defender.label} anyway?`,
              confirmLabel: 'Attack it anyway',
              cancelLabel: 'Pick the nearest',
              danger: true,
            }).then((go) => {
              if (!go) { done?.(false); return; }
              const prot = protectionFor(attacker, defender, action);
              attackHelper.start(attacker, action, defender, losNote(attacker, defender, action), prot.white, prot.note);
              showSideTab('combat');
              done?.(true);
            });
            return;
          } else if (defender.side === attacker.side && !state.script?.strict) {
            // Allies cannot be designated as Firing or Melee targets under
            // normal circumstances (Supplement 1.4.1 via FAQ A10/A11); area
            // damage is the intended way to hit your own. Warn, don't block —
            // and the Tick is only spent if the attack actually declares.
            void confirmDialog({
              title: `${defender.label} is an ally`,
              body: 'A squad cannot normally designate its own unit as the target of a Firing or Melee Action (Rules Supplement 1.4.1). Grenades and other area damage do hit allies; a direct attack needs a card that allows it or a house ruling.',
              confirmLabel: 'Attack it anyway',
              cancelLabel: 'Pick another target',
              danger: true,
            }).then((go) => {
              if (!go) {
                done?.(false);
                return;
              }
              const prot = protectionFor(attacker, defender, action);
              attackHelper.start(attacker, action, defender, losNote(attacker, defender, action), prot.white, prot.note);
              showSideTab('combat');
              done?.(true);
            });
            return;
          } else if (defender.side === attacker.side) {
            void alertDialog({
              title: `${defender.label} is an ally`,
              body: 'A squad cannot designate its own unit as the target of a Firing or Melee Action (Rules Supplement 1.4.1). The strict tracker refuses it; use area damage instead.',
            });
            done?.(false);
            return;
          } else {
            // Multi-Target opens on its split step instead: one declaration,
            // several targets, and a pool decided once for all of them. The
            // helper owns the rest, so this page and the Match Centre both do
            // nothing more than route to it.
            const multi = multiTargetLimit(action);
            if (multi) attackHelper.startMulti(attacker, action, defender, multi);
            else {
              const prot = protectionFor(attacker, defender, action);
              attackHelper.start(attacker, action, defender, losNote(attacker, defender, action), prot.white, prot.note);
            }
            // Declaring an attack is never Silent, so a camouflaged attacker
            // Reveals with it (4.12.2, FAQ I5/I22 - the Reveal comes first).
            if (statusCount(attacker.statuses, 'camouflage') > 0 && !isSilentAction(action)) {
              promptReveal(attacker, `${attacker.label} attacks from camouflage.`);
            }
          }
          showSideTab('combat');
          // An Action is performed the moment it is declared against a legal
          // target (3.4.5), so the Tick is spent here rather than after the dice.
          done?.(true);
        } else {
          done?.(false);
        }
        return;
      }
      selectToken(uid);
    },
    onMove(uid, col, row, forced) {
      const t = state.tokens.find((x) => x.uid === uid);
      if (!t) return;
      if (statusCount(t.statuses, 'immobilized') > 0 && !forced) {
        board.renderTokens(state);
        board.setSelected(uid);
        showInspect({
          title: 'Immobilized',
          sub: `IMB · on ${t.label}`,
          lines: [
            'This unit cannot perform Movement Actions or Maneuver, and that includes changing facing on the spot (rulebook 6.3.2).',
            'Being displaced by someone else’s effect is still legal, so hold Shift while dragging to move it anyway.',
            'Take the IMB token off in the Squads tab to move it normally again.',
          ],
        });
        return;
      }
      const snapped = snapPlacement(col, row, t.size);
      if (snapped && isFree(snapped.col, snapped.row, t.size, t.aerial, t.uid)) {
        if (t.size === 3) {
          const crushed = destructibleAt(snapped.col, snapped.row, t.size);
          if (crushed.length) {
            perform(data, state, { kind: 'destroyTerrain', seat: t.side, uid: t.uid, pieces: crushed });
            board.renderTerrain(currentTerrain());
          }
        }
        t.col = snapped.col;
        t.row = snapped.row;
        save();
        board.renderTokens(state);
        board.setSelected(uid);
        return;
      }
      // Dragging a Large Unit onto something smaller is a Crush, not an illegal
      // drop, so offer it here the same way a guided Maneuver would (4.3.6).
      const goal = { c: Math.floor(col / 3), r: Math.floor(row / 3) };
      const victims = !forced && crushTargets(t, goal.c, goal.r, currentTerrain(), state.tokens);
      if (victims) {
        board.renderTokens(state);
        board.setSelected(uid);
        resolveCrush(t, goal, victims, () => {
          const spot = standingSpot(goal.c, goal.r, t.size, t.aerial, currentTerrain(), state.tokens, t.uid);
          if (spot) {
            t.col = spot.col;
            t.row = spot.row;
          }
          logTo(t, `${t.label} Crushes into ${gridRef(goal.c, goal.r)}, and its Movement ends there.`);
          onChanged();
          setHint('');
        });
        return;
      }
      board.renderTokens(state);
      board.setSelected(uid);
    },
    onInspect(info) {
      showInspect(info);
    },
    onHover(uid) {
      const sel = state.tokens.find((x) => x.uid === (pendingAttack?.attackerUid ?? selectedUid));
      const hov = state.tokens.find((x) => x.uid === uid);
      if (!sel || !hov || sel.uid === hov.uid) {
        board.clearRange();
        return;
      }
      const los = smokeBlocks(sel, hov, state.smoke ?? []) ? 'smoked' : losBetween(sel, hov, currentTerrain(), state.tokens);
      board.showRange(sel, hov, `${rangeText(sel, hov)} · ${los}`);
    },
    onCellClick(col, row, erase) {
      if (movePlan) {
        // Right-click steps back a waypoint, left-click takes the preview.
        if (erase) undoWaypoint();
        else commitWaypoint();
        return;
      }
      if (!editor.active) return;
      if (editor.paint) {
        const at = { col: Math.floor(col / 3), row: Math.floor(row / 3) };
        editor.drag = { from: at, to: at, erase: erase || editor.erase };
        board.showGhost(dragSmallCells(editor.drag), !editor.drag.erase);
        return;
      }
      if (erase || editor.erase) {
        removeTerrainAt(col, row);
        return;
      }
      if (!editor.item) return;
      const cells = pieceCells(editor.item, col, row, editor.vertical);
      if (!placementOk(cells)) return;
      pushUndo();
      editor.working.push(makePiece(editor.item, cells));
      afterEdit();
    },
    onCellHover(col, row) {
      if (movePlan) {
        previewMove(Math.floor(col / 3), Math.floor(row / 3));
        return;
      }
      if (!editor.active) return;
      if (editor.paint) {
        if (editor.drag) {
          editor.drag.to = { col: Math.floor(col / 3), row: Math.floor(row / 3) };
          board.showGhost(dragSmallCells(editor.drag), !editor.drag.erase);
        } else {
          board.showGhost(largeGridCells(col, row), true);
        }
        return;
      }
      if (editor.erase || !editor.item) {
        board.clearGhost();
        return;
      }
      const cells = pieceCells(editor.item, col, row, editor.vertical);
      board.showGhost(cells, placementOk(cells));
    },
    onTerrainClick(id, erase) {
      if (!editor.active) return;
      if (!(erase || editor.erase)) return;
      if (!editor.working.some((p) => p.id === id)) return;
      pushUndo();
      editor.working = editor.working.filter((p) => p.id !== id);
      afterEdit();
    },
    async onDestroyTerrain(id) {
      if (state.removedTerrain?.includes(id)) return;
      const ok = await confirmDialog({
        title: 'Destroy this terrain?',
        body: 'Firing, Melee and Explosion remove destructible terrain directly, with no roll. A Large unit moving into it Crushes it the same way.',
        confirmLabel: 'Destroy it',
        danger: true,
      });
      if (!ok) return;
      state.removedTerrain = [...(state.removedTerrain ?? []), id];
      board.renderTerrain(currentTerrain());
      save();
    },
  });

  function placementOk(cells: { col: number; row: number }[]): boolean {
    const occupied = new Set<string>();
    for (const p of editor.working) for (const c of p.subCells) occupied.add(`${c.col},${c.row}`);
    for (const t of state.tokens) {
      if (t.aerial) continue;
      for (const c of footprint(t)) occupied.add(`${c.col},${c.row}`);
    }
    return cells.every((c) => c.col >= 0 && c.row >= 0 && c.col < CELLS && c.row < CELLS && !occupied.has(`${c.col},${c.row}`));
  }

  // Both now live in rules.ts so the Match Centre reads the board the same way.
  function losNote(attacker: Token, defender: Token, action: { type?: string; range?: number; keywords?: unknown[] }): string {
    return losNoteFor(attacker, defender, action, currentTerrain(), state.tokens, state.smoke ?? []);
  }

  function protectionFor(attacker: Token, defender: Token, action: { type?: string }): { white: number; note: string } {
    return protectionForShared(attacker, defender, action, currentTerrain(), state.tokens, state.smoke ?? []);
  }

  // ---------- performing an action from the play guide ----------

  function findAction(t: Token, actionId: string): CardAction | undefined {
    const id = actionIdOf(actionId);
    const own = tokenCards(data, t)
      .flatMap(({ card }) => card.actions ?? [])
      .find((a) => a.id === id);
    // A Backpack carried by a Tarantula in Contact is this Mech's Part while it
    // acts (FAQ O3/O16), so its Actions answer here too.
    const lent = own ?? loanedParts(data, state.tokens, t)
      .flatMap(({ card }) => card.actions ?? [])
      .find((a) => a.id === id);
    return lent ?? data.commonActions.find((a) => a.id === id);
  }

  // The guide is meant to play the turn, not just tally it, so each Action Type
  // opens the tool that actually resolves it. The Tick is only spent if the
  // action goes through, so backing out costs nothing.
  function performGuided(uid: number, actionId: string, done: (performed: boolean) => void): void {
    const t = state.tokens.find((x) => x.uid === uid);
    const action = t && findAction(t, actionId);
    if (!t || !action) return done(false);
    selectToken(uid);
    const what = action.name.en || action.name.zh || action.id;

    if (action.id === 'COMMON_REMOTE_ACCESS') {
      void performRemoteAccess(t, action, done);
      return;
    }

    if (isChargeAction(action)) {
      void performCharge(t, action, done);
      return;
    }

    const rep = repairSpec(action);
    if (rep) {
      void performRepair(t, action, rep, done);
      return;
    }

    const supply = resupplyOf(action);
    if (supply) {
      void performResupply(t, action, supply, done);
      return;
    }

    // An Electronic Attack opens the Counter-roll targeting whatever its
    // printed TYPE says — the Raven's Fire Control Interference is typed
    // Tactic, and keying on the type let it fall through to "follow the card
    // text" (4.11). Mirrors routeAction in matchhud.ts.
    if (isElectronicAttack(action)) {
      pendingAttack = { attackerUid: uid, actionId, mode: 'electronic', action, done };
      document.body.classList.add('targeting');
      if (action.range) board.showRangeRings(t, action.range);
      setHint(`${what}: click the target unit on the board.${action.range ? ` Range ${action.range} is shown.` : ''} Terrain and line of sight are ignored (4.11.1)${action.speed === 'auto' ? ', and an Automatic Action targets the NEAREST enemy in range (3.5.2)' : ''}. Esc cancels.`);
      return;
    }

    if (action.type === 'Firing' || action.type === 'Melee') {
      const electronic = isElectronicAttack(action);
      // [Stationary]: no Movement yet this Opportunity pays the printed bonus
      // (Range +N or +NY). Judged here so the rings, the hint and the helper
      // all read the same reach. Mirrors attackPanel in matchhud.ts.
      const opp0 = state.script?.opp;
      const adjusted = stationaryAdjusted(action, opp0?.uid === uid ? opp0 : null);
      void offerChargeSpend(t, actionId);
      pendingAttack = { attackerUid: uid, actionId, mode: electronic ? 'electronic' : 'attack', action: adjusted, done };
      document.body.classList.add('targeting');
      if (adjusted.range) board.showRangeRings(t, adjusted.range);
      const reach = adjusted.range ? ` Range ${adjusted.range} is shown.${adjusted !== action ? ' Stationary applies.' : ''}` : '';
      // FAQ O9: an Auto Action with no enemy in reach MAY take Breakable Terrain
      // instead, and only the nearest. Said here because it is the half a player
      // cannot deduce - destroying the piece itself is already a click away.
      const neutral = action.speed === 'auto'
        ? autoNeutralTargets(data, state.tokens, currentTerrain(), t, action)
        : [];
      const fallback = neutral.length
        ? ` No enemy is in range, so this MAY instead hit the nearest Breakable Terrain - ${
          neutral.map((n) => gridOfTerrain(n.id)).join(' or ')
        } - which you destroy by clicking the piece (FAQ O9). Buildings and Defense walls never count (O10).`
        : '';
      setHint(`${what}: click the target unit on the board.${reach}${fallback} Esc cancels and keeps the Tick.`);
      return;
    }

    // Prototype Blink is typed Moving but is TELEPORTATION (FAQ E20.2), so it
    // must not fall into the route-drawing branch below: there is no path to
    // walk, no Break Away to pay and no terrain in the way. It is caught by the
    // swap it offers rather than by the card id, so any future card written the
    // same way is covered.
    if (isPositionSwap(action)) {
      void performBlink(t, action, done);
      return;
    }

    if (action.type === 'Moving') {
      const range = action.range || maneuverRange(data, t);
      // A shove rides on the Movement rather than replacing it, so the push is
      // offered once the Mech has finished moving.
      void startMove(uid, { range, label: what, airborne: isAirborneAction(action) }, (moved) => {
        if (!moved || !knockbackOf(action, data.actionTranslation(actionId)?.english ?? undefined)) return done(moved);
        void offerShove(t, action).then(() => done(true));
      });
      return;
    }

    if (action.type === 'Projectile') {
      const ga = guidedActions(data, t, { tokens: state.tokens, terrain: currentTerrain() }).find((g) => g.action.id === actionId);
      const shot = ga?.projectiles ?? [];
      if (!shot.length) {
        void alertDialog({
          title: 'Nothing to place',
          body: `${what} is a Projectile Action, but the card data does not say which Projectile or Deployable it puts on the board. Place it by hand from the Add tab, then mark the action done.`,
        });
        return done(false);
      }
      if (shot.length === 1) {
        startLaunch(t, action, shot[0], done);
        return;
      }
      void choiceDialog({
        title: `${what}: what are you launching?`,
        body: 'This Action can put more than one thing on the board, so pick which.',
        choices: shot.map((p) => ({ id: p.id, label: cardName(p) })),
      }).then((id) => {
        const pick = shot.find((p) => p.id === id);
        if (pick) startLaunch(t, action, pick, done);
        else done(false);
      });
      return;
    }

    // Pholcus does not resolve a payload in the Delay Phase, it becomes a Drone
    // (FAQ M18). The replacement lands first; if the Grid it comes up in is
    // occupied, the sweep below has it detonate on the spot (M18.4).
    if (unfoldsOwed(data, [t]).some((x) => x.actionId === actionId)) {
      perform(data, state, { kind: 'unfold', seat: t.side, uid: t.uid });
      logTo(t, `${t.label} Unfolds into its Drone form. It cannot act until next round - the Automatic Phase has already passed (FAQ M8).`);
      onChanged();
      return done(true);
    }

    // A Projectile acting in the Delay Phase is resolving its payload, so its
    // action opens the same Detonation resolver the Details tab uses (3.6.2).
    if (t.kind === 'projectile' && action.type !== 'Passive') {
      startDetonation(t, actionId);
      return done(true);
    }

    // Swift and Tactical actions are card text rather than a board procedure, so
    // the guide puts the text in front of you and lets you carry it out.
    showSideTab('details');
    document.querySelector(`[data-action-row="${actionId}"]`)?.scrollIntoView({ block: 'nearest' });
    if (action.range) board.showRangeRings(t, action.range);
    showInspect({
      title: what,
      sub: `${action.type ?? 'Action'} · ${t.label}`,
      lines: rulesLines(action.description?.en || data.actionTranslation(actionId)?.english || action.description?.zh || 'Follow the text on the card.'),
    });
    setHint(`${what}: follow the action text, shown in the Details tab.`);
    return done(true);
  }

  // ---------- pre-game setup (rulebook 3.1.2, 3.1.4) ----------

  // Two dice each, most Hits goes first. The rulebook digest lost the printed
  // die colour here, so the roll uses Yellow, which is the Hit die with the
  // widest spread and therefore the fewest ties.
  function rollForFirstPlayer(side: Side): void {
    const faces = [0, 1].map(() => dice.dice.yellow.faces[Math.floor(Math.random() * dice.dice.yellow.sides)]);
    // The dice ride in the command as Hits, never re-rolled by a receiver.
    perform(data, state, { kind: 'rollSetup', seat: side, hits: faces.map((f) => countHits([f])) });
    const su = normaliseSetup(state.setup) ?? newSetup();
    // A re-roll after a tie starts the comparison over for both sides.
    if (su.rolls.s1.length && su.rolls.s2.length && !firstPlayerFrom(su) && side === 's2') {
      tray.addToPool({ yellow: 2 }, true);
    }
    onChanged();
  }

  // Placement highlights only the Grids of that side's own Deployment Zone, so a
  // unit cannot be dropped outside it.
  function startDeployPlacement(uid: number, opts: { stance: Stance; camo: boolean }): void {
    const t = state.tokens.find((x) => x.uid === uid);
    const su = normaliseSetup(state.setup);
    if (!t || !su) return;
    const shape = overlayDeployment()?.[su.edge[t.side]];
    const cells = deployCells(shape);
    if (!cells.length) {
      void alertDialog({
        title: 'No Deployment Zone on this map',
        body: `Nothing is painted for the ${su.edge[t.side]} side. Pick a zone set that includes deployment from the Zones list in the toolbar, or paint one in the map editor, then try again.`,
      });
      return;
    }
    const terrain = currentTerrain();
    // A unit still waiting to deploy keeps its old coordinates, so it must not be
    // treated as standing anywhere.
    const onBoard = state.tokens.filter((x) => x.deployed !== false);
    // selectToken clears the highlight layer, so the picker is drawn after it.
    selectToken(uid);
    const free = cells.filter((g) => standingSpot(g.c, g.r, t.size, t.aerial, terrain, onBoard, t.uid));
    board.showSmokeTargets(
      free.map((g) => ({ ...g, ok: true })),
      (c, r) => {
        const spot = standingSpot(c, r, t.size, t.aerial, terrain, onBoard, t.uid);
        if (!spot) return;
        // The picker resolved the legal spot; the placement itself is a command.
        perform(data, state, { kind: 'deployUnit', seat: t.side, uid: t.uid, to: { col: spot.col, row: spot.row }, stance: opts.stance, camo: opts.camo });
        board.clearHighlights();
        logTo(
          t,
          `Deployed to ${gridRef(c, r)}${t.kind === 'mech' ? ` in ${opts.stance.toUpperCase()} stance` : ''}${
            opts.camo ? ', already in Optical Camouflage' : ''
          }.`,
        );
        selectToken(uid);
        onChanged();
      },
    );
    setHint(`Deploying ${t.label}: click a highlighted Grid in the ${su.edge[t.side]} Deployment Zone. Esc stops.`);
  }

  function deployCells(shape: DeployShape | undefined): { c: number; r: number }[] {
    if (!shape) return [];
    if (shape.cells?.length) return shape.cells.map((x) => ({ c: x.col, r: x.row }));
    const rect = shape.rect;
    if (!rect) return [];
    const out: { c: number; r: number }[] = [];
    for (let c = rect.col; c < rect.col + rect.cols; c++) for (let r = rect.row; r < rect.row + rect.rows; r++) out.push({ c, r });
    return out;
  }

  // Taking every unit off the board but leaving it in the squad, so a game can
  // start properly from whatever was being messed about with.
  async function startGame(): Promise<void> {
    const live = state.tokens.filter((t) => t.kind !== 'projectile');
    const ok = await confirmDialog({
      title: 'Start a game?',
      body: live.length
        ? `The ${live.length} unit${live.length === 1 ? '' : 's'} on the board come off and wait in their squads. You then roll for First Player and deploy them one at a time. Projectiles are cleared.`
        : 'Both squads are empty, so you roll for First Player and then build squads from the Add tab before deploying.',
      confirmLabel: 'Start game',
    });
    if (!ok) return;
    // The state half lives in the command layer, so a networked opponent
    // starts the identical match at the same moment.
    perform(data, state, { kind: 'startMatch', seat: 's1' });
    selectToken(null);
    onChanged();
  }

  // Everything a squad brought, as card ids with their category. Duplicates are
  // kept on purpose: two of the same Part is two uses, which is exactly what
  // "most used" should count.
  function squadEntriesFor(side: Side): SquadEntry[] {
    const out: SquadEntry[] = [];
    const push = (id: string): void => {
      const card = data.byId.get(id);
      if (card) out.push({ id, cat: (card.category ?? 'mech_part') as SquadEntry['cat'] });
    };
    // Everything the side FIELDED, so a Mech that died still counts as brought
    // — see rememberFielded. A board from before the roster existed has none,
    // and falls back to whatever is still standing.
    const roster = state.fielded?.[side];
    if (roster && Object.keys(roster).length) {
      for (const ids of Object.values(roster)) for (const id of ids) push(id);
    } else {
      for (const t of state.tokens) {
        if (t.side !== side || t.kind === 'projectile') continue;
        for (const { card } of tokenCards(data, t)) push(card.id);
      }
    }
    for (const id of state.tactics?.[side] ?? []) {
      if (data.byId.get(id)) out.push({ id, cat: 'tactics_or_upgrade' });
    }
    // The server caps a squad at 80 entries; no real list comes close.
    return out.slice(0, 80);
  }

  // Recording is opt-in and never blocks ending a game. A failure here is
  // reported and then dropped: the match happened whether or not the server
  // heard about it.
  async function offerToRecord(res: GameResult, tasks: TaskState): Promise<void> {
    if (!emberApi.user) return;
    const s1 = squadLabel('s1');
    const s2 = squadLabel('s2');
    const pick = await choiceDialog({
      title: 'Record this game?',
      body: `Saved to your account on embertg.online, where it counts towards squad and card statistics. Pick the squad you played, or record it without claiming a side.`,
      stacked: true,
      choices: [
        { id: 's1', label: `I played ${s1}` },
        { id: 's2', label: `I played ${s2}` },
        { id: 'neither', label: 'I played both sides' },
        { id: 'cancel', label: 'Do not record it', cancel: true },
      ],
    });
    if (!pick || pick === 'cancel') return;

    const alg = (side: Side) => squadAllegiance(data, state.tokens.filter((t) => t.side === side)).faction;
    try {
      await emberApi.recordGame({
        mode: 'hotseat',
        mission: state.mission ?? null,
        scale: state.scale ?? null,
        rounds: Math.max(1, Math.min(20, state.round.n)),
        winnerSeat: res.winner,
        mySeat: pick === 'neither' ? null : (pick as Side),
        players: (['s1', 's2'] as Side[]).map((side) => ({
          seat: side,
          faction: alg(side),
          vp: Math.max(0, tasks.vp[side]),
          squad: squadEntriesFor(side),
        })),
      });
      setHint('Game recorded to your account.');
    } catch (err) {
      await alertDialog({
        title: 'Could not record the game',
        body: `${(err as ApiError).message} The game itself is unaffected.`,
      });
    }
  }

  // Leaves the guided game and hands the board back, keeping everything where it
  // stands so a match can be abandoned without losing the position.
  async function endGame(): Promise<void> {
    const waiting = state.tokens.filter((t) => t.deployed === false).length;
    const ok = await confirmDialog({
      title: 'End the game?',
      body: waiting
        ? `The board goes back to free play and the map and zones unlock. ${waiting} unit${
            waiting === 1 ? ' is' : 's are'
          } still waiting to deploy and will be put back on the board where they last stood.`
        : 'The board goes back to free play and the map and zones unlock. Everything stays exactly where it is.',
      confirmLabel: 'End game',
    });
    if (!ok) return;
    // Most Victory Points wins, and a tie goes to Mech Parts and Drones left on
    // the board (5.2.4). Reported before the board unlocks and units move.
    const tasks = normaliseTasks(state.tasks);
    if (state.mission || tasks.vp.s1 || tasks.vp.s2) {
      const res = gameResult(tasks, state.tokens);
      await alertDialog({
        title: res.winner ? `${squadLabel(res.winner)} wins` : 'A draw',
        body: `${res.why}.`,
      });
      // Offered before the board unlocks, because the squads and Victory
      // Points are still standing here and are gone a few lines below.
      await offerToRecord(res, tasks);
    }
    // The cleanup lives in the command layer, so both boards leave the match
    // together. The result dialog and recording above already ran.
    perform(data, state, { kind: 'endMatch', seat: 's1' });
    onChanged();
  }

  // ---------- interception (rulebook 4.9) ----------

  // Interception is a Firing Attack against the Aerial Unit that triggered it,
  // so it goes through the attack helper rather than merely ticking a counter.
  // The target must be that unit, there is no Forward Arc test, line of sight
  // always exists, and no Terrain or Unit Protection may be claimed.
  function startIntercept(t: Token, actionId: string): void {
    const left = t.intercept?.[actionId] ?? 0;
    const action = findAction(t, actionId);
    if (!action) return;
    const name = action.name.en || action.name.zh || actionId;
    if (left <= 0) {
      void alertDialog({
        title: 'No Interception Tokens left',
        body: `${name} has spent all of its Interception Tokens. They are never restored, so this Part cannot Intercept again for the rest of the game (rulebook 4.9).`,
      });
      return;
    }
    const reach = action.range ?? 0;
    const targets = state.tokens.filter(
      (x) => x.side !== t.side && x.aerial && rangeBetween(t, x).range <= reach,
    );
    if (!targets.length) {
      void alertDialog({
        title: 'Nothing to Intercept',
        body: `Interception only triggers on an enemy Aerial Unit that Moved or was Launched, and there is none within Range ${reach} of ${t.label}. Projectiles and Missiles are the usual targets.`,
      });
      return;
    }
    const chosen = interceptPrefer !== null ? targets.find((x) => x.uid === interceptPrefer) : undefined;
    interceptPrefer = null;
    pendingIntercept = { uid: t.uid, actionId, action };
    if (chosen) {
      spendIntercept(t, actionId, name);
      attackHelper.start(t, action, chosen, 'Interception: line of sight always exists and no Forward Arc is required (4.9).', 0, '', false, true);
      interceptFollowUp = { uid: t.uid, actionId, targetUid: chosen.uid };
      pendingIntercept = null;
      selectToken(t.uid);
      showSideTab('combat');
      onChanged();
      return;
    }
    pendingAttack = {
      attackerUid: t.uid,
      actionId,
      mode: 'attack',
      action,
      done: () => {},
    };
    document.body.classList.add('targeting');
    board.showRangeRings(t, reach);
    setHint(`${name}: click the enemy Aerial Unit that triggered this Interception. Esc cancels without spending a Token.`);
  }

  let pendingIntercept: { uid: number; actionId: string; action: CardAction } | null = null;
  let interceptFollowUp: { uid: number; actionId: string; targetUid: number } | null = null;
  let interceptPrefer: number | null = null;

  // An Interception that fails to destroy its target obliges the SAME unit to
  // intercept again until its Tokens run out or the target dies (4.9), so the
  // guide chases it rather than letting the chain be forgotten.
  function checkInterceptFollowUp(): void {
    const f = interceptFollowUp;
    interceptFollowUp = null;
    if (!f) return;
    const t = state.tokens.find((x) => x.uid === f.uid);
    const target = state.tokens.find((x) => x.uid === f.targetUid);
    if (!t) return;
    // A destroyed interceptor owes nothing: the obligation to keep trying (4.9)
    // died with the unit, so no prompt should name it.
    const tDead =
      t.kind === 'mech'
        ? Object.values(t.partStates).filter((p) => p !== 'destroyed').length === 0
        : (t.partStates.main ?? 'intact') === 'destroyed';
    if (tDead) return;
    const dead = !target || (target.partStates.main ?? 'intact') === 'destroyed';
    const left = t.intercept?.[f.actionId] ?? 0;
    if (dead) {
      showInspect({
        title: 'Interception complete',
        sub: `${t.label}`,
        lines: ['The target was destroyed, so the chain ends here.', `${left} Interception Token${left === 1 ? '' : 's'} left on that Part for the rest of the game.`],
      });
      return;
    }
    if (left <= 0) {
      showInspect({
        title: 'Out of Interception Tokens',
        sub: `${t.label}`,
        lines: [
          `${target.label} survived, but ${t.label} has spent every Interception Token on that Part and cannot try again (4.9).`,
          'Any other unit in range now intercepts in sequence.',
        ],
      });
      return;
    }
    // Interception is mandatory and repeats until the Tokens or targets run
    // out (4.9, FAQ M5). The strict tracker enforces that outright; teaching
    // mode keeps the door with a warning, in the house style.
    if (state.script?.strict) {
      void alertDialog({
        title: 'Interception continues',
        body: `${target.label} survived, so ${t.label} MUST Intercept again (rulebook 4.9, FAQ M5). ${left} Token${left === 1 ? '' : 's'} left.`,
        closeLabel: 'Intercept again',
      }).then(() => startIntercept(t, f.actionId));
      return;
    }
    void confirmDialog({
      title: 'Intercept again',
      body: `${target.label} survived, so ${t.label} MUST Intercept again until its Tokens run out or the target is destroyed (rulebook 4.9). ${left} Token${left === 1 ? '' : 's'} left.`,
      confirmLabel: 'Intercept again',
      cancelLabel: 'Stop here',
    }).then((again) => {
      if (again) startIntercept(t, f.actionId);
    });
  }

  // Through the command for the same reason Charge is: `t.intercept` is in the
  // board fingerprint and check() reads it to refuse an Interception with no
  // Token left, so spending one by hand left an online game disagreeing about
  // what a Part could still do.
  function spendIntercept(t: Token, actionId: string, name: string): void {
    const left = t.intercept?.[actionId] ?? 0;
    if (left <= 0) return;
    if (!perform(data, state, { kind: 'spendIntercept', seat: t.side, uid: t.uid, actionId }).ok) return;
    logTo(
      t,
      left - 1 === 0
        ? `${t.label} Intercepts with ${name}, spending its last Interception Token. That Part cannot Intercept again this game.`
        : `${t.label} Intercepts with ${name}. ${left - 1} Interception Token${left - 1 === 1 ? '' : 's'} left on the Part.`,
    );
  }

  // ---------- launching projectiles (rulebook 4.7) ----------

  function gridRef(c: number, r: number): string {
    return `${String.fromCharCode(65 + c)}${r + 1}`;
  }


  let launching: {
    uid: number;
    action: CardAction;
    card: Card;
    left: number;
    placed: number;
    // Every projectile put down this volley, so the last one can be taken back.
    placedUids: number[];
    done: (performed: boolean) => void;
  } | null = null;

  // A Landing Point is a Grid within the Action's Range. Direct Fire needs sight
  // of it and cannot pick a Grid that terrain fills; Fire in arc needs neither.
  function landingCandidates(): { c: number; r: number; ok: boolean }[] {
    const m = launching!;
    const t = state.tokens.find((x) => x.uid === m.uid);
    if (!t) return [];
    const sight = needsSightToLanding(m.action);
    const range = m.action.range ?? 0;
    const terrain = currentTerrain();
    const out: { c: number; r: number; ok: boolean }[] = [];
    const from = { c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) };
    for (let c = 0; c < LG; c++) {
      for (let r = 0; r < LG; r++) {
        if (Math.abs(c - from.c) + Math.abs(r - from.r) > range) continue;
        if (sight) {
          const probe = { ...t, col: c * 3 + 1, row: r * 3 + 1, size: 1 as const };
          if (losBetween(t, probe, terrain, state.tokens) === 'blocked') continue;
          if (!standingSpot(c, r, 1, false, terrain, state.tokens, t.uid)) continue;
        }
        out.push({ c, r, ok: true });
      }
    }
    return out;
  }

  function renderLaunchStep(): void {
    const m = launching;
    if (!m) return;
    const body = document.getElementById('combat-body')!;
    const cands = landingCandidates();
    const total = m.left + m.placed;
    // The volley is over but the panel stays for the undo. Arming the board in
    // this state let a click launch a projectile the volley never had - the
    // magazine clamp hid the overdraft - so a spent launch shows no targets.
    const spent = m.left <= 0;
    body.innerHTML = `<div class="attack-helper">
      <div class="ah-head ah-head-stack"><b>Launch ${escapeHtml(cardName(m.card))}</b>
        <span class="dim">${escapeHtml(m.action.name.en || m.action.name.zh || m.action.id)}${
          total > 1 ? ` ${m.placed} of ${total} launched` : ''
        }</span></div>
      <p class="ah-los">${
        needsSightToLanding(m.action)
          ? 'Direct Fire, so the Landing Point has to be a Grid this unit can see and one terrain does not fill.'
          : 'Fire in arc, so no line of sight to the Landing Point is needed.'
      } A Landing Point is a Grid, not a unit, and nothing is targeted yet.</p>
      <div class="ah-step">${
        spent
          ? `<h4>Everything is launched</h4>
        <p class="dim">Take one back with ↺, or stop here to finish the Action.</p>`
          : `<h4>Click a highlighted Grid on the board</h4>
        <p class="dim">${cands.length} legal ${cands.length === 1 ? 'Grid' : 'Grids'} within Range ${m.action.range ?? 0}.
          ${total > 1 ? `Volley ${total} lets you place up to ${total}, one Ammo Token each, and you may stop early.` : 'One Ammo Token is spent.'}</p>`
      }</div></div>`;
    const head = body.querySelector('.ah-head')!;
    if (m.placed) {
      const undo = document.createElement('button');
      undo.className = 'ah-undo';
      undo.innerHTML = '↺';
      undo.title = `Take back the last ${cardName(m.card)}, and its Ammo`;
      undo.setAttribute('aria-label', undo.title);
      undo.addEventListener('click', () => undoLaunched());
      head.appendChild(undo);
    }
    const cancel = document.createElement('button');
    cancel.className = 'ah-cancel';
    cancel.textContent = m.placed ? 'Stop here' : 'Cancel';
    cancel.addEventListener('click', () => finishLaunch());
    head.appendChild(cancel);
    // The hint follows the state both ways, because an undo walks the panel
    // back from spent to placing and the old text would sit there lying.
    if (spent) {
      board.clearHighlights();
      setHint(`${m.action.name.en || m.action.id}: all launched. Take one back or press Esc to finish.`);
    } else {
      board.showSmokeTargets(cands, (c, r) => placeLaunched(c, r));
      setHint(`${m.action.name.en || m.action.id}: click a Landing Point Grid on the board. Esc stops.`);
    }
    showSideTab('combat');
  }

  function placeLaunched(c: number, r: number): void {
    const m = launching;
    if (!m) return;
    // The belt to the grace state's braces: even if a stale target layer fires,
    // a volley with nothing left places nothing.
    if (m.left <= 0) return;
    const t = state.tokens.find((x) => x.uid === m.uid);
    if (!t) return;
    // Sizing the landing check off the card rather than a probe token: minting
    // one here would burn a uid the launch command then cannot reproduce.
    const spot = standingSpot(c, r, unitSize(m.card), isAerial(m.card), currentTerrain(), state.tokens, undefined, { col: t.col, row: t.row });
    if (!spot) {
      void alertDialog({
        title: 'Nothing fits there',
        body: `There is no room in that Grid for ${cardName(m.card)}. Rulebook 4.7.2 needs the projectile's base to sit entirely inside the Landing Point Grid, so pick another one.`,
      });
      return;
    }
    const id = m.action.id;
    // The launch spawns the projectile and spends the Ammo in one command. In
    // strict play a refusal spawns nothing, and reading the last token then
    // would adopt some unrelated unit as the "projectile" and despawn it on
    // undo - while the sandbox applies even a failing command, so the verdict
    // alone cannot say whether anything landed. The board growing can.
    const before = state.tokens.length;
    perform(data, state, { kind: 'launch', seat: t.side, uid: t.uid, actionId: id, cardId: m.card.id, to: { col: spot.col, row: spot.row }, facing: t.facing });
    if (state.tokens.length === before) return;
    const placed = state.tokens[state.tokens.length - 1];
    m.placedUids.push(placed.uid);
    m.placed++;
    m.left--;
    logTo(t, `Launched ${cardName(m.card)} to ${gridRef(c, r)}${t.ammo[id] !== undefined ? ` (Ammo ${t.ammo[id]} left)` : ''}.`);
    onChanged();
    // A single shot closes on its own, but a Volley stays open once it is spent
    // so the last projectile can still be taken back before it counts.
    const spent = m.left <= 0 || (t.ammo[id] !== undefined && t.ammo[id] <= 0);
    if (spent && m.placed + m.left <= 1) finishLaunch();
    else renderLaunchStep();
  }

  // Interception is only owed once the launch is finished, so taking one back
  // before then just undoes the placement and the Ammo that paid for it.
  function undoLaunched(): void {
    const m = launching;
    if (!m || !m.placedUids.length) return;
    const uid = m.placedUids.pop()!;
    const t = state.tokens.find((x) => x.uid === m.uid);
    const id = m.action.id;
    if (t) {
      perform(data, state, { kind: 'despawn', seat: t.side, uid: t.uid, targetUid: uid });
      perform(data, state, { kind: 'restoreAmmo', seat: t.side, uid: t.uid, actionId: id });
    } else {
      state.tokens = state.tokens.filter((x) => x.uid !== uid);
    }
    m.placed--;
    m.left++;
    if (t) logTo(t, `Took back a ${cardName(m.card)}${t.ammo[id] !== undefined ? ` (Ammo ${t.ammo[id]} left)` : ''}.`);
    if (selectedUid === uid) selectToken(m.uid);
    onChanged();
    renderLaunchStep();
  }

  function finishLaunch(): void {
    const m = launching;
    launching = null;
    board.clearHighlights();
    setHint('');
    if (!m) return;
    // Only a LAUNCHED projectile triggers Interception; a Deployed or Laid
    // one arrives quietly (FAQ M20).
    if (m.placed && projectileDelivery(m.action) === 'launch') noteInterception(m.uid);
    m.done(m.placed > 0);
    onChanged();
    // The launch panel has nothing left to say once the volley is over, and
    // leaving it up with live-looking buttons reads as unfinished business.
    renderCombatIdle();
    const shooter = state.tokens.find((x) => x.uid === m.uid);
    if (shooter) {
      selectToken(shooter.uid);
      panel.showToken(shooter);
    }
    showSideTab('details');
    checkInterceptFollowUp();
  }

  function noteInterception(launcherUid: number): void {
    const t = state.tokens.find((x) => x.uid === launcherUid);
    if (!t || !state.script) return;
    const fresh = state.tokens.filter((x) => x.parentUid === launcherUid && x.kind === 'projectile');
    if (!fresh.length) return;
    const owed = interceptsOwed(data, state.tokens, state.smoke ?? [], t, fresh);
    if (!owed.length) return;
    perform(data, state, { kind: 'queueIntercepts', seat: t.side, items: owed });
    logTo(t, `Launch triggers Interception: ${owed.length} attempt${owed.length === 1 ? '' : 's'} owed.`);
  }

  function startLaunch(t: Token, action: CardAction, card: Card, done: (performed: boolean) => void): void {
    const ammo = t.ammo[action.id];
    const shots = Math.min(volleyOf(action), ammo === undefined ? volleyOf(action) : ammo);
    if (shots <= 0) {
      void alertDialog({
        title: 'Out of Ammo',
        body: `${action.name.en || action.id} has no Ammo Tokens left, so it cannot be performed (rulebook 4.13).`,
      });
      return done(false);
    }
    launching = { uid: t.uid, action, card, left: shots, placed: 0, placedUids: [], done };
    selectToken(t.uid);
    // renderLaunchStep owns the hint, so the text always matches the state.
    renderLaunchStep();
  }

  function endTargeting(cancelled = false): void {
    if (cancelled) pendingAttack?.done?.(false);
    pendingAttack = null;
    pendingIntercept = null;
    board.clearHighlights();
    document.body.classList.remove('targeting');
    // Clearing through setHint, which is what brings the shortcut keys back.
    // The old hard-coded shortcut string predates the hint bar owning them and
    // left its text sitting where an instruction would go.
    setHint('');
  }

  // How many more of this card you could still put on the board.
  // null means no limit: either the filter is off, or the card has no box data.
  function stockLeft(card: Card): number | null {
    if (!inventory.filterEnabled || !inventory.hasAny()) return null;
    if (!(card.containedIn ?? []).length) return null;
    const owned = inventory.ownedCount(card);
    if (!owned) return 0;
    return Math.max(0, owned - (deployedCardCounts(state.tokens).get(card.id) ?? 0));
  }

  const roster = new Roster(data, {
    now: () => Date.now(),
    squadAllegiance: (side) => squadAllegiance(data, state.tokens.filter((t) => t.side === side)),
    cardFilter: (card) => {
      if (!inventory.passes(card)) return false;
      const left = stockLeft(card);
      return left === null || left > 0;
    },
    squadPoints: () => {
      const out = { s1: 0, s2: 0 };
      for (const t of state.tokens) {
        if (t.kind === 'projectile') continue;
        out[t.side] += tokenCards(data, t).reduce((n, { card }) => n + (card.score ?? 0), 0);
      }
      for (const side of ['s1', 's2'] as const) {
        for (const id of state.tactics?.[side] ?? []) out[side] += data.byId.get(id)?.score ?? 0;
      }
      return out;
    },
    heldTactics: () => ({ s1: state.tactics?.s1 ?? [], s2: state.tactics?.s2 ?? [] }),
    // Through the command layer rather than by hand: a hand set locally is a
    // hand the other client never sees, and check() for playTactic reads the
    // *sender's* hand — so a card played across a table would be refused.
    // A hand is not on the board, so the stock signature onChanged() watches
    // never changes and it would not repaint the Add tab on its own. Both
    // panels are redrawn by hand: onChanged() for the squad card and its
    // points, roster.render() for the ×N on the buttons.
    onAddTactic: (card, side) => {
      perform(data, state, { kind: 'setTactics', seat: side, cards: [...(state.tactics?.[side] ?? []), card.id] });
      onChanged();
      roster.render();
    },
    onDropTactic: (card, side) => {
      const held = [...(state.tactics?.[side] ?? [])];
      const i = held.lastIndexOf(card.id);
      if (i < 0) return;
      held.splice(i, 1);
      perform(data, state, { kind: 'setTactics', seat: side, cards: held });
      onChanged();
      roster.render();
    },
    pointsCap: () => {
      const sc = SCALES.find((x) => x.id === (state.scale ?? 'standard'));
      return sc ? { name: sc.name, points: sc.points, openEnded: !!sc.openEnded } : null;
    },
    cardBadge: (card) => {
      if (!inventory.hasAny()) return '';
      const left = stockLeft(card);
      if (left !== null) return ` ×${left} left`;
      const n = inventory.ownedCount(card);
      return n > 0 ? ` ×${n}` : '';
    },
    onPreview: (card, opts) => {
      panel.showCard(card);
      if (opts?.focus !== false) showSideTab('details');
    },
    onAddUnit(card, side, load) {
      // A Carrier arrives with its Load already on its back; every other unit
      // passes nothing and makeDroneToken leaves the slot alone.
      const tok = makeDroneToken(state, data, card, side, load);
      placeNew(tok, side);
    },
    onAddMech(loadout: MechLoadout, side) {
      const tok = makeMechToken(state, data, loadout, side);
      placeNew(tok, side);
    },
    onSaveSquad: () => saveSquadFlow(),
    onLoadSquad: (id) => {
      const sq = loadSquads().find((s) => s.id === id);
      if (sq) void loadSavedSquad(sq);
    },
    // The unit keeps its identity across an edit: same uid, square, facing,
    // stance, Link, tokens and log. Only a slot whose Part actually changed is
    // reset, because that is a different Part now and its damage went with the
    // old one. A default label is recomputed so a renamed unit keeps its name.
    onSaveMech(uid, loadout) {
      const t = state.tokens.find((x) => x.uid === uid);
      if (!t || t.kind !== 'mech') return;
      const before = t.mech ?? {};
      const named = t.label !== defaultUnitLabel(data, t);
      const states = { ...t.partStates };
      for (const slot of ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'] as const) {
        if (before[slot] === loadout[slot]) continue;
        if (slot === 'pilot') continue;
        if (loadout[slot]) states[slot] = 'intact';
        else delete states[slot];
      }
      t.mech = { ...loadout };
      t.partStates = states;
      // A Part swapped in brings its own magazine, and nothing else would seed
      // it until the next load.
      syncMagazines(data, t);
      if (!named) t.label = defaultUnitLabel(data, t);
      selectToken(t.uid);
      onChanged();
      panel.showToken(t);
    },
  });

  // ---------- helpers ----------

  function selectToken(uid: number | null): void {
    selectedUid = uid;
    board.setSelected(uid);
    board.clearRange();
    board.clearHighlights();
    const t = state.tokens.find((x) => x.uid === uid);
    if (t) {
      panel.showToken(t);
      if (!combatBusy()) showSideTab('details');
    } else if (!combatBusy()) {
      panel.clear();
    }
    renderUnitLog();
    squadTracker.update(state, selectedUid);
  }

  function deployingNow(): boolean {
    const su = normaliseSetup(state.setup);
    return !!su && su.stage !== 'done';
  }

  function placeNew(tok: Omit<Token, 'col' | 'row' | 'facing'>, side: Side): void {
    // Mid-setup a new unit joins the squad rather than the board, so it goes
    // through deployment like everything else.
    if (deployingNow()) {
      state.tokens.push({ ...tok, col: 0, row: 0, facing: side === 's1' ? 2 : 0, deployed: false });
      onChanged();
      return;
    }
    const spot = findFreeSpot(tok.size, side, tok.aerial);
    if (!spot) {
      void alertDialog({
        title: 'No room on the board',
        body: 'There is no free space in this side’s deployment area large enough for the unit. Remove something, or drag units apart, and try again.',
      });
      return;
    }
    state.tokens.push({ ...tok, col: spot.col, row: spot.row, facing: side === 's1' ? 2 : 0 });
    onChanged();
  }

  // ---------- guided movement ----------

  let movePlan: {
    uid: number;
    side: Side;
    steps: number;
    flying: boolean;
    // The route the player has actually committed, drawn solid.
    path: { c: number; r: number }[];
    // How long `path` was after each click. The first entry is the unit's own
    // starting Grid, so popping one is Back and there is always a floor.
    marks: number[];
    // The candidate under the cursor: the committed route plus the run that
    // would reach the hovered Grid. Drawn dashed and thrown away on the next
    // hover — moving the mouse must never change where the unit is going.
    preview: { c: number; r: number }[] | null;
    label: string;
    // ZHDR-304 Harpy: an Ally it is dragging along, declared BEFORE the move
    // because the -2 Movement comes out of the allowance rather than being paid
    // afterwards. The Mech whose Command Token funds it is recorded with it.
    drag?: { allyUid: number; funderUid: number };
    done: (moved: boolean) => void;
  } | null = null;

  // Hovering only PREVIEWS. The route used to follow the bare cursor and commit
  // as it went, which meant moving the mouse rewrote where the unit was going
  // and a click was needed to freeze it — three ideas for one job, and the
  // accidental one fired constantly. Now the cursor proposes and a click
  // decides.
  //
  // extendPath solves the run from the committed end to the hovered Grid, so a
  // distant Grid is one click away; clicking on along the way chains waypoints
  // and keeps the deliberate zigzag the old freehand trace existed for.
  function previewMove(c: number, r: number): void {
    const m = movePlan;
    if (!m) return;
    const t = state.tokens.find((x) => x.uid === m.uid);
    if (!t) return;
    const cand = extendPath(m.path, { c, r }, t, m.steps, currentTerrain(), state.tokens, m.flying, moveOpts(t, m.flying));
    // Unreachable from here: keep showing what is committed rather than
    // blanking the board, so the drawn route does not flicker as the cursor
    // crosses terrain.
    m.preview = cand;
    board.showMovePath(cand ?? m.path, m.side, !cand);
    renderMoveCtrl();
  }

  // A click takes the previewed run. Nothing else commits, so the route only
  // ever changes when the player says so.
  function commitWaypoint(): void {
    const m = movePlan;
    if (!m || !m.preview) return;
    m.path = m.preview;
    m.marks.push(m.path.length);
    m.preview = null;
    board.showMovePath(m.path, m.side, true);
    renderMoveCtrl();
  }

  // Back: drop the last committed waypoint. marks[0] is the unit's own Grid, so
  // this stops at the start rather than emptying the path.
  function undoWaypoint(): void {
    const m = movePlan;
    if (!m || m.marks.length < 2) return;
    m.marks.pop();
    m.path = m.path.slice(0, m.marks[m.marks.length - 1]);
    m.preview = null;
    board.showMovePath(m.path, m.side, true);
    renderMoveCtrl();
  }

  // The move bar lives under the board, which a first-time player reading the
  // guide never looks at. Mirror it into the guide for as long as a move is live.
  function renderGuideMove(label: string, drawn: number, steps: number, locked: boolean): void {
    const body = document.querySelector('#play-guide .pg-body');
    document.getElementById('pg-move')?.remove();
    if (!body) return;
    const box = document.createElement('div');
    box.id = 'pg-move';
    box.className = 'pg-move';
    const info = document.createElement('p');
    info.className = 'pg-move-info';
    info.textContent = drawn
      ? `${label}: ${drawn} of ${steps} grids${locked ? ' · locked' : ''}`
      : `${label}: draw a route on the board (up to ${steps})`;
    const ok = document.createElement('button');
    ok.className = 'pg-move-ok';
    ok.textContent = 'Confirm move';
    ok.disabled = drawn === 0;
    ok.addEventListener('click', () => commitMove());
    const no = document.createElement('button');
    no.className = 'pg-move-no';
    no.textContent = 'Cancel';
    no.addEventListener('click', () => cancelMove());
    box.append(info, ok, no);
    body.prepend(box);
  }

  function renderMoveCtrl(): void {
    const bar = document.getElementById('move-ctrl')!;
    const m = movePlan;
    if (!m) {
      bar.hidden = true;
      document.getElementById('pg-move')?.remove();
      return;
    }
    bar.hidden = false;
    const info = document.getElementById('move-info')!;
    const confirm = document.getElementById('move-confirm') as HTMLButtonElement;
    // The live budget, always shown, committed and previewed distinguished:
    // a player mid-route wants to know what this next click would cost before
    // paying for it.
    const n = Math.max(0, m.path.length - 1);
    const p = m.preview ? Math.max(0, m.preview.length - 1) : n;
    info.textContent = p !== n
      ? `${n} → ${p} of ${m.steps} grids`
      : n
        ? `${n} of ${m.steps} grids`
        : `Click a lit grid to move (up to ${m.steps})`;
    confirm.disabled = n === 0;
    const back = document.getElementById('move-back') as HTMLButtonElement | null;
    if (back) back.disabled = m.marks.length < 2;
    renderGuideMove(m.label, n, m.steps, m.marks.length > 1);
  }

  // The shared reading, not a local copy of it: Mobility Stance doubles a Mech's
  // Maneuver Value and only a Mech's, and this used to double a Drone's too.
  function moveRangeFor(t: Token): number {
    return maneuverRange(data, t);
  }

  // Whether this move is a Flying Movement. Returns null if the player backed
  // out, which cancels the move rather than guessing for them.
  //
  // Three sources, and only the middle one is a question:
  //   the unit's printed base (the eight square-based flyers) - always,
  //   an Ojs200 lending the Mech optional flight on its MANEUVER - ask,
  //   a matched pair of Fairy arms - always, and on every move.
  // Flying cannot Crush (FAQ E14) and ignores Melee Lock, so the choice is a
  // real trade and the prompt says so rather than just offering two verbs.
  async function flyingChoice(t: Token, isManeuver: boolean, forced = false): Promise<boolean | null> {
    // An Airborne Movement Action is Flying by its own keyword, with no choice
    // in it, so it never reaches the question below.
    if (forced) return true;
    if (data.byId.get(t.cardId)?.moveAsFlight) return true;
    const grant = flightGrant(data, t, loanedParts(data, state.tokens, t));
    if (grant === 'always') return true;
    if (grant !== 'maneuver' || !isManeuver) return false;
    const locked = lockersOf(data, t, state.tokens, currentTerrain());
    const gains = [
      ...(locked.length ? [`ignore the Melee Lock from ${locked.map((o) => o.label).join(', ')}`] : []),
      'cross terrain and units freely',
    ];
    const pick = await choiceDialog({
      title: 'Fly this Maneuver?',
      body: `${t.label} may treat its Maneuver as Flying Movement. Flying lets it ${gains.join(' and ')} — but a Flying Movement can never Crush (FAQ E14).`,
      stacked: true,
      choices: [
        { id: 'fly', label: 'Fly it', note: 'Flying Movement — cannot Crush' },
        { id: 'walk', label: 'Move normally', note: 'May Crush, pays Melee Lock' },
        { id: 'cancel', label: 'Cancel', cancel: true },
      ],
    });
    if (!pick || pick === 'cancel') return null;
    return pick === 'fly';
  }

  // ZHDR-304 Harpy: the offer itself is shared with the Match Centre in
  // commandpick.ts — the -2, the phase gate and the whose-token rules call all
  // live there so the two pages cannot drift apart.
  function offerHarpyDrag(t: Token, steps: number): Promise<{ allyUid: number; funderUid: number } | null | 'cancelled'> {
    return sharedHarpyDrag(data, state, t, steps);
  }

  async function startMove(uid: number, opts: { range?: number; label: string; maneuver?: boolean; airborne?: boolean }, done: (moved: boolean) => void): Promise<void> {
    const t = state.tokens.find((x) => x.uid === uid);
    if (!t) return done(false);
    const steps = opts.range ?? moveRangeFor(t);
    if (steps <= 0) {
      void alertDialog({
        title: 'This unit cannot move',
        body: `${t.label} has no Movement Range on its card, so there is nothing to move with.`,
      });
      return done(false);
    }
    const chosen = await flyingChoice(t, !!opts.maneuver, !!opts.airborne);
    if (chosen === null) return done(false);
    const flying = chosen;
    // The Harpy's drag is offered here rather than after the move: its -2 comes
    // out of the Movement allowance, so it has to be decided before the route
    // is drawn or the player would be shown a reach they cannot have.
    const drag = await offerHarpyDrag(t, steps);
    if (drag === 'cancelled') return done(false);
    movePlan = {
      uid,
      side: t.side,
      steps: drag ? steps - 2 : steps,
      drag: drag ?? undefined,
      flying,
      path: [{ c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }],
      marks: [1],
      preview: null,
      label: opts.label,
      done,
    };
    selectToken(uid);
    board.showReachable(reachableGrids(t, steps, currentTerrain(), state.tokens, flying, moveOpts(t, flying)), steps);
    board.panEnabled = false;
    renderMoveCtrl();
    const locked = flying || t.aerial ? [] : lockersOf(data, t, state.tokens, currentTerrain());
    const breakAway = locked.length
      ? ` Melee Locked by ${locked.map((o) => o.label).join(', ')}, so leaving a Grid costs ${locked.length} extra Movement Range (4.3.5).`
      : '';
    setHint(`${opts.label} for ${t.label}: click a lit grid to move there. Click again further on to add a waypoint, Backspace steps back, then Confirm. Esc cancels.${breakAway}`);
  }


  function commitMove(): void {
    const m = movePlan;
    if (!m) return;
    const t = state.tokens.find((x) => x.uid === m.uid);
    if (!t) return;
    const path = m.path;
    if (path.length < 2) return;
    // Each stop takes the free part of its Grid rather than the middle, so a unit
    // crossing a Grid that holds a low wall walks past it instead of onto it.
    const terrain = currentTerrain();
    const stops: { col: number; row: number }[] = [];
    let from = { col: t.col, row: t.row };
    for (const g of path) {
      const spot =
        standingSpot(g.c, g.r, t.size, m.flying || t.aerial, terrain, state.tokens, t.uid, from) ??
        snapPlacement(g.c * 3 + 1, g.r * 3 + 1, t.size);
      if (!spot) continue;
      stops.push(spot);
      from = spot;
    }
    const last = stops[stops.length - 1];
    if (!last) return;
    const goal = path[path.length - 1];
    const victims = crushTargets(t, goal.c, goal.r, terrain, state.tokens);
    movePlan = null;
    board.panEnabled = true;
    board.clearHighlights();
    board.clearMovePath();
    renderMoveCtrl();
    const startPos = { ...t };
    const settle = (col: number, row: number) => {
      t.col = col;
      t.row = row;
      logTo(t, `${t.label} moves ${path.length - 1} grid${path.length - 1 === 1 ? '' : 's'}.`);
      // The Harpy's dragged Ally comes with it — towed BEHIND, into the Grid
      // the Harpy just vacated, with the final Grid as the fallback. The
      // penultimate Grid has to be tried first because a Large Mech fills a
      // whole 3x3 Grid: a spot in the Grid the Harpy itself ended in can never
      // fit one, and "drag 1 adjacent Ally Mech" would be printed on a card
      // that could not drag a Mech. forceMove is the same command Knockback
      // uses, so the placement is terrain- and occupancy-aware and it travels.
      if (m.drag) {
        const ally = state.tokens.find((x) => x.uid === m.drag!.allyUid);
        const goalGrid = path[path.length - 1];
        const prevGrid = path[path.length - 2];
        const spot = ally
          ? (prevGrid
            ? standingSpot(prevGrid.c, prevGrid.r, ally.size, ally.aerial, currentTerrain(), state.tokens, ally.uid)
            : null)
            ?? standingSpot(goalGrid.c, goalGrid.r, ally.size, ally.aerial, currentTerrain(), state.tokens, ally.uid)
          : null;
        if (ally && spot) {
          perform(data, state, { kind: 'spendCommand', seat: t.side, uid: m.drag.funderUid });
          perform(data, state, { kind: 'forceMove', seat: t.side, uid: t.uid, targetUid: ally.uid, to: spot });
          logTo(ally, `${t.label} drags ${ally.label} along (-2 Movement, 1 Command Token consumed).`);
        } else if (ally) {
          logTo(t, `${ally.label} could not be dragged: nothing free to stand in. The Command Token was not consumed.`);
        }
      }
      onChanged();
      setHint('');
      // Movement is a non-Silence action unless a surviving Part grants
      // Silence to it (PL29 Stealth Chassis; FAQ I2/I5), so a camouflaged
      // mover Reveals here. The Contact sweep handles the other half.
      if (statusCount(t.statuses, 'camouflage') > 0 && !maneuverIsSilent(data, t)) {
        promptReveal(t, `${t.label} moved without Silence.`);
      }
      // An enemy AERIAL unit's Movement triggers Interception, judged at the
      // start and landing grids only (FAQ O11/O15, 4.9).
      if (t.aerial) {
        const owed = interceptsOwed(data, state.tokens, state.smoke ?? [], startPos, [t]);
        if (owed.length) {
          perform(data, state, { kind: 'queueIntercepts', seat: t.side, items: owed });
          logTo(t, `Aerial Movement triggers Interception: ${owed.length} attempt${owed.length === 1 ? '' : 's'} owed (4.9).`);
        }
      }
      // Mines first: M7's sequence Lays on the way through and only then enters
      // the last Grid, so a Mine dropped here is already down when the sweep
      // looks at the board.
      void offerMines(t, path, m.steps, m.flying)
        .then(() => offerBlackBoxes(t, path))
        .then(() => m.done(true));
    };
    if (victims) {
      // The Grid is entered only once whatever was standing there is dealt with,
      // and the Movement Action ends there regardless of Range left (4.3.6).
      board.animateMove(m.uid, stops.slice(0, -1), () =>
        resolveCrush(t, goal, victims, () => {
          const spot = standingSpot(goal.c, goal.r, t.size, t.aerial, currentTerrain(), state.tokens, t.uid)
            ?? snapPlacement(goal.c * 3 + 1, goal.r * 3 + 1, t.size);
          board.animateMove(m.uid, spot ? [spot] : [], () => settle(spot?.col ?? last.col, spot?.row ?? last.row));
        }));
      return;
    }
    board.animateMove(m.uid, stops, () => settle(last.col, last.row));
  }

  // Resupply (4.13). Ammo only comes back to a Part that has actually spent some,
  // and never above the number it started with.
  async function performResupply(t: Token, action: CardAction, rule: Resupply, done: (ok: boolean) => void): Promise<void> {
    const what = action.name.en || action.name.zh || action.id;
    const from = largeGridOf(t);
    const holders = state.tokens.filter((o) => {
      if (o.deployed === false) return false;
      if (o.uid !== t.uid && (!rule.allies || o.side !== t.side)) return false;
      const g = largeGridOf(o);
      if (Math.abs(g.c - from.c) + Math.abs(g.r - from.r) > rule.range) return false;
      const max = tokenCards(data, o).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === rule.actionId)?.storage;
      if (!max) return false;
      return (o.ammo[rule.actionId] ?? max) < max;
    });
    if (!holders.length) {
      await alertDialog({
        title: 'Nothing to resupply',
        body: `${what} restores Ammo to a Part carrying that Action, and nothing in reach has spent any. Ammo can only be replenished for a Part that has consumed some, and never past what it started with (4.13).`,
      });
      return done(false);
    }
    let unit: Token | undefined = holders[0];
    if (holders.length > 1) {
      const id = await choiceDialog({
        title: `${what}: resupply which unit?`,
        body: rule.range ? 'This Mech, or an Ally Unit within reach, that has spent the Ammo this Action restores.' : 'Only this Mech is in reach.',
        choices: holders.map((o) => ({ id: String(o.uid), label: `${o.label}${o.uid === t.uid ? ' (this Mech)' : ''}` })),
      });
      unit = holders.find((o) => String(o.uid) === id);
    }
    if (!unit) return done(false);
    const max = tokenCards(data, unit).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === rule.actionId)?.storage ?? 0;
    perform(data, state, { kind: 'restoreAmmo', seat: unit.side, uid: unit.uid, actionId: rule.actionId, amount: rule.amount });
    logTo(unit, `${what} from ${t.label}: Ammo restored to ${unit.ammo[rule.actionId]}/${max}.`);
    onChanged();
    done(true);
  }

  // Prototype Blink (FAQ E17/E20): swap places with a Ground Mech of the same
  // size in range, then set BOTH facings, because it counts as Forced Movement
  // and the Taurus player decides them. No roll, no route, no Break Away.
  async function performBlink(t: Token, action: CardAction, done: (ok: boolean) => void): Promise<void> {
    const what = action.name.en || action.name.zh || action.id;
    const targets = blinkTargets(data, state.tokens, t, action);
    if (!targets.length) {
      await alertDialog({
        title: 'Nothing to exchange with',
        body: `${what} takes one GROUND MECH of the same size as ${t.label}, within Range ${action.range ?? 0} — enemy or allied. Drones, Terrain and anything a different size cannot be chosen (FAQ E20).`,
      });
      return done(false);
    }
    // The Cancel is marked, so Escape and a backdrop click land on it rather
    // than on a target. Unmarked, they now resolve null and this returns
    // done(false) anyway - the marker is what makes the button they hit the
    // one the player can see.
    const pickId = targets.length === 1 ? String(targets[0].uid) : await choiceDialog({
      title: `${what}: exchange with which Mech?`,
      body: 'A Ground Mech of the same size within range, on either side. This is Teleportation, so terrain and distance in between do not matter (FAQ E20).',
      choices: [
        ...targets.map((o) => ({
          id: String(o.uid),
          label: `${o.label}${o.side === t.side ? ' (ally)' : ''} — ${gridRef(Math.floor(o.col / 3), Math.floor(o.row / 3))}`,
        })),
        { id: '', label: 'Cancel', cancel: true },
      ],
    });
    const target = targets.find((o) => String(o.uid) === pickId);
    if (!target) return done(false);
    // Forced Movement, so the Taurus player sets both facings (E17/E20.5).
    const askFacing = async (who: Token, label: string): Promise<Facing | null> => {
      const id = await choiceDialog({
        title: `Which way does ${label} face?`,
        body: 'Prototype Blink is Forced Movement, so you choose the facing of BOTH units (FAQ E17).',
        choices: [
          { id: '0', label: 'North' }, { id: '1', label: 'East' },
          { id: '2', label: 'South' }, { id: '3', label: 'West' },
          { id: String(who.facing), label: 'Leave it as it was' },
          { id: '', label: 'Cancel', cancel: true },
        ],
      });
      return id === null || id === '' ? null : (Number(id) as Facing);
    };
    const mine = await askFacing(t, t.label);
    if (mine === null) return done(false);
    const theirs = await askFacing(target, target.label);
    if (theirs === null) return done(false);
    const v = perform(data, state, {
      kind: 'blink', seat: t.side, uid: t.uid, actionId: action.id,
      targetUid: target.uid, facing: mine, targetFacing: theirs,
    });
    if (!v.ok) return done(false);
    logTo(t, `${what}: exchanged positions with ${target.label}.`);
    onChanged();
    done(true);
  }

  // Auto Mine Laying (FAQ M7/M29). Offered after the route rather than before,
  // because the price is the Move Range the Mech did NOT spend: walk 2 of your 4
  // Grids and there are 2 points left to drop 2 Mines with. Laying is a Passive,
  // so no Tick and no Ammo change hands - the shorter walk IS the cost.
  async function offerMines(t: Token, path: { c: number; r: number }[], steps: number, flying: boolean): Promise<void> {
    const spare = steps - pathCost(path, flying || t.aerial, moveOpts(t, flying));
    const lay = minesLayable(data, t, path, spare, flying || !!t.aerial);
    if (!lay) return;
    const mine = data.byId.get(lay.cardId);
    const what = mine ? cardName(mine) : 'a Mine';
    for (let n = 0; n < lay.max; n++) {
      const left = lay.max - n;
      const go = await confirmDialog({
        title: n === 0 ? `Lay ${what} along the route?` : `Lay another ${what}?`,
        body: `${t.label} kept ${left} point${left === 1 ? '' : 's'} of Move Range back, and each one Lays 1 ${what} anywhere on the route it walked (FAQ M7).`
          + (flying || t.aerial
            ? ' This was a Flight Move, so the only Grids on its path are the one it started in and the one it landed in (FAQ M29).'
            : '')
          + ' Laying costs no Action Tick and no Ammo.',
        confirmLabel: 'Lay one',
        cancelLabel: n === 0 ? 'Lay none' : 'That is enough',
      });
      if (!go) return;
      const where = await choiceDialog({
        title: `Where does the ${what} go?`,
        body: 'Any Grid on the route just walked.',
        choices: lay.grids.map((g) => ({ id: `${g.c},${g.r}`, label: gridRef(g.c, g.r) })),
      });
      if (!where) return;
      const [c, r] = where.split(',').map(Number);
      // Through the command layer so a mirrored seat mints the same uid, which
      // is also what lets minesOwed tell a Mine that just arrived from one that
      // was already there (M6).
      if (!perform(data, state, {
        kind: 'layMine', seat: t.side, uid: t.uid, actionId: lay.actionId, cardId: lay.cardId, to: { col: c * 3 + 1, row: r * 3 + 1 },
      }).ok) return;
      logTo(t, `Laid ${what} in ${gridRef(c, r)}, paid for with 1 Move Range.`);
      onChanged();
    }
  }

  async function offerBlackBoxes(t: Token, path: { c: number; r: number }[]): Promise<void> {
    const loose = normaliseTasks(state.tasks).items
      .filter((i) => i.kind === 'blackbox' && i.bearerUid === undefined
        && i.col !== undefined && i.row !== undefined
        && path.some((g) => g.c === Math.floor(i.col! / 3) && g.r === Math.floor(i.row! / 3)))
      .map((i) => ({ id: i.id, where: gridRef(Math.floor(i.col! / 3), Math.floor(i.row! / 3)) }));
    if (!loose.length) return;
    for (const box of loose) {
      // Re-read every time round: taking one replaces state.tasks wholesale, so
      // a snapshot from before the loop would offer the same Freehand twice.
      const tasks = normaliseTasks(state.tasks);
      const taken = tasks.items.filter((i) => i.bearerUid === t.uid && i.bearerSlot).map((i) => i.bearerSlot!);
      const hands = freehandSlots(data, t, taken);
      const where = box.where;
      if (!hands.length) {
        await alertDialog({
          title: 'No free Freehand',
          body: `${t.label} passed the Black Box in ${where}, but a Unit needs a Part with the Freehand tag that is not already carrying one. A Part bearing a Black Box has its Freehand treated as invalid (5.3.1).`,
        });
        continue;
      }
      const take = await confirmDialog({
        title: `Pick up the Black Box in ${where}?`,
        body: `Picking one up is optional. It goes onto one of this unit's Freehand Parts, and that Part cannot take another while it holds this one.`,
        confirmLabel: 'Pick it up',
        cancelLabel: 'Leave it',
      });
      if (!take) continue;
      let slot = hands[0].slot as string;
      if (hands.length > 1) {
        const id = await choiceDialog({
          title: 'Which Part carries it?',
          body: 'Any Freehand Part that is not already holding a Black Box.',
          choices: hands.map((h) => ({ id: String(h.slot), label: h.label })),
        });
        if (!id) continue;
        slot = id;
      }
      // Through the command layer rather than by hand: the same rule then reads
      // the same on a networked table, and check() is the only place it lives.
      if (!perform(data, state, { kind: 'takeBlackBox', seat: t.side, uid: t.uid, itemId: box.id, slot }).ok) continue;
      logTo(t, `Picked up the Black Box from ${where}, carried on the ${SLOT_LABEL[slot as PartSlot | 'main']}.`);
    }
    onChanged();
  }

  // When a Unit bearing a Black Box is Penetrated, the Box goes on the board and
  // the ATTACKER says where, in contact with the bearer's base (5.3.1).
  function dropBlackBoxes(victim: Token, attacker: Token): void {
    const held = normaliseTasks(state.tasks).items.filter((i) => i.kind === 'blackbox' && i.bearerUid === victim.uid);
    if (!held.length) return;
    const g = largeGridOf(victim);
    const spots: { c: number; r: number; ok: boolean }[] = [];
    for (const [dc, dr] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const) {
      const c = g.c + dc;
      const r = g.r + dr;
      if (c < 0 || r < 0 || c >= LG || r >= LG) continue;
      // Ground level only (FAQ P9): a Box cannot land on a building. Units do
      // not block it — a Box may overlap one (P8) — so terrain is the test.
      if (!canStandIn(c, r, 1, false, currentTerrain(), [], undefined)) continue;
      spots.push({ c, r, ok: true });
    }
    const box = held[0];
    setHint(`${victim.label} was Penetrated and drops a Black Box. As the attacker, click a Grid in contact with it to say where the Box lands (5.3.1).`);
    board.showSmokeTargets(spots, (c, r) => {
      // The attacker's seat, because the attacker is the one choosing.
      perform(data, state, {
        kind: 'dropBlackBox', seat: attacker.side, uid: attacker.uid,
        itemId: box.id, to: { col: c * 3 + 1, row: r * 3 + 1 },
      });
      board.clearHighlights();
      logTo(victim, `Penetrated while carrying a Black Box, which drops in ${gridRef(c, r)}.`);
      setHint('');
      onChanged();
      // More than one Box can be carried, so keep going until they are all down.
      dropBlackBoxes(victim, attacker);
    });
  }

  // Remote Access (5.3.3): an Electronic Counter-roll against a Terminal within
  // Range 4. A Terminal is only worth accessing once a round, so one already
  // taken is not offered again.
  async function performRemoteAccess(t: Token, action: CardAction, done: (ok: boolean) => void): Promise<void> {
    const tasks = normaliseTasks(state.tasks);
    const from = largeGridOf(t);
    const reach = action.range ?? 4;
    const open = tasks.items.filter((i) => {
      if (i.kind !== 'terminal' || i.accessed) return false;
      const centre = zoneCentre(i.zone);
      return !!centre && Math.abs(centre.c - from.c) + Math.abs(centre.r - from.r) <= reach;
    });
    if (!open.length) {
      await alertDialog({
        title: 'No Terminal in reach',
        body: `Remote Access needs a Terminal within Range ${reach} that has not already been accessed this round. Each Terminal may only be accessed once per round (5.3.3).`,
      });
      return done(false);
    }
    const zoneName = (id: string) => data.zoneData.zones.find((z) => z.id === id)?.name ?? id;
    let pick = open[0];
    if (open.length > 1) {
      const id = await choiceDialog({
        title: 'Remote Access: which Terminal?',
        body: `Each is an Electronic Counter-roll against the Terminal, whose Electronic Value is 3.`,
        choices: open.map((i) => ({ id: i.id, label: zoneName(i.zone) })),
      });
      const found = open.find((i) => i.id === id);
      if (!found) return done(false);
      pick = found;
    }
    const won = await confirmDialog({
      title: `Remote Access on ${zoneName(pick.zone)}`,
      body: `Make the Electronic Counter-roll now, against the Terminal's Electronic Value of 3. Did it succeed?`,
      confirmLabel: 'It succeeded',
      cancelLabel: 'It failed',
    });
    if (!won) {
      logTo(t, `Remote Access on the ${zoneName(pick.zone)} Terminal failed.`);
      onChanged();
      return done(true);
    }
    // Through the command: a Terminal turned face-down is worth VP at the End
    // Phase, so setting `accessed` in place scored a different board on the
    // other client.
    if (!perform(data, state, { kind: 'accessTerminal', seat: t.side, uid: t.uid, itemId: pick.id }).ok) return done(false);
    logTo(t, `Remote Access succeeded on the ${zoneName(pick.zone)} Terminal, which is now face-down for the rest of the round.`);
    onChanged();
    done(true);
  }

  // Charge (4.14). The token starts face-down; the Charge Action flips one Part's
  // token face-up, and an Action whose text is conditional on [Charged] may flip
  // it back down to apply that effect.
  //
  // Through the command, never by hand. This used to mutate `t.charge` directly,
  // which is the shape that has now bitten four times (Black Boxes, Task
  // designations, the Tactics hand, this): the flip is a SHARED fact - it is in
  // the board fingerprint and check() reads it to refuse a second Charge - so a
  // local mutation left an online game disagreeing about what was Charged.
  function setCharge(t: Token, slot: string, on: boolean): void {
    perform(data, state, { kind: 'setCharge', seat: t.side, uid: t.uid, slot, on });
  }

  async function performCharge(t: Token, action: CardAction, done: (ok: boolean) => void): Promise<void> {
    const slots = chargeableSlots(data, t);
    const open = slots.filter((s) => !s.charged);
    const what = action.name.en || action.name.zh || action.id;
    if (!slots.length) {
      await alertDialog({
        title: 'Nothing to Charge',
        body: `${t.label} has no Part with a Chargeable Action, so ${what} has nothing to put a Charge Token on (4.14).`,
      });
      return done(false);
    }
    if (!open.length) {
      await alertDialog({
        title: 'Already Charged',
        body: `Every Chargeable Part on ${t.label} already holds a face-up Charge Token. An Action that is Charged cannot be Charged again until the token is spent (4.14).`,
      });
      return done(false);
    }
    let slot = open[0].slot as string;
    if (open.length > 1) {
      const id = await choiceDialog({
        title: `${what}: which Part?`,
        body: 'Only one Part may be Charged per Charge Action, and it has to be one whose token is still face-down.',
        choices: open.map((o) => ({ id: String(o.slot), label: o.label })),
      });
      if (!id) return done(false);
      slot = id;
    }
    setCharge(t, slot, true);
    logTo(t, `Charged ${SLOT_LABEL[slot as PartSlot | 'main']}: its Charge Token is now face-up.`);
    onChanged();
    done(true);
  }

  // Offered when a [Charged] Action is performed while its Part holds a face-up
  // token. Consuming it is the player's choice, so this asks rather than assumes.
  async function offerChargeSpend(t: Token, actionId: string): Promise<void> {
    const found = guidedActions(data, t, { tokens: state.tokens, terrain: currentTerrain() })
      .find((g) => g.action.id === actionId);
    if (!found?.charge?.charged) return;
    const what = found.action.name.en || found.action.name.zh || found.action.id;
    const spend = await confirmDialog({
      title: `Consume the Charge on ${what}?`,
      body: `${SLOT_LABEL[found.slot]} holds a face-up Charge Token. Flipping it back down now applies the effect this Action marks as [Charged]. You may also keep it for a later use.`,
      confirmLabel: 'Consume it',
      cancelLabel: 'Keep it',
    });
    if (!spend) return;
    setCharge(t, found.slot, false);
    logTo(t, `Consumed the Charge on ${SLOT_LABEL[found.slot]} for ${what}.`);
    onChanged();
  }

  // A shove is a Knockback with no Attack behind it, so it needs a victim first.
  // The card wants an enemy Ground Unit in the Grid the Mech is facing, which is
  // the only place the shove can go.
  async function offerShove(t: Token, action: CardAction): Promise<void> {
    const g = largeGridOf(t);
    const fv = [[0, -1], [1, 0], [0, 1], [-1, 0]][t.facing] as [number, number];
    const ahead = { c: g.c + fv[0], r: g.r + fv[1] };
    const what = action.name.en || action.name.zh || action.id;
    const victims = state.tokens.filter((o) => {
      if (o.side === t.side || o.uid === t.uid || o.aerial || o.deployed === false) return false;
      const og = largeGridOf(o);
      return og.c === ahead.c && og.r === ahead.r;
    });
    if (!victims.length) {
      setHint(`${what}: no enemy Ground Unit in ${gridRef(ahead.c, ahead.r)}, the Grid in front, so there is nothing to shove.`);
      return;
    }
    let pick: Token | undefined = victims[0];
    if (victims.length > 1) {
      const id = await choiceDialog({
        title: `${what}: shove which unit?`,
        body: `More than one enemy is in ${gridRef(ahead.c, ahead.r)}.`,
        choices: victims.map((v) => ({ id: String(v.uid), label: v.label })),
      });
      pick = victims.find((v) => String(v.uid) === id);
    }
    if (!pick) return;
    await resolveKnockback(t, pick, action, 1);
  }

  // SH-15 Damage Control (FAQ D7/J21/J23): a destroyed Part of this mech takes
  // a Repaired Token - its Actions come back, everything else still reads it
  // as destroyed - or a Damaged Part is mended back to intact.
  async function performRepair(
    t: Token,
    action: CardAction,
    rep: { repair: boolean; mend: boolean },
    done: (performed: boolean) => void,
  ): Promise<void> {
    const parts = tokenCards(data, t).filter(({ slot }) => slot !== 'pilot');
    const choices: { id: string; label: string }[] = [];
    for (const { slot, card } of parts) {
      const st = t.partStates[slot as PartSlot | 'main'] ?? 'intact';
      if (rep.repair && st === 'destroyed' && !(t.repairedSlots ?? []).includes(slot)) {
        choices.push({ id: `repaired:${slot}`, label: `Repair ${SLOT_LABEL[slot]} (${cardName(card)}) - its Actions return` });
      }
      if (rep.mend && st === 'damaged') {
        choices.push({ id: `mend:${slot}`, label: `Mend ${SLOT_LABEL[slot]} (${cardName(card)}) - Damaged becomes intact` });
      }
    }
    if (!choices.length) {
      await alertDialog({
        title: 'Nothing to repair',
        body: `${action.name.en || action.id}: no destroyed Part is missing a Repaired Token and nothing is Damaged, and an action that cannot produce any change cannot be performed.`,
      });
      return done(false);
    }
    const id = await choiceDialog({
      title: action.name.en || action.id,
      body: 'A Repaired Part can act again, but stays destroyed for Integrity, gives back no Link, and is removed outright if hit, the attack moving to the Core (FAQ J21/J23).',
      choices: [...choices, { id: '', label: 'Cancel' }],
      stacked: true,
    });
    if (!id) return done(false);
    const [mode, slot] = id.split(':');
    perform(data, state, { kind: 'repairPart', seat: t.side, uid: t.uid, slot, mode: mode as 'repaired' | 'mend' });
    logTo(t, `${action.name.en || action.id}: ${mode === 'mend' ? `${SLOT_LABEL[slot as PartSlot | 'main']} mended to intact` : `${SLOT_LABEL[slot as PartSlot | 'main']} takes a Repaired Token`}.`);
    onChanged();
    done(true);
  }

  // Knockback X and Push X (appendix). The victim is Force-Moved in a straight
  // line away from the attacker and stops early on a Unit or Terrain, so there is
  // nothing for the player to pick; the dialog only exists to show the working.
  async function resolveKnockback(attacker: Token, victim: Token, action: CardAction, hits: number): Promise<void> {
    const kb = knockbackOf(action, data.actionTranslation(action.id)?.english ?? undefined);
    if (!kb) return;
    if (!state.tokens.some((t) => t.uid === victim.uid)) return;
    const what = action.name.en || action.name.zh || action.id;
    const name = kb.push ? `Push ${kb.grids}` : `Knockback ${kb.grids}`;
    if (kb.onHit && hits === 0) {
      await alertDialog({
        title: `${name} does not trigger`,
        body: `${what} only knocks back On Hit, and this attack scored no Hits, so ${victim.label} stays where it is.`,
      });
      return;
    }
    const dir = attackDirection(attacker, victim);
    const path = knockbackPath(victim, dir, kb.grids, currentTerrain(), state.tokens);
    const heading = ['north', 'east', 'south', 'west'][dir.dr < 0 ? 0 : dir.dc > 0 ? 1 : dir.dr > 0 ? 2 : 3];
    // The player causing a Forced Movement picks the victim's facing, and a
    // victim that cannot move may still be turned — or left alone, since the
    // facing change is not mandatory when the movement fails (FAQ B4/B5).
    const askFacing = async (note: string): Promise<Facing | undefined> => {
      const id = await choiceDialog({
        title: `Turn ${victim.label}?`,
        body: `${note} As the forcing player you choose which way ${victim.label} ends up facing (3.4.4).`,
        choices: [
          ...(['North', 'East', 'South', 'West'] as const).map((label, i) => ({
            id: String(i),
            label: i === victim.facing ? `${label} (as it stands)` : label,
          })),
          { id: '', label: 'Leave its facing alone', cancel: true },
        ],
        stacked: true,
      });
      return id ? (Number(id) as Facing) : undefined;
    };
    if (!path.length) {
      const facing = await askFacing(
        `${victim.label} would be forced ${heading}, but a Unit, Terrain or the board edge is in the way, so it does not move.`,
      );
      if (facing !== undefined && facing !== victim.facing) {
        perform(data, state, { kind: 'forceMove', seat: attacker.side, uid: attacker.uid, targetUid: victim.uid, to: { col: victim.col, row: victim.row }, facing });
        logTo(victim, `${name} from ${attacker.label} was blocked, but it is turned to face ${['North', 'East', 'South', 'West'][facing]}.`);
        onChanged();
      }
      return;
    }
    const end = path[path.length - 1];
    const short = path.length < kb.grids;
    const go = await confirmDialog({
      title: `${name} on ${victim.label}`,
      body: `${what} forces ${victim.label} ${path.length} Grid${path.length === 1 ? '' : 's'} ${heading} to ${gridRef(end.c, end.r)}${
        short ? `, short of the full ${kb.grids} because something blocks the rest of the line` : ''
      }.${kb.push && victim.kind === 'mech' ? ' Push also costs it 1 Link.' : ''}`,
      confirmLabel: 'Force the move',
      cancelLabel: 'Skip',
    });
    if (!go) return;
    const spot = standingSpot(end.c, end.r, victim.size, victim.aerial, currentTerrain(), state.tokens, victim.uid, { col: victim.col, row: victim.row })
      ?? { col: victim.col, row: victim.row };
    const wasShut = victim.stance === 'shutdown';
    const facing = await askFacing(`${victim.label} is forced ${heading} to ${gridRef(end.c, end.r)}.`);
    perform(data, state, { kind: 'forceMove', seat: attacker.side, uid: attacker.uid, targetUid: victim.uid, to: { col: spot.col, row: spot.row }, push: kb.push, facing });
    logTo(victim, `${name} from ${attacker.label}: forced ${path.length} Grid${path.length === 1 ? '' : 's'} ${heading} to ${gridRef(end.c, end.r)}.`);
    if (kb.push && victim.kind === 'mech') {
      logTo(victim, `Push costs 1 Link (now ${victim.link}).`);
      if (!wasShut && victim.stance === 'shutdown') logTo(victim, `Link has reached 0, so ${victim.label} SHUTS DOWN.`);
    }
    onChanged();
  }

  // Crush resolution (4.3.6). Destructible Terrain in the way is destroyed, then
  // each smaller Unit takes Forced Movement of 1 Grid with the crushing player
  // picking where. A Unit with nowhere to go swaps places with the crusher, and
  // one that cannot be Force-Moved at all is destroyed instead.
  function resolveCrush(t: Token, goal: LargeGrid, victims: CrushVictims, done: () => void): void {
    if (victims.terrain.length) {
      perform(data, state, { kind: 'destroyTerrain', seat: t.side, uid: t.uid, pieces: victims.terrain.map((p) => p.id) });
      board.renderTerrain(currentTerrain());
      logTo(t, `Crushed ${victims.terrain.length === 1 ? 'terrain' : `${victims.terrain.length} terrain pieces`} in ${gridRef(goal.c, goal.r)}.`);
    }
    const queue = [...victims.units];
    const step = (): void => {
      const v = queue.shift();
      if (!v) {
        done();
        return;
      }
      if (!canBeForceMoved(data, v)) {
        perform(data, state, { kind: 'despawn', seat: t.side, uid: t.uid, targetUid: v.uid });
        logTo(t, `Crushed ${v.label}, which cannot be Force-Moved, so it is destroyed.`);
        board.renderTokens(state);
        step();
        return;
      }
      const from = largeGridOf(v);
      const spots = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const)
        .map(([dc, dr]) => ({ c: from.c + dc, r: from.r + dr }))
        .filter((g) => g.c >= 0 && g.r >= 0 && g.c < LG && g.r < LG)
        .filter((g) => !(g.c === goal.c && g.r === goal.r))
        .filter((g) => standingSpot(g.c, g.r, v.size, v.aerial, currentTerrain(), state.tokens, v.uid) !== null);
      if (!spots.length) {
        const swap = standingSpot(largeGridOf(t).c, largeGridOf(t).r, v.size, v.aerial, currentTerrain(), state.tokens, v.uid);
        if (swap) {
          perform(data, state, { kind: 'forceMove', seat: t.side, uid: t.uid, targetUid: v.uid, to: { col: swap.col, row: swap.row } });
          logTo(t, `Crushed ${v.label}, which had nowhere to go, so the two swap positions.`);
        }
        board.renderTokens(state);
        step();
        return;
      }
      setHint(`Crush: click a Grid to Force-Move ${v.label} 1 Grid. You choose, because you caused it (4.3.4).`);
      board.showSmokeTargets(spots.map((g) => ({ ...g, ok: true })), (c, r) => {
        const spot = standingSpot(c, r, v.size, v.aerial, currentTerrain(), state.tokens, v.uid);
        if (!spot) return;
        board.clearHighlights();
        // The crushing player also decides the victim's facing (3.4.4, FAQ L6),
        // same as any other Forced Movement.
        void (async () => {
          const id = await choiceDialog({
            title: `Turn ${v.label}?`,
            body: `As the crushing player you choose which way ${v.label} ends up facing (3.4.4).`,
            choices: [
              ...(['North', 'East', 'South', 'West'] as const).map((label, i) => ({
                id: String(i),
                label: i === v.facing ? `${label} (as it stands)` : label,
              })),
              { id: '', label: 'Leave its facing alone', cancel: true },
            ],
            stacked: true,
          });
          const facing = id ? (Number(id) as Facing) : undefined;
          perform(data, state, { kind: 'forceMove', seat: t.side, uid: t.uid, targetUid: v.uid, to: { col: spot.col, row: spot.row }, facing });
          logTo(t, `Crushed ${v.label}, Force-Moved to ${gridRef(c, r)}.`);
          board.renderTokens(state);
          step();
        })();
      });
    };
    step();
  }

  function cancelMove(): void {
    const m = movePlan;
    if (!m) return;
    movePlan = null;
    board.panEnabled = true;
    board.clearHighlights();
    board.clearMovePath();
    renderMoveCtrl();
    setHint('');
    m.done(false);
  }

  // The strict tracker refuses illegal commands inside perform; the reason
  // lands in the hint bar rather than a modal, because a refusal should never
  // interrupt more than the click that caused it.
  onRefused((why) => setHint(`⛔ ${why}`));

  // The keyboard help is static markup in #hint-keys now, so an empty hint means
  // "show the keys" rather than "write the keys out again": the CSS swaps the two
  // on data-guide, and writing the old fallback here would print both.
  function setHint(text: string): void {
    const el = document.getElementById('hint');
    if (!el) return;
    if (text) el.dataset.guide = '1';
    else delete el.dataset.guide;
    el.textContent = text;
  }

  // ---------- smoke screens (rulebook 4.16) ----------

  let smokePlacing: {
    side: Side;
    left: number;
    connected: boolean;
    placed: SmokeScreen[];
    origin: { c: number; r: number } | null;
    range: { c: number; r: number; max: number } | null;
    label: string;
    done: () => void;
  } | null = null;

  function smokeCandidates(): { c: number; r: number; ok: boolean }[] {
    const m = smokePlacing!;
    const out: { c: number; r: number; ok: boolean }[] = [];
    const mine = (state.smoke ?? []).filter((s) => s.side === m.side);
    for (let c = 0; c < LG; c++) {
      for (let r = 0; r < LG; r++) {
        if (m.range && Math.abs(c - m.range.c) + Math.abs(r - m.range.r) > m.range.max) continue;
        // The same player may not stack two screens in one Grid; the enemy may.
        if (mine.some((s) => s.col === c && s.row === r)) continue;
        if (m.placed.length === 0) {
          if (m.origin && (c !== m.origin.c || r !== m.origin.r)) continue;
          out.push({ c, r, ok: true });
          continue;
        }
        if (m.connected && !m.placed.some((s) => Math.abs(s.col - c) + Math.abs(s.row - r) === 1)) continue;
        out.push({ c, r, ok: true });
      }
    }
    return out;
  }

  function renderSmokeStep(): void {
    const m = smokePlacing;
    if (!m) return;
    const body = document.getElementById('combat-body')!;
    const cands = smokeCandidates();
    body.innerHTML = `<div class="attack-helper">
      <div class="ah-head"><b>Place Smoke Screens</b>
        <span class="dim">${escapeHtml(m.label)} · ${m.left} left</span></div>
      <p class="ah-los">${
        m.placed.length === 0 && m.origin
          ? 'The first screen goes on the landing point.'
          : m.connected
            ? 'Each screen must be in Contact with one already placed by this Action, so pick a Grid sharing an edge with the smoke.'
            : 'Pick any Grid within range. This Action does not require the screens to be Connected.'
      } A Smoke Screen sits in one Large Grid and may share it with units and terrain.</p>
      <div class="ah-step"><h4>Click a highlighted Grid on the board</h4>
        <p class="dim">${cands.length} legal ${cands.length === 1 ? 'Grid' : 'Grids'}. You may stop early: the card says <i>up to</i> ${m.left + m.placed.length} screens.</p>
      </div></div>`;
    const head = body.querySelector('.ah-head')!;
    const cancel = document.createElement('button');
    cancel.className = 'ah-cancel';
    cancel.textContent = m.placed.length ? 'Stop here' : 'Cancel';
    cancel.addEventListener('click', () => finishSmoke());
    head.appendChild(cancel);
    board.showSmokeTargets(cands, (c, r) => {
      // `for` carries the owner past the networked seat stamp: a defender's
      // Emergency Smoke is placed from the attacking side of the table.
      perform(data, state, { kind: 'placeSmoke', seat: m.side, for: m.side, at: { col: c, row: r } });
      m.placed.push(state.smoke![state.smoke!.length - 1]);
      m.left--;
      onChanged();
      if (m.left <= 0) finishSmoke();
      else renderSmokeStep();
    });
    showSideTab('combat');
  }

  function finishSmoke(): void {
    const m = smokePlacing;
    smokePlacing = null;
    board.clearHighlights();
    if (m) m.done();
    onChanged();
  }

  function startSmokePlacement(o: {
    side: Side;
    count: number;
    connected: boolean;
    origin?: { c: number; r: number };
    range?: { c: number; r: number; max: number };
    label: string;
    done: () => void;
  }): void {
    smokePlacing = {
      side: o.side,
      left: o.count,
      connected: o.connected,
      placed: [],
      origin: o.origin ?? null,
      range: o.range ?? null,
      label: o.label,
      done: o.done,
    };
    renderSmokeStep();
  }

  // Reactions a defender is owed, held in SHARED state rather than a local
  // array: a Multi-Target can shoot two units carrying Emergency Smoke, FAQ B7
  // makes both wait for the end of the whole Action, and in a networked game
  // the debt has to reach the defender's own client — only they may place the
  // Screens and spend the use. Same queue and same two commands as the Match
  // Centre, so neither page owns the rule.
  function renderReactionPrompt(): void {
    if (smokePlacing) return;
    // In an online freeplay room only the DEFENDER's client may answer — the
    // other seat's resolveReaction would apply locally and never travel. A
    // local table has no seat, so both sides prompt as before.
    const seat = getLocalSeat();
    const owed = (normaliseScript(state.script, state.round.firstPlayer).reactions ?? [])
      .map((r) => ({ r, t: state.tokens.find((x) => x.uid === r.uid) }))
      .find((x) => !!x.t && (!seat || x.t.side === seat));
    if (!owed?.t) return;
    const { r, t: defender } = owed;
    const card = data.byId.get(defender.cardId ?? '');
    const act = (card?.actions ?? []).find((a) => a.id === r.actionId);
    const name = act?.name?.en || act?.name?.zh || 'Emergency Smoke';
    // Defense Reaction (ZHLA-101 / ZHLA-301). Nothing to place and nothing to
    // spend, so the whole reaction is the one question.
    if (r.kind === 'stance') {
      void confirmDialog({
        title: `${defender.label}: ${name}`,
        body: `A Part of ${defender.label} was Penetrated, so it may change to Defensive Stance immediately. It is in ${defender.stance} Stance now. This is the one Stance change 4.1 allows outside the start of an Action Opportunity, and it costs nothing.`,
        confirmLabel: 'Change to Defensive',
        cancelLabel: `Stay in ${defender.stance}`,
      }).then((go) => {
        perform(data, state, { kind: 'resolveReaction', seat: defender.side, uid: defender.uid, actionId: r.actionId });
        if (go) perform(data, state, { kind: 'defenseReaction', seat: defender.side, uid: defender.uid });
        onChanged();
        renderReactionPrompt();
      });
      return;
    }
    // Target Tracing (174) answers with a Counter-roll rather than Screens. On
    // one screen the ElectronicHelper runs it, so there is no owed queue to
    // drain -- the debt is cleared here and the helper takes over.
    if (r.kind === 'trace') {
      const from = state.tokens.find((x) => x.uid === r.fromUid);
      const ev = electronicValue(data, defender, loanedParts(data, state.tokens, defender));
      void confirmDialog({
        title: `${defender.label}: ${name}`,
        body: `${defender.label} was attacked by ${from?.label ?? 'the attacker'}, so it may spend 1 Command Token to open an Electronic Counter-roll back at them. If it succeeds they lose 1 Link. Electronic Value ${ev}; Range does not apply, because this answers the attack wherever it came from.`,
        confirmLabel: from && ev > 0 ? 'Spend a Command Token and roll' : 'Roll',
        cancelLabel: 'Skip it',
      }).then((go) => {
        perform(data, state, { kind: 'resolveReaction', seat: defender.side, uid: defender.uid, actionId: r.actionId });
        if (!go || !from || ev <= 0 || !act) { onChanged(); renderReactionPrompt(); return; }
        // The Token first and by its own command, so a Counter-roll that will
        // not open cannot leave a Mech that paid for nothing.
        if (!perform(data, state, { kind: 'spendCommand', seat: defender.side, uid: defender.uid }).ok) {
          onChanged(); renderReactionPrompt(); return;
        }
        electronicHelper.start(defender, act, from, { linkLoss: 1 });
        onChanged();
      });
      return;
    }
    void confirmDialog({
      title: `${defender.label}: ${name}`,
      body: `${defender.label} was attacked, so it may place ${r.count} Smoke Screen${
        r.count === 1 ? '' : 's'
      } within Range ${r.range}. The card allows this even if the unit did not survive the attack (FAQ D10). Every attack in that Action has already been resolved, so these Screens cannot shield anyone else it shot at (FAQ B7).`,
      confirmLabel: 'Place them',
      cancelLabel: 'Skip it',
    }).then((go) => {
      // Either answer clears the debt, and the same command spends the use, so
      // the offer cannot come back on the next attack.
      perform(data, state, { kind: 'resolveReaction', seat: defender.side, uid: defender.uid, actionId: r.actionId });
      if (!go) { onChanged(); renderReactionPrompt(); return; }
      startSmokePlacement({
        side: defender.side,
        count: r.count,
        connected: false,
        range: { c: Math.floor(defender.col / 3), r: Math.floor(defender.row / 3), max: r.range },
        label: `${defender.label}: ${name}`,
        // Whatever is still queued goes next, one at a time.
        done: () => {
          onChanged();
          renderReactionPrompt();
        },
      });
    });
  }

  function renderSmokePrompt(): void {
    const host = document.getElementById('smoke-prompt');
    if (!host) return;
    const smoke = state.smoke ?? [];
    const endPhase = PHASES[state.round.phase] === 'End';
    if (smokeChoices?.length) return;
    if (!smoke.length || !endPhase || smokePlacing) {
      host.replaceChildren();
      host.hidden = true;
      return;
    }
    const order: Side[] = state.round.firstPlayer === 's1' ? ['s1', 's2'] : ['s2', 's1'];
    const owed = order
      .map((side) => ({ side, ...dissipationFor(smoke, side) }))
      .filter((d) => d.isolated.length || d.groups.length);
    if (!owed.length) {
      host.replaceChildren();
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = `<div class="smoke-prompt-head"><b>Smoke dissipation</b>
        <span class="dim">End Phase of round ${state.round.n}</span></div>
      <p class="dim">Every screen that is not Connected comes off, and each Connected group loses one.
        Players alternate, ${escapeHtml(squadLabel(order[0]))} first. Groups are counted once now, so a
        removal that splits a group owes nothing more until next round.</p>
      <ul class="smoke-owed">${owed
        .map(
          (d) =>
            `<li><b>${escapeHtml(squadLabel(d.side))}</b>: ${
              [
                d.isolated.length ? `${d.isolated.length} isolated screen${d.isolated.length === 1 ? '' : 's'} removed` : '',
                d.groups.length ? `1 from each of ${d.groups.length} connected group${d.groups.length === 1 ? '' : 's'}` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            }</li>`,
        )
        .join('')}</ul>
      <button id="smoke-dissipate" class="ah-primary">Resolve dissipation</button>`;
    host.querySelector('#smoke-dissipate')!.addEventListener('click', () => resolveDissipation());
  }

  let smokeChoices: { side: Side; group: SmokeScreen[] }[] | null = null;

  function resolveDissipation(): void {
    const smoke = state.smoke ?? [];
    if (!smoke.length) return;
    const order: Side[] = state.round.firstPlayer === 's1' ? ['s1', 's2'] : ['s2', 's1'];
    const doomed = new Set<SmokeScreen>();
    const queue: { side: Side; group: SmokeScreen[] }[] = [];
    let isolated = 0;
    for (const side of order) {
      const d = dissipationFor(smoke, side);
      for (const s of d.isolated) doomed.add(s);
      isolated += d.isolated.length;
      for (const g of d.groups) queue.push({ side, group: g });
    }
    perform(data, state, { kind: 'dissipateSmoke', seat: state.round.firstPlayer });
    smokeChoices = queue;
    onChanged();
    if (!queue.length) {
      void alertDialog({
        title: 'Smoke dissipated',
        body: `${isolated} isolated Smoke Screen${isolated === 1 ? '' : 's'} removed. Nothing was Connected, so there was nothing to choose.`,
      });
      return;
    }
    renderSmokeChoice(isolated);
  }

  function renderSmokeChoice(isolated: number): void {
    const host = document.getElementById('smoke-prompt')!;
    const next = smokeChoices?.[0];
    if (!next) {
      smokeChoices = null;
      board.clearHighlights();
      onChanged();
      void alertDialog({
        title: 'Smoke dissipated',
        body: `Dissipation is done. ${(state.smoke ?? []).length} Smoke Screen${(state.smoke ?? []).length === 1 ? '' : 's'} still on the board.`,
      });
      return;
    }
    host.hidden = false;
    host.innerHTML = `<div class="smoke-prompt-head"><b>Smoke dissipation</b>
        <span class="dim">${escapeHtml(squadLabel(next.side))} chooses · ${smokeChoices!.length} group${smokeChoices!.length === 1 ? '' : 's'} left</span></div>
      <p class="dim">${isolated ? `${isolated} isolated screen${isolated === 1 ? '' : 's'} came off already. ` : ''}Click one
        highlighted Smoke Screen to take it off this Connected group. Splitting the group costs nothing further this round.</p>
      <button id="smoke-auto" class="ah-cancel">Pick for me</button>`;
    board.showSmokeTargets(
      next.group.map((s) => ({ c: s.col, r: s.row, ok: true })),
      (c, r) => {
        perform(data, state, { kind: 'removeSmoke', seat: next.side, at: { col: c, row: r } });
        smokeChoices = smokeChoices!.slice(1);
        onChanged();
        renderSmokeChoice(0);
      },
    );
    host.querySelector('#smoke-auto')!.addEventListener('click', () => {
      perform(data, state, { kind: 'removeSmoke', seat: next.side, at: { col: next.group[0].col, row: next.group[0].row } });
      smokeChoices = smokeChoices!.slice(1);
      onChanged();
      renderSmokeChoice(0);
    });
  }

  function detonateHeading(actionName: string, projLabel: string): string {
    if (/^detonat\w*$/i.test(actionName.trim())) return `Detonate ${projLabel}`;
    return /detonat/i.test(actionName) ? actionName : `Detonate ${actionName}`;
  }

  function unitsWithin(from: Token, range: number): { t: Token; dist: number }[] {
    const gc = Math.floor(from.col / 3);
    const gr = Math.floor(from.row / 3);
    return state.tokens
      .filter((x) => x.uid !== from.uid)
      .map((t) => ({ t, dist: Math.abs(Math.floor(t.col / 3) - gc) + Math.abs(Math.floor(t.row / 3) - gr) }))
      .filter((x) => x.dist <= range)
      .sort((a, b) => a.dist - b.dist);
  }

  const TERRAIN_NAME: Record<TerrainPiece['type'], string> = {
    building: 'Building',
    high_wall: 'Defense wall 3"',
    low_wall: 'Defense wall 2"',
    container: 'Container',
  };

  function terrainLabel(p: TerrainPiece): string {
    const cell = p.subCells[0];
    const where = cell ? ` at ${gridRef(Math.floor(cell.col / 3), Math.floor(cell.row / 3))}` : '';
    const size = p.type === 'container' ? ` 1×${p.subCells.length}` : '';
    return `${TERRAIN_NAME[p.type]}${size}${where}`;
  }

  // Where a Breakable Terrain piece sits, for naming it in a hint.
  function gridOfTerrain(id: string): string {
    const p = currentTerrain().find((x) => x.id === id);
    const c = p?.subCells[0];
    return c ? gridRef(Math.floor(c.col / 3), Math.floor(c.row / 3)) : id;
  }

  // Destructible Terrain is always a legal target for a Projectile in range
  // unless the card says otherwise (4.7.5), and only the 1-inch Containers are
  // destructible: Buildings and both Defense walls are not (p.21).
  function fragileTerrainWithin(from: Token, range: number): { piece: TerrainPiece; dist: number }[] {
    const gc = Math.floor(from.col / 3);
    const gr = Math.floor(from.row / 3);
    return currentTerrain()
      .filter((p) => p.isFragile)
      .map((piece) => {
        const cells = piece.subCells.map((c) => ({ c: Math.floor(c.col / 3), r: Math.floor(c.row / 3) }));
        const dist = Math.min(...cells.map((c) => Math.abs(c.c - gc) + Math.abs(c.r - gr)));
        return { piece, dist };
      })
      .filter((x) => x.dist <= range)
      .sort((a, b) => a.dist - b.dist);
  }

  function startDetonation(proj: Token, actionId: string): void {
    const action = tokenCards(data, proj)
      .flatMap(({ card }) => card.actions ?? [])
      .find((a) => a.id === actionId);
    if (!action) return;
    const range = action.range ?? 0;
    const targets = unitsWithin(proj, range);
    const terrain = fragileTerrainWithin(proj, range);
    board.showRangeRings(proj, range);

    const body = document.getElementById('combat-body')!;
    const name = action.name.en || action.name.zh || action.id;

    const smoke = smokePlacement(action);
    if (smoke) {
      board.clearHighlights();
      startSmokePlacement({
        side: proj.side,
        count: smoke.count,
        connected: smoke.connected,
        origin: { c: Math.floor(proj.col / 3), r: Math.floor(proj.row / 3) },
        label: `${name} · ${proj.label}`,
        done: () => {
          perform(data, state, { kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid });
          if (selectedUid === proj.uid) selectToken(null);
          renderCombatIdle();
          showSideTab('details');
        },
      });
      return;
    }

    if (!action.redDice && !action.yellowDice) {
      renderEffectDetonation(proj, action, name, range, targets);
      return;
    }
    const scope = explosionScope(action, data.actionTranslation(action.id)?.english ?? undefined);
    body.innerHTML = `<div class="attack-helper">
      <div class="ah-head"><b><i class="btn-ico">💥</i> ${escapeHtml(detonateHeading(name, proj.label))}</b>
        <span class="dim">R${range} from ${escapeHtml(proj.label)}</span></div>
      <p class="ah-los">Explosion damage ignores line of sight and facing, and the defender gets
        no Terrain or Unit Protection. Only the defender may spend Link to Focus.</p>
      <div class="ah-step"><h4>${scope === 'all' ? 'Resolve every unit it caught' : 'Choose the unit to damage'}</h4>
        ${targets.length
          ? scope === 'all'
            ? '<p class="dim">This card says <b>all Units within range</b>, so it hits allies too and every unit listed takes a separate attack. Resolve them one at a time (4.7.6).</p>'
            : '<p class="dim">This card damages a <b>single target</b>, so only one of these takes the attack. Pick it, resolve it, then destroy the projectile (4.7.6).</p>'
          : terrain.length
            ? '<p class="dim">No units within range, but Destructible Terrain is always a legal target, so this projectile still has something to hit (4.7.5).</p>'
            : '<p class="dim">No units and no Destructible Terrain within range. A projectile with a delayed action that needs a target is destroyed instead (4.7.5).</p>'}
        <div class="ah-partpick" id="det-targets">${targets
          .map(({ t, dist }) => `<button class="chip" data-uid="${t.uid}">
              <b>${t.side === proj.side ? 'ALLY' : 'ENEMY'}</b> ${escapeHtml(t.label)}
              <small>R${dist}</small></button>`)
          .join('')}</div>
      </div>
      ${terrain.length
        ? `<div class="ah-step"><h4>Or hit Destructible Terrain</h4>
            <p class="dim">Terrain takes no roll. It is removed directly when a Firing, Melee or Explosion attack hits it (p.21). Only the 1-inch Containers can be destroyed; Buildings and Defense walls cannot.</p>
            <div class="ah-partpick" id="det-terrain">${terrain
              .map(({ piece, dist }) => `<button class="chip" data-terrain="${escapeHtml(piece.id)}">
                  <b>TERRAIN</b> ${escapeHtml(terrainLabel(piece))}
                  <small>R${dist}</small></button>`)
              .join('')}</div>
          </div>`
        : ''}
      </div>`;
    const cancel = document.createElement('button');
    cancel.className = 'ah-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      board.clearHighlights();
      renderCombatIdle();
      showSideTab('details');
    });
    body.querySelector('.ah-head')!.appendChild(cancel);

    const remove = document.createElement('button');
    remove.className = 'ah-primary';
    remove.textContent = targets.length || terrain.length ? 'Done: destroy the projectile' : 'Destroy the projectile';
    const det = data.mechanics.find((m) => m.id === 'detonation');
    if (det) inspectOnHover(remove, { title: det.name, sub: det.ref, lines: [det.text] });
    remove.addEventListener('click', () => {
      perform(data, state, { kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid });
      board.clearHighlights();
      if (selectedUid === proj.uid) selectToken(null);
      renderCombatIdle();
      onChanged();
      showSideTab('details');
    });
    body.querySelector('.attack-helper')!.appendChild(remove);

    body.querySelectorAll<HTMLButtonElement>('#det-targets button').forEach((b) =>
      b.addEventListener('click', () => {
        const target = state.tokens.find((x) => x.uid === Number(b.dataset.uid));
        if (!target) return;
        board.clearHighlights();
        attackHelper.start(proj, action, target, 'Explosion damage: no line of sight or facing check.', 0, '', true);
        showSideTab('combat');
      }),
    );
    // Terrain is removed on the spot rather than handed to the attack helper,
    // because hitting it needs no roll at all.
    body.querySelectorAll<HTMLButtonElement>('#det-terrain button').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.terrain!;
        if (state.removedTerrain?.includes(id)) return;
        const hit = currentTerrain().find((p) => p.id === id);
        perform(data, state, { kind: 'destroyTerrain', seat: proj.side, uid: proj.uid, pieces: [id] });
        board.renderTerrain(currentTerrain());
        logTo(proj, `${name} destroys ${hit ? terrainLabel(hit) : 'terrain'}. Destructible Terrain takes no roll.`);
        b.disabled = true;
        onChanged();
      }),
    );
    showSideTab('combat');
  }

  function renderEffectDetonation(
    proj: Token,
    action: { id: string; description?: { en?: string; zh?: string; jp?: string } },
    name: string,
    range: number,
    targets: { t: Token; dist: number }[],
  ): void {
    const body = document.getElementById('combat-body')!;
    const rawEn = action.description?.en?.trim();
    const en = rawEn && !/[぀-ヿ一-鿿]/.test(rawEn) ? rawEn : undefined;
    const tr = data.actionTranslation(action.id);
    const text = en ?? tr?.english ?? action.description?.zh?.trim() ?? 'See the card for what this detonation does.';
    const guess = /interfer|jam|stun/i.test(`${name} ${text}`) ? 'fci' : 'smoke';
    let pick = guess;
    const needsLos = /line of sight|视线/i.test(text);
    const los = new Map<number, string>();
    if (needsLos) for (const { t } of targets) los.set(t.uid, losBetween(proj, t, currentTerrain(), state.tokens));
    const caught = needsLos ? targets.filter(({ t }) => los.get(t.uid) !== 'blocked') : targets;

    // Only offer tokens that could legally land on something in the blast, so a
    // grenade over a missile does not advertise Repaired or Optical Camouflage.
    const detStatuses = (): StatusDef[] => {
      const kinds = new Set(targets.map((x) => x.t.kind));
      if (!kinds.size) return statusesFor('mech');
      return STATUSES.filter((s) => [...kinds].some((k) => !s.appliesTo || s.appliesTo.includes(k)));
    };

    const draw = (): void => {
      body.innerHTML = `<div class="attack-helper">
        <div class="ah-head"><b><i class="btn-ico">💥</i> ${escapeHtml(detonateHeading(name, proj.label))}</b>
          <span class="dim">${range === 0 ? 'this grid' : `R${range}`} from ${escapeHtml(proj.label)}</span></div>
        <p class="ah-los">${escapeHtml(text)}</p>
        <div class="ah-step">
          <h4>Mark the units it caught</h4>
          <p class="dim">This detonation causes an effect rather than damage, so there is no attack
            roll. Pick the token it applies, then click each unit inside the blast. The card text
            above is what actually happens; the token is just a reminder on the board.</p>
          <div class="status-row" id="det-status">${detStatuses().map(
            (s) => `<button class="status-chip shape-${s.shape}${s.id === pick ? ' on' : ''}" data-sid="${s.id}"
                      style="--chip-tint:${s.tint}" title="${escapeHtml(s.label)}: ${escapeHtml(s.note)}">${s.icon}</button>`,
          ).join('')}</div>
          ${needsLos
            ? `<p class="dim">This one only affects units that can see the grenade, so line of sight is
                shown per unit. ${caught.length} of ${targets.length} in range ${caught.length === 1 ? 'has' : 'have'} it.</p>`
            : ''}
          ${targets.length
            ? `<div class="ah-partpick" id="det-units">${targets
                .map(({ t, dist }) => {
                  const on = (t.statuses ?? []).includes(pick);
                  const l = los.get(t.uid);
                  const blocked = l === 'blocked';
                  return `<button class="chip${on ? ' chip-intact' : ''}${blocked ? ' chip-destroyed' : ''}" data-uid="${t.uid}"
                      ${blocked ? 'data-tip-title="No line of sight" data-tip="This unit cannot see the grenade, so the card does not affect it.|You can still mark it by hand if you have ruled otherwise."' : ''}>
                    <b>${t.side === proj.side ? 'ALLY' : 'ENEMY'}</b> ${escapeHtml(t.label)}
                    <small>R${dist}${l ? ` · LoS ${l}` : ''}${on ? ' ✓' : ''}</small></button>`;
                })
                .join('')}</div>
               <button class="ah-primary" id="det-all">Apply to ${caught.length === targets.length
                 ? `all ${targets.length} unit${targets.length === 1 ? '' : 's'} in range`
                 : `the ${caught.length} unit${caught.length === 1 ? '' : 's'} that can see it`}</button>`
            : '<p class="dim">No units inside the blast. A projectile whose delayed action needs a target is destroyed instead (4.7.5).</p>'}
        </div>
        <button class="ah-primary" id="det-done">Done: destroy the projectile</button>
      </div>`;

      const cancel = document.createElement('button');
      cancel.className = 'ah-cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        board.clearHighlights();
        renderCombatIdle();
        showSideTab('details');
      });
      body.querySelector('.ah-head')!.appendChild(cancel);

      bindTips(body);
      body.querySelectorAll<HTMLButtonElement>('#det-status button').forEach((b) =>
        b.addEventListener('click', () => {
          pick = b.dataset.sid!;
          draw();
        }),
      );
      const apply = (t: Token): void => {
        const def = STATUSES.find((s) => s.id === pick);
        const label = def?.label ?? pick;
        if (def?.appliesTo && !def.appliesTo.includes(t.kind)) {
          logTo(t, `${label} does not apply to a ${t.kind}, so ${t.label} was skipped.`);
          return;
        }
        // Both directions go through the command layer. A Token is rules-bearing
        // and fingerprinted — Immobilized zeroes the Dodge pool, Fragile takes
        // White off it — so a chip toggled by hand never reached the other
        // client and left the two boards defending differently.
        const at = (t.statuses ?? []).lastIndexOf(pick);
        if (at >= 0 && !def?.stacking) {
          perform(data, state, { kind: 'removeStatus', seat: proj.side, uid: proj.uid, targetUid: t.uid, statusId: pick });
          logTo(t, `${label} removed from ${t.label}.`);
          return;
        }
        const before = t.statuses ?? [];
        // addStatus's displacement and J22's yellow-face reset both live in the
        // command, so every seat resolves the same knock-on.
        perform(data, state, { kind: 'applyStatus', seat: proj.side, uid: proj.uid, targetUid: t.uid, statusId: pick });
        const after = t.statuses ?? [];
        const lost = before.filter((s) => !after.includes(s)).map((s) => STATUSES.find((d) => d.id === s)?.label ?? s);
        const n = after.filter((x) => x === pick).length;
        logTo(
          t,
          `${name} from ${proj.label}: ${t.label} gains ${label}${def?.stacking && n > 1 ? ` (now ×${n})` : ''}${lost.length ? `, losing ${lost.join(' and ')}` : ''}.`,
        );
      };
      body.querySelectorAll<HTMLButtonElement>('#det-units button').forEach((b) =>
        b.addEventListener('click', () => {
          const t = state.tokens.find((x) => x.uid === Number(b.dataset.uid));
          if (!t) return;
          apply(t);
          onChanged();
          draw();
        }),
      );
      body.querySelector('#det-all')?.addEventListener('click', () => {
        const stacking = !!STATUSES.find((s) => s.id === pick)?.stacking;
        for (const { t } of caught) {
          if (!stacking && (t.statuses ?? []).includes(pick)) continue;
          apply(t);
        }
        onChanged();
        draw();
      });
      body.querySelector('#det-done')!.addEventListener('click', () => {
        perform(data, state, { kind: 'despawn', seat: proj.side, uid: proj.uid, targetUid: proj.uid });
        board.clearHighlights();
        if (selectedUid === proj.uid) selectToken(null);
        renderCombatIdle();
        onChanged();
        showSideTab('details');
      });
    };
    draw();
    showSideTab('combat');
  }

  function logTo(t: Token, text: string): void {
    t.log = [...(t.log ?? []), { round: state.round.n, text }];
    if (t.log.length > 200) t.log = t.log.slice(-200);
    renderUnitLog();
    save();
  }

  function rangeText(a: Token, b: Token): string {
    const ga = { c: Math.floor(a.col / 3), r: Math.floor(a.row / 3) };
    const gb = { c: Math.floor(b.col / 3), r: Math.floor(b.row / 3) };
    const dc = Math.abs(ga.c - gb.c);
    const dr = Math.abs(ga.r - gb.r);
    if (dc === 0 && dr === 0) return 'same grid';
    if (dc <= 1 && dr <= 1) return 'adjacent · R1';
    return `Range ${dc + dr}`;
  }

  function isFree(col: number, row: number, size: number, aerial: boolean, ignoreUid?: number): boolean {
    if (col < 0 || row < 0 || col + size > CELLS || row + size > CELLS) return false;
    if (aerial) return true;
    const cells = new Set(footprint({ col, row, size }).map((c) => `${c.col},${c.row}`));
    for (const p of currentTerrain()) {
      if (size === 3 && p.isFragile) continue;
      for (const c of p.subCells) if (cells.has(`${c.col},${c.row}`)) return false;
    }
    for (const t of state.tokens) {
      if (t.uid === ignoreUid || t.aerial) continue;
      for (const c of footprint(t)) if (cells.has(`${c.col},${c.row}`)) return false;
    }
    return true;
  }

  function destructibleAt(col: number, row: number, size: number): string[] {
    const cells = new Set(footprint({ col, row, size }).map((c) => `${c.col},${c.row}`));
    const ids: string[] = [];
    for (const p of currentTerrain()) {
      if (p.isFragile && p.subCells.some((c) => cells.has(`${c.col},${c.row}`))) ids.push(p.id);
    }
    return ids;
  }

  function findFreeSpot(size: 1 | 2 | 3, side: Side, aerial: boolean): { col: number; row: number } | null {
    const rows = [...Array(CELLS - size + 1).keys()];
    if (side === 's2') rows.reverse();
    for (const row of rows) {
      for (let col = 0; col <= CELLS - size; col++) {
        const s = snapPlacement(col, row, size);
        if (s && s.row === row && s.col === col && isFree(col, row, size, aerial)) return { col, row };
      }
    }
    return null;
  }

  // Break Away and Crush both bend the movement search, and every caller that
  // draws a route or a range overlay has to bend it the same way or the overlay
  // promises a move the confirm step will refuse.
  function moveOpts(t: Token, flying: boolean): MoveOpts {
    const terrain = currentTerrain();
    return {
      exitCost: flying || t.aerial ? undefined : breakAwayCost(data, t, state.tokens, terrain),
      crushable: (c, r) => crushTargets(t, c, r, terrain, state.tokens) !== null,
    };
  }

  function currentTerrain(): TerrainPiece[] {
    if (editor.active) return editor.working;
    if (!state.map) return [];
    const base = state.map.startsWith('custom:') ? loadCustomMap(state.map.slice(7)).pieces : data.terrain.layouts[state.map] ?? [];
    const removed = state.removedTerrain;
    return removed?.length ? base.filter((p) => !removed.includes(p.id)) : base;
  }

  // ---------- map editor ----------

  const editorBar = document.getElementById('editor-bar')!;

  window.addEventListener('pointerup', () => {
    if (editor.drag) commitDrag();
  });
  window.addEventListener('pointercancel', () => {
    if (editor.drag) commitDrag();
  });

  function largeGridCells(col: number, row: number): { col: number; row: number }[] {
    const c = Math.floor(col / 3) * 3;
    const r = Math.floor(row / 3) * 3;
    const out: { col: number; row: number }[] = [];
    for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 3; dr++) out.push({ col: c + dc, row: r + dr });
    return out;
  }

  function dragGrids(d: { from: { col: number; row: number }; to: { col: number; row: number } }): { col: number; row: number }[] {
    const c0 = Math.min(d.from.col, d.to.col);
    const c1 = Math.max(d.from.col, d.to.col);
    const r0 = Math.min(d.from.row, d.to.row);
    const r1 = Math.max(d.from.row, d.to.row);
    const out: { col: number; row: number }[] = [];
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push({ col: c, row: r });
    return out;
  }

  function dragSmallCells(d: { from: { col: number; row: number }; to: { col: number; row: number } }): { col: number; row: number }[] {
    return dragGrids(d).flatMap((g) => largeGridCells(g.col * 3, g.row * 3));
  }

  function commitDrag(): void {
    const d = editor.drag;
    const p = editor.paint;
    editor.drag = null;
    board.clearGhost();
    if (!d || !p) return;
    const grids = dragGrids(d);
    const held = p.kind === 'deploy' ? editor.deploy[p.side] : (editor.zones.find((z) => z.id === p.zoneId)?.cells ?? []);
    const single = grids.length === 1;
    const untoggle = single && !d.erase && held.some((c) => c.col === grids[0].col && c.row === grids[0].row);
    // One snapshot for the whole gesture: a drag across twelve Grids is one
    // thing the player did, so one Undo should put all twelve back.
    pushUndo();
    for (const g of grids) paintCell(g.col, g.row, d.erase || untoggle);
    afterEdit();
  }

  function paintCell(gcol: number, grow: number, erase: boolean): void {
    const p = editor.paint;
    if (!p) return;
    const cell = { col: gcol, row: grow };
    const same = (a: { col: number; row: number }) => a.col === cell.col && a.row === cell.row;

    if (p.kind === 'deploy') {
      const list = editor.deploy[p.side];
      const at = list.findIndex(same);
      if (erase) {
        if (at >= 0) list.splice(at, 1);
      } else if (at < 0) {
        const other = p.side === 'black' ? 'white' : 'black';
        const clash = editor.deploy[other].findIndex(same);
        if (clash >= 0) editor.deploy[other].splice(clash, 1);
        list.push(cell);
      }
    } else {
      const zone = editor.zones.find((z) => z.id === p.zoneId);
      if (!zone) return;
      const at = zone.cells.findIndex(same);
      if (erase) {
        if (at >= 0) zone.cells.splice(at, 1);
      } else if (at < 0) {
        for (const z of editor.zones) {
          if (z.id === zone.id) continue;
          const dup = z.cells.findIndex(same);
          if (dup >= 0) z.cells.splice(dup, 1);
        }
        zone.cells.push(cell);
      }
    }
  }

  // The footprint a piece will actually occupy, drawn at the same 3x3 Large Grid
  // the board uses, so the button shows the shape AND its current rotation
  // before anything is committed. Fills are the board's own TERRAIN_FILL, or the
  // preview would teach a colour the map does not use.
  const PIECE_FILL: Record<string, string> = {
    building: '#4b5563', high_wall: '#6b7280', low_wall: '#d1d5db', container: '#2fae6e',
  };

  function piecePreview(p: (typeof PALETTE)[number]): string {
    // pieceCells works in board coordinates; asking it for the top-left Grid
    // gives the shape in cells 0..2, which is exactly a 3x3 preview.
    const cells = pieceCells(p, 0, 0, p.rotatable ? editor.vertical : false);
    const on = new Set(cells.map((c) => `${c.col},${c.row}`));
    let out = '<span class="ed-shape" aria-hidden="true">';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const lit = on.has(`${c},${r}`);
        out += `<i${lit ? ` style="background:${PIECE_FILL[p.type]}"` : ''}></i>`;
      }
    }
    return `${out}</span>`;
  }

  function renderEditorBar(): void {
    if (!editor.active) {
      editorBar.hidden = true;
      return;
    }
    editorBar.hidden = false;
    const dirty = editorDirty();
    const empty = !(editor.working.length || editor.zones.length || editor.deploy.black.length || editor.deploy.white.length);
    // A column now, not a bar: header, scrolling body of tool groups, and the
    // save/close actions pinned to the foot — the Match Centre's panel shape.
    // Every id and functional class below is unchanged, so the bindings that
    // follow this template bind exactly as they did across the board.
    editorBar.innerHTML = `
      <div class="ed-head">
        <div class="ed-eyebrow">Map editor</div>
        <div class="ed-title">${escapeHtml(mapSelect.options[mapSelect.selectedIndex]?.text ?? 'Untitled map')}</div>
        <div class="ed-headrow">
          <span class="ed-count">${editor.working.length} piece${editor.working.length === 1 ? '' : 's'} · ${editor.zones.length} zone${editor.zones.length === 1 ? '' : 's'}${dirty ? ' · <b>unsaved</b>' : ''}</span>
          <button id="ed-undo" class="ed-undo"${editorHistory.length ? '' : ' disabled'} title="Undo the last edit (Ctrl+Z)">⟲ Undo${editorHistory.length ? ` <small>${editorHistory.length}</small>` : ''}</button>
        </div>
      </div>
      <div class="ed-body">
        <p class="ed-glabel">Terrain</p>
        <div class="ed-grid">
          ${PALETTE.map((p) => `<button class="ed-piece${editor.item?.id === p.id ? ' active' : ''}" data-piece="${p.id}" title="${p.label}">
            ${piecePreview(p)}
            <span class="ed-pname">${escapeHtml(p.label.split(' (')[0].replace(/\s\d+×\d+$/, ''))}</span>
            <span class="ed-pnote">${escapeHtml((/\(([^)]*)\)/.exec(p.label)?.[1] ?? '').split(', ')[1] ?? '')}</span>
          </button>`).join('')}
        </div>
        <div class="ed-tools">
          <button id="ed-rotate" class="ed-tool" title="Rotate the armed piece (R)"${editor.item?.rotatable ? '' : ' disabled'}>${editor.vertical ? '↕' : '↔'} Rotate</button>
          <button id="ed-erase" class="ed-tool${editor.erase ? ' active' : ''}" title="Erase tool. Right-click erases too.">⌫ Erase</button>
        </div>

        <p class="ed-glabel">Zones</p>
        ${editor.zones
          .map(
            (z) =>
              `<button class="ed-row ed-zone${editor.paint?.kind === 'zone' && editor.paint.zoneId === z.id ? ' active' : ''}" data-zone="${z.id}" data-tip-title="Paint ${z.name}" data-tip-sub="Large grids, 3x3 cells each" data-tip="Drag to fill a block of grids.|Right-click a painted grid to remove it.|A single click on a painted grid removes it too.">${escapeHtml(z.name)}<small>${z.cells.length} grid${z.cells.length === 1 ? '' : 's'}</small></button>`,
          )
          .join('')}
        <div class="ed-tools">
          <button id="ed-addzone" class="ed-tool" title="Create a named objective zone">+ Zone</button>
          ${editor.paint?.kind === 'zone' ? '<button id="ed-zone-rename" class="ed-tool" title="Rename or delete the selected zone">Rename…</button>' : ''}
        </div>

        <p class="ed-glabel">Deployment</p>
        <button id="ed-dz-black" class="ed-row ed-dz-black${editor.paint?.kind === 'deploy' && editor.paint.side === 'black' ? ' active' : ''}" title="Paint the Black deployment zone. Drag to fill a block.">Black<small>${editor.deploy.black.length} grid${editor.deploy.black.length === 1 ? '' : 's'}</small></button>
        <button id="ed-dz-white" class="ed-row ed-dz-white${editor.paint?.kind === 'deploy' && editor.paint.side === 'white' ? ' active' : ''}" title="Paint the White deployment zone. Drag to fill a block.">White<small>${editor.deploy.white.length} grid${editor.deploy.white.length === 1 ? '' : 's'}</small></button>

        <p class="ed-status">${editorStatus()}</p>
      </div>
      <div class="ed-foot">
        <button id="ed-save" class="ed-primary">Save map…</button>
        <div class="ed-footrow">
          <button id="ed-exit">${dirty ? 'Discard' : 'Close'}</button>
          <button id="ed-clear"${empty ? ' disabled' : ''}>Clear all</button>
          ${state.map.startsWith('custom:') ? '<button id="ed-delete" title="Delete this custom map">Delete map</button>' : ''}
        </div>
      </div>`;
    // The bar is rebuilt on every edit, so its data-tip nodes have to be bound
    // again each time; the one call at startup only ever saw the first render.
    bindTips(editorBar);
    editorBar.querySelectorAll<HTMLButtonElement>('.ed-piece').forEach((b) =>
      b.addEventListener('click', () => {
        const picked = PALETTE.find((p) => p.id === b.dataset.piece) ?? null;
        editor.item = editor.item?.id === picked?.id ? null : picked;
        editor.erase = false;
        editor.paint = null;
        board.clearGhost();
        renderEditorBar();
      }),
    );
    editorBar.querySelectorAll<HTMLButtonElement>('.ed-zone').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.zone!;
        const on = editor.paint?.kind === 'zone' && editor.paint.zoneId === id;
        editor.paint = on ? null : { kind: 'zone', zoneId: id };
        editor.item = null;
        editor.erase = false;
        board.clearGhost();
        renderEditorBar();
      }),
    );
    for (const side of ['black', 'white'] as const) {
      editorBar.querySelector(`#ed-dz-${side}`)!.addEventListener('click', () => {
        const on = editor.paint?.kind === 'deploy' && editor.paint.side === side;
        editor.paint = on ? null : { kind: 'deploy', side };
        editor.item = null;
        editor.erase = false;
        board.clearGhost();
        renderEditorBar();
      });
    }
    editorBar.querySelector('#ed-addzone')!.addEventListener('click', () => {
      void (async () => {
        const name = await promptDialog({
          title: 'Name the zone',
          body: 'Objective zones are drawn on the board and can be named anything. The printed board uses Alpha through India.',
          placeholder: 'Alpha',
          confirmLabel: 'Create zone',
        });
        if (!name?.trim()) return;
        pushUndo();
        const id = `z${Date.now().toString(36)}`;
        editor.zones.push({ id, name: name.trim(), cells: [] });
        editor.paint = { kind: 'zone', zoneId: id };
        editor.item = null;
        editor.erase = false;
        afterEdit();
      })();
    });
    editorBar.querySelector('#ed-zone-rename')?.addEventListener('click', () => {
      void (async () => {
        const p = editor.paint;
        if (p?.kind !== 'zone') return;
        const zone = editor.zones.find((z) => z.id === p.zoneId);
        if (!zone) return;
        const name = await promptDialog({
          title: `Rename "${zone.name}"`,
          body: 'Clear the field and confirm to delete this zone instead.',
          value: zone.name,
          confirmLabel: 'Save',
        });
        if (name === null) return;
        pushUndo();
        if (!name.trim()) {
          editor.zones = editor.zones.filter((z) => z.id !== zone.id);
          editor.paint = null;
        } else {
          zone.name = name.trim();
        }
        afterEdit();
      })();
    });
    editorBar.querySelector('#ed-undo')!.addEventListener('click', () => undoEdit());
    editorBar.querySelector('#ed-erase')!.addEventListener('click', () => {
      editor.erase = !editor.erase;
      if (editor.erase) editor.item = null;
      board.clearGhost();
      renderEditorBar();
    });
    editorBar.querySelector('#ed-rotate')!.addEventListener('click', () => {
      editor.vertical = !editor.vertical;
      renderEditorBar();
    });
    editorBar.querySelector('#ed-clear')!.addEventListener('click', async () => {
      const n = editor.working.length;
      const z = editor.zones.length;
      const d = editor.deploy.black.length + editor.deploy.white.length;
      if (
        !(n || z || d) ||
        (await confirmDialog({
          title: 'Empty this map?',
          body: `This clears ${n} piece${n === 1 ? '' : 's'}, ${z} zone${z === 1 ? '' : 's'} and any deployment zones from the map you are editing.`,
          confirmLabel: 'Clear it all',
          danger: true,
        }))
      ) {
        pushUndo();
        editor.working = [];
        editor.zones = [];
        editor.deploy = { black: [], white: [] };
        editor.paint = null;
        afterEdit();
      }
    });
    editorBar.querySelector('#ed-save')!.addEventListener('click', () => void saveMapFlow());
    editorBar.querySelector('#ed-delete')?.addEventListener('click', async () => {
      const name = state.map.slice(7);
      const ok = await confirmDialog({
        title: `Delete "${name}"?`,
        body: 'The saved map is removed from this browser, along with any zones painted into it. Units on the board are left alone.',
        confirmLabel: 'Delete map',
        danger: true,
      });
      if (!ok) return;
      deleteCustomMap(name);
      state.map = '';
      if (state.zoneSet === `custom:${name}`) state.zoneSet = '';
      exitEditor();
    });
    editorBar.querySelector('#ed-exit')!.addEventListener('click', () => requestExitEditor());
  }

  function editorStatus(): string {
    const p = editor.paint;
    if (p) {
      const what =
        p.kind === 'deploy'
          ? `the ${p.side === 'black' ? 'Black' : 'White'} deployment zone`
          : (editor.zones.find((z) => z.id === p.zoneId)?.name ?? 'a zone');
      return `Painting ${what}. Click a large grid or drag across several; right-click removes.`;
    }
    if (editor.erase) return 'Erase: click a piece to remove it.';
    if (!editor.item) return '';
    const rot = editor.item.rotatable ? ' · R rotates' : '';
    return `Placing ${editor.item.label.split(' (')[0]}. Click the board; right-click erases${rot}.`;
  }

  function editorSnapshot(): string {
    return JSON.stringify({ pieces: editor.working, zones: editor.zones, deploy: editor.deploy });
  }

  function editorDirty(): boolean {
    return editorSnapshot() !== editor.baseline;
  }

  function afterEdit(): void {
    board.renderTerrain(editor.working, true);
    board.renderZones(overlayZones(), overlayDeployment(), claimedZones());
    renderEditorBar();
  }

  // ---------- editor undo ----------
  //
  // A whole-state snapshot rather than an inverse operation per edit. The
  // editable state is three small arrays, a drag can repaint dozens of Grids in
  // one gesture, and "put it back exactly" is the only behaviour that is
  // obviously correct for a delete you did not mean.
  interface EditorSnapshot {
    working: TerrainPiece[];
    zones: CustomZone[];
    deploy: CustomMap['deploy'];
  }
  const editorHistory: EditorSnapshot[] = [];
  const UNDO_LIMIT = 80;

  function pushUndo(): void {
    editorHistory.push({
      working: JSON.parse(JSON.stringify(editor.working)) as TerrainPiece[],
      zones: JSON.parse(JSON.stringify(editor.zones)) as CustomZone[],
      deploy: JSON.parse(JSON.stringify(editor.deploy)) as CustomMap['deploy'],
    });
    if (editorHistory.length > UNDO_LIMIT) editorHistory.shift();
  }

  function undoEdit(): void {
    const snap = editorHistory.pop();
    if (!snap) return;
    editor.working = snap.working;
    editor.zones = snap.zones;
    editor.deploy = snap.deploy;
    // Undoing the creation of a zone leaves the paint tool armed at a zone that
    // no longer exists, and every later click would then land nowhere.
    const paint = editor.paint;
    if (paint?.kind === 'zone' && !editor.zones.some((z) => z.id === paint.zoneId)) {
      editor.paint = null;
    }
    board.clearGhost();
    afterEdit();
  }

  function removeTerrainAt(col: number, row: number): void {
    const hit = editor.working.find((p) => p.subCells.some((c) => c.col === col && c.row === row));
    if (!hit) return;
    editor.working = editor.working.filter((p) => p !== hit);
    afterEdit();
  }

  async function saveMapFlow(): Promise<boolean> {
    const suggested = state.map.startsWith('custom:') ? state.map.slice(7) : 'My map';
    const name = await promptDialog({
      title: 'Save this map',
      body: 'Saved maps are kept in this browser and appear in the Map list.',
      value: suggested,
      placeholder: 'Map name',
      confirmLabel: 'Save map',
    });
    if (!name) return false;
    saveCustomMap(name, { pieces: editor.working, zones: editor.zones, deploy: editor.deploy });
    state.map = `custom:${name}`;
    adoptMapZones();
    if (editor.zones.some((z) => z.cells.length) || editor.deploy.black.length || editor.deploy.white.length) {
      state.zoneSet = `custom:${name}`;
      state.showZones = true;
    }
    exitEditor();
    return true;
  }

  async function requestExitEditor(): Promise<void> {
    if (editorDirty()) {
      const n = editor.working.length;
      const z = editor.zones.filter((zn) => zn.cells.length).length;
      const bits = [`${n} piece${n === 1 ? '' : 's'}`];
      if (z) bits.push(`${z} zone${z === 1 ? '' : 's'}`);
      if (editor.deploy.black.length || editor.deploy.white.length) bits.push('deployment zones');
      const choice = await choiceDialog({
        title: 'Save this map before closing?',
        body: `The map has unsaved changes (${bits.join(', ')}). Terrain and zones only live in a saved map, so closing without saving loses them.`,
        choices: [
          { id: 'save', label: 'Save map…', primary: true },
          { id: 'discard', label: 'Discard changes', danger: true },
          { id: 'stay', label: 'Keep editing', cancel: true },
        ],
      });
      if (choice === 'save') {
        await saveMapFlow();
        return;
      }
      if (choice !== 'discard') return;
    }
    exitEditor();
  }

  function enterEditor(): void {
    const existing = currentCustomMap();
    editor.working = JSON.parse(JSON.stringify(currentTerrain())) as TerrainPiece[];
    editor.zones = JSON.parse(JSON.stringify(existing?.zones ?? [])) as CustomZone[];
    editor.deploy = JSON.parse(JSON.stringify(existing?.deploy ?? emptyCustomMap().deploy)) as CustomMap['deploy'];
    editor.active = true;
    editor.item = null;
    editor.erase = false;
    editor.paint = null;
    editor.drag = null;
    editor.baseline = editorSnapshot();
    // A fresh session: the history must never reach back past the map you
    // opened, or Undo would restore a different map's terrain.
    editorHistory.length = 0;
    board.panEnabled = false;
    board.editing = true;
    renderEditorBar();
    board.renderTerrain(editor.working, true);
    board.renderZones(overlayZones(), overlayDeployment(), claimedZones());
    board.clearHighlights();
  }

  function exitEditor(): void {
    editor.active = false;
    editor.item = null;
    editor.erase = false;
    editor.paint = null;
    editor.drag = null;
    editorHistory.length = 0;
    board.panEnabled = true;
    board.editing = false;
    board.clearGhost();
    renderEditorBar();
    populateMapSelect();
    save();
    renderAll();
  }

  function save(): void {
    if (replayActive) return;
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function loadState(): GameState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? migrateState(JSON.parse(raw), data) : null;
    } catch {
      return null;
    }
  }

  let lastStockSig = '';

  // A Projectile is spent scenery and goes without asking. Anything else is a
  // built unit with no undo behind it, so it gets a confirmation.
  // Tactics resolve here rather than in the squad list because every one of them
  // needs a target picker, and two of them need a second choice on top of that.
  // Nothing is stamped as played until the effect has actually landed, so backing
  // out of a picker leaves the card in hand.
  async function playTactic(side: Side, id: string): Promise<void> {
    const spec = tacticSpec(id);
    if (!spec) return;
    const ctx = {
      maxLink: (t: Token) => tokenCards(data, t).find((c) => c.slot === 'pilot')?.card.LV ?? 0,
    };
    const targets = tacticTargets(spec, state, side, ctx);
    if (!targets.length) {
      await alertDialog({ title: `${spec.name} has no legal target`, body: spec.none });
      return;
    }
    const phase = PHASES[state.round.phase];
    if (state.script && phase !== spec.phase) {
      const ok = await confirmDialog({
        title: `It is the ${phase} Phase`,
        body: `${spec.name} is a ${spec.timing} card. Play it anyway?`,
        confirmLabel: 'Play it',
      });
      if (!ok) return;
    }
    const uid = targets.length === 1
      ? String(targets[0].uid)
      : await choiceDialog({
        title: spec.name,
        body: spec.prompt,
        stacked: true,
        choices: [
          ...targets.map((t) => ({
            id: String(t.uid),
            label: `${t.label} · ${t.stance.toUpperCase()}${t.link !== undefined ? ` · Link ${t.link}` : ''}`,
          })),
          { id: 'cancel', label: 'Cancel', cancel: true },
        ],
      });
    if (!uid || uid === 'cancel') return;
    const target = state.tokens.find((t) => t.uid === Number(uid));
    if (!target) return;

    let pick: string | null = null;
    if (spec.choices) {
      const opts = spec.choices(target, state, ctx);
      if (!opts.length) {
        await alertDialog({ title: `${spec.name} has nothing to do`, body: spec.none });
        return;
      }
      pick = opts.length === 1
        ? opts[0].id
        : await choiceDialog({
          title: spec.choiceTitle ?? spec.name,
          body: target.label,
          stacked: true,
          choices: [
            ...opts.map((o) => ({ id: o.id, label: o.note ? `${o.label} · ${o.note}` : o.label })),
            { id: 'cancel', label: 'Cancel', cancel: true },
          ],
        });
      if (!pick || pick === 'cancel') return;
    }

    // The pickers above are the interactive half; the effect itself is a
    // command, so a mirrored seat replays it from (card, target, pick) alone.
    // Its log line is written into the token by apply, and read back here.
    const verdict = perform(data, state, { kind: 'playTactic', seat: side, uid: target.uid, cardId: id, pick: pick ?? undefined });
    const log = target.log?.at(-1)?.text ?? spec.name;
    renderUnitLog();
    selectToken(target.uid);
    onChanged();
    if (spec.maneuver) {
      void startMove(target.uid, { range: maneuverRange(data, target), label: 'Maneuver', maneuver: true }, () => onChanged());
      return;
    }
    await alertDialog({ title: spec.name, body: verdict.ok ? log : `${log}\n\n⚠ ${verdict.why}` });
  }

  async function removeUnit(uid: number): Promise<void> {
    const t = state.tokens.find((x) => x.uid === uid);
    if (!t) return;
    const carried = state.tokens.filter((x) => x.parentUid === uid && x.kind === 'projectile').length;
    if (t.kind !== 'projectile') {
      const ok = await confirmDialog({
        title: `Remove ${t.label}?`,
        body: carried
          ? `It comes off the board along with ${carried} projectile${carried === 1 ? '' : 's'} it launched. There is no undo.`
          : 'It comes off the board and out of its squad. There is no undo.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
    }
    state.tokens = state.tokens.filter((x) => x.uid !== uid && x.parentUid !== uid);
    if (selectedUid === uid) selectToken(null);
    onChanged();
  }

  // A squad shows its faction everywhere it appears: board tokens, move paths,
  // squad cards, task markers. Two custom properties carry the tint so the CSS
  // stays declarative and nothing has to be repainted element by element.
  function syncSquadTints(): void {
    const root = document.documentElement;
    for (const side of SQUAD_ORDER) {
      const f = squadAllegiance(data, state.tokens.filter((t) => t.side === side)).faction;
      root.style.setProperty(`--sq-${side}`, squadColour(f));
    }
  }

  // ---------- Optical Camouflage reveals (4.12.2, FAQ I4/I5/I7/I14/I23) ----------

  // Which camouflaged units have already been asked about their current
  // Contact, so the sweep asks once per touch rather than every repaint. A
  // unit that ACTIVATES camo while already touching is seeded silently: that
  // is not "ending Movement in Contact" and does not Reveal (FAQ I14).
  const camoContactSeen = new Set<number>();
  let prevCamo = new Set<number>();

  function promptReveal(t: Token, why: string): void {
    if (statusCount(t.statuses, 'camouflage') === 0) return;
    if (state.script?.strict) {
      perform(data, state, { kind: 'reveal', seat: t.side, uid: t.uid });
      logTo(t, `${why} Optical Camouflage ends (4.12.2).`);
      void alertDialog({
        title: `${t.label} is Revealed`,
        body: `${why} A camouflaged unit Reveals here (4.12.2). Reveal movement up to its Stealth value may follow — move it by hand if the card grants any.`,
      });
      onChanged();
      return;
    }
    void confirmDialog({
      title: `${t.label} breaks camouflage`,
      body: `${why} Under 4.12.2 the Optical Camouflage ends and the unit Reveals. Reveal movement up to its Stealth value may follow.`,
      confirmLabel: 'Reveal it (4.12.2)',
      cancelLabel: 'Keep it hidden (house rule)',
    }).then((go) => {
      if (!go) return;
      perform(data, state, { kind: 'reveal', seat: t.side, uid: t.uid });
      logTo(t, `${why} Optical Camouflage ends (4.12.2).`);
      onChanged();
    });
  }

  function sweepCamoContacts(): void {
    const nowCamo = new Set<number>();
    for (const t of state.tokens) {
      if (statusCount(t.statuses, 'camouflage') === 0 || t.deployed === false) {
        camoContactSeen.delete(t.uid);
        continue;
      }
      nowCamo.add(t.uid);
      // One shared derivation rather than the plain !aerial test this used to
      // run: that threw away landed Mines and Beacons, which FAQ I10 says DO
      // break camouflage, and the Match Centre had the rule while this page
      // did not.
      const toucher = camoBrokenBy(data, state.tokens, t);
      if (!toucher) {
        camoContactSeen.delete(t.uid);
        continue;
      }
      if (camoContactSeen.has(t.uid)) continue;
      camoContactSeen.add(t.uid);
      // Freshly camouflaged while already touching: no Reveal (FAQ I14).
      if (!prevCamo.has(t.uid)) continue;
      // Forced arrivals Reveal too. I4 counts Crush, Drag and Knockback as
      // "Movement" for this trigger and I23 spells it out for a Taurus swap,
      // so the board is the right thing to read and how the unit got here is
      // deliberately not asked.
      promptReveal(t, `${t.label} ended a Movement in Contact with ${toucher.label}.`);
    }
    prevCamo = nowCamo;
  }

  // Which Mines have already been offered, so a declined detonation does not
  // ask again on every render.
  const mineSeen = new Set<number>();

  // A Mine detonates the moment a Ground Unit is in its Grid, however it got
  // there - a Maneuver, a Crush that shoves a Drone in (FAQ M7), a knockback,
  // or a hand-dragged token in the sandbox. Reading it off the board rather
  // than off a Movement is what covers all of those with one rule.
  function sweepMines(): void {
    const owed = minesOwed(data, state.tokens);
    for (const uid of [...mineSeen]) {
      if (!state.tokens.some((t) => t.uid === uid)) mineSeen.delete(uid);
    }
    const next = owed.find((x) => !mineSeen.has(x.uid));
    if (!next) return;
    const m = state.tokens.find((t) => t.uid === next.uid);
    if (!m) return;
    mineSeen.add(next.uid);
    const caught = next.victims
      .map((u) => state.tokens.find((t) => t.uid === u)?.label)
      .filter((x): x is string => !!x);
    // The blast is indiscriminate and catches everything in the Grid, allies
    // and the Flying or Aerial units above it included (M6/M22). It never
    // Reveals a camouflaged victim, and a Mech whose Chassis survives carries
    // on moving (M19).
    const body = `${m.label} is a Mine and ${next.why}, so it always Detonates - a Ground Unit never Crushes a Mine, it sets it off. `
      + `The Explosion catches every unit in that Grid, ally or not: ${caught.join(', ') || 'nothing else'}. `
      + 'It causes no Reveal, and a Mech whose Chassis survives finishes its Movement (FAQ M6/M19/M22).';
    if (state.script?.strict) {
      logTo(m, `${m.label} Detonates: ${next.why}.`);
      void alertDialog({ title: `${m.label} Detonates`, body }).then(() => startDetonation(m, next.actionId));
      return;
    }
    void confirmDialog({
      title: `${m.label} Detonates`,
      body,
      confirmLabel: 'Resolve the Detonation',
      cancelLabel: 'Skip it (house rule)',
    }).then((go) => {
      if (!go) return;
      logTo(m, `${m.label} Detonates: ${next.why}.`);
      startDetonation(m, next.actionId);
    });
  }

  // Which mandatory Detonations have already been offered, so a declined one
  // does not ask again on every render.
  const autoBoomSeen = new Set<number>();
  // Martyrdom (ZHDR-302). Same guard for the same reason, and a separate set
  // because the two triggers are unrelated -- one is phase-gated and the other
  // fires the moment the unit dies.
  const martyrSeen = new Set<number>();

  // "When this unit is destroyed, immediately detonate" (ZHDR-302). Read off the
  // board rather than hooked to the kill, because onDestroyed only records it --
  // the wreck stays standing, which is what makes the read possible. Not
  // phase-gated: it comes due whenever the unit dies. Resolving despawns it, so
  // the sweep stops finding it without any state of its own.
  function sweepMartyrdoms(): void {
    for (const uid of [...martyrSeen]) {
      if (!state.tokens.some((t) => t.uid === uid)) martyrSeen.delete(uid);
    }
    const next = martyrdomOwed(data, state.tokens).find((x) => !martyrSeen.has(x.uid));
    if (!next) return;
    const t = state.tokens.find((x) => x.uid === next.uid);
    if (!t) return;
    martyrSeen.add(next.uid);
    const names = next.targets
      .map((u) => state.tokens.find((x) => x.uid === u))
      .filter((x): x is typeof t => !!x)
      .map((x) => `${x.label}${x.side === t.side ? ' (ally)' : ''}`);
    const body = `${t.label} was destroyed, so it blows up where it stands. The blast takes every Unit in range `
      + `- allies included - and each one takes a separate Explosion attack. In range: ${names.join(', ') || 'nothing'}. `
      + 'Resolving removes the wreck from the board (4.7.5).';
    void confirmDialog({
      title: `${t.label} detonates`,
      body,
      confirmLabel: 'Resolve the Detonation',
      cancelLabel: 'Skip it (house rule)',
    }).then((go) => {
      if (!go) return;
      logTo(t, `${t.label} is destroyed and detonates (ZHDR-302).`);
      startDetonation(t, next.actionId);
    });
  }

  // FAQ M18.6: an Unfolded Pholcus with an enemy in its attack range MUST
  // Detonate in the Automatic Phase. Read off the board rather than off the
  // designation loop, so passing the phase or skipping the unit does not lose
  // it - the same reason the Mine trigger is derived. Phase-gated, because
  // unlike a Mine this one only comes due in the Automatic Phase.
  function sweepAutoDetonations(): void {
    // No script gate: like sweepMines, the sandbox player clicking the round
    // tracker to Automatic deserves the reminder too. The phase test is the
    // gate, and leaving the phase re-arms it for next round.
    if (PHASES[state.round.phase] !== 'Automatic') {
      autoBoomSeen.clear();
      return;
    }
    const owed = autoDetonationsOwed(data, state.tokens);
    for (const uid of [...autoBoomSeen]) {
      if (!state.tokens.some((t) => t.uid === uid)) autoBoomSeen.delete(uid);
    }
    const next = owed.find((x) => !autoBoomSeen.has(x.uid));
    if (!next) return;
    const t = state.tokens.find((x) => x.uid === next.uid);
    if (!t) return;
    autoBoomSeen.add(next.uid);
    const names = next.targets
      .map((u) => state.tokens.find((x) => x.uid === u)?.label)
      .filter((x): x is string => !!x);
    // It jumps to the target's Grid and blows up there, so the victim is the
    // one it reaches - and where several are tied for nearest the choice is
    // still the player's, which is why the target is not named here.
    const body = `${t.label} has an enemy in its attack range, and the FAQ is explicit that it MUST Detonate `
      + `in the Automatic Phase - this is not a choice (M18.6). It jumps to the target's Grid, Detonates there and is removed. `
      + `In range: ${names.join(', ') || 'nothing'}${names.length > 1 ? ' - tied for nearest, so you pick which' : ''}. `
      + 'Destroying it or its self-Detonation grants no score, since it is a Low Value Unit (M8).';
    if (state.script?.strict) {
      logTo(t, `${t.label} must Detonate: an enemy is in range (M18.6).`);
      void alertDialog({ title: `${t.label} must Detonate`, body }).then(() => startDetonation(t, next.actionId));
      return;
    }
    void confirmDialog({
      title: `${t.label} must Detonate`,
      body,
      confirmLabel: 'Resolve the Detonation',
      cancelLabel: 'Skip it (house rule)',
    }).then((go) => {
      if (!go) return;
      logTo(t, `${t.label} must Detonate: an enemy is in range (M18.6).`);
      startDetonation(t, next.actionId);
    });
  }

  function onChanged(): void {
    setSquadNames(state.sideNames);
    syncSquadTints();
    save();
    board.renderZones(overlayZones(), overlayDeployment(), claimedZones());
    board.renderTokens(state);
    board.renderTaskItems(normaliseTasks(state.tasks).items, zoneCentre);
    board.renderSmoke(state.smoke ?? []);
    board.setSelected(selectedUid);
    squadTracker.update(state, selectedUid);
    roundTracker.update(state);
    playGuide.update(state);
    paintBattlefieldLock();
    renderSetupBrief();
    renderSmokePrompt();
    sweepCamoContacts();
    sweepMines();
    sweepAutoDetonations();
    sweepMartyrdoms();
    // Redraw the Add tab only when what is on the board actually changed, so
    // dragging a unit or toggling a token does not reset the list underneath you.
    const sig = [...deployedCardCounts(state.tokens)]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) => `${id}:${n}`)
      .join(',');
    if (sig !== lastStockSig) {
      lastStockSig = sig;
      roster.render();
    }
  }

  function renderAll(): void {
    applyBoardTheme();
    board.renderTerrain(currentTerrain(), editor.active);
    board.renderMarkers(state.markers ?? []);
    board.renderTaskItems(normaliseTasks(state.tasks).items, zoneCentre);
    renderZoneOverlay();
    onChanged();
    board.refit();
  }

  // ---------- left rail tabs ----------
  //
  // Setup and Dice. The battlefield is something you settle once, so Setup is
  // where an empty board opens and Dice is where a board with units on it does;
  // after that the choice is the player's and it is remembered. The inspect box
  // belongs to neither — it sits under both and answers whichever is open.
  const LEFT_TAB_KEY = 'ember-left-tab';

  function showLeftTab(name: 'setup' | 'dice', remember = true): void {
    document.querySelectorAll<HTMLButtonElement>('#left-tabs button')
      .forEach((b) => b.classList.toggle('active', b.dataset.ltab === name));
    document.querySelectorAll<HTMLElement>('.left-tab')
      .forEach((s) => s.classList.toggle('active', s.id === `ltab-${name}`));
    if (remember) {
      try { localStorage.setItem(LEFT_TAB_KEY, name); } catch { /* private mode */ }
    }
  }
  document.querySelectorAll<HTMLButtonElement>('#left-tabs button').forEach((b) =>
    b.addEventListener('click', () => showLeftTab(b.dataset.ltab as 'setup' | 'dice')),
  );
  {
    let want: 'setup' | 'dice' | null = null;
    // 'play' is what this tab was called for one afternoon; treat it as Dice
    // rather than dropping a returning player onto Setup for no reason.
    try {
      const saved = localStorage.getItem(LEFT_TAB_KEY);
      want = saved === 'play' ? 'dice' : (saved as 'setup' | 'dice' | null);
    } catch { want = null; }
    showLeftTab(want ?? (state.tokens.length ? 'dice' : 'setup'), false);
  }

  // ---------- the board's shortcut strip ----------
  //
  // Hiding it is a preference, so it persists; a guided instruction ignores the
  // preference, because that is the app asking a question rather than telling
  // the player something they already know.
  const HINT_KEY = 'ember-hint-keys';
  {
    const bar = document.getElementById('hintbar');
    const setKeys = (on: boolean, remember = true) => {
      bar?.classList.toggle('keys-off', !on);
      if (remember) {
        try { localStorage.setItem(HINT_KEY, on ? '1' : '0'); } catch { /* private mode */ }
      }
    };
    document.getElementById('hint-hide')?.addEventListener('click', () => setKeys(false));
    document.getElementById('hint-show')?.addEventListener('click', () => setKeys(true));
    let saved: string | null = null;
    try { saved = localStorage.getItem(HINT_KEY); } catch { saved = null; }
    setKeys(saved !== '0', false);
  }

  // ---------- sidebar tabs ----------

  function showSideTab(name: 'squad' | 'add' | 'details' | 'combat'): void {
    document.querySelectorAll<HTMLButtonElement>('#side-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll<HTMLElement>('.side-tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
  }
  document.querySelectorAll<HTMLButtonElement>('#side-tabs button').forEach((b) =>
    b.addEventListener('click', () => showSideTab(b.dataset.tab as 'squad' | 'add' | 'details' | 'combat')),
  );

  function renderCombatIdle(): void {
    const body = document.getElementById('combat-body')!;
    body.innerHTML = `<p class="dim combat-idle">No attack in progress. Pick a unit, then use
      <b>⌖ Attack…</b> or <b>💥 Detonate…</b> on one of its actions in the Details tab.</p>`;
  }

  function renderUnitLog(): void {
    const host = document.getElementById('unit-log')!;
    const t = state.tokens.find((x) => x.uid === selectedUid);
    if (!t) {
      host.innerHTML = `<h4 class="ul-head">Combat log</h4><p class="dim">Select a unit to see its combat log.</p>`;
      return;
    }
    const entries = t.log ?? [];
    const rows = entries
      .map((e, i) => ({ e, i }))
      .reverse()
      .map(({ e }) => `<div class="ul-row"><span class="ul-round">R${e.round}</span><span>${e.text}</span></div>`)
      .join('');
    host.innerHTML = `<h4 class="ul-head">Combat log <span class="ul-who">${escapeHtml(t.label)}</span>
        ${entries.length ? '<button id="ul-clear" title="Clear this unit\'s log">Clear</button>' : ''}</h4>
      ${entries.length ? `<div class="ul-list">${rows}</div>` : '<p class="dim">Nothing has happened to this unit yet.</p>'}`;
    host.querySelector('#ul-clear')?.addEventListener('click', () => {
      t.log = [];
      renderUnitLog();
      save();
    });
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  }

  // ---------- toolbar ----------

  const mapSelect = document.getElementById('map-select') as HTMLSelectElement;
  function applyBoardTheme(): void {
    const id = boardTheme(state.boardTheme).id;
    state.boardTheme = id;
    board.setBoardTheme(id);
  }

  function populateMapSelect(): void {
    mapSelect.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Empty board';
    mapSelect.appendChild(empty);
    for (const m of data.terrain.maps) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name.en || m.id;
      mapSelect.appendChild(o);
    }
    for (const name of Object.keys(loadCustomMaps()).sort()) {
      const o = document.createElement('option');
      o.value = `custom:${name}`;
      o.textContent = `★ ${name}`;
      mapSelect.appendChild(o);
    }
    mapSelect.value = state.map;
    if (mapSelect.value !== state.map) {
      state.map = '';
      mapSelect.value = '';
    }
  }
  populateMapSelect();
  mapSelect.addEventListener('change', () => {
    const v = perform(data, state, { kind: 'configureTable', seat: 's1', map: mapSelect.value });
    if (!v.ok) {
      mapSelect.value = state.map;
      return;
    }
    adoptMapZones();
    save();
    renderAll();
  });

  // A custom map carries its own zones and deployment strips, so switching to one
  // picks them up rather than leaving whatever overlay happened to be selected.
  function adoptMapZones(): void {
    const map = state.map ?? '';
    if (!map.startsWith('custom:')) return;
    const name = map.slice(7);
    const painted = loadCustomMaps()[name];
    if (!painted) return;
    const has = painted.zones.some((z) => z.cells.length) || painted.deploy.black.length || painted.deploy.white.length;
    if (!has) return;
    if (state.zoneSet === `custom:${name}`) return;
    state.zoneSet = `custom:${name}`;
    state.showZones = true;
  }

  document.getElementById('btn-mapedit')!.addEventListener('click', () => {
    if (editor.active) exitEditor();
    else enterEditor();
  });

  function openMapManager(): void {
    document.getElementById('map-dialog')?.remove();
    const maps = loadCustomMaps();
    const names = Object.keys(maps).sort();
    const dlg = document.createElement('div');
    dlg.id = 'map-dialog';
    const rows = names
      .map((n) => {
        const map = maps[n];
        const pieces = map.pieces.length;
        const zones = map.zones.filter((z) => z.cells.length).length;
        const spawns = map.deploy.black.length || map.deploy.white.length;
        const extra = [zones ? `${zones} zone${zones === 1 ? '' : 's'}` : '', spawns ? 'deployment zones' : ''].filter(Boolean);
        const scn = n.startsWith('[scn] ');
        const inUse = state.map === `custom:${n}`;
        return `<div class="map-row">
          <div class="map-info">
            <b>${scn ? n.slice(6) : n}</b>
            <span class="dim">${scn ? 'from a scenario' : 'saved by you'} · ${pieces} piece${pieces === 1 ? '' : 's'}${extra.length ? ` · ${extra.join(' · ')}` : ''}${inUse ? ' · in use now' : ''}</span>
          </div>
          <button class="map-del" data-name="${n.replace(/"/g, '&quot;')}">Delete</button>
        </div>`;
      })
      .join('');
    const scnCount = names.filter((n) => n.startsWith('[scn] ')).length;
    dlg.innerHTML = `<div class="scn-panel">
      <button id="map-close" class="dlg-close" title="Close">✕</button>
      <div class="inv-head"><b>Map settings</b></div>
      <div class="map-board">
        <label for="board-select">Board style</label>
        <select id="board-select">${BOARD_THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
      </div>
      ${
        names.length
          ? `<p class="dim">A saved map holds its terrain and any zones you painted into it. Those zones show up in the toolbar's Zones list, so you can put them on any board. Loading a scenario saves its map here too; deleting one only removes it from this list, the scenario itself still loads fine.</p>
             <div class="scn-list">${rows}</div>
             ${scnCount > 1 ? `<div class="map-bulk"><button id="map-del-scn">Delete all ${scnCount} scenario maps</button></div>` : ''}`
          : '<p class="dim">No saved maps yet. Build one in the map editor, where you can also paint objective zones and deployment zones, or load a scenario.</p>'
      }
    </div>`;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('#map-close')!.addEventListener('click', () => dlg.remove());

    const boardSelect = dlg.querySelector<HTMLSelectElement>('#board-select')!;
    boardSelect.value = boardTheme(state.boardTheme).id;
    boardSelect.addEventListener('change', () => {
      state.boardTheme = boardSelect.value;
      board.setBoardTheme(boardSelect.value);
      save();
    });

    const dropMaps = (victims: string[]): void => {
      for (const n of victims) {
        deleteCustomMap(n);
        if (state.map === `custom:${n}`) state.map = '';
        if (state.zoneSet === `custom:${n}`) state.zoneSet = '';
      }
      save();
      populateMapSelect();
      renderAll();
      dlg.remove();
      openMapManager();
    };

    dlg.querySelectorAll<HTMLButtonElement>('.map-del').forEach((b) =>
      b.addEventListener('click', async () => {
        const name = b.dataset.name!;
        const inUse = state.map === `custom:${name}`;
        const ok = await confirmDialog({
          title: `Delete "${name.startsWith('[scn] ') ? name.slice(6) : name}"?`,
          body: inUse
            ? 'This map is on the board right now, so the board will go back to an empty grid. Units and markers stay where they are.'
            : 'The saved map is removed from this browser. Units on the board are left alone.',
          confirmLabel: 'Delete map',
          danger: true,
        });
        if (ok) dropMaps([name]);
      }),
    );
    dlg.querySelector('#map-del-scn')?.addEventListener('click', async () => {
      const victims = names.filter((n) => n.startsWith('[scn] '));
      const ok = await confirmDialog({
        title: `Delete all ${victims.length} scenario maps?`,
        body: 'These are the boards saved automatically when you loaded a scenario. Loading that scenario again recreates its map, so nothing is lost for good.',
        confirmLabel: 'Delete them',
        danger: true,
      });
      if (ok) dropMaps(victims);
    });
    document.body.appendChild(dlg);
  }

  document.getElementById('btn-mapmanage')!.addEventListener('click', openMapManager);

  // ---------- zone sets ----------

  function activeMission(): (typeof data.missions.cards)[number] | undefined {
    return state.mission ? data.missions.cards.find((m) => m.id === state.mission) : undefined;
  }

  function currentCustomMap(): CustomMap | null {
    return state.map.startsWith('custom:') ? loadCustomMap(state.map.slice(7)) : null;
  }

  // printedZones and printedDeployment moved to overlays.ts, shared with the
  // Match Centre so both pages draw the identical battlefield.

  function paintedShapes(map: CustomMap | null): { zones: BoardZone[]; deploy: BoardDeployment | null } {
    const shape = (cells: { col: number; row: number }[], label: string) => (cells.length ? { cells, label } : undefined);
    const zones = (map?.zones ?? []).filter((z) => z.cells.length).map((z) => ({ name: z.name, cells: z.cells }));
    const black = shape(map?.deploy.black ?? [], 'BLACK');
    const white = shape(map?.deploy.white ?? [], 'WHITE');
    return { zones, deploy: black || white ? { black, white } : null };
  }

  function resolveZoneSet(id: string): { zones: BoardZone[]; deploy: BoardDeployment | null } {
    if (id.startsWith('custom:')) return paintedShapes(loadCustomMaps()[id.slice(7)] ?? null);
    return resolveZoneSetData(data, id);
  }

  // Which sides have designated each Tactical Zone, so the board can show it.
  function claimedZones(): Record<string, Side[]> {
    const out: Record<string, Side[]> = {};
    const zone = normaliseTasks(state.tasks).zone;
    for (const side of ['s1', 's2'] as const) {
      const id = zone[side];
      if (!id) continue;
      // Designations are stored by zone id; the board draws zones by name.
      const name = data.zoneData.zones.find((z) => z.id === id)?.name ?? id;
      (out[name] ??= []).push(side);
    }
    return out;
  }

  function overlayZones(): BoardZone[] {
    if (editor.active) return editor.zones.filter((z) => z.cells.length).map((z) => ({ name: z.name, cells: z.cells }));
    return state.showZones === false ? [] : resolveZoneSet(state.zoneSet ?? '').zones;
  }

  function overlayDeployment(): BoardDeployment | null {
    if (editor.active) return paintedShapes({ pieces: [], zones: [], deploy: editor.deploy }).deploy;
    return state.showZones === false ? null : resolveZoneSet(state.zoneSet ?? '').deploy;
  }

  const BOARD_SETS = [
    { id: 'board:zones+strips', label: 'All nine zones + 2x12 strips', short: 'Zones + 2x12' },
    { id: 'board:zones+corners', label: 'All nine zones + 3x5 corners', short: 'Zones + 3x5' },
    { id: 'board:zones', label: 'All nine zones, no deployment', short: 'Nine zones' },
    { id: 'board:strips', label: 'Deployment only: 2x12 strips', short: '2x12 strips' },
    { id: 'board:corners', label: 'Deployment only: 3x5 corners', short: '3x5 corners' },
  ];

  const zoneSelect = document.getElementById('zone-select') as HTMLSelectElement;

  function zoneSetLabel(id: string, short = false): string {
    if (!id) return 'No zones';
    const preset = BOARD_SETS.find((b) => b.id === id);
    if (preset) return short ? preset.short : preset.label;
    if (id.startsWith('mission:')) {
      const name = data.missions.cards.find((m) => m.id === id.slice(8))?.name ?? 'Main Task';
      return short ? (name.split(': ')[1] ?? name) : name;
    }
    if (id.startsWith('custom:')) return id.slice(7).replace(/^\[scn\] /, '');
    return 'No zones';
  }

  function populateZoneSelect(): void {
    zoneSelect.replaceChildren();
    const opt = (value: string, text: string, into: HTMLElement) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      into.appendChild(o);
    };
    const group = (label: string) => {
      const g = document.createElement('optgroup');
      g.label = label;
      zoneSelect.appendChild(g);
      return g;
    };
    opt('', 'No zones', zoneSelect);
    const printed = group('Printed board');
    for (const b of BOARD_SETS) opt(b.id, b.label, printed);
    const missions = group('Main Task cards');
    for (const m of data.missions.cards) {
      const dep = data.zoneData.deployments.find((d) => d.id === data.zoneData.missionDeployment[m.id]);
      opt(`mission:${m.id}`, `${m.name}${dep ? ` (${dep.id === 'strips' ? '2x12' : '3x5'})` : ''}`, missions);
    }
    const maps = loadCustomMaps();
    const painted = Object.keys(maps)
      .filter((n) => maps[n].zones.some((z) => z.cells.length) || maps[n].deploy.black.length || maps[n].deploy.white.length)
      .sort();
    if (painted.length) {
      const mine = group('Zones you painted');
      for (const n of painted) {
        const m = maps[n];
        const zn = m.zones.filter((z) => z.cells.length).length;
        const bits = [zn ? `${zn} zone${zn === 1 ? '' : 's'}` : '', m.deploy.black.length || m.deploy.white.length ? 'deploy' : ''].filter(Boolean);
        opt(`custom:${n}`, `★ ${n.replace(/^\[scn\] /, '')} (${bits.join(', ')})`, mine);
      }
    }
    const want = state.zoneSet ?? '';
    zoneSelect.value = want;
    if (zoneSelect.value !== want) {
      state.zoneSet = '';
      zoneSelect.value = '';
    }
  }

  // The map and zone pickers are frozen for the life of a game, so nobody can
  // change the battlefield after deployment or between rounds.
  // The Setup tab's headline: what this board IS, before you read a control.
  // Read off the selects rather than re-derived, so it can never disagree with
  // the pickers sitting under it.
  function renderSetupBrief(): void {
    const host = document.getElementById('setup-brief');
    if (!host) return;
    const mapName = mapSelect.options[mapSelect.selectedIndex]?.text ?? 'Empty board';
    const zones = zoneSetLabel(state.zoneSet ?? '');
    const units = state.tokens.filter((t) => t.deployed !== false && t.kind !== 'projectile').length;
    const scale = SCALES.find((s) => s.id === (state.scale ?? 'standard'))?.name ?? '';
    const terrain = currentTerrain().length;
    host.innerHTML = `<div class="brief-map">${escapeHtml(mapName)}</div>
      <div class="brief-sub">${escapeHtml(zones)}</div>
      <div class="brief-stat">${units} unit${units === 1 ? '' : 's'} · ${terrain} terrain · ${escapeHtml(scale)}</div>`;
  }

  function paintBattlefieldLock(): void {
    const setup = normaliseSetup(state.setup);
    // Two levels. The map and zone pickers are open during the opening stage,
    // since that is where the battlefield is agreed, then frozen. The tools that
    // replace the whole board are shut for the entire game, because a Mission or
    // Scenario would swap the map and units out from under the lock.
    const locked = battlefieldLocked(setup);
    // The map is settled first, but the Tasks are chosen AFTER the roll
    // (FAQ P1), so the Missions dialog and the zone overlay stay open through
    // the tasks stage and freeze when the edges are picked.
    const tl = tasksLocked(setup);
    const why = 'Locked while a game is running. Press End game to change it.';
    mapSelect.disabled = locked;
    mapSelect.title = locked ? why : '';
    zoneSelect.disabled = tl;
    zoneSelect.title = tl ? why : '';
    const zoneBtn = document.getElementById('btn-zones') as HTMLButtonElement | null;
    if (zoneBtn) zoneBtn.disabled = tl && !state.zoneSet;
    for (const id of ['btn-scenarios', 'btn-mapedit', 'btn-mapmanage', 'btn-import-squad']) {
      const b = document.getElementById(id) as HTMLButtonElement | null;
      if (!b) continue;
      b.disabled = locked;
      b.title = locked ? why : '';
    }
    const missions = document.getElementById('btn-missions') as HTMLButtonElement | null;
    if (missions) {
      missions.disabled = tl;
      missions.title = tl ? why : '';
    }
  }

  function renderZoneOverlay(): void {
    board.renderZones(overlayZones(), overlayDeployment(), claimedZones());
    populateZoneSelect();
    paintBattlefieldLock();
    const on = !!state.zoneSet && state.showZones !== false;
    const btn = document.getElementById('btn-zones')!;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
    btn.classList.toggle('empty', !state.zoneSet);
    btn.textContent = state.zoneSet ? (on ? zoneSetLabel(state.zoneSet, true) : 'Zones') : 'Empty';
    btn.title = state.zoneSet
      ? `${on ? 'Hide' : 'Show'} the overlay: ${zoneSetLabel(state.zoneSet)}`
      : 'Nothing to show. Pick a zone set from the Zones list in the toolbar first.';
  }

  // Changing the zone set changes the MISSION, and the Task Items on the board —
  // Black Boxes, Terminals, Control dials — belong to the mission that placed
  // them. Sending only `zoneSet` left them sitting there with nothing to score
  // for, and no way to remove them short of clearing the units too. Mission and
  // tasks now travel with the change, exactly as the Missions dialog sends them.
  // Returns whether the change went through, so a caller that has more to do
  // after it — the Missions dialog switches to the briefing tab and closes —
  // can stop when the command was refused.
  // On refusal the reason is kept here for the caller to show — the Missions
  // dialog used to swallow it, so a refused pick looked like a button that
  // simply did nothing.
  let zoneSetRefusal = '';
  function setZoneSet(id: string): boolean {
    const mission = id.startsWith('mission:') ? data.missions.cards.find((m) => m.id === id.slice(8)) : undefined;
    const v = perform(data, state, {
      kind: 'configureTable', seat: 's1', zoneSet: id,
      mission: mission?.id ?? null,
      tasks: mission ? taskItemsFor(data.zoneData.zones, mission) : null,
    });
    zoneSetRefusal = v.ok ? '' : v.why ?? 'That change was refused.';
    if (!v.ok) return false;
    state.showZones = !!id;
    save();
    renderZoneOverlay();
    // Picking a Mission here has to leave the table in the same shape the
    // Missions dialog leaves it in, or a VIP mission arrives with its Task
    // Items placed and nobody named to be hunted.
    if (mission) {
      if (mission.family === 'vip') void designateCommanders();
      document.getElementById('details-body')!.replaceChildren(missionBriefing(mission));
    }
    // The guide reports the chosen battlefield, so it has to hear about this.
    onChanged();
    return true;
  }

  zoneSelect.addEventListener('change', () => setZoneSet(zoneSelect.value));

  document.getElementById('btn-zones')!.addEventListener('click', () => {
    if (!state.zoneSet) return;
    state.showZones = state.showZones === false;
    save();
    renderZoneOverlay();
  });

  function openMissions(): void {
    document.getElementById('mis-dialog')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'mis-dialog';
    const rows = data.missions.cards
      .map((m, i) => {
        const dep = data.zoneData.deployments.find((d) => d.id === data.zoneData.missionDeployment[m.id]);
        const live = state.zoneSet === `mission:${m.id}`;
        return `<div class="scn-row${live ? ' current' : ''}" data-mis="${escapeHtml(m.id)}">
          <div class="scn-info"><b>${m.name}</b><br><span class="dim">${(m.zones ?? []).join(', ') || 'no tactical zones'} · ${dep?.name ?? 'deployment not known'}</span></div>
          <button data-i="${i}" class="scn-load">${live ? 'On the board' : 'Use it'}</button>
        </div>`;
      })
      .join('');
    dlg.innerHTML = `<div class="scn-panel">
      <button id="mis-close" class="dlg-close" title="Close">✕</button>
      <div class="inv-head"><b>Main Task cards</b></div>
      <p class="dim">Picking one opens its briefing and draws its tactical zones and deployment zones on the board. Main Task cards do not specify terrain, so load a Battlefield Card layout or build your own map. Every zone set, including plain deployment zones and your own painted ones, is also in the Zones list in the toolbar.</p>
      <div class="scn-list">${rows}</div>
      <!-- The card itself, hung off the panel's own left edge. A Main Task's
           zone layout and its scoring are the whole decision, and a name plus a
           zone list conveys neither - so hovering a row puts the printed card
           up beside the list. Inside the panel so it travels with it, the way
           the other attached previews on this page do. -->
      <figure id="mis-preview" hidden><img alt=""><figcaption></figcaption></figure>
    </div>`;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('#mis-close')!.addEventListener('click', () => dlg.remove());

    // Hovering a row shows that Main Task's card. The image is only asked for
    // on hover rather than being preloaded sixteen times over, and a mission
    // whose scan is missing hides the frame instead of leaving a broken box.
    const fig = dlg.querySelector<HTMLElement>('#mis-preview')!;
    const img = fig.querySelector('img')!;
    const cap = fig.querySelector('figcaption')!;
    img.addEventListener('error', () => { fig.hidden = true; });
    const show = (row: HTMLElement): void => {
      const m = data.missions.cards.find((x) => x.id === row.dataset.mis);
      if (!m) return;
      cap.textContent = m.name;
      fig.hidden = false;
      img.src = missionImageUrl(m.id);
    };
    dlg.querySelectorAll<HTMLElement>('.scn-row').forEach((row) => {
      row.addEventListener('mouseenter', () => show(row));
      // Keyboard and touch reach it through focus, so the preview is not a
      // mouse-only affordance.
      row.addEventListener('focusin', () => show(row));
    });
    dlg.querySelector('.scn-list')!.addEventListener('mouseleave', () => { fig.hidden = true; });
    // A refused pick says why, in the dialog itself. It used to return in
    // silence, and a silent refusal is indistinguishable from a broken button —
    // which is exactly what it got reported as.
    const note = document.createElement('p');
    note.className = 'mis-note';
    note.hidden = true;
    dlg.querySelector('.scn-list')!.before(note);
    dlg.querySelectorAll<HTMLButtonElement>('.scn-load').forEach((b) =>
      b.addEventListener('click', () => {
        const m = data.missions.cards[Number(b.dataset.i)];
        // Straight through setZoneSet rather than repeating what it does. This
        // handler used to send the same command itself and then forget both
        // save() and onChanged(), so the pick landed in state and nothing on
        // the page moved. Two paths doing one job is what let them drift.
        if (!setZoneSet(`mission:${m.id}`)) {
          note.textContent = zoneSetRefusal;
          note.hidden = false;
          return;
        }
        note.hidden = true;
        // The dialog stays up and answers for itself: the picked row flips to
        // "On the board" and the board redraws behind it, so the click is seen
        // to land rather than taken on faith. Closing it here used to be the
        // answer, but a dialog that vanishes reads as dismissed, not done.
        dlg.querySelectorAll<HTMLElement>('.scn-row').forEach((row) => {
          const live = row.dataset.mis === m.id;
          row.classList.toggle('current', live);
          const btn = row.querySelector('.scn-load')!;
          btn.textContent = live ? 'On the board' : 'Use it';
        });
        // The briefing is already in the side panel (setZoneSet put it there);
        // fronting the tab means it is showing when the player closes this.
        showSideTab('details');
      }),
    );
    document.body.appendChild(dlg);
  }
  document.getElementById('btn-missions')!.addEventListener('click', openMissions);

  // Secondary Task selection (5.2.3). Open information, so both picks are made
  // here and shown to everyone. A card that needs a designated Unit or Zone asks
  // for it straight away, because the designation is part of Task Setup.
  async function pickSecondary(side: Side): Promise<void> {
    const tasks = normaliseTasks(state.tasks);
    // Both sides may take the same Secondary, so nothing is removed from the list.
    const open = data.secondary;
    // A card that designates a Tactical Area needs the board to have some. The
    // Main Task decides that, and VIP places none at all.
    const mission = state.mission ? data.missions.cards.find((m) => m.id === state.mission) : undefined;
    const hasZones = (mission?.zones ?? []).length > 0;
    const id = await choiceDialog({
      title: `${squadLabel(side)}: choose a Secondary Task`,
      body: 'Both players pick one and show it to the other, so this is open information.',
      stacked: true,
      choices: open.map((c) => ({
        id: c.id,
        label: `${c.name} · ${c.vp ?? 0} VP`,
        image: secondaryImageUrl(c.id),
        disabled: c.designate === 'zone' && !hasZones,
        note: c.designate === 'zone' && !hasZones ? 'needs a Main Task with Tactical Zones' : undefined,
      })),
    });
    const card = open.find((c) => c.id === id);
    if (!card) return;
    if (!perform(data, state, { kind: 'pickSecondary', seat: side, cardId: card.id }).ok) return;

    if (card.designate && card.designate !== 'none') {
      await designateFor(side, card);
    }
    onChanged();
  }

  async function designateFor(side: Side, card: SecondaryTask): Promise<void> {
    const enemy: Side = side === 's1' ? 's2' : 's1';
    if (card.designate === 'zone') {
      // Only zones the Main Task actually placed are on the board, so the rest
      // would be designating somewhere the players cannot see.
      const mission = state.mission ? data.missions.cards.find((m) => m.id === state.mission) : undefined;
      const placed = new Set(mission?.zones ?? []);
      const zones = data.zoneData.zones.filter((z) => placed.has(z.name) || placed.has(z.id));
      const id = await choiceDialog({
        title: `${card.name}: which Tactical Zone?`,
        body: card.setup,
        stacked: true,
        choices: zones.map((z) => ({ id: z.id, label: z.name })),
      });
      // Through the command, like the Match Centre: a designation is a shared
      // fact that scoring reads, and writing state.tasks by hand never reached
      // the other client in an online freeplay room.
      if (id) perform(data, state, { kind: 'designateTask', seat: side, what: 'zone', for: side, zone: id });
      return;
    }
    // The Unit is stored against the side that SCORES the card, so two cards can
    // never fight over one key. Who OWNS the named Mech still differs by card:
    // enemy-own-mech has the opponent name one of theirs, enemy-mech has you
    // name one of theirs, own-mech is your own.
    const owner: Side = card.designate === 'enemy-mech' || card.designate === 'enemy-own-mech' ? enemy : side;
    const mechs = state.tokens.filter((t) => t.kind === 'mech' && t.side === owner);
    if (!mechs.length) {
      await alertDialog({
        title: 'Nothing to designate',
        body: `${card.name} needs a Mech named, and ${squadLabel(owner)} has none on the board yet. Add the squads first, then pick the Task again.`,
      });
      return;
    }
    const uid = await choiceDialog({
      title: `${card.name}: which Mech?`,
      body: card.setup,
      choices: mechs.map((t) => ({ id: String(t.uid), label: t.label })),
    });
    const pick = mechs.find((t) => String(t.uid) === uid);
    // `for` is the side that SCORES the card, which is not always the side
    // that owns the named Mech — Behead has the opponent name one of theirs.
    if (pick) perform(data, state, { kind: 'designateTask', seat: side, what: 'target', for: side, uid: pick.uid });
  }

  // The VIP mission needs both Commanders named, one per side, before there is
  // anything to assassinate (5.2.3). Stored by the side that OWNS the Mech.
  async function designateCommanders(): Promise<void> {
    for (const side of ['s1', 's2'] as Side[]) {
      const mechs = state.tokens.filter((t) => t.kind === 'mech' && t.side === side);
      if (!mechs.length) continue;
      const uid = await choiceDialog({
        title: `${squadLabel(side)}: designate your Commander`,
        body: 'Destroying the enemy Commander scores 10 Victory Points and ends the game immediately.',
        choices: mechs.map((t) => ({ id: String(t.uid), label: t.label })),
      });
      const pick = mechs.find((t) => String(t.uid) === uid);
      // Each side names its own, so seat and `for` are the same here.
      if (pick) perform(data, state, { kind: 'designateTask', seat: side, what: 'leader', for: side, uid: pick.uid });
    }
    onChanged();
  }

  // The middle Large Grid of a Tactical Zone, used to sit a Terminal or a
  // Control dial where it reads as covering the whole Zone.
  // Shared with the Match Centre, so an Item cannot land in one place here and
  // another place there.
  const zoneCentre = (zoneId: string) => zoneCentreGrid(data.zoneData.zones, zoneId);

  // Task Setup (5.3): the Main Task names the Tactical Zones its Items go in, so
  // Moved to tasks.ts so the Match Centre derives the identical items; the
  // call sites here pass data.zoneData.zones.

  function showMissionCard(m: (typeof data.missions.cards)[number]): void {
    document.querySelector('.mis-lightbox')?.remove();
    const box = document.createElement('div');
    box.className = 'mis-lightbox';
    box.innerHTML = `<div class="mis-lightbox-inner">
        <button class="dlg-close" title="Close">✕</button>
        <img src="${missionImageUrl(m.id)}" alt="${m.name} card">
        <p>${m.name}${m.nameKo ? ` · ${m.nameKo}` : ''}</p>
      </div>`;
    const close = () => {
      box.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      close();
    };
    box.addEventListener('click', (ev) => {
      if (ev.target === box || (ev.target as HTMLElement).closest('.dlg-close')) close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
  }

  function missionBriefing(m: (typeof data.missions.cards)[number]): HTMLElement {
    const dep = data.zoneData.deployments.find((d) => d.id === data.zoneData.missionDeployment[m.id]);
    const div = document.createElement('div');
    div.className = 'scn-brief';
    div.innerHTML = `<h3>${m.name}</h3>
      ${m.nameKo ? `<p class="dim">${m.nameKo}</p>` : ''}
      <button class="mis-card-thumb" title="Tap for the full card">
        <img src="${missionImageUrl(m.id)}" alt="${m.name} card" loading="lazy">
        <span>Tap to enlarge</span>
      </button>
      <p><b>Setup.</b> ${m.setup}</p>
      <p><b>Scoring.</b> ${m.scoring}</p>
      ${dep ? `<p><b>Deployment.</b> ${dep.name}. ${dep.note ?? ''}</p>` : ''}
      ${(m.zones ?? []).length ? `<h4>Tactical zones</h4><ul>${(m.zones ?? []).map((z) => `<li>${z}</li>`).join('')}</ul>` : ''}
      <p class="dim">The overlay shows these zones on the board. Terrain is not part of a Main Task card, so place it from a Battlefield Card or your own map.</p>`;
    div.querySelector('.mis-card-thumb')!.addEventListener('click', () => showMissionCard(m));
    return div;
  }
  document.getElementById('btn-inventory')!.addEventListener('click', () => inventory.openDialog());

  // ---------- scenarios ----------

  const scenarios = await loadScenarios();
  const replays = await loadReplays();

  function scenarioBriefing(scn: Scenario): HTMLElement {
    const div = document.createElement('div');
    div.className = 'scn-brief';
    div.innerHTML = `<h3>${scn.name}</h3>
      ${scn.subtitle ? `<p class="dim">${scn.subtitle}</p>` : ''}
      ${scn.description ? `<p>${scn.description}</p>` : ''}
      ${scn.rounds ? `<p><b>${scn.rounds} rounds.</b></p>` : ''}
      ${
        scn.scoring?.length
          ? `<h4>Scoring</h4><ul>${scn.scoring.map((s) => `<li><b>${s.points}</b> ${s.name}${s.note ? ` <span class="dim">(${s.note})</span>` : ''}</li>`).join('')}</ul>`
          : ''
      }
      ${scn.simplifications?.length ? `<h4>First-run simplifications</h4><ul>${scn.simplifications.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''}
      ${scn.notes?.length ? `<h4>Notes</h4><ul>${scn.notes.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''}`;
    return div;
  }

  // ---------- scripted replay ----------

  const replayBar = document.getElementById('replay-bar')!;
  let replay: ReplayPlayer | null = null;
  let beforeReplay: string | null = null;

  function replayNarration(script: ReplayScript, step: ReplayStep | null, tally: ReplayTally): HTMLElement {
    const div = document.createElement('div');
    div.className = 'scn-brief rp-brief';
    if (!step) {
      div.innerHTML = `<h3>${escapeHtml(script.title)}</h3>${(script.intro ?? []).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
        <p class="dim">Press play, or step through one beat at a time.</p>`;
      return div;
    }
    const vp = `<p class="rp-vp"><b>VP</b> <span class="rp-red">Red ${tally.vp.s2}</span> · <span class="rp-blue">Blue ${tally.vp.s1}</span></p>`;
    div.innerHTML = `<h3>${escapeHtml(step.title)}</h3>
      <p class="dim">Round ${step.round} · ${PHASES[step.phase] ?? ''} Phase</p>
      ${(step.say ?? []).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
      ${step.dice?.reading ? `<p class="rp-read"><b>Reading the dice.</b> ${escapeHtml(step.dice.reading)}</p>` : ''}
      ${tally.scored.length ? vp : ''}`;
    return div;
  }

  function renderReplayBar(): void {
    if (!replay) {
      replayBar.hidden = true;
      return;
    }
    const r = replay;
    const at = r.index;
    const step = at >= 0 ? r.script.steps[at] : null;
    replayBar.hidden = false;
    replayBar.innerHTML = `
      <b>DEMO</b>
      <div class="ed-line">
        <button id="rp-prev" title="Previous step"${at < 0 ? ' disabled' : ''}>◀</button>
        <button id="rp-play" class="ed-primary" title="${r.playing ? 'Pause' : 'Play'}">${r.playing ? '❚❚ Pause' : '▶ Play'}</button>
        <button id="rp-next" title="Next step"${at >= r.total - 1 ? ' disabled' : ''}>▶❙</button>
        <span class="rp-pos">${at + 1} / ${r.total}</span>
        <span class="rp-where">${step ? `R${step.round} · ${PHASES[step.phase] ?? ''}` : 'ready'}</span>
        <span class="ed-gap"></span>
        <label class="rp-speed">Speed
          <select id="rp-speed">
            <option value="5000"${r.stepSpeed === 5000 ? ' selected' : ''}>Slow</option>
            <option value="3200"${r.stepSpeed === 3200 ? ' selected' : ''}>Normal</option>
            <option value="1800"${r.stepSpeed === 1800 ? ' selected' : ''}>Brisk</option>
          </select>
        </label>
        <button id="rp-restart" title="Back to the start">↺ Restart</button>
        <button id="rp-exit">Exit demo</button>
      </div>`;
    replayBar.querySelector('#rp-prev')!.addEventListener('click', () => r.prev());
    replayBar.querySelector('#rp-next')!.addEventListener('click', () => {
      r.pause();
      r.next();
      renderReplayBar();
    });
    replayBar.querySelector('#rp-play')!.addEventListener('click', () => {
      if (r.playing) r.pause();
      else r.play();
      renderReplayBar();
    });
    replayBar.querySelector('#rp-restart')!.addEventListener('click', () => {
      r.pause();
      r.goto(-1);
      tray.clear();
      document.getElementById('details-body')!.replaceChildren(replayNarration(r.script, null, r.tally));
      renderReplayBar();
    });
    replayBar.querySelector('#rp-exit')!.addEventListener('click', () => stopReplay());
    replayBar.querySelector<HTMLSelectElement>('#rp-speed')!.addEventListener('change', (ev) => {
      r.setSpeed(Number((ev.target as HTMLSelectElement).value));
      renderReplayBar();
    });
  }

  function startReplay(scn: Scenario, script: ReplayScript): void {
    if (editor.active) exitEditor();
    beforeReplay = JSON.stringify(state);
    replayActive = true;
    const result = instantiateScenario(scn, state, data);
    state.tokens = result.tokens;
    // A different board: every earlier snapshot belongs to a game that is gone.
    clearHistory();
    state.markers = result.markers;
    state.smoke = [];
    state.sideNames = result.sideNames;
    state.map = result.mapKey;
    state.removedTerrain = [];
    state.scenario = scn.id;
    state.round = { n: 1, phase: 0, firstPlayer: 's1' };
    state.commandTokens = { s1: 0, s2: 0 };
    state.scale = 'skirmish';
    state.roundLimit = scn.rounds ?? 3;
    selectedUid = null;
    populateMapSelect();
    board.panEnabled = true;

    replay = new ReplayPlayer(script, state, data, {
      onState: () => {
        board.renderTokens(state);
        board.renderMarkers(state.markers ?? []);
        board.renderTaskItems(normaliseTasks(state.tasks).items, zoneCentre);
        squadTracker.update(state, null);
        roundTracker.update(state);
      },
      onStep: (step, _i, _n, tally) => {
        document.getElementById('details-body')!.replaceChildren(replayNarration(script, step, tally));
        showSideTab('details');
        if (step.dice?.groups?.length) tray.showGroups(step.dice.groups);
        else if (step.dice?.roll?.length) tray.showFixed(step.dice.roll);
        else tray.clear();
        const first = (step.focus ?? [])[0];
        if (first) {
          const t = state.tokens.find((x) => {
            const raw = first.includes(':') ? first.split(':')[1] : first;
            const side = first.includes(':') ? first.split(':')[0] : null;
            return (!side || x.side === side) && x.label.toLowerCase().includes(raw.trim().toLowerCase());
          });
          board.setSelected(t?.uid ?? null);
        } else {
          board.setSelected(null);
        }
        renderReplayBar();
      },
      onFinish: () => {
        document.getElementById('details-body')!.replaceChildren(replayNarration(script, null, replay!.tally));
        renderReplayBar();
      },
    });
    renderAll();
    replay.goto(-1);
    tray.clear();
    document.getElementById('details-body')!.replaceChildren(replayNarration(script, null, replay.tally));
    showSideTab('details');
    renderReplayBar();
    document.body.classList.add('replaying');
  }

  function stopReplay(): void {
    replay?.stop();
    replay = null;
    replayActive = false;
    replayBar.hidden = true;
    document.body.classList.remove('replaying');
    tray.clear();
    board.setSelected(null);
    if (beforeReplay) {
      const prior = migrateState(JSON.parse(beforeReplay), data);
      if (prior) state = prior;
      beforeReplay = null;
    }
    selectedUid = null;
    populateMapSelect();
    panel.clear();
    document.getElementById('details-body')!.replaceChildren();
    showSideTab('squad');
    renderAll();
  }

  document.getElementById('btn-scenarios')!.addEventListener('click', () => {
    document.getElementById('scn-dialog')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'scn-dialog';
    dlg.innerHTML = `<div class="scn-panel">
      <button id="scn-close" class="dlg-close" title="Close">✕</button>
      <div class="inv-head"><b>Scenarios</b></div>
      ${scenarios.length ? '' : '<p class="dim">No scenarios found (data/scenarios.json missing).</p>'}
      <div class="scn-list">${scenarios
        .map(
          (s, i) => `<div class="scn-row">
            <div class="scn-info"><b>${s.name}</b><br><span class="dim">${s.subtitle ?? ''}</span></div>
            ${replays.some((r) => r.scenarioId === s.id) ? `<button data-i="${i}" class="scn-watch" title="Watch this game played out step by step">▶ Watch</button>` : ''}
            <button data-i="${i}" class="scn-load">Load</button>
          </div>`,
        )
        .join('')}</div>
    </div>`;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('#scn-close')!.addEventListener('click', () => dlg.remove());
    dlg.querySelectorAll<HTMLButtonElement>('.scn-watch').forEach((b) =>
      b.addEventListener('click', async () => {
        const scn = scenarios[Number(b.dataset.i)];
        const script = replays.find((r) => r.scenarioId === scn.id);
        if (!script) return;
        if (state.tokens.length) {
          const ok = await confirmDialog({
            title: `Watch "${script.title}"?`,
            body: 'This replaces whatever is on the board with the scenario setup, then plays the game out step by step.',
            confirmLabel: 'Watch it',
          });
          if (!ok) return;
        }
        dlg.remove();
        startReplay(scn, script);
      }),
    );
    dlg.querySelectorAll<HTMLButtonElement>('.scn-load').forEach((b) =>
      b.addEventListener('click', async () => {
        const scn = scenarios[Number(b.dataset.i)];
        if (state.tokens.length) {
          const ok = await confirmDialog({
            title: `Load "${scn.name}"?`,
            body: 'This replaces the units, terrain and objective markers currently on the board.',
            confirmLabel: 'Load scenario',
          });
          if (!ok) return;
        }
        const result = instantiateScenario(scn, state, data);
        state.tokens = result.tokens;
        state.markers = result.markers;
        state.smoke = [];
        state.sideNames = result.sideNames;
        state.map = result.mapKey;
        state.removedTerrain = [];
        state.scenario = scn.id;
        state.round = { n: 1, phase: 0, firstPlayer: 's1' };
        state.commandTokens = { s1: 0, s2: 0 };
        state.roundLimit = scn.rounds ?? 5;
        selectedUid = null;
        populateMapSelect();
        renderAll();
        panel.clear();
        document.getElementById('details-body')!.replaceChildren(scenarioBriefing(scn));
        showSideTab('details');
        dlg.remove();
        // No popup on load. What is left in `unmatched` is a second backpack or
        // a second same-hand weapon the booklet lists but a Mech has no slot
        // for, which nothing can fix, so raising it every time only worries a
        // player about a squad that is already correct. The notes stay in
        // scenarios.json for anyone reading the data.
      }),
    );
    document.body.appendChild(dlg);
  });

  function clearUnits(): void {
    state.tokens = [];
    state.smoke = [];
    state.sideNames = {};
    state.commandTokens = { s1: 0, s2: 0 };
    state.setup = null;
    // Tactics are held in hand rather than placed, so clearing the board left
    // them behind and the next squad started holding the last one's cards.
    state.tactics = { s1: [], s2: [] };
    state.tacticsPlayed = { s1: [], s2: [] };
    // Same trap, one layer down: the fielded roster outlives its units on
    // purpose, so taking the pieces off the table has to empty it by hand or
    // the next squad records the last one's cards as its own.
    state.fielded = { s1: {}, s2: {} };
    selectToken(null);
  }

  // Task Items are objectives too. They are drawn on the board like markers and
  // read like markers, so leaving them out meant a mission's Black Boxes could
  // only be removed by clearing EVERYTHING, units included. Scoring history is
  // left alone: this takes pieces off the table, it does not undo a game.
  function clearObjectives(): void {
    state.markers = [];
    if (state.tasks) state.tasks.items = [];
  }

  function clearTerrain(): void {
    state.map = '';
    state.removedTerrain = [];
    populateMapSelect();
  }

  // The zone set and the Mission are one choice — a Mission's zones arrive as
  // `mission:<id>` — so the Mission and its Task Items go with them.
  function clearZones(): void {
    state.zoneSet = '';
    state.showZones = false;
    state.mission = undefined;
    state.tasks = null;
  }

  // Multiplayer lives entirely behind this button. The tool has always worked
  // with no server at all, so nothing here is allowed to block start-up: the
  // account check runs in the background and simply reads as signed out if the
  // API cannot be reached.
  const emberApi = new EmberApi();

  // Networked play. Commands performed here are mirrored to the other player,
  // and theirs are applied through applyRemote so they do not bounce back.
  // Neither side trusts the other's rules engine — both run the same one.
  // A catch-up walks the board through the whole tail of history at once.
  // Drawing every step of it is what made rejoining a slideshow, so the screen
  // waits and is drawn once at the end.
  let catchingUp = false;

  const relay = new Relay(emberApi.base, {
    onCommand(cmd) {
      // Their move goes through the same rules ours does. A refusal is either
      // a modified client or two boards that have drifted, and refetching
      // settles which — so it is reported and then resynced rather than
      // quietly applied or quietly dropped.
      const verdict = applyRemote(data, state, cmd);
      if (!verdict.ok) {
        setHint(`⛔ Refused a move from the other player: ${verdict.why}`);
        relay.requestResync();
        return;
      }
      // None of what follows belongs in a replay: the commitments and reveals
      // are history being re-read, and answering them again would send this
      // client's reveal a second time.
      if (catchingUp) return;
      if (cmd.kind === 'revealTimings') auditReveal(cmd);
      // Their commitment may be the second one, which releases ours.
      if (cmd.kind === 'commitTimings') maybeReveal();
      onChanged();
    },
    onCatchUp(active) {
      catchingUp = active;
      if (active) {
        setHint('Catching up on the game so far…');
        return;
      }
      // Whole again: answer anything the replay walked past, then draw.
      maybeReveal();
      selectToken(null);
      renderAll();
      setHint('Caught up with the table.');
    },
    onCheckpoint(raw) {
      // A checkpoint carries the whole board, which would overwrite our own
      // dials with the blanks the other client holds for them. They are this
      // client's secret until the reveal, so they are put back afterwards.
      const seat = relay.state.seat;
      const keep = seat && !state.script?.revealed.includes(seat)
        ? state.tokens.filter((t) => t.side === seat).map((t) => ({ uid: t.uid, timing: t.timing }))
        : [];
      // migrateState rebuilds every field, so assigning over the live object
      // keeps every closure and component pointing at the same state.
      try {
        Object.assign(state, migrateState(raw, data));
      } catch {
        setHint('⛔ The board that arrived could not be read.');
        return;
      }
      for (const d of keep) {
        const t = state.tokens.find((x) => x.uid === d.uid);
        if (t) t.timing = d.timing;
      }
      if (catchingUp) return;
      selectToken(null);
      renderAll();
      setHint('Board received from the other player.');
    },
    onNeedCheckpoint() {
      relay.publishCheckpoint();
    },
    onClosed() {
      setHint('The table was closed by its host.');
    },
    // Dice that landed in the room. The roller already has them from its own
    // request; this is what puts the other player's roll on screen, so a roll
    // is something both watch rather than a number one reports to the other.
    onRolled(dice, seat, label, mine) {
      if (mine) return;
      tray.showFixed(dice.map((d) => ({ color: d.color as DieColor, face: d.face })));
      setHint(`${squadLabel(seat)} rolled${label ? ` · ${label}` : ''}`);
    },
    onChange(view) {
      // Drives the dial filter: with a seat set, the other squad's dials are
      // masked until they reveal.
      setLocalSeat(view.room ? view.seat : null);
      // A guest's table controls go quiet: the host sets up the table, and a
      // control that only mutates one board is how the playtest desynced.
      const guest = !!view.room && !view.host;
      for (const id of ['map-select', 'zone-select', 'btn-missions', 'btn-scenarios', 'btn-mapedit', 'btn-mapmanage', 'btn-import', 'btn-clear']) {
        const el = document.getElementById(id) as HTMLButtonElement | HTMLSelectElement | null;
        if (!el) continue;
        el.disabled = guest;
        if (guest) {
          if (el.dataset.tipSave === undefined) el.dataset.tipSave = el.title;
          el.title = 'The host sets up the table.';
        } else if (el.dataset.tipSave !== undefined) {
          el.title = el.dataset.tipSave;
          delete el.dataset.tipSave;
        }
      }
      roundTracker.hostLocked = guest;
      roundTracker.update(state);
      // The server rolls only while a networked game is running; a local game
      // keeps its own dice.
      const roller = view.room && view.seat
        ? (pool: Record<string, number>, tag?: string) => relay.rollDice(pool, tag)
        : null;
      attackHelper.roller = roller;
      electronicHelper.roller = roller;
      multiplayer.refresh();
      mpButton.classList.toggle('online', !!view.room);
      if (view.room) setHint(`Online room ${view.room.id}${view.seat ? ` · you are ${squadLabel(view.seat)}` : ' · spectating'}`);
    },
    // Nothing unrevealed goes over the wire. A checkpoint is the whole board,
    // so any dial belonging to a squad that has not revealed is stripped out
    // of the copy that leaves this client.
    snapshot: () => {
      const copy = JSON.parse(JSON.stringify(state)) as GameState;
      const revealed = state.script?.revealed ?? [];
      for (const t of copy.tokens) {
        if (t.kind === 'mech' && !revealed.includes(t.side)) t.timing = undefined;
      }
      return copy as unknown;
    },
  });
  onPerformed((cmd) => {
    // Secret commands never reach here — commands.ts withholds them, so the
    // rule cannot be lost by a change on this side.
    relay.publish(cmd);
    // Committing is what both sides are waiting on, so check straight away
    // whether that was the second one.
    if (cmd.kind === 'commitTimings') maybeReveal();
  });

  // ---------- networked dial secrecy (3.3) ----------

  // The salt behind this round's commitment. Kept out of GameState on purpose:
  // it is this client's secret until the reveal, and anything in GameState
  // ends up in a checkpoint.
  let dialSecret: { round: number; salt: string; dials: { uid: number; timing?: Timing }[] } | null = null;

  // The dial list and the hash moved to secrecy.ts, shared with the Match
  // Centre: a cross-page game must hash the same bytes on both ends.

  // Returns true when it took responsibility for confirming the dials, which
  // is only in a networked game; a local game locks them the usual way.
  function commitTimings(): boolean {
    const seat = relay.state.seat;
    if (!relay.state.room || !seat) return false;
    const sc = state.script;
    if (sc?.commits[seat]) return true;

    const dials = dialsOf(state, seat);
    const salt = newSalt();
    dialSecret = { round: state.round.n, salt, dials };
    void hashDials(salt, dials).then((hash) => {
      perform(data, state, { kind: 'commitTimings', seat, hash });
      onChanged();
      setHint('Dials committed. They stay hidden until the other player commits too.');
    });
    return true;
  }

  // Sends our dials once, and only once both squads have committed. Called
  // after either commitment lands, from whichever side completed the pair.
  function maybeReveal(): void {
    const seat = relay.state.seat;
    const sc = state.script;
    if (!seat || !sc || !dialSecret || dialSecret.round !== state.round.n) return;
    if (!sc.commits.s1 || !sc.commits.s2) return;
    if (sc.revealed.includes(seat)) return;
    perform(data, state, { kind: 'revealTimings', seat, salt: dialSecret.salt, dials: dialSecret.dials });
    onChanged();
  }

  // Their reveal is applied as it arrives so command order is preserved, then
  // checked against what they committed to. A mismatch means the dials they
  // showed are not the dials they chose, which is worth saying loudly.
  function auditReveal(cmd: Extract<Command, { kind: 'revealTimings' }>): void {
    const promised = state.script?.commits[cmd.seat];
    if (!promised) return;
    void hashDials(cmd.salt, cmd.dials).then((actual) => {
      if (actual !== promised) {
        void alertDialog({
          title: 'Their dials do not match what they committed to',
          body: `${squadLabel(cmd.seat)} published Timing Dials that do not match the commitment sent before the reveal. Either something went wrong, or those are not the dials they chose. The board has been updated with what they sent.`,
        });
      }
    });
  }

  const multiplayer = new MultiplayerDialog(
    emberApi,
    {
      view: () => relay.state,
      host: () => relay.host(),
      join: (code) => relay.join(code),
      leave: () => relay.leave(),
      bringSquad: () => void bringSquadToRoom(),
      resend: () => relay.publishCheckpoint(),
    },
  );
  const mpButton = document.getElementById('btn-multiplayer')!;
  mpButton.addEventListener('click', () => void multiplayer.open());
  emberApi.onChange((account) => {
    mpButton.textContent = account ? account.displayName || account.username : 'Multiplayer';
    mpButton.classList.toggle('signed-in', !!account);
    // A session ending takes any networked game with it.
    if (!account) relay.leave();
  });
  void emberApi.refresh();

  document.getElementById('btn-clear')!.addEventListener('click', async () => {
    const units = state.tokens.length;
    // Mission Task Items count as objectives here; see clearObjectives.
    const markers = (state.markers?.length ?? 0) + (state.tasks?.items.length ?? 0);
    const terrain = currentTerrain().length;
    const zones = state.zoneSet || state.mission || state.tasks ? 1 : 0;
    if (!units && !markers && !terrain && !zones) {
      void alertDialog({ title: 'Nothing to clear', body: 'The board is already empty.' });
      return;
    }
    const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    const pick = await choiceDialog({
      title: 'Clear what?',
      body: 'Each option only touches its own kind, so nothing else on the board is disturbed.',
      stacked: true,
      choices: [
        ...(units ? [{ id: 'units', label: `Units (${count(units, 'unit')})` }] : []),
        ...(markers ? [{ id: 'markers', label: `Objectives (${count(markers, 'marker')})` }] : []),
        ...(terrain ? [{ id: 'terrain', label: `Terrain (${count(terrain, 'piece')})` }] : []),
        ...(zones ? [{ id: 'zones', label: `Zones (${state.zoneSet ? zoneSetLabel(state.zoneSet) : 'mission setup'})` }] : []),
        { id: 'all', label: 'Everything', danger: true },
        { id: 'cancel', label: 'Cancel', cancel: true },
      ],
    });
    if (!pick || pick === 'cancel') return;

    if (pick === 'all') {
      const ok = await confirmDialog({
        title: 'Clear everything?',
        body: 'Units, objectives, terrain and zones all go, and the round track returns to Round 1. Saved maps and mech presets are untouched.',
        confirmLabel: 'Clear everything',
        danger: true,
      });
      if (!ok) return;
      clearUnits();
      clearObjectives();
      clearTerrain();
      clearZones();
      state.tasks = null;
      state.round = { n: 1, phase: 0, firstPlayer: 's1' };
      state.roundLimit = 5;
      state.scale = 'standard';
      state.mission = undefined;
      state.scenario = null;
    } else if (pick === 'units') {
      clearUnits();
    } else if (pick === 'markers') {
      clearObjectives();
    } else if (pick === 'terrain') {
      clearTerrain();
    } else if (pick === 'zones') {
      clearZones();
    }
    renderAll();
  });

  document.getElementById('btn-export')!.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ember-board.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const importFile = document.getElementById('import-file') as HTMLInputElement;
  document.getElementById('btn-import')!.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const s = migrateState(JSON.parse(await file.text()), data);
      if (!s) throw new Error('not a board file');
      state = s;
      selectToken(null);
      mapSelect.value = state.map;
      renderAll();
    } catch (e) {
      await alertDialog({
        title: 'Could not load that board',
        body: `${(e as Error).message}. Board files are the JSON produced by "Save board" in this app.`,
      });
    }
    importFile.value = '';
  });

  const squadFile = document.getElementById('import-squad-file') as HTMLInputElement;
  // One path for every squad arriving at the table: the importSquad command
  // mirrors to the other seat, and a refusal (a game already past deployment)
  // is explained rather than swallowed.
  function sendSquad(
    side: Side,
    name: string,
    mechs: { name?: string; loadout: MechLoadout }[],
    drones: { cardId: string; backpack?: string }[],
    tactics?: string[],
  ): boolean {
    const verdict = perform(data, state, { kind: 'importSquad', seat: side, name, mechs, drones });
    if (!verdict.ok) {
      void alertDialog({ title: 'The squad could not join', body: verdict.why });
      return false;
    }
    // The hand comes with the squad. Merged through a Set because topping up
    // with a second list that carries a card already held would otherwise be a
    // duplicate, and check() refuses a hand with one (FAQ P2).
    if (tactics?.length) {
      const merged = [...new Set([...(state.tactics?.[side] ?? []), ...tactics])];
      perform(data, state, { kind: 'setTactics', seat: side, cards: merged });
    }
    onChanged();
    setHint(`Squad "${name}" joins ${squadLabel(side)}${deployingNow() ? ' — it deploys with everything else (3.1.4)' : ''}.`);
    return true;
  }

  // The multiplayer popup's "bring a squad": the saved library first, and the
  // file picker as the way in when the library is empty or the squad is new.
  async function bringSquadToRoom(): Promise<void> {
    const seat = relay.state.seat;
    if (!seat) return;
    const saved = loadSquads();
    if (!saved.length) {
      squadFile.click();
      return;
    }
    const picked = await choiceDialog({
      title: 'Bring which squad?',
      body: 'The squad joins your side and deploys with everything else.',
      stacked: true,
      choices: [
        ...saved.map((s) => ({ id: s.id, label: s.name })),
        { id: 'file', label: 'From a squad file…' },
        { id: 'cancel', label: 'Cancel', cancel: true },
      ],
    });
    if (!picked || picked === 'cancel') return;
    if (picked === 'file') {
      squadFile.click();
      return;
    }
    const sq = saved.find((s) => s.id === picked);
    if (sq) void loadSavedSquad(sq);
  }

  // Loading from the roster's Saved Squads row. In an online room the squad
  // can only be yours; on a local table the side is asked.
  async function loadSavedSquad(sq: SavedSquad): Promise<void> {
    let side = relay.state.room ? relay.state.seat : null;
    if (relay.state.room && !side) return;
    if (!side) {
      const picked = await choiceDialog({
        title: `Load "${sq.name}"?`,
        body: 'Which squad does it join?',
        choices: [
          { id: 's1', label: squadLabel('s1'), primary: true },
          { id: 's2', label: squadLabel('s2') },
          { id: 'cancel', label: 'Cancel', cancel: true },
        ],
      });
      if (picked !== 's1' && picked !== 's2') return;
      side = picked;
    }
    sendSquad(side, sq.name, sq.mechs, sq.drones, sq.tactics);
  }

  // Saving what stands on the board: launched drones and projectiles are
  // spawns rather than squad members, so they stay behind.
  async function saveSquadFlow(): Promise<void> {
    const owned = (side: Side) =>
      state.tokens.filter((t) => t.side === side && t.kind !== 'projectile' && t.parentUid === undefined);
    const sides = (['s1', 's2'] as Side[]).filter((sd) => owned(sd).length);
    if (!sides.length) {
      await alertDialog({
        title: 'Nothing to save',
        body: 'Neither side has units on the board. Build or import a squad first.',
      });
      return;
    }
    let side = sides.length === 1 ? sides[0] : null;
    if (!side) {
      const picked = await choiceDialog({
        title: 'Save which squad?',
        body: 'Both squads have units on the board.',
        choices: [
          { id: 's1', label: squadLabel('s1'), primary: true },
          { id: 's2', label: squadLabel('s2') },
          { id: 'cancel', label: 'Cancel', cancel: true },
        ],
      });
      if (picked !== 's1' && picked !== 's2') return;
      side = picked;
    }
    const units = owned(side);
    const mechs = units
      .filter((t) => t.kind === 'mech' && (t.mech?.torso || t.mech?.chasis))
      .map((t) => ({ name: t.label, loadout: { ...t.mech } }));
    const drones = units
      .filter((t) => t.kind === 'drone')
      .map((t) => ({ cardId: t.cardId, backpack: t.droneBackpack }));
    // The hand is part of the squad (5.4): bought from the same points, so a
    // save that dropped it would reload a squad cheaper than the one built.
    const tactics = (state.tactics?.[side] ?? []).filter((id) => !!data.byId.get(id));
    const name = await promptDialog({
      title: 'Save this squad',
      body: `${mechs.length} mech${mechs.length === 1 ? '' : 's'}, ${drones.length} drone${
        drones.length === 1 ? '' : 's'
      }${tactics.length ? ` and ${tactics.length} Tactics Card${tactics.length === 1 ? '' : 's'}` : ''
      }. Saved squads are kept on this device, load from the Saved Squads row or the multiplayer popup, and reusing a name overwrites it.`,
      value: squadLabel(side),
      placeholder: 'Squad name',
      confirmLabel: 'Save',
    });
    if (!name) return;
    saveSquad(name, mechs, drones, Date.now(), tactics);
    setHint(`Squad "${name}" saved.`);
  }

  document.getElementById('btn-import-squad')?.addEventListener('click', () => squadFile.click());
  squadFile.addEventListener('change', async () => {
    const file = squadFile.files?.[0];
    if (!file) return;
    try {
      const squad = await importSquadFile(file, data.byId);
      if (!squad.mechs.length && !squad.drones.length) throw new Error('squad is empty');
      const parts = [
        squad.mechs.length ? `${squad.mechs.length} mech${squad.mechs.length === 1 ? '' : 's'}` : '',
        squad.drones.length ? `${squad.drones.length} drone${squad.drones.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      // Every squad that arrives by file is remembered, which is what the
      // multiplayer "bring a squad" picker chooses from next time.
      saveSquad(squad.name, squad.mechs, squad.drones, Date.now(), squad.tactics);
      // In an online room the squad can only be yours — the relay refuses
      // commands sent as the other seat — so the side question disappears.
      const mySeat = relay.state.room ? relay.state.seat : null;
      let side: Side;
      if (mySeat) {
        side = mySeat;
      } else {
        const picked = await choiceDialog({
          title: `Import "${squad.name}"?`,
          body: `${parts.join(' and ')}. Which squad is it deploying for?`,
          choices: [
            { id: 's1', label: squadLabel('s1'), primary: true },
            { id: 's2', label: squadLabel('s2') },
            { id: 'cancel', label: 'Cancel', cancel: true },
          ],
        });
        if (picked !== 's1' && picked !== 's2') {
          squadFile.value = '';
          return;
        }
        side = picked;
      }
      if (!sendSquad(side, squad.name, squad.mechs, squad.drones, squad.tactics)) {
        squadFile.value = '';
        return;
      }
      if (squad.unknownIds.length) {
        void alertDialog({
          title: 'Some cards were skipped',
          body: 'These card ids are not in the local database, so those entries were left out of the squad:',
          list: squad.unknownIds,
          closeLabel: 'Continue',
        });
      }
      const problems = state.scenario ? [] : factionProblems(data, state.tokens.filter((t) => t.side === side));
      if (problems.length) {
        void alertDialog({
          title: 'That squad breaks the faction rule',
          body: `${squadLabel(side)} was imported, but rulebook 5.1 says a squad may only contain units from a single faction, and a mech may only use parts from one faction.`,
          list: problems.map((p) => p.detail),
          closeLabel: 'Got it',
        });
      }
      const sc = SCALES.find((x) => x.id === (state.scale ?? 'standard'))!;
      const sidePts = state.tokens
        .filter((t) => t.side === side)
        .reduce((sum, t) => sum + tokenCards(data, t).reduce((n, { card }) => n + (card.score ?? 0), 0), 0);
      if (!sc.openEnded && sidePts > sc.points) {
        void alertDialog({
          title: 'That squad is over the points limit',
          body: `${squadLabel(side)} now totals ${sidePts} points, which is ${sidePts - sc.points} over the ${sc.name} limit of ${sc.points}.`,
          list: [
            'The squad was still imported, so you can play it if you both agree.',
            'To play it legally, remove units or switch the battle scale in the round bar above the board.',
          ],
          closeLabel: 'Got it',
        });
      }
      showSideTab('squad');
    } catch (e) {
      await alertDialog({
        title: 'Squad import failed',
        body: `${(e as Error).message}. Expected a .json export from the community builder, or the squad .png it produces.`,
      });
    }
    squadFile.value = '';
  });

  document.getElementById('move-confirm')!.addEventListener('click', () => commitMove());
  document.getElementById('move-back')!.addEventListener('click', () => undoWaypoint());
  document.getElementById('btn-undo')!.addEventListener('click', () => undoMove());
  document.getElementById('move-cancel')!.addEventListener('click', () => cancelMove());

  // ---------- keyboard ----------

  document.addEventListener('keydown', (ev) => {
    if (ev.target instanceof Element && ev.target.matches('input,select,textarea')) return;
    // Ctrl+Z is what a hand reaches for after a mis-click, and it only means
    // anything while the editor is the thing on screen.
    if (editor.active && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      undoEdit();
      return;
    }
    // Backspace steps back one waypoint mid-route; Escape still abandons the
    // whole move. Two different retreats, and conflating them is how a player
    // loses a route they only wanted to trim.
    // Ctrl+Z outside the map editor is the board's undo. The editor has its own
    // above this, and gets first refusal while it is open.
    if (!editor.active && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      undoMove();
      return;
    }
    if (movePlan && (ev.key === 'Backspace' || ev.key === 'Delete')) {
      ev.preventDefault();
      undoWaypoint();
      return;
    }
    if (ev.key === 'Escape') {
      if (movePlan) {
        cancelMove();
        return;
      }
      if (isInspectPinned()) {
        unpinInspect();
        return;
      }
      // The launch hint says "Esc stops", and for a long time Esc only wiped
      // the highlights: `launching` stayed set, the panel stayed up and the
      // hint sat there forever. Finishing keeps what was already placed, the
      // same as the panel's own Stop here button.
      if (launching) {
        finishLaunch();
        return;
      }
      endTargeting(true);
      board.clearHighlights();
      board.clearGhost();
      if (editor.active) {
        if (editor.item || editor.erase) {
          editor.item = null;
          editor.erase = false;
          renderEditorBar();
        } else {
          requestExitEditor();
        }
      }
      return;
    }
    if (ev.key.toLowerCase() === 'r' && editor.active) {
      editor.vertical = !editor.vertical;
      renderEditorBar();
      return;
    }
    const t = state.tokens.find((x) => x.uid === selectedUid);
    if (!t) return;
    const k = ev.key.toLowerCase();
    if (k === 'q' || k === 'e') {
      if (statusCount(t.statuses, 'immobilized') > 0 && !ev.shiftKey) {
        showInspect({
          title: 'Immobilized',
          sub: `IMB · on ${t.label}`,
          lines: [
            'Turning on the spot is a Maneuver, and an Immobilized unit cannot Maneuver (rulebook 6.3.2).',
            'Hold Shift with Q or E to turn it anyway, for effects that reposition it without its own action.',
          ],
        });
        return;
      }
      const d = k === 'q' ? 3 : 1;
      t.facing = ((t.facing + d) % 4) as Facing;
      onChanged();
      if (!combatBusy()) panel.showToken(t);
    } else if (k === 'm') {
      const base = moveRangeFor(t);
      if (base > 0) {
        const flying = !!data.byId.get(t.cardId)?.moveAsFlight;
        board.showReachable(reachableGrids(t, base, currentTerrain(), state.tokens, flying, moveOpts(t, flying)), base);
      }
    } else if (k === 'a') {
      board.showArcs(t);
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      void removeUnit(t.uid);
    }
  });

  setSquadNames(state.sideNames);
  syncSquadTints();
  panel.clear();
  renderCombatIdle();
  renderUnitLog();
  renderAll();
}

init().catch((e) => {
  document.body.innerHTML = `<pre style="padding:2rem;color:#f87171">Failed to start: ${e}</pre>`;
});

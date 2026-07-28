import './styles.css';
import { Board, CELLS, footprint, snapPlacement, type BoardDeployment, type BoardZone, type DeployShape } from './board';
import { AttackHelper, ElectronicHelper } from './combat';
import { alertDialog, choiceDialog, confirmDialog, promptDialog } from './dialog';
import { DiceTray } from './dice';
import { importSquadFile } from './importer';
import { Inventory } from './inventory';
import { isInspectPinned, showInspect, unpinInspect } from './inspector';
import { cardName, dataUrl, loadData, missionImageUrl, parseGridRef, rulesLines, SIDE_LABEL } from './data';
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
import { Roster } from './roster';
import { dissipationFor, extendPath, inArc, LG, losBetween, rangeBetween, reachableGrids, smokeBlocks, standingSpot } from './rules';
import { instantiateScenario, loadScenarios, type Scenario } from './scenarios';
import { loadReplays, ReplayPlayer, type ReplayScript, type ReplayStep, type ReplayTally } from './replay';
import { SquadTracker } from './squads';
import { warmAllImagesWhenIdle } from './images';
import { watchForUpdates } from './updates';
import { installTooltip, preloadCards } from './tooltip';
import { PHASES, RoundTracker } from './tracker';
import { PlayGuide } from './playguide';
import type { Card, CardAction, DiceData, Facing, GameState, MechLoadout, Side, SmokeScreen, Stance, StatusDef, TerrainPiece, Token } from './types';
import { addStatus, SCALES, statusCount, statusesFor, STATUSES } from './types';
import { deployedCardCounts, factionProblems, guidedActions, interceptCapacity, interceptLeft, interceptReach, isElectronicAttack, makeDroneToken, makeMechToken, maneuverRange, migrateState, needsSightToLanding, smokePlacement, tokenCards, volleyOf } from './units';
import { registerOffline } from './offline';
import { battlefieldLocked, countHits, firstPlayerFrom, newSetup, normaliseSetup, type SetupState } from './setup';

const SAVE_KEY = 'ember-testing-grounds-v1';

async function init() {
  const data = await loadData();
  const dice = (await fetch(dataUrl('dice.json')).then((r) => r.json())) as DiceData;

  let state: GameState = loadState() ?? {
    v: 3,
    map: 'alley',
    tokens: [],
    nextUid: 1,
    round: { n: 1, phase: 0, firstPlayer: 'blue' },
    commandTokens: { blue: 0, red: 0 },
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
  preloadCards(data.cards.map((c) => c.id));
  warmAllImagesWhenIdle();
  registerOffline();
  watchForUpdates();
  const inventory = new Inventory(data.boxes, () => roster.render(), data.cards);

  const tray = new DiceTray(dice, document.getElementById('dice-tray')!);

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
  );

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
  );

  function combatBusy(): boolean {
    return attackHelper.active || electronicHelper.active;
  }

  const roundTracker = new RoundTracker(document.getElementById('round-tracker')!, () => onChanged());
  roundTracker.onStartGame = () => void startGame();

  const playGuide = new PlayGuide(document.getElementById('board-wrap')!, data, {
    onAdvancePhase: () => roundTracker.advance(),
    onSelectUnit: (uid) => selectToken(uid),
    onMoveUnit: (uid, opts, done) => startMove(uid, opts, done),
    onPerformAction: (uid, actionId, done) => performGuided(uid, actionId, done),
    onSetStance: (uid, stance) => {
      const t = state.tokens.find((x) => x.uid === uid);
      if (!t) return;
      t.stance = stance;
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
    mapLabel: () => mapSelect.options[mapSelect.selectedIndex]?.textContent ?? state.map ?? 'none',
    zoneLabel: () => zoneSetLabel(state.zoneSet ?? ''),
    onNote: (t, text) => logTo(t, text),
    onChanged: () => onChanged(),
  });

  roundTracker.blockedReason = (s) => playGuide.blockedReason(s);

  const panel = new Panel(data, {
    onRollDice(pool) {
      tray.addToPool(pool, true);
      tray.roll();
    },
    onSpendAmmo(t, actionId) {
      if (t.ammo[actionId] !== undefined && t.ammo[actionId] > 0) {
        t.ammo[actionId]--;
        onChanged();
        if (!combatBusy()) panel.showToken(t);
      }
    },
    onRestoreAmmo(t, actionId) {
      const max = tokenCards(data, t)
        .flatMap(({ card }) => card.actions ?? [])
        .find((a) => a.id === actionId)?.storage;
      if (t.ammo[actionId] !== undefined && max !== undefined && t.ammo[actionId] < max) {
        t.ammo[actionId]++;
        onChanged();
        if (!combatBusy()) panel.showToken(t);
      }
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
      const hint = document.getElementById('hint')!;
      hint.textContent = '⌖ Click the TARGET unit on the board (Esc cancels)';
    },
    onStartElectronic(t, actionId) {
      pendingAttack = { attackerUid: t.uid, actionId, mode: 'electronic' };
      document.body.classList.add('targeting');
      const hint = document.getElementById('hint')!;
      hint.textContent = '⚡ Click the TARGET of the Electronic Attack (Esc cancels)';
    },
    onShowMoveRange(t, steps) {
      const flying = !!data.byId.get(t.cardId)?.moveAsFlight;
      const grids = reachableGrids(t, steps, currentTerrain(), state.tokens, flying);
      board.showReachable(grids, steps);
    },
    onShowActionRange(t, range, label) {
      board.showRangeRings(t, range);
      const inRange = unitsWithin(t, range);
      const hint = document.getElementById('hint')!;
      hint.textContent = `${label}: R${range} shown. ${inRange.length} unit${inRange.length === 1 ? '' : 's'} in range. Line of sight and arc still apply.`;
    },
    onDetonate(t, actionId) {
      startDetonation(t, actionId);
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
      state.tokens = state.tokens.filter((x) => x.uid !== uid && x.parentUid !== uid);
      if (selectedUid === uid) selectToken(null);
      onChanged();
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
            );
            interceptFollowUp = { uid: attacker.uid, actionId: intercepting.actionId, targetUid: defender.uid };
          } else {
            const prot = protectionFor(attacker, defender, action);
            attackHelper.start(attacker, action, defender, losNote(attacker, defender, action), prot.white, prot.note);
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
            state.removedTerrain = [...(state.removedTerrain ?? []), ...crushed];
            board.renderTerrain(currentTerrain());
          }
        }
        t.col = snapped.col;
        t.row = snapped.row;
        save();
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
        if (!erase) lockMove();
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
      editor.working.push(makePiece(editor.item, cells));
      afterEdit();
    },
    onCellHover(col, row) {
      if (movePlan) {
        traceMove(Math.floor(col / 3), Math.floor(row / 3));
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

  function losNote(attacker: Token, defender: Token, action: { type?: string; range?: number }): string {
    const r = rangeBetween(attacker, defender);
    const los = losBetween(attacker, defender, currentTerrain(), state.tokens);
    const fwd = inArc(attacker, defender, 'forward');
    const bits: string[] = [];
    bits.push(r.sameGrid ? 'same grid' : r.adjacent ? 'adjacent (R1)' : `Range ${r.range}`);
    if (action.range === 0) {
      if (!r.adjacent && !r.sameGrid) bits.push('⚠ target not adjacent (action range is “--”)');
    } else if (action.range && r.range > action.range) {
      bits.push(`⚠ beyond action range (R${action.range})`);
    }
    bits.push(fwd ? 'in forward arc ✓' : '⚠ NOT in forward arc');
    if (action.type === 'Firing') {
      if (smokeBlocks(attacker, defender, state.smoke ?? [])) bits.push('✕ LOS blocked by a Smoke Screen (4.16)');
      else bits.push(los === 'clear' ? 'LOS clear ✓' : los === 'obstructed' ? '⚠ obstructed, so consider +2 White protection' : '✕ LOS blocked (3" terrain)');
    }
    return bits.join(' · ');
  }

  function protectionFor(attacker: Token, defender: Token, action: { type?: string }): { white: number; note: string } {
    if (action.type !== 'Firing') return { white: 0, note: '' };
    // Smoke removes line of sight outright, so there is no protection to add on top.
    if (smokeBlocks(attacker, defender, state.smoke ?? [])) {
      return { white: 0, note: 'No line of sight: a Smoke Screen is in the way (4.16)' };
    }
    const los = losBetween(attacker, defender, currentTerrain(), state.tokens);
    if (los === 'clear') return { white: 0, note: '' };
    const terrainOnly = losBetween(attacker, defender, currentTerrain(), []);
    const unitsOnly = losBetween(attacker, defender, [], state.tokens);
    let white = 0;
    const parts: string[] = [];
    if (terrainOnly !== 'clear') {
      white += 2;
      parts.push('Terrain Protection (obstructed by terrain ≥2")');
    }
    if (unitsOnly !== 'clear') {
      white += 2;
      parts.push('Unit Protection (obstructed by a Large unit)');
    }
    return { white, note: parts.join(' + ') || 'Obstructed line of sight' };
  }

  // ---------- performing an action from the play guide ----------

  function findAction(t: Token, actionId: string): CardAction | undefined {
    const own = tokenCards(data, t)
      .flatMap(({ card }) => card.actions ?? [])
      .find((a) => a.id === actionId);
    return own ?? data.commonActions.find((a) => a.id === actionId);
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

    if (action.type === 'Firing' || action.type === 'Melee') {
      const electronic = isElectronicAttack(action);
      pendingAttack = { attackerUid: uid, actionId, mode: electronic ? 'electronic' : 'attack', action, done };
      document.body.classList.add('targeting');
      if (action.range) board.showRangeRings(t, action.range);
      const reach = action.range ? ` Range ${action.range} is shown.` : '';
      setHint(`${what}: click the target unit on the board.${reach} Esc cancels and keeps the Tick.`);
      return;
    }

    if (action.type === 'Moving') {
      const range = action.range || maneuverRange(data, t);
      startMove(uid, { range, label: what }, done);
      return;
    }

    if (action.type === 'Projectile') {
      const ga = guidedActions(data, t).find((g) => g.action.id === actionId);
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
    const su = normaliseSetup(state.setup) ?? newSetup();
    const faces = [0, 1].map(() => dice.dice.yellow.faces[Math.floor(Math.random() * dice.dice.yellow.sides)]);
    const hits = faces.map((f) => countHits([f]));
    su.rolls = { ...su.rolls, [side]: hits } as SetupState['rolls'];
    // A re-roll after a tie starts the comparison over for both sides.
    if (su.rolls.blue.length && su.rolls.red.length && !firstPlayerFrom(su) && side === 'red') {
      tray.addToPool({ yellow: 2 }, true);
    }
    state.setup = su;
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
        t.col = spot.col;
        t.row = spot.row;
        t.facing = t.side === 'blue' ? 2 : 0;
        t.deployed = true;
        // A Mech picks its Stance as it lands; anything else keeps its printed one.
        if (t.kind === 'mech') t.stance = opts.stance;
        if (opts.camo) t.statuses = addStatus(t.statuses, 'camouflage');
        su.placed = { ...su.placed, [t.side]: su.placed[t.side] + 1 } as SetupState['placed'];
        state.setup = su;
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
    state.tokens = state.tokens.filter((t) => t.kind !== 'projectile');
    for (const t of state.tokens) t.deployed = false;
    state.smoke = [];
    state.round = { n: 1, phase: 0, firstPlayer: 'blue' };
    state.commandTokens = { blue: 0, red: 0 };
    state.setup = newSetup();
    state.script = undefined;
    selectToken(null);
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
      attackHelper.start(t, action, chosen, 'Interception: line of sight always exists and no Forward Arc is required (4.9).', 0, '');
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
    void confirmDialog({
      title: 'Intercept again',
      body: `${target.label} survived, so ${t.label} MUST Intercept again until its Tokens run out or the target is destroyed (rulebook 4.9). ${left} Token${left === 1 ? '' : 's'} left.`,
      confirmLabel: 'Intercept again',
      cancelLabel: 'Stop here',
    }).then((again) => {
      if (again) startIntercept(t, f.actionId);
    });
  }

  function spendIntercept(t: Token, actionId: string, name: string): void {
    const left = t.intercept?.[actionId] ?? 0;
    if (left <= 0) return;
    t.intercept![actionId] = left - 1;
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
    body.innerHTML = `<div class="attack-helper">
      <div class="ah-head"><b>Launch ${escapeHtml(cardName(m.card))}</b>
        <span class="dim">${escapeHtml(m.action.name.en || m.action.name.zh || m.action.id)} · ${m.placed} of ${total} launched</span></div>
      <p class="ah-los">${
        needsSightToLanding(m.action)
          ? 'Direct Fire, so the Landing Point has to be a Grid this unit can see and one terrain does not fill.'
          : 'Fire in arc, so no line of sight to the Landing Point is needed.'
      } A Landing Point is a Grid, not a unit, and nothing is targeted yet.</p>
      <div class="ah-step"><h4>Click a highlighted Grid on the board</h4>
        <p class="dim">${cands.length} legal ${cands.length === 1 ? 'Grid' : 'Grids'} within Range ${m.action.range ?? 0}.
          ${total > 1 ? `Volley ${total} lets you place up to ${total}, one Ammo Token each, and you may stop early.` : 'One Ammo Token is spent.'}</p>
      </div></div>`;
    const cancel = document.createElement('button');
    cancel.className = 'ah-cancel';
    cancel.textContent = m.placed ? 'Stop here' : 'Cancel';
    cancel.addEventListener('click', () => finishLaunch());
    body.querySelector('.ah-head')!.appendChild(cancel);
    board.showSmokeTargets(cands, (c, r) => placeLaunched(c, r));
    showSideTab('combat');
  }

  function placeLaunched(c: number, r: number): void {
    const m = launching;
    if (!m) return;
    const t = state.tokens.find((x) => x.uid === m.uid);
    if (!t) return;
    const tok = makeDroneToken(state, data, m.card, t.side);
    const spot = standingSpot(c, r, tok.size, tok.aerial, currentTerrain(), state.tokens, undefined, { col: t.col, row: t.row });
    if (!spot) {
      void alertDialog({
        title: 'Nothing fits there',
        body: `There is no room in that Grid for ${cardName(m.card)}. Rulebook 4.7.2 needs the projectile's base to sit entirely inside the Landing Point Grid, so pick another one.`,
      });
      return;
    }
    state.tokens.push({ ...tok, parentUid: t.uid, col: spot.col, row: spot.row, facing: t.facing });
    const id = m.action.id;
    if (t.ammo[id] !== undefined) t.ammo[id] = Math.max(0, t.ammo[id] - 1);
    m.placed++;
    m.left--;
    logTo(t, `Launched ${cardName(m.card)} to ${gridRef(c, r)}${t.ammo[id] !== undefined ? ` (Ammo ${t.ammo[id]} left)` : ''}.`);
    onChanged();
    if (m.left <= 0 || (t.ammo[id] !== undefined && t.ammo[id] <= 0)) finishLaunch();
    else renderLaunchStep();
  }

  function finishLaunch(): void {
    const m = launching;
    launching = null;
    board.clearHighlights();
    if (!m) return;
    if (m.placed) noteInterception(m.uid);
    m.done(m.placed > 0);
    onChanged();
  }

  // Interception fires the moment an Aerial Unit is Launched or Moves (4.9), so
  // the guide says who it woke up rather than leaving it to be remembered.
  function noteInterception(launcherUid: number): void {
    const t = state.tokens.find((x) => x.uid === launcherUid);
    if (!t || !state.script) return;
    const fresh = state.tokens.filter((x) => x.parentUid === launcherUid && x.kind === 'projectile');
    if (!fresh.length) return;
    const owed: { uid: number; actionId: string; targetUid: number }[] = [];
    for (const x of state.tokens) {
      if (x.side === t.side || interceptLeft(x) <= 0) continue;
      for (const { card } of tokenCards(data, x)) {
        for (const a of card.actions ?? []) {
          if (interceptCapacity(a) === undefined) continue;
          if ((x.intercept?.[a.id] ?? 0) <= 0) continue;
          for (const p of fresh) {
            if (rangeBetween(x, p).range > (a.range ?? 0)) continue;
            owed.push({ uid: x.uid, actionId: a.id, targetUid: p.uid });
          }
        }
      }
    }
    if (!owed.length) return;
    state.script.intercepts = [...state.script.intercepts, ...owed];
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
    launching = { uid: t.uid, action, card, left: shots, placed: 0, done };
    selectToken(t.uid);
    setHint(`${action.name.en || action.id}: click a Landing Point Grid on the board. Esc stops.`);
    renderLaunchStep();
  }

  function endTargeting(cancelled = false): void {
    if (cancelled) pendingAttack?.done?.(false);
    pendingAttack = null;
    pendingIntercept = null;
    board.clearHighlights();
    document.body.classList.remove('targeting');
    document.getElementById('hint')!.textContent = 'Drag move · Q/E rotate · M move-range · A arcs · Del remove · hover = range/LOS';
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
    cardFilter: (card) => {
      if (!inventory.passes(card)) return false;
      const left = stockLeft(card);
      return left === null || left > 0;
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
    onAddUnit(card, side) {
      const tok = makeDroneToken(state, data, card, side);
      placeNew(tok, side);
    },
    onAddMech(loadout: MechLoadout, side) {
      const tok = makeMechToken(state, data, loadout, side);
      placeNew(tok, side);
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
      state.tokens.push({ ...tok, col: 0, row: 0, facing: side === 'blue' ? 2 : 0, deployed: false });
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
    state.tokens.push({ ...tok, col: spot.col, row: spot.row, facing: side === 'blue' ? 2 : 0 });
    onChanged();
  }

  // ---------- guided movement ----------

  let movePlan: {
    uid: number;
    side: Side;
    steps: number;
    flying: boolean;
    path: { c: number; r: number }[];
    locked: boolean;
    done: (moved: boolean) => void;
  } | null = null;

  // The route is traced by the cursor rather than solved, so a deliberate zigzag
  // is expressible.
  function traceMove(c: number, r: number): void {
    const m = movePlan;
    if (!m || m.locked) return;
    const t = state.tokens.find((x) => x.uid === m.uid);
    if (!t) return;
    const next = extendPath(m.path, { c, r }, t, m.steps, currentTerrain(), state.tokens, m.flying);
    if (!next) return;
    m.path = next;
    board.showMovePath(next, m.side, false);
    renderMoveCtrl();
  }

  function renderMoveCtrl(): void {
    const bar = document.getElementById('move-ctrl')!;
    const m = movePlan;
    if (!m) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const info = document.getElementById('move-info')!;
    const confirm = document.getElementById('move-confirm') as HTMLButtonElement;
    const n = Math.max(0, m.path.length - 1);
    info.textContent = n ? `${n} of ${m.steps} grids${m.locked ? ' · locked' : ''}` : `Draw a route (up to ${m.steps})`;
    confirm.disabled = n === 0;
  }

  function moveRangeFor(t: Token): number {
    let base = 0;
    if (t.kind === 'mech' && t.mech?.chasis) base = data.byId.get(t.mech.chasis)?.move ?? 0;
    else base = data.byId.get(t.cardId)?.move ?? 0;
    return t.stance === 'mobility' ? base * 2 : base;
  }

  function startMove(uid: number, opts: { range?: number; label: string }, done: (moved: boolean) => void): void {
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
    const flying = !!data.byId.get(t.cardId)?.moveAsFlight;
    movePlan = {
      uid,
      side: t.side,
      steps,
      flying,
      path: [{ c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) }],
      locked: false,
      done,
    };
    selectToken(uid);
    board.showReachable(reachableGrids(t, steps, currentTerrain(), state.tokens, flying), steps);
    board.panEnabled = false;
    renderMoveCtrl();
    setHint(`${opts.label} for ${t.label}: drag the cursor across grids to draw the route, click to lock it, then Confirm. Esc cancels.`);
  }

  // Clicking freezes the traced route so the cursor can leave the board for the
  // Confirm button without dragging the path along behind it.
  function lockMove(): void {
    const m = movePlan;
    if (!m || m.path.length < 2) return;
    m.locked = !m.locked;
    board.showMovePath(m.path, m.side, m.locked);
    renderMoveCtrl();
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
    movePlan = null;
    board.panEnabled = true;
    board.clearHighlights();
    board.clearMovePath();
    renderMoveCtrl();
    const finish = () => {
      t.col = last.col;
      t.row = last.row;
      logTo(t, `${t.label} moves ${path.length - 1} grid${path.length - 1 === 1 ? '' : 's'}.`);
      onChanged();
      setHint('');
      m.done(true);
    };
    board.animateMove(m.uid, stops, finish);
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

  function setHint(text: string): void {
    const el = document.getElementById('hint');
    if (!el) return;
    if (text) el.dataset.guide = '1';
    else delete el.dataset.guide;
    el.textContent = text || 'Drag move · Q/E rotate · M move-range · A arcs · Del remove · hover = range/LOS';
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
      const s: SmokeScreen = { col: c, row: r, side: m.side };
      state.smoke = [...(state.smoke ?? []), s];
      m.placed.push(s);
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
    const order: Side[] = state.round.firstPlayer === 'blue' ? ['blue', 'red'] : ['red', 'blue'];
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
        Players alternate, ${escapeHtml(SIDE_LABEL[order[0]])} first. Groups are counted once now, so a
        removal that splits a group owes nothing more until next round.</p>
      <ul class="smoke-owed">${owed
        .map(
          (d) =>
            `<li><b>${escapeHtml(SIDE_LABEL[d.side])}</b>: ${
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

  // The owner picks which screen leaves each group, and the group list is fixed
  // before any of it happens, so a removal that splits a group owes nothing more.
  let smokeChoices: { side: Side; group: SmokeScreen[] }[] | null = null;

  function resolveDissipation(): void {
    const smoke = state.smoke ?? [];
    if (!smoke.length) return;
    const order: Side[] = state.round.firstPlayer === 'blue' ? ['blue', 'red'] : ['red', 'blue'];
    const doomed = new Set<SmokeScreen>();
    const queue: { side: Side; group: SmokeScreen[] }[] = [];
    let isolated = 0;
    for (const side of order) {
      const d = dissipationFor(smoke, side);
      for (const s of d.isolated) doomed.add(s);
      isolated += d.isolated.length;
      for (const g of d.groups) queue.push({ side, group: g });
    }
    state.smoke = smoke.filter((s) => !doomed.has(s));
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
        <span class="dim">${escapeHtml(SIDE_LABEL[next.side])} chooses · ${smokeChoices!.length} group${smokeChoices!.length === 1 ? '' : 's'} left</span></div>
      <p class="dim">${isolated ? `${isolated} isolated screen${isolated === 1 ? '' : 's'} came off already. ` : ''}Click one
        highlighted Smoke Screen to take it off this Connected group. Splitting the group costs nothing further this round.</p>
      <button id="smoke-auto" class="ah-cancel">Pick for me</button>`;
    board.showSmokeTargets(
      next.group.map((s) => ({ c: s.col, r: s.row, ok: true })),
      (c, r) => {
        const gone = next.group.find((s) => s.col === c && s.row === r);
        state.smoke = (state.smoke ?? []).filter((s) => s !== gone);
        smokeChoices = smokeChoices!.slice(1);
        onChanged();
        renderSmokeChoice(0);
      },
    );
    host.querySelector('#smoke-auto')!.addEventListener('click', () => {
      state.smoke = (state.smoke ?? []).filter((s) => s !== next.group[0]);
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

  function startDetonation(proj: Token, actionId: string): void {
    const action = tokenCards(data, proj)
      .flatMap(({ card }) => card.actions ?? [])
      .find((a) => a.id === actionId);
    if (!action) return;
    const range = action.range ?? 0;
    const targets = unitsWithin(proj, range);
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
          state.tokens = state.tokens.filter((x) => x.uid !== proj.uid);
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
    body.innerHTML = `<div class="attack-helper">
      <div class="ah-head"><b><i class="btn-ico">💥</i> ${escapeHtml(detonateHeading(name, proj.label))}</b>
        <span class="dim">R${range} from ${escapeHtml(proj.label)}</span></div>
      <p class="ah-los">Explosion damage ignores line of sight and facing, and the defender gets
        no Terrain or Unit Protection. Only the defender may spend Link to Focus.</p>
      <div class="ah-step"><h4>Choose the unit to damage</h4>
        ${targets.length
          ? '<p class="dim">Cards that say "all Units within range" hit allies too, so everything in reach is listed. Resolve them one at a time.</p>'
          : '<p class="dim">No units within range. A projectile with a delayed action that needs a target is destroyed instead (4.7.5).</p>'}
        <div class="ah-partpick" id="det-targets">${targets
          .map(({ t, dist }) => `<button class="chip" data-uid="${t.uid}">
              <b>${t.side === proj.side ? 'ALLY' : 'ENEMY'}</b> ${escapeHtml(t.label)}
              <small>R${dist}</small></button>`)
          .join('')}</div>
      </div></div>`;
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
    remove.textContent = targets.length ? 'Done: destroy the projectile' : 'Destroy the projectile';
    remove.title = 'A projectile that has detonated is destroyed (4.7.5)';
    remove.addEventListener('click', () => {
      state.tokens = state.tokens.filter((x) => x.uid !== proj.uid);
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
                      ${blocked ? 'title="No line of sight to the grenade, so the card does not affect this unit. You can still mark it by hand."' : ''}>
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
        const at = (t.statuses ?? []).lastIndexOf(pick);
        if (at >= 0 && !def?.stacking) {
          const list = [...(t.statuses ?? [])];
          list.splice(at, 1);
          t.statuses = list;
          logTo(t, `${label} removed from ${t.label}.`);
          return;
        }
        const before = t.statuses ?? [];
        t.statuses = addStatus(before, pick);
        const lost = before.filter((s) => !t.statuses!.includes(s)).map((s) => STATUSES.find((d) => d.id === s)?.label ?? s);
        const n = t.statuses.filter((x) => x === pick).length;
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
        state.tokens = state.tokens.filter((x) => x.uid !== proj.uid);
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
    if (side === 'red') rows.reverse();
    for (const row of rows) {
      for (let col = 0; col <= CELLS - size; col++) {
        const s = snapPlacement(col, row, size);
        if (s && s.row === row && s.col === col && isFree(col, row, size, aerial)) return { col, row };
      }
    }
    return null;
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

  function renderEditorBar(): void {
    if (!editor.active) {
      editorBar.hidden = true;
      return;
    }
    editorBar.hidden = false;
    const dirty = editorDirty();
    editorBar.innerHTML = `
      <b>TERRAIN</b>
      <div class="ed-line">
        ${PALETTE.map((p) => `<button class="ed-piece${editor.item?.id === p.id ? ' active' : ''}" data-piece="${p.id}" title="${p.label}">${p.label.split(' (')[0]}</button>`).join('')}
        <button id="ed-rotate" class="ed-tool" title="Rotate the armed piece (R)"${editor.item?.rotatable ? '' : ' disabled'}>${editor.vertical ? '↕' : '↔'} R</button>
        <button id="ed-erase" class="ed-tool${editor.erase ? ' active' : ''}" title="Erase tool. Right-click erases too.">⌫ Erase</button>
      </div>
      <div class="ed-actions">
        <span class="ed-count">${editor.working.length} piece${editor.working.length === 1 ? '' : 's'}${dirty ? ' · <b>unsaved</b>' : ''}</span>
        <button id="ed-clear"${editor.working.length || editor.zones.length || editor.deploy.black.length || editor.deploy.white.length ? '' : ' disabled'}>Clear all</button>
        ${state.map.startsWith('custom:') ? '<button id="ed-delete" title="Delete this custom map">Delete map</button>' : ''}
        <button id="ed-exit">${dirty ? 'Discard' : 'Close'}</button>
        <button id="ed-save" class="ed-primary">Save map…</button>
      </div>
      <b>ZONES</b>
      <div class="ed-line">
        ${editor.zones
          .map(
            (z) =>
              `<button class="ed-zone${editor.paint?.kind === 'zone' && editor.paint.zoneId === z.id ? ' active' : ''}" data-zone="${z.id}" title="Paint large grids into ${z.name}. Drag to fill a block; right-click removes.">${z.name} <small>${z.cells.length}</small></button>`,
          )
          .join('')}
        <button id="ed-addzone" class="ed-tool" title="Create a named objective zone">+ Zone</button>
        ${editor.paint?.kind === 'zone' ? '<button id="ed-zone-rename" class="ed-tool" title="Rename or delete the selected zone">Rename…</button>' : ''}
        <span class="ed-sep"></span>
        <button id="ed-dz-black" class="ed-tool ed-dz-black${editor.paint?.kind === 'deploy' && editor.paint.side === 'black' ? ' active' : ''}" title="Paint the Black deployment zone. Drag to fill a block.">Black Deploy <small>${editor.deploy.black.length}</small></button>
        <button id="ed-dz-white" class="ed-tool ed-dz-white${editor.paint?.kind === 'deploy' && editor.paint.side === 'white' ? ' active' : ''}" title="Paint the White deployment zone. Drag to fill a block.">White Deploy <small>${editor.deploy.white.length}</small></button>
        <span class="ed-status">${editorStatus()}</span>
      </div>`;
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
        if (!name.trim()) {
          editor.zones = editor.zones.filter((z) => z.id !== zone.id);
          editor.paint = null;
        } else {
          zone.name = name.trim();
        }
        afterEdit();
      })();
    });
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
    board.renderZones(overlayZones(), overlayDeployment());
    renderEditorBar();
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
          { id: 'stay', label: 'Keep editing' },
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
    board.panEnabled = false;
    board.editing = true;
    renderEditorBar();
    board.renderTerrain(editor.working, true);
    board.renderZones(overlayZones(), overlayDeployment());
    board.clearHighlights();
  }

  function exitEditor(): void {
    editor.active = false;
    editor.item = null;
    editor.erase = false;
    editor.paint = null;
    editor.drag = null;
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

  function onChanged(): void {
    save();
    board.renderTokens(state);
    board.renderSmoke(state.smoke ?? []);
    board.setSelected(selectedUid);
    squadTracker.update(state, selectedUid);
    roundTracker.update(state);
    playGuide.update(state);
    paintBattlefieldLock();
    renderSmokePrompt();
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
    board.renderTerrain(currentTerrain(), editor.active);
    board.renderMarkers(state.markers ?? []);
    renderZoneOverlay();
    onChanged();
    board.refit();
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
    state.map = mapSelect.value;
    state.removedTerrain = [];
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
      <div class="inv-head"><b>Saved maps</b></div>
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

  function printedZones(ids?: string[]): BoardZone[] {
    const pool = ids ? data.zoneData.zones.filter((z) => ids.includes(z.id)) : data.zoneData.zones;
    return pool
      .map((z) => ({ name: z.name, cells: z.cells.map(parseGridRef).filter(Boolean) as { col: number; row: number }[] }))
      .filter((z) => z.cells.length);
  }

  function printedDeployment(id: string | null | undefined): BoardDeployment | null {
    const def = id ? data.zoneData.deployments.find((d) => d.id === id) : undefined;
    if (!def) return null;
    const box = (from: string, to: string, label: string) => {
      const a = parseGridRef(from);
      const b = parseGridRef(to);
      if (!a || !b) return undefined;
      const rect = {
        col: Math.min(a.col, b.col),
        row: Math.min(a.row, b.row),
        cols: Math.abs(b.col - a.col) + 1,
        rows: Math.abs(b.row - a.row) + 1,
      };
      return { rect, label: `${label} ${rect.rows}x${rect.cols}` };
    };
    return { black: box(def.black.from, def.black.to, 'BLACK'), white: box(def.white.from, def.white.to, 'WHITE') };
  }

  function paintedShapes(map: CustomMap | null): { zones: BoardZone[]; deploy: BoardDeployment | null } {
    const shape = (cells: { col: number; row: number }[], label: string) => (cells.length ? { cells, label } : undefined);
    const zones = (map?.zones ?? []).filter((z) => z.cells.length).map((z) => ({ name: z.name, cells: z.cells }));
    const black = shape(map?.deploy.black ?? [], 'BLACK');
    const white = shape(map?.deploy.white ?? [], 'WHITE');
    return { zones, deploy: black || white ? { black, white } : null };
  }

  function resolveZoneSet(id: string): { zones: BoardZone[]; deploy: BoardDeployment | null } {
    if (!id) return { zones: [], deploy: null };
    if (id.startsWith('custom:')) return paintedShapes(loadCustomMaps()[id.slice(7)] ?? null);
    if (id.startsWith('mission:')) {
      const m = data.missions.cards.find((c) => c.id === id.slice(8));
      if (!m) return { zones: [], deploy: null };
      return {
        zones: printedZones(m.zones?.map((z) => z.toLowerCase()) ?? []),
        deploy: printedDeployment(data.zoneData.missionDeployment[m.id]),
      };
    }
    const spec = id.startsWith('board:') ? id.slice(6) : '';
    const parts = spec.split('+');
    return {
      zones: parts.includes('zones') ? printedZones() : [],
      deploy: printedDeployment(parts.find((p) => p === 'corners' || p === 'strips')),
    };
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
  function paintBattlefieldLock(): void {
    const locked = battlefieldLocked(normaliseSetup(state.setup));
    const why = 'The battlefield is locked for this game. Press Start game to set up a new one.';
    for (const el of [mapSelect, zoneSelect]) {
      el.disabled = locked;
      el.title = locked ? why : '';
    }
    const zoneBtn = document.getElementById('btn-zones') as HTMLButtonElement | null;
    if (zoneBtn) zoneBtn.disabled = locked && !state.zoneSet;
  }

  function renderZoneOverlay(): void {
    board.renderZones(overlayZones(), overlayDeployment());
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

  function setZoneSet(id: string): void {
    state.zoneSet = id;
    state.showZones = !!id;
    save();
    renderZoneOverlay();
  }

  zoneSelect.addEventListener('change', () => setZoneSet(zoneSelect.value));

  document.getElementById('btn-zones')!.addEventListener('click', () => {
    if (!state.zoneSet) return;
    state.showZones = state.showZones === false;
    save();
    renderZoneOverlay();
  });

  document.getElementById('btn-missions')!.addEventListener('click', () => {
    document.getElementById('mis-dialog')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'mis-dialog';
    const rows = data.missions.cards
      .map((m, i) => {
        const dep = data.zoneData.deployments.find((d) => d.id === data.zoneData.missionDeployment[m.id]);
        const live = state.zoneSet === `mission:${m.id}`;
        return `<div class="scn-row${live ? ' current' : ''}">
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
    </div>`;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('#mis-close')!.addEventListener('click', () => dlg.remove());
    dlg.querySelectorAll<HTMLButtonElement>('.scn-load').forEach((b) =>
      b.addEventListener('click', () => {
        const m = data.missions.cards[Number(b.dataset.i)];
        state.mission = m.id;
        setZoneSet(`mission:${m.id}`);
        document.getElementById('details-body')!.replaceChildren(missionBriefing(m));
        showSideTab('details');
        dlg.remove();
      }),
    );
    document.body.appendChild(dlg);
  });

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
    const vp = `<p class="rp-vp"><b>VP</b> <span class="rp-red">Red ${tally.vp.red}</span> · <span class="rp-blue">Blue ${tally.vp.blue}</span></p>`;
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
    state.markers = result.markers;
    state.smoke = [];
    state.sideNames = result.sideNames;
    state.map = result.mapKey;
    state.removedTerrain = [];
    state.scenario = scn.id;
    state.round = { n: 1, phase: 0, firstPlayer: 'blue' };
    state.commandTokens = { blue: 0, red: 0 };
    state.scale = 'skirmish';
    state.roundLimit = scn.rounds ?? 3;
    selectedUid = null;
    populateMapSelect();
    board.panEnabled = true;

    replay = new ReplayPlayer(script, state, data, {
      onState: () => {
        board.renderTokens(state);
        board.renderMarkers(state.markers ?? []);
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
        state.round = { n: 1, phase: 0, firstPlayer: 'blue' };
        state.commandTokens = { blue: 0, red: 0 };
        state.roundLimit = scn.rounds ?? 5;
        selectedUid = null;
        populateMapSelect();
        renderAll();
        panel.clear();
        document.getElementById('details-body')!.replaceChildren(scenarioBriefing(scn));
        showSideTab('details');
        dlg.remove();
        if (result.warnings.length) {
          void alertDialog({
            title: 'Scenario loaded, with notes',
            body: `"${scn.name}" is set up. A few things did not map cleanly onto the card data:`,
            list: result.warnings,
            closeLabel: 'Continue',
          });
        }
      }),
    );
    document.body.appendChild(dlg);
  });

  document.getElementById('btn-clear')!.addEventListener('click', async () => {
    if (!state.tokens.length && !state.markers?.length && !state.zoneSet) return;
    const n = state.tokens.length;
    const bits = [
      n ? `${n} unit${n === 1 ? '' : 's'}` : '',
      state.markers?.length ? 'all objective markers' : '',
      state.zoneSet ? `the ${zoneSetLabel(state.zoneSet)} overlay` : '',
    ].filter(Boolean);
    const removes = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
    const ok = await confirmDialog({
      title: 'Clear the board?',
      body: `This removes ${removes}. The round track goes back to Round 1 of 5, and terrain and the chosen map are kept.`,
      confirmLabel: 'Clear board',
      danger: true,
    });
    if (!ok) return;
    state.tokens = [];
    state.markers = [];
    state.smoke = [];
    state.sideNames = {};
    state.round = { n: 1, phase: 0, firstPlayer: 'blue' };
    state.commandTokens = { blue: 0, red: 0 };
    state.roundLimit = 5;
    state.scale = 'standard';
    state.zoneSet = '';
    state.showZones = false;
    state.mission = undefined;
    state.scenario = null;
    state.setup = null;
    selectToken(null);
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
  document.getElementById('btn-import-squad')!.addEventListener('click', () => squadFile.click());
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
      const picked = await choiceDialog({
        title: `Import "${squad.name}"?`,
        body: `${parts.join(' and ')}. Which side is it deploying for?`,
        choices: [
          { id: 'blue', label: 'UN (blue)', primary: true },
          { id: 'red', label: 'RDL (red)' },
          { id: 'cancel', label: 'Cancel' },
        ],
      });
      if (picked !== 'blue' && picked !== 'red') {
        squadFile.value = '';
        return;
      }
      const side: Side = picked;
      for (const m of squad.mechs) {
        const tok = makeMechToken(state, data, m.loadout, side, m.name);
        placeNew(tok, side);
      }
      for (const d of squad.drones) {
        const card = data.byId.get(d.cardId);
        if (!card) continue;
        const tok = makeDroneToken(state, data, card, side, d.backpack);
        placeNew(tok, side);
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
          body: `${SIDE_LABEL[side]} was imported, but rulebook 5.1 says a squad may only contain units from a single faction, and a mech may only use parts from one faction.`,
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
          body: `${SIDE_LABEL[side]} now totals ${sidePts} points, which is ${sidePts - sc.points} over the ${sc.name} limit of ${sc.points}.`,
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
  document.getElementById('move-cancel')!.addEventListener('click', () => cancelMove());

  // ---------- keyboard ----------

  document.addEventListener('keydown', (ev) => {
    if (ev.target instanceof Element && ev.target.matches('input,select,textarea')) return;
    if (ev.key === 'Escape') {
      if (movePlan) {
        cancelMove();
        return;
      }
      if (isInspectPinned()) {
        unpinInspect();
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
      let base = 0;
      if (t.kind === 'mech' && t.mech?.chasis) base = data.byId.get(t.mech.chasis)?.move ?? 0;
      else base = data.byId.get(t.cardId)?.move ?? 0;
      if (t.stance === 'mobility') base *= 2;
      if (base > 0) {
        const flying = !!data.byId.get(t.cardId)?.moveAsFlight;
        board.showReachable(reachableGrids(t, base, currentTerrain(), state.tokens, flying), base);
      }
    } else if (k === 'a') {
      board.showArcs(t);
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      state.tokens = state.tokens.filter((x) => x.uid !== t.uid);
      selectToken(null);
      onChanged();
    }
  });

  panel.clear();
  renderCombatIdle();
  renderUnitLog();
  renderAll();
}

init().catch((e) => {
  document.body.innerHTML = `<pre style="padding:2rem;color:#f87171">Failed to start: ${e}</pre>`;
});

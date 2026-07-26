import './styles.css';
import { Board, CELLS, footprint, snapPlacement } from './board';
import { AttackHelper } from './combat';
import { alertDialog, choiceDialog, confirmDialog, promptDialog } from './dialog';
import { DiceTray } from './dice';
import { importSquadFile } from './importer';
import { Inventory } from './inventory';
import { isInspectPinned, showInspect, unpinInspect } from './inspector';
import { dataUrl, loadData, SIDE_LABEL } from './data';
import { deleteCustomMap, loadCustomMaps, makePiece, PALETTE, pieceCells, saveCustomMap, type PaletteItem } from './mapeditor';
import { Panel } from './panel';
import { Roster } from './roster';
import { inArc, losBetween, rangeBetween, reachableGrids } from './rules';
import { instantiateScenario, loadScenarios, type Scenario } from './scenarios';
import { SquadTracker } from './squads';
import { installTooltip, preloadCards } from './tooltip';
import { RoundTracker } from './tracker';
import type { DiceData, Facing, GameState, MechLoadout, Side, TerrainPiece, Token } from './types';
import { SCALES, STATUSES } from './types';
import { factionProblems, makeDroneToken, makeMechToken, migrateState, tokenCards } from './units';

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
  let pendingAttack: { attackerUid: number; actionId: string } | null = null;
  const editor: {
    active: boolean;
    item: PaletteItem | null;
    erase: boolean;
    vertical: boolean;
    working: TerrainPiece[];
    baseline: string;
  } = { active: false, item: null, erase: false, vertical: false, working: [], baseline: '[]' };

  installTooltip();
  preloadCards(data.cards.map((c) => c.id));
  const inventory = new Inventory(data.boxes, () => roster.render());

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
    },
    (t, text) => {
      t.log = [...(t.log ?? []), { round: state.round.n, text }];
      if (t.log.length > 200) t.log = t.log.slice(-200);
      renderUnitLog();
      save();
    },
  );

  const roundTracker = new RoundTracker(document.getElementById('round-tracker')!, () => onChanged());

  const panel = new Panel(data, {
    onRollDice(pool) {
      tray.addToPool(pool, true);
      tray.roll();
    },
    onSpendAmmo(t, actionId) {
      if (t.ammo[actionId] !== undefined && t.ammo[actionId] > 0) {
        t.ammo[actionId]--;
        onChanged();
        if (!attackHelper.active) panel.showToken(t);
      }
    },
    onRestoreAmmo(t, actionId) {
      const max = tokenCards(data, t)
        .flatMap(({ card }) => card.actions ?? [])
        .find((a) => a.id === actionId)?.storage;
      if (t.ammo[actionId] !== undefined && max !== undefined && t.ammo[actionId] < max) {
        t.ammo[actionId]++;
        onChanged();
        if (!attackHelper.active) panel.showToken(t);
      }
    },
    onLaunch(t, projectile) {
      const tok = makeDroneToken(state, data, projectile, t.side);
      const spot = findSpotNear(t, tok.size, tok.aerial);
      if (!spot) {
        void alertDialog({
          title: 'No room to launch',
          body: 'There is no free grid next to the launcher for the projectile. Move the unit, or clear the space around it, and try again.',
        });
        return;
      }
      state.tokens.push({ ...tok, parentUid: t.uid, col: spot.col, row: spot.row, facing: t.facing });
      onChanged();
    },
    onStartAttack(t, actionId) {
      pendingAttack = { attackerUid: t.uid, actionId };
      document.body.classList.add('targeting');
      const hint = document.getElementById('hint')!;
      hint.textContent = '⌖ Click the TARGET unit on the board (Esc cancels)';
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
      if (pendingAttack && uid !== null && uid !== pendingAttack.attackerUid) {
        const attacker = state.tokens.find((x) => x.uid === pendingAttack!.attackerUid);
        const defender = state.tokens.find((x) => x.uid === uid);
        const action = attacker && tokenCards(data, attacker).flatMap(({ card }) => card.actions ?? []).find((a) => a.id === pendingAttack!.actionId);
        endTargeting();
        if (attacker && defender && action) {
          const prot = protectionFor(attacker, defender, action);
          attackHelper.start(attacker, action, defender, losNote(attacker, defender, action), prot.white, prot.note);
          showSideTab('combat');
        }
        return;
      }
      selectToken(uid);
    },
    onMove(uid, col, row) {
      const t = state.tokens.find((x) => x.uid === uid);
      if (!t) return;
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
      const los = losBetween(sel, hov, currentTerrain(), state.tokens);
      board.showRange(sel, hov, `${rangeText(sel, hov)} · ${los}`);
    },
    onCellClick(col, row, erase) {
      if (!editor.active) return;
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
      if (!editor.active) return;
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
      bits.push(los === 'clear' ? 'LOS clear ✓' : los === 'obstructed' ? '⚠ obstructed, so consider +2 White protection' : '✕ LOS blocked (3" terrain)');
    }
    return bits.join(' · ');
  }

  function protectionFor(attacker: Token, defender: Token, action: { type?: string }): { white: number; note: string } {
    if (action.type !== 'Firing') return { white: 0, note: '' };
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

  function endTargeting(): void {
    pendingAttack = null;
    document.body.classList.remove('targeting');
    document.getElementById('hint')!.textContent = 'Drag move · Q/E rotate · M move-range · A arcs · Del remove · hover = range/LOS';
  }

  const roster = new Roster(data, {
    cardFilter: (card) => inventory.passes(card),
    cardBadge: (card) => {
      if (!inventory.hasAny()) return '';
      const n = inventory.ownedCount(card);
      return n > 0 ? ` ×${n}` : ' (not owned)';
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
      if (!attackHelper.active) showSideTab('details');
    } else if (!attackHelper.active) {
      panel.clear();
    }
    renderUnitLog();
    squadTracker.update(state, selectedUid);
  }

  function placeNew(tok: Omit<Token, 'col' | 'row' | 'facing'>, side: Side): void {
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

    if (!action.redDice && !action.yellowDice) {
      renderEffectDetonation(proj, action, name, range, targets);
      return;
    }
    body.innerHTML = `<div class="attack-helper">
      <div class="ah-head"><b>💥 ${escapeHtml(detonateHeading(name, proj.label))}</b>
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

    const draw = (): void => {
      body.innerHTML = `<div class="attack-helper">
        <div class="ah-head"><b>💥 ${escapeHtml(detonateHeading(name, proj.label))}</b>
          <span class="dim">${range === 0 ? 'this grid' : `R${range}`} from ${escapeHtml(proj.label)}</span></div>
        <p class="ah-los">${escapeHtml(text)}</p>
        <div class="ah-step">
          <h4>Mark the units it caught</h4>
          <p class="dim">This detonation causes an effect rather than damage, so there is no attack
            roll. Pick the token it applies, then click each unit inside the blast. The card text
            above is what actually happens; the token is just a reminder on the board.</p>
          <div class="status-row" id="det-status">${STATUSES.map(
            (s) => `<button class="status-chip${s.id === pick ? ' on' : ''}" data-sid="${s.id}"
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
        const cur = new Set(t.statuses ?? []);
        const label = STATUSES.find((s) => s.id === pick)?.label ?? pick;
        if (cur.has(pick)) {
          cur.delete(pick);
          logTo(t, `${label} removed from ${t.label}.`);
        } else {
          cur.add(pick);
          logTo(t, `${name} from ${proj.label}: ${t.label} gains ${label}.`);
        }
        t.statuses = [...cur];
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
        for (const { t } of caught) {
          if ((t.statuses ?? []).includes(pick)) continue;
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

  function findSpotNear(t: Token, size: 1 | 2 | 3, aerial: boolean): { col: number; row: number } | null {
    for (let radius = 1; radius < CELLS; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const s = snapPlacement(t.col + dc, t.row + dr, size);
          if (s && isFree(s.col, s.row, size, aerial)) return s;
        }
      }
    }
    return null;
  }

  function currentTerrain(): TerrainPiece[] {
    if (editor.active) return editor.working;
    if (!state.map) return [];
    const base = state.map.startsWith('custom:') ? loadCustomMaps()[state.map.slice(7)] ?? [] : data.terrain.layouts[state.map] ?? [];
    const removed = state.removedTerrain;
    return removed?.length ? base.filter((p) => !removed.includes(p.id)) : base;
  }

  // ---------- map editor ----------

  const editorBar = document.getElementById('editor-bar')!;

  function renderEditorBar(): void {
    if (!editor.active) {
      editorBar.hidden = true;
      return;
    }
    editorBar.hidden = false;
    const dirty = editorDirty();
    editorBar.innerHTML = `
      <b>MAP EDITOR</b>
      ${PALETTE.map((p) => `<button class="ed-piece${editor.item?.id === p.id ? ' active' : ''}" data-piece="${p.id}" title="${p.label}">${p.label.split(' (')[0]}</button>`).join('')}
      <button id="ed-rotate" class="ed-tool" title="Rotate the armed piece (R)"${editor.item?.rotatable ? '' : ' disabled'}>${editor.vertical ? '↕' : '↔'} R</button>
      <button id="ed-erase" class="ed-tool${editor.erase ? ' active' : ''}" title="Erase tool. Right-click erases too.">⌫ Erase</button>
      <span class="ed-status">${editorStatus()}</span>
      <span class="ed-count">${editor.working.length} piece${editor.working.length === 1 ? '' : 's'}${dirty ? ' · <b>unsaved</b>' : ''}</span>
      <button id="ed-clear"${editor.working.length ? '' : ' disabled'}>Clear all</button>
      ${state.map.startsWith('custom:') ? '<button id="ed-delete" title="Delete this custom map">Delete map</button>' : ''}
      <button id="ed-exit">${dirty ? 'Discard' : 'Close'}</button>
      <button id="ed-save" class="ed-primary">Save map…</button>`;
    editorBar.querySelectorAll<HTMLButtonElement>('.ed-piece').forEach((b) =>
      b.addEventListener('click', () => {
        const picked = PALETTE.find((p) => p.id === b.dataset.piece) ?? null;
        editor.item = editor.item?.id === picked?.id ? null : picked;
        editor.erase = false;
        board.clearGhost();
        renderEditorBar();
      }),
    );
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
      if (
        !n ||
        (await confirmDialog({
          title: 'Remove all terrain?',
          body: `This clears all ${n} piece${n === 1 ? '' : 's'} from the map you are editing.`,
          confirmLabel: 'Remove all',
          danger: true,
        }))
      ) {
        editor.working = [];
        afterEdit();
      }
    });
    editorBar.querySelector('#ed-save')!.addEventListener('click', () => void saveMapFlow());
    editorBar.querySelector('#ed-delete')?.addEventListener('click', async () => {
      const name = state.map.slice(7);
      const ok = await confirmDialog({
        title: `Delete "${name}"?`,
        body: 'The saved map is removed from this browser. Units on the board are left alone.',
        confirmLabel: 'Delete map',
        danger: true,
      });
      if (!ok) return;
      deleteCustomMap(name);
      state.map = '';
      exitEditor();
    });
    editorBar.querySelector('#ed-exit')!.addEventListener('click', () => requestExitEditor());
  }

  function editorStatus(): string {
    if (editor.erase) return 'Erase: click a piece to remove it.';
    if (!editor.item) return 'Pick a piece above, then click the board to place it.';
    const rot = editor.item.rotatable ? ' · R rotates' : '';
    return `Placing ${editor.item.label.split(' (')[0]}. Click the board; right-click erases${rot}.`;
  }

  function editorDirty(): boolean {
    return JSON.stringify(editor.working) !== editor.baseline;
  }

  function afterEdit(): void {
    board.renderTerrain(editor.working, true);
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
    saveCustomMap(name, editor.working);
    state.map = `custom:${name}`;
    exitEditor();
    return true;
  }

  async function requestExitEditor(): Promise<void> {
    if (editorDirty()) {
      const n = editor.working.length;
      const choice = await choiceDialog({
        title: 'Save this map before closing?',
        body: `The map has unsaved changes (${n} piece${n === 1 ? '' : 's'}). Terrain only lives in a saved map, so closing without saving loses it.`,
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
    editor.working = JSON.parse(JSON.stringify(currentTerrain())) as TerrainPiece[];
    editor.baseline = JSON.stringify(editor.working);
    editor.active = true;
    editor.item = null;
    editor.erase = false;
    board.panEnabled = false;
    board.editing = true;
    renderEditorBar();
    board.renderTerrain(editor.working, true);
    board.clearHighlights();
  }

  function exitEditor(): void {
    editor.active = false;
    editor.item = null;
    editor.erase = false;
    board.panEnabled = true;
    board.editing = false;
    board.clearGhost();
    renderEditorBar();
    populateMapSelect();
    save();
    renderAll();
  }

  function save(): void {
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

  function onChanged(): void {
    save();
    board.renderTokens(state);
    board.setSelected(selectedUid);
    squadTracker.update(state, selectedUid);
    roundTracker.update(state);
  }

  function renderAll(): void {
    board.renderTerrain(currentTerrain(), editor.active);
    board.renderMarkers(state.markers ?? []);
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
    save();
    renderAll();
  });

  document.getElementById('btn-mapedit')!.addEventListener('click', () => {
    if (editor.active) exitEditor();
    else enterEditor();
  });

  function openMapManager(): void {
    document.getElementById('map-dialog')?.remove();
    const names = Object.keys(loadCustomMaps()).sort();
    const dlg = document.createElement('div');
    dlg.id = 'map-dialog';
    const rows = names
      .map((n) => {
        const pieces = loadCustomMaps()[n]?.length ?? 0;
        const scn = n.startsWith('[scn] ');
        const inUse = state.map === `custom:${n}`;
        return `<div class="map-row">
          <div class="map-info">
            <b>${scn ? n.slice(6) : n}</b>
            <span class="dim">${scn ? 'from a scenario' : 'saved by you'} · ${pieces} piece${pieces === 1 ? '' : 's'}${inUse ? ' · in use now' : ''}</span>
          </div>
          <button class="map-del" data-name="${n.replace(/"/g, '&quot;')}">Delete</button>
        </div>`;
      })
      .join('');
    const scnCount = names.filter((n) => n.startsWith('[scn] ')).length;
    dlg.innerHTML = `<div class="scn-panel">
      <div class="inv-head"><b>Saved maps</b><button id="map-close">✕</button></div>
      ${
        names.length
          ? `<p class="dim">Loading a scenario saves its board here so you can come back to it. Deleting one only removes it from this list; the scenario itself still loads fine.</p>
             <div class="scn-list">${rows}</div>
             ${scnCount > 1 ? `<div class="map-bulk"><button id="map-del-scn">Delete all ${scnCount} scenario maps</button></div>` : ''}`
          : '<p class="dim">No saved maps yet. Build one in the map editor, or load a scenario.</p>'
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
  document.getElementById('btn-inventory')!.addEventListener('click', () => inventory.openDialog());

  // ---------- scenarios ----------

  const scenarios = await loadScenarios();

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

  document.getElementById('btn-scenarios')!.addEventListener('click', () => {
    document.getElementById('scn-dialog')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'scn-dialog';
    dlg.innerHTML = `<div class="scn-panel">
      <div class="inv-head"><b>Scenarios</b><button id="scn-close">✕</button></div>
      ${scenarios.length ? '' : '<p class="dim">No scenarios found (data/scenarios.json missing).</p>'}
      <div class="scn-list">${scenarios
        .map(
          (s, i) => `<div class="scn-row">
            <div class="scn-info"><b>${s.name}</b><br><span class="dim">${s.subtitle ?? ''}</span></div>
            <button data-i="${i}" class="scn-load">Load</button>
          </div>`,
        )
        .join('')}</div>
    </div>`;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('#scn-close')!.addEventListener('click', () => dlg.remove());
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
        state.sideNames = result.sideNames;
        state.map = result.mapKey;
        state.removedTerrain = [];
        state.round = { n: 1, phase: 0, firstPlayer: 'blue' };
        state.commandTokens = { blue: 0, red: 0 };
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
    if (!state.tokens.length && !state.markers?.length) return;
    const n = state.tokens.length;
    const ok = await confirmDialog({
      title: 'Clear the board?',
      body: `This removes ${n} unit${n === 1 ? '' : 's'} and all objective markers. Terrain and the chosen map are kept.`,
      confirmLabel: 'Clear board',
      danger: true,
    });
    if (!ok) return;
    state.tokens = [];
    state.markers = [];
    state.sideNames = {};
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
      const problems = factionProblems(data, state.tokens.filter((t) => t.side === side));
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

  // ---------- keyboard ----------

  document.addEventListener('keydown', (ev) => {
    if (ev.target instanceof Element && ev.target.matches('input,select,textarea')) return;
    if (ev.key === 'Escape') {
      if (isInspectPinned()) {
        unpinInspect();
        return;
      }
      endTargeting();
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
      const d = k === 'q' ? 3 : 1;
      t.facing = ((t.facing + d) % 4) as Facing;
      onChanged();
      if (!attackHelper.active) panel.showToken(t);
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

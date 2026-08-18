import type { Card, CardAction, Token } from './types';
import { cardImageUrl, cardName, isDiscardCard, mechPartUrl, rulesLines, squadLabel, tabImageUrl, type GameData } from './data';
import { inspectOnHover, linkMechanics } from './inspector';
import { ICON_BOLT } from './icons';
import { expandGlyphs } from './glyphs';
import { groupByFaction, openPartPicker } from './partpicker';
import { type ActionWorld, canBeLoad, guidedActions, isCarrier, isElectronicAttack, knockbackOf, SLOT_LABEL, tokenCards } from './units';
import { costLabel, LENGTH_NAME, lengthOf, TICK_COST } from './ticks';

const ACTION_TINT: Record<string, string> = {
  Swift: 'swift',
  Melee: 'melee',
  Projectile: 'projectile',
  Firing: 'firing',
  Moving: 'movement',
  Tactic: 'tactical',
  Passive: 'passive',
  Immediate: 'immediate',
  Delay: 'delay',
  Detonation: 'detonation',
};

function pipRow(kind: string, label: string, left: number, max: number, attrs: string): string {
  const dots = Array.from({ length: max }, (_, i) => `<i class="pip${i < left ? '' : ' off'}"></i>`).join('');
  return `<span class="pips pips-${kind}${left ? '' : ' spent'}" ${attrs}><b class="pip-label">${label}</b>${dots}<b class="pip-n">${left}/${max}</b></span>`;
}

// A mechanic named rather than explained. linkMechanics finds these by their
// data-mech id and hangs the full glossary text off the hover, so the rule is
// one pointer away instead of a paragraph in the middle of the card.
function mechChips(mechs: { id: string; name: string }[]): string {
  // data-no-cardtip for the same reason the keyword chips carry it: the chip's
  // answer is its rule text, and the card image would land on top of it.
  return mechs.map((m) => `<span class="trait-mech mech-chip" data-mech="${m.id}" data-no-cardtip="1">${m.name}</span>`).join('');
}

function projectileTag(name: string): string {
  const lead = name.trim().split(/[\s"“]/)[0];
  return /\d/.test(lead) && lead.length <= 9 ? lead : name;
}

// Showing the mark itself beats describing it in words, since the reader is
// looking for that symbol on a card.
const SPEED_GLYPH: Record<string, string> = {
  auto: '<span class="act-speed sp-auto">!</span>',
  command: '<span class="act-speed sp-command">?</span>',
};

// The boxed glyph a Drone card prints beside an action name, saying when it
// happens. Mech Parts and Projectiles carry no speed, so they show nothing.
const SPEED_MARK: Record<string, { glyph: string; label: string; lines: string[] }> = {
  auto: {
    glyph: '!',
    label: 'Automatic Action',
    lines: [
      `Printed on the card as ${SPEED_GLYPH.auto} beside the action name.`,
      'It resolves by itself in the Automatic Phase, without being told to.',
      'A Drone that acted on a Command this round does not act again, so spending a Command Token on this unit gives up this action.',
    ],
  },
  command: {
    glyph: '?',
    label: 'Command Action',
    lines: [
      `Printed on the card as ${SPEED_GLYPH.command} beside the action name.`,
      'It only happens if a Command Token is spent on this Drone in the Command Phase.',
      'A commanded Drone acts immediately and either moves or performs one Command Action.',
    ],
  },
  passive: {
    glyph: '∞',
    label: 'Passive',
    lines: ['No speed box is printed beside the name.', 'It is always on and is never chosen, so it costs nothing.'],
  },
};

const STAT_FIELDS: [keyof Card, string][] = [
  ['score', 'Points'],
  ['armor', 'Armor'],
  ['structure', 'Structure'],
  ['dodge', 'Dodge'],
  ['parray', 'Parry'],
  ['electronic', 'Electronic'],
  ['move', 'Move'],
];

export interface PanelCallbacks {
  world(): ActionWorld;
  onRollDice(pool: { s2?: number; yellow?: number }): void;
  onSpendAmmo(t: Token, actionId: string): void;
  onSpendIntercept(t: Token, actionId: string): void;
  onRestoreIntercept(t: Token, actionId: string): void;
  onRestoreAmmo(t: Token, actionId: string): void;
  onLaunch(t: Token, action: CardAction, projectile: Card): void;
  onStartAttack(t: Token, actionId: string): void;
  onStartElectronic(t: Token, actionId: string): void;
  onShowMoveRange(t: Token, steps: number): void;
  onShowActionRange(t: Token, range: number, label: string): void;
  onDetonate(t: Token, actionId: string): void;
  onShove(t: Token, actionId: string): void;
  onCharge(t: Token, slot: string, on: boolean): void;
  // Changing what a Carrier holds. Setup housekeeping rather than a game
  // action - the Load is chosen during list building - so it is offered only in
  // freeplay, where the board is a sandbox.
  onSetLoad?(t: Token, cardId: string | undefined): void;
  // Where in its own Large Grid the unit stands. Offered only when the page
  // supplies a handler — the Match Centre gives one for this seat's units and
  // withholds it for the opponent's.
  onPlaceInGrid?(t: Token, to: { col: number; row: number }): void;
  spotsInGrid?(t: Token): { col: number; row: number; ok: boolean; here: boolean }[];
  tacticNote(t: Token): string | null;
}

export class Panel {
  private data: GameData;
  private body: HTMLElement;
  private cb: PanelCallbacks;
  private shownUid: number | null = null;
  private activeSlot: string | null = null;

  constructor(data: GameData, cb: PanelCallbacks) {
    this.data = data;
    this.cb = cb;
    this.body = document.getElementById('details-body')!;
  }

  clear(): void {
    this.shownUid = null;
    this.activeSlot = null;
    this.body.innerHTML = '<p class="dim">Select a unit on the board, or pick a card from the Add tab.</p>';
  }

  showCard(card: Card): void {
    this.shownUid = null;
    this.activeSlot = null;
    this.body.replaceChildren(this.cardBlock(card));
  }

  // A Carrier's Load, changeable on the board. The Load is really chosen during
  // list building, so this is a setup fix rather than a move: a Tarantula that
  // went down empty can be given its Part without deleting and re-adding it.
  // The 3x3 of Small Grids inside this unit's Large Grid: its own spot marked,
  // the blocked ones dead. Nothing here is a move — the unit never leaves the
  // Grid — so it costs no Range and is legal whenever the unit is standing.
  private gridSpotRow(t: Token): HTMLElement | null {
    const spots = this.cb.spotsInGrid!(t);
    if (spots.length < 2 || !spots.some((s) => s.ok && !s.here)) return null;
    const wrap = document.createElement('div');
    wrap.className = 'tok-spot';
    const label = document.createElement('span');
    label.className = 'tok-spot-name';
    label.textContent = 'Spot in Grid';
    wrap.appendChild(label);
    const pad = document.createElement('div');
    pad.className = 'spot-pad';
    const wide = 3 - t.size + 1;
    pad.style.setProperty('--spot-cols', String(wide));
    for (const s of spots) {
      const b = document.createElement('button');
      b.className = `spot-cell${s.here ? ' here' : ''}`;
      b.disabled = !s.ok || s.here;
      b.title = s.here ? 'Standing here' : s.ok ? 'Stand here' : 'Blocked';
      b.addEventListener('click', () => this.cb.onPlaceInGrid!(t, { col: s.col, row: s.row }));
      pad.appendChild(b);
    }
    wrap.appendChild(pad);
    inspectOnHover(wrap, {
      title: 'Spot in Grid',
      sub: 'inside the Large Grid it already occupies',
      lines: [
        'A Small or Medium unit does not fill its Grid, and Contact is judged where the Small Grids actually touch (4.2.3).',
        'Repositioning inside one Grid costs no Movement Range, so this is free — but it can decide who is in Contact with what.',
        'Grey squares are blocked by terrain or another unit.',
      ],
    });
    return wrap;
  }

  private loadRow(t: Token): HTMLElement {
    const held = t.droneBackpack ? this.data.byId.get(t.droneBackpack) : undefined;
    const row = document.createElement('div');
    row.className = 'tok-load';
    const label = document.createElement('span');
    label.className = 'tok-load-name';
    label.textContent = held ? `Carrying ${cardName(held)}` : 'Carrying nothing';
    const pick = document.createElement('button');
    pick.className = 'tok-load-pick';
    pick.textContent = held ? 'Change' : 'Add a Load';
    pick.addEventListener('click', () => {
      const parts = this.data.cards
        .filter((c) => c.category === 'mech_part' && canBeLoad(c) && !isDiscardCard(c))
        .sort((a, b) => cardName(a).localeCompare(cardName(b)));
      openPartPicker({
        data: this.data,
        slotLabel: `Load for ${t.label}`,
        groups: groupByFaction(this.data, parts),
        chosen: t.droneBackpack,
        lockedFaction: this.data.factionOf(this.data.byId.get(t.cardId)!) ?? null,
        actions: [
          {
            label: 'Carry this',
            run: (card: Card) => this.cb.onSetLoad?.(t, t.droneBackpack === card.id ? undefined : card.id),
          },
        ],
      });
    });
    row.append(label, pick);
    if (held) {
      const off = document.createElement('button');
      off.className = 'tok-load-pick';
      off.textContent = 'Take off';
      off.title = 'A Carrier may stand there empty (FAQ O8).';
      off.addEventListener('click', () => this.cb.onSetLoad?.(t, undefined));
      row.appendChild(off);
    }
    return row;
  }

  showToken(t: Token, focusSlot?: string): void {
    const scroller = this.body.closest<HTMLElement>('.side-tab');
    const sameUnit = this.shownUid === t.uid;
    const keepTop = sameUnit && !focusSlot ? (scroller?.scrollTop ?? 0) : 0;
    this.shownUid = t.uid;
    this.body.replaceChildren();
    const head = document.createElement('p');
    head.className = `token-head side-${t.side}`;
    head.innerHTML = `<b class="th-name"></b><span class="th-meta"></span>`;
    head.querySelector('.th-name')!.textContent = t.label;
    head.querySelector('.th-meta')!.textContent =
      `${squadLabel(t.side)}, ${t.stance.toUpperCase()}, ${['facing N', 'facing E', 'facing S', 'facing W'][t.facing]}`;
    this.body.appendChild(head);

    // A Tactics Card that leaves something owed says so here, because the effect
    // is spent through the normal action flow and nothing else would show it.
    const owed = this.cb.tacticNote(t);
    if (owed) {
      const flag = document.createElement('p');
      flag.className = 'tok-tactic';
      flag.textContent = owed;
      this.body.appendChild(flag);
    }

    // Where it stands INSIDE its Grid. A Small or Medium unit has room to
    // spare there, and which corner it takes decides Contact (4.2.3) — the
    // difference between a Drone merely Adjacent to a wall and one touching
    // it. Movement lands it on a sensible spot; this is how a player argues.
    if (this.cb.onPlaceInGrid && this.cb.spotsInGrid && t.size < 3 && t.deployed !== false) {
      const pad = this.gridSpotRow(t);
      if (pad) this.body.appendChild(pad);
    }

    const carrier = this.data.byId.get(t.cardId);
    if (this.cb.onSetLoad && t.kind === 'drone' && carrier && isCarrier(carrier)) {
      this.body.appendChild(this.loadRow(t));
    }

    // A Passive applies itself; it is not something to press. The card blocks
    // below still print it, which is where a standing rule belongs. But a
    // Passive that CARRIES something — Interception Tokens, a magazine, a
    // Charge — stays, because this list is where its pips and restore buttons
    // live; filtering all of them took the Full-auto Interception counter with
    // it, which is a control, not a choice.
    const actions = guidedActions(this.data, t, this.cb.world())
      .filter((g) => (g.action.type !== 'Passive' && g.action.speed !== 'passive')
        || g.ammoLeft !== undefined || !!g.intercept || !!g.charge);
    if (actions.length) {
      const h = document.createElement('h4');
      h.textContent = 'Actions (from this unit’s parts)';
      this.body.appendChild(h);
      for (const ga of actions) this.body.appendChild(this.actionRow(t, ga));
    }

    const cards = tokenCards(this.data, t);
    if (cards.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'part-tabs';
      const content = document.createElement('div');
      // Each part keeps a stable host. The card inside can be swapped by the
      // projectile flip without the host losing its hidden state, which is what
      // used to leave two cards stacked on top of each other.
      const blocks = cards.map(({ card }) => {
        const host = document.createElement('div');
        host.className = 'part-host';
        host.appendChild(this.cardBlock(card));
        return host;
      });
      const show = (i: number) => {
        blocks.forEach((b, j) => b.classList.toggle('part-hidden', j !== i));
        // Coming back to a part shows the part, not whatever it was flipped to.
        blocks[i].replaceChildren(this.cardBlock(cards[i].card));
      };
      const wanted = focusSlot ?? (sameUnit ? this.activeSlot : null);
      const focusIdx = wanted ? cards.findIndex((c) => c.slot === wanted) : -1;
      const startIdx = focusIdx >= 0 ? focusIdx : 0;
      cards.forEach(({ slot, card: _card }, i) => {
        const b = document.createElement('button');
        const st = t.partStates[slot as keyof Token['partStates']];
        b.textContent = SLOT_LABEL[slot];
        if (st && st !== 'intact') b.classList.add(`tab-${st}`);
        b.addEventListener('click', () => {
          tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          this.activeSlot = slot;
          show(i);
        });
        if (i === startIdx) b.classList.add('active');
        tabs.appendChild(b);
      });
      this.activeSlot = cards[startIdx].slot;
      this.body.appendChild(tabs);
      for (const b of blocks) content.appendChild(b);
      this.body.appendChild(content);
      show(startIdx);
    } else if (cards.length === 1) {
      this.activeSlot = cards[0].slot;
      this.body.appendChild(this.cardBlock(cards[0].card));
    } else {
      this.activeSlot = null;
    }

    if (scroller) {
      scroller.scrollTop = keepTop;
      requestAnimationFrame(() => {
        scroller.scrollTop = keepTop;
      });
    }
  }

  // A card names what it launches through its own `projectile` list; several
  // parts carry more than one, and a Projectile card can itself point onward.
  private projectilesOf(card: Card): Card[] {
    const ids = Array.isArray(card.projectile) ? card.projectile : [];
    const out: Card[] = [];
    for (const id of ids) {
      const p = this.data.byId.get(String(id));
      if (p && p.id !== card.id) out.push(p);
    }
    return out;
  }

  private actionArt(cardId: string): HTMLElement {
    const art = document.createElement('div');
    art.className = 'act-art';
    art.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    const sources = [mechPartUrl(cardId), tabImageUrl(cardId)];
    let next = 0;
    const advance = (): void => {
      if (next < sources.length) img.src = sources[next++];
      else art.remove();
    };
    img.addEventListener('error', advance);
    advance();
    art.appendChild(img);
    return art;
  }

  private actionRow(t: Token, ga: ReturnType<typeof guidedActions>[number]): HTMLElement {
    const { action: a, available, reason, ammoLeft, intercept, charge, projectiles } = ga;
    const row = document.createElement('div');
    row.className = `action${available ? '' : ' unavailable'}`;
    row.dataset.actionRow = a.id;
    row.dataset.tipCard = ga.card.id;
    row.style.setProperty('--t', `var(--t-${ACTION_TINT[a.type ?? ''] ?? 'passive'})`);

    row.appendChild(this.actionArt(ga.card.id));

    const dice: string[] = [];
    if (a.redDice) dice.push(`${a.redDice}R`);
    if (a.yellowDice) dice.push(`${a.yellowDice}Y`);

    // Only Mechs spend Ticks, so only their Actions carry a length worth showing.
    const len = lengthOf(a);
    const cost = len ? TICK_COST[len] : undefined;

    const head = document.createElement('div');
    head.className = 'act-head';
    head.innerHTML = `${
      SPEED_MARK[a.speed ?? ''] ? `<span class="act-speed sp-${a.speed}">${SPEED_MARK[a.speed!].glyph}</span>` : ''
    }<b class="act-name">${a.name.en || a.name.zh || a.id}</b>${
      a.type ? `<span class="act-type">${a.type}</span>` : ''
    }${
      cost
        ? `<span class="act-cost">${LENGTH_NAME[len!]}<i class="tick-pips">${
            cost.maneuver ? '<i class="tick-man"></i>' : ''
          }${'<i class="tick-act"></i>'.repeat(cost.action)}</i></span>`
        : ''
    }`;
    const speedEl = head.querySelector<HTMLElement>('.act-speed');
    if (speedEl && a.speed && SPEED_MARK[a.speed]) {
      inspectOnHover(speedEl, {
        title: SPEED_MARK[a.speed].label,
        sub: a.name.en || a.name.zh || a.id,
        lines: SPEED_MARK[a.speed].lines,
      });
    }
    const costEl = head.querySelector<HTMLElement>('.act-cost');
    if (costEl && cost && len) {
      inspectOnHover(costEl, {
        title: `${LENGTH_NAME[len]} Action`,
        sub: `${a.name.en || a.name.zh || a.id} · costs ${costLabel(cost)}`,
        lines: [
          'A Mech generates 1 Maneuver Tick and 2 Action Ticks each time it receives an Action Opportunity (rulebook 3.4.5).',
          'Short costs 1 Action Tick, Medium costs 2, and Long costs the Maneuver Tick plus both Action Ticks, so a Long Action rules out Maneuvering.',
          'Ticks are spent in order: the Maneuver Tick is unusable once any Action Tick has gone.',
          'The first Action of an Opportunity is the Starting Action and its type must match the Timing Dial. Later Actions in the same Opportunity have no type restriction.',
        ],
      });
    }

    const info = document.createElement('div');
    info.className = 'action-info';
    const range = a.range === 0 ? 'R --' : a.range ? `R ${a.range}` : '';
    info.innerHTML = `<span class="dim"><span class="act-slot">${SLOT_LABEL[ga.slot]}</span>${[range, dice.join('+')]
      .filter(Boolean)
      .map((s) => ` · ${s}`)
      .join('')}</span>
      <div class="act-chips">
        ${ammoLeft !== undefined ? pipRow('ammo', 'AMO', ammoLeft, a.storage ?? 0, `data-reload="${a.id}"`) : ''}
        ${intercept ? pipRow('intercept', 'INT', intercept.left, intercept.max, `data-restore-int="${a.id}"`) : ''}
        ${charge ? pipRow('charge', 'CHG', charge.charged ? 1 : 0, 1, `data-charge="${ga.slot}"`) : ''}
      </div>
      ${!available && reason ? `<span class="reason">${reason}</span>` : ''}
      ${available && intercept && !intercept.can && intercept.reason ? `<span class="reason">${intercept.reason}</span>` : ''}`;
    const actName = a.name.en || a.name.zh || a.id;
    const rawEn = a.description?.en?.trim();
    const en = rawEn && !/[぀-ヿ一-鿿]/.test(rawEn) ? rawEn : undefined;
    const orig = a.description?.zh?.trim() || a.description?.jp?.trim();
    const tr = this.data.actionTranslation(a.id);
    const mechs = this.data.mechanicsFor(actName, a.name.zh, en, orig);
    const lines: string[] = [];
    if (en) {
      lines.push(...rulesLines(en));
    } else if (tr?.english) {
      const caveat = tr.confidence !== 'high' ? ` <em>(${tr.confidence}-confidence translation, so verify it against the card)</em>` : '';
      lines.push(`${tr.english}${caveat}`);
      lines.push('<em>Translated from the Chinese card text, not official English.</em>');
    } else if (orig) {
      lines.push(...rulesLines(orig));
      lines.push('<em>(the card data has no English for this action)</em>');
    } else {
      lines.push('<em>No rules text on this card in the data; the values above come from the card.</em>');
    }
    // The action's own tip still spells the mechanics out in full: it is
    // already a hover, so there is nothing further to hover into.
    for (const m of mechs) lines.push(`<b>${m.name}</b>${m.ref ? ` <em>(${m.ref})</em>` : ''}: ${m.text}`);
    const tip = {
      title: actName,
      sub: [SLOT_LABEL[ga.slot], a.type, range, dice.join('+')].filter(Boolean).join(' · '),
      lines,
    };
    // The action row already answers a hover with the card image, which in the
    // Match Centre would sit on top of the popout. The board page shows both
    // without collision, so it keeps them.
    const pin = { pinKey: `action:${t.uid}:${a.id}`, floating: false };
    inspectOnHover(head, tip, pin);
    inspectOnHover(info, tip, pin);
    const ammoPips = info.querySelector<HTMLElement>('[data-reload]');
    if (ammoPips) {
      inspectOnHover(ammoPips, {
        title: 'Ammo',
        sub: `${ammoLeft}/${a.storage} · ${actName}`,
        lines: [
          'Round Token on the Part Card. One comes off every time the Action is used, and the Action stops working at zero.',
          'The app spends these for you when you use the Action. Click here to put one back if you spent it by mistake.',
        ],
      }, { floating: false });
      ammoPips.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.cb.onRestoreAmmo(t, a.id);
      });
    }
    const intPips = info.querySelector<HTMLElement>('[data-restore-int]');
    if (intPips && intercept) {
      inspectOnHover(intPips, {
        title: 'Interception Tokens',
        sub: `${intercept.left}/${intercept.max} · ${actName}`,
        lines: [
          'Round Tokens placed on this Part Card during the Deployment Phase, one per point of Intercept X.',
          'Each Interception spends one and they are never restored, so once the Part is empty it cannot Intercept again for the rest of the game (rulebook 4.9).',
          'Click here to put one back if you spent it by mistake.',
        ],
      }, { floating: false });
      intPips.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.cb.onRestoreIntercept(t, a.id);
      });
    }
    const chgPips = info.querySelector<HTMLElement>('[data-charge]');
    if (chgPips && charge) {
      inspectOnHover(chgPips, {
        title: 'Charge Token',
        sub: `${charge.charged ? 'face-up, Charged' : 'face-down, not Charged'} · ${actName}`,
        lines: [
          'One Charge Token sits on this Part Card from the start of the game, face-down, meaning the Action has not been Charged (rulebook 4.14).',
          'The Charge Action flips it face-up, and only one Part may be Charged per Charge Action. A Part that is already Charged cannot be Charged again until the token is spent.',
          'While it is face-up, performing this Action may consume it to apply the effect its text marks as [Charged].',
          'Click here to flip it by hand.',
        ],
      }, { floating: false });
      chgPips.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.cb.onCharge(t, ga.slot, !charge.charged);
      });
    }
    const chipRow = info.querySelector<HTMLElement>('.act-chips')!;
    if (a.keywords?.length) for (const chip of [...this.keywordChips(a.keywords).children]) chipRow.appendChild(chip);
    if (!chipRow.childElementCount) chipRow.remove();
    row.appendChild(head);

    const body = document.createElement('div');
    body.className = 'act-body';
    body.appendChild(info);
    row.appendChild(body);

    const btns = document.createElement('div');
    btns.className = 'action-btns';
    const isAttack = a.type === 'Firing' || a.type === 'Melee';
    if (available && isAttack && (a.redDice || a.yellowDice)) {
      const atk = document.createElement('button');
      atk.className = 'attack-btn';
      atk.innerHTML = '<i class="btn-ico">⌖</i> Attack…';
      inspectOnHover(atk, {
        title: 'Attack',
        sub: actName,
        lines: [
          'Click this, then click the target unit on the board to open the guided attack.',
          'The wizard walks the rulebook 4.4 sequence: range and arc, line of sight, protection, then the roll.',
        ],
      });
      atk.addEventListener('click', () => {
        this.cb.onStartAttack(t, a.id);
        if (ammoLeft !== undefined) this.cb.onSpendAmmo(t, a.id);
      });
      btns.appendChild(atk);
    }
    if (available && isElectronicAttack(a)) {
      const ew = document.createElement('button');
      ew.className = 'attack-btn';
      ew.innerHTML = `<i class="btn-ico bolt-gold">${ICON_BOLT}</i> Electronic Attack…`;
      inspectOnHover(ew, {
        title: 'Electronic Attack',
        sub: actName,
        lines: [
          'Click this, then click the target unit on the board to open the guided Counter-roll.',
          'Electronic Warfare ignores terrain and line of sight. Range is the only restriction.',
        ],
      });
      ew.addEventListener('click', () => {
        this.cb.onStartElectronic(t, a.id);
        if (ammoLeft !== undefined) this.cb.onSpendAmmo(t, a.id);
      });
      btns.appendChild(ew);
    }
    if (intercept?.can) {
      const int = document.createElement('button');
      int.className = 'intercept-btn';
      int.innerHTML = `<i class="btn-ico">⊘</i> Intercept… (${intercept.left})`;
      inspectOnHover(int, {
        title: 'Intercept',
        sub: `${intercept.left} of ${intercept.max} left · ${actName}`,
        lines: [
          'Spends 1 Interception Token to attack an enemy Missile or Projectile that moved or launched within Range (rulebook 4.9).',
          'Pick the target on the board. It attacks as a Firing Attack, except the target must be the unit that triggered it, no Forward Arc is needed, line of sight always exists, and no Terrain or Unit Protection applies.',
          'If the target survives, this unit MUST intercept again until its tokens run out or the target is destroyed.',
          'Tokens are never restored, so this Part gets a fixed number of Interceptions for the whole game.',
        ],
      });
      int.addEventListener('click', () => this.cb.onSpendIntercept(t, a.id));
      btns.appendChild(int);
    }
    // Knockback riding on a Movement Action can be resolved on its own here, so
    // the shove is reachable without going through the guide.
    const shove = a.type === 'Moving' ? knockbackOf(a, this.data.actionTranslation(a.id)?.english ?? undefined) : undefined;
    if (available && shove) {
      const sh = document.createElement('button');
      sh.className = 'shove-btn';
      sh.innerHTML = `<i class="btn-ico">⇥</i> ${shove.push ? `Push ${shove.grids}` : `Shove ${shove.grids}`}…`;
      inspectOnHover(sh, {
        title: shove.push ? 'Push' : 'Shove',
        sub: actName,
        lines: [
          `Forces the enemy Ground Unit in the Grid this Mech faces ${shove.grids} Grid${shove.grids === 1 ? '' : 's'} straight back.`,
          shove.push ? 'The target also loses 1 Link.' : '',
          'The target stops early if something blocks the path, and a unit in Melee Lock cannot be forced out of it.',
        ],
      });
      sh.addEventListener('click', () => this.cb.onShove(t, a.id));
      btns.appendChild(sh);
    }
    if (available && a.type === 'Moving' && a.range) {
      const mv = document.createElement('button');
      mv.textContent = `Show range (${a.range})`;
      inspectOnHover(mv, {
        title: `Movement range ${a.range}`,
        sub: actName,
        lines: [
          `Highlights every Grid this unit could reach with ${actName}, counting ${a.range} Grid${a.range === 1 ? '' : 's'} of movement.`,
          'Difficult terrain costs extra to enter and Melee Lock adds the Break Away cost, so the reachable area can be smaller than the raw number.',
        ],
      });
      mv.addEventListener('click', () => this.cb.onShowMoveRange(t, a.range!));
      btns.appendChild(mv);
    }
    if (a.range && a.type !== 'Moving') {
      const rng = document.createElement('button');
      rng.textContent = `Show R${a.range}`;
      inspectOnHover(rng, {
        title: `Range ${a.range}`,
        sub: actName,
        lines: [
          `Highlights every Grid within Range ${a.range} of this unit.`,
          'Range is large-grid distance only, so line of sight and the firing arc still have to be checked on top of it.',
        ],
      });
      rng.addEventListener('click', () => this.cb.onShowActionRange(t, a.range!, actName));
      btns.appendChild(rng);
    }
    if (available && t.kind === 'projectile' && a.type !== 'Passive') {
      const det = document.createElement('button');
      det.className = 'detonate-btn';
      det.innerHTML = '<i class="btn-ico">💥</i> Detonate…';
      det.title = (a.redDice || a.yellowDice)
        ? 'Resolve this projectile: pick a unit in range and deal Explosion damage'
        : 'Resolve this projectile: apply its effect to the units in range';
      det.addEventListener('click', () => this.cb.onDetonate(t, a.id));
      btns.appendChild(det);
    }
    if (available && (a.redDice || a.yellowDice)) {
      const roll = document.createElement('button');
      roll.textContent = `Roll ${dice.join('+')}`;
      roll.title = `Roll ${dice.join(' and ')} in the dice tray`;
      roll.addEventListener('click', () => {
        this.cb.onRollDice({ s2: a.redDice, yellow: a.yellowDice });
        if (!isAttack && ammoLeft !== undefined) this.cb.onSpendAmmo(t, a.id);
      });
      btns.appendChild(roll);
    } else if (available && ammoLeft !== undefined && !projectiles.length) {
      const use = document.createElement('button');
      use.textContent = 'Use';
      inspectOnHover(use, { title: 'Use', sub: actName, lines: ['Performs this Action and consumes 1 Ammo Token.'] });
      use.addEventListener('click', () => this.cb.onSpendAmmo(t, a.id));
      btns.appendChild(use);
    }
    for (const p of projectiles) {
      if (!available) break;
      const launch = document.createElement('button');
      launch.className = 'launch-btn';
      launch.textContent = projectiles.length > 1 ? `Launch ${projectileTag(cardName(p))}…` : 'Launch…';
      inspectOnHover(launch, {
        title: `Launch ${cardName(p)}`,
        sub: actName,
        lines: [
          'Shows the Landing Points in range, then places the projectile on the Grid you click. A Landing Point is a Grid, not a unit (rulebook 4.7.1).',
          ammoLeft !== undefined ? 'Spends 1 Ammo Token per projectile placed.' : '',
        ].filter(Boolean),
      });
      // The launch flow spends the Ammo itself, once per projectile actually
      // placed, so nothing is deducted here.
      launch.addEventListener('click', () => this.cb.onLaunch(t, a, p));
      btns.appendChild(launch);
    }
    body.appendChild(btns);
    return row;
  }

  private keywordChips(list: { key?: string; en?: string; inline?: string }[]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'kw-chips';
    const seen = new Set<string>();
    for (const k of list) {
      const shown = (k.en || k.inline || k.key || '').replace(/^[•·\s]+/, '');
      if (!shown || seen.has(shown)) continue;
      seen.add(shown);
      const def = this.data.keyword(k.key || k.inline || k.en || '');
      const chip = document.createElement('span');
      const label = def?.en?.name?.replace(/^[•·\s]+/, '') || shown;
      const num = /(\d+)\s*$/.exec(shown)?.[1];
      chip.className = `kw-chip${def?.en?.value ? '' : ' kw-unknown'}`;
      // Suppresses the card image for this chip only, so the keyword's rule is
      // readable instead of being covered by the art of the card it sits on.
      chip.dataset.noCardtip = '1';
      chip.textContent = !num
        ? label
        : /\bX\b/.test(label)
          ? label.replace(/\bX\b/, num)
          : /\d/.test(label)
            ? label
            : `${label} ${num}`;
      if (def?.en?.value) {
        const isTag = /tag on the card banner/.test(def.en.value);
        inspectOnHover(
          chip,
          {
            title: chip.textContent,
            sub: isTag ? 'Card type tag' : 'Keyword (rulebook glossary)',
            lines: [def.en.value, num ? `Here X = ${num}.` : ''],
          },
          { pinKey: `kw:${def.key}` },
        );
      } else {
        inspectOnHover(chip, { title: shown, sub: 'Keyword', lines: ['No English glossary text available for this keyword yet.'] });
      }
      box.appendChild(chip);
    }
    return box;
  }

  private cardBlock(card: Card, back?: { card: Card; label: string }): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'card-block';

    // A launcher names its Projectile in the action text but never shows it, so
    // the art doubles as a flip: forward to what it fires, back to the Part.
    const shot = wrap.appendChild(document.createElement('div'));
    shot.className = 'card-shot';
    const img = document.createElement('img');
    img.className = 'card-img';
    img.src = cardImageUrl(card.id);
    img.alt = cardName(card);
    img.addEventListener('error', () => img.remove(), { once: true });
    shot.appendChild(img);

    const flipTo = (next: Card, backTo?: { card: Card; label: string }) => {
      wrap.replaceWith(this.cardBlock(next, backTo));
    };
    if (back) {
      const prev = document.createElement('button');
      prev.className = 'card-flip prev';
      prev.innerHTML = '‹';
      prev.title = `Back to ${back.label}`;
      prev.setAttribute('aria-label', prev.title);
      prev.addEventListener('click', () => flipTo(back.card));
      shot.appendChild(prev);
    }
    // A launcher can carry several rounds, so the arrow steps through them and
    // the last one wraps back to the first rather than dead-ending.
    const shots = back ? this.projectilesOf(back.card) : this.projectilesOf(card);
    const here = back ? shots.findIndex((p) => p.id === card.id) : -1;
    const upcoming = shots[here + 1] ?? (back && shots.length > 1 ? shots[0] : shots[0]);
    if (upcoming && upcoming.id !== card.id) {
      const home = back ?? { card, label: cardName(card) };
      const next = document.createElement('button');
      next.className = 'card-flip next';
      next.innerHTML = '›';
      next.title = shots.length > 1
        ? `Show ${cardName(upcoming)} (${shots.indexOf(upcoming) + 1} of ${shots.length})`
        : `Show ${cardName(upcoming)}`;
      next.setAttribute('aria-label', next.title);
      next.addEventListener('click', () => flipTo(upcoming, home));
      shot.appendChild(next);
    }

    const h = document.createElement('h3');
    h.textContent = cardName(card);
    wrap.appendChild(h);

    const stats = document.createElement('div');
    stats.className = 'stats';
    for (const [key, label] of STAT_FIELDS) {
      const v = card[key];
      if (typeof v !== 'number') continue;
      const s = document.createElement('span');
      s.innerHTML = `<b>${v}</b>${label}`;
      stats.appendChild(s);
    }
    if (card.category === 'pilot') {
      const lv = card.LV;
      if (typeof lv === 'number') {
        const s = document.createElement('span');
        s.innerHTML = `<b>${lv}</b>Link`;
        stats.appendChild(s);
      }
      for (const k of ['swift', 'melee', 'projectile', 'firing', 'moving', 'tactic'] as const) {
        const v = card[k];
        if (typeof v !== 'number') continue;
        const s = document.createElement('span');
        s.innerHTML = `<b>${v}</b>${k === 'moving' ? 'move' : k}`;
        stats.appendChild(s);
      }
    }
    wrap.appendChild(stats);

    // Rules printed on the card rather than on one of its Actions. A "White
    // Dwarf" Bit reads "· Low Value · High Altitude", and that line is the whole
    // reason it may not take a Task Item, so it cannot be left off the panel.
    // Four cards ship description.en as a straight copy of the Chinese, so an
    // `en || zh` fallback printed CJK at an English reader. Same guard the
    // Actions below already use, with the same translation table behind it —
    // and if there is neither, the keyword chips at the bottom of the card
    // still name the rule, which is better than a paragraph nobody can read.
    const rawSelf = card.description?.en?.trim();
    const selfEn = rawSelf && !/[぀-ヿ一-鿿]/.test(rawSelf) ? rawSelf : undefined;
    const selfTr = this.data.cardTranslation(card.id)?.english?.trim() || undefined;
    const cardText = selfEn ?? selfTr;
    if (cardText && card.category !== 'pilot') {
      const note = document.createElement('div');
      note.className = 'card-selftext';
      const lines = rulesLines(cardText);
      // A named chip, not the whole glossary entry: the rule reads on hover
      // (bottom-left box on the board page, popout here) so the card's own text
      // is not buried under a paragraph explaining a keyword beside it.
      const mechs = mechChips(this.data.mechanicsFor(card.description?.en, card.description?.zh));
      note.innerHTML = `${lines.length > 1 ? `<ul class="rules-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : `<span>${lines[0] ?? ''}</span>`}${mechs}`;
      wrap.appendChild(note);
    }

    const traitDesc = card.traitDescription?.en || card.traitDescription?.zh;
    const hasTrait = !!card.trait?.trim();
    if (hasTrait || traitDesc) {
      const trait = document.createElement('div');
      trait.className = `pilot-trait${hasTrait ? '' : ' pilot-flavour'}`;
      const head = hasTrait ? `Pilot Trait <i>${card.trait}</i>` : 'No trait ability';
      const bullets = rulesLines(traitDesc);
      const text =
        bullets.length > 1
          ? `<ul class="rules-list">${bullets.map((l) => `<li>${l}</li>`).join('')}</ul>`
          : (bullets[0] ?? '');
      // Same reason as the reference: a trait may name a mechanic rather than a
      // keyword, and Crush on Onyx is unreadable without the rule beside it.
      const mechHtml = mechChips(hasTrait ? this.data.mechanicsFor(traitDesc, card.trait) : []);
      const body = hasTrait ? text : `${text}<em>This pilot has no trait ability. The line above is card flavour text.</em>`;
      trait.innerHTML = `<b>${head}</b>${traitDesc ? `<span>${body}</span>` : ''}${mechHtml}`;
      wrap.appendChild(trait);
    }

    for (const a of card.actions ?? []) {
      const rawEn = a.description?.en?.trim();
      const en = rawEn && !/[぀-ヿ一-鿿]/.test(rawEn) ? rawEn : undefined;
      const tr = this.data.actionTranslation(a.id);
      const text = en ?? tr?.english ?? a.description?.zh?.trim();
      if (!text) continue;
      const dice = [a.redDice ? `${a.redDice}R` : '', a.yellowDice ? `${a.yellowDice}Y` : '']
        .filter(Boolean)
        .join('+');
      const alen = lengthOf(a);
      const acost = alen ? `${LENGTH_NAME[alen]} (${costLabel(TICK_COST[alen])})` : '';
      const meta = [a.type, acost, a.range ? `R ${a.range}` : '', dice].filter(Boolean).join(' · ');
      const row = document.createElement('div');
      row.className = 'card-action';
      const bullets = rulesLines(text);
      // Some actions print only their keyword as the description ("· KC Armor"),
      // which tells a reader nothing. Fall through to the glossary rules text.
      const spelled = bullets.length === 1
        && bullets[0].trim().toLowerCase() === (a.name.en || a.name.zh || '').trim().toLowerCase()
        ? this.data.keyword(bullets[0])?.en?.value
        : undefined;
      row.innerHTML = `<b>${a.name.en || a.name.zh || a.id}</b>${meta ? `<span class="dim"> ${meta}</span>` : ''}${
        spelled
          ? `<span>${expandGlyphs(spelled)}</span>`
          : bullets.length > 1
            ? `<ul class="rules-list">${bullets.map((l) => `<li>${expandGlyphs(l)}</li>`).join('')}</ul>`
            : `<span>${expandGlyphs(bullets[0] ?? text)}</span>`
      }`;
      wrap.appendChild(row);
    }

    if (card.keywords?.length) {
      wrap.appendChild(this.keywordChips(card.keywords));
    }
    // Every mechChip in the card, in one pass at the end: the chips are written
    // as markup in several places above and this is the only thing that gives
    // them their words.
    linkMechanics(wrap, this.data.mechanics);
    return wrap;
  }
}

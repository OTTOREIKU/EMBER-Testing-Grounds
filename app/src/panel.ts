import type { Card, CardAction, Token } from './types';
import { cardImageUrl, cardName, mechPartUrl, rulesLines, SIDE_LABEL, tabImageUrl, type GameData } from './data';
import { inspectOnHover } from './inspector';
import { type ActionWorld, guidedActions, isElectronicAttack, knockbackOf, SLOT_LABEL, tokenCards } from './units';
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

function projectileTag(name: string): string {
  const lead = name.trim().split(/[\s"“]/)[0];
  return /\d/.test(lead) && lead.length <= 9 ? lead : name;
}

// The boxed glyph a Drone card prints beside an action name, saying when it
// happens. Mech Parts and Projectiles carry no speed, so they show nothing.
const SPEED_MARK: Record<string, { glyph: string; label: string; lines: string[] }> = {
  auto: {
    glyph: '!',
    label: 'Automatic Action',
    lines: [
      'Printed on the card as a boxed ! beside the action name.',
      'It resolves by itself in the Automatic Phase, without being told to.',
      'A Drone that acted on a Command this round does not act again, so spending a Command Token on this unit gives up this action.',
    ],
  },
  command: {
    glyph: '?',
    label: 'Command Action',
    lines: [
      'Printed on the card as a boxed ? beside the action name.',
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
  onRollDice(pool: { red?: number; yellow?: number }): void;
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
      `${SIDE_LABEL[t.side]}, ${t.stance.toUpperCase()}, ${['facing N', 'facing E', 'facing S', 'facing W'][t.facing]}`;
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

    const actions = guidedActions(this.data, t, this.cb.world());
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
      const blocks = cards.map(({ card }) => this.cardBlock(card));
      const show = (i: number) => blocks.forEach((b, j) => b.classList.toggle('part-hidden', j !== i));
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
    for (const m of mechs) lines.push(`<b>${m.name}</b>${m.ref ? ` <em>(${m.ref})</em>` : ''}: ${m.text}`);
    const tip = {
      title: actName,
      sub: [SLOT_LABEL[ga.slot], a.type, range, dice.join('+')].filter(Boolean).join(' · '),
      lines,
    };
    const pin = { pinKey: `action:${t.uid}:${a.id}` };
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
      });
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
      });
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
      });
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
      ew.innerHTML = '<i class="btn-ico">⚡</i> Electronic Attack…';
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
        this.cb.onRollDice({ red: a.redDice, yellow: a.yellowDice });
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

  private cardBlock(card: Card): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'card-block';

    const img = document.createElement('img');
    img.className = 'card-img';
    img.src = cardImageUrl(card.id);
    img.alt = cardName(card);

    img.addEventListener('error', () => img.remove(), { once: true });
    wrap.appendChild(img);

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
      const body = hasTrait ? text : `${text}<em>This pilot has no trait ability. The line above is card flavour text.</em>`;
      trait.innerHTML = `<b>${head}</b>${traitDesc ? `<span>${body}</span>` : ''}`;
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
      row.innerHTML = `<b>${a.name.en || a.name.zh || a.id}</b>${meta ? `<span class="dim"> ${meta}</span>` : ''}${
        bullets.length > 1
          ? `<ul class="rules-list">${bullets.map((l) => `<li>${l}</li>`).join('')}</ul>`
          : `<span>${bullets[0] ?? text}</span>`
      }`;
      wrap.appendChild(row);
    }

    if (card.keywords?.length) {
      wrap.appendChild(this.keywordChips(card.keywords));
    }
    return wrap;
  }
}

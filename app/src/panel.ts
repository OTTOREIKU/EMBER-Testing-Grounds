import type { Card, Token } from './types';
import { cardImageUrl, cardName, mechPartUrl, rulesLines, SIDE_LABEL, tabImageUrl, type GameData } from './data';
import { inspectOnHover } from './inspector';
import { guidedActions, isElectronicAttack, SLOT_LABEL, tokenCards } from './units';

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
  onRollDice(pool: { red?: number; yellow?: number }): void;
  onSpendAmmo(t: Token, actionId: string): void;
  onRestoreAmmo(t: Token, actionId: string): void;
  onLaunch(t: Token, projectile: Card): void;
  onStartAttack(t: Token, actionId: string): void;
  onStartElectronic(t: Token, actionId: string): void;
  onShowMoveRange(t: Token, steps: number): void;
  onShowActionRange(t: Token, range: number, label: string): void;
  onDetonate(t: Token, actionId: string): void;
}

export class Panel {
  private data: GameData;
  private body: HTMLElement;
  private cb: PanelCallbacks;

  constructor(data: GameData, cb: PanelCallbacks) {
    this.data = data;
    this.cb = cb;
    this.body = document.getElementById('details-body')!;
  }

  clear(): void {
    this.body.innerHTML = '<p class="dim">Select a unit on the board, or pick a card from the Add tab.</p>';
  }

  showCard(card: Card): void {
    this.body.replaceChildren(this.cardBlock(card));
  }

  showToken(t: Token, focusSlot?: string): void {
    this.body.replaceChildren();
    const head = document.createElement('p');
    head.className = `token-head side-${t.side}`;
    head.textContent = `${t.label} · ${SIDE_LABEL[t.side]}, ${t.stance.toUpperCase()}, ${['facing N', 'facing E', 'facing S', 'facing W'][t.facing]}`;
    this.body.appendChild(head);

    const actions = guidedActions(this.data, t);
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
      const show = (card: Card) => content.replaceChildren(this.cardBlock(card));
      const focusIdx = focusSlot ? cards.findIndex((c) => c.slot === focusSlot) : -1;
      const startIdx = focusIdx >= 0 ? focusIdx : 0;
      cards.forEach(({ slot, card }, i) => {
        const b = document.createElement('button');
        const st = t.partStates[slot as keyof Token['partStates']];
        b.textContent = SLOT_LABEL[slot];
        if (st && st !== 'intact') b.classList.add(`tab-${st}`);
        b.addEventListener('click', () => {
          tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          show(card);
        });
        if (i === startIdx) b.classList.add('active');
        tabs.appendChild(b);
      });
      this.body.appendChild(tabs);
      this.body.appendChild(content);
      show(cards[startIdx].card);
    } else if (cards.length === 1) {
      this.body.appendChild(this.cardBlock(cards[0].card));
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
    const { action: a, available, reason, ammoLeft, projectiles } = ga;
    const row = document.createElement('div');
    row.className = `action${available ? '' : ' unavailable'}`;
    row.dataset.tipCard = ga.card.id;
    row.style.setProperty('--t', `var(--t-${ACTION_TINT[a.type ?? ''] ?? 'passive'})`);

    row.appendChild(this.actionArt(ga.card.id));

    const dice: string[] = [];
    if (a.redDice) dice.push(`${a.redDice}R`);
    if (a.yellowDice) dice.push(`${a.yellowDice}Y`);

    const head = document.createElement('div');
    head.className = 'act-head';
    head.innerHTML = `<b class="act-name">${a.name.en || a.name.zh || a.id}</b>${
      a.type ? `<span class="act-type">${a.type}</span>` : ''
    }`;

    const info = document.createElement('div');
    info.className = 'action-info';
    const range = a.range === 0 ? 'R --' : a.range ? `R ${a.range}` : '';
    info.innerHTML = `<span class="dim"><span class="act-slot">${SLOT_LABEL[ga.slot]}</span>${[range, dice.join('+')]
      .filter(Boolean)
      .map((s) => ` · ${s}`)
      .join('')}</span>
      ${
        ammoLeft !== undefined
          ? `<span class="ammo" data-reload="${a.id}" title="Ammo ${ammoLeft}/${a.storage}. Spent automatically when the action is used; click to put one back.">${'●'.repeat(ammoLeft)}${'○'.repeat((a.storage ?? 0) - ammoLeft)}</span>`
          : ''
      }
      ${!available && reason ? `<span class="reason">${reason}</span>` : ''}`;
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
    info.querySelector('[data-reload]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.cb.onRestoreAmmo(t, a.id);
    });
    if (a.keywords?.length) info.appendChild(this.keywordChips(a.keywords));
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
      atk.title = 'Guided attack: click this, then click the target unit on the board';
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
      ew.title = 'Guided Electronic Counter-roll: click this, then click the target unit on the board';
      ew.addEventListener('click', () => {
        this.cb.onStartElectronic(t, a.id);
        if (ammoLeft !== undefined) this.cb.onSpendAmmo(t, a.id);
      });
      btns.appendChild(ew);
    }
    if (available && a.type === 'Moving' && a.range) {
      const mv = document.createElement('button');
      mv.textContent = `Show range (${a.range})`;
      mv.addEventListener('click', () => this.cb.onShowMoveRange(t, a.range!));
      btns.appendChild(mv);
    }
    if (a.range && a.type !== 'Moving') {
      const rng = document.createElement('button');
      rng.textContent = `Show R${a.range}`;
      rng.title = `Highlight every grid within Range ${a.range}. Range is large-grid distance only, so line of sight and firing arc still apply.`;
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
      roll.addEventListener('click', () => {
        this.cb.onRollDice({ red: a.redDice, yellow: a.yellowDice });
        if (!isAttack && ammoLeft !== undefined) this.cb.onSpendAmmo(t, a.id);
      });
      btns.appendChild(roll);
    } else if (available && ammoLeft !== undefined && !projectiles.length) {
      const use = document.createElement('button');
      use.textContent = 'Use';
      use.title = 'Perform this action and consume 1 Ammo';
      use.addEventListener('click', () => this.cb.onSpendAmmo(t, a.id));
      btns.appendChild(use);
    }
    for (const p of projectiles) {
      if (!available) break;
      const launch = document.createElement('button');
      launch.textContent = `Launch ${cardName(p)}`;
      launch.title = `Places the projectile token next to this unit, then drag it to its Landing Point grid.${
        ammoLeft !== undefined ? ' Consumes 1 Ammo.' : ''
      }`;
      launch.addEventListener('click', () => {
        this.cb.onLaunch(t, p);
        if (ammoLeft !== undefined) this.cb.onSpendAmmo(t, a.id);
      });
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
    img.loading = 'lazy';
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
      const meta = [a.type, a.range ? `R ${a.range}` : '', dice].filter(Boolean).join(' · ');
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

import type { GameData } from './data';
import { cardName } from './data';
import { iconSvg } from './dice';
import { linkMechanics } from './inspector';
import type { Card, CardAction, DiceData, DiceIcon, DieColor, GameRuleEffect, PartSlot, Token } from './types';
import { addStatus, statusCount, STATUSES } from './types';
import { electronicValue, SLOT_LABEL, tokenCards } from './units';

type Step = 'part' | 'attack' | 'defense' | 'resolve';

interface Rolled {
  color: DieColor;
  face: number;
  selected: boolean;
}

interface DuelIcon {
  kind: string;
  offset: 'dodge' | 'defense' | null;
}

interface Duel {
  icons: DuelIcon[];
  triggers: DuelIcon[];
  spareDodge: number;
  idleDefense: number;
  carried: boolean;
}

export function offsetIcons(heavy: number, light: number, dodge: number, defense: number): {
  icons: DuelIcon[];
  spareDodge: number;
  idleDefense: number;
  dodged: number;
  blocked: number;
  penetrating: number;
  hits: number;
  unoffset: { heavy: number; light: number };
} {
  const icons: DuelIcon[] = [];
  for (let i = 0; i < heavy; i++) icons.push({ kind: 'heavyHit', offset: null });
  for (let i = 0; i < light; i++) icons.push({ kind: 'lightHit', offset: null });
  let d = dodge;
  for (const ic of icons) {
    if (!d) break;
    if (ic.kind === 'heavyHit') { ic.offset = 'dodge'; d--; }
  }
  for (const ic of icons) {
    if (!d) break;
    if (ic.kind === 'lightHit' && !ic.offset) { ic.offset = 'dodge'; d--; }
  }
  let f = defense;
  for (const ic of icons) {
    if (!f) break;
    if (ic.kind === 'lightHit' && !ic.offset) { ic.offset = 'defense'; f--; }
  }
  const dodged = icons.filter((i) => i.offset === 'dodge').length;
  const blocked = icons.filter((i) => i.offset === 'defense').length;
  const open = icons.filter((i) => !i.offset);
  const penetrating = open.length;
  const unoffset = {
    heavy: open.filter((i) => i.kind === 'heavyHit').length,
    light: open.filter((i) => i.kind === 'lightHit').length,
  };
  return { icons, spareDodge: d, idleDefense: f, dodged, blocked, penetrating, hits: heavy + light - dodged, unoffset };
}

// ---------- surplus damage (rulebook 4.4.5, 4.8) ----------

// Surplus Damage is defined after every Penetration, but it only DOES anything
// when the Action carries one of these keywords. Without one, leftover damage is
// simply lost and the attack ends.
export interface SurplusEffect {
  key: string;
  name: string;
  targets: string;
}

const SURPLUS_EFFECTS: SurplusEffect[] = [
  { key: '毁伤', name: 'Mutilation', targets: 'the Structure of the same Part' },
  { key: '顺劈', name: 'Cleaving', targets: 'another random Part, or another Unit in Range' },
  { key: '霰射', name: 'Scatter-shot', targets: 'another random Part, if the target is a Mech' },
];

export function surplusEffects(action: CardAction): SurplusEffect[] {
  const hay = [
    action.description?.zh ?? '',
    ...(action.keywords ?? []).map((k) => k.inline ?? k.key ?? ''),
  ].join(' ');
  return SURPLUS_EFFECTS.filter((e) => hay.includes(e.key));
}

const ICON_LABEL: Record<string, string> = {
  heavyHit: 'Heavy Hit',
  lightHit: 'Light Hit',
  dodge: 'Dodge: offsets any icon',
  defense: 'Defense: offsets a Light Hit only',
  lightning: 'Lightning',
  eye: 'Eye',
};

interface Ctx {
  attacker: Token;
  defender: Token;
  action: CardAction;
  losNote: string;
  protection: number;
  protectionNote: string;
  step: Step;
  targetPart: string | null;
  attackPool: { red: number; yellow: number };
  defensePool: { white: number; blue: number };
  attackRoll: Rolled[] | null;
  defenseRoll: Rolled[] | null;
  blackResult: string | null;
  rerolls: Record<'attack' | 'defense', Record<'blue' | 'red', boolean>>;
  surplusRound: number;
  carried: { heavy: number; light: number };
  surplusKeyword: SurplusEffect | null;
  log: string[];
  explosion: boolean;
}

export class AttackHelper {
  private data: GameData;
  private dice: DiceData;
  private root: HTMLElement;
  private onChanged: () => void;
  private onClose: () => void;
  private onLog: (t: Token, text: string) => void;
  private ctx: Ctx | null = null;
  private duelGen = 0;

  constructor(
    data: GameData,
    dice: DiceData,
    root: HTMLElement,
    onChanged: () => void,
    onClose: () => void,
    onLog: (t: Token, text: string) => void = () => {},
  ) {
    this.data = data;
    this.dice = dice;
    this.root = root;
    this.onChanged = onChanged;
    this.onClose = onClose;
    this.onLog = onLog;
  }

  get active(): boolean {
    return !!this.ctx;
  }

  start(
    attacker: Token,
    action: CardAction,
    defender: Token,
    losNote: string,
    protection = 0,
    protectionNote = '',
    explosion = false,
  ): void {
    this.ctx = {
      attacker,
      defender,
      action,
      losNote,
      protection: explosion ? 0 : protection,
      protectionNote: explosion ? '' : protectionNote,
      step: defender.kind === 'mech' ? 'part' : 'attack',
      targetPart: defender.kind === 'mech' ? null : 'main',
      attackPool: { red: action.redDice ?? 0, yellow: action.yellowDice ?? 0 },
      defensePool: { white: 1, blue: 0 },
      attackRoll: null,
      defenseRoll: null,
      blackResult: null,
      rerolls: { attack: { blue: false, red: false }, defense: { blue: false, red: false } },
      surplusRound: 0,
      carried: { heavy: 0, light: 0 },
      surplusKeyword: null,
      log: [],
      explosion,
    };
    if (defender.kind !== 'mech') this.ctx.defensePool = this.suggestedDefensePool('main');
    const what = action.name.en || action.name.zh || action.id;
    this.note(
      explosion
        ? `${attacker.label} detonates ${what} against ${defender.label}.`
        : `${attacker.label} attacks ${defender.label} with ${what}.`,
      [attacker, defender],
    );
    this.render();
  }

  cancel(): void {
    this.ctx = null;
    this.onClose();
  }

  // ---------- rules math ----------

  private defenderPartCard(slot: string): Card | undefined {
    const cards = tokenCards(this.data, this.ctx!.defender);
    return cards.find((c) => c.slot === slot)?.card;
  }

  private suggestedDefensePool(slot: string): { white: number; blue: number } {
    const d = this.ctx!.defender;
    const card = this.defenderPartCard(slot);
    const st = d.partStates[slot as PartSlot | 'main'] ?? 'intact';
    let white = st === 'damaged' ? card?.structure ?? 0 : card?.armor ?? 0;
    if (white < 1) white = 1;
    // Surplus Damage grants the defender no Terrain or Unit Protection (4.8).
    if (!this.ctx!.surplusRound) white += this.ctx!.protection;
    white = Math.max(0, white - statusCount(d.statuses, 'fragile'));
    let blue = 0;
    if (d.stance === 'mobility') {
      blue = tokenCards(this.data, d)
        .filter(({ slot: s }) => s !== 'pilot' && (d.partStates[s as PartSlot | 'main'] ?? 'intact') !== 'destroyed')
        .reduce((sum, { card: c }) => sum + (c.dodge ?? 0), 0);
    }
    if (statusCount(d.statuses, 'immobilized') > 0) blue = 0;
    return { white, blue };
  }

  private rollPool(pool: Partial<Record<DieColor, number>>): Rolled[] {
    const out: Rolled[] = [];
    for (const [color, n] of Object.entries(pool) as [DieColor, number][]) {
      for (let i = 0; i < (n ?? 0); i++) out.push({ color, face: Math.floor(Math.random() * this.dice.dice[color].sides), selected: false });
    }
    return out;
  }

  private note(text: string, who: Token[] = []): void {
    if (this.ctx) this.ctx.log.push(text);
    for (const t of who) this.onLog(t, text);
  }

  private countIcons(roll: Rolled[], upgradeHollow: boolean): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const d of roll) {
      for (const icon of this.dice.dice[d.color].faces[d.face]) {
        if (icon.type === 'part') continue;
        const solid = !icon.hollow || upgradeHollow;
        if (!solid) continue;
        counts[icon.type] = (counts[icon.type] ?? 0) + 1;
      }
    }
    return counts;
  }

  private resolve(): { hits: number; penetrating: number; unoffset: { heavy: number; light: number }; text: string[]; duel: Duel } {
    const c = this.ctx!;
    const atk = this.countIcons(c.attackRoll ?? [], c.attacker.stance === 'offensive');
    const def = this.countIcons(c.defenseRoll ?? [], c.defender.stance === 'defensive');
    const lowProfile = c.action.type === 'Firing' && statusCount(c.defender.statuses, 'lowProfile') > 0;
    if (lowProfile && def.eye) {
      def.dodge = (def.dodge ?? 0) + def.eye;
      def.eye = 0;
    }
    let heavy = c.surplusRound === 0 ? atk.heavyHit ?? 0 : 0;
    let light = c.surplusRound === 0 ? atk.lightHit ?? 0 : 0;
    if (c.surplusRound > 0) {
      heavy = c.carried.heavy;
      light = c.carried.light;
    }
    const dodge = def.dodge ?? 0;
    const defense = def.defense ?? 0;
    const text: string[] = [];
    if (c.protection && !c.surplusRound) text.push(`🛡 ${c.protectionNote}: defender rolled +${c.protection} White`);
    if (lowProfile && dodge) text.push(`Low Profile: [Eye] counted as [Dodge] against this Firing Attack`);
    const totalIcons = heavy + light;

    const { icons, spareDodge, idleDefense, dodged, blocked, penetrating, hits, unoffset } = offsetIcons(heavy, light, dodge, defense);
    const triggers: DuelIcon[] = [];
    if (c.surplusRound === 0) {
      for (let i = 0; i < (atk.lightning ?? 0); i++) triggers.push({ kind: 'lightning', offset: null });
      for (let i = 0; i < (atk.eye ?? 0); i++) triggers.push({ kind: 'eye', offset: null });
    }
    text.push(`${totalIcons} damage icon${totalIcons === 1 ? '' : 's'} → ${dodged} dodged, ${blocked} blocked by Defense`);
    text.push(`Hits: ${hits} (defense-blocked icons still count as Hits for on-hit effects)`);
    text.push(`Un-offset icons: ${penetrating} ${penetrating ? '→ PENETRATION' : '→ no damage'}`);
    return {
      hits,
      penetrating,
      unoffset,
      text,
      duel: { icons, triggers, spareDodge, idleDefense, carried: c.surplusRound > 0 },
    };
  }

  private duelView(duel: Duel): HTMLElement {
    const glyph = (kind: string, size = 22) => iconSvg({ type: kind } as DiceIcon, size);
    const wrap = document.createElement('div');
    wrap.className = 'duel';

    const label = (t: string) => `<span class="duel-side">${t}</span>`;
    const verdict = (o: DuelIcon['offset']) =>
      o === 'dodge' ? '<span class="duel-v dodged">dodged</span>'
        : o === 'defense' ? '<span class="duel-v blocked">blocked<small>still a Hit</small></span>'
          : '<span class="duel-v through">through</span>';

    const cols = duel.icons
      .map((ic, i) => `
        <div class="duel-col shown resolved" data-i="${i}" data-offset="${ic.offset ?? 'none'}">
          <span class="duel-icon k-${ic.kind}" title="${ICON_LABEL[ic.kind] ?? ic.kind}">${glyph(ic.kind)}</span>
          <span class="duel-link"></span>
          <span class="duel-block">${ic.offset ? `<span class="duel-icon k-${ic.offset}">${glyph(ic.offset, 18)}</span>` : ''}</span>
          ${verdict(ic.offset)}
        </div>`)
      .join('');

    const spare = [
      ...Array.from({ length: duel.spareDodge }, () => ({ kind: 'dodge', why: 'there was nothing left to offset' })),
      ...Array.from({ length: duel.idleDefense }, () => ({ kind: 'defense', why: 'Defense can only offset a Light Hit' })),
    ];

    wrap.innerHTML = `
      <div class="duel-head">
        ${label(duel.carried ? 'Carried damage' : 'Attack icons')}
        <span class="duel-vs">vs</span>
        ${label('Defence roll')}
        <button class="duel-replay" type="button" title="Play the offsetting again">▶ Replay</button>
      </div>
      <div class="duel-grid">${cols || '<p class="dim">No damage icons in the attack roll.</p>'}</div>
      ${spare.length ? `<div class="duel-spare">${spare
        .map((s) => `<span class="duel-icon k-${s.kind} unused shown" title="${s.why}">${glyph(s.kind, 18)}</span>`)
        .join('')}<small>unused, because ${spare[0].why}</small></div>` : ''}
      ${duel.triggers.length ? `<div class="duel-trig">${duel.triggers
        .map((t) => `<span class="duel-icon k-${t.kind}" title="${ICON_LABEL[t.kind]}">${glyph(t.kind, 18)}</span>`)
        .join('')}<small>trigger icons: these fire "on ${duel.triggers.map((t) => ICON_LABEL[t.kind]).filter((v, i, a) => a.indexOf(v) === i).join('/')}" card effects unless a Dodge offsets them</small></div>` : ''}`;

    wrap.querySelector('.duel-replay')!.addEventListener('click', () => this.playDuel(wrap));
    return wrap;
  }

  private playDuel(wrap: HTMLElement): void {
    const gen = ++this.duelGen;
    const cols = [...wrap.querySelectorAll<HTMLElement>('.duel-col')];
    const spares = [...wrap.querySelectorAll<HTMLElement>('.duel-spare .duel-icon')];
    const done = () => {
      wrap.classList.add('duel-done');
      cols.forEach((c) => c.classList.add('shown', 'resolved'));
      spares.forEach((s) => s.classList.add('shown'));
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return done();

    wrap.classList.remove('duel-done');
    cols.forEach((c) => c.classList.remove('shown', 'resolved'));
    spares.forEach((s) => s.classList.remove('shown'));

    const step = (fn: () => void, at: number) =>
      window.setTimeout(() => {
        if (gen !== this.duelGen || !wrap.isConnected) return;
        fn();
      }, at);

    let t = 60;
    cols.forEach((col) => { step(() => col.classList.add('shown'), t); t += 90; });
    t += 160;
    cols.forEach((col) => { step(() => col.classList.add('resolved'), t); t += 220; });
    spares.forEach((s) => { step(() => s.classList.add('shown'), t); t += 120; });
    step(() => wrap.classList.add('duel-done'), t + 120);
  }

  // ---------- UI ----------

  private render(): void {
    const c = this.ctx;
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'attack-helper';
    const aName = c.attacker.label;
    const dName = c.defender.label;
    el.innerHTML = `<div class="ah-head">
      <b>${aName}</b> → <b>${dName}</b>
      <span class="dim">${c.action.name.en || c.action.name.zh} (${c.action.type ?? ''})</span>
      <button class="ah-cancel" title="Cancel attack">✕</button>
    </div>
    <p class="ah-los">${c.losNote}</p>`;

    if (c.step === 'part') el.appendChild(this.stepPart());
    if (c.step === 'attack') el.appendChild(this.stepAttack());
    if (c.step === 'defense') el.appendChild(this.stepDefense());
    if (c.step === 'resolve') el.appendChild(this.stepResolve());

    if (c.log.length) {
      const log = document.createElement('div');
      log.className = 'ah-log';
      log.innerHTML = c.log.map((l) => `<div>${l}</div>`).join('');
      el.appendChild(log);
    }

    el.querySelector('.ah-cancel')!.addEventListener('click', () => this.cancel());
    this.root.replaceChildren(el);
  }

  private stepPart(): HTMLElement {
    const c = this.ctx!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';
    wrap.innerHTML = `<h4><span class="ah-n">1</span>Determine target Part</h4>
      <p class="dim">${c.explosion
        ? 'Roll the Black Die, or pick a Part directly if the target is Shutdown. Explosions have no facing, so there is no Back Attack here.'
        : 'Roll the Black Die, or pick a Part directly. You may choose when the target is Shutdown or you have a Back Attack, and some Actions designate the Part for you.'}</p>`;

    const rollBtn = document.createElement('button');
    rollBtn.className = 'ah-primary';
    rollBtn.innerHTML = '<i class="btn-ico">🎲</i> Roll Black Die';
    rollBtn.addEventListener('click', () => {
      const face = this.dice.dice.black.faces[Math.floor(Math.random() * 6)][0];
      let part = face.part ?? 'any';
      c.blackResult = part;
      if (part === 'any') {
        this.note('Black Die: ANY, so the attacker picks the Part.');
        this.render();
        return;
      }
      const slotMap: Record<string, string> = { torso: 'torso', chassis: 'chasis', leftArm: 'leftHand', rightArm: 'rightHand', backpack: 'backpack' };
      let slot = slotMap[part] ?? 'torso';
      const state = c.defender.partStates[slot as PartSlot];
      if (state === undefined || state === 'destroyed') {
        this.note(`Black Die: ${part}. That Part is missing or already destroyed, so the hit redirects to the Torso.`);
        slot = 'torso';
      } else {
        this.note(`Black Die: ${part}.`);
      }
      this.pickPart(slot);
    });
    wrap.appendChild(rollBtn);

    const pickWrap = document.createElement('div');
    pickWrap.className = 'ah-partpick';
    for (const { slot, card } of tokenCards(this.data, c.defender)) {
      if (slot === 'pilot') continue;
      const st = c.defender.partStates[slot as PartSlot | 'main'] ?? 'intact';
      const b = document.createElement('button');
      b.className = `chip chip-${st}`;
      b.innerHTML = `<b>${SLOT_LABEL[slot]}</b> ${cardName(card)}`;
      b.addEventListener('click', () => {
        this.note(`Target Part chosen: ${SLOT_LABEL[slot]}.`);
        this.pickPart(slot);
      });
      pickWrap.appendChild(b);
    }
    wrap.appendChild(pickWrap);
    return wrap;
  }

  private pickPart(slot: string): void {
    const c = this.ctx!;
    c.targetPart = slot;
    c.defensePool = this.suggestedDefensePool(slot);
    // Surplus Damage makes no Attack Roll: the un-offset icons from the first
    // Penetration ARE the roll (4.8 step 3), so the attack step is skipped.
    c.step = c.surplusRound > 0 ? 'defense' : 'attack';
    this.render();
  }

  private poolEditor(pools: [string, DieColor][], get: (c: DieColor) => number, set: (c: DieColor, n: number) => void): HTMLElement {
    const div = document.createElement('div');
    div.className = 'ah-pool';
    for (const [label, color] of pools) {
      const item = document.createElement('span');
      item.className = `pool-die die-${color}`;
      item.innerHTML = `<button>−</button><b>${get(color)}</b><button>+</button> <small>${label}</small>`;
      const [minus, plus] = item.querySelectorAll('button');
      minus.addEventListener('click', () => {
        set(color, Math.max(0, get(color) - 1));
        this.render();
      });
      plus.addEventListener('click', () => {
        set(color, get(color) + 1);
        this.render();
      });
      div.appendChild(item);
    }
    return div;
  }

  private rollView(roll: Rolled[], which: 'attack' | 'defense'): HTMLElement {
    const c = this.ctx!;
    const div = document.createElement('div');
    div.className = 'ah-roll';
    roll.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = `die die-${d.color}${d.selected ? ' sel' : ''}`;
      const face = this.dice.dice[d.color].faces[d.face];
      b.innerHTML = face.length ? face.map((ic: DiceIcon) => iconSvg(ic)).join('') : '<span class="blank">·</span>';
      b.title = 'select for reroll';
      b.addEventListener('click', () => {
        d.selected = !d.selected;
        this.render();
      });
      div.appendChild(b);
    });
    const rr = document.createElement('span');
    rr.className = 'rerolls';
    for (const side of ['blue', 'red'] as const) {
      const b = document.createElement('button');
      b.textContent = `${side} reroll`;
      b.disabled = c.rerolls[which][side];
      b.addEventListener('click', () => {
        const sel = roll.filter((d) => d.selected);
        if (!sel.length) return;
        c.rerolls[which][side] = true;
        for (const d of sel) {
          d.face = Math.floor(Math.random() * this.dice.dice[d.color].sides);
          d.selected = false;
        }
        this.render();
      });
      rr.appendChild(b);
    }
    div.appendChild(rr);
    return div;
  }

  private stepAttack(): HTMLElement {
    const c = this.ctx!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';
    const partCard = c.targetPart ? this.defenderPartCard(c.targetPart) : undefined;
    wrap.innerHTML = `<h4><span class="ah-n">2</span>Attack Roll ${c.targetPart ? `vs <b>${SLOT_LABEL[c.targetPart as PartSlot | 'main']}</b> (${partCard ? cardName(partCard) : ''})` : ''}</h4>
      ${c.attacker.stance === 'offensive' ? '<p class="dim">OFF stance: hollow attack icons count as solid.</p>' : ''}`;
    wrap.appendChild(
      this.poolEditor(
        [['Red', 'red'], ['Yellow', 'yellow']],
        (col) => (col === 'red' ? c.attackPool.red : c.attackPool.yellow),
        (col, n) => (col === 'red' ? (c.attackPool.red = n) : (c.attackPool.yellow = n)),
      ),
    );
    if (!c.attackRoll) {
      const roll = document.createElement('button');
      roll.className = 'ah-primary';
      roll.innerHTML = '<i class="btn-ico">🎲</i> Roll attack dice';
      roll.addEventListener('click', () => {
        c.attackRoll = this.rollPool({ red: c.attackPool.red, yellow: c.attackPool.yellow });
        this.render();
      });
      wrap.appendChild(roll);
    } else {
      wrap.appendChild(this.rollView(c.attackRoll, 'attack'));
      const atk = this.countIcons(c.attackRoll, c.attacker.stance === 'offensive');
      const sum = document.createElement('p');
      sum.className = 'ah-sum';
      sum.textContent = `Effective: ${atk.heavyHit ?? 0}× Heavy, ${atk.lightHit ?? 0}× Light${atk.lightning ? `, ${atk.lightning}× Lightning` : ''}${atk.eye ? `, ${atk.eye}× Eye` : ''}`;
      wrap.appendChild(sum);
      const next = document.createElement('button');
      next.className = 'ah-primary';
      next.textContent = 'Continue to Defense ▸';
      next.addEventListener('click', () => {
        c.step = 'defense';
        this.render();
      });
      wrap.appendChild(next);
    }
    return wrap;
  }

  private stepDefense(): HTMLElement {
    const c = this.ctx!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';
    const st = c.targetPart ? c.defender.partStates[c.targetPart as PartSlot | 'main'] ?? 'intact' : 'intact';
    wrap.innerHTML = `<h4><span class="ah-n">${c.surplusRound ? '2' : '3'}</span>Defense Roll</h4>
      ${
        c.surplusRound
          ? `<p class="ah-protect">No Attack Roll is made. The ${c.carried.heavy + c.carried.light} un-offset icon${
              c.carried.heavy + c.carried.light === 1 ? '' : 's'
            } carried over from the first Penetration stand in for it, and Terrain Protection, Unit Protection and Parry are all barred here (4.8).</p>`
          : ''
      }
      <p class="dim">White = target Part ${st === 'damaged' ? 'STRUCTURE (part is Damaged)' : 'Armor'} (min 1)${
        c.protection ? ` + ${c.protection} protection` : ''
      }${c.defender.stance === 'mobility' ? ' · MOB stance: + Blue = Dodge value' : ''}${
        c.defender.stance === 'defensive' ? ' · DEF stance: hollow Defense icons count as solid' : ''
      }.</p>
      ${c.protection ? `<p class="ah-protect">🛡 ${c.protectionNote}. <b>+${c.protection} White</b> is already added to the pool below.</p>` : ''}
      ${(() => {
        const frg = statusCount(c.defender.statuses, 'fragile');
        return frg
          ? `<p class="ah-fragile"><i class="btn-ico">💥</i> ${c.defender.label} bears ${frg} Fragile Token${frg === 1 ? '' : 's'}, so <b>−${frg} White</b> is already taken off the pool below.</p>`
          : '';
      })()}
      ${c.explosion ? '<p class="dim">Explosion damage allows no Terrain or Unit Protection, so the pool below is Armour and Dodge only.</p>' : ''}
      ${!c.protection && !c.explosion && c.action.type === 'Firing' ? '<p class="dim">Line of sight is clear, so there is no Terrain or Unit Protection. Obstructed firing would add +2 White.</p>' : ''}`;
    wrap.appendChild(
      this.poolEditor(
        [['White', 'white'], ['Blue', 'blue']],
        (col) => (col === 'white' ? c.defensePool.white : c.defensePool.blue),
        (col, n) => (col === 'white' ? (c.defensePool.white = n) : (c.defensePool.blue = n)),
      ),
    );
    if (!c.defenseRoll) {
      const roll = document.createElement('button');
      roll.className = 'ah-primary';
      roll.innerHTML = '<i class="btn-ico">🎲</i> Roll defense dice';
      roll.addEventListener('click', () => {
        c.defenseRoll = this.rollPool({ white: c.defensePool.white, blue: c.defensePool.blue });
        this.render();
      });
      wrap.appendChild(roll);
    } else {
      wrap.appendChild(this.rollView(c.defenseRoll, 'defense'));
      const def = this.countIcons(c.defenseRoll, c.defender.stance === 'defensive');
      const sum = document.createElement('p');
      sum.className = 'ah-sum';
      sum.textContent = `Effective: ${def.defense ?? 0}× Defense, ${def.dodge ?? 0}× Dodge`;
      wrap.appendChild(sum);
      const next = document.createElement('button');
      next.className = 'ah-primary';
      next.textContent = 'Resolve ▸';
      next.addEventListener('click', () => {
        c.step = 'resolve';
        this.render();
      });
      wrap.appendChild(next);
    }
    return wrap;
  }

  private stepResolve(): HTMLElement {
    const c = this.ctx!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';
    const { penetrating, unoffset, text, duel } = this.resolve();
    wrap.innerHTML = `<h4><span class="ah-n">4</span><span data-mech="penetration">Resolution</span>${
      c.surplusRound
        ? ` (<span data-mech="surplus_damage">${c.surplusKeyword?.name ?? 'Surplus'} Damage, no Attack Roll</span>)`
        : ''
    }</h4>`;
    const duelEl = this.duelView(duel);
    wrap.appendChild(duelEl);
    const summary = document.createElement('div');
    summary.innerHTML = `${text.map((t) => `<p class="ah-sum">${t}</p>`).join('')}
      <p class="dim">${c.explosion
        ? 'Focus on an Explosion is defender-only: the defender may spend 1 Link to reroll defence dice. Use the reroll buttons in the previous step, then adjust Link in the Squads tab.'
        : 'Focus: either side may spend 1 Link to reroll dice, attacker first. Use the reroll buttons in the previous steps, then adjust Link in the Squads tab.'}</p>`;
    wrap.appendChild(summary);
    linkMechanics(wrap, this.data.mechanics);
    window.setTimeout(() => this.playDuel(duelEl), 0);

    if (penetrating > 0 && c.targetPart) {
      const apply = document.createElement('button');
      apply.className = 'ah-primary';
      apply.textContent = `Apply Penetration to ${SLOT_LABEL[c.targetPart as PartSlot | 'main']}`;
      apply.addEventListener('click', () => {
        const slot = c.targetPart as PartSlot | 'main';
        const cur = c.defender.partStates[slot] ?? 'intact';
        const partCard = this.defenderPartCard(slot);
        const hasStructure = (partCard?.structure ?? 0) > 0;
        const next = cur === 'intact' ? (hasStructure ? 'damaged' : 'destroyed') : 'destroyed';
        c.defender.partStates[slot] = next;
        const how = c.explosion ? 'Explosion damage' : 'Penetration';
        this.note(`${how} from ${c.attacker.label}: ${SLOT_LABEL[slot]} goes ${cur} to ${next.toUpperCase()}.`, [c.attacker, c.defender]);
        if (next === 'destroyed' && c.defender.kind === 'mech') {
          c.defender.link = Math.max(0, (c.defender.link ?? 0) - 1);
          this.note(`Part destroyed, so ${c.defender.label} loses 1 Link (now ${c.defender.link}).`, [c.defender]);
          if (c.defender.link === 0) {
            c.defender.stance = 'shutdown';
            this.note(`Link has reached 0, so ${c.defender.label} SHUTS DOWN.`, [c.defender]);
          }
          if (slot === 'torso') this.note(`⚠ Torso destroyed, so the unit is destroyed. Remove it from the board.`, [c.defender]);
          else {
            const left = Object.entries(c.defender.partStates).filter(([, s]) => s !== 'destroyed').length;
            if (left <= 2) {
              this.note(
                `⚠ Integrity Loss: ${c.defender.label} has ${left} Part${left === 1 ? '' : 's'} left. It acts as normal for the rest of this round, then is removed in the End Phase.`,
                [c.attacker, c.defender],
              );
            }
          }
        }
        this.onChanged();
        // Every un-offset icon is Surplus Damage (4.4.5), but it only resolves
        // against a second target when the Action carries a keyword that says so
        // (4.8), and it never chains past a second Penetration.
        const effects = surplusEffects(c.action);
        const carried = unoffset;
        const surplus = carried.heavy + carried.light;
        if (surplus > 0 && effects.length && c.surplusRound === 0 && c.defender.kind === 'mech') {
          const effect = effects[0];
          c.surplusRound = 1;
          c.carried = carried;
          c.surplusKeyword = effect;
          c.targetPart = null;
          c.attackRoll = null;
          c.defenseRoll = null;
          c.rerolls = { attack: { blue: false, red: false }, defense: { blue: false, red: false } };
          this.note(
            `${effect.name}: ${surplus} un-offset icon${surplus === 1 ? '' : 's'} carry over as Surplus Damage against ${effect.targets}. No Attack Roll is made, and the defender gets no Protection or Parry dice.`,
          );
          if (effects.length > 1) {
            this.note(`This Action also has ${effects.slice(1).map((e) => e.name).join(' and ')}; the attacker picks one, and ${effect.name} is applied here.`);
          }
          c.step = 'part';
          this.render();
        } else {
          if (surplus > 0 && !effects.length) {
            this.note(`${surplus} un-offset icon${surplus === 1 ? '' : 's'} of Surplus Damage, but this Action has no Mutilation, Cleaving or Scatter-shot, so it does nothing.`);
          }
          this.note('Attack resolved.');
          this.finish(wrap);
        }
      });
      wrap.appendChild(apply);
    } else {
      const done = document.createElement('button');
      done.className = 'ah-primary';
      done.textContent = 'Done';
      done.addEventListener('click', () => this.cancel());
      wrap.appendChild(done);
    }
    return wrap;
  }

  private finish(_wrap: HTMLElement): void {
    const c = this.ctx!;
    c.step = 'resolve';
    const el = document.createElement('div');
    el.className = 'attack-helper';
    el.innerHTML = `<div class="ah-head"><b>Attack resolved</b></div>
      <div class="ah-log">${c.log.map((l) => `<div>${l}</div>`).join('')}</div>`;
    const done = document.createElement('button');
    done.className = 'ah-primary';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.cancel());
    el.appendChild(done);
    this.root.replaceChildren(el);
    this.ctx = null;
  }
}

// ---------- electronic warfare ----------

export function resolveCounterRoll(
  init: { lightning: number; light: number },
  resp: { lightning: number; light: number },
): { initiatorWins: boolean; why: string } {
  if (init.lightning !== resp.lightning) {
    return {
      initiatorWins: init.lightning > resp.lightning,
      why: `Lightning ${init.lightning} vs ${resp.lightning}`,
    };
  }
  if (init.light !== resp.light) {
    return {
      initiatorWins: init.light > resp.light,
      why: `Lightning level at ${init.lightning}, Light Hit ${init.light} vs ${resp.light}`,
    };
  }
  return { initiatorWins: true, why: 'level on both counts, so the tie goes to the Initiator' };
}

interface EwCtx {
  initiator: Token;
  responder: Token;
  action: CardAction;
  initEv: number;
  respEv: number;
  initRoll: Rolled[] | null;
  respRoll: Rolled[] | null;
  rerolled: { init: boolean; resp: boolean };
  log: string[];
  done: boolean;
}

export class ElectronicHelper {
  private data: GameData;
  private dice: DiceData;
  private root: HTMLElement;
  private onChanged: () => void;
  private onClose: () => void;
  private onLog: (t: Token, text: string) => void;
  private ctx: EwCtx | null = null;

  constructor(
    data: GameData,
    dice: DiceData,
    root: HTMLElement,
    onChanged: () => void,
    onClose: () => void,
    onLog: (t: Token, text: string) => void = () => {},
  ) {
    this.data = data;
    this.dice = dice;
    this.root = root;
    this.onChanged = onChanged;
    this.onClose = onClose;
    this.onLog = onLog;
  }

  get active(): boolean {
    return !!this.ctx;
  }

  start(initiator: Token, action: CardAction, responder: Token): void {
    const initEv = electronicValue(this.data, initiator);
    const respEv = electronicValue(this.data, responder);
    this.ctx = {
      initiator,
      responder,
      action,
      initEv,
      respEv,
      initRoll: null,
      respRoll: null,
      rerolled: { init: false, resp: false },
      log: [],
      done: false,
    };
    const what = action.name.en || action.name.zh || action.id;
    this.note(`${initiator.label} opens ${what} against ${responder.label}.`, [initiator, responder]);
    this.render();
  }

  cancel(): void {
    this.ctx = null;
    this.onClose();
  }

  private note(text: string, who: Token[] = []): void {
    if (this.ctx) this.ctx.log.push(text);
    for (const t of who) this.onLog(t, text);
  }

  private rollYellow(n: number): Rolled[] {
    const out: Rolled[] = [];
    for (let i = 0; i < n; i++) out.push({ color: 'yellow', face: Math.floor(Math.random() * this.dice.dice.yellow.sides), selected: false });
    return out;
  }

  private tally(roll: Rolled[], offensive: boolean): { lightning: number; light: number } {
    let lightning = 0;
    let light = 0;
    for (const d of roll) {
      for (const icon of this.dice.dice.yellow.faces[d.face]) {
        if (icon.hollow && !offensive) continue;
        if (icon.type === 'lightning') lightning++;
        else if (icon.type === 'lightHit') light++;
      }
    }
    return { lightning, light };
  }

  private applyEffects(): string[] {
    const c = this.ctx!;
    const done: string[] = [];
    const walk = (list: GameRuleEffect[]): void => {
      for (const e of list) {
        if (e.type === 'apply_status') {
          const def = STATUSES.find((s) => s.label === e.status || s.id === e.status) ?? STATUSES.find((s) => s.id === 'fci');
          if (def) {
            const n = e.stacks ?? 1;
            const before = c.responder.statuses ?? [];
            for (let i = 0; i < n; i++) c.responder.statuses = addStatus(c.responder.statuses, def.id);
            done.push(`${c.responder.label} gains ${n} ${def.label}`);
            const lost = before.filter((s) => !c.responder.statuses!.includes(s));
            for (const id of lost) {
              const old = STATUSES.find((s) => s.id === id);
              if (old) done.push(`${old.label} comes off ${c.responder.label}, since a unit may bear only 1 Hexagon Token (2.5.3)`);
            }
            if (def.id === 'fci' && c.responder.kind === 'projectile' && c.respEv > 0) {
              done.push(
                `${c.responder.label} is a Projectile with an Electronic Value, so it is destroyed outright (rulebook 6.3.2)`,
              );
            }
          }
        }
        if (e.effects) walk(e.effects);
      }
    };
    for (const g of c.action.gameRules ?? []) walk(g.effects ?? []);
    return done;
  }

  private render(): void {
    const c = this.ctx;
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'attack-helper';
    const what = c.action.name.en || c.action.name.zh || c.action.id;
    el.innerHTML = `<div class="ah-head">
      <b>${c.initiator.label}</b> ⚡ <b>${c.responder.label}</b>
      <span class="dim">${what}</span>
      <button class="ah-cancel" title="Cancel">✕</button>
    </div>
    <p class="ah-los" data-mech="electronic_counter_roll">Electronic Warfare ignores terrain and line of sight. Range only.</p>`;

    el.appendChild(this.stepRoll());
    if (c.log.length) {
      const log = document.createElement('div');
      log.className = 'ah-log';
      log.innerHTML = c.log.map((l) => `<div>${l}</div>`).join('');
      el.appendChild(log);
    }
    el.querySelector('.ah-cancel')!.addEventListener('click', () => this.cancel());
    linkMechanics(el, this.data.mechanics);
    this.root.replaceChildren(el);
  }

  private side(who: 'init' | 'resp'): HTMLElement {
    const c = this.ctx!;
    const t = who === 'init' ? c.initiator : c.responder;
    const ev = who === 'init' ? c.initEv : c.respEv;
    const roll = who === 'init' ? c.initRoll : c.respRoll;
    const wrap = document.createElement('div');
    wrap.className = 'ew-side';
    wrap.innerHTML = `<h5>${who === 'init' ? 'Initiator' : 'Responder'} · ${t.label}
      <span class="ew-ev">EV ${ev}</span>${t.stance === 'offensive' ? '<span class="ew-off">OFF: hollow counts</span>' : ''}</h5>`;
    if (roll) {
      const row = document.createElement('div');
      row.className = 'ah-roll';
      roll.forEach((d) => {
        const b = document.createElement('button');
        b.className = `die die-yellow${d.selected ? ' sel' : ''}`;
        const face = this.dice.dice.yellow.faces[d.face];
        b.innerHTML = face.length ? face.map((ic: DiceIcon) => iconSvg(ic)).join('') : '<span class="blank">·</span>';
        b.title = 'select for a Focus reroll';
        b.addEventListener('click', () => {
          d.selected = !d.selected;
          this.render();
        });
        row.appendChild(b);
      });
      wrap.appendChild(row);
      const n = this.tally(roll, t.stance === 'offensive');
      const sum = document.createElement('p');
      sum.className = 'ah-sum';
      sum.innerHTML = `Lightning <b>${n.lightning}</b> · Light Hit <b>${n.light}</b>`;
      wrap.appendChild(sum);
      const spent = who === 'init' ? c.rerolled.init : c.rerolled.resp;
      if (!spent && (t.link ?? 0) > 0) {
        const rr = document.createElement('button');
        rr.className = 'ah-cancel';
        rr.textContent = 'Focus reroll (1 Link)';
        rr.addEventListener('click', () => {
          const sel = roll.filter((d) => d.selected);
          if (!sel.length) return;
          for (const d of sel) {
            d.face = Math.floor(Math.random() * this.dice.dice.yellow.sides);
            d.selected = false;
          }
          t.link = Math.max(0, (t.link ?? 0) - 1);
          if (who === 'init') c.rerolled.init = true;
          else c.rerolled.resp = true;
          this.note(`${t.label} spends 1 Link to Focus, rerolling ${sel.length} die.`);
          this.onChanged();
          this.render();
        });
        wrap.appendChild(rr);
      }
    }
    return wrap;
  }

  private stepRoll(): HTMLElement {
    const c = this.ctx!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';

    if (c.initEv === 0) {
      wrap.innerHTML = `<h4><span class="ah-n">!</span>Cannot initiate</h4>
        <p class="dim">${c.initiator.label} has Electronic Value 0, so it cannot start an Electronic Counter-roll. A unit at 0 may still respond to one.</p>`;
      const done = document.createElement('button');
      done.className = 'ah-primary';
      done.textContent = 'Close';
      done.addEventListener('click', () => this.cancel());
      wrap.appendChild(done);
      return wrap;
    }

    wrap.innerHTML = `<h4><span class="ah-n">1</span>Electronic Counter-roll</h4>
      <p class="dim">Each side rolls Yellow dice equal to its Electronic Value. More Lightning wins; on a tie, more Light Hits; if both are level the Initiator wins.</p>`;
    wrap.appendChild(this.side('init'));
    wrap.appendChild(this.side('resp'));

    if (!c.initRoll || !c.respRoll) {
      const roll = document.createElement('button');
      roll.className = 'ah-primary';
      roll.innerHTML = `<i class="btn-ico">🎲</i> Roll ${c.initEv}Y vs ${c.respEv}Y`;
      roll.addEventListener('click', () => {
        c.initRoll = this.rollYellow(c.initEv);
        c.respRoll = this.rollYellow(c.respEv);
        this.render();
      });
      wrap.appendChild(roll);
      return wrap;
    }

    if (!c.done) {
      const resolve = document.createElement('button');
      resolve.className = 'ah-primary';
      resolve.textContent = 'Resolve ▸';
      resolve.addEventListener('click', () => {
        const a = this.tally(c.initRoll!, c.initiator.stance === 'offensive');
        const b = this.tally(c.respRoll!, c.responder.stance === 'offensive');
        const { initiatorWins: win, why } = resolveCounterRoll(a, b);
        c.done = true;
        if (win) {
          const applied = this.applyEffects();
          this.note(
            `Counter-roll: ${why}. ${c.initiator.label} succeeds.${applied.length ? ` ${applied.join('; ')}.` : ''}`,
            [c.initiator, c.responder],
          );
        } else {
          this.note(`Counter-roll: ${why}. ${c.responder.label} holds, so nothing applies.`, [c.initiator, c.responder]);
        }
        this.onChanged();
        this.render();
      });
      wrap.appendChild(resolve);
      return wrap;
    }

    const done = document.createElement('button');
    done.className = 'ah-primary';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.cancel());
    wrap.appendChild(done);
    return wrap;
  }
}

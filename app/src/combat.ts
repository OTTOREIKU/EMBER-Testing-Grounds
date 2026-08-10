import type { GameData } from './data';
import { cardName } from './data';
import { iconSvg } from './dice';
import { linkMechanics } from './inspector';
import { SQUAD_ORDER, squadLabel } from './data';
import type { Card, CardAction, DiceData, DiceIcon, DieColor, GameRuleEffect, PartSlot, Side, Token } from './types';
import { statusCount, STATUSES } from './types';
import { auraEffectsOn, electronicValue, SLOT_LABEL, tokenCards } from './units';
import { rangeBetween } from './rules';
import type { Command } from './commands';

// Where dice results come from. Absent in a local game, which rolls its own;
// set in a networked one, where the server rolls so neither client can pick
// its own numbers.
export type DiceRoller = (pool: Record<string, number>, label?: string) => Promise<{ color: string; face: number }[]>;

type Step = 'part' | 'attack' | 'defense' | 'resolve' | 'surplus';

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
  rerolls: Record<'attack' | 'defense', Record<Side, boolean>>;
  surplusRound: number;
  carried: { heavy: number; light: number };
  surplusKeyword: SurplusEffect | null;
  // The Part the original hit landed on: Scatter-shot and Cleaving must send
  // the Surplus somewhere ELSE (FAQ D4/D6), and Mutilation back into exactly it.
  surplusOriginalPart: string | null;
  // The setup pending on the attacker's choices: which keyword when the Action
  // carries several (FAQ D1), and Cleaving's part-or-other-unit fork (D4).
  surplusSetup: { effects: SurplusEffect[]; chosen: SurplusEffect | null } | null;
  log: string[];
  explosion: boolean;
  hits: number;
}

export class AttackHelper {
  private data: GameData;
  private dice: DiceData;
  private root: HTMLElement;
  private onChanged: () => void;
  private onClose: () => void;
  private onLog: (t: Token, text: string) => void;
  private onKnockback: (attacker: Token, defender: Token, action: CardAction, hits: number) => void;
  private onDestroyed: (killer: Token, victim: Token, what: 'part' | 'unit') => void;
  // The attacker rides along because a Penetrated Black Box bearer drops it
  // where the ATTACKER says (5.3.1), and only that seat may send the command.
  private onPenetrated: (victim: Token, attacker: Token) => void;
  private onCommand: (cmd: Command) => void;
  // Set by the app while a networked game is running; cleared otherwise.
  roller: DiceRoller | null = null;
  // The whole board, for aura reads (FAQ Q1: judged when the roll happens).
  tokens: (() => Token[]) | null = null;
  private ctx: Ctx | null = null;
  private duelGen = 0;
  private blackTimer: number | undefined;
  private spinTimer: number | undefined;
  private spinFor: 'attack' | 'defense' | null = null;

  constructor(
    data: GameData,
    dice: DiceData,
    root: HTMLElement,
    onChanged: () => void,
    onClose: () => void,
    onLog: (t: Token, text: string) => void = () => {},
    onKnockback: (attacker: Token, defender: Token, action: CardAction, hits: number) => void = () => {},
    onDestroyed: (killer: Token, victim: Token, what: 'part' | 'unit') => void = () => {},
    onPenetrated: (victim: Token, attacker: Token) => void = () => {},
    onCommand: (cmd: Command) => void = () => {},
  ) {
    this.data = data;
    this.dice = dice;
    this.root = root;
    this.onChanged = onChanged;
    this.onClose = onClose;
    this.onLog = onLog;
    this.onKnockback = onKnockback;
    this.onDestroyed = onDestroyed;
    this.onPenetrated = onPenetrated;
    this.onCommand = onCommand;
  }

  get active(): boolean {
    return !!this.ctx;
  }

  private stopBlack(): void {
    if (this.blackTimer) window.clearInterval(this.blackTimer);
    this.blackTimer = undefined;
    if (this.spinTimer) window.clearInterval(this.spinTimer);
    this.spinTimer = undefined;
    this.spinFor = null;
  }

  private faceHtml(color: DieColor, face: number): string {
    const f = this.dice.dice[color].faces[face];
    return f.length ? f.map((ic: DiceIcon) => iconSvg(ic)).join('') : '<span class="blank">·</span>';
  }

  // The attack and defence dice used to appear already settled, which read as
  // the app deciding rather than a roll happening. They cycle faces first and
  // land on the values rollPool already chose. `.rolling .die` supplies the
  // shake, so the class alone is enough.
  private spinDice(container: HTMLElement, roll: Rolled[]): void {
    if (this.spinTimer) window.clearInterval(this.spinTimer);
    const dice = [...container.querySelectorAll<HTMLElement>('.die')];
    if (!dice.length) return;
    container.classList.add('rolling');
    let ticks = 0;
    this.spinTimer = window.setInterval(() => {
      ticks++;
      const done = ticks >= 8;
      dice.forEach((el, i) => {
        const d = roll[i];
        if (!d) return;
        el.innerHTML = this.faceHtml(d.color, done ? d.face : Math.floor(Math.random() * this.dice.dice[d.color].sides));
      });
      if (!done) return;
      window.clearInterval(this.spinTimer);
      this.spinTimer = undefined;
      container.classList.remove('rolling');
    }, 55);
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
    this.stopBlack();
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
      rerolls: { attack: { s1: false, s2: false }, defense: { s1: false, s2: false } },
      surplusRound: 0,
      carried: { heavy: 0, light: 0 },
      surplusKeyword: null,
      surplusOriginalPart: null,
      surplusSetup: null,
      log: [],
      explosion,
      hits: 0,
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
    this.stopBlack();
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

  // Every result-deciding roll in this file goes through here. In a local game
  // it is Math.random; in a networked one the server rolls, because a client
  // that generates its own faces can simply choose them. Asynchronous for that
  // reason — the wizard already shows a spin while it waits.
  private async rollPool(pool: Partial<Record<DieColor, number>>, label?: string): Promise<Rolled[]> {
    const source = this.roller;
    if (source) {
      try {
        const dice = await source(pool as Record<string, number>, label);
        return dice.map((d) => ({ color: d.color as DieColor, face: d.face, selected: false }));
      } catch (err) {
        // A roll that never lands must say so rather than quietly falling back
        // to local dice, which is exactly the thing being prevented.
        this.note(`The roll could not be made: ${(err as Error).message}`);
        return [];
      }
    }
    const out: Rolled[] = [];
    for (const [color, n] of Object.entries(pool) as [DieColor, number][]) {
      for (let i = 0; i < (n ?? 0); i++) out.push({ color, face: Math.floor(Math.random() * this.dice.dice[color].sides), selected: false });
    }
    return out;
  }

  // Rerolls the selected dice in place, from the same source as the original.
  private async reroll(roll: Rolled[], label: string): Promise<void> {
    const sel = roll.filter((d) => d.selected);
    if (!sel.length) return;
    const pool: Partial<Record<DieColor, number>> = {};
    for (const d of sel) pool[d.color] = (pool[d.color] ?? 0) + 1;
    const fresh = await this.rollPool(pool, label);
    // Matched back by colour, since the pool is grouped and the order within a
    // colour is arbitrary.
    const byColor = new Map<DieColor, number[]>();
    for (const f of fresh) {
      const list = byColor.get(f.color) ?? [];
      list.push(f.face);
      byColor.set(f.color, list);
    }
    for (const d of sel) {
      const next = byColor.get(d.color)?.shift();
      if (next !== undefined) d.face = next;
      d.selected = false;
    }
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
    // The Token, or the MES Beacon's aura: the aura grants the KEYWORD, so it
    // works exactly like the Token here and Scan cannot strip it (FAQ Q3/J2).
    const lowProfile = c.action.type === 'Firing' && (statusCount(c.defender.statuses, 'lowProfile') > 0
      || (this.tokens ? auraEffectsOn(this.data, this.tokens(), c.defender).has('low_profile') : false));
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

    if (c.step === 'surplus') el.appendChild(this.stepSurplus());
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

  // Enemies of the attacker, other than the current defender, inside the
  // Action's own range: where Cleaving may send the Surplus instead (FAQ D4).
  // Melee cannot reach Aerial (M10).
  private cleaveTargets(): Token[] {
    const c = this.ctx!;
    const all = this.tokens ? this.tokens() : [];
    return all.filter((u) => {
      if (u.side === c.attacker.side || u.uid === c.defender.uid || u.deployed === false) return false;
      if ((u.partStates[u.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed') return false;
      if (c.action.type === 'Melee' && u.aerial) return false;
      return rangeBetween(c.attacker, u).range <= (c.action.range ?? 1);
    });
  }

  private chooseSurplus(effect: SurplusEffect): void {
    const c = this.ctx!;
    c.surplusKeyword = effect;
    c.surplusSetup = { effects: c.surplusSetup?.effects ?? [effect], chosen: effect };
    const original = c.surplusOriginalPart;
    if (effect.name === 'Mutilation') {
      // Same Part, no second Black Die (4.8.1 step 2.1): the keyword itself
      // has already determined the target, now defending with its Structure.
      const slot = c.defender.kind === 'mech' ? (original ?? 'torso') : 'main';
      this.note(`Mutilation strikes the same Part again: ${SLOT_LABEL[slot as PartSlot | 'main'] ?? slot}, now defending with its Structure.`);
      this.pickPart(slot);
      return;
    }
    if (effect.name === 'Cleaving') {
      // The fork stays open in the surplus step: another Part of the same
      // target (never the same Part, D4), or another Unit in Range.
      c.step = 'surplus';
      this.render();
      return;
    }
    this.note(`${effect.name}: the Surplus resolves against ${effect.targets}.`);
    c.step = 'part';
    this.render();
  }

  private cleaveInto(uid: number): void {
    const c = this.ctx!;
    const u = this.cleaveTargets().find((x) => x.uid === uid);
    if (!u) return;
    // The whole rest of the attack now reads the new defender: part pick,
    // defense, penetration, kill credit (FAQ D4 - Cleaving crosses units).
    c.defender = u;
    c.surplusOriginalPart = null;
    this.note(`Cleaving carries the Surplus into ${u.label}.`);
    if (u.kind === 'mech') {
      c.step = 'part';
      this.render();
    } else {
      this.pickPart('main');
    }
  }

  private stepSurplus(): HTMLElement {
    const c = this.ctx!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';
    const setup = c.surplusSetup;
    if (setup && !setup.chosen) {
      wrap.innerHTML = `<h4><span class="ah-n">2</span>Surplus Damage: pick ONE keyword</h4>
        <p class="dim">The Action carries more than one Surplus effect, and only one may be chosen (FAQ D1).</p>`;
      const row = document.createElement('div');
      row.className = 'ah-partpick';
      for (const e of setup.effects) {
        const b = document.createElement('button');
        b.className = 'chip chip-intact';
        b.innerHTML = `<b>${e.name}</b> ${e.targets}`;
        b.addEventListener('click', () => this.chooseSurplus(e));
        row.appendChild(b);
      }
      wrap.appendChild(row);
      return wrap;
    }
    // Cleaving's fork: another Part, or another Unit in Range (FAQ D4).
    wrap.innerHTML = `<h4><span class="ah-n">2</span>Cleaving: where does the Surplus go?</h4>
      <p class="dim">Another Part of ${c.defender.label} (never the same Part), or another Unit within the Action's range.${c.defender.kind !== 'mech' ? ' A Drone target cannot be chosen again, so only another Unit will do (FAQ D4).' : ''}</p>`;
    const row = document.createElement('div');
    row.className = 'ah-partpick';
    if (c.defender.kind === 'mech') {
      const b = document.createElement('button');
      b.className = 'chip chip-intact';
      b.innerHTML = `<b>Another Part</b> of ${c.defender.label}`;
      b.addEventListener('click', () => {
        const cc = this.ctx!;
        cc.step = 'part';
        this.render();
      });
      row.appendChild(b);
    }
    for (const u of this.cleaveTargets()) {
      const b = document.createElement('button');
      b.className = 'chip chip-intact';
      b.innerHTML = `<b>${u.label}</b> ${u.kind}`;
      b.addEventListener('click', () => this.cleaveInto(u.uid));
      row.appendChild(b);
    }
    wrap.appendChild(row);
    return wrap;
  }

  private stepPart(): HTMLElement {
    const c = this.ctx!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';
    wrap.innerHTML = `<h4><span class="ah-n">1</span>Determine target Part</h4>
      <p class="dim">${c.explosion
        ? 'Roll the Black Die, or pick a Part directly if the target is Shutdown. Explosions have no facing, so there is no Back Attack here.'
        : 'Roll the Black Die, or pick a Part directly. You may choose when the target is Shutdown or you have a Back Attack, and some Actions designate the Part for you.'}</p>`;

    // The result used to appear as a line of text after the fact, so a new
    // player never saw which Part the die actually chose. The die is shown
    // rolling here and settles on its face before the step moves on.
    const stage = document.createElement('div');
    stage.className = 'ah-blackroll';
    const die = document.createElement('span');
    die.className = 'die die-black';
    const caption = document.createElement('span');
    caption.className = 'ah-blackcap';
    const faceHtml = (i: number) => this.dice.dice.black.faces[i].map((ic) => iconSvg(ic)).join('');
    const showFace = (i: number) => { die.innerHTML = faceHtml(i); };
    showFace(0);
    stage.append(die, caption);

    const rollBtn = document.createElement('button');
    rollBtn.className = 'ah-primary';
    rollBtn.innerHTML = '<i class="btn-ico">🎲</i> Roll Black Die';
    rollBtn.addEventListener('click', () => {
      if (this.blackTimer) return;
      rollBtn.disabled = true;
      pickWrap.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const landed = Math.floor(Math.random() * 6);
      stage.classList.add('rolling');
      caption.textContent = '';
      let ticks = 0;
      this.blackTimer = window.setInterval(() => {
        ticks++;
        showFace(ticks >= 8 ? landed : Math.floor(Math.random() * 6));
        if (ticks < 8) return;
        window.clearInterval(this.blackTimer);
        this.blackTimer = undefined;
        stage.classList.remove('rolling');
        this.settleBlack(landed, caption);
      }, 55);
    });
    wrap.appendChild(rollBtn);
    wrap.appendChild(stage);

    const pickWrap = document.createElement('div');
    pickWrap.className = 'ah-partpick';
    for (const { slot, card } of tokenCards(this.data, c.defender)) {
      if (slot === 'pilot') continue;
      // Scatter-shot and Cleaving send the Surplus somewhere OTHER than the
      // Part the original hit landed on (FAQ D4/D6) — an "Any Part" result or
      // a direct designation may pick anything except it.
      if (c.surplusRound > 0 && slot === c.surplusOriginalPart) continue;
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

  // Reads the landed face, says what it means, then hands on. A pause lets the
  // player see the settled die before the panel changes under them.
  private settleBlack(face: number, caption: HTMLElement): void {
    const c = this.ctx!;
    const part = this.dice.dice.black.faces[face][0]?.part ?? 'any';
    c.blackResult = part;
    if (part === 'any') {
      caption.textContent = 'ANY — the attacker picks the Part.';
      this.note('Black Die: ANY, so the attacker picks the Part.');
      // The panel can be closed during the pause, so nothing here assumes ctx.
      window.setTimeout(() => { if (this.ctx === c) this.render(); }, 700);
      return;
    }
    const slotMap: Record<string, string> = { torso: 'torso', chassis: 'chasis', leftArm: 'leftHand', rightArm: 'rightHand', backpack: 'backpack' };
    let slot = slotMap[part] ?? 'torso';
    const state = c.defender.partStates[slot as PartSlot];
    if (state === undefined || state === 'destroyed') {
      caption.textContent = `${SLOT_LABEL[slot as PartSlot] ?? part} is gone, so the hit redirects to the Torso.`;
      this.note(`Black Die: ${part}. That Part is missing or already destroyed, so the hit redirects to the Torso.`);
      slot = 'torso';
    } else {
      caption.textContent = `${SLOT_LABEL[slot as PartSlot] ?? part} takes the hit.`;
      this.note(`Black Die: ${part}.`);
    }
    // Surplus may not land back on the Part the original hit chose: the Part
    // Die "must be rerolled" on a repeat (FAQ D4), and the redirect above can
    // funnel into it too, so the check comes after the redirect.
    if (c.surplusRound > 0 && slot === c.surplusOriginalPart) {
      caption.textContent = `${SLOT_LABEL[slot as PartSlot] ?? part} was the original hit — reroll the Black Die.`;
      this.note(`Black Die: ${part}, the Part the original hit landed on. Surplus Damage must go elsewhere, so the die is rerolled (FAQ D4).`);
      window.setTimeout(() => { if (this.ctx === c) this.render(); }, 900);
      return;
    }
    const landed = slot;
    window.setTimeout(() => { if (this.ctx === c) this.pickPart(landed); }, 700);
  }

  private pickPart(slot: string): void {
    const c = this.ctx!;
    // A Repaired Part chosen as the hit location is removed at once - no
    // Penetration, no rewards, no second Link loss - and the whole attack
    // redirects to the Core, rolled as normal (FAQ J23/D7).
    if (c.defender.kind === 'mech' && slot !== 'torso' && (c.defender.repairedSlots ?? []).includes(slot)) {
      this.onCommand({ kind: 'breakRepaired', seat: c.attacker.side, uid: c.attacker.uid, targetUid: c.defender.uid, slot });
      this.note(`${SLOT_LABEL[slot as PartSlot | 'main']} bears a Repaired Token: it is removed outright, with no Penetration and no Link loss, and the hit redirects to the Torso (FAQ J23).`);
      this.onChanged();
      this.pickPart('torso');
      return;
    }
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
    // Runs after this element is in the document, so the shake is visible.
    if (this.spinFor === which) {
      this.spinFor = null;
      window.setTimeout(() => this.spinDice(div, roll), 0);
    }
    const rr = document.createElement('span');
    rr.className = 'rerolls';
    for (const side of SQUAD_ORDER) {
      const b = document.createElement('button');
      b.textContent = `${squadLabel(side)} reroll`;
      b.disabled = c.rerolls[which][side];
      b.addEventListener('click', () => {
        if (!roll.some((d) => d.selected)) return;
        c.rerolls[which][side] = true;
        void (async () => {
          this.spinFor = which;
          await this.reroll(roll, 'Focus reroll');
          this.render();
        })();
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
        void (async () => {
          this.spinFor = 'attack';
          c.attackRoll = await this.rollPool({ red: c.attackPool.red, yellow: c.attackPool.yellow }, 'Attack');
          this.render();
        })();
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
        void (async () => {
          this.spinFor = 'defense';
          c.defenseRoll = await this.rollPool({ white: c.defensePool.white, blue: c.defensePool.blue }, 'Defence');
          this.render();
        })();
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
    const { hits, penetrating, unoffset, text, duel } = this.resolve();
    c.hits = hits;
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
        const wasShut = c.defender.stance === 'shutdown';
        // The state change is the command's; the wizard reads the result back
        // off the token and keeps the narration and follow-up flow.
        this.onCommand({ kind: 'applyPenetration', seat: c.attacker.side, uid: c.attacker.uid, targetUid: c.defender.uid, slot });
        const next = c.defender.partStates[slot] ?? 'intact';
        this.onPenetrated(c.defender, c.attacker);
        if (next === 'destroyed') this.onDestroyed(c.attacker, c.defender, 'part');
        const how = c.explosion ? 'Explosion damage' : 'Penetration';
        this.note(`${how} from ${c.attacker.label}: ${SLOT_LABEL[slot]} goes ${cur} to ${next.toUpperCase()}.`, [c.attacker, c.defender]);
        if (next === 'destroyed' && c.defender.kind !== 'mech') this.onDestroyed(c.attacker, c.defender, 'unit');
        if (next === 'destroyed' && c.defender.kind === 'mech') {
          this.note(`Part destroyed, so ${c.defender.label} loses 1 Link (now ${c.defender.link}).`, [c.defender]);
          if (!wasShut && c.defender.stance === 'shutdown') {
            this.note(`Link has reached 0, so ${c.defender.label} SHUTS DOWN.`, [c.defender]);
          }
          if (slot === 'torso') {
            this.onDestroyed(c.attacker, c.defender, 'unit');
            this.note(`⚠ Torso destroyed, so the unit is destroyed. Remove it from the board.`, [c.defender]);
          }
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
        // A destroyed Unit ends the attack outright (4.4.4), so Surplus Damage
        // never carries on against a Mech whose Torso just went.
        const original = c.targetPart;
        const originalState = original ? c.defender.partStates[original as PartSlot | 'main'] ?? 'intact' : 'intact';
        const alive = c.defender.kind === 'mech'
          ? (c.defender.partStates.torso ?? 'intact') !== 'destroyed'
          : originalState !== 'destroyed';
        // Which printed keywords can actually do anything here. Mutilation
        // strikes the SAME Part, so one destroyed outright offers nothing and
        // the Surplus is dropped rather than Torso-redirected (FAQ D9). A
        // Drone target takes Mutilation against its Structure (D8) or sends
        // Cleaving to ANOTHER unit only (D4); Scatter-shot needs Parts.
        const candidates = effects.filter((e) => {
          if (e.name === 'Mutilation') return originalState !== 'destroyed';
          if (c.defender.kind !== 'mech') return e.name === 'Cleaving' && this.cleaveTargets().length > 0;
          return true;
        });
        if (surplus > 0 && candidates.length && c.surplusRound === 0 && alive) {
          c.surplusRound = 1;
          c.carried = carried;
          c.surplusOriginalPart = original;
          c.targetPart = null;
          c.attackRoll = null;
          c.defenseRoll = null;
          c.rerolls = { attack: { s1: false, s2: false }, defense: { s1: false, s2: false } };
          this.note(
            `${surplus} un-offset icon${surplus === 1 ? '' : 's'} carry over as Surplus Damage. No Attack Roll is made, and the defender gets no Protection or Parry dice (4.8).`,
          );
          // The attacker picks ONE keyword when the Action has several (FAQ D1).
          c.surplusSetup = { effects: candidates, chosen: candidates.length === 1 ? candidates[0] : null };
          if (c.surplusSetup.chosen) this.chooseSurplus(c.surplusSetup.chosen);
          else {
            c.step = 'surplus';
            this.render();
          }
        } else {
          if (surplus > 0 && effects.length && effects[0].name === 'Mutilation'
            && c.surplusRound === 0 && originalState === 'destroyed' && alive) {
            this.note(`Mutilation: the ${original ? SLOT_LABEL[original as PartSlot | 'main'] ?? original : 'Part'} was destroyed outright, so it has no Structure and the Surplus Damage is dropped (4.8, FAQ D9).`);
          }
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
      // An Attack with no Penetration still ends through finish(), because icons
      // the defence offset are Hits and on-hit riders such as Knockback fire on
      // them (4.4 note on Hit versus Penetration).
      done.addEventListener('click', () => this.finish(wrap));
      wrap.appendChild(done);
    }
    return wrap;
  }

  private finish(_wrap: HTMLElement): void {
    const c = this.ctx!;
    c.step = 'resolve';
    const rider = { attacker: c.attacker, defender: c.defender, action: c.action, hits: c.hits };
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
    this.onKnockback(rider.attacker, rider.defender, rider.action, rider.hits);
  }
}

// ---------- electronic warfare ----------

// What a counter-roll's dice are worth to their roller. Hollow faces count as
// solid for a unit in Offensive Stance (4.11.3), so validity is per-roller and
// the two sides can read the same dice differently. Shared, because the whole
// rule turns on this count agreeing across both clients.
export function tallyCounter(
  dice: DiceData,
  faces: number[],
  offensive: boolean,
): { lightning: number; light: number } {
  let lightning = 0;
  let light = 0;
  for (const f of faces) {
    for (const icon of dice.dice.yellow.faces[f] ?? []) {
      if (icon.hollow && !offensive) continue;
      if (icon.type === 'lightning') lightning++;
      else if (icon.type === 'lightHit') light++;
    }
  }
  return { lightning, light };
}

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
  private onCommand: (cmd: Command) => void;
  roller: DiceRoller | null = null;
  private ctx: EwCtx | null = null;

  constructor(
    data: GameData,
    dice: DiceData,
    root: HTMLElement,
    onChanged: () => void,
    onClose: () => void,
    onLog: (t: Token, text: string) => void = () => {},
    onCommand: (cmd: Command) => void = () => {},
  ) {
    this.data = data;
    this.dice = dice;
    this.root = root;
    this.onChanged = onChanged;
    this.onClose = onClose;
    this.onLog = onLog;
    this.onCommand = onCommand;
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

  private async rerollYellow(roll: Rolled[], label: string): Promise<void> {
    const sel = roll.filter((d) => d.selected);
    if (!sel.length) return;
    const fresh = await this.rollYellow(sel.length, label);
    sel.forEach((d, i) => {
      const face = fresh[i]?.face;
      if (face !== undefined) d.face = face;
      d.selected = false;
    });
  }

  // Same rule as the attack wizard: the server rolls when there is one.
  private async rollYellow(n: number, label: string): Promise<Rolled[]> {
    const source = this.roller;
    if (source) {
      try {
        const dice = await source({ yellow: n }, label);
        return dice.map((d) => ({ color: 'yellow' as DieColor, face: d.face, selected: false }));
      } catch (err) {
        this.note(`The roll could not be made: ${(err as Error).message}`);
        return [];
      }
    }
    const out: Rolled[] = [];
    for (let i = 0; i < n; i++) out.push({ color: 'yellow', face: Math.floor(Math.random() * this.dice.dice.yellow.sides), selected: false });
    return out;
  }

  private tally(roll: Rolled[], offensive: boolean): { lightning: number; light: number } {
    return tallyCounter(this.dice, roll.map((d) => d.face), offensive);
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
            this.onCommand({ kind: 'applyStatus', seat: c.initiator.side, uid: c.initiator.uid, targetUid: c.responder.uid, statusId: def.id, stacks: n });
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
      // Voluntary spends stop above the last Link (4.10, FAQ L1).
      if (!spent && (t.link ?? 0) > 1) {
        const rr = document.createElement('button');
        rr.className = 'ah-cancel';
        rr.textContent = 'Focus reroll (1 Link)';
        rr.addEventListener('click', () => {
          const sel = roll.filter((d) => d.selected);
          if (!sel.length) return;
          const wasShut = t.stance === 'shutdown';
          this.onCommand({ kind: 'focus', seat: t.side, uid: t.uid });
          if (who === 'init') c.rerolled.init = true;
          else c.rerolled.resp = true;
          this.note(`${t.label} spends 1 Link to Focus, rerolling ${sel.length} die.`);
          if (!wasShut && t.stance === 'shutdown') this.note(`Link has reached 0, so ${t.label} SHUTS DOWN.`);
          void (async () => {
            await this.rerollYellow(roll, 'Focus reroll');
            this.onChanged();
            this.render();
          })();
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
        void (async () => {
          // Both sides of the counter-roll come from one request, so neither
          // player can see the other's dice before their own are fixed.
          const both = await this.rollYellow(c.initEv + c.respEv, 'Electronic counter-roll');
          c.initRoll = both.slice(0, c.initEv);
          c.respRoll = both.slice(c.initEv);
          this.render();
        })();
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

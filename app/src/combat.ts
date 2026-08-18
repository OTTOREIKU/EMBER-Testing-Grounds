import type { GameData } from './data';
import { cardName } from './data';
import { iconSvg } from './dice';
import { linkMechanics } from './inspector';
import { SQUAD_ORDER, squadLabel } from './data';
import type { Card, CardAction, DiceData, DiceIcon, DieColor, GameRuleEffect, PartSlot, Side, SmokeScreen, TerrainPiece, Token } from './types';
import { statusCount, STATUSES } from './types';
import { aaRadarCovers, attackReactionsOf, auraEffectsOn, auraValueOn, defenseReactionOn, dodgeEnhanceReady, meleeEvasionReady, parryParts, targetTracingOn, selfHitParts, denseArmorOn, designationsOn, electronicValue, followUpAfterKill, kcArmorReady, lightningExchangeOf, lightningLinkDrain, loanedParts, pilotCard, repeatersFor, SLOT_LABEL, tokenCards, whistleFunders, type AttackReaction, type MultiTarget } from './units';
import { timingOf } from './ticks';
import { inArc, losNote, protectionFor, rangeBetween } from './rules';
import type { Command } from './commands';

// Where dice results come from. Absent in a local game, which rolls its own;
// set in a networked one, where the server rolls so neither client can pick
// its own numbers.
export type DiceRoller = (pool: Record<string, number>, label?: string) => Promise<{ color: string; face: number }[]>;

type Step = 'split' | 'part' | 'designate' | 'attack' | 'defense' | 'resolve' | 'surplus';

// ---------- Multi-Target (keyword 多目标X, FAQ B7) ----------
//
// "Determine the total number of Attack Dice for this Action, applying any
// effect that increases that number NOW; split those dice between the targets
// however you like, then run one separate attack sequence against each target
// in turn." So the pool is decided ONCE, before any target is resolved, and the
// split is the player's to make — which is why this is a step of its own rather
// than a per-target pool edit.
//
// FAQ B7 adds the ordering: all the attacks are resolved SIMULTANEOUSLY, so a
// reaction a target triggers by being shot at — Emergency Smoke placing Screens
// — lands only after every sequence is done, and cannot obscure the targets
// still to be resolved. `pending` is what makes that true: reactions are
// collected as they trigger and flushed at the end.
interface MultiState {
  cap: MultiTarget;
  action: CardAction;
  attacker: Token;
  // `penetrated` is written when a sequence gets through, because Defense
  // Reaction is owed per TARGET and the debts are not written until B7 lets
  // them out at the end of the whole Action.
  targets: { defender: Token; red: number; yellow: number; penetrated?: boolean }[];
  total: { red: number; yellow: number };
  index: number;
  pending: { defender: Token; reaction: AttackReaction }[];
}

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

// `dense` is Dense Armor (致密装甲): {Defense} may offset {Heavy Hit} too.
//
// `perDie` is Dodge Enhancement (ZYBP-302): "make each {Dodge} offset 1 Attack
// DIE" rather than one icon. When it is supplied, each entry is the hit icons a
// single attack die produced, and one Dodge cancels a whole entry. The dice are
// taken in the order that helps the defender most — the heaviest first — which
// is the same principle the ordinary pass follows by spending Dodges on Heavy
// Hits before Light ones.
//
// Absent, everything below behaves exactly as it always has.
export function offsetIcons(
  heavy: number,
  light: number,
  dodge: number,
  defense: number,
  dense = false,
  perDie?: { heavy: number; light: number }[],
): {
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
  let d = dodge;
  if (perDie) {
    // Grouped by die, best-for-the-defender first, so a Dodge spent on a die
    // carrying two Heavy Hits is not wasted on one carrying a single Light.
    const groups = [...perDie]
      .filter((g) => g.heavy + g.light > 0)
      .sort((a, b) => (b.heavy - a.heavy) || (b.light - a.light));
    let spentHeavy = 0;
    let spentLight = 0;
    for (const g of groups) {
      const cancel = d > 0;
      if (cancel) d--;
      for (let i = 0; i < g.heavy; i++) icons.push({ kind: 'heavyHit', offset: cancel ? 'dodge' : null });
      for (let i = 0; i < g.light; i++) icons.push({ kind: 'lightHit', offset: cancel ? 'dodge' : null });
      spentHeavy += g.heavy;
      spentLight += g.light;
    }
    // Any icons the caller counted but did not attribute to a die still have to
    // appear, or the tally would quietly shrink.
    for (let i = spentHeavy; i < heavy; i++) icons.push({ kind: 'heavyHit', offset: null });
    for (let i = spentLight; i < light; i++) icons.push({ kind: 'lightHit', offset: null });
  } else {
    for (let i = 0; i < heavy; i++) icons.push({ kind: 'heavyHit', offset: null });
    for (let i = 0; i < light; i++) icons.push({ kind: 'lightHit', offset: null });
    for (const ic of icons) {
      if (!d) break;
      if (ic.kind === 'heavyHit') { ic.offset = 'dodge'; d--; }
    }
    for (const ic of icons) {
      if (!d) break;
      if (ic.kind === 'lightHit' && !ic.offset) { ic.offset = 'dodge'; d--; }
    }
  }
  let f = defense;
  for (const ic of icons) {
    if (!f) break;
    if ((ic.kind === 'lightHit' || (dense && ic.kind === 'heavyHit')) && !ic.offset) { ic.offset = 'defense'; f--; }
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
  // An Interception rather than an ordinary attack: the Hyena Radar's Eye
  // conversion applies to one and not the other (FAQ O13).
  intercept: boolean;
  action: CardAction;
  losNote: string;
  protection: number;
  protectionNote: string;
  step: Step;
  targetPart: string | null;
  // Shield Up / Mobile Defense: the Black Die says where the hit LANDED, and
  // the defender may take it on a shield instead. `designateFrom` remembers the
  // rolled slot so the note can say what was redirected, and is null once the
  // question has been answered or was never asked.
  designateFrom: string | null;
  // The Parry Value the designation earned, in White dice (4.6.3). null means
  // the question has not been put yet, which is also what stops it being asked
  // twice for one hit; 0 means it was asked and no Parry came of it.
  designatedParry: number | null;
  attackPool: { red: number; yellow: number };
  defensePool: { white: number; blue: number };
  attackRoll: Rolled[] | null;
  defenseRoll: Rolled[] | null;
  // Whether the defender has already been asked for their roll, so the render
  // loop asks exactly once per attack rather than once per repaint.
  defenseCalled?: boolean;
  blackResult: string | null;
  // 4.4.1 step 5, Focus: after BOTH rolls are made, the attacker declares
  // whether to spend 1 Link, then the defender declares, then the attacker
  // rerolls any of its Attack dice, then the defender any of its Defense
  // dice. One Link buys the whole subset. Mechs with Link only — a Drone or
  // Projectile side auto-declines. Null until both rolls are in.
  focus: {
    stage: 'declareA' | 'declareD' | 'rerollA' | 'rerollD' | 'done';
    attackerUse: boolean;
    defenderUse: boolean;
  } | null;
  // KC Armor (4.10): the defender consumed a Charge Token, so the Defense
  // Roll's Lightning counts as Defense. Derived into the tally by resolve().
  kcUsed?: boolean;
  // Melee Evasion (ZYBP-302) declared this attack: +1 {Dodge} for a Command Token.
  evadeUsed?: boolean;
  // Something got through. Read at the end of the attack, where Defense
  // Reaction's debt is written (ZHLA-101 / ZHLA-301).
  penetrated?: boolean;
  // Dodge Enhancement (ZYBP-302) declared this attack: each {Dodge} cancels a
  // whole Attack DIE rather than one icon. Read by resolve(), which then feeds
  // offsetIcons the per-die breakdown it otherwise does without.
  dodgeDieUsed?: boolean;
  // Concussion/Wrecking's Link drain fires exactly once, when the resolution
  // is applied — never from resolve(), which redraws many times.
  drainSent?: boolean;
  // ZPA-35 Chef: each consumed Command Token exchanges one {Eye} on the ATTACK
  // roll for a {Heavy Hit} (4.15.4). Counted on the state rather than applied to
  // a rendered total, because the tally is derived again at the attack step and
  // at resolve, and a total edited in one place would not survive the other.
  eyeSwaps: number;
  // How many {Lightning} the Pulse/Ion Weapon exchange turned into Heavy Hits
  // on the LAST derivation of the tally. Written by attackIcons — the only
  // reader of the raw roll — so the notes can say what happened without
  // deriving the roll a second time.
  lightningSwapped?: number;
  surplusRound: number;
  carried: { heavy: number; light: number };
  surplusKeyword: SurplusEffect | null;
  // The Part the original hit landed on: Scatter-shot and Cleaving must send
  // the Surplus somewhere ELSE (FAQ D4/D6), and Mutilation back into exactly it.
  surplusOriginalPart: string | null;
  // Set when this attack destroyed a Part, which is the trigger for a card that
  // grants a bonus attack on a kill (the Katana's Chop → Slash, FAQ B8).
  killedPart: boolean;
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
  // The defender's own dice. When set — the Match Centre, with the defending
  // player at another screen — the defence roll is ASKED FOR rather than made:
  // the hook records what is owed, the DEFENDER presses their own roll button,
  // and the promise resolves with their faces. The helper shows a waiting line
  // instead of a roll button while it is out. Null in freeplay, where one
  // player owns both pools and the button is theirs either way.
  defenseRoller: ((pool: { white: number; blue: number }, attacker: Token, defender: Token, actionId: string) => Promise<Rolled[]>) | null = null;
  // Publishes what this window currently shows, so the DEFENDING player's
  // client can draw the same attack — the part chosen, the faces, the
  // resolution — instead of leaving them watching a dice feed. Wired by the
  // Match Centre; null in freeplay, where one player sees everything anyway.
  publishView: ((view: {
    attackerUid: number; targetUid: number; actionId: string;
    mode: 'attack' | 'intercept' | 'explosion'; step: string;
    targetPart: string | null;
    attack: { color: string; face: number }[] | null;
    defense: { color: string; face: number }[] | null;
    log: string[];
    focus: { stage: string; attackerUse: boolean; defenderUse: boolean } | null;
    kcUsed: boolean;
    evadeUsed: boolean;
    evadeReady: boolean;
    dodgeDieUsed: boolean;
    dodgeDieReady: boolean;
    designate: { from: string; slots: { slot: string; label: string }[] } | null;
  } | null) => void) | null = null;
  // Whether this defender's Focus decisions belong to a player at another
  // screen. Wired by the Match Centre; null in freeplay, where one player
  // presses both sides' buttons in the printed order.
  focusRemote: ((defender: Token) => boolean) | null = null;
  // The whole board, for aura reads (FAQ Q1: judged when the roll happens).
  tokens: (() => Token[]) | null = null;
  // Terrain, for the Hyena Radar's line of sight to the intercepted target.
  terrain: (() => TerrainPiece[]) | null = null;
  // Smoke, so a Multi-Target can read each target's own line of sight without
  // the two pages having to compute it one at a time.
  smoke: (() => SmokeScreen[]) | null = null;
  // The page places whatever a deferred reaction produces — it owns the board.
  // Called once, after every sequence of a Multi-Target has resolved (FAQ B7).
  onReaction: (defender: Token, reaction: AttackReaction, attacker: Token) => void = () => {};
  private ctx: Ctx | null = null;
  // Survives across the individual attack sequences, which each replace `ctx`.
  private multi: MultiState | null = null;
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
    intercept = false,
  ): void {
    this.stopBlack();
    this.ctx = {
      attacker,
      defender,
      intercept,
      action,
      losNote,
      protection: explosion ? 0 : protection,
      protectionNote: explosion ? '' : protectionNote,
      step: defender.kind === 'mech' ? 'part' : 'attack',
      targetPart: defender.kind === 'mech' ? null : 'main',
      designateFrom: null,
      designatedParry: null,
      attackPool: { red: action.redDice ?? 0, yellow: action.yellowDice ?? 0 },
      defensePool: { white: 1, blue: 0 },
      attackRoll: null,
      defenseRoll: null,
      blackResult: null,
      focus: null,
      eyeSwaps: 0,
      surplusRound: 0,
      carried: { heavy: 0, light: 0 },
      surplusKeyword: null,
      surplusOriginalPart: null,
      killedPart: false,
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

  // A Multi-Target declaration. The page clicks ONE target as it always has;
  // everything after that — the other targets, the shared pool and the split —
  // is settled here, so neither page has to grow a second targeting flow and
  // the two cannot drift.
  startMulti(attacker: Token, action: CardAction, primary: Token, cap: MultiTarget): void {
    this.stopBlack();
    this.multi = {
      cap,
      action,
      attacker,
      targets: [{ defender: primary, red: action.redDice ?? 0, yellow: action.yellowDice ?? 0 }],
      total: { red: action.redDice ?? 0, yellow: action.yellowDice ?? 0 },
      index: 0,
      pending: [],
    };
    this.openSequence(primary, 'split');
  }

  // Opens one attack sequence. `start` is the single-target front door and this
  // is what both it and the Multi-Target queue go through, so a target added
  // later cannot skip any of the setup the first one got.
  private openSequence(defender: Token, step: Step, pool?: { red: number; yellow: number }): void {
    const m = this.multi!;
    const board = this.tokens ? this.tokens() : [];
    const terrain = this.terrain ? this.terrain() : [];
    const smoke = this.smoke ? this.smoke() : [];
    const prot = protectionFor(m.attacker, defender, m.action, terrain, board, smoke);
    this.ctx = {
      attacker: m.attacker,
      defender,
      intercept: false,
      action: m.action,
      losNote: losNote(m.attacker, defender, m.action, terrain, board, smoke),
      protection: prot.white,
      protectionNote: prot.note,
      step,
      targetPart: defender.kind === 'mech' ? null : 'main',
      designateFrom: null,
      designatedParry: null,
      attackPool: pool ?? { red: m.total.red, yellow: m.total.yellow },
      defensePool: { white: 1, blue: 0 },
      attackRoll: null,
      defenseRoll: null,
      blackResult: null,
      focus: null,
      eyeSwaps: 0,
      surplusRound: 0,
      carried: { heavy: 0, light: 0 },
      surplusKeyword: null,
      surplusOriginalPart: null,
      killedPart: false,
      surplusSetup: null,
      log: [],
      explosion: false,
      hits: 0,
    };
    if (defender.kind !== 'mech') this.ctx.defensePool = this.suggestedDefensePool('main');
    this.render();
  }

  // Everything the attacker could add to a Multi-Target: enemies in the
  // Action's own Range, minus whoever is already on the list. Same reading as
  // cleaveTargets, because it is the same question — who else is reachable.
  private multiCandidates(): Token[] {
    const m = this.multi!;
    const chosen = new Set(m.targets.map((t) => t.defender.uid));
    return (this.tokens ? this.tokens() : []).filter((u) => {
      if (u.side === m.attacker.side || chosen.has(u.uid) || u.deployed === false) return false;
      if ((u.partStates[u.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed') return false;
      if (m.action.type === 'Melee' && u.aerial) return false;
      return rangeBetween(m.attacker, u).range <= (m.action.range ?? 1);
    });
  }

  cancel(): void {
    this.stopBlack();
    this.ctx = null;
    this.multi = null;
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
    // "Ally Units within Range +1W on hit" (RT-18T Escarpment, Defense
    // optimization). It is a defence-pool bonus, so it rides on top of Armor,
    // Structure and Protection rather than replacing any of them.
    white += auraValueOn(this.data, this.tokens ? this.tokens() : [], d, 'defense_white_dice_bonus');
    // Parry (4.6.3), but only for the Part it was declared on: "if a Black Die
    // still decides the Part, the Parry dice only apply when it matches". And
    // never during Surplus Damage, which bars Protection and Parry alike (4.8)
    // — the same rule the surplus notes in this file already state.
    if (this.ctx?.designatedParry && slot === this.ctx.targetPart && !this.ctx.surplusRound) {
      white += this.ctx.designatedParry;
    }
    return { white, blue };
  }

  // ---------- Focus (4.4.1 step 5) ----------
  //
  // After both rolls: the attacker declares, the defender declares, the
  // attacker rerolls, the defender rerolls. 1 Link buys any subset of that
  // side's OWN roll. Only a Mech with Link left may use it, so a Drone or
  // Projectile side is walked past without a question.

  private canFocus(side: 'attacker' | 'defender'): boolean {
    const c = this.ctx!;
    const t = side === 'attacker' ? c.attacker : c.defender;
    const roll = side === 'attacker' ? c.attackRoll : c.defenseRoll;
    // A Surplus round makes no Attack Roll (4.8), so the attacker's half of
    // step 5 has nothing to act on.
    if (side === 'attacker' && c.surplusRound > 0) return false;
    return t.kind === 'mech' && (t.link ?? 0) > 0 && !!roll && roll.length > 0;
  }

  private beginFocus(): void {
    const c = this.ctx!;
    if (c.focus) return;
    c.focus = { stage: 'declareA', attackerUse: false, defenderUse: false };
    this.skipFocusStages();
  }

  // Walks past the declares that have no one eligible to answer them.
  private skipFocusStages(): void {
    const f = this.ctx!.focus!;
    if (f.stage === 'declareA' && !this.canFocus('attacker')) f.stage = 'declareD';
    if (f.stage === 'declareD' && !this.canFocus('defender')) f.stage = f.attackerUse ? 'rerollA' : 'done';
  }

  // A declare answered on THIS screen — the attacker always, and the defender
  // in freeplay. The Link is spent here, through the command, so it travels
  // and the squad panel keeps up.
  private focusDeclare(side: 'attacker' | 'defender', use: boolean): void {
    const c = this.ctx!;
    const f = c.focus!;
    const t = side === 'attacker' ? c.attacker : c.defender;
    if (use) {
      this.onCommand({ kind: 'focus', seat: t.side, uid: t.uid });
      this.note(`${t.label} spends 1 Link to Focus (4.4.1): it may reroll any of its ${side === 'attacker' ? 'Attack' : 'Defense'} dice.`);
    }
    if (side === 'attacker') {
      f.attackerUse = use;
      f.stage = 'declareD';
      this.skipFocusStages();
    } else {
      f.defenderUse = use;
      f.stage = f.attackerUse ? 'rerollA' : use ? 'rerollD' : 'done';
    }
    this.onChanged();
    this.render();
  }

  private finishFocusReroll(which: 'attack' | 'defense'): void {
    const f = this.ctx!.focus!;
    f.stage = which === 'attack' ? (f.defenderUse ? 'rerollD' : 'done') : 'done';
    this.render();
  }

  // Concussion/Wrecking's Link drain (4.10), sent once as the resolution is
  // applied. Clamped to the Link actually left so a big roll cannot push a
  // Mech below zero on the wire.
  private sendLightningDrain(): void {
    const c = this.ctx!;
    if (c.drainSent || c.surplusRound > 0) return;
    c.drainSent = true;
    const kind = lightningLinkDrain(c.action);
    if (!kind || c.defender.kind !== 'mech') return;
    const n = Math.min(this.attackIcons(c).lightning ?? 0, c.defender.link ?? 0);
    if (!n) return;
    this.onCommand({ kind: 'drainLink', seat: c.attacker.side, uid: c.attacker.uid, targetUid: c.defender.uid, n });
    this.note(`${c.defender.label} loses ${n} Link (${kind === 'wrecking' ? 'Wrecking' : 'Concussion'}, 4.10)${(c.defender.link ?? 0) - n <= 0 ? ' — at 0 Link it Shuts Down' : ''}.`);
    this.onChanged();
  }

  // The remote defender's KC Armor declare, carried by a kcArmor command; the
  // Charge Token was spent by their own setCharge. Freeplay reaches this
  // directly from the button.
  // The defender declared Melee Evasion. Their client sent it and spent the
  // Command Token; this window is where the extra {Dodge} lands.
  evadeDeclared(): void {
    const c = this.ctx;
    if (!c || c.evadeUsed) return;
    c.evadeUsed = true;
    this.note(`${c.defender.label} spends a Command Token for Melee Evasion: +1 [Dodge] on the Parry (ZYBP-302).`, [c.defender]);
    this.render();
  }

  // The defender declared Dodge Enhancement. Their Command Token is already
  // spent; this window is where the offsetting changes shape.
  dodgeEnhanceDeclared(): void {
    const c = this.ctx;
    if (!c || c.dodgeDieUsed) return;
    c.dodgeDieUsed = true;
    this.note(`${c.defender.label} spends a Command Token for Dodge Enhancement: each [Dodge] now cancels a whole Attack die (ZYBP-302).`, [c.defender]);
    this.render();
  }

  kcArmed(): void {
    const c = this.ctx;
    if (!c || c.kcUsed) return;
    c.kcUsed = true;
    this.note(`${c.defender.label} consumes a Charge Token: KC Armor turns its Defense Roll's [Lightning] into [Defense] (4.10).`);
    this.render();
  }

  // The remote defender's declare, carried by a focusAnswer command. Their own
  // client already spent the Link, so this only advances the stage.
  focusAnswered(use: boolean): void {
    const c = this.ctx;
    if (!c?.focus || c.focus.stage !== 'declareD') return;
    c.focus.defenderUse = use;
    this.note(use
      ? `${c.defender.label} spends 1 Link to Focus (4.4.1): it may reroll any of its Defense dice.`
      : `${c.defender.label} declines to Focus.`);
    c.focus.stage = c.focus.attackerUse ? 'rerollA' : use ? 'rerollD' : 'done';
    this.render();
  }

  // The remote defender's reroll: the dice they chose and the faces their
  // server roll produced, riding in a focusReroll command the same way
  // answerDefense carries the defence roll. Empty means they kept the roll.
  focusRerolled(indices: number[], faces: { color: string; face: number }[]): void {
    const c = this.ctx;
    if (!c?.focus || c.focus.stage !== 'rerollD' || !c.defenseRoll) return;
    indices.forEach((idx, k) => {
      const d = c.defenseRoll![idx];
      const nf = faces[k];
      if (d && nf && d.color === nf.color) {
        d.face = nf.face;
        d.selected = false;
      }
    });
    if (indices.length) this.note(`${c.defender.label} rerolls ${indices.length} ${indices.length === 1 ? 'die' : 'dice'} (Focus).`);
    c.focus.stage = 'done';
    this.render();
  }

  // The question the current Focus stage asks, rendered under the defence
  // roll. Returns null once the flow is done and the Resolve button may show.
  private focusBlock(): HTMLElement | null {
    const c = this.ctx!;
    const f = c.focus!;
    if (f.stage === 'done') return null;
    const wrap = document.createElement('div');
    wrap.className = 'ah-focus';
    const remoteD = !!(this.focusRemote && this.focusRemote(c.defender));
    const declare = (side: 'attacker' | 'defender'): void => {
      const t = side === 'attacker' ? c.attacker : c.defender;
      const p = document.createElement('p');
      p.className = 'ah-note';
      p.textContent = `Focus (4.4.1-5): ${t.label} may spend 1 Link (${t.link ?? 0} left) to reroll any of its ${side === 'attacker' ? 'Attack' : 'Defense'} dice — ${side === 'attacker' ? 'the attacker declares first' : 'the defender declares second'}.`;
      wrap.appendChild(p);
      const use = document.createElement('button');
      use.className = 'ah-primary';
      use.textContent = 'Focus — spend 1 Link';
      use.addEventListener('click', () => this.focusDeclare(side, true));
      const pass = document.createElement('button');
      pass.className = 'ah-alt';
      pass.textContent = 'Pass';
      pass.addEventListener('click', () => this.focusDeclare(side, false));
      wrap.appendChild(use);
      wrap.appendChild(pass);
    };
    if (f.stage === 'declareA') declare('attacker');
    else if (f.stage === 'declareD') {
      if (remoteD) {
        const p = document.createElement('p');
        p.className = 'ah-note';
        p.textContent = `Focus (4.4.1-5): waiting for ${c.defender.label}'s player — they may spend 1 Link to reroll their Defense dice.`;
        wrap.appendChild(p);
      } else declare('defender');
    } else if (f.stage === 'rerollA') {
      const p = document.createElement('p');
      p.className = 'ah-note';
      p.textContent = `${c.attacker.label} Focused: select any Attack dice below, then reroll them.`;
      wrap.appendChild(p);
      wrap.appendChild(this.rollView(c.attackRoll ?? [], 'attack'));
    } else if (f.stage === 'rerollD') {
      const p = document.createElement('p');
      p.className = 'ah-note';
      p.textContent = remoteD
        ? `Waiting for ${c.defender.label}'s player to reroll their chosen Defense dice.`
        : `${c.defender.label} Focused: select any Defense dice above, then reroll them.`;
      wrap.appendChild(p);
    }
    return wrap;
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

  // The attack tally, with Chef's exchanges applied. Every reader of the attack
  // roll goes through here so the display and the resolution cannot disagree —
  // an exchange the player can see in the summary but that does not reach
  // resolve() is worse than not offering it.
  // Chef's exchange is offered only when every part of the printed condition
  // holds: this Mech is piloted by Chef, the Action is a Melee one, an {Eye} is
  // still showing to exchange, and the Mech still bears a face-up Command Token
  // to consume (4.15.4).
  private chefCanSwap(c: Ctx, atk: Record<string, number>): boolean {
    if (c.attacker.kind !== 'mech') return false;
    if (pilotCard(this.data, c.attacker)?.id !== 'ZPA-35') return false;
    if (timingOf(c.action) !== 'melee') return false;
    if ((atk.eye ?? 0) <= 0) return false;
    return statusCount(c.attacker.statuses, 'command') > 0;
  }

  // The same tally as attackIcons, but kept PER DIE, for Dodge Enhancement:
  // "each {Dodge} offsets 1 Attack die" needs to know which icons shared a die.
  //
  // The swaps have to be followed here too, or a Heavy Hit that came from a
  // traded Lightning would belong to no die and could never be dodged away.
  // Anything this cannot attribute is simply left out — offsetIcons still
  // counts it, it just cannot be cancelled as part of a die, which errs
  // against the defender rather than inventing a cancellation.
  private attackIconsPerDie(c: Ctx): { heavy: number; light: number }[] {
    const upgrade = c.attacker.stance === 'offensive';
    const swapLightning = !!this.lightningSwap(c);
    let eyesLeft = c.eyeSwaps ?? 0;
    const out: { heavy: number; light: number }[] = [];
    for (const d of c.attackRoll ?? []) {
      let heavy = 0;
      let light = 0;
      for (const icon of this.dice.dice[d.color].faces[d.face]) {
        if (icon.type === 'part') continue;
        if (icon.hollow && !upgrade) continue;
        if (icon.type === 'heavyHit') heavy++;
        else if (icon.type === 'lightHit') light++;
        else if (icon.type === 'lightning' && swapLightning) heavy++;
        else if (icon.type === 'eye' && eyesLeft > 0) { heavy++; eyesLeft--; }
      }
      out.push({ heavy, light });
    }
    return out;
  }

  private attackIcons(c: Ctx): Record<string, number> {
    let counts = this.countIcons(c.attackRoll ?? [], c.attacker.stance === 'offensive');
    const swaps = Math.min(c.eyeSwaps ?? 0, counts.eye ?? 0);
    if (swaps) counts = { ...counts, eye: (counts.eye ?? 0) - swaps, heavyHit: (counts.heavyHit ?? 0) + swaps };
    const ex = this.lightningSwap(c);
    c.lightningSwapped = ex ? counts.lightning ?? 0 : 0;
    if (ex && counts.lightning) {
      counts = { ...counts, lightning: 0, heavyHit: (counts.heavyHit ?? 0) + counts.lightning };
    }
    return counts;
  }

  // Pulse Weapon trades every Lightning in the Attack Roll for a Heavy Hit;
  // Ion Weapon makes the same trade only against a target already bearing a
  // Fragile Token. A Lightning buys nothing else in this pipeline, so the
  // printed "may" is applied without asking.
  private lightningSwap(c: Ctx): 'pulse' | 'ion' | null {
    const ex = lightningExchangeOf(c.action);
    if (ex === 'ion' && statusCount(c.defender.statuses, 'fragile') <= 0) return null;
    return ex;
  }

  private resolve(): { hits: number; penetrating: number; unoffset: { heavy: number; light: number }; text: string[]; duel: Duel } {
    const c = this.ctx!;
    const atk = this.attackIcons(c);
    const def = this.countIcons(c.defenseRoll ?? [], c.defender.stance === 'defensive');
    // KC Armor (4.10): the consumed Charge Token turns every {Lightning} in
    // the Defense Roll into {Defense}. Derived here so the tally and the
    // resolution can never disagree about the trade.
    const kcSwapped = c.kcUsed ? def.lightning ?? 0 : 0;
    if (kcSwapped) {
      def.defense = (def.defense ?? 0) + kcSwapped;
      def.lightning = 0;
    }
    // The Token, or the MES Beacon's aura: the aura grants the KEYWORD, so it
    // works exactly like the Token here and Scan cannot strip it (FAQ Q3/J2).
    const lowProfile = c.action.type === 'Firing' && (statusCount(c.defender.statuses, 'lowProfile') > 0
      || (this.tokens ? auraEffectsOn(this.data, this.tokens(), c.defender).has('low_profile') : false));
    // Melee Evasion adds a {Dodge} ICON, not a die — the card writes it braced,
    // and the pool was already rolled by now.
    if (c.evadeUsed) def.dodge = (def.dodge ?? 0) + 1;
    if (lowProfile && def.eye) {
      def.dodge = (def.dodge ?? 0) + def.eye;
      def.eye = 0;
    }
    // The Hyena Radar's passive is always on, and turns the attacker's [Eye]
    // into a Light Hit - but only on an INTERCEPTION, never on an ordinary
    // Firing Action at the same target (FAQ O12/O13).
    const radar = c.intercept && atk.eye && this.tokens
      ? aaRadarCovers(this.data, this.tokens(), this.terrain ? this.terrain() : [], c.attacker, c.defender)
      : undefined;
    if (radar && atk.eye) {
      atk.lightHit = (atk.lightHit ?? 0) + atk.eye;
      atk.eye = 0;
    }
    let heavy = c.surplusRound === 0 ? atk.heavyHit ?? 0 : 0;
    let light = c.surplusRound === 0 ? atk.lightHit ?? 0 : 0;
    // Wrecking (粉碎): each {Lightning} in the Attack Roll ALSO causes damage,
    // counted alongside the Light Hits; the Link drain half happens once, when
    // the resolution is applied. Concussion drains without the damage.
    const drainKind = c.surplusRound === 0 ? lightningLinkDrain(c.action) : null;
    const drained = drainKind ? atk.lightning ?? 0 : 0;
    if (drainKind === 'wrecking') light += drained;
    if (c.surplusRound > 0) {
      heavy = c.carried.heavy;
      light = c.carried.light;
    }
    const dodge = def.dodge ?? 0;
    const defense = def.defense ?? 0;
    const text: string[] = [];
    if (c.protection && !c.surplusRound) text.push(`🛡 ${c.protectionNote}: defender rolled +${c.protection} White`);
    if (lowProfile && dodge) text.push(`Low Profile: [Eye] counted as [Dodge] against this Firing Attack`);
    if (radar) text.push(`${radar.label} sees the target: [Eye] counted as 1 Light Hit on this Interception (FAQ O12/O13)`);
    if (c.surplusRound === 0 && c.lightningSwapped) {
      const swapped = c.lightningSwapped;
      text.push(this.lightningSwap(c) === 'pulse'
        ? `Pulse Weapon: ${swapped} [Lightning] exchanged for ${swapped === 1 ? 'a Heavy Hit' : 'Heavy Hits'}`
        : `Ion Weapon: the target bears a Fragile Token, so ${swapped} [Lightning] exchanged for ${swapped === 1 ? 'a Heavy Hit' : 'Heavy Hits'}`);
    }
    const totalIcons = heavy + light;

    // Dense Armor (致密装甲): {Defense} may offset {Heavy Hit}.
    const dense = denseArmorOn(this.data, c.defender);
    if (kcSwapped) text.push(`KC Armor: a Charge Token turned ${kcSwapped} [Lightning] in the Defense Roll into ${kcSwapped === 1 ? 'a Defense icon' : 'Defense icons'} (4.10)`);
    if (drainKind && drained) {
      if (c.defender.kind === 'mech') {
        text.push(drainKind === 'wrecking'
          ? `Wrecking: ${drained} [Lightning] — each strips 1 Link from ${c.defender.label} and counts as damage`
          : `Concussion: ${drained} [Lightning] — each strips 1 Link from ${c.defender.label}`);
      } else if (drainKind === 'wrecking') {
        text.push(`Wrecking: ${drained} [Lightning] count as damage — ${c.defender.label} has no Link to strip`);
      }
    }
    if (dense && heavy) text.push('Dense Armor: [Defense] may offset [Heavy Hit] here (4.10)');
    const { icons, spareDodge, idleDefense, dodged, blocked, penetrating, hits, unoffset } =
      offsetIcons(heavy, light, dodge, defense, dense, c.dodgeDieUsed ? this.attackIconsPerDie(c) : undefined);
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

  // A checkpoint REPLACES every token object while the helper is open — and
  // with the defence handshake the helper now waits on a human at another
  // screen, so that window is minutes, not frames. The uids survive the swap;
  // the references do not, and a read off the old object misses everything a
  // command wrote since (a Penetration read back "intact" off a dead object
  // and never fired the part-kill). Re-resolve before reading. The fallback
  // keeps a unit that was removed from the board readable for the narration.
  private rebind(c: Ctx): void {
    const board = this.tokens ? this.tokens() : [];
    c.attacker = board.find((x) => x.uid === c.attacker.uid) ?? c.attacker;
    c.defender = board.find((x) => x.uid === c.defender.uid) ?? c.defender;
  }

  private render(): void {
    const c = this.ctx;
    if (!c) return;
    this.rebind(c);
    // Everything the defender's mirror needs, refreshed whenever this window
    // redraws. The log tail is stripped of markup: it travels and is drawn
    // with innerHTML on the far side.
    this.publishView?.({
      attackerUid: c.attacker.uid,
      targetUid: c.defender.uid,
      actionId: c.action.id,
      mode: c.explosion ? 'explosion' : c.intercept ? 'intercept' : 'attack',
      step: c.step,
      targetPart: c.targetPart ?? null,
      attack: c.attackRoll?.map((d) => ({ color: d.color, face: d.face })) ?? null,
      defense: c.defenseRoll?.map((d) => ({ color: d.color, face: d.face })) ?? null,
      log: c.log.slice(-5).map((l) => l.replace(/<[^>]*>/g, '')),
      focus: c.focus ? { stage: c.focus.stage, attackerUse: c.focus.attackerUse, defenderUse: c.focus.defenderUse } : null,
      // Only while the question is open, and only ever answered on the
      // defender's own client — this is what their mirror draws buttons from.
      designate: c.step === 'designate' && c.designateFrom
        ? {
            from: c.designateFrom,
            slots: this.designateOffers(c.designateFrom).map((x) => ({ slot: x.slot, label: x.label })),
          }
        : null,
      kcUsed: !!c.kcUsed,
      evadeUsed: !!c.evadeUsed,
      // Offered only where the rule allows it: a Parry was actually declared,
      // the Part carries Melee Evasion, and a face-up Command Token is there
      // to spend.
      evadeReady: !c.evadeUsed && !!c.designatedParry && meleeEvasionReady(this.data, c.defender),
      dodgeDieUsed: !!c.dodgeDieUsed,
      // No Parry condition on this one — any hit will do — but the Defense Roll
      // has to be on the table, because what it buys is decided against dice
      // that are already showing.
      dodgeDieReady: !c.dodgeDieUsed && c.step === 'defense' && dodgeEnhanceReady(this.data, c.defender),
    });
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

    if (c.step === 'split') el.appendChild(this.stepSplit());
    if (c.step === 'surplus') el.appendChild(this.stepSurplus());
    if (c.step === 'part') el.appendChild(this.stepPart());
    if (c.step === 'designate') el.appendChild(this.stepDesignate());
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

  // ---------- Multi-Target: pick the targets, then split the pool ----------

  private stepSplit(): HTMLElement {
    const m = this.multi!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';
    const spent = m.targets.reduce((s, t) => ({ red: s.red + t.red, yellow: s.yellow + t.yellow }), { red: 0, yellow: 0 });
    const left = { red: m.total.red - spent.red, yellow: m.total.yellow - spent.yellow };
    wrap.innerHTML = `<h4><span class="ah-n">1</span>Multi-Target ${m.cap.limit}</h4>
      <p class="dim">Up to ${m.cap.limit} targets at once. Settle the <b>total</b> pool first — every effect that adds dice applies to it now, once — then split those dice between the targets however you like. Each target then gets its own full attack sequence, and a Mech may Focus on each one separately.</p>
      ${m.cap.condition ? `<p class="ah-protect">This Part only <b>gains</b> Multi-Target under a condition the app does not track: <b>${m.cap.condition}</b>. Check it holds before splitting.</p>` : ''}
      <p class="ah-protect">All the attacks count as resolved <b>at the same time</b> (FAQ B7), so anything a target sets off by being shot at — Emergency Smoke, for one — is placed only after the last sequence and cannot shield the targets still to come.</p>`;
    const totalLabel = document.createElement('p');
    totalLabel.className = 'dim';
    totalLabel.textContent = 'Total Attack Dice for the whole Action:';
    wrap.append(totalLabel);
    wrap.appendChild(
      this.poolEditor(
        [['Red', 'red'], ['Yellow', 'yellow']],
        (col) => (col === 'red' ? m.total.red : m.total.yellow),
        (col, n) => {
          if (col === 'red') m.total.red = n; else m.total.yellow = n;
          this.render();
        },
      ),
    );
    for (const row of m.targets) {
      const box = document.createElement('div');
      box.className = 'ah-mt-row';
      const name = document.createElement('p');
      name.className = 'ah-sum';
      name.textContent = row.defender.label;
      box.appendChild(name);
      box.appendChild(
        this.poolEditor(
          [['Red', 'red'], ['Yellow', 'yellow']],
          (col) => (col === 'red' ? row.red : row.yellow),
          (col, n) => {
            if (col === 'red') row.red = n; else row.yellow = n;
            this.render();
          },
        ),
      );
      // The first target is the one the player clicked on the board, so
      // dropping it would leave the attack with nothing declared.
      if (row.defender.uid !== m.targets[0].defender.uid) {
        const drop = document.createElement('button');
        drop.className = 'ah-ghost';
        drop.textContent = `Drop ${row.defender.label}`;
        drop.addEventListener('click', () => {
          m.targets = m.targets.filter((t) => t.defender.uid !== row.defender.uid);
          this.render();
        });
        box.appendChild(drop);
      }
      wrap.appendChild(box);
    }
    if (m.targets.length < m.cap.limit) {
      const more = this.multiCandidates();
      const add = document.createElement('p');
      add.className = 'dim';
      add.textContent = more.length
        ? `Add another target (${m.cap.limit - m.targets.length} more allowed):`
        : 'No other enemy is in range to add.';
      wrap.appendChild(add);
      for (const u of more) {
        const b = document.createElement('button');
        b.className = 'ah-ghost';
        b.textContent = `+ ${u.label}`;
        b.addEventListener('click', () => {
          m.targets.push({ defender: u, red: 0, yellow: 0 });
          this.render();
        });
        wrap.appendChild(b);
      }
    }
    const tally = document.createElement('p');
    tally.className = 'ah-sum';
    tally.textContent = left.red === 0 && left.yellow === 0
      ? 'Every die is allotted.'
      : `Still to allot: ${left.red} Red, ${left.yellow} Yellow.`;
    wrap.appendChild(tally);
    // Warn, do not block: the split is the player's, and a house rule or a card
    // we have not modelled may legitimately leave the numbers looking odd.
    if (left.red < 0 || left.yellow < 0) {
      const over = document.createElement('p');
      over.className = 'ah-protect';
      over.textContent = 'That is more dice than the total pool holds.';
      wrap.appendChild(over);
    }
    if (m.targets.some((t) => t.red + t.yellow === 0)) {
      const none = document.createElement('p');
      none.className = 'ah-protect';
      none.textContent = 'A target with no dice allotted still gets an attack sequence, and it will roll nothing.';
      wrap.appendChild(none);
    }
    const go = document.createElement('button');
    go.className = 'ah-primary';
    go.textContent = `Begin the attack on ${m.targets[0].defender.label} ▸`;
    go.addEventListener('click', () => {
      m.index = 0;
      const first = m.targets[0];
      this.openSequence(first.defender, first.defender.kind === 'mech' ? 'part' : 'attack', { red: first.red, yellow: first.yellow });
      // After the sequence opens, so the declaration heads the log the player
      // is about to read rather than the split screen they have just left.
      // The simultaneity clause only means something with more than one target,
      // and "All 1 attacks resolve simultaneously" reads like a bug.
      this.note(
        `${m.attacker.label} attacks with ${m.action.name.en || m.action.name.zh}: ${
          m.targets.map((t) => `${t.defender.label} (${t.red}R ${t.yellow}Y)`).join(', ')
        }.${m.targets.length > 1 ? ` All ${m.targets.length} attacks resolve simultaneously (FAQ B7).` : ''}`,
        [m.attacker, ...m.targets.map((t) => t.defender)],
      );
      this.render();
    });
    wrap.appendChild(go);
    return wrap;
  }

  // What a defender is owed for having been shot at. The card says "after this
  // unit is ATTACKED BY A FIRING ACTION", so a Melee blow, an Explosion or an
  // Interception does not wake it.
  // What being attacked owes the DEFENDER. Emergency Smoke answers a Firing
  // Action only; Target Tracing answers Melee or Firing, and only from an enemy
  // MECH -- a Drone or a Projectile sets nothing off (174).
  private reactionsFor(action: CardAction, defender: Token, attacker: Token | null, penetrated = false): AttackReaction[] {
    const out: AttackReaction[] = [];
    // Defense Reaction asks nothing of the attack except that it got through,
    // so it is the only one of these gated on Penetration rather than on the
    // Action's type (ZHLA-101 / ZHLA-301).
    if (penetrated) {
      const def = defenseReactionOn(this.data, defender);
      if (def) out.push({ actionId: def.actionId, name: def.name, stance: true, afterDestroyed: false });
    }
    if (action.type === 'Firing') out.push(...attackReactionsOf(this.data, defender));
    const meleeOrFiring = action.type === 'Firing' || action.type === 'Melee';
    if (meleeOrFiring && attacker && attacker.kind === 'mech' && attacker.side !== defender.side) {
      const trace = targetTracingOn(this.data, defender);
      if (trace) out.push({ actionId: trace.actionId, name: trace.name, trace: true, afterDestroyed: false });
    }
    return out;
  }

  // Called when one sequence of a Multi-Target has finished. Returns true when
  // it took over — the caller must not close the helper in that case.
  private advanceMulti(): boolean {
    const m = this.multi;
    if (!m) return false;
    // Whatever this target set off by being attacked waits for the end (B7).
    const hit = m.targets[m.index]?.defender;
    if (hit) {
      for (const r of this.reactionsFor(m.action, hit, m.attacker, m.targets[m.index]?.penetrated)) m.pending.push({ defender: hit, reaction: r });
    }
    m.index++;
    const next = m.targets[m.index];
    if (next) {
      this.openSequence(next.defender, next.defender.kind === 'mech' ? 'part' : 'attack', { red: next.red, yellow: next.yellow });
      return true;
    }
    this.flushReactions();
    this.multi = null;
    return false;
  }

  // FAQ B7's payload: the Screens go down only now, with every attack already
  // resolved. Handed to the page because placing them is a board command.
  private flushReactions(): void {
    const m = this.multi;
    if (!m?.pending.length) return;
    for (const p of m.pending) this.onReaction(p.defender, p.reaction, m.attacker);
    m.pending = [];
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
    // Reached from the Black Die's settle timer, well after the last render.
    this.rebind(c);
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
    // Shield Up (Defensive Stance only) and Mobile Defense (always) let the
    // defender take the hit on that Part instead of the one the Black Die
    // found. Offered once, and only when there is a different Part to offer:
    // a shield already hit has nothing to redirect.
    // Asked of whoever owns the defender. When that is the other player the
    // step still opens — the attacker's window waits, their mirror answers —
    // because the choice is the defender's and must never be made for them.
    const offers = this.designateOffers(slot);
    if (offers.length && c.designatedParry === null) {
      c.designateFrom = slot;
      c.step = 'designate';
      this.render();
      return;
    }
    c.targetPart = slot;
    c.defensePool = this.suggestedDefensePool(slot);
    // Surplus Damage makes no Attack Roll: the un-offset icons from the first
    // Penetration ARE the roll (4.8 step 3), so the attack step is skipped.
    c.step = c.surplusRound > 0 ? 'defense' : 'attack';
    this.render();
  }

  // Everything the defender may designate for this hit: a Part that says it may
  // resolve damage (Shield Up, Mobile Defense) and, on a Melee attack, any Part
  // with a Parry Value (4.6.3). Kept in one place so the attacker's window, the
  // published offer and the answer check can never disagree about what was on
  // the table.
  private designateOffers(from: string): { slot: string; label: string; parry: number }[] {
    const c = this.ctx!;
    const out: { slot: string; label: string; parry: number }[] = [];
    for (const x of selfHitParts(this.data, c.defender)) {
      if (x.slot !== from) out.push({ slot: x.slot, label: x.label, parry: 0 });
    }
    // Back Attack is judged from the DEFENDER's facing: the attacker standing
    // in their rear arc is what bars the Parry.
    const parries = parryParts(this.data, c.defender, {
      melee: c.action.type === 'Melee',
      backAttack: inArc(c.defender, c.attacker, 'rear'),
    });
    for (const x of parries) {
      const already = out.find((o) => o.slot === x.slot);
      // A Part can be both a shield and a Parry; the Parry Value is the part
      // worth saying out loud, so it wins the label.
      if (already) { already.parry = x.value; already.label = `${x.label} — Parry ${x.value}`; continue; }
      out.push({ slot: x.slot, label: `${x.label} — Parry ${x.value}`, parry: x.value });
    }
    return out;
  }

  private stepDesignate(): HTMLElement {
    const c = this.ctx!;
    const from = c.designateFrom!;
    const wrap = document.createElement('div');
    wrap.className = 'ah-step';
    const rolled = SLOT_LABEL[from as PartSlot | 'main'];
    const remoteDefender = !!(this.focusRemote && this.focusRemote(c.defender));
    wrap.innerHTML = `<h4><span class="ah-n">2</span>Designate the Part</h4>
      <p class="ah-note">The hit landed on <b>${rolled}</b>. ${
        remoteDefender
          ? 'Waiting for the defending player — they may take it on a Part that Designates instead.'
          : 'This Mech may take it on a Part that Designates instead.'
      }</p>`;
    if (remoteDefender) {
      linkMechanics(wrap, this.data.mechanics);
      return wrap;
    }
    for (const opt of this.designateOffers(from)) {
      const b = document.createElement('button');
      b.className = 'ah-primary';
      b.textContent = `${SLOT_LABEL[opt.slot as PartSlot | 'main']} — ${opt.label}`;
      b.addEventListener('click', () => this.designateHit(opt.slot, from));
      wrap.appendChild(b);
    }
    const keep = document.createElement('button');
    keep.className = 'ah-alt';
    keep.textContent = `Keep ${rolled}`;
    keep.addEventListener('click', () => this.designateHit(from, from));
    wrap.appendChild(keep);
    linkMechanics(wrap, this.data.mechanics);
    return wrap;
  }

  // The remote defender's Designate, carried by a designateHit command. Their
  // own client sent it; this window is where the hit actually moves.
  designateAnswered(slot: string): void {
    const c = this.ctx;
    if (!c || c.step !== 'designate' || !c.designateFrom) return;
    const legal = slot === c.designateFrom
      || this.designateOffers(c.designateFrom).some((x) => x.slot === slot);
    // A slot that is not on offer is refused rather than applied: the command
    // arrives from the other player's client, which is not ours to trust.
    if (!legal) return;
    this.designateHit(slot, c.designateFrom);
  }

  // The defender's answer. Declining keeps the rolled Part, so the same call
  // settles both branches — and designateFrom is left set either way, which is
  // what stops the question being asked twice for one hit.
  private designateHit(slot: string, from: string): void {
    const c = this.ctx!;
    this.rebind(c);
    const chosen = this.designateOffers(from).find((o) => o.slot === slot);
    // Recorded even when it is 0, because null is what means "not yet asked".
    c.designatedParry = chosen?.parry ?? 0;
    if (slot !== from) {
      const part = SLOT_LABEL[slot as PartSlot | 'main'];
      this.note(`${c.defender.label} Designates ${part} to resolve the damage, so the hit moves off ${SLOT_LABEL[from as PartSlot | 'main']}.`, [c.defender]);
    }
    if (c.designatedParry > 0) {
      this.note(`Parry (4.6.3): ${SLOT_LABEL[slot as PartSlot | 'main']} adds ${c.designatedParry} White ${c.designatedParry === 1 ? 'die' : 'dice'} to the Defense Roll.`, [c.defender]);
    }
    c.targetPart = slot;
    c.defensePool = this.suggestedDefensePool(slot);
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
    // The Focus reroll (4.4.1-5) replaces the old free-form squad buttons: it
    // appears only at that side's reroll stage, after the Link was spent at
    // the declare step, and rerolls whatever dice are selected above. The
    // remote defender's copy of these buttons lives in their combat mirror.
    const f = c.focus;
    const rerollStage = which === 'attack' ? 'rerollA' : 'rerollD';
    const drivenHere = which === 'attack' || !(this.focusRemote && this.focusRemote(c.defender));
    if (f && f.stage === rerollStage && drivenHere) {
      const go = document.createElement('button');
      go.textContent = 'Focus: reroll selected';
      go.title = 'The Link is already spent — reroll every selected die above.';
      go.addEventListener('click', () => {
        if (!roll.some((d) => d.selected)) return;
        void (async () => {
          this.spinFor = which;
          await this.reroll(roll, 'Focus reroll');
          this.finishFocusReroll(which);
        })();
      });
      rr.appendChild(go);
      const keep = document.createElement('button');
      keep.textContent = 'Keep the roll';
      keep.title = 'End the Focus without rerolling anything.';
      keep.addEventListener('click', () => this.finishFocusReroll(which));
      rr.appendChild(keep);
    }
    // The Whistle's Aura is a SECOND source of rerolls, not a cheaper Focus: it
    // is funded by a nearby Ally Mech's Command Token rather than by Link, so it
    // deliberately does not touch c.rerolls and can be used even after that
    // side has already Focused.
    const roller = which === 'attack' ? c.attacker : c.defender;
    const funders = this.tokens ? whistleFunders(this.data, this.tokens(), roller) : [];
    if (funders.length) {
      const w = document.createElement('button');
      w.textContent = `Whistle reroll (${funders[0].label})`;
      w.title = `${funders[0].label} is within Range 4 with a face-up Command Token. Consuming it lets ${roller.label} reroll the selected dice; the token turns face-down (4.15.4).`;
      w.addEventListener('click', () => {
        if (!roll.some((d) => d.selected)) return;
        this.onCommand({ kind: 'spendCommand', seat: funders[0].side, uid: funders[0].uid });
        this.note(`${roller.label} rerolls using a Command Token from ${funders[0].label} (Whistle Aura).`);
        void (async () => {
          this.spinFor = which;
          await this.reroll(roll, 'Whistle reroll');
          this.render();
        })();
      });
      rr.appendChild(w);
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
    // The Volcano's card reads "when making ANY Dice Roll for this mech", not
    // just a defence one, so the attacker's own roll gets the same seam that
    // A25 pins for the defence: gathered, not yet rolled. Only a colour that is
    // actually in THIS pool is worth raising here — the box's three Designate
    // cards all name White, which is a defence die, so in practice this stays
    // quiet and the defence step is where it speaks.
    if (!c.attackRoll) {
      for (const d of designationsOn(this.data, c.attacker).filter((x) => x.color === 'red' || x.color === 'yellow')) {
        const p = document.createElement('p');
        p.className = 'ah-protect';
        p.textContent = `${d.name} Designates ${d.count} ${d.color} die: set ${
          d.count === 1 ? 'its face' : 'their faces'
        } now, take ${d.count} off the pool above and roll the rest (FAQ A25).`;
        wrap.appendChild(p);
      }
    }
    if (!c.attackRoll) {
      const roll = document.createElement('button');
      roll.className = 'ah-primary';
      roll.innerHTML = '<i class="btn-ico">🎲</i> Roll attack dice';
      roll.addEventListener('click', () => {
        void (async () => {
          this.spinFor = 'attack';
          c.attackRoll = await this.rollPool({ red: c.attackPool.red, yellow: c.attackPool.yellow }, 'Attack');
          // A fresh roll has fresh dice, so any Chef exchange belonged to the old one.
          c.eyeSwaps = 0;
          this.render();
        })();
      });
      wrap.appendChild(roll);
    } else {
      wrap.appendChild(this.rollView(c.attackRoll, 'attack'));
      const atk = this.attackIcons(c);
      const sum = document.createElement('p');
      sum.className = 'ah-sum';
      const swapNote = c.lightningSwapped
        ? ` · [Lightning] counted as Heavy (${this.lightningSwap(c) === 'pulse' ? 'Pulse Weapon' : 'Ion Weapon'})`
        : '';
      sum.textContent = `Effective: ${atk.heavyHit ?? 0}× Heavy, ${atk.lightHit ?? 0}× Light${atk.lightning ? `, ${atk.lightning}× Lightning` : ''}${atk.eye ? `, ${atk.eye}× Eye` : ''}${c.eyeSwaps ? ` · ${c.eyeSwaps} exchanged by Chef` : ''}${swapNote}`;
      wrap.appendChild(sum);
      // ZPA-35 Chef: on a Melee Action, consume 1 Command Token to exchange one
      // {Eye} for a {Heavy Hit}. Offered per Eye still showing, so a Mech
      // holding several tokens can exchange more than one.
      if (this.chefCanSwap(c, atk)) {
        const swap = document.createElement('button');
        swap.className = 'ah-alt';
        swap.textContent = 'Chef: consume a Command → {Eye} becomes {Heavy Hit}';
        swap.title = 'Consumes 1 face-up Command Token from this Mech (4.15.4). The token turns face-down and cannot be issued or used again.';
        swap.addEventListener('click', () => {
          // spendCommand does the flip and refuses if the Mech has none left,
          // so the token half travels like every other command; the exchange
          // itself is combat-local and lives on this state.
          this.onCommand({ kind: 'spendCommand', seat: c.attacker.side, uid: c.attacker.uid });
          c.eyeSwaps = (c.eyeSwaps ?? 0) + 1;
          this.render();
        });
        wrap.appendChild(swap);
      }
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
      }${
        // 4.1: a Shutdown unit still rolls its Armor, but that is ALL it gets —
        // said out loud because "it can still defend" reads as a bug at the
        // table when the losses are silent.
        c.defender.stance === 'shutdown' ? ' · SHUTDOWN: the Armor still rolls, but hollow icons never count, there are no Dodge dice, and the attacker chose the Part (4.1)' : ''
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
    // FAQ A25 asks exactly when the Volcano's Armor Countermeasures resolves,
    // and the answer is this seam: the dice are gathered (the editor above) but
    // not yet rolled (the button below). Said here rather than in the card text
    // because the timing is the whole ruling. D11 is why it is NOT suppressed in
    // a Surplus round: the effect triggers on being attacked, so it carries.
    const designate = !c.defenseRoll ? designationsOn(this.data, c.defender) : [];
    for (const d of designate) {
      const p = document.createElement('p');
      p.className = 'ah-protect';
      p.innerHTML = `<b>${d.name}</b> Designates ${d.count} White die: set ${
        d.count === 1 ? 'its face' : 'their faces'
      } now, before anything is rolled (FAQ A25). Take ${d.count} off the White above, roll the rest, and count the Designated ${
        d.count === 1 ? 'die' : 'dice'
      } alongside the result.${c.surplusRound ? ' It applies here too — it triggered when the unit was attacked (FAQ D11).' : ''}`;
      wrap.appendChild(p);
    }
    if (!c.defenseRoll) {
      // The defender's own dice, when the defending player is at another
      // screen: the call goes out ONCE (the render runs many times while the
      // answer is in the air), the defender presses their own roll, and both
      // players watch the same faces land. The attacker sees a waiting line
      // where the button would be — the button is not theirs to press.
      if (this.defenseRoller) {
        if (!c.defenseCalled) {
          c.defenseCalled = true;
          const gen = this.duelGen;
          void this.defenseRoller({ white: c.defensePool.white, blue: c.defensePool.blue }, c.attacker, c.defender, c.action.id)
            .then((faces) => {
              // A cancelled or superseded attack must not receive a roll meant
              // for the one before it.
              if (this.ctx !== c || this.duelGen !== gen) return;
              c.defenseRoll = faces;
              this.render();
            });
        }
        const wait = document.createElement('p');
        wait.className = 'ah-note';
        wait.textContent = `Waiting for ${c.defender.label}'s player to roll their defence: ${c.defensePool.white} White${c.defensePool.blue ? ` + ${c.defensePool.blue} Blue` : ''}.`;
        wrap.appendChild(wait);
      } else {
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
      }
    } else {
      wrap.appendChild(this.rollView(c.defenseRoll, 'defense'));
      const def = this.countIcons(c.defenseRoll, c.defender.stance === 'defensive');
      const sum = document.createElement('p');
      sum.className = 'ah-sum';
      sum.textContent = `Effective: ${def.defense ?? 0}× Defense, ${def.dodge ?? 0}× Dodge`;
      wrap.appendChild(sum);
      // KC Armor (4.10): the defender may consume a Charge Token to turn the
      // Defense Roll's Lightning into Defense. Offered here while the roll is
      // on the table; the REMOTE defender's copy of this button lives in
      // their combat mirror.
      const kc = c.defender.kind === 'mech' && !c.kcUsed ? kcArmorReady(this.data, c.defender) : null;
      const defLightning = this.countIcons(c.defenseRoll, false).lightning ?? 0;
      const remoteDefender = !!(this.focusRemote && this.focusRemote(c.defender));
      if (kc && defLightning > 0 && !remoteDefender) {
        const b = document.createElement('button');
        b.className = 'ah-alt';
        b.textContent = `KC Armor: consume a Charge Token — ${defLightning} [Lightning] become [Defense]`;
        b.addEventListener('click', () => {
          this.onCommand({ kind: 'setCharge', seat: c.defender.side, uid: c.defender.uid, slot: kc.slot, on: false });
          this.onCommand({ kind: 'kcArmor', seat: c.defender.side });
          this.kcArmed();
        });
        wrap.appendChild(b);
      }
      // The two ZYBP-302 Command Token spends. The remote defender presses
      // these in their combat mirror; this is the one-screen copy.
      if (!remoteDefender && !c.evadeUsed && c.designatedParry && meleeEvasionReady(this.data, c.defender)) {
        const b = document.createElement('button');
        b.className = 'ah-alt';
        b.textContent = 'Melee Evasion: spend a Command Token for +1 [Dodge] on the Parry';
        b.addEventListener('click', () => {
          this.onCommand({ kind: 'spendCommand', seat: c.defender.side, uid: c.defender.uid });
          this.onCommand({ kind: 'meleeEvade', seat: c.defender.side });
          this.evadeDeclared();
        });
        wrap.appendChild(b);
      }
      if (!remoteDefender && !c.dodgeDieUsed && dodgeEnhanceReady(this.data, c.defender)) {
        const b = document.createElement('button');
        b.className = 'ah-alt';
        b.textContent = 'Dodge Enhancement: spend a Command Token — each [Dodge] cancels a whole Attack die';
        b.addEventListener('click', () => {
          this.onCommand({ kind: 'spendCommand', seat: c.defender.side, uid: c.defender.uid });
          this.onCommand({ kind: 'dodgeEnhance', seat: c.defender.side });
          this.dodgeEnhanceDeclared();
        });
        wrap.appendChild(b);
      }
      // 4.4.1 step 5 sits between the rolls and the resolution: the Focus
      // questions are asked in the printed order, and Resolve appears only
      // once the flow has run dry.
      if (!c.focus) this.beginFocus();
      const focusUi = this.focusBlock();
      if (focusUi) wrap.appendChild(focusUi);
      else {
        const next = document.createElement('button');
        next.className = 'ah-primary';
        next.textContent = 'Resolve ▸';
        next.addEventListener('click', () => {
          c.step = 'resolve';
          this.render();
        });
        wrap.appendChild(next);
      }
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
    summary.innerHTML = text.map((t) => `<p class="ah-sum">${t}</p>`).join('');
    wrap.appendChild(summary);
    linkMechanics(wrap, this.data.mechanics);
    window.setTimeout(() => this.playDuel(duelEl), 0);

    if (penetrating > 0 && c.targetPart) {
      const apply = document.createElement('button');
      apply.className = 'ah-primary';
      apply.textContent = `Apply Penetration to ${SLOT_LABEL[c.targetPart as PartSlot | 'main']}`;
      apply.addEventListener('click', () => {
        // The wait between render and this press is another checkpoint window.
        this.rebind(c);
        this.sendLightningDrain();
        const slot = c.targetPart as PartSlot | 'main';
        const cur = c.defender.partStates[slot] ?? 'intact';
        const wasShut = c.defender.stance === 'shutdown';
        // The state change is the command's; the wizard reads the result back
        // off the token and keeps the narration and follow-up flow.
        this.onCommand({ kind: 'applyPenetration', seat: c.attacker.side, uid: c.attacker.uid, targetUid: c.defender.uid, slot });
        const next = c.defender.partStates[slot] ?? 'intact';
        this.onPenetrated(c.defender, c.attacker);
        c.penetrated = true;
        // Under Multi-Target the debts are held to the end of the Action (B7),
        // so the flag is parked on the target this sequence belongs to.
        if (this.multi) { const at = this.multi.targets[this.multi.index]; if (at) at.penetrated = true; }
        if (next === 'destroyed') { c.killedPart = true; this.onDestroyed(c.attacker, c.defender, 'part'); }
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
          c.eyeSwaps = 0;
          c.defenseRoll = null;
          // A fresh Defense Roll re-opens Focus for the DEFENDER alone: the
          // Surplus round makes no Attack Roll, so the attacker's half of
          // step 5 has nothing to act on and skips itself.
          c.focus = null;
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
      // them (4.4 note on Hit versus Penetration) — and Concussion/Wrecking's
      // Lightning drains Link whether anything got through or not.
      done.addEventListener('click', () => {
        this.sendLightningDrain();
        this.finish(wrap);
      });
      wrap.appendChild(done);
    }
    return wrap;
  }

  private finish(_wrap: HTMLElement): void {
    const c = this.ctx!;
    c.step = 'resolve';
    const rider = { attacker: c.attacker, defender: c.defender, action: c.action, hits: c.hits, penetrated: !!c.penetrated };
    // A card that grants a bonus attack when it destroys a Part — the Katana's
    // Chop offering an immediate Slash. Offered HERE because this is the one
    // place every attack ends, on both pages, so the offer cannot exist on one
    // and not the other. It is optional ("may perform"), and it is only owed
    // while the defender is still standing.
    const killed = c.killedPart;
    const bonus = killed && this.aliveNow(c.defender)
      ? followUpAfterKill(this.data, c.attacker, c.action)
      : null;
    const el = document.createElement('div');
    el.className = 'attack-helper';
    el.innerHTML = `<div class="ah-head"><b>Attack resolved</b></div>
      <div class="ah-log">${c.log.map((l) => `<div>${l}</div>`).join('')}</div>`;
    if (bonus) {
      const note = document.createElement('p');
      note.className = 'ah-note';
      // FAQ B8 is the whole point of naming the defender in the label: the
      // bonus may not wander to a fresher target.
      note.textContent = `${cardName(bonus.card)} destroyed a Part, so it may perform ${bonus.action.name?.en ?? 'its bonus attack'} immediately — against ${c.defender.label} and no one else (FAQ B8).`;
      el.appendChild(note);
      // The rider carries Forced Movement, the Black Box drop flush and the
      // spent-Projectile cleanup, so it must fire EXACTLY once whichever way
      // the offer is answered — and before the bonus attack opens, or the
      // shove from the first attack would land after the second.
      const settle = () => {
        this.ctx = null;
        this.onKnockback(rider.attacker, rider.defender, rider.action, rider.hits);
      };
      const go = document.createElement('button');
      go.className = 'ah-primary';
      go.textContent = `Take the bonus ${bonus.action.name?.en ?? 'attack'}`;
      go.addEventListener('click', () => {
        settle();
        // Same defender, by construction — the bonus target is not a choice.
        this.start(rider.attacker, bonus.action, rider.defender,
          'Bonus attack: it must take the same target as the attack that granted it (FAQ B8).');
      });
      const decline = document.createElement('button');
      decline.className = 'ah-ghost';
      decline.textContent = 'Decline it';
      // Declining inside a Multi-Target ends this sequence, not the Action.
      decline.addEventListener('click', () => {
        settle();
        if (!this.multi) {
          for (const r of this.reactionsFor(rider.action, rider.defender, rider.attacker, rider.penetrated)) this.onReaction(rider.defender, r, rider.attacker);
        }
        if (!this.advanceMulti()) this.cancel();
      });
      el.append(go, decline);
      this.root.replaceChildren(el);
      return;
    }
    // Mid-Multi-Target, "Done" means "on to the next target" rather than
    // "close": the Action is one declaration and is not finished until every
    // sequence has run. The rider still fires per sequence, because each one is
    // a real attack with its own shove and its own Black Box flush.
    const m = this.multi;
    const more = m && m.index + 1 < m.targets.length;
    const done = document.createElement('button');
    done.className = 'ah-primary';
    done.textContent = more ? `Next target: ${m!.targets[m!.index + 1].defender.label} ▸` : 'Done';
    done.addEventListener('click', () => {
      // An ordinary attack owes the reaction straight away — there is nothing
      // else in this Action to hold it back from. B7 is what makes the
      // Multi-Target path defer instead, and advanceMulti owns that.
      if (!this.multi) {
        for (const r of this.reactionsFor(rider.action, rider.defender, rider.attacker, rider.penetrated)) this.onReaction(rider.defender, r, rider.attacker);
      }
      this.ctx = null;
      if (!this.advanceMulti()) this.cancel();
    });
    el.appendChild(done);
    this.root.replaceChildren(el);
    this.ctx = null;
    this.onKnockback(rider.attacker, rider.defender, rider.action, rider.hits);
  }

  // Whether the defender is still on the board and not destroyed.
  private aliveNow(t: Token): boolean {
    const key = t.kind === 'mech' ? 'torso' : 'main';
    return (t.partStates[key] ?? 'intact') !== 'destroyed';
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
  // Target Tracing hands out no token: on success the RESPONDER loses this much
  // Link (174). Carried on the contest rather than read off the card, because
  // the card has no gameRules to read.
  linkLoss?: number;
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
  // The board, for reading what the Initiator's Tarantulas are lending it
  // (FAQ O5). Wired by the driver, the same way the AttackHelper's is.
  tokens: (() => Token[]) | null = null;

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

  start(initiator: Token, action: CardAction, responder: Token, opts: { linkLoss?: number } = {}): void {
    // Only the Initiator is performing an Action, so only the Initiator counts
    // the Backpacks its Tarantulas are lending (FAQ O5).
    const world = this.tokens ? this.tokens() : [];
    // "Enemy units within range suffer Strength -1 when making Electronic
    // Counter Rolls" (EW Suppression, Electronic Warfare Weakening). It lands
    // on whoever is inside the aura, which can be either side of this contest,
    // and never below zero. The value is negative in the data, so it adds.
    const ewPenalty = (u: Token): number => auraValueOn(this.data, world, u, 'electronic_contest_strength_penalty');
    const initEv = Math.max(0, electronicValue(this.data, initiator, loanedParts(this.data, world, initiator)) + ewPenalty(initiator));
    const respEv = Math.max(0, electronicValue(this.data, responder) + ewPenalty(responder));
    this.ctx = {
      initiator,
      responder,
      action,
      linkLoss: opts.linkLoss,
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
    if (c.linkLoss) {
      this.onCommand({ kind: 'drainLink', seat: c.initiator.side, uid: c.initiator.uid, targetUid: c.responder.uid, n: c.linkLoss });
      done.push(`${c.responder.label} loses ${c.linkLoss} Link (now ${c.responder.link})`);
    }
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

  // An allied Repeater lends its position to an Electronic Attack, and the
  // Action's Range is measured from there instead (FAQ O19).
  private relayNote(c: EwCtx): string {
    const world = this.tokens ? this.tokens() : [];
    if (!world.length) return '';
    const relay = repeatersFor(this.data, world, c.initiator);
    if (!relay.length) return '';
    const reach = c.action.range ?? 0;
    const best = relay.find((r) => rangeBetween(r, c.responder).range <= reach);
    return best
      ? ` ${best.label} is a Repeater covering ${c.initiator.label}, so this shot may be measured from it - ${c.responder.label} is Range ${rangeBetween(best, c.responder).range} from there (FAQ O19).`
      : ` ${relay.map((r) => r.label).join(', ')} covers ${c.initiator.label} as a Repeater, but this target is beyond Range ${reach} of it too.`;
  }

  private render(): void {
    const c = this.ctx;
    if (!c) return;
    // Same rebind as the AttackHelper's: a Counter-roll waits on the other
    // player's dice, and a checkpoint in that window replaces every token.
    const board = this.tokens ? this.tokens() : [];
    c.initiator = board.find((x) => x.uid === c.initiator.uid) ?? c.initiator;
    c.responder = board.find((x) => x.uid === c.responder.uid) ?? c.responder;
    const el = document.createElement('div');
    el.className = 'attack-helper';
    const what = c.action.name.en || c.action.name.zh || c.action.id;
    el.innerHTML = `<div class="ah-head">
      <b>${c.initiator.label}</b> ⚡ <b>${c.responder.label}</b>
      <span class="dim">${what}</span>
      <button class="ah-cancel" title="Cancel">✕</button>
    </div>
    <p class="ah-los" data-mech="electronic_counter_roll">Electronic Warfare ignores terrain and line of sight. Range only.${this.relayNote(c)}</p>`;

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

// THE COMPUTER'S COMBAT WINDOW. An attack a computer seat makes, and one made
// on it, both run through the same AttackHelper a player's do (combat.ts), on
// an element nobody is shown. So every rule of 4.4 the window knows applies to
// a computer with no second copy of any of them.
//
// The window's buttons name what they do (`data-act`), so its questions are
// read off the controls it has live: "Focus or pass", "apply the Penetration",
// "roll the defence", "take the hit on the Shield". Those become a Decision, a
// policy picks, and the answer is a press on the same button a player would
// press.
//
// ATTACKING, the window is live and wired as match.ts wires a player's: what
// belongs to the other seat (their defence roll, their Focus, where a hit
// lands) is asked through shared state and waited for. DEFENDING, the window
// is a mirror of the attack the other seat published, as the defending
// player's screen is, and each press travels as the command that page sends
// (defender.ts).
import { AttackHelper, combatRoleFor, type AttackReading } from '../combat';
import type { Command } from '../commands';
import { defenderAct } from '../defender';
import type { Decision, Forecast, Option } from '../seat';
import { boxHands } from '../tasks';
import { attackActionOf, attackOpening, boxDropSpots, boxesKnocked, interceptAgain, multiTargetHeld, terrainOf, type AttackMode, type InterceptAttempt } from '../turn';
import type { CardAction, CombatView, DiceData, DieColor, Side, Token } from '../types';
import { knockbackOf, type MultiTarget } from '../units';
import { largeGridOf } from '../rules';
import type { Host } from './driver';
import { InHand, type Odds } from './odds';

type Faces = { color: DieColor; face: number; selected: boolean }[];
type Press = [act: string, arg?: string];

export interface AttackArgs {
  uid: number;
  actionId: string;
  targetUid: number;
  mode?: AttackMode;
  twoHandedDeclined?: boolean;
  charged?: boolean;
  chargeChoice?: string;
}

// The buttons a seat does not press on its own: toggles and take-backs that
// change no outcome by themselves (a die's selection, the pool editor's
// steppers, Back to Focus), the table-dice path of a host with no dice, and
// the riders that take more than one press and are not offered yet.
const NOT_OFFERED = new Set(['die', 'focus.back', 'exchange.eye', 'resolve.dodgehold', 'part.confirm',
  'table.lightning', 'table.outcome', 'table.redo', 'split.add', 'split.scan', 'split.drop', 'split.less', 'split.more', 'finish.drag', 'finish.face']);

// The most answers a Multi-Target's split is offered as. A big pool shared
// between a few targets has many splits; the sets of many targets with a die
// or two apiece are the first left out.
const SPLIT_ANSWERS = 240;

// Every way to share `n` dice of one colour between `k` targets, in order,
// the first target's share largest first.
function sharesOf(n: number, k: number): number[][] {
  if (k <= 1) return [[n]];
  const out: number[][] = [];
  for (let first = n; first >= 0; first--) for (const rest of sharesOf(n - first, k - 1)) out.push([first, ...rest]);
  return out;
}

// What kind of thing a press is, for a policy that reasons about kinds.
const TAGS: Record<string, string[]> = {
  'focus.use': ['focus', 'spend-link'],
  'focus.pass': ['decline'],
  'focus.lent': ['focus', 'free'],
  'focus.whistle': ['focus', 'spend-command'],
  'part.focus': ['focus', 'spend-link'],
  'part.keep': ['decline'],
  'part.pick': ['designate'],
  'reroll.keep': ['decline'],
  'resolve.chef': ['spend-command'],
  'finish.bonus': ['attack'],
  'finish.decline': ['decline'],
  'finish.done': ['end'],
  // What a hit does to the unit it struck, the attacker's to take.
  'finish.shutdown': ['rider', 'shutdown'],
  'finish.disarm': ['rider', 'disarm'],
  'finish.immobilize': ['rider', 'immobilize'],
  'finish.faceaway': ['rider', 'turn'],
  'declare.none': ['decline'],
  'declare.designate': ['designate'],
  'declare.kc': ['spend-charge'],
  'designate.keep': ['decline'],
  'designate.to': ['designate'],
  'defense.evade': ['spend-command'],
  'defense.dodge': ['spend-command'],
};

// The question the live controls are asking, first match wins, and the press
// that is always safe for it. Named for the attacker; a window that is
// defending reads the same list as `defence.*`.
const QUESTIONS: { kind: string; has: string[]; safe: string[] }[] = [
  { kind: 'attack.split', has: ['split.begin'], safe: ['split.begin'] },
  { kind: 'attack.partfocus', has: ['part.keep', 'part.focus'], safe: ['part.keep'] },
  { kind: 'defence.declare', has: ['declare.none', 'declare.designate', 'declare.kc'], safe: ['declare.none'] },
  { kind: 'defence.designate', has: ['designate.keep', 'designate.to'], safe: ['designate.keep'] },
  { kind: 'attack.part', has: ['part.roll', 'part.pick'], safe: ['part.roll'] },
  { kind: 'attack.roll', has: ['attack.roll'], safe: ['attack.roll'] },
  { kind: 'attack.next', has: ['attack.next'], safe: ['attack.next'] },
  { kind: 'defence.roll', has: ['defense.roll', 'defense.evade', 'defense.dodge'], safe: ['defense.roll'] },
  { kind: 'attack.focus', has: ['focus.use', 'focus.pass', 'focus.lent', 'focus.whistle'], safe: ['focus.pass'] },
  { kind: 'attack.reroll', has: ['reroll.go', 'reroll.keep'], safe: ['reroll.keep'] },
  { kind: 'attack.resolve', has: ['defense.resolve'], safe: ['defense.resolve'] },
  { kind: 'attack.apply', has: ['resolve.apply', 'resolve.done', 'resolve.chef'], safe: ['resolve.apply', 'resolve.done'] },
  { kind: 'attack.surplus', has: ['surplus.effect', 'surplus.part', 'surplus.unit'], safe: ['surplus.effect', 'surplus.part', 'surplus.unit'] },
  { kind: 'attack.finish', has: ['finish.bonus', 'finish.decline', 'finish.done', 'finish.shutdown', 'finish.disarm', 'finish.immobilize', 'finish.faceaway'], safe: ['finish.decline', 'finish.done'] },
];

const FACINGS = ['North', 'East', 'South', 'West'];

// The next task. A page has only the timer; a test run in node has a faster
// one, which matters over thousands of games.
const immediate = (globalThis as { setImmediate?: (fn: () => void) => unknown }).setImmediate;
const later = (fn: () => void): void => { if (immediate) immediate(fn); else setTimeout(fn, 0); };

interface Btn {
  act: string;
  arg?: string;
  label: string;
  cls: string;
  el: HTMLElement;
}

export class BotCombat {
  private readonly root: HTMLElement;
  private readonly helper: AttackHelper;
  // An attack of this seat's own is up: running, or its last screen waiting
  // for its Done.
  private open = false;
  // The window is a picture of the OTHER seat's attack, and what it was last
  // drawn from.
  private watching: string | null = null;
  // The picture this seat last answered. Nothing more is offered off it: the
  // attacking window has the answer and will publish what comes next.
  private answered: string | null = null;
  // The defender's dice, asked for and not yet back.
  private waiting: ((faces: Faces) => void) | null = null;
  private published = '';
  private rolling = 0;
  // A roll has been asked for since the window last came to rest.
  private stirred = false;
  // How many windows this seat has had up and how many presses it has made,
  // so each question it is put has a name of its own.
  private windowNo = 0;
  private presses = 0;
  private subject: { attackerUid: number; targetUid: number; actionId: string } | null = null;
  // What the options of the last Decision press, by option id.
  private offered = new Map<string, Press[]>();
  // The effects of a hit this window pressed and the table refused: not
  // offered again, so a refusal cannot hold the window open.
  private tried = new Set<string>();
  // How many commands this window has sent.
  private sends = 0;
  // Set while a Detonation that catches several units is being resolved: the
  // Projectile stays until every one has taken its own attack (4.7.6, M21).
  holdProjectile = false;
  // What a Knockback still owes, for the driver to resolve.
  shoveOwed: { attackerUid: number; targetUid: number; actionId: string } | null = null;
  // The Interception attempt this window is rolling out, kept so that what it
  // leaves owed can be judged when it ends (4.9; matchhud.ts interceptNow).
  private intercepting: InterceptAttempt | null = null;
  // The bearers this window's attack has Penetrated. Each drops its Black
  // Boxes where the ATTACKER says, once the attack is over (5.3.1; match.ts
  // queues the same question for a player).
  private boxDrops: { bearerUid: number; byUid: number }[] = [];
  // The attack this window opened, and a Multi-Target's limit where it holds
  // for it (turn.ts multiTargetHeld): its split is offered up to that.
  private args: AttackArgs | null = null;
  private cap: MultiTarget | null = null;
  // What this window last showed the other player, which names the target of
  // the sequence in hand and a split's settled total.
  private shown: CombatView | null = null;

  // `odds` is the seat's calculator, for an attack this window only has a
  // picture of: the one made ON the seat.
  constructor(private readonly seat: Side, private readonly host: Host, private readonly odds?: () => Odds) {
    const { data } = host;
    this.root = document.createElement('div');
    // Counted, so a press that sent nothing is known to have sent nothing.
    const send = (cmd: Command) => { this.sends += 1; return host.send(cmd); };
    this.helper = new AttackHelper(
      data,
      data.dice as unknown as DiceData,
      this.root,
      () => {},
      () => this.closed(),
      () => {},
      (attacker, defender, action, hits) => this.afterAttack(attacker, defender, action, hits),
      (killer, victim, what) => { send({ kind: 'recordKill', seat: killer.side, uid: killer.uid, targetUid: victim.uid, what }); },
      (victim, attacker) => { this.boxDrops.push({ bearerUid: victim.uid, byUid: attacker.uid }); },
      send,
    );
    const h = this.helper;
    // Nobody watches this window, so nothing in it waits to be read.
    h.instant = true;
    h.role = 'attacker';
    h.tokens = () => host.state().tokens;
    h.boxHands = (uid) => boxHands(host.state().tasks, uid);
    h.opportunity = () => host.state().script?.opp ?? null;
    h.actingUid = () => host.state().script?.opp?.uid ?? null;
    h.terrain = () => terrainOf(data, host.state());
    h.smoke = () => host.state().smoke ?? [];
    // The table's dice, never its own.
    h.roller = (pool, label) => this.rolled(pool, label ?? 'roll');
    h.blackRoller = async () => (await this.rolled({ black: 1 }, 'Part Die'))[0]?.face ?? 0;
    // The defender's dice belong to the defending player: asked for through
    // shared state, answered by their own roll (match.ts defenseRoller). A
    // unit of this seat's own defending (an Explosion catching an ally) rolls
    // here, since the button would be this seat's either way.
    h.defenseRoller = (pool, attacker, defender, actionId) => new Promise((resolve) => {
      if (defender.side === this.seat) {
        void this.defencePool(pool.white, pool.blue)
          .then((faces) => resolve(faces.map((f) => ({ color: f.color as DieColor, face: f.face, selected: false }))));
        return;
      }
      this.waiting = resolve;
      send({ kind: 'callDefense', seat: attacker.side, uid: attacker.uid, targetUid: defender.uid, actionId, white: pool.white, blue: pool.blue });
    });
    h.focusRemote = (defender) => defender.side !== this.seat;
    // The defender's own reaction to being shot at: a debt in shared state,
    // theirs to answer (match.ts onReaction).
    h.onReaction = (defender, reaction, attacker) => {
      send({
        kind: 'queueReactions', seat: this.seat,
        items: [reaction.smoke
          ? { uid: defender.uid, actionId: reaction.actionId, count: reaction.smoke.count, range: reaction.smoke.range, kind: 'smoke' as const }
          : reaction.stance
            ? { uid: defender.uid, actionId: reaction.actionId, count: 0, range: 0, kind: 'stance' as const }
            : reaction.riposte
              ? { uid: defender.uid, actionId: reaction.actionId, count: 0, range: 0, kind: 'riposte' as const, fromUid: attacker.uid }
              : { uid: defender.uid, actionId: reaction.actionId, count: 0, range: 0, kind: 'trace' as const, fromUid: attacker.uid }],
      });
    };
    // What the other player's screen draws the attack from. On change only.
    h.publishView = (view) => {
      // A Multi-Target is one window and a sequence for each target, and an
      // Automatic Shield moves a shot onto itself: what this window is asked
      // is about the unit the dice land on now.
      this.shown = (view as CombatView | null) ?? null;
      if (this.open && this.subject && this.shown) this.subject.targetUid = this.shown.targetUid;
      const key = JSON.stringify(view);
      if (key === this.published) return;
      if (send({ kind: 'setCombatView', seat: this.seat, view: view as CombatView | null }).ok) this.published = key;
    };
    // A press on the picture of somebody else's attack: sent, never applied.
    h.mirrorAct = (act, arg) => defenderAct({
      data, state: host.state(), seat: this.seat, send, roll: (white, blue) => this.defencePool(white, blue),
    }, act, arg);
  }

  // Whether this seat is in the middle of an attack of its own.
  get busy(): boolean {
    return this.open;
  }

  private async rolled(pool: Record<string, number>, label: string): Promise<{ color: string; face: number }[]> {
    this.rolling += 1;
    this.stirred = true;
    try {
      return await this.host.roll(pool, label);
    } finally {
      this.rolling -= 1;
    }
  }

  // An EMPTY pool is answered here rather than rolled: Armor Piercing against
  // a Part printing Armor 1 leaves nothing to roll (match.ts rollDefensePool).
  private defencePool(white: number, blue: number): Promise<{ color: string; face: number }[]> {
    if (white <= 0 && blue <= 0) return Promise.resolve([]);
    return this.rolled({ ...(white > 0 ? { white } : {}), ...(blue > 0 ? { blue } : {}) }, 'Defence');
  }

  // Lets what a press set going come to rest: a roll in the air, and the
  // redraw that follows it. A roll's result is read by the window in the turns
  // AFTER the roll resolves, so once one has been asked for, the wait runs to
  // the next task, by which time every one of those turns has been taken.
  // With no roll asked for there is nothing to wait on.
  async settle(): Promise<void> {
    await Promise.resolve();
    if (!this.rolling && !this.stirred) return;
    for (let i = 0; i < 2000; i++) {
      await new Promise<void>((r) => { later(r); });
      if (!this.rolling) break;
    }
    this.stirred = false;
  }

  // Opens the window on a target, as match.ts startAttack does. False when a
  // unit or the Action is gone.
  start(a: AttackArgs): boolean {
    const open = attackOpening(this.host.data, this.host.state(), a.uid, a.actionId, a.targetUid, a.mode ?? 'attack', a);
    if (!open) return false;
    this.open = true;
    this.watching = null;
    this.windowNo += 1;
    this.presses = 0;
    this.tried.clear();
    this.subject = { attackerUid: a.uid, targetUid: open.defender.uid, actionId: a.actionId };
    this.shoveOwed = null;
    this.intercepting = a.mode === 'intercept' ? { uid: a.uid, actionId: a.actionId, targetUid: a.targetUid } : null;
    this.helper.role = 'attacker';
    this.shown = null;
    this.args = a;
    this.cap = open.multi ? multiTargetHeld(this.host.data, this.host.state(), a) : null;
    if (open.multi) this.helper.startMulti(open.attacker, open.action, open.defender, open.multi);
    else this.helper.start(open.attacker, open.action, open.defender, open.note, open.protection.white, open.protection.note, a.mode === 'explosion', a.mode === 'intercept');
    return true;
  }

  // Every command that lands at the table, this seat's and the other's: the
  // defender's answers are consumed here, as match.ts settleDefense does.
  observe(cmd: Command): void {
    if (cmd.kind === 'answerDefense' && this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(cmd.faces.map((f) => ({ color: f.color as DieColor, face: f.face, selected: false })));
      // The record served its purpose the moment the faces landed, and it is
      // the attacker's to clear.
      this.host.send({ kind: 'clearDefense', seat: this.seat });
    }
    if (cmd.kind === 'clearDefense' && this.waiting && cmd.seat !== this.seat) this.waiting = null;
    // `active` is false for a mirror by construction, which is the right gate
    // for all six: a mirror's state comes from the published view alone.
    if (!this.helper.active) return;
    if (cmd.kind === 'focusAnswer') this.helper.focusAnswered(cmd.use);
    if (cmd.kind === 'focusReroll') this.helper.focusRerolled(cmd.indices, cmd.faces);
    if (cmd.kind === 'kcArmor') this.helper.kcArmed();
    if (cmd.kind === 'designateHit') this.helper.designateAnswered(cmd.slot);
    if (cmd.kind === 'meleeEvade') this.helper.evadeDeclared();
    if (cmd.kind === 'dodgeEnhance') this.helper.dodgeEnhanceDeclared();
  }

  // The window closed: the attack is over, and its picture comes down.
  private closed(): void {
    if (this.watching !== null) return;
    this.open = false;
    this.waiting = null;
    this.offered.clear();
    if (this.published && this.published !== 'null') {
      if (this.host.send({ kind: 'setCombatView', seat: this.seat, view: null }).ok) this.published = 'null';
    }
    // An Interception attempt is resolved: a target that survived is owed the
    // same attempt again while that Part has Tokens (turn.ts interceptAgain,
    // the reading the panel's "This attempt is resolved" makes).
    const attempt = this.intercepting;
    this.intercepting = null;
    if (attempt) {
      const next = interceptAgain(this.host.data, this.host.state(), attempt);
      if (next.command) this.host.send(next.command);
    }
    // With a Forced Movement owed, a Penetrated bearer's Box waits for it and
    // lands where the bearer ends up (FAQ E19; the page's flushBoxDrops).
    if (!this.shoveOwed) this.dropBoxes();
  }

  // The Forced Movement this window's attack owed has been made, or let be.
  flushDrops(): void {
    this.dropBoxes();
  }

  // WHERE A PENETRATED BEARER'S BOX LANDS is the attacker's to say (5.3.1): a
  // Small Grid in Contact with the bearer's base (turn.ts boxDropSpots). Of
  // those, the one nearest the attacker: the squad that knocked it loose is
  // then the nearer to it. A habit of this seat's and not a question put to a
  // policy; the engine holds the cell to the rule either way.
  private dropBoxes(): void {
    for (const { bearerUid, byUid } of this.boxDrops.splice(0)) {
      const state = this.host.state();
      const by = state.tokens.find((t) => t.uid === byUid);
      for (const box of boxesKnocked(state, bearerUid)) {
        const spots = boxDropSpots(this.host.data, state, box.id);
        if (!spots.length) continue;
        const far = (x: { col: number; row: number }): number => (by ? Math.abs(x.col - by.col - (by.size - 1) / 2) + Math.abs(x.row - by.row - (by.size - 1) / 2) : 0);
        const to = spots.reduce((a, b) => (far(b) < far(a) ? b : a));
        this.host.send({ kind: 'dropBlackBox', seat: this.seat, uid: byUid, itemId: box.id, to });
      }
    }
  }

  // After EVERY completed attack (match.ts onKnockback): a Projectile is spent
  // by its blast, and a Knockback that landed is owed its Forced Movement.
  private afterAttack(attacker: Token, defender: Token, action: CardAction, hits: number): void {
    const english = this.host.data.actionTranslation(action.id)?.english ?? undefined;
    const kb = knockbackOf(action, english);
    // Only this seat's own attack: a picture of the other's makes no move.
    const shoving = !!kb && !(kb.onHit && hits === 0) && attacker.kind !== 'projectile' && attacker.side === this.seat;
    const spent = attacker.kind === 'projectile' || action.type === 'Detonation';
    if (spent) {
      if (!this.holdProjectile) this.host.send({ kind: 'despawn', seat: attacker.side, uid: attacker.uid, targetUid: attacker.uid });
    } else if (shoving) {
      this.shoveOwed = { attackerUid: attacker.uid, targetUid: defender.uid, actionId: action.id };
    }
  }

  // Points the window at the attack the OTHER seat has published, as a
  // defending player's page does on every redraw (match.ts syncCombatMirror).
  private sync(): void {
    if (this.open) return;
    const state = this.host.state();
    const view = state.script?.combatView;
    const at = view ? state.tokens.find((t) => t.uid === view.attackerUid) : undefined;
    const df = view ? state.tokens.find((t) => t.uid === view.targetUid) : undefined;
    const action = view && at && at.side !== this.seat
      ? attackActionOf(this.host.data, state, at, view.actionId, !!view.twoHandedDeclined, { spent: view.chargeSpent, choice: view.chargeChoice })
      : undefined;
    if (!view || !at || !df || !action) {
      if (this.watching !== null) {
        // The picture comes down before the flag does, so the window's own
        // close hook still reads it as a picture and not as this seat's attack.
        this.helper.closeMirror();
        this.watching = null;
        this.answered = null;
        this.offered.clear();
      }
      return;
    }
    const key = JSON.stringify(view);
    if (key === this.watching) return;
    if (this.watching === null) { this.windowNo += 1; this.presses = 0; }
    this.watching = key;
    this.subject = { attackerUid: at.uid, targetUid: df.uid, actionId: view.actionId };
    this.helper.showMirror(view, at, df, action, combatRoleFor(this.seat, { attacker: at, defender: df }));
  }

  // ---------- the odds of the attack in the window ----------

  // The window's reading of the attack it shows (combat.ts AttackReading). Its
  // own attack is asked of the window itself, in mid-attack. An attack made on
  // this seat is a picture here, which holds no arithmetic, so the same attack
  // is opened in the seat's calculator and told where the picture has got to.
  reading(): AttackReading | null {
    if (this.open) return this.helper.reading();
    if (this.watching === null || !this.odds) return null;
    const state = this.host.state();
    const view = state.script?.combatView;
    if (!view) return null;
    const r = this.odds().read(state, {
      uid: view.attackerUid, actionId: view.actionId, targetUid: view.targetUid, mode: view.mode,
      twoHandedDeclined: !!view.twoHandedDeclined, charged: !!view.chargeSpent, chargeChoice: view.chargeChoice,
    });
    if (!r) return null;
    // A sequence of a Multi-Target is made with this target's share of the
    // pool (FAQ B7), which the view carries.
    if (view.multi && view.attackPool) r.attack = { red: view.attackPool.red, yellow: view.attackPool.yellow };
    r.hand = {
      step: view.step,
      part: view.targetPart,
      round: view.surplus?.round ?? 0,
      carried: { heavy: view.surplus?.heavy ?? 0, light: view.surplus?.light ?? 0 },
      original: null,
      declared: null,
      parry: 0,
      die: null,
      pool: { attack: view.attackPool ?? r.attack, defense: view.defensePool ?? { white: 0, blue: 0 } },
      attack: view.attack,
      defense: view.defense,
      focus: view.focus?.stage ?? null,
      evade: !!view.evadeUsed,
    };
    return r;
  }

  // Every answer with dice still to come is given what it comes to FROM HERE
  // (odds.ts InHand): the Part Die kept or thrown again, a Part designated, a
  // Parry declared, the dice left or some rerolled, a Surplus keyword. Worked
  // out when a policy asks, off one reading for the whole question.
  private withChances(options: Option[], mirror: boolean, thrown: Map<string, { side: 'attack' | 'defence'; indices: number[] }>, known: AttackReading | null | undefined): void {
    let hand: InHand | null | undefined;
    const inHand = (): InHand | null => {
      if (hand === undefined) {
        const r = known === undefined ? this.reading() : known;
        hand = r ? new InHand(r) : null;
      }
      return hand;
    };
    // Whose dice a Focus declared now would reroll: the defender's on a
    // picture of the attack, and in a window of its own once the Focus has
    // come round to the defender.
    const side = (h: InHand): 'attack' | 'defence' => (mirror || /D$/.test(h.reading.hand.focus ?? '') ? 'defence' : 'attack');
    // The Attack dice on the table that show an {Eye}, by their place in the roll.
    const printed = (this.host.data.dice as unknown as DiceData).dice;
    const eyes = (h: InHand): number[] => (h.reading.hand.attack ?? [])
      .flatMap((d, i) => ((printed[d.color as DieColor]?.faces[d.face] ?? []).some((ic) => ic.type === 'eye') ? [i] : []));
    const asks: Record<string, (h: InHand, arg: string | undefined, id: string) => Forecast | null> = {
      'declare.none': (h) => h.declare(null),
      'declare.designate': (h, arg) => (arg ? h.declare(arg) : null),
      'part.roll': (h) => h.partRoll(),
      'part.focus': (h) => h.partRoll(),
      'part.keep': (h) => h.dieKept(),
      'part.pick': (h, arg) => (arg ? h.partPick(arg) : null),
      'focus.pass': (h) => h.stands(),
      'focus.use': (h) => h.bestReroll(side(h))?.forecast ?? null,
      // A reroll somebody else pays for. The lent one throws again the Attack
      // dice showing an {Eye} and no others; a Whistle buys what a Focus does.
      'focus.lent': (h) => h.reroll('attack', eyes(h)),
      'focus.whistle': (h) => h.bestReroll(side(h))?.forecast ?? null,
      'reroll.keep': (h) => h.stands(),
      'reroll.idle': (h, _arg, id) => { const t = thrown.get(id); return t ? h.reroll(t.side, t.indices) : null; },
      'reroll.all': (h, _arg, id) => { const t = thrown.get(id); return t ? h.reroll(t.side, t.indices) : null; },
      'reroll.pick': (h, _arg, id) => { const t = thrown.get(id); return t ? h.reroll(t.side, t.indices) : null; },
      'surplus.effect': (h, arg) => (arg ? h.keyword(arg) : null),
    };
    for (const o of options) {
      const cut = o.id.indexOf(':');
      const act = cut < 0 ? o.id : o.id.slice(0, cut);
      const ask = asks[act];
      if (!ask) continue;
      const arg = cut < 0 ? undefined : o.id.slice(cut + 1);
      let answer: Forecast | null | undefined;
      o.chance = () => {
        if (answer === undefined) { const h = inHand(); answer = h ? ask(h, arg, o.id) : null; }
        return answer;
      };
    }
  }

  // ---------- reading the window ----------

  private buttons(): Btn[] {
    const out: Btn[] = [];
    const walk = (el: HTMLElement): void => {
      if (el.hidden) return;
      if (el.tagName === 'BUTTON') {
        const act = el.dataset?.act;
        if (act && !(el as HTMLButtonElement).disabled) {
          out.push({ act, arg: el.dataset.arg, label: (el.textContent || el.innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), cls: String(el.className ?? ''), el });
        }
        return;
      }
      for (const c of Array.from(el.children ?? []) as HTMLElement[]) walk(c);
    };
    walk(this.root);
    return out;
  }

  // What the window is asking THIS seat now, or null: no attack concerns it,
  // or it waits on the other seat or on a roll in the air.
  decision(): Decision | null {
    this.sync();
    if (this.rolling || (!this.open && this.watching === null)) return null;
    const mirror = !this.open;
    // An answer already sent off this picture: the attacking window has it.
    if (mirror && this.answered === this.watching) return null;
    const all = this.buttons();
    const call = this.host.state().script?.combat;
    const live = all.filter((b) => !NOT_OFFERED.has(b.act))
      // A defence roll is owed only while the call stands unanswered.
      .filter((b) => !(mirror && b.act === 'defense.roll' && (!call || !!call.faces)));
    const q = QUESTIONS.find((x) => live.some((b) => x.has.includes(b.act)));
    if (!q) return null;
    const options: Option[] = [];
    this.offered.clear();
    const add = (id: string, label: string, tags: string[], presses: Press[]): Option => {
      this.offered.set(id, presses);
      const o: Option = { id, label, tags, run: { routine: 'combat', args: { id } } };
      options.push(o);
      return o;
    };
    // The dice each reroll answer throws again, by their place in the roll,
    // and the reading they were grouped by, when one was taken.
    const thrown = new Map<string, { side: 'attack' | 'defence'; indices: number[] }>();
    let read: AttackReading | null | undefined;
    for (const b of live) {
      if (!q.has.includes(b.act)) continue;
      if (b.act === 'split.begin' && !mirror) {
        if (!this.offered.has('split.begin')) this.splits(all, b, add);
        continue;
      }
      // A designated Part is chosen and then confirmed: one option, two presses.
      if (b.act === 'part.pick') {
        add(`part.pick:${b.arg}`, `Designate ${b.label}`, TAGS['part.pick'], [['part.pick', b.arg], ['part.confirm']]);
        continue;
      }
      // The reroll throws whatever dice are selected, so the selections worth
      // offering are named: the dice doing nothing, or all of them.
      if (b.act === 'reroll.go') {
        // The window may draw a hand in more than one place, each die a
        // control of its own on the same die: one press per die, or a second
        // would take the first back.
        const seen = new Set<string>();
        const dice = all.filter((d) => d.act === 'die' && !!d.arg?.startsWith(`${b.arg}:`) && !seen.has(d.arg) && !!seen.add(d.arg));
        const idle = dice.filter((d) => !/\blive\b/.test(d.cls));
        const pick = (want: Btn[]): Press[] => [
          ...dice.filter((d) => /\bsel\b/.test(d.cls) !== want.includes(d)).map((d): Press => ['die', d.arg]),
          ['reroll.go', b.arg],
        ];
        const whose = b.arg === 'attack' ? 'attack' as const : 'defence' as const;
        const place = (d: Btn): number => Number(d.arg?.split(':')[1]);
        const offer = (id: string, label: string, tags: string[], want: Btn[]): void => {
          // The reroll's own button may be drawn in more than one place too.
          if (this.offered.has(id)) return;
          add(id, label, tags, pick(want));
          thrown.set(id, { side: whose, indices: want.map(place).sort((x, y) => x - y) });
        };
        if (idle.length && idle.length < dice.length) offer('reroll.idle', `Reroll the ${idle.length} ${idle.length === 1 ? 'die' : 'dice'} doing nothing`, ['reroll'], idle);
        if (dice.length) offer('reroll.all', 'Reroll every die', ['reroll', 'all'], dice);
        // Every other selection that differs from those: two dice of a colour
        // showing the same face are one choice, not two.
        read = this.reading();
        const faces = whose === 'attack' ? read?.hand.attack : read?.hand.defense;
        if (faces && faces.length === dice.length) {
          const groups = new Map<string, Btn[]>();
          for (const d of dice) {
            const f = faces[place(d)];
            if (!f) continue;
            const k = `${f.color}:${f.face}`;
            groups.set(k, [...(groups.get(k) ?? []), d]);
          }
          let sets: Btn[][] = [[]];
          for (const members of groups.values()) {
            const next: Btn[][] = [];
            for (const base of sets) for (let n = 0; n <= members.length; n++) next.push([...base, ...members.slice(0, n)]);
            sets = next;
            if (sets.length > 64) break;
          }
          const key = (want: Btn[]): string => want.map(place).sort((x, y) => x - y).join(',');
          const taken = new Set(['', key(idle), key(dice)]);
          if (sets.length <= 64) {
            for (const want of sets) {
              const k = key(want);
              if (taken.has(k)) continue;
              taken.add(k);
              offer(`reroll.pick:${k}`, `Reroll ${want.length} ${want.length === 1 ? 'die' : 'dice'} (${want.map((d) => place(d) + 1).sort((x, y) => x - y).join(', ')})`, ['reroll'], want);
            }
          }
        }
        continue;
      }
      const id = b.arg !== undefined ? `${b.act}:${b.arg}` : b.act;
      if (this.offered.has(id) || this.tried.has(id)) continue;
      add(id, b.label, [...(TAGS[b.act] ?? []), ...(b.el.dataset?.must ? ['must'] : [])], [[b.act, b.arg]]);
    }
    if (!mirror && q.kind === 'attack.finish') this.drags(all, add);
    // What a hit CAUSES (050's Drag or Disarm, ZHRA-303_A's Drag) is not let
    // go by: the window is not closed while one is still to be taken.
    if (options.some((o) => o.tags.includes('must'))) {
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i].tags.includes('end')) continue;
        this.offered.delete(options[i].id);
        options.splice(i, 1);
      }
    }
    if (!options.length) return null;
    this.withChances(options, mirror, thrown, read);
    const safe = q.safe.map((act) => options.find((o) => o.id === act || o.id.startsWith(`${act}:`))).find((o) => !!o);
    const kind = mirror ? q.kind.replace(/^attack\./, 'defence.') : q.kind;
    return {
      id: `combat|${this.windowNo}|${this.presses}|${kind}`,
      kind,
      seat: this.seat,
      ...(this.subject ? { unit: mirror ? this.subject.targetUid : this.subject.attackerUid } : {}),
      options,
      fallback: (safe ?? options[0]).id,
      facts: { ...(this.subject ?? {}), role: mirror ? 'defender' : 'attacker' },
    };
  }

  // THE SPLIT OF A MULTI-TARGET (FAQ B7). Begin fires the whole pool at the
  // target clicked. Every other answer adds targets the window offers (in
  // Range, arc and sight, as the window judges them) up to the card's limit
  // where it holds for this attack, and shares the window's settled total out
  // so that each target has a die at least: one with none is attacked all the
  // same, and owed its reactions, for nothing. The total itself is never
  // changed. Each answer says what each share is likely to do (`shares`),
  // read once for each target and once for each share.
  private splits(all: Btn[], begin: Btn, add: (id: string, label: string, tags: string[], presses: Press[]) => Option): void {
    const a = this.args;
    const total = this.shown?.multi?.total;
    const primary = a?.targetUid;
    const whole = add('split.begin', begin.label, [], [['split.begin']]);
    if (!a || !total || primary === undefined) return;
    type Pool = { red: number; yellow: number };
    const readings = new Map<number, AttackReading | null>();
    const known = new Map<string, Forecast | null>();
    const readOn = (uid: number): AttackReading | null => {
      if (!readings.has(uid)) {
        readings.set(uid, this.odds ? this.odds().read(this.host.state(), {
          uid: a.uid, actionId: a.actionId, targetUid: uid, mode: 'attack',
          twoHandedDeclined: a.twoHandedDeclined, charged: a.charged, chargeChoice: a.chargeChoice,
        }) : null);
      }
      return readings.get(uid) ?? null;
    };
    const share = (uid: number, pool: Pool): { targetUid: number; pool: Pool; chance: Forecast | null } => {
      const k = `${uid}:${pool.red}:${pool.yellow}`;
      const r = readOn(uid);
      if (!known.has(k)) known.set(k, r && this.odds ? this.odds().share(r, pool) : null);
      return { targetUid: r?.defenderUid ?? uid, pool: { red: pool.red, yellow: pool.yellow }, chance: known.get(k) ?? null };
    };
    whole.shares = () => [share(primary, total)];
    const cap = this.cap;
    // Each once: the window may draw a control in more than one place.
    const more = [...new Set(all.filter((x) => x.act === 'split.add' && x.arg !== undefined).map((x) => Number(x.arg)))];
    if (!cap || !more.length) return;
    // The targets added, smallest sets first.
    const sets: number[][] = [];
    const pick = (from: number, chosen: number[]): void => {
      if (chosen.length) sets.push(chosen);
      if (chosen.length >= cap.limit - 1) return;
      for (let i = from; i < more.length; i++) pick(i + 1, [...chosen, more[i]]);
    };
    pick(0, []);
    sets.sort((x, y) => x.length - y.length);
    const label = (uid: number): string => this.host.state().tokens.find((t) => t.uid === uid)?.label ?? String(uid);
    const dice = (p: Pool): string => [p.red ? `${p.red} Red` : '', p.yellow ? `${p.yellow} Yellow` : ''].filter(Boolean).join(' and ');
    let offered = 0;
    for (const set of sets) {
      const targets = [primary, ...set];
      const splits: { uid: number; red: number; yellow: number }[][] = [];
      for (const reds of sharesOf(total.red, targets.length)) {
        for (const yellows of sharesOf(total.yellow, targets.length)) {
          if (reds.some((r, i) => r + yellows[i] === 0)) continue;
          splits.push(targets.map((uid, i) => ({ uid, red: reds[i], yellow: yellows[i] })));
        }
      }
      if (offered + splits.length > SPLIT_ANSWERS) break;
      offered += splits.length;
      for (const split of splits) {
        const presses: Press[] = set.map((uid): Press => ['split.add', String(uid)]);
        for (const s of split.slice(1)) {
          for (const color of ['red', 'yellow'] as const) {
            for (let i = 0; i < s[color]; i++) presses.push(['split.less', `${primary}:${color}`], ['split.more', `${s.uid}:${color}`]);
          }
        }
        presses.push(['split.begin']);
        const o = add(`split:${split.map((s) => `${s.uid}=${s.red}r${s.yellow}y`).join(',')}`,
          `Split the pool: ${split.map((s) => `${dice(s)} at ${label(s.uid)}`).join(', ')}`, ['attack', 'split'], presses);
        o.facts = { split };
        o.shares = () => split.map((s) => share(s.uid, s));
      }
    }
  }

  // A DRAG (glossary :344): the Grid beside the attacker the struck unit is
  // pulled to, and the way it is left facing, one answer for each pair (the
  // window asks them as two presses). The facing that turns its back on the
  // attacker (4.2.6) is marked `away`, read as the Flog's turn reads it: the
  // long side of the line between them, a diagonal taking the horizontal.
  private drags(all: Btn[], add: (id: string, label: string, tags: string[], presses: Press[]) => Option): void {
    const atk = this.subject ? this.host.state().tokens.find((t) => t.uid === this.subject!.attackerUid) : undefined;
    for (const b of all) {
      if (b.act !== 'finish.drag' || b.arg === undefined) continue;
      const [col, row] = String(b.el.dataset?.at ?? '').split(',').map(Number);
      const uid = Number(b.el.dataset?.uid);
      if (!Number.isFinite(col) || !Number.isFinite(row) || !Number.isFinite(uid)) continue;
      let away = -1;
      if (atk) {
        const a = largeGridOf({ col: atk.col ?? 0, row: atk.row ?? 0 });
        const g = largeGridOf({ col, row });
        const dx = g.c - a.c;
        const dy = g.r - a.r;
        away = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
      }
      for (let f = 0; f < 4; f++) {
        const id = `finish.drag:${b.arg}:${f}`;
        if (this.offered.has(id) || this.tried.has(id)) continue;
        const tags = ['rider', 'drag', ...(f === away ? ['away'] : []), ...(b.el.dataset?.must ? ['must'] : [])];
        const o = add(id, `${b.label}, facing ${FACINGS[f]}`, tags, [['finish.drag', b.arg], ['finish.face', String(f)]]);
        o.facts = { uid, to: { col, row }, facing: f };
      }
    }
  }

  // Presses what an option of the last Decision named. False when a control it
  // needs is no longer there.
  press(id: string): boolean {
    const presses = this.offered.get(id);
    if (!presses) return false;
    this.presses += 1;
    const drawn = this.watching;
    const sentBefore = this.sends;
    // An effect of the hit is pressed once: refused, its control stays live,
    // and it is not offered again.
    const [first, firstArg] = presses[0];
    const rider = first === 'finish.drag' || (TAGS[first] ?? []).includes('rider');
    for (const [act, arg] of presses) {
      const b = this.buttons().find((x) => x.act === act && (arg === undefined || x.arg === arg));
      if (!b) {
        if (rider) this.tried.add(id);
        return false;
      }
      b.el.click();
    }
    if (rider && this.buttons().some((x) => x.act === first && (firstArg === undefined || x.arg === firstArg))) this.tried.add(id);
    // Defending, the answer has gone to the attacking window: nothing more is
    // asked off this picture. Only when one WENT, or dice are in the air for
    // it: a press that sent nothing leaves the question standing, to be
    // answered another way.
    if (!this.open && drawn !== null && (this.sends > sentBefore || this.rolling > 0)) this.answered = drawn;
    return true;
  }
}

// THE COMPUTER'S COUNTER-ROLL WINDOW. An Electronic Counter-roll (4.11) is a
// record both seats hold and both answer: each rolls its own unit's dice,
// each may Focus in its order, and the Initiator applies a win. A player's
// page draws that record in the combat window (matchhud.ts syncContest) and
// every press travels as a command (contest.ts). A computer seat does exactly
// that on an element nobody is shown: the same ElectronicHelper, drawn from
// the same record, its live controls read as the question and pressed as the
// answer. So whose turn it is to declare, what a Focus costs and who may close
// the exchange are the window's rules, with no second copy here.
import { ElectronicHelper } from '../combat';
import { contestAct, counterResponder } from '../contest';
import type { Decision, Option } from '../seat';
import { actionOf } from '../turn';
import type { CounterRoll, DiceData, Side } from '../types';
import { counterOffensive, tallyCounter } from '../units';
import type { Host } from './driver';

type Press = [act: string, arg?: string];

// What kind of thing a press is, for a policy that reasons about kinds.
const TAGS: Record<string, string[]> = {
  'ew.roll': ['roll'],
  'focus.use': ['focus', 'spend-link'],
  'focus.pass': ['decline'],
  'focus.whistle': ['focus', 'spend-command'],
  'reroll.keep': ['decline'],
  'ew.provoke': ['provoke'],
  'ew.leave': ['decline'],
  'ew.apply': ['apply'],
  'ew.done': ['end'],
};

// The question the live controls are asking, first match wins, and the press
// that is always safe for it.
const QUESTIONS: { kind: string; has: string[]; safe: string }[] = [
  { kind: 'contest.roll', has: ['ew.roll'], safe: 'ew.roll' },
  { kind: 'contest.focus', has: ['focus.pass', 'focus.use', 'focus.whistle'], safe: 'focus.pass' },
  { kind: 'contest.reroll', has: ['reroll.keep', 'reroll.go'], safe: 'reroll.keep' },
  { kind: 'contest.provoke', has: ['ew.provoke', 'ew.leave'], safe: 'ew.leave' },
  // A win is applied. Closing a won exchange unapplied is a player's to do.
  { kind: 'contest.apply', has: ['ew.apply'], safe: 'ew.apply' },
  { kind: 'contest.close', has: ['ew.done'], safe: 'ew.done' },
];

const immediate = (globalThis as { setImmediate?: (fn: () => void) => unknown }).setImmediate;
const later = (fn: () => void): void => { if (immediate) immediate(fn); else setTimeout(fn, 0); };

interface Btn {
  act: string;
  arg?: string;
  label: string;
  cls: string;
  el: HTMLElement;
}

export class BotContest {
  private readonly root: HTMLElement;
  private readonly helper: ElectronicHelper;
  // Dice asked for and not yet back.
  private rolling = 0;
  private stirred = false;
  // The exchange on the table, by who is in it, so each one's questions have
  // names of their own.
  private subject = '';
  private contestNo = 0;
  private presses = 0;
  private offered = new Map<string, Press[]>();

  constructor(private readonly seat: Side, private readonly host: Host) {
    const { data } = host;
    this.root = document.createElement('div');
    this.helper = new ElectronicHelper(data, data.dice as unknown as DiceData, this.root, () => {}, () => {});
    this.helper.instant = true;
    this.helper.tokens = () => host.state().tokens;
    // A press on the shared record: sent, never applied here (contest.ts).
    this.helper.contestAct = (act, arg) => contestAct({
      data, state: host.state(), seat: this.seat, send: (cmd) => host.send(cmd),
      rollHits: (n, label) => this.rolled(n, label),
    }, act, arg);
  }

  // The table's dice, never its own.
  private async rolled(n: number, label: string): Promise<{ dice: { face: number }[] }> {
    this.rolling += 1;
    this.stirred = true;
    try {
      return { dice: await this.host.roll({ yellow: n }, label, 'hits') };
    } finally {
      this.rolling -= 1;
    }
  }

  // Lets a roll a press asked for land, and the command that follows it go.
  async settle(): Promise<void> {
    await Promise.resolve();
    if (!this.rolling && !this.stirred) return;
    for (let i = 0; i < 2000; i++) {
      await new Promise<void>((r) => { later(r); });
      if (!this.rolling) break;
    }
    this.stirred = false;
  }

  // Draws the record as this seat's page would, or takes the window down when
  // there is none. The role is asked of the CONTEST, not of the seat.
  private sync(): 'initiator' | 'responder' | null {
    const { data } = this.host;
    const state = this.host.state();
    const c = state.script?.counter;
    const init = c ? state.tokens.find((x) => x.uid === c.initiatorUid) : undefined;
    const resp = c ? counterResponder(data, state, c, init) : undefined;
    const action = c && init ? actionOf(data, state, init, c.actionId) : undefined;
    if (!c || !init || !resp || !action) {
      if (this.subject) {
        this.helper.closeContest();
        this.subject = '';
        this.offered.clear();
      }
      return null;
    }
    const role = this.seat === init.side ? 'initiator' : this.seat === resp.side ? 'responder' : null;
    const subject = `${c.initiatorUid}:${c.responderUid}:${c.actionId}:${c.terminal ?? ''}`;
    if (subject !== this.subject) { this.subject = subject; this.contestNo += 1; this.presses = 0; }
    this.helper.showContest(c, init, resp, action, role ?? 'spectator');
    this.helper.redraw();
    return role;
  }

  private buttons(): Btn[] {
    const out: Btn[] = [];
    const walk = (el: HTMLElement): void => {
      if (el.hidden) return;
      if (el.tagName === 'BUTTON') {
        const act = el.dataset?.act;
        // A greyed control carries its reason (`data-why`) and hears no press.
        if (act && !(el as HTMLButtonElement).disabled && !el.dataset.why) {
          out.push({ act, arg: el.dataset.arg, label: (el.textContent || el.innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), cls: String(el.className ?? ''), el });
        }
        return;
      }
      for (const c of Array.from(el.children ?? []) as HTMLElement[]) walk(c);
    };
    walk(this.root);
    return out;
  }

  // What the Counter-roll on the table is asking THIS seat now, or null: there
  // is none, it waits on the other seat, or dice are in the air.
  decision(): Decision | null {
    const role = this.sync();
    if (!role || this.rolling) return null;
    const live = this.buttons();
    const q = QUESTIONS.find((x) => live.some((b) => x.has.includes(b.act)));
    if (!q) return null;
    // The Initiator's seat ends the exchange: a Responder may once the
    // Initiator has lost, and leaves it to the player whose Action it was.
    if (q.kind === 'contest.close' && role !== 'initiator') return null;
    const c = this.host.state().script!.counter!;
    const read = this.dice(role, c);
    const options: Option[] = [];
    this.offered.clear();
    const add = (id: string, label: string, tags: string[], presses: Press[]): void => {
      this.offered.set(id, presses);
      options.push({ id, label, tags, run: { routine: 'contest', args: { id } } });
    };
    for (const b of live) {
      if (!q.has.includes(b.act)) continue;
      // The reroll throws the dice that are selected. This seat's own dice are
      // the ones it may press; the selection offered is all of them, or the
      // ones that count nothing for this side (a reroll of those can only
      // better the hand).
      if (b.act === 'reroll.go') {
        const dice = live.filter((d) => d.act === 'die');
        if (dice.length) {
          add('reroll.all', 'Reroll every die', ['reroll', 'all'], [
            ...dice.filter((d) => !/\bsel\b/.test(d.cls)).map((d): Press => ['die', d.arg]),
            ['reroll.go'],
          ]);
          const blank = read?.blank ?? [];
          const own = role === 'initiator' ? 'init' : 'resp';
          if (blank.length && blank.length < dice.length) {
            add('reroll.blanks', `Reroll the ${blank.length === 1 ? 'die' : `${blank.length} dice`} that count nothing`, ['reroll', 'blanks'], [
              ...dice.filter((d) => {
                const [who, at] = String(d.arg ?? '').split(':');
                return who === own && blank.includes(Number(at)) !== /\bsel\b/.test(d.cls);
              }).map((d): Press => ['die', d.arg]),
              ['reroll.go'],
            ]);
          }
        }
        continue;
      }
      if (this.offered.has(b.act)) continue;
      add(b.act, b.label, TAGS[b.act] ?? [], [[b.act]]);
    }
    if (!options.length) return null;
    return {
      id: `contest|${this.contestNo}|${this.presses}|${q.kind}`,
      kind: q.kind,
      seat: this.seat,
      unit: role === 'initiator' ? c.initiatorUid : c.responderUid,
      options,
      fallback: (options.find((o) => o.id === q.safe) ?? options[0]).id,
      facts: { initiatorUid: c.initiatorUid, responderUid: c.responderUid, actionId: c.actionId, role, ...(read ? { mine: read.mine, theirs: read.theirs, blank: read.blank, faces: read.faces } : {}), ...(c.terminal !== undefined ? { terminal: c.terminal } : {}) },
    };
  }

  // WHAT EACH SIDE HAS ROLLED, as each counts its own dice (its hollow faces by
  // its own Stance, contest.ts counterOffensive), once both hands are in: this
  // side's count and the other's, which of this side's dice count nothing, and
  // what each face of a die rerolled would count for it. For a policy that
  // weighs a Focus by the dice (the Tactician's `ewFocus`).
  private dice(role: 'initiator' | 'responder', c: CounterRoll): { mine: { lightning: number; light: number }; theirs: { lightning: number; light: number }; blank: number[]; faces: { lightning: number; light: number }[] } | null {
    const { data } = this.host;
    const state = this.host.state();
    const dice = data.dice as unknown as DiceData | null;
    const init = state.tokens.find((x) => x.uid === c.initiatorUid);
    const resp = counterResponder(data, state, c, init);
    if (!dice?.dice?.yellow?.faces?.length || !init || !resp || !c.initRoll || !c.respRoll) return null;
    const first = role === 'initiator';
    const offensive = first ? counterOffensive(data, state.tokens, init, resp, 'initiator') : counterOffensive(data, state.tokens, resp, init, 'responder');
    const other = first ? counterOffensive(data, state.tokens, resp, init, 'responder') : counterOffensive(data, state.tokens, init, resp, 'initiator');
    const roll = first ? c.initRoll : c.respRoll;
    const count = (f: number): { lightning: number; light: number } => tallyCounter(dice, [f], offensive);
    return {
      mine: tallyCounter(dice, roll, offensive),
      theirs: tallyCounter(dice, first ? c.respRoll : c.initRoll, other),
      blank: roll.map((f, i) => ({ n: count(f), i })).filter(({ n }) => !n.lightning && !n.light).map(({ i }) => i),
      faces: dice.dice.yellow.faces.map((_f, i) => count(i)),
    };
  }

  // Presses what an option of the last Decision named. False when a control it
  // needs is no longer there.
  press(id: string): boolean {
    const presses = this.offered.get(id);
    if (!presses) return false;
    this.presses += 1;
    for (const [act, arg] of presses) {
      const b = this.buttons().find((x) => x.act === act && (arg === undefined || x.arg === arg));
      if (!b) return false;
      b.el.click();
    }
    return true;
  }
}

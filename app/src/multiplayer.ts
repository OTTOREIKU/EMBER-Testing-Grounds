import { ApiError, type Account, type CardStat, type EmberApi, type MyRecord, type RegistrationInfo } from './api';
import type { NetView } from './net';

// What the dialog is allowed to do to a networked game. Deliberately narrow:
// the relay itself lives in main, and this only drives it.
export interface NetControls {
  view(): NetView;
  host(): void;
  join(code: string): void;
  leave(): void;
  resend(): void;
}

// The multiplayer area lives entirely in this popup. Nothing is added to the
// permanent chrome: the board is the app, and an account is something you go
// and deal with occasionally rather than something that watches you play.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SCORE_WORD = ['very weak', 'weak', 'fair', 'strong', 'very strong'] as const;

export class MultiplayerDialog {
  private api: EmberApi;
  private dlg: HTMLElement | null = null;
  private reg: RegistrationInfo | null = null;
  private busy = false;
  private notice: { kind: 'error' | 'ok'; text: string; issues?: string[] } | null = null;
  private meterTimer: number | undefined;
  // Stats arrive after the panel is already on screen, so it renders without
  // them and fills in. A card id means nothing to a player, so names are
  // resolved here — only the client has the card database.
  private stats: { record: MyRecord; top: CardStat[] } | null = null;
  private cardName: (id: string) => string;
  private net: NetControls | null;

  constructor(api: EmberApi, cardName: (id: string) => string = (id) => id, net: NetControls | null = null) {
    this.api = api;
    this.cardName = cardName;
    this.net = net;
  }

  // The relay changes underneath the dialog — a peer joins, a connection
  // drops — so the panel is refreshed from outside rather than polling.
  refresh(): void {
    if (this.dlg && !this.busy) this.render();
  }

  async open(): Promise<void> {
    this.close();
    this.notice = null;
    this.busy = false;

    const dlg = document.createElement('div');
    dlg.id = 'mp-dialog';
    this.dlg = dlg;
    dlg.addEventListener('click', (ev) => {
      if (ev.target === dlg) this.close();
    });
    document.body.appendChild(dlg);
    this.render();

    // The account state may be stale if the session expired while the tab sat
    // open, so re-check on the way in rather than trusting what we last saw.
    await this.api.refresh();
    if (!this.reg) {
      try {
        this.reg = await this.api.registration();
      } catch {
        this.reg = null;
      }
    }
    this.render();
    void this.loadStats();
  }

  // Fetched after the panel is up, so a slow or failed stats call never delays
  // signing in. Failure leaves the section reading "Loading…" rather than
  // throwing an error across a panel that is otherwise working.
  private async loadStats(): Promise<void> {
    if (!this.api.user) {
      this.stats = null;
      return;
    }
    try {
      const [record, top] = await Promise.all([this.api.myRecord(), this.api.topCards(undefined, 10)]);
      this.stats = { record, top };
      if (this.dlg && this.api.user) this.render();
    } catch {
      /* advisory; the panel stands without it */
    }
  }

  close(): void {
    window.clearTimeout(this.meterTimer);
    this.dlg?.remove();
    this.dlg = null;
  }

  private field(id: string, label: string, type: string, extra = ''): string {
    return `<label class="mp-field">
      <span>${esc(label)}</span>
      <input class="dlg-input" id="${id}" type="${type}" autocomplete="off" spellcheck="false" ${extra}>
    </label>`;
  }

  private noticeHtml(): string {
    if (!this.notice) return '';
    const { kind, text, issues } = this.notice;
    const list = issues?.length
      ? `<ul class="mp-issues">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
      : '';
    return `<p class="mp-notice ${kind}">${esc(text)}${list}</p>`;
  }

  private onlineHtml(): string {
    if (!this.net) return '';
    const v = this.net.view();

    if (!v.room) {
      return `<div class="mp-section">
        <h4>Play online</h4>
        <p class="dim">Open a room and pass the code to your opponent, or enter one you were given. You each keep your own board; the moves travel between them.</p>
        ${v.error ? `<p class="mp-notice error">${esc(v.error)}</p>` : ''}
        ${this.field('mp-room', 'Room code', 'text', 'placeholder="XXXXX" maxlength="7"')}
        <div class="mp-actions">
          <button class="mp-btn ghost" id="mp-join">Join</button>
          <button class="mp-btn" id="mp-host">Open a room</button>
        </div>
      </div>`;
    }

    const seatLine = (side: 's1' | 's2') => {
      const who = v.room!.seats[side];
      const mine = v.seat === side;
      return `<div class="mp-game">
        <span class="mp-res ${mine ? 'won' : 'draw'}">${side === 's1' ? 'SQ 1' : 'SQ 2'}</span>
        <span class="mp-game-mid">${who ? esc(who) : '<i class="dim">waiting…</i>'}</span>
        ${mine ? '<span class="dim">you</span>' : ''}
      </div>`;
    };

    const status = v.status === 'connecting' ? 'Reconnecting…'
      : v.status === 'lobby' ? 'Waiting for the other player'
      : 'Both seats filled — play as normal, your moves are being sent';

    return `<div class="mp-section">
        <h4>Online game</h4>
        <div class="mp-room-code">${esc(v.room.id)}</div>
        <p class="dim">${esc(status)}${v.seat ? '' : ' · you are spectating'}</p>
        <div class="mp-games">${seatLine('s1')}${seatLine('s2')}</div>
        ${v.desynced
          ? `<p class="mp-notice error">The two boards have drifted apart. Ask the other player to press Resend board, or press it yourself to push yours.</p>`
          : v.error ? `<p class="mp-notice error">${esc(v.error)}</p>` : ''}
        <div class="mp-actions">
          <button class="mp-btn ghost" id="mp-leave">Leave</button>
          <button class="mp-btn" id="mp-resend" data-tip-title="Resend board" data-tip="Sends your whole board to the other player, replacing theirs.|Use it if the two have drifted apart.">Resend board</button>
        </div>
      </div>`;
  }

  private statsHtml(): string {
    if (!this.stats) return '<div class="mp-section"><h4>Your record</h4><p class="dim">Loading…</p></div>';
    const { record, top } = this.stats;
    const r = record.record;
    if (!r.played && !record.reported) {
      return `<div class="mp-section"><h4>Your record</h4>
        <p class="dim">No games yet. End a game from the play guide and you will be offered the chance to record it.</p></div>`;
    }
    const cell = (n: number, label: string) => `<div class="mp-stat"><b>${n}</b><span>${label}</span></div>`;
    const rate = r.played ? Math.round((r.won / r.played) * 100) : 0;
    const recent = record.recent.slice(0, 5).map((g) => `<div class="mp-game">
        <span class="mp-res ${g.result}">${g.result === 'won' ? 'Won' : g.result === 'lost' ? 'Lost' : 'Drew'}</span>
        <span class="mp-game-mid">${esc(g.mission ?? 'no Main Task')}</span>
        <span class="dim">${g.vp} VP · R${g.rounds}</span>
      </div>`).join('');

    return `<div class="mp-section">
        <h4>Your record</h4>
        <div class="mp-stats">
          ${cell(r.played, 'played')}${cell(r.won, 'won')}${cell(r.lost, 'lost')}${cell(r.drawn, 'drawn')}
        </div>
        ${r.played ? `<p class="dim">${rate}% win rate across ${r.played} game${r.played === 1 ? '' : 's'}.${
          record.reported > r.played ? ` ${record.reported - r.played} more recorded without claiming a side.` : ''
        }</p>` : `<p class="dim">${record.reported} game${record.reported === 1 ? '' : 's'} recorded without claiming a side.</p>`}
        ${recent ? `<div class="mp-games">${recent}</div>` : ''}
      </div>
      ${top.length ? `<div class="mp-section">
        <h4>Most used cards</h4>
        <div class="mp-games">${top.slice(0, 8).map((c) => `<div class="mp-game">
          <span class="mp-game-mid">${esc(this.cardName(c.card))}</span>
          <span class="dim">${c.uses} use${c.uses === 1 ? '' : 's'}${c.uses ? ` · ${Math.round((c.wins / c.uses) * 100)}% won` : ''}</span>
        </div>`).join('')}</div>
        <p class="dim">Across every game recorded by everyone, not just yours.</p>
      </div>` : ''}`;
  }

  private signedInHtml(user: Account): string {
    return `<div class="mp-section">
        <div class="mp-who">
          <b>${esc(user.displayName || user.username)}</b>
          <span class="mp-tag">${esc(user.role)}</span>
        </div>
        <p class="dim">Signed in. Networked play is still being built; for now an account records the games you finish.</p>
        <div class="mp-actions">
          <button class="mp-btn ghost" id="mp-signout">Sign out</button>
        </div>
      </div>
      ${this.onlineHtml()}
      ${this.statsHtml()}
      <div class="mp-section">
        <h4>Change password</h4>
        ${this.field('mp-cur', 'Current password', 'password')}
        ${this.field('mp-new', 'New password', 'password')}
        <div class="mp-meter" id="mp-meter2" hidden><i></i><i></i><i></i><i></i><span></span></div>
        <div class="mp-actions">
          <button class="mp-btn" id="mp-change">Change password</button>
        </div>
        <p class="dim">Changing it signs you out everywhere else.</p>
      </div>`;
  }

  private signedOutHtml(): string {
    const reg = this.reg;
    const closed = reg?.mode === 'closed';
    const inviteNeeded = reg?.inviteRequired ?? true;

    // Registration is refused server-side whatever this says; the disabled
    // button is only there so the door visibly is not open.
    const createNote = !reg
      ? 'The server could not be reached, so new accounts cannot be created right now.'
      : closed
        ? 'New accounts are closed at the moment.'
        : inviteNeeded
          ? 'Accounts are invite only while this is being tested. Enter the code you were given.'
          : 'Anyone may create an account.';

    return `<div class="mp-section">
        <h4>Sign in</h4>
        ${this.field('mp-user', 'Username', 'text')}
        ${this.field('mp-pass', 'Password', 'password')}
        <div class="mp-actions">
          <button class="mp-btn" id="mp-signin">Sign in</button>
        </div>
      </div>
      <div class="mp-section${closed || !reg ? ' mp-shut' : ''}">
        <h4>Create account</h4>
        <p class="dim">${esc(createNote)}</p>
        ${closed || !reg ? '' : `
          ${inviteNeeded ? this.field('mp-code', 'Invite code', 'text', 'placeholder="XXXXX-XXXXX" maxlength="24"') : ''}
          ${this.field('mp-newuser', 'Username', 'text', 'maxlength="24"')}
          ${this.field('mp-newpass', 'Password', 'password')}
          <div class="mp-meter" id="mp-meter" hidden><i></i><i></i><i></i><i></i><span></span></div>
          <div class="mp-actions">
            <button class="mp-btn" id="mp-create" disabled>Create account</button>
          </div>`}
      </div>`;
  }

  private render(): void {
    const dlg = this.dlg;
    if (!dlg) return;
    const user = this.api.user;

    dlg.innerHTML = `<div class="scn-panel mp-panel">
      <button class="dlg-close" id="mp-close" title="Close">✕</button>
      <div class="inv-head"><b>Multiplayer</b></div>
      <p class="dim">${user
        ? 'Your account on embertg.online.'
        : 'Sign in to record games and, once it is ready, play against someone else.'}</p>
      ${this.noticeHtml()}
      <div class="mp-body">${user ? this.signedInHtml(user) : this.signedOutHtml()}</div>
    </div>`;

    dlg.querySelector('#mp-close')!.addEventListener('click', () => this.close());
    if (user) this.wireSignedIn();
    else this.wireSignedOut();
  }

  private input(id: string): HTMLInputElement | null {
    return this.dlg?.querySelector<HTMLInputElement>(`#${id}`) ?? null;
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.dlg?.querySelectorAll('button').forEach((b) => {
      if (b.id !== 'mp-close') b.disabled = on;
    });
    if (!on) this.syncCreateEnabled();
  }

  // Runs an action, turns any failure into a notice, and re-renders. Every
  // path through the dialog goes through here so nothing can fail silently.
  //
  // The reset and the re-render live in `finally` deliberately: clearing the
  // busy flag only on the failure path leaves it stuck true after anything
  // succeeds, and every later click is then swallowed by the guard above.
  private async attempt(fn: () => Promise<void>, okText?: string): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      await fn();
      this.notice = okText ? { kind: 'ok', text: okText } : null;
    } catch (err) {
      const e = err as ApiError;
      this.notice = { kind: 'error', text: e.message ?? 'Something went wrong.', issues: e.issues };
    } finally {
      this.busy = false;
      // Signing in or out changes whose stats these are, so drop the old set
      // rather than showing the previous account's record for a moment.
      this.stats = null;
      this.render();
      void this.loadStats();
    }
  }

  private wireSignedIn(): void {
    this.dlg?.querySelector('#mp-signout')!.addEventListener('click', () => {
      void this.attempt(async () => { await this.api.logout(); });
    });

    const net = this.net;
    if (net) {
      const code = this.input('mp-room');
      // A room code is handed over in upper case; typing it lower should look
      // the same on screen, exactly as the invite field does.
      code?.addEventListener('input', () => {
        const at = code.selectionStart;
        code.value = code.value.toUpperCase();
        code.setSelectionRange(at, at);
      });
      const join = (): void => {
        if (!code?.value.trim()) {
          this.notice = { kind: 'error', text: 'Enter the room code you were given.' };
          this.render();
          return;
        }
        net.join(code.value.trim());
      };
      code?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') join(); });
      this.dlg?.querySelector('#mp-join')?.addEventListener('click', join);
      this.dlg?.querySelector('#mp-host')?.addEventListener('click', () => net.host());
      this.dlg?.querySelector('#mp-leave')?.addEventListener('click', () => net.leave());
      this.dlg?.querySelector('#mp-resend')?.addEventListener('click', () => net.resend());
    }

    const cur = this.input('mp-cur');
    const next = this.input('mp-new');
    next?.addEventListener('input', () => this.updateMeter(next.value, 'mp-meter2'));

    this.dlg?.querySelector('#mp-change')!.addEventListener('click', () => {
      if (!cur?.value || !next?.value) {
        this.notice = { kind: 'error', text: 'Fill in both password boxes.' };
        this.render();
        return;
      }
      void this.attempt(
        async () => { await this.api.changePassword(cur.value, next.value); },
        'Password changed. Any other device you were signed in on has been signed out.',
      );
    });
  }

  private wireSignedOut(): void {
    const user = this.input('mp-user');
    const pass = this.input('mp-pass');

    const signIn = (): void => {
      if (!user?.value || !pass?.value) {
        this.notice = { kind: 'error', text: 'Enter your username and password.' };
        this.render();
        return;
      }
      void this.attempt(async () => { await this.api.login(user.value.trim(), pass.value); });
    };
    this.dlg?.querySelector('#mp-signin')?.addEventListener('click', signIn);
    // Enter submits from either box, which is what every other sign-in does.
    for (const el of [user, pass]) {
      el?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') signIn(); });
    }

    const code = this.input('mp-code');
    const newUser = this.input('mp-newuser');
    const newPass = this.input('mp-newpass');
    if (!newUser || !newPass) return;

    for (const el of [code, newUser, newPass]) {
      el?.addEventListener('input', () => this.syncCreateEnabled());
    }
    newPass.addEventListener('input', () => this.updateMeter(newPass.value, 'mp-meter', newUser.value));
    // An invite code is handed over in uppercase; typing it in lower case
    // should look the same on screen as it does on paper.
    code?.addEventListener('input', () => {
      const at = code.selectionStart;
      code.value = code.value.toUpperCase();
      code.setSelectionRange(at, at);
    });

    this.dlg?.querySelector('#mp-create')?.addEventListener('click', () => {
      void this.attempt(async () => {
        await this.api.register(newUser.value.trim(), newPass.value, code?.value.trim() ?? '');
      });
    });
    this.syncCreateEnabled();
  }

  // The Create account button stays greyed out until there is something to
  // submit — and, while the test is invite only, until a code has been typed.
  private syncCreateEnabled(): void {
    const btn = this.dlg?.querySelector<HTMLButtonElement>('#mp-create');
    if (!btn || this.busy) return;
    const code = this.input('mp-code');
    const user = this.input('mp-newuser');
    const pass = this.input('mp-newpass');
    const needCode = this.reg?.inviteRequired ?? true;
    const ready = !!user?.value.trim() && !!pass?.value && (!needCode || !!code?.value.trim());
    btn.disabled = !ready;
    btn.title = ready ? '' : needCode
      ? 'Enter your invite code, a username and a password'
      : 'Enter a username and a password';
  }

  // The meter is advisory. The server runs the same policy and is the one that
  // decides, so a slow or failed check here must never block the form.
  private updateMeter(password: string, meterId: string, username?: string): void {
    const meter = this.dlg?.querySelector<HTMLElement>(`#${meterId}`);
    if (!meter) return;
    window.clearTimeout(this.meterTimer);
    if (!password) {
      meter.hidden = true;
      return;
    }
    this.meterTimer = window.setTimeout(() => {
      void this.api.passwordCheck(password, username).then((a) => {
        // The box may have been retyped or the dialog closed while we waited.
        const live = this.dlg?.querySelector<HTMLElement>(`#${meterId}`);
        if (!live) return;
        live.hidden = false;
        live.dataset.score = String(a.score);
        const label = live.querySelector('span');
        if (label) {
          label.textContent = a.ok
            ? SCORE_WORD[a.score]
            : (a.issues[0] ?? SCORE_WORD[a.score]);
        }
      }).catch(() => { /* advisory only */ });
    }, 250);
  }
}

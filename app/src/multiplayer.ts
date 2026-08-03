import { ApiError, type Account, type EmberApi, type RegistrationInfo } from './api';

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

  constructor(api: EmberApi) {
    this.api = api;
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

  private signedInHtml(user: Account): string {
    return `<div class="mp-section">
        <div class="mp-who">
          <b>${esc(user.displayName || user.username)}</b>
          <span class="mp-tag">${esc(user.role)}</span>
        </div>
        <p class="dim">Signed in. Online play is still being built — for now an account only reserves your name and will carry your game history once stat recording lands.</p>
        <div class="mp-actions">
          <button class="mp-btn ghost" id="mp-signout">Sign out</button>
        </div>
      </div>
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
      this.render();
    }
  }

  private wireSignedIn(): void {
    this.dlg?.querySelector('#mp-signout')!.addEventListener('click', () => {
      void this.attempt(async () => { await this.api.logout(); });
    });

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

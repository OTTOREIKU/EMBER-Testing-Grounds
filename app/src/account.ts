import './account.css';
import { ApiError, type EmberApi } from './api';
import { alertDialog, confirmDialog, openDialog } from './dialog';

// THE ACCOUNT SCREEN, one for every page (OTTO, 2026-10-01: "a unified account
// screen that every app can link and open to keep it all one shared style").
//
// The tabletop's Multiplayer popup, the Match Centre and the pad each carried
// their own sign-out, and two of them their own password change, written three
// ways. All of it lives here now, with the two controls the security audit
// added: signing out everywhere, and deleting the account.
//
// A page hands over its EmberApi and says what it does once the session has
// ended - leave its table, show its own signed-out screen. Signing IN stays
// with each page: that form is the page's front door.
//
// The frame, Escape and the backdrop are dialog.ts's own (openDialog), so this
// closes the way every dialog in the app closes.

export interface AccountHost {
  api: EmberApi;
  // The session ended from this screen: signed out here, signed out
  // everywhere, or the account deleted. The screen has already closed.
  onGone(): void;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SCORE_WORD = ['very weak', 'weak', 'fair', 'strong', 'very strong'] as const;

function field(hook: string, label: string, autocomplete: string): string {
  return `<label class="acc-field">
    <span>${esc(label)}</span>
    <input class="dlg-input" ${hook} type="password" autocomplete="${autocomplete}" spellcheck="false">
  </label>`;
}

export function openAccount(host: AccountHost): void {
  const { api } = host;
  const user = api.user;
  if (!user) return;
  const admin = user.role === 'admin';

  // The close control sits LAST in the markup so the tab order starts at the
  // screen's own content; CSS puts it in the corner.
  const inner = `<h3 class="acc-title">Account</h3>
    <div class="acc-who">
      <b>${esc(user.displayName || user.username)}</b>
      <span class="acc-tag">${esc(user.role)}</span>
    </div>
    <p class="acc-line" data-acc-record hidden></p>
    <p class="acc-notice" data-acc-notice role="status" hidden></p>

    <section class="acc-sect">
      <h4>Password</h4>
      ${field('data-acc-cur', 'Current password', 'current-password')}
      ${field('data-acc-new', 'New password', 'new-password')}
      <div class="acc-meter" data-acc-meter hidden><i></i><i></i><i></i><i></i><span></span></div>
      <p class="acc-note">Changing it signs you out on every other device.</p>
      <div class="acc-actions">
        <button class="acc-btn" data-acc-change>Change password</button>
      </div>
    </section>

    <section class="acc-sect" data-acc-logging>
      <h4>Game logging</h4>
      <p class="acc-note">Off unless you switch it on. A logged game helps balance the factions and tune the computer.</p>
      <label class="acc-switch">
        <input type="checkbox" data-acc-log-computer>
        <span>Games against the computer</span>
        <em data-acc-log-computer-since></em>
      </label>
      <label class="acc-switch">
        <input type="checkbox" data-acc-log-games>
        <span>Multiplayer and Pad games</span>
        <em data-acc-log-games-since></em>
      </label>
      <details class="acc-kept">
        <summary>What is kept</summary>
        <p>The cards each side brought, by card number, with factions and points. The battlefield, the Main Task and the Secondary Tasks. Who went first, the score by round and what scored it, the units destroyed and when, the Tactics Cards played, the winner and how the game ended. Season rules on or off, the computer's level, the app's version, and how long the game took.</p>
        <p>Never kept: your name or any name you typed (squads, Mechs, units), your device, your browser, or where you connect from.</p>
        <p>In a game against another player only your own side is linked to your account. The other side stays anonymous unless that player logs the game too.</p>
      </details>
      <div class="acc-actions">
        <button class="acc-btn ghost" data-acc-log-delete>Delete my logged games</button>
      </div>
    </section>

    <section class="acc-sect">
      <h4>Sign out</h4>
      <p class="acc-note">Your saved units, squads and collection leave this device and stay on your account. Everywhere also ends your session on every other device.</p>
      <div class="acc-actions">
        <button class="acc-btn ghost" data-acc-out-all>Sign out everywhere</button>
        <button class="acc-btn" data-acc-out>Sign out</button>
      </div>
    </section>

    <section class="acc-sect">
      <h4>Delete account</h4>
      ${admin
        ? '<p class="acc-note">An admin account cannot be deleted from here.</p>'
        : `<p class="acc-note">Removes your account, your saved units and squads, and your collection. Games you logged stay in the stats with no name on them. This cannot be undone.</p>
      ${field('data-acc-del-pass', 'Password', 'current-password')}
      <div class="acc-actions">
        <button class="acc-btn danger" data-acc-delete>Delete my account</button>
      </div>`}
    </section>
    <button class="dlg-close" data-close data-autofocus aria-label="Close">✕</button>`;

  openDialog(inner, (panel, close) => {
    const find = <T extends HTMLElement>(hook: string): T | null => panel.querySelector<T>(`[${hook}]`);
    const notice = find<HTMLElement>('data-acc-notice');
    const cur = find<HTMLInputElement>('data-acc-cur');
    const next = find<HTMLInputElement>('data-acc-new');
    const delPass = find<HTMLInputElement>('data-acc-del-pass');
    const meter = find<HTMLElement>('data-acc-meter');
    let busy = false;
    let meterTimer = 0;

    const say = (kind: 'ok' | 'error', text: string, issues: string[] = []): void => {
      if (!notice) return;
      notice.hidden = false;
      notice.className = `acc-notice ${kind}`;
      notice.textContent = [text, ...issues].join(' ');
    };
    const hush = (): void => {
      if (notice) notice.hidden = true;
    };
    const setBusy = (on: boolean): void => {
      busy = on;
      panel.querySelectorAll<HTMLButtonElement>('.acc-btn').forEach((b) => { b.disabled = on; });
    };

    // Every action goes through here, so none can fail silently and none can
    // be pressed twice. A failure is said in the screen's own line.
    const attempt = async (fn: () => Promise<void>): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      hush();
      try {
        await fn();
        return true;
      } catch (err) {
        const e = err as Partial<ApiError>;
        say('error', e.message || 'Something went wrong. Try again.', e.issues ?? []);
        return false;
      } finally {
        setBusy(false);
      }
    };

    const gone = (): void => {
      window.clearTimeout(meterTimer);
      close();
      host.onGone();
    };

    // The record, as the Match Centre's own account box showed it. A page with
    // no reach to the server simply shows no line.
    void api.myRecord().then((r) => {
      const line = find<HTMLElement>('data-acc-record');
      if (!line) return;
      const { played, won, drawn, lost } = r.record;
      line.textContent = played
        ? `${played} played · ${won} won · ${drawn} drawn · ${lost} lost`
        : 'No games recorded yet.';
      line.hidden = false;
    }).catch(() => { /* a missing record is not worth a notice */ });

    // The meter is advisory. The server runs the same policy and is the one
    // that decides, so a slow or failed check must never block the form.
    next?.addEventListener('input', () => {
      window.clearTimeout(meterTimer);
      if (!meter) return;
      const password = next.value;
      if (!password) { meter.hidden = true; return; }
      meterTimer = window.setTimeout(() => {
        void api.passwordCheck(password, user.username).then((a) => {
          if (next.value !== password) return;
          meter.hidden = false;
          meter.dataset.score = String(a.score);
          const label = meter.querySelector('span');
          if (label) label.textContent = a.ok ? SCORE_WORD[a.score] : (a.issues[0] ?? SCORE_WORD[a.score]);
        }).catch(() => { /* advisory only */ });
      }, 250);
    });

    find('data-acc-change')?.addEventListener('click', () => {
      if (!cur?.value || !next?.value) { say('error', 'Fill in both password boxes.'); return; }
      void attempt(() => api.changePassword(cur.value, next.value)).then((ok) => {
        if (!ok) return;
        cur.value = '';
        next.value = '';
        if (meter) meter.hidden = true;
        say('ok', 'Password changed. Every other device has been signed out.');
      });
    });

    // GAME LOGGING (OTTO, 2026-10-10): each switch says when it was turned on;
    // a change the server refuses puts the box back as it was.
    const since = (iso: string | null | undefined): string => {
      if (!iso) return '';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? 'On' : `On since ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    };
    const showLogging = (logging: { computer: string | null; games: string | null } | undefined): void => {
      for (const kind of ['computer', 'games'] as const) {
        const box = find<HTMLInputElement>(`data-acc-log-${kind}`);
        const when = find<HTMLElement>(`data-acc-log-${kind}-since`);
        if (box) box.checked = !!logging?.[kind];
        if (when) when.textContent = since(logging?.[kind]);
      }
    };
    showLogging(api.user?.logging);
    for (const kind of ['computer', 'games'] as const) {
      const box = find<HTMLInputElement>(`data-acc-log-${kind}`);
      box?.addEventListener('change', () => {
        const want = box.checked;
        void attempt(async () => { showLogging(await api.setLogging({ [kind]: want })); }).then((ok) => {
          if (!ok) box.checked = !want;
        });
      });
    }

    find('data-acc-log-delete')?.addEventListener('click', () => {
      if (busy) return;
      void confirmDialog({
        title: 'Delete your logged games?',
        body: 'Every game logged for this account is removed. A game the other player logged too stays for them, without your name. This cannot be undone.',
        confirmLabel: 'Delete my logged games',
        cancelLabel: 'Keep them',
        danger: true,
      }).then(async (yes) => {
        if (!yes) return;
        let left = { deleted: 0, kept: 0, computer: 0 };
        if (!(await attempt(async () => { left = await api.deleteMyGames(); }))) return;
        const n = left.deleted + left.kept + left.computer;
        say('ok', n ? `Deleted ${n} logged game${n === 1 ? '' : 's'}.` : 'There were no logged games to delete.');
        void api.myRecord().then((r) => {
          const line = find<HTMLElement>('data-acc-record');
          if (line) line.textContent = r.record.played ? `${r.record.played} played · ${r.record.won} won · ${r.record.drawn} drawn · ${r.record.lost} lost` : 'No games recorded yet.';
        }).catch(() => { /* the line keeps what it said */ });
      });
    });

    find('data-acc-out')?.addEventListener('click', () => {
      void attempt(() => api.logout()).then((ok) => { if (ok) gone(); });
    });

    find('data-acc-out-all')?.addEventListener('click', () => {
      void attempt(() => api.logoutEverywhere()).then((ok) => { if (ok) gone(); });
    });

    find('data-acc-delete')?.addEventListener('click', () => {
      if (busy) return;
      if (!delPass?.value) { say('error', 'Enter your password to delete the account.'); return; }
      const password = delPass.value;
      void confirmDialog({
        title: `Delete ${user.username}?`,
        body: 'Your account, your saved units and squads, and your collection will be removed. This cannot be undone.',
        confirmLabel: 'Delete my account',
        cancelLabel: 'Keep it',
        danger: true,
      }).then(async (yes) => {
        if (!yes) return;
        if (!(await attempt(() => api.deleteAccount(password)))) return;
        gone();
        await alertDialog({ title: 'Account deleted', body: 'Your account and everything saved for it have been removed.' });
      });
    });
  }, undefined, 'acc-back');
}

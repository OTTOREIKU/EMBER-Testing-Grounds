// The notice line (notices.ts, OTTO's picks 2026-09-28): one line, one notice
// at a time, text only, rule numbers left for the Reference.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

// A DOM just big enough for the line: elements that keep their children,
// attributes and listeners, and timers the test fires by hand.
function el(tag) {
  const e = {
    tagName: tag.toUpperCase(), className: '', textContent: '', hidden: false, type: '',
    children: [], attrs: {}, dataset: {}, _h: {},
    setAttribute(k, v) { e.attrs[k] = String(v); },
    replaceChildren(...cs) { e.children = cs; },
    addEventListener(t, fn) { (e._h[t] ||= []).push(fn); },
    click() { for (const fn of e._h.click ?? []) fn({ preventDefault() {}, stopPropagation() {} }); },
  };
  return e;
}
let timers = [];
globalThis.window = {
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
};
globalThis.document = { createElement: el };
globalThis.Node ??= function Node() {};

const out = new URL('./_notices.bundle.mjs', import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL('../src/notices.ts', import.meta.url))], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'neutral', logLevel: 'silent', loader: { '.css': 'empty' },
});
const N = await import(`${out.href}?t=${Date.now()}`);

console.log('Notices\n');

// ---------- the voice: no rule numbers in play ----------
const terse = (t) => N.speak(t, 'terse');
check('a rule number goes', terse('A Mech in Shutdown Stance cannot Maneuver or perform any Action other than Reboot (4.1.1).'),
  'A Mech in Shutdown Stance cannot Maneuver or perform any Action other than Reboot.');
check('a FAQ number goes', terse('The Scan failed, so the attack on Dune Brawler ends. The Action Tick is spent (FAQ I11).'),
  'The Scan failed, so the attack on Dune Brawler ends. The Action Tick is spent.');
check('mid-sentence too', terse('Interception may be owed (4.9): Porcupine, if in Range of Scout-63 or the Landing Point.'),
  'Interception may be owed: Porcupine, if in Range of Scout-63 or the Landing Point.');
check('a mixed parenthesis keeps its words', terse('Dragoon commands Hound II (Command Coordination, 4.15.3). It may Move or take 1 Command Action.'),
  'Dragoon commands Hound II (Command Coordination). It may Move or take 1 Command Action.');
check('lists, slashes, pages and card codes go', [
  terse('Both players roll (6.3.2, FAQ J5).'), terse('No reroll here (FAQ E6/M13).'), terse('It is spent all the same (p.71).'),
  terse('Yoyu may switch it to Offensive Stance (LPA-22).'), terse('The token waits (ruling I25).')],
  ['Both players roll.', 'No reroll here.', 'It is spent all the same.', 'Yoyu may switch it to Offensive Stance.', 'The token waits.']);
check('a parenthesis that is not a reference stays', [
  terse('Harpy drags Dragoon along (-1 Movement, 1 Command Token consumed).'), terse('Ammo left (3).'), terse('Pick a target (Esc cancels).')],
  ['Harpy drags Dragoon along (-1 Movement, 1 Command Token consumed).', 'Ammo left (3).', 'Pick a target (Esc cancels).']);
check('the teaching voice keeps every word', N.speak('Reboot only (4.1.1).', 'teaching'), 'Reboot only (4.1.1).');

// ---------- one line, one notice ----------
const host = el('div');
host.className = 'pad-notice';
const logged = [];
let undone = 0;
N.configureNotices({ host: () => host, voice: 'terse', onLog: (n) => logged.push(n.text), onUndo: () => { undone++; } });
check('nothing shown, nothing drawn', [host.hidden, host.children.length], [true, 0]);
N.notify({ kind: 'done', text: 'Dune Brawler: Chop.' });
check('a confirmation is not shown, it goes to the log', [host.hidden, logged], [true, ['Dune Brawler: Chop.']]);
N.notify({ kind: 'refused', text: 'Shutdown: Reboot only (4.1.1).' });
const words = () => host.children.find((c) => c.className === 'notice-text')?.textContent;
check('a refusal is shown, in its voice, and the page keeps its own class', [host.hidden, host.className, words()], [false, 'pad-notice notice-line k-refused', 'Shutdown: Reboot only.']);
check('the line announces itself politely', [host.attrs.role, host.attrs['aria-live']], ['status', 'polite']);
N.notify({ kind: 'event', text: '<img src=x onerror=alert(1)> switches to Defensive Stance' });
check('the newest replaces the last, and its text is only ever text',
  [host.className, words(), host.children.every((c) => ['SPAN', 'BUTTON'].includes(c.tagName))],
  ['pad-notice notice-line k-event', '<img src=x onerror=alert(1)> switches to Defensive Stance', true]);

// ---------- Undo only while it still means what it says ----------
let latest = true;
N.notify({ kind: 'event', text: 'Dragoon switches to Defensive Stance', undo: () => latest });
const undoBtn = () => host.children.find((c) => c.className === 'notice-undo');
check('an event that can still be taken back offers Undo', !!undoBtn(), true);
latest = false;
undoBtn().click();
check('pressed after a later move, it takes back nothing', [undone, host.hidden], [0, true]);
latest = true;
N.notify({ kind: 'event', text: 'Dragoon switches to Offensive Stance', undo: () => latest });
undoBtn().click();
check('pressed while it is still the last move, it undoes', undone, 1);
N.notify({ kind: 'event', text: 'Old news', undo: () => false });
check('and one that can no longer be undone never shows the button', !!undoBtn(), false);

// ---------- how long it stays ----------
timers = [];
N.notify({ kind: 'warn', text: 'Out of Range, done anyway.' });
check('a line notice times out', [host.hidden, timers.length], [false, 1]);
timers[0]();
check('...and is gone', host.hidden, true);
timers = [];
N.notify({ kind: 'system', text: 'Connection lost. Retrying in 4s.' });
check('a system notice stays until it is cleared', timers.length, 0);
N.clearNotice('warn');
check('clearing another kind leaves it', host.hidden, false);
N.clearNotice('system');
check('clearing its own kind takes it', host.hidden, true);
N.notify({ kind: 'table', text: 'Roll 3 White dice at the table.' });
host.children.find((c) => c.className.includes('notice-x')).click();
check('the dismiss control takes it away', host.hidden, true);

// ---------- a greyed control explains itself (picks 2 and 6) ----------
// A page root and controls that know their parent, enough for closest() and
// contains(); every event is handed straight to the root's listeners, as if
// it had bubbled (or been captured) there.
function ctl(parent, { why, grey = !!why } = {}) {
  const n = Object.assign(Object.create(globalThis.Node.prototype), {
    parent, isConnected: true, dataset: why ? { why } : {}, attrs: grey ? { 'aria-disabled': 'true' } : {},
    closest(sel) {
      for (let x = n; x; x = x.parent) {
        if (sel === '[data-why]' ? x.dataset?.why !== undefined : x.attrs?.['aria-disabled'] === 'true') return x;
      }
      return null;
    },
    contains(o) { for (let x = o; x; x = x.parent) if (x === n) return true; return false; },
  });
  return n;
}
const page = { _h: {}, addEventListener(t, fn) { (this._h[t] ||= []).push(fn); }, contains(o) { for (let x = o; x; x = x.parent) if (x === page) return true; return false; } };
const fire = (type, target, extra = {}) => {
  const e = { target, pointerType: 'mouse', detail: 1, relatedTarget: null, stopped: false, prevented: false,
    preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; }, ...extra };
  for (const fn of page._h[type] ?? []) fn(e);
  return e;
};
const runTimers = () => { const t = timers; timers = []; for (const fn of t) fn(); };
const line = () => (host.hidden ? null : words());
N.explainOnHold(page);
const row = ctl(page, { why: 'This is an Automatic Action, performed in the Automatic Phase without a Command (3.5).' });
const rowName = ctl(row); // the name inside the row, where a finger or pointer actually lands
const live = ctl(page);
timers = [];
N.dismissNotice();

fire('pointerdown', rowName, { pointerType: 'touch' });
runTimers();
check('held, a greyed control says why in the line, in the line\'s voice',
  line(), 'This is an Automatic Action, performed in the Automatic Phase without a Command.');
N.dismissNotice();
fire('pointerdown', rowName, { pointerType: 'touch' });
fire('pointerup', rowName, { pointerType: 'touch' });
runTimers();
check('a quick tap says nothing', line(), null);
const tap = fire('click', rowName, { pointerType: 'touch', detail: 1 });
check('...and never reaches the page\'s own handler', [tap.prevented, tap.stopped, line()], [true, true, null]);
const key = fire('click', rowName, { detail: 0 });
check('Enter or Space on it is deliberate, so it is answered with the reason',
  [key.stopped, line()], [true, 'This is an Automatic Action, performed in the Automatic Phase without a Command.']);
N.dismissNotice();
const ok = fire('click', live);
check('a live control is left alone', [ok.prevented, ok.stopped, line()], [false, false, null]);

timers = [];
fire('pointerover', rowName);
fire('pointerover', row);
check('a mouse resting on it waits once, however it moves inside', timers.length, 1);
runTimers();
check('...then says why in the line', line(), 'This is an Automatic Action, performed in the Automatic Phase without a Command.');
N.dismissNotice();
fire('pointerover', live);
fire('pointerover', rowName);
fire('pointerout', rowName, { relatedTarget: live });
runTimers();
check('a pointer sweeping past says nothing', line(), null);
fire('pointerover', live);
fire('pointerover', rowName, { pointerType: 'touch' });
runTimers();
check('a finger is not a hover: only the hold explains on a phone', line(), null);
N.notify({ kind: 'warn', text: 'Made anyway, as a house rule.', undo: () => true });
timers = []; // its own 6s dismissal is not what is under test
fire('pointerover', live);
fire('pointerover', rowName);
runTimers();
check('a hover never talks over a notice whose Undo is still live', line(), 'Made anyway, as a house rule.');
fire('pointerdown', rowName, { pointerType: 'touch' });
runTimers();
check('...but a long press is deliberate, and does', line(), 'This is an Automatic Action, performed in the Automatic Phase without a Command.');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

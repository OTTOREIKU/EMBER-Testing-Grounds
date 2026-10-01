// The one account screen (OTTO, 2026-10-01: "a unified account screen that
// every app can link and open to keep it all one shared style"), with the two
// controls the security audit added: signing out everywhere, and deleting the
// account. The real account.ts and dialog.ts, run against a DOM small enough
// to drive and honest enough to trust: real markup parsing, real listeners.
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The account screen\n');

// ---------- the page ----------
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.attrs = new Set();
    this._html = '';
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.parent = null;
  }
  set innerHTML(v) { this._html = v; this.children = parse(v, this); }
  get innerHTML() { return this._html; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
  addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); }
  removeEventListener(k, fn) { this.listeners[k] = (this.listeners[k] ?? []).filter((f) => f !== fn); }
  dispatch(k, ev = {}) { for (const fn of this.listeners[k] ?? []) fn({ target: this, ...ev }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() {}
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    if (sel.includes(' ')) {
      const [a, b] = sel.split(/\s+/);
      return this.all().filter((c) => c.matches(b) && c.ancestor(a));
    }
    return this.all().filter((c) => c.matches(sel));
  }
  matches(sel) {
    if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1));
    if (sel.startsWith('[') && sel.endsWith(']')) return this.attrs.has(sel.slice(1, -1));
    return this.tagName === sel.toUpperCase();
  }
  ancestor(sel) { let p = this.parent; while (p) { if (p.matches(sel)) return true; p = p.parent; } return false; }
  // Everything a reader would see: this element's own text and its children's.
  get text() { return [this.textContent, ...this.children.map((c) => c.text)].join(' ').replace(/\s+/g, ' ').trim(); }
}

function parse(html, parent) {
  const roots = [];
  const stack = [];
  const re = /<(\/?)(\w+)([^>]*?)(\/?)>/g;
  let m;
  let last = 0;
  const text = (upto) => {
    const t = html.slice(last, upto);
    if (t.trim() && stack.length) stack[stack.length - 1].textContent += t;
    last = upto;
  };
  while ((m = re.exec(html))) {
    text(m.index);
    last = re.lastIndex;
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { stack.pop(); continue; }
    const el = new El(tag);
    for (const a of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      if (a[1] === 'class') el.className = a[2] ?? '';
      else {
        el.attrs.add(a[1]);
        if (a[1] === 'hidden') el.hidden = true;
        if (a[1].startsWith('data-') && a[2] !== undefined) {
          el.dataset[a[1].slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = a[2];
        }
      }
    }
    const top = stack[stack.length - 1];
    if (top) { el.parent = top; top.children.push(el); } else { el.parent = parent; roots.push(el); }
    if (!selfClose && !/^(br|img|input|hr)$/i.test(tag)) stack.push(el);
  }
  return roots;
}

const body = new El('body');
const keys = [];
globalThis.document = {
  createElement: (t) => new El(t),
  body,
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  addEventListener: (k, fn) => { if (k === 'keydown') keys.push(fn); },
  removeEventListener: (k, fn) => { const i = keys.indexOf(fn); if (i >= 0) keys.splice(i, 1); },
};
globalThis.window = { setTimeout: (fn) => setTimeout(fn, 1), clearTimeout };
const pressEscape = () => { for (const fn of [...keys]) fn({ key: 'Escape', stopPropagation() {}, preventDefault() {} }); };
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
// The dialogs on screen, bottom to top; the account screen is the one tagged.
const dialogs = () => body.children.filter((c) => c.matches('.dlg-back'));
const screen = () => dialogs().find((d) => d.matches('.acc-back')) ?? null;
const top = () => dialogs().at(-1) ?? null;
const hook = (name) => screen()?.querySelector(`[data-acc-${name}]`) ?? null;
const noticeOf = () => { const n = hook('notice'); return n && !n.hidden ? [n.className.replace('acc-notice ', ''), n.textContent] : null; };

// ---------- the real modules ----------
const entry = new URL('./_accountscreen.entry.ts', import.meta.url);
const out = new URL('./_accountscreen.bundle.mjs', import.meta.url);
writeFileSync(entry, "export { openAccount } from '../src/account';\n");
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  loader: { '.css': 'empty' },
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const { openAccount } = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);

// An account, and a server that remembers what it was asked.
function fakeApi(user, fails = {}) {
  const calls = [];
  const act = (name) => async (...args) => {
    calls.push([name, ...args]);
    if (fails[name]) throw Object.assign(new Error(fails[name]), { issues: [] });
  };
  return {
    calls,
    user,
    myRecord: async () => ({ record: { played: 12, won: 7, drawn: 1, lost: 4 }, recent: [], reported: 12 }),
    passwordCheck: async () => ({ ok: true, score: 3, issues: [] }),
    changePassword: act('changePassword'),
    logout: act('logout'),
    logoutEverywhere: act('logoutEverywhere'),
    deleteAccount: act('deleteAccount'),
  };
}
const player = { id: 7, username: 'Marrow', displayName: null, role: 'player' };
let gone = 0;
const openFor = (api) => { gone = 0; openAccount({ api, onGone: () => { gone += 1; } }); };

// ---------- what it shows ----------
let api = fakeApi(player);
openFor(api);
await tick();
check('it opens as a house dialog, closed by the house control',
  [!!screen(), !!screen()?.querySelector('.dlg-close'), screen()?.querySelector('.dlg-panel')?.attrs.has('role')], [true, true, true]);
check('it names the account and its role', [screen().querySelector('.acc-who').text], ['Marrow player']);
check('and shows the record once it arrives', [hook('record').hidden, hook('record').textContent], [false, '12 played · 7 won · 1 drawn · 4 lost']);
check('one screen holds the password, both sign-outs and the delete',
  ['change', 'out', 'out-all', 'delete', 'cur', 'new', 'del-pass'].map((h) => !!hook(h)), [true, true, true, true, true, true, true]);
pressEscape();
check('Escape closes it and ends nothing', [!!screen(), gone, api.calls], [false, 0, []]);

// ---------- the password ----------
api = fakeApi(player);
openFor(api);
hook('change').click();
await tick();
check('an empty password change is refused on the screen, and nothing is sent', [noticeOf(), api.calls], [['error', 'Fill in both password boxes.'], []]);
hook('cur').value = 'old-one';
hook('new').value = 'New-Horse-42!';
hook('change').click();
await tick();
check('a filled one is sent, the boxes are emptied and the screen says so',
  [api.calls, hook('cur').value, hook('new').value, noticeOf()],
  [[['changePassword', 'old-one', 'New-Horse-42!']], '', '', ['ok', 'Password changed. Every other device has been signed out.']]);
check('and it stays open: nobody was signed out here', [!!screen(), gone], [true, 0]);
pressEscape();

api = fakeApi(player, { changePassword: 'Your current password is not correct.' });
openFor(api);
hook('cur').value = 'wrong';
hook('new').value = 'New-Horse-42!';
hook('change').click();
await tick();
check('a refusal is said in the server\'s own words, and the boxes keep what was typed',
  [noticeOf(), hook('cur').value], [['error', 'Your current password is not correct.'], 'wrong']);
pressEscape();

// ---------- signing out ----------
api = fakeApi(player);
openFor(api);
hook('out').click();
await tick();
check('Sign out ends the session here, closes the screen and tells the page', [api.calls, !!screen(), gone], [[['logout']], false, 1]);

api = fakeApi(player);
openFor(api);
hook('out-all').click();
await tick();
check('Sign out everywhere asks for every session to end', [api.calls, !!screen(), gone], [[['logoutEverywhere']], false, 1]);

api = fakeApi(player, { logout: 'Could not reach the server, so you are still signed in. Check the connection and try again.' });
openFor(api);
hook('out').click();
await tick();
check('a sign-out that fails keeps the screen open, says why and tells the page nothing',
  [!!screen(), gone, noticeOf()?.[0], /still signed in/.test(noticeOf()?.[1] ?? '')], [true, 0, 'error', true]);
check('and the buttons work again afterwards', hook('out').disabled, false);
pressEscape();

// ---------- deleting the account ----------
api = fakeApi(player);
openFor(api);
hook('delete').click();
await tick();
check('deleting asks for the password first', [noticeOf(), api.calls, dialogs().length], [['error', 'Enter your password to delete the account.'], [], 1]);
hook('del-pass').value = 'my-password';
hook('delete').click();
await tick();
check('then asks once more, by name, before anything is sent',
  [dialogs().length, top().querySelector('.dlg-title').text, api.calls], [2, 'Delete Marrow?', []]);
top().querySelector('[data-cancel]').click();
await tick();
check('keeping it sends nothing and leaves the screen open', [api.calls, !!screen(), gone], [[], true, 0]);
hook('delete').click();
await tick();
top().querySelector('.dlg-danger').click();
await tick();
check('confirming sends the password, closes the screen and tells the page',
  [api.calls, !!screen(), gone], [[['deleteAccount', 'my-password']], false, 1]);
check('and says the account is gone', top()?.querySelector('.dlg-title')?.text, 'Account deleted');
top().querySelector('.dlg-actions button').click();
await tick();

api = fakeApi(player, { deleteAccount: 'Your password is not correct.' });
openFor(api);
hook('del-pass').value = 'nope';
hook('delete').click();
await tick();
top().querySelector('.dlg-danger').click();
await tick();
check('a wrong password deletes nothing: the screen stays and says so',
  [!!screen(), gone, noticeOf()], [true, 0, ['error', 'Your password is not correct.']]);
pressEscape();

// ---------- an admin, and a hostile name ----------
api = fakeApi({ id: 2, username: 'OTTOREIKU', displayName: null, role: 'admin' });
openFor(api);
check('an admin is offered no delete, and is told why',
  [!!hook('delete'), !!hook('del-pass'), /An admin account cannot be deleted from here\./.test(screen().text)], [false, false, true]);
pressEscape();

api = fakeApi({ id: 9, username: 'x', displayName: '<img src=x onerror=alert(1)>', role: 'player' });
openFor(api);
check('a name is drawn as text, never as markup',
  [screen().querySelectorAll('img').length, /&lt;img src=x onerror=alert\(1\)&gt;/.test(screen().innerHTML)], [0, true]);
pressEscape();

// ---------- where it lives ----------
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const css = src('../src/account.css');
check('its stylesheet keeps the house rules: tokens only, no edges',
  [/#[0-9a-fA-F]{3,8}\b/.test(css), /rgba?\(/.test(css), /\bborder:\s*\d/.test(css)], [false, false, false]);
check('and the module brings its own stylesheet to whichever page opens it', /^import '\.\/account\.css';/m.test(src('../src/account.ts')), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

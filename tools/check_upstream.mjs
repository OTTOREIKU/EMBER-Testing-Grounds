// What has changed in the community builder since our snapshot.
//
//   node tools/check_upstream.mjs            report only
//   node tools/check_upstream.mjs --json     machine-readable, for diffing runs
//
// The builder site is where data/cards.json came from and where every image
// under assets/ was downloaded from, and its author publishes no changelog —
// every commit message is "[fix]". So the only way to know whether a release
// has landed upstream is to fetch what he is serving now and compare it.
//
// Two comparisons, both cheap:
//   1. the card database, extracted out of the live JS bundle
//   2. the res/ image folders, listed through the GitHub API
//
// What it found on 2026-08-10: 412 cards upstream against our 401, 17 entries we
// do not hold (the Centaur SK kit and a GoF wave, added 8-9 August), 3 gone, and
// 130 field disagreements - nearly all of them GoF, and nearly all of them US
// being stale. He tracks the publisher's **1.021** GoF revision; our data and
// the championship xlsx we audit against are **1.02**, and 1.021 repriced every
// GoF torso and chassis. Read a disagreement as "which revision is each side
// on", not as "who is wrong".
//
// Three things this has to get right, all of them learned the hard way:
//
//   * The minifier RENAMES the enum variables between builds (`ge`→`_e` for
//     keywords, `ve`→`Me` for boxes, and it will move again). Nothing here
//     refers to them by name: the card literals are evaluated inside a `with`
//     block over a proxy that answers to any identifier, so a rename is
//     invisible.
//   * Our data is cards.json PLUS the override files, and the overrides are
//     where every correction we have made lives. Comparing raw cards.json to
//     upstream reports each of our own fixes as an upstream difference — about
//     sixty false positives last time. This applies them first.
//   * A field upstream simply does not record (a missing range, a blank name)
//     is not a disagreement, it is a gap. Those are counted separately, since
//     they are usually us being ahead rather than him having changed anything.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://watermelon02.github.io/builder-web/';
const REPO = 'https://api.github.com/repos/watermelon02/builder-web/contents';
const asJson = process.argv.includes('--json');

// `held` collects every `id.field` we have deliberately set in an override file,
// so the report can say which side of a disagreement we chose on purpose. It
// does NOT mean we are right: an override records the best source we had AT THE
// TIME, and the publisher issues revisions. Check the version, not just the tag.
const held = new Set();

const say = (...a) => { if (!asJson) console.log(...a); };

// ---------- our side, with the overrides applied ----------

function loadOurs() {
  const read = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
  const raw = read('cards.json');
  const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
  const stats = read('stat_overrides.json').cards ?? {};
  const acts = read('action_overrides.json').actions ?? {};
  const names = read('name_overrides.json');
  for (const c of cards) {
    const s = stats[c.id];
    if (s) {
      Object.assign(c, s);
      for (const k of Object.keys(s)) held.add(`${c.id}.${k}`);
    }
    const n = (names.cards ?? {})[c.id];
    if (n?.en) { c.name = { ...c.name, en: n.en }; held.add(`${c.id}.name.en`); }
    for (const a of c.actions ?? []) {
      const fix = acts[a.id];
      if (fix) {
        for (const [k, v] of Object.entries(fix)) {
          if (k.startsWith('_')) continue;
          if (k === 'name' && v && typeof v === 'object') a.name = { ...a.name, ...v };
          else a[k] = v;
          held.add(`${a.id}.${k === 'name' ? 'name.en' : k}`);
        }
      }
      const an = (names.actions ?? {})[a.id];
      if (an?.en) { a.name = { ...a.name, en: an.en }; held.add(`${a.id}.name.en`); }
    }
  }
  return cards;
}

// ---------- upstream: the live bundle ----------

async function fetchText(url, what) {
  const r = await fetch(url, { headers: { 'user-agent': 'ember-testing-grounds-check' } });
  if (!r.ok) throw new Error(`${what}: HTTP ${r.status}`);
  return r.text();
}

async function fetchBundle() {
  const html = await fetchText(SITE, 'site');
  const m = /src="([^"]*assets\/index[^"]*\.js)"/.exec(html);
  if (!m) throw new Error('could not find the bundle script tag in index.html');
  const url = new URL(m[1], SITE).href;
  say(`bundle: ${basename(url)}`);
  return { url, js: await fetchText(url, 'bundle') };
}

// A string/template-aware scan for the matching bracket.
function balanced(text, start) {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0, i = start, inStr = null;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') inStr = c;
    else if (c === open || (open === '[' && c === '{') || (open === '{' && c === '[')) depth++;
    else if (c === close || (open === '[' && c === '}') || (open === '{' && c === ']')) {
      if (--depth === 0) return text.slice(start, i + 1);
    }
    i++;
  }
  throw new Error('unbalanced');
}

// Answers to any identifier the minified card literals reach for, and records
// what was asked of it — so `<enum>.RDL_CORE` comes back as "RDL_CORE" whatever
// the enum ended up being called this build.
//
// The leaf has to be CALLABLE as well as indexable: the card literals build
// their parameterised keywords through a helper, `<helper>(<enum>.VolleyX, 2)`,
// and a plain object proxy throws "is not a function" there — which silently
// dropped four whole arrays, every GoF card among them, and made it look like
// upstream had deleted the faction.
function scopeProxy() {
  const leaf = (path) => {
    const target = function () {};
    return new Proxy(target, {
      get: (t, p) => (p === '__ref' ? path : typeof p === 'symbol' ? Reflect.get(t, p) : leaf(`${path}.${String(p)}`)),
      apply: () => leaf(`${path}()`),
      construct: () => leaf(`new ${path}`),
    });
  };
  return new Proxy(Object.create(null), {
    has: () => true,
    get: (_, p) => (p === Symbol.unscopables ? undefined : leaf(String(p))),
  });
}

function extractCards(js) {
  const out = new Map();
  for (const m of js.matchAll(/([\w$]{1,5})=\[\{id:"/g)) {
    const start = m.index + m[1].length + 1;
    let src;
    try { src = balanced(js, start); } catch { continue; }
    if (!/containedIn|score/.test(src) && !(/armor:/.test(src) && /actions:/.test(src))) continue;
    let arr;
    try {
      arr = new Function('__s', `with (__s) { return ${src}; }`)(scopeProxy());
    } catch { continue; }
    if (!Array.isArray(arr)) continue;
    for (const c of arr) if (c && typeof c.id === 'string' && !out.has(c.id)) out.set(c.id, c);
  }
  return out;
}

// ---------- the comparison ----------

// Only fields that are plain literals in the bundle. Keywords are enum
// references and are compared by name elsewhere; anything derived is skipped.
const CARD_FIELDS = ['score', 'armor', 'structure', 'parray', 'dodge', 'electronic', 'move', 'type', 'stance', 'flyingOrElevated'];
const ACTION_FIELDS = ['type', 'speed', 'size', 'range', 'storage', 'yellowDice', 'redDice'];

// Anything that is not a plain scalar is a reference into an enum we did not
// resolve, so it is not comparable and counts as absent.
const blank = (v) => v === undefined || v === null || v === '' || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean');

function compare(ours, theirs) {
  const byId = new Map(ours.map((c) => [c.id, c]));
  const label = (c) => (c?.name?.en || c?.name?.zh || '').replace(/\s+/g, ' ').trim();
  const added = [...theirs.keys()].filter((id) => !byId.has(id)).map((id) => `${id}  ${label(theirs.get(id))}`);
  const removed = [...byId.keys()].filter((id) => !theirs.has(id)).map((id) => `${id}  ${label(byId.get(id))}`);
  const changed = [];
  const gaps = [];
  for (const [id, up] of theirs) {
    const mine = byId.get(id);
    if (!mine) continue;
    for (const f of CARD_FIELDS) {
      const a = mine[f], b = up[f];
      if (blank(b) && !blank(a)) { gaps.push(`${id}.${f}: upstream has none, we have ${JSON.stringify(a)}`); continue; }
      if (blank(b) || a === b) continue;
      changed.push({ id, field: f, ours: a, theirs: b });
    }
    const mineActs = new Map((mine.actions ?? []).map((a) => [a.id, a]));
    for (const ua of up.actions ?? []) {
      const ma = mineActs.get(ua.id);
      if (!ma) { added.push(`${ua.id}  (new action on ${id}) ${(ua.name?.en || ua.name?.zh || '').trim()}`); continue; }
      for (const f of ACTION_FIELDS) {
        const a = ma[f], b = ua[f];
        if (blank(b) && !blank(a)) { gaps.push(`${ua.id}.${f}: upstream has none, we have ${JSON.stringify(a)}`); continue; }
        if (blank(b) || a === b) continue;
        // A range of 0 upstream on something that shoots is the community data
        // not recording one, not a claim that the range IS zero.
        if (f === 'range' && b === 0 && a > 0) { gaps.push(`${ua.id}.range: upstream 0, we have ${a}`); continue; }
        changed.push({ id: ua.id, field: f, ours: a, theirs: b });
      }
      const un = ua.name?.en, mn = ma.name?.en;
      if (un && mn && un.trim() !== mn.trim()) changed.push({ id: ua.id, field: 'name.en', ours: mn, theirs: un });
    }
    const un = up.name?.en, mn = mine.name?.en;
    if (un && mn && un.trim() !== mn.trim()) changed.push({ id, field: 'name.en', ours: mn, theirs: un });
  }
  return { added, removed, changed, gaps };
}

// ---------- the images ----------

const FOLDERS = [
  { remote: 'res/tab', local: 'assets/tokens/tab' },
  { remote: 'res/en', local: 'assets/cards/en' },
  { remote: 'res/mech_part', local: 'assets/mech_parts' },
];

async function checkImages() {
  const rows = [];
  for (const f of FOLDERS) {
    const dir = join(ROOT, f.local);
    if (!existsSync(dir)) { rows.push({ ...f, error: 'no local folder' }); continue; }
    let listing;
    try {
      listing = JSON.parse(await fetchText(`${REPO}/${f.remote}`, f.remote));
    } catch (e) { rows.push({ ...f, error: e.message }); continue; }
    if (!Array.isArray(listing)) { rows.push({ ...f, error: 'unexpected API reply' }); continue; }
    const up = new Set(listing.filter((x) => x.type === 'file').map((x) => basename(x.name, extname(x.name))).filter((n) => !n.startsWith('.')));
    const ours = new Set(readdirSync(dir).map((n) => basename(n, extname(n))));
    rows.push({ ...f, missing: [...up].filter((n) => !ours.has(n)).sort(), extra: [...ours].filter((n) => !up.has(n)).sort() });
  }
  return rows;
}

// ---------- report ----------

const ours = loadOurs();
const { url, js } = await fetchBundle();
const theirs = extractCards(js);
say(`upstream cards: ${theirs.size}   ours: ${ours.length}`);
if (theirs.size < 100) throw new Error('extracted too few cards — the bundle shape has changed, fix the extractor');

const data = compare(ours, theirs);
const images = await checkImages();
const cardIds = new Set(ours.map((c) => c.id));
const artNoCard = [];
for (const r of images) for (const n of r.missing ?? []) if (!cardIds.has(n) && !theirs.has(n)) artNoCard.push(`${r.remote}/${n}`);

if (asJson) {
  console.log(JSON.stringify({ bundle: basename(url), upstreamCards: theirs.size, ourCards: ours.length, ...data, images }, null, 1));
} else {
  const list = (title, xs, n = 40) => {
    console.log(`\n${title}: ${xs.length}`);
    for (const x of xs.slice(0, n)) {
      if (typeof x === 'string') { console.log('   ' + x); continue; }
      const ours = held.has(`${x.id}.${x.field}`) ? '   [ours is an override - check which list version it came from]' : '';
      console.log(`   ${x.id}.${x.field}  ours=${JSON.stringify(x.ours)}  upstream=${JSON.stringify(x.theirs)}${ours}`);
    }
    if (xs.length > n) console.log(`   ... and ${xs.length - n} more`);
  };
  list('NEW upstream (not in our data)', data.added);
  list('gone from upstream (still in ours)', data.removed);
  const backed = data.changed.filter((x) => held.has(`${x.id}.${x.field}`)).length;
  list(`disagreements (both sides have a value) - ${backed} on values we set deliberately`, data.changed);
  list('upstream blanks where we hold a value', data.gaps, 12);
  console.log('\nimages');
  for (const r of images) {
    if (r.error) { console.log(`   ${r.remote}: ${r.error}`); continue; }
    console.log(`   ${r.remote} -> ${r.local}: ${r.missing.length} upstream we lack, ${r.extra.length} we hold that upstream dropped`);
    if (r.missing.length) console.log(`      upstream only: ${r.missing.slice(0, 20).join(', ')}`);
    if (r.extra.length) console.log(`      ours only:     ${r.extra.slice(0, 20).join(', ')}`);
  }
  if (artNoCard.length) console.log(`\nart with no card on either side (likely a set being prepared): ${artNoCard.join(', ')}`);
  console.log('\nA disagreement is not automatically a correction, but it is not automatically');
  console.log('noise either. On 2026-08-10 the GoF ones were all US being a revision behind:');
  console.log('he tracks the publisher GoF list 1.021, our data and the championship xlsx are');
  console.log('1.02, and 1.021 repriced every GoF torso and chassis and turned card 180 from');
  console.log('the PL29 Stealth Chassis into the PL29 All-terrain Chassis. Settle each line');
  console.log('against the NEWEST publisher list you hold before deciding either way.');
}

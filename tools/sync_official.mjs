// Check our card data against the publisher's own live database.
//
//   node tools/sync_official.mjs              sweep, using the cache where it can
//   node tools/sync_official.mjs --fresh      ignore the cache and refetch
//   node tools/sync_official.mjs --json       machine-readable
//   node tools/sync_official.mjs --id 101     one card, for a quick check
//   node tools/sync_official.mjs --stubs      re-ask ONLY the known placeholders,
//                                             and print any the publisher has
//                                             filled in since (~40s, not ~5min)
//
// The QR code on the back of a retail box opens
// `obsidianprotocol.net/#/info?id=<n>&lang=en`, which is a thin client over
// this API. It is the company's own database - but it is NOT their newest data,
// and that is the trap this tool exists to avoid walking into.
//
// Check `updated_at` before believing a row. The bulk of these records were
// written on 2025-09-26 and never touched again; card 001's dates from
// 2024-07-30. The championship parts lists are from 2026-08-03 and the GoF
// 1.021 revision is newer still, so **the lists supersede this API**, and a
// difference here usually means the DATABASE is behind, not us. Treat it as a
// cross-check and as the source for cards no list covers, not as an authority.
//
// Three things to know before trusting a row:
//
//   * `main_id` is the numeric QR id, which is our card id without its zero
//     padding. The ~147 cards we hold under a serial-style id (ZHDR-101,
//     PDAM-002) are NOT reachable: the API is keyed by QR id and we do not
//     record theirs.
//   * An id the publisher has not filled in yet answers with a PLACEHOLDER
//     rather than an error - the title reads `预填充数据标题<id>` and the score
//     is 0. Treated as "absent" here; reading one as data would zero a card.
//   * Stats arrive as `entrys`, a list of {title, value} where the value can be
//     compound: Armor/Structure comes back as "4/1".
//
// Be kind to the server: this is a small publisher, so requests are serialised
// with a delay and cached to disk. A full sweep is ~250 requests.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'official');
const API = 'https://api.obsidianprotocol.net/api/component/detail';
const DELAY_MS = 1200;
const STUB = '预填';           // 预填 - the placeholder title prefix
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const fresh = args.includes('--fresh');
const only = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;

const say = (...a) => { if (!asJson) console.log(...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- our data, with the overrides applied ----------

function loadOurs() {
  const read = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
  const raw = read('cards.json');
  const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
  const stats = read('stat_overrides.json').cards ?? {};
  const names = read('name_overrides.json').cards ?? {};
  const held = new Set();
  for (const c of cards) {
    const s = stats[c.id];
    if (s) {
      Object.assign(c, s);
      for (const k of Object.keys(s)) if (!k.startsWith('_')) held.add(`${c.id}.${k}`);
    }
    const n = names[c.id];
    if (n?.en) { c.name = { ...c.name, en: n.en }; held.add(`${c.id}.name`); }
  }
  return { cards, held };
}

// ---------- the publisher ----------

async function fetchCard(id) {
  const file = join(CACHE, `${id}.json`);
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const r = await fetch(`${API}?main_id=${id}&lang=en`, {
    headers: { 'user-agent': 'ember-testing-grounds (fan tool, data check)' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(body));
  await sleep(DELAY_MS);
  return body;
}

const isStub = (d) => typeof d?.title === 'string' && d.title.startsWith(STUB);

// "4/1" -> armor 4, structure 1. A single number is armor alone.
function statsOf(d) {
  const out = {};
  for (const e of d.entrys ?? []) {
    const t = (e.title || '').toLowerCase();
    const v = String(e.value ?? '').trim();
    if (!v) continue;
    if (t.includes('armor')) {
      const [a, s] = v.split('/');
      if (a !== undefined && a !== '') out.armor = Number(a);
      if (s !== undefined && s !== '') out.structure = Number(s);
    } else if (t.includes('dodge')) out.dodge = Number(v);
    else if (t.includes('parry')) out.parray = Number(v);
    else if (t.includes('electronic')) out.electronic = Number(v);
  }
  return out;
}

// ---------- sweep ----------

// ---------- --stubs: has the publisher filled anything in yet? ----------
//
// The recurring question, made cheap. A full sweep re-reads ~250 records to
// answer it; this re-reads ONLY the ids already known to be placeholders and
// prints the ones that have become real. It always fetches fresh, because a
// cached stub answering "still a stub" is the one answer that would be worthless.
//
// Two sources, and the second is the one a plain sweep misses: the cached stub
// ids (cards we hold under a numeric id), plus `qr_ids._pending`, which holds
// correct QR ids for SERIAL-id cards the publisher had not entered — those are
// invisible to the sweep because it only walks numeric card ids.
if (args.includes('--stubs')) {
  const cached = existsSync(CACHE)
    ? readdirSync(CACHE)
        .filter((f) => f.endsWith('.json'))
        .map((f) => Number(f.replace('.json', '')))
        .filter((n) => Number.isInteger(n))
        .filter((n) => {
          try {
            return isStub(JSON.parse(readFileSync(join(CACHE, `${n}.json`), 'utf8'))?.data);
          } catch { return false; }
        })
    : [];
  const pending = JSON.parse(readFileSync(join(ROOT, 'data', 'qr_ids.json'), 'utf8'))._pending ?? {};
  const byId = new Map();
  for (const n of cached) byId.set(n, null);
  for (const [serial, n] of Object.entries(pending)) if (!serial.startsWith('_')) byId.set(Number(n), serial);
  // The id space runs out around 600; beyond that there is nothing to fill in,
  // so those are skipped rather than politely re-asked every time.
  const ids = [...byId.keys()].filter((n) => n <= 600).sort((a, b) => a - b);
  say(`re-checking ${ids.length} known placeholders (fresh, ignoring the cache)`);
  const nowReal = [];
  const errors = [];
  for (const id of ids) {
    try {
      const r = await fetch(`${API}?main_id=${id}&lang=en`, {
        headers: { 'user-agent': 'ember-testing-grounds (fan tool, data check)' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json())?.data;
      if (d && !Array.isArray(d) && !isStub(d)) {
        nowReal.push({ id, serial: byId.get(id), title: (d.title || '').replace(/\s+/g, ' ').trim(), score: d.score, updated: (d.updated_at || '').slice(0, 10) });
      }
    } catch (e) {
      errors.push(`${id}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  if (asJson) console.log(JSON.stringify({ checked: ids.length, nowReal, errors }, null, 1));
  else {
    console.log(`\nchecked: ${ids.length}   errors: ${errors.length}`);
    console.log(`FILLED IN SINCE THEY WERE RECORDED AS PLACEHOLDERS: ${nowReal.length}`);
    for (const n of nowReal) {
      console.log(`  ${String(n.id).padEnd(5)} ${(n.serial ?? '').padEnd(10)} score=${String(n.score).padEnd(5)} updated=${n.updated}  ${n.title.slice(0, 40)}`);
    }
    if (nowReal.length) console.log('\nPromote any of these out of qr_ids._pending, and re-run the full sweep to compare their numbers.');
    else console.log('\nNothing has been filled in. The database has not moved; check again after a publisher release.');
    if (errors.length) console.log(`\nfetch failures: ${errors.slice(0, 5).join(' | ')}`);
  }
  process.exit(0);
}

const { cards, held } = loadOurs();
const numeric = cards.filter((c) => /^\d+$/.test(c.id));
const targets = only ? numeric.filter((c) => c.id === only || c.id === String(Number(only))) : numeric;
say(`checking ${targets.length} of ${cards.length} cards (the rest have serial-style ids and no QR id)`);

const diffs = [];
const partial = [];
const stubs = [];
const missing = [];
const failed = [];
let checked = 0;

for (const c of targets) {
  let body;
  try {
    body = await fetchCard(Number(c.id));
  } catch (e) {
    failed.push(`${c.id}: ${e.message}`);
    continue;
  }
  const d = body?.data;
  if (!d || Array.isArray(d)) { missing.push(c.id); continue; }
  if (isStub(d)) { stubs.push(c.id); continue; }
  checked++;
  const theirs = { score: d.score, ...statsOf(d) };
  // A record can be HALF filled in: real title, points still 0. Zeroing a card
  // we hold at 57 would be silent corruption, so a 0 against a non-zero value of
  // ours is reported as an incomplete row, never as a repricing. (A genuine 0 is
  // a Low Value unit, and we hold those at 0 too, so they never reach here.)
  if (theirs.score === 0 && Number(c.score) > 0) {
    partial.push({ id: c.id, ours: c.score, title: (d.title || '').replace(/[ ]+/g, ' ').trim() });
    delete theirs.score;
  }
  const title = (d.title || '').replace(/\s+/g, ' ').trim();
  const ourName = (c.name?.en || c.name?.zh || '').replace(/\s+/g, ' ').trim();
  for (const [field, val] of Object.entries(theirs)) {
    if (val === undefined || val === null || Number.isNaN(val)) continue;
    const mine = c[field];
    if (mine === undefined || mine === null) continue;
    if (Number(mine) === Number(val)) continue;
    diffs.push({ id: c.id, field, ours: mine, official: val, title, updated: (d.updated_at || '').slice(0, 10), overridden: held.has(`${c.id}.${field}`) });
  }
  if (!asJson && checked % 25 === 0) console.log(`  ... ${checked} checked, ${diffs.length} differences so far`);
}

if (asJson) {
  console.log(JSON.stringify({ checked, diffs, partial, stubs, missing, failed }, null, 1));
} else {
  console.log(`\nchecked against the publisher: ${checked}`);
  console.log(`not filled in there yet (placeholder rows): ${stubs.length}${stubs.length ? ' -> ' + stubs.slice(0, 30).join(', ') : ''}`);
  if (missing.length) console.log(`no record at all: ${missing.length} -> ${missing.slice(0, 30).join(', ')}`);
  if (failed.length) console.log(`fetch failures: ${failed.length} -> ${failed.slice(0, 5).join(' | ')}`);
  if (partial.length) {
    console.log(`\nincomplete upstream rows (real title, points still 0) - IGNORED, do not copy: ${partial.length}`);
    for (const p of partial) console.log(`  ${p.id.padEnd(6)} ours=${String(p.ours).padEnd(5)} ${p.title.slice(0, 44)}`);
  }
  console.log(`\nDIFFERENCES: ${diffs.length}`);
  const byField = {};
  for (const d of diffs) byField[d.field] = (byField[d.field] ?? 0) + 1;
  console.log('  by field:', JSON.stringify(byField));
  for (const d of diffs) {
    console.log(`  ${d.id.padEnd(6)} ${d.field.padEnd(10)} ours=${String(d.ours).padEnd(5)} official=${String(d.official).padEnd(5)} db-updated=${(d.updated || '?').padEnd(10)} ${d.overridden ? '[we set this deliberately] ' : ''}${d.title.slice(0, 34)}`);
  }
  console.log('\nA difference here is NOT a correction to make. Most of these records were last');
  console.log('written on 2025-09-26 and the championship parts lists are from 2026-08-03, so');
  console.log("the usual explanation is that the database is behind. Check each row's updated_at");
  console.log('against the newest list for that faction - see Project-Documents/research/source-versions.md.');
}

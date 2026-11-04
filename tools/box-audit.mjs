// Box audit: what each assembly PDF builds (data/box_sprues.json) against the
// cards our box data says are in the box (cards.json containedIn, the `box`
// field pilots carry, then box_contents_overrides.json, the same order the app
// loads them in). OTTO, 2026-11-04: "This should be another check we run on all
// the boxes. We can see if we are missing any other cards if they are listed in
// the PDF". Read-only: prints a report and changes nothing.
//
//   node tools/box-audit.mjs            plain-text report
//   node tools/box-audit.mjs --md       the same, as Markdown
import { readFileSync, writeFileSync } from 'node:fs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const md = process.argv.includes('--md');
const trackerAt = process.argv.indexOf('--tracker');
const trackerPath = trackerAt > 0 ? process.argv[trackerAt + 1] : null;

const cards = [...read('cards.json'), ...Object.values(read('cards_extra.json')).flat()].filter((c) => c && c.id);
const byId = new Map(cards.map((c) => [c.id, c]));
const sprues = read('box_sprues.json').boxes;
const patch = read('box_contents_overrides.json').boxes ?? {};
const boxDefs = read('boxes.json');
const boxList = Array.isArray(boxDefs) ? boxDefs : boxDefs.boxes ?? Object.values(boxDefs);
const boxName = new Map(boxList.filter((b) => b && b.key).map((b) => [b.key, b.name?.en || b.key]));

// Box contents, as the app builds them.
const contents = {};
const put = (box, id, n) => ((contents[box] ??= {})[id] = n);
for (const c of cards) {
  const list = c.containedIn?.length ? c.containedIn : c.box ? [{ box: c.box, quantityPerBox: 1 }] : [];
  for (const e of list) if (!patch[e.box]) put(e.box, c.id, e.quantityPerBox);
}
for (const [box, def] of Object.entries(patch)) for (const [id, n] of Object.entries(def.cards ?? {})) put(box, id, n);

// A Discard card is "<name> (D)" (one prints a stray full-width bracket after
// it); map it to its front.
const DISCARD = /\s*[(（]d[)）]+\s*$/i;
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const frontByName = new Map();
for (const c of cards) if (!DISCARD.test(c.name?.en ?? '')) frontByName.set(norm(c.name?.en), c.id);
const frontOf = (id) => {
  const en = byId.get(id)?.name?.en ?? '';
  return DISCARD.test(en) ? frontByName.get(norm(en.replace(DISCARD, ''))) : undefined;
};
// Some cards carry Chinese in the English slot; the name override (if any) wins.
const names = read('name_overrides.json');
const nameOf = (id) => {
  const o = names[id] ?? names.cards?.[id];
  return (typeof o === 'string' ? o : o?.en) ?? byId.get(id)?.name?.en ?? '?';
};
const label = (id) => `${id} ${nameOf(id).replace(/\s+/g, ' ').trim()}`;
const noModel = (id) => /^(pilot|tactics)/.test(byId.get(id)?.category ?? '');

const out = [];
const audit = {}; // per box: the numbers and the questions, for --tracker
const say = (s = '') => out.push(s);
say(md ? '' : 'BOX AUDIT: assembly PDFs against our box card lists');

for (const [key, sp] of Object.entries(sprues)) {
  const have = contents[key] ?? {};
  // What the PDF builds, per card: the most you can have at once.
  const built = {};
  const inChoice = {};
  for (const b of sp.builds ?? []) {
    if (!b.card || b.extra) continue;
    built[b.card] = Math.max(built[b.card] ?? 0, b.count ?? 0);
  }
  for (const ch of sp.choices ?? []) {
    for (const code of ch.of) {
      const b = (sp.builds ?? []).find((x) => x.code === code);
      if (b?.card) inChoice[b.card] = Math.max(inChoice[b.card] ?? 0, ch.count ?? 1);
    }
  }
  const backer = new Set(Object.keys(sp.crowdfunding?.cards ?? {}));
  for (const b of sp.crowdfunding?.builds ?? []) if (b.card) backer.add(b.card);

  const missing = [];
  const extra = [];
  const counts = [];
  const q = {};
  audit[key] = { have, built, inChoice, backer, q };
  for (const [id, n] of Object.entries(built)) {
    const most = Math.max(n, inChoice[id] ?? 0);
    if (!(id in have)) missing.push(`${label(id)} (PDF builds ${most || 'one, as a choice'})`), (q[id] = 'Built in the PDF, not in our box data');
    else if (n > 0 && have[id] !== n) counts.push(`${label(id)}: PDF ${n}, our data ${have[id]}`), (q[id] = `PDF builds ${n}, we list ${have[id]}`);
    else if (n === 0 && have[id] > most) counts.push(`${label(id)}: PDF ${most} at most (a choice), our data ${have[id]}`), (q[id] = `PDF builds ${most} at most, we list ${have[id]}`);
  }
  for (const [id, n] of Object.entries(have)) {
    if (id in built || noModel(id) || backer.has(id)) continue;
    const f = frontOf(id);
    if (f && f in built) {
      if (!(f in have)) missing.push(`${label(f)} (its Discard ${id} is listed but not the card)`), (q[f] = 'Its Discard is listed but not the card');
      continue;
    }
    extra.push(`${label(id)} x${n}`);
    q[id] = 'In our box data, no build in the PDF';
  }
  // Discards of built cards that our data lacks.
  for (const id of Object.keys(built)) {
    const d = cards.find((c) => frontOf(c.id) === id);
    if (d && id in have && !(d.id in have)) missing.push(`${label(d.id)} (the Discard of a card that is listed)`), (q[d.id] = 'Discard of a listed card, not in our box data');
  }

  const head = `${boxName.get(key) ?? key} (${key})${patch[key] ? ', checked against OTTO\'s own card list' : ''}`;
  say(md ? `### ${head}` : `\n== ${head}`);
  if (!missing.length && !extra.length && !counts.length) {
    say(md ? '\nAll match.' : '  all match');
    continue;
  }
  const block = (title, rows) => {
    if (!rows.length) return;
    say(md ? `\n**${title}:**\n` : `  ${title}:`);
    for (const r of rows) say(md ? `- ${r}` : `    - ${r}`);
  };
  block('Built in the PDF, missing from our box data', missing);
  block('In our box data, no build in the PDF', extra);
  block('Count differences', counts);
  say();
}
const notDone = [...boxName.keys()].filter((k) => !sprues[k]);
say(md ? `\n**Not catalogued yet:** ${notDone.join(', ')}` : `\nNot catalogued yet: ${notDone.join(', ')}`);
if (trackerPath) writeTracker(trackerPath);
else console.log(out.join('\n'));

// --tracker <file>: write the card-confirmation tracker (OTTO, 2026-11-04:
// "Lets create a document to start tracking what cards I can confirm with the
// boxes"). One table per box: every card our box data lists plus every card the
// PDF builds. Run it again after the data changes: rows already in the file keep
// their "OTTO's count", "Status" and "Note" cells, so nothing he filled in is lost.
function writeTracker(file) {
  const kept = new Map();
  try {
    let section = '';
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.startsWith('## ')) section = line.slice(3).trim();
      const m = line.match(/^\| (\S+) \|(.*)\|$/);
      if (!m || m[1] === 'Card' || /^-+$/.test(m[1])) continue;
      const cells = m[2].split(' | ').map((s) => s.trim());
      kept.set(`${section}|${m[1]}`, cells.slice(-3));
    }
  } catch {
    /* first run */
  }

  // First-run statuses, from what OTTO has already checked against his boxes.
  const seed = (key, id) => {
    if (noModel(id) && !(key === 'COMBAT_RAID' && id in (patch[key]?.cards ?? {}))) return ['Unconfirmed', ''];
    if (key === 'COMBAT_RAID' && id in (patch[key]?.cards ?? {}))
      return ['Confirmed', 'OTTO\'s card-by-card list of his box, 2026-08-18'];
    if (key === 'UN_DOORBREAKER' && id in (patch[key]?.cards ?? {}))
      return ['Confirmed', 'OTTO\'s list of his box, 2026-11-04'];
    if (key === 'SINGLE_UN_TAURUS' && ['104', '105', '142', '143'].includes(id))
      return ['Confirmed', 'OTTO 2026-11-04: "Taurus has the normal S100 + discard and the R7 and Discard"'];
    if (key === 'SINGLE_UN_TAURUS' && id === '097') return ['Confirmed', 'OTTO, from his box, 2026-09-26'];
    return ['Unconfirmed', ''];
  };
  const sideOf = (id) => {
    const c = byId.get(frontOf(id) ?? id);
    if (/^FPA/.test(id)) return 'RDL';
    if (/^LPA/.test(id)) return 'UN';
    if (c?.faction) return c.faction.toUpperCase() === 'UN' ? 'UN' : 'RDL';
    const n = Number(c?.id);
    return (n >= 1 && n <= 80) || (n >= 532 && n <= 537) ? 'RDL' : 'UN';
  };
  const pdfCell = (a, id) => {
    if (a.built[id] > 0) return String(a.built[id]);
    if (id in a.built) return `either/or, up to ${a.inChoice[id] ?? 1}`;
    const f = frontOf(id);
    if (f && f in a.built) return `Discard of ${f}`;
    if (/^pilot/.test(byId.get(id)?.category ?? '')) return 'pilot';
    if (noModel(id)) return 'no model';
    return 'not built';
  };

  const lines = [];
  const L = (s = '') => lines.push(s);
  L('# Box confirmations: which cards are really in each box');
  L();
  L('OTTO, 2026-11-04: "Lets create a document to start tracking what cards I can confirm with the boxes."');
  L();
  L('**How to use it.** Each box has a table of every card our data says is in it, plus every card its assembly PDF builds. When you check a card against your physical box, write the number you found under **OTTO\'s count** and set **Status** to `Confirmed`, or to `Question` if something is off, with a word in **Note**. Claude then updates the box data (`TestingGrounds/data/box_contents_overrides.json`) from this file.');
  L();
  L('- **Our count:** how many our box data lists (— means none).');
  L('- **PDF builds:** how many the assembly PDF builds, or "Discard of …" for a Discard card. "either/or, up to N" means the build is one side of a printed choice, so N is the most you can have.');
  L('- **Status:** `Confirmed` means checked against a physical box. `Question` means the PDF and our data disagree (from `BOX-AUDIT.md`). `Unconfirmed` means not checked yet.');
  L();
  L('The tables are regenerated with `node tools/box-audit.mjs --tracker "../Project-Documents/research/box-catalogue/BOX-CONFIRMATIONS.md"` (run from TestingGrounds). A row that is already here keeps its OTTO\'s count, Status and Note.');
  L();
  L('**Print check:** Achillain\'s copies of UN Core and Door Breaker show a different print of the general sprues: UN Core with SD ×6 (Queti\'s retail book: SD ×8) and Door Breaker with SC ×2 (retail: SC ×3). Counting the SD sprues in your Core and the SC sprues in your Door Breaker will show which print you have.');

  const table = (title, key, ids, a, backer = false) => {
    L();
    L(`## ${title}`);
    L();
    L('| Card | Name | Our count | PDF builds | OTTO\'s count | Status | Note |');
    L('|---|---|---|---|---|---|---|');
    for (const id of ids) {
      const ours = backer ? String(sprues[key].crowdfunding.cards[id] ?? '—') : String(a.have[id] ?? '—');
      const pdf = backer ? (frontOf(id) ? `Discard of ${frontOf(id)}` : '1') : pdfCell(a, id);
      let [status, note] = seed(key, id);
      if (backer) [status, note] = key.startsWith('UN') ? ['Question', 'Which box did the backer sprue come with? Placed here by card number only'] : ['Unconfirmed', '2019 backer copies only'];
      else if (a.q[id] && status !== 'Confirmed') [status, note] = ['Question', a.q[id]];
      else if (a.q[id]) [status, note] = [/^PDF builds/.test(a.q[id]) ? 'Question' : status, `${note}; ${a.q[id]}`];
      const old = kept.get(`${title}|${id}`);
      const [otto, st, nt] = old ?? ['', status, note];
      L(`| ${id} | ${nameOf(id).replace(/\s+/g, ' ').replace(/\|/g, '/').trim()} | ${ours} | ${pdf} | ${otto} | ${st} | ${nt} |`);
    }
  };
  const order = (ids) =>
    [...ids].sort((x, y) => {
      const p = (id) => (/^[A-Z]PA/.test(id) ? 1 : 0);
      return p(x) - p(y) || (frontOf(x) ?? x).localeCompare(frontOf(y) ?? y) || (frontOf(x) ? 1 : 0) - (frontOf(y) ? 1 : 0);
    });

  for (const [key, sp] of Object.entries(sprues)) {
    const a = audit[key];
    const ids = new Set([...Object.keys(a.have), ...Object.keys(a.built), ...Object.keys(a.q)]);
    for (const c of cards) {
      const f = frontOf(c.id);
      if (f && f in a.built) ids.add(c.id);
    }
    for (const id of a.backer) ids.delete(id);
    const name = boxName.get(key) ?? key;
    if (key === 'COMBAT_RAID') {
      table(`${name}, RDL side (${key})`, key, order([...ids].filter((i) => sideOf(i) === 'RDL')), a);
      table(`${name}, UN side (${key})`, key, order([...ids].filter((i) => sideOf(i) === 'UN')), a);
    } else table(`${name} (${key})`, key, order(ids), a);
    if (sp.crowdfunding) table(`${name}: crowdfunding (backer) parts (${key})`, key, order(Object.keys(sp.crowdfunding.cards ?? {})), a, true);
  }
  const notDone = [...boxName.keys()].filter((k) => !sprues[k]);
  L();
  L(`**Boxes with no PDF catalogue yet** (no table): ${notDone.join(', ')}.`);
  writeFileSync(file, lines.join('\n') + '\n');
  console.log(`wrote ${file}`);
}

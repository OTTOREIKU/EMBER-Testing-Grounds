const fs = require('fs');
const path = require('path');

const BUNDLE = String.raw`C:\Users\apach\AppData\Local\Temp\claude\E--Samsung-Downloads-Books-Tabletop-EMBER-Obsidian-Protocol\97f5c0b7-47d1-4b45-85b8-b72f142f38bd\scratchpad\builder_bundle.js`;
const OUTDIR = String.raw`E:\ClaudeProjects\Ember Obsidian Protocol\TestingGrounds\data`;
fs.mkdirSync(OUTDIR, { recursive: true });

const t = fs.readFileSync(BUNDLE, 'utf8');

// --- balanced extraction (string/template aware) ---
function extractBalanced(text, start) {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0, i = start, inStr = null;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (inStr === '`' && c === '`') inStr = null;
      else if (c === inStr) inStr = null;
    } else {
      if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === open || (open === '[' && c === '{') || (open === '{' && c === '[')) depth++;
      else if (c === close || (open === '[' && c === '}') || (open === '{' && c === ']')) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    i++;
  }
  throw new Error('unbalanced from ' + start);
}

// --- 1. real enum objects ---
function extractObjDef(varName) {
  const m = t.match(new RegExp(`[^\\w.]${varName}=\\{`));
  if (!m) throw new Error(varName + ' def not found');
  const start = m.index + m[0].length - 1;
  const src = extractBalanced(t, start);
  return new Function('return ' + src)();
}
const geReal = extractObjDef('ge');
const veReal = extractObjDef('ve');
console.log('ge keywords:', Object.keys(geReal).length, '| ve boxes:', Object.keys(veReal).length);

// --- 2. proxies so card literals record enum KEYS ---
const geProxy = new Proxy({}, { get: (_, p) => (typeof p === 'string' ? { __kw: p } : undefined) });
const veProxy = new Proxy({}, { get: (_, p) => (typeof p === 'string' ? p : undefined) });

// --- 3. find & evaluate card arrays ---
const results = [];
const skipped = [];
for (const m of t.matchAll(/([\w$]{1,5})=\[\{id:"/g)) {
  const name = m[1];
  const start = m.index + m[1].length + 1;
  let src;
  try { src = extractBalanced(t, start); } catch (e) { skipped.push([name, 'unbalanced']); continue; }
  const looksLikeCards = /containedIn|score/.test(src) || (/armor:/.test(src) && /actions:/.test(src));
  if (!looksLikeCards) { skipped.push([name, 'not-cards']); continue; }
  const extraNames = [];
  const extraVals = [];
  let arr = null, lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      arr = new Function('ge', 've', ...extraNames, 'return ' + src)(geProxy, veProxy, ...extraVals);
      break;
    } catch (e) {
      lastErr = e;
      const mm = /^(\w+) is not defined/.exec(e.message);
      if (!mm) break;
      const dm = t.match(new RegExp(`[^\\w.$]${mm[1]}=(\\[|\\{)`));
      if (!dm) break;
      const defSrc = extractBalanced(t, dm.index + dm[0].length - 1);
      extraNames.push(mm[1]);
      extraVals.push(new Function('ge', 've', 'return ' + defSrc)(geProxy, veProxy));
    }
  }
  if (!arr) { skipped.push([name, 'eval: ' + lastErr.message.slice(0, 80)]); continue; }
  results.push({ name, index: m.index, arr });
}
console.log('card arrays evaluated:', results.length);
for (const [n, why] of skipped) console.log('  skipped', n, '->', why);

// --- 4. normalize ---
const PART_TYPES = new Set(['torso', 'chasis', 'leftHand', 'rightHand', 'backpack']);
const UNIT_TYPES = new Set(['small', 'medium', 'large']);
function categorize(c) {
  if (c.swift !== undefined || c.LV !== undefined) return 'pilot';
  if (c.type && PART_TYPES.has(c.type)) return 'mech_part';
  if (c.type && UNIT_TYPES.has(c.type)) return 'drone';
  if (c.armor !== undefined && c.score === undefined) return 'projectile';
  if (c.score !== undefined && c.armor === undefined) return 'tactics_or_upgrade';
  return 'unknown';
}
function cleanKeywords(list) {
  if (!Array.isArray(list)) return [];
  return list.map(k => {
    if (k && k.__kw) {
      const def = geReal[k.__kw];
      return { key: k.__kw, en: def?.en?.name ?? null };
    }
    if (k && k.name) return { inline: k.name };
    return { raw: String(k) };
  });
}
const seen = new Map();
let dupes = 0;
for (const { name, arr } of results) {
  for (const c of arr) {
    const card = { ...c };
    card.category = categorize(c);
    card.sourceArray = name;
    card.keywords = cleanKeywords(c.keywords);
    if (Array.isArray(card.actions)) {
      card.actions = card.actions.map(a => ({ ...a, keywords: cleanKeywords(a.keywords) }));
    }
    if (Array.isArray(card.containedIn)) {
      card.containedIn = card.containedIn.map(x => ({ box: x.box, quantityPerBox: x.quantityPerBox }));
    }
    if (seen.has(card.id)) { dupes++; continue; }
    seen.set(card.id, card);
  }
}
const cards = [...seen.values()];
console.log('unique cards:', cards.length, '| duplicate ids skipped:', dupes);

const byCat = {};
for (const c of cards) byCat[c.category] = (byCat[c.category] || 0) + 1;
console.log('by category:', JSON.stringify(byCat));

// --- 5. outputs ---
fs.writeFileSync(path.join(OUTDIR, 'cards.json'), JSON.stringify(cards, null, 1), 'utf8');

const keywords = Object.entries(geReal).map(([key, v]) => ({
  key,
  zh: v.zh ?? null, en: v.en ?? null, jp: v.jp ?? null,
}));
fs.writeFileSync(path.join(OUTDIR, 'keywords.json'), JSON.stringify(keywords, null, 1), 'utf8');

const boxes = Object.entries(veReal).map(([key, v]) => ({ key, ...v }));
fs.writeFileSync(path.join(OUTDIR, 'boxes.json'), JSON.stringify(boxes, null, 1), 'utf8');

console.log('\nsample:', cards.slice(0, 8).map(c => `${c.id}:${c.name?.en || c.name?.zh}`).join(' | '));

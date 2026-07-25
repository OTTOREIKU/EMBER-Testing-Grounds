const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cards.json'), 'utf8'));
const keywords = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'keywords.json'), 'utf8'));
const boxes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'boxes.json'), 'utf8'));
const dice = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dice.json'), 'utf8'));

const problems = [];
const note = (s) => problems.push(s);

// --- dice sanity ---
for (const [name, d] of Object.entries(dice.dice)) {
  if (d.faces.length !== d.sides) note(`dice ${name}: ${d.faces.length} faces != ${d.sides} sides`);
}

// --- card checks ---
const kwKeys = new Set(keywords.map(k => k.key));
const boxKeys = new Set(boxes.map(b => b.key));
const ids = new Set();
const catCount = {};
let dupIds = 0, missingEn = 0, badKw = 0, badBox = 0;

for (const c of cards) {
  if (ids.has(c.id)) { dupIds++; note(`duplicate id ${c.id}`); }
  ids.add(c.id);
  catCount[c.category] = (catCount[c.category] || 0) + 1;
  if (!c.name?.en) missingEn++;
  for (const k of c.keywords || []) {
    if (k.key && !kwKeys.has(k.key)) { badKw++; note(`card ${c.id}: unknown keyword ${k.key}`); }
  }
  for (const b of c.containedIn || []) {
    if (!boxKeys.has(b.box)) { badBox++; note(`card ${c.id}: unknown box ${b.box}`); }
  }
  if (['mech_part', 'drone'].includes(c.category)) {
    for (const f of ['armor', 'score']) {
      if (typeof c[f] !== 'number') note(`card ${c.id} (${c.category}): missing ${f}`);
    }
  }
  if (c.category === 'pilot') {
    for (const f of ['swift', 'melee', 'projectile', 'firing']) {
      if (typeof c[f] !== 'number') note(`pilot ${c.id}: missing timing ${f}`);
    }
  }
}

let badProj = 0;
for (const c of cards) {
  for (const p of Array.isArray(c.projectile) ? c.projectile : []) {
    if (!ids.has(p)) { badProj++; note(`card ${c.id}: projectile ref ${p} not found`); }
  }
}

// --- image coverage: card id -> assets/cards/en/<id>.png ---
const cardImgDir = path.join(ROOT, 'assets', 'cards', 'en');
const tabImgDir = path.join(ROOT, 'assets', 'tokens', 'tab');
const enImgs = fs.existsSync(cardImgDir) ? new Set(fs.readdirSync(cardImgDir)) : new Set();
const tabImgs = fs.existsSync(tabImgDir) ? new Set(fs.readdirSync(tabImgDir)) : new Set();
let withImg = 0, withTab = 0;
const noImg = [];
for (const c of cards) {
  if (enImgs.has(c.id + '.png')) withImg++;
  else noImg.push(c.id);
  if (tabImgs.has(c.id + '.png')) withTab++;
}

console.log('=== Phase 1 validation ===');
console.log('cards:', cards.length, JSON.stringify(catCount));
console.log('keywords:', keywords.length, '| boxes:', boxes.length);
console.log('english names:', cards.length - missingEn, '/', cards.length);
console.log('card image (assets/cards/en/<id>.png):', withImg, '/', cards.length);
console.log('tab token image:', withTab, '/', cards.length);
console.log('problems:', problems.length ? '' : 'none');
for (const p of problems.slice(0, 30)) console.log('  -', p);
if (problems.length > 30) console.log('  ...', problems.length - 30, 'more');
if (noImg.length) console.log('cards without en card image (first 40):', noImg.slice(0, 40).join(','));

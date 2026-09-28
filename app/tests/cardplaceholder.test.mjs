// A card with no official image shows a placeholder: the card's outline with
// its name in the middle, and nothing else (OTTO, 2026-09-28). It replaced
// watermelon's stand-in art, which he supplies himself and stamps "Not official
// image"; OTTO wants none of it in the app. The placeholder is DRAWN, never
// stored, so every tool that counts the scans we hold still sees the gap.
//
// Read as source: the test DOM has no Image, and every slot below is a page
// wiring the one shared helper. The browser pass covered the look.
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

console.log('Card placeholders\n');

const images = src('../src/images.ts');
check('one helper draws it: an outline element with the name as its text',
  /export function cardPlaceholder\(ph: CardPlaceholder, className = ''\): HTMLElement/.test(images)
    && /\['card-ph', ph\.wide \? 'wide' : '', className\]/.test(images), true);
check('it is announced as an image of that card',
  /setAttribute\('aria-label', `\$\{ph\.label\}, no card image`\)/.test(images), true);
check('Drones and Projectiles lie on their side, as they print',
  /return card\.category === 'drone' \|\| card\.category === 'projectile';/.test(images), true);
check('both mounts stand it in for a scan that fails',
  (images.match(/showOrStandIn\(slot, img, className, ph\);/g) ?? []).length, 2);
check('including one that failed before it was mounted, which fires no second error',
  /if \(img\.complete && !img\.naturalWidth\) fail\(\);/.test(images), true);

const pad = src('../pad/pad.ts');
check('the pad\'s Find sheet mounts it like the reference',
  /mountCardImage\)\(slot, slot\.dataset\.img!, isThumb \? 'dthumb-img' : 'ref-cardimg', \{\s*label: slot\.dataset\.imgLabel/.test(pad), true);
check('and drops neither its Photo tab nor its thumbnail', /querySelector\('\.dthumb'\)\?\.remove\(\)/.test(pad), false);

check('the squad panel\'s card stands it in',
  /img\.replaceWith\(cardPlaceholder\(\{ label: cardName\(card\), wide: printsWide\(card\) \}, 'card-img'\)\)/.test(src('../src/panel.ts')), true);

const picker = src('../src/partpicker.ts');
check('the part picker keeps one in each preview slot',
  /<div class="pp-art"><img alt=""><div class="card-ph" role="img"><span><\/span><\/div><\/div>/.test(picker), true);
check('and names it after the card it previews',
  /ph\.querySelector\('span'\)!\.textContent = cardName\(card\);/.test(picker), true);
check('shown only while the card has no scan',
  /\.pp-slot\.noart \.pp-art \.card-ph \{ display: grid;/.test(src('../src/partpicker.css')), true);

const art = src('../src/cardart.ts');
check('a missing pilot portrait gets it too, not a broken image',
  /img\.replaceWith\(cardPlaceholder\(\{ label: slot\.dataset\.portraitLabel \?\? '' \}, 'portrait-ph'\)\)/.test(art), true);
check('and only the detail\'s portrait, big enough to read, carries the name',
  (src('../src/refcards.ts').match(/data-portrait-label=/g) ?? []).length, 1);

const ui = src('../src/ui.css');
check('the look lives in the master UI file, as an outline',
  /div\.card-ph \{[\s\S]{0,200}?border: 1\.5px solid var\(--text3\)/.test(ui), true);
check('and the reference imports that file for it', /import '\.\/ui\.css';/.test(src('../src/reference.ts')), true);

// The stand-ins themselves are gone from the assets.
const A = (p) => new URL(`../../assets/${p}`, import.meta.url);
check('watermelon\'s seven stamped stand-in faces are gone',
  ['43', '44', '45', '46', '47', '48', '49'].filter((n) => existsSync(A(`cards/en/ZPA-${n}.webp`))), []);
check('and the three Ranger portraits cut from the same art',
  ['43', '44', '45'].filter((n) => existsSync(A(`tokens/tab/ZPA-${n}.webp`))), []);
check('while the Grenadiers keep theirs, the art on the watermarked Grenadier-72 card',
  ['46', '47', '48', '49', '72'].every((n) => existsSync(A(`tokens/tab/ZPA-${n}.webp`))), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

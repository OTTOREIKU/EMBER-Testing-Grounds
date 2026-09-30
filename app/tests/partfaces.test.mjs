// The Black Die's Part faces (OTTO, 2026-09-30): "I want to change the part
// dice images for the faces. Right now we are using ones that are a bit dark,
// I found proper icons for every part that match the ones used in the rules
// PDF ... make sure to have them updated in all of the apps and in the
// reference app". The art is Project-Documents/Icon Artwork, a white Mech on a
// black tile with the Part lit; the site serves it from assets/dice/.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The Black Die\'s Part faces\n');

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---------- the images ----------
// A lossless WebP names its size in the VP8L header: 14 bits each, minus one.
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return 'not a WebP';
  if (buf.toString('ascii', 12, 16) !== 'VP8L' || buf[20] !== 0x2f) return 'not lossless';
  const [b0, b1, b2, b3] = [buf[21], buf[22], buf[23], buf[24]];
  return `${1 + (((b1 & 0x3f) << 8) | b0)}x${1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))}`;
}
const PARTS = ['torso', 'chassis', 'leftArm', 'rightArm', 'backpack', 'any'];
check('every Part face is a lossless 128x128 WebP, sharp at any size a page draws it',
  PARTS.map((p) => `${p}:${webpSize(readFileSync(new URL(`../../assets/dice/black_${p}.webp`, import.meta.url)))}`),
  PARTS.map((p) => `${p}:128x128`));

// ---------- one path, every page ----------
const dice = src('../src/dice.ts');
check('dice.ts names the path once, and iconSvg draws every Part face through it',
  [/export function partIconUrl\(part: string\): string \{\s*\n\s*return assetUrl\(`dice\/black_\$\{part\}\.webp`\);/.test(dice),
    /<img class="part-icon" src="\$\{partIconUrl\(part\)\}"/.test(dice), (dice.match(/dice\/black_/g) ?? []).length],
  [true, true, 1]);
// The combat window (tabletop, Match Centre and pad), the Match Centre's roll
// feed, the Reference's dice cards and the text glyphs all draw through iconSvg.
check('no page names the images itself',
  ['main.ts', 'match.ts', 'matchhud.ts', 'combat.ts', 'reference.ts', 'refcards.ts', 'glyphs.ts'].filter((f) => /dice\/black_/.test(src(`../src/${f}`))),
  []);
const table = src('../pad/tabledice.ts');
check('the pad\'s Black Die at the table shows each Part\'s face beside its name, Any too',
  [/<img class="part-icon" src="\$\{esc\(partIconUrl\(DIE_PART\[p\.slot\]\)\)\}" alt=""><b>\$\{esc\(p\.label\)\}<\/b>/.test(table),
    /data-part="any"><img class="part-icon" src="\$\{esc\(partIconUrl\('any'\)\)\}" alt="">/.test(table)],
  [true, true]);

// ---------- sized wherever one is drawn ----------
// The art is 128px: a page that does not size it draws it at that.
check('each page sizes the face: the combat die 26px, the Reference chip 22px, the pad row 28px',
  [/\.die \.part-icon \{ width: 26px; height: 26px; object-fit: contain; \}/.test(src('../src/combat.css')),
    /\.die-face img \{ width: 22px; height: 22px; object-fit: contain; display: block; \}/.test(src('../src/reference.css')),
    /\.td-partrow \.part-icon \{ flex: 0 0 28px; width: 28px; height: 28px;/.test(src('../pad/pad.css'))],
  [true, true, true]);

// ---------- no device keeps the old ones ----------
check('the offline cache drops the old faces on its next start', /const REPLACED = \[[^\]]*'\/assets\/dice\/'/.test(src('../public/sw.js')), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

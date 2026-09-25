// How a Mech's picture is built from its Parts.
//
// The order (types.ts MECH_LAYER_ORDER, mechLayerOrder): the art is a
// three-quarter view facing left, so the LEFT arm is the far arm and belongs
// behind the chassis and torso. Both arms used to be drawn on top, which laid
// the far shoulder across the chest (OTTO, 2026-09-24). Two left arms are
// front-mounted and keep their place over the torso.
//
// The builder (data.ts mechArtLayers): ONE function every tool draws through,
// so a change to how a Mech looks lands everywhere at once (OTTO asked for
// exactly that the same day).
import { readFileSync, readdirSync } from 'node:fs';
import * as T from '../src/types.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

console.log('Mech pictures: the far arm goes behind, and one builder draws them all\n');

// ---------- the order ----------
check('a plain Mech: left arm first, right arm last',
  T.mechLayerOrder({ leftHand: '535' }), ['leftHand', 'chasis', 'backpack', 'torso', 'rightHand']);
check('no left arm fitted: the same order',
  T.mechLayerOrder({}), ['leftHand', 'chasis', 'backpack', 'torso', 'rightHand']);
check('the 552 shield is front-mounted and stays over the torso',
  T.mechLayerOrder({ leftHand: '552' }), ['chasis', 'backpack', 'torso', 'leftHand', 'rightHand']);
check('the PDLH-201 launcher is front-mounted and stays over the torso',
  T.mechLayerOrder({ leftHand: 'PDLH-201' }), ['chasis', 'backpack', 'torso', 'leftHand', 'rightHand']);

// ---------- one builder ----------
// Sliced out of data.ts (its other imports need fetch and the DOM) and run on
// a stub assetUrl, so the real rule is what gets tested.
{
  const src = read('../src/data.ts');
  const start = src.indexOf('export function mechArtLayers');
  // data.ts may have Windows line endings: end at the first closing brace in
  // column 0, whichever line ending precedes it.
  const close = /\r?\n\}/.exec(src.slice(start));
  const end = start + close.index + close[0].length;
  const { writeFileSync } = await import('node:fs');
  const tmp = new URL('./_mechart.slice.ts', import.meta.url);
  writeFileSync(tmp, `import { mechLayerOrder } from '../src/types.ts';\ntype MechLoadout = any; type PartState = any;\n`
    + 'const mechPartUrl = (id: string) => id;\n' + src.slice(start, end));
  const { mechArtLayers } = await import(tmp.href);
  const dune = { torso: '014', chasis: '534', leftHand: '535', rightHand: '025', backpack: '532' };
  check('the Dune stacks left arm, chassis, backpack, torso, right arm',
    mechArtLayers(dune), ['535', '534', '532', '014', '025']);
  check('a destroyed arm drops out of the picture',
    mechArtLayers(dune, { leftHand: 'destroyed' }), ['534', '532', '014', '025']);
  check('a destroyed torso stays in it',
    mechArtLayers(dune, { torso: 'destroyed' }), ['535', '534', '532', '014', '025']);
}

// Every tool calls it: the board (so the tabletop and the Match Centre), the
// squad panel, the pad and the landing page.
for (const f of ['../src/board.ts', '../src/squads.ts', '../pad/pad.ts', '../src/landing.ts']) {
  check(`${f.split('/').pop()} draws a Mech through mechArtLayers`, read(f).includes('mechArtLayers('), true);
}
// And nothing else walks the order itself; a page that did would drift the
// next time the rule changes.
{
  const walkers = [];
  for (const dir of ['../src/', '../pad/']) {
    for (const name of readdirSync(new URL(dir, import.meta.url))) {
      if (!name.endsWith('.ts') || name === 'types.ts' || name === 'data.ts') continue;
      const src = read(dir + name);
      if (src.includes('mechLayerOrder(') || src.includes('of MECH_LAYER_ORDER')) walkers.push(dir + name);
    }
  }
  check('no other file walks the layer order itself', walkers, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

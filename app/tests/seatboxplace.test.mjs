// WHERE A BLACK BOX IS PUT DOWN AT SETUP (AI-OPPONENT-PLAN.md: `boxPlace`, the
// Tactician's weight; 0 leaves each Box where it stands). 5.2.1: the squads take
// turns placing each Box anywhere in the Tactical Zone its Main Task names, at
// ground level, never on terrain (FAQ P9). The seam offered only "Leave the
// Black Box where it stands" (the window's own comment said a Box may be moved
// inside its zone, "which a seat with a view on where it wants it will ask
// for"). It now offers a Small Grid of each Large Grid of the zone the engine
// takes, and says where each squad deploys; the Tactician puts a Box where it is
// furthest from the other squad for how near it is to its own.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Black Box put down at setup\n');

const { M, data } = await loadEngine('seatboxplace', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const keyGame = { ...data.solo.scenarios[0], id: 't-boxplace', mission: 'blackbox-key-facilities' };
const on = AI.makeTactician({}, { boxPlace: 1 });
const off = AI.makeTactician({}, {});
// The table at its first Box placement: whichever seat it is asked of.
const t = botTable(M, data, keyGame, { seed: 3, policies: { s1: off, s2: off } });
let asked = null;
await t.run({ until: () => ['s1', 's2'].some((s) => { const d = t.drivers[s].pending(); if (d?.kind === 'setup.box') { asked = { s, d }; return true; } return false; }) });
const { s, d } = asked;
const view = M.SEAT.viewOf(data, t.state, s);
const tasks = M.TK.normaliseTasks(t.state.tasks);
const loose = tasks.items.filter((i) => i.kind === 'blackbox' && !i.set);
const keeps = d.options.filter((o) => o.tags.includes('keep'));
const places = d.options.filter((o) => o.tags.includes('place'));
const zoneOf = (i) => M.S.zoneCellsOf(data, t.state)(i.zone).map((ref) => M.TK.cellToGrid(ref));
const wantPlaces = loose.reduce((n, i) => n + zoneOf(i).length - 1, 0);
check('THE SEAM OFFERS EACH LOOSE BOX LEFT WHERE IT STANDS (FIRST), OR PUT DOWN IN EACH OTHER LARGE GRID OF ITS ZONE, each answer saying which Box and where, the question where each squad deploys',
  [keeps.length, d.options.indexOf(keeps[keeps.length - 1]) === keeps.length - 1, places.length <= wantPlaces && places.length >= Math.ceil(wantPlaces / 2),
    places.every((o) => zoneOf(loose.find((i) => i.id === o.facts.box)).some((g) => g.c === o.facts.at.c && g.r === o.facts.at.r)), d.facts.zone.length > 0 && d.facts.foeZone.length > 0],
  [loose.length, true, true, true, true]);
{
  // Every answer the engine takes, and leaves the Box where the answer says.
  const wrong = [];
  for (const o of d.options) {
    const table = M.G.tableAfter(data, t.state, o.commands);
    const item = table && M.TK.normaliseTasks(table.tasks).items.find((i) => i.id === o.facts.box);
    if (!item || !item.set || Math.floor(item.col / 3) !== o.facts.at.c || Math.floor(item.row / 3) !== o.facts.at.r) wrong.push(o.id);
  }
  check('THE ENGINE TAKES EVERY ANSWER, and the Box is then where the answer says', wrong, []);
}
{
  const near = (g, zone) => Math.min(...zone.map((k) => { const [c, r] = k.split(',').map(Number); return Math.abs(c - g.c) + Math.abs(r - g.r); }));
  const score = (o) => near(o.facts.at, d.facts.foeZone) - near(o.facts.at, d.facts.zone);
  const best = Math.max(...d.options.map(score));
  const rng = new AI.Rng('boxplace');
  const chose = on.choose(d, view, rng);
  const chosen = d.options.find((o) => o.id === chose.option);
  const left = off.choose(d, view, rng);
  check('AT `boxPlace` 1 THE BOX AND GRID FURTHEST FROM THE OTHER SQUAD FOR HOW NEAR IT IS TO THIS ONE; at 0 a Box is left where it stands',
    [score(chosen), best, chose.reason, d.options.find((o) => o.id === left.option)?.tags.includes('keep')], [best, best, 'box_place', true]);
}
t.close();
{
  // NOT ON ASSET PRESERVATION, where only a Box carried into Echo pays: a Box
  // pulled toward a squad's edge is further for anybody to carry home in time
  // (measured: 93 of 200 there, 106 on Key Facility). Left where it stands.
  const assetGame = { ...data.solo.scenarios[0], id: 't-boxplace-ap', mission: 'blackbox-asset-preservation' };
  const ta = botTable(M, data, assetGame, { seed: 3, policies: { s1: off, s2: off } });
  let asked2 = null;
  await ta.run({ until: () => ['s1', 's2'].some((s) => { const q = ta.drivers[s].pending(); if (q?.kind === 'setup.box') { asked2 = { s, d: q }; return true; } return false; }) });
  const v2 = M.SEAT.viewOf(data, ta.state, asked2.s);
  const pick = on.choose(asked2.d, v2, new AI.Rng('boxplace-ap'));
  check('ON ASSET PRESERVATION (a Box pays only in Echo) EACH BOX IS LEFT WHERE IT STANDS, the move answers offered all the same',
    [v2.task?.scoringZone, asked2.d.options.some((o) => o.tags.includes('place')), asked2.d.options.find((o) => o.id === pick.option)?.tags.includes('keep')], ['Echo', true, true]);
  ta.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

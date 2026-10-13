// AI lab (tools/ai-lab/README.md): a policy by name, for the probes and the measuring script.
//   legal, eager, brawler, tactician
//   tactician:mission,exposure   only those skills
//   tactician:-stance,-focus     all skills but those
//   tactician:+sprints,-focus    the default skills, that one on and that one off
//   tactician:none               no skill
//   tactician::zonePull=0.35     weights after a second colon (name=value, commas)
//
// HIDE=<kind>,<kind> in the environment keeps answers of those kinds (an
// answer's first tag) from every policy made here. When the seam is taught to
// offer something new, the policies that draw by lot draw differently and
// their same-games hashes move; with the new kinds hidden the hashes must be
// the OLD ones, which proves nothing else changed.
const HIDE = (process.env.HIDE ?? '').split(',').filter(Boolean);
// HIDETAG=<tag>,<tag> hides answers carrying any of those tags wherever they
// stand (a Crush of a Unit is a `move` marked `crush-unit`).
const HIDETAG = (process.env.HIDETAG ?? '').split(',').filter(Boolean);
const hidden = (o) => HIDE.includes(o.tags[0]) || o.tags.some((t) => HIDETAG.includes(t));
function hiding(policy) {
  if (!HIDE.length && !HIDETAG.length) return policy;
  const seen = (d) => {
    const options = d.options.filter((o) => !hidden(o));
    return options.length && options.length < d.options.length ? { ...d, options, fallback: options.some((o) => o.id === d.fallback) ? d.fallback : options[0].id } : d;
  };
  // A question that is ALL of a hidden kind (the Mines a walk may Lay: every
  // answer of `mine.lay` is a `mine`) is answered with its safe answer, which
  // sends nothing, and draws nothing from the policy's generator.
  const whole = (d) => d.options.length > 0 && d.options.every((o) => hidden(o));
  return {
    name: policy.name,
    ...(policy.trueRange ? { trueRange: true } : {}),
    choose: (d, view, rng) => (whole(d) ? { option: d.fallback, why: 'hidden' } : policy.choose(seen(d), view, rng)),
    ...(policy.ponder ? { ponder: (d, view, rng, breathe) => (whole(d) ? Promise.resolve({ option: d.fallback, why: 'hidden' }) : policy.ponder(seen(d), view, rng, breathe)) } : {}),
  };
}

export function policyOf(AI, name) {
  return hiding(named(AI, name));
}

function named(AI, name) {
  if (name === 'brawler') return AI.brawlerPolicy;
  // The Brawler is our own style of the Tactician since 2026-10-09 (styles.ts, M21): the copy of the other app's AI
  // and its habits are gone. Its skills and weights are the Tactician's: tactician:<skills>:<weights>.
  if (name.startsWith('brawler:')) throw new Error(`${name}: the Brawler's habits went with the copy (M21); name a tactician style`);
  // THE MISSILE BARRAGE (styles.ts, M24): the Ace that launches whatever it can.
  if (name === 'missile') return AI.missilePolicy;
  if (name === 'eager') return AI.eagerPolicy;
  if (name === 'legal') return AI.legalPolicy;
  // The levels (M9.1): recruit[:rate] is the Brawler making mistakes at that rate; veteran the Tactician without its look ahead.
  if (name === 'recruit' || name.startsWith('recruit:')) return name.includes(':') ? AI.blundering(AI.brawlerPolicy, Number(name.split(':')[1]), 'recruit') : AI.recruitPolicy;
  if (name === 'veteran') return AI.veteranPolicy;
  // OUR OWN BRAWLER AND RECRUIT (M21, 2026-10-09): the Brawler style (styles.ts), and the Recruit made of it with a
  // share of its turns by lot (newrecruit[:rate], 0.25 unless told).
  if (name === 'newbrawler') return AI.brawlerPolicy;
  if (name === 'newrecruit' || name.startsWith('newrecruit:')) return AI.blundering(AI.brawlerPolicy, name.includes(':') ? Number(name.split(':')[1]) : 0.25, 'newrecruit');
  if (name.startsWith('tactician')) {
    // Skills, one colon, weights: a name with more parts (a 'tactician:+x::w=1' typo once dropped its weights
    // without a word) is refused.
    if (name.split(':').length > 3) throw new Error(`${name}: skills and weights are split by ONE colon (tactician:+skill:weight=1)`);
    const [, spec = '', tune = ''] = name.split(':');
    const names = spec.split(',').filter(Boolean);
    const all = Object.keys(AI.SKILLS);
    let skills = {};
    if (names.includes('none')) skills = Object.fromEntries(all.map((k) => [k, false]));
    else if (names.some((n) => !n.startsWith('-') && !n.startsWith('+'))) skills = Object.fromEntries(all.map((k) => [k, names.includes(k)]));
    else skills = Object.fromEntries(names.map((n) => [n.slice(1), n.startsWith('+')]));
    for (const k of Object.keys(skills)) if (!all.includes(k)) throw new Error(`no skill called ${k}`);
    const weights = Object.fromEntries(tune.split(',').filter(Boolean).map((x) => { const [k, v] = x.split('='); if (!(k in AI.TACTICIAN)) throw new Error(`no weight called ${k}`); return [k, Number(v)]; }));
    return AI.makeTactician(skills, weights);
  }
  throw new Error(`no policy called ${name}`);
}

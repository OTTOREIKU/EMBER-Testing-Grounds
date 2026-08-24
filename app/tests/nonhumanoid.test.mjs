// NON-HUMANOID X 异形X - "When performing this Action, -X Link Value."
//
// Found by the Reference audit rather than by play: the keyword had a glossary
// entry and no engine behind it, so the Centaur's Run was free. It is printed in
// English on the card AND in the publisher's Part Data GoF 1.021 EN list, which
// is the highest authority we hold for a Part, so there was nothing to wait for.
//
// The trap this pins: the KEYWORD CHIP carries the generic 异形X with no number.
// The X is printed in the Action's own text ("· 异形1"). A reader that matched
// the bare chip would charge 0 on every Centaur Action and look wired while
// doing nothing at all.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = unitsSrc.indexOf('// ---------- IMMOBILIZED, AND THE ONE KEYWORD THAT IGNORES IT ----------');
const end = unitsSrc.indexOf('// ---------- ON-HIT RIDERS');
if (start < 0 || end < 0) throw new Error('could not locate the Movement-Action readers in units.ts');
const tmp = new URL('./_nonhum.slice.ts', import.meta.url);
writeFileSync(tmp, `type CardAction = any;\ntype Token = any;
const statusCount = (list: any[] | undefined, id: string): number => (list ?? []).filter((s) => s === id).length;
` + unitsSrc.slice(start, end));
const U = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Non-humanoid X: the Link cost the Centaur was not paying\n');

// ---------- reading the number ----------
// The real shapes off card 181: the chip is generic, the Action text has the X.
const run = {
  id: '181_A',
  description: { zh: '· 异形1\n· 不可阻挡\n· 如果在本机移动后，前方相邻格有敌方地面单位，可对其造成推动1。' },
  keywords: [{ inline: '异形X' }, { inline: '不可阻挡' }],
};
const sprint = { id: '181_B', keywords: [] };

check('the Run costs 1 Link', U.nonHumanoidCost(run), 1);
check('the Sprint on the SAME CARD costs nothing', U.nonHumanoidCost(sprint), 0);
check('a bare Maneuver carries no Action and owes nothing', U.nonHumanoidCost(null), 0);

// THE TRAP: the generic chip alone must never be read as a cost.
check('the bare 异形X chip with no number is NOT a cost',
  U.nonHumanoidCost({ keywords: [{ inline: '异形X' }] }), 0);

// English, because the card and the publisher PDF both print it that way and
// the data is being filled in behind this.
check('the English printing is read too',
  U.nonHumanoidCost({ description: { en: '· Non-humanoid 1' } }), 1);
check('and the unhyphenated spelling',
  U.nonHumanoidCost({ description: { en: 'Non humanoid 2' } }), 2);
check('a bigger X is carried, not clamped to 1',
  U.nonHumanoidCost({ description: { zh: '· 异形3' } }), 3);
check('unrelated text does not trip it',
  U.nonHumanoidCost({ description: { en: 'Push 1 and Knock Back 2' } }), 0);

// ---------- the refusal ----------
const rich = { label: 'Centaur', link: 5, statuses: [] };
const broke = { label: 'Centaur', link: 0, statuses: [] };
const exact = { label: 'Centaur', link: 1, statuses: [] };

check('a Mech with Link to spare may Run', U.nonHumanoidStop(rich, run), null);
check('a Mech with exactly enough may Run', U.nonHumanoidStop(exact, run), null);
check('a Mech with none may not', typeof U.nonHumanoidStop(broke, run), 'string');
check('and is told the cost and what it has',
  /needs 1 Link.*has 0/.test(U.nonHumanoidStop(broke, run)), true);
check('the free Sprint is unaffected by an empty Link', U.nonHumanoidStop(broke, sprint), null);
check('a missing link field reads as 0, not as permission',
  typeof U.nonHumanoidStop({ label: 'X', statuses: [] }, run), 'string');

// The two Movement gates are independent: a unit can fail either alone.
check('Non-humanoid does not care about Immobilized', U.nonHumanoidStop({ ...rich, statuses: ['immobilized'] }, run), null);
check('and Immobilized does not care about Link', U.immobilizedStop(broke, run), null);

// ---------- where the rule LIVES ----------
// Movement does NOT travel the same road on the two boards: the Match Centre
// sends a `maneuver` command, freeplay mutates in commitMove and sends none.
// So the cost is paid in two places on purpose, and each board must pay it
// exactly once - double-charging is the failure this section is watching for.
{
  const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');

  // `case 'maneuver'` appears twice: check() first, then apply(). Slice each by
  // its own offset rather than by a length that would run into the other.
  const first = cmds.indexOf("case 'maneuver': {");
  const second = cmds.indexOf("case 'maneuver': {", first + 1);
  if (first < 0 || second < 0) throw new Error('could not find both maneuver arms in commands.ts');
  const manCheck = cmds.slice(first, first + 1600);
  const manApply = cmds.slice(second, second + 1600);

  check('the maneuver command refuses a unit that cannot pay',
    /nonHumanoidStop\(t, moveAction\)/.test(manCheck), true);
  check('and judges it off the action on the wire, not off the card',
    /findAction\(data, state, cmd\.uid, cmd\.actionId\)/.test(manCheck), true);
  check('the maneuver apply spends the Link', /nonHumanoidCost\(/.test(manApply), true);
  check('and clamps at zero rather than going negative',
    /t\.link = Math\.max\(0, \(t\.link \?\? 0\) - cost\)/.test(manApply), true);

  // Freeplay: refused at the planner, paid at the commit, and paid off the
  // plan's own Action so the bare-Maneuver door through the same planner is
  // never charged.
  check('freeplay refuses before the planner opens',
    /const shortLink = nonHumanoidStop\(t, opts\.action \?\? null\)/.test(main), true);
  check('freeplay spends it at the commit', /nonHumanoidCost\(m\.action \?\? null\)/.test(main), true);
  check('and the plan carries the Action to get there', /action: opts\.action \?\? null,/.test(main), true);

  // Exactly once per board. Freeplay sends no maneuver command for a move, so
  // if it ever starts to, this count is the thing that should fail first.
  const spends = (s) => (s.match(/nonHumanoidCost\(/g) ?? []).length;
  check('freeplay charges in exactly one place', spends(main), 1);
  check('the command layer charges in exactly one place', spends(cmds), 1);
  check('and the Match Centre charges nowhere - its command does that', spends(hud), 0);

  // But the Match Centre still warns early, like it does for Immobilized.
  check('the Match Centre refuses at its planner too', /nonHumanoidStop\(/.test(hud), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

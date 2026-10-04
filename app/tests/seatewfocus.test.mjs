// A FOCUS IN AN ELECTRONIC COUNTER-ROLL (AI-OPPONENT-PLAN.md: `ewFocus`, the
// Tactician's weight; 0 leaves the window's safe answers, Pass and Keep). A
// trace of the Advanced Stealth Duel on Terminals found the computer never
// Focused in a Counter-roll: no policy decided the question. The bot's window
// (`botcontest.ts`) now says what each side has rolled, as each counts its own
// dice, which of its dice count nothing, and what a die thrown again would
// count; and offers a reroll of the blank dice alone. The Tactician declares
// where those dice, thrown again, turn a lost roll at least 0.25 / `ewFocus`
// of the time, in Link while the pilot keeps two, else on a Whistle.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A Focus in a Counter-roll\n');

const { M, data } = await loadEngine('seatewfocus', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const on = AI.makeTactician({}, { ewFocus: 1 });
const off = AI.makeTactician({}, { ewFocus: 0 });
const rng = new AI.Rng('ewfocus');

// ---------- the question, played ----------
// The copied game on a Terminals Task, both seats the Tactician with the
// weight on, until a seat is asked to declare: the question's counts are the
// record's, as the window counts them.
let live = null;
for (let seed = 1; seed <= 4 && !live; seed++) {
  const t = botTable(M, data, { ...data.solo.scenarios[0], mission: 'terminal-data-extraction' }, { seed, policies: { s1: on, s2: on }, glue: M.HUD.glueAfter });
  await t.run({ maxSteps: 8000, until: () => ['s1', 's2'].some((s) => { const d = t.drivers[s].pending(); if (d?.kind === 'contest.focus' && d.facts.mine) { live = { t, s, d }; return true; } return false; }) });
  if (!live) t.close();
}
{
  const { t, d } = live;
  const c = t.state.script.counter;
  const mineRoll = d.facts.role === 'initiator' ? c.initRoll : c.respRoll;
  const count = (faces) => faces.reduce((n, f) => ({ lightning: n.lightning + d.facts.faces[f].lightning, light: n.light + d.facts.faces[f].light }), { lightning: 0, light: 0 });
  check('A SEAT ASKED TO DECLARE IS TOLD WHAT IT ROLLED: its count is its dice read by the faces it is told, and the blank dice are the ones that count nothing',
    [d.facts.faces.length, JSON.stringify(count(mineRoll)) === JSON.stringify(d.facts.mine), d.facts.blank.every((i) => !d.facts.faces[mineRoll[i]].lightning && !d.facts.faces[mineRoll[i]].light),
      mineRoll.every((f, i) => d.facts.blank.includes(i) || d.facts.faces[f].lightning + d.facts.faces[f].light > 0), typeof d.facts.theirs?.lightning],
    [data.dice.dice.yellow.faces.length, true, true, true, 'number']);
  t.close();
}

// ---------- the decision, on questions made to order ----------
// A unit of the copied squads, with the Link the case wants, and the faces of
// a Yellow die as a side in Defensive Stance counts them.
const t = botTable(M, data, data.solo.scenarios[0], { seed: 1, policies: { s1: on, s2: on } });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const unit = t.state.tokens.find((x) => x.side === 's1' && x.kind === 'mech');
const faces = data.dice.dice.yellow.faces.map((_f, i) => M.U.tallyCounter(data.dice, [i], false));
const ask = (role, mine, theirs, blank, link, options = ['focus.pass', 'focus.use']) => {
  unit.link = link;
  const view = M.SEAT.viewOf(data, t.state, 's1');
  const labels = { 'focus.pass': 'Pass', 'focus.use': 'Focus 1 Link', 'focus.whistle': 'Whistle Command Token' };
  const d = { id: 'q', kind: 'contest.focus', seat: 's1', unit: unit.uid, options: options.map((id) => ({ id, label: labels[id], tags: [], run: { routine: 'contest', args: { id } } })), fallback: 'focus.pass', facts: { role, mine, theirs, blank, faces } };
  return { on: on.choose(d, view, rng), off: off.choose(d, view, rng) };
};
// One Lightning short, three dice to throw again: one Lightning in any draws
// level on Lightning, and the Initiator's three Light Hits then win it.
const behind = ask('initiator', { lightning: 1, light: 3 }, { lightning: 2, light: 0 }, [1, 2, 3], 3);
const lightningFace = faces.filter((f) => f.lightning > 0).length / faces.length;
const want = 1 - (1 - lightningFace) ** 3;
check('A ROLL THE INITIATOR IS LOSING BY ONE LIGHTNING, THREE BLANK DICE: it Focuses for a Link, for the chance any of them turns up a Lightning; at `ewFocus` 0 the window\'s Pass stands',
  [behind.on.option, Math.abs(behind.on.score - want) < 1e-9, /wins \d+% of the time, for a Link/.test(behind.on.why), behind.off.option], ['focus.use', true, true, 'focus.pass']);
check('THE SAME WITH ONE LINK LEFT: no Link is spent; with a Whistle on offer, the Whistle',
  [ask('initiator', { lightning: 1, light: 3 }, { lightning: 2, light: 0 }, [1, 2, 3], 1).on.option, ask('initiator', { lightning: 1, light: 3 }, { lightning: 2, light: 0 }, [1, 2, 3], 1, ['focus.pass', 'focus.use', 'focus.whistle']).on.option],
  ['focus.pass', 'focus.whistle']);
check('A ROLL ALREADY WON IS LET LIE, and so is one the blank dice cannot turn (two Lightning short with one die)',
  [ask('responder', { lightning: 2, light: 0 }, { lightning: 1, light: 4 }, [1], 3).on.option, ask('initiator', { lightning: 0, light: 4 }, { lightning: 2, light: 0 }, [1], 3).on.option], ['focus.pass', 'focus.pass']);
// A level roll goes to the Initiator: the Responder level on both counts is
// losing it.
check('A RESPONDER LEVEL ON BOTH COUNTS IS LOSING (a tie goes to the Initiator), and Focuses where a blank die could break it',
  [ask('responder', { lightning: 1, light: 1 }, { lightning: 1, light: 1 }, [0, 1], 3).on.option], ['focus.use']);
{
  // The reroll, once declared: the dice that count nothing.
  const d = { id: 'r', kind: 'contest.reroll', seat: 's1', unit: unit.uid, options: ['reroll.keep', 'reroll.all', 'reroll.blanks'].map((id) => ({ id, label: id, tags: [], run: { routine: 'contest', args: { id } } })), fallback: 'reroll.keep', facts: { role: 'initiator' } };
  const view = M.SEAT.viewOf(data, t.state, 's1');
  check('ITS REROLL IS OF THE BLANK DICE ALONE', on.choose(d, view, rng).option, 'reroll.blanks');
}
t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

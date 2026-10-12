// THE DEFENDER'S DODGES, Hits first or held for the Lightning (penetration
// audit 2026-10-12, finding 1). "The Defender offsets Icons in the Attack Roll"
// (4.4.1 step 6), so with Concussion, Wrecking or a Lightning rider, a Dodge on
// a Hit or on a Lightning is the DEFENDER's call. The stepper used to sit under
// the attacker's controls: in a room the attacking player set it and the
// defending one never saw it, and a computer never set it at all.
//
// Driven through the real window. The roll throughout: one Light Hit and one
// Lightning against one Dodge and one Defense, from the Type 55 Shield's
// Concussion bash. The Dodge on the Light Hit leaves the Defense idle and lets
// the Lightning through; the Dodge on the Lightning lets the Defense block the
// Light Hit instead.
import { installDom, loadCombat, makeEl, findButtons, label, textOf, mech, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
const { AttackHelper, data, dice, mod } = await loadCombat('dodgehold', ['askOf'], [
  "export { lightningLinkDrain } from '../src/units';",
  "export { BotCombat } from '../src/ai/botcombat';",
]);

const faceOf = (colour, type) => dice.dice[colour].faces.findIndex((f) => f.length === 1 && f[0].type === type && !f[0].hollow);
const Y_LIGHT = faceOf('yellow', 'lightHit');
const Y_BOLT = faceOf('yellow', 'lightning');
const W_DODGE = faceOf('white', 'dodge');
const W_DEF = faceOf('white', 'defense');
const shield = data.byId.get('520')?.actions?.find((a) => a.id === '520_A');
check('the fixture: the Type 55 Shield bash carries Concussion, and the dice carry every face set here',
  [mod.lightningLinkDrain(shield), [Y_LIGHT, Y_BOLT, W_DODGE, W_DEF].every((i) => i >= 0)], ['concussion', true]);

const kit = (t, parts = {}) => { t.mech = { torso: '172', chasis: '179', leftHand: '', rightHand: '', backpack: '', pilot: '', ...parts }; return t; };
const units = (link) => {
  const atk = kit(mech(1, 's1', 'Basher', 1), { leftHand: '520' });
  const def = kit(mech(2, 's2', 'Target', 3));
  def.link = link;
  return [atk, def];
};

function windowOn(tokens, opts = {}) {
  const sent = [];
  const root = makeEl('div');
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, (cmd) => { sent.push(cmd); return { ok: true }; });
  h.tokens = () => tokens;
  h.terrain = () => [];
  h.smoke = () => [];
  h.instant = true;
  const views = [];
  h.publishView = (v) => views.push(v);
  if (opts.remote) h.focusRemote = (d) => d.side === 's2';
  return { h, root, sent, views };
}
function atResolve(w, atk, def) {
  w.h.start(atk, shield, def, 'clear');
  w.h.pickPart('torso');
  const c = w.h.ctx;
  c.attackRoll = [{ color: 'yellow', face: Y_LIGHT, selected: false }, { color: 'yellow', face: Y_BOLT, selected: false }];
  c.defenseRoll = [{ color: 'white', face: W_DODGE, selected: false }, { color: 'white', face: W_DEF, selected: false }];
  c.focus = { stage: 'done', attackerUse: false, defenderUse: false };
  c.step = 'resolve';
  w.h.render();
  return c;
}
// The last drawing's buttons of one kind (a window may draw a control twice).
const btns = (root, act) => findButtons(root).filter((b) => b.dataset.act === act);
const live = (root, act) => btns(root, act).some((b) => !b.disabled);
const lastView = (w) => w.views[w.views.length - 1];

console.log('The defender\'s Dodges: Hits first, or held for the Lightning\n');

// ---------- one screen for both sides ----------
{
  const [atk, def] = units(3);
  const w = windowOn([atk, def]);
  const c = atResolve(w, atk, def);
  check('at 3 Link the default is Hits first: the Dodge takes the Light Hit and the Lightning gets through',
    [c.lightningThrough, live(w.root, 'resolve.done')], [1, true]);
  check('the stepper is the defender\'s, and live on a screen that plays the defender', live(w.root, 'resolve.dodgehold'), true);
  btns(w.root, 'resolve.dodgehold').find((b) => b.dataset.arg === '1' && !b.disabled)?.click();
  check('holding the Dodge for the Lightning: the Defense blocks the Light Hit and nothing gets through',
    [c.dodgeOnLightning, c.lightningThrough], [1, 0]);
}
{
  const [atk, def] = units(1);
  const w = windowOn([atk, def]);
  const c = atResolve(w, atk, def);
  check('at 1 Link the default keeps the Dodge for the Lightning, which would take the last Link and Shut the Mech Down',
    [c.lightningThrough, /1 Dodge held for the \[Lightning\]/.test(textOf(w.root).join('\n'))], [0, true]);
}

// ---------- the defender at another screen ----------
{
  const [atk, def] = units(3);
  const w = windowOn([atk, def], { remote: true });
  const c = atResolve(w, atk, def);
  const v = lastView(w);
  check('the attacking window WAITS: no Done, and it says whose answer it waits for',
    [live(w.root, 'resolve.done'), /Waiting for Target's player to place their Dodges/.test(textOf(w.root).join('\n'))], [false, true]);
  check('and the stepper is drawn, but not live, on the attacker\'s screen', [btns(w.root, 'resolve.dodgehold').length > 0, live(w.root, 'resolve.dodgehold')], [true, false]);
  check('the published view asks the defender, with the default to start from', v?.dodgeHold, { max: 1, n: 0, asked: true });
  check('the band names the defender as the one deciding',
    mod.askOf({ step: 'resolve', attackRoll: [], defenseRoll: [], focus: null, surplusRound: 0, holdAsked: true }).who, 'defender');

  // The defender's own screen: a mirror of the attack, drawn from that view.
  const m = windowOn([atk, def]);
  const acts = [];
  m.h.mirrorAct = (act, arg) => { acts.push([act, arg]); return true; };
  m.h.showMirror(v, atk, def, shield, 'defender');
  const keepLabel = () => label(btns(m.root, 'resolve.dodgekeep').at(-1) ?? { textContent: '' });
  check('the defender\'s screen draws the stepper live and an answer to send', [live(m.root, 'resolve.dodgehold'), live(m.root, 'resolve.dodgekeep'), keepLabel()], [true, true, 'Put the Dodges on the Hits first']);
  btns(m.root, 'resolve.dodgehold').find((b) => b.dataset.arg === '1' && !b.disabled)?.click();
  check('a press of + changes the defender\'s own pick only', [keepLabel(), c.dodgeOnLightning ?? null], ['Hold 1 Dodge for the [Lightning]', null]);
  btns(m.root, 'resolve.dodgekeep').filter((b) => !b.disabled).at(-1)?.click();
  check('and the answer goes as one press with its number', acts, [['dodgehold', '1']]);
  check('after which the defender\'s button is quiet', live(m.root, 'resolve.dodgekeep'), false);

  // The answer lands on the attacking window as a dodgeHold command.
  w.h.dodgeHoldAnswered(1, 's1');
  check('an answer from the attacking squad is not the defender\'s, and is ignored', [c.dodgeHoldAnswered ?? false, live(w.root, 'resolve.done')], [false, false]);
  w.h.dodgeHoldAnswered(1, 's2');
  check('the defender\'s answer: the Dodge holds for the Lightning, and the attack goes on',
    [c.dodgeOnLightning, c.lightningThrough, live(w.root, 'resolve.done'), lastView(w)?.dodgeHold?.asked], [1, 0, true, false]);
}
{
  const [atk, def] = units(1);
  const w = windowOn([atk, def], { remote: true });
  atResolve(w, atk, def);
  check('at 1 Link the defender is asked with the Dodge already on the Lightning', lastView(w)?.dodgeHold, { max: 1, n: 1, asked: true });
}

// ---------- a computer defending answers it ----------
{
  const [atk, def] = units(1);
  const w = windowOn([atk, def], { remote: true });
  atResolve(w, atk, def);
  const state = { tokens: [atk, def], round: { n: 1, phase: 2, firstPlayer: 's1' }, script: { combat: null, combatView: lastView(w) } };
  const out = [];
  const bot = new mod.BotCombat('s2', {
    data, state: () => state,
    send: (cmd) => { out.push(cmd); return { ok: true }; },
    roll: async () => [],
  });
  const d = bot.decision();
  check('a computer seat at the defender\'s screen is asked one question, where its Dodges go', [d?.kind, d?.options.map((o) => o.id)], ['defence.dodges', ['resolve.dodgekeep']]);
  bot.press(d.options[0].id);
  await settle();
  check('and answers with the window\'s default: the Dodge kept for the Lightning that would Shut it Down',
    out.filter((x) => x.kind === 'dodgeHold').map((x) => [x.seat, x.n]), [['s2', 1]]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

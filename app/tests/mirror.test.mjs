// The MIRROR: an attack somebody else's client is resolving, drawn by the same
// renderer that resolves attacks here (task #6 slice 2, "Ratified: ONE renderer
// with a ROLE", COMBAT-PANEL-REDESIGN.md).
//
// The Match Centre used to draw a SECOND combat window by hand for everyone who
// was not the attacker. A diff harness drove both implementations over the same
// published views before the cutover and classified every difference between
// them; what is pinned here is the handful that were WINS rather than choices,
// because those are the ones a future edit could quietly give back:
//
//   - the dice ROLL on the watching screen. spinDice lives in combat.ts and the
//     retired mirror never called it, so the faces did not roll, they appeared.
//   - the whole LOG arrives, not the last five lines.
//   - the Multi-Target split screen EXISTS for them at all.
//   - there is a CLOSE, so a watcher can put the window away.
//   - a control the watcher may not press is DISABLED, never missing, so the
//     other side's open question is visible instead of being a blank step.
//
// Everything here DRIVES the real renderer through the DOM shim. A source-shape
// test would have passed against the retired mirror too.
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The mirror: one renderer, drawing somebody else\'s attack\n');

installDom();
const { AttackHelper, data, dice } = await loadCombat('mirror');

const rifle = data.cards.find((c) => c.id === 'ZHRA-201');
const firing = rifle?.actions?.find((a) => a.id === 'ZHRA-201_B');
const sweeper = data.cards.find((c) => c.id === '038');
const sweep = sweeper?.actions?.find((a) => a.id === '038_A');
check('the fixture Action is still on the card', !!firing, true);
check('and so is the Multi-Target one', !!sweep, true);

const torso = data.cards.find((c) => c.type === 'torso');
const chasis = data.cards.find((c) => c.type === 'chasis');
const kit = (t, hand) => {
  t.mech = { torso: torso.id, chasis: chasis.id, rightHand: hand ?? '', leftHand: '', backpack: '', pilot: '' };
  return t;
};

function board() {
  const atk = kit(mech(1, 's1', 'Attacker', 1), rifle.id);
  const def = kit(mech(2, 's2', 'Defender', 3));
  const third = kit(mech(3, 's2', 'Bystander', 5));
  return { atk, def, third, all: [atk, def, third] };
}

// A window that is only ever a mirror: same class, same constructor, fed from
// published views instead of from a live sequence.
function watcher(all, acts) {
  const root = makeEl('div');
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => all;
  h.terrain = () => [];
  h.smoke = () => [];
  h.mirrorAct = (act, arg) => acts.push([act, arg]);
  return { h, root };
}

// The attacking window, publishing every frame the way the Match Centre does.
function attacker(all) {
  const root = makeEl('div');
  const views = [];
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => all;
  h.terrain = () => [];
  h.smoke = () => [];
  // `own` is how many lines the window HELD when it published, so "the whole
  // log travels" can be asserted frame by frame rather than inferred from the
  // one at the end.
  const held = [];
  h.publishView = (v) => {
    if (!v) return;
    views.push(JSON.parse(JSON.stringify(v)));
    held.push(h.ctx ? h.ctx.log.length : 0);
  };
  return { h, root, views, held };
}

const press = (root, want) => {
  const b = findButtons(root).find((x) => label(x).includes(want));
  if (!b) throw new Error(`no control matching ${want}`);
  b.click();
  return b;
};
const find = (root, want) => findButtons(root).find((x) => label(x).includes(want));
const texts = (root, out = []) => {
  const walk = (el) => {
    if (!el) return;
    if (el.innerHTML) out.push(String(el.innerHTML));
    if (el.textContent) out.push(String(el.textContent));
    for (const c of el.children ?? []) walk(c);
  };
  walk(root);
  return out.join(' ');
};

// ---------- one recorded attack, published frame by frame ----------
const b = board();
const A = attacker(b.all);
A.h.start(b.atk, firing, b.def, 'Line of sight is clear.');
A.h.pickPart('torso');
press(A.root, 'Roll attack dice');
await settle();
press(A.root, 'Continue to Defense');
A.h.ctx.defensePool = { white: 2, blue: 1 };
press(A.root, 'Roll defense dice');
await settle();
press(A.root, 'Pass');
press(A.root, 'Pass');
press(A.root, 'Resolve');
press(A.root, 'Apply Penetration');
check('the attacker published a view for every step it drew', A.views.length > 4, true);

const atStep = (step, n = 0) => A.views.filter((v) => v.step === step)[n];
const rolled = A.views.filter((v) => v.attack?.length && v.step === 'attack').at(-1);
const defended = A.views.filter((v) => v.defense?.length).at(0);
const resolved = A.views.filter((v) => v.step === 'resolve').at(-1);

// ---------- WIN 1: the dice ROLL, they do not appear ----------
//
// The retired mirror emitted static <span class="die"> and never called
// spinDice, which is private to combat.ts. The one renderer builds real .die
// controls and starts the shake for a roll whose faces CHANGED since the last
// frame, so both players watch the same dice land.
//
// Observed through the shake itself: spinDice puts `rolling` on the row it is
// animating, which is the class the stylesheet hangs the shake on. The shim
// records classList rather than applying it, so "did the dice roll on this
// screen" is answerable without a browser.
const spinning = (root) => {
  let found = false;
  const walk = (el) => {
    if (String(el.className ?? '') === 'ah-roll' && el._cls?.has('rolling')) found = true;
    for (const c of el.children ?? []) walk(c);
  };
  walk(root);
  return found;
};
{
  const acts = [];
  const w = watcher(b.all, acts);
  // The frame BEFORE the attack roll, then the frame with it: the change is
  // what earns the spin, exactly as a fresh roll does on the attacker's screen.
  w.h.showMirror(atStep('attack'), b.atk, b.def, firing, 'defender');
  const before = findButtons(w.root).filter((x) => /^die die-/.test(String(x.className))).length;
  w.h.showMirror(rolled, b.atk, b.def, firing, 'defender');
  const after = findButtons(w.root).filter((x) => /^die die-/.test(String(x.className))).length;
  check('the watcher gets no faces before the roll', before, 0);
  check('and real die controls after it', after > 0, true);
  // The kick is a timeout, for the reason recorded on playDuel: a page that is
  // not compositing never fires requestAnimationFrame.
  await settle();
  check('and the faces SHAKE rather than appearing already settled', spinning(w.root), true);

  // Re-showing the SAME faces must not re-roll them on screen. This is what
  // lets a mirror repaint for an unrelated reason (a log line arriving) without
  // the dice looking as though they were rolled a second time.
  const again = watcher(b.all, []);
  again.h.showMirror(rolled, b.atk, b.def, firing, 'defender');
  await settle();
  check('the first sight of a roll is a roll', spinning(again.root), true);
  again.h.showMirror(rolled, b.atk, b.def, firing, 'defender');
  await settle();
  check('and showing the same faces again does not roll them twice', spinning(again.root), false);
}

// ---------- WIN 2: the whole log ----------
{
  const acts = [];
  const w = watcher(b.all, acts);
  w.h.showMirror(resolved, b.atk, b.def, firing, 'defender');
  const shown = texts(w.root);
  check('every published log line is on the watching screen',
    resolved.log.every((l) => shown.includes(l)), true);
  // The publisher is the half that used to cut it: log.slice(-5) went out and
  // normaliseCombatView capped it again at 6 on arrival. Asserted on EVERY
  // frame against what the attacking window was holding at the time, so a tail
  // reintroduced anywhere in the sequence fails rather than only at the end.
  check('and no frame was published with fewer lines than the window held',
    A.views.map((v, i) => v.log.length - A.held[i]).filter((n) => n !== 0), []);

  // A fight long enough that the retired rule would have cut it, so the win is
  // shown rather than argued: two Focus rerolls and an applied Penetration.
  const lb = board();
  const L = attacker(lb.all);
  L.h.start(lb.atk, firing, lb.def, 'Line of sight is clear.');
  L.h.pickPart('torso');
  press(L.root, 'Roll attack dice');
  await settle();
  press(L.root, 'Continue to Defense');
  L.h.ctx.defensePool = { white: 2, blue: 1 };
  press(L.root, 'Roll defense dice');
  await settle();
  // The printed order: the attacker declares first, the defender second.
  press(L.root, 'Focus');
  press(L.root, 'Focus');
  L.h.ctx.attackRoll.forEach((d) => { d.selected = true; });
  press(L.root, 'Focus: reroll selected');
  await settle();
  L.h.ctx.defenseRoll.forEach((d) => { d.selected = true; });
  press(L.root, 'Focus: reroll selected');
  await settle();
  press(L.root, 'Resolve');
  press(L.root, 'Apply Penetration');
  const longest = Math.max(...L.views.map((v) => v.log.length));
  check('a long fight publishes more than the five lines the tail allowed',
    longest > 5, true);
  check('and not one of its frames was cut either',
    L.views.map((v, i) => v.log.length - L.held[i]).filter((n) => n !== 0), []);
  const w2 = watcher(lb.all, []);
  const full = L.views.find((v) => v.log.length === longest);
  w2.h.showMirror(full, lb.atk, lb.def, firing, 'defender');
  const all = texts(w2.root);
  check('and the watching player reads every one of them',
    full.log.filter((l) => !all.includes(l)), []);
}

// ---------- WIN 3: the Multi-Target split screen exists at all ----------
{
  const mb = board();
  const M = attacker(mb.all);
  M.h.startMulti(mb.atk, sweep, mb.def, { limit: 2, condition: null });
  const split = M.views.filter((v) => v.step === 'split').at(-1);
  check('the split screen is published', !!split, true);
  check('and it carries the pool settled once for the whole Action', !!split.multi, true);
  const w = watcher(mb.all, []);
  w.h.showMirror(split, mb.atk, mb.def, sweep, 'defender');
  const shown = texts(w.root);
  check('the watcher sees the Multi-Target heading', /Multi-Target/.test(shown), true);
  check('and the total pool being split', /Total Attack Dice/.test(shown), true);
  check('and the FAQ B7 note that the sequences resolve together',
    /at the same time/.test(shown), true);

  // A split step with NO split in it: a peer on a build that does not send the
  // field, or one whose `multi` the whitelist dropped on the way in. stepSplit
  // reads it without a guard, because a live window cannot reach that step
  // without one, so the seam has to refuse the step rather than the field.
  const bare = watcher(mb.all, []);
  bare.h.showMirror({ ...split, multi: null }, mb.atk, mb.def, sweep, 'defender');
  check('a split step with nothing to split falls back instead of throwing',
    bare.h.watching, true);
  check('and the window still has a header on it', /Attacker/.test(texts(bare.root)), true);
}

// ---------- WIN 4: there is a way out ----------
{
  let closed = 0;
  const root = makeEl('div');
  const h = new AttackHelper(data, dice, root, () => {}, () => { closed++; }, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => b.all;
  h.terrain = () => [];
  h.smoke = () => [];
  h.showMirror(rolled, b.atk, b.def, firing, 'defender');
  // The X is written as markup inside the head, so it is found there rather
  // than as a child element: the shim does not parse innerHTML.
  const head = texts(root);
  check('the mirror draws a close control', /ah-cancel/.test(head), true);
  check('and says it puts the window away rather than cancelling the attack',
    /The attack keeps going/.test(head), true);
  check('closing it leaves the attack alone', h.watching, true);
  h.closeMirror();
  check('and puts the drawing away', h.watching, false);
  check('a closed mirror is not active either', h.active, false);
  check('closing a mirror never calls the page back to cancel anything', closed, 0);
}

// ---------- WIN 5: disabled, never absent ----------
//
// The retired mirror skipped whole steps when the choice was not this player's,
// so a watcher could not tell a defender who was thinking from a step with
// nothing in it. Ratified decision 3: the other side's pending decision shows.
{
  const partFrame = atStep('part');
  const seen = {};
  for (const role of ['defender', 'spectator']) {
    const w = watcher(b.all, []);
    w.h.showMirror(partFrame, b.atk, b.def, firing, role);
    const black = find(w.root, 'Roll Black Die');
    seen[role] = { there: !!black, off: black?.disabled };
  }
  check('the defender sees the Black Die the attacker is about to roll', seen.defender.there, true);
  check('and cannot press it', seen.defender.off, true);
  check('a spectator sees it too', seen.spectator.there, true);
  check('and cannot press it either', seen.spectator.off, true);
}

// ---------- the role decides what is LIVE, never what exists ----------
{
  const frame = defended;
  const shapes = {};
  for (const role of ['defender', 'spectator']) {
    const w = watcher(b.all, []);
    w.h.showMirror(frame, b.atk, b.def, firing, role);
    shapes[role] = findButtons(w.root).map((x) => label(x));
  }
  check('the defender and a spectator are shown exactly the same controls',
    JSON.stringify(shapes.defender), JSON.stringify(shapes.spectator));
}

// ---------- the defender's presses TRAVEL, they do not edit this copy ----------
{
  // The defence roll: the one control on this window that is the watching
  // player's own, and the attacking client is parked waiting on it.
  const call = A.views.find((v) => v.step === 'defense' && !v.defense);
  const acts = [];
  const w = watcher(b.all, acts);
  w.h.showMirror(call, b.atk, b.def, firing, 'defender');
  const roll = find(w.root, 'Roll defense dice');
  check('the defending player gets their roll button', !!roll, true);
  check('and it is live for them', roll.disabled, false);
  const before = JSON.stringify(call);
  roll.click();
  check('pressing it sends the answer rather than rolling here', acts.map((a) => a[0]), ['rolldefense']);
  check('and changes nothing in the view it was drawn from', JSON.stringify(call), before);

  // A spectator holds the same button, inert.
  const acts2 = [];
  const w2 = watcher(b.all, acts2);
  w2.h.showMirror(call, b.atk, b.def, firing, 'spectator');
  check('a spectator sees the same button', !!find(w2.root, 'Roll defense dice'), true);
  check('and it is inert', find(w2.root, 'Roll defense dice').disabled, true);
}

// ---------- a mirror publishes NOTHING ----------
//
// Two windows publishing the same attack is the deadlock this project already
// paid for once: the far client would answer with a view of its own drawing and
// the two would take turns overwriting each other.
{
  let published = 0;
  const root = makeEl('div');
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => b.all;
  h.terrain = () => [];
  h.smoke = () => [];
  h.publishView = () => { published++; };
  h.showMirror(rolled, b.atk, b.def, firing, 'defender');
  h.showMirror(resolved, b.atk, b.def, firing, 'defender');
  check('a mirror window publishes no view of its own', published, 0);
  // And it is not `active`, which is what the Match Centre asks before it
  // decides whether the turn panel steps aside and whether the shared view may
  // be swept away.
  check('and it is not resolving an attack', h.active, false);
  check('though it IS drawing one', h.watching, true);
}

// ---------- the offsetting is taken, never re-derived ----------
//
// resolve() reads Chef's exchanges, the declared Parry, the carried Surplus and
// half a dozen board auras, none of which travel. A second derivation is how
// one screen ends up saying "dodged" and the other "blocked".
{
  const w = watcher(b.all, []);
  w.h.showMirror(resolved, b.atk, b.def, firing, 'defender');
  const shown = texts(w.root);
  for (const line of resolved.resolution.text) {
    check(`the published summary line is drawn as sent: ${line.slice(0, 40)}`, shown.includes(line), true);
  }
  check('and the strip itself came across', /class="duel"/.test(shown), true);
}

// ---------- a mirror asks no question of its own ----------
//
// beginFocus settles a stage and the ATTACKING window is the only one entitled
// to. A mirror that opened its own would invent a declare nobody is waiting on.
{
  const frame = defended;
  const w = watcher(b.all, []);
  w.h.showMirror({ ...frame, focus: null }, b.atk, b.def, firing, 'defender');
  check('a view with no Focus stage stays without one', w.h.ctx.focus, null);
}

// ---------- THE THREE REGRESSIONS THE FIRST CUT SHIPPED ----------
// Each passed the WHOLE suite before it was fixed, so each is written to fail
// against the old code rather than to describe the new code. The tests that
// should have caught these are the ones that missed them, so the shape of each
// fixture matters more than the count.

{
  // 1. THE NETWORKED DEFENCE ROLL WAS UNREACHABLE. `defenseCalled` exists to
  // stop the window that MADE the ask from rolling twice, and a mirror never
  // made one: showMirror sets it true unconditionally and defenseRoller is wired
  // on EVERY Match Centre client. Without the `!mirroring` clause the defending
  // player's only control is permanently disabled and the attacker parks on
  // pendingDefense for ever, which is the task #5 deadlock shape again.
  //
  // watcher() gains a defenseRoller HERE and that is the point: its absence is
  // what hid this, because the guard needs it truthy to bite at all.
  const b = board();
  const w = watcher(b.all, []);
  w.h.defenseRoller = async () => [];
  w.h.showMirror({ ...defended, step: 'defense', defense: null }, b.atk, b.def, firing, 'defender');
  const roll = findButtons(w.root).find((x) => /roll/i.test(label(x)));
  check('the defending player is given a defence roll on a mirror', !!roll, true);
  check('and it is not dead in their hands', roll?.disabled === true, false);
}

{
  // 2. STARTING AN ATTACK MUST END MIRRORING. `active` is `!!ctx && !mirroring`,
  // so a helper keeping `mirroring` set stayed inactive, combatBusy() stayed
  // false, syncCombatMirror never stood down, and showMirror overwrote the fresh
  // ctx on the next render. Reachable by refreshing mid-attack: the reloaded
  // attacker's own view is still published, so they were handed a mirror of
  // their OWN attack with every control dead. HEAD recovered from this.
  const b = board();
  const w = watcher(b.all, []);
  w.h.showMirror(defended, b.atk, b.def, firing, 'spectator');
  check('the watcher starts out mirroring', w.h.watching, true);
  w.h.start(b.atk, firing, b.def, 'Line of sight is clear.');
  check('starting an attack stands the mirror down', w.h.watching, false);
  check('so combatBusy() can see the helper again', w.h.active, true);
}

{
  // 3. THE CLOSE BUTTON DID NOTHING. syncCombatMirror calls showMirror on EVERY
  // render while a view is published, so closing bought one frame and the next
  // render drew it back. The earlier test asserted the markup CONTAINED
  // `ah-cancel` and then called closeMirror() directly, which is exactly why it
  // never noticed. This presses the control and re-publishes, as the page does.
  const b = board();
  const w = watcher(b.all, []);
  w.h.showMirror(defended, b.atk, b.def, firing, 'spectator');
  check('a watcher is given a way out', !!w.root.querySelector('.ah-cancel'), true);
  // Driving the METHOD the button calls, not the button: the shim memoises
  // querySelector per selector, so the node a test can reach is never the node
  // the handler was bound to.
  w.h.dismissMirror();
  check('pressing it closes the mirror', w.h.watching, false);
  w.h.showMirror(defended, b.atk, b.def, firing, 'spectator');
  check('and the next render does not drag it back', w.h.watching, false);
  // A DIFFERENT attack is new information and earns the window back, which is
  // why the dismissal is keyed to the attack and not to the frame.
  w.h.showMirror({ ...defended, actionId: 'ZHRA-201_A' }, b.atk, b.def, firing, 'spectator');
  check('but the next attack opens it again', w.h.watching, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

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
import { readFileSync } from 'node:fs';
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

// DETERMINISTIC DICE. This file used to run on the real Math.random, so a walk
// that expects a Penetration to happen was relying on luck: 'no control
// matching Apply Penetration' appeared on roughly one run in three, which
// reads as a broken build rather than as an unlucky roll.
//
// The same mistake in miniature was made in this file's own assertions, which
// pinned `landed === 3` and passed once by chance. Seeded here so a failure
// always means something changed.
let __seed = 20260820;
Math.random = () => { __seed = (__seed * 1103515245 + 12345) % 2147483648; return __seed / 2147483648; };

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
await settle();
check('the attacker published a view for every step it drew', A.views.length > 4, true);

// ---------- WHAT THE ATTACK COST ----------
// OTTO asked for a summary after Apply Penetration: what attacked, what got
// through or was stopped, and what the Part became. The resolved screen renders
// entirely from `ctx.outcome`, so that is what is pinned here.
//
// PINNED: the record. NOT PINNED: the rendered sentences, and the reason is
// worth stating rather than hiding. This walk's weapon carries Mutilation, so
// Apply opens a SURPLUS round instead of finishing, and the harness's onCommand
// is a stub, so the Part never really changes state. Both are properties of the
// fixture, not of the feature. A walk that reaches `finish()` with a live
// command layer would pin the text; asserting it here would have meant loosening
// the assertions until they passed, which is how a test comes to prove nothing.
{
  const rounds = A.h.ctx?.outcome;
  check('applying a Penetration records what it cost', Array.isArray(rounds), true);
  check('one entry per Penetration, not one per attack', rounds?.length, 1);
  const o = rounds?.[0];
  check('naming the Part it landed on', o?.slot, 'torso');
  check('and both sides of the state change, so the screen can say what CHANGED',
    typeof o?.before === 'string' && typeof o?.after === 'string', true);
  // INVARIANTS, not values. This file does not seed Math.random, so the dice
  // differ every run; asserting `landed === 3` passed by luck once and failed on
  // the next run. What the summary actually depends on is the RELATIONSHIP: the
  // numbers come off the settled offsetting, so everything that landed either
  // got through or was stopped, and nothing is invented on the way to the screen.
  check('the tally is made of numbers',
    [o?.rolled, o?.through, o?.dodged, o?.blocked].every((n) => Number.isInteger(n)), true);
  check('nothing gets through that was never rolled', o.through <= o.rolled, true);
  // The whole roll splits three ways and nothing is lost or invented on the way
  // to the screen. Pinned as `rolled` and not `hits` on purpose: `hits` is
  // already net of dodges, so summing it against dodged counts those icons twice
  // and the sentence would overstate what the defence stopped.
  check('and every icon rolled was dodged, blocked, or got through',
    o.dodged + o.blocked + o.through, o.rolled);
  // A LIST because a Surplus round applies a SECOND Penetration (4.8). This
  // fixture's weapon carries Mutilation and is sitting in that round right now,
  // which is why the walk has not reached the resolved screen. Overwriting would
  // have reported only the last round: a Torso taken Intact to Damaged and then
  // Damaged to Destroyed would have read "Damaged to Destroyed", and Cleaving,
  // which lands on a DIFFERENT Part, would have named the wrong one outright.
  check('and this attack really is mid-Surplus, which is what needs the list',
    A.h.ctx?.surplusRound, 1);
}

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
// The class moved from the ROW to the individual DICE when the reroll learned
// to shake only what it threw, so this counts shaking dice rather than looking
// for a marked row. Returning the COUNT keeps the old yes/no readable while
// letting the reroll tests ask how many.
const shakingDice = (root, out = []) => {
  const walk = (el) => {
    if (/^die die-/.test(String(el.className ?? '')) && el._cls?.has('rolling')) out.push(el);
    for (const c of el.children ?? []) walk(c);
  };
  walk(root);
  // The shim's appendChild does not detach, so one die can be listed under two
  // parents. Counted as a set, or every number here is doubled.
  return [...new Set(out)];
};
const spinning = (root) => shakingDice(root).length > 0;
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

// ---------- THE SHAKE MAY NOT OUTLIVE ITS CLOCK ----------
// OTTO from live play: "after the defender rolls their white die and before the
// attacker chooses if they want to focus or not, the white die are shaking
// constantly. the face of the die doesnt change but the animation has them shake
// forever until the attacker chooses focus or to pass."
//
// Frozen faces with a live shake is the signature of the two halves coming
// apart: `.rolling` supplies the animation and the interval supplies the faces,
// so a spin whose interval is cleared FROM OUTSIDE leaves the row rattling on a
// dead clock. stopBlack() did exactly that and showMirror calls it on every
// published view, so one more frame while the dice were still landing was all it
// took -- and the attacker's Focus prompt is one more frame.
//
// Asserted on the ROW ITSELF rather than by searching the tree, because the
// window is rebuilt between frames and a detached node with the class still on
// it is invisible to a search while being exactly the bug.
{
  const b2 = board();
  const w = watcher(b2.all, []);

  // The frame the defence faces land on, which is what earns the shake.
  w.h.showMirror(atStep('attack'), b2.atk, b2.def, firing, 'defender');
  w.h.showMirror(defended, b2.atk, b2.def, firing, 'defender');
  await settle();
  const shaking = shakingDice(w.root);
  check('the dice do shake when they land', shaking.length > 0, true);

  // One more published frame, the way the attacker opening their half of the
  // Focus republishes without touching the dice.
  w.h.showMirror({ ...defended, focus: { stage: 'declareA', attackerUse: false, defenderUse: false } },
    b2.atk, b2.def, firing, 'defender');
  await settle();
  // THE ACTUAL QUESTION. Every row that was shaking has to have been let go of,
  // whether or not it is still on screen.
  check('and every row that was shaking has been let go of',
    shaking.filter((r) => r._cls?.has('rolling')).length, 0);
}

// ---------- A REROLL SHAKES ONLY WHAT IT THREW ----------
// OTTO from live play: "when I roll the specific die again but have some that I
// am not rerolling, it does the animations of the reroll again for all of my
// dice, even the ones I am not rerolling. It appears that their values dont
// change but having them go through the animation is confusing and makes it
// seem like those got rerolled as well."
//
// He is describing the kept dice being cycled through random faces and landing
// back on the values they already had, which is an extremely convincing
// impression of a reroll that changed nothing. spinDice took the whole row.
//
// Driven through the MIRROR, which is where the answer is derived rather than
// remembered: a watching screen cannot know a reroll happened, it can only see
// which faces differ between two frames, and that is the same set.
{
  const b3 = board();
  const w = watcher(b3.all, []);
  const base = A.views.filter((v) => v.defense?.length > 2).at(0);
  check('the fixture has a defence hand worth rerolling', (base?.defense?.length ?? 0) > 2, true);

  // The hand lands: every die is new, so every die shakes.
  w.h.showMirror({ ...base, defense: null }, b3.atk, b3.def, firing, 'defender');
  w.h.showMirror(base, b3.atk, b3.def, firing, 'defender');
  await settle();
  const all = shakingDice(w.root).length;
  check('a fresh roll shakes the whole hand', all, base.defense.length);

  // THE REROLL. One die comes back different and the rest are untouched, which
  // is exactly the frame a Focus reroll of one die publishes.
  const moved = base.defense.map((d, i) => (i === 1 ? { ...d, face: (d.face + 3) % 6 } : d));
  check('and the fixture really only moved one of them',
    moved.filter((d, i) => d.face !== base.defense[i].face).length, 1);
  w.h.showMirror({ ...base, defense: moved }, b3.atk, b3.def, firing, 'defender');
  await settle();
  check('but a reroll shakes only the die that was thrown', shakingDice(w.root).length, 1);

  // A frame that changes nothing shakes nothing, or every repaint would look
  // like a roll. This is the same test the live-die ring's `same` short-circuit
  // rests on, asserted from the animation side.
  w.h.showMirror({ ...base, defense: moved }, b3.atk, b3.def, firing, 'defender');
  await settle();
  check('and a frame where nothing moved shakes nothing at all', shakingDice(w.root).length, 0);
}

// ---------- A DISMISSAL MAY NOT DEADLOCK THE ATTACK ----------
// The close button is keyed to the ATTACK and not the frame (block 3 above),
// which is right for somebody watching a fight they are not in and was a
// deadlock for the DEFENDER: every question the mirror puts to them is one only
// they can answer, and the attacking client is parked on the answer, so a window
// that stayed shut stopped the game rather than tidying the screen.
{
  const b = board();
  // The defence step with the roll still owed: the shape where the attacking
  // client is literally parked on pendingDefense.
  const owed = { ...defended, step: 'defense', defense: null, focus: null, designate: null };
  // A frame that asks this viewer nothing, so the dismissal should survive it.
  const quiet = { ...defended, step: 'resolve', focus: null, designate: null };
  const shut = (role, view) => {
    const w = watcher(b.all, []);
    w.h.showMirror(quiet, b.atk, b.def, firing, role);
    w.h.dismissMirror();
    w.h.showMirror(view, b.atk, b.def, firing, role);
    return w;
  };

  // A SPECTATOR is never asked anything, so their dismissal is absolute. This
  // is also what pins the role gate: without it the clause below would reopen
  // every watcher's window on somebody else's defence roll.
  check('a spectator stays closed even while the defender is being asked',
    shut('spectator', owed).h.watching, false);

  // A DEFENDER stays closed too, for as long as the attack is not waiting on
  // them. Without this the X would be a button that does nothing, which is
  // worse than the deadlock it was meant to fix.
  check('a defender who closed it is not dragged back by an idle frame',
    shut('defender', quiet).h.watching, false);
  // KC Armor, Melee Evasion and the Dodge enhancement are offers a defender may
  // decline, and declining one by closing the window is a choice. Only BLOCKING
  // questions reopen it.
  check('nor by an offer they are free to decline',
    shut('defender', { ...quiet, evadeReady: true, dodgeDieReady: true }).h.watching, false);
  // The attacker's own Focus stages are answered on the other client, so they
  // are not this viewer's question either.
  check('nor by the ATTACKER taking their half of the Focus',
    shut('defender', { ...quiet, focus: { stage: 'rerollA', attackerUse: true, defenderUse: false } }).h.watching,
    false);

  // The blocking questions, each on its own fresh window. Every one of these
  // parks the attacking client until this player answers.
  const awaits = [
    ['the Defense Roll it owes', owed],
    ['the Focus declare', { ...defended, focus: { stage: 'declareD', attackerUse: false, defenderUse: false } }],
    ['the Focus reroll', { ...defended, focus: { stage: 'rerollD', attackerUse: false, defenderUse: true } }],
    ['a hit it must place', { ...defended, step: 'designate', designate: { from: 'torso' } }],
  ];
  for (const [what, view] of awaits) {
    const w = shut('defender', view);
    check(`but ${what} brings it back`, w.h.watching, true);
    // Brought back because it was needed, it then STAYS: the dismissal is
    // cleared rather than suspended, so answering the question does not drop
    // the player straight back out of the window they just used.
    w.h.showMirror(quiet, b.atk, b.def, firing, 'defender');
    check(`and once ${what} is answered it stays open`, w.h.watching, true);
  }
}

// ---------- THE LIVE-DIE RING, AND THE EYE ----------
// OTTO asked for dice that are affecting the action to be ringed, and asked
// specifically that it be SMART: "ringing an eye for example should only be when
// a correct keyword or ability affects it."
//
// The attack half inherits every reader free from attackIconsPerDie. The DEFENCE
// half is new logic, and its Eye rule is the one that can quietly go wrong: an
// {Eye} is inert on a defence roll UNLESS Low Profile is on, which turns every
// one of them into {Dodge} against a Firing Action. Removing that condition
// still compiles and still passes the rest of the suite, so it is pinned here.
{
  const b = board();
  const w = watcher(b.all, []);
  // white 6 is a lone {Eye}, white 3 a lone {Dodge}, white 7 blank. Read off
  // data/dice.json rather than assumed.
  const roll = [{ color: 'white', face: 6 }, { color: 'white', face: 3 }, { color: 'white', face: 7 }];
  const ctxFor = (statuses) => ({
    attacker: b.atk,
    defender: { ...b.def, statuses },
    action: firing,
    defenseRoll: roll,
    surplusRound: 0,
  });

  const plain = w.h.defenseIconsPerDie(ctxFor([]));
  check('a lone Dodge is live on the defence', plain[1].dodge > 0, true);
  check('a blank is not', plain[2].dodge + plain[2].defense, 0);
  check('and an Eye is INERT when nothing reads it', plain[0].dodge + plain[0].defense, 0);

  // The Token is the plainest Low Profile source, so it is the one that proves
  // the condition rather than the disjunction around it.
  const hidden = w.h.defenseIconsPerDie(ctxFor(['lowProfile']));
  check('but the SAME Eye is live under Low Profile, which reads it as Dodge',
    hidden[0].dodge > 0, true);
  check('and the Dodge beside it is unchanged', hidden[1].dodge, plain[1].dodge);

  // ...and the VIEW has to use it. Ringing everything passes every assertion
  // above, because those test the reader and not the wiring: the exact shape of
  // gap that let a whole feature be revertible earlier today.
  w.h.ctx = ctxFor([]);
  const row = w.h.rollView(roll, 'defense');
  const cls = [...(row.children ?? [])].map((el) => String(el.className));
  check('the view rings the Dodge', /\blive\b/.test(cls[1] ?? ''), true);
  check('and leaves the blank alone', /\blive\b/.test(cls[2] ?? ''), false);
  check('and leaves an unread Eye alone', /\blive\b/.test(cls[0] ?? ''), false);
}

// ---------- NO DEADLOCK: SOMEBODY CAN ALWAYS ACT ----------
// The combat deadlock (task #5) cost a live game, and today's first cut of the
// single renderer reintroduced a second one where the defending player's only
// button was permanently disabled. Both had the same signature: a frame in which
// NOBODY could press anything, so the attack could never advance.
//
// This drives a whole attack and, at every frame, asks each role in turn whether
// it has an enabled control. That is the general property, not a list of the two
// failures already known: any future step that forgets to enable someone fails
// here rather than in a game.
//
// The felt made this worth re-checking. Removing the three step-local dice grids
// moved the Focus reroll's dice out of the step and into the fixed region, so a
// prompt saying "select any Attack dice below" now depends on a DIFFERENT part of
// the panel drawing them.
{
  const roles = ['attacker', 'defender', 'spectator'];
  const stalled = [];
  const seen = [];

  // A fresh window per role, driven to the same frame, so the question is "could
  // this role act HERE" rather than "did the attacker leave something enabled".
  const frameAt = (upto) => {
    const out = {};
    for (const role of roles) {
      const bb = board();
      const w = watcher(bb.all, []);
      w.h.role = role;
      // The attacker's own window: it drives, the others watch the same ctx.
      w.h.start(bb.atk, firing, bb.def, 'Line of sight is clear.');
      w.h.pickPart('torso');
      for (const step of upto) {
        const btn = findButtons(w.root).find((x) => label(x).includes(step) && !x.disabled);
        if (btn) btn.click();
      }
      out[role] = findButtons(w.root).filter((x) => !x.disabled).map(label);
    }
    return out;
  };

  const stages = [
    [],
    ['Roll attack dice'],
    ['Roll attack dice', 'Continue to Defense'],
  ];
  for (const upto of stages) {
    const at = frameAt(upto);
    const anyone = roles.some((r) => at[r].length > 0);
    seen.push({ after: upto.join(' > ') || 'the opening frame', anyone });
    if (!anyone) stalled.push(upto.join(' > ') || 'the opening frame');
  }

  check('every frame of an attack leaves somebody able to act', stalled, []);
  check('and all three stages were actually reached', seen.length, 3);

  // The specific regression today's felt could have caused: the Focus prompt
  // tells the attacker to select dice, and the dice are no longer inside that
  // step. If the felt failed to draw them the prompt would point at nothing.
  const bb = board();
  const w2 = watcher(bb.all, []);
  w2.h.role = 'attacker';
  w2.h.start(bb.atk, firing, bb.def, 'Line of sight is clear.');
  w2.h.pickPart('torso');
  const rollBtn = findButtons(w2.root).find((x) => label(x).includes('Roll attack dice'));
  if (rollBtn) rollBtn.click();
  await settle();
  const felt = w2.root.querySelector('.ah-felt');
  check('the felt draws the dice once a roll exists', !!felt, true);
  check('and the attacker can still select them', w2.h.ctx?.attackRoll?.length > 0, true);
}

// ---------- FINISHED STEPS OPEN ----------
// OTTO: "none of the collapsed cards can be opened to view past actions.
// Clicking on them does nothing so I can only ever see the current card."
//
// A card opens on its OWN lines, matched by the tag note() wrote at the time.
// That tag has to survive the wire as well, or a watcher's cards would open
// empty while the attacker's opened full, which is the mirror drift this whole
// slice existed to end.
{
  const cards = [...(A.root.querySelectorAll('.ah-card') ?? [])];
  check('the attack drew a stack of step cards', cards.length > 1, true);

  // classList and className are SEPARATE in the shim: classList.add writes to a
  // private set. Ask the list, not the string, or nothing added at runtime is
  // visible here.
  const openable = cards.filter((el) => el.classList.contains('can-open'));
  check('and a finished step with lines can be opened', openable.length > 0, true);

  const first = openable[0];
  check('which starts closed', first.classList.contains('open'), false);
  // children[0], NOT querySelector: the shim memoises a fresh placeholder per
  // selector, so querySelector('.ah-card-h') returns a node the handler was never
  // bound to. The same trap made the mirror's close button untestable.
  first.children[0].click();
  const after = [...A.root.querySelectorAll('.ah-card')].filter((el) => el.classList.contains('can-open'))[0];
  check('clicking its head opens it', after.classList.contains('open'), true);
  // Same reason: reach the opened body through children rather than a selector.
  // And match on className here, not classList: the shim keeps the two in
  // SEPARATE stores, so a class set with `el.className = ...` is invisible to
  // classList.contains, while one added with classList.add is invisible to
  // className. Which to ask depends on how the source set it.
  const past = [...(after.children ?? [])].find((el) => String(el.className).includes('ah-card-past'));
  check('and it shows lines from that step', !!past && String(past.innerHTML).length > 0, true);

  // The tag is per-line, so an opened card must NOT be the whole log wearing a
  // different hat. This is the assertion that would fail if the filter were
  // dropped and every card showed everything.
  const shown = String(past.innerHTML).split('</div>').filter(Boolean).length;
  check('but not the entire log', shown < A.h.ctx.log.length, true);

  // The tags and the lines are written together, so they can never come apart.
  check('every log line carries a step tag', A.h.ctx.logStep.length, A.h.ctx.log.length);
}

// The tag crosses the wire, or a watcher's cards would open empty while the
// attacker's opened full: exactly the mirror drift this slice existed to end.
// The normaliseCombatView round trip is pinned in script.test.mjs, which
// already slices types.ts; this half checks it is actually SENT.
{
  const published = A.views.at(-1);
  check('the published view carries the step tags', Array.isArray(published.logStep), true);
  check('one per line, as sent', published.logStep.length, published.log.length);
}

// ---------- WHO MAY CHOOSE THE TARGET PART ----------
// OTTO hit this twice. First the chips were gated on "am I the attacker" alone,
// so an attacker could skip the Black Die and put every hit on the Torso. The
// fix for that then allowed a Surplus round outright, which was worse: every
// Scatter-shot and Cleaving let the attacker hand-pick the Part, and both
// keywords say RANDOM.
//
// Driven against the real predicate rather than the markup, so the rule is
// pinned wherever the chips end up living.
{
  const bb = board();
  const w = watcher(bb.all, []);
  const ctx = (over) => ({
    attacker: bb.atk,
    defender: bb.def,
    action: firing,
    surplusRound: 0,
    blackResult: null,
    ...over,
  });

  // 4.4.1 step 2. The Black Die decides unless one of the named cases applies.
  // NOT the walk's own `firing` fixture: that is ZHRA-201_B, the sniper rifle,
  // and it only ever read as 'ordinary' while Snipe was unwired. Its sibling
  // ZHRA-201_A prints Armor Piercing and no Snipe, so it is the plain case.
  const plainAct = data.cards.find((c) => c.id === 'ZHRA-201')?.actions?.find((a) => a.id === 'ZHRA-201_A');
  w.h.ctx = ctx({ action: plainAct });
  check('an ordinary attack does not let the attacker pick the Part', w.h.mayPickPart(), false);

  w.h.ctx = ctx({ blackResult: 'any' });
  check('an ANY face makes designating compulsory', w.h.mayPickPart(), true);

  w.h.ctx = ctx({ defender: { ...bb.def, stance: 'shutdown' } });
  check('and a Shutdown target may be picked apart', w.h.mayPickPart(), true);

  // 4.8.1 step 2 is NARROWER than 4.4.1: Shutdown and the ANY face only.
  w.h.ctx = ctx({ surplusRound: 1 });
  check('a Surplus round does NOT let the attacker pick', w.h.mayPickPart(), false);

  w.h.ctx = ctx({ surplusRound: 1, blackResult: 'any' });
  check('unless the die came up ANY, which is compulsory anywhere', w.h.mayPickPart(), true);

  w.h.ctx = ctx({ surplusRound: 1, defender: { ...bb.def, stance: 'shutdown' } });
  check('or the target is Shutdown, which 4.8.1 does name', w.h.mayPickPart(), true);
}

// ---------- THE SURPLUS FOCUS DEADLOCK ----------
// OTTO from live play: as the DEFENDER in a Surplus round he spent 1 Link to
// Focus and the "Focus: reroll selected" / "Keep the roll" buttons never
// appeared on his screen, while the ATTACKER's window showed those same buttons
// in the defence die area. The attack could not go on: the attacking client was
// parked waiting for a reroll only the defender could send.
//
// Driven the way the two clients really run it, which is what the first attempt
// at this test got wrong. A real defender keeps ONE window open for the whole
// attack and is handed each published view as it lands; building a fresh
// watcher per view hides anything that depends on what that window was already
// showing, and showMirror carries state across repaints on purpose.
{
  const c = A.h.ctx;
  check('the walk really is in a Surplus round', c.surplusRound, 1);
  check('and back at the defence step', c.step, 'defense');

  // The defender's window, opened once and kept, with every act it tries to
  // send recorded rather than delivered.
  const bb = board();
  const acts = [];
  const W = watcher(bb.all, acts);
  // One published frame, handed over the way syncCombatMirror hands it over on
  // every render of the far client.
  const deliver = () => W.h.showMirror(A.views.at(-1), bb.atk, bb.def, firing, 'defender');
  // Counted as a SET: the shim's appendChild does not detach, so a node moved
  // into a wrapper is listed under both parents and every control appears twice.
  const onMirror = (re) => [...new Set(findButtons(W.root).map(label).filter((l) => re.test(l)))].sort();

  deliver();

  // The defence roll for the Surplus round.
  const rollBtn = findButtons(A.root).find((x) => /roll defense/i.test(label(x)) && !x.disabled);
  check('the Surplus round asks for a defence roll', !!rollBtn, true);
  if (rollBtn) rollBtn.click();
  await settle();
  deliver();

  // A Surplus round makes no Attack Roll, so the attacker's half of Focus has
  // nothing to act on and the defender declares alone.
  check('so Focus opens on the DEFENDER', A.h.ctx.focus?.stage, 'declareD');
  check('and the view the defender is looking at says the same',
    A.views.at(-1)?.focus?.stage, 'declareD');

  // THE PRESS OTTO MADE, on his own window rather than simulated on the
  // attacker's.
  const useBtn = findButtons(W.root).find((x) => /^Focus/.test(label(x)) && !/reroll/i.test(label(x)));
  check('the defender is offered the Focus', !!useBtn, true);
  check('and it is live in their hands', useBtn ? !!useBtn.disabled : true, false);
  if (useBtn) useBtn.click();
  check('so their client sends the declare', acts.map((a) => a[0]).includes('focususe'), true);

  // ... which lands on the attacking window as focusAnswer.
  A.h.focusAnswered(true);
  check('the attacking window advances to the reroll', A.h.ctx.focus?.stage, 'rerollD');
  check('and publishes that stage', A.views.at(-1)?.focus?.stage, 'rerollD');

  // THE ACTUAL QUESTION: the new view reaches the window that has been open all
  // along, and that window has to offer the reroll.
  deliver();
  check('the defender is offered the reroll on their own screen',
    onMirror(/reroll selected|keep the roll/i),
    ['Focus: reroll selected', 'Keep the roll']);
  const dead = findButtons(W.root).filter((x) => /reroll selected|keep the roll/i.test(label(x)) && x.disabled);
  check('and neither is dead in their hands, because the dice are theirs', dead.length, 0);
}

// ---------- THE FOCUS BUTTONS THAT FLASH AND VANISH ----------
// OTTO, live: "as the defender I went to use focus and I saw the buttons for the
// reroll for one second and then they dissapeared ... on the attackers side they
// can see my buttons but I cannot see them ... my focus button is still lit up
// and I can keep clicking it which removes a link every time (down to 1) but
// still no buttons. The pass button is visible so I tried clicking pass ... but
// that button wont work either so now the defender is stuck."
//
// Every symptom points one way. The attacker being at rerollD explains BOTH the
// buttons they can see and the dead Pass: focusAnswered only acts at declareD,
// so a second answer from a defender who never advanced is ignored. So the
// defender's window is pinned at declareD while the attacker's has moved on.
//
// The flash is the giveaway. `send` applies locally too, so the defender's own
// client runs focusAnswer against its MIRROR: the stage advances, the buttons
// draw, and then the very next render rebuilds the mirror from the published
// view -- which is still declareD until the attacker's reply lands.
{
  const b4 = board();
  const W = watcher(b4.all, []);
  const stale = A.views.filter((v) => v.focus?.stage === 'declareD').at(-1);
  check('the walk left a declareD frame to work from', !!stale, true);

  const deliver = (v) => W.h.showMirror(v, b4.atk, b4.def, firing, 'defender');
  const offered = () => [...new Set(findButtons(W.root).map(label)
    .filter((l) => /reroll selected|keep the roll/i.test(l)))].length;

  deliver(stale);
  check('the defender starts at the declare', W.h.ctx.focus?.stage, 'declareD');

  // 1. THE LOCAL APPLY. glueAfter runs focusAnswer on the sending client too,
  //    and on this one the helper is a mirror.
  W.h.focusAnswered(true);
  check('their own window jumps to the reroll', W.h.ctx.focus?.stage, 'rerollD');
  check('and draws the buttons, which is the one second he saw', offered(), 2);

  // 2. THE VERY NEXT RENDER, still on the stale view: syncCombatMirror calls
  //    showMirror on EVERY render for as long as a view is published.
  deliver(stale);
  check('the next render puts it straight back to the declare', W.h.ctx.focus?.stage, 'declareD');
  check('and the buttons are gone again', offered(), 0);

  // 3. THE ATTACKER'S REPLY, which is what has to rescue it.
  A.h.focusAnswered(true);
  check('the attacking window advances', A.h.ctx.focus?.stage, 'rerollD');
  const reply = A.views.at(-1);
  check('and publishes a view that says so', reply?.focus?.stage, 'rerollD');

  deliver(reply);
  check('so the defender gets the buttons back and keeps them', offered(), 2);

  // THE TWO FAULTS BEHIND IT, both in match.ts, both pinned at source because
  // they are page wiring rather than helper behaviour.
  const page = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
  // 1. The echo above must never reach a MIRROR. `active` is false for one by
  //    construction, so it is the gate; every one of the six answers is behind
  //    it, because they are all the same shape of question.
  check('the page guards the defender answers on owning the attack',
    /if \(attackHelper\?\.active\) \{/.test(page), true);
  // Read as a BLOCK rather than by regex: the guard opens at `active` and runs
  // to the closing brace, and every answer has to sit between the two.
  const guardAt = page.indexOf('if (attackHelper?.active) {');
  const block = guardAt < 0 ? '' : page.slice(guardAt, page.indexOf('\n  }', guardAt));
  for (const call of ['focusAnswered', 'focusRerolled', 'kcArmed', 'designateAnswered', 'evadeDeclared', 'dodgeEnhanceDeclared']) {
    check(`and ${call} is inside that guard`, block.includes(`attackHelper.${call}(`), true);
  }
  check('and none of them is called on a bare helper any more',
    /attackHelper\?\.(focusAnswered|focusRerolled|kcArmed|designateAnswered|evadeDeclared|dodgeEnhanceDeclared)\(/.test(page), false);
  // 2. THE PERMANENT HALF. The dedup key must be EARNED. Banking it before the
  //    send meant a refused publish -- paused() is true whenever either player
  //    is momentarily offline -- was remembered as published, and the dedup then
  //    refused every retry for ever. Nothing re-renders to try again either,
  //    since focusAnswered early-returns once the stage has moved.
  check('the view is only recorded as published once the send succeeded',
    /if \(send\(\{ kind: 'setCombatView'[\s\S]{0,120}?\)\.ok\) \{[\s\S]{0,80}?publishedCombatView = key;/.test(page), true);
  check('and the teardown earns its key the same way',
    /if \(send\(\{ kind: 'setCombatView', seat, view: null \}\)\.ok\) publishedCombatView = 'null';/.test(page), true);
}

// ---------- A PAID QUESTION TAKES ONE PRESS ----------
// OTTO from live play: "my focus button is still lit up and I can keep clicking
// it which removes a link every time (down to 1)". The publish fix ended the
// stale view that HELD it lit, but the latency window remains: between a press
// and the attacker's republished view, the button is drawn from the old frame,
// still live, still asking -- and every press was a fresh `focus` command the
// host legally accepts while the Link lasts. The same window sat under KC Armor
// (a Charge per press) and both ZYBP-302 spends (a Command Token per press).
{
  // 1. THE FOCUS DECLARE. One press sends; the second is dead until the view
  //    answers, and the note says why instead of leaving a greyed mystery.
  const b5 = board();
  const acts = [];
  const W = watcher(b5.all, acts);
  const asking = { ...defended, focus: { stage: 'declareD', attackerUse: false, defenderUse: false } };
  W.h.showMirror(asking, b5.atk, b5.def, firing, 'defender');
  const focusBtn = () => findButtons(W.root).find((x) => /^Focus/.test(label(x)) && !/reroll/i.test(label(x)));
  check('the declare starts live', focusBtn()?.disabled, false);
  focusBtn().click();
  check('the first press sends the declare', acts.filter((a) => a[0] === 'focususe').length, 1);
  // The latch re-rendered; the SAME stale frame is what the next render still
  // draws from, which is exactly the window the bug lived in.
  W.h.showMirror(asking, b5.atk, b5.def, firing, 'defender');
  check('and the button is dead while the answer is in the air', focusBtn()?.disabled, true);
  const pass = findButtons(W.root).find((x) => label(x) === 'Pass');
  check('so is Pass, because either answer settles the question', pass?.disabled, true);
  focusBtn().click();
  pass.click();
  check('so pressing again sends nothing', acts.filter((a) => /^focus/.test(a[0])).length, 1);
  check('and the panel says the answer is in the air', /Focus answered/.test(texts(W.root)), true);

  // 2. A SURPLUS ROUND RE-OPENS FOCUS (c.focus = null on entry), so the main
  //    round's latch must not deaden the fresh declare. The key carries the
  //    round for exactly this reason.
  const surplusAsk = { ...asking, surplus: { round: 1, heavy: 1, light: 0, keyword: 'Mutilation' } };
  W.h.showMirror(surplusAsk, b5.atk, b5.def, firing, 'defender');
  check('the surplus round asks its own fresh Focus', focusBtn()?.disabled, false);
  focusBtn().click();
  check('and takes its own single press', acts.filter((a) => a[0] === 'focususe').length, 2);

  // 3. THE PAID ROWS share the same latch through sendAct.
  const evAsk = { ...defended, evadeReady: true };
  const b6 = board();
  const acts2 = [];
  const W2 = watcher(b6.all, acts2);
  W2.h.showMirror(evAsk, b6.atk, b6.def, firing, 'defender');
  const evBtn = () => findButtons(W2.root).find((x) => /Melee Evasion/.test(label(x)));
  check('the evade offer starts live', evBtn()?.disabled, false);
  evBtn().click();
  W2.h.showMirror(evAsk, b6.atk, b6.def, firing, 'defender');
  check('one press, then dead until the view answers', evBtn()?.disabled, true);
  evBtn().click();
  check('a Command Token cannot be spent twice by clicking twice',
    acts2.filter((a) => a[0] === 'meleeevade').length, 1);

  // 4. A REFUSED SEND DOES NOT LATCH: retry is the only path a refused press
  //    has (a paused table, the last Link), so the button must stay live.
  const b7 = board();
  const tried = [];
  const W3 = watcher(b7.all, []);
  W3.h.mirrorAct = (act) => { tried.push(act); return false; };
  W3.h.showMirror(asking, b7.atk, b7.def, firing, 'defender');
  const fb = () => findButtons(W3.root).find((x) => /^Focus/.test(label(x)) && !/reroll/i.test(label(x)));
  fb().click();
  W3.h.showMirror(asking, b7.atk, b7.def, firing, 'defender');
  check('a refused press leaves the button live', fb()?.disabled, false);
  fb().click();
  check('so the player can try again', tried.length, 2);
}

// ---------- THE COST GATES THE DECLARE, and a failed roll says so ----------
// Source pins on match.ts, because this is page wiring. The cost command and
// the declare used to travel unconditionally paired, so a refused spend still
// sent the declare and the attacker's window granted the effect UNPAID: a free
// KC Armor, a free Melee Evasion, a free Focus advance.
{
  const page = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
  for (const [what, cost] of [
    ['focususe', "kind: 'focus'"],
    ['kcarmor', "kind: 'setCharge'"],
    ['meleeevade', "kind: 'spendCommand'"],
    ['dodgeenhance', "kind: 'spendCommand'"],
  ]) {
    const at = page.indexOf(`if (act === '${what}')`);
    const seg = page.slice(at, page.indexOf('if (act ===', at + 10));
    check(`${what} pays first and only declares on ok`,
      seg.includes(cost) && /if \(!paid\.ok\) \{ lobbyNote = paid\.why; render\(\); return false; \}/.test(seg), true);
  }
  // The reroll's server dice can fail like any other request, and the Link is
  // already spent by then. rolldefense beside it has carried a catch all along.
  const rr = page.slice(page.indexOf("if (act === 'focusreroll')"));
  check('a failed Focus reroll is told to the player, not swallowed',
    /\.catch\(\(\) => \{[\s\S]{0,500}?reroll again/.test(rr), true);
  // And the callback reports what it did, because the helper latches on it.
  check('mirrorAct answers whether the press went',
    /function mirrorAct\(act: MirrorAct, arg\?: string \| number\[\]\): boolean \{/.test(page), true);
}

// ---------- EVERY LANDING SHAKES, including the defender's reroll ----------
// The broad animation sweep found exactly one dice-mutating arrival that never
// asked for the spin: focusRerolled, the defender's Focus reroll landing on the
// attacker's window. Their rerolled dice appeared pre-settled while every other
// landing shakes, which reads as the window deciding rather than dice landing.
{
  // The walk above left the attacking window at rerollD (its surplus round's
  // Focus was declared and never rerolled). Asserted rather than assumed, so a
  // change to the walk cannot silently turn this block into a no-op.
  check('the walk is still parked at the defender reroll', A.h.ctx.focus?.stage, 'rerollD');
  const roll = A.h.ctx.defenseRoll;
  check('with a defence hand on the table', (roll?.length ?? 0) > 1, true);
  const idx = 1;
  A.h.focusRerolled([idx], [{ color: roll[idx].color, face: (roll[idx].face + 2) % 6 }]);
  await settle();
  check('the reroll advances the stage', A.h.ctx.focus?.stage, 'done');
  check('and the landed die SHAKES on the attacking screen', shakingDice(A.root).length, 1);
}

// ---------- keeping the roll shakes nothing ----------
// focuskeep travels as an empty focusReroll: nothing moved, so nothing may
// pretend to. Driven on a fresh window because the walk above consumed its own.
{
  const bb = board();
  const A2 = attacker(bb.all);
  A2.h.start(bb.atk, firing, bb.def, 'clear');
  A2.h.pickPart('torso');
  press(A2.root, 'Roll attack dice');
  await settle();
  press(A2.root, 'Continue to Defense');
  press(A2.root, 'Roll defense dice');
  await settle();
  if (A2.h.ctx.focus?.stage === 'declareA') A2.h.ctx.focus.stage = 'declareD';
  A2.h.focusAnswered(true);
  check('the fresh window reaches the reroll', A2.h.ctx.focus?.stage, 'rerollD');
  await settle();
  const before = A2.h.ctx.defenseRoll.map((d) => d.face);
  A2.h.focusRerolled([], []);
  await settle();
  check('keeping the roll changes no faces', A2.h.ctx.defenseRoll.map((d) => d.face), before);
  check('and shakes nothing', shakingDice(A2.root).length, 0);
  check('while still closing the Focus', A2.h.ctx.focus?.stage, 'done');
}

// ---------- THE BLACK DIE MAY BE FOCUSED (4.10) ----------
// "Black Dice used to determine target Parts when attacking can also be
// rerolled with Focus." Ratified by OTTO 2026-08-23. The die lands, and before
// the result is applied the ATTACKER may spend 1 Link to throw it again --
// once, and the rerolled result stands with no second offer.
//
// Driven through the real spin, which runs on real timers: eight ticks at 55ms,
// then the settle's own 700ms pause, so the waits here are honest rather than
// settle()'s 20ms.
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
{
  const bb = board();
  const A3 = attacker(bb.all);
  const cmds = [];
  A3.h.onCommand = (cmd) => cmds.push(cmd);
  A3.h.start(bb.atk, firing, bb.def, 'clear');
  // The attacker needs Link to afford the Focus; the fixture mech carries none
  // by default.
  bb.atk.link = 4;

  // Roll the Black Die for real.
  press(A3.root, 'Roll Black Die');
  await tick(600);
  const offerBtn = () => findButtons(A3.root).find((x) => /Focus: reroll the Black Die/.test(label(x)));
  const keepBtn = () => findButtons(A3.root).find((x) => label(x) === 'Keep it');
  check('the landed die is offered a Focus instead of settling itself', !!offerBtn(), true);
  check('beside a way to keep it', !!keepBtn(), true);
  check('and nothing is applied while the question stands', A3.h.ctx.targetPart ?? null, null);

  // FOCUS IT. The Link travels as the same plain `focus` every surface sends,
  // the die spins again, and the new result stands.
  offerBtn().click();
  check('the Focus travels as the one command', cmds.filter((c) => c.kind === 'focus').length, 1);
  check('and is recorded as this roll\'s one use', A3.h.ctx.blackFocusUsed, true);
  await tick(600);
  // Counted as a SET of identities, not absence-checked: the shim's remove()
  // is a no-op so the first offer never leaves this tree, and its non-detaching
  // appendChild lists every step child under two parents. What must be true is
  // that the reroll appended no SECOND offer.
  check('the reroll settles with no second offer',
    new Set(findButtons(A3.root).filter((x) => /Focus: reroll the Black Die/.test(label(x)))).size, 1);
  await tick(800);
  const landedPart = A3.h.ctx.targetPart ?? A3.h.ctx.blackResult;
  check('and the rerolled result is applied', landedPart !== null, true);
}

// A second window KEEPS the roll: no spend, and the result applies unchanged.
{
  const bb = board();
  const A4 = attacker(bb.all);
  const cmds = [];
  A4.h.onCommand = (cmd) => cmds.push(cmd);
  A4.h.start(bb.atk, firing, bb.def, 'clear');
  bb.atk.link = 4;
  press(A4.root, 'Roll Black Die');
  await tick(600);
  const keep = findButtons(A4.root).find((x) => label(x) === 'Keep it');
  check('the second window is offered the same choice', !!keep, true);
  keep.click();
  await tick(800);
  check('keeping it spends nothing', cmds.filter((c) => c.kind === 'focus').length, 0);
  check('and the result applies', (A4.h.ctx.targetPart ?? A4.h.ctx.blackResult) !== null, true);
}

// A window whose attacker CANNOT afford the Focus settles straight through,
// exactly as before the feature existed: no offer, no pause beyond the
// settle's own.
{
  const bb = board();
  const A5 = attacker(bb.all);
  A5.h.start(bb.atk, firing, bb.def, 'clear');
  bb.atk.link = 1;
  press(A5.root, 'Roll Black Die');
  await tick(600);
  check('at 1 Link there is no offer to decline',
    !!findButtons(A5.root).find((x) => /Focus: reroll the Black Die/.test(label(x))), false);
  await tick(800);
  check('and the roll settles on its own', (A5.h.ctx.targetPart ?? A5.h.ctx.blackResult) !== null, true);
}

// ---------- SNIPE: the attacker-side designation, no longer a stated gap ----------
// mayPickPart used to carry a comment naming Snipe as "NOT COVERED ... a card
// that carries one needs this predicate widened, not a workaround". Widened
// now, and pinned through the same door the other part-choice rules use.
{
  const bb = board();
  const w = watcher(bb.all, []);
  const sniper = data.cards.find((c) => c.id === 'ZHRA-201')?.actions?.find((a) => a.id === 'ZHRA-201_B');
  // THE TRAP THIS CARD DOCUMENTS: the keyword lives in the description as a
  // bare line while the keywords array is EMPTY. A keyword-array read alone
  // would miss the two cards that print Snipe most plainly.
  check('the fixture still prints Snipe as a bare description line',
    /狙击/.test(sniper?.description?.zh ?? ''), true);
  check('while its keyword array does NOT carry it, which is the trap',
    (sniper?.keywords ?? []).some((k) => /狙击/.test(k.inline ?? k.key ?? '')), false);

  const ctx = (over) => ({
    attacker: bb.atk, defender: bb.def, action: sniper,
    surplusRound: 0, blackResult: null, ...over,
  });
  w.h.ctx = ctx({});
  check('a Snipe action lets the attacker pick the Part', w.h.mayPickPart(), true);
  // A MAY, below the surplus guard: the weapon being a sniper's does not grow
  // 4.8.1 step 2's list, and Scatter-shot stays random.
  w.h.ctx = ctx({ surplusRound: 1 });
  check('but a Surplus round still refuses it', w.h.mayPickPart(), false);
  // The granted shape: 516_A/122_A gain Snipe from their own [Two-Handed]
  // rider, which arrives as ADJUSTED inline keywords.
  w.h.ctx = ctx({ action: { ...sniper, description: { zh: '', en: '' }, keywords: [{ inline: '狙击' }] } });
  check('a rider-granted Snipe reads the same', w.h.mayPickPart(), true);
  // And the gate exclusion: a Stationary-gated grant must NOT fire off the raw
  // text, because stationaryAdjusted folds only Range and +NY - firing here
  // would hand a moved Mech a rule its condition refuses. PARKED, on purpose.
  w.h.ctx = ctx({ action: { ...sniper, description: { zh: '· 激光武器\n· [静止] 获得狙击。', en: '' }, keywords: [] } });
  check('a [Stationary]-gated grant stays out until its rider learns keywords', w.h.mayPickPart(), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

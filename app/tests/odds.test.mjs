// The odds of an attack (src/ai/odds.ts, and AttackHelper.reading in
// combat.ts): AI-OPPONENT-PLAN.md, M5.
//
// The claim under test is rule R5: a dice option is valued by the engine's own
// pools and its own resolution. So the odds module is held to the combat
// window three ways, each closer to a played attack than the last:
//
//   1. ROLL FOR ROLL. For every attack of the copied squads, and then for
//      every Part, pilot and Drone in the card data mounted on an attacker or
//      a defender, random hands are put on the window's own table and its
//      resolve() is asked what they come to. The reading's faces, added up and
//      settled by odds.ts, must say the same: Hits, Penetration, what is left
//      over, the Lightning that got through. The pools must be the window's.
//   2. BY HAND. Readings small enough to count on paper.
//   3. PLAYED. The same attacks made for real between two computer seats, a
//      window each and the two-seat protocol between them, a few thousand
//      times on seeded dice: what happened to the target, as often as the
//      forecast said it would.
//
// And the seam offers it: an attack among a seat's answers carries its
// forecast, and so does every answer in the window with dice still to come.
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('The odds of an attack\n');

const { M, data } = await loadEngine('odds', [
  "export * as SEAT from '../src/seat';", "export * as TURN from '../src/turn';", "export * as AI from '../src/ai/index';", "export * as ODDS from '../src/ai/odds';",
]);
const { Odds, forecastOf, settle, handOf, attackSums, defenceSums, Sheet, InHand, WORTH, worthOfForecast } = M.ODDS;
const [alley] = data.solo.scenarios;
const clone = (x) => JSON.parse(JSON.stringify(x));
const name = (t) => (t.label.startsWith('ADK15P') ? 'Porcupine' : t.label.startsWith('ADK60S') ? 'Raven' : t.label.startsWith('ADK30C') ? 'Tarantula' : t.label);
const tick = () => new Promise((r) => { setImmediate(r); });
const sides = (color) => data.dice.dice[color].faces.length;
// A Sheet's whole forecast, for a Sheet built by hand.
const forecastFromSheet = (sheet) => {
  const ends = sheet.whole().ends;
  const out = { kill: 0 };
  for (const [end, p] of ends) if (/torso>destroyed|main>destroyed/.test(end)) out.kill += p;
  return out;
};

// ---------- a table to attack across ----------
const base = (() => {
  const t = tableAtRoundOne(M, data, alley);
  if (t.refused.length) throw new Error(t.refused.join('; '));
  return t.state;
})();
// The Action Phase, the squads face to face on an open board: the Mire beside
// the Wild Cat, the Dune behind it, the Drones around them.
const stage = (over = () => {}) => {
  const s = clone(base);
  s.map = 'none';
  const U = Object.fromEntries(s.tokens.map((t) => [name(t), t]));
  const at = (t, c, r, f) => { t.col = c * 3; t.row = r * 3; if (f !== undefined) t.facing = f; };
  at(U.Mire, 5, 4, 1); at(U.Dune, 3, 4, 1); at(U['Wild Cat'], 6, 4, 3); at(U.Porcupine, 5, 6, 0); at(U.Raven, 7, 5, 3); at(U.Tarantula, 8, 4, 3);
  s.round.phase = 2; s.script.stage = '1:2'; s.script.acted = []; s.script.passed = []; s.script.opp = null;
  s.script.revealed = ['s1', 's2'];
  for (const t of s.tokens) if (t.kind === 'mech') t.timing = 'firing';
  over(s, U, at);
  // The Action Opportunity of one Mech, the others having had theirs.
  const turnOf = (mech, timing) => {
    mech.timing = timing ?? mech.timing;
    s.script.acted = s.tokens.filter((x) => x.kind === 'mech' && x.uid !== mech.uid).map((x) => x.uid);
    s.script.opp = null;
    return M.G.opportunity(data, s);
  };
  return { s, U, at, turnOf };
};
// Every attack a unit of the table carries, at every enemy: the window opens
// on any of them (range and sight are the page's to judge before it does).
const attacksOf = (s) => {
  const out = [];
  for (const a of s.tokens) {
    for (const { card } of M.U.tokenCards(data, a)) {
      for (const act of card.actions ?? []) {
        if (act.type !== 'Firing' && act.type !== 'Melee') continue;
        for (const d of s.tokens) if (d.side !== a.side && d.kind !== 'projectile') out.push({ uid: a.uid, actionId: act.id, targetUid: d.uid, mode: 'attack' });
      }
    }
  }
  return out;
};

const odds = new Odds(data);

// ---------- a reading is a read ----------
{
  const { s } = stage();
  const before = JSON.stringify(s);
  const all = attacksOf(s);
  const read = all.map((a) => odds.read(s, a));
  const made = all.map((a) => odds.forecast(s, a));
  check('every attack of the copied squads is read and forecast, and the table is left exactly as it was',
    [all.length, read.filter((r) => !r).length, made.filter((f) => !f).length, JSON.stringify(s) === before], [30, 0, 0, true]);
  const sane = made.every((f) => [f.hit, f.pen, f.damage, f.destroy, f.kill].every((p) => p >= 0 && p <= 1 + 1e-9) && f.pen <= f.hit + 1e-9 && f.kill <= f.destroy + 1e-9 && f.link >= 0);
  check('each forecast is a set of chances: a Penetration is a Hit, a kill is a destroyed Part', sane, true);
  check('and where the hit may land adds up to the whole of it',
    made.every((f) => Math.abs(f.parts.reduce((n, p) => n + p.share, 0) - 1) < 1e-9), true);
  check('asked twice, an attack is worked out once', odds.forecast(s, all[0]) === odds.forecast(s, all[0]), true);
  check('an attack that cannot be opened has no reading: a unit that is not there, an Action it does not carry',
    [odds.read(s, { uid: 4242, actionId: '535_A', targetUid: all[0].targetUid }), odds.read(s, { ...all[0], actionId: 'nothing' })], [null, null]);
  // A Drone the table holds no state for (a Mech's absent Part is a Part it
  // does not have). The Porcupine has Structure, so the reading makes it
  // Damaged for a moment to deal its second pool, and must put back exactly
  // what it found: nothing.
  const bare = stage((st, V) => { delete V.Porcupine.partStates.main; });
  const body = odds.read(bare.s, { uid: bare.U.Mire.uid, actionId: '535_A', targetUid: bare.U.Porcupine.uid })?.parts[0];
  check('a unit the table holds no state for is read as Intact, and is left with none',
    [body?.state, body?.next, !!body?.mutilated, 'main' in bare.U.Porcupine.partStates], ['intact', 'damaged', true, false]);
}
{
  // What is sent before the window opens (an attack's payment, a Charge spent,
  // a Missile's flight) has landed before the attack is read. Told apart here
  // by a change of Stance, which changes the Dune's pool: its Cooler adds a Red
  // die in Offensive Stance, and its hollow Heavy Hits count there.
  const st = stage((s0, V) => { V.Dune.stance = 'defensive'; });
  st.turnOf(st.U.Dune, 'firing');
  const off = stage((s0, V) => { V.Dune.stance = 'offensive'; });
  off.turnOf(off.U.Dune, 'firing');
  const a = { uid: st.U.Dune.uid, actionId: '032_A', targetUid: st.U['Wild Cat'].uid };
  const flip = { kind: 'setStance', seat: 's1', uid: st.U.Dune.uid, stance: 'offensive' };
  const now = odds.read(st.s, a);
  const after = odds.read(st.s, { ...a, before: [flip] });
  const want = odds.read(off.s, a);
  check('an attack is read on the table that what is sent before it leaves, and the table in play is not touched',
    [now.attack, after.attack, JSON.stringify(after.faces) === JSON.stringify(want.faces), JSON.stringify(after.faces) === JSON.stringify(now.faces), st.U.Dune.stance],
    [{ red: 3, yellow: 0 }, { red: 4, yellow: 0 }, true, false, 'defensive']);
  check('and one whose payment the engine would refuse cannot be made at all: it has no reading',
    odds.read(st.s, { ...a, before: [{ kind: 'setStance', seat: 's1', uid: 4242, stance: 'offensive' }] }), null);
}

// ---------- the window in the middle of an attack ----------
// The calculator's own window, opened by hand and left open, so the suite can
// put dice on its table.
// A Multi-Target is opened as its Begin makes it with nothing split, the
// whole pool on the one target, as the calculator reads it.
const openOn = (state, a) => {
  const open = M.TURN.attackOpening(data, state, a.uid, a.actionId, a.targetUid, a.mode ?? 'attack', a);
  if (!open) return null;
  odds.table = state;
  odds.helper.start(open.attacker, open.action, open.defender, open.note, open.protection.white, open.protection.note, a.mode === 'explosion', a.mode === 'intercept');
  return odds.helper;
};
const shut = () => {
  odds.helper.cancel();
  for (const back of odds.undo.splice(0).reverse()) back();
  odds.table = null;
};
{
  const { s, U } = stage();
  const shot = { uid: U.Mire.uid, actionId: '536_B', targetUid: U['Wild Cat'].uid };
  // The same attack, read before any of it is in hand.
  const fresh = odds.read(s, shot);
  const h = openOn(s, shot);
  const c = h.ctx;
  // Part way through: the Part known, both rolls on the table, a Focus declared.
  c.targetPart = 'chasis'; c.designatedParry = 0; c.step = 'defense';
  c.attackRoll = [{ color: 'red', face: 0, selected: true }, { color: 'yellow', face: 2, selected: false }];
  c.defenseRoll = [{ color: 'white', face: 3, selected: false }];
  c.focus = { stage: 'declareD', attackerUse: true, defenderUse: false };
  c.lightningThrough = 2; c.eyeSwaps = 1; c.dodgeOnLightning = 1; c.evadeUsed = true;
  const snap = () => JSON.stringify({ ...c, attacker: c.attacker.uid, defender: c.defender.uid, action: c.action.id });
  const before = snap();
  const table = JSON.stringify(s);
  const r = h.reading();
  check('asked in the middle of an attack, the window is left exactly as it was: its dice, its Part, its Focus, what the player had spent',
    [snap() === before, JSON.stringify(s) === table, c.attackRoll[0].selected], [true, true, true]);
  check('and says where the attack has got to: the step, the Part, the dice on the table, the Focus, the Evasion',
    [r.hand.step, r.hand.part, r.hand.round, r.hand.attack, r.hand.defense, r.hand.focus, r.hand.evade],
    ['defense', 'chasis', 0, [{ color: 'red', face: 0 }, { color: 'yellow', face: 2 }], [{ color: 'white', face: 3 }], 'declareD', true]);
  check('what a die comes to is read as of the attack before any of it: an Evasion already declared is the hand\'s, and is not added to every face',
    [JSON.stringify(r.faces) === JSON.stringify(fresh.faces), JSON.stringify(r.parts) === JSON.stringify(fresh.parts)], [true, true]);
  shut();
  check('a window with no attack open has nothing to read', odds.helper.reading(), null);
}

// ---------- 1. roll for roll ----------
//
// The window's own resolve() against the reading's faces added up.
const rng = new M.AI.Rng('odds');
const hand = (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: Math.max(0, n) }, () => ({ color, face: rng.int(sides(color)) })));
const rolled = (dice) => dice.map((d) => ({ ...d, selected: false }));
// Compares `rolls` hands on every Part of one attack. Answers with what did
// not agree, each as a line.
function rollForRoll(state, a, rolls) {
  const r = odds.read(state, a);
  if (!r) return { read: false, wrong: [] };
  const h = openOn(state, a);
  const c = h.ctx;
  const d = c.defender;
  const wrong = [];
  const say = (what) => { if (wrong.length < 3) wrong.push(`${a.actionId} at ${name(d)}: ${what}`); else wrong.length += 0; };
  let bad = 0;
  try {
    for (const part of r.parts) {
      c.surplusRound = 0; c.carried = { heavy: 0, light: 0 }; c.declared = null; c.targetPart = part.slot; c.designatedParry = 0;
      const pool = h.suggestedDefensePool(part.slot);
      if (pool.white !== part.defense.white || pool.blue !== part.defense.blue) { bad++; say(`${part.slot} pool ${JSON.stringify(pool)} read as ${JSON.stringify(part.defense)}`); }
      // The Parry that may be declared on it, with its dice.
      const offer = r.location.declare.find((x) => x.slot === part.slot && x.parry > 0);
      if (offer) {
        c.designatedParry = offer.parry;
        const armed = h.suggestedDefensePool(part.slot);
        c.designatedParry = 0;
        if (!part.parried || armed.white !== part.parried.white || armed.blue !== part.parried.blue) { bad++; say(`${part.slot} pool with its Parry ${JSON.stringify(armed)} read as ${JSON.stringify(part.parried)}`); }
      } else if (part.parried) { bad++; say(`${part.slot} is read with a Parry nobody may declare`); }
      for (let i = 0; i < rolls; i++) {
        const attack = hand(c.attackPool);
        const defense = hand(pool);
        c.attackRoll = rolled(attack); c.denseDone = false; c.defenseRoll = rolled(defense);
        h.denseArmorStrip();
        const real = h.resolve();
        const sum = handOf(r, part, attack, defense);
        const model = settle(r, sum.attack, sum.defence);
        const same = real.hits === model.hits && real.penetrating === model.pen && real.unoffset.heavy === model.carried.heavy
          && real.unoffset.light === model.carried.light && (c.lightningThrough ?? 0) === model.bolt;
        if (!same) {
          bad++;
          say(`${part.slot} ${attack.map((x) => `${x.color[0]}${x.face}`).join('')} v ${defense.map((x) => `${x.color[0]}${x.face}`).join('')}: the window ${JSON.stringify({ hits: real.hits, pen: real.penetrating, left: real.unoffset, bolt: c.lightningThrough ?? 0 })}, the reading ${JSON.stringify(model)}`);
        }
      }
      // The Surplus round on this Part: its pool as it stands, and after its
      // own first Penetration. (An Action that causes no damage never
      // Penetrates, so it never has one.)
      c.surplusRound = 1; c.attackRoll = null;
      const second = h.suggestedDefensePool(part.slot);
      if (second.white !== part.surplus.white || second.blue !== part.surplus.blue) { bad++; say(`${part.slot} Surplus pool ${JSON.stringify(second)} read as ${JSON.stringify(part.surplus)}`); }
      const harmless = [...r.faces.red, ...r.faces.yellow].some((f) => f.heavy + f.light > 0 && f.pen === 0);
      for (let i = 0; !harmless && i < Math.ceil(rolls / 4); i++) {
        c.carried = { heavy: rng.int(3), light: rng.int(4) };
        const defense = hand(second);
        c.defenseRoll = rolled(defense);
        const real = h.resolve();
        const sum = handOf(r, null, [], defense);
        const model = M.K.offsetIcons(c.carried.heavy, c.carried.light, sum.defence.dodge, sum.defence.defense);
        if (real.penetrating !== model.penetrating || real.hits !== model.hits) { bad++; say(`${part.slot} Surplus ${JSON.stringify(c.carried)} v ${defense.map((x) => `${x.color[0]}${x.face}`).join('')}: the window ${real.penetrating}, the reading ${model.penetrating}`); }
      }
      if (part.next === 'damaged') {
        const key = part.slot;
        const had = Object.prototype.hasOwnProperty.call(d.partStates, key);
        const was = d.partStates[key];
        d.partStates[key] = 'damaged';
        const third = h.suggestedDefensePool(part.slot);
        if (had) d.partStates[key] = was; else delete d.partStates[key];
        if (!part.mutilated || third.white !== part.mutilated.white || third.blue !== part.mutilated.blue) { bad++; say(`${part.slot} Damaged pool ${JSON.stringify(third)} read as ${JSON.stringify(part.mutilated)}`); }
      } else if (part.mutilated) { bad++; say(`${part.slot} is destroyed by one Penetration and read as defending again`); }
      // The ladder is the engine's (commands.ts applyPenetration).
      const copy = clone(state);
      const pen = { kind: 'applyPenetration', seat: c.attacker.side, uid: c.attacker.uid, targetUid: d.uid, slot: part.slot };
      M.C.apply(data, copy, pen);
      const after = copy.tokens.find((t) => t.uid === d.uid)?.partStates[part.slot];
      if (after !== part.next) { bad++; say(`${part.slot} goes ${part.state} to ${after}, read as ${part.next}`); }
    }
  } finally {
    shut();
  }
  return { read: true, wrong, bad, parts: r.parts.length };
}
{
  // The copied squads, in every Stance the two sides can be in, with and
  // without a Fragile Token on the target.
  let attacks = 0;
  let compared = 0;
  const wrong = [];
  for (const mine of ['offensive', 'defensive', 'mobility']) {
    for (const theirs of ['offensive', 'defensive', 'mobility', 'shutdown']) {
      for (const fragile of [0, 2]) {
        const { s } = stage((st) => {
          for (const t of st.tokens) {
            if (t.kind !== 'mech') continue;
            t.stance = t.side === 's1' ? mine : theirs;
            if (fragile) t.statuses = [...(t.statuses ?? []), ...Array(fragile).fill('fragile')];
          }
        });
        // Each side attacks in `mine` and defends in `theirs`.
        for (const a of attacksOf(s)) {
          const A = s.tokens.find((t) => t.uid === a.uid);
          const D = s.tokens.find((t) => t.uid === a.targetUid);
          if (A.kind === 'mech') A.stance = mine;
          if (D.kind === 'mech') D.stance = theirs;
          const out = rollForRoll(s, a, 24);
          if (!out.read) { wrong.push(`${a.actionId}: no reading`); continue; }
          attacks++;
          compared += out.parts * 24;
          wrong.push(...out.wrong);
        }
      }
    }
  }
  check('the copied squads, in every Stance and with Fragile Tokens on the target: the reading and the window agree on every roll, every pool and every step down the ladder',
    [wrong.slice(0, 4), attacks, compared > 40000], [[], 30 * 3 * 4 * 2, true]);
}
{
  // A Back Attack, an Explosion, an Interception: the reading follows the mode.
  const { s, U, at } = stage();
  at(U['Wild Cat'], 6, 4, 1);
  const rear = odds.read(s, { uid: U.Mire.uid, actionId: '535_A', targetUid: U['Wild Cat'].uid });
  at(U['Wild Cat'], 6, 4, 3);
  const front = odds.read(s, { uid: U.Mire.uid, actionId: '535_A', targetUid: U['Wild Cat'].uid });
  check('from the rear arc the attacker designates and the defender may declare nothing; from the front the die decides and a Parry may be declared',
    [rear.location.attackerPicks, rear.location.declare, front.location.attackerPicks, front.location.declare.map((x) => x.slot)], [true, [], false, ['leftHand']]);
  const arm = front.parts.find((p) => p.slot === 'leftHand');
  check('the Parry that may be declared is read with its dice: the Shield\'s two more White dice on its own arm, and on no other Part',
    [front.location.declare, arm.parried.white - arm.defense.white, front.parts.filter((p) => p.parried).map((p) => p.slot)], [[{ slot: 'leftHand', parry: 2 }], 2, ['leftHand']]);
  check('a Drone has no hit location: its one Part takes the hit', odds.read(s, { uid: U.Dune.uid, actionId: '032_A', targetUid: U.Raven.uid }).location.fixed, 'main');
  const shut2 = stage((st) => { for (const t of st.tokens) if (t.label === 'Wild Cat') t.stance = 'shutdown'; });
  check('against a Shutdown Mech the attacker designates', odds.read(shut2.s, { uid: shut2.U.Dune.uid, actionId: '032_A', targetUid: shut2.U['Wild Cat'].uid }).location.attackerPicks, true);
  // Cruise Mode is a Core Part's (ACE-001): every hit is the Torso's.
  const cruise = stage((st, V) => { V['Wild Cat'].mech.torso = '288'; });
  const cruised = odds.read(cruise.s, { uid: cruise.U.Mire.uid, actionId: '535_A', targetUid: cruise.U['Wild Cat'].uid });
  check('a Mech in Cruise Mode takes every hit on its Torso: no die, nobody designates, no Parry is declared',
    [cruised.location.fixed, cruised.location.attackerPicks, cruised.location.declare], ['torso', false, []]);
  // Suppression (a Full-auto burst, card 030): the target is switched to
  // Defensive Stance as the attack is declared, so its White dice count their
  // hollow Defense. The reading says so, and leaves the table as it found it.
  const sup = stage((st, V) => { V.Mire.mech.rightHand = '030'; V['Wild Cat'].stance = 'offensive'; });
  const burst = odds.read(sup.s, { uid: sup.U.Mire.uid, actionId: '030_A', targetUid: sup.U['Wild Cat'].uid });
  const chop = odds.read(sup.s, { uid: sup.U.Mire.uid, actionId: '535_A', targetUid: sup.U['Wild Cat'].uid });
  check('Suppression is read as it is played: the target defends as a Defensive Mech does, its hollow Defense counting, and is left in the Stance it was in',
    [burst.faces.white[1].defense, chop.faces.white[1].defense, sup.U['Wild Cat'].stance, odds.undo.length], [2, 0, 'offensive', 0]);
  const hurt = stage((st) => { const cat = st.tokens.find((t) => t.label === 'Wild Cat'); cat.partStates.leftHand = 'destroyed'; cat.partStates.torso = 'damaged'; });
  const r = odds.read(hurt.s, { uid: hurt.U.Dune.uid, actionId: '032_A', targetUid: hurt.U['Wild Cat'].uid });
  check('a Part that is gone is no Part to hit, the die that finds it lands on the Torso, and a Damaged Part is one Penetration from destroyed',
    [r.parts.map((p) => p.slot), r.location.die, r.parts.find((p) => p.slot === 'torso').next, r.partsLeft],
    [['torso', 'chasis', 'rightHand', 'backpack'], ['torso', 'chasis', 'torso', 'rightHand', 'backpack', 'any'], 'destroyed', 4]);
  // The Dune shoots past the Mire, a Large Unit in the line: Unit Protection.
  const shot = { uid: U.Dune.uid, actionId: '032_A', targetUid: U['Wild Cat'].uid };
  const past = odds.read(s, shot);
  const asBlast = odds.read(s, { ...shot, mode: 'explosion' });
  const gained = past.parts.map((p, i) => p.defense.white - asBlast.parts[i].defense.white);
  check('a shot past a Large Unit gives the target its Protection on every Part, and an Explosion from the same place gives it none',
    [gained.every((n) => n === gained[0]), gained[0] > 0], [true, true]);
  check('nor does a Surplus round, whose pool is the same behind cover as in the open', past.parts.map((p) => p.surplus), asBlast.parts.map((p) => p.surplus));
}

// ---------- every Part, pilot and Drone in the data ----------
//
// The copied squads are 22 cards. The reading has to hold for whatever a
// player brings later (M8), so each card that changes an attack is mounted in
// turn, on the unit that attacks and on the unit attacked, and held to the
// window roll for roll. A card whose attack cannot be read (a Multi-Target's
// split) is counted and named, not skipped in silence.
{
  const SLOTS = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];
  const cards = [...data.byId.values()];
  const parts = cards.filter((c) => c.category === 'mech_part' && SLOTS.includes(c.type));
  const pilots = cards.filter((c) => c.category === 'pilot');
  const drones = cards.filter((c) => c.category === 'drone');
  const wrong = [];
  const unread = new Set();
  let attacks = 0;
  const run = (s, a, what) => {
    let out;
    try { out = rollForRoll(s, a, 10); } catch (err) { wrong.push(`${what}: threw ${err.message}`); try { shut(); } catch { /* already shut */ } return; }
    if (!out.read) { unread.add(what); return; }
    attacks++;
    wrong.push(...out.wrong.map((w) => `${what}: ${w}`));
  };
  const strikes = (c) => (c.actions ?? []).filter((x) => x.type === 'Firing' || x.type === 'Melee');
  // Mounted on the attacker: every attack the card carries, at a Mech and at a Drone.
  for (const card of parts) {
    for (const act of strikes(card)) {
      for (const stance of ['offensive', 'mobility']) {
        const { s, U } = stage((st, V) => { V.Mire.mech[card.type] = card.id; V.Mire.stance = stance; V.Mire.charge = [card.type]; });
        for (const target of [U['Wild Cat'], U.Raven]) {
          run(s, { uid: U.Mire.uid, actionId: act.id, targetUid: target.uid }, `${card.id} ${act.id} (${stance})`);
          run(s, { uid: U.Mire.uid, actionId: act.id, targetUid: target.uid, charged: true }, `${card.id} ${act.id} charged (${stance})`);
        }
      }
    }
  }
  const mounted = attacks;
  // Mounted on the defender: a Melee and a Firing attack on it, in each Stance.
  for (const card of parts) {
    for (const stance of ['defensive', 'mobility']) {
      const { s, U } = stage((st, V) => { V['Wild Cat'].mech[card.type] = card.id; V['Wild Cat'].stance = stance; V['Wild Cat'].charge = [card.type]; });
      for (const actionId of ['535_A', '536_B']) run(s, { uid: U.Mire.uid, actionId, targetUid: U['Wild Cat'].uid }, `${actionId} at a Mech carrying ${card.id} (${stance})`);
    }
  }
  // A pilot on either side.
  for (const card of pilots) {
    const mine = stage((st, V) => { V.Mire.mech.pilot = card.id; });
    for (const actionId of ['535_A', '536_B']) run(mine.s, { uid: mine.U.Mire.uid, actionId, targetUid: mine.U['Wild Cat'].uid }, `${actionId} flown by ${card.id}`);
    const theirs = stage((st, V) => { V['Wild Cat'].mech.pilot = card.id; V['Wild Cat'].stance = 'mobility'; });
    for (const actionId of ['535_A', '536_B']) run(theirs.s, { uid: theirs.U.Mire.uid, actionId, targetUid: theirs.U['Wild Cat'].uid }, `${actionId} at ${card.id}`);
  }
  // A Drone attacking, and attacked.
  for (const card of drones) {
    const { s, U } = stage((st, V) => { V.Porcupine.cardId = card.id; });
    for (const act of strikes(card)) run(s, { uid: U.Porcupine.uid, actionId: act.id, targetUid: U.Mire.uid }, `${card.id} ${act.id}`);
    for (const actionId of ['535_A', '536_B']) run(s, { uid: U.Mire.uid, actionId, targetUid: U.Porcupine.uid }, `${actionId} at the Drone ${card.id}`);
  }
  check('every Part, pilot and Drone in the data, mounted on an attacker and on a defender: the reading and the window agree on every roll',
    [wrong.slice(0, 6), mounted > 300, attacks > 1500], [[], true, true]);
  // Named, so a new one is noticed: these are the attacks the odds do not cover.
  console.log(`       (${attacks} attacks compared; ${unread.size} not read: ${[...unread].slice(0, 12).join('; ')}${unread.size > 12 ? '; ...' : ''})`);
  check('every attack is read: a Multi-Target too, as its whole pool on the one target (a split is read a target at a time)',
    [[...unread].slice(0, 5), [...unread].length], [[], 0]);
}

// ---------- 2. by hand ----------
//
// Readings small enough to count on paper. The dice are the game's: a Red die
// shows a solid Heavy Hit on 4 faces of 8; a Yellow die two Light Hits on 2
// faces and one on 2 more; a White die a Defense on 1 face and a Dodge on 1;
// a Blue die a Dodge on 2.
const near = (a, b) => Math.abs(a - b) < 1e-9;
const round = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]));
const A = (heavy, light, bolt = 0, pen = heavy + light) => ({ heavy, light, bolt, hits: pen, pen });
const D = (dodge, defense) => ({ dodge, defense });
const PLAIN = {
  red: [A(1, 0), A(1, 0), A(1, 0), A(1, 0), A(0, 0), A(0, 0), A(0, 0), A(0, 0)],
  yellow: [A(0, 2), A(0, 2), A(0, 1), A(0, 1), A(0, 0), A(0, 0), A(0, 0), A(0, 0)],
  white: [D(0, 1), D(0, 0), D(0, 0), D(1, 0), D(0, 0), D(0, 0), D(0, 0), D(0, 0)],
  blue: [D(1, 0), D(1, 0), D(0, 0), D(0, 0), D(0, 0), D(0, 0), D(0, 0), D(0, 0)],
};
const none8 = Array(8).fill(false);
const part = (slot, next, white, more = {}) => ({
  slot, state: next === 'damaged' ? 'intact' : 'intact', next, defense: { white, blue: 0 }, parried: null,
  stripped: { red: none8, yellow: none8 }, surplus: { white, blue: 0 }, mutilated: null, ...more,
});
const HAND = { step: 'attack', part: null, round: 0, carried: { heavy: 0, light: 0 }, original: null, declared: null, parry: 0, die: null,
  pool: { attack: { red: 0, yellow: 0 }, defense: { white: 0, blue: 0 } }, attack: null, defense: null, focus: null, evade: false };
const reading = (over) => ({
  attackerUid: 1, defenderUid: 2, mech: false, attack: { red: 0, yellow: 0 }, faces: PLAIN, surplus: [], drain: null,
  location: { fixed: 'main', attackerPicks: false, die: ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'any'], declare: [] },
  parts: [part('main', 'destroyed', 1)], partsLeft: 1, link: 0, keepsLink: false, hand: HAND, ...over,
});
{
  // One Yellow die against one White. Two Light Hits always leave one (a White
  // die cancels one icon at most): 2/8. One Light Hit gets through unless the
  // White shows its Defense or its Dodge: 2/8 x 6/8. It is a Hit unless Dodged.
  const f = forecastOf(reading({ attack: { red: 0, yellow: 1 } }));
  check('one Yellow die against one White: Penetration 28 in 64, a Hit 30 in 64, and a Drone it Penetrates is destroyed',
    [near(f.pen, 28 / 64), near(f.hit, 30 / 64), near(f.destroy, 28 / 64), near(f.kill, 28 / 64), f.damage, f.link], [true, true, true, true, 0, 0]);
  // One Red die against a White and a Blue: a Heavy Hit is only ever Dodged.
  const g = forecastOf(reading({ attack: { red: 1, yellow: 0 }, parts: [part('main', 'damaged', 1, { defense: { white: 1, blue: 1 } })] }));
  check('one Red die against a White and a Blue: the Heavy Hit lands unless either die Dodges, 4/8 x 7/8 x 6/8, and a Part with Structure is left Damaged',
    [near(g.pen, 0.5 * (7 / 8) * (6 / 8)), near(g.damage, g.pen), g.destroy, g.kill], [true, true, 0, 0]);
  check('a pool of no dice Penetrates nothing, and an undefended Part falls to any Hit at all',
    [round(forecastOf(reading({}))), near(forecastOf(reading({ attack: { red: 2, yellow: 0 }, parts: [part('main', 'destroyed', 0)] })).pen, 0.75)],
    [{ hit: 0, pen: 0, damage: 0, destroy: 0, kill: 0, link: 0 }, true]);
}
{
  // Mutilation: two Red dice at an undefended Part with Structure. One Heavy
  // Hit (1/2) is carried into the Structure's one White die and gets through
  // unless it Dodges (7/8); two (1/4) always do.
  const r = reading({ attack: { red: 2, yellow: 0 }, surplus: ['Mutilation'], parts: [part('main', 'damaged', 0, { mutilated: { white: 1, blue: 0 } })] });
  const f = forecastOf(r);
  check('Mutilation: the icons left over strike the same Part again, now on its Structure',
    [near(f.pen, 0.75), near(f.destroy, 0.5 * (7 / 8) + 0.25), near(f.damage, 0.5 * (1 / 8)), near(f.kill, f.destroy)], [true, true, true, true]);
  const without = forecastOf({ ...r, surplus: [] });
  check('and without the keyword the Surplus does nothing: the Part is Damaged and no more', [near(without.damage, 0.75), without.destroy], [true, 0]);
  const gone = forecastOf({ ...r, parts: [part('main', 'destroyed', 0)] });
  check('nor has it anything to strike in a Part the first Penetration destroyed', [near(gone.destroy, 0.75), gone.damage], [true, 0]);
}
{
  // A Mech with a Torso and a Chassis left, no dice to defend with. The die
  // finds the Torso on four faces (its own, and three Parts that are gone),
  // the Chassis on one, and ANY is the attacker's: the Chassis, which is
  // destroyed (worth 50) where the Torso is only Damaged (25).
  const mech = (over = {}) => reading({
    mech: true, attack: { red: 1, yellow: 0 }, partsLeft: 2, link: 3,
    location: { fixed: null, attackerPicks: false, die: ['torso', 'chasis', 'torso', 'torso', 'torso', 'any'], declare: [] },
    parts: [part('torso', 'damaged', 0), part('chasis', 'destroyed', 0)], ...over,
  });
  const f = forecastOf(mech());
  check('the Part Die: four faces in six find the Torso, one the Chassis, and ANY is put where it is worth most',
    [f.parts.map((p) => [p.slot, Math.round(p.share * 6)]), f.pick, near(f.pen, 0.5), near(f.damage, (4 / 6) * 0.5), near(f.destroy, (2 / 6) * 0.5), near(f.link, (2 / 6) * 0.5)],
    [[['torso', 4], ['chasis', 2]], 'chasis', true, true, true, true]);
  check('and of the hits that land on a Part, how many Penetrate it: half, on either', f.parts.map((p) => near(p.pen, 0.5)), [true, true]);
  check('a Mech already down to two Parts is not killed a second time by losing one; one with three is',
    [f.kill, near(forecastOf(mech({ partsLeft: 3 })).kill, (2 / 6) * 0.5)], [0, true]);
  check('a Torso destroyed is a kill, however many Parts the Mech has left',
    near(forecastOf(mech({ partsLeft: 5, location: { fixed: 'torso', attackerPicks: false, die: [], declare: [] }, parts: [part('torso', 'destroyed', 0), part('chasis', 'destroyed', 0)] })).kill, 0.5), true);
  check('a pilot who keeps his Link when a Part goes loses none', forecastOf(mech({ keepsLink: true })).link, 0);
  // The attacker designates: every hit goes where it is worth most.
  const picks = forecastOf(mech({ location: { fixed: null, attackerPicks: true, die: ['torso', 'chasis', 'torso', 'torso', 'torso', 'any'], declare: [] } }));
  check('an attacker who may designate puts every hit on the Part worth most', [picks.pick, picks.parts.map((p) => p.slot), near(picks.destroy, 0.5)], ['chasis', ['chasis'], true]);
  // A Parry worth declaring, and one that is not. Declared on the Chassis it
  // takes the hit there with its dice; the defender declares it only when
  // that costs the attacker more than the die would.
  const offer = (white) => mech({
    location: { fixed: null, attackerPicks: false, die: ['torso', 'chasis', 'torso', 'torso', 'torso', 'any'], declare: [{ slot: 'chasis', parry: white }] },
    parts: [part('torso', 'damaged', 0), part('chasis', 'destroyed', 0, { parried: { white, blue: 0 } })],
  });
  const weak = new Sheet(offer(1));
  const strong = new Sheet(offer(8));
  check('a Parry is declared when it costs the attacker more than the Part Die would, and not otherwise',
    [weak.declaration(), strong.declaration(), near(forecastOf(offer(8)).pen, 0.5 * (7 / 8) ** 8), near(forecastOf(offer(1)).pen, 0.5)], [null, { slot: 'chasis', parry: 8 }, true, true]);
  // Both may designate, so the die decides and the Parry counts only where it
  // was declared.
  const both = offer(8);
  both.location.attackerPicks = true;
  const b = forecastOf(both);
  check('where the attacker may designate too, a declared Parry sends the hit to the die, and counts only if the die finds its Part',
    [new Sheet(both).declaration(), near(b.pen, (4 / 6) * 0.5 + (1 / 6) * 0.5 * (7 / 8) ** 8 + (1 / 6) * 0.5), b.pick], [{ slot: 'chasis', parry: 8 }, true, 'torso']);
  // Two arms that could each Parry, the Parry declared on one: the die that
  // finds the other finds no Parry there.
  const arms = new InHand(mech({
    location: { fixed: null, attackerPicks: false, die: ['leftHand', 'rightHand'], declare: [{ slot: 'leftHand', parry: 8 }, { slot: 'rightHand', parry: 8 }] },
    parts: [part('leftHand', 'destroyed', 0, { parried: { white: 8, blue: 0 } }), part('rightHand', 'destroyed', 0, { parried: { white: 8, blue: 0 } })],
    hand: { ...HAND, step: 'part', declared: { slot: 'leftHand', parry: 8 } },
  }));
  check('a Parry counts on the Part it was declared on and on no other, though that one could have Parried too',
    near(arms.partRoll().pen, 0.25 * (7 / 8) ** 8 + 0.25), true);
}
{
  // Scatter-shot on a Mech in Cruise Mode (the Torso takes the first hit, no
  // die): the Surplus goes to another Part by the die, which rerolls the Torso
  // and so always finds the Chassis.
  const r = reading({
    mech: true, attack: { red: 2, yellow: 0 }, surplus: ['Scatter-shot'], partsLeft: 2, link: 3,
    location: { fixed: 'torso', attackerPicks: false, die: ['torso', 'chasis', 'torso', 'torso', 'torso', 'any'], declare: [] },
    parts: [part('torso', 'damaged', 0), part('chasis', 'destroyed', 0)],
  });
  const f = forecastOf(r);
  check('Scatter-shot: the Surplus lands on another Part, never the one first hit',
    [near(f.pen, 0.75), near(f.damage, 0.75), near(f.destroy, 0.75), near(f.link, 0.75), [...new Sheet(r).whole().ends].filter(([, p]) => p > 0).map(([end]) => end).sort()],
    [true, true, true, true, ['chasis>destroyed|torso>damaged', 'none']]);
  const plan = new Sheet(r).surplusPlan('torso', 1, 0);
  check('the keyword taken and the Part an ANY face is put on are the Sheet\'s to say', [plan.keyword, plan.any], ['Scatter-shot', 'chasis']);
  const both = new Sheet({ ...r, surplus: ['Mutilation', 'Scatter-shot'], parts: [part('torso', 'damaged', 0, { mutilated: { white: 0, blue: 0 } }), part('chasis', 'destroyed', 0)] });
  check('with two keywords the attacker takes the one worth most: the Torso destroyed is a kill',
    [both.surplusPlan('torso', 1, 0).keyword, near(forecastFromSheet(both).kill, 0.75)], ['Mutilation', true]);
  // The Chassis behind eight dice of Protection that the first hit would have
  // to get past. The Surplus round has none of it (4.8).
  const covered = forecastOf({ ...r, parts: [part('torso', 'damaged', 0), part('chasis', 'destroyed', 8, { surplus: { white: 0, blue: 0 } })] });
  check('the Surplus round is rolled against the Part\'s own pool for it, with none of the Protection the first hit had to get past', near(covered.destroy, 0.75), true);
  // The Part first hit is an arm with no Structure, destroyed outright. The
  // Surplus die that finds it again finds a Part that is gone, and lands on
  // the Torso as any die that finds a gone Part does.
  const armGone = new Sheet(reading({
    mech: true, attack: { red: 2, yellow: 0 }, surplus: ['Scatter-shot'], partsLeft: 5, link: 3,
    location: { fixed: null, attackerPicks: false, die: ['torso', 'chasis', 'leftHand', 'leftHand', 'leftHand', 'leftHand'], declare: [] },
    parts: [part('torso', 'damaged', 0), part('chasis', 'damaged', 0), part('leftHand', 'destroyed', 0)],
  })).surplusPlan('leftHand', 1, 0).ends;
  check('a Part the first hit destroyed is gone when the Surplus die is rolled: a face that finds it lands on the Torso',
    [near(armGone.get('leftHand>destroyed|torso>damaged'), 5 / 6), near(armGone.get('chasis>damaged|leftHand>destroyed'), 1 / 6)], [true, true]);
  const dead = new Sheet({ ...r, parts: [part('torso', 'destroyed', 0), part('chasis', 'destroyed', 0)] }).surplusPlan('torso', 1, 0);
  check('a Mech whose Torso the first hit destroyed is off the board: its Surplus has nowhere to go', [dead.keyword, [...dead.ends]], [null, [['torso>destroyed', 1]]]);
  // What the round is spent on is weighed by what the round ADDS. The first
  // hit has destroyed the left arm; an ANY face may go on the Chassis (open,
  // and only Damaged by it) or on the right arm (destroyed by it, behind dice).
  const anyOf = (partsLeft, white) => new Sheet(reading({
    mech: true, attack: { red: 2, yellow: 0 }, surplus: ['Scatter-shot'], partsLeft, link: 3,
    location: { fixed: null, attackerPicks: false, die: ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'any'], declare: [] },
    parts: [part('leftHand', 'destroyed', 0), part('chasis', 'damaged', 0), part('rightHand', 'destroyed', white)],
  })).surplusPlan('leftHand', 1, 0).any;
  check('an ANY in a Surplus round goes where the round adds most. A Mech the first hit already took to two Parts is lost: the kill is no longer there to win, and the arm is taken for its own 50 against the Chassis\'s 25',
    [anyOf(3, 4), (7 / 8) ** 4 * 50 > 25], ['rightHand', true]);
  check('and where it is the Surplus round that would take the Mech to two Parts, the kill is the round\'s: the arm is worth trying behind eight dice',
    [anyOf(4, 8), (7 / 8) ** 8 * 50 < 25, (7 / 8) ** 8 * 200 > 25], ['rightHand', true, true]);
}
{
  // Concussion: each {Lightning} that no spare Dodge cancels strips a Link.
  const faces = { ...PLAIN, yellow: [A(0, 1), A(0, 0, 1, 0), A(0, 0), A(0, 0), A(0, 0), A(0, 0), A(0, 0), A(0, 0)] };
  const r = reading({ mech: true, attack: { red: 0, yellow: 2 }, faces, drain: 'concussion', link: 4, partsLeft: 5,
    location: { fixed: 'torso', attackerPicks: false, die: [], declare: [] }, parts: [part('torso', 'damaged', 0)] });
  const f = forecastOf(r);
  // Two dice, each a Lightning on 1 face in 8 and nothing to Dodge it: 2/8 expected.
  check('a Concussion strips a Link for every Lightning that gets through, Penetration or none', [near(f.link, 2 / 8), near(f.pen, 1 - (7 / 8) ** 2)], [true, true]);
  const dodged = forecastOf({ ...r, parts: [part('torso', 'damaged', 0, { defense: { white: 0, blue: 1 } })] });
  // The Blue die Dodges on 2 faces of 8; the Dodge goes to a Hit first, and
  // cancels a Lightning only when it is left over.
  const want = (() => {
    let link = 0;
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) for (let d = 0; d < 8; d++) {
      const hits = (a === 0 ? 1 : 0) + (b === 0 ? 1 : 0);
      const bolts = (a === 1 ? 1 : 0) + (b === 1 ? 1 : 0);
      const dodge = d < 2 ? 1 : 0;
      const spare = Math.max(0, dodge - hits);
      link += Math.max(0, bolts - spare) / 512;
    }
    return link;
  })();
  check('and a Dodge left over after the Hits cancels one', near(dodged.link, want), true);
  // Wrecking: the same Lightning is damage too.
  const wreck = { ...faces, yellow: [A(0, 1), A(0, 0, 1, 1), A(0, 0), A(0, 0), A(0, 0), A(0, 0), A(0, 0), A(0, 0)] };
  const w = forecastOf({ ...r, faces: wreck, drain: 'wrecking' });
  check('Wrecking\'s Lightning is a Hit and a Penetration of its own', near(w.pen, 1 - (6 / 8) ** 2), true);
  // An Action that causes no damage: Hits, and never a Penetration.
  const soft = { ...PLAIN, red: PLAIN.red.map((x) => ({ ...x, pen: 0 })), yellow: PLAIN.yellow.map((x) => ({ ...x, pen: 0 })) };
  const h = forecastOf(reading({ attack: { red: 1, yellow: 0 }, faces: soft, parts: [part('main', 'destroyed', 0)] }));
  check('an Action that causes no damage Hits and never Penetrates', [near(h.hit, 0.5), h.pen, h.destroy], [true, 0, 0]);
  // Dense Armor: the faces it takes come to nothing.
  const dense = part('main', 'destroyed', 0, { stripped: { red: [true, true, false, false, false, false, false, false], yellow: none8 } });
  check('a die Dense Armor takes off the table comes to nothing', near(forecastOf(reading({ attack: { red: 1, yellow: 0 }, parts: [dense] })).pen, 2 / 8), true);
}
{
  // The dice as they lie, and a reroll. A Red die showing nothing against a
  // White die showing nothing: no damage as it stands; thrown again, the Red
  // die is a Heavy Hit on 4 faces of 8, and the White die is not rolled again.
  const lie = (over) => reading({ attack: { red: 1, yellow: 0 }, parts: [part('main', 'destroyed', 1)],
    hand: { ...HAND, step: 'defense', part: 'main', attack: [{ color: 'red', face: 7 }], defense: [{ color: 'white', face: 7 }], ...over } });
  const h = new InHand(lie({}));
  check('the dice as they lie: nothing', round(h.stands()), { hit: 0, pen: 0, damage: 0, destroy: 0, kill: 0, link: 0 });
  check('the attacker\'s die thrown again: a Heavy Hit on four faces of eight', near(h.reroll('attack', [0]).pen, 0.5), true);
  check('throwing no die is leaving them', round(h.reroll('attack', [])), round(h.stands()));
  const best = h.bestReroll('attack');
  check('and the reroll worth most to the attacker is that one', [best.indices, near(best.forecast.pen, 0.5), h.rerolls('attack').map((x) => x.indices)], [[0], true, [[], [0]]]);
  // The defender, under a Heavy Hit: its White die Dodges on 1 face of 8.
  const under = new InHand(lie({ attack: [{ color: 'red', face: 0 }] }));
  const d = under.bestReroll('defence');
  check('the defender under a Heavy Hit: as the dice lie it is destroyed, and its reroll saves it one time in eight',
    [under.stands().destroy, d.indices, near(d.forecast.destroy, 7 / 8)], [1, [0], true]);
  const evaded = new InHand(lie({ attack: [{ color: 'red', face: 0 }], evade: true }));
  check('a Melee Evasion already declared is a Dodge in the hand: the Heavy Hit it cancels does nothing',
    [evaded.stands().destroy, handOf(lie({}), null, [], [], true).defence, handOf(lie({}), null, [], []).defence], [0, { dodge: 1, defense: 0 }, { dodge: 0, defense: 0 }]);
  check('a die thrown again counts for what it comes up and not for what it showed: a Heavy Hit rerolled is a Heavy Hit four times in eight',
    near(under.reroll('attack', [0]).pen, 0.5), true);
  // Two dice showing the same face are one choice.
  const two = new InHand(lie({ attack: [{ color: 'red', face: 7 }, { color: 'red', face: 7 }, { color: 'red', face: 0 }] }));
  check('two dice of a colour showing the same face are one choice: none, one or both of them, with or without the third',
    two.rerolls('attack').map((x) => x.indices.length).sort(), [0, 1, 1, 2, 2, 3]);
  // The Part Die on offer: keep it where it landed, or throw it again.
  const mech = reading({
    mech: true, attack: { red: 1, yellow: 0 }, partsLeft: 3, link: 3,
    location: { fixed: null, attackerPicks: false, die: ['torso', 'chasis', 'torso', 'torso', 'torso', 'any'], declare: [] },
    parts: [part('torso', 'damaged', 0), part('chasis', 'destroyed', 0)], hand: { ...HAND, step: 'part', die: 'torso' },
  });
  const m = new InHand(mech);
  check('the Part Die on the Torso: kept, the hit Damages it; thrown again, it may find the Chassis',
    [near(m.dieKept().damage, 0.5), m.dieKept().destroy, near(m.partRoll().destroy, (2 / 6) * 0.5), near(m.partPick('chasis').destroy, 0.5), m.partPick('leftHand')], [true, 0, true, true, null]);
  // A Surplus round under way: one Heavy Hit carried, the Torso the original.
  const second = new InHand({ ...mech, surplus: ['Scatter-shot'], hand: { ...HAND, step: 'part', round: 1, carried: { heavy: 1, light: 0 }, original: 'torso' } });
  check('in a Surplus round the forecast is of what is left: the die finds the Chassis, and the carried Hit destroys it',
    [near(second.partRoll().destroy, 1), second.partRoll().pick, near(second.keyword('Scatter-shot').destroy, 1), second.partRoll().damage], [true, 'chasis', true, 0]);
  check('a Part picked in a Surplus round is forecast for the icons carried into it, not for a whole attack', near(second.partPick('chasis').destroy, 1), true);
  // Both keywords to choose from, the Torso already Damaged by the first hit.
  const either = new InHand({ ...mech, partsLeft: 5, surplus: ['Mutilation', 'Scatter-shot'],
    parts: [part('torso', 'destroyed', 0, { state: 'damaged' }), part('chasis', 'destroyed', 0)],
    hand: { ...HAND, step: 'surplus', round: 1, carried: { heavy: 1, light: 0 }, original: 'torso' } });
  const again = either.keyword('Mutilation');
  const spread = either.keyword('Scatter-shot');
  check('a Surplus spent on Mutilation strikes the Part first hit again, and one spent on Scatter-shot is rolled onto another',
    [again?.kill, again?.pick, spread?.kill, near(spread?.destroy, 1), spread?.pick], [1, null, 0, true, 'chasis']);
  // An ANY on the die, kept: the attacker's Part, the one worth most.
  const anyKept = new InHand({ ...mech, hand: { ...HAND, step: 'part', die: 'any' } });
  const anyLater = new InHand({ ...mech, surplus: ['Scatter-shot'], hand: { ...HAND, step: 'part', round: 1, carried: { heavy: 1, light: 0 }, original: 'torso', die: 'any' } });
  check('an ANY on the Part Die, kept, is the attacker\'s to place: on the Part worth most, in the first round and in a Surplus round',
    [anyKept.dieKept()?.pick, near(anyKept.dieKept()?.destroy, 0.5), anyLater.dieKept()?.pick, near(anyLater.dieKept()?.destroy, 1)], ['chasis', true, 'chasis', true]);
  check('what a forecast is worth is the Brawler\'s sum: 150 a kill, 50 a Part destroyed, 25 one Damaged',
    [WORTH, worthOfForecast({ kill: 0.5, destroy: 0.5, damage: 0.2 })], [{ kill: 150, destroy: 50, damage: 25 }, 75 + 25 + 5]);
}

// ---------- 3. played ----------
//
// One attack made for real: two computer seats at one table, a combat window
// each and the two-seat protocol between them (the attacker's window live, the
// defender's a picture of it), the dice from a seeded stream. Each seat makes
// the choices the forecast assumes, and makes them BY THE ODDS IT IS HANDED on
// its answers: the attacker takes the Part and the Surplus keyword worth most,
// the defender declares what costs most, and neither spends a Link.
const other = (seat) => (seat === 's1' ? 's2' : 's1');
const worth = (o) => { const f = o.chance?.(); return f ? worthOfForecast(f) : null; };
const best = (options, sign) => {
  let top = null;
  let score = -Infinity;
  for (const o of options) { const w = worth(o); if (w !== null && sign * w > score + 1e-12) { top = o; score = sign * w; } }
  return top;
};
const seatPolicy = {
  name: 'by the odds',
  choose(d) {
    if (d.kind === 'attack.part') {
      const picks = d.options.filter((o) => o.id.startsWith('part.pick:'));
      return { option: (picks.length ? best(picks, 1) : null)?.id ?? d.fallback };
    }
    if (d.kind === 'attack.surplus') return { option: best(d.options.filter((o) => o.id.startsWith('surplus.effect:')), 1)?.id ?? d.fallback };
    if (d.kind === 'defence.declare') {
      // Nothing first, then each Part in the order it is offered: the order
      // the forecast weighs them in.
      const none = d.options.find((o) => o.id === 'declare.none');
      const offers = d.options.filter((o) => o.id.startsWith('declare.designate:'));
      return { option: (best([none, ...offers].filter(Boolean), -1) ?? none)?.id ?? d.fallback };
    }
    return { option: d.fallback };
  },
};
// `args` is what the seat's own answer names (its `attack` routine's): the
// payment goes first, then the window opens, exactly as when a policy picks it.
async function playOnce(staged, attackerSeat, args, seed, script = null) {
  const s = clone(staged);
  M.L.setLocalSeat('s1');
  const refused = [];
  const watchers = [];
  const send = (seat, cmd) => {
    const v = seat === 's1' ? M.C.perform(data, s, cmd) : M.C.applyRemote(data, s, cmd);
    if (v.ok) { M.G.glueAfter(data, s, cmd); for (const w of watchers) w(cmd); } else refused.push(`${seat} ${cmd.kind}: ${v.why}`);
    return v;
  };
  const dice = new M.AI.Rng(`${seed}:dice`);
  // `script.face(color)` names each die's face in place of the stream, and
  // `script.asked` hears every question a seat is put.
  const roll = async (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: script ? script.face(color) : dice.int(sides(color)) })));
  const policy = script?.asked
    ? { name: 'heard', choose: (d, view, rng) => { script.asked(d); return seatPolicy.choose(d, view, rng); } }
    : seatPolicy;
  const drivers = Object.fromEntries(['s1', 's2'].map((seat) => [seat, new M.AI.Driver(seat,
    { data, state: () => s, send: (cmd) => send(seat, cmd), roll }, policy, new M.AI.Rng(`${seed}:${seat}`))]));
  for (const d of Object.values(drivers)) watchers.push((cmd) => d.observe(cmd));
  const att = drivers[attackerSeat];
  const def = drivers[other(attackerSeat)];
  const failed = await att.attack(args);
  if (failed) return { s, refused: [...refused, `the attack did not open: ${failed.why}`] };
  let idle = 0;
  for (let i = 0; i < 400 && idle < 60; i++) {
    let moved = false;
    for (const d of [att, def]) {
      // Only what the window asks: the attacker's own, the defender's picture.
      const q = d.combat.decision();
      if (!q) continue;
      const r = await d.step();
      if (r.kind === 'refused' || r.kind === 'stuck') return { s, refused: [...refused, `${d.seat} ${r.kind} at ${q.kind}: ${r.why}`] };
      if (r.kind === 'acted') moved = true;
    }
    // Over when the attacker's window has closed and its picture has come down.
    if (!att.combat.busy && !s.script?.combatView) return { s, refused };
    if (!moved) { idle++; await tick(); } else idle = 0;
  }
  return { s, refused: [...refused, 'the attack never ended'] };
}
// What became of the target: the Parts it lost a step on, named as the
// forecast names its endings, and the Link it lost.
function outcome(before, after, uid) {
  const was = before.tokens.find((t) => t.uid === uid);
  const now = after.tokens.find((t) => t.uid === uid);
  // A unit whose Torso (or one Part) is destroyed leaves the board at once.
  if (!now) return { end: 'killed', link: null };
  const slots = [...new Set([...Object.keys(was.partStates), ...Object.keys(now.partStates)])];
  const changes = slots.filter((k) => (was.partStates[k] ?? 'intact') !== (now.partStates[k] ?? 'intact')).map((k) => `${k}>${now.partStates[k]}`).sort();
  return { end: changes.join('|') || 'none', link: (was.link ?? 0) - (now.link ?? 0) };
}
async function played(label, build, n) {
  const made = build();
  const { s, attacker, target, actionId, charged } = made;
  const args = { uid: attacker.uid, actionId, targetUid: target.uid, mode: 'attack', ...(charged ? { charged: true } : {}) };
  const wanted = (d) => d.options.find((o) => o.tags.includes('attack') && o.facts?.actionId === actionId && o.facts?.targetUid === target.uid && !!o.facts?.charged === !!charged);
  // The forecast is of the attack as the seat is offered it, payment and all.
  M.L.setLocalSeat('s1');
  const asked = M.SEAT.owed(data, s, attacker.side, M.SEAT.newMind());
  const option = asked ? wanted(asked) : null;
  if (!option) { check(`${label}: the attack is one the seat is offered`, asked ? asked.options.filter((o) => o.tags.includes('attack')).map((o) => o.id) : null, 'offered'); return; }
  const reading = odds.read(s, option.run.args);
  const sheet = new Sheet(reading);
  const whole = sheet.whole();
  // An ending that takes the unit off the board is one ending, whatever else
  // went with it; Hits that did not Penetrate leave the unit as it was.
  const want = new Map();
  for (const [end, p] of whole.ends) {
    const k = end === 'hit' ? 'none' : /(^|\|)(torso|main)>destroyed/.test(end) ? 'killed' : end;
    want.set(k, (want.get(k) ?? 0) + p);
  }
  const forecast = forecastOf(reading);
  const got = new Map();
  let link = 0;
  let stood = 0;
  const troubles = [];
  for (let i = 0; i < n; i++) {
    const r = await playOnce(s, attacker.side, option.run.args, `${label}:${i}`);
    if (r.refused.length) { troubles.push(r.refused[0]); if (troubles.length > 3) break; continue; }
    const o = outcome(s, r.s, target.uid);
    got.set(o.end, (got.get(o.end) ?? 0) + 1);
    if (o.link !== null) { link += o.link; stood++; }
  }
  M.L.setLocalSeat(null);
  const done = [...got.values()].reduce((a, b) => a + b, 0);
  // Each ending as often as forecast, within what n games can tell apart.
  const off = [];
  for (const end of new Set([...want.keys(), ...got.keys()])) {
    const p = want.get(end) ?? 0;
    const f = (got.get(end) ?? 0) / Math.max(1, done);
    const slack = 4 * Math.sqrt(Math.max(p * (1 - p), 0.002) / Math.max(1, done)) + 0.004;
    if (Math.abs(f - p) > slack) off.push(`${end}: forecast ${(p * 100).toFixed(1)}%, played ${(f * 100).toFixed(1)}%`);
  }
  // The Link lost, over the games the unit was still there to be counted in
  // (a Mech that leaves the board takes its Link with it): a Part destroyed,
  // and what a Concussion stripped.
  let linkWant = 0;
  let stay = 0;
  for (const [end, p] of whole.ends) {
    if (/(^|\|)(torso|main)>destroyed/.test(end)) continue;
    stay += p;
    if (reading.mech && !reading.keepsLink) linkWant += p * (end.match(/>destroyed/g) ?? []).length;
  }
  const drained = reading.mech && reading.drain ? whole.bolt : 0;
  // Within what the games played can tell apart: a game's Link loss varies
  // by about one either way.
  const linkOff = stood > 0 && Math.abs(link / stood - (linkWant / Math.max(stay, 1e-9) + drained)) > 3.5 / Math.sqrt(stood) + 0.02;
  if (process.env.ODDS_SAY) console.log(`       ${label}: link forecast ${(linkWant / Math.max(stay, 1e-9) + drained).toFixed(3)} played ${(link / Math.max(1, stood)).toFixed(3)}; endings ${[...new Set([...want.keys(), ...got.keys()])].map((e) => `${e} ${((want.get(e) ?? 0) * 100).toFixed(1)}/${(((got.get(e) ?? 0) / Math.max(1, done)) * 100).toFixed(1)}`).join('; ')}`);
  check(`${label}: played ${n} times, every ending comes up as often as forecast, and the Link lost with it`,
    [troubles, off, linkOff, done], [[], [], false, n]);
  return { want, got, done, forecast, sheet, reading };
}
{
  // ODDS_PLAYED=1200 plays each of them five times as often, for a closer look.
  const N = Number(process.env.ODDS_PLAYED ?? 240);
  const turn = (st, mech, actionId) => {
    const action = M.U.tokenCards(data, mech).flatMap((x) => x.card.actions ?? []).find((a) => a.id === actionId);
    const o = st.turnOf(mech, M.T.timingOf(action));
    o.stanceLocked = true;
    return o;
  };
  // The Mire's Cleaver at the Wild Cat, face to face: a Parry is the
  // defender's to declare on its Shield arm.
  const chop = await played('the Mire\'s Chop at the Wild Cat', () => {
    const st = stage(); turn(st, st.U.Mire, '535_A');
    return { s: st.s, attacker: st.U.Mire, target: st.U['Wild Cat'], actionId: '535_A' };
  }, N);
  check('  (the defender had a Parry to declare, and the forecast says what it does with it)',
    [chop.reading.location.declare.map((x) => x.slot), typeof chop.sheet.declaration()], [['leftHand'], 'object']);
  // From behind: the attacker designates, and no Parry may be declared.
  const rear = await played('the Mire\'s Chop at the Wild Cat\'s back', () => {
    const st = stage((s0, V, at) => { at(V['Wild Cat'], 6, 4, 1); }); turn(st, st.U.Mire, '535_A');
    return { s: st.s, attacker: st.U.Mire, target: st.U['Wild Cat'], actionId: '535_A' };
  }, N);
  check('  (the attacker designated: one Part took every hit)', [rear.reading.location.attackerPicks, [...rear.got.keys()].filter((k) => k !== 'none').every((k) => k.startsWith(`${rear.forecast.pick}>`))], [true, true]);
  // Scatter-shot: a Surplus round on another Part.
  const burst = await played('the Mire\'s Burst Fire at the Wild Cat', () => {
    const st = stage(); turn(st, st.U.Mire, '536_B');
    return { s: st.s, attacker: st.U.Mire, target: st.U['Wild Cat'], actionId: '536_B' };
  }, N);
  check('  (Scatter-shot took a second Part in some of them)', [burst.reading.surplus, [...burst.got.keys()].some((k) => k.includes('|'))], [['Scatter-shot'], true]);
  {
    // The same attack on dice the suite names: the first Part Die shows ANY,
    // every Attack die hits, the defence rolls nothing. The Surplus round must
    // then ROLL its own Part Die (4.8.1 step 2). It used to keep the first
    // roll's ANY, show no die at all, and let the attacker choose the Part.
    const st = stage(); turn(st, st.U.Mire, '536_B');
    M.L.setLocalSeat('s1');
    const d = M.SEAT.owed(data, st.s, 's1', M.SEAT.newMind());
    const o = d.options.find((x) => x.tags.includes('attack') && x.facts?.actionId === '536_B' && x.facts?.targetUid === st.U['Wild Cat'].uid);
    const anyFace = data.dice.dice.black.faces.findIndex((f) => (f[0]?.part ?? 'any') === 'any');
    const chassis = data.dice.dice.black.faces.findIndex((f) => f[0]?.part === 'chassis');
    let blacks = 0;
    const parts = [];
    const r = await playOnce(st.s, 's1', o.run.args, 'scripted', {
      face: (color) => (color === 'black' ? (blacks++ === 0 ? anyFace : chassis) : color === 'red' || color === 'yellow' ? 0 : 7),
      asked: (q) => { if (q.kind === 'attack.part') parts.push(q.options.map((x) => x.id.split(':')[0]).filter((x, i, all) => all.indexOf(x) === i)); },
    });
    M.L.setLocalSeat(null);
    const cat = r.s.tokens.find((t) => t.uid === st.U['Wild Cat'].uid);
    check('after an ANY on the first Part Die, a Scatter-shot\'s Surplus round rolls a Part Die of its own, and the Part it finds takes the Surplus',
      [r.refused, parts, blacks, cat.partStates.chasis], [[], [['part.roll'], ['part.pick'], ['part.roll']], 2, 'destroyed']);
  }
  // A Concussion: Link stripped whether or not anything gets through.
  const bash = await played('the Wild Cat\'s Shield Bash at the Mire', () => {
    const st = stage(); turn(st, st.U['Wild Cat'], '540_A');
    return { s: st.s, attacker: st.U['Wild Cat'], target: st.U.Mire, actionId: '540_A' };
  }, N);
  check('  (a Concussion: Link is expected to go)', [bash.reading.drain, bash.forecast.link > 0.5], ['concussion', true]);
  // A Drone, with its Dodge dice and no hit location.
  await played('the Dune\'s Railgun at the Raven', () => {
    const st = stage(); turn(st, st.U.Dune, '032_A');
    return { s: st.s, attacker: st.U.Dune, target: st.U.Raven, actionId: '032_A' };
  }, N);
  // A target already hurt: a Damaged Torso, an arm gone.
  const hurt = await played('the Dune\'s Railgun at a Wild Cat already hurt', () => {
    const st = stage((s0, V) => { V['Wild Cat'].partStates.torso = 'damaged'; V['Wild Cat'].partStates.rightHand = 'destroyed'; V['Wild Cat'].partStates.backpack = 'destroyed'; });
    turn(st, st.U.Dune, '032_A');
    return { s: st.s, attacker: st.U.Dune, target: st.U['Wild Cat'], actionId: '032_A' };
  }, N);
  check('  (three Parts left: losing one more is Integrity Loss, and the forecast counts it a kill)', [hurt.reading.partsLeft, hurt.forecast.kill > 0.3], [3, true]);
}

// ---------- 4. the seam offers it ----------
//
// A policy never asks for odds: it finds them on the answers it is handed
// (seat.ts Option.chance). The driver puts them on every attack a seat may
// make, and the seat's window on every answer with dice still to come.
{
  const st = stage();
  const o = st.turnOf(st.U.Mire, 'firing');
  o.stanceLocked = true;
  M.L.setLocalSeat('s1');
  const s = st.s;
  const send = (cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.G.glueAfter(data, s, cmd); return v; };
  const driver = new M.AI.Driver('s1', { data, state: () => s, send, roll: async () => [] }, M.AI.safePolicy, new M.AI.Rng('x'));
  // What the driver hands its calculator, heard.
  const handed = [];
  const forecast = driver.odds.forecast.bind(driver.odds);
  driver.odds.forecast = (state, args, w) => { handed.push(args.before?.length ?? null); return forecast(state, args, w); };
  const d = driver.pending();
  const attacks = d.options.filter((x) => x.run?.routine === 'attack');
  const rest = d.options.filter((x) => x.run?.routine !== 'attack');
  check('every attack among a seat\'s answers carries its odds, and nothing else does',
    [d.kind, attacks.length > 2, attacks.every((x) => typeof x.chance === 'function'), rest.some((x) => 'chance' in x)], ['opp.act', true, true, false]);
  const same = attacks.every((x) => JSON.stringify(x.chance()) === JSON.stringify(odds.forecast(s, x.run.args)));
  check('they are the forecast of that attack as it would be made: its payment sent first, on the table as it stands', same, true);
  check('each attack is handed to the calculator as its answer names it, the payment that goes before it included',
    [handed.length, handed.every((n, i) => n === attacks[i].run.args.before.length), handed.every((n) => n > 0)], [attacks.length, true, true]);
  const before = JSON.stringify(s);
  for (const x of attacks) x.chance();
  check('asking changes nothing on the table, and an answer asked twice is worked out once', [JSON.stringify(s) === before, attacks[0].chance() === attacks[0].chance()], [true, true]);
  const plain = M.SEAT.owed(data, s, 's1', M.SEAT.newMind());
  check('the question itself is plain data: the odds are added by whoever puts it to a seat', plain.options.some((x) => 'chance' in x), false);
  M.L.setLocalSeat(null);
}
{
  // What comes next (M6.0). An answer that is commands alone says what this
  // seat would be asked on the table those commands leave: how a policy looks
  // at "what could I attack from there?" without anything on the table moving.
  const st = stage((s0, V) => { V.Mire.stance = 'offensive'; });
  st.turnOf(st.U.Mire, 'firing');
  M.L.setLocalSeat('s1');
  const s = st.s;
  const send = (cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.G.glueAfter(data, s, cmd); return v; };
  const driver = new M.AI.Driver('s1', { data, state: () => s, send, roll: async () => [] }, M.AI.safePolicy, new M.AI.Rng('x'));
  const before = JSON.stringify(s);
  const d = driver.pending();
  const sent = d.options.filter((x) => x.commands?.length && !x.run);
  const diced = d.options.filter((x) => x.run);
  check('every answer that is commands alone says what comes next, and so does an attack that is paid for before it is rolled',
    [sent.length > 10, sent.every((x) => typeof x.then === 'function'), diced.length > 0, diced.every((x) => (typeof x.then === 'function') === (x.run.args.before.length > 0))], [true, true, true, true]);
  // What is left of the activation behind an attack: the question once it is
  // paid for, its dice having changed nothing on the board.
  {
    const shot = diced.find((x) => x.run.routine === 'attack' && x.run.args.before.length > 0);
    const paid = M.G.tableAfter(data, s, shot.run.args.before);
    const left = M.SEAT.owed(data, paid, 's1', M.SEAT.newMind());
    check('an attack says what would be asked once it had been made: the question on the table its payment leaves, where that Action is spent',
      [shot.then().id === left.id, shot.then().options.map((x) => x.id), shot.then().options.some((x) => x.id === shot.id), (shot.then(['attack'])?.options ?? []).every((x) => x.tags[0] === 'attack'),
        JSON.stringify(s) === before],
      [true, left.options.map((x) => x.id), false, true, true]);
    check('so how many attacks an activation holds is the engine\'s to say: the Single Shot is a Medium Action, and nothing is left of the Ticks behind it but the Stabilize',
      [shot.label.startsWith('Single Shot'), shot.then(['attack'])?.options.length ?? 0, st.U.Mire.uid === shot.facts.uid], [true, 0, true]);
  }
  // A change of Stance: the Opportunity goes on, in the new Stance.
  const stance = d.options.find((x) => x.id === 'stance:defensive');
  const next = stance.then();
  const table = M.G.tableAfter(data, s, stance.commands);
  const real = M.SEAT.owed(data, table, 's1', M.SEAT.newMind());
  check('it is the question the seat would be put if it gave the answer: the same one, with the same answers',
    [next.kind, next.id === real.id, next.id === d.id, next.options.map((x) => x.id)], ['opp.act', true, false, real.options.map((x) => x.id)]);
  const shots = next.options.filter((x) => x.run?.routine === 'attack');
  const shotsNow = d.options.filter((x) => x.run?.routine === 'attack');
  check('its attacks carry their odds, and they are the odds on THAT table: in Defensive Stance the Mire\'s hollow Hits no longer count',
    [shots.map((x) => x.id), shots.every((x) => JSON.stringify(x.chance?.()) === JSON.stringify(odds.forecast(table, x.run.args))),
      shots.every((x) => x.chance?.().pen < shotsNow.find((y) => y.id === x.id).chance().pen)], [shotsNow.map((x) => x.id), true, true]);
  check('and its own answers say what comes after them, so a policy may look as far as it cares to',
    next.options.filter((x) => x.commands?.length && !x.run).every((x) => typeof x.then === 'function'), true);
  // The kinds wanted: a seat looking for what it could attack asks for the
  // attacks alone, and is spared every Grid it could walk to from there.
  const only = stance.then(['attack']);
  check('asked for the attacks alone, it is given those and nothing else: the same attacks, with the same odds',
    [only.options.map((x) => x.id), only.options.every((x) => x.tags[0] === 'attack'), only.options.every((x, i) => JSON.stringify(x.chance?.()) === JSON.stringify(shots[i].chance()))],
    [shots.map((x) => x.id), true, true]);
  check('asking moves nothing on the table, and what comes next is worked out once however often it is asked',
    [JSON.stringify(s) === before, stance.then() === next, stance.then(['attack']) === only, only === next], [true, true, true, false]);
  // A move, the Maneuver or a Movement Action: what could be attacked from the
  // Grid it ends in.
  const from = d.options.filter((x) => x.tags[0] === 'move').map((m) => ({ m, q: m.then(['attack']) }));
  const some = from.find((x) => x.q);
  check('a move says what could be attacked from the Grid it ends in, facing as it ends: something from some, and nothing at all from others',
    [from.length > 6, !!some, from.some((x) => x.q === null)], [true, true, true]);
  const landed = M.G.tableAfter(data, s, some.m.commands);
  check('and those are the attacks the seat would be offered there, each with the odds of making it from there',
    [some.q.options.map((x) => x.id), some.q.options.every((x) => JSON.stringify(x.chance?.()) === JSON.stringify(odds.forecast(landed, x.run.args)))],
    [M.SEAT.owed(data, landed, 's1', M.SEAT.newMind()).options.filter((x) => x.tags[0] === 'attack').map((x) => x.id), true]);
  // Ending the Opportunity: whatever the seat is asked after it, or nothing.
  const end = d.options.find((x) => x.id === 'end');
  const ended = M.SEAT.owed(data, M.G.tableAfter(data, s, end.commands), 's1', M.SEAT.newMind());
  check('an answer after which the seat is asked nothing says so', [end.then()?.id ?? null, JSON.stringify(s) === before], [ended?.id ?? null, true]);

  // A TURN LATER THAN THIS ONE: the unit's own next activation, from where an
  // answer leaves it. A Mech is asked on a Timing the policy names.
  const stays = M.SEAT.owedIfActivated(data, M.G.tableAfter(data, s, end.commands), st.U.Mire.uid, 'firing', { only: ['attack'] });
  check('every answer of an activation says what its unit could do when its turn next comes: the Mire, ending here, on its Firing dial',
    [sent.every((x) => typeof x.later === 'function'), diced.some((x) => 'later' in x), end.later(['attack'], 'firing').options.map((x) => x.id), end.later(['attack'], 'firing').options.every((x) => typeof x.chance === 'function')],
    [true, false, stays.decision.options.map((x) => x.id), true]);
  check('a Mech is asked on the Timing named and on no other: with none named there is nothing to say',
    [end.later(['attack']), end.later(['attack'], 'firing') === end.later(['attack'], 'firing'), end.later(['attack'], 'melee') === end.later(['attack'], 'firing')], [null, true, false]);
  const there = M.SEAT.owedIfActivated(data, landed, st.U.Mire.uid, 'firing', { only: ['attack'] });
  check('from the Grid a move ends in, it is what the engine would offer there: sight, a Melee Lock and the arc all counted',
    [(some.m.later(['attack'], 'firing')?.options ?? []).map((x) => x.id), JSON.stringify(s) === before], [(there?.decision?.options ?? []).map((x) => x.id), true]);
  M.L.setLocalSeat(null);
}
{
  // THE TABLE AN ANSWER WOULD LEAVE, looked at any way a seat likes (M7.0:
  // seat.ts Outlook). Its view of it, what it would be asked there, and what
  // any unit would be asked if its own turn opened there, the other squad's
  // among them: how a seat works out what an enemy could do to a unit from
  // where an answer leaves it.
  const st = stage((s0, V) => { V.Mire.stance = 'offensive'; });
  st.turnOf(st.U.Mire, 'firing');
  M.L.setLocalSeat('s1');
  const s = st.s;
  const send = (cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.G.glueAfter(data, s, cmd); return v; };
  const driver = new M.AI.Driver('s1', { data, state: () => s, send, roll: async () => [] }, M.AI.safePolicy, new M.AI.Rng('x'));
  const before = JSON.stringify(s);
  const d = driver.pending();
  const sent = d.options.filter((x) => x.commands?.length && !x.run);
  check('every answer that is commands alone can be looked past, and an answer with dice in it cannot: nobody knows the table it leaves',
    [sent.every((x) => typeof x.after === 'function'), d.options.filter((x) => x.run).some((x) => 'after' in x)], [true, false]);
  const move = d.options.find((x) => x.tags[0] === 'move' && !x.tags.includes('pivot'));
  const landed = M.G.tableAfter(data, s, move.commands);
  const out = move.after();
  check('its view is the seat\'s own view of the table the answer leaves: the unit stands where the move ends, and nothing else has stirred',
    [JSON.stringify(out.view()) === JSON.stringify(M.SEAT.viewOf(data, landed, 's1')), out.view().units.find((u) => u.uid === st.U.Mire.uid).grid, JSON.stringify(out.view()) === JSON.stringify(M.SEAT.viewOf(data, s, 's1'))],
    [true, { col: move.facts.to.c, row: move.facts.to.r }, false]);
  check('what it would be asked there is what `then` says, kind for kind',
    [(out.owed(['attack'])?.options ?? []).map((x) => x.id), out.owed()?.id], [(move.then(['attack'])?.options ?? []).map((x) => x.id), move.then()?.id]);
  // The other squad's Mech, asked on a Timing this seat supposes.
  const cat = st.U['Wild Cat'];
  const theirs = out.turnOf(cat.uid, ['attack'], 'firing');
  const real = M.SEAT.owedIfActivated(data, landed, cat.uid, 'firing', { only: ['attack'] });
  check('what a unit of the OTHER squad would be asked if its turn opened there is that unit\'s own question, put as its own seat would be put it',
    [theirs.seat, theirs.unit, theirs.kind, theirs.options.map((x) => x.id), theirs.options.length > 0], ['s2', cat.uid, 'opp.act', real.decision.options.map((x) => x.id), true]);
  check('its attacks carry the odds of making them on that table: what it could do to the unit where the move left it',
    theirs.options.every((x) => JSON.stringify(x.chance()) === JSON.stringify(odds.forecast(real.table, x.run.args))), true);
  const onMire = (q) => (q?.options ?? []).filter((x) => x.run?.routine === 'attack' && x.facts.targetUid === st.U.Mire.uid).map((x) => x.id);
  const narrow = out.turnOf(cat.uid, [`strike:${st.U.Mire.uid}`], 'firing');
  check('asked for its attacks on one unit, it is given those alone',
    [onMire(narrow), (narrow?.options ?? []).length], [onMire(theirs), onMire(theirs).length]);
  // What comes after one of ITS answers is asked as its seat, not this one's.
  const step = out.turnOf(cat.uid, ['maneuver'], 'firing').options.find((x) => x.tags[0] === 'move');
  const stepped = M.SEAT.owedAfter(data, real.table, 's2', M.SEAT.newMind(), step.commands, { only: ['attack'] });
  check('and what comes next for it is asked as ITS seat: after its Maneuver, its own attacks from there',
    [step.then(['attack'])?.seat ?? null, (step.then(['attack'])?.options ?? []).map((x) => x.id)], [stepped.decision?.seat ?? null, (stepped.decision?.options ?? []).map((x) => x.id)]);
  check('a Mech is asked on the Timing named and not at all with none; a unit that is not there is asked nothing',
    [out.turnOf(cat.uid, ['attack']), out.turnOf(4242, ['attack'], 'firing')], [null, null]);
  // A Drone, in its own phase.
  const porcupine = st.U.Porcupine;
  const auto = out.turnOf(porcupine.uid, ['attack']);
  const autoReal = M.SEAT.owedIfActivated(data, landed, porcupine.uid, undefined, { only: ['attack'] });
  check('a Drone is asked as in the Automatic Phase, with no Timing to name',
    [(auto?.options ?? []).map((x) => x.id), auto?.seat ?? null], [(autoReal?.decision?.options ?? []).map((x) => x.id), autoReal?.decision ? 's2' : null]);
  // One of this squad's own, too.
  const mine = out.turnOf(st.U.Dune.uid, ['attack'], 'firing');
  check('one of this squad\'s own units may be asked the same way', [mine?.seat ?? 's1', mine?.unit ?? st.U.Dune.uid], ['s1', st.U.Dune.uid]);
  // The table the question itself was asked of.
  const here = d.here();
  check('the question says the same of the table it was asked of: its view is the view the policy is handed, and it is asked the same question there',
    [JSON.stringify(here.view()) === JSON.stringify(M.SEAT.viewOf(data, s, 's1')), here.owed().id === d.id, here.owed().options.map((x) => x.id)], [true, true, d.options.map((x) => x.id)]);
  check('and what an enemy could do to a unit that stays where it is',
    (here.turnOf(cat.uid, ['attack'], 'firing')?.options ?? []).map((x) => x.id), M.SEAT.owedIfActivated(data, s, cat.uid, 'firing', { only: ['attack'] }).decision.options.map((x) => x.id));
  check('every question a look gives back can be looked past in its turn', [typeof theirs.here, typeof move.then().here, typeof theirs.here().view], ['function', 'function', 'function']);
  // How long a walk is, on either table: the seam's own count.
  const grid = (c, r) => ({ col: c, row: r });
  const from = [grid(move.facts.to.c, move.facts.to.r), grid(0, 0), grid(11, 11)];
  const to = [grid(5, 5), grid(6, 5)];
  const cr = (list) => list.map((g) => ({ c: g.col, r: g.row }));
  check('and how long a walk is from any Grid of it: the Grids on the road and the activations it takes, as the seam counts them, with what is left of an activation counted first',
    [out.walk(st.U.Mire.uid, from, to), here.walk(cat.uid, from, to, [4]), out.walk(4242, from, to), out.walk(st.U.Mire.uid, from, to).every((w) => w && w.turns >= 1)],
    [M.SEAT.walkIn(data, landed, st.U.Mire.uid, cr(from), cr(to)), M.SEAT.walkIn(data, s, cat.uid, cr(from), cr(to), [4]), [null, null, null], true]);
  check('each look is worked out once, and nothing on the table has moved',
    [move.after() === out, out.view() === out.view(), out.turnOf(cat.uid, ['attack'], 'firing') === theirs, d.here() === here, JSON.stringify(s) === before], [true, true, true, true, true]);
  M.L.setLocalSeat(null);
}
{
  // THE OPPORTUNITY A DIAL WOULD OPEN. In the Planning Phase a Mech's dial is
  // chosen in private; what each Timing would open is the engine's to say.
  // The Dune stands far off: beside it, its aura would open the dials either
  // side of the one chosen (Flexible Timing), and a Movement dial would shoot.
  const st = stage((s0, V, at) => {
    s0.round.phase = 1; s0.script.stage = '1:1'; s0.script.revealed = []; s0.script.commits = {};
    for (const t of s0.tokens) delete t.timing;
    at(V.Dune, 0, 0, 1);
  });
  M.L.setLocalSeat('s1');
  const s = st.s;
  const send = (cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.G.glueAfter(data, s, cmd); return v; };
  const driver = new M.AI.Driver('s1', { data, state: () => s, send, roll: async () => [] }, M.AI.safePolicy, new M.AI.Rng('x'));
  const before = JSON.stringify(s);
  const d = driver.pending();
  const firing = d.options.find((x) => x.id === 'dial:firing');
  const opened = stage((s0, V, at) => { at(V.Dune, 0, 0, 1); });
  opened.turnOf(opened.U.Mire, 'firing');
  const real = M.SEAT.owed(data, opened.s, 's1', M.SEAT.newMind());
  check('a Timing Dial says what Opportunity it would open: the question the Mech would be put on that dial, with the odds on its attacks',
    [d.kind, d.options.every((x) => typeof x.then === 'function'), firing.then().kind, firing.then().options.map((x) => x.id),
      firing.then().options.filter((x) => x.run?.routine === 'attack').every((x) => x.chance?.().pen > 0)],
    ['planning.dial', true, 'opp.act', real.options.map((x) => x.id), true]);
  check('some kinds of it may be asked alone, each dial opens its own, and looking sets no dial and moves nothing',
    [firing.then(['attack']).options.every((x) => x.tags[0] === 'attack'), d.options.find((x) => x.id === 'dial:movement').then(['attack']), driver.mind.dials, JSON.stringify(s) === before],
    [true, null, null, true]);
  M.L.setLocalSeat(null);
}
{
  // A launch: the Projectile it puts down, asked as in its own phase.
  const st = stage();
  st.turnOf(st.U.Mire, 'projectile');
  M.L.setLocalSeat('s1');
  const s = st.s;
  const send = (cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.G.glueAfter(data, s, cmd); return v; };
  const driver = new M.AI.Driver('s1', { data, state: () => s, send, roll: async () => [] }, M.AI.safePolicy, new M.AI.Rng('x'));
  const before = JSON.stringify(s);
  const launches = driver.pending().options.filter((x) => x.tags[0] === 'launch');
  const turns = launches.map((x) => ({ x, q: x.later(['attack']) }));
  const hit = turns.find((t) => t.q);
  const miss = turns.find((t) => !t.q);
  const whole = hit.x.later();
  const cat = st.U['Wild Cat'];
  const apart = (x) => Math.abs(x.facts.to.c - Math.floor(cat.col / 3)) + Math.abs(x.facts.to.r - Math.floor(cat.row / 3));
  check('a launch says what its Projectile could do when its turn comes: an Explosion, with its odds, on an enemy inside its strike, and nothing from a Landing Point that reaches none',
    [launches.length > 10, hit.q.kind, s.tokens.some((t) => t.uid === hit.q.unit), hit.q.options.every((x) => x.tags.includes('explosion') && x.chance().pen > 0), !!miss,
      turns.filter((t) => (t.q?.options ?? []).some((x) => x.facts.targetUid === cat.uid)).every((t) => apart(t.x) <= t.x.facts.strike),
      turns.filter((t) => apart(t.x) <= t.x.facts.strike).length > 0, JSON.stringify(s) === before],
    [true, 'activation.act', false, true, true, true, true, true]);
  check('and asked for everything, the whole of that turn: the same Explosions among its answers',
    [whole.kind, whole.unit === hit.q.unit, hit.q.options.every((x) => whole.options.some((y) => y.id === x.id))], ['activation.act', true, true]);
  M.L.setLocalSeat(null);
}
{
  // A Drone under a Command: where it could take its Automatic shot from.
  const st = stage((s0, V, at) => {
    at(V.Mire, 5, 4, 2); at(V.Porcupine, 5, 8, 0); at(V.Dune, 0, 0, 2);
    s0.round.phase = 0; s0.script.stage = '1:0';
  });
  st.s.script.opp = { ...M.TY.newOpportunity(st.U.Porcupine.uid, undefined), commanded: true };
  M.L.setLocalSeat('s2');
  const s = st.s;
  const send = (cmd) => { const v = M.C.perform(data, s, cmd); if (v.ok) M.G.glueAfter(data, s, cmd); return v; };
  const driver = new M.AI.Driver('s2', { data, state: () => s, send, roll: async () => [] }, M.AI.safePolicy, new M.AI.Rng('x'));
  const d = driver.pending();
  const moves = (d?.options ?? []).filter((x) => x.tags[0] === 'move');
  const beside = moves.filter((x) => Math.abs(x.facts.to.c - 5) <= 1 && Math.abs(x.facts.to.r - 4) <= 1);
  const clear = moves.filter((x) => x.facts.to.c === 5 && x.facts.to.r === 6 && x.facts.facing === 0);
  check('a Drone is asked as in the Automatic Phase, with no Timing to name: from a Grid in line it has its shot, and from a Grid beside the Mech (Melee Locked) it has none',
    [d?.kind, d?.unit, moves.length > 8, clear.map((x) => (x.later(['attack'])?.options ?? []).map((y) => y.id)), beside.length > 0, beside.every((x) => x.later(['attack']) === null)],
    ['activation.act', st.U.Porcupine.uid, true, [[`attack:543_A:${st.U.Mire.uid}`]], true, true]);
  M.L.setLocalSeat(null);
}
{
  // In the window. One attack, heard question by question: the Mire's Chop at
  // the Wild Cat, the attacker spending a Link on a Focus and then choosing
  // which dice to throw again.
  const st = stage();
  const turnNow = st.turnOf(st.U.Mire, 'melee');
  turnNow.stanceLocked = true;
  M.L.setLocalSeat('s1');
  const d0 = M.SEAT.owed(data, st.s, 's1', M.SEAT.newMind());
  const option = d0.options.find((x) => x.tags.includes('attack') && x.facts?.actionId === '535_A' && x.facts?.targetUid === st.U['Wild Cat'].uid);
  const heard = {};
  let focused = false;
  let thrown = null;
  const s = clone(st.s);
  const watchers = [];
  const send = (seat, cmd) => {
    const v = seat === 's1' ? M.C.perform(data, s, cmd) : M.C.applyRemote(data, s, cmd);
    if (v.ok) { M.G.glueAfter(data, s, cmd); for (const w of watchers) w(cmd); }
    return v;
  };
  // Every die of both rolls shows nothing; the Part Die finds the Torso; a die
  // thrown again hits. So the attack does nothing as it lies, and what a Focus
  // is worth is what a reroll could make of it.
  let rerolling = false;
  const torso = data.dice.dice.black.faces.findIndex((f) => f[0]?.part === 'torso');
  const roll = async (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({
    color, face: color === 'black' ? torso : rerolling ? 0 : 7,
  })));
  const drivers = {};
  let pictured = 'never asked';
  const listen = (seat) => ({
    name: 'heard',
    choose(q) {
      // The defender's window holds a picture of the attack: asked for a
      // reading, the picture has none, and the seat's calculator answers.
      if (seat === 's2' && q.kind === 'defence.declare') pictured = [drivers.s2.combat.helper.reading(), !!drivers.s2.combat.reading()];
      heard[q.kind] ??= q.options.map((x) => ({ id: x.id, chance: x.chance ? x.chance() : undefined }));
      if (seat === 's1' && q.kind === 'attack.focus' && !focused) { focused = true; return { option: 'focus.use' }; }
      if (seat === 's1' && q.kind === 'attack.reroll') {
        // The answer that throws two of the three Red dice again and leaves the rest.
        const pick = q.options.find((x) => x.id === 'reroll.pick:0,1');
        thrown = { ids: q.options.map((x) => x.id), before: drivers.s1.combat.reading().hand.attack };
        rerolling = true;
        return { option: pick?.id ?? q.fallback };
      }
      return { option: q.fallback };
    },
  });
  for (const seat of ['s1', 's2']) {
    drivers[seat] = new M.AI.Driver(seat, { data, state: () => s, send: (cmd) => send(seat, cmd), roll }, listen(seat), new M.AI.Rng(`o:${seat}`));
  }
  for (const dr of Object.values(drivers)) watchers.push((cmd) => dr.observe(cmd));
  const linkBefore = s.tokens.find((t) => t.uid === st.U.Mire.uid).link;
  await drivers.s1.attack(option.run.args);
  let after = null;
  for (let i = 0, idle = 0; i < 400 && idle < 60; i++) {
    let moved = false;
    for (const dr of [drivers.s1, drivers.s2]) {
      if (!dr.combat.decision()) continue;
      const r = await dr.step();
      if (r.kind === 'acted') moved = true;
      if (thrown && !after && r.decision?.kind === 'attack.reroll') after = drivers.s1.combat.reading()?.hand.attack ?? null;
    }
    if (!drivers.s1.combat.busy && !s.script?.combatView) break;
    if (!moved) { idle++; await tick(); } else idle = 0;
  }
  M.L.setLocalSeat(null);
  const has = (kind) => (heard[kind] ?? []).filter((x) => x.chance).map((x) => x.id);
  const isForecast = (f) => !!f && ['hit', 'pen', 'damage', 'destroy', 'kill', 'link'].every((k) => typeof f[k] === 'number');
  check('the window of the seat attacked is a picture and reads nothing of its own: its odds are asked of the seat\'s calculator', pictured, [null, true]);
  check('the defender, asked what it declares, finds what each answer comes to: nothing, or the Parry on its Shield arm',
    [has('defence.declare'), heard['defence.declare'].every((x) => isForecast(x.chance))], [['declare.designate:leftHand', 'declare.none'], true]);
  const declared = Object.fromEntries(heard['defence.declare'].map((x) => [x.id, x.chance]));
  check('  and the Parry it may declare makes a Penetration less likely there than the die makes it overall',
    declared['declare.designate:leftHand'].pen < declared['declare.none'].pen, true);
  check('the attacker, with the Part Die on offer, finds what keeping it and throwing it again come to',
    [has('attack.partfocus'), heard['attack.partfocus'].find((x) => x.id === 'part.keep').chance.parts.map((p) => p.slot)], [['part.keep', 'part.focus'], ['torso']]);
  const focus = Object.fromEntries((heard['attack.focus'] ?? []).map((x) => [x.id, x.chance]));
  check('with both rolls on the table: the dice as they lie, which do nothing, against the best reroll a Focus could buy',
    [has('attack.focus').sort(), focus['focus.pass'].pen, focus['focus.use'].pen > 0.9], [['focus.pass', 'focus.use'], 0, true]);
  // Asked while the attack still shows nothing: no reroll of the DEFENCE dice
  // makes it do more than that. (What the attacker's best reroll would do is
  // not the defender's Focus to be weighed by.)
  const guard = Object.fromEntries((heard['defence.focus'] ?? []).map((x) => [x.id, x.chance]));
  check('the defender is told the same of its own dice: what its own reroll could do, which is no more than the attack as it lies',
    [has('defence.focus').sort(), guard['focus.pass']?.pen, guard['focus.use']?.pen], [['focus.pass', 'focus.use'], 0, 0]);
  check('having Focused, the attacker is offered every way of rerolling that differs from another, each with its odds, and keeping the roll',
    [thrown?.ids.slice().sort(), has('attack.reroll').length === thrown?.ids.length],
    // Four dice, the three Red ones alike: none, one, two or three of them,
    // with or without the Yellow. Throwing none is Keep, and all four is `all`
    // (which is every die doing nothing, too), so six other choices are left.
    [['reroll.all', 'reroll.keep:attack', 'reroll.pick:0', 'reroll.pick:0,1', 'reroll.pick:0,1,2', 'reroll.pick:0,3', 'reroll.pick:0,1,3', 'reroll.pick:3'].sort(), true]);
  const rerolls = Object.fromEntries((heard['attack.reroll'] ?? []).map((x) => [x.id, x.chance]));
  check('  each more die thrown again is worth more, and keeping the roll is worth what the dice already show',
    [rerolls['reroll.keep:attack']?.pen, rerolls['reroll.pick:0']?.pen < rerolls['reroll.pick:0,1']?.pen, rerolls['reroll.pick:0,1']?.pen < rerolls['reroll.pick:0,1,2']?.pen,
      rerolls['reroll.pick:0,1,2']?.pen < rerolls['reroll.all']?.pen], [0, true, true, true]);
  check('and the one it takes throws exactly those dice again: two of the Red dice, which come up Heavy Hits',
    [thrown?.before.map((x) => `${x.color[0]}${x.face}`), after?.map((x) => `${x.color[0]}${x.face}`)], [['r7', 'r7', 'r7', 'y7'], ['r0', 'r0', 'r7', 'y7']]);
  check('the Focus cost the attacker a Link', linkBefore - s.tokens.find((t) => t.uid === st.U.Mire.uid).link, 1);
}
{
  // A REROLL SOMEBODY ELSE PAYS FOR. The Wild Cat's Coordinated Observation
  // lets an Ally firing at a target it can see throw its {Eye} dice again: the
  // Porcupine's Automatic shot at the Mire, with two Eyes and two Lightning on
  // the table. The answer is weighed as that reroll, the two Eye dice and no
  // others, and not as the pick of the dice a Focus would buy.
  const st = stage((s0, V, at) => { at(V.Porcupine, 5, 7, 0); at(V.Mire, 5, 4, 2); at(V['Wild Cat'], 7, 4, 3); at(V.Raven, 11, 11, 3); at(V.Tarantula, 11, 9, 3); at(V.Dune, 0, 0, 1); });
  const s = clone(st.s);
  s.round.phase = 3; s.script.stage = '1:3';
  s.script.opp = M.TY.newOpportunity(st.U.Porcupine.uid, undefined);
  M.L.setLocalSeat('s1');
  const watchers = [];
  const send = (seat, cmd) => {
    const v = seat === 's1' ? M.C.perform(data, s, cmd) : M.C.applyRemote(data, s, cmd);
    if (v.ok) { M.G.glueAfter(data, s, cmd); for (const w of watchers) w(cmd); }
    return v;
  };
  // Red dice: an Eye, an Eye, a Lightning, a Lightning. The Part Die finds the
  // Torso, and every other die shows nothing.
  let reds = 0;
  const torso = data.dice.dice.black.faces.findIndex((f) => f[0]?.part === 'torso');
  const roll = async (pool) => Object.entries(pool).flatMap(([color, n]) => Array.from({ length: n }, () => ({ color, face: color === 'black' ? torso : color === 'red' ? (reds++ < 2 ? 7 : 6) : 7 })));
  const drivers = {};
  let lent = null;
  const listen = (seat) => ({
    name: 'heard',
    choose(q) {
      if (seat === 's2' && q.kind === 'attack.focus' && !lent) {
        const hand = new InHand(drivers.s2.combat.reading());
        const free = q.options.find((x) => x.id === 'focus.lent');
        lent = { ids: q.options.map((x) => x.id), tags: free?.tags, dice: hand.reading.hand.attack.map((x) => `${x.color[0]}${x.face}`), chance: free?.chance?.() ?? null,
          eyes: hand.reroll('attack', [0, 1]), best: hand.bestReroll('attack'), stands: hand.stands() };
      }
      return { option: q.fallback };
    },
  });
  for (const seat of ['s1', 's2']) drivers[seat] = new M.AI.Driver(seat, { data, state: () => s, send: (cmd) => send(seat, cmd), roll }, listen(seat), new M.AI.Rng(`l:${seat}`));
  for (const dr of Object.values(drivers)) watchers.push((cmd) => dr.observe(cmd));
  const shot = M.SEAT.owed(data, s, 's2', M.SEAT.newMind()).options.find((x) => x.id === `attack:543_A:${st.U.Mire.uid}`);
  await drivers.s2.attack(shot.run.args);
  for (let i = 0, idle = 0; i < 400 && idle < 60; i++) {
    let moved = false;
    for (const dr of [drivers.s2, drivers.s1]) {
      if (!dr.combat.decision()) continue;
      if ((await dr.step()).kind === 'acted') moved = true;
    }
    if (!drivers.s2.combat.busy && !s.script?.combatView) break;
    if (!moved) { idle++; await tick(); } else idle = 0;
  }
  M.L.setLocalSeat(null);
  check('a reroll an Ally lends is offered beside the Focus, free, and is weighed as what it is: the dice showing an Eye thrown again, and no others',
    [lent?.ids.includes('focus.lent'), lent?.tags, lent?.dice, JSON.stringify(lent?.chance) === JSON.stringify(lent?.eyes), lent?.chance?.pen > lent?.stands.pen],
    [true, ['focus', 'free'], ['r7', 'r7', 'r6', 'r6'], true, true]);
  check('  which is not the pick of the dice a Focus would buy: that one throws the Lightning again too', [lent?.best.indices, JSON.stringify(lent?.best.forecast) === JSON.stringify(lent?.chance)], [[0, 1, 2, 3], false]);
}

M.L.setLocalSeat(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

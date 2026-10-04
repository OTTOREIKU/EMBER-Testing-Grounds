// AN ACTION WITH NOTHING TO DO (notices pick 2, 2026-09-29): units.ts
// actionIdleWhy, the one reading every page greys by before the tap, driven
// against the shipped cards. Each family is checked both ways - something in
// reach to act on, and nothing - and the pages are pinned as text below, since
// the whole point is that five pages ask it the same way.
import { readFileSync, writeFileSync } from 'node:fs';
// The Match Centre's turn readings (which Actions, which targets, which Grids)
// live in turn.ts since 2026-10-01, shared with the seat seam; the pins that
// named them in matchhud.ts follow them there.
const turnSrc = readFileSync(new URL('../src/turn.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_idleactions.entry.ts', import.meta.url);
const out = new URL('./_idleactions.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { loadData } from '../src/data';",
  "export { idleWorldFor } from '../src/glue';",
  "export * as U from '../src/units';",
  "export * as Ty from '../src/types';",
  "export * as D from '../src/data';",
  "export * as C from '../src/commands';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const { U, Ty, D, C } = M;
const data = await M.loadData();

console.log('Actions with nothing to do\n');

// ---------- a free table and its units ----------
const table = () => U.migrateState({ v: 3, tokens: [], nextUid: 1, round: { n: 1, phase: 2, firstPlayer: 's1' } }, data);
const G = (c, r) => ({ col: c * 3, row: r * 3 });
const L = (extra = {}) => ({ torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2', ...extra });
function mech(s, side, loadout, c, r, extra = {}) {
  const t = { ...U.makeMechToken(s, data, loadout, side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
function drone(s, side, cardId, c, r, extra = {}) {
  const t = { ...U.makeDroneToken(s, data, data.byId.get(cardId), side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
const action = (cardId, actionId) => data.byId.get(cardId).actions.find((a) => a.id === actionId);
const common = (id) => data.commonActions.find((a) => a.id === id);
const idle = (s, t, a, terrain = []) => U.actionIdleWhy(data, t, a, M.idleWorldFor(data, s, terrain));

// ---------- Charge ----------
{
  const s = table();
  const ion = mech(s, 's1', L({ rightHand: '122' }), 3, 3);
  const plain = mech(s, 's1', L(), 5, 3);
  check('Charge: a Part still face-down is something to Charge', idle(s, ion, common('COMMON_CHARGE')), null);
  ion.charge = U.chargeableSlots(data, ion).map((x) => x.slot);
  check('...and with every one Charged, there is nothing left to',
    /already holds a face-up Charge Token/.test(idle(s, ion, common('COMMON_CHARGE')) ?? ''), true);
  check('...and a Mech with no Chargeable Part has nothing to Charge at all',
    /has no Part with a Chargeable Action/.test(idle(s, plain, common('COMMON_CHARGE')) ?? ''), true);
}

// ---------- Strengthen Link and System Cleanup (504, a support Core) ----------
{
  const s = table();
  const src504 = mech(s, 's1', L({ torso: '504' }), 3, 3);
  const ally = mech(s, 's1', L(), 4, 3);
  ally.link = 0;
  check('Strengthen Link: an Ally Mech short of Link in reach', idle(s, src504, action('504', '504_A')), null);
  ally.link = U.maxLink(data, ally);
  src504.link = U.maxLink(data, src504);
  check('...and with every one at its pilot\'s Link Value, nothing to restore',
    /already at its pilot's Link Value/.test(idle(s, src504, action('504', '504_A')) ?? ''), true);
  check('System Cleanup: nobody wearing a Square Token, nothing to remove',
    /wears a Square Token|wears a Hexagon Token/.test(idle(s, src504, action('504', '504_B')) ?? ''), true);
  const square = Ty.STATUSES.find((x) => x.shape === U.tokenCleanupOf(action('504', '504_B')).shape);
  ally.statuses = [square.id];
  check('...and one that wears one is something to remove', idle(s, src504, action('504', '504_B')), null);
}

// ---------- the Link Beacon resolves with nobody short of Link ----------
{
  const s = table();
  const beacon = drone(s, 's1', '075', 3, 3);
  check('a Link Beacon is spent all the same, so it is never "nothing to do"', idle(s, beacon, action('075', '075_A')), null);
}

// ---------- Stance feedback (ZHDR-206_B) ----------
{
  const s = table();
  const eagle = drone(s, 's1', 'ZHDR-206', 3, 3);
  check('Stance feedback: no Ally Mech at all, nobody to switch',
    /no Ally Mech out of Shutdown Stance/.test(idle(s, eagle, action('ZHDR-206', 'ZHDR-206_B')) ?? ''), true);
  mech(s, 's1', L(), 4, 3);
  check('...and an Ally Mech in reach is somebody to switch', idle(s, eagle, action('ZHDR-206', 'ZHDR-206_B')), null);
}

// ---------- repairs: an ally's (the SU1) and its own (SH-15) ----------
{
  const s = table();
  const su1 = drone(s, 's1', 'ZYDR-108', 3, 3);
  const ally = mech(s, 's1', L(), 4, 3);
  check('Armor Patch: no Ally Unit with a Damaged Part, nothing to mend',
    /has a Damaged Part/.test(idle(s, su1, action('ZYDR-108', 'ZYDR-108_B')) ?? ''), true);
  ally.partStates = { ...ally.partStates, leftHand: 'damaged' };
  check('...and one Damaged Part in reach is something to mend', idle(s, su1, action('ZYDR-108', 'ZYDR-108_B')), null);
  const fixer = mech(s, 's1', L({ backpack: '001' }), 6, 6);
  check('Field Repair on itself: nothing Damaged or unrepaired, nothing to repair',
    /nothing is Damaged/.test(idle(s, fixer, action('001', '001_A')) ?? ''), true);
  fixer.partStates = { ...fixer.partStates, rightHand: 'damaged' };
  check('...and a Damaged Part of its own is something to repair', idle(s, fixer, action('001', '001_A')), null);
}

// ---------- Resupply (086_A, the Ammunition Pack) ----------
{
  const s = table();
  const rule = U.resupplyOf(action('086', '086_A'));
  const holderCard = data.cards.find((c) => c.type !== 'backpack' && (c.actions ?? []).some((a) => a.id === rule.actionId && a.storage));
  const slot = holderCard?.type;
  const pack = mech(s, 's1', L({ backpack: '086', ...(slot && slot !== 'torso' ? { [slot]: holderCard.id } : {}) }), 3, 3);
  const holds = U.tokenCards(data, pack).some(({ card }) => (card.actions ?? []).some((a) => a.id === rule.actionId));
  check('the Ammunition Pack test Mech holds the Action it resupplies', holds, true);
  check('Resupply: no Ammo spent in reach, nothing to resupply',
    /nothing in reach has spent any Ammo/.test(idle(s, pack, action('086', '086_A')) ?? ''), true);
  pack.ammo = { ...pack.ammo, [rule.actionId]: 0 };
  check('...and a spent magazine is something to top up', idle(s, pack, action('086', '086_A')), null);
}

// ---------- Optical Camouflage and a self-applied Token ----------
{
  const s = table();
  const octo = mech(s, 's1', L({ torso: '096' }), 3, 3);
  check('Activate camouflage: not yet hidden', idle(s, octo, action('096', '096_B')), null);
  octo.statuses = ['camouflage'];
  check('...and already hidden, nothing to activate',
    idle(s, octo, action('096', '096_B')), `${octo.label} is already in the Optical Camouflage State.`);
  const viper = mech(s, 's1', L({ torso: '094' }), 5, 5);
  const grant = U.selfStatusGrant(action('094', '094_A'));
  check('a self-applied Token not yet worn', idle(s, viper, action('094', '094_A')), null);
  viper.statuses = [grant.statusId];
  check('...and one already worn is refused in the engine\'s own words', idle(s, viper, action('094', '094_A')), U.selfGrantWhy(viper, grant));
}

// ---------- Reveal, the Common Action ----------
{
  const s = table();
  const m = mech(s, 's1', L(), 3, 3);
  check('Reveal out of the Optical Camouflage State has nothing to reveal, in the engine\'s words',
    idle(s, m, common('COMMON_REVEAL')), 'This unit is not in the Optical Camouflage State.');
  m.statuses = ['camouflage'];
  check('...and in it, it does', idle(s, m, common('COMMON_REVEAL')), null);
}

// ---------- Discard, the Common Action ----------
{
  const s = table();
  const withFace = data.cards.find((c) => ['leftHand', 'rightHand', 'backpack'].includes(c.type) && D.discardFaceOf(data, c));
  check('a card with a Discard Card exists to test with', !!withFace, true);
  const holder = mech(s, 's1', L({ [withFace.type]: withFace.id }), 5, 5);
  check('Discard: a Part standing with a Discard Card is something to Discard', idle(s, holder, common('COMMON_DISCARD')), null);
  for (const { slot, card } of U.tokenCards(data, holder)) {
    if (slot !== 'pilot' && D.discardFaceOf(data, card)) holder.partStates = { ...holder.partStates, [slot]: 'destroyed' };
  }
  check('...and with every such Part destroyed, nothing is left to flip',
    idle(s, holder, common('COMMON_DISCARD')), `${holder.label} holds nothing it can Discard.`);
}

// ---------- with no board, the table judges Range: only whether a target exists ----------
{
  const s = { ...table(), noBoard: true };
  const kk9Card = data.cards.find((c) => (c.actions ?? []).some((a) => U.overwatchOf(a)));
  const ow = kk9Card.actions.find((a) => U.overwatchOf(a));
  const kk9 = drone(s, 's1', kk9Card.id, 0, 0);
  check('Overwatch Strike with no board and no enemy: nothing to call it on', idle(s, kk9, ow), 'No enemy is on the table.');
  mech(s, 's2', L(), 0, 0);
  check('...an enemy but no Ally Mech to fire', idle(s, kk9, ow), 'No Ally Mech can fire.');
  mech(s, 's1', L(), 0, 0);
  check('...and both, something to call', idle(s, kk9, ow), null);
  const board = table();
  const kk9b = drone(board, 's1', kk9Card.id, 3, 3);
  check('on a board its own door measures the Range instead', idle(board, kk9b, ow), null);
  const allCard = data.cards.find((c) => (c.actions ?? []).some((a) => U.electronicAll(a) && !U.isScanAction(a)));
  const allAct = allCard?.actions.find((a) => U.electronicAll(a) && !U.isScanAction(a));
  check('an every-enemy Electronic Action exists to test with', !!allAct, true);
  if (allAct) {
    const s2 = { ...table(), noBoard: true };
    const who = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'].includes(allCard.type)
      ? mech(s2, 's1', L({ [allCard.type]: allCard.id }), 0, 0) : drone(s2, 's1', allCard.id, 0, 0);
    check('...with no board and no enemy: nothing to target', /can target is on the table/.test(idle(s2, who, allAct) ?? ''), true);
    mech(s2, 's2', L(), 0, 0);
    check('...and with one, something to target', idle(s2, who, allAct), null);
  }
}

// ---------- a Freeform pad: its units stand on placeholder cells (review, 2026-09-29) ----------
// importSquad spreads each squad along its own edge, so a Range measured there
// measures nothing real. With no board the table judges it, as the pad's own
// flows always did; Blink, Strengthen Link and System Cleanup measured it and
// greyed legal Actions.
{
  const fresh = () => U.migrateState({ v: 3, map: '', tokens: [], nextUid: 1, round: { n: 1, phase: 2, firstPlayer: 's1' }, noBoard: true }, data);
  const s = fresh();
  C.perform(data, s, { kind: 'importSquad', seat: 's1', name: 'A', mechs: [{ loadout: L({ torso: '555' }), name: 'Taurus' }], drones: [] });
  const taurus = s.tokens[0];
  const blink = action('555', '555_B');
  const lonely = idle(s, taurus, blink) ?? '';
  check('Freeform pad: Prototype Blink with no other Mech on the table has nobody to swap with, and names no Range',
    [/no Ground Mech the size of .* is on the table, enemy or allied/.test(lonely), /within Range/.test(lonely)], [true, false]);
  C.perform(data, s, { kind: 'importSquad', seat: 's2', name: 'B', mechs: [{ loadout: L(), name: 'E1' }], drones: [] });
  check('...an enemy Mech on the far edge is out of Range as the board would measure it',
    U.blinkTargets(data, s.tokens, taurus, blink).length, 0);
  check('...and is still somebody to swap with, since the table judges the Range', idle(s, taurus, blink), null);

  const s2 = fresh();
  C.perform(data, s2, { kind: 'importSquad', seat: 's1', name: 'A', mechs: [{ loadout: L({ torso: '018' }), name: 'Aurora' }, ...[2, 3, 4, 5, 6].map((i) => ({ loadout: L(), name: `M${i}` }))], drones: [] });
  for (const t of s2.tokens) t.link = U.maxLink(data, t);
  const aurora = s2.tokens[0];
  const strengthen = action('018', '018_B');
  s2.tokens.at(-1).link = 0;
  check('Freeform pad: the only Mech short of Link is the last of the row, out of the measured Range',
    U.linkSupportTargets(data, s2.tokens, aurora, strengthen).length, 0);
  check('...and Strengthen Link still has somebody to restore', idle(s2, aurora, strengthen), null);

  const s3 = fresh();
  C.perform(data, s3, { kind: 'importSquad', seat: 's1', name: 'A', mechs: [{ loadout: L({ torso: '504' }), name: 'Nimbus' }, { loadout: L(), name: 'M2' }, { loadout: L(), name: 'M3' }, { loadout: L(), name: 'M4' }], drones: Array.from({ length: 6 }, () => ({ cardId: 'PRDR-202' })) });
  const nimbus = s3.tokens[0];
  const cleanup = action('504', '504_B');
  const rule = U.tokenCleanupOf(cleanup);
  const bare = idle(s3, nimbus, cleanup) ?? '';
  check('Freeform pad: System Cleanup with no Token anywhere, said without a Range',
    [/no Ally Unit wears a (Square|Hexagon) Token/.test(bare), /within Range/.test(bare)], [true, false]);
  const square = Ty.STATUSES.find((x) => x.shape === rule.shape);
  s3.tokens.at(-1).statuses = [square.id];
  check('...a Token on the last drone of the row, out of the measured Range',
    U.tokenCleanupTargets(data, s3.tokens, nimbus, cleanup, rule).length, 0);
  check('...is still something to remove', idle(s3, nimbus, cleanup), null);
}

// ---------- a single Scan with nothing to find (the pad opened an empty list) ----------
{
  const scan = common('COMMON_SCAN');
  for (const noBoard of [true, false]) {
    const s = { ...table(), ...(noBoard ? { noBoard: true } : {}) };
    const m = mech(s, 's1', L(), 1, 1);
    const foe = mech(s, 's2', L(), 5, 5);
    const where = noBoard ? 'no board' : 'a board';
    check(`Scan, ${where}: no enemy hiding or wearing Low Profile, nothing to find`,
      /the Scan finds nothing/.test(idle(s, m, scan) ?? ''), true);
    foe.statuses = ['lowProfile'];
    check(`...a Low Profile Token anywhere on the table is something to strip (${where})`, idle(s, m, scan), null);
    foe.statuses = ['camouflage'];
    check(`...and so is the Optical Camouflage State (${where})`, idle(s, m, scan), null);
  }
}

// ---------- the engine refuses it too, on the pad's table (1.8) ----------
// Supplementary Rules 1.04, 1.8: an Action that can change nothing may not be
// taken. performAction asks the same reading the rows grey with, told there
// is no board, so the pad's refusal and its greyed row agree.
{
  const s = { ...table(), noBoard: true };
  const m = mech(s, 's1', L(), 1, 1);
  const foe = mech(s, 's2', L(), 5, 5);
  const scan = { kind: 'performAction', seat: 's1', uid: m.uid, actionId: 'COMMON_SCAN' };
  const refused = M.C.check(data, s, scan);
  check('on a table with no board, the engine refuses a Scan with nothing to find, with the row\'s reason',
    [refused.ok, /the Scan finds nothing/.test(refused.why ?? '')], [false, true]);
  foe.statuses = ['camouflage'];
  // With something to find, that reason goes; this bare table then asks for
  // the unit's Action Opportunity, a rule of its own.
  check('...and a camouflaged enemy on the table lifts that refusal',
    /the Scan finds nothing/.test(M.C.check(data, s, scan).why ?? ''), false);
}

// ---------- a Token on a chosen target (PRDR-202_A, Target Tag) ----------
{
  const s = table();
  const tagger = drone(s, 's1', 'PRDR-202', 3, 3);
  check('Target Tag: no unit in Range and sight, nothing to tag',
    /can gain it/.test(idle(s, tagger, action('PRDR-202', 'PRDR-202_A')) ?? ''), true);
  mech(s, 's2', L(), 3, 4);
  check('...and an enemy next to it is somebody to tag', idle(s, tagger, action('PRDR-202', 'PRDR-202_A')), null);
}

// ---------- Remote Access with no Terminal on the table ----------
{
  const s = table();
  const m = mech(s, 's1', L(), 3, 3);
  check('Remote Access: no Terminal on the table, nothing to access',
    /There is no Terminal on the table to access/.test(idle(s, m, common('COMMON_REMOTE_ACCESS')) ?? ''), true);
}

// ---------- the White Dwarf's Bit Port: Recover only when empty ----------
{
  const s = table();
  const port = mech(s, 's1', L({ backpack: '292' }), 3, 3);
  const a = action('292', '292_A');
  check('a Bit Port with Ammo left Launches: not this reading\'s business', idle(s, port, a), null);
  const w = { ...M.idleWorldFor(data, s, []), ammoLeft: () => 0 };
  check('...empty, with no Bit of this squad in reach, it has nothing to Recover',
    /the Bit Port is empty/.test(U.actionIdleWhy(data, port, a, w) ?? ''), true);
}

// ---------- what this reading leaves alone ----------
{
  const s = table();
  const m = mech(s, 's1', L(), 3, 3);
  const firing = U.tokenCards(data, m).flatMap(({ card }) => card.actions ?? []).find((a) => a.type === 'Firing');
  check('an attack is never "nothing to do": its target is picked on the board', idle(s, m, firing), null);
  check('nor a Stabilize, which asks its own question', idle(s, m, common('COMMON_STABILIZE')), null);
}

// ---------- it never throws, on any shipped card ----------
// Every page now asks it for every row it draws, so one card it choked on
// would take a whole panel down with it.
{
  const s = table();
  const enemy = mech(s, 's2', L(), 8, 8);
  void enemy;
  const thrown = [];
  let asked = 0;
  for (const card of data.cards) {
    const acts = card.actions ?? [];
    if (!acts.length) continue;
    let t;
    try {
      t = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'].includes(card.type)
        ? mech(s, 's1', L({ [card.type]: card.id }), 3, 3)
        : drone(s, 's1', card.id, 3, 3);
    } catch { continue; }
    for (const a of [...acts, ...data.commonActions]) {
      asked++;
      try { idle(s, t, a); } catch (e) { thrown.push(`${card.id}:${a.id}: ${e.message}`); }
    }
    s.tokens = s.tokens.filter((x) => x !== t);
  }
  check(`asked of every Action on every shipped card (${asked} asks), it never throws`, thrown.slice(0, 5), []);
}

// ---------- every page asks it the same way ----------
const main = src('../src/main.ts');
const guide = src('../src/playguide.ts');
const hud = src('../src/matchhud.ts');
const pad = src('../pad/pad.ts');
const guided = src('../pad/guided.ts');
const panel = src('../src/panel.ts');
check('tabletop: the door every Action walks through refuses it in the greyed row\'s words',
  /const idle = actionIdleWhy\(data, t, action, idleWorld\(\)\);\s*if \(idle\) \{\s*say\('refused', idle\);\s*return done\(false\);\s*\}/.test(main), true);
check('tabletop guide: an idle row is greyed on every table, not only a strict one',
  [/idle: actionIdleWhy\(this\.data, t, ga\.action, idleWorld\) \?\? undefined,/.test(guide),
    /\$\{why && \(r\.idle \|\| strict\) \? greyed\(why\) :/.test(guide),
    /\$\{r\.idle \|\| \(r\.blocked && strictNow\(s\)\) \? greyed\(\(r\.idle \?\? r\.blocked\)!\) :/.test(guide)],
  [true, true, true]);
check('tabletop Details tab: a support button with nothing in reach is greyed',
  [/const supWhy = this\.cb\.blockedWhy\?\.\(t, 'support', a\.id\) \?\? null;/.test(panel),
    /if \(what === 'support'\) \{\s*const action = findAction\(t, actionId\);\s*return action \? actionIdleWhy\(data, t, action, idleWorld\(\)\) : null;/.test(main)],
  [true, true]);
check('Match Centre: the idle reason joins the row\'s verdict, after the Part\'s own',
  /: partWhy \? \{ ok: false, why: partWhy \} : idle \? \{ ok: false, why: idle \} :/.test(turnSrc), true);
check('pad: Freeform greys the chips; Guided keeps Perform a greyed button, not a printed sentence',
  [(pad.match(/const idle = mine && (?:g\.)?available \? actionIdleWhy\(d, t, (?:g\.action|a), idleWorld\) : null;/g) ?? []).length,
    pad.includes('Every Part is Charged'), /pad-perform-no/.test(guided),
    /data-id="\$\{api\.esc\(a\.id\)\}"\$\{v\.ok \? '' : ` aria-disabled="true" data-why="\$\{api\.esc\(v\.why \?\? 'Not now'\)\}"`\}>Perform/.test(guided)],
  [2, false, false, true]);
check('pad: Guided\'s chips say why on a long press, not in a title a phone never shows',
  [(guided.match(/disabled title=/g) ?? []).length, /function refused\(api: GuideApi, why: string\): string \{\s*return ` aria-disabled="true" data-why="\$\{api\.esc\(why\)\}"`;/.test(guided)],
  [0, true]);
check('pad: a Tactics Card with nobody to play it on, a Black Box nobody could carry, and a game with no squads are greyed',
  [/if \(spec && !tacticTargets\(spec, table, side, tacticCtx\(\)\)\.length\) return `\$\{spec\.name\}: \$\{spec\.none\}`;/.test(pad),
    /data-act="box-take" data-item="\$\{esc\(i\.id\)\}"\$\{greyWhy\(!boxTakers\(\)\.length, NO_BOX_TAKER\)\}/.test(pad),
    /greyWhy\(!table\.tokens\.length, 'Add the squads first\.'\)/.test(pad)],
  [true, true, true]);
check('pad: a shut-down Mech\'s Reboot buttons stay, greyed with when it comes, instead of a paragraph',
  [/data-act="reboot" data-stance="\$\{x\}"\$\{wait \? greyWhy\(true, wait\) : ''\}/.test(pad), /<p class="pad-note">\$\{esc\(rebootWhy\(/.test(pad)],
  [true, false]);
check('pad: its own doors refuse in the shared words (Overwatch, every-enemy Electronic, Discard)',
  (pad.match(/actionIdleWhy\(data!?, (?:t|attacker), (?:a|discard), idleWorldFor\(data!?, table\)\)/g) ?? []).length, 3);
check('one board view for all of them (glue.ts idleWorldFor)',
  [/idleWorldFor\(data, state, currentTerrain\(\)\)/.test(main), /idleWorldFor\(data, state, terrain\)/.test(turnSrc),
    /idleWorldFor\(d, table\)/.test(pad), /idleWorldFor\(api\.data, s\)/.test(guided)],
  [true, true, true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

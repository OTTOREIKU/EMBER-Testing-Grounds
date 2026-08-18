import { DEFAULT_BOARD } from './boards';
import type { GameData } from './data';
import { cardName, isAerial, isBarricade, isFlyingBase, isMine, isUnfolded, unfoldsInto, unitSize } from './data';
import type { ExtraTick, Card, CardAction, GameState, MechLoadout, PartSlot, Side, SmokeScreen, Stance, TerrainPiece, Timing, Token } from './types';
import { LEGACY_SIDE, normaliseScript, statusCount, TIMINGS } from './types';
import { normaliseSetup } from './setup';
import { isMeleeFiring, lockersOf } from './melee';
import { inContact, largeGridOf, losBetween, rangeBetween, smokeBlocks } from './rules';
import { normaliseTasks } from './tasks';
// ticks.ts imports only from types.ts, so this direction carries no cycle.
import { timingOf } from './ticks';

export const PART_SLOTS: PartSlot[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];
export const SLOT_LABEL: Record<PartSlot | 'pilot' | 'main', string> = {
  torso: 'Torso',
  chasis: 'Chassis',
  leftHand: 'L.Arm',
  rightHand: 'R.Arm',
  backpack: 'Pack',
  pilot: 'Pilot',
  main: 'Hull',
};

let uidSource = { next: (s: GameState) => s.nextUid++ };

function initAmmo(cards: Card[]): Record<string, number> {
  const ammo: Record<string, number> = {};
  for (const c of cards) {
    for (const a of c.actions ?? []) {
      if (a.storage && a.storage > 0) ammo[a.id] = a.storage;
    }
  }
  return ammo;
}

// Gives a token the Ammo and Interception Tokens its current Parts print,
// without touching a count it already carries. Needed after a Part is swapped
// in, since nothing else re-seeds until the next load.
export function syncMagazines(data: GameData, t: Token): void {
  const cards = tokenCards(data, t).map(({ card }) => card);
  t.ammo = { ...initAmmo(cards), ...(t.ammo ?? {}) };
  t.intercept = { ...initIntercept(cards), ...(t.intercept ?? {}) };
}

export function volleyOf(a: CardAction): number {
  const hay = [
    a.description?.zh ?? '',
    a.description?.en ?? '',
    ...(a.keywords ?? []).map((k) => k.inline ?? k.key ?? ''),
  ].join(' ');
  const m = /(?:齐射|斉射|Vol+(?:ey|y))\s*(\d+)/i.exec(hay);
  return m ? Math.max(1, Number(m[1])) : 1;
}

export interface Knockback {
  grids: number;
  push: boolean;
  onHit: boolean;
}

export function knockbackOf(a: CardAction, english?: string): Knockback | undefined {
  const printed = (a.description?.en ?? '').trim() || (english ?? '').trim();
  const hay = printed || [a.description?.zh ?? '', ...(a.keywords ?? []).map((k) => k.inline ?? '')].join(' ');
  const onHit = /命中时|命中時|\[?on hit\]?/i.test(hay);
  const m = /(击退|擊退|推动|推動|Knock ?back|Push)\s*(\d+)/i.exec(hay);
  if (m) return { grids: Math.max(1, Number(m[2])), push: /推动|推動|Push/i.test(m[1]), onHit };
  const shove = /(?:Shove|推挤|推擠)[^.。]*?(\d+)\s*(?:Grid|格)/i.exec(hay);
  if (shove) return { grids: Math.max(1, Number(shove[1])), push: false, onHit };
  return undefined;
}

// [Stationary]: "If the Unit has not performed any Movement during its Action
// Opportunity before performing this Action, the conditional effects may be
// applied." The two machine-readable shapes in the card data are "Range +N
// grids" and "+NY" — Snipe and Extra-Tick riders stay with the card text.
export function stationaryBonus(a: CardAction): { range: number; yellow: number } | null {
  const hay = (a.description?.en ?? '') + ' ' + (a.description?.zh ?? '')
    + ' ' + (a.keywords ?? []).map((k) => k.inline ?? '').join(' ');
  if (!/Stationary|静止/i.test(hay)) return null;
  const range = /(?:Stationary|静止)[^·\n]*?Range\s*\+\s*(\d+)/i.exec(hay);
  const yellow = /(?:Stationary|静止)[^·\n]*?\+\s*(\d+)\s*Y/i.exec(hay);
  if (!range && !yellow) return null;
  return { range: range ? Number(range[1]) : 0, yellow: yellow ? Number(yellow[1]) : 0 };
}

// The Action, with its Stationary bonus applied when the condition holds. The
// caller hands over the attacker's CURRENT Opportunity (or null): no Movement
// yet this Opportunity is the whole condition — it is not "stood still since
// last round", which is how it reads at the table.
export function stationaryAdjusted(
  a: CardAction,
  opp: { maneuvered?: boolean; moved?: boolean } | null | undefined,
): CardAction {
  const bonus = stationaryBonus(a);
  if (!bonus || !opp || opp.maneuvered || opp.moved) return a;
  return {
    ...a,
    range: bonus.range ? (a.range ?? 0) + bonus.range : a.range,
    yellowDice: bonus.yellow ? (a.yellowDice ?? 0) + bonus.yellow : a.yellowDice,
  };
}

// Pulse Weapon: "May exchange {Lightning} for {Heavy Hit}." Ion Weapon is the
// same trade behind a condition — the target must already bear a Fragile
// Token. Nothing else in an ordinary Attack Roll spends a Lightning (no action
// prints these alongside Concussion or Wrecking), so the "may" is never a real
// choice and the exchange is applied for the player.
export function lightningExchangeOf(a: CardAction): 'pulse' | 'ion' | null {
  const hay = (a.description?.en ?? '') + ' ' + (a.description?.zh ?? '')
    + ' ' + (a.keywords ?? []).map((k) => k.inline ?? '').join(' ');
  if (/频闪武器|Pulse\s*Weapon/i.test(hay)) return 'pulse';
  if (/离子武器|\bIon\s*Weapon/i.test(hay)) return 'ion';
  return null;
}

// Concussion and Wrecking SPEND the Attack Roll's Lightning instead of
// trading it: each icon strips 1 Link from the target Mech, and Wrecking's
// also count as damage. No printed action carries one of these alongside
// Pulse or Ion, so the drain and the exchange never fight over an icon.
export function lightningLinkDrain(a: CardAction): 'concussion' | 'wrecking' | null {
  const hay = (a.description?.en ?? '') + ' ' + (a.description?.zh ?? '')
    + ' ' + (a.keywords ?? []).map((k) => k.inline ?? '').join(' ');
  if (/粉碎|\bWrecking\b/i.test(hay)) return 'wrecking';
  if (/震撼|\bConcussion\b/i.test(hay)) return 'concussion';
  return null;
}

export interface Resupply {
  actionId: string;
  amount: number;
  range: number;
  allies: boolean;
}

export function resupplyOf(a: CardAction): Resupply | undefined {
  for (const g of a.gameRules ?? []) {
    for (const e of g.effects ?? []) {
      const eff = e as { type?: string; actionId?: string; amount?: number; range?: number; targetSide?: string };
      if (eff.type !== 'resupply_action_ammo' || !eff.actionId) continue;
      return {
        actionId: eff.actionId,
        amount: Math.max(1, eff.amount ?? 1),
        range: eff.range ?? 0,
        allies: eff.targetSide !== 'self',
      };
    }
  }
  return undefined;
}

export interface ExtraActivation {
  range: number;
  minimumLink: number;
  excludeSelf: boolean;
  linkCost: number;
  suppressGrants: boolean;
}

// The printed English reads "Select 1 Ally Mech except this mech ... This mech
// immediately loses 1 Link and gets 1 Extra Action Opportunity", where the
// second "this mech" is the selected ally rather than the one acting. The
// Chinese 它 and the Japanese この機甲 both point at the selection, and the rule
// is named for a chosen allied mech, so the target pays and the target acts.
export function extraActivationOf(a: CardAction): ExtraActivation | undefined {
  for (const g of a.gameRules ?? []) {
    for (const e of g.effects ?? []) {
      const eff = e as {
        target?: { excludeSelf?: boolean; minimumLink?: number };
        effects?: { type?: string; delta?: number; suppressExtraActivationActions?: boolean }[];
      };
      const inner = eff.effects ?? [];
      const grant = inner.find((x) => x.type === 'grant_extra_activation');
      if (!grant) continue;
      const link = inner.find((x) => x.type === 'modify_link');
      return {
        range: a.range ?? 0,
        // The card refuses a target that cannot afford the Link without
        // Shutting Down, so the minimum is a real restriction on the pick.
        minimumLink: eff.target?.minimumLink ?? 1,
        excludeSelf: eff.target?.excludeSelf !== false,
        linkCost: Math.abs(link?.delta ?? 1),
        suppressGrants: grant.suppressExtraActivationActions === true,
      };
    }
  }
  return undefined;
}

export function freehandSlots(data: GameData, t: Token, taken: string[] = [], loans: LoanedPart[] = []): { slot: PartSlot | 'pilot' | 'main'; label: string }[] {
  const out: { slot: PartSlot | 'pilot' | 'main'; label: string }[] = [];
  const hasFreehand = (card: Card): boolean =>
    (card.keywords ?? []).some((k) => k.en === 'Freehand' || k.key === '空手');
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    if (taken.includes(slot)) continue;
    if (!hasFreehand(card)) continue;
    out.push({ slot, label: SLOT_LABEL[slot] });
  }
  // A Load carries its Freehand to the Mech holding it (FAQ O16).
  for (const { slot, card, from } of loans) {
    if (taken.includes(slot) || !hasFreehand(card)) continue;
    out.push({ slot: slot as PartSlot, label: `${cardName(card)} (${from.label})` });
  }
  return out;
}

// ---------- Commands (rulebook 3.2.1) ----------

// A Mech generates 1 Command by default. 3.2.1 tells players to check their
// units for "special cases that generate a different amount", and six Torso
// cards are exactly that: Command Generation X, worth 2 or 4 rather than 1.
// It REPLACES the default rather than adding to it - a different amount, not
// an extra one.
//
// The digit is not on the keyword. Every card spells the keyword "指令生成X"
// with a literal X and prints the real number on a Passive Action instead
// ("· 指令生成4"), so the Action's own description is the only place it can be
// read from. Five of the six are GoF, which is why that faction feels like it
// runs on Drones; the sixth is the TM31Q Wild Cat in the Raid starter.
const COMMAND_GEN_ZH = /指令生成\s*(\d+)/;
const COMMAND_GEN_EN = /Command\s+Generation\s*(\d+)/i;
export function commandGeneration(data: GameData, t: Token): number {
  if (t.kind !== 'mech') return 0;
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      const m = COMMAND_GEN_ZH.exec(a.description?.zh ?? '') ?? COMMAND_GEN_EN.exec(a.description?.en ?? '');
      if (m) return Number(m[1]);
    }
  }
  return 1;
}

// Command Coordination X (4.15.3) lets a Mech issue Commands to Drones OUTSIDE
// the Command Phase, straight after the Action carrying it resolves - up to X
// of them, to X DIFFERENT Drones, one each, face-down. It spends the tokens the
// Mech held back, which is the whole reason 4.15.2 lets you reserve them.
//
// Same shape as Command Generation: the keyword is written with a literal X and
// the real number is printed in the Action's own text, so the digit is read
// from the description.
const COMMAND_CO_ZH = /指令协调\s*(\d+)/;
const COMMAND_CO_EN = /(?:Command|Coordinate)\s+Co(?:ordination|mmand)\s*(\d+)/i;
// 获得 / "gain" means the Action HANDS the keyword to other Actions rather than
// carrying it: the Warrior Torso's Melee Synergy (172_B) is a Passive reading
// "this Mech's Melee Actions gain Command Coordination 1". Reading that as a
// Passive with Coordination 1 would let the Torso issue a Command for free,
// every round, off an Action nobody performs.
const COMMAND_CO_GRANT = /获得[^。]{0,6}指令协调|gain[s]?\s+Command Coordination/i;
export function grantsCommandCoordination(a: CardAction): boolean {
  return COMMAND_CO_GRANT.test(a.description?.zh ?? '') || COMMAND_CO_GRANT.test(a.description?.en ?? '');
}

// A Passive whose Coordination fires when the Mech's Action Opportunity ENDS
// rather than off any one Action: the Integrated Data Link Pod, "at the end of
// this unit's Action Opportunity, Command Coordination 1". It is the one
// carrier the performed-Action path can never reach, because a Passive is
// never performed - the backpack sat inert until this was split out.
const COMMAND_CO_ON_END = /行动机会结束时|ends? it'?s Action Opportunity|end of (?:this|its) Action Opportunity/i;
export function endsOpportunityCoordination(a: CardAction): boolean {
  return COMMAND_CO_ON_END.test(a.description?.zh ?? '') || COMMAND_CO_ON_END.test(a.description?.en ?? '');
}

export function commandCoordination(a: CardAction): number {
  // A grant describes OTHER Actions, and an end-of-Opportunity Passive fires on
  // a different trigger; neither is Coordination carried by this Action.
  if (grantsCommandCoordination(a) || endsOpportunityCoordination(a)) return 0;
  const m = COMMAND_CO_ZH.exec(a.description?.zh ?? '') ?? COMMAND_CO_EN.exec(a.description?.en ?? '');
  return m ? Number(m[1]) : 0;
}

// How much Coordination this Mech owes when its Action Opportunity ends, summed
// over its live Parts. Separate from the per-Action number because the trigger
// is the Opportunity, not the Action.
export function coordinationOnOpportunityEnd(data: GameData, t: Token): number {
  if (t.kind !== 'mech') return 0;
  let n = 0;
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      if (!endsOpportunityCoordination(a)) continue;
      const m = COMMAND_CO_ZH.exec(a.description?.zh ?? '') ?? COMMAND_CO_EN.exec(a.description?.en ?? '');
      if (m) n += Number(m[1]);
    }
  }
  return n;
}

// A Passive that hands Coordination to a WHOLE ACTION TYPE of this Mech's:
// the Warrior Torso's Melee Synergy, "this Mech's Melee Actions gain Command
// Coordination 1". The scope word sits immediately before 动作, so the type is
// read from there rather than guessed.
const COMMAND_CO_GRANT_ZH = /本机(\S{1,3})动作获得指令协调\s*(\d+)/;
const COMMAND_CO_GRANT_EN = /(\w+)\s+Actions by this Unit gain Command Coordination\s*(\d+)/i;
const TIMING_OF_ZH: Record<string, Timing> = {
  迅捷: 'swift', 近战: 'melee', 抛射: 'projectile', 射击: 'firing', 移动: 'movement', 战术: 'tactical',
};
const TIMING_OF_EN: Record<string, Timing> = {
  swift: 'swift', melee: 'melee', projectile: 'projectile', firing: 'firing', movement: 'movement', moving: 'movement', tactical: 'tactical', tactic: 'tactical',
};
export function coordinationGrant(a: CardAction): { timing: Timing; n: number } | null {
  const zh = COMMAND_CO_GRANT_ZH.exec(a.description?.zh ?? '');
  if (zh && TIMING_OF_ZH[zh[1]]) return { timing: TIMING_OF_ZH[zh[1]], n: Number(zh[2]) };
  const en = COMMAND_CO_GRANT_EN.exec(a.description?.en ?? '');
  if (en && TIMING_OF_EN[en[1].toLowerCase()]) return { timing: TIMING_OF_EN[en[1].toLowerCase()], n: Number(en[2]) };
  return null;
}

// What an Action is actually worth: its own printed Coordination plus anything
// this Mech's Passives grant to Actions of that Timing. Every offer should ask
// this rather than commandCoordination(), or a granted keyword never applies.
export function coordinationFor(data: GameData, t: Token, a: CardAction): number {
  let n = commandCoordination(a);
  if (t.kind !== 'mech') return n;
  const timing = timingOf(a);
  if (!timing) return n;
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const other of card.actions ?? []) {
      const g = coordinationGrant(other);
      if (g && g.timing === timing) n += g.n;
    }
  }
  return n;
}

// An Action or pilot trait that consumes one of the Mech's own Command Tokens
// (4.15.4). The Mech must bear a FACE-UP one, and using it flips that token
// face-down. Distinct from Coordination, which gives a token away rather than
// spending it on this Mech's own effect.
//
// Text, not an action: two of the four live on PILOT cards, which carry no
// actions at all - Chef and Aster hold theirs in `traitDescription`. So this
// takes the strings and the callers decide where they came from.
const COMMAND_SPEND_ZH = /消耗[^。]{0,10}指令标记/;
// The Chinese side allows words between the verb and the noun, and the English
// has to as well: the Harpy reads "consume 1 ADDITIONAL Command Token", so a
// tight `consume \d+ Command Token` misses that one while matching the rest.
//
// C[om]{1,3}and, not C[mo]{1,2}and: "Command" has THREE letters between the C
// and the "and", so the tighter class matched only the "Cmmand" typo printed on
// Aster's card and never the correct spelling. Every English match was coming
// from a card that happened to be misspelled; the Chinese carried the rest.
const COMMAND_SPEND_EN = /consume\s+[^.]{0,24}?C[om]{1,3}and Token/i;
export function textConsumesCommand(zh: string | undefined, en: string | undefined): boolean {
  return COMMAND_SPEND_ZH.test(zh ?? '') || COMMAND_SPEND_EN.test(en ?? '');
}
export function consumesCommand(a: CardAction): boolean {
  return textConsumesCommand(a.description?.zh, a.description?.en);
}
// Whether anything this Mech is wearing can spend a Command Token, pilot trait
// included. That is what decides whether holding one back is worth anything.
export function canSpendCommand(data: GameData, t: Token): boolean {
  if (t.kind !== 'mech') return false;
  const pilot = pilotCard(data, t);
  if (pilot && textConsumesCommand(pilot.traitDescription?.zh, pilot.traitDescription?.en)) return true;
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    if ((card.actions ?? []).some(consumesCommand)) return true;
  }
  return false;
}

// ZYBP-202 "Whistle": Aura, Range 4 — "When an Ally Drone within Range performs
// a roll, it may consume 1 Command Token from this Mech to re-roll."
//
// The token comes off the WHISTLE MECH, not the Drone doing the rolling, which
// is the only reading that fits 4.15.4's "the Mech must bear a face-up Command
// Token". So this returns the Mechs that could pay, and the caller spends one.
const WHISTLE_CARD = 'ZYBP-202';
const WHISTLE_RANGE = 4;
export function whistleFunders(data: GameData, tokens: Token[], roller: Token): Token[] {
  if (roller.kind !== 'drone' || roller.deployed === false) return [];
  return tokens.filter((m) => {
    if (m.side !== roller.side || m.kind !== 'mech' || m.deployed === false) return false;
    if (statusCount(m.statuses, 'command') <= 0) return false;
    const carries = tokenCards(data, m).some(
      ({ slot, card }) => card.id === WHISTLE_CARD && (m.partStates[slot as PartSlot | 'main'] ?? 'intact') !== 'destroyed',
    );
    return carries && rangeBetween(m, roller).range <= WHISTLE_RANGE;
  });
}

// ---------- Charge (rulebook 4.14) ----------

// Only 5 cards carry machine-readable gameRules for this, and they are a
// disjoint set from the 7 that spend a Charge Token through the KC Armor or
// Charged keywords, so the keyword text has to be read as well or a card like
// TM31KC offers no Charge control at all.
const CHARGE_KEYWORD = /充能|KC装甲|\bCharged\b|\bKC Armor\b/i;

export function consumesCharge(a: CardAction): boolean {
  if ((a.gameRules ?? []).some((g) => g.consumesCharge === true
    || (g.conditions ?? []).some((c) => c.type === 'charge_available'))) return true;
  return (a.keywords ?? []).some((k) => CHARGE_KEYWORD.test(k.inline ?? k.key ?? ''));
}

export function isChargeAction(a: CardAction): boolean {
  return a.id === 'COMMON_CHARGE'
    || (a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => (e as { type?: string }).type === 'set_unit_charge'));
}

export function isCharged(t: Token, slot: string): boolean {
  return (t.charge ?? []).includes(slot);
}

export function chargeableSlots(data: GameData, t: Token): { slot: PartSlot | 'pilot' | 'main'; label: string; charged: boolean }[] {
  const out: { slot: PartSlot | 'pilot' | 'main'; label: string; charged: boolean }[] = [];
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    if (!(card.actions ?? []).some((a) => consumesCharge(a))) continue;
    out.push({ slot, label: SLOT_LABEL[slot], charged: isCharged(t, slot) });
  }
  return out;
}

export function explosionScope(a: CardAction, english?: string): 'single' | 'all' {
  const printed = (a.description?.en ?? '').trim() || (english ?? '').trim();
  const hay = printed || a.description?.zh || '';
  // "all GROUND units" counts as all: the GM-35 Mine prints that, and FAQ M22
  // widens it past ground anyway - a Mine catches the Flying and Aerial units
  // sharing its Grid too.
  if (/all\s+(?:\w+\s+)?units|所有[^。]{0,4}单位|每个单位/i.test(hay)) return 'all';
  return 'single';
}

export function needsSightToLanding(a: CardAction): boolean {
  const hay = [
    a.description?.zh ?? '',
    a.description?.en ?? '',
    ...(a.keywords ?? []).map((k) => k.inline ?? k.key ?? ''),
  ].join(' ');
  if (/曲射|Fire in arc/i.test(hay)) return false;
  return /直射|Direct Fire/i.test(hay);
}

// ---------- Silence (rulebook 4.12, FAQ E12/E13/I2/I5/I18) ----------

// The printed keyword on cards and actions. Common Actions carry an explicit
// silence flag in their JSON instead. Exact matches only: a substring test
// on the English would catch Silencer flavour, so inline sticks to the CJK term.
const SILENCE_KEYWORD = (k: { key?: string; en?: string; inline?: string }): boolean =>
  k.key === '静默' || k.en === 'Silence' || (k.inline ?? '').includes('静默');

export function isSilentAction(a: CardAction): boolean {
  if ((a as { silence?: boolean }).silence === true) return true;
  if ((a.keywords ?? []).some(SILENCE_KEYWORD)) return true;
  // 12 actions carry the term only in their Chinese text. A false positive
  // here fails safe: the unit is left hidden rather than nagged to Reveal.
  return (a.description?.zh ?? '').includes('静默');
}

// A Maneuver is Silent only while a Part granting Silence survives — the PL29
// Stealth Chassis carries the keyword on the card itself, and FAQ I2 destroys
// the exemption with the Part: a facing change on a dead Stealth Chassis is a
// non-Silence action and Reveals.
export function maneuverIsSilent(data: GameData, t: Token): boolean {
  return tokenCards(data, t).some(({ slot, card }) =>
    (t.partStates[slot as PartSlot | 'main'] ?? 'intact') !== 'destroyed'
    && (card.keywords ?? []).some(SILENCE_KEYWORD));
}

// ---------- Who breaks Optical Camouflage by standing next to it ----------
//
// 4.12.2's third Reveal trigger: "After any Movement that ends with an Enemy
// Unit in Contact with the Base of the camouflaged Unit." Three rulings decide
// what that sentence actually covers, and none of them is guessable from it:
//
// I4: "any Movement" is an EXPANDED concept — a Movement Action or Maneuver by
// either unit, FORCED Movement of either (Crush, Drag, Knockback), and a
// Projectile's Launch/Deploy/Lay counted as movement from carrier to landing.
// So it is genuinely a question about the board, not about who did what, and
// deriving it from the board is the correct shape rather than a shortcut.
//
// I23 names the enemy that qualifies: one "neither Airborne nor under Optical
// Camouflage". That is where the two exclusions come from.
//
// I10 is the trap. A landed Beacon or Mine DOES break camouflage by Contact —
// but this app models every Deployable as Aerial so units can share its Grid
// (E10's "units may be placed above them"), so the plain Airborne test throws
// away exactly the units I10 names. The printed Deployable keyword is what
// tells a landed Beacon from a Missile in flight, and I10 excludes Missiles by
// name, so the keyword IS the ruling rather than a proxy for it.
const DEPLOYABLE_KEYWORD = '设置物';

export function isDeployable(c: Card): boolean {
  return (c.keywords ?? []).some((k) => (k.inline ?? k.key ?? '').trim() === DEPLOYABLE_KEYWORD)
    || isBarricade(c);
}

// Whether this unit standing in Contact would break an enemy's camouflage.
export function breaksCamoByContact(data: GameData, o: Token): boolean {
  if (o.deployed === false) return false;
  if (statusCount(o.statuses, 'camouflage') > 0) return false;      // I23
  if (!o.aerial) return true;
  const card = data.byId.get(o.cardId ?? '');
  return !!o.barricade || (!!card && isDeployable(card));           // I10
}

// The enemy whose Contact ends a camouflaged unit's hiding, or nothing.
// One home for both pages: this used to be written out twice and the two had
// already drifted — the Match Centre honoured I10 and freeplay did not.
export function camoBrokenBy(data: GameData, tokens: Token[], t: Token): Token | undefined {
  if (statusCount(t.statuses, 'camouflage') === 0 || t.deployed === false) return undefined;
  return tokens.find((o) => o.uid !== t.uid && o.side !== t.side
    && breaksCamoByContact(data, o) && inContact(t, o));
}

export function canActivateCamo(data: GameData, t: Token): boolean {
  for (const { card } of tokenCards(data, t)) {
    for (const a of card.actions ?? []) {
      const text = `${a.description?.zh ?? ''} ${a.description?.en ?? ''}`;
      if (/开启光学迷彩|Activate Optical Camouflage/i.test(text)) return true;
    }
  }
  return false;
}

export function interceptCapacity(a: CardAction): number | undefined {
  for (const k of a.keywords ?? []) {
    const m = /^拦截\s*(\d+)$/.exec((k.inline ?? '').trim());
    if (m) return Number(m[1]);
  }
  for (const text of [a.description?.en, a.description?.zh, a.description?.jp]) {
    const m = /(?:Intercept|拦截|迎撃)\s*(\d+)/.exec(text ?? '');
    if (m) return Number(m[1]);
  }
  return undefined;
}

// ---------- Multi-Target (keyword 多目标X, FAQ B7) ----------

export interface MultiTarget {
  limit: number;
  // Two of the four printed cards only GAIN Multi-Target under a condition the
  // app does not track ([Two-Handed] needs a designated Freehand, [Charged]
  // needs a Charge Token and is one arm of an either/or). Named rather than
  // silently applied or silently dropped, so the player can answer it.
  condition: string | null;
}

const MULTI_CONDITION: Record<string, string> = {
  freehand_designated: 'Two-Handed — a Freehand must be designated to support this Part',
  charge_available: 'Charged — it costs the Charge Token, and Suppression is the other choice',
};

// The inline keyword is the literal string 多目标X — an X, never a number — so
// the count has to come from the structured rule or the printed line. The
// bundle's gameRules carry it exactly for all four cards that have it; the
// prose fallback is there for a card added later without them.
export function multiTargetLimit(a: CardAction): MultiTarget | undefined {
  for (const g of a.gameRules ?? []) {
    for (const e of g.effects ?? []) {
      const eff = e as { type?: string; limit?: number };
      if (eff.type !== 'set_multi_target_limit' || !eff.limit) continue;
      const cond = (g.conditions ?? []).map((x) => x.type ?? '').find((x) => MULTI_CONDITION[x]);
      return { limit: eff.limit, condition: cond ? MULTI_CONDITION[cond] : null };
    }
  }
  for (const text of [a.description?.en, a.description?.zh, a.description?.jp]) {
    const m = /(?:Multi-?Target|多目标|マルチターゲット)\s*(\d+)/i.exec(text ?? '');
    if (!m) continue;
    const line = (text ?? '').split(/\r?\n/).find((l) => l.includes(m[0])) ?? '';
    const cond = /\[Two-Handed\]|【?双手】?/i.test(line)
      ? MULTI_CONDITION.freehand_designated
      : /\[Charged\]|【?充能】?/i.test(line)
        ? MULTI_CONDITION.charge_available
        : null;
    return { limit: Number(m[1]), condition: cond };
  }
  return undefined;
}

// ---------- What a unit does BECAUSE it was attacked (FAQ B7/D10) ----------

export interface AttackReaction {
  actionId: string;
  name: string;
  // Exactly one of these. Emergency Smoke places Screens; Target Tracing opens
  // an Electronic Counter-roll back at the attacker.
  smoke?: { count: number; range: number };
  trace?: boolean;
  stance?: boolean;
  riposte?: boolean;
  // The card says it works even once the unit is gone. FAQ D10 asks exactly
  // that about the Reaper and answers yes, so a destroyed Part is no bar.
  afterDestroyed: boolean;
}

// ---------- White Dwarf Thruster (292 ACE-001 Bit Port) ----------
//
// "While this part's Bit action has an Ammo Token, {lightning} on blue dice
// counts as {Dodge}." The structured rule agrees and adds the scope the English
// leaves implicit:
//
//   conditions: source_is_target, action_storage_available(backpack, 292_A)
//   effects:    transform_dice_face lightning -> evade, on: defender
//
// `source_is_target` is what makes it a DEFENCE-side transform: it applies when
// the Mech wearing the Part is the one being shot at, never when it is shooting.
// The Ammo is not spent by this -- it is a condition, not a cost, so the Bit
// stays launchable.
//
// BLUE dice only, which is the whole difficulty: countIcons aggregates every
// colour together, so the caller has to count these itself.
export function blueLightningDodges(data: GameData, t: Token): boolean {
  if (t.kind !== 'mech') return false;
  for (const { slot, card } of tokenCards(data, t)) {
    if (slot === 'pilot') continue;
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      for (const g of a.gameRules ?? []) {
        const eff = (g.effects ?? []).find((e) => {
          const x = e as { type?: string; from?: string; to?: string };
          return x.type === 'transform_dice_face' && x.from === 'lightning' && x.to === 'evade';
        });
        if (!eff) continue;
        // The Ammo condition names the Action that must still be loaded, which
        // is a DIFFERENT action on the same card (the Bit, not this Passive).
        const ammoCond = (g.conditions ?? []).find((x) => (x as { type?: string }).type === 'action_storage_available') as
          { actionId?: string } | undefined;
        const needs = ammoCond?.actionId;
        if (needs && (t.ammo?.[needs] ?? 0) <= 0) continue;
        return true;
      }
    }
  }
  return false;
}

// ---------- The Freehand Supports (ZHLA-303 +1R, 040 +1Y) ----------
//
// "If this part is Designated as Freehand by a [Two-Handed] action, the action
// +1R" (ZHLA-303) / "+1Y" (040). Both have gameRules -- `modify_dice` under a
// `part_is_freehand_designated` condition -- and both are BLOCKED on the same
// thing: the Two-Handed Freehand designation is deliberately not tracked. See
// MULTI_CONDITION above, which names that condition to the player rather than
// applying or dropping it silently, for exactly the same reason.
//
// So these follow that decision rather than inventing a second answer: the
// bonus is NAMED on the attack, and the player nudges the pool spinner if the
// Part really was the designated Freehand. Wiring it silently would be wrong
// far more often than right, since most Actions are not Two-Handed.
//
// If the Two-Handed designation is ever built, this is the reader to replace,
// and MULTI_CONDITION is the other caller that becomes derivable.
export function freehandSupportNote(data: GameData, t: Token, a: CardAction): string {
  if (t.kind !== 'mech') return '';
  const out: string[] = [];
  for (const { slot, card } of tokenCards(data, t)) {
    if (slot === 'pilot') continue;
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const act of card.actions ?? []) {
      const hay = `${act.description?.en ?? ''} ${act.description?.zh ?? ''}`;
      if (!/Designated as Freehand|作为空手被/i.test(hay)) continue;
      // The card says which colour, and the two differ.
      const red = /\+\s*\{?1R\}?|\+1R/i.test(hay);
      // ZHLA-303 says Melee; 040 says any Two-Handed action.
      const meleeOnly = /Melee\s*Action|近战动作/i.test(hay);
      if (meleeOnly && a.type !== 'Melee') continue;
      out.push(`${SLOT_LABEL[slot]} adds +1${red ? 'R' : 'Y'} if it is the designated Freehand for this [Two-Handed] Action`);
    }
  }
  return out.join('; ');
}

// ---------- The Coolers (002, 532, 083) ----------
//
// Three Parts that add Attack dice to a Firing Action, none of which carries
// any gameRules, so all three are read off the printed text:
//
//   002 Power Cooling  - Offensive Stance, Firing Action: for every {3Y}, +{1Y}
//   532 System Cooling - Offensive Stance, Firing Action: for every {3R}, +{1R}
//   083 Cooling        - a Firing Action with the Laser Weapon keyword: +{1Y}
//
// The first two are computed off the BASE pool, not off a running total: "for
// every 3" is read once against the Action's printed dice, so two Coolers
// cannot feed each other. Summed across Parts rather than taken as the
// strongest, because none of them prints the "does not stack" line the auras do.
export function coolingBonus(
  data: GameData,
  t: Token,
  a: CardAction,
  base: { red: number; yellow: number },
): { red: number; yellow: number } {
  const out = { red: 0, yellow: 0 };
  if (t.kind !== 'mech' || a.type !== 'Firing') return out;
  // The Laser Weapon keyword is printed in Chinese only, on all 20 of the
  // Actions that carry it.
  const laser = (a.keywords ?? []).some((k) => /激光武器|Laser\s*Weapon/i.test(k.inline ?? k.key ?? ''));
  for (const { slot, card } of tokenCards(data, t)) {
    if (slot === 'pilot') continue;
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const act of card.actions ?? []) {
      const en = act.description?.en ?? '';
      const zh = act.description?.zh ?? '';
      const hay = `${en} ${zh}`;
      if (/every\s*\{?3Y\}?\s*,?\s*\+\s*\{?1Y\}?|每\{?3Y\}?，\+\{?1Y\}?/i.test(hay)) {
        if (t.stance === 'offensive') out.yellow += Math.floor(base.yellow / 3);
      }
      if (/every\s*\{?3R\}?\s*,?\s*\+\s*\{?1R\}?|每\{?3R\}?，\+\{?1R\}?/i.test(hay)) {
        if (t.stance === 'offensive') out.red += Math.floor(base.red / 3);
      }
      if (laser && /Laser\s*Weapon,?\s*\+\s*\{?1Y\}?|激光武器关键字的射击动作时，\+\{?1Y\}?/i.test(hay)) {
        out.yellow += 1;
      }
    }
  }
  return out;
}

// ---------- Riposte / Reposte (050 FCC-12 Grappler, ZHLA-202 M4 Combat Claw) ----------
//
// "On a Successful Parry with this part, the Attacker must immediately end the
// current Action Opportunity, and then the Defender may immediately perform a
// Melee Action." The two cards spell it differently -- 050 says Riposte and
// ZHLA-202 says Reposte -- so the match is on the sentence, not the name.
//
// Asked about ONE slot, not about the Mech: the Parry has to have been declared
// on the Part that carries this, so a Mech holding a Riposte claw in one hand
// and parrying with the other gets nothing.
export function ripostePart(data: GameData, t: Token, slot: string): { actionId: string; name: string } | null {
  if (t.kind !== 'mech') return null;
  const held = tokenCards(data, t).find((x) => x.slot === slot);
  if (!held) return null;
  if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') return null;
  for (const a of held.card.actions ?? []) {
    const en = a.description?.en ?? '';
    const zh = a.description?.zh ?? '';
    if (/Successful Parry with this part/i.test(en) || /以本部件招架成功时/.test(zh)) {
      return { actionId: a.id, name: a.name?.en || a.name?.zh || a.id };
    }
  }
  return null;
}

// ---------- Defense Reaction (ZHLA-101 SS12 Buckler, ZHLA-301 SS30 Heavy Shield) ----------
//
// "If Penetration occurs against any Part of this Mech, it may immediately
// change to Defensive Stance." ANY Part, not the Part carrying the shield, and
// it does not ask for a Command Token -- the only price is that the Stance
// changes outside the moment 4.1 normally allows.
export function defenseReactionOn(data: GameData, t: Token): { actionId: string; name: string } | null {
  if (t.kind !== 'mech') return null;
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      const en = a.description?.en ?? '';
      const zh = a.description?.zh ?? '';
      if (/Penetration occurs against any Part/i.test(en) || /任何部件被击穿时[^。]*防御姿态/.test(zh)) {
        return { actionId: a.id, name: a.name?.en || a.name?.zh || a.id };
      }
    }
  }
  return null;
}

// ---------- Target Tracing (174 P22 "Hunter") ----------
//
// "When this mech is attacked by an Enemy Mech's Melee/Firing Action, it may
// spend 1 Command Token to perform an Electronic Counter Roll against the
// Attacker. If successful, the Attacker loses 1 Link."
//
// NOT the Target Tracer token. The status is 标靶追踪 and this is 标靶追溯 --
// same English root, unrelated rules, and grepping the English finds the wrong
// one. The card carries no gameRules, so both the trigger and the Link loss are
// authored from the printed text.
export function targetTracingOn(data: GameData, t: Token): { actionId: string; name: string } | null {
  if (t.kind !== 'mech') return null;
  if (!(t.statuses ?? []).includes('command')) return null;
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      const en = a.description?.en ?? '';
      const zh = a.description?.zh ?? '';
      if (/Electronic Counter Roll against the Attacker/i.test(en) || /被敌方机甲近战\/射击后[^。]*电子对抗投骰/.test(zh)) {
        return { actionId: a.id, name: a.name?.en || a.name?.zh || a.id };
      }
    }
  }
  return null;
}


// Reactions the DEFENDER may take after being shot at. Read off the board so a
// Part destroyed by the very attack that triggered it is handled by the card's
// own flag rather than by when the sweep happens to run.
export function attackReactionsOf(data: GameData, t: Token): AttackReaction[] {
  const out: AttackReaction[] = [];
  for (const { slot, card } of tokenCards(data, t)) {
    for (const a of card.actions ?? []) {
      for (const g of a.gameRules ?? []) {
        for (const e of g.effects ?? []) {
          const eff = e as { type?: string; count?: number; range?: number; usableAfterDestroyed?: boolean };
          if (eff.type !== 'post_firing_smoke_reaction') continue;
          const dead = (t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed';
          if (dead && eff.usableAfterDestroyed !== true) continue;
          // The card prints storage 1, so syncMagazines already tracks its
          // uses as Ammo — a spent Emergency Smoke must stop being offered.
          if (t.ammo?.[a.id] === 0) continue;
          out.push({
            actionId: a.id,
            name: a.name?.en || a.name?.zh || a.id,
            smoke: { count: Math.max(1, eff.count ?? 1), range: eff.range ?? 0 },
            afterDestroyed: eff.usableAfterDestroyed === true,
          });
        }
      }
    }
  }
  return out;
}

// ---------- Designate X (FAQ A25/D11) ----------

export interface Designation {
  name: string;
  color: string;
  count: number;
}

// "After any announcement of the number of dice, set the result of X dice."
// FAQ A25 pins the moment for the Volcano's Armor Countermeasures — after the
// defending dice are gathered, before they are rolled — and the bundle already
// encodes it as `timing: before_initial_roll`. The card says ANY dice roll for
// this mech, so it is read off whichever unit is about to roll rather than off
// the defender alone.
export function designationsOn(data: GameData, t: Token): Designation[] {
  const out: Designation[] = [];
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      for (const g of a.gameRules ?? []) {
        for (const e of g.effects ?? []) {
          const eff = e as { type?: string; color?: string; count?: number };
          if (eff.type !== 'designate_dice_result') continue;
          out.push({
            name: a.name?.en || a.name?.zh || a.id,
            color: eff.color ?? 'white',
            count: Math.max(1, eff.count ?? 1),
          });
        }
      }
    }
  }
  return out;
}

// Every card id currently on the board, so the Add tab can subtract what is
// already in play from what the inventory says you own.
export function deployedCardCounts(tokens: Token[]): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (id?: string) => {
    if (!id) return;
    out.set(id, (out.get(id) ?? 0) + 1);
  };
  for (const t of tokens) {
    if (t.kind === 'mech') {
      for (const slot of PART_SLOTS) bump(t.mech?.[slot]);
      bump(t.mech?.pilot);
      continue;
    }
    bump(t.cardId);
    bump(t.droneBackpack);
  }
  return out;
}

export interface SmokePlacement {
  count: number;
  connected: boolean;
}

export function smokePlacement(a: CardAction): SmokePlacement | undefined {
  const texts = [a.description?.en, a.description?.zh, a.description?.jp, ...(a.keywords ?? []).map((k) => k.inline ?? k.en ?? k.key ?? '')];
  const blob = texts.filter(Boolean).join(' ');
  if (!/Smoke Screen|烟幕|煙幕/i.test(blob)) return undefined;
  const en = /place (?:up to )?(\d+) Smoke Screens?/i.exec(blob);
  const zh = /放置\s*(\d+)\s*(?:个)?(?:烟幕|煙幕)/.exec(blob);
  const count = Number(en?.[1] ?? zh?.[1] ?? 0);
  if (!count) return undefined;
  return { count, connected: /Connected|相连|連結/i.test(blob) };
}

function initIntercept(cards: Card[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) {
    for (const a of c.actions ?? []) {
      const n = interceptCapacity(a);
      if (n !== undefined) out[a.id] = n;
    }
  }
  return out;
}

// The furthest an Intercept Action on this unit reaches, so a launch can say
// whose Interception it woke up.
// The Extra Ticks a unit's cards grant, read off the curated extraTicks list.
// The single home: the guide, the Match Centre glue and the grantExtra command
// all build Opportunities from it, so the three can never drift.
export function extrasFor(data: GameData, t: Token): ExtraTick[] {
  const have = new Set(tokenCards(data, t).flatMap(({ card }) => (card.actions ?? []).map((a) => a.id)));
  return data.extraTicks
    .filter((g) => have.has(g.actionId))
    .map((g) => ({ id: g.actionId, label: g.label, timing: g.timing as Timing, check: g.check }));
}

// ---------- Auras (FAQ Q1-Q4, J2) ----------
//
// The card data records auras as structured effects on (usually Passive)
// actions: { type: 'aura', effectTypes: [...], targetSide: 'ally' | 'enemy' }
// with the action's own range. An aura is judged at the moment the affected
// action or roll happens (Q1/Q2), a unit is its own ally (Q4), and what it
// grants is a KEYWORD, not a Token - Scan cannot remove it (Q3). Deployables
// and Aerial units are affected like anything else (J2).
export interface AuraSource {
  kinds: string[];
  // Some effects carry a magnitude (+2 Range, +1 White, Strength -1); the rest
  // simply grant a keyword and leave this 0.
  value: number;
  // 558 Firing Coordination grants ONLY to Firing Actions, where 014 and 077
  // grant to all of them. Nothing in the effect JSON records that, so it is
  // read off the printed text the same way repairSpec and isMeleeFiring do.
  firingOnly: boolean;
  label: string;
}

// Every aura currently reaching this unit, after the three filters the data
// carries: which side it helps, how far it reaches, and WHAT it may land on —
// `targetUnitType` is 'mech', 'drone' or 'unit', so a Drone standing beside a
// Mech-only aura is untouched by it.
export function aurasOn(data: GameData, tokens: Token[], t: Token): AuraSource[] {
  const out: AuraSource[] = [];
  for (const src of tokens) {
    if (src.deployed === false) continue;
    if ((src.partStates[src.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed') continue;
    for (const { slot, card } of tokenCards(data, src)) {
      if ((src.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
      for (const a of card.actions ?? []) {
        for (const g of a.gameRules ?? []) {
          for (const e of g.effects ?? []) {
            const eff = e as {
              type?: string; effectTypes?: string[]; targetSide?: string;
              targetUnitType?: string; value?: number; label?: string;
            };
            if (eff.type !== 'aura' || !eff.effectTypes?.length) continue;
            const allies = eff.targetSide !== 'enemy';
            if (allies !== (src.side === t.side)) continue;
            const want = eff.targetUnitType;
            if (want && want !== 'unit' && want !== t.kind) continue;
            if (rangeBetween(src, t).range > (a.range ?? 0)) continue;
            out.push({
              kinds: [...eff.effectTypes],
              value: eff.value ?? 0,
              firingOnly: /Firing Actions?\b/i.test(a.description?.en ?? ''),
              label: a.name?.en || a.name?.zh || eff.label || a.id,
            });
          }
        }
      }
    }
  }
  return out;
}

// An aura is judged at the moment the affected action or roll happens (Q1/Q2),
// a unit is its own ally (Q4), and what it grants is a KEYWORD, not a Token -
// Scan cannot remove it (Q3). Deployables and Aerial units are affected like
// anything else (J2).
export function auraEffectsOn(data: GameData, tokens: Token[], t: Token): Set<string> {
  const out = new Set<string>();
  for (const src of aurasOn(data, tokens, t)) for (const k of src.kinds) out.add(k);
  return out;
}

// EVERY one of these auras prints "This effect does not stack", so two sources
// of the same effect are not added together — the strongest single one applies.
export function auraValueOn(data: GameData, tokens: Token[], t: Token, kind: string): number {
  let best = 0;
  for (const src of aurasOn(data, tokens, t)) {
    if (!src.kinds.includes(kind)) continue;
    if (Math.abs(src.value) > Math.abs(best)) best = src.value;
  }
  return best;
}

// Flexible Timing arrives ONLY from an ally's aura — no card prints it for its
// own Actions (checked across the whole card database: the three cards whose
// text names the keyword are the three aura sources themselves). A unit is its
// own ally (FAQ Q4), so a Mech carrying Tactical Coordination flexes its own
// Starting Action as well as its neighbours'.
// Melee Evasion (ZYBP-302): "On Parry, this mech may spend 1 Command Token to
// gain 1 additional {Dodge}." Braced {Dodge} is a dice FACE, so this adds an
// ICON to the defence result rather than a die to the pool — the same kind of
// adjustment KC Armor and Low Profile already make in AttackHelper.resolve().
//
// Read off the Mech's own Parts, and it needs a face-up Command Token to spend.
export function meleeEvasionReady(data: GameData, t: Token): boolean {
  if (t.kind !== 'mech') return false;
  if (!(t.statuses ?? []).includes('command')) return false;
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      const en = a.description?.en ?? '';
      const zh = a.description?.zh ?? '';
      if (/On Parry[^.]*additional\s*\{?Dodge/i.test(en) || /招架[^。]*闪避/.test(zh)) return true;
    }
  }
  return false;
}

// 闪避强化 Dodge Enhancement (ZYBP-302): "When this Mech is hit, may
// spent 1 Command Token, make each {Dodge} offset 1 Attack die." Unlike its
// card-mate Melee Evasion this carries no Parry condition — any hit will do —
// so the only gates are the face-up Command Token and a live Part.
//
// The zh line drops the trigger entirely ({闪避}可抵消1枚攻击骰), so it is
// matched on the effect, not on a condition it does not print.
export function dodgeEnhanceReady(data: GameData, t: Token): boolean {
  if (t.kind !== 'mech') return false;
  if (!(t.statuses ?? []).includes('command')) return false;
  for (const { slot, card } of tokenCards(data, t)) {
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      const en = a.description?.en ?? '';
      const zh = a.description?.zh ?? '';
      if (/\{?Dodge\}?\s*offset[s]?\s*1\s*Attack\s*die/i.test(en) || /闪避\}?可抵消1枚攻击骰/.test(zh)) return true;
    }
  }
  return false;
}

export interface CommandRider {
  // A2 Data Link: the Commanded Drone may perform Automatic Actions, which the
  // Command Phase otherwise refuses (3.2.2 / 3.5).
  autoActions: boolean;
  // M2 Data Link: grids it may move BEFORE acting, on top of the one-or-the-
  // other activation a Drone normally gets (2.4.1).
  preMove: number;
}

// What a Mech's Data Link grants to a Drone it Commands. Both riders are worded
// "when receiving Command from THIS Mech", so they are read off the ISSUER, not
// off the Drone — which is why Token.commandedBy has to exist.
//
// Matched on the distinctive clause rather than any single word: the English on
// card 175 misspells "receiving", so anything keyed to that would silently miss.
export function commandRiderOf(data: GameData, mech: Token | undefined): CommandRider {
  const out: CommandRider = { autoActions: false, preMove: 0 };
  if (!mech || mech.kind !== 'mech') return out;
  for (const { slot, card } of tokenCards(data, mech)) {
    if ((mech.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      const en = a.description?.en ?? '';
      const zh = a.description?.zh ?? '';
      if (/Automatic Actions instead of Command Actions/i.test(en) || /执行自动动作/.test(zh)) {
        out.autoActions = true;
      }
      const gridsEn = /may move (\d+) grid/i.exec(en);
      const gridsZh = /移动(\d+)格/.exec(zh);
      const n = Number(gridsEn?.[1] ?? gridsZh?.[1] ?? 0);
      if (n > out.preMove) out.preMove = n;
    }
  }
  return out;
}

// The rider reaching a Drone right now, via the Mech that Commanded it.
export function riderOnDrone(data: GameData, tokens: Token[], t: Token): CommandRider {
  if (t.kind !== 'drone' || t.commandedBy === undefined) return { autoActions: false, preMove: 0 };
  return commandRiderOf(data, tokens.find((x) => x.uid === t.commandedBy));
}

export interface ParryPart {
  slot: PartSlot | 'main';
  value: number;
  label: string;
}

// Parry (rulebook 4.6.3). "A melee-only defence. The defender designates a Part
// with a Parry Value as the target Part and adds that many White dice to the
// Defense Roll. Not available while in Shutdown or against a Back Attack."
//
// The designation half is the same shape as Shield Up, so combat reuses that
// step; this is only the question of WHICH Parts may be offered and for how
// many dice. The caller supplies the two gates it alone can judge — whether the
// Action is Melee, and whether the attacker is in the defender's rear arc.
export function parryParts(data: GameData, t: Token, opts: { melee: boolean; backAttack: boolean }): ParryPart[] {
  if (t.kind !== 'mech') return [];
  if (!opts.melee || opts.backAttack) return [];
  if (t.stance === 'shutdown') return [];
  const out: ParryPart[] = [];
  for (const { slot, card } of tokenCards(data, t)) {
    if (slot === 'pilot') continue;
    const key = slot as PartSlot | 'main';
    if ((t.partStates[key] ?? 'intact') === 'destroyed') continue;
    // Same reasoning as selfHitParts: a Repaired Part is removed outright when
    // hit (FAQ J23), so it cannot stand as the Part that resolves the damage.
    if ((t.repairedSlots ?? []).includes(key)) continue;
    const value = card.parray ?? 0;
    if (value > 0) out.push({ slot: key, value, label: cardName(card) });
  }
  return out;
}

export interface SelfHitPart {
  slot: PartSlot | 'main';
  card: Card;
  label: string;
}

// Shield Up and Mobile Defense: "This Mech may Designate this part to resolve
// damage [in the Defensive Stance]." The Black Die still says where the hit
// LANDED; this is the defender's option to take it on the shield instead.
//
// The difference between the two is a printed condition, and it is in the data
// rather than in the name: Shield Up carries `conditions: [{type:'stance',
// stance:'defensive'}]`, Mobile Defense carries none and so is always live.
// A destroyed Part cannot be volunteered, and neither can a Repaired one — it
// is removed outright when hit (FAQ J23), which is not "resolving damage".
export function selfHitParts(data: GameData, t: Token): SelfHitPart[] {
  if (t.kind !== 'mech') return [];
  const out: SelfHitPart[] = [];
  for (const { slot, card } of tokenCards(data, t)) {
    if (slot === 'pilot') continue;
    const key = slot as PartSlot | 'main';
    if ((t.partStates[key] ?? 'intact') === 'destroyed') continue;
    if ((t.repairedSlots ?? []).includes(key)) continue;
    for (const g of card.actions?.flatMap((a) => a.gameRules ?? []) ?? []) {
      const effects = (g.effects ?? []) as { type?: string }[];
      if (!effects.some((e) => e.type === 'defender_designate_self_hit_part')) continue;
      const conds = (g.conditions ?? []) as { type?: string; stance?: string }[];
      const met = conds.every((c) => (c.type === 'stance' ? t.stance === c.stance : true));
      if (!met) continue;
      const named = card.actions?.find((a) => (a.gameRules ?? []).includes(g));
      out.push({ slot: key, card, label: named?.name?.en || named?.name?.zh || cardName(card) });
      break;
    }
  }
  return out;
}

// A Firing Action's reach, after the two range auras: RT-12T Oasis gives ally
// MECHS +1 (Firing Coordination) and the P7-A3 Node Core gives ally DRONES +2
// (Fire Control Planning). Both say "Firing Actions", so nothing else is
// lengthened, and both say "does not stack", which auraValueOn honours.
//
// Every reach in the app should come through here rather than reading
// `a.range` directly, so the picker, the overlay and the refusal all agree.
export function actionRange(data: GameData, tokens: Token[], t: Token, a: CardAction): number {
  const base = a.range ?? 0;
  if (a.type !== 'Firing') return base;
  const kind = t.kind === 'drone' ? 'drone_firing_range_bonus' : 'firing_range_bonus';
  return base + auraValueOn(data, tokens, t, kind);
}

export function hasFlexibleTiming(data: GameData, tokens: Token[], t: Token, a?: CardAction): boolean {
  return aurasOn(data, tokens, t).some((src) => {
    if (!src.kinds.includes('flexible_timing')) return false;
    // RT-12T Oasis grants it to FIRING Actions only; RT-07T Dune and the B3/3
    // Beacon grant it to all of them. Without the action to test, answer for
    // the unrestricted sources alone rather than over-granting.
    if (!src.firingOnly) return true;
    return a?.type === 'Firing';
  });
}

// An action that hands out Repaired Tokens or mends Damage, read off the
// printed text (SH-15 Damage Control: "give one destroyed Part of this mech a
// Repaired marker, or remove one Damaged marker from a Part").
export function repairSpec(a: CardAction): { repair: boolean; mend: boolean } | undefined {
  const hay = (a.description?.zh ?? '') + (a.description?.en ?? '');
  const repair = hay.includes('修补标记') || /Repaired (Token|marker)/i.test(hay);
  const mend = hay.includes('破损标记') || /remove.{0,20}Damaged/i.test(hay);
  return repair || mend ? { repair, mend } : undefined;
}

// Auto-attack target selection (3.5.2, FAQ O9/O10/O21). Among enemies in
// range: if any bears a Highlight, the NEAREST Highlighted target must be
// taken; otherwise the nearest target, with ties left to the player. Beacons
// and Mines count as enemy units and so take priority over Neutral fallbacks
// (O10); buildings are terrain and never valid. Melee cannot reach Aerial.
export function autoTargetsFor(
  data: GameData,
  tokens: Token[],
  t: Token,
  a: CardAction,
): Token[] {
  // Through actionRange, so a Firing Action lengthened by an ally's aura can
  // actually reach the target the picker offers.
  const reach = actionRange(data, tokens, t, a);
  // An Electronic Attack may be sent through an allied Repeater, and then the
  // Range - and the nearest-target rule with it - is measured from there
  // (FAQ O19/O20): the enemy one Grid from the Raven is nearer than the one two
  // Grids from the attacker, and it is the one that must be taken.
  const origins = isElectronicAttack(a) ? electronicOrigins(data, tokens, t) : [t];
  const reachOf = (o: Token): number => Math.min(...origins.map((from) => rangeBetween(from, o).range));
  const candidates = tokens.filter((o) => {
    if (o.side === t.side || o.uid === t.uid || o.deployed === false) return false;
    if ((o.partStates[o.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed') return false;
    if (a.type === 'Melee' && o.aerial) return false;
    return reachOf(o) <= reach;
  });
  if (!candidates.length) return [];
  const lit = candidates.filter((o) => statusCount(o.statuses, 'highlight') > 0);
  const pool = lit.length ? lit : candidates;
  const best = Math.min(...pool.map(reachOf));
  return pool.filter((o) => reachOf(o) === best);
}

// The Neutral fallback for an automatic attack (FAQ O9/O10).
//
// O9: when NO enemy unit is inside the range of a Drone's Auto Action, it MAY
// attack a Neutral Unit instead - and if it does, it must take the NEAREST one.
// So this is a fallback, not a widening: it returns nothing at all while any
// enemy is in reach, because enemies always outrank Neutrals.
//
// O10 draws the category lines, and both fall out of `isFragile` rather than
// needing a list: BUILDINGS ARE NEVER VALID TARGETS for a Drone attack, and
// buildings (like both Defense walls) are not fragile, so filtering on fragile
// excludes them for free. The 1-inch Containers are the only Breakable Terrain
// on the board. Beacons and Mines need no handling here either - O10 says there
// is no such thing as a neutral one, so every Beacon and Mine already belongs to
// a side and reaches `autoTargetsFor` as an ordinary enemy Unit, which is also
// what gives them priority over anything returned here.
//
// Range is MANHATTAN over large Grids, the same metric rangeBetween applies to
// units - a diagonal neighbour is 2 away, not 1.
export interface NeutralTarget {
  id: string;
  dist: number;
}

export function autoNeutralTargets(
  data: GameData,
  tokens: Token[],
  terrain: TerrainPiece[],
  t: Token,
  a: CardAction,
): NeutralTarget[] {
  // Enemies first, always. While one is in range there is no choice to offer.
  if (autoTargetsFor(data, tokens, t, a).length) return [];
  const reach = a.range ?? 0;
  const g = largeGridOf(t);
  const near = terrain
    .filter((p) => p.isFragile)
    .map((p) => ({
      id: p.id,
      dist: Math.min(...p.subCells.map((c) => Math.abs(Math.floor(c.col / 3) - g.c) + Math.abs(Math.floor(c.row / 3) - g.r))),
    }))
    .filter((x) => x.dist <= reach);
  if (!near.length) return [];
  // "The nearest" is the whole rule, so ties come back together and the player
  // picks between them - the same shape autoTargetsFor uses for tied enemies.
  const best = Math.min(...near.map((x) => x.dist));
  return near.filter((x) => x.dist === best).sort((x, y) => x.id.localeCompare(y.id));
}

// ---------- Prototype Blink (FAQ E17/E20) ----------
//
// The TM35BT "Taurus" Experimental Core swaps places with another Mech. Four
// constraints, and they come from two different sources that have to be read
// together:
//
// The PRINTED CARD: "exchanges positions with one Ground Mech Unit of the same
// SIZE within its range". The size clause is on the card and nowhere in the
// FAQ, so it would be lost by reading the ruling alone.
//
// FAQ E20: the target must be a ground MECH — "Drones, Terrain and similar
// targets cannot be chosen" — and either side may be taken, enemy or allied.
// It is TELEPORTATION Movement, not ground movement (E20.2), so nothing about
// the route matters: no path, no Break Away, no terrain in between, and no
// dice roll (E20.3). Its Timing is normally Move as a Starting Action, but
// spare Action Ticks let it go at other Timings (E20.1), which is the ordinary
// Tick economy and needs nothing special here.
//
// E17/E20.5: it counts as FORCED MOVEMENT, so the Taurus player chooses the
// Facing of BOTH units afterwards - that is the driver's question to ask, not
// this function's.
// Which Moving Actions are a position SWAP rather than a walk. Typed Moving on
// the card, so without this test Prototype Blink falls into the route-drawing
// branch and asks the player to trace a path a teleport does not have. Matched
// on the printed wording in either language, so the card decides, not an id.
export function isPositionSwap(a: CardAction): boolean {
  if (a.type !== 'Moving') return false;
  return /exchange[sd]? positions?/i.test(a.description?.en ?? '')
    || /交换位置/.test(a.description?.zh ?? '');
}

export function blinkTargets(
  data: GameData,
  tokens: Token[],
  t: Token,
  a: CardAction,
): Token[] {
  if (t.kind !== 'mech' || !alive(t) || t.deployed === false) return [];
  const reach = a.range ?? 0;
  return tokens.filter((o) => {
    if (o.uid === t.uid || o.deployed === false || !alive(o)) return false;
    if (o.kind !== 'mech') return false;              // E20.4: Mechs only
    if (o.size !== t.size) return false;              // printed card: same size
    if (!isGroundUnit(data, o)) return false;         // E20.4: ground only
    return rangeBetween(t, o).range <= reach;
  });
}

// ---------- The Hyena's AA Radar (FAQ O12/O13) ----------
//
// "When an ally Intercepts a target VISIBLE TO THIS UNIT, [Eye] counts as
// 1 Light Hit." Always on (O12), and Interception only - a normal Firing Action
// at the same target gains nothing (O13). Visibility is the Radar's own line of
// sight, not a Range, which is why the printed Range is 0.
export function aaRadarCovers(
  data: GameData,
  tokens: Token[],
  terrain: TerrainPiece[],
  shooter: Token,
  target: Token,
): Token | undefined {
  return tokens.find((r) => {
    if (r.side !== shooter.side || r.deployed === false) return false;
    if ((r.partStates[r.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed') return false;
    const card = data.byId.get(r.cardId);
    if (!card) return false;
    // Named in English, or spelled out in the Chinese: Intercept + counts-as +
    // Light Hit together. A bare "counts as" would catch half the box.
    const radar = (card.actions ?? []).some((a) => {
      const zh = a.description?.zh ?? '';
      return /AA Radar/i.test(a.name?.en ?? '')
        || (zh.includes('拦截') && zh.includes('视为') && zh.includes('轻击'));
    });
    if (!radar) return false;
    return losBetween(r, target, terrain, tokens) !== 'blocked';
  });
}

// ---------- Repeaters (FAQ O19/O20) ----------
//
// The EC Raven prints Repeater with a Range of its own: any ALLIED unit within
// that Range may send its Electronic Attack from the Raven instead of from
// itself, and the Action's own Range is then measured from the Raven. So an
// Alligator with Range 4, standing 6 Grids from the Raven, reaches anything
// within 4 of the RAVEN - not 10 of itself.

const REPEATER_KEYWORD = '中继器';

export function isRepeater(c: Card): boolean {
  return (c.keywords ?? []).some((k) => k.key === REPEATER_KEYWORD || k.en === 'Repeater' || (k.inline ?? '') === REPEATER_KEYWORD);
}

// The allied Repeaters covering this unit right now.
export function repeatersFor(data: GameData, tokens: Token[], t: Token): Token[] {
  const out: Token[] = [];
  for (const r of tokens) {
    if (r.uid === t.uid || r.side !== t.side || r.deployed === false) continue;
    if ((r.partStates[r.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed') continue;
    const card = data.byId.get(r.cardId);
    if (!card || !isRepeater(card)) continue;
    const reach = Math.max(0, ...(card.actions ?? []).filter((a) => isRepeater(card)).map((a) => a.range ?? 0));
    if (rangeBetween(t, r).range > reach) continue;
    out.push(r);
  }
  return out;
}

// Where an Electronic Attack may be measured FROM: the unit itself, plus every
// Repeater covering it. A Repeater is never mandatory, so the unit is always
// first in the list.
export function electronicOrigins(data: GameData, tokens: Token[], t: Token): Token[] {
  return [t, ...repeatersFor(data, tokens, t)];
}

// How a Projectile Action delivers. Only a LAUNCHED projectile triggers
// Interception; Deploy and Lay never do (FAQ M20). The launcher's wording wins:
// the MES Beacon reads "Deployable" on the projectile card but "Launch" on the
// launcher part, and it launches.
export function projectileDelivery(a: CardAction): 'launch' | 'deploy' | 'lay' {
  const hay = [
    a.name?.en ?? '', a.name?.zh ?? '',
    a.description?.zh ?? '', a.description?.en ?? '',
    ...(a.keywords ?? []).map((k) => k.inline ?? k.key ?? ''),
  ].join(' ');
  if (/布设|布雷|\bLay\b|Mine ?Lay/i.test(hay)) return 'lay';
  if (/部署|\bDeploy/i.test(hay)) return 'deploy';
  return 'launch';
}

// A bonus attack a card grants when its attack destroys a Part — the Katana's
// Chop offering an immediate Slash. Read off the printed text rather than the
// card id: the sheet writes the granted action's name between PIPES, which is a
// convention only card 145 uses today but costs nothing to honour generally, so
// a future card written the same way is covered without being remembered.
//
// "with this part" is load-bearing. The bonus comes from the SAME Part that
// struck, so the named action is looked up on that card alone; two Katanas do
// not lend each other a Slash.
//
// FAQ B8 is not enforced here because it cannot be broken from here: the caller
// re-runs the attack against the SAME defender, so the bonus can never wander
// to a second target.
export function followUpAfterKill(
  data: GameData,
  t: Token,
  action: CardAction,
): { card: Card; action: CardAction } | null {
  const text = `${action.description?.en ?? ''} ${action.description?.zh ?? ''}`;
  const named = /\|([^|]+)\|/.exec(text);
  if (!named) return null;
  const want = named[1].trim().toLowerCase();
  if (!want) return null;
  for (const { card } of tokenCards(data, t)) {
    if (!(card.actions ?? []).some((a) => a.id === action.id)) continue;
    const hit = (card.actions ?? []).find((a) =>
      (a.name?.en ?? '').trim().toLowerCase() === want || (a.name?.zh ?? '').trim() === named[1].trim());
    return hit ? { card, action: hit } : null;
  }
  return null;
}

// The Interception attempts one launch owes (4.9). The FAQ pins the geometry:
// only the STARTING grid and the LANDING grid are checked (M9/M20), and an
// Intercept is a Firing Action (M26), so Smoke over its sight of the
// triggering grid takes the shot away (F3) and Fire Control Interference
// grounds the interceptor outright (J5).
export function interceptsOwed(
  data: GameData,
  tokens: Token[],
  smoke: SmokeScreen[],
  launcher: Token,
  fresh: Token[],
): { uid: number; actionId: string; targetUid: number }[] {
  const owed: { uid: number; actionId: string; targetUid: number }[] = [];
  for (const x of tokens) {
    if (x.side === launcher.side || x.deployed === false || interceptLeft(x) <= 0) continue;
    if ((x.partStates[x.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') === 'destroyed') continue;
    if (statusCount(x.statuses, 'fci') > 0) continue;
    for (const { card } of tokenCards(data, x)) {
      for (const a of card.actions ?? []) {
        if (interceptCapacity(a) === undefined) continue;
        if ((x.intercept?.[a.id] ?? 0) <= 0) continue;
        for (const p of fresh) {
          const reach = a.range ?? 0;
          const atLanding = rangeBetween(x, p).range <= reach && !smokeBlocks(x, p, smoke);
          const atStart = rangeBetween(x, launcher).range <= reach && !smokeBlocks(x, launcher, smoke);
          if (!atLanding && !atStart) continue;
          owed.push({ uid: x.uid, actionId: a.id, targetUid: p.uid });
        }
      }
    }
  }
  return owed;
}

// The longest reach of any Intercept Action a unit carries. Nothing calls this
// - it was written for an intercept-range overlay that was never built, and the
// FAQ audit flagged it as a loose end. Kept rather than deleted because it is
// the correct reading if that overlay is ever wanted (per ACTION range, not per
// unit), but do not mistake it for part of the live path: `interceptsOwed` does
// its own per-action range test, since one unit can carry two Intercept Actions
// of different reach and the longer one must not lend its range to the shorter.
export function interceptReach(data: GameData, t: Token): number {
  let best = 0;
  for (const { card } of tokenCards(data, t)) {
    for (const a of card.actions ?? []) {
      if (interceptCapacity(a) === undefined) continue;
      best = Math.max(best, a.range ?? 0);
    }
  }
  return best;
}

export function interceptLeft(t: Token): number {
  return Object.values(t.intercept ?? {}).reduce((s, n) => s + n, 0);
}

// ---------- Mines (rulebook 4.7, FAQ M3/M6/M7/M19/M22/M24) ----------

export interface MineTrigger {
  uid: number;
  actionId: string;
  victims: number[];
  why: string;
}

function alive(t: Token): boolean {
  return t.deployed !== false && (t.partStates[t.kind === 'mech' ? 'torso' : 'main'] ?? 'intact') !== 'destroyed';
}

function coversGrid(t: Token, g: { c: number; r: number }): boolean {
  for (let dc = 0; dc < t.size; dc++) {
    for (let dr = 0; dr < t.size; dr++) {
      if (Math.floor((t.col + dc) / 3) === g.c && Math.floor((t.row + dr) / 3) === g.r) return true;
    }
  }
  return false;
}

// A Mine's trigger asks for a GROUND Unit. Anything Aerial is above it, and a
// transparent-base Flying Unit lands ON the Mine without setting it off
// (FAQ M3/M24). A Mech carries no flight class, so it is always ground.
export function isGroundUnit(data: GameData, t: Token): boolean {
  if (t.aerial) return false;
  const card = data.byId.get(t.cardId);
  return !card || !isFlyingBase(card);
}

// Every Mine standing under something that sets it off.
//
// DERIVED from the board rather than hooked onto a Movement, because a Mine
// triggers on ENTRY however the entry happened: a Maneuver, a Crush that shoves
// a Drone into the Grid (FAQ M7 says you may Lay and Crush in one Movement), a
// knockback, a shove. A derived answer also reaches both seats identically with
// nothing crossing the wire.
export function minesOwed(data: GameData, tokens: Token[]): MineTrigger[] {
  const live = tokens.filter(alive);
  const isMineToken = (t: Token): boolean => {
    const c = data.byId.get(t.cardId);
    return !!c && isMine(c);
  };
  const out: MineTrigger[] = [];
  for (const m of live) {
    const card = data.byId.get(m.cardId);
    // An Unfolded Pholcus that came up in an occupied Grid detonates on the
    // spot, ally or not (FAQ M18.4). Nothing else can share a Grid with it -
    // a Unit entering would Crush it - so sharing one IS that moment.
    if (card && isUnfolded(card)) {
      const blast = (card.actions ?? []).find((a) => (a.redDice ?? 0) + (a.yellowDice ?? 0) > 0);
      const sharing = blast ? live.filter((o) => o.uid !== m.uid && coversGrid(o, largeGridOf(m))) : [];
      if (blast && sharing.length) {
        out.push({
          uid: m.uid,
          actionId: blast.id,
          victims: sharing.map((o) => o.uid),
          why: `${m.label} Unfolded into an occupied Grid`,
        });
      }
      continue;
    }
    if (!card || !isMine(card)) continue;
    const trigger = (card.actions ?? []).find((a) => (a.redDice ?? 0) + (a.yellowDice ?? 0) > 0);
    if (!trigger) continue;
    const g = largeGridOf(m);
    // The blast catches everything in the Grid, ally, Flying and Aerial alike
    // (M6/M22) - but only a Ground Unit sets it off.
    const inGrid = live.filter((o) => o.uid !== m.uid && coversGrid(o, g));
    const walker = inGrid.find((o) => isGroundUnit(data, o));
    // Deploying a Mine into a Grid that already holds one sets off the one that
    // was already there (M6). Uids are minted in order, so the higher uid is
    // the Mine that just arrived.
    const newer = inGrid.find((o) => o.uid > m.uid && isMineToken(o));
    const by = walker ?? newer;
    if (!by) continue;
    out.push({
      uid: m.uid,
      actionId: trigger.id,
      victims: inGrid.map((o) => o.uid),
      why: walker
        ? `${walker.label} is a Ground Unit standing in its Grid`
        : `${newer!.label} was Deployed into its Grid`,
    });
  }
  return out;
}

// What a Mine Layer may drop, and where. The GLP-15's Auto Mine Laying is a
// PASSIVE that costs no Tick and no Ammo — it is paid for in Move Range, 1 point
// per Mine, and the Mines go "anywhere on the route" (M7). So the offer is read
// off the route the Mech actually walked and whatever budget it did not spend,
// which is why this takes a path and a spend rather than a destination: a player
// who wants to lay two Mines has to stop two Grids short.
//
// M29 is the one exception to "anywhere on the route": a Flight Move's path is
// only its starting and landing Grids, so a flying Mech may lay at either end
// and nowhere between, however many Grids the drawn route crossed.
export interface MineLaying {
  uid: number;
  actionId: string;
  cardId: string;
  grids: { c: number; r: number }[];
  max: number;
}

export function minesLayable(
  data: GameData,
  t: Token,
  path: { c: number; r: number }[],
  spare: number,
  flying: boolean,
): MineLaying | null {
  if (t.kind !== 'mech' || !alive(t) || !path.length || spare <= 0) return null;
  for (const { card, slot } of tokenCards(data, t)) {
    // A destroyed Part lends nothing, the same rule every other borrowed Action
    // follows.
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      if (projectileDelivery(a) !== 'lay') continue;
      // The Mine it lays is the Part's own Projectile, so a card that lays
      // something we do not hold offers nothing rather than a broken button.
      // `projectile` is a count on some cards and a list of ids on others.
      const cardId = Array.isArray(card.projectile) ? card.projectile[0] : undefined;
      if (!cardId || !data.byId.get(cardId)) continue;
      // Flight Move: the Grids between the ends were never on the path (M29).
      const ends = path.length > 1 ? [path[0], path[path.length - 1]] : [path[0]];
      const grids = flying ? ends : path;
      return { uid: t.uid, actionId: a.id, cardId, grids, max: Math.min(spare, grids.length) };
    }
  }
  return null;
}

// ---------- Pholcus, the Mine that unfolds (FAQ M8/M18/M28) ----------

// The folded Projectile becomes its Drone form in place. Everything the Drone
// prints is taken from the new card through the same builder every other Drone
// goes through - only the uid, where it stands and which way it faces survive,
// so the board keeps tracking the same piece.
export function unfoldToken(state: GameState, data: GameData, t: Token, into: Card): void {
  const fresh = makeDroneToken(state, data, into, t.side);
  Object.assign(t, fresh, { uid: t.uid, col: t.col, row: t.row, facing: t.facing, deployed: t.deployed });
}

// A folded Pholcus is owed its replacement in the Delay Phase (M18.3), which
// the Drone form then cannot act on until the NEXT round: the Automatic Phase
// has already been and gone by the time it Unfolds (M8).
export function unfoldsOwed(data: GameData, tokens: Token[]): { uid: number; actionId: string; into: string }[] {
  const out: { uid: number; actionId: string; into: string }[] = [];
  for (const t of tokens.filter(alive)) {
    const card = data.byId.get(t.cardId);
    const into = card ? unfoldsInto(card) : undefined;
    if (!card || !into) continue;
    const act = (card.actions ?? []).find((a) => a.type === 'Delay');
    if (!act) continue;
    out.push({ uid: t.uid, actionId: act.id, into });
  }
  return out;
}

// The Detonations that MUST happen (FAQ M18.6). An Unfolded Pholcus with an
// enemy in its attack range has no choice in the Automatic Phase: it jumps and
// blows up. Derived from the board like `minesOwed` rather than hung off the
// designation loop, and that is the whole reason this is small - the rule names
// ONE unit, so refusing the player's Pass would over-reach (it would force every
// other Drone to activate too) and would not even hold, since advancing the
// phase skips the loop entirely. Reading the board instead catches both.
//
// Keyed on the Action's shape, `Detonation` + `auto`, not on the card id: the
// Unfolded Pholcus is the only card in the box that carries it, so anything new
// built the same way is covered without being remembered.
//
// The target is NOT decided here. Where several are tied for nearest the player

// ---------- Martyrdom (ZHDR-302 N52 "Zealot") ----------
//
// 本机被摧毁时，立刻引爆 / 引爆时，对范围内所有单位造成爆炸伤害 -- when this
// unit is destroyed it detonates at once, and the blast takes everything in
// range. There is no English text on the card; the rule comes from the zh line
// and from the structured effect, which is the unusual part:
//
//   { type: 'detonation', trigger: 'on_destroyed',
//     target: { selection: 'all', filter: 'any', scope: 'range' },
//     damage: 'explosion', destroyAfter: true }
//
// `filter: 'any'` means ALLIES are in the blast too, so the targets are not
// narrowed by side the way autoTargetsFor narrows a Detonation ACTION.
//
// autoDetonationsOwed cannot be extended to cover it twice over: that reader
// keys on `a.type === 'Detonation'` and filters on `alive`, and this is a
// Passive on a unit that is by definition destroyed.
//
// DERIVED from the board rather than queued when the kill lands, because
// onDestroyed only records the kill -- the token stays put with its main Part
// destroyed. That also makes it self-clearing: `destroyAfter` removes the unit
// once it blows, so the read stops returning it with no "already fired" flag to
// keep anywhere.
export function martyrdomOwed(
  data: GameData,
  tokens: Token[],
): { uid: number; actionId: string; range: number; targets: number[] }[] {
  const out: { uid: number; actionId: string; range: number; targets: number[] }[] = [];
  for (const t of tokens) {
    if (t.deployed === false || alive(t)) continue;
    for (const { slot, card } of tokenCards(data, t)) {
      if (slot === 'pilot') continue;
      for (const a of card.actions ?? []) {
        const blows = (a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => {
          const eff = e as { type?: string; trigger?: string };
          return eff.type === 'detonation' && eff.trigger === 'on_destroyed';
        }));
        if (!blows) continue;
        const range = a.range ?? 0;
        const targets = tokens
          .filter((o) => o.uid !== t.uid && alive(o) && rangeBetween(t, o).range <= range)
          .map((o) => o.uid);
        out.push({ uid: t.uid, actionId: a.id, range, targets });
      }
    }
  }
  return out;
}

// still picks, because M18.6 makes the Detonation mandatory, not the victim.
export function autoDetonationsOwed(
  data: GameData,
  tokens: Token[],
): { uid: number; actionId: string; targets: number[] }[] {
  const out: { uid: number; actionId: string; targets: number[] }[] = [];
  for (const t of tokens.filter(alive)) {
    if (t.deployed === false) continue;
    const card = data.byId.get(t.cardId);
    if (!card) continue;
    for (const a of card.actions ?? []) {
      if (a.type !== 'Detonation' || a.speed !== 'auto') continue;
      const targets = autoTargetsFor(data, tokens, t, a);
      if (targets.length) out.push({ uid: t.uid, actionId: a.id, targets: targets.map((o) => o.uid) });
    }
  }
  return out;
}

export function makeDroneToken(state: GameState, data: GameData, card: Card, side: Side, backpack?: string): Omit<Token, 'col' | 'row' | 'facing'> {
  const cards = [card, backpack ? data.byId.get(backpack) : undefined].filter((x): x is Card => !!x);
  return {
    uid: uidSource.next(state),
    side,
    kind: card.category === 'projectile' ? 'projectile' : 'drone',
    cardId: card.id,
    droneBackpack: backpack,
    label: shortName(card),
    size: unitSize(card),
    aerial: isAerial(card),
    barricade: isBarricade(card) || undefined,
    stance: (card.stance as Stance) || 'offensive',
    partStates: { main: 'intact', ...(backpack ? { backpack: 'intact' } : {}) },
    ammo: initAmmo(cards),
    intercept: initIntercept(cards),
  };
}

export function makeMechToken(state: GameState, data: GameData, loadout: MechLoadout, side: Side, name?: string): Omit<Token, 'col' | 'row' | 'facing'> {
  const cards = mechCards(data, loadout);
  const pilot = loadout.pilot ? data.byId.get(loadout.pilot) : undefined;
  const torso = loadout.torso ? data.byId.get(loadout.torso) : undefined;
  const partStates: Token['partStates'] = {};
  for (const slot of PART_SLOTS) if (loadout[slot]) partStates[slot] = 'intact';
  return {
    uid: uidSource.next(state),
    side,
    kind: 'mech',
    cardId: loadout.torso ?? '',
    mech: loadout,
    label: mechLabel(data, loadout, name),
    size: 3,
    aerial: false,
    stance: 'offensive',
    link: pilot?.LV ?? 3,
    partStates,
    ammo: initAmmo(cards),
    intercept: initIntercept(cards),
  };
}

function mechLabel(data: GameData, loadout: MechLoadout, name?: string): string {
  if (name) return tidyUnitLabel(name);
  const torso = loadout.torso ? data.byId.get(loadout.torso) : undefined;
  return torso ? compactName(torso) : 'Mech';
}

const TYPE_SUFFIXES = [
  'Electronic Warfare Core',
  'High-mobility Chassis',
  'Standard Chassis',
  'Armored Chassis',
  'Support Chassis',
  'Stealth Chassis',
  'Assault Chassis',
  'Agile Chassis',
  'Battle Core',
  'Tactical Core',
  'Assault Core',
  'Support Core',
  'Command Core',
  'Armored Core',
  'Stealth Core',
  'Combat Core',
  'Recon Core',
  'Node Core',
  'ECM Core',
  'Chassis Part',
  'Core Part',
  'Trial Model',
  'Experimental',
  'Chassis',
  'Core',
];

export function shortName(card: Card): string {
  return compactName(card);
}

export function isElectronicAttack(a: CardAction): boolean {
  if ((a.gameRules ?? []).some((g) => (g.effects ?? []).some((e) => e.type === 'electronic' && e.mode === 'attack'))) return true;
  const text = `${a.description?.en ?? ''} ${a.description?.zh ?? ''} ${(a.keywords ?? [])
    .map((k) => `${k.en ?? ''} ${k.key ?? ''} ${k.inline ?? ''}`)
    .join(' ')}`.toLowerCase();
  return text.includes('electronic attack') || text.includes('电子攻击');
}

// `loans` is passed ONLY where the unit is performing the action. A Responder
// making a passive Electronic Counter Roll gains nothing from a Tarantula's
// Load (FAQ O5), and a Carrier never counts its own Load at all (O4).
export function electronicValue(data: GameData, t: Token, loans: LoanedPart[] = []): number {
  const own = tokenCards(data, t)
    .filter(({ slot }) => slot !== 'pilot')
    .filter(({ slot }) => (t.partStates[slot as PartSlot | 'main'] ?? 'intact') !== 'destroyed')
    .reduce((sum, { card }) => sum + (card.electronic ?? 0), 0);
  return own + loans.reduce((sum, { card }) => sum + (card.electronic ?? 0), 0);
}

export function defaultUnitLabel(data: GameData, t: Token): string {
  if (t.kind === 'mech') return mechLabel(data, t.mech ?? {});
  const card = t.cardId ? data.byId.get(t.cardId) : undefined;
  return card ? shortName(card) : t.label;
}

export function tidyUnitLabel(name: string): string {
  return (
    name
      .replace(/\s+/g, ' ')
      .replace(/^(?:blue|red|un|rdl|gof|pd)\s+/i, '')
      .replace(/\s*\bM\.?A\.?P\.?s?\b\.?/gi, ' ')
      .replace(/\s*\(mech\)\s*/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/[\s.·,-]+$/, '')
      .trim() || name
  );
}

export function compactName(card: Card): string {
  const raw = (card.name.en || card.name.zh || card.id).replace(/\s+/g, ' ').trim();
  const paren = /\s(\([^)]*\))$/.exec(raw);
  let base = paren ? raw.slice(0, paren.index).trim() : raw;
  for (let i = 0; i < 3; i++) {
    const hit = TYPE_SUFFIXES.find((s) => base.toLowerCase().endsWith(' ' + s.toLowerCase()));
    if (!hit) break;
    const next = base.slice(0, base.length - hit.length).trim();
    if (next.length < 3) break;
    base = next;
  }
  return paren ? `${base} ${paren[1]}` : base;
}

export function mechCards(data: GameData, loadout: MechLoadout): Card[] {
  return PART_SLOTS.map((s) => (loadout[s] ? data.byId.get(loadout[s]!) : undefined)).filter((x): x is Card => !!x);
}

// ---------- faction legality ----------

export interface FactionProblem {
  kind: 'mixed-mech' | 'mixed-squad';
  label: string;
  detail: string;
}

export function tokenFactions(data: GameData, t: Token): { factions: string[]; unknown: number } {
  const seen = new Set<string>();
  let unknown = 0;
  for (const { card } of tokenCards(data, t)) {
    const f = data.factionOf(card);
    if (f) seen.add(f);
    else unknown++;
  }
  return { factions: [...seen], unknown };
}

// Factions that hire out rather than field their own squads. Confirmed with the
// community: Planetring Dynamics and the White Dwarf collaboration are both
// mercenary, so they may serve alongside RDL, UN or GoF. GoF itself is a real
// allegiance and still cannot mix with RDL or UN.
export const MERCENARY_FACTIONS = ['PD', 'COLLABORATION'];

export interface SquadAllegiance {
  faction: string | null;
  mixed: string[];
  mercenaries: string[];
  unknown: number;
}

// A squad has no faction of its own. It takes one from the first unit that
// carries an allegiance and holds it until that unit leaves, so an empty squad
// accepts anything. Mercenaries never set it and units whose faction cannot be
// determined never set it, which is why both are counted separately here rather
// than folded into `mixed`.
export function squadAllegiance(data: GameData, tokens: Token[]): SquadAllegiance {
  const seen = new Set<string>();
  let unknown = 0;
  for (const t of tokens) {
    const f = tokenFactions(data, t);
    unknown += f.unknown;
    f.factions.forEach((x) => seen.add(x));
  }
  const mercenaries = [...seen].filter((f) => MERCENARY_FACTIONS.includes(f));
  const mixed = [...seen].filter((f) => !MERCENARY_FACTIONS.includes(f));
  return { faction: mixed.length === 1 ? mixed[0] : null, mixed, mercenaries, unknown };
}

// Whether a card could join this squad without creating a second allegiance.
// Mercenaries always may, and so does anything while the squad is still empty.
export function cardFitsSquad(data: GameData, allegiance: SquadAllegiance, card: Card): boolean {
  const f = data.factionOf(card);
  if (!f || MERCENARY_FACTIONS.includes(f)) return true;
  if (allegiance.mixed.length === 0) return true;
  return allegiance.mixed.includes(f);
}

// Carriers standing there with nothing on their back. This is LEGAL - O8 says
// so outright - so it is a reminder, never an illegality: an empty Tarantula is
// simply a drone that does nothing, and it is almost always an oversight in
// list building rather than a choice.
export function emptyCarriers(data: GameData, tokens: Token[]): Token[] {
  return tokens.filter((t) => {
    if (t.kind !== 'drone' || t.droneBackpack) return false;
    const card = data.byId.get(t.cardId);
    return !!card && isCarrier(card);
  });
}

export function factionProblems(data: GameData, tokens: Token[]): FactionProblem[] {
  const out: FactionProblem[] = [];
  const squad = new Set<string>();
  for (const t of tokens) {
    const { factions } = tokenFactions(data, t);
    factions.forEach((f) => squad.add(f));
    if (t.kind === 'mech' && factions.length > 1) {
      const parts = tokenCards(data, t)
        .map(({ slot, card }) => ({ slot, f: data.factionOf(card), card }))
        .filter((x) => x.f);
      out.push({
        kind: 'mixed-mech',
        label: t.label,
        detail: `${factions.join(' and ')} parts on one mech: ${parts.map((p) => `${cardName(p.card)} (${p.f})`).join(', ')}`,
      });
    }
  }
  const allegiance = [...squad].filter((f) => !MERCENARY_FACTIONS.includes(f));
  if (allegiance.length > 1) {
    out.push({
      kind: 'mixed-squad',
      label: 'Squad',
      detail: `This squad mixes ${allegiance.join(' and ')}. A squad may only contain units from a single faction, though mercenaries may join any of them.`,
    });
  }
  return out;
}

export function pilotCard(data: GameData, t: Token): Card | undefined {
  return t.kind === 'mech' && t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
}

// The pilot's Link Value is the ceiling Link can recover to. A pilotless mech
// gets no ceiling rather than zero, so sandbox setups without pilots still work.
export function maxLink(data: GameData, t: Token): number {
  return pilotCard(data, t)?.LV ?? 99;
}

// A Mech Maneuvers at the Maneuver Value printed on its Chassis; a Drone moves at
// its own value. Mobility Stance doubles it (rulebook 3.4.3).
// A Mech's Maneuver Value comes off its Chassis Card; anything else moves on
// the Movement Range printed on its own card.
//
// Mobility Stance doubles "the Movement Range for Maneuver" (4.1), and Maneuver
// is a Mech-only thing: only a Mech generates a Maneuver Tick, the Maneuver
// Value is printed on a Chassis Card, and 4.3.1 lists a Drone's movement
// separately as a Command Action. A Drone in Mobility Stance keeps the Dodge
// dice — that clause is written about "the Unit" — but its printed Move is not
// doubled. 18 of the 44 Drones print Mobility, so getting this wrong moved most
// of them at twice their range.
// ---------- Maneuver bonuses from Parts (FAQ E21) ----------
//
// The JP5 Mobility Enhancement Pack (538) is a BACKPACK reading "The Move
// attribute of this mech's lower limbs +1", and the audit had it recorded as
// "no part grants a Maneuver bonus" — while 538 ships in the RDL/UN starter
// preset, so the number was wrong in the first squad a new player loads.
//
// E21 pins the ORDER, which is the whole ruling: with the LM231 Standard
// Chassis at Move 1, Mobility Stance gives (1+1)x2 = 4 and NOT 1x2+1 = 3. So
// the bonus joins the base before the Stance doubles it.
//
// Read off the printed text: 538 carries no gameRules, and the FAQ paraphrases
// the same card as "The Maneuver distance of this mech +1", so both wordings
// are matched rather than the one this printing happens to use.
//
// TWO guards, because the loose version of this caught three cards it must not.
// The RL-08's "Jet Dash" reads "[Moving in Straight Line] +2 grids" — that is a
// Moving ACTION's own reach (Range 3 on the card, and the subject of FAQ E16),
// not a standing bonus to the Mech's Maneuver. So the grant has to be a PASSIVE
// the Mech simply has, and it has to name the Move ATTRIBUTE or the Maneuver
// DISTANCE rather than "+N grids", which is how an Action states its own range.
const MOVE_BONUS_EN = /(?:Move\s+attribute|Maneuver(?:\s+distance)?)[^.\n]{0,40}?\+\s*(\d+)/i;
const MOVE_BONUS_ZH = /(?:move\s*属性|机动距离|移动力)[^。\n]{0,20}?\+\s*(\d+)/i;

export function maneuverBonus(data: GameData, t: Token): number {
  if (t.kind !== 'mech') return 0;
  let bonus = 0;
  for (const { slot, card } of tokenCards(data, t)) {
    // A wrecked Part grants nothing, same as every other Part-borne rule here.
    if ((t.partStates?.[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    for (const a of card.actions ?? []) {
      if (a.type !== 'Passive') continue;
      const m = MOVE_BONUS_EN.exec(a.description?.en ?? '') ?? MOVE_BONUS_ZH.exec(a.description?.zh ?? '');
      if (m) bonus += Number(m[1]);
    }
  }
  return bonus;
}

export function maneuverRange(data: GameData, t: Token): number {
  // A destroyed Chassis cannot carry the Mech anywhere: the rulebook lists it
  // with Immobilized as "currently unable to move" (3.4.4), and FAQ E4 keeps
  // only the free change of Facing, which costs no range and is not gated here.
  if (t.kind === 'mech' && (t.partStates?.chasis ?? 'intact') === 'destroyed') return 0;
  // A TRANSFORMED core carries its own Movement and the legs stop mattering:
  // White Dwarf's Cruise Mode core (288) prints Move 3 while its Chassis Part
  // prints 1, and reading the chassis regardless made a Cruise White Dwarf walk
  // at 1 instead of flying at 3 (FAQ E23). The test is safe because a torso
  // printing a Move value is exactly the transformed case - all 21 chassis
  // carry one and 288 is the ONLY torso in the box that does, so "torso wins
  // when it has one" cannot catch anything else.
  const torso = t.kind === 'mech' && t.mech?.torso ? data.byId.get(t.mech.torso) : undefined;
  const chassis = t.kind === 'mech' && t.mech?.chasis ? data.byId.get(t.mech.chasis) : undefined;
  const transformed = !!torso?.move;
  const card = transformed ? torso : (chassis ?? data.byId.get(t.cardId));
  // A Part bonus is printed as "+1 to this mech's LOWER LIMBS", so it rides the
  // chassis. A transformed core moves on its own value with the legs out of the
  // picture, so the two do not stack - the number the JP5 raises is not the one
  // Cruise Mode is using.
  const base = (card?.move ?? 0) + (transformed ? 0 : maneuverBonus(data, t));
  // E23's point: a Stance-LOCKED unit still takes the Stance movement effects,
  // so Cruise Mode doubles to 6 in Mobility like anything else. Drones never
  // double (Maneuver is Mech-only) - White Dwarf in Cruise is a Mech in a mode,
  // not a Drone, so it qualifies. E21 fixes the ORDER against this line: the
  // Part bonus is already in `base`, so Mobility gives (1+1)x2 = 4 rather than
  // doubling first for 3.
  return t.kind === 'mech' && t.stance === 'mobility' ? base * 2 : base;
}

export function initiativeFor(data: GameData, t: Token, timing: Timing): number | undefined {
  const def = TIMINGS.find((x) => x.id === timing);
  const pilot = pilotCard(data, t);
  if (!def || !pilot) return undefined;
  const v = pilot[def.pilotKey];
  return typeof v === 'number' ? v : undefined;
}

export function tokenCards(data: GameData, t: Token): { slot: PartSlot | 'pilot' | 'main'; card: Card }[] {
  if (t.kind === 'mech' && t.mech) {
    const out: { slot: PartSlot | 'pilot'; card: Card }[] = [];
    for (const slot of PART_SLOTS) {
      const id = t.mech[slot];
      const card = id ? data.byId.get(id) : undefined;
      if (card) out.push({ slot, card });
    }
    const pilot = t.mech.pilot ? data.byId.get(t.mech.pilot) : undefined;
    if (pilot) out.push({ slot: 'pilot', card: pilot });
    return out;
  }
  const out: { slot: 'main' | 'backpack'; card: Card }[] = [];
  const main = data.byId.get(t.cardId);
  if (main) out.push({ slot: 'main', card: main });
  const bp = t.droneBackpack ? data.byId.get(t.droneBackpack) : undefined;
  if (bp) out.push({ slot: 'backpack', card: bp });
  return out as { slot: PartSlot | 'main'; card: Card }[];
}

// ---------- defender-side dice keywords (4.10) ----------
//
// Dense Armor and KC Armor are printed on PARTS (the GOF armored cores and
// the UN KC cores), so they are read off the equipped, non-destroyed cards
// rather than off the Action being resolved.

function partKeyword(data: GameData, t: Token, re: RegExp): { slot: string; card: Card } | null {
  for (const { slot, card } of tokenCards(data, t)) {
    if (slot === 'pilot') continue;
    if ((t.partStates[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    if ((card.keywords ?? []).some((k) => re.test(`${k.key ?? ''} ${k.en ?? ''}`))) return { slot, card };
  }
  return null;
}

// 致密装甲: {Defense} may offset {Heavy Hit}.
export function denseArmorOn(data: GameData, t: Token): boolean {
  return !!partKeyword(data, t, /致密装甲|Dense\s*Armor/i);
}

// KC装甲: consume a Charge Token to exchange {Lightning} in the Defense Roll
// for {Defense}. Returns the Part holding a FACE-UP Charge Token, because the
// consume is a setCharge on that exact slot.
export function kcArmorReady(data: GameData, t: Token): { slot: string } | null {
  const kc = partKeyword(data, t, /KC装甲|KC\s*Armor/i);
  if (!kc) return null;
  return (t.charge ?? []).includes(kc.slot) ? { slot: kc.slot } : null;
}

// ---------- Flying Movement granted by a Part ----------
//
// Three cards put a Mech into Flying Movement and they do NOT offer it on the
// same terms, so one boolean cannot carry both:
//
//   PDBP-201 Ojs200 - "This mech's Maneuver may be considerd as Flying"
//     (the publisher's own typo). OPTIONAL, and the Maneuver only.
//   117/119 MDXS "Fairy" System, and their (D) faces 118/120 - "If the mech is
//     equipped with this part and [the other hand], it's movement will be
//     considered as Flying". AUTOMATIC, and all movement.
//
// The difference is worth the extra state: Flying Movement cannot Crush (FAQ
// E14) and ignores Melee Lock, so flying gives something up. Making the Ojs200
// automatic would quietly spend a choice the card hands the player, which is
// why this was tasked rather than folded into `moveAsFlight`.
//
// Note `moveAsFlight` on the Card is a different thing entirely: it marks the
// eight units whose printed BASE is flying. This is a Part lending a normal
// Mech the movement mode, so the base stays what it is - which is why a Mech
// flying on an Ojs200 still sets off a Mine it lands on (`triggersMine` reads
// `isFlyingBase`, not the movement mode).
//
// Matched on the printed text rather than by card id, so the (D) faces are
// covered without naming four ids. Verified word for word against the English
// scans of 117/119, the UN 1.02 parts list and the PD 1.02 revision PDF.
const FLIGHT_MAY_EN = /Maneuver\s+may\s+be\s+consider\w*\s+as\s+Flying/i;
const FLIGHT_MAY_ZH = /调整移动可视为飞行/;
const FLIGHT_PAIR_EN = /equipped with this part and\b[^.]*\bmovement will be considered as Flying/i;
const FLIGHT_PAIR_ZH = /同时装备了[^。]*视为飞行/;

// 'maneuver' is offered and may be declined; 'always' is not a choice.
export type FlightGrant = 'none' | 'maneuver' | 'always';

export function flightGrant(data: GameData, t: Token, loans: LoanedPart[] = []): FlightGrant {
  if (t.kind !== 'mech') return 'none';
  let may = false;
  let pairHalves = 0;
  const read = (card: Card): void => {
    for (const a of card.actions ?? []) {
      // A Passive, for the same reason the Maneuver bonus insists on one: an
      // Action describing its own movement is not a standing property.
      if (a.type !== 'Passive') continue;
      const en = a.description?.en ?? '';
      const zh = a.description?.zh ?? '';
      const ruled = (a.gameRules ?? []).some(
        (g) => g.id === 'adjust_move_as_flight' || (g.effects ?? []).some((e) => e.type === 'adjust_move_as_flight'),
      );
      if (ruled || FLIGHT_MAY_EN.test(en) || FLIGHT_MAY_ZH.test(zh)) may = true;
      if (FLIGHT_PAIR_EN.test(en) || FLIGHT_PAIR_ZH.test(zh)) pairHalves++;
    }
  };
  for (const { slot, card } of tokenCards(data, t)) {
    // A wrecked Part grants nothing, as everywhere else here.
    if ((t.partStates?.[slot as PartSlot | 'main'] ?? 'intact') === 'destroyed') continue;
    read(card);
  }
  // A borrowed Load is the Mech's own Part while it acts (O3), and the Ojs200
  // is a Backpack - so a Tarantula in Contact can hand a Mech its wings.
  for (const l of loans) read(l.card);
  // The Fairy needs BOTH hands; one arm alone grants nothing. Two Parts
  // printing this passive necessarily sit in different hand slots, so counting
  // them is enough and no left/right test is needed.
  if (pairHalves >= 2) return 'always';
  return may ? 'maneuver' : 'none';
}

// The fourth way a unit flies, and the only one that belongs to an ACTION
// rather than to the unit or its Parts. The `Airborne Movement` keyword
// (空中移动) reads "This Action is considered as Flying", so the Jump it sits on
// is a Flying Movement while an ordinary Sprint from the same unit is not.
//
// Seven cards carry it, all on a Moving Action: both Jetpacks (010 TB-600,
// 088 JP1 "Long Jump"), the four LD-5 Vigilant drones and ZHDR-203 Hound III.
// Read off the KEYWORD, because three of the seven have a blank English
// description and the Chinese inline tag is the only thing they all share.
const AIRBORNE_KEYWORD = '空中移动';

export function isAirborneAction(a: CardAction): boolean {
  // A movement keyword on something that is not a Movement is not a grant.
  if (a.type !== 'Moving') return false;
  return (a.keywords ?? []).some(
    (k) => k.key === AIRBORNE_KEYWORD || (k.inline ?? '') === AIRBORNE_KEYWORD || k.en === 'Airborne Movement',
  );
}

// ---------- Tarantula Loads (FAQ O3-O8, O16-O18) ----------
//
// The ADK30C Carrier Tarantula carries one Backpack as a Load, and "Ally Mechs
// in Contact with this drone may regard the Load of this drone as their own
// Part when they perform actions". So the Load's Actions, its Electronic Value
// and its Freehand all belong to the Mech for as long as it is touching the
// Drone - stacking with the Mech's OWN Backpack (O3) and across several
// Tarantulas (O6/O17). Two Tarantulas carrying the same Backpack lend two
// DISTINCT Parts, so the Mech may use each one's Action once in an Opportunity
// (O7); the slot key carries the lender's uid for exactly that reason.
//
// The Drone itself never uses what it carries (O4), and the loan is only good
// while the Mech ACTS: a passive Electronic Counter Roll gains nothing (O5).

const LOAD_KEYWORD = '负载';

// The Carrier: a DRONE whose card prints the Load keyword. The category test is
// load-bearing - three Backpacks print the same keyword to say the opposite,
// that they may never be carried as one (JP1, JP5 and the Overloading Pack).
export function isCarrier(c: Card): boolean {
  if (c.category !== 'drone') return false;
  return (c.keywords ?? []).some((k) => k.key === LOAD_KEYWORD || k.en === 'Load' || (k.inline ?? '') === LOAD_KEYWORD);
}

// What a Carrier may have on its back. A Load is a BACKPACK: every one of the
// five cards that prints "cannot be used as a Load" is a backpack, and an
// exclusion list inside one slot only makes sense if that slot is the whole
// pool - no arm or torso ever needs excluding. Our own state agrees, calling it
// `droneBackpack` and tracking its damage under `partStates.backpack`.
//
// The type test is the load-bearing half. Without it the Load pickers offered
// all 273 Parts and a Tarantula could be sent out carrying an SMG arm.
export function canBeLoad(c: Card): boolean {
  if (c.category !== 'mech_part' || c.type !== 'backpack') return false;
  const text = `${c.description?.en ?? ''} ${(c.actions ?? []).map((a) => a.description?.en ?? '').join(' ')}`;
  return !/cannot be used as a Load/i.test(text);
}

export interface LoanedPart {
  slot: string;
  card: Card;
  from: Token;
}

// What the Tarantulas touching this Mech are lending it right now.
export function loanedParts(data: GameData, tokens: Token[], t: Token): LoanedPart[] {
  if (t.kind !== 'mech') return [];
  const out: LoanedPart[] = [];
  for (const d of tokens) {
    if (d.uid === t.uid || d.side !== t.side || d.deployed === false) continue;
    if ((d.partStates.main ?? 'intact') === 'destroyed') continue;
    const carrier = data.byId.get(d.cardId);
    if (!carrier || !isCarrier(carrier)) continue;
    // A Tarantula may stand there with nothing on its back (O8).
    if (!d.droneBackpack || (d.partStates.backpack ?? 'intact') === 'destroyed') continue;
    const load = data.byId.get(d.droneBackpack);
    if (!load || !canBeLoad(load)) continue;
    if (!inContact(t, d)) continue;
    out.push({ slot: `load:${d.uid}`, card: load, from: d });
  }
  return out;
}

export interface GuidedAction {
  action: CardAction;
  card: Card;
  slot: PartSlot | 'pilot' | 'main';
  available: boolean;
  reason?: string;
  ammoLeft?: number;
  intercept?: { left: number; max: number; can: boolean; reason?: string };
  // Present only on an Action carrying the Charge Icon (4.14).
  charge?: { charged: boolean };
  projectiles: Card[];
  // Set when the Action comes from a Carrier Tarantula's Load rather than one
  // of this Mech's own Parts (FAQ O3/O16). `partKey` is what the Opportunity
  // records as performed, so the same Action lent by two Tarantulas is two
  // Parts rather than one repeat (O7).
  lentBy?: Token;
  partKey: string;
}

export interface ActionWorld {
  tokens: Token[];
  terrain: TerrainPiece[];
}

export function guidedActions(data: GameData, t: Token, world?: ActionWorld): GuidedAction[] {
  const out: GuidedAction[] = [];
  const lockers = world ? lockersOf(data, t, world.tokens, world.terrain) : [];
  // A Load is a Backpack this Mech is holding for as long as it stays in
  // Contact with the Carrier, so it walks the same gauntlet as its own Parts.
  const loans = world ? loanedParts(data, world.tokens, t) : [];
  const sources: { slot: PartSlot | 'pilot' | 'main'; card: Card; loan?: LoanedPart }[] = [
    ...tokenCards(data, t),
    ...loans.map((loan) => ({ slot: 'backpack' as PartSlot, card: loan.card, loan })),
  ];
  for (const { slot, card, loan } of sources) {
    const partState = loan ? 'intact' : t.partStates[slot as PartSlot | 'main'] ?? 'intact';
    for (const a of card.actions ?? []) {
      let available = true;
      let reason: string | undefined;
      if (t.stance === 'shutdown') {
        available = false;
        reason = 'shutdown (Reboot only)';
      } else if (partState === 'destroyed' && !(t.repairedSlots ?? []).includes(slot)) {
        // A Repaired Part is broken in every way except that it can still
        // perform actions (FAQ J23), so the destroyed gate steps aside for it.
        available = false;
        reason = `${SLOT_LABEL[slot]} destroyed`;
      } else if (a.type === 'Firing' && statusCount(t.statuses, 'fci') > 0) {
        available = false;
        reason = 'Fire Control Interference blocks Firing';
      } else if (a.type === 'Firing' && lockers.length && !isMeleeFiring(a)) {
        available = false;
        reason = `Melee Locked by ${lockers.map((o) => o.label).join(', ')}`;
      } else if (a.type === 'Moving' && statusCount(t.statuses, 'immobilized') > 0) {
        available = false;
        reason = 'Immobilized blocks Movement';
      }
      // A Load's magazine and Interception Tokens stay on the Drone carrying it.
      const holder = loan ? loan.from : t;
      const ammoLeft = a.storage && a.storage > 0 ? holder.ammo[a.id] ?? a.storage : undefined;
      if (available && ammoLeft === 0) {
        available = false;
        reason = 'out of ammo';
      }

      const max = interceptCapacity(a);
      let intercept: GuidedAction['intercept'];
      if (max !== undefined) {
        const left = holder.intercept?.[a.id] ?? max;
        let can = true;
        let iReason: string | undefined;
        if (!available) {
          can = false;
          iReason = reason;
        } else if (statusCount(t.statuses, 'fci') > 0) {
          can = false;
          iReason = 'Fire Control Interference blocks Interception';
        } else if (left === 0) {
          can = false;
          iReason = 'no Interception Tokens left';
        }
        intercept = { left, max, can, reason: iReason };
        // A Passive Intercept part exists only to Intercept, so an empty one has nothing left to do.
        if (available && !can && a.type === 'Passive') {
          available = false;
          reason = iReason;
        }
      }

      const projectiles = Array.isArray(card.projectile)
        ? card.projectile.map((id) => data.byId.get(id)).filter((x): x is Card => !!x)
        : [];
      const charge = consumesCharge(a) ? { charged: isCharged(loan ? loan.from : t, slot) } : undefined;
      out.push({
        action: a, card, slot, available, reason, ammoLeft, intercept, charge,
        projectiles: a.type === 'Projectile' ? projectiles : [],
        lentBy: loan?.from,
        partKey: loan ? `${a.id}@${loan.from.uid}` : a.id,
      });
    }
  }
  return out;
}

function legacyZoneSet(s: unknown): string {
  const o = (s ?? {}) as { mission?: string | null; deployLayout?: string | null; map?: string };
  if (o.mission) return `mission:${o.mission}`;
  if (o.deployLayout) return `board:${o.deployLayout}`;
  if (o.map?.startsWith('custom:')) return o.map;
  return '';
}

function normaliseTactics(raw: unknown): Record<Side, string[]> {
  const v = (raw ?? {}) as Partial<Record<Side, unknown>>;
  const side = (x: unknown): string[] => (Array.isArray(x) ? x.filter((n): n is string => typeof n === 'string') : []);
  return { s1: side(v.s1), s2: side(v.s2) };
}

// Squads used to be named for their colour, which meant a side id of 'blue' or
// 'red'. Those ids appear as object keys, as array entries and as plain values,
// nested several levels down through tasks, script and setup, so this renames
// them wherever they occur rather than listing every path. Nothing else a saved
// game stores can hold those two words: board themes, marker kinds, deployment
// edges and dice colours all use other vocabulary, and dice are never persisted.
function migrateSideIds(v: unknown): unknown {
  if (typeof v === 'string') return LEGACY_SIDE[v] ?? v;
  if (Array.isArray(v)) return v.map(migrateSideIds);
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[LEGACY_SIDE[k] ?? k] = migrateSideIds(val);
  }
  return out;
}

export function migrateState(rawIn: unknown, data: GameData): GameState | null {
  const raw = migrateSideIds(rawIn);
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as {
    v?: number;
    map?: string;
    tokens?: unknown[];
    nextUid?: number;
    round?: GameState['round'];
    commandTokens?: GameState['commandTokens'];
  };
  if (!Array.isArray(s.tokens)) return null;
  if (s.v !== 1 && s.v !== 2 && s.v !== 3) return null;
  const state: GameState = {
    v: 3,
    map: s.map ?? '',
    tokens: [],
    nextUid: s.nextUid ?? 1,
    round: s.round ?? { n: 1, phase: 0, firstPlayer: 's1' },
    commandTokens: s.commandTokens ?? { s1: 0, s2: 0 },
    markers: (s as { markers?: GameState['markers'] }).markers ?? [],
    smoke: (s as { smoke?: GameState['smoke'] }).smoke ?? [],
    script: normaliseScript((s as { script?: unknown }).script, (s.round ?? { firstPlayer: 's1' }).firstPlayer ?? 's1'),
    removedTerrain: (s as { removedTerrain?: string[] }).removedTerrain ?? [],
    scale: (s as { scale?: GameState['scale'] }).scale ?? 'standard',
    roundLimit: (s as { roundLimit?: number }).roundLimit ?? 5,
    sideNames: (s as { sideNames?: GameState['sideNames'] }).sideNames ?? {},
    ready: (s as { ready?: GameState['ready'] }).ready ?? {},
    mission: (s as { mission?: string | null }).mission ?? null,
    tasks: (s as { tasks?: unknown }).tasks ? normaliseTasks((s as { tasks?: unknown }).tasks) : null,
    scenario: (s as { scenario?: string | null }).scenario ?? null,
    setup: normaliseSetup((s as { setup?: unknown }).setup),
    showZones: (s as { showZones?: boolean }).showZones ?? false,
    deployLayout: (s as { deployLayout?: string | null }).deployLayout ?? null,
    zoneSet: (s as { zoneSet?: string }).zoneSet ?? legacyZoneSet(s),
    boardTheme: (s as { boardTheme?: string }).boardTheme ?? DEFAULT_BOARD,
    tactics: normaliseTactics((s as { tactics?: unknown }).tactics),
    tacticsPlayed: normaliseTactics((s as { tacticsPlayed?: unknown }).tacticsPlayed),
  };
  for (const rawTok of s.tokens) {
    const t = rawTok as Partial<Token>;
    if (t.uid === undefined || t.col === undefined || t.row === undefined) continue;
    const card = t.cardId ? data.byId.get(t.cardId) : undefined;
    const cards =
      t.kind === 'mech' && t.mech ? mechCards(data, t.mech) : card ? [card] : [];
    const pilot = t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
    const partStates =
      t.partStates ??
      (t.kind === 'mech' && t.mech
        ? Object.fromEntries(PART_SLOTS.filter((sl) => t.mech![sl]).map((sl) => [sl, 'intact']))
        : { main: 'intact' });
    let label = t.label ?? '?';
    if (/[぀-ヿ一-鿿]/.test(label) || label.includes('…')) {
      const nameSource = t.kind === 'mech' && t.mech?.torso ? data.byId.get(t.mech.torso) : card;
      if (nameSource) label = compactName(nameSource);
    } else {
      const tidied = tidyUnitLabel(label);
      if (tidied.length < label.length) label = tidied;
    }

    state.tokens.push({
      uid: t.uid,
      side: t.side ?? 's1',
      kind: t.kind ?? 'drone',
      cardId: t.cardId ?? '',
      mech: t.mech,
      parentUid: t.parentUid,
      droneBackpack: t.droneBackpack,
      label,
      col: t.col,
      row: t.row,
      size: t.size ?? 1,
      facing: t.facing ?? 0,
      // Re-derived from the card rather than trusted: saves from before the
      // FAQ audit hold walls as aerial and the elevated drones as grounded.
      aerial: card ? isAerial(card) : (t.aerial ?? false),
      barricade: card && isBarricade(card) ? true : undefined,
      lastDamagedBy: t.lastDamagedBy,
      repairedSlots: Array.isArray(t.repairedSlots) && t.repairedSlots.length ? t.repairedSlots : undefined,
      stance: t.stance ?? ((card?.stance as Stance) || 'offensive'),
      link: t.link ?? (t.kind === 'mech' ? pilot?.LV ?? 3 : undefined),
      timing: t.timing,
      deployed: t.deployed === false ? false : undefined,
      expiring: Array.isArray(t.expiring) ? t.expiring.filter((x) => typeof x === 'string') : undefined,
      partStates: partStates as Token['partStates'],
      // Top up rather than default. `?? initAmmo` only fired when the field was
      // absent, so a token carrying an empty object, which is what a save from
      // before Ammo existed holds, could never gain a count and every launcher
      // on it silently spent nothing. A key already present always wins, so a
      // magazine spent down to 0 is not refilled.
      ammo: { ...initAmmo(cards), ...(t.ammo ?? {}) },
      intercept: { ...initIntercept(cards), ...(t.intercept ?? {}) },
      charge: Array.isArray(t.charge) && t.charge.length ? t.charge.filter((x: unknown) => typeof x === 'string') : undefined,
      log: t.log ?? [],
      statuses: (t.statuses ?? []).filter((s: string) => s !== 'interception'),
    });
  }
  return state;
}

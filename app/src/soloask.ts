// What a game against the computer is asked for by: the speeds a player may
// pick, and the address that names a game. Kept apart from solo.ts, which sits
// the computer in its seat, so that a page which only OFFERS a game (the
// tabletop's Setup tab) carries none of the machinery that plays one.
import type { GameData, SoloSquad } from './data';
import type { MechLoadout, Side } from './types';

export type Speed = 'relaxed' | 'normal' | 'brisk';

// The speeds a player may pick, slowest first, and what each does to every
// pause the computer takes (solo.ts thinkMs, restMs). Normal is the one those
// pauses are written for. Named as the canvas "Computer Play Styles" names
// them (OTTO, 2026-10-13: "generic and gaming terms"); the ids stay, so an
// address or a device's memory from before reads the same.
export const SPEEDS: { id: Speed; name: string; note: string; scale: number }[] = [
  { id: 'relaxed', name: 'Slow', note: 'time to follow each step', scale: 1.6 },
  { id: 'normal', name: 'Normal', note: 'human pace', scale: 1 },
  { id: 'brisk', name: 'Fast', note: 'quick turns', scale: 0.55 },
];

// THE SAME THREE, SLOWER, IN A GAME THE PLAYER WATCHES (OTTO, 2026-10-05, two
// computers: "even on relaxed it was still very fast. Relaxed might be to be the
// new Brisk and then have two slower steps"): nobody waits on a person, so
// every step follows the last at once unless the pace leaves room to watch it.
export const WATCH_SCALE: Record<Speed, number> = { brisk: 1.6, normal: 2.5, relaxed: 3.6 };

// The opponents a player may pick, easiest first, each with how hard it is and
// how it plays in a few words (OTTO, 2026-10-10: "list them in order of
// difficulty ... Ace is the best it would be at the bottom and marked as the
// highest difficulty"). The dialog shows the name and the level alone; the
// notes are not shown for now (OTTO, the same day: "I might add it back
// eventually when we add in the custom tuning for the bot but right now the
// playtesters dont need to see that"). The order is the measured one (AI-OPPONENT-PLAN.md
// section 12): the Veteran beats the Recruit, our Brawler beats the Veteran
// (117 of 200), the Ace beats the Brawler. The policies themselves are
// solo.ts's (OPPONENTS, which also has two more that only an address asks
// for), so a page that offers a game carries none of them. The Ace keeps the
// Tactician's name in an address and in what a device remembers, so a game set
// up before the levels came is the same game.
export const RIVALS: { id: string; name: string; level: string; note: string }[] = [
  { id: 'recruit', name: 'Recruit', level: 'Easy', note: 'makes mistakes' },
  { id: 'veteran', name: 'Veteran', level: 'Medium', note: 'ignores return fire' },
  { id: 'brawler', name: 'Brawler', level: 'Hard', note: 'fights for the zones' },
  { id: 'tactician', name: 'Ace', level: 'Hardest', note: 'plays for the mission' },
];
// The one a game is played against unless another is picked: the Ace.
export const RIVAL = 'tactician';

// THE COMPUTER'S PLAY STYLE (M19; OTTO, 2026-10-13, the canvas "Computer Play Styles", version 7: "one to two word
// Names and then short neutral descriptions"; released 2026-10-15): HOW the computer plays, beside how well it plays
// (the Difficulty). The names and lines are the page's, here; what each makes of a computer is ai/styles.ts's
// (STYLE_SETS, CUSTOM_SETS), mapped in solo.ts. `needs`: what the computer's squad must bring for the style to be one
// at all; played without it the style is Default (OTTO: "if it doesn't detect any of the related parts it changes
// back to Default and possibly lets the user know").
export type StyleNeed = 'launcher' | 'camouflage' | 'melee';
export const STYLES: { id: string; name: string; line: string; needs: StyleNeed | null }[] = [
  { id: 'default', name: 'Default', line: 'balanced play', needs: null },
  { id: 'missile', name: 'Missile Barrage', line: 'focuses on missile attacks', needs: 'launcher' },
  { id: 'stealth', name: 'Stealth', line: 'uses Optical Camouflage', needs: 'camouflage' },
  { id: 'melee', name: 'Melee Rush', line: 'closes in for melee attacks', needs: 'melee' },
  { id: 'objective', name: 'Objective Focus', line: 'plays for the Main Task first', needs: null },
  { id: 'custom', name: 'Custom', line: 'set each behaviour', needs: null },
];
export const STYLE = 'default';
// What a style needs, in a player's words ("Missile Barrage needs missiles").
export const NEED_WORDS: Record<StyleNeed, string> = { launcher: 'missiles', camouflage: 'Optical Camouflage', melee: 'a melee weapon' };

// The words that switch Optical Camouflage on, as units.ts canActivateCamo reads them off a card.
const CAMO_ON = /开启光学迷彩|Activate Optical Camouflage/i;

// Whether a squad brings what a style needs: a card printing a Projectile Action (a launcher), one that switches
// Optical Camouflage on, a Part or Drone printing a Melee Action (every Mech can Punch and Kick, which no card prints).
// A Carrier's Load is left out: the Carrier gains nothing from its own Load.
export function squadHas(data: GameData, sq: SoloSquad, need: StyleNeed): boolean {
  const ids: string[] = [];
  for (const m of sq.mechs) for (const id of Object.values(m.loadout)) if (typeof id === 'string' && id) ids.push(id);
  for (const d of sq.drones) ids.push(d.cardId);
  return ids.some((id) => (data.byId.get(id)?.actions ?? []).some((a) => (need === 'launcher' ? a.type === 'Projectile'
    : need === 'melee' ? a.type === 'Melee'
    : CAMO_ON.test(`${a.description?.zh ?? ''} ${a.description?.en ?? ''}`))));
}

// Whether a style can be played by a squad (a style that needs nothing always can).
export function styleFits(data: GameData, sq: SoloSquad | null | undefined, style: string): boolean {
  const need = STYLES.find((s) => s.id === style)?.needs;
  return !need || (!!sq && squadHas(data, sq, need));
}

// THE CUSTOM STYLE'S ROWS (the canvas's "Customize"): each behaviour in a few neutral words, its group, its choices.
// A row shows the level's own choice until the player picks another ("Normal matches Default"); what each choice
// sets is ai/styles.ts CUSTOM_SETS's, and the suite holds the two lists to each other.
const TWO = ['Off', 'On'] as const;
const THREE = ['Less', 'Normal', 'More'] as const;
export const CUSTOM_ROWS: { id: string; group: string; label: string; opts: readonly string[] }[] = [
  { id: 'hunter', group: 'Targeting', label: 'Targets the highest-value unit', opts: TWO },
  { id: 'lines', group: 'Targeting', label: 'Avoids blocking allied fire', opts: TWO },
  { id: 'contact', group: 'Movement', label: 'Advances on enemies', opts: THREE },
  { id: 'cover', group: 'Movement', label: 'Avoids enemy fire', opts: THREE },
  { id: 'camo', group: 'Stealth', label: 'Stays in Optical Camouflage', opts: TWO },
  { id: 'launch', group: 'Missiles', label: 'Missile use', opts: THREE },
  { id: 'volley', group: 'Missiles', label: 'Fires launchers together', opts: TWO },
  { id: 'blade', group: 'Melee', label: 'Seeks melee', opts: TWO },
  { id: 'lock', group: 'Melee', label: 'Melee Locks enemy shooters', opts: TWO },
  { id: 'task', group: 'Main Task', label: 'Main Task focus', opts: THREE },
  { id: 'wolf', group: 'Main Task', label: 'Sends a lone unit to a second zone', opts: TWO },
  { id: 'dials', group: 'Teamwork', label: 'Coordinates Timing Dials', opts: TWO },
  { id: 'leash', group: 'Teamwork', label: 'Keeps carrier Drones beside their Mech', opts: TWO },
];
// Each level's own choice on a row: the Ace's, save that the Brawler and the Recruit made of it hunt.
const OWN: Record<string, string> = {
  hunter: 'Off', lines: 'On', contact: 'Normal', cover: 'Normal', camo: 'Off', launch: 'Normal', volley: 'On', blade: 'Off', lock: 'Off',
  task: 'Normal', wolf: 'Off', dials: 'Off', leash: 'On',
};
export function ownChoice(level: string, row: string): string {
  if (row === 'hunter' && (level === 'brawler' || level === 'recruit')) return 'On';
  return OWN[row] ?? 'Normal';
}

// The Custom style's picks in an address and a game's log: "hunter-on.contact-more", each row picked once, in the
// rows' order; read back keeping only rows and choices that exist.
export function customText(picks: Readonly<Record<string, string>>): string {
  return CUSTOM_ROWS.filter((r) => r.opts.includes(picks[r.id])).map((r) => `${r.id}-${picks[r.id].toLowerCase()}`).join('.');
}
export function customFrom(text: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof text !== 'string') return out;
  for (const part of text.split('.')) {
    const [id, opt] = part.split('-');
    const row = CUSTOM_ROWS.find((r) => r.id === id);
    const pick = row?.opts.find((o) => o.toLowerCase() === opt);
    if (row && pick) out[row.id] = pick;
  }
  return out;
}

// A GAME THE PLAYER PUT TOGETHER (solosetup.ts): any battlefield, any Main
// Task, and a squad for each seat. It is asked for by this name, and the game
// itself is kept in this device's storage under this key: an address is no
// place for two squads, and a rematch asks for the same game again.
export const SOLO_OWN = 'own';
export const SOLO_OWN_KEY = 'ember-solo-own';

export interface SoloOwn {
  map: string;
  mission: string;
  rounds: number;
  secondaries: boolean;
  // Each seat's squad, as the table imports one (commands.ts importSquad).
  squads: Record<Side, SoloSquad>;
}

const SLOTS: (keyof MechLoadout)[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];

// One squad out of storage, kept to the shape the table imports: names and
// card ids as plain text, nothing else carried over. Whether the cards exist
// and the squad is legal is the table's to say when it is imported.
function ownSquad(raw: unknown): SoloSquad | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { name?: unknown; faction?: unknown; mechs?: unknown; drones?: unknown };
  const mechs: SoloSquad['mechs'] = [];
  for (const m of Array.isArray(s.mechs) ? s.mechs : []) {
    if (!m || typeof m !== 'object') continue;
    const src = ((m as { loadout?: unknown }).loadout ?? {}) as Record<string, unknown>;
    const loadout: MechLoadout = {};
    for (const slot of SLOTS) { const v = src[slot]; if (typeof v === 'string' && v) loadout[slot] = v; }
    if (!loadout.torso && !loadout.chasis) continue;
    const name = (m as { name?: unknown }).name;
    mechs.push({ ...(typeof name === 'string' && name ? { name } : {}), loadout });
  }
  const drones: SoloSquad['drones'] = [];
  for (const d of Array.isArray(s.drones) ? s.drones : []) {
    if (!d || typeof d !== 'object' || typeof (d as { cardId?: unknown }).cardId !== 'string') continue;
    const backpack = (d as { backpack?: unknown }).backpack;
    drones.push({ cardId: (d as { cardId: string }).cardId, ...(typeof backpack === 'string' && backpack ? { backpack } : {}) });
  }
  if (!mechs.length && !drones.length) return null;
  // Its Tactics Cards, as ids, each once: whether they are cards a squad may
  // hold is the table's to say when the hand is dealt.
  const cards = (s as { tactics?: unknown }).tactics;
  const tactics = [...new Set((Array.isArray(cards) ? cards : []).filter((t): t is string => typeof t === 'string' && !!t))].slice(0, 8);
  return {
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 60) : 'Squad', ...(typeof s.faction === 'string' ? { faction: s.faction } : {}), mechs, drones,
    ...(tactics.length ? { tactics } : {}),
  };
}

// The game out of storage, or null when what is there is not one.
export function ownGame(raw: unknown): SoloOwn | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { map?: unknown; mission?: unknown; rounds?: unknown; secondaries?: unknown; squads?: unknown };
  const squads = (g.squads && typeof g.squads === 'object' ? g.squads : {}) as Record<string, unknown>;
  const s1 = ownSquad(squads.s1);
  const s2 = ownSquad(squads.s2);
  if (typeof g.map !== 'string' || typeof g.mission !== 'string' || !s1 || !s2) return null;
  const rounds = Number(g.rounds);
  return { map: g.map, mission: g.mission, rounds: Number.isInteger(rounds) && rounds >= 1 && rounds <= 9 ? rounds : 5, secondaries: g.secondaries === true, squads: { s1, s2 } };
}

// What a page's address asks for, before the card data is in:
// ?solo=<scenario id, or own>&side=<faction, or s1 / s2>&seed=<n>&pace=<speed>&ai=<opponent>&watch=1&ai2=<opponent>&season=<id>
//   &style=<style>&style2=<style>&custom=<customText>
// (`ai2`, `style2`: in a game the player watches, the computer in the page's own seat;
// `season`: the Season Rules the game is played with, 1.04; `custom`: the Custom style's picks.)
export function soloAsk(search: string): Record<string, string> | null {
  const q = new URLSearchParams(search);
  const id = q.get('solo');
  if (!id) return null;
  const out: Record<string, string> = { solo: id };
  for (const k of ['side', 'seed', 'pace', 'ai', 'watch', 'ai2', 'season', 'style', 'style2', 'custom']) { const v = q.get(k); if (v) out[k] = v; }
  return out;
}

// The address of a game, for the page that offers one and for a rematch. It
// says only what is not the default.
export function soloQuery(o: {
  scenario: string; side: string; seed?: number; speed?: Speed; opponent?: string; watch?: boolean; opponent2?: string; season?: string;
  style?: string; style2?: string; custom?: Readonly<Record<string, string>>;
}): string {
  const q = new URLSearchParams({ solo: o.scenario, side: o.side });
  if (o.seed !== undefined) q.set('seed', String(o.seed));
  if (o.speed && o.speed !== 'normal') q.set('pace', o.speed);
  if (o.opponent && o.opponent !== RIVAL) q.set('ai', o.opponent);
  if (o.watch) q.set('watch', '1');
  if (o.watch && o.opponent2 && o.opponent2 !== RIVAL) q.set('ai2', o.opponent2);
  if (o.season) q.set('season', o.season);
  if (o.style && o.style !== STYLE) q.set('style', o.style);
  if (o.watch && o.style2 && o.style2 !== STYLE) q.set('style2', o.style2);
  const custom = o.custom ? customText(o.custom) : '';
  if (custom && (o.style === 'custom' || (o.watch && o.style2 === 'custom'))) q.set('custom', custom);
  return `?${q.toString()}`;
}

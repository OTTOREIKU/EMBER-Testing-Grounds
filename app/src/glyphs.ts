import { iconSvg } from './dice';

// Card and glossary text carries {Eye}, {Heavy Hit}, {B} and so on where the
// printed card draws a symbol. Nothing expanded them, so players read the
// literal braces. These render the real icon instead.

const ICONS: Record<string, string> = {
  lightning: 'lightning',
  lightining: 'lightning',
  defense: 'defense',
  dodge: 'dodge',
  eye: 'eye',
  'heavy hit': 'heavyHit',
  heavyhit: 'heavyHit',
  'light hit': 'lightHit',
  lighthit: 'lightHit',
};

// The colour is a CLASS SUFFIX: `die-blue` picks up `.glyph-die.die-blue`, and
// the same four names are styled in styles.css and reference.css.
//
// These used to read `s1` and `s2`, which are the SEAT colours (player one and
// player two), not die colours. Nothing styles `.die-s1`, so every Blue and Red
// die in card text rendered as an empty bordered box - "for every {3R}, +{1R}"
// came out as four blank squares. Yellow and White were unaffected only because
// their names happen to be the same in both vocabularies, which is what let it
// sit unnoticed.
const DICE: Record<string, { colour: string; label: string }> = {
  b: { colour: 'blue', label: 'Blue die' },
  y: { colour: 'yellow', label: 'Yellow die' },
  r: { colour: 'red', label: 'Red die' },
  w: { colour: 'white', label: 'White die' },
};

// The boxed ! and ? a Drone card prints beside an action name.
const SPEED: Record<string, { cls: string; label: string }> = {
  '!': { cls: 'sp-auto', label: 'Automatic Action' },
  '?': { cls: 'sp-command', label: 'Command Action' },
};

// The trailing punctuation is captured with the placeholder so it can be kept
// on the same line: an inline-flex glyph is an atomic inline, and a break is
// allowed between it and the next character, which stranded a lone full stop.
const PLACEHOLDER = /\{([^{}]{1,12})\}([.,;:!?)]*)/g;

function render(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  const speed = SPEED[key];
  if (speed) return `<span class="act-speed ${speed.cls}" title="${attr(speed.label)}">${attr(key)}</span>`;
  const icon = ICONS[key];
  if (icon) {
    const label = icon === 'heavyHit' ? 'Heavy Hit' : icon === 'lightHit' ? 'Light Hit' : raw.trim();
    return `<span class="glyph-ico" title="${attr(label)}">${iconSvg({ type: icon } as never, 14)}</span>`;
  }
  const die = DICE[key];
  if (die) return `<span class="glyph-die die-${die.colour}" title="${attr(die.label)}"></span>`;
  // Cards write a die count as {1Y} or {3R} as often as they write {Y}, and a
  // bare colour table leaves those printed as literal braces.
  const counted = /^(\d{1,2})\s*([byrw])$/.exec(key);
  if (counted) {
    const n = Number(counted[1]);
    const d = DICE[counted[2]];
    if (d && n > 0 && n <= 9) {
      const label = n === 1 ? `1 ${d.label}` : `${n} ${d.label.replace(/die$/, 'dice')}`;
      const pips = `<span class="glyph-die die-${d.colour}"></span>`.repeat(n);
      return `<span class="glyph-dice" title="${attr(label)}">${pips}</span>`;
    }
  }
  return null;
}

// Runs AFTER escaping, so the braces are still literal but any < > in the
// source is already neutralised.
export function expandGlyphs(escaped: string): string {
  return escaped.replace(PLACEHOLDER, (whole, raw: string, tail: string) => {
    const out = render(String(raw));
    return out ? bind(out, tail) : whole;
  });
}

function bind(glyph: string, tail: string): string {
  return tail ? `<span class="glyph-run">${glyph}${tail}</span>` : glyph;
}

// Several placeholders ({Heavy Hit}, {Dodge}) are also glossary keyword names,
// so the keyword linker wraps an anchor inside the braces and the pattern above
// stops matching. Mask them before linking and restore afterwards. The sentinel
// holds no letters, so no keyword pattern can match inside it.
const MARK = '@@';

export function maskGlyphs(escaped: string): { masked: string; restore: (html: string) => string } {
  const held: string[] = [];
  const masked = escaped.replace(PLACEHOLDER, (whole, raw: string, tail: string) => {
    const out = render(String(raw));
    if (!out) return whole;
    held.push(bind(out, tail));
    return `${MARK}${held.length - 1}${MARK}`;
  });
  if (!held.length) return { masked, restore: (html) => html };
  const re = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');
  return { masked, restore: (html) => html.replace(re, (_m, i: string) => held[Number(i)] ?? '') };
}

// THE ATTACK POOL DRAWN AS DICE. The card prints a pool as a row of coloured
// squares, never as "3Y 1R". This goes back through expandGlyphs rather than
// writing its own row, so there is ONE drawing of a die in the app: a second
// one would be free to drift from the one the rules text renders, on the same
// screen and often in the same paragraph.
//
// Shared by the reference and the board for the same reason.
export function diePips(n: number | undefined, colour: 'R' | 'Y'): string {
  if (!n || n < 0) return '';
  const out = expandGlyphs(`{${n}${colour}}`);
  // expandGlyphs draws 1 to 9 and leaves anything else with its braces on. A
  // literal "{12R}" on screen would be worse than the plain text it replaced,
  // so an out-of-range count falls back to that text. No escaping needed: the
  // fallback is a number and one letter.
  return out.includes('{') ? `${n}${colour}` : out;
}

// THE POOL'S ORDER IS THE FACTION'S, and this is not a guess: five cards with
// mixed pools were read off the scans.
//
//   ZHDR-102 Vanguard II "Crossbow"  GoF  drone  data 2Y 1R  printed R Y Y
//   ZHLA-302 MR870 Shotgun           GoF  part   data 2Y 1R  printed R Y Y
//   ZHRA-202 MR24 Railgun            GoF  part   data 1Y 2R  printed R R Y
//   126 K9 Nail Gun                  UN   part   data 1Y 2R  printed Y R R
//   055 CC-100 Hercules              RDL  part   data 2Y 5R  printed Y Y R
//
// GoF prints RED first; everyone else prints yellow first. It holds on a GoF
// drone and on GoF parts alike, so it is the faction's card template rather
// than a card-type quirk. The order carries no rules meaning at all - it is
// pure fidelity to the printed card, so a player comparing screen to table
// sees the same row.
export function diceRow(yellow: number | undefined, red: number | undefined, faction?: string | null): string {
  const parts = faction === 'GOF'
    ? [diePips(red, 'R'), diePips(yellow, 'Y')]
    : [diePips(yellow, 'Y'), diePips(red, 'R')];
  return parts.filter(Boolean).join(' ');
}

// The same order as plain text, for the two places that cannot render markup:
// the Roll button's label and the hover tip. They sit beside the pips, so a
// different order in one of them would contradict the other on one screen.
export function diceText(yellow: number | undefined, red: number | undefined, faction?: string | null): string[] {
  const y = yellow ? `${yellow}Y` : '';
  const r = red ? `${red}R` : '';
  return (faction === 'GOF' ? [r, y] : [y, r]).filter(Boolean);
}

// ---------- THE ACTION LENGTH CAPSULE, as the cards print it ----------
//
// Measured off the printed cards rather than invented (ZHRA-201 Power Shot and
// ZHLA-102 Command Coordination, upscaled): a vertical rounded capsule with a
// heavy dark outline and a pale interior, holding THREE slots, of which the
// cost is filled in dark slate. The fill is BOTTOM ANCHORED, so a Short action
// is one segment sitting at the foot of an otherwise empty capsule rather than
// a short capsule.
//
//   Short   1 segment    (1 Action Tick)
//   Medium  2 segments   (2 Action Ticks)
//   Long    3 segments   (1 Maneuver Tick + 2 Action Ticks)
//
// The three slots are DELIBERATELY UNDIFFERENTIATED, exactly as printed: the
// card does not distinguish the Maneuver Tick a Long action also costs. Our
// split lives in the title instead, which adds what we know without changing
// what a player recognises from the table.
//
// Shared rather than written per page, because the same capsule has to appear
// on the reference, the board and the Match Centre for the familiarity to be
// worth anything.
export const TICK_SLOTS = 3;

// Which of an Action's Ticks a unit no longer has, for a page that shows it on
// the capsule: the Maneuver Tick a Long Action needs, and how many of its
// Action Ticks are beyond the ones left.
export interface CapsuleShort {
  maneuver?: boolean;
  actions?: number;
}

export function tickCapsule(filled: number, title = '', short: CapsuleShort = {}): string {
  const n = Math.max(0, Math.min(TICK_SLOTS, Math.round(filled)));
  // Rendered top-down so the markup reads in visual order; the empties come
  // first, which is what puts the filled ones at the bottom. Of the filled
  // ones, a Long Action's top slot is its Maneuver Tick and the rest are Action
  // Ticks; the ones the unit is short of are marked from the top down.
  const lacking = Math.max(0, Math.round(short.actions ?? 0));
  const slots = Array.from({ length: TICK_SLOTS }, (_, i) => {
    if (i < TICK_SLOTS - n) return '<i></i>';
    const isManeuver = n === TICK_SLOTS && i === 0;
    const action = i - (TICK_SLOTS - n) - (n === TICK_SLOTS ? 1 : 0);
    const gone = isManeuver ? !!short.maneuver : action < lacking;
    return gone ? '<i class="on short"></i>' : '<i class="on"></i>';
  }).join('');
  return `<span class="tick-cap${n ? '' : ' none'}"${title ? ` title="${attr(title)}"` : ''} aria-hidden="true">${slots}</span>`;
}

// ---------- the Opportunity's Ticks, as the book draws them ----------
//
// Rulebook p.31 (3.4.5) draws a Mech Action Opportunity as the Action Length
// capsule drawn full: a thick X for the Maneuver Tick, then a square for each
// Action Tick. Laid on its side here, one tap target per Tick, in the same
// pale-and-ink the capsule above uses. Extra Ticks follow a divider, each
// labelled with the Action Type it pays for, and exist only while a Part
// grants one.
//
// The X is two rounded bars, drawn rather than typed: no font's multiplication
// sign is as heavy as the printed one.
export const MANEUVER_X =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">'
  + '<rect x="9.5" y="0.6" width="5" height="22.8" rx="1.7" transform="rotate(45 12 12)"/>'
  + '<rect x="9.5" y="0.6" width="5" height="22.8" rx="1.7" transform="rotate(-45 12 12)"/>'
  + '</g></svg>';

export interface TickBarOpts {
  // The data-act a tap on any Tick sends. Without it the bar is a picture.
  act?: string;
  // A data-act for the X alone, when only the Maneuver can be tapped.
  maneuverAct?: string;
}

const TIMING_SHORT: Record<string, string> = {
  swift: 'SWF', melee: 'MEL', projectile: 'PRJ', firing: 'FIR', movement: 'MOV', tactical: 'TAC',
};

function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

export function tickBar(
  s: {
    maneuver: 'free' | 'spent' | 'lost';
    actions: boolean[];
    extras: { id: string; label: string; timing?: string; spent: boolean; lapsed: boolean }[];
  },
  opts: TickBarOpts = {},
): string {
  const tile = (act: string | undefined, tick: string, cls: string, label: string, pressed: boolean, body: string): string =>
    act
      ? `<button type="button" class="tk ${cls}" data-act="${act}" data-tick="${attr(tick)}" aria-label="${attr(label)}" aria-pressed="${pressed}" title="${attr(label)}">${body}</button>`
      : `<span class="tk ${cls}" role="img" aria-label="${attr(label)}" title="${attr(label)}">${body}</span>`;
  const m = s.maneuver;
  const mLabel = m === 'spent' ? 'Maneuver Tick, spent'
    : m === 'lost' ? 'Maneuver Tick, gone: an Action Tick was spent first'
      : 'Maneuver Tick';
  // A gone X cannot be marked or taken back, so it is never a tap target.
  const mAct = m === 'lost' ? undefined : opts.maneuverAct ?? opts.act;
  const tiles = [tile(mAct, 'm', `tk-m ${m}`, mLabel, m !== 'free', MANEUVER_X)];
  s.actions.forEach((spent, i) => {
    tiles.push(tile(opts.act, `a${i}`, `tk-a${spent ? ' spent' : ''}`, `Action Tick ${i + 1}${spent ? ', spent' : ''}`, spent, '<i></i>'));
  });
  if (s.extras.length) {
    tiles.push('<i class="tk-div" aria-hidden="true"></i>');
    for (const x of s.extras) {
      const short = x.timing ? TIMING_SHORT[x.timing] ?? '' : '';
      const state = x.spent ? ' spent' : x.lapsed ? ' lapsed' : '';
      const label = `Extra Tick: ${x.label}${x.spent ? ', spent' : x.lapsed ? ', not granted now' : ''}`;
      tiles.push(tile(opts.act, `x:${x.id}`, `tk-x${state}`, label, x.spent, `<i></i>${short ? `<b>${short}</b>` : ''}`));
    }
  }
  return `<span class="tick-bar">${tiles.join('')}</span>`;
}

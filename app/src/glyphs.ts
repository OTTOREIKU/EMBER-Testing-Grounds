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
  if (speed) return `<span class="act-speed ${speed.cls}" title="${speed.label}">${key}</span>`;
  const icon = ICONS[key];
  if (icon) {
    const label = icon === 'heavyHit' ? 'Heavy Hit' : icon === 'lightHit' ? 'Light Hit' : raw.trim();
    return `<span class="glyph-ico" title="${label}">${iconSvg({ type: icon } as never, 14)}</span>`;
  }
  const die = DICE[key];
  if (die) return `<span class="glyph-die die-${die.colour}" title="${die.label}"></span>`;
  // Cards write a die count as {1Y} or {3R} as often as they write {Y}, and a
  // bare colour table leaves those printed as literal braces.
  const counted = /^(\d{1,2})\s*([byrw])$/.exec(key);
  if (counted) {
    const n = Number(counted[1]);
    const d = DICE[counted[2]];
    if (d && n > 0 && n <= 9) {
      const label = n === 1 ? `1 ${d.label}` : `${n} ${d.label.replace(/die$/, 'dice')}`;
      const pips = `<span class="glyph-die die-${d.colour}"></span>`.repeat(n);
      return `<span class="glyph-dice" title="${label}">${pips}</span>`;
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

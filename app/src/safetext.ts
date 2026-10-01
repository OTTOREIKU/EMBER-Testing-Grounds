// Text a player typed - a unit's name, a squad's name - or that arrived from
// somewhere this client does not control: the relay, a shared squad file, a
// saved or replayed game. None of it ever needs an angle bracket, and a name
// holding one is markup trying to get into the page, so the relay, the state
// loader and the naming commands take them out before anything is stored.
// The pages escape what they draw as well (escapeHtml); this is the second
// wall, not the only one, and the Content-Security-Policy in each page is the
// third.

const TAGS = /[<>]/g;
// A one-line name also loses control characters and the direction overrides
// that can make it read as something else.
const NAME_JUNK = /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/g;

export function stripTags(s: string): string {
  return s.replace(TAGS, '');
}

export function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').replace(NAME_JUNK, '').replace(/ {2,}/g, ' ').trim();
}

// Every string in a JSON-shaped value, keys included, with the brackets out.
// Honest data is never nested this deep, so a structure that is gets dropped
// rather than walked, and a `__proto__` key is dropped rather than assigned.
export function cleanStrings<T>(value: T): T {
  return clean(value, 0) as T;
}

function clean(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return v.includes('<') || v.includes('>') ? stripTags(v) : v;
  if (!v || typeof v !== 'object') return v;
  if (depth > 64) return null;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    // Checked as it will be WRITTEN: '<__proto__>' is that key once stripped.
    const key = stripTags(k);
    if (key === '__proto__') continue;
    out[key] = clean(x, depth + 1);
  }
  return out;
}

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Text into HTML, between tags or inside a quoted attribute.
//
// THE one escaping rule. Every page module keeps a local `esc` with this exact
// behaviour rather than importing it, because twenty test files load those
// modules with their imports stripped; safetext.test finds every one of them
// by name and holds its output to this function's, so they cannot drift.
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITY[c]!);
}

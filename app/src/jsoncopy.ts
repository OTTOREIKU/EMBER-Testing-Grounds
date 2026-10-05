// A COPY OF A TABLE, AS JSON WOULD MAKE IT. A seat thinking about its turn
// copies the table for every answer it looks ahead through, tens of thousands
// of times a game (glue.ts tableAfter, owed.ts owedIfActivated, commands.ts
// checkAfter), and `JSON.parse(JSON.stringify(x))` was a tenth of the
// thought. This makes the very same copy, faster: what JSON.stringify leaves
// out of an object is left out (an undefined, a function, a symbol), in an
// array it is null, a number that is not finite is null and -0 is 0, a key
// named "__proto__" stays a key, anything with toJSON goes through JSON
// itself, and a BigInt is refused as JSON refuses it. Plain data in, plain
// data out (tests/jsoncopy.test.mjs holds it to JSON's copy).
//
// This file imports nothing.

export function copyAsJson<T>(value: T): T {
  return copy(value) as T;
}

function copy(v: unknown): unknown {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? (v === 0 ? 0 : v) : null;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
  if (t !== 'object') return undefined;
  const o = v as { toJSON?: unknown };
  if (typeof o.toJSON === 'function') return JSON.parse(JSON.stringify(v)) as unknown;
  if (Array.isArray(v)) {
    const out = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) {
      const x: unknown = v[i];
      const tx = typeof x;
      out[i] = x === undefined || tx === 'function' || tx === 'symbol' ? null : copy(x);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) {
    const x = (v as Record<string, unknown>)[k];
    const tx = typeof x;
    if (x === undefined || tx === 'function' || tx === 'symbol') continue;
    if (k === '__proto__') Object.defineProperty(out, k, { value: copy(x), enumerable: true, writable: true, configurable: true });
    else out[k] = copy(x);
  }
  return out;
}

// Which host the app talks to. A wrong answer here fails silently — it looks
// exactly like "the server is down" — so it is pinned rather than trusted.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const start = src.indexOf('export function apiBaseFor');
const end = src.indexOf('function defaultBase');
if (start < 0 || end < 0) throw new Error('could not locate apiBaseFor in api.ts');
const tmp = new URL('./_api.slice.ts', import.meta.url);
writeFileSync(tmp, src.slice(start, end));
const { apiBaseFor } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${want}, got ${got}`); }
};

console.log('Which API host the app talks to\n');

check('the live site uses the api subdomain',
  apiBaseFor('embertg.online', 'https:'), 'https://api.embertg.online');
check('www does too',
  apiBaseFor('www.embertg.online', 'https:'), 'https://api.embertg.online');
// The apex and the API being same-site is what lets the session cookie stay
// SameSite=Lax, so the API must never be addressed by another name.
check('the api host itself resolves to itself',
  apiBaseFor('api.embertg.online', 'https:'), 'https://api.embertg.online');

check('local dev points at the local server',
  apiBaseFor('localhost', 'http:'), 'http://localhost:3002');
check('so does a LAN address, for testing on a phone',
  apiBaseFor('192.168.1.20', 'http:'), 'http://192.168.1.20:3002');

// A lookalike domain must not be handed our cookies.
check('a lookalike domain is not treated as ours',
  apiBaseFor('notembertg.online', 'https:'), 'https://notembertg.online:3002');
check('nor is a subdomain-shaped impostor',
  apiBaseFor('embertg.online.evil.com', 'https:'), 'https://embertg.online.evil.com:3002');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

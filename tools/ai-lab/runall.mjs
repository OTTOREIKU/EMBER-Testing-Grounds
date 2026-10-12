// Runs every test file named in app/package.json's "test" script, a few at a time, and prints one line per file
// plus the tail of any failure; the whole report goes to runall.out.txt beside this file (or RUNALL_OUT).
//   node tools/ai-lab/runall.mjs [name filter ...]     PAR=<processes> (6)   APP_DIR=<another app copy>
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = process.env.APP_DIR || fileURLToPath(new URL('../../app', import.meta.url));
const pkg = JSON.parse(readFileSync(`${app}/package.json`, 'utf8'));
const files = [...pkg.scripts.test.matchAll(/node (tests\/[\w.-]+\.test\.mjs)/g)].map((m) => m[1]);
const only = process.argv.slice(2);
const list = only.length ? files.filter((f) => only.some((o) => f.includes(o))) : files;
const node = process.env.NODE || process.execPath;
const par = Number(process.env.PAR || 6);
const results = [];
let next = 0;

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(node, [file], { cwd: app });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ file, code, ms: Date.now() - t0, out }));
  });
}

async function worker() {
  while (next < list.length) {
    const f = list[next++];
    const r = await run(f);
    results.push(r);
    const m = r.out.match(/(\d+)\s+passed[^\n]*?(\d+)\s+failed/i) || r.out.match(/passed:?\s*(\d+)[^\n]*failed:?\s*(\d+)/i);
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'} ${f} (${r.ms}ms)${m ? ` ${m[0]}` : ''}`);
  }
}

await Promise.all(Array.from({ length: par }, worker));
const bad = results.filter((r) => r.code !== 0);
let report = `files ${results.length}, failed ${bad.length}\n`;
for (const r of bad) report += `\n===== ${r.file} (exit ${r.code})\n${r.out.split('\n').filter((l) => /FAIL|✗|not ok|Error|error|failed|expected|assert/i.test(l)).slice(0, 60).join('\n')}\n----- tail\n${r.out.split('\n').slice(-25).join('\n')}\n`;
writeFileSync(process.env.RUNALL_OUT || new URL('./runall.out.txt', import.meta.url), report + '\n' + results.map((r) => `${r.code === 0 ? 'PASS' : 'FAIL'} ${r.file}\n${r.out.split('\n').slice(-3).join('\n')}`).join('\n'));
console.log(report.split('\n')[0]);
for (const r of bad) console.log('FAILED', r.file);
process.exitCode = bad.length ? 1 : 0;

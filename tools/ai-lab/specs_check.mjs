// Checks that each computer-policy spec parses, before a run is queued on it: node tools/ai-lab/specs_check.mjs
// '<spec>' ... (run from app/). A spec is tactician:<skills>:<weights> with ONE colon between the parts, e.g.
// 'tactician:+clearLines:clearLines=4'; a spec that does not parse plays no game at all, so a run on it is lost.
import { loadEngine } from '../../app/tests/_engine.mjs';
import { policyOf } from '../../app/tests/_policies.mjs';

const { M } = await loadEngine('specscheck', ["export * as AI from '../src/ai/index';"]);
let bad = 0;
for (const s of process.argv.slice(2)) {
  try {
    const p = policyOf(M.AI, s);
    console.log(`ok   ${s} -> ${p.name}`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${s}: ${e.message}`);
  }
}
process.exitCode = bad ? 1 : 0;

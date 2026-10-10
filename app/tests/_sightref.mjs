// THE LINES OF SIGHT RECKONED A SECOND WAY, for the tests that hold rules.ts's
// walk to it (losexact.test.mjs, turn.test.mjs). The same 81 lines between the
// two Bases, but each filled cell's square clipped against each line
// (Liang-Barsky), its edges and corners included as 4.2.4's note has it; a line
// along a Grid's edge is read by the two cells either side ("in alignment with
// the edges" it obstructs nothing it merely runs beside). Not the walk's column
// by column way, so the two agree only by both being right. An Aerial end sees
// past everything but smoke; whether either unit stands in smoke is the
// caller's to ask, as rules.ts firingSight asks it.
export function reckonLines(M, a, b, terrain, tokens, smokeGrids) {
  const aerial = !!((a.aerial && !a.mine) || (b.aerial && !b.mine));
  if (aerial && !smokeGrids) return 'clear';
  const bA = M.TY.baseBox(a), bB = M.TY.baseBox(b);
  const inBases = (c, r) => [bA, bB].some((x) => c >= x.col && c < x.col + x.w && r >= x.row && r < x.row + x.h);
  const blocks = new Set(), fills = new Set(), smoky = new Set();
  if (!aerial) {
    for (const p of terrain) for (const c of p.subCells) { fills.add(`${c.col},${c.row}`); if (p.blocksLos) blocks.add(`${c.col},${c.row}`); }
    for (const t of tokens) {
      if (t.uid === a.uid || t.uid === b.uid || t.aerial) continue;
      for (const c of M.TY.baseCells(t)) { fills.add(`${c.col},${c.row}`); if (M.R.blocksAsTerrain(t)) blocks.add(`${c.col},${c.row}`); }
    }
  }
  if (smokeGrids) {
    for (const k of smokeGrids) {
      const [gc, gr] = k.split(',').map(Number);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) smoky.add(`${gc * 3 + i},${gr * 3 + j}`);
    }
  }
  const cells = [...new Set([...fills, ...smoky])].map((k) => k.split(',').map(Number)).filter(([c, r]) => !inBases(c, r));
  const pts = (x) => {
    const o = [];
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) o.push({ x: x.col + 0.08 + (i * (x.w - 0.16)) / 2, y: x.row + 0.08 + (j * (x.h - 0.16)) / 2 });
    return o;
  };
  const near = (v) => Math.abs(v - Math.round(v)) < 1e-9;
  let anySight = false, smokeTook = false, anyObstruct = false;
  for (const p of pts(bA)) for (const q of pts(bB)) {
    let blocked = false, obstruct = false, smoked = false;
    const upright = Math.abs(q.x - p.x) < 1e-9 && near(p.x);
    const flat = Math.abs(q.y - p.y) < 1e-9 && near(p.y);
    if (upright || flat) {
      const k = Math.round(upright ? p.x : p.y);
      const lo = Math.floor(Math.min(upright ? p.y : p.x, upright ? q.y : q.x));
      const hi = Math.ceil(Math.max(upright ? p.y : p.x, upright ? q.y : q.x));
      for (let m = lo; m < hi; m++) {
        const one = upright ? [k - 1, m] : [m, k - 1];
        const two = upright ? [k, m] : [m, k];
        if (inBases(...one) || inBases(...two)) continue;
        const both = (set) => set.has(one.join(',')) && set.has(two.join(','));
        if (both(blocks)) blocked = true;
        if (both(fills)) obstruct = true;
        if (both(smoky)) smoked = true;
      }
    } else {
      const x0 = Math.min(p.x, q.x) - 1, x1 = Math.max(p.x, q.x) + 1, y0 = Math.min(p.y, q.y) - 1, y1 = Math.max(p.y, q.y) + 1;
      for (const [c, r] of cells) {
        if (c < x0 || c > x1 || r < y0 || r > y1 || !meets(p, q, c, r, c + 1, r + 1)) continue;
        const key = `${c},${r}`;
        if (blocks.has(key)) blocked = true;
        if (fills.has(key)) obstruct = true;
        if (smoky.has(key)) smoked = true;
      }
    }
    if (!blocked && !smoked) anySight = true;
    if (!blocked && smoked) smokeTook = true;
    if (blocked || obstruct) anyObstruct = true;
  }
  if (!anySight) return smokeTook ? 'smoked' : 'blocked';
  return anyObstruct ? 'obstructed' : 'clear';
}

// Does the segment p->q meet the closed square [x0,x1]x[y0,y1] at all?
export function meets(p, q, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const P = [-dx, dx, -dy, dy], Q = [p.x - x0, x1 - p.x, p.y - y0, y1 - p.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(P[i]) < 1e-12) { if (Q[i] < -1e-9) return false; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1 + 1e-12) return false; if (r > t0) t0 = r; } else { if (r < t0 - 1e-12) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1 + 1e-12;
}

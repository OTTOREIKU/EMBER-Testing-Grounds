import { faceHtml } from '../src/combat';
import type { RollGroup } from '../src/combat';
import type { DiceData, DieColor } from '../src/types';
import { expandGlyphs } from '../src/glyphs';

// Dice rolled AT THE TABLE. Some players want the dice in their hand, and a
// pad beside a physical game has real dice on it anyway.
//
// HANDS-OFF FIRST (OTTO, 2026-09-18). "Table rolls" means the pad steps back:
// it says what to pick up and what to keep in mind, the table rolls and
// resolves, and the pad is told the outcome. Entering each die's face is the
// second door, for a player who wants the pad to do the sums - the window then
// works everything out from the faces as if it had rolled them itself. There
// is no "let the pad roll this one": that is what the Pad rolls setting is.

const COLOUR_NAME: Record<string, string> = { yellow: 'Yellow', red: 'Red', white: 'White', blue: 'Blue', black: 'Black' };
// The Black Die's part names against the slots a unit's Parts sit in.
const DIE_PART: Record<string, string> = { torso: 'torso', chasis: 'chassis', leftHand: 'leftArm', rightHand: 'rightArm', backpack: 'backpack' };

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// A die prints some faces more than once (four of a Red die's eight are the
// same Heavy Hit). A player is asked what the die SHOWS, so each look is
// offered once, standing for the first face that carries it.
function distinctFaces(dice: DiceData, color: string): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  (dice.dice[color as DieColor]?.faces ?? []).forEach((f, i) => {
    const key = JSON.stringify(f);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(i);
  });
  return out;
}

function poolChips(pool: Record<string, number>): string {
  return Object.entries(pool).filter(([, n]) => n > 0)
    .map(([c, n]) => `<span class="td-count die-${esc(c)}"><b>${n}</b> ${esc(COLOUR_NAME[c] ?? c)}</span>`).join('');
}

function poolLine(pool: Record<string, number>): string {
  return Object.entries(pool).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${COLOUR_NAME[c] ?? c}`).join(' · ');
}

// What to pick up, and what to keep in mind. "Rolled" leaves the dice to the
// table; "Enter the dice" opens the face entry. A pool of nothing answers
// itself.
// One colour's count as the blocks that make it: "4 + 2 terrain = 6". A
// colour with a single part is just its count.
function blockRow(b: { color: string; parts: { n: number; why?: string }[] }, total: number): string {
  const chip = (n: number, why: string | undefined, first: boolean): string =>
    // The sign travels with its block, so a wrapped row never strands a minus.
    `<span class="td-term">${first ? '' : `<span class="td-op">${n < 0 ? '−' : '+'}</span>`}<span class="td-count die-${esc(b.color)}${first ? '' : ' part'}"><b>${Math.abs(n)}</b>${why ? ` ${esc(why)}` : first ? ` ${esc(COLOUR_NAME[b.color] ?? b.color)}` : ''}</span></span>`;
  if (b.parts.length < 2) return `<div class="td-row"><span class="td-count die-${esc(b.color)}"><b>${total}</b> ${esc(COLOUR_NAME[b.color] ?? b.color)}</span></div>`;
  return `<div class="td-row">${b.parts.map((p, i) => chip(p.n, p.why, i === 0)).join('')}<span class="td-term"><span class="td-op">=</span><span class="td-count die-${esc(b.color)}"><b>${total}</b> ${esc(COLOUR_NAME[b.color] ?? b.color)}</span></span></div>`;
}

export function askTablePool(
  dice: DiceData, pool: Record<string, number>, label: string | undefined, watch: string[],
  blocks?: { color: string; parts: { n: number; why?: string }[] }[], groups?: RollGroup[],
): Promise<{ color: string; face: number }[] | 'rolled'> {
  const total = Object.values(pool).reduce((a, n) => a + (n ?? 0), 0);
  if (!total) return Promise.resolve([]);
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back td-back';
    back.innerHTML = `<div class="dlg-panel td-panel" role="dialog" aria-modal="true">
      <h3 class="dlg-title">${esc(label || 'Roll')}</h3>
      <div class="td-counts${blocks?.length ? ' rows' : ''}">${blocks?.length ? blocks.map((b) => blockRow(b, pool[b.color] ?? 0)).join('') : poolChips(pool)}</div>
      ${watch.length ? `<ul class="td-watch">${watch.map((w) => `<li>${expandGlyphs(esc(w))}</li>`).join('')}</ul>` : ''}
      <div class="dlg-actions">
        <button data-enter>Enter the dice</button>
        <button class="dlg-primary" data-rolled>Rolled</button>
      </div>
    </div>`;
    back.addEventListener('click', (ev) => {
      const t = ev.target as Element;
      if (t.closest('[data-rolled]')) { back.remove(); resolve('rolled'); return; }
      if (t.closest('[data-enter]')) {
        back.remove();
        void askTableRoll(dice, pool, label, groups).then((faces) => {
          // Backing out of the entry returns here rather than stranding the roll.
          if (faces === null) void askTablePool(dice, pool, label, watch, blocks, groups).then(resolve);
          else resolve(faces);
        });
      }
    });
    document.body.appendChild(back);
  });
}

// The face of every die in the pool, for a player who wants the sums done.
// null when they back out.
export function askTableRoll(dice: DiceData, pool: Record<string, number>, label?: string, groups?: RollGroup[]): Promise<{ color: string; face: number }[] | null> {
  const slots: { color: string; face: number | null }[] = [];
  for (const [color, n] of Object.entries(pool)) for (let i = 0; i < (n ?? 0); i++) slots.push({ color, face: null });
  if (!slots.length) return Promise.resolve([]);

  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back td-back';
    // Whose dice are whose, when one request rolls for two units: a heading
    // where each unit's dice begin, and the count starts again under it.
    const heads = new Map<number, string>();
    const within: number[] = [];
    if (groups && groups.reduce((a, g) => a + g.n, 0) === slots.length) {
      let at = 0;
      for (const g of groups) {
        if (g.n > 0) heads.set(at, `${g.label} · ${g.n}`);
        for (let k = 0; k < g.n; k++) within[at + k] = k + 1;
        at += g.n;
      }
    }

    const paint = (): void => {
      const left = slots.filter((s) => s.face === null).length;
      back.innerHTML = `<div class="dlg-panel td-panel" role="dialog" aria-modal="true">
        <h3 class="dlg-title">${esc(label || 'Roll')}</h3>
        <p class="td-pool">${esc(poolLine(pool))}</p>
        <div class="td-dice">${slots.map((s, i) => `${heads.has(i) ? `<p class="td-head">${esc(heads.get(i)!)}</p>` : ''}<div class="td-die">
          ${slots.length > 1 ? `<span class="td-n">${within[i] ?? i + 1}</span>` : ''}
          <div class="td-faces">${distinctFaces(dice, s.color).map((f) => `<button class="td-face die-${esc(s.color)}${s.face === f ? ' on' : ''}" data-die="${i}" data-face="${f}" aria-pressed="${s.face === f}">
            <span class="td-ic">${faceHtml(dice, s.color as DieColor, f)}</span>
          </button>`).join('')}</div>
        </div>`).join('')}</div>
        <div class="dlg-actions">
          <button data-back>Back</button>
          <button class="dlg-primary" data-ok${left ? ' disabled' : ''}>${left ? `${left} to go` : 'Enter'}</button>
        </div>
      </div>`;
    };

    back.addEventListener('click', (ev) => {
      const t = ev.target as Element;
      const face = t.closest<HTMLElement>('[data-face]');
      if (face) {
        slots[Number(face.dataset.die)].face = Number(face.dataset.face);
        const at = back.querySelector('.td-dice')?.scrollTop ?? 0;
        paint();
        const list = back.querySelector('.td-dice');
        if (list) list.scrollTop = at;
        return;
      }
      if (t.closest('[data-back]')) { back.remove(); resolve(null); return; }
      if (t.closest('[data-ok]') && slots.every((s) => s.face !== null)) {
        back.remove();
        resolve(slots.map((s) => ({ color: s.color, face: s.face ?? 0 })));
      }
    });

    paint();
    document.body.appendChild(back);
  });
}

// The Black Die at the table: not the die's faces but the TARGET'S OWN PARTS,
// by name, plus Any. The answer goes back as the die face that names that
// Part, so the window's own rules still run on it - a missing or destroyed
// Part falls to the Torso, Any hands the choice to the attacker, and the
// Black Die's Focus is still offered.
export function askTargetPart(
  dice: DiceData, target: string, parts: { slot: string; label: string; name: string; state: string }[],
): Promise<number> {
  const faces = dice.dice.black.faces;
  const faceOf = (part: string): number => Math.max(0, faces.findIndex((f) => (f[0]?.part ?? 'any') === part));
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back td-back';
    back.innerHTML = `<div class="dlg-panel td-panel" role="dialog" aria-modal="true">
      <h3 class="dlg-title">Black Die</h3>
      <p class="td-pool">${esc(target)}</p>
      <div class="td-parts">${parts.filter((p) => DIE_PART[p.slot]).map((p) => `<button class="td-partrow${p.state === 'destroyed' ? ' gone' : ''}" data-part="${esc(DIE_PART[p.slot])}">
          <b>${esc(p.label)}</b><span>${esc(p.name)}</span>${p.state !== 'intact' ? `<em>${esc(p.state)}</em>` : ''}
        </button>`).join('')}
        <button class="td-partrow" data-part="any"><b>Any</b><span>The attacker designates</span></button>
      </div>
    </div>`;
    back.addEventListener('click', (ev) => {
      const row = (ev.target as Element).closest<HTMLElement>('[data-part]');
      if (!row) return;
      back.remove();
      resolve(faceOf(row.dataset.part!));
    });
    document.body.appendChild(back);
  });
}

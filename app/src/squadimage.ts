// THE SQUAD AS ONE PICTURE (OTTO, 2026-11-12: "export how the right side of the
// squad page looks. It should be one PNG without the buttons ... and then it
// should embed the data for the parts into it so it can be imported in other
// places ... our own looking photo export that matches our current UI style").
//
// The picture is drawn straight onto a canvas, not photographed from the page:
// the page's buttons, hover states and lazy images would all leak into a
// screenshot. Colours and fonts are read from the page's own tokens, so the
// export follows ui.css when the style moves.
//
// The squad rides inside the PNG as a tEXt chunk keyed "TeamData", the same
// key and shape the builder site writes, so importer.ts (Tabletop, Pad) reads
// our images and theirs alike. Card ids are the contract; names and points are
// carried along for a reader that wants them.
import type { Card, MechLoadout } from './types';
import { assetUrl, cardImageUrl, cardName, isUnfolded, UNFOLDS_INTO, type GameData } from './data';
import { loadoutDice, type UnitDice } from './squadstore';
import { printsWide } from './images';
import { factionColour } from './icons';

export interface SquadImageMech {
  name: string;
  pilot: string;
  points: number;
  loadout: MechLoadout;
  layers: string[];
}

export interface SquadImage {
  id: string;
  name: string;
  faction: string | null;
  factionLabel: string;
  points: number;
  cap: number;
  issues: string[];
  mechs: SquadImageMech[];
  drones: { cardId: string; backpack?: string }[];
  tactics: string[];
  // The newest parts-list revision the data carries ('1.04'), so a reader can
  // tell an image built on old numbers (OTTO, 2026-11-12).
  dataVersion: string;
}

const SLOTS: { key: keyof MechLoadout; label: string }[] = [
  { key: 'torso', label: 'Torso' },
  { key: 'chasis', label: 'Chassis' },
  { key: 'leftHand', label: 'Left arm' },
  { key: 'rightHand', label: 'Right arm' },
  { key: 'backpack', label: 'Backpack' },
  { key: 'pilot', label: 'Pilot' },
];

// ---------- the embedded squad ----------

const ref = (d: GameData, id: string | undefined): Record<string, unknown> | undefined => {
  if (!id) return undefined;
  const c = d.byId.get(id);
  return { id, ...(c ? { name: cardName(c), score: c.score ?? 0 } : {}) };
};

export function teamData(d: GameData, s: SquadImage): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    ...(s.faction ? { faction: s.faction } : {}),
    mechs: s.mechs.map((m) => ({
      name: m.name,
      parts: Object.fromEntries(SLOTS.filter((x) => x.key !== 'pilot' && m.loadout[x.key]).map((x) => [x.key, ref(d, m.loadout[x.key])])),
      ...(m.loadout.pilot ? { pilot: ref(d, m.loadout.pilot) } : {}),
    })),
    drones: s.drones.map((x) => ({ ...ref(d, x.cardId), ...(x.backpack ? { backpack: ref(d, x.backpack) } : {}) })),
    tacticCards: s.tactics.map((id) => ref(d, id)),
    // Ours alone; the builder site ignores what it does not know.
    ember: { v: 1, cap: s.cap, points: s.points, ...(s.dataVersion ? { data: s.dataVersion } : {}) },
  };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The PNG with a "TeamData" tEXt chunk put in just before the image data. The
// text is UTF-8 (squad names are not Latin-1), as the builder site writes it.
export function withTeamData(png: Uint8Array, data: unknown): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const body = new Uint8Array([...enc.encode('TeamData'), 0, ...enc.encode(JSON.stringify(data))]);
  const type = enc.encode('tEXt');
  const chunk = new Uint8Array(12 + body.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, body.length);
  chunk.set(type, 4);
  chunk.set(body, 8);
  const forCrc = new Uint8Array(4 + body.length);
  forCrc.set(type, 0);
  forCrc.set(body, 4);
  dv.setUint32(8 + body.length, crc32(forCrc));
  // After IHDR (8 signature + 25 for the IHDR chunk).
  const at = 33;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

// THE CARDS THE SQUAD LAUNCHES (OTTO, 2026-11-12: "if I export a squad with
// the AC-6 rocket launcher it will also export a card image of the RA-81
// rocket"). Every card the squad fields lists what it can put on the board
// (card.projectile, the list the launch pickers draw from); each such card is
// shown once, in the order first met, leaving out a folded unit's Unfolded
// face, which is the same physical card turned over.
export function projectilesOf(d: GameData, s: Pick<SquadImage, 'mechs' | 'drones'>): string[] {
  const fielded = [
    ...s.mechs.flatMap((m) => SLOTS.map((k) => m.loadout[k.key]).filter((id): id is string => !!id)),
    ...s.drones.flatMap((x) => [x.cardId, ...(x.backpack ? [x.backpack] : [])]),
  ];
  const out: string[] = [];
  for (const id of fielded) {
    const list = d.byId.get(id)?.projectile;
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      const c = d.byId.get(p);
      if (c && !isUnfolded(c) && !out.includes(p) && !fielded.includes(p)) out.push(p);
    }
  }
  return out;
}

// ---------- the picture ----------

// One card on a Drones or Projectiles row, and the card drawn joined to it: a
// Carrier's Load, or a folded Pholcus's Unfolded side.
interface Unit { cardId: string; pair?: string; tag?: string }

// Wide enough for the mech's dice column between its plate and the Torso.
const W = 1920;
const PAD = 64;
const CARD_W = 206;
const CARD_H = Math.round((CARD_W * 700) / 480);
const GAP = 14;
const PLATE_W = 300;
const DICE_W = 100;
// A drone or projectile card is the same physical card turned on its side, so
// it is drawn as a part card's height wide (OTTO, 2026-11-12: "too large
// compared to the parts cards").
const WIDE_W = CARD_H;
const WIDE_H = Math.round((CARD_H * 514) / 700);

interface Look {
  bg: string; surface: string; surface2: string; line: string;
  text: string; text2: string; text3: string; accent: string; ok: string; warn: string;
  font: string; mono: string;
}

function look(faction: string | null): Look & { fac: string } {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const read = (v: string, fallback: string): string => {
    probe.style.color = fallback;
    probe.style.color = v;
    return getComputedStyle(probe).color || fallback;
  };
  const cs = getComputedStyle(document.documentElement);
  const font = (cs.getPropertyValue('--font').trim() || 'Inter, system-ui, sans-serif');
  const mono = (cs.getPropertyValue('--mono').trim() || 'ui-monospace, monospace');
  const l = {
    bg: read('var(--bg)', '#0d1117'),
    surface: read('var(--surface)', '#161b22'),
    surface2: read('var(--surface2)', '#1f2630'),
    line: read('var(--border)', '#2a313c'),
    text: read('var(--text)', '#e6edf3'),
    text2: read('var(--text2)', '#aab4c0'),
    text3: read('var(--text3)', '#6b7683'),
    accent: read('var(--accent)', '#f0b429'),
    ok: read('var(--green)', '#3fb950'),
    warn: read('var(--rdl)', '#e5534b'),
    fac: read(factionColour(faction), '#f0b429'),
    font, mono,
  };
  probe.remove();
  return l;
}

function loadImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

// The plate's cut corner (collectionpage.css .cl-plate clip-path).
function plate(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, cut: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - cut);
  g.lineTo(x + w - cut, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number): number {
  let cx = x;
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + track;
  }
  return cx - track;
}

function spacedWidth(g: CanvasRenderingContext2D, text: string, track: number): number {
  let w = 0;
  for (const ch of text) w += g.measureText(ch).width + track;
  return w - track;
}

function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function contain(g: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const s = Math.min(w / im.naturalWidth, h / im.naturalHeight);
  const dw = im.naturalWidth * s;
  const dh = im.naturalHeight * s;
  g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function grid(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string): void {
  g.save();
  g.strokeStyle = colour;
  g.globalAlpha = 0.35;
  g.lineWidth = 1;
  g.beginPath();
  for (let gx = x; gx <= x + w; gx += 22) { g.moveTo(gx + 0.5, y); g.lineTo(gx + 0.5, y + h); }
  for (let gy = y; gy <= y + h; gy += 22) { g.moveTo(x, gy + 0.5); g.lineTo(x + w, gy + 0.5); }
  g.stroke();
  g.restore();
}

function gauge(g: CanvasRenderingContext2D, L: Look & { fac: string }, x: number, y: number, w: number, points: number, cap: number): void {
  const cells = Math.round(cap / 50);
  const gap = 6;
  const cw = (w - gap * (cells - 1)) / cells;
  const filled = points / 50;
  const over = points > cap;
  for (let i = 0; i < cells; i++) {
    const cx = x + i * (cw + gap);
    g.save();
    g.beginPath();
    g.moveTo(cx + 5, y); g.lineTo(cx + cw, y); g.lineTo(cx + cw - 5, y + 12); g.lineTo(cx, y + 12); g.closePath();
    g.fillStyle = L.surface2;
    g.fill();
    if (i < filled) {
      g.clip();
      g.fillStyle = over ? L.warn : L.fac;
      g.fillRect(cx, y, cw * Math.min(1, filled - i), 12);
    }
    g.restore();
  }
}

async function drawCard(g: CanvasRenderingContext2D, L: Look, im: HTMLImageElement | null, x: number, y: number, w: number, h: number, label: string): Promise<void> {
  g.save();
  rr(g, x, y, w, h, 12);
  g.fillStyle = L.surface2;
  g.fill();
  if (im) {
    g.clip();
    contain(g, im, x + 6, y + 6, w - 12, h - 12);
  } else {
    g.fillStyle = L.text3;
    g.font = `500 15px ${L.mono}`;
    g.textAlign = 'center';
    g.fillText('No card', x + w / 2, y + h / 2);
  }
  g.restore();
  if (label) {
    g.fillStyle = L.text3;
    g.font = `600 13px ${L.mono}`;
    g.textAlign = 'left';
    spaced(g, label.toUpperCase(), x + 4, y + h + 24, 2.2);
  }
}

// Draws the squad and returns the PNG, with the squad inside it.
export async function squadImagePng(d: GameData, s: SquadImage): Promise<Blob> {
  const L = look(s.faction);
  await document.fonts?.ready;

  const cardsOf = (ids: { id: string; wide: boolean }[]): number => {
    let x = 0;
    let rows = 1;
    const max = W - PAD * 2;
    for (const c of ids) {
      const w = c.wide ? WIDE_W : CARD_W;
      if (x && x + w > max) { rows++; x = 0; }
      x += w + GAP;
    }
    return rows;
  };
  const wideOf = (id: string): boolean => {
    const c: Card | undefined = d.byId.get(id);
    return c ? printsWide(c) : false;
  };
  const extras = [
    { title: 'Drones', ids: s.drones.map((x) => x.cardId), units: s.drones.map((x): Unit => ({ cardId: x.cardId, ...(x.backpack ? { pair: x.backpack, tag: `LOAD +${d.byId.get(x.backpack)?.score ?? 0}P` } : {}) })) },
    // The folded Pholcus with its Unfolded side beside it, paired the way a
    // Load is (OTTO, 2026-11-17: "using the new load style to showcase both").
    { title: 'Projectiles', ids: projectilesOf(d, s), units: projectilesOf(d, s).map((id): Unit => { const u = UNFOLDS_INTO[id]; return { cardId: id, ...(u ? { pair: u, tag: 'UNFOLDED' } : {}) }; }) },
    { title: 'Tactics cards', ids: s.tactics },
  ].filter((x) => x.ids.length) as { title: string; ids: string[]; units?: Unit[] }[];

  // A Carrier Tarantula and its Load are one unit on the picture (OTTO,
  // 2026-11-17, design "B2"): the Load card to the right of the drone at the
  // drone's height, one faction-coloured border round both, and a LOAD +points
  // tag on top of the Load.
  // The paired card is drawn at the first card's height, upright or on its side.
  const pairW = (id: string, h: number): number => Math.round(wideOf(id) ? (h * 700) / 514 : (h * 480) / 700);
  const unitW = (u: Unit): number => {
    const wide = wideOf(u.cardId);
    const w = wide ? WIDE_W : CARD_W;
    return u.pair ? w + 6 + pairW(u.pair, wide ? WIDE_H : CARD_H) : w;
  };
  const unitRows = (us: Unit[]): number => {
    let x = 0;
    let rows = 1;
    for (const u of us) {
      const w = unitW(u);
      if (x && x + w > W - PAD * 2) { rows++; x = 0; }
      x += w + GAP;
    }
    return rows;
  };

  const HEAD = 250;
  const ROW = CARD_H + 2 * 24 + 34;
  const rowH = (ids: string[]): number => (ids.every(wideOf) ? WIDE_H : CARD_H);
  const extraH = extras.reduce((n, e) => n + 56 + (e.units ? unitRows(e.units) : cardsOf(e.ids.map((id) => ({ id, wide: wideOf(id) })))) * (rowH(e.ids) + 44), 0);
  const FOOT = 96;
  const H = HEAD + s.mechs.length * (ROW + 20) + extraH + FOOT;

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.textBaseline = 'alphabetic';

  // Every image at once; a missing one draws as an empty card, not a hole.
  const urls = new Set<string>();
  for (const m of s.mechs) {
    for (const k of SLOTS) if (m.loadout[k.key]) urls.add(cardImageUrl(m.loadout[k.key]!));
    m.layers.forEach((u) => urls.add(u));
  }
  extras.forEach((e) => e.ids.forEach((id) => urls.add(cardImageUrl(id))));
  extras.forEach((e) => e.units?.forEach((u) => { if (u.pair) urls.add(cardImageUrl(u.pair)); }));
  // The Dodge and Electronic symbols cut out of the card's stat plates
  // (2026-11-17), so they can be drawn large on the page's own panel.
  const ICON_DODGE = assetUrl('tokens/tab/glyph_dodge.png');
  const ICON_EW = assetUrl('tokens/tab/glyph_electronic.png');
  urls.add(ICON_DODGE);
  urls.add(ICON_EW);
  const imgs = new Map<string, HTMLImageElement | null>();
  await Promise.all([...urls].map(async (u) => imgs.set(u, await loadImg(u))));

  // A mech's blue (Dodge) and yellow (Electronic) dice, summed over its Parts
  // (OTTO, 2026-11-17, design "v2-1"): two cells stacked on the plate, each a
  // large symbol over its number. Drones are left without: their card prints
  // the same numbers and nothing changes them.
  const drawDice = (x: UnitDice, left: number, top: number, w: number, h: number): void => {
    const ch = (h - 6) / 2;
    ([[ICON_DODGE, String(x.dodge)], [ICON_EW, x.dash ? '–' : String(x.electronic)]] as const).forEach(([icon, n], k) => {
      const cy = top + k * (ch + 6);
      rr(g, left, cy, w, ch, 10);
      g.fillStyle = L.surface2;
      g.fill();
      const im = imgs.get(icon);
      if (im) {
        // Symbol and number centred together in the tile.
        const size = Math.min(w - 36, ch * 0.42);
        const fs = Math.round(Math.min(ch * 0.24, 40));
        const block = size + 10 + fs * 0.75;
        const y0 = cy + (ch - block) / 2;
        const f = Math.min(size / im.naturalWidth, size / im.naturalHeight);
        g.drawImage(im, left + (w - im.naturalWidth * f) / 2, y0 + (size - im.naturalHeight * f) / 2, im.naturalWidth * f, im.naturalHeight * f);
        g.fillStyle = L.text;
        g.font = `800 ${fs}px ${L.mono}`;
        g.textAlign = 'center';
        g.fillText(n, left + w / 2, y0 + size + 10 + fs * 0.75);
      }
    });
    g.textAlign = 'left';
  };

  // Page.
  g.fillStyle = L.bg;
  g.fillRect(0, 0, W, H);
  g.save();
  g.globalAlpha = 0.12;
  const gl = g.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, 900);
  gl.addColorStop(0, L.fac);
  gl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gl;
  g.fillRect(0, 0, W, 700);
  g.restore();
  // Corner brackets, as the page's frame.
  g.strokeStyle = L.accent;
  g.lineWidth = 3;
  for (const [cx, cy, dx, dy] of [[24, 24, 1, 1], [W - 24, 24, -1, 1], [24, H - 24, 1, -1], [W - 24, H - 24, -1, -1]]) {
    g.beginPath();
    g.moveTo(cx, cy + dy * 30); g.lineTo(cx, cy); g.lineTo(cx + dx * 30, cy);
    g.stroke();
  }

  // Header.
  let y = PAD + 30;
  g.font = `700 16px ${L.mono}`;
  g.fillStyle = L.accent;
  let x = spaced(g, 'SQUAD', PAD, y, 5);
  g.fillStyle = L.text3;
  spaced(g, '  //  EMBER', x, y, 5);

  y += 74;
  g.fillStyle = L.text;
  g.font = `700 62px ${L.font}`;
  g.fillText(fit(g, s.name, W - PAD * 2 - 520), PAD, y);

  y += 44;
  x = PAD;
  if (s.faction) {
    g.font = `700 17px ${L.mono}`;
    const tw = spacedWidth(g, s.factionLabel, 2) + 24;
    rr(g, x, y - 24, tw, 34, 8);
    g.save(); g.globalAlpha = 0.18; g.fillStyle = L.fac; g.fill(); g.restore();
    g.fillStyle = L.fac;
    spaced(g, s.factionLabel, x + 12, y, 2);
    x += tw + 16;
  }
  g.font = `600 18px ${L.mono}`;
  g.fillStyle = s.issues.length ? L.warn : L.ok;
  const legal = s.issues.length ? s.issues.join(' · ') : '✓ Legal';
  g.fillText(legal, x, y);
  x += g.measureText(legal).width + 20;
  // Which parts lists the numbers come from, as a chip beside the verdict.
  if (s.dataVersion) {
    g.font = `600 15px ${L.mono}`;
    const chip = `PARTS DATA ${s.dataVersion}`;
    const tw = spacedWidth(g, chip, 1.5) + 22;
    rr(g, x + 0.5, y - 23.5, tw, 32, 8);
    g.strokeStyle = L.line;
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = L.text2;
    spaced(g, chip, x + 11, y - 1, 1.5);
    x += tw + 20;
  }
  g.fillStyle = L.text3;
  g.font = `500 18px ${L.mono}`;
  const counts = `${s.mechs.length} mech${s.mechs.length === 1 ? '' : 's'}${s.drones.length ? ` · ${s.drones.length} drone${s.drones.length === 1 ? '' : 's'}` : ''}`;
  g.textAlign = 'left';
  g.fillText(counts, x, y);

  // Points, right.
  g.textAlign = 'right';
  g.font = `600 30px ${L.mono}`;
  g.fillStyle = L.text3;
  const capTxt = `/${s.cap}`;
  g.fillText(capTxt, W - PAD, PAD + 116);
  const capW = g.measureText(capTxt).width;
  g.font = `700 76px ${L.mono}`;
  g.fillStyle = s.points > s.cap ? L.warn : L.text;
  g.fillText(String(s.points), W - PAD - capW - 6, PAD + 116);
  g.textAlign = 'left';
  gauge(g, L, W - PAD - 460, PAD + 140, 460, s.points, s.cap);

  // Mechs.
  y = HEAD;
  for (const [i, m] of s.mechs.entries()) {
    const top = y;
    const h = ROW;
    rr(g, PAD, top, W - PAD * 2, h, 18);
    g.fillStyle = L.surface;
    g.fill();

    // The plate: grid, glow, the mech, its name.
    const px = PAD + 18;
    const py = top + 18;
    const ph = h - 36;
    g.save();
    plate(g, px, py, PLATE_W, ph, 12, 18);
    g.clip();
    g.fillStyle = L.surface2;
    g.fillRect(px, py, PLATE_W, ph);
    grid(g, px, py, PLATE_W, ph, L.line);
    g.globalAlpha = 0.28;
    const rg = g.createRadialGradient(px + PLATE_W / 2, py + ph * 0.62, 0, px + PLATE_W / 2, py + ph * 0.62, PLATE_W * 0.6);
    rg.addColorStop(0, L.fac);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(px, py, PLATE_W, ph);
    g.globalAlpha = 1;
    const artTop = py + 46;
    const artH = ph - 46 - 70;
    for (const u of m.layers) {
      const im = imgs.get(u);
      if (im) contain(g, im, px + 14, artTop, PLATE_W - 28, artH);
    }
    g.restore();
    g.font = `600 14px ${L.mono}`;
    g.fillStyle = L.text3;
    spaced(g, `MECH ${i + 1}`, px + 16, py + 30, 3);
    // The dice, stacked in their own column between the plate and the Torso.
    // As tall as a card and its slot label under it (the Collection's card +
    // Swap / Details row), the two tiles sharing it (OTTO, 2026-11-17).
    drawDice(loadoutDice(d, m.loadout), px + PLATE_W + 20, top + 24, DICE_W, CARD_H + 30);
    g.textAlign = 'right';
    g.font = `700 24px ${L.mono}`;
    g.fillStyle = L.text;
    g.fillText(`${m.points}`, px + PLATE_W - 34, py + 32);
    g.font = `600 16px ${L.mono}`;
    g.fillStyle = L.text3;
    g.fillText('p', px + PLATE_W - 20, py + 32);
    g.textAlign = 'left';
    g.font = `700 22px ${L.font}`;
    g.fillStyle = L.text;
    g.fillText(fit(g, m.name, PLATE_W - 32), px + 16, py + ph - 40);
    g.font = `600 13px ${L.mono}`;
    g.fillStyle = L.text3;
    g.save();
    spaced(g, fit(g, m.pilot ? `PILOT · ${m.pilot.toUpperCase()}` : 'NO PILOT', PLATE_W - 60), px + 16, py + ph - 16, 1.6);
    g.restore();

    // The six cards.
    let cx = px + PLATE_W + 20 + DICE_W + 20;
    const cy = top + 24;
    for (const k of SLOTS) {
      const id = m.loadout[k.key];
      await drawCard(g, L, id ? imgs.get(cardImageUrl(id)) ?? null : null, cx, cy, CARD_W, CARD_H, k.label);
      cx += CARD_W + GAP;
    }
    y += h + 20;
  }

  // Drones and tactics.
  for (const e of extras) {
    y += 20;
    g.font = `700 15px ${L.mono}`;
    g.fillStyle = L.accent;
    const ex = spaced(g, e.title.toUpperCase(), PAD, y + 6, 4);
    g.strokeStyle = L.line;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(ex + 18, y + 1); g.lineTo(W - PAD, y + 1); g.stroke();
    y += 36;
    let cx = PAD;
    const rh = rowH(e.ids);
    if (e.units) {
      for (const u of e.units) {
        const wide = wideOf(u.cardId);
        const w = wide ? WIDE_W : CARD_W;
        const h = wide ? WIDE_H : CARD_H;
        const uw = unitW(u);
        if (cx > PAD && cx + uw > W - PAD) { cx = PAD; y += rh + 44; }
        await drawCard(g, L, imgs.get(cardImageUrl(u.cardId)) ?? null, cx, y, w, h, '');
        if (u.pair) {
          const lw = pairW(u.pair, h);
          const lx = cx + w + 6;
          await drawCard(g, L, imgs.get(cardImageUrl(u.pair)) ?? null, lx, y, lw, h, '');
          rr(g, cx - 3, y - 3, uw + 6, h + 6, 14);
          g.strokeStyle = L.fac;
          g.lineWidth = 2.5;
          g.stroke();
          g.save();
          g.globalAlpha = 0.6;
          g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(lx - 3, y); g.lineTo(lx - 3, y + h); g.stroke();
          g.restore();
          g.font = `700 12px ${L.mono}`;
          const tag = u.tag ?? '';
          const tw = spacedWidth(g, tag, 1.6) + 16;
          rr(g, lx + (lw - tw) / 2, y - 14, tw, 24, 6);
          g.fillStyle = L.fac;
          g.fill();
          g.fillStyle = L.bg;
          g.textAlign = 'left';
          spaced(g, tag, lx + (lw - tw) / 2 + 8, y + 3, 1.6);
        }
        cx += uw + GAP;
      }
      y += rh + 44;
      continue;
    }
    for (const id of e.ids) {
      const wide = wideOf(id);
      const w = wide ? WIDE_W : CARD_W;
      if (cx > PAD && cx + w > W - PAD) { cx = PAD; y += rh + 44; }
      await drawCard(g, L, imgs.get(cardImageUrl(id)) ?? null, cx, y, w, wide ? WIDE_H : CARD_H, '');
      cx += w + GAP;
    }
    y += rh + 44;
  }

  // Footer.
  const fy = H - 52;
  g.strokeStyle = L.line;
  g.beginPath(); g.moveTo(PAD, fy - 34); g.lineTo(W - PAD, fy - 34); g.stroke();
  g.font = `700 16px ${L.mono}`;
  g.fillStyle = L.accent;
  spaced(g, 'EMBER', PAD, fy, 6);
  g.fillStyle = L.text3;
  g.font = `500 15px ${L.mono}`;
  g.fillText(`  ·  ${new Date().toISOString().slice(0, 10)}`, PAD + 96, fy);
  g.textAlign = 'right';
  g.fillText('Load this squad by importing this image', W - PAD, fy);
  g.textAlign = 'left';

  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
  if (!blob) throw new Error('The picture could not be made.');
  const png = withTeamData(new Uint8Array(await blob.arrayBuffer()), teamData(d, s));
  return new Blob([png], { type: 'image/png' });
}

export function squadImageName(name: string): string {
  return `${name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_') || 'squad'}.png`;
}

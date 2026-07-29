import { assetUrl } from './data';

export interface BoardTheme {
  id: string;
  name: string;
  night: boolean;
  base: string;
  minor: string;
  major: string;
  label: string;
  border: string;
  art?: (size: number) => string;
  image?: string;
}

// ---------- generators ----------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (t: number): number => t * t * (3 - 2 * t);

type Field = (x: number, y: number) => number;

function smoothField(seed: number, freq: number, size: number, ax = 1, ay = 1): Field {
  const r = rng(seed), n = freq + 2, g: number[][] = [];
  for (let y = 0; y <= n; y++) {
    g[y] = [];
    for (let x = 0; x <= n; x++) g[y][x] = r();
  }
  return (px, py) => {
    const fx = Math.min((px / size) * freq * ax, freq), fy = Math.min((py / size) * freq * ay, freq);
    const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy));
    const sx = ease(fx - x0), sy = ease(fy - y0);
    return lerp(lerp(g[y0][x0], g[y0][x0 + 1], sx), lerp(g[y0 + 1][x0], g[y0 + 1][x0 + 1], sx), sy);
  };
}

function blockField(seed: number, cells: number, size: number): Field {
  const r = rng(seed), g: number[][] = [];
  for (let y = 0; y <= cells; y++) {
    g[y] = [];
    for (let x = 0; x <= cells; x++) g[y][x] = r();
  }
  return (px, py) =>
    g[Math.min(cells, Math.floor((py / size) * cells))][Math.min(cells, Math.floor((px / size) * cells))];
}

function valleyField(seed: number, size: number): Field {
  const base = smoothField(seed, 4, size, 1, 2.2);
  return (px, py) => {
    const centre = size * 0.5 + Math.sin((px / size) * Math.PI * 1.6 + seed) * size * 0.18;
    const d = Math.abs(py - centre) / (size * 0.42);
    return Math.max(0, Math.min(1, (1 - d) * 0.72 + base(px, py) * 0.38));
  };
}

function compress(field: Field, lo: number, hi: number): Field {
  return (x, y) => lo + field(x, y) * (hi - lo);
}

function shards(seed: number, palette: string[], step: number, size: number, field: Field): string {
  const r = rng(seed), n = Math.ceil(size / step) + 1, pts: number[][][] = [];
  for (let y = 0; y <= n; y++) {
    pts[y] = [];
    for (let x = 0; x <= n; x++) {
      pts[y][x] = [x * step + (r() - 0.5) * step * 0.8, y * step + (r() - 0.5) * step * 0.8];
    }
  }
  let o = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = pts[y][x], b = pts[y][x + 1], c = pts[y + 1][x], d = pts[y + 1][x + 1];
      for (const t of [[a, b, d], [a, d, c]]) {
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
        const v = Math.max(0, Math.min(0.999,
          field(Math.max(0, Math.min(size - 1, cx)), Math.max(0, Math.min(size - 1, cy))) + (r() - 0.5) * 0.16));
        o += `<polygon points="${t.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="${
          palette[Math.floor(v * palette.length)]}"/>`;
      }
    }
  }
  return o;
}

function circuit(seed: number, size: number, trace: string, pad: string): string {
  const r = rng(seed), grid = 45;
  const steps = Math.floor(size / grid);
  let o = '';
  for (let i = 0; i < Math.round(size / 12); i++) {
    let x = Math.round(r() * steps) * grid, y = Math.round(r() * steps) * grid;
    let d = `M${x},${y}`;
    for (let k = 0; k < 3 + Math.floor(r() * 4); k++) {
      if (r() < 0.5) x += (r() < 0.5 ? -1 : 1) * grid;
      else y += (r() < 0.5 ? -1 : 1) * grid;
      d += `L${x},${y}`;
    }
    o += `<path d="${d}" fill="none" stroke="${trace}" stroke-width="1.1" stroke-linejoin="round"/>`;
    o += `<circle cx="${x}" cy="${y}" r="2.6" fill="${pad}"/>`;
  }
  return o;
}

function plates(seed: number, size: number, fills: string[], seam: string, rivet: string): string {
  const r = rng(seed), w = 120;
  let o = '';
  for (let y = 0; y < size; y += w) {
    for (let x = 0; x < size; x += w) {
      o += `<rect x="${x}" y="${y}" width="${w}" height="${w}" fill="${
        fills[Math.floor(r() * fills.length)]}" stroke="${seam}" stroke-width="1.4"/>`;
      for (const [dx, dy] of [[7, 7], [w - 7, 7], [7, w - 7], [w - 7, w - 7]]) {
        o += `<circle cx="${x + dx}" cy="${y + dy}" r="2" fill="${rivet}"/>`;
      }
    }
  }
  return o;
}

function canopy(seed: number, size: number, fills: string[]): string {
  const r = rng(seed);
  let o = '';
  for (let i = 0; i < Math.round(size * 3.3); i++) {
    o += `<circle cx="${(r() * size).toFixed(1)}" cy="${(r() * size).toFixed(1)}" r="${
      (8 + r() * 20).toFixed(1)}" fill="${fills[Math.floor(r() * fills.length)]}" opacity="0.55"/>`;
  }
  return o;
}

// ---------- themes ----------

const GREYS_DAY = ['#41474b', '#4b5155', '#565d61', '#61686d', '#6d7479', '#798085', '#858c91', '#929a9f'];
const GREYS_NIGHT = ['#101315', '#15191c', '#1b2023', '#21272b', '#272e33', '#2e363c', '#353e44', '#3c464d'];

const GRID_DAY = { minor: 'rgba(150,172,24,0.26)', major: 'rgba(178,201,26,0.68)', label: '#b6cc2c', border: 'rgba(178,201,26,0.6)' };
const GRID_NIGHT = { minor: 'rgba(168,190,26,0.16)', major: 'rgba(174,197,28,0.55)', label: '#8fa326', border: 'rgba(174,197,28,0.46)' };

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'slate', name: 'Slate (night)', night: true,
    base: '#191d21',
    minor: 'rgba(150,170,190,0.14)', major: 'rgba(165,185,205,0.5)', label: '#9fb2c4', border: 'rgba(165,185,205,0.4)',
  },
  {
    id: 'official', name: 'Official board', night: true,
    base: '#20241a',
    minor: 'transparent', major: 'transparent', label: '#b6cc2c', border: 'rgba(178,201,26,0.55)',
    image: 'boards/official-jungle.webp',
  },
  {
    id: 'classic', name: 'Classic', night: false,
    base: '#f4f1ea', minor: '#d8d2c4', major: '#8a8577', label: '#6b6558', border: '#57534e',
  },
  {
    id: 'valley', name: 'Faceted Valley', night: false,
    base: '#61686d', ...GRID_DAY,
    art: (s) => shards(11, GREYS_DAY, 26, s, valleyField(3, s)),
  },
  {
    id: 'valley-night', name: 'Faceted Valley (night)', night: true,
    base: '#191d20', ...GRID_NIGHT,
    art: (s) => shards(11, GREYS_NIGHT, 26, s, valleyField(3, s)),
  },
  {
    id: 'city', name: 'Faceted City', night: false,
    base: '#61686d', ...GRID_DAY,
    art: (s) => shards(17, GREYS_DAY, 26, s, compress(blockField(23, 9, s), 0.16, 0.7)),
  },
  {
    id: 'city-night', name: 'Faceted City (night)', night: true,
    base: '#191d20', ...GRID_NIGHT,
    art: (s) => shards(17, GREYS_NIGHT, 26, s, compress(blockField(23, 9, s), 0.16, 0.74)),
  },
  {
    id: 'trace', name: 'Trace Grid (night)', night: true,
    base: '#12171c',
    minor: 'rgba(90,200,190,0.16)', major: 'rgba(90,210,200,0.62)', label: '#5ec9c0', border: 'rgba(90,210,200,0.5)',
    art: (s) => circuit(3, s, 'rgba(84,196,186,0.30)', 'rgba(120,230,220,0.55)'),
  },
  {
    id: 'steel', name: 'Steel Deck (night)', night: true,
    base: '#2b3136',
    minor: 'rgba(200,215,225,0.14)', major: 'rgba(210,225,235,0.5)', label: '#b9c8d3', border: 'rgba(210,225,235,0.4)',
    art: (s) => plates(47, s, ['#2c3237', '#31383d', '#282e33', '#353c42'], 'rgba(15,18,20,0.55)', 'rgba(190,205,215,0.22)'),
  },
  {
    id: 'canopy', name: 'Canopy (night)', night: true,
    base: '#141c15',
    minor: 'rgba(190,215,150,0.15)', major: 'rgba(200,225,160,0.52)', label: '#b6cf93', border: 'rgba(200,225,160,0.42)',
    art: (s) => canopy(53, s, ['#1b2a1c', '#213322', '#182618', '#273b27', '#1e2f1f']),
  },
];

export const DEFAULT_BOARD = 'slate';

export function boardTheme(id: string | undefined | null): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}

// The faceted boards are a few thousand polygons, so they ship as one rasterised
// <image> rather than that many live nodes competing with pointer hit-testing.
export function boardArtUrl(theme: BoardTheme, size: number): string | null {
  if (theme.image) return assetUrl(theme.image);
  if (!theme.art) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" fill="${theme.base}"/>${theme.art(size)}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// A colour picker that looks like the rest of the app.
//
// It replaces <input type="color">, which hands the job to the operating
// system: on Windows that is still the dialog shipped with Windows 95, and no
// amount of CSS reaches inside it.
//
// The whole widget is a body-level popover placed from its anchor's rect, the
// same way the inspector popout works. It cannot live inside the dialog that
// opens it: that dialog scrolls and clips, and a picker that gets cut in half
// by its own parent is worse than the one being replaced.

// ---------- colour ----------

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Deliberately separate from clampGridColour in boards.ts. That one answers
// "what grid colour should the board use", and falls back to the board default;
// this one answers "is this text a colour at all", and says so. Same regex,
// different questions -- folding them together would drag board configuration
// into a generic widget, or a widget into the data layer.
export function normaliseHex(v: unknown): string | null {
  const m = HEX.exec(typeof v === 'string' ? v.trim().toLowerCase() : '');
  if (!m) return null;
  return `#${m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]}`;
}

export interface Hsv { h: number; s: number; v: number }

export function hexToHsv(hex: string): Hsv {
  const norm = normaliseHex(hex) ?? '#000000';
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  const to = (n: number): string => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// The grid colours every board used to carry, plus the neutrals a board most
// wants. Removing the per-theme palettes took Trace's teal and the official
// board's lime off the table; this is where they went, one click away.
export const GRID_PRESETS = [
  '#9fb2c4', '#e9eaec', '#6d7885', '#57534e',
  '#b6cc2c', '#f0b429', '#ea6d76', '#65a2d8',
  '#e1d07e', '#b39ddb', '#5ec9c0', '#b6cf93',
];

// ---------- the widget ----------

export interface ColourPickerOpts {
  anchor: HTMLElement;
  value: string;
  presets?: string[];
  // Every drag tick. Paint with this; do not save on it.
  onInput: (hex: string) => void;
  // A drag has ended, a swatch was clicked, a hex was typed. Save on this.
  onDone: (hex: string) => void;
  // The picker has gone. REQUIRED READING FOR ANY CALLER THAT KEEPS THE HANDLE
  // returned below: the picker closes itself on Escape, on an outside click and
  // when its anchor leaves the page, so a caller holding the close function to
  // implement a toggle is holding a stale one after every ordinary close -- and
  // the next click on the trigger is silently eaten re-closing nothing.
  onClose?: () => void;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// Drives a surface from pointer AND keyboard. `at` gets 0..1 co-ordinates.
function draggable(
  surface: HTMLElement,
  at: (x: number, y: number) => void,
  end: () => void,
  step: (dx: number, dy: number) => void,
): void {
  const from = (ev: PointerEvent): void => {
    const r = surface.getBoundingClientRect();
    at(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
  };
  surface.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    surface.setPointerCapture(ev.pointerId);
    from(ev);
    const move = (e: PointerEvent): void => from(e);
    const up = (e: PointerEvent): void => {
      // Captured on the surface, so these always land even when the pointer
      // has been dragged well outside the popover.
      surface.releasePointerCapture(e.pointerId);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', up);
      end();
    };
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
  });
  surface.addEventListener('keydown', (ev) => {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as
      Record<string, [number, number]>)[ev.key];
    if (!d) return;
    ev.preventDefault();
    step(d[0] * (ev.shiftKey ? 10 : 1), d[1] * (ev.shiftKey ? 10 : 1));
    end();
  });
}

export function openColourPicker(opts: ColourPickerOpts): () => void {
  const { anchor } = opts;
  // HSV IS THE STATE, not the hex. Round-tripping through the hex on every
  // change loses the hue the moment saturation or value reaches zero -- black
  // and white have no hue to read back -- and the dragged cursor jumps to red.
  const hsv = hexToHsv(normaliseHex(opts.value) ?? '#000000');
  const presets = opts.presets ?? GRID_PRESETS;

  const pop = document.createElement('div');
  pop.className = 'cp';
  pop.innerHTML = `
    <div class="cp-sv" tabindex="0" role="slider" aria-label="Saturation and brightness">
      <div class="cp-sv-white"></div>
      <div class="cp-sv-black"></div>
      <div class="cp-dot cp-sv-dot"></div>
    </div>
    <div class="cp-hue" tabindex="0" role="slider" aria-label="Hue"><div class="cp-dot cp-hue-dot"></div></div>
    <div class="cp-foot">
      <span class="cp-now"></span>
      <input class="cp-hex" type="text" spellcheck="false" maxlength="7" aria-label="Hex colour">
    </div>
    <div class="cp-presets">${
      presets.map((c) => `<button type="button" class="cp-chip" data-c="${c}" title="${c}" style="background:${c}"></button>`).join('')
    }</div>`;
  document.body.appendChild(pop);

  const sv = pop.querySelector<HTMLElement>('.cp-sv')!;
  const svDot = pop.querySelector<HTMLElement>('.cp-sv-dot')!;
  const hue = pop.querySelector<HTMLElement>('.cp-hue')!;
  const hueDot = pop.querySelector<HTMLElement>('.cp-hue-dot')!;
  const now = pop.querySelector<HTMLElement>('.cp-now')!;
  const hex = pop.querySelector<HTMLInputElement>('.cp-hex')!;

  // `typing` keeps the hex field from being overwritten mid-keystroke: the
  // field is the one control that is also an input, so redrawing it while
  // somebody is halfway through "#b6c" moves their caret.
  let typing = false;
  const draw = (): void => {
    const c = hsvToHex(hsv);
    sv.style.setProperty('--cp-hue', hsvToHex({ h: hsv.h, s: 1, v: 1 }));
    svDot.style.left = `${hsv.s * 100}%`;
    svDot.style.top = `${(1 - hsv.v) * 100}%`;
    svDot.style.background = c;
    hueDot.style.left = `${hsv.h * 100}%`;
    now.style.background = c;
    if (!typing) hex.value = c;
    return;
  };
  const live = (): void => { draw(); opts.onInput(hsvToHex(hsv)); };
  const done = (): void => opts.onDone(hsvToHex(hsv));

  draggable(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; live(); }, done,
    (dx, dy) => { hsv.s = clamp01(hsv.s + dx / 100); hsv.v = clamp01(hsv.v - dy / 100); live(); });
  draggable(hue, (x) => { hsv.h = x; live(); }, done,
    (dx) => { hsv.h = clamp01(hsv.h + dx / 360); live(); });

  hex.addEventListener('input', () => {
    typing = true;
    const c = normaliseHex(hex.value);
    if (!c) return;
    const next = hexToHsv(c);
    // Only the hue survives a grey: typing #000000 must not throw away the hue
    // the surfaces are still showing.
    hsv.h = next.s ? next.h : hsv.h;
    hsv.s = next.s;
    hsv.v = next.v;
    live();
  });
  const settle = (): void => {
    typing = false;
    draw();
    done();
  };
  hex.addEventListener('change', settle);
  hex.addEventListener('blur', settle);

  for (const chip of pop.querySelectorAll<HTMLElement>('.cp-chip')) {
    chip.addEventListener('click', () => {
      const next = hexToHsv(chip.dataset.c!);
      hsv.h = next.s ? next.h : hsv.h;
      hsv.s = next.s;
      hsv.v = next.v;
      live();
      done();
    });
  }

  // Placed from the anchor, flipping above it when there is no room below.
  const place = (): void => {
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(4, Math.min(a.left, window.innerWidth - w - 4))}px`;
    const below = a.bottom + 6;
    pop.style.top = `${below + h <= window.innerHeight - 4 ? below : Math.max(4, a.top - h - 6)}px`;
  };

  let shut = false;
  const close = (): void => {
    if (shut) return;
    shut = true;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', follow);
    document.removeEventListener('scroll', follow, true);
    pop.remove();
    opts.onClose?.();
  };
  function outside(ev: Event): void {
    const t = ev.target as Node;
    if (!pop.contains(t) && !anchor.contains(t)) close();
  }
  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape') return;
    // Swallowed, or the dialog underneath closes at the same time.
    ev.stopPropagation();
    ev.preventDefault();
    close();
  }
  // The anchor goes with the dialog that owns it. Without this the popover
  // outlives its own trigger and floats over an empty page.
  function follow(): void {
    if (!anchor.isConnected) close();
    else place();
  }
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', follow);
  document.addEventListener('scroll', follow, true);

  draw();
  place();
  sv.focus();
  return close;
}

import { isCardImageReady, loadCardImage } from './images';

let tip: HTMLDivElement | null = null;
let currentId: string | null = null;
let pinTo: HTMLElement | null = null;
let lastMove: MouseEvent | null = null;

// What a preview may pin itself beside instead of trailing the cursor.
const ANCHORS = '[data-tip-side], .dlg-panel, aside';

function ensureTip(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'card-tip';
    tip.innerHTML = '<img alt="">';
    document.body.appendChild(tip);
  }
  return tip;
}

function position(): void {
  if (!tip) return;
  const pad = 14;
  const w = tip.offsetWidth || 260;
  const h = tip.offsetHeight || 360;
  const clampY = (y: number) => Math.max(4, Math.min(y, window.innerHeight - h - 4));
  const anchor = pinTo?.closest(ANCHORS);
  const panel = anchor?.getBoundingClientRect();
  if (panel) {
    const right = panel.right + 10 + w <= window.innerWidth - 4 ? panel.right + 10 : null;
    // A layout that asks for the right keeps it there whether or not the
    // preview fits beside the panel: on a wide reading view there is no clear
    // space to find, and the card lying over the edge of it costs nothing —
    // it is pointer-transparent, and the row it came from stays lit.
    if ((anchor as HTMLElement).dataset.tipSide === 'right') {
      tip.style.left = `${right ?? Math.max(4, window.innerWidth - w - 8)}px`;
      tip.style.top = `${clampY(pinTo!.getBoundingClientRect().top)}px`;
      return;
    }
    // Otherwise beside it, left first: the panels this was built for sit
    // against the right of the window, so that is where the room is.
    const left = panel.left - w - 10 >= 4 ? panel.left - w - 10 : null;
    const outside = left ?? right;
    if (outside !== null) {
      tip.style.left = `${outside}px`;
      tip.style.top = `${clampY(pinTo!.getBoundingClientRect().top)}px`;
      return;
    }
  }
  const ev = lastMove;
  if (!ev) return;
  let x = ev.clientX + pad;
  if (x + w > window.innerWidth) x = ev.clientX - w - pad;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${clampY(ev.clientY + pad)}px`;
}

function hide(): void {
  currentId = null;
  pinTo = null;
  if (tip) tip.classList.remove('visible');
}

// For a caller that is about to remove the thing being hovered. The preview
// only ever hides on the next mouseover, so tearing its anchor out of the DOM
// would otherwise leave a card floating over the page until something else is
// pointed at.
export function hideTooltip(): void {
  hide();
}

export function installTooltip(): void {
  document.addEventListener('mouseover', (ev) => {
    const el = (ev.target as Element).closest?.('[data-tip-card],[data-tip-img]');
    if (!el) {
      if (currentId) hide();
      return;
    }
    const direct = (el as HTMLElement).dataset.tipImg;
    if (direct) {
      if (direct === currentId) return;
      currentId = direct;
      pinTo = (el as HTMLElement).closest(ANCHORS) ? (el as HTMLElement) : null;
      const t = ensureTip();
      const shown = t.querySelector('img')!;
      shown.src = direct;
      t.classList.add('visible');
      position();
      return;
    }
    const id = (el as HTMLElement).dataset.tipCard!;
    if (id === currentId) return;
    currentId = id;
    pinTo = (el as HTMLElement).closest(ANCHORS) ? (el as HTMLElement) : null;
    const t = ensureTip();
    const shown = t.querySelector('img')!;
    const src = loadCardImage(id);
    if (isCardImageReady(id)) {
      shown.src = src.src;
      t.classList.add('visible');
      position();
    } else {
      t.classList.remove('visible');
      src.onload = () => {
        if (currentId !== id) return;
        shown.src = src.src;
        t.classList.add('visible');
        position();
      };
      src.onerror = () => {
        if (currentId === id) hide();
      };
    }
  });
  document.addEventListener('mousemove', (ev) => {
    lastMove = ev;
    if (currentId && !pinTo) position();
  });
  document.addEventListener('scroll', () => {
    if (currentId && pinTo) position();
  }, true);
}

export { preloadCardImages as preloadCards } from './images';

import { isCardImageReady, loadCardImage } from './images';

let tip: HTMLDivElement | null = null;
let currentId: string | null = null;

function ensureTip(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'card-tip';
    tip.innerHTML = '<img alt="">';
    document.body.appendChild(tip);
  }
  return tip;
}

function position(ev: MouseEvent): void {
  if (!tip) return;
  const pad = 14;
  const w = 260;
  const h = tip.offsetHeight || 360;
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + w > window.innerWidth) x = ev.clientX - w - pad;
  if (y + h > window.innerHeight) y = Math.max(4, window.innerHeight - h - 4);
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hide(): void {
  currentId = null;
  if (tip) tip.classList.remove('visible');
}

export function installTooltip(): void {
  document.addEventListener('mouseover', (ev) => {
    const el = (ev.target as Element).closest?.('[data-tip-card]');
    if (!el) {
      if (currentId) hide();
      return;
    }
    const id = (el as HTMLElement).dataset.tipCard!;
    if (id === currentId) return;
    currentId = id;
    const t = ensureTip();
    const shown = t.querySelector('img')!;
    const src = loadCardImage(id);
    if (isCardImageReady(id)) {
      shown.src = src.src;
      t.classList.add('visible');
    } else {
      t.classList.remove('visible');
      src.onload = () => {
        if (currentId !== id) return;
        shown.src = src.src;
        t.classList.add('visible');
      };
      src.onerror = () => {
        if (currentId === id) hide();
      };
    }
  });
  document.addEventListener('mousemove', (ev) => {
    if (currentId) position(ev);
  });
}

export { preloadCardImages as preloadCards } from './images';

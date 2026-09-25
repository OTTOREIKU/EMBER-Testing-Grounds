import { mechPartUrl, portraitUrl, tabImageUrl } from './data';

// ---------- portraits and part art, filled after a paint ----------
//
// The renderers leave empty [data-portrait] and [data-partart] slots and this
// fills them. Its own small file so a page can have it without the whole card
// renderer: the tabletop's Mech builder needs this and nothing else from
// refcards.ts, which re-exports it for the pages that already import it there.
export function fillPortraits(root: HTMLElement, lazy: boolean): void {
  root.querySelectorAll<HTMLElement>('[data-portrait]').forEach((slot) => {
    if (slot.childElementCount) return;
    const img = document.createElement('img');
    img.src = portraitUrl(slot.dataset.portrait!);
    img.alt = '';
    if (lazy) img.loading = 'lazy';
    img.addEventListener('error', () => slot.classList.add('portrait-missing'), { once: true });
    slot.appendChild(img);
  });
  root.querySelectorAll<HTMLElement>('[data-partart]').forEach((slot) => {
    if (slot.childElementCount) return;
    const id = slot.dataset.partart!;
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    const sources = [mechPartUrl(id), tabImageUrl(id)];
    let next = 0;
    const advance = (): void => {
      if (next < sources.length) img.src = sources[next++];
      else slot.remove();
    };
    img.addEventListener('error', advance);
    advance();
    slot.appendChild(img);
  });
}

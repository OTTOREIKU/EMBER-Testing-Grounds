export interface InspectInfo {
  title: string;
  sub?: string;
  lines: string[];
}

const IDLE = '<p class="inspect-idle">Hover for details · click to pin so you can scroll.</p>';
let box: HTMLElement | null = null;
let pinnedKey: string | null = null;

// The board page keeps a permanent box in the bottom-left corner. The Match
// Centre has no room for one — the board fills the middle and the side panel is
// already full — so there the same InspectInfo lands in a popout beside
// whatever is being hovered. Every existing call site works unchanged; only
// where the words appear differs.
let floating = false;
let anchor: HTMLElement | SVGElement | null = null;

function el(): HTMLElement | null {
  if (box) return box;
  box = document.getElementById('inspect-box');
  if (box) return box;
  floating = true;
  box = document.createElement('div');
  box.id = 'inspect-pop';
  document.body.appendChild(box);
  watch();
  return box;
}

// A binding's guards read `floating`, so the mode must exist BEFORE the first
// guard runs — resolved lazily by the first render, the first hover of a
// session slipped past a `floating: false` binding and the leave guard then
// refused to clear what the enter should never have shown: a stuck box.
function ensureMode(): void {
  el();
}

// The popout stands beside a row inside a scrolling, re-rendering panel. A
// removed node fires no pointerleave, so without this a re-render mid-hover
// strands the box on screen; and a panel scrolled under the cursor walks the
// row away from it.
let watching = false;
function watch(): void {
  if (watching) return;
  watching = true;
  const sweep = (): void => {
    if (!floating || !box?.classList.contains('visible')) return;
    if (anchor && !(anchor as HTMLElement).isConnected) {
      pinnedKey = null;
      render(null, false);
      return;
    }
    place();
  };
  document.addEventListener('scroll', sweep, true);
  document.addEventListener('mouseover', sweep, true);
}

// Beside the panel the hovered thing lives in, never on top of it: the reader
// is looking at a row and wants the explanation next to it, not over it. Left
// first, because the panel this was built for sits against the right of the
// window; the cursor is the last resort.
function place(): void {
  const pop = box;
  if (!pop || !floating || !anchor) return;
  const panel = (anchor as HTMLElement).closest('.hudside, .combatpop, .dlg-panel, aside, .mc-stagepane');
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth || 300;
  const h = pop.offsetHeight || 200;
  const r = (panel ?? anchor).getBoundingClientRect();
  const left = r.left - w - 10 >= 4 ? r.left - w - 10
    : r.right + 10 + w <= window.innerWidth - 4 ? r.right + 10
    : Math.max(4, window.innerWidth - w - 8);
  pop.style.left = `${left}px`;
  // Top-aligned with the row, pulled back up if that would run off the bottom.
  pop.style.top = `${Math.max(4, Math.min(a.top, window.innerHeight - h - 4))}px`;
}

function render(info: InspectInfo | null, pinned: boolean): void {
  const target = el();
  if (!target) return;
  target.classList.toggle('pinned', pinned);
  if (!info) {
    // The floating one disappears rather than sitting there reading "hover for
    // details", which would be a box permanently in the way saying nothing.
    if (floating) {
      target.classList.remove('visible');
      target.innerHTML = '';
      return;
    }
    target.innerHTML = IDLE;
    return;
  }
  target.innerHTML = `<h4>${info.title}${pinned ? '<button class="inspect-unpin" title="Unpin (or press Esc)">✕</button>' : ''}</h4>
    ${info.sub ? `<p class="inspect-sub">${info.sub}</p>` : ''}
    <ul>${info.lines.filter(Boolean).map((l) => `<li>${l}</li>`).join('')}</ul>`;
  target.querySelector('.inspect-unpin')?.addEventListener('click', () => unpinInspect());
  if (pinned) target.scrollTop = 0;
  if (floating) {
    target.classList.add('visible');
    place();
  }
}

export function showInspect(info: InspectInfo | null): void {
  if (pinnedKey) return;
  render(info, false);
}

export function unpinInspect(): void {
  pinnedKey = null;
  render(null, false);
}

export function isInspectPinned(): boolean {
  return pinnedKey !== null;
}

export function pinInspect(key: string, info: InspectInfo): void {
  if (pinnedKey === key) {
    unpinInspect();
    return;
  }
  pinnedKey = key;
  render(info, true);
}

export interface LinkableMechanic {
  id: string;
  name: string;
  ref?: string;
  text: string;
}

export function linkMechanics(
  root: ParentNode,
  mechanics: LinkableMechanic[],
  opts?: { pin?: boolean; mark?: boolean; floating?: boolean },
): void {
  root.querySelectorAll<HTMLElement>('[data-mech]').forEach((node) => {
    const m = mechanics.find((x) => x.id === node.dataset.mech);
    if (!m) return;
    if (opts?.mark !== false) node.classList.add('mech-link');
    inspectOnHover(
      node,
      { title: m.name, sub: m.ref, lines: [m.text] },
      { pinKey: opts?.pin === false ? undefined : `mech:${m.id}`, floating: opts?.floating },
    );
  });
}

export function bindTips(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-tip]').forEach((node) => {
    if (node.dataset.tipBound) return;
    node.dataset.tipBound = '1';
    inspectOnHover(node, {
      title: node.dataset.tipTitle || node.textContent?.trim() || '',
      sub: node.dataset.tipSub,
      lines: node.dataset.tip!.split('|'),
    });
    node.removeAttribute('title');
  });
}

// `floating: false` means "the board page's box may have this, the popout may
// not". Used where a card IMAGE already answers the same hover: two panels
// stacked on each other is worse than either alone, and in the Match Centre the
// image is the more useful of the two. The board page has room for both, so
// nothing is lost there.
export function inspectOnHover(
  node: HTMLElement | SVGElement,
  info: InspectInfo,
  opts?: { pinKey?: string; floating?: boolean },
): void {
  const key = opts?.pinKey;
  const mayFloat = opts?.floating !== false;
  node.addEventListener('pointerenter', () => {
    ensureMode();
    if (floating && !mayFloat) return;
    // Remembered so the popout knows what to stand beside. Harmless on the
    // board page, which renders into its fixed box and never reads it.
    anchor = node;
    showInspect(info);
  });
  node.addEventListener('pointerleave', () => {
    ensureMode();
    if (!floating || mayFloat) showInspect(null);
  });
  if (!key) return;
  node.classList.add('inspect-pinnable');
  node.addEventListener('click', () => {
    ensureMode();
    // Pinning is just a hover that stays, so a binding the hover declines is
    // declined here too.
    if (floating && !mayFloat) return;
    if (pinnedKey === key) {
      unpinInspect();
    } else {
      pinnedKey = key;
      render(info, true);
    }
  });
}

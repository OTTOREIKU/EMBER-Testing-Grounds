export interface InspectInfo {
  title: string;
  sub?: string;
  lines: string[];
}

const IDLE = '<p class="inspect-idle">Hover for details · click to pin so you can scroll.</p>';
let box: HTMLElement | null = null;
let pinnedKey: string | null = null;

function el(): HTMLElement | null {
  if (!box) box = document.getElementById('inspect-box');
  return box;
}

function render(info: InspectInfo | null, pinned: boolean): void {
  const target = el();
  if (!target) return;
  target.classList.toggle('pinned', pinned);
  if (!info) {
    target.innerHTML = IDLE;
    return;
  }
  target.innerHTML = `<h4>${info.title}${pinned ? '<button class="inspect-unpin" title="Unpin (or press Esc)">✕</button>' : ''}</h4>
    ${info.sub ? `<p class="inspect-sub">${info.sub}</p>` : ''}
    <ul>${info.lines.filter(Boolean).map((l) => `<li>${l}</li>`).join('')}</ul>`;
  target.querySelector('.inspect-unpin')?.addEventListener('click', () => unpinInspect());
  if (pinned) target.scrollTop = 0;
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
  opts?: { pin?: boolean; mark?: boolean },
): void {
  root.querySelectorAll<HTMLElement>('[data-mech]').forEach((node) => {
    const m = mechanics.find((x) => x.id === node.dataset.mech);
    if (!m) return;
    if (opts?.mark !== false) node.classList.add('mech-link');
    inspectOnHover(
      node,
      { title: m.name, sub: m.ref, lines: [m.text] },
      opts?.pin === false ? undefined : { pinKey: `mech:${m.id}` },
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

export function inspectOnHover(node: HTMLElement | SVGElement, info: InspectInfo, opts?: { pinKey?: string }): void {
  const key = opts?.pinKey;
  node.addEventListener('pointerenter', () => showInspect(info));
  node.addEventListener('pointerleave', () => showInspect(null));
  if (!key) return;
  node.classList.add('inspect-pinnable');
  node.addEventListener('click', () => {
    if (pinnedKey === key) {
      unpinInspect();
    } else {
      pinnedKey = key;
      render(info, true);
    }
  });
}

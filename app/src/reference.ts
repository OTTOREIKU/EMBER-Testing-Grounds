import './reference.css';
import { actionIconUrl, cardName, loadData, missionImageUrl, portraitUrl, statIconUrl, zeroCostReason, type GameData, type KeywordDef } from './data';
import { mountCardImage, preloadCardImages } from './images';
import type { Card } from './types';

type Tab = 'keywords' | 'parts' | 'units' | 'pilots' | 'tactics' | 'missions' | 'rules';

const SLOT_LABEL: Record<string, string> = {
  torso: 'Torso',
  chasis: 'Chassis',
  leftHand: 'Left arm',
  rightHand: 'Right arm',
  backpack: 'Backpack',
};

const STAT_FIELDS: [keyof Card, string][] = [
  ['score', 'Points'],
  ['armor', 'Armor'],
  ['structure', 'Structure'],
  ['parray', 'Parry'],
  ['dodge', 'Dodge'],
  ['electronic', 'Electronic'],
  ['move', 'Move'],
];

interface Facet {
  id: string;
  label: string;
  match: (c: Card) => boolean;
}

const PART_FACETS: Facet[] = [
  { id: 'torso', label: 'Torso', match: (c) => c.type === 'torso' },
  { id: 'chasis', label: 'Chassis', match: (c) => c.type === 'chasis' },
  { id: 'leftHand', label: 'Left arm', match: (c) => c.type === 'leftHand' },
  { id: 'rightHand', label: 'Right arm', match: (c) => c.type === 'rightHand' },
  { id: 'backpack', label: 'Backpack', match: (c) => c.type === 'backpack' },
];

const UNIT_FACETS: Facet[] = [
  { id: 'drone', label: 'Drones', match: (c) => c.category === 'drone' },
  { id: 'projectile', label: 'Projectiles', match: (c) => c.category === 'projectile' },
  { id: 'small', label: 'Small', match: (c) => c.type === 'small' },
  { id: 'medium', label: 'Medium', match: (c) => c.type === 'medium' },
  { id: 'large', label: 'Large', match: (c) => c.type === 'large' },
];

const PILOT_FACETS: Facet[] = [
  { id: 'RDL', label: 'RDL', match: (c) => c.faction === 'RDL' },
  { id: 'UN', label: 'UN', match: (c) => c.faction === 'UN' },
  { id: 'GOF', label: 'GOF', match: (c) => c.faction === 'GOF' },
  { id: 'PD', label: 'PD', match: (c) => c.faction === 'PD' },
];

function facetsFor(t: Tab): Facet[] {
  if (t === 'parts') return PART_FACETS;
  if (t === 'units') return UNIT_FACETS;
  if (t === 'pilots') return PILOT_FACETS;
  return [];
}

let data: GameData;
let tab: Tab = 'keywords';
let query = '';
const facetChoice: Partial<Record<Tab, string>> = {};

const body = () => document.getElementById('ref-body')!;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const norm = (s: string) => s.toLowerCase();

let linkPatterns: { name: string; re: RegExp }[] | null = null;

function linkKeywords(text: string): string {
  const src = esc(text);
  if (!linkPatterns) {
    const seen = new Set<string>();
    linkPatterns = [];
    for (const k of data.keywords) {
      const n = k.en?.name?.replace(/^[•·\s]+/, '') ?? '';
      if (n.length < 3 || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      const body = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\bX\b/g, '\\d+');
      try {
        linkPatterns.push({ name: n, re: new RegExp(`\\b${body}\\b`, 'gi') });
      } catch {
      }
    }
    linkPatterns.sort((a, b) => b.name.length - a.name.length);
  }

  const hits: { start: number; end: number; label: string }[] = [];
  for (const { name, re } of linkPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!hits.some((h) => start < h.end && end > h.start)) hits.push({ start, end, label: name });
    }
  }
  if (!hits.length) return src;

  hits.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const h of hits) {
    out += src.slice(at, h.start);
    out += `<a class="kw-link" data-kw="${esc(h.label)}">${src.slice(h.start, h.end)}</a>`;
    at = h.end;
  }
  return out + src.slice(at);
}

function keywordCard(k: KeywordDef): string {
  const name = k.en?.name?.replace(/^[•·\s]+/, '') || k.key;
  const val = k.en?.value || '';
  const isTag = /tag on the card banner/.test(val);
  return `<article class="card card-tap" data-kwitem="${esc(name)}">
    <div class="card-title">${esc(name)}</div>
    <div class="card-body">${val ? linkKeywords(val) : '<em>No English glossary text for this keyword.</em>'}</div>
    <div class="card-foot">
      ${isTag ? '<span class="tag">type tag</span>' : '<span class="tag">keyword</span>'}
    </div>
  </article>`;
}

function kwLabel(k: { key?: string; en?: string; inline?: string }): string {
  const def = data.keyword(k.key || k.inline || k.en || '');
  const label = def?.en?.name?.replace(/^[•·\s]+/, '');
  const raw = (k.en || k.inline || k.key || '').replace(/^[•·\s]+/, '');
  if (!label) return raw;
  const num = /(\d+)\s*$/.exec(raw)?.[1];
  if (!num) return label;
  if (/\bX\b/.test(label)) return label.replace(/\bX\b/, num);
  return /\d/.test(label) ? label : `${label} ${num}`;
}

function pointsChip(c: Card): string {
  if (c.score) return `<span class="mono card-pts">${c.score}p</span>`;
  const why = zeroCostReason(c);
  return why ? `<span class="card-pts card-free" title="${esc(why)}">free</span>` : '';
}

function cardRow(c: Card): string {
  const slot = c.type && SLOT_LABEL[c.type] ? SLOT_LABEL[c.type] : c.type || '';
  const stats: string[] = [];
  if (typeof c.armor === 'number' && c.armor) stats.push(`A${c.armor}`);
  if (typeof c.structure === 'number' && c.structure) stats.push(`S${c.structure}`);
  if (typeof c.dodge === 'number' && c.dodge) stats.push(`D${c.dodge}`);
  if (typeof c.electronic === 'number' && c.electronic) stats.push(`E${c.electronic}`);
  if (typeof c.move === 'number' && c.move) stats.push(`M${c.move}`);
  const acts = (c.actions ?? []).map((a) => a.name.en || a.name.zh || '').filter(Boolean).slice(0, 3);
  const actIcons = [...new Set((c.actions ?? []).map((a) => a.type).filter(Boolean))]
    .map((t) => ({ t, url: actionIconUrl(t) }))
    .filter((x) => x.url)
    .map((x) => `<img class="act-icon" src="${x.url}" alt="" title="${esc(String(x.t))}">`)
    .join('');
  const kws = [...new Set((c.keywords ?? []).map(kwLabel).filter(Boolean))].slice(0, 3);
  const isPilot = c.category === 'pilot';
  const isTactic = c.category === 'tactics_or_upgrade';
  const body = isPilot
    ? `${c.faction ?? ''}${c.trait ? ' · has a trait ability' : ''}`
    : isTactic
      ? 'Tap to read the card. The rules text lives on the scan, not in the card data.'
      : acts.join(' · ');
  return `<article class="card card-tap${isPilot ? ' card-pilot' : ''}" data-card="${esc(c.id)}">
    ${isPilot ? `<div class="pilot-thumb" data-portrait="${esc(c.id)}"></div>` : ''}
    <div class="card-main">
      <div class="card-title">${esc(cardName(c))}</div>
      ${body ? `<div class="card-body">${esc(body)}</div>` : ''}
      <div class="card-foot">
        ${slot ? `<span class="tag">${esc(slot)}</span>` : ''}
        ${actIcons ? `<span class="act-icons">${actIcons}</span>` : ''}
        ${isPilot && typeof c.LV === 'number' ? `<span class="tag mono">Link ${c.LV}</span>` : ''}
        ${stats.length ? `<span class="mono card-stats">${esc(stats.join(' '))}</span>` : ''}
        ${pointsChip(c)}
      </div>
      ${kws.length ? `<div class="card-badges">${kws.map((k) => `<span class="tag tag-kw">${esc(k)}</span>`).join('')}</div>` : ''}
    </div>
  </article>`;
}

function cardDetail(c: Card): string {
  const chip = (field: string, value: unknown, label: string) => {
    const ic = statIconUrl(field);
    return `<span>${ic ? `<img class="stat-icon" src="${ic}" alt="">` : ''}<b>${value}</b>${label}</span>`;
  };
  const stats = STAT_FIELDS.filter(([f]) => typeof c[f] === 'number')
    .map(([f, label]) => chip(f as string, c[f], label))
    .join('');
  const pilotStats =
    c.category === 'pilot'
      ? (['LV', 'swift', 'melee', 'projectile', 'firing', 'moving', 'tactic'] as const)
          .filter((f) => typeof c[f] === 'number')
          .map((f) => chip(f, c[f], f === 'LV' ? 'Link' : f))
          .join('')
      : '';
  const kws = [...new Set((c.keywords ?? []).map(kwLabel).filter(Boolean))]
    .map((label) => `<a class="kw-link" data-kw="${esc(label)}">${esc(label)}</a>`)
    .join('');
  const actions = (c.actions ?? [])
    .map((a) => {
      const dice = [a.redDice ? `${a.redDice}R` : '', a.yellowDice ? `${a.yellowDice}Y` : ''].filter(Boolean).join('+');
      const meta = [a.type, a.range === 0 ? 'R --' : a.range ? `R ${a.range}` : '', dice, a.storage ? `Ammo ${a.storage}` : '']
        .filter(Boolean)
        .join(' · ');
      const rawEn = a.description?.en?.trim();
      const en = rawEn && !/[぀-ヿ一-鿿]/.test(rawEn) ? rawEn : undefined;
      const tr = data.actionTranslation(a.id);
      let text = '';
      if (en) text = linkKeywords(en);
      else if (tr?.english) text = `${linkKeywords(tr.english)}<em class="ref-note"> — translated from the Chinese card text</em>`;
      else text = '<em class="ref-note">No rules text on this card.</em>';
      const mechs = data.mechanicsFor(a.name.en, a.name.zh, en, tr?.english ?? undefined);
      const mechHtml = mechs
        .map((m) => `<p class="ref-mech"><b>${esc(m.name)}</b>${m.ref ? ` <em>(${esc(m.ref)})</em>` : ''}: ${linkKeywords(m.text)}</p>`)
        .join('');
      const icon = actionIconUrl(a.type);
      return `<div class="ref-action">
        <h4>${icon ? `<img class="act-icon" src="${icon}" alt="" title="${esc(a.type ?? '')}">` : ''}${esc(a.name.en || a.name.zh || a.id)}</h4>
        <p class="ref-meta">${esc(meta)}</p>
        <p>${text.replace(/\n/g, '<br>')}</p>
        ${mechHtml}
      </div>`;
    })
    .join('');
  const trait =
    c.trait || c.traitDescription
      ? `<div class="ref-trait"><b>Pilot Trait${c.trait ? ` <i>${esc(c.trait)}</i>` : ''}</b><p>${linkKeywords(
          c.traitDescription?.en || c.traitDescription?.zh || '',
        )}</p></div>`
      : '';
  const boxes = (c.containedIn ?? [])
    .map((b) => data.boxes.find((x) => x.key === b.box))
    .filter(Boolean)
    .map((b) => esc(b!.name.en || b!.name.zh || b!.key))
    .join(', ');

  const free = zeroCostReason(c);
  return `<h2>${esc(cardName(c))}</h2>
    <p class="ref-meta">${esc([c.category, c.type, c.faction].filter(Boolean).join(' · '))}</p>
    ${c.category === 'pilot' ? `<div class="ref-portrait" data-portrait="${esc(c.id)}"></div>` : ''}
    <div class="ref-cardimg-slot" data-img="${esc(c.id)}"></div>
    ${free ? `<p class="ref-free">Costs 0 points — ${esc(free)}.</p>` : ''}
    ${stats || pilotStats ? `<div class="ref-stats">${stats}${pilotStats}</div>` : ''}
    ${kws ? `<div class="ref-kwlinks">${kws}</div>` : ''}
    ${trait}
    ${actions ? `<h3 class="ref-sub">Actions</h3>${actions}` : ''}
    ${boxes ? `<p class="ref-boxes">In: ${boxes}</p>` : ''}`;
}

function render(): void {
  const q = norm(query.trim());
  const el = body();

  if (tab === 'keywords') {
    const list = data.keywords
      .filter((k) => {
        if (!q) return true;
        return norm(`${k.en?.name ?? ''} ${k.en?.value ?? ''} ${k.key} ${k.zh?.name ?? ''}`).includes(q);
      })
      .sort((a, b) => (a.en?.name || a.key).localeCompare(b.en?.name || b.key));
    el.innerHTML = list.length
      ? `<p class="ref-count">${list.length} keyword${list.length === 1 ? '' : 's'}</p>${list.map(keywordCard).join('')}`
      : '<p class="ref-count">No matches</p>';
    return;
  }

  if (tab === 'missions') {
    const fam = new Map(data.missions.families.map((f) => [f.id, f]));
    const cards = data.missions.cards.filter(
      (m) => !q || norm(`${m.name} ${m.nameKo ?? ''} ${m.setup} ${m.scoring} ${(m.zones ?? []).join(' ')}`).includes(q),
    );
    const fams = data.missions.families.filter(
      (f) => !q || norm(`${f.name} ${f.text} ${(f.faq ?? []).map((x) => x.q + x.a).join(' ')}`).includes(q),
    );
    if (!cards.length && !fams.length) {
      el.innerHTML = '<p class="ref-count">No matches</p>';
      return;
    }
    el.innerHTML =
      `<p class="ref-count">${cards.length} main task${cards.length === 1 ? '' : 's'}</p>` +
      cards
        .map((m) => {
          const f = fam.get(m.family);
          return `<article class="card">
            <div class="card-title">${esc(m.name)}</div>
            ${m.nameKo ? `<div class="ref-note">${esc(m.nameKo)}</div>` : ''}
            <button class="mis-thumb" data-mission="${esc(m.id)}" title="Tap for the full card, including where the terrain and objectives sit">
              <img src="${missionImageUrl(m.id)}" alt="${esc(m.name)} card" loading="lazy">
              <span>Tap to enlarge</span>
            </button>
            <div class="card-body">
              <p><b>Setup.</b> ${esc(m.setup)}</p>
              <p><b>Scoring.</b> ${esc(m.scoring)}</p>
              ${m.deployment ? `<p><b>Deployment.</b> ${esc(m.deployment)}</p>` : ''}
            </div>
            <div class="card-badges">
              ${f ? `<span class="tag tag-kw">${esc(f.name)}</span>` : ''}
              ${typeof m.vp === 'number' ? `<span class="tag mono">${m.vp} VP</span>` : ''}
              ${(m.zones ?? []).map((z) => `<span class="tag">${esc(z)}</span>`).join('')}
              ${m.inRulebook ? '<span class="tag mono">in rulebook</span>' : ''}
            </div>
          </article>`;
        })
        .join('') +
      (fams.length ? '<p class="ref-count">How each mission type works</p>' : '') +
      fams
        .map(
          (f) => `<article class="card">
            <div class="card-title">${esc(f.name)}${f.nameKo ? ` <span class="ref-note">${esc(f.nameKo)}</span>` : ''}</div>
            <div class="card-body">${linkKeywords(f.text).replace(/\n/g, '<br>')}</div>
            ${(f.faq ?? []).length
              ? `<div class="mis-faq">${(f.faq ?? [])
                  .map((x) => `<p><b>Q.</b> ${esc(x.q)}<br><b>A.</b> ${esc(x.a)}</p>`)
                  .join('')}</div>`
              : ''}
          </article>`,
        )
        .join('');
    return;
  }

  if (tab === 'rules') {
    const p = data.play;
    const hit = (s: string) => !q || norm(s).includes(q);
    const phases = p.phases.filter((x) => hit(`${x.name} ${x.who ?? ''} ${x.can.join(' ')} ${x.cannot.join(' ')}`));
    const timings = p.timings.filter((x) => hit(`${x.name} timing ${x.text}`));
    const stances = p.stances.filter((x) => hit(`${x.name} ${x.short} stance ${x.effect} ${x.good} ${x.cost}`));
    const filtered = data.mechanics.filter((m) => !q || norm(`${m.name} ${m.text} ${m.ref ?? ''}`).includes(q));

    const phaseHtml = phases.length
      ? `<p class="ref-count">Round phases</p>` +
        phases
          .map(
            (x) => `<article class="card">
              <div class="card-title"><span class="play-num">${x.order}</span>${esc(x.name)}</div>
              ${x.who ? `<div class="ref-note">${esc(x.who)}</div>` : ''}
              <div class="card-body">
                <p class="play-can"><b>You can</b></p><ul>${x.can.map((l) => `<li>${linkKeywords(l)}</li>`).join('')}</ul>
                <p class="play-cant"><b>You cannot</b></p><ul>${x.cannot.map((l) => `<li>${linkKeywords(l)}</li>`).join('')}</ul>
              </div>
              ${x.ref ? `<div class="card-foot"><span class="tag mono">${esc(x.ref)}</span></div>` : ''}
            </article>`,
          )
          .join('')
      : '';

    const timingHtml = timings.length
      ? `<p class="ref-count">Action timings, in the order they resolve</p>` +
        timings
          .map(
            (x) => `<article class="card">
              <div class="card-title"><span class="play-num">${x.order}</span>${esc(x.name)} Timing</div>
              <div class="card-body">${linkKeywords(x.text)}</div>
            </article>`,
          )
          .join('') +
        (p.timingNotes && !q
          ? `<article class="card"><div class="card-title">How timings work</div>
              <div class="card-body"><ul>${p.timingNotes.lines.map((l) => `<li>${linkKeywords(l)}</li>`).join('')}</ul></div>
              ${p.timingNotes.ref ? `<div class="card-foot"><span class="tag mono">${esc(p.timingNotes.ref)}</span></div>` : ''}
            </article>`
          : '')
      : '';

    const stanceHtml = stances.length
      ? `<p class="ref-count">Stances</p>` +
        stances
          .map(
            (x) => `<article class="card">
              <div class="card-title">${esc(x.name)} <span class="tag mono">${esc(x.short)}</span></div>
              <div class="card-body">
                <p>${linkKeywords(x.effect)}</p>
                <p class="play-can"><b>Use it when</b> ${linkKeywords(x.good)}</p>
                <p class="play-cant"><b>Trade-off</b> ${linkKeywords(x.cost)}</p>
              </div>
              ${x.ref ? `<div class="card-foot"><span class="tag mono">${esc(x.ref)}</span></div>` : ''}
            </article>`,
          )
          .join('') +
        (p.stanceNotes && !q
          ? `<article class="card"><div class="card-title">Choosing a stance</div>
              <div class="card-body"><ul>${p.stanceNotes.lines.map((l) => `<li>${linkKeywords(l)}</li>`).join('')}</ul></div>
              ${p.stanceNotes.ref ? `<div class="card-foot"><span class="tag mono">${esc(p.stanceNotes.ref)}</span></div>` : ''}
            </article>`
          : '')
      : '';

    const head = phaseHtml + timingHtml + stanceHtml;
    if (!filtered.length && !head) {
      el.innerHTML = '<p class="ref-count">No matches</p>';
      return;
    }
    el.innerHTML =
      head +
      (filtered.length
        ? `<p class="ref-count">${filtered.length} mechanic${filtered.length === 1 ? '' : 's'}</p>` +
        filtered
          .map(
            (m) => `<article class="card">
              <div class="card-title">${esc(m.name)}</div>
              <div class="card-body">${linkKeywords(m.text)}</div>
              ${m.ref ? `<div class="card-foot"><span class="tag mono">${esc(m.ref)}</span></div>` : ''}
            </article>`,
          )
          .join('')
        : '');
    return;
  }

  const want =
    tab === 'parts'
      ? (c: Card) => c.category === 'mech_part'
      : tab === 'units'
        ? (c: Card) => c.category === 'drone' || c.category === 'projectile'
        : tab === 'tactics'
          ? (c: Card) => c.category === 'tactics_or_upgrade'
          : (c: Card) => c.category === 'pilot';

  const pool = data.cards.filter(want).filter((c) => {
    if (!q) return true;
    const kw = (c.keywords ?? []).map((k) => k.en || k.inline || k.key).join(' ');
    const acts = (c.actions ?? []).map((a) => `${a.name.en ?? ''} ${a.description?.en ?? ''}`).join(' ');
    return norm(`${cardName(c)} ${c.id} ${c.type ?? ''} ${kw} ${acts}`).includes(q);
  });

  const facets = facetsFor(tab);
  const chosen = facetChoice[tab];
  const active = facets.find((f) => f.id === chosen);
  const list = pool.filter((c) => !active || active.match(c)).sort((a, b) => cardName(a).localeCompare(cardName(b)));

  const chips = facets.length
    ? `<div class="ref-facets">
        <button class="ref-facet${active ? '' : ' active'}" data-facet="">All <span class="fc-n">${pool.length}</span></button>
        ${facets
          .map((f) => {
            const n = pool.filter(f.match).length;
            return `<button class="ref-facet${active?.id === f.id ? ' active' : ''}${n ? '' : ' empty'}" data-facet="${f.id}"${n ? '' : ' disabled'}>${esc(f.label)} <span class="fc-n">${n}</span></button>`;
          })
          .join('')}
      </div>`
    : '';

  el.innerHTML =
    chips +
    (list.length
      ? `<p class="ref-count">${list.length} card${list.length === 1 ? '' : 's'}</p>${list.map(cardRow).join('')}`
      : '<p class="ref-count">No matches</p>');

  el.querySelectorAll<HTMLButtonElement>('.ref-facet').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.facet ?? '';
      facetChoice[tab] = id || undefined;
      render();
      body().scrollTop = 0;
    }),
  );
  fillPortraits(el, true);
}

function fillPortraits(root: HTMLElement, lazy: boolean): void {
  root.querySelectorAll<HTMLElement>('[data-portrait]').forEach((slot) => {
    if (slot.childElementCount) return;
    const img = document.createElement('img');
    img.src = portraitUrl(slot.dataset.portrait!);
    img.alt = '';
    if (lazy) img.loading = 'lazy';
    img.addEventListener('error', () => slot.classList.add('portrait-missing'), { once: true });
    slot.appendChild(img);
  });
}

interface DetailView {
  kind: 'card' | 'keyword';
  key: string;
  scroll?: number;
}

let navStack: DetailView[] = [];

const sheet = () => document.getElementById('ref-detail')!;
const sheetScroller = () => sheet().querySelector('.ref-detail-inner') as HTMLElement;

function viewHtml(v: DetailView): string | null {
  if (v.kind === 'card') {
    const c = data.byId.get(v.key);
    return c ? cardDetail(c) : null;
  }
  return keywordDetail(v.key);
}

function viewLabel(v: DetailView): string {
  if (v.kind === 'card') return cardName(data.byId.get(v.key));
  const def = data.keyword(v.key);
  return def?.en?.name?.replace(/^[•·\s]+/, '') || v.key;
}

function navigateDetail(kind: DetailView['kind'], rawKey: string): void {
  const key = kind === 'keyword' ? data.keyword(rawKey)?.key ?? rawKey : rawKey;
  const v: DetailView = { kind, key };
  const html = viewHtml(v);
  if (html === null) return;

  if (sheet().hidden) {
    navStack = [];
  } else {
    const top = navStack[navStack.length - 1];
    if (top && top.kind === kind && top.key === key) return;
    const under = navStack[navStack.length - 2];
    if (under && under.kind === kind && under.key === key) return backDetail();
    if (top) top.scroll = sheetScroller().scrollTop;
  }
  navStack.push(v);
  paintDetail(html, 0);
}

function backDetail(): void {
  if (navStack.length < 2) return closeDetail();
  navStack.pop();
  const prev = navStack[navStack.length - 1];
  const html = viewHtml(prev);
  if (html === null) return closeDetail();
  paintDetail(html, prev.scroll ?? 0);
}

function paintDetail(html: string, scrollTop: number): void {
  const content = document.getElementById('ref-detail-content')!;
  content.innerHTML = html;
  content.querySelectorAll<HTMLElement>('[data-img]').forEach((slot) => mountCardImage(slot, slot.dataset.img!, 'ref-cardimg'));
  fillPortraits(content, false);
  sheet().hidden = false;
  document.body.classList.add('ref-locked');
  sheetScroller().scrollTop = scrollTop;

  const back = document.getElementById('ref-detail-back') as HTMLButtonElement;
  const prev = navStack.length >= 2 ? navStack[navStack.length - 2] : null;
  back.hidden = !prev;
  const label = prev ? `Back to ${viewLabel(prev)}` : 'Back';
  back.title = label;
  back.setAttribute('aria-label', label);
}

function closeDetail(): void {
  sheet().hidden = true;
  document.body.classList.remove('ref-locked');
  navStack = [];
}

function showMissionImage(id: string): void {
  const card = data.missions.cards.find((m) => m.id === id);
  document.querySelector('.mis-lightbox')?.remove();
  const box = document.createElement('div');
  box.className = 'mis-lightbox';
  box.innerHTML = `<div class="mis-lightbox-inner">
      <button class="mis-close" title="Close">✕</button>
      <img src="${missionImageUrl(id)}" alt="${esc(card?.name ?? id)} card">
      <p>${esc(card?.name ?? id)}${card?.nameKo ? ` · ${esc(card.nameKo)}` : ''}</p>
    </div>`;
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('ref-locked');
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    close();
  };
  box.addEventListener('click', (ev) => {
    if (ev.target === box || (ev.target as HTMLElement).closest('.mis-close')) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
  document.body.classList.add('ref-locked');
}

function keywordDetail(name: string): string | null {
  const def = data.keyword(name);
  if (!def) return null;
  const label = def.en?.name?.replace(/^[•·\s]+/, '') || def.key;
  const users = data.cards
    .filter((c) =>
      [...(c.keywords ?? []), ...((c.actions ?? []).flatMap((a) => a.keywords ?? []))].some(
        (k) => data.keyword(k.key || k.inline || k.en || '')?.key === def.key,
      ),
    )
    .slice(0, 40);
  return `<h2>${esc(label)}</h2>
    <p class="ref-meta">Keyword — rulebook glossary</p>
    <p>${def.en?.value ? linkKeywords(def.en.value) : '<em>No English glossary text.</em>'}</p>
    ${users.length ? `<h3 class="ref-sub">Appears on ${users.length}${users.length === 40 ? '+' : ''} card(s)</h3>
      <div class="ref-userlist">${users.map((c) => `<a class="ref-userlink" data-card="${esc(c.id)}">${esc(cardName(c))}</a>`).join('')}</div>` : ''}`;
}

async function init(): Promise<void> {
  data = await loadData();
  preloadCardImages(data.cards.map((c) => c.id));

  document.querySelectorAll<HTMLButtonElement>('#ref-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('#ref-tabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      tab = b.dataset.tab as Tab;
      render();
      window.scrollTo({ top: 0 });
    }),
  );

  const search = document.getElementById('ref-search') as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });

  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const kw = t.closest<HTMLElement>('[data-kw]');
    if (kw) {
      ev.preventDefault();
      navigateDetail('keyword', kw.dataset.kw!);
      return;
    }
    const kwItem = t.closest<HTMLElement>('[data-kwitem]');
    if (kwItem && tab === 'keywords') {
      navigateDetail('keyword', kwItem.dataset.kwitem!);
      return;
    }
    const mis = t.closest<HTMLElement>('[data-mission]');
    if (mis) {
      ev.preventDefault();
      showMissionImage(mis.dataset.mission!);
      return;
    }
    const card = t.closest<HTMLElement>('[data-card]');
    if (card) navigateDetail('card', card.dataset.card!);
  });

  document.getElementById('ref-detail-back')!.addEventListener('click', backDetail);
  document.getElementById('ref-detail-close')!.addEventListener('click', closeDetail);
  document.getElementById('ref-detail')!.addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) closeDetail();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeDetail();
  });

  render();
}

init().catch((e) => {
  body().innerHTML = `<p class="ref-count">Failed to load: ${esc(String(e))}</p>`;
});

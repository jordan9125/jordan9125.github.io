// content/의 JSON을 HTML 조각으로 바꾸는 순수 함수들입니다.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const plain = (rich) => (rich || []).map((r) => r.t).join('');

const TEXT_COLORS = { red: 'c-red', blue: 'c-blue', purple: 'c-purple', green: 'c-green', brown: 'c-brown', pink: 'c-pink' };

function inline(seg, ctx) {
  let h = esc(seg.t).replace(/\n/g, '<br>');
  if (seg.code) h = `<code>${h}</code>`;
  if (seg.b) h = `<strong>${h}</strong>`;
  if (seg.i) h = `<em>${h}</em>`;
  if (seg.u) h = `<u>${h}</u>`;
  if (seg.s) h = `<s>${h}</s>`;
  const c = seg.color;
  if (c) {
    // 노션의 주황·노랑 글씨는 형광펜, 회색 글씨는 작은 혼잣말로 보여줍니다.
    if (c === 'orange' || c === 'yellow' || c === 'orange_background' || c === 'yellow_background') h = `<mark>${h}</mark>`;
    else if (c === 'gray') h = `<span class="aside">${h}</span>`;
    else if (c.endsWith('_background')) h = `<mark class="bg-${c.replace('_background', '')}">${h}</mark>`;
    else if (TEXT_COLORS[c]) h = `<span class="${TEXT_COLORS[c]}">${h}</span>`;
  }
  if (seg.href) {
    if (seg.href.startsWith('notion:')) {
      const url = ctx.link(seg.href.slice(7));
      if (url) h = `<a href="${esc(url)}">${h}</a>`;
    } else {
      h = `<a href="${esc(seg.href)}" rel="noopener" target="_blank">${h}</a>`;
    }
  }
  return h;
}

export const rich = (segs, ctx) => (segs || []).map((s) => inline(s, ctx)).join('');

// 인용문 맨 앞의 "(마태복음1:1)" 같은 출처를 작은 라벨로 바꿉니다.
export function scriptureRefs(html) {
  return html.replace(/(^|<br>|<p>)\s*\(([^()<>]{1,24}?\s?\d{1,3}:\d{1,3}(?:\s?[-~]\s?\d{1,3})?)\)\s*/g, (_, pre, ref) => `${pre}<span class="ref">${ref.trim()}</span>`)
    .replace(/<span class="ref">([^<]*)<\/span>(?!<br>)/g, '<span class="ref">$1</span><br>');
}

const CHAPTER = /\d+\s*장\s*$/;

function headingParts(segs, ctx) {
  const t = plain(segs).trim();
  const m = /^(.{1,30}?)\s+:\s+(.+)$/.exec(t);
  if (m && !(segs || []).some((s) => s.href)) return `${esc(m[1])} <span class="sub">${esc(m[2])}</span>`;
  return rich(segs, ctx);
}

export function headingNumber(segs) {
  const t = plain(segs).trim();
  const m = /^(\d{1,2})\s*[.)]\s*(.+)$/.exec(t);
  return m ? { n: m[1], text: m[2] } : null;
}

function pageCards(group, ctx) {
  const items = group.map((b) => ({ b, url: ctx.link(b.page), title: ctx.title(b.page) || b.title })).filter((x) => x.url);
  if (!items.length) return '';
  if (items.length >= 3 && items.filter((x) => CHAPTER.test(x.title)).length >= Math.max(3, items.length - 2)) {
    const lead = items.filter((x) => !CHAPTER.test(x.title));
    const chapters = items.filter((x) => CHAPTER.test(x.title));
    return (lead.length ? `<div class="page-list">${lead.map((x) => listItem(x)).join('')}</div>` : '') +
      `<p class="label">장별 읽기</p><div class="chapters">${chapters.map((x) => {
        const n = /(\d+)\s*장\s*$/.exec(x.title)[1];
        return `<a href="${esc(x.url)}" aria-label="${esc(x.title)}"><strong>${n}</strong><span>장</span></a>`;
      }).join('')}</div>`;
  }
  return `<div class="page-list">${items.map((x) => listItem(x)).join('')}</div>`;
}

const chevron = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const listItem = (x) => `<a class="row" href="${esc(x.url)}"><span>${esc(x.title)}</span>${chevron}</a>`;

export function blocks(list, ctx) {
  const out = [];
  const items = list || [];
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    const group = (type) => { const g = [b]; while (items[i + 1]?.type === type) g.push(items[++i]); return g; };
    switch (b.type) {
      case 'bulleted_list_item':
      case 'numbered_list_item':
      case 'to_do': {
        const g = group(b.type);
        const tag = b.type === 'numbered_list_item' ? 'ol' : 'ul';
        out.push(`<${tag}${b.type === 'to_do' ? ' class="todo"' : ''}>${g.map((x) => `<li${x.type === 'to_do' ? ` class="${x.checked ? 'done' : ''}"` : ''}>${rich(x.text, ctx)}${blocks(x.children, ctx)}</li>`).join('')}</${tag}>`);
        break;
      }
      case 'child_page':
        out.push(pageCards(group('child_page'), ctx));
        break;
      case 'paragraph': {
        const h = rich(b.text, ctx);
        if (h.trim()) out.push(`<p>${h}</p>`);
        if (b.children?.length) out.push(`<div class="indent">${blocks(b.children, ctx)}</div>`);
        break;
      }
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
      case 'heading_4': {
        const level = Math.min(4, Number(b.type.slice(-1)) + 1);
        const id = ctx.headingId ? ctx.headingId(b) : '';
        const num = level === 2 ? headingNumber(b.text) : null;
        const inner = num ? `<span class="num">${num.n.padStart(2, '0')}</span>${esc(num.text)}` : headingParts(b.text, ctx);
        const h = `<h${level}${id ? ` id="${id}"` : ''}>${inner}</h${level}>`;
        out.push(b.toggle ? `<details class="toggle"><summary>${h}</summary>${blocks(b.children, ctx)}</details>` : h);
        break;
      }
      case 'quote':
        out.push(`<blockquote>${scriptureRefs(rich(b.text, ctx) + blocks(b.children, ctx))}</blockquote>`);
        break;
      case 'callout': {
        const txt = rich(b.text, ctx);
        out.push(`<aside class="callout${b.color ? ' ' + esc(b.color.replace('_background', '')) : ''}">${txt.trim() ? `<p>${txt}</p>` : ''}${blocks(b.children, ctx)}</aside>`);
        break;
      }
      case 'toggle':
        out.push(`<details class="toggle"><summary>${rich(b.text, ctx)}</summary>${blocks(b.children, ctx)}</details>`);
        break;
      case 'code':
        out.push(`<pre><code>${esc(plain(b.text))}</code></pre>`);
        break;
      case 'equation':
        out.push(`<p class="equation"><code>${esc(plain(b.text))}</code></p>`);
        break;
      case 'divider':
        out.push('<hr>');
        break;
      case 'image': {
        const src = b.src?.local ? ctx.base + 'media/' + b.src.local : b.src?.external;
        if (!src || !(b.src.local || /^https:/i.test(src))) break;
        const cap = plain(b.caption).trim();
        out.push(`<figure><img src="${esc(src)}" alt="${esc(cap)}" loading="lazy" decoding="async">${cap ? `<figcaption>${rich(b.caption, ctx)}</figcaption>` : ''}</figure>`);
        break;
      }
      case 'link': {
        let host = '';
        try { host = new URL(b.url).hostname.replace(/^www\./, ''); } catch { break; }
        const cap = plain(b.caption).trim() || b.name || b.url;
        out.push(`<a class="bookmark" href="${esc(b.url)}" rel="noopener" target="_blank"><span>${esc(cap)}</span><small>${esc(host)}</small></a>`);
        break;
      }
      case 'page_link': {
        const url = ctx.link(b.page);
        if (url) out.push(`<div class="page-list">${listItem({ url, title: ctx.title(b.page) })}</div>`);
        break;
      }
      case 'table': {
        const rows = (b.children || []).filter((r) => r.type === 'table_row');
        const body = rows.map((r, ri) => `<tr>${(r.cells || []).map((c, ci) => {
          const th = (b.header && ri === 0) || (b.rowHeader && ci === 0);
          return `<${th ? 'th' : 'td'}>${rich(c, ctx)}</${th ? 'th' : 'td'}>`;
        }).join('')}</tr>`).join('');
        out.push(`<div class="table-wrap"><table>${body}</table></div>`);
        break;
      }
      case 'column_list':
        out.push(`<div class="columns">${(b.children || []).map((c) => `<div>${blocks(c.children, ctx)}</div>`).join('')}</div>`);
        break;
      case 'column':
      case 'synced_block':
        out.push(blocks(b.children, ctx));
        break;
      default:
        break;
    }
  }
  return out.join('\n');
}

// 글 안의 텍스트 길이(읽는 시간 계산·검색용)
export function textOf(list) {
  let s = '';
  const walk = (bs) => { for (const b of bs || []) { if (b.text) s += plain(b.text) + '\n'; if (b.cells) s += b.cells.map(plain).join(' ') + '\n'; walk(b.children); } };
  walk(list);
  return s;
}

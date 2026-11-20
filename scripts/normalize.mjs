// Notion API 응답을 사이트가 쓰는 단순한 JSON으로 바꿉니다.
// 이 파일은 네트워크를 쓰지 않는 순수 함수만 담습니다.

const COLORS = new Set([
  'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
  'gray_background', 'brown_background', 'orange_background', 'yellow_background', 'green_background',
  'blue_background', 'purple_background', 'pink_background', 'red_background',
]);

export const cleanId = (id) => String(id || '').replace(/-/g, '').toLowerCase();

// 노션 링크(https://www.notion.so/...-<32자리 id>)에서 페이지 id를 꺼냅니다.
export function notionIdFromUrl(href) {
  if (typeof href !== 'string') return null;
  if (href.startsWith('/')) href = 'https://www.notion.so' + href;
  let url;
  try { url = new URL(href); } catch { return null; }
  if (!/(^|\.)notion\.(so|site|com)$/.test(url.hostname)) return null;
  const last = (url.pathname.split('/').filter(Boolean).pop() || '').replace(/-/g, '');
  const m = /([0-9a-f]{32})$/i.exec(last);
  return m ? cleanId(m[1]) : null;
}

const safeHref = (href) => {
  if (typeof href !== 'string') return null;
  const page = notionIdFromUrl(href);
  if (page) return 'notion:' + page;
  return /^(https?:|mailto:)/i.test(href) ? href : null;
};

export function richText(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    const a = r.annotations || {};
    let t = r.plain_text ?? r.text?.content ?? '';
    let href = safeHref(r.href ?? r.text?.link?.url);
    if (r.type === 'mention') {
      const m = r.mention || {};
      if (m.type === 'page' && m.page?.id) href = 'notion:' + cleanId(m.page.id);
      else if (m.type === 'link_preview' || m.type === 'link_mention') href = safeHref(m.link_preview?.url ?? m.link_mention?.href) || href;
      else if (m.type === 'user') t = t.replace(/^@/, '');
    }
    if (r.type === 'equation') t = r.equation?.expression ?? t;
    if (!t) continue;
    const seg = { t };
    if (a.bold) seg.b = 1;
    if (a.italic) seg.i = 1;
    if (a.underline) seg.u = 1;
    if (a.strikethrough) seg.s = 1;
    if (a.code || r.type === 'equation') seg.code = 1;
    if (a.color && a.color !== 'default' && COLORS.has(a.color)) seg.color = a.color;
    if (href) seg.href = href;
    const prev = out[out.length - 1];
    const same = prev && ['b', 'i', 'u', 's', 'code', 'color', 'href'].every((k) => prev[k] === seg[k]);
    if (same) prev.t += seg.t; else out.push(seg);
  }
  return out;
}

export const plain = (rich) => (rich || []).map((r) => r.t).join('');

const color = (c) => (c && c !== 'default' && COLORS.has(c) ? c : undefined);

function fileRef(obj) {
  if (!obj) return null;
  if (obj.type === 'external' && obj.external?.url) return { external: obj.external.url };
  if (obj.type === 'file' && obj.file?.url) return { notionFile: obj.file.url };
  return null;
}

// 블록 하나를 변환합니다. children은 호출하는 쪽에서 채웁니다.
// 반환값이 null이면 사이트에 싣지 않는 블록입니다.
export function block(b) {
  const type = b.type;
  const v = b[type] || {};
  const base = { id: cleanId(b.id), type };
  const withText = () => ({ ...base, text: richText(v.rich_text), ...(color(v.color) ? { color: v.color } : {}) });
  switch (type) {
    case 'paragraph':
    case 'quote':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'toggle':
      return withText();
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'heading_4':
      return { ...withText(), ...(v.is_toggleable ? { toggle: 1 } : {}) };
    case 'to_do':
      return { ...withText(), checked: !!v.checked };
    case 'callout': {
      const icon = v.icon?.type === 'emoji' ? v.icon.emoji : undefined;
      return { ...withText(), ...(icon ? { icon } : {}) };
    }
    case 'code':
      return { ...base, text: richText(v.rich_text), language: v.language || '', caption: richText(v.caption) };
    case 'equation':
      return { ...base, text: [{ t: v.expression || '', code: 1 }] };
    case 'divider':
    case 'column_list':
    case 'column':
    case 'synced_block':
    case 'table_row':
      return type === 'table_row' ? { ...base, cells: (v.cells || []).map(richText) } : base;
    case 'table':
      return { ...base, header: !!v.has_column_header, rowHeader: !!v.has_row_header };
    case 'image': {
      const src = fileRef(v);
      if (!src) return null;
      return { ...base, src, caption: richText(v.caption), ...(src.notionFile ? { v: b.last_edited_time || '' } : {}) };
    }
    case 'video':
    case 'file':
    case 'pdf':
    case 'audio': {
      const src = fileRef(v);
      if (!src) return null;
      // 노션에 직접 올린 동영상·파일은 용량 문제로 싣지 않고, 외부 링크만 남깁니다.
      if (!src.external) return null;
      return { ...base, type: 'link', url: src.external, caption: richText(v.caption), name: v.name || '' };
    }
    case 'bookmark':
    case 'embed':
    case 'link_preview': {
      const url = v.url;
      if (!/^https?:/i.test(url || '')) return null;
      return { ...base, type: 'link', url, caption: richText(v.caption) };
    }
    case 'child_page':
      return { ...base, type: 'child_page', page: cleanId(b.id), title: v.title || '' };
    case 'link_to_page': {
      const id = v.page_id || null;
      return id ? { ...base, type: 'page_link', page: cleanId(id) } : null;
    }
    default:
      // child_database, table_of_contents, breadcrumb, template, unsupported 등
      return null;
  }
}

// 노션 페이지 객체에서 제목을 꺼냅니다(데이터베이스 행이든 일반 페이지든).
export function pageTitle(page) {
  const props = page?.properties || {};
  for (const p of Object.values(props)) if (p?.type === 'title') return plain(richText(p.title)).trim();
  return '';
}

export function pageIcon(page) {
  return page?.icon?.type === 'emoji' ? page.icon.emoji : undefined;
}

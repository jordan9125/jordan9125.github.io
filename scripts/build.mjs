// content/ → _site/ 정적 사이트를 만듭니다.
import { readFile, writeFile, readdir, mkdir, rm, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { esc, blocks, plain, textOf, headingNumber } from './render.mjs';

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
};
const shortDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });
};

const icons = {
  book: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M12 7v6M9 10h6"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  timeline: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18"/><circle cx="12" cy="7" r="2"/><circle cx="12" cy="15" r="2"/><path d="M14 7h6M4 15h6"/></svg>',
};

export async function loadContent(dir = 'content') {
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8').catch(() => '{"version":1,"rows":[]}'));
  const pages = new Map();
  const files = await readdir(join(dir, 'pages')).catch(() => []);
  for (const f of files) if (f.endsWith('.json')) {
    const p = JSON.parse(await readFile(join(dir, 'pages', f), 'utf8'));
    pages.set(p.id, p);
  }
  return { index, pages };
}

export function buildSite({ index, pages }, config) {
  const base = config.base || '/';
  const slug = (id) => id.slice(-12);
  const url = (id) => (pages.has(id) ? `${base}p/${slug(id)}/` : null);
  const title = (id) => pages.get(id)?.title || '';
  const files = new Map();

  // 각 페이지의 하위 페이지 순서
  const childrenOf = (p) => {
    const out = [];
    const walk = (bs) => { for (const b of bs || []) { if (b.type === 'child_page' && pages.has(b.page)) out.push(b.page); walk(b.children); } };
    walk(p.blocks);
    return out;
  };
  const rowOf = (p) => { let cur = p; while (cur?.parent) cur = pages.get(cur.parent); return cur; };
  const countDesc = (p) => childrenOf(p).reduce((n, c) => n + 1 + countDesc(pages.get(c)), 0);

  const layout = ({ pageTitle, description = config.tagline, body, path, header }) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:site_name" content="${esc(config.siteTitle)}">
${config.siteUrl ? `<meta property="og:url" content="${esc(config.siteUrl.replace(/\/$/, '') + path)}">\n<link rel="canonical" href="${esc(config.siteUrl.replace(/\/$/, '') + path)}">` : ''}
<meta name="theme-color" content="#FBFAF7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15181D" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${base}assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&amp;family=Noto+Serif+KR:wght@500;700&amp;display=swap">
<link rel="stylesheet" href="${base}assets/style.css">
</head>
<body>
<a class="skip" href="#main">본문 바로가기</a>
${header}
<main id="main">
${body}
</main>
<footer class="site-footer"><p>${esc(config.siteTitle)} · 노션에서 쓰고 이곳에 공개합니다.</p></footer>
</body>
</html>
`;

  const homeHeader = `<header class="bar"><a class="brand" href="${base}">${icons.book}<span>${esc(config.siteTitle)}</span></a><a class="icon-btn" href="${base}#search" aria-label="검색">${icons.search}</a></header>`;

  // ---------- 홈 ----------
  const rows = index.rows.filter((r) => pages.has(r.id));
  const groups = new Map();
  for (const t of config.typeOrder || []) groups.set(t, []);
  for (const r of rows) {
    const key = r.type || config.otherLabel || '그 밖에';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const sections = [...groups].filter(([, list]) => list.length).map(([name, list]) => {
    if ((config.gridTypes || []).includes(name)) {
      return `<section class="home-section"><h2 class="label">${esc(name)}</h2><div class="cards">${list.map((r) => {
        const p = pages.get(r.id);
        const n = countDesc(p);
        return `<a class="card" href="${url(r.id)}"><strong>${esc(p.title)}</strong><span>${n ? `${n}편` : shortDate(p.edited)}</span></a>`;
      }).join('')}</div></section>`;
    }
    return `<section class="home-section"><h2 class="label">${esc(name)}</h2><div class="list">${list.map((r) => {
      const p = pages.get(r.id);
      return `<a class="row" href="${url(r.id)}"><span>${esc(p.title)}</span><small>${shortDate(p.edited)}</small></a>`;
    }).join('')}</div></section>`;
  }).join('\n');

  const feat = (config.featured || []).map((f) => ({ ...f, id: f.id.replace(/-/g, '') })).find((f) => pages.has(f.id));
  const featured = feat ? (() => {
    const p = pages.get(feat.id);
    const parent = p.parent ? pages.get(p.parent)?.title : (p.row?.type || '');
    return `<section class="featured"><p class="kicker">${esc([parent, '추천'].filter(Boolean).join(' · '))}</p><h2><a href="${url(p.id)}">${esc(p.title)}</a></h2>${feat.summary ? `<p>${esc(feat.summary)}</p>` : ''}<div class="actions"><a class="pill solid" href="${url(p.id)}">읽기</a>${(feat.links || []).map((l) => `<a class="pill" href="${esc(l.url)}">${esc(l.title)}</a>`).join('')}</div></section>`;
  })() : '';

  const tools = (config.links || []).map((l) => `<a class="tool" href="${esc(l.url)}">${icons.timeline}<span><strong>${esc(l.title)}</strong>${l.description ? `<small>${esc(l.description)}</small>` : ''}</span></a>`).join('');

  const empty = rows.length ? '' : `<section class="empty"><h2>아직 공개된 글이 없어요</h2><p>노션 성경 위키에서 <strong>공개</strong> 칸을 체크하면 잠시 뒤 이곳에 나타나요.</p></section>`;

  files.set('index.html', layout({
    pageTitle: config.siteTitle,
    path: '/',
    header: homeHeader,
    body: `<div class="wrap home">
<section class="hero"><h1>${esc(config.heroTitle || config.siteTitle)}</h1><p>${esc(config.tagline)}</p></section>
<form class="search" id="search" role="search" action="${base}" onsubmit="return false"><label for="q" class="sr">위키 검색</label>${icons.search}<input id="q" type="search" placeholder="인물, 사건, 성경 본문 검색" autocomplete="off"></form>
<div id="results" class="results" aria-live="polite" hidden></div>
${empty}${featured}
${sections}
${tools ? `<section class="home-section tools">${tools}</section>` : ''}
</div>
<script src="${base}assets/search.js" defer></script>`,
  }));

  // ---------- 글 ----------
  for (const p of pages.values()) {
    const row = rowOf(p);
    const parent = p.parent ? pages.get(p.parent) : null;
    const backUrl = parent ? url(parent.id) : base;
    const crumb = parent ? parent.title : [config.siteTitle, row?.row?.type].filter(Boolean).join(' › ');
    let h = 0;
    const tops = (p.blocks || []).filter((b) => b.type === 'heading_1');
    const tocBlocks = tops.length >= 2 ? tops : (p.blocks || []).filter((b) => b.type === 'heading_2');
    const ids = new Map();
    for (const b of tocBlocks) ids.set(b, `s${++h}`);
    const ctx = { base, link: url, title, headingId: (b) => ids.get(b) || '' };
    const html = blocks(p.blocks, ctx);
    const text = textOf(p.blocks);
    const minutes = Math.round(text.replace(/\s/g, '').length / 500);
    const toc = tocBlocks.length >= 2 ? `<nav class="toc" aria-label="목차">${tocBlocks.map((b) => {
      const num = headingNumber(b.text);
      return `<a href="#${ids.get(b)}">${num ? `<b>${esc(num.n)}</b> ${esc(num.text)}` : esc(plain(b.text))}</a>`;
    }).join('')}</nav>` : '';
    let nav = '';
    if (parent) {
      const sib = childrenOf(parent);
      const i = sib.indexOf(p.id);
      const prev = i > 0 ? sib[i - 1] : null;
      const next = i >= 0 && i < sib.length - 1 ? sib[i + 1] : null;
      nav = `<nav class="pager" aria-label="이전·다음 글">${prev ? `<a class="prev" href="${url(prev)}"><small>이전</small><span>${esc(title(prev))}</span></a>` : ''}${next ? `<a class="next" href="${url(next)}"><small>다음</small><span>${esc(title(next))}</span></a>` : ''}</nav>`;
    }
    const meta = [fmtDate(p.edited) && `마지막 수정 ${fmtDate(p.edited)}`, minutes >= 2 && `약 ${minutes}분`].filter(Boolean).join(' · ');
    const description = text.replace(/\s+/g, ' ').trim().slice(0, 120) || config.tagline;
    files.set(`p/${slug(p.id)}/index.html`, layout({
      pageTitle: `${p.title} · ${config.siteTitle}`,
      description,
      path: `/p/${slug(p.id)}/`,
      header: `<header class="bar"><div class="crumb"><a class="icon-btn" href="${backUrl}" aria-label="${esc(parent ? parent.title + '(으)로 돌아가기' : '홈으로')}">${icons.back}</a><span>${esc(crumb)}</span></div><button class="icon-btn" type="button" data-share aria-label="공유하기">${icons.share}</button></header>`,
      body: `<article class="wrap article">
<header class="article-head"><h1>${esc(p.title)}</h1>${meta ? `<p class="meta">${meta}</p>` : ''}${toc}</header>
<div class="prose">
${html}
</div>
${nav}
</article>
<script src="${base}assets/share.js" defer></script>`,
    }));
  }

  // ---------- 검색 색인 · 404 ----------
  const search = [...pages.values()].map((p) => ({ t: p.title, u: url(p.id), p: p.parent ? title(p.parent) : (p.row?.type || ''), x: textOf(p.blocks).replace(/\s+/g, ' ').slice(0, 3000) }));
  files.set('search.json', JSON.stringify(search));
  files.set('404.html', layout({ pageTitle: `페이지를 찾을 수 없어요 · ${config.siteTitle}`, path: '/404.html', header: homeHeader, body: `<div class="wrap empty"><h1>페이지를 찾을 수 없어요</h1><p>주소가 바뀌었거나 비공개로 바뀐 글일 수 있어요.</p><p><a class="pill solid" href="${base}">홈으로</a></p></div>` }));
  files.set('.nojekyll', '');
  return files;
}

export async function run({ contentDir = 'content', out = '_site' } = {}) {
  const config = JSON.parse(await readFile('site.config.json', 'utf8'));
  const content = await loadContent(contentDir);
  const files = buildSite(content, config);
  await rm(out, { recursive: true, force: true });
  for (const [name, text] of files) {
    const f = join(out, name);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, text);
  }
  await cp('assets', join(out, 'assets'), { recursive: true });
  await cp(join(contentDir, 'media'), join(out, 'media'), { recursive: true }).catch(() => {});
  console.log(`Built ${files.size} files into ${out}/.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  run({ contentDir: args.content || 'content', out: args.out || '_site' }).catch((e) => { console.error(e); process.exitCode = 1; });
}

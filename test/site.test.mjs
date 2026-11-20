import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { richText, block, notionIdFromUrl } from '../scripts/normalize.mjs';
import { blocks, scriptureRefs } from '../scripts/render.mjs';
import { syncContent } from '../scripts/sync.mjs';
import { buildSite, loadContent } from '../scripts/build.mjs';
import { NotionError } from '../scripts/notion.mjs';

const ID = (n) => String(n).padStart(32, '0');
const rt = (t, extra = {}) => ({ type: 'text', plain_text: t, text: { content: t, link: null }, href: null, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...extra } });
const para = (id, ...text) => ({ object: 'block', id, type: 'paragraph', has_children: false, paragraph: { rich_text: text, color: 'default' } });
const childPage = (id, title) => ({ object: 'block', id, type: 'child_page', has_children: true, child_page: { title } });
const titleProp = (t) => ({ type: 'title', title: [rt(t)] });

const ctx = { base: '/', link: (id) => (id === 'a'.repeat(32) ? '/p/aaaa/' : null), title: () => '' };

test('rich text keeps colors, merges runs and resolves Notion links', () => {
  const r = richText([rt('아브', { color: 'orange' }), rt('라함', { color: 'orange' }), { ...rt('링크'), href: 'https://www.notion.so/Some-Page-' + 'a'.repeat(32) }]);
  assert.deepEqual(r, [{ t: '아브라함', color: 'orange' }, { t: '링크', href: 'notion:' + 'a'.repeat(32) }]);
  assert.equal(notionIdFromUrl('https://app.notion.com/p/' + 'b'.repeat(32) + '?pvs=204'), 'b'.repeat(32));
  assert.equal(notionIdFromUrl('https://example.com/' + 'b'.repeat(32)), null);
  assert.deepEqual(richText([{ ...rt('x'), href: 'javascript:alert(1)' }]), [{ t: 'x' }]);
});

test('render maps Notion colors and escapes text', () => {
  const html = blocks([
    { type: 'paragraph', text: [{ t: '<b>', color: 'gray' }, { t: '강조', color: 'orange' }, { t: '빨강', b: 1, color: 'red' }] },
    { type: 'paragraph', text: [{ t: '공개 글', href: 'notion:' + 'a'.repeat(32) }, { t: '비공개 글', href: 'notion:' + 'c'.repeat(32) }] },
  ], ctx);
  assert.match(html, /<span class="aside">&lt;b&gt;<\/span>/);
  assert.match(html, /<mark>강조<\/mark>/);
  assert.match(html, /<span class="c-red"><strong>빨강<\/strong><\/span>/);
  assert.match(html, /<a href="\/p\/aaaa\/">공개 글<\/a>비공개 글/);
});

test('scripture references become labels', () => {
  assert.equal(scriptureRefs('(마태복음1:1) 아브라함과<br>(창세기12:1-3)<br>1 여호와께서'),
    '<span class="ref">마태복음1:1</span><br>아브라함과<br><span class="ref">창세기12:1-3</span><br>1 여호와께서');
  assert.equal(scriptureRefs('그냥 (괄호) 문장'), '그냥 (괄호) 문장');
  assert.match(blocks([{ type: 'quote', text: [], children: [{ type: 'paragraph', text: [{ t: '(사무엘상15:22-23)\n22 사무엘이 이르되' }] }] }], ctx), /<p><span class="ref">사무엘상15:22-23<\/span><br>22 사무엘이/);
});

test('chapter sub-pages render as a number grid; numbered headings get a badge', () => {
  const pages = { [ID(1)]: '초신자의 성경읽기', [ID(2)]: '마가복음 1장', [ID(3)]: '마가복음 2장', [ID(4)]: '마가복음 3장' };
  const c = { base: '/', link: (id) => '/p/' + id.slice(-4) + '/', title: (id) => pages[id] };
  const html = blocks(Object.keys(pages).map((id) => ({ type: 'child_page', page: id, title: pages[id] })), c);
  assert.match(html, /class="row"[^>]*><span>초신자의 성경읽기/);
  assert.match(html, /<div class="chapters">.*<strong>1<\/strong>.*<strong>3<\/strong>/s);
  const h = blocks([{ type: 'heading_1', text: [{ t: '1. 족장의 시대' }] }, { type: 'heading_2', text: [{ t: '아브라함 : 믿음의 조상' }] }], c);
  assert.match(h, /<h2><span class="num">01<\/span>족장의 시대<\/h2>/);
  assert.match(h, /<h3>아브라함 <span class="sub">믿음의 조상<\/span><\/h3>/);
});

function fakeNotion({ rows, pages, children }) {
  const calls = { children: [], page: [] };
  return {
    calls,
    client: {
      queryDataSource: async () => rows,
      page: async (id) => { calls.page.push(id); if (!pages[id]) throw new NotionError('Notion request failed (HTTP 404)', 404); return pages[id]; },
      children: async (id) => { calls.children.push(id); return children[id] || []; },
    },
  };
}

const row = (id, title, { pub = true, edited = '2026-11-16T04:05:00.000Z', type = '다 아는 주제' } = {}) => ({
  object: 'page', id, last_edited_time: edited,
  properties: { 제목: titleProp(title), 공개: { type: 'checkbox', checkbox: pub }, 유형: { type: 'select', select: type ? { name: type } : null }, 태그: { type: 'multi_select', multi_select: [] } },
});

test('sync publishes only checked rows plus their sub-pages, stores images, and reuses unchanged pages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wiki-'));
  const A = ID('a1'), B = ID('b2'), C = ID('c3'), IMG = ID('d4');
  const data = {
    rows: [row(A, '마가복음'), row(B, '비공개 글', { pub: false })],
    pages: { [C]: { object: 'page', id: C, last_edited_time: '2026-11-18T10:58:00.000Z', properties: { title: titleProp('마가복음 1장') } } },
    children: {
      [A]: [para(ID('p1'), rt('서론')), childPage(C, '마가복음 1장'), childPage(ID('99'), '공유 안 된 페이지')],
      [C]: [{ object: 'block', id: IMG, type: 'image', has_children: false, last_edited_time: 'x', image: { type: 'file', file: { url: 'https://files.example/img.png?sig=1' }, caption: [] } }],
    },
  };
  const n = fakeNotion(data);
  let downloads = 0;
  const fetcher = async () => { downloads++; return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }; };
  const logs = [];
  const r1 = await syncContent({ client: n.client, dir, dataSource: 'ds', fetcher, log: (m) => logs.push(m) });
  assert.equal(r1.changed, true);
  assert.equal(r1.pages, 2);
  assert.ok(logs.some((l) => l.includes('not shared')));
  const files = (await readdir(join(dir, 'pages'))).sort();
  assert.deepEqual(files, [A + '.json', C + '.json'].sort());
  const sub = JSON.parse(await readFile(join(dir, 'pages', C + '.json'), 'utf8'));
  assert.equal(sub.parent, A);
  assert.match(sub.blocks[0].src.local, /^0+d4-[0-9a-f]{8}\.png$/);
  assert.equal(downloads, 1);

  // 두 번째 실행: 바뀐 것이 없으면 본문을 다시 읽지 않고, 파일도 그대로
  const n2 = fakeNotion(data);
  const r2 = await syncContent({ client: n2.client, dir, dataSource: 'ds', fetcher, log: () => {} });
  assert.equal(r2.changed, false);
  assert.equal(r2.fetched, 0);
  assert.deepEqual(n2.calls.children, []);
  assert.equal(downloads, 1);

  // 공개를 끄면 하위 페이지·이미지까지 사라짐
  const n3 = fakeNotion({ ...data, rows: [row(A, '마가복음', { pub: false })] });
  const r3 = await syncContent({ client: n3.client, dir, dataSource: 'ds', fetcher, log: () => {} });
  assert.equal(r3.changed, true);
  assert.deepEqual((await readdir(join(dir, 'pages'))), []);
  assert.deepEqual((await readdir(join(dir, 'media'))), []);
});

test('sync refuses a database without the 공개 checkbox', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wiki-'));
  const r = row(ID(1), '글');
  delete r.properties.공개;
  const n = fakeNotion({ rows: [r], pages: {}, children: {} });
  await assert.rejects(syncContent({ client: n.client, dir, dataSource: 'ds' }), /no checkbox property named "공개"/);
});

test('build makes home, article and search pages from synced content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wiki-'));
  const A = ID('a1'), C = ID('c3');
  const n = fakeNotion({
    rows: [row(A, '<script>마가복음', { type: '다 아는 성경' })],
    pages: { [C]: { object: 'page', id: C, last_edited_time: '2026-11-18T10:58:00.000Z', properties: { title: titleProp('마가복음 1장') } } },
    children: { [A]: [childPage(C, '마가복음 1장')], [C]: [para(ID('p'), rt('예수 그리스도의 복음의 시작이라'))] },
  });
  await syncContent({ client: n.client, dir, dataSource: 'ds', log: () => {} });
  const config = { siteTitle: '성경 위키', tagline: '태그라인', typeOrder: ['다 아는 성경'], gridTypes: ['다 아는 성경'], featured: [] };
  const files = buildSite(await loadContent(dir), config);
  const home = files.get('index.html');
  assert.match(home, /&lt;script&gt;마가복음/);
  assert.doesNotMatch(home, /<script>마가복음/);
  assert.match(home, /1편/);
  const sub = files.get(`p/${C.slice(-12)}/index.html`);
  assert.match(sub, /예수 그리스도의 복음의 시작이라/);
  assert.match(sub, new RegExp(`href="/p/${A.slice(-12)}/"`));
  assert.ok(JSON.parse(files.get('search.json')).some((s) => s.t === '마가복음 1장'));
});

test('build shows a friendly empty state before anything is public', () => {
  const files = buildSite({ index: { rows: [] }, pages: new Map() }, { siteTitle: '성경 위키', tagline: 't' });
  assert.match(files.get('index.html'), /아직 공개된 글이 없어요/);
});

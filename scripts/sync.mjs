// 노션 '성경 위키'에서 공개로 체크된 글과 그 하위 페이지를 읽어
// content/ 폴더에 저장합니다. 바뀐 내용이 있을 때만 파일을 고칩니다.
import { readFile, writeFile, readdir, mkdir, rm, rename, appendFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, NotionError } from './notion.mjs';
import { block, cleanId, pageTitle, pageIcon, plain, richText } from './normalize.mjs';

export const LIMITS = { pages: 1500, depth: 8, blocksPerPage: 6000, imageBytes: 15 * 1024 * 1024 };
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

const sha = (s) => createHash('sha256').update(s).digest('hex');
const json = (x) => JSON.stringify(x, null, 1) + '\n';

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function exists(file) { try { await stat(file); return true; } catch { return false; } }

export function rowsFromQuery(results, publicProp) {
  const live = results.filter((p) => !p.in_trash && !p.archived && !p.is_archived);
  if (live.length && !live.some((p) => p.properties?.[publicProp]?.type === 'checkbox')) {
    throw new Error(`Database has no checkbox property named "${publicProp}"`);
  }
  return live
    .filter((p) => p.properties?.[publicProp]?.checkbox === true)
    .map((p) => {
      const props = p.properties || {};
      return {
        id: cleanId(p.id),
        title: pageTitle(p),
        type: props['유형']?.select?.name || null,
        tags: (props['태그']?.multi_select || []).map((t) => t.name),
        edited: p.last_edited_time,
        page: p,
      };
    });
}

function eachBlock(blocks, fn) {
  for (const b of blocks || []) { fn(b); eachBlock(b.children, fn); }
}

export async function syncContent({ client, dir = 'content', dataSource, publicProp = '공개', orderProp = '순서', fetcher = fetch, log = () => {} }) {
  const pagesDir = join(dir, 'pages');
  const mediaDir = join(dir, 'media');
  await mkdir(pagesDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });

  // 이전에 저장한 페이지(캐시)
  const old = new Map();
  for (const f of await readdir(pagesDir)) {
    if (!f.endsWith('.json')) continue;
    const p = await readJson(join(pagesDir, f), null);
    if (p?.id) old.set(p.id, p);
  }

  const rows = rowsFromQuery(await client.queryDataSource(dataSource), publicProp);
  const pages = new Map();
  let fetched = 0;

  async function tree(id, depth, counter) {
    const list = await client.children(id);
    const out = [];
    for (const b of list) {
      if (++counter.n > LIMITS.blocksPerPage) throw new Error('Page has too many blocks');
      const n = block(b);
      if (!n) continue;
      if (b.has_children && n.type !== 'child_page' && n.type !== 'child_db' && depth < 12) n.children = await tree(b.id, depth + 1, counter);
      out.push(n);
    }
    return out;
  }

  // 페이지 안의 데이터베이스(예: 마가복음 글 목록)는 매번 다시 읽습니다.
  // 체크박스를 바꿔도 바깥 페이지의 수정 시각은 바뀌지 않기 때문입니다.
  const rowPages = new Map();
  async function fillDatabases(blocks) {
    const dbs = [];
    eachBlock(blocks, (b) => { if (b.type === 'child_db') dbs.push(b); });
    for (const node of dbs) {
      node.items = [];
      let results;
      try {
        const db = await client.database(node.db);
        const ds = db?.data_sources?.[0]?.id;
        if (!ds) continue;
        results = await client.queryDataSource(ds);
      } catch (e) {
        if (e instanceof NotionError && e.status === 404) { log(`::warning::Database ${node.db} is not shared with the connection; skipped.`); continue; }
        throw e;
      }
      const live = results.filter((p) => !p.in_trash && !p.archived && !p.is_archived);
      if (live.length && !live.some((p) => p.properties?.[publicProp]?.type === 'checkbox')) {
        log(`::notice::Database "${node.title}" has no "${publicProp}" checkbox; nothing in it is published.`);
        continue;
      }
      const order = (p) => { const n = p.properties?.[orderProp]?.number; return typeof n === 'number' ? n : Infinity; };
      const picked = live.filter((p) => p.properties?.[publicProp]?.checkbox === true)
        .sort((a, b) => order(a) - order(b) || String(a.created_time).localeCompare(String(b.created_time)));
      for (const p of picked) {
        const id = cleanId(p.id);
        rowPages.set(id, p);
        node.items.push({ page: id, title: pageTitle(p) });
      }
    }
    return blocks;
  }

  async function mediaReady(blocks) {
    let ok = true;
    const checks = [];
    eachBlock(blocks, (b) => { if (b.src?.local) checks.push(exists(join(mediaDir, b.src.local)).then((e) => { if (!e) ok = false; })); });
    await Promise.all(checks);
    return ok;
  }

  async function downloadImages(blocks) {
    const jobs = [];
    eachBlock(blocks, (b) => { if (b.type === 'image' && b.src?.notionFile) jobs.push(b); });
    for (const b of jobs) {
      const url = b.src.notionFile;
      const stem = `${b.id}-${sha(b.v || url).slice(0, 8)}`;
      const already = (await readdir(mediaDir)).find((f) => f.startsWith(stem + '.'));
      if (already) { b.src = { local: already }; delete b.v; continue; }
      let res;
      try { res = await fetcher(url, { signal: AbortSignal.timeout(60000) }); } catch { res = null; }
      const type = (res?.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
      const ext = IMAGE_EXT[type];
      if (!res?.ok || !ext) { log(`::warning::Image ${b.id} could not be downloaded; left out.`); b.src = null; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > LIMITS.imageBytes) { log(`::warning::Image ${b.id} is larger than 15 MB; left out.`); b.src = null; continue; }
      const name = `${stem}.${ext}`;
      await writeFile(join(mediaDir, name), buf);
      b.src = { local: name };
      delete b.v;
    }
  }

  async function visit(id, parent, depth, pageObj, row) {
    if (pages.has(id)) return;
    if (pages.size >= LIMITS.pages) throw new Error('Maximum page count exceeded');
    const page = pageObj || await client.page(id);
    if (page.in_trash || page.archived || page.is_archived) return;
    const edited = page.last_edited_time;
    const cached = old.get(id);
    let blocks;
    if (cached && cached.edited === edited && await mediaReady(cached.blocks)) {
      blocks = await fillDatabases(cached.blocks);
    } else {
      blocks = await tree(id, 0, { n: 0 });
      await downloadImages(blocks);
      blocks = await fillDatabases(prune(blocks));
      fetched++;
    }
    const rec = {
      id,
      title: pageTitle(page) || cached?.title || '제목 없음',
      ...(pageIcon(page) ? { icon: pageIcon(page) } : {}),
      parent: parent || null,
      edited,
      ...(row ? { row: { type: row.type, tags: row.tags } } : {}),
      blocks,
    };
    pages.set(id, rec);
    if (depth >= LIMITS.depth) return;
    const kids = [];
    eachBlock(blocks, (b) => {
      if (b.type === 'child_page') kids.push(b.page);
      if (b.type === 'child_db') for (const it of b.items) kids.push(it.page);
    });
    for (const kid of kids) {
      try { await visit(kid, id, depth + 1, rowPages.get(kid)); }
      catch (e) { if (e instanceof NotionError && e.status === 404) log(`::warning::Sub-page ${kid} is not shared with the connection; skipped.`); else throw e; }
    }
  }

  for (const row of rows) await visit(row.id, null, 0, row.page, row);

  // 쓰기: 바뀐 파일만
  let changed = false;
  const write = async (file, text) => {
    const prev = await readFile(file, 'utf8').catch(() => null);
    if (prev === text) return;
    await writeFile(file + '.tmp', text);
    await rename(file + '.tmp', file);
    changed = true;
  };
  for (const p of pages.values()) await write(join(pagesDir, p.id + '.json'), json(p));
  for (const id of old.keys()) if (!pages.has(id)) { await rm(join(pagesDir, id + '.json'), { force: true }); changed = true; }
  const index = { version: 1, rows: rows.map(({ id, title, type, tags, edited }) => ({ id, title, type, tags, edited })) };
  await write(join(dir, 'index.json'), json(index));

  // 쓰지 않는 이미지 정리
  const used = new Set();
  for (const p of pages.values()) eachBlock(p.blocks, (b) => { if (b.src?.local) used.add(b.src.local); });
  for (const f of await readdir(mediaDir)) {
    if (f.startsWith('.')) continue;
    if (!used.has(f)) { await rm(join(mediaDir, f), { force: true }); changed = true; }
  }
  // 새로 받은 이미지는 위 페이지 파일 변경으로 함께 잡힙니다.
  log(`Public pages: ${pages.size} (re-read ${fetched}).`);
  return { changed, pages: pages.size, fetched };
}

// 비어 있는 블록과 실패한 이미지를 정리합니다.
export function prune(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === 'image' && !b.src) continue;
    if (b.children) b.children = prune(b.children);
    if (['column_list', 'column', 'synced_block'].includes(b.type) && !(b.children || []).length) continue;
    out.push(b);
  }
  return out;
}

export async function run() {
  const config = await readJson('site.config.json', {});
  let changed = false;
  if (!process.env.NOTION_TOKEN) {
    console.log('::notice::NOTION_TOKEN is not configured. Publishing existing content only.');
  } else {
    const client = createClient(process.env.NOTION_TOKEN);
    ({ changed } = await syncContent({ client, dataSource: config.notion.dataSource, publicProp: config.notion.publicProperty || '공개', log: console.log }));
    console.log(changed ? 'Public content changed.' : 'No public content change.');
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    const known = /^(Notion request failed|Database has no checkbox property|Maximum page count|Page has too many blocks|Incomplete Notion response|Invalid pagination|Network error)/.test(error.message);
    console.error('::error::' + (known ? error.message : 'Unexpected error: ' + error.message) + '. Previously published content is unchanged.');
    process.exitCode = 1;
  });
}

export { plain, richText };

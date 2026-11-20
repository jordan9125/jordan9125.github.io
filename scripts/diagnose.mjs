// 노션 연결 문제를 찾기 위한 일회성 진단(토큰은 출력하지 않음)
import { createClient } from './notion.mjs';
const c = createClient(process.env.NOTION_TOKEN);
const tryIt = async (label, f) => { try { const r = await f(); console.log('OK  ', label, JSON.stringify(r).slice(0, 1500)); } catch (e) { console.log('FAIL', label, e.message); } };
const kids = await c.children('a6b53769da8c48bab9244495aa4fb035');
for (const b of kids.filter((b) => b.type === 'synced_block')) {
  await tryIt('synced_block ' + b.id, async () => ({ synced_from: b.synced_block?.synced_from, has_children: b.has_children, children: (await c.children(b.id)).map((x) => x.type + (x.child_database ? ':' + x.child_database.title : '') + (x.child_page ? ':' + x.child_page.title : '')) }));
}
await tryIt('wiki database GET', () => c.database('f57f7a091697427eb8db316569d0ece9').then((d) => ({ parent: d.parent, ds: d.data_sources })));

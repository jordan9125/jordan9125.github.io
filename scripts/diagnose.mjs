// 노션 연결 문제를 찾기 위한 일회성 진단(토큰은 출력하지 않음)
import { createClient } from './notion.mjs';
const c = createClient(process.env.NOTION_TOKEN);
const tryIt = async (label, f) => { try { const r = await f(); console.log('OK  ', label, JSON.stringify(r).slice(0, 400)); } catch (e) { console.log('FAIL', label, e.message); } };
await tryIt('성경 page children', async () => (await c.children('a6b53769da8c48bab9244495aa4fb035')).map((b) => ({ type: b.type, id: b.id, title: b.child_database?.title })).filter((b) => b.type === 'child_database'));
await tryIt('마가복음 row page', async () => { const p = await c.page('3d2ce9f8117e8055a056dc27554dd6ba'); return { parent: p.parent, props: Object.keys(p.properties) }; });
await tryIt('wiki data source GET', () => fetch('https://api.notion.com/v1/data_sources/0d0244c5-09fe-4833-8b62-be7cac563996', { headers: { Authorization: 'Bearer ' + process.env.NOTION_TOKEN, 'Notion-Version': '2025-09-03' } }).then((r) => r.json()).then((j) => ({ object: j.object, code: j.code, message: j.message, parent: j.parent, database_parent: j.database_parent })));
await tryIt('마가복음 글 목록 database', async () => (await c.database('41ece9f8117e813aa3e7d4064c5b62ce')).data_sources);

// 아주 작은 Notion API 클라이언트. 읽기 요청만 합니다.

export const NOTION_VERSION = '2025-09-03';

export class NotionError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createClient(token, { fetcher = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), minGap = 340 } = {}) {
  let last = 0;
  async function request(method, path, body) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const gap = last + minGap - Date.now();
      if (gap > 0) await sleep(gap);
      last = Date.now();
      let res;
      try {
        res = await fetcher('https://api.notion.com/v1' + path, {
          method,
          headers: {
            Authorization: 'Bearer ' + token,
            'Notion-Version': NOTION_VERSION,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(45000),
        });
      } catch (e) {
        if (attempt === 4) throw new NotionError('Network error contacting Notion', 0);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) return res.json();
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
        const after = Number(res.headers?.get?.('retry-after')) || 2 ** attempt;
        await sleep(Math.min(30, after) * 1000);
        continue;
      }
      throw new NotionError(`Notion request failed (HTTP ${res.status}) for ${method} ${path.split('?')[0]}`, res.status);
    }
    throw new NotionError('Notion request failed after retries', 0);
  }

  async function paginate(fetchPage) {
    const out = [];
    const seen = new Set();
    let cursor;
    do {
      const data = await fetchPage(cursor);
      if (!Array.isArray(data?.results) || typeof data.has_more !== 'boolean') throw new NotionError('Incomplete Notion response', 0);
      out.push(...data.results);
      cursor = data.has_more ? data.next_cursor : null;
      if (data.has_more && (!cursor || seen.has(cursor))) throw new NotionError('Invalid pagination cursor', 0);
      if (cursor) seen.add(cursor);
    } while (cursor);
    return out;
  }

  return {
    queryDataSource: (id) => paginate((cursor) => request('POST', `/data_sources/${id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })),
    page: (id) => request('GET', `/pages/${id}`),
    database: (id) => request('GET', `/databases/${id}`),
    me: () => request('GET', '/users/me'),
    children: (id) => paginate((cursor) => request('GET', `/blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''}`)),
  };
}

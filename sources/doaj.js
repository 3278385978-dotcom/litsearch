'use strict';
/**
 * sources/doaj.js — DOAJ（开放获取期刊，免认证）
 * API: GET https://doaj.org/api/search/articles/<query>?pageSize=<n>
 */
const API = 'https://doaj.org/api/search/articles';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function search(keyword, opts = {}) {
  const rows = Math.min(Math.max(Number(opts.rows) || 8, 1), 50);
  const url = `${API}/${encodeURIComponent(keyword)}?pageSize=${rows}`;
  let j = {};
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'litsearch/1.0' } });
    if (!res.ok) {
      lastErr = `HTTP ${res.status}`;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error(`DOAJ ${lastErr}（该站偶发 5xx，稍后重试）`);
    }
    j = await res.json();
    if ((j.results || []).length) break;
    await new Promise((r) => setTimeout(r, 1200)); // 空结果可能是瞬时限流
  }
  const items = (j.results || []).map((r) => {
    const b = r.bibjson || {};
    const doi = (b.identifier || []).filter((x) => /doi/i.test(x.type || '')).map((x) => x.id)[0] || '';
    const links = b.link || [];
    const full = links.filter((l) => /fulltext|homepage/i.test(l.type || ''))[0] || links[0] || null;
    return {
      title: strip(b.title),
      author: (b.author || []).map((a) => a.name).filter(Boolean).slice(0, 8).join('; '),
      source: strip(b.journal && b.journal.title),
      year: b.year || '',
      doi,
      url: (full && full.url) || (doi ? `https://doi.org/${doi}` : ''),
      cited: 0,
      type: 'article',
    };
  });
  return {
    source: 'doaj', label: 'DOAJ（开放获取）', keyword,
    numFound: j.total || items.length,
    items,
    note: 'DOAJ 只收开放获取期刊（可合法下载全文）',
  };
}
module.exports = { search, API };

'use strict';
/**
 * sources/crossref.js — Crossref（DOI 元数据，免认证）
 * API: GET https://api.crossref.org/works?query=<q>&rows=<n>&select=...
 */
const API = 'https://api.crossref.org/works';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function search(keyword, opts = {}) {
  const rows = Math.min(Math.max(Number(opts.rows) || 10, 1), 50);
  const fetchRows = Math.min(rows * 4, 100); // 多取一些：component 类记录会被过滤掉
  const sel = 'DOI,title,author,container-title,published,is-referenced-by-count,URL,type';
  const url = `${API}?query=${encodeURIComponent(keyword)}&rows=${fetchRows}&select=${sel}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'litsearch/1.0 (mailto:none@example.com)' } });
  if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
  const j = await res.json();
  const m = j.message || {};
  const items = (m.items || [])
    .filter((x) => x.type !== 'component' && !/\.[sS]\d+$/.test(x.DOI || ''))
    .filter((x) => strip((x.title || [])[0])) // 丢弃无标题记录
    .map((x) => ({
    title: strip((x.title || [])[0]),
    author: (x.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 8).join('; '),
    source: strip((x['container-title'] || [])[0]),
    year: (x.published && x.published['date-parts'] && x.published['date-parts'][0] && x.published['date-parts'][0][0]) || '',
    doi: x.DOI || '',
    url: x.URL || (x.DOI ? `https://doi.org/${x.DOI}` : ''),
    cited: x['is-referenced-by-count'] || 0,
    type: x.type || '',
  }));
  return {
    source: 'crossref', label: 'Crossref（DOI）', keyword,
    items: items.slice(0, rows),
    numFound: m['total-results'] || items.length,
    items,
    note: 'Crossref 免认证；覆盖 DOI 注册的期刊/会议/图书章节',
  };
}
module.exports = { search, API };

'use strict';
/**
 * sources/openalex.js — OpenAlex（公开学术图谱，免认证）
 * API: GET https://api.openalex.org/works?search=<q>&per-page=<n>&select=...
 * 说明：免 key 也能用，但共享每日预算；量大时建议免费注册 key（LITSEARCH_OPENALEX_KEY）。
 */
const API = 'https://api.openalex.org/works';

async function search(keyword, opts = {}) {
  const rows = Math.min(Math.max(Number(opts.rows) || 10, 1), 50);
  const sel = 'id,display_name,publication_year,doi,cited_by_count,authorships,primary_location,type';
  const url = `${API}?search=${encodeURIComponent(keyword)}&per-page=${rows}&select=${sel}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'litsearch/1.0 (mailto:none@example.com)' } });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  const j = await res.json();
  const items = (j.results || []).map((w) => ({
    title: w.display_name || '',
    author: (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean).slice(0, 8).join('; '),
    source: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
    year: w.publication_year || '',
    doi: (w.doi || '').replace(/^https?:\/\/doi\.org\//, ''),
    url: (w.primary_location && w.primary_location.landing_page_url) || w.doi || w.id || '',
    cited: w.cited_by_count || 0,
    type: w.type || '',
  }));
  return {
    source: 'openalex', label: 'OpenAlex（公开）', keyword,
    numFound: (j.meta && j.meta.count) || items.length,
    items,
    note: 'OpenAlex 免认证（免 key 共享每日预算）；CC0 元数据',
  };
}
module.exports = { search, API };

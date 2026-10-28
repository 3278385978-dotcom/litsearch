'use strict';
/**
 * sources/_template-http.js — 新增「HTTP/JSON 渠道」骨架（复制改名即可）
 *
 * 适用：站点有 JSON API（最省事、最快）。参考实现：sources/openalex.js
 * 三步：① 定位接口 → ② 解析 JSON → ③ 映射成统一 items
 * 详细方法论见 docs/加渠道方法论.md
 */

const API = 'https://<站点域名>/api/search';

async function search(keyword, opts = {}) {
  const rows = Math.min(Math.max(Number(opts.rows) || 10, 1), 50);
  const url = `${API}?q=${encodeURIComponent(keyword)}&n=${rows}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'litsearch/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();

  const items = (j.hits || []).map((x) => ({
    title: x.title || '',
    author: x.author || '',
    source: x.venue || '',
    year: x.year || '',
    url: x.link || '',
    pdfUrl: x.pdf || '',
  }));

  return {
    source: 'xxx',          // 渠道短名（用于 --src=）
    label: '某站',
    keyword,
    numFound: j.total || items.length,
    items,
  };
}

module.exports = { search, API };

'use strict';
/**
 * sources/pubmed.js — PubMed（生物医学，NCBI E-utilities，免认证）
 * 两步：esearch 拿 PMID 列表 → esummary 拿题录
 */
const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// 带超时 + 一次重试：NCBI 偶发连不上（ETIMEDOUT），不要让它拖死整轮
async function fetchJson(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'litsearch/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw new Error(`PubMed 请求失败（${lastErr && lastErr.message}）：出口网络波动或 NCBI 线路问题，稍后重试或换网络`);
}

async function search(keyword, opts = {}) {
  const rows = Math.min(Math.max(Number(opts.rows) || 10, 1), 50);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const es = `${BASE}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retstart=${offset}&retmax=${rows}&term=${encodeURIComponent(keyword)}`;
  const j1 = await fetchJson(es);
  const ids = (j1.esearchresult && j1.esearchresult.idlist) || [];
  const total = Number((j1.esearchresult && j1.esearchresult.count) || 0);
  if (!ids.length) {
    return { source: 'pubmed', label: 'PubMed（生物医学）', keyword, numFound: total, items: [] , note: 'PubMed E-utilities 免认证' };
  }
  const us = `${BASE}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`;
  const j2 = await fetchJson(us);
  const result = j2.result || {};
  const items = ids
    .map((id) => ({ id, x: result[id] }))
    .filter((o) => o.x)
    .map(({ id, x }) => {
      const doi = (x.articleids || []).filter((a) => a.idtype === 'doi').map((a) => a.value)[0] || '';
      return {
        title: x.title || '',
        author: (x.authors || []).map((a) => a.name).filter(Boolean).slice(0, 8).join('; '),
        source: x.fulljournalname || x.source || '',
        year: (x.pubdate || '').match(/\d{4}/) ? (x.pubdate || '').match(/\d{4}/)[0] : (x.pubdate || ''),
        doi,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        cited: 0,
        type: 'article',
      };
    });
  return {
    source: 'pubmed', label: 'PubMed（生物医学）', keyword,
    numFound: total,
    items,
    note: 'PubMed E-utilities 免认证；中文检索效果差，建议英文关键词',
  };
}
module.exports = { search, BASE };

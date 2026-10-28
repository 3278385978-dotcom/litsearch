'use strict';
/**
 * sources/arxiv.js — arXiv 论文检索（纯 HTTP，零依赖，不需要浏览器）
 *
 * 为什么用它：arXiv 是**开放获取**，所有论文全文 PDF 可直接下载，
 * 方法学细节完整（含算法、伪代码、数值实验），比只给结论的期刊摘要有用得多。
 * 而且不需要校园网、不受机构订阅限制。
 *
 * 接口：GET http://export.arxiv.org/api/query?search_query=...&max_results=...
 *       返回 Atom XML。
 */

const API = process.env.LITSEARCH_ARXIV || 'http://export.arxiv.org/api/query';

/** arXiv 的短语检索要用引号包起来 */
function buildQuery(keyword) {
  const kw = String(keyword).trim();
  return /\s/.test(kw) ? `all:"${kw}"` : `all:${kw}`;
}

function unescapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function squash(s) {
  return unescapeXml(s).replace(/\s+/g, ' ').trim();
}

function pick(block, re) {
  const m = block.match(re);
  return m ? m[1] : '';
}

/**
 * 检索 arXiv
 *
 * 关键词策略：单词直接 all:词；多词先按短语 all:"整句" 搜，
 * 若 0 条则自动降级为 "all:词1 AND all:词2"（中英混输/长句时更宽容）。
 *
 * @param {string} keyword
 * @param {object} opts { max {number} 默认 10, sortBy 'relevance'|'lastUpdatedDate'|'submittedDate' }
 */
async function search(keyword, opts = {}) {
  const max = Math.min(Math.max(Number(opts.max) || 10, 1), 50);
  const sortBy = opts.sortBy || 'relevance';
  const kw = String(keyword).trim();
  const tokens = kw.split(/\s+/).filter(Boolean);

  const first = await query(buildQuery(kw), max, sortBy);
  if (first.items.length || tokens.length < 2) return withHint(first, kw);

  // 降级：短语无结果 → 词与词 AND
  const andQuery = tokens.map((t) => `all:${t}`).join(' AND ');
  const second = await query(andQuery, max, sortBy);
  if (second.items.length) {
    second.note = `短语检索无结果，已自动改用组合检索：${andQuery}`;
    return second;
  }
  return withHint(first, kw);
}

/** arXiv 是英文库，中文关键词几乎必然 0 条 —— 给个明确提示而不是让人以为坏了 */
function withHint(res, keyword) {
  if (!res.items.length && /[\u4e00-\u9fa5]/.test(keyword)) {
    res.note =
      'arXiv 收录的是英文预印本，中文关键词基本搜不到。改用英文，例如：' +
      '"computational electromagnetics" / FDTD / "finite element method"。';
  }
  return res;
}

/** 真正发一次请求 */
async function query(searchQuery, max, sortBy) {
  const url =
    `${API}?search_query=${encodeURIComponent(searchQuery)}` +
    `&start=0&max_results=${max}&sortBy=${sortBy}&sortOrder=descending`;

  const res = await fetch(url, { headers: { 'User-Agent': 'litsearch/1.0' } });
  if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
  const xml = await res.text();

  const totalM = xml.match(
    /<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/
  );
  const numFound = totalM ? Number(totalM[1]) : 0;

  const blocks = xml.split('<entry>').slice(1).map((s) => s.split('</entry>')[0]);
  const items = blocks.map((b) => {
    const authors = [];
    const re = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g;
    let m;
    while ((m = re.exec(b))) authors.push(squash(m[1]));
    const id = squash(pick(b, /<id>([\s\S]*?)<\/id>/));
    const pdfM = b.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);
    return {
      title: squash(pick(b, /<title>([\s\S]*?)<\/title>/)),
      published: squash(pick(b, /<published>([\s\S]*?)<\/published>/)).slice(0, 10),
      updated: squash(pick(b, /<updated>([\s\S]*?)<\/updated>/)).slice(0, 10),
      authors,
      summary: squash(pick(b, /<summary>([\s\S]*?)<\/summary>/)).slice(0, 400),
      category: pick(b, /<arxiv:primary_category[^>]*term="([^"]+)"/) ||
        pick(b, /<category[^>]*term="([^"]+)"/),
      comment: squash(pick(b, /<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/)),
      url: id,
      pdfUrl: pdfM ? unescapeXml(pdfM[1]) : id ? id.replace('/abs/', '/pdf/') : '',
    };
  }).filter((x) => x.title);

  return {
    source: 'arxiv',
    label: 'arXiv 预印本',
    keyword: searchQuery,
    numFound,
    items,
    queryUrl: url,
  };
}

module.exports = { search, query, buildQuery, API };

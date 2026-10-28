'use strict';
/**
 * sources/github.js — GitHub 仓库检索（纯 HTTP，零依赖，不需要浏览器）
 *
 * 为什么用它：你要找的"别人的模型和代码"主要在这里。
 * 直接看别人怎么把 Maxwell / FDTD / FEM 落到可运行的代码上。
 *
 * 接口：GET https://api.github.com/search/repositories?q=...&sort=stars&order=desc
 *
 * 注意：未认证时搜索接口限速 **10 次/分钟**。
 *       有 token 就设环境变量 GITHUB_TOKEN，限速放宽到 30 次/分钟。
 */

const API = 'https://api.github.com/search/repositories';

/**
 * 检索 GitHub 仓库
 * @param {string} keyword
 * @param {object} opts
 *   max      {number} 返回条数，默认 8（上限 30）
 *   lang     {string} 语言过滤，如 "python"
 *   minStars {number} 最低星数
 *   sort     {'stars'|'updated'|'best-match'} 默认 stars
 */
async function search(keyword, opts = {}) {
  const max = Math.min(Math.max(Number(opts.max) || 8, 1), 30);
  const parts = [String(keyword).trim()];
  if (opts.lang) parts.push(`language:${opts.lang}`);
  if (opts.minStars) parts.push(`stars:>=${Number(opts.minStars)}`);

  const sort = opts.sort === 'best-match' ? '' : (opts.sort || 'stars');
  const params = new URLSearchParams({
    q: parts.join(' '),
    per_page: String(max),
  });
  if (sort) {
    params.set('sort', sort);
    params.set('order', 'desc');
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'litsearch/1.0',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const url = `${API}?${params.toString()}`;
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = body && body.message ? body.message : `HTTP ${res.status}`;
    if (res.status === 403 || /rate limit/i.test(msg)) {
      throw new Error(
        `GitHub 限速了（未认证每分钟 10 次）。等一分钟再试，` +
          `或设置 GITHUB_TOKEN 环境变量。原始信息：${msg}`
      );
    }
    throw new Error(`GitHub 检索失败：${msg}`);
  }

  const items = (body.items || []).map((r) => ({
    name: r.full_name,
    stars: r.stargazers_count,
    forks: r.forks_count,
    // 截断：GitHub 上存在描述是几万字刷词列表的垃圾仓库，不截断会把终端刷爆
    description: (r.description || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    language: r.language || '',
    topics: (r.topics || []).slice(0, 8),
    updated: (r.pushed_at || '').slice(0, 10),
    url: r.html_url,
    license: r.license ? r.license.spdx_id : '',
  }));

  const res_ = {
    source: 'github',
    label: 'GitHub 代码仓库',
    keyword,
    numFound: body.total_count || 0,
    rateRemaining: res.headers.get('x-ratelimit-remaining'),
    items,
    queryUrl: url,
  };

  // 仓库名和描述基本都是英文：中文词要么搜不到，要么搜出一堆刷词垃圾仓库
  if (/[\u4e00-\u9fa5]/.test(String(keyword))) {
    res_.note =
      'GitHub 以英文为主，中文关键词的结果常是无关的刷词仓库。' +
      '建议用英文，例如：FDTD / "finite element" / "computational electromagnetics" / "method of moments"；' +
      '知网那条通路才是中文文献的主场。';
  } else if (!items.length) {
    res_.note = '没搜到。换个更通用的英文词，或试试 --lang=python 之外的写法。';
  }

  return res_;
}

module.exports = { search, API };

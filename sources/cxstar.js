'use strict';
/**
 * sources/cxstar.js — 畅想之星电子书检索（JSON 接口）
 *
 * 配置：域名见 config.local.js → cxstar（代码不含学校信息）
 * 认证：机构 IP（页头显示"IP用户 您好"即生效）
 * 检索：在站点页面上下文中 POST `/esapi/Book/Search`（JSON），返回 {data:[...], total}
 * 字段：ruid/title/author/isbn/publisher/pubdate/subject/abstract/readNum/ebookGC/paperGC/fullText
 * 书目：<SITE>/Book/Detail?ruid=<ruid>&pinst=<pinst>&packageruid=
 * `pinst` 是本校实例标识：从入口页 URL/链接里取（也可用 LITSEARCH_CXSTAR_PINST 覆盖）。
 * ⚠️ 限流：该站对同一出口 IP 很敏感（实测 20 条连发 → 429 + retry-after 3600 秒，
 *    整个校园网出口都会被封约 1 小时）。因此本模块**内置节流**：
 *    两次请求间隔 ≥ LITSEARCH_CXSTAR_GAP（默认 2500ms）；遇 429 直接报错、不重试。
 * 合规：只做检索+题录，不批量抓取、不转存。
 */

const { waitForReady, listTargets, newTab, CDP, sleep } = require('../cdp');
const CFG = require('../config');

const SITE = CFG.cxstar.site;
const SITE_HOST = (() => {
  try {
    return new URL(SITE).host;
  } catch {
    return '';
  }
})();

// 全局节流（同一进程内所有 cxstar 请求共享）
let lastRequestAt = 0;
const requestGap = () => Number(process.env.LITSEARCH_CXSTAR_GAP || 2500);

const strip = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function attachCxstar() {
  await waitForReady();
  let t = (await listTargets()).find((x) => (x.url || '').includes(SITE_HOST));
  if (!t) t = await newTab(`${SITE}/`);
  return new CDP(t.webSocketDebuggerUrl).connect();
}

/** 从页面里取 pinst（URL 或任意 a[href*=pinst]） */
async function resolvePinst(cdp) {
  if (process.env.LITSEARCH_CXSTAR_PINST) return process.env.LITSEARCH_CXSTAR_PINST;
  const p = await cdp
    .eval(
      `(function(){
        var m = location.search.match(/pinst=([^&]+)/);
        if (m) return m[1];
        var a = document.querySelector('a[href*="pinst="]');
        if (a) { var mm = (a.getAttribute('href')||'').match(/pinst=([^&]+)/); if (mm) return mm[1]; }
        return '';
      })()`,
      { timeoutMs: 8000 }
    )
    .catch(() => '');
  return p || '';
}

/**
 * 检索电子书
 * @param {string} keyword
 * @param {object} opts { rows, page }
 */
async function search(keyword, opts = {}) {
  const cdp = await attachCxstar();
  try {
    const size = Math.min(Math.max(Number(opts.rows) || 10, 1), 50);
    const page = Math.max(Number(opts.page) || 1, 1);
    // 先确保页面在站点内（同源 fetch 需要）
    const cur = await cdp.eval('location.origin', { timeoutMs: 8000 }).catch(() => '');
    if (cur !== new URL(SITE).origin) {
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url: `${SITE}/` });
      const dl = Date.now() + 15000;
      while (Date.now() < dl) {
        await sleep(150);
        if ((await cdp.eval('location.origin', { timeoutMs: 8000 }).catch(() => '')) === new URL(SITE).origin) break;
      }
    }
    const pinst = await resolvePinst(cdp);

    const body = {
      keyword,
      searchType: 'ALL',
      pinst,
      pubdate: '',
      page,
      size,
      publisher: '',
      type: '',
      author: '',
      sortField: '',
      sortType: '',
      ifbg: 0,
      packageId: '',
    };
    // 节流：避免连发触发整站限流（429 + retry-after 3600）
    const gap = requestGap() - (Date.now() - lastRequestAt);
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();

    const raw = await cdp
      .eval(
        `fetch('/esapi/Book/Search',{method:'POST',headers:{'Content-Type':'application/json'},` +
          `body:JSON.stringify(${JSON.stringify(body)})})` +
          `.then(function(r){` +
          `  return r.text().then(function(t){` +
          `    return JSON.stringify({s:r.status,ra:r.headers.get('retry-after')||'',t:t.slice(0,200000)});` +
          `  });` +
          `})`,
        { timeoutMs: 30000 }
      )
      .catch(() => '');
    let env = {};
    try {
      env = JSON.parse(raw || '{}');
    } catch {
      env = {};
    }
    if (env.s === 429) {
      throw new Error(
        `畅想之星限流 429（retry-after ${env.ra || '?'} 秒）：` +
          `同一出口 IP 被限，需等待解除或换网络；不要再连续批量检索`
      );
    }
    if (env.s && env.s !== 200) throw new Error(`畅想之星接口 HTTP ${env.s}`);
    let j = {};
    try {
      j = JSON.parse(env.t || '{}');
    } catch {
      throw new Error('畅想之星接口返回不是 JSON（可能未认证或页面结构变化）');
    }
    const list = Array.isArray(j.data) ? j.data : [];
    const items = list.map((x) => {
      const ruid = x.ruid || '';
      const detailUrl = ruid
        ? `${SITE}/Book/Detail?ruid=${ruid}&pinst=${encodeURIComponent(pinst)}&packageruid=`
        : '';
      const kind = [];
      if (Number(x.fullText) || Number(x.ebookGC) > 0) kind.push('电子');
      if (Number(x.paperGC) > 0) kind.push('纸本');
      return {
        title: strip(x.title),
        author: strip(x.author),
        publisher: strip(x.publisher),
        year: String(x.pubdate || '').slice(0, 4),
        date: x.pubdate || '',
        isbn: x.isbn || '',
        subject: strip(x.subject),
        abstract: strip(x.abstract).slice(0, 200),
        ruid,
        readNum: x.readNum || '',
        kind,
        detailUrl,
        // 兼容统一字段
        url: detailUrl,
        eCount: Number(x.ebookGC) > 0 || Number(x.fullText) ? 1 : 0,
        physicalCount: Number(x.paperGC) || 0,
      };
    });
    return {
      source: 'cxstar',
      label: '畅想之星电子书',
      keyword,
      onCampus: true,
      numFound: Number(j.total) || items.length,
      items,
      note: '电子书平台（畅想之星）；详情页需校园网 IP',
    };
  } finally {
    cdp.close();
  }
}

module.exports = { search, attachCxstar, resolvePinst, SITE };

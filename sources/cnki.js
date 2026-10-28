'use strict';
/**
 * sources/cnki.js — 中文论文库（知网类）检索
 *
 * 认证：机构 IP（.ecp_unitAccountName 显示机构名即生效，无需账号）
 * 检索：<SITE>/kns8s/defaultresult/index?kw=<关键词>
 * DOM ：.result-table-list tbody tr 结果行；td.name>a 标题+详情链接；td.author/source/date/data/download
 *       机构：.ecp_unitAccountName；总数：#countPageDiv .pagerTitleCell em
 * 外文：结果页 `.switch-ChEn a.en`（中文/外文开关，AJAX 重载、URL 不变）→ opts.en
 * 翻页：a#PageNext（AJAX，等首行标题变化）
 * 注意：`load` 事件极慢（可能 60s）→ 只等 URL 提交 + 表格稳定；长词/英文词拆词匹配差。
 * 合规：只做检索和元数据提取，不批量抓取、不整库转存、不再分发。
 */

const { waitForReady, listTargets, newTab, CDP, sleep } = require('../cdp');

const SITE = require('../config').cnki.site;

// --type → 知网"文献类型"侧栏筛选项（点它才是真正的类型限定检索）
const TYPE_FACET = {
  硕士: '学位论文',
  博士: '学位论文',
  学位论文: '学位论文',
  期刊: '学术期刊',
  学术期刊: '学术期刊',
  会议: '会议',
  会议论文: '会议',
  报纸: '报纸',
  图书: '图书',
  年鉴: '年鉴',
  专利: '专利',
  标准: '标准',
};
const SITE_HOST = (() => {
  try {
    return new URL(SITE).host;
  } catch {
    return '';
  }
})();
const SEARCH_BASE = `${SITE}/kns8s/defaultresult/index`;

/** 在页面里抽取一页结果的脚本（字符串形式，交给 CDP 执行） */
const EXTRACT_JS = `(function(){
  function clean(s){ return (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim(); }
  function cell(tr, sel){ var e = tr.querySelector(sel); return e ? clean(e.innerText) : ''; }

  var rows = Array.prototype.slice.call(
    document.querySelectorAll('.result-table-list tbody tr')
  );
  var items = rows.map(function(tr){
    var nameCell = tr.querySelector('td.name');
    var a = nameCell ? nameCell.querySelector('a') : null;
    var badge = nameCell ? nameCell.querySelector('b.marktip') : null;
    return {
      title:     a ? clean(a.innerText) : '',
      url:       a ? a.href : '',
      badge:     badge ? clean(badge.innerText) : '',
      author:    cell(tr, 'td.author'),
      source:    cell(tr, 'td.source'),
      date:      cell(tr, 'td.date'),
      type:      cell(tr, 'td.data'),
      downloads: cell(tr, 'td.download')
    };
  }).filter(function(x){ return x.title; });

  var inst = document.querySelector('.ecp_unitAccountName');
  var totalEm = document.querySelector('#countPageDiv .pagerTitleCell em');
  var pageMark = document.querySelector('#countPageDiv .countPageMark');

  var lines = (document.body.innerText || '')
    .split('\\n').map(function(s){ return s.trim(); }).filter(Boolean);
  var known = /^(总库|学术期刊|学位论文|会议|图书|报纸|专利|标准|成果|年鉴|学术辑刊|外文文献|法律法规)$/;
  var cats = {};
  for (var i = 0; i < lines.length - 1; i++) {
    if (known.test(lines[i]) && /^[\\d,]+$/.test(lines[i + 1])) {
      cats[lines[i]] = Number(lines[i + 1].replace(/,/g, ''));
    }
  }

  return JSON.stringify({
    institution: inst ? clean(inst.innerText) : '',
    numFound: totalEm ? Number(String(totalEm.innerText).replace(/[^\\d]/g, '')) : 0,
    totalPages: pageMark ? Number(pageMark.getAttribute('data-pagenum') || 0) : 0,
    categories: cats,
    items: items,
    pageUrl: location.href
  });
})()`;

/** 结果就绪的判定条件（有行，或明确无结果） */
const READY_COND =
  `document.querySelectorAll('.result-table-list tbody tr').length > 0` +
  ` || /暂无数据|没有找到|抱歉|无检索结果/.test(document.body.innerText)`;

function searchUrl(keyword) {
  return `${SEARCH_BASE}?kw=${encodeURIComponent(keyword)}`;
}

/** 连到知网标签页，没有就开一个 */
async function attachCnki() {
  await waitForReady();
  let t = (await listTargets()).find((x) => (x.url || '').includes(SITE_HOST));
  // newTab 立刻返回 target，不用等它加载完（紧接着就 goto 检索页）
  if (!t) t = await newTab(`${SITE}/`);
  return new CDP(t.webSocketDebuggerUrl).connect();
}

/**
 * 切到"外文"库（知网结果页左侧 中文/外文 开关）。
 * ⚠️ 该开关**不改 URL**，纯 AJAX 重载；所以只能点击，然后等首行标题变化。
 */
async function switchToForeign(cdp, prevFirstTitle) {
  const clicked = await cdp
    .eval(
      `(function(){var a=document.querySelector('.switch-ChEn a.en');if(!a)return false;a.click();return true;})()`,
      { timeoutMs: 10000 }
    )
    .catch(() => false);
  if (!clicked) return false;
  const changed = await cdp.waitFor(
    `(function(){var a=document.querySelector('.result-table-list tbody tr td.name a');` +
      `return a && a.innerText.trim() !== ${JSON.stringify(prevFirstTitle)};})()`,
    { timeoutMs: 20000, pollMs: 250 }
  );
  return !!changed;
}

/**
 * 打开检索页并等结果渲染出来。
 *
 * 踩过的坑：Chrome **刚启动**时知网首屏 JS 很重，30s 内可能渲染不完。
 * 若此时不检查就取值，会拿到 items=[] / institution='' —— 也就是**静默返回 0 条**，
 * 看起来像"这个关键词没结果"，极难排查。
 * 所以这里：等待放宽到 60s，并且明确返回 false 让上层决定重试或报错。
 */
async function openAndWait(cdp, keyword, opts = {}) {
  // ⚠️ 不要等 load 事件：知网页面重，load 常要 ~60s 才触发（实测每条命令白等满 60s），
  //    结果表格其实早就渲染好了。这里只等"导航已提交（URL 变了）"，再等表格渲染稳定。
  const url = searchUrl(keyword);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url });
  const navDeadline = Date.now() + 15000;
  while (Date.now() < navDeadline) {
    await sleep(120);
    const cur = await cdp.eval('location.href', { timeoutMs: 8000 }).catch(() => '');
    if (cur === url) break;
  }
  const ready = await cdp.waitFor(READY_COND, { timeoutMs: 45000, pollMs: 300 });
  if (!ready) return null;
  // 等表格行数连续两次不变（页面是渐进渲染的，取早了会漏行）
  let last = -1;
  let stable = 0;
  const settleDeadline = Date.now() + 8000;
  while (Date.now() < settleDeadline) {
    const n = await cdp
      .eval(`document.querySelectorAll('.result-table-list tbody tr').length`, { timeoutMs: 8000 })
      .catch(() => -1);
    if (n > 0 && n === last) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
      last = n;
    }
    await sleep(250);
  }
  // 等角标 / 下载数补齐，但设上限
  await cdp.waitFor(`document.querySelectorAll('.result-table-list tbody tr td.download').length > 0`, {
    timeoutMs: 800,
    pollMs: 150,
  });
  const first = JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));

  // --en：切到外文库（中文/外文开关，AJAX，不改 URL）
  if (opts.en) {
    const prev = first.items.length ? first.items[0].title : '';
    const switched = await switchToForeign(cdp, prev);
    if (switched) {
      await sleep(400);
      return JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));
    }
  }
  return first;
}

/**
 * 检索知网总库
 * @param {string} keyword 关键词
 * @param {object} opts
 *   pages {number}  抓几页，默认 1
 *   type  {string}  客户端按文献类型过滤，如 "硕士" / "博士" / "期刊" / "会议"
 *                   （知网的分类 tab 是 JS 点击控件，参数未标定，故做客户端过滤）
 *   en    {boolean} true=切到"外文"库（点 中文/外文 开关，AJAX 重载，URL 不变）
 * @returns {Promise<object>}
 */
async function search(keyword, opts = {}) {
  const pages = Math.max(1, Number(opts.pages) || 1);
  const cdp = await attachCnki();
  try {
    let first = await openAndWait(cdp, keyword, opts);

    // 既没结果、也没机构信息 → 判定为渲染失败（而不是真的没结果），重载一次
    if (!first || (!first.items.length && !first.institution)) {
      first = await openAndWait(cdp, keyword, opts);
    }
    if (!first) {
      throw new Error(
        '知网结果页在 60s 内没渲染出结果表格。可能是网络慢或触发了反爬校验；重跑一次通常就好。'
      );
    }
    if (!first.items.length && !first.institution) {
      throw new Error(
        '知网页面既没有结果行、也没有机构信息，判定为静默失败（不是"没搜到"）。请重跑。'
      );
    }

    // --type：先点侧栏"文献类型"筛选项（真·类型限定），学位论文再按硕/博二次筛
    let typeFacet = '';
    let facetApplied = false;
    if (opts.type && TYPE_FACET[String(opts.type)] && !opts.en) {
      const label = TYPE_FACET[String(opts.type)];
      const before = await cdp
        .eval(`(document.querySelector('.pagerTitleCell, .page-box, #countPageDiv')||{}).innerText || ''`)
        .catch(() => '');
      const clicked = await cdp
        .eval(
          `(function(){
            var els = [].slice.call(document.querySelectorAll('ul.doctype-menus li a span, ul.doctype-menus li span'));
            var e = els.filter(function(x){ return x.offsetParent && (x.innerText||'').trim() === ${JSON.stringify(label)}; })[0];
            if (!e) return false;
            e.click(); return true;
          })()`,
          { timeoutMs: 15000 }
        )
        .catch(() => false);
      if (clicked) {
        typeFacet = label;
        const changed = await cdp.waitFor(
          `(function(){
             var cur = (document.querySelector('.pagerTitleCell, .page-box, #countPageDiv')||{}).innerText || '';
             var tr = document.querySelector('.result-table-list tbody tr');
             var d = tr && tr.querySelector('td.data');
             var t = d ? (d.innerText||'').trim() : '';
             var typeOk = ${JSON.stringify(label)} === '学位论文' ? (t === '硕士' || t === '博士') : true;
             return cur !== ${JSON.stringify(before)} && typeOk;
           })()`,
          { timeoutMs: 25000, pollMs: 400 }
        ).catch(() => false);
        await sleep(300);
        // 重抽（numFound 已是该类型库的数量）
        first = JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));
        // 该状态下知网行内"类型"字段可能为空 → 用 facet 名兜底，避免显示"文献"
        first.items = (first.items || []).map((x) => ({
          ...x,
          type: x.type || (label === '学术期刊' ? '期刊' : label),
        }));
        facetApplied = !!changed;
      }
    }

    let items = first.items.slice();
    const seen = new Set(items.map((x) => x.url || x.title));

    // 翻页
    for (let p = 2; p <= pages; p++) {
      // 翻页判据必须比较"同一位置"（首行标题）翻页前后是否变化；
      // 之前拿首行去比上一页末行，条件恒真 → 点完立刻抽到旧页（翻页失效）
      const prevFirst = await cdp
        .eval(`(document.querySelector('.result-table-list tbody tr td.name a')||{}).innerText || ''`)
        .catch(() => '');
      const clicked = await cdp.eval(
        `(function(){ var b = document.querySelector('#PageNext');` +
          ` if (!b) return false; b.scrollIntoView(); b.click(); return true; })()`
      );
      if (!clicked) break;
      const changed = await cdp.waitFor(
        `(function(){ var a = document.querySelector('.result-table-list tbody tr td.name a');` +
          ` return a && a.innerText.trim() !== ${JSON.stringify(prevFirst)}; })()`,
        { timeoutMs: 30000, pollMs: 400 }
      );
      if (!changed) break;
      await sleep(250);
      const next = JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));
      const fresh = next.items.filter((x) => !seen.has(x.url || x.title));
      if (!fresh.length) break;
      fresh.forEach((x) => seen.add(x.url || x.title));
      items = items.concat(fresh);
    }

    const scannedRows = items.length;
    if (opts.type) {
      const want = String(opts.type);
      if (facetApplied && typeFacet === '学位论文') {
        items = items.filter((x) => (x.type || '').includes(want));
      } else if (!facetApplied) {
        items = items.filter((x) => (x.type || '').includes(want) || (x.source || '').includes(want));
      }
    }

    return {
      source: 'cnki',
      label: '知网 CNKI',
      keyword,
      onCampus: !!first.institution,
      institution: first.institution,
      numFound: first.numFound,
      totalPages: first.totalPages,
      categories: first.categories,
      fetchedPages: pages,
      typeFilter: opts.type ? String(opts.type) : '',
      typeFacet,
      facetApplied,
      scannedPages: pages,
      scannedRows,
      items,
    };
  } finally {
    cdp.close();
  }
}

module.exports = { search, searchUrl, attachCnki, SITE, SEARCH_BASE };

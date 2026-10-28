'use strict';
/**
 * sources/huya.js — 电子书平台（超星汇雅类）检索
 *
 * 配置：域名 + websiteId 见 config.local.js → huya（代码不含学校信息）
 * 认证：机构 IP 自动认证（页面显示"欢迎来自 <机构> 的用户"即生效）
 * 检索：<SITE>/book/search?sw=<词>&field=1(书名)/2(作者)/3(目录)/4(全文)&fromType=portal&websiteId=<id>
 * 卡片：li.zli_info（外层 li.zli_item）；阅读链接 a[href*=reader]（含 ssid 与 d/enc/t 签名）
 * ⚠️ d/enc/t 是**时效签名**：必须当场搜当场用；不要落盘传播。
 * ⚠️ `/book/detail?ssid=` 路由实测 404 → 本模块**不输出 detailUrl**，只给 readUrl 与 ssid。
 * 合规：站点明示"仅供非商业学习教学研究使用，严禁外传"；本模块只做检索。
 */

const { waitForReady, listTargets, newTab, CDP, sleep } = require('../cdp');
const CFG = require('../config');

const SITE = CFG.huya.site;
const WEBSITE_ID = CFG.huya.websiteId;
const SITE_HOST = (() => {
  try {
    return new URL(SITE).host;
  } catch {
    return '';
  }
})();
const FIELD = { bookname: 1, author: 2, catalog: 3, fulltext: 4 };

const READY_COND =
  `document.querySelectorAll('li.zli_info').length > 0` +
  ` || /没有找到|暂无|无相关|检索条件异常/.test(document.body.innerText)`;

const EXTRACT_JS = `(function(){
  function clean(s){ return (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim(); }
  var txt = document.body.innerText || '';
  var m = txt.match(/共\\s*([\\d,]+)\\s*条/);
  var agency = (txt.match(/欢迎来自(.+?)的用户/) || [])[1] || '';
  var cards = Array.prototype.slice.call(document.querySelectorAll('li.zli_info'));
  var items = cards.map(function(card){
    var s = clean(card.innerText);
    var links = Array.prototype.slice.call(card.querySelectorAll('a[href*="reader"]')).map(function(a){
      return { kind: clean(a.innerText), href: a.getAttribute('href') || '' };
    });
    var path = links.filter(function(l){ return /jpathreader/.test(l.href); })[0] || links[0] || null;
    var h2a = card.querySelector('h2.zli_i_h2 a') || card.querySelector('h2 a');
    var title = h2a ? clean(h2a.getAttribute('title') || h2a.innerText) : '';
    var cardUrl = h2a ? (h2a.getAttribute('href') || '') : '';
    if (!title) title = clean((s.split(' 主题词')[0] || '').replace(/^\\d+[.、]\\s*/, ''));
    return {
      title: title,
      author: (s.match(/作者 (.*?) 出版日期/) || [])[1] || '',
      publisher: (s.match(/出版社 (.*?) 页数/) || [])[1] || '',
      year: ((s.match(/出版日期 ([\\d]{4})/) || [])[1] || ''),
      date: (s.match(/出版日期 ([\\d\\.]+)/) || [])[1] || '',
      pages: (s.match(/页数 ([\\d]+)/) || [])[1] || '',
      clc: (s.match(/中图分类号 (\\S+)/) || [])[1] || '',
      isbn: (s.match(/ISBN ([\\d\\-Xx]+)/) || [])[1] || '',
      ssid: path ? ((path.href.match(/ssid=(\\d+)/) || [])[1] || '') : '',
      kinds: links.map(function(l){ return l.kind; }).filter(Boolean),
      readUrl: path ? path.href : '',
      cardUrl: cardUrl
    };
  }).filter(function(x){ return x.title || x.ssid; });
  return JSON.stringify({ numFound: m ? Number(m[1].replace(/,/g,'')) : 0, agency: agency, items: items });
})()`;

async function attachHuya() {
  await waitForReady();
  let t = (await listTargets()).find((x) => (x.url || '').includes(SITE_HOST));
  if (!t) t = await newTab(`${SITE}/`);
  return new CDP(t.webSocketDebuggerUrl).connect();
}

/**
 * 检索电子书
 * @param {string} keyword
 * @param {object} opts { field: 'bookname'|'author'|'catalog'|'fulltext', page, rows }
 */
async function search(keyword, opts = {}) {
  const cdp = await attachHuya();
  try {
    const fieldNum = FIELD[opts.field] || 1;
    const url =
      `${SITE}/book/search?sw=${encodeURIComponent(keyword)}` +
      `&field=${fieldNum}&fromType=portal&websiteId=${encodeURIComponent(WEBSITE_ID || '')}` +
      (opts.page ? `&page=${opts.page}` : '');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url });
    const navDeadline = Date.now() + 15000;
    while (Date.now() < navDeadline) {
      await sleep(120);
      const cur = await cdp.eval('location.href', { timeoutMs: 8000 }).catch(() => '');
      if (cur && cur.split('?')[0] === url.split('?')[0]) break;
    }
    const ready = await cdp.waitFor(READY_COND, { timeoutMs: 45000, pollMs: 300 });
    if (!ready) throw new Error('汇雅检索页 45s 内没渲染出结果（检查校园网/站点是否可用）');
    // 渐进渲染：等卡片数连续两次不变
    let last = -1;
    let stable = 0;
    const dl = Date.now() + 8000;
    while (Date.now() < dl) {
      const n = await cdp
        .eval(`document.querySelectorAll('li.zli_info').length`, { timeoutMs: 8000 })
        .catch(() => -1);
      if (n > 0 && n === last) {
        if (++stable >= 2) break;
      } else {
        stable = 0;
        last = n;
      }
      await sleep(250);
    }
    const data = JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));
    const items = (data.items || []).map((x) => ({
      ...x,
      // readUrl 是相对路径时补全；detailUrl 一律不输出（该路由 404）
      readUrl: x.readUrl ? (x.readUrl.charAt(0) === '/' ? SITE + x.readUrl : x.readUrl) : '',
      cardUrl: x.cardUrl ? (x.cardUrl.charAt(0) === '/' ? SITE + x.cardUrl : x.cardUrl) : '',
      detailUrl: '',
    }));
    const want = Number(opts.rows) || 0;
    return {
      source: 'huya',
      label: '汇雅电子书',
      keyword,
      onCampus: !!data.agency,
      institution: data.agency || '',
      numFound: data.numFound || 0,
      items: want ? items.slice(0, want) : items,
      note:
        (opts.field === 'fulltext'
          ? '⚠️ 该站「全文检索」对 IP 认证不开放（需个人账号登录），通常返回 0 条；' +
            '请改用 bookname/catalog/author。'
          : '') + '阅读链接(readUrl)带时效签名，必须当场使用；不要保存/转发',
    };
  } finally {
    cdp.close();
  }
}

module.exports = { search, attachHuya, SITE, FIELD };

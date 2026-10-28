'use strict';
/**
 * sources/duxiu.js — 读秀学术搜索（图书检索）
 *
 * 配置：域名见 config.local.js → duxiu（代码不含学校信息）
 * 认证：机构 IP（页头显示"欢迎来自 <机构> 的朋友"即生效）
 *
 * ⚠️ 编码坑：读秀结果页按 **GBK** 解析 `sw`。Node 没有内置 GBK 编码器，
 *    因此本模块**不用 URL 拼参**，而是在页面上动态建
 *    `<form accept-charset="GBK" method="GET" action="https://book.duxiu.com/search">`
 *    提交，让浏览器按页面编码生成 GBK 参数（实测标题/结果都正确）。
 *
 * 结果结构：`div.books li`，每条含隐藏字段：
 *   input#title<k>（标题，带 <font> 高亮）、input#url<k>（bookDetail 详情链接）、
 *   input#dxid<k>、input#ssid<k>，以及 `dl` 里的作者/出版社/年份等。
 *
 * 合规：只做检索+题录；"文献传递"需本人邮箱/配额，工具不代提交。
 */

const { waitForReady, listTargets, newTab, CDP, sleep } = require('../cdp');
const CFG = require('../config');

const SITE = CFG.duxiu.site;
const SITE_HOST = (() => {
  try {
    return new URL(SITE).host;
  } catch {
    return '';
  }
})();

const READY_COND =
  `document.querySelectorAll('div.books li').length > 0` +
  ` || /没有找到|无相关|抱歉/.test(document.body.innerText)`;

const EXTRACT_JS = `(function(){
  function strip(s){ return (s == null ? '' : String(s)).replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim(); }
  var lis = Array.prototype.slice.call(document.querySelectorAll('div.books li'));
  var items = lis.map(function(li){
    function hidden(name){
      var e = li.querySelector('input[id^="' + name + '"]');
      return e ? e.value : '';
    }
    var title = strip(hidden('title'));
    var url = hidden('url');
    var dxid = hidden('dxid');
    var ssid = hidden('ssid');
    var dl = li.querySelector('dl');
    var raw = dl ? (dl.innerText || '') : '';
    var lines = raw.split('\\n').map(function(x){ return x.trim(); }).filter(Boolean);
    if (!title) {
      var tline = lines.filter(function(x){ return /《.+》/.test(x); })[0] || '';
      title = strip((tline.match(/《(.+?)》/) || [])[1] || '');
    }
    var author = '';
    for (var i = 0; i < lines.length; i++) {
      if (/^作者[：:]/.test(lines[i])) {
        var inline = lines[i].replace(/^作者[：:]\\s*/, '');
        author = inline || (lines[i + 1] || '');
        break;
      }
    }
    var joined = lines.join(' ');
    var year = (joined.match(/出版日期[：:]\\s*((19|20)\\d{2})/) || [])[1] || '';
    var publisher =
      (joined.match(/(?:出版社|出版发行)[：:]\\s*([^ ]+)/) || [])[1] ||
      (joined.match(/([\\u4e00-\\u9fa5]+出版社)/) || [])[1] ||
      '';
    var avail = [];
    var inGet = false;
    for (var j = 0; j < lines.length; j++) {
      if (/^获取[：:]/.test(lines[j])) { inGet = true; continue; }
      if (inGet) {
        if (/收藏馆|总被引/.test(lines[j])) { inGet = false; continue; }
        avail.push(lines[j]);
      }
    }
    if (!avail.length) {
      if (/文献传递/.test(raw)) avail.push('文献传递');
      if (/汇雅|包库/.test(raw)) avail.push('电子书');
    }
    var cite = (joined.match(/总被引[：:]\\s*(\\d+)/) || [])[1] || '';
    if (url) {
      url = url.indexOf('//') >= 0 ? url : ('https://book.duxiu.com' + url);
      url = url.replace(/^(https?:\\/\\/[^/]+)\\/\\/+/, '$1/');
    }
    return {
      title: title, author: author, publisher: publisher, year: year,
      cite: cite, avail: avail, dxid: dxid, ssid: ssid, url: url
    };
  }).filter(function(x){ return x.title; }); // 只按标题过滤：没链接也保留题录，别丢条目
  var body = document.body.innerText || '';
  var agency = (body.match(/欢迎来自(.+?)的(?:朋友|用户)/) || [])[1] || '';
  return JSON.stringify({ items: items, agency: agency });
})()`;

async function attachDuxiu() {
  await waitForReady();
  let t = (await listTargets()).find((x) => (x.url || '').includes(SITE_HOST));
  if (!t) t = await newTab(`${SITE}/`);
  return new CDP(t.webSocketDebuggerUrl).connect();
}

/**
 * 检索读秀（图书）
 * @param {string} keyword
 * @param {object} opts { rows }
 */
async function search(keyword, opts = {}) {
  const cdp = await attachDuxiu();
  try {
    // 1) 回到读秀首页（表单必须挂在本站页面上下文）
    await cdp.send('Page.enable');
    const origin = new URL(SITE).origin;
    const cur = await cdp.eval('location.origin', { timeoutMs: 8000 }).catch(() => '');
    if (cur !== origin) {
      await cdp.send('Page.navigate', { url: `${SITE}/` });
      const dl = Date.now() + 15000;
      while (Date.now() < dl) {
        await sleep(150);
        if ((await cdp.eval('location.origin', { timeoutMs: 8000 }).catch(() => '')) === origin) break;
      }
    }

    // 2) 等 document.body 就绪（跨域导航刚完成时 body 可能为 null）
    const bodyDeadline = Date.now() + 15000;
    let bodyReady = false;
    while (Date.now() < bodyDeadline) {
      bodyReady = await cdp
        .eval('!!document.body && document.readyState !== "loading"', { timeoutMs: 8000 })
        .catch(() => false);
      if (bodyReady) break;
      await sleep(150);
    }
    if (!bodyReady) throw new Error('读秀首页 15s 内 body 未就绪（导航未完成）');

    // 3) 动态建 GBK 表单并提交（让浏览器按 GBK 编码参数）
    const injectForm = `(function(){
      var f = document.createElement('form');
      f.method = 'GET';
      f.action = 'https://book.duxiu.com/search';
      f.acceptCharset = 'GBK';
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = 'sw'; i.value = ${JSON.stringify(keyword)};
      f.appendChild(i);
      var c = document.createElement('input');
      c.type = 'hidden'; c.name = 'channel'; c.value = 'search';
      f.appendChild(c);
      var host = document.body || document.documentElement;
      if (!host) throw new Error('no body');
      host.appendChild(f);
      f.submit();
      return 1;
    })()`;
    let submitted = false;
    for (let attempt = 0; attempt < 2 && !submitted; attempt++) {
      try {
        await cdp.eval(injectForm, { timeoutMs: 15000 });
        submitted = true;
      } catch (e) {
        if (attempt === 1) throw e;
        await sleep(600);
      }
    }

    // 4) 等结果
    const navDeadline = Date.now() + 15000;
    while (Date.now() < navDeadline) {
      await sleep(150);
      const u = await cdp.eval('location.href', { timeoutMs: 8000 }).catch(() => '');
      if (/book\.duxiu\.com\/search/.test(u || '')) break;
    }
    const ready = await cdp.waitFor(READY_COND, { timeoutMs: 45000, pollMs: 300 });
    if (!ready) throw new Error('读秀结果页 45s 内没渲染出来（检查校园网/站点）');
    // 页面已明确显示"无结果"时，不再等渐进渲染（省 8s+），直接抽取返回
    const noResult = await cdp
      .eval(`/未找到|没有找到|无相关|暂无|无结果|没有结果|抱歉|无检索结果|无数据|没有数据|未检索到|检索结果为空/.test(document.body.innerText)`, { timeoutMs: 8000 })
      .catch(() => false);

    // 5) 稳定后再抽取
    let last = -1;
    let stable = 0;
    const dl2 = Date.now() + 8000;
    while (!noResult && Date.now() < dl2) {
      const n = await cdp
        .eval(`document.querySelectorAll('div.books li').length`, { timeoutMs: 8000 })
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
    let items = (data.items || []).map((x) => ({
      title: x.title,
      author: x.author,
      publisher: x.publisher,
      year: x.year,
      meta: x.detail,
      avail: x.avail || [],
      cite: x.cite || '',
      dxid: x.dxid,
      ssid: x.ssid,
      url: x.url,
    }));
    const rows = Number(opts.rows) || 0;
    if (rows) items = items.slice(0, rows);
    return {
      source: 'duxiu',
      label: '读秀（图书）',
      keyword,
      onCampus: !!data.agency,
      institution: data.agency || '',
      numFound: (data.items || []).length,
      numFoundApprox: true,
      items,
      note: '读秀为 GBK 编码站点（已用页面表单规避）；文献传递需本人邮箱，工具不代提交',
    };
  } finally {
    cdp.close();
  }
}

module.exports = { search, attachDuxiu, SITE };

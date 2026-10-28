'use strict';
/**
 * sources/_template-browser.js — 新增「浏览器渠道」骨架（复制改名即可）
 *
 * 适用：必须在真实页面上下文里跑（同源 cookie / 反爬 JS）的站点。
 * 参考实现：sources/opac.js（接口型）、sources/spis.js（DOM+注册型）
 * 详细方法论见 docs/加渠道方法论.md
 *
 * 关键纪律：
 *   1. 不要等 `load` 事件（有的站 load 要 60s）→ 等 URL + 结果容器 + 数量稳定；
 *   2. 抽取用一段注入 JS 返回 JSON 字符串；
 *   3. 需要"点开才能取链接"的，批量做（Promise.all），不要逐条 sleep。
 */

const { waitForReady, listTargets, newTab, CDP, sleep } = require('../cdp');

const SITE = 'https://<站点域名>';
const SITE_HOST = new URL(SITE).host;

const READY_COND = `document.querySelectorAll('<结果条目选择器>').length > 0`;

const EXTRACT_JS = `(function(){
  function clean(s){ return (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim(); }
  var items = Array.prototype.slice.call(document.querySelectorAll('<结果条目选择器>')).map(function(el){
    return {
      title: clean((el.querySelector('<标题选择器>') || {}).innerText),
      author: clean((el.querySelector('<作者选择器>') || {}).innerText),
      year: clean((el.querySelector('<年份选择器>') || {}).innerText),
      url: (el.querySelector('a[href]') || {}).href || ''
    };
  }).filter(function(x){ return x.title; });
  return JSON.stringify({ items: items });
})()`;

async function attach() {
  await waitForReady();
  let t = (await listTargets()).find((x) => (x.url || '').includes(SITE_HOST));
  if (!t) t = await newTab(`${SITE}/`);
  return new CDP(t.webSocketDebuggerUrl).connect();
}

async function search(keyword, opts = {}) {
  const cdp = await attach();
  try {
    const url = `${SITE}/search?q=${encodeURIComponent(keyword)}`;
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url });

    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      await sleep(300);
      ready = await cdp.waitFor(READY_COND, { timeoutMs: 2000, pollMs: 200 }).catch(() => false);
      if (ready) break;
    }
    if (!ready) throw new Error('结果页 45s 内没渲染出来');

    const data = JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));
    const rows = Number(opts.rows) || 0;
    const items = rows ? (data.items || []).slice(0, rows) : data.items || [];
    return { source: 'xxx', label: '某站', keyword, numFound: items.length, items };
  } finally {
    cdp.close();
  }
}

module.exports = { search, attach, SITE };

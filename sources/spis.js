'use strict';
/**
 * sources/spis.js — 外文文献发现系统（SPIS 类）检索
 *
 * 认证：机构 IP（页头 span.username 显示机构名即生效，无需账号）
 * 检索：<SITE>/scholar/list?val=<关键词>；一页 10 条，卡片 article.article
 * DOM ：.d-t 标题 / .d-a 作者-年-来源 / .collect-list span 收录体系 /
 *       .action-button.quote 被引 / .action-button.download a[href] 内含 OA PDF 直链 /
 *       a[data-dataid] 文章 gid（注意：**部分卡片没有这个锚点**）
 * 详情：<SITE>/scholar/detail/<gid>；未"注册"的裸链会 404 →
 *       用列表接口完整字段 POST /api/article/saveDetail 注册，
 *       再打 /api/article/data/<gid> 复核（body 是对象=通过）；注册不上才点击兜底。
 * 注意：同一关键词结果集每次浮动；翻页是 AJAX（.pagination-number，URL 不变）。
 * 合规：只做检索+题录；"文献求助"需本人邮箱，工具不代提交。
 */

const { waitForReady, listTargets, newTab, closeTab, CDP, sleep } = require('../cdp');

const SITE = require('../config').spis.site;
const SITE_HOST = (() => {
  try {
    return new URL(SITE).host;
  } catch {
    return '';
  }
})();
const SEARCH_BASE = `${SITE}/scholar/list`;

/** 抽取一页结果的脚本 */
const EXTRACT_JS = `(function(){
  function clean(s){ return (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim(); }

  var articles = Array.prototype.slice.call(document.querySelectorAll('article.article'));
  var items = articles.map(function(a){
    var t = a.querySelector('.d-t');
    var title = t ? clean(t.innerText).replace(/^\\d+、\\s*/, '') : '';

    // 详情页"候选地址"：点标题跳转用的就是 /scholar/detail/<data-dataid>。
    // ⚠️ 但这只是候选——记录未被"注册"过时裸链会 404（注册=POST saveDetail，见 resolveDetailUrls）；
    //    真正可用的地址由 resolveDetailUrls() **点出来**后覆盖。
    var dA = a.querySelector('.d-t a[href]') || a.querySelector('a[href*="/scholar/detail/"]');
    var titleHref = dA ? (dA.href || dA.getAttribute('href') || '') : '';
    if (titleHref && titleHref.charAt(0) === '/') titleHref = '${SITE}' + titleHref;

    var metaEl = a.querySelector('.d-a');
    var meta = metaEl ? clean(metaEl.getAttribute('title') || metaEl.innerText) : '';

    var badges = Array.prototype.slice.call(a.querySelectorAll('.collect-list span'))
      .map(function(s){ return clean(s.innerText); }).filter(Boolean);

    var snipEl = a.querySelector('.d-d');
    var quoteEl = a.querySelector('.action-button.quote');
    var srcA = a.querySelector('.action-button.source a');
    var dlA = a.querySelector('.action-button.download a');
    var deliv = a.querySelector('.action-button.delivery');

    // 文章 gid 挂在卡片里带 data-dataid 的 <a>（class="link-site_icon"）上；
    // 它的 href 是 /api/article/redirect?url=<出版社原文链接>&title=...。
    var jumpA = a.querySelector('a[data-dataid]');
    var gid = jumpA ? (jumpA.getAttribute('data-dataid') || '') : '';

    var viaHref = jumpA ? (jumpA.getAttribute('href') || '') : '';
    var articleUrl = '';
    if (viaHref) {
      var vm = viaHref.match(/[?&]url=([^&]+)/);
      if (vm) { try { articleUrl = decodeURIComponent(vm[1]); } catch (e) { articleUrl = vm[1]; } }
    }

    // 下载按钮的 href 形如 /api/article/downloadLog?id=g-xxx&link=<编码后的真实PDF直链>&title=...
    var dlHref = dlA ? dlA.getAttribute('href') : '';
    var pdf = '';
    if (dlHref) {
      var m = dlHref.match(/[?&]link=([^&]+)/);
      if (m) { try { pdf = decodeURIComponent(m[1]); } catch (e) { pdf = m[1]; } }
    }

    return {
      title: title,
      meta: meta,
      badges: badges,
      snippet: snipEl ? clean(snipEl.innerText) : '',
      citations: quoteEl ? (clean(quoteEl.innerText).match(/\\d+/) || [''])[0] : '',
      sourceSite: srcA ? clean(srcA.innerText) : '',
      gid: gid,
      // 出版社原文页（可直接点开）
      articleUrl: articleUrl,
      // 站内详情页：优先用标题锚点给的地址，其次按 gid 拼
      // 候选详情地址（未验证）；detailLinks 模式下会被"注册+复核"通过的地址覆盖并置 detailVerified
      detailUrl: titleHref ? titleHref : (gid ? ('${SITE}/scholar/detail/' + gid) : ''),
      detailVerified: false,
      hasDownload: !!dlA,
      canRequest: !!deliv,
      pdfUrl: pdf
    };
  }).filter(function(x){ return x.title; });

  var inst = document.querySelector('span.username');
  var pageBox = document.querySelector('.page-box');
  var pageText = pageBox ? clean(pageBox.innerText) : '';
  var tm = pageText.match(/共\\s*([\\d,]+)\\s*条/);

  return JSON.stringify({
    institution: inst ? clean(inst.innerText) : '',
    numFound: tm ? Number(tm[1].replace(/,/g, '')) : 0,
    pageText: pageText,
    items: items
  });
})()`;

// 纬度"无结果"文案实测是「未找到与检索词相关的内容或信息」，
// 之前只匹配"暂无数据/没有找到/无相关结果"→ 无结果时被误判成"页面没渲染"，
// 白等 45s×2 后报"网络慢"。这里补齐所有已知无结果文案。
const READY_COND =
  `document.querySelectorAll('article.article').length > 0` +
  ` || /暂无数据|没有找到|无相关结果|未找到|无结果|没有结果/.test(document.body.innerText)`;

function searchUrl(keyword) {
  return `${SEARCH_BASE}?val=${encodeURIComponent(keyword)}`;
}

async function attachSpis() {
  await waitForReady();
  let t = (await listTargets()).find((x) => (x.url || '').includes(SITE_HOST));
  // newTab 立刻返回 target，不需要等它加载完（紧接着就会 goto 检索页）
  if (!t) t = await newTab(`${SITE}/`);
  return new CDP(t.webSocketDebuggerUrl).connect();
}

/**
 * 打开检索页并等结果渲染。冷启动时 SPA 首屏较慢：等不到就返回 null，
 * 由上层决定重试或报错——**绝不静默返回 0 条**。
 */
async function openAndWait(cdp, keyword) {
  // ⚠️ 不能等 load 事件：SPIS 页面有个慢资源，load 常要 ~60s 才触发（实测每次白等满超时），
  //    而检索结果早就渲染好了。这里只等"导航已提交（URL 已变）"，再等服务端渲染出卡片。
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
  // 页面已明确显示"无结果"时，不再等渐进渲染（省 8s+），直接抽取返回
  const noResult = await cdp
    .eval(`/未找到|没有找到|无相关|暂无|无结果|没有结果|抱歉|无检索结果|无数据|没有数据|未检索到|检索结果为空/.test(document.body.innerText)`, { timeoutMs: 8000 })
    .catch(() => false);
  if (noResult) {
    const d0 = JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));
    d0.noResult = true;
    return d0;
  }
  // 页面是**渐进渲染**的：READY 只代表"出现了第一条"，取早了会漏掉后面的卡片。
  // 这里等卡片数量连续两次不变（最多 8s），再取。
  let last = -1;
  let stable = 0;
  const settleDeadline = Date.now() + 8000;
  while (Date.now() < settleDeadline) {
    const n = await cdp
      .eval(`document.querySelectorAll('article.article').length`, { timeoutMs: 8000 })
      .catch(() => -1);
    if (n > 0 && n === last) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
      last = n;
    }
    await sleep(250);
  }
  // 等收录标识/被引补齐，但设上限（拿不齐也照样取，别硬等）
  await cdp.waitFor(
    `document.querySelectorAll('article.article .collect-list span').length > 0`,
    { timeoutMs: 900, pollMs: 150 }
  );
  return JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));
}

/** 点到第 n 页（SPIS 翻页不改 URL，只能点） */
async function gotoClientsidePage(cdp, n, prevFirstTitle) {
  const clicked = await cdp.eval(
    `(function(){` +
      ` var btns = Array.prototype.slice.call(document.querySelectorAll('.pagination-number'));` +
      ` var b = btns.find(function(e){ return e.innerText.trim() === ${JSON.stringify(String(n))}; });` +
      ` if (!b) return false; b.click(); return true; })()`
  );
  if (!clicked) return false;
  return cdp.waitFor(
    `(function(){ var a = document.querySelector('article.article .d-t');` +
      ` return a && a.innerText.trim() !== ${JSON.stringify(prevFirstTitle)}; })()`,
    { timeoutMs: 30000, pollMs: 400 }
  );
}

/**
 * 取站内详情页的**真实可用地址**。
 *
 * 2026-10-26 实测机制（重要，别再用"gid 拼 URL"代替）：
 *   - 点卡片标题时，前端先 POST /api/article/saveDetail 把这条记录注册一下，再跳详情页；
 *   - 没被点过（未注册）的记录，直接打开 /scholar/detail/<gid> 会 404（"未找到该条数据"）；
 *   - 点过之后长期可开（实测：点完接口从 MISS 变 OK，且旧链接一直有效）。
 *   → 所以这里**真的点一次卡片标题**，读新标签页地址再关掉；不点就不给链接。
 *
 * @returns {Promise<number>} 成功解析到的条数
 */
/** 卡片连点击都拿不到时：用标题再查一次列表接口，按标题对出 id 并注册 */
async function resolveByTitleApi(cdp, item) {
  if (!item.title) return false;
  const norm = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const url =
    '/api/scholar/list/data?val=' +
    encodeURIComponent(String(item.title).slice(0, 80)) +
    '&page=0&pageSize=10&sort=&facet=0';
  let ds = [];
  try {
    ds = JSON.parse(
      await cdp.eval(
        `fetch(${JSON.stringify(url)},{credentials:'include'}).then(function(r){return r.json()})` +
          `.then(function(j){var d=(j.body||{}).datas||[];return JSON.stringify(d)})`,
        { timeoutMs: 15000 }
      )
    );
  } catch {}
  const want = norm(item.title);
  const hit = ds.find((x) => x && x.id && (norm(x.title) === want || norm(x.title).indexOf(want.slice(0, 12)) === 0));
  if (!hit) return false;
  const probe = async () =>
    cdp
      .eval(
        `fetch(${JSON.stringify('/api/article/data/' + hit.id)},{credentials:'include'})` +
          `.then(function(r){return r.json()})` +
          `.then(function(j){return (typeof j.body==='object'&&j.body)?'OK':'MISS'})` +
          `.catch(function(){return 'ERR'})`,
        { timeoutMs: 12000 }
      )
      .catch(() => 'ERR');
  let st = await probe();
  if (st !== 'OK') {
    await cdp
      .eval(
        `fetch('/api/article/saveDetail',{method:'POST',credentials:'include',` +
          `headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(hit)})})` +
          `.then(function(r){return r.text()}).catch(function(){return ''})`,
        { timeoutMs: 15000 }
      )
      .catch(() => '');
    await sleep(250);
    st = await probe();
  }
  if (st !== 'OK') return false;
  item.gid = hit.id;
  item.detailUrl = `${SITE}/scholar/detail/${hit.id}`;
  item.detailVerified = true;
  return true;
}

/** 点击兜底：注册没成功的条目（含"卡片没有 data-dataid"的）就真点一次标题 */
async function clickResolve(cdp, items) {
  let ok = 0;
  if (!items.length) return ok;
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const dom = JSON.parse(
    await cdp
      .eval(
        "JSON.stringify([].slice.call(document.querySelectorAll('article.article')).map(function(a){var d=a.querySelector('a[data-dataid]');var t=a.querySelector('.d-t');return {gid:d?d.getAttribute('data-dataid'):'',title:t?t.innerText.replace(/^\\d+、\\s*/,'').replace(/\\s+/g,' ').trim():''};}))",
        { timeoutMs: 15000 }
      )
      .catch(() => '[]')
  );
  for (const item of items) {
    if (item.detailVerified) continue;
    let idx = -1;
    if (item.gid) idx = dom.findIndex((d) => d.gid === item.gid);
    if (idx < 0 && item.title) idx = dom.findIndex((d) => d.title && norm(d.title) === norm(item.title));
    if (idx < 0) continue;
    const spec = await cdp
      .eval(
        `(function(i){var a=document.querySelectorAll('article.article')[i];if(!a)return '';` +
          `var t=a.querySelector('.d-t');if(!t)return '';` +
          `t.scrollIntoView({block:'start'});window.scrollBy(0,-120);` +
          `var r=t.getBoundingClientRect();if(!r.width||!r.height)return '';` +
          `return JSON.stringify({x:Math.round(r.x+20),y:Math.round(r.y+r.height/2)});})(${idx})`,
        { timeoutMs: 15000 }
      )
      .catch(() => '');
    if (!spec) continue;
    const pos = JSON.parse(spec);
    const before = (await listTargets()).map((t) => t.url || '');
    await sleep(120);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: pos.x,
      y: pos.y,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: pos.x,
      y: pos.y,
      button: 'left',
      clickCount: 1,
    });
    let hit = null;
    let sameTab = false;
    for (let i = 0; i < 20 && !hit; i++) {
      await sleep(150);
      hit = (await listTargets()).find(
        (t) => !before.includes(t.url || '') && /\/scholar\/detail\//.test(t.url || '')
      );
      if (!hit) {
        const cur = await cdp.eval('location.href', { timeoutMs: 8000 }).catch(() => '');
        if (cur && /\/scholar\/detail\//.test(cur)) {
          hit = { url: cur, id: '' };
          sameTab = true;
        }
      }
    }
    if (hit) {
      // 有的卡片没有 data-dataid → 从跳转 URL 反推 id
      const id = (hit.url.split('/scholar/detail/')[1] || '').trim();
      if (id && !item.gid) item.gid = id;
      const gid = item.gid || id;
      // 点击触发的注册是**异步**的：刚跳转就探通常还是 MISS，等一拍再探，给一次重试。
      const probeIt = async () =>
        gid
          ? await cdp
              .eval(
                `fetch(${JSON.stringify('/api/article/data/' + gid)},{credentials:'include'})` +
                  `.then(function(r){return r.json()})` +
                  `.then(function(j){return (typeof j.body==='object'&&j.body)?'OK':'MISS'})` +
                  `.catch(function(){return 'ERR'})`,
                { timeoutMs: 12000 }
              )
              .catch(() => 'ERR')
          : 'MISS';
      let st = 'MISS';
      for (let t = 0; t < 3 && st !== 'OK'; t++) {
        await sleep(t === 0 ? 600 : 900);
        st = await probeIt();
      }
      if (st === 'OK') {
        item.detailUrl = hit.url;
        item.detailVerified = true;
        ok++;
      }
      if (!sameTab && hit.id) {
        try {
          await closeTab(hit.id);
        } catch {}
      }
    }
    if (!item.detailVerified && (await resolveByTitleApi(cdp, item))) ok++;
    await sleep(80);
  }
  return ok;
}

async function resolveDetailUrls(cdp, items, keyword) {
  // 快路径（批量）：列表接口拿完整字段 → 一次 eval 内并发探测 → 一次 eval 内并发注册 →
  // 再一次并发复核。逐条 for 循环本来要 20 条 × 2~3 次往返，这里压到 3 次往返。
  // 兜底：批量注册仍不上的，再点击卡片标题（见 clickResolve）。
  const targets = items.filter((x) => x.gid);

  const listUrl =
    '/api/scholar/list/data?val=' +
    encodeURIComponent(keyword || '') +
    '&page=0&pageSize=10&sort=&facet=0';
  let payloads = {};
  try {
    payloads = JSON.parse(
      await cdp.eval(
        `Promise.all([0,1].map(function(){` +
          `return fetch(${JSON.stringify(listUrl)},{credentials:'include'})` +
          `.then(function(r){return r.json()}).then(function(j){return (j.body||{}).datas||[]})` +
          `.catch(function(){return []})}))` +
          `.then(function(a){var m={};a.forEach(function(ds){ds.forEach(function(x){if(x&&x.id)m[x.id]=x})});return JSON.stringify(m)})`,
        { timeoutMs: 25000 }
      )
    ) || {};
  } catch {}

  const titleKey = (t) =>
    String(t || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const byTitle = {};
  Object.keys(payloads).forEach((k) => {
    const t = titleKey(payloads[k] && payloads[k].title);
    if (t) byTitle[t] = payloads[k];
  });

  const probeBatch = async (ids) => {
    if (!ids.length) return [];
    const raw = await cdp
      .eval(
        `Promise.all(${JSON.stringify(ids)}.map(function(g){` +
          `return fetch('/api/article/data/'+g,{credentials:'include'})` +
          `.then(function(r){return r.json()})` +
          `.then(function(j){return (typeof j.body==='object'&&j.body)?'OK':'MISS'})` +
          `.catch(function(){return 'ERR'})})).then(function(a){return JSON.stringify(a)})`,
        { timeoutMs: 40000 }
      )
      .catch(() => '[]');
    return JSON.parse(raw || '[]');
  };

  let ok = 0;
  const states = await probeBatch(targets.map((x) => x.gid));
  const toSave = [];
  targets.forEach((item, i) => {
    if (states[i] === 'OK') {
      item.detailUrl = `${SITE}/scholar/detail/${item.gid}`;
      item.detailVerified = true;
      ok++;
      return;
    }
    const full = payloads[item.gid] || byTitle[titleKey(item.title)];
    if (full) toSave.push(full);
  });

  if (toSave.length) {
    await cdp
      .eval(
        `Promise.all(${JSON.stringify(toSave)}.map(function(p){` +
          `return fetch('/api/article/saveDetail',{method:'POST',credentials:'include',` +
          `headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).then(function(r){return r.text()})` +
          `.catch(function(){return ''})})).then(function(){return 'DONE'})`,
        { timeoutMs: 40000 }
      )
      .catch(() => '');
    await sleep(300);
    const rest = targets.filter((x) => !x.detailVerified);
    if (rest.length) {
      const st2 = await probeBatch(rest.map((x) => x.gid));
      rest.forEach((item, i) => {
        if (st2[i] === 'OK') {
          item.detailUrl = `${SITE}/scholar/detail/${item.gid}`;
          item.detailVerified = true;
          ok++;
        }
      });
    }
  }

  let left = items.filter((x) => !x.detailVerified);
  if (left.length) ok += await clickResolve(cdp, left);

  // 最后手段（实测有少数卡片既无 data-dataid、原页面又已重排导致点不到）：
  //   为这些条目**单独用标题检索一次**，等结果出来再点第一张匹配卡片。
  left = items.filter((x) => !x.detailVerified);
  if (left.length) {
    for (const item of left.slice(0, 5)) {
      if (!item.title) continue;
      try {
        const url = searchUrl(item.title);
        await cdp.send('Page.enable');
        await cdp.send('Page.navigate', { url });
        const dl = Date.now() + 12000;
        while (Date.now() < dl) {
          await sleep(150);
          const cur = await cdp.eval('location.href', { timeoutMs: 8000 }).catch(() => '');
          if (cur === url) break;
        }
        await cdp.waitFor(`document.querySelectorAll('article.article').length > 0`, {
          timeoutMs: 10000,
          pollMs: 200,
        });
        await sleep(400);
        await clickResolve(cdp, [item]);
      } catch {}
    }
  }
  return ok;
}

/**
 * 注册之后再核一遍详情数据（/api/article/data 返回正文对象才算通）。
 * 规则要求"逐条验"，这里验的是**注册之后**的状态；没通过的置 detailVerified=false。
 */
async function verifyDetailData(cdp, items) {
  const verified = items.filter((x) => x.detailVerified && x.gid);
  if (!verified.length) return 0;
  let states = [];
  try {
    states = JSON.parse(
      await cdp.eval(
        `Promise.all(${JSON.stringify(verified.map((x) => x.gid))}.map(function(g){` +
          `return fetch('/api/article/data/'+g,{credentials:'include'})` +
          `.then(function(r){return r.json()})` +
          `.then(function(j){return (typeof j.body==='object'&&j.body)?'OK':'MISS'})` +
          `.catch(function(){return 'ERR'})})).then(function(a){return JSON.stringify(a)})`,
        { timeoutMs: 40000 }
      )
    ) || [];
  } catch {}
  let pass = 0;
  verified.forEach((it, i) => {
    if (states[i] === 'OK') pass++;
    else it.detailVerified = false;
  });
  return pass;
}

/**
 * 检索纬度学术资源在线
 * @param {string} keyword
 * @param {object} opts { pages {number} 默认 1，每页 10 条；rows {number} 只解析前 N 条；detailLinks {bool} 是否解析详情页地址（接口注册为主+点击兜底） }
 */
async function search(keyword, opts = {}) {
  const pages = Math.max(1, Number(opts.pages) || 1);
  const cdp = await attachSpis();
  try {
    let first = await openAndWait(cdp, keyword);
    if (!first || (!first.noResult && !first.items.length && !first.institution)) {
      first = await openAndWait(cdp, keyword); // 重载一次
    }
    if (!first) {
      throw new Error('SPIS 结果页在 60s 内没渲染出结果。可能网络慢，重跑一次通常就好。');
    }
    if (!first.items.length && !first.institution) {
      throw new Error('SPIS 页面既没有结果、也没有机构信息，判定为静默失败（不是"没搜到"）。请重跑。');
    }

    let items = first.items.slice();
    const seen = new Set(items.map((x) => x.gid || x.title));

    for (let p = 2; p <= pages; p++) {
      const prevFirst = items.length ? items[0].title : '';
      const ok = await gotoClientsidePage(cdp, p, prevFirst);
      if (!ok) break;
      await sleep(700);
      const next = JSON.parse(await cdp.eval(EXTRACT_JS, { timeoutMs: 45000 }));
      const fresh = next.items.filter((x) => !seen.has(x.gid || x.title));
      if (!fresh.length) break;
      fresh.forEach((x) => seen.add(x.gid || x.title));
      items = items.concat(fresh);
    }

    if (opts.rows && items.length > Number(opts.rows)) {
      items = items.slice(0, Number(opts.rows));
    }

    let detailResolved = 0;
    let detailVerified = 0;
    if (opts.detailLinks) {
      detailResolved = await resolveDetailUrls(cdp, items, keyword);
      detailVerified = await verifyDetailData(cdp, items);
    }

    return {
      source: 'spis',
      label: '纬度学术 SPIS',
      keyword,
      onCampus: !!first.institution,
      institution: first.institution,
      numFound: first.numFound,
      pageText: first.pageText,
      oaCount: items.filter((x) => x.hasDownload).length,
      detailLinks: !!opts.detailLinks,
      detailResolved,
      detailVerified,
      items,
    };
  } finally {
    cdp.close();
  }
}

module.exports = { search, searchUrl, attachSpis, SITE, SEARCH_BASE };

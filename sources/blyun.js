'use strict';
/**
 * sources/blyun.js — 百链（中外文文献发现）检索
 *
 * 配置：域名见 config.local.js → blyun（代码不含学校信息）
 * 认证：机构 IP（页头显示"欢迎来自 <机构> 的朋友"即生效）
 * 检索：GET <SITE>/searchJour?Field=all&channel=searchJour&sw=<词>&ecode=utf-8
 * 结果：按"图书/报纸/学位论文/会议/期刊"分组；每组容器 .mpt-main，
 *       组内条目 = div > a[href]（标题）+ 1 行元数据（作者, 来源, 年）。
 * 注意：结果是**分类分组**的，不是平铺列表；本模块按组展开。
 * 合规：只做检索+题录；文献互助/传递需本人邮箱，工具不代提交。
 */

const { waitForReady, listTargets, newTab, CDP, sleep } = require('../cdp');
const CFG = require('../config');

const SITE = CFG.blyun.site;
const SITE_HOST = (() => {
  try {
    return new URL(SITE).host;
  } catch {
    return '';
  }
})();

const READY_COND =
  `document.querySelectorAll('.mpt-main').length > 0` +
  ` || /没有找到|暂无|无检索结果|检索条件/.test(document.body.innerText)`;

const EXTRACT_JS = `(function(){
  function typeOf(href){
    if (/book\\.blyun\\.com/.test(href)) return '图书';
    if (/newspaper\\.blyun\\.com/.test(href)) return '报纸';
    if (/thesisDetail/.test(href)) return '学位论文';
    if (/conference|confDetail/i.test(href)) return '会议';
    return '期刊/文献';
  }
  function linesOf(w){
    return ((w && w.innerText) || '').split('\\n').map(function(s){ return s.trim(); }).filter(Boolean);
  }
  var items = [];
  Array.prototype.slice.call(document.querySelectorAll('.mpt-main')).forEach(function(g){
    var as = Array.prototype.slice.call(g.querySelectorAll('div > a[href]'));
    if (!as.length) as = Array.prototype.slice.call(g.querySelectorAll('a[href]'));
    as.forEach(function(a){
      var href = a.getAttribute('href') || '';
      if (!href) return;
      var wrap = a.closest('div') || a.parentElement;
      var lines = linesOf(wrap);
      var title = ((a.innerText) || '').replace(/\\s+/g, ' ').trim();
      var meta = '';
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].replace(/\\s+/g, '') !== title.replace(/\\s+/g, '')) { meta = lines[i]; break; }
      }
      if (!title) title = meta;
      items.push({
        title: title,
        meta: meta,
        type: typeOf(href),
        url: href.indexOf('//') >= 0 ? href : (href.charAt(0) === '/' ? SITE + href : SITE + '/' + href)
      });
    });
  });
  var body = document.body.innerText || '';
  var m = body.match(/共\\s*([\\d,]+)\\s*条/);
  var agency = (body.match(/欢迎来自(.+?)的(?:朋友|用户)/) || [])[1] || '';
  return JSON.stringify({ items: items, total: m ? Number(m[1].replace(/,/g, '')) : 0, agency: agency });
})()`;

async function attachBlyun() {
  await waitForReady();
  let t = (await listTargets()).find((x) => (x.url || '').includes(SITE_HOST));
  if (!t) t = await newTab(`${SITE}/`);
  return new CDP(t.webSocketDebuggerUrl).connect();
}

/** 类型过滤：papers=只要论文类；其它按中文类型名匹配 */
function filterByType(items, type) {
  const t = String(type || '').trim();
  if (!t) return items;
  // 硕士/博士：学位论文里再按元数据区分层次
  if (t === '硕士' || t === '博士') {
    return items.filter((x) => /学位论文/.test(x.type) && String(x.meta || '').includes(t));
  }
  if (t === 'papers') {
    return items.filter((x) => /学位论文|会议|期刊/.test(x.type));
  }
  const alias = {
    图书: '图书',
    书: '图书',
    报纸: '报纸',
    学位论文: '学位论文',
    论文: '学位论文',
    硕士: '学位论文',
    博士: '学位论文',
    会议: '会议',
    会议论文: '会议',
    期刊: '期刊',
    期刊论文: '期刊',
  };
  const want = alias[t] || t;
  return items.filter((x) => x.type.includes(want));
}

/** 元数据行 → 作者 / 来源 / 年（行内以逗号分隔，格式按文献类型略有不同） */
function parseMeta(meta) {
  const s = String(meta || '').replace(/\s+/g, ' ').trim();
  const yearM = s.match(/(19|20)\d{2}/g);
  const year = yearM ? yearM[yearM.length - 1] : '';
  const parts = s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const writer = parts.filter((p) => /(著|主编|副主编|编著|编|译|等)$/.test(p.replace(/\s+/g, '')));
  const author = (writer.length ? writer.join('，') : parts[0] || '').replace(/^[,，\s]+/, '');
  const src = parts.filter(
    (p) => /(出版社|出版公司|日报|学报|杂志|期刊)/.test(p) || /(Press|Springer|Elsevier|Wiley)$/.test(p)
  );
  const source = (src.length ? src[src.length - 1] : parts.length >= 2 ? parts[parts.length - 2] : '').trim();
  return { author, source, year };
}

/**
 * 检索百链
 * @param {string} keyword
 * @param {object} opts { rows }
 */
async function search(keyword, opts = {}) {
  const cdp = await attachBlyun();
  try {
    const url =
      `${SITE}/searchJour?Field=all&channel=searchJour&sw=${encodeURIComponent(keyword)}&ecode=utf-8`;
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url });
    const navDeadline = Date.now() + 15000;
    while (Date.now() < navDeadline) {
      await sleep(150);
      const cur = await cdp.eval('location.href', { timeoutMs: 8000 }).catch(() => '');
      if (cur && cur.split('?')[0] === url.split('?')[0]) break;
    }
    const ready = await cdp.waitFor(READY_COND, { timeoutMs: 45000, pollMs: 300 });
    if (!ready) throw new Error('百链结果页 45s 内没渲染出来（检查校园网/站点）');
    // 页面已明确显示"无结果"时，不再等渐进渲染（省 8s+），直接抽取返回
    const noResult = await cdp
      .eval(`/未找到|没有找到|无相关|暂无|无结果|没有结果|抱歉|无检索结果|无数据|没有数据|未检索到|检索结果为空/.test(document.body.innerText)`, { timeoutMs: 8000 })
      .catch(() => false);
    // 渐进渲染：等条目数连续两次不变
    let last = -1;
    let stable = 0;
    const dl = Date.now() + 8000;
    while (!noResult && Date.now() < dl) {
      const n = await cdp
        .eval(`document.querySelectorAll('.mpt-main a[href]').length`, { timeoutMs: 8000 })
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
    let items = (data.items || []).map((x) => {
      const meta = String(x.meta || '').trim();
      const yearM = meta.match(/(19|20)\d{2}/g);
      return {
        title: x.title,
        meta,
        author: '', // 元数据行原样展示，不在此处硬拆（拆错过一次）
        source: '',
        year: yearM ? yearM[yearM.length - 1] : '',
        type: x.type,
        url: x.url,
      };
    });
    const total = Number(data.total) || items.length;
    const raw = items;
    items = filterByType(items, opts.type);
    const typeFiltered = opts.type ? `${opts.type}（全部 ${raw.length} 条中筛出 ${items.length} 条）` : '';
    const rows = Number(opts.rows) || 0;
    if (rows) items = items.slice(0, rows);
    return {
      source: 'blyun',
      label: '百链（文献发现）',
      keyword,
      onCampus: !!data.agency,
      institution: data.agency || '',
      numFound: total,
      numFoundApprox: !Number(data.total), // 页面没给"共X条"时，total 只是本页条目数
      items,
      typeFilter: typeFiltered,
      note:
        '百链结果为分类分组（图书/报纸/学位论文/会议/期刊）；文献互助需本人操作' +
        (typeFiltered ? `；已按类型过滤：${typeFiltered}` : ''),
    };
  } finally {
    cdp.close();
  }
}

module.exports = { search, attachBlyun, SITE };

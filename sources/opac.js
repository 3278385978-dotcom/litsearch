'use strict';
/**
 * sources/opac.js — 图书馆馆藏检索（纸本 + 电子）
 *
 * 配置：域名/机构码见 config.local.js → opac（代码不含学校信息）
 * 接口：POST /find/unify/search（必需头 groupCode: <机构码>，缺了会静默 0 条）
 *       resourceType:["2"] 只看电子资源；电子馆藏 GET /find/ePortfolio/itemList?recordId=…
 * 字段：physicalCount 馆藏册 / onShelfCountI 在架 / canBrrowCountI 可借（**常为 null**）
 * 注意：请求必须同源（页面上下文）；书名+作者是 AND，多词易 0 命中。
 */

const { waitForReady, listTargets, newTab, CDP, sleep } = require('../cdp');

const CFG = require('../config');
const SITE = process.env.LITSEARCH_OPAC || CFG.opac.site;
const GROUP_CODE = process.env.LITSEARCH_GROUP_CODE || CFG.opac.groupCode;
const SITE_HOST = (() => {
  try {
    return new URL(SITE).host;
  } catch {
    return '';
  }
})();

const BASE_BODY = {
  docCode: [null],
  litCode: [],
  searchFieldContent: '',
  searchField: 'keyWord',
  matchMode: '2',
  resourceType: [],
  subject: [],
  discode1: [],
  publisher: [],
  libCode: [],
  locationId: [],
  eCollectionIds: [],
  neweCollectionIds: [],
  curLocationId: [],
  campusId: [],
  kindNo: [],
  collectionName: [],
  author: [],
  langCode: [],
  countryCode: [],
  publishBegin: null,
  publishEnd: null,
  coreInclude: [],
  ddType: [],
  verifyStatus: [],
  group: [],
  sortField: 'relevance',
  sortClause: 'asc',
  page: 1,
  rows: 20,
  onlyOnShelf: null,
  searchItems: null,
  newCoreInclude: [],
  customSub: [],
  customSub0: [],
  indexSearch: 1,
};

async function attachOpac() {
  await waitForReady();
  let t = (await listTargets()).find((x) => (x.url || '').includes(SITE_HOST));
  // newTab 立刻返回 target，不必等它加载完
  if (!t) t = await newTab(`${SITE}/`);
  const cdp = await new CDP(t.webSocketDebuggerUrl).connect();
  // ⚠️ 后面只发一个**同源** POST /find/unify/search，不需要等 SPA 应用启动，
  //    只要 location.origin 对了就能发（旧代码这里硬等两次 4 秒，纯浪费）。
  const wantOrigin = new URL(SITE).origin;
  const atOrigin = async () =>
    (await cdp.eval('location.origin', { timeoutMs: 8000 }).catch(() => '')) === wantOrigin;
  if (!(await atOrigin())) {
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `${SITE}/` });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await sleep(120);
      if (await atOrigin()) break;
    }
  }
  return cdp;
}

function clean(v) {
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function normalize(x) {
  return {
    recordId: x.recordId,
    title: clean(x.title),
    author: clean(x.author),
    publisher: clean(x.publisher),
    year: clean(x.publishYear),
    isbn: x.isbn || (x.isbns ? String(x.isbns).split(';')[0] : ''),
    callNo: x.callNo || (Array.isArray(x.chiClassNo) ? x.chiClassNo.join('/') : ''),
    eCount: x.eCount || 0,
    physicalCount: x.physicalCount || 0,
    // ⚠️ 接口里 canBrrowCountI 常为 null（不是 0！），旧代码 ||0 会把"未知"显示成"可借 0"。
    //    真正稳定可用的是 onShelfCountI（在架数）。两者都保留，null 原样传下去。
    canBorrow: x.canBrrowCountI === null || x.canBrrowCountI === undefined ? null : x.canBrrowCountI,
    onShelf: x.onShelfCountI === null || x.onShelfCountI === undefined ? null : x.onShelfCountI,
    detailUrl: `${SITE}/#/searchList/bookDetails/${x.recordId}`,
  };
}

/**
 * 馆藏检索
 * @param {string} keyword
 * @param {object} opts { rows, page, ebooks }
 */
async function search(keyword, opts = {}) {
  const cdp = await attachOpac();
  try {
    const body = Object.assign({}, BASE_BODY, {
      searchFieldContent: keyword,
      rows: Math.min(Math.max(Number(opts.rows) || 10, 1), 50),
      page: Number(opts.page) || 1,
    });
    if (opts.ebooks) body.resourceType = ['2'];

    const expr =
      `(async () => {
        const r = await fetch('/find/unify/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'groupCode': ${JSON.stringify(GROUP_CODE)},
            'x-lang': 'CHI',
            'content-language': 'zh_CN',
            'Accept': 'application/json, text/plain, */*'
          },
          body: ${JSON.stringify(JSON.stringify(body))}
        });
        const j = await r.json();
        return JSON.stringify({ status: r.status, numFound: (j.data||{}).numFound, raw: (j.data||{}).searchResult || [] });
      })()`;

    const parsed = JSON.parse(await cdp.eval(expr, { timeoutMs: 60000 }));
    return {
      source: 'opac',
      label: '图书馆馆藏 OPAC',
      keyword,
      numFound: parsed.numFound || 0,
      items: (parsed.raw || []).map(normalize),
    };
  } finally {
    cdp.close();
  }
}

module.exports = { search, normalize, SITE, GROUP_CODE, attachOpac };

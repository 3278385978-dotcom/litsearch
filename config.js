'use strict';
/**
 * config.js — 配置加载器（代码里不写死任何学校信息）
 *
 * 优先级：环境变量 > config.local.js（本机私有） > config.example.js（通用空模板）
 * 学校/机构相关（OPAC 域名、机构码、校园网出口段、默认首页）全部从这里取。
 */

let local = {};
let example = {};
try {
  local = require('./config.local');
} catch {}
try {
  example = require('./config.example');
} catch {}

const pick = (a, b) => (a === undefined || a === null || a === '' ? b : a);

module.exports = {
  home: process.env.LITSEARCH_HOME || pick(local.home, example.home || 'about:blank'),
  campus: {
    ipPrefixes:
      (local.campus && local.campus.ipPrefixes) || (example.campus && example.campus.ipPrefixes) || [],
    label: (local.campus && local.campus.label) || (example.campus && example.campus.label) || '校园网段',
  },
  cnki: {
    site: process.env.LITSEARCH_CNKI || pick(local.cnki && local.cnki.site, example.cnki && example.cnki.site),
  },
  spis: {
    site: process.env.LITSEARCH_SPIS || pick(local.spis && local.spis.site, example.spis && example.spis.site),
  },
  opac: {
    site: process.env.LITSEARCH_OPAC || pick(local.opac && local.opac.site, example.opac && example.opac.site),
    groupCode: process.env.LITSEARCH_GROUP_CODE || pick(local.opac && local.opac.groupCode, example.opac && example.opac.groupCode),
  },
  huya: {
    site: process.env.LITSEARCH_HUYA || pick(local.huya && local.huya.site, example.huya && example.huya.site),
    websiteId:
      process.env.LITSEARCH_HUYA_WEBID ||
      pick(local.huya && local.huya.websiteId, example.huya && example.huya.websiteId),
  },
  cxstar: {
    site: process.env.LITSEARCH_CXSTAR || pick(local.cxstar && local.cxstar.site, example.cxstar && example.cxstar.site),
  },
  blyun: {
    site: process.env.LITSEARCH_BLYUN || pick(local.blyun && local.blyun.site, example.blyun && example.blyun.site),
  },
  duxiu: {
    site: process.env.LITSEARCH_DUXIU || pick(local.duxiu && local.duxiu.site, example.duxiu && example.duxiu.site),
  },
  arxiv: {
    api: process.env.LITSEARCH_ARXIV || pick(local.arxiv && local.arxiv.api, example.arxiv && example.arxiv.api),
  },
  github: {
    api: process.env.LITSEARCH_GITHUB || pick(local.github && local.github.api, example.github && example.github.api),
  },
};

'use strict';
/**
 * config.example.js — 配置模板
 *
 * 用法：复制为 `config.local.js` 后填写本校值。
 * ⚠️ `config.local.js` 是本机私有文件，**不要提交到仓库**（见 .gitignore）。
 * 未填写的渠道会在运行时被**友好跳过**（不会报错）。
 */

module.exports = {
  // 受控浏览器默认页（浏览器渠道用）
  home: 'about:blank',
  // 校园网出口 IP 前缀（用于 `node find.js --check`；纯公开库可留空）
  campus: { ipPrefixes: [], label: '校园网段' },

  // ── 校内订阅渠道（按本校实际填写；不填则该渠道自动跳过）──
  cnki: { site: 'https://<中文论文库域名>' },
  spis: { site: 'https://<外文发现系统域名>' },
  opac: { site: 'https://<馆藏系统域名>', groupCode: '<机构码>' },
  huya: { site: 'https://<电子书平台域名>', websiteId: '<门户 websiteId>' },
  cxstar: { site: 'https://<电子书平台域名>' },
  blyun: { site: 'https://<文献发现平台域名>' },
  duxiu: { site: 'https://<图书检索平台域名>' },

  // ── 免认证渠道（一般不用改）──
  arxiv: { api: 'http://export.arxiv.org/api/query' },
  github: { api: 'https://api.github.com/search/repositories' },
};

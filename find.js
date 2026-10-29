#!/usr/bin/env node
'use strict';
/**
 * find.js — 一条命令找资料：论文 + 代码 + 教材
 *
 * 用法：
 *   node find.js "计算电磁学"
 *   node find.js "FDTD" --src=github,arxiv
 *   node find.js "有限元 电磁" --src=cnki --pages=2 --type=硕士
 *   node find.js "Maxwell equations" --json
 *   node find.js "光子晶体" --md --save
 *   node find.js --check                 # 只体检环境（校园网/Chrome/各渠道通不通）
 *
 * 选项：
 *   --src=a,b,c   渠道或分组（papers/code/books），默认 papers+code，不含书库
 *                 可选：cnki(知网) spis(纬度学术·外文发现+文献求助) arxiv(开放论文)
 *                       github(代码) opac(馆藏教材)
 *   --rows=N      每个渠道要几条（默认：cnki 20 / spis 10 / arxiv 10 / github 8 / opac 10）
 *   --pages=N     翻几页（知网每页 20 条；SPIS 每页 10 条）
 *   --type=X      知网按文献类型过滤
 *   --field=X     huya 检索字段：bookname(书名，默认)/author/catalog/fulltext：硕士 / 博士 / 期刊 / 会议
 *   --lang=python GitHub 语言过滤
 *   --min-stars=N GitHub 最低星数
 *   --json        输出 JSON（含每条记录的 gid / detailUrl / articleUrl 全字段）
 *   --en          知网切到「外文」库检索（英文论文）
 *   --headless    受控 Chrome 默认即无头后台（不弹窗）；--show-chrome 可临时切有界面
 *   --link=X      SPIS 条目链接：detail(默认，站内详情页，逐条点开+复核) | article(出版社原文)
 *   --md          输出 Markdown（方便贴进笔记）
 *   --save        同时把 Markdown 存到 results/ 下
 *   --keep-chrome 跑完不关受控 Chrome
 *
 * 设计原则：**任一渠道失败不影响其它渠道**，最后汇总时标注哪条挂了。
 * 这样即使不在校园网，arXiv / GitHub 照样能出结果。
 */

const fs = require('node:fs');
const path = require('node:path');
const { ensureChrome, stopChrome, isUp } = require('./chrome');
const CFG = require('./config');

const SOURCES = {
  cnki: { mod: './sources/cnki', browser: true, label: '知网 CNKI' },
  spis: { mod: './sources/spis', browser: true, label: '纬度学术 SPIS' },
  arxiv: { mod: './sources/arxiv', browser: false, label: 'arXiv 预印本' },
  github: { mod: './sources/github', browser: false, label: 'GitHub 代码仓库' },
  opac: { mod: './sources/opac', browser: true, label: '图书馆馆藏 OPAC' },
  huya: { mod: './sources/huya', browser: true, label: '汇雅电子书' },
  cxstar: { mod: './sources/cxstar', browser: true, label: '畅想之星电子书' },
  blyun: { mod: './sources/blyun', browser: true, label: '百链（文献发现）' },
  duxiu: { mod: './sources/duxiu', browser: true, label: '读秀（图书）' },
  openalex: { mod: './sources/openalex', browser: false, label: 'OpenAlex（公开）' },
  crossref: { mod: './sources/crossref', browser: false, label: 'Crossref（DOI）' },
  doaj: { mod: './sources/doaj', browser: false, label: 'DOAJ（开放获取）' },
  pubmed: { mod: './sources/pubmed', browser: false, label: 'PubMed（生物医学）' },
};
// 渠道分组：查论文只跑论文渠道；查书只跑书库（不含知网/纬度）
const GROUPS = {
  // 查论文：只跑校内渠道（默认，快且准、token 可控）
  papers: ['cnki', 'spis', 'blyun', 'arxiv'],
  // 公开库（免认证）：默认**不启用**，显式 --src=public 或 --src=all 才跑
  public: ['openalex', 'crossref', 'doaj', 'pubmed'],
  code: ['github'],
  // 查书：只图书渠道（不含论文渠道）
  books: ['opac', 'huya', 'cxstar', 'blyun', 'duxiu'],
  // 全量：校内论文 + 公开库 + 代码（明确要"扫全"时才用）
  all: ['cnki', 'spis', 'blyun', 'arxiv', 'openalex', 'crossref', 'doaj', 'pubmed', 'github'],
};
// 默认：校内论文 + 代码；**不含公开库、不查书**
const DEFAULT_SRC = ['papers', 'code'];
const DEFAULT_ROWS = { cnki: 20, spis: 10, arxiv: 10, github: 8, opac: 10, huya: 10, cxstar: 10, blyun: 15, duxiu: 10, openalex: 10, crossref: 10, doaj: 8, pubmed: 10 };

// ─────────────────────────── 参数解析 ───────────────────────────

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else pos.push(a);
  }
  return { flags, keyword: pos.join(' ').trim() };
}

// ─────────────────────────── 各渠道执行 ───────────────────────────

function isUnconfigured(v) {
  const t = String(v || '').trim();
  // 空值、含 <占位符>、纯下划线、或不含有效主机名 → 视为未配置
  return !t || /<.*>/.test(t) || /^_+$/.test(t) || !/^https?:\/\/[^/]+/.test(t);
}

const SITE_OF = {
  cnki: () => CFG.cnki.site,
  spis: () => CFG.spis.site,
  opac: () => CFG.opac.site,
  huya: () => CFG.huya.site,
  cxstar: () => CFG.cxstar.site,
  blyun: () => CFG.blyun.site,
  duxiu: () => CFG.duxiu.site,
};

function optsFor(src, flags, group) {
  const rows = flags.rows ? Number(flags.rows) : DEFAULT_ROWS[src];
  switch (src) {
    case 'cnki':
      return {
        pages: flags.pages ? Number(flags.pages) : 1,
        type: flags.type || '',
        // --en：切到知网"外文"库（中文/外文开关，AJAX 重载）
        en: !!flags.en,
      };
    case 'spis':
      return {
        pages: flags.pages ? Number(flags.pages) : 1,
        // 只对要交付的条数点开取详情（避免先点满 10 条再截断）
        rows: rows,
        // 默认就取详情页（--link=article 才退回出版社原文）；裸拼 URL 会 404，见 spis.js 头注释
        detailLinks: String(flags.link || 'detail') === 'detail',
      };
    case 'arxiv':
      return { max: rows };
    case 'github':
      return { max: rows, lang: flags.lang || '', minStars: flags['min-stars'] };
    case 'opac':
      return { rows };
    case 'huya':
      // field: bookname(书名，默认)/author(作者)/catalog(目录)/fulltext(全文)
      return { rows, field: flags.field || 'bookname' };
    case 'cxstar':
      return { rows };
    case 'duxiu':
      return { rows };
    case 'openalex':
    case 'crossref':
    case 'doaj':
    case 'pubmed':
      return { rows };
    case 'blyun':
      // type: 图书/报纸/学位论文/会议/期刊；papers=只要论文类（期刊/学位论文/会议）
      // 分组决定默认：books 组默认只取图书，papers 组默认只取论文类
      return {
        rows,
        type: flags.type || (group === 'books' ? '图书' : group === 'papers' ? 'papers' : ''),
      };
    default:
      return {};
  }
}

async function runSource(src, keyword, flags, group) {
  const meta = SOURCES[src];
  // 校内渠道若未配置（config.local.js 缺失/占位符）→ 友好跳过，不报错
  if (SITE_OF[src] && isUnconfigured(SITE_OF[src]())) {
    return {
      ok: false,
      skipped: true,
      source: src,
      label: meta.label,
      error: '⚪ 未配置（已跳过）：复制 config.example.js → config.local.js 并填写域名',
    };
  }
  try {
    const mod = require(meta.mod);
    const data = await mod.search(keyword, optsFor(src, flags, group));
    // 知网一页固定 20 条，--rows 在这里兜底截断（对其它渠道是 no-op）
    const want = flags.rows ? Number(flags.rows) : 0;
    if (want && data.items.length > want) data.items = data.items.slice(0, want);
    // 截断后重算统计，否则会出现"本页 5 条、其中 7 条可下载"这种自相矛盾
    if (typeof data.oaCount === 'number') {
      data.oaCount = data.items.filter((x) => x.pdfUrl).length;
    }
    return Object.assign({ ok: true }, data);
  } catch (e) {
    return {
      ok: false,
      source: src,
      label: meta.label,
      keyword,
      error: e.message || String(e),
      items: [],
      numFound: 0,
    };
  }
}

// ─────────────────────────── 渲染 ───────────────────────────

function shortAuthors(list) {
  if (!list || !list.length) return '';
  return list.length > 3 ? `${list.slice(0, 3).join('; ')} 等` : list.join('; ');
}

/** 防御性截断：外部数据可能极长（垃圾仓库描述、超长期刊名），不截断会刷爆终端 */
function clip(s, n = 160) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function renderText(results, keyword, meta) {
  const L = [];
  L.push(`═══ 检索「${keyword}」 ═══`);
  const campusQueried = results.some((r) => r.source === 'cnki' || r.source === 'spis');
  const badge = !campusQueried
    ? '本次未查校园网渠道'
    : meta.onCampus
      ? `校园网已认证：${meta.institution}`
      : '未检测到校园网认证（知网/SPIS 可能只能看摘要）';
  L.push(`渠道：${results.map((r) => r.source).join(' / ')} · ${badge}`);
  for (const n of meta.skipped || []) L.push(`ℹ️ ${n}`);
  L.push('');

  for (const r of results) {
    L.push(`── ${r.label} ${'─'.repeat(Math.max(2, 40 - r.label.length))}`);

    if (!r.ok) {
      L.push(r.skipped ? `  ${r.error}` : `  ⚠️ 该渠道失败：${r.error}`);
      L.push('');
      continue;
    }
    if (r.note) L.push(`  ℹ️ ${r.note}`);
    if (!r.items.length) {
      if (r.source === 'cnki' && r.typeFilter) {
        if (r.facetApplied) {
          L.push(`  已限定「${r.typeFacet}」（该类型库命中 ${r.numFound} 条），本页无「${r.typeFilter}」匹配`);
          L.push('  提示：可加 --pages=3 多翻几页。');
        } else {
          L.push(
            `  按「${r.typeFilter}」筛选后没有结果（全库命中 ${r.numFound} 条，已扫描 ` +
              `${r.scannedPages || 1} 页 ${r.scannedRows || 0} 条）`
          );
          L.push('  提示：类型限定控件未找到（页面结构可能变了），当前是客户端近似筛选。');
        }
      } else {
        L.push(`  没有结果（命中 ${r.numFound} 条）`);
      }
      L.push('');
      continue;
    }

    if (r.source === 'cnki') {
      const cats = Object.entries(r.categories || {})
        .filter(([k]) => k !== '总库')
        .map(([k, v]) => `${k} ${v}`)
        .join(' / ');
      L.push(`  命中 ${r.numFound} 条${r.totalPages ? ` · 共 ${r.totalPages} 页` : ''}`);
      if (cats && !r.facetApplied) L.push(`  分类：${cats}`);
      if (r.typeFilter) {
        if (r.facetApplied) {
          L.push(`  ✅ 类型限定：${r.typeFacet}（该类型库命中 ${r.numFound} 条）`);
          if (['硕士', '博士'].includes(String(r.typeFilter))) {
            L.push(
              `  → 再筛「${r.typeFilter}」：扫描 ${r.scannedPages || 1} 页 ${r.scannedRows || 0} 条 → ${r.items.length} 条`
            );
          }
        } else {
          L.push(
            `  ⚠️ 类型筛选为客户端近似（未找到侧栏控件）：扫描 ${r.scannedPages || 1} 页 ${r.scannedRows || 0} 条 → ` +
              `命中 ${r.items.length} 条；numFound 为全库数`
          );
        }
      }
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. [${x.type || '文献'}] ${clip(x.title, 120)}${x.badge ? ` （${clip(x.badge, 20)}）` : ''}`);
        const bits = [x.author, x.source, x.date].filter(Boolean);
        if (x.downloads) bits.push(`下载 ${x.downloads}`);
        if (bits.length) L.push(`     ${bits.join(' · ')}`);
        if (x.url) L.push(`     ${x.url}`);
      });
    } else if (r.source === 'spis') {
      L.push(
        `  命中 ${r.numFound} 条 · 本页 ${r.items.length} 条 · 其中 ${r.oaCount} 条可直接下 PDF`
      );
      if (meta.linkMode === 'detail') {
        const miss = r.items.filter((x) => !(x.detailVerified && x.detailUrl)).length;
        if (miss > 0) {
          L.push(`  ⚠️ 无详情页 ${miss} 条（均已保留出版社原文链接，未删除）`);
        } else {
          L.push(`  ✅ 详情页 ${r.items.length}/${r.items.length} 条全部验证通过`);
        }
      }
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. ${clip(x.title, 130)}`);
        const bits = [];
        if (x.badges.length) bits.push(x.badges.slice(0, 4).join(' / '));
        if (x.citations) bits.push(`被引 ${x.citations}`);
        if (bits.length) L.push(`     ${bits.join(' · ')}`);
        if (x.meta) L.push(`     ${clip(x.meta, 140)}`);
        if (x.pdfUrl) L.push(`     📄 PDF直链: ${x.pdfUrl}`);
        else if (x.canRequest) L.push('     ✉️ 无 OA 直链，但在 SPIS 上可「文献求助」发邮箱（需你自己操作）');
        // detail 模式：优先给"点开注册 + 接口复核通过"的详情页；取不到退回原文并注明，不丢条目
        if (meta.linkMode === 'detail') {
          if (x.detailVerified && x.detailUrl) L.push(`     详情: ${x.detailUrl}`);
          else L.push('     ⚠️ 详情页未取到（已尝试点开注册），下面给出版社原文');
        }
        if (x.articleUrl) L.push(`     原文: ${x.articleUrl}`);
      });
    } else if (r.source === 'arxiv') {
      L.push(`  命中 ${r.numFound} 条（开放全文，PDF 可直接下）`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. [${x.published}] ${clip(x.title, 120)}`);
        if (x.authors.length) L.push(`     ${shortAuthors(x.authors)}`);
        if (x.category) L.push(`     ${x.category}${x.comment ? ` · ${clip(x.comment, 100)}` : ''}`);
        if (x.pdfUrl) L.push(`     PDF: ${x.pdfUrl}`);
      });
    } else if (r.source === 'github') {
      L.push(`  命中 ${r.numFound} 个仓库`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. ${clip(x.name, 60)}  ★${x.stars}${x.language ? ` · ${clip(x.language, 20)}` : ''}`);
        if (x.description) L.push(`     ${clip(x.description, 150)}`);
        L.push(`     ${x.url}${x.updated ? `  （更新 ${x.updated}）` : ''}`);
      });
    } else if (r.source === 'blyun') {
      L.push(
        `  命中 ${r.numFound} 条${r.numFoundApprox ? '（本页计数）' : ''}` +
          `${r.institution ? ` · 机构：${r.institution}` : ''}`
      );
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. ${clip(x.title, 120)}${x.type ? `  [${x.type}]` : ''}`);
        if (x.meta) L.push(`     ${clip(x.meta, 160)}`);
        if (x.url) L.push(`     ${x.url}`);
      });
      L.push('');
    } else if (['openalex', 'crossref', 'doaj', 'pubmed'].includes(r.source)) {
      L.push(`  命中 ${r.numFound} 条`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. ${clip(x.title, 120)}`);
        const bits = [x.author, x.source, x.year].filter(Boolean);
        if (bits.length) L.push(`     ${bits.join(' · ')}`);
        if (x.cited) L.push(`     被引 ${x.cited}`);
        if (x.url) L.push(`     ${x.url}`);
      });
      L.push('');
    } else if (r.source === 'duxiu') {
      L.push(
        `  命中 ${r.numFound} 条${r.numFoundApprox ? '（本页计数）' : ''}` +
          `${r.institution ? ` · 机构：${r.institution}` : ''}`
      );
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. ${clip(x.title, 120)}`);
        const bits = [x.author, x.publisher, x.year].filter(Boolean);
        if (bits.length) L.push(`     ${bits.join(' · ')}`);
        const extra = [];
        if (x.avail && x.avail.length) extra.push(`获取方式 ${x.avail.join('、')}`);
        if (x.cite) extra.push(`被引 ${x.cite}`);
        if (extra.length) L.push(`     ${extra.join(' · ')}`);
        if (x.url) L.push(`     ${x.url}`);
      });
      L.push('');
    } else if (r.source === 'cxstar') {
      L.push(`  命中 ${r.numFound} 条`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. ${clip(x.title, 120)}${x.kind && x.kind.length ? `  ${x.kind.join('/')}` : ''}`);
        const bits = [x.author, x.publisher, x.date || x.year].filter(Boolean);
        if (bits.length) L.push(`     ${bits.join(' · ')}`);
        const meta = [];
        if (x.isbn) meta.push(`ISBN ${x.isbn}`);
        if (x.readNum) meta.push(`阅读 ${x.readNum}`);
        if (meta.length) L.push(`     ${meta.join(' · ')}`);
        if (x.abstract) L.push(`     ${clip(x.abstract, 110)}`);
        if (x.detailUrl) L.push(`     书目: ${x.detailUrl}`);
      });
      L.push('');
    } else if (r.source === 'huya') {
      L.push(`  命中 ${r.numFound} 条${r.institution ? ` · 机构：${r.institution}` : ''}`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`  ${i + 1}. ${clip(x.title, 120)}`);
        const bits = [x.author, x.publisher, x.date || x.year].filter(Boolean);
        if (bits.length) L.push(`     ${bits.join(' · ')}`);
        const meta = [];
        if (x.isbn) meta.push(`ISBN ${x.isbn}`);
        if (x.clc) meta.push(`分类 ${x.clc}`);
        if (x.ssid) meta.push(`ssid ${x.ssid}`);
        if (x.kinds && x.kinds.length) meta.push(`阅读方式 ${x.kinds.join('/')}`);
        if (meta.length) L.push(`     ${meta.join(' · ')}`);
        if (x.cardUrl) L.push(`     书目页: ${x.cardUrl}`);
        if (x.readUrl) L.push(`     在线阅读: ${x.readUrl}`);
        L.push('     ⚠️ 阅读链接带签名（时效），请当场使用');
      });
      L.push('');
    } else {
      L.push(`  命中 ${r.numFound} 条`);
      L.push('');
      r.items.forEach((x, i) => {
        const tag = x.eCount ? '📱电子' : x.physicalCount ? '📚纸本' : '';
        L.push(`  ${i + 1}. ${clip(x.title, 120)}  ${tag}`);
        const bits = [x.author, x.publisher, x.year].filter(Boolean);
        if (bits.length) L.push(`     ${bits.join(' · ')}`);
        const hold = [];
        if (x.eCount) hold.push(`电子资源 ${x.eCount}`);
        if (x.physicalCount) {
          const onShelfT = x.onShelf === null || x.onShelf === undefined ? '未知' : `${x.onShelf} 册`;
          const canBorrowT =
            x.canBorrow === null || x.canBorrow === undefined ? '' : ` · 可借 ${x.canBorrow}`;
          hold.push(`纸本 ${x.physicalCount} 册 · 在架 ${onShelfT}${canBorrowT}`);
        }
        if (x.callNo) hold.push(`索书号 ${x.callNo}`);
        if (hold.length) L.push(`     ${hold.join(' · ')}`);
        if (x.detailUrl) L.push(`     ${x.detailUrl}`);
      });
    }
    L.push('');
  }
  if (meta.stoppedChrome) L.push('（受控 Chrome 已自动关闭；需要常驻用 --keep-chrome）');
  return L.join('\n');
}

function renderMarkdown(results, keyword, meta) {
  const L = [];
  L.push(`# 资料检索：${keyword}`);
  L.push('');
  L.push(`- 时间：${meta.time}`);
  L.push(`- 渠道：${results.map((r) => r.source).join(' / ')}`);
  L.push(`- 校园网：${meta.onCampus ? `已认证（${meta.institution}）` : '未认证'}`);
  for (const n of meta.skipped || []) L.push(`- ℹ️ ${n}`);
  L.push('');

  for (const r of results) {
    L.push(`## ${r.label}`);
    L.push('');
    if (!r.ok) {
      L.push(r.skipped ? `> ${r.error}` : `> ⚠️ 该渠道失败：${r.error}`);
      L.push('');
      continue;
    }
    if (r.note) {
      L.push(`> ℹ️ ${r.note}`);
      L.push('');
    }
    if (r.source === 'cnki') {
      const cats = Object.entries(r.categories || {})
        .filter(([k]) => k !== '总库')
        .map(([k, v]) => `${k} ${v}`)
        .join(' / ');
      L.push(`命中 **${r.numFound}** 条${r.totalPages ? `，共 ${r.totalPages} 页` : ''}${cats ? `  \n分类：${cats}` : ''}`);
      if (r.typeFilter) {
        if (r.facetApplied) {
          L.push(`> ✅ 类型限定：${r.typeFacet}（该类型库命中 ${r.numFound} 条）`);
          if (['硕士', '博士'].includes(String(r.typeFilter))) {
            L.push(
              `> → 再筛「${r.typeFilter}」：扫描 ${r.scannedPages || 1} 页 ${r.scannedRows || 0} 条 → ${r.items.length} 条`
            );
          }
        } else {
          L.push(
            `> ⚠️ 类型筛选为客户端近似（未找到侧栏控件）：扫描 ${r.scannedPages || 1} 页 ${r.scannedRows || 0} 条 → ` +
              `命中 ${r.items.length} 条（numFound 为全库数）`
          );
        }
        if (!r.items.length) L.push('> 提示：可加 `--pages=3` 多翻几页。');
      }
      L.push('');
      L.push('| # | 类型 | 标题 | 作者 | 来源 | 日期 | 下载 |');
      L.push('|---|---|---|---|---|---|---|');
      r.items.forEach((x, i) => {
        L.push(
          `| ${i + 1} | ${x.type || ''} | [${clip(x.title, 120)}](${x.url})${x.badge ? ` \`${clip(x.badge, 20)}\`` : ''} | ` +
            `${x.author} | ${x.source} | ${x.date} | ${x.downloads} |`
        );
      });
      L.push('');
    } else if (r.source === 'spis') {
      L.push(`命中 **${r.numFound}** 条（本页 ${r.items.length} 条，${r.oaCount} 条有 OA 直链）`);
      if (meta.linkMode === 'detail') {
        const miss = r.items.filter((x) => !(x.detailVerified && x.detailUrl)).length;
        L.push(
          miss > 0
            ? `> ⚠️ 无详情页 ${miss} 条（均已保留出版社原文链接，未删除）`
            : `> ✅ 详情页 ${r.items.length}/${r.items.length} 条全部验证通过`
        );
      }
      L.push('');
      r.items.forEach((x, i) => {
        const useDetail = meta.linkMode === 'detail' && x.detailVerified && x.detailUrl;
        const link = useDetail ? x.detailUrl : x.articleUrl || x.detailUrl;
        L.push(
          `${i + 1}. **[${clip(x.title, 150)}](${link || '#'})**` +
            (x.citations ? ` — 被引 ${x.citations}` : '')
        );
        if (x.meta) L.push(`   - ${clip(x.meta, 150)}`);
        if (x.badges.length) L.push(`   - 收录：${x.badges.slice(0, 5).join(' / ')}`);
        if (x.pdfUrl) L.push(`   - [OA PDF 直链](${x.pdfUrl})`);
        else if (x.canRequest) L.push('   - ⚠️ 无 OA 直链，需在 SPIS 页面用「文献求助」发到邮箱');
        if (meta.linkMode === 'detail' && !useDetail) L.push('   - ⚠️ 详情页未取到，已给出版社原文');

      });
      L.push('');
    } else if (r.source === 'arxiv') {
      L.push(`命中 **${r.numFound}** 条`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`${i + 1}. **[${clip(x.title, 150)}](${x.url})** — ${x.published}`);
        if (x.authors.length) L.push(`   - 作者：${shortAuthors(x.authors)}`);
        if (x.category) L.push(`   - 分类：\`${x.category}\`${x.comment ? ` · ${clip(x.comment, 100)}` : ''}`);
        if (x.pdfUrl) L.push(`   - [PDF](${x.pdfUrl})`);
      });
      L.push('');
    } else if (r.source === 'github') {
      L.push(`命中 **${r.numFound}** 个仓库`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`${i + 1}. **[${clip(x.name, 60)}](${x.url})** ★${x.stars}${x.language ? ` · ${clip(x.language, 20)}` : ''}`);
        if (x.description) L.push(`   - ${clip(x.description, 150)}`);
        if (x.updated) L.push(`   - 最近更新：${x.updated}`);
      });
      L.push('');
    } else if (r.source === 'blyun') {
      L.push(`命中 **${r.numFound}** 条`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`${i + 1}. **[${clip(x.title, 120)}](${x.url})**${x.type ? ` \`${x.type}\`` : ''}`);
        if (x.meta) L.push(`   - ${clip(x.meta, 160)}`);
      });
      L.push('');
    } else if (r.source === 'duxiu') {
      L.push(`命中 **${r.numFound}** 条`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`${i + 1}. **[${clip(x.title, 120)}](${x.url})**`);
        const bits = [x.author, x.publisher, x.year].filter(Boolean);
        if (bits.length) L.push(`   - ${bits.join(' · ')}`);
        if (x.avail && x.avail.length) L.push(`   - 获取方式：${x.avail.join('、')}`);
        if (x.cite) L.push(`   - 被引 ${x.cite}`);
      });
      L.push('');
    } else if (['openalex', 'crossref', 'doaj', 'pubmed'].includes(r.source)) {
      L.push(`命中 **${r.numFound}** 条`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`${i + 1}. **[${clip(x.title, 120)}](${x.url})**`);
        const bits = [x.author, x.source, x.year].filter(Boolean);
        if (bits.length) L.push(`   - ${bits.join(' · ')}`);
        if (x.cited) L.push(`   - 被引 ${x.cited}`);
      });
      L.push('');
    } else if (r.source === 'cxstar') {
      L.push(`命中 **${r.numFound}** 条`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`${i + 1}. **[${clip(x.title, 120)}](${x.detailUrl})**${x.kind && x.kind.length ? ` \`${x.kind.join('/')}\`` : ''}`);
        const bits = [x.author, x.publisher, x.date || x.year].filter(Boolean);
        if (bits.length) L.push(`   - ${bits.join(' · ')}`);
        if (x.isbn) L.push(`   - ISBN ${x.isbn}`);
        if (x.abstract) L.push(`   - ${clip(x.abstract, 110)}`);
      });
      L.push('');
    } else if (r.source === 'huya') {
      L.push(`命中 **${r.numFound}** 条${r.institution ? ` · 机构：${r.institution}` : ''}`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`${i + 1}. **${clip(x.title, 120)}**`);
        const bits = [x.author, x.publisher, x.date || x.year].filter(Boolean);
        if (bits.length) L.push(`   - ${bits.join(' · ')}`);
        const meta = [];
        if (x.isbn) meta.push(`ISBN ${x.isbn}`);
        if (x.clc) meta.push(`分类 ${x.clc}`);
        if (x.kinds && x.kinds.length) meta.push(`阅读方式 ${x.kinds.join('/')}`);
        if (meta.length) L.push(`   - ${meta.join(' · ')}`);
        if (x.cardUrl) L.push(`   - [书目页](${x.cardUrl})`);
        if (x.readUrl) L.push(`   - [在线阅读](${x.readUrl})（链接有时效，需当场用）`);
      });
      L.push('');
    } else {
      L.push(`命中 **${r.numFound}** 条`);
      L.push('');
      r.items.forEach((x, i) => {
        L.push(`${i + 1}. ${clip(x.title, 120)}${x.eCount ? ' `电子`' : x.physicalCount ? ' `纸本`' : ''}`);
        const bits = [x.author, x.publisher, x.year].filter(Boolean);
        if (bits.length) L.push(`   - ${bits.join(' · ')}`);
        if (x.callNo) {
          const onShelfT = x.onShelf === null || x.onShelf === undefined ? '未知' : `${x.onShelf} 册`;
          const canBorrowT = x.canBorrow === null || x.canBorrow === undefined ? '' : ` / 可借 ${x.canBorrow}`;
          L.push(`   - 索书号：${x.callNo}（在架 ${onShelfT}${canBorrowT}）`);
        }
      });
      L.push('');
    }
  }
  return L.join('\n');
}

// ─────────────────────────── 环境体检 ───────────────────────────

async function cmdCheck() {
  const lines = [];
  lines.push('═══ 环境体检 ═══');

  // 校园网出口 IP：多个源回退（这台机器上 api.ipify.org 不通，ifconfig.me 通）
  let ip = '';
  for (const url of [
    'https://ifconfig.me/ip',
    'https://icanhazip.com',
    'https://api.ipify.org?format=json',
  ]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const t = (await r.text()).trim();
      const m = t.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
      if (m) {
        ip = m[0];
        break;
      }
    } catch {}
  }
  const prefixes = (CFG.campus && CFG.campus.ipPrefixes) || [];
  const campusByIp = prefixes.some((p) => ip.startsWith(p));
  lines.push(
    `出口 IP   : ${ip || '(取不到)'}  ` +
      (campusByIp
        ? `✅ ${CFG.campus.label}（${prefixes.join(' / ')}）`
        : ip
          ? '⚠️ 不在校园网段'
          : '')
  );

  // Chrome
  const up = await isUp();
  lines.push(`受控 Chrome: ${up ? '✅ 已在运行' : '○ 未运行（需要时会自动拉起）'}`);

  // 各 HTTP 渠道
  for (const [name, url] of [
    ['arxiv ', 'http://export.arxiv.org/api/query?search_query=all:test&max_results=1'],
    ['github', 'https://api.github.com/rate_limit'],
  ]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      lines.push(`${name} : ${r.ok ? '✅' : '⚠️'} HTTP ${r.status}`);
    } catch (e) {
      lines.push(`${name} : ❌ ${e.message}`);
    }
  }

  // 知网 / SPIS（都需要浏览器）—— 这两条才是"校园网认证到底有没有生效"的权威判据
  let campusByCnki = false;
  try {
    if (isUnconfigured(CFG.cnki.site)) {
      lines.push('知网     : ⚪ 未配置（复制 config.example.js → config.local.js 并填写域名）');
      throw { __skip: true };
    }
    const { ensureChrome } = require('./chrome');
    await ensureChrome({ quiet: true });
    const cnki = require('./sources/cnki');
    const res = await cnki.search('电动力学', { pages: 1 });
    campusByCnki = !!res.onCampus;
    lines.push(
      `知网     : ${res.onCampus ? '✅' : '⚠️'} 机构「${res.institution || '未识别'}」· 检索正常，命中 ${res.numFound} 条`
    );
  } catch (e) {
    if (!e || !e.__skip) lines.push(`知网     : ❌ ${e.message}`);
  }

  try {
    if (isUnconfigured(CFG.spis.site)) {
      lines.push('纬度SPIS : ⚪ 未配置（同上）');
      throw { __skip: true };
    }
    const spis = require('./sources/spis');
    const res = await spis.search('computational electromagnetics', { pages: 1 });
    campusByCnki = campusByCnki || !!res.onCampus;
    const oa = res.items.filter((x) => x.pdfUrl).length;
    lines.push(
      `纬度SPIS : ${res.onCampus ? '✅' : '⚠️'} 机构「${res.institution || '未识别'}」· 命中 ${res.numFound} 条，本页 ${oa} 条有 OA 直链`
    );
  } catch (e) {
    if (!e || !e.__skip) lines.push(`纬度SPIS : ❌ ${e.message}`);
  } finally {
    stopChrome();
  }

  const campus = campusByIp || campusByCnki;
  lines.push('');
  lines.push(
    campus
      ? `结论：✅ 校园网认证生效（${campusByCnki ? '知网已识别机构' : '出口 IP 在校园网段'}），知网全文可看可下。`
      : '结论：⚠️ 查不到校园网认证。arXiv / GitHub 照常可用，知网大概率只能看摘要。'
  );
  lines.push('（受控 Chrome 已关闭）');

  console.log(lines.join('\n'));
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const { flags, keyword } = parseArgs(process.argv.slice(2));

  if (flags.check) return cmdCheck();
  if (!keyword) {
    console.log(
      '用法: node find.js "<关键词>" [--src=渠道/分组] [--rows=N] [--pages=N]\n' +
        '      渠道: cnki,spis,blyun,arxiv,github,opac,huya,cxstar,duxiu,openalex,crossref,doaj,pubmed\n' +
        '      分组: papers(=校内论文: cnki,spis,blyun,arxiv)\n' +
        '            public(=公开库: openalex,crossref,doaj,pubmed，默认关闭)\n' +
        '            code(=github) books(=书库) all(=papers+public+code)\n' +
        '      默认: papers+code（**不含公开库、不查书**；公开库显式 --src=public）\n' +
        '                      [--type=硕士|博士|期刊|会议|图书|学位论文|报纸] [--lang=python] [--min-stars=N] [--en]\n' +
        '                      [--headless] [--show-chrome] [--field=bookname|author|catalog|fulltext]\n' +
        '                      [--link=detail|article] [--json] [--md] [--save] [--keep-chrome]\n' +
        '      node find.js --check'
    );
    process.exit(1);
  }

  const tokens = String(flags.src || DEFAULT_SRC.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = tokens.filter((s) => !SOURCES[s] && !GROUPS[s]);
  if (bad.length) {
    console.error(
      `❌ 未知渠道：${bad.join(', ')}（可选渠道：${Object.keys(SOURCES).join(', ')}；` +
        `分组：${Object.keys(GROUPS).join(', ')}）`
    );
    process.exit(1);
  }
  // 分组 → 具体渠道；记录每个渠道来自哪个分组（决定百链的默认类型过滤）
  let wanted = [];
  const srcGroup = {}; // src -> group（仅分组展开时记录）
  for (const t of tokens) {
    const list = GROUPS[t] || [t];
    for (const s of list) {
      if (!wanted.includes(s)) {
        wanted.push(s);
        if (GROUPS[t]) srcGroup[s] = t;
      }
    }
  }

  // SPIS 条目的超链接用哪个：article=出版社原文（默认） detail=站内详情页
  const linkMode = String(flags.link || 'detail').toLowerCase();
  if (linkMode !== 'article' && linkMode !== 'detail') {
    console.error(`❌ --link 只支持 article 或 detail，收到：${flags.link}`);
    process.exit(1);
  }

  // 纯中文关键词在 GitHub 上只会搜到无关的刷词垃圾仓库（几十万字描述那种），
  // 默认直接跳过，省掉一次 API 调用和一堆噪音。用户显式 --src 指定时照办。
  const skipped = [];
  if (
    !flags.src &&
    /[\u4e00-\u9fa5]/.test(keyword) &&
    !/[A-Za-z]/.test(keyword) &&
    wanted.includes('github')
  ) {
    wanted = wanted.filter((s) => s !== 'github');
    skipped.push(
      '已自动跳过 GitHub：纯中文关键词在 GitHub 上只会搜到无关的刷词仓库。' +
        '要强制搜请显式写 --src=cnki,spis,arxiv,github'
    );
  }

  // 默认无头后台；--show-chrome 临时切有界面
  if (flags.headless) process.env.LITSEARCH_HEADLESS = '1';
  if (flags['show-chrome']) process.env.LITSEARCH_HEADLESS = '0';

  // 需要浏览器的渠道先确保 Chrome 起来
  const needBrowser = wanted.some(
    (s) => SOURCES[s].browser && !(SITE_OF[s] && isUnconfigured(SITE_OF[s]()))
  );
  let startedChrome = false;
  if (needBrowser) {
    const { started } = await ensureChrome({ quiet: !!flags.json });
    startedChrome = started;
  }

  // HTTP 渠道并行；浏览器渠道串行（共用同一个浏览器，避免抢页面）
  const httpSrcs = wanted.filter((s) => !SOURCES[s].browser);
  const browserSrcs = wanted.filter((s) => SOURCES[s].browser);

  const results = [];
  const httpPromise = Promise.all(
    httpSrcs.map(async (s) => ({ s, r: await runSource(s, keyword, flags, srcGroup[s]) }))
  );
  const browserChain = (async () => {
    const out = [];
    for (const s of browserSrcs) out.push({ s, r: await runSource(s, keyword, flags, srcGroup[s]) });
    return out;
  })();

  const [httpRes, browserRes] = await Promise.all([httpPromise, browserChain]);
  const byName = new Map();
  for (const { s, r } of [...httpRes, ...browserRes]) byName.set(s, r);
  for (const s of wanted) results.push(byName.get(s));

  // 汇总校园网状态。知网和 SPIS 任一识别出机构，就说明 IP 认证生效。
  const willStop = startedChrome && !flags['keep-chrome'];
  const campusRes =
    results.find((r) => r.source === 'cnki' && r.onCampus) ||
    results.find((r) => r.source === 'spis' && r.onCampus) ||
    results.find((r) => r.source === 'cnki') ||
    results.find((r) => r.source === 'spis');
  const meta = {
    time: new Date().toLocaleString('zh-CN'),
    onCampus: campusRes ? !!campusRes.onCampus : false,
    institution: campusRes ? campusRes.institution || '' : '',
    keyword,
    sources: wanted,
    linkMode,
    stoppedChrome: willStop,
    skipped,
  };

  // 输出
  if (flags.json) {
    console.log(JSON.stringify({ meta, results }, null, 2));
  } else if (flags.md) {
    const md = renderMarkdown(results, keyword, meta);
    console.log(md);
    if (flags.save) {
      const dir = path.join(__dirname, 'results');
      fs.mkdirSync(dir, { recursive: true });
      const safe = keyword.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40);
      const file = path.join(dir, `${safe}-${new Date().toISOString().slice(0, 10)}.md`);
      fs.writeFileSync(file, md + '\n', 'utf8');
      console.error(`\n已保存：${file}`);
    }
  } else {
    console.log(renderText(results, keyword, meta));
  }

  // 收尾：是我们拉起来的 Chrome 就关掉，不留常驻无沙箱进程
  if (willStop) stopChrome();
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});

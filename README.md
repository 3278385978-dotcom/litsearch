# litsearch — 多源学术检索工具

一个零依赖的命令行工具，用于从多个学术数据库、代码托管平台和图书馆系统中检索题录。

- 每个渠道实现为独立适配器（`sources/*.js`），返回统一的数据结构；
- 新增渠道约 60–100 行，模板见 `sources/_template-http.js` / `_template-browser.js`，
  方法见 `docs/加渠道方法论.md`；
- 仓库内置 13 个渠道作为示例：CNKI、SPIS、BLYUN、Duxiu、OPAC、Huya、CXStar、
  arXiv、GitHub、OpenAlex、Crossref、DOAJ、PubMed；
- 无第三方依赖：使用 Node 内置模块，并通过手写的 CDP 客户端驱动本机 Chromium 内核浏览器。

[English](README.en.md) | 中文

## 使用

```bash
node find.js --check                                   # 环境检查
node find.js "topological insulator" --rows=5          # 论文 + 代码（默认）
node find.js "graph neural network" --src=public       # 公开库（免认证）
node find.js "FDTD" --src=github --lang=python
```

校内订阅渠道（CNKI/SPIS/OPAC/Huya/CXStar/BLYUN/Duxiu）需要：
1. 本校已开通对应资源，并在校园网内；
2. `cp config.example.js config.local.js` 后填写本校域名/机构码；
3. 详见 `docs/部署指南.md`。

未填写的渠道会在运行时跳过，不影响其它渠道。

## 分组与参数

| 分组 | 包含 | 说明 |
|---|---|---|
| `papers` | cnki + spis + blyun（论文类）+ arxiv | 默认 |
| `public` | openalex + crossref + doaj + pubmed | 免认证，默认关闭 |
| `code` | github | 默认 |
| `books` | opac + huya + cxstar + blyun（图书）+ duxiu | 需显式指定 |

常用参数：`--src=`、`--rows=N`、`--pages=N`、`--json`、`--link=detail`、
`--type=`、`--field=`、`--headless` / `--show-chrome`。

## 输出

- `--json` 时 stdout 仅包含 JSON，日志输出到 stderr；
- 题录字段：`title / author / source / date / type / url / pdfUrl / articleUrl / detailUrl`；
- 馆藏与电子书渠道另有 `publisher / year / isbn / callNo / physicalCount / onShelf / ssid / readUrl` 等字段。

## 性能（实测，见 `docs/性能优化.md`）

| 场景 | 优化前 | 优化后 |
|---|---|---|
| 知网检索 | 64.2s | 3.5s |
| 纬度检索 | 61.7s | 11.8s |
| 馆藏 OPAC | 6.3s | 2.3s |
| 20 条详情页 | 71.4s | 6.8s |
| 默认 9 个渠道 | — | 约 9s |

## 平台与浏览器

- 支持 macOS / Windows / Linux；Node 版本：macOS ≥ 20，Windows ≥ 22；
- 自动探测 Chrome / Edge / Chromium / Brave，可用 `LITSEARCH_CHROME` 指定；
- 默认无头运行，`--show-chrome` 显示窗口；
- Firefox / Safari 不支持（不使用 CDP）。

## 目录

```
find.js             入口（参数、分组、渲染）
chrome.js           受控浏览器启停（跨平台）
cdp.js              零依赖 CDP 客户端
config.js           配置加载（环境变量 > config.local.js > config.example.js）
config.example.js   配置模板
sources/            13 个渠道适配器 + 2 个新增渠道模板
docs/               中英文文档（架构、加渠道方法、检索纪律、性能、部署）
```

## 文档

| 中文 | English |
|---|---|
| `docs/部署指南.md` | `docs/deployment.en.md` |
| `docs/架构.md` | `docs/architecture.en.md` |
| `docs/加渠道方法论.md` | `docs/adding-channels.en.md` |
| `docs/检索纪律.md` | `docs/search-discipline.en.md` |
| `docs/性能优化.md` | `docs/performance.en.md` |

## 合规声明

- 本项目只做检索与题录提取，不绕过订阅限制，不批量下载，不转存或再分发内容；
- 使用订阅资源需要自行具备合法访问权限（校园网 / 机构账号）；
- 仓库不包含任何学校配置、机构码、账号或凭据；`config.local.js` 已被 `.gitignore` 排除。

## License

MIT，见 [LICENSE](LICENSE)。

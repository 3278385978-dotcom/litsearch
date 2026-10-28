# litsearch — 多源学术检索工具（零依赖）

[English](README.en.md) | 中文

> 一条命令查论文 / 代码 / 图书；13 个数据源适配器统一抽象；
> 零第三方依赖（Node 内置模块 + 可选本机 Chrome + 手写 CDP 客户端）。

## 特点

- **13 个渠道适配器**：知网、纬度学术、百链、读秀、馆藏 OPAC、汇雅、畅想之星、arXiv、GitHub、OpenAlex、Crossref、DOAJ、PubMed
- **零依赖**：不装 playwright/puppeteer，用 Node 原生 WebSocket 直连 Chrome DevTools
- **按类型分组**：`papers`（论文）/ `public`（公开库）/ `code`（代码）/ `books`（图书）
- **配置与代码分离**：学校相关值（域名/机构码/网段）全在 `config.local.js`，**仓库内不含任何学校信息**
- **失败隔离**：任一渠道失败不影响其它渠道；限流/反爬/编码问题都有对应处理
- **跨平台**：macOS / Windows / Linux；自动探测 Chrome / Edge / Chromium / Brave
  （`LITSEARCH_CHROME` 可覆盖）；默认无头后台，`--show-chrome` 可视化调试

## 快速开始

```bash
node find.js --check                                   # 环境体检
node find.js "topological insulator" --rows=5          # 默认：论文+代码
node find.js "graph neural network" --src=public       # 公开库（免认证，开箱即用）
node find.js "FDTD" --src=github --lang=python
node find.js "关键词" --show-chrome          # 默认无头后台；此参数显示浏览器窗口
```

**校内渠道**（知网/纬度/百链/读数/馆藏/汇雅/畅想）需要：
1. 本校图书馆开通对应资源（校园网 IP 认证）；
2. 复制 `config.example.js` 为 `config.local.js`，填写本校域名/机构码；
3. 详见 `docs/部署指南.md`。

> 未填写的渠道会**自动跳过**（不会报错）；只接公开库时零配置可用。

## 目录

```
find.js              入口（分组/参数/统一输出）
chrome.js            受控 Chrome 启停（独立 profile）
cdp.js               零依赖 CDP 客户端
config.js            配置加载器（环境变量 > local > example）
config.example.js    配置模板
sources/             13 个渠道适配器
docs/部署指南.md        任意学校部署/接入指南（中文）
```

## 合规声明

- 本项目只做**检索与题录提取**，不提供任何订阅资源的访问绕过、批量下载或转存；
- 使用订阅资源（知网/纬度/百维/馆藏/电子书平台等）需自行具备合法访问权限（校园网/机构账号）；
- 仓库不包含任何学校配置、机构码、账号或凭据；`config.local.js` 被 `.gitignore` 排除。

## 合规

- 只做**检索与题录**；不批量抓取、不整库转存、不二次分发；
- 文献传递/求助需本人操作，工具不代提交；
- `config.local.js` 含学校配置，已被 `.gitignore` 排除，**请勿提交**。

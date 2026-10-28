# litsearch — Multi-source academic search CLI

A zero-dependency command-line tool for retrieving bibliographic records from
multiple academic databases, code hosting platforms and library systems.

- Each channel is an independent adapter (`sources/*.js`) returning a unified structure;
- Adding a channel takes roughly 60–100 lines; see `sources/_template-http.js` /
  `_template-browser.js` and `docs/adding-channels.en.md`;
- 13 channels are included as examples: CNKI, SPIS, BLYUN, Duxiu, OPAC, Huya, CXStar,
  arXiv, GitHub, OpenAlex, Crossref, DOAJ, PubMed;
- No third-party dependencies: Node built-ins plus a hand-written CDP client that
  drives a local Chromium-based browser.

[中文](README.md) | English

## Usage

```bash
node find.js --check                                   # environment check
node find.js "topological insulator" --rows=5          # papers + code (default)
node find.js "graph neural network" --src=public       # public APIs (no auth)
node find.js "FDTD" --src=github --lang=python
```

Campus-subscription channels (CNKI/SPIS/OPAC/Huya/CXStar/BLYUN/Duxiu) require:
1. an institutional subscription and campus-network access;
2. `cp config.example.js config.local.js` and fill in your endpoints/IDs;
3. see `docs/deployment.en.md`.

Unconfigured channels are skipped at runtime and do not affect the others.

## Groups and flags

| Group | Members | Notes |
|---|---|---|
| `papers` | cnki + spis + blyun (papers) + arxiv | default |
| `public` | openalex + crossref + doaj + pubmed | no auth, off by default |
| `code` | github | default |
| `books` | opac + huya + cxstar + blyun (books) + duxiu | explicit only |

Flags: `--src=`, `--rows=N`, `--pages=N`, `--json`, `--link=detail`,
`--type=`, `--field=`, `--headless` / `--show-chrome`.

## Output

- with `--json`, stdout contains JSON only; logs go to stderr;
- record fields: `title / author / source / date / type / url / pdfUrl / articleUrl / detailUrl`;
- library and e-book channels add `publisher / year / isbn / callNo / physicalCount / onShelf / ssid / readUrl`.

## Performance (measured; see `docs/performance.en.md`)

| Scenario | Before | After |
|---|---|---|
| CNKI search | 64.2s | 3.5s |
| SPIS search | 61.7s | 11.8s |
| OPAC | 6.3s | 2.3s |
| 20 detail pages | 71.4s | 6.8s |
| Default 9 channels | — | ~9s |

## Platforms and browsers

- macOS / Windows / Linux; Node ≥ 20 on macOS, ≥ 22 on Windows;
- auto-detects Chrome / Edge / Chromium / Brave; `LITSEARCH_CHROME` overrides;
- headless by default, `--show-chrome` to show the window;
- Firefox / Safari are not supported (no CDP).

## Layout

```
find.js             entry (flags, groups, rendering)
chrome.js           managed browser lifecycle (cross-platform)
cdp.js              zero-dependency CDP client
config.js           config loader (env > config.local.js > config.example.js)
config.example.js   config template
sources/            13 channel adapters + 2 templates for new channels
docs/               documentation (Chinese and English)
```

## Docs

| Chinese | English |
|---|---|
| `docs/部署指南.md` | `docs/deployment.en.md` |
| `docs/架构.md` | `docs/architecture.en.md` |
| `docs/加渠道方法论.md` | `docs/adding-channels.en.md` |
| `docs/检索纪律.md` | `docs/search-discipline.en.md` |
| `docs/性能优化.md` | `docs/performance.en.md` |

## Compliance

- the tool performs search and bibliographic extraction only; it does not bypass
  paywalls, bulk-download, mirror or redistribute content;
- access to subscription resources requires your own legitimate rights
  (campus network / institutional account);
- the repository contains no institutional configuration, IDs, accounts or credentials;
  `config.local.js` is git-ignored.

## License

MIT, see [LICENSE](LICENSE).

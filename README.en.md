# litsearch — Multi-source academic search CLI

> One command to search papers / code / books; 13 data-source adapters on a unified
> interface; **zero third-party dependencies** (Node built-ins + optional local Chrome
> driven by a hand-written CDP client).

[中文](README.md) | English

## Features

- **13 channel adapters**: CNKI, SPIS, BLYUN, Duxiu, OPAC, Huya, CXStar, arXiv,
  GitHub, OpenAlex, Crossref, DOAJ, PubMed
- **Zero dependencies**: no playwright/puppeteer; talks to Chrome DevTools Protocol
  via Node's native WebSocket
- **Grouped channels**: `papers` / `public` / `code` / `books`
- **Config/code separation**: institution-specific values live in `config.local.js`;
  the repository contains **no institutional information**
- **Cross-platform**: macOS / Windows / Linux; auto-detects Chrome / Edge /
  Chromium / Brave (`LITSEARCH_CHROME` overrides); headless by default,
  `--show-chrome` for visual debugging
- **Failure isolation**: one failing channel never breaks the others; unconfigured
  channels are skipped gracefully

## Quick start

```bash
node find.js --check                                   # environment check
node find.js "topological insulator" --rows=5          # papers + code (default)
node find.js "graph neural network" --src=public       # public APIs only (no login)
node find.js "FDTD" --src=github --lang=python
```

Campus-subscription channels (CNKI/SPIS/OPAC/Huya/CXStar/BLYUN/Duxiu) require:
1. your institution's subscription + campus-network authentication;
2. `cp config.example.js config.local.js` and fill in your endpoints/IDs;
3. see `docs/部署指南.md` (Chinese deployment guide) for details.

## Layout

```
find.js              entry point (groups / flags / unified rendering)
chrome.js            managed Chrome lifecycle (isolated profile, headless by default)
cdp.js               minimal CDP client
config.js            config loader (env > local > example)
config.example.js    template
sources/             13 channel adapters
docs/                architecture, channel methodology, discipline, performance notes
```

## Compliance

- The tool only performs **search and bibliographic extraction**; it does not bypass
  paywalls, bulk-download or redistribute any content.
- Access to subscription resources requires your own legitimate access rights
  (campus network / institutional account).
- The repository contains no credentials; `config.local.js` is git-ignored.

## Docs

- `docs/architecture.en.md` — architecture and trade-offs
- `docs/adding-channels.en.md` — recon → implement → acceptance
- `docs/search-discipline.en.md` — records only, link verification, compliance
- `docs/performance.en.md` — measurements and rules
- `docs/deployment.en.md` — generic deployment guide

## License

MIT — see [LICENSE](LICENSE).

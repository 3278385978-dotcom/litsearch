# Deployment guide (generic)

[中文](部署指南.md) | English

> Goal: rebuild this tool on **any macOS/Windows machine with campus-network access**
> by filling a single config file. No third-party dependencies.

## 0. Architecture in one line

```
find.js (entry: flags / channel groups / rendering)
  └── sources/*.js (one adapter per channel: locate → extract → resolve links)
        ├── HTTP channels: arxiv.js, github.js, openalex.js, crossref.js, doaj.js, pubmed.js
        └── browser channels: cnki.js, spis.js, opac.js, huya.js, cxstar.js, blyun.js, duxiu.js
  └── chrome.js (managed Chrome) + cdp.js (zero-dependency CDP client, Node native WebSocket)
  └── config.js + config.local.js + config.example.js
```

**Zero npm dependencies** — Node built-ins only (`node:child_process`, `node:fs`, native
`fetch`, native `WebSocket`). Browser automation is implemented directly over CDP because
installing playwright/puppeteer is not always possible.

## 1. Prerequisites

| # | Requirement | Check | If missing |
|---|---|---|---|
| 1 | Node **≥22** | `node -v` | install Node (`cdp.js` needs native WebSocket) |
| 2 | Chrome (or Chromium/Edge) | macOS: `ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`; Windows: `dir "%ProgramFiles%\Google\Chrome\Application\chrome.exe"` | set `LITSEARCH_CHROME` to the binary |
| 3 | Campus network (IP-based auth) | `node find.js --check` | connect campus Wi-Fi / VPN |
| 4 | Writable workspace (Chrome profile) | run `node find.js "test" --src=opac` | `LITSEARCH_PROFILE=/tmp/xxx` |
| 5 | `config.local.js` filled in | `node -e "console.log(require('./config').opac)"` | copy `config.example.js` and edit |

## 2. Fill the configuration table

The tool assumes nothing about any institution. All institution-specific values live in
`config.local.js`:

| Item | Fill with | Notes |
|---|---|---|
| Institution name (for auth detection) | `________` | shown at the top of resource pages |
| Campus egress IP prefixes | `________` | used by `--check` |
| Library portal URL | `________` | resource entry point |
| OPAC / discovery domain | `________` | your library automation system |
| OPAC group code | `________` | missing → silently returns 0 results |
| Chinese paper DB entry | `________` | CNKI/Wanfang/VIP as subscribed |
| Foreign discovery entry | `________` | SPIS or similar |
| E-book platform A (Huya-like) | `________` | domain + portal `websiteId` |
| E-book platform B (CXStar-like) | `________` | JSON-API type |
| Discovery platform (BLYUN-like) | `________` | usually `jour.<platform-domain>` |
| Book search platform (Duxiu-like) | `________` | **GBK-encoded site** |

Remove the channels you don't subscribe to from `SOURCES` in `find.js`; don't leave
half-configured entries.

Files involved:
- `config.example.js` — template (shipped);
- `config.local.js` — your real values (**private**, never commit);
- `config.js` — loader (env > local > example).

## 3. Files

```
find.js              entry: flags, groups, rendering
chrome.js            managed Chrome lifecycle (headless by default)
cdp.js               zero-dependency CDP client
config.js            config loader (env > local > example)
config.example.js    template
sources/             13 channel adapters
docs/                architecture / adding-channels / search-discipline / performance
部署指南.md      Chinese deployment guide (this document in English)
```

## 4. Deploy and smoke test

```bash
# Chrome path (only if not the default)
export LITSEARCH_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # macOS
# $env:LITSEARCH_CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"           # Windows

export LITSEARCH_PROFILE="$PWD/.chrome-profile"

node find.js --check                       # environment check

# daily: papers (default = papers + code)
node find.js "topological insulator" --rows=5

# explicit groups
node find.js "topological insulator" --src=papers --rows=5
node find.js "FDTD" --src=code
node find.js "电磁场与电磁波" --src=books --rows=3
node find.js "topological insulator" --src=public --rows=5

# single channel / filters
node find.js "topological insulator" --src=blyun --type=学位论文 --rows=5
node find.js "电磁场与电磁波" --src=huya --rows=3
node find.js "电动力学" --src=duxiu --rows=3
```

> Browser is **headless by default**; `--show-chrome` (or `LITSEARCH_HEADLESS=0`) shows it.
> Managed Chrome is closed after use; your daily Chrome profile is never touched.

## 5. Contracts

### 5.1 CLI

| Flag | Purpose |
|---|---|
| `--src=channel/group` | channels: cnki/spis/blyun/arxiv/github/opac/huya/cxstar/duxiu/openalex/crossref/doaj/pubmed; groups: papers/public/code/books/all |
| `--rows=N` / `--pages=N` | item count / pages |
| `--json` | JSON only on stdout (**copy links from here**) |
| `--link=detail` | **default**: site detail page (click-register + API verification); `--link=article` for the publisher link |
| `--offset=N` | skip the first N records (0-based); pair with `--rows` for incremental paging (cached pages are not re-fetched) |
| `--no-cache` / `--refresh` / `--cache-ttl=SEC` / `--clear-cache` | result cache control (30 min TTL, macOS `~/Library/Caches/litsearch`) |
| `--en` | search the foreign-language database (CNKI) |
| `--type=` | type filter (master/doctor/thesis/journal/conference/book/newspaper) |
| `--field=` | e-book search field (bookname/author/catalog/fulltext) |
| `--headless` / `--show-chrome` | browser visibility |

Default (no `--src`) = `papers` + `code`; public APIs and books are opt-in.

### 5.2 Item fields

```
title, author, source, date, type, url, pdfUrl, articleUrl, detailUrl, detailVerified,
// OPAC: publisher, year, isbn, callNo, physicalCount, onShelf, canBorrow, eCount
// e-books: ssid, kinds, readUrl, cardUrl, ruid
// book search: avail[], cite
// BLYUN: type, meta
```

### 5.3 Link verification

- Copy links verbatim from `--json`; no retyping/ellipses/placeholders;
- External links: `curl -L` 200/30x is OK;
- **Discovery-system detail pages: SPA 404 is still HTTP 200** → verify through the
  backend API (`/api/article/data/<gid>` returns a body object);
- Sample-verify per domain; at most one browser spot check;
- If unverifiable: keep the record, fall back to the publisher URL with ⚠️; never ship a
  fake link; 403/429 ≠ broken link (anti-bot/rate limit).

## 6. Channel quick reference

| Channel type | Auth | Key point | Pitfall |
|---|---|---|---|
| Chinese paper DB (CNKI-like) | campus IP | result rows + institution marker; type facets | don't wait for `load`; type filter is a facet click; headless UA may be blocked (UA spoof built in) |
| Foreign discovery (SPIS-like) | campus IP | card selector + gid; AJAX pagination | bare detail URLs 404 → build `saveDetail` payloads from card DOM and batch-register (a second list-API call overlaps rendered cards only ~2/10; don't use it) |
| OPAC | no login | same-origin POST with group code | missing group code → 0 results; `canBrrowCountI` often `null` |
| E-book (Huya-like) | campus IP | card list; `ssid` | reader links carry expiring signatures; `/book/detail` may 404 |
| E-book (CXStar-like) | campus IP | JSON `POST /esapi/Book/Search` | strict rate limit (429 + retry-after) |
| Discovery (BLYUN-like) | campus IP | results grouped by type | not a flat list |
| Book search (Duxiu-like) | campus IP | **GBK encoding** — submit a form with `accept-charset=GBK` | Node has no GBK encoder |
| arXiv | none | Atom XML | Chinese keywords return 0 |
| GitHub | none (rate limited) | JSON `items[]` | Chinese keywords return spam repos |
| OpenAlex / Crossref / DOAJ / PubMed | none | JSON APIs | Crossref `component` records; DOAJ occasional 5xx |

## 7. Adding a channel

### 7.1 Recon (read-only)

1. Perform one manual search in a browser;
2. DevTools → Network: find the data source (JSON API preferred; otherwise record the
   container selector);
3. Check auth (clear cookies: still works = IP auth);
4. Note pagination style and page size.

### 7.2 Adapter skeleton (HTTP)

```js
'use strict';
const API = 'https://<host>/api/search';

async function search(keyword, opts = {}) {
  const rows = Math.min(Math.max(Number(opts.rows) || 10, 1), 50);
  const url = `${API}?q=${encodeURIComponent(keyword)}&n=${rows}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'litsearch/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return {
    source: 'xxx', label: 'Site', keyword,
    numFound: j.total || 0,
    items: (j.hits || []).map((x) => ({
      title: x.title, author: x.author, source: x.venue, date: x.date, url: x.link,
    })),
  };
}
module.exports = { search, API };
```

Browser channels: copy `sources/opac.js` (API-style) or `sources/spis.js` (DOM + register),
then change the three parts:

1. **Locate** — `Page.navigate` + wait for URL + `waitFor(container)` (**never wait for `load`**);
2. **Extract** — inject JS returning JSON;
3. **Resolve links** — DOM directly, or batched registration/clicking (`Promise.all`).

### 7.3 Register

```js
const SOURCES = { xxx: { mod: './sources/xxx', browser: false, label: 'Site' } };
// add channel-specific options in optsFor()
```

### 7.4 Acceptance checklist

- [ ] `node --check sources/xxx.js`
- [ ] `--rows=3` returns items; `--json` has complete link fields
- [ ] one link returns 200 (or the API criterion passes)
- [ ] one Chinese + one English keyword tested
- [ ] failures surface a clear error
- [ ] Chrome stopped afterwards
- [ ] new pitfalls documented

## 8. Common pitfalls (22)

1. never wait for `load` (discovery systems may take 60s);
2. batch API calls (`Promise.all` in one eval);
3. replace fixed sleeps with condition waits;
4. headless UA may be blocked (403) → spoof a normal UA;
5. SPA 404 is still HTTP 200 → verify through the API;
6. bare links may 404 until the record is registered;
7. clicks may be swallowed by inline tags (`<b>`) → click the left edge of the title;
8. result sets fluctuate between runs → take everything in one run;
9. progressive rendering → wait until the element count is stable;
10. `null` ≠ 0 (`canBrrowCountI`);
11. OPAC multi-word queries are AND → search the bare title;
12. e-book reader links carry expiring signatures;
13. 403/429 ≠ broken link;
14. always close the managed Chrome;
15. GBK sites (Duxiu-like): submit a form with `accept-charset=GBK`;
16. strongly rate-limited sites (CXStar-like): ≥2.5s interval, stop on 429;
17. discovery results are grouped by type (BLYUN-like);
18. books are a last resort; do not query book channels by default;
19. don't over-parse metadata lines — show them verbatim;
20. public libraries are noisy for Chinese keywords;
21. Crossref `component` records (`.s001`) must be filtered;
22. publisher links returning 403 are not broken links.

## 9. Deployment acceptance

```bash
node find.js --check
# expect: egress IP in campus range; Chinese/foreign DBs identify your institution

node find.js "test" --src=papers --rows=3 --link=detail
# expect: results from all paper channels; details verified

node find.js "教材名" --src=books --rows=2
# expect: library / e-book / book-search channels run; no Chinese/foreign paper DBs

node find.js "topological insulator" --src=public --rows=3
# expect: OpenAlex/Crossref/DOAJ/PubMed return results (no campus network needed)
```

## 10. Cross-platform and browsers

Cross-platform handling is **built in** (`chrome.js`):

| Capability | Details |
|---|---|
| Browser auto-detection | macOS: Chrome / Edge / Chromium / Brave; Windows: `%ProgramFiles%\Google\Chrome\Application\chrome.exe` etc. + Edge/Chromium/Brave; Linux: `google-chrome` / `chromium` / `microsoft-edge` / `brave-browser` |
| Manual override | `LITSEARCH_CHROME=<path to any Chromium-based browser>` |
| Process shutdown | a `.chrome.pid` file is written at launch; stop by PID (`kill`, or `taskkill /PID` on Windows), with a debug-port fallback |
| Headless UA | version read per platform (macOS/Linux: `--version`; Windows: versioned install directory) and a platform-correct UA is sent |

**Support matrix**:

| Platform / browser | Status |
|---|---|
| macOS + Chrome / Edge / Chromium / Brave | ✅ tested |
| Windows + Chrome / Edge | ✅ implemented, **not tested on real hardware** |
| Linux + Chromium-based | ✅ implemented, not hardware-tested |
| Firefox / Safari | ❌ not supported (not CDP; requires a WebDriver layer) |

**Node**: ≥ 22 on all platforms (`cdp.js` needs native WebSocket and `fetch`).

**The Chrome profile defaults to the system temp directory**
(`os.tmpdir()/litsearch-chrome-profile`) so the browser can start even when the tool
directory is read-only (e.g. another agent cannot write `~/litsearch`); override with
`LITSEARCH_PROFILE`.
**Windows troubleshooting**: run `node find.js --check`; if no browser is found set
`LITSEARCH_CHROME`; for mojibake run `chcp 65001` first.

## 11. Dependencies and security
## 11. Dependencies and security

- Public APIs need no auth; campus channels rely **only on campus IP authentication**
  (no account/password anywhere);
- No credentials are hard-coded; `GITHUB_TOKEN` is read from env only;
- Managed Chrome uses an **isolated profile**, never your daily browser profile;
- Never read credential files or login scripts;
- Do not commit `.chrome-profile/`, backups, `results/` or `config.local.js`.

## 12. Operations

- Keep a single pre-change backup `备份_YYYY-MM-DD.tar.gz`; restore with `tar xzf`;
- Change discipline: explain → backup → change → `node --check` → real run → report;
- Performance targets: one channel 5–10s, two channels ~6s, whole round ≤30s;
- Keep docs in sync with code (add new pitfalls to the docs).

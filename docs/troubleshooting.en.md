# Common errors and 404 troubleshooting

> Goal: given "won't open / 0 results / error", find the cause instead of guessing.
> Criteria below come from real measurements (campus network + managed browser).

## 0. Triage: whose problem is it

| Symptom | Check first | Conclusion |
|---|---|---|
| all channels return 0 | `node find.js --check` | campus auth missing / network down |
| only campus channels 0, public APIs fine | config and auth | channel unconfigured, or not on campus IP |
| one link broken, others fine | link type (section 1) | unregistered bare link / anti-bot / expired signature |
| process exits with error (exit 1) | last line on stderr | tool bug or network error (section 3) |

## 1. Links / 404

| Symptom | Likely cause | How to confirm | Action |
|---|---|---|---|
| SPIS detail page opens to 404 | **bare detail link not "registered"**; a URL assembled from `gid` does not work | register with `POST /api/article/saveDetail`, then `GET /api/article/data/<gid>` | use the default detail mode (no `--link` flag); never trust hand-built URLs |
| HTTP 200 but page shows "404 / not found" | **SPA soft 404**: the route always returns 200 and JS renders the error | check the backend API: `/api/article/data/<gid>` must return a body object | trust the API only; keep the record, fall back to publisher URL with ⚠️ |
| publisher link 403 / 429 | anti-bot / rate limit, **not 404** | `curl` shows 403/429 while a browser opens it | report it as anti-bot; don't fabricate links; use detail page or document delivery |
| Huya reader link expires | `d/enc/t` **time-signed** URL | open immediately after searching | use immediately; never store or forward |
| `/book/detail?ssid=` 404 | route does not exist | open `/book/card?ssid=` instead | use card page + reader |
| Duxiu `ruid/d/...` link dead | time signature | re-run the search | use immediately |
| DOI / publisher 404 | retraction, journal change, migration | check Crossref/DOI metadata | use an OA copy (arXiv/PMC/DOAJ) or the detail page |
| fewer detail pages than records | some records fail to register | the "N without detail" count in output | keep them with publisher fallback and ⚠️ |

## 2. Results / zero hits

| Symptom | Likely cause | Action |
|---|---|---|
| numFound > 0 but list empty | a "not found" page parsed as a result page | use the current adapters (they detect the no-result page and return early) |
| Chinese query, ~0 hits on arXiv/GitHub/public APIs | those sources are English-dominated | use English keywords |
| CNKI `--type=master` mismatched | type is a sidebar facet, not a URL parameter | use the built-in type filter; don't hand-build URLs |
| `--pages=2` returns one page | unreliable wait after pagination | use current version (compares the first row title at the same position) |
| OPAC 0 hits | missing group code / multi-word is AND | check `groupCode` in `config.local.js`; use fewer words |
| channel returns 0 though the site has data | not authenticated → login redirect | `--check`; log in to the campus network |
| CXStar suddenly fails | 429 rate limit (`retry-after`) | stop retrying; run later |

## 3. Runtime / environment

| Symptom | Cause | Action |
|---|---|---|
| `no Chromium-based browser found` | none installed | install Chrome/Edge/Chromium/Brave, or set `LITSEARCH_CHROME` |
| browser won't stop | process modified / PID file lost | `node chrome.js stop`; fall back to the debug port (`netstat -ano` on Windows) |
| Windows mojibake | terminal encoding | `chcp 65001` |
| `JSON.parse` fails | logs mixed into stdout | use `--json`; logs already go to stderr |
| headless blocked with 403 | anti-automation | UA spoofing is built in; use `--show-chrome` to observe, then treat as anti-bot |
| `fetch`/`WebSocket` missing | Node too old | upgrade to **Node ≥ 22** |

## 4. Reporting format

Always state: **channel → hit count → records (title/year/citations/detail or publisher) →
verification status per link → failure category**.

Never:
- invent, retype or abbreviate links (`…`, `<gid>`, "see above");
- report 403/429 as 404;
- say "nothing exists" when it merely "wasn't found";
- mark a link as verified without verifying it.
